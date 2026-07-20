import { describe, expect, test } from "bun:test";
import {
	VERSION,
	convertCircuitDocumentFileWithReport,
	movePanelElement,
	parseCircuitJsonDocument,
	serializeCircuitJsonDocument,
	validateCircuitJsonDocument,
} from "@vessel-dsp/core";
import {
	applyStompboxPreviewInteraction,
	createStompboxAppearancePatch,
	createDefaultStompboxPedalStateFromVdsp,
	createStompboxControlSurface,
	createStompboxDrillLayoutFromVdsp,
	createStompboxHardwareProfileFromVdsp,
	createStompboxDrillTemplateFromVdsp,
	createStompboxDrillTemplateSvgFromVdsp,
	createStompboxFootswitchPressCommand,
	createStompboxKnobTurnCommand,
	createStompboxPedalStateStore,
	createStompboxPreviewFromVdsp,
	createStompboxPreviewSvgViewsFromVdsp,
	createStompboxPreviewStatePatch,
	resolveStompboxAppearance,
} from "@vessel-dsp/stompbox";
import {
	createStompboxPreviewGlbFromVdsp,
	validateStompboxGlbAssetFile,
	validateStompboxHardwareProfileAssets,
} from "@vessel-dsp/stompbox/node";
import { createAmpProfileFromVdsp, createAmpPreviewLayout } from "@vessel-dsp/amp";
import { createCabinetPreviewLayout } from "@vessel-dsp/cabinet";
import { resolvePreviewEffectPreset } from "@vessel-dsp/visual-effects";
import { fileURLToPath } from "node:url";
import { rewriteRelativeEsmSpecifiers } from "../scripts/fix-dist-imports";

type JsonRecord = Readonly<Record<string, unknown>>;

const removedScopedPackageNames = [
	`@vessel-dsp/${"react" + "-component"}`,
	`@vessel-dsp/${"sim" + "ulation"}`,
] as const;
const removedWorkspacePackageDirs = [
	`packages/${"react" + "-component"}`,
	`packages/${"sim" + "ulation"}`,
] as const;
const CORE_COMPATIBLE_DEPENDENCY_VERSIONS = ["0.6.16"] as const;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<JsonRecord> {
	const value = await Bun.file(new URL(path, import.meta.url)).json();
	if (!isRecord(value)) {
		throw new Error(`${path} did not parse to an object`);
	}
	return value;
}

async function readRootPackageJson(): Promise<JsonRecord> {
	return readJson("../package.json");
}

async function readPackageJson(packageDir: string): Promise<JsonRecord> {
	return readJson(`../packages/${packageDir}/package.json`);
}

async function readPackageTsconfig(packageDir: string): Promise<JsonRecord> {
	return readJson(`../packages/${packageDir}/tsconfig.json`);
}

async function readPackageBuildTsconfig(
	packageDir: string,
): Promise<JsonRecord> {
	return readJson(`../packages/${packageDir}/tsconfig.build.json`);
}

async function readPublishWorkflow(): Promise<string> {
	return Bun.file(
		new URL("../.github/workflows/publish.yml", import.meta.url),
	).text();
}

async function readDeployWorkflow(): Promise<string> {
	return Bun.file(
		new URL("../.github/workflows/deploy.yml", import.meta.url),
	).text();
}

async function readReadme(): Promise<string> {
	return Bun.file(new URL("../README.md", import.meta.url)).text();
}

async function readChangelog(): Promise<string> {
	return Bun.file(new URL("../CHANGELOG.md", import.meta.url)).text();
}

async function readCoreDistIndexJs(): Promise<string> {
	return Bun.file(
		new URL("../packages/core/dist/index.js", import.meta.url),
	).text();
}

async function readCoreDistIndexDts(): Promise<string> {
	return Bun.file(
		new URL("../packages/core/dist/index.d.ts", import.meta.url),
	).text();
}

async function readStompboxDistIndexJs(): Promise<string> {
	return Bun.file(
		new URL("../packages/stompbox/dist/index.js", import.meta.url),
	).text();
}

async function readStompboxDistIndexDts(): Promise<string> {
	return Bun.file(
		new URL("../packages/stompbox/dist/index.d.ts", import.meta.url),
	).text();
}

async function readStompboxDistNodeJs(): Promise<string> {
	return Bun.file(
		new URL("../packages/stompbox/dist/node.js", import.meta.url),
	).text();
}

async function readStompboxDistNodeDts(): Promise<string> {
	return Bun.file(
		new URL("../packages/stompbox/dist/node.d.ts", import.meta.url),
	).text();
}

async function readControlUiDistIndexJs(): Promise<string> {
	return Bun.file(
		new URL("../packages/control-ui/dist/index.js", import.meta.url),
	).text();
}

async function readControlUiDistIndexDts(): Promise<string> {
	return Bun.file(
		new URL("../packages/control-ui/dist/index.d.ts", import.meta.url),
	).text();
}

