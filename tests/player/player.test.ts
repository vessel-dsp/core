import { describe, expect, test } from "bun:test";
import {
	AudioEngine,
	parseEntityUrl,
	registerVesselPlayer,
	VesselPlayerElement,
} from "@vessel-dsp/player";

const SAMPLE_VDSP = `schema: circuit-interchange/v3
metadata:
  name: "RC Filter"
  description: "Passive RC filter."
  partNumber: ""
source:
  format: vdsp
  filename: fixture.vdsp
components:
  - id: JIN
    kind: jack
    name: INPUT
    sourceTypeName: Circuit.Input
    origin:
      x: -200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 1
        position:
          x: -200
          y: 0
  - id: JOUT
    kind: jack
    name: OUTPUT
    sourceTypeName: Circuit.Output
    origin:
      x: 200
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: tip
        node: 2
        position:
          x: 200
          y: 0
  - id: GND1
    kind: ground
    name: GND
    sourceTypeName: Circuit.Ground
    origin:
      x: 0
      y: -100
    rotation: 0
    flipped: false
    terminals:
      - name: gnd
        node: 0
        position:
          x: 0
          y: -100
  - id: R1
    kind: resistor
    name: R1
    sourceTypeName: Circuit.Resistor
    origin:
      x: -50
      y: 0
    rotation: 0
    flipped: false
    terminals:
      - name: a
        node: 1
        position:
          x: -70
          y: 0
      - name: b
        node: 2
        position:
          x: -30
          y: 0
    properties:
      Resistance: "10k"
`;

describe("Phase 3: Embeddable Player & Online Entity Mode", () => {
	test("AudioEngine manages chain, sources, and metering buffers", () => {
		const engine = new AudioEngine({ sampleRate: 48000, initialSource: "sample" });
		expect(engine.playing).toBe(false);
		expect(engine.source).toBe("sample");

		const meter = engine.getMeterData();
		expect(meter.rmsDb).toBeLessThanOrEqual(0);
		expect(meter.peakDb).toBeLessThanOrEqual(0);
		expect(meter.clipping).toBe(false);
	});

	test("parseEntityUrl extracts username, type, id, and revision from VesselDSP entity URLs", () => {
		const parsed1 = parseEntityUrl("https://vesseldsp.com/joseph/pedal/ts9-overdrive");
		expect(parsed1).toEqual({
			username: "joseph",
			type: "pedal",
			id: "ts9-overdrive",
			rev: undefined,
		});

		const parsedWithRev = parseEntityUrl("https://vesseldsp.com/joseph/pedal/ts9-overdrive?rev=a1b2c3d4e5f6");
		expect(parsedWithRev).toEqual({
			username: "joseph",
			type: "pedal",
			id: "ts9-overdrive",
			rev: "a1b2c3d4e5f6",
		});

		const parsed2 = parseEntityUrl("https://vesseldsp.com/alex/amp/jcm800");
		expect(parsed2).toEqual({
			username: "alex",
			type: "amp",
			id: "jcm800",
			rev: undefined,
		});

		const parsed3 = parseEntityUrl("/pedal/klon-centaur?rev=998877");
		expect(parsed3).toEqual({
			type: "pedal",
			id: "klon-centaur",
			rev: "998877",
		});

		const parsedInvalid = parseEntityUrl("invalid-url-schema");
		expect(parsedInvalid).toBeNull();
	});

	test("VesselPlayerElement validates online mode requirements", async () => {
		const el = new VesselPlayerElement();

		// Mock attribute getter for unit test environment
		let attributes: Record<string, string> = {};
		(el as unknown as { getAttribute: (k: string) => string | null }).getAttribute = (k: string) => attributes[k] ?? null;

		// 1. Missing type
		attributes = { id: "tube-screamer" };
		await el.resolveAndFetchOnlineEntity();
		expect(el.status).toBe("missing_type");

		// 2. Unsupported type (e.g. amp or board in v0.1)
		attributes = { type: "amp", id: "plexi-1959" };
		await el.resolveAndFetchOnlineEntity();
		expect(el.status).toBe("unsupported_type");

		attributes = { type: "board", id: "rig-1" };
		await el.resolveAndFetchOnlineEntity();
		expect(el.status).toBe("unsupported_type");

		// 3. Missing id
		attributes = { type: "pedal" };
		await el.resolveAndFetchOnlineEntity();
		expect(el.status).toBe("missing_id");

		// 4. Valid pedal with mock fetch
		const originalFetch = globalThis.fetch;
		let requestedUrl = "";
		globalThis.fetch = (async (url: string | URL | Request) => {
			requestedUrl = String(url);
			return {
				ok: true,
				status: 200,
				headers: new Headers({ ETag: '"22d4b4052f4e"' }),
				json: async () => ({
					id: "ts-101",
					username: "joseph",
					type: "pedal",
					name: "Tube Screamer",
					revisionHash: "22d4b4052f4e",
					vdspSource: SAMPLE_VDSP,
				}),
			} as Response;
		}) as typeof fetch;

		try {
			attributes = { type: "pedal", id: "ts-101", username: "joseph", rev: "22d4b4052f4e" };
			await el.resolveAndFetchOnlineEntity();
			expect(el.status).toBe("ready");
			expect(el.entity?.name).toBe("Tube Screamer");
			expect(el.vdspSource).toBe(SAMPLE_VDSP);
			expect(requestedUrl).toContain("rev=22d4b4052f4e");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("VesselPlayerElement handles 404 not found gracefully", async () => {
		const el = new VesselPlayerElement();
		const attributes: Record<string, string> = { type: "pedal", id: "unknown-pedal" };
		(el as unknown as { getAttribute: (k: string) => string | null }).getAttribute = (k: string) => attributes[k] ?? null;

		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async () => {
			return {
				ok: false,
				status: 404,
				statusText: "Not Found",
			} as Response;
		}) as typeof fetch;

		try {
			await el.resolveAndFetchOnlineEntity();
			expect(el.status).toBe("error");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("registerVesselPlayer helper runs without throwing", () => {
		expect(() => registerVesselPlayer()).not.toThrow();
	});
});
