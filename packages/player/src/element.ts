// Thin custom element over PlayerController. All behaviour that matters
// lives in the controller and is tested with a fake engine; this file only
// maps attributes, properties and events onto the controller and renders.
//
// This module is DOM-lib-free on purpose: it compiles both under the
// player package tsconfig (DOM lib) and under the root tsconfig (ES2022
// only, which typechecks tests/player). All browser globals are reached
// through globalThis instead of named DOM types, and importing this module
// in a non-DOM environment (bun tests) never throws.

import { PlayerController } from "./controller.js";
import { parseSourceList, validateSourceItems } from "./source-list.js";
import { PlayerError, type PlayerState, type SourceItem } from "./types.js";

type DomGlobals = {
	HTMLElement?: { new (): object; prototype: object };
	customElements?: {
		get(name: string): unknown;
		define(name: string, elementClass: unknown): void;
	};
	window?: unknown;
};

function domGlobals(): DomGlobals {
	return globalThis as unknown as DomGlobals;
}

const HTMLElementBase: { new (): object; prototype: object } =
	domGlobals().HTMLElement ?? (class {} as unknown as { new (): object; prototype: object });

interface ShadowHost {
	attachShadow(init: { mode: string }): void;
	readonly shadowRoot: ShadowRootLike | null;
	getAttribute(name: string): string | null;
	setAttribute(name: string, value: string): void;
	removeAttribute(name: string): void;
}

interface ShadowRootLike {
	innerHTML: string;
	querySelector(selectors: string): ElementLike | null;
	querySelectorAll(selectors: string): ElementLike[];
}

interface ElementLike {
	getAttribute(name: string): string | null;
	addEventListener(type: string, listener: (event: EventLike) => void): void;
}

interface EventLike {
	readonly target: {
		readonly value?: unknown;
		getAttribute?(name: string): string | null;
	} | null;
}

function asHost(element: object): ShadowHost | null {
	const candidate = element as Partial<ShadowHost>;
	if (
		typeof candidate.getAttribute !== "function" ||
		typeof candidate.setAttribute !== "function" ||
		typeof candidate.removeAttribute !== "function"
	) {
		return null;
	}
	return candidate as ShadowHost;
}

function readAttribute(element: object, name: string): string | null {
	return asHost(element)?.getAttribute(name) ?? null;
}

const STYLES = `
:host {
  display: block;
  box-sizing: border-box;
  max-width: 40rem;
  font-family: system-ui, sans-serif;
  font-size: 0.875rem;
  color: var(--player-fg, #1d1d1d);
  background: var(--player-bg, #ffffff);
  border: 1px solid var(--player-border, #1d1d1d);
  padding: 1rem;
}
.row { display: flex; gap: 0.75rem; align-items: center; flex-wrap: wrap; }
.field { display: flex; flex-direction: column; gap: 0.25rem; flex: 1; min-width: 8rem; }
button, select, input[type="range"], audio { font: inherit; }
button {
  cursor: pointer;
  padding: 0.5rem 1rem;
  color: var(--player-button-fg, #ffffff);
  background: var(--player-button-bg, #1d1d1d);
  border: 1px solid var(--player-border, #1d1d1d);
}
button:disabled { cursor: default; opacity: 0.5; }
select {
  padding: 0.5rem;
  color: var(--player-fg, #1d1d1d);
  background: var(--player-bg, #ffffff);
  border: 1px solid var(--player-border, #1d1d1d);
}
.status { min-height: 1.5em; }
.error { color: var(--player-error, #b00020); min-height: 1.5em; }
.controls { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }
`;

export class VesselPlayerElement extends HTMLElementBase {
	static get observedAttributes(): string[] {
		return ["src", "inputs", "nam", "ir", "fallback"];
	}

