import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const TEXT_DECAL_UVS = new Float32Array([
	0, 1,
	1, 1,
	1, 0,
	0, 0,
]);
const KNOB_LEFT_END_ROTATION_DEG = 135;
const KNOB_ROTATION_SWEEP_DEG = -270;
const FOOTSWITCH_TRAVEL_MM = 2;
const FOOTSWITCH_AUTO_RELEASE_MS = 180;
const FOOTSWITCH_ANIMATION_MS = 90;
const LED_ON_COLOR = "#22c55e";
const LED_OFF_COLOR = "#064e3b";
const DEFAULT_BACKGROUND_COLOR = "#000000";
const DEFAULT_GRID_COLOR = "#cccccc";
const DEFAULT_GRID_OPACITY = 0.1;
const DEFAULT_TOON_EDGE_COLOR = "#69145a";
const DEFAULT_GRAIN_SCALE = 1.15;
const DEFAULT_GRAIN_INTENSITY = 0.1;
const GRAIN_INTENSITY_SCALE = 0.35;
const TOON_OUTLINE_SCALE = 1.02;
const liveStateStores = new WeakMap();
const parentWorldScaleScratch = new THREE.Vector3();
let sharedToonGradientMap;

for (const viewer of document.querySelectorAll("[data-stompbox-glb-viewer]")) {
	if (viewer.dataset.viewerReady === "true") {
		continue;
	}
	viewer.dataset.viewerReady = "true";
	initStompboxViewer(viewer);
}

for (const group of document.querySelectorAll("[data-stompbox-preview-preset-group]")) {
	if (group.dataset.presetLinkedAssetsReady === "true") {
		continue;
	}
	group.dataset.presetLinkedAssetsReady = "true";
	initPresetLinkedAssets(group);
}

function initStompboxViewer (viewer) {
	const canvas = viewer.querySelector("canvas");
	const status = viewer.querySelector("[data-stompbox-glb-status]");
	const src = viewer.dataset.glbSrc;
	if (!(canvas instanceof HTMLCanvasElement) || src === undefined) {
		return;
	}
	const presets = parsePresetOptions(viewer, src);
	const select = presetSelectForViewer(viewer);

	const scene = new THREE.Scene();

	const orbitCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
	const topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
	let camera = orbitCamera;
	orbitCamera.position.set(75, 65, 145);

	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: true,
		powerPreference: "high-performance",
		preserveDrawingBuffer: true,
	});
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.setClearColor(new THREE.Color(DEFAULT_BACKGROUND_COLOR), 0);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

	scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 2.2));

	const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
	keyLight.position.set(120, 160, 140);
	scene.add(keyLight);

	const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
	fillLight.position.set(-100, 70, -80);
	scene.add(fillLight);

	const modelRoot = new THREE.Group();
	scene.add(modelRoot);
	let controls;
	let viewMode = "orbit";
	let orthographicTopSize;
	let loadToken = 0;

	const loader = new GLTFLoader();
	if (select instanceof HTMLSelectElement) {
		select.addEventListener("change", () => {
			const nextPreset = presets.find((preset) => preset.id === select.value) ?? presets[0];
			loadPreset(nextPreset);
		});
	}
	loadPreset(presets.find((preset) => preset.id === select?.value) ?? presets[0]);

	function resize () {
		const width = Math.max(1, viewer.clientWidth);
		const height = Math.max(1, viewer.clientHeight);
		if (camera.isPerspectiveCamera) {
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
		}
		if (camera.isOrthographicCamera && orthographicTopSize !== undefined) {
			updateOrthographicTopFrustum(camera, orthographicTopSize, width / height);
		}
		renderer.setSize(width, height, false);
	}

	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(viewer);
	resize();

	let previousFrameMs = performance.now();
	function animate (frameMs = performance.now()) {
		requestAnimationFrame(animate);
		const deltaMs = Math.min(Math.max(0, frameMs - previousFrameMs), 100);
		previousFrameMs = frameMs;
		if (controls !== undefined) {
			controls.autoRotate = viewMode !== "top" && !reducedMotionQuery.matches;
			controls.update();
		}
		updateLiveStateAnimations(viewer, deltaMs);
		renderer.render(scene, camera);
	}
	animate();

	function loadPreset (preset) {
		if (preset === undefined) {
			return;
		}
		const token = loadToken + 1;
		loadToken = token;
		viewMode = preset.view === "top" ? "top" : "orbit";
		camera = viewMode === "top" ? topCamera : orbitCamera;
		orthographicTopSize = undefined;
		modelRoot.clear();
		viewer.dataset.glbSrc = preset.src;
		viewer.dataset.viewMode = viewMode;
		viewer.dataset.interactive = preset.interactive ? "true" : "false";
		viewer.dataset.linework = preset.linework ? "true" : "false";
		viewer.dataset.lineworkColor = preset.lineworkColor;
		viewer.dataset.toon = preset.toon ? "true" : "false";
		viewer.dataset.toonEdgeColor = preset.toonEdgeColor;
		viewer.dataset.grain = preset.grain ? "true" : "false";
		viewer.dataset.grainScale = String(preset.grainScale);
		viewer.dataset.grainIntensity = String(preset.grainIntensity);
		applyPresetBackground(viewer, preset);
		viewer.dataset.viewerLoaded = "false";
		unregisterLiveStateViewer(viewer);
		configureControls(preset);
		if (status !== null) {
			status.hidden = false;
			status.textContent = `Loading ${preset.label}`;
		}
		resize();
		loader.load(
			preset.src,
			(gltf) => {
				if (token !== loadToken) {
					return;
				}
				const model = gltf.scene;
				model.traverse((child) => {
					if (!child.isMesh) {
						return;
					}
					child.castShadow = false;
					child.receiveShadow = true;
					applyDecalMaterial(child);
					applyFlatAppearanceColorMaterial(child);
					const materials = Array.isArray(child.material) ? child.material : [child.material];
					for (const material of materials) {
						if ("metalness" in material) {
							material.metalness = Math.min(material.metalness, 0.55);
						}
						if ("roughness" in material) {
							material.roughness = Math.max(material.roughness, 0.35);
						}
					}
				});
				if (preset.toon) {
					applyToonMaterials(model, preset);
				}
				if (preset.linework || preset.toon) {
					const edgeColor = preset.toon ? preset.toonEdgeColor : preset.lineworkColor;
					addCadLinework(model, edgeColor);
				}
				if (preset.toon) {
					addToonOutline(model, preset.toonEdgeColor);
				}
				applyScreenGrainMaterials(model, preset);
				modelRoot.add(model);
				const aspect = Math.max(1, viewer.clientWidth) / Math.max(1, viewer.clientHeight);
				orthographicTopSize = frameModel(model, camera, controls, viewMode, aspect);
				resize();
				initLiveStateDemo(viewer, model);
				if (status !== null) {
					status.hidden = true;
				}
				viewer.dataset.viewerLoaded = "true";
			},
			undefined,
			(error) => {
				if (token !== loadToken) {
					return;
				}
				if (status !== null) {
					status.textContent = "3D preview failed to load.";
				}
				console.error("Failed to load stompbox GLB preview", error);
			},
		);
	}

	function configureControls (preset) {
		if (controls !== undefined) {
			controls.dispose();
			controls = undefined;
		}
		if (!preset.interactive) {
			return;
		}
		controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.06;
		controls.enablePan = false;
		controls.enableRotate = viewMode !== "top";
		controls.autoRotate = viewMode !== "top" && !reducedMotionQuery.matches;
		controls.autoRotateSpeed = 0.6;
	}
}

