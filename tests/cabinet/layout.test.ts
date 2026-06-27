import { describe, expect, test } from "bun:test";
import type * as THREE from "three";
import {
	createCabinetPreviewGlb,
	createCabinetPreviewLayout,
	createCabinetPreviewObject3D,
	validateCabinetProfile,
} from "@vessel-dsp/cabinet";

const cabinetProfile = {
	schema: "vessel-cabinet-profile/v1" as const,
	brandName: "Vessel",
	modelName: "C212",
	enclosureColor: "#654321",
	appearance: {
		grilleColor: "#010203",
		brandLabelColor: "#fef3c7",
		modelLabelColor: "#e5e7eb",
		labelFontFamily: "Vessel Block",
		brandLabelFontSizeMm: 16,
		modelLabelFontSizeMm: 12,
		cornerProtectorColor: "#050505",
	},
	dimensionsMm: { widthMm: 760, heightMm: 520, depthMm: 300 },
};

function glbMagic(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes.slice(0, 4));
}

function meshColorHex(object: THREE.Object3D, name: string): string | undefined {
	const child = object.getObjectByName(name) as
		| (THREE.Object3D & { material?: THREE.Material | THREE.Material[] })
		| undefined;
	const material = Array.isArray(child?.material)
		? child.material[0]
		: child?.material;
	return (material as THREE.MeshStandardMaterial | undefined)?.color?.getHexString();
}

function firstChildMeshColorHex(
	object: THREE.Object3D,
	name: string,
): string | undefined {
	const child = object.getObjectByName(name);
	const mesh = child?.children[0] as
		| (THREE.Object3D & { material?: THREE.Material | THREE.Material[] })
		| undefined;
	const material = Array.isArray(mesh?.material) ? mesh.material[0] : mesh?.material;
	return (material as THREE.MeshStandardMaterial | undefined)?.color?.getHexString();
}

function boxDimensions(
	object: THREE.Object3D,
	name: string,
): { width: number; height: number; depth: number } {
	const child = object.getObjectByName(name) as
		| (THREE.Object3D & { geometry?: THREE.BufferGeometry })
		| undefined;
	if (child?.geometry === undefined) {
		throw new Error(`Missing mesh geometry for ${name}`);
	}
	child.geometry.computeBoundingBox();
	const boundingBox = child.geometry.boundingBox;
	if (boundingBox === null) {
		throw new Error(`Missing bounding box for ${name}`);
	}
	return {
		width: boundingBox.max.x - boundingBox.min.x,
		height: boundingBox.max.y - boundingBox.min.y,
		depth: boundingBox.max.z - boundingBox.min.z,
	};
}

function geometryType(object: THREE.Object3D, name: string): string | undefined {
	const child = object.getObjectByName(name) as
		| (THREE.Object3D & { geometry?: THREE.BufferGeometry })
		| undefined;
	return child?.geometry?.type;
}

function objectPosition(
	object: THREE.Object3D,
	name: string,
): { x: number; y: number; z: number } {
	const child = object.getObjectByName(name);
	if (child === undefined) {
		throw new Error(`Missing object ${name}`);
	}
	return { x: child.position.x, y: child.position.y, z: child.position.z };
}

function toonOutlineChild(object: THREE.Object3D, name: string): THREE.Object3D {
	const child = object.getObjectByName(name);
	const outline = child?.children.find(
		(candidate) => candidate.userData.kind === "toon-outline",
	);
	if (outline === undefined) {
		throw new Error(`Missing toon outline child for ${name}`);
	}
	return outline;
}

