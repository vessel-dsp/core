#include "v2/Engine.h"
#include <vector>
#include <string>
#include <memory>
#include <cstring>

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

V2_EXPORT void v2_engine_prepare(void* handle, double sampleRate, int32_t maxNewtonIterations, double inputSourceOhms) {
    if (!handle) return;
    auto* ctx = static_cast<V2WasmContext*>(handle);
    EngineOptions opts;
    opts.sampleRate = sampleRate > 0.0 ? sampleRate : 48000.0;
    opts.maxNewtonIterations = maxNewtonIterations > 0 ? maxNewtonIterations : 64;
    opts.inputSourceOhms = inputSourceOhms >= 0.0 ? inputSourceOhms : 0.0;
    ctx->engine.prepare(opts);
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
