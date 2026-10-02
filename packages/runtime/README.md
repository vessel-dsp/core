# @vessel-dsp/runtime

Headless real time MNA simulation runtime and solver console for compiled VesselDSP `Program` ROMs. It executes a `@vessel-dsp/compiler` program on audio streams with trapezoidal integration and damped Newton Raphson iteration. It depends on `@vessel-dsp/compiler` only.

## Install

`@vessel-dsp/runtime` 0.1.0 is not yet on npm. Until the release is published, use the package from this repository's workspace rather than an install command that will 404.

```bash
# once published:
bun add @vessel-dsp/runtime
```

## Minimal example

The constructor takes the program and optional block elimination only. The sample rate goes to `prepare()`, which has no default. `process()` takes a `Float64Array` and returns a new `Float64Array`.

```ts
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const source = readFileSync("big-muff-pi.vdsp", "utf8");
const compiled = compile(source, { registry: pedalPartCatalog });
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
output peak: 0.265499
```

The previous version of this example constructed `new ReferenceRuntime(program, 44100)` and called `process(inputBuffer, outputBuffer)` with `Float32Array` buffers. That throws `RuntimeError: prepare(sampleRate) was never called`, because the second constructor argument is an options object and the rate is only accepted by `prepare()`.

## Construct, prepare, process

`new ReferenceRuntime(program, options?)` copies the program blocks it may later retarget (copy on write) and records control defaults. Options: `{ eliminateBlocks }`, a set of block ids solved by symbolic elimination.

`prepare(sampleRate, options?)` is the only place a rate enters. There is no default. It refuses unusable rates (`sample rate 5 is not usable; a program has no default rate`), programs needing operators or DSP models it does not implement (named in the message), and chains that fail the opt in admission gate. Options:

- `maxNewtonIterations` (default `DEFAULT_NEWTON_MAX_ITERATIONS`): CPU versus accuracy knob. Samples that exhaust it are held and counted in telemetry, never silently interpolated.
- `realtimeBudget`: opt in admission gate; omitted means no gating.
- `inputSourceOhms` (default 0): series impedance of whatever drives the input jack. A console setting, not a program one. A fuzz face driven from an ideal source renders at constant maximum harshness; a guitar source is several kOhm.
- `oversample` (default 1): integer sub samples per host sample. Zero order hold output (last sub sample wins); no band limiting decimator is implemented.

`process(input: Float64Array): Float64Array` renders one block and returns a new array. Any block length is accepted. `reset()` clears reactive state. `telemetry()` returns per run solver census: samples, non converged, stalled, solved but flagged, per block Newton census, non finite, peak iterations, operating point failures, `operatingPointSupplyAmps`, `renderedSupplyPeakAmps` (null until a sample renders), total iterations, last failure.

`setControl(id, position)` takes 0..1 and applies the program own taper. Unknown ids throw (`program has no control "NOPE"`); positions outside 0..1 throw (`control position 2 is outside 0..1`). There is no `getControl` on this class; the WASM engine has one, this class does not.

## Supply control

`getSupplies()` lists every addressable `dc-source` stamp as `SupplyInfo` (`address`, `positive`, `negative`, `volts`, `sourceOhms`). `big-muff-pi` reports one supply: block 0, source 0, 9 V, 1 ohm.

`setSupply(addresses, volts, sourceOhms)` retargets supply stamps between `process()` calls with effect from the next sample. It validates every address before touching state, replaces the touched stamps on the runtime own copies (never the caller `Program`), rebuilds each affected block base matrix the way `prepare()` builds it, and bumps the control generation so eliminated path factorisation rebuilds. Re applying identical values rebuilds nothing. The DC operating point is deliberately not re solved and reactive state carries over.

What it does not do: no mutation of the caller `Program` (two runtimes from one program never interact; a frozen program never throws), no envelope follower or waveshaper, no audio domain processing of any kind. This is the TypeScript reference runtime only.

`supplyRebuilds` counts block base matrix rebuilds so far. Bad addresses throw: unknown block index, non MNA block, or missing source index, each naming the block and index. Non finite volts and negative or non finite `sourceOhms` throw.

