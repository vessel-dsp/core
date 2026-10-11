// What the format library hands the compiler for a declared GBP: the property's JS type and value, for every
// corpus document that declares one (the forms the units parser has to read).
import { readFileSync } from "node:fs";
import { parseInterchangeYamlWithTopology } from "@vessel-dsp/core";
import { corpusFiles } from "./lib";

const seen = new Map<string, number>();
for (const { slug, file } of corpusFiles()) {
	const text = readFileSync(file, "utf8");
	if (!/^\s*GBP:/m.test(text)) continue;
	const doc: any = (parseInterchangeYamlWithTopology as any)(text);
	const d = doc.document ?? doc;
	for (const c of d.components ?? []) {
		const v = c.properties?.GBP;
		if (v === undefined) continue;
		const form = `${typeof v}${typeof v === "object" ? `{${Object.keys(v).join(",")}}` : ""} ${JSON.stringify(v)}  [kind=${c.kind}]`;
		seen.set(form, (seen.get(form) ?? 0) + 1);
	}
}
for (const [k, n] of [...seen].sort()) console.log(String(n).padStart(3), k);
