import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

// STEM tools (lego, robot kit, tablet) — SP4 SATAGO or features section.
export function HeroStemTools({ className }: Props) {
  return (
    <svg
      className={cn("w-full h-auto", className)}
      viewBox="0 0 500 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Bộ công cụ STEM: robot, lego, máy tính bảng"
    >
      <defs>
        <linearGradient id="stem-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFEDD5" />
          <stop offset="100%" stopColor="#F3E8FF" />
        </linearGradient>
      </defs>

      {/* Background blob */}
      <ellipse cx="250" cy="220" rx="240" ry="170" fill="url(#stem-bg)" opacity="0.5" />

      {/* Floor surface */}
      <ellipse cx="250" cy="340" rx="200" ry="12" fill="#262626" opacity="0.05" />

      {/* Tablet (left) */}
      <g transform="translate(60 180)">
        <rect x="0" y="0" width="120" height="160" rx="12" fill="#262626" />
        <rect x="6" y="20" width="108" height="120" rx="4" fill="white" />
        <rect x="14" y="28" width="40" height="6" rx="2" fill="#F97316" />
        <rect x="14" y="42" width="80" height="4" rx="2" fill="#737373" opacity="0.5" />
        <rect x="14" y="52" width="70" height="4" rx="2" fill="#737373" opacity="0.5" />
        <rect x="14" y="62" width="60" height="4" rx="2" fill="#737373" opacity="0.5" />
        <rect x="14" y="80" width="92" height="50" rx="4" fill="#FFEDD5" />
        <text x="40" y="112" fill="#F97316" fontSize="20" fontWeight="700">{"</>"}</text>
        <circle cx="60" cy="150" r="3" fill="#262626" opacity="0.3" />
      </g>

      {/* Robot kit (center) */}
      <g transform="translate(210 160)">
        {/* Main body */}
        <rect x="20" y="40" width="90" height="100" rx="12" fill="#7C3AED" />
        {/* Screen */}
        <rect x="32" y="55" width="66" height="40" rx="4" fill="#FAFAFA" />
        <circle cx="50" cy="73" r="6" fill="#7C3AED" />
        <circle cx="80" cy="73" r="6" fill="#7C3AED" />
        <circle cx="50" cy="73" r="2.5" fill="white" />
        <circle cx="80" cy="73" r="2.5" fill="white" />
        {/* Antenna */}
        <line x1="65" y1="40" x2="65" y2="20" stroke="#F97316" strokeWidth="3" strokeLinecap="round" />
        <circle cx="65" cy="18" r="5" fill="#F97316" />
        {/* Tracks/wheels */}
        <rect x="15" y="135" width="100" height="20" rx="10" fill="#262626" />
        <circle cx="35" cy="145" r="6" fill="#FAFAFA" />
        <circle cx="65" cy="145" r="6" fill="#FAFAFA" />
        <circle cx="95" cy="145" r="6" fill="#FAFAFA" />
        {/* Sensor cables */}
        <path d="M 20 100 Q 0 100 0 70" stroke="#F97316" strokeWidth="2" fill="none" />
        <path d="M 110 100 Q 130 100 130 70" stroke="#F97316" strokeWidth="2" fill="none" />
      </g>

      {/* Lego blocks (right) */}
      <g transform="translate(360 220)">
        {/* Orange block */}
        <rect x="0" y="60" width="60" height="40" rx="3" fill="#F97316" />
        <circle cx="12" cy="60" r="6" fill="#F97316" />
        <circle cx="30" cy="60" r="6" fill="#F97316" />
        <circle cx="48" cy="60" r="6" fill="#F97316" />
        <line x1="6" y1="60" x2="6" y2="54" stroke="#C2410C" strokeWidth="2" />
        <line x1="18" y1="60" x2="18" y2="54" stroke="#C2410C" strokeWidth="2" />
        <line x1="24" y1="60" x2="24" y2="54" stroke="#C2410C" strokeWidth="2" />
        <line x1="36" y1="60" x2="36" y2="54" stroke="#C2410C" strokeWidth="2" />
        <line x1="42" y1="60" x2="42" y2="54" stroke="#C2410C" strokeWidth="2" />
        <line x1="54" y1="60" x2="54" y2="54" stroke="#C2410C" strokeWidth="2" />

        {/* Purple block on top */}
        <rect x="10" y="20" width="40" height="30" rx="3" fill="#7C3AED" />
        <circle cx="20" cy="20" r="4" fill="#7C3AED" />
        <circle cx="32" cy="20" r="4" fill="#7C3AED" />
        <circle cx="44" cy="20" r="4" fill="#7C3AED" />
      </g>

      {/* Floating code */}
      <text x="180" y="100" fill="#F97316" fontSize="14" fontWeight="600" opacity="0.5">{"function()"}</text>
      <text x="330" y="120" fill="#7C3AED" fontSize="14" fontWeight="600" opacity="0.5">{"if (..) { }"}</text>
    </svg>
  );
}
