#include "v2/Engine.h"
#include "v2/ProgramJson.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <iostream>
#include <limits>
#include <optional>
#include <set>
#include <stdexcept>
#include <unordered_map>
#include <unordered_set>
#ifdef V2_PROFILE_TIMERS
#include <chrono>
#endif

namespace vessel_dsp::v2 {

/**
 * Weak empty kernel table. `scripts/generate-v2-kernels.ts` writes
 * `src/runtime/cpp/GeneratedKernels.cpp` with a strong definition; every build
 * that does not link that file (scratch harnesses, partial builds) keeps the
 * interpreter with no build-flag coupling.
 */
__attribute__((weak)) const V2GeneratedKernelEntry* v2GeneratedKernels(size_t* count) {
    if (count != nullptr) *count = 0;
    return nullptr;
}

namespace {

/**
 * Where one composed block's per-position state lives.
 *
 * A composed block holds independent delay lines, comb sections and pitch history
 * per selectable program, because two modes need not share a buffer and a switch
 * must not have to clear one. Mirrors `composedStateKey` in the TypeScript console
 * exactly; the two consoles have to agree sample for sample, so they agree on their
 * state layout too.
 */
inline std::string composedStateKey(const std::string& blockId, size_t position) {
    return blockId + "#" + std::to_string(position);
}


/**
 * FNV-1a over the schedule's shape and op stream. The generator
 * (`scripts/generate-v2-kernels.ts`) computes the identical hash, so a program
 * whose schedule does not match the kernel table's entry simply runs the
 * interpreter -- a stale kernel is unreachable by construction, not by trust.
 */
uint32_t scheduleFingerprint(const SparseSchedule& schedule) {
    uint32_t hash = 2166136261u;
    const auto mix = [&hash](int32_t value) {
        for (int shift = 0; shift < 32; shift += 8) {
            hash ^= static_cast<uint32_t>((value >> shift) & 0xFF);
            hash *= 16777619u;
        }
    };
    mix(schedule.size);
    mix(schedule.slots);
    mix(schedule.factorCount);
    for (const int32_t op : schedule.ops) mix(op);
    for (const int32_t row : schedule.gatherRow) mix(row);
    for (const int32_t column : schedule.gatherColumn) mix(column);
    return hash;
}

V2GeneratedKernelFn findGeneratedKernel(const SparseSchedule& schedule) {
    size_t count = 0;
    const V2GeneratedKernelEntry* entries = v2GeneratedKernels(&count);
    if (entries == nullptr || count == 0) return nullptr;
    const uint32_t fingerprint = scheduleFingerprint(schedule);
    size_t low = 0;
    size_t high = count;
    while (low < high) {
        const size_t mid = low + (high - low) / 2;
        if (entries[mid].fingerprint < fingerprint) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    if (low < count && entries[low].fingerprint == fingerprint) {
        return entries[low].fn;
    }
    return nullptr;
}

/**
 * Value-aware re-pivot: threshold Markowitz over the schedule's own filled
 * pattern against the assembled operating-point matrix. Mirrors
 * `packages/compiler/src/sparse-schedule.ts` (`computeNumericRepivot`) op for
 * op and pivot for pivot -- ascending row/column scans with a strict key
 * comparison make the choice deterministic, so both consoles adopt the same
 * order. Returns `std::nullopt` when no candidate meets `tau` of its column's
 * remaining maximum, which leaves the caller to drop the block to dense exactly
 * as before.
 */
std::optional<SparseSchedule> computeNumericRepivot(
    const SparseSchedule& schedule,
    int32_t size,
    const std::vector<double>& matrix,
    double tau
) {
    if (size <= 0 || matrix.size() != static_cast<size_t>(size) * static_cast<size_t>(size)) {
        return std::nullopt;
    }
    std::vector<std::set<int32_t>> rows(static_cast<size_t>(size));
    std::vector<std::set<int32_t>> columns(static_cast<size_t>(size));
    for (size_t slot = 0; slot < schedule.gatherRow.size(); ++slot) {
        const int32_t row = schedule.gatherRow[slot];
        const int32_t column = schedule.gatherColumn[slot];
        if (row < 0 || row >= size || column < 0 || column >= size) return std::nullopt;
        rows[static_cast<size_t>(row)].insert(column);
        columns[static_cast<size_t>(column)].insert(row);
    }
    std::vector<double> working = matrix;
    std::vector<char> doneRow(static_cast<size_t>(size), 0);
    std::vector<char> doneColumn(static_cast<size_t>(size), 0);
    std::vector<std::pair<int32_t, int32_t>> pivots;
    pivots.reserve(static_cast<size_t>(size));
    for (int32_t step = 0; step < size; ++step) {
        int32_t bestRow = -1;
        int32_t bestColumn = -1;
        double bestKey = std::numeric_limits<double>::infinity();
        for (int32_t row = 0; row < size; ++row) {
            if (doneRow[static_cast<size_t>(row)] != 0) continue;
            int32_t rowCount = 0;
            for (const int32_t column : rows[static_cast<size_t>(row)]) {
                if (doneColumn[static_cast<size_t>(column)] == 0) ++rowCount;
            }
            if (rowCount == 0) continue;
            for (const int32_t column : rows[static_cast<size_t>(row)]) {
                if (doneColumn[static_cast<size_t>(column)] != 0) continue;
                int32_t columnCount = 0;
                double columnMax = 0.0;
                for (const int32_t other : columns[static_cast<size_t>(column)]) {
                    if (doneRow[static_cast<size_t>(other)] != 0) continue;
                    ++columnCount;
                    const double magnitude = std::abs(
                        working[static_cast<size_t>(other) * static_cast<size_t>(size) +
                                static_cast<size_t>(column)]
                    );
                    if (magnitude > columnMax) columnMax = magnitude;
                }
                const double value = std::abs(
                    working[static_cast<size_t>(row) * static_cast<size_t>(size) +
                            static_cast<size_t>(column)]
                );
                if (!(columnMax > 0.0) || value < tau * columnMax) continue;
                const double key = static_cast<double>(
                    (rowCount - 1) * (columnCount - 1) * 2 + (row == column ? 0 : 1)
                );
                if (key < bestKey) {
                    bestKey = key;
                    bestRow = row;
                    bestColumn = column;
                }
            }
        }
        if (bestRow < 0) return std::nullopt;
        const double pivotValue =
            working[static_cast<size_t>(bestRow) * static_cast<size_t>(size) +
                    static_cast<size_t>(bestColumn)];
        std::vector<int32_t> pivotRowSymbolic;
        for (const int32_t column : rows[static_cast<size_t>(bestRow)]) {
            if (doneColumn[static_cast<size_t>(column)] == 0 && column != bestColumn) {
                pivotRowSymbolic.push_back(column);
            }
        }
        std::vector<int32_t> pivotColumnSymbolic;
        for (const int32_t row : columns[static_cast<size_t>(bestColumn)]) {
            if (doneRow[static_cast<size_t>(row)] == 0 && row != bestRow) {
                pivotColumnSymbolic.push_back(row);
            }
        }
        for (const int32_t row : pivotColumnSymbolic) {
            for (const int32_t column : pivotRowSymbolic) {
                if (rows[static_cast<size_t>(row)].insert(column).second) {
                    columns[static_cast<size_t>(column)].insert(row);
                }
            }
        }
        for (const int32_t row : pivotColumnSymbolic) {
            double* target =
                working.data() + static_cast<size_t>(row) * static_cast<size_t>(size);
            const double* source =
                working.data() + static_cast<size_t>(bestRow) * static_cast<size_t>(size);
            const double factor = target[bestColumn] / pivotValue;
            if (factor != 0.0) {
                for (int32_t column = 0; column < size; ++column) {
                    if (doneColumn[static_cast<size_t>(column)] == 0 && column != bestColumn) {
                        target[column] -= factor * source[column];
                    }
                }
            }
            target[bestColumn] = 0.0;
        }
        pivots.emplace_back(bestRow, bestColumn);
        doneRow[static_cast<size_t>(bestRow)] = 1;
        doneColumn[static_cast<size_t>(bestColumn)] = 1;
    }
    if (static_cast<int32_t>(pivots.size()) != size) return std::nullopt;

    SparseSchedule out;
    out.size = size;
    std::unordered_map<int64_t, int32_t> slotOf;
    for (int32_t row = 0; row < size; ++row) {
        for (const int32_t column : rows[static_cast<size_t>(row)]) {
            slotOf[static_cast<int64_t>(row) * size + column] =
                static_cast<int32_t>(out.gatherRow.size());
            out.gatherRow.push_back(row);
            out.gatherColumn.push_back(column);
            out.gatherOffsets.push_back(row * size + column);
        }
    }
    out.slots = static_cast<int32_t>(out.gatherRow.size());
    const auto slot = [&slotOf, size](int32_t row, int32_t column) -> int32_t {
        const auto found = slotOf.find(static_cast<int64_t>(row) * size + column);
        if (found == slotOf.end()) {
            throw std::runtime_error("numeric re-pivot: missing slot");
        }
        return found->second;
    };
    std::vector<std::set<int32_t>> liveRows(static_cast<size_t>(size));
    std::vector<std::set<int32_t>> liveColumns(static_cast<size_t>(size));
    for (size_t slotIndex = 0; slotIndex < schedule.gatherRow.size(); ++slotIndex) {
        const int32_t row = schedule.gatherRow[slotIndex];
        const int32_t column = schedule.gatherColumn[slotIndex];
        liveRows[static_cast<size_t>(row)].insert(column);
        liveColumns[static_cast<size_t>(column)].insert(row);
    }
    std::vector<char> eliminatedRow(static_cast<size_t>(size), 0);
    std::vector<char> eliminatedColumn(static_cast<size_t>(size), 0);
    int32_t factorCount = 0;
    int32_t sparseOps = 0;
    const auto push = [&out](int32_t op, int32_t a, int32_t b, int32_t c) {
        out.ops.push_back(op);
        out.ops.push_back(a);
        out.ops.push_back(b);
        out.ops.push_back(c);
        SparseOp structured;
        structured.op = op;
        structured.a = a;
        structured.b = b;
        structured.c = c;
        out.structuredOps.push_back(structured);
    };
    for (const auto& pivot : pivots) {
        push(6, slot(pivot.first, pivot.second), 0, 0);
        std::vector<int32_t> pivotRow;
        for (const int32_t column : liveRows[static_cast<size_t>(pivot.first)]) {
            if (eliminatedColumn[static_cast<size_t>(column)] == 0 && column != pivot.second) {
                pivotRow.push_back(column);
            }
        }
        std::vector<int32_t> pivotColumn;
        for (const int32_t row : liveColumns[static_cast<size_t>(pivot.second)]) {
            if (eliminatedRow[static_cast<size_t>(row)] == 0 && row != pivot.first) {
                pivotColumn.push_back(row);
            }
        }
        for (const int32_t row : pivotColumn) {
            const int32_t factor = factorCount;
            factorCount += 1;
            push(0, factor, slot(row, pivot.second), slot(pivot.first, pivot.second));
            for (const int32_t column : pivotRow) {
                if (liveRows[static_cast<size_t>(row)].insert(column).second) {
                    liveColumns[static_cast<size_t>(column)].insert(row);
                }
                push(1, slot(row, column), factor, slot(pivot.first, column));
                sparseOps += 1;
            }
            push(2, row, factor, pivot.first);
            sparseOps += 1;
        }
        eliminatedRow[static_cast<size_t>(pivot.first)] = 1;
        eliminatedColumn[static_cast<size_t>(pivot.second)] = 1;
    }
    for (int32_t step = static_cast<int32_t>(pivots.size()) - 1; step >= 0; --step) {
        const auto& pivot = pivots[static_cast<size_t>(step)];
        push(3, pivot.first, 0, 0);
        for (int32_t later = step + 1; later < static_cast<int32_t>(pivots.size()); ++later) {
            const int32_t column = pivots[static_cast<size_t>(later)].second;
            if (liveRows[static_cast<size_t>(pivot.first)].count(column) != 0) {
                push(4, slot(pivot.first, column), column, 0);
                sparseOps += 1;
            }
        }
        push(5, pivot.second, slot(pivot.first, pivot.second), 0);
    }
    out.factorCount = factorCount;
    out.sparseOps = sparseOps;
    out.denseOps = (size * size * size - size) / 3;
    out.unprovenPivots = 0;
    return out;
}

constexpr double GMIN_SIEMENS = 1e-12;
constexpr double GMIN_STEPPING_START_SIEMENS = 1e-2;
constexpr double GMIN_STEPPING_RATIO = 10.0;
constexpr double SOURCE_STEPPING_MIN_STEP_SIZE = 1e-6;
constexpr int32_t SOURCE_STEPPING_MAX_FAILURES = 50;
constexpr double DC_INDUCTOR_SHORT_OHMS = 1e-2;
constexpr double OPAMP_GAIN_BANDWIDTH_HZ = 1e6;
constexpr double OPAMP_MAX_DIFFERENTIAL_STEP = 4.0;
constexpr double OPAMP_SATURATION_BAND = 8.0;
constexpr double OPAMP_DIFFERENTIAL_BAND = 12.0;
// Mirrors reference-runtime.ts `OPAMP_FOLD_STREAK`: consecutive limited iterations with an op-amp's
// cap within an eighth of a linear width before the solve reseeds it on its other rail.
constexpr int32_t OPAMP_FOLD_STREAK = 6;
constexpr double JUNCTION_EXPONENT_LIMIT = 60.0;
constexpr double ZENER_TEST_CURRENT_AMPS = 5e-3;
constexpr double MIN_STAMP_OHMS = 1e-6;
constexpr double SPRING_DISPERSION_COEFFICIENT = 0.6;
constexpr int32_t SCHEDULE_OP_WIDTH = 4;
constexpr double SCHEDULE_PIVOT_FLOOR = 1e-18;
constexpr int32_t SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT = 64;
// Comparison tolerance for `settlePivotOrders()`. Same value, same metric and
// same drop semantics as `ReferenceRuntime`'s `SCHEDULE_VALIDATION_TOL` --
// keep the two identical. See its comment for why the tolerance sits here.
constexpr double SCHEDULE_VALIDATION_TOL = 1e-3;
// Threshold for the numeric re-pivot's Markowitz filter, same value as
// `NUMERIC_REPIVOT_TAU` in `packages/compiler/src/sparse-schedule.ts`.
constexpr double NUMERIC_REPIVOT_TAU = 1e-3;
// Audio-agreement bar, improvement ratio and fill-growth ceiling for adopting
// a value-aware order over a validating shipped one. Same values and same
// predicate (`shouldRefinePivotOrder`) as `ReferenceRuntime` -- keep the two
// identical. See its comment for the measured basis.
constexpr double SCHEDULE_REFINEMENT_BAR = 1e-9;
constexpr double SCHEDULE_REFINEMENT_RATIO = 10.0;
constexpr double SCHEDULE_REFINEMENT_MAX_COST_GROWTH = 1.1;

inline bool shouldRefinePivotOrder(
    double shippedDisagreement,
    double candidateDisagreement,
    double shippedOps,
    double shippedSlots,
    double candidateOps,
    double candidateSlots
) {
    if (!std::isfinite(shippedDisagreement) || !std::isfinite(candidateDisagreement)) {
        return false;
    }
    return shippedDisagreement > SCHEDULE_REFINEMENT_BAR &&
        candidateDisagreement <= SCHEDULE_REFINEMENT_BAR &&
        candidateDisagreement < shippedDisagreement / SCHEDULE_REFINEMENT_RATIO &&
        candidateOps <= SCHEDULE_REFINEMENT_MAX_COST_GROWTH * shippedOps &&
        candidateSlots <= SCHEDULE_REFINEMENT_MAX_COST_GROWTH * shippedSlots;
}
constexpr uint64_t HISTORY_KEY_BASE = 8192ULL;
constexpr double NEWTON_RELATIVE_TOLERANCE = 1e-3;
constexpr double NEWTON_VOLTAGE_TOLERANCE = 1e-6;

inline bool isAllFinite(const double* data, int32_t size) {
    for (int32_t i = 0; i < size; ++i) {
        if (!std::isfinite(data[i])) return false;
    }
    return true;
}

inline bool isAllFinite(const std::vector<double>& v) {
    return isAllFinite(v.data(), static_cast<int32_t>(v.size()));
}

constexpr double REVERB_COMB_SECONDS[4] = {
    1557.0 / 44100.0,
    1617.0 / 44100.0,
    1491.0 / 44100.0,
    1422.0 / 44100.0
};
constexpr double REVERB_ALLPASS_SECONDS[2] = {
    225.0 / 44100.0,
    556.0 / 44100.0
};
constexpr double REVERB_ALLPASS_GAIN = 0.7;
// Pitch resampling window (row 5): 4096 samples of history, wraps of 2048.
// Covers fundamentals down to ~23 Hz at ratio 0.5 with margin; the wrap
// cadence is the documented discontinuity, not a tunable.
constexpr int32_t PITCH_HISTORY = 4096;
constexpr int32_t PITCH_WINDOW = 2048;
// Pitch tracking window and hop (row 6): lags 20..1024 span 46.9 Hz..2.4 kHz.
constexpr int32_t TRACK_WINDOW = 2048;
constexpr int32_t TRACK_HOP = 256;
constexpr int32_t TRACK_MIN_LAG = 20;
constexpr int32_t TRACK_MAX_LAG = 1024;
constexpr double TRACK_SILENCE_ENERGY = 1e-12;

inline double reverbCombGain(double delaySeconds, double decaySeconds) {
    if (!(decaySeconds > 0.0) || !(delaySeconds > 0.0)) {
        return 0.0;
    }
    return std::min(0.999, std::pow(10.0, (-3.0 * delaySeconds) / decaySeconds));
}

// Fundamental by YIN difference with cumulative-mean normalization and
// first dip below threshold (row 6), mirroring trackPitchFundamental in
// the TS runtime term for term: flat input reads 0, not a guess.
inline double trackPitchFundamental(const std::vector<double>& window, double sampleRate) {
    double peak = -std::numeric_limits<double>::infinity();
    double trough = std::numeric_limits<double>::infinity();
    for (double sample : window) {
        if (sample > peak) peak = sample;
        if (sample < trough) trough = sample;
    }
    if (!(peak - trough > 1e-9)) {
        return 0.0;
    }
    double energy = 0.0;
    for (double sample : window) {
        energy += sample * sample;
    }
    if (!(energy > TRACK_SILENCE_ENERGY)) {
        return 0.0;
    }
    int32_t maxLag = std::min<int32_t>(TRACK_MAX_LAG, static_cast<int32_t>(window.size()) / 2);
    auto difference = [&](int32_t lag) -> double {
        double sum = 0.0;
        for (size_t index = static_cast<size_t>(lag); index < window.size(); ++index) {
            double delta = window[index] - window[index - static_cast<size_t>(lag)];
            sum += delta * delta;
        }
        return sum;
    };
    double running = 0.0;
    int32_t bestLag = -1;
    for (int32_t lag = TRACK_MIN_LAG; lag <= maxLag; ++lag) {
        double d = difference(lag);
        running += d;
        double normalized = (d * static_cast<double>(lag)) / running;
        if (normalized < 0.1) {
            bestLag = lag;
            break;
        }
    }
    if (bestLag == -1) {
        return 0.0;
    }
    double refined = static_cast<double>(bestLag);
    if (bestLag > TRACK_MIN_LAG && bestLag < maxLag) {
        double previous = difference(bestLag - 1);
        double center = difference(bestLag);
        double next = difference(bestLag + 1);
        double denominator = previous - 2.0 * center + next;
        if (denominator > 0.0) {
            refined = static_cast<double>(bestLag) + (0.5 * (previous - next)) / denominator;
        }
    }
    if (!(refined > 0.0)) {
        return 0.0;
    }
    return sampleRate / refined;
}

static const std::unordered_set<std::string> SUPPORTED_OPERATORS = {
    "spring-reverb",
    "conductance",
    "controlled-conductance",
    "controlled-resistance",
    "capacitor",
    "inductor",
    "diode",
    "switch",
    "selector",
    "dc-source",
    "ac-source",
    "bjt",
    "fet",
    "triode",
    "pentode",
    "tube-diode",
    "transformer",
    "input-source",
    "ideal-opamp",
    "macro-audio-source",
    "vccs",
    "optocoupler",
    "logic-divider",
    "analog-switch",
    "ota",
    "compandor",
    "linear-vca",
    "clock-driver",
    "comparator"
};

static const std::unordered_set<std::string> SUPPORTED_MODELS = {
    "bucket-brigade-delay-line",
    "digital-delay-line",
    "digital-reverb-module",
    "pitch-shift",
    "pitch-tracker"
};

inline double clamp(double value, double low, double high) {
    return std::min(high, std::max(low, value));
}

inline uint64_t packHistoryKey2(int32_t blockIndex, int32_t a, int32_t b) {
    return (static_cast<uint64_t>(blockIndex) * HISTORY_KEY_BASE + a) * HISTORY_KEY_BASE + b;
}

inline uint64_t packHistoryKey3(int32_t blockIndex, int32_t a, int32_t b, int32_t c) {
    return ((static_cast<uint64_t>(blockIndex) * HISTORY_KEY_BASE + a) * HISTORY_KEY_BASE + b) * HISTORY_KEY_BASE + c;
}

inline double taperFraction(TaperKind taper, double position) {
    double x = clamp(position, 0.0, 1.0);
    // 1089/49: the base for which (b^0.5 - 1)/(b - 1) is exactly 0.175, the Alpha
    // A-taper bracket midpoint at half rotation (see packages/runtime/src/taper.ts). Must stay
    // bit-consistent with the TS console: both consoles round the same detents.
    constexpr double audioBase = 1089.0 / 49.0;
    if (taper == TaperKind::Logarithmic) {
        return (std::pow(audioBase, x) - 1.0) / (audioBase - 1.0);
    }
    if (taper == TaperKind::AntiLogarithmic) {
        return 1.0 - (std::pow(audioBase, 1.0 - x) - 1.0) / (audioBase - 1.0);
    }
    if (taper == TaperKind::ReverseLinear) {
        return 1.0 - x;
    }
    return x;
}

constexpr double kTriodeGridCutoffThresholdVolts = -3.0;
constexpr double kTriodeGridStepVolts = 5.0;
constexpr double kTriodeGridStepDownVolts = 40.0;
constexpr double kTriodePlateStepVolts = 40.0;

// Mirrors MODULATION_SCALE_MIN/MAX and MODULATION_DC_SECONDS in
// src/runtime/reference-runtime.ts. These three numbers are the contract between the two
// consoles: the TS side is the oracle and any divergence here shows up directly as a parity
// failure, so they are duplicated deliberately rather than derived.
constexpr double kModulationScaleMin = 0.5;
constexpr double kModulationScaleMax = 2.0;
constexpr double kModulationDcSeconds = 10.0;

// Under-relaxation engages on evidence of oscillation -- `delta` failing to fall twice running
// -- and no earlier than iteration 8, latched for the rest of the solve. Mirrors the TS
// reference exactly; see its comment for the measurements behind both conditions.
constexpr int32_t kNewtonNonContractingLimit = 2;
constexpr int32_t kNewtonRelaxationEarliestIteration = 8;
constexpr double kNewtonRelaxationFactor = 0.5;

inline double limitTriodeStep(double next, double previous, double maxStep) {
    double delta = next - previous;
    return std::abs(delta) <= maxStep
        ? next
        : previous + (delta > 0.0 ? 1.0 : -1.0) * maxStep;
}

inline double limitTriodeGridStep(double next, double previous) {
    return limitTriodeStep(next, previous, kTriodeGridStepVolts);
}

inline double limitJunction(
    double next,
    double previous,
    double thermalVoltage,
    double saturationCurrent,
    double seriesResistance = 0.0
) {
    double critical = thermalVoltage * std::log(thermalVoltage / (M_SQRT2 * saturationCurrent));
    if (seriesResistance > 1e-6 && previous > 0.0) {
        double criticalTerminal = critical + thermalVoltage / M_SQRT2;
        if (next > criticalTerminal && std::abs(next - previous) > 2.0 * thermalVoltage) {
            double iPrev = saturationCurrent * std::exp(std::min(previous / thermalVoltage, 40.0));
            double rJunction = thermalVoltage / std::max(1e-12, iPrev);
            double linearFrac = seriesResistance / (seriesResistance + rJunction);
            double step = next - previous;
            double junctionStep =
                1.0 + (step * (1.0 - linearFrac)) / thermalVoltage > 0.0
                    ? thermalVoltage * std::log(1.0 + (step * (1.0 - linearFrac)) / thermalVoltage)
                    : thermalVoltage * 2.0;
            return previous + junctionStep + step * linearFrac;
        }
    }
    if (next > critical && std::abs(next - previous) > 2.0 * thermalVoltage) {
        if (previous > 0.0) {
            double arg = 1.0 + (next - previous) / thermalVoltage;
            return arg > 0.0 ? previous + thermalVoltage * std::log(arg) : critical;
        }
        return critical;
    }
    // Damp a crossing into reverse only when the junction it left was actually conducting.
    // Mirrors `reference-runtime.ts`'s `limitJunction`; see its comment for the measurement --
    // `mxr-carbon-copy` reached here with `previous = 6.66e-16`, was moved 0.37 nanovolts, and
    // had the whole iterate flagged limited, which the convergence rule bars by construction.
    // One thermal voltage is the line because below it there is no forward excursion to walk
    // back. Both consoles must carry the same threshold or their iteration counts diverge.
    if (next < 0.0 && previous > thermalVoltage) {
        double arg = -1.0 + next / thermalVoltage;
        return arg < 0.0 ? -thermalVoltage * std::log(-arg) : -thermalVoltage;
    }
    return next;
}

inline double lambertW0(double z) {
    if (z <= 0.0) return 0.0;
    if (z < 1e-6) {
        return z * (1.0 - z);
    }
    double w;
    if (z < M_E) {
        w = (z * (1.0 + 1.2 * z)) / (1.0 + 2.2 * z + 0.8 * z * z);
    } else {
        double lnZ = std::log(z);
        double lnLnZ = std::log(lnZ);
        w = lnZ - lnLnZ + lnLnZ / lnZ;
    }
    for (int i = 0; i < 3; i++) {
        double eW = std::exp(w);
        double f = w * eW - z;
        double fp = eW * (w + 1.0);
        double fpp = eW * (w + 2.0);
        double delta = f / (fp - (f * fpp) / (2.0 * fp));
        w -= delta;
        if (std::abs(delta) < 1e-13 * (w + 1.0)) break;
    }
    return w;
}

inline double lambertW0FromLogZ(double logZ) {
    if (logZ < -15.0) {
        double z = std::exp(logZ);
        return z * (1.0 - z);
    }
    if (logZ < 1.0) {
        return lambertW0(std::exp(logZ));
    }
    double lnLnZ = std::log(logZ);
    double w = logZ - lnLnZ + lnLnZ / logZ;
    for (int i = 0; i < 3; i++) {
        double lnW = std::log(w);
        double g = w + lnW - logZ;
        double gp = 1.0 + 1.0 / w;
        double gpp = -1.0 / (w * w);
        double delta = g / (gp - (g * gpp) / (2.0 * gp));
        w -= delta;
        if (std::abs(delta) < 1e-13 * w) break;
    }
    return w;
}

inline double limitFetGate(double next, double previous, double threshold) {
    double highStep = std::abs(2.0 * (previous - threshold)) + 2.0;
    double lowStep = highStep / 2.0 + 2.0;
    double strongOn = threshold + 3.5;
    double delta = next - previous;

    if (previous >= threshold) {
        if (previous >= strongOn) {
            if (delta <= 0.0) {
                return next >= strongOn
                    ? (-delta > lowStep ? previous - lowStep : next)
                    : std::max(next, threshold + 2.0);
            }
            return delta >= highStep ? previous + highStep : next;
        }
        return delta <= 0.0
            ? std::max(next, threshold - 0.5)
            : std::min(next, threshold + 4.0);
    }
    if (delta <= 0.0) {
        return -delta > highStep ? previous - highStep : next;
    }
    double justOn = threshold + 0.5;
    return next <= justOn
        ? (delta > lowStep ? previous + lowStep : next)
        : justOn;
}

inline double limitFetDrain(double next, double previous) {
    if (previous >= 3.5) {
        return next > previous
            ? std::min(next, 3.0 * previous + 2.0)
            : (next < 3.5 ? std::max(next, 2.0) : next);
    }
    return next > previous ? std::min(next, 4.0) : std::max(next, -0.5);
}

inline double opAmpHalfSwing(double railHigh, double railLow) {
    return std::max((railHigh - railLow) / 2.0, 1e-9);
}

inline double opAmpPoleAlpha(double openLoopGain, double gainBandwidthHz, double dt, double sampleRate) {
    double poleHz = gainBandwidthHz / openLoopGain;
    if (sampleRate <= 0.0 || !std::isfinite(poleHz) || poleHz <= 0.0 || poleHz >= sampleRate / 2.0) {
        return 1.0;
    }
    double tau = 1.0 / (2.0 * M_PI * poleHz);
    return dt / (dt + tau);
}

// Anti-windup bound for the op-amp pole's raw state, in units of halfSwing.
// Matches the TypeScript runtime's `boundOpAmpRaw` and the deck emitter's B-source clamp.
// See `docs/troubleshootings/pole-state-makes-a-saturated-opamp-row-signal-independent.md`.
inline double boundOpAmpRaw(double raw, double halfSwing) {
    double limit = OPAMP_SATURATION_BAND * halfSwing;
    return std::min(limit, std::max(-limit, raw));
}

inline void stampConductance(double* matrix, int32_t size, int32_t a, int32_t b, double g) {
    matrix[a * size + a] += g;
    matrix[b * size + b] += g;
    matrix[a * size + b] -= g;
    matrix[b * size + a] -= g;
}

inline bool withinTolerance(const double* next, const double* prev, int32_t size) {
    for (int32_t i = 0; i < size; ++i) {
        double a = next[i];
        double b = prev[i];
        double allowance = NEWTON_RELATIVE_TOLERANCE * std::max(std::abs(a), std::abs(b)) + NEWTON_VOLTAGE_TOLERANCE;
        if (std::abs(a - b) > allowance) {
            return false;
        }
    }
    return true;
}

inline bool checkConvergenceAndMaxDelta(const double* next, const double* prev, int32_t size, double& maxDelta) {
    bool converged = true;
    double maxD = 0.0;
    for (int32_t i = 0; i < size; ++i) {
        double a = next[i];
        double b = prev[i];
        double diff = std::abs(a - b);
        if (diff > maxD) maxD = diff;
        double allowance = NEWTON_RELATIVE_TOLERANCE * std::max(std::abs(a), std::abs(b)) + NEWTON_VOLTAGE_TOLERANCE;
        if (diff > allowance) {
            converged = false;
        }
    }
    maxDelta = maxD;
    return converged;
}

inline int32_t worstDifferenceIndex(const double* next, const double* prev, int32_t size) {
    int32_t worstIdx = -1;
    double worstRatio = -1.0;
    for (int32_t i = 0; i < size; ++i) {
        double a = next[i];
        double b = prev[i];
        double allowance = NEWTON_RELATIVE_TOLERANCE * std::max(std::abs(a), std::abs(b)) + NEWTON_VOLTAGE_TOLERANCE;
        double ratio = std::abs(a - b) / allowance;
        if (ratio > worstRatio) {
            worstRatio = ratio;
            worstIdx = i;
        }
    }
    return worstIdx;
}

inline double maxAbsDifference(const double* a, const double* b, int32_t size) {
    double maxDiff = 0.0;
    for (int32_t i = 0; i < size; ++i) {
        maxDiff = std::max(maxDiff, std::abs(a[i] - b[i]));
    }
    return maxDiff;
}

inline void solveDense(double* matrix, double* rhs, int32_t size, int32_t* rowOrder, double* out) {
    for (int32_t i = 0; i < size; ++i) rowOrder[i] = i;

    for (int32_t col = 0; col < size; ++col) {
        int32_t pivot = col;
        double maxVal = std::abs(matrix[rowOrder[col] * size + col]);
        for (int32_t row = col + 1; row < size; ++row) {
            double v = std::abs(matrix[rowOrder[row] * size + col]);
            if (v > maxVal) {
                maxVal = v;
                pivot = row;
            }
        }
        if (maxVal < 1e-18) {
            continue;
        }
        if (pivot != col) {
            std::swap(rowOrder[col], rowOrder[pivot]);
            std::swap(rhs[col], rhs[pivot]);
        }
        int32_t pivotRow = rowOrder[col];
        double pivotValue = matrix[pivotRow * size + col];
        const double* __restrict pivotPtr = &matrix[pivotRow * size];
        for (int32_t row = col + 1; row < size; ++row) {
            int32_t currRow = rowOrder[row];
            double factor = matrix[currRow * size + col] / pivotValue;
            if (factor == 0.0) continue;
            double* __restrict currPtr = &matrix[currRow * size];
            for (int32_t inner = col; inner < size; ++inner) {
                currPtr[inner] -= factor * pivotPtr[inner];
            }
            rhs[row] -= factor * rhs[col];
        }
    }

    for (int32_t row = size - 1; row >= 0; --row) {
        int32_t currRow = rowOrder[row];
        double diag = matrix[currRow * size + row];
        if (std::abs(diag) < 1e-18) {
            out[row] = 0.0;
            continue;
        }
        double sum = rhs[row];
        const double* __restrict currPtr = &matrix[currRow * size];
        for (int32_t col = row + 1; col < size; ++col) {
            sum -= currPtr[col] * out[col];
        }
        out[row] = sum / diag;
    }
}

inline void factorLU(double* matrix, int32_t size, int32_t* permutation) {
    for (int32_t i = 0; i < size; ++i) permutation[i] = i;

    for (int32_t col = 0; col < size; ++col) {
        int32_t pivot = col;
        double maxVal = std::abs(matrix[col * size + col]);
        for (int32_t row = col + 1; row < size; ++row) {
            double v = std::abs(matrix[row * size + col]);
            if (v > maxVal) {
                maxVal = v;
                pivot = row;
            }
        }
        if (pivot != col) {
            for (int32_t k = 0; k < size; ++k) {
                std::swap(matrix[col * size + k], matrix[pivot * size + k]);
            }
            std::swap(permutation[col], permutation[pivot]);
        }
        double pivotValue = matrix[col * size + col];
        if (std::abs(pivotValue) < 1e-18) {
            continue;
        }
        for (int32_t row = col + 1; row < size; ++row) {
            double factor = matrix[row * size + col] / pivotValue;
            matrix[row * size + col] = factor;
            if (factor == 0.0) continue;
            for (int32_t inner = col + 1; inner < size; ++inner) {
                matrix[row * size + inner] -= factor * matrix[col * size + inner];
            }
        }
    }
}

inline void solveLU(const double* factored, int32_t size, const int32_t* permutation, const double* rhs, double* out) {
    for (int32_t i = 0; i < size; ++i) {
        out[i] = rhs[permutation[i]];
    }
    // Forward substitution
    for (int32_t i = 0; i < size; ++i) {
        double sum = out[i];
        for (int32_t col = 0; col < i; ++col) {
            sum -= factored[i * size + col] * out[col];
        }
        out[i] = sum;
    }
    // Back substitution
    for (int32_t i = size - 1; i >= 0; --i) {
        double sum = out[i];
        for (int32_t col = i + 1; col < size; ++col) {
            sum -= factored[i * size + col] * out[col];
        }
        double diag = factored[i * size + i];
        out[i] = (std::abs(diag) < 1e-18) ? 0.0 : sum / diag;
    }
}

inline bool runSparseSchedule(
    const SparseSchedule& schedule,
    const double* __restrict matrix,
    const double* __restrict rhs,
    double* __restrict values,
    double* __restrict scratchRhs,
    double* __restrict factors,
    double* __restrict out
) {
    int32_t slots = schedule.slots;
    int32_t size = schedule.size;
    const int32_t* __restrict offsets = schedule.gatherOffsets.data();

    int32_t i = 0;
    for (; i + 3 < slots; i += 4) {
        double v0 = matrix[offsets[i]];
        double v1 = matrix[offsets[i + 1]];
        double v2 = matrix[offsets[i + 2]];
        double v3 = matrix[offsets[i + 3]];
        values[i] = v0;
        values[i + 1] = v1;
        values[i + 2] = v2;
        values[i + 3] = v3;
    }
    for (; i < slots; ++i) {
        values[i] = matrix[offsets[i]];
    }
    std::memcpy(scratchRhs, rhs, size * sizeof(double));
    double accumulator = 0.0;
    const SparseOp* __restrict op = schedule.structuredOps.data();
    const SparseOp* __restrict opEnd = op + schedule.structuredOps.size();
    for (; op != opEnd; ++op) {
        switch (op->op) {
            case 1:
                values[op->a] -= factors[op->b] * values[op->c];
                break;
            case 0:
                factors[op->a] = values[op->b] / values[op->c];
                break;
            case 2:
                scratchRhs[op->a] -= factors[op->b] * scratchRhs[op->c];
                break;
            case 4:
                accumulator -= values[op->a] * out[op->b];
                break;
            case 3:
                accumulator = scratchRhs[op->a];
                break;
            case 5:
                out[op->a] = accumulator / values[op->b];
                break;
            case 6:
                if (__builtin_expect(std::abs(values[op->a]) < SCHEDULE_PIVOT_FLOOR, 0)) {
                    return false;
                }
                break;
            default:
                break;
        }
    }
    return true;
}

/**
 * The optocoupler emitter's junction, cited from `component-diode-chips.json`'s `LED-RED`
 * entry. Kept identical in `reference-runtime.ts` and `scripts/lib/source-to-spice.ts`.
 */
static constexpr double OPTO_LED_EMISSION_VOLTS = 2.0 * 0.025852;
static constexpr double OPTO_LED_SATURATION_AMPS = 7.6e-19;

inline void collectTouchedCells(const Block& block, int32_t size, const std::vector<int32_t>& stampIndices, std::vector<int32_t>& matrixOffsets, std::vector<int32_t>& rhsRows) {
    std::unordered_set<int32_t> matSet;
    std::unordered_set<int32_t> rhsSet;

    // Ground node equation row 0
    matSet.insert(0);
    for (int32_t c = 0; c < size; ++c) {
        matSet.insert(c);
    }
    rhsSet.insert(0);

    auto addMat = [&](int32_t r, int32_t c) {
        if (r >= 0 && r < size && c >= 0 && c < size) {
            matSet.insert(r * size + c);
        }
    };
    auto addRhs = [&](int32_t r) {
        if (r >= 0 && r < size) {
            rhsSet.insert(r);
        }
    };

    for (int32_t sIdx : stampIndices) {
        if (sIdx < 0 || sIdx >= static_cast<int32_t>(block.stamps.size())) continue;
        const auto& s = block.stamps[sIdx];
        switch (s.kind) {
            case StampKind::Diode:
                addMat(s.anode, s.anode); addMat(s.anode, s.cathode);
                addMat(s.cathode, s.anode); addMat(s.cathode, s.cathode);
                addRhs(s.anode); addRhs(s.cathode);
                break;
            case StampKind::Triode: {
                int32_t p = s.plate, k = s.cathode, g = s.grid;
                addMat(p, g); addMat(p, p); addMat(p, k);
                addMat(k, g); addMat(k, p); addMat(k, k);
                addMat(g, g); addMat(g, k);
                addRhs(p); addRhs(k); addRhs(g);
                break;
            }
            case StampKind::Pentode: {
                int32_t p = s.plate, k = s.cathode, g = s.grid, sc = s.screen;
                addMat(p, g); addMat(p, sc); addMat(p, p); addMat(p, k);
                addMat(k, g); addMat(k, sc); addMat(k, p); addMat(k, k);
                // The screen row, written by the `screenShare` source. A cell missing from this
                // set is never refreshed by the selective per-iterate copy, so it accumulates
                // across Newton iterations and the Jacobian goes stale -- the same defect the
                // Fet and Optocoupler cases above record having had.
                addMat(sc, g); addMat(sc, sc); addMat(sc, p); addMat(sc, k);
                addMat(g, g); addMat(g, k);
                addRhs(p); addRhs(k); addRhs(g); addRhs(sc);
                break;
            }
            case StampKind::TubeDiode:
                addMat(s.plate, s.plate); addMat(s.plate, s.cathode);
                addMat(s.cathode, s.plate); addMat(s.cathode, s.cathode);
                addRhs(s.plate); addRhs(s.cathode);
                break;
            case StampKind::Bjt: {
                int32_t b = s.base, c = s.collector, e = s.emitter;
                addMat(b, b); addMat(b, c); addMat(b, e);
                addMat(c, b); addMat(c, c); addMat(c, e);
                addMat(e, b); addMat(e, c); addMat(e, e);
                addRhs(b); addRhs(c); addRhs(e);
                break;
            }
            case StampKind::Fet: {
                int32_t g = s.gate, d = s.drain, src = s.source;
                addMat(d, g); addMat(d, d); addMat(d, src);
                addMat(src, g); addMat(src, d); addMat(src, src);
                addMat(g, g); addMat(g, src);
                // **(g,d), for the gate-DRAIN junction.** (d,g) and (d,d) are already here from the
                // channel terms and (g,g) from the gate-source junction, so this was the ONLY cell
                // the set was missing when the second junction landed -- and a cell missing from
                // this set is never refreshed by the selective per-iterate copy, so it accumulates
                // across Newton iterations and the Jacobian goes stale. That cost `boss-sd-1` every
                // sample of a render (48000 of 48000 at the 1024 cap) while the identical repair on
                // the TS runtime converged in 24, which is what localised it. Same defect the
                // Optocoupler case below already records having had.
                addMat(g, d);
                addRhs(d); addRhs(src); addRhs(g);
                break;
            }
            case StampKind::IdealOpAmp: {
                int32_t row = block.nodeCount + s.sourceIndex;
                addMat(s.output, row); addMat(row, s.output);
                addMat(row, s.plus); addMat(row, s.minus);
                addMat(row, row);
                addRhs(row);
                break;
            }
            case StampKind::Ota: {
                int32_t p = s.plus, m = s.minus, out = s.output, bias = s.bias, vee = s.vee;
                addMat(bias, bias); addMat(bias, vee);
                addMat(vee, bias); addMat(vee, vee);
                addMat(out, p); addMat(out, m); addMat(out, bias); addMat(out, vee);
                addRhs(bias); addRhs(vee); addRhs(out);
                break;
            }
            case StampKind::LinearVca: {
                // Voltage-sense control: the output row reads plus, minus and
                // control, but NO row reads back onto control (it draws no
                // current). Mirrors reference-runtime.ts `case "linear-vca"`.
                addMat(s.output, s.plus); addMat(s.output, s.minus);
                addMat(s.output, s.controlNode);
                addRhs(s.output);
                break;
            }
            case StampKind::LogicDivider: {
                int32_t row = block.nodeCount + s.sourceIndex;
                addMat(row, s.qNode); addMat(s.qNode, row);
                addMat(row, s.gndNode); addMat(s.gndNode, row);
                addMat(row, row);
                addRhs(row);
                break;
            }
            case StampKind::Optocoupler: {
                // The LED half, which this pattern used to omit while the stamp wrote it. The
                // set drives a selective per-iterate matrix copy, so an entry missing from it
                // is never refreshed between Newton iterations. Never caught because no packet
                // in `test-v2-wasm-parity.ts` carries an optocoupler.
                addMat(s.ledAnode, s.ledAnode); addMat(s.ledAnode, s.ledCathode);
                addMat(s.ledCathode, s.ledAnode); addMat(s.ledCathode, s.ledCathode);
                addRhs(s.ledAnode); addRhs(s.ledCathode);
                addMat(s.ldrA, s.ldrA); addMat(s.ldrA, s.ldrB);
                addMat(s.ldrB, s.ldrA); addMat(s.ldrB, s.ldrB);
                addRhs(s.ldrA); addRhs(s.ldrB);
                break;
            }
            case StampKind::Capacitor:
            case StampKind::Conductance:
            case StampKind::ControlledConductance:
            case StampKind::ControlledResistance:
            case StampKind::Switch: {
                addMat(s.a, s.a); addMat(s.a, s.b);
                addMat(s.b, s.a); addMat(s.b, s.b);
                addRhs(s.a); addRhs(s.b);
                break;
            }
            case StampKind::Selector: {
                int32_t common = s.common;
                if (s.throwNode != -1) {
                    addMat(common, common); addMat(common, s.throwNode);
                    addMat(s.throwNode, common); addMat(s.throwNode, s.throwNode);
                    addRhs(common); addRhs(s.throwNode);
                }
                for (int32_t t : s.throwsList) {
                    addMat(common, common); addMat(common, t);
                    addMat(t, common); addMat(t, t);
                    addRhs(common); addRhs(t);
                }
                break;
            }
            case StampKind::Inductor: {
                addMat(s.a, s.a); addMat(s.a, s.b);
                addMat(s.b, s.a); addMat(s.b, s.b);
                addRhs(s.a); addRhs(s.b);
                break;
            }
            case StampKind::DcSource:
            case StampKind::AcSource: {
                int32_t row = block.nodeCount + s.sourceIndex;
                addMat(s.positive, row); addMat(row, s.positive);
                addMat(s.negative, row); addMat(row, s.negative);
                addMat(row, row);
                addRhs(row);
                break;
            }
            case StampKind::InputSource: {
                int32_t row = block.nodeCount + s.sourceIndex;
                int32_t node = (s.node != -1) ? s.node : ((s.input != -1) ? s.input : ((s.plus != -1) ? s.plus : s.positive));
                addMat(node, row); addMat(row, node);
                addMat(row, row);
                addRhs(row);
                break;
            }
            case StampKind::MacroAudioSource: {
                int32_t row = block.nodeCount + s.sourceIndex;
                addMat(s.node, row); addMat(row, s.node);
                addMat(row, row);
                addRhs(row);
                break;
            }
            case StampKind::AnalogSwitch: {
                addMat(s.a, s.a); addMat(s.a, s.b); addMat(s.a, s.controlNode);
                addMat(s.b, s.a); addMat(s.b, s.b); addMat(s.b, s.controlNode);
                addRhs(s.a); addRhs(s.b);
                break;
            }
            case StampKind::Vccs: {
                if (s.outP != 0) {
                    addMat(s.outP, s.inP); addMat(s.outP, s.inN);
                    addRhs(s.outP);
                }
                if (s.outN != 0) {
                    addMat(s.outN, s.inP); addMat(s.outN, s.inN);
                    addRhs(s.outN);
                }
                break;
            }
            case StampKind::Compandor: {
                addMat(s.sumNode, s.cellIn); addMat(s.sumNode, s.vref);
                addRhs(s.rectCap);
                break;
            }
            case StampKind::ClockDriver: {
                int32_t row1 = block.nodeCount + s.sourceIndex;
                int32_t row2 = block.nodeCount + s.sourceIndex + 1;
                int32_t row3 = block.nodeCount + s.sourceIndex + 2;
                // Both supply pins on every row: the phase alternates which one it couples to,
                // so a pattern holding only the current pin drops the other on the next flip.
                // Mirrors `sparse-schedule.ts`; the optocoupler shipped with this omission.
                addMat(row1, s.cp1); addMat(s.cp1, row1); addMat(row1, s.vdd); addMat(row1, row1);
                addMat(row2, s.cp2); addMat(s.cp2, row2); addMat(row2, s.vdd); addMat(row2, row2);
                addMat(row3, s.vgg); addMat(s.vgg, row3); addMat(row3, s.vdd); addMat(row3, row3);
                if (s.gnd > 0) { addMat(row1, s.gnd); addMat(row2, s.gnd); addMat(row3, s.gnd); }
                addRhs(row1); addRhs(row2); addRhs(row3);
                break;
            }
            case StampKind::Comparator: {
                addMat(s.output, s.output); addMat(s.output, s.vee);
                addMat(s.vee, s.output); addMat(s.vee, s.vee);
                addMat(s.output, s.plus); addMat(s.output, s.minus);
                // The control term's current leaves `output` and enters `vee`, so the
                // `vee` row carries it too.
                addMat(s.vee, s.plus); addMat(s.vee, s.minus);
                addRhs(s.output); addRhs(s.vee);
                break;
            }
            case StampKind::Transformer: {
                int32_t row = block.nodeCount + s.sourceIndex;
                addMat(row, s.primaryPlus); addMat(s.primaryPlus, row);
                addMat(row, s.primaryMinus); addMat(s.primaryMinus, row);
                addMat(row, s.secondaryPlus); addMat(s.secondaryPlus, row);
                addMat(row, s.secondaryMinus); addMat(s.secondaryMinus, row);
                addRhs(row);
                break;
            }
            case StampKind::SpringReverb: {
                addMat(s.inputPlus, s.inputPlus); addMat(s.inputMinus, s.inputMinus);
                addMat(s.inputPlus, s.inputMinus); addMat(s.inputMinus, s.inputPlus);
                int32_t row = block.nodeCount + s.sourceIndex;
                addMat(row, s.outputPlus); addMat(s.outputPlus, row);
                addMat(row, s.outputMinus); addMat(s.outputMinus, row);
                addMat(row, row);
                addRhs(row);
                break;
            }
            default:
                break;
        }
    }

    matrixOffsets.assign(matSet.begin(), matSet.end());
    std::sort(matrixOffsets.begin(), matrixOffsets.end());
    rhsRows.assign(rhsSet.begin(), rhsSet.end());
    std::sort(rhsRows.begin(), rhsRows.end());
}

} // namespace

Engine::Engine() = default;
Engine::~Engine() = default;

bool Engine::loadProgramJson(std::string_view json, std::string* error) {
    // Parse failures refuse by name through the same channel as every other
    // load refusal: an exception escaping here would cross the C boundary
    // as an abort rather than a named load error (board-p3 row 4 schedules
    // the first producer of a third block kind).
    ProgramLoadResult res;
    try {
        res = parseProgramJson(json);
    } catch (const std::exception& e) {
        if (error) *error = e.what();
        return false;
    }
    if (!res.ok) {
        if (error) *error = res.error;
        return false;
    }
    return loadProgram(std::move(res.program), error);
}

bool Engine::loadProgram(Program program, std::string* error) {
    std::vector<std::string> missingOps;
    for (const auto& op : program.requiredOperators) {
        if (SUPPORTED_OPERATORS.find(op) == SUPPORTED_OPERATORS.end()) {
            missingOps.push_back(op);
        }
    }
    if (!missingOps.empty()) {
        if (error) {
            std::string msg = "unimplemented operators: ";
            for (size_t i = 0; i < missingOps.size(); ++i) {
                if (i > 0) msg += ", ";
                msg += missingOps[i];
            }
            *error = msg;
        }
        return false;
    }

    std::vector<std::string> missingModels;
    for (const auto& model : program.requiredModels) {
        if (SUPPORTED_MODELS.find(model) == SUPPORTED_MODELS.end()) {
            missingModels.push_back(model);
        }
    }
    if (!missingModels.empty()) {
        if (error) {
            std::string msg = "unimplemented models: ";
            for (size_t i = 0; i < missingModels.size(); ++i) {
                if (i > 0) msg += ", ";
                msg += missingModels[i];
            }
            *error = msg;
        }
        return false;
    }

    for (const auto& block : program.blocks) {
        for (const auto& stamp : block.stamps) {
            if (stamp.kind == StampKind::Unknown) {
                if (error) {
                    *error = "unimplemented stamp kind: " + stamp.kindStr;
                }
                return false;
            }
        }
    }

    program_ = std::move(program);
    blockIndexById_.clear();
    controlPositions_.clear();

    for (size_t i = 0; i < program_.blocks.size(); ++i) {
        blockIndexById_[program_.blocks[i].id] = i;
    }

    for (const auto& ctrl : program_.controls) {
        controlPositions_[ctrl.id] = ctrl.defaultPosition;
    }

    prepared_ = false;
    return true;
}

void Engine::prepare(const EngineOptions& options) {
    options_ = options;
    prepared_ = true;
    elapsedSamples_ = 0;
    // A tap timed against the previous clock would read a meaningless interval.
    tapState_.clear();
    lastComposedPosition_.clear();
    // A latch is firmware state and powers up where its declaration says; a knob keeps its place.
    for (const auto& ctrl : program_.controls) {
        if (!ctrl.latchToggledBy.empty()) setControl(ctrl.id, ctrl.defaultPosition);
    }
    timeSeconds_ = 0.0;
    controlGeneration_ = 1;
    scheduleSolves_ = 0;
    scheduleFallbacks_ = 0;

    macroOutputVolts_.clear();
    reverbStates_.clear();
    opampHistory_.clear();
    opampRawState_.clear();
    diodeHistory_.clear();
    bjtHistory_.clear();
    triodeHistory_.clear();
    fetHistory_.clear();
    springStates_.clear();
    springOutputVolts_.clear();
    bbdBuffers_.clear();
    lastShiftedSample_.clear();

    controlIndexByName_.clear();
    controlValues_.clear();
    for (const auto& [ctrlId, val] : controlPositions_) {
        int32_t idx = static_cast<int32_t>(controlValues_.size());
        controlIndexByName_[ctrlId] = idx;
        controlValues_.push_back(val);
    }

    for (auto& block : program_.blocks) {
        for (auto& stamp : block.stamps) {
            if (!stamp.control.empty()) {
                auto it = controlIndexByName_.find(stamp.control);
                if (it != controlIndexByName_.end()) {
                    stamp.controlIndex = it->second;
                } else {
                    int32_t idx = static_cast<int32_t>(controlValues_.size());
                    controlIndexByName_[stamp.control] = idx;
                    controlValues_.push_back(getControl(stamp.control));
                    stamp.controlIndex = idx;
                }
            }
        }
    }

    orderedBlockIndices_.clear();
    for (const auto& blockId : program_.order) {
        auto it = blockIndexById_.find(blockId);
        if (it != blockIndexById_.end()) {
            orderedBlockIndices_.push_back(it->second);
        }
    }

    size_t numBlocks = program_.blocks.size();
    blockScratch_.resize(numBlocks);
    blockStates_.resize(numBlocks);
    blockOperatingPoints_.resize(numBlocks);

    for (size_t bIdx = 0; bIdx < numBlocks; ++bIdx) {
        const auto& block = program_.blocks[bIdx];
        auto& scratch = blockScratch_[bIdx];


        if (block.kind == BlockKind::Composed) {
            // Delay capacities are times, converted here where the rate
            // lives; a clock control sizes for the longest delay the knob
            // can ask for, and a modulation port takes its scale ceiling as
            // headroom -- the same three rules as the macro branch above.
            // **Every position's state is allocated here, not on the switch.** A mode
            // change is an index change on the audio thread, so it must not touch the
            // heap; the cost is holding one set of buffers per program, which is the
            // right trade for a chip with a handful of them.
            {
                std::vector<std::string> keys;
                keys.reserve(block.positions.size());
                for (size_t k = 0; k < block.positions.size(); ++k) {
                    keys.push_back(composedStateKey(block.id, k));
                }
                composedStateKeys_[block.id] = std::move(keys);
            }
            for (size_t posIdx = 0; posIdx < block.positions.size(); ++posIdx) {
            const auto& position = block.positions[posIdx];
            const std::string& stateKey = composedStateKeys_[block.id][posIdx];
            std::unordered_map<std::string, ComposedLine> lines;
            for (const auto& [lineId, delaySeconds] : position.lineDelaySeconds) {
                double maxDelaySeconds = delaySeconds;
                double initialDelaySeconds = maxDelaySeconds;
                if (block.clockControl.has_value()) {
                    const auto& cc = *block.clockControl;
                    double maxR = std::max(cc.ohmsAtControlMin, cc.ohmsAtControlMax);
                    double maxClockDelay = cc.offsetSeconds + cc.stages * cc.formulaConstant * maxR * cc.farads;
                    maxDelaySeconds = std::max(maxDelaySeconds, maxClockDelay);

                    double pos = getControl(cc.controlId);
                    double frac = taperFraction(cc.taper, pos);
                    double r = cc.ohmsAtControlMin + frac * (cc.ohmsAtControlMax - cc.ohmsAtControlMin);
                    initialDelaySeconds = cc.offsetSeconds + cc.stages * cc.formulaConstant * r * cc.farads;
                }
                if (block.modulation.has_value()) {
                    maxDelaySeconds *= kModulationScaleMax;
                }
                // The `clock-law` port sweeps an absolute law over a similar
                // span, so it shares the bound: what makes the ring buffer's
                // size decidable is the declared base times two.
                if (block.clockLaw.has_value()) {
                    maxDelaySeconds *= kModulationScaleMax;
                }
                int32_t capacity = std::max(2, static_cast<int32_t>(std::ceil(maxDelaySeconds * options_.sampleRate)) + 2);
                double initialSamples = std::max(0.0, initialDelaySeconds * options_.sampleRate);
                // A reverse head at phase p reads 2p + 1 back, so its line holds two segments.
                bool reversed = false;
                for (const auto& op : position.ops) {
                    if (op.op == PrimitiveOp::Op::DelayTapReverse && op.line == lineId) reversed = true;
                }
                int32_t bufferCapacity = reversed ? 2 * capacity : capacity;
                ComposedLine line;
                line.buffer.assign(bufferCapacity, 0.0);
                line.writeIndex = 0;
                line.capacity = bufferCapacity;
                line.lengthCapacity = capacity;
                auto floorIt = position.lineMinSeconds.find(lineId);
                line.floorSamples = floorIt == position.lineMinSeconds.end()
                    ? 0.0
                    : std::max(0.0, floorIt->second * options_.sampleRate);
                auto sweepIt = position.lineSweep.find(lineId);
                if (sweepIt != position.lineSweep.end()) {
                    line.hasSweep = true;
                    line.sweepTapped = sweepIt->second.tapped;
                    line.sweepRatio = sweepIt->second.ratio;
                    line.sweepControl = sweepIt->second.controlId;
                }
                line.targetLengthSamples = initialSamples;
                line.currentLengthSamples = initialSamples;
                lines.emplace(lineId, std::move(line));
            }
            composedLines_[stateKey] = std::move(lines);
            ComposedFilter filters;
                for (const auto& op : position.ops) {
                    if (op.op == PrimitiveOp::Op::Comb) {
                        constexpr int32_t numCombs = static_cast<int32_t>(sizeof(REVERB_COMB_SECONDS) / sizeof(REVERB_COMB_SECONDS[0]));
                        if (op.index < 0 || op.index >= numCombs) {
                            throw std::runtime_error("composed block \"" + block.id + "\" names comb " + std::to_string(op.index) + " outside the interpreter's table");
                        }
                    double seconds = REVERB_COMB_SECONDS[op.index];
                    int32_t len = std::max(1, static_cast<int32_t>(std::round(seconds * options_.sampleRate)));
                    ComposedComb comb;
                    comb.buffer.assign(len, 0.0);
                    comb.index = 0;
                    comb.gain = reverbCombGain(seconds, op.decaySeconds);
                    filters.combs.push_back(std::move(comb));
                    } else if (op.op == PrimitiveOp::Op::Allpass) {
                        constexpr int32_t numAllpass = static_cast<int32_t>(sizeof(REVERB_ALLPASS_SECONDS) / sizeof(REVERB_ALLPASS_SECONDS[0]));
                        if (op.index < 0 || op.index >= numAllpass) {
                            throw std::runtime_error("composed block \"" + block.id + "\" names allpass " + std::to_string(op.index) + " outside the interpreter's table");
                        }
                    double seconds = REVERB_ALLPASS_SECONDS[op.index];
                    int32_t len = std::max(1, static_cast<int32_t>(std::round(seconds * options_.sampleRate)));
                    ComposedAllpass ap;
                    ap.buffer.assign(len, 0.0);
                    ap.index = 0;
                    filters.allpasses.push_back(std::move(ap));
                }
            }
            composedFilters_[stateKey] = std::move(filters);
            std::unordered_map<int32_t, ComposedPitch> pitch;
            int32_t opPosition = 0;
            for (const auto& op : position.ops) {
                if (op.op == PrimitiveOp::Op::PitchShift) {
                    if (!std::isfinite(op.ratio) || op.ratio <= 0.0) {
                        throw std::runtime_error("composed block \"" + block.id + "\" carries a pitch-shift ratio that is not finite and positive");
                    }
                    ComposedPitch ps;
                    ps.buffer.assign(PITCH_HISTORY, 0.0);
                    ps.writeAbs = 0;
                    ps.readAbs = 0.0;
                    ps.ratio = op.ratio;
                    pitch.emplace(opPosition, std::move(ps));
                }
                opPosition += 1;
            }
            composedPitch_[stateKey] = std::move(pitch);
            std::unordered_map<int32_t, ComposedTracker> trackers;
            int32_t trackerPosition = 0;
            for (const auto& op : position.ops) {
                if (op.op == PrimitiveOp::Op::PitchTracker) {
                    ComposedTracker tr;
                    tr.buffer.assign(TRACK_WINDOW, 0.0);
                    tr.writeAbs = 0;
                    tr.sinceUpdate = TRACK_HOP;
                    tr.estimate = 0.0;
                    trackers.emplace(trackerPosition, std::move(tr));
                }
                trackerPosition += 1;
            }
            composedTracker_[stateKey] = std::move(trackers);
            }
            // DC state is per block rather than per position: it estimates the offset of
            // the block's own input tap, which every program shares because they share
            // the pin.
            composedDc_[block.id] = ComposedDc{};
            macroOutputVolts_[block.id] = 0.0;
            continue;
        }

        scratch.nodeCount = block.nodeCount;
        scratch.auxCount = block.auxCount;
        scratch.stateCount = block.stateCount;
        scratch.size = block.nodeCount + block.auxCount;
        scratch.linear = block.linear;
        scratch.controlFree = block.controlFree;
        scratch.eliminate = block.eliminate;

        int32_t size = scratch.size;
        scratch.solutionA.assign(size, 0.0);
        scratch.solutionB.assign(size, 0.0);
        scratch.matrix.assign(size * size, 0.0);
        scratch.rhs.assign(size, 0.0);
        scratch.denseRowOrder.assign(size, 0);

        scratch.diodeHistory.assign(block.stamps.size(), 0.0);
        scratch.bjtHistory.assign(block.stamps.size(), {0.0, 0.0});
        scratch.triodeHistory.assign(block.stamps.size(), TriodeHistory{});
        scratch.opampHistory.assign(block.stamps.size(), OpAmpHistory{});
        scratch.opampRawState.assign(block.stamps.size(), 0.0);
        scratch.fetHistory.assign(block.stamps.size(), FetHistory{});

        blockStates_[bIdx].assign(block.stateCount, 0.0);
        blockOperatingPoints_[bIdx].assign(size, 0.0);

        // Constant stamp folding (Phase 2b)
        const auto& sp = block.stampPartition;
        std::vector<bool> isConstant(block.stamps.size(), false);
        for (int32_t cIdx : sp.constantStampIndices) {
            if (cIdx >= 0 && static_cast<size_t>(cIdx) < block.stamps.size()) {
                isConstant[cIdx] = true;
            }
        }

        scratch.nonConstantStampIndices.clear();
        for (size_t sIdx = 0; sIdx < block.stamps.size(); ++sIdx) {
            if (!isConstant[sIdx]) {
                scratch.nonConstantStampIndices.push_back(static_cast<int32_t>(sIdx));
            }
        }

        scratch.nonConstantLinearStampIndices.clear();
        if (!sp.linearStampIndices.empty()) {
            for (int32_t lIdx : sp.linearStampIndices) {
                if (lIdx >= 0 && static_cast<size_t>(lIdx) < block.stamps.size() && !isConstant[lIdx]) {
                    scratch.nonConstantLinearStampIndices.push_back(lIdx);
                }
            }
        } else if (block.linear) {
            for (size_t sIdx = 0; sIdx < block.stamps.size(); ++sIdx) {
                if (!isConstant[sIdx]) {
                    scratch.nonConstantLinearStampIndices.push_back(static_cast<int32_t>(sIdx));
                }
            }
        }

        scratch.baseMatrix.assign(size * size, 0.0);
        scratch.baseRhs.assign(size, 0.0);

        std::vector<double> emptyState(block.stateCount * 2 + 16, 0.0);
        std::vector<double> emptySolution(size, 0.0);
        double dt = 1.0 / options_.sampleRate;

        for (int32_t cIdx : sp.constantStampIndices) {
            if (cIdx >= 0 && static_cast<size_t>(cIdx) < block.stamps.size()) {
                applyStamp(
                    block.stamps[cIdx],
                    scratch.baseMatrix.data(),
                    scratch.baseRhs.data(),
                    size,
                    block,
                    dt,
                    emptyState,
                    emptySolution.data(),
                    0.0,
                    false,
                    1.0,
                    static_cast<int32_t>(bIdx)
                );
            }
        }

        for (int32_t node = 1; node < block.nodeCount; ++node) {
            scratch.baseMatrix[node * size + node] += GMIN_SIEMENS;
        }

        for (int32_t col = 0; col < size; ++col) {
            scratch.baseMatrix[0 * size + col] = 0.0;
        }
        scratch.baseMatrix[0] = 1.0;
        scratch.baseRhs[0] = 0.0;

        scratch.controlStampIndices.clear();
        for (int32_t cIdx : sp.controlStampIndices) {
            if (cIdx >= 0 && static_cast<size_t>(cIdx) < block.stamps.size()) {
                scratch.controlStampIndices.push_back(cIdx);
            }
        }

        scratch.dynamicStampIndices.clear();
        for (int32_t dIdx : sp.dynamicStampIndices) {
            if (dIdx >= 0 && static_cast<size_t>(dIdx) < block.stamps.size()) {
                scratch.dynamicStampIndices.push_back(dIdx);
            }
        }

        scratch.sampleLinearStampIndices.clear();
        for (int32_t lIdx : scratch.nonConstantLinearStampIndices) {
            bool isCtrl = false;
            for (int32_t cIdx : scratch.controlStampIndices) {
                if (cIdx == lIdx) {
                    isCtrl = true;
                    break;
                }
            }
            if (!isCtrl) {
                scratch.sampleLinearStampIndices.push_back(lIdx);
            }
        }

        scratch.nonlinearStampIndices.clear();
        for (int32_t nlIdx : sp.nonlinearStampIndices) {
            if (nlIdx >= 0 && static_cast<size_t>(nlIdx) < block.stamps.size()) {
                scratch.nonlinearStampIndices.push_back(nlIdx);
            }
        }

        scratch.statefulStampIndices.clear();
        for (size_t sIdx = 0; sIdx < block.stamps.size(); ++sIdx) {
            const auto& stamp = block.stamps[sIdx];
            if (stamp.kind == StampKind::Capacitor ||
                stamp.kind == StampKind::Inductor ||
                (stamp.kind == StampKind::IdealOpAmp && stamp.railHigh.has_value() && stamp.railLow.has_value()) ||
                stamp.kind == StampKind::SpringReverb) {
                scratch.statefulStampIndices.push_back(static_cast<int32_t>(sIdx));
            }
        }

        collectTouchedCells(block, size, scratch.nonConstantStampIndices, scratch.touchedMatrixOffsets, scratch.touchedRhsRows);
        collectTouchedCells(block, size, scratch.nonlinearStampIndices, scratch.touchedNonlinearMatrixOffsets, scratch.touchedNonlinearRhsRows);
        // The per-sample linear stamps are the capacitor and inductor companions, whose values
        // change every sample while the rest of the matrix does not. Registering their cells lets
        // the per-sample assembly refresh those alone.
        collectTouchedCells(block, size, scratch.sampleLinearStampIndices, scratch.touchedSampleMatrixOffsets, scratch.touchedSampleRhsRows);
        scratch.matrix = scratch.baseMatrix;
        scratch.rhs = scratch.baseRhs;
        scratch.controlMatrix = scratch.baseMatrix;
        scratch.controlRhs = scratch.baseRhs;
        scratch.sampleMatrix = scratch.baseMatrix;
        scratch.sampleRhs = scratch.baseRhs;
        scratch.cachedControlGen = 0;

        if (block.sparseSchedule.has_value()) {
            const auto& ss = *block.sparseSchedule;
            scratch.repivotedSchedule.reset();
            double cost = static_cast<double>(ss.sparseOps + ss.slots + size);
            double saving = static_cast<double>(ss.denseOps) / std::max(cost, 1.0);
            if (saving >= 4.0) {
                scratch.sparseValues.assign(ss.slots, 0.0);
                scratch.sparseScratchRhs.assign(ss.size, 0.0);
                scratch.sparseFactors.assign(ss.factorCount, 0.0);
                scratch.consecutiveFallbacks = 0;
                scratch.repivotAttempted = false;
                scratch.sparseAbandoned = false;
                scratch.sparseDropped = false;
                scratch.scheduleAdmitted = true;
                scratch.generatedKernel = findGeneratedKernel(ss);
            } else {
                scratch.sparseAbandoned = true;
                scratch.scheduleAdmitted = false;
                scratch.generatedKernel = nullptr;
            }
        }
        scratch.canUseSelectiveMatrixCopy = (block.sparseSchedule.has_value() && !scratch.sparseAbandoned);

        if (scratch.eliminate) {
            const auto& sp = block.stampPartition;
            scratch.portRows = sp.portRows;
            scratch.portCount = static_cast<int32_t>(sp.portRows.size());
            scratch.linearStampIndices = sp.linearStampIndices;
            scratch.nonlinearStampIndices = sp.nonlinearStampIndices;
            if (scratch.linearStampIndices.empty() && block.linear) {
                for (size_t sIdx = 0; sIdx < block.stamps.size(); ++sIdx) {
                    scratch.linearStampIndices.push_back(static_cast<int32_t>(sIdx));
                }
            }

            std::vector<bool> isPort(size, false);
            for (int32_t pr : sp.portRows) {
                if (pr >= 0 && pr < size) isPort[pr] = true;
            }

            scratch.lRows.clear();
            scratch.portIndexOf.assign(size, -1);
            scratch.lIndexOf.assign(size, -1);

            for (int32_t i = 0; i < scratch.portCount; ++i) {
                scratch.portIndexOf[sp.portRows[i]] = i;
            }
            for (int32_t r = 0; r < size; ++r) {
                if (!isPort[r]) {
                    scratch.lIndexOf[r] = static_cast<int32_t>(scratch.lRows.size());
                    scratch.lRows.push_back(r);
                }
            }
            scratch.lCount = static_cast<int32_t>(scratch.lRows.size());

            int32_t pCount = scratch.portCount;
            int32_t lCount = scratch.lCount;

            scratch.linearMatrix.assign(size * size, 0.0);
            scratch.linearRhs.assign(size, 0.0);
            scratch.llMatrix.assign(lCount * lCount, 0.0);
            scratch.permutation.assign(lCount, 0);
            scratch.zMatrix.assign(pCount * lCount, 0.0);
            scratch.zRhsScratch.assign(lCount, 0.0);
            scratch.z0.assign(lCount, 0.0);
            scratch.z0Rhs.assign(lCount, 0.0);
            scratch.kReduced.assign(pCount * pCount, 0.0);
            scratch.uReduced.assign(pCount, 0.0);
            scratch.yCurrent.assign(pCount, 0.0);
            scratch.yNext.assign(pCount, 0.0);
            scratch.fullCurrent.assign(size, 0.0);
            scratch.fullNext.assign(size, 0.0);
            scratch.rawNl.assign(size * size, 0.0);
            scratch.rawNlRhs.assign(size, 0.0);
            scratch.reducedJacobian.assign(pCount * pCount, 0.0);
            scratch.reducedRhs.assign(pCount, 0.0);
            scratch.cachedControlGeneration = -1;
        }
    }

    solveOperatingPoint();
    settlePivotOrders();

    for (size_t bIdx = 0; bIdx < program_.blocks.size(); ++bIdx) {
        auto& scratch = blockScratch_[bIdx];
        scratch.matrix = scratch.baseMatrix;
        scratch.rhs = scratch.baseRhs;
    }
}

int32_t Engine::abandonedScheduleBlocks() const {
    int32_t count = 0;
    for (const auto& scratch : blockScratch_) {
        if (scratch.scheduleAdmitted && scratch.sparseAbandoned && !scratch.sparseDropped) {
            count++;
        }
    }
    return count;
}

int32_t Engine::droppedScheduleBlocks() const {
    int32_t count = 0;
    for (const auto& scratch : blockScratch_) {
        if (scratch.scheduleAdmitted && scratch.sparseDropped) {
            count++;
        }
    }
    return count;
}

// Validates each admitted block's shipped elimination order against the
// assembled operating-point matrix and drops collapsing orders to the dense
/**
 * The mid-run half of the pivot-guard contract: at the consecutive-trip
 * limit, re-pivot once from the current matrix instead of abandoning.
 * Mirrors `ReferenceRuntime.adoptMidRunRepivot` -- same inputs (stamped
 * matrix and rhs snapshotted before the dense fallback, plus the fallback's
 * answer), same rescue bar, same once-per-order semantics. Returns whether a
 * value-aware order was adopted; a refusal leaves the caller to abandon
 * exactly as before.
 */
bool Engine::adoptMidRunRepivot(
    size_t blockIdx,
    const std::vector<double>& matrix,
    const std::vector<double>& rhs,
    const double* denseAnswer,
    int32_t size
) {
    const auto& block = program_.blocks[blockIdx];
    if (block.kind != BlockKind::Mna || size <= 0 || !block.sparseSchedule.has_value()) {
        return false;
    }
    const SparseSchedule& active = blockScratch_[blockIdx].repivotedSchedule.has_value()
        ? *blockScratch_[blockIdx].repivotedSchedule
        : *block.sparseSchedule;
    std::optional<SparseSchedule> candidate =
        computeNumericRepivot(active, size, matrix, NUMERIC_REPIVOT_TAU);
    if (!candidate.has_value()) {
        return false;
    }
    std::vector<double> values(static_cast<size_t>(candidate->slots), 0.0);
    std::vector<double> scratchRhs(static_cast<size_t>(size), 0.0);
    std::vector<double> factors(static_cast<size_t>(candidate->factorCount), 0.0);
    std::vector<double> out(static_cast<size_t>(size), 0.0);
    const bool replayed = runSparseSchedule(
        *candidate, matrix.data(), rhs.data(),
        values.data(), scratchRhs.data(), factors.data(), out.data());
    double diffSquares = 0.0;
    double denseSquares = 0.0;
    for (int32_t i = 0; i < size; ++i) {
        const double difference = out[static_cast<size_t>(i)] - denseAnswer[i];
        diffSquares += difference * difference;
        denseSquares += denseAnswer[i] * denseAnswer[i];
    }
    const double disagreement = replayed
        ? std::sqrt(diffSquares) / std::max(std::sqrt(denseSquares), 1e-9)
        : std::numeric_limits<double>::infinity();
    if (!(disagreement <= SCHEDULE_VALIDATION_TOL)) {
        return false;
    }
    adoptRepivotedSchedule(blockIdx, std::move(*candidate));
    // The one attempt is spent: a second limit-hit on the adopted order
    // abandons rather than re-pivoting again.
    blockScratch_[blockIdx].repivotAttempted = true;
    return true;
}

void Engine::adoptRepivotedSchedule(size_t blockIdx, SparseSchedule candidate) {    auto& scratch = blockScratch_[blockIdx];
    int32_t size = scratch.size;
    scratch.sparseValues.assign(static_cast<size_t>(candidate.slots), 0.0);
    scratch.sparseScratchRhs.assign(static_cast<size_t>(size), 0.0);
    scratch.sparseFactors.assign(static_cast<size_t>(candidate.factorCount), 0.0);
    scratch.repivotedSchedule = std::move(candidate);
    scratch.sparseAbandoned = false;
    scratch.sparseDropped = false;
    scratch.consecutiveFallbacks = 0;
    scratch.repivotAttempted = false;
    // The generated table is keyed to the compiler's schedule; a
    // re-pivoted order is not in it, so this block runs the
    // interpreter. That is still the sparse path, not dense.
    scratch.generatedKernel = nullptr;
    scratch.canUseSelectiveMatrixCopy = true;
    repivotedScheduleBlocks_ += 1;
}

// solve. This is `ReferenceRuntime.settlePivotOrders` in C++; the tolerance,
// the comparison metric and the drop semantics are identical by construction,
// so the two consoles keep agreeing on which blocks run sparsely.
//
// The shipped order was chosen from the stamp pattern alone, where every node
// diagonal reads as a pivot candidate because both consoles add `gmin` to it.
// Replaying a `1e-12` pivot against entries of order `1e2` is what makes the
// sparse and dense solves disagree (row 6: `boss-aw-2` never converges
// sparsely, in four iterations densely). Both solves run on the same assembled
// matrix here and their answers are compared; per-pivot ratios do not gate
// anything because they do not separate healthy blocks from broken ones.
void Engine::settlePivotOrders() {
    double dt = 1.0 / options_.sampleRate;
    for (size_t bIdx = 0; bIdx < program_.blocks.size(); ++bIdx) {
        const auto& block = program_.blocks[bIdx];
        auto& scratch = blockScratch_[bIdx];
        if (block.kind != BlockKind::Mna) continue;
        if (!block.sparseSchedule.has_value()) continue;
        if (!scratch.scheduleAdmitted || scratch.sparseAbandoned) continue;
        if (scratch.eliminate) continue;
        const auto& schedule = *block.sparseSchedule;
        int32_t size = scratch.size;
        if (size <= 0) continue;

        // Assemble the audio-structure Jacobian at the operating point: all
        // stamps at the solved voltages with zero input, plus gmin and the
        // ground overwrite -- the same matrix the first Newton iteration
        // stamps. `applyStamp` advances limiter histories and divider/clock
        // state, which belong to the audio run: everything it touches is
        // snapshotted and restored, and the state vector goes in as a copy.
        std::vector<double> matrix(static_cast<size_t>(size) * static_cast<size_t>(size), 0.0);
        std::vector<double> rhs(static_cast<size_t>(size), 0.0);
        std::vector<double> state = blockStates_[bIdx];
        const std::vector<double>& op = blockOperatingPoints_[bIdx];
        std::vector<double> opPadded(static_cast<size_t>(size), 0.0);
        for (int32_t i = 0; i < size && i < static_cast<int32_t>(op.size()); ++i) {
            opPadded[static_cast<size_t>(i)] = op[static_cast<size_t>(i)];
        }

        bool savedLimited = limitedIterate_;
        auto savedDiode = diodeHistory_;
        auto savedBjt = bjtHistory_;
        auto savedTriode = triodeHistory_;
        auto savedOpamp = opampHistory_;
        auto savedOpampRaw = opampRawState_;
        auto savedFet = fetHistory_;
        auto savedShifted = lastShiftedSample_;
        auto savedScratchDiode = scratch.diodeHistory;
        auto savedScratchBjt = scratch.bjtHistory;
        auto savedScratchTriode = scratch.triodeHistory;
        auto savedScratchOpamp = scratch.opampHistory;
        auto savedScratchOpampRaw = scratch.opampRawState;
        auto savedScratchFet = scratch.fetHistory;
        for (size_t sIdx = 0; sIdx < block.stamps.size(); ++sIdx) {
            applyStamp(block.stamps[sIdx], matrix.data(), rhs.data(), size, block, dt, state,
                opPadded.data(), 0.0, false, 1.0, static_cast<int32_t>(bIdx), static_cast<int32_t>(sIdx));
        }
        for (int32_t node = 1; node < block.nodeCount; ++node) {
            matrix[node * size + node] += GMIN_SIEMENS;
        }
        for (int32_t col = 0; col < size; ++col) {
            matrix[col] = 0.0;
        }
        matrix[0] = 1.0;
        rhs[0] = 0.0;
        limitedIterate_ = savedLimited;
        diodeHistory_ = savedDiode;
        bjtHistory_ = savedBjt;
        triodeHistory_ = savedTriode;
        opampHistory_ = savedOpamp;
        opampRawState_ = savedOpampRaw;
        fetHistory_ = savedFet;
        lastShiftedSample_ = savedShifted;
        scratch.diodeHistory = savedScratchDiode;
        scratch.bjtHistory = savedScratchBjt;
        scratch.triodeHistory = savedScratchTriode;
        scratch.opampHistory = savedScratchOpamp;
        scratch.opampRawState = savedScratchOpampRaw;
        scratch.fetHistory = savedScratchFet;

        // Both solves on the same matrix: the replay first (it only reads),
        // then the dense solve on a copy (it factorises in place).
        std::vector<double> values(static_cast<size_t>(schedule.slots), 0.0);
        std::vector<double> scratchRhs(static_cast<size_t>(size), 0.0);
        std::vector<double> factors(static_cast<size_t>(schedule.factorCount), 0.0);
        std::vector<double> sparseOut(static_cast<size_t>(size), 0.0);
        bool replayed = runSparseSchedule(schedule, matrix.data(), rhs.data(),
            values.data(), scratchRhs.data(), factors.data(), sparseOut.data());
        std::vector<double> denseMatrix = matrix;
        std::vector<double> denseRhs = rhs;
        std::vector<double> denseOut(static_cast<size_t>(size), 0.0);
        std::vector<int32_t> rowOrder(static_cast<size_t>(size), 0);
        solveDense(denseMatrix.data(), denseRhs.data(), size, rowOrder.data(), denseOut.data());
        double diffSquares = 0.0;
        double denseSquares = 0.0;
        for (int32_t i = 0; i < size; ++i) {
            double difference = sparseOut[static_cast<size_t>(i)] - denseOut[static_cast<size_t>(i)];
            diffSquares += difference * difference;
            denseSquares += denseOut[static_cast<size_t>(i)] * denseOut[static_cast<size_t>(i)];
        }
        double denseNorm = std::sqrt(denseSquares);
        double disagreement = replayed
            ? std::sqrt(diffSquares) / std::max(denseNorm, 1e-9)
            : std::numeric_limits<double>::infinity();
        // The value-aware order, computed always now rather than only when
        // the shipped order fails: threshold Markowitz over the schedule's
        // own filled pattern, replayed and compared to the same dense solve.
        std::optional<SparseSchedule> candidate =
            computeNumericRepivot(schedule, size, matrix, NUMERIC_REPIVOT_TAU);
        double candidateDisagreement = std::numeric_limits<double>::infinity();
        if (candidate.has_value()) {
            std::vector<double> candidateValues(static_cast<size_t>(candidate->slots), 0.0);
            std::vector<double> candidateRhs(static_cast<size_t>(size), 0.0);
            std::vector<double> candidateFactors(static_cast<size_t>(candidate->factorCount), 0.0);
            std::vector<double> candidateOut(static_cast<size_t>(size), 0.0);
            const bool candidateReplayed = runSparseSchedule(
                *candidate,
                matrix.data(),
                rhs.data(),
                candidateValues.data(),
                candidateRhs.data(),
                candidateFactors.data(),
                candidateOut.data()
            );
            double candidateDiffSquares = 0.0;
            double candidateDenseSquares = 0.0;
            for (int32_t i = 0; i < size; ++i) {
                const double difference =
                    candidateOut[static_cast<size_t>(i)] - denseOut[static_cast<size_t>(i)];
                candidateDiffSquares += difference * difference;
                candidateDenseSquares +=
                    denseOut[static_cast<size_t>(i)] * denseOut[static_cast<size_t>(i)];
            }
            candidateDisagreement = candidateReplayed
                ? std::sqrt(candidateDiffSquares) /
                    std::max(std::sqrt(candidateDenseSquares), 1e-9)
                : std::numeric_limits<double>::infinity();
        }
        if (disagreement <= SCHEDULE_VALIDATION_TOL) {
            // The shipped order validates. Replace it only on a refinement:
            // the candidate reaches the audio-agreement bar while the shipped
            // order does not, by an order of magnitude, without meaningful
            // fill cost. Same predicate as `ReferenceRuntime`'s
            // `shouldRefinePivotOrder` -- ties keep shipped.
            if (candidate.has_value() && shouldRefinePivotOrder(
                    disagreement, candidateDisagreement,
                    static_cast<double>(schedule.sparseOps),
                    static_cast<double>(schedule.slots),
                    static_cast<double>(candidate->sparseOps),
                    static_cast<double>(candidate->slots))) {
                adoptRepivotedSchedule(bIdx, std::move(*candidate));
                continue;
            }
            continue;
        }
        // The shipped order failed on the real matrix. Before giving the
        // block up, try the value-aware order computed above: adoption needs
        // the same tolerance the shipped order failed; a refused or
        // still-disagreeing candidate drops to dense exactly as before.
        if (candidate.has_value() && candidateDisagreement <= SCHEDULE_VALIDATION_TOL) {
            adoptRepivotedSchedule(bIdx, std::move(*candidate));
            continue;
        }
        scratch.sparseAbandoned = true;
        scratch.sparseDropped = true;
        scratch.canUseSelectiveMatrixCopy = false;
    }
}

void Engine::reset() {
    scheduleSolves_ = 0;
    scheduleFallbacks_ = 0;
    for (auto& s : blockStates_) {
        std::fill(s.begin(), s.end(), 0.0);
    }
    for (size_t blockIndex = 0; blockIndex < blockScratch_.size(); ++blockIndex) {
        auto& scratch = blockScratch_[blockIndex];
        scratch.cachedControlGeneration = -1;
        scratch.matrix = scratch.baseMatrix;
        scratch.rhs = scratch.baseRhs;
        // **Abandonment is measured state, and `reset()` clears measured state.** It was the
        // one thing here that survived, so a block that gave its schedule up under one
        // operating condition stayed dense for the life of the engine even after the condition
        // that collapsed its pivot was gone. Re-arming costs at most one more run of
        // `SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT` fallbacks (about twenty samples) if the block
        // genuinely does not suit its order. Gated on `scheduleAdmitted` because the
        // predicted-saving floor also sets `sparseAbandoned`, and those blocks have no buffers.
        // Drops re-enter here too, as undecided rather than re-armed: `settlePivotOrders()`
        // re-decides them against the fresh operating point at the end of this function, so
        // a dropped order is never silently replayed and never sticky past new evidence.
        if (scratch.scheduleAdmitted) {
            scratch.sparseAbandoned = false;
            scratch.sparseDropped = false;
            scratch.consecutiveFallbacks = 0;
            scratch.repivotAttempted = false;
            scratch.canUseSelectiveMatrixCopy = true;
            // A re-pivoted order is a decision made against one operating point;
            // like a drop, it is re-decided against the fresh one rather than
            // carried over. Re-arm the generated-kernel lookup for the original
            // schedule, which `settlePivotOrders()` may keep or replace again.
            const auto& block = program_.blocks[blockIndex];
            if (scratch.repivotedSchedule.has_value()) {
                scratch.repivotedSchedule.reset();
                if (block.sparseSchedule.has_value()) {
                    scratch.sparseValues.assign(
                        static_cast<size_t>(block.sparseSchedule->slots), 0.0);
                    scratch.sparseScratchRhs.assign(
                        static_cast<size_t>(block.sparseSchedule->size), 0.0);
                    scratch.sparseFactors.assign(
                        static_cast<size_t>(block.sparseSchedule->factorCount), 0.0);
                }
            }
            scratch.generatedKernel = block.sparseSchedule.has_value()
                ? findGeneratedKernel(*block.sparseSchedule)
                : nullptr;
        }
        std::fill(scratch.diodeHistory.begin(), scratch.diodeHistory.end(), 0.0);
        std::fill(scratch.bjtHistory.begin(), scratch.bjtHistory.end(), std::make_pair(0.0, 0.0));
        std::fill(scratch.triodeHistory.begin(), scratch.triodeHistory.end(), TriodeHistory{});
        std::fill(scratch.opampHistory.begin(), scratch.opampHistory.end(), OpAmpHistory{});
        std::fill(scratch.opampRawState.begin(), scratch.opampRawState.end(), 0.0);
        std::fill(scratch.fetHistory.begin(), scratch.fetHistory.end(), FetHistory{});
    }
    for (auto& [_, lines] : composedLines_) {
        for (auto& [__, line] : lines) {
            std::fill(line.buffer.begin(), line.buffer.end(), 0.0);
            line.writeIndex = 0;
        }
    }
    for (auto& [_, perBlock] : composedPitch_) {
        for (auto& [__, st] : perBlock) {
            std::fill(st.buffer.begin(), st.buffer.end(), 0.0);
            st.writeAbs = 0;
            st.readAbs = 0.0;
        }
    }
    for (auto& [_, perBlock] : composedTracker_) {
        for (auto& [__, st] : perBlock) {
            std::fill(st.buffer.begin(), st.buffer.end(), 0.0);
            st.writeAbs = 0;
            st.sinceUpdate = TRACK_HOP;
            st.estimate = 0.0;
        }
    }
    for (auto& [_, dc] : composedDc_) {
        dc.dcEstimate = 0.0;
        dc.dcOperatingPoint = 0.0;
    }
    for (auto& [_, filters] : composedFilters_) {
        for (auto& comb : filters.combs) {
            std::fill(comb.buffer.begin(), comb.buffer.end(), 0.0);
            comb.index = 0;
        }
        for (auto& ap : filters.allpasses) {
            std::fill(ap.buffer.begin(), ap.buffer.end(), 0.0);
            ap.index = 0;
        }
    }
    for (auto& [_, v] : macroOutputVolts_) {
        v = 0.0;
    }
    opampHistory_.clear();
    opampRawState_.clear();
    diodeHistory_.clear();
    bjtHistory_.clear();
    triodeHistory_.clear();
    fetHistory_.clear();
    solveOperatingPoint();
    // Re-decided, not re-armed: the re-arm above cleared every admitted block's
    // drop as undecided, and the fresh operating point is what judges it, exactly
    // as `prepare()` does. Without this, `reset()` would replay collapsing orders
    // while `droppedScheduleBlocks()` still reported them dropped.
    settlePivotOrders();
}

void Engine::setControl(std::string_view controlId, double position) {
    auto it = controlPositions_.find(std::string(controlId));
    if (it != controlPositions_.end()) {
        const double was = it->second;
        it->second = position;
        // A press of a momentary control -- a rising edge -- times the tap, exactly as the TS
        // console: the sample clock at this call, the interval since the previous press.
        if (was < 0.5 && position >= 0.5 && options_.sampleRate > 0.0) {
            for (const auto& ctrl : program_.controls) {
                if (ctrl.id != controlId || !ctrl.momentary) continue;
                auto& tap = tapState_[std::string(controlId)];
                const int64_t now = static_cast<int64_t>(elapsedSamples_);
                if (ctrl.tapPresses <= 0) {
                    if (tap.lastPress >= 0 && now > tap.lastPress) {
                        tap.intervalSeconds = static_cast<double>(now - tap.lastPress) / options_.sampleRate;
                    }
                } else {
                    // The TS console's tap law: a run within the timeout, its mean interval once long enough.
                    const bool inRun = tap.lastPress >= 0 && tap.runStart >= 0 &&
                        static_cast<double>(now - tap.lastPress) / options_.sampleRate <= ctrl.tapTimeoutSeconds;
                    if (inRun) {
                        tap.runCount += 1;
                    } else {
                        tap.runStart = now;
                        tap.runCount = 1;
                    }
                    if (tap.runCount >= ctrl.tapPresses && now > tap.runStart) {
                        tap.intervalSeconds = static_cast<double>(now - tap.runStart) /
                            static_cast<double>(tap.runCount - 1) / options_.sampleRate;
                    }
                }
                tap.lastPress = now;
                break;
            }
        }
        controlGeneration_++;
        // A press of a latch's toggle flips it, as the TS console does, before anything reads it.
        if (was < 0.5 && position >= 0.5) {
            for (const auto& ctrl : program_.controls) {
                if (ctrl.latchToggledBy.empty() || ctrl.latchToggledBy != controlId) continue;
                setControl(ctrl.id, getControl(ctrl.id) >= 0.5 ? 0.0 : 1.0);
            }
        }

        auto idxIt = controlIndexByName_.find(std::string(controlId));
        if (idxIt != controlIndexByName_.end() && idxIt->second < static_cast<int32_t>(controlValues_.size())) {
            controlValues_[idxIt->second] = position;
        }

        for (const auto& block : program_.blocks) {
            if (block.kind == BlockKind::Composed && block.clockControl.has_value() && block.clockControl->controlId == controlId) {
                // **Every position, not just the running one.** A knob moved while the
                // pedal sits in one mode must still have moved the others' lines, or the
                // first sample after a switch plays a length the knob left behind.
                if (options_.sampleRate > 0.0) {
                    const auto& cc = *block.clockControl;
                    double frac = taperFraction(cc.taper, position);
                    double r = cc.ohmsAtControlMin + frac * (cc.ohmsAtControlMax - cc.ohmsAtControlMin);
                    double delaySec = cc.offsetSeconds + cc.stages * cc.formulaConstant * r * cc.farads;
                    for (size_t posIdx = 0; posIdx < block.positions.size(); ++posIdx) {
                        auto lIt = composedLines_.find(composedStateKey(block.id, posIdx));
                        if (lIt == composedLines_.end()) continue;
                        for (auto& [_, line] : lIt->second) {
                            line.targetLengthSamples = std::max(0.0, delaySec * options_.sampleRate);
                        }
                    }
                }
            }
        }
    }
}

double Engine::getControl(std::string_view controlId) const {
    auto it = controlPositions_.find(std::string(controlId));
    if (it != controlPositions_.end()) {
        return it->second;
    }
    return 0.5;
}

int32_t Engine::setSupply(int32_t blockIndex, int32_t sourceIndex, double volts, double sourceOhms) {
    // Validate everything before changing anything: the whole call is atomic.
    if (!std::isfinite(volts)) return 4;
    if (!std::isfinite(sourceOhms) || sourceOhms < 0.0) return 5;
    if (blockIndex < 0 || static_cast<size_t>(blockIndex) >= program_.blocks.size()) return 1;
    auto& block = program_.blocks[static_cast<size_t>(blockIndex)];
    if (block.kind != BlockKind::Mna) return 2;
    std::vector<size_t> matched;
    for (size_t sIdx = 0; sIdx < block.stamps.size(); ++sIdx) {
        const auto& stamp = block.stamps[sIdx];
        if (stamp.kind == StampKind::DcSource && stamp.sourceIndex == sourceIndex) {
            matched.push_back(sIdx);
        }
    }
    if (matched.empty()) return 3;
    bool alreadyMatches = true;
    for (size_t sIdx : matched) {
        const auto& stamp = block.stamps[sIdx];
        if (stamp.volts != volts || stamp.sourceOhms != sourceOhms) {
            alreadyMatches = false;
            break;
        }
    }
    // Reapplying identical values changes nothing: no rebuild, no generation bump.
    if (alreadyMatches) return 0;
    for (size_t sIdx : matched) {
        block.stamps[sIdx].volts = volts;
        block.stamps[sIdx].sourceOhms = sourceOhms;
    }
    // Before prepare() there are no cached matrices yet: prepare() builds from the
    // replaced stamps, exactly like the TypeScript runtime's pre-prepare path.
    if (!prepared_ || static_cast<size_t>(blockIndex) >= blockScratch_.size()) return 0;
    auto& scratch = blockScratch_[static_cast<size_t>(blockIndex)];
    if (scratch.baseMatrix.empty() || scratch.size <= 0) return 0;

    // Rebuild this block's cached base matrix exactly the way prepare() builds it:
    // fold the constant stamps (dc-source is constant) with an empty state at zero
    // input, then GMIN plus the ground-row pin. Pattern-derived index lists are
    // value-independent and stay as they are.
    int32_t size = scratch.size;
    const auto& sp = block.stampPartition;
    std::vector<double> emptyState(static_cast<size_t>(block.stateCount) * 2 + 16, 0.0);
    std::vector<double> emptySolution(static_cast<size_t>(size), 0.0);
    double dt = options_.sampleRate > 0.0 ? 1.0 / options_.sampleRate : 1.0 / 48000.0;
    std::fill(scratch.baseMatrix.begin(), scratch.baseMatrix.end(), 0.0);
    std::fill(scratch.baseRhs.begin(), scratch.baseRhs.end(), 0.0);
    for (int32_t cIdx : sp.constantStampIndices) {
        if (cIdx >= 0 && static_cast<size_t>(cIdx) < block.stamps.size()) {
            applyStamp(
                block.stamps[static_cast<size_t>(cIdx)],
                scratch.baseMatrix.data(),
                scratch.baseRhs.data(),
                size,
                block,
                dt,
                emptyState,
                emptySolution.data(),
                0.0,
                false,
                1.0,
                blockIndex
            );
        }
    }
    for (int32_t node = 1; node < block.nodeCount; ++node) {
        scratch.baseMatrix[node * size + node] += GMIN_SIEMENS;
    }
    for (int32_t col = 0; col < size; ++col) {
        scratch.baseMatrix[0 * size + col] = 0.0;
    }
    scratch.baseMatrix[0] = 1.0;
    scratch.baseRhs[0] = 0.0;
    // Invalidate every cache derived from the base matrix: the non-eliminated
    // control/sample path (cachedControlGen) and the eliminated factorisation
    // (cachedControlGeneration) both rebuild on next use. The sparse schedule
    // and its generated kernel are value-independent and need nothing.
    controlGeneration_++;
    return 0;
}

std::vector<double> Engine::solveByGminStepping(size_t blockIdx, double dt, std::vector<double>& state, int32_t size) {
    std::vector<double> guess(size, 0.0);
    std::vector<double> solution(size, 0.0);

    for (double gmin = GMIN_STEPPING_START_SIEMENS; gmin > GMIN_SIEMENS; gmin /= GMIN_STEPPING_RATIO) {
        auto pass = iterate(blockIdx, 0.0, dt, state, guess, solution.data(), true, gmin, 1.0);
        if (!isAllFinite(solution)) {
            return {};
        }
        guess = solution;
    }
    auto settled = iterate(blockIdx, 0.0, dt, state, guess, solution.data(), true, GMIN_SIEMENS, 1.0);
    if (settled.converged && isAllFinite(solution)) {
        return solution;
    }
    return {};
}

std::vector<double> Engine::solveBySourceStepping(size_t blockIdx, double dt, std::vector<double>& state, int32_t size) {
    std::vector<double> guess(size, 0.0);
    std::vector<double> solution(size, 0.0);
    double scale = 0.0;
    double stepSize = 0.1;
    int32_t failures = 0;

    while (scale < 1.0) {
        double nextScale = std::min(1.0, scale + stepSize);
        auto pass = iterate(blockIdx, 0.0, dt, state, guess, solution.data(), true, GMIN_SIEMENS, nextScale);

        if (pass.converged && isAllFinite(solution)) {
            scale = nextScale;
            guess = solution;
            stepSize = std::min(0.2, stepSize * 1.5);
            failures = 0;
        } else {
            stepSize /= 2.0;
            failures++;
            if (stepSize < SOURCE_STEPPING_MIN_STEP_SIZE || failures > SOURCE_STEPPING_MAX_FAILURES) {
                return {};
            }
        }
    }
    return guess;
}

void Engine::solveOperatingPoint() {
    double dt = 1.0 / options_.sampleRate;
    for (size_t bIdx = 0; bIdx < program_.blocks.size(); ++bIdx) {
        const auto& block = program_.blocks[bIdx];
        if (block.kind != BlockKind::Mna) continue;

        auto& scratch = blockScratch_[bIdx];
        auto& state = blockStates_[bIdx];
        int32_t size = scratch.size;

        std::vector<double> start(size, 0.0);
        for (const auto& seed : block.operatingPointSeeds) {
            if (seed.node > 0 && seed.node < size) {
                start[seed.node] = seed.initialVolts;
            }
        }

        std::vector<double> solution(size, 0.0);
        auto res = iterate(bIdx, 0.0, dt, state, start, solution.data(), true, GMIN_SIEMENS, 1.0);

        if (!res.converged || !isAllFinite(solution)) {
            solution = solveByGminStepping(bIdx, dt, state, size);
            if (solution.empty()) {
                solution = solveBySourceStepping(bIdx, dt, state, size);
            }
        }

        if (solution.empty() || !isAllFinite(solution)) {
            continue;
        }

        blockOperatingPoints_[bIdx] = solution;

        for (size_t sIdx = 0; sIdx < block.stamps.size(); ++sIdx) {
            const auto& stamp = block.stamps[sIdx];
            if (stamp.kind == StampKind::Capacitor) {
                state[stamp.stateIndex] = solution[stamp.a] - solution[stamp.b];
                state[stamp.stateIndex + 1] = 0.0;
            } else if (stamp.kind == StampKind::Inductor) {
                state[stamp.stateIndex] = 0.0;
                state[stamp.stateIndex + 1] = (solution[stamp.a] - solution[stamp.b]) / DC_INDUCTOR_SHORT_OHMS;
            } else if (stamp.kind == StampKind::IdealOpAmp) {
                if (stamp.railHigh.has_value() && stamp.railLow.has_value()) {
                    uint64_t key = packHistoryKey3(bIdx, stamp.plus, stamp.minus, stamp.output);
                    // Seed from the solved OUTPUT (inverse tanh map), mirroring the TS
                    // console: the full-gain product of the solved differential seeds
                    // every linear stage as railed, and a weak DC loop cannot walk
                    // that back. Clamped at tanh(8), exactly the ±8-halfSwing bound.
                    double hs = opAmpHalfSwing(*stamp.railHigh, *stamp.railLow);
                    double centre = (*stamp.railHigh + *stamp.railLow) / 2.0;
                    double unit = (solution[stamp.output] - centre) / hs;
                    double t = std::tanh(8.0);
                    if (unit > t) unit = t;
                    if (unit < -t) unit = -t;
                    double raw = hs * std::atanh(unit);
                    opampRawState_[key] = raw;
                    scratch.opampRawState[sIdx] = raw;
                }
            }
        }

        for (int32_t si = 0; si < block.stateCount; si += 2) {
            state[si] += 5e-6 * ((si >> 1) + 1);
        }
    }

    for (const auto& block : program_.blocks) {
        // Delay-line compositions only, mirroring the macro loop above:
        // reverb macros own DC-field-less reverbState, so a reverb
        // composition seeds nothing, exactly like its macro.
        if (block.kind != BlockKind::Composed) continue;
        auto dcIt = composedDc_.find(block.id);
        if (dcIt == composedDc_.end()) continue;
        // "Is this a delay-line composition?" -- a reverb composition owns no DC fields
        // and seeds nothing. Asked across every position, because the block is one or
        // the other whichever program is selected.
        bool ownsDelayLines = false;
        for (const auto& candidate : block.positions) {
            if (!candidate.lineDelaySeconds.empty()) { ownsDelayLines = true; break; }
        }
        if (!ownsDelayLines) continue;
        if (block.audioIn.has_value()) {
            auto inIt = blockIndexById_.find(block.audioIn->block);
            if (inIt != blockIndexById_.end()) {
                size_t inIdx = inIt->second;
                int32_t node = block.audioIn->node;
                if (node >= 0 && node < static_cast<int32_t>(blockOperatingPoints_[inIdx].size())) {
                    double tap = blockOperatingPoints_[inIdx][node];
                    dcIt->second.dcEstimate = tap;
                    dcIt->second.dcOperatingPoint = tap;
                    // Delay lines start filled with the settled input minus the
                    // operating point the macro source adds back (the AC rest,
                    // mirroring TS): filling raw tap would double-count DC
                    // through the first repeat exactly as an unstripped push
                    // would. Lines only; filter-only compositions untouched.
                    double fillValue = tap - dcIt->second.dcOperatingPoint;
                    auto kIt = composedStateKeys_.find(block.id);
                    if (kIt != composedStateKeys_.end()) {
                        for (size_t posIdx = 0; posIdx < block.positions.size() && posIdx < kIt->second.size(); ++posIdx) {
                            const auto& position = block.positions[posIdx];
                            bool hasTap = false;
                            for (const auto& op : position.ops) {
                                if (op.op == PrimitiveOp::Op::DelayTap || op.op == PrimitiveOp::Op::DelayTapFractional ||
                                    op.op == PrimitiveOp::Op::DelayTapReverse) {
                                    hasTap = true;
                                    break;
                                }
                            }
                            if (!hasTap) continue;
                            auto lIt = composedLines_.find(kIt->second[posIdx]);
                            if (lIt == composedLines_.end()) continue;
                            for (auto& [_, line] : lIt->second) {
                                std::fill(line.buffer.begin(), line.buffer.end(), fillValue);
                            }
                        }
                    }
                }
            }
        }
    }
}

Engine::SolveResult Engine::iterate(
    size_t blockIdx,
    double input,
    double dt,
    std::vector<double>& state,
    const std::vector<double>& start,
    double* outSolution,
    bool dc,
    double gmin,
    double sourceScale
) {
    const auto& block = program_.blocks[blockIdx];
    auto& scratch = blockScratch_[blockIdx];
    int32_t size = scratch.size;

    for (int32_t i = 0; i < size; ++i) {
        scratch.solutionA[i] = start[i];
    }
    double* current = scratch.solutionA.data();
    double* next = scratch.solutionB.data();

    int32_t iterations = options_.maxNewtonIterations;
    SolveResult res;

    bool isStandardAudioPass = !dc && (sourceScale == 1.0) && (gmin == GMIN_SIEMENS) && !scratch.sampleMatrix.empty();

    bool relaxing = false;
    double alpha = kNewtonRelaxationFactor;
    double bestDelta = HUGE_VAL;
    int32_t noImprovement = 0;
    int32_t foldStreak = 0;
    bool foldReseeded = false;
    for (int32_t iter = 0; iter < iterations; ++iter) {
        res.used = iter + 1;
        limitedIterate_ = false;
        limitedOpampValid_ = false;
#ifdef V2_PROFILE_TIMERS
        auto t_assemble_start = std::chrono::high_resolution_clock::now();
#endif

        if (isStandardAudioPass) {
            if (iter == 0) {
                std::memcpy(scratch.matrix.data(), scratch.sampleMatrix.data(), size * size * sizeof(double));
                std::memcpy(scratch.rhs.data(), scratch.sampleRhs.data(), size * sizeof(double));
            } else {
                if (scratch.canUseSelectiveMatrixCopy && !scratch.touchedNonlinearMatrixOffsets.empty()) {
                    for (int32_t offset : scratch.touchedNonlinearMatrixOffsets) {
                        scratch.matrix[offset] = scratch.sampleMatrix[offset];
                    }
                    for (int32_t row : scratch.touchedNonlinearRhsRows) {
                        scratch.rhs[row] = scratch.sampleRhs[row];
                    }
                } else {
                    std::memcpy(scratch.matrix.data(), scratch.sampleMatrix.data(), size * size * sizeof(double));
                    std::memcpy(scratch.rhs.data(), scratch.sampleRhs.data(), size * sizeof(double));
                }
            }

            for (int32_t stampIdx : scratch.nonlinearStampIndices) {
                applyStamp(block.stamps[stampIdx], scratch.matrix.data(), scratch.rhs.data(), size, block, dt, state, current, input, false, 1.0, static_cast<int32_t>(blockIdx), stampIdx);
            }

            for (int32_t col = 0; col < size; ++col) {
                scratch.matrix[0 * size + col] = 0.0;
            }
            scratch.matrix[0] = 1.0;
            scratch.rhs[0] = 0.0;
        } else {
            std::fill(scratch.matrix.begin(), scratch.matrix.end(), 0.0);
            std::fill(scratch.rhs.begin(), scratch.rhs.end(), 0.0);

            for (size_t sIdx = 0; sIdx < block.stamps.size(); ++sIdx) {
                applyStamp(block.stamps[sIdx], scratch.matrix.data(), scratch.rhs.data(), size, block, dt, state, current, input, dc, sourceScale, static_cast<int32_t>(blockIdx), static_cast<int32_t>(sIdx));
            }

            for (int32_t node = 1; node < block.nodeCount; ++node) {
                scratch.matrix[node * size + node] += gmin;
            }

            // Ground is node 0
            for (int32_t col = 0; col < size; ++col) {
                scratch.matrix[0 * size + col] = 0.0;
            }
            scratch.matrix[0] = 1.0;
            scratch.rhs[0] = 0.0;
        }
#ifdef V2_PROFILE_TIMERS
        auto t_assemble_end = std::chrono::high_resolution_clock::now();
        profile_assemble_ns_ += std::chrono::duration_cast<std::chrono::nanoseconds>(t_assemble_end - t_assemble_start).count();
        auto t_factor_start = std::chrono::high_resolution_clock::now();
#endif
        // **The static schedule is an AUDIO-PATH plan, and `dc` is a different matrix.**
        //
        // A DC pass is not the transient system with different numbers in it: capacitors stamp
        // nothing at all (`applyStamp`'s `if (dc) break;`), inductors stamp a short instead of
        // `dt/2L`, and `solveByGminStepping` walks the diagonal from 1e-3 down. The compiler
        // chose this block's pivot order under the transient assumption that a capacitor's
        // `2C/dt` is always there, so in DC a pivot the order depends on is exactly zero, the
        // guard trips, and the solve falls to dense -- correctly, but at the cost of running the
        // schedule first and, after `SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT` of them, of setting
        // `sparseAbandoned` for the life of the engine. Measured 2026-09-18: `boss-ch-1` burned
        // all 64 fallbacks inside `prepare()` and never took the sparse path for a single audio
        // sample; five more packets lost `canUseSelectiveMatrixCopy` the same way; `boss-tw-1`
        // had its operating point *computed* by that unstable solve and then needed ~64
        // iterations per sample forever after (17.9x real time, 2% converged), against 3.0
        // iterations and 0.80x once the DC solve is left to the dense path.
        //
        // Giving DC its own schedule would be the alternative and it is not worth it: the DC
        // solve runs once per `prepare()`/`reset()` and its cost is not on any budget, while
        // dense partial pivoting is the numerically stronger method and is what this path
        // wanted anyway. See `thoughts/shared/2026-09-18-sparse-schedule-runtime-audit.md` §4.
        if (!dc && block.sparseSchedule.has_value() && !scratch.sparseAbandoned) {
            scheduleSolves_++;
            // A re-pivoted block runs the order chosen from the operating-point
            // matrix; everything downstream (gather, replay, fallback) is the
            // same machinery.
            const SparseSchedule& activeSchedule = scratch.repivotedSchedule.has_value()
                ? *scratch.repivotedSchedule
                : *block.sparseSchedule;
            bool ok = false;
            if (scratch.generatedKernel != nullptr) {
                // The generated kernel is the same op stream with constant slot
                // indices; the gather and rhs copy it expects are the interpreter's
                // own prologue. A false return (pivot floor) leaves `ok` false and
                // takes the identical dense fallback the interpreter's false does.
                // The floor passed is the absolute pivot floor: the pivot guard
                // stays absolute (see `ReferenceRuntime.SCHEDULE_PIVOT_FLOOR`
                // for the measured reason), and the parameter exists so the
                // caller's fallback semantics stay identical between the two.
                const int32_t* __restrict offsets = activeSchedule.gatherOffsets.data();
                double* __restrict values = scratch.sparseValues.data();
                for (int32_t slot = 0; slot < activeSchedule.slots; ++slot) {
                    values[slot] = scratch.matrix[static_cast<size_t>(offsets[slot])];
                }
                std::memcpy(
                    scratch.sparseScratchRhs.data(),
                    scratch.rhs.data(),
                    static_cast<size_t>(scratch.size) * sizeof(double)
                );
                ok = scratch.generatedKernel(
                    values,
                    scratch.sparseScratchRhs.data(),
                    scratch.sparseFactors.data(),
                    next,
                    SCHEDULE_PIVOT_FLOOR
                );
                if (ok) kernelSolves_++;
            } else {
                ok = runSparseSchedule(
                    activeSchedule,
                    scratch.matrix.data(),
                    scratch.rhs.data(),
                    scratch.sparseValues.data(),
                    scratch.sparseScratchRhs.data(),
                    scratch.sparseFactors.data(),
                    next
                );
            }
            if (ok) {
                scratch.consecutiveFallbacks = 0;
            } else {
                scheduleFallbacks_++;
                scratch.consecutiveFallbacks++;
                scratch.canUseSelectiveMatrixCopy = false;
                if (scratch.consecutiveFallbacks >= SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT &&
                    !scratch.repivotAttempted) {
                    // The old shape abandoned here, silently dense for the rest
                    // of the run after paying for both solvers on every one of
                    // the 64 trips. Re-pivot once from the current matrix
                    // instead; only a refused or still-disagreeing re-pivot
                    // abandons. `solveDense` destroys the matrix and rhs, so
                    // the re-pivot's inputs are snapshotted first -- once per
                    // order, on this trip only. Mirrors `ReferenceRuntime`'s
                    // iterate fallback exactly.
                    scratch.repivotAttempted = true;
                    std::vector<double> matrixCopy = scratch.matrix;
                    std::vector<double> rhsCopy = scratch.rhs;
                    solveDense(scratch.matrix.data(), scratch.rhs.data(), size, scratch.denseRowOrder.data(), next);
                    if (isStandardAudioPass) {
                        std::memcpy(scratch.matrix.data(), scratch.sampleMatrix.data(), size * size * sizeof(double));
                        std::memcpy(scratch.rhs.data(), scratch.sampleRhs.data(), size * sizeof(double));
                    }
                    if (!adoptMidRunRepivot(blockIdx, matrixCopy, rhsCopy, next, size)) {
                        scratch.sparseAbandoned = true;
                    }
                } else {
                    if (scratch.consecutiveFallbacks >= SCHEDULE_CONSECUTIVE_FALLBACK_LIMIT) {
                        scratch.sparseAbandoned = true;
                    }
                    solveDense(scratch.matrix.data(), scratch.rhs.data(), size, scratch.denseRowOrder.data(), next);
                    if (isStandardAudioPass) {
                        std::memcpy(scratch.matrix.data(), scratch.sampleMatrix.data(), size * size * sizeof(double));
                        std::memcpy(scratch.rhs.data(), scratch.sampleRhs.data(), size * sizeof(double));
                    }
                }
            }
        } else {
            solveDense(scratch.matrix.data(), scratch.rhs.data(), size, scratch.denseRowOrder.data(), next);
            if (isStandardAudioPass) {
                std::memcpy(scratch.matrix.data(), scratch.sampleMatrix.data(), size * size * sizeof(double));
                std::memcpy(scratch.rhs.data(), scratch.sampleRhs.data(), size * sizeof(double));
            }
        }
#ifdef V2_PROFILE_TIMERS
        auto t_factor_end = std::chrono::high_resolution_clock::now();
        profile_factor_ns_ += std::chrono::duration_cast<std::chrono::nanoseconds>(t_factor_end - t_factor_start).count();
        // Backsub is inside solveDense (factor+backsub together) — count it with factor for dense
        auto t_converge_start = std::chrono::high_resolution_clock::now();
#endif

        if (relaxing) {
            for (int32_t i = 0; i < size; ++i) {
                next[i] = current[i] + alpha * (next[i] - current[i]);
            }
        }

        double delta = 0.0;
        bool withinTol = checkConvergenceAndMaxDelta(next, current, size, delta);

        if (delta < bestDelta * 0.999) {
            bestDelta = delta;
            noImprovement = 0;
            if (relaxing) {
                if (delta < 0.05) {
                    relaxing = false;
                    alpha = kNewtonRelaxationFactor;
                } else {
                    alpha = std::min(kNewtonRelaxationFactor, alpha * 1.15);
                }
            }
        } else {
            noImprovement += 1;
            if (!relaxing) {
                if (noImprovement >= kNewtonNonContractingLimit &&
                    iter >= kNewtonRelaxationEarliestIteration) {
                    relaxing = true;
                    noImprovement = 0;
                }
            } else {
                if (noImprovement >= kNewtonNonContractingLimit) {
                    alpha = std::max(0.2, alpha * 0.7);
                    noImprovement = 0;
                }
            }
        }

        bool convergedNow = block.linear || (withinTol && !limitedIterate_);
#ifdef V2_PROFILE_TIMERS
        auto t_converge_end = std::chrono::high_resolution_clock::now();
        profile_converge_ns_ += std::chrono::duration_cast<std::chrono::nanoseconds>(t_converge_end - t_converge_start).count();
        profile_totalIters_++;
#endif

        std::swap(current, next);

        if (convergedNow) {
            res.converged = true;
            break;
        }
        // Mirrors reference-runtime.ts `iterate`: a fold is reseeded on the other rail, once.
        foldStreak = (limitedOpampValid_ && limitedOpamp_.folded) ? foldStreak + 1 : 0;
        if (!dc && !foldReseeded && limitedOpampValid_ && foldStreak >= OPAMP_FOLD_STREAK) {
            foldReseeded = true;
            foldStreak = 0;
            const LimitedOpamp lo = limitedOpamp_;
            const bool wasHigh = (lo.output < static_cast<int32_t>(start.size()) ? start[lo.output] : lo.centre) >= lo.centre;
            current[lo.output] = wasHigh ? lo.railLow : lo.railHigh;
            const OpAmpHistory seeded{ wasHigh ? -lo.band : lo.band, 0.0, lo.maxStep };
            if (lo.stampIdx >= 0 && lo.stampIdx < static_cast<int32_t>(scratch.opampHistory.size())) {
                scratch.opampHistory[lo.stampIdx] = seeded;
            } else {
                opampHistory_[lo.key] = seeded;
            }
            relaxing = false;
            alpha = kNewtonRelaxationFactor;
            bestDelta = HUGE_VAL;
            noImprovement = 0;
        }
    }

    if (!res.converged) {
        res.worstDelta = maxAbsDifference(current, next, size);
        res.worstNode = worstDifferenceIndex(current, next, size);
    }

    std::memcpy(outSolution, current, size * sizeof(double));
    return res;
}

void Engine::buildLinearBackground(
    size_t blockIdx,
    const std::vector<int32_t>& stampIndices,
    double dt,
    std::vector<double>& state,
    double input,
    bool dc,
    double gmin,
    double sourceScale,
    int32_t blockIndex,
    double* outMatrix,
    double* outRhs
) {
    const auto& block = program_.blocks[blockIdx];
    auto& scratch = blockScratch_[blockIdx];
    int32_t size = scratch.size;

    bool isStandardAudioPass = !dc && (sourceScale == 1.0) && (gmin == GMIN_SIEMENS) && !scratch.baseMatrix.empty();

    if (isStandardAudioPass) {
        std::memcpy(outMatrix, scratch.baseMatrix.data(), size * size * sizeof(double));
        std::memcpy(outRhs, scratch.baseRhs.data(), size * sizeof(double));

        std::vector<double> emptySolution(size, 0.0);
        for (int32_t idx : scratch.nonConstantLinearStampIndices) {
            const auto& stamp = block.stamps[idx];
            applyStamp(stamp, outMatrix, outRhs, size, block, dt, state, emptySolution.data(), input, false, 1.0, blockIndex, idx);
        }

        for (int32_t col = 0; col < size; ++col) {
            outMatrix[0 * size + col] = 0.0;
        }
        outMatrix[0] = 1.0;
        outRhs[0] = 0.0;
    } else {
        std::memset(outMatrix, 0, size * size * sizeof(double));
        std::memset(outRhs, 0, size * sizeof(double));

        std::vector<double> emptySolution(size, 0.0);
        for (int32_t idx : stampIndices) {
            const auto& stamp = block.stamps[idx];
            applyStamp(stamp, outMatrix, outRhs, size, block, dt, state, emptySolution.data(), input, dc, sourceScale, blockIndex, idx);
        }

        for (int32_t node = 1; node < block.nodeCount; ++node) {
            outMatrix[node * size + node] += gmin;
        }
        for (int32_t col = 0; col < size; ++col) {
            outMatrix[0 * size + col] = 0.0;
        }
        outMatrix[0] = 1.0;
        outRhs[0] = 0.0;
    }
}

Engine::SolveResult Engine::iterateEliminated(
    size_t blockIdx,
    double input,
    double dt,
    std::vector<double>& state,
    const std::vector<double>& start,
    double* outSolution,
    bool dc,
    double gmin,
    double sourceScale
) {
    const auto& block = program_.blocks[blockIdx];
    auto& scratch = blockScratch_[blockIdx];
    int32_t size = scratch.size;
    int32_t portCount = scratch.portCount;
    int32_t lCount = scratch.lCount;
    const auto& portRows = scratch.portRows;
    const auto& lRows = scratch.lRows;
    const auto& portIndexOf = scratch.portIndexOf;
    const auto& lIndexOf = scratch.lIndexOf;

    buildLinearBackground(
        blockIdx,
        scratch.linearStampIndices,
        dt,
        state,
        input,
        dc,
        gmin,
        sourceScale,
        static_cast<int32_t>(blockIdx),
        scratch.linearMatrix.data(),
        scratch.linearRhs.data()
    );

    if (dc || gmin != GMIN_SIEMENS || scratch.cachedControlGeneration != controlGeneration_) {
        for (int32_t i = 0; i < lCount; ++i) {
            int32_t gRow = lRows[i];
            for (int32_t j = 0; j < lCount; ++j) {
                scratch.llMatrix[i * lCount + j] = scratch.linearMatrix[gRow * size + lRows[j]];
            }
        }
        factorLU(scratch.llMatrix.data(), lCount, scratch.permutation.data());

        for (int32_t p = 0; p < portCount; ++p) {
            int32_t gP = portRows[p];
            for (int32_t i = 0; i < lCount; ++i) {
                scratch.zRhsScratch[i] = scratch.linearMatrix[lRows[i] * size + gP];
            }
            solveLU(scratch.llMatrix.data(), lCount, scratch.permutation.data(), scratch.zRhsScratch.data(), &scratch.zMatrix[p * lCount]);
        }

        for (int32_t p = 0; p < portCount; ++p) {
            int32_t gP = portRows[p];
            for (int32_t j = 0; j < portCount; ++j) {
                scratch.kReduced[p * portCount + j] = scratch.linearMatrix[gP * size + portRows[j]];
            }
            for (int32_t i = 0; i < lCount; ++i) {
                double mPL = scratch.linearMatrix[gP * size + lRows[i]];
                if (mPL == 0.0) continue;
                for (int32_t j = 0; j < portCount; ++j) {
                    scratch.kReduced[p * portCount + j] -= mPL * scratch.zMatrix[j * lCount + i];
                }
            }
        }
        if (!dc && gmin == GMIN_SIEMENS) {
            scratch.cachedControlGeneration = controlGeneration_;
        } else {
            scratch.cachedControlGeneration = -1;
        }
    }

    for (int32_t i = 0; i < lCount; ++i) {
        scratch.z0Rhs[i] = scratch.linearRhs[lRows[i]];
    }
    solveLU(scratch.llMatrix.data(), lCount, scratch.permutation.data(), scratch.z0Rhs.data(), scratch.z0.data());

    for (int32_t p = 0; p < portCount; ++p) {
        int32_t gP = portRows[p];
        double u = scratch.linearRhs[gP];
        for (int32_t i = 0; i < lCount; ++i) {
            double mPL = scratch.linearMatrix[gP * size + lRows[i]];
            if (mPL == 0.0) continue;
            u -= mPL * scratch.z0[i];
        }
        scratch.uReduced[p] = u;
    }

    auto reconstructFull = [&](const double* y, double* full) {
        for (int32_t i = 0; i < lCount; ++i) {
            double val = scratch.z0[i];
            for (int32_t p = 0; p < portCount; ++p) {
                val -= scratch.zMatrix[p * lCount + i] * y[p];
            }
            full[lRows[i]] = val;
        }
        for (int32_t p = 0; p < portCount; ++p) {
            full[portRows[p]] = y[p];
        }
    };

    for (int32_t p = 0; p < portCount; ++p) {
        scratch.yCurrent[p] = start[portRows[p]];
    }
    reconstructFull(scratch.yCurrent.data(), scratch.fullCurrent.data());

    int32_t iterations = options_.maxNewtonIterations;
    SolveResult res;
    double* current = scratch.fullCurrent.data();
    double* next = scratch.fullNext.data();
    double* yCurrentArr = scratch.yCurrent.data();
    double* yNextArr = scratch.yNext.data();

    bool relaxing = false;
    double alpha = kNewtonRelaxationFactor;
    double bestDelta = HUGE_VAL;
    int32_t noImprovement = 0;
    for (int32_t iter = 0; iter < iterations; ++iter) {
        res.used = iter + 1;
        limitedIterate_ = false;
        limitedOpampValid_ = false;
#ifdef V2_PROFILE_TIMERS
        auto t_assemble_start = std::chrono::high_resolution_clock::now();
#endif

        for (int32_t p = 0; p < portCount; ++p) {
            int32_t gP = portRows[p];
            std::memset(&scratch.rawNl[gP * size], 0, size * sizeof(double));
            scratch.rawNlRhs[gP] = 0.0;
        }

        for (int32_t nlIdx : scratch.nonlinearStampIndices) {
            applyStamp(block.stamps[nlIdx], scratch.rawNl.data(), scratch.rawNlRhs.data(), size, block, dt, state, current, input, dc, sourceScale, static_cast<int32_t>(blockIdx), nlIdx);
        }

        for (int32_t p = 0; p < portCount; ++p) {
            int32_t gP = portRows[p];
            for (int32_t j = 0; j < portCount; ++j) {
                scratch.reducedJacobian[p * portCount + j] = scratch.kReduced[p * portCount + j];
            }
            double rhsValue = scratch.uReduced[p];
            const double* rawRow = &scratch.rawNl[gP * size];
            for (int32_t c = 0; c < size; ++c) {
                double val = rawRow[c];
                if (val == 0.0) continue;
                int32_t pIdx = portIndexOf[c];
                if (pIdx != -1) {
                    scratch.reducedJacobian[p * portCount + pIdx] += val;
                    continue;
                }
                int32_t lIdx = lIndexOf[c];
                for (int32_t j = 0; j < portCount; ++j) {
                    scratch.reducedJacobian[p * portCount + j] -= val * scratch.zMatrix[j * lCount + lIdx];
                }
                rhsValue -= val * scratch.z0[lIdx];
            }
            rhsValue += scratch.rawNlRhs[gP];
            scratch.reducedRhs[p] = rhsValue;
        }
#ifdef V2_PROFILE_TIMERS
        auto t_assemble_end = std::chrono::high_resolution_clock::now();
        profile_assemble_ns_ += std::chrono::duration_cast<std::chrono::nanoseconds>(t_assemble_end - t_assemble_start).count();
        auto t_factor_start = std::chrono::high_resolution_clock::now();
#endif

        solveDense(scratch.reducedJacobian.data(), scratch.reducedRhs.data(), portCount, scratch.denseRowOrder.data(), yNextArr);
#ifdef V2_PROFILE_TIMERS
        auto t_factor_end = std::chrono::high_resolution_clock::now();
        profile_factor_ns_ += std::chrono::duration_cast<std::chrono::nanoseconds>(t_factor_end - t_factor_start).count();
        auto t_converge_start = std::chrono::high_resolution_clock::now();
#endif
        if (relaxing) {
            for (int32_t i = 0; i < portCount; ++i) {
                yNextArr[i] = yCurrentArr[i] + alpha * (yNextArr[i] - yCurrentArr[i]);
            }
        }
        reconstructFull(yNextArr, next);

        res.worstDelta = maxAbsDifference(next, current, size);
        res.worstNode = worstDifferenceIndex(next, current, size);
        const double delta = res.worstDelta;
        if (delta < bestDelta * 0.999) {
            bestDelta = delta;
            noImprovement = 0;
            if (relaxing) {
                if (delta < 0.05) {
                    relaxing = false;
                    alpha = kNewtonRelaxationFactor;
                } else {
                    alpha = std::min(kNewtonRelaxationFactor, alpha * 1.15);
                }
            }
        } else {
            noImprovement += 1;
            if (!relaxing) {
                if (noImprovement >= kNewtonNonContractingLimit &&
                    iter >= kNewtonRelaxationEarliestIteration) {
                    relaxing = true;
                    noImprovement = 0;
                }
            } else {
                if (noImprovement >= kNewtonNonContractingLimit) {
                    alpha = std::max(0.2, alpha * 0.7);
                    noImprovement = 0;
                }
            }
        }

        bool convergedNow = withinTolerance(next, current, size) && !limitedIterate_;
#ifdef V2_PROFILE_TIMERS
        auto t_converge_end = std::chrono::high_resolution_clock::now();
        profile_converge_ns_ += std::chrono::duration_cast<std::chrono::nanoseconds>(t_converge_end - t_converge_start).count();
        profile_totalIters_++;
#endif

        std::swap(current, next);
        std::swap(yCurrentArr, yNextArr);

        if (convergedNow) {
            res.converged = true;
            break;
        }
    }

    std::memcpy(outSolution, current, size * sizeof(double));
    return res;
}

void Engine::applyStamp(
    const Stamp& stamp,
    double* matrix,
    double* rhs,
    int32_t size,
    const Block& block,
    double dt,
    std::vector<double>& state,
    const double* solution,
    double input,
    bool dc,
    double sourceScale,
    int32_t blockIndex,
    int32_t stampIdx
) {
    auto readControl = [&](const Stamp& st) -> double {
        if (st.controlIndex >= 0 && st.controlIndex < static_cast<int32_t>(controlValues_.size())) {
            return controlValues_[st.controlIndex];
        }
        return getControl(st.control);
    };

    BlockScratch* scratchPtr = (blockIndex >= 0 && blockIndex < static_cast<int32_t>(blockScratch_.size())) ? &blockScratch_[blockIndex] : nullptr;

    switch (stamp.kind) {
        case StampKind::Conductance:
            stampConductance(matrix, size, stamp.a, stamp.b, stamp.siemens);
            break;

        case StampKind::ControlledConductance: {
            double pos = readControl(stamp);
            double frac = taperFraction(stamp.taper, pos);
            double share = (stamp.side == "lower") ? frac : (1.0 - frac);
            // Declared end resistance, same arithmetic as the TS console: the wiper
            // travels between the two residuals, so each half is
            // residual + share * (total - 2 * residual) and the halves still sum to
            // total. 0 is an ideal pot. The 1 milliohm floor is a separate numerical
            // guard against a zero-resistance element, not a physical residual.
            double residual = stamp.residualOhms;
            double swept = residual > 0.0
                ? residual + share * (stamp.totalOhms - 2.0 * residual)
                : stamp.totalOhms * share;
            double ohms = std::max(swept, 1e-3);
            stampConductance(matrix, size, stamp.a, stamp.b, 1.0 / ohms);
            break;
        }

        case StampKind::ControlledResistance: {
            double pos = readControl(stamp);
            double frac = taperFraction(stamp.taper, pos);
            double ohms = std::max(stamp.minOhms + frac * (stamp.maxOhms - stamp.minOhms), 1e-3);
            stampConductance(matrix, size, stamp.a, stamp.b, 1.0 / ohms);
            break;
        }

        case StampKind::Selector: {
            double pos = readControl(stamp);
            int32_t throwCount = stamp.throwCount > 0 ? stamp.throwCount : static_cast<int32_t>(stamp.throwsList.size());
            if (throwCount <= 0) break;
            int32_t selected = std::min(throwCount - 1, std::max(0, static_cast<int32_t>(std::floor(pos * throwCount))));
            if (stamp.throwNode != -1) {
                double ohms = (selected == stamp.throwIndex) ? stamp.onOhms : stamp.offOhms;
                stampConductance(matrix, size, stamp.common, stamp.throwNode, 1.0 / ohms);
            } else {
                for (int32_t t = 0; t < static_cast<int32_t>(stamp.throwsList.size()); ++t) {
                    double ohms = (selected == t) ? stamp.onOhms : stamp.offOhms;
                    stampConductance(matrix, size, stamp.common, stamp.throwsList[t], 1.0 / ohms);
                }
            }
            break;
        }

        case StampKind::Switch: {
            double pos = readControl(stamp);
            double ohms = (pos >= 0.5) ? stamp.onOhms : stamp.offOhms;
            stampConductance(matrix, size, stamp.a, stamp.b, 1.0 / ohms);
            break;
        }

        case StampKind::Capacitor: {
            if (dc) break;
            double g = (2.0 * stamp.farads) / dt;
            double prevAcross = state[stamp.stateIndex];
            double prevCurrent = state[stamp.stateIndex + 1];
            double src = g * prevAcross + prevCurrent;
            stampConductance(matrix, size, stamp.a, stamp.b, g);
            rhs[stamp.a] += src;
            rhs[stamp.b] -= src;
            break;
        }

        case StampKind::Inductor: {
            if (dc) {
                stampConductance(matrix, size, stamp.a, stamp.b, 1.0 / DC_INDUCTOR_SHORT_OHMS);
                break;
            }
            double g = dt / (2.0 * stamp.henries);
            double prevAcross = state[stamp.stateIndex];
            double prevCurrent = state[stamp.stateIndex + 1];
            double src = prevCurrent + g * prevAcross;
            stampConductance(matrix, size, stamp.a, stamp.b, g);
            rhs[stamp.a] -= src;
            rhs[stamp.b] += src;
            break;
        }

        case StampKind::Diode: {
            double scale = stamp.emissionCoefficient * stamp.thermalVoltage;
            double raw = solution[stamp.anode] - solution[stamp.cathode];
            double prevAcross = 0.0;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->diodeHistory.size())) {
                prevAcross = scratchPtr->diodeHistory[stampIdx];
            } else {
                uint64_t diodeKey = packHistoryKey2(blockIndex, stamp.anode, stamp.cathode);
                auto it = diodeHistory_.find(diodeKey);
                prevAcross = (it != diodeHistory_.end()) ? it->second : 0.0;
            }
            double rs = stamp.seriesResistance;
            double across = limitJunction(raw, prevAcross, scale, stamp.saturationCurrent, rs);
            if (across != raw) limitedIterate_ = true;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->diodeHistory.size())) {
                scratchPtr->diodeHistory[stampIdx] = across;
            } else {
                uint64_t diodeKey = packHistoryKey2(blockIndex, stamp.anode, stamp.cathode);
                diodeHistory_[diodeKey] = across;
            }

