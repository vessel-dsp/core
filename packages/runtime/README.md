# @vessel-dsp/runtime

Headless real time MNA simulation runtime and solver console for compiled VesselDSP `Program` ROMs. It executes a `@vessel-dsp/compiler` program on audio streams with trapezoidal integration and damped Newton Raphson iteration. It depends on `@vessel-dsp/compiler` only. The same package ships the compiled C++/WASM console (`V2WasmEngine`) as a release artifact under `./wasm/*`.

## Install

`@vessel-dsp/runtime` 0.4.1 is on npm. Use runtime 0.2.1 or later (0.3.0 adds the packaged worklet): 0.2.0 cannot load a program inside an AudioWorklet (`structuredClone` is not defined there).


```bash
bun add @vessel-dsp/runtime @vessel-dsp/compiler
```

Subpath exports: `.` (the `ReferenceRuntime` console, chain runtime, admission, settling, and measurement helpers), `./wasm/*` (the compiled solver console files: `v2_dsp.cjs` glue plus `v2_dsp.wasm`), and `./worklet.js` (the bundled v2 AudioWorkletProcessor, ready for `audioWorklet.addModule`).

## Minimal example

The constructor takes the program and optional block elimination only. The sample rate goes to `prepare()`, which has no default. `process()` takes a `Float64Array` and returns a new `Float64Array`. The circuit below ships with the compiler under `./fixtures`, so this runs as written:

```ts
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { commonEmitterAmplifier } from "@vessel-dsp/compiler/fixtures";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const compiled = compile(commonEmitterAmplifier, { registry: emptyRegistry });
if (compiled.status !== "ok") throw new Error("compile failed");

const runtime = new ReferenceRuntime(compiled.program);
runtime.prepare(44100);

const input = new Float64Array(128);
for (let i = 0; i < input.length; i++) {
  input[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 44100);
}
const output = runtime.process(input);
console.log("output length:", output.length);
console.log("output is Float64Array:", output instanceof Float64Array);
let peak = 0;
for (const v of output) peak = Math.max(peak, Math.abs(v));
console.log("output peak:", peak.toFixed(6));
```

```text
output length: 128
output is Float64Array: true
output peak: 0.896891
```

The previous version of this example constructed `new ReferenceRuntime(program, 44100)` and called `process(inputBuffer, outputBuffer)` with `Float32Array` buffers. That throws `RuntimeError: prepare(sampleRate) was never called`, because the second constructor argument is an options object and the rate is only accepted by `prepare()`.

## Construct, prepare, process

`new ReferenceRuntime(program, options?)` copies the program blocks it may later retarget (copy on write) and records control defaults. Options: `{ eliminateBlocks }`, a set of block ids solved by symbolic elimination.

`prepare(sampleRate, options?)` is the only place a rate enters. There is no default. It refuses unusable rates (`sample rate 5 is not usable; a program has no default rate`), programs needing operators or DSP models it does not implement (named in the message), and chains that fail the opt in admission gate. Options:

- `maxNewtonIterations` (default `DEFAULT_NEWTON_MAX_ITERATIONS`): CPU versus accuracy knob. Samples that exhaust it are held and counted in telemetry, never silently interpolated.
- `realtimeBudget`: opt in admission gate; omitted means no gating.
- `inputSourceOhms` (default 0): series impedance of whatever drives the input jack. A console setting, not a program one. A fuzz face driven from an ideal source renders at constant maximum harshness; a guitar source is several kOhm.
- `oversample` (default 1): integer sub samples per host sample. A power of two of 2 or more solves the circuit at `sampleRate * oversample` behind a band-limited half-band FIR cascade: one 2x stage per factor of two, interpolating on the way up and decimating on the way down, with a fixed per-stage prototype (41 taps at Kaiser beta 6.0, then 29 at 7.0, then 21 at 6.0; stages past the table reuse the last entry). Coefficients depend on the stage only, never on the circuit. The cascade is linear phase and delays the output by 19.5 / 26.25 / 28.625 host samples at 2x / 4x / 8x (0.41 / 0.55 / 0.60 ms at 48 kHz), read back by `oversampleLatency()` (`null` before `prepare()`); `hostSampleRate()` reports the host rate. Any other factor (3, 5, ...) keeps the held path: the input sample is held flat across the sub samples and the last sub sample is the output, latency 0. Factor 1 executes the same operations in the same order as before.

