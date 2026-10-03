// Bundles `src/engine/worklet/player-worklet.ts` into
// `dist/worklet/player-worklet.js`: one self-contained file with no external
// imports, loadable via `audioContext.audioWorklet.addModule(workletUrl)`.
//
// Both Emscripten glues are bundled statically: the v2 DSP console glue
// (from the runtime's published `./wasm/v2_dsp.cjs` subpath) and the NAM
// inference glue (from the chain's published `./nam-engine.js` file). Both
// `.wasm` binaries are NOT in the bundle -- the worklet scope cannot fetch,
// so the page posts their bytes in the `load` message (dsp) and per `nam`
// slot (NAM), and `scripts` copies them into `dist/wasm/` below so the
// player ships all three files itself (design §5).
//
// The NAM glue contains `import.meta.url` (its node-loader fallback path,
// never executed here because bytes are always passed in). A worklet scope
// has no module URL to give it, so the value is defined to a constant at
// build time; the DSP glue's node builtins get the same stub treatment as
// the runtime's own bundle.
//
// Usage: bun scripts/build-player-worklet.ts [--out=dist/worklet/player-worklet.js]
// Run after the runtime, chain, and compiler builds (their dist output is
// bundled in). Wired into the package `build` script.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name: string): string | undefined =>
	process.argv
		.find((candidate) => candidate.startsWith(`--${name}=`))
		?.slice(name.length + 3);

const entry = resolve(packageRoot, "src/engine/worklet/player-worklet.ts");
const out = resolve(packageRoot, argument("out") ?? "dist/worklet/player-worklet.js");

const dspGlue = resolve(packageRoot, "../runtime/dist/wasm/v2_dsp.cjs");
const dspWasm = resolve(packageRoot, "../runtime/dist/wasm/v2_dsp.wasm");
const namGlue = resolve(packageRoot, "../chain/nam-engine/nam-engine.js");
const namWasm = resolve(packageRoot, "../chain/nam-engine/nam-engine.wasm");

for (const [label, path] of [
	["v2 DSP glue", dspGlue],
	["v2 DSP wasm", dspWasm],
	["NAM glue", namGlue],
	["NAM wasm", namWasm],
] as const) {
	if (!existsSync(path)) {
		console.error(
			`build-player-worklet: ${label} is absent at ${path}: build the runtime (with build:wasm) and chain first.`,
		);
		process.exit(1);
	}
}

// The Emscripten DSP glue `require`s `fs`/`path` inside its
// `ENVIRONMENT_IS_NODE` branch, which never runs in an
// AudioWorkletGlobalScope. Same stub treatment as the runtime's bundle:
// resolve the builtins to a stub that throws if ever called.
const nodeBuiltinsStub: Plugin = {
	name: "vessel-node-builtins-stub",
	setup(buildStep) {
		buildStep.onResolve({ filter: /^(node:)?(fs|path)$/ }, (args) => ({
			path: args.path,
			namespace: "vessel-node-builtins-stub",
		}));
		buildStep.onLoad(
			{ filter: /.*/, namespace: "vessel-node-builtins-stub" },
			(args) => ({
				contents: `throw new Error("node builtin '${args.path}' is unavailable in the worklet bundle");`,
				loader: "js",
			}),
		);
	},
};

await build({
	entryPoints: [entry],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	minify: false,
	sourcemap: false,
	outfile: out,
	// Pin the two glue files to their published/vendored paths so tsconfig
	// `paths` (source-tree joins) cannot redirect the bundler at them.
	alias: {
		"@vessel-dsp/runtime/wasm/v2_dsp.cjs": dspGlue,
		"@vessel-dsp/chain/nam-engine.js": namGlue,
	},
	// The NAM glue reads `import.meta.url` for its fetch fallback; this
	// scope always receives bytes instead, so the value is a constant.
	define: { "import.meta.url": '"file://player-worklet.js"' },
	plugins: [nodeBuiltinsStub],
	logLevel: "warning",
});

// Deliverable contract, enforced rather than eyeballed: a single file with
// no external imports (an AudioWorkletGlobalScope has no resolver),
// registering the player processor name, with no module syntax that a
// classic worklet script cannot parse and no bare `import.meta` left.
mkdirSync(dirname(out), { recursive: true });
const bundled = readFileSync(out, "utf8");
const failures: string[] = [];
if (/^\s*import\s/m.test(bundled) || /[^.]require\(\s*["']/.test(bundled)) {
	failures.push("bundle contains an external import/require");
}
if (/^\s*export\s/m.test(bundled)) {
	failures.push("bundle contains an export statement");
}
if (/\bimport\.meta\b/.test(bundled)) {
	failures.push("bundle contains import.meta");
}
if (!bundled.includes("vessel-player-processor")) {
	failures.push("bundle does not register vessel-player-processor");
}
if (!bundled.includes("_nam_process") || !bundled.includes("_v2_engine_process_internal")) {
	failures.push("bundle is missing the NAM or v2 DSP engine entry points");
}
if (failures.length > 0) {
	console.error(`build-player-worklet: ${failures.join("; ")}: ${out}`);
	process.exit(1);
}
// The `tsc` build step also emits its own unbundled worklet sources into
// `dist/engine/worklet/`; leave them (they are the published types), but
// remove stale maps beside the bundle if tsc wrote any.
for (const sidecar of ["player-worklet.js.map"]) {
	rmSync(resolve(dirname(out), sidecar), { force: true });
}
console.log(`build-player-worklet: wrote ${out} (${bundled.length} bytes, no external imports)`);

// The player serves three files itself (design §5): the worklet bundle
// above plus both wasm binaries, copied from the packages that build them.
const wasmDir = resolve(packageRoot, "dist/wasm");
mkdirSync(wasmDir, { recursive: true });
copyFileSync(dspWasm, resolve(wasmDir, "v2_dsp.wasm"));
copyFileSync(namWasm, resolve(wasmDir, "nam-engine.wasm"));
// The main-thread NAM probe dynamic-imports the glue by URL (no import map
// needed), so the glue ships beside the binaries under the same export.
copyFileSync(namGlue, resolve(wasmDir, "nam-engine-glue.js"));
console.log(
	`build-player-worklet: staged dist/wasm/ (${readFileSync(resolve(wasmDir, "v2_dsp.wasm")).length} + ${readFileSync(resolve(wasmDir, "nam-engine.wasm")).length} wasm bytes)`,
);
