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
import { cn } from "../utils/cn";
import { Button, Caption, fmt, Ornament, Panel, ScreenHeader, Segmented, Stat, Title } from "./kit";
import menuBg from "../assets/menu-bg.jpg";
import refChars from "../assets/ref-chars.jpg";
import refTable from "../assets/ref-table.jpg";
import refVillage from "../assets/ref-village.jpg";

export { fmt, Ornament, Title };

/** a selectable card in a lobby grid */
function Choice({ on, onClick, className, children }: { on: boolean; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded border transition-colors",
        on ? "border-gold-hi bg-gold/15" : "border-edge bg-black/35 hover:border-bronze",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** a lobby's bottom row: summary on the left, the main action on the right */
function LobbyFooter({ summary, action, note }: { summary: React.ReactNode; action: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="mt-auto flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] sm:text-xs text-[#b6a077] [&_b]:font-serif [&_b]:font-normal [&_b]:text-gold-text">{summary}</div>
        {action}
      </div>
      {note && <div className="text-[11px] text-[#d08a6a]">{note}</div>}
    </div>
  );
}

const SCREEN = "absolute inset-0 flex flex-col p-[2vh] sm:p-[3vh] gap-[1.4vh]";

/* ------------------------------------------------------------------ */

export function MainMenu({ onExit }: { onExit: () => void }) {
  const setScreen = useGame((s) => s.setScreen);
  const owned = economy.ownedTotal;
  const refill = useGame((s) => s.refillAnim);
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-between py-[2vh] px-4">
      <div className="flex-1 flex flex-col items-center justify-center gap-[2vh] -mt-[1vh]">
        <Title />
        <div className="flex flex-col gap-2 sm:gap-2.5 mt-2 w-[min(300px,70vw)]">
          <Button size="lg" onClick={() => setScreen("cash-select")}>
            Cash Game
          </Button>
          <Button size="lg" onClick={() => setScreen("tournament-select")}>
            Tournament
          </Button>
          <Button size="lg" onClick={() => setScreen("settings")}>
            Settings
          </Button>
          <Button size="lg" onClick={onExit}>
            Exit
          </Button>
        </div>
      </div>
      <div className="flex items-end gap-4 w-full justify-between">
        <Caption className="tracking-[0.2em] text-dim">Single player &middot; No-limit hold&rsquo;em &middot; Fictional chips</Caption>
        <div className="text-right">
          <Stat label="Bankroll" value={fmt(owned)} />
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
    <div className={SCREEN}>
      <ScreenHeader onBack={() => setScreen("menu")} right={<Stat label="Reserve" value={fmt(economy.reserve)} />} />

      <Panel className="flex-1 flex flex-col p-3 sm:p-4 gap-3 min-h-0">
        <div>
          <Segmented
            value={joinMode}
            onChange={setJoinMode}
            options={[
              { value: "new", label: "New table" },
              { value: "join", label: "Join in progress" },
            ]}
          />
          <p className="text-[10px] sm:text-[11px] text-dim leading-snug mt-1.5">
            {joinMode === "new"
              ? "A fresh table opens for you and every seat starts with the full buy-in."
              : "Take an open seat at a table already in play, with varied stacks. You are dealt in from the next hand."}
          </p>
        </div>

        <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-1.5 overflow-y-auto">
          {CASH_TIERS.map((c) => (
            <Choice key={c.level} on={tier === c.level} onClick={() => setTier(c.level)} className="px-1 py-1.5 text-center">
              <div className="text-[8px] tracking-widest text-dim uppercase">Lv {c.level}</div>
              <div className="font-serif text-[11px] sm:text-[13px] text-gold-text leading-tight">{fmt(c.chips)}</div>
              <div className="text-[8px] sm:text-[9px] text-dim">
                {c.sb}/{c.bb}
              </div>
            </Choice>
          ))}
        </div>

        <LobbyFooter
          summary={
            <>
              Buy-in <b>{fmt(t.chips)}</b> &middot; Blinds{" "}
              <b>
                {t.sb}/{t.bb}
              </b>{" "}
              &middot; Table max <b>{fmt(t.maxTable)}</b>
            </>
          }
          note={note ?? (!canAfford ? "This buy-in exceeds your reserve." : null)}
          action={
            <Button
              size="lg"
              disabled={!canAfford}
              onClick={() => {
                if (!canAfford) {
                  setNote("Not enough chips in reserve.");
                  return;
                }
                game.startCash(t, joinMode === "join");
                useGame.getState().setScreen("table");
              }}
            >
              Take a Seat
            </Button>
          }
        />
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
    <div className={SCREEN}>
      <ScreenHeader onBack={() => setScreen("menu")} right={<Stat label="Reserve" value={fmt(economy.reserve)} />} />
      <Panel className="flex-1 p-3 sm:p-4 flex flex-col gap-3 min-h-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2">
          {TOURNAMENTS.map((tn, i) => (
            <Choice key={tn.id} on={sel === i} onClick={() => setSel(i)} className="p-2 text-left">
              <div className="flex items-baseline gap-1.5">
                <span className="text-gold text-base leading-none">{tn.ornament}</span>
                <span className="font-serif text-[12px] sm:text-sm text-gold-text truncate">{tn.name}</span>
              </div>
              <div className="text-[10px] text-[#b6a077] font-serif mt-0.5">{fmt(tn.entry)}</div>
              <div className="text-[9px] text-dim">
                {tn.sb}/{tn.bb} &middot; {fmt(tn.startingStack)}
              </div>
            </Choice>
          ))}
        </div>
        <p className="text-[10px] sm:text-[11px] text-dim leading-relaxed">
          {t.blurb} Eight players at one table, no rebuys or refills, blinds fixed at {t.sb}/{t.bb}. Leaving early forfeits the
          entry fee.
        </p>
        <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-center">
          {(["First", "Second", "Third"] as const).map((place, i) => (
            <div key={place} className="rounded border border-edge bg-black/30 py-1.5">
              <Caption>{place}</Caption>
              <div className="font-serif text-gold-text text-sm">{fmt(pool * [0.7, 0.2, 0.1][i])}</div>
            </div>
          ))}
        </div>
        <LobbyFooter
          summary={
            <>
              Entry <b>{fmt(t.entry)}</b> &middot; Prize pool <b>{fmt(pool)}</b>
            </>
          }
          note={note}
          action={
            <Button
              size="lg"
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
            </Button>
          }
        />
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

const SPECS = [
  ["Chips", "white 1, red 5, green 25, black 100, purple 500 (scaled to the table), gold edge spots, readable denominations, 3.6 mm thick."],
  ["Cards", "63.5 × 88.9 mm, 52 unique faces, Norse knotwork backs, rounded corners, cream stock with red/black pips."],
  ["First-person camera", "seated eye height 1.25 m, subtle sway, leans in when the hole cards are lifted, never cuts away during a decision."],
  ["HUD", "restrained: small name and stack labels near each seat, pot and blinds in the upper corners, action buttons only when it is your turn."],
];

const VOLUMES: { key: "music" | "ambient" | "sfx"; label: string }[] = [
  { key: "music", label: "Music" },
  { key: "ambient", label: "Ambient" },
  { key: "sfx", label: "Sound effects" },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useGame((s) => s.settings);
  const setSetting = useGame((s) => s.setSetting);
  const [tests, setTests] = useState<TestResult[] | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<"settings" | "reference">("settings");

  return (
    <div className={SCREEN}>
      <ScreenHeader
        onBack={onClose}
        right={
          <Segmented
            className="w-[min(260px,48vw)]"
            value={tab}
            onChange={setTab}
            options={[
              { value: "settings", label: "Settings" },
              { value: "reference", label: "Art reference" },
            ]}
          />
        }
      />

      <Panel className="flex-1 p-3 sm:p-5 overflow-y-auto min-h-0">
        {tab === "settings" ? (
          <div className="grid sm:grid-cols-2 gap-5">
            <section className="space-y-3">
              <Caption>Audio</Caption>
              {VOLUMES.map((s) => (
                <label key={s.key} className="block">
                  <div className="flex justify-between text-[11px] text-wheat">
                    <span>{s.label}</span>
                    <span className="font-serif text-gold-text">{Math.round(settings[s.key] * 100)}</span>
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
                    className="w-full accent-gold"
                  />
                </label>
              ))}
              <button onClick={() => audio.start()} className="text-[10px] uppercase tracking-[0.2em] text-dim hover:text-gold-text">
                Resume audio
              </button>
            </section>

            <section className="space-y-3">
              <Caption>Graphics</Caption>
              <Segmented
                value={settings.quality}
                onChange={(q) => setSetting("quality", q)}
                options={(["low", "medium", "high"] as const).map((q) => ({ value: q, label: q }))}
              />
              <Caption>Deal &amp; action pace</Caption>
              <Segmented
                value={settings.speed}
                onChange={(sp) => {
                  setSetting("speed", sp);
                  game.userSpeed = sp;
                }}
                options={[1, 1.5, 2].map((sp) => ({ value: sp, label: `${sp}x` }))}
              />
              <Caption>Diagnostics</Caption>
              <Button
                tone="ghost"
                size="sm"
                disabled={running}
                onClick={async () => {
                  setRunning(true);
                  const r = await runSelfTests();
                  setTests(r);
                  setRunning(false);
                }}
              >
                {running ? "Running…" : "Run self-tests"}
              </Button>
              {tests && (
                <div className="text-[10px] font-mono leading-relaxed max-h-[26vh] overflow-y-auto">
                  {tests.map((t, i) => (
                    <div key={i} className={t.pass ? "text-[#8fbf8f]" : "text-[#d97b6a]"}>
                      {t.pass ? "PASS" : "FAIL"} — {t.name}
                      {!t.pass && t.detail ? ` (${t.detail})` : ""}
                    </div>
                  ))}
                  <div className="text-wheat mt-1">
                    {tests.filter((t) => t.pass).length}/{tests.length} passed
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="space-y-4">
            <Caption>Visual targets</Caption>
            <div className="grid sm:grid-cols-2 gap-3">
              {REFERENCE.map((r) => (
                <figure key={r.title} className="rounded border border-edge overflow-hidden bg-black/40">
                  <img src={r.img} alt={r.title} className="w-full h-[16vh] sm:h-[18vh] object-cover" />
                  <figcaption className="p-2">
                    <div className="font-serif text-[12px] text-gold-text">{r.title}</div>
                    <div className="text-[10px] text-dim leading-snug">{r.text}</div>
                  </figcaption>
                </figure>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-[10px] text-dim leading-snug">
              {SPECS.map(([k, v]) => (
                <div key={k}>
                  <span className="text-wheat">{k} —</span> {v}
                </div>
              ))}
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