async function readStompboxSourceIndex(): Promise<string> {
	return Bun.file(
		new URL("../packages/stompbox/src/index.ts", import.meta.url),
	).text();
}

function shouldScanRepositoryPath(path: string): boolean {
	return !(
		path.startsWith(".git/") ||
		path.startsWith("node_modules/") ||
		path.startsWith("packages/core/dist/") ||
		path.startsWith("packages/stompbox/dist/") ||
		path.startsWith("packages/control-ui/dist/") ||
		path.startsWith("packages/visual-effects/dist/") ||
		path.startsWith("packages/amp/dist/") ||
		path.startsWith("packages/cabinet/dist/") ||
		path.startsWith("gh-pages/") ||
		path === "bun.lock"
	);
}

async function readTextIfScannable(path: string): Promise<string | undefined> {
	const file = Bun.file(new URL(`../${path}`, import.meta.url));
	if (!(await file.exists())) {
		return undefined;
	}

	const contents = await file.arrayBuffer();
	const bytes = new Uint8Array(contents);
	if (bytes.includes(0)) {
		return undefined;
	}

	return new TextDecoder().decode(bytes);
}

function runtimeDependencies(pkg: JsonRecord): JsonRecord {
	return isRecord(pkg.dependencies) ? pkg.dependencies : {};
}

function expectCoreDependencyCompatible(
	version: unknown,
	core: JsonRecord,
): void {
	expect([
		...CORE_COMPATIBLE_DEPENDENCY_VERSIONS,
		String(core.version),
	]).toContain(String(version));
}

function devDependencies(pkg: JsonRecord): JsonRecord {
	return isRecord(pkg.devDependencies) ? pkg.devDependencies : {};
}

function expectExport(
	exportsField: unknown,
	exportName: string,
	expected: { readonly importPath: string; readonly typesPath: string },
): void {
	expect(isRecord(exportsField)).toBe(true);
	if (!isRecord(exportsField)) {
		return;
	}

	const target = exportsField[exportName];
	expect(isRecord(target)).toBe(true);
	if (!isRecord(target)) {
		return;
	}

	expect(target.import).toBe(expected.importPath);
	expect(target.types).toBe(expected.typesPath);
}

function expectNoReactRuntimeDependency(pkg: JsonRecord): void {
	const deps = runtimeDependencies(pkg);
	expect(deps.react).toBeUndefined();
	expect(deps["react-dom"]).toBeUndefined();
}

function collectExportTargets(value: unknown): readonly string[] {
	if (typeof value === "string") {
		return [value];
	}
	if (!isRecord(value)) {
		return [];
	}
	return Object.values(value).flatMap((target) => collectExportTargets(target));
}

