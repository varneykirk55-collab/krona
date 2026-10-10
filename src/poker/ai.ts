/**
 * KRONA — AI opponents.
 *
 * The AI only ever receives information that is publicly available at the
 * table: its own hole cards, the visible board, the pot, every player's bets
 * and stacks, and the betting history of the current hand. It never receives
 * another player's hidden cards nor the undealt deck.
 */
import { ActionInput } from "./engine";
import { LegalActions, Card } from "./types";
import { estimateEquity, preflopStrength } from "./evaluator";

export type Archetype =
  | "tight" // conservative
  | "maniac" // loose aggressive
  | "passive" // calling station
  | "calculator" // strategic
  | "bluffer" // bluff heavy
  | "balanced"; // unpredictable

export interface Personality {
  archetype: Archetype;
  label: string;
  /** 0 = never bluffs, 1 = bluffs a lot */
  bluff: number;
  /** willingness to continue with marginal hands */
  looseness: number;
  /** how often it bets/raises when it does continue */
  aggression: number;
  /** how much it respects opponent bets */
  caution: number;
  /** random noise (0..1) */
  chaos: number;
  /** traps: slowplays strong hands */
  tricky: number;
}

export const PERSONALITIES: Record<Archetype, Personality> = {
  tight: { archetype: "tight", label: "Rock", bluff: 0.06, looseness: 0.3, aggression: 0.5, caution: 1.25, chaos: 0.15, tricky: 0.3 },
  maniac: { archetype: "maniac", label: "Berserker", bluff: 0.42, looseness: 1.15, aggression: 1.25, caution: 0.6, chaos: 0.45, tricky: 0.1 },
  passive: { archetype: "passive", label: "Drifter", bluff: 0.04, looseness: 0.75, aggression: 0.22, caution: 0.95, chaos: 0.2, tricky: 0.05 },
  calculator: { archetype: "calculator", label: "Runemaster", bluff: 0.16, looseness: 0.6, aggression: 0.85, caution: 1.0, chaos: 0.12, tricky: 0.55 },
  bluffer: { archetype: "bluffer", label: "Trickster", bluff: 0.55, looseness: 0.85, aggression: 0.95, caution: 0.8, chaos: 0.35, tricky: 0.3 },
  balanced: { archetype: "balanced", label: "Jarl", bluff: 0.2, looseness: 0.62, aggression: 0.7, caution: 1.0, chaos: 0.25, tricky: 0.4 },
};

export interface OpponentModel {
  /** hands the seat voluntarily entered with / opportunities */
  vpip: number;
  opportunities: number;
  aggressionEvents: number;
  foldEvents: number;
  showdownsLostWithWeak: number;
}

