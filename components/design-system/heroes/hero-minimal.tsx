"use client";

import type { ReactNode } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface HeroMinimalProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  className?: string;
}

// Minimal centered hero. Pure white, no particles, no fancy animations.
// Use cho content-focused pages (blog list, tuyển dụng list, legal, simple).
export function HeroMinimal({
  eyebrow,
  title,
  subtitle,
  children,
  className,
}: HeroMinimalProps) {
  return (
    <section
      className={cn(
        "bg-white border-b border-neutral-200",
        tokens.spacing.sectionSm,
        className,
      )}
    >
      <div className={cn(tokens.spacing.containerNarrow, "text-center")}>
        <FadeIn>
          {eyebrow && <p className={cn(tokens.typography.eyebrow, "mb-3")}>{eyebrow}</p>}
          <h1 className={cn(tokens.typography.display.h2, "mb-4 leading-tight")}>{title}</h1>
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
          {children && (
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              {children}
            </div>
          )}
        </FadeIn>
      </div>
    </section>
  );
}
