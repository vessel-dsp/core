import { describe, expect, test } from "bun:test";
import {
	compile,
	emit,
	readNetlist,
	type PartRegistry,
} from "../../packages/compiler/src/index";
import {
	parseInterchangeYaml,
	serializeInterchangeYaml,
} from "../../packages/core/src/index";

/**
 * Stage 2: explicit `DeviceOverride` block. A `.vdsp` names the part; the registry holds its
 * parameters; this block states measured replacements or the full set for an unknown part.
 *
 * These tests build a minimal NPN stage (jack in -> cap -> base, resistive collector load,
 * cap -> jack out, 9 V battery) plus a two-terminal diode variant, all inline so nothing
 * depends on the artifacts corpus. The doc compiles `ok` with an empty registry, so any
 * `unsupported` outcome below is the override validation under test, never the topology.
 */

const DIY_BJT_REGISTRY: PartRegistry = {
	entries: [
		{
			partIds: ["2N3904"],
			declaredTypes: [],
			terminalRoleGroups: [],
			model: {
				kind: "law",
				law: {
					kind: "bjt",
					polarity: "npn",
					saturationCurrent: 1e-14,
					forwardBeta: 100,
					reverseBeta: 1,
					thermalVoltage: 0.025852,
					leakageAmps: 0,
				},
			},
		},
	],
};

function threeTerminalDoc(
	kind: string,
	roles: readonly [string, string, string],
	names: readonly [string, string, string],
	propsYaml: string,
): string {
	return `schema: circuit-interchange/v3
metadata:
  name: "Override mini stage"
  description: ""
  partNumber: ""
source:
  format: vdsp
components:
  - id: JIN
    kind: jack
    name: JIN
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 1
        position:
          x: -200
          y: -10
      - name: cathode
        node: 0
        position:
          x: -200
          y: 10
    properties:
      Role: input
  - id: JOUT
    kind: jack
    name: JOUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 5
        position:
          x: 200
          y: -10
      - name: cathode
        node: 0
        position:
          x: 200
          y: 10
    properties:
      Role: output
  - id: GND1
    kind: ground
    name: GND1
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: terminal
        node: 0
        position:
          x: 0
          y: -100
    properties: {}
  - id: B1
    kind: battery
    name: B1
    sourceTypeName: Circuit.Battery
    origin:
      x: 100
      y: 100
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 4
        position:
          x: 100
          y: 90
      - name: cathode
        node: 0
        position:
          x: 100
          y: 110
    properties:
      Voltage:
        raw: "9 V"
        value: 9
        unit: V
  - id: RB
    kind: resistor
    name: RB
    sourceTypeName: Circuit.Resistor
    origin:
      x: -20
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 4
        position:
          x: -20
          y: 50
      - name: cathode
        node: 2
        position:
          x: -20
          y: 70
    properties:
      Resistance: "470k"
  - id: RC
    kind: resistor
    name: RC
    sourceTypeName: Circuit.Resistor
    origin:
      x: 60
      y: 60
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 4
        position:
          x: 60
          y: 50
      - name: cathode
        node: 3
        position:
          x: 60
          y: 70
    properties:
      Resistance: "10k"
  - id: CIN
    kind: capacitor
    name: CIN
    sourceTypeName: Circuit.Capacitor
    origin:
      x: -80
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 2
        position:
          x: -70
          y: 0
      - name: cathode
        node: 1
        position:
          x: -90
          y: 0
    properties:
      Capacitance: "47n"
  - id: COUT
    kind: capacitor
    name: COUT
    sourceTypeName: Circuit.Capacitor
    origin:
      x: 140
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: anode
        node: 3
        position:
          x: 130
          y: 0
      - name: cathode
        node: 5
        position:
          x: 150
          y: 0
    properties:
      Capacitance: "47n"
  - id: Q1
    kind: ${kind}
    name: Q1
    sourceTypeName: Circuit.BipolarJunctionTransistor
    origin:
      x: 20
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: ${names[0]}
        role: ${roles[0]}
        node: 3
        position:
          x: 30
          y: -10
      - name: ${names[1]}
        role: ${roles[1]}
        node: 2
        position:
          x: 10
          y: 0
      - name: ${names[2]}
        role: ${roles[2]}
        node: 0
        position:
          x: 30
          y: 10
    properties:
${propsYaml}
nodes:
  - id: 0
    role: ground
    members:
      - componentId: JIN
        terminalName: cathode
      - componentId: JOUT
        terminalName: cathode
      - componentId: GND1
        terminalName: terminal
      - componentId: B1
        terminalName: cathode
      - componentId: Q1
        terminalName: ${names[2]}
  - id: 1
    role: signal
    members:
      - componentId: JIN
        terminalName: anode
      - componentId: CIN
        terminalName: cathode
  - id: 2
    role: signal
    members:
      - componentId: CIN
        terminalName: anode
      - componentId: RB
        terminalName: cathode
      - componentId: Q1
        terminalName: ${names[1]}
  - id: 3
    role: signal
    members:
      - componentId: Q1
        terminalName: ${names[0]}
      - componentId: RC
        terminalName: cathode
      - componentId: COUT
        terminalName: anode
  - id: 4
    role: signal
    members:
      - componentId: B1
        terminalName: anode
      - componentId: RB
        terminalName: anode
      - componentId: RC
        terminalName: anode
  - id: 5
    role: signal
    members:
      - componentId: COUT
        terminalName: cathode
      - componentId: JOUT
        terminalName: anode
`;
}

