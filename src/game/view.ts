/**
 * KRONA — presentation model.
 *
 * Translates engine events into target transforms for cards and chips.
 * The poker engine owns every chip balance; this module only decides where
 * things *appear*. Numerical amounts always come from the engine snapshot.
 */
import { Card } from "../poker/types";
import type { PokerEvent } from "../poker/engine";

/* ---------------- table geometry (metres) ---------------- */

export const TABLE = {
  feltY: 0.78,
  railY: 0.9,
  /** racetrack radii of the felt */
  rx: 1.62,
  rz: 1.02,
  /** outer rail radii */
  railRx: 1.98,
  railRz: 1.38,
  /** chair ring radii */
  seatRx: 2.42,
  seatRz: 1.72,
  cardW: 0.0635,
  cardL: 0.0889,
  cardT: 0.0006,
};

export const SEAT_COUNT = 8;

export function seatAngle(i: number) {
  return (-i / SEAT_COUNT) * Math.PI * 2;
}

export function seatPos(i: number) {
  const a = seatAngle(i);
  return { x: TABLE.seatRx * Math.sin(a), z: TABLE.seatRz * Math.cos(a) };
}

/** point on the felt in front of a seat (fraction 0..1 toward the centre) */
export function feltPoint(i: number, t: number) {
  const a = seatAngle(i);
  const rx = TABLE.rx * (1 - t * 0.86);
  const rz = TABLE.rz * (1 - t * 0.86);
  return { x: rx * Math.sin(a), z: rz * Math.cos(a) };
}

export function cardSlot(i: number, slot: number) {
  const p = feltPoint(i, 0.34);
  const a = seatAngle(i);
  // side axis (tangent) so cards sit square to the player
  const tx = Math.cos(a);
  const tz = -Math.sin(a);
  const off = (slot - 0.5) * (TABLE.cardL * 1.12);
  return { x: p.x + tx * off, z: p.z + tz * off, a };
}

export function betSlot(i: number) {
  return feltPoint(i, 0.62);
}

export function stackSlot(i: number) {
  return feltPoint(i, 0.16);
}

export const BOARD_SLOTS = 5;
export function boardSlot(slot: number) {
  const spacing = TABLE.cardL * 1.18;
  return { x: (slot - (BOARD_SLOTS - 1) / 2) * spacing, z: 0 };
}

export const POT_POS = { x: 0, z: TABLE.rz * 0.42 };
export function deckPos() {
  const p = feltPoint(4, 0.55);
  return { x: p.x - 0.28, z: p.z + 0.1 };
}
export const MUCK_POS = { x: deckPos().x - 0.34, z: deckPos().z + 0.06 };

/* ---------------- chip denominations ---------------- */

export const CHIP_DENOMS = [
  { v: 1, color: "#e8e4da", edge: "#c9a341", label: "1" },
  { v: 5, color: "#a32b26", edge: "#c9a341", label: "5" },
  { v: 25, color: "#1f6b3a", edge: "#c9a341", label: "25" },
  { v: 100, color: "#1b1a1c", edge: "#c9a341", label: "100" },
  { v: 500, color: "#5b2c7a", edge: "#c9a341", label: "500" },
];

export function chipBase(bb: number) {
  return Math.max(1, Math.round(bb / 5));
}

/** Representative breakdown for display purposes only. */
export function chipBreakdown(amount: number, base: number): { denom: number; count: number }[] {
  const out: { denom: number; count: number }[] = [];
  let rest = Math.max(0, Math.round(amount));
  if (rest === 0) return out;
  const values = CHIP_DENOMS.map((d) => d.v * base);
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    const c = Math.floor(rest / v);
    if (c > 0) {
      out.push({ denom: i, count: Math.min(c, 30) });
      rest -= c * v;
    }
  }
  if (rest > 0) out.push({ denom: 0, count: 1 });
  let total = out.reduce((a, b) => a + b.count, 0);
  while (total > 24 && out.length) {
    // thin out the largest group so stacks stay cheap to render
    let idx = 0;
    for (let i = 1; i < out.length; i++) if (out[i].count > out[idx].count) idx = i;
    out[idx].count--;
    if (out[idx].count === 0) out.splice(idx, 1);
    total--;
  }
  return out;
}

/* ---------------- visuals ---------------- */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type CardHolder = number | "board" | "deck" | "muck" | "gone";