function initLiveStateDemo (viewer, model) {
	if (!liveStateEnabledForViewer(viewer)) {
		return;
	}
	const store = liveStateStoreForViewer(viewer);
	if (store === undefined) {
		return;
	}
	const parts = discoverLiveStateParts(model);
	store.viewers.set(viewer, parts);
	seedLiveStateFromParts(store, parts);
	renderLiveStateControls(store);
	applyLiveStateToRegisteredViewers(store);
}

function unregisterLiveStateViewer (viewer) {
	const store = existingLiveStateStoreForViewer(viewer);
	if (store === undefined) {
		return;
	}
	store.viewers.delete(viewer);
	if (store.viewers.size === 0) {
		resetLiveStateStore(store);
		return;
	}
	renderLiveStateControls(store);
	applyLiveStateToRegisteredViewers(store);
}

function liveStateEnabledForViewer (viewer) {
	if (viewer.dataset.liveStateDemo === "true") {
		return true;
	}
	const group = viewer.closest("[data-stompbox-preview-preset-group]");
	return group !== null && group.querySelector('[data-stompbox-glb-viewer][data-live-state-demo="true"]') !== null;
}

function liveStateStoreForViewer (viewer) {
	const owner = liveStateOwnerForViewer(viewer);
	const panel = liveStatePanelForViewer(viewer);
	if (owner === undefined || !(panel instanceof HTMLElement)) {
		return undefined;
	}
	const existing = liveStateStores.get(owner);
	if (existing !== undefined) {
		return existing;
	}
	const store = {
		panel,
		viewers: new Map(),
		state: createLiveState(),
		pressStartedAt: new Map(),
		releaseTimers: new Map(),
	};
	liveStateStores.set(owner, store);
	return store;
}

function existingLiveStateStoreForViewer (viewer) {
	const owner = liveStateOwnerForViewer(viewer);
	return owner === undefined ? undefined : liveStateStores.get(owner);
}

function liveStateOwnerForViewer (viewer) {
	const group = viewer.closest("[data-stompbox-preview-preset-group]");
	if (group?.querySelector("[data-stompbox-live-state-controls]") instanceof HTMLElement) {
		return group;
	}
	if (viewer.querySelector("[data-stompbox-live-state-controls]") instanceof HTMLElement) {
		return viewer;
	}
	return undefined;
}

function liveStatePanelForViewer (viewer) {
	const group = viewer.closest("[data-stompbox-preview-preset-group]");
	const groupPanel = group?.querySelector("[data-stompbox-live-state-controls]");
	if (groupPanel instanceof HTMLElement) {
		return groupPanel;
	}
	const localPanel = viewer.querySelector("[data-stompbox-live-state-controls]");
	return localPanel instanceof HTMLElement ? localPanel : undefined;
}

function createLiveState () {
	return {
		knobs: new Map(),
		switches: new Map(),
		latches: new Map(),
		leds: new Map(),
	};
}

function resetLiveStateStore (store) {
	for (const timer of store.releaseTimers.values()) {
		window.clearTimeout(timer);
	}
	store.pressStartedAt.clear();
	store.releaseTimers.clear();
	store.state = createLiveState();
	store.panel.replaceChildren();
	store.panel.hidden = true;
}

function seedLiveStateFromParts (store, parts) {
	for (const knob of parts.knobs) {
		if (!store.state.knobs.has(knob.id)) {
			store.state.knobs.set(knob.id, knob.position);
		}
	}
	for (const footswitch of parts.switches) {
		if (!store.state.switches.has(footswitch.id)) {
			store.state.switches.set(footswitch.id, footswitch.pressed);
		}
		if (!store.state.latches.has(footswitch.id)) {
			store.state.latches.set(footswitch.id, false);
		}
	}
	for (const led of parts.leds) {
		if (!store.state.leds.has(led.id)) {
			store.state.leds.set(led.id, led.on);
		}
	}
}

function renderLiveStateControls (store) {
	const controls = liveStateControlDefinitions(store);
	store.panel.replaceChildren();
	if (controls.knobs.length === 0 && controls.switches.length === 0 && controls.leds.length === 0) {
		store.panel.hidden = true;
		return;
	}
	for (const knob of controls.knobs) {
		store.panel.append(createKnobStateControl(knob, store));
	}
	for (const footswitch of controls.switches) {
		store.panel.append(createFootswitchStateControl(footswitch, store));
	}
	for (const led of controls.leds) {
		store.panel.append(createLedStateControl(led, store));
	}
	store.panel.hidden = false;
}

function liveStateControlDefinitions (store) {
	const knobs = new Map();
	const switches = new Map();
	const leds = new Map();
	for (const parts of store.viewers.values()) {
		for (const knob of parts.knobs) {
			if (!knobs.has(knob.id)) {
				knobs.set(knob.id, { id: knob.id, label: knob.label });
			}
		}
		for (const footswitch of parts.switches) {
			if (!switches.has(footswitch.id)) {
				switches.set(footswitch.id, { id: footswitch.id, label: footswitch.label });
			}
		}
		for (const led of parts.leds) {
			if (!leds.has(led.id)) {
				leds.set(led.id, { id: led.id, label: led.label });
			}
		}
	}
	return {
		knobs: sortedLiveStateDefinitions(knobs),
		switches: sortedLiveStateDefinitions(switches),
		leds: sortedLiveStateDefinitions(leds),
	};
}

