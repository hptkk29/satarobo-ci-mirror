import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

// Subtle dot grid background — Notion/Linear style.
export function DotGrid({ className }: Props) {
  return (
    <svg
      className={cn("pointer-events-none", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="dot-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dot-grid)" />
    </svg>
  );
}
