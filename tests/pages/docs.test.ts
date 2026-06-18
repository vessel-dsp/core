import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT_DIR = join(import.meta.dir, "..", "..");

function readRepoFile(path: string): string {
	return readFileSync(join(ROOT_DIR, path), "utf8");
}

function readRepoBytes(path: string): Buffer {
	return readFileSync(join(ROOT_DIR, path));
}

describe("GitHub Pages documentation site", () => {
	test("builds Pages with Astro Starlight and generated API reference docs", () => {
		const packageJson = JSON.parse(readRepoFile("package.json")) as {
			scripts: Record<string, string>;
			devDependencies: Record<string, string>;
		};

		expect(packageJson.scripts["build:pages"]).toBe("astro build");
		expect(packageJson.scripts["docs:dev"]).toBe("astro dev");
		expect(packageJson.scripts["docs:preview"]).toBe("astro preview");
		expect(packageJson.devDependencies).toHaveProperty("@astrojs/starlight");
		expect(packageJson.devDependencies).toHaveProperty("astro");
		expect(packageJson.devDependencies).toHaveProperty("starlight-typedoc");
		expect(packageJson.devDependencies).toHaveProperty("typedoc");
		expect(packageJson.devDependencies).toHaveProperty("typedoc-plugin-markdown");
		expect(packageJson.devDependencies).toHaveProperty("three");

		expect(existsSync(join(ROOT_DIR, "scripts/build-pages.ts"))).toBe(false);
		expect(existsSync(join(ROOT_DIR, "docs", "public", ".nojekyll"))).toBe(true);

		const astroConfig = readRepoFile("astro.config.mjs");
		expect(astroConfig).toContain("starlight");
		expect(astroConfig).toContain("starlightTypeDoc");
		expect(astroConfig).toContain("typeDocSidebarGroup");
		expect(astroConfig).toContain('site: "https://vessel-dsp.github.io/core/"');
		expect(astroConfig).toContain('base: "/core"');
		expect(astroConfig).toContain('srcDir: "./docs/src"');
		expect(astroConfig).toContain('publicDir: "./docs/public"');
		expect(astroConfig).toContain('outDir: "./gh-pages"');
		expect(astroConfig).toContain('baseUrl: "https://github.com/vessel-dsp/core/edit/main/"');
		expect(astroConfig).toContain('label: "Examples"');
		expect(astroConfig).toContain('link: "/examples/pro-co-rat/"');
		expect(astroConfig).toContain('"packages/core/src/index.ts"');
		expect(astroConfig).toContain('"packages/stompbox/src/index.ts"');

		const stompboxPackage = JSON.parse(readRepoFile("packages/stompbox/package.json")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		expect(stompboxPackage.dependencies ?? {}).not.toHaveProperty("three");
		expect(stompboxPackage.devDependencies ?? {}).not.toHaveProperty("three");
	});

	test("documents the core, format, and stompbox workflows", () => {
		const contentConfig = readRepoFile("docs/src/content.config.ts");
		expect(contentConfig).toContain("docsLoader");
		expect(contentConfig).toContain("docsSchema");

		const landingPage = readRepoFile("docs/src/content/docs/index.mdx");
		expect(landingPage).toContain("title: VesselDSP Docs");
		expect(landingPage).toContain("@vessel-dsp/core");
		expect(landingPage).toContain("@vessel-dsp/stompbox");
		expect(landingPage).toContain("CircuitDocument");
		expect(landingPage).toContain("/core/reference/api/readme/");
		expect(landingPage).not.toMatch(/playground|workbench|custom editor/i);

		const gettingStarted = readRepoFile("docs/src/content/docs/guides/getting-started.mdx");
		expect(gettingStarted).toContain("npm install @vessel-dsp/core");
		expect(gettingStarted).toContain("parseCircuitDocumentFile");
		expect(gettingStarted).toContain("serializeCircuitJsonDocument");

		const formatsPage = readRepoFile("docs/src/content/docs/formats/index.mdx");
		expect(formatsPage).toContain(".vdsp");
		expect(formatsPage).toContain(".asc");
		expect(formatsPage).toContain(".schx");
		expect(formatsPage).toContain(".circuit.json");
		expect(formatsPage).toContain("drop-with-diagnostics");

		const stompboxPage = readRepoFile("docs/src/content/docs/guides/stompbox.mdx");
		expect(stompboxPage).toContain("vdsp-declared");
		expect(stompboxPage).toContain("auto-generated");
		expect(stompboxPage).toContain("includePowerJack: false");
		expect(stompboxPage).toContain("hardwareProfile");
		expect(stompboxPage).toContain("DEMO_STOMPBOX_HARDWARE_PROFILE");
		expect(stompboxPage).toContain("minPartClearanceMm");
		expect(stompboxPage).toContain("placement-clearance");
		expect(stompboxPage).toContain("createStompboxPreviewGlb");
		expect(stompboxPage).toContain("createStompboxAppearancePatch");
		expect(stompboxPage).toContain("resolveStompboxAppearance");
		expect(stompboxPage).toContain("createStompboxDrillTemplateSvgFromVdsp");
		expect(stompboxPage).toContain("/core/examples/stompbox-mxr-style-preview.glb");
		expect(stompboxPage).toContain("/core/examples/stompbox-mxr-style-drill-template-preview.svg");
		expect(stompboxPage).toContain("/core/examples/stompbox-mxr-style-drill-layout.json");
		expect(stompboxPage).toContain('import StompboxGlbViewer from "../../../components/StompboxGlbViewer.astro";');
		expect(stompboxPage).toContain('<StompboxGlbViewer src="/core/examples/stompbox-mxr-style-preview.glb" view="top"');
		expect(stompboxPage).toContain('<StompboxGlbViewer src="/core/examples/stompbox-mxr-style-preview.glb"');
		expect(stompboxPage).toContain("orthographic top camera");

		const viewer = readRepoFile("docs/src/components/StompboxGlbViewer.astro");
		expect(viewer).toContain("data-stompbox-glb-viewer");
		expect(viewer).toContain("data-view-mode");
		expect(viewer).toContain("data-interactive");
		expect(viewer).toContain('"three": "/core/vendor/three/build/three.module.js"');
		expect(viewer).toContain('src="/core/stompbox-glb-viewer.js"');

		const viewerRuntime = readRepoFile("docs/public/stompbox-glb-viewer.js");
		expect(viewerRuntime).toContain('import * as THREE from "three";');
		expect(viewerRuntime).toContain('import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";');
		expect(viewerRuntime).toContain('import { OrbitControls } from "three/addons/controls/OrbitControls.js";');
		expect(viewerRuntime).toContain("THREE.OrthographicCamera");
		expect(viewerRuntime).toContain("frameOrthographicTopModel");
		expect(viewerRuntime).toContain("findEnclosureFrame");
		expect(viewerRuntime).toContain("applyTextDecalMaterial");
		expect(viewerRuntime).toContain("ensureTextDecalUv");
		expect(viewerRuntime).toContain("TEXT_DECAL_UVS");
		expect(viewerRuntime).toContain("THREE.CanvasTexture");
		expect(viewerRuntime).toContain("texture.flipY = false");
		expect(viewerRuntime).toContain("preserveDrawingBuffer: true");
		expect(viewerRuntime).toContain("applyFlatAppearanceColorMaterial");
		expect(viewerRuntime).toContain("renderColorMode");
		expect(viewerRuntime).toContain("THREE.MeshBasicMaterial");

		expect(existsSync(join(ROOT_DIR, "docs/public/vendor/three/build/three.module.js"))).toBe(true);
		expect(existsSync(join(ROOT_DIR, "docs/public/vendor/three/build/three.core.js"))).toBe(true);
		expect(existsSync(join(ROOT_DIR, "docs/public/vendor/three/addons/loaders/GLTFLoader.js"))).toBe(true);
		expect(existsSync(join(ROOT_DIR, "docs/public/vendor/three/addons/controls/OrbitControls.js"))).toBe(true);
	});

	test("includes generated stompbox preview and drill layout example assets", () => {
		const topPreview = readRepoFile("docs/public/examples/stompbox-mxr-style-preview-top.svg");
		expect(topPreview).toContain("<svg");
		expect(topPreview).toContain("Stompbox preview top view");
		expect(topPreview).toContain("data-control-id");
		expect(topPreview).not.toContain('data-top-edge-projection');

		const drillPreview = readRepoFile("docs/public/examples/stompbox-mxr-style-drill-template-preview.svg");
		expect(drillPreview).toContain("<svg");
		expect(drillPreview).toContain("Stompbox drill template preview");
		expect(drillPreview).toContain("drill-hole-center-dot");
		expect(drillPreview).toContain(".hole{fill:none;");
		expect(drillPreview).not.toContain('fill="#faf5ff"');

		const layout = JSON.parse(readRepoFile("docs/public/examples/stompbox-mxr-style-drill-layout.json")) as {
			schema?: string;
			holes?: readonly { partId?: string }[];
		};
		expect(layout.schema).toBe("stompbox-drill-layout/v1");
		expect(layout.holes?.filter((hole) => hole.partId === "knob-mxr-style-fluted-large")).toHaveLength(2);

		const glb = readRepoBytes("docs/public/examples/stompbox-mxr-style-preview.glb");
		expect(glb.subarray(0, 4).toString("utf8")).toBe("glTF");
	});

	test("includes a Pro Co Rat schematic example backed by the LiveSPICE fixture", () => {
		const examplesPage = readRepoFile("docs/src/content/docs/examples/pro-co-rat.mdx");
		expect(examplesPage).toContain("title: Pro Co Rat Schematic");
		expect(examplesPage).toContain("tests/fixtures/schx/livespice-examples/Pro Co Rat.schx");
		expect(examplesPage).toContain("/core/examples/pro-co-rat-schematic.svg");
		expect(examplesPage).toContain("LM308");
		expect(examplesPage).toContain("1N914");
		expect(examplesPage).toContain("hard clipping");
		expect(examplesPage).toContain("tone/filter network");
		expect(examplesPage).toContain("JFET buffer");
		expect(examplesPage).toContain("parseCircuitDocumentFile");
		expect(examplesPage).toContain("serializeCircuitJsonDocument");
		expect(examplesPage).toContain("## VDSP source preview");
		expect(examplesPage).toContain('filename: "Pro Co Rat.vdsp"');
		expect(examplesPage).toContain("```yaml");
		expect(examplesPage).toContain("schema: circuit-interchange/v2");
		expect(examplesPage).toContain("format: interchange");
		expect(examplesPage).toContain("name: X1");
		expect(examplesPage).toContain("PartNumber: LM308");
		expect(examplesPage).toContain('PartNumber: "1N914"');
		expect(examplesPage).toContain("The preview is intentionally excerpted");
		expect(examplesPage).toContain("## Control panel from VDSP");
		expect(examplesPage).toContain("Yes. Use `extractPanel(document)` from `@vessel-dsp/core`.");
		expect(examplesPage).toContain("extractPanel");
		expect(examplesPage).toContain("const panel = extractPanel(vdspDocument);");
		expect(examplesPage).toContain('["Distortion", "Tone", "Volume"]');
		expect(examplesPage).toContain('"jacks": ["V1:input", "S1:output"]');
		expect(examplesPage).toContain("movePanelElement");
		expect(examplesPage).toContain('elementId: "tone-knob"');
		expect(examplesPage).toContain("centerMm: { x: 12, y: -18 }");
		expect(examplesPage).toContain('serializeCircuitDocumentFile(movedDocument, { format: "vdsp" })');

		const svg = readRepoFile("docs/public/examples/pro-co-rat-schematic.svg");
		expect(svg).toContain("<svg");
		expect(svg).toContain("Pro Co Rat");
		expect(svg).toContain("LM308");
		expect(svg).toContain("1N914");
		expect(svg).toContain("Tone / Filter");
	});
});