	private controller: PlayerController | null = null;
	private unsubscribers: Array<() => void> = [];
	private listProps: { inputs: SourceItem[]; nam: SourceItem[]; ir: SourceItem[] } = {
		inputs: [],
		nam: [],
		ir: [],
	};
	private listErrors: { inputs: string | null; nam: string | null; ir: string | null } = {
		inputs: null,
		nam: null,
		ir: null,
	};
	private actionError: string | null = null;

	get src(): string | null {
		return readAttribute(this, "src");
	}

	set src(value: string | null) {
		const host = asHost(this);
		if (host === null) {
			return;
		}
		if (value === null) {
			host.removeAttribute("src");
		} else {
			host.setAttribute("src", value);
		}
	}

	get inputs(): SourceItem[] {
		return [...this.listProps.inputs];
	}

	set inputs(value: readonly SourceItem[]) {
		const result = validateSourceItems([...value]);
		if ("reason" in result) {
			this.listErrors.inputs = `Invalid inputs list: ${result.reason}.`;
		} else {
			this.listErrors.inputs = null;
			this.listProps.inputs = [...result.items];
		}
		this.controller?.setInputSources(this.listProps.inputs);
		this.render();
	}

	get nam(): SourceItem[] {
		return [...this.listProps.nam];
	}

	set nam(value: readonly SourceItem[]) {
		const result = validateSourceItems([...value]);
		if ("reason" in result) {
			this.listErrors.nam = `Invalid nam list: ${result.reason}.`;
		} else {
			this.listErrors.nam = null;
			this.listProps.nam = [...result.items];
		}
		this.controller?.setNamSources(this.listProps.nam);
		this.render();
	}

	get ir(): SourceItem[] {
		return [...this.listProps.ir];
	}

	set ir(value: readonly SourceItem[]) {
		const result = validateSourceItems([...value]);
		if ("reason" in result) {
			this.listErrors.ir = `Invalid ir list: ${result.reason}.`;
		} else {
			this.listErrors.ir = null;
			this.listProps.ir = [...result.items];
		}
		this.controller?.setIrSources(this.listProps.ir);
		this.render();
	}

	get fallback(): string | null {
		return readAttribute(this, "fallback");
	}

	set fallback(value: string | null) {
		const host = asHost(this);
		if (host === null) {
			return;
		}
		if (value === null) {
			host.removeAttribute("fallback");
		} else {
			host.setAttribute("fallback", value);
		}
	}

	get state(): PlayerState | null {
		return this.controller?.state ?? null;
	}

	attributeChangedCallback(_name: string, _oldValue: string | null, _newValue: string | null): void {
		if (this.controller === null) {
			return;
		}
		this.applyAttribute(_name);
		this.render();
	}

	connectedCallback(): void {
		const host = asHost(this);
		if (host !== null && typeof host.attachShadow === "function" && host.shadowRoot === null) {
			host.attachShadow({ mode: "open" });
		}
		this.readAllAttributes();
		this.controller = new PlayerController({
			src: readAttribute(this, "src"),
			inputs: this.listProps.inputs,
			nam: this.listProps.nam,
			ir: this.listProps.ir,
			fallbackUrl: readAttribute(this, "fallback"),
		});
		this.unsubscribers.push(
			this.controller.on("statechange", () => this.render()),
			this.controller.on("ready", () => this.render()),
			this.controller.on("error", () => this.render()),
			this.controller.on("selection", () => this.render()),
		);
		this.render();
	}

	disconnectedCallback(): void {
		for (const unsubscribe of this.unsubscribers) {
			unsubscribe();
		}
		this.unsubscribers = [];
		this.controller?.dispose();
		this.controller = null;
	}

	/** Start playback. Call from a user gesture (the transport button). */
	async play(): Promise<void> {
		this.actionError = null;
		try {
			await this.controller?.play();
		} catch (unknown) {
			this.actionError = unknown instanceof PlayerError ? unknown.message : "Playback failed.";
			this.render();
			throw unknown;
		}
		this.render();
	}

