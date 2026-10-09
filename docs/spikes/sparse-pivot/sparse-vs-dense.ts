// Baseline: sparse-vs-dense instrument for the numeric-pivot task.
//
// Read-only against the artifact corpus: compiles each .vdsp, renders a warmup
// + measured window of 1 kHz @ 0.1 V through the ReferenceRuntime twice (as
// shipped = sparse path, and forced-dense by nulling every block's schedule),
// and reports per packet:
//   sparse vs dense output relative RMS, convergence, iteration census,
//   solver-plan pivot diagnostics (worst ratio, disagreement, repivoted,
//   dropped), schedule solves/fallbacks/abandoned, in-process ns/sample + xRT.
//
// Harness/window/controls are printed with every figure in the report; dense
// agreement proves consistency, not circuit truth.
//
// Usage:
//   bun docs/spikes/sparse-pivot/sparse-vs-dense.ts [--amps] [--packet=a,b]
//       [--warmup=2400] [--samples=9600] [--out=path.jsonl]
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { compile, pedalPartCatalog } from "@vessel-dsp/compiler";
import { ReferenceRuntime } from "@vessel-dsp/runtime";

const ARTIFACT_CORPUS = "/home/joseph/projects/VesselDSP/artifacts/schematics/vessel-dsp";
const BUDGET_NS = 20_833;

function arg(name: string, fallback: string): string {
	const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
	return hit === undefined ? fallback : hit.slice(name.length + 3);
}
function flag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

const includeAmps = flag("amps");
const onlyPackets = arg("packet", "");
const only = new Set(
	onlyPackets === "" ? [] : onlyPackets.split(",").map((s) => s.trim()),
);
const WARMUP = Number(arg("warmup", "2400"));
const SAMPLES = Number(arg("samples", "9600"));
const OUT = arg("out", "");

type PacketRow = {
	packet: string;
	compile: "ok" | "fail" | "prepare-fail" | "process-fail";
	maxSparseSize: number;
	blocks: {
		blockId: string;
		size: number;
		path: string;
		repivoted: boolean;
		sparseOps: number;
		denseOps: number;
		slots: number;
		unprovenPivots: number;
		worstPivotRatio: number | null;
		pivotViolations: number;
		pivotDisagreement: number | null;
	}[] | null;
	dropped: readonly string[];
	repivoted: readonly string[];
	abandoned: readonly string[];
	scheduleSolves: number;
	scheduleFallbacks: number;
	relRms: number | null;
	absRmsDiff: number | null;
	denseRms: number | null;
	sparseNonConverged: number;
	denseNonConverged: number;
	sparseWarmNonConverged: number;
	denseWarmNonConverged: number;
	sparsePeakIter: number;
	densePeakIter: number;
	sparseMeanIter: number;
	denseMeanIter: number;
	sparseNsPerSample: number;
	denseNsPerSample: number;
	note: string;
};

function listCorpus(): string[] {
	if (includeAmps) {
		const { readdirSync } = require("node:fs") as typeof import("node:fs");
		return readdirSync(join(ARTIFACT_CORPUS, "amps"))
			.filter((f) => f.endsWith(".vdsp"))
			.sort()
			.map((f) => join(ARTIFACT_CORPUS, "amps", f));
	}
	const { readdirSync } = require("node:fs") as typeof import("node:fs");
	return readdirSync(ARTIFACT_CORPUS)
		.filter((f) => f.endsWith(".vdsp"))
		.sort()
		.map((f) => join(ARTIFACT_CORPUS, f));
}

function tone(n: number): Float64Array {
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) {
		out[i] = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000);
	}
	return out;
}

