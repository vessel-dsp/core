# The `windings` construct

Sibling to [`devices`](./device-construct-design.md), and the same defect in a different shape.

## The problem in one sentence

A transformer's terminals belong to **coupled coils**, the format never said which, and every
consumer had to guess the grouping back out of terminal spellings.

## The measurement

55 transformers in the corpus, 363 terminals, and downstream a 110-entry table keyed on folded
terminal spellings — `primaryplus`, `hvreda345vac`, `powertubeheatercenter0v`, `tankreturnhot` —
mapping each to a `{ winding, end }` pair. The table reconstructs 12 winding classes:

| class | terminals | class | terminals |
|---|---|---|---|
| `primary` | 70 | `bias` | 17 |
| `secondary` | 59 | `secondaryalt3` | 7 |
| `hv` | 54 | `secondaryalt2` | 5 |
| `filament` | 40 | `secondaryalt` | 4 |
| `rectifierheater` | 20 | `secondaryline` | 1 |
| `lowvoltage` | 18 | `shield` | 1 |

(55 transformers, 363 terminals, counted after two files using a quoted-scalar style were found
to have been skipped by the first pass — the same shape that hid a pedal from an earlier backfill.)

`secondaryalt`, `secondaryalt2`, `secondaryalt3` and `secondaryline` are not four kinds of
winding. They are the table's way of saying "another secondary", because a `Record<string, …>`
keyed on a spelling has nowhere to put two coils with the same role. That is the tell: the
grouping is data, and it was being encoded in an identifier.

Every corpus terminal is in that table, which is exactly the problem. It covers the corpus
because it was written *from* the corpus, one packet at a time — the file's own docstring records
thirteen entries added for one Mesa Boogie power transformer. A transformer nobody has transcribed
yet contributes a spelling the table does not have, and the refusal names a winding class rather
than the real fault, which is that the document never said what its coils are.

## The construct

```yaml
- id: T1
  kind: transformer
  terminals:
    - name: primary_a
      role: winding
    - name: primary_b
      role: winding
    - name: hv_a
      role: winding
    - name: hv_center_tap
      role: windingTap
    - name: hv_b
      role: winding
  windings:
    - role: primary
      terminals:
        - primary_a
        - primary_b
    - id: hv
      role: hv
      terminals:
        - hv_a
        - hv_center_tap
        - hv_b
```

### Three rules

1. **A winding lists its terminals in coil order.** First and last are the ends; anything between
   is physically between them. Order is the only thing that can state a tap's position, and it is
   what a spelling table cannot recover: `secondary_4`, `secondary_8`, `secondary_16` are ordered
   by their names only by luck, and `hv_center_tap` says "centre" in prose.
2. **End versus tap comes from the terminal's own `role`,** which core already carries: `winding`
   for an end, `windingTap` or `windingCenterTap` for a tap. A winding entry therefore needs no
   per-terminal metadata — `role` plus ordered `terminals` is the whole entry.

   The two tap roles are the one thing a consumer cannot work out. A **centre tap** is the point
   the coil is referenced at, and both halves are live at once — that is what makes a full-wave
   rectifier full-wave and a push-pull primary push-pull. An **output tap** is one of several
   alternatives, of which a selector makes one live. Three consumer-side tests were tried and each
   was wrong on one shape: a grounded end finds the reference on a speaker winding but an output
   transformer's primary can have ground as an *end*; "every node carries a load" reads
   `orange-rockerverb`'s tapped secondary as centre-tapped, because every node of it does; and
   both kinds sit in the middle of the list. So it is declared.
3. **No terminal belongs to two windings.** Coupled coils share no conductor. An autotransformer
   is one tapped winding, not two overlapping ones, so a shared terminal is an error rather than a
   shape to support.

### Roles may repeat

`orange-rockerverb`'s power transformer carries **two filament windings** — a 3.15-0-3.15 V pair
for the power tube heaters and a separate 6.3 V pair for the preamp. A record keyed on a role, or
on a terminal spelling, has nowhere to put the second; the spelling table collapsed both into one
`filament` class. Windings are distinguished by their terminals, and by an optional `id` when a
consumer or a reader wants to name one. This is also what deletes `secondaryalt3`.

### Ten roles

`primary`, `secondary`, `hv`, `filament`, `rectifier-heater`, `bias`, `low-voltage`, `auxiliary`,
`drive`, `pickup`.

The first eight are the corpus's classes with the `alt`/`line` suffixes folded away. `drive` and
`pickup` are for a spring reverb tank, where neither coil transforms the other's voltage: one
drives the springs and one picks up what comes back. The table calls the tank's coils `secondary`
and `secondaryalt`, which is exactly wrong about what it is — and a reverb tank is the one
`transformer`-kind component in the corpus that is not a transformer.

There is deliberately no `shield` role. `tycobrahe-octavia`'s T1 brings out a `shield_nc` pin, and
a shield is a grounded foil between windings rather than a coil, so `role: shield` on the terminal
is the whole statement and no winding entry couples it.

### Declaring nothing is a valid statement

Absent and empty mean the same thing — this component has no declared coils — so an empty list is
dropped on parse rather than carried, and nothing is emitted for the components that are not
transformers.

## What connectivity still owns, and windings must not

The old table's `end` vocabulary contained two values that are not winding structure at all:

- **`unconnected`** — a tap this document wires to nothing. Six terminals. That is a fact about
  the nodes ledger, readable from it.
- **`selectable`** — a mains tap going into a voltage selector. Four table entries, none of them
  reached by any corpus document today. Which tap is live is a property of the selector switch,
  not of the transformer; the table's own comment records an earlier pass that hard-coded one
  packet's stated 240 V assumption as a rule for every document, which would have strapped 240 V
  across a US-market amp that spelled its taps the same way.

Both stay derived. A declaration that repeated them would let a document assert a connectivity
fact that contradicts its own wiring.

## Validation core owes

Errors: unknown role, a terminal name no terminal has, a terminal listed twice in one winding, the
same terminal claimed by two windings, an empty terminal list, a duplicate `id`.

Warnings: a single-terminal winding (real — a bias tap whose return is grounded inside the
transformer — but usually a transcription that stopped early), and a terminal with a winding role
that no winding couples.

Across the backfilled corpus that is 11 warnings and no errors. All 11 are single-ended `bias`
windings, which is the legitimate case the warning names.

## What it deletes downstream

In `vessel-dsp/workbench`, `src/compiler/transformer.ts`'s 110-entry `transformerTerminalRoles`
table and the winding-class reconstruction around it, plus `lower.ts`'s `springReverbTerminalRoles`
— the last remaining terminal-spelling vocabulary in that file.

## Open questions

1. **Turns ratio.** Ratio lives in component properties today and the corpus states it per
   transformer, which works while every transformer has one primary. A three-winding output
   transformer with two independent ratios would need it per winding.
2. **Winding polarity.** Coil order gives each winding an orientation, but nothing states the
   relative phase *between* two windings — the dot convention. No corpus document depends on it,
   and inverting a speaker winding is inaudible in a single-transformer signal path.
3. **Switch poles.** 232 contact spellings are waiting on the same shape: one mechanism, several
   grouped contacts. A pole is closer to a winding than to a device.
