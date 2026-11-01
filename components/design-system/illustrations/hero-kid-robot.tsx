import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

// Kid + Robot interacting — use ở SP1 (RoboSim) hero.
export function HeroKidRobot({ className }: Props) {
  return (
    <svg
      className={cn("w-full h-auto", className)}
      viewBox="0 0 500 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Học sinh tương tác với robot"
    >
      <defs>
        <linearGradient id="kidrobot-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFEDD5" />
          <stop offset="100%" stopColor="#F3E8FF" />
        </linearGradient>
        <linearGradient id="kidrobot-beam" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#F97316" />
          <stop offset="100%" stopColor="#7C3AED" />
        </linearGradient>
      </defs>

      {/* Background blob */}
      <ellipse cx="250" cy="220" rx="220" ry="170" fill="url(#kidrobot-bg)" opacity="0.6" />

      {/* Floor shadow */}
      <ellipse cx="250" cy="340" rx="180" ry="10" fill="#262626" opacity="0.05" />

      {/* Kid silhouette — sitting */}
      <g transform="translate(140 180)">
        {/* Body */}
        <rect x="10" y="60" width="60" height="80" rx="14" fill="#F97316" />
        {/* Head */}
        <circle cx="40" cy="40" r="32" fill="#FDBA74" />
        {/* Hair (top) */}
        <path d="M 12 35 Q 40 0 68 35 L 65 28 Q 40 12 15 28 Z" fill="#262626" />
        {/* Eyes */}
        <circle cx="32" cy="42" r="2.5" fill="#262626" />
        <circle cx="48" cy="42" r="2.5" fill="#262626" />
        {/* Smile */}
        <path d="M 30 52 Q 40 58 50 52" stroke="#262626" strokeWidth="2" strokeLinecap="round" fill="none" />
        {/* Arm (pointing to robot) */}
        <rect x="65" y="80" width="40" height="14" rx="7" fill="#F97316" transform="rotate(-10 65 80)" />
      </g>

      {/* Robot */}
      <g transform="translate(290 150)">
        {/* Antenna */}
        <line x1="55" y1="10" x2="55" y2="-10" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" />
        <circle cx="55" cy="-12" r="4" fill="#F97316" />
        {/* Head/body */}
        <rect x="15" y="10" width="80" height="100" rx="14" fill="#7C3AED" />
        {/* Screen face */}
        <rect x="25" y="25" width="60" height="40" rx="6" fill="#FAFAFA" />
        {/* Eyes */}
        <circle cx="40" cy="45" r="6" fill="#7C3AED" />
        <circle cx="70" cy="45" r="6" fill="#7C3AED" />
        <circle cx="40" cy="45" r="2.5" fill="white" />
        <circle cx="70" cy="45" r="2.5" fill="white" />
        {/* Mouth (smile) */}
        <path d="M 45 78 Q 55 85 65 78" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        {/* Arms */}
        <rect x="0" y="40" width="14" height="30" rx="6" fill="#7C3AED" />
        <rect x="96" y="40" width="14" height="30" rx="6" fill="#7C3AED" />
        {/* Wheels */}
        <circle cx="35" cy="115" r="10" fill="#262626" />
        <circle cx="75" cy="115" r="10" fill="#262626" />
        <circle cx="35" cy="115" r="4" fill="#FAFAFA" />
        <circle cx="75" cy="115" r="4" fill="#FAFAFA" />
      </g>

      {/* Connection beam — dashed animated */}
      <line
        x1="240"
        y1="220"
        x2="300"
        y2="200"
        stroke="url(#kidrobot-beam)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="6 6"
      >
        <animate attributeName="stroke-dashoffset" from="0" to="-24" dur="2s" repeatCount="indefinite" />
      </line>

      {/* Floating code symbols */}
      <text x="380" y="100" fill="#F97316" fontSize="18" fontWeight="600" opacity="0.6">{"</>"}</text>
      <text x="100" y="120" fill="#7C3AED" fontSize="14" fontWeight="600" opacity="0.5">{"{ }"}</text>
      <text x="420" y="280" fill="#F97316" fontSize="16" fontWeight="600" opacity="0.5">{"<>"}</text>
    </svg>
  );
}
