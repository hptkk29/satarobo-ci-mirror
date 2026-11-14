import { cn } from "@/lib/utils";

type Color = "orange" | "purple" | "mixed";

interface AnimatedGridLinesProps {
  className?: string;
  color?: Color;
  opacity?: number;
}

// Animated grid lines — mạch điện signature Sata Robo.
// SVG SMIL animations for cross-browser smoothness; KHÔNG dùng framer (server-renderable).
export function AnimatedGridLines({
  className,
  color = "orange",
  opacity = 0.15,
}: AnimatedGridLinesProps) {
  const strokeColor =
    color === "mixed" ? "url(#agl-gradient)" : color === "purple" ? "#7C3AED" : "#F97316";
  const dotColor = color === "purple" ? "#7C3AED" : "#F97316";

  return (
    <svg
      className={cn("absolute inset-0 w-full h-full pointer-events-none", className)}
      viewBox="0 0 1200 600"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        {color === "mixed" && (
          <linearGradient id="agl-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#7C3AED" />
          </linearGradient>
        )}
        <pattern id="agl-pattern" width="60" height="60" patternUnits="userSpaceOnUse">
          <line
            x1="0"
            y1="30"
            x2="60"
            y2="30"
            stroke={strokeColor}
            strokeWidth="0.5"
            strokeOpacity={opacity}
          />
          <line
            x1="30"
            y1="0"
            x2="30"
            y2="60"
            stroke={strokeColor}
            strokeWidth="0.5"
            strokeOpacity={opacity}
          />
          <circle cx="30" cy="30" r="1.5" fill={strokeColor} opacity={opacity * 2} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#agl-pattern)" />

      {/* Traveling dots — 3 horizontal beams */}
      {[0, 1, 2].map((i) => (
        <circle key={i} r="3" fill={dotColor} opacity="0.6">
          <animateMotion
            dur={`${10 + i * 2}s`}
            repeatCount="indefinite"
            path={
              i === 0
                ? "M 0 90 L 1200 90"
                : i === 1
                  ? "M 1200 270 L 0 270"
                  : "M 0 450 L 1200 450"
            }
          />
        </circle>
      ))}
    </svg>
  );
}
