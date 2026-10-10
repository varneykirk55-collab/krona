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
import { fmt, Ornament, Title } from "./Menus";

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
  return (
    <div className="flex flex-col items-center" style={{ opacity: dim ? 0.45 : 1 }}>
      {dealer && (
        <div
          className="mb-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-serif"
          style={{ background: "#e9dfc8", color: "#1b2440", border: "1px solid #c9a341" }}
        >
          D
        </div>
      )}
      <div
        className="px-2 py-0.5 rounded text-[10px] sm:text-[11px] leading-tight whitespace-nowrap"
        style={{
          background: acting ? "rgba(201,163,65,0.28)" : "rgba(8,7,6,0.55)",
          border: `1px solid ${acting ? "#e8c979" : "rgba(140,120,80,0.45)"}`,
          color: "#efe0bb",
          textShadow: "0 1px 3px #000",
        }}
      >
        <span className="font-serif">{seat.name}</span>
        <span className="mx-1 text-[#c9a341]">·</span>
        <span className="font-mono text-[10px]">{fmt(seat.stack)}</span>
        {seat.bet > 0 && <span className="ml-1 text-[#f2c53d] font-mono">+{fmt(seat.bet)}</span>}
      </div>
      <div className="text-[8px] sm:text-[9px] tracking-[0.18em] uppercase mt-0.5" style={{ color: acting ? "#f2c53d" : "#9a8a6c" }}>
        {seat.sittingOut ? "sitting out" : seat.folded ? (street === "showdown" ? "" : "folded") : seat.lastAction ?? seat.style}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* top bar                                                            */
/* ------------------------------------------------------------------ */

function TopBar() {
  const snapshot = useGame((s) => s.snapshot);
  if (!snapshot) return null;
  return (
    <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-2 sm:p-3 pointer-events-none">
      <div className="flex flex-col gap-1 pointer-events-auto">
        <div
          className="px-2.5 py-1 rounded text-[10px] sm:text-[11px] tracking-[0.16em] uppercase"
          style={{ background: "rgba(8,7,6,0.55)", border: "1px solid rgba(140,120,80,0.4)", color: "#c6b28a" }}
        >
          {snapshot.mode === "tournament" ? snapshot.tournament?.name : "Cash"} · blinds{" "}
          <span className="font-mono text-[#f0d69a]">
            {snapshot.sb}/{snapshot.bb}
          </span>
        </div>
        {snapshot.mode === "tournament" && (
          <div
            className="px-2.5 py-1 rounded text-[10px] tracking-[0.16em] uppercase"
            style={{ background: "rgba(8,7,6,0.55)", border: "1px solid rgba(140,120,80,0.4)", color: "#c6b28a" }}
          >
            {snapshot.tournament?.remaining} of {snapshot.tournament?.entrants} remain
          </div>
        )}
      </div>

      <div className="flex flex-col items-center pointer-events-auto">
        <div className="text-[9px] sm:text-[10px] tracking-[0.35em] uppercase text-[#a6906a]">Pot</div>
        <div
          className="font-serif text-lg sm:text-2xl leading-none"
          style={{ color: "#f0d69a", textShadow: "0 2px 10px rgba(0,0,0,0.8)" }}
        >
          {fmt(snapshot.pot)}
        </div>
        {snapshot.handResult && (
          <div
            className="mt-1 px-2 py-0.5 rounded text-[10px] sm:text-[11px] text-center max-w-[46vw]"
            style={{ background: "rgba(8,7,6,0.6)", border: "1px solid rgba(201,163,65,0.5)", color: "#efe0bb" }}
          >
            {snapshot.handResult}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 pointer-events-auto">
        <div
          className="px-2.5 py-1 rounded text-[10px] sm:text-[11px] text-right"
          style={{ background: "rgba(8,7,6,0.55)", border: "1px solid rgba(140,120,80,0.4)" }}
        >
          <div className="text-[8px] tracking-[0.25em] uppercase text-[#a6906a]">Your stack</div>
          <div className="font-mono text-[#f0d69a]">{fmt(snapshot.seats[0]?.stack ?? 0)}</div>
        </div>
        <button
          onPointerDown={() => audio.click()}
          onClick={() => game.setPaused(true)}
          className="w-9 h-9 sm:w-10 sm:h-10 rounded flex items-center justify-center"
          style={{ background: "rgba(30,24,16,0.85)", border: "1px solid #8a6d33", color: "#e8d5a8" }}
          aria-label="Pause"
        >
          <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
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
  const [hint, setHint] = useState(true);
  if (!snapshot || snapshot.mode === "none") return null;
  const hasCards = (snapshot.hole?.length ?? 0) > 0;
  const folded = snapshot.seats[0]?.folded;
  if (!hasCards || folded) return null;
  const set = (v: number) => {
    if (v > 0 && game.view.peekTarget < 0.5) audio.cardFlip();
    game.view.peekTarget = v;
  };
  return (
    <>
      <div
        className="absolute left-1/2 bottom-[16vh] -translate-x-1/2 w-[42vw] max-w-[420px] h-[16vh] min-h-[70px] touch-none"
        style={{ touchAction: "none" }}
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
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-[8vh] text-[9px] sm:text-[10px] tracking-[0.3em] uppercase text-[#c6b28a] pointer-events-none animate-pulse"
          onClick={() => setHint(false)}
        >
          Hold your cards to look
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* action bar                                                         */
/* ------------------------------------------------------------------ */

function ActionButton({
  label,
  sub,
  onClick,
  tone = "normal",
  disabled,
  grow,
}: {
  label: string;
  sub?: string;
  onClick: () => void;
  tone?: "normal" | "fold" | "gold";
  disabled?: boolean;
  grow?: boolean;
}) {
  const palette =
    tone === "fold"
      ? { bg: "linear-gradient(180deg,#4a221e,#2a1411)", border: "#7d4a3c", color: "#e8c3b0" }
      : tone === "gold"
        ? { bg: "linear-gradient(180deg,#5c4517,#33260c)", border: "#c9a341", color: "#f6e6b6" }
        : { bg: "linear-gradient(180deg,rgba(48,40,26,0.95),rgba(22,19,12,0.95))", border: "#8a6d33", color: "#e8d5a8" };
  return (
    <button
      onPointerDown={() => !disabled && audio.click()}
      onClick={onClick}
      disabled={disabled}
      className={`relative rounded px-3 py-2 min-h-[46px] flex flex-col items-center justify-center ${grow ? "flex-1" : ""} active:scale-[0.98] transition-transform disabled:opacity-35 disabled:cursor-not-allowed`}
      style={{
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.color,
        boxShadow: "inset 0 1px 0 rgba(255,226,160,0.14), 0 4px 12px rgba(0,0,0,0.5)",
        minWidth: grow ? undefined : "72px",
      }}
    >
      <span className="text-[11px] sm:text-[13px] font-serif tracking-[0.18em] uppercase leading-none">{label}</span>
      {sub && <span className="text-[9px] sm:text-[10px] font-mono mt-0.5 opacity-80">{sub}</span>}
    </button>
  );
}

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
  const act = (kind: "fold" | "check" | "call" | "bet" | "raise" | "allin", to?: number) => {
    if (!game.humanAct({ kind, to })) audio.warn();
    setMode("idle");
  };

  return (
    <div className="absolute left-0 right-0 bottom-0 p-2 sm:p-3 flex flex-col gap-2 items-center pointer-events-none">
      {mode === "raise" && (
        <div
          className="pointer-events-auto w-full max-w-[620px] rounded-lg p-2 sm:p-3"
          style={{ background: "rgba(10,9,7,0.82)", border: "1px solid #8a6d33", backdropFilter: "blur(3px)" }}
        >
          <div className="flex items-center justify-between text-[10px] text-[#c6b28a] mb-1">
            <span className="tracking-[0.2em] uppercase">{isBet ? "Bet" : "Raise to"}</span>
            <span className="font-mono text-[#f0d69a] text-sm">{fmt(raiseTo)}</span>
          </div>
          <input
            type="range"
            min={legal.minRaiseTo}
            max={legal.maxRaiseTo}
            step={Math.max(1, Math.round(snapshot.bb / 2))}
            value={raiseTo}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            className="w-full accent-[#c9a341]"
            style={{ touchAction: "none" }}
          />
          <div className="flex gap-1.5 mt-2">
            {[
              { l: "Min", v: legal.minRaiseTo },
              { l: "½ Pot", v: Math.round(pot * 0.5) },
              { l: "Pot", v: Math.round(pot) },
              { l: "All-in", v: legal.maxRaiseTo },
            ].map((q) => (
              <button
                key={q.l}
                onClick={() => setRaiseTo(Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, q.v)))}
                className="flex-1 px-1 py-1.5 rounded text-[10px] uppercase tracking-[0.15em]"
                style={{ border: "1px solid #5e4c2a", color: "#c6b28a", background: "rgba(0,0,0,0.35)" }}
              >
                {q.l}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <ActionButton label="Cancel" onClick={() => setMode("idle")} grow />
            <ActionButton
              label={isBet ? "Bet" : "Raise"}
              sub={fmt(raiseTo)}
              tone="gold"
              grow
              onClick={() => act(isBet ? "bet" : "raise", raiseTo)}
            />
          </div>
        </div>
      )}

      {mode === "idle" && (
        <div className="pointer-events-auto w-full max-w-[680px] flex gap-1.5 sm:gap-2 items-stretch">
          <ActionButton label="Fold" tone="fold" onClick={() => act("fold")} disabled={!legal.canFold} />
          <ActionButton
            label={legal.canCheck ? "Check" : "Call"}
            sub={legal.canCheck ? undefined : fmt(legal.callAmount)}
            onClick={() => act(legal.canCheck ? "check" : "call")}
            disabled={legal.canCheck ? !legal.canCheck : !legal.canCall}
          />
          {legal.canBet || legal.canRaise ? (
            <ActionButton
              label={isBet ? "Bet" : "Raise"}
              sub={fmt(legal.minRaiseTo)}
              tone="gold"
              grow
              onClick={() => setMode("raise")}
            />
          ) : (
            <ActionButton label={isBet ? "Bet" : "Raise"} grow disabled onClick={() => audio.warn()} />
          )}
          <ActionButton
            label="All-in"
            sub={fmt(legal.maxRaiseTo)}
            onClick={() => act("allin", legal.maxRaiseTo)}
            disabled={!(legal.canBet || legal.canRaise)}
          />
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
    <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: "rgba(4,4,3,0.72)" }}>
      <div
        className="w-full max-w-[520px] rounded-lg p-4 sm:p-5"
        style={{ background: "linear-gradient(180deg,rgba(24,19,12,0.98),rgba(12,10,8,0.99))", border: "1px solid #8a6d33" }}
      >
        <div className="text-center">
          <Title small />
          <div className="text-[11px] tracking-[0.24em] uppercase text-[#c6b28a] mt-2">You are out of table chips</div>
        </div>
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-[#c6b28a] mb-1">
            <span>Rebuy amount</span>
            <span className="font-mono text-[#f0d69a] text-base">{fmt(amount)}</span>
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={Math.max(1, Math.round(min / 20))}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full accent-[#c9a341]"
          />
          <div className="flex justify-between text-[10px] text-[#9a8a6c] mt-1">
            <span>min {fmt(min)}</span>
            <span>reserve {fmt(economy.reserve)}</span>
            <span>max {fmt(max)}</span>
          </div>
        </div>
        <div className="text-[10px] text-[#9a8a6c] leading-snug mt-3">
          Chips are transferred from your reserve — nothing is created. Top-ups while you still hold chips at the table are
          not offered in KRONA.
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => {
              audio.click();
              game.declineRebuy();
              game.leaveTable();
              useGame.getState().setScreen("menu");
            }}
            className="flex-1 px-3 py-3 rounded text-[11px] uppercase tracking-[0.2em]"
            style={{ border: "1px solid #7d4a3c", color: "#e8c3b0", background: "linear-gradient(180deg,#4a221e,#2a1411)" }}
          >
            Leave table
          </button>
          <button
            onPointerDown={() => audio.click()}
            onClick={() => {
              if (!game.rebuy(amount)) audio.warn();
            }}
            className="flex-[2] px-3 py-3 rounded text-[11px] uppercase tracking-[0.2em] font-serif"
            style={{ border: "1px solid #c9a341", color: "#f6e6b6", background: "linear-gradient(180deg,#5c4517,#33260c)" }}
          >
            Rebuy {fmt(amount)}
          </button>
        </div>
      </div>
    </div>
  );
}

function PauseMenu() {
  const snapshot = useGame((s) => s.snapshot);
  const setScreen = useGame((s) => s.setScreen);
  if (!snapshot?.paused) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: "rgba(4,4,3,0.78)" }}>
      <div
        className="w-full max-w-[440px] rounded-lg p-4 sm:p-6 flex flex-col gap-3 items-center"
        style={{ background: "linear-gradient(180deg,rgba(24,19,12,0.98),rgba(12,10,8,0.99))", border: "1px solid #8a6d33" }}
      >
        <Title small />
        <Ornament className="w-40 h-3 text-[#c9a341] opacity-70" />
        <div className="text-[10px] tracking-[0.25em] uppercase text-[#9a8a6c] text-center">
          Paused — cards, chips and opponents are frozen
        </div>
        <button
          onPointerDown={() => audio.click()}
          onClick={() => game.setPaused(false)}
          className="w-full px-4 py-3 rounded text-[12px] uppercase tracking-[0.24em] font-serif"
          style={{ border: "1px solid #c9a341", color: "#f6e6b6", background: "linear-gradient(180deg,#5c4517,#33260c)" }}
        >
          Resume
        </button>
        <button
          onClick={() => setScreen("settings")}
          className="w-full px-4 py-3 rounded text-[11px] uppercase tracking-[0.24em]"
          style={{ border: "1px solid #8a6d33", color: "#e8d5a8", background: "rgba(20,16,10,0.9)" }}
        >
          Settings
        </button>
        <button
          onClick={() => {
            if (snapshot.mode === "cash") {
              game.leaveTable();
              setScreen("menu");
            } else {
              game.leaveTable();
              setScreen("menu");
            }
          }}
          className="w-full px-4 py-3 rounded text-[11px] uppercase tracking-[0.24em]"
          style={{ border: "1px solid #7d4a3c", color: "#e8c3b0", background: "linear-gradient(180deg,#4a221e,#2a1411)" }}
        >
          {snapshot.mode === "cash" ? "Cash out & leave" : "Forfeit tournament"}
        </button>
        <div className="text-[9px] text-[#8f8264] text-center leading-snug">
          Cash-game chips are returned to your bankroll. Tournament entry fees are forfeited if you leave early. Only your
          chip balance is ever saved.
        </div>
      </div>
    </div>
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
            left: `${-10 + (i * 4.4) % 120}%`,
            bottom: "-12%",
            background: i % 5 === 0 ? "#5b2c7a" : i % 3 === 0 ? "#a32b26" : i % 2 === 0 ? "#e8e4da" : "#1b1a1c",
            border: "1.5px solid #c9a341",
            animation: `krona-chip-roll 1.6s ${i * 0.055}s cubic-bezier(.2,.7,.3,1) forwards`,
          }}
        />
      ))}
      <div className="relative text-center mt-[22vh]">
        <div className="text-[10px] tracking-[0.4em] uppercase text-[#c6b28a]">Bankroll restored</div>
        <div className="font-serif text-2xl sm:text-4xl" style={{ color: "#f0d69a", textShadow: "0 2px 20px rgba(201,163,65,0.4)" }}>
          1,000,000
        </div>
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
    <div className="absolute inset-0 flex items-center justify-center p-4" style={{ background: "rgba(4,4,3,0.8)" }}>
      <div
        className="w-full max-w-[560px] rounded-lg p-4 sm:p-6"
        style={{ background: "linear-gradient(180deg,rgba(24,19,12,0.98),rgba(12,10,8,0.99))", border: "1px solid #c9a341" }}
      >
        <Title small />
        <div className="text-center text-[11px] tracking-[0.25em] uppercase text-[#c6b28a] mt-2">{t.name} — final standings</div>
        <div className="mt-3 max-h-[38vh] overflow-y-auto">
          {t.prizes.map((p, i) => (
            <div
              key={i}
              className="flex items-center justify-between px-2 py-1 rounded text-[11px]"
              style={{
                background: p.isHuman ? "rgba(201,163,65,0.16)" : "rgba(0,0,0,0.3)",
                border: `1px solid ${p.isHuman ? "#c9a341" : "rgba(94,76,42,0.6)"}`,
                color: p.isHuman ? "#f6e6b6" : "#c6b28a",
                marginBottom: 2,
              }}
            >
              <span className="font-serif w-8">{p.place}</span>
              <span className="flex-1 truncate">{p.name}</span>
              <span className="font-mono">{p.prize > 0 ? fmt(p.prize) : "—"}</span>
            </div>
          ))}
        </div>
        {mine && (
          <div className="text-center text-[12px] mt-3" style={{ color: "#f0d69a" }}>
            {mine.prize > 0 ? `You take ${fmt(mine.prize)} chips` : "No prize this time"}
          </div>
        )}
        <button
          onPointerDown={() => audio.click()}
          onClick={() => {
            game.leaveTable();
            setScreen("menu");
          }}
          className="w-full mt-4 px-4 py-3 rounded text-[12px] uppercase tracking-[0.24em] font-serif"
          style={{ border: "1px solid #c9a341", color: "#f6e6b6", background: "linear-gradient(180deg,#5c4517,#33260c)" }}
        >
          Return to the tavern
        </button>
      </div>
    </div>
  );
}