	async pause(): Promise<void> {
		this.actionError = null;
		try {
			await this.controller?.pause();
		} catch (unknown) {
			this.actionError = unknown instanceof PlayerError ? unknown.message : "Pause failed.";
			this.render();
			throw unknown;
		}
		this.render();
	}

	private applyAttribute(name: string): void {
		const controller = this.controller;
		if (controller === null) {
			return;
		}
		if (name === "src") {
			controller.setSrc(readAttribute(this, "src"));
			return;
		}
		if (name === "fallback") {
			controller.setFallbackUrl(readAttribute(this, "fallback"));
			return;
		}
		const raw = readAttribute(this, name) ?? "";
		const result = parseSourceList(raw);
		if ("reason" in result) {
			if (name === "inputs" || name === "nam" || name === "ir") {
				this.listErrors[name] = `Invalid ${name} list: ${result.reason}.`;
			}
			return;
		}
		this.listProps[name as "inputs" | "nam" | "ir"] = [...result.items];
		this.listErrors[name as "inputs" | "nam" | "ir"] = null;
		if (name === "inputs") {
			controller.setInputSources(result.items);
		} else if (name === "nam") {
			controller.setNamSources(result.items);
		} else if (name === "ir") {
			controller.setIrSources(result.items);
		}
	}

	private readAllAttributes(): void {
		for (const name of ["inputs", "nam", "ir"] as const) {
			const raw = readAttribute(this, name) ?? "";
			const result = parseSourceList(raw);
			if ("reason" in result) {
				this.listErrors[name] = `Invalid ${name} list: ${result.reason}.`;
				this.listProps[name] = [];
			} else {
				this.listErrors[name] = null;
				this.listProps[name] = [...result.items];
			}
		}
	}

	private describeStatus(state: PlayerState): string {
		switch (state) {
			case "idle":
				return "Idle: no circuit loaded.";
			case "loading":
				return "Loading circuit.";
			case "ready":
				return "Ready.";
			case "playing":
				return "Playing.";
			case "fallback":
				if (this.controller?.fallbackRefusal === "unsafe-src") {
					return "No player engine, and the fallback audio URL was refused as unsafe.";
				}
				return this.controller?.fallbackUrl
					? "No player engine: playing the pre-rendered fallback audio."
					: "No player engine and no fallback audio.";
			case "error":
				return "Something went wrong while loading.";
		}
	}