            double forwardCurrent = 0.0;
            double forwardConductance = 0.0;
            if (rs > 1e-6) {
                double x = (stamp.saturationCurrent * rs) / scale;
                double logZ = std::log(x) + x + across / scale;
                double w = lambertW0FromLogZ(logZ);
                forwardCurrent = (scale / rs) * w - stamp.saturationCurrent;
                forwardConductance = w / (rs * (1.0 + w));
            } else {
                double expVal = std::exp(std::min(across / scale, JUNCTION_EXPONENT_LIMIT));
                forwardCurrent = stamp.saturationCurrent * (expVal - 1.0);
                forwardConductance = (stamp.saturationCurrent * expVal) / scale;
            }

            double bdCurrent = 0.0;
            double bdConductance = 0.0;
            if (stamp.breakdownVolts > 0.0) {
                double beyond = -(across + stamp.breakdownVolts);
                if (rs > 1e-6) {
                    // I = Itest * exp((beyond - I*Rs) / scale) in closed form; mirrors the TS
                    // console, which carries the reasoning.
                    double zx = (ZENER_TEST_CURRENT_AMPS * rs) / scale;
                    double zw = lambertW0FromLogZ(std::log(zx) + beyond / scale);
                    bdCurrent = -(scale / rs) * zw;
                    bdConductance = zw / (rs * (1.0 + zw));
                } else {
                    double rev = std::exp(std::min(beyond / scale, JUNCTION_EXPONENT_LIMIT));
                    bdCurrent = -ZENER_TEST_CURRENT_AMPS * rev;
                    bdConductance = (ZENER_TEST_CURRENT_AMPS * rev) / scale;
                }
            }

