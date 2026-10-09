#pragma once

#include "v2/GeneratedKernels.h"
#include "v2/Program.h"
#include "v2/Resample.h"
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>
#include <unordered_map>
#include <memory>
#include <optional>

namespace vessel_dsp::v2 {

struct EngineOptions {
    double sampleRate = 48000.0;
    int32_t maxNewtonIterations = 64;
    double inputSourceOhms = 0.0;
    /**
     * Solver sub-samples per host sample; 1 is the plain path and costs
     * nothing. `sampleRate` above is the rate the caller passes in (the host
     * rate); the engine solves at host * oversample. Powers of two >= 2 run
     * the band-limited half-band cascades (`HalfBandStage2x`, the exact port
     * of the TypeScript reference's resampler); any other factor keeps the
     * legacy hold-and-last path. A property of the host, never of the
     * circuit: nothing in the engine reads the program to choose or alter
     * the factor. Values below 1 clamp to 1, mirroring `ReferenceRuntime`.
     */
    int32_t oversample = 1;
};

struct TriodeHistory {
    double vgk = 0.0;
    double vpk = 0.0;
    double vsk = 0.0;
};

struct OpAmpHistory {
    double differential = 0.0;
    double step = 0.0;
    double cap = 0.0;
};

struct FetHistory {
    double vgs = 0.0;
    double vds = 0.0;
};

struct BlockScratch {
    int32_t size = 0;
    int32_t nodeCount = 0;
    int32_t auxCount = 0;
    int32_t stateCount = 0;
    bool linear = false;
    bool controlFree = false;
    bool eliminate = false;

    // Ping-pong solution vectors
    std::vector<double> solutionA;
    std::vector<double> solutionB;

    // Full dense matrix & RHS (flat size * size)
    std::vector<double> matrix;
    std::vector<double> rhs;

    // Base matrix for linear background / constant stamps
    std::vector<double> baseMatrix;
    std::vector<double> baseRhs;
    std::vector<double> controlMatrix;
    std::vector<double> controlRhs;
    std::vector<double> sampleMatrix;
    std::vector<double> sampleRhs;
    std::vector<int32_t> nonConstantStampIndices;
    std::vector<int32_t> nonConstantLinearStampIndices;
    std::vector<int32_t> controlStampIndices;
    std::vector<int32_t> sampleLinearStampIndices;
    std::vector<int32_t> dynamicStampIndices;
    std::vector<int32_t> nonlinearStampIndices;
    std::vector<int32_t> touchedMatrixOffsets;
    std::vector<int32_t> touchedRhsRows;
    std::vector<int32_t> touchedNonlinearMatrixOffsets;
    std::vector<int32_t> touchedNonlinearRhsRows;
    // Cells the PER-SAMPLE linear stamps write, so `sampleMatrix` can be refreshed selectively
    // from `controlMatrix` instead of copied whole. See Engine.cpp's per-sample assembly.
    std::vector<int32_t> touchedSampleMatrixOffsets;
    std::vector<int32_t> touchedSampleRhsRows;
    std::vector<int32_t> statefulStampIndices;
    uint64_t cachedControlGen = 0;
    bool canUseSelectiveMatrixCopy = false;

    // Per-stamp nonlinear history (indexed by stamp index within block)
    std::vector<double> diodeHistory;
    std::vector<std::pair<double, double>> bjtHistory;
    std::vector<TriodeHistory> triodeHistory;
    std::vector<OpAmpHistory> opampHistory;
    std::vector<double> opampRawState;
    std::vector<FetHistory> fetHistory;

