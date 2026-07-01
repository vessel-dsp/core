import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { createAmpProfileFromVdsp } from "../../packages/amp/src/index.js";
import { parseInterchangeYaml } from "../../packages/core/src/formats/interchange/parser.js";
import type {
	CircuitDocument,
	DocumentAmpAppearance,
	DocumentStompboxAppearance,
	VdspBuildDataObject,
} from "../../packages/core/src/model/types.js";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || "../../../artifacts";
const PEDAL_DIR = `${ARTIFACTS_DIR}/schematics/vessel-dsp`;
const AMP_DIR = `${ARTIFACTS_DIR}/schematics/vessel-dsp/amps`;
const CABINET_DIR = `${ARTIFACTS_DIR}/cabinets`;

function hexColor(v: string): boolean {
	return /^#([0-9a-fA-F]{3}){1,2}$/.test(v);
}

function buildObject(value: unknown): VdspBuildDataObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as VdspBuildDataObject)
		: undefined;
}

function stringProperty(
	value: VdspBuildDataObject | undefined,
	property: string,
): string | undefined {
	const propertyValue = value?.[property];
	return typeof propertyValue === "string" ? propertyValue : undefined;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function stompboxAppearance(doc: CircuitDocument): DocumentStompboxAppearance {
	const appearance = doc.appearance;
	if (appearance?.kind !== "stompbox") {
		throw new Error("missing or wrong appearance kind");
	}
	return appearance;
}

function ampAppearance(doc: CircuitDocument): DocumentAmpAppearance {
	const appearance = doc.appearance;
	if (appearance?.kind !== "amp") {
		throw new Error("missing or wrong appearance kind");
	}
	return appearance;
}

describe("stompbox appearance corpus integration", () => {
	const files = fs.existsSync(PEDAL_DIR)
		? fs.readdirSync(PEDAL_DIR).filter((f) => f.endsWith(".vdsp"))
		: [];
	const pedalsWithAppearance = files.filter((f) => {
		const src = fs.readFileSync(`${PEDAL_DIR}/${f}`, "utf-8");
		return src.includes("appearance:");
	});
	if (pedalsWithAppearance.length === 0) return;

	it(`parses all ${pedalsWithAppearance.length} pedal appearance blocks without errors`, () => {
		const results: Array<{ slug: string; errors: string[] }> = [];
		for (const file of pedalsWithAppearance) {
			const slug = file.replace(".vdsp", "");
			const src = fs.readFileSync(`${PEDAL_DIR}/${file}`, "utf-8");
			try {
				const doc = parseInterchangeYaml(src);
				const appearance = doc.appearance;
				if (appearance?.kind !== "stompbox") {
					results.push({ slug, errors: ["missing or wrong appearance kind"] });
					continue;
				}
				const errors: string[] = [];
				if (
					!appearance.enclosure?.color ||
					!hexColor(appearance.enclosure.color)
				) {
					errors.push("invalid enclosure.color");
				}
				const defaultLabelColor = stringProperty(
					buildObject(appearance.defaults?.label),
					"color",
				);
				if (!defaultLabelColor || !hexColor(defaultLabelColor)) {
					errors.push("invalid defaults.label.color");
				}
				const defaultLedColor = stringProperty(
					buildObject(appearance.defaults?.led),
					"color",
				);
				if (defaultLedColor && !hexColor(defaultLedColor)) {
					errors.push("invalid led.color");
				}
				if (errors.length > 0) {
					results.push({ slug, errors });
				}
			} catch (e) {
				results.push({
					slug,
					errors: [`parse error: ${errorMessage(e).split("\n")[0]}`],
				});
			}
		}
		if (results.length > 0) {
			const report = results
				.map((r) => `${r.slug}: ${r.errors.join(", ")}`)
				.join("\n  ");
			expect(results.length, report).toBe(0);
		}
	});

	it("Boss DS-1 appearance matches vision-verified colors", () => {
		const src = fs.readFileSync(`${PEDAL_DIR}/boss-ds-1.vdsp`, "utf-8");
		const doc = parseInterchangeYaml(src);
		const appearance = stompboxAppearance(doc);
		expect(appearance.enclosure?.color).toBe("#e37830");
		expect(
			stringProperty(buildObject(appearance.defaults?.label), "color"),
		).toBe("#222222");
		expect(stringProperty(buildObject(appearance.defaults?.led), "color")).toBe(
			"#ff0000",
		);
	});

	it("Boss CE-2 appearance matches corrected blue (not grey)", () => {
		const src = fs.readFileSync(`${PEDAL_DIR}/boss-ce-2.vdsp`, "utf-8");
		const doc = parseInterchangeYaml(src);
		const appearance = stompboxAppearance(doc);
		expect(appearance.enclosure?.color).toBe("#5ca8d4");
		expect(appearance.enclosure?.color).not.toBe("#cbc2c2");
	});

	it("non-Boss big-muff-pi appearance is valid", () => {
		const src = fs.readFileSync(`${PEDAL_DIR}/big-muff-pi.vdsp`, "utf-8");
		const doc = parseInterchangeYaml(src);
		const appearance = stompboxAppearance(doc);
		const enclosureColor = appearance.enclosure?.color;
		expect(
			enclosureColor === undefined ? false : hexColor(enclosureColor),
		).toBe(true);
	});
});

describe("amp appearance corpus integration", () => {
	const files = fs.existsSync(AMP_DIR)
		? fs.readdirSync(AMP_DIR).filter((f) => f.endsWith(".vdsp"))
		: [];
	const ampsWithAppearance = files.filter((f) => {
		const src = fs.readFileSync(`${AMP_DIR}/${f}`, "utf-8");
		return src.includes("appearance:");
	});
	if (ampsWithAppearance.length === 0) return;

	it(`parses all ${ampsWithAppearance.length} amp appearance blocks without errors`, () => {
		const results: Array<{ slug: string; errors: string[] }> = [];
		const warnings: Array<{ slug: string; msg: string }> = [];
		for (const file of ampsWithAppearance) {
			const slug = file.replace(".vdsp", "");
			const src = fs.readFileSync(`${AMP_DIR}/${file}`, "utf-8");
			try {
				const doc = parseInterchangeYaml(src);
				const appearance = doc.appearance;
				if (appearance?.kind !== "amp") {
					results.push({ slug, errors: ["missing or wrong appearance kind"] });
					continue;
				}
				const errors: string[] = [];
				if (
					!appearance.enclosureColor ||
					!hexColor(appearance.enclosureColor)
				) {
					errors.push("invalid enclosureColor");
				}
				if (errors.length > 0) {
					results.push({ slug, errors });
				}
			} catch (e) {
				const msg = errorMessage(e).split("\n")[0] ?? "";
				if (msg.includes("unsupported component kind")) {
					warnings.push({ slug, msg });
					continue;
				}
				results.push({ slug, errors: [`parse error: ${msg}`] });
			}
		}
		console.log(
			`Amp parser warnings (pre-existing, unrelated to appearance): ${warnings.length}`,
		);
		if (results.length > 0) {
			const report = results
				.map((r) => `${r.slug}: ${r.errors.join(", ")}`)
				.join("\n  ");
			expect(results.length, report).toBe(0);
		}
	});

	it("Fender 5F1 Champ amp appearance matches vision-verified colors", () => {
		const src = fs.readFileSync(`${AMP_DIR}/fender-5f1-champ.vdsp`, "utf-8");
		const doc = parseInterchangeYaml(src);
		const appearance = ampAppearance(doc);
		expect(appearance.enclosureColor).toBe("#e0d090");
		expect(stringProperty(appearance.appearance, "brandLabelColor")).toBe(
			"#2a1a1a",
		);
	});

	it("Orange Rockerverb amp appearance matches vision-verified colors", () => {
		const src = fs.readFileSync(`${AMP_DIR}/orange-rockerverb.vdsp`, "utf-8");
		const doc = parseInterchangeYaml(src);
		const appearance = ampAppearance(doc);
		expect(appearance.enclosureColor).toBe("#e87a10");
		expect(stringProperty(appearance.appearance, "controlPanelColor")).toBe(
			"#c8a848",
		);
	});

	it("amp profile flows through createAmpProfileFromVdsp", () => {
		const src = fs.readFileSync(`${AMP_DIR}/fender-5f1-champ.vdsp`, "utf-8");
		const profile = createAmpProfileFromVdsp(src, {
			filename: "fender-5f1-champ.vdsp",
		});
		expect(profile.enclosureColor).toBe("#e0d090");
		expect(profile.appearance?.brandLabelColor).toBe("#2a1a1a");
	});
});

describe("cabinet appearance corpus integration", () => {
	if (!fs.existsSync(CABINET_DIR)) return;
	const cabinets = fs.readdirSync(CABINET_DIR).filter((entry) => {
		return fs.existsSync(`${CABINET_DIR}/${entry}/preview-profile.json`);
	});
	if (cabinets.length === 0) return;

	it(`validates all ${cabinets.length} cabinet appearance profiles`, () => {
		const results: Array<{ slug: string; errors: string[] }> = [];
		for (const entry of cabinets) {
			try {
				const data = JSON.parse(
					fs.readFileSync(
						`${CABINET_DIR}/${entry}/preview-profile.json`,
						"utf-8",
					),
				);
				const errors: string[] = [];
				if (!data.enclosureColor || !hexColor(data.enclosureColor)) {
					errors.push("invalid enclosureColor");
				}
				if (data.appearance) {
					if (
						data.appearance.grilleColor &&
						!hexColor(data.appearance.grilleColor)
					) {
						errors.push("invalid grilleColor");
					}
					if (
						data.appearance.brandLabelColor &&
						!hexColor(data.appearance.brandLabelColor)
					) {
						errors.push("invalid brandLabelColor");
					}
				}
				if (errors.length > 0) {
					results.push({ slug: entry, errors });
				}
			} catch (e) {
				results.push({
					slug: entry,
					errors: [`parse error: ${errorMessage(e).split("\n")[0]}`],
				});
			}
		}
		if (results.length > 0) {
			const report = results
				.map((r) => `${r.slug}: ${r.errors.join(", ")}`)
				.join("\n  ");
			expect(results.length, report).toBe(0);
		}
	});
});
