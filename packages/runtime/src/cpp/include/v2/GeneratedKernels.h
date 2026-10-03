#pragma once

#include <cstddef>
#include <cstdint>

namespace vessel_dsp::v2 {

/**
 * A straight-line generated solve for one block's sparse schedule.
 *
 * Arguments are the schedule replay buffers after the gather: `values` (one per
 * schedule slot, gathered from the block matrix), `scratchRhs`, `factors`, and
 * the output vector. The function performs the same ops in the same order as
 * the interpreted `runSparseSchedule` and returns false only where that does
 * (a pivot below the floor), so the caller's dense fallback is unchanged.
 */
typedef bool (*V2GeneratedKernelFn)(double* values, double* scratchRhs, double* factors, double* out);

struct V2GeneratedKernelEntry {
    uint32_t fingerprint;
    V2GeneratedKernelFn fn;
};

/**
 * The build's generated kernel table, sorted by fingerprint. Defined as a weak
 * empty table in Engine.cpp and overridden by the generated translation unit
 * (`scripts/generate-v2-kernels.ts` writes `src/runtime/cpp/GeneratedKernels.cpp`),
 * so every build that does not include the generated file keeps the interpreter
 * with no build-flag coupling.
 */
const V2GeneratedKernelEntry* v2GeneratedKernels(size_t* count);

} // namespace vessel_dsp::v2