const BJT_ROLES = ["collector", "base", "emitter"] as const;
const BJT_NAMES = ["collector", "base", "emitter"] as const;

function bjtDoc(propsYaml: string): string {
	return threeTerminalDoc("bjt", BJT_ROLES, BJT_NAMES, propsYaml);
}

const MEASURED_OVERRIDE = `      PartNumber: "2N3904"
      DeviceOverride:
        kind: measured
        source: "owner bench, DMM at 25C"
        method: "bench DMM, Vbe at 1 mA"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: 5e-14
          - name: forwardBeta
            value: 150
`;

function unsupportedReason(source: string): string {
	const result = compile(source, { registry: DIY_BJT_REGISTRY });
	expect(result.status).toBe("unsupported");
	if (result.status !== "unsupported") throw new Error("unreachable");
	expect(result.reasons.length).toBeGreaterThan(0);
	expect(result.reasons[0]?.stage).toBe("netlist");
	return result.reasons[0]?.reason ?? "";
}

describe("DeviceOverride", () => {
	test("mini stage compiles ok with no override", () => {
		const result = compile(bjtDoc('      PartNumber: "2N3904"\n'), {
			registry: DIY_BJT_REGISTRY,
		});
		expect(result.status).toBe("ok");
	});

	test("measured override over a known part applies and is reported", () => {
		const result = compile(bjtDoc(MEASURED_OVERRIDE), {
			registry: DIY_BJT_REGISTRY,
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		const applied = result.warnings.filter(
			(w) => w.code === "registry-override-applied",
		);
		expect(applied.length).toBe(1);
		const notice = applied[0];
		expect(notice).toMatchObject({
			code: "registry-override-applied",
			device: "Q1",
			partNumber: "2N3904",
		});
		if (notice?.code !== "registry-override-applied") return;
		expect(notice.items).toEqual([
			{ parameter: "saturationCurrent", overrideValue: 5e-14, registryValue: 1e-14 },
			{ parameter: "forwardBeta", overrideValue: 150, registryValue: 100 },
		]);
		expect(notice.provenance).toMatchObject({
			kind: "measured",
			by: "Override Tests",
			date: "2026-10-19",
		});
		// The override moves the program: same doc without it digests differently.
		const baseline = compile(bjtDoc('      PartNumber: "2N3904"\n'), {
			registry: DIY_BJT_REGISTRY,
		});
		expect(baseline.status).toBe("ok");
		if (baseline.status !== "ok") return;
		expect(emit(result.program).digest).not.toBe(emit(baseline.program).digest);
	});

	test("override equal to legacy values leaves the digest identical", () => {
		const legacy = bjtDoc(
			'      PartNumber: "2N3904"\n      IS: "5e-14"\n      BF: "150"\n',
		);
		const withOverride = bjtDoc(
			'      PartNumber: "2N3904"\n      IS: "5e-14"\n      BF: "150"\n' +
				MEASURED_OVERRIDE.replace('      PartNumber: "2N3904"\n', ""),
		);
		const a = compile(legacy, { registry: DIY_BJT_REGISTRY });
		const b = compile(withOverride, { registry: DIY_BJT_REGISTRY });
		expect(a.status).toBe("ok");
		expect(b.status).toBe("ok");
		if (a.status !== "ok" || b.status !== "ok") return;
		// Legacy BF 150 vs override forwardBeta 150: same engine value, same program.
		expect(emit(a.program).digest).toBe(emit(b.program).digest);
	});

	test("override wins over the legacy typed key", () => {
		const legacyOnly = bjtDoc('      PartNumber: "2N3904"\n      BF: "50"\n');
		const overridden = bjtDoc(
			'      PartNumber: "2N3904"\n      BF: "50"\n' +
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: forwardBeta
            value: 200
`,
		);
		const equivalent = bjtDoc('      PartNumber: "2N3904"\n      BF: "200"\n');
		const rOverridden = compile(overridden, { registry: DIY_BJT_REGISTRY });
		const rEquivalent = compile(equivalent, { registry: DIY_BJT_REGISTRY });
		const rLegacy = compile(legacyOnly, { registry: DIY_BJT_REGISTRY });
		expect(rOverridden.status).toBe("ok");
		expect(rEquivalent.status).toBe("ok");
		expect(rLegacy.status).toBe("ok");
		if (
			rOverridden.status !== "ok" ||
			rEquivalent.status !== "ok" ||
			rLegacy.status !== "ok"
		)
			return;
		expect(emit(rOverridden.program).digest).toBe(
			emit(rEquivalent.program).digest,
		);
		expect(emit(rOverridden.program).digest).not.toBe(
			emit(rLegacy.program).digest,
		);
		if (rOverridden.status === "ok") {
			const legacy = rOverridden.warnings.find(
				(w) => w.code === "legacy-device-parameter",
			);
			expect(legacy).toMatchObject({
				device: "Q1",
				keys: ["BF"],
				overridden: ["BF"],
			});
		}
	});

	test("custom override on an unknown part compiles and reports no registry entry", () => {
		const source = bjtDoc(
			`      PartNumber: "ZZZ9X"
      DeviceOverride:
        kind: custom
        source: "vendor datasheet XYZ p2"
        method: "registry lacks the part; values from the vendor sheet"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: 2e-14
          - name: forwardBeta
            value: 300
`,
		);
		const result = compile(source, { registry: DIY_BJT_REGISTRY });
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		const applied = result.warnings.filter(
			(w) => w.code === "registry-override-applied",
		);
		expect(applied.length).toBe(1);
		if (applied[0]?.code !== "registry-override-applied") return;
		expect(applied[0].items).toEqual([
			{ parameter: "saturationCurrent", overrideValue: 2e-14, registryValue: null },
			{ parameter: "forwardBeta", overrideValue: 300, registryValue: null },
		]);
		expect(applied[0].detail).toContain("no registry value");
	});

	test("legacy keys with no override warn", () => {
		const result = compile(bjtDoc('      IS: "1e-12"\n'), {
			registry: DIY_BJT_REGISTRY,
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		const legacy = result.warnings.filter(
			(w) => w.code === "legacy-device-parameter",
		);
		expect(legacy.length).toBe(1);
		expect(legacy[0]).toMatchObject({
			device: "Q1",
			keys: ["IS"],
			overridden: [],
		});
	});

	test("no legacy keys and no override warns nothing new", () => {
		const result = compile(bjtDoc('      PartNumber: "2N3904"\n'), {
			registry: DIY_BJT_REGISTRY,
		});
		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(
			result.warnings.filter(
				(w) =>
					w.code === "legacy-device-parameter" ||
					w.code === "registry-override-applied",
			).length,
		).toBe(0);
	});

	test("override survives parse -> serialize -> parse", () => {
		const document = parseInterchangeYaml(bjtDoc(MEASURED_OVERRIDE));
		const reserialized = serializeInterchangeYaml(document);
		const reparsed = parseInterchangeYaml(reserialized);
		const before = document.components.find((c) => c.id === "Q1")?.properties[
			"DeviceOverride"
		];
		const after = reparsed.components.find((c) => c.id === "Q1")?.properties[
			"DeviceOverride"
		];
		expect(before).toBeDefined();
		expect(after).toEqual(before);
		// And the reserialized text still compiles with the same values: node
		// renumbering by the serializer may move the program digest, so compare
		// device parameters and the applied-override notice instead.
		const a = compile(bjtDoc(MEASURED_OVERRIDE), { registry: DIY_BJT_REGISTRY });
		const b = compile(reserialized, { registry: DIY_BJT_REGISTRY });
		expect(a.status).toBe("ok");
		expect(b.status).toBe("ok");
		if (a.status !== "ok" || b.status !== "ok") return;
		const appliedA = a.warnings.filter((w) => w.code === "registry-override-applied");
		const appliedB = b.warnings.filter((w) => w.code === "registry-override-applied");
		expect(appliedB).toEqual(appliedA);
		const netA = readNetlist(bjtDoc(MEASURED_OVERRIDE), { registry: DIY_BJT_REGISTRY });
		const netB = readNetlist(reserialized, { registry: DIY_BJT_REGISTRY });
		expect(netB.devices.find((d) => d.id === "Q1")?.parameters).toEqual(
			netA.devices.find((d) => d.id === "Q1")?.parameters,
		);
	});

	test("readNetlist merges measured values into device parameters", () => {
		const netlist = readNetlist(bjtDoc(MEASURED_OVERRIDE), {
			registry: DIY_BJT_REGISTRY,
		});
		const q1 = netlist.devices.find((d) => d.id === "Q1");
		expect(q1?.parameters.saturationCurrent).toBe(5e-14);
		// forwardBeta maps to the engine field beta.
		expect(q1?.parameters.beta).toBe(150);
		expect(q1?.deviceOverride?.provenance.kind).toBe("measured");
	});

	test("refuses an unknown parameter name for the class", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: Hfe
            value: 100
`,
			),
		);
		expect(reason).toContain('"Hfe" is not a bjt parameter');
	});

	test("refuses custom on a part the registry already has", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      PartNumber: "2N3904"
      DeviceOverride:
        kind: custom
        source: "vendor sheet"
        method: "registry lacks the part"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: 2e-14
          - name: forwardBeta
            value: 300
`,
			),
		);
		expect(reason).toContain('kind "custom" on part "2N3904"');
		expect(reason).toContain("already has");
	});

	test("refuses custom missing a required parameter", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      PartNumber: "ZZZ9X"
      DeviceOverride:
        kind: custom
        source: "vendor sheet"
        method: "registry lacks the part"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: 2e-14
`,
			),
		);
		expect(reason).toContain("missing required parameter(s): forwardBeta");
	});

	test("refuses measured with missing provenance", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        parameters:
          - name: saturationCurrent
            value: 2e-14
`,
			),
		);
		expect(reason).toContain("DeviceOverride.by is missing");
	});

	test("refuses a malformed date", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "19-10-2026"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: 2e-14
`,
			),
		);
		expect(reason).toContain("not an ISO date");
	});

	test("refuses a non-numeric value", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: lots
`,
			),
		);
		expect(reason).toContain("is not a finite SI number");
	});

	test("refuses a non-positive saturation current", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: -1e-14
`,
			),
		);
		expect(reason).toContain("must be");
	});

	test("refuses a duplicate parameter", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: 1e-14
          - name: saturationCurrent
            value: 2e-14
`,
			),
		);
		expect(reason).toContain('parameter "saturationCurrent" is stated twice');
	});

	test("refuses an override on a resistor", () => {
		const source = bjtDoc('      PartNumber: "2N3904"\n').replace(
			'      Resistance: "470k"',
			`      Resistance: "470k"
      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: 1e-14
`,
		);
		const reason = unsupportedReason(source);
		expect(reason).toContain("not supported for resistor devices");
	});

	test("refuses an empty parameter list", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters: []
`,
			),
		);
		expect(reason).toContain("must be a non-empty list");
	});

	test("refuses an unknown kind", () => {
		const reason = unsupportedReason(
			bjtDoc(
				`      DeviceOverride:
        kind: tweaked
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: saturationCurrent
            value: 1e-14
`,
			),
		);
		expect(reason).toContain('is not "measured" or "custom"');
	});

	test("routes the override class per device kind", () => {
		// A BJT gain name is unknown on a JFET.
		const jfet = threeTerminalDoc(
			"jfet",
			["drain", "gate", "source"],
			["drain", "gate", "source"],
			`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: forwardBeta
            value: 100
`,
		);
		const netlist = readNetlist(
			threeTerminalDoc(
				"jfet",
				["drain", "gate", "source"],
				["drain", "gate", "source"],
				`      DeviceOverride:
        kind: measured
        source: "bench"
        method: "DMM"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
          - name: thresholdVolts
            value: -1.5
          - name: transconductance
            value: 0.002
`,
			),
			{},
		);
		expect(
			netlist.devices.find((d) => d.id === "Q1")?.parameters.thresholdVolts,
		).toBe(-1.5);
		const result = compile(jfet, { registry: DIY_BJT_REGISTRY });
		expect(result.status).toBe("unsupported");
		if (result.status !== "unsupported") return;
		expect(result.reasons[0]?.reason).toContain(
			'"forwardBeta" is not a jfet parameter',
		);
	});

	test("custom zener requires breakdownVolts", () => {
		const base = (params: string): string =>
			threeTerminalDoc(
				"diode",
				["anode", "cathode", "end"],
				["anode", "cathode", "extra"],
				`      Type: Zener
      PartNumber: "ZZZ9V1"
      DeviceOverride:
        kind: custom
        source: "vendor sheet"
        method: "registry lacks the part"
        date: "2026-10-19"
        by: "Override Tests"
        parameters:
${params}
`,
			);
		const missing = compile(
			base(`          - name: saturationCurrent
            value: 1e-12
          - name: emissionCoefficient
            value: 1.9
`),
			{ registry: DIY_BJT_REGISTRY },
		);
		expect(missing.status).toBe("unsupported");
		if (missing.status !== "unsupported") return;
		expect(missing.reasons[0]?.reason).toContain(
			"missing required parameter(s): breakdownVolts",
		);
	});
});
