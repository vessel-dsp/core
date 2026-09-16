/**
 * **A declared proxy: a macro that stands in for a part it is not.**
 *
 * `RDD63H101` is a 144-pin microcode-driven digital delay processor bound to
 * `bucket-brigade-delay-line` — an analog charge-transfer model. That binding may well be the right
 * engineering call: removing it makes `boss-dd-2` and `boss-dsd-3` silent, which **trades a stated
 * approximation for an unstated absence** and destroys information. What is wrong today is not the
 * binding; it is that **nothing in the catalog says it is a stand-in**, so it reads as an identity
 * claim, and the packets' own records say that chip's microcode is unavailable.
 *
 * **This is format item 8's shape, one level up.** The author knew the macro was an approximation
 * and had nowhere to say so, so they wrote the only thing the format allowed: a binding that
 * asserts identity. **Every required assertion with no "approximate, because" option manufactures
 * a false claim**, and the coping strategies are the same three — overstate it, omit it and lose
 * the reason, or write prose beside it.
 *
 * **Why this is a separate construct from item 8's reason field, since the unification was asked
 * for.** They share the principle and not the payload. An absent part number needs a reason a
 * *consumer* can branch on — unknown, excluded, not-applicable — and nothing more. A proxy needs
 * three things a *fidelity* query must be able to read separately, and merging them into one
 * free-text annotation would lose exactly the field that does the work: `doesNotReproduce`. **One
 * generic "declared inexactness" bag would be uncheckable, which is the property both constructs
 * exist to provide.** They belong in one format package and not in one field.
 */
/**
 * **A thing the model fails to reproduce, written so it can be RUN.**
 *
 * The test: *could someone who has never read this declaration run it and get a number that either
 * agrees or does not?* — *"does not reproduce the microcode's modulation behaviour"* fails that;
 * *"delay time does not track the clock, measured as time-of-first-energy"* passes it.
 *
 * **This is the falsifier, and it is the reason a declaration is not paperwork.** Each entry
 * becomes the **acceptance row for the real block** when someone finally writes it: the measurement
 * is already chosen, the expected value of the stand-in is already recorded, and a real model has
 * to move that number. A prose sentence here gives the next person nothing to run.
 */
export type Measurable = {
	/** What is not reproduced. */
	readonly claim: string;
	/** How to measure it, in terms someone who has not read this could execute. */
	readonly measurement: string;
	/** What THIS model yields for that measurement -- the number a real block must move. */
	readonly standIn: string;
	/**
	 * **`registered-unrun` is a PRE-REGISTRATION WITHOUT A FIXTURE, and it is not the same thing as
	 * a refuted claim.** Nine `subsumes` claims were withdrawn on 2026-09-11 because they were shown
	 * **false**; a well-formed measurable that no packet can currently run is **unrun**, which is a
	 * different state. Deleting it destroys the evidence that the claim was stated *before* any
	 * measurement — and pre-registration is the thing this method exists to make valuable.
	 *
	 * **What it must never do is look like it ran, or count toward anything measured.**
	 */
	readonly status: "measured" | "registered-unrun";
	/** `registered-unrun` only: what fixture would run it. Required, so the claim names its own cure. */
	readonly fixture?: string;
	/** `registered-unrun` only: withdraw if no fixture exists by this date. A registration with no expiry is a permanent excuse. */
	readonly expires?: string;
};

export type ProxyDeclaration = {
	/** The real part and what it actually is — not what the macro models. */
	readonly standsFor: string;
	/** Why the stand-in is defensible at all, in terms a reviewer can disagree with. */
	readonly justification: string;
	/**
	 * **What the proxy does NOT reproduce. Required, and required to be non-empty.**
	 *
	 * A proxy that reproduces everything is not a proxy, it is a model — so an empty list is
	 * always an error, never a well-behaved case. This is the field that makes the declaration
	 * cost something: an author who cannot name a single thing their stand-in fails to reproduce
	 * has not examined it.
	 */
	readonly doesNotReproduce: readonly Measurable[];
	/**
	 * **True by construction, so passing proves nothing.** Kept apart from `doesNotReproduce`
	 * because listing a structural invariant among measurables inflates the count of things
	 * measured — the same inflation this programme spent 2026-09-11 removing. A compiler check is
	 * the right home for these; they are recorded here so the boundary is visible.
	 */
	readonly structuralInvariants?: readonly string[];
};

