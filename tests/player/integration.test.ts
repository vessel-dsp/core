// Integration tests for the joined player package: the URL safety check against obfuscated
// schemes, the unsafe fallback URL, and the compile-time join of the input and IR modules with
// the shell's engine descriptors. Deterministic, no network, no browser APIs.
//
// Why the obfuscation cases exist: a browser strips tabs, newlines and leading control characters
// from a URL before it reads the scheme, so a regex over the raw text calls "java<TAB>script:x"
// safe while the browser parses it as javascript:. Each case below was run against the browser's
// own URL parser (new URL) when it was written; the expected protocol is in the comment.

import { describe, expect, test } from "bun:test";
import {
	type InputChoice,
	type InputChoiceDescriptor,
	PlayerController,
	isSafeSrc,
	parseSourceList,
	setEngineFactory,
} from "@vessel-dsp/player";

describe("isSafeSrc against obfuscated schemes", () => {
	// Unsafe: each of these parses to a javascript: or data: URL, or a cross-origin host, in a browser.
	const unsafe: Array<[string, string]> = [
		["javascript:alert(1)", "javascript:"],
		["  javascript:alert(1)", "javascript: after trimming"],
		["JaVaScRiPt:alert(1)", "javascript:, mixed case"],
		["data:text/html,<b>x", "data:"],
		["java\tscript:alert(1)", "javascript: (tab removed by the browser)"],
		["java\nscript:alert(1)", "javascript: (newline removed by the browser)"],
		["\u0001javascript:alert(1)", "javascript: (leading C0 character stripped)"],
		["\u0000javascript:alert(1)", "javascript: (leading NUL stripped)"],
		["\\\\evil.example/x.wav", "https://evil.example/x.wav (backslashes read as slashes)"],
		["/\\evil.example/x.wav", "https://evil.example/x.wav (slash then backslash)"],
		["//evil.example/x.wav", "protocol-relative, cross-origin"],
		["", "empty"],
		["   ", "blank"],
	];
	for (const [src, why] of unsafe) {
		test(`refuses ${JSON.stringify(src)} (${why})`, () => {
			expect(isSafeSrc(src)).toBe(false);
		});
	}

	// Safe: plain http(s) URLs and same-origin relative references.
	const safe = [
		"/audio/di.wav",
		"audio/di.wav",
		"./audio/di.wav",
		"../audio/di.wav",
		"https://cdn.example.com/x.wav",
		"http://cdn.example.com/x.nam",
		"  /audio/di.wav  ",
		"/audio/di%20guitar.wav?v=2#t",
	];
	for (const src of safe) {
		test(`accepts ${JSON.stringify(src)}`, () => {
			expect(isSafeSrc(src)).toBe(true);
		});
	}

	test("parseSourceList refuses an obfuscated scheme with the unsafe-src reason", () => {
		// Positive control: the same list with a plain relative src parses.
		const good = parseSourceList(JSON.stringify([{ label: "A", src: "/a.wav" }]));
		expect("items" in good).toBe(true);
		const bad = parseSourceList(JSON.stringify([{ label: "A", src: "java\tscript:alert(1)" }]));
		expect(bad).toEqual({ reason: "unsafe-src" });
	});
});

describe("unsafe fallback URL", () => {
	test("is treated as absent and the refusal is readable", () => {
		setEngineFactory(null);
		const controller = new PlayerController({ fallbackUrl: "java\tscript:alert(1)" });
		expect(controller.fallbackUrl).toBeNull();
		expect(controller.fallbackRefusal).toBe("unsafe-src");
		controller.dispose();
	});

	test("a safe fallback URL is kept and there is no refusal (positive control)", () => {
		setEngineFactory(null);
		const controller = new PlayerController({ fallbackUrl: "/audio/render.mp3" });
		expect(controller.fallbackUrl).toBe("/audio/render.mp3");
		expect(controller.fallbackRefusal).toBeNull();
		controller.dispose();
	});

	test("setFallbackUrl re-checks: unsafe then safe clears the refusal", () => {
		setEngineFactory(null);
		const controller = new PlayerController({});
		controller.setFallbackUrl("data:audio/wav;base64,AAAA");
		expect(controller.fallbackRefusal).toBe("unsafe-src");
		controller.setFallbackUrl("https://cdn.example.com/render.mp3");
		expect(controller.fallbackRefusal).toBeNull();
		expect(controller.fallbackUrl).toBe("https://cdn.example.com/render.mp3");
		controller.dispose();
	});
});

describe("the input module joins the shell's engine descriptors", () => {
	test("an InputChoice from the inputs module is assignable to InputChoiceDescriptor", () => {
		// Compile-time check: this file is typechecked by the player package's tsconfig, so a
		// drift between the two worktrees' shapes fails typecheck, not just this test.
		const wav: InputChoice = { kind: "wav", id: "di", label: "DI", src: "/di.wav" };
		const browser: InputChoice = { kind: "browser", id: "browser-audio", label: "Browser audio" };
		const asDescriptors: InputChoiceDescriptor[] = [wav, browser];
		expect(asDescriptors.map((d) => d.kind)).toEqual(["wav", "browser"]);
	});
});
