"use client";

import type { ReactNode } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { RevealOnScroll } from "@/components/motion/reveal-on-scroll";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface HeroSplitProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode; // CTAs
  illustration: ReactNode;
  illustrationPosition?: "right" | "left";
  className?: string;
}

// Split hero: text + illustration. Light bg.
export function HeroSplit({
  eyebrow,
  title,
  subtitle,
  children,
  illustration,
  illustrationPosition = "right",
  className,
}: HeroSplitProps) {
  const isRight = illustrationPosition === "right";

  return (
    <section
      className={cn("relative overflow-hidden bg-white", tokens.spacing.section, className)}
    >
      <div className={tokens.spacing.container}>
        <div
          className={cn(
            "grid md:grid-cols-2 items-center gap-12 lg:gap-16",
          )}
        >
          {/* Text block */}
          <FadeIn className={isRight ? "" : "md:order-2"}>
            <div>
              {eyebrow && <p className={cn(tokens.typography.eyebrow, "mb-4")}>{eyebrow}</p>}
              <h1 className={cn(tokens.typography.display.h2, "mb-6 leading-tight")}>{title}</h1>
              {subtitle && (
                <p className={cn(tokens.typography.body.lg, "text-neutral-600 mb-8")}>
                  {subtitle}
                </p>
              )}
              {children && (
                <div className="flex flex-col sm:flex-row gap-4">{children}</div>
              )}
            </div>
          </FadeIn>

          {/* Illustration block */}
          <RevealOnScroll
            direction={isRight ? "right" : "left"}
            className={isRight ? "" : "md:order-1"}
          >
            <div className="relative">{illustration}</div>
          </RevealOnScroll>
        </div>
      </div>
    </section>
  );
}
