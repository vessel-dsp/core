# @vessel-dsp/chain

Headless audio signal chain graph engine for VesselDSP circuits: guitar input
profiling, compiled circuit runtimes, amp shaping, NAM (`.nam`) playback,
cabinet IR convolution, and master output. No UI, no audio runtime, no file
access.

## Nodes

- `InputProfileNode` (`input-profile`): pickup type, impedance loading,
  input trim gain, and a resonant low-pass from pickup inductance plus cable
  capacitance. It models the guitar, cable, and input load only. It is not a
  pickup capture and it does not model pedals or amps.
- `RuntimeNode` (`circuit-runtime`): wraps a `@vessel-dsp/compiler` Program
  running on `@vessel-dsp/runtime`. It is the only node that solves a circuit.
  It needs a compiled program; it cannot compile `.vdsp` by itself.
- `AmpShaperNode` (`amp-shaper`): a tanh waveshaper plus a tone stack with
  dry/wet `mix`. It is not a model loader and must not be called NAM.
- `NamNode` (`nam`): plays Neural Amp Modeler `.nam` captures through the
  vendored WASM engine. See "NAM playback" below.
- `CabinetIrNode` (`cabinet-ir`): zero-latency uniform-partitioned FFT
  convolution. Direct time-domain convolution covers the first 128 taps and
  FFT partitions (256-point frame, in-house radix-2 FFT, no extra dependency)
  cover the tail through a frequency-domain delay line. `process()` accepts
  any block length and output is sample-aligned with the input (latency 0).
  `lowCutHz`/`highCutHz` are 2nd-order Butterworth biquads on the wet signal
  before the mix (defaults 20 Hz / 20000 Hz, skipped at the extremes so a
  default node is transparent; clamps 20..500 and 1000..20000). Optional
  `irSampleRate` resamples the IR at `prepare()` with a windowed sinc (Hann,
  16 zero crossings) when it differs from the prepared rate. The bundled
  128-tap synthetic IR is a placeholder, not a 4x12 capture.
- `GainNode` (`gain`): flat trim gain.
- `MasterNode` (`master`): volume, mute, and a soft-knee safety limiter. It
  is not a loudness maximizer.
- `SignalChain`: ordered graph (`input-profile -> effects -> master`) with
  `addNode`, `insertNode`, `moveNode`, `reorderNodes`, `clearNodes`,
  `toJson`/`fromJson`, and preset `getPreset`/`loadPreset`.

## NAM playback

`NamNode` runs `.nam` models on the NeuralAmpModelerCore engine compiled to
plain WebAssembly, which ships in this package as `nam-engine/nam-engine.wasm`
with its glue `nam-engine/nam-engine.js` (MIT; see `nam-engine/NOTICE.md`).

- **Architectures:** whatever the pinned engine supports -- `Linear`,
  `ConvNet`, `WaveNet`, `LSTM`, and the A2/slimmable variants. The engine parses the model; the node
  does not inspect it beyond the sample rate and loudness the engine reports.
- **The host passes the wasm bytes.** Instantiate the glue with
  `instantiateNamEngine(wasmBytes, factory)` and hand the resulting module to
  the node. An `AudioWorkletGlobalScope` has no `fetch`, so the node never
  fetches the wasm itself.
- **Sample-rate mismatch refuses.** If the model states a sample rate and it
  differs from the chain rate by more than 0.5 Hz, `prepare()` throws naming
  both rates and the model. A model that states no rate is accepted. Nothing
  resamples a model to fit the chain.
- **Loudness is normalised by the engine.** `nam_process` already applies NAM's
  `Normalized` output mode (target -18 dB) with smoothing against clicks; the
  node applies no loudness gain of its own. `getInfo().loudness` reports what
  the engine did.
- **No A/B calibration mode.** NAM's `Calibrated` mode needs an input
  calibration level that models do not carry; it is not implemented.
- **Model files are not bundled.** `.nam` captures are third-party artefacts
  whose licences are their authors'. The package ships the engine only; the
  caller supplies the model's JSON text.

Usage (Bun/Node):

```ts
import { readFileSync } from "node:fs";
import { instantiateNamEngine, NamNode, SignalChain } from "@vessel-dsp/chain";

const factory = (await import("@vessel-dsp/chain/nam-engine.js")).default;
const engine = await instantiateNamEngine(
  readFileSync(new URL("./nam-engine/nam-engine.wasm", import.meta.url)),
  factory,
);
const chain = new SignalChain({ sampleRate: 48000 });
chain.addNode(new NamNode("nam-amp", "NAM Amp", {
  engine,
  model: readFileSync("my-amp.nam", "utf8"),
}));
const out = chain.process(new Float64Array(128));
```

## Latency and limits

- Cabinet IR and NAM both have 0 samples of latency by construction.
- Cost scales with IR length: a 48000-tap IR in 128-sample blocks runs at
  about 5-10x realtime on a desktop CPU in Bun (measured during tests, see
  below); per-sample direct cost is always 128 taps.
- IRs are mono `Float64Array`. Very long IRs use more memory for partitions
  (about 4 KB per 128-tap partition plus the delay line).
- Filters are fixed 2nd-order Butterworth; there is no multi-band EQ.
- `AmpShaperNode` is a single static waveshaper; there is no oversampling.
- NAM cost is the model's own: a WaveNet capture in 128-sample blocks runs at
  roughly 20-40x realtime under Bun on a desktop CPU (wasm, not browser).

## Cable model

