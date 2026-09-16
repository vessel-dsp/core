import {
	CabinetIrNode,
	NamNode,
	type PickupType,
	RuntimeNode,
} from "@vessel-dsp/chain";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import { AudioEngine } from "./audio-engine.js";
import { SpectrumVisualizer } from "./visualizer.js";

export type PlayerMode = "compact" | "studio" | "auto";

const DEFAULT_VDSP_SOURCE = `schema: circuit-interchange/v3
metadata:
  name: "Tube Overdrive"
  description: "Asymmetric soft-clipping overdrive stage."
components:
  - id: JIN
    kind: jack
    name: INPUT
    origin:
      x: -150
      y: 0
    terminals:
      - name: tip
        node: 1
  - id: JOUT
    kind: jack
    name: OUTPUT
    origin:
      x: 150
      y: 0
    terminals:
      - name: tip
        node: 2
  - id: GND
    kind: ground
    name: GND
    origin:
      x: 0
      y: -100
    terminals:
      - name: gnd
        node: 0
  - id: R_DRIVE
    kind: resistor
    name: R1
    origin:
      x: -50
      y: 0
    terminals:
      - name: a
        node: 1
      - name: b
        node: 2
    properties:
      Resistance: "4.7k"
  - id: D1
    kind: diode
    name: D1
    origin:
      x: 50
      y: -50
    terminals:
      - name: anode
        node: 2
      - name: cathode
        node: 0
    properties:
      Model: "1N4148"
`;

const STYLES = `
:host {
  display: block;
  font-family: "Space Mono", ui-monospace, monospace;
  box-sizing: border-box;
  text-transform: uppercase;
  width: 100%;
  max-width: 640px;
  border: 1px solid var(--player-border, #1d1d1d);
  background: var(--player-bg, #ffffff);
  color: var(--player-fg, #1d1d1d);
  padding: 16px;
  box-shadow: 4px 4px 0 0 var(--player-shadow, #1d1d1d);
  transition: max-width 0.2s ease;
}

:host([mode="studio"]) {
  max-width: 1100px;
}

:host([theme="dark"]) {
  --player-bg: #1d1d1d;
  --player-fg: #ffffff;
  --player-border: #ffffff;
  --player-shadow: #ffffff;
  --player-panel-bg: #1d1d1d;
  --player-panel-border: #b9b9b9;
  --player-code-bg: #0d0d0d;
}

:host([theme="light"]), :host(:not([theme="dark"])) {
  --player-bg: #ffffff;
  --player-fg: #1d1d1d;
  --player-border: #1d1d1d;
  --player-shadow: #1d1d1d;
  --player-panel-bg: #ffffff;
  --player-panel-border: #1d1d1d;
  --player-code-bg: #f5f5f5;
}

*, *::before, *::after {
  box-sizing: border-box;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--player-panel-border);
  padding-bottom: 10px;
}

.title {
  font-family: "Space Grotesk", ui-sans-serif, sans-serif;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: -0.01em;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--player-fg);
}

.brand-dot {
  width: 10px;
  height: 10px;
  background-color: #FF513A;
  display: inline-block;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  font-size: 0.7rem;
  padding: 3px 6px;
  border: 1px solid var(--player-panel-border);
  font-weight: 700;
  letter-spacing: 0.05em;
}

.badge.playing {
  background-color: #FF513A;
  color: #1d1d1d;
  border-color: #FF513A;
}

/* Studio Grid Layout */
.studio-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

:host([mode="studio"]) .studio-grid {
  grid-template-columns: 1.2fr 1fr 1fr;
}

@media (max-width: 850px) {
  :host([mode="studio"]) .studio-grid {
    grid-template-columns: 1fr;
  }
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section {
  border: 1px solid var(--player-panel-border);
  background: var(--player-panel-bg);
  padding: 12px;
}

.section-title {
  font-family: "Space Grotesk", ui-sans-serif, sans-serif;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--player-fg);
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 110px;
}

label {
  font-size: 0.68rem;
  color: var(--player-fg);
  font-weight: 700;
}

select, input[type="range"], button, textarea {
  font-family: "Space Mono", ui-monospace, monospace;
  text-transform: uppercase;
  border-radius: 0;
  border: 1px solid var(--player-panel-border);
  background-color: var(--player-bg);
  color: var(--player-fg);
  padding: 6px 10px;
  font-size: 0.75rem;
  outline: none;
}

textarea {
  text-transform: none;
  font-size: 0.72rem;
  line-height: 1.4;
  resize: vertical;
  min-height: 220px;
  background-color: var(--player-code-bg);
  width: 100%;
}

button {
  cursor: pointer;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-shadow: 0 0 0 0 var(--player-shadow);
  transition: box-shadow 0.15s ease-out, background-color 0.15s ease-out;
}

button:hover {
  box-shadow: 3px 3px 0 0 var(--player-shadow);
}

button.primary {
  background-color: var(--player-fg);
  color: var(--player-bg);
  border-color: var(--player-fg);
}

button.active {
  background-color: #FF513A;
  color: #1d1d1d;
  border-color: #FF513A;
  font-weight: 700;
}

button.active:hover {
  box-shadow: 3px 3px 0 0 #FF513A;
}

.canvas-container {
  width: 100%;
  height: 110px;
  border: 1px solid var(--player-panel-border);
  overflow: hidden;
  background: #1d1d1d;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.value-display {
  font-size: 0.68rem;
  color: #FF513A;
  font-weight: 700;
}

.compiler-status {
  font-size: 0.68rem;
  font-weight: 700;
  margin-top: 4px;
}

.compiler-status.ok {
  color: #16a34a;
}

.compiler-status.error {
  color: #FF513A;
}

/* Hairline range slider */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 1rem;
  background: transparent;
  cursor: pointer;
  padding: 0;
  border: none;
}

input[type="range"]::-webkit-slider-runnable-track {
  height: 2px;
  border-radius: 0;
  background: var(--player-fg);
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 0;
  background: #FF513A;
  border: 1px solid var(--player-fg);
  margin-top: calc((2px - 0.85rem) / 2);
}

input[type="range"]::-moz-range-track {
  height: 2px;
  background: var(--player-fg);
}

input[type="range"]::-moz-range-thumb {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 0;
  background: #FF513A;
  border: 1px solid var(--player-fg);
}
`;

