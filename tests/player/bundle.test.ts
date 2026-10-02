// The player is installed by a Next.js site and bundled for a browser. A bundler resolves every
// module it can reach from the package entry, so one unresolvable import anywhere in the graph
// fails the consumer's build, even if that code never runs. This test bundles the player the way
// a consumer's bundler would and asserts that the build succeeds.
//
// History: the IR module imported its resampler from the chain barrel, which reaches the runtime,
// whose WebAssembly wrapper imports a build artifact that is not in the repository or the package
// ("../../build/v2_dsp.cjs"). The bundle failed with "Could not resolve". The player now imports
// the pure resampler through a chain subpath and its graph contains no runtime or compiler code.

import { describe, expect, test } from "bun:test";

describe("player browser bundle", () => {
	test("bundles for a browser with no unresolved imports", async () => {
		const result = await Bun.build({
			entrypoints: ["packages/player/src/index.ts"],
			target: "browser",
			format: "esm",
			throw: false,
		});
		const messages = result.logs.map((log) => String(log.message));
		expect({ success: result.success, messages }).toEqual({ success: true, messages: [] });
	});

	test("the bundle does not contain the compiler or the runtime", async () => {
		const result = await Bun.build({
			entrypoints: ["packages/player/src/index.ts"],
			target: "browser",
			format: "esm",
			throw: false,
		});
		expect(result.success).toBe(true);
		const text = await result.outputs[0]!.text();
		// Distinctive names from each package; a player that only loads, checks and lists
		// sources has no reason to carry any of them.
		expect(text.includes("ReferenceRuntime")).toBe(false);
		expect(text.includes("resolveSupplyStamps")).toBe(false);
		expect(text.includes("V2WasmEngine")).toBe(false);
	});
});