            double current = forwardCurrent + bdCurrent;
            double rawG = forwardConductance + bdConductance;
            double g = rawG + 1e-12;
            double eq = current - rawG * across;
            stampConductance(matrix, size, stamp.anode, stamp.cathode, g);
            rhs[stamp.anode] -= eq;
            rhs[stamp.cathode] += eq;
            break;
        }

        case StampKind::DcSource: {
            int32_t row = block.nodeCount + stamp.sourceIndex;
            matrix[row * size + stamp.positive] += 1.0;
            matrix[stamp.positive * size + row] += 1.0;
            matrix[row * size + stamp.negative] -= 1.0;
            matrix[stamp.negative * size + row] -= 1.0;
            matrix[row * size + row] -= stamp.sourceOhms;
            rhs[row] = stamp.volts * sourceScale;
            break;
        }

        case StampKind::AcSource: {
            int32_t row = block.nodeCount + stamp.sourceIndex;
            matrix[row * size + stamp.positive] += 1.0;
            matrix[stamp.positive * size + row] += 1.0;
            matrix[row * size + stamp.negative] -= 1.0;
            matrix[stamp.negative * size + row] -= 1.0;
            matrix[row * size + row] -= stamp.sourceOhms;
            double emf = dc ? 0.0 : stamp.amplitudeVolts * std::sin(2.0 * M_PI * stamp.frequencyHz * timeSeconds_);
            rhs[row] = emf * sourceScale;
            break;
        }

        case StampKind::InputSource: {
            int32_t row = block.nodeCount + stamp.sourceIndex;
            int32_t node = (stamp.node != -1) ? stamp.node : ((stamp.input != -1) ? stamp.input : ((stamp.plus != -1) ? stamp.plus : stamp.positive));
            matrix[row * size + node] = 1.0;
            matrix[node * size + row] = 1.0;
            matrix[row * size + row] = -options_.inputSourceOhms;
            rhs[row] = input;
            break;
        }

        case StampKind::MacroAudioSource: {
            int32_t row = block.nodeCount + stamp.sourceIndex;
            // In the operating-point solve the core is DC-transparent in the
            // matrix, not beside it: stamp its transfer's affine form
            // (`V(node) = G.V(tap) + O`, derived from its own ops), so a
            // DC-coupled loop solves jointly instead of parking at rails.
            // Same-block taps read the iterate being built; cross-block taps
            // read the last solved state. Null transfer stamps the
            // pre-existing 0, exactly as before. Mirrors the TS console.
            // No extra sourceScale: the transfer derives from the live tap.
            double gain = 0.0;
            double offset = 0.0;
            if (dc) {
                auto bIt = blockIndexById_.find(stamp.macroId);
                if (bIt != blockIndexById_.end()) {
                    const Block& composed = program_.blocks[bIt->second];
                    if (composed.kind == BlockKind::Composed && composed.audioIn.has_value()) {
                        const auto& port = *composed.audioIn;
                        if (port.block == block.id && port.node >= 0 && port.node < size) {
                            double tap = solution[port.node];
                            double g = 0.0;
                            double o = 0.0;
                            if (composedDcTransfer(bIt->second, tap, g, o)) {
                                gain = g;
                                offset = o;
                                matrix[row * size + port.node] -= gain;
                            }
                        } else if (port.block != block.id) {
                            double tap = 0.0;
                            auto pIt = blockIndexById_.find(port.block);
                            if (pIt != blockIndexById_.end()) {
                                size_t pIdx = pIt->second;
                                int32_t node = port.node;
                                if (node >= 0 && node < static_cast<int32_t>(blockOperatingPoints_[pIdx].size())) {
                                    tap = blockOperatingPoints_[pIdx][node];
                                }
                            }
                            double g = 0.0;
                            double o = 0.0;
                            if (composedDcTransfer(bIt->second, tap, g, o)) {
                                offset = o + g * tap;
                            }
                        }
                    }
                }
            }
            matrix[row * size + stamp.node] += 1.0;
            matrix[stamp.node * size + row] += 1.0;
            matrix[row * size + row] -= stamp.sourceOhms;
            // The stamp kind keeps its name for contract reasons -- it is a declared
            // `OperatorKind`, so renaming it would be a program-format change for nothing --
            // but since row 7 only a composition ever publishes through it.
            double dcBias = 0.0;
            auto cIt = composedDc_.find(stamp.macroId);
            if (cIt != composedDc_.end()) {
                dcBias = cIt->second.dcOperatingPoint;
            }
            double macroVolts = 0.0;
            auto vIt = macroOutputVolts_.find(stamp.macroId);
            if (vIt != macroOutputVolts_.end()) {
                macroVolts = vIt->second;
            }
            rhs[row] = (macroVolts + dcBias) * sourceScale;
            break;
        }

        case StampKind::IdealOpAmp: {
            int32_t row = block.nodeCount + stamp.sourceIndex;
            matrix[stamp.output * size + row] += 1.0;
            if (!stamp.railHigh.has_value() || !stamp.railLow.has_value()) {
                matrix[row * size + stamp.plus] += 1.0;
                matrix[row * size + stamp.minus] -= 1.0;
                rhs[row] = 0.0;
                break;
            }
            double vcc = *stamp.railHigh;
            double vee = *stamp.railLow;
            double centre = (vcc + vee) / 2.0;
            double halfSwing = opAmpHalfSwing(vcc, vee);
            double alpha = dc ? 1.0 : opAmpPoleAlpha(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, options_.sampleRate);
            double effectiveGain = alpha * stamp.openLoopGain;
            double linearWidth = halfSwing / effectiveGain;

            double prevDiff = 0.0;
            double prevStep = 0.0;
            double prevCap = OPAMP_MAX_DIFFERENTIAL_STEP * linearWidth;
            bool hasPrev = false;

            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->opampHistory.size())) {
                const auto& h = scratchPtr->opampHistory[stampIdx];
                prevDiff = h.differential;
                prevStep = h.step;
                prevCap = (h.cap > 0.0) ? h.cap : (OPAMP_MAX_DIFFERENTIAL_STEP * linearWidth);
                hasPrev = (h.cap > 0.0);
            } else {
                uint64_t opampKey = packHistoryKey3(blockIndex, stamp.plus, stamp.minus, stamp.output);
                auto it = opampHistory_.find(opampKey);
                if (it != opampHistory_.end()) {
                    hasPrev = true;
                    prevDiff = it->second.differential;
                    prevStep = it->second.step;
                    prevCap = it->second.cap;
                }
            }

            double rawDiff = solution[stamp.plus] - solution[stamp.minus];
            double band = OPAMP_DIFFERENTIAL_BAND * linearWidth;
            double bounded = clamp(rawDiff, -band, band);
            double step = bounded - prevDiff;
            double maxStep = OPAMP_MAX_DIFFERENTIAL_STEP * linearWidth;

            bool reversing = hasPrev && prevStep != 0.0 && step != 0.0 && ((step > 0.0) != (prevStep > 0.0));
            double cap = reversing ? std::max(prevCap / 2.0, linearWidth / 64.0) : std::min(maxStep, prevCap * 1.2);
            bool limited = std::abs(step) > cap;
            if (limited) {
                limitedIterate_ = true;
                // Mirrors reference-runtime.ts `limitedOpamp`: the fold candidate for `iterate`.
                limitedOpamp_ = LimitedOpamp{
                    stampIdx,
                    packHistoryKey3(blockIndex, stamp.plus, stamp.minus, stamp.output),
                    stamp.output,
                    centre,
                    vcc,
                    vee,
                    band,
                    maxStep,
                    cap <= linearWidth / 8.0,
                };
                limitedOpampValid_ = true;
            }
            double diff = limited ? (prevDiff + (step > 0.0 ? 1.0 : -1.0) * cap) : bounded;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->opampHistory.size())) {
                scratchPtr->opampHistory[stampIdx] = OpAmpHistory{ diff, step, cap };
            } else {
                uint64_t opampKey = packHistoryKey3(blockIndex, stamp.plus, stamp.minus, stamp.output);
                opampHistory_[opampKey] = OpAmpHistory{ diff, step, cap };
            }

            double rawPrev = 0.0;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->opampRawState.size())) {
                rawPrev = scratchPtr->opampRawState[stampIdx];
            } else {
                uint64_t opampKey = packHistoryKey3(blockIndex, stamp.plus, stamp.minus, stamp.output);
                auto rawIt = opampRawState_.find(opampKey);
                rawPrev = (rawIt != opampRawState_.end()) ? rawIt->second : 0.0;
            }
            double raw = boundOpAmpRaw(
                dc ? (stamp.openLoopGain * diff) : (alpha * stamp.openLoopGain * diff + (1.0 - alpha) * rawPrev),
                halfSwing);
            double scaled = raw / halfSwing;
            double shape = std::tanh(scaled);
            double outVal = centre + halfSwing * shape;
            double derivShape = std::tanh(clamp(scaled, -OPAMP_SATURATION_BAND, OPAMP_SATURATION_BAND));
            double slope = effectiveGain * (1.0 - derivShape * derivShape);

            matrix[row * size + stamp.output] += 1.0;
            matrix[row * size + stamp.plus] -= slope;
            matrix[row * size + stamp.minus] += slope;
            rhs[row] = outVal - slope * diff;
            break;
        }

        case StampKind::Bjt: {
            int32_t sign = (stamp.polarity == "pnp") ? -1 : 1;
            double vt = stamp.thermalVoltage;
            double is = stamp.saturationCurrent;
            double prevVbe = 0.0;
            double prevVbc = 0.0;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->bjtHistory.size())) {
                prevVbe = scratchPtr->bjtHistory[stampIdx].first;
                prevVbc = scratchPtr->bjtHistory[stampIdx].second;
            } else {
                uint64_t bjtKey = packHistoryKey3(blockIndex, stamp.base, stamp.collector, stamp.emitter);
                auto it = bjtHistory_.find(bjtKey);
                if (it != bjtHistory_.end()) {
                    prevVbe = it->second.first;
                    prevVbc = it->second.second;
                }
            }

            double rawVbe = sign * (solution[stamp.base] - solution[stamp.emitter]);
            double rawVbc = sign * (solution[stamp.base] - solution[stamp.collector]);
            double vbe = limitJunction(rawVbe, prevVbe, vt, is);
            double vbc = limitJunction(rawVbc, prevVbc, vt, is);
            if (vbe != rawVbe || vbc != rawVbc) limitedIterate_ = true;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->bjtHistory.size())) {
                scratchPtr->bjtHistory[stampIdx] = {vbe, vbc};
            } else {
                uint64_t bjtKey = packHistoryKey3(blockIndex, stamp.base, stamp.collector, stamp.emitter);
                bjtHistory_[bjtKey] = {vbe, vbc};
            }

            double expBe = std::exp(std::min(vbe / vt, 60.0));
            double expBc = std::exp(std::min(vbc / vt, 60.0));
            double ift = is * (expBe - 1.0);
            double irt = is * (expBc - 1.0);

            double bf = stamp.forwardBeta;
            double br = stamp.reverseBeta;
            double leak = stamp.leakageAmps;
            double ileak = leak * (expBc - 1.0);
            double gleak = (leak / vt) * expBc;

            double ic = ift - irt * (1.0 + 1.0 / br) - ileak;
            double ib = ift / bf + irt / br + ileak;

            double gif = (is / vt) * expBe;
            double gir = (is / vt) * expBc;
            double gm = gif;
            double gmu = -gir * (1.0 + 1.0 / br) - gleak;
            double gpi = gif / bf;
            double gx = gir / br + gleak;

            int32_t b = stamp.base;
            int32_t c = stamp.collector;
            int32_t e = stamp.emitter;

            auto addJac = [&](int32_t r, double dVb, double dVc, double dVe) {
                matrix[r * size + b] += dVb;
                matrix[r * size + c] += dVc;
                matrix[r * size + e] += dVe;
            };
            addJac(b, gpi + gx, -gx, -gpi);
            addJac(c, gm + gmu, -gmu, -gm);
            addJac(e, -(gpi + gx + gm + gmu), gx + gmu, gpi + gm);

            double ibEq = ib - (gpi * vbe + gx * vbc);
            double icEq = ic - (gm * vbe + gmu * vbc);
            rhs[b] -= sign * ibEq;
            rhs[c] -= sign * icEq;
            rhs[e] += sign * (ibEq + icEq);
            break;
        }

        case StampKind::Fet: {
            double sign = (stamp.channel == "n") ? 1.0 : -1.0;
            double rawVgs = sign * (solution[stamp.gate] - solution[stamp.source]);
            double rawVds = sign * (solution[stamp.drain] - solution[stamp.source]);

            double prevVgs = stamp.thresholdVolts;
            double prevVds = 0.0;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->fetHistory.size())) {
                prevVgs = scratchPtr->fetHistory[stampIdx].vgs;
                prevVds = scratchPtr->fetHistory[stampIdx].vds;
            } else {
                uint64_t fetKey = packHistoryKey3(blockIndex, stamp.gate, stamp.drain, stamp.source);
                auto it = fetHistory_.find(fetKey);
                if (it != fetHistory_.end()) {
                    prevVgs = it->second.vgs;
                    prevVds = it->second.vds;
                }
            }

            double vgs = limitFetGate(rawVgs, prevVgs, stamp.thresholdVolts);
            bool conducting = (vgs - stamp.thresholdVolts > 0.0) && (rawVds >= 0.0);
            double vds = conducting ? limitFetDrain(rawVds, prevVds) : rawVds;
            if (vgs != rawVgs || vds != rawVds) {
                limitedIterate_ = true;
            }
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->fetHistory.size())) {
                scratchPtr->fetHistory[stampIdx] = FetHistory{ vgs, vds };
            } else {
                uint64_t fetKey = packHistoryKey3(blockIndex, stamp.gate, stamp.drain, stamp.source);
                fetHistory_[fetKey] = FetHistory{ vgs, vds };
            }

            double beta = stamp.transconductance;
            double lambda = stamp.channelLengthModulation;

            auto forward = [&](double gateSource, double drainSource) {
                double driveRaw = gateSource - stamp.thresholdVolts;
                // Subthreshold conduction, mirroring reference-runtime.ts: softplus
                // effective drive when subthresholdVolts > 0 (JFETs), legacy hard
                // cutoff otherwise (MOSFETs carry 0 — bit-identical old behavior).
                double subVolts = stamp.subthresholdVolts;
                double drive = driveRaw;
                if (subVolts > 0.0) {
                    double x = driveRaw / subVolts;
                    drive = x > 40.0 ? driveRaw : (x < -40.0 ? subVolts * std::exp(x) : subVolts * std::log1p(std::exp(x)));
                } else if (driveRaw <= 0.0) {
                    return std::make_tuple(0.0, 0.0, 1e-12);
                }
                if (drainSource < drive) {
                    double current = beta * drainSource * (2.0 * drive - drainSource) * (1.0 + lambda * drainSource);
                    double gm = 2.0 * beta * drainSource * (1.0 + lambda * drainSource);
                    double gds = 2.0 * beta * (drive - drainSource) * (1.0 + lambda * drainSource) +
                                 beta * drainSource * (2.0 * drive - drainSource) * lambda;
                    return std::make_tuple(current, gm, gds);
                }
                double current = beta * drive * drive * (1.0 + lambda * drainSource);
                double gm = 2.0 * beta * drive * (1.0 + lambda * drainSource);
                double gds = beta * drive * drive * lambda + 1e-12;
                return std::make_tuple(current, gm, gds);
            };

            double drainCurrent = 0.0;
            double gm = 0.0;
            double gds = 0.0;
            if (vds >= 0.0) {
                auto [c, m, d] = forward(vgs, vds);
                drainCurrent = c;
                gm = m;
                gds = d;
            } else {
                auto [c, m, d] = forward(vgs - vds, -vds);
                drainCurrent = -c;
                gm = -m;
                gds = m + d;
            }

            int32_t d = stamp.drain;
            int32_t sNode = stamp.source;
            int32_t g = stamp.gate;

            matrix[d * size + g] += gm;
            matrix[d * size + d] += gds;
            matrix[d * size + sNode] -= gm + gds;
            matrix[sNode * size + g] -= gm;
            matrix[sNode * size + d] -= gds;
            matrix[sNode * size + sNode] += gm + gds;

            double equivalent = drainCurrent - (gm * vgs + gds * vds);
            rhs[d] -= sign * equivalent;
            rhs[sNode] += sign * equivalent;

            // Gate-source junction, identical in form to the triode's grid conduction below.
            // A MOSFET's insulated gate has gateSaturationCurrent == 0 and this contributes
            // nothing, which is what this stamp did for every FET before; a JFET's gate is a
            // PN junction, and without it the solve can park at a forward-biased Vgs no
            // physical part holds. Softplus, so the current grows linearly once conducting
            // and needs no limiter beyond the limitFetGate step already applied to vgs.
            // vgs is channel-signed, so the conductance with respect to the unsigned
            // gate-source difference is ggate either way and only the companion current
            // carries sign -- the same convention the drain terms above use.
            if (stamp.gateSaturationCurrent > 0.0) {
                double gateCurrent = 0.0;
                double ggate = 0.0;
                double gateOver = vgs - stamp.gateOnsetVolts;
                if (gateOver > -40.0 * stamp.gateScaleVolts) {
                    double x = gateOver / stamp.gateScaleVolts;
                    double softened = x > 40.0 ? x : (x < -40.0 ? std::exp(x) : std::log1p(std::exp(x)));
                    gateCurrent = stamp.gateSaturationCurrent * softened;
                    double sigmoid = x > 40.0 ? 1.0 : (x < -40.0 ? std::exp(x) : 1.0 / (1.0 + std::exp(-x)));
                    ggate = (stamp.gateSaturationCurrent / stamp.gateScaleVolts) * sigmoid;
                }
                // TWO JUNCTIONS, NOT ONE. Mirrors `reference-runtime.ts`: a JFET's gate is a PN
                // junction to BOTH ends of the channel, the same junction with the same parameters
                // evaluated at vgs and at vgd, which the channel-signed frame spells `vgs - vds`.
                // A MOSFET's gateSaturationCurrent == 0 skips both, so the CMOS-logic FETs the
                // inverter and gate lowerings emit are unchanged by construction.
                auto junction = [&](double across, double& current, double& conductance) {
                    current = 0.0;
                    conductance = 0.0;
                    double over = across - stamp.gateOnsetVolts;
                    if (over <= -40.0 * stamp.gateScaleVolts) { return; }
                    double x = over / stamp.gateScaleVolts;
                    double softened = x > 40.0 ? x : (x < -40.0 ? std::exp(x) : std::log1p(std::exp(x)));
                    double sigmoid = x > 40.0 ? 1.0 : (x < -40.0 ? std::exp(x) : 1.0 / (1.0 + std::exp(-x)));
                    current = stamp.gateSaturationCurrent * softened;
                    conductance = (stamp.gateSaturationCurrent / stamp.gateScaleVolts) * sigmoid;
                };
                auto stampJunction = [&](int32_t other, double across) {
                    double current = 0.0, conductance = 0.0;
                    junction(across, current, conductance);
                    matrix[g * size + g] += conductance;
                    matrix[g * size + other] -= conductance;
                    matrix[other * size + g] -= conductance;
                    matrix[other * size + other] += conductance;
                    double equivalentGate = current - conductance * across;
                    rhs[g] -= sign * equivalentGate;
                    rhs[other] += sign * equivalentGate;
                };
                stampJunction(sNode, vgs);
                stampJunction(d, vgs - vds);
            }
            break;
        }

        case StampKind::Optocoupler: {
            double across = solution[stamp.ledAnode] - solution[stamp.ledCathode];
            // From `component-diode-chips.json`'s `LED-RED` entry, whose aliases include
            // `VTL5C2 (LED emitter side of the CdS optocoupler)`: `emissionCoefficient` typ 2
            // and `forwardVoltageAt1mA` typ 1.8 V. Was `0.05` and `1e-12`, an ideality of 1.934
            // against a saturation current six orders too large, which put the knee at 1.036 V
            // where the cited part's own minimum is 1.65 V. Identical to reference-runtime.ts,
            // which `test-v2-wasm-parity.ts` compares against.
            double scale = OPTO_LED_EMISSION_VOLTS;
            double exponential = std::exp(std::min(across / scale, JUNCTION_EXPONENT_LIMIT));
            double ledCurrent = OPTO_LED_SATURATION_AMPS * (exponential - 1.0);
            // The trailing 1e-12 is a conductance floor, not a saturation current.
            double ledConductance = std::max((OPTO_LED_SATURATION_AMPS * exponential) / scale, 1e-12);
            double ledEquivalent = ledCurrent - ledConductance * across;

            stampConductance(matrix, size, stamp.ledAnode, stamp.ledCathode, ledConductance);
            rhs[stamp.ledAnode] -= ledEquivalent;
            rhs[stamp.ledCathode] += ledEquivalent;

            // Generic exponential by default (bit-identical to the previous law, and to every
            // part in the shared catalog bucket that carries no cited current-resistance curve).
            // A part with one -- VTL5C2 is the first -- gets `ohms = coefficient * amps^exponent`
            // instead, clamped to [ldrMinOhms, ldrMaxOhms]; identical to reference-runtime.ts,
            // which `test-v2-wasm-parity.ts` compares against.
            double rLdr;
            if (stamp.ldrPowerLawCoefficientOhms.has_value() && stamp.ldrPowerLawExponent.has_value()) {
                double powerLawCurrent = std::max(ledCurrent, 0.0);
                double raw = stamp.ldrPowerLawCoefficientOhms.value() *
                    std::pow(powerLawCurrent, stamp.ldrPowerLawExponent.value());
                rLdr = std::min(std::max(raw, stamp.ldrMinOhms), stamp.ldrMaxOhms);
            } else {
                double alpha = 1000.0;
                rLdr = stamp.ldrMinOhms + (stamp.ldrMaxOhms - stamp.ldrMinOhms) * std::exp(-alpha * ledCurrent);
            }
            double gLdr = std::max(1.0 / rLdr, 1e-12);
            stampConductance(matrix, size, stamp.ldrA, stamp.ldrB, gLdr);
            break;
        }

        case StampKind::AnalogSwitch: {
            double vA = solution[stamp.a];
            double vB = solution[stamp.b];
            double vCtrl = solution[stamp.controlNode];

            double across = vA - vB;
            double vDiff = vCtrl - stamp.thresholdVolts;

            double alpha = 10.0;
            double sigmoid = 1.0 / (1.0 + std::exp(std::max(-80.0, std::min(-alpha * vDiff, 80.0))));

            double gOn = 1.0 / stamp.onOhms;
            double gOff = 1.0 / stamp.offOhms;
            double g = gOff + (gOn - gOff) * sigmoid;

            double dSigmoid = alpha * sigmoid * (1.0 - sigmoid);
            double dg_dvCtrl = (gOn - gOff) * dSigmoid;

            double coupling = dg_dvCtrl * across;
            double residual = coupling * vCtrl;

            stampConductance(matrix, size, stamp.a, stamp.b, g);

            if (stamp.a != 0) {
                matrix[stamp.a * size + stamp.controlNode] += coupling;
                rhs[stamp.a] += residual;
            }
            if (stamp.b != 0) {
                matrix[stamp.b * size + stamp.controlNode] -= coupling;
                rhs[stamp.b] -= residual;
            }
            break;
        }

        case StampKind::Vccs: {
            double gm = stamp.transconductance;
            if (stamp.outP != 0) {
                if (stamp.inP != 0) matrix[stamp.outP * size + stamp.inP] += gm;
                if (stamp.inN != 0) matrix[stamp.outP * size + stamp.inN] -= gm;
                if (stamp.biasVolts != 0.0) {
                    rhs[stamp.outP] += gm * stamp.biasVolts;
                }
            }
            if (stamp.outN != 0) {
                if (stamp.inP != 0) matrix[stamp.outN * size + stamp.inP] -= gm;
                if (stamp.inN != 0) matrix[stamp.outN * size + stamp.inN] += gm;
                if (stamp.biasVolts != 0.0) {
                    rhs[stamp.outN] -= gm * stamp.biasVolts;
                }
            }
            break;
        }

        case StampKind::Transformer: {
            int32_t row = block.nodeCount + stamp.sourceIndex;
            double n = stamp.turnsRatio;
            matrix[row * size + stamp.primaryPlus] += 1.0;
            matrix[row * size + stamp.primaryMinus] -= 1.0;
            matrix[row * size + stamp.secondaryPlus] -= n;
            matrix[row * size + stamp.secondaryMinus] += n;
            matrix[stamp.primaryPlus * size + row] += 1.0;
            matrix[stamp.primaryMinus * size + row] -= 1.0;
            matrix[stamp.secondaryPlus * size + row] -= n;
            matrix[stamp.secondaryMinus * size + row] += n;
            rhs[row] = 0.0;
            break;
        }

        case StampKind::Triode: {
            double cathodeVolts = solution[stamp.cathode];
            double rawVgk = solution[stamp.grid] - cathodeVolts;
            double rawVpk = solution[stamp.plate] - cathodeVolts;
            double prevVgk = 0.0;
            double prevVpk = 0.0;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->triodeHistory.size())) {
                prevVgk = scratchPtr->triodeHistory[stampIdx].vgk;
                prevVpk = scratchPtr->triodeHistory[stampIdx].vpk;
            } else {
                uint64_t triodeKey = packHistoryKey3(blockIndex, stamp.grid, stamp.cathode, stamp.plate);
                auto it = triodeHistory_.find(triodeKey);
                if (it != triodeHistory_.end()) {
                    prevVgk = it->second.vgk;
                    prevVpk = it->second.vpk;
                }
            }

            double vgk = dc ? rawVgk : limitTriodeGridStep(rawVgk, prevVgk);
            bool conducting = rawVpk > 0.0 && rawVgk > kTriodeGridCutoffThresholdVolts;
            double vpk = dc ? rawVpk : (conducting ? limitTriodeStep(rawVpk, std::max(prevVpk, 0.0), kTriodePlateStepVolts) : rawVpk);

            if (vgk != rawVgk || vpk != rawVpk) {
                limitedIterate_ = true;
            }
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->triodeHistory.size())) {
                scratchPtr->triodeHistory[stampIdx] = TriodeHistory{ vgk, vpk, 0.0 };
            } else {
                uint64_t triodeKey = packHistoryKey3(blockIndex, stamp.grid, stamp.cathode, stamp.plate);
                triodeHistory_[triodeKey] = TriodeHistory{ vgk, vpk, 0.0 };
            }

            double denominator = std::sqrt(stamp.kvb + vpk * vpk);
            double inner = stamp.kp * (1.0 / stamp.mu + (vgk + stamp.contactPotentialVolts) / denominator);
            double softened = inner > 40.0 ? inner : (inner < -40.0 ? std::exp(inner) : std::log1p(std::exp(inner)));
            double vpkEff = vpk > 20.0 ? vpk : (vpk < -20.0 ? std::exp(vpk) : std::log1p(std::exp(vpk)));
            double vpkSigmoid = vpk > 20.0 ? 1.0 : (vpk < -20.0 ? std::exp(vpk) : 1.0 / (1.0 + std::exp(-vpk)));
            double e1 = (vpkEff / stamp.kp) * softened;

            double plateCurrent = 0.0;
            double gm = 0.0;
            double gp = 0.0;
            if (e1 > 0.0) {
                plateCurrent = (2.0 / stamp.kg1) * std::pow(e1, stamp.ex);
                double dIdE1 = stamp.ex * plateCurrent / e1;
                double sigmoid = inner > 40.0 ? 1.0 : (inner < -40.0 ? std::exp(inner) : 1.0 / (1.0 + std::exp(-inner)));
                double dInnerDVgk = stamp.kp / denominator;
                double dInnerDVpk = -stamp.kp * (vgk + stamp.contactPotentialVolts) * vpk / (denominator * (stamp.kvb + vpk * vpk));
                double dE1DVgk = (vpkEff / stamp.kp) * sigmoid * dInnerDVgk;
                double dE1DVpk = (vpkSigmoid * softened) / stamp.kp + (vpkEff / stamp.kp) * sigmoid * dInnerDVpk;
                gm = dIdE1 * dE1DVgk;
                gp = dIdE1 * dE1DVpk;
            }
            gp += 1e-12;

            double gridCurrent = 0.0;
            double gg = 0.0;
            double over = vgk - stamp.gridOnsetVolts;
            if (over > -40.0 * stamp.gridScaleVolts) {
                double x = over / stamp.gridScaleVolts;
                double softened = x > 40.0 ? x : (x < -40.0 ? std::exp(x) : std::log1p(std::exp(x)));
                gridCurrent = stamp.gridSaturationCurrent * softened;
                double sigmoid = x > 40.0 ? 1.0 : (x < -40.0 ? std::exp(x) : 1.0 / (1.0 + std::exp(-x)));
                gg = (stamp.gridSaturationCurrent / stamp.gridScaleVolts) * sigmoid;
            }

            int32_t p = stamp.plate;
            int32_t k = stamp.cathode;
            int32_t g = stamp.grid;

            matrix[p * size + g] += gm;
            matrix[p * size + p] += gp;
            matrix[p * size + k] -= gm + gp;
            matrix[k * size + g] -= gm;
            matrix[k * size + p] -= gp;
            matrix[k * size + k] += gm + gp;

            double equivalent = plateCurrent - (gm * vgk + gp * vpk);
            rhs[p] -= equivalent;
            rhs[k] += equivalent;

            matrix[g * size + g] += gg;
            matrix[g * size + k] -= gg;
            matrix[k * size + g] -= gg;
            matrix[k * size + k] += gg;

            double gridEquivalent = gridCurrent - gg * vgk;
            rhs[g] -= gridEquivalent;
            rhs[k] += gridEquivalent;
            break;
        }

        case StampKind::Pentode: {
            double cathodeVolts = solution[stamp.cathode];
            double rawVgk = solution[stamp.grid] - cathodeVolts;
            double rawVsk = solution[stamp.screen] - cathodeVolts;
            double rawVpk = solution[stamp.plate] - cathodeVolts;
            double prevVgk = 0.0;
            double prevVpk = 0.0;
            double prevVsk = rawVsk;
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->triodeHistory.size())) {
                prevVgk = scratchPtr->triodeHistory[stampIdx].vgk;
                prevVpk = scratchPtr->triodeHistory[stampIdx].vpk;
                prevVsk = scratchPtr->triodeHistory[stampIdx].vsk;
            } else {
                uint64_t pentodeKey = packHistoryKey3(blockIndex, stamp.grid, stamp.cathode, stamp.plate);
                auto it = triodeHistory_.find(pentodeKey);
                if (it != triodeHistory_.end()) {
                    prevVgk = it->second.vgk;
                    prevVpk = it->second.vpk;
                    prevVsk = it->second.vsk;
                }
            }

            double vgk = dc ? rawVgk : limitTriodeGridStep(rawVgk, prevVgk);
            bool conducting = rawVpk > 0.0 && rawVgk > kTriodeGridCutoffThresholdVolts;
            double vpk = dc ? rawVpk : (rawVpk > 0.0 ? limitTriodeStep(rawVpk, std::max(prevVpk, 0.0), kTriodePlateStepVolts) : rawVpk);
            double vsk = dc ? rawVsk : (conducting ? limitTriodeStep(rawVsk, std::max(prevVsk, 0.0), kTriodePlateStepVolts) : rawVsk);

            if (vgk != rawVgk || vpk != rawVpk || vsk != rawVsk) {
                limitedIterate_ = true;
            }
            if (scratchPtr && stampIdx >= 0 && stampIdx < static_cast<int32_t>(scratchPtr->triodeHistory.size())) {
                scratchPtr->triodeHistory[stampIdx] = TriodeHistory{ vgk, vpk, vsk };
            } else {
                uint64_t pentodeKey = packHistoryKey3(blockIndex, stamp.grid, stamp.cathode, stamp.plate);
                triodeHistory_[pentodeKey] = TriodeHistory{ vgk, vpk, vsk };
            }

            double vpkEff = std::max(vpk, 0.0);
            double vskEff = std::max(vsk, 0.0);
            double denominator = std::sqrt(stamp.kvb + vskEff * vskEff);
            double inner = stamp.kp * (1.0 / stamp.mu + (vgk + stamp.contactPotentialVolts) / denominator);
            double softened = inner > 40.0 ? inner : (inner < -40.0 ? std::exp(inner) : std::log1p(std::exp(inner)));
            double e1 = (vskEff / stamp.kp) * softened;
            double gate = std::atan(vpkEff / stamp.kvb);

            double plateCurrent = 0.0;
            double gm = 0.0;
            double gs = 0.0;
            double gp = 0.0;
            if (e1 > 0.0 && vpkEff > 0.0) {
                double cathodeCurrent = (2.0 / stamp.kg1) * std::pow(e1, stamp.ex);
                plateCurrent = cathodeCurrent * gate;
                double dIdE1 = stamp.ex * cathodeCurrent / e1;
                double sigmoid = inner > 40.0 ? 1.0 : (inner < -40.0 ? std::exp(inner) : 1.0 / (1.0 + std::exp(-inner)));
                double dE1DVgk = (vskEff / stamp.kp) * sigmoid * (stamp.kp / denominator);
                double dInnerDVsk = -stamp.kp * (vgk + stamp.contactPotentialVolts) * vskEff / (denominator * (stamp.kvb + vskEff * vskEff));
                double dE1DVsk = softened / stamp.kp + (vskEff / stamp.kp) * sigmoid * dInnerDVsk;
                gm = dIdE1 * dE1DVgk * gate;
                gs = dIdE1 * dE1DVsk * gate;
                gp = (cathodeCurrent * stamp.kvb) / (stamp.kvb * stamp.kvb + vpkEff * vpkEff);
            }
            gp += 1e-12;

            double gridCurrent = 0.0;
            double gg = 0.0;
            double pentodeOver = vgk - stamp.gridOnsetVolts;
            if (pentodeOver > -40.0 * stamp.gridScaleVolts) {
                double x = pentodeOver / stamp.gridScaleVolts;
                double softenedGrid = x > 40.0 ? x : (x < -40.0 ? std::exp(x) : std::log1p(std::exp(x)));
                gridCurrent = stamp.gridSaturationCurrent * softenedGrid;
                double sigmoid = x > 40.0 ? 1.0 : (x < -40.0 ? std::exp(x) : 1.0 / (1.0 + std::exp(-x)));
                gg = (stamp.gridSaturationCurrent / stamp.gridScaleVolts) * sigmoid;
            }

            int32_t pp = stamp.plate;
            int32_t kk = stamp.cathode;
            int32_t gg1 = stamp.grid;
            int32_t ss = stamp.screen;

            matrix[pp * size + gg1] += gm;
            matrix[pp * size + ss] += gs;
            matrix[pp * size + pp] += gp;
            matrix[pp * size + kk] -= gm + gs + gp;
            matrix[kk * size + gg1] -= gm;
            matrix[kk * size + ss] -= gs;
            matrix[kk * size + pp] -= gp;
            matrix[kk * size + kk] += gm + gs + gp;

            double pentodeEquivalent = plateCurrent - (gm * vgk + gs * vsk + gp * vpk);
            rhs[pp] -= pentodeEquivalent;
            rhs[kk] += pentodeEquivalent;

            // Screen<->cathode source: a share of the plate current, not a constant. Its
            // linearization is screenShare times the plate source's (gm, gs, gp). 0/absent is a
            // no-op, so a law without a screen figure behaves exactly as before.
            if (stamp.screenShare > 0.0) {
                double screenCurrent = plateCurrent * stamp.screenShare;
                double screenEquivalent =
                    screenCurrent - stamp.screenShare * (gm * vgk + gs * vsk + gp * vpk);
                rhs[ss] -= screenEquivalent;
                rhs[kk] += screenEquivalent;
                matrix[ss * size + gg1] += stamp.screenShare * gm;
                matrix[ss * size + ss] += stamp.screenShare * gs;
                matrix[ss * size + pp] += stamp.screenShare * gp;
                matrix[ss * size + kk] -= stamp.screenShare * (gm + gs + gp);
                matrix[kk * size + gg1] -= stamp.screenShare * gm;
                matrix[kk * size + ss] -= stamp.screenShare * gs;
                matrix[kk * size + pp] -= stamp.screenShare * gp;
                matrix[kk * size + kk] += stamp.screenShare * (gm + gs + gp);
            }

            matrix[gg1 * size + gg1] += gg;
            matrix[gg1 * size + kk] -= gg;
            matrix[kk * size + gg1] -= gg;
            matrix[kk * size + kk] += gg;

            double pentodeGridEquivalent = gridCurrent - gg * vgk;
            rhs[gg1] -= pentodeGridEquivalent;
            rhs[kk] += pentodeGridEquivalent;
            break;
        }

        case StampKind::TubeDiode: {
            double across = solution[stamp.plate] - solution[stamp.cathode];
            double forward = std::max(across, 0.0);
            double current = stamp.perveance * std::pow(forward, stamp.exponent);
            double conductance = std::max(
                forward > 0.0 ? (stamp.exponent * current / forward) : 0.0,
                1e-12
            );
            double equivalent = current - conductance * across;
            stampConductance(matrix, size, stamp.plate, stamp.cathode, conductance);
            rhs[stamp.plate] -= equivalent;
            rhs[stamp.cathode] += equivalent;
            break;
        }

        case StampKind::LogicDivider: {
            int32_t stateIdx = stamp.stateIndex;
            std::string dividerKey = block.id + "_ff_" + std::to_string(stateIdx);
            auto lsIt = lastShiftedSample_.find(dividerKey);
            int64_t lastShifted = (lsIt != lastShiftedSample_.end()) ? lsIt->second : -1;
            if (static_cast<int64_t>(elapsedSamples_) != lastShifted) {
                lastShiftedSample_[dividerKey] = static_cast<int64_t>(elapsedSamples_);
                double vClkPrev = state[stateIdx + 1];
                double vClk = solution[stamp.clockNode] - solution[stamp.gndNode];
                if (vClkPrev < stamp.thresholdVolts && vClk >= stamp.thresholdVolts) {
                    state[stateIdx] = 1.0 - state[stateIdx];
                }
                state[stateIdx + 1] = vClk;
            }

            double Q = state[stateIdx];
            int32_t row = block.nodeCount + stamp.sourceIndex;
            matrix[row * size + stamp.qNode] += 1.0;
            matrix[stamp.qNode * size + row] += 1.0;
            matrix[row * size + stamp.gndNode] -= 1.0;
            matrix[stamp.gndNode * size + row] -= 1.0;
            matrix[row * size + row] -= 1.0;
            rhs[row] = Q * stamp.highVolts;
            break;
        }

        case StampKind::Ota: {
            double vPlus = solution[stamp.plus];
            double vMinus = solution[stamp.minus];
            double vBias = solution[stamp.bias];
            double vVee = solution[stamp.vee];

            double vDiff = vPlus - vMinus;
            double vBiasAcross = vBias - vVee;

            double is = stamp.saturationCurrent;
            double vt = stamp.thermalVoltage;
            double expBias = std::exp(std::max(-80.0, std::min(vBiasAcross / vt, 80.0)));
            double iAbc = is * (expBias - 1.0);

            double gBias = (is / vt) * expBias;

            stampConductance(matrix, size, stamp.bias, stamp.vee, gBias);

            double iAbcResidual = iAbc - gBias * vBiasAcross;
            if (stamp.bias != 0) {
                rhs[stamp.bias] -= iAbcResidual;
            }
            if (stamp.vee != 0) {
                rhs[stamp.vee] += iAbcResidual;
            }

            if (iAbc > 0.0) {
                double tanhVal = std::tanh(vDiff / (2.0 * vt));
                double sechVal = 1.0 / std::cosh(vDiff / (2.0 * vt));
                double sech2 = sechVal * sechVal;

                double iOut = 2.0 * iAbc * tanhVal;

                double gDiff = (iAbc / vt) * sech2;
                double gBiasCtrl = 2.0 * gBias * tanhVal;

                if (stamp.output != 0) {
                    if (stamp.plus != 0) {
                        matrix[stamp.output * size + stamp.plus] -= gDiff;
                    }
                    if (stamp.minus != 0) {
                        matrix[stamp.output * size + stamp.minus] += gDiff;
                    }
                    if (stamp.bias != 0) {
                        matrix[stamp.output * size + stamp.bias] -= gBiasCtrl;
                    }
                    if (stamp.vee != 0) {
                        matrix[stamp.output * size + stamp.vee] += gBiasCtrl;
                    }

                    double iOutResidual = iOut - gDiff * vDiff - gBiasCtrl * vBiasAcross;
                    rhs[stamp.output] += iOutResidual;
                }
            }
            break;
        }

        case StampKind::LinearVca: {
            // Bit-identical mirror of reference-runtime.ts `case "linear-vca"`:
            // leaving-positive KCL (matrix carries d(leaving)/dV, rhs carries
            // -(I0 - dI*V0) like the diode), voltage-sense control drawing no
            // current. The physical current ENTERS the output node, so every
            // term below is negated once from the entering-positive form.
            double vPlus = solution[stamp.plus];
            double vMinus = solution[stamp.minus];
            double vControl = solution[stamp.controlNode];
            double vref = stamp.vrefVolts > 0.0 ? stamp.vrefVolts : 1.0;
            double vIn = vPlus - vMinus;
            double iIn = vIn * stamp.inputSiemens;
            double vc = vControl - vMinus;
            bool overFloor = vc / vref > stamp.minGain;
            double gain = overFloor ? vc / vref : stamp.minGain;
            double dGain = overFloor ? 1.0 / vref : 0.0;
            // Halved once: the datasheet's 0 dB condition (note 1, p.5-86)
            // forces the cell current ratio to 1/2 at Vc = Vref. See the
            // matching comment in reference-runtime.ts.
            double iOut = (iIn * gain) / 2.0;
            double gIn = (gain * stamp.inputSiemens) / 2.0;
            double gCtrl = (iIn * dGain) / 2.0;
            double leaving = -iOut;
            double equivalent = leaving - (-gIn * vPlus + (gIn + gCtrl) * vMinus - gCtrl * vControl);
            if (stamp.output != 0) {
                if (stamp.plus != 0) {
                    matrix[stamp.output * size + stamp.plus] += -gIn;
                }
                if (stamp.minus != 0) {
                    matrix[stamp.output * size + stamp.minus] += gIn + gCtrl;
                }
                if (stamp.controlNode != 0) {
                    matrix[stamp.output * size + stamp.controlNode] += -gCtrl;
                }
                rhs[stamp.output] -= equivalent;
            }
            break;
        }

        case StampKind::Compandor: {
            int32_t stateIdx = stamp.stateIndex;
            double vref = solution[stamp.vref];

            std::string envelopeKey = block.id + "_env_" + std::to_string(stateIdx);
            auto it = lastShiftedSample_.find(envelopeKey);
            int64_t lastShifted = (it != lastShiftedSample_.end()) ? it->second : -1;
            if (static_cast<int64_t>(elapsedSamples_) != lastShifted) {
                lastShiftedSample_[envelopeKey] = static_cast<int64_t>(elapsedSamples_);
                state[stateIdx] = std::abs(solution[stamp.rectIn] - vref) / stamp.r1;
                double iG = std::max(0.0, (2.0 * solution[stamp.rectCap]) / stamp.r5);
                state[stateIdx + 1] = iG / stamp.iBias / stamp.r2;
            }

            if (stamp.rectCap != 0) {
                rhs[stamp.rectCap] += state[stateIdx];
            }

            double gCell = state[stateIdx + 1];
            if (stamp.sumNode != 0) {
                if (stamp.cellIn != 0) {
                    matrix[stamp.sumNode * size + stamp.cellIn] -= gCell;
                }
                if (stamp.vref != 0) {
                    matrix[stamp.sumNode * size + stamp.vref] += gCell;
                }
            }
            break;
        }


        case StampKind::ClockDriver: {
            double vOx1 = (stamp.ox1 >= 0 && stamp.ox1 < size) ? solution[stamp.ox1] : 2.5;

            int32_t stateIdx = stamp.stateIndex;
            double theta = state[stateIdx];

            double fScale = vOx1 > 0.0 ? vOx1 / 2.5 : 1.0;
            double f = std::max(1000.0, std::min(500000.0, stamp.defaultFrequency * fScale));

            std::string lastShiftedKey = block.id + "_clk_" + std::to_string(stamp.sourceIndex);
            auto lsIt = lastShiftedSample_.find(lastShiftedKey);
            int64_t lastShifted = (lsIt != lastShiftedSample_.end()) ? lsIt->second : -1;
            if (static_cast<int64_t>(elapsedSamples_) != lastShifted) {
                lastShiftedSample_[lastShiftedKey] = static_cast<int64_t>(elapsedSamples_);
                theta = std::fmod(theta + dt * f, 1.0);
                state[stateIdx] = theta;
            }

            // The phases swing between the part's two supply pins, not between VDD and circuit
            // ground -- see `reference-runtime.ts`'s clock-driver case for why, and note this is
            // bit-identical to the previous version whenever the GND pin is at circuit ground.
            const auto couple = [&](int32_t source, int32_t row, double weight) {
                if (source > 0) {
                    matrix[row * size + source] -= weight;
                }
            };

            int32_t row1 = block.nodeCount + stamp.sourceIndex;
            matrix[row1 * size + stamp.cp1] += 1.0;
            matrix[stamp.cp1 * size + row1] += 1.0;
            couple(theta < 0.5 ? stamp.vdd : stamp.gnd, row1, 1.0);
            matrix[row1 * size + row1] -= 1.0;
            rhs[row1] = 0.0;

            int32_t row2 = block.nodeCount + stamp.sourceIndex + 1;
            matrix[row2 * size + stamp.cp2] += 1.0;
            matrix[stamp.cp2 * size + row2] += 1.0;
            couple(theta >= 0.5 ? stamp.vdd : stamp.gnd, row2, 1.0);
            matrix[row2 * size + row2] -= 1.0;
            rhs[row2] = 0.0;

            int32_t row3 = block.nodeCount + stamp.sourceIndex + 2;
            matrix[row3 * size + stamp.vgg] += 1.0;
            matrix[stamp.vgg * size + row3] += 1.0;
            couple(stamp.vdd, row3, 14.0 / 15.0);
            couple(stamp.gnd, row3, 1.0 / 15.0);
            matrix[row3 * size + row3] -= 1.0;
            rhs[row3] = 0.0;
            break;
        }

        case StampKind::Comparator: {
            double vPlus = solution[stamp.plus];
            double vMinus = solution[stamp.minus];
            double vOutput = solution[stamp.output];
            double vVee = solution[stamp.vee];

            double vDiff = vPlus - vMinus;
            double k = stamp.sensitivity;

            double expArg = k * vDiff;
            double sigmoidVal = (expArg > 80.0) ? 0.0 : ((expArg < -80.0) ? 1.0 : 1.0 / (1.0 + std::exp(expArg)));

            double gOn = 1.0 / stamp.pullDownOhms;
            double gOff = 1.0 / stamp.floatOhms;
            double gCell = gOn * sigmoidVal + gOff;

            // The value term: an ordinary conductance between output and vee at this
            // iterate's gCell, linear in (v(output) - v(vee)) and needing no companion.
            stampConductance(matrix, size, stamp.output, stamp.vee, gCell);

            // The control term. d/dvDiff [1/(1 + exp(k*vDiff))] = -k*sigma*(1 - sigma), so
            // the slope is negative: raising v(+) shrinks the pull-down conductance and lets
            // the output rise. Kept identical to reference-runtime.ts, which is what
            // scripts/test-v2-wasm-parity.ts compares. See
            // docs/troubleshootings/the-comparator-stamp-responds-backwards.md.
            double dSigmoid = -k * sigmoidVal * (1.0 - sigmoidVal);
            double gControl = gOn * dSigmoid * (vOutput - vVee);

            if (stamp.output != 0) {
                if (stamp.plus != 0) {
                    matrix[stamp.output * size + stamp.plus] += gControl;
                }
                if (stamp.minus != 0) {
                    matrix[stamp.output * size + stamp.minus] -= gControl;
                }
            }
            if (stamp.vee != 0) {
                if (stamp.plus != 0) {
                    matrix[stamp.vee * size + stamp.plus] -= gControl;
                }
                if (stamp.minus != 0) {
                    matrix[stamp.vee * size + stamp.minus] += gControl;
                }
            }

            // Companion current, in the convention the OTA's bias diode uses:
            // rhs[node] -= (constant current leaving node).
            double controlResidual = -gControl * vDiff;
            if (stamp.output != 0) {
                rhs[stamp.output] -= controlResidual;
            }
            if (stamp.vee != 0) {
                rhs[stamp.vee] += controlResidual;
            }
            break;
        }

        case StampKind::SpringReverb: {
            double conductance = 1.0 / std::max(stamp.inputOhms, MIN_STAMP_OHMS);
            stampConductance(matrix, size, stamp.inputPlus, stamp.inputMinus, conductance);

            int32_t row = block.nodeCount + stamp.sourceIndex;
            matrix[row * size + stamp.outputPlus] += 1.0;
            matrix[stamp.outputPlus * size + row] += 1.0;
            matrix[row * size + stamp.outputMinus] -= 1.0;
            matrix[stamp.outputMinus * size + row] -= 1.0;
            matrix[row * size + row] -= stamp.outputOhms;

            std::string key = block.id + ":" + std::to_string(stamp.sourceIndex);
            auto it = springOutputVolts_.find(key);
            double outVolts = (it != springOutputVolts_.end()) ? it->second : 0.0;
            rhs[row] = outVolts * sourceScale;
            break;
        }

        default:
            throw std::runtime_error("unimplemented stamp kind: " + stamp.kindStr);
    }
}

