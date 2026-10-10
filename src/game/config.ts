/** KRONA — table / tournament configuration and cast of AI opponents. */

export interface CashTier {
  level: number;
  chips: number;
  sb: number;
  bb: number;
  /** maximum chips a single player may have at this table */
  maxTable: number;
}

export const CASH_TIERS: CashTier[] = [
  { level: 1, chips: 1000, sb: 5, bb: 10, maxTable: 4000 },
  { level: 2, chips: 5000, sb: 25, bb: 50, maxTable: 20000 },
  { level: 3, chips: 10000, sb: 50, bb: 100, maxTable: 40000 },
  { level: 4, chips: 20000, sb: 100, bb: 200, maxTable: 80000 },
  { level: 5, chips: 30000, sb: 150, bb: 300, maxTable: 120000 },
  { level: 6, chips: 40000, sb: 200, bb: 400, maxTable: 160000 },
  { level: 7, chips: 50000, sb: 250, bb: 500, maxTable: 200000 },
  { level: 8, chips: 60000, sb: 300, bb: 600, maxTable: 240000 },
  { level: 9, chips: 70000, sb: 350, bb: 700, maxTable: 280000 },
  { level: 10, chips: 80000, sb: 400, bb: 800, maxTable: 320000 },
  { level: 11, chips: 90000, sb: 450, bb: 900, maxTable: 360000 },
  { level: 12, chips: 100000, sb: 500, bb: 1000, maxTable: 400000 },
];

export interface TournamentDef {
  id: "bronze" | "silver" | "gold" | "crown";
  name: string;
  entry: number;
  startingStack: number;
  sb: number;
  bb: number;
  ornament: string;
  blurb: string;
}

export const TOURNAMENTS: TournamentDef[] = [
  {
    id: "bronze",
    name: "Bronze Horn",
    entry: 1_000_000,
    startingStack: 100_000,
    sb: 250,
    bb: 500,
    ornament: "\u25C7",
    blurb: "Eight seats. One survivor. Fixed blinds.",
  },
  {
    id: "silver",
    name: "Silver Raven",
    entry: 2_000_000,
    startingStack: 200_000,
    sb: 500,
    bb: 1000,
    ornament: "\u25C8",
    blurb: "Deeper stacks, sharper blades.",
  },
  {
    id: "gold",
    name: "Gold Serpent",
    entry: 5_000_000,
    startingStack: 500_000,
    sb: 1250,
    bb: 2500,
    ornament: "\u2726",
    blurb: "A jarl's purse for the worthy.",
  },
  {
    id: "crown",
    name: "Krona Crown",
    entry: 10_000_000,
    startingStack: 1_000_000,
    sb: 2500,
    bb: 5000,
    ornament: "\u2655",
    blurb: "The highest table in the north.",
  },
];

export const PRIZE_SPLIT = [0.7, 0.2, 0.1];

/** Viking tavern cast — names, look descriptions and playing styles. */
export interface CastMember {
  name: string;
  archetype: "tight" | "maniac" | "passive" | "calculator" | "bluffer" | "balanced";
  gender: "m" | "f";
  /** 0..1 build variations */
  height: number;
  build: number;
  age: number;
  hair: number; // palette index
  skin: number;
  tunic: number;
  cloak: number;
  beard: number; // 0 none .. 1 long
  hairStyle: "long" | "braids" | "short" | "topknot" | "shaved" | "loose";
  accessory: "none" | "torc" | "armring" | "pendant" | "eyepatch" | "scarf";
}

