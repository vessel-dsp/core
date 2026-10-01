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

- **Architectures:** whatever the pinned engine supports -- `Linear`, `WaveNet`,
  `LSTM`, and the A2/slimmable variants. The engine parses the model; the node
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

## Out of scope for 0.1.0

- Power-supply rail sag: out of this release. There is no `PowerSupplyNode`
  and no power-draw bookkeeping; sag needs runtime supply-voltage support
  that does not exist yet.