    // Sparse schedule buffers
    std::vector<double> sparseValues;
    std::vector<double> sparseScratchRhs;
    std::vector<double> sparseFactors;
    /**
     * The generated straight-line kernel for this block's schedule, when the
     * build's table carries a fingerprint match. Null means the interpreter
     * (`runSparseSchedule`) runs; a kernel that returns false falls through to
     * the same dense fallback the interpreter's false return triggers.
     */
    V2GeneratedKernelFn generatedKernel = nullptr;
    /**
     * When the shipped order fails numeric validation at the operating point,
     * `settlePivotOrders()` may adopt a value-aware replacement order computed
     * from the assembled matrix (`computeNumericRepivot`). Present means it is
     * the active schedule for this block; the generated-kernel lookup only ever
     * matches the original, so a re-pivoted block runs the interpreter. Cleared
     * by `prepare()` and `reset()`, which re-decide against the fresh point.
     */
    std::optional<SparseSchedule> repivotedSchedule;
    int32_t consecutiveFallbacks = 0;
    /**
     * Whether the mid-run re-pivot has already spent its one attempt on this
     * order. Set when the consecutive-trip limit is reached: the first
     * limit-hit re-pivots once from the current matrix instead of abandoning,
     * and only a second limit-hit on the same order abandons. Fresh orders
     * (admitted or adopted at settle) start false. Mirrors
     * `ReferenceRuntime`'s schedule entry of the same name.
     */
    bool repivotAttempted = false;
    bool sparseAbandoned = false;
    /**
     * Set by `settlePivotOrders()` when the shipped order disagrees with the
     * dense solve on the operating-point matrix (row-6 defect). Like an
     * abandonment the block then solves densely, but the cause is measured
     * once per operating point rather than accumulated mid-run, so it is counted
     * separately. Re-decided by every `settlePivotOrders()` run -- `prepare()`
     * and `reset()` both end in one -- never silently re-armed: `reset()`
     * clears it as undecided first, and the fresh operating point judges it.
     */
    bool sparseDropped = false;
    /**
     * Whether `prepare()` admitted this block's schedule and sized the buffers above for it.
     *
     * Distinct from `!sparseAbandoned`, which also goes true for a block the predicted-saving
     * floor rejected -- and those blocks have EMPTY buffers, so re-arming one would hand
     * `runSparseSchedule` a zero-length `values` array to index. That is the trap `reset()`
     * would otherwise fall into; it re-arms on this flag, never on the other.
     */
    bool scheduleAdmitted = false;

    // Elimination scratch (DK method)
    int32_t portCount = 0;
    int32_t lCount = 0;
    std::vector<int32_t> portRows;
    std::vector<int32_t> lRows;
    std::vector<int32_t> portIndexOf;
    std::vector<int32_t> lIndexOf;
    std::vector<int32_t> linearStampIndices;

    std::vector<double> linearMatrix;
    std::vector<double> linearRhs;
    std::vector<double> llMatrix; // lCount * lCount
    std::vector<int32_t> permutation; // lCount
    std::vector<double> zMatrix; // portCount * lCount (flat)
    std::vector<double> zRhsScratch;
    std::vector<double> z0; // lCount
    std::vector<double> z0Rhs; // lCount
    std::vector<double> kReduced; // portCount * portCount (flat)
    std::vector<double> uReduced; // portCount
    std::vector<double> yCurrent; // portCount
    std::vector<double> yNext; // portCount
    std::vector<double> fullCurrent; // size
    std::vector<double> fullNext; // size
    std::vector<double> rawNl; // size * size
    std::vector<double> rawNlRhs; // size
    std::vector<double> reducedJacobian; // portCount * portCount
    std::vector<double> reducedRhs; // portCount
    int64_t cachedControlGeneration = -1;

    // Row permutation vector for dense solve
    std::vector<int32_t> denseRowOrder;
};


class Engine {
public:
    Engine();
    ~Engine();

    bool loadProgram(Program program, std::string* error = nullptr);
    bool loadProgramJson(std::string_view json, std::string* error = nullptr);

    void prepare(const EngineOptions& options = EngineOptions{});
    void reset();

    void setControl(std::string_view controlId, double position);
    double getControl(std::string_view controlId) const;

