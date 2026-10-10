/**
 * KRONA — game session manager.
 * Owns the session lifecycle (cash game / tournament), table population,
 * dealer rotation, rebuys and the hand driver that sequences the engine.
 */
import { HoldemEngine, ActionInput, PokerEvent } from "../poker/engine";
import { Card, LegalActions, Seat } from "../poker/types";
import { CAST, CashTier, CastMember, CASH_TIERS, TournamentDef } from "./config";
import { decideAction, Personality, PERSONALITIES } from "../poker/ai";
import { economy } from "./economy";
import { ViewModel } from "./view";
import { useGame } from "./store";

export type SessionMode = "none" | "cash" | "tournament";

export interface TournamentStanding {
  name: string;
  place: number;
  prize: number;
  isHuman: boolean;
}

class Aborted extends Error {}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}
function randInt(a: number, b: number) {
  return Math.floor(rand(a, b + 1));
}

export class Game {
  mode: SessionMode = "none";
  engine: HoldemEngine | null = null;
  seats: (Seat | null)[] = new Array(8).fill(null);
  castAt = new Map<number, CastMember>();
  personalityAt = new Map<number, Personality>();
  dealer = 0;
  handNo = 0;
  sb = 10;
  bb = 20;
  buyIn = 1000;
  maxTable = 4000;
  tier: CashTier = CASH_TIERS[0];
  tournament: TournamentDef | null = null;
  tourEntrants = 0;
  tourRemaining = 0;
  finishOrder: { seat: number; name: string; isHuman: boolean; handNo: number }[] = [];
  tourFinished = false;
  tourPrizes: TournamentStanding[] = [];
  view = new ViewModel();
  paused = false;
  /** animation speed multiplier (join-in-progress plays an accelerated hand) */
  speed = 1;
  userSpeed = 1;
  message = "";
  handResult: string | null = null;
  rebuyOpen = false;
  awaitingHuman: LegalActions | null = null;
  running = false;
  difficulty = 1;
  showAllHands = false;

  private abortFlag = false;
  private humanResolver: ((a: ActionInput) => void) | null = null;
  private rebuyResolver: ((amount: number | null) => void) | null = null;
  private aiRefill = new Map<number, number>();
  private humanStats = { facedBets: 1, folds: 0, showdowns: 1, weakAggro: 0 };
  private streetAggro = 0;
  private streetActions = 1;

  /* ------------------------------------------------------------ */
  /* setup                                                         */
  /* ------------------------------------------------------------ */

  private makeSeat(id: number, cast: CastMember, stack: number): Seat {
    return {
      id,
      name: cast.name,
      stack,
      bet: 0,
      committed: 0,
      hole: [],
      folded: true,
      allIn: false,
      hasActed: false,
      sittingOut: false,
      outOfChips: false,
      isHuman: false,
      lastAction: null,
      lastAggression: 0,
      showdown: false,
    };
  }

  private pickCast(exclude: string[]): CastMember {
    const pool = CAST.filter((c) => !exclude.includes(c.name));
    return pool[randInt(0, pool.length - 1)] ?? CAST[0];
  }

  private addAI(seatIdx: number, stack: number) {
    const used = [...this.castAt.values()].map((c) => c.name);
    const cast = this.pickCast(used);
    this.seats[seatIdx] = this.makeSeat(seatIdx, cast, stack);
    this.castAt.set(seatIdx, cast);
    const arch = cast.archetype;
    const p: Personality = { ...PERSONALITIES[arch] };
    // slight per-opponent variation so no two opponents feel identical
    p.bluff = Math.max(0.02, Math.min(0.7, p.bluff * rand(0.75, 1.3)));
    p.aggression = Math.max(0.15, Math.min(1.4, p.aggression * rand(0.85, 1.2)));
    p.looseness = Math.max(0.2, Math.min(1.3, p.looseness * rand(0.85, 1.2)));
    this.personalityAt.set(seatIdx, p);
  }

  private humanSeat(): Seat {
    const s = this.seats[0];
    if (!s) throw new Error("human seat missing");
    return s;
  }

