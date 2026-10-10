/**
 * KRONA — No-Limit Texas Hold'em engine.
 *
 * The engine is a deterministic state machine driven by a generator.
 * It yields events that the presentation layer animates; the yielded
 * events never change chip accounting on their own — all balances are
 * owned by this engine and only modified by `applyAction`.
 *
 * Nothing in this file touches the DOM, three.js or React.
 */
import { Card, LegalActions, Seat, Street, shuffledDeck, isValidDeck } from "./types";
import { evaluate, HandScore } from "./evaluator";

export type ActionInput = {
  kind: "fold" | "check" | "call" | "bet" | "raise" | "allin";
  /** total amount the seat's bet should reach (bet/raise "to" amount) */
  to?: number;
};

export type PokerEvent =
  | { t: "hand-start"; dealer: number; sb: number; bb: number; handNo: number }
  | { t: "shuffle"; dealer: number }
  | { t: "post"; seat: number; amount: number; kind: "sb" | "bb" }
  | { t: "deal-hole"; seat: number; cards: Card[]; isHuman: boolean }
  | { t: "street"; street: Street }
  | { t: "board"; cards: Card[]; street: Street }
  | { t: "act"; seat: number; kind: string; to: number; moved: number; allIn: boolean }
  | { t: "collect" }
  | { t: "uncalled"; seat: number; amount: number }
  | { t: "reveal"; seat: number; cards: Card[]; label: string }
  | { t: "award"; seat: number; amount: number; desc: string; potIndex: number }
  | { t: "hand-end" }
  | { t: "await"; seat: number; legal: LegalActions; isHuman: boolean };

export interface HandState {
  seats: (Seat | null)[];
  dealer: number;
  sb: number;
  bb: number;
  handNo: number;
  deck: Card[];
  board: Card[];
  street: Street;
  currentBet: number;
  minRaise: number;
  potCollected: number;
  actionSeat: number;
  bettingOpen: boolean;
  handOver: boolean;
}



export class HoldemEngine {
  state: HandState;
  private dealtInIds: number[] = [];
  private events: PokerEvent[] = [];
  private aggroCounter = 0;

  constructor(seats: (Seat | null)[], dealer: number, sb: number, bb: number, handNo = 1) {
    this.state = {
      seats,
      dealer,
      sb,
      bb,
      handNo,
      deck: [],
      board: [],
      street: "preflop",
      currentBet: 0,
      minRaise: bb,
      potCollected: 0,
      actionSeat: -1,
      bettingOpen: false,
      handOver: false,
    };
  }

  /* ---------------- helpers ---------------- */

  seat(id: number): Seat {
    const s = this.state.seats[id];
    if (!s) throw new Error(`seat ${id} empty`);
    return s;
  }

  /** seats dealt into this hand, in clockwise order starting after the dealer */
  dealtIn(): Seat[] {
    return this.dealtInIds.map((id) => this.seat(id));
  }

  inHand(): Seat[] {
    return this.dealtIn().filter((s) => !s.folded);
  }

  potTotal(): number {
    return this.state.potCollected + this.dealtIn().reduce((a, s) => a + s.bet, 0);
  }

  log(e: PokerEvent) {
    this.events.push(e);
  }

  /* ---------------- hand lifecycle ---------------- */

  /** Prepares a hand: posts blinds and deals hole cards (emitting events). */
  startHand(): PokerEvent[] {
    const st = this.state;
    this.events = [];
    // seats that will receive cards
    this.dealtInIds = [];
    for (let i = 0; i < st.seats.length; i++) {
      const s = st.seats[i];
      if (!s) continue;
      s.hole = [];
      s.bet = 0;
      s.committed = 0;
      s.folded = false;
      s.allIn = false;
      s.hasActed = false;
      s.lastAction = null;
      s.lastAggression = 0;
      s.showdown = false;
      if (s.sittingOut || s.stack <= 0) {
        s.folded = true;
        s.outOfChips = s.stack <= 0;
        continue;
      }
      this.dealtInIds.push(i);
    }
    if (this.dealtInIds.length < 2) throw new Error("not enough players");

    st.board = [];
    st.street = "preflop";
    st.currentBet = 0;
    st.minRaise = st.bb;
    st.potCollected = 0;
    st.handOver = false;
    st.deck = shuffledDeck();
    if (!isValidDeck(st.deck)) throw new Error("invalid deck");

    this.log({ t: "hand-start", dealer: st.dealer, sb: st.sb, bb: st.bb, handNo: st.handNo });
    this.log({ t: "shuffle", dealer: st.dealer });

    const ids = this.dealtInIds;
    const heads = ids.length === 2;
    let sbSeat: number;
    let bbSeat: number;
    if (heads) {
      sbSeat = st.dealer;
      bbSeat = this.nextFromDealtIn(sbSeat);
    } else {
      sbSeat = this.nextFromDealtIn(st.dealer);
      bbSeat = this.nextFromDealtIn(sbSeat);
    }

    this.post(sbSeat, st.sb, "sb");
    this.post(bbSeat, st.bb, "bb");
    st.currentBet = Math.max(this.seat(sbSeat).bet, this.seat(bbSeat).bet);
    st.minRaise = st.bb;

    // deal two cards per player, one at a time, starting left of the button
    let cur = heads ? this.nextFromDealtIn(sbSeat) : this.nextFromDealtIn(bbSeat);
    const order: number[] = [];
    for (let k = 0; k < ids.length; k++) {
      order.push(cur);
      cur = this.nextFromDealtIn(cur);
    }
    for (let round = 0; round < 2; round++) {
      for (const id of order) {
        const s = this.seat(id);
        const c = st.deck.shift()!;
        s.hole.push(c);
        this.log({ t: "deal-hole", seat: id, cards: [c], isHuman: s.isHuman });
      }
    }
    return this.events;
  }

