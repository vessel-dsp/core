import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createAmpPreviewObject3D } from "@vessel-dsp/amp";
import { createCabinetPreviewObject3D } from "@vessel-dsp/cabinet";
import {
	createPreviewEffectPipeline,
	resolvePreviewEffectPreset,
	VESSEL_PREVIEW_EFFECT_DEFAULTS,
} from "@vessel-dsp/visual-effects";
import { CRTShader } from "./vendor/crt-shader.js";
import { DigitalGlitch } from "./vendor/glitch-shader.js";

const reducedMotionQuery = window.matchMedia(
	"(prefers-reduced-motion: reduce)",
);
const GRAIN_INTENSITY_SCALE = 0.35;
const CRT_RENDER_TARGET_SAMPLES = 4;
const GLITCH_BURST_MIN_MS = 120;
const GLITCH_BURST_MAX_MS = 340;
const GLITCH_DISPLACEMENT_TEXTURE_SIZE = 64;

for (const viewer of document.querySelectorAll(
	"[data-vessel-generated-preview]",
)) {
	if (viewer.dataset.viewerReady === "true") {
		continue;
	}
	viewer.dataset.viewerReady = "true";
	initGeneratedPreview(viewer);
}

function initGeneratedPreview(viewer) {
	const canvas = viewer.querySelector("canvas");
	const status = viewer.querySelector("[data-vessel-generated-preview-status]");
	if (!(canvas instanceof HTMLCanvasElement)) {
		return;
	}

	try {
		const profile = parseJsonAttribute(viewer.dataset.profile, "profile");
		let effects = parseJsonAttribute(viewer.dataset.effects, "effects");

		const scene = new THREE.Scene();
		scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.3));

		const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
		keyLight.position.set(400, 500, 420);
		scene.add(keyLight);

		const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
		fillLight.position.set(-350, 180, 250);
		scene.add(fillLight);

		const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
		const renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: true,
			alpha: true,
			powerPreference: "high-performance",
		});
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.setClearColor(new THREE.Color("#0f172a"), 0);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		const screenEffects = createScreenEffects(renderer);

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.06;
		controls.enablePan = false;
		controls.autoRotate = !reducedMotionQuery.matches;
		controls.autoRotateSpeed = 0.45;

		function resize() {
			const width = Math.max(1, viewer.clientWidth);
			const height = Math.max(1, viewer.clientHeight);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			renderer.setSize(width, height, false);
			screenEffects.setSize(renderer);
		}

		const resizeObserver = new ResizeObserver(resize);
		resizeObserver.observe(viewer);
		let model;

		function renderPreview() {
			const effectPreset = resolvePreviewEffectPreset({
				...effects,
				reducedMotion: reducedMotionQuery.matches,
			});
			const displayPreset = resolveGeneratedDisplayPreset(effects, effectPreset);
			const pipeline = createPreviewEffectPipeline(displayPreset, {
				crtBackground: previewCrtBackgroundForViewer(viewer),
			});
			if (model !== undefined) {
				scene.remove(model);
			}
			model =
				viewer.dataset.kind === "cabinet"
					? createCabinetPreviewObject3D(profile, {
							effects: pipeline.materialPreset,
						})
					: createAmpPreviewObject3D(profile, {
							effects: pipeline.materialPreset,
						});
			model.name =
				viewer.dataset.kind === "cabinet"
					? "generated-cabinet-preview"
					: "generated-amp-preview";
			model.rotation.x = THREE.MathUtils.degToRad(-6);
			scene.add(model);
			screenEffects.configure(pipeline);
			frameObject(model, camera, controls);
			resize();
			viewer.dataset.viewerLoaded = "true";
			if (status !== null) {
				status.textContent = "";
			}
		}

		initGeneratedEffectControls(viewer, effects, (nextEffects) => {
			effects = nextEffects;
			viewer.dataset.effects = JSON.stringify(nextEffects);
			renderPreview();
		});
		renderPreview();

		function animate(frameMs = performance.now()) {
			requestAnimationFrame(animate);
			controls.autoRotate = !reducedMotionQuery.matches;
			controls.update();
			renderWithScreenEffects(renderer, scene, camera, screenEffects, frameMs);
		}
		animate();

	} catch (error) {
		viewer.dataset.viewerLoaded = "false";
		if (status !== null) {
			status.textContent = "3D preview failed to render.";
		}
		console.error("Failed to render generated 3D preview", error);
	}
}