  get humanStack() {
    return this.seats[0]?.stack ?? 0;
  }

  /* ------------------------------------------------------------ */
  /* session start                                                 */
  /* ------------------------------------------------------------ */

  async startCash(tier: CashTier, join: boolean) {
    this.reset();
    this.mode = "cash";
    this.tier = tier;
    this.sb = tier.sb;
    this.bb = tier.bb;
    this.buyIn = tier.chips;
    this.maxTable = tier.maxTable;
    this.view.base = Math.max(1, Math.round(this.bb / 5));

    const count = join ? randInt(4, 6) : randInt(4, 6);
    const indices = [1, 2, 3, 4, 5, 6, 7].sort(() => Math.random() - 0.5).slice(0, count);
    for (const i of indices) {
      const stack = join
        ? Math.round((tier.chips * rand(0.25, 2.4)) / 10) * 10
        : tier.chips;
      this.addAI(i, stack);
    }
    // human
    this.seats[0] = this.makeSeat(0, {
      name: "You",
      archetype: "balanced",
      gender: "m",
      height: 1,
      build: 0.55,
      age: 0.45,
      hair: 1,
      skin: 0,
      tunic: 3,
      cloak: 0,
      beard: 0.3,
      hairStyle: "short",
      accessory: "none",
    }, tier.chips);
    this.seats[0]!.isHuman = true;
    economy.buyIn(tier.chips);

    this.dealer = join ? randInt(0, 7) : randInt(1, 7);
    this.handNo = join ? randInt(12, 60) : 0;
    if (join) this.seats[0]!.sittingOut = true; // waiting for the next hand
    this.message = join ? "Taking an open seat…" : "New table";
    this.notify();
    this.running = true;
    this.runLoop(join ? 0.22 : 1).catch(() => void 0);
  }

  async startTournament(def: TournamentDef) {
    if (!economy.payFee(def.entry)) {
      this.message = "Not enough chips for the entry fee.";
      this.notify();
      return;
    }
    this.reset();
    this.mode = "tournament";
    this.tournament = def;
    this.sb = def.sb;
    this.bb = def.bb;
    this.buyIn = def.startingStack;
    this.maxTable = def.startingStack;
    this.view.base = Math.max(1, Math.round(this.bb / 5));
    this.tourEntrants = 8;
    this.tourRemaining = 8;
    for (let i = 1; i < 8; i++) this.addAI(i, def.startingStack);
    this.seats[0] = this.makeSeat(0, {
      name: "You",
      archetype: "balanced",
      gender: "m",
      height: 1,
      build: 0.55,
      age: 0.45,
      hair: 1,
      skin: 0,
      tunic: 3,
      cloak: 0,
      beard: 0.3,
      hairStyle: "short",
      accessory: "none",
    }, def.startingStack);
    this.seats[0]!.isHuman = true;
    this.dealer = randInt(0, 7);
    this.message = `${def.name} — 8 entrants, fixed blinds ${def.sb}/${def.bb}`;
    this.notify();
    this.running = true;
    this.runLoop(1).catch(() => void 0);
  }

  private reset() {
    this.abortFlag = true;
    this.engine = null;
    this.seats = new Array(8).fill(null);
    this.castAt.clear();
    this.personalityAt.clear();
    this.finishOrder = [];
    this.tourPrizes = [];
    this.tourFinished = false;
    this.tournament = null;
    this.tourEntrants = 0;
    this.tourRemaining = 0;
    this.handResult = null;
    this.rebuyOpen = false;
    this.awaitingHuman = null;
    this.aiRefill.clear();
    this.handNo = 0;
    this.view.clearAll();
    this.abortFlag = false;
    this.paused = false;
    this.speed = 1;
  }

  dispose() {
    this.abortFlag = true;
    this.running = false;
    this.humanResolver?.({ kind: "fold" });
    this.rebuyResolver?.(null);
  }

  /* ------------------------------------------------------------ */
  /* main loop                                                     */
  /* ------------------------------------------------------------ */

