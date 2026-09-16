import {
	CabinetIrNode,
	NamNode,
	type PickupType,
	RuntimeNode,
} from "@vessel-dsp/chain";
import { compile, type Program } from "@vessel-dsp/compiler";
import { AudioEngine } from "./audio-engine.js";
import { SpectrumVisualizer } from "./visualizer.js";

const STYLES = `
:host {
  display: block;
  font-family: "Space Mono", ui-monospace, monospace;
  box-sizing: border-box;
  text-transform: uppercase;
  max-width: 640px;
  border: 1px solid var(--player-border, #1d1d1d);
  background: var(--player-bg, #ffffff);
  color: var(--player-fg, #1d1d1d);
  padding: 20px;
  box-shadow: 4px 4px 0 0 var(--player-shadow, #1d1d1d);
}

:host([theme="dark"]) {
  --player-bg: #1d1d1d;
  --player-fg: #ffffff;
  --player-border: #ffffff;
  --player-shadow: #ffffff;
  --player-panel-bg: #1d1d1d;
  --player-panel-border: #b9b9b9;
}

:host([theme="light"]), :host(:not([theme="dark"])) {
  --player-bg: #ffffff;
  --player-fg: #1d1d1d;
  --player-border: #1d1d1d;
  --player-shadow: #1d1d1d;
  --player-panel-bg: #ffffff;
  --player-panel-border: #1d1d1d;
}

*, *::before, *::after {
  box-sizing: border-box;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--player-panel-border);
  padding-bottom: 12px;
}

.title {
  font-family: "Space Grotesk", ui-sans-serif, sans-serif;
  font-weight: 700;
  font-size: 1.15rem;
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

.badge {
  font-size: 0.75rem;
  padding: 3px 8px;
  border: 1px solid var(--player-panel-border);
  font-weight: 700;
  letter-spacing: 0.05em;
}

.section {
  border: 1px solid var(--player-panel-border);
  background: var(--player-panel-bg);
  padding: 14px;
  margin-bottom: 14px;
}

.section-title {
  font-family: "Space Grotesk", ui-sans-serif, sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--player-fg);
  margin-bottom: 10px;
}

.row {
  display: flex;
  gap: 14px;
  align-items: center;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 130px;
}

label {
  font-size: 0.72rem;
  color: var(--player-fg);
  font-weight: 700;
}

select, input[type="range"], button {
  font-family: "Space Mono", ui-monospace, monospace;
  text-transform: uppercase;
  border-radius: 0;
  border: 1px solid var(--player-panel-border);
  background-color: var(--player-bg);
  color: var(--player-fg);
  padding: 8px 12px;
  font-size: 0.8rem;
  outline: none;
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
  box-shadow: 4px 4px 0 0 var(--player-shadow);
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
  box-shadow: 4px 4px 0 0 #FF513A;
}

.canvas-container {
  width: 100%;
  height: 120px;
  border: 1px solid var(--player-panel-border);
  overflow: hidden;
  background: #1d1d1d;
  margin-bottom: 14px;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.value-display {
  font-size: 0.72rem;
  color: #FF513A;
  font-weight: 700;
}

/* Hairline range slider */
input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 1.25rem;
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
  width: 1rem;
  height: 1rem;
  border-radius: 0;
  background: #FF513A;
  border: 1px solid var(--player-fg);
  margin-top: calc((2px - 1rem) / 2);
}

input[type="range"]::-moz-range-track {
  height: 2px;
  background: var(--player-fg);
}

input[type="range"]::-moz-range-thumb {
  width: 1rem;
  height: 1rem;
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

	constructor() {
		super();
		if (typeof this.attachShadow === "function") {
			this.attachShadow({ mode: "open" });
		}
		this.engine = new AudioEngine();

		this.namNode = new NamNode("nam-amp", "NAM Tube Amp");
		this.irNode = new CabinetIrNode("cab-ir", "Cabinet IR");

		this.engine.chain.addNode(this.namNode);
		this.engine.chain.addNode(this.irNode);
	}

	static get observedAttributes(): string[] {
		return ["src", "sample", "pickup", "theme"];
	}

	attributeChangedCallback(name: string, _oldValue: string, newValue: string): void {
		if (name === "pickup") {
			this.engine.chain.inputProfile.setPickupType(newValue as PickupType);
		} else if (name === "sample" && newValue) {
			this.engine.loadSample(newValue).catch(console.error);
		} else if (name === "theme") {
			this.updateThemeVisualizer();
		}
	}

	connectedCallback(): void {
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

		const profile = this.engine.chain.inputProfile.getConfig();
		const master = this.engine.chain.master.getConfig();

		this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="header">
        <div class="title">
          <span class="brand-dot"></span>
          VESSEL DSP PLAYER
        </div>
        <span class="badge" id="status-badge">READY</span>
      </div>

      <!-- Real-time Spectrum Visualizer -->
      <div class="canvas-container">
        <canvas id="spectrum-canvas" width="600" height="120"></canvas>
      </div>

      <!-- Transport Controls -->
      <div class="section">
        <div class="row">
          <button id="btn-play" class="primary">
            <span id="play-icon">▶</span> <span id="play-text">PLAY</span>
          </button>
          <div class="control-group">
            <label>SOURCE</label>
            <select id="source-select">
              <option value="sample">DI GUITAR SAMPLE</option>
              <option value="mic">LIVE GUITAR / MIC</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Guitar Input Profile -->
      <div class="section">
        <div class="section-title">1. GUITAR INPUT PROFILE</div>
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
        <div class="section-title">2. STAGES (v0.1 NAM & IR)</div>
        <div class="row">
          <button id="btn-nam" class="${this.namNode.bypassed ? "" : "active"}">
            NAM AMP: ${this.namNode.bypassed ? "OFF" : "ON"}
          </button>
          <button id="btn-ir" class="${this.irNode.bypassed ? "" : "active"}">
            CABINET IR: ${this.irNode.bypassed ? "OFF" : "ON"}
          </button>
        </div>
      </div>

      <!-- Master Output -->
      <div class="section">
        <div class="section-title">3. MASTER OUTPUT</div>
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
    `;
	}

	private initVisualizer(): void {
		if (!this.shadowRoot) return;
		const canvas = this.shadowRoot.querySelector("#spectrum-canvas") as HTMLCanvasElement;
		if (canvas) {
			this.visualizer = new SpectrumVisualizer(canvas);
			this.updateThemeVisualizer();
			this.startVisualizerLoop();
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

		const btnPlay = this.shadowRoot.querySelector("#btn-play") as HTMLButtonElement;
		const playIcon = this.shadowRoot.querySelector("#play-icon") as HTMLElement;
		const playText = this.shadowRoot.querySelector("#play-text") as HTMLElement;
		const statusBadge = this.shadowRoot.querySelector("#status-badge") as HTMLElement;

		btnPlay?.addEventListener("click", async () => {
			if (this.engine.playing) {
				await this.engine.stop();
				playIcon.textContent = "▶";
				playText.textContent = "PLAY";
				statusBadge.textContent = "STOPPED";
			} else {
				await this.engine.play();
				playIcon.textContent = "⏹";
				playText.textContent = "STOP";
				statusBadge.textContent = "PLAYING";
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
			btnIr.textContent = `CABINET IR: ${this.irNode.bypassed ? "OFF" : "ON"}`;
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

	loadCircuitProgram(id: string, name: string, program: Program): void {
		const runtimeNode = new RuntimeNode(id, name, program);
		this.engine.chain.addNode(runtimeNode);
	}
}

export function registerVesselPlayer(): void {
	if (typeof window !== "undefined" && !customElements.get("vessel-player")) {
		customElements.define("vessel-player", VesselPlayerElement);
	}
}

// Auto-register in browser environments
if (typeof window !== "undefined") {
	registerVesselPlayer();
}
