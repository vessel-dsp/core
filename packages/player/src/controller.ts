// DOM-free player logic. All behaviour that matters lives here and is
// tested with a fake engine; element.ts only maps attributes, properties
// and events onto this class and renders.

import { createEngineAttempt } from "./engine.js";
import {
	BROWSER_AUDIO_INPUT,
	PlayerError,
	type EngineUnavailableReason,
	type InputChoiceDescriptor,
	type IrDescriptor,
	type NamDescriptor,
	type PlayerControlInfo,
	type PlayerControllerEventName,
	type PlayerEngine,
	type PlayerSelection,
	type PlayerState,
	type PlayerTelemetry,
	type SourceItem,
} from "./types.js";

export interface PlayerControllerOptions {
	readonly src?: string | null;
	readonly inputs?: readonly SourceItem[] | null;
	readonly nam?: readonly SourceItem[] | null;
	readonly ir?: readonly SourceItem[] | null;
	readonly fallbackUrl?: string | null;
}

function toWavDescriptor(item: SourceItem): InputChoiceDescriptor {
	return { kind: "wav", id: item.id, label: item.label, src: item.src };
}

function toNamDescriptor(item: SourceItem): NamDescriptor {
	return { id: item.id, label: item.label, src: item.src };
}

function toIrDescriptor(item: SourceItem): IrDescriptor {
	return { id: item.id, label: item.label, src: item.src };
}

/**
 * PlayerController: DOM-free state machine over a fakeable engine seam.
 *
 * States: idle (no src yet), loading (engine.load in flight), ready
 * (engine reported ready), playing (engine started), fallback (no audio
 * path: no factory registered or the factory refused with a typed
 * capability reason), error (load threw or the engine reported an error).
 *
 * play() must be called from a user gesture (a click or key handler). The
 * controller cannot verify the gesture itself; the element wires its
 * transport button click to play() so the browser autoplay policy is
 * satisfied, and future real-engine work relies on this ordering.
 *
 * Default selections: the first blog input when the list is non-empty,
 * else the always-present browser-audio choice; NAM off (null); IR off
 * (null); controls at the engine-reported program defaults.
 */
export class PlayerController {
	private engine: PlayerEngine | null = null;
	private stateValue: PlayerState = "idle";
	private lastErrorValue: PlayerError | null = null;
	private fallbackReasonValue: "no-engine" | EngineUnavailableReason | null = null;
	private vdspValue: string | null = null;
	private fallbackUrlValue: string | null = null;
	private inputSources: SourceItem[] = [];
	private namSources: SourceItem[] = [];
	private irSources: SourceItem[] = [];
	private inputChoicesValue: InputChoiceDescriptor[] = [BROWSER_AUDIO_INPUT];
	private selectedInputValue: InputChoiceDescriptor = BROWSER_AUDIO_INPUT;
	private selectedNamValue: NamDescriptor | null = null;
	private selectedIrValue: IrDescriptor | null = null;
	private controlsValue: PlayerControlInfo[] = [];
	private controlValues = new Map<string, number>();
	private lastTelemetryValue: PlayerTelemetry | null = null;
	private engineReadyFired = false;
	private loadCountValue = 0;
	private disposed = false;
	private engineUnsubscribers: Array<() => void> = [];
	private listeners: {
		statechange: Set<(state: PlayerState) => void>;
		ready: Set<() => void>;
		error: Set<(error: PlayerError) => void>;
		selection: Set<(selection: PlayerSelection) => void>;
	} = {
		statechange: new Set(),
		ready: new Set(),
		error: new Set(),
		selection: new Set(),
	};
	private settledResolve: (() => void) | null = null;
	private settledPromise: Promise<void> | null = null;

	constructor(options?: PlayerControllerOptions) {
		this.inputSources = options?.inputs ? [...options.inputs] : [];
		this.namSources = options?.nam ? [...options.nam] : [];
		this.irSources = options?.ir ? [...options.ir] : [];
		this.fallbackUrlValue = options?.fallbackUrl ?? null;
		this.rebuildInputChoices();
		this.vdspValue = options?.src ?? null;
		this.enterInitialState();
		if (this.stateValue === "loading") {
			// Defer the first load to a microtask so listeners attached
			// synchronously after construction still observe every event.
			void Promise.resolve().then(() => {
				if (!this.disposed) {
					void this.doLoad();
				}
			});
		} else {
			this.resolveSettled();
		}
	}

	get state(): PlayerState {
		return this.stateValue;
	}

	get lastError(): PlayerError | null {
		return this.lastErrorValue;
	}

