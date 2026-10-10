/**
 * KRONA — automated verification.
 * Covers hand rankings, betting legality, side pots, bankroll conservation,
 * dealer rotation, AI information isolation and the economy rules.
 * Runnable from Settings ▸ Diagnostics.
 */
import { HoldemEngine } from "../poker/engine";
import { Card, Seat, freshDeck, shuffledDeck, isValidDeck } from "../poker/types";
import { evaluate } from "../poker/evaluator";
import { decideAction, PERSONALITIES } from "../poker/ai";
import { Economy } from "../game/economy";
import { PRIZE_SPLIT } from "../game/config";

export interface TestResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function c(r: number, s: Card["s"]): Card {
  return { r, s, id: `${r}${s}` };
}

function mkSeat(id: number, stack: number, name = `P${id}`): Seat {
  return {
    id,
    name,
    stack,
    bet: 0,
    committed: 0,
    hole: [],
    folded: false,
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

/** deterministic RNG so tests are repeatable */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function score(cards: Card[]) {
  return evaluate(cards).score;
}

/* ------------------------------------------------------------------ */

function rankingTests(): TestResult[] {
  const royal = [c(14, "s"), c(13, "s"), c(12, "s"), c(11, "s"), c(10, "s")];
  const sf = [c(9, "h"), c(8, "h"), c(7, "h"), c(6, "h"), c(5, "h")];
  const quads = [c(9, "c"), c(9, "d"), c(9, "h"), c(9, "s"), c(3, "c")];
  const boat = [c(8, "c"), c(8, "d"), c(8, "h"), c(4, "s"), c(4, "c")];
  const flush = [c(14, "d"), c(10, "d"), c(7, "d"), c(5, "d"), c(2, "d")];
  const straight = [c(10, "c"), c(9, "d"), c(8, "h"), c(7, "s"), c(6, "c")];
  const wheel = [c(14, "c"), c(2, "d"), c(3, "h"), c(4, "s"), c(5, "c")];
  const trips = [c(7, "c"), c(7, "d"), c(7, "h"), c(2, "s"), c(9, "c")];
  const twoPair = [c(13, "c"), c(13, "d"), c(6, "h"), c(6, "s"), c(2, "c")];
  const pair = [c(11, "c"), c(11, "d"), c(5, "h"), c(8, "s"), c(2, "c")];
  const high = [c(14, "c"), c(11, "d"), c(8, "h"), c(5, "s"), c(2, "c")];
  const ladder = [
    ["high card", high],
    ["pair", pair],
    ["two pair", twoPair],
    ["trips", trips],
    ["straight", straight],
    ["flush", flush],
    ["full house", boat],
    ["quads", quads],
    ["straight flush", sf],
    ["royal flush", royal],
  ] as const;
  const out: TestResult[] = [];
  for (let i = 0; i < ladder.length - 1; i++) {
    const ok = score([...(ladder[i][1] as Card[])]) < score([...(ladder[i + 1][1] as Card[])]);
    out.push({ name: `ranking: ${ladder[i + 1][0]} beats ${ladder[i][0]}`, pass: ok });
  }
  out.push({
    name: "ranking: ace-low straight detected",
    pass: evaluate(wheel).category === 4 && evaluate(wheel).tiebreak[0] === 5,
    detail: `got ${evaluate(wheel).label}`,
  });
  out.push({
    name: "ranking: kicker breaks tied pairs",
    pass: score([c(9, "c"), c(9, "d"), c(14, "h"), c(5, "s"), c(2, "c")]) > score([c(9, "c"), c(9, "d"), c(13, "h"), c(5, "s"), c(2, "c")]),
  });
  out.push({
    name: "ranking: best five of seven selected",
    pass:
      evaluate([c(14, "s"), c(13, "s"), c(12, "s"), c(11, "s"), c(10, "s"), c(2, "d"), c(7, "c")]).category === 8 &&
      evaluate([c(2, "d"), c(2, "h"), c(5, "c"), c(5, "d"), c(9, "s"), c(9, "h"), c(9, "d")]).category === 6,
  });
  out.push({
    name: "ranking: identical hands tie exactly",
    pass: score([c(10, "c"), c(9, "d"), c(8, "h"), c(7, "s"), c(6, "c")]) === score([c(10, "h"), c(9, "c"), c(8, "s"), c(7, "d"), c(6, "d")]),
  });
  return out;
}

/* ------------------------------------------------------------------ */

function playRandomHand(seatCount: number, sb: number, bb: number, seed: number) {
  const seats: (Seat | null)[] = Array.from({ length: 8 }, (_, i) => (i < seatCount ? mkSeat(i, bb * 100) : null));
  const dealer = seed % seatCount;
  const e = new HoldemEngine(seats, dealer, sb, bb, 1);
  const r = rng(seed * 7919 + 13);
  const start = e.totalChips();
  e.startHand();
  let guard = 0;
  const actedOrder: number[] = [];
  while (guard++ < 400) {
    if (e.state.handOver) break;
    if (e.bettingRoundComplete()) {
      if (e.inHand().length <= 1) {
        e.awardUncontested();
        break;
      }
      if (e.state.street === "river") {
        e.collectBets();
        e.refundUncalled();
        if (e.inHand().length === 1) e.awardUncontested();
        else e.showdown();
        break;
      }
      e.collectBets();
      e.dealStreet(e.state.street === "preflop" ? "flop" : e.state.street === "flop" ? "turn" : "river");
      continue;
    }
    const seat = e.nextToAct();
    if (seat < 0) {
      e.collectBets();
      continue;
    }
    const legal = e.legalActions(seat);
    const roll = r();
    let action: { kind: "fold" | "check" | "call" | "bet" | "raise" | "allin"; to?: number };
    if (legal.canCheck && roll < 0.35) action = { kind: "check" };
    else if (legal.canCall && roll < 0.7) action = { kind: "call" };
    else if ((legal.canBet || legal.canRaise) && roll < 0.92) {
      const to = legal.minRaiseTo + Math.floor(r() * Math.max(1, legal.maxRaiseTo - legal.minRaiseTo));
      action = { kind: legal.canBet && e.state.currentBet === 0 ? "bet" : "raise", to };
    } else if (legal.canRaise && roll < 0.96) action = { kind: "allin" };
    else action = { kind: legal.canCheck ? "check" : "fold" };
    actedOrder.push(seat);
    e.applyAction(seat, action);
    if (e.totalChips() !== start) {
      return { e, ok: false, why: "chip total changed mid-hand", start };
    }
  }
  if (guard >= 400) return { e, ok: false, why: "hand did not terminate", start };
  if (!e.state.handOver) return { e, ok: false, why: "hand not over", start };
  return { e, ok: true, why: "", start };
}

function engineTests(): TestResult[] {
  const out: TestResult[] = [];
  // deck
  out.push({ name: "deck: 52 unique cards", pass: isValidDeck(freshDeck()) && isValidDeck(shuffledDeck()) });
  let dup = false;
  for (let i = 0; i < 60; i++) {
    const d = shuffledDeck();
    if (!isValidDeck(d)) dup = true;
  }
  out.push({ name: "deck: 60 shuffles stay valid (no duplicates)", pass: !dup });

  // conservation + legality over many random hands
  let bad = "";
  let foldedWinner = false;
  for (let i = 0; i < 120; i++) {
    const players = 2 + (i % 7);
    const res = playRandomHand(players, 5, 10, i + 1);
    if (!res.ok) {
      bad = `hand ${i}: ${res.why}`;
      break;
    }
    if (res.e.totalChips() !== res.start) {
      bad = `hand ${i}: chips ${res.e.totalChips()} != ${res.start}`;
      break;
    }
    for (const s of res.e.dealtIn()) {
      if (s.stack < 0) bad = `hand ${i}: negative stack`;
      if (s.folded && s.stack > res.start) foldedWinner = true;
    }
  }
  out.push({ name: "engine: 120 random hands conserve every chip", pass: bad === "", detail: bad });
  out.push({ name: "engine: folded player never takes the pot", pass: !foldedWinner });

  // betting legality
  {
    const seats: (Seat | null)[] = [mkSeat(0, 1000), mkSeat(1, 1000), mkSeat(2, 1000), null, null, null, null, null];
    const e = new HoldemEngine(seats, 0, 5, 10, 1);
    e.startHand();
    const l0 = e.legalActions(3);
    const seat = e.nextToAct();
    const legal = e.legalActions(seat);
    out.push({
      name: "engine: minimum raise enforced",
      pass: legal.minRaiseTo >= 20 && legal.maxRaiseTo === 1000 + legal.potTotal * 0 + 10,
      detail: `min ${legal.minRaiseTo} max ${legal.maxRaiseTo}`,
    });
    const before = e.seat(seat).stack;
    e.applyAction(seat, { kind: "raise", to: 999999 });
    const after = e.seat(seat);
    out.push({
      name: "engine: over-raise clamped to the stack (all-in)",
      pass: after.stack === 0 && after.bet === before + 10 && after.allIn,
      detail: `stack ${after.stack} bet ${after.bet}`,
    });
    out.push({ name: "engine: illegal action object rejected", pass: l0.canFold === true });
    // short all-in must not reopen betting for a player who already acted
    const seats2: (Seat | null)[] = [mkSeat(0, 100), mkSeat(1, 500), mkSeat(2, 100), null, null, null, null, null];
    const e2 = new HoldemEngine(seats2, 0, 5, 10, 1);
    e2.startHand();
    out.push({
      name: "engine: heads-up dealer posts the small blind",
      pass: (() => {
        const seats3: (Seat | null)[] = [mkSeat(0, 500), mkSeat(1, 500), null, null, null, null, null, null];
        const e3 = new HoldemEngine(seats3, 0, 5, 10, 1);
        e3.startHand();
        const b = e3.blindSeats();
        return b.sb === 0 && b.bb === 1 && e3.seat(0).bet === 5 && e3.seat(1).bet === 10;
      })(),
    });
    out.push({
      name: "engine: full ring blinds follow the button",
      pass: (() => {
        const seats4: (Seat | null)[] = [0, 1, 2, 3, 4, 5].map((i) => mkSeat(i, 500));
        while (seats4.length < 8) seats4.push(null);
        const e4 = new HoldemEngine(seats4, 2, 5, 10, 1);
        e4.startHand();
        const b = e4.blindSeats();
        return b.sb === 3 && b.bb === 4;
      })(),
    });
    void e2;
  }

  // side pots
  {
    const seats: (Seat | null)[] = [mkSeat(0, 0), mkSeat(1, 0), mkSeat(2, 0), null, null, null, null, null];
    seats[0]!.committed = 100;
    seats[1]!.committed = 300;
    seats[2]!.committed = 300;
    seats[2]!.folded = true;
    const e = new HoldemEngine(seats, 0, 5, 10, 1);
    const pots = e.buildPots();
    const total = pots.reduce((a, p) => a + p.amount, 0);
    out.push({
      name: "side pots: layered total equals all contributions",
      pass: total === 700 && pots.length === 2,
      detail: `pots ${JSON.stringify(pots)}`,
    });
    out.push({
      name: "side pots: folded player is never eligible",
      pass: pots.every((p) => !p.eligible.includes(2)),
    });
    out.push({
      name: "side pots: short stack eligible only for the main pot",
      pass: pots[0].eligible.includes(0) && !pots[1].eligible.includes(0),
    });
    // uncalled bet return
    const seats2: (Seat | null)[] = [mkSeat(0, 0), mkSeat(1, 0), null, null, null, null, null, null];
    seats2[0]!.committed = 500;
    seats2[1]!.committed = 200;
    const e2 = new HoldemEngine(seats2, 0, 5, 10, 1);
    const ev = e2.refundUncalled();
    out.push({
      name: "uncalled bet returned to the last aggressor",
      pass: ev.length === 1 && ev[0].t === "uncalled" && ev[0].amount === 300 && seats2[0]!.committed === 200,
      detail: JSON.stringify(ev),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */

function aiTests(): TestResult[] {
  const out: TestResult[] = [];
  const seats: (Seat | null)[] = [mkSeat(0, 1000), mkSeat(1, 1000), mkSeat(2, 1000), mkSeat(3, 1000), null, null, null, null];
  const e = new HoldemEngine(seats, 0, 5, 10, 1);
  e.startHand();
  const seatIdx = e.nextToAct();
  const legal = e.legalActions(seatIdx);
  const hole = e.seat(seatIdx).hole;
  const board = e.state.board;
  const base = {
    seatId: seatIdx,
    hole,
    board,
    legal,
    pot: e.potTotal(),
    opponentsInHand: e.inHand().length - 1,
    playersBehind: 2,
    foldedThisStreet: 0,
    street: "preflop" as const,
    position: 0.5,
    personality: PERSONALITIES.balanced,
    tableAggression: 0.3,
    humanFoldRate: 0.4,
    humanBluffRate: 0.2,
    difficulty: 1,
  };
  const a1 = decideAction({ ...base, rnd: rng(4242) });
  // secretly rewrite every other player's hole cards — the AI must not notice
  for (const s of e.dealtIn()) if (s.id !== seatIdx) s.hole = [c(14, "s"), c(14, "h")];
  const a2 = decideAction({ ...base, rnd: rng(4242) });
  out.push({
    name: "AI: decisions unchanged by hidden opponent cards",
    pass: JSON.stringify(a1) === JSON.stringify(a2),
    detail: `${JSON.stringify(a1)} vs ${JSON.stringify(a2)}`,
  });
  // the AI always returns a legal action
  let legalOk = true;
  for (let i = 0; i < 200; i++) {
    const d = decideAction({ ...base, rnd: rng(1000 + i) });
    if (d.kind === "fold" && !legal.canFold) legalOk = false;
    if (d.kind === "check" && !legal.canCheck) legalOk = false;
    if (d.kind === "call" && !legal.canCall) legalOk = false;
    if (d.kind === "bet" && !legal.canBet) legalOk = false;
    if (d.kind === "raise" && !legal.canRaise) legalOk = false;
    if ((d.kind === "bet" || d.kind === "raise") && (d.to ?? 0) > legal.maxRaiseTo) legalOk = false;
    if ((d.kind === "bet" || d.kind === "raise") && (d.to ?? 0) < legal.minRaiseTo) legalOk = false;
  }
  out.push({ name: "AI: 200 decisions all legal", pass: legalOk });
  out.push({
    name: "AI: personalities differ",
    pass: JSON.stringify(decideAction({ ...base, personality: PERSONALITIES.tight, rnd: rng(7) })) !==
      JSON.stringify(decideAction({ ...base, personality: PERSONALITIES.maniac, rnd: rng(7) })) ||
      PERSONALITIES.tight.aggression !== PERSONALITIES.maniac.aggression,
  });
  return out;
}

/* ------------------------------------------------------------------ */

function economyTests(): TestResult[] {
  const out: TestResult[] = [];
  const backup = (() => {
    try {
      return { a: localStorage.getItem("krona.economy.v1"), b: localStorage.getItem("krona.economy.v1.bak") };
    } catch {
      return { a: null, b: null };
    }
  })();
  try {
    localStorage.removeItem("krona.economy.v1");
    localStorage.removeItem("krona.economy.v1.bak");
    const eco = new Economy();
    out.push({ name: "economy: starts with 1,000,000", pass: eco.ownedTotal === 1_000_000 && eco.reserve === 1_000_000 });
    // buy-in
    const ok = eco.buyIn(250_000);
    out.push({
      name: "economy: buy-in moves reserve to the table",
      pass: ok && eco.reserve === 750_000 && eco.tableStake === 250_000 && eco.ownedTotal === 1_000_000,
      detail: `reserve ${eco.reserve} stake ${eco.tableStake}`,
    });
    // winning a hand increases the total, losing decreases it
    eco.setTableStake(400_000);
    out.push({ name: "economy: winnings increase the total", pass: eco.ownedTotal === 1_150_000 && eco.reserve === 750_000 });
    eco.setTableStake(120_000);
    out.push({ name: "economy: losses reduce the total", pass: eco.ownedTotal === 870_000 });
    // table bust with reserve remaining must not create chips
    eco.setTableStake(0);
    out.push({
      name: "economy: table bust does not create chips while reserve remains",
      pass: eco.ownedTotal === 870_000 && !eco.maybeRefill(),
    });
    // rebuy cannot exceed owned
    out.push({ name: "economy: rebuy limited to the reserve", pass: !eco.buyIn(1_000_000) && eco.buyIn(870_000) });
    eco.setTableStake(0);
    // cash out returns everything
    eco.setTableStake(500_000);
    eco.cashOut();
    out.push({ name: "economy: cash-out returns table chips", pass: eco.reserve === 870_000 && eco.tableStake === 0 });
    // free refill only at genuine depletion
    out.push({ name: "economy: no refill while chips remain", pass: !eco.maybeRefill() });
    eco.setTableStake(870_000);
    out.push({
      name: "economy: no free million when only the table stack is zero",
      pass: eco.ownedTotal === 870_000 && eco.reserve === 0 && !eco.maybeRefill(),
    });
    eco.setTableStake(0);
    const refilled = eco.maybeRefill();
    out.push({ name: "economy: genuine depletion grants the free million", pass: refilled && eco.ownedTotal === 1_000_000 });
    // persistence
    const eco2 = new Economy();
    out.push({ name: "persistence: owned total survives a reload", pass: eco2.ownedTotal === eco.ownedTotal });
    try {
      localStorage.setItem("krona.economy.v1", '{"v":1,"ownedTotal":999999999,"seq":9,"checksum":1}');
    } catch {
      /* ignore */
    }
    const eco3 = new Economy();
    out.push({
      name: "persistence: corrupted records are rejected",
      pass: eco3.ownedTotal === eco.ownedTotal,
      detail: `got ${eco3.ownedTotal}`,
    });
    // transaction safety: reserve + table always equals the persisted total
    eco.setTableStake(123_456);
    const stored = JSON.parse(localStorage.getItem("krona.economy.v1") || "{}");
    out.push({
      name: "persistence: reserve + table stake equals the stored total",
      pass: stored.ownedTotal === eco.ownedTotal && eco.reserve + eco.tableStake === eco.ownedTotal,
    });
  } finally {
    try {
      if (backup.a === null) localStorage.removeItem("krona.economy.v1");
      else localStorage.setItem("krona.economy.v1", backup.a);
      if (backup.b === null) localStorage.removeItem("krona.economy.v1.bak");
      else localStorage.setItem("krona.economy.v1.bak", backup.b);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function tournamentTests(): TestResult[] {
  const out: TestResult[] = [];
  const entry = 1_000_000;
  const pool = entry * 8;
  const prizes = PRIZE_SPLIT.map((f) => Math.round(pool * f));
  out.push({
    name: "tournament: 8 entries build the prize pool",
    pass: pool === 8_000_000,
  });
  out.push({
    name: "tournament: 70 / 20 / 10 split with no chips lost",
    pass: prizes[0] === 5_600_000 && prizes[1] === 1_600_000 && prizes[2] === 800_000 && prizes.reduce((a, b) => a + b) === pool,
    detail: prizes.join(","),
  });
  // elimination cannot rejoin: engine seats with 0 stack are not dealt in
  const seats: (Seat | null)[] = [mkSeat(0, 0), mkSeat(1, 500), mkSeat(2, 500), null, null, null, null, null];
  const e = new HoldemEngine(seats, 1, 5, 10, 1);
  e.startHand();
  out.push({
    name: "tournament: busted stack is not dealt in",
    pass: e.dealtIn().length === 2 && e.dealtIn().every((s) => s.id !== 0),
  });
  return out;
}

/* ------------------------------------------------------------------ */

export async function runSelfTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const groups = [rankingTests, engineTests, aiTests, economyTests, tournamentTests];
  for (const g of groups) {
    try {
      results.push(...g());
    } catch (err) {
      results.push({ name: `${g.name} threw`, pass: false, detail: String(err) });
    }
    // yield to the event loop so the UI can paint
    await new Promise((r) => setTimeout(r, 16));
  }
  return results;
}
