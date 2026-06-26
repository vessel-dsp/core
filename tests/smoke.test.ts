import { describe, expect, test } from "bun:test";
import { VERSION } from "@vessel-dsp/core";

describe("entrypoints", () => {
	test("core exposes a version string", () => {
		expect(typeof VERSION).toBe("string");
		expect(VERSION.length).toBeGreaterThan(0);
	});
});

describe("headless boundaries", () => {
	test("core entrypoint does not import React or browser audio globals", async () => {
		const source = await Bun.file(
			new URL("../packages/core/src/index.ts", import.meta.url),
		).text();
		expect(source).not.toMatch(/from\s+['"][^'"]*react[^'"]*['"]/);
		expect(source).not.toMatch(/from\s+['"][^'"]*react-dom[^'"]*['"]/);
		expect(source).not.toContain("AudioContext");
		expect(source).not.toContain("AudioWorklet");
	});
});
