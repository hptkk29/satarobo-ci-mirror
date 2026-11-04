import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

// Empty state illustration cho admin list views.
// Friendly robot looking puzzled at empty box.
export function EmptyStateIllustration({ className }: Props) {
  return (
    <svg
      className={cn("w-full h-auto", className)}
      viewBox="0 0 400 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Trạng thái rỗng — chưa có dữ liệu"
    >
      {/* Floor shadow */}
      <ellipse cx="200" cy="240" rx="140" ry="8" fill="#262626" opacity="0.05" />

      {/* Empty box */}
      <g transform="translate(220 130)">
        <path d="M 0 30 L 70 0 L 140 30 L 140 100 L 70 130 L 0 100 Z" fill="#E5E5E5" />
        <path d="M 0 30 L 70 60 L 140 30" stroke="#737373" strokeWidth="2" fill="none" />
        <line x1="70" y1="60" x2="70" y2="130" stroke="#737373" strokeWidth="2" />
        <text x="48" y="100" fill="#A78BFA" fontSize="32" fontWeight="700" opacity="0.5">?</text>
      </g>

      {/* Robot looking at the box */}
      <g transform="translate(80 130)">
        {/* Body */}
        <rect x="0" y="20" width="70" height="80" rx="12" fill="#7C3AED" />
        {/* Screen */}
        <rect x="10" y="32" width="50" height="32" rx="4" fill="#FAFAFA" />
        {/* Sad/puzzled eyes */}
        <circle cx="22" cy="48" r="4" fill="#7C3AED" />
        <circle cx="48" cy="48" r="4" fill="#7C3AED" />
        {/* Mouth (small line — puzzled) */}
        <line x1="28" y1="58" x2="42" y2="58" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" />
        {/* Antenna with question mark */}
        <line x1="35" y1="20" x2="35" y2="5" stroke="#F97316" strokeWidth="2" strokeLinecap="round" />
        <circle cx="35" cy="2" r="4" fill="#F97316" />
        <text x="62" y="0" fill="#F97316" fontSize="16" fontWeight="700">?</text>
        {/* Arms */}
        <rect x="-10" y="40" width="12" height="28" rx="6" fill="#7C3AED" />
        <rect x="68" y="40" width="12" height="28" rx="6" fill="#7C3AED" transform="rotate(15 68 40)" />
        {/* Wheels */}
        <circle cx="20" cy="105" r="8" fill="#262626" />
        <circle cx="50" cy="105" r="8" fill="#262626" />
        <circle cx="20" cy="105" r="3" fill="#FAFAFA" />
        <circle cx="50" cy="105" r="3" fill="#FAFAFA" />
      </g>

      {/* Floating dots */}
      <circle cx="180" cy="100" r="2" fill="#F97316" opacity="0.5" />
      <circle cx="200" cy="80" r="3" fill="#7C3AED" opacity="0.4" />
      <circle cx="190" cy="120" r="2" fill="#F97316" opacity="0.4" />
    </svg>
  );
}
