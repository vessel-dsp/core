"""Generate docs/spikes/pole-order2/bdf2-arm.patch: the BDF2 scratch arm as a unified diff against the worktree's trapezoidal reference-runtime.ts (TS console only; the C++ console is not
ported). Not shipped. Usage: python3 -I make-bdf2-patch.py <worktree> <scratch dir>   (apply with: cd <tree> && patch -p1 < bdf2-arm.patch)"""
import os, shutil, subprocess, sys
W, S = sys.argv[1], sys.argv[2]
rel = "packages/runtime/src/reference-runtime.ts"
a_dir, b_dir = f"{S}/bdf2-tree/a", f"{S}/bdf2-tree/b"
for d in (a_dir, b_dir):
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(os.path.dirname(f"{d}/{rel}"))
    shutil.copy(f"{W}/{rel}", f"{d}/{rel}")
p = f"{b_dir}/{rel}"
s = open(p).read()
a = s.index("/**\n * The trapezoidal weight")
b = s.index("/**\n * SPICE's junction limiting.")
new = '''/**
 * SCRATCH ARM (not shipped): the op-amp dominant pole by BDF2, the L-stable second-order scheme,
 *
 * ```
 * u[n] (1 + 2a/3) = 4/3 u[n-1] - 1/3 u[n-2] + (2a/3) A0 d[n],   a = dt / tau
 * ```
 *
 * so `u[n] = gain d[n] + decay1 u[n-1] + decay2 u[n-2]`. Measured in `docs/spikes/2026-10-10-pole-order2.md`:
 * it converges where the trapezoid does not (no Nyquist ringing in a stiff closed loop), but its closed-loop
 * error is about 4x the trapezoid's, so it misses the os4 gain-100 bar (0.183 dB at 10 kHz) and is worse than
 * backward Euler at x1 above about 6 kHz. `null` where the pole is transparent (poleHz >= fs / 2), as before.
 */
type OpAmpPoleLaw = { readonly gain: number; readonly decay1: number; readonly decay2: number };
function opAmpPoleLaw(
	openLoopGain: number,
	gainBandwidthHz: number,
	dt: number,
	sampleRate: number,
): OpAmpPoleLaw | null {
	const poleHz = gainBandwidthHz / openLoopGain;
	if (
		sampleRate <= 0 ||
		!Number.isFinite(poleHz) ||
		poleHz <= 0 ||
		poleHz >= sampleRate / 2
	) {
		return null;
	}
	const stepOverTau = 2 * Math.PI * poleHz * dt;
	const scaled = (2 * stepOverTau) / 3;
	const denominator = 1 + scaled;
	return {
		gain: (scaled * openLoopGain) / denominator,
		decay1: 4 / 3 / denominator,
		decay2: -1 / 3 / denominator,
	};
}

'''
s = s[:a] + new + s[b:]
s = s.replace("	private readonly opampDifferentialState = new Map<number, number>();", "	private readonly opampRawState2 = new Map<number, number>();")
s = s.replace("		this.opampDifferentialState.clear();\n		this.fetHistory.clear();", "		this.opampRawState2.clear();\n		this.fetHistory.clear();")
a = s.index("				const rawSeed = halfSwing * Math.atanh(unit);")
b = s.index("			}\n		}\n		// Seed each macro's DC estimate")
s = s[:a] + '''				const rawSeed = halfSwing * Math.atanh(unit);
				this.opampRawState.set(key, rawSeed);
				this.opampRawState2.set(key, rawSeed);
''' + s[b:]
old = '''			const weight = opAmpPoleWeight(
				stamp.openLoopGain,
				OPAMP_GAIN_BANDWIDTH_HZ,
				dt,
				this.sampleRate as number,
			);'''
assert old in s
s = s.replace(old, old.replace("weight = opAmpPoleWeight(", "law = opAmpPoleLaw("))
a = s.index("			const differential = (solution[stamp.plus] ?? 0) - (solution[stamp.minus] ?? 0);\n			const previousRaw")
b = s.index("		}\n	}\n\n	private applyStamp(")
s = s[:a] + '''			const differential = (solution[stamp.plus] ?? 0) - (solution[stamp.minus] ?? 0);
			const previousRaw = this.opampRawState.get(key) ?? 0;
			const previousRaw2 = this.opampRawState2.get(key) ?? 0;
			const halfSwing = opAmpHalfSwing(stamp.railHigh, stamp.railLow);
			this.opampRawState2.set(key, previousRaw);
			this.opampRawState.set(
				key,
				boundOpAmpRaw(
					law === null
						? stamp.openLoopGain * differential
						: law.gain * differential + law.decay1 * previousRaw + law.decay2 * previousRaw2,
					halfSwing,
				),
			);
''' + s[b:]
a = s.index("				const weight = dc\n					? null")
b = s.index("				const linearWidth = halfSwing / effectiveGain;")
s = s[:a] + '''				const law = dc
					? null
					: opAmpPoleLaw(
							stamp.openLoopGain,
							OPAMP_GAIN_BANDWIDTH_HZ,
							dt,
							this.sampleRate as number,
						);
				const effectiveGain = law === null ? stamp.openLoopGain : law.gain;
''' + s[b:]
a = s.index("				const rawPrevious = this.opampRawState.get(opampKey) ?? 0;\n				const previousAccepted")
b = s.index("				const scaled = raw / halfSwing;")
s = s[:a] + '''				const rawPrevious = this.opampRawState.get(opampKey) ?? 0;
				const rawPrevious2 = this.opampRawState2.get(opampKey) ?? 0;
				const raw = boundOpAmpRaw(
					law === null
						? effectiveGain * differential
						: effectiveGain * differential + law.decay1 * rawPrevious + law.decay2 * rawPrevious2,
					halfSwing,
				);
''' + s[b:]
open(p, "w").write(s)
out = subprocess.run(["diff", "-u", f"a/{rel}", f"b/{rel}"], cwd=f"{S}/bdf2-tree", capture_output=True, text=True).stdout
open(f"{W}/docs/spikes/pole-order2/bdf2-arm.patch", "w").write(out)
print("wrote bdf2-arm.patch", len(out.splitlines()), "lines")