    /**
     * Retarget one `dc-source` stamp's `volts` and `sourceOhms` between block
     * renders, never concurrently with one -- the same contract as `setControl`.
     *
     * Operates on this engine's OWN loaded program copy. Validates everything
     * before changing anything and rebuilds the affected block's cached base
     * matrix exactly the way `prepare()` does, then bumps `controlGeneration_`
     * so every cache derived from the base matrix rebuilds. Reapplying the
     * values a stamp already carries changes nothing. Reactive state carries
     * over and the operating point is not re-solved, mirroring the TypeScript
     * `ReferenceRuntime.setSupply` contract.
     *
     * The sparse schedule and any generated kernel are untouched: their pattern
     * is value-independent and per-solve values are gathered from the live
     * matrix, so the kernel keeps solving the new values with no regeneration.
     *
     * Returns 0 on success, otherwise a stable error code:
     * 1 unknown block index, 2 block is not an MNA block,
     * 3 no dc-source with that sourceIndex, 4 non-finite volts,
     * 5 negative or non-finite sourceOhms.
     */
    int32_t setSupply(int32_t blockIndex, int32_t sourceIndex, double volts, double sourceOhms);

    double processSample(double inputSample);
    void processBlock(const float* input, float* output, size_t numFrames);

    // Telemetry & state inspection
    const Program& program() const { return program_; }
    uint64_t elapsedSamples() const { return elapsedSamples_; }
    bool isPrepared() const { return prepared_; }
    /**
     * The rate the caller passed to `prepare`, as opposed to the solver's
     * sub-sample rate (`options_.sampleRate`, already multiplied by the
     * oversample factor). Mirrors `ReferenceRuntime.hostSampleRate()`;
     * -1.0 before `prepare()`, mirroring its null.
     */
    double hostSampleRate() const { return prepared_ ? hostSampleRate_ : -1.0; }
    /**
     * The resampler's total group delay in **host** samples, or -1.0 before
     * `prepare()`, mirroring `ReferenceRuntime.oversampleLatency()`'s null.
     * Zero when the resampler is bypassed (factor 1, or a factor that is not
     * a power of two and keeps the legacy path): the held path adds no
     * latency by construction. At 2x/4x/8x this is 19.5/26.25/28.625 host
     * samples for the stage-specific half-band cascade.
     */
    double oversampleLatency() const { return prepared_ ? resampleLatencyHost_ : -1.0; }
    const std::vector<double>& operatingPoint(size_t blockIdx) const { return blockOperatingPoints_[blockIdx]; }
    const std::vector<double>& blockState(size_t blockIdx) const { return blockStates_[blockIdx]; }
    int32_t lastIterationCount() const { return lastIterationCount_; }
    bool lastConverged() const { return lastConverged_; }
    int32_t maxIterationsObserved() const { return maxIterationsObserved_; }