void Engine::advanceSpringReverb(const Block& block, const Stamp& stamp, const double* solution, double sampleRate) {
    std::string key = block.id + ":" + std::to_string(stamp.sourceIndex);
    auto it = springStates_.find(key);
    if (it == springStates_.end()) {
        SpringTankState st;
        for (double ratio : { 1.0, 34.0 / 29.0, 41.0 / 29.0 }) {
            int32_t samples = std::max(1, static_cast<int32_t>(std::round(stamp.delaySeconds * ratio * sampleRate)));
            double transit = static_cast<double>(samples) / sampleRate;
            double feedback = (stamp.decaySeconds > 0.0) ? std::pow(10.0, (-3.0 * transit) / stamp.decaySeconds) : 0.0;
            SpringLine line;
            line.buffer.resize(samples, 0.0);
            line.writeIndex = 0;
            line.feedback = feedback;
            line.allpassX.resize(stamp.dispersionStages, 0.0);
            line.allpassY.resize(stamp.dispersionStages, 0.0);
            st.lines.push_back(std::move(line));
        }
        st.transduction = std::sqrt(std::max(stamp.outputOhms, MIN_STAMP_OHMS) / std::max(stamp.inputOhms, MIN_STAMP_OHMS));
        st.driveX1 = 0.0;
        st.driveY1 = 0.0;
        springStates_[key] = std::move(st);
        it = springStates_.find(key);
    }

    auto& state = it->second;
    double rawDrive = solution[stamp.inputPlus] - solution[stamp.inputMinus];
    double r = std::exp((-2.0 * M_PI * 5.0) / sampleRate);
    double drive = rawDrive - state.driveX1 + r * state.driveY1;
    state.driveX1 = rawDrive;
    state.driveY1 = drive;

    double sum = 0.0;
    for (auto& line : state.lines) {
        double read = line.buffer.empty() ? 0.0 : line.buffer[line.writeIndex];
        double dispersed = read;
        for (size_t stage = 0; stage < line.allpassX.size(); ++stage) {
            double x = dispersed;
            double y = SPRING_DISPERSION_COEFFICIENT * x + line.allpassX[stage] - SPRING_DISPERSION_COEFFICIENT * line.allpassY[stage];
            line.allpassX[stage] = x;
            line.allpassY[stage] = y;
            dispersed = y;
        }
        sum += dispersed;
        if (!line.buffer.empty()) {
            line.buffer[line.writeIndex] = drive + line.feedback * dispersed;
            line.writeIndex = (line.writeIndex + 1) % line.buffer.size();
        }
    }
    double outVolts = state.lines.empty() ? 0.0 : (state.transduction * sum) / state.lines.size();
    springOutputVolts_[key] = outVolts;
}

