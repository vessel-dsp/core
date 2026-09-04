# Changelog

## 0.6.38

- **`kind: fuse`.** A fuse, thermal cutout or other one-shot protective conductor is now a
  component kind. Two ends and no polarity (`end`/`positive`/`negative`), plus `pin` for a
  holder's mounting lug.
- **Why the format had to carry this.** A fuse conducts until it opens once and nothing operates
  it, but the nearest available declaration was `kind: switch` -- and 27 components in
  `vessel-dsp/artifacts` are declared that way. A consumer then offers each as a control a player
  can sweep, which puts a mains fuse on the panel as a knob.
- **A consumer could not fix that without reading authored text.** The only signal a `kind: switch`
  fuse carries is a property key, and that key is already spelled three ways in one corpus:
  `FuseRating` 36 times, `FuseRatings` twice, `ThermalFuse` once. Lowering off it would be a
  spelling table, which is what a typed kind replaces.
- **It also separates a case structure cannot.** Several packets declare one component that is a
  power switch *and* a fuse in series: two terminals, one closed contact, indistinguishable from a
  bare fuse by any structural test. A power switch that carries a fuse rating stays a `switch`; a
  fuse alone is a `fuse`. Only the document can draw that line, and now it can.
- The parser refuses an undefined kind as before -- `fuze` is still an error, which is what makes
  the union a vocabulary rather than a decoration -- and an electrode role belonging to another
  kind is reported rather than carried: `role: cathode` on a fuse raises `terminal-role-illegal`.
- Circuit JSON export maps a fuse to `simple_resistor` with a `fuse_horz` symbol, since that
  format has no fuse ftype; the rating stays in the source document.

## 0.6.37

- A winding carries its own **`voltage`** and its own **`impedances`**. Both optional; most
  windings state neither.
- `voltage` is one typed quantity per coil, measured **across the pair a stamp uses** -- per half
  where the coil declares a `windingCenterTap`, end to end otherwise, which is how a transformer
  is printed. The declared centre tap from 0.6.36 is what makes that a convention rather than a
  guess.
- It has to live on the coil because a component property keyed on a winding class holds one value
  per class. `orange-rockerverb`'s power transformer states 3.15 V for its power-tube heater coil
  and 6 V for its preamp heater coil, and had to invent `PowerTubeFilamentSecondary` and
  `PreampHeaterSecondary` to say so. A consumer keyed on the class collapsed both to one value and
  drove the 3.15-0-3.15 V winding at 6 V per half -- measured in the shipping program, not
  predicted. This is the quantity-side twin of the `secondaryalt3` problem `windings` deleted.
- `impedances` is a list, and **each entry names the terminal pair it is rated across**, because
  transformers are not rated by one convention: a primary is printed plate-to-plate, across its
  centre tap, while a speaker secondary is printed from its common to each tap. Every
  `PrimaryImpedance` in the corpus reads "... plate-to-plate"; every `SecondaryImpedance` is a tap
  value. A bare number per winding would need a convention and either one is wrong for one of the
  two.
- A list rather than a single value because one coil really carries several ratings.
  `orange-gro100`'s output transformer states four (100 V line, 15 Ω, 7.5 Ω, 3.75 Ω) and
  `orange-rockerverb`'s states two that are *simultaneously loaded*, a 16 Ω jack and an 8 Ω jack
  each with its own feedback resistor. A consumer that could see one rating had to drop a wired
  speaker branch, which is the defect this closes.
- No per-tap turns ratio is needed: between any two rated pairs on one core the turns ratio is the
  square root of the impedance ratio. `windingImpedanceAcross()` reads a rating in either terminal
  order. `TurnsRatio` stays a component property -- it is a relation between coils, not a property
  of one.
- Validation: a pair naming a terminal not on this winding (it reads as valid and silently rates
  the wrong coil), a pair naming one terminal twice, and a non-positive impedance or voltage are
  errors.
- These replace 10 component-property spellings, `InputImpedance`/`OutputImpedance` included --
  the reverb tanks' drive and pickup ratings under a second name.

## 0.6.36

- Add `windingCenterTap` to the transformer terminal vocabulary, splitting the tap role in two.
  A **centre tap** is the point a coil is referenced at -- grounded on a power transformer's HV
  winding, tied to B+ on an output transformer's plate winding -- and both halves are live at once.
  An **alternative output tap** is a speaker winding's 4/8/16 Ω point, of which a selector
  normally makes one live. They are different circuits and `windingTap` said both.
- Nothing a consumer can compute separates them, which is why this is a declaration. A grounded
  end identifies the reference on a speaker winding and says nothing about an output
  transformer's primary, whose ends can include ground. "Every node carries a load" reads
  `orange-rockerverb`'s tapped secondary as centre-tapped, because every node of it does. And
  both kinds declare the tap in the middle, so coil order says nothing either. Each of those
  three was tried in a consumer and each was wrong on one of the two shapes.
- The corpus splits cleanly: 40 reference taps (`primary_ct`, `hv_center_tap`, `low_ct`,
  `heater_center`, `power_tube_heater_center_0v` and their camelCase and colour-coded spellings)
  against 15 output taps (`secondary_4`/`_8`/`_16`, `secondary_hot`, `secondary_15ohm`,
  `secondary_7r5ohm`, `secondary_3r75ohm`).
- `windingEndsAndTaps()` counts both as taps, since both are.

## 0.6.35

- Drop `shield` from `WindingRole`, and stop warning that a `role: shield` terminal belongs to no
  winding. A shield is a grounded foil between windings, not a coil: the terminal role says all of
  it, and asking for a winding entry would ask for a false one. Found by backfilling the corpus —
  it was the only `winding-terminal-orphaned` warning in 55 transformers.
