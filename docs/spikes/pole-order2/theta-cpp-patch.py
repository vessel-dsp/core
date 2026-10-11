"""SCRATCH ONLY (never in the diff): turn a copy of the worktree's Engine.cpp (the trapezoid) into the theta-method arm of the C++ console, theta fixed at COMPILE time (-DPOLE_THETA=0.6):
  u[n] (1 + theta a) = u[n-1] (1 - (1 - theta) a) + a A0 (theta d[n] + (1 - theta) d[n-1]),  a = dt / tau,  i.e.  u[n] = g d[n] + h d[n-1] + c2 u[n-1].
theta = 0.5 is the trapezoid (to rounding), theta = 1 is backward Euler (to rounding). The same one-step form as cand-patch.py's TS arm, so the two consoles can be compared.
  python3 -I theta-cpp-patch.py <tree root>"""
import sys
p = sys.argv[1] + "/packages/runtime/src/cpp/Engine.cpp"
s = open(p).read()
old = s[s.index("inline std::optional<double> opAmpPoleWeight("):s.index("// Anti-windup bound for the op-amp pole's raw state, in units of halfSwing.")]
new = '''#ifndef POLE_THETA
#define POLE_THETA 0.5
#endif
struct PoleLaw { double g; double h; double c2; };
inline std::optional<PoleLaw> opAmpPoleLaw(double openLoopGain, double gainBandwidthHz, double dt, double sampleRate) {
    double poleHz = gainBandwidthHz / openLoopGain;
    if (sampleRate <= 0.0 || !std::isfinite(poleHz) || poleHz <= 0.0 || poleHz >= sampleRate / 2.0) {
        return std::nullopt;
    }
    double tau = 1.0 / (2.0 * M_PI * poleHz);
    double a = dt / tau;
    const double th = POLE_THETA;
    double den = 1.0 + th * a;
    return PoleLaw{(th * a * openLoopGain) / den, ((1.0 - th) * a * openLoopGain) / den, (1.0 - (1.0 - th) * a) / den};
}

'''
s = s.replace(old, new)
# stamp
a = s.index("            std::optional<double> weight = dc ? std::nullopt : opAmpPoleWeight(")
b = s.index("            double linearWidth = halfSwing / effectiveGain;")
s = s[:a] + '''            std::optional<PoleLaw> law = dc ? std::nullopt : opAmpPoleLaw(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, options_.sampleRate);
            double effectiveGain = law.has_value() ? law->g : stamp.openLoopGain;
''' + s[b:]
old = "                weight.has_value() ? (effectiveGain * (diff + diffAccepted) + (1.0 - 2.0 * *weight) * rawPrev) : (effectiveGain * diff),"
assert old in s
s = s.replace(old, "                law.has_value() ? (effectiveGain * diff + law->h * diffAccepted + law->c2 * rawPrev) : (effectiveGain * diff),")
# advance
old = s[s.index("            std::optional<double> weight = opAmpPoleWeight(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, options_.sampleRate);"):s.index("            if (static_cast<size_t>(sIdx) < scratch.opampRawState.size()) {\n                scratch.opampRawState[sIdx] = nextRaw;")]
new = '''            std::optional<PoleLaw> law = opAmpPoleLaw(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, options_.sampleRate);
            double differential = stateSource[stamp.plus] - stateSource[stamp.minus];
            double prevRaw = (static_cast<size_t>(sIdx) < scratch.opampRawState.size()) ? scratch.opampRawState[sIdx] : 0.0;
            double prevDifferential = (static_cast<size_t>(sIdx) < scratch.opampDifferentialState.size()) ? scratch.opampDifferentialState[sIdx] : 0.0;
            double nextRaw = boundOpAmpRaw(
                law.has_value()
                    ? (law->g * differential + law->h * prevDifferential + law->c2 * prevRaw)
                    : (stamp.openLoopGain * differential),
                opAmpHalfSwing(*stamp.railHigh, *stamp.railLow));
'''
s = s.replace(old, new)
open(p, "w").write(s)
print("patched", p)
