# Simulation & Player Packages Design Specification

## Overview

The VesselDSP simulation and playback architecture separates circuit compilation, real-time circuit simulation, audio signal chain graph routing, and web UI embedding into four distinct packages with strict boundaries:

- `@vessel-dsp/compiler`: Headless AST lowering of `.vdsp` / `CircuitDocument` to compiled Program ROM.
- `@vessel-dsp/runtime`: Headless MNA & nonlinear solver engine.
- `@vessel-dsp/chain`: Headless audio signal chain graph engine (Input Profile + Pedalboard + Amp Shaper + NAM + Cabinet IR + Master).
- `@vessel-dsp/player`: Embeddable HTML Custom Element (`<vessel-player>`) with Web Audio runner, sample/live guitar input, real-time spectrum/dB visualizer, and interactive controls.

```text
.vdsp / CircuitDocument
  │
  ▼
[@vessel-dsp/compiler]  ──►  Program (compiled ROM: blocks, stamps, operators, state layout)
  │
  ▼
[@vessel-dsp/runtime]   ──►  Real-time Audio Solver (MNA, Newton iterations, circuit simulation)
  │
  ▼
[@vessel-dsp/chain]     ──►  Headless Signal Chain Graph
                             ├── 1. Guitar Input Profile (Pickup type, impedance, input gain)
                             ├── 2. Pedalboard / Circuit Runtimes (compiled .vdsp)
                              ├── 3. Amp Shaping (tanh waveshaper + tone stack) and NAM (.nam) playback via the vendored WASM engine
                             ├── 4. Cabinet Simulation (v0.1: zero-latency partitioned FFT IR convolution)
                             └── 5. Master Output (Master volume, limiter)
  │
  ▼
[@vessel-dsp/player]    ──►  Embeddable HTML Web Component (<vessel-player>)
                             ├── Audio Sources (DI audio samples or live guitar/mic input)
                             ├── Web Audio Graph & Analyzer (FFT spectrum & dB meter)
                             ├── Interactive Controls (Knobs, switches, pickup profile, bypass)
                             └── Responsive Canvas Spectrum Visualizer
```

## Package Boundaries & Specifications

### 1. `@vessel-dsp/compiler`
Turns a parsed `.vdsp` / `CircuitDocument` into an immutable **`Program`**, a compiled execution plan containing:
- **Block Partitions & Linear/Nonlinear Regions**: Subcircuits partitioned by topological coupling and operational complexity.
- **MNA Stamps & Conductance Matrices**: Precomputed $G$, $C$, $B$, $D$ matrices for Modified Nodal Analysis.
- **Nonlinear Operators**: Mathematical models for diodes, BJTs, JFETs, triodes, op-amps, and BBD clock drivers.
- **Parameter Mappings & Controls**: Normalized control mapping with potentiometer taper laws (linear, audio, reverse audio).
- **State Vector Layout**: Layout of dynamic capacitor voltages, inductor currents, and nonlinear state variables.

*Constraints*: Pure TypeScript, deterministic, rate-independent, headless.

### 2. `@vessel-dsp/runtime`
Executes a compiled `Program` on audio streams:
- **Solver Core**: Solves MNA equations per time step using trapezoidal integration and damped Newton-Raphson iteration for nonlinear devices.
- **Real-Time Admission & CPU Budgeting**: Evaluates whether a program fits within the CPU budget of an audio quantum (128 samples) before execution.
- **Settling & DC Bias Policy**: Pre-settles operating points to avoid audible start-up pops and transient thumps.
- **Oversampling & Anti-Aliasing**: Optional integer oversampling for high-gain nonlinear clipping stages.

*Constraints*: Stays strictly headless and audio-rate agnostic.

### 3. `@vessel-dsp/chain` (Headless Signal Chain Engine)
Composes multiple circuit runtimes, guitar conditioning, amplifier models, and cabinet impulse responses into a unified audio processing graph:

#### Node Architecture
- **`InputProfileNode`**:
  - **Pickup Types**: `single-coil`, `humbucker`, `active`, `piezo`, `custom`.
  - **Impedance & Loading**: Models pickup coil inductance and internal capacitance plus the input impedance load (e.g., 250kΩ, 500kΩ, 1MΩ) with a resonant low-pass filter.
  - **Input Gain**: Trim volume from -24 dB to +24 dB.