  private async runLoop(initialSpeed = 1) {
    this.speed = initialSpeed;
    try {
      // a short beat so the room settles in before the first cards fly
      await this.wait(900);
      while (!this.abortFlag) {
        const occupied = this.seats.filter(Boolean).length;
        if (this.mode === "cash" && occupied < 3) {
          this.topUpTable();
        }
        if (this.mode === "tournament" && this.tourFinished) break;

        const human = this.seats[0];
        if (human && human.stack <= 0 && human.outOfChips) {
          if (this.mode === "cash") economy.setTableStake(0);
          this.message = "You are out of table chips.";
          this.notify();
          const amount = await this.requestRebuy();
          if (amount == null) {
            await this.leaveTable(true);
            return;
          }
          human.stack = amount;
          human.outOfChips = false;
          human.sittingOut = false;
          this.message = `Rebuy ${amount.toLocaleString()} chips`;
          this.notify();
        }
        if (this.abortFlag) return;

        await this.playHand();
        if (this.abortFlag) return;
        this.speed = this.userSpeed;
        await this.wait(1600);
        if (this.abortFlag) return;

        if (this.mode === "tournament") {
          this.eliminateBusted();
          if (this.tourFinished) break;
        } else {
          this.betweenHandsCash();
        }
      }
      if (this.mode === "tournament" && this.tourFinished) {
        this.settleTournament();
      }
    } catch (e) {
      if (!(e instanceof Aborted)) console.error(e);
    }
  }

  /** Dynamic table population for cash games. */
  private betweenHandsCash() {
    const aiSeats = this.seats.map((s, i) => (s && !s.isHuman ? i : -1)).filter((i) => i >= 0);
    const occupied = this.seats.filter(Boolean).length;
    // AI refill bookkeeping
    for (const i of aiSeats) {
      const s = this.seats[i]!;
      if (s.sittingOut && this.aiRefill.has(i)) {
        const left = this.aiRefill.get(i)! - 1;
        if (left <= 0) {
          this.aiRefill.delete(i);
          s.sittingOut = false;
          s.outOfChips = false;
          s.stack = Math.round(rand(0.6, 1.5) * this.buyIn);
        } else this.aiRefill.set(i, left);
      }
    }
    const liveAIs = aiSeats.filter((i) => !this.seats[i]!.sittingOut);
    if (liveAIs.length === 0) {
      // never let the table die
      const free = this.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      const idx = free.length ? free[randInt(0, free.length - 1)] : 1;
      this.addAI(idx, this.buyIn);
      this.message = `${this.seats[idx]!.name} joins the table.`;
      this.notify();
      return;
    }
    if (occupied > 5 && Math.random() < 0.08) {
      const victim = liveAIs[randInt(0, liveAIs.length - 1)];
      this.message = `${this.seats[victim]!.name} leaves the table.`;
      this.seats[victim] = null;
      this.castAt.delete(victim);
      this.personalityAt.delete(victim);
      this.notify();
      return;
    }
    if (occupied < 8 && Math.random() < 0.22) {
      const free = this.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      if (free.length) {
        const idx = free[randInt(0, free.length - 1)];
        this.addAI(idx, Math.round(rand(0.5, 1.8) * this.buyIn));
        this.message = `${this.seats[idx]!.name} joins the table.`;
        this.notify();
      }
    }
  }

  private topUpTable() {
    let guard = 0;
    while (this.seats.filter(Boolean).length < 4 && guard++ < 8) {
      const free = this.seats.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      if (!free.length) break;
      const idx = free[randInt(0, free.length - 1)];
      this.addAI(idx, this.buyIn);
    }
    this.notify();
  }

  /* ------------------------------------------------------------ */
  /* hand driver                                                   */
  /* ------------------------------------------------------------ */

  private emit(events: PokerEvent[]) {
    const engine = this.engine!;
    const snap = this.engineSnapshot();
    for (const e of events) {
      this.view.applyEvent(e, snap);
      if (e.t === "act") {
        this.streetActions++;
        if (e.kind === "bet" || e.kind === "raise" || e.kind === "all-in") {
          this.streetAggro++;
          if (this.seats[e.seat]?.isHuman) this.humanStats.facedBets += 0;
        }
        if (e.seat === 0) {
          if (e.kind === "fold") this.humanStats.folds++;
          if (e.kind === "bet" || e.kind === "raise") this.humanStats.facedBets += 0;
        }
      }
      if (e.t === "await") {
        /* handled below */
      }
    }
    void engine;
    this.notify();
  }

