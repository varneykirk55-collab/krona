import { useId } from 'react';
export function Orb({ active = false, className = '' }: { active?: boolean; className?: string }) {
  const id = useId().replaceAll(':', '');
  return (
    <div className={`orb-wrap ${active ? 'active' : ''} ${className}`} aria-hidden="true">
      <div className="orb-aura" />
      <svg className="orb-svg" viewBox="0 0 300 300">
        <defs>
          <radialGradient id={id + 'body'} cx="32%" cy="25%" r="80%">
            <stop offset="0" stopColor="#fafdf3" />
            <stop offset=".3" stopColor="#dcf1c4" />
            <stop offset=".58" stopColor="#abcfa6" />
            <stop offset=".83" stopColor="#689781" />
            <stop offset="1" stopColor="#bed8b8" />
          </radialGradient>
          <radialGradient id={id + 'shine'} cx="25%" cy="20%" r="65%">
            <stop stopColor="#fff" stopOpacity=".75" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={id + 'wave'} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#fff" stopOpacity=".18" />
            <stop offset=".55" stopColor="#faffef" stopOpacity=".8" />
            <stop offset="1" stopColor="#365d53" stopOpacity=".1" />
          </linearGradient>
          <filter id={id + 'texture'}>
            <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="3" seed="8" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="linear" slope=".075" />
            </feComponentTransfer>
            <feBlend in="SourceGraphic" mode="soft-light" />
          </filter>
          <clipPath id={id + 'clip'}>
            <circle cx="150" cy="150" r="109" />
          </clipPath>
        </defs>
        <circle
          cx="150"
          cy="150"
          r="109"
          fill={'url(#' + id + 'body)'}
          filter={'url(#' + id + 'texture)'}
        />
        <g
          clipPath={'url(#' + id + 'clip)'}
          fill="none"
          stroke={'url(#' + id + 'wave)'}
          strokeWidth="1.4"
        >
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <path
              key={i}
              d={`M 0 ${118 + i * 13} C 65 ${220 + i * 3}, 125 ${55 + i * 18}, 305 ${130 + i * 16}`}
            />
          ))}
        </g>
        <circle cx="150" cy="150" r="109" fill={'url(#' + id + 'shine)'} />
        <circle cx="150" cy="150" r="109" fill="none" stroke="#fff" strokeOpacity=".45" />
        <ellipse cx="150" cy="264" rx="65" ry="5" fill="#618268" opacity=".07" />
      </svg>
      <span className="orb-satellite one" />
      <span className="orb-satellite two" />
    </div>
  );
}
