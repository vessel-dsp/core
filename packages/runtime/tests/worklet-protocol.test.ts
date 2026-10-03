// Unit tests for the worklet message contract's DOM-free parts.
//
// The processor itself runs only inside an AudioWorkletGlobalScope, so it is
// proven by `scripts/worklet-proof.ts` in a real browser, never here. What this
// file pins is the host-side surface every bundler consumer touches: the
// processor name `addModule` registers, and the type-checked post wrapper that
// exists so a stale message shape fails the build instead of going quiet on the
// audio thread.

import { describe, expect, it } from "bun:test";
import { compile, emptyRegistry } from "@vessel-dsp/compiler";
import { resistorDivider } from "@vessel-dsp/compiler/fixtures/circuits";
import {
	postV2WorkletMessage,
	v2WorkletProcessorName,
	type V2WorkletInboundMessage,
	type V2WorkletPort,
	type V2WorkletSlot,
} from "../src/index";

function fakePort(): { seen: V2WorkletInboundMessage[]; port: V2WorkletPort } {
	const seen: V2WorkletInboundMessage[] = [];
	return {
		seen,
		port: {
			postMessage(message: V2WorkletInboundMessage): void {
				seen.push(message);
			},
		},
	};
}

describe("v2 worklet protocol host surface", () => {
	it("advertises the processor name the bundle registers", () => {
		expect(v2WorkletProcessorName).toBe("v2-pedal-processor");
	});

	it("posts a program load carrying a real compiled program untouched", () => {
		const compiled = compile(resistorDivider, { registry: emptyRegistry });
		if (compiled.status !== "ok") {
			throw new Error(`fixture did not compile: ${JSON.stringify(compiled.reasons)}`);
		}
		const slots: readonly V2WorkletSlot[] = [{ kind: "program", program: compiled.program }];
		const message: V2WorkletInboundMessage = {
			type: "load",
			slots,
			wasmConsole: { wasmBytes: new ArrayBuffer(8) },
		};
		const { seen, port } = fakePort();
		postV2WorkletMessage(port, message);
		expect(seen).toHaveLength(1);
		// Identity, not equality: the helper must forward, never reshape or clone.
		expect(seen[0]).toBe(message);
		const slot = seen[0]?.type === "load" ? seen[0].slots[0] : undefined;
		expect(slot?.kind).toBe("program");
	});

	it("forwards setControl by slot and id without reinterpretation", () => {
		const message: V2WorkletInboundMessage = {
			type: "setControl",
			slot: 2,
			id: "Level",
			position: 0.75,
		};
		const { seen, port } = fakePort();
		postV2WorkletMessage(port, message);
		expect(seen[0]).toBe(message);
	});

	it("forwards setBypassMode without reinterpretation", () => {
		const message: V2WorkletInboundMessage = { type: "setBypassMode", slot: 0, mode: "wire" };
		const { seen, port } = fakePort();
		postV2WorkletMessage(port, message);
		expect(seen[0]).toBe(message);
	});
});
