import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

for (const viewer of document.querySelectorAll("[data-stompbox-glb-viewer]")) {
	if (viewer.dataset.viewerReady === "true") {
		continue;
	}
	viewer.dataset.viewerReady = "true";
	initStompboxViewer(viewer);
}

function initStompboxViewer(viewer) {
	const canvas = viewer.querySelector("canvas");
	const status = viewer.querySelector("[data-stompbox-glb-status]");
	const src = viewer.dataset.glbSrc;
	if (!(canvas instanceof HTMLCanvasElement) || src === undefined) {
		return;
	}

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0xf8fafc);

	const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
	camera.position.set(75, 65, 145);

	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: true,
		alpha: false,
		powerPreference: "high-performance",
		preserveDrawingBuffer: true,
	});
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.setClearColor(0xf8fafc, 1);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

	scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, 2.2));

	const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
	keyLight.position.set(120, 160, 140);
	scene.add(keyLight);

	const fillLight = new THREE.DirectionalLight(0xffffff, 0.9);
	fillLight.position.set(-100, 70, -80);
	scene.add(fillLight);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.06;
	controls.enablePan = false;
	controls.autoRotate = !reducedMotionQuery.matches;
	controls.autoRotateSpeed = 0.6;

	const modelRoot = new THREE.Group();
	scene.add(modelRoot);

	const loader = new GLTFLoader();
	loader.load(
		src,
		(gltf) => {
			const model = gltf.scene;
			model.traverse((child) => {
				if (!child.isMesh) {
					return;
				}
				child.castShadow = false;
				child.receiveShadow = true;
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
			modelRoot.add(model);
			frameModel(model, camera, controls);
			if (status !== null) {
				status.hidden = true;
			}
			viewer.dataset.viewerLoaded = "true";
		},
		undefined,
		(error) => {
			if (status !== null) {
				status.textContent = "3D preview failed to load.";
			}
			console.error("Failed to load stompbox GLB preview", error);
		},
	);

	function resize() {
		const width = Math.max(1, viewer.clientWidth);
		const height = Math.max(1, viewer.clientHeight);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		renderer.setSize(width, height, false);
	}

	const resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(viewer);
	resize();

	function animate() {
		requestAnimationFrame(animate);
		controls.autoRotate = !reducedMotionQuery.matches;
		controls.update();
		renderer.render(scene, camera);
	}
	animate();
}

function frameModel(model, camera, controls) {
	const box = new THREE.Box3().setFromObject(model);
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	const radius = Math.max(sphere.radius, 1);
	model.position.sub(sphere.center);

	const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
	camera.position.set(radius * 0.72, radius * 0.58, distance * 0.68);
	camera.near = Math.max(radius / 100, 0.1);
	camera.far = radius * 12;
	camera.lookAt(0, 0, 0);
	camera.updateProjectionMatrix();

	controls.target.set(0, 0, 0);
	controls.minDistance = radius * 0.65;
	controls.maxDistance = radius * 6;
	controls.update();
}
