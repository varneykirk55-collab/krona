/**
 * KRONA — UI store (zustand).
 * Holds only what the interface renders. All poker truth lives in the engine
 * and is published here as immutable snapshots.
 */
import { create } from "zustand";
import { Card, LegalActions } from "../poker/types";
import type { CastMember, TournamentDef } from "./config";
import type { TournamentStanding } from "./controller";

export interface UISeat {
  id: number;
  name: string;
  stack: number;
  bet: number;
  folded: boolean;
  allIn: boolean;
  lastAction: string | null;
  isHuman: boolean;
  sittingOut: boolean;
  inHand: boolean;
  hasCards: boolean;
  style: string;
  cast: CastMember | null;
  showdown: boolean;
}

export type Screen = "menu" | "cash-select" | "tournament-select" | "table" | "settings" | "reference";

export interface UISnapshot {
  mode: "none" | "cash" | "tournament";
  running: boolean;
  paused: boolean;
  sb: number;
  bb: number;
  handNo: number;
  street: string;
  board: Card[];
  pot: number;
  dealer: number;
  actionSeat: number;
  seats: (UISeat | null)[];
  hole: Card[];
  holeRevealed: boolean;
  legal: LegalActions | null;
  message: string;
  handResult: string | null;
  rebuyOpen: boolean;
  rebuyMin: number;
  rebuyMax: number;
  buyIn: number;
  maxTable: number;
  tournament: {
    name: string;
    entry: number;
    entrants: number;
    remaining: number;
    finished: boolean;
    prizes: TournamentStanding[];
  } | null;
  reserve: number;
  ownedTotal: number;
  tableStake: number;
}

export type JoinMode = "new" | "join";

interface GameStore {
  screen: Screen;
  snapshot: UISnapshot | null;
  joinMode: JoinMode;
  selectedTier: number;
  selectedTournament: TournamentDef | null;
  settings: {
    music: number;
    ambient: number;
    sfx: number;
    quality: "low" | "medium" | "high";
    speed: number;
    leftHanded: boolean;
  };
  refillAnim: number;
  setScreen: (s: Screen) => void;
  setJoinMode: (m: JoinMode) => void;
  setTier: (t: number) => void;
  setTournament: (t: TournamentDef | null) => void;
  setSetting: <K extends keyof GameStore["settings"]>(k: K, v: GameStore["settings"][K]) => void;
  publish: (s: UISnapshot) => void;
  triggerRefillAnim: () => void;
}

export const useGame = create<GameStore>((set) => ({
  screen: "menu",
  snapshot: null,
  joinMode: "new",
  selectedTier: 3,
  selectedTournament: null,
  settings: { music: 0.45, ambient: 0.5, sfx: 0.7, quality: "high", speed: 1, leftHanded: false },
  refillAnim: 0,
  setScreen: (s) => set({ screen: s }),
  setJoinMode: (m) => set({ joinMode: m }),
  setTier: (t) => set({ selectedTier: t }),
  setTournament: (t) => set({ selectedTournament: t }),
  setSetting: (k, v) => set((st) => ({ settings: { ...st.settings, [k]: v } })),
  publish: (s) => set({ snapshot: s }),
  triggerRefillAnim: () => set({ refillAnim: Date.now() }),
}));
