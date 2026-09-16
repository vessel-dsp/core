import {
	CabinetIrNode,
	NamNode,
	type PickupType,
	RuntimeNode,
} from "@vessel-dsp/chain";
import { compile, emptyRegistry, type Program } from "@vessel-dsp/compiler";
import { AudioEngine } from "./audio-engine.js";
import type { EntityPayload, EntityType } from "./types.js";
import { SpectrumVisualizer } from "./visualizer.js";

export type PlayerMode = "compact" | "studio" | "auto";
export type PlayerOnlineStatus =
	| "idle"
	| "loading"
	| "ready"
	| "error"
	| "unsupported_type"
	| "missing_id"
	| "missing_type";

const DEFAULT_API_BASE = "https://api.vesseldsp.com";

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
  border-bottom: 2px solid var(--player-border, #1d1d1d);
  padding-bottom: 8px;
  margin-bottom: 12px;
  gap: 8px;
  flex-wrap: wrap;
}

.title-container {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  font-family: "Space Grotesk", sans-serif;
  font-weight: 700;
  font-size: 1.05rem;
  letter-spacing: -0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
}

.entity-meta {
  font-size: 0.72rem;
  color: var(--player-fg);
  opacity: 0.85;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.entity-meta a {
  color: #FF513A;
  text-decoration: none;
  font-weight: 700;
}

.entity-meta a:hover {
  text-decoration: underline;
}

.rev-tag {
  font-size: 0.62rem;
  padding: 1px 4px;
  background: var(--player-fg);
  color: var(--player-bg);
  font-weight: 700;
}

.brand-dot {
  width: 8px;
  height: 8px;
  background-color: #FF513A;
  display: inline-block;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.badge {
  font-size: 0.65rem;
  padding: 3px 6px;
  border: 1px solid var(--player-border, #1d1d1d);
  background: transparent;
  color: var(--player-fg);
  font-weight: 700;
  border-radius: 0;
}

.badge.playing {
  background: #FF513A;
  color: #ffffff;
  border-color: #FF513A;
}

.badge.error {
  background: #1d1d1d;
  color: #FF513A;
  border-color: #FF513A;
}

.badge.loading {
  background: #b9b9b9;
  color: #1d1d1d;
}

button {
  font-family: inherit;
  text-transform: uppercase;
  font-size: 0.75rem;
  font-weight: 700;
  padding: 6px 12px;
  background: var(--player-bg);
  color: var(--player-fg);
  border: 1px solid var(--player-border, #1d1d1d);
  border-radius: 0;
  cursor: pointer;
  box-shadow: 2px 2px 0 0 var(--player-shadow, #1d1d1d);
  transition: transform 0.05s ease, box-shadow 0.05s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

button:hover {
  transform: translate(-1px, -1px);
  box-shadow: 3px 3px 0 0 var(--player-shadow, #1d1d1d);
}

button:active {
  transform: translate(2px, 2px);
  box-shadow: 0 0 0 0 var(--player-shadow, #1d1d1d);
}

button.primary {
  background: #FF513A;
  color: #ffffff;
  border-color: #FF513A;
}

button.active {
  background: #FF513A;
  color: #ffffff;
}

.error-banner {
  background: #1d1d1d;
  color: #ffffff;
  border: 2px solid #FF513A;
  padding: 12px;
  margin-bottom: 12px;
  font-size: 0.75rem;
  line-height: 1.4;
  box-shadow: 3px 3px 0 0 #FF513A;
}

.error-title {
  color: #FF513A;
  font-weight: 700;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.studio-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

:host([mode="studio"]) .studio-grid {
  grid-template-columns: 1fr 1fr;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section {
  border: 1px solid var(--player-border, #1d1d1d);
  padding: 10px;
  background: var(--player-panel-bg);
}

.section-title {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--player-fg);
  margin-bottom: 8px;
  border-bottom: 1px solid var(--player-border, #1d1d1d);
  padding-bottom: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.canvas-container {
  width: 100%;
  height: 110px;
  background: #1d1d1d;
  border: 1px solid var(--player-border, #1d1d1d);
  position: relative;
  overflow: hidden;
}

canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 100px;
}

label {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--player-fg);
  display: flex;
  justify-content: space-between;
}

.value-display {
  color: #FF513A;
}

select {
  font-family: inherit;
  font-size: 0.7rem;
  text-transform: uppercase;
  padding: 4px 6px;
  background: var(--player-bg);
  color: var(--player-fg);
  border: 1px solid var(--player-border, #1d1d1d);
  border-radius: 0;
  outline: none;
}

textarea {
  width: 100%;
  height: 240px;
  font-family: "Space Mono", ui-monospace, monospace;
  font-size: 0.7rem;
  background: var(--player-code-bg);
  color: var(--player-fg);
  border: 1px solid var(--player-border, #1d1d1d);
  padding: 8px;
  border-radius: 0;
  resize: vertical;
  outline: none;
  white-space: pre;
  tab-size: 2;
}

.compiler-status {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 4px 6px;
  margin-top: 4px;
  border: 1px solid var(--player-border, #1d1d1d);
}

.compiler-status.ok {
  background: #1d1d1d;
  color: #4ade80;
  border-color: #4ade80;
}

.compiler-status.error {
  background: #1d1d1d;
  color: #FF513A;
  border-color: #FF513A;
}

input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  background: var(--player-border, #1d1d1d);
  border-radius: 0;
  outline: none;
  margin: 6px 0;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 0;
  background: #FF513A;
  border: 1px solid var(--player-fg);
  cursor: pointer;
}

input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 0;
  background: #FF513A;
  border: 1px solid var(--player-fg);
  cursor: pointer;
}
`;

const HTMLElementBase: { new (): HTMLElement; prototype: HTMLElement } =
	typeof HTMLElement !== "undefined"
		? HTMLElement
		: (class {} as unknown as { new (): HTMLElement; prototype: HTMLElement });

export function parseEntityUrl(
	urlStr: string,
): { username?: string; type?: string; id?: string; rev?: string } | null {
	try {
		const parsed = new URL(urlStr, "https://vesseldsp.com");
		const rev = parsed.searchParams.get("rev") || undefined;
		const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
		if (parts.length >= 3) {
			const [username, type, id] = parts;
			return { username, type, id, rev };
		}
		if (parts.length === 2 && (parts[0] === "pedal" || parts[0] === "amp" || parts[0] === "board")) {
			return { type: parts[0], id: parts[1], rev };
		}
		return null;
	} catch {
		return null;
	}
}

export class VesselPlayerElement extends HTMLElementBase {
	private engine: AudioEngine;
	private visualizer: SpectrumVisualizer | null = null;
	private animFrameId: number | null = null;
	private namNode: NamNode;
	private irNode: CabinetIrNode;
	private runtimeNode: RuntimeNode | null = null;
	private currentVdspSource = "";
	private currentMode: PlayerMode = "compact";
	private onlineStatus: PlayerOnlineStatus = "idle";
	private errorMessage = "";
	private currentEntity: EntityPayload | null = null;
	private lastEtag: string | null = null;

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
		return [
			"src",
			"type",
			"id",
			"entity-id",
			"pedal-id",
			"username",
			"rev",
			"revision",
			"api-base",
			"sample",
			"pickup",
			"theme",
			"mode",
		];
	}

	attributeChangedCallback(
		name: string,
		_oldValue: string,
		newValue: string,
	): void {
		if (name === "pickup") {
			this.engine.chain.inputProfile.setPickupType(newValue as PickupType);
		} else if (name === "sample" && newValue) {
			this.engine.loadSample(newValue).catch(console.error);
		} else if (name === "theme") {
			this.updateThemeVisualizer();
		} else if (name === "mode") {
			this.currentMode = (newValue as PlayerMode) || "compact";
			this.render();
			this.setupEventListeners();
			this.initVisualizer();
		} else if (
			name === "type" ||
			name === "id" ||
			name === "entity-id" ||
			name === "pedal-id" ||
			name === "src" ||
			name === "username" ||
			name === "rev" ||
			name === "revision" ||
			name === "api-base"
		) {
			this.resolveAndFetchOnlineEntity().catch(console.error);
		}
	}

	connectedCallback(): void {
		if (this.hasAttribute("mode")) {
			this.currentMode = (this.getAttribute("mode") as PlayerMode) || "compact";
		}
		this.render();
		this.setupEventListeners();
		this.initVisualizer();

		this.resolveAndFetchOnlineEntity().catch(console.error);
	}

	disconnectedCallback(): void {
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
		this.engine.stop().catch(console.error);
	}

	get entity(): EntityPayload | null {
		return this.currentEntity;
	}

	get status(): PlayerOnlineStatus {
		return this.onlineStatus;
	}

	get vdspSource(): string {
		return this.currentVdspSource;
	}

	get audio(): AudioEngine {
		return this.engine;
	}

	setMode(mode: PlayerMode): void {
		this.currentMode = mode;
		this.setAttribute("mode", mode);
		this.render();
		this.setupEventListeners();
		this.initVisualizer();
	}

	async resolveAndFetchOnlineEntity(): Promise<void> {
		let entityType = this.getAttribute("type") as EntityType | null;
		let entityId =
			this.getAttribute("id") ||
			this.getAttribute("entity-id") ||
			this.getAttribute("pedal-id");
		let username = this.getAttribute("username") || "";
		let rev = this.getAttribute("rev") || this.getAttribute("revision") || "";
		const src = this.getAttribute("src");
		const apiBase = this.getAttribute("api-base") || DEFAULT_API_BASE;

		// Parse URL from src if provided (e.g. https://vesseldsp.com/joseph/pedal/123?rev=abc)
		if (src) {
			const parsed = parseEntityUrl(src);
			if (parsed) {
				if (parsed.type) entityType = parsed.type as EntityType;
				if (parsed.id) entityId = parsed.id;
				if (parsed.username) username = parsed.username;
				if (parsed.rev) rev = parsed.rev;
			}
		}

		// Validation rules for Online Mode in v0.1:
		// 1. Must provide type
		if (!entityType) {
			this.onlineStatus = "missing_type";
			this.errorMessage =
				"Online Mode requires type=\"pedal\" attribute (e.g. <vessel-player type=\"pedal\" id=\"...\">).";
			this.render();
			return;
		}

		// 2. Only 'pedal' is supported in v0.1
		if (entityType !== "pedal") {
			this.onlineStatus = "unsupported_type";
			this.errorMessage = `Entity type '${entityType}' is not supported yet in v0.1. Only type="pedal" is supported.`;
			this.render();
			return;
		}

		// 3. Must provide ID
		if (!entityId) {
			this.onlineStatus = "missing_id";
			this.errorMessage =
				"Online Mode requires an entity 'id' attribute (e.g. id=\"tube-overdrive\").";
			this.render();
			return;
		}

		// Valid pedal entity request: fetch from API
		this.onlineStatus = "loading";
		this.errorMessage = "";
		this.render();

		try {
			const queryParams = rev ? `?rev=${encodeURIComponent(rev)}` : "";
			const endpoint = username
				? `${apiBase.replace(/\/+$/, "")}/api/v1/users/${encodeURIComponent(username)}/pedal/${encodeURIComponent(entityId)}${queryParams}`
				: `${apiBase.replace(/\/+$/, "")}/api/v1/pedals/${encodeURIComponent(entityId)}${queryParams}`;

			const headers: Record<string, string> = { Accept: "application/json" };
			if (this.lastEtag && !rev) {
				headers["If-None-Match"] = this.lastEtag;
			}

			const response = await fetch(endpoint, { headers });

			if (response.status === 304 && this.currentEntity) {
				// Entity has not changed, retain compiled program
				this.onlineStatus = "ready";
				this.render();
				return;
			}

			if (!response.ok) {
				if (response.status === 404) {
					throw new Error(
						`Pedal '${entityId}' ${username ? `by @${username} ` : ""}${rev ? `(rev ${rev}) ` : ""}was not found on VesselDSP.`,
					);
				}
				throw new Error(
					`API request failed with HTTP ${response.status}: ${response.statusText}`,
				);
			}

			const etagHeader = response.headers.get("ETag");
			if (etagHeader) {
				this.lastEtag = etagHeader;
			}

			const data = (await response.json()) as {
				entity?: EntityPayload;
				data?: EntityPayload;
			} & EntityPayload;
			const payload: EntityPayload = data.data ?? data.entity ?? data;

			if (!payload.vdspSource) {
				throw new Error("Received entity record did not contain valid .vdsp source.");
			}

			this.currentEntity = payload;
			this.currentVdspSource = payload.vdspSource;

			const compileRes = this.compileAndLoadSource(this.currentVdspSource);
			if (compileRes.status === "ok") {
				this.onlineStatus = "ready";
			} else {
				this.onlineStatus = "error";
				this.errorMessage = `Circuit Compilation Error: ${compileRes.message}`;
			}
		} catch (err) {
			this.onlineStatus = "error";
			this.errorMessage = err instanceof Error ? err.message : String(err);
		}

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
					this.runtimeNode = new RuntimeNode(
						"pedal-circuit",
						this.currentEntity?.name ?? "Circuit",
						res.program,
					);
					this.engine.chain.addNode(this.runtimeNode);
				} else {
					this.runtimeNode = new RuntimeNode(
						"pedal-circuit",
						this.currentEntity?.name ?? "Circuit",
						res.program,
					);
					this.engine.chain.addNode(this.runtimeNode);
				}
				return { status: "ok" };
			} else {
				return {
					status: "error",
					message:
						res.reasons?.map((r) => r.reason).join("; ") ??
						"Compilation failed",
				};
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
			gridColor: isDark
				? "rgba(255, 255, 255, 0.2)"
				: "rgba(185, 185, 185, 0.3)",
			textColor: isDark ? "#ffffff" : "#b9b9b9",
		});
	}

	private render(): void {
		if (!this.shadowRoot) return;

		const isStudio = this.currentMode === "studio";
		const profile = this.engine.chain.inputProfile.getConfig();
		const master = this.engine.chain.master.getConfig();

		const entityName = this.currentEntity?.name ?? "PEDAL";
		const entityAuthor = this.currentEntity?.username;
		const entityId =
			this.currentEntity?.id ||
			this.currentEntity?.slug ||
			this.getAttribute("id") ||
			"";
		const revHash =
			this.currentEntity?.revisionHash ||
			this.getAttribute("rev") ||
			this.getAttribute("revision");

		const entityUrl =
			entityAuthor && entityId
				? `https://vesseldsp.com/${encodeURIComponent(entityAuthor)}/pedal/${encodeURIComponent(entityId)}${revHash ? `?rev=${encodeURIComponent(revHash)}` : ""}`
				: null;

		const isErrorState =
			this.onlineStatus === "error" ||
			this.onlineStatus === "unsupported_type" ||
			this.onlineStatus === "missing_id" ||
			this.onlineStatus === "missing_type";

		let statusBadgeClass = "badge";
		let statusBadgeText = "ONLINE";

		if (this.onlineStatus === "loading") {
			statusBadgeClass = "badge loading";
			statusBadgeText = "LOADING...";
		} else if (isErrorState) {
			statusBadgeClass = "badge error";
			statusBadgeText = "ERROR";
		} else if (this.engine.playing) {
			statusBadgeClass = "badge playing";
			statusBadgeText = "PLAYING";
		} else if (this.onlineStatus === "ready") {
			statusBadgeClass = "badge";
			statusBadgeText = "READY";
		}

		this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <div class="header">
        <div class="title-container">
          <div class="title">
            <span class="brand-dot"></span>
            ${entityName}
          </div>
          ${
						entityUrl
							? `
            <div class="entity-meta">
              BY <a href="${entityUrl}" target="_blank" rel="noopener noreferrer">@${entityAuthor}</a>
              <span>•</span>
              <span>PEDAL</span>
              ${
								revHash
									? `<span>•</span><span class="rev-tag">REV: ${revHash.slice(0, 8)}</span>`
									: ""
							}
            </div>
          `
							: `
            <div class="entity-meta">
              VESSEL DSP ${isStudio ? "STUDIO" : "PLAYER"}
            </div>
          `
					}
        </div>
        <div class="header-actions">
          <span class="${statusBadgeClass}" id="status-badge">
            ${statusBadgeText}
          </span>
          <button id="btn-mode-toggle" class="badge">
            ${isStudio ? "✕ COMPACT" : "↗ STUDIO"}
          </button>
        </div>
      </div>

      ${
				isErrorState
					? `
        <div class="error-banner">
          <div class="error-title">⚠ ONLINE MODE REQUIREMENT</div>
          <div>${this.errorMessage}</div>
          <div style="margin-top: 8px;">
            <button id="btn-retry" class="primary" style="padding: 4px 8px; font-size: 0.65rem;">RETRY FETCH</button>
          </div>
        </div>
      `
					: ""
			}

      <div class="studio-grid">
        ${
					isStudio
						? `
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
        `
						: ""
				}

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
		const canvas = this.shadowRoot.querySelector(
			"#spectrum-canvas",
		) as HTMLCanvasElement;
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

		const btnModeToggle = this.shadowRoot.querySelector(
			"#btn-mode-toggle",
		) as HTMLButtonElement;
		btnModeToggle?.addEventListener("click", () => {
			this.setMode(this.currentMode === "studio" ? "compact" : "studio");
		});

		const btnRetry = this.shadowRoot.querySelector(
			"#btn-retry",
		) as HTMLButtonElement;
		btnRetry?.addEventListener("click", () => {
			this.resolveAndFetchOnlineEntity().catch(console.error);
		});

		const btnCompile = this.shadowRoot.querySelector(
			"#btn-compile",
		) as HTMLButtonElement;
		const vdspEditor = this.shadowRoot.querySelector(
			"#vdsp-editor",
		) as HTMLTextAreaElement;
		const compilerMsg = this.shadowRoot.querySelector(
			"#compiler-msg",
		) as HTMLElement;

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

		const btnPlay = this.shadowRoot.querySelector(
			"#btn-play",
		) as HTMLButtonElement;
		const playIcon = this.shadowRoot.querySelector("#play-icon") as HTMLElement;
		const playText = this.shadowRoot.querySelector("#play-text") as HTMLElement;
		const statusBadge = this.shadowRoot.querySelector(
			"#status-badge",
		) as HTMLElement;

		btnPlay?.addEventListener("click", async () => {
			if (this.engine.playing) {
				await this.engine.stop();
				if (playIcon) playIcon.textContent = "▶";
				if (playText) playText.textContent = "PLAY";
				if (statusBadge) {
					statusBadge.textContent = "READY";
					statusBadge.classList.remove("playing");
				}
			} else {
				await this.engine.play();
				if (playIcon) playIcon.textContent = "⏹";
				if (playText) playText.textContent = "STOP";
				if (statusBadge) {
					statusBadge.textContent = "PLAYING";
					statusBadge.classList.add("playing");
				}
			}
		});

		const sourceSelect = this.shadowRoot.querySelector(
			"#source-select",
		) as HTMLSelectElement;
		sourceSelect?.addEventListener("change", async (e) => {
			const type = (e.target as HTMLSelectElement).value as "sample" | "mic";
			await this.engine.setSource(type);
		});

		const pickupSelect = this.shadowRoot.querySelector(
			"#pickup-select",
		) as HTMLSelectElement;
		pickupSelect?.addEventListener("change", (e) => {
			const type = (e.target as HTMLSelectElement).value as PickupType;
			this.engine.chain.inputProfile.setPickupType(type);
		});

		const impSlider = this.shadowRoot.querySelector(
			"#imp-slider",
		) as HTMLInputElement;
		const impVal = this.shadowRoot.querySelector("#imp-val") as HTMLElement;
		impSlider?.addEventListener("input", (e) => {
			const val = Number((e.target as HTMLInputElement).value);
			this.engine.chain.inputProfile.setImpedance(val);
			if (impVal) impVal.textContent = `${val / 1000}KΩ`;
		});

		const gainSlider = this.shadowRoot.querySelector(
			"#gain-slider",
		) as HTMLInputElement;
		const gainVal = this.shadowRoot.querySelector("#gain-val") as HTMLElement;
		gainSlider?.addEventListener("input", (e) => {
			const val = Number((e.target as HTMLInputElement).value);
			this.engine.chain.inputProfile.setInputGainDb(val);
			if (gainVal) gainVal.textContent = `${val} DB`;
		});

		const btnPedal = this.shadowRoot.querySelector(
			"#btn-pedal",
		) as HTMLButtonElement;
		btnPedal?.addEventListener("click", () => {
			if (this.runtimeNode) {
				this.runtimeNode.bypassed = !this.runtimeNode.bypassed;
				btnPedal.classList.toggle("active", !this.runtimeNode.bypassed);
				btnPedal.textContent = `PEDAL: ${this.runtimeNode.bypassed ? "OFF" : "ON"}`;
			}
		});

		const btnNam = this.shadowRoot.querySelector(
			"#btn-nam",
		) as HTMLButtonElement;
		btnNam?.addEventListener("click", () => {
			this.namNode.bypassed = !this.namNode.bypassed;
			btnNam.classList.toggle("active", !this.namNode.bypassed);
			btnNam.textContent = `NAM AMP: ${this.namNode.bypassed ? "OFF" : "ON"}`;
		});

		const btnIr = this.shadowRoot.querySelector(
			"#btn-ir",
		) as HTMLButtonElement;
		btnIr?.addEventListener("click", () => {
			this.irNode.bypassed = !this.irNode.bypassed;
			btnIr.classList.toggle("active", !this.irNode.bypassed);
			btnIr.textContent = `CAB IR: ${this.irNode.bypassed ? "OFF" : "ON"}`;
		});

		const volSlider = this.shadowRoot.querySelector(
			"#vol-slider",
		) as HTMLInputElement;
		const volVal = this.shadowRoot.querySelector("#vol-val") as HTMLElement;
		volSlider?.addEventListener("input", (e) => {
			const val = Number((e.target as HTMLInputElement).value);
			this.engine.chain.master.setVolumeDb(val);
			if (volVal) volVal.textContent = `${val} DB`;
		});

		const btnMute = this.shadowRoot.querySelector(
			"#btn-mute",
		) as HTMLButtonElement;
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