double Engine::processMnaBlock(size_t blockIdx, double inputSample) {
    const auto& block = program_.blocks[blockIdx];
    auto& scratch = blockScratch_[blockIdx];
    auto& state = blockStates_[blockIdx];
    auto& previous = blockOperatingPoints_[blockIdx];
    double dt = 1.0 / options_.sampleRate;

    std::fill(scratch.opampHistory.begin(), scratch.opampHistory.end(), OpAmpHistory{});

    if (!scratch.eliminate) {
        // Set when `controlMatrix` is rebuilt wholesale, which invalidates every untouched cell of
        // `sampleMatrix` and forces the full copy below.
        bool controlsRebuilt = false;
        if (scratch.cachedControlGen != controlGeneration_) {
            scratch.controlMatrix = scratch.baseMatrix;
            scratch.controlRhs = scratch.baseRhs;
            std::vector<double> emptyState(block.stateCount * 2 + 16, 0.0);
            std::vector<double> emptySolution(scratch.size, 0.0);
            for (int32_t cIdx : scratch.controlStampIndices) {
                applyStamp(
                    block.stamps[cIdx],
                    scratch.controlMatrix.data(),
                    scratch.controlRhs.data(),
                    scratch.size,
                    block,
                    dt,
                    emptyState,
                    emptySolution.data(),
                    0.0,
                    false,
                    1.0,
                    static_cast<int32_t>(blockIdx),
                    cIdx
                );
            }
            for (int32_t col = 0; col < scratch.size; ++col) {
                scratch.controlMatrix[0 * scratch.size + col] = 0.0;
            }
            scratch.controlMatrix[0] = 1.0;
            scratch.controlRhs[0] = 0.0;
            scratch.cachedControlGen = controlGeneration_;
            controlsRebuilt = true;
        }

        // **CALIBRATION SHOT (2026-09-12): the per-sample N^2 copy, removed.**
        //
        // `sampleMatrix = controlMatrix` copied size*size doubles every sample so that the handful
        // of capacitor and inductor companions could be stamped onto a clean base. Everything
        // outside those companions' cells is identical between the two matrices on every sample, so
        // the copy rewrites the whole matrix to change a few hundred entries -- 8281 doubles on
        // `peavey-5150` to refresh about 230.
        //
        // Refreshing only the registered cells is bit-identical, NOT approximate: the untouched
        // cells already hold exactly `controlMatrix`'s values, because nothing else writes
        // `sampleMatrix` between samples (`iterate` reads it and writes `matrix`). The one case
        // where that invariant breaks is a control change, which rebuilds `controlMatrix` wholesale
        // and leaves every untouched cell of `sampleMatrix` stale -- so that path still copies.
        //
        // Two predictions were registered before this was measured, and they disagree, which is why
        // this change is worth making on its own rather than folded into a larger one. Sampling put
        // this copy at 4.0/4.6/4.6% of runtime on 5150/sunn/rockerverb, predicting 1.04-1.05x.
        // Ablation put it at ~0 ns, predicting 1.00x, because repeating a copy hits warm cache and
        // ablation therefore under-measures memory-bound work. Whichever way the result lands, one
        // of the two instruments is corrected -- and both the superinstruction and sparse-operand
        // changes are priced with the same first-order method, on numbers nobody has validated.
        if (controlsRebuilt || scratch.touchedSampleMatrixOffsets.empty()) {
            scratch.sampleMatrix = scratch.controlMatrix;
            scratch.sampleRhs = scratch.controlRhs;
        } else {
            for (int32_t off : scratch.touchedSampleMatrixOffsets) {
                scratch.sampleMatrix[off] = scratch.controlMatrix[off];
            }
            for (int32_t row : scratch.touchedSampleRhsRows) {
                scratch.sampleRhs[row] = scratch.controlRhs[row];
            }
        }
        for (int32_t sIdx : scratch.sampleLinearStampIndices) {
            applyStamp(
                block.stamps[sIdx],
                scratch.sampleMatrix.data(),
                scratch.sampleRhs.data(),
                scratch.size,
                block,
                dt,
                state,
                previous.data(),
                inputSample,
                false,
                1.0,
                static_cast<int32_t>(blockIdx),
                sIdx
            );
        }
        for (int32_t col = 0; col < scratch.size; ++col) {
            scratch.sampleMatrix[0 * scratch.size + col] = 0.0;
        }
        scratch.sampleMatrix[0] = 1.0;
        scratch.sampleRhs[0] = 0.0;
    }

    SolveResult res;
    if (scratch.eliminate) {
        res = iterateEliminated(blockIdx, inputSample, dt, state, previous, scratch.solutionA.data(), false);
    } else {
        res = iterate(blockIdx, inputSample, dt, state, previous, scratch.solutionA.data(), false);
    }
#ifdef V2_PROFILE_TIMERS
    profile_totalSamples_++;
#endif

    lastIterationCount_ = res.used;
    lastConverged_ = res.converged;
    if (res.used > maxIterationsObserved_) {
        maxIterationsObserved_ = res.used;
    }

    double held = (block.outputNode.has_value() && *block.outputNode < scratch.size) ? previous[*block.outputNode] : 0.0;

    for (int32_t i = 0; i < scratch.size; ++i) {
        if (!std::isfinite(scratch.solutionA[i])) {
            return held;
        }
    }

    const double* stateSource = (!res.converged && res.worstDelta >= 0.05) ? previous.data() : scratch.solutionA.data();

    for (int32_t sIdx : scratch.statefulStampIndices) {
        const auto& stamp = block.stamps[sIdx];
        if (stamp.kind == StampKind::Capacitor) {
            double across = stateSource[stamp.a] - stateSource[stamp.b];
            double g = (2.0 * stamp.farads) / dt;
            double prevAcross = state[stamp.stateIndex];
            double prevCurrent = state[stamp.stateIndex + 1];
            state[stamp.stateIndex] = across;
            state[stamp.stateIndex + 1] = g * (across - prevAcross) - prevCurrent;
        } else if (stamp.kind == StampKind::Inductor) {
            double across = stateSource[stamp.a] - stateSource[stamp.b];
            double g = dt / (2.0 * stamp.henries);
            double prevAcross = state[stamp.stateIndex];
            double prevCurrent = state[stamp.stateIndex + 1];
            state[stamp.stateIndex] = across;
            state[stamp.stateIndex + 1] = prevCurrent + g * (across + prevAcross);
        } else if (stamp.kind == StampKind::IdealOpAmp && stamp.railHigh.has_value() && stamp.railLow.has_value()) {
            uint64_t key = packHistoryKey3(static_cast<int32_t>(blockIdx), stamp.plus, stamp.minus, stamp.output);
            double alpha = opAmpPoleAlpha(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, options_.sampleRate);
            double differential = stateSource[stamp.plus] - stateSource[stamp.minus];
            double prevRaw = (static_cast<size_t>(sIdx) < scratch.opampRawState.size()) ? scratch.opampRawState[sIdx] : 0.0;
            double nextRaw = boundOpAmpRaw(
                alpha * stamp.openLoopGain * differential + (1.0 - alpha) * prevRaw,
                opAmpHalfSwing(*stamp.railHigh, *stamp.railLow));
            if (static_cast<size_t>(sIdx) < scratch.opampRawState.size()) {
                scratch.opampRawState[sIdx] = nextRaw;
            }
            opampRawState_[key] = nextRaw;
        } else if (stamp.kind == StampKind::SpringReverb) {
            advanceSpringReverb(block, stamp, stateSource, options_.sampleRate);
        }
    }

    if (res.converged || res.worstDelta < 0.05) {
        previous = scratch.solutionA;
    }
    if (!res.converged) {
        return held;
    }
    return (block.outputNode.has_value() && *block.outputNode < scratch.size) ? scratch.solutionA[*block.outputNode] : 0.0;
}


