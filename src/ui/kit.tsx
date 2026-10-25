/**
 * KRONA — shared interface pieces: number format, title, panels, buttons,
 * segmented toggles and modal overlays. Colours come from the @theme tokens
 * in index.css.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { audio } from "../audio/audio";
import { cn } from "../utils/cn";

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
        className="font-serif text-transparent bg-clip-text"
        style={{
          backgroundImage: "linear-gradient(180deg,#fdf3cf 0%,#e8c979 38%,#b98f3c 62%,#7d5c1f 100%)",
          fontSize: small ? "clamp(20px,3.4vw,30px)" : "clamp(34px,min(9vw,12vh),86px)",
          textShadow: "0 2px 18px rgba(0,0,0,0.75)",
          letterSpacing: small ? "0.28em" : "0.34em",
          paddingLeft: "0.34em",
        }}
      >
        KRONA
      </div>
      {!small && (
        <>
          <Ornament className="w-[min(520px,72vw)] h-3 sm:h-4 text-gold opacity-80 mt-1" />
          <div className="text-[10px] sm:text-xs tracking-[0.5em] text-wheat mt-1 pl-[0.5em] uppercase">Viking Hold&rsquo;em</div>
        </>
      )}
    </div>
  );
}

/** small tracked-out uppercase label */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[9px] sm:text-[10px] tracking-[0.28em] uppercase text-dusk", className)}>{children}</div>;
}

/** label over a value, e.g. "Reserve 1,000,000" */
export function Stat({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn("text-right", className)}>
      <Caption>{label}</Caption>
      <div className="font-serif text-gold-text text-sm sm:text-base leading-tight">{value}</div>
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-panel rounded-lg border border-bronze/70", className)}>{children}</div>;
}

const TONES = {
  normal: "bg-wood border-bronze text-parchment",
  gold: "bg-brass border-gold text-cream",
  fold: "bg-ember border-ember text-ember-text",
  ghost: "bg-black/30 border-edge text-wheat hover:text-gold-text",
};

const SIZES = {
  sm: "px-2 py-1.5 text-[10px] tracking-[0.16em]",
  md: "px-3 py-2 min-h-[40px] text-[11px] sm:text-xs tracking-[0.18em]",
  lg: "px-6 py-3 text-[13px] sm:text-sm tracking-[0.28em]",
};

export function Button({
  tone = "normal",
  size = "md",
  sub,
  className,
  children,
  onPointerDown,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: keyof typeof TONES;
  size?: keyof typeof SIZES;
  sub?: ReactNode;
}) {
  return (
    <button
      {...rest}
      onPointerDown={(e) => {
        if (!rest.disabled) audio.click();
        onPointerDown?.(e);
      }}
      className={cn(
        "rounded border uppercase font-serif leading-none flex flex-col items-center justify-center gap-0.5",
        "transition-[transform,filter] hover:brightness-110 active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:brightness-100",
        TONES[tone],
        SIZES[size],
        className,
      )}
    >
      <span>{children}</span>
      {sub !== undefined && <span className="font-mono normal-case tracking-normal text-[9px] sm:text-[10px] opacity-80">{sub}</span>}
    </button>
  );
}

/** one-of-n toggle row */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1.5", className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex-1 px-2 py-1.5 rounded border text-[10px] sm:text-[11px] uppercase tracking-[0.18em] whitespace-nowrap transition-colors",
              on ? "border-gold bg-gold/15 text-cream" : "border-edge bg-black/30 text-dim hover:text-wheat",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** dimmed full-screen layer with a centred panel */
export function Overlay({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 bg-black/75">
      <Panel className={cn("w-full p-4 sm:p-5", className)}>{children}</Panel>
    </div>
  );
}

/** back link, small title and an optional right-hand slot */
export function ScreenHeader({ onBack, right }: { onBack: () => void; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-gold text-xs tracking-[0.2em] uppercase hover:text-gold-text">
          &larr; Back
        </button>
        <Title small />
      </div>
      {right}
    </div>
  );
}