At `oversample` 2 or more, a standard audio-pass Newton solve of a nonlinear block starts from a self-selecting extrapolation (order 0, 1 or 2) of the block's last three converged solutions, chosen after every converged solve by scoring the three candidates against the solution in tolerance units and used only after a solve that took at most two iterations; a non-converged solve breaks the chain, and `prepare()` clears it. **At the default factor 1 the predictor does not run:** nothing seeds and nothing records, and every solve starts from the previous solution, as in runtime 0.3.1 (it ran at every factor in 0.4.0; 0.4.1 gated it because at factor 1 it bought 2.9 % / 10.1 % fewer iterations across the pedal / amp corpus while moving `boss-dm-2` by 6.2 % of its cold-start peak). The factor is fixed by `prepare()`, so there is no switch mid run. There is no knob: it changes which iterate inside the convergence tolerance is accepted, not the tolerance.

`process(input: Float64Array): Float64Array` renders one block and returns a new array. Any block length is accepted. `reset()` clears reactive state. `telemetry()` returns per run solver census: samples, non converged, stalled, solved but flagged, per block Newton census, non finite, peak iterations, operating point failures, `operatingPointSupplyAmps`, `renderedSupplyPeakAmps` (null until a sample renders), total iterations, last failure.

`setControl(id, position)` takes 0..1 and applies the program own taper. Unknown ids throw (`program has no control "NOPE"`); positions outside 0..1 throw (`control position 2 is outside 0..1`). There is no `getControl` on this class; the WASM engine has one, this class does not.

## Supply control

Both consoles expose the same pair: `getSupplies()` lists every addressable `dc-source` stamp as `SupplyInfo` (`address`, `positive`, `negative`, `volts`, `sourceOhms`), and `setSupply(addresses, volts, sourceOhms)` retargets them between `process()` calls with effect from the next sample. The common-emitter fixture reports one supply: block 0, source 0, 9 V, 1 ohm.

`setSupply` validates every address before touching state, replaces the touched stamps on the runtime own copies (never the caller `Program`), rebuilds each affected block base matrix the way `prepare()` builds it, and bumps the control generation so eliminated path factorisation rebuilds. Re applying identical values rebuilds nothing (`supplyRebuilds` unchanged). The DC operating point is deliberately not re solved and reactive state carries over.

Call `setSupply` before `prepare()` or mid-stream. The two consoles solve the operating point at different moments, so a call between `prepare()` and the first sample is not guaranteed to agree across them. Which stamps are the external supply is the compiler's `resolveSupplyStamps` (see the Compiler guide); the consoles only retarget the addresses they are given.

What it does not do: no mutation of the caller `Program` (two runtimes from one program never interact; a frozen program never throws), no envelope follower or waveshaper, no audio domain processing of any kind.

`supplyRebuilds` counts block base matrix rebuilds so far. Bad addresses throw: unknown block index, non MNA block, or missing source index, each naming the block and index. Non finite volts and negative or non finite `sourceOhms` throw.

## Admission

`admissionVerdict(chain, sampleRate, budget)` answers whether an ordered list of programs can be shown to fit inside a host CPU budget. Costs add across slots; a one program caller passes a one element list. The budget carries `nsPerSolve`, `nsPerMacroSample` (required; an unpriced model is refused by name, never costed at zero), `budgetedIterationsPerSample` (default 64, a sustained policy allowance, not the solver cap), and `cpuBudgetFraction` (default 1). The verdict is `{ fits: true }` or `{ fits: false, reason }` with the worst offender named by slot, block, unknowns, and nanoseconds. `predictedWorstCaseNs` returns the same sum as a number, or null when a model has no price. `calibrateNsPerSolve` measures this host's real per-solve cost to feed the budget instead of a guess.

## Settling and measurement

`settledRender(program, options)` renders until the output level stops moving and returns a verdict — `settled` with `rms`, `peak`, and the rendered tail, or a refusal/diverged shape — never a bare number. The resistor-divider fixture at 1 V drive settles to exactly its 0.5 ratio (`rms` 0.3536, `peak` 0.5). Alongside it: `measureSharedWindow` and `measureInputAttributable` (shared-window comparisons), `settledSweepVerified` (a control sweep with one point verified against an independent render), and `SETTLE_DEFAULTS` (corpus measured defaults: 0.5 s window, 2 consecutive, 0.25 dB).

## Chain runtime and advisories