/** Publicly observable table state passed to the AI. */
export interface AIContext {
  seatId: number;
  hole: Card[];
  board: Card[];
  legal: LegalActions;
  pot: number;
  /** number of opponents still in the hand */
  opponentsInHand: number;
  /** seats still to act after this one, including big blind position */
  playersBehind: number;
  /** seat ids that have already folded this street */
  foldedThisStreet: number;
  street: "preflop" | "flop" | "turn" | "river" | "showdown";
  /** normalised position 0=first to act, 1=button */
  position: number;
  personality: Personality;
  /** opponent aggression observed (0..1) — public betting history only */
  tableAggression: number;
  /** how often the human has folded when facing bets (public) */
  humanFoldRate: number;
  /** how often the human shows down weak hands (public) */
  humanBluffRate: number;
  /** difficulty scalar 0.7 (soft) .. 1.15 (hard) */
  difficulty: number;
  rnd: () => number;
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function pick(rnd: () => number, p: number) {
  return rnd() < p;
}

/**
 * Produces a legal action. `legal` is produced by the engine, so every
 * returned action is guaranteed to be legal — the AI cannot cheat or bet
 * an illegal amount.
 */
export function decideAction(ctx: AIContext): ActionInput {
  const { legal, rnd, personality: P } = ctx;
  const stackPlusBet = legal.maxRaiseTo || 0;
  const pot = Math.max(1, ctx.pot);
  const toCall = legal.callAmount;

  const opponents = Math.max(1, ctx.opponentsInHand);
  const trials = ctx.street === "preflop" ? 90 : 150;
  let equity = estimateEquity(ctx.hole, ctx.board, opponents, trials, rnd);

  if (ctx.street === "preflop") {
    // blend raw preflop strength so the AI does not fold premiums to variance
    const raw = preflopStrength(ctx.hole) / 20;
    equity = clamp(equity * 0.65 + raw * 0.35, 0.02, 0.99);
  }

  // personality tuning
  equity += (P.looseness - 0.65) * 0.05;
  equity += (ctx.difficulty - 1) * 0.03;
  equity -= ctx.opponentsInHand > 3 ? 0.02 : 0;
  // position: later position plays more hands
  equity += ctx.position * 0.03;
  if (ctx.street === "preflop" && ctx.playersBehind > 2) equity -= 0.02;

  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const bluffy = P.bluff * (1 + ctx.tableAggression * 0.5);
  const wantsBluff = pick(rnd, clamp(bluffy * (ctx.street === "river" ? 1.2 : 1), 0, 0.8));

  // adaptive reads on the human (uses only public behaviour)
  let callBias = 1;
  if (ctx.humanBluffRate > 0.4) callBias *= 1.18; // human bluffs -> call more
  if (ctx.humanFoldRate > 0.6) callBias *= 0.82; // human folds a lot -> bluff more

  const noise = (rnd() - 0.5) * P.chaos * 0.12;
  const strength = clamp(equity + noise, 0.01, 0.995);

  /* ---------- no bet to call: check or bet ---------- */
  if (toCall === 0) {
    const valueBet = strength > 0.55 + (1 - P.aggression) * 0.12;
    const bluffNow = wantsBluff && ctx.opponentsInHand <= 3 && strength < 0.42;
    const slowplay = strength > 0.8 && pick(rnd, P.tricky * 0.7);
    if ((valueBet && !slowplay) || (bluffNow && pick(rnd, P.aggression))) {
      const sizeFrac = clamp(0.45 + rnd() * 0.45 + (P.aggression - 0.7) * 0.3, 0.3, 1.3);
      let target = Math.round((pot * sizeFrac) / 10) * 10;
      target = Math.max(legal.minRaiseTo, Math.min(target, legal.maxRaiseTo));
      if (target >= legal.maxRaiseTo * 0.85 && strength > 0.9 && pick(rnd, 0.35)) {
        return { kind: "allin" };
      }
      return { kind: legal.isRaise ? "raise" : "bet", to: target };
    }
    return { kind: "check" };
  }

  /* ---------- facing a bet ---------- */
  const price = potOdds * P.caution;
  const callEV = strength - price * callBias;

  // very strong: raise for value
  if (strength > 0.72) {
    if (pick(rnd, clamp(P.aggression * 0.85, 0.1, 0.95))) {
      const sizeFrac = clamp(0.6 + rnd() * 0.7, 0.45, 1.6);
      let target = Math.round((pot * sizeFrac) / 10) * 10;
      target = Math.max(legal.minRaiseTo, Math.min(target, legal.maxRaiseTo));
      if (target >= legal.maxRaiseTo * 0.9 && pick(rnd, 0.5)) return { kind: "allin" };
      return { kind: "raise", to: target };
    }
    return { kind: "call" };
  }

  // strong enough / good price
  if (callEV > 0.02 || strength > 0.55) {
    // occasional semi-bluff raise with draws
    const semiBluff = ctx.street !== "river" && strength > 0.32 && strength < 0.6 && pick(rnd, P.aggression * 0.3);
    if (semiBluff && legal.canRaise) {
      let target = Math.round((pot * (0.6 + rnd() * 0.4)) / 10) * 10;
      target = Math.max(legal.minRaiseTo, Math.min(target, legal.maxRaiseTo));
      return { kind: "raise", to: target };
    }
    return { kind: "call" };
  }

  // bluff raise
  if (wantsBluff && legal.canRaise && pick(rnd, P.aggression * 0.8) && toCall < pot * 0.9) {
    let target = Math.round((pot * (0.8 + rnd() * 0.6)) / 10) * 10;
    target = Math.max(legal.minRaiseTo, Math.min(target, legal.maxRaiseTo));
    return { kind: "raise", to: target };
  }

  // small bet, loose call
  if (toCall <= pot * 0.12 && pick(rnd, P.looseness * 0.7) && strength > 0.22) {
    return { kind: "call" };
  }

  // short all-in call with decent equity
  if (toCall >= stackPlusBet * 0.6 && strength > 0.5) return { kind: "call" };

  if (!legal.canCall) return { kind: legal.canCheck ? "check" : "fold" };
  return { kind: "fold" };
}
