/* Indicator / metric registry — the single source of truth. The screener
   columns, the asset-view chart toggles and the asset stat header are all
   generated from this. Adding a metric or a future proprietary indicator
   (Buzz Score, composite…) is one entry here, not a new page/card.

   Fields:
     id        unique key
     label     display name
     category  market | social | community | onchain | signal
     series    asset field holding the daily series (for charts/deltas)
     vkey      value key inside a series point
     format    usd | price | pct | num | score   (see fmtBy in lib.js)
     latest(a) current value (screener cell + asset stat)
     deltas    which %-change columns to derive (via pctOverDays)
     chart     present => togglable as an indexed overlay on the asset chart
     spark     present => draw a mini price sparkline in the screener
*/
const METRICS = [
  {
    id: "price", label: "Prix", category: "market",
    series: "prices", vkey: "price", format: "price",
    latest: (a) => a.prices?.at(-1)?.price ?? null,
    deltas: [1, 7, 30, 90], chart: true, spark: true, chartDefault: true,
  },
  {
    id: "volume", label: "Volume", category: "market",
    series: "prices", vkey: "volume", format: "usd",
    latest: (a) => a.prices?.at(-1)?.volume ?? null,
    deltas: [7, 30, 90], chart: true,
    help: {
      what: "Volume 24h <b>agrégé sur tous les échanges</b> (source CoinGecko : CEX + DEX rapportés) — pas une seule plateforme.",
      read: "C'est le volume marché total. Une hausse de volume + prix stable peut signaler une accumulation ; volume + pompe = FOMO.",
      example: "Le volume CHOG additionne toutes ses paires DEX Monad ; celui de BTC additionne Binance, Coinbase, OKX… (déjà consolidé).",
    },
  },
  {
    id: "mcap", label: "Market cap", category: "market", format: "usd",
    latest: (a) => a.marketCap ?? null,
  },
  {
    id: "tvl", label: "TVL", category: "onchain",
    series: "tvl", vkey: "tvl", format: "usd",
    latest: (a) => a.tvl?.at(-1)?.tvl ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "mentions", label: "Mentions X", category: "social",
    series: "mentions", vkey: "count", format: "num",
    latest: (a) => a.mentions?.at(-1)?.count ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "discord", label: "Membres DC", category: "community",
    series: "discord", vkey: "members", format: "num",
    latest: (a) => a.discord?.at(-1)?.members ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "telegram", label: "Telegram", category: "community",
    series: "telegram", vkey: "members", format: "num",
    latest: (a) => a.telegram?.at(-1)?.members ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "holders", label: "Holders", category: "onchain",
    series: "holders", vkey: "holders", format: "num",
    latest: (a) => a.holders?.at(-1)?.holders ?? null,
    deltas: [7, 30, 90], chart: true,
  },
  {
    id: "holders50", label: "Holders ≥$50", category: "onchain",
    series: "holderTiers", vkey: "h50", format: "num",
    latest: (a) => a.holderTiers?.at(-1)?.h50 ?? null,
    deltas: [7, 30, 90], chart: true,
    help: {
      what: "Nombre de holders dont le solde vaut <b>au moins $50</b> au prix du jour — filtre la poussière (airdrops abandonnés, restes de swaps) pour ne compter que les porteurs réels.",
      read: "Sa <b>croissance</b> compte plus que son niveau : +5%/semaine = de vrais nouveaux porteurs, pas des wallets à 3 centimes.",
      example: "CHOG affiche 33K holders mais seulement ~15K valent ≥$50 : la base « engagée » est moitié moindre — et c'est elle qu'il faut suivre.",
      quality: "Disponible uniquement où l'on voit chaque solde (CHOG + memes Solana). « — » ailleurs.",
    },
  },
  {
    // From the CHOG PnL ledger (replayed transfer history × daily prices).
    id: "inprofit", label: "% en gain", category: "onchain",
    series: "pnl", vkey: "pctInProfit", format: "pctraw",
    latest: (a) => lastValue(a.pnl, "pctInProfit"),
    deltas: [7, 30], chart: true,
    help: {
      what: "Part des <b>acheteurs</b> (coût moyen d'entrée réel, reconstruit depuis chaque transfert au prix du jour) dont le coût est inférieur au prix actuel. La <b>cohorte airdrop (coût $0) est exclue</b> — en gain par construction, elle figeait le % vers 79% en permanence.",
      read: "<b>>85%</b> = presque tous les acheteurs gagnent — zone historique de distribution (les tops se forment quand il n'y a plus personne à mettre en gain) · <b><40%</b> = majorité sous l'eau, vendeurs épuisés potentiels.",
      example: "CHOG à 90% en gain après une montée : chaque holder est tenté de prendre profit — la table des tranches dit qui (petits ×1-2 ou gros ×10+).",
      quality: "Estimation : prix du jour (pas du swap exact), transferts P2P héritent du coût, airdrops = coût zéro. Grand livre CHOG uniquement — « — » ailleurs.",
    },
  },
  {
    id: "flowratio", label: "Pression achat", category: "market",
    series: "tradeflow", vkey: "ratio", format: "pctraw",
    latest: (a) => a.tradeflow?.at(-1)?.ratio ?? null,
    deltas: [7, 30], chart: true,
    help: {
      what: "Part du volume <b>acheteur</b> dans le volume total : 50% = équilibre, >50% = pression acheteuse, <50% = vendeuse.",
      read: "En <b>$ réels</b> (taker buy/sell), <b>agrégé multi-venues</b> : Binance + OKX pour le spot, OKX pour les perps (FARTCOIN/MON/HYPE) ; <b>on-chain tous pools</b> (GeckoTerminal) pour les tokens DEX (CHOG/CASHCAT/ANSEM/BRETT). L'arbitrage aligne les venues, mais toutes les bourses ne sont pas couvertes — c'est un proxy solide du flux réel.",
      example: "PEPE à 47% d'achat pendant que son prix monte = la hausse se vend dans le carnet (méfiance) ; 58% pendant une baisse = accumulation dans la chute.",
    },
  },
  {
    // Proprietary indicator (M4). Computed client-side from the mention series
    // in lib.js (attached as a.buzz) — plugs into the registry like any metric.
    id: "buzz", label: "Buzz Score", category: "signal",
    series: "buzz", vkey: "buzz", format: "z",
    latest: (a) => lastValue(a.buzz, "buzz"),
    help: {
      what: "Intensité des mentions X <b>par rapport à la norme de l'actif lui-même</b> (z-score vs sa moyenne 30j). Rend BTC et CHOG comparables malgré des volumes 100× différents.",
      read: "<b>+2σ</b> = pic d'attention rare (le buzz est 2 écarts-types au-dessus de sa normale) · <b>0</b> = journée ordinaire · <b>−1σ</b> = attention en berne.",
      example: "CHOG passe de 400 à 900 mentions/jour : en absolu c'est peu face aux 90 000 de BTC, mais son Buzz monte à +3σ → il se passe quelque chose <i>chez CHOG</i>.",
      quality: "IC ≈ +0.06 à +0.08 — signal faible mais réel, surtout pour <b>classer les memes entre eux</b>.",
    },
  },
  {
    // Proprietary indicator (M7): relative community velocity.
    id: "velocity", label: "Vélocité comm.", category: "signal",
    series: "velocity", vkey: "vel", format: "signed",
    latest: (a) => lastValue(a.velocity, "vel"),
    chart: true,
    help: {
      what: "Croissance communautaire sur 7 jours (holders + membres Telegram) <b>moins la médiane de son groupe</b> le même jour. Mesure les <b>parts d'attention</b> : grandir ne suffit pas, il faut grandir plus vite que les autres.",
      read: "<b>+2</b> = la communauté croît 2 points de % plus vite que le meme médian cette semaine · <b>0</b> = dans la moyenne · <b>négatif</b> = elle perd du terrain relatif, même si elle grossit en absolu.",
      example: "CHOG +4%/7j de holders quand la médiane des memes fait +1% → vélocité +3 : la communauté gagne des parts. Si tous font +4%, vélocité 0 — c'est le marché, pas CHOG.",
      quality: "⏳ Indicateur neuf : son IC sera mesuré comme les autres après accumulation d'historique (le calcul démarre dès aujourd'hui sur les données existantes).",
    },
  },
  {
    // Proprietary indicator (M8): the daily 0-100 composite verdict.
    id: "composite", label: "Score composite", category: "signal",
    series: "composite", vkey: "score", format: "num",
    latest: (a) => lastValue(a.composite, "score"),
    chart: true,
    help: {
      what: "Tous nos signaux en <b>un chiffre 0-100</b> : Pression achat, Divergence, Buzz et Vélocité (chacun en z-score, borné à ±3σ), <b>pondérés par leur IC réellement mesuré</b> sur nos données — recalculé à chaque chargement, pas des poids d'intuition.",
      read: "<b>50</b> = journée neutre · <b>>65</b> = plusieurs signaux validés s'alignent au-dessus de leur norme (configuration rare) · <b><35</b> = signaux dégradés. À lire comme un baromètre quotidien, pas un ordre d'achat.",
      example: "Divergence +1.8σ, pression achat 58% (+1.2σ), buzz +0.5σ → composite ≈ 72 : l'attention monte, les acheteurs dominent, le prix n'a pas encore suivi — le cas d'école de l'accumulation silencieuse.",
      quality: "Les poids suivent les IC mesurés (Pression ≈ 0.3, Divergence ≈ 0.13, Buzz ≈ 0.07, Vélocité provisoire 0.05). Le composite lui-même sera backtesté (IC) sur la page Signaux une fois assez d'historique accumulé.",
    },
  },
  {
    // Proprietary indicator (M5-lite): normalized attention − normalized price.
    // High positive = attention leading price (silent accumulation).
    id: "divergence", label: "Divergence", category: "signal",
    series: "divergence", vkey: "div", format: "signed",
    latest: (a) => lastValue(a.divergence, "div"),
    help: {
      what: "Écart entre l'attention normalisée et le prix normalisé : <b>z(mentions) − z(prix)</b>. Mesure si le buzz devance le prix, ou l'inverse.",
      read: "<b>Positif</b> = l'attention monte plus que le prix → <b>accumulation silencieuse potentielle</b> · <b>Négatif</b> = le prix a déjà décollé sans le buzz (essoufflement possible).",
      example: "Les mentions CHOG grimpent à +2σ mais le prix reste plat (0σ) → Divergence ≈ +2 : la foule s'intéresse avant que le prix ne bouge.",
      quality: "✅ <b>Notre meilleur signal</b>, validé sur ~350j : IC +0.10 (7j) à +0.13 (30j) — au-dessus du seuil 0.05 de l'industrie, positif sur 7 memes/9.",
    },
  },
];

