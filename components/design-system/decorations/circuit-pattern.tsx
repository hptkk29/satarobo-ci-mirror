import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

// Mạch điện neon — signature Sata Robo decoration.
// Use as absolute decoration trong heroes/sections (set color qua text-* class).
export function CircuitPattern({ className }: Props) {
  return (
    <svg
      className={cn("pointer-events-none", className)}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="circuit-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
          <line x1="0" y1="20" x2="40" y2="20" stroke="currentColor" strokeWidth="1" />
          <line x1="20" y1="0" x2="20" y2="40" stroke="currentColor" strokeWidth="1" />
          <circle cx="20" cy="20" r="2" fill="currentColor" />
          <circle cx="0" cy="20" r="1.5" fill="currentColor" />
          <circle cx="40" cy="20" r="1.5" fill="currentColor" />
          <circle cx="20" cy="0" r="1.5" fill="currentColor" />
          <circle cx="20" cy="40" r="1.5" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#circuit-grid)" />
    </svg>
  );
}
