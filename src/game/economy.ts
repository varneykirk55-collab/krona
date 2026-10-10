/**
 * KRONA — Economy manager.
 *
 * The authoritative chip total is `ownedTotal` = reserve + tableStake.
 * It only ever changes when chips genuinely enter or leave the player's
 * possession (buy-in transfers, hand results, tournament fees/prizes, free
 * refill). Persisting this single number on every financially significant
 * action means an unexpected browser closure can neither duplicate nor
 * destroy table chips.
 */

const KEY = "krona.economy.v1";
const KEY_BAK = "krona.economy.v1.bak";
const START_BALANCE = 1_000_000;
export const REFILL_AMOUNT = 1_000_000;

interface Persisted {
  v: number;
  ownedTotal: number;
  seq: number;
  updatedAt: number;
  checksum: number;
}

function checksum(v: number, seq: number) {
  // simple non-cryptographic integrity marker
  return Math.round((v * 2654435761 + seq * 40503) % 2147483647);
}

function readKey(key: string): Persisted | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    if (typeof p?.ownedTotal !== "number" || !isFinite(p.ownedTotal) || p.ownedTotal < 0) return null;
    if (p.v !== 1) return null;
    if (checksum(p.ownedTotal, p.seq ?? 0) !== p.checksum) return null;
    return p;
  } catch {
    return null;
  }
}

export class Economy {
  ownedTotal: number;
  /** chips of ownedTotal currently seated at a poker table */
  tableStake = 0;
  private seq = 0;
  /** total awarded by free refills (not shown to the player, no limits) */
  refillCount = 0;
  /** observer */
  onChange: (() => void) | null = null;

  constructor() {
    const primary = readKey(KEY);
    const backup = readKey(KEY_BAK);
    let p = primary;
    if (!p && backup) p = backup;
    if (p && !primary && backup) {
      // recover from backup immediately
      this.ownedTotal = backup.ownedTotal;
      this.seq = backup.seq ?? 0;
      this.persist();
    } else if (p) {
      this.ownedTotal = p.ownedTotal;
      this.seq = p.seq ?? 0;
      this.persist();
    } else {
      this.ownedTotal = START_BALANCE;
      this.persist();
    }
  }

  get reserve() {
    return Math.max(0, this.ownedTotal - this.tableStake);
  }

  get isTotallyBroke() {
    return this.ownedTotal <= 0;
  }

  private persist() {
    this.seq++;
    const p: Persisted = {
      v: 1,
      ownedTotal: Math.round(this.ownedTotal),
      seq: this.seq,
      updatedAt: Date.now(),
      checksum: checksum(Math.round(this.ownedTotal), this.seq),
    };
    try {
      const prev = localStorage.getItem(KEY);
      if (prev) localStorage.setItem(KEY_BAK, prev);
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* storage unavailable — keep playing in memory */
    }
    this.onChange?.();
  }

  /**
   * The player's chips at the table changed because of a hand result.
   * The reserve is untouched, so the owned total moves by the same delta.
   */
  setTableStake(stake: number) {
    const s = Math.max(0, Math.round(stake));
    if (s === this.tableStake) return;
    const delta = s - this.tableStake;
    this.ownedTotal = Math.max(0, this.ownedTotal + delta);
    this.tableStake = s;
    this.persist();
  }

  /**
   * Buy-in / rebuy: chips move from the reserve to the table. Nothing is
   * created or destroyed, so the owned total is unchanged.
   */
  buyIn(amount: number): boolean {
    const amt = Math.round(amount);
    if (amt <= 0 || amt > this.reserve) return false;
    this.tableStake += amt;
    this.persist();
    return true;
  }

  /** Leave the table: all table chips return to the reserve. */
  cashOut() {
    if (this.tableStake === 0) return;
    this.tableStake = 0;
    this.persist();
  }

  /** Tournament entry fee is genuinely spent. */
  payFee(amount: number): boolean {
    const amt = Math.round(amount);
    if (amt <= 0 || amt > this.reserve) return false;
    this.ownedTotal -= amt;
    this.persist();
    return true;
  }

  receivePrize(amount: number) {
    const amt = Math.round(amount);
    if (amt <= 0) return;
    this.ownedTotal += amt;
    this.persist();
  }

  /**
   * Free, unlimited refill — only when the player owns literally nothing,
   * counting both reserve chips and chips already committed to a table.
   */
  maybeRefill(): boolean {
    if (!this.isTotallyBroke) return false;
    this.ownedTotal = REFILL_AMOUNT;
    this.tableStake = 0;
    this.refillCount++;
    this.persist();
    return true;
  }
}

export const economy = new Economy();
