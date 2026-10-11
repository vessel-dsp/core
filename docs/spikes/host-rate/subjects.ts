// What the cost and block instruments render: the linear divider (the overhead probe: no Newton iterations, so any fixed
// per-host-sample or per-quantum cost shows there), the three pedals, and the three-pedal chain Muff + SD-1 + TS-9.
import { controlMessages, loadDivider, loadPedal, type Slot } from "./lib";

export type Subject = { name: string; slots: Slot[]; controls: { slot: number; id: string; position: number }[] };
export const SUBJECTS: Record<string, () => Subject> = {
	divider: () => ({ name: "divider", slots: [{ kind: "program", program: loadDivider().json }], controls: [] }),
	muff: () => ({ name: "muff", slots: [{ kind: "program", program: loadPedal("muff").json }], controls: controlMessages("muff") }),
	sd1: () => ({ name: "sd1", slots: [{ kind: "program", program: loadPedal("sd1").json }], controls: controlMessages("sd1") }),
	ts9: () => ({ name: "ts9", slots: [{ kind: "program", program: loadPedal("ts9").json }], controls: controlMessages("ts9") }),
	chain3: () => ({
		name: "chain3",
		slots: ["muff", "sd1", "ts9"].map((n) => ({ kind: "program" as const, program: loadPedal(n).json })),
		controls: ["muff", "sd1", "ts9"].flatMap((n, i) => controlMessages(n, i)),
	}),
};
