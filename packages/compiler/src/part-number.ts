/**
 * Manufacturer ordering code -> canonical die identifier.
 *
 * **Why this exists.** `boss-rv-6` declares `UPD800402GJ-211` and `boss-st-2` declares
 * `uPD800402GJ-211-UEN-A(ESC)`. **Same silicon.** Neither matches the catalog's
 * `UPD800402GJ-211-UEN-A` exactly, so both fell through to `declaredType` — and because the two
 * packets declare *different* classes, one got a bucket-brigade macro and the other got nothing.
 * A package suffix decided whether a pedal received a DSP model.
 *
 * **The rules are deliberately narrow and the alias table is the safety valve.** A normaliser that
 * guesses aggressively merges parts that differ, which is worse than the problem it solves: a
 * missed match is a diagnosable refusal, a wrong match is silent and executes. So the rules handle
 * only what is mechanically unambiguous, and everything else is an explicit alias with the two
 * codes written out where a reader can judge them.
 */

/** Suffixes that are packaging, tape/reel or grade markings rather than die identity. */
const GRADE_SUFFIXES: readonly string[] = [
	"-UEN-A",
	"-TR",
	"-T2",
	"-T13",
	"-WE2",
	"-RMN6TP",
	"-B2",
	"-B01",
	"-VS",
	"-E2",
	"-JAP",
];

/**
 * Explicit die-identity aliases. **Each entry is a claim that two ordering codes are the same
 * die**, and it is written here rather than inferred so that it can be reviewed and cited.
 */
const ALIASES: ReadonlyMap<string, string> = new Map([
	["UPD4013C1", "UPD4013"],
	["UPD4013C6", "UPD4013"],
	["UPD4013C", "UPD4013"],
]);

/**
 * Case-folded, whitespace-free, with trailing parenthesised markings and known grade suffixes
 * removed, then run through the alias table.
 *
 * **Parenthesised groups are always trailing markings** in this corpus -- `(ESC)`, `(MR3)`,
 * `(TE85L/F)`, `(T)` -- never part of the die identity, which is why that one rule is general
 * while the suffix rule is a fixed vocabulary.
 */
export function canonicalPartId(raw: string): string {
	let s = raw.toUpperCase().replace(/\s+/gu, "");
	// leading vendor lower-case `u` for micro (uPD -> UPD) is already handled by the upper-case.
	let changed = true;
	while (changed) {
		changed = false;
		const withoutParens = s.replace(/\([^()]*\)$/u, "");
		if (withoutParens !== s) {
			s = withoutParens;
			changed = true;
		}
		for (const suffix of GRADE_SUFFIXES) {
			if (s.length > suffix.length && s.endsWith(suffix)) {
				s = s.slice(0, -suffix.length);
				changed = true;
				break;
			}
		}
	}
	return ALIASES.get(s) ?? s;
}

/**
 * Do two ordering codes name the same die? **Not symmetric-by-accident**: one code being a strict
 * prefix of the other is NOT treated as a match, because `M5K4164` and `M5K4164ANL` differ by a
 * package code that this table has not been told about, and guessing there is the failure mode
 * above.
 */
export function samePart(a: string, b: string): boolean {
	return canonicalPartId(a) === canonicalPartId(b);
}
