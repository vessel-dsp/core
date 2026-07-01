import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	controlUiRenderedExampleInitialState,
	controlUiRenderedExampleStateForMessage,
} from "../../docs/src/components/control-ui-rendered-example-data";

const ROOT_DIR = join(import.meta.dir, "..", "..");

function readRepoFile(path: string): string {
	return readFileSync(join(ROOT_DIR, path), "utf8");
}

function readRepoBytes(path: string): Buffer {
	return readFileSync(join(ROOT_DIR, path));
}

function readRepoJson<T>(path: string): T {
	return JSON.parse(readRepoFile(path)) as T;
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
		expect(packageJson.devDependencies).toHaveProperty(
			"typedoc-plugin-markdown",
		);
		expect(packageJson.devDependencies).toHaveProperty("three");

		expect(existsSync(join(ROOT_DIR, "scripts/build-pages.ts"))).toBe(false);
		expect(existsSync(join(ROOT_DIR, "docs", "public", ".nojekyll"))).toBe(
			true,
		);

		const astroConfig = readRepoFile("astro.config.mjs");
		expect(astroConfig).toContain("starlight");
		expect(astroConfig).toContain("starlightTypeDoc");
		expect(astroConfig).toContain("typeDocSidebarGroup");
		expect(astroConfig).toContain('site: "https://vessel-dsp.github.io/core/"');
		expect(astroConfig).toContain('base: "/core"');
		expect(astroConfig).toContain('srcDir: "./docs/src"');
		expect(astroConfig).toContain('publicDir: "./docs/public"');
		expect(astroConfig).toContain('outDir: "./gh-pages"');
		expect(astroConfig).toContain(
			'baseUrl: "https://github.com/vessel-dsp/core/edit/main/"',
		);
		expect(astroConfig).toContain('label: "Examples"');
		expect(astroConfig).toContain('link: "/examples/pro-co-rat/"');
		expect(astroConfig).toContain('"packages/core/src/index.ts"');
		expect(astroConfig).toContain('"packages/stompbox/src/index.ts"');
		expect(astroConfig).toContain('"packages/control-ui/src/index.ts"');
		expect(astroConfig).toContain('"packages/visual-effects/src/index.ts"');
		expect(astroConfig).toContain('"packages/amp/src/index.ts"');
		expect(astroConfig).toContain('"packages/cabinet/src/index.ts"');
		expect(astroConfig).toContain('tsconfig: "tsconfig.docs.json"');
		expect(astroConfig).toContain('label: "Generated 3D Previews"');
		expect(astroConfig).toContain('link: "/guides/generated-3d-previews/"');
		expect(astroConfig).toContain('label: "Controls"');
		expect(astroConfig).toContain('link: "/guides/controls/"');
		expect(astroConfig).toContain('label: "Control UI"');
		expect(astroConfig).toContain('link: "/guides/control-ui/"');

		const stompboxPackage = JSON.parse(
			readRepoFile("packages/stompbox/package.json"),
		) as {
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
		expect(landingPage).toContain("@vessel-dsp/control-ui");
		expect(landingPage).toContain("@vessel-dsp/visual-effects");
		expect(landingPage).toContain("@vessel-dsp/amp");
		expect(landingPage).toContain("@vessel-dsp/cabinet");
		expect(landingPage).toContain("CircuitDocument");
		expect(landingPage).toContain("class hooks");
		expect(landingPage).toContain("theme provider");
		expect(landingPage).toContain("/core/guides/generated-3d-previews/");
		expect(landingPage).toContain("/core/guides/controls/");
		expect(landingPage).toContain("/core/reference/api/readme/");
		expect(landingPage).not.toMatch(/playground|workbench|custom editor/i);

		const gettingStarted = readRepoFile(
			"docs/src/content/docs/guides/getting-started.mdx",
		);
		expect(gettingStarted).toContain("npm install @vessel-dsp/core");
		expect(gettingStarted).toContain("parseCircuitDocumentFile");
		expect(gettingStarted).toContain("serializeCircuitJsonDocument");

		const formatsPage = readRepoFile("docs/src/content/docs/formats/index.mdx");
		expect(formatsPage).toContain(".vdsp");
		expect(formatsPage).toContain(".asc");
		expect(formatsPage).toContain(".schx");
		expect(formatsPage).toContain(".circuit.json");
		expect(formatsPage).toContain("drop-with-diagnostics");
		expect(formatsPage).toContain("CONTROL_ROLE_VALUES");
		expect(formatsPage).toContain("playbackClaim: true");
		expect(formatsPage).toContain("deviceInterface.controls[].role");

		const stompboxPage = readRepoFile(
			"docs/src/content/docs/guides/stompbox.mdx",
		);
		expect(stompboxPage).toContain("vdsp-declared");
		expect(stompboxPage).toContain("auto-generated");
		expect(stompboxPage).toContain("includePowerJack: false");
		expect(stompboxPage).toContain("hardwareProfile");
		expect(stompboxPage).toContain("stompbox-demo-profiles.json");
		expect(stompboxPage).not.toContain("DEMO_STOMPBOX_HARDWARE_PROFILE");
		expect(stompboxPage).toContain("minPartClearanceMm");
		expect(stompboxPage).toContain("placement-clearance");
		expect(stompboxPage).toContain("createStompboxPreviewGlb");
		expect(stompboxPage).toContain("createStompboxAppearancePatch");
		expect(stompboxPage).toContain("resolveStompboxAppearance");
		expect(stompboxPage).toContain("createStompboxDrillTemplateSvgFromVdsp");
		expect(stompboxPage).toContain(
			"Optional text, SVG, or image decal metadata",
		);
		expect(stompboxPage).toContain("Stickers and decals");
		expect(stompboxPage).toContain('placement: { kind: "grid"');
		expect(stompboxPage).toContain('kind: "image"');
		expect(stompboxPage).toContain('face: "back"');
		expect(stompboxPage).toContain("at least 12 mm");
		expect(stompboxPage).toContain("40 mm wide face can address");
		expect(stompboxPage).toContain("fontFamily: '\"Roboto\", sans-serif'");
		expect(stompboxPage).toContain("Google Font");
		expect(stompboxPage).toContain("Knob bodies keep the");
		expect(stompboxPage).toContain(
			"material colors from their imported CAD/GLB assets",
		);
		expect(stompboxPage).not.toContain("knob: { color:");
		expect(stompboxPage).toContain(
			"/core/examples/stompbox-mxr-style-preview.glb",
		);
		expect(stompboxPage).toContain(
			"/core/examples/stompbox-mxr-style-drill-template-preview.svg",
		);
		expect(stompboxPage).toContain(
			"/core/examples/stompbox-mxr-style-drill-layout.json",
		);
		expect(stompboxPage).toContain(
			'import StompboxGlbViewer from "../../../components/StompboxGlbViewer.astro";',
		);
		expect(stompboxPage).toContain(
			'import StompboxPreviewPresetGroup from "../../../components/StompboxPreviewPresetGroup.astro";',
		);
		expect(stompboxPage).toContain("<StompboxPreviewPresetGroup");
		expect(stompboxPage).toContain(
			'<StompboxGlbViewer src="/core/examples/stompbox-mxr-style-preview.glb" view="top"',
		);
		expect(stompboxPage).toContain(
			'<StompboxGlbViewer src="/core/examples/stompbox-mxr-style-preview.glb"',
		);
		expect(stompboxPage).toContain("data-stompbox-drill-template-preview");
		expect(stompboxPage).toContain("data-stompbox-drill-layout-download");
		expect(stompboxPage).toContain("presets={demoProfiles.previewPresets}");
		expect(stompboxPage).toContain("linework={true}");
		expect(stompboxPage).toContain('lineworkColor="#eb7223"');
		expect(stompboxPage).toContain("orthographic top camera");
		expect(stompboxPage).toContain("CAD-style linework");
		expect(stompboxPage).toContain("EdgesGeometry");
		expect(stompboxPage).toContain("backgroundColor");
		expect(stompboxPage).toContain("gridColor");
		expect(stompboxPage).toContain("gridOpacity");
		expect(stompboxPage).toContain("toon edge pass and thicker outline");
		expect(stompboxPage).toContain("grain={true}");
		expect(stompboxPage).toContain("screen-space grain");
		expect(stompboxPage).toContain("@vessel-dsp/control-ui");
		expect(stompboxPage).toContain("PanelMessage");

		const generated3dPage = readRepoFile(
			"docs/src/content/docs/guides/generated-3d-previews.mdx",
		);
		expect(generated3dPage).toContain("title: Generated 3D Previews");
		expect(generated3dPage).toContain(
			'import Generated3dPreview from "../../../components/Generated3dPreview.astro";',
		);
		expect(generated3dPage).toContain("<Generated3dPreview");
		expect(generated3dPage).toContain('kind="amp"');
		expect(generated3dPage).toContain('kind="cabinet"');
		expect(generated3dPage).toContain("@vessel-dsp/amp");
		expect(generated3dPage).toContain("@vessel-dsp/cabinet");
		expect(generated3dPage).toContain("@vessel-dsp/visual-effects");
		expect(generated3dPage).toContain("createAmpPreviewLayout");
		expect(generated3dPage).toContain("createAmpPreviewObject3D");
		expect(generated3dPage).toContain("createAmpPreviewGlb");
		expect(generated3dPage).toContain("createCabinetPreviewLayout");
		expect(generated3dPage).toContain("createCabinetPreviewObject3D");
		expect(generated3dPage).toContain("createCabinetPreviewGlb");
		expect(generated3dPage).toContain("resolvePreviewEffectPreset");
		expect(generated3dPage).toContain("applyToonMaterials");
		expect(generated3dPage).toContain("addToonOutlines");
		expect(generated3dPage).toContain("applyMaterialGrain");
		expect(generated3dPage).toContain("reducedMotion");
		expect(generated3dPage).toContain("not measured CAD");
		expect(generated3dPage).not.toMatch(/playground|workbench|custom editor/i);

		const generatedPreviewComponent = readRepoFile(
			"docs/src/components/Generated3dPreview.astro",
		);
		expect(generatedPreviewComponent).toContain("data-vessel-generated-preview");
		expect(generatedPreviewComponent).toContain("data-profile");
		expect(generatedPreviewComponent).toContain("data-effects");
		expect(generatedPreviewComponent).toContain("data-background-color");
		expect(generatedPreviewComponent).toContain("data-grid-color");
		expect(generatedPreviewComponent).toContain("data-grid-opacity");
		expect(generatedPreviewComponent).toContain("data-vessel-effect-controls");
		expect(generatedPreviewComponent).toContain('data-effect-toggle="toon"');
		expect(generatedPreviewComponent).toContain('data-effect-toggle="grain"');
		expect(generatedPreviewComponent).toContain('data-effect-toggle="glitch"');
		expect(generatedPreviewComponent).toContain('data-effect-toggle="crt"');
		expect(generatedPreviewComponent).toContain("glitch: true");
		expect(generatedPreviewComponent).toContain("crt: true");
		expect(generatedPreviewComponent).not.toContain("grainIntensity: 0.05");
		expect(generatedPreviewComponent).toContain(
			'"@vessel-dsp/amp": "/core/vendor/vessel-dsp/amp/index.js"',
		);
		expect(generatedPreviewComponent).toContain(
			'"@vessel-dsp/cabinet": "/core/vendor/vessel-dsp/cabinet/index.js"',
		);
		expect(generatedPreviewComponent).toContain(
			'src="/core/generated-3d-preview-viewer.js"',
		);

		const generatedPreviewRuntime = readRepoFile(
			"docs/public/generated-3d-preview-viewer.js",
		);
		expect(generatedPreviewRuntime).toContain(
			'import { createAmpPreviewObject3D } from "@vessel-dsp/amp";',
		);
		expect(generatedPreviewRuntime).toContain(
			'import { createCabinetPreviewObject3D } from "@vessel-dsp/cabinet";',
		);
		expect(generatedPreviewRuntime).toContain(
			"VESSEL_PREVIEW_EFFECT_DEFAULTS",
		);
		expect(generatedPreviewRuntime).toContain("createPreviewEffectPipeline");
		expect(generatedPreviewRuntime).toContain("data-vessel-generated-preview");
		expect(generatedPreviewRuntime).toContain("OrbitControls");
		expect(generatedPreviewRuntime).toContain("function parseJsonAttribute");
		expect(generatedPreviewRuntime).toContain("function frameObject");
		expect(generatedPreviewRuntime).toContain("initGeneratedEffectControls");
		expect(generatedPreviewRuntime).toContain("applyGeneratedEffectControls");
		expect(generatedPreviewRuntime).toContain("viewer.dataset.effects = JSON.stringify");
		expect(generatedPreviewRuntime).toContain("[data-effect-toggle]");
		expect(generatedPreviewRuntime).toContain("CRTShader");
		expect(generatedPreviewRuntime).toContain("DigitalGlitch");
		expect(generatedPreviewRuntime).toContain("renderWithScreenEffects");
		expect(generatedPreviewRuntime).toContain(
			"VESSEL_PREVIEW_EFFECT_DEFAULTS.crtBloomIntensity",
		);
		expect(generatedPreviewRuntime).toContain(
			"VESSEL_PREVIEW_EFFECT_DEFAULTS.crtContrast",
		);
		expect(generatedPreviewRuntime).toContain(
			"uniforms.contrast.value = preset.crtContrast",
		);
		expect(generatedPreviewRuntime).toContain(
			"uniforms.saturation.value = preset.crtSaturation",
		);
		expect(generatedPreviewRuntime).toContain(
			"effects: pipeline.materialPreset",
		);
		expect(generatedPreviewRuntime).toContain("screenEffects.configure(pipeline)");
		expect(generatedPreviewRuntime).toContain("previewCrtBackgroundForViewer");
		expect(generatedPreviewRuntime).toContain(
			"initialPipeline.crtFragmentShader(CRTShader.fragmentShader)",
		);
		expect(generatedPreviewRuntime).not.toContain(
			"function crtFragmentShaderWithOutputEncoding",
		);
		expect(generatedPreviewRuntime).not.toContain("linearToOutputTexel");
		expect(generatedPreviewRuntime).not.toContain("stompboxScreenGrainValue");
		expect(generatedPreviewRuntime).not.toContain("generatedCrtGrainValue");
		expect(generatedPreviewRuntime).not.toContain("const DEFAULT_GRAIN_SCALE");
		expect(generatedPreviewRuntime).not.toContain(
			"const DEFAULT_CRT_BLOOM_INTENSITY",
		);
		expect(generatedPreviewRuntime).toContain(
			"const GLITCH_BURST_MIN_MS = 120;",
		);
		expect(generatedPreviewRuntime).toContain("function createGlitchPass");
		expect(generatedPreviewRuntime).toContain("scheduleNext");
		expect(generatedPreviewRuntime).toContain("hardEndMs");
		expect(generatedPreviewRuntime).toContain(
			"effects.crt.render(renderer, scene, camera, frameMs, effects.glitch);",
		);
		expect(generatedPreviewRuntime).toContain(
			"render(activeRenderer, sceneToRender, sceneCamera, frameMs, glitchPass)",
		);
		expect(generatedPreviewRuntime).toContain(
			"activeRenderer.render(sceneToRender, sceneCamera);",
		);
		expect(generatedPreviewRuntime).toContain(
			"let sourceTexture = renderTarget.texture;",
		);
		expect(generatedPreviewRuntime).toContain(
			"sourceTexture = glitchPass.apply(",
		);
		expect(generatedPreviewRuntime).not.toContain("renderTexture(");
		expect(generatedPreviewRuntime).not.toContain("createSceneTexturePass");
		expect(generatedPreviewRuntime).not.toContain("createTextureOutputPass");
		expect(generatedPreviewRuntime).toContain(
			"DigitalGlitch.fragmentShader.replace",
		);
		expect(generatedPreviewRuntime).toContain("THREE.HalfFloatType");
		expect(generatedPreviewRuntime).toContain("THREE.RedFormat");
		expect(generatedPreviewRuntime).toContain("THREE.FloatType");
		expect(generatedPreviewRuntime).not.toContain("function glitchActive");

		for (const path of [
			"docs/public/vendor/vessel-dsp/amp/index.js",
			"docs/public/vendor/vessel-dsp/cabinet/index.js",
			"docs/public/vendor/vessel-dsp/visual-effects/index.js",
		]) {
			expect(existsSync(join(ROOT_DIR, path))).toBe(true);
		}
		const ampVendor = readRepoFile("docs/public/vendor/vessel-dsp/amp/index.js");
		expect(ampVendor).toContain("amp-grille-net");
		expect(ampVendor).toContain('AMP_GRILLE_NET_COLOR = "#cccccc"');
		expect(ampVendor).not.toContain('from "@vessel-dsp/core"');
		const cabinetVendor = readRepoFile(
			"docs/public/vendor/vessel-dsp/cabinet/index.js",
		);
		expect(cabinetVendor).toContain("cabinet-grille-net");
		expect(cabinetVendor).toContain('CABINET_GRILLE_NET_COLOR = "#cccccc"');
		expect(cabinetVendor).not.toContain('from "@vessel-dsp/core"');

		const controlsPage = readRepoFile(
			"docs/src/content/docs/guides/controls.mdx",
		);
		expect(controlsPage).toContain("title: Controls");
		expect(controlsPage).toContain("extractPanel(document)");
		expect(controlsPage).toContain("parseCircuitDocumentFile");
		expect(controlsPage).toContain("CircuitDocument");
		expect(controlsPage).toContain("PanelPlacementMetadata");
		expect(controlsPage).toContain('kind: "potentiometer"');
		expect(controlsPage).toContain('RuntimeDescriptor: "true"');
		expect(controlsPage).toContain("Wipe");
		expect(controlsPage).toContain("StepLabels");
		expect(controlsPage).toContain("ControlStyle");
		expect(controlsPage).toContain("Role");
		expect(controlsPage).toContain("ControlRole");
		expect(controlsPage).toContain("CONTROL_ROLE_VALUES");
		expect(controlsPage).toContain("validateDocument(document, { rules:");
		expect(controlsPage).toContain("harmony-voice-a");
		expect(controlsPage).toContain("panel.faces[]");
		expect(controlsPage).toContain("extractDeviceInterface");
		expect(controlsPage).toContain("PanelMessage");
		expect(controlsPage).toContain("defaultControlState");
		expect(controlsPage).toContain("@vessel-dsp/control-ui");
		expect(controlsPage).toContain("@vessel-dsp/stompbox");
		expect(controlsPage).not.toMatch(/playground|workbench|custom editor/i);

		const controlUiPage = readRepoFile(
			"docs/src/content/docs/guides/control-ui.mdx",
		);
		expect(controlUiPage).toContain("title: Control UI");
		expect(controlUiPage).toContain(
			'import ControlUiRenderedExample from "../../../components/ControlUiRenderedExample.astro";',
		);
		expect(controlUiPage).toContain("<ControlUiRenderedExample />");
		expect(controlUiPage).toContain("## Rendered UI");
		expect(controlUiPage).toContain(
			"npm install @vessel-dsp/core @vessel-dsp/control-ui react react-dom",
		);
		expect(controlUiPage).toContain("@vessel-dsp/control-ui/styles.css");
		expect(controlUiPage).toContain("ControlSurface");
		expect(controlUiPage).toContain("ControlUiThemeProvider");
		expect(controlUiPage).toContain("createControlUiState");
		expect(controlUiPage).toContain("PedalControlExample");
		expect(controlUiPage).toContain("useControlState");
		expect(controlUiPage).toContain("onPanelMessage");
		expect(controlUiPage).toContain('bypass: "footswitch"');
		expect(controlUiPage).toContain('mode: "detented-rotary-select"');
		expect(controlUiPage).toContain("onMessage={controls.dispatchMessage}");
		expect(controlUiPage).toContain("className");
		expect(controlUiPage).toContain("classNames");
		expect(controlUiPage).toContain("Tailwind");
		expect(controlUiPage).toContain("theme");
		expect(controlUiPage).toContain("PanelMessage");
		expect(controlUiPage).not.toMatch(/playground|workbench/i);

		const controlUiExample = readRepoFile(
			"docs/src/components/ControlUiRenderedExample.astro",
		);
		expect(controlUiExample).toContain("renderToStaticMarkup");
		expect(controlUiExample).toContain("createRoot");
		expect(controlUiExample).toContain("ControlUiRenderedExampleClient");
		expect(controlUiExample).toContain("data-control-ui-rendered-example");
		expect(controlUiExample).toContain("ControlSurface");
		expect(controlUiExample).toContain("ControlUiThemeProvider");
		expect(controlUiExample).toContain(
			"../../../packages/control-ui/src/styles.css",
		);
		expect(controlUiExample).toContain("control-ui-rendered-example__panel");

		const controlUiExampleClient = readRepoFile(
			"docs/src/components/ControlUiRenderedExampleClient.tsx",
		);
		expect(controlUiExampleClient).toContain('import React from "react";');
		expect(controlUiExampleClient).toContain("useControlState");
		expect(controlUiExampleClient).toContain("controls.dispatchMessage");
		expect(controlUiExampleClient).not.toContain("console.log");
		expect(controlUiExampleClient).not.toContain(
			"[vessel-dsp/control-ui] PanelMessage emitted",
		);

		const controlUiExampleData = readRepoFile(
			"docs/src/components/control-ui-rendered-example-data.ts",
		);
		expect(controlUiExampleData).toContain("createControlUiState");
		expect(controlUiExampleData).toContain('bypass: "footswitch"');
		expect(controlUiExampleData).toContain('mode: "detented-rotary-select"');

		const demoProfiles = readRepoJson<{
			defaultStyleProfileId?: string;
			artifactCadPartsRoot?: string;
			partProfiles?: Record<
				string,
				{
					label?: string;
					geometry?: {
						kind?: string;
						diameterMm?: number;
						outerDiameterMm?: number;
					};
					assets?: { glbRelativePath?: string; stepRelativePath?: string };
				}
			>;
			enclosureProfiles?: Record<
				string,
				{
					topFace?: {
						usableRectMm?: {
							x?: number;
							y?: number;
							width?: number;
							height?: number;
						};
					};
				}
			>;
			styleProfiles?: readonly {
				id?: string;
				defaultPartIds?: {
					largeKnob?: string;
					knob?: string;
					smallKnob?: string;
				};
				layout?: { knobGrid?: string; sideHardware?: string };
			}[];
			previewPresets?: readonly {
				id?: string;
				label?: string;
				src?: string;
				drillTemplateSrc?: string;
				drillLayoutSrc?: string;
				backgroundColor?: string;
				gridColor?: string;
				gridOpacity?: number;
				toon?: boolean;
				toonEdgeColor?: string;
				grain?: boolean;
				grainScale?: number;
				grainIntensity?: number;
				linework?: boolean;
				lineworkColor?: string;
				crt?: boolean;
				glitch?: boolean;
			}[];
		}>("docs/src/data/stompbox-demo-profiles.json");
		expect(demoProfiles.defaultStyleProfileId).toBe("mxr-style");
		expect(demoProfiles.artifactCadPartsRoot).toBe(
			"packages/stompbox/assets/cad/parts",
		);
		expect(
			demoProfiles.enclosureProfiles?.["box-1590b"]?.topFace?.usableRectMm,
		).toEqual({
			x: -29.25,
			y: -54.75,
			width: 58.5,
			height: 109.5,
		});
		expect(
			demoProfiles.enclosureProfiles?.["box-1590a"]?.topFace?.usableRectMm,
		).toEqual({
			x: -18.5,
			y: -45.25,
			width: 37,
			height: 90.5,
		});
		expect(demoProfiles.styleProfiles?.map((profile) => profile.id)).toEqual([
			"mxr-style",
			"boss-style",
		]);
		expect(
			demoProfiles.styleProfiles?.find((profile) => profile.id === "boss-style")
				?.defaultPartIds,
		).toEqual({
			largeKnob: "knob-davies-1105",
			knob: "knob-davies-1100",
			smallKnob: "knob-davies-1900h",
		});
		expect(
			demoProfiles.styleProfiles?.find((profile) => profile.id === "mxr-style")
				?.defaultPartIds,
		).toEqual({
			largeKnob: "knob-mxr-style-fluted-large",
			knob: "knob-mxr-style-fluted-medium",
			smallKnob: "knob-mxr-style-fluted-small",
		});
		expect(
			demoProfiles.partProfiles?.["knob-davies-1100"]?.geometry?.diameterMm,
		).toBeCloseTo(19.81, 2);
		expect(
			demoProfiles.partProfiles?.["knob-davies-1105"]?.geometry?.diameterMm,
		).toBeCloseTo(26.92, 2);
		expect(
			demoProfiles.partProfiles?.["knob-davies-1900h"]?.geometry?.diameterMm,
		).toBeCloseTo(12.8, 2);
		expect(
			demoProfiles.partProfiles?.["knob-mxr-style-fluted-small"]?.geometry
				?.diameterMm,
		).toBeCloseTo(20.2, 2);
		expect(
			demoProfiles.partProfiles?.["knob-mxr-style-fluted-medium"]?.geometry
				?.diameterMm,
		).toBeCloseTo(24.4, 2);
		expect(
			demoProfiles.partProfiles?.["knob-mxr-style-fluted-large"]?.geometry
				?.diameterMm,
		).toBeCloseTo(29.9, 2);
		expect(
			demoProfiles.partProfiles?.["led-bezel-lh5"]?.assets?.glbRelativePath,
		).toBe("led-bezel-lh5/.pedal-parts-and-kits-bzl-5mm-p.step.glb");
		expect(demoProfiles.previewPresets?.map((preset) => preset.id)).toEqual([
			"mxr-style",
			"boss-style",
		]);
		expect(demoProfiles.previewPresets?.map((preset) => preset.src)).toEqual([
			"/core/examples/stompbox-mxr-style-preview.glb",
			"/core/examples/stompbox-boss-style-preview.glb",
		]);
		expect(
			demoProfiles.previewPresets?.map((preset) => preset.drillTemplateSrc),
		).toEqual([
			"/core/examples/stompbox-mxr-style-drill-template-preview.svg",
			"/core/examples/stompbox-boss-style-drill-template-preview.svg",
		]);
		expect(
			demoProfiles.previewPresets?.map((preset) => preset.drillLayoutSrc),
		).toEqual([
			"/core/examples/stompbox-mxr-style-drill-layout.json",
			"/core/examples/stompbox-boss-style-drill-layout.json",
		]);
		expect(demoProfiles.previewPresets?.map((preset) => preset.label)).toEqual([
			"MXR style, two knobs",
			"Boss style, three knobs",
		]);
		expect(demoProfiles.previewPresets?.map((preset) => preset.toon)).toEqual([
			true,
			true,
		]);
		expect(demoProfiles.previewPresets?.map((preset) => preset.grain)).toEqual([
			true,
			true,
		]);
		expect(demoProfiles.previewPresets?.map((preset) => preset.crt)).toEqual([
			true,
			true,
		]);
		expect(demoProfiles.previewPresets?.map((preset) => preset.glitch)).toEqual([
			true,
			true,
		]);
		expect(
			demoProfiles.previewPresets?.map((preset) => preset.linework),
		).toEqual([true, true]);

		const viewer = readRepoFile("docs/src/components/StompboxGlbViewer.astro");
		expect(viewer).toContain("data-stompbox-glb-viewer");
		expect(viewer).not.toContain("data-stompbox-preset-select");
		expect(viewer).not.toContain("stompbox-glb-viewer__toolbar");
		expect(viewer).not.toContain("data-stompbox-live-state-controls");
		expect(viewer).not.toContain("stompbox-glb-viewer__live-state");
		expect(viewer).toContain("data-view-mode");
		expect(viewer).toContain("data-interactive");
		expect(viewer).toContain("linework?: boolean;");
		expect(viewer).toContain("lineworkColor?: string;");
		expect(viewer).toContain("backgroundColor?: string;");
		expect(viewer).toContain("gridColor?: string;");
		expect(viewer).toContain("gridOpacity?: number;");
		expect(viewer).toContain("toon?: boolean;");
		expect(viewer).toContain("toonEdgeColor?: string;");
		expect(viewer).toContain("grain?: boolean;");
		expect(viewer).toContain("grainScale?: number;");
		expect(viewer).toContain("grainIntensity?: number;");
		expect(viewer).toContain("props.grainIntensity ?? 0.05");
		expect(viewer).toContain("crtBrightness?: number;");
		expect(viewer).toContain("crtContrast?: number;");
		expect(viewer).toContain("crtSaturation?: number;");
		expect(viewer).toContain("props.crtVignette ?? 0.75");
		expect(viewer).toContain("props.crtContrast ?? 0.95");
		expect(viewer).toContain("props.crtBloomIntensity ?? 0.5");
		expect(viewer).toContain("props.crtBloomThreshold ?? 0.75");
		expect(viewer).toContain("data-linework");
		expect(viewer).toContain("data-linework-color");
		expect(viewer).toContain("data-background-color");
		expect(viewer).toContain("data-grid-color");
		expect(viewer).toContain("data-grid-opacity");
		expect(viewer).toContain("data-toon");
		expect(viewer).toContain("data-toon-edge-color");
		expect(viewer).toContain("data-grain");
		expect(viewer).toContain("data-grain-scale");
		expect(viewer).toContain("data-grain-intensity");
		expect(viewer).toContain("data-crt-brightness");
		expect(viewer).toContain("data-crt-contrast");
		expect(viewer).toContain("data-crt-saturation");
		expect(viewer).toContain("--stompbox-viewer-background-color");
		expect(viewer).toContain("--stompbox-viewer-grid-color");
		expect(viewer).toContain("--stompbox-viewer-grid-opacity");
		expect(viewer).toContain(
			'"three": "/core/vendor/three/build/three.module.js"',
		);
		expect(viewer).toContain(
			'"@vessel-dsp/visual-effects": "/core/vendor/vessel-dsp/visual-effects/index.js"',
		);
		expect(viewer).toContain('src="/core/stompbox-glb-viewer.js"');

		const presetGroup = readRepoFile(
			"docs/src/components/StompboxPreviewPresetGroup.astro",
		);
		expect(presetGroup).toContain("type StompboxPreviewPreset");
		expect(presetGroup).toContain("data-stompbox-preview-preset-group");
		expect(presetGroup).toContain("data-stompbox-preset-select");
		expect(presetGroup).toContain("data-stompbox-presets");
		expect(presetGroup).toContain("data-stompbox-live-state-controls");
		expect(presetGroup).toContain("stompbox-preview-preset-group__live-state");
		expect(presetGroup).toContain("data-stompbox-effect-controls");
		expect(presetGroup).toContain('data-effect-toggle="toon"');
		expect(presetGroup).toContain('data-effect-toggle="grain"');
		expect(presetGroup).toContain('data-effect-toggle="glitch"');
		expect(presetGroup).toContain('data-effect-toggle="crt"');
		expect(presetGroup).toContain("backgroundColor?: string;");
		expect(presetGroup).toContain("gridColor?: string;");
		expect(presetGroup).toContain("gridOpacity?: number;");
		expect(presetGroup).toContain("toon?: boolean;");
		expect(presetGroup).toContain("toonEdgeColor?: string;");
		expect(presetGroup).toContain("grain?: boolean;");
		expect(presetGroup).toContain("grainScale?: number;");
		expect(presetGroup).toContain("grainIntensity?: number;");
		expect(presetGroup).toContain("crtBrightness?: number;");
		expect(presetGroup).toContain("crtContrast?: number;");
		expect(presetGroup).toContain("crtSaturation?: number;");
		expect(presetGroup).toContain("<slot />");

		const viewerRuntime = readRepoFile("docs/public/stompbox-glb-viewer.js");
		expect(viewerRuntime).toContain('import * as THREE from "three";');
		expect(viewerRuntime).toContain(
			'import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";',
		);
		expect(viewerRuntime).toContain(
			'import { OrbitControls } from "three/addons/controls/OrbitControls.js";',
		);
		expect(viewerRuntime).toContain("resolvePreviewEffectPreset");
		expect(viewerRuntime).toContain("createPreviewEffectPipeline");
		expect(viewerRuntime).toContain("VESSEL_PREVIEW_EFFECT_DEFAULTS");
		expect(viewerRuntime).toContain("THREE.OrthographicCamera");
		expect(viewerRuntime).toContain("frameOrthographicTopModel");
		expect(viewerRuntime).toContain("findEnclosureFrame");
		expect(viewerRuntime).toContain("applyDecalMaterial");
		expect(viewerRuntime).toContain("createDecalTexture");
		expect(viewerRuntime).toContain('decal.decalKind === "svg"');
		expect(viewerRuntime).toContain("createImageDecalTexture");
		expect(viewerRuntime).toContain('decal.decalKind === "image"');
		expect(viewerRuntime).toContain("ensureDecalUv");
		expect(viewerRuntime).toContain("TEXT_DECAL_UVS");
		expect(viewerRuntime).toContain("THREE.CanvasTexture");
		expect(viewerRuntime).toContain("THREE.TextureLoader");
		expect(viewerRuntime).toContain("colorizedSvg");
		expect(viewerRuntime).toContain("texture.flipY = false");
		expect(viewerRuntime).toContain("preserveDrawingBuffer: true");
		expect(viewerRuntime).toContain("applyFlatAppearanceColorMaterial");
		expect(viewerRuntime).toContain("renderColorMode");
		expect(viewerRuntime).toContain("THREE.MeshBasicMaterial");
		expect(viewerRuntime).toContain("DEFAULT_BACKGROUND_COLOR");
		expect(viewerRuntime).toContain("DEFAULT_GRID_COLOR");
		expect(viewerRuntime).toContain("DEFAULT_GRID_OPACITY");
		expect(viewerRuntime).toContain("DEFAULT_GRID_SIZE_PX = 24");
		expect(viewerRuntime).toContain("GLITCH_STRIP_WIDTH = 0.012");
		expect(viewerRuntime).toContain("VESSEL_PREVIEW_EFFECT_DEFAULTS");
		expect(viewerRuntime).toContain(
			"VESSEL_PREVIEW_EFFECT_DEFAULTS.toonEdgeColor",
		);
		expect(viewerRuntime).toContain("VESSEL_PREVIEW_EFFECT_DEFAULTS.grainScale");
		expect(viewerRuntime).toContain(
			"VESSEL_PREVIEW_EFFECT_DEFAULTS.grainIntensity",
		);
		expect(viewerRuntime).toContain(
			"VESSEL_PREVIEW_EFFECT_DEFAULTS.crtContrast",
		);
		expect(viewerRuntime).toContain("uniforms.contrast.value = preset.crtContrast");
		expect(viewerRuntime).toContain(
			"uniforms.saturation.value = preset.crtSaturation",
		);
		expect(viewerRuntime).toContain("previewBackgroundColor");
		expect(viewerRuntime).toContain("previewCrtBackgroundForPreset");
		expect(viewerRuntime).toContain(
			"initialPipeline.crtFragmentShader(CRTShader.fragmentShader)",
		);
		expect(viewerRuntime).toContain("crt.configure(effectPipeline)");
		expect(viewerRuntime).toContain("visualPreset");
		expect(viewerRuntime).not.toContain("stompboxCrtPreviewBackground");
		expect(viewerRuntime).not.toContain("const curvedBoundsClamp");
		expect(viewerRuntime).not.toContain(
			"function crtFragmentShaderWithOutputEncoding",
		);
		expect(viewerRuntime).toContain(
			"glitchIntervalSeconds: activePreset.glitchInterval",
		);
		expect(viewerRuntime).not.toContain("const DEFAULT_TOON_EDGE_COLOR");
		expect(viewerRuntime).not.toContain("const DEFAULT_GRAIN_SCALE");
		expect(viewerRuntime).not.toContain("const DEFAULT_GRAIN_INTENSITY");
		expect(viewerRuntime).toContain("GRAIN_INTENSITY_SCALE = 0.35");
		expect(viewerRuntime).toContain(
			"applyScreenGrainMaterials(model, visualPreset)",
		);
		expect(viewerRuntime).toContain("material.onBeforeCompile");
		expect(viewerRuntime).toContain("material.userData.screenGrainApplied");
		expect(viewerRuntime).toContain("gl_FragCoord.xy");
		expect(viewerRuntime).toContain("grainIntensity");
		expect(viewerRuntime).toContain("stompboxScreenGrainValue - 0.5");
		expect(viewerRuntime).not.toContain("max(gl_FragColor.rgb");
		expect(viewerRuntime).not.toContain("createGrainOverlayScene");
		expect(viewerRuntime).not.toContain(
			"applyGrainOverlay(renderer, grainOverlay, preset)",
		);
		expect(viewerRuntime).not.toContain("renderer.autoClear = false");
		expect(viewerRuntime).not.toContain("new THREE.PlaneGeometry(2, 2)");
		expect(viewerRuntime).toContain("THREE.MeshToonMaterial");
		expect(viewerRuntime).toContain("createToonGradientMap");
		expect(viewerRuntime).toContain("applyToonMaterials(model, visualPreset)");
		expect(viewerRuntime).toContain("material.userData.toonSourceMaterial");
		expect(viewerRuntime).toContain("applyPresetBackground(viewer, preset)");
		expect(viewerRuntime).toContain(
			'viewer.style.setProperty("--stompbox-viewer-background-color"',
		);
		expect(viewerRuntime).toContain(
			'viewer.style.setProperty("--stompbox-viewer-grid-color"',
		);
		expect(viewerRuntime).toContain(
			'viewer.style.setProperty("--stompbox-viewer-grid-opacity"',
		);
		expect(viewerRuntime).toContain(
			"renderer.setClearColor(new THREE.Color(DEFAULT_BACKGROUND_COLOR), 0)",
		);
		expect(viewerRuntime).toContain("alpha: true");
		expect(viewerRuntime).toContain("addCadLinework");
		expect(viewerRuntime).toContain("initPresetLinkedAssets");
		expect(viewerRuntime).toContain("initEffectToggleControls");
		expect(viewerRuntime).toContain("applyEffectToggleState");
		expect(viewerRuntime).toContain("stompbox-effect-controls-change");
		expect(viewerRuntime).toContain("[data-effect-toggle]");
		expect(viewerRuntime).toContain("updatePresetLinkedAssets");
		expect(viewerRuntime).toContain("parsePresetOptions");
		expect(viewerRuntime).toContain("presetSelectForViewer");
		expect(viewerRuntime).toContain("liveStatePanelForViewer");
		expect(viewerRuntime).toContain("liveStateStoreForViewer");
		expect(viewerRuntime).toContain("applyLiveStateToRegisteredViewers");
		expect(viewerRuntime).toContain(
			"return group !== null && group.querySelector",
		);
		expect(viewerRuntime).toContain("FOOTSWITCH_AUTO_RELEASE_MS");
		expect(viewerRuntime).toContain("FOOTSWITCH_ANIMATION_MS");
		expect(viewerRuntime).toContain("KNOB_LEFT_END_ROTATION_DEG = 135");
		expect(viewerRuntime).toContain("KNOB_ROTATION_SWEEP_DEG = -270");
		expect(viewerRuntime).toContain(
			"updateLiveStateAnimations(viewer, deltaMs)",
		);
		expect(viewerRuntime).toContain("simulateFootswitchTap");
		expect(viewerRuntime).toContain("startFootswitchPress");
		expect(viewerRuntime).toContain("releaseFootswitchPress");
		expect(viewerRuntime).toContain('button.addEventListener("pointerdown"');
		expect(viewerRuntime).toContain('button.addEventListener("pointerup"');
		expect(viewerRuntime).toContain('button.addEventListener("keydown"');
		expect(viewerRuntime).toContain('button.addEventListener("keyup"');
		expect(viewerRuntime).toContain("store.pressStartedAt");
		expect(viewerRuntime).toContain("store.releaseTimers");
		expect(viewerRuntime).toContain("footswitch.targetTravelMm");
		expect(viewerRuntime).toContain("footswitch.currentTravelMm");
		expect(viewerRuntime).toContain("localTravelForWorldMillimeters");
		expect(viewerRuntime).toContain("parentWorldScaleForLocalAxis");
		expect(viewerRuntime).toContain("footswitch.actuator.position");
		expect(viewerRuntime).not.toContain("footswitch.node.position");
		expect(viewerRuntime).toMatch(
			/return\s*\(?\s*KNOB_LEFT_END_ROTATION_DEG\s*\+\s*clamp01\(position\)\s*\*\s*KNOB_ROTATION_SWEEP_DEG\s*\)?;/,
		);
		expect(viewerRuntime).toMatch(
			/return\s+clamp01\(\s*\(rotationDeg\s*-\s*KNOB_LEFT_END_ROTATION_DEG\)\s*\/\s*KNOB_ROTATION_SWEEP_DEG,\s*\);/,
		);
		expect(viewerRuntime).toContain("updateFootswitchButton");
		expect(viewerRuntime).toContain("syncLedStateControls");
		expect(viewerRuntime).toContain("data-stompbox-led-toggle");
		expect(viewerRuntime).toContain("window.setTimeout");
		expect(viewerRuntime).toContain("store.state.latches");
		expect(viewerRuntime).toContain("store.state.leds.size === 1");
		expect(viewerRuntime).toContain("object.userData?.name === nodeName");
		expect(viewerRuntime).not.toContain("button.disabled = pressed");
		expect(viewerRuntime).toContain('input.type = "checkbox";');
		expect(viewerRuntime).toContain('input.setAttribute("role", "switch");');
		expect(viewerRuntime).toContain("loadPreset");
		expect(viewerRuntime).toContain('select.addEventListener("change"');
		expect(viewerRuntime).toContain(
			'viewer.closest("[data-stompbox-preview-preset-group]")',
		);
		expect(viewerRuntime).toContain("group?.dataset.stompboxPresets");
		expect(viewerRuntime).toContain("data-stompbox-drill-template-preview");
		expect(viewerRuntime).toContain("data-stompbox-drill-layout-download");
		expect(viewerRuntime).toContain(
			'const lineworkEnabled = viewer.dataset.linework === "true";',
		);
		expect(viewerRuntime).toContain(
			'const lineworkColor = viewer.dataset.lineworkColor ?? "#111827";',
		);
		expect(viewerRuntime).toContain(
			'const toonEnabled = viewer.dataset.toon === "true";',
		);
		expect(viewerRuntime).toContain(
			'const grainEnabled = viewer.dataset.grain === "true";',
		);
		expect(viewerRuntime).toMatch(
			/normalizePositiveNumber\(\s*viewer\.dataset\.grainScale,\s*VESSEL_PREVIEW_EFFECT_DEFAULTS\.grainScale,\s*\)/,
		);
		expect(viewerRuntime).toMatch(
			/normalizeUnitInterval\(\s*viewer\.dataset\.grainIntensity,\s*VESSEL_PREVIEW_EFFECT_DEFAULTS\.grainIntensity,\s*\)/,
		);
		expect(viewerRuntime).toContain("if (visualPreset.toon)");
		expect(viewerRuntime).toContain(
			"if (visualPreset.linework && !visualPreset.toon)",
		);
		expect(viewerRuntime).toContain("const TOON_OUTLINE_SCALE = 1.02;");
		expect(viewerRuntime).toContain(
			"addToonOutline(model, visualPreset.toonEdgeColor);",
		);
		expect(viewerRuntime).toContain("new THREE.Color(lineworkColor)");
		expect(viewerRuntime).toContain("THREE.EdgesGeometry");
		expect(viewerRuntime).toContain("THREE.LineSegments");
		expect(viewerRuntime).toMatch(
			/function\s+addToonOutline\s*\(\s*root,\s*outlineColor\s*=\s*VESSEL_PREVIEW_EFFECT_DEFAULTS\.toonEdgeColor\s*\)/,
		);
		expect(viewerRuntime).toContain("new THREE.MeshBasicMaterial");
		expect(viewerRuntime).toContain("side: THREE.BackSide");
		expect(viewerRuntime).toContain(
			"outline.scale.setScalar(TOON_OUTLINE_SCALE);",
		);
		expect(viewerRuntime).toContain(
			"outline.position.copy(center).multiplyScalar(1 - TOON_OUTLINE_SCALE);",
		);
		expect(viewerRuntime).toContain('outline.userData.kind = "toon-outline";');

		expect(
			existsSync(
				join(ROOT_DIR, "docs/public/vendor/three/build/three.module.js"),
			),
		).toBe(true);
		expect(
			existsSync(
				join(ROOT_DIR, "docs/public/vendor/three/build/three.core.js"),
			),
		).toBe(true);
		expect(
			existsSync(
				join(ROOT_DIR, "docs/public/vendor/three/addons/loaders/GLTFLoader.js"),
			),
		).toBe(true);
		expect(
			existsSync(
				join(
					ROOT_DIR,
					"docs/public/vendor/vessel-dsp/visual-effects/index.js",
				),
			),
		).toBe(true);
		expect(
			existsSync(
				join(
					ROOT_DIR,
					"docs/public/vendor/three/addons/controls/OrbitControls.js",
				),
			),
		).toBe(true);
		expect(
			existsSync(
				join(
					ROOT_DIR,
					"docs/public/vendor/three/addons/geometries/RoundedBoxGeometry.js",
				),
			),
		).toBe(true);
	});

	test("wires the rendered Control UI demo toggle to the status LED", () => {
		const brightOnState = controlUiRenderedExampleStateForMessage(
			{
				...controlUiRenderedExampleInitialState,
				bright: { kind: "switch", position: 1 },
			},
			{
				type: "control/set",
				controlId: "bright",
				value: { kind: "switch", position: 1 },
			},
		);
		expect(brightOnState.status).toEqual({
			kind: "led",
			on: true,
			intensity: 0.85,
		});

		const brightOffState = controlUiRenderedExampleStateForMessage(
			{
				...controlUiRenderedExampleInitialState,
				bright: { kind: "switch", position: 0 },
			},
			{
				type: "control/set",
				controlId: "bright",
				value: { kind: "switch", position: 0 },
			},
		);
		expect(brightOffState.status).toEqual({ kind: "led", on: false });
	});

	test("includes generated stompbox preview and drill layout example assets", () => {
		const topPreview = readRepoFile(
			"docs/public/examples/stompbox-mxr-style-preview-top.svg",
		);
		expect(topPreview).toContain("<svg");
		expect(topPreview).toContain("Stompbox preview top view");
		expect(topPreview).toContain("data-control-id");
		expect(topPreview).toContain(
			'transform="translate(54.2 55.75) rotate(90)"',
		);
		expect(topPreview).toContain(
			'transform="translate(6.3 55.75) rotate(-90)"',
		);
		expect(topPreview).not.toContain("label-led");
		expect(topPreview).not.toContain("READY");
		expect(topPreview).not.toContain("data-top-edge-projection");

		const drillPreview = readRepoFile(
			"docs/public/examples/stompbox-mxr-style-drill-template-preview.svg",
		);
		expect(drillPreview).toContain("<svg");
		expect(drillPreview).toContain("Stompbox drill template preview");
		expect(drillPreview).toContain("drill-hole-center-dot");
		expect(drillPreview).toContain(".hole{fill:none;");
		expect(drillPreview).not.toContain("READY");
		expect(drillPreview).not.toContain("#f97316");
		expect(drillPreview).not.toContain("#7c2d12");
		expect(drillPreview).not.toContain('fill="#faf5ff"');

		const layout = JSON.parse(
			readRepoFile("docs/public/examples/stompbox-mxr-style-drill-layout.json"),
		) as {
			schema?: string;
			holes?: readonly { partId?: string }[];
		};
		expect(layout.schema).toBe("stompbox-drill-layout/v1");
		expect(
			layout.holes?.filter(
				(hole) => hole.partId === "knob-mxr-style-fluted-small",
			),
		).toHaveLength(2);

		const bossDrillPreview = readRepoFile(
			"docs/public/examples/stompbox-boss-style-drill-template-preview.svg",
		);
		expect(bossDrillPreview).toContain("<svg");
		expect(bossDrillPreview).toContain("Stompbox drill template preview");
		const bossLayout = JSON.parse(
			readRepoFile(
				"docs/public/examples/stompbox-boss-style-drill-layout.json",
			),
		) as {
			schema?: string;
			holes?: readonly { partId?: string }[];
		};
		expect(bossLayout.schema).toBe("stompbox-drill-layout/v1");
		expect(
			bossLayout.holes?.filter((hole) => hole.partId === "knob-davies-1100"),
		).toHaveLength(2);

		expect(
			existsSync(
				join(
					ROOT_DIR,
					"docs/public/examples/stompbox-compact-1590a-drill-template-preview.svg",
				),
			),
		).toBe(false);
		expect(
			existsSync(
				join(
					ROOT_DIR,
					"docs/public/examples/stompbox-compact-1590a-drill-layout.json",
				),
			),
		).toBe(false);

		const glb = readRepoBytes(
			"docs/public/examples/stompbox-mxr-style-preview.glb",
		);
		expect(glb.subarray(0, 4).toString("utf8")).toBe("glTF");
		expect(glb.includes(Buffer.from("stateTargets"))).toBe(true);
		expect(glb.includes(Buffer.from("led-LED1"))).toBe(true);
		expect(glb.includes(Buffer.from("switch-SW1"))).toBe(true);
		expect(glb.includes(Buffer.from("knob-indicator-knob-GAIN"))).toBe(false);
		expect(glb.includes(Buffer.from("knob-indicator-knob-LEVEL"))).toBe(false);
		expect(glb.includes(Buffer.from("label-led"))).toBe(false);

		const bossGlb = readRepoBytes(
			"docs/public/examples/stompbox-boss-style-preview.glb",
		);
		expect(bossGlb.subarray(0, 4).toString("utf8")).toBe("glTF");
		expect(bossGlb.includes(Buffer.from("stateTargets"))).toBe(true);
		expect(bossGlb.includes(Buffer.from("led-status"))).toBe(true);
		expect(bossGlb.includes(Buffer.from("switch-bypass"))).toBe(true);
		expect(bossGlb.includes(Buffer.from("#fae464"))).toBe(true);
		expect(bossGlb.includes(Buffer.from("part-knob-RATE"))).toBe(true);
		expect(bossGlb.includes(Buffer.from("label-led"))).toBe(false);

		expect(
			existsSync(
				join(
					ROOT_DIR,
					"docs/public/examples/stompbox-compact-1590a-preview.glb",
				),
			),
		).toBe(false);
	});

	test("includes a Pro Co Rat schematic example backed by the LiveSPICE fixture", () => {
		const examplesPage = readRepoFile(
			"docs/src/content/docs/examples/pro-co-rat.mdx",
		);
		expect(examplesPage).toContain("title: Pro Co Rat Schematic");
		expect(examplesPage).toContain(
			"tests/fixtures/schx/livespice-examples/Pro Co Rat.schx",
		);
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
		expect(examplesPage).toContain(
			"Yes. Use `extractPanel(document)` from `@vessel-dsp/core`.",
		);
		expect(examplesPage).toContain("extractPanel");
		expect(examplesPage).toContain("const panel = extractPanel(vdspDocument);");
		expect(examplesPage).toContain('["Distortion", "Tone", "Volume"]');
		expect(examplesPage).toContain('"jacks": ["V1:input", "S1:output"]');
		expect(examplesPage).toContain("movePanelElement");
		expect(examplesPage).toContain('elementId: "tone-knob"');
		expect(examplesPage).toContain("centerMm: { x: 12, y: -18 }");
		expect(examplesPage).toContain(
			'serializeCircuitDocumentFile(movedDocument, { format: "vdsp" })',
		);

		const svg = readRepoFile("docs/public/examples/pro-co-rat-schematic.svg");
		expect(svg).toContain("<svg");
		expect(svg).toContain("Pro Co Rat");
		expect(svg).toContain("LM308");
		expect(svg).toContain("1N914");
		expect(svg).toContain("Tone / Filter");
	});
});