function initGeneratedEffectControls(viewer, effects, onChange) {
	const controls = viewer.querySelector("[data-vessel-effect-controls]");
	if (!(controls instanceof HTMLElement)) {
		return;
	}
	let currentEffects = effects;
	applyGeneratedEffectControls(controls, currentEffects);
	controls.addEventListener("change", (event) => {
		if (!(event.target instanceof HTMLInputElement)) {
			return;
		}
		if (event.target.dataset.effectToggle === undefined) {
			return;
		}
		const nextEffects = {
			...currentEffects,
			[event.target.dataset.effectToggle]: event.target.checked,
		};
		currentEffects = nextEffects;
		applyGeneratedEffectControls(controls, nextEffects);
		onChange(nextEffects);
	});
}

function applyGeneratedEffectControls(controls, effects) {
	for (const input of controls.querySelectorAll("[data-effect-toggle]")) {
		if (!(input instanceof HTMLInputElement)) {
			continue;
		}
		const key = input.dataset.effectToggle;
		input.checked = key !== undefined && effects[key] === true;
	}
}

function createScreenEffects(renderer) {
	const crt = createCrtPostProcessing(renderer);
	const glitch = createGlitchPass();
	return {
		crt,
		glitch,
		configure(pipeline) {
			crt.configure(pipeline);
			glitch.configure(pipeline.screenPreset, pipeline.screenPreset.reducedMotion);
		},
		setSize(activeRenderer) {
			crt.setSize(activeRenderer);
			glitch.setSize(activeRenderer);
		},
	};
}

function renderWithScreenEffects(renderer, scene, camera, effects, frameMs) {
	if (effects.crt.enabled) {
		effects.crt.render(renderer, scene, camera, frameMs, effects.glitch);
		return;
	}
	renderer.setRenderTarget(null);
	renderer.render(scene, camera);
}