function sortedLiveStateDefinitions (definitions) {
	return [...definitions.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function applyLiveStateToRegisteredViewers (store) {
	for (const parts of store.viewers.values()) {
		applyLiveStateToParts(parts, store.state);
	}
}

function applyLiveStateToParts (parts, state) {
	for (const knob of parts.knobs) {
		if (!state.knobs.has(knob.id)) {
			continue;
		}
		const position = clamp01(state.knobs.get(knob.id));
		knob.position = position;
		knob.node.rotation.z = THREE.MathUtils.degToRad(knobRotationDegForPosition(position));
	}
	for (const footswitch of parts.switches) {
		const pressed = state.switches.get(footswitch.id) === true;
		footswitch.pressed = pressed;
		applyFootswitchState(footswitch, pressed);
	}
	for (const led of parts.leds) {
		const on = state.leds.get(led.id) !== false;
		led.on = on;
		applyLedState(led, on);
	}
}

function discoverLiveStateParts (model) {
	const parts = {
		knobs: [],
		switches: [],
		leds: [],
	};
	model.traverse((object) => {
		const id = typeof object.userData?.id === "string" ? object.userData.id : "";
		if (object.userData?.kind !== "part" || id.length === 0) {
			return;
		}
		if (id.startsWith("knob-")) {
			const position = knobPositionFromRotation(object.rotation.z);
			parts.knobs.push({
				id,
				node: object,
				label: controlLabelForPart(object),
				position,
			});
			return;
		}
		if (id.startsWith("switch-")) {
			const actuator = actuatorObjectForStateTarget(model, object.userData.stateTargets?.footswitch?.actuator);
			if (actuator === undefined) {
				return;
			}
			const stateTarget = object.userData.stateTargets.footswitch.actuator;
			parts.switches.push({
				id,
				node: object,
				actuator,
				label: controlLabelForPart(object),
				basePosition: actuator.position.clone(),
				pressed: false,
				currentTravelMm: 0,
				targetTravelMm: 0,
				travelAxis: footswitchTravelAxis(stateTarget.travelAxis),
				travelMm: Number.isFinite(stateTarget.travelMm) ? stateTarget.travelMm : FOOTSWITCH_TRAVEL_MM,
			});
			return;
		}
		if (id.startsWith("led-")) {
			const lens = objectForStateTarget(model, object.userData.stateTargets?.led?.lens);
			if (lens === undefined) {
				return;
			}
			parts.leds.push({
				id,
				node: object,
				lens,
				label: controlLabelForPart(object),
				on: true,
			});
		}
	});
	for (const list of [parts.knobs, parts.switches, parts.leds]) {
		list.sort((a, b) => a.label.localeCompare(b.label));
	}
	return parts;
}

function createKnobStateControl (knob, store) {
	const control = document.createElement("label");
	control.className = "stompbox-live-state-control";

	const label = document.createElement("span");
	label.className = "stompbox-live-state-control__label";

	const input = document.createElement("input");
	input.type = "range";
	input.min = "0";
	input.max = "1";
	input.step = "0.01";
	input.value = String(clamp01(store.state.knobs.get(knob.id) ?? 0));

	const updateLabel = () => {
		const position = clamp01(Number(input.value));
		label.textContent = `${knob.label}: ${Math.round(position * 100)}%`;
	};
	input.addEventListener("input", () => {
		const position = clamp01(Number(input.value));
		store.state.knobs.set(knob.id, position);
		updateLabel();
		applyLiveStateToRegisteredViewers(store);
	});
	updateLabel();

	control.append(label, input);
	return control;
}

function createFootswitchStateControl (footswitch, store) {
	const control = document.createElement("div");
	control.className = "stompbox-live-state-control";
	const button = document.createElement("button");
	button.type = "button";
	let activePointerId;
	let skipNextClick = false;

	button.addEventListener("pointerdown", (event) => {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		skipNextClick = true;
		activePointerId = event.pointerId;
		button.setPointerCapture(event.pointerId);
		startFootswitchPress(footswitch, store, button);
	});
	const endPointerPress = (event) => {
		if (activePointerId !== undefined && event.pointerId !== activePointerId) {
			return;
		}
		event.preventDefault();
		if (activePointerId !== undefined && button.hasPointerCapture(activePointerId)) {
			button.releasePointerCapture(activePointerId);
		}
		activePointerId = undefined;
		releaseFootswitchPress(footswitch, store, button);
	};
	button.addEventListener("pointerup", endPointerPress);
	button.addEventListener("pointercancel", endPointerPress);
	button.addEventListener("lostpointercapture", (event) => {
		if (activePointerId !== event.pointerId) {
			return;
		}
		activePointerId = undefined;
		releaseFootswitchPress(footswitch, store, button);
	});
	button.addEventListener("keydown", (event) => {
		if (!isFootswitchActivationKey(event) || event.repeat) {
			return;
		}
		event.preventDefault();
		skipNextClick = true;
		startFootswitchPress(footswitch, store, button);
	});
	button.addEventListener("keyup", (event) => {
		if (!isFootswitchActivationKey(event)) {
			return;
		}
		event.preventDefault();
		releaseFootswitchPress(footswitch, store, button);
	});
	button.addEventListener("click", (event) => {
		if (skipNextClick) {
			skipNextClick = false;
			event.preventDefault();
			return;
		}
		simulateFootswitchTap(footswitch, store, button);
	});
	updateFootswitchButton(button, footswitch, store);

	control.append(button);
	return control;
}

function simulateFootswitchTap (footswitch, store, button) {
	startFootswitchPress(footswitch, store, button);
	releaseFootswitchPress(footswitch, store, button);
}

function startFootswitchPress (footswitch, store, button) {
	clearFootswitchReleaseTimer(footswitch.id, store);
	if (store.state.switches.get(footswitch.id) === true) {
		return;
	}
	store.pressStartedAt.set(footswitch.id, performance.now());
	toggleFootswitchLatch(footswitch, store);
	store.state.switches.set(footswitch.id, true);
	syncLedStateControls(store);
	updateFootswitchButton(button, footswitch, store);
	applyLiveStateToRegisteredViewers(store);
}

function releaseFootswitchPress (footswitch, store, button) {
	if (store.state.switches.get(footswitch.id) !== true) {
		return;
	}
	const startedAt = store.pressStartedAt.get(footswitch.id) ?? performance.now();
	store.pressStartedAt.delete(footswitch.id);
	const elapsedMs = performance.now() - startedAt;
	const delayMs = Math.max(0, FOOTSWITCH_AUTO_RELEASE_MS - elapsedMs);
	scheduleFootswitchRelease(footswitch, store, button, delayMs);
}

function scheduleFootswitchRelease (footswitch, store, button, delayMs) {
	if (store.releaseTimers.has(footswitch.id)) {
		return;
	}
	const release = () => {
		store.releaseTimers.delete(footswitch.id);
		store.state.switches.set(footswitch.id, false);
		updateFootswitchButton(button, footswitch, store);
		applyLiveStateToRegisteredViewers(store);
	};
	if (delayMs <= 0) {
		release();
		return;
	}
	const timer = window.setTimeout(release, delayMs);
	store.releaseTimers.set(footswitch.id, timer);
}

function clearFootswitchReleaseTimer (footswitchId, store) {
	const timer = store.releaseTimers.get(footswitchId);
	if (timer === undefined) {
		return;
	}
	window.clearTimeout(timer);
	store.releaseTimers.delete(footswitchId);
}

function toggleFootswitchLatch (footswitch, store) {
	const nextLatched = !(store.state.latches.get(footswitch.id) === true);
	store.state.latches.set(footswitch.id, nextLatched);
	const ledId = linkedLedIdForFootswitch(footswitch.id, store);
	if (ledId !== undefined) {
		store.state.leds.set(ledId, nextLatched);
	}
}

function linkedLedIdForFootswitch (footswitchId, store) {
	if (footswitchId === "switch-bypass" && store.state.leds.has("led-status")) {
		return "led-status";
	}
	if (store.state.leds.size === 1) {
		return [...store.state.leds.keys()][0];
	}
	return undefined;
}

function isFootswitchActivationKey (event) {
	return event.key === " " || event.key === "Enter";
}

function updateFootswitchButton (button, footswitch, store) {
	const pressed = store.state.switches.get(footswitch.id) === true;
	button.setAttribute("aria-pressed", pressed ? "true" : "false");
	button.textContent = pressed ? `${footswitch.label}: pressed` : `Tap / hold ${footswitch.label}`;
}

function createLedStateControl (led, store) {
	const control = document.createElement("label");
	control.className = "stompbox-live-state-control stompbox-live-state-toggle";
	const input = document.createElement("input");
	input.type = "checkbox";
	input.setAttribute("role", "switch");
	input.setAttribute("data-stompbox-led-toggle", "true");
	input.setAttribute("data-stompbox-control-id", led.id);
	input.setAttribute("data-stompbox-control-label", led.label);
	const label = document.createElement("span");
	label.className = "stompbox-live-state-control__label";
	label.setAttribute("data-stompbox-led-toggle-label", "true");

	const apply = () => {
		const on = store.state.leds.get(led.id) !== false;
		updateLedStateControl(input, label, led.label, on);
		applyLiveStateToRegisteredViewers(store);
	};
	input.addEventListener("change", () => {
		store.state.leds.set(led.id, input.checked);
		apply();
	});
	apply();

	control.append(input, label);
	return control;
}

function syncLedStateControls (store) {
	for (const input of store.panel.querySelectorAll("[data-stompbox-led-toggle]")) {
		if (!(input instanceof HTMLInputElement)) {
			continue;
		}
		const id = input.getAttribute("data-stompbox-control-id");
		if (id === null || id.length === 0) {
			continue;
		}
		const label = input.closest(".stompbox-live-state-toggle")?.querySelector("[data-stompbox-led-toggle-label]");
		const controlLabel = input.getAttribute("data-stompbox-control-label") ?? id;
		const on = store.state.leds.get(id) !== false;
		updateLedStateControl(input, label, controlLabel, on);
	}
}

function updateLedStateControl (input, label, controlLabel, on) {
	input.checked = on;
	input.setAttribute("aria-label", `${controlLabel} LED`);
	input.setAttribute("aria-checked", on ? "true" : "false");
	if (label instanceof HTMLElement) {
		label.textContent = `${controlLabel}: ${on ? "on" : "off"}`;
	}
}

function applyFootswitchState (footswitch, pressed) {
	footswitch.targetTravelMm = pressed ? footswitch.travelMm : 0;
}

function updateLiveStateAnimations (viewer, deltaMs) {
	const store = existingLiveStateStoreForViewer(viewer);
	if (store === undefined) {
		return;
	}
	const parts = store.viewers.get(viewer);
	if (parts === undefined) {
		return;
	}
	for (const footswitch of parts.switches) {
		updateFootswitchAnimation(footswitch, deltaMs);
	}
}

function updateFootswitchAnimation (footswitch, deltaMs) {
	const currentTravelMm = Number.isFinite(footswitch.currentTravelMm) ? footswitch.currentTravelMm : 0;
	const targetTravelMm = Number.isFinite(footswitch.targetTravelMm) ? footswitch.targetTravelMm : 0;
	const remainingTravelMm = targetTravelMm - currentTravelMm;
	if (reducedMotionQuery.matches || Math.abs(remainingTravelMm) < 0.005) {
		setFootswitchActuatorTravel(footswitch, targetTravelMm);
		return;
	}
	const progress = THREE.MathUtils.clamp(deltaMs / FOOTSWITCH_ANIMATION_MS, 0, 1);
	const easedProgress = 1 - ((1 - progress) * (1 - progress) * (1 - progress));
	setFootswitchActuatorTravel(footswitch, currentTravelMm + remainingTravelMm * easedProgress);
}

function setFootswitchActuatorTravel (footswitch, travelMm) {
	const axis = footswitch.travelAxis ?? "z";
	const localTravel = localTravelForWorldMillimeters(footswitch, travelMm);
	footswitch.currentTravelMm = travelMm;
	footswitch.actuator.position.copy(footswitch.basePosition);
	footswitch.actuator.position[axis] = footswitch.basePosition[axis] - localTravel;
}

function localTravelForWorldMillimeters (footswitch, travelMm) {
	const axis = footswitch.travelAxis ?? "z";
	return travelMm / parentWorldScaleForLocalAxis(footswitch.actuator, axis);
}

function parentWorldScaleForLocalAxis (object, axis) {
	const parent = object.parent;
	if (parent === null) {
		return 1;
	}
	parent.updateWorldMatrix(true, false);
	parent.getWorldScale(parentWorldScaleScratch);
	const scale = Math.abs(parentWorldScaleScratch[axis]);
	return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function applyLedState (led, on) {
	const meshes = [];
	led.lens.traverse((object) => {
		if (!object.isMesh) {
			return;
		}
		meshes.push(object);
	});
	for (const mesh of meshes) {
		ensureEditableMeshMaterials(mesh);
		for (const material of materialsForMesh(mesh)) {
			const appearance = material.userData?.appearanceMaterial;
			const onColor = typeof appearance?.color === "string" ? appearance.color : LED_ON_COLOR;
			const color = on ? onColor : LED_OFF_COLOR;
			if ("color" in material) {
				material.color.set(color);
			}
			if ("emissive" in material) {
				material.emissive.set(color);
				material.emissiveIntensity = on ? (Number.isFinite(appearance?.intensity) ? appearance.intensity : 1.4) : 0;
			}
			material.opacity = on ? 1 : Math.min(material.opacity ?? 1, 0.7);
			material.transparent = !on || material.transparent === true;
			material.needsUpdate = true;
		}
	}
}

function actuatorObjectForStateTarget (root, stateTarget) {
	const actuator = objectForStateTarget(root, stateTarget);
	if (actuator === undefined || actuator.isMesh) {
		return actuator;
	}
	const meshName = typeof stateTarget?.meshName === "string" ? stateTarget.meshName : undefined;
	if (meshName === undefined) {
		return actuator;
	}
	let found;
	actuator.traverse((object) => {
		if (found !== undefined || !object.isMesh) {
			return;
		}
		if (object.name === meshName || object.userData?.name === meshName || object.geometry?.name === meshName) {
			found = object;
		}
	});
	return found ?? actuator;
}

function objectForStateTarget (root, stateTarget) {
	const nodeName = typeof stateTarget?.nodeName === "string" ? stateTarget.nodeName : undefined;
	if (nodeName === undefined) {
		return undefined;
	}
	let found;
	root.traverse((object) => {
		if (found === undefined && (object.name === nodeName || object.userData?.name === nodeName)) {
			found = object;
		}
	});
	return found;
}

function footswitchTravelAxis (value) {
	return value === "x" || value === "y" || value === "z" ? value : "z";
}

function ensureEditableMeshMaterials (mesh) {
	if (mesh.userData.liveStateMaterialCloned === true) {
		return;
	}
	if (Array.isArray(mesh.material)) {
		mesh.material = mesh.material.map((material) => material.clone());
	} else if (mesh.material !== undefined) {
		mesh.material = mesh.material.clone();
	}
	mesh.userData.liveStateMaterialCloned = true;
}

function materialsForMesh (mesh) {
	if (Array.isArray(mesh.material)) {
		return mesh.material;
	}
	return mesh.material === undefined ? [] : [mesh.material];
}

function controlLabelForPart (object) {
	const id = typeof object.userData?.id === "string" ? object.userData.id : "control";
	const rawLabel = typeof object.userData?.controlId === "string" && object.userData.controlId.length > 0
		? object.userData.controlId
		: id.replace(/^(knob|switch|led)-/, "");
	return rawLabel.replace(/[-_]+/g, " ");
}

function knobPositionFromRotation (rotationRad) {
	const rotationDeg = THREE.MathUtils.radToDeg(rotationRad);
	return clamp01((rotationDeg - KNOB_LEFT_END_ROTATION_DEG) / KNOB_ROTATION_SWEEP_DEG);
}

function knobRotationDegForPosition (position) {
	return KNOB_LEFT_END_ROTATION_DEG + clamp01(position) * KNOB_ROTATION_SWEEP_DEG;
}

function clamp01 (value) {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.max(0, Math.min(1, value));
}

function initPresetLinkedAssets (group) {
	const select = group.querySelector("[data-stompbox-preset-select]");
	const presets = parseGroupPresetOptions(group);
	if (!(select instanceof HTMLSelectElement) || presets.length === 0) {
		return;
	}

	const update = () => {
		const preset = presets.find((candidate) => candidate.id === select.value) ?? presets[0];
		updatePresetLinkedAssets(group, preset);
	};
	select.addEventListener("change", update);
	update();
}

function updatePresetLinkedAssets (group, preset) {
	if (preset === undefined) {
		return;
	}
	applyPresetBackground(group, preset);
	for (const image of group.querySelectorAll("[data-stompbox-drill-template-preview]")) {
		if (!(image instanceof HTMLImageElement) || typeof preset.drillTemplateSrc !== "string") {
			continue;
		}
		image.src = preset.drillTemplateSrc;
		image.alt = `${preset.label} drill layout preview`;
	}
	for (const link of group.querySelectorAll("[data-stompbox-drill-layout-download]")) {
		if (!(link instanceof HTMLAnchorElement) || typeof preset.drillLayoutSrc !== "string") {
			continue;
		}
		link.href = preset.drillLayoutSrc;
	}
}

function parseGroupPresetOptions (group) {
	const presetsJson = group.dataset.stompboxPresets;
	if (presetsJson === undefined) {
		return [];
	}
	const fallback = {
		id: "default",
		label: "Stompbox preset",
		src: "",
		view: "orbit",
		interactive: true,
		linework: false,
		lineworkColor: "#111827",
		backgroundColor: DEFAULT_BACKGROUND_COLOR,
		gridColor: DEFAULT_GRID_COLOR,
		gridOpacity: DEFAULT_GRID_OPACITY,
		toon: false,
		toonEdgeColor: DEFAULT_TOON_EDGE_COLOR,
		grain: false,
		grainScale: DEFAULT_GRAIN_SCALE,
		grainIntensity: DEFAULT_GRAIN_INTENSITY,
	};
	try {
		const parsed = JSON.parse(presetsJson);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed.flatMap((preset, index) => normalizePresetOption(preset, index, fallback));
	} catch (error) {
		console.error("Failed to parse stompbox preview presets", error);
		return [];
	}
}

function parsePresetOptions (viewer, src) {
	const group = viewer.closest("[data-stompbox-preview-preset-group]");
	const viewMode = viewer.dataset.viewMode === "top" ? "top" : "orbit";
	const interactive = viewer.dataset.interactive !== "false";
	const lineworkEnabled = viewer.dataset.linework === "true";
	const lineworkColor = viewer.dataset.lineworkColor ?? "#111827";
	const backgroundColor = viewer.dataset.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;
	const gridColor = viewer.dataset.gridColor ?? DEFAULT_GRID_COLOR;
	const gridOpacity = normalizeGridOpacity(viewer.dataset.gridOpacity, DEFAULT_GRID_OPACITY);
	const toonEnabled = viewer.dataset.toon === "true";
	const toonEdgeColor = viewer.dataset.toonEdgeColor ?? DEFAULT_TOON_EDGE_COLOR;
	const grainEnabled = viewer.dataset.grain === "true";
	const grainScale = normalizePositiveNumber(viewer.dataset.grainScale, DEFAULT_GRAIN_SCALE);
	const grainIntensity = normalizeUnitInterval(viewer.dataset.grainIntensity, DEFAULT_GRAIN_INTENSITY);
	const presetsJson = viewer.dataset.stompboxPresets ?? group?.dataset.stompboxPresets;
	const fallback = {
		id: "default",
		label: viewer.querySelector("canvas")?.getAttribute("aria-label") ?? "Stompbox preview",
		src,
		view: viewMode,
		interactive,
		linework: lineworkEnabled,
		lineworkColor,
		backgroundColor,
		gridColor,
		gridOpacity,
		toon: toonEnabled,
		toonEdgeColor,
		grain: grainEnabled,
		grainScale,
		grainIntensity,
	};
	if (presetsJson === undefined) {
		return [fallback];
	}
	try {
		const parsed = JSON.parse(presetsJson);
		if (!Array.isArray(parsed)) {
			return [fallback];
		}
		const presets = parsed.flatMap((preset, index) => normalizePresetOption(preset, index, fallback));
		return presets.length === 0 ? [fallback] : presets;
	} catch (error) {
		console.error("Failed to parse stompbox preview presets", error);
		return [fallback];
	}
}

function normalizePresetOption (preset, index, fallback) {
	if (preset === null || typeof preset !== "object") {
		return [];
	}
	const src = typeof preset.src === "string" && preset.src.length > 0 ? preset.src : fallback.src;
	const view = preset.view === "top" || preset.view === "orbit" ? preset.view : fallback.view;
	const lineworkColor = typeof preset.lineworkColor === "string" ? preset.lineworkColor : fallback.lineworkColor;
	const backgroundColor = typeof preset.backgroundColor === "string" && preset.backgroundColor.length > 0
		? preset.backgroundColor
		: fallback.backgroundColor;
	const gridColor = typeof preset.gridColor === "string" && preset.gridColor.length > 0
		? preset.gridColor
		: fallback.gridColor;
	const toonEdgeColor = typeof preset.toonEdgeColor === "string" && preset.toonEdgeColor.length > 0
		? preset.toonEdgeColor
		: fallback.toonEdgeColor;
	const grainScale = normalizePositiveNumber(preset.grainScale, fallback.grainScale);
	const grainIntensity = normalizeUnitInterval(preset.grainIntensity, fallback.grainIntensity);
	return [{
		id: typeof preset.id === "string" && preset.id.length > 0 ? preset.id : `preset-${index + 1}`,
		label: typeof preset.label === "string" && preset.label.length > 0 ? preset.label : `Preset ${index + 1}`,
		src,
		view,
		interactive: typeof preset.interactive === "boolean" ? preset.interactive : view !== "top",
		linework: typeof preset.linework === "boolean" ? preset.linework : fallback.linework,
		lineworkColor,
		backgroundColor,
		gridColor,
		gridOpacity: normalizeGridOpacity(preset.gridOpacity, fallback.gridOpacity),
		toon: typeof preset.toon === "boolean" ? preset.toon : fallback.toon,
		toonEdgeColor,
		grain: typeof preset.grain === "boolean" ? preset.grain : fallback.grain,
		grainScale,
		grainIntensity,
		drillTemplateSrc: typeof preset.drillTemplateSrc === "string" ? preset.drillTemplateSrc : undefined,
		drillLayoutSrc: typeof preset.drillLayoutSrc === "string" ? preset.drillLayoutSrc : undefined,
	}];
}

function applyPresetBackground (viewer, preset) {
	const backgroundColor = typeof preset.backgroundColor === "string" && preset.backgroundColor.length > 0
		? preset.backgroundColor
		: DEFAULT_BACKGROUND_COLOR;
	const gridColor = typeof preset.gridColor === "string" && preset.gridColor.length > 0
		? preset.gridColor
		: DEFAULT_GRID_COLOR;
	const gridOpacity = normalizeGridOpacity(preset.gridOpacity, DEFAULT_GRID_OPACITY);
	viewer.dataset.backgroundColor = backgroundColor;
	viewer.dataset.gridColor = gridColor;
	viewer.dataset.gridOpacity = String(gridOpacity);
	viewer.style.setProperty("--stompbox-viewer-background-color", backgroundColor);
	viewer.style.setProperty("--stompbox-viewer-grid-color", gridColor);
	viewer.style.setProperty("--stompbox-viewer-grid-opacity", String(gridOpacity));
}

function normalizeGridOpacity (value, fallback) {
	const opacity = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(opacity)) {
		return fallback;
	}
	return Math.max(0, Math.min(1, opacity));
}

function normalizePositiveNumber (value, fallback) {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number) || number <= 0) {
		return fallback;
	}
	return number;
}