  private nextFromDealtIn(from: number): number {
    const ids = this.dealtInIds;
    const i = ids.indexOf(from);
    return ids[(i + 1) % ids.length];
  }

  private post(seatId: number, amount: number, kind: "sb" | "bb") {
    const s = this.seat(seatId);
    const amt = Math.min(amount, s.stack);
    s.stack -= amt;
    s.bet += amt;
    s.committed += amt;
    s.allIn = s.stack === 0;
    this.log({ t: "post", seat: seatId, amount: amt, kind });
  }

  /* ---------------- betting ---------------- */

  legalActions(seatId: number): LegalActions {
    const st = this.state;
    const s = this.seat(seatId);
    const toCall = Math.max(0, st.currentBet - s.bet);
    const opponents = this.inHand().filter((o) => o.id !== seatId);
    const canRespond = opponents.some((o) => !o.allIn);
    const potTotal = this.potTotal();
    const base = {
      seat: seatId,
      callAmount: Math.min(toCall, s.stack),
      potTotal,
      isRaise: st.currentBet > 0,
    };
    if (s.allIn || s.stack <= 0) {
      return { ...base, canFold: false, canCheck: false, canCall: false, canBet: false, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0 };
    }
    const canAggress = opponents.length > 0 && canRespond;
    let minRaiseTo = st.currentBet === 0 ? st.bb : st.currentBet + st.minRaise;
    const maxRaiseTo = s.bet + s.stack;
    if (minRaiseTo > maxRaiseTo) minRaiseTo = maxRaiseTo;
    return {
      ...base,
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canBet: canAggress && st.currentBet === 0,
      canRaise: canAggress && st.currentBet > 0 && maxRaiseTo > st.currentBet,
      minRaiseTo,
      maxRaiseTo,
    };
  }

  /** Applies an action. Returns the emitted events. Mutates engine state. */
  applyAction(seatId: number, input: ActionInput): PokerEvent[] {
    this.events = [];
    const st = this.state;
    const s = this.seat(seatId);
    const legal = this.legalActions(seatId);
    let kind = input.kind;
    let to = input.to ?? 0;

    if (kind === "allin") {
      kind = st.currentBet > s.bet ? "raise" : st.currentBet === 0 ? "bet" : "call";
      to = s.bet + s.stack;
      if (to <= st.currentBet) kind = "call";
    }

    if (kind === "fold") {
      s.folded = true;
      s.hasActed = true;
      s.lastAction = "Fold";
      this.log({ t: "act", seat: seatId, kind: "fold", to: 0, moved: 0, allIn: false });
      return this.events;
    }

    if (kind === "check") {
      if (!legal.canCheck) return this.applyAction(seatId, { kind: "fold" });
      s.hasActed = true;
      s.lastAction = "Check";
      this.log({ t: "act", seat: seatId, kind: "check", to: s.bet, moved: 0, allIn: false });
      return this.events;
    }

    if (kind === "call") {
      if (!legal.canCall) return this.applyAction(seatId, { kind: "check" });
      const moved = Math.min(legal.callAmount, s.stack);
      s.stack -= moved;
      s.bet += moved;
      s.committed += moved;
      s.allIn = s.stack === 0;
      s.hasActed = true;
      s.lastAction = s.bet < st.currentBet ? "Call" : "Call";
      this.log({ t: "act", seat: seatId, kind: "call", to: s.bet, moved, allIn: s.allIn });
      return this.events;
    }

    // bet / raise
    {
      const isBet = st.currentBet === 0;
      if (isBet && !legal.canBet) return this.applyAction(seatId, { kind: "call" });
      if (!isBet && !legal.canRaise) return this.applyAction(seatId, { kind: "call" });
      let target = Math.round(to);
      if (!isFinite(target)) target = legal.maxRaiseTo;
      const max = legal.maxRaiseTo;
      const min = legal.minRaiseTo;
      if (target > max) target = max;
      if (target < min) target = min;
      if (target <= s.bet) {
        // nothing to add -> treat as check/call
        return this.applyAction(seatId, { kind: st.currentBet > s.bet ? "call" : "check" });
      }
      const prevBet = s.bet;
      const moved = target - s.bet;
      s.stack -= moved;
      s.bet = target;
      s.committed += moved;
      s.allIn = s.stack === 0;

      const raiseSize = target - st.currentBet;
      const fullRaise = raiseSize >= st.minRaise;
      if (target > st.currentBet) {
        st.currentBet = target;
        if (fullRaise) st.minRaise = raiseSize;
        // reopen action for everyone else (short all-ins do not reopen
        // betting for players who already acted)
        for (const o of this.dealtIn()) {
          if (o.id === seatId) continue;
          if (o.folded || o.allIn) continue;
          if (fullRaise || !o.hasActed) o.hasActed = false;
        }
      }
      s.hasActed = true;
      const label = s.allIn ? "All-in" : isBet ? "Bet" : "Raise";
      s.lastAction = label;
      s.lastAggression = ++this.aggroCounter;
      this.log({ t: "act", seat: seatId, kind: label.toLowerCase(), to: target, moved, allIn: s.allIn });
      void prevBet;
      return this.events;
    }
  }