function createCrtPostProcessing(renderer) {
	const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
		type: THREE.HalfFloatType,
		samples: crtRenderTargetSamples(renderer),
		depthBuffer: true,
		stencilBuffer: false,
	});
	const postScene = new THREE.Scene();
	const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const uniforms = THREE.UniformsUtils.clone(CRTShader.uniforms);
	uniforms.grainScale = { value: VESSEL_PREVIEW_EFFECT_DEFAULTS.grainScale };
	uniforms.grainIntensity = { value: 0 };
	uniforms.grainIntensityScale = { value: GRAIN_INTENSITY_SCALE };
	uniforms.previewBackgroundColor = { value: new THREE.Color("#0f172a") };
	uniforms.previewGridColor = { value: new THREE.Color("#94a3b8") };
	uniforms.previewGridOpacity = { value: 0.14 };
	uniforms.previewGridSpacing = { value: 24 };
	uniforms.previewGridLineWidth = { value: 1 };
	const initialPipeline = createPreviewEffectPipeline(
		VESSEL_PREVIEW_EFFECT_DEFAULTS,
		{ crtBackground: { enabled: true } },
	);
	const material = new THREE.ShaderMaterial({
		uniforms,
		vertexShader: CRTShader.vertexShader,
		fragmentShader: initialPipeline.crtFragmentShader(CRTShader.fragmentShader),
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	postScene.add(new THREE.Mesh(fullScreenTriangleGeometry(), material));

	const drawingBufferSize = new THREE.Vector2();
	let flickerEnabled = false;
	let activeGridSizePx = 24;
	let activeGridLineWidthPx = 1;

	return {
		enabled: false,
		setSize(activeRenderer) {
			activeRenderer.getDrawingBufferSize(drawingBufferSize);
			renderTarget.setSize(
				Math.max(1, drawingBufferSize.x),
				Math.max(1, drawingBufferSize.y),
			);
			const pixelRatio = activeRenderer.getPixelRatio();
			uniforms.previewGridSpacing.value = activeGridSizePx * pixelRatio;
			uniforms.previewGridLineWidth.value =
				activeGridLineWidthPx * pixelRatio;
		},
		configure(pipeline) {
			const preset = pipeline.screenPreset;
			this.enabled = preset.crt === true;
			if (!this.enabled) {
				return;
			}
			uniforms.curvature.value = preset.crtCurvature;
			uniforms.scanlineIntensity.value = preset.crtScanlineIntensity;
			uniforms.scanlineCount.value = preset.crtScanlineCount;
			uniforms.vignetteStrength.value = preset.crtVignette;
			uniforms.rgbShift.value = preset.crtRgbShift;
			uniforms.brightness.value = preset.crtBrightness;
			uniforms.contrast.value = preset.crtContrast;
			uniforms.saturation.value = preset.crtSaturation;
			uniforms.bloomIntensity.value = preset.crtBloomIntensity;
			uniforms.bloomThreshold.value = preset.crtBloomThreshold;
			uniforms.grainScale.value = preset.grainScale;
			uniforms.grainIntensity.value =
				preset.grain === true ? preset.grainIntensity : 0;
			uniforms.previewBackgroundColor.value.set(
				pipeline.crtBackground.backgroundColor,
			);
			uniforms.previewGridColor.value.set(pipeline.crtBackground.gridColor);
			uniforms.previewGridOpacity.value = pipeline.crtBackground.gridOpacity;
			activeGridSizePx = pipeline.crtBackground.gridSizePx;
			activeGridLineWidthPx = pipeline.crtBackground.gridLineWidthPx;
			flickerEnabled =
				preset.reducedMotion !== true && preset.crtFlicker > 0.001;
			uniforms.flickerStrength.value = flickerEnabled ? preset.crtFlicker : 0;
		},
		render(activeRenderer, sceneToRender, sceneCamera, frameMs, glitchPass) {
			if (flickerEnabled) {
				uniforms.time.value = frameMs / 1000;
			}
			activeRenderer.setRenderTarget(renderTarget);
			activeRenderer.render(sceneToRender, sceneCamera);
			let sourceTexture = renderTarget.texture;
			if (glitchPass?.enabled) {
				sourceTexture = glitchPass.apply(
					activeRenderer,
					sourceTexture,
					frameMs,
				);
			}
			activeRenderer.setRenderTarget(null);
			uniforms.tDiffuse.value = sourceTexture;
			activeRenderer.render(postScene, postCamera);
		},
	};
}

function createGlitchPass() {
	const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
		type: THREE.HalfFloatType,
		depthBuffer: false,
		stencilBuffer: false,
	});
	const postScene = new THREE.Scene();
	const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
	const uniforms = THREE.UniformsUtils.clone(DigitalGlitch.uniforms);
	uniforms.tDisp.value = createGlitchDisplacementTexture();
	const material = new THREE.ShaderMaterial({
		uniforms,
		vertexShader: DigitalGlitch.vertexShader,
		fragmentShader: DigitalGlitch.fragmentShader.replace(
			"gl_FragColor = gl_FragColor+ snow;",
			"gl_FragColor = gl_FragColor + snow;\n\t\t\t\tgl_FragColor.a = cga.a;",
		),
		transparent: true,
		depthTest: false,
		depthWrite: false,
	});
	postScene.add(new THREE.Mesh(fullScreenTriangleGeometry(), material));

	const drawingBufferSize = new THREE.Vector2();
	let minGapMs = VESSEL_PREVIEW_EFFECT_DEFAULTS.glitchIntervalSeconds * 600;
	let maxGapMs = VESSEL_PREVIEW_EFFECT_DEFAULTS.glitchIntervalSeconds * 1400;
	let nextAtMs;
	let burstEndMs = 0;
	let hardEndMs = 0;

	function scheduleNext(frameMs) {
		nextAtMs = frameMs + randomInRange(minGapMs, maxGapMs);
	}

	return {
		enabled: false,
		setSize(activeRenderer) {
			activeRenderer.getDrawingBufferSize(drawingBufferSize);
			renderTarget.setSize(
				Math.max(1, drawingBufferSize.x),
				Math.max(1, drawingBufferSize.y),
			);
		},
		configure(preset, reducedMotion) {
			this.enabled = preset.glitch === true && reducedMotion !== true;
			const intervalSeconds =
				preset.glitchIntervalSeconds > 0
					? preset.glitchIntervalSeconds
					: VESSEL_PREVIEW_EFFECT_DEFAULTS.glitchIntervalSeconds;
			minGapMs = intervalSeconds * 600;
			maxGapMs = intervalSeconds * 1400;
			nextAtMs = undefined;
			burstEndMs = 0;
			hardEndMs = 0;
		},
		apply(activeRenderer, inputTexture, frameMs) {
			if (nextAtMs === undefined) {
				scheduleNext(frameMs);
			}
			const glitching = frameMs < burstEndMs;
			if (!glitching && frameMs >= nextAtMs) {
				const burstMs = randomInRange(GLITCH_BURST_MIN_MS, GLITCH_BURST_MAX_MS);
				burstEndMs = frameMs + burstMs;
				hardEndMs = frameMs + burstMs * randomInRange(0.25, 0.5);
				scheduleNext(burstEndMs);
			}
			if (frameMs >= burstEndMs) {
				return inputTexture;
			}
			uniforms.seed.value = Math.random();
			uniforms.byp.value = 0;
			if (frameMs < hardEndMs) {
				uniforms.amount.value = Math.random() / 30;
				uniforms.angle.value = randomInRange(-Math.PI, Math.PI);
				uniforms.seed_x.value = randomInRange(-1, 1);
				uniforms.seed_y.value = randomInRange(-1, 1);
				uniforms.distortion_x.value = Math.random();
				uniforms.distortion_y.value = Math.random();
			} else {
				uniforms.amount.value = Math.random() / 90;
				uniforms.angle.value = randomInRange(-Math.PI, Math.PI);
				uniforms.distortion_x.value = Math.random();
				uniforms.distortion_y.value = Math.random();
				uniforms.seed_x.value = randomInRange(-0.3, 0.3);
				uniforms.seed_y.value = randomInRange(-0.3, 0.3);
			}
			uniforms.tDiffuse.value = inputTexture;
			activeRenderer.setRenderTarget(renderTarget);
			activeRenderer.render(postScene, postCamera);
			return renderTarget.texture;
		},
	};
}

