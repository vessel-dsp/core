// Contract for when the runtime is allowed to replay a compiled elimination order.
//
// **The failure this guards is a block that stops using its schedule and says nothing.** The
// pivot guard makes that safe -- a collapsed pivot sends the solve to the dense path and the
// audio stays correct -- which is exactly why it went unnoticed for as long as the schedule has
// shipped. The only symptom is cost, and cost was being read off the compiler's *intent*
// (`solverPlan()`'s path column) rather than off the runtime's behaviour.
//
// The specific rule below is that a DC pass does not touch the schedule. A DC matrix is not the
// transient matrix with different numbers in it: a capacitor contributes nothing to it at all,
// an inductor contributes a short, and gmin stepping walks the diagonal down from 1e-3. The
// order was chosen against the transient structure, so pivots it depends on are zero in DC,
// and the operating-point solve would otherwise spend the block's entire fallback allowance
// before the first sample is rendered. Measured on the shipping console 2026-09-18: six corpus
// packets were permanently dense for this reason, one of them at 12.8x real time. See
// `thoughts/shared/2026-09-18-sparse-schedule-runtime-audit.md`.

import { describe, expect, it } from "bun:test";
import { compile } from "@vessel-dsp/compiler";
import { emptyRegistry } from "@vessel-dsp/compiler";
import { pedalPartCatalog } from "@vessel-dsp/compiler";
import {
	cd4013LogicDivider,
	rcLadder,
} from "@vessel-dsp/compiler/fixtures/circuits";
import { ReferenceRuntime } from "../src/reference-runtime";

/**
 * Ten RC sections: the smallest fixture whose predicted saving clears the runtime's admission
 * floor, so it is the smallest one on which any of this is observable. See `rcLadder`.
 */
function ladderRuntime(): ReferenceRuntime {
	const result = compile(rcLadder(10), { registry: emptyRegistry });
	if (result.status !== "ok") {
		throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
	}
	const runtime = new ReferenceRuntime(result.program);
	runtime.prepare(48_000);
	return runtime;
}

function tone(samples: number): Float64Array {
	const input = new Float64Array(samples);
	for (let index = 0; index < samples; index += 1) {
		input[index] = 0.1 * Math.sin((2 * Math.PI * 1000 * index) / 48_000);
	}
	return input;
}

describe("static sparse schedule", () => {
	it("is not used by the DC operating-point solve", () => {
		const runtime = ladderRuntime();
		// An empty buffer runs the deferred operating point and renders no samples, which is the
		// only way to observe the DC pass on its own -- `prepare()` defers it and the first
		// `process()` would otherwise mix it with audio.
		runtime.process(new Float64Array(0));
		expect(runtime.solverPlan().scheduleSolves).toBe(0);
	});

	it("is used by the audio path, and survives it without a fallback", () => {
		const runtime = ladderRuntime();
		const plan = runtime.solverPlan();
		// Guards the test above against passing vacuously: a block that never takes the sparse
		// path at all would report zero DC solves for an uninteresting reason.
		expect(plan.blocks.some((block) => block.path === "sparse")).toBe(true);

		runtime.process(tone(2048));
		const after = runtime.solverPlan();
		expect(after.scheduleSolves).toBeGreaterThan(0);
		// A fallback is not a correctness failure; it is the solve paying for the schedule and
		// then for the dense solve on the same matrix. On a passive ladder there is no operating
		// point that can justify one.
		expect(after.scheduleFallbacks).toBe(0);
		expect(after.abandoned).toEqual([]);
	});
});

describe("operating-point pivot validation", () => {
	it("keeps a healthy order and reports its agreement", () => {
		const runtime = ladderRuntime();
		runtime.process(tone(2048));
		const plan = runtime.solverPlan();
		expect(plan.dropped).toEqual([]);
		const sparse = plan.blocks.filter((block) => block.path === "sparse");
		expect(sparse.length).toBeGreaterThan(0);
		for (const block of sparse) {
			expect(block.pivotDisagreement).not.toBeNull();
			expect(block.pivotDisagreement as number).toBeLessThanOrEqual(1e-3);
		}
	});

	it("validating changes nothing about the audio", () => {
		// The assembly probe calls `applyStamp`, which advances limiter
		// histories and divider state. If any of that leaked, the first audio
		// sample would warm-start from a different state and the render would
		// differ. Skipping the settle on an identical twin must therefore be
		// bit-identical.
		const first = ladderRuntime();
		const second = ladderRuntime();
		(second as unknown as { pivotOrdersSettled: boolean }).pivotOrdersSettled =
			true;
		const a = first.process(tone(2048));
		const b = second.process(tone(2048));
		expect(a).toEqual(b);
	});

	it("the probe never touches live solver state", () => {
		// The motivating case is a logic-divider: on a firing guard it toggles
		// Q and rewrites its clock memory inside `applyStamp` itself (capacitor
		// history lives in `advanceReactiveState` and cannot catch this). The
		// guard fires exactly once -- on the first stamp pass after prepare,
		// before any `process()` call -- so the probe must run there, against
		// sentinel state, to discriminate a live-state probe (which overwrites
		// the sentinels and marks the divider map) from a copied one. Verified
		// by running this test against the live-state variant and watching it
		// fail.
		const result = compile(cd4013LogicDivider, {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			throw new Error(`did not compile: ${JSON.stringify(result.reasons)}`);
		}
		const block = result.program.blocks.find(
			(candidate) =>
				candidate.kind === "mna" &&
				candidate.stamps.some((stamp) => stamp.kind === "logic-divider"),
		);
		if (block === undefined || block.kind !== "mna") {
			throw new Error("divider fixture should reach a logic-divider stamp");
		}
		const runtime = new ReferenceRuntime(result.program);
		runtime.prepare(48_000);
		const internals = runtime as unknown as {
			assembleAudioMatrix: (block: unknown) => unknown;
			capacitorState: Map<string, number[]>;
			lastShiftedSample: Map<string, number>;
		};
		const live = internals.capacitorState.get(block.id) as number[];
		for (let index = 0; index < live.length; index += 1) {
			live[index] = 999 + index;
		}
		const shiftedBefore = new Map(internals.lastShiftedSample);
		internals.assembleAudioMatrix(block);
		for (let index = 0; index < live.length; index += 1) {
			expect(live[index]).toBe(999 + index);
		}
		expect(internals.lastShiftedSample).toEqual(shiftedBefore);
	});

	it("settles once per prepare and recomputes after the next", () => {
		const runtime = ladderRuntime();
		runtime.process(tone(256));
		const first = runtime.solverPlan().dropped;
		runtime.process(tone(256));
		expect(runtime.solverPlan().dropped).toEqual(first);
		runtime.prepare(48_000);
		runtime.process(tone(256));
		expect(runtime.solverPlan().dropped).toEqual(first);
	});
});