const HTMLElementBase: { new (): HTMLElement; prototype: HTMLElement } =
	typeof HTMLElement !== "undefined"
		? HTMLElement
		: (class {} as unknown as { new (): HTMLElement; prototype: HTMLElement });

export class VesselPlayerElement extends HTMLElementBase {
	private engine: AudioEngine;
	private visualizer: SpectrumVisualizer | null = null;
	private animFrameId: number | null = null;
	private namNode: NamNode;
	private irNode: CabinetIrNode;
	private runtimeNode: RuntimeNode | null = null;
	private currentVdspSource = DEFAULT_VDSP_SOURCE;
	private currentMode: PlayerMode = "compact";

	constructor() {
		super();
		if (typeof this.attachShadow === "function") {
			this.attachShadow({ mode: "open" });
		}
		this.engine = new AudioEngine();

		this.namNode = new NamNode("nam-amp", "NAM Tube Amp");
		this.irNode = new CabinetIrNode("cab-ir", "Cabinet IR");

		this.compileAndLoadSource(this.currentVdspSource);

		this.engine.chain.addNode(this.namNode);
		this.engine.chain.addNode(this.irNode);
	}

	static get observedAttributes(): string[] {
		return ["src", "sample", "pickup", "theme", "mode"];
	}

	attributeChangedCallback(name: string, _oldValue: string, newValue: string): void {
		if (name === "pickup") {
			this.engine.chain.inputProfile.setPickupType(newValue as PickupType);
		} else if (name === "sample" && newValue) {
			this.engine.loadSample(newValue).catch(console.error);
		} else if (name === "theme") {
			this.updateThemeVisualizer();
		} else if (name === "mode") {
			this.currentMode = newValue as PlayerMode;
			this.render();
			this.setupEventListeners();
			this.initVisualizer();
		}
	}

	connectedCallback(): void {
		if (this.hasAttribute("mode")) {
			this.currentMode = this.getAttribute("mode") as PlayerMode;
		}
		this.render();
		this.setupEventListeners();
		this.initVisualizer();
	}

	disconnectedCallback(): void {
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
		this.engine.stop().catch(console.error);
	}

	setMode(mode: PlayerMode): void {
		this.currentMode = mode;
		this.setAttribute("mode", mode);
		this.render();
		this.setupEventListeners();
		this.initVisualizer();
	}