function runOnce(
	program: unknown,
	warmup: Float64Array,
	signal: Float64Array,
): {
	output: Float64Array;
	nsPerSample: number;
	telemetry: {
		nonConverged: number;
		warmNonConverged: number;
		peakIter: number;
		totalIter: number;
		samples: number;
	};
	plan: {
		blocks: PacketRow["blocks"];
		dropped: string[];
		repivoted: string[];
		abandoned: string[];
		solves: number;
		fallbacks: number;
	};
} {
	const runtime = new ReferenceRuntime(
		program as ConstructorParameters<typeof ReferenceRuntime>[0],
	);
	// Audit harness parity: cap 64 (the shipping default is 1024; the audit's
	// iteration figures and the worklet budget both assume 64).
	runtime.prepare(48000, { maxNewtonIterations: 64 });
	runtime.process(warmup);
	const tWarm = runtime.telemetry();
	const start = process.hrtime.bigint();
	const output = runtime.process(signal);
	const end = process.hrtime.bigint();
	const t1 = runtime.telemetry();
	const plan = runtime.solverPlan();
	const nsPerSample = Number(end - start) / signal.length;
	return {
		output: Float64Array.from(output),
		nsPerSample,
		telemetry: {
			nonConverged: t1.nonConvergedSamples - tWarm.nonConvergedSamples,
			warmNonConverged: tWarm.nonConvergedSamples,
			peakIter: t1.peakIterations,
			totalIter: t1.totalIterations - tWarm.totalIterations,
			samples: t1.samples - tWarm.samples,
		},
		plan: {
			blocks: plan.blocks.map((b) => ({
				blockId: b.blockId,
				size: b.size,
				path: b.path,
				repivoted: b.repivoted,
				sparseOps: b.sparseOps,
				denseOps: b.denseOps,
				slots: b.patternEntries,
				unprovenPivots: b.unprovenPivots,
				worstPivotRatio: b.worstPivotRatio,
				pivotViolations: b.pivotViolations,
				pivotDisagreement: b.pivotDisagreement,
			})),
			dropped: [...plan.dropped],
			repivoted: [...plan.repivoted],
			abandoned: [...plan.abandoned],
			solves: plan.scheduleSolves,
			fallbacks: plan.scheduleFallbacks,
		},
	};
}

const warmupSignal = tone(WARMUP);
const signal = tone(SAMPLES);
const rows: PacketRow[] = [];