## Admission

`admissionVerdict(chain, sampleRate, budget)` answers whether an ordered list of programs can be shown to fit inside a host CPU budget. Costs add across slots; a one program caller passes a one element list. The budget carries `nsPerSolve`, `nsPerMacroSample` (required; an unpriced model is refused by name, never costed at zero), `budgetedIterationsPerSample` (default 64, a sustained policy allowance, not the solver cap), and `cpuBudgetFraction` (default 1). The verdict is `{ fits: true }` or `{ fits: false, reason }` with the worst offender named by slot, block, unknowns, and nanoseconds. `predictedWorstCaseNs` returns the same sum as a number, or null when a model has no price.

## Settling and measurement

These render a program until its level stops moving, so startup transients are not measured as the circuit.

| Name | What it is |
| --- | --- |
| `findSettled` | First window at which the level holds still, or null. |
| `measureSettled` | Render until the output level stops moving and report it. |
| `measureSettledSignal` | Driven level with the silent part removed. |
| `measureSharedWindow` | Several drive levels over one shared settled window. |
| `measureInputAttributable` | Per node AC attributable to the input (driven minus silent). |
| `settledRender` | Render until still, in a value, refusal, or diverged shape. |
| `settledLevel` | `settledRender` level as a bare number, throwing when it cannot settle. |
| `settledSweep` | Settle once, then measure each control setting on the same runtime. |
| `settledSweepVerified` | Sweep with one point verified against an independent render. |
| `sweepMatchesIndependent` | Whether a sweep point matches an independent render. |
| `sweepIsOrderIndependent` | Whether sweep order changes the result. |
| `settleSelfCheck` | Known answer controls for the measurement primitives. |
| `SettleOptions` | Window, consecutive, stable dB, and ladder seconds. |
| `SETTLE_DEFAULTS` | Corpus measured defaults (0.5 s window, 2 consecutive, 0.25 dB). |
| `SettleCriterion` | Which criterion produced a measurement. |
| `Settled` | `{ rms, seconds }` of the settled window. |
| `SettledMeasurement` | `{ rms, peak, settleSeconds, renderedSeconds, flatAtZero }`. |
| `SettledRender` | Value, refusal, or diverged outcome of `settledRender`. |
| `SettledRenderOptions` | What to render. |
| `SettleRefusal` | Thrown by `settledLevel` instead of an unstandable level. |
| `SharedWindowMeasurement` | One drive behaviour over the shared window. |
| `AttributedMeasurement` | Driven level plus attributable fraction from one window. |
| `InputAttributableNode` | One node response with and without stimulus. |
| `FLAT_AT_ZERO_RMS` | Level below this (1e-6) is noise, not measurement. |
| `isFlatAtZero` | Whether a level is indistinguishable from noise. |

`findSettled([1, 1.001, 1.0005, 1.0001])` returns `{ rms: 1.0005, seconds: 1.5 }`; `findSettled([1, 2, 4, 8])` returns null. `measureSettled` on `big-muff-pi` at 48000 Hz with a 0.3 V 440 Hz sine reports rms about 0.2010, peak about 0.2491, settled in 1.5 s.

## Chain runtime and advisories

