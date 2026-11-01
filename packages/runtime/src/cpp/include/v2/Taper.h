#pragma once

// Taper: the closed vocabulary of control laws, and the law each one evaluates.
//
// The C++ mirror of `packages/runtime/src/taper.ts`, which is the fixed reference. The two
// consoles have to agree on a knob's curve to the bit, so this file holds the only C++ copy of
// the names and of the laws, and `taper-consoles.test.ts` compares it with the TypeScript one
// through `v2_testonly_taper_fraction` on a dense grid.

#include "v2/Program.h"
#include <algorithm>
#include <cmath>
#include <cstddef>
#include <string>
#include <vector>

namespace vessel_dsp::v2 {

// The five names a program may carry, in the order the loader reports them. `TaperKind` has no
// sixth member and a program naming anything else is refused at load, never read as linear.
inline constexpr const char* kTaperNames = "linear, logarithmic, reverse-logarithmic, reverse-linear, s-curve";

// The taper a name denotes, or false when the name is not one of the five. Whole-string
// comparison: no case folding, no prefix, no alias (`anti-logarithmic` is not a name any
// compiler release emitted, and the TypeScript console never read it as one).
inline bool tryParseTaperKind(const std::string& s, TaperKind* out) {
    if (s == "linear") { *out = TaperKind::Linear; return true; }
    if (s == "logarithmic") { *out = TaperKind::Logarithmic; return true; }
    if (s == "reverse-logarithmic") { *out = TaperKind::AntiLogarithmic; return true; }
    if (s == "reverse-linear") { *out = TaperKind::ReverseLinear; return true; }
    if (s == "s-curve") { *out = TaperKind::SCurve; return true; }
    return false;
}

// Alpha RV16AF W(4B): a monotone cubic Hermite through (0, 0), (0.30, 0.10), (0.50, 0.50),
// (0.70, 0.90), (1, 1), zero slope at the stops, interior slopes the Fritsch-Butland weighted
// harmonic mean written as literals (0.6, 2, 0.6). The printed points, their source and what
// is convention are in `taper.ts`; the arithmetic below is that file's, statement for
// statement, so the two consoles return identical doubles. Only + - * / : no libm.
inline double sCurveFraction(double x) {
    struct Segment { double x0, h, y0, y1, m0, m1; };
    static constexpr Segment kSegments[4] = {
        {0.0, 0.3, 0.0, 0.1, 0.0, 0.6},
        {0.3, 0.2, 0.1, 0.5, 0.6, 2.0},
        {0.5, 0.2, 0.5, 0.9, 2.0, 0.6},
        {0.7, 0.3, 0.9, 1.0, 0.6, 0.0},
    };
    if (x <= 0.0) return 0.0;
    if (x >= 1.0) return 1.0;
    const int segment = x < 0.3 ? 0 : x < 0.5 ? 1 : x < 0.7 ? 2 : 3;
    const Segment& s = kSegments[segment];
    const double t = (x - s.x0) / s.h;
    const double t2 = t * t;
    const double t3 = t2 * t;
    const double h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    const double h10 = t3 - 2.0 * t2 + t;
    const double h01 = -2.0 * t3 + 3.0 * t2;
    const double h11 = t3 - t2;
    return h00 * s.y0 + h10 * s.h * s.m0 + h01 * s.y1 + h11 * s.h * s.m1;
}

inline double taperFraction(TaperKind taper, double position) {
    double x = std::min(1.0, std::max(0.0, position));
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
    if (taper == TaperKind::SCurve) {
        return sCurveFraction(x);
    }
    return x;
}

/**
 * A declared taper table evaluated at `position`, clamped to 0..1.
 *
 * **The engine convention is linear interpolation between bracketing points**, the same
 * sentence `taperTableFraction` in `packages/runtime/src/taper.ts` states: the points
 * are the claims and the shape between them is not. The scan takes the first segment
 * whose end knot sits at or past `x` -- at an interior knot the left segment wins with
 * `t = 1` -- in the same order as the TypeScript console, so the two agree bit for bit
 * with only `+ - * /`. Precondition: at least 2 points (the loader drops anything
 * shorter, and the compiler refuses it); the test-only export below returns NaN there.
 */
inline double taperTableFraction(const TaperTablePoint* points, size_t count, double position) {
    double x = std::min(1.0, std::max(0.0, position));
    // The TypeScript console's loop, statement for statement (`i < length - 2` is `i + 2 < count`
    // in unsigned arithmetic, with no underflow at any count): at an interior knot the left
    // segment wins with `t = 1` on both consoles.
    size_t i = 0;
    while (i + 2 < count && x > points[i + 1].position) i += 1;
    const TaperTablePoint& lower = points[i];
    const TaperTablePoint& upper = points[i + 1];
    double t = (x - lower.position) / (upper.position - lower.position);
    return lower.fraction + t * (upper.fraction - lower.fraction);
}

inline double taperTableFraction(const std::vector<TaperTablePoint>& points, double position) {
    return taperTableFraction(points.data(), points.size(), position);
}

/**
 * The fraction of the track at `position` for a control that may declare a table.
 *
 * A declared table wins over the taper kind; with no table (null, or fewer than 2
 * points, which the compiler never emits) this is exactly `taperFraction`, so a
 * program without a table renders bit-identically to today's program.
 */
inline double controlTaperFraction(TaperKind taper, const std::vector<TaperTablePoint>* table, double position) {
    if (table != nullptr && table->size() >= 2) {
        return taperTableFraction(*table, position);
    }
    return taperFraction(taper, position);
}

} // namespace vessel_dsp::v2