int32_t Engine::composedDcPosition(const Block& block) {
    if (!block.router.has_value() || block.positions.size() <= 1 || block.router->positions < 2) return 0;
    const auto& router = *block.router;
    bool readable = true;
    double fraction = 0.0;
    if (router.port.has_value()) {
        if (router.port->referenceVolts > 0.0) {
            double volts = 0.0;
            auto sIt = blockIndexById_.find(router.port->block);
            if (sIt != blockIndexById_.end()) {
                size_t sIdx = sIt->second;
                int32_t node = router.port->node;
                if (node >= 0 && node < static_cast<int32_t>(blockOperatingPoints_[sIdx].size())) {
                    volts = blockOperatingPoints_[sIdx][node];
                }
            }
            fraction = std::abs(volts) / router.port->referenceVolts;
        } else {
            readable = false;
        }
    } else {
        fraction = getControl(router.controlId);
    }
    if (!readable || !std::isfinite(fraction)) return 0;
    const int32_t last = router.positions - 1;
    double scaled = std::round(fraction * static_cast<double>(last));
    if (scaled < 0.0) scaled = 0.0;
    if (scaled > static_cast<double>(last)) scaled = static_cast<double>(last);
    const size_t detent = static_cast<size_t>(scaled);
    int32_t posIdx = detent < router.routes.size() ? router.routes[detent] : -1;
    return posIdx;
}