function normalizeUnitInterval (value, fallback) {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) {
		return fallback;
	}
	return Math.max(0, Math.min(1, number));
}

function applyScreenGrainMaterials (root, preset) {
	if (preset?.grain !== true) {
		return;
	}
	root.traverse((object) => {
		if (!object.isMesh) {
			return;
		}
		for (const material of materialsForMesh(object)) {
			applyScreenGrainMaterial(material, preset);
		}
	});
}

function applyScreenGrainMaterial (material, preset) {
	if (material === undefined || (material.userData !== undefined && material.userData.screenGrainApplied === true)) {
		return;
	}
	const previousOnBeforeCompile = material.onBeforeCompile;
	const previousProgramCacheKey = material.customProgramCacheKey;
	material.onBeforeCompile = (shader, renderer) => {
		if (typeof previousOnBeforeCompile === "function") {
			previousOnBeforeCompile.call(material, shader, renderer);
		}
		shader.uniforms.grainScale = { value: preset.grainScale };
		shader.uniforms.grainIntensity = { value: preset.grainIntensity };
		shader.uniforms.grainIntensityScale = { value: GRAIN_INTENSITY_SCALE };
		shader.fragmentShader = screenGrainFragmentShader(shader.fragmentShader);
	};
	material.customProgramCacheKey = () => {
		const previousKey = typeof previousProgramCacheKey === "function"
			? previousProgramCacheKey.call(material)
			: "";
		return `${previousKey}|stompbox-screen-grain`;
	};
	material.userData = {
		...(material.userData ?? {}),
		screenGrainApplied: true,
	};
	material.needsUpdate = true;
}

