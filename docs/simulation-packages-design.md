# Simulation & Player Packages Design Specification

## Overview

The VesselDSP simulation and playback architecture is structured across three execution phases with strict package boundaries:

- **Phase 1**: Core Circuit Compiler & Solver (`@vessel-dsp/compiler` & `@vessel-dsp/runtime`) — **v0.1 Pure MNA Analog Circuits**.
- **Phase 2**: Headless Audio Signal Chain (`@vessel-dsp/chain`) — **Guitar Input Profile, Circuit Slots, NAM, and Cabinet IRs**.
- **Phase 3**: Embeddable Player UI (`@vessel-dsp/player`) — **CodePen-Style Dual-Mode Web Component (`<vessel-player>`)**.

```text
┌────────────────────────────────────────────────────────────────────────┐
│               PHASE 1: PURE MNA ANALOG SIMULATION (v0.1)               │
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
│                   PHASE 2: HEADLESS SIGNAL CHAIN                       │
│                                                                        │
│   [@vessel-dsp/chain]     ──►  Audio Graph Orchestrator                │
│                                ├── 1. Guitar Input Profile (Pickups)   │
│                                ├── 2. MNA Pedal Circuits (RuntimeNode) │
│                                ├── 3. Tube Amp Stages (v0.1 NAM)       │
│                                ├── 4. Speaker Cabinet (v0.1 IR)        │
│                                └── 5. Master Output & Limiter          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                  PHASE 3: CODEPEN-STYLE PLAYER                         │
│                                                                        │
│   [@vessel-dsp/player]    ──►  Embeddable Web Component                │
│                                ├── Compact Mode: Live Card / Analyzer  │
│                                ├── Studio Mode: 3-Pane Grid (.vdsp IDE)│
│                                └── Web Audio Engine (Sample / Mic DI)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Pure MNA Analog Circuit Simulation (v0.1)

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

## Phase 2: Headless Signal Chain Engine (`@vessel-dsp/chain`)

Composes multiple circuit instances, guitar pre-conditioning, amplifier models, and cabinet impulse responses into a unified audio processing graph:

### Node Architecture
- **`InputProfileNode`**:
  - **Pickup Types**: `single-coil`, `humbucker`, `active`, `piezo`, `custom`.
  - **Impedance & Loading**: Simulates pickup inductance, cable capacitance, and volume/tone pot load resistance (250kΩ, 500kΩ, 1MΩ) via resonant filtering.
  - **Input Gain**: Trim volume from -24 dB to +24 dB.
- **`RuntimeNode`**: Wraps Phase 1 `@vessel-dsp/runtime` instances for compiled `.vdsp` pedal circuits.
- **`NamNode` (v0.1)**: Neural Amp Modeler profile runner / tube saturation wave-shaper.
- **`CabinetIrNode` (v0.1)**: Partitioned time-domain / FFT impulse response convolution for speaker cabinet and microphone captures.
- **`MasterNode`**: Master volume control, mute, and soft-knee safety limiter.

---

## Phase 3: Embeddable CodePen-Style Player (`@vessel-dsp/player`)

An embeddable HTML Custom Element (`<vessel-player>`) designed for documentation, pedal builders, showcase sites, and interactive web stores.

### Dual-Mode Architecture
1. **Compact / Embed Mode (Default)**:
   - Interactive playing panel & bypass controls.
   - Real-time FFT frequency spectrum and peak/RMS dB meter on canvas.
   - Audio transport (sample DI loops vs live guitar/mic input).
   - Top-right **`[ ↗ STUDIO ]`** expansion toggle.
2. **Studio Grid Mode (Expanded / Fullscreen)**:
   - **Pane 1**: Live `.vdsp` source code editor with instant re-compilation and error reporting.
   - **Pane 2**: Signal chain configuration rack (Pickups, Impedance, Pedal slots, NAM, IR).
   - **Pane 3**: Real-time spectrum analyzer, level meters, and master output controls.

---

## Workspace Package Matrix

| Package | Phase | Status | Primary Role |
| :--- | :--- | :--- | :--- |
| `@vessel-dsp/compiler` | Phase 1 | v0.1 Ready | Headless `.vdsp` compiler lowering circuits to MNA Program ROMs |
| `@vessel-dsp/runtime` | Phase 1 | v0.1 Ready | Headless MNA & Newton-Raphson real-time solver console |
| `@vessel-dsp/chain` | Phase 2 | v0.1 Ready | Headless signal chain graph (Guitar Profile + Circuits + NAM + IR) |
| `@vessel-dsp/player` | Phase 3 | v0.1 Ready | CodePen-style embeddable Web Component (`<vessel-player>`) |