- `ChainRuntime`: ordered slots where each slot output feeds the next. `programSlot` wraps a compiled circuit; `processorSlot` wraps a host supplied processor (NAM, IR, cab). Gates the whole chain once against the admission budget, then prepares every slot ungated at the same rate. `setControl(slot, id, position)` addresses one slot; `telemetry()` returns per slot telemetry, never blended.
- `slotContract`: the contract a slot presents to seam arithmetic. `supplyGroundConflicts([programs])`: slot groups whose shared supply would short through grounds (fires when a `positive-ground` program meets a `negative-ground` or `dual-rail` one; `unpowered` conflicts with nothing). `chainAdvisories([contracts])`: seams where one side states no full scale (`unscalable-seam`), plus kind errors (`speaker-signal-into-input`, `cab-after-miked`, `undividable-seam`, `instrument-into-speaker-stage`, `bypass-not-modelled`).
- `seamScale`: multiplier applied to the signal crossing into a slot (1 when either side states no full scale). `dacScaleFactor`: worklet DAC multiplier so a rail swing does not peg output. `outputConversionFullScale`: declared 0 dBFS reference where stated, else derived ceiling. `outputDbfs`: output level in dBFS at the DAC.
- `taperFraction`: fraction of track at a 0..1 position for a taper kind.
- `resolveBypassMode`: chain bypass mode for a program bypass, or null where the host must decide (`buffered` kinds until the buffer program lands).
- `bypassNotModelledAdvisories`: bypass requests on slots whose packet declares no bypass switch.

`supplyGroundConflicts([muff, rangemaster])` reports that the positive ground treble booster and the negative ground muff cannot share one supply. See the Runtime guide for worked samples.

## WASM console

`V2WasmEngine` is the compiled C++/WASM console for the same programs. It ships in this package: `bun run --cwd packages/runtime build:wasm` (needs `em++`) writes `v2_dsp.cjs` plus `v2_dsp.wasm` to the gitignored `src/wasm/`, `build` copies them to `dist/wasm/`, and `prepack` does both, so the published tarball always carries a freshly built console. The 0.2.0 tarball is about 1.0 MB packed (3.1 MB unpacked): 2.1 MB of wasm plus about 15 KB of glue.

