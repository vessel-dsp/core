// Opt-in registration for the real player engine.
//
// Separate subpath (`@vessel-dsp/player/engine`), never the main barrel:
// the main barrel stays SSR-safe and browser-bundle-lean (guarded by
// `tests/player/bundle.test.ts`), while this module pulls the compiler, the
// runtime, and the chain NAM boundary -- the real audio path, loaded only
// when the page opts in. Importing this module is still side-effect-free:
// it reads no browser global until the factory runs, and the factory
// itself creates no `AudioContext` and fetches nothing.

import { setEngineFactory } from "./factory.js";
import { RealPlayerEngine, type RealPlayerEngineOptions } from "./player-engine.js";
import { playerWorkletProcessorName } from "./processor-name.js";

export type RegisterPlayerEngineOptions = RealPlayerEngineOptions & {
	/**
	 * Host hook receiving each created engine (one per controller). The
	 * proof page uses it to read the analyser and telemetry; a blog can
	 * use it for meters. Never called before a controller needs an engine.
	 */
	readonly onEngine?: (engine: RealPlayerEngine) => void;
};

export { RealPlayerEngine, playerWorkletProcessorName };
export type { RealPlayerEngineOptions };

function capabilities(): { ok: true } | { ok: false; reason: "no-webassembly" | "no-audioworklet" } {
	const globals = globalThis as Record<string, unknown>;
	if (typeof globals.WebAssembly !== "object" || globals.WebAssembly === null) {
		return { ok: false, reason: "no-webassembly" };
	}
	const audioContext =
		globals.AudioContext ?? (globals as Record<string, unknown>).webkitAudioContext;
	if (typeof audioContext !== "function") {
		return { ok: false, reason: "no-audioworklet" };
	}
	return { ok: true };
}

/**
 * Register the real engine factory for this page. Call once, typically in
 * the page script after importing the element. The factory checks
 * capabilities when a controller needs an engine (not here, so importing
 * and registering stay gesture-free and SSR-safe) and refuses with a typed
 * reason -- `no-webassembly` or `no-audioworklet` -- that drives the mp3
 * fallback path. Every URL override is independent; unset entries resolve
 * against the package's own shipped files via `import.meta.url`.
 */
export function registerPlayerEngine(options: RegisterPlayerEngineOptions = {}): void {
	setEngineFactory(() => {
		const available = capabilities();
		if (!available.ok) {
			return { ok: false, reason: available.reason };
		}
		const engine = new RealPlayerEngine(options);
		options.onEngine?.(engine);
		return { ok: true, engine };
	});
}