function fullScreenTriangleGeometry() {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute(
		"position",
		new THREE.BufferAttribute(
			new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]),
			3,
		),
	);
	geometry.setAttribute(
		"uv",
		new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
	);
	return geometry;
}

function resolveGeneratedDisplayPreset(effects, effectPreset) {
	return {
		...effectPreset,
		grainScale: normalizePositiveNumber(
			effects.grainScale,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.grainScale,
		),
		grainIntensity: normalizeUnitInterval(
			effects.grainIntensity,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.grainIntensity,
		),
		crtCurvature: normalizeUnitInterval(
			effects.crtCurvature,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtCurvature,
		),
		crtScanlineIntensity: normalizeUnitInterval(
			effects.crtScanlineIntensity,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtScanlineIntensity,
		),
		crtScanlineCount: normalizePositiveNumber(
			effects.crtScanlineCount,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtScanlineCount,
		),
		crtVignette: normalizeUnitInterval(
			effects.crtVignette,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtVignette,
		),
		crtRgbShift: normalizeUnitInterval(
			effects.crtRgbShift,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtRgbShift,
		),
		crtFlicker: normalizeUnitInterval(
			effects.crtFlicker,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtFlicker,
		),
		crtBrightness: normalizeNonNegativeNumber(
			effects.crtBrightness,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtBrightness,
		),
		crtContrast: normalizeNonNegativeNumber(
			effects.crtContrast,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtContrast,
		),
		crtSaturation: normalizeNonNegativeNumber(
			effects.crtSaturation,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtSaturation,
		),
		crtBloomIntensity: normalizeNonNegativeNumber(
			effects.crtBloomIntensity,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtBloomIntensity,
		),
		crtBloomThreshold: normalizeUnitInterval(
			effects.crtBloomThreshold,
			VESSEL_PREVIEW_EFFECT_DEFAULTS.crtBloomThreshold,
		),
	};
}

function previewCrtBackgroundForViewer(viewer) {
	return {
		enabled: true,
		backgroundColor: viewer.dataset.backgroundColor ?? "#0f172a",
		gridColor: viewer.dataset.gridColor ?? "#94a3b8",
		gridOpacity: normalizeUnitInterval(viewer.dataset.gridOpacity, 0.14),
		gridSizePx: 24,
		gridLineWidthPx: 1,
	};
}

function createGlitchDisplacementTexture() {
	const size = GLITCH_DISPLACEMENT_TEXTURE_SIZE;
	const data = new Float32Array(size * size);
	for (let index = 0; index < data.length; index += 1) {
		data[index] = Math.random();
	}
	const texture = new THREE.DataTexture(
		data,
		size,
		size,
		THREE.RedFormat,
		THREE.FloatType,
	);
	texture.needsUpdate = true;
	return texture;
}

function randomInRange(min, max) {
	return min + Math.random() * (max - min);
}

function crtRenderTargetSamples(renderer) {
	const maxSamples = renderer.capabilities?.maxSamples;
	if (!Number.isFinite(maxSamples)) {
		return CRT_RENDER_TARGET_SAMPLES;
	}
	return Math.max(0, Math.min(CRT_RENDER_TARGET_SAMPLES, maxSamples));
}

function normalizePositiveNumber(value, defaultValue) {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? number : defaultValue;
}

function normalizeNonNegativeNumber(value, defaultValue) {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : defaultValue;
}

function normalizeUnitInterval(value, defaultValue) {
	const number = Number(value);
	if (!Number.isFinite(number)) {
		return defaultValue;
	}
	return Math.min(1, Math.max(0, number));
}

function parseJsonAttribute(value, label) {
	if (value === undefined) {
		throw new Error(`Missing generated preview ${label}`);
	}
	return JSON.parse(value);
}

function frameObject(object, camera, controls) {
	const box = new THREE.Box3().setFromObject(object);
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const center = sphere.center.clone();
	const radius = Math.max(sphere.radius, 1);

	object.position.sub(center);

	const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
	camera.position.set(radius * 0.55, radius * 0.38, distance * 0.74);
	camera.near = Math.max(radius / 100, 0.1);
	camera.far = radius * 12;
	camera.lookAt(0, 0, 0);
	camera.updateProjectionMatrix();

	controls.target.set(0, 0, 0);
	controls.minDistance = radius * 0.5;
	controls.maxDistance = radius * 5;
	controls.update();
}
