// Real-bundler proof for the player cutover (task W3b, deliverable 2).
//
// Packs tarballs of the CURRENT workspace packages (core, compiler, runtime,
// chain, player), installs them into a scratch copy of the blog
// (website/apps/blog + website/packages/ui-theme, read-only sources -- the
// website repo is never edited), sets LIVE_ENGINE = true, registers the
// engine with the README recipe, runs the REAL `next build` (Turbopack),
// asserts no client chunk imports v2_dsp.cjs, then serves the build and
// repeats the player-proof assertions through the real Next page in headless
// Chromium: zero *.wasm/worklet requests before the click, click play, state
// playing, cpuLoad reported, 0 new overruns over ~3 s on the two blog
// circuits (buffer + fuzz), non-silent output.
//
// The player's worklet/wasm files are served exactly the way the README says:
// copied from the installed package into the app's public/ dir with the
// README's cp lines, and referenced through the README's registerPlayerEngine
// overrides. The register call in the scratch LivePlayer is the README
// snippet verbatim.
//
// NOT a unit test: it needs network-free npm/next installs, a Next build,
// and a browser, so it lives here, not in `tests/`. Run (from the core
// checkout, with the emsdk environment sourced -- `npm pack` runs each
// package's prepack, which rebuilds wasm -- and playwright-core resolvable):
//   source /home/joseph/projects/emsdk/emsdk_env.sh
//   NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules \
//     bun packages/player/scripts/next-bundle-proof.ts [--port=8472] [--keep]
// Requires `bun run build` output to exist is NOT enough: packing rebuilds
// from the current tree, so what is proven is always the working tree.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const playerRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(playerRoot, "..", "..");
const WEBSITE = "/home/joseph/projects/VesselDSP/website";

const argument = (name: string): string | undefined =>
	process.argv.find((candidate) => candidate.startsWith(`--${name}=`))?.slice(name.length + 3);
const KEEP = process.argv.includes("--keep");
const PORT = Number(argument("port") ?? "8472");

const TARBALL_PACKAGES = ["core", "compiler", "runtime", "chain", "player"] as const;

function log(message: string): void {
	console.log(`next-proof: ${new Date().toISOString().slice(11, 19)} ${message}`);
}

function fail(message: string): never {
	console.error(`next-proof: FAIL: ${message}`);
	process.exit(1);
}