function screenGrainFragmentShader (fragmentShader) {
	const grainPars = `
		uniform float grainScale;
		uniform float grainIntensity;
		uniform float grainIntensityScale;

		float stompboxScreenGrainRandom(vec2 value) {
			return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453123);
		}
	`;
	const grainApply = `
		float stompboxScreenGrainValue = stompboxScreenGrainRandom(floor(gl_FragCoord.xy / max(grainScale, 0.001)));
		float stompboxScreenGrainDelta = (stompboxScreenGrainValue - 0.5) * grainIntensity * grainIntensityScale;
		gl_FragColor.rgb = clamp(gl_FragColor.rgb + vec3(stompboxScreenGrainDelta), 0.0, 1.0);
	`;
	const shader = `${grainPars}\n${fragmentShader}`;
	if (shader.includes("#include <colorspace_fragment>")) {
		return shader.replace("#include <colorspace_fragment>", `${grainApply}\n\t#include <colorspace_fragment>`);
	}
	if (shader.includes("#include <dithering_fragment>")) {
		return shader.replace("#include <dithering_fragment>", `${grainApply}\n\t#include <dithering_fragment>`);
	}
	return shader.replace(/\n}\s*$/, `\n${grainApply}\n}`);
}

function applyToonMaterials (root, preset) {
	const gradientMap = createToonGradientMap();
	root.traverse((object) => {
		if (!object.isMesh || object.userData?.kind === "decal") {
			return;
		}
		if (Array.isArray(object.material)) {
			object.material = object.material.map((material) => toonMaterialForSource(material, gradientMap, preset));
			return;
		}
		object.material = toonMaterialForSource(object.material, gradientMap, preset);
	});
}