for (const file of listCorpus()) {
	const packet = basename(file, ".vdsp");
	if (only.size > 0 && !only.has(packet)) continue;
	const row: PacketRow = {
		packet,
		compile: "ok",
		maxSparseSize: 0,
		blocks: null,
		dropped: [],
		repivoted: [],
		abandoned: [],
		scheduleSolves: 0,
		scheduleFallbacks: 0,
		relRms: null,
		absRmsDiff: null,
		denseRms: null,
		sparseNonConverged: 0,
		denseNonConverged: 0,
		sparseWarmNonConverged: 0,
		denseWarmNonConverged: 0,
		sparsePeakIter: 0,
		densePeakIter: 0,
		sparseMeanIter: 0,
		denseMeanIter: 0,
		sparseNsPerSample: 0,
		denseNsPerSample: 0,
		note: "",
	};
	try {
		const result = compile(readFileSync(file, "utf8"), {
			registry: pedalPartCatalog,
		});
		if (result.status !== "ok") {
			row.compile = "fail";
			row.note = `compile status ${result.status}`;
			rows.push(row);
			continue;
		}
		let sparse: ReturnType<typeof runOnce>;
		try {
			sparse = runOnce(result.program, warmupSignal, signal);
		} catch (error) {
			row.compile = "process-fail";
			row.note = `sparse run threw: ${String(error).slice(0, 200)}`;
			rows.push(row);
			continue;
		}
		// Forced-dense control: same program, every block's schedule nulled.
		const denseProgram = structuredClone(result.program) as {
			blocks: { kind: string; sparseSchedule: unknown }[];
		};
		for (const block of denseProgram.blocks) {
			if (block.kind === "mna") block.sparseSchedule = null;
		}
		let dense: ReturnType<typeof runOnce>;
		try {
			dense = runOnce(denseProgram, warmupSignal, signal);
		} catch (error) {
			row.compile = "process-fail";
			row.note = `dense run threw: ${String(error).slice(0, 200)}`;
			rows.push(row);
			continue;
		}
		let diff2 = 0;
		let dense2 = 0;
		for (let i = 0; i < SAMPLES; i += 1) {
			const d = (sparse.output[i] as number) - (dense.output[i] as number);
			diff2 += d * d;
			dense2 += (dense.output[i] as number) ** 2;
		}
		const denseNorm = Math.sqrt(dense2 / SAMPLES);
		const absDiff = Math.sqrt(diff2 / SAMPLES);
		row.absRmsDiff = absDiff;
		row.denseRms = denseNorm;
		row.relRms = denseNorm > 1e-12 ? absDiff / denseNorm : absDiff;
		if (denseNorm <= 1e-12) row.note = "dense output near-silent; relRms is absolute";
		row.blocks = sparse.plan.blocks;
		row.maxSparseSize = Math.max(
			0,
			...(sparse.plan.blocks ?? [])
				.filter((b) => b.path === "sparse")
				.map((b) => b.size),
		);
		row.dropped = sparse.plan.dropped;
		row.repivoted = sparse.plan.repivoted;
		row.abandoned = sparse.plan.abandoned;
		row.scheduleSolves = sparse.plan.solves;
		row.scheduleFallbacks = sparse.plan.fallbacks;
		row.sparseNonConverged = sparse.telemetry.nonConverged;
		row.denseNonConverged = dense.telemetry.nonConverged;
		row.sparseWarmNonConverged = sparse.telemetry.warmNonConverged;
		row.denseWarmNonConverged = dense.telemetry.warmNonConverged;
		row.sparsePeakIter = sparse.telemetry.peakIter;
		row.densePeakIter = dense.telemetry.peakIter;
		row.sparseMeanIter =
			sparse.telemetry.samples > 0
				? sparse.telemetry.totalIter / sparse.telemetry.samples
				: 0;
		row.denseMeanIter =
			dense.telemetry.samples > 0
				? dense.telemetry.totalIter / dense.telemetry.samples
				: 0;
		row.sparseNsPerSample = sparse.nsPerSample;
		row.denseNsPerSample = dense.nsPerSample;
	} catch (error) {
		row.compile = "prepare-fail";
		row.note = String(error).slice(0, 200);
	}
	rows.push(row);
	const worst = row.relRms === null ? "n/a" : row.relRms.toExponential(1);
	console.log(
		`${row.packet.padEnd(34)} compile=${row.compile.padEnd(12)} ` +
			`n=${String(row.maxSparseSize).padStart(3)} relRms=${worst.padStart(8)} ` +
			`sNC=${String(row.sparseNonConverged).padStart(5)}/${SAMPLES} dNC=${String(row.denseNonConverged).padStart(5)} ` +
			`wNC=${row.sparseWarmNonConverged}/${row.denseWarmNonConverged} ` +
			`sMean=${row.sparseMeanIter.toFixed(1).padStart(5)} dMean=${row.denseMeanIter.toFixed(1).padStart(5)} ` +
			`sxRT=${(row.sparseNsPerSample / BUDGET_NS).toFixed(2).padStart(6)} ` +
			`fb=${row.scheduleFallbacks}/${row.scheduleSolves} ` +
			`drop=[${row.dropped.join(",")}] repiv=[${row.repivoted.join(",")}] aband=[${row.abandoned.join(",")}] ${row.note}`,
	);
	if (OUT !== "") appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}

if (OUT === "") {
	const mismatched = rows.filter(
		(r) => r.relRms !== null && r.relRms > 1e-9,
	);
	console.log(
		`\npackets=${rows.length} mismatched(>1e-9)=${mismatched.length} ` +
			`[${mismatched.map((r) => `${r.packet}=${r.relRms?.toExponential(1)}`).join(" ")}]`,
	);
} else {
	console.log(`\nwrote ${rows.length} rows to ${OUT}`);
}