function StreetToast() {
  const snapshot = useGame((s) => s.snapshot);
  const [show, setShow] = useState(false);
  const street = snapshot?.street ?? "";
  useEffect(() => {
    setShow(true);
    const t = setTimeout(() => setShow(false), 1400);
    return () => clearTimeout(t);
  }, [street, snapshot?.handNo]);
  if (!show || !snapshot || snapshot.legal || snapshot.paused) return null;
  const labels: Record<string, string> = {
    preflop: "Pre-flop",
    flop: "The flop",
    turn: "The turn",
    river: "The river",
    showdown: "Showdown",
  };
  return (
    <div className="absolute left-1/2 top-[13vh] -translate-x-1/2 pointer-events-none">
      <div
        className="px-3 py-1 rounded text-[10px] sm:text-xs tracking-[0.3em] uppercase"
        style={{
          background: "rgba(8,7,6,0.5)",
          border: "1px solid rgba(201,163,65,0.4)",
          color: "#e8d5a8",
          opacity: 0.85,
        }}
      >
        {labels[street] ?? ""}
      </div>
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
    <div
      className="absolute left-1/2 top-[22vh] -translate-x-1/2 pointer-events-none font-serif text-[13px] sm:text-base tracking-[0.2em]"
      style={{ color: "#f0d69a", textShadow: "0 2px 8px #000" }}
    >
      {label}
    </div>
  );
}

export function Hud() {
  const snapshot = useGame((s) => s.snapshot);
  if (!snapshot || snapshot.mode === "none") return null;
  return (
    <div className="absolute inset-0 select-none" style={{ touchAction: "none" }}>
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
