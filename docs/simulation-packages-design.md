# Simulation & Player Packages Design Specification

## Overview

The VesselDSP simulation and playback architecture is structured across three execution phases with strict package boundaries:

- **Phase 1**: Core Circuit Compiler & Solver (`@vessel-dsp/compiler` & `@vessel-dsp/runtime` in `VesselDSP/core`) — **v0.1 Pure MNA Analog Circuits**.
- **Phase 2**: Headless Audio Signal Chain (`@vessel-dsp/chain` in `VesselDSP/core`) — **Guitar Input Profile, Cable Modeling, Circuit Slots, NAM, and Cabinet IRs**.
- **Phase 3**: Embeddable Player UI & Editor (`<vessel-player>` in `VesselDSP/website`) — **CodePen-Style Dual-Mode Embed & Full Editor sharing UI components with `vesseldsp.com/{user}/player/{id}` and `vesseldsp.com/{user}/editor/{id}`**.

```text
┌────────────────────────────────────────────────────────────────────────┐
│               PHASE 1: PURE MNA ANALOG SIMULATION (core repo)          │
│                                                                        │
│   .vdsp / CircuitDocument                                              │
│     │                                                                  │
│     ▼                                                                  │
│   [@vessel-dsp/compiler]  ──►  Program (MNA Matrices, Stamps, Tapers)   │
│     │                                                                  │
│     ▼                                                                  │
│   [@vessel-dsp/runtime]   ──►  MNA Solver (Newton-Raphson, DC Settle)  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   PHASE 2: HEADLESS SIGNAL CHAIN (core repo)           │
│                                                                        │
│   [@vessel-dsp/chain]     ──►  Audio Graph Orchestrator                │
│                                ├── 1. Guitar Input Profile & Cables    │
│                                ├── 2. MNA Pedal Circuits (RuntimeNode) │
│                                ├── 3. Tube Amp Stages (v0.1 NAM)       │
│                                ├── 4. Speaker Cabinet (v0.1 IR)        │
│                                └── 5. Master Output & Limiter          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              PHASE 3: EMBED PLAYER & DSP IDE (website repo)            │
│                                                                        │
│   [VesselDSP/website]     ──►  Shared UI Components & Routing          │
│                                ├── Embed: <vessel-player> Card / Embed │
│                                ├── Standalone: /{user}/player/{id}     │
│                                └── Full Studio: /{user}/editor/{id}    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Pure MNA Analog Circuit Simulation (core repo)

Phase 1 focuses strictly on **pure analog circuits** modeled via Modified Nodal Analysis (MNA), trapezoidal numerical integration, and damped Newton-Raphson nonlinear iteration:

### 1. `@vessel-dsp/compiler`
Lowers parsed `.vdsp` / `CircuitDocument` schematics into an immutable **`Program` ROM**:
- **Linear Passives**:
  - Resistors (conductance stamps $G = 1/R$)
  - Capacitors (companion model conductance $G_C = 2C/\Delta t$ and current source $I_C$)
  - Inductors (companion model conductance $G_L = \Delta t/(2L)$ and current source $I_L$)
  - Audio / Output Transformers (ideal & coupled inductor models)
  - Rails & Voltage Sources (independent DC/AC sources, ground ties)
  - Potentiometers & Rheostats (linear, audio/log, and reverse-audio taper mappings in $0.0..1.0$)
- **Nonlinear Active Devices**:
  - Diodes (Shockley exponential diode law, silicon, germanium, LEDs)
  - Bipolar Junction Transistors (Ebers-Moll / Gummel-Poon BJT models)
  - JFETs & MOSFETs (Shockley quadratic pinch-off and triode region equations)
  - Operational Amplifiers (linear gain with rail clipping)
  - Vacuum Tubes (Child-Langmuir & triode/pentode models)
  - Operational Transconductance Amplifiers (OTA models: CA3080, LM13700)
- **Topological Partitioning**:
  - Partitions circuits into decoupled linear and nonlinear blocks.
  - Computes dense MNA stamps ($G, C, B, D$ matrices) per block.
  - Strips visual geometry and metadata, outputting pure deterministic simulation bytecode.

### 2. `@vessel-dsp/runtime`
Executes compiled `Program` ROMs per audio sample block:
- **Solver Core**:
  - Direct LU / Gaussian elimination for linear MNA blocks.
  - Dynamic Jacobian matrix assembly and damped Newton-Raphson iteration for nonlinear active circuits.
- **Operating Point Pre-Settling**:
  - Solves the DC steady-state operating point prior to audio rendering to prevent start-up clicks and pops.
- **Real-Time Admission & Safety**:
  - Enforces per-sample iteration limits and CPU budget checks.
  - Fail-closed refusal if a required operator or singular matrix is encountered.

---

## Phase 2: Headless Signal Chain Engine (core repo)

Composes multiple circuit instances, guitar pre-conditioning, amplifier models, and cabinet impulse responses into a unified audio processing graph:

### Node Architecture
- **`InputProfileNode`**:
  - **Pickup Types**: `single-coil`, `humbucker`, `active`, `piezo`, `custom`.
  - **Cable Capacitance & Routing**:
    - **Guitar to First Pedal**: Default `3 m` (options: `15 cm`, `30 cm`, `1 m`, `3 m`, `6 m`, `10 m`).
    - **Pedal to Pedal (Patch)**: Default `15 cm` (options: `15 cm`, `30 cm`, `50 cm`, `1 m`).
    - **Last Pedal to Amp**: Default `3 m` (options: `1 m`, `3 m`, `6 m`, `10 m`).
    - **Capacitance**: Default $100\text{ pF/m}$ ($60\text{--}150\text{ pF/m}$ configurable).
    - **Buffer Isolation**: Dynamically isolates upstream pickup $LC$ resonance from downstream cable capacitance when an active buffer / buffered pedal is in the chain.
  - **Impedance & Loading**: Simulates pickup inductance, cumulative unbuffered cable capacitance, and volume/tone pot load resistance (250kΩ, 500kΩ, 1MΩ) via resonant biquad filtering.
  - **Input Gain**: Trim volume from -24 dB to +24 dB.
- **`RuntimeNode`**: Wraps Phase 1 `@vessel-dsp/runtime` instances for compiled `.vdsp` pedal circuits.
- **`NamNode` (v0.1)**: Neural Amp Modeler profile runner / tube saturation wave-shaper.
- **`CabinetIrNode` (v0.1)**: Partitioned time-domain / FFT impulse response convolution for speaker cabinet and microphone captures.
- **`MasterNode`**: Master volume control, mute, and soft-knee safety limiter.

---

## Phase 3: Embeddable Player & DSP Studio (website repo)

The embeddable `<vessel-player>` and full-blown DSP Studio are maintained in `VesselDSP/website`, directly reusing shared UI components and routing:

### Unified Views in `website`:
1. **`<vessel-player>` (Embed)**:
   - Lightweight embed / card for documentation (Astro/Starlight), blog posts, and store pages.
   - Real-time spectrum analyzer, level meters, and bypass controls.
   - Declarative interface:
     - `src="https://vesseldsp.com/{user}/pedal/{id}"`
     - `src="https://vesseldsp.com/{user}/pedal/{id}?rev={hash}"`
     - `entity="{id}"`
2. **`vesseldsp.com/{user}/player/{id}` (Standalone Player)**:
   - Dedicated public preview page with live playback and preset management.
3. **`vesseldsp.com/{user}/editor/{id}` (DSP IDE & Circuit Studio)**:
   - 3-pane CodePen-inspired DSP IDE with live `.vdsp` editor, real-time hot-recompilation via `@vessel-dsp/compiler`, full rack chain configuration, and analyzer.

---

## Workspace Package Matrix

| Package / Target | Phase | Repository | Status | Primary Role |
| :--- | :--- | :--- | :--- | :--- |
| `@vessel-dsp/compiler` | Phase 1 | `VesselDSP/core` | v0.1 Ready | Headless `.vdsp` compiler lowering circuits to MNA Program ROMs |
| `@vessel-dsp/runtime` | Phase 1 | `VesselDSP/core` | v0.1 Ready | Headless MNA & Newton-Raphson real-time solver |
| `@vessel-dsp/chain` | Phase 2 | `VesselDSP/core` | v0.1 Ready | Headless signal chain graph (Guitar Profile + Cables + Circuits + NAM + IR) |
| `<vessel-player>` | Phase 3 | `VesselDSP/website` | In Progress | Embeddable Web Component & Player/Editor UI sharing web components |
