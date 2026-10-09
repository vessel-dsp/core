#pragma once

// Band-limited half-band resampling for solver oversampling.
//
// Exact C++ port of `packages/runtime/src/resample.ts`, which is the fixed
// reference: same Kaiser-windowed half-band prototype from (taps, beta),
// same stage arithmetic in the same order, same latency formula. The
// coefficients are a function of the stage only, never of the circuit, and
// the oversample factor is a property of the host: nothing here reads the
// program to choose or alter the factor.
//
// Double precision end to end, mirroring the reference's Float64.

#include <cstddef>
#include <cstdint>
#include <vector>

namespace vessel_dsp::v2 {

// Tap count of the half-band prototype. 1 mod 4 (center on an even index).
inline constexpr int32_t kResampleHalfBandTaps = 57;

// Kaiser beta for the prototype stopband.
inline constexpr double kResampleKaiserBeta = 8.3;

// Modified Bessel function I0, needed by the Kaiser window.
// Same 32-term series and early-out as the reference.
double besselI0(double x);

// Half-band lowpass prototype at gain 1: cutoff 0.25 cycles/sample, center
// tap exactly 0.5, even taps exactly 0, odd taps normalized to sum to 0.5.
// Throws std::runtime_error unless taps is 1 mod 4 and at least 9, mirroring
// the reference's refusal.
std::vector<double> designHalfBand2x(
    int32_t taps = kResampleHalfBandTaps,
    double beta = kResampleKaiserBeta);

// The single windowed-sinc half-band prototype every 2x stage shares.
// Designed once from (taps, beta); `Engine::prepare` builds its cascades
// from this rather than redesigning per stage. Values are identical to one
// fresh `designHalfBand2x()` call.
const std::vector<double>& resamplePrototype();

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

// Total resampler group delay in host samples for a cascade of `stages`
// 2x stages (up and down around the solver): (2C-1)*(1-2^-stages) for
// C = (taps-1)/2. See the reference for the derivation; verified there
// against an impulse centroid and a multi-frequency phase slope.
double cascadeLatencyHostSamples(int32_t stages, int32_t taps);

} // namespace vessel_dsp::v2