	compileAndLoadSource(source: string): { status: string; message?: string } {
		this.currentVdspSource = source;
		try {
			const res = compile(source, { registry: emptyRegistry });
			if (res.status === "ok") {
				if (!this.runtimeNode) {
					this.runtimeNode = new RuntimeNode("pedal-circuit", "Circuit", res.program);
					this.engine.chain.addNode(this.runtimeNode);
				} else {
					// Hot-swap existing node
					this.runtimeNode = new RuntimeNode("pedal-circuit", "Circuit", res.program);
					this.engine.chain.addNode(this.runtimeNode);
				}
				return { status: "ok" };
			} else {
				return { status: "error", message: res.reasons?.map((r) => r.reason).join("; ") ?? "Compilation failed" };
			}
		} catch (err) {
			return { status: "error", message: String(err) };
		}
	}

	private updateThemeVisualizer(): void {
		if (!this.visualizer) return;
		const isDark = this.getAttribute("theme") === "dark";
		this.visualizer.setColors({
			backgroundColor: "#1d1d1d",
			primaryColor: "#FF513A",
			accentColor: "#FF513A",
			gridColor: isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(185, 185, 185, 0.3)",
			textColor: isDark ? "#ffffff" : "#b9b9b9",
		});
	}

	private render(): void {
		if (!this.shadowRoot) return;

		const isStudio = this.currentMode === "studio";
		const profile = this.engine.chain.inputProfile.getConfig();
		const master = this.engine.chain.master.getConfig();

		this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="header">
        <div class="title">
          <span class="brand-dot"></span>
          VESSEL DSP ${isStudio ? "STUDIO" : "PLAYER"}
        </div>
        <div class="header-actions">
          <span class="badge ${this.engine.playing ? "playing" : ""}" id="status-badge">
            ${this.engine.playing ? "PLAYING" : "READY"}
          </span>
          <button id="btn-mode-toggle" class="badge">
            ${isStudio ? "✕ COMPACT" : "↗ STUDIO"}
          </button>
        </div>
      </div>

      <div class="studio-grid">
        ${isStudio ? `
          <!-- Pane 1: Live .vdsp Source Editor -->
          <div class="pane">
            <div class="section">
              <div class="section-title">
                <span>1. SOURCE (.VDSP)</span>
                <button id="btn-compile" class="primary" style="padding: 2px 6px; font-size: 0.65rem;">COMPILE</button>
              </div>
              <textarea id="vdsp-editor" spellcheck="false">${this.currentVdspSource}</textarea>
              <div id="compiler-msg" class="compiler-status ok">✓ COMPILED CLEANLY</div>
            </div>
          </div>
        ` : ""}

        <!-- Signal Chain Configuration Pane -->
        <div class="pane">
          <!-- Guitar Input Profile -->
          <div class="section">
            <div class="section-title">${isStudio ? "2. GUITAR INPUT PROFILE" : "1. GUITAR INPUT PROFILE"}</div>
            <div class="row">
              <div class="control-group">
                <label>PICKUP</label>
                <select id="pickup-select">
                  <option value="single-coil" ${profile.pickupType === "single-coil" ? "selected" : ""}>SINGLE COIL</option>
                  <option value="humbucker" ${profile.pickupType === "humbucker" ? "selected" : ""}>HUMBUCKER</option>
                  <option value="active" ${profile.pickupType === "active" ? "selected" : ""}>ACTIVE</option>
                  <option value="piezo" ${profile.pickupType === "piezo" ? "selected" : ""}>ACOUSTIC PIEZO</option>
                </select>
              </div>
              <div class="control-group">
                <label>IMPEDANCE: <span class="value-display" id="imp-val">${profile.impedanceOhms / 1000}KΩ</span></label>
                <input type="range" id="imp-slider" min="100000" max="1000000" step="50000" value="${profile.impedanceOhms}">
              </div>
              <div class="control-group">
                <label>INPUT TRIM: <span class="value-display" id="gain-val">${profile.inputGainDb} DB</span></label>
                <input type="range" id="gain-slider" min="-24" max="24" step="1" value="${profile.inputGainDb}">
              </div>
            </div>
          </div>

          <!-- Amp & Cab Processing -->
          <div class="section">
            <div class="section-title">${isStudio ? "3. AMP & CAB STAGES" : "2. AMP & CAB STAGES"}</div>
            <div class="row">
              <button id="btn-pedal" class="${this.runtimeNode?.bypassed ? "" : "active"}">
                PEDAL: ${this.runtimeNode?.bypassed ? "OFF" : "ON"}
              </button>
              <button id="btn-nam" class="${this.namNode.bypassed ? "" : "active"}">
                NAM AMP: ${this.namNode.bypassed ? "OFF" : "ON"}
              </button>
              <button id="btn-ir" class="${this.irNode.bypassed ? "" : "active"}">
                CAB IR: ${this.irNode.bypassed ? "OFF" : "ON"}
              </button>
            </div>
          </div>
        </div>

        <!-- Analyzer & Transport Pane -->
        <div class="pane">
          <!-- Real-time Spectrum Visualizer -->
          <div class="canvas-container">
            <canvas id="spectrum-canvas" width="600" height="110"></canvas>
          </div>

          <!-- Transport Controls -->
          <div class="section">
            <div class="row">
              <button id="btn-play" class="primary">
                <span id="play-icon">${this.engine.playing ? "⏹" : "▶"}</span>
                <span id="play-text">${this.engine.playing ? "STOP" : "PLAY"}</span>
              </button>
              <div class="control-group">
                <label>AUDIO SOURCE</label>
                <select id="source-select">
                  <option value="sample" ${this.engine.source === "sample" ? "selected" : ""}>DI SAMPLE LOOP</option>
                  <option value="mic" ${this.engine.source === "mic" ? "selected" : ""}>LIVE GUITAR / MIC</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Master Output -->
          <div class="section">
            <div class="section-title">${isStudio ? "4. MASTER OUTPUT" : "3. MASTER OUTPUT"}</div>
            <div class="row">
              <div class="control-group">
                <label>VOLUME: <span class="value-display" id="vol-val">${master.volumeDb} DB</span></label>
                <input type="range" id="vol-slider" min="-60" max="12" step="1" value="${master.volumeDb}">
              </div>
              <button id="btn-mute">
                ${master.muted ? "UNMUTE" : "MUTE"}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
	}

