import type { ReactNode } from "react";
import { GlowOrb } from "@/components/design-system/effects/glow-orb";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

type Theme = "white" | "neutral" | "soft-warm" | "soft-cool" | "aurora";

interface GlowOrbConfig {
  color: "orange" | "purple";
  position: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  size?: "sm" | "md" | "lg" | "xl";
}

interface SectionBaseProps {
  children: ReactNode;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  /** Strategic color theme. Default "white" (= v1 behavior). Phase 4.UI.1.1. */
  theme?: Theme;
  /** Decorative glow orb at a corner. Phase 4.UI.1.1. */
  glowOrb?: GlowOrbConfig;
  className?: string;
  containerClassName?: string;
  variant?: "default" | "narrow";
}

const BG_MAP: Record<Theme, string> = {
  white: "bg-white",
  neutral: "bg-neutral-50",
  "soft-warm": tokens.vibrantBg.softWarm,
  "soft-cool": tokens.vibrantBg.softCool,
  aurora: tokens.vibrantBg.aurora,
};

// Section wrapper với strategic color theme + optional glow orb decoration.
// Default theme="white" giữ behavior v1 (backward compat).
export function SectionBase({
  children,
  eyebrow,
  title,
  subtitle,
  theme = "white",
  glowOrb,
  className,
  containerClassName,
  variant = "default",
}: SectionBaseProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden",
        BG_MAP[theme],
        tokens.spacing.section,
        className,
      )}
    >
      {glowOrb && (
        <GlowOrb
          color={glowOrb.color}
          position={glowOrb.position}
          size={glowOrb.size ?? "lg"}
        />
      )}

      <div
        className={cn(
          "relative z-10",
          variant === "narrow" ? tokens.spacing.containerNarrow : tokens.spacing.container,
          containerClassName,
        )}
      >
        {(eyebrow || title || subtitle) && (
          <div className="text-center mb-12 md:mb-16">
            {eyebrow && <p className={cn(tokens.typography.eyebrow, "mb-3")}>{eyebrow}</p>}
            {title && (
              <h2 className={cn(tokens.typography.display.h2, "mb-4")}>{title}</h2>
            )}
            {subtitle && (
              <p
                className={cn(
                  tokens.typography.body.lg,
                  "text-neutral-600 max-w-2xl mx-auto",
                )}
              >
                {subtitle}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
