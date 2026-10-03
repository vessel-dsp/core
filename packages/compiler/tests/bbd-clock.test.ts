import { describe, expect, test } from "bun:test";
import {
	deriveBbdDelayFromNetlist as deriveBbdDelayFromNetlistWithRegistry,
	deriveOpenOx2ClockLaw as deriveOpenOx2ClockLawWithRegistry,
	derivePt2399DelayFromNetlist,
	deriveM50195DelayFromNetlist,
	resolveClockModulationSource as resolveClockModulationSourceWithRegistry,
	pt2399DelayFromOhms,
} from "../src/bbd-clock";
import { attachDeviceLaws } from "../src/device-laws";
import { pedalPartCatalog } from "../src/part-catalog";
import type { PartRegistry } from "../src/registry";
import type { Device, DeviceKind, Netlist, NodeId } from "../src/types";
import { GROUND } from "../src/types";

// The catalog default these two used to carry themselves, moved to the caller.
//
// `bbd-clock.ts` defaulted six `registry` parameters to `pedalPartCatalog`, which made the
// module import the part catalog and quietly broke the compiler's part-free boundary: a
// caller passing nothing — or deliberately passing `emptyRegistry` elsewhere — still got the
// full catalog here. Every production call site already passed a registry, so the default
// only ever served these tests. It belongs here, where "which parts is this test written
// against" is a statement about the test.
const deriveBbdDelayFromNetlist = (
	bbdDevice: Device,
	netlist: Netlist,
	stages: number,
	registry: PartRegistry = pedalPartCatalog,
) => deriveBbdDelayFromNetlistWithRegistry(bbdDevice, netlist, stages, registry);
const resolveClockModulationSource = (
	bbdDevice: Device,
	netlist: Netlist,
	registry: PartRegistry = pedalPartCatalog,
) => resolveClockModulationSourceWithRegistry(bbdDevice, netlist, registry);
const deriveOpenOx2ClockLaw = (
	netlist: Netlist,
	registry: PartRegistry = pedalPartCatalog,
) => deriveOpenOx2ClockLawWithRegistry(netlist, registry);

function makeDevice(
	id: string,
	kind: DeviceKind,
	nodes: readonly number[],
	roles: readonly (string | null)[],
	partNumber: string | null = null,
	declaredType: string | null = null,
	parameters: Record<string, number> = {},
): Device {
	return {
		id,
		kind,
		nodes: nodes as readonly NodeId[],
		control: null,
		identity: { partNumber, declaredType, terminalRoles: roles, declaredTerminalRoles: [], declaredWindings: null },
		parameters,
	};
}

function makeNetlist(devices: readonly Device[]): Netlist {
	const nodes = [...new Set(devices.flatMap((d) => d.nodes))].sort(
		(a, b) => a - b,
	);
	return {
		nodes,
		devices,
		controls: [],
		ports: { input: 1, output: 2 },
		bypass: { declared: "none" },
		portImpedanceOhms: { input: null, output: null },
		portDeclaredFullScaleVolts: { input: null, output: null },
		convergenceOptIn: false,
	};
}