export const CAST: CastMember[] = [
  { name: "Sigrid Torvasdottir", archetype: "calculator", gender: "f", height: 0.97, build: 0.46, age: 0.5, hair: 2, skin: 1, tunic: 4, cloak: 0, beard: 0, hairStyle: "braids", accessory: "pendant" },
  { name: "Halvar Stein", archetype: "tight", gender: "m", height: 1.04, build: 0.75, age: 0.6, hair: 4, skin: 0, tunic: 1, cloak: 2, beard: 0.85, hairStyle: "long", accessory: "armring" },
  { name: "Ylva the Quiet", archetype: "passive", gender: "f", height: 0.93, build: 0.4, age: 0.35, hair: 0, skin: 2, tunic: 3, cloak: 1, beard: 0, hairStyle: "loose", accessory: "scarf" },
  { name: "Ragnvald Bjorn", archetype: "maniac", gender: "m", height: 1.09, build: 0.95, age: 0.45, hair: 3, skin: 0, tunic: 5, cloak: 0, beard: 0.55, hairStyle: "shaved", accessory: "torc" },
  { name: "Astrid Vind", archetype: "bluffer", gender: "f", height: 1.0, build: 0.5, age: 0.3, hair: 1, skin: 1, tunic: 0, cloak: 3, beard: 0, hairStyle: "topknot", accessory: "armring" },
  { name: "Torvald Eskil", archetype: "balanced", gender: "m", height: 1.02, build: 0.62, age: 0.7, hair: 5, skin: 0, tunic: 2, cloak: 4, beard: 0.7, hairStyle: "braids", accessory: "pendant" },
  { name: "Eir Sandulf", archetype: "tight", gender: "m", height: 0.99, build: 0.55, age: 0.55, hair: 4, skin: 2, tunic: 6, cloak: 0, beard: 0.3, hairStyle: "short", accessory: "none" },
  { name: "Gudrun Hvit", archetype: "calculator", gender: "f", height: 0.96, build: 0.52, age: 0.62, hair: 0, skin: 1, tunic: 5, cloak: 2, beard: 0, hairStyle: "braids", accessory: "torc" },
  { name: "Ketil Orn", archetype: "maniac", gender: "m", height: 1.06, build: 0.8, age: 0.4, hair: 3, skin: 0, tunic: 1, cloak: 0, beard: 0.95, hairStyle: "long", accessory: "eyepatch" },
  { name: "Liv Solvig", archetype: "bluffer", gender: "f", height: 0.95, build: 0.44, age: 0.28, hair: 2, skin: 1, tunic: 4, cloak: 1, beard: 0, hairStyle: "loose", accessory: "scarf" },
  { name: "Orm the Elder", archetype: "balanced", gender: "m", height: 1.0, build: 0.68, age: 0.85, hair: 5, skin: 0, tunic: 3, cloak: 4, beard: 1.0, hairStyle: "braids", accessory: "pendant" },
  { name: "Thora Kylla", archetype: "passive", gender: "f", height: 0.94, build: 0.48, age: 0.45, hair: 1, skin: 2, tunic: 0, cloak: 2, beard: 0, hairStyle: "topknot", accessory: "none" },
  { name: "Vigdis Mar", archetype: "tight", gender: "f", height: 0.98, build: 0.55, age: 0.58, hair: 4, skin: 1, tunic: 6, cloak: 3, beard: 0, hairStyle: "braids", accessory: "armring" },
  { name: "Ulf Heimrik", archetype: "calculator", gender: "m", height: 1.03, build: 0.7, age: 0.5, hair: 0, skin: 0, tunic: 2, cloak: 0, beard: 0.45, hairStyle: "short", accessory: "torc" },
];

export const HAIR_COLORS = ["#3a2418", "#7a4a22", "#c2913f", "#1e1712", "#b9b2a6", "#6d6a63"];
export const SKIN_COLORS = ["#c99b74", "#b8865f", "#a3734f"];
export const TUNIC_COLORS = ["#5c2b28", "#2f4a52", "#4a4327", "#2c2b33", "#5a3a1c", "#333d33", "#43252f"];
export const CLOAK_COLORS = ["#4a2a22", "#2a333d", "#3d3a26", "#221f2a", "#4a3c2c", "#2e3a3a"];