	private initVisualizer(): void {
		if (!this.shadowRoot) return;
		const canvas = this.shadowRoot.querySelector("#spectrum-canvas") as HTMLCanvasElement;
		if (canvas) {
			this.visualizer = new SpectrumVisualizer(canvas);
			this.updateThemeVisualizer();
			if (!this.animFrameId) {
				this.startVisualizerLoop();
			}
		}
	}

	private startVisualizerLoop(): void {
		const loop = () => {
			if (this.visualizer) {
				const meter = this.engine.getMeterData();
				this.visualizer.render(meter);
			}
			this.animFrameId = requestAnimationFrame(loop);
		};
		this.animFrameId = requestAnimationFrame(loop);
	}

	private setupEventListeners(): void {
		if (!this.shadowRoot) return;

		const btnModeToggle = this.shadowRoot.querySelector("#btn-mode-toggle") as HTMLButtonElement;
		btnModeToggle?.addEventListener("click", () => {
			this.setMode(this.currentMode === "studio" ? "compact" : "studio");
		});

		const btnCompile = this.shadowRoot.querySelector("#btn-compile") as HTMLButtonElement;
		const vdspEditor = this.shadowRoot.querySelector("#vdsp-editor") as HTMLTextAreaElement;
		const compilerMsg = this.shadowRoot.querySelector("#compiler-msg") as HTMLElement;

		btnCompile?.addEventListener("click", () => {
			if (vdspEditor) {
				const res = this.compileAndLoadSource(vdspEditor.value);
				if (res.status === "ok") {
					compilerMsg.className = "compiler-status ok";
					compilerMsg.textContent = "✓ COMPILED & HOT-RELOADED";
				} else {
					compilerMsg.className = "compiler-status error";
					compilerMsg.textContent = `✗ ${res.message}`;
				}
			}
		});

		const btnPlay = this.shadowRoot.querySelector("#btn-play") as HTMLButtonElement;
		const playIcon = this.shadowRoot.querySelector("#play-icon") as HTMLElement;
		const playText = this.shadowRoot.querySelector("#play-text") as HTMLElement;
		const statusBadge = this.shadowRoot.querySelector("#status-badge") as HTMLElement;

		btnPlay?.addEventListener("click", async () => {
			if (this.engine.playing) {
				await this.engine.stop();
				playIcon.textContent = "▶";
				playText.textContent = "PLAY";
				statusBadge.textContent = "READY";
				statusBadge.classList.remove("playing");
			} else {
				await this.engine.play();
				playIcon.textContent = "⏹";
				playText.textContent = "STOP";
				statusBadge.textContent = "PLAYING";
				statusBadge.classList.add("playing");
			}
		});

		const sourceSelect = this.shadowRoot.querySelector("#source-select") as HTMLSelectElement;
		sourceSelect?.addEventListener("change", async (e) => {
			const type = (e.target as HTMLSelectElement).value as "sample" | "mic";
			await this.engine.setSource(type);
		});

		const pickupSelect = this.shadowRoot.querySelector("#pickup-select") as HTMLSelectElement;
		pickupSelect?.addEventListener("change", (e) => {
			const type = (e.target as HTMLSelectElement).value as PickupType;
			this.engine.chain.inputProfile.setPickupType(type);
		});

		const impSlider = this.shadowRoot.querySelector("#imp-slider") as HTMLInputElement;
		const impVal = this.shadowRoot.querySelector("#imp-val") as HTMLElement;
		impSlider?.addEventListener("input", (e) => {
			const val = Number((e.target as HTMLInputElement).value);
			this.engine.chain.inputProfile.setImpedance(val);
			impVal.textContent = `${val / 1000}KΩ`;
		});

		const gainSlider = this.shadowRoot.querySelector("#gain-slider") as HTMLInputElement;
		const gainVal = this.shadowRoot.querySelector("#gain-val") as HTMLElement;
		gainSlider?.addEventListener("input", (e) => {
			const val = Number((e.target as HTMLInputElement).value);
			this.engine.chain.inputProfile.setInputGainDb(val);
			gainVal.textContent = `${val} DB`;
		});

		const btnPedal = this.shadowRoot.querySelector("#btn-pedal") as HTMLButtonElement;
		btnPedal?.addEventListener("click", () => {
			if (this.runtimeNode) {
				this.runtimeNode.bypassed = !this.runtimeNode.bypassed;
				btnPedal.classList.toggle("active", !this.runtimeNode.bypassed);
				btnPedal.textContent = `PEDAL: ${this.runtimeNode.bypassed ? "OFF" : "ON"}`;
			}
		});

		const btnNam = this.shadowRoot.querySelector("#btn-nam") as HTMLButtonElement;
		btnNam?.addEventListener("click", () => {
			this.namNode.bypassed = !this.namNode.bypassed;
			btnNam.classList.toggle("active", !this.namNode.bypassed);
			btnNam.textContent = `NAM AMP: ${this.namNode.bypassed ? "OFF" : "ON"}`;
		});

		const btnIr = this.shadowRoot.querySelector("#btn-ir") as HTMLButtonElement;
		btnIr?.addEventListener("click", () => {
			this.irNode.bypassed = !this.irNode.bypassed;
			btnIr.classList.toggle("active", !this.irNode.bypassed);
			btnIr.textContent = `CAB IR: ${this.irNode.bypassed ? "OFF" : "ON"}`;
		});

		const volSlider = this.shadowRoot.querySelector("#vol-slider") as HTMLInputElement;
		const volVal = this.shadowRoot.querySelector("#vol-val") as HTMLElement;
		volSlider?.addEventListener("input", (e) => {
			const val = Number((e.target as HTMLInputElement).value);
			this.engine.chain.master.setVolumeDb(val);
			volVal.textContent = `${val} DB`;
		});

		const btnMute = this.shadowRoot.querySelector("#btn-mute") as HTMLButtonElement;
		btnMute?.addEventListener("click", () => {
			const config = this.engine.chain.master.getConfig();
			const newMute = !config.muted;
			this.engine.chain.master.setMuted(newMute);
			btnMute.textContent = newMute ? "UNMUTE" : "MUTE";
		});
	}
}

export function registerVesselPlayer(): void {
	if (typeof window !== "undefined" && !customElements.get("vessel-player")) {
		customElements.define("vessel-player", VesselPlayerElement);
	}
}

if (typeof window !== "undefined") {
	registerVesselPlayer();
}