describe("cabinet visualization", () => {
	test("validates and lays out a covered speaker grille deterministically", () => {
		expect(validateCabinetProfile(cabinetProfile).valid).toBe(true);
		const layout = createCabinetPreviewLayout(cabinetProfile);

		expect(layout.schema).toBe("vessel-cabinet-preview-layout/v1");
		expect("speakers" in layout).toBe(false);
		expect(layout.grille.sizeMm.widthMm).toBeLessThan(
			cabinetProfile.dimensionsMm.widthMm,
		);
		expect(layout.appearance.grilleColor).toBe("#010203");
		expect(layout.appearance.brandLabelColor).toBe("#fef3c7");
		expect(layout.appearance.modelLabelColor).toBe("#e5e7eb");
		expect(layout.appearance.labelFontFamily).toBe("Vessel Block");
		expect(layout.appearance.brandLabelFontSizeMm).toBe(16);
		expect(layout.appearance.modelLabelFontSizeMm).toBe(12);
		expect(layout.appearance.cornerProtectorColor).toBe("#050505");
	});

	test("creates a Three.js object graph and GLB bytes", () => {
		const object = createCabinetPreviewObject3D(cabinetProfile, {
			effects: { schema: "vessel-preview-effects/v1", toon: true, grain: true },
		});
		const glb = createCabinetPreviewGlb(cabinetProfile);

		expect(object.name).toBe("cabinet-preview");
		expect(
			object.children.some((child) => child.name === "cabinet-body"),
		).toBe(true);
		expect(
			object.children.some((child) => child.name === "cabinet-trim-top"),
		).toBe(true);
		expect(
			object.children.some((child) => child.name === "cabinet-corner-top-left"),
		).toBe(true);
		expect(
			toonOutlineChild(object, "cabinet-body").userData.sourceObjectName,
		).toBe("cabinet-body");
		expect(toonOutlineChild(object, "cabinet-body").scale.x).toBeGreaterThan(1);
		expect("speakerCount" in object.userData.profile).toBe(false);
		expect(glbMagic(glb.bytes)).toBe("glTF");
		expect("speakers" in glb.preview.layout).toBe(false);
	});

	test("does not expose speaker metadata or meshes behind the grille", () => {
		const object = createCabinetPreviewObject3D(cabinetProfile);

		expect("speakers" in createCabinetPreviewLayout(cabinetProfile)).toBe(false);
		expect(object.getObjectByName("speaker-1")).toBeUndefined();
		expect(object.getObjectByName("speaker-2")).toBeUndefined();
	});

	test("applies appearance colors to generated preview parts", () => {
		const object = createCabinetPreviewObject3D(cabinetProfile);

		expect(meshColorHex(object, "cabinet-grille")).toBe("010203");
		expect(meshColorHex(object, "cabinet-corner-top-left")).toBe("050505");
		expect(firstChildMeshColorHex(object, "cabinet-brand-label")).toBe(
			"fef3c7",
		);
		expect(firstChildMeshColorHex(object, "cabinet-model-label")).toBe(
			"e5e7eb",
		);
		const brandLabel = object.getObjectByName("cabinet-brand-label");
		expect(brandLabel?.userData.text).toBe("Vessel");
		expect(brandLabel?.userData.fontFamily).toBe("Vessel Block");
		expect(brandLabel?.userData.fontSizeMm).toBe(16);
		expect(brandLabel?.type).toBe("Group");
		expect(brandLabel?.children.length).toBeGreaterThan(1);
		expect(
			object.getObjectByName("cabinet-model-label")?.userData.fontSizeMm,
		).toBe(12);
	});

	test("allows cabinet model labels to be omitted", () => {
		const { modelName: _modelName, ...profileWithoutModelName } = cabinetProfile;
		const object = createCabinetPreviewObject3D(profileWithoutModelName);

		expect(validateCabinetProfile(profileWithoutModelName).valid).toBe(true);
		expect(createCabinetPreviewLayout(profileWithoutModelName).modelName).toBe(
			undefined,
		);
		expect(object.getObjectByName("cabinet-model-label")).toBeUndefined();
	});

	test("uses cube-like corner protectors on all enclosure corners", () => {
		const object = createCabinetPreviewObject3D(cabinetProfile);
		const frontCorner = boxDimensions(object, "cabinet-corner-top-left");

		expect(frontCorner.depth).toBeCloseTo(frontCorner.width, 5);
		expect(frontCorner.depth).toBeCloseTo(frontCorner.height, 5);
		expect(object.getObjectByName("cabinet-corner-back-top-left")).toBeDefined();
		expect(
			object.getObjectByName("cabinet-corner-back-top-right"),
		).toBeDefined();
		expect(
			object.getObjectByName("cabinet-corner-back-bottom-left"),
		).toBeDefined();
		expect(
			object.getObjectByName("cabinet-corner-back-bottom-right"),
		).toBeDefined();
	});

	test("uses rounded enclosure box geometry for cabinet edges and corner caps", () => {
		const object = createCabinetPreviewObject3D(cabinetProfile);

		expect(geometryType(object, "cabinet-body")).toBe("RoundedBoxGeometry");
		expect(geometryType(object, "cabinet-grille")).toBe("RoundedBoxGeometry");
		expect(geometryType(object, "cabinet-trim-top")).toBe("RoundedBoxGeometry");
		expect(geometryType(object, "cabinet-corner-top-left")).toBe(
			"RoundedBoxGeometry",
		);
		expect(
			object.getObjectByName("cabinet-body")?.userData.cornerRadiusMm,
		).toBeGreaterThanOrEqual(18);
		expect(
			object.getObjectByName("cabinet-body")?.userData.cornerSegments,
		).toBeGreaterThanOrEqual(8);
	});

	test("places cabinet brand top centered and model at bottom right", () => {
		const object = createCabinetPreviewObject3D(cabinetProfile);
		const layout = createCabinetPreviewLayout(cabinetProfile);
		const brand = objectPosition(object, "cabinet-brand-label");
		const model = objectPosition(object, "cabinet-model-label");
		const topLabelY =
			layout.grille.centerMm.y +
			layout.grille.sizeMm.heightMm / 2 -
			layout.appearance.brandLabelFontSizeMm * 1.75;
		const bottomLabelY =
			layout.grille.centerMm.y -
			layout.grille.sizeMm.heightMm / 2 +
			layout.appearance.modelLabelFontSizeMm;

		expect(brand.x).toBeCloseTo(0, 5);
		expect(brand.y).toBeCloseTo(topLabelY, 5);
		expect(model.x).toBeGreaterThan(0);
		expect(model.y).toBeCloseTo(bottomLabelY, 5);
	});

	test("uses larger default brand labels", () => {
		const { appearance: _appearance, ...profileWithDefaultAppearance } =
			cabinetProfile;
		const layout = createCabinetPreviewLayout(profileWithDefaultAppearance);
		const object = createCabinetPreviewObject3D(profileWithDefaultAppearance);

		expect(layout.appearance.brandLabelFontSizeMm).toBeGreaterThan(
			layout.appearance.modelLabelFontSizeMm,
		);
		expect(layout.appearance.brandLabelFontSizeMm).toBe(22);
		expect(layout.appearance.grilleColor).toBe("#1f2937");
		expect(meshColorHex(object, "cabinet-grille")).toBe("1f2937");
	});
});
