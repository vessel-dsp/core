#!/bin/bash
# Control 2(d): the check can fail. Run from a SCRATCH COPY of the worktree ($1), never the worktree itself.
#   (1) hard-code the old 1e6 in ONLY the C++ console -> a-wire must go red on WASM by the analytic figure, TS stays green
#   (2) hard-code it in ONLY the TS console           -> a-wire must go red on TS, WASM stays green
#   (3) a wrong unit parse (number before the first space, i.e. strip-after-delimiter) -> the packet-declared-GBP tests go red
# Each mutation is reverted and verified byte-identical to the unmutated source by sha256.
M=$1; L=$2
cd "$M" || exit 1
source ~/projects/emsdk/emsdk_env.sh >/dev/null 2>&1
sha_src() { sha256sum packages/runtime/src/cpp/Engine.cpp packages/runtime/src/reference-runtime.ts packages/compiler/src/netlist.ts; }
sha_src > $L/05-sha-before.txt
echo "=== (1) C++ only hard-codes 1e6 ===" > $L/05-break-cpp.log
python3 - <<'PY'
p='packages/runtime/src/cpp/Engine.cpp'; s=open(p).read()
old="    return stamp.gainBandwidthHz.value_or(OPAMP_DEFAULT_GAIN_BANDWIDTH_HZ);"
assert s.count(old)==1; open(p,'w').write(s.replace(old,"    return OPAMP_DEFAULT_GAIN_BANDWIDTH_HZ; // CONTROL (1): C++ ignores the stamp"))
PY
bun run --cwd packages/runtime build:wasm >> $L/05-break-cpp.log 2>&1; sha256sum packages/runtime/src/wasm/v2_dsp.wasm >> $L/05-break-cpp.log
bun test packages/runtime/tests/opamp-gain-bandwidth.test.ts >> $L/05-break-cpp.log 2>&1
echo "--- measured minus BE closed form per console (a-wire), mutated C++:" >> $L/05-break-cpp.log
bun docs/spikes/opamp-gbw/be-vs-measured.ts --mode=os4 >> $L/05-break-cpp.log 2>&1
python3 - <<'PY'
p='packages/runtime/src/cpp/Engine.cpp'; s=open(p).read()
new="    return stamp.gainBandwidthHz.value_or(OPAMP_DEFAULT_GAIN_BANDWIDTH_HZ);"
old="    return OPAMP_DEFAULT_GAIN_BANDWIDTH_HZ; // CONTROL (1): C++ ignores the stamp"
assert s.count(old)==1; open(p,'w').write(s.replace(old,new))
PY
echo "=== (2) TS only hard-codes 1e6 ===" > $L/05-break-ts.log
bun run --cwd packages/runtime build:wasm > $L/05-rebuild-after-cpp.log 2>&1; sha256sum packages/runtime/src/wasm/v2_dsp.wasm >> $L/05-rebuild-after-cpp.log
python3 - <<'PY'
p='packages/runtime/src/reference-runtime.ts'; s=open(p).read()
old="	return stamp.gainBandwidthHz ?? OPAMP_DEFAULT_GAIN_BANDWIDTH_HZ;"
assert s.count(old)==1; open(p,'w').write(s.replace(old,"	return OPAMP_DEFAULT_GAIN_BANDWIDTH_HZ; // CONTROL (2): TS ignores the stamp"))
PY
bun test packages/runtime/tests/opamp-gain-bandwidth.test.ts >> $L/05-break-ts.log 2>&1
echo "--- measured minus BE closed form per console (a-wire), mutated TS:" >> $L/05-break-ts.log
bun docs/spikes/opamp-gbw/be-vs-measured.ts --mode=os4 >> $L/05-break-ts.log 2>&1
python3 - <<'PY'
p='packages/runtime/src/reference-runtime.ts'; s=open(p).read()
new="	return stamp.gainBandwidthHz ?? OPAMP_DEFAULT_GAIN_BANDWIDTH_HZ;"
old="	return OPAMP_DEFAULT_GAIN_BANDWIDTH_HZ; // CONTROL (2): TS ignores the stamp"
assert s.count(old)==1; open(p,'w').write(s.replace(old,new))
PY
echo "=== (3) wrong unit parse ===" > $L/05-break-parse.log
python3 - <<'PY'
p='packages/compiler/src/netlist.ts'; s=open(p).read()
old="""		const match =
			/^([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)\\s*([A-Za-z]*)$/u.exec(
				text,
			);
		const scale =
			match === null ? undefined : frequencyUnitScale[match[2] as string];
		if (match === null || scale === undefined) {
			return refuse("is not a number with a frequency unit");
		}
		hertz = Number(match[1]) * scale;"""
new="""		// CONTROL (3): strip after the first delimiter and read the number -- right number for 1.2 V/us, wrong units for 3 MHz.
		const first = Number.parseFloat(text.split(/[ \\/]/u)[0] as string);
		if (!Number.isFinite(first)) return refuse("is not a number");
		hertz = first;"""
assert s.count(old)==1, s.count(old); open(p,'w').write(s.replace(old,new))
PY
bun test packages/compiler/tests/gain-bandwidth.test.ts >> $L/05-break-parse.log 2>&1
python3 - <<'PY'
p='packages/compiler/src/netlist.ts'; s=open(p).read()
new="""		const match =
			/^([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)\\s*([A-Za-z]*)$/u.exec(
				text,
			);
		const scale =
			match === null ? undefined : frequencyUnitScale[match[2] as string];
		if (match === null || scale === undefined) {
			return refuse("is not a number with a frequency unit");
		}
		hertz = Number(match[1]) * scale;"""
old="""		// CONTROL (3): strip after the first delimiter and read the number -- right number for 1.2 V/us, wrong units for 3 MHz.
		const first = Number.parseFloat(text.split(/[ \\/]/u)[0] as string);
		if (!Number.isFinite(first)) return refuse("is not a number");
		hertz = first;"""
assert s.count(old)==1; open(p,'w').write(s.replace(old,new))
PY
sha_src > $L/05-sha-after.txt
cmp $L/05-sha-before.txt $L/05-sha-after.txt && echo "reverted: sources byte-identical" >> $L/05-break-parse.log
echo "=== restored: wasm rebuild + tests ===" > $L/05-restored.log
bun run --cwd packages/runtime build:wasm >> $L/05-restored.log 2>&1; sha256sum packages/runtime/src/wasm/v2_dsp.wasm >> $L/05-restored.log
bun test packages/runtime/tests/opamp-gain-bandwidth.test.ts packages/compiler/tests/gain-bandwidth.test.ts >> $L/05-restored.log 2>&1
echo done > $L/05-done
