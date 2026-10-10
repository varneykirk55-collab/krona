/**
 * KRONA — menus: title screen, cash game lobby, tournament lobby, settings
 * and the art-reference gallery.
 */
import { useState } from "react";
import { CASH_TIERS, TOURNAMENTS } from "../game/config";
import { economy } from "../game/economy";
import { game } from "../game/controller";
import { useGame } from "../game/store";
import { audio } from "../audio/audio";
import { runSelfTests, TestResult } from "../tests/selftest";
import menuBg from "../assets/menu-bg.jpg";
import refChars from "../assets/ref-chars.jpg";
import refTable from "../assets/ref-table.jpg";
import refVillage from "../assets/ref-village.jpg";

export function fmt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

export function Ornament({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 20" className={className} aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M4 10 H70" />
        <path d="M150 10 H216" />
        <path d="M78 10 l8 -7 8 7 -8 7z" />
        <path d="M126 10 l8 -7 8 7 -8 7z" />
        <path d="M94 10 l16 -8 16 8 -16 8z" />
        <circle cx="110" cy="10" r="2.2" fill="currentColor" />
      </g>
    </svg>
  );
}

export function Title({ small = false }: { small?: boolean }) {
  return (
    <div className="flex flex-col items-center select-none">
      <div
        className="font-serif tracking-[0.36em] text-transparent bg-clip-text"
        style={{
          backgroundImage: "linear-gradient(180deg,#fdf3cf 0%,#e8c979 38%,#b98f3c 62%,#7d5c1f 100%)",
          fontSize: small ? "clamp(22px,4vw,34px)" : "clamp(38px,9vw,86px)",
          textShadow: "0 2px 18px rgba(0,0,0,0.75)",
          letterSpacing: small ? "0.28em" : "0.34em",
          paddingLeft: "0.34em",
        }}
      >
        KRONA
      </div>
      {!small && (
        <>
          <Ornament className="w-[min(520px,72vw)] h-4 text-[#c9a341] opacity-80 mt-1" />
          <div className="text-[10px] sm:text-xs tracking-[0.5em] text-[#c6b28a] mt-1 pl-[0.5em] uppercase">
            Viking Hold&rsquo;em
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg border border-[#7a6231]/70 backdrop-blur-[2px] ${className}`}
      style={{
        background: "linear-gradient(180deg,rgba(22,17,12,0.93),rgba(12,10,8,0.96))",
        boxShadow: "0 10px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(226,196,124,0.14)",
      }}
    >
      {children}
    </div>
  );
}

export function MenuButton({
  children,
  onClick,
  disabled,
  wide,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      onPointerDown={() => audio.click()}
      onClick={onClick}
      disabled={disabled}
      className={`group relative ${wide ? "w-full" : "w-[min(320px,70vw)]"} px-6 py-3 rounded border text-[13px] sm:text-sm tracking-[0.28em] uppercase font-serif transition-all active:scale-[0.985] disabled:opacity-40 disabled:cursor-not-allowed`}
      style={{
        borderColor: "#8a6d33",
        background: "linear-gradient(180deg,rgba(58,44,24,0.9),rgba(24,19,12,0.95))",
        color: "#e8d5a8",
        boxShadow: "inset 0 1px 0 rgba(255,226,160,0.18), 0 4px 14px rgba(0,0,0,0.5)",
      }}
    >
      <span className="relative z-10">{children}</span>
      <span
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity rounded"
        style={{ background: "linear-gradient(180deg,rgba(201,163,65,0.22),rgba(201,163,65,0.04))" }}
      />
    </button>
  );
}

/* ------------------------------------------------------------------ */

export function MainMenu({ onExit }: { onExit: () => void }) {
  const setScreen = useGame((s) => s.setScreen);
  const owned = economy.ownedTotal;
  const refill = useGame((s) => s.refillAnim);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-between py-[2vh] px-4">
      <div className="flex-1 flex flex-col items-center justify-center gap-[2vh] -mt-[1vh]">
        <Title />
        <div className="flex flex-col gap-2 sm:gap-3 mt-2">
          <MenuButton onClick={() => setScreen("cash-select")}>Cash Game</MenuButton>
          <MenuButton onClick={() => setScreen("tournament-select")}>Tournament</MenuButton>
          <MenuButton onClick={() => setScreen("settings")}>Settings</MenuButton>
          <MenuButton onClick={onExit}>Exit</MenuButton>
        </div>
      </div>
      <div className="flex items-end gap-4 w-full justify-between">
        <div className="text-[10px] sm:text-[11px] text-[#9a8a6c] tracking-[0.2em] uppercase">
          Single player &middot; No-limit hold&rsquo;em &middot; Fictional chips
        </div>
        <div className="text-right">
          <div className="text-[9px] sm:text-[10px] tracking-[0.3em] text-[#a6906a] uppercase">Bankroll</div>
          <div
            className="font-serif text-[15px] sm:text-xl"
            style={{ color: "#f0d69a", textShadow: "0 0 14px rgba(201,163,65,0.35)" }}
          >
            {fmt(owned)}
          </div>
          {refill > 0 && <div className="text-[9px] text-[#8fbf8f] tracking-widest">+1,000,000 restored</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function CashSelect() {
  const setScreen = useGame((s) => s.setScreen);
  const joinMode = useGame((s) => s.joinMode);
  const setJoinMode = useGame((s) => s.setJoinMode);
  const tier = useGame((s) => s.selectedTier);
  const setTier = useGame((s) => s.setTier);
  const [note, setNote] = useState<string | null>(null);
  const t = CASH_TIERS[tier - 1];
  const canAfford = economy.reserve >= t.chips;

  return (
    <div className="absolute inset-0 flex flex-col p-[2vh] sm:p-[3vh] gap-[1.4vh]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setScreen("menu")} className="text-[#c9a341] text-xs tracking-[0.2em] uppercase hover:text-[#f0d69a]">
            &larr; Back
          </button>
          <Title small />
        </div>
        <div className="text-right">
          <div className="text-[9px] tracking-[0.3em] text-[#a6906a] uppercase">Reserve</div>
          <div className="font-serif text-[#f0d69a] text-base sm:text-lg">{fmt(economy.reserve)}</div>
        </div>
      </div>

      <Panel className="flex-1 flex flex-col p-3 sm:p-4 gap-3 min-h-0">
        <div className="flex gap-2">
          {(["new", "join"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setJoinMode(m)}
              className={`flex-1 px-3 py-2 rounded border text-[11px] sm:text-xs uppercase tracking-[0.2em] transition-colors`}
              style={{
                borderColor: joinMode === m ? "#c9a341" : "#6b5730",
                background: joinMode === m ? "rgba(201,163,65,0.16)" : "rgba(0,0,0,0.3)",
                color: joinMode === m ? "#f4e2b4" : "#9c8a66",
              }}
            >
              {m === "new" ? "Start New Game" : "Join Game in Progress"}
            </button>
          ))}
        </div>
        <div className="text-[10px] sm:text-[11px] text-[#9a8a6c] leading-snug">
          {joinMode === "new"
            ? "A fresh table is opened for you — every seat starts with the full buy-in."
            : "You take an open seat at a table already in play. Varied stacks, a hand in progress — you are dealt in from the next hand."}
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5 sm:gap-2 overflow-y-auto">
          {CASH_TIERS.map((c) => (
            <button
              key={c.level}
              onClick={() => setTier(c.level)}
              className="rounded border px-1 py-1.5 text-center transition-colors"
              style={{
                borderColor: tier === c.level ? "#e8c979" : "#5e4c2a",
                background: tier === c.level ? "rgba(201,163,65,0.18)" : "rgba(0,0,0,0.35)",
              }}
            >
              <div className="text-[8px] tracking-widest text-[#9a8a6c] uppercase">Lv {c.level}</div>
              <div className="font-serif text-[11px] sm:text-[13px] text-[#f0d69a] leading-tight">{fmt(c.chips)}</div>
              <div className="text-[8px] text-[#8f8equi]" />
              <div className="text-[8px] sm:text-[9px] text-[#9a8a6c]">
                {c.sb}/{c.bb}
              </div>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 justify-between mt-auto">
          <div className="text-[10px] sm:text-xs text-[#b6a077]">
            Buy-in <span className="text-[#f0d69a] font-serif">{fmt(t.chips)}</span> &middot; Blinds{" "}
            <span className="text-[#f0d69a] font-serif">
              {t.sb}/{t.bb}
            </span>{" "}
            &middot; Table max <span className="text-[#f0d69a] font-serif">{fmt(t.maxTable)}</span>
          </div>
          <MenuButton
            wide={false}
            disabled={!canAfford}
            onClick={() => {
              if (!canAfford) {
                setNote("Not enough chips in reserve.");
                return;
              }
              audio.click();
              game.startCash(t, joinMode === "join");
              useGame.getState().setScreen("table");
            }}
          >
            Take a Seat
          </MenuButton>
        </div>
        {note && <div className="text-[11px] text-[#d08a6a]">{note}</div>}
        {!canAfford && <div className="text-[10px] text-[#a8763f]">This buy-in exceeds your reserve.</div>}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function TournamentSelect() {
  const setScreen = useGame((s) => s.setScreen);
  const [sel, setSel] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const t = TOURNAMENTS[sel];
  const pool = t.entry * 8;
  const canAfford = economy.reserve >= t.entry;
  return (
    <div className="absolute inset-0 flex flex-col p-[2vh] sm:p-[3vh] gap-[1.4vh]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setScreen("menu")} className="text-[#c9a341] text-xs tracking-[0.2em] uppercase hover:text-[#f0d69a]">
            &larr; Back
          </button>
          <Title small />
        </div>
        <div className="text-right">
          <div className="text-[9px] tracking-[0.3em] text-[#a6906a] uppercase">Reserve</div>
          <div className="font-serif text-[#f0d69a] text-base sm:text-lg">{fmt(economy.reserve)}</div>
        </div>
      </div>
      <Panel className="flex-1 p-3 sm:p-4 flex flex-col gap-3 min-h-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TOURNAMENTS.map((tn, i) => (
            <button
              key={tn.id}
              onClick={() => setSel(i)}
              className="rounded border p-2 text-left transition-colors"
              style={{
                borderColor: sel === i ? "#e8c979" : "#5e4c2a",
                background: sel === i ? "rgba(201,163,65,0.16)" : "rgba(0,0,0,0.35)",
              }}
            >
              <div className="text-[#c9a341] text-lg leading-none">{tn.ornament}</div>
              <div className="font-serif text-[12px] sm:text-sm text-[#f0d69a]">{tn.name}</div>
              <div className="text-[10px] text-[#b6a077] font-serif">{fmt(tn.entry)}</div>
              <div className="text-[9px] text-[#8f8264]">
                {tn.sb}/{tn.bb} &middot; {fmt(tn.startingStack)}
              </div>
            </button>
          ))}
        </div>
        <div className="text-[10px] sm:text-[11px] text-[#9a8a6c] leading-relaxed">
          {t.blurb} Eight players, single table, no rebuys and no refills — blinds stay {t.sb}/{t.bb} for the whole event.
          Leaving an unfinished tournament forfeits the entry fee.
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded border border-[#5e4c2a] bg-black/30 py-1.5">
              <div className="text-[9px] tracking-[0.25em] text-[#a6906a] uppercase">{["First", "Second", "Third"][i]}</div>
              <div className="font-serif text-[#f0d69a] text-sm">{fmt(pool * [0.7, 0.2, 0.1][i])}</div>
            </div>
          ))}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3">
          <div className="text-[10px] sm:text-xs text-[#b6a077]">
            Entry <span className="text-[#f0d69a] font-serif">{fmt(t.entry)}</span> &middot; Prize pool{" "}
            <span className="text-[#f0d69a] font-serif">{fmt(pool)}</span>
          </div>
          <MenuButton
            disabled={!canAfford}
            onClick={() => {
              if (!canAfford) {
                setNote("Not enough chips for this entry fee.");
                return;
              }
              game.startTournament(t);
              useGame.getState().setScreen("table");
            }}
          >
            Enter
          </MenuButton>
        </div>
        {note && <div className="text-[11px] text-[#d08a6a]">{note}</div>}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const REFERENCE = [
  {
    title: "Tavern interior",
    img: menuBg,
    text: "Heavy timber walls, exposed rafters, carved posts, stone hearth, iron fittings, fur rugs, barrels and horns. Warm lantern key light with cool window fill.",
  },
  {
    title: "Snowy village",
    img: refVillage,
    text: "Layered geometry beyond the windows: timber houses, snow roofs, lit windows, fences, pines, falling snow and cold blue-grey atmospheric perspective.",
  },
  {
    title: "Carved table & chairs",
    img: refTable,
    text: "Oval racetrack table, carved oak band with knotwork, padded leather rail, brass studs, heavy pedestal. Chairs with fur seats and high carved crests.",
  },
  {
    title: "Characters",
    img: refChars,
    text: "Rigged figures with real proportions. Varied height, build, age, gender, hair, beards, clothing and accessories. Tunics, cloaks, belts, torcs, arm rings.",
  },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useGame((s) => s.settings);
  const setSetting = useGame((s) => s.setSetting);
  const [tests, setTests] = useState<TestResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"settings" | "reference">("settings");

  const sliders: { key: "music" | "ambient" | "sfx"; label: string }[] = [
    { key: "music", label: "Music" },
    { key: "ambient", label: "Ambient" },
    { key: "sfx", label: "Sound effects" },
  ];

  return (
    <div className="absolute inset-0 flex flex-col p-[2vh] sm:p-[3vh] gap-[1.4vh]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="text-[#c9a341] text-xs tracking-[0.2em] uppercase hover:text-[#f0d69a]">
            &larr; Back
          </button>
          <Title small />
        </div>
        <div className="flex gap-2">
          {(["settings", "reference"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-3 py-1 rounded border text-[10px] uppercase tracking-[0.2em]"
              style={{
                borderColor: tab === t ? "#c9a341" : "#5e4c2a",
                color: tab === t ? "#f4e2b4" : "#9c8a66",
                background: tab === t ? "rgba(201,163,65,0.16)" : "rgba(0,0,0,0.3)",
              }}
            >
              {t === "settings" ? "Settings" : "Art reference"}
            </button>
          ))}
        </div>
      </div>

      <Panel className="flex-1 p-3 sm:p-5 overflow-y-auto min-h-0">
        {tab === "settings" ? (
          <div className="grid sm:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div className="text-[10px] tracking-[0.3em] text-[#a6906a] uppercase">Audio</div>
              {sliders.map((s) => (
                <label key={s.key} className="block">
                  <div className="flex justify-between text-[11px] text-[#c6b28a] mb-1">
                    <span>{s.label}</span>
                    <span className="font-serif text-[#f0d69a]">{Math.round(settings[s.key] * 100)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(settings[s.key] * 100)}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      setSetting(s.key, v);
                      audio.setVolume(s.key, v);
                    }}
                    className="w-full accent-[#c9a341]"
                  />
                </label>
              ))}
              <button
                onClick={() => audio.start()}
                className="text-[10px] uppercase tracking-[0.2em] text-[#9c8a66] hover:text-[#f0d69a]"
              >
                Resume audio
              </button>
            </div>

            <div className="space-y-4">
              <div className="text-[10px] tracking-[0.3em] text-[#a6906a] uppercase">Graphics</div>
              <div className="flex gap-2">
                {(["low", "medium", "high"] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => setSetting("quality", q)}
                    className="flex-1 px-2 py-2 rounded border text-[10px] uppercase tracking-[0.2em]"
                    style={{
                      borderColor: settings.quality === q ? "#c9a341" : "#5e4c2a",
                      color: settings.quality === q ? "#f4e2b4" : "#9c8a66",
                      background: settings.quality === q ? "rgba(201,163,65,0.16)" : "rgba(0,0,0,0.3)",
                    }}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="text-[10px] tracking-[0.3em] text-[#a6906a] uppercase">Deal &amp; action pace</div>
              <div className="flex gap-2">
                {[1, 1.5, 2].map((sp) => (
                  <button
                    key={sp}
                    onClick={() => {
                      setSetting("speed", sp);
                      game.userSpeed = sp;
                    }}
                    className="flex-1 px-2 py-2 rounded border text-[10px] uppercase tracking-[0.2em]"
                    style={{
                      borderColor: settings.speed === sp ? "#c9a341" : "#5e4c2a",
                      color: settings.speed === sp ? "#f4e2b4" : "#9c8a66",
                      background: settings.speed === sp ? "rgba(201,163,65,0.16)" : "rgba(0,0,0,0.3)",
                    }}
                  >
                    {sp}x
                  </button>
                ))}
              </div>
              <div className="text-[10px] tracking-[0.3em] text-[#a6906a] uppercase">Diagnostics</div>
              <button
                onClick={async () => {
                  setRunning(true);
                  const r = await runSelfTests();
                  setTests(r);
                  setRunning(false);
                }}
                className="px-3 py-2 rounded border border-[#5e4c2a] text-[10px] uppercase tracking-[0.2em] text-[#c6b28a] hover:text-[#f0d69a]"
              >
                {running ? "Running…" : "Run self-tests"}
              </button>
              {tests && (
                <div className="text-[10px] font-mono leading-relaxed max-h-[26vh] overflow-y-auto">
                  {tests.map((t, i) => (
                    <div key={i} className={t.pass ? "text-[#8fbf8f]" : "text-[#d97b6a]"}>
                      {t.pass ? "PASS" : "FAIL"} — {t.name}
                      {!t.pass && t.detail ? ` (${t.detail})` : ""}
                    </div>
                  ))}
                  <div className="text-[#c6b28a] mt-1">
                    {tests.filter((t) => t.pass).length}/{tests.length} passed
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-[10px] tracking-[0.3em] text-[#a6906a] uppercase">Visual targets</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {REFERENCE.map((r) => (
                <div key={r.title} className="rounded border border-[#5e4c2a] overflow-hidden bg-black/40">
                  <img src={r.img} alt={r.title} className="w-full h-[16vh] sm:h-[18vh] object-cover" />
                  <div className="p-2">
                    <div className="font-serif text-[12px] text-[#f0d69a]">{r.title}</div>
                    <div className="text-[10px] text-[#9a8a6c] leading-snug">{r.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-[10px] text-[#9a8a6c] leading-snug">
              <div>
                <span className="text-[#c6b28a]">Chips —</span> white 1, red 5, green 25, black 100, purple 500 (scaled to
                the table), gold edge spots, readable denominations, 3.6&nbsp;mm thick.
              </div>
              <div>
                <span className="text-[#c6b28a]">Cards —</span> 63.5 × 88.9 mm, 52 unique faces, Norse knotwork backs,
                rounded corners, cream stock with red/black pips.
              </div>
              <div>
                <span className="text-[#c6b28a]">First-person camera —</span> seated eye height 1.25 m, subtle sway, leans
                in when the hole cards are lifted, never cuts away during a decision.
              </div>
              <div>
                <span className="text-[#c6b28a]">HUD —</span> restrained: small name and stack labels near each seat, pot
                and blinds in the upper corners, action buttons only when it is your turn.
              </div>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
