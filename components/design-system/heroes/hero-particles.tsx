"use client";

import type { ReactNode } from "react";
import { Particles } from "@/components/magic/particles";
import { AnimatedGradientText } from "@/components/magic/animated-gradient-text";
import { FadeIn } from "@/components/motion/fade-in";
import { CircuitPattern } from "@/components/design-system/decorations/circuit-pattern";
import { GlowOrb } from "@/components/design-system/effects/glow-orb";
import { Sparkles } from "@/components/design-system/effects/sparkles";
import { AnimatedGridLines } from "@/components/design-system/effects/animated-grid-lines";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

type Theme = "sunrise" | "twilight" | "soft-warm" | "soft-cool" | "default";

interface TrustIndicator {
  icon?: ReactNode;
  text: string;
}

interface HeroEffects {
  particles?: boolean;
  sparkles?: boolean;
  glowOrbs?: boolean;
  gridLines?: boolean;
}

interface HeroParticlesProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  trustIndicators?: TrustIndicator[];
  /** Strategic color theme. Default "default" (= v1 behavior). */
  theme?: Theme;
  /** Toggle effects individually. Default: particles + glowOrbs only. */
  effects?: HeroEffects;
  className?: string;
}

const BG_MAP: Record<Theme, string> = {
  default: tokens.bg.heroLight, // v1 backward compat
  sunrise: tokens.vibrantBg.sunrise,
  twilight: tokens.vibrantBg.twilight,
  "soft-warm": tokens.vibrantBg.softWarm,
  "soft-cool": tokens.vibrantBg.softCool,
};

const PARTICLE_COLOR: Record<Theme, string> = {
  default: "#F97316",
  sunrise: "#F97316",
  twilight: "#7C3AED",
  "soft-warm": "#F97316",
  "soft-cool": "#7C3AED",
};

// Hero với strategic color theme + vibrant effects (Phase 4.UI.1.1).
// Default theme="default" giữ behavior v1 (backward compat).
export function HeroParticles({
  eyebrow,
  title,
  subtitle,
  children,
  trustIndicators,
  theme = "default",
  effects = { particles: true, sparkles: false, glowOrbs: false, gridLines: false },
  className,
}: HeroParticlesProps) {
  const {
    particles: showParticles = true,
    sparkles: showSparkles = false,
    glowOrbs: showGlowOrbs = false,
    gridLines: showGridLines = false,
  } = effects;

  return (
    <section
      className={cn(
        "relative overflow-hidden",
        BG_MAP[theme],
        tokens.spacing.section,
        className,
      )}
    >
      {/* Glow orbs (Phase 4.UI.1.1 effect) */}
      {showGlowOrbs && (
        <>
          <GlowOrb
            color={theme === "twilight" || theme === "soft-cool" ? "purple" : "orange"}
            position="top-left"
            size="lg"
          />
          <GlowOrb
            color={theme === "twilight" || theme === "soft-cool" ? "orange" : "purple"}
            position="bottom-right"
            size="lg"
          />
        </>
      )}

      {/* Animated grid lines — Sata Robo signature (use sparingly) */}
      {showGridLines && <AnimatedGridLines color="mixed" opacity={0.1} />}

      {/* Particles */}
      {showParticles && (
        <Particles
          className="absolute inset-0"
          quantity={35}
          ease={80}
          color={PARTICLE_COLOR[theme]}
          size={0.5}
          refresh
        />
      )}

      {/* Sparkles random (Phase 4.UI.1.1) */}
      {showSparkles && <Sparkles density="medium" colors={["orange", "purple"]} />}

      {/* Decorative circuit pattern subtle (v1 style) */}
      <CircuitPattern className="absolute top-0 right-0 w-1/3 h-1/2 text-orange-200 opacity-20" />
      <CircuitPattern className="absolute bottom-0 left-0 w-1/3 h-1/2 text-purple-200 opacity-20 rotate-180" />

      <div className={cn(tokens.spacing.containerNarrow, "relative z-10 text-center")}>
        <FadeIn>
          {eyebrow && (
            <div className="mb-6 inline-block">
              <AnimatedGradientText colorFrom="#F97316" colorTo="#7C3AED" speed={1.2}>
                <span className={tokens.typography.eyebrow}>{eyebrow}</span>
              </AnimatedGradientText>
            </div>
          )}

          <h1
            className={cn(
              tokens.typography.display.h1,
              "mb-6 max-w-4xl mx-auto leading-tight",
            )}
          >
            {title}
          </h1>

          {subtitle && (
            <p
              className={cn(
                tokens.typography.body.lg,
                "text-neutral-600 max-w-2xl mx-auto mb-8",
              )}
            >
              {subtitle}
            </p>
          )}

          {children && (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
              {children}
            </div>
          )}

          {trustIndicators && trustIndicators.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-8">
              {trustIndicators.map((indicator, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-neutral-600 text-sm"
                >
                  {indicator.icon ?? (
                    <svg
                      className="w-4 h-4 text-orange-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  )}
                  <span>{indicator.text}</span>
                </div>
              ))}
            </div>
          )}
        </FadeIn>
      </div>
    </section>
  );
}