    /**
     * Whether the static sparse schedules are actually running, and how often one collapsed.
     *
     * **This exists because its absence hid a 12x cost defect for as long as the schedule has
     * shipped.** `report-solver-plan.ts` reports which blocks the compiler *planned* to solve
     * sparsely; nothing reported which ones do. A block that gives its schedule up keeps
     * producing correct audio at dense cost, silently, for the life of the engine -- and six
     * corpus packets were in exactly that state on 2026-09-18. A fallback is also not free when
     * it is rare: the solve pays for the schedule and then for the dense solve on the same
     * matrix, so a nonzero rate is a cost signal even when no block is abandoned.
     *
     * Counted over every solve since `prepare()` or `reset()`, not per block. Cheap enough to
     * be unconditional (two integer increments against an O(n^2) solve), which matters: a
     * counter compiled out of the shipping build tells you nothing about the shipping build.
     */
    int64_t scheduleSolves() const { return scheduleSolves_; }
    int64_t scheduleFallbacks() const { return scheduleFallbacks_; }
    /** Solves that took the generated straight-line kernel instead of the interpreter. */
    int64_t kernelSolves() const { return kernelSolves_; }
    /** Blocks whose shipped order failed validation and a numeric re-pivot was adopted. */
    int64_t repivotedScheduleBlocks() const { return repivotedScheduleBlocks_; }
    /** Blocks that were admitted at `prepare()` and have since given their schedule up. */
    int32_t abandonedScheduleBlocks() const;
    /** Admitted blocks whose shipped order failed validation at `prepare()`. */
    int32_t droppedScheduleBlocks() const;

#ifdef V2_PROFILE_TIMERS
    struct Profile {
        uint64_t assemble_ns = 0;
        uint64_t factor_ns = 0;
        uint64_t backsub_ns = 0;
        uint64_t converge_ns = 0;
        uint64_t totalIters = 0;
        uint64_t totalSamples = 0;
    };
    Profile getProfile() const;
    void resetProfile();
#endif

private:
    Program program_;
    EngineOptions options_;
    bool prepared_ = false;
    /**
     * Solver sub-samples per host sample (`EngineOptions.oversample`,
     * clamped to >= 1 at `prepare()`). `options_.sampleRate` is the
     * **solver's** rate (host * oversample); `hostSampleRate_` is the rate
     * the caller passed in.
     */
    int32_t oversample_ = 1;
    double hostSampleRate_ = 48000.0;
    /**
     * Band-limited resampling around the solver, one 2x half-band stage per
     * entry, cascaded for 4x and 8x. Empty unless the oversample factor is a
     * power of two greater than 1; any other factor keeps the legacy
     * hold-and-last path. Built fresh (zero state) in `prepare()`, so the
     * filter state never leaks across renders and block splits stay
     * bit-identical. Scratch streams sized to the factor in `prepare()`.
     */
    std::vector<HalfBandStage2x> resampleUp_;
    std::vector<HalfBandStage2x> resampleDown_;
    std::vector<double> resampleBufA_;
    std::vector<double> resampleBufB_;
    /** Total resampler group delay in host samples (0 on the legacy path). */
    double resampleLatencyHost_ = 0.0;
    uint64_t controlGeneration_ = 1;
    uint64_t elapsedSamples_ = 0;
    /** Per momentary control: sample of the last press, and the last interval in seconds (<0 none). */
    struct TapState { int64_t lastPress = -1; double intervalSeconds = -1.0; int64_t runStart = -1; int32_t runCount = 0; };
    std::unordered_map<std::string, TapState> tapState_;
    double timeSeconds_ = 0.0;
    int32_t lastIterationCount_ = 0;
    bool lastConverged_ = false;
    int32_t maxIterationsObserved_ = 0;
    int64_t scheduleSolves_ = 0;
    int64_t scheduleFallbacks_ = 0;
    int64_t kernelSolves_ = 0;
    int64_t repivotedScheduleBlocks_ = 0;

    std::unordered_map<std::string, double> controlPositions_;
    std::unordered_map<std::string, int32_t> controlIndexByName_;
    std::vector<double> controlValues_;
    std::unordered_map<std::string, size_t> blockIndexById_;

    // Per-block state & scratch
    std::vector<BlockScratch> blockScratch_;
    std::vector<std::vector<double>> blockStates_; // capacitor/inductor/etc states
    std::vector<std::vector<double>> blockOperatingPoints_; // last solved operating point
    std::vector<size_t> orderedBlockIndices_;

    // Macro blocks
    std::unordered_map<std::string, double> macroOutputVolts_;

    // Limiter telemetry & history
    bool limitedIterate_ = false;
    // Mirrors reference-runtime.ts `limitedOpamp`: the op-amp whose limiter fired this iteration.
    struct LimitedOpamp {
        int32_t stampIdx = -1;
        uint64_t key = 0;
        int32_t output = 0;
        double centre = 0.0;
        double railHigh = 0.0;
        double railLow = 0.0;
        double band = 0.0;
        double maxStep = 0.0;
        bool folded = false;
    };
    LimitedOpamp limitedOpamp_;
    bool limitedOpampValid_ = false;
    std::unordered_map<uint64_t, double> diodeHistory_;
    std::unordered_map<uint64_t, std::pair<double, double>> bjtHistory_;
    std::unordered_map<uint64_t, TriodeHistory> triodeHistory_;
    std::unordered_map<uint64_t, OpAmpHistory> opampHistory_;
    std::unordered_map<uint64_t, double> opampRawState_;
    std::unordered_map<uint64_t, FetHistory> fetHistory_;
    std::unordered_map<std::string, int64_t> lastShiftedSample_;

#ifdef V2_PROFILE_TIMERS
    mutable uint64_t profile_assemble_ns_ = 0;
    mutable uint64_t profile_factor_ns_ = 0;
    mutable uint64_t profile_backsub_ns_ = 0;
    mutable uint64_t profile_converge_ns_ = 0;
    mutable uint64_t profile_totalIters_ = 0;
    mutable uint64_t profile_totalSamples_ = 0;
#endif

