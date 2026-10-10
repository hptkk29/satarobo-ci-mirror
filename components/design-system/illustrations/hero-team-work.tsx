import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

// Team collaborating around a table — SP3 Sata Inno School / about us.
export function HeroTeamWork({ className }: Props) {
  return (
    <svg
      className={cn("w-full h-auto", className)}
      viewBox="0 0 500 400"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Đội ngũ làm việc cùng nhau"
    >
      <defs>
        <radialGradient id="team-bg" cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor="#FFEDD5" />
          <stop offset="100%" stopColor="#F3E8FF" />
        </radialGradient>
      </defs>

      {/* Background */}
      <ellipse cx="250" cy="220" rx="240" ry="170" fill="url(#team-bg)" opacity="0.5" />

      {/* Round table */}
      <ellipse cx="250" cy="260" rx="160" ry="40" fill="#E5E5E5" />
      <ellipse cx="250" cy="255" rx="160" ry="40" fill="white" stroke="#A78BFA" strokeWidth="2" opacity="0.6" />

      {/* Laptop on table */}
      <rect x="220" y="225" width="60" height="30" rx="2" fill="#262626" />
      <rect x="225" y="230" width="50" height="20" rx="1" fill="#F97316" opacity="0.8" />
      <rect x="218" y="253" width="64" height="4" rx="1" fill="#737373" />

      {/* Person 1 (left, orange shirt) */}
      <g transform="translate(80 150)">
        <circle cx="30" cy="30" r="25" fill="#FDBA74" />
        <path d="M 8 28 Q 30 -2 52 28 L 50 22 Q 30 8 10 22 Z" fill="#262626" />
        <rect x="10" y="55" width="40" height="60" rx="10" fill="#F97316" />
        <ellipse cx="0" cy="80" rx="8" ry="14" fill="#F97316" transform="rotate(20 0 80)" />
        <circle cx="22" cy="32" r="2" fill="#262626" />
        <circle cx="38" cy="32" r="2" fill="#262626" />
        <path d="M 24 42 Q 30 46 36 42" stroke="#262626" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>

      {/* Person 2 (center, purple shirt) */}
      <g transform="translate(220 130)">
        <circle cx="30" cy="30" r="25" fill="#FDBA74" />
        <path d="M 8 28 Q 30 -2 52 28 L 50 22 Q 30 8 10 22 Z" fill="#171717" />
        <rect x="10" y="55" width="40" height="60" rx="10" fill="#7C3AED" />
        <circle cx="22" cy="32" r="2" fill="#262626" />
        <circle cx="38" cy="32" r="2" fill="#262626" />
        <path d="M 24 42 Q 30 46 36 42" stroke="#262626" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>

      {/* Person 3 (right, purple-soft shirt) */}
      <g transform="translate(360 150)">
        <circle cx="30" cy="30" r="25" fill="#FDBA74" />
        <path d="M 8 28 Q 30 -2 52 28 L 50 22 Q 30 8 10 22 Z" fill="#262626" />
        <rect x="10" y="55" width="40" height="60" rx="10" fill="#A78BFA" />
        <ellipse cx="60" cy="80" rx="8" ry="14" fill="#A78BFA" transform="rotate(-20 60 80)" />
        <circle cx="22" cy="32" r="2" fill="#262626" />
        <circle cx="38" cy="32" r="2" fill="#262626" />
        <path d="M 24 42 Q 30 46 36 42" stroke="#262626" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      </g>

      {/* Ideas bubbles */}
      <circle cx="150" cy="80" r="8" fill="#F97316" opacity="0.3" />
      <circle cx="170" cy="60" r="5" fill="#F97316" opacity="0.5" />
      <text x="155" y="68" fill="#F97316" fontSize="14">💡</text>

      <circle cx="380" cy="80" r="8" fill="#7C3AED" opacity="0.3" />
      <circle cx="400" cy="60" r="5" fill="#7C3AED" opacity="0.5" />
      <text x="385" y="68" fill="#7C3AED" fontSize="14">🚀</text>
    </svg>
  );
}
