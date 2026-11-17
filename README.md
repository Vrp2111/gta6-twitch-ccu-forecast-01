[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Vrp2111/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Vrp2111/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![make.fun](https://make.fun/badge.svg)](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

# GTA VI Twitch CCU Forecaster

Forecasts how many people watch Grand Theft Auto VI live on Twitch in each hour
of its release day (hours 2–24, UTC), from the first hour's viewer count plus the
hourly histories of 38 past big game launches. The median is the geometric mean
of (a) an aligned-jump kernel — day shapes aligned by timezone/unlock — and
(b) a local-linear regression of ln(v_h) on ln(v1), with the local-linear weight
ADAPTIVE to the first hour's size: 0.75 when hour 1 is below 50k viewers, 0.5
between 50k and 200k, and 0.35 at 200k or above (small launches lean on the
local-linear shape, big launches lean on the kernel). The spread comes from the
kernel, and an extrapolation guard clamps the forecast when hour 1 falls outside
the comparables' range.

## Run

Node 22, standard library only, no network:

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `<id>.in` case in the input directory and writes `<id>.out` with
23 rows (hours 2–24), five quantiles each (5%, 25%, 50%, 75%, 95%).

## Practice score

Mean pinball loss on the log scale over the four practice launches:
**0.1568** (p00 Wolverine 0.1454, p01 Red Dead Redemption 2 0.1600,
p02 God of War Ragnarök 0.1278, p03 Marvel's Spider-Man 2 0.1941).
House baseline: 0.3871. Chosen from 30 variants (round 1 + iterative
round 2 in 4 batches, each batch evaluated and the next designed to attack
the previous batch's weakest hours and cases).

## Links

- Bounty: https://make.fun/bounty/gta6-twitch-ccu-forecast-01
- Referral: `s75rqb78`
- Owner: vrp2111