	/** Why the controller is in fallback, or null when not in fallback. */
	get fallbackReason(): "no-engine" | EngineUnavailableReason | null {
		return this.fallbackReasonValue;
	}

	get vdsp(): string | null {
		return this.vdspValue;
	}

	get fallbackUrl(): string | null {
		return this.fallbackUrlValue;
	}

	get inputChoices(): readonly InputChoiceDescriptor[] {
		return this.inputChoicesValue;
	}

	get selectedInput(): InputChoiceDescriptor {
		return this.selectedInputValue;
	}

	get selectedNam(): NamDescriptor | null {
		return this.selectedNamValue;
	}

	get selectedIr(): IrDescriptor | null {
		return this.selectedIrValue;
	}

	get controls(): readonly PlayerControlInfo[] {
		return this.controlsValue;
	}

	get lastTelemetry(): PlayerTelemetry | null {
		return this.lastTelemetryValue;
	}

	/** How many times engine.load was called. Tests assert this is 1. */
	get loadCount(): number {
		return this.loadCountValue;
	}

	getControlValue(id: string): number | null {
		const current = this.controlValues.get(id);
		return current === undefined ? null : current;
	}

	on(event: "statechange", listener: (state: PlayerState) => void): () => void;
	on(event: "ready", listener: () => void): () => void;
	on(event: "error", listener: (error: PlayerError) => void): () => void;
	on(event: "selection", listener: (selection: PlayerSelection) => void): () => void;
	// biome-ignore lint/suspicious/noExplicitAny: the implementation accepts every overload listener shape.
	on(event: PlayerControllerEventName, listener: (payload?: any) => void): () => void {
		const set = this.listeners[event] as Set<(payload?: unknown) => void>;
		set.add(listener);
		return () => {
			set.delete(listener);
		};
	}

	/**
	 * Resolves when the controller leaves loading (ready, fallback or
	 * error). Resolves immediately when already settled. Tests await this
	 * instead of polling.
	 */
	settled(): Promise<void> {
		if (this.settledPromise === null) {
			return Promise.resolve();
		}
		return this.settledPromise;
	}

	/** Change the .vdsp source and reload through the engine. */
	setSrc(src: string | null): void {
		this.throwIfDisposed();
		this.vdspValue = src;
		const before: PlayerState = this.stateValue;
		if (before === "fallback" || before === "error") {
			this.rebuildFromFactory();
		} else if (this.engine === null || src === null) {
			this.setState("idle");
			this.resolveSettled();
			return;
		} else {
			this.setState("loading");
			this.armSettled();
		}
		const after: PlayerState = this.stateValue;
		if (after !== "loading") {
			return;
		}
		void this.doLoad();
	}

	setInputSources(items: readonly SourceItem[]): void {
		this.throwIfDisposed();
		this.inputSources = [...items];
		this.rebuildInputChoices();
	}

	setNamSources(items: readonly SourceItem[]): void {
		this.throwIfDisposed();
		this.namSources = [...items];
		if (this.selectedNamValue !== null && !this.namSources.some((item) => item.id === this.selectedNamValue?.id)) {
			this.selectedNamValue = null;
		}
	}

	setIrSources(items: readonly SourceItem[]): void {
		this.throwIfDisposed();
		this.irSources = [...items];
		if (this.selectedIrValue !== null && !this.irSources.some((item) => item.id === this.selectedIrValue?.id)) {
			this.selectedIrValue = null;
		}
	}

	setFallbackUrl(url: string | null): void {
		this.throwIfDisposed();
		this.fallbackUrlValue = url;
	}

	/**
	 * Start playback. Must be called from a user gesture; see the class
	 * note. Refused with reason not-ready outside ready, and with the
	 * fallback reason while in fallback. A second call while playing is
	 * a no-op and does not call the engine again.
	 */
	async play(): Promise<void> {
		this.throwIfDisposed();
		if (this.stateValue === "fallback") {
			throw new PlayerError(
				this.fallbackReasonValue === "no-engine" ? "no-engine" : "engine-unavailable",
				"Playback needs the blog fallback audio because this browser has no player engine.",
			);
		}
		if (this.stateValue !== "ready" && this.stateValue !== "playing") {
			throw new PlayerError(
				"not-ready",
				`Play needs state ready but the player is ${this.stateValue}.`,
			);
		}
		if (this.stateValue === "playing") {
			return;
		}
		const engine = this.requireEngine();
		const started = engine.start();
		if (started instanceof Promise) {
			await started;
		}
		this.setState("playing");
	}

