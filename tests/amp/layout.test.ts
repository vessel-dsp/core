import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type * as THREE from "three";
import {
	createAmpProfileFromVdsp,
	createAmpPreviewGlb,
	createAmpPreviewLayout,
	createAmpPreviewObject3D,
	validateAmpProfile,
} from "@vessel-dsp/amp";

const ampProfile = {
	schema: "vessel-amp-profile/v1" as const,
	brandName: "Vessel",
	modelName: "A15",
	enclosureColor: "#123456",
	appearance: {
		frontPanelColor: "#010203",
		frontPanelBorderColor: "#f8fafc",
		controlPanelColor: "#c9a24a",
		brandLabelColor: "#fef3c7",
		modelLabelColor: "#e5e7eb",
		labelFontFamily: "Vessel Block",
		brandLabelFontSizeMm: 16,
		modelLabelFontSizeMm: 12,
		knobColor: "#d4a73c",
		knobLabelColor: "#111827",
		knobLabelFontSizeMm: 7,
		statusColor: "#22c55e",
		cornerProtectorColor: "#050505",
		handleGripColor: "#0f172a",
	},
	dimensionsMm: { widthMm: 500, heightMm: 220, depthMm: 210 },
	controlPanel: {
		face: "front" as const,
		controls: [
			{
				id: "gain",
				kind: "knob" as const,
				label: "Gain",
				value: 0.7,
				color: "#abc123",
				labelColor: "#def456",
			},
			{ id: "bright", kind: "switch" as const, label: "Bright", value: 1 },
			{
				id: "power",
				kind: "led" as const,
				label: "Power",
				statusColor: "#16a34a",
			},
		],
	},
};
const REPOSITORY_ROOT = join(import.meta.dir, "..", "..");
const vdspMechanicalBoardRealization = readFileSync(
	join(
		REPOSITORY_ROOT,
		"tests/fixtures/interchange/vdsp-v3-mechanical-board-realization.vdsp",
	),
	"utf8",
);

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

function childMeshColorHexes(object: THREE.Object3D, name: string): string[] {
	const child = object.getObjectByName(name);
	if (child === undefined) {
		throw new Error(`Missing object ${name}`);
	}
	return child.children.flatMap((mesh) => {
		const material = Array.isArray(
			(mesh as THREE.Object3D & {
				material?: THREE.Material | THREE.Material[];
			}).material,
		)
			? (mesh as THREE.Object3D & { material?: THREE.Material[] }).material?.[0]
			: (mesh as THREE.Object3D & { material?: THREE.Material }).material;
		const color = (material as THREE.MeshStandardMaterial | undefined)?.color;
		return color === undefined ? [] : [color.getHexString()];
	});
}

function childZRange(
	object: THREE.Object3D,
	name: string,
	predicate: (child: THREE.Object3D) => boolean,
): { min: number; max: number } {
	const group = object.getObjectByName(name);
	if (group === undefined) {
		throw new Error(`Missing object ${name}`);
	}
	const values = group.children
		.filter(predicate)
		.map((child) => child.position.z);
	if (values.length === 0) {
		throw new Error(`Missing matching child for ${name}`);
	}
	return { min: Math.min(...values), max: Math.max(...values) };
}

function boxYBounds(
	object: THREE.Object3D,
	name: string,
): { min: number; max: number } {
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
		min: child.position.y + boundingBox.min.y,
		max: child.position.y + boundingBox.max.y,
	};
}

function boxXBounds(
	object: THREE.Object3D,
	name: string,
): { min: number; max: number } {
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
		min: child.position.x + boundingBox.min.x,
		max: child.position.x + boundingBox.max.x,
	};
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

function lineYRange(
	object: THREE.Object3D,
	name: string,
): { min: number; max: number } {
	const position = objectPosition(object, name);
	const dimensions = boxDimensions(object, name);
	const line = object.getObjectByName(name);
	if (line === undefined) {
		throw new Error(`Missing object ${name}`);
	}
	const yHalfSpan = Math.abs(Math.sin(line.rotation.z)) * dimensions.width * 0.5;
	const strokeHalfSpan = dimensions.height * 0.5;
	return {
		min: position.y - yHalfSpan - strokeHalfSpan,
		max: position.y + yHalfSpan + strokeHalfSpan,
	};
}

