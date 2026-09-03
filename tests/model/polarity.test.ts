import { describe, expect, it } from "bun:test";
import {
	DEVICE_POLARITIES,
	classifyPolarity,
	collectPolarityIssues,
} from "../../packages/core/src/model/polarity";
import type { Component } from "../../packages/core/src/model/types";

const dev = (kind: string, properties: Record<string, unknown>): Component =>
	({
		id: "Q1",
		kind,
		name: "Q1",
		origin: { x: 0, y: 0 },
		rotation: 0,
		flipped: false,
		terminals: [],
		properties,
		sourceTypeName: null,
	}) as Component;

describe("device polarity", () => {
	it("accepts each polarity on the kinds that can have it", () => {
		expect(classifyPolarity("bjt", "NPN")).toEqual({ status: "canonical", polarity: "npn" });
		expect(classifyPolarity("bjt", "pnp")).toEqual({ status: "canonical", polarity: "pnp" });
		expect(classifyPolarity("jfet", "N-channel")).toEqual({
			status: "canonical",
			polarity: "n-channel",
		});
		expect(classifyPolarity("mosfet", "p-channel")).toEqual({
			status: "canonical",
			polarity: "p-channel",
		});
		expect(DEVICE_POLARITIES).toHaveLength(4);
	});

	it("keeps the bipolar and field-effect pairs apart", () => {
		// An `npn` MOSFET is not a document predating a vocabulary; it is a claim that cannot be
		// true, so it is the one error rather than a warning.
		expect(classifyPolarity("mosfet", "npn")).toEqual({
			status: "wrong-kind",
			polarity: "npn",
		});
		expect(classifyPolarity("bjt", "n-channel")).toEqual({
			status: "wrong-kind",
			polarity: "n-channel",
		});
		expect(collectPolarityIssues(dev("mosfet", { Polarity: "npn" }))[0]).toMatchObject({
			code: "polarity-wrong-kind",
			severity: "error",
		});
	});

	it("folds case, separators, CamelCase and stray YAML quotes", () => {
		// `'N-channel'` with surviving quote characters appears in the corpus; quotes are an
		// artifact, not a different value.
		expect(classifyPolarity("jfet", "'N-CHANNEL'")).toEqual({
			status: "canonical",
			polarity: "n-channel",
		});
		expect(classifyPolarity("mosfet", "PChannel")).toEqual({
			status: "canonical",
			polarity: "p-channel",
		});
	});

	it("refuses an abbreviation or a kind restatement", () => {
		// One spelling per fact, decided once -- the same rule the taper vocabulary applies to `A`.
		for (const value of ["N", "NJF", "N-channel JFET", "P"]) {
			expect(classifyPolarity("jfet", value).status).toBe("unrecognized");
		}
	});

	it("separates the other facts that share these keys", () => {
		// A dielectric, a barrel-jack sleeve, and a diode family are each a different question.
		expect(classifyPolarity("capacitor", "electrolytic").status).toBe("not-a-polarity");
		expect(classifyPolarity("voltage-source", "center-negative").status).toBe("not-a-polarity");
		expect(classifyPolarity("diode", "Zener").status).toBe("not-a-polarity");
	});

	it("reports a polarity carried under the superseded key", () => {
		const issues = collectPolarityIssues(dev("bjt", { Type: "NPN" }));
		expect(issues.map((i) => i.code)).toEqual(["polarity-property-superseded"]);
	});

	it("does not call `Type` superseded when it carries a different fact", () => {
		// `Type: Zener` on a diode is a device family, not a misplaced polarity -- and a diode has
		// no carrier polarity at all, so nothing is reported.
		expect(collectPolarityIssues(dev("diode", { Type: "Zener" }))).toEqual([]);
	});

	it("warns when nothing at all determines the polarity", () => {
		// Its transfer curve depends on it, so silence forces the consumer to guess -- measured
		// downstream as 37 FETs whose channel does not resolve.
		expect(collectPolarityIssues(dev("jfet", {}))[0]?.code).toBe("polarity-missing");
		// A kind with no carrier polarity is not nagged.
		expect(collectPolarityIssues(dev("resistor", {}))).toEqual([]);
	});

	it("stays quiet when a declared part identifies the polarity", () => {
		// A 2N3904 is NPN and a 2N3906 is PNP. Core holds no part catalog and cannot check which,
		// but a consumer that does is not guessing -- and warning here would make the check noise
		// on every properly identified transistor.
		expect(collectPolarityIssues(dev("bjt", { Model: "2N3904" }))).toEqual([]);
		expect(collectPolarityIssues(dev("bjt", { PartNumber: "2N3906" }))).toEqual([]);
		// An empty part number identifies nothing.
		expect(collectPolarityIssues(dev("bjt", { PartNumber: "" }))[0]?.code).toBe(
			"polarity-missing",
		);
	});

	it("says nothing about a canonical declaration", () => {
		expect(collectPolarityIssues(dev("bjt", { Polarity: "npn" }))).toEqual([]);
	});
});
