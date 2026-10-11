"""SCRATCH ONLY (never in the diff): turn a copy of the worktree's C++ console (the trapezoid) into the BDF2 arm, so BDF2 can be measured on the shipping console as well as on TS
(bdf2-arm.patch is the TS side):  u[n] (1 + 2a/3) = 4/3 u[n-1] - 1/3 u[n-2] + (2a/3) A0 d[n].  Adds a second raw-state memory (map + per-stamp scratch), seeded to the raw seed.
  python3 -I bdf2-cpp-patch.py <tree root>"""
import sys
root = sys.argv[1]
h = open(root + "/packages/runtime/src/cpp/include/v2/Engine.h").read()
h = h.replace("    std::vector<double> opampDifferentialState;\n", "    std::vector<double> opampDifferentialState;\n    std::vector<double> opampRawState2;\n", 1)
h = h.replace("    std::unordered_map<uint64_t, double> opampDifferentialState_;\n", "    std::unordered_map<uint64_t, double> opampDifferentialState_;\n    std::unordered_map<uint64_t, double> opampRawState2_;\n", 1)
open(root + "/packages/runtime/src/cpp/include/v2/Engine.h", "w").write(h)
p = root + "/packages/runtime/src/cpp/Engine.cpp"
s = open(p).read()
a = s.index("inline std::optional<double> opAmpPoleWeight(")
b = s.index("// Anti-windup bound for the op-amp pole's raw state, in units of halfSwing.")
s = s[:a] + '''struct PoleLaw { double g; double c1; double c2; };
inline std::optional<PoleLaw> opAmpPoleLaw(double openLoopGain, double gainBandwidthHz, double dt, double sampleRate) {
    double poleHz = gainBandwidthHz / openLoopGain;
    if (sampleRate <= 0.0 || !std::isfinite(poleHz) || poleHz <= 0.0 || poleHz >= sampleRate / 2.0) {
        return std::nullopt;
    }
    double stepOverTau = 2.0 * M_PI * poleHz * dt;
    double scaled = (2.0 * stepOverTau) / 3.0;
    double den = 1.0 + scaled;
    return PoleLaw{(scaled * openLoopGain) / den, (4.0 / 3.0) / den, (-1.0 / 3.0) / den};
}

''' + s[b:]
# clears / assigns
s = s.replace("    opampDifferentialState_.clear();\n", "    opampDifferentialState_.clear();\n    opampRawState2_.clear();\n")
s = s.replace("        scratch.opampDifferentialState.assign(block.stamps.size(), 0.0);\n", "        scratch.opampDifferentialState.assign(block.stamps.size(), 0.0);\n        scratch.opampRawState2.assign(block.stamps.size(), 0.0);\n")
s = s.replace("        std::fill(scratch.opampDifferentialState.begin(), scratch.opampDifferentialState.end(), 0.0);\n", "        std::fill(scratch.opampDifferentialState.begin(), scratch.opampDifferentialState.end(), 0.0);\n        std::fill(scratch.opampRawState2.begin(), scratch.opampRawState2.end(), 0.0);\n")
# seed
old = "                    opampDifferentialState_[key] = seedDifferential;\n                    scratch.opampDifferentialState[sIdx] = seedDifferential;"
assert old in s
s = s.replace(old, old + "\n                    opampRawState2_[key] = raw;\n                    scratch.opampRawState2[sIdx] = raw;")
# stamp
a = s.index("            std::optional<double> weight = dc ? std::nullopt : opAmpPoleWeight(")
b = s.index("            double linearWidth = halfSwing / effectiveGain;")
s = s[:a] + '''            std::optional<PoleLaw> law = dc ? std::nullopt : opAmpPoleLaw(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, options_.sampleRate);
            double effectiveGain = law.has_value() ? law->g : stamp.openLoopGain;
''' + s[b:]
old = "            double diffAccepted = 0.0;\n"
assert old in s
s = s.replace(old, old + "            double rawPrev2 = 0.0;\n")
old = "                diffAccepted = scratchPtr->opampDifferentialState[stampIdx];\n"
assert old in s
s = s.replace(old, old + "                rawPrev2 = scratchPtr->opampRawState2[stampIdx];\n")
old = "                diffAccepted = (diffIt != opampDifferentialState_.end()) ? diffIt->second : 0.0;\n"
assert old in s
s = s.replace(old, old + "                auto raw2It = opampRawState2_.find(opampKey);\n                rawPrev2 = (raw2It != opampRawState2_.end()) ? raw2It->second : 0.0;\n")
old = "                weight.has_value() ? (effectiveGain * (diff + diffAccepted) + (1.0 - 2.0 * *weight) * rawPrev) : (effectiveGain * diff),"
assert old in s
s = s.replace(old, "                law.has_value() ? (effectiveGain * diff + law->c1 * rawPrev + law->c2 * rawPrev2) : (effectiveGain * diff),")
# advance
a = s.index("            std::optional<double> weight = opAmpPoleWeight(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, options_.sampleRate);")
b = s.index("            if (static_cast<size_t>(sIdx) < scratch.opampRawState.size()) {\n                scratch.opampRawState[sIdx] = nextRaw;")
s = s[:a] + '''            std::optional<PoleLaw> law = opAmpPoleLaw(stamp.openLoopGain, OPAMP_GAIN_BANDWIDTH_HZ, dt, options_.sampleRate);
            double differential = stateSource[stamp.plus] - stateSource[stamp.minus];
            double prevRaw = (static_cast<size_t>(sIdx) < scratch.opampRawState.size()) ? scratch.opampRawState[sIdx] : 0.0;
            double prevRaw2 = (static_cast<size_t>(sIdx) < scratch.opampRawState2.size()) ? scratch.opampRawState2[sIdx] : 0.0;
            double prevDifferential = 0.0;
            double nextRaw = boundOpAmpRaw(
                law.has_value()
                    ? (law->g * differential + law->c1 * prevRaw + law->c2 * prevRaw2)
                    : (stamp.openLoopGain * differential),
                opAmpHalfSwing(*stamp.railHigh, *stamp.railLow));
            (void)prevDifferential;
            if (static_cast<size_t>(sIdx) < scratch.opampRawState2.size()) {
                scratch.opampRawState2[sIdx] = prevRaw;
            }
            opampRawState2_[key] = prevRaw;
''' + s[b:]
open(p, "w").write(s)
print("patched", p)
