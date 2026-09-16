# Embeddable Player Design Specification (`@vessel-dsp/player`)

## 1. Overview & Vision

`@vessel-dsp/player` is an embeddable Web Component (`<vessel-player>`) providing a **CodePen-style dual-mode interactive experience** for VesselDSP audio circuits and guitar signal chains.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        <vessel-player> Modes                           │
├───────────────────────────────────┬────────────────────────────────────┤
│       1. Compact / Embed Mode     │       2. Studio Grid Mode          │
│       (Small Embed / Card)        │       (Full Screen / Expanded)     │
├───────────────────────────────────┼────────────────────────────────────┤
│  • Focused Playing Panel          │  • Multi-Pane Studio Grid:         │
│  • Real-time Spectrum & dB Meter  │    ├── Pane 1: Live .vdsp Editor   │
│  • Audio Transport (Sample / Mic) │    ├── Pane 2: Signal Chain Config │
│  • Quick Pickup & Tone Controls   │    └── Pane 3: Interactive Panel & │
│  • Expand to Studio button [ ↗ ]  │                Real-time Visualizer│
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## 2. Layout Modes

### A. Compact / Embed Mode (Default for small embeds)
Optimized for blogs, product documentation (Astro / Starlight), store pages, and mobile viewports (< 768px or container width < 600px).
* **Faceplate & Controls**: Interactive pedal/circuit control surface (knobs, toggle switches, bypass footswitch).
* **Real-time Spectrum & VU Meter**: High-frame-rate canvas visualizer rendering live FFT frequency curve and peak/RMS dB levels.
* **Transport Bar**: Play/Stop, sample DI audio loop selector, live guitar input toggle, master volume, and mute.
* **Header Bar**: Circuit name, status indicator (Ready / Playing / Compiling), and an **Expand to Studio [ ↗ ]** toggle button.

### B. Studio Grid Mode (Expanded / Fullscreen)
Inspired by CodePen and modern DSP IDEs, providing a 3-pane responsive grid:

```text
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  VESSEL DSP STUDIO                                              [ ● PLAYING ] [ ✕ ]   │
├──────────────────────────┬─────────────────────────────┬───────────────────────────────┤
│  PANE 1: SOURCE (.vdsp)  │  PANE 2: SIGNAL CHAIN       │  PANE 3: PANEL & ANALYZER     │
├──────────────────────────┼─────────────────────────────┼───────────────────────────────┤
│ schema: circuit/v3       │ [1] GUITAR & INPUT CABLE    │ ┌───────────────────────────┐ │
│ components:              │   Pickup: [ Single-Coil ▼ ] │ │   REAL-TIME FFT SPECTRUM  │ │
│   - id: R_GAIN           │   Load:   [ 1 MΩ        ▼ ] │ │   & PEAK / RMS DB METER   │ │
│     kind: potentiometer  │   Cable:  [ 3 m (10 ft) ▼ ] │ └───────────────────────────┘ │
│     properties:          │   Trim:   [ 0.0 dB    ──● ] │                               │
│       Resistance: 100k   │                             │ ┌───────────────────────────┐ │
│       Taper: Audio       │ [2] CIRCUIT RUNTIME         │ │  INTERACTIVE PEDAL PANEL  │ │
│                          │   Bypass: [ OFF ] Mix: 100% │ │  ( ) GAIN   ( ) TONE      │ │
│                          │   Patch:  [ 15 cm       ▼ ] │ │         [ BYPASS ]        │ │
│                          │                             │ └───────────────────────────┘ │
│                          │ [3] AMP CABLE & NAM (v0.1)  │                               │
│                          │   Cable:  [ 3 m (10 ft) ▼ ] │ [4] MASTER OUTPUT             │
│                          │   Model:  [ JCM800 Lead ▼ ] │   Volume: [ 0.0 dB  ──●─── ]  │
│                          │   Gain:   [ ──●─────────  ] │   Limiter: [ ACTIVE ]         │
│                          │                             │                               │
│                          │ [4] CABINET IR (v0.1)       │                               │
│                          │   Cab:    [ 4x12 V30    ▼ ] │                               │
├──────────────────────────┴─────────────────────────────┴───────────────────────────────┤
│  Audio Source: (•) DI Sample Loop [ Funk Riff ▼ ]  ( ) Live Guitar Input               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Key Capabilities in Studio Mode:
1. **Live `.vdsp` Hot-Reloading**:
   - Built-in editor with YAML syntax highlighting.
   - On edit, compiles via `@vessel-dsp/compiler` on the fly.
   - Diagnostic errors/warnings are displayed inline.
   - Hot-swaps the runtime program in `@vessel-dsp/chain` without stopping audio!
2. **Signal Chain Rack & Cable Customization**:
   - Adjust input pickup resonance (Single Coil, Humbucker, Active, Piezo) and load impedance.
   - **Configurable Interconnect Cables**:
     - **Guitar to First Pedal / Buffer**: Default `3 m` (presets: `15 cm`, `30 cm`, `1 m`, `3 m`, `6 m`, `10 m`, or custom slider).
     - **Pedal to Pedal (Patch Cable)**: Default `15 cm` (presets: `15 cm`, `30 cm`, `50 cm`, `1 m`).
     - **Last Pedal to Amp**: Default `3 m` (presets: `1 m`, `3 m`, `6 m`, `10 m`).
     - **Capacitance Modeling**: Default $100\text{ pF/m}$ ($60\text{--}150\text{ pF/m}$ adjustable). Simulates physical $LC$ resonant shift and high-frequency roll-off.
     - **Buffer Isolation**: Toggling an active buffer or buffered pedal drives downstream cables at low impedance ($\approx 100\,\Omega$), isolating cable capacitance from the guitar pickup.
   - Enable/disable pedal slots, NAM amp models, and Cabinet IR convolution.
   - Save / load custom presets as JSON.
3. **Real-time Diagnostics & Metering**:
   - Displays real-time FFT spectrum, DC operating points, and audio clipping warnings.

---

## 3. Web Component `<vessel-player>` Contract

### HTML Declaration
```html
<!-- Standalone Script Import -->
<script type="module" src="https://unpkg.com/@vessel-dsp/player/dist/index.js"></script>