  private engineSnapshot() {
    const e = this.engine!;
    return {
      board: e.state.board,
      potCollected: e.state.potCollected,
      dealer: e.state.dealer,
      seats: e.state.seats.map((s) =>
        s ? { id: s.id, bet: s.bet, stack: s.stack, folded: s.folded, isHuman: s.isHuman, hole: s.hole } : null
      ).filter(Boolean) as { id: number; bet: number; stack: number; folded: boolean; isHuman: boolean; hole: Card[] }[],
    };
  }

  private async playHand() {
    this.streetAggro = 0;
    this.streetActions = 1;
    this.handResult = null;
    this.handNo++;
    this.dealer = this.nextDealer();
    const engine = new HoldemEngine(this.seats, this.dealer, this.sb, this.bb, this.handNo);
    this.engine = engine;

    const startEvents = engine.startHand();
    this.view.syncBets(this.engineSnapshot());
    this.emit(startEvents);
    await this.wait(420);
    const cardCount = engine.dealtIn().length * 2;
    for (let i = 0; i < cardCount; i++) await this.wait(190);
    this.message = `Hand #${this.handNo}`;

    // preflop
    await this.bettingRound("preflop");
    if (this.abortFlag || engine.state.handOver) return this.finishHand();

    for (const street of ["flop", "turn", "river"] as const) {
      this.emit(engine.collectBets());
      this.view.syncBets(this.engineSnapshot());
      await this.wait(420);
      this.emit(engine.dealStreet(street));
      this.view.syncBets(this.engineSnapshot());
      this.message = street === "flop" ? "The flop" : street === "turn" ? "The turn" : "The river";
      await this.wait(560);
      if (engine.inHand().length <= 1) return this.finishHand();
      await this.bettingRound(street);
      if (this.abortFlag || engine.state.handOver) return this.finishHand();
      if (engine.inHand().every((s) => s.allIn) && engine.inHand().length > 1) {
        // run out the board — all remaining players are all-in
        continue;
      }
    }

    this.emit(engine.collectBets());
    this.view.syncBets(this.engineSnapshot());
    await this.wait(320);
    this.emit(engine.refundUncalled());
    this.view.syncBets(this.engineSnapshot());
    if (engine.inHand().length === 1) {
      const w = engine.inHand()[0];
      this.emit(engine.awardUncontested());
      this.handResult = `${w.name} takes the pot`;
      this.message = this.handResult;
      await this.wait(1200);
      return this.finishHand();
    }
    this.message = "Showdown";
    const sdEvents = engine.showdown();
    this.emit(sdEvents);
    const winners = sdEvents.filter((e) => e.t === "award");
    if (winners.length) {
      const first = winners[0] as Extract<PokerEvent, { t: "award" }>;
      const total = winners.reduce((a, w) => a + (w as Extract<PokerEvent, { t: "award" }>).amount, 0);
      this.handResult = `${this.seats[first.seat]?.name ?? "Winner"} wins ${total.toLocaleString()} — ${first.desc}`;
    }
    this.notify();
    await this.wait(2200);
    return this.finishHand();
  }

