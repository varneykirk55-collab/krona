/**
 * KRONA — core poker types & deck management.
 * Pure data, no rendering / no DOM dependencies.
 */

export type Suit = "s" | "h" | "d" | "c";

export interface Card {
  /** rank 2..14 (14 = ace) */
  r: number;
  s: Suit;
  /** unique id, e.g. "14s" */
  id: string;
}

export const SUITS: Suit[] = ["s", "h", "d", "c"];

export const SUIT_SYMBOL: Record<Suit, string> = {
  s: "\u2660",
  h: "\u2665",
  d: "\u2666",
  c: "\u2663",
};

export const RANK_LABEL: Record<number, string> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

export function cardLabel(c: Card): string {
  return RANK_LABEL[c.r] + SUIT_SYMBOL[c.s];
}

/** A freshly ordered 52 card deck (exactly one instance of each unique card). */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) {
    for (let r = 2; r <= 14; r++) deck.push({ r, s, id: `${r}${s}` });
  }
  return deck;
}

export function isValidDeck(deck: Card[]): boolean {
  if (deck.length !== 52) return false;
  const seen = new Set<string>();
  for (const c of deck) {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
  }
  return seen.size === 52;
}

/** Fisher–Yates. Returns a new array. */
export function shuffle<T>(input: T[], rnd: () => number = Math.random): T[] {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

export function shuffledDeck(rnd: () => number = Math.random): Card[] {
  return shuffle(freshDeck(), rnd);
}

/* ------------------------------------------------------------------ */
/* Seats                                                              */
/* ------------------------------------------------------------------ */

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown";

export type ActionKind =
  | "fold"
  | "check"
  | "call"
  | "bet"
  | "raise"
  | "allin"
  | "post-sb"
  | "post-bb"
  | "post-dead";

export interface SeatAction {
  kind: ActionKind;
  /** total amount pushed into the pot by this action (0 for check/fold) */
  amount: number;
}

export interface Seat {
  id: number;
  name: string;
  /** chips currently in front of this player (table stack) */
  stack: number;
  /** chips committed to the current betting round */
  bet: number;
  /** chips committed during the whole hand (for side pots) */
  committed: number;
  hole: Card[];
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
  /** seated but not dealt in this hand (arrived mid-hand / waiting) */
  sittingOut: boolean;
  /** busted & waiting for rebuy / refill */
  outOfChips: boolean;
  isHuman: boolean;
  lastAction: string | null;
  lastAggression: number;
  /** reveal cards at showdown */
  showdown: boolean;
}

export interface LegalActions {
  seat: number;
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  canRaise: boolean;
  /** smallest legal total bet for a bet/raise (chips moved on top of current bet) */
  minRaiseTo: number;
  /** largest legal total bet (all-in) */
  maxRaiseTo: number;
  isRaise: boolean;
  potTotal: number;
}

export type PotShare = {
  amount: number;
  /** seat ids eligible for this pot layer */
  eligible: number[];
};

export interface HandResult {
  pots: { amount: number; winners: number[]; desc: string; bestLabel: string }[];
  reveals: { seat: number; cards: Card[]; label: string }[];
  order: number[];
}
