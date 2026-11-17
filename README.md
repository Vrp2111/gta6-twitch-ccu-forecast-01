[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Vrp2111/gta6-twitch-ccu-forecast-01/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Vrp2111/gta6-twitch-ccu-forecast-01/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![make.fun](https://make.fun/badge.svg)](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

# GTA VI Twitch CCU Forecaster

Predicts Twitch concurrent viewers for the GTA VI category, hours 2–24 on release day, from the hour-1 value plus 38 comparator games. The median forecast is the geometric mean of (a) an aligned-jump kernel — the release-day shape aligned across timezones and unlock times — and (b) a local-linear regression of ln(v_h) on ln(v1). The prediction spread comes from the kernel, and an extrapolation guard keeps forecasts sane when hour-1 falls outside the comparator range.

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22, standard library only.

## Practice score

Mean pinball loss **0.1682** over 4 practice cases (p00 0.1813, p01 0.1507, p02 0.1420, p03 0.1987), against a house baseline of 0.3871.

## Links

- Competition: https://make.fun/bounty/gta6-twitch-ccu-forecast-01
- Owner: vrp2111
- Referral code: `s75rqb78`
