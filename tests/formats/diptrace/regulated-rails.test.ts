import { describe, expect, test } from "bun:test";
import { convertDipTrace } from "../../../packages/core/src/formats/diptrace/convert";
import type {
	DipTraceModel,
	DipTraceNet,
	DipTracePart,
} from "../../../packages/core/src/formats/diptrace/parser";
import {
	SYN_CONNECTOR_SECTION,
	SYN_GROUND_SECTION,
	syntheticNet,
	syntheticPart,
	syntheticSection,
} from "./merge-fixtures";

// --- Rail NetPort on a regulator output net ----------------------------------
//
// A supply-symbol NetPort whose terminal shares a net with a regulator's OUT
// terminal is downstream of the regulator: it must not assert the board
// supply. It becomes an annotation port with a rail-port-on-regulator-output
// diagnostic. Rail ports on the regulator's INPUT net, or on nets with no
// regulator output, stay rails. The rule reads connectivity only: the exact
// GND/IN/OUT pin-name tuple, the OUT pin's net, and whole-value supply-symbol
// membership. No net names, port labels, values or part numbers participate.

const REG_SECTION = syntheticSection("SYN-REG", "0", "78L05", [
	"GND",
	"IN",
	"OUT",
]);

function railSymbolSection(symbol: string) {
	return syntheticSection(`SYN-RAIL-${symbol}`, "0", symbol, ["1"]);
}

const MISC_SECTION = syntheticSection("SYN-MISC", "0", "MISC", ["1"]);

function netsOf(parts: DipTracePart[]): DipTraceNet[] {
	const membersByNet = new Map<string, Array<readonly [string, string]>>();
	for (const part of parts) {
		for (const pin of part.pins) {
			if (pin.netId === null) {
				continue;
			}
			const list = membersByNet.get(pin.netId) ?? [];
			list.push([part.id, pin.pinId] as const);
			membersByNet.set(pin.netId, list);
		}
	}
	return [...membersByNet].map(([id, members]) => syntheticNet(id, members));
}

function audioParts(
	library: Parameters<typeof syntheticPart>[0],
): DipTracePart[] {
	return [
		syntheticPart(library, "c-in", "SYN-CNCT", "0", "Connector1", "IN", [
			"nAudioIn",
		]),
		syntheticPart(library, "c-out", "SYN-CNCT", "0", "Connector2", "OUT", [
			"nAudioOut",
		]),
		syntheticPart(library, "gnd", "SYN-GND", "0", "NetPort9", "", ["nGND"]),
	];
}

/** Regulator U1 (GND on nGND, IN on nIN, OUT on nOUT) plus audio/ground. */
function regulatorParts(
	library: Parameters<typeof syntheticPart>[0],
): DipTracePart[] {
	return [
		syntheticPart(library, "u1", "SYN-REG", "0", "U1", "78L05", [
			"nGND",
			"nIN",
			"nOUT",
		]),
		...audioParts(library),
	];
}

function railNetPort(
	library: Parameters<typeof syntheticPart>[0],
	id: string,
	refDes: string,
	style: string,
	net: string,
	name = "",
): DipTracePart {
	return syntheticPart(library, id, style, "0", refDes, "", [net], name);
}

