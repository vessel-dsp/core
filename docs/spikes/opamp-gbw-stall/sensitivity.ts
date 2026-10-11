// Is a console divergence a decision mismatch or the circuit amplifying rounding? Render the same packet twice on the
// TS console alone, the second time with one input sample perturbed by --eps (default 1e-12 V), and print how the
// two renders separate. A circuit that turns 1e-12 into 1e-2 within a few hundred samples will separate two consoles
// that differ by libm ulps whatever the solver does.
//   bun docs/spikes/opamp-gbw-stall/sensitivity.ts --packet=blue-box --os=4 [--n=2148] [--at=100] [--eps=1e-12] [--force-gbp=null]
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { arg, controlsFor, forceGbp, hostInput, programFor } from "./lib";
const slug = arg("packet", "blue-box"), os = Number(arg("os", "4")), n = Number(arg("n", "2148")), at = Number(arg("at", "100")), eps = Number(arg("eps", "1e-12"));
const program = forceGbp(programFor(slug), arg("force-gbp", ""));
const input = hostInput(n, "twotone", 1000, 0.1);
const render = (perturb: boolean) => {
	const rt = new ReferenceRuntime(program);
	rt.prepare(48000, { maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
	for (const [k, v] of Object.entries(controlsFor(slug))) rt.setControl(k, v);
	const x = Float64Array.from(input); if (perturb) x[at] = (x[at] as number) + eps;
	const out = new Float64Array(n);
	for (let i = 0; i < n; i += 1) out[i] = rt.process(x.subarray(i, i + 1))[0] as number;
	return { out, nc: rt.telemetry().nonConvergedSamples, peak: rt.telemetry().peakIterations };
};
const a = render(false), b = render(true);
let maxDiff = 0, firstOver = -1;
const marks = [1e-9, 1e-6, 1e-3, 1e-2]; const reached: Record<string, number> = {};
for (let i = 0; i < n; i += 1) {
	const d = Math.abs((a.out[i] as number) - (b.out[i] as number)); maxDiff = Math.max(maxDiff, d);
	for (const m of marks) if (d > m && reached[String(m)] === undefined) reached[String(m)] = i;
	if (firstOver < 0 && d > 1e-4) firstOver = i;
}
console.log(`${slug} os${os}${arg("force-gbp", "") ? ` force-gbp=${arg("force-gbp", "")}` : ""}: input perturbed by ${eps} V at sample ${at}; TS-vs-TS max |diff| ${maxDiff.toExponential(2)}, first over 1e-4 at sample ${firstOver}, thresholds reached at ${JSON.stringify(reached)}; nc ${a.nc}/${b.nc} peaks ${a.peak}/${b.peak}`);