describe("workspace package contract", () => {
	test("root manifest is a private Bun workspace for publishable packages", async () => {
		const pkg = await readRootPackageJson();
		const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};

		expect(pkg.name).toBe("@vessel-dsp/workspace");
		expect(pkg.private).toBe(true);
		expect(pkg.packageManager).toBe("bun@1.2.2");
		expect(pkg.publishConfig).toBeUndefined();
		expect(pkg.exports).toBeUndefined();
		expect(pkg.files).toBeUndefined();
		expect(pkg.workspaces).toEqual(["packages/*"]);
		expect(scripts.build).toContain("packages/core");
		expect(scripts.build).toContain("packages/stompbox");
		expect(scripts.build).toContain("packages/control-ui");
		expect(scripts.build).toContain("packages/visual-effects");
		expect(scripts.build).toContain("packages/amp");
		expect(scripts.build).toContain("packages/cabinet");
		for (const packageDir of removedWorkspacePackageDirs) {
			expect(scripts.build).not.toContain(packageDir);
		}
		expect(scripts["build:pages"]).toBe("astro build");
		expect(scripts["docs:dev"]).toBe("astro dev");
		expect(scripts["docs:preview"]).toBe("astro preview");
		expect(scripts["build:playground"]).toBeUndefined();
		expect(scripts.dev).toBeUndefined();
		expect(scripts.preview).toBeUndefined();
		expect(scripts["pack:dry-run"]).toContain("packages/core");
		expect(scripts["pack:dry-run"]).toContain("packages/stompbox");
		expect(scripts["pack:dry-run"]).toContain("packages/control-ui");
		expect(scripts["pack:dry-run"]).toContain("packages/visual-effects");
		expect(scripts["pack:dry-run"]).toContain("packages/amp");
		expect(scripts["pack:dry-run"]).toContain("packages/cabinet");
		for (const packageDir of removedWorkspacePackageDirs) {
			expect(scripts["pack:dry-run"]).not.toContain(packageDir);
		}
	});

	test("core package publishes the headless Circuit JSON conversion API", async () => {
		const pkg = await readPackageJson("core");
		const deps = runtimeDependencies(pkg);

		expect(pkg.name).toBe("@vessel-dsp/core");
		expect(pkg.version).toBe(VERSION);
		expect(pkg.private).not.toBe(true);
		expect(pkg.type).toBe("module");
		expect(pkg.sideEffects).toBe(false);
		expect(pkg.main).toBe("./dist/index.js");
		expect(pkg.module).toBe("./dist/index.js");
		expect(pkg.types).toBe("./dist/index.d.ts");
		expectExport(pkg.exports, ".", {
			importPath: "./dist/index.js",
			typesPath: "./dist/index.d.ts",
		});
		expect(deps["circuit-json"]).toBeDefined();
		expect(deps.zod).toBeDefined();
		expectNoReactRuntimeDependency(pkg);
		expect(typeof convertCircuitDocumentFileWithReport).toBe("function");
		expect(typeof movePanelElement).toBe("function");
	});

	test("stompbox package publishes headless drill layout and preview manifest APIs", async () => {
		const pkg = await readPackageJson("stompbox");
		const core = await readPackageJson("core");
		const deps = runtimeDependencies(pkg);

		expect(pkg.name).toBe("@vessel-dsp/stompbox");
		expect(pkg.version).toBe("0.6.16");
		expect(pkg.private).not.toBe(true);
		expect(pkg.type).toBe("module");
		expect(pkg.sideEffects).toBe(false);
		expect(pkg.main).toBe("./dist/index.js");
		expect(pkg.module).toBe("./dist/index.js");
		expect(pkg.types).toBe("./dist/index.d.ts");
		expectExport(pkg.exports, ".", {
			importPath: "./dist/index.js",
			typesPath: "./dist/index.d.ts",
		});
		expectExport(pkg.exports, "./node", {
			importPath: "./dist/node.js",
			typesPath: "./dist/node.d.ts",
		});
		expectCoreDependencyCompatible(deps["@vessel-dsp/core"], core);
		expectNoReactRuntimeDependency(pkg);
		expect(typeof createStompboxDrillLayoutFromVdsp).toBe("function");
		expect(typeof createStompboxHardwareProfileFromVdsp).toBe("function");
		expect(typeof createStompboxPreviewFromVdsp).toBe("function");
		expect(typeof createStompboxDrillTemplateFromVdsp).toBe("function");
		expect(typeof createStompboxDrillTemplateSvgFromVdsp).toBe("function");
		expect(typeof createStompboxPreviewGlbFromVdsp).toBe("function");
		expect(typeof createStompboxPreviewSvgViewsFromVdsp).toBe("function");
		expect(typeof createStompboxAppearancePatch).toBe("function");
		expect(typeof resolveStompboxAppearance).toBe("function");
		expect(typeof createStompboxControlSurface).toBe("function");
		expect(typeof createDefaultStompboxPedalStateFromVdsp).toBe("function");
		expect(typeof createStompboxPedalStateStore).toBe("function");
		expect(typeof createStompboxKnobTurnCommand).toBe("function");
		expect(typeof createStompboxFootswitchPressCommand).toBe("function");
		expect(typeof applyStompboxPreviewInteraction).toBe("function");
		expect(typeof createStompboxPreviewStatePatch).toBe("function");
		expect(typeof validateStompboxGlbAssetFile).toBe("function");
		expect(typeof validateStompboxHardwareProfileAssets).toBe("function");
	});

	test("control-ui package publishes optional React panel controls", async () => {
		const pkg = await readPackageJson("control-ui");
		const core = await readPackageJson("core");
		const deps = runtimeDependencies(pkg);
		const peerDeps = isRecord(pkg.peerDependencies) ? pkg.peerDependencies : {};
		const devDeps = devDependencies(pkg);

		expect(pkg.name).toBe("@vessel-dsp/control-ui");
		expect(pkg.version).toBe("0.6.15");
		expect(pkg.private).not.toBe(true);
		expect(pkg.type).toBe("module");
		expect(pkg.main).toBe("./dist/index.js");
		expect(pkg.module).toBe("./dist/index.js");
		expect(pkg.types).toBe("./dist/index.d.ts");
		expect(pkg.sideEffects).toEqual(["./dist/styles.css", "./src/styles.css"]);
		expectExport(pkg.exports, ".", {
			importPath: "./dist/index.js",
			typesPath: "./dist/index.d.ts",
		});
		expect(isRecord(pkg.exports)).toBe(true);
		if (isRecord(pkg.exports)) {
			expect(pkg.exports["./styles.css"]).toEqual({
				default: "./dist/styles.css",
			});
		}
		expectCoreDependencyCompatible(deps["@vessel-dsp/core"], core);
		expect(deps.react).toBeUndefined();
		expect(deps["react-dom"]).toBeUndefined();
		expect(peerDeps.react).toBe(">=18.2 <20");
		expect(peerDeps["react-dom"]).toBe(">=18.2 <20");
		expect(devDeps.react).toBeDefined();
		expect(devDeps["react-dom"]).toBeDefined();
		expect(devDeps["react-test-renderer"]).toBeDefined();
	});

	test("visual-effects package publishes reusable Three.js preview effects", async () => {
		const pkg = await readPackageJson("visual-effects");
		const deps = runtimeDependencies(pkg);

		expect(pkg.name).toBe("@vessel-dsp/visual-effects");
		expect(pkg.private).not.toBe(true);
		expect(pkg.type).toBe("module");
		expect(pkg.sideEffects).toBe(false);
		expect(pkg.main).toBe("./dist/index.js");
		expect(pkg.module).toBe("./dist/index.js");
		expect(pkg.types).toBe("./dist/index.d.ts");
		expectExport(pkg.exports, ".", {
			importPath: "./dist/index.js",
			typesPath: "./dist/index.d.ts",
		});
		expect(deps.three).toBeDefined();
		expectNoReactRuntimeDependency(pkg);
		expect(typeof resolvePreviewEffectPreset).toBe("function");
	});

	test("amp and cabinet packages publish generated 3D visualization APIs", async () => {
		const amp = await readPackageJson("amp");
		const cabinet = await readPackageJson("cabinet");
		const core = await readPackageJson("core");
		const visualEffects = await readPackageJson("visual-effects");
		const ampDeps = runtimeDependencies(amp);
		const cabinetDeps = runtimeDependencies(cabinet);

		expect(amp.name).toBe("@vessel-dsp/amp");
		expect(cabinet.name).toBe("@vessel-dsp/cabinet");
		for (const pkg of [amp, cabinet]) {
			expect(pkg.private).not.toBe(true);
			expect(pkg.type).toBe("module");
			expect(pkg.sideEffects).toBe(false);
			expect(pkg.main).toBe("./dist/index.js");
			expect(pkg.module).toBe("./dist/index.js");
			expect(pkg.types).toBe("./dist/index.d.ts");
			expectExport(pkg.exports, ".", {
				importPath: "./dist/index.js",
				typesPath: "./dist/index.d.ts",
			});
			expectNoReactRuntimeDependency(pkg);
		}
		expect(ampDeps.three).toBeDefined();
		expect(ampDeps["@vessel-dsp/visual-effects"]).toBe(visualEffects.version);
		expectCoreDependencyCompatible(ampDeps["@vessel-dsp/core"], core);
		expect(cabinetDeps.three).toBeDefined();
		expect(cabinetDeps["@vessel-dsp/visual-effects"]).toBe(
			visualEffects.version,
		);
		expectCoreDependencyCompatible(cabinetDeps["@vessel-dsp/core"], core);
		expect(typeof createAmpProfileFromVdsp).toBe("function");
		expect(typeof createAmpPreviewLayout).toBe("function");
		expect(typeof createCabinetPreviewLayout).toBe("function");
	});

	test("stompbox package keeps named demo presets out of the library source", async () => {
		const source = await readStompboxSourceIndex();

		expect(source).not.toContain("DEMO_STOMPBOX");
		expect(source).not.toContain("DEFAULT_DEMO");
		expect(source).not.toContain("mxr-style");
		expect(source).not.toContain("boss-style");
		expect(source).not.toMatch(/\bMXR\b/i);
		expect(source).not.toMatch(/\bBoss\b/i);
	});

	test("stompbox root entry stays browser-safe by keeping filesystem access in the node export", async () => {
		const source = await readStompboxSourceIndex();

		expect(source).not.toContain("node:fs");
		expect(source).not.toContain("readFileSync");
	});

	test("removed React and simulation packages are not workspace deliverables", async () => {
		expect(
			await Bun.file(
				new URL(
					`../packages/${"react" + "-component"}/package.json`,
					import.meta.url,
				),
			).exists(),
		).toBe(false);
		expect(
			await Bun.file(
				new URL(
					`../packages/${"sim" + "ulation"}/package.json`,
					import.meta.url,
				),
			).exists(),
		).toBe(false);
	});

	test("removed scoped package names are absent from repository files", async () => {
		const matches: string[] = [];
		const glob = new Bun.Glob("**/*");
		const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

		for await (const path of glob.scan({ cwd: repositoryRoot })) {
			if (!shouldScanRepositoryPath(path)) {
				continue;
			}

			const text = await readTextIfScannable(path);
			if (text === undefined) {
				continue;
			}

			for (const packageName of removedScopedPackageNames) {
				if (text.includes(packageName)) {
					matches.push(`${path}: ${packageName}`);
				}
			}
			for (const packageDir of removedWorkspacePackageDirs) {
				if (text.includes(packageDir)) {
					matches.push(`${path}: ${packageDir}`);
				}
			}
		}

		expect(matches).toEqual([]);
	});

	test("headless package tsconfigs stay DOM-free and control-ui is the DOM/JSX package", async () => {
		const tsconfig = await readPackageTsconfig("core");
		const compilerOptions = isRecord(tsconfig.compilerOptions)
			? tsconfig.compilerOptions
			: {};
		const stompboxTsconfig = await readPackageTsconfig("stompbox");
		const stompboxCompilerOptions = isRecord(stompboxTsconfig.compilerOptions)
			? stompboxTsconfig.compilerOptions
			: {};
		const controlUiTsconfig = await readPackageTsconfig("control-ui");
		const controlUiCompilerOptions = isRecord(controlUiTsconfig.compilerOptions)
			? controlUiTsconfig.compilerOptions
			: {};
		const controlUiBuildTsconfig = await readPackageBuildTsconfig("control-ui");
		const controlUiBuildCompilerOptions = isRecord(
			controlUiBuildTsconfig.compilerOptions,
		)
			? controlUiBuildTsconfig.compilerOptions
			: {};
		expect(compilerOptions.lib).toEqual(["ES2022"]);
		expect(compilerOptions.jsx).toBeUndefined();
		expect(stompboxCompilerOptions.lib).toEqual(["ES2022"]);
		expect(stompboxCompilerOptions.jsx).toBeUndefined();
		expect(controlUiCompilerOptions.lib).toEqual([
			"ES2022",
			"DOM",
			"DOM.Iterable",
		]);
		expect(controlUiCompilerOptions.jsx).toBe("react-jsx");
		expect(controlUiCompilerOptions.baseUrl).toBe("../..");
		expect(controlUiCompilerOptions.paths).toEqual({
			"@vessel-dsp/core": ["packages/core/src/index.ts"],
			"@vessel-dsp/core/*": ["packages/core/src/*"],
		});
		expect(controlUiBuildTsconfig.extends).toBe("../../tsconfig.base.json");
		expect(controlUiBuildCompilerOptions.lib).toEqual([
			"ES2022",
			"DOM",
			"DOM.Iterable",
		]);
		expect(controlUiBuildCompilerOptions.jsx).toBe("react-jsx");
		expect(controlUiBuildCompilerOptions.paths).toBeUndefined();
		expect(controlUiBuildTsconfig.include).toEqual(["src/**/*"]);
	});

	test("Circuit JSON schema tooling is a core runtime dependency, not root-only test plumbing", async () => {
		const root = await readRootPackageJson();
		const rootDevDeps = devDependencies(root);
		const core = await readPackageJson("core");
		const deps = runtimeDependencies(core);

		expect(rootDevDeps["circuit-json"]).toBeUndefined();
		expect(deps["circuit-json"]).toBeDefined();
		expect(deps.zod).toBeDefined();
		expect(deps["@tscircuit/runframe"]).toBeUndefined();
	});

	test("root manifest has no playground UI dependencies", async () => {
		const root = await readRootPackageJson();
		const rootDevDeps = devDependencies(root);

		expect(rootDevDeps.react).toBeUndefined();
		expect(rootDevDeps["react-dom"]).toBeUndefined();
		expect(rootDevDeps.vite).toBeUndefined();
		expect(rootDevDeps["@vitejs/plugin-react"]).toBeUndefined();
		expect(rootDevDeps["@tscircuit/runframe"]).toBeUndefined();
		expect(rootDevDeps["@tscircuit/schematic-viewer"]).toBeUndefined();
		expect(rootDevDeps["@tailwindcss/vite"]).toBeUndefined();
		expect(rootDevDeps.tailwindcss).toBeUndefined();
		expect(rootDevDeps["lucide-react"]).toBeUndefined();
		expect(rootDevDeps["radix-ui"]).toBeUndefined();
	});

	test("declares the MIT license and includes docs in publishable packages", async () => {
		for (const packageDir of [
			"core",
			"stompbox",
			"control-ui",
			"visual-effects",
			"amp",
			"cabinet",
		]) {
			const pkg = await readPackageJson(packageDir);
			expect(pkg.license).toBe("MIT");
			expect(Array.isArray(pkg.files)).toBe(true);
			expect(pkg.files).toContain("LICENSE.md");
			expect(pkg.files).toContain("README.md");
		}
	});

	test("stompbox publishes demo CAD assets for example preview assembly", async () => {
		const pkg = await readPackageJson("stompbox");
		const files = Array.isArray(pkg.files) ? pkg.files : [];

		expect(files).toContain("assets");
		expect(
			await Bun.file(
				new URL(
					"../packages/stompbox/assets/cad/parts/box-1590b/.tayda-a6619.step.glb",
					import.meta.url,
				),
			).exists(),
		).toBe(true);
		expect(
			await Bun.file(
				new URL(
					"../packages/stompbox/assets/cad/parts/box-1590b/tayda-a6619.step",
					import.meta.url,
				),
			).exists(),
		).toBe(true);
		expect(
			await Bun.file(
				new URL(
					"../packages/stompbox/assets/cad/parts/dc-socket-dc099/.dc099.step.glb",
					import.meta.url,
				),
			).exists(),
		).toBe(true);
		expect(
			await Bun.file(
				new URL(
					"../packages/stompbox/assets/cad/parts/dc-socket-dc099/dc099.step",
					import.meta.url,
				),
			).exists(),
		).toBe(true);
	});

	test("publishable packages publish built dist artifacts without source fallback", async () => {
		for (const packageDir of [
			"core",
			"stompbox",
			"control-ui",
			"visual-effects",
			"amp",
			"cabinet",
		]) {
			const pkg = await readPackageJson(packageDir);
			const files = Array.isArray(pkg.files) ? pkg.files : [];
			const scripts = isRecord(pkg.scripts) ? pkg.scripts : {};
			const entryTargets = [
				pkg.main,
				pkg.module,
				pkg.types,
				...collectExportTargets(pkg.exports),
			].filter((target): target is string => typeof target === "string");

			expect(files).toContain("dist");
			expect(files).not.toContain("src");
			expect(scripts.prepack).toContain("bun run build");

			for (const target of entryTargets) {
				if (target === "./package.json") {
					continue;
				}
				expect(target).toStartWith("./dist/");
			}
		}
	});

	test("publishes package homepage and GitHub repository metadata for npm package pages", async () => {
		const packages = [
			await readPackageJson("core"),
			await readPackageJson("stompbox"),
			await readPackageJson("control-ui"),
			await readPackageJson("visual-effects"),
			await readPackageJson("amp"),
			await readPackageJson("cabinet"),
		];

		for (const pkg of packages) {
			expect(pkg.homepage).toBe("https://vessel-dsp.github.io/core/");

			expect(isRecord(pkg.repository)).toBe(true);
			if (isRecord(pkg.repository)) {
				expect(pkg.repository.type).toBe("git");
				expect(pkg.repository.url).toBe(
					"git+https://github.com/vessel-dsp/core.git",
				);
			}

			expect(isRecord(pkg.bugs)).toBe(true);
			if (isRecord(pkg.bugs)) {
				expect(pkg.bugs.url).toBe("https://github.com/vessel-dsp/core/issues");
			}
		}
	});
});