    // Spring reverb, digital reverb & BBD state
    struct SpringLine {
        std::vector<double> buffer;
        int32_t writeIndex = 0;
        double feedback = 0.0;
        std::vector<double> allpassX;
        std::vector<double> allpassY;
    };
    struct SpringTankState {
        std::vector<SpringLine> lines;
        double transduction = 1.0;
        double driveX1 = 0.0;
        double driveY1 = 0.0;
    };
    struct ReverbState {
        std::vector<std::vector<double>> combBuffers;
        std::vector<int32_t> combIndices;
        std::vector<double> combGains;
        std::vector<std::vector<double>> allpassBuffers;
        std::vector<int32_t> allpassIndices;
    };
    std::unordered_map<std::string, SpringTankState> springStates_;
    std::unordered_map<std::string, double> springOutputVolts_;
    std::unordered_map<std::string, ReverbState> reverbStates_;
    std::unordered_map<std::string, std::vector<double>> bbdBuffers_;

    /** One composed block's delay lines, DC seed, and Schroeder sections
     * (board-p3 row 4). Same rings, estimator, and tables as the macro
     * kernels, factored per op rather than per model. */
    struct ComposedLine {
        std::vector<double> buffer;
        int32_t writeIndex = 0;
        int32_t capacity = 0;
        /** The declared-maximum capacity a tap length clamps to; `capacity` is twice this on a
         *  line a reverse tap reads. */
        int32_t lengthCapacity = 0;
        /** A reverse tap's segment phase, in samples. */
        int32_t reversePhase = 0;
        /** A hold sampler: 0 idle, 1 recording, 2 looping; its length, index and last gate. */
        int32_t holdState = 0;
        int32_t holdLength = 0;
        int32_t holdIndex = 0;
        bool holdGateWas = false;
        /** The cited floor a `parameter` read sweeps up from, in samples. */
        double floorSamples = 0.0;
        /** The line's own control (see ComposedPosition::LineSweep), if any. */
        bool hasSweep = false;
        bool sweepTapped = false;
        double sweepRatio = 1.0;
        std::string sweepControl;
        double targetLengthSamples = 0.0;
        double currentLengthSamples = 0.0;
    };
    struct ComposedDc {
        double dcEstimate = 0.0;
        double dcOperatingPoint = 0.0;
        double modDcEstimate = 0.0;
        bool modSeeded = false;
    };
    struct ComposedComb {
        std::vector<double> buffer;
        int32_t index = 0;
        double gain = 0.0;
    };
    struct ComposedAllpass {
        std::vector<double> buffer;
        int32_t index = 0;
    };
    struct ComposedFilter {
        std::vector<ComposedComb> combs;
        std::vector<ComposedAllpass> allpasses;
    };
    /**
     * Per-block, per-position state keys, built once at prepare.
     *
     * `composedStateKey` concatenates, and `processComposedBlock` runs once per
     * sample, so building the key there allocated a std::string 48,000 times a
     * second per composed block. Mirrors `composedStateKeys` in the TypeScript
     * console, which hit the same wall first.
     */
    std::unordered_map<std::string, std::vector<std::string>> composedStateKeys_;
    std::unordered_map<std::string, std::unordered_map<std::string, ComposedLine>> composedLines_;
    /** The position each composed block ran last sample, to know when a mode was just selected. */
    std::unordered_map<std::string, int32_t> lastComposedPosition_;
    std::unordered_map<std::string, ComposedDc> composedDc_;
    std::unordered_map<std::string, ComposedFilter> composedFilters_;
    /** Pitch resampling state per block then op position (row 5). */
    struct ComposedPitch {
        std::vector<double> buffer;
        int64_t writeAbs = 0;
        double readAbs = 0.0;
        double ratio = 1.0;
    };
    std::unordered_map<std::string, std::unordered_map<int32_t, ComposedPitch>> composedPitch_;
    /** Pitch estimator state per block then op position (row 6). */
    struct ComposedTracker {
        std::vector<double> buffer;
        int64_t writeAbs = 0;
        int32_t sinceUpdate = 0;
        double estimate = 0.0;
    };
    std::unordered_map<std::string, std::unordered_map<int32_t, ComposedTracker>> composedTracker_;