- Correct what justifies a repeating role. The corpus case is `orange-rockerverb`'s power
  transformer carrying **two filament windings** (3.15-0-3.15 V for the power tube heaters, 6.3 V
  for the preamp), not the two secondaries 0.6.34 described — every multi-tap secondary in the
  corpus turned out to be one coil, including `orange-gro100`'s 100 V line output, which its own
  `SecondaryTaps` lists alongside the 15/7.5/3.75 Ω taps.
- The backfill also corrected the count: 55 transformers and 363 terminals, not 53 and 296. Two
  documents quote their scalars (`kind: "transformer"`) and the first scan matched only unquoted
  ones.

## 0.6.34

- Add `windings`, the sibling to `devices`: a transformer declares which of its terminals form
  each coupled coil, in coil order, and `role`/`windingTap` on the terminals themselves says which
  are ends and which are taps. A winding entry is `role` plus ordered `terminals` — nothing more,
  because core already carries the per-terminal fact.
- Eleven roles: `primary`, `secondary`, `hv`, `filament`, `rectifier-heater`, `bias`,
  `low-voltage`, `auxiliary`, `shield`, `drive`, `pickup`. Roles may repeat, which is what makes a
  second secondary expressible; a consumer distinguishes windings by their terminals or by an
  optional `id`.
- `drive`/`pickup` exist for a spring reverb tank, where neither coil transforms the other's
  voltage. It is the one `transformer`-kind component in the corpus that is not a transformer, and
  calling its coils primary/secondary states something false about it.
- Validation: unknown role, unknown or repeated terminal, a terminal claimed by two windings, an
  empty list and a duplicate `id` are errors; a single-ended winding and a winding-role terminal
  no winding couples are warnings. `windingOfTerminal()` and `windingEndsAndTaps()` are the read
  side.
- Measured against the corpus first: 53 transformers, 296 terminals, and a consumer table of 110
  spelling entries reconstructing 12 winding classes — four of which (`secondaryalt`,
  `secondaryalt2`, `secondaryalt3`, `secondaryline`) exist only because a spelling-keyed record
  has nowhere to put two coils with the same role. Design and the connectivity boundary it must
  not cross: `docs/winding-construct-design.md`.

## 0.6.33

- Add `ac` to `TerminalRole`, legal on `diode`, for a bridge rectifier's alternating input legs.
  Such a leg is neither an anode nor a cathode: on one half cycle it conducts *into* the positive
  rail and on the other the negative rail conducts into it, so one terminal serves two junctions
  of opposite orientation. Naming it `anode` would state a direction it does not have, and the DC
  side already has `positive`/`negative`.
- Without it a diode's role vocabulary could not express what 12 corpus bridge terminals declare
  (`ac_a`/`ac_b`, `ac_left`/`ac_right`, `acA`/`acB`), which is the gap that blocked a consumer from
  replacing its own bridge-topology table with a read.

## 0.6.32

- Add a canonical carrier-polarity vocabulary and validation. Polarity flips a device's whole
  transfer curve - an NPN read as PNP does not conduct, a p-channel FET read as n-channel biases
  backwards - and the corpus stated it across **three keys**: `Type` (239 bjt + 103 jfet + 1
  mosfet), `Polarity` (28 bjt + 3 jfet) and `Channel` (3 jfet), with case drift (`npn`/`NPN`) and
  quoting artifacts (`'N'` sixteen times). `Polarity` is canonical; `Type` and `Channel` are
  reported where they carry this fact.
- `DevicePolarity` is `npn | pnp | n-channel | p-channel`, and `POLARITIES_BY_KIND` keeps the
  bipolar and field-effect pairs apart. An `npn` MOSFET is the **one error** rather than a
  warning: it is not a document predating a vocabulary, it is a claim that cannot be true.
- **`Type` and `Polarity` each carry more than this concept, and the others are reported rather
  than folded in**, because reading any of them as a carrier polarity would be worse than saying
  so: a diode's `Type` is a device *family* (`Zener`, `Schottky`, `Germanium`) and each selects a
  different law; a capacitor's `Polarity: electrolytic` is a dielectric that *implies*
  polarization; a `voltage-source`'s `center-negative` is a DC barrel jack's sleeve; and
  `Type: IC`/`LED`/`OTA` merely restates `kind`.
- Normalization folds case, separators, stray YAML quotes and CamelCase boundaries, with the
  acronym rule written so `NPN` survives whole rather than splitting into letters. An
  abbreviation or a kind restatement is **not** folded: `N`, `NJF` and `N-channel JFET` all mean
  n-channel and are all documents to correct, the same rule the taper vocabulary applies to `A`.
- A missing polarity on an active device is reported, because its transfer curve depends on it and
  silence forces a consumer to guess - measured downstream as 37 FETs whose channel does not
  resolve.
- **A suppression bug found by disbelieving a good-looking measurement.** The first version
  suppressed the missing-polarity report whenever *any* superseded key was a string, so a JFET
  declaring `Type: 'N'` - which states no polarity this vocabulary can read - was reported as
  clean. Corpus counts went from 1 unrecognized to the true 105, and missing from 167 to 271:
  **105 devices had been hidden by the presence of a key whose value did not resolve.** The
  suppression now requires that the other key actually carry a usable polarity.
- **A declared part suppresses the missing-polarity report.** A 2N3904 is NPN and a 2N3906 is PNP,
  so a `PartNumber`/`Model`/`Chip` identifies the polarity even where the document does not spell
  it out. Core holds no part catalog and cannot check which, but a consumer that does is not
  guessing, and warning here would make the check noise on every properly identified transistor.
  Found by a pre-existing fixture - a BJT carrying only `Model: 2N3904` - which is exactly the
  case the first draft got wrong.
- Corpus position after this release: 544 bjt/jfet/mosfet components, **288 clean (52.9%)**, 242
  carrying the polarity under `Type` (a key rename), **13** where neither a polarity nor a part
  identifies it, and 1 unrecognized value. The earlier draft of this entry reported 30 clean and
  271 missing; those figures were taken before the part-identification rule and before the
  suppression bug was fixed, and are wrong.