describe("published import surface", () => {
	test("core exposes Circuit JSON conversion helpers", () => {
		expect(typeof serializeCircuitJsonDocument).toBe("function");
		expect(typeof parseCircuitJsonDocument).toBe("function");
		expect(typeof validateCircuitJsonDocument).toBe("function");
	});

	test("stompbox exposes drill layout, drill template, and preview helpers", () => {
		expect(typeof createStompboxDrillLayoutFromVdsp).toBe("function");
		expect(typeof createStompboxDrillTemplateFromVdsp).toBe("function");
		expect(typeof createStompboxDrillTemplateSvgFromVdsp).toBe("function");
		expect(typeof createStompboxPreviewFromVdsp).toBe("function");
		expect(typeof createStompboxPreviewGlbFromVdsp).toBe("function");
		expect(typeof createStompboxPreviewSvgViewsFromVdsp).toBe("function");
		expect(typeof createStompboxAppearancePatch).toBe("function");
		expect(typeof resolveStompboxAppearance).toBe("function");
		expect(typeof validateStompboxGlbAssetFile).toBe("function");
		expect(typeof validateStompboxHardwareProfileAssets).toBe("function");
	});
});

describe("npm publish workflow", () => {
	test("publishes core on tags and supports all or individual workflow dispatch packages", async () => {
		const workflow = await readPublishWorkflow();

		expect(workflow).toContain("name: Publish to npm");
		expect(workflow).toContain("workflow_dispatch:");
		expect(workflow).toContain("description: Package to publish");
		expect(workflow).toContain("type: choice");
		expect(workflow).toContain("default: all");
		expect(workflow).toContain("- all");
		expect(workflow).toContain("- core");
		expect(workflow).toContain("- control-ui");
		expect(workflow).toContain("- stompbox");
		expect(workflow).toContain("- visual-effects");
		expect(workflow).toContain("- amp");
		expect(workflow).toContain("- cabinet");
		expect(workflow).toContain("push:");
		expect(workflow).toContain("tags:");
		expect(workflow).toContain("- 'v*'");
		expect(workflow).not.toContain("release:");
		expect(workflow).toContain("id-token: write");
		expect(workflow).toContain("oven-sh/setup-bun@v2");
		expect(workflow).toContain("actions/setup-node@v4");
		expect(workflow).toContain("registry-url: https://registry.npmjs.org");
		expect(workflow).toContain("scope: '@vessel-dsp'");
		expect(workflow).toContain("bun install --frozen-lockfile");
		expect(workflow).toContain("github.event_name == 'push'");
		expect(workflow).toContain("inputs.package == 'all'");
		expect(workflow).toContain("inputs.package == 'core'");
		expect(workflow).toContain("inputs.package == 'control-ui'");
		expect(workflow).toContain("inputs.package == 'stompbox'");
		expect(workflow).toContain("inputs.package == 'visual-effects'");
		expect(workflow).toContain("inputs.package == 'amp'");
		expect(workflow).toContain("inputs.package == 'cabinet'");
		expect(workflow).toContain("name: Verify all packages");
		expect(workflow).toContain(
			"github.event_name == 'workflow_dispatch' && inputs.package == 'all'",
		);
		expect(workflow).toContain("run: bun run pack:dry-run");
		expect(workflow).toContain("name: Verify core package");
		expect(workflow).toContain("run: bun run --cwd packages/core pack:dry-run");
		expect(workflow).toContain("name: Verify control-ui package");
		expect(workflow).toContain(
			"run: bun run --cwd packages/control-ui pack:dry-run",
		);
		expect(workflow).toContain("name: Verify stompbox package");
		expect(workflow).toContain(
			"run: bun run --cwd packages/stompbox pack:dry-run",
		);
		expect(workflow).toContain("name: Verify visual-effects package");
		expect(workflow).toContain(
			"run: bun run --cwd packages/visual-effects pack:dry-run",
		);
		expect(workflow).toContain("name: Verify amp package");
		expect(workflow).toContain("run: bun run --cwd packages/amp pack:dry-run");
		expect(workflow).toContain("name: Verify cabinet package");
		expect(workflow).toContain(
			"run: bun run --cwd packages/cabinet pack:dry-run",
		);
		expect(workflow).toContain(
			"npm publish --workspace @vessel-dsp/core --access public --provenance",
		);
		expect(workflow).toContain(
			"npm publish --workspace @vessel-dsp/control-ui --access public --provenance",
		);
		expect(workflow).toContain(
			"npm publish --workspace @vessel-dsp/stompbox --access public --provenance",
		);
		expect(workflow).toContain(
			"npm publish --workspace @vessel-dsp/visual-effects --access public --provenance",
		);
		expect(workflow).toContain(
			"npm publish --workspace @vessel-dsp/amp --access public --provenance",
		);
		expect(workflow).toContain(
			"npm publish --workspace @vessel-dsp/cabinet --access public --provenance",
		);
		expect(workflow.indexOf("@vessel-dsp/core")).toBeLessThan(
			workflow.indexOf("@vessel-dsp/control-ui"),
		);
		expect(workflow.indexOf("@vessel-dsp/control-ui")).toBeLessThan(
			workflow.indexOf("@vessel-dsp/stompbox"),
		);
		for (const packageName of removedScopedPackageNames) {
			expect(workflow).not.toContain(packageName);
		}
	});
});

