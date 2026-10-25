/**
 * KRONA — in-game interface: seat labels, betting controls, hole-card
 * inspection, rebuy slider, pause menu and tournament results.
 */
import { useEffect, useRef, useState } from "react";
import { useGame, UISeat } from "../game/store";
import { game } from "../game/controller";
import { economy } from "../game/economy";
import { audio } from "../audio/audio";
import { labelState } from "../three/TableProps";
import { cardLabel } from "../poker/types";
import { cn } from "../utils/cn";
import { Button, Caption, fmt, Ornament, Overlay, Title } from "./kit";

/* ------------------------------------------------------------------ */
/* seat labels                                                        */
/* ------------------------------------------------------------------ */

function SeatLabels() {
  const snapshot = useGame((s) => s.snapshot);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      for (let i = 0; i < 8; i++) {
        const el = refs.current[i];
        const l = labelState[i];
        if (!el) continue;
        if (!l.visible) {
          el.style.opacity = "0";
          continue;
        }
        el.style.opacity = "1";
        el.style.transform = `translate(-50%,-50%) translate(${l.x}px, ${l.y}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!snapshot) return null;
  return (
    <div className="absolute inset-0 pointer-events-none">
      {snapshot.seats.map((s, i) => (
        <div
          key={i}
          ref={(r) => {
            refs.current[i] = r;
          }}
          className="absolute top-0 left-0 transition-opacity duration-200"
          style={{ opacity: 0 }}
        >
          {s && <SeatChip seat={s} dealer={snapshot.dealer === i} acting={snapshot.actionSeat === i} street={snapshot.street} />}
        </div>
      ))}
    </div>
  );
}

function SeatChip({ seat, dealer, acting, street }: { seat: UISeat; dealer: boolean; acting: boolean; street: string }) {
  if (seat.isHuman) return null;
  const dim = seat.folded || seat.sittingOut;
  const status = seat.sittingOut ? "sitting out" : seat.folded ? (street === "showdown" ? "" : "folded") : (seat.lastAction ?? seat.style);
  return (
    <div className={cn("flex flex-col items-center [text-shadow:0_1px_3px_#000]", dim && "opacity-45")}>
      <div
        className={cn(
          "flex items-center gap-1 px-1.5 py-px rounded-full text-[10px] sm:text-[11px] leading-tight whitespace-nowrap border text-[#efe0bb]",
          acting ? "bg-gold/25 border-gold-hi" : "bg-glass border-bronze/40",
        )}
      >
        {dealer && (
          <span className="w-3.5 h-3.5 -ml-0.5 rounded-full grid place-items-center text-[8px] font-serif bg-[#e9dfc8] text-[#1b2440]">D</span>
        )}
        <span className="font-serif">{seat.name}</span>
        <span className="font-mono text-[10px] text-wheat">{fmt(seat.stack)}</span>
        {seat.bet > 0 && <span className="font-mono text-[10px] text-[#f2c53d]">+{fmt(seat.bet)}</span>}
      </div>
      {status && (
        <div className={cn("text-[8px] sm:text-[9px] tracking-[0.18em] uppercase mt-px", acting ? "text-[#f2c53d]" : "text-dim")}>{status}</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* top bar                                                            */
/* ------------------------------------------------------------------ */

const PILL = "bg-glass border border-bronze/40 rounded-full px-2.5 py-1 text-[10px] sm:text-[11px] whitespace-nowrap";

function TopBar() {
  const snapshot = useGame((s) => s.snapshot);
  if (!snapshot) return null;
  const tn = snapshot.mode === "tournament" ? snapshot.tournament : null;
  return (
    <div className="absolute top-0 inset-x-0 flex items-start justify-between gap-2 p-2 sm:p-3 pointer-events-none">
      <div className={cn(PILL, "tracking-[0.14em] uppercase text-wheat")}>
        {tn ? tn.name : "Cash"} <span className="text-gold/70">·</span> <span className="font-mono text-gold-text">{snapshot.sb}/{snapshot.bb}</span>
        {tn && (
          <>
            {" "}
            <span className="text-gold/70">·</span> {tn.remaining}/{tn.entrants} left
          </>
        )}
      </div>

      <div className="flex flex-col items-center min-w-0">
        <Caption className="tracking-[0.35em]">Pot</Caption>
        <div className="font-serif text-base sm:text-xl leading-none text-gold-text [text-shadow:0_2px_10px_rgba(0,0,0,0.8)]">
          {fmt(snapshot.pot)}
        </div>
        {snapshot.handResult && (
          <div className={cn(PILL, "mt-1 rounded-md whitespace-normal text-center max-w-[46vw] border-gold/50 text-[#efe0bb]")}>
            {snapshot.handResult}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 pointer-events-auto">
        <div className={cn(PILL, "font-mono text-gold-text")}>
          <span className="font-serif text-[9px] tracking-[0.2em] uppercase text-dusk mr-1.5">Stack</span>
          {fmt(snapshot.seats[0]?.stack ?? 0)}
        </div>
        <button
          onPointerDown={() => audio.click()}
          onClick={() => game.setPaused(true)}
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-full grid place-items-center bg-glass border border-bronze text-parchment hover:text-gold-text"
          aria-label="Pause"
        >
          <svg width="10" height="12" viewBox="0 0 14 16" fill="currentColor">
            <rect x="1" y="1" width="4" height="14" rx="1" />
            <rect x="9" y="1" width="4" height="14" rx="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* hole card inspection                                               */
/* ------------------------------------------------------------------ */

function HoleCardPeek() {
  const snapshot = useGame((s) => s.snapshot);
  // the hint goes away once the player has looked at their cards
  const [hint, setHint] = useState(true);
  if (!snapshot || snapshot.mode === "none") return null;
  const hasCards = (snapshot.hole?.length ?? 0) > 0;
  const folded = snapshot.seats[0]?.folded;
  if (!hasCards || folded) return null;
  const set = (v: number) => {
    if (v > 0 && game.view.peekTarget < 0.5) audio.cardFlip();
    if (v > 0) setHint(false);
    game.view.peekTarget = v;
  };
  return (
    <>
      <div
        className="absolute left-1/2 bottom-[16vh] -translate-x-1/2 w-[42vw] max-w-[420px] h-[16vh] min-h-[70px] touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          set(1);
        }}
        onPointerUp={() => set(0)}
        onPointerCancel={() => set(0)}
        onPointerLeave={() => set(0)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {hint && (
        <Caption className="absolute left-1/2 -translate-x-1/2 bottom-[9vh] text-wheat pointer-events-none animate-pulse">
          Hold your cards to look
        </Caption>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* action bar                                                         */
/* ------------------------------------------------------------------ */

function ActionBar() {
  const snapshot = useGame((s) => s.snapshot);
  const [raiseTo, setRaiseTo] = useState(0);
  const [mode, setMode] = useState<"idle" | "raise">("idle");
  const legal = snapshot?.legal ?? null;

  useEffect(() => {
    if (legal) {
      setRaiseTo(Math.min(legal.maxRaiseTo, legal.minRaiseTo));
      setMode("idle");
    }
  }, [legal?.seat, legal?.potTotal, legal?.minRaiseTo, legal?.maxRaiseTo, legal !== null]);

  if (!snapshot || !legal) return null;
  const pot = legal.potTotal;
  const isBet = !legal.isRaise;
  const canSize = legal.canBet || legal.canRaise;
  const act = (kind: "fold" | "check" | "call" | "bet" | "raise" | "allin", to?: number) => {
    if (!game.humanAct({ kind, to })) audio.warn();
    setMode("idle");
  };
  const clamp = (v: number) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, v));

  return (
    <div className="absolute inset-x-0 bottom-0 p-2 sm:p-3 flex justify-center pointer-events-none">
      {mode === "raise" ? (
        <div className="pointer-events-auto w-full max-w-[520px] rounded-lg p-2 sm:p-2.5 bg-glass border border-bronze/70">
          <div className="flex items-center gap-2">
            <Caption className="text-wheat shrink-0">{isBet ? "Bet" : "Raise to"}</Caption>
            <input
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={Math.max(1, Math.round(snapshot.bb / 2))}
              value={raiseTo}
              onChange={(e) => setRaiseTo(Number(e.target.value))}
              className="flex-1 min-w-0 accent-gold"
            />
            <span className="font-mono text-gold-text text-sm w-[9ch] text-right">{fmt(raiseTo)}</span>
          </div>
          <div className="flex gap-1.5 mt-1.5">
            {[
              { l: "Min", v: legal.minRaiseTo },
              { l: "½ Pot", v: Math.round(pot * 0.5) },
              { l: "Pot", v: Math.round(pot) },
              { l: "Max", v: legal.maxRaiseTo },
            ].map((q) => (
              <Button key={q.l} tone="ghost" size="sm" className="flex-1" onClick={() => setRaiseTo(clamp(q.v))}>
                {q.l}
              </Button>
            ))}
            <Button size="sm" className="flex-1" onClick={() => setMode("idle")}>
              Cancel
            </Button>
            <Button tone="gold" size="sm" className="flex-[2]" onClick={() => act(isBet ? "bet" : "raise", raiseTo)}>
              {isBet ? "Bet" : "Raise"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="pointer-events-auto w-full max-w-[560px] flex gap-1.5 sm:gap-2">
          <Button tone="fold" className="flex-1" onClick={() => act("fold")} disabled={!legal.canFold}>
            Fold
          </Button>
          <Button
            className="flex-1"
            sub={legal.canCheck ? undefined : fmt(legal.callAmount)}
            onClick={() => act(legal.canCheck ? "check" : "call")}
            disabled={!legal.canCheck && !legal.canCall}
          >
            {legal.canCheck ? "Check" : "Call"}
          </Button>
          <Button
            tone="gold"
            className="flex-[1.4]"
            sub={canSize ? fmt(legal.minRaiseTo) : undefined}
            disabled={!canSize}
            onClick={() => setMode("raise")}
          >
            {isBet ? "Bet" : "Raise"}
          </Button>
          <Button className="flex-1" sub={fmt(legal.maxRaiseTo)} onClick={() => act("allin", legal.maxRaiseTo)} disabled={!canSize}>
            All-in
          </Button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* rebuy, pause, refill, tournament                                   */
/* ------------------------------------------------------------------ */

function RebuyModal() {
  const snapshot = useGame((s) => s.snapshot);
  const [amount, setAmount] = useState(0);
  const min = snapshot?.rebuyMin ?? 0;
  const max = snapshot?.rebuyMax ?? 0;
  useEffect(() => {
    if (max > 0) setAmount(max);
  }, [max, min]);
  if (!snapshot?.rebuyOpen || max <= 0) return null;
  return (
    <Overlay className="max-w-[440px]">
      <div className="flex flex-col items-center gap-1">
        <Title small />
        <Caption className="text-wheat">You are out of table chips</Caption>
      </div>
      <div className="mt-4">
        <div className="flex justify-between items-baseline text-[11px] text-wheat mb-1">
          <span>Rebuy amount</span>
          <span className="font-mono text-gold-text text-base">{fmt(amount)}</span>
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={Math.max(1, Math.round(min / 20))}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value))}
          className="w-full accent-gold"
        />
        <div className="flex justify-between text-[10px] text-dim mt-1">
          <span>min {fmt(min)}</span>
          <span>reserve {fmt(economy.reserve)}</span>
          <span>max {fmt(max)}</span>
        </div>
      </div>
      <p className="text-[10px] text-dim leading-snug mt-3">
        Chips move from your reserve; nothing is created. Top-ups while you still hold table chips are not offered.
      </p>
      <div className="flex gap-2 mt-4">
        <Button
          tone="fold"
          className="flex-1"
          onClick={() => {
            game.declineRebuy();
            game.leaveTable();
            useGame.getState().setScreen("menu");
          }}
        >
          Leave table
        </Button>
        <Button
          tone="gold"
          className="flex-[2]"
          onClick={() => {
            if (!game.rebuy(amount)) audio.warn();
          }}
        >
          Rebuy {fmt(amount)}
        </Button>
      </div>
    </Overlay>
  );
}

function PauseMenu() {
  const snapshot = useGame((s) => s.snapshot);
  const setScreen = useGame((s) => s.setScreen);
  if (!snapshot?.paused) return null;
  const cash = snapshot.mode === "cash";
  return (
    <Overlay className="max-w-[360px] flex flex-col items-center gap-2.5">
      <Title small />
      <Ornament className="w-32 h-3 text-gold opacity-70" />
      <Caption className="text-center">Paused: cards, chips and opponents are frozen</Caption>
      <Button tone="gold" className="w-full mt-1" onClick={() => game.setPaused(false)}>
        Resume
      </Button>
      <Button className="w-full" onClick={() => setScreen("settings")}>
        Settings
      </Button>
      <Button
        tone="fold"
        className="w-full"
        onClick={() => {
          game.leaveTable();
          setScreen("menu");
        }}
      >
        {cash ? "Cash out & leave" : "Forfeit tournament"}
      </Button>
      <p className="text-[9px] text-dim/90 text-center leading-snug">
        {cash
          ? "Your table chips go back to your bankroll."
          : "Leaving before the tournament ends forfeits the entry fee."}{" "}
        Only your chip balance is ever saved.
      </p>
    </Overlay>
  );
}

function RefillBanner() {
  const refill = useGame((s) => s.refillAnim);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!refill) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3200);
    return () => clearTimeout(t);
  }, [refill]);
  if (!visible) return null;
  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at center,rgba(201,163,65,0.16),transparent 65%)" }} />
      {Array.from({ length: 26 }).map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: 26 + (i % 4) * 7,
            height: 7 + (i % 3) * 2,
            left: `${-10 + ((i * 4.4) % 120)}%`,
            bottom: "-12%",
            background: i % 5 === 0 ? "#5b2c7a" : i % 3 === 0 ? "#a32b26" : i % 2 === 0 ? "#e8e4da" : "#1b1a1c",
            border: "1.5px solid #c9a341",
            animation: `krona-chip-roll 1.6s ${i * 0.055}s cubic-bezier(.2,.7,.3,1) forwards`,
          }}
        />
      ))}
      <div className="relative text-center mt-[22vh]">
        <Caption className="tracking-[0.4em] text-wheat">Bankroll restored</Caption>
        <div className="font-serif text-2xl sm:text-4xl text-gold-text [text-shadow:0_2px_20px_rgba(201,163,65,0.4)]">1,000,000</div>
      </div>
    </div>
  );
}

function TournamentPanel() {
  const snapshot = useGame((s) => s.snapshot);
  const setScreen = useGame((s) => s.setScreen);
  const t = snapshot?.tournament;
  if (!t || !t.finished) return null;
  const mine = t.prizes.find((p) => p.isHuman);
  return (
    <Overlay className="max-w-[480px] border-gold">
      <div className="flex flex-col items-center gap-1">
        <Title small />
        <Caption className="text-wheat">{t.name}: final standings</Caption>
      </div>
      <div className="mt-3 max-h-[38vh] overflow-y-auto flex flex-col gap-0.5">
        {t.prizes.map((p, i) => (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 px-2 py-1 rounded text-[11px] border",
              p.isHuman ? "bg-gold/15 border-gold text-cream" : "bg-black/30 border-edge/60 text-wheat",
            )}
          >
            <span className="font-serif w-6">{p.place}</span>
            <span className="flex-1 truncate">{p.name}</span>
            <span className="font-mono">{p.prize > 0 ? fmt(p.prize) : "—"}</span>
          </div>
        ))}
      </div>
      {mine && (
        <div className="text-center text-[12px] mt-3 text-gold-text">{mine.prize > 0 ? `You take ${fmt(mine.prize)} chips` : "No prize this time"}</div>
      )}
      <Button
        tone="gold"
        className="w-full mt-4"
        onClick={() => {
          game.leaveTable();
          setScreen("menu");
        }}
      >
        Return to the tavern
      </Button>
    </Overlay>
  );
}

const STREET_LABELS: Record<string, string> = {
  preflop: "Pre-flop",
  flop: "The flop",
  turn: "The turn",
  river: "The river",
  showdown: "Showdown",
};

function StreetToast() {
  const snapshot = useGame((s) => s.snapshot);
  const [show, setShow] = useState(false);
  const street = snapshot?.street ?? "";
  useEffect(() => {
    setShow(true);
    const t = setTimeout(() => setShow(false), 1400);
    return () => clearTimeout(t);
  }, [street, snapshot?.handNo]);
  if (!show || !snapshot || snapshot.legal || snapshot.paused || !STREET_LABELS[street]) return null;
  return (
    <div className="absolute left-1/2 top-[13vh] -translate-x-1/2 pointer-events-none">
      <div className={cn(PILL, "tracking-[0.3em] uppercase text-parchment border-gold/40")}>{STREET_LABELS[street]}</div>
    </div>
  );
}

function HoleCardsReadout() {
  const snapshot = useGame((s) => s.snapshot);
  const peek = useRef(0);
  const [label, setLabel] = useState("");
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const p = game.view.peek;
      if (p > 0.6 && peek.current <= 0.6) {
        const h = snapshot?.hole ?? [];
        setLabel(h.map(cardLabel).join("  "));
      }
      peek.current = p;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [snapshot?.hole]);
  if (!label) return null;
  return (
    <div className="absolute left-1/2 top-[22vh] -translate-x-1/2 pointer-events-none font-serif text-[13px] sm:text-base tracking-[0.2em] text-gold-text [text-shadow:0_2px_8px_#000]">
      {label}
    </div>
  );
}

export function Hud() {
  const snapshot = useGame((s) => s.snapshot);
  if (!snapshot || snapshot.mode === "none") return null;
  return (
    <div className="absolute inset-0 select-none touch-none">
      <SeatLabels />
      <TopBar />
      <StreetToast />
      <HoleCardsReadout />
      <HoleCardPeek />
      <ActionBar />
      <RebuyModal />
      <PauseMenu />
      <TournamentPanel />
      <RefillBanner />
    </div>
  );
}
