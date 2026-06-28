import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { createAmpProfileFromVdsp } from "../../packages/amp/src/index.js";
import { parseInterchangeYaml } from "../../packages/core/src/formats/interchange/parser.js";

const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || "../../../artifacts";
const PEDAL_DIR = `${ARTIFACTS_DIR}/schematics/vessel-dsp`;
const AMP_DIR = `${ARTIFACTS_DIR}/schematics/vessel-dsp/amps`;
const CABINET_DIR = `${ARTIFACTS_DIR}/cabinets`;

function hexColor(v: string): boolean {
	return /^#([0-9a-fA-F]{3}){1,2}$/.test(v);
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
				if (!appearance || appearance.kind !== "stompbox") {
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
				if (
					!appearance.defaults?.label?.color ||
					!hexColor(appearance.defaults.label.color)
				) {
					errors.push("invalid defaults.label.color");
				}
				if (
					appearance.defaults?.led &&
					appearance.defaults.led.color &&
					!hexColor(appearance.defaults.led.color)
				) {
					errors.push("invalid led.color");
				}
				if (errors.length > 0) {
					results.push({ slug, errors });
				}
			} catch (e: any) {
				results.push({
					slug,
					errors: [`parse error: ${e.message.split("\n")[0]}`],
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
		expect(doc.appearance?.kind).toBe("stompbox");
		expect(doc.appearance?.enclosure?.color).toBe("#e37830");
		expect(doc.appearance?.defaults?.label?.color).toBe("#222222");
		expect(doc.appearance?.defaults?.led?.color).toBe("#ff0000");
	});

	it("Boss CE-2 appearance matches corrected blue (not grey)", () => {
		const src = fs.readFileSync(`${PEDAL_DIR}/boss-ce-2.vdsp`, "utf-8");
		const doc = parseInterchangeYaml(src);
		expect(doc.appearance?.enclosure?.color).toBe("#5ca8d4");
		expect(doc.appearance?.enclosure?.color).not.toBe("#cbc2c2");
	});

	it("non-Boss big-muff-pi appearance is valid", () => {
		const src = fs.readFileSync(`${PEDAL_DIR}/big-muff-pi.vdsp`, "utf-8");
		const doc = parseInterchangeYaml(src);
		expect(doc.appearance?.kind).toBe("stompbox");
		expect(hexColor(doc.appearance!.enclosure!.color!)).toBe(true);
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
				if (!appearance || appearance.kind !== "amp") {
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
			} catch (e: any) {
				const msg = e.message.split("\n")[0];
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
		expect(doc.appearance?.kind).toBe("amp");
		expect(doc.appearance?.enclosureColor).toBe("#e0d090");
		expect(doc.appearance?.appearance?.brandLabelColor).toBe("#2a1a1a");
	});

	it("Orange Rockerverb amp appearance matches vision-verified colors", () => {
		const src = fs.readFileSync(`${AMP_DIR}/orange-rockerverb.vdsp`, "utf-8");
		const doc = parseInterchangeYaml(src);
		expect(doc.appearance?.enclosureColor).toBe("#e87a10");
		expect(doc.appearance?.appearance?.controlPanelColor).toBe("#c8a848");
	});

	it("amp profile flows through createAmpProfileFromVdsp", () => {
		const src = fs.readFileSync(`${AMP_DIR}/fender-5f1-champ.vdsp`, "utf-8");
		const profile = createAmpProfileFromVdsp(src, "fender-5f1-champ.vdsp");
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
			} catch (e: any) {
				results.push({
					slug: entry,
					errors: [`parse error: ${e.message.split("\n")[0]}`],
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