function createToonGradientMap () {
	if (sharedToonGradientMap !== undefined) {
		return sharedToonGradientMap;
	}
	const shadeSteps = new Uint8Array([64, 128, 190, 255]);
	const texture = new THREE.DataTexture(shadeSteps, shadeSteps.length, 1, THREE.RedFormat);
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	sharedToonGradientMap = texture;
	return texture;
}

function toonMaterialForSource (sourceMaterial, gradientMap, preset) {
	const source = sourceMaterial ?? {};
	const material = new THREE.MeshToonMaterial({
		color: materialColor(source),
		gradientMap,
		map: source.map ?? null,
		alphaMap: source.alphaMap ?? null,
		transparent: source.transparent === true || (Number.isFinite(source.opacity) && source.opacity < 1),
		opacity: Number.isFinite(source.opacity) ? source.opacity : 1,
		side: source.side ?? THREE.FrontSide,
	});
	material.name = `${typeof source.name === "string" && source.name.length > 0 ? source.name : "material"}-toon`;
	material.userData = { ...(source.userData ?? {}) };
	material.userData.toonSourceMaterial = source.name ?? "anonymous";
	material.userData.toonEdgeColor = preset.toonEdgeColor;
	if (source.normalMap !== undefined) {
		material.normalMap = source.normalMap;
	}
	if (source.normalScale !== undefined) {
		material.normalScale = source.normalScale.clone?.() ?? source.normalScale;
	}
	if (source.emissive?.isColor === true) {
		material.emissive.copy(source.emissive);
	}
	if (Number.isFinite(source.emissiveIntensity)) {
		material.emissiveIntensity = source.emissiveIntensity;
	}
	return material;
}