const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m]));
const CHART_METRICS = METRICS.filter((m) => m.chart);

const DELTA_LABEL = { 1: "24h", 7: "7j", 30: "30j", 90: "90j" };

// Measures the screener can focus on. "overview" = compact glance across all
// metrics; each other id = one metric with its value + every delta period.
const MEASURES = [
  ["overview", "Vue d'ensemble"],
  ["composite", "Composite"],
  ["buzz", "Buzz"],
  ["divergence", "Divergence"],
  ["velocity", "Vélocité"],
  ["price", "Prix"],
  ["volume", "Volume"],
  ["tvl", "TVL"],
  ["mentions", "Mentions"],
  ["discord", "Discord"],
  ["telegram", "Telegram"],
  ["holders", "Holders"],
  ["holders50", "Holders ≥$50"],
  ["flowratio", "Pression A/V"],
];

// Columns for a given measure. Overview = one value column per metric (+ price
// 24h). Focus = the metric's value then each of its delta periods.
function columnsForMeasure(measure) {
  if (measure === "overview") {
    const cols = [];
    for (const m of METRICS) {
      cols.push({ key: m.id, label: m.label, kind: "value", metric: m });
      if (m.id === "price") cols.push({ key: "price_1", label: "24h", kind: "delta", metric: m, days: 1 });
    }
    return cols;
  }
  // Buzz focus: the score + the mention context behind it.
  if (measure === "buzz") {
    const buzz = METRIC_BY_ID.buzz, ment = METRIC_BY_ID.mentions;
    return [
      { key: "buzz", label: "Buzz Score", kind: "value", metric: buzz },
      { key: "mentions", label: "Mentions", kind: "value", metric: ment },
      { key: "mentions_7", label: "Ment. 7j", kind: "delta", metric: ment, days: 7 },
      { key: "mentions_30", label: "Ment. 30j", kind: "delta", metric: ment, days: 30 },
    ];
  }
  // Divergence focus: the signal + the attention & price it's built from.
  if (measure === "divergence") {
    const div = METRIC_BY_ID.divergence, buzz = METRIC_BY_ID.buzz, price = METRIC_BY_ID.price;
    return [
      { key: "divergence", label: "Divergence", kind: "value", metric: div },
      { key: "buzz", label: "Buzz Score", kind: "value", metric: buzz },
      { key: "price_7", label: "Prix 7j", kind: "delta", metric: price, days: 7 },
      { key: "price_30", label: "Prix 30j", kind: "delta", metric: price, days: 30 },
    ];
  }
  const m = METRIC_BY_ID[measure];
  const cols = [{ key: m.id, label: m.label, kind: "value", metric: m }];
  for (const d of m.deltas || []) {
    cols.push({ key: `${m.id}_${d}`, label: DELTA_LABEL[d], kind: "delta", metric: m, days: d });
  }
  return cols;
}

// Default sort column key for a measure.
function defaultSortKey(measure) {
  if (measure === "overview") return "mcap";
  return measure; // buzz -> "buzz", price -> "price", etc.
}

// Value of a screener column for an asset (number, for sorting + display).
function columnValue(col, a) {
  if (col.kind === "value") return col.metric.latest(a);
  return pctOverDays(a[col.metric.series], col.metric.vkey, col.days);
}
