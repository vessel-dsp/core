import { describe, expect, test } from "bun:test";
import { buildComponent } from "../../packages/core/src/editor/factory";

describe("buildComponent", () => {
	test("creates a resistor with two terminals shifted to the requested origin", () => {
		const r = buildComponent({ kind: "resistor", origin: { x: 100, y: 60 } });
		expect(r.kind).toBe("resistor");
		expect(r.origin).toEqual({ x: 100, y: 60 });
		expect(r.rotation).toBe(0);
		expect(r.flipped).toBe(false);
		expect(r.terminals).toEqual([
			{ name: "a", position: { x: 100, y: 40 } },
			{ name: "b", position: { x: 100, y: 80 } },
		]);
	});

	test("creates palette components with terminals aligned to SVG symbol anchors", () => {
		const diode = buildComponent({
			kind: "diode",
			origin: { x: 0, y: 0 },
			sourceTypeName: "Circuit.Diode, Circuit",
		});
		const led = buildComponent({ kind: "led", origin: { x: 10, y: 10 } });
		const optocoupler = buildComponent({
			kind: "optocoupler",
			origin: { x: 100, y: 100 },
		});

		expect(diode.terminals).toEqual([
			{ name: "anode", position: { x: 0, y: -20 } },
			{ name: "cathode", position: { x: 0, y: 20 } },
		]);
		expect(led.terminals).toEqual([
			{ name: "anode", position: { x: 10, y: -10 } },
			{ name: "cathode", position: { x: 10, y: 30 } },
		]);
		expect(optocoupler.terminals).toEqual([
			{ name: "led+", position: { x: 80, y: 90 } },
			{ name: "led-", position: { x: 80, y: 110 } },
			{ name: "r1", position: { x: 120, y: 90 } },
			{ name: "r2", position: { x: 120, y: 110 } },
		]);
	});

	test("uses the kind prefix for the id, avoiding collisions", () => {
		const r1 = buildComponent({ kind: "resistor", origin: { x: 0, y: 0 } });
		expect(r1.id).toBe("R1");

		const r2 = buildComponent({
			kind: "resistor",
			origin: { x: 0, y: 0 },
			existingIds: new Set(["R1", "R2"]),
		});
		expect(r2.id).toBe("R3");
	});

	test("resolves a BJT variant from sourceTypeName", () => {
		const q = buildComponent({
			kind: "bjt",
			origin: { x: 0, y: 0 },
			sourceTypeName: "Circuit.PnpBjt, Circuit",
		});
		expect(q.terminals.map((t) => t.name)).toEqual([
			"collector",
			"base",
			"emitter",
		]);
		expect(q.sourceTypeName).toBe("Circuit.PnpBjt, Circuit");
	});

	test("resolves SPDT switches with switch terminal names", () => {
		const sw = buildComponent({
			kind: "switch",
			origin: { x: 0, y: 0 },
			sourceTypeName: "Circuit.SPDT, Circuit",
		});
		expect(sw.terminals.map((t) => t.name)).toEqual([
			"common",
			"throw0",
			"throw1",
		]);
	});

	test("resolves multi-throw switches with one common terminal and numbered throws", () => {
		const sp3t = buildComponent({
			kind: "switch",
			origin: { x: 0, y: 0 },
			sourceTypeName: "Circuit.SP3T, Circuit",
		});
		const sp4t = buildComponent({
			kind: "switch",
			origin: { x: 0, y: 0 },
			sourceTypeName: "Circuit.SP4T, Circuit",
		});

		expect(sp3t.terminals.map((t) => t.name)).toEqual([
			"common",
			"throw0",
			"throw1",
			"throw2",
		]);
		expect(sp4t.terminals.map((t) => t.name)).toEqual([
			"common",
			"throw0",
			"throw1",
			"throw2",
			"throw3",
		]);
	});

	test("falls back to default def when sourceTypeName is unknown", () => {
		const sw = buildComponent({
			kind: "switch",
			origin: { x: 0, y: 0 },
			sourceTypeName: "Circuit.UnknownSwitch, X",
		});
		// first 'switch' def in catalog is shortType Switch (TWO_TERMINAL_AB)
		expect(sw.terminals.map((t) => t.name)).toEqual(["a", "b"]);
	});

	test("label kind has no terminals and still receives a unique id", () => {
		const lbl = buildComponent({ kind: "label", origin: { x: 5, y: 5 } });
		expect(lbl.terminals).toEqual([]);
		expect(lbl.id).toBe("LBL1");
	});
});