| Name | What it is |
| --- | --- |
| `ChainRuntime` | Ordered slots where each slot output feeds the next. |
| `ChainSlot` | A program slot or an injected processor slot. |
| `ChainSlotTelemetry` | One slot telemetry labelled by position. |
| `programSlot` | A compiled circuit as a slot. |
| `processorSlot` | An injected processor (NAM, IR, cab) as a slot. |
| `ExternalProcessor` | A host supplied processor: NAM profile, impulse response, cab simulation. |
| `slotContract` | The contract a slot presents to seam arithmetic. |
| `SlotContract` | What the chain needs to know about a slot. |
| `slotLabel` | Human readable label for a slot. |
| `supplyGroundConflicts` | Slot pairs whose shared supply would short through grounds. |
| `SupplyGroundConflict` | One conflicting slot pair with message. |
| `chainAdvisories` | Seams where one side states no full scale, plus kind errors. |
| `ChainAdvisory` | One chain problem with code, slots, and message. |
| `chainScaleFactor` | Multiplier from two adjacent port full scales (null is unity). |
| `chainScaleAdvisories` | Boundaries where the chain fell back to unity scaling. |
| `ChainScaleAdvisory` | One unity fallback boundary with message. |
| `seamScale` | Multiplier applied to the signal crossing into a slot. |
| `seamDivider` | Resistive divider at a seam, or 1 when not computable. |
| `dacScaleFactor` | Worklet DAC multiplier so a rail swing does not peg output. |
| `outputDbfs` | Output level in dBFS at the DAC. |
| `outputConversionFullScale` | Declared 0 dBFS reference where stated, else derived ceiling. |
| `taperFraction` | Fraction of track at a 0..1 position for a taper kind. |
| `StageCoverage` | `instrument`, `preamp`, `speaker-electrical`, or `miked`. |

`ChainRuntime` gates the whole chain once against the admission budget, then prepares every slot ungated at the same rate. `process()` feeds slot outputs forward with `seamScale` between them. `setControl(slot, id, position)` addresses one slot; processor slots refuse with the slot named. `telemetry()` returns per slot telemetry, never blended.

`supplyGroundConflicts([muff, rangemaster])` reports that the positive ground treble booster and the negative ground muff cannot share one supply. `chainAdvisories` reports `unscalable-seam` where a full scale is null, `speaker-signal-into-input` where a speaker terminal feeds an instrument input, `cab-after-miked`, `undividable-seam`, and `instrument-into-speaker-stage`.

## WASM engine

| Name | What it is |
| --- | --- |
| `V2WasmEngine` | Exported TypeScript wrapper around the C++ V2 console. Requires a build artifact the package does not ship; not usable from the npm package today. |
| `getV2WasmModule` | Loads the V2 Emscripten module from the missing build artifact. |

`V2WasmEngine` dynamically imports `../../build/v2_dsp.cjs`, a built artifact that is not in this repository and not in the package `files` (`dist`, `README.md`, `LICENSE.md`). From an installed tarball it fails with:

```text
Error: Cannot find module
'/tmp/v2proof-proj/node_modules/@vessel-dsp/build/v2_dsp.cjs'
imported from
'/tmp/v2proof-proj/node_modules/@vessel-dsp/runtime/dist/v2-wasm-engine.js'
```

Evidence: packed the runtime and compiler tarballs, installed both with npm into an empty project under `/tmp`, and called `getV2WasmModule()` and `V2WasmEngine.create()`. Both reject with the error above; the tarball contains `dist` only, no `build` directory. The export is kept as is (removing it is an API decision for the maintainer). Two options for the maintainer: ship the built artifact in the package `files`, or drop the export.

## Reference runtime surface

| Name | What it is |
| --- | --- |
| `ReferenceRuntime` | The executable semantics of the program format. |
| `RuntimeTelemetry` | What the solver did, so failing to solve is never silent. |
| `RuntimeBranchCurrent` | One solved branch current per auxiliary unknown. |
| `RuntimeNodeVoltageSnapshot` | Per block node voltages. |
| `SupplyAddress` | `{ blockIndex, sourceIndex }` naming one `dc-source` stamp. |
| `SupplyInfo` | Address plus the stamp own positive, negative, volts, sourceOhms. |
| `DEFAULT_NEWTON_MAX_ITERATIONS` | How long a Newton loop may try before its iterate is the answer. |
| `RealtimeBudget` | Host measured solve costs plus iteration and fraction policy. |
| `AdmissionVerdict` | `{ fits: true }` or `{ fits: false, reason }`. |
| `admissionVerdict` | Whether a chain of programs fits inside a budget. |
| `predictedWorstCaseNs` | The admission worst case sum as a number, or null. |
| `RuntimeError` | Thrown for misuse: no prepare, bad rate, bad control, bad supply, unimplemented operator or model. |
