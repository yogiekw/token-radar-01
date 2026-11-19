# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/yogiekw/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/yogiekw/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar — pre-token protocols ranked by implied value.

Entry for make.fun's **Build the best token launch radar** (token-radar-01).

A program (`main.ts`, Node 22, standard library only) reads a frozen
DefiLlama snapshot of 758 protocols, scores every protocol that records no
token, and writes a ranked board of 200 rows plus a static, no-network
dashboard.

## The model (radar-2)

```
implied = round(TVL x category multiple x growth x maturity x chain breadth x version discount)
```

- **Category multiple** — fee-capturing trading and lending convert TVL best
  (Dexs / Derivatives 0.40, Lending / CDP 0.38); vaults, curators and RWA,
  whose TVL is mostly custodied assets earning a thin fee, convert worst
  (Risk Curators / Allocators 0.14, RWA 0.16); everything else 0.25–0.36.
- **Growth** — 1 + clamp(7-day TVL change, −60%, +120%) / 100 × 0.6.
- **Maturity** — 0.70 + min(age, 3 years) / 3 years × 0.50, where age is the
  time since DefiLlama first listed the protocol; unknown age counts as
  365 days.
- **Chain breadth** — +2.5% per extra chain, up to 8.
- **Version discount** — 0.85 for a versioned name (V2, v3, 2.0).

No protocol name is special-cased: the same function scores every row, from
the snapshot's own figures alone.

## Board selection (200 rows)

- **Watchlist (40)** — every watchlist slug, the floor, never the ceiling.
- **Above floor (20)** — rankable protocols above the $50M floor the
  watchlist rule left out, by TVL.
- **Below floor (138)** — rankable pre-token protocols below the floor, by TVL.
- **Versioned (2)** — the largest versioned-name pre-token protocols below
  the floor, discounted as above.

Rankable means pre-token and not a wrapped, staked or bridged product or an
exchange. Protocols whose token already trades are set aside in the Live
tab at their market cap, never as an implied value. Each row carries a
7-step farm plan with a cost and a time per step, derived from the
protocol's category, chains, TVL and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Writes `out/board.json`, `out/data.js`, `out/dashboard/`,
`out/screenshots/` and `out/dossier.json`. Two runs on the same snapshot
write identical bytes.

## Layout

- `main.ts` — entrypoint: snapshot in, board + dashboard + dossier out.
- `lib/model.ts` — the model, board selection and farm plans.
- `vendor/makefun-board.ts` — make.fun's dossier library, byte for byte
  from the kit.
- `dashboard/` — the static page (`index.html`, `app.css`, `app.js`).
- `screenshots/` — board, detail and filtered views of the dashboard.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