`guitarCableLengthMeters` (default 3 m) with `cableCapacitancePfPerM`
(default 100 pF/m) sets the pickup resonance
`f0 = 1 / (2 * pi * sqrt(L * C))`, where `C` is the pickup internal
capacitance plus cable capacitance. Single-coil at 3 m lands around 5.0 kHz;
longer cables lower the resonance. Active pickups bypass the resonant filter
and piezos use a fixed resonance.

## Power supply

`RuntimeNode` can apply a `SupplyProfile` to the circuit external supply.
Pass the `.vdsp` text as the fourth constructor argument, then call
`setSupplyProfile`. The node resolves once with `resolveSupplyStamps` from
`@vessel-dsp/compiler` and retargets each resolved `dc-source` stamp through
`ReferenceRuntime.setSupply`. There is no audio-domain supply processing: the
old audio-domain waveshaper node was rejected and is not present. Sag is the
circuit own current draw through the profile series resistance.

A profile is an open-circuit EMF magnitude plus a series resistance. A null
`openCircuitVolts` keeps the pedal own declared supply voltage. The sign
always follows the stamp own compiled volts sign read from `getSupplies`,
so a positive-ground germanium rail stays negative.

Built-in profiles in `SUPPLY_PROFILES` (values from Jack Orman, 9v Battery
Impedance, AMZ-FX Lab Notebook, 2015, http://www.muzique.com/lab/batteryz.htm,
method: unloaded reading, then loaded with a 560 ohm resistor, Rint by Ohm
law):

- `ideal`: null volts, 0 ohm, source `definition`.
- `alkaline-fresh`: null volts, 5.405 ohm. Source: Orman 2015 fresh table,
  AC-Delco alkaline 5.99 and 4.82 ohm; the value is their mean.
- `zinc-carbon-fresh`: null volts, 25.925 ohm. Source: Orman 2015 fresh
  table, Sunbeam Heavy Duty 25.28 and 26.57 ohm; the value is their mean.
- `alkaline-depleted-specimen`: 7.73 V, 195.00 ohm. Source: Orman 2015 used
  table, Duracell alkaline 6, unloaded 7.73 V, loaded 6.43 V, 195.00 ohm.
  A single specimen, not a type rating.
- `zinc-carbon-used-specimen`: 9.02 V, 78.47 ohm. Source: Orman 2015 used
  table, Golden Power Heavy Duty 7, unloaded 9.02 V, loaded 7.91 V,
  78.47 ohm. A single specimen.

Adapter profiles are deliberately absent. No source was found for regulated
9 V, regulated 18 V, or unregulated AC/DC resistance or voltage.

A measured profile follows the same method:

```ts
import { profileFromMeasurement } from "@vessel-dsp/chain";

const cell = profileFromMeasurement({
  openCircuitVolts: 9.0,
  loadedVolts: 8.0,
  loadOhms: 560,
});
console.log(cell.internalResistanceOhms);
```

```text
70
```

`Rint = (Vopen - Vloaded) / (Vloaded / Rload)`. Here `(9 - 8) / (8 / 560)`
is `560 / 8`, which is 70 ohm.

`customSupplyProfile` builds a profile from caller-supplied numbers with
source `caller-supplied`. `getParams` adds `supplyOpenCircuitVolts` and
`supplyInternalResistanceOhms` once a profile has been applied, and
`setParam` on either re-applies the pair as a custom profile, so a chain
preset round-trips the supply setting. `reset` and `prepare` keep the
applied profile in force. `getSupplyResolution` returns the cached
resolution or null until resolved. A program with refused derived rails but
one resolved external rail applies to the resolved one and keeps the
refusals visible. Missing source text or zero resolved supplies throws with
the refusal reason codes and rail ids.

Example with `big-muff-pi.vdsp` from the corpus, compiled with
`pedalPartCatalog` (read-only, not a committed test):

```ts
import { readFileSync } from "node:fs";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { RuntimeNode, SUPPLY_PROFILES } from "@vessel-dsp/chain";

const source = readFileSync("big-muff-pi.vdsp", "utf8");
const program = (() => {
  const result = compile(source, { registry: pedalPartCatalog });
  if (result.status !== "ok") throw new Error("compile failed");
  return result.program;
})();

function rms(values: Float64Array): number {
  let sum = 0;
  for (const v of values) sum += v * v;
  return Math.sqrt(sum / values.length);
}

const input = new Float64Array(4800);
for (let i = 0; i < input.length; i++) {
  input[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 48000);
}

for (const id of ["ideal", "alkaline-depleted-specimen"] as const) {
  const profile = SUPPLY_PROFILES.find((p) => p.id === id)!;
  const node = new RuntimeNode("muff", "Big Muff", program, { source });
  node.prepare(48000);
  node.setSupplyProfile(profile);
  node.process(input);
  console.log(`${id} rms: ${rms(node.process(input)).toFixed(5)}`);
}
```

```text
ideal rms: 0.20087
alkaline-depleted-specimen rms: 0.19471
```

Limits, stated plainly:

- It uses the TypeScript reference runtime. The WebAssembly console the
  workbench product runs needs the same setter in the workbench repo and is
  not done.
- Op-amp stages draw almost no supply current in the model, so sag on
  op-amp-heavy pedals is under-reported.
- The model source can absorb current a real cell cannot, so a hard clipper
  can push the rail up.
- A single series resistance is a DC approximation (Orman's own AC table shows
  impedance falls with frequency).
- Mains-fed amps are refused by design.

## Out of scope for 0.1.0

- The old audio-domain waveshaper supply node was rejected and is not
  present. There is no audio-domain supply processing.
