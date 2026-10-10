/**
 * KRONA — Texas Hold'em hand evaluator.
 * Correctly evaluates the best five card combination out of 5..7 cards.
 */
import { Card, RANK_LABEL } from "./types";

export const CAT_LABELS = [
  "High Card",
  "Pair",
  "Two Pair",
  "Three of a Kind",
  "Straight",
  "Flush",
  "Full House",
  "Four of a Kind",
  "Straight Flush",
];

const P = 15;
/** 5 kickers, each < 15 -> max value 15^6 which is well inside Number.MAX_SAFE_INTEGER */
const CAT_MULT = Math.pow(P, 5);

export interface HandScore {
  category: number;
  tiebreak: number[];
  score: number;
  cards: Card[]; // the five cards forming the hand
  label: string;
}

function straightHigh(uniqueRanks: number[]): number {
  if (uniqueRanks.length !== 5) return 0;
  const desc = [...uniqueRanks].sort((a, b) => b - a);
  if (desc[0] - desc[4] === 4) return desc[0];
  // ace low: A,5,4,3,2
  if (desc[0] === 14 && desc[1] === 5 && desc[2] === 4 && desc[3] === 3 && desc[4] === 2)
    return 5;
  return 0;
}

/** Score exactly five cards. */
export function score5(cards: Card[]): HandScore {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.r, (counts.get(c.r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
  const uniqueRanks = [...counts.keys()];
  const isFlush = cards.every((c) => c.s === cards[0].s);
  const sHigh = straightHigh(uniqueRanks);

  let category: number;
  let tiebreak: number[];

  if (isFlush && sHigh) {
    category = 8;
    tiebreak = [sHigh];
  } else if (groups[0][1] === 4) {
    category = 7;
    tiebreak = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1] && groups[1][1] === 2) {
    category = 6;
    tiebreak = [groups[0][0], groups[1][0]];
  } else if (isFlush) {
    category = 5;
    tiebreak = uniqueRanks.slice().sort((a, b) => b - a);
  } else if (sHigh) {
    category = 4;
    tiebreak = [sHigh];
  } else if (groups[0][1] === 3) {
    category = 3;
    tiebreak = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    category = 2;
    tiebreak = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2) {
    category = 1;
    tiebreak = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  } else {
    category = 0;
    tiebreak = uniqueRanks.slice().sort((a, b) => b - a);
  }

  let score = category * CAT_MULT;
  for (let i = 0; i < 5; i++) score = score * P + (tiebreak[i] ?? 0);

  return {
    category,
    tiebreak,
    score,
    cards: cards.slice(),
    label: describe(category, tiebreak),
  };
}

function plural(r: number): string {
  const l = RANK_LABEL[r];
  if (l === "6") return "Sixes";
  if (l === "2") return "Twos";
  if (l === "3") return "Threes";
  if (l === "4") return "Fours";
  if (l === "5") return "Fives";
  if (l === "8") return "Eights";
  if (l === "J") return "Jacks";
  if (l === "Q") return "Queens";
  if (l === "K") return "Kings";
  if (l === "A") return "Aces";
  return l + "s";
}

function describe(category: number, tb: number[]): string {
  switch (category) {
    case 8:
      return tb[0] === 14 ? "Royal Flush" : `Straight Flush, ${RANK_LABEL[tb[0]]} high`;
    case 7:
      return `Four of a Kind, ${plural(tb[0])}`;
    case 6:
      return `Full House, ${plural(tb[0])} over ${plural(tb[1])}`;
    case 5:
      return `Flush, ${RANK_LABEL[tb[0]]} high`;
    case 4:
      return `Straight, ${RANK_LABEL[tb[0]]} high`;
    case 3:
      return `Three of a Kind, ${plural(tb[0])}`;
    case 2:
      return `Two Pair, ${plural(tb[0])} and ${plural(tb[1])}`;
    case 1:
      return `Pair of ${plural(tb[0])}`;
    default:
      return `${RANK_LABEL[tb[0]]} High`;
  }
}

const combosCache = new Map<number, number[][]>();
function combos(n: number, k: number): number[][] {
  const key = n * 100 + k;
  const hit = combosCache.get(key);
  if (hit) return hit;
  const out: number[][] = [];
  const idx: number[] = [];
  const rec = (start: number) => {
    if (idx.length === k) {
      out.push(idx.slice());
      return;
    }
    for (let i = start; i < n; i++) {
      idx.push(i);
      rec(i + 1);
      idx.pop();
    }
  };
  rec(0);
  combosCache.set(key, out);
  return out;
}

/** Best five card hand from 5, 6 or 7 cards. */
export function evaluate(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error("evaluate requires at least 5 cards");
  if (cards.length === 5) return score5(cards);
  let best: HandScore | null = null;
  for (const combo of combos(cards.length, 5)) {
    const five = combo.map((i) => cards[i]);
    const s = score5(five);
    if (!best || s.score > best.score) best = s;
  }
  return best as HandScore;
}

/* ------------------------------------------------------------------ */
/* Helpers used by the AI (public information only)                   */
/* ------------------------------------------------------------------ */

/** Chen-style starting hand score — uses hole cards only. */
export function preflopStrength(hole: Card[]): number {
  if (hole.length !== 2) return 0;
  const [a, b] = hole.slice().sort((x, y) => y.r - x.r);
  const hi = a.r;
  const lo = b.r;
  let score: number;
  if (hi === lo) {
    score = Math.max(5, hi / 2);
  } else {
    const base = hi === 14 ? 10 : hi === 13 ? 8 : hi === 12 ? 7 : hi === 11 ? 6 : hi / 2 + 1;
    const gap = hi - lo;
    let penalty = gap === 1 ? -1 : gap === 2 ? -2 : gap === 3 ? -4 : gap === 4 ? -5 : -6;
    if (gap <= 1 && hi < 12) penalty -= 1;
    score = base + penalty;
    if (a.s === b.s) score += 2;
  }
  return Math.max(0, Math.min(20, score));
}

/**
 * Rough equity estimate of hole cards versus a number of opponents,
 * based only on the publicly visible board. Uses a fast Monte-Carlo.
 */
export function estimateEquity(
  hole: Card[],
  board: Card[],
  opponents: number,
  trials = 160,
  rnd: () => number = Math.random
): number {
  if (hole.length < 2) return 0;
  const used = new Set<string>([...hole, ...board].map((c) => c.id));
  const pool: Card[] = [];
  for (const s of ["s", "h", "d", "c"] as const)
    for (let r = 2; r <= 14; r++) {
      const id = `${r}${s}`;
      if (!used.has(id)) pool.push({ r, s, id });
    }
  const n = opponents < 1 ? 1 : Math.min(opponents, 7);
  const need = 5 - board.length;
  let win = 0;
  for (let t = 0; t < trials; t++) {
    // partial fisher-yates
    const draw = need + n * 2;
    for (let i = 0; i < draw; i++) {
      const j = i + Math.floor(rnd() * (pool.length - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    const fullBoard = board.concat(pool.slice(0, need));
    const mine = evaluate(hole.concat(fullBoard)).score;
    let best = mine;
    let tie = 1;
    for (let o = 0; o < n; o++) {
      const opp = evaluate([pool[need + o * 2], pool[need + o * 2 + 1], ...fullBoard]).score;
      if (opp > best) {
        best = opp;
        tie = 0;
        break;
      } else if (opp === best) tie++;
    }
    win += tie > 0 ? 1 / (tie + 1) : 0;
  }
  return win / trials;
}
