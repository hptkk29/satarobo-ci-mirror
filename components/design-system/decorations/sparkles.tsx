import { cn } from "@/lib/utils";

interface Props {
  className?: string;
  density?: number; // number of sparkles, default 12
}

// Random sparkles cam-tím — decorative.
// Vị trí pre-baked để SSR-stable (không random ở client).
const SPARKLES = [
  { cx: 12, cy: 18, r: 1.5, color: "#F97316", opacity: 0.6 },
  { cx: 85, cy: 24, r: 1, color: "#7C3AED", opacity: 0.5 },
  { cx: 35, cy: 35, r: 1.2, color: "#F97316", opacity: 0.4 },
  { cx: 68, cy: 50, r: 1.5, color: "#7C3AED", opacity: 0.5 },
  { cx: 22, cy: 65, r: 1, color: "#F97316", opacity: 0.5 },
  { cx: 92, cy: 72, r: 1.5, color: "#7C3AED", opacity: 0.4 },
  { cx: 48, cy: 80, r: 1, color: "#F97316", opacity: 0.6 },
  { cx: 75, cy: 88, r: 1.2, color: "#7C3AED", opacity: 0.5 },
  { cx: 18, cy: 92, r: 1, color: "#F97316", opacity: 0.4 },
  { cx: 60, cy: 12, r: 1.2, color: "#7C3AED", opacity: 0.5 },
  { cx: 5, cy: 50, r: 1, color: "#F97316", opacity: 0.4 },
  { cx: 95, cy: 45, r: 1.5, color: "#7C3AED", opacity: 0.6 },
];

export function Sparkles({ className, density = 12 }: Props) {
  const sparkles = SPARKLES.slice(0, density);

  return (
    <svg
      className={cn("pointer-events-none", className)}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      {sparkles.map((s, i) => (
        <circle
          key={i}
          cx={s.cx}
          cy={s.cy}
          r={s.r}
          fill={s.color}
          opacity={s.opacity}
        />
      ))}
    </svg>
  );
}
