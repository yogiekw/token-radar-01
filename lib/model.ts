// Token Radar model, version radar-2.
//
// One sealed snapshot in, one ranked board out. Every number below is computed
// from the snapshot's own ten fields per protocol; no protocol name is ever
// special-cased, and the same function scores every row.
//
//   implied = round(tvl x categoryMultiple x growthMult x maturityMult
//                   x chainMult x versionDiscount)
//
// categoryMultiple — why categories differ. A trading or lending protocol's
// token can capture a share of the fees its TVL earns, so its TVL converts
// to token value at a higher rate. A curator, allocator or RWA vault mostly
// holds other people's assets and charges a thin fee, so the same TVL
// converts at a much lower rate. The table is keyed on the category string
// alone, so a protocol that does not exist yet and lands in a category
// tomorrow is scored by the same rule.
//
// growthMult — 1 + clamp(change_7d, -60, 120) / 100 x 0.6. A protocol whose
// TVL is growing fast is worth more than a shrinking one of the same size,
// but one hot week cannot more than double the value, and one bad week
// cannot cut it by more than about a third.
//
// maturityMult — 0.70 + min(age_days, 1095) / 1095 x 0.50. Age is the days
// from listed_at to the snapshot's as_of: the longer a protocol has run
// with no token on record, the more mature the launch candidate. Unknown
// age counts as 365 days. Capped at three years.
//
// chainMult — 1 + 0.025 x min(chains - 1, 8), at most 1.20. A protocol live
// on more chains has more places to farm and more users to reward, but
// the eighth extra chain adds nothing new.
//
// versionDiscount — 0.85 when the name ends in a version marker (V2, v3,
// 2.0 and the like). A versioned pool may be one deployment of a protocol
// whose token already trades elsewhere, so it is discounted, never trusted
// at full value.
//
// Board selection, in tiers, all pre-token (no market cap, no CoinGecko id,
// no symbol on record):
//   A  every watchlist slug (40, the floor, never the ceiling);
//   B  rankable protocols above the watchlist floor the watchlist rule left
//      out, by TVL (20 here: they record no token and are not a wrapped,
//      staked or bridged product, so the radar re-includes them);
//   C  rankable protocols below the floor, by TVL (138 here);
//   D  the 2 largest versioned-name pre-token protocols below the floor,
//      discounted as above, so the board reaches 200 rows.
// Rankable means: pre-token, category not Bridge / Canonical Bridge /
// Liquid Staking / Liquid Restaking / Restaked BTC / CEX, name carrying no
// whole word wrapped, staked or staking, not starting with an exchange
// name, and (except tier D) not ending in a version marker. Live-token
// protocols are never ranked; the dashboard shows the biggest ones apart,
// at their market cap, never as an implied value.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  version_discount: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.025,
  chain_max_extra: 8,
  version_discount: 0.85,
};

export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Board size the tiers are sized to reach. */
export const BOARD_ROWS = 200;

