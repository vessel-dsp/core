// Shared player-shell surface. This module is DOM-free on purpose: the
// logic here must stay testable under bun:test with no browser APIs.
// Rendering lives in element.ts, which is a thin wrapper over controller.ts.

/** Blog-supplied pickable source. Owned by player-shell. */
export type SourceItem = {
	readonly id: string;
	readonly label: string;
	readonly src: string;
};

/**
 * Engine input descriptor for a WAV-backed blog input. Carries the id,
 * label and src only. Fetching and decoding the bytes belongs to a later
 * task (the input path worker owns WavInput).
 */
export type WavInputDescriptor = {
	readonly kind: "wav";
	readonly id: string;
	readonly label: string;
	readonly src: string;
};

/**
 * Engine input descriptor for live browser audio. There is no src because
 * there is no URL to fetch; the stream comes from getUserMedia in a later
 * task. The id is fixed so the controller can always offer this choice.
 */
export type BrowserAudioDescriptor = {
	readonly kind: "browser";
	readonly id: "browser-audio";
	readonly label: string;
};

/**
 * Input choice handed to the engine. Mirrors the shape owned by the
 * player-inputs worker (InputChoice) without importing it, so the pieces
 * join later without a dependency between worktrees.
 */
export type InputChoiceDescriptor = WavInputDescriptor | BrowserAudioDescriptor;

/**
 * Engine NAM descriptor. Carries the id, label and src only. Fetching and
 * parsing the .nam profile belongs to a later task.
 */
export type NamDescriptor = {
	readonly id: string;
	readonly label: string;
	readonly src: string;
};

/**
 * Engine IR descriptor. Carries the id, label and src only. Fetching and
 * resampling the taps belongs to a later task (the IR worker owns IrTaps).
 */
export type IrDescriptor = {
	readonly id: string;
	readonly label: string;
	readonly src: string;
};

/** One circuit control reported by the engine. */
export interface PlayerControlInfo {
	readonly id: string;
	readonly label: string;
	readonly value: number;
	readonly min: number;
	readonly max: number;
}

/**
 * Opaque telemetry payload passed through from the engine. The shell
 * stores the latest value for display and never interprets it. Real
 * telemetry display belongs to the audio cutover task.
 */
export type PlayerTelemetry = Readonly<Record<string, number>>;

/** Closed controller state union. Compared as whole values. */
export type PlayerState =
	| "idle"
	| "loading"
	| "ready"
	| "playing"
	| "fallback"
	| "error";

/**
 * Closed controller error reasons. Compared as whole values; never match
 * the message text. Meanings:
 * no-engine: no engine factory was registered, so there is no audio path.
 * engine-unavailable: the factory refused with a typed capability reason.
 * not-ready: the controller is not in ready or playing state for this call.
 * unknown-input, unknown-nam, unknown-ir, unknown-control: the id is not
 * one of the offered choices or reported controls.
 * invalid-control-value: the control value is not a finite number.
 * load-failed: the engine load call threw or rejected.
 * engine-error: the engine reported an error event mid-stream.
 * disposed: the controller was disposed; create a new one.
 */
export type PlayerErrorReason =
	| "no-engine"
	| "engine-unavailable"
	| "not-ready"
	| "unknown-input"
	| "unknown-nam"
	| "unknown-ir"
	| "unknown-control"
	| "invalid-control-value"
	| "load-failed"
	| "engine-error"
	| "disposed";

/** Typed controller and engine error with a display message. */
export class PlayerError extends Error {
	readonly reason: PlayerErrorReason;

	constructor(reason: PlayerErrorReason, message: string) {
		super(message);
		this.name = "PlayerError";
		this.reason = reason;
	}
}

/**
 * Closed reasons a factory can report when it cannot supply an engine.
 * no-webassembly: WebAssembly is unavailable in this browser.
 * no-audioworklet: AudioWorklet is unavailable in this browser.
 */
export type EngineUnavailableReason = "no-webassembly" | "no-audioworklet";

/** Engine event names. Payloads: ready has none, controls carries the
 * control list, error carries a PlayerError, telemetry is opaque. */
export type PlayerEngineEventName = "ready" | "controls" | "error" | "telemetry";

/**
 * The engine seam. There is no real engine in this task; tests and the
 * browser smoke page register fakes with setEngineFactory. Real-time
 * audio on WebAssembly in an AudioWorklet is explicitly out of scope.
 *
 * The event listener takes an untyped payload on purpose so fakes stay
 * one method: ready carries none, controls carries
 * readonly PlayerControlInfo[], error carries PlayerError, telemetry
 * carries PlayerTelemetry.
 */
export interface PlayerEngine {
	load(source: { readonly vdsp: string }): void | Promise<void>;
	start(): void | Promise<void>;
	stop(): void | Promise<void>;
	setControl(id: string, value: number): void;
	setInput(choice: InputChoiceDescriptor): void;
	setNam(model: NamDescriptor | null): void;
	setIr(ir: IrDescriptor | null): void;
	dispose(): void;
	// biome-ignore lint/suspicious/noExplicitAny: fakes implement one method for all four events.
	on(event: PlayerEngineEventName, listener: (payload?: any) => void): () => void;
}

/**
 * Factory result: either a usable engine or a typed capability refusal.
 * The refusal (not a throw) is what drives the mp3 fallback path.
 */
export type EngineFactoryResult =
	| { readonly ok: true; readonly engine: PlayerEngine }
	| { readonly ok: false; readonly reason: EngineUnavailableReason };

/** Registers the engine for this page. Called once by later tasks. */
export type PlayerEngineFactory = () => EngineFactoryResult;

/** Controller event names. Payloads: statechange carries the new
 * PlayerState, ready carries none, error carries a PlayerError,
 * selection carries a PlayerSelection. */
export type PlayerControllerEventName =
	| "statechange"
	| "ready"
	| "error"
	| "selection";

/** Emitted whenever selectInput, selectNam or selectIr changes state. */
export interface PlayerSelection {
	readonly kind: "input" | "nam" | "ir";
	readonly id: string | null;
}

/**
 * The built-in input choice. Always present in controller.inputChoices,
 * even when the blog supplies no inputs. Label is plain prose.
 */
export const BROWSER_AUDIO_INPUT: BrowserAudioDescriptor = {
	kind: "browser",
	id: "browser-audio",
	label: "Browser audio",
};