bool Engine::composedDcTransfer(size_t blockIdx, double tap, double& gain, double& offset) {
    const auto& block = program_.blocks[blockIdx];
    gain = 0.0;
    offset = 0.0;
    int32_t posIdx = composedDcPosition(block);
    if (posIdx < 0 || posIdx >= static_cast<int32_t>(block.positions.size())) return false;
    const auto& position = block.positions[static_cast<size_t>(posIdx)];
    bool hasTap = false;
    for (const auto& op : position.ops) {
        if (op.op == PrimitiveOp::Op::DelayTap || op.op == PrimitiveOp::Op::DelayTapFractional ||
            op.op == PrimitiveOp::Op::DelayTapReverse || op.op == PrimitiveOp::Op::FilterDcblock ||
            op.op == PrimitiveOp::Op::Mix || op.op == PrimitiveOp::Op::DelayPush) {
            if (op.op == PrimitiveOp::Op::DelayTap || op.op == PrimitiveOp::Op::DelayTapFractional ||
                op.op == PrimitiveOp::Op::DelayTapReverse) hasTap = true;
        } else {
            return false;
        }
    }
    if (!hasTap) return false;
    auto evalOnce = [&](std::unordered_map<std::string, double>& lines, double tapValue) -> double {
        std::vector<double> temps(position.ops.size(), 0.0);
        for (size_t oi = 0; oi < position.ops.size(); ++oi) {
            const auto& op = position.ops[oi];
            if (op.op == PrimitiveOp::Op::DelayPush) {
                double value = tapValue;
                if (op.input.kind == PrimitiveOp::Source::Kind::Const) value = op.input.value;
                else if (op.input.kind == PrimitiveOp::Source::Kind::Temp) {
                    value = (op.input.temp >= 0 && static_cast<size_t>(op.input.temp) < temps.size()) ? temps[static_cast<size_t>(op.input.temp)] : 0.0;
                }
                lines[op.line] = value;
            } else if (op.op == PrimitiveOp::Op::FilterDcblock) {
                if (op.out >= 0 && static_cast<size_t>(op.out) < temps.size()) temps[static_cast<size_t>(op.out)] = 0.0;
            } else if (op.op == PrimitiveOp::Op::Mix) {
                double acc = 0.0;
                for (const auto& term : op.terms) {
                    double g = term.gain;
                    if (term.swept) {
                        TaperKind taper = TaperKind::Linear;
                        for (const auto& ctrl : program_.controls) {
                            if (ctrl.id == term.sweepControl) { taper = ctrl.taper; break; }
                        }
                        g = term.sweepMin + taperFraction(taper, getControl(term.sweepControl)) * (term.sweepMax - term.sweepMin);
                    }
                    double value = tapValue;
                    if (term.source.kind == PrimitiveOp::Source::Kind::Const) value = term.source.value;
                    else if (term.source.kind == PrimitiveOp::Source::Kind::Temp) {
                        value = (term.source.temp >= 0 && static_cast<size_t>(term.source.temp) < temps.size()) ? temps[static_cast<size_t>(term.source.temp)] : 0.0;
                    }
                    acc += value * g;
                }
                if (op.out >= 0 && static_cast<size_t>(op.out) < temps.size()) temps[static_cast<size_t>(op.out)] = acc;
            } else {
                double v = 0.0;
                auto lIt = lines.find(op.line);
                if (lIt != lines.end()) v = lIt->second;
                if (op.out >= 0 && static_cast<size_t>(op.out) < temps.size()) temps[static_cast<size_t>(op.out)] = v;
            }
        }
        if (position.out < 0 || static_cast<size_t>(position.out) >= temps.size()) return 0.0;
        return temps[static_cast<size_t>(position.out)];
    };
    auto settle = [&](double tapValue, double& settled) -> bool {
        std::unordered_map<std::string, double> lines;
        double previous = 0.0;
        bool havePrevious = false;
        for (int32_t pass = 0; pass < 1024; ++pass) {
            double published = evalOnce(lines, tapValue);
            if (havePrevious && std::abs(published - previous) <= 1e-12 * std::max(1.0, std::abs(published))) {
                settled = published;
                return true;
            }
            previous = published;
            havePrevious = true;
        }
        return false;
    };
    // Settle at the live tap first (proves the loop contracts); the affine
    // form then comes from two fresh settles, offset at tap 0, gain above it.
    double live = 0.0;
    if (!settle(tap, live)) return false;
    double atZero = 0.0;
    double atOne = 0.0;
    if (!settle(0.0, atZero)) return false;
    if (!settle(1.0, atOne)) return false;
    offset = atZero;
    gain = atOne - atZero;
    return true;
}