<!-- Compact Embed -->
<vessel-player
  src="/circuits/tube-screamer.vdsp"
  sample="/audio/clean-guitar.mp3"
  pickup="single-coil"
  guitar-cable="3m"
  amp-cable="3m"
  theme="dark"
  mode="compact"
></vessel-player>

<!-- Studio Grid Mode -->
<vessel-player
  src="/circuits/fuzz-face.vdsp"
  mode="studio"
  theme="light"
></vessel-player>
```

### Observed Attributes & Props
| Attribute | Values | Description |
| :--- | :--- | :--- |
| `src` | URL or inline string | `.vdsp` circuit source file or JSON preset |
| `sample` | URL | Default dry DI audio sample loop |
| `mode` | `compact` \| `studio` \| `auto` | Visual layout mode (auto uses container queries) |
| `theme` | `dark` \| `light` | Visual theme (follows VesselDSP brutalist style) |
| `pickup` | `single-coil` \| `humbucker` \| `active` \| `piezo` | Default guitar pickup profile |
| `guitar-cable` | `15cm` \| `30cm` \| `1m` \| `3m` \| `6m` \| `10m` \| number (meters) | Guitar to first pedal cable length (default: `3m`) |
| `patch-cable` | `15cm` \| `30cm` \| `50cm` \| `1m` \| number (meters) | Inter-pedal patch cable length (default: `15cm`) |
| `amp-cable` | `1m` \| `3m` \| `6m` \| `10m` \| number (meters) | Last pedal to amp cable length (default: `3m`) |
| `cable-capacitance` | number (pF/m) | Cable capacitance per meter (default: `100`) |
| `nam` | URL / model ID | Initial NAM amp model profile |
| `ir` | URL / IR name | Initial cabinet impulse response file |
| `editable` | boolean (`true` / `false`) | Allow/disallow `.vdsp` editing in Studio mode |

### Programmatic DOM API
```ts
const player = document.querySelector("vessel-player");

// Loading content
await player.loadSource(vdspString);
await player.loadSample(audioUrl);
player.loadPreset(presetJson);

// Playback control
await player.play();
await player.stop();
player.setSource("mic"); // Switch to live guitar input

// Parameter & Signal Chain manipulation
player.setParameter("GAIN", 0.75);
player.setPickup("humbucker");
player.setGuitarCable("6m");    // 15cm, 30cm, 1m, 3m, 6m, 10m, or meters as number
player.setPatchCable("15cm");   // Inter-pedal patch cable
player.setAmpCable("3m");       // Last pedal to amp cable
player.setMode("studio");       // Expand to full grid

// Events
player.addEventListener("statechange", (e) => console.log(e.detail));
player.addEventListener("compile", (e) => console.log(e.detail.status));
player.addEventListener("clip", () => console.warn("Audio clipping detected!"));
```

---

## 4. Visual Styling & Theme Alignment
`<vessel-player>` follows the VesselDSP brand design system defined in `website/packages/ui-theme/src/theme.css`:
- **Typography**: `Space Mono` for monospace numbers, labels, and code editor; `Space Grotesk` for titles and section headers; uppercase text transform (`text-transform: uppercase;`).
- **Color Tokens**:
  - Brand Accent: `#FF513A` (VesselDSP Orange)
  - Dark Tone: `#1d1d1d` (never pure `#000000`)
  - Border/Muted: `#b9b9b9` (light) / `#333333` (dark)
  - Base Background: `#ffffff` (light mode) / `#1d1d1d` (dark mode)
- **Brutalist Flat Aesthetic**:
  - Sharp corners (`border-radius: 0;`)
  - Hard drop-shadow press effect (`box-shadow: 4px 4px 0 0 var(--player-shadow);`)
  - Hairline range sliders with square thumbs.