  private async bettingRound(street: string) {
    const engine = this.engine!;
    engine.state.actionSeat = -1;
    let guard = 0;
    while (!this.abortFlag && guard++ < 200) {
      if (engine.bettingRoundComplete()) break;
      const seatIdx = engine.nextToAct();
      if (seatIdx < 0) break;
      engine.state.actionSeat = seatIdx;
      const seat = engine.seat(seatIdx);
      const legal = engine.legalActions(seatIdx);
      let action: ActionInput;
      if (seat.isHuman) {
        this.awaitingHuman = legal;
        this.message = "Your action";
        this.notify();
        action = await this.waitForHuman();
        this.awaitingHuman = null;
      } else {
        this.view.handAction = { kind: "think", seat: seatIdx, t: performance.now() };
        await this.wait(rand(420, 1250));
        action = this.decideAI(seatIdx, legal, street);
      }
      if (this.abortFlag) throw new Aborted();
      const wasFacingBet = legal.callAmount > 0;
      this.emit(engine.applyAction(seatIdx, action));
      if (seat.isHuman && wasFacingBet && action.kind === "fold") this.humanStats.folds++;
      this.view.syncBets(this.engineSnapshot());
      await this.wait(340);
      if (engine.inHand().length <= 1) break;
    }
  }

  private decideAI(seatIdx: number, legal: LegalActions, street: string): ActionInput {
    const seat = this.seats[seatIdx]!;
    const engine = this.engine!;
    const cast = this.castAt.get(seatIdx);
    const personality = this.personalityAt.get(seatIdx) ?? PERSONALITIES.balanced;
    const dealtIn = engine.dealtIn();
    const idx = dealtIn.findIndex((s) => s.id === seatIdx);
    const playersBehind = dealtIn.length - idx - 1;
    const action = decideAction({
      seatId: seatIdx,
      hole: seat.hole,
      board: engine.state.board,
      legal,
      pot: engine.potTotal(),
      opponentsInHand: engine.inHand().filter((s) => s.id !== seatIdx).length,
      playersBehind,
      foldedThisStreet: dealtIn.filter((s) => s.folded).length,
      street: street as "preflop" | "flop" | "turn" | "river",
      position: engine.state.dealer === seatIdx ? 1 : idx / Math.max(1, dealtIn.length - 1),
      personality,
      tableAggression: Math.min(1, this.streetAggro / Math.max(1, this.streetActions)),
      humanFoldRate: Math.min(1, this.humanStats.folds / Math.max(1, this.humanStats.facedBets)),
      humanBluffRate: Math.min(1, this.humanStats.weakAggro / Math.max(1, this.humanStats.showdowns)),
      difficulty: this.difficulty,
      rnd: Math.random,
    });
    void cast;
    return action;
  }

  private nextDealer(): number {
    const n = this.seats.length;
    for (let i = 1; i <= n; i++) {
      const idx = (this.dealer + i) % n;
      const s = this.seats[idx];
      if (s && s.stack > 0) return idx;
    }
    return this.dealer;
  }

  /** Bookkeeping after every hand. */
  private async finishHand() {
    const engine = this.engine;
    if (!engine) return;
    // showdown reads for adaptive AI (public information)
    const human = this.humanSeat();
    if (engine.state.street === "showdown" && !human.folded) {
      this.humanStats.showdowns++;
      const hadAggro = this.handHumanAggression > 0;
      const weak = engine.state.board.length >= 3;
      if (hadAggro && weak && human.showdown) this.humanStats.weakAggro++;
    }
    this.handHumanAggression = 0;

    // bankroll: the human's stake at the table changed.
    // Tournament chips live outside the bankroll entirely.
    if (this.mode === "cash") economy.setTableStake(human.stack + human.bet + human.committed);
    if (human.stack <= 0) {
      human.sittingOut = true;
      human.outOfChips = true;
    } else if (human.sittingOut && !human.outOfChips) {
      // waited out a hand (joined mid-hand or rebought) — dealt in next hand
      human.sittingOut = false;
      this.message = "You are dealt in.";
    }

    // AI busts: sit out one hand, then refill for free (never costs the player)
    for (const s of this.seats) {
      if (!s || s.isHuman) continue;
      if (s.stack <= 0 && !s.sittingOut) {
        s.sittingOut = true;
        s.outOfChips = true;
        this.aiRefill.set(s.id, 2);
      }
    }
    this.view.syncBets(this.engineSnapshot());
    economy.maybeRefill();
    this.notify();
    await this.wait(700);
    this.view.clearAll();
    this.view.syncBets({ board: [], seats: [], potCollected: 0, dealer: this.dealer });
    this.notify();
  }

  private handHumanAggression = 0;

