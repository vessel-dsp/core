import { describe, expect, it } from "bun:test";
import {
	collectTerminalRoleWarnings,
	isLegalTerminalRole,
	terminalRolesFor,
} from "../../packages/core/src/model/device-terminal-roles";
import { validateDocument } from "../../packages/core/src/model/validation";
import type { CircuitDocument } from "../../packages/core/src/model/types";
import {
	parseVdspCircuitDocument,
	serializeVdspCircuitDocument,
} from "../../packages/core/src";

const document = (kind: string, role: string): string =>
	`schema: circuit-interchange/v3
metadata:
  name: Thermistor Kind
components:
  - id: RT1
    kind: ${kind}
    name: RT1
    sourceTypeName: Circuit.Thermistor
    origin:
      x: 0
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        role: ${role}
        node: 1
        position:
          x: -10
          y: 0
      - name: b
        role: end
        node: 2
        position:
          x: 10
          y: 0
    properties:
      Resistance: "10k"
      Beta: "3950"
      Name: RT1
nodes:
  - id: 1
    name: IN
  - id: 2
    name: OUT
`;

describe("the thermistor component kind", () => {
	it("declares two polarity-free ends like the resistor it behaves as", () => {
		expect([...terminalRolesFor("thermistor")].sort()).toEqual([
			"end",
			"negative",
			"positive",
		]);
		expect(isLegalTerminalRole("thermistor", "end")).toBe(true);
		// The negative control, and the point of a typed vocabulary: a role that
		// belongs to a different kind is refused rather than carried.
		expect(isLegalTerminalRole("thermistor", "cathode")).toBe(false);
		expect(isLegalTerminalRole("thermistor", "wiper")).toBe(false);
	});

	it("parses, and survives a serialize/parse round trip as a thermistor", () => {
		const parsed = parseVdspCircuitDocument(document("thermistor", "end"));
		expect(parsed.components[0]?.kind).toBe("thermistor");
		const text = serializeVdspCircuitDocument(parsed);
		expect(parseVdspCircuitDocument(text).components[0]?.kind).toBe(
			"thermistor",
		);
	});

	it("keeps Resistance and Beta through the round trip", () => {
		// The interchange parser carries properties as authored text; quantity
		// parsing is the compiler's reader, so the round trip pins the raw form.
		const parsed = parseVdspCircuitDocument(document("thermistor", "end"));
		const properties = parsed.components[0]?.properties as Record<
			string,
			unknown
		>;
		expect(properties["Resistance"]).toBe("10k");
		expect(properties["Beta"]).toBe("3950");
		const text = serializeVdspCircuitDocument(parsed);
		const reparsed = parseVdspCircuitDocument(text);
		const reproperties = reparsed.components[0]?.properties as Record<
			string,
			unknown
		>;
		expect(reproperties["Resistance"]).toBe("10k");
		expect(reproperties["Beta"]).toBe("3950");
	});

	it("still refuses a kind nobody defined", () => {
		// Without this the union is decoration: a typo would arrive as a new kind
		// rather than an error, which is exactly what a closed vocabulary exists
		// to stop.
		expect(() => parseVdspCircuitDocument(document("thermister", "end"))).toThrow(
			/unsupported component kind/,
		);
	});

	it("reports an illegal role on a thermistor rather than accepting it", () => {
		const parsed = parseVdspCircuitDocument(document("thermistor", "cathode"));
		const warnings = collectTerminalRoleWarnings(parsed.components);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]?.code).toBe("terminal-role-illegal");
		expect(warnings[0]?.componentId).toBe("RT1");
	});

	it("requires Resistance and Beta, with ReferenceTemperatureC optional", () => {
		const base = parseVdspCircuitDocument(
			document("thermistor", "end"),
		) as CircuitDocument;
		expect(validateDocument(base)).toEqual([]);

		const withoutBeta = structuredClone(base);
		const betaProperties = withoutBeta.components[0]?.properties as Record<
			string,
			unknown
		>;
		delete betaProperties["Beta"];
		const missing = validateDocument(withoutBeta);
		expect(missing).toHaveLength(1);
		expect(missing[0]?.code).toBe("value-required");
		expect(missing[0]?.property).toBe("Beta");

		const withoutResistance = structuredClone(base);
		const resistanceProperties = withoutResistance.components[0]
			?.properties as Record<string, unknown>;
		delete resistanceProperties["Resistance"];
		const missingResistance = validateDocument(withoutResistance);
		expect(missingResistance).toHaveLength(1);
		expect(missingResistance[0]?.code).toBe("value-required");
		expect(missingResistance[0]?.property).toBe("Resistance");
	});
});
