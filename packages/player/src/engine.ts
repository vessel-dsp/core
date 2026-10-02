// Engine factory registry. Module-level on purpose: the page registers
// one factory and every controller on the page uses it. DOM-free.

import type {
	EngineFactoryResult,
	PlayerEngineFactory,
} from "./types.js";

let factory: PlayerEngineFactory | null = null;

/**
 * Register the engine factory for this page. Pass null to unregister
 * (tests use this to simulate a page with no audio path). There is no
 * real engine in this task, so production pages leave this unset and the
 * controller takes the fallback path.
 */
export function setEngineFactory(next: PlayerEngineFactory | null): void {
	factory = next;
}

/** Read the registered factory, or null when none is registered. */
export function getEngineFactory(): PlayerEngineFactory | null {
	return factory;
}

/** Build one engine attempt for a new controller. */
export function createEngineAttempt(): EngineFactoryResult | { readonly ok: false; readonly noFactory: true } {
	if (factory === null) {
		return { ok: false, noFactory: true as const };
	}
	return factory();
}
