/**
 * KRONA — application shell.
 */
import { useEffect, useState } from "react";
import { Scene } from "./game/Scene";
import { Hud } from "./ui/Hud";
import { CashSelect, MainMenu, SettingsPanel, TournamentSelect, Ornament, Title } from "./ui/Menus";
import { useGame } from "./game/store";
import { economy } from "./game/economy";
import { game } from "./game/controller";
import { audio } from "./audio/audio";
import menuBg from "./assets/menu-bg.jpg";

function useOrientation() {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setPortrait(h > w * 1.02 && w < 1024);
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);
  return portrait;
}

function RotatePrompt() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 px-8 text-center"
      style={{ background: "radial-gradient(ellipse at center,#1a1610 0%,#080a0d 75%)" }}
    >
      <Title small />
      <Ornament className="w-48 h-4 text-[#c9a341] opacity-70" />
      <div className="text-[#e8d5a8] text-sm tracking-[0.25em] uppercase">Rotate your device</div>
      <div className="text-[#9a8a6c] text-xs max-w-xs leading-relaxed">
        KRONA is played at a card table. Turn your phone sideways to sit down.
      </div>
      <svg width="64" height="64" viewBox="0 0 64 64" className="mt-2 opacity-80">
        <g fill="none" stroke="#c9a341" strokeWidth="2" strokeLinejoin="round">
          <rect x="8" y="20" width="30" height="24" rx="3" />
          <rect x="40" y="12" width="16" height="28" rx="3" transform="rotate(90 48 26)" />
          <path d="M26 14 h12" strokeDasharray="2 3" />
          <path d="M44 52 l6 0 0 -6" />
        </g>
      </svg>
    </div>
  );
}

function MenuBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      <img src={menuBg} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%,rgba(10,8,6,0.25) 0%,rgba(8,7,6,0.72) 55%,rgba(5,5,4,0.92) 100%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{ boxShadow: "inset 0 0 140px 40px rgba(0,0,0,0.85)", background: "linear-gradient(180deg,rgba(6,8,12,0.35),transparent 30%,rgba(4,5,7,0.55))" }}
      />
      <div className="absolute inset-0 krona-fade">{children}</div>
    </div>
  );
}

export default function App() {
  const screen = useGame((s) => s.screen);
  const setScreen = useGame((s) => s.setScreen);
  const snapshot = useGame((s) => s.snapshot);
  const portrait = useOrientation();
  const [exiting, setExiting] = useState(false);

  // start audio on the first gesture and keep the volumes in sync
  useEffect(() => {
    const kick = () => {
      audio.start();
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    return () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
    };
  }, []);

  // watch the bankroll for the automatic free refill
  useEffect(() => {
    let last = economy.refillCount;
    economy.onChange = () => {
      if (economy.refillCount > last) {
        last = economy.refillCount;
        useGame.getState().triggerRefillAnim();
        audio.potAward();
      }
    };
    return () => {
      economy.onChange = null;
    };
  }, []);

  // keep the store in sync with economy changes and close cleanly
  useEffect(() => {
    const flush = () => {
      // the browser is going away: the authoritative total is already persisted
      economy.maybeRefill();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && screen === "table") {
        game.setPaused(!game.paused);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("keydown", onKey);
    };
  }, [screen]);

  // foley tied to game events
  useEffect(() => {
    let lastHand = 0;
    let lastAction = "";
    let lastCards = 0;
    let lastBets = 0;
    const id = window.setInterval(() => {
      const v = game.view;
      if (game.handNo !== lastHand) {
        if (lastHand > 0) audio.shuffle();
        lastHand = game.handNo;
        lastCards = 0;
        lastBets = 0;
      }
      if (v.cards.length > lastCards) {
        const delta = v.cards.length - lastCards;
        if (delta === 3) audio.cardFlip();
        else audio.cardDeal();
        lastCards = v.cards.length;
      }
      const bets = game.engine ? game.engine.dealtIn().reduce((a, s) => a + s.bet, 0) : 0;
      if (bets > lastBets) {
        audio.chipPush();
        lastBets = bets;
      } else if (bets < lastBets) {
        lastBets = bets;
      }
      if (game.handResult && game.handResult !== lastAction) {
        lastAction = game.handResult;
        audio.potAward();
      }
    }, 90);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const s = useGame.getState().settings;
    game.userSpeed = s.speed;
    game.difficulty = 1;
  }, [screen]);

  const inTable = screen === "table";

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#0b1016" }}>
      {inTable && <div className="absolute inset-0">{snapshot?.mode !== "none" ? <Scene /> : null}</div>}
      {screen === "menu" && (
        <MenuBackdrop>
          <MainMenu
            onExit={() => {
              setExiting(true);
              setScreen("menu");
            }}
          />
        </MenuBackdrop>
      )}
      {screen === "cash-select" && (
        <MenuBackdrop>
          <CashSelect />
        </MenuBackdrop>
      )}
      {screen === "tournament-select" && (
        <MenuBackdrop>
          <TournamentSelect />
        </MenuBackdrop>
      )}
      {screen === "settings" && (
        <MenuBackdrop>
          <SettingsPanel onClose={() => setScreen(snapshot?.mode === "cash" || snapshot?.mode === "tournament" ? "table" : "menu")} />
        </MenuBackdrop>
      )}
      {inTable && <Hud />}
      {portrait && <RotatePrompt />}
      {exiting && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4" style={{ background: "rgba(4,4,3,0.94)" }}>
          <Title small />
          <Ornament className="w-52 h-4 text-[#c9a341] opacity-70" />
          <div className="text-[#e8d5a8] text-sm tracking-[0.25em] uppercase">The fire burns low</div>
          <div className="text-[#9a8a6c] text-xs max-w-sm text-center leading-relaxed">
            Your {Math.round(economy.ownedTotal).toLocaleString()} chips are safe and will be waiting when you return.
            You may close this tab now.
          </div>
          <button
            onClick={() => setExiting(false)}
            className="mt-2 px-6 py-3 rounded text-[11px] uppercase tracking-[0.24em]"
            style={{ border: "1px solid #8a6d33", color: "#e8d5a8", background: "rgba(20,16,10,0.9)" }}
          >
            Stay a while
          </button>
        </div>
      )}
    </div>
  );
}