describe("GitHub Pages workflow", () => {
	test("deploys the Starlight documentation site instead of a playground app", async () => {
		const workflow = await readDeployWorkflow();

		expect(workflow).toContain("name: Deploy documentation to GitHub Pages");
		expect(workflow).toContain("bun run build:pages");
		expect(workflow).toContain("path: gh-pages");
		expect(workflow.indexOf("bun run build")).toBeLessThan(
			workflow.indexOf("bun test"),
		);
		expect(workflow).not.toContain("build:playground");
		expect(workflow).not.toContain("vite");
		expect(workflow).not.toContain("playground");
	});
});

describe("README package metadata", () => {
	test("shows npm badge for the canonical package", async () => {
		const readme = await readReadme();

		expect(readme).toContain(
			"[![core npm version](https://img.shields.io/npm/v/%40vessel-dsp%2Fcore.svg)]",
		);
		expect(readme).toContain(
			"(https://www.npmjs.com/package/@vessel-dsp/core)",
		);
		expect(readme).toContain("@vessel-dsp/control-ui");
		expect(readme).toContain("@vessel-dsp/visual-effects");
		expect(readme).toContain("@vessel-dsp/amp");
		expect(readme).toContain("@vessel-dsp/cabinet");
		expect(readme).toContain("Optional React controls");
		for (const packageName of removedScopedPackageNames) {
			expect(readme).not.toContain(packageName);
		}
	});
});