- **`RuntimeNode`**: Wraps `@vessel-dsp/runtime` instance for compiled `.vdsp` pedal circuits.
- **`AmpShaperNode`** (`amp-shaper`): tanh waveshaper plus tone stack with dry/wet `mix`. It cannot load `.nam` models and must not be called NAM.
- **`NamNode`** (`nam`): plays `.nam` captures through the NeuralAmpModelerCore engine compiled to plain WebAssembly, vendored in the package as `nam-engine/nam-engine.wasm` with its glue. The host instantiates the engine and passes the wasm bytes (a worklet scope has no `fetch`); the node takes the model's JSON text. Architectures are whatever the pinned engine supports (`Linear`, `WaveNet`, `LSTM`, A2/slimmable). A model whose stated sample rate differs from the chain rate by more than 0.5 Hz is refused by name, never run silently; a model stating no rate is accepted and nothing resamples it. Loudness normalisation (NAM's `Normalized` mode, target -18 dB) is applied by the engine itself, so the node applies no loudness gain; `getInfo().loudness` reports what the engine did. There is no A/B calibration mode. Model files are NOT bundled -- `.nam` captures are third-party artefacts and licensing the model is the user's responsibility. `SignalChain.fromJson`/`loadPreset` cannot recreate a `NamNode` (a preset carries neither engine nor model); the default node factory returns `undefined` for kind `nam` and a host that can supply both passes its own `nodeFactory`.
- **`CabinetIrNode`**: zero-latency uniform-partitioned FFT convolution (direct first 128 taps plus FFT tail, 256-point in-house radix-2 FFT). `lowCutHz`/`highCutHz` are 2nd-order Butterworth biquads on the wet signal (defaults 20 Hz / 20000 Hz, transparent at the extremes). Optional `irSampleRate` resamples the IR at `prepare()` with a windowed sinc (Hann, 16 zero crossings). The bundled 128-tap synthetic IR is a placeholder, not a 4x12 capture.
- **`MasterNode`**: Master volume control, mute, and soft-knee safety limiter.
- Power-supply rail sag is out of scope for 0.1.0: there is no supply-voltage or source-resistance control.

#### API Contract
```ts
export interface ChainNode {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  bypassed: boolean;
  mix: number;
  prepare(sampleRate: number): void;
  process(input: Float64Array | Float32Array): Float64Array;
  reset(): void;
  getParam(id: string): number | undefined;
  setParam(id: string, value: number): void;
  getParams(): Record<string, number>;
  dispose?(): void;
}

export class SignalChain {
  readonly inputProfile: InputProfileNode;
  readonly master: MasterNode;
  addNode(node: ChainNode): this;
  insertNode(node: ChainNode, index: number): this;
  moveNode(id: string, targetIndex: number): boolean;
  reorderNodes(orderedIds: readonly string[]): boolean;
  removeNode(id: string): boolean;
  clearNodes(): this;
  getNode(id: string): ChainNode | undefined;
  getNodes(): readonly ChainNode[];
  getEffectNodes(): readonly ChainNode[];
  prepare(sampleRate: number): void;
  process(input: Float64Array | Float32Array): Float64Array;
  getPreset(name?: string): ChainPreset;
  loadPreset(
    preset: ChainPreset,
    nodeFactory?: (snapshot: NodeSnapshot) => ChainNode | undefined,
  ): void;
  toJson(name?: string): string;
  static fromJson(
    json: string,
    options?: { sampleRate?: number; nodeFactory?: (snapshot: NodeSnapshot) => ChainNode | undefined },
  ): SignalChain;
  reset(): void;
}
```

### 4. `@vessel-dsp/player` (Embeddable HTML Component)
An embeddable HTML Custom Element (`<vessel-player>`) designed for documentation, pedal builders, showcase sites, and interactive web stores.

#### Feature Set
1. **Audio Sources**:
   - **Sample Player**: Bundled and custom DI track loops (clean guitar chord progressions, funk riffs, bass lines) with play, pause, seek, and loop controls.
   - **Live Guitar / Audio Interface Input**: Low-latency `navigator.mediaDevices.getUserMedia` capture with raw studio settings (`echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`).
2. **Guitar Input Profile Controls**:
   - Dropdown for pickup type (`single-coil`, `humbucker`, `active`, `piezo`).
   - Knobs/sliders for input impedance (250kΩ, 500kΩ, 1MΩ) and input trim gain (dB).
3. **v0.1 Amp & IR Support**:
   - Toggle amp shaping (tanh waveshaper, no `.nam` loading) and Cabinet IRs directly in the player. Real NAM playback lives in `@vessel-dsp/chain`'s `NamNode`, which needs an instantiated engine and a model file the player does not carry.
4. **Master Volume & Mute**:
   - Master volume fader (dB scale) and global bypass/mute toggle.
5. **Real-Time Spectrum & dB Graph**:
   - Live canvas rendering of the FFT frequency spectrum (20 Hz - 20 kHz) with logarithmic frequency scale.
   - Peak and RMS dB meters with clip indicators.
6. **Custom Element `<vessel-player>` Attributes**:
   - `src`: URL to a `.vdsp` circuit or `.chain.json` preset.
   - `sample`: URL to initial dry DI audio sample.
   - `ir`: Optional URL to a cabinet impulse response `.wav`.
   - `pickup`: Default pickup type (`single-coil` | `humbucker` | `active` | `piezo`).
   - `theme`: UI color theme (`dark` | `light`).
   - `controls`: Enable/disable full UI controls.

```html
<!-- Load player script -->
<script type="module" src="https://unpkg.com/@vessel-dsp/player/dist/index.js"></script>

<!-- Drop-in custom element -->
<vessel-player
  src="/circuits/tube-screamer.vdsp"
  sample="/audio/clean-strat-riff.wav"
  ir="/cabs/4x12-greenback.wav"
  pickup="single-coil"
  theme="dark"
  controls
></vessel-player>
```
