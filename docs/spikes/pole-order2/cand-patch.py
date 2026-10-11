"""SCRATCH ONLY (never in the diff): turn a copy of the worktree's reference-runtime.ts into the multi-scheme candidate arm. POLE_SCHEME = be | tr | foh | bdf2 | theta selects the
law  u[n] = g d[n] + h d[n-1] + c2 u[n-1] + c3 u[n-2]  (coefficients as in closed-forms.ts). `be` reproduces unchanged main bit for bit (asserted by the caller);
`tr` reproduces the worktree (to rounding). `theta` is the theta-method family, theta = POLE_THETA (0.5 = trapezoid, 1 = backward Euler):
  u[n] (1 + theta a) = u[n-1] (1 - (1 - theta) a) + a A0 (theta d[n] + (1 - theta) d[n-1]),  a = dt / tau.
Also GBW_HZ overrides the GBP constant (scratch trees only). TS console only: the scheme switch is not ported to C++.
  python3 -I cand-patch.py <tree root>"""
import sys
p = sys.argv[1] + "/packages/runtime/src/reference-runtime.ts"
s = open(p).read()

# 1. coefficients function (added after opAmpPoleWeight)
anchor = "/**\n * SPICE's junction limiting."
coef = '''const POLE_SCHEME = process.env.POLE_SCHEME ?? "tr";
type PoleLaw = { g: number; h: number; c2: number; c3: number };
/** SCRATCH: the candidate laws. `null` = transparent (poleHz >= fs/2), as the shipped rule. */
function opAmpPoleLaw(a0: number, gbp: number, dt: number, fs: number): PoleLaw | null {
	const poleHz = gbp / a0;
	if (fs <= 0 || !Number.isFinite(poleHz) || poleHz <= 0 || poleHz >= fs / 2) return null;
	const tau = 1 / (2 * Math.PI * poleHz);
	const a = dt / tau;
	switch (POLE_SCHEME) {
		case "be": { const al = dt / (dt + tau); return { g: al * a0, h: 0, c2: 1 - al, c3: 0 }; }
		case "tr": { const x = Math.PI * poleHz * dt; const c1 = x / (1 + x); return { g: c1 * a0, h: c1 * a0, c2: 1 - 2 * c1, c3: 0 }; }
		case "foh": { const e = Math.exp(-a), r = -Math.expm1(-a) / a; return { g: a0 * (1 - r), h: a0 * (r - e), c2: e, c3: 0 }; }
		case "theta": { const th = Number(process.env.POLE_THETA ?? 0.5); const den = 1 + th * a; return { g: (th * a * a0) / den, h: ((1 - th) * a * a0) / den, c2: (1 - (1 - th) * a) / den, c3: 0 }; }
		case "bdf2": { const gm = (2 * a) / 3; return { g: (gm * a0) / (1 + gm), h: 0, c2: 4 / 3 / (1 + gm), c3: -1 / 3 / (1 + gm) }; }
	}
	throw new Error(`POLE_SCHEME ${POLE_SCHEME}`);
}

'''
assert anchor in s
s = s.replace(anchor, coef + anchor, 1)

# 2. GBP override
s = s.replace("const OPAMP_GAIN_BANDWIDTH_HZ = 1e6;", "const OPAMP_GAIN_BANDWIDTH_HZ = Number(process.env.GBW_HZ ?? 1e6);")

# 3. second raw state for bdf2
s = s.replace("	private readonly opampDifferentialState = new Map<number, number>();", "	private readonly opampDifferentialState = new Map<number, number>();\n	private readonly opampRawState2 = new Map<number, number>();")
s = s.replace("		this.opampDifferentialState.clear();\n		this.fetHistory.clear();", "		this.opampDifferentialState.clear();\n		this.opampRawState2.clear();\n		this.fetHistory.clear();")
s = s.replace("				this.opampDifferentialState.set(key, rawSeed / stamp.openLoopGain);", "				this.opampDifferentialState.set(key, rawSeed / stamp.openLoopGain);\n				this.opampRawState2.set(key, rawSeed);")

# 4. advance
old_adv = s[s.index("			const weight = opAmpPoleWeight(\n				stamp.openLoopGain,\n				OPAMP_GAIN_BANDWIDTH_HZ,\n				dt,\n				this.sampleRate as number,\n			);\n			// **Bounded"):s.index("			this.opampDifferentialState.set(key, differential);\n		}\n	}")]
new_adv = '''			const law = opAmpPoleLaw(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, this.sampleRate as number);
			const differential = (solution[stamp.plus] ?? 0) - (solution[stamp.minus] ?? 0);
			const previousRaw = this.opampRawState.get(key) ?? 0;
			const previousRaw2 = this.opampRawState2.get(key) ?? 0;
			const previousDifferential = this.opampDifferentialState.get(key) ?? 0;
			const halfSwing = opAmpHalfSwing(stamp.railHigh, stamp.railLow);
			this.opampRawState2.set(key, previousRaw);
			this.opampRawState.set(
				key,
				boundOpAmpRaw(
					law === null
						? stamp.openLoopGain * differential
						: law.g * differential + law.h * previousDifferential + law.c2 * previousRaw + law.c3 * previousRaw2,
					halfSwing,
				),
			);
'''
s = s.replace(old_adv, new_adv)

# 5. stamp
old_w = s[s.index("				const weight = dc\n					? null"):s.index("				const linearWidth = halfSwing / effectiveGain;")]
new_w = '''				const law = dc ? null : opAmpPoleLaw(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, this.sampleRate as number);
				const effectiveGain = law === null ? stamp.openLoopGain : law.g;
'''
s = s.replace(old_w, new_w)
old_r = s[s.index("				const rawPrevious = this.opampRawState.get(opampKey) ?? 0;\n				const previousAccepted"):s.index("				const scaled = raw / halfSwing;")]
new_r = '''				const rawPrevious = this.opampRawState.get(opampKey) ?? 0;
				const rawPrevious2 = this.opampRawState2.get(opampKey) ?? 0;
				const previousAccepted = this.opampDifferentialState.get(opampKey) ?? 0;
				const raw = boundOpAmpRaw(
					law === null
						? effectiveGain * differential
						: effectiveGain * differential + law.h * previousAccepted + law.c2 * rawPrevious + law.c3 * rawPrevious2,
					halfSwing,
				);
'''
s = s.replace(old_r, new_r)
open(p, "w").write(s)
print("patched", p)