	/** Stop playback. No-op unless playing, so the engine is not called. */
	async pause(): Promise<void> {
		this.throwIfDisposed();
		if (this.stateValue !== "playing") {
			return;
		}
		const engine = this.requireEngine();
		const stopped = engine.stop();
		if (stopped instanceof Promise) {
			await stopped;
		}
		this.setState("ready");
	}

	/** Pick a blog input or the browser-audio choice by id. */
	selectInput(id: string): void {
		this.throwIfDisposed();
		const engine = this.requireEngineForSelection();
		const found = this.inputChoicesValue.find((choice) => choice.id === id);
		if (found === undefined) {
			throw new PlayerError("unknown-input", `Unknown input "${id}".`);
		}
		this.selectedInputValue = found;
		engine.setInput(found);
		this.emitSelection({ kind: "input", id: found.id });
	}

	/** Pick a NAM model by id, or null for None. */
	selectNam(id: string | null): void {
		this.throwIfDisposed();
		const engine = this.requireEngineForSelection();
		if (id === null) {
			this.selectedNamValue = null;
			engine.setNam(null);
			this.emitSelection({ kind: "nam", id: null });
			return;
		}
		const found = this.namSources.find((item) => item.id === id);
		if (found === undefined) {
			throw new PlayerError("unknown-nam", `Unknown NAM model "${id}".`);
		}
		const descriptor = toNamDescriptor(found);
		this.selectedNamValue = descriptor;
		engine.setNam(descriptor);
		this.emitSelection({ kind: "nam", id: descriptor.id });
	}

	/** Pick an IR by id, or null for None. */
	selectIr(id: string | null): void {
		this.throwIfDisposed();
		const engine = this.requireEngineForSelection();
		if (id === null) {
			this.selectedIrValue = null;
			engine.setIr(null);
			this.emitSelection({ kind: "ir", id: null });
			return;
		}
		const found = this.irSources.find((item) => item.id === id);
		if (found === undefined) {
			throw new PlayerError("unknown-ir", `Unknown IR "${id}".`);
		}
		const descriptor = toIrDescriptor(found);
		this.selectedIrValue = descriptor;
		engine.setIr(descriptor);
		this.emitSelection({ kind: "ir", id: descriptor.id });
	}

	/** Forward a control change to the engine by control id. */
	setControl(id: string, value: number): void {
		this.throwIfDisposed();
		if (!Number.isFinite(value)) {
			throw new PlayerError("invalid-control-value", `Control "${id}" needs a finite number.`);
		}
		const engine = this.requireEngineForSelection();
		if (this.stateValue !== "ready" && this.stateValue !== "playing") {
			throw new PlayerError(
				"not-ready",
				`Control changes need state ready but the player is ${this.stateValue}.`,
			);
		}
		const known = this.controlsValue.some((control) => control.id === id);
		if (!known) {
			throw new PlayerError("unknown-control", `Unknown control "${id}".`);
		}
		engine.setControl(id, value);
		this.controlValues.set(id, value);
	}