function materialColor (material) {
	const appearanceColor = material.userData?.appearanceMaterial?.color;
	if (typeof appearanceColor === "string" && appearanceColor.length > 0) {
		return new THREE.Color(appearanceColor);
	}
	if (material.color?.isColor === true) {
		return material.color.clone();
	}
	return new THREE.Color(0xffffff);
}

function presetSelectForViewer (viewer) {
	const localSelect = viewer.querySelector("[data-stompbox-preset-select]");
	if (localSelect instanceof HTMLSelectElement) {
		return localSelect;
	}
	const group = viewer.closest("[data-stompbox-preview-preset-group]");
	const groupSelect = group?.querySelector("[data-stompbox-preset-select]");
	return groupSelect instanceof HTMLSelectElement ? groupSelect : undefined;
}

function frameModel (model, camera, controls, viewMode, aspect) {
	const box = new THREE.Box3().setFromObject(model);
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const radius = Math.max(sphere.radius, 1);
	const enclosureFrame = findEnclosureFrame(model);
	model.position.sub(enclosureFrame?.center ?? sphere.center);

	if (viewMode === "top" && camera.isOrthographicCamera) {
		return frameOrthographicTopModel(model, camera, controls, aspect, enclosureFrame?.size);
	}

	const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
	camera.position.set(radius * 0.72, radius * 0.58, distance * 0.68);
	camera.near = Math.max(radius / 100, 0.1);
	camera.far = radius * 12;
	camera.lookAt(0, 0, 0);
	camera.updateProjectionMatrix();

	if (controls !== undefined) {
		controls.target.set(0, 0, 0);
		controls.minDistance = radius * 0.65;
		controls.maxDistance = radius * 6;
		controls.update();
	}
	return undefined;
}

function frameOrthographicTopModel (model, camera, controls, aspect, enclosureSize) {
	const box = new THREE.Box3().setFromObject(model);
	const size = enclosureSize === undefined
		? box.getSize(new THREE.Vector3())
		: new THREE.Vector3(
			enclosureSize.x + enclosureSize.z,
			enclosureSize.y,
			enclosureSize.z,
		);
	const maxDimension = Math.max(size.x, size.y, size.z, 1);
	updateOrthographicTopFrustum(camera, size, aspect);

	camera.position.set(0, 0, maxDimension * 3);
	camera.up.set(0, 1, 0);
	camera.near = 0.1;
	camera.far = maxDimension * 8;
	camera.lookAt(0, 0, 0);
	camera.updateProjectionMatrix();

	if (controls !== undefined) {
		controls.target.set(0, 0, 0);
		controls.enableRotate = false;
		controls.update();
	}
	return size;
}