## 0.6.31

- Add a canonical potentiometer taper vocabulary and validation. Taper is **audible** - it is how
  a knob's travel maps to its effect - and the corpus stated it across **two keys with 46 distinct
  values between them**: `Taper` (264 declarations, 30 values) and `Sweep` (397, 16).
- **The two keys are one fact, proven by the 57 components that declare both**: `Taper: B` sits
  beside `Sweep: Linear` 26 times, `Taper: A` beside `Sweep: Logarithmic` 8 times, `Taper: C`
  beside `ReverseLogarithmic`/`ReverseAudio` 7 times. One is the manufacturer letter code, the
  other the law's English name. `Taper` is canonical; `Sweep` is superseded and reported.
- **Spellings are `KnobTaper`'s**, from `panel/types.ts`, which shipped first and is published API
  with consumers in `control-ui` and panel extraction. The first draft of this vocabulary used
  `logarithmic` and would have created a second spelling for the same law inside one package -
  precisely the drift this work removes. The corpus writes `Logarithmic`, so the corpus backfills;
  a published enum with consumers is the stronger constraint. Cost of that choice, measured: 139
  extra declarations to correct.
- **Letter codes are deliberately not accepted.** `A`, `B` and `C` are printed markings whose
  meaning is a convention rather than a definition - the mapping the 57 pairs reveal is the
  Japanese/Alps one this corpus happens to use, not a universal. The marking is source provenance;
  the law goes in `Taper`.
- **Three classes of existing value are not tapers**, and each gets its own verdict and message
  because the fix differs: `Unknown`/`source-unmarked`/`not-visible` state *absence* (fix: omit
  the property, since a value for absence is worse than absence), `trim`/`Trim` names a physical
  package rather than a resistance law, and `0..1` is a travel range.
- Normalization folds case, separators and CamelCase word boundaries, so `ReverseLog`,
  `Reverse Log` and `reverse-log` are one value. A **synonym** is not a spelling: `Audio` and
  `Logarithmic` name this law under other words and are reported, not accepted.
- `classifyTaper(value)` returns `canonical | absence | not-a-law | unrecognized`;
  `collectTaperIssues(component)` reports per component and runs inside document validation. All
  verdicts are warnings, for the reason the terminal-role work settled: a vocabulary that refused
  every document written before it existed would refuse the corpus, and the counts are the
  backfill's remaining work.
- Adds `docs/vdsp-property-format-review.md`, a measured review of all 58,021 property
  declarations across 567 keys: key naming is consistent (563 of 567 PascalCase), but 55 keys hold
  more than one value type, 8 carry number-as-string quoting drift (`0.5` / `'0.5'` / `0.50`, and
  `PartNumber` as a YAML **number**), 11 carry booleans as strings, and `Resistance`/`R`,
  `Capacitance`/`C`, `Voltage`/`V` are synonym pairs. `Type`/`Polarity`/`Channel` is named as the
  next vocabulary worth closing - three keys for device polarity, with `Polarity` conflating
  capacitor polarity and transistor polarity.

## 0.6.30

- Add `Component.devices`: the devices a package contains. A component models a schematic
  **symbol**, and a symbol may hold several devices - a dual rectifier is two diodes on one
  cathode, a dual op-amp two amplifiers on one supply pair, an optocoupler an LED beside a
  photoresistor. Consumers need the devices, and until now each one reconstructed the split by
  parsing terminal names. Design: `docs/device-construct-design.md`.
- **A device names its terminals by `name`.** Names are already unique within a component - the
  `nodes` ledger addresses pins as `<componentId>.<name>` and core refuses duplicates - so a name
  is a sufficient reference, and membership is the thing an index could not state. Order carries
  no meaning: a device binds by the `role` its terminals declare.
- **A terminal may belong to several devices.** A dual rectifier's shared cathode and a dual
  op-amp's shared supplies are the ordinary case, needing no special rule.
- **`kind` is declarable per device**, defaulting to the component's. An optocoupler is why: it
  holds an `led` and a `variable-resistor`, two laws in one package.
- **Omitting `devices` means exactly one device**, of the component's kind, using all its
  terminals. That is nearly every component - 8,462 resistors in the survey say nothing - and
  `componentDevices()` returns the same shape either way, so no caller branches on whether the
  list was written down.
- `deviceTerminalRoles(component, device)` is the binding a law reads, scoped to one device. That
  scope is the point: a dual op-amp declares two of every signal role across its package, and only
  inside a device is the read unambiguous. This is the defect that motivated the construct - a
  consumer guessing the pairing put both inputs of `boss-dm-3`'s `IC1` on one node and drove a
  bias rail.
