import { describe, expect, test } from "bun:test";
import {
	addToonOutlines,
	applyMaterialGrain,
	applyToonMaterials,
	createGlitchPass,
	createPreviewEffectPipeline,
	resolvePreviewEffectPreset,
	VESSEL_PREVIEW_EFFECT_DEFAULTS,
} from "@vessel-dsp/visual-effects";
import * as THREE from "three";

describe("visual effects", () => {
	test("exports the shared stompbox, amp, and cabinet effect defaults", () => {
		expect(VESSEL_PREVIEW_EFFECT_DEFAULTS).toEqual({
			schema: "vessel-preview-effects/v1",
			toon: false,
			toonEdgeColor: "#69145a",
			grain: false,
			grainScale: 1.15,
			grainIntensity: 0.1,
			glitch: false,
			glitchIntervalSeconds: 8,
			crt: false,
			crtCurvature: 0.15,
			crtScanlineIntensity: 0.2,
			crtScanlineCount: 500,
			crtVignette: 0.75,
			crtRgbShift: 1,
			crtFlicker: 0.05,
			crtBrightness: 1,
			crtContrast: 0.95,
			crtSaturation: 0.96,
			crtBloomIntensity: 0.5,
			crtBloomThreshold: 0.75,
			reducedMotion: false,
		});
	});

	test("normalizes effect presets and disables glitch for reduced motion", () => {
		expect(
			resolvePreviewEffectPreset({
				schema: "vessel-preview-effects/v1",
				toon: true,
				grain: true,
				grainScale: -1,
				grainIntensity: 2,
				glitch: true,
				glitchIntervalSeconds: 0,
				reducedMotion: true,
			}),
		).toEqual({
			schema: "vessel-preview-effects/v1",
			toon: true,
			toonEdgeColor: "#69145a",
			grain: true,
			grainScale: 1.15,
			grainIntensity: 1,
			glitch: false,
			glitchIntervalSeconds: 8,
			crt: false,
			crtCurvature: 0.15,
			crtScanlineIntensity: 0.2,
			crtScanlineCount: 500,
			crtVignette: 0.75,
			crtRgbShift: 1,
			crtFlicker: 0.05,
			crtBrightness: 1,
			crtContrast: 0.95,
			crtSaturation: 0.96,
			crtBloomIntensity: 0.5,
			crtBloomThreshold: 0.75,
			reducedMotion: true,
		});
	});

	test("applies toon materials, outlines, and grain idempotently", () => {
		const root = new THREE.Group();
		const mesh = new THREE.Mesh(
			new THREE.BoxGeometry(1, 1, 1),
			new THREE.MeshStandardMaterial({ color: "#884422" }),
		);
		mesh.name = "body";
		root.add(mesh);
		const preset = resolvePreviewEffectPreset({
			schema: "vessel-preview-effects/v1",
			toon: true,
			grain: true,
		});

		applyToonMaterials(root, preset);
		addToonOutlines(root, preset);
		addToonOutlines(root, preset);
		applyMaterialGrain(root, preset);
		applyMaterialGrain(root, preset);

		expect((mesh.material as THREE.Material).type).toBe("MeshToonMaterial");
		expect(mesh.userData.visualEffects?.toon).toBe(true);
		expect(
			mesh.children.filter((child) => child.userData.kind === "toon-outline"),
		).toHaveLength(1);
		expect(
			root.children.filter((child) => child.userData.kind === "toon-outline"),
		).toHaveLength(0);
		expect((mesh.material as THREE.Material).userData.grainApplied).toBe(true);
	});

	test("creates a reduced-motion-aware glitch pass", () => {
		const pass = createGlitchPass({
			schema: "vessel-preview-effects/v1",
			glitch: true,
			reducedMotion: true,
		});

		expect(pass.enabled).toBe(false);
		expect(pass.kind).toBe("vessel-glitch-pass");
	});

	test("creates a shared preview pipeline for material and CRT screen effects", () => {
		const pipeline = createPreviewEffectPipeline(
			{
				schema: "vessel-preview-effects/v1",
				toon: true,
				grain: true,
				crt: true,
				glitch: true,
			},
			{
				crtBackground: {
					enabled: true,
					backgroundColor: "#091833",
					gridColor: "#cccccc",
					gridOpacity: 0.3,
				},
			},
		);

		expect(pipeline.kind).toBe("vessel-preview-effect-pipeline");
		expect(pipeline.materialPreset.toon).toBe(true);
		expect(pipeline.materialPreset.grain).toBe(false);
		expect(pipeline.screenPreset.grain).toBe(true);
		expect(pipeline.crtBackground.enabled).toBe(true);
		expect(pipeline.crtBackground.gridSizePx).toBe(24);

		const shader = pipeline.crtFragmentShader(`
			varying vec2 vUv;
			void main() {
				vec2 uv = vUv;
				if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
					gl_FragColor = vec4(0.0);
					return;
				}
				vec4 pixel = texture2D(tDiffuse, uv);
				gl_FragColor = pixel;
			}
		`);

		expect(shader).toContain("vesselPreviewCrtBackground");
		expect(shader).toContain("uv = clamp(uv, vec2(0.0), vec2(1.0));");
		expect(shader).toContain("vesselPreviewCrtGrainValue");
		expect(shader).toContain(
			"pixel.rgb = mix(vesselPreviewCrtBackgroundColor, pixel.rgb, clamp(pixel.a, 0.0, 1.0));",
		);
		expect(shader).toContain("gl_FragColor = pixel;");
	});
});