  /** Advances the action pointer to the next seat that must act. */
  nextToAct(): number {
    const st = this.state;
    const inHand = this.inHand();
    if (inHand.length <= 1) return -1;
    const canAct = inHand.filter((s) => !s.allIn && s.stack > 0);
    if (canAct.length === 0) return -1;
    if (canAct.length === 1 && canAct[0].bet >= st.currentBet) return -1;

    // start from the seat after the current action seat (or round start)
    let start = st.actionSeat;
    if (start < 0) start = this.roundStartSeat();
    const n = st.seats.length;
    for (let i = 1; i <= n; i++) {
      const idx = (start + i) % n;
      const s = st.seats[idx];
      if (!s || s.folded || s.allIn || !this.dealtInIds.includes(idx)) continue;
      if (s.bet < st.currentBet || !s.hasActed) return idx;
    }
    // fall back: any in-hand seat that can still act
    for (let i = 0; i <= n; i++) {
      const idx = (start + i) % n;
      const s = this.state.seats[idx];
      if (s && !s.folded && !s.allIn && this.dealtInIds.includes(idx) && s.stack > 0) return idx;
    }
    return -1;
  }

  private roundStartSeat(): number {
    const st = this.state;
    const heads = this.dealtInIds.length === 2;
    if (st.street === "preflop") {
      const bb = this.blindSeats().bb;
      return heads ? this.nextFromDealtIn(this.blindSeats().sb) : this.nextFromDealtIn(bb);
    }
    return this.nextFromDealtIn(st.dealer);
  }

  blindSeats(): { sb: number; bb: number } {
    const heads = this.dealtInIds.length === 2;
    const sb = heads ? this.state.dealer : this.nextFromDealtIn(this.state.dealer);
    return { sb, bb: this.nextFromDealtIn(sb) };
  }

  bettingRoundComplete(): boolean {
    const inHand = this.inHand();
    if (inHand.length <= 1) return true;
    const canAct = inHand.filter((s) => !s.allIn && s.stack > 0);
    if (canAct.length === 0) return true;
    if (canAct.length === 1 && canAct[0].bet >= this.state.currentBet && canAct[0].hasActed) return true;
    for (const s of canAct) {
      if (s.bet < this.state.currentBet) return false;
      if (!s.hasActed) return false;
    }
    return true;
  }

  /** Sweeps all street bets into the pot. */
  collectBets(): PokerEvent[] {
    this.events = [];
    let any = false;
    for (const s of this.dealtIn()) {
      if (s.bet > 0) {
        this.state.potCollected += s.bet;
        s.bet = 0;
        any = true;
      }
      s.hasActed = false;
    }
    this.state.currentBet = 0;
    this.state.minRaise = this.state.bb;
    if (any) this.log({ t: "collect" });
    return this.events;
  }

