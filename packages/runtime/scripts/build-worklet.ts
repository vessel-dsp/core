// Bundles `src/worklet/v2-audio-worklet.ts` into
// `dist/worklet/v2-audio-worklet.js`: one self-contained ESM file with no external
// imports, loadable via `audioContext.audioWorklet.addModule(workletUrl)`.
//
// The Emscripten glue (`src/wasm/v2_dsp.cjs`, written by `scripts/build-wasm.sh`) is
// bundled statically; the wasm binary itself is NOT in the bundle -- the worklet
// scope cannot fetch, so the host posts the bytes in the `load` message and the
// bundle's `instantiateWasm` hook feeds them in.
//
// Run after `build:wasm` (the glue must exist). Wired into the package `build`
// script after the `src/wasm` -> `dist/wasm` copy, so `prepack` ships both.
//
// Usage: bun scripts/build-worklet.ts [--out=dist/worklet/v2-audio-worklet.js]

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argument = (name: string): string | undefined =>
	process.argv
		.find((candidate) => candidate.startsWith(`--${name}=`))
		?.slice(name.length + 3);

const entry = resolve(packageRoot, "src/worklet/v2-audio-worklet.ts");
const out = resolve(packageRoot, argument("out") ?? "dist/worklet/v2-audio-worklet.js");

// The Emscripten glue `require`s `fs`/`path` inside its `ENVIRONMENT_IS_NODE`
// branch, which never runs in an AudioWorkletGlobalScope (and `instantiateWasm`
// bypasses the glue's own file loading entirely). The workbench's Vite bundle
// drops that branch; esbuild needs the same treatment spelled out: resolve the
// builtins to a stub that throws if ever called, so the bundle keeps zero
// external imports instead of gaining `import "fs"`.
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

const glue = resolve(packageRoot, "src/wasm/v2_dsp.cjs");
try {
	readFileSync(glue);
} catch {
	console.error(
		`build-worklet: ${glue} is absent: run \`bun run build:wasm\` first (the glue is bundled, the .wasm is posted as bytes).`,
	);
	process.exit(1);
}

await build({
	entryPoints: [entry],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	minify: false,
	sourcemap: false,
	outfile: out,
	plugins: [nodeBuiltinsStub],
	logLevel: "warning",
});

// Deliverable contract, enforced rather than eyeballed: a single file with no
// external imports (an AudioWorkletGlobalScope has no resolver), registering
// the processor name the protocol advertises.
mkdirSync(dirname(out), { recursive: true });
const bundled = readFileSync(out, "utf8");
const failures: string[] = [];
if (/^\s*import\s/m.test(bundled) || /[^.]require\(\s*["']/.test(bundled)) {
	failures.push("bundle contains an external import/require");
}
if (!bundled.includes("v2-pedal-processor")) {
	failures.push("bundle does not register v2-pedal-processor");
}
if (failures.length > 0) {
	console.error(`build-worklet: ${failures.join("; ")}: ${out}`);
	process.exit(1);
}
// The `tsc` build step also emits its own unbundled `v2-audio-worklet.js` plus
// stale maps/types into `dist/worklet/`; the bundle above replaced the `.js`,
// so remove its orphaned sidecars. The protocol's own `tsc` output stays: it is
// the real compiled helper hosts import for the message types.
for (const sidecar of ["v2-audio-worklet.d.ts", "v2-audio-worklet.d.ts.map", "v2-audio-worklet.js.map"]) {
	rmSync(resolve(dirname(out), sidecar), { force: true });
}
console.log(`build-worklet: wrote ${out} (${bundled.length} bytes, no external imports)`);
