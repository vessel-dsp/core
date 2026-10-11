// Compare two exported program directories (baseline vs new). A document is "identical modulo the field" when the new
// text, with every `"gainBandwidthHz":<null|number>,` member removed, equals the baseline text byte for byte. Anything
// else is a compile change beyond the field and is listed. Also reports, per document, the stamps' stated products and
// the warning-code difference.   bun docs/spikes/opamp-gbw/corpus-program-diff.ts <baseDir> <newDir>
import { existsSync, readFileSync, readdirSync } from "node:fs";

const [base, next] = process.argv.slice(2) as [string, string];
const slugs = readdirSync(base).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => f.replace(/\.json$/, ""));
const strip = (text: string) => text.replace(/"gainBandwidthHz":(?:null|[0-9.eE+-]+),/g, "");
let same = 0, differ: string[] = [], missing: string[] = [], withField = 0, stated = 0, nulls = 0;
for (const slug of slugs) {
	if (!existsSync(`${next}/${slug}.json`)) { missing.push(slug); continue; }
	const a = readFileSync(`${base}/${slug}.json`, "utf8"), b = readFileSync(`${next}/${slug}.json`, "utf8");
	const fields = [...b.matchAll(/"gainBandwidthHz":(null|[0-9.eE+-]+),/g)];
	if (fields.length > 0) withField += 1;
	for (const m of fields) (m[1] === "null" ? nulls++ : stated++);
	if (strip(b) === a) same += 1; else differ.push(slug);
}
console.log(`documents compared: ${slugs.length}; identical to baseline once the new member is removed: ${same}; differ beyond the field: ${differ.length}; missing in new: ${missing.length}`);
console.log(`documents carrying at least one op-amp stamp: ${withField}; stamps stating a product: ${stated}; stamps null: ${nulls}`);
if (differ.length > 0) console.log(`DIFFER: ${differ.join(", ")}`);
const wa = JSON.parse(readFileSync(`${base}/_warnings.json`, "utf8")) as Record<string, string[]>, wb = JSON.parse(readFileSync(`${next}/_warnings.json`, "utf8")) as Record<string, string[]>;
let added = 0, otherWarn: string[] = [];
for (const slug of slugs) {
	const A = [...(wa[slug] ?? [])].sort(), B = [...(wb[slug] ?? [])].sort();
	const Bn = B.filter((c) => c !== "opamp-gain-bandwidth-default");
	if (B.length !== Bn.length) added += 1;
	if (JSON.stringify(A) !== JSON.stringify(Bn)) otherWarn.push(slug);
}
console.log(`documents gaining opamp-gain-bandwidth-default: ${added}; documents whose OTHER warning codes changed: ${otherWarn.length}${otherWarn.length ? " -> " + otherWarn.join(", ") : ""}`);
