import { cn } from "@/lib/utils";

type Color = "orange" | "purple" | "mixed";
type Position = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
type Size = "sm" | "md" | "lg" | "xl";

interface GlowOrbProps {
  color: Color;
  position?: Position;
  size?: Size;
  className?: string;
}

const COLOR_MAP: Record<Color, string> = {
  orange: "bg-orange-300",
  purple: "bg-purple-300",
  mixed: "bg-gradient-to-br from-orange-300 to-purple-300",
};

const SIZE_MAP: Record<Size, string> = {
  sm: "w-32 h-32",
  md: "w-64 h-64",
  lg: "w-96 h-96",
  xl: "w-[32rem] h-[32rem]",
};

const POSITION_MAP: Record<Position, string> = {
  "top-left": "-top-32 -left-32",
  "top-right": "-top-32 -right-32",
  "bottom-left": "-bottom-32 -left-32",
  "bottom-right": "-bottom-32 -right-32",
  center: "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
};

// Soft glowing orb decoration cho corners — tạo depth visual.
// Pure CSS gradient + blur, không animation.
export function GlowOrb({
  color,
  position = "top-right",
  size = "md",
  className,
}: GlowOrbProps) {
  return (
    <div
      className={cn(
        "absolute rounded-full opacity-40 blur-3xl pointer-events-none",
        COLOR_MAP[color],
        SIZE_MAP[size],
        POSITION_MAP[position],
        className,
      )}
      aria-hidden="true"
    />
  );
}