  /* ------------------------------------------------------------ */
  /* tournament                                                    */
  /* ------------------------------------------------------------ */

  private eliminateBusted() {
    const busted = this.seats.map((s, i) => (s && s.stack <= 0 ? i : -1)).filter((i) => i >= 0);
    if (!busted.length) return;
    for (const i of busted) {
      const s = this.seats[i]!;
      this.finishOrder.push({ seat: i, name: s.name, isHuman: s.isHuman, handNo: this.handNo });
      this.seats[i] = null;
      this.castAt.delete(i);
      this.personalityAt.delete(i);
    }
    this.tourRemaining = this.seats.filter(Boolean).length;
    const remaining = this.tourRemaining;
    const paid = 3;
    if (remaining <= 1 || busted.includes(0)) {
      this.tourFinished = true;
    } else if (remaining <= paid) {
      // the paid places are now decided — finish the event
      this.tourFinished = true;
    }
    this.message = `${busted.length} player${busted.length > 1 ? "s" : ""} eliminated — ${remaining} remaining`;
    this.notify();
  }

  private settleTournament() {
    const def = this.tournament!;
    const pool = def.entry * 8;
    const places: TournamentStanding[] = [];
    // reverse finish order = final standings, best first
    const standings = [...this.finishOrder].reverse();
    const remainingSeat = this.seats.find((s) => s !== null);
    const ordered = remainingSeat ? [...standings, { seat: -1, name: remainingSeat.name, isHuman: remainingSeat.isHuman, handNo: this.handNo }] : standings;
    // group players eliminated in the same hand (they share the place)
    const groups: { handNo: number; members: typeof ordered }[] = [];
    for (const p of ordered) {
      const last = groups[groups.length - 1];
      if (last && last.handNo === p.handNo) last.members.push(p);
      else groups.push({ handNo: p.handNo, members: [p] });
    }
    let place = 1;
    for (const g of groups) {
      const size = g.members.length;
      let prize = 0;
      for (let k = 0; k < size; k++) {
        const p = place + k;
        if (p <= 3) prize += Math.round(pool * [0.7, 0.2, 0.1][p - 1]);
      }
      const each = Math.floor(prize / size);
      let remainder = prize - each * size;
      for (const m of g.members) {
        const amt = each + (remainder-- > 0 ? 1 : 0);
        places.push({ name: m.name, place, prize: amt, isHuman: m.isHuman });
        if (m.isHuman && amt > 0) economy.receivePrize(amt);
      }
      place += size;
    }
    this.tourPrizes = places;
    this.message = places.find((p) => p.isHuman)
      ? `You finished ${ordinal(places.find((p) => p.isHuman)!.place)} — prize ${places.find((p) => p.isHuman)!.prize.toLocaleString()}`
      : "Tournament finished";
    economy.cashOut();
    this.notify();
  }

  /* ------------------------------------------------------------ */
  /* player interactions                                           */
  /* ------------------------------------------------------------ */

  private waitForHuman(): Promise<ActionInput> {
    return new Promise<ActionInput>((resolve) => {
      this.humanResolver = resolve;
    });
  }

  /** Called by the UI with the player's chosen action. */
  humanAct(action: ActionInput): boolean {
    if (!this.humanResolver) return false;
    const legal = this.awaitingHuman;
    if (legal) {
      // never submit an illegal action
      if (action.kind === "fold" && !legal.canFold) return false;
      if (action.kind === "check" && !legal.canCheck) return false;
      if (action.kind === "call" && !legal.canCall) return false;
      if (action.kind === "bet" && !legal.canBet) return false;
      if (action.kind === "raise" && !legal.canRaise) return false;
      if (action.kind === "bet" || action.kind === "raise") {
        const to = Math.round(action.to ?? 0);
        if (to > legal.maxRaiseTo) return false;
      }
      if (action.kind === "bet" || action.kind === "raise") this.handHumanAggression++;
    }
    const r = this.humanResolver;
    this.humanResolver = null;
    r(action);
    return true;
  }

