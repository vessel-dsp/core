## accuracy: dB of the WASM-console worklet over native (0 = match). Own = the native render at the arm's internal rate; 192k and 768k = native renders at those rates
| arm | internal | muff 8k own / 192k / 768k | sd1 8k own / 192k / 768k | ts9 8k own / 192k / 768k |
|---|---|---|---|---|
| 48k x1 | 48k | +0.000 / -2.220 / -2.348 | -0.000 / -1.210 / -1.346 | +0.000 / -1.254 / -1.420 |
| 48k os2 | 96k | +0.006 / -0.413 / -0.541 | +0.005 / -0.269 / -0.405 | +0.005 / -0.302 / -0.468 |
| 48k os4 | 192k | +0.007 / +0.007 / -0.121 | +0.006 / +0.006 / -0.130 | +0.006 / +0.006 / -0.159 |
| 96k x1 | 96k | -0.000 / -0.419 / -0.547 | -0.000 / -0.274 / -0.410 | -0.000 / -0.307 / -0.473 |
| 96k os2 | 192k | +0.002 / +0.002 / -0.126 | +0.002 / +0.002 / -0.134 | +0.002 / +0.002 / -0.164 |
| 96k os4 | 384k | +0.002 / +0.105 / -0.023 | +0.002 / +0.099 / -0.037 | +0.002 / +0.119 / -0.047 |
| 192k x1 | 192k | +0.000 / +0.000 / -0.128 | -0.000 / -0.000 / -0.136 | +0.000 / +0.000 / -0.166 |
| 192k os2 | 384k | +0.007 / +0.110 / -0.018 | +0.005 / +0.102 / -0.034 | +0.006 / +0.123 / -0.043 |

| arm | internal | muff 16k own / 192k / 768k | sd1 16k own / 192k / 768k | ts9 16k own / 192k / 768k |
|---|---|---|---|---|
| 48k x1 | 48k | +0.000 / -12.337 / -12.892 | +0.000 / -4.948 / -5.461 | +0.000 / -5.658 / -6.202 |
| 48k os2 | 96k | +0.010 / -1.893 / -2.448 | +0.009 / -0.950 / -1.464 | +0.010 / -1.068 / -1.612 |
| 48k os4 | 192k | +0.010 / +0.010 / -0.545 | +0.009 / +0.009 / -0.505 | +0.010 / +0.010 / -0.534 |
| 96k x1 | 96k | +0.000 / -1.903 / -2.458 | +0.000 / -0.959 / -1.473 | +0.000 / -1.079 / -1.623 |
| 96k os2 | 192k | +0.004 / +0.004 / -0.551 | +0.004 / +0.004 / -0.510 | +0.004 / +0.004 / -0.540 |
| 96k os4 | 384k | +0.004 / +0.450 / -0.105 | +0.004 / +0.368 / -0.146 | +0.004 / +0.389 / -0.155 |
| 192k x1 | 192k | -0.000 / -0.000 / -0.555 | -0.000 / -0.000 / -0.514 | -0.000 / -0.000 / -0.544 |
| 192k os2 | 384k | +0.001 / +0.447 / -0.108 | +0.001 / +0.366 / -0.148 | +0.001 / +0.386 / -0.158 |

