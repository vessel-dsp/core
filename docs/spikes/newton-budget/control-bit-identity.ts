// Control (e): with M1-M3 all disabled the scratch loop's output must hash identical to the
// shipped loop's. Six profile packets, x1 and os4, cap 64, 2400+9600 host samples (the
// measurement window), study controls for muff/sd1/ts9. Both loops run in this process:
// `uninstall()` restores the shipped prototype methods, `install()` swaps the copies in.
import { PACKETS, arg, compileFile, tone } from "./lib";
import { runPacket } from "./measure";

const factors = arg("os", "1,4").split(",").map(Number);
const CAP = Number(arg("cap", "64"));
const warm = tone(2400);
const sig = tone(9600, 0.1, 1000, 48000, 2400);
let fails = 0;
for (const [slug, spec] of Object.entries(PACKETS)) {
	const program = compileFile(spec.file);
	for (const os of factors) {
		const shipped = runPacket(program, spec.controls, os, CAP, warm, sig, null);
		const copy = runPacket(program, spec.controls, os, CAP, warm, sig, {});
		const same = shipped.hash === copy.hash;
		if (!same) fails += 1;
		console.log(`${slug.padEnd(9)} os=${os} shipped=${shipped.hash.slice(0, 16)} scratch=${copy.hash.slice(0, 16)} ${same ? "IDENTICAL" : "DIFFERENT"} it/host shipped=${shipped.meanHost.toFixed(3)} scratch=${copy.meanHost.toFixed(3)} NC ${shipped.nc}/${copy.nc} scratchCounters it=${copy.counters.iterations} fac=${copy.counters.factorisations} asm=${copy.counters.assembles}`);
	}
}
console.log(`\nbit-identity: ${fails === 0 ? "PASS" : `FAIL (${fails} rows differ)`}`);
