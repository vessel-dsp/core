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
 * unsafe-src: a NAM src failed the same safety check as the source lists.
 * network-or-cors: a NAM fetch rejected, or its body read rejected.
 * http-status: a NAM request answered with a non-ok status; `status`
 *   carries the numeric code.
 * nam-load-failed: the NAM engine refused the model text; the message
 *   carries the engine's own reason verbatim.
 * rate-mismatch: the NAM model states a rate that differs from the context
 *   rate; `expectedSampleRate` and `contextSampleRate` carry both rates.
 * admission-refused: the compiled circuit (plus NAM/IR when selected)
 *   cannot be shown to fit inside the host's real-time budget; the message
 *   names the block and the numbers. Emitted only by the real engine.
 * The last six arrive only through the real engine or the NAM slot adapter.
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
	| "disposed"
	| "unsafe-src"
	| "network-or-cors"
	| "http-status"
  | "nam-load-failed"
  | "rate-mismatch"
  | "admission-refused";

/** Optional typed detail a PlayerError can carry beyond its message. */
export interface PlayerErrorDetail {
	readonly src?: string;
	readonly status?: number;
	readonly expectedSampleRate?: number | null;
	readonly contextSampleRate?: number;
}

/** Typed controller and engine error with a display message. */
export class PlayerError extends Error {
	readonly reason: PlayerErrorReason;
	readonly src?: string;
	readonly status?: number;
	readonly expectedSampleRate?: number | null;
	readonly contextSampleRate?: number;

	constructor(reason: PlayerErrorReason, message: string, detail?: PlayerErrorDetail) {
		super(message);
		this.name = "PlayerError";
		this.reason = reason;
		if (detail?.src !== undefined) {
			this.src = detail.src;
		}
		if (detail?.status !== undefined) {
			this.status = detail.status;
		}
		if (detail?.expectedSampleRate !== undefined) {
			this.expectedSampleRate = detail.expectedSampleRate;
		}
		if (detail?.contextSampleRate !== undefined) {
			this.contextSampleRate = detail.contextSampleRate;
		}
	}
}

/**
 * Duck-type check for a PlayerError from ANOTHER copy of this module.
 * The main barrel and the `/engine` subpath (or two bundles serving them
 * as separate files) each carry their own `PlayerError` class object, so
 * `instanceof` fails across that boundary while the shape stays identical.
 * The reason is membership-checked, so a foreign object with a bogus
 * reason cannot pass. Prefer this (or `playerErrorMessage`) wherever an
 * error crosses bundles.
 */
const KNOWN_PLAYER_REASONS: ReadonlySet<string> = new Set([
	"no-engine",
	"engine-unavailable",
	"not-ready",
	"unknown-input",
	"unknown-nam",
	"unknown-ir",
	"unknown-control",
	"invalid-control-value",
	"load-failed",
	"engine-error",
	"disposed",
	"unsafe-src",
	"network-or-cors",
	"http-status",
	"nam-load-failed",
	"rate-mismatch",
	"admission-refused",
]);

export function isPlayerError(value: unknown): value is PlayerError {
	if (value instanceof PlayerError) {
		return true;
	}
	if (value === null || typeof value !== "object") {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		candidate.name === "PlayerError" &&
		typeof candidate.message === "string" &&
		typeof candidate.reason === "string" &&
		KNOWN_PLAYER_REASONS.has(candidate.reason)
	);
}

/** The display message of a (possibly cross-bundle) PlayerError, or a fallback. */
export function playerErrorMessage(value: unknown, fallback: string): string {
	return isPlayerError(value) ? String((value as { message: unknown }).message) : fallback;
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
 * NAM validation deliberately adds no method here: the controller validates
 * through its own optional namLoader (see PlayerController) before calling
 * the existing synchronous setNam, so every fake written against this
 * interface keeps working unchanged. The real engine arrives in a separate
 * task and can keep calling setNam exactly as today.
 *
 * The event listener takes an untyped payload on purpose so fakes stay
 * one method: ready carries none, controls carries
 * readonly PlayerControlInfo[], error carries PlayerError, telemetry
 * carries PlayerTelemetry.
 */
export interface PlayerEngine {
	/**
	 * Load a circuit. `program` carries an optional precompiled Program
	 * (object or JSON text) that skips fetching and compiling `vdsp`;
	 * engines that predate the field ignore it.
	 */
	load(source: { readonly vdsp: string; readonly program?: unknown }): void | Promise<void>;
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
