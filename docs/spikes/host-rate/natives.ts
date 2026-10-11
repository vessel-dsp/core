// Native references: the same program through `ChainRuntime` rendered at the rate itself (no resampler, no worklet),
// 10 mV sine from t=0, controls set after prepare, 2.0 s, the probe fit over 0.9-1.7 s, DAC scale applied.
//
//   bun docs/spikes/host-rate/natives.ts --pedal=muff [--hz=...] [--rates=48000,96000,192000,384000,768000] --cache=<json>
//
// One process per pedal, one cache file per process (a cache entry is the fundamental in volts at the DAC). Rates run in
// ascending order so partial results are usable; a frequency at or above rate/2 is skipped (not representable).
import { arg, nativeFundamental, ts } from "./lib";

const pedal = arg("pedal", "muff");
const hzs = arg("hz", "1000,4000,8000,12500,16000,20000,30000").split(",").map(Number);
const rates = arg("rates", "48000,96000,192000,384000,768000").split(",").map(Number);
const cache = arg("cache", `${process.cwd()}/natives-${pedal}.json`);
const mv = Number(arg("mv", "10"));
console.log(`natives: ${ts()} pedal=${pedal} hz=${hzs.join(",")} rates=${rates.join(",")} cache=${cache}`);
for (const rate of rates) {
	for (const hz of hzs) {
		if (hz >= rate / 2) continue;
		const t0 = performance.now();
		const fund = nativeFundamental(pedal, hz, mv, rate, cache);
		console.log(`${ts()} ${pedal} ${String(hz).padStart(5)} Hz native ${String(rate).padStart(6)}: fundamental ${(fund * 1e3).toFixed(6)} mV at the DAC (${Math.round((performance.now() - t0) / 1000)} s)`);
	}
}
console.log(`natives: done ${ts()}`);
