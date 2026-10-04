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

// An actual module edge to the glue (static or dynamic), not a bare mention
// in a comment: `from "@vessel-dsp/runtime/wasm/..."`, `import("...v2_dsp...")`.
const GLUE_EDGE = /(from\s+["'][^"']*v2_dsp[^"']*["'])|(import\s*\(\s*["'][^"']*v2_dsp[^"']*["']\s*\))/;

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

	test("no page-bundle source imports the node-flavoured wasm glue", async () => {
		// A consumer bundler (Next/Turbopack/webpack) hard-fails on the
		// Emscripten glue's node-only branch (`require("node:fs")` inside
		// v2_dsp.cjs): "Can't resolve 'fs'". The decisive admission cost is
		// timed INSIDE the player worklet -- which bundles the glue
		// statically with that branch stubbed and ships as a file loaded by
		// URL -- so nothing the page bundle sees may reach the glue file,
		// statically or dynamically. The worklet source itself is the one
		// exception: it is a separate esbuild entry (never part of a page
		// bundle) whose no-external-imports assertion pins the stub.
		// (Why a source grep and not a strict browser bundle: esbuild does
		// not prune the runtime/chain barrels' unused glue edge the way
		// Turbopack/webpack do under sideEffects:false -- verified, an entry
		// importing only { admissionVerdict } from the runtime dist still
		// fails under esbuild. The end-to-end proof is
		// packages/player/scripts/next-bundle-proof.ts: a real `next build`
		// plus a grep for v2_dsp in the client chunks.)
		const glob = new Bun.Glob("packages/player/src/**/*.ts");
		const offenders: string[] = [];
		for await (const path of glob.scan({ cwd: "." })) {
			if (path === "packages/player/src/engine/worklet/player-worklet.ts") {
				continue;
			}
			const text = await Bun.file(path).text();
			if (GLUE_EDGE.test(text)) {
				offenders.push(path);
			}
		}
		expect(offenders).toEqual([]);
	});
});