- `validateComponentDevices()` reports a malformed declaration as an **error** (a terminal that
  does not exist, a duplicate device id, an empty device, a repeated terminal, or a role the
  device's kind cannot carry) and a terminal belonging to no device as a **warning**, since that
  is either decorative or an omission and the document cannot say which. Whether a device's roles
  are *sufficient* for its law stays with the consumer: encoding one law's expectations in the
  format would make the format wrong for the next law.
- Parser and serializer round-trip `devices`, emitting it only when declared. Terminal lists are
  written in **block form**; the interchange format parses a YAML subset whose only flow
  collections are the empty `[]` and `{}`.

## 0.6.29

- Remove the `index` field added to `Terminal` in 0.6.28. It was a half-measure: for the case it
  handled a unique `name` already sufficed, and for the case that is actually hard it was not
  enough. Nothing declared it -- zero terminals in the 26,016-terminal survey -- so removing it
  now costs nothing.
- **What it could not do.** `index` labelled a terminal without saying which *device inside the
  package* it belonged to. On a dual rectifier that is harmless, because both plates share one
  cathode and the pairing is forced; on a dual op-amp declared as one component it says nothing
  useful, because `index: a` on an output and an input does not state that they are one section.
  That is grouping, not indexing.
- **A role may repeat within a component, and the unique `name` distinguishes the pins.** A
  resistor's two ends are both `end`; a dual rectifier's two plates are both `plate`, named
  `plate_a` and `plate_b`. A construct that groups terminals into devices refers to them by name,
  which states the pairing directly -- the thing `index` only gestured at.
- This is what a netlist has always done: SPICE has no packages, only elements, and each element
  carries its own complete positional node list (`Q1 nc nb ne`). A dual rectifier is two `B`
  lines, not one component with two plates. The remaining complexity in this format is that a
  component models a schematic *symbol*, which may hold several devices; `role` says what an
  electrode is, and a device/section construct is what will say which device it serves.
- `INDEXABLE_DEVICE_TERMINAL_ROLES` is renamed `SUFFIXABLE_DEVICE_TERMINAL_ROLES`, and
  `classifyDeviceTerminalRole` still resolves a suffixed name (`plate_a`) to its plain role, since
  that is how the backfill reads existing documents. The suffix distinguishes the name and carries
  no meaning of its own.

## 0.6.28

- Add a **required** `role` field to `Terminal`, with an optional `index`. A terminal's name is
  the pin's identity in the `nodes` ledger and must be unique within its component, so it cannot
  also carry the electrode - a dual rectifier has two plates and can only name one of them
  `plate`. The role is now its own typed field, and the name goes back to being whatever the
  source printed.
- This supersedes 0.6.27's approach, which inferred the role from the name against a canonical
  vocabulary. That was the wrong layer: it made the name normative and left every consumer
  parsing text. 0.6.27's `classifyDeviceTerminalRole` remains, now as the **migration reader** -
  it is what writes a `role` into the 26,016 terminals written before the field existed.
- `TERMINAL_ROLES_BY_KIND` declares which roles each of the 32 component kinds may carry, and
  `isLegalTerminalRole(kind, role)` checks one. `screen` is legal on a pentode and not a triode;
  `wiper` on a potentiometer and not a diode.
- Two values exist so that a required field is satisfiable on every kind, and neither is a
  loophole. **`pin`** is an opaque part's numbered pin - pin 7 of an unknown IC has no electrode
  meaning, and 2,648 `ic` terminals across 1,566 spellings are exactly this. **`end`** is one of
  two interchangeable ends, so `end` twice on a resistor is correct rather than under-specified.
  A role may repeat within a component; a name may not.
- `collectTerminalRoleWarnings()` reports two distinct things: `terminal-role-missing` for a
  terminal that declares none, and `terminal-role-illegal` for a role its kind cannot carry. The
  missing case is a **warning, not a refusal**, because refusing would reject every document
  written before this release; the warning count is the backfill's remaining work. The illegal
  case is always the document's error.
- `transformer` and `switch` take deliberately coarse roles (`winding`/`windingTap`/`shield`,
  `common`/`throw`/`coil`). A transformer terminal's role is that it is a winding end; *which*
  winding it belongs to is membership, which a flat role cannot express and which those packets'
  107 spellings currently carry inside names. That needs a winding construct.
- Parser and serializer round-trip `role` and `index`, and emit them only when declared, so a
  document written before this release serializes back unchanged.

## 0.6.27

- Add a canonical terminal-role vocabulary for the active devices whose electrodes are
  asymmetric: `triode`, `pentode`, `tube-diode`, `bjt`, `jfet`, `mosfet`. Exchange a BJT's base
  and collector, or a triode's plate and cathode, and the circuit still solves - so the wrong
  answer is silent, and the role has to come from the document read against one declared
  vocabulary. `classifyDeviceTerminalRole(kind, terminalName)` returns `canonical`, `ambiguous`,
  `package-pin`, `unrecognized`, or `out-of-scope`.
- Keyed by `ComponentKind`, not one flat table, because the same token is different electrodes on
  different devices: `c` is a BJT collector and a tube cathode, `screen` exists on a pentode and
  not a triode, `input`/`output` name a FET's channel ends and nothing on a tube.
- **No alias table, deliberately.** A spelling outside the vocabulary is reported as
  `unrecognized` rather than translated, so it becomes a document to correct instead of an
  accommodation the vocabulary carries forever. Measured against a 142-document, 26,016-terminal
  corpus, the whole cost of that stance is 10 declarations across 3 spellings (`input`/`control`/
  `output` on two FETs, `body` on one MOSFET, `cathode_filament` on three rectifiers).
- Electrodes that legitimately repeat carry an index instead: `plate_a`/`plate_b` resolve to one
  `plate` role with `index`. This is forced by the format rather than a spelling preference - a
  terminal name is the pin's identity in the `nodes` ledger, so a dual rectifier cannot name both
  plates `plate`.
- Under-specified tokens resolve to no role, following the potentiometer vocabulary's rule: there
  is nothing to correct in `a`, it simply does not say which electrode it is. A bare `filament`
  is in the same class, being indistinguishable from a heater tap.
- A bare pin number (`pin7`, `terminal4`) reports as `package-pin` rather than `unrecognized`: it
  names where a wire lands, not what the electrode does, and a consumer holding the package pinout
  can still use it.
- Coverage over the same corpus: 2,204 of 2,251 terminals on covered kinds resolve canonically
  (97.9%), with `triode` and `pentode` at 100%. Of the 39 that do not, 29 are three components
  that are not the device they declare - two multi-device shells holding four transistors and
  five diodes between them, and a unijunction transistor declared `kind: bjt`.

## 0.6.26

- Merge inline terminal `node` keys and the `nodes` ledger into one declared
  connectivity interpretation during `.vdsp` parsing. Declaring any inline
  terminal node previously made the parser ignore every `members` list in the
  ledger, so a packet that split its declarations across both styles silently
  lost the ledger-only pins - including, in the reported case, leaving the
  ground node with no members at all and no warning.
- Agreement between the two styles is treated as redundant rather than
  ambiguous, which is what lets a serialized document (core writes both an
  inline `node` per terminal and a `nodes` ledger) round-trip unchanged.
  Disagreement about the same pin is refused with the existing
  `already belongs to node` error.
- The ledger is now validated on every document that has one, so a `members`
  entry naming an unknown component or terminal, or a duplicate node id, is
  reported instead of skipped whenever inline terminal nodes are also present.
- Accept declared `connectivity` and `nodeRoles` in
  `serializeInterchangeYaml()` and `serializeVdspCircuitDocument()`. Both wrote
  connectivity resolved from terminal geometry, so a parse/serialize round trip
  renumbered author-declared node ids and rewrote every node role to `ground`
  or `signal`, discarding tokens such as `supply`. Passing the values back from
  `parseInterchangeYamlWithTopology()` now preserves both; omitting them keeps
  the previous geometric behaviour.
- Add `INTERCHANGE_CONTRACT_VERSION` so consumers can gate adoption on parse
  behaviour instead of a package version range.
- Add a canonical potentiometer terminal-role vocabulary:
  `classifyPotentiometerTerminalRole()`, `resolvePotentiometerTerminalRoles()`
  and `resolveDocumentPotentiometerTerminalRoles()`. A pot's ends are only
  meaningful as a rotational pair, and rotation cannot be recovered from a
  schematic - terminal positions say which end is drawn where, not which way the
  shaft turns - so a consumer inferring it from topology produces controls that
  sweep backwards on some documents, silently.
- Lug numbers and spelling variants (`1`/`2`/`3`, `lug 2`, `Pin_3`,
  `counter-clockwise`, `slider`) normalize to `ccw`/`wiper`/`cw` with no
  diagnostic; the resolved role is keyed by the raw token, so nothing is
  rewritten. Tokens that name an end without its rotation (`a`, `b`, `left`)
  resolve to no role at all: `complete` stays false and a
  `potentiometer-terminal-role-ambiguous` diagnostic says the source does not
  carry the semantics, rather than a guess being supplied.
- `.vdsp` intake reports those diagnostics as parser warnings. No corpus
  document gains one: all 65 potentiometers surveyed either use lug numbers
  (the 2 in `.vdsp`) or arrive from `.schx` with core's own catalog names
  (the other 63), and warning an author about a token core invented would be
  noise.
- Parse `.schx` device-model parameters into structured quantities instead of
  leaving them as text: the tube set (`Kg`, `Rgk`, `Vg`, `Gamma`, `Ig0`, the
  interelectrode capacitances, and `Kg1`/`Kg2` on a pentode), op-amp `Rin`,
  `Rout`, `Aol` and `GBP`, the uppercase bipolar spellings `IS`/`BF`/`BR`/`n`
  that only the long `BipolarJunctionTransistor` shortType listed, and `Wipe`
  on a variable resistor. 137 values across the corpus that consumers had to
  re-parse. A discrete selector `Position` stays a string - it is state, not a
  device parameter.
- Extract the duplicated `normalizeToken()` into `model/tokens.ts`. It was
  byte-identical in `model/validation.ts` and `panel/extract.ts`, and a second
  copy is how two vocabularies drift apart.

## 0.6.25

- Validate `sourceTypeName` against an explicit vocabulary during `.vdsp`
  parsing. The field was typed `string | null` and parsed straight through, so
  any spelling was accepted silently; every consumer matches it exactly, which
  made each unrecognised spelling a component that quietly failed to resolve.
- Emit the first parser-generated warnings for it: `source-type-name-alias`
  names the canonical spelling for a known variant, and
  `source-type-name-not-a-device-class` covers values that record what a
  consumer does with a component rather than what the component is.
  `source-type-name-unsupported` covers everything else.
- Values are reported, never rewritten. Documents keep parsing, and the
  recorded spelling is preserved verbatim.

## 0.6.24

- Extend canonical `.vdsp` source/runtime boundary warnings to the legacy
  runtime marker cleanup set: `SourceOnly`, `InterfaceOnly`,
  `SourceBoundaryNote`, `FirmwareStatus`, `FirmwareExternalStop`, and
  `BehaviorRole`.
- Wire `validateVdspCircuitDocumentSchema()` to return those warnings during
  canonical `.vdsp` intake while keeping legacy parsing tolerant for inspection
  and migration.

## 0.6.23

- Add opt-in canonical `.vdsp` source/runtime boundary validation through
  `validateSourceRuntimeBoundary()` and `createSourceRuntimeBoundaryRule()`.
  The rule reports runtime, admission, and proxy metadata such as
  `RuntimeMatchKey`, `RuntimeDescriptor`, `DescriptorType`, stored compiler or
  admission metadata, and nested `BehaviorRole.firmwareRef.behaviorOwner` while
  keeping legacy parsing tolerant.
- Stop treating `RuntimeMatchKey` as required source firmware metadata.
  Firmware source evidence validation now checks `FirmwareRequired`,
  `FirmwareId`, and chip identity without encouraging runtime selector fields
  in canonical `.vdsp`.

## 0.6.22

- Warn when `InterfaceOnly` is used on a wired active-device kind (diode, LED,
  transistor, op-amp, tube, IC, and similar `model`-identity kinds) with two or
  more declared terminals. `InterfaceOnly` is for components with no real
  electrical branch (an unpopulated/DNP position or a panel/UI reference stub),
  not a waiver for a real device whose exact part is unconfirmed. New code:
  `interface-only-active-device`.
- Report legacy `Support: "view-only"` as a schema problem instead of treating
  it as a current interface-only marker. The property is legacy vocabulary from
  the pre-runtime-agnostic schema; playable/support status is derived downstream
  by the host runtime/compiler. New code:
  `schema-invalid-legacy-support-view-only`.

## 0.6.21

- Enforce single-owner supply rails in `@vessel-dsp/core`: a modeled voltage may
  have only one owner (a mains PSU/transformer, a battery/DC-adapter boundary, or
  a converter/regulator/divider output), so a `kind: rail` that asserts an ideal
  source on top of an already-owned voltage is a `power-rail-fixed-owner-conflict`
  validation error. The rule is power-model driven and connectivity-independent:
  it never reads wires, node identity, or component voltage properties, so the
  verdict is identical for `wires: []` and a fully connected drawing.
- Add the optional `CircuitPowerDomain.sourceKind` (`mains-ac` | `external-dc`)
  field and export the `CircuitPowerSourceKind` type. The interchange parser
  normalizes the provisional `powerSourceKind` alias into it and rejects
  conflicting values. New codes: `power-domain-source-kind-conflict`,
  `power-domain-source-kind-unresolved`, `power-domain-source-owner-unresolved`,
  and `power-rail-fixed-owner-conflict`.

## 0.6.20

- Add opt-in, topology-aware audio trace warnings for destructive capacitor
  shunts, extreme direct input loading, and declared op-amp buffers with open
  passive feedback paths. Ambiguous roles and incomplete boundary connectivity
  produce abstention warnings rather than circuit claims.
- Add `.vdsp` parsing that preserves source-declared node membership and roles
  for advisory validation, with geometric connectivity as an explicit fallback.

## 0.6.19

- Add advisory trace plausibility checks to `@vessel-dsp/core`, including
  coverage-gated structural checks plus opt-in preferred-value and RC-corner
  heuristics for source transcription review.
- Export trace plausibility APIs and validation issue codes for downstream
  conversion/audit tooling.

## 0.6.18

- Add phase-one display hardware metadata to `@vessel-dsp/core`: `display`
  component, panel, and device-interface kinds; typed `Panel.displays`
  descriptors; `.vdsp` parse/serialize round-trip support; validation for
  display kind, bus, grid dimensions, driver component links, and default text.
- Preserve display modules as visible panel metadata only. This release does
  not add display runtime values, framebuffer/matrix protocol, or runtime-driven
  display updates.
- Preserve source display panel metadata in `@vessel-dsp/stompbox` when panels
  are rebuilt from runtime descriptor controls.

## 0.6.17

- Extend `BehaviorRole.firmwareRef` in `@vessel-dsp/core` with richer firmware
  evidence metadata, including status, artifact/source visibility, behavior
  ownership, and optional component linkage fields while keeping the component
  role as the canonical firmware owner.
- Validate authored `firmwareRef` entries fail-closed for invalid shape,
  invalid status/enum values, unresolved component links, and
  recovered-ownership claims that are not backed by recovered or verified
  status.

## 0.6.16

- Release metadata only. This release did not include the intended
  `BehaviorRole.firmwareRef` schema and validation implementation; use 0.6.17
  or later for that support.

## 0.6.15

- Add typed source-visible cabinet, speaker-driver, microphone-transducer, and
  simulation profile schemas to `@vessel-dsp/core` without introducing runtime
  simulator admission rules.
- Add `simulationProfiles` to `.vdsp` v3 documents with parse/serialize
  round-trip preservation, namespaced extension preservation, and explicit
  conversion-loss diagnostics when exporting to non-VDSP formats.
- Validate profile catalog integrity, including duplicate IDs, dangling
  cabinet driver and simulation target references, malformed simulation units,
  and invalid non-positive physical quantities while allowing incomplete
  measured/profile seed records.

## 0.6.14

- Add a `power-converter` `ComponentKind` for source-visible converter ICs
  (charge pumps, regulators, etc.), with a required `ConverterKind` property
  (must-have value: `charge-pump`). Lets `CircuitDocument.power` rail
  derivations anchor charge-pump-derived rails (for example a Klon-style
  `+V2`/`V-` pair) to a real component instead of overclaiming topology from
  voltage labels alone.
- Add optional `nominalVoltage` on `CircuitPowerRailBinding` so a derived rail
  can carry its own voltage separate from the domain's `ratedVoltage`.
- Validate converter identity: `doubler`/`inverter` derivations require
  `converterComponentId`; `converterComponentId` must resolve to a
  `power-converter` component; `main-supply`/`regulated-output`/
  `charge-pump-output` roles reject electrically contradictory derivations;
  the same converter cannot claim the same rail role twice. Warn (don't fail)
  on a converter with no `PartNumber` or a charge-pump-derived rail with no
  `nominalVoltage`.
- Does not model MAX1044/ICL7660 switching transients, sag, ripple, or a sag
  knob — converter identity is structural metadata only.

## 0.6.13

- Reject duplicate YAML mapping keys instead of silently letting the later
  occurrence win. Enforced at every object nesting level (a duplicate
  top-level `power:` or `rawAttributes:` block, or a duplicate key inside
  `power.domains[0]`, and so on), since validation after parsing cannot tell
  that a key was overwritten during parse.
- `validateVdspCircuitDocumentSchema` reports duplicate keys with
  `code: "duplicate-key"` and `path` set to the offending key.

## 0.6.12

- Add a typed `circuit-power/v1` power-topology block (`CircuitPower`,
  `CircuitPowerDomain`, `CircuitPowerRailBinding`) to `circuit-interchange/v3`,
  describing supply domains, ground polarity, and rail role/derivation without
  introducing a new document schema version.
- Validate power topology: unresolved source, rail, parent-rail, and
  converter component references; duplicate domain ids; duplicate rail
  ownership across domains; `parentRailComponentId` cycles; and
  `coverage`/`domains` consistency.

## 0.6.11

- Add enum-backed semantic `ControlRole` validation for source component
  properties and `controlInterfaces[].controlRole`, with source-only warnings
  and playback-claimed errors.
- Export canonical control role constants and validation rule-pack hooks so
  hosts can layer lowering-specific diagnostics without embedding runtime
  policy in core.

## 0.6.10

- Preserve firmware-bound microcomputer runtime metadata such as `ChipClass`,
  `FirmwareId`, `FirmwareRequired`, and `RuntimeMatchKey` through `.vdsp`
  parse/serialize round trips so hosts can distinguish chip-only identities
  from chip-plus-firmware descriptors.
- Warn when firmware-required IC metadata is incomplete, including missing
  `FirmwareId`, missing `RuntimeMatchKey`, incomplete runtime match tokens, or
  missing chip identity.

## 0.6.9

- Bump all publishable packages and internal workspace dependency pins for the
  `.vdsp` appearance schema release.
- Keep release metadata, docs, and built package artifacts aligned with the
  `0.6.9` package version.

## 0.6.8

- Add `createStompboxHardwareProfileFromVdsp()` and
  `createStompboxHardwareProfileFromDocument()` to derive generated-stub
  stompbox hardware profiles from existing `.vdsp` mechanical metadata.
- Add `.vdsp` v3 `appearance.kind` metadata so stompbox and amp visual design
  can be self-contained while remaining mutually exclusive.
- Add `createAmpProfileFromVdsp()` and `createAmpProfileFromDocument()` to
  derive generated/defaulted amp preview profiles from `.vdsp` panel controls.
- Document `.vdsp` as the portable source-visible CircuitDocument for
  schematic inspection and host-owned simulation/runtime lowering, while
  keeping provenance-only evidence outside the portable file.
- Add physical mount metadata for concentric panel controls, including `mountId`/`surface` parsing, model types, validation, and `.vdsp` round-trip coverage.
- Add stompbox concentric control support that collapses stacked dial surfaces into one drill hole while preserving per-surface preview and layout metadata.
- Add Control UI rendering for concentric knobs and panel jacks, plus docs for control semantics, physical controls, and CAD-style preview linework.
- Add `@vessel-dsp/visual-effects` for reusable Three.js toon, grain, and glitch preview effects.
- Add `@vessel-dsp/amp` and `@vessel-dsp/cabinet` for generated profile-based Three.js object graphs and GLB preview metadata.

## 0.6.7

- Add `.vdsp` `deviceInterface.controls[].audioBinding` parsing, validation,
  serialization, and public typing so physical control labels can bind to
  differently named audio/runtime controls without host-side alias tables.

## 0.6.6

- Bump version; add `crt` and `glitch` fields to previewPresets type in docs test.

## 0.6.5

- Add core-owned amp and cabinet preview profile schemas, readonly public
  types, and migration-friendly validators that can check artifact JSON without
  importing Three.js preview packages.
- Reuse the core amp/cabinet profile validators from `@vessel-dsp/amp` and
  `@vessel-dsp/cabinet` so preview packages and artifact tooling share one
  published contract.

## 0.6.4

- Add `.vdsp` control group membership records so one physical device-interface control can appear in multiple channel/context layouts without cloned control identities.
- Validate control group member references, context predicates, and duplicate member order while treating ordered memberships as the layout distinction for same-role physical controls.
- Expose resolved `extractDeviceInterface().groupMemberships` alongside one-row-per-physical-control device interface extraction.

## 0.6.3

- Fix the exported `VERSION` constant in source and built package artifacts so it matches the published package manifest.
- Add `@vessel-dsp/control-ui` as the optional React control-surface package for core `Panel` data, including default CSS, class hooks, and a theme provider.
- Add optional WebGL CRT and digital-glitch screen effects to the GitHub Pages stompbox GLB preview viewer (vendored from `gingerbeardman/webgl-crt-shader` and three.js `DigitalGlitch`, both MIT), with tunable scanlines, curvature, vignette, bloom, RGB shift, screen-space grain composited inside the CRT pass, and a randomized, motion-safe glitch schedule.

## 0.6.2

- Preserve `SourceOnly`, runtime ownership, source boundary, rail, source reference, and can-cap section metadata through schema-valid Circuit JSON source-property sidecars.
- Represent multi-section can capacitors as ordinary capacitor source components grouped with VesselDSP `source_group` metadata, and restore those groups on Circuit JSON import without treating generic groups or non-capacitors as can caps.
- Include source-only R/C parts and deterministic metadata comments in SPICE source/reference exports.

## 0.6.1

- Fix npm packaging so published tarballs build and ship `dist/` artifacts, omit `src/`, and keep all runtime export conditions pointed at compiled files.

## 0.6.0

- Add `circuit-interchange/v3` parsing and serialization for physical build metadata, including build scope, mechanical envelopes, BOM rows, part profiles, footprint catalogs, off-board wiring, physical panel placement, and board realizations.
- Add typed board realization support for stripboard, perfboard, breadboard-pattern protoboard, and fabricated PCB data with selected-build validation.
- Add explicit lossy-conversion handling for v3-only data, including `convertCircuitDocumentFileWithReport()` and `drop-with-diagnostics`.
- Export v3 model types and update package/API documentation for the v3 build-data contract.

## 0.5.0

- Pivot the repository to the single publishable `@vessel-dsp/core` package for headless `.vdsp`, `.asc`, `.schx`, and Circuit JSON conversion.
- Remove the reusable React component package, workspace-private simulation package, and repo-owned playground; GitHub Pages now publishes static core conversion API docs only.
- Add Circuit JSON import, validation, file conversion helpers, and LTspice `.asc` serialization.
- Add top-level `.vdsp` `controlGroups`, `controlContexts`, and `deviceInterface` metadata for stable semantic device controls.
- Preserve semantic controls, group/context registries, applicability predicates, bindings, and panel `interfaceControlId` joins through strict `circuit-interchange/v2` parse/serialize flows.
- Add `extractDeviceInterface()` so hosts can merge declared `.vdsp` controls with inferred panel, runtime descriptor, and external interface controls without mutating authored metadata.
- Validate semantic interface ids, group/context references, source bindings, external interface bindings, duplicate unordered roles, and panel semantic joins.
- Waive required electrical properties for interface-only/view-only controls while still validating present values.

## 0.4.0

- Move `.vdsp` / interchange documents to strict `circuit-interchange/v2`; v1 documents are rejected without migration or fallback parsing.
- Add recursive structured component property values so Source YAML can preserve runtime descriptor objects, arrays, numbers, booleans, nulls, and parsed quantities.
- Extract explicit LiveSPICE microblock descriptor metadata for tone stack, active EQ, delay, reverb, compressor, and octave descriptors without depending on legacy `Profile` strings.

## 0.3.2

- Add `JackPort.audioRole` and `JackAudioRole` for source-visible audio jack subtypes such as `guitar-input`, `bass-input`, `output-a-mono`, and `stereo-output-b`.
- Preserve and document `.vdsp` jack metadata split across broad `Role`, port-family `Interface`, explicit lower-kebab `AudioRole`, and display `JackLabel` / `Label` properties.

## 0.3.1

- Document and test the open component property-map contract, including passive `Material` metadata round-tripping and resistor material remaining preview-neutral.
- Add top-level `.vdsp` `device` and `controlOutputs` metadata for standalone non-audio control accessories such as Boss FS-5U footswitches.
- Preserve control accessory metadata through strict `.vdsp` parse/serialize flows, with schema validation for device kind and output switch mode values.

## 0.3.0

- Replace flat `.vdsp` panel placement metadata with named `panel.faces[]` surfaces containing bound `elements[]`, while keeping legacy `panel.layout` + `controls[]` input accepted and normalized.
- Emit the new `faces` / `elements` / `bind` / `kind` panel shape from the interchange serializer by default.
- Add panel validation warnings for unresolved component bindings, unresolved runtime controls, kind mismatches, and overlapping grid cells.
- Add `direct-output` as a first-class jack role and expose runtime descriptor `DirectOutputJack` metadata as `U1:direct-out` panel jack ports.
- Document the updated `.vdsp` panel placement contract and mark the implementation plan complete.

## 0.2.9

- Add top-level `.vdsp` `controlInterfaces` metadata for external trigger/reset, tempo tap, expression, and similar control inputs.
- Preserve `controlInterfaces` through strict `.vdsp` parse/serialize flows, including connector, assignment hint, polarity, description, optional visible jack component links, and runtime binding metadata.
- Export the `ControlInterface*` model types from the core API so hosts can consume external control metadata without depending on panel extraction.
- Project `controlInterfaces` into extracted `JackPort` descriptors while keeping external footswitch/control targets out of `SwitchControl` and runtime switch state.
- Document the producer contract for external control interfaces separately from layout-only stompbox panel placement, including DD-3-style `TRIGGER`/`RESET` and DD-5-style tempo-tap semantics.

## 0.2.8

- Add non-throwing `.vdsp` schema validation and include API reference docs in the published package.
- Preserve optional stompbox panel placement metadata through `.vdsp` parse and serialize flows.
- Expose runtime descriptor panel controls such as time, feedback, mix, stepped mode selectors, and tempo-tap external control inputs.
- Add source-rated Fulltone OCD revision-3 fixture coverage for dual-opamp MOSFET clipping pedal parsing.
- Add source-rated TC Electronic Dark Matter Distortion fixture coverage for MC33178 stages, LL4148 clipping, and active tone controls.

## 0.2.7

- Treat imported runtime descriptor ICs as validation-safe opaque descriptors when `RuntimeDescriptor: "true"` is present.
- Rename SPDT/SP3T/SP4T catalog terminals from BJT-style names to switch-specific common/throw terminals.
- Parse common electronics shorthand quantities such as `1k5`, `4u7F`, and `2R2`.
- Export JFETs to Circuit JSON as schema-valid depletion-mode FET source metadata with an explicit lossy-mapping warning.

## 0.2.6

- Add a headless Circuit JSON source-domain exporter for `CircuitDocument`, with fixture coverage against the official `circuit-json` schema.
- Add playground keyboard shortcuts for undo, redo, and tidy layout while preserving normal shortcut behavior in editable inspector fields.

## 0.2.5

- Preserve `.vdsp` source provenance fields such as `source.version` and `source.url` through interchange parse/serialize round trips.

## 0.2.4

- Import LiveSPICE audio-engine runtime descriptors as stable opaque IC components with runtime metadata, diagnostics, and non-stage `input`/`output` terminal geometry.
- Preserve stereo runtime fields such as `StereoOutputMode` as component metadata instead of synthesizing extra schematic jacks.

## 0.2.3

- Treat the playground Source tab as a copyable conversion view with a format dropdown that defaults to `.vdsp`, supports `.schx` and `.cir`, and removes the separate Raw source tab.
- Add stepped knob panel metadata for detented controls, including `StepLabels`, numeric detent counts, snapping helpers, and message validation that rejects between-step knob positions.
- Add slider/fader panel controls for potentiometer metadata such as `ControlStyle: "Slider"` / `"Fader"`, with normalized slider runtime state and optional range metadata for graphic EQ style controls.
- Render stepped knob and slider control state overlays in `SchematicView`.
- Remove the playground Live Panel tab and demo surface while keeping the reusable panel/control-state library APIs available to host apps.

## 0.2.1

- Make the playground Source YAML and Raw `.schx` views editable with undoable document replacement.
- Keep Live Panel synchronized with the current edited schematic and preserve tab selection when changing fixtures.
- Add LiveSPICE opaque `MicroBlock...Stage` support for grey-box pedal descriptors.

## 0.2.0

- Add `controlState` and `controlOverlay` props to `SchematicView` for live LED, knob, and switch visualization driven by the `panel` protocol.
- Document virtual-component injection for hosts whose indicators live outside the parsed schematic.
- Add a playground Live Panel demo.