function overlapsYBand(
	range: { min: number; max: number },
	centerY: number,
	halfHeight: number,
): boolean {
	return range.max >= centerY - halfHeight && range.min <= centerY + halfHeight;
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

function grilleNetLines(object: THREE.Object3D): THREE.Object3D[] {
	const net = object.getObjectByName("amp-grille-net");
	if (net === undefined) {
		throw new Error("Missing amp grille net");
	}
	return net.children;
}

function groupXBounds(
	object: THREE.Object3D,
	name: string,
): { min: number; max: number } {
	const group = object.getObjectByName(name);
	if (group === undefined) {
		throw new Error(`Missing object ${name}`);
	}
	const childBounds = group.children.map((child) => {
		const mesh = child as THREE.Object3D & { geometry?: THREE.BufferGeometry };
		if (mesh.geometry === undefined) {
			throw new Error(`Missing child geometry for ${name}`);
		}
		mesh.geometry.computeBoundingBox();
		const boundingBox = mesh.geometry.boundingBox;
		if (boundingBox === null) {
			throw new Error(`Missing child bounding box for ${name}`);
		}
		return {
			min: group.position.x + child.position.x + boundingBox.min.x,
			max: group.position.x + child.position.x + boundingBox.max.x,
		};
	});
	return {
		min: Math.min(...childBounds.map((bounds) => bounds.min)),
		max: Math.max(...childBounds.map((bounds) => bounds.max)),
	};
}

describe("amp visualization", () => {
	test("derives a generated amp profile from .vdsp panel controls", () => {
		const profile = createAmpProfileFromVdsp(vdspMechanicalBoardRealization, {
			brandName: "Vessel",
			modelName: "Sample Drive",
			enclosureColor: "#111827",
			dimensionsMm: { widthMm: 520, heightMm: 260, depthMm: 220 },
			appearance: {
				controlPanelColor: "#c9a24a",
				knobColor: "#d4a73c",
				statusColor: "#16a34a",
			},
		});

		expect(validateAmpProfile(profile).valid).toBe(true);
		expect(profile).toMatchObject({
			schema: "vessel-amp-profile/v1",
			brandName: "Vessel",
			modelName: "Sample Drive",
			enclosureColor: "#111827",
			dimensionsMm: { widthMm: 520, heightMm: 260, depthMm: 220 },
			controlPanel: { face: "front" },
		});
		expect(profile.controlPanel.controls.map((control) => control.id)).toEqual([
			"DRIVE",
			"LEVEL",
			"TONE",
			"LED_STATUS",
		]);
		expect(profile.controlPanel.controls).toContainEqual(
			expect.objectContaining({
				id: "DRIVE",
				kind: "knob",
				label: "DRIVE",
			}),
		);
		expect(profile.controlPanel.controls).toContainEqual(
			expect.objectContaining({
				id: "LED_STATUS",
				kind: "led",
				label: "LED_STATUS",
			}),
		);

		const layout = createAmpPreviewLayout(profile);
		expect(layout.controls.map((control) => control.id)).toEqual([
			"DRIVE",
			"LEVEL",
			"TONE",
			"LED_STATUS",
		]);
		expect(layout.appearance.controlPanelColor).toBe("#c9a24a");
	});

	test("uses amp appearance embedded in .vdsp metadata", () => {
		const vdspSource = vdspMechanicalBoardRealization.replace(
			"components:",
			`appearance:
  kind: amp
  enclosureColor: "#334155"
  appearance:
    controlPanelColor: "#f8fafc"
    frontPanelColor: "#010203"
    labelFontFamily: Vessel Block
components:`,
		);

		const profile = createAmpProfileFromVdsp(vdspSource, {
			brandName: "Vessel",
			modelName: "Embedded Amp",
			appearance: {
				controlPanelColor: "#c9a24a",
			},
		});

		expect(profile.enclosureColor).toBe("#334155");
		expect(profile.appearance).toMatchObject({
			controlPanelColor: "#c9a24a",
			frontPanelColor: "#010203",
			labelFontFamily: "Vessel Block",
		});
	});

	test("validates and lays out amp profiles deterministically", () => {
		expect(validateAmpProfile(ampProfile).valid).toBe(true);
		const layout = createAmpPreviewLayout(ampProfile);

		expect(layout.schema).toBe("vessel-amp-preview-layout/v1");
		expect(layout.brandName).toBe("Vessel");
		expect(layout.modelName).toBe("A15");
		expect(layout.body.dimensionsMm).toEqual(ampProfile.dimensionsMm);
		expect(layout.controls.map((control) => control.id)).toEqual([
			"gain",
			"bright",
			"power",
		]);
		expect(layout.controls[0]?.centerMm.x).toBeLessThan(0);
		expect(layout.controls[2]?.centerMm.x).toBeGreaterThan(0);
		expect(layout.appearance.frontPanelColor).toBe("#010203");
		expect(layout.appearance.frontPanelBorderColor).toBe("#f8fafc");
		expect(layout.appearance.labelFontFamily).toBe("Vessel Block");
		expect(layout.appearance.brandLabelFontSizeMm).toBe(16);
		expect(layout.appearance.modelLabelFontSizeMm).toBe(12);
		expect(layout.appearance.knobLabelFontSizeMm).toBe(7);
		expect(layout.controlPanel.color).toBe("#c9a24a");
		expect(layout.controls[0]?.color).toBe("#abc123");
		expect(layout.controls[0]?.labelColor).toBe("#def456");
		expect(layout.controls[2]?.statusColor).toBe("#16a34a");
	});

	test("creates a Three.js object graph and GLB bytes", () => {
		const object = createAmpPreviewObject3D(ampProfile, {
			effects: { schema: "vessel-preview-effects/v1", toon: true },
		});
		const glb = createAmpPreviewGlb(ampProfile);

		expect(object.name).toBe("amp-preview");
		expect(object.children.some((child) => child.name === "amp-body")).toBe(
			true,
		);
		expect(object.children.some((child) => child.name === "amp-grille")).toBe(
			true,
		);
		expect(object.children.some((child) => child.name === "amp-handle")).toBe(
			true,
		);
		expect(
			object.children.some((child) => child.name === "amp-corner-top-left"),
		).toBe(true);
		expect(object.userData.profile.brandName).toBe("Vessel");
		expect(toonOutlineChild(object, "amp-body").userData.sourceObjectName).toBe(
			"amp-body",
		);
		expect(toonOutlineChild(object, "amp-body").scale.x).toBeGreaterThan(1);
		expect(glbMagic(glb.bytes)).toBe("glTF");
		expect(glb.preview.layout.controls).toHaveLength(3);
	});

	test("applies appearance colors to generated preview parts", () => {
		const object = createAmpPreviewObject3D(ampProfile);

		expect(meshColorHex(object, "amp-grille")).toBe("010203");
		expect(meshColorHex(object, "amp-trim-top")).toBe("f8fafc");
		expect(meshColorHex(object, "amp-control-panel")).toBe("c9a24a");
		expect(meshColorHex(object, "amp-handle")).toBe("0f172a");
		expect(meshColorHex(object, "amp-handle-mount-left")).toBe("c9a24a");
		expect(meshColorHex(object, "amp-handle-mount-right")).toBe("c9a24a");
		expect(meshColorHex(object, "amp-control-gain")).toBe("abc123");
		expect(meshColorHex(object, "amp-control-power")).toBe("16a34a");
		expect(meshColorHex(object, "amp-corner-top-left")).toBe("050505");
		expect(firstChildMeshColorHex(object, "amp-control-label-gain")).toBe(
			"def456",
		);
		expect(firstChildMeshColorHex(object, "amp-brand-label")).toBe("fef3c7");
		expect(firstChildMeshColorHex(object, "amp-model-label")).toBe("e5e7eb");
		expect(childMeshColorHexes(object, "amp-brand-label")).toContain("000000");
		expect(childMeshColorHexes(object, "amp-model-label")).toContain("000000");
		const brandLabel = object.getObjectByName("amp-brand-label");
		expect(brandLabel?.userData.text).toBe("Vessel");
		expect(brandLabel?.userData.fontFamily).toBe("Vessel Block");
		expect(brandLabel?.userData.fontSizeMm).toBe(16);
		expect(brandLabel?.userData.outlineColor).toBe("#000000");
		expect(brandLabel?.userData.outlineWidthMm).toBeGreaterThan(0);
		expect(brandLabel?.type).toBe("Group");
		expect(brandLabel?.children.length).toBeGreaterThan(1);
		expect(object.getObjectByName("amp-model-label")?.userData.fontSizeMm).toBe(
			12,
		);
		expect(
			object.getObjectByName("amp-control-label-gain")?.userData.fontSizeMm,
		).toBe(7);
		const fillZ = childZRange(
			object,
			"amp-brand-label",
			(child) => child.userData.kind === "vector-text-fill",
		);
		const outlineZ = childZRange(
			object,
			"amp-brand-label",
			(child) => child.userData.kind === "vector-text-outline",
		);
		expect(outlineZ.max).toBeLessThan(fillZ.min);
	});

	test("adds a light diagonal grille net over the amp front panel", () => {
		const object = createAmpPreviewObject3D(ampProfile);
		const grille = object.getObjectByName("amp-grille");
		const net = object.getObjectByName("amp-grille-net");
		const lines = grilleNetLines(object);
		const positiveLine = lines.find(
			(line) => line.userData.direction === "positive",
		);
		const negativeLine = lines.find(
			(line) => line.userData.direction === "negative",
		);
		const grilleSize = boxDimensions(object, "amp-grille");
		const grillePosition = objectPosition(object, "amp-grille");
		const brandPosition = objectPosition(object, "amp-brand-label");
		const modelPosition = objectPosition(object, "amp-model-label");

		expect(net?.type).toBe("Group");
		expect(net?.userData.kind).toBe("amp-grille-diagonal-net");
		expect(net?.userData.spacingMm).toBeLessThanOrEqual(18);
		expect(net?.position.z).toBeGreaterThan(grille?.position.z ?? 0);
		expect(brandPosition.z).toBeGreaterThan(net?.position.z ?? 0);
		expect(modelPosition.z).toBeGreaterThan(net?.position.z ?? 0);
		expect(lines.length).toBeGreaterThan(20);
		expect(positiveLine).toBeDefined();
		expect(negativeLine).toBeDefined();
		expect(positiveLine?.rotation.z).toBeGreaterThan(0);
		expect(negativeLine?.rotation.z).toBeLessThan(0);
		expect(meshColorHex(object, positiveLine?.name ?? "")).toBe("cccccc");
		let brandBandLineCount = 0;
		let modelBandLineCount = 0;
		for (const line of lines) {
			const position = objectPosition(object, line.name);
			const dimensions = boxDimensions(object, line.name);
			expect(position.x).toBeGreaterThanOrEqual(-grilleSize.width / 2);
			expect(position.x).toBeLessThanOrEqual(grilleSize.width / 2);
			expect(position.y).toBeGreaterThanOrEqual(-grilleSize.height / 2);
			expect(position.y).toBeLessThanOrEqual(grilleSize.height / 2);
			expect(dimensions.depth).toBeLessThan(3);
			const yRange = lineYRange(object, line.name);
			if (
				overlapsYBand(
					yRange,
					brandPosition.y - grillePosition.y,
					ampProfile.appearance.brandLabelFontSizeMm,
				)
			) {
				brandBandLineCount += 1;
			}
			if (
				overlapsYBand(
					yRange,
					modelPosition.y - grillePosition.y,
					ampProfile.appearance.modelLabelFontSizeMm,
				)
			) {
				modelBandLineCount += 1;
			}
		}
		expect(brandBandLineCount).toBeGreaterThan(0);
		expect(modelBandLineCount).toBeGreaterThan(0);
	});

	test("keeps the front panel border rails connected around the grille", () => {
		const object = createAmpPreviewObject3D(ampProfile);
		const top = boxYBounds(object, "amp-trim-top");
		const bottom = boxYBounds(object, "amp-trim-bottom");
		const left = boxYBounds(object, "amp-trim-left");
		const right = boxYBounds(object, "amp-trim-right");

		expect(left.max).toBeCloseTo(top.min, 5);
		expect(left.min).toBeCloseTo(bottom.max, 5);
		expect(right.max).toBeCloseTo(top.min, 5);
		expect(right.min).toBeCloseTo(bottom.max, 5);
	});

	test("keeps the handle connected to its mounts", () => {
		const object = createAmpPreviewObject3D(ampProfile);
		const handle = boxXBounds(object, "amp-handle");
		const leftMount = boxXBounds(object, "amp-handle-mount-left");
		const rightMount = boxXBounds(object, "amp-handle-mount-right");
		const handleY = boxYBounds(object, "amp-handle");
		const leftMountY = boxYBounds(object, "amp-handle-mount-left");
		const rightMountY = boxYBounds(object, "amp-handle-mount-right");

		expect(leftMount.max).toBeCloseTo(handle.min, 5);
		expect(rightMount.min).toBeCloseTo(handle.max, 5);
		expect(leftMountY.min).toBeCloseTo(handleY.min, 5);
		expect(leftMountY.max).toBeCloseTo(handleY.max, 5);
		expect(rightMountY.min).toBeCloseTo(handleY.min, 5);
		expect(rightMountY.max).toBeCloseTo(handleY.max, 5);
	});

	test("uses cube-like corner protectors on all enclosure corners", () => {
		const object = createAmpPreviewObject3D(ampProfile);
		const frontCorner = boxDimensions(object, "amp-corner-top-left");

		expect(frontCorner.depth).toBeCloseTo(frontCorner.width, 5);
		expect(frontCorner.depth).toBeCloseTo(frontCorner.height, 5);
		expect(object.getObjectByName("amp-corner-back-top-left")).toBeDefined();
		expect(object.getObjectByName("amp-corner-back-top-right")).toBeDefined();
		expect(object.getObjectByName("amp-corner-back-bottom-left")).toBeDefined();
		expect(object.getObjectByName("amp-corner-back-bottom-right")).toBeDefined();
	});

	test("uses rounded enclosure box geometry for amp edges and corner caps", () => {
		const object = createAmpPreviewObject3D(ampProfile);

		expect(geometryType(object, "amp-body")).toBe("RoundedBoxGeometry");
		expect(geometryType(object, "amp-grille")).toBe("RoundedBoxGeometry");
		expect(geometryType(object, "amp-control-panel")).toBe("RoundedBoxGeometry");
		expect(geometryType(object, "amp-handle")).toBe("RoundedBoxGeometry");
		expect(geometryType(object, "amp-corner-top-left")).toBe(
			"RoundedBoxGeometry",
		);
		expect(
			object.getObjectByName("amp-body")?.userData.cornerRadiusMm,
		).toBeGreaterThanOrEqual(18);
		expect(
			object.getObjectByName("amp-body")?.userData.cornerSegments,
		).toBeGreaterThanOrEqual(8);
	});

	test("places amp brand centered on the front panel and model at bottom right", () => {
		const object = createAmpPreviewObject3D(ampProfile);
		const layout = createAmpPreviewLayout(ampProfile);
		const brand = objectPosition(object, "amp-brand-label");
		const model = objectPosition(object, "amp-model-label");
		const modelBounds = groupXBounds(object, "amp-model-label");
		const grilleHeight = Math.max(30, layout.body.dimensionsMm.heightMm * 0.48);
		const grilleCenterY =
			layout.controlPanel.centerMm.y +
			layout.controlPanel.sizeMm.heightMm / 2 +
			grilleHeight / 2 +
			layout.body.dimensionsMm.heightMm * 0.045;
		const grilleBottomY = grilleCenterY - grilleHeight / 2;
		const grilleRightX = (layout.body.dimensionsMm.widthMm * 0.82) / 2;

		expect(brand.x).toBeCloseTo(0, 5);
		expect(brand.y).toBeCloseTo(grilleCenterY, 5);
		expect(model.x).toBeGreaterThan(0);
		expect(modelBounds.max).toBeLessThanOrEqual(grilleRightX - 8);
		expect(model.y).toBeLessThan(brand.y);
		expect(model.y).toBeCloseTo(
			grilleBottomY + layout.appearance.modelLabelFontSizeMm,
			5,
		);
	});

	test("right aligns long amp model labels inside the front panel", () => {
		const object = createAmpPreviewObject3D({
			...ampProfile,
			modelName: "Lead 800 Custom",
		});
		const layout = createAmpPreviewLayout(ampProfile);
		const modelBounds = groupXBounds(object, "amp-model-label");
		const grilleRightX = (layout.body.dimensionsMm.widthMm * 0.82) / 2;

		expect(modelBounds.max).toBeLessThanOrEqual(grilleRightX - 8);
	});

	test("uses larger default brand labels", () => {
		const { appearance: _appearance, ...profileWithDefaultAppearance } = ampProfile;
		const layout = createAmpPreviewLayout(profileWithDefaultAppearance);
		const object = createAmpPreviewObject3D(profileWithDefaultAppearance);

		expect(layout.appearance.brandLabelFontSizeMm).toBeGreaterThan(
			layout.appearance.modelLabelFontSizeMm,
		);
		expect(layout.appearance.brandLabelFontSizeMm).toBe(22);
		expect(layout.appearance.frontPanelColor).toBe("#1f2937");
		expect(meshColorHex(object, "amp-grille")).toBe("1f2937");
	});
});