describe("BBD clock derivation", () => {
	test("CD4047 clock driver derives exact delay from timing RC network", () => {
		// TI CD4047B (SCHS044C): pin 1=C (node 1), pin 2=R (node 2), pin 3=RC common (node 3)
		// R = 100kΩ between pin 2 and pin 3
		// C = 100pF between pin 1 and pin 3
		// f_clock = 1 / (4.40 * R * C) = 22727.27 Hz
		// MN3008 (2048 stages): delay = 2048 * 2.20 * 100k * 100pF = 0.045056 s (45.056 ms)
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[1, 2, 3, 0, 0, 0, 0, 0, 0, 14, 11, 0, 0, 13], // 14-pin DIP
			[
				"c",
				"r",
				"rccommon",
				"astable",
				"astablebar",
				"minus_trigger",
				"plus_trigger",
				"vss",
				"reset",
				"q",
				"qbar",
				"oscout",
				"vss2",
				"vdd",
			],
			"CD4047BE",
		);

		const timingR = makeDevice("R_TIME", "resistor", [2, 3], [null, null], null, null, { ohms: 100000 });
		const timingC = makeDevice("C_TIME", "capacitor", [1, 3], [null, null], null, null, { farads: 100e-12 });

		const netlist = makeNetlist([bbdDevice, clockDevice, timingR, timingC]);

		const result = deriveBbdDelayFromNetlist(bbdDevice, netlist, 2048);
		expect(result.outcome).toBe("derived");
		if (result.outcome === "derived") {
			expect(result.family).toBe("CD4047");
			expect(result.rOhms).toBeCloseTo(100000, 5);
			expect(result.cFarads).toBeCloseTo(100e-12, 14);
			expect(result.fClockHz).toBeCloseTo(1 / (4.4 * 100000 * 100e-12), 4);
			expect(result.delaySeconds).toBeCloseTo(0.045056, 6);
		}
	});

	test("Negative control: perturbing timing capacitor by 10x scales derived delay by 10x", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[1, 2, 3, 0, 0, 0, 0, 0, 0, 14, 11, 0, 0, 13],
			[
				"c",
				"r",
				"rccommon",
				"astable",
				"astablebar",
				"minus_trigger",
				"plus_trigger",
				"vss",
				"reset",
				"q",
				"qbar",
				"oscout",
				"vss2",
				"vdd",
			],
			"CD4047BE",
		);

		const timingR = makeDevice("R_TIME", "resistor", [2, 3], [null, null], null, null, { ohms: 100000 });
		const timingC = makeDevice("C_TIME", "capacitor", [1, 3], [null, null], null, null, { farads: 1000e-12 }); // 10x higher

		const netlist = makeNetlist([bbdDevice, clockDevice, timingR, timingC]);

		const result = deriveBbdDelayFromNetlist(bbdDevice, netlist, 2048);
		expect(result.outcome).toBe("derived");
		if (result.outcome === "derived") {
			expect(result.delaySeconds).toBeCloseTo(0.45056, 5);
		}
	});

	test("MN3101 clock driver derives exact delay with parallel capacitors", () => {
		// MN3101 star oscillator: OX2 (pin 6, node 6), OX3 (pin 5, node 5), common node 99
		// R = 150kΩ from OX2 (node 6) to common (node 99)
		// C1 = 47pF, C2 = 5pF in parallel from OX3 (node 5) to common (node 99) -> 52pF total
		// MN3008 (2048 stages): delay = 2048 * 2.50 * 150k * 52pF = 0.039936 s (39.936 ms)
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[13, 10, 0, 11, 12, 6, 7, 5], // 8 pins: VDD=13, CP1=10, GND=0, CP2=11, VGG=12, OX2=6, OX1=7, OX3=5
			["vdd", "cp1", "gnd", "cp2", "vgg", "ox2", "ox1", "ox3"],
			"MN3101",
		);

		const timingR = makeDevice("R31", "resistor", [6, 99], [null, null], null, null, { ohms: 150000 });
		const timingC1 = makeDevice("C21", "capacitor", [5, 99], [null, null], null, null, { farads: 47e-12 });
		const timingC2 = makeDevice("C22", "capacitor", [5, 99], [null, null], null, null, { farads: 5e-12 });

		const netlist = makeNetlist([bbdDevice, clockDevice, timingR, timingC1, timingC2]);

		const result = deriveBbdDelayFromNetlist(bbdDevice, netlist, 2048);
		expect(result.outcome).toBe("derived");
		if (result.outcome === "derived") {
			expect(result.family).toBe("MN3101");
			expect(result.rOhms).toBe(150000);
			expect(result.cFarads).toBeCloseTo(52e-12, 14);
			expect(result.fClockHz).toBeCloseTo(1 / (5.0 * 150000 * 52e-12), 4);
			expect(result.delaySeconds).toBeCloseTo(0.039936, 6);
		}
	});

	test("Refuses collapsed timing network on CD4047", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[30, 30, 30, 0, 0, 0, 0, 0, 0, 14, 11, 0, 0, 13], // pins 1, 2, 3 all node 30
			[
				"c",
				"r",
				"rccommon",
				"astable",
				"astablebar",
				"minus_trigger",
				"plus_trigger",
				"vss",
				"reset",
				"q",
				"qbar",
				"oscout",
				"vss2",
				"vdd",
			],
			"CD4047",
		);

		const netlist = makeNetlist([bbdDevice, clockDevice]);

		const result = deriveBbdDelayFromNetlist(bbdDevice, netlist, 2048);
		expect(result.outcome).toBe("refused");
		if (result.outcome === "refused") {
			expect(result.reason).toContain("shorted together to node 30");
		}
	});

	test("Refuses grounded timing capacitor on CD4047", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[GROUND, 2, GROUND, 0, 0, 0, 0, 0, 0, 14, 11, 0, 0, 13], // pins 1 and 3 grounded
			[
				"c",
				"r",
				"rccommon",
				"astable",
				"astablebar",
				"minus_trigger",
				"plus_trigger",
				"vss",
				"reset",
				"q",
				"qbar",
				"oscout",
				"vss2",
				"vdd",
			],
			"CD4047",
		);

		const netlist = makeNetlist([bbdDevice, clockDevice]);

		const result = deriveBbdDelayFromNetlist(bbdDevice, netlist, 2048);
		expect(result.outcome).toBe("refused");
		if (result.outcome === "refused") {
			expect(result.reason).toContain("both grounded; no timing capacitor");
		}
	});

	test("Refuses ambiguous multi-path timing network across distinct node pairs", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[13, 10, 0, 11, 12, 6, 7, 5], // 8 pins: VDD=13, CP1=10, GND=0, CP2=11, VGG=12, OX2=6, OX1=7, OX3=5
			["vdd", "cp1", "gnd", "cp2", "vgg", "ox2", "ox1", "ox3"],
			"MN3101",
		);

		const c1 = makeDevice("C1", "capacitor", [5, 98], [null, null], null, null, { farads: 100e-12 });
		const c2 = makeDevice("C2", "capacitor", [5, 99], [null, null], null, null, { farads: 100e-12 });

		const netlist = makeNetlist([bbdDevice, clockDevice, c1, c2]);

		const result = deriveBbdDelayFromNetlist(bbdDevice, netlist, 2048);
		expect(result.outcome).toBe("refused");
		if (result.outcome === "refused") {
			expect(result.reason).toContain("Ambiguous MN3101 oscillator common node");
		}
	});

	test("attachDeviceLaws prefers derived delay from resolvable clock driver", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[1, 2, 3, 0, 0, 0, 0, 0, 0, 14, 11, 0, 0, 13],
			[
				"c",
				"r",
				"rccommon",
				"astable",
				"astablebar",
				"minus_trigger",
				"plus_trigger",
				"vss",
				"reset",
				"q",
				"qbar",
				"oscout",
				"vss2",
				"vdd",
			],
			"CD4047BE",
		);

		const timingR = makeDevice("R_TIME", "resistor", [2, 3], [null, null], null, null, { ohms: 100000 });
		const timingC = makeDevice("C_TIME", "capacitor", [1, 3], [null, null], null, null, { farads: 100e-12 });

		const netlist = makeNetlist([bbdDevice, clockDevice, timingR, timingC]);

		const lawed = attachDeviceLaws(netlist, pedalPartCatalog);
		const bbdResolution = lawed.resolutions.find((r) => r.device === "U1");
		expect(bbdResolution?.outcome).toBe("macro");
		if (bbdResolution?.outcome === "macro") {
			expect(bbdResolution.macro.parameters.delaySeconds).toBeCloseTo(0.045056, 6);
			expect(bbdResolution.macro.parameters.stages).toBe(2048);
		}
	});

	test("Clock driver with unresolvable RC falls back to declared DelayMs (e.g. EH-7550)", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
			null,
			{ delaySeconds: 0.125 }, // Declared DelayMs: 125 ms
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[GROUND, 2, GROUND, 0, 0, 0, 0, 0, 0, 14, 11, 0, 0, 13], // Grounded pins (unresolvable clock)
			[
				"c",
				"r",
				"rccommon",
				"astable",
				"astablebar",
				"minus_trigger",
				"plus_trigger",
				"vss",
				"reset",
				"q",
				"qbar",
				"oscout",
				"vss2",
				"vdd",
			],
			"CD4047BE",
		);

		const netlist = makeNetlist([bbdDevice, clockDevice]);

		const lawed = attachDeviceLaws(netlist, pedalPartCatalog);
		const bbdResolution = lawed.resolutions.find((r) => r.device === "U1");
		expect(bbdResolution?.outcome).toBe("macro");
		if (bbdResolution?.outcome === "macro") {
			expect(bbdResolution.macro.parameters.delaySeconds).toBe(0.125);
		}
	});

	test("Clock driver with unresolvable RC and no DelayMs refuses naming missing DelayMs", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const clockDevice = makeDevice(
			"U2",
			"ic",
			[GROUND, 2, GROUND, 0, 0, 0, 0, 0, 0, 14, 11, 0, 0, 13], // Grounded pins (unresolvable clock)
			[
				"c",
				"r",
				"rccommon",
				"astable",
				"astablebar",
				"minus_trigger",
				"plus_trigger",
				"vss",
				"reset",
				"q",
				"qbar",
				"oscout",
				"vss2",
				"vdd",
			],
			"CD4047BE",
		);

		const netlist = makeNetlist([bbdDevice, clockDevice]);

		const lawed = attachDeviceLaws(netlist, pedalPartCatalog);
		const bbdResolution = lawed.resolutions.find((r) => r.device === "U1");
		expect(bbdResolution?.outcome).toBe("unsupported");
		if (bbdResolution?.outcome === "unsupported") {
			expect(bbdResolution.reason).toContain("declares no positive DelayMs");
		}
	});

	test("Clockless circuit with declared DelayMs resolves cleanly", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
			null,
			{ delaySeconds: 0.025 },
		);

		const netlist = makeNetlist([bbdDevice]);

		const lawed = attachDeviceLaws(netlist, pedalPartCatalog);
		const bbdResolution = lawed.resolutions.find((r) => r.device === "U1");
		expect(bbdResolution?.outcome).toBe("macro");
		if (bbdResolution?.outcome === "macro") {
			expect(bbdResolution.macro.parameters.delaySeconds).toBe(0.025);
		}
	});

	test("Clockless circuit with no DelayMs refuses naming missing DelayMs", () => {
		const bbdDevice = makeDevice(
			"U1",
			"ic",
			[0, 11, 20, 12, 13, 14, 21, 22],
			["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
			"MN3008",
		);

		const netlist = makeNetlist([bbdDevice]);

		const lawed = attachDeviceLaws(netlist, pedalPartCatalog);
		const bbdResolution = lawed.resolutions.find((r) => r.device === "U1");
		expect(bbdResolution?.outcome).toBe("unsupported");
		if (bbdResolution?.outcome === "unsupported") {
			expect(bbdResolution.reason).toContain("declares no positive DelayMs");
		}
	});

	test("a derived clock too slow to carry audio is refused, not returned", () => {
		// `electro-harmonix-deluxe-memory-man-eh7550` derived **5294 ms per stage** -- 21 seconds
		// across its four brigades, against a real Deluxe Memory Man's ~550 ms ceiling -- from a
		// 47 nF `C_DELAY` in a packet whose own `schematics/` and `sources/` directories are
		// empty. Being derived, that number carried no warning and read as the circuit's own.
		//
		// The bound is the sampling theorem rather than a taste judgement: a brigade clocked at
		// 96.7 Hz samples at a 48 Hz Nyquist limit, so it cannot carry a guitar's lowest string,
		// let alone the 1.3 kHz its top fundamental reaches. Whatever produced that number, it is
		// not a reading of this circuit's clock.
		const build = (farads: number) => {
			const bbd = makeDevice(
				"U1",
				"ic",
				[0, 11, 20, 12, 13, 14, 21, 22],
				["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
				"MN3008",
			);
			const clock = makeDevice(
				"IC10",
				"ic",
				[1, 2, 3, GROUND, GROUND, GROUND, GROUND, GROUND, GROUND, 10, 11, GROUND, GROUND, 100],
				[
					"c",
					"r",
					"rccommon",
					"astable",
					"astablebar",
					"minus_trigger",
					"plus_trigger",
					"vss",
					"reset",
					"q",
					"qbar",
					"oscout",
					"vss2",
					"vdd",
				],
				"CD4047BE",
			);
			const timingR = makeDevice("R_TIME", "resistor", [2, 3], [null, null], null, null, {
				ohms: 100000,
			});
			const timingC = makeDevice("C_TIME", "capacitor", [1, 3], [null, null], null, null, {
				farads,
			});
			return { bbd, netlist: makeNetlist([bbd, clock, timingR, timingC]) };
		};

		// The two-sided control, and it is what makes this a check rather than an assertion:
		// 100 pF gives a 22.7 kHz clock -- an ordinary BBD -- and must still derive.
		const sane = build(100e-12);
		const derived = deriveBbdDelayFromNetlist(sane.bbd, sane.netlist, 2048);
		expect(derived.outcome).toBe("derived");

		// The eh7550's own 47 nF gives 96.7 Hz and must not.
		const slow = build(47e-9);
		const refused = deriveBbdDelayFromNetlist(slow.bbd, slow.netlist, 2048);
		expect(refused.outcome).toBe("refused");
		if (refused.outcome === "refused") {
			expect(refused.reason).toContain("Nyquist");
		}
	});

	describe("PT2399 digital delay derivation", () => {
		test("PT2399 law reproduces the cited datasheet Table 1 rows", () => {
			// Princeton PT2399 datasheet, TABLE 1: RESISTOR/DELAY TIME VALUES (V1.4,
			// Oct 2005; same rows in V1.1/V1.2/V1.6). (Ohms, cited ms).
			const rows: Array<[number, number]> = [
				[27600, 342],
				[10500, 151],
				[4000, 75.9],
				[2000, 52.3],
				[288, 32.6],
				[0.5, 31.3],
			];
			for (const [rOhms, citedMs] of rows) {
				// The linear form reproduces every cited row within 4 ms; the replaced
				// piecewise fit read 27.6 kOhms as 191.8 ms and fails here.
				expect(Math.abs(pt2399DelayFromOhms(rOhms) * 1000 - citedMs)).toBeLessThanOrEqual(4);
			}
		});

		test("PT2399 derives delay from external VCO timing network", () => {
			// Pin 6 (VCO) connected via 10k series resistor and 50k pot (wiper at 25k) to GND (node 0)
			// Total nominal R = 35kΩ => delay = 29.70ms + 11.46ms * 35 = 430.8 ms
			const ptDevice = makeDevice(
				"U1",
				"ic",
				[1, 2, 0, 0, 5, 14, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17],
				["pin1", "pin2", "pin3_agnd", "pin4_dgnd", "pin5", "pin6_vco", "pin7", "pin8", "pin9", "pin10", "pin11", "pin12", "pin13", "pin14", "pin15", "pin16"],
				"PT2399",
			);
			const seriesR = makeDevice("R_SERIES", "resistor", [14, 20], [null, null], null, null, { ohms: 10000 });
			// `Device.control` is readonly, so the binding is constructed rather than assigned.
			const pot: Device = {
				...makeDevice("VR_TIME", "potentiometer", [20, 0, 20], [null, null], null, null, {
					ohms: 50000,
				}),
				control: "TIME",
			};

			const netlist: Netlist = {
				nodes: [0, 1, 2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20],
				devices: [ptDevice, seriesR, pot],
				// `Control` is `{ id, taper, defaultPosition }` -- 0.5 is the wiper-at-25k the
				// case above describes, which is what makes the nominal 35k and 430.8 ms.
				controls: [{ id: "TIME", taper: "linear", defaultPosition: 0.5 }],
				ports: { input: 1, output: 2 },
				bypass: { declared: "none" },
				portImpedanceOhms: { input: null, output: null },
				portDeclaredFullScaleVolts: { input: null, output: null },
				convergenceOptIn: false,
			};

			const result = derivePt2399DelayFromNetlist(ptDevice, netlist);
			expect(result.outcome).toBe("derived");
			if (result.outcome === "derived") {
				expect(result.rOhms).toBe(35000);
				expect(result.delaySeconds).toBeCloseTo(0.4308, 3);
				expect(result.controlId).toBe("TIME");
				expect(result.ohmsAtControlMin).toBe(10000);
				expect(result.ohmsAtControlMax).toBe(60000);
				// The knob sweeps the datasheet law, not a line through the
				// origin: intercept 29.7 ms with 11.46 ms/kOhm slope.
				expect(result.offsetSeconds).toBe(0.0297);
				expect(result.formulaConstant).toBeCloseTo(0.01146 / 1000, 12);
			}
		});

		test("Negative control: unconnected VCO pin is refused", () => {
			const ptDevice = makeDevice(
				"U1",
				"ic",
				[1, 2, 0, 0, 5, 14, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17],
				["pin1", "pin2", "pin3_agnd", "pin4_dgnd", "pin5", "pin6_vco", "pin7", "pin8", "pin9", "pin10", "pin11", "pin12", "pin13", "pin14", "pin15", "pin16"],
				"PT2399",
			);
			const netlist = makeNetlist([ptDevice]);
			const result = derivePt2399DelayFromNetlist(ptDevice, netlist);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("timing network");
			}
		});

		test("Negative control: grounded VCO pin is refused", () => {
			const ptDevice = makeDevice(
				"U1",
				"ic",
				[1, 2, 0, 0, 5, 0, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17],
				["pin1", "pin2", "pin3_agnd", "pin4_dgnd", "pin5", "pin6_vco", "pin7", "pin8", "pin9", "pin10", "pin11", "pin12", "pin13", "pin14", "pin15", "pin16"],
				"PT2399",
			);
			const netlist = makeNetlist([ptDevice]);
			const result = derivePt2399DelayFromNetlist(ptDevice, netlist);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("grounded");
			}
		});
	});

	describe("M50195P digital echo delay derivation", () => {
		test("Derives delay and control mapping from 74HCU04 inverter oscillator timing network", () => {
			const mDevice = makeDevice(
				"IC3",
				"ic",
				[34, 34, 30, 8, 9, 23, 0],
				["a0", "a1", "clk1", "sin", "op2out", "vcc", "gnd"],
				"M50195P",
			);
			const inv1 = makeDevice("IC6A", "ic", [32, 30, 23, 0], ["input", "output", "vcc", "gnd"], "74HCU04");
			const inv2 = makeDevice("IC6B", "ic", [30, 32, 23, 0], ["input", "output", "vcc", "gnd"], "74HCU04");
			const seriesR = makeDevice("R27", "resistor", [30, 31], ["anode", "cathode"], null, null, { ohms: 390000 });
			const pot: Device = {
				...makeDevice("VR1", "potentiometer", [31, 32, 30], ["lug1", "wiper", "lug3"], null, null, {
					ohms: 390000,
				}),
				control: "TIME",
			};

			const netlist: Netlist = {
				...makeNetlist([mDevice, inv1, inv2, seriesR, pot]),
				controls: [{ id: "TIME", taper: "logarithmic", defaultPosition: 0.5 }],
				ports: { input: 8, output: 9 },
				portImpedanceOhms: { input: null, output: null },
		portDeclaredFullScaleVolts: { input: null, output: null },
			};

			const result = deriveM50195DelayFromNetlist(mDevice, netlist);
			expect(result.outcome).toBe("derived");
			if (result.outcome === "derived") {
				expect(result.delaySeconds).toBeGreaterThan(0.03);
				expect(result.delaySeconds).toBeLessThanOrEqual(0.4);
				expect(result.controlId).toBe("TIME");
				expect(result.taper).toBe("logarithmic");
			}
		});

		test("Negative control: grounded CLK1 pin is refused", () => {
			const mDevice = makeDevice(
				"IC3",
				"ic",
				[34, 34, 0, 8, 9, 23, 0],
				["a0", "a1", "clk1", "sin", "op2out", "vcc", "gnd"],
				"M50195P",
			);
			const netlist = makeNetlist([mDevice]);
			const result = deriveM50195DelayFromNetlist(mDevice, netlist);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("grounded");
			}
		});
	});

	describe("an actively-steered timing network is not reducible to R and C", () => {
		// The MN3101 rig every case below varies: 150k and 47pF across the oscillator pins,
		// which the datasheet formula f = 1/(5*R*C) turns into 28.37 kHz and, for 1024 stages,
		// a delay of 1024/(2*28368) = 18.05 ms. Hand-derived before measuring.
		const mn3101Rig = (extra: readonly Device[] = []) => {
			const bbd = makeDevice(
				"IC3",
				"ic",
				[0, 5, 20, 4, 2, 6, 21, 22],
				["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
				"MN3007",
			);
			const clock = makeDevice(
				"IC4",
				"ic",
				[2, 5, 0, 6, 4, 55, 54, 56],
				["vdd", "cp1", "gnd", "cp2", "vgg", "ox2", "ox1", "ox3"],
				"MN3101",
			);
			const r = makeDevice("R_T", "resistor", [55, 99], [null, null], null, null, {
				ohms: 150000,
			});
			const c = makeDevice("C_T", "capacitor", [56, 99], [null, null], null, null, {
				farads: 47e-12,
			});
			return { bbd, netlist: makeNetlist([bbd, clock, r, c, ...extra]) };
		};

		test("a passive timing network still derives", () => {
			const { bbd, netlist } = mn3101Rig();
			const result = deriveBbdDelayFromNetlist(bbd, netlist, 1024);
			expect(result.outcome).toBe("derived");
			if (result.outcome === "derived") {
				expect(result.delaySeconds).toBeCloseTo(1024 * 2.5 * 150000 * 47e-12, 9);
			}
		});

		test("a pot as the timing element is control-rate, so it still derives", () => {
			// The discrimination that matters: a knob is not a modulator. Without it, the refusal
			// below would also take every delay pedal whose DELAY control is in the clock network
			// -- boss-dm-2 and all four of mxr-carbon-copy's brigades. The pot replaces the fixed
			// resistor rather than joining it, because two resistive paths across the same
			// oscillator pins is the pre-existing ambiguity refusal and would prove nothing here.
			const bbd = makeDevice(
				"IC3",
				"ic",
				[0, 5, 20, 4, 2, 6, 21, 22],
				["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
				"MN3007",
			);
			const clock = makeDevice(
				"IC4",
				"ic",
				[2, 5, 0, 6, 4, 55, 54, 56],
				["vdd", "cp1", "gnd", "cp2", "vgg", "ox2", "ox1", "ox3"],
				"MN3101",
			);
			const pot = makeDevice(
				"VR_DELAY",
				"potentiometer",
				[55, 99, 99],
				[null, null, null],
				null,
				null,
				{ ohms: 100000 },
			);
			const c = makeDevice("C_T", "capacitor", [56, 99], [null, null], null, null, {
				farads: 47e-12,
			});
			const result = deriveBbdDelayFromNetlist(
				bbd,
				makeNetlist([bbd, clock, pot, c]),
				1024,
			);
			expect(result.outcome).toBe("derived");
		});

		test("a transistor on an oscillator node refuses, and names it", () => {
			const q = makeDevice("Q8", "bjt", [2, 51, 54], [
				"collector",
				"base",
				"emitter",
			]);
			const { bbd, netlist } = mn3101Rig([q]);
			const result = deriveBbdDelayFromNetlist(bbd, netlist, 1024);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("Q8");
				expect(result.reason).toContain("modulated");
			}
		});

		test("the refusal outranks the missing-component one, so the reason is not misleading", () => {
			// Without the ordering this test pins, a circuit whose timing resistance IS a
			// transistor reports "No timing resistor/pot found", which reads as a capture defect
			// and sends a reader to add a resistor to a correct document.
			const q = makeDevice("Q5", "bjt", [2, 51, 54], [
				"collector",
				"base",
				"emitter",
			]);
			const bbd = makeDevice(
				"IC3",
				"ic",
				[0, 5, 20, 4, 2, 6, 21, 22],
				["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
				"MN3007",
			);
			const clock = makeDevice(
				"IC4",
				"ic",
				[2, 5, 0, 6, 4, 55, 54, 56],
				["vdd", "cp1", "gnd", "cp2", "vgg", "ox2", "ox1", "ox3"],
				"MN3101",
			);
			const c = makeDevice("C_T", "capacitor", [54, 55], [null, null], null, null, {
				farads: 47e-12,
			});
			const netlist = makeNetlist([bbd, clock, c, q]);
			const result = deriveBbdDelayFromNetlist(bbd, netlist, 1024);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("Q5");
				expect(result.reason).not.toContain("No timing resistor");
			}
		});

		test("unrecognised oscillator role spellings are named in the refusal", () => {
			const bbd = makeDevice(
				"IC3",
				"ic",
				[0, 11, 20, 12, 13, 14, 21, 22],
				["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
				"MN3207",
			);
			const clock = makeDevice(
				"IC4",
				"ic",
				[358, 359, 11, 12, 13, 7, 6, 0],
				[
					"mysteryinput",
					"mysteryoutput",
					"clock1",
					"clock2",
					"mysterycontrol",
					"biasoutput",
					"vdd",
					"vss",
				],
				"MN3102",
			);
			const result = deriveBbdDelayFromNetlist(
				bbd,
				makeNetlist([bbd, clock]),
				1024,
			);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("mysteryinput");
				expect(result.reason).toContain("IC4");
			}
		});
	});

	describe("gate-generated clocks are recognised, not reported as absent", () => {
		// A SAD512D clocked from a hex inverter, which is mxr-micro-flanger's shape. Before this
		// the derivation reported "no clock driver device is wired to this delay line", which is
		// false: there is one, it is just not a CD4047 or an MN310x.
		const gateRig = (extra: readonly Device[] = []) => {
			const bbd = makeDevice(
				"A3",
				"ic",
				[43, 0, 3, 4, 5, 6, 7, 57],
				["clock", "gnd", "oddout", "evenout", "vbb", "input", "sync", "vdd"],
				"SAD512D",
			);
			const gate = makeDevice(
				"U2",
				"ic",
				[1, 2, 2, 43, 4, 3, 0, 3, 4, 3, 4, 3, 4, 57],
				[
					"in1", "out1", "in2", "out2", "in3", "out3", "vss",
					"out4", "in4", "out5", "in5", "out6", "in6", "vdd",
				],
				"MC14069UB",
			);
			return { bbd, netlist: makeNetlist([bbd, gate, ...extra]) };
		};

		test("a passive gate oscillator refuses by naming the part, not by claiming none exists", () => {
			const { bbd, netlist } = gateRig();
			const result = deriveBbdDelayFromNetlist(bbd, netlist, 512);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("U2");
				expect(result.reason).toContain("MC14069UB");
			}
		});

		test("a transistor steering the oscillator through a resistor is still steering it", () => {
			// Q3's collector feeds oscillator node 1 through R27 rather than sitting on it, which
			// is exactly mxr-micro-flanger. Direct contact cannot see that, so the gate branch
			// looks one passive hop out.
			const r = makeDevice("R27", "resistor", [31, 1], [null, null], null, null, {
				ohms: 30000,
			});
			const q = makeDevice("Q3", "bjt", [31, 30, 57], [
				"collector",
				"base",
				"emitter",
			]);
			const { bbd, netlist } = gateRig([r, q]);
			const result = deriveBbdDelayFromNetlist(bbd, netlist, 512);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("Q3");
				expect(result.reason).toContain("modulated");
			}
		});

		test("the one-hop walk does not step onto the supply rail", () => {
			// The negative control for the test above. `C21` decouples VDD to oscillator node 4,
			// so a hop that ignored supply roles would pull the rail into the reachable set and
			// report every transistor with an emitter on it. `Q1` is on the rail and is not
			// steering anything.
			const c = makeDevice("C21", "capacitor", [57, 4], [null, null], null, null, {
				farads: 1e-7,
			});
			const q1 = makeDevice("Q1", "bjt", [57, 25, 9], [
				"collector",
				"base",
				"emitter",
			]);
			const { bbd, netlist } = gateRig([c, q1]);
			const result = deriveBbdDelayFromNetlist(bbd, netlist, 512);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).not.toContain("Q1");
				expect(result.reason).not.toContain("modulated");
			}
		});

		test("a brigade with no clock part at all still reports no-clock-driver", () => {
			// The refusals above must not swallow the genuinely-unclocked case, which is what
			// four digital delay-memory packets and two shell-captured BBDs still are.
			const bbd = makeDevice(
				"A3",
				"ic",
				[43, 0, 3, 4, 5, 6, 7, 57],
				["clock", "gnd", "oddout", "evenout", "vbb", "input", "sync", "vdd"],
				"SAD512D",
			);
			expect(
				deriveBbdDelayFromNetlist(bbd, makeNetlist([bbd]), 512).outcome,
			).toBe("no-clock-driver");
		});

		test("a brigade declaring no clock pin is not matched to a nearby gate", () => {
			// electro-harmonix-electric-mistress declares its SAD1024A as a two-pin shell. There
			// is no clock terminal to search from, so nothing may be inferred.
			const shell = makeDevice("U1", "ic", [10, 11], ["input", "output"], "SAD1024A");
			const gate = makeDevice(
				"U2",
				"ic",
				[1, 2, 2, 43, 4, 3, 0, 3, 4, 3, 4, 3, 4, 57],
				[
					"in1", "out1", "in2", "out2", "in3", "out3", "vss",
					"out4", "in4", "out5", "in5", "out6", "in6", "vdd",
				],
				"MC14069UB",
			);
			expect(
				deriveBbdDelayFromNetlist(shell, makeNetlist([shell, gate]), 1024)
					.outcome,
			).toBe("no-clock-driver");
		});
	});

	describe("the modulation port names the control terminal, never the timing node", () => {
		const rig = (extra: readonly Device[] = []) => {
			const bbd = makeDevice(
				"IC3",
				"ic",
				[0, 5, 20, 4, 2, 6, 21, 22],
				["pin1", "pin2", "pin3", "pin4", "pin5", "pin6", "pin7", "pin8"],
				"MN3007",
			);
			const clock = makeDevice(
				"IC4",
				"ic",
				[2, 5, 0, 6, 4, 55, 54, 56],
				["vdd", "cp1", "gnd", "cp2", "vgg", "ox2", "ox1", "ox3"],
				"MN3101",
			);
			const c = makeDevice("C_T", "capacitor", [54, 55], [null, null], null, null, {
				farads: 47e-12,
			});
			return { bbd, netlist: makeNetlist([bbd, clock, c, ...extra]) };
		};

		test("resolves a single steering transistor's base, not its collector", () => {
			// The whole point. Node 54 is the oscillator and carries the clock waveform, which at
			// a chorus's ~100 kHz no 48 kHz host can sample; node 58 is Q5's base and carries the
			// LFO alone. Reading the collector would alias garbage into the delay length.
			const q = makeDevice("Q5", "bjt", [54, 58, 0], [
				"collector",
				"base",
				"emitter",
			]);
			const { bbd, netlist } = rig([q]);
			const result = resolveClockModulationSource(bbd, netlist);
			expect(result.outcome).toBe("resolved");
			if (result.outcome === "resolved") {
				expect(result.steeredBy).toBe("Q5");
				expect(result.node).toBe(58);
			}
		});

		test("refuses two steering devices rather than choosing one", () => {
			const q4 = makeDevice("Q4", "bjt", [54, 58, 0], ["collector", "base", "emitter"]);
			const q5 = makeDevice("Q5", "bjt", [55, 59, 0], ["collector", "base", "emitter"]);
			const { bbd, netlist } = rig([q4, q5]);
			const result = resolveClockModulationSource(bbd, netlist);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("Q4");
				expect(result.reason).toContain("Q5");
			}
		});

		test("refuses a control terminal that sits on the timing network itself", () => {
			// Such a terminal carries the oscillator, not a modulation. A JFET whose gate is on
			// the timing node is a clamp or a feedback element, not an LFO input.
			const j = makeDevice("Q9", "jfet", [2, 54, 0], ["drain", "gate", "source"]);
			const { bbd, netlist } = rig([j]);
			const result = resolveClockModulationSource(bbd, netlist);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("timing network itself");
			}
		});

		test("a passive timing network yields no port at all", () => {
			// The control that keeps this from firing on every delay pedal: mxr-carbon-copy and
			// boss-dm-2 have only passives on their timing nodes and must stay static.
			const r = makeDevice("R_T", "resistor", [54, 55], [null, null], null, null, {
				ohms: 150000,
			});
			const { bbd, netlist } = rig([r]);
			expect(resolveClockModulationSource(bbd, netlist).outcome).toBe("none");
		});

		test("refuses a grounded control terminal", () => {
			const q = makeDevice("Q5", "bjt", [54, 0, 9], ["collector", "base", "emitter"]);
			const { bbd, netlist } = rig([q]);
			const result = resolveClockModulationSource(bbd, netlist);
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") {
				expect(result.reason).toContain("grounded");
			}
		});
	});

	describe("clockControl carries formulaConstant in the runtime's units", () => {
		// The invariant every derivation path owes, and the one that was broken. The runtime
		// computes `delay = offsetSeconds + stages * formulaConstant * R * farads`, so a path
		// that returns a constant already folding in `stages` and `C` has them applied twice.
		// `M50195P` declared physical `stages: 2048` / `cFarads: 5e-12` beside a
		// `delaySeconds / R` constant, multiplying every delay by 1.024e-8: `ibanez-dl5`
		// declared 350 ms and rendered about 3 ns. Asserting the sum rather than the constant
		// catches that in any path, whatever its internal convention.
		const productReproducesDelay = (r: {
			outcome: string;
			delaySeconds?: number;
			stages?: number;
			formulaConstant?: number;
			offsetSeconds?: number;
			rOhms?: number;
			cFarads?: number;
		}): void => {
			expect(r.outcome).toBe("derived");
			if (r.outcome !== "derived") return;
			const product =
				(r.offsetSeconds as number) +
				(r.stages as number) *
					(r.formulaConstant as number) *
					(r.rOhms as number) *
					(r.cFarads as number);
			expect(product).toBeCloseTo(r.delaySeconds as number, 9);
		};

		test("CD4047 path", () => {
			const bbd = makeDevice("U1", "ic", [0, 11, 20, 12, 13, 14, 21, 22],
				["pin1","pin2","pin3","pin4","pin5","pin6","pin7","pin8"], "MN3008");
			const clock = makeDevice("U2", "ic", [1, 2, 3, 0, 0, 0, 0, 0, 0, 14, 11, 0, 0, 13],
				["c","r","rccommon","astable","astablebar","minus_trigger","plus_trigger",
				 "vss","reset","q","qbar","oscout","vss2","vdd"], "CD4047BE");
			const r = makeDevice("R_TIME", "resistor", [2, 3], [null, null], null, null, { ohms: 100000 });
			const c = makeDevice("C_TIME", "capacitor", [1, 3], [null, null], null, null, { farads: 100e-12 });
			productReproducesDelay(
				deriveBbdDelayFromNetlist(bbd, makeNetlist([bbd, clock, r, c]), 2048) as never,
			);
		});

		test("MN3101 path", () => {
			const bbd = makeDevice("IC3", "ic", [0, 5, 20, 4, 2, 6, 21, 22],
				["pin1","pin2","pin3","pin4","pin5","pin6","pin7","pin8"], "MN3007");
			const clock = makeDevice("IC4", "ic", [2, 5, 0, 6, 4, 55, 54, 56],
				["vdd","cp1","gnd","cp2","vgg","ox2","ox1","ox3"], "MN3101");
			const r = makeDevice("R_T", "resistor", [55, 99], [null, null], null, null, { ohms: 150000 });
			const c = makeDevice("C_T", "capacitor", [56, 99], [null, null], null, null, { farads: 47e-12 });
			productReproducesDelay(
				deriveBbdDelayFromNetlist(bbd, makeNetlist([bbd, clock, r, c]), 1024) as never,
			);
		});

		test("M50195P path -- the one that was wrong", () => {
			const m = makeDevice("IC3", "ic", [34, 34, 8, 9, 10, 23, 0],
				["a0","a1","clk1","sin","op2out","vcc","gnd"], "M50195P");
			const inv = makeDevice("IC6", "ic", [8, 40], ["in1","out1"], "74HCU04");
			const r = makeDevice("R_T", "resistor", [8, 40], [null, null], null, null, { ohms: 1200000 });
			productReproducesDelay(
				deriveM50195DelayFromNetlist(m, makeNetlist([m, inv, r])) as never,
			);
		});
	});
});


