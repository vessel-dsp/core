#pragma once

// Band-limited half-band resampling for solver oversampling.
//
// Exact C++ port of `packages/runtime/src/resample.ts`, which is the fixed
// reference: same Kaiser-windowed half-band prototypes from per-stage
// (taps, beta) specs, same stage arithmetic in the same order, same latency
// formula. The coefficients are a function of the stage only, never of the
// circuit, and the oversample factor is a property of the host: nothing here
// reads the program to choose or alter the factor.
//
// Double precision end to end, mirroring the reference's Float64.

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace vessel_dsp::v2 {

// Per-2x-stage half-band prototype specs as (taps, Kaiser beta), oldest
// (host-rate) stage first. Taps are 1 mod 4 (center on an even index).
// Stage 1 keeps the sharp audio-band transition (41 taps, -61 dB stopband);
// stages 2-3 are sized from their folding analysis. Mirrors
// `RESAMPLE_STAGE_SPECS` in the reference exactly: same pairs, same order.
struct ResampleStageSpec {
    int32_t taps;
    double beta;
};

inline constexpr ResampleStageSpec kResampleStageSpecs[] = {
    {41, 6.0},
    {29, 7.0},
    {21, 6.0},
};

inline constexpr int32_t kResampleStageSpecCount =
    static_cast<int32_t>(sizeof(kResampleStageSpecs) / sizeof(kResampleStageSpecs[0]));

// The spec for 2x stage `index` (0 = host-rate stage). Stages past the table
// (oversample 16 and above) reuse the last entry, mirroring the reference's
// `resampleStageSpec` clamp-to-last rule; a negative index throws, as the
// reference fails there too (it destructures `undefined`).
inline ResampleStageSpec resampleStageSpec(int32_t index) {
    if (index < 0) {
        throw std::runtime_error("resampler stage index out of range");
    }
    const int32_t clamped =
        index < kResampleStageSpecCount ? index : kResampleStageSpecCount - 1;
    return kResampleStageSpecs[static_cast<size_t>(clamped)];
}

// Modified Bessel function I0, needed by the Kaiser window.
// Same 32-term series and early-out as the reference.
double besselI0(double x);

// Half-band lowpass prototype at gain 1: cutoff 0.25 cycles/sample, center
// tap exactly 0.5, even taps exactly 0, odd taps normalized to sum to 0.5.
// Throws std::runtime_error unless taps is 1 mod 4 and at least 9, mirroring
// the reference's refusal. The defaults (57, 8.3) mirror the reference's
// `designHalfBand2x` defaults and stay as the parity anchor: the test-only
// coefficient getters compare one fresh call of these defaults bit for bit.
std::vector<double> designHalfBand2x(
    int32_t taps = 57,
    double beta = 8.3);

// Total resampler group delay in host samples for a cascade of `stages`
// 2x stages (up and down around the solver), using `resampleStageSpec`.
// Throws std::runtime_error unless stages is a positive integer, mirroring
// the reference's refusal.
//
// Each up-stage delays by exactly C high-rate samples and each down-stage by
// C-1 of its own, so stage s (center C_s) contributes (2C_s-1)/2^(s+1) host
// samples, summed in stage order exactly as the reference sums them:
// 19.5 / 26.25 / 28.625 at 2x/4x/8x. See the reference for the derivation;
// verified there against an impulse centroid and a multi-frequency phase
// slope.
double cascadeLatencyHostSamples(int32_t stages);

// One bidirectional 2x half-band stage. Two instances in series make 4x;
// three make 8x. The up direction interpolates (gain 2: even outputs are
// the delayed input, odd outputs use the odd taps at gain 2); the down
// direction decimates (gain 1). Histories are newest-first; arithmetic
// order is fixed, so block splits cannot change the output.
class HalfBandStage2x {
public:
    explicit HalfBandStage2x(const std::vector<double>& prototype);

    // Zero both histories.
    void reset();

    // Interpolate one input sample into two: `out[at]` is the delayed
    // input itself (bit-exact, coefficient 1), `out[at+1]` the filtered
    // midpoint. `out` must hold at least `at + 2` entries.
    void interpolate(double x, double* out, size_t at);

    // Decimate a consecutive pair (`first` older, `second` newer) to one
    // sample at gain 1.
    double decimate(double first, double second);

    // Group delay in high-rate samples, each direction.
    int32_t delayHighRate() const { return delayHighRate_; }

private:
    std::vector<double> odd_;
    int32_t upDelay_ = 0;
    int32_t delayHighRate_ = 0;
    std::vector<double> histUp_;
    std::vector<double> histDown_;
};

} // namespace vessel_dsp::v2