describe("release metadata", () => {
	test("pins the current package release and changelog entry", async () => {
		const core = await readPackageJson("core");
		const stompbox = await readPackageJson("stompbox");
		const controlUi = await readPackageJson("control-ui");
		const visualEffects = await readPackageJson("visual-effects");
		const amp = await readPackageJson("amp");
		const cabinet = await readPackageJson("cabinet");
		const changelog = await readChangelog();
		const distIndex = await readCoreDistIndexJs();
		const distTypes = await readCoreDistIndexDts();
		const stompboxDistIndex = await readStompboxDistIndexJs();
		const stompboxDistTypes = await readStompboxDistIndexDts();
		const stompboxDistNode = await readStompboxDistNodeJs();
		const stompboxDistNodeTypes = await readStompboxDistNodeDts();
		const controlUiDistIndex = await readControlUiDistIndexJs();
		const controlUiDistTypes = await readControlUiDistIndexDts();

		expect(core.version).toBe("0.6.20");
		expect(stompbox.version).toBe("0.6.16");
		expect(controlUi.version).toBe("0.6.15");
		expect(visualEffects.version).toBe("0.6.15");
		expect(amp.version).toBe("0.6.15");
		expect(cabinet.version).toBe("0.6.15");
		expect(VERSION).toBe("0.6.20");
		expect(distIndex).toContain('export const VERSION = "0.6.20";');
		expect(distTypes).toContain('export declare const VERSION = "0.6.20";');
		expect(distTypes).toContain("DeviceInterfaceAudioBinding");
		expect(stompboxDistIndex).toContain("createStompboxDrillLayoutFromVdsp");
		expect(stompboxDistIndex).toContain(
			"createStompboxDrillTemplateSvgFromVdsp",
		);
		expect(stompboxDistIndex).toContain("createStompboxPreviewGlbFromVdsp");
		expect(stompboxDistIndex).toContain(
			"createStompboxPreviewSvgViewsFromVdsp",
		);
		expect(stompboxDistIndex).toContain("createStompboxAppearancePatch");
		expect(stompboxDistIndex).toContain("resolveStompboxAppearance");
		expect(stompboxDistIndex).toContain("createStompboxControlSurface");
		expect(stompboxDistIndex).toContain("createStompboxPedalStateStore");
		expect(stompboxDistIndex).toContain("createStompboxPreviewStatePatch");
		expect(stompboxDistIndex).toContain(
			"validateStompboxHardwareProfileAssets",
		);
		expect(stompboxDistIndex).not.toContain("node:fs");
		expect(stompboxDistIndex).not.toContain("readFileSync");
		expect(stompboxDistNode).toContain("node:fs");
		expect(stompboxDistNode).toContain("validateStompboxGlbAssetFile");
		expect(stompboxDistTypes).toContain("createStompboxDrillLayoutFromVdsp");
		expect(stompboxDistTypes).toContain(
			"createStompboxDrillTemplateSvgFromVdsp",
		);
		expect(stompboxDistTypes).toContain("createStompboxPreviewGlbFromVdsp");
		expect(stompboxDistTypes).toContain(
			"createStompboxPreviewSvgViewsFromVdsp",
		);
		expect(stompboxDistTypes).toContain("createStompboxAppearancePatch");
		expect(stompboxDistTypes).toContain("resolveStompboxAppearance");
		expect(stompboxDistTypes).toContain("createStompboxControlSurface");
		expect(stompboxDistTypes).toContain("createStompboxPedalStateStore");
		expect(stompboxDistTypes).toContain("createStompboxPreviewStatePatch");
		expect(stompboxDistTypes).toContain(
			"validateStompboxHardwareProfileAssets",
		);
		expect(stompboxDistTypes).not.toContain("validateStompboxGlbAssetFile");
		expect(stompboxDistNodeTypes).toContain("validateStompboxGlbAssetFile");
		expect(controlUiDistIndex).toContain("ControlSurface");
		expect(controlUiDistIndex).toContain("ControlUiThemeProvider");
		expect(controlUiDistIndex).toContain("createControlUiState");
		expect(controlUiDistTypes).toContain("ControlSurface");
		expect(controlUiDistTypes).toContain("ControlUiThemeProvider");
		expect(controlUiDistTypes).toContain("createControlUiState");
		expect(changelog).toStartWith("# Changelog\n\n## 0.6.20\n\n");
		expect(changelog).toContain("@vessel-dsp/control-ui");
	});
});

describe("dist import rewriting", () => {
	test("adds .js extensions to relative ESM specifiers that point at emitted files", () => {
		const rewritten = rewriteRelativeEsmSpecifiers(
			[
				"export * from '../../index';",
				"import { parseCircuitDocument } from './formats/document';",
				"import './side-effect';",
				"import external from 'circuit-json';",
				"import already from './ready.js';",
			].join("\n"),
			new URL(
				"file:///Users/example/project/packages/core/dist/formats/circuit-json/index.js",
			),
			new Set([
				"/Users/example/project/packages/core/dist/index.js",
				"/Users/example/project/packages/core/dist/formats/circuit-json/formats/document.js",
				"/Users/example/project/packages/core/dist/formats/circuit-json/side-effect.js",
			]),
		);

		expect(rewritten).toContain("export * from '../../index.js';");
		expect(rewritten).toContain("from './formats/document.js';");
		expect(rewritten).toContain("import './side-effect.js';");
		expect(rewritten).toContain("from 'circuit-json';");
		expect(rewritten).toContain("from './ready.js';");
	});
});