void Engine::processComposedBlock(size_t blockIdx) {
    const auto& block = program_.blocks[blockIdx];
    if (block.positions.empty()) return;
    // Which program is running, read from the selector pin the knob drives. Resolved
    // once per sample rather than per op: a mode cannot change mid-sample, and
    // re-reading it inside the loop would let a half-executed graph mix two programs'
    // temporaries.
    // -1 means the source declares no program at this detent, which is a statement rather
    // than a gap. Handled below by passing the input through.
    int32_t posIdx = 0;
    if (block.router.has_value() && block.positions.size() > 1 &&
        block.router->positions >= 2) {
        const auto& router = *block.router;
        // Two ways to reach the control, and the source says which. A node is the stronger
        // claim: the wiper drives something the solver produces. A scanned control has no
        // node, because the chip that reads it sits behind a path the source cannot state,
        // so the position is taken directly -- the road clockControl already travels.
        bool readable = true;
        double fraction = 0.0;
        if (router.port.has_value()) {
            if (router.port->referenceVolts > 0.0) {
                double volts = 0.0;
                auto sIt = blockIndexById_.find(router.port->block);
                if (sIt != blockIndexById_.end()) {
                    size_t sIdx = sIt->second;
                    int32_t node = router.port->node;
                    if (node >= 0 && node < static_cast<int32_t>(blockOperatingPoints_[sIdx].size())) {
                        volts = blockOperatingPoints_[sIdx][node];
                    }
                }
                fraction = std::abs(volts) / router.port->referenceVolts;
            } else {
                readable = false;
            }
        } else {
            fraction = getControl(router.controlId);
        }
        if (readable && std::isfinite(fraction)) {
            // **Detents, not an even split across declared programs.** An N-detent control
            // puts detent k at k/(N-1) of full scale, so the reading rounds to the nearest
            // detent. Dividing by the number of declared programs would smear four modes
            // across an eleven-position knob and land them where the undeclared ones live.
            const int32_t last = router.positions - 1;
            double scaled = std::round(fraction * static_cast<double>(last));
            if (scaled < 0.0) scaled = 0.0;
            if (scaled > static_cast<double>(last)) scaled = static_cast<double>(last);
            const size_t detent = static_cast<size_t>(scaled);
            posIdx = detent < router.routes.size() ? router.routes[detent] : -1;
        }
    }

    double tap = 0.0;
    if (block.audioIn.has_value()) {
        auto inIt = blockIndexById_.find(block.audioIn->block);
        if (inIt != blockIndexById_.end()) {
            size_t inIdx = inIt->second;
            int32_t node = block.audioIn->node;
            if (node >= 0 && node < static_cast<int32_t>(blockOperatingPoints_[inIdx].size())) {
                tap = blockOperatingPoints_[inIdx][node];
            }
        }
    }

    // A hold sampler's recording is erased when its program is selected afresh, as the TS console.
    {
        auto lastIt = lastComposedPosition_.find(block.id);
        if (lastIt == lastComposedPosition_.end() || lastIt->second != posIdx) {
            lastComposedPosition_[block.id] = posIdx;
            auto kIt = composedStateKeys_.find(block.id);
            if (kIt != composedStateKeys_.end() && posIdx >= 0 && static_cast<size_t>(posIdx) < kIt->second.size()) {
                auto lIt = composedLines_.find(kIt->second[static_cast<size_t>(posIdx)]);
                if (lIt != composedLines_.end()) {
                    for (auto& [_, line] : lIt->second) {
                        line.holdState = 0; line.holdLength = 0; line.holdIndex = 0; line.holdGateWas = false;
                    }
                }
            }
        }
    }
    if (posIdx < 0 || posIdx >= static_cast<int32_t>(block.positions.size())) {
        // A detent the source declares no program for. The chip is doing something the packet
        // does not model, so the block makes no claim and passes its input through. Publishing
        // zero would be silence, which is indistinguishable from a severed net.
        macroOutputVolts_[block.id] = tap;
        return;
    }

    const auto& position = block.positions[static_cast<size_t>(posIdx)];
    auto keysIt = composedStateKeys_.find(block.id);
    if (keysIt == composedStateKeys_.end() ||
        static_cast<size_t>(posIdx) >= keysIt->second.size()) return;
    const std::string& stateKey = keysIt->second[static_cast<size_t>(posIdx)];
    auto linesIt = composedLines_.find(stateKey);
    if (linesIt == composedLines_.end()) return;
    auto& lines = linesIt->second;
    double sampleRate = options_.sampleRate > 0.0 ? options_.sampleRate : 48000.0;


    std::vector<double> temps(position.ops.size(), 0.0);
    auto publish = [&](int32_t index, double value) {
        if (index < 0 || index >= static_cast<int32_t>(temps.size())) {
            throw std::runtime_error("composed block \"" + block.id + "\" addresses temp " + std::to_string(index) + " outside its op list");
        }
        temps[index] = value;
    };
    auto readSource = [&](const PrimitiveOp::Source& source) -> double {
        if (source.kind == PrimitiveOp::Source::Kind::Input) return tap;
        if (source.kind == PrimitiveOp::Source::Kind::Const) return source.value;
        if (source.temp >= 0 && source.temp < static_cast<int32_t>(temps.size())) return temps[source.temp];
        return 0.0;
    };
    // Read length with kernel shaping: DDL rounds whole samples above 1,
    // BBD reads fractionally above 0 with two headroom slots, and only its
    // parameter scale rounds. Mirrors the delay kernels branch for branch.
    // `op` rides along for the modes whose law constants travel per op
    // (`clock-law`); the other modes ignore it.
    auto tapLength = [&](PrimitiveOp::LengthMode mode, ComposedLine& line, double minLen, double headroom, bool roundLen, const PrimitiveOp* op = nullptr) -> double {
        double cap = static_cast<double>(line.lengthCapacity) - headroom;
        auto shape = [&](double x) -> double {
            double v = roundLen ? std::round(x) : x;
            return std::min(cap, std::max(minLen, v));
        };
        if (mode == PrimitiveOp::LengthMode::Clock) {
            if (std::abs(line.currentLengthSamples - line.targetLengthSamples) > 1e-6) {
                double alphaSmooth = 1.0 - std::exp(-1.0 / (0.010 * sampleRate));
                line.currentLengthSamples += (line.targetLengthSamples - line.currentLengthSamples) * alphaSmooth;
            } else {
                line.currentLengthSamples = line.targetLengthSamples;
            }
            return shape(line.currentLengthSamples);
        }
        if (mode == PrimitiveOp::LengthMode::Modulation && block.modulation.has_value()) {
            double modVolts = 0.0;
            auto mIt = blockIndexById_.find(block.modulation->block);
            if (mIt != blockIndexById_.end()) {
                size_t mIdx = mIt->second;
                int32_t node = block.modulation->node;
                if (node >= 0 && node < static_cast<int32_t>(blockOperatingPoints_[mIdx].size())) {
                    modVolts = blockOperatingPoints_[mIdx][node];
                }
            }
            auto dcIt = composedDc_.find(block.id);
            if (dcIt == composedDc_.end()) return cap;
            auto& dc = dcIt->second;
            if (!dc.modSeeded) {
                dc.modDcEstimate = modVolts;
                dc.modSeeded = true;
            } else {
                double alphaMod = 1.0 / (kModulationDcSeconds * sampleRate);
                dc.modDcEstimate += alphaMod * (modVolts - dc.modDcEstimate);
            }
            double base = line.targetLengthSamples;
            double denominator = std::abs(modVolts) < 1e-6 ? 1e-6 * (modVolts < 0.0 ? -1.0 : 1.0) : modVolts;
            double raw = dc.modDcEstimate / denominator;
            double scale = std::isfinite(raw) ? clamp(raw, kModulationScaleMin, kModulationScaleMax) : 1.0;
            return shape(base * scale);
        }
        if (mode == PrimitiveOp::LengthMode::ClockLaw && op != nullptr && block.clockLaw.has_value()) {
            // The open-OX2 relaxation law, absolute in the slow node's solved
            // voltage: delay = stages × R × C × ln((VDD − V0)/(VDD − Vth))
            // with V0 = max(V − Vf, floor). Mirrors the reference runtime's
            // `clock-law` branch guard for guard; the law constants travel in
            // the program, the 1e-9 floors are the contract between consoles.
            double volts = 0.0;
            auto cIt = blockIndexById_.find(block.clockLaw->block);
            if (cIt != blockIndexById_.end()) {
                size_t cIdx = cIt->second;
                int32_t node = block.clockLaw->node;
                if (node >= 0 && node < static_cast<int32_t>(blockOperatingPoints_[cIdx].size())) {
                    volts = blockOperatingPoints_[cIdx][node];
                }
            }
            double v0 = std::max(volts - op->clockLawVfVolts, op->clockLawFloorVolts);
            double chargeSpan = op->clockLawVddVolts - v0;
            double thresholdSpan = op->clockLawVddVolts - op->clockLawVthVolts;
            if (!(op->clockLawROhms > 0.0) || !(op->clockLawCFarads > 0.0) ||
                !(op->clockLawStages > 0.0) || !(chargeSpan > 1e-9) || !(thresholdSpan > 1e-9)) {
                return cap;
            }
            double chargeSeconds = op->clockLawROhms * op->clockLawCFarads * std::log(chargeSpan / thresholdSpan);
            if (!std::isfinite(chargeSeconds) || !(chargeSeconds > 0.0)) {
                return cap;
            }
            return shape(op->clockLawStages * chargeSeconds * sampleRate);
        }
        if (mode == PrimitiveOp::LengthMode::Parameter) {
            // Same two sources as the TS console's `composedParameterScale`, never both: a
            // scanned control by position through its taper, or a solved node against its
            // reference. Neither leaves the tap at capacity, the cited maximum.
            bool driven = false;
            double scale = 0.0;
            if (line.hasSweep && line.sweepTapped) {
                auto tIt = tapState_.find(line.sweepControl);
                double interval = (tIt != tapState_.end() && tIt->second.intervalSeconds > 0.0) ? tIt->second.intervalSeconds : -1.0;
                if (interval <= 0.0) {
                    // Untapped: the law's stated default interval, as the TS console.
                    for (const auto& ctrl : program_.controls) {
                        if (ctrl.id == line.sweepControl) { interval = ctrl.tapDefaultSeconds; break; }
                    }
                }
                if (interval > 0.0) {
                    double floor = std::min(cap, std::max(0.0, line.floorSamples));
                    double tapped = interval * line.sweepRatio * sampleRate;
                    return shape(std::min(cap, std::max(floor, tapped)));
                }
                return cap;
            }
            if (line.hasSweep) {
                TaperKind taper = TaperKind::Linear;
                for (const auto& ctrl : program_.controls) {
                    if (ctrl.id == line.sweepControl) { taper = ctrl.taper; break; }
                }
                scale = taperFraction(taper, getControl(line.sweepControl));
                driven = true;
            } else if (block.parameter.has_value() && block.parameter->referenceVolts > 0.0) {
                double volts = 0.0;
                auto pIt = blockIndexById_.find(block.parameter->block);
                if (pIt != blockIndexById_.end()) {
                    size_t pIdx = pIt->second;
                    int32_t node = block.parameter->node;
                    if (node >= 0 && node < static_cast<int32_t>(blockOperatingPoints_[pIdx].size())) {
                        volts = blockOperatingPoints_[pIdx][node];
                    }
                }
                scale = std::abs(volts) / block.parameter->referenceVolts;
                driven = true;
            }
            if (driven) {
                double floor = std::min(cap, std::max(0.0, line.floorSamples));
                return shape(floor + (cap - floor) * scale);
            }
        }
        return cap;
    };

    int32_t opPosition = 0;
    for (const auto& op : position.ops) {
        if (op.op == PrimitiveOp::Op::DelayTap || op.op == PrimitiveOp::Op::DelayTapFractional) {
            auto lIt = lines.find(op.line);
            if (lIt == lines.end()) return;
            auto& line = lIt->second;
            bool fractional = (op.op == PrimitiveOp::Op::DelayTapFractional);
            double effectiveLength;
            if (!fractional) {
                effectiveLength = tapLength(op.length, line, 1.0, 0.0, true);
                int32_t readIndex = (line.writeIndex - static_cast<int32_t>(effectiveLength) + line.capacity) % line.capacity;
                publish(op.out, line.buffer[readIndex]);
            } else {
                effectiveLength = tapLength(op.length, line, 0.0, 2.0, op.length == PrimitiveOp::LengthMode::Parameter, &op);
                double dInt = std::floor(effectiveLength);
                double frac = effectiveLength - dInt;
                int32_t readIndex0 = (line.writeIndex - static_cast<int32_t>(dInt) + line.capacity) % line.capacity;
                int32_t readIndex1 = (line.writeIndex - static_cast<int32_t>(dInt) - 1 + line.capacity) % line.capacity;
                double s0 = line.buffer[readIndex0];
                double s1 = line.buffer[readIndex1];
                publish(op.out, s0 + frac * (s1 - s0));
            }
        } else if (op.op == PrimitiveOp::Op::DelayTapReverse) {
            auto lIt = lines.find(op.line);
            if (lIt == lines.end()) return;
            auto& line = lIt->second;
            // Same law as the TS console's `reverseRead`: two heads half an even segment apart,
            // reading 2p + 1 back, weighted sin^2(pi p / L) so the weights sum to 1.
            double lengthSamples = tapLength(op.length, line, 2.0, 0.0, true);
            int32_t longest = 2 * (line.capacity / 4);
            int32_t segment = std::min(longest, std::max<int32_t>(2, 2 * static_cast<int32_t>(std::round(lengthSamples / 2.0))));
            int32_t phase = line.reversePhase % segment;
            double out = 0.0;
            for (int32_t offset : {0, segment / 2}) {
                int32_t p = (phase + offset) % segment;
                double s = std::sin(M_PI * static_cast<double>(p) / static_cast<double>(segment));
                int32_t readIndex = (((line.writeIndex - (2 * p + 1)) % line.capacity) + line.capacity) % line.capacity;
                out += s * s * line.buffer[readIndex];
            }
            line.reversePhase = (phase + 1) % segment;
            publish(op.out, out);
        } else if (op.op == PrimitiveOp::Op::HoldLoop) {
            auto lIt = lines.find(op.line);
            if (lIt == lines.end()) return;
            auto& line = lIt->second;
            TaperKind taper = TaperKind::Linear;
            for (const auto& ctrl : program_.controls) {
                if (ctrl.id == op.gateControl) { taper = ctrl.taper; break; }
            }
            const bool gate = op.gateMin + taperFraction(taper, getControl(op.gateControl)) * (op.gateMax - op.gateMin) >= 0.5;
            const bool rising = gate && !line.holdGateWas;
            line.holdGateWas = gate;
            // Same state machine as the TS console's `holdLoop`.
            double out = 0.0;
            bool looping = false;
            if (line.holdState == 0) {
                if (rising) { line.holdState = 1; line.holdLength = 0; }
            } else if (line.holdState == 2 && rising) {
                line.holdState = 0; line.holdLength = 0; line.holdIndex = 0;
            }
            if (line.holdState == 1) {
                if (gate && line.holdLength < line.capacity) {
                    line.buffer[line.holdLength] = readSource(op.input);
                    line.holdLength += 1;
                } else {
                    line.holdState = line.holdLength > 0 ? 2 : 0;
                    line.holdIndex = 0;
                    looping = line.holdState == 2;
                }
            } else if (line.holdState == 2) {
                looping = true;
            }
            if (looping) {
                out = line.buffer[line.holdIndex];
                line.holdIndex = (line.holdIndex + 1) % line.holdLength;
            }
            publish(op.out, out);
        } else if (op.op == PrimitiveOp::Op::DelayPush) {
            auto lIt = lines.find(op.line);
            if (lIt == lines.end()) return;
            auto& line = lIt->second;
            line.buffer[line.writeIndex] = readSource(op.input);
            line.writeIndex = (line.writeIndex + 1) % line.capacity;
            } else if (op.op == PrimitiveOp::Op::Mix) {
                double acc = 0.0;
                // A direct input term enters AC-coupled: the block's operating
                // point rides the output (added back at the macro source), so
                // the line must not carry it a second time. Mirrors TS.
                double inputDc = 0.0;
                auto dIt = composedDc_.find(block.id);
                if (dIt != composedDc_.end()) inputDc = dIt->second.dcOperatingPoint;
                for (const auto& term : op.terms) {
                    double gain = term.gain;
                    if (term.swept) {
                        // Same reading as the TS console: the knob's position through its
                        // own taper, spread across the declared range.
                        TaperKind taper = TaperKind::Linear;
                        for (const auto& ctrl : program_.controls) {
                            if (ctrl.id == term.sweepControl) { taper = ctrl.taper; break; }
                        }
                        gain = term.sweepMin + taperFraction(taper, getControl(term.sweepControl)) * (term.sweepMax - term.sweepMin);
                    }
                    double value = readSource(term.source);
                    if (term.source.kind == PrimitiveOp::Source::Kind::Input) value -= inputDc;
                    acc += value * gain;
                }
                publish(op.out, acc);
            } else if (op.op == PrimitiveOp::Op::FilterDcblock) {
            auto dcIt = composedDc_.find(block.id);
            if (dcIt == composedDc_.end()) return;
            auto& dc = dcIt->second;
                double x = readSource(op.input);
                double alpha = 1.0 / (1.0 * sampleRate);
                dc.dcEstimate += alpha * (x - dc.dcEstimate);
                publish(op.out, x - dc.dcEstimate);
        } else if (op.op == PrimitiveOp::Op::Comb) {
            auto fIt = composedFilters_.find(stateKey);
            if (fIt == composedFilters_.end()) return;
            if (op.index < 0 || op.index >= static_cast<int32_t>(fIt->second.combs.size())) return;
            auto& st = fIt->second.combs[op.index];
            double inVal = readSource(op.input);
            double delayed = st.buffer[st.index];
                st.buffer[st.index] = inVal + st.gain * delayed;
                st.index = (st.index + 1) % static_cast<int32_t>(st.buffer.size());
                publish(op.out, delayed);
        } else if (op.op == PrimitiveOp::Op::Allpass) {
            auto fIt = composedFilters_.find(stateKey);
            if (fIt == composedFilters_.end()) return;
            if (op.index < 0 || op.index >= static_cast<int32_t>(fIt->second.allpasses.size())) return;
            auto& st = fIt->second.allpasses[op.index];
            double inVal = readSource(op.input);
            double delayed = st.buffer[st.index];
            double out = delayed - REVERB_ALLPASS_GAIN * inVal;
                st.buffer[st.index] = inVal + REVERB_ALLPASS_GAIN * delayed;
                st.index = (st.index + 1) % static_cast<int32_t>(st.buffer.size());
                publish(op.out, out);
        } else if (op.op == PrimitiveOp::Op::PitchShift) {
            auto pIt = composedPitch_.find(stateKey);
            if (pIt == composedPitch_.end()) return;
            auto sIt = pIt->second.find(opPosition);
            if (sIt == pIt->second.end()) return;
            auto& st = sIt->second;
            // Static transposition by asynchronous resampling (row 5),
            // mirroring the TS interpreter op for op: write takes every
            // input sample, the read pointer advances `ratio` per output
            // sample through linear interpolation, wrapping by whole
            // windows at the history edges. No crossfade, no formants.
            auto slot = [&](int64_t position) -> int32_t {
                int64_t m = position % PITCH_HISTORY;
                if (m < 0) m += PITCH_HISTORY;
                return static_cast<int32_t>(m);
            };
            st.buffer[slot(st.writeAbs)] = readSource(op.input);
            st.writeAbs += 1;
            double base = std::floor(st.readAbs);
            double frac = st.readAbs - base;
            int64_t i0 = static_cast<int64_t>(base);
            double s0 = st.buffer[slot(i0)];
            double s1 = st.buffer[slot(i0 + 1)];
            publish(op.out, s0 + frac * (s1 - s0));
            st.readAbs += st.ratio;
            while (st.readAbs > static_cast<double>(st.writeAbs)) {
                st.readAbs -= PITCH_WINDOW;
            }
            while (st.readAbs <= static_cast<double>(st.writeAbs) - PITCH_HISTORY) {
                st.readAbs += PITCH_WINDOW;
            }
        } else if (op.op == PrimitiveOp::Op::PitchTracker) {
            auto tIt = composedTracker_.find(stateKey);
            if (tIt == composedTracker_.end()) return;
            auto sIt = tIt->second.find(opPosition);
            if (sIt == tIt->second.end()) return;
            auto& st = sIt->second;
            st.buffer[st.writeAbs % TRACK_WINDOW] = readSource(op.input);
            st.writeAbs += 1;
            st.sinceUpdate += 1;
            if (st.sinceUpdate >= TRACK_HOP) {
                st.sinceUpdate = 0;
                std::vector<double> window(TRACK_WINDOW);
                for (int32_t i = 0; i < TRACK_WINDOW; ++i) {
                    window[i] = st.buffer[(st.writeAbs + i) % TRACK_WINDOW];
                }
                st.estimate = trackPitchFundamental(window, sampleRate);
            }
            publish(op.out, st.estimate);
        } else {
            throw std::runtime_error("composed block \"" + block.id + "\" names a DSP primitive this runtime does not implement");
        }
        opPosition += 1;
    }
    if (position.out >= 0 && position.out < static_cast<int32_t>(temps.size())) {
        macroOutputVolts_[block.id] = temps[position.out];
    } else {
        macroOutputVolts_[block.id] = 0.0;
    }
}

double Engine::processSample(double inputSample) {
    if (!prepared_) return 0.0;

    timeSeconds_ = static_cast<double>(elapsedSamples_) / options_.sampleRate;
    double result = 0.0;

    for (size_t bIdx : orderedBlockIndices_) {
        const auto& block = program_.blocks[bIdx];

        if (block.kind == BlockKind::Composed) {
            processComposedBlock(bIdx);
        } else {
            double out = processMnaBlock(bIdx, inputSample);
            if (block.outputNode.has_value()) {
                result = out;
            }
        }
    }

    elapsedSamples_++;
    return result;
}

void Engine::processBlock(const float* input, float* output, size_t numFrames) {
    for (size_t i = 0; i < numFrames; ++i) {
        double in = input ? static_cast<double>(input[i]) : 0.0;
        double out = processSample(in);
        output[i] = static_cast<float>(out);
    }
}

#ifdef V2_PROFILE_TIMERS
Engine::Profile Engine::getProfile() const {
    return Profile{profile_assemble_ns_, profile_factor_ns_, profile_backsub_ns_, profile_converge_ns_, profile_totalIters_, profile_totalSamples_};
}
void Engine::resetProfile() {
    profile_assemble_ns_ = 0;
    profile_factor_ns_ = 0;
    profile_backsub_ns_ = 0;
    profile_converge_ns_ = 0;
    profile_totalIters_ = 0;
    profile_totalSamples_ = 0;
}
#endif

} // namespace vessel_dsp::v2