describe("diptrace regulated-rail NetPorts", () => {
	test("a supply-symbol NetPort on the regulator OUT net becomes an annotation port", () => {
		const vb = railSymbolSection("VB");
		const vc = railSymbolSection("VC");
		const library = [REG_SECTION, vb, vc, SYN_CONNECTOR_SECTION, SYN_GROUND_SECTION];
		const parts: DipTracePart[] = [
			...regulatorParts(library),
			railNetPort(library, "p-out", "NetPort1", "SYN-RAIL-VB", "nOUT"),
			railNetPort(library, "p-in", "NetPort2", "SYN-RAIL-VC", "nIN"),
		];
		const model: DipTraceModel = {
			sourceType: "DipTrace-Schematic",
			version: "1",
			units: "mm",
			library,
			parts,
			nets: netsOf(parts),
		};
		const converted = convertDipTrace(model, { name: "regulated" });
		expect(converted.refusal).toBeNull();
		const byId = new Map(
			(converted.document?.components ?? []).map((component) => [
				component.id,
				component,
			]),
		);
		// Positive: the OUT-net port is an annotation port with no Voltage.
		const outPort = byId.get("NetPort1");
		expect(outPort?.kind).toBe("port");
		expect(outPort?.sourceTypeName).toBe("Circuit.Port");
		expect(outPort?.properties.Voltage).toBeUndefined();
		const diagnostic = converted.diagnostics.find(
			(diagnostic) => diagnostic.code === "rail-port-on-regulator-output",
		);
		expect(diagnostic?.componentId).toBe("NetPort1");
		expect(diagnostic?.message).toContain("U1");
		// Negative: the IN-net port stays a rail with the declared supply.
		const inRail = byId.get("NetPort2");
		expect(inRail?.kind).toBe("rail");
		expect(inRail?.sourceTypeName).toBe("Circuit.Rail");
		expect(inRail?.properties.Voltage).toEqual({
			raw: "9 V",
			value: 9,
			unit: "V",
		});
		// The converted port leaves railCount: only the IN-net rail is declared.
		const supply = converted.diagnostics.find(
			(diagnostic) => diagnostic.code === "supply-assumed",
		);
		expect(supply?.message).toContain("on 1 rail component");
		// The regulator itself is untouched.
		expect(byId.get("U1")?.kind).toBe("regulator");
	});

	test("without a regulator the same supply symbols stay rails", () => {
		const vb = railSymbolSection("VB");
		const vc = railSymbolSection("VC");
		const library = [vb, vc, SYN_CONNECTOR_SECTION, SYN_GROUND_SECTION];
		const parts: DipTracePart[] = [
			...audioParts(library),
			railNetPort(library, "p-out", "NetPort1", "SYN-RAIL-VB", "nOUT"),
			railNetPort(library, "p-in", "NetPort2", "SYN-RAIL-VC", "nIN"),
		];
		const model: DipTraceModel = {
			sourceType: "DipTrace-Schematic",
			version: "1",
			units: "mm",
			library,
			parts,
			nets: netsOf(parts),
		};
		const converted = convertDipTrace(model, { name: "unregulated" });
		expect(converted.refusal).toBeNull();
		const byId = new Map(
			(converted.document?.components ?? []).map((component) => [
				component.id,
				component,
			]),
		);
		expect(byId.get("NetPort1")?.kind).toBe("rail");
		expect(byId.get("NetPort2")?.kind).toBe("rail");
		expect(
			converted.diagnostics.some(
				(diagnostic) => diagnostic.code === "rail-port-on-regulator-output",
			),
		).toBe(false);
	});

	test("a regulator whose OUT net has no NetPort changes nothing", () => {
		const vc = railSymbolSection("VC");
		const library = [REG_SECTION, vc, SYN_CONNECTOR_SECTION, SYN_GROUND_SECTION];
		const parts: DipTracePart[] = [
			...regulatorParts(library),
			railNetPort(library, "p-in", "NetPort2", "SYN-RAIL-VC", "nIN"),
		];
		const model: DipTraceModel = {
			sourceType: "DipTrace-Schematic",
			version: "1",
			units: "mm",
			library,
			parts,
			nets: netsOf(parts),
		};
		const converted = convertDipTrace(model, { name: "regulator-no-port" });
		expect(converted.refusal).toBeNull();
		const byId = new Map(
			(converted.document?.components ?? []).map((component) => [
				component.id,
				component,
			]),
		);
		expect(byId.get("U1")?.kind).toBe("regulator");
		expect(byId.get("NetPort2")?.kind).toBe("rail");
		expect(
			converted.diagnostics.some(
				(diagnostic) => diagnostic.code === "rail-port-on-regulator-output",
			),
		).toBe(false);
	});

	test("the verdict follows connectivity, not the supply symbol or label", () => {
		for (const symbol of ["VB", "VC", "9V", "PWR"]) {
			const section = railSymbolSection(symbol);
			const library = [
				REG_SECTION,
				section,
				SYN_CONNECTOR_SECTION,
				SYN_GROUND_SECTION,
			];
			const parts: DipTracePart[] = [
				...regulatorParts(library),
				// The port's own label stays fixed while the library symbol moves.
				railNetPort(library, "p-out", "NetPort1", `SYN-RAIL-${symbol}`, "nOUT", "VC"),
			];
			const model: DipTraceModel = {
				sourceType: "DipTrace-Schematic",
				version: "1",
				units: "mm",
				library,
				parts,
				nets: netsOf(parts),
			};
			const converted = convertDipTrace(model, { name: `symbol-${symbol}` });
			expect(converted.refusal).toBeNull();
			const port = converted.document?.components.find(
				(component) => component.id === "NetPort1",
			);
			expect(port?.kind).toBe("port");
			expect(port?.properties.Voltage).toBeUndefined();
			expect(
				converted.diagnostics.some(
					(diagnostic) =>
						diagnostic.code === "rail-port-on-regulator-output" &&
						diagnostic.componentId === "NetPort1",
				),
			).toBe(true);
		}
		// The same PWR-labelled port moved from the OUT net to the IN net flips
		// back to a rail: moving the wire moves the verdict.
		const library = [
			REG_SECTION,
			MISC_SECTION,
			SYN_CONNECTOR_SECTION,
			SYN_GROUND_SECTION,
		];
		const movedParts: DipTracePart[] = [
			...regulatorParts(library),
			railNetPort(library, "p-moved", "NetPort1", "SYN-MISC", "nIN", "PWR"),
		];
		const moved = convertDipTrace(
			{
				sourceType: "DipTrace-Schematic",
				version: "1",
				units: "mm",
				library,
				parts: movedParts,
				nets: netsOf(movedParts),
			},
			{ name: "moved-to-input" },
		);
		expect(moved.refusal).toBeNull();
		const rail = moved.document?.components.find(
			(component) => component.id === "NetPort1",
		);
		expect(rail?.kind).toBe("rail");
		expect(rail?.properties.Voltage).toEqual({
			raw: "9 V",
			value: 9,
			unit: "V",
		});
		// And the PWR label on the OUT net converts through the label branch.
		const outParts: DipTracePart[] = [
			...regulatorParts(library),
			railNetPort(library, "p-out", "NetPort1", "SYN-MISC", "nOUT", "PWR"),
		];
		const onOutput = convertDipTrace(
			{
				sourceType: "DipTrace-Schematic",
				version: "1",
				units: "mm",
				library,
				parts: outParts,
				nets: netsOf(outParts),
			},
			{ name: "pwr-label-on-output" },
		);
		expect(onOutput.refusal).toBeNull();
		expect(
			onOutput.document?.components.find(
				(component) => component.id === "NetPort1",
			)?.kind,
		).toBe("port");
	});

	test("a PWR connector on the regulator OUT net becomes an annotation port", () => {
		const library = [
			REG_SECTION,
			SYN_CONNECTOR_SECTION,
			SYN_GROUND_SECTION,
		];
		const parts: DipTracePart[] = [
			...regulatorParts(library),
			syntheticPart(library, "pwr", "SYN-CNCT", "0", "Connector3", "PWR", [
				"nOUT",
			]),
		];
		const model: DipTraceModel = {
			sourceType: "DipTrace-Schematic",
			version: "1",
			units: "mm",
			library,
			parts,
			nets: netsOf(parts),
		};
		const converted = convertDipTrace(model, { name: "pwr-connector" });
		expect(converted.refusal).toBeNull();
		const port = converted.document?.components.find(
			(component) => component.id === "Connector3",
		);
		expect(port?.kind).toBe("port");
		expect(port?.properties.Voltage).toBeUndefined();
		expect(
			converted.diagnostics.some(
				(diagnostic) =>
					diagnostic.code === "rail-port-on-regulator-output" &&
					diagnostic.componentId === "Connector3",
			),
		).toBe(true);
	});
});
