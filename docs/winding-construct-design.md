# The `windings` construct

Sibling to [`devices`](./device-construct-design.md), and the same defect in a different shape.

## The problem in one sentence

A transformer's terminals belong to **coupled coils**, the format never said which, and every
consumer had to guess the grouping back out of terminal spellings.

## The measurement

53 transformers in the corpus, 296 terminals, and downstream a 110-entry table keyed on folded
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
   for an end, `windingTap` for a tap. A winding entry therefore needs no per-terminal metadata —
   `role` plus ordered `terminals` is the whole entry.
3. **No terminal belongs to two windings.** Coupled coils share no conductor. An autotransformer
   is one tapped winding, not two overlapping ones, so a shared terminal is an error rather than a
   shape to support.

### Roles may repeat

Two `secondary` coils on one magnetic is ordinary — a speaker winding and a constant-voltage line
output. Windings are distinguished by their terminals, and by an optional `id` when a consumer or
a reader wants to name one. This is what deletes `secondaryalt3`.

### Eleven roles

`primary`, `secondary`, `hv`, `filament`, `rectifier-heater`, `bias`, `low-voltage`, `auxiliary`,
`shield`, `drive`, `pickup`.

The first nine are the corpus's classes with the `alt`/`line` suffixes folded away. `drive` and
`pickup` are for a spring reverb tank, where neither coil transforms the other's voltage: one
drives the springs and one picks up what comes back. The table calls the tank's coils `secondary`
and `secondaryalt`, which is exactly wrong about what it is — and a reverb tank is the one
`transformer`-kind component in the corpus that is not a transformer.

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