describe("open-OX2 clock law recognition", () => {
	const OX_ROLES = ["gnd", "cp1", "vdd", "cp2", "ox3", "ox2", "ox1", "vggout"];
	function openOx2Netlist(overrides: {
		clockPart?: string;
		clockNodes?: readonly number[];
		clockRoles?: readonly (string | null)[];
		extra?: readonly Device[];
		drop?: readonly string[];
		patch?: (devices: Device[]) => Device[];
	} = {}): Netlist {
		const devices: Device[] = [
			makeDevice("IC4", "ic", overrides.clockNodes ?? [0, 5, 2, 6, 56, 55, 54, 4], overrides.clockRoles ?? OX_ROLES, overrides.clockPart ?? "MN3101"),
			makeDevice("C22", "capacitor", [56, 54], ["anode", "cathode"], null, null, { farads: 47e-12 }),
			makeDevice("R38", "resistor", [54, 2], ["anode", "cathode"], null, null, { ohms: 150000 }),
			makeDevice("R39", "resistor", [56, 58], ["anode", "cathode"]),
			makeDevice("Q5", "bjt", [59, 58, 0], ["collector", "base", "emitter"]),
			makeDevice("R40", "resistor", [59, 2], ["anode", "cathode"]),
			makeDevice("D2", "diode", [54, 59], ["anode", "cathode"]),
			makeDevice("D1", "diode", [57, 54], ["anode", "cathode"]),
			makeDevice("R36", "resistor", [51, 57], ["anode", "cathode"]),
			makeDevice("R37", "resistor", [57, 0], ["anode", "cathode"]),
			...(overrides.extra ?? []),
		].filter((d) => !(overrides.drop ?? []).includes(d.id));
		return makeNetlist(overrides.patch ? overrides.patch(devices) : devices);
	}
	const recognize = (netlist: Netlist) => deriveOpenOx2ClockLaw(netlist, pedalPartCatalog);

	test("recognises the full open-OX2 form by connectivity", () => {
		const result = recognize(openOx2Netlist());
		expect(result.outcome).toBe("recognized");
		if (result.outcome === "recognized") {
			expect(result.slowNode).toBe(57);
			expect(result.steeredBy).toBe("Q5");
			expect(result.rOhms).toBe(150000);
			expect(result.cFarads).toBe(47e-12);
		}
	});

	test("absent without an MN3101 driver", () => {
		expect(recognize(openOx2Netlist({ clockPart: "MN3102" })).outcome).toBe("absent");
	});

	test("absent when OX2 is wired into the circuit", () => {
		expect(
			recognize(
				openOx2Netlist({ extra: [makeDevice("RX", "resistor", [55, 60], [null, null])] }),
			).outcome,
		).toBe("absent");
	});

	test("absent when the capacitor bridges the wrong pins", () => {
		expect(
			recognize(
				openOx2Netlist({
					patch: (devices) =>
						devices.map((d) =>
							d.id === "C22" ? makeDevice("C22", "capacitor", [54, 55], ["anode", "cathode"], null, null, { farads: 47e-12 }) : d,
						),
				}),
			).outcome,
		).toBe("absent");
	});

	test("absent without the OX1 pull-up, or with it to ground", () => {
		expect(recognize(openOx2Netlist({ drop: ["R38"] })).outcome).toBe("absent");
		expect(
			recognize(
				openOx2Netlist({
					patch: (devices) =>
						devices.map((d) =>
							d.id === "R38" ? makeDevice("R38", "resistor", [54, 0], ["anode", "cathode"], null, null, { ohms: 150000 }) : d,
						),
				}),
			).outcome,
		).toBe("absent");
	});

	test("absent without the base-drive resistor, or with the base on OX3 itself", () => {
		expect(recognize(openOx2Netlist({ drop: ["R39"] })).outcome).toBe("absent");
		expect(
			recognize(
				openOx2Netlist({
					drop: ["R39"],
					patch: (devices) =>
						devices.map((d) =>
							d.id === "Q5" ? makeDevice("Q5", "bjt", [59, 56, 0], ["collector", "base", "emitter"]) : d,
						),
				}),
			).outcome,
		).toBe("absent");
	});

	test("absent when the switch emitter is not grounded", () => {
		expect(
			recognize(
				openOx2Netlist({
					patch: (devices) =>
						devices.map((d) =>
							d.id === "Q5" ? makeDevice("Q5", "bjt", [59, 58, 60], ["collector", "base", "emitter"]) : d,
						),
				}),
			).outcome,
		).toBe("absent");
	});

	test("absent with a reversed discharge diode, or none", () => {
		expect(recognize(openOx2Netlist({ drop: ["D2"] })).outcome).toBe("absent");
		expect(
			recognize(
				openOx2Netlist({
					patch: (devices) =>
						devices.map((d) =>
							d.id === "D2" ? makeDevice("D2", "diode", [54, 59], ["cathode", "anode"]) : d,
						),
				}),
			).outcome,
		).toBe("absent");
	});

	test("absent without the slow diode, or with its anode grounded", () => {
		expect(recognize(openOx2Netlist({ drop: ["D1"] })).outcome).toBe("absent");
		expect(
			recognize(
				openOx2Netlist({
					patch: (devices) =>
						devices.map((d) =>
							d.id === "D1" ? makeDevice("D1", "diode", [0, 54], ["anode", "cathode"]) : d,
						),
				}),
			).outcome,
		).toBe("absent");
	});

	test("absent when the slow node is not divider-fed, or is collector-driven", () => {
		expect(recognize(openOx2Netlist({ drop: ["R37"] })).outcome).toBe("absent");
		expect(
			recognize(
				openOx2Netlist({
					extra: [makeDevice("QX", "bjt", [57, 61, 0], ["collector", "base", "emitter"])],
				}),
			).outcome,
		).toBe("absent");
	});
});
