// Batch driver: cache dense refs, tau-sweep, and dense-cap probe for a packet
// set, sequentially, appending to per-packet logs. Run in background:
//   nohup bun docs/spikes/sparse-pivot/batch-mismatch.ts > batch.log 2>&1 &
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR } from "./lib";

const PEDALS = [
	"boss-ch-1",
	"boss-dd-3a",
	"boss-dd-3b",
	"boss-ds-2",
	"boss-hm-2",
	"boss-lm-2",
	"boss-mt-2",
	"boss-od-3",
	"boss-os-2",
	"boss-sd-1",
	"boss-tw-1",
	"electro-harmonix-small-stone",
	"ibanez-ts9-reissue",
	"jhs-morning-glory",
	"marshall-blues-breaker",
	"mxr-blue-box",
	"trainwreck-dummy",
];
const AMPS = [
	"dumble-overdrive-special",
	"hiwatt-dr103",
	"marshall-1959-super-lead-plexi",
	"trainwreck-express",
];

async function sh(cmd: string): Promise<void> {
	console.log(`$ ${cmd}`);
	const proc = Bun.spawn(["bash", "-c", cmd], {
		stdout: "inherit",
		stderr: "inherit",
	});
	await proc.exited;
}

for (const packet of [...PEDALS.filter((p) => p !== "trainwreck-dummy"), "boss-aw-2"]) {
	if (!existsSync(join(CACHE_DIR, `${packet}.f64`))) {
		await sh(`bun docs/spikes/sparse-pivot/tau-cache-dense.ts --packet=${packet}`);
	}
}
for (const packet of AMPS) {
	if (!existsSync(join(CACHE_DIR, `${packet}.f64`))) {
		await sh(`bun docs/spikes/sparse-pivot/tau-cache-dense.ts --amps --packet=${packet}`);
	}
}
const SWEEP_PEDALS = [
	"boss-aw-2", "boss-ch-1", "boss-dd-3a", "boss-dd-3b", "boss-ds-2",
	"boss-hm-2", "boss-lm-2", "boss-mt-2", "boss-od-3", "boss-os-2",
	"boss-sd-1", "boss-tw-1", "electro-harmonix-small-stone", "mxr-blue-box",
];
for (const packet of SWEEP_PEDALS) {
	await sh(
		`bun docs/spikes/sparse-pivot/tau-sweep2.ts --packet=${packet} --min-size=30 > docs/spikes/sparse-pivot/sweep-${packet}.log 2>&1`,
	);
}
for (const packet of AMPS) {
	await sh(
		`bun docs/spikes/sparse-pivot/tau-sweep2.ts --amps --packet=${packet} --min-size=30 > docs/spikes/sparse-pivot/sweep-${packet}.log 2>&1`,
	);
}
const PROBE_PEDALS = [...SWEEP_PEDALS, "boss-tr-2"];
const PROBE_AMPS = [...AMPS, "marshall-jcm800"];
for (const packet of PROBE_PEDALS) {
	await sh(`bun docs/spikes/sparse-pivot/dense-cap-probe.ts --packet=${packet}`);
}
for (const packet of PROBE_AMPS) {
	await sh(`bun docs/spikes/sparse-pivot/dense-cap-probe.ts --amps --packet=${packet}`);
}
console.log("batch complete");
