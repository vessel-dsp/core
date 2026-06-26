import { describe, expect, test } from "bun:test";
import { parseSchx } from "../../../packages/core/src/formats/schx/parser";
import { serializeSchx } from "../../../packages/core/src/formats/schx/serializer";
import { resolveConnectivity } from "../../../packages/core/src/model/connectivity";
import { toNetlistView } from "../../../packages/core/src/model/netlist";

const FIXTURES: readonly string[] = [
	"passive-divider",
	"passive-lowpass",
	"lpb-1-style-boost",
	"fulltone-ocd",
	"tc-electronic-dark-matter",
	"spdt-bypass-pedal",
	"3pdt-true-bypass-pedal",
];

async function loadFixture(name: string): Promise<string> {
	const url = new URL(`../../fixtures/schx/${name}.schx`, import.meta.url);
	return Bun.file(url).text();
}

describe("schx fixture round-trip", () => {
	for (const name of FIXTURES) {
		test(`${name} parses and re-serializes with stable topology`, async () => {
			const original = await loadFixture(name);
			const first = parseSchx(original);

			expect(first.components.length).toBeGreaterThan(0);
			expect(first.wires.length).toBeGreaterThan(0);

			const reserialized = serializeSchx(first);
			const second = parseSchx(reserialized);

			expect(second.components).toHaveLength(first.components.length);
			expect(second.wires).toHaveLength(first.wires.length);

			for (let i = 0; i < first.components.length; i += 1) {
				const a = first.components[i]!;
				const b = second.components[i]!;
				expect(b.kind).toBe(a.kind);
				expect(b.name).toBe(a.name);
				expect(b.origin).toEqual(a.origin);
				expect(b.rotation).toBe(a.rotation);
				expect(b.flipped).toBe(a.flipped);
				expect(b.terminals.length).toBe(a.terminals.length);
			}

			for (let i = 0; i < first.wires.length; i += 1) {
				const a = first.wires[i]!;
				const b = second.wires[i]!;
				expect(b.endpoints[0]).toEqual(a.endpoints[0]);
				expect(b.endpoints[1]).toEqual(a.endpoints[1]);
			}
		});
	}

	test("passive-lowpass exposes a resistor, a capacitor, and a ground", async () => {
		const xml = await loadFixture("passive-lowpass");
		const doc = parseSchx(xml);
		const kinds = doc.components.map((c) => c.kind);
		expect(kinds).toContain("resistor");
		expect(kinds).toContain("capacitor");
		expect(kinds).toContain("ground");
	});

	test("passive-divider connectivity puts the ground at node 0 and joins the midpoint", async () => {
		const xml = await loadFixture("passive-divider");
		const doc = parseSchx(xml);
		const connectivity = resolveConnectivity(doc);
		expect(connectivity.groundNodeId).toBe(0);
		expect(connectivity.nodeCount).toBeGreaterThanOrEqual(3);
	});

	test("passive-lowpass netlist projection emits at least R and C rows", async () => {
		const xml = await loadFixture("passive-lowpass");
		const doc = parseSchx(xml);
		const view = toNetlistView(doc);
		const letters = view.components.map((c) => c.spiceLetter);
		expect(letters).toContain("R");
		expect(letters).toContain("C");
		expect(view.groundNodeId).toBe(0);
	});

	test("lpb-1-style-boost parses without throwing and produces a netlist view", async () => {
		const xml = await loadFixture("lpb-1-style-boost");
		const doc = parseSchx(xml);
		expect(doc.components.some((c) => c.kind === "bjt")).toBe(true);
		const view = toNetlistView(doc);
		expect(view.components.length).toBeGreaterThan(0);
	});

	test("fulltone-ocd fixture covers the SabroTone revision-3 dual-opamp MOSFET clipping pedal", async () => {
		const xml = await loadFixture("fulltone-ocd");
		const doc = parseSchx(xml);
		const byId = new Map(
			doc.components.map((component) => [component.id, component]),
		);

		expect(doc.metadata.name).toBe("Fulltone OCD revision 3");
		expect(doc.rawAttributes.SourceUrl).toBe(
			"https://www.sabrotone.com/fulltone-ocd-vero-layout/",
		);
		expect(doc.rawAttributes.SecondarySourceUrl).toBe(
			"https://www.analogisnotdead.com/article34/circuit-analysis-fulltone-s-ocd",
		);
		expect(doc.rawAttributes.SourceFaithfulnessRating).toBe("4/5");
		expect(doc.rawAttributes.SourceFaithfulnessNotes).toContain(
			"verified SabroTone layout",
		);
		expect(byId.get("U1A")?.kind).toBe("opamp");
		expect(byId.get("U1A")?.properties.PartNumber).toBe("TL082");
		expect(byId.get("U1B")?.kind).toBe("opamp");
		expect(byId.get("M1")?.kind).toBe("mosfet");
		expect(byId.get("M1")?.properties.PartNumber).toBe("2N7000");
		expect(byId.get("M2")?.kind).toBe("mosfet");
		expect(byId.get("D1")?.kind).toBe("diode");
		expect(byId.get("D1")?.properties.PartNumber).toBe("1N4148");
		expect(byId.get("D2")?.kind).toBe("diode");
		expect(byId.get("D2")?.properties.PartNumber).toBe("1N34A");
		expect(byId.get("R1")?.properties.Resistance).toMatchObject({
			value: 18_000,
			unit: "Ω",
		});
		expect(byId.get("R8")?.properties.Resistance).toMatchObject({
			value: 470_000,
			unit: "Ω",
		});
		expect(byId.get("R10")?.properties.Resistance).toMatchObject({
			value: 33_000,
			unit: "Ω",
		});
		expect(byId.get("R14")?.properties.Resistance).toMatchObject({
			value: 100,
			unit: "Ω",
		});
		expect(byId.get("C1")?.properties.Capacitance).toMatchObject({
			value: 1e-9,
			unit: "F",
		});
		expect(byId.get("C11")?.properties.Capacitance).toMatchObject({
			raw: "10 μF",
			unit: "F",
		});
		expect(byId.get("DRIVE")?.kind).toBe("potentiometer");
		expect(byId.get("DRIVE")?.properties.Resistance).toMatchObject({
			value: 1_000_000,
			unit: "Ω",
		});
		expect(byId.get("DRIVE")?.properties.Sweep).toBe("Logarithmic");
		expect(byId.get("TONE")?.properties.Resistance).toMatchObject({
			value: 10_000,
			unit: "Ω",
		});
		expect(byId.get("TONE")?.properties.Sweep).toBe("Linear");
		expect(byId.get("VOLUME")?.properties.Resistance).toMatchObject({
			value: 500_000,
			unit: "Ω",
		});
		expect(byId.get("VOLUME")?.properties.Sweep).toBe("Linear");
		expect(byId.get("HP_LP")?.kind).toBe("switch");
		expect(doc.warnings).toEqual([]);
	});

	test("tc-electronic-dark-matter fixture covers the source-rated MC33178 distortion pedal", async () => {
		const xml = await loadFixture("tc-electronic-dark-matter");
		const doc = parseSchx(xml);
		const byId = new Map(
			doc.components.map((component) => [component.id, component]),
		);

		expect(doc.metadata.name).toBe("TC Electronic Dark Matter Distortion");
		expect(doc.rawAttributes.SourceUrl).toBe(
			"https://dirtboxlayouts.blogspot.com/2021/06/tc-electronic-dark-matter-distortion.html",
		);
		expect(doc.rawAttributes.ProductImageUrl).toBe(
			"https://cdn11.bigcommerce.com/s-4hc0jwsnnq/images/stencil/original/products/14720/53683/497684-1646299008105__35452.1734366421.jpg?c=1",
		);
		expect(doc.rawAttributes.SourceFaithfulnessRating).toBe("3/5");
		expect(doc.rawAttributes.SourceFaithfulnessNotes).toContain(
			"Dirtbox layout is marked unverified",
		);

		const mc33178Sections = [
			"IC2A",
			"IC2B",
			"IC3A",
			"IC3B",
			"IC4A",
			"IC4B",
		] as const;
		for (const id of mc33178Sections) {
			expect(byId.get(id)?.kind).toBe("opamp");
			expect(byId.get(id)?.properties.PartNumber).toBe("MC33178");
		}
		expect(
			doc.components.filter(
				(component) =>
					component.kind === "opamp" &&
					component.properties.PartNumber === "MC33178",
			),
		).toHaveLength(mc33178Sections.length);

		for (const id of ["D1", "D2", "D3", "D4"]) {
			expect(byId.get(id)?.kind).toBe("diode");
			expect(byId.get(id)?.properties.PartNumber).toBe("LL4148");
		}

		expect(byId.get("D9")?.properties.PartNumber).toBe("MBR0540");
		expect(byId.get("GAIN")?.properties.Resistance).toMatchObject({
			value: 100_000,
			unit: "Ω",
		});
		expect(byId.get("BASS")?.properties.Resistance).toMatchObject({
			value: 50_000,
			unit: "Ω",
		});
		expect(byId.get("TREBLE")?.properties.Resistance).toMatchObject({
			value: 50_000,
			unit: "Ω",
		});
		expect(byId.get("LEVEL")?.properties.Resistance).toMatchObject({
			value: 10_000,
			unit: "Ω",
		});
		expect(byId.get("VOICE")?.sourceTypeName).toContain("Circuit.SPDT");
		expect(byId.get("C1")?.properties.Capacitance).toMatchObject({
			raw: "100 nF",
			unit: "F",
		});
		expect(byId.get("C4")?.properties.Capacitance).toMatchObject({
			raw: "4.7 μF",
			unit: "F",
		});
		expect(byId.get("C29")?.properties.Capacitance).toMatchObject({
			raw: "47 nF",
			unit: "F",
		});
		expect(byId.get("C28")?.properties.Capacitance).toMatchObject({
			raw: "15 nF",
			unit: "F",
		});
		expect(doc.warnings).toEqual([]);
	});
});
