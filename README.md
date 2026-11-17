[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Vrp2111/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Vrp2111/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![make.fun](https://make.fun/badge.svg)](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

# GTA VI Twitch CCU Forecaster

Forecasts how many people watch Grand Theft Auto VI live on Twitch in each
hour of its release day (hours 2–24), from the first hour's viewer count plus
the hourly histories of 38 past big game launches.

## Design (V278)

The median forecast blends two views of the launch day: (a) an aligned-jump
kernel — comparable day shapes aligned by their biggest morning jump
(window hours 4–10, bandwidth 0.65, kernel pool excludes jump == 4) — and
(b) a local-linear OLS regression of ln(v_h) on ln(v1). Four extreme
comparables are trimmed (Silksong, HELLDIVERS 2, Marvel Rivals, Starfield),
a full bias-correction table BIAS[h] (mean, ×1.0) is applied to every hour,
and the midday (hours 10–15) local-linear weight is boosted ×1.5 (capped at
1.00).

The spread is the kernel's quantile spread scaled by
f = (fHour × fSize / 0.60) × hourMult: fHour is 0.80 inner / 0.50 outer in
hours 12–18 and 0.60 / 0.35 elsewhere (inner = 25%/50%/75% quantiles);
fSize is 0.80 for mid-size launches (50k–200k hour-1 viewers) and 0.24 at
the ends; hourMult is ×4.0 at hour 3, ×2.5 at hour 5, ×1.5 at hour 12.
The blend weight w_L starts at 0.85 (<50k) / 0.5 (50–200k) / 0.4 (≥200k)
and is multiplied by a per-hour grid (1.4 / 1.4 / 1.0 / 1.0 / 1.0). An
extrapolation guard clamps the median when hour 1 exceeds 875k viewers.

New in V278 — the S168 mechanism: the case's own pre-release history is
read as an extra signal. S168 is the OLS slope of ln(viewers+1) over the
case's `history_hourly` in the 168 hours before hour 1 (at least 24 points
required, otherwise no shift). It measures how gradual the 7-day pre-launch
ramp was: a steady week-long build fades faster at midday, a sudden
last-day explosion sustains. At hours 10–15 only, the log-median is shifted
by −25.4 × (S168 − 0.04369).

## Run

Node 22, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `<id>.in` case in the input directory and writes `<id>.out`
with 23 rows (hours 2–24), five quantiles each (5%, 25%, 50%, 75%, 95%).

## Practice score

Mean pinball loss on the log scale over the four practice launches:
**0.0798** (p00 Wolverine 0.0627, p01 Red Dead Redemption 2 0.1078,
p02 God of War Ragnarök 0.0513, p03 Marvel's Spider-Man 2 0.0976).
House baseline: 0.3871. Chosen from 280 variants (round 1: 10, iterative
round 2: 20, iterative round 3: 250), each batch evaluated and the next
designed to attack the previous batch's weakest hours and cases.

## Links

- Bounty: https://make.fun/bounty/gta6-twitch-ccu-forecast-01
- Referral: `s75rqb78`
- Owner: vrp2111
