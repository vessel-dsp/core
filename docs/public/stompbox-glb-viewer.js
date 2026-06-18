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
	const viewMode = viewer.dataset.viewMode === "top" ? "top" : "orbit";
	const interactive = viewer.dataset.interactive !== "false";
	const lineworkEnabled = viewer.dataset.linework === "true";
	const lineworkColor = viewer.dataset.lineworkColor ?? "#111827";
	if (!(canvas instanceof HTMLCanvasElement) || src === undefined) {
		return;
	}

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0xf8fafc);

	const camera = viewMode === "top"
		? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000)
		: new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
	if (camera.isPerspectiveCamera) {
		camera.position.set(75, 65, 145);
	}

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

	const controls = interactive ? new OrbitControls(camera, renderer.domElement) : undefined;
	if (controls !== undefined) {
		controls.enableDamping = true;
		controls.dampingFactor = 0.06;
		controls.enablePan = false;
		controls.enableRotate = viewMode !== "top";
		controls.autoRotate = viewMode !== "top" && !reducedMotionQuery.matches;
		controls.autoRotateSpeed = 0.6;
	}

	const modelRoot = new THREE.Group();
	scene.add(modelRoot);
	let orthographicTopSize;

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
			if (lineworkEnabled) {
				addCadLinework(model, lineworkColor);
			}
			modelRoot.add(model);
			const aspect = Math.max(1, viewer.clientWidth) / Math.max(1, viewer.clientHeight);
			orthographicTopSize = frameModel(model, camera, controls, viewMode, aspect);
			resize();
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

	function animate() {
		requestAnimationFrame(animate);
		if (controls !== undefined) {
			controls.autoRotate = viewMode !== "top" && !reducedMotionQuery.matches;
			controls.update();
		}
		renderer.render(scene, camera);
	}
	animate();
}

function frameModel(model, camera, controls, viewMode, aspect) {
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

function frameOrthographicTopModel(model, camera, controls, aspect, enclosureSize) {
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

function addCadLinework(root, lineworkColor = "#111827") {
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

function findEnclosureFrame(model) {
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

function updateOrthographicTopFrustum(camera, size, aspect) {
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

function applyDecalMaterial(mesh) {
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

function createDecalTexture(decal) {
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

function applyFlatAppearanceColorMaterial(mesh) {
	if (mesh.userData?.kind === "decal") {
		return;
	}
	const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
	const converted = materials.map((material) => flatAppearanceMaterial(material));
	mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
}

function flatAppearanceMaterial(material) {
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

function ensureDecalUv(mesh) {
	if (mesh.geometry.getAttribute("uv") !== undefined) {
		return;
	}
	mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(TEXT_DECAL_UVS, 2));
}

function createTextDecalTexture(decal) {
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

function createImageDecalTexture(href) {
	const texture = new THREE.TextureLoader().load(href);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.flipY = false;
	return texture;
}

function textDecalFont(decal, pixelScale) {
	const sizePx = Math.max(10, (decal.fontSizeMm ?? 3) * pixelScale);
	const family = decal.fontFamily ?? "Arial, sans-serif";
	return `600 ${sizePx}px ${family}`;
}

function svgDataUri(svg) {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function colorizedSvg(svg, color) {
	return typeof color === "string" ? svg.replaceAll("currentColor", color) : svg;
}
