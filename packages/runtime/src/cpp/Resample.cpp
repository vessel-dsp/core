// Exact C++ port of `packages/runtime/src/resample.ts` (the fixed reference).
// Arithmetic order is statement-for-statement identical so the two consoles
// agree bit for bit; see Resample.h for the contract.

#include "v2/Resample.h"

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>

namespace vessel_dsp::v2 {

double besselI0(double x) {
    double sum = 1.0;
    double term = 1.0;
    const double half = (x * x) / 4.0;
    for (int32_t k = 1; k <= 32; ++k) {
        term *= half / (static_cast<double>(k) * static_cast<double>(k));
        sum += term;
        if (term < 1e-17 * sum) break;
    }
    return sum;
}

std::vector<double> designHalfBand2x(int32_t taps, double beta) {
    if (taps < 9 || taps % 4 != 1) {
        throw std::runtime_error(
            "half-band prototype needs an odd tap count of 1 mod 4 (got " +
            std::to_string(taps) + ")");
    }
    const int32_t center = (taps - 1) / 2;
    const double denom = besselI0(beta);
    std::vector<double> out(static_cast<size_t>(taps), 0.0);
    for (int32_t i = 0; i < taps; ++i) {
        const int32_t d = i - center;
        const double r = static_cast<double>(d) / static_cast<double>(center);
        const double window =
            besselI0(beta * std::sqrt(std::max(0.0, 1.0 - r * r))) / denom;
        if (d == 0) {
            out[static_cast<size_t>(i)] = 0.5;
        } else if (d % 2 == 0) {
            // The ideal response is exactly zero at even offsets and the
            // window preserves that, so these are exact zeros, not rounded ones.
            out[static_cast<size_t>(i)] = 0.0;
        } else {
            out[static_cast<size_t>(i)] =
                (window * std::sin((M_PI * static_cast<double>(d)) / 2.0)) /
                (M_PI * static_cast<double>(d));
        }
    }
    // Normalize the odd taps to sum to exactly 1/2, so the full filter sums
    // to exactly 1 (DC gain 1) with the center tap untouched at 0.5.
    double oddSum = 0.0;
    for (int32_t i = 1; i < taps; i += 2) oddSum += out[static_cast<size_t>(i)];
    const double scale = 0.5 / oddSum;
    for (int32_t i = 1; i < taps; i += 2)
        out[static_cast<size_t>(i)] = out[static_cast<size_t>(i)] * scale;
    out[static_cast<size_t>(center)] = 0.5;
    return out;
}

const std::vector<double>& resamplePrototype() {
    static const std::vector<double> prototype =
        designHalfBand2x(kResampleHalfBandTaps, kResampleKaiserBeta);
    return prototype;
}

HalfBandStage2x::HalfBandStage2x(const std::vector<double>& prototype) {
    const auto taps = static_cast<int32_t>(prototype.size());
    if (taps % 4 != 1 || taps < 9) {
        throw std::runtime_error(
            "half-band stage needs a 1-mod-4 prototype (got " +
            std::to_string(taps) + ")");
    }
    const int32_t center = (taps - 1) / 2;
    if (prototype[static_cast<size_t>(center)] != 0.5) {
        throw std::runtime_error(
            "half-band prototype center tap must be exactly 0.5");
    }
    const int32_t oddCount = (taps - 1) / 2;
    odd_.resize(static_cast<size_t>(oddCount));
    for (int32_t j = 0; j < oddCount; ++j)
        odd_[static_cast<size_t>(j)] =
            prototype[static_cast<size_t>(2 * j + 1)];
    upDelay_ = center / 2;
    delayHighRate_ = center;
    histUp_.assign(static_cast<size_t>(oddCount), 0.0);
    histDown_.assign(static_cast<size_t>(taps), 0.0);
}

void HalfBandStage2x::reset() {
    std::fill(histUp_.begin(), histUp_.end(), 0.0);
    std::fill(histDown_.begin(), histDown_.end(), 0.0);
}

void HalfBandStage2x::interpolate(double x, double* out, size_t at) {
    for (size_t i = histUp_.size(); i-- > 1;) {
        histUp_[i] = histUp_[i - 1];
    }
    histUp_[0] = x;
    out[at] = histUp_[static_cast<size_t>(upDelay_)];
    // Gain 2 compensates the zero-stuff: odd taps sum to 1/2, so this
    // sums to 1 on DC.
    double mid = 0.0;
    for (size_t j = 0; j < odd_.size(); ++j) {
        mid += odd_[j] * histUp_[j];
    }
    out[at + 1] = 2.0 * mid;
}

double HalfBandStage2x::decimate(double first, double second) {
    for (size_t i = histDown_.size(); i-- > 2;) {
        histDown_[i] = histDown_[i - 2];
    }
    histDown_[0] = second;
    histDown_[1] = first;
    // Even taps are exact zeros except the center at 0.5.
    double acc = 0.5 * histDown_[static_cast<size_t>(delayHighRate_)];
    for (size_t j = 0; j < odd_.size(); ++j) {
        acc += odd_[j] * histDown_[2 * j + 1];
    }
    return acc;
}

double cascadeLatencyHostSamples(int32_t stages, int32_t taps) {
    const int32_t center = (taps - 1) / 2;
    return (2.0 * static_cast<double>(center) - 1.0) *
           (1.0 - std::pow(2.0, -static_cast<double>(stages)));
}

} // namespace vessel_dsp::v2
