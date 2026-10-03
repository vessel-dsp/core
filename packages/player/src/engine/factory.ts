// Engine factory registry. Page-level on purpose: the page registers one
// factory and every controller on the page uses it. DOM-free.
//
// The slot lives on `globalThis` under a shared symbol rather than in
// module state, so every copy of this module on the page (the main barrel
// and the `@vessel-dsp/player/engine` subpath, which a bundler may wrap
// separately, or two bundles served as separate files) reads and writes the
// same registration. Last registration wins; unregistering removes it.

import type {
	EngineFactoryResult,
	PlayerEngineFactory,
} from "../types.js";

const FACTORY_KEY = Symbol.for("@vessel-dsp/player/engine-factory");

type FactoryHolder = {
	[FACTORY_KEY]?: PlayerEngineFactory | null;
};

function holder(): FactoryHolder {
	return globalThis as unknown as FactoryHolder;
}

/**
 * Register the engine factory for this page. Pass null to unregister
 * (tests use this to simulate a page with no audio path). Without a
 * registered factory the controller takes the fallback path.
 */
export function setEngineFactory(next: PlayerEngineFactory | null): void {
	if (next === null) {
		delete holder()[FACTORY_KEY];
		return;
	}
	holder()[FACTORY_KEY] = next;
}

/** Read the registered factory, or null when none is registered. */
export function getEngineFactory(): PlayerEngineFactory | null {
	return holder()[FACTORY_KEY] ?? null;
}

/** Build one engine attempt for a new controller. */
export function createEngineAttempt(): EngineFactoryResult | { readonly ok: false; readonly noFactory: true } {
	const factory = getEngineFactory();
	if (factory === null) {
		return { ok: false, noFactory: true as const };
	}
	return factory();
}