	private render(): void {
		const host = asHost(this);
		const root = host?.shadowRoot ?? null;
		const controller = this.controller;
		if (root === null || controller === null) {
			return;
		}
		const state = controller.state;
		const errorText =
			this.actionError ??
			controller.lastError?.message ??
			this.listErrors.inputs ??
			this.listErrors.nam ??
			this.listErrors.ir;
		const inputOptions = controller.inputChoices
			.map(
				(choice) =>
					`<option value="${escapeHtml(choice.id)}"${choice.id === controller.selectedInput.id ? " selected" : ""}>${escapeHtml(choice.label)}</option>`,
			)
			.join("");
		const namOptions =
			`<option value="">None</option>` +
			this.listProps.nam
				.map(
					(item) =>
						`<option value="${escapeHtml(item.id)}"${controller.selectedNam?.id === item.id ? " selected" : ""}>${escapeHtml(item.label)}</option>`,
				)
				.join("");
		const irOptions =
			`<option value="">None</option>` +
			this.listProps.ir
				.map(
					(item) =>
						`<option value="${escapeHtml(item.id)}"${controller.selectedIr?.id === item.id ? " selected" : ""}>${escapeHtml(item.label)}</option>`,
				)
				.join("");
		const controlInputs = controller.controls
			.map((control) => {
				const value = controller.getControlValue(control.id) ?? control.value;
				return `<div class="field"><label for="control-${escapeHtml(control.id)}">${escapeHtml(control.label)}</label><input type="range" id="control-${escapeHtml(control.id)}" data-control="${escapeHtml(control.id)}" min="${control.min}" max="${control.max}" step="any" value="${value}"></div>`;
			})
			.join("");
		const fallbackUrl = controller.fallbackUrl;
		const fallbackBlock =
			state === "fallback"
				? fallbackUrl
					? `<audio controls src="${escapeHtml(fallbackUrl)}"></audio>`
					: `<p>No audio playback is available in this browser.</p>`
				: "";
		const transportLabel = state === "playing" ? "Pause" : "Play";
		const transportDisabled = state === "playing" || state === "ready" ? "" : " disabled";

		// In the fallback state there is no engine to drive, so the transport, the pickers and the
		// controls would do nothing: show only the fallback audio (or the message) and the status.
		const interactiveBlock =
			state === "fallback"
				? ""
				: `<div class="row">
        <button type="button" data-action="transport"${transportDisabled}>${transportLabel}</button>
      </div>
      <div class="row">
        <div class="field"><label for="player-input">Input</label><select id="player-input" data-picker="input">${inputOptions}</select></div>
        <div class="field"><label for="player-nam">NAM model</label><select id="player-nam" data-picker="nam">${namOptions}</select></div>
        <div class="field"><label for="player-ir">Impulse response</label><select id="player-ir" data-picker="ir">${irOptions}</select></div>
      </div>
      <div class="controls">${controlInputs}</div>`;

		root.innerHTML = `
      <style>${STYLES}</style>
      ${interactiveBlock}
      ${fallbackBlock}
      <p class="status" aria-live="polite">${escapeHtml(this.describeStatus(state))}</p>
      <p class="error" role="alert">${errorText ? escapeHtml(errorText) : ""}</p>
    `;

		root.querySelector('[data-action="transport"]')?.addEventListener("click", () => {
			void (async () => {
				try {
					if (this.controller?.state === "playing") {
						await this.pause();
					} else {
						await this.play();
					}
				} catch {
					// The error line already shows the typed message.
				}
			})();
		});
		for (const picker of root.querySelectorAll("[data-picker]")) {
			picker.addEventListener("change", (event) => {
				const value = event.target?.value;
				if (typeof value !== "string") {
					return;
				}
				const kind = picker.getAttribute("data-picker");
				this.actionError = null;
				try {
					let pending: unknown;
					if (kind === "input") {
						this.controller?.selectInput(value);
					} else if (kind === "nam") {
						// selectNam is async when a namLoader is configured:
						// a rejection must surface in the error line, since a
						// synchronous catch cannot see it. Success re-renders
						// through the controller's selection event as well.
						pending = this.controller?.selectNam(value === "" ? null : value);
					} else if (kind === "ir") {
						this.controller?.selectIr(value === "" ? null : value);
					}
					if (pending instanceof Promise) {
						pending.then(
							() => {
								this.actionError = null;
								this.render();
							},
							(unknown) => {
								this.actionError =
									unknown instanceof PlayerError ? unknown.message : "Selection failed.";
								this.render();
							},
						);
					}
				} catch (unknown) {
					this.actionError = unknown instanceof PlayerError ? unknown.message : "Selection failed.";
				}
				this.render();
			});
		}
		for (const slider of root.querySelectorAll("[data-control]")) {
			slider.addEventListener("input", (event) => {
				const value = event.target?.value;
				const id = slider.getAttribute("data-control") ?? "";
				if (typeof value !== "string") {
					return;
				}
				this.actionError = null;
				try {
					this.controller?.setControl(id, Number(value));
				} catch (unknown) {
					this.actionError = unknown instanceof PlayerError ? unknown.message : "Control change failed.";
					this.render();
				}
			});
		}
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function registerVesselPlayer(): void {
	const globals = domGlobals();
	if (
		globals.window !== undefined &&
		globals.customElements !== undefined &&
		globals.customElements.get("vessel-player") === undefined
	) {
		globals.customElements.define("vessel-player", VesselPlayerElement);
	}
}

if (domGlobals().window !== undefined) {
	registerVesselPlayer();
}
