// Default asset URLs for the real player engine.
//
// All three files ship inside `@vessel-dsp/player` itself (see
// `scripts/build-player-worklet.ts`, which bundles the worklet and copies
// both wasm binaries into `dist/`), so the defaults resolve relative to
// THIS module's `import.meta.url` and work from `node_modules` without a
// bundler rewrite. A host that pins or CDN-hosts its assets (notably a
// Next.js static export, where `node_modules` is not served) copies the
// files to its public dir and passes the `*Url` overrides instead; see the
// player README. Every override is optional and independent.

export type PlayerAssetUrls = {
	readonly workletUrl?: string;
	readonly dspWasmUrl?: string;
	readonly namWasmUrl?: string;
	readonly namGlueUrl?: string;
};

export type ResolvedPlayerAssetUrls = {
	readonly workletUrl: string;
	readonly dspWasmUrl: string;
	readonly namWasmUrl: string;
	readonly namGlueUrl: string;
};

// Basename lookups, so a bundler that rewrites `import.meta.url` to a blob
// or chunk URL still resolves: only the directory is taken from the module.
function siblingOf(moduleUrl: string, file: string): string {
	const base = moduleUrl.slice(0, moduleUrl.lastIndexOf("/") + 1);
	return `${base}${file}`;
}

export function resolvePlayerAssetUrls(
	overrides: PlayerAssetUrls | undefined,
	moduleUrl: string,
): ResolvedPlayerAssetUrls {
	return {
		workletUrl: overrides?.workletUrl ?? siblingOf(moduleUrl, "../worklet/player-worklet.js"),
		dspWasmUrl: overrides?.dspWasmUrl ?? siblingOf(moduleUrl, "../wasm/v2_dsp.wasm"),
		namWasmUrl: overrides?.namWasmUrl ?? siblingOf(moduleUrl, "../wasm/nam-engine.wasm"),
		namGlueUrl: overrides?.namGlueUrl ?? siblingOf(moduleUrl, "../wasm/nam-engine-glue.js"),
	};
}
