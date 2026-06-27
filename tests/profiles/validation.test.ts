import { describe, expect, test } from "bun:test";
import {
	ampProfileSchema,
	cabinetProfileSchema,
	validateAmpProfile,
	validateCabinetProfile,
} from "@vessel-dsp/core";

describe("preview profile validation", () => {
	test("validates canonical amp profiles without Three.js preview packages", () => {
		const profile = {
			schema: "vessel-amp-profile/v1" as const,
			brandName: "Vessel",
			modelName: "A15",
			enclosureColor: "#123456",
			dimensionsMm: { widthMm: 500, heightMm: 220, depthMm: 210 },
			controlPanel: {
				face: "front" as const,
				controls: [
					{ id: "gain", kind: "knob" as const, label: "Gain", value: 0.7 },
					{ id: "bright", kind: "switch" as const, label: "Bright", value: 1 },
					{ id: "power", kind: "led" as const, label: "Power" },
				],
			},
		};

		expect(ampProfileSchema.parse(profile)).toEqual(profile);
		expect(validateAmpProfile(profile)).toEqual({
			valid: true,
			profile,
			diagnostics: [],
		});
	});

	test("reports artifact cabinet profile fields that need migration", () => {
		const artifactShape = {
			$schema: "../../schemas/cabinet-profile.schema.json",
			kind: "cabinet",
			brand: "Marshall",
			model: "1960A / 1960B",
			dimensions: { widthMm: 770, heightMm: 755, depthMm: 365 },
			drivers: [{ model: "Celestion G12T-75", count: 4 }],
		};

		const validation = validateCabinetProfile(artifactShape);

		expect(validation.valid).toBe(false);
		expect(validation.diagnostics).toContain(
			"schema: Required; expected vessel-cabinet-profile/v1",
		);
		expect(validation.diagnostics).toContain("brandName: Required");
		expect(validation.diagnostics).toContain("dimensionsMm: Required");
		expect(() => cabinetProfileSchema.parse(artifactShape)).toThrow();
	});

	test("rejects invalid amp control values with field paths", () => {
		const validation = validateAmpProfile({
			schema: "vessel-amp-profile/v1",
			brandName: "Vessel",
			modelName: "A15",
			enclosureColor: "#123456",
			dimensionsMm: { widthMm: 500, heightMm: 220, depthMm: 210 },
			controlPanel: {
				controls: [{ id: "", kind: "fader", label: "", value: 1.5 }],
			},
		});

		expect(validation.valid).toBe(false);
		expect(validation.diagnostics).toContain("controlPanel.controls.0.id: Required");
		expect(validation.diagnostics).toContain(
			"controlPanel.controls.0.kind: Invalid enum value. Expected 'knob' | 'switch' | 'led', received 'fader'",
		);
		expect(validation.diagnostics).toContain(
			"controlPanel.controls.0.label: Required",
		);
		expect(validation.diagnostics).toContain(
			"controlPanel.controls.0.value: Number must be less than or equal to 1",
		);
	});
});