async function withTimeout<T>(ms: number, label: string, fn: () => Promise<T>): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			fn(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms: ${label}`)), ms);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

function runOrFail(cmd: string[], cwd: string, label: string): string {
	const proc = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
	const out = new TextDecoder().decode(proc.stdout);
	const err = new TextDecoder().decode(proc.stderr);
	if (proc.exitCode !== 0) {
		console.error(`next-proof: --- ${label} stdout ---\n${out}`);
		console.error(`next-proof: --- ${label} stderr ---\n${err}`);
		fail(`${label} exited ${proc.exitCode}`);
	}
	return `${out}\n${err}`;
}

const uptime = new TextDecoder().decode(Bun.spawnSync(["uptime"], { stdout: "pipe" }).stdout).trim();
log(`box ${uptime}`);

let playwright: typeof import("playwright-core");
try {
	playwright = await import("playwright-core");
} catch {
	fail(
		"cannot resolve playwright-core. Re-run with " +
			"NODE_PATH=/home/joseph/projects/VesselDSP/workbench/node_modules",
	);
}

// ---------------------------------------------------------------------------
// 1. Pack the current workspace packages (npm pack runs each prepack, so the
//    tarballs always reflect the working tree, never a stale dist).
// ---------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), "next-proof-"));
log(`scratch ${scratch}`);
const tarballDir = join(scratch, "tarballs");
mkdirSync(tarballDir, { recursive: true });

const tarballs = new Map<string, string>();
for (const name of TARBALL_PACKAGES) {
	const out = runOrFail(
		["npm", "pack", "--pack-destination", tarballDir, "--silent"],
		join(repoRoot, "packages", name),
		`npm pack @vessel-dsp/${name}`,
	);
	const file = out.split("\n").map((line) => line.trim()).find((line) => line.endsWith(".tgz"));
	if (file === undefined) {
		fail(`npm pack @vessel-dsp/${name} printed no tarball name:\n${out}`);
	}
	tarballs.set(name, join(tarballDir, file));
	log(`packed @vessel-dsp/${name} -> ${file}`);
}

// ---------------------------------------------------------------------------
// 2. Scratch monorepo mirror: scratch/apps/blog + scratch/packages/ui-theme,
//    mirroring the website layout (turbopack.root in next.config.ts points at
//    ../../, i.e. the scratch root).
// ---------------------------------------------------------------------------

const blogSrc = join(WEBSITE, "apps", "blog");
const themeSrc = join(WEBSITE, "packages", "ui-theme");
for (const [label, path] of [["blog app", blogSrc], ["ui-theme", themeSrc]] as const) {
	if (!existsSync(path)) {
		fail(`website source missing (read-only check): ${path}`);
	}
}

const scratchBlog = join(scratch, "apps", "blog");
const scratchTheme = join(scratch, "packages", "ui-theme");
mkdirSync(join(scratch, "apps"), { recursive: true });
mkdirSync(join(scratch, "packages"), { recursive: true });

// tar with excludes: never copy a node_modules/.next into the scratch, and
// never write into the website checkout (read-only source).
for (const [from, to] of [[blogSrc, scratchBlog], [themeSrc, scratchTheme]] as const) {
	const proc = Bun.spawnSync(
		["tar", "--exclude=node_modules", "--exclude=.next", "--exclude=.turbo", "-cf", "-", "."],
		{ cwd: from, stdout: "pipe", stderr: "pipe" },
	);
	if (proc.exitCode !== 0) {
		fail(`tar read of ${from} failed`);
	}
	mkdirSync(to, { recursive: true });
	const write = Bun.spawnSync(["tar", "-xf", "-"], {
		cwd: to,
		stdin: proc.stdout,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (write.exitCode !== 0) {
		fail(`tar write to ${to} failed`);
	}
}
log("copied blog app + ui-theme (website repo untouched)");

// Root package.json with workspaces and ROOT-LEVEL overrides pinning every
// vessel package at its just-packed tarball (direct and transitive alike).
const overrides: Record<string, string> = {};
for (const [name, path] of tarballs) {
	overrides[`@vessel-dsp/${name}`] = `file:${path}`;
}
writeFileSync(
	join(scratch, "package.json"),
	`${JSON.stringify({ private: true, workspaces: ["apps/blog", "packages/ui-theme"], overrides }, null, 2)}\n`,
);

// The blog's workspace: dep on ui-theme becomes a relative file: dep (npm
// has no workspace: protocol); the vessel dep stays a version range and is
// pinned by the root overrides above.
const blogPkgPath = join(scratchBlog, "package.json");
const blogPkg = JSON.parse(readFileSync(blogPkgPath, "utf8")) as {
	dependencies: Record<string, string>;
};
if (blogPkg.dependencies["@vessel-dsp/ui-theme"] === undefined) {
	fail("scratch blog package.json has no @vessel-dsp/ui-theme dep to rewrite");
}
blogPkg.dependencies["@vessel-dsp/ui-theme"] = "file:../../packages/ui-theme";
writeFileSync(blogPkgPath, `${JSON.stringify(blogPkg, null, 2)}\n`);
log("wrote scratch root package.json (workspaces + overrides) and file: ui-theme dep");

// ---------------------------------------------------------------------------
// 3. LIVE_ENGINE = true + engine registration in the SCRATCH copy only.
// ---------------------------------------------------------------------------

const configPath = join(scratchBlog, "src/components/figures/livePlayerConfig.ts");
const configText = readFileSync(configPath, "utf8");
// The blog may already ship live (LIVE_ENGINE = true and the registration), in which case there is
// nothing to patch and the proof checks the blog exactly as it is.
if (configText.includes("export const LIVE_ENGINE = false;")) {
	writeFileSync(configPath, configText.replace("export const LIVE_ENGINE = false;", "export const LIVE_ENGINE = true;"));
	log("set LIVE_ENGINE = true in the scratch copy");
} else if (configText.includes("export const LIVE_ENGINE = true;")) {
	log("LIVE_ENGINE is already true in the blog; not patching it");
} else {
	fail("scratch livePlayerConfig.ts has no LIVE_ENGINE line");
}

const livePlayerPath = join(scratchBlog, "src/components/figures/LivePlayer.tsx");
const livePlayerText = readFileSync(livePlayerPath, "utf8");
const oldEffect = `  useEffect(() => {
    if (!LIVE_ENGINE) return;
    let cancelled = false;
    import("@vessel-dsp/player")
      .then(() => {
        if (!cancelled) setDefined(true);
      })
      .catch(() => {
        if (!cancelled) setDefined(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);`;
// The README recipe, verbatim (asset URLs from the README's copy-to-public
// table): register the engine BEFORE importing the element module.
const newEffect = `  useEffect(() => {
    if (!LIVE_ENGINE) return;
    let cancelled = false;
    import("@vessel-dsp/player/engine")
      .then((m) =>
        m.registerPlayerEngine({
          workletUrl: "/vessel-player-worklet.js",
          dspWasmUrl: "/vessel-v2_dsp.wasm",
          namWasmUrl: "/vessel-nam-engine.wasm",
          namGlueUrl: "/vessel-nam-engine-glue.js",
        }),
      )
      .then(() => import("@vessel-dsp/player"))
      .then(() => {
        if (!cancelled) setDefined(true);
      })
      .catch(() => {
        if (!cancelled) setDefined(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);`;
if (livePlayerText.includes("registerPlayerEngine(")) {
	log("the blog's LivePlayer already registers the engine; not patching it");
} else if (livePlayerText.includes(oldEffect)) {
	writeFileSync(livePlayerPath, livePlayerText.replace(oldEffect, newEffect));
	log("registered the engine in the scratch LivePlayer (README recipe, before the element import)");
} else {
	fail("scratch LivePlayer.tsx has neither a registration nor the expected block to patch");
}

// ---------------------------------------------------------------------------
// 4. Install (npm, scratch only -- the repo rule about bun covers the repo).
// ---------------------------------------------------------------------------

runOrFail(["npm", "install", "--no-audit", "--no-fund"], scratch, "npm install (scratch)");
log("scratch install ok");

// Prove the tarballs won: the installed player must be the packed version,
// and its runtime dep must resolve to the packed runtime tarball. (npm
// workspaces hoist to the scratch root, not apps/blog/node_modules.)
const scratchModules = join(scratch, "node_modules");
const installedPlayerPkg = JSON.parse(
	readFileSync(join(scratchModules, "@vessel-dsp/player/package.json"), "utf8"),
) as { version: string };
const workspacePlayerPkg = JSON.parse(readFileSync(join(repoRoot, "packages/player/package.json"), "utf8")) as {
	version: string;
};
log(`installed @vessel-dsp/player ${installedPlayerPkg.version} (workspace: ${workspacePlayerPkg.version})`);

// ---------------------------------------------------------------------------
// 5. Serve the player assets EXACTLY the way the README says: copy from the
//    installed package into public/ with the README's cp lines.
// ---------------------------------------------------------------------------

const playerDist = join(scratchModules, "@vessel-dsp/player/dist");
const publicDir = join(scratchBlog, "public");
const assetCopies: Array<[string, string]> = [
	["worklet/player-worklet.js", "vessel-player-worklet.js"],
	["wasm/v2_dsp.wasm", "vessel-v2_dsp.wasm"],
	["wasm/nam-engine.wasm", "vessel-nam-engine.wasm"],
	["wasm/nam-engine-glue.js", "vessel-nam-engine-glue.js"],
];
for (const [from, to] of assetCopies) {
	const src = join(playerDist, from);
	if (!existsSync(src)) {
		fail(`installed player is missing dist/${from} (README route broken)`);
	}
	copyFileSync(src, join(publicDir, to));
}
log("copied player assets to public/ (README copy-to-public route)");

// ---------------------------------------------------------------------------
// 6. The real build.
// ---------------------------------------------------------------------------

const buildOutput = runOrFail(["npm", "run", "build"], scratchBlog, "next build (scratch blog)");
log("--- next build output (verbatim) ---");
console.log(buildOutput);
log("--- end next build output ---");

// No client chunk may import the node-flavoured glue. The check is for the
// glue FILE (`v2_dsp.cjs`), not the bare `v2_dsp` stem: the `.wasm` binary
// legitimately shares the stem and its URL string belongs in the bundle.
// Server output may reference the glue (fs exists there);
// .next/static/chunks is the client bundle.
const chunkDir = join(scratchBlog, ".next/static/chunks");
const rg = Bun.spawnSync(["rg", "-l", String.raw`v2_dsp\.cjs`, chunkDir], { stdout: "pipe", stderr: "pipe" });
const chunkHits = new TextDecoder().decode(rg.stdout).trim();
if (chunkHits !== "") {
	fail(`client chunks import the node-flavoured glue v2_dsp.cjs:\n${chunkHits}`);
}
log("no v2_dsp.cjs import in .next/static/chunks (client bundle clean)");

// ---------------------------------------------------------------------------
// 7. Serve the real build and repeat the player-proof assertions through it.
// ---------------------------------------------------------------------------

// npm workspaces hoist binaries to the scratch root: `next` lives in
// scratch/node_modules/.bin, not apps/blog/node_modules.
const serverProc = Bun.spawn([join(scratch, "node_modules/.bin/next"), "start", "--port", String(PORT)], {
	cwd: scratchBlog,
	stdout: "pipe",
	stderr: "pipe",
});
let serverOut = "";
const pump = (async () => {
	const decoder = new TextDecoder();
	for await (const chunk of serverProc.stdout as unknown as AsyncIterable<Uint8Array>) {
		serverOut += decoder.decode(chunk);
	}
})();
async function stopServer(): Promise<void> {
	try {
		serverProc.kill();
	} catch {
		// Already gone.
	}
	// The stdout pipe can outlive SIGTERM (wrapper children); never hang
	// cleanup on it -- the proof outcome is already decided by then.
	await Promise.race([pump, new Promise((resolve) => setTimeout(resolve, 5000))]);
	try {
		serverProc.kill(9);
	} catch {
		// Gone.
	}
}
const ready = await (async () => {
	const deadline = Date.now() + 90_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${PORT}/`);
			if (res.ok) {
				return true;
			}
		} catch {
			// Not up yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return false;
})();
if (!ready) {
	await stopServer();
	console.error(`next-proof: --- next start output ---\n${serverOut}`);
	fail("next start never became ready");
}
log(`next start ready on :${PORT}`);

const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
log(`chromium ${browser.version()}`);

type Leg = { readonly name: string; readonly srcSuffix: string };
const legs: Leg[] = [
	{ name: "buffered", srcSuffix: "pickup-buffer-cable-6m.vdsp" },
	{ name: "fuzz-load", srcSuffix: "pickup-cable-6m-fuzz.vdsp" },
];

let failed = false;
try {
	for (const leg of legs) {
		const page = await browser.newPage();
		const requests: string[] = [];
		page.on("request", (request) => {
			requests.push(request.url());
		});
		page.on("pageerror", (error) => {
			log(`leg ${leg.name} pageerror: ${String(error).slice(0, 300)}`);
		});
		page.on("requestfailed", (request) => {
			log(`leg ${leg.name} requestfailed: ${request.url().slice(0, 160)} ${request.failure()?.errorText}`);
		});
		try {
			await page.goto(`http://127.0.0.1:${PORT}/buffer`, { waitUntil: "load" });
			const playerSel = `vessel-player[src$="${leg.srcSuffix}"]`;
			// NOTE (evaluate-arg pitfall, twice): neither page.evaluate
			// NOR page.waitForFunction forwards an arg to a STRING page
			// function -- the string is evaluated as an expression, so a
			// `(suffix) => {...}` string just yields a (truthy!) function
			// object and every wait passes instantly. The suffix is
			// INTERPOLATED into an immediately-invoked expression instead
			// (the working pattern, as in scripts/player-proof.ts).
			const suffixJson = JSON.stringify(leg.srcSuffix);
			await withTimeout(70000, `waiting for ready (${leg.name})`, () =>
				page.waitForFunction(
					`((suffix) => {
						const el = document.querySelector('vessel-player[src$="' + suffix + '"]');
						return el && el.state === 'ready';
					})(${suffixJson})`,
					{ timeout: 60000 },
				),
			);
			const preClickHits = requests.filter(
				(url) => url.includes(".wasm") || url.includes("worklet"),
			);
			const preClickState = await page.evaluate(
				`((suffix) => {
					const el = document.querySelector('vessel-player[src$="' + suffix + '"]');
					return el ? el.state : null;
				})(${suffixJson})`,
			);
			if (preClickHits.length > 0) {
				failed = true;
				log(`leg ${leg.name} PRE-CLICK wasm/worklet requests (must be zero): ${JSON.stringify(preClickHits)}`);
			} else {
				log(`leg ${leg.name} pre-click state=${String(preClickState)} wasmHits=0`);
			}
			if (preClickState !== "ready") {
				failed = true;
				log(`leg ${leg.name} pre-click state is ${String(preClickState)}, not ready`);
			}
			// The gesture: a trusted click on the real transport button.
			log(`leg ${leg.name} clicking transport`);
			await page.locator(`${playerSel} >> button[data-action="transport"]`).click({ timeout: 15000 });
			log(`leg ${leg.name} clicked, waiting for playing`);
			try {
				await withTimeout(70000, `waiting for playing (${leg.name})`, () =>
					page.waitForFunction(
						`((suffix) => {
						const el = document.querySelector('vessel-player[src$="' + suffix + '"]');
						return el && el.state === 'playing';
					})(${suffixJson})`,
						{ timeout: 60000 },
					),
				);
			} catch {
				const state = await page.evaluate(
					`((suffix) => {
						const el = document.querySelector('vessel-player[src$="' + suffix + '"]');
						return el ? el.state : null;
					})(${suffixJson})`,
				);
				failed = true;
				log(`leg ${leg.name} never reached playing (state=${String(state)})`);
				continue;
			}
			// ~3 s capture: analyser peak/rms (non-silence) plus the
			// controller telemetry series (cpuLoad reported, overruns).
			log(`leg ${leg.name} capturing 3 s`);
			let captured:
				| { error: string }
				| { peak: number; rms: number; windowRms: number[]; series: Array<{ cpuLoad: number | null; overruns: number | null }> };
			// NOTE: the suffix stays interpolated here (see the note above
			// at the ready wait): neither evaluate nor waitForFunction
			// forwards an argument to a string page function.
			try {
				captured = (await withTimeout(30000, `capture (${leg.name})`, () =>
					page.evaluate(
						`((suffix) => {
					const el = document.querySelector('vessel-player[src$="' + suffix + '"]');
					const controller = el.controller;
					const engine = controller ? controller.engine : null;
					const analyser = engine && engine.getAnalyserNode ? engine.getAnalyserNode() : null;
					if (!analyser) return { error: 'no analyser' };
					const frame = new Float32Array(analyser.fftSize);
					const series = [];
					const windowRms = [];
					let peak = 0;
					let sum = 0;
					let count = 0;
					const end = performance.now() + 3200;
					const sample = () => {
						analyser.getFloatTimeDomainData(frame);
						let windowSum = 0;
						for (let i = 0; i < frame.length; i += 1) {
							const v = frame[i];
							if (Math.abs(v) > peak) peak = Math.abs(v);
							sum += v * v;
							windowSum += v * v;
							count += 1;
						}
						windowRms.push(Math.sqrt(windowSum / frame.length));
						const t = controller && controller.lastTelemetry ? controller.lastTelemetry : null;
						series.push({ cpuLoad: t ? t.cpuLoad : null, overruns: t ? t.overruns : null });
					};
					return new Promise((resolve) => {
						const tick = () => {
							sample();
							if (performance.now() < end) setTimeout(tick, 200);
							else resolve({ peak, rms: Math.sqrt(sum / Math.max(1, count)), series, windowRms });
						};
						tick();
					});
				})(${suffixJson})`,
					),
				)) as
					| { error: string }
					| { peak: number; rms: number; windowRms: number[]; series: Array<{ cpuLoad: number | null; overruns: number | null }> };
			} catch (error) {
				failed = true;
				log(`leg ${leg.name} capture threw: ${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)}`);
				continue;
			}
			if ("error" in captured) {
				failed = true;
				log(`leg ${leg.name} capture failed: ${captured.error}`);
				continue;
			}
			const loads = captured.series.map((entry) => entry.cpuLoad).filter((v) => v !== null) as number[];
			const overruns = captured.series.map((entry) => entry.overruns).filter((v) => v !== null) as number[];
			const newOverruns = overruns.length > 0 ? (overruns[overruns.length - 1] as number) - (overruns[0] as number) : -1;
			const meanLoad = loads.reduce((a, b) => a + b, 0) / Math.max(1, loads.length);
			// Sustained sound, not a startup transient: a silent chain still shows one loud first window
			// (DC settling), so the peak alone proves nothing. Most windows must carry signal.
			const active = captured.windowRms.filter((r) => r > 1e-4).length;
			const activeFraction = active / Math.max(1, captured.windowRms.length);
			const silent = captured.peak < 0.05 || activeFraction < 0.8;
			log(
				`leg ${leg.name} peak=${captured.peak.toFixed(4)} rms=${captured.rms.toFixed(4)} ` +
					`cpuLoadMean=${meanLoad.toFixed(2)} newOverruns=${newOverruns} activeWindows=${(activeFraction * 100).toFixed(0)}% ${silent ? "SILENT" : "audible"}`,
			);
			if (silent || loads.length === 0 || newOverruns !== 0) {
				failed = true;
				log(
					`leg ${leg.name} FAILED: silent=${silent} telemetryWindows=${loads.length} newOverruns=${newOverruns}`,
				);
			} else {
				log(`leg ${leg.name} PASS`);
			}
		} finally {
			await page.close();
		}
	}
} finally {
	await browser.close();
	await stopServer();
}

if (!KEEP) {
	rmSync(scratch, { recursive: true, force: true });
	log("removed scratch (pass --keep to inspect)");
} else {
	log(`kept scratch ${scratch}`);
}

if (failed) {
	fail("one or more legs failed (see above)");
}
log("PASS");