## the owner table (WASM console; box load and the timing caveats are in the note)
| arm (host x factor) | internal | engine latency ms/slot | 3-pedal chain engine latency ms | quantum 128/H ms (arithmetic) | cost xRT muff / sd1 / ts9 / chain3 | mean block / deadline % muff / sd1 / ts9 / chain3 | p99 block / deadline % muff / sd1 / ts9 / chain3 | blocks over the deadline % muff / sd1 / ts9 / chain3 | STALLs | live ctx rtf sd1 / chain3 | NAM / IR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 48k x1 | 48k | 0.0000 | 0.0000 | 2.667 | 2.27 / 1.62 / 3.60 / 0.75 | 44 / 61 / 28 / 131 | 72 / 68 / 32 / 147 | 0 / 0.2 / 0 / 100.0 | 0 | 1.000 / 0.756 | 48 kHz NAM / IR as today |
| 48k os2 | 96k | 0.4063 | 1.2188 | 2.667 | 1.46 / 1.10 / 2.15 / 0.45 | 67 / 91 / 47 / 219 | 72 / 100 / 81 / 281 | 0 / 1.0 / 0 / 100.0 | 0 | 1.000 / 0.459 | 48 kHz NAM / IR as today |
| 48k os4 | 192k | 0.5469 | 1.6406 | 2.667 | 1.04 / 0.83 / 1.56 / 0.31 | 93 / 121 / 67 / 328 | 98 / 133 / 78 / 416 | 0.8 / 100.0 / 0.1 / 100.0 | 0 | 0.809 / 0.301 | 48 kHz NAM / IR as today |
| 96k x1 | 96k | 0.0000 | 0.0000 | 1.333 | 1.46 / 0.98 / 2.05 / 0.46 | 68 / 101 / 48 / 218 | 73 / 111 / 56 / 280 | 0.1 / 67.9 / 0 / 100.0 | 0 | 0.979 / 0.453 | NAM stating 48 kHz REFUSED; no-rate NAM and undeclared IR silently WRONG |
| 96k os2 | 192k | 0.2031 | 0.6094 | 1.333 | 1.06 / 0.82 / 1.51 / 0.32 | 93 / 124 / 66 / 312 | 105 / 149 / 107 / 345 | 2.2 / 100.0 / 1.0 / 100.0 | 0 | 0.802 / 0.318 | NAM stating 48 kHz REFUSED; no-rate NAM and undeclared IR silently WRONG |
| 96k os4 | 384k | 0.2734 | 0.8203 | 1.333 | 0.58 / 0.47 / 0.83 / 0.18 | 171 / 210 / 118 / 535 | 181 / 227 / 141 / 615 | 100.0 / 100.0 / 100.0 / 100.0 | 0 | 0.462 / 0.185 | NAM stating 48 kHz REFUSED; no-rate NAM and undeclared IR silently WRONG |
| 192k x1 | 192k | 0.0000 | 0.0000 | 0.667 | 0.81 / 0.55 / 1.07 / 0.25 | 125 / 185 / 93 / 395 | 157 / 230 / 113 / 469 | 100.0 / 100.0 / 4.0 / 100.0 | 0 | 0.543 / 0.247 | NAM stating 48 kHz REFUSED; no-rate NAM and undeclared IR silently WRONG |
| 192k os2 | 384k | 0.1016 | 0.3047 | 0.667 | 0.57 / 0.47 / 0.83 / 0.19 | 172 / 212 / 119 / 536 | 266 / 238 / 143 / 630 | 100.0 / 100.0 / 100.0 / 100.0 | 0 | 0.462 / 0.186 | NAM stating 48 kHz REFUSED; no-rate NAM and undeclared IR silently WRONG |

## dominance (computed, not judged): arm A dominates arm B if A is no worse than B on EVERY column and strictly better on at least one, within the tolerances
columns (all lower-is-better): |error vs native 768k| in dB at 8k and 16k for the three pedals (tolerance 0.02 dB; 20 kHz excluded); 3-pedal chain engine latency ms (0.001); quantum ms (0.0001);
mean block / deadline for muff, sd1, ts9, chain3 (tolerance 10 % relative); p99 block / deadline for muff, sd1, ts9, chain3 (tolerance 20 % relative: one run per cell, the p99 of a 48 kHz cell rests on 22 blocks).

### view 1: every column (accuracy, latency, quantum, mean and p99 block time for all four subjects)
  48k x1   not dominated
  48k os2  not dominated
  48k os4  not dominated
  96k x1   not dominated
  96k os2  not dominated
  96k os4  not dominated
  192k x1  not dominated
  192k os2 not dominated

### view 2: without the p99 columns (single-run tails) -- accuracy, latency, quantum, mean block time
  48k x1   not dominated
  48k os2  not dominated
  48k os4  DOMINATED by 96k os2
  96k x1   not dominated
  96k os2  not dominated
  96k os4  DOMINATED by 192k os2
  192k x1  not dominated
  192k os2 not dominated

### selected pairs, from view 1: A is better than B on the columns listed and worse on the others
  96k os2 against 48k os4: better on [latency 0.6094 vs 1.6406; quantum 1.3333 vs 2.6667]; worse on [p99 ts9 1.07 vs 0.78]
  96k x1 against 48k os2: better on [latency 0.0000 vs 1.2188; quantum 1.3333 vs 2.6667; p99 ts9 0.56 vs 0.81]; worse on [mean sd1 1.01 vs 0.91]
  192k x1 against 96k os2: better on [latency 0.0000 vs 0.6094; quantum 0.6667 vs 1.3333]; worse on [mean muff 1.25 vs 0.93; mean sd1 1.85 vs 1.24; mean ts9 0.93 vs 0.66; mean chain3 3.95 vs 3.12; p99 muff 1.57 vs 1.05; p99 sd1 2.30 vs 1.49; p99 chain3 4.69 vs 3.45]
  192k x1 against 48k os4: better on [latency 0.0000 vs 1.6406; quantum 0.6667 vs 2.6667]; worse on [mean muff 1.25 vs 0.93; mean sd1 1.85 vs 1.21; mean ts9 0.93 vs 0.67; mean chain3 3.95 vs 3.28; p99 muff 1.57 vs 0.98; p99 sd1 2.30 vs 1.33; p99 ts9 1.13 vs 0.78]
  192k os2 against 96k os4: better on [latency 0.3047 vs 0.8203; quantum 0.6667 vs 1.3333]; worse on [p99 muff 2.66 vs 1.81]
columns present for every arm: acc0, acc1, acc2, acc3, acc4, acc5, latency, quantum, mean muff, mean sd1, mean ts9, mean chain3, p99 muff, p99 sd1, p99 ts9, p99 chain3
