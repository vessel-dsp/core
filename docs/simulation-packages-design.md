# Simulation & Player Packages Design Specification

## Overview

The VesselDSP simulation and playback architecture separates circuit compilation, real-time circuit simulation, audio signal chain graph routing, and web UI embedding into four distinct packages with strict boundaries:

- `@vessel-dsp/compiler`: Headless AST lowering of `.vdsp` / `CircuitDocument` to compiled Program ROM.
- `@vessel-dsp/runtime`: Headless MNA & nonlinear solver engine.
- `@vessel-dsp/chain`: Headless audio signal chain graph engine (Input Profile + Pedalboard + NAM + Cabinet IR + Master).
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
                             ├── 3. Amp Modeling (v0.1: NAM neural model / profile inference)
                             ├── 4. Cabinet Simulation (v0.1: Fast IR convolution)
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
Turns a parsed `.vdsp` / `CircuitDocument` into an immutable **`Program`** — a compiled execution plan containing:
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
- **Oversampling & Anti-Aliasing**: Optional fractional or integer oversampling for high-gain nonlinear clipping stages.

*Constraints*: Stays strictly headless and audio-rate agnostic.

### 3. `@vessel-dsp/chain` (Headless Signal Chain Engine)
Composes multiple circuit runtimes, guitar conditioning, amplifier models, and cabinet impulse responses into a unified audio processing graph:

#### Node Architecture
- **`InputProfileNode`**:
  - **Pickup Types**: `single-coil`, `humbucker`, `active`, `piezo`, `custom`.
  - **Impedance & Loading**: Simulates pickup coil inductance, resistance, and volume/tone pot load resistance (e.g., 250kΩ, 500kΩ, 1MΩ) with a resonant low-pass filter.
  - **Input Gain**: Trim volume from -24 dB to +24 dB.
- **`RuntimeNode`**: Wraps `@vessel-dsp/runtime` instance for compiled `.vdsp` pedal circuits.
- **`NamNode` (v0.1)**: Neural Amp Modeler profile runner / lightweight wave-shaper neural inference for tube amp emulation.
- **`CabinetIrNode` (v0.1)**: Partitioned time-domain / FFT impulse response convolution for speaker cabinet and microphone captures.
- **`MasterNode`**: Master volume control, mute, and soft-knee safety limiter.

*Roadmap*: Next version incorporates full analog amp lane and cabinet simulation ported from the `workbench` repository.

#### API Contract
```ts
export interface ChainNode {
  readonly id: string;
  readonly name: string;
  bypassed: boolean;
  mix: number;
  prepare(sampleRate: number): void;
  process(input: Float64Array | Float32Array): Float64Array | Float32Array;
  reset(): void;
  getParam(id: string): number | undefined;
  setParam(id: string, value: number): void;
}

export class SignalChain {
  readonly inputProfile: InputProfileNode;
  readonly master: MasterNode;
  addNode(node: ChainNode): this;
  removeNode(id: string): boolean;
  getNode(id: string): ChainNode | undefined;
  getNodes(): readonly ChainNode[];
  prepare(sampleRate: number): void;
  process(input: Float64Array | Float32Array): Float64Array;
  getPreset(): ChainPreset;
  loadPreset(preset: ChainPreset): void;
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
3. **v0.1 NAM & IR Support**:
   - Toggle and load Neural Amp Modeler profiles and Cabinet IRs directly in the player.
4. **Master Volume & Mute**:
   - Master volume fader (dB scale) and global bypass/mute toggle.
5. **Real-Time Spectrum & dB Graph**:
   - Live canvas rendering of the FFT frequency spectrum (20 Hz - 20 kHz) with logarithmic frequency scale.
   - Peak and RMS dB meters with clip indicators.
6. **Custom Element `<vessel-player>` Attributes**:
   - `src`: URL to a `.vdsp` circuit or `.chain.json` preset.
   - `sample`: URL to initial dry DI audio sample.
   - `nam`: Optional URL to a NAM model file.
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