function addCadLinework (root, lineworkColor = "#111827") {
	const meshes = [];
	const material = new THREE.LineBasicMaterial({
		color: new THREE.Color(lineworkColor),
		transparent: true,
		opacity: 0.85,
		depthTest: true,
		depthWrite: false,
	});

	root.traverse((object) => {
		if (object.isMesh && object.userData?.kind !== "decal") {
			meshes.push(object);
		}
	});

	for (const mesh of meshes) {
		if (mesh.geometry === undefined) {
			continue;
		}
		const edges = new THREE.EdgesGeometry(mesh.geometry, 35);
		const lines = new THREE.LineSegments(edges, material);
		lines.name = `${mesh.name || "mesh"}-cad-linework`;
		lines.renderOrder = 30;
		mesh.add(lines);
	}
}

function addToonOutline (root, outlineColor = DEFAULT_TOON_EDGE_COLOR) {
	const meshes = [];
	const material = new THREE.MeshBasicMaterial({
		color: new THREE.Color(outlineColor),
		side: THREE.BackSide,
		depthTest: true,
		depthWrite: false,
	});
	material.name = "stompbox-toon-outline";

	root.traverse((object) => {
		if (
			object.isMesh
			&& object.userData?.kind !== "decal"
			&& object.userData?.kind !== "toon-outline"
		) {
			meshes.push(object);
		}
	});

	for (const mesh of meshes) {
		if (mesh.geometry === undefined) {
			continue;
		}
		if (mesh.geometry.boundingBox === null || mesh.geometry.boundingBox === undefined) {
			mesh.geometry.computeBoundingBox();
		}
		if (mesh.geometry.boundingBox === null) {
			continue;
		}
		const center = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
		const outline = new THREE.Mesh(mesh.geometry, material);
		outline.name = `${mesh.name || "mesh"}-toon-outline`;
		outline.userData = {
			sourceMeshName: mesh.name || "mesh",
		};
		outline.userData.kind = "toon-outline";
		outline.renderOrder = 20;
		outline.scale.setScalar(TOON_OUTLINE_SCALE);
		outline.position.copy(center).multiplyScalar(1 - TOON_OUTLINE_SCALE);
		mesh.add(outline);
	}
}

function findEnclosureFrame (model) {
	let enclosure;
	model.traverse((object) => {
		if (enclosure !== undefined) {
			return;
		}
		if (object.userData?.kind === "enclosure" && object.userData?.dimensionsMm !== undefined) {
			enclosure = object;
		}
	});
	if (enclosure === undefined) {
		return undefined;
	}
	const dimensions = enclosure.userData.dimensionsMm;
	if (!Number.isFinite(dimensions.widthMm) || !Number.isFinite(dimensions.lengthMm) || !Number.isFinite(dimensions.depthMm)) {
		return undefined;
	}
	return {
		center: new THREE.Box3().setFromObject(enclosure).getCenter(new THREE.Vector3()),
		size: new THREE.Box3().setFromObject(enclosure).getSize(new THREE.Vector3()),
		dimensions,
	};
}

function updateOrthographicTopFrustum (camera, size, aspect) {
	const padding = 1.08;
	const modelWidth = Math.max(size.x, 1) * padding;
	const modelHeight = Math.max(size.y, 1) * padding;
	let viewWidth = modelWidth;
	let viewHeight = modelHeight;
	if (viewWidth / viewHeight < aspect) {
		viewWidth = viewHeight * aspect;
	} else {
		viewHeight = viewWidth / aspect;
	}

	camera.left = -viewWidth / 2;
	camera.right = viewWidth / 2;
	camera.top = viewHeight / 2;
	camera.bottom = -viewHeight / 2;
	camera.updateProjectionMatrix();
}

function applyDecalMaterial (mesh) {
	const decal = mesh.userData;
	if (decal?.kind !== "decal") {
		return;
	}
	const texture = createDecalTexture(decal);
	if (texture === undefined) {
		return;
	}
	ensureDecalUv(mesh);
	mesh.material = new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false,
	});
	mesh.renderOrder = 20;
}

function createDecalTexture (decal) {
	if (decal.decalKind === "text" && typeof decal.text === "string") {
		return createTextDecalTexture(decal);
	}
	if (decal.decalKind === "svg" && typeof decal.svg === "string") {
		return createImageDecalTexture(svgDataUri(colorizedSvg(decal.svg, decal.color)));
	}
	if (decal.decalKind === "image" && typeof decal.href === "string") {
		return createImageDecalTexture(decal.href);
	}
	return undefined;
}

function applyFlatAppearanceColorMaterial (mesh) {
	if (mesh.userData?.kind === "decal") {
		return;
	}
	const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
	const converted = materials.map((material) => flatAppearanceMaterial(material));
	mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
}

function flatAppearanceMaterial (material) {
	const appearance = material.userData?.appearanceMaterial;
	if (material.userData?.renderColorMode !== "flat-color" || typeof appearance?.color !== "string") {
		return material;
	}
	const opacity = Number.isFinite(appearance.opacity) ? appearance.opacity : 1;
	const flatMaterial = new THREE.MeshBasicMaterial({
		name: material.name,
		color: new THREE.Color(appearance.color),
		opacity,
		transparent: opacity < 1,
		side: material.side,
		depthWrite: material.depthWrite,
		toneMapped: false,
	});
	flatMaterial.userData = { ...material.userData };
	return flatMaterial;
}

function ensureDecalUv (mesh) {
	if (mesh.geometry.getAttribute("uv") !== undefined) {
		return;
	}
	mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(TEXT_DECAL_UVS, 2));
}

function createTextDecalTexture (decal) {
	const widthMm = Math.max(decal.sizeMm?.widthMm ?? 12, 1);
	const heightMm = Math.max(decal.sizeMm?.heightMm ?? 4, 1);
	const pixelScale = 48;
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(128, Math.ceil(widthMm * pixelScale));
	canvas.height = Math.max(64, Math.ceil(heightMm * pixelScale));

	const context = canvas.getContext("2d");
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = decal.color ?? "#111827";
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.font = textDecalFont(decal, pixelScale);
	context.fillText(decal.text, canvas.width / 2, canvas.height / 2);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.flipY = false;
	texture.needsUpdate = true;
	return texture;
}

function createImageDecalTexture (href) {
	const texture = new THREE.TextureLoader().load(href);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.flipY = false;
	return texture;
}

function textDecalFont (decal, pixelScale) {
	const sizePx = Math.max(10, (decal.fontSizeMm ?? 3) * pixelScale);
	const family = decal.fontFamily ?? "Arial, sans-serif";
	return `600 ${sizePx}px ${family}`;
}

function svgDataUri (svg) {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function colorizedSvg (svg, color) {
	return typeof color === "string" ? svg.replaceAll("currentColor", color) : svg;
}