export type ProxyViolation = { readonly field: string; readonly problem: string };

/** Structural validation. A declaration that cannot fail is not a declaration. */
export function validateProxy(p: ProxyDeclaration): readonly ProxyViolation[] {
	const out: ProxyViolation[] = [];
	if (p.standsFor.trim() === "")
		out.push({ field: "standsFor", problem: "must name the real part and what it actually is" });
	if (p.justification.trim() === "")
		out.push({ field: "justification", problem: "must say why the stand-in is defensible" });
	if (p.doesNotReproduce.length === 0)
		out.push({
			field: "doesNotReproduce",
			problem:
				"must name at least one thing the proxy fails to reproduce -- a proxy that reproduces everything is a model, not a proxy",
		});
	for (const [i, m] of p.doesNotReproduce.entries()) {
		if (m.status === "registered-unrun") {
			if ((m.fixture ?? "").trim() === "")
				out.push({ field: `doesNotReproduce[${i}].fixture`, problem: "a registered-unrun claim must name the fixture that would run it" });
			if ((m.expires ?? "").trim() === "")
				out.push({ field: `doesNotReproduce[${i}].expires`, problem: "a registration with no expiry is a permanent excuse" });
		}
		// **All three parts are required, because two of them are the falsifier.** A `claim` alone
		// is prose; a `measurement` without a `standIn` cannot be compared; a `standIn` without a
		// `measurement` cannot be reproduced.
		if (m.claim.trim() === "")
			out.push({ field: `doesNotReproduce[${i}].claim`, problem: "is empty" });
		if (m.measurement.trim() === "")
			out.push({
				field: `doesNotReproduce[${i}].measurement`,
				problem: "must say how to measure it -- a claim nobody can run is not a falsifier",
			});
		if (m.standIn.trim() === "")
			out.push({
				field: `doesNotReproduce[${i}].standIn`,
				problem: "must give the number THIS model yields, which is what a real block has to move",
			});
	}
	return out;
}

/**
 * **A CITED DESIGN-TIME DERIVATION — a different claim from `subsumes`, with a different check.**
 *
 * `subsumes` claims **parametric dependence**: mutate the device's spec and the macro's parameters
 * move. That is the only form a census can trust without reading anything, and it is what
 * `scripts/report-subsumption-mutant.ts` tests.
 *
 * A design-time derivation is legitimate and **the mutant would reject it**, because the value is a
 * literal in the catalog rather than a computed expression. So it gets its own field and its own
 * check: **RECOMPUTATION**. Apply the cited formula to the cited values and require it to reproduce
 * the constant.
 *
 * > **A cited derivation that does not reproduce the constant is a guess with a footnote**, and
 * > recomputation catches that where a citation alone does not.
 *
 * **The nine withdrawn `subsumes` claims could be re-made this way, and cannot be**: the constant
 * is `stages: 1024`, which is the **MN3007's datasheet stage count** — the macro's default. The
 * same 1024 appears in `boss-rv-6`, whose Renesas reverb DSP has a 64Mbit SDRAM and no bucket
 * brigade anywhere. **No formula from three 64Kx1 DRAMs lands on 1024 stages of a device class the
 * pedal does not contain.**
 */
export type DerivedFrom = {
	/** Which macro parameter this derives. */
	readonly parameter: string;
	/** The device whose spec determines it, by canonical part id. */
	readonly fromPart: string;
	/** The source, cited to edition and page, as the triode registry cites per parameter. */
	readonly citation: string;
	/** The arithmetic, stated so it can be re-run -- not a pointer at the parts. */
	readonly formula: string;
	/** What the formula yields. Must equal the constant the entry declares. */
	readonly recomputes: number;
};

export function validateDerivation(d: DerivedFrom, declared: number): readonly ProxyViolation[] {
	const out: ProxyViolation[] = [];
	for (const [k, v] of [["parameter", d.parameter], ["fromPart", d.fromPart], ["citation", d.citation], ["formula", d.formula]] as const)
		if (v.trim() === "") out.push({ field: k, problem: "is empty" });
	if (d.recomputes !== declared)
		out.push({
			field: "recomputes",
			problem: `the cited formula yields ${d.recomputes} and the entry declares ${declared} -- a cited derivation that does not reproduce the constant is a guess with a footnote`,
		});
	return out;
}