    void advanceSpringReverb(const Block& block, const Stamp& stamp, const double* solution, double sampleRate);

    // Core solver methods
    void solveOperatingPoint();
    // Validates each admitted block's shipped elimination order against the
    // assembled operating-point matrix and drops collapsing orders to dense.
    // The TypeScript `ReferenceRuntime.settlePivotOrders` is the same method;
    // keep the tolerance, the comparison metric and the drop semantics
    // identical in both.
    void settlePivotOrders();
    // Installs a value-aware replacement order for a block, from settle or
    // from the mid-run re-pivot, with one shared bookkeeping shape. Mirrors
    // `ReferenceRuntime.adoptRepivotedSchedule`.
    void adoptRepivotedSchedule(size_t blockIdx, SparseSchedule candidate);
    // Re-pivots once from the current matrix at the consecutive-trip limit.
    // Mirrors `ReferenceRuntime.adoptMidRunRepivot`.
    bool adoptMidRunRepivot(
        size_t blockIdx,
        const std::vector<double>& matrix,
        const std::vector<double>& rhs,
        const double* denseAnswer,
        int32_t size);
    std::vector<double> solveByGminStepping(size_t blockIdx, double dt, std::vector<double>& state, int32_t size);
    std::vector<double> solveBySourceStepping(size_t blockIdx, double dt, std::vector<double>& state, int32_t size);
    double processMnaBlock(size_t blockIdx, double inputSample);
    /**
     * One sub-sample solve at the solver rate: every block stepped once at
     * `t = elapsedSamples / sampleRate`, returning the output jack's value.
     * Shared by the held and the resampled paths, so factor 1 executes the
     * same operations in the same order as before the resampler existed.
     * Mirrors `ReferenceRuntime`'s `solveSubSample`.
     */
    double solveSubSample(double subInput);
    /**
     * One host sample through the legacy path: the input held flat across
     * the sub-samples, the last sub-sample kept. Mirrors `ReferenceRuntime`'s
     * `processHeldSample`.
     */
    double processHeldSample(double sample);
    /**
     * One host sample through the band-limited path: half-band interpolate
     * up by 2 per stage, solve each sub-sample, FIR-decimate back to one
     * host sample. Mirrors `ReferenceRuntime`'s `processResampledSample`.
     */
    double processResampledSample(double sample);
    void processComposedBlock(size_t blockIdx);
    /**
     * The composed program selected at the operating point, mirroring the
     * per-sample router read against operating-point voltages. Single-position
     * blocks (every delay core today) read 0 without touching the solver.
     */
    int32_t composedDcPosition(const Block& block);
    /**
     * A delay core's DC transfer as affine `gain`/`offset` in the tap, derived
     * from its own ops by fixed-point settling (taps read lines, pushes settle
     * them, DC blocks push 0). False when the program owns no delay taps or
     * carries an op outside the DC vocabulary -- the macro then reads 0 during
     * the solve, exactly as before. Mirrors the TS console op for op.
     */
    bool composedDcTransfer(size_t blockIdx, double tap, double& gain, double& offset);

    struct SolveResult {
        bool converged = false;
        int32_t used = 0;
        int32_t worstNode = -1;
        double worstDelta = 0.0;
    };

    SolveResult iterate(
        size_t blockIdx,
        double input,
        double dt,
        std::vector<double>& state,
        const std::vector<double>& start,
        double* outSolution,
        bool dc = false,
        double gmin = 1e-12,
        double sourceScale = 1.0
    );

    SolveResult iterateEliminated(
        size_t blockIdx,
        double input,
        double dt,
        std::vector<double>& state,
        const std::vector<double>& start,
        double* outSolution,
        bool dc = false,
        double gmin = 1e-12,
        double sourceScale = 1.0
    );

    void applyStamp(
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
        int32_t stampIdx = -1
    );

    void buildLinearBackground(
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
    );
};

} // namespace vessel_dsp::v2