  /** Deals the next community card(s). */
  dealStreet(street: "flop" | "turn" | "river"): PokerEvent[] {
    this.events = [];
    const st = this.state;
    st.deck.shift(); // burn
    const count = street === "flop" ? 3 : 1;
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) {
      const c = st.deck.shift()!;
      st.board.push(c);
      cards.push(c);
    }
    st.street = street;
    for (const s of this.dealtIn()) {
      s.hasActed = false;
      s.bet = 0;
    }
    st.currentBet = 0;
    st.minRaise = st.bb;
    this.log({ t: "board", cards, street });
    return this.events;
  }

  /* ---------------- showdown & pots ---------------- */

  /** Returns uncalled chips to the last aggressor. */
  refundUncalled(): PokerEvent[] {
    this.events = [];
    const inHand = this.inHand();
    if (inHand.length === 0) return this.events;
    const sorted = inHand.slice().sort((a, b) => b.committed - a.committed);
    const top = sorted[0];
    const second = sorted[1]?.committed ?? 0;
    if (top.committed > second) {
      const refund = top.committed - second;
      top.committed -= refund;
      top.stack += refund;
      this.log({ t: "uncalled", seat: top.id, amount: refund });
    }
    return this.events;
  }

  buildPots(): { amount: number; eligible: number[] }[] {
    const contribs = this.dealtIn().map((s) => ({ id: s.id, c: s.committed, folded: s.folded }));
    const levels = [...new Set(contribs.filter((x) => x.c > 0).map((x) => x.c))].sort((a, b) => a - b);
    const pots: { amount: number; eligible: number[] }[] = [];
    let prev = 0;
    for (const lvl of levels) {
      let amount = 0;
      const eligible: number[] = [];
      for (const x of contribs) {
        if (x.c >= lvl) {
          amount += lvl - prev;
          if (!x.folded) eligible.push(x.id);
        }
      }
      if (amount > 0) pots.push({ amount, eligible });
      prev = lvl;
    }
    // merge pots with identical eligibility
    const merged: { amount: number; eligible: number[] }[] = [];
    for (const p of pots) {
      const last = merged[merged.length - 1];
      if (last && last.eligible.length === p.eligible.length && last.eligible.every((v) => p.eligible.includes(v))) {
        last.amount += p.amount;
      } else merged.push(p);
    }
    return merged;
  }

  /** Runs the showdown, awards pots, returns all events. */
  showdown(): PokerEvent[] {
    this.events = [];
    const st = this.state;
    const inHand = this.inHand();
    st.street = "showdown";

    const scores = new Map<number, HandScore>();
    const revealOrder = inHand
      .slice()
      .sort((a, b) => (a.lastAggression === b.lastAggression ? a.id - b.id : b.lastAggression - a.lastAggression));
    for (const s of revealOrder) {
      if (s.hole.length < 2) continue;
      const sc = evaluate([...s.hole, ...st.board]);
      scores.set(s.id, sc);
      s.showdown = true;
      this.log({ t: "reveal", seat: s.id, cards: s.hole, label: sc.label });
    }

    const pots = this.buildPots();
    pots.forEach((pot, potIndex) => {
      if (pot.eligible.length === 0) return;
      let best = -1;
      for (const id of pot.eligible) {
        const sc = scores.get(id);
        if (sc && sc.score > best) best = sc.score;
      }
      const winners = pot.eligible.filter((id) => scores.get(id)?.score === best);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      // odd chips go to the first winner clockwise left of the button
      const ordered = this.dealtInIds.slice(
        this.dealtInIds.indexOf(st.dealer) === -1 ? 0 : this.dealtInIds.indexOf(st.dealer)
      );
      const clockwise = [...ordered, ...this.dealtInIds.slice(0, this.dealtInIds.indexOf(st.dealer))];
      const sortedWinners = winners.slice().sort((a, b) => clockwise.indexOf(a) - clockwise.indexOf(b));
      for (const id of sortedWinners) {
        let amt = share;
        if (remainder > 0) {
          amt += 1;
          remainder -= 1;
        }
        const seat = this.seat(id);
        seat.stack += amt;
        this.log({ t: "award", seat: id, amount: amt, desc: scores.get(id)?.label ?? "", potIndex });
      }
    });

    st.potCollected = 0;
    for (const s of this.dealtIn()) {
      s.committed = 0;
      s.bet = 0;
    }
    st.handOver = true;
    this.log({ t: "hand-end" });
    return this.events;
  }

  /** Awards the whole pot to the last remaining player (everyone else folded). */
  awardUncontested(): PokerEvent[] {
    this.events = [];
    const st = this.state;
    const winner = this.inHand()[0];
    if (winner) {
      const total = this.potTotal();
      winner.stack += total;
      this.log({ t: "award", seat: winner.id, amount: total, desc: "Uncontested", potIndex: 0 });
    }
    st.potCollected = 0;
    for (const s of this.dealtIn()) {
      s.committed = 0;
      s.bet = 0;
    }
    st.handOver = true;
    this.log({ t: "hand-end" });
    return this.events;
  }

  /** Total chips in play for this hand — used by the bankroll conservation test. */
  totalChips(): number {
    return this.state.seats.reduce((a, s) => a + (s ? s.stack + s.bet + s.committed : 0), 0) + this.state.potCollected;
  }
}