export interface CardVisual {
  uid: string;
  card: Card | null;
  holder: CardHolder;
  slot: number;
  faceUp: boolean;
  /** where the card currently is (mutated by the renderer) */
  pos: Vec3;
  rot: Vec3;
  /** lerp target */
  target: Vec3;
  targetRot: Vec3;
  /** timestamp of last retarget */
  spawn: number;
  travel: number;
  hidden: boolean;
}

export interface ChipStackVisual {
  id: string;
  seat: number | "pot";
  amount: number;
  base: number;
  pos: Vec3;
  target: Vec3;
  /** transient flight chips */
  flights: { pos: Vec3; target: Vec3; t0: number; dur: number; progress: number }[];
  changed: number;
}

function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export class ViewModel {
  cards: CardVisual[] = [];
  stacks: ChipStackVisual[] = [];
  base = 10;
  dealerSeat = 0;
  humanSeat = 0;
  version = 0;
  lastMessage = "";
  /** 0..1 how far the human's cards are lifted for inspection */
  peek = 0;
  peekTarget = 0;
  /** first person hand animation request */
  handAction: { kind: string; seat: number; t: number } | null = null;
  winnerFlash: { seats: number[]; t: number } | null = null;
  revealLift: { seat: number; t: number } | null = null;

  clearAll() {
    this.cards = [];
    this.stacks = [];
    this.version++;
  }

  cardById(id: string) {
    return this.cards.find((c) => c.card?.id === id);
  }

  private newCard(card: Card, holder: CardHolder, slot: number, from: Vec3, _faceUp: boolean) {
    const uid = `${card.id}-${Math.random().toString(36).slice(2, 7)}`;
    const t = this.cardTarget(holder, slot, _faceUp);
    const cv: CardVisual = {
      uid,
      card,
      holder,
      slot,
      faceUp: _faceUp,
      pos: { ...from },
      rot: { x: 0, y: 0, z: 0 },
      target: t.pos,
      targetRot: t.rot,
      spawn: performance.now(),
      travel: 0.45,
      hidden: false,
    };
    this.cards.push(cv);
    this.version++;
    return cv;
  }

  cardTarget(holder: CardHolder, slot: number, _faceUp: boolean): { pos: Vec3; rot: Vec3 } {
    const y = TABLE.feltY + TABLE.cardT * 0.5 + 0.0008;
    if (holder === "board") {
      const b = boardSlot(slot);
      return { pos: v3(b.x, y, b.z), rot: v3(0, 0, 0) };
    }
    if (holder === "deck") {
      const d = deckPos();
      return { pos: v3(d.x, y + 0.012, d.z), rot: v3(0, 0, Math.PI) };
    }
    if (holder === "muck") {
      return {
        pos: v3(MUCK_POS.x + (Math.random() - 0.5) * 0.09, y + Math.random() * 0.006, MUCK_POS.z + (Math.random() - 0.5) * 0.09),
        rot: v3(0, Math.random() * 0.6 - 0.3, Math.PI),
      };
    }
    const c = cardSlot(holder as number, slot);
    // cards lie square to the owning seat
    const yaw = -c.a + Math.PI / 2;
    return { pos: v3(c.x, y, c.z), rot: v3(0, yaw, 0) };
  }

  private dealerHandPos(): Vec3 {
    const p = feltPoint(this.dealerSeat, 0.2);
    return v3(p.x, TABLE.feltY + 0.22, p.z);
  }

  private retargetAll() {
    for (const c of this.cards) {
      const t = this.cardTarget(c.holder, c.slot, c.faceUp);
      c.target = t.pos;
      c.targetRot = t.rot;
    }
  }

  applyEvent(e: PokerEvent, engineState: {
    board: Card[];
    seats: { id: number; bet: number; stack: number; folded: boolean; isHuman: boolean; hole: Card[] }[];
    potCollected: number;
    dealer: number;
  }) {
    switch (e.t) {
      case "hand-start":
        this.dealerSeat = e.dealer;
        this.cards = [];
        this.stacks = [];
        this.retargetAll();
        this.version++;
        break;
      case "deal-hole": {
        const from = this.dealerHandPos();
        for (const c of e.cards) this.newCard(c, e.seat, this.cards.filter((x) => x.holder === e.seat).length, from, false);
        this.handAction = { kind: e.isHuman ? "deal-self" : "deal", seat: this.dealerSeat, t: performance.now() };
        break;
      }
      case "board": {
        const d = deckPos();
        e.cards.forEach((c, i) => {
          const slot = engineState.board.length - e.cards.length + i;
          this.newCard(c, "board", slot, v3(d.x, TABLE.feltY + 0.03, d.z), true);
        });
        break;
      }
      case "act":
      case "post": {
        const seat = e.seat;
        if (e.t === "act" && e.kind === "fold") {
          for (const c of this.cards) {
            if (c.holder !== seat) continue;
            c.holder = "muck";
            c.faceUp = false;
            const t = this.cardTarget("muck", 0, false);
            c.target = t.pos;
            c.targetRot = t.rot;
          }
        }
        this.syncBets(engineState);
        this.handAction = {
          kind: e.kind === "fold" ? "fold" : e.kind === "check" ? "check" : "chips",
          seat,
          t: performance.now(),
        };
        break;
      }
      case "collect": {
        this.syncBets(engineState);
        break;
      }
      case "uncalled": {
        this.syncBets(engineState);
        break;
      }
      case "reveal": {
        for (const c of this.cards) {
          if (c.holder === e.seat) {
            c.faceUp = true;
            c.hidden = false;
            const t = this.cardTarget(c.holder, c.slot, true);
            c.target = { x: t.pos.x, y: t.pos.y + 0.09, z: t.pos.z };
            c.targetRot = t.rot;
          }
        }
        this.revealLift = { seat: e.seat, t: performance.now() };
        break;
      }
      case "award": {
        this.winnerFlash = { seats: [e.seat], t: performance.now() };
        this.syncBets(engineState);
        break;
      }
      case "hand-end":
        break;
    }
  }

  /** Recompute chip stack amounts/positions from the authoritative engine state. */
  syncBets(engineState: {
    board: Card[];
    seats: { id: number; bet: number; stack: number; folded: boolean; isHuman: boolean; hole: Card[] }[];
    potCollected: number;
    dealer: number;
  }) {
    this.dealerSeat = engineState.dealer;
    const now = performance.now();
    // per-seat bet stacks
    for (const s of engineState.seats) {
      const id = `bet-${s.id}`;
      let st = this.stacks.find((x) => x.id === id);
      if (s.bet > 0) {
        if (!st) {
          const p = betSlot(s.id);
          st = { id, seat: s.id, amount: 0, base: this.base, pos: v3(p.x, TABLE.feltY, p.z), target: v3(p.x, TABLE.feltY, p.z), flights: [], changed: now };
          this.stacks.push(st);
        }
        if (st.amount !== s.bet) {
          st.amount = s.bet;
          st.changed = now;
          const from = stackSlot(s.id);
          st.flights.push({ pos: v3(from.x, TABLE.feltY + 0.04, from.z), target: v3(st.pos.x, TABLE.feltY, st.pos.z), t0: now, dur: 260, progress: 0 });
        }
      } else if (st) {
        // swept to the pot
        st.flights.push({ pos: { ...st.pos }, target: v3(POT_POS.x, TABLE.feltY, POT_POS.z), t0: now, dur: 380, progress: 0 });
        this.stacks = this.stacks.filter((x) => x.id !== id);
      }
    }
    // pot stack
    const potAmount = engineState.potCollected;
    const pid = "pot";
    let pot = this.stacks.find((x) => x.id === pid);
    if (potAmount > 0) {
      if (!pot) {
        pot = { id: pid, seat: "pot", amount: 0, base: this.base, pos: v3(POT_POS.x, TABLE.feltY, POT_POS.z), target: v3(POT_POS.x, TABLE.feltY, POT_POS.z), flights: [], changed: now };
        this.stacks.push(pot);
      }
      pot.amount = potAmount;
      pot.changed = now;
    } else if (pot) {
      this.stacks = this.stacks.filter((x) => x.id !== pid);
    }
    this.version++;
  }

  /** Called by the renderer each frame. */
  tick(dt: number) {
    this.peek += (this.peekTarget - this.peek) * Math.min(1, dt * 9);
    void dt;
    const now = performance.now();
    for (const s of this.stacks) {
      for (let i = s.flights.length - 1; i >= 0; i--) {
        const f = s.flights[i];
        f.progress = Math.min(1, (now - f.t0) / Math.max(1, f.dur));
        if (now - f.t0 > f.dur + 160) s.flights.splice(i, 1);
      }
    }
  }
}
