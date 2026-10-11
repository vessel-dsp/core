// Where does mxr-blue-box's x1 iteration count come from? Per-second iterations per host sample, the share of samples at each iteration count, and the iteration cost by
// stimulus (1 kHz 10 mV, 1 kHz 100 mV, two-tone), TS console, one-sample process calls, from whichever tree this is run in.
//   bun docs/spikes/pole-order2/bluebox-detail.ts [--slug=blue-box] [--os=1] [--seconds=2]
import { ReferenceRuntime } from "@vessel-dsp/runtime";
import { PACKETS, arg, compileFile, fileForSlug, sine } from "./lib";
const slug = arg("slug", "blue-box"), os = Number(arg("os", "1")), seconds = Number(arg("seconds", "2"));
const program = compileFile(PACKETS[slug]?.file ?? fileForSlug(slug));
const N = 48000 * seconds;
const two = Float64Array.from({ length: N }, (_, i) => 0.25 * Math.sin((2 * Math.PI * 440 * i) / 48000) + 0.1 * Math.sin((2 * Math.PI * 1320 * i) / 48000));
for (const [label, input] of [["1kHz 10mV", sine(N, 1000, 0.01)], ["1kHz 100mV", sine(N, 1000, 0.1)], ["two-tone", two]] as Array<[string, Float64Array]>) {
	const rt = new ReferenceRuntime(program);
	rt.prepare(48000, { maxNewtonIterations: 1024, ...(os > 1 ? { oversample: os } : {}) });
	const chunk = new Float64Array(1);
	const hist = new Map<number, number>(), perSec: number[] = [];
	let last = 0, secStart = 0;
	for (let i = 0; i < N; i += 1) {
		chunk[0] = input[i] as number; rt.process(chunk);
		const t = rt.telemetry().totalIterations, d = t - last; last = t;
		hist.set(d, (hist.get(d) ?? 0) + 1);
		if ((i + 1) % 48000 === 0) { perSec.push((t - secStart) / 48000); secStart = t; }
	}
	const tel = rt.telemetry();
	const buckets = [...hist].sort((a, b) => a[0] - b[0]);
	const pct = (lo: number, hi: number) => (100 * buckets.filter(([k]) => k >= lo && k <= hi).reduce((s, [, n]) => s + n, 0)) / N;
	console.log(`${slug} x${os} ${label.padEnd(10)}: it/host ${(tel.totalIterations / N).toFixed(3)} peak ${tel.peakIterations} NC ${tel.nonConvergedSamples} | per second ${perSec.map((v) => v.toFixed(2)).join(" ")} | samples at 1-3 it ${pct(1, 3).toFixed(1)}% 4-6 ${pct(4, 6).toFixed(1)}% 7-12 ${pct(7, 12).toFixed(1)}% 13-50 ${pct(13, 50).toFixed(1)}% >50 ${pct(51, 1e9).toFixed(2)}%`);
}
