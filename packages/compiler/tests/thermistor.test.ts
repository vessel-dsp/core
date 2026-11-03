// NTC thermistor as a component kind: the fold, the controls, and the refusals.
//
// Registered-first expectations (hand-computed closed forms, not implementation
// outputs):
// - Beta 0 folds to exactly R_ref at any ambient, so a Beta-0 thermistor compiles
//   to the byte-identical program of the same-valued resistor (negative control).
// - thermistorDivider (R_ref 10k, Beta 3950 K, T_ref 25 C) folds to 10000.00 ohms
//   at 25 C and to 13127.010775676536 ohms at 19 C (positive control).
// - thermalFuzzFacePair folds RT1 (33k) to 43319.13555973257 ohms at 19 C.
// - A `Type: ptc`, a missing Beta, a negative Beta, an unphysical reference
//   temperature, and a three-terminal disc are typed refusals naming the component.

import { describe, expect, it } from "bun:test";
import { attachDeviceLaws } from "../src/device-laws";
import { compile } from "../src/compile";
import { emit } from "../src/emit";
import { readNetlist } from "../src/netlist";
import { emptyRegistry } from "../src/registry";
import {
	resistorDivider,
	thermalFuzzFacePair,
	thermistorDivider,
} from "../src/fixtures/circuits";

const KELVIN_19C = 19 + 273.15;
const KELVIN_25C = 25 + 273.15;

function conductanceSiemens(source: string, device: string, kelvin?: number): number {
	const lawed = attachDeviceLaws(
		readNetlist(source),
		emptyRegistry,
		kelvin === undefined ? undefined : { ambientKelvin: kelvin },
	);
	const resolution = lawed.resolutions.find(
		(entry) => entry.device === device,
	);
	if (resolution?.outcome !== "law" || resolution.law.kind !== "conductance") {
		throw new Error(
			`expected a conductance law for ${device}, got ${JSON.stringify(resolution)}`,
		);
	}
	return resolution.law.siemens;
}

function unsupportedReason(source: string): { stage: string; device: string | null; reason: string } {
	const result = compile(source);
	if (result.status !== "unsupported") {
		throw new Error(`expected unsupported, got ${result.status}`);
	}
	const reason = result.reasons[0];
	if (reason === undefined) {
		throw new Error("expected at least one reason");
	}
	return reason;
}

const betaZeroDivider = thermistorDivider
	.replace('Beta: "3950"', 'Beta: "0"')
	.replace('Description: "NTC bias disc, 10k at 25 C."', 'Description: "Zero-beta control."');

describe("thermistor", () => {
	it("compiles Beta 0 to exactly the same-valued resistor (negative control)", () => {
		// R(T) = R_ref * exp(0 * (1/T - 1/T_ref)) is R_ref whatever T is, and the
		// device ids match the resistor divider's, so the programs are identical.
		const resistor = compile(resistorDivider);
		const thermistor = compile(betaZeroDivider);
		expect(resistor.status).toBe("ok");
		expect(thermistor.status).toBe("ok");
		if (resistor.status !== "ok" || thermistor.status !== "ok") return;
		expect(emit(thermistor.program).text).toBe(emit(resistor.program).text);

		const warm = compile(betaZeroDivider, { ambientTemperatureC: 19 });
		expect(warm.status).toBe("ok");
		if (warm.status !== "ok") return;
		expect(emit(warm.program).text).toBe(emit(resistor.program).text);
	});

	it("folds the divider top arm to the closed form at 19 C and 25 C (positive control)", () => {
		expect(conductanceSiemens(thermistorDivider, "RT1", KELVIN_25C)).toBe(
			1 / 10000,
		);
		const siemens19 = conductanceSiemens(thermistorDivider, "RT1", KELVIN_19C);
		expect(
			Math.abs(siemens19 - 1 / 13127.010775676536) / (1 / 13127.010775676536),
		).toBeLessThan(1e-12);
	});

	it("folds the fuzz-face collector return to its closed form at 19 C", () => {
		const siemens = conductanceSiemens(thermalFuzzFacePair, "RT1", KELVIN_19C);
		expect(
			Math.abs(siemens - 1 / 43319.13555973257) / (1 / 43319.13555973257),
		).toBeLessThan(1e-12);
	});

	it("defaults an unstated reference temperature to 25 C", () => {
		const explicit = thermistorDivider.replace(
			'Beta: "3950"',
			'Beta: "3950"\n      ReferenceTemperatureC: "25"',
		);
		const implicit = conductanceSiemens(thermistorDivider, "RT1", KELVIN_19C);
		const stated = conductanceSiemens(explicit, "RT1", KELVIN_19C);
		expect(stated).toBe(implicit);
	});

	it("refuses a PTC type, naming the component", () => {
		const source = thermistorDivider.replace(
			'Beta: "3950"',
			'Beta: "3950"\n      Type: "ptc"',
		);
		const reason = unsupportedReason(source);
		expect(reason.stage).toBe("netlist");
		expect(reason.device).toBe("RT1");
		expect(reason.reason).toMatch(/PTC/);
	});

	it("refuses a missing Beta, naming the component", () => {
		const source = thermistorDivider.replace('      Beta: "3950"\n', "");
		const reason = unsupportedReason(source);
		expect(reason.device).toBe("RT1");
		expect(reason.reason).toMatch(/no Beta/);
	});

	it("refuses a negative Beta and an unphysical reference temperature", () => {
		const negative = thermistorDivider.replace('Beta: "3950"', 'Beta: "-10"');
		const negativeReason = unsupportedReason(negative);
		expect(negativeReason.device).toBe("RT1");
		expect(negativeReason.reason).toMatch(/negative Beta/);

		const cold = thermistorDivider.replace(
			'Beta: "3950"',
			'Beta: "3950"\n      ReferenceTemperatureC: "-300"',
		);
		const coldReason = unsupportedReason(cold);
		expect(coldReason.device).toBe("RT1");
		expect(coldReason.reason).toMatch(/absolute zero/);
	});

	it("refuses a disc with more or fewer than two terminals", () => {
		const threeTerminal = thermistorDivider.replace(
			"      - name: b\n        node: 2\n        position:\n          x: -100\n          y: 20",
			"      - name: b\n        node: 2\n        position:\n          x: -100\n          y: 20\n" +
				"      - name: c\n        node: 2\n        position:\n          x: -90\n          y: 20",
		);
		const reason = unsupportedReason(threeTerminal);
		expect(reason.device).toBe("RT1");
		expect(reason.reason).toMatch(/two/);
	});
});