export interface ModelBreakdown {
  category_multiple: number;
  base_usd: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  version_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  tier: 'watchlist' | 'above-floor' | 'below-floor' | 'versioned';
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  tier: string;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  tier_counts: Record<string, number>;
  total_implied_usd: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from listed_at to as_of, at least 0; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * The category multiple, from the category string alone. Fee-capturing
 * trading and lending convert TVL best; vaults, curators and RWA, whose
 * TVL is mostly custodied assets earning a thin fee, convert worst.
 */
export function categoryMultiple(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator') || c.includes('allocator')) return 0.14;
  if (c.includes('rwa')) return 0.16;
  if (c.includes('bridge') || c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restaked')) return 0.08;
  if (c.includes('dex') || c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return 0.4;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 0.38;
  if (c.includes('yield aggregator') || c.includes('leveraged farm')) return 0.36;
  if (c.includes('yield') || c.includes('liquidity manager') || c.includes('farm')) return 0.34;
  if (c.includes('basis')) return 0.3;
  if (c.includes('prediction') || c.includes('launchpad') || c === 'chain') return 0.3;
  if (c.includes('stable') || c.includes('payment') || c.includes('insurance')) return 0.28;
  return 0.25;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isVersioned(p: SnapshotProtocol): boolean {
  return VERSIONED.test(p.name);
}

/** Pre-token, and not a wrapped / staked / bridged product or an exchange. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return !isVersioned(p);
}

/** The full scoring of one protocol: every multiplier and the implied value. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, p.listed_at);
  const catMult = categoryMultiple(p.category);
  const base = p.tvl_usd * catMult;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.max(0, Math.min(p.chains.length - 1, model.chain_max_extra));
  const chainMult = 1 + model.chain_step * extraChains;
  const versionMult = isVersioned(p) ? model.version_discount : 1;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult * versionMult));
  return {
    implied,
    breakdown: {
      category_multiple: catMult,
      base_usd: Math.round(base),
      growth_pct: growthPct,
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      chain_multiplier: round4(chainMult),
      version_multiplier: versionMult,
      age_days: age,
    },
  };
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

function byTvlDesc(a: SnapshotProtocol, b: SnapshotProtocol): number {
  return b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

/** The ranked board: tiers A-D, scored, sorted by implied value, ranks 1..N. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, { p: SnapshotProtocol; tier: BoardRow['tier'] }>();
  const take = (p: SnapshotProtocol, tier: BoardRow['tier']): void => {
    if (!chosen.has(p.slug)) chosen.set(p.slug, { p, tier });
  };
  // Tier A — the watchlist, every slug, whatever its category.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) take(p, 'watchlist');
  }
  // Tier B — rankable protocols above the floor the watchlist left out.
  const above = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd >= snapshot.floor_usd)
    .sort(byTvlDesc);
  for (const p of above) take(p, 'above-floor');
  // Tier C — rankable protocols below the floor, by TVL.
  const below = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort(byTvlDesc);
  for (const p of below) take(p, 'below-floor');
  // Tier D — fill to BOARD_ROWS with the largest versioned-name pre-token
  // protocols below the floor (discounted in scoreProtocol). Only as many
  // as the board still needs, so the tier never displaces a rankable row.
  const need = BOARD_ROWS - chosen.size;
  if (need > 0) {
    const versioned = snapshot.protocols
      .filter((p) => !chosen.has(p.slug) && isPreToken(p) && isVersioned(p) && p.tvl_usd < snapshot.floor_usd && (p.category === null || !EXCLUDED_CATEGORIES.has(p.category)))
      .sort(byTvlDesc)
      .slice(0, need);
    for (const p of versioned) take(p, 'versioned');
  }

  const scored = [...chosen.values()].map(({ p, tier }) => {
    const { implied, breakdown } = scoreProtocol(p, snapshot.as_of, model);
    return { p, tier, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    tier: s.tier,
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    model: s.breakdown,
    farm_steps: farmSteps(s.p, s.breakdown.age_days),
  }));
}

/** One farm step as a single string: action, then cost and time. */
export function stepText(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 300;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 120;
  return 60;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main farming action, in words a reader can follow. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares, so the curator's fee and any points accrue to this wallet`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset on ${name} on ${chain} and hold it in the farming wallet, keeping the mint receipt`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to the most active ${name} pool on ${chain}, in the pair the pool page lists first, and keep the position open`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it once, so both sides of the position are recorded`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then close it after a day`;
  if (c.includes('yield aggregator') || c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} of USDC into the highest-TVL ${name} strategy on ${chain} and leave it compounding`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into the ${name} basis strategy on ${chain} and hold the position through one funding cycle`;
  if (c.includes('prediction')) return `Fund the wallet with $${capital} and place one small prediction-market position on ${name}, then settle or close it`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds inside the destination app the same day`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full cover period`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the farming wallet`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open, using only the protocol's own app`;
}

/**
 * A protocol's farm plan: seven steps, each with a cost and a time, derived
 * from the protocol's own record (category, chains, TVL, age) — never from
 * a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = firstChain(p);
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 200 ? 8 : 4;
  const steps: Array<[string, string, string]> = [
    [
      `Use a fresh wallet that holds only the $${capital} you plan to farm with, write its seed phrase on paper, and never sign a link from a chat or a search ad`,
      'under $3 of gas for the first transaction',
      '5 minutes',
    ],
    [
      mainAction(p, capital, chain),
      `$${capital} of capital and about $${gas} of gas`,
      '15 minutes to set up',
    ],
    second === null
      ? [
          `Repeat the same action once more with half the capital, $${Math.floor(capital / 2)}, on ${chain} a week later, so the wallet shows activity in two separate weeks`,
          `$${Math.floor(capital / 2)} of capital and about $${gas} of gas`,
          '10 minutes',
        ]
      : [
          `Repeat the main action on ${second} with $${Math.floor(capital / 2)} so the wallet is active on two chains, not one`,
          `$${Math.floor(capital / 2)} of capital and about $${gas} of gas`,
          '15 minutes',
        ],
    [
      `Do one qualifying action every week on ${chain}, such as a deposit, a swap, a borrow, a vote or a claim, and never leave the wallet idle for a whole month`,
      'about $2 of gas a week',
      '10 minutes a week',
    ],
    [
      `Hold the main position for at least ${hold} days, through at least two monthly snapshots, before you consider withdrawing any of it`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ],
    [
      `Before you withdraw, open the protocol's own points or rewards page from its own app and claim only from the link it publishes, and never pay a fee to claim`,
      'no fee to check, and never pay to claim',
      '10 minutes',
    ],
    [
      `Write the wallet address, the dates and every transaction hash in a farm log, then unwind in two tranches a week apart so one bad exit does not trap the whole position`,
      'nothing but the log, plus gas on the exits',
      '5 minutes to log, a week to unwind',
    ],
  ];
  return steps.map(([a, c, t]) => stepText(a, c, t));
}

/** The live-token protocols, by market cap: the market's own value, never a model. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    tier: row.tier,
    model: row.model,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const tierCounts: Record<string, number> = {};
  for (const r of board) tierCounts[r.tier] = (tierCounts[r.tier] ?? 0) + 1;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    tier_counts: tierCounts,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
