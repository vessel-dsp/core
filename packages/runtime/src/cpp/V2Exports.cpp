#include "v2/Engine.h"
#include "v2/Resample.h"
#include <algorithm>
#include <vector>
#include <string>
#include <memory>
#include <cstring>
#include <limits>

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>
#define V2_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define V2_EXPORT
#endif

using namespace vessel_dsp::v2;

struct V2WasmContext {
    Engine engine;
    std::vector<float> inputBuffer;
    std::vector<float> outputBuffer;
    std::string lastError;

    V2WasmContext() {
        inputBuffer.resize(2048, 0.0f);
        outputBuffer.resize(2048, 0.0f);
    }
};

extern "C" {

V2_EXPORT void* v2_engine_create() {
    return new (std::nothrow) V2WasmContext();
}

V2_EXPORT void v2_engine_destroy(void* handle) {
    if (!handle) return;
    delete static_cast<V2WasmContext*>(handle);
}

V2_EXPORT int32_t v2_engine_load_json(void* handle, const char* jsonStr) {
    if (!handle || !jsonStr) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    bool ok = ctx->engine.loadProgramJson(jsonStr, &ctx->lastError);
    return ok ? 1 : 0;
}

// Changed (not added alongside): the oversample factor is an argument of
// `prepare`, never a second export -- there is one way to prepare an engine.
// Callers passing the old 4-argument shape must add the factor explicitly;
// the factor defaults to 1 only in the TypeScript wrapper, not here.
V2_EXPORT void v2_engine_prepare(void* handle, double sampleRate, int32_t maxNewtonIterations, double inputSourceOhms, int32_t oversample) {
    if (!handle) return;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    EngineOptions opts;
    opts.sampleRate = sampleRate > 0.0 ? sampleRate : 48000.0;
    opts.maxNewtonIterations = maxNewtonIterations > 0 ? maxNewtonIterations : 64;
    opts.inputSourceOhms = inputSourceOhms >= 0.0 ? inputSourceOhms : 0.0;
    opts.oversample = oversample;
    ctx->engine.prepare(opts);
}

// The rate the caller passed to `prepare` (the host rate), or -1.0 when the
// engine was never prepared -- the C++ mirror of `hostSampleRate()`'s null.
V2_EXPORT double v2_engine_get_host_sample_rate(void* handle) {
    if (!handle) return -1.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.hostSampleRate();
}

// The resampler's group delay in host samples (0 on the held path), or -1.0
// when the engine was never prepared -- the C++ mirror of
// `oversampleLatency()`'s null.
V2_EXPORT double v2_engine_get_oversample_latency(void* handle) {
    if (!handle) return -1.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.oversampleLatency();
}

// Test-only access to the per-stage half-band prototypes, so a test can assert
// the C++ coefficients equal the TypeScript reference's bit for bit. `stage`
// follows the same clamp-to-last rule as `resampleStageSpec` (stages past the
// table reuse the last entry); a negative stage reads 0 taps / quiet NaN.
// Valid tap indices are 0 .. length-1; anything else reads quiet NaN. Each
// prototype is generated fresh by the same `designHalfBand2x` the engine's
// `prepare()` calls -- never a hard-coded table. Not part of the shipping
// surface: no caller outside a test should link against these.
V2_EXPORT int32_t v2_resample_stage_count() {
    return kResampleStageSpecCount;
}

namespace {
// Generated once from the stage table (same calls `prepare()` makes); the
// values are identical to designing fresh per query, since the design is a
// pure function of the stage.
const std::vector<std::vector<double>>& resampleStagePrototypes() {
    static const std::vector<std::vector<double>> prototypes = [] {
        std::vector<std::vector<double>> out;
        for (int32_t s = 0; s < kResampleStageSpecCount; ++s) {
            const ResampleStageSpec spec = resampleStageSpec(s);
            out.push_back(designHalfBand2x(spec.taps, spec.beta));
        }
        return out;
    }();
    return prototypes;
}

const std::vector<double>* resampleStagePrototypeOrNull(int32_t stage) {
    if (stage < 0) return nullptr;
    const int32_t clamped =
        stage < kResampleStageSpecCount ? stage : kResampleStageSpecCount - 1;
    return &resampleStagePrototypes()[static_cast<size_t>(clamped)];
}
} // namespace

V2_EXPORT int32_t v2_resample_prototype_length(int32_t stage) {
    const std::vector<double>* prototype = resampleStagePrototypeOrNull(stage);
    if (prototype == nullptr) return 0;
    return static_cast<int32_t>(prototype->size());
}

V2_EXPORT double v2_resample_prototype_tap(int32_t stage, int32_t index) {
    const std::vector<double>* prototype = resampleStagePrototypeOrNull(stage);
    if (prototype == nullptr || index < 0 ||
        index >= static_cast<int32_t>(prototype->size())) {
        return std::numeric_limits<double>::quiet_NaN();
    }
    return (*prototype)[static_cast<size_t>(index)];
}

// Test-only round-trip through the C++ half-band cascades with no circuit:
// up-cascade, identity in the middle, down-cascade. Lets a test compare the
// C++ stages against the TypeScript stages sample for sample (impulse and
// swept sine) without any solver in the loop. Not part of the shipping
// surface: no caller outside a test should link against these.
struct V2TestResampleCascade {
    std::vector<HalfBandStage2x> up;
    std::vector<HalfBandStage2x> down;
    std::vector<double> bufA;
    std::vector<double> bufB;
};

V2_EXPORT void* v2_testonly_resample_create(int32_t stages) {
    if (stages < 1 || stages > 8) return nullptr;
    auto* cascade = new (std::nothrow) V2TestResampleCascade();
    if (cascade == nullptr) return nullptr;
    for (int32_t s = 0; s < stages; ++s) {
        const ResampleStageSpec spec = resampleStageSpec(s);
        const std::vector<double> prototype =
            designHalfBand2x(spec.taps, spec.beta);
        cascade->up.emplace_back(prototype);
        cascade->down.emplace_back(prototype);
    }
    const auto width = static_cast<size_t>(1) << static_cast<size_t>(stages);
    cascade->bufA.assign(width, 0.0);
    cascade->bufB.assign(width, 0.0);
    return cascade;
}

V2_EXPORT void v2_testonly_resample_reset(void* handle) {
    if (handle == nullptr) return;
    auto* cascade = static_cast<V2TestResampleCascade*>(handle);
    for (auto& stage : cascade->up) stage.reset();
    for (auto& stage : cascade->down) stage.reset();
    std::fill(cascade->bufA.begin(), cascade->bufA.end(), 0.0);
    std::fill(cascade->bufB.begin(), cascade->bufB.end(), 0.0);
}

V2_EXPORT double v2_testonly_resample_process(void* handle, double sample) {
    if (handle == nullptr) return 0.0;
    auto* cascade = static_cast<V2TestResampleCascade*>(handle);
    const auto stages = static_cast<int32_t>(cascade->up.size());
    std::vector<double>* cur = &cascade->bufA;
    std::vector<double>* next = &cascade->bufB;
    cascade->up[0].interpolate(sample, cur->data(), 0);
    int32_t width = 2;
    for (int32_t stage = 1; stage < stages; ++stage) {
        for (int32_t i = 0; i < width; ++i) {
            cascade->up[static_cast<size_t>(stage)].interpolate(
                (*cur)[static_cast<size_t>(i)], next->data(),
                static_cast<size_t>(2 * i));
        }
        std::swap(cur, next);
        width *= 2;
    }
    // Identity in the middle: the solver is not in this loop.
    for (int32_t sub = 0; sub < width; ++sub) {
        (*next)[static_cast<size_t>(sub)] = (*cur)[static_cast<size_t>(sub)];
    }
    std::vector<double>* hi = next;
    for (int32_t stage = stages - 1; stage >= 0; --stage) {
        const int32_t half = width / 2;
        for (int32_t i = 0; i < half; ++i) {
            (*hi)[static_cast<size_t>(i)] =
                cascade->down[static_cast<size_t>(stage)].decimate(
                    (*hi)[static_cast<size_t>(2 * i)],
                    (*hi)[static_cast<size_t>(2 * i + 1)]);
        }
        width = half;
    }
    return (*hi)[0];
}

V2_EXPORT void v2_testonly_resample_destroy(void* handle) {
    if (handle == nullptr) return;
    delete static_cast<V2TestResampleCascade*>(handle);
}

V2_EXPORT void v2_engine_reset(void* handle) {
    if (!handle) return;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    ctx->engine.reset();
}

V2_EXPORT void v2_engine_set_control(void* handle, const char* controlId, double position) {
    if (!handle || !controlId) return;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    ctx->engine.setControl(controlId, position);
}

V2_EXPORT double v2_engine_get_control(void* handle, const char* controlId) {
    if (!handle || !controlId) return 0.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.getControl(controlId);
}

V2_EXPORT int32_t v2_engine_set_supply(void* handle, int32_t blockIndex, int32_t sourceIndex, double volts, double sourceOhms) {
    if (!handle) return 1;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.setSupply(blockIndex, sourceIndex, volts, sourceOhms);
}

V2_EXPORT double v2_engine_process_sample(void* handle, double inputSample) {
    if (!handle) return 0.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.processSample(inputSample);
}

V2_EXPORT void v2_engine_process_block(void* handle, const float* input, float* output, int32_t numFrames) {
    if (!handle || !output || numFrames <= 0) return;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    ctx->engine.processBlock(input, output, static_cast<size_t>(numFrames));
}

V2_EXPORT float* v2_engine_get_input_buffer(void* handle, int32_t maxFrames) {
    if (!handle) return nullptr;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    if (static_cast<size_t>(maxFrames) > ctx->inputBuffer.size()) {
        ctx->inputBuffer.resize(static_cast<size_t>(maxFrames));
    }
    return ctx->inputBuffer.data();
}

V2_EXPORT float* v2_engine_get_output_buffer(void* handle, int32_t maxFrames) {
    if (!handle) return nullptr;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    if (static_cast<size_t>(maxFrames) > ctx->outputBuffer.size()) {
        ctx->outputBuffer.resize(static_cast<size_t>(maxFrames));
    }
    return ctx->outputBuffer.data();
}

V2_EXPORT void v2_engine_process_internal(void* handle, int32_t numFrames) {
    if (!handle || numFrames <= 0) return;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    size_t frames = static_cast<size_t>(numFrames);
    if (frames > ctx->inputBuffer.size()) frames = ctx->inputBuffer.size();
    if (frames > ctx->outputBuffer.size()) frames = ctx->outputBuffer.size();
    ctx->engine.processBlock(ctx->inputBuffer.data(), ctx->outputBuffer.data(), frames);
}

V2_EXPORT int32_t v2_engine_get_last_iteration_count(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.lastIterationCount();
}

V2_EXPORT int32_t v2_engine_get_last_converged(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.lastConverged() ? 1 : 0;
}

V2_EXPORT int32_t v2_engine_get_max_iterations(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.maxIterationsObserved();
}

V2_EXPORT double v2_engine_get_operating_point(void* handle, int32_t blockIdx, int32_t node) {
    if (!handle) return 0.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    const auto& op = ctx->engine.operatingPoint(static_cast<size_t>(blockIdx));
    if (node >= 0 && node < static_cast<int32_t>(op.size())) {
        return op[node];
    }
    return 0.0;
}

V2_EXPORT double v2_engine_get_state(void* handle, int32_t blockIdx, int32_t stateIdx) {
    if (!handle) return 0.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    const auto& st = ctx->engine.blockState(static_cast<size_t>(blockIdx));
    if (stateIdx >= 0 && stateIdx < static_cast<int32_t>(st.size())) {
        return st[stateIdx];
    }
    return 0.0;
}

V2_EXPORT const char* v2_engine_get_last_error(void* handle) {
    if (!handle) return "";
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->lastError.c_str();
}

// Sparse-schedule telemetry. Unconditional, not behind `V2_PROFILE_TIMERS`: the defect these
// answer for was invisible precisely because it was only observable in a build nobody ships.
// See `Engine::scheduleSolves`. Returned as `double` rather than the engine's `int64_t` because
// this module is built without `WASM_BIGINT`, so an i64 return crosses to JS truncated; a
// double is exact to 2^53, which is some four thousand hours of solves.
V2_EXPORT double v2_engine_get_schedule_solves(void* handle) {
    if (!handle) return 0.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return static_cast<double>(ctx->engine.scheduleSolves());
}

V2_EXPORT double v2_engine_get_schedule_fallbacks(void* handle) {
    if (!handle) return 0.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return static_cast<double>(ctx->engine.scheduleFallbacks());
}

V2_EXPORT double v2_engine_get_kernel_solves(void* handle) {
    if (!handle) return 0.0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return static_cast<double>(ctx->engine.kernelSolves());
}

V2_EXPORT int32_t v2_engine_get_repivoted_schedule_blocks(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return static_cast<int32_t>(ctx->engine.repivotedScheduleBlocks());
}

V2_EXPORT int32_t v2_engine_get_abandoned_schedule_blocks(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.abandonedScheduleBlocks();
}

V2_EXPORT int32_t v2_engine_get_dropped_schedule_blocks(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.droppedScheduleBlocks();
}

#ifdef V2_PROFILE_TIMERS
V2_EXPORT void v2_engine_reset_profile(void* handle) {
    if (!handle) return;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    ctx->engine.resetProfile();
}
V2_EXPORT uint64_t v2_engine_get_profile_assemble_ns(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.getProfile().assemble_ns;
}
V2_EXPORT uint64_t v2_engine_get_profile_factor_ns(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.getProfile().factor_ns;
}
V2_EXPORT uint64_t v2_engine_get_profile_backsub_ns(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.getProfile().backsub_ns;
}
V2_EXPORT uint64_t v2_engine_get_profile_converge_ns(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.getProfile().converge_ns;
}
V2_EXPORT uint64_t v2_engine_get_profile_total_iters(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.getProfile().totalIters;
}
V2_EXPORT uint64_t v2_engine_get_profile_total_samples(void* handle) {
    if (!handle) return 0;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    return ctx->engine.getProfile().totalSamples;
}
#endif

} // extern "C"