	/** Release the engine. Every later call fails with reason disposed. */
	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		for (const unsubscribe of this.engineUnsubscribers) {
			unsubscribe();
		}
		this.engineUnsubscribers = [];
		try {
			this.engine?.dispose();
		} finally {
			this.engine = null;
		}
		this.listeners.statechange.clear();
		this.listeners.ready.clear();
		this.listeners.error.clear();
		this.listeners.selection.clear();
		this.resolveSettled();
	}

	private throwIfDisposed(): void {
		if (this.disposed) {
			throw new PlayerError("disposed", "This player was disposed.");
		}
	}

	private requireEngine(): PlayerEngine {
		if (this.engine === null) {
			throw new PlayerError(
				this.fallbackReasonValue === "no-engine" ? "no-engine" : "engine-unavailable",
				"There is no player engine for this call.",
			);
		}
		return this.engine;
	}

	private requireEngineForSelection(): PlayerEngine {
		if (this.engine === null) {
			throw new PlayerError(
				this.fallbackReasonValue === "no-engine" ? "no-engine" : "engine-unavailable",
				"There is no player engine for this call.",
			);
		}
		return this.engine;
	}

	private rebuildInputChoices(): void {
		const blogChoices = this.inputSources.map(toWavDescriptor);
		this.inputChoicesValue = [...blogChoices, BROWSER_AUDIO_INPUT];
		const stillThere = this.inputChoicesValue.find(
			(choice) => choice.id === this.selectedInputValue.id,
		);
		if (stillThere === undefined) {
			this.selectedInputValue = blogChoices[0] ?? BROWSER_AUDIO_INPUT;
		}
		if (this.inputSources.length > 0 && this.selectedInputValue.id === BROWSER_AUDIO_INPUT.id) {
			const first = blogChoices[0];
			if (first !== undefined && this.loadCountValue === 0) {
				this.selectedInputValue = first;
			}
		}
	}

	private enterInitialState(): void {
		const attempt = createEngineAttempt();
		if (attempt.ok === false) {
			if ("noFactory" in attempt) {
				this.fallbackReasonValue = "no-engine";
			} else {
				this.fallbackReasonValue = attempt.reason;
			}
			this.setState("fallback");
			return;
		}
		this.engine = attempt.engine;
		this.subscribeEngine(attempt.engine);
		if (this.vdspValue === null) {
			this.setState("idle");
			return;
		}
		this.setState("loading");
		this.armSettled();
	}

	private rebuildFromFactory(): void {
		for (const unsubscribe of this.engineUnsubscribers) {
			unsubscribe();
		}
		this.engineUnsubscribers = [];
		this.engine = null;
		this.fallbackReasonValue = null;
		this.lastErrorValue = null;
		const attempt = createEngineAttempt();
		if (attempt.ok === false) {
			if ("noFactory" in attempt) {
				this.fallbackReasonValue = "no-engine";
			} else {
				this.fallbackReasonValue = attempt.reason;
			}
			this.setState("fallback");
			this.resolveSettled();
			return;
		}
		this.engine = attempt.engine;
		this.engineReadyFired = false;
		this.subscribeEngine(attempt.engine);
		if (this.vdspValue === null) {
			this.setState("idle");
			this.resolveSettled();
			return;
		}
		this.setState("loading");
		this.armSettled();
	}

	private subscribeEngine(engine: PlayerEngine): void {
		this.engineUnsubscribers.push(
			engine.on("ready", () => {
				if (this.disposed || this.engine !== engine) {
					return;
				}
				this.engineReadyFired = true;
				if (this.stateValue === "loading" || this.stateValue === "idle") {
					this.lastErrorValue = null;
					this.setState("ready");
					this.emitReady();
					this.resolveSettled();
				}
			}),
			engine.on("controls", (controls: readonly PlayerControlInfo[]) => {
				if (this.disposed || this.engine !== engine) {
					return;
				}
				this.controlsValue = [...controls];
				this.controlValues.clear();
				for (const control of controls) {
					this.controlValues.set(control.id, control.value);
				}
			}),
			engine.on("error", (error: PlayerError) => {
				if (this.disposed || this.engine !== engine) {
					return;
				}
				this.lastErrorValue = error;
				this.setState("error");
				this.emitError(error);
				this.resolveSettled();
			}),
			engine.on("telemetry", (telemetry: PlayerTelemetry) => {
				if (this.disposed || this.engine !== engine) {
					return;
				}
				this.lastTelemetryValue = telemetry;
			}),
		);
	}

	private async doLoad(): Promise<void> {
		const engine = this.engine;
		const vdsp = this.vdspValue;
		if (engine === null || vdsp === null) {
			return;
		}
		this.loadCountValue += 1;
		try {
			const result = engine.load({ vdsp });
			if (result instanceof Promise) {
				await result;
			}
		} catch (unknown) {
			if (this.disposed || this.engine !== engine) {
				return;
			}
			const failure =
				unknown instanceof PlayerError
					? unknown
					: new PlayerError("load-failed", "Loading the circuit failed.");
			this.lastErrorValue = failure;
			this.setState("error");
			this.emitError(failure);
			this.resolveSettled();
		}
	}

	private setState(next: PlayerState): void {
		if (this.stateValue === next) {
			return;
		}
		this.stateValue = next;
		for (const listener of [...this.listeners.statechange]) {
			listener(next);
		}
	}

	private emitReady(): void {
		for (const listener of [...this.listeners.ready]) {
			listener();
		}
	}

	private emitError(error: PlayerError): void {
		for (const listener of [...this.listeners.error]) {
			listener(error);
		}
	}

	private emitSelection(selection: PlayerSelection): void {
		for (const listener of [...this.listeners.selection]) {
			listener(selection);
		}
	}

	private armSettled(): void {
		if (this.settledPromise !== null) {
			return;
		}
		this.settledPromise = new Promise<void>((resolve) => {
			this.settledResolve = resolve;
		});
	}

	private resolveSettled(): void {
		if (this.settledResolve !== null) {
			this.settledResolve();
			this.settledResolve = null;
			this.settledPromise = null;
		}
	}
}