  private requestRebuy(): Promise<number | null> {
    this.rebuyOpen = true;
    this.notify();
    return new Promise<number | null>((resolve) => {
      this.rebuyResolver = resolve;
    });
  }

  /** Rebuy after a complete table bust. Returns false when not allowed. */
  rebuy(amount: number): boolean {
    if (!this.rebuyResolver) return false;
    const max = Math.min(this.maxTable, 1_000_000, economy.reserve);
    const amt = Math.round(amount);
    if (amt <= 0 || amt > max) return false;
    if (!economy.buyIn(amt)) return false;
    this.rebuyOpen = false;
    this.rebuyResolver(amt);
    this.rebuyResolver = null;
    this.notify();
    return true;
  }

  declineRebuy() {
    if (!this.rebuyResolver) return;
    this.rebuyOpen = false;
    this.rebuyResolver(null);
    this.rebuyResolver = null;
    this.notify();
  }

  get rebuyMax() {
    return Math.max(0, Math.min(this.maxTable, 1_000_000, economy.reserve));
  }
  get rebuyMin() {
    return Math.min(this.buyIn, Math.max(1, this.rebuyMax));
  }

  async leaveTable(silent = false) {
    if (this.mode === "none") return;
    if (this.mode === "cash") {
      economy.cashOut();
    }
    this.dispose();
    this.mode = "none";
    this.running = false;
    this.message = silent ? "" : "You leave the table with your chips.";
    this.view.clearAll();
    economy.maybeRefill();
    this.notify();
  }

  togglePause() {
    this.paused = !this.paused;
    this.notify();
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.notify();
  }

  private async wait(ms: number) {
    let left = ms / Math.max(0.05, this.speed);
    while (left > 0) {
      if (this.abortFlag) throw new Aborted();
      if (this.paused) {
        await sleep(80);
        continue;
      }
      const step = Math.min(left, 60);
      await sleep(step);
      left -= step;
    }
  }

  /* ------------------------------------------------------------ */
  /* UI snapshot                                                   */
  /* ------------------------------------------------------------ */

  notify() {
    useGame.getState().publish(this.snapshot());
  }

  snapshot() {
    const engine = this.engine;
    const seats = this.seats.map((s, i) => {
      if (!s) return null;
      const cast = this.castAt.get(i);
      const p = this.personalityAt.get(i);
      return {
        id: i,
        name: s.name,
        stack: s.stack,
        bet: s.bet,
        folded: s.folded,
        allIn: s.allIn,
        lastAction: s.lastAction,
        isHuman: s.isHuman,
        sittingOut: s.sittingOut,
        inHand: !!engine ? !s.folded && s.hole.length > 0 : false,
        hasCards: s.hole.length > 0,
        style: p?.label ?? cast?.archetype ?? "",
        cast: cast ?? null,
        showdown: s.showdown,
      };
    });
    const human = this.seats[0];
    return {
      mode: this.mode,
      running: this.running,
      paused: this.paused,
      sb: this.sb,
      bb: this.bb,
      handNo: this.handNo,
      street: engine?.state.street ?? ("preflop" as const),
      board: engine?.state.board ?? [],
      pot: engine ? engine.potTotal() : 0,
      dealer: engine?.state.dealer ?? this.dealer,
      actionSeat: this.awaitingHuman ? 0 : engine?.state.actionSeat ?? -1,
      seats,
      hole: human ? human.hole : [],
      holeRevealed: false,
      legal: this.awaitingHuman,
      message: this.message,
      handResult: this.handResult,
      rebuyOpen: this.rebuyOpen,
      rebuyMin: this.rebuyMin,
      rebuyMax: this.rebuyMax,
      buyIn: this.buyIn,
      maxTable: this.maxTable,
      tournament: this.tournament
        ? {
            name: this.tournament.name,
            entry: this.tournament.entry,
            entrants: this.tourEntrants,
            remaining: this.tourRemaining,
            finished: this.tourFinished,
            prizes: this.tourPrizes,
          }
        : null,
      reserve: economy.reserve,
      ownedTotal: economy.ownedTotal,
      tableStake: economy.tableStake,
    };
  }
}

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const game = new Game();