`V2WasmEngine.create(program?)` loads the glue from the package's own `dist/wasm/` — no path to configure — and optionally loads a program. `prepare({ sampleRate, maxNewtonIterations, inputSourceOhms, oversample })` (rate defaults to 48000, `oversample` to 1, validated as on the reference console and running the same half-band cascade, latency and held-path rules), `hostSampleRate()` / `oversampleLatency()` with the reference console's names and `null`-before-`prepare()` semantics, `processSample` / `processBlock` on `Float32Array`s, `getControl` beside `setControl`, `getSupplies`/`setSupply` with the same validation and `RuntimeError` behaviour as the reference console, schedule telemetry (`getScheduleTelemetry`: solves, fallbacks, kernel solves, repivoted, abandoned, dropped blocks — a healthy packet reads zero fallbacks and zero abandoned blocks), and Newton start predictor telemetry (`getPredictorTelemetry`: `seedsUsed`, `oneIterationSolves`, `totalIterations` since `prepare()`/`reset()`; `getPredictorOrder(blockIdx)`: the order 0/1/2 the block's next solve seeds from, -1 for a bad index). The console runs the same predictor as the reference, behind the same `oversample > 1` gate, and makes the same order decision sample for sample; at `oversample` 1 `seedsUsed` and `oneIterationSolves` stay 0 and `getPredictorOrder` reads 0.

Native exports (the glue's `_v2_engine_*` functions) changed in runtime 0.4.0: `v2_engine_prepare` is now `(handle, sampleRate, maxNewtonIterations, inputSourceOhms, oversample)` — the `oversample` argument was added to the existing export, not shipped beside it, so a host calling the glue directly must pass it (the wrapper does). New exports: `v2_engine_get_host_sample_rate`, `v2_engine_get_oversample_latency` (doubles, -1 before prepare), `v2_engine_get_predictor_seeds`, `v2_engine_get_one_iteration_solves`, `v2_engine_get_total_iterations` (doubles), `v2_engine_get_predictor_order(handle, blockIdx)` (int32), and the test-only `v2_resample_*` / `v2_testonly_resample_*` getters the package's own tests use.

A host that cannot dynamically import the glue — an `AudioWorkletGlobalScope` bundles it statically and has no `fetch` — instantiates the module from pre-fetched bytes and passes it as the second argument: `V2WasmEngine.create(program, mod)`, where `mod` comes from the glue factory called with `{ wasmBinary }` read from `@vessel-dsp/runtime/wasm/v2_dsp.wasm`. See the Runtime guide for both paths end to end; on a biased BJT stage the two consoles agree sample by sample to about 1e-7.

## Worklet bundle

`@vessel-dsp/runtime/worklet.js` resolves to `dist/worklet/v2-audio-worklet.js`: the v2 `AudioWorkletProcessor` (`src/worklet/v2-audio-worklet.ts`, ported from the workbench reference copy) bundled with esbuild into one file with no external imports, Emscripten glue included. `build` writes it via `bun scripts/build-worklet.ts` (after `build:wasm` provides the glue), and `prepack` ships it, so the published tarball always carries the bundle beside `dist/wasm/v2_dsp.wasm`. It runs `program` slots on the TS `ReferenceRuntime` or, when the `load` message carries `wasmConsole: { wasmBytes }`, on the WASM console; `nam`/`ir` slots are refused by name (their adapters ship in `@vessel-dsp/player`). The worklet scope has no `structuredClone`: programs cross it as JSON (see `V2WasmEngine.loadProgram`), so hosts must not depend on that binding either. Verified by `bun scripts/worklet-proof.ts`, which renders 1 s at 48 kHz in headless Chromium (also with `structuredClone` deleted from the page) and asserts agreement with the TS reference render within 1e-4 max abs.

### Consuming the worklet from a bundler (Next.js)

The worklet and the wasm are static files behind subpath exports, so resolve them against the importing module rather than a relative path that a bundler rewrites:

```ts
const workletUrl = new URL("@vessel-dsp/runtime/worklet.js", import.meta.url);
const wasmUrl = new URL("@vessel-dsp/runtime/wasm/v2_dsp.wasm", import.meta.url);
await audioContext.audioWorklet.addModule(workletUrl);
const wasmBytes = await (await fetch(wasmUrl)).arrayBuffer();
```

For Next.js static export (or any host that serves `public/` verbatim), the copy-to-public alternative avoids bundler URL handling entirely: copy `node_modules/@vessel-dsp/runtime/dist/worklet/v2-audio-worklet.js` and `node_modules/@vessel-dsp/runtime/dist/wasm/v2_dsp.wasm` into `public/vessel-dsp/` and serve them same-origin. Serve `.wasm` as `application/wasm` and the worklet as `text/javascript`; no COOP/COEP headers are needed (single-threaded builds). Hosts that pin or CDN their assets take `workletUrl` / `dspWasmUrl` overrides instead: pass the pinned URLs to `addModule` and `fetch` and skip both patterns above. Lazy-load on first user gesture: create the context, `addModule` the worklet, fetch only the wasm bytes the chain needs, post `load`, then start — never fetch wasm or create a context on page load.

## Reference console surface

Values: `ReferenceRuntime`, `DEFAULT_NEWTON_MAX_ITERATIONS`, `admissionVerdict`, `predictedWorstCaseNs`, `calibrateNsPerSolve`, `denseLinearSolveWorkload`, `ChainRuntime`, `programSlot`, `processorSlot`, `slotContract`, `resolveBypassMode`, `chainAdvisories`, `bypassNotModelledAdvisories`, `seamScale`, `dacScaleFactor`, `outputConversionFullScale`, `outputDbfs`, `supplyGroundConflicts`, `taperFraction`, `settledRender`, `settledSweepVerified`, `measureSharedWindow`, `measureInputAttributable`, `SETTLE_DEFAULTS`, `V2WasmEngine`, `v2WorkletProcessorName`, `postV2WorkletMessage`.

Types (import with `import type`): `RuntimeNodeVoltageSnapshot`, `SupplyAddress`, `SupplyInfo`, `AdmissionVerdict`, `RealtimeBudget`, `ChainSlot`, `ExternalProcessor`, `SlotContract`, `StageCoverage`, `SupplyGroundConflict`, `ChainAdvisory`, `SettleOptions`, `CalibrationResult`, and the rest in the package sources.

Worklet protocol (import with `import type`, except the two values above): `V2WorkletSlot` (one chain slot: a compiled `program`, or an `ir`/`nam` descriptor the runtime worklet refuses by name), `V2WorkletInboundMessage` (`load` an ordered slot chain with optional `wasmConsole` bytes, `setControl` by slot and id, `setBypassMode` by slot), `V2WorkletOutboundMessage` (`loaded` per-slot controls plus supply-ground conflicts and chain advisories, `telemetry` per-slot solver census plus CPU histogram, `error` refusal text), `BypassMode` (`wire` skips the slot, `buffer` and `effect` run it), `V2WorkletPort` (the minimal `{ postMessage }` surface `postV2WorkletMessage` needs, so hosts need no DOM lib).

`RuntimeError` is thrown for misuse: no prepare, bad rate, bad control, bad supply, unimplemented operator or model.
