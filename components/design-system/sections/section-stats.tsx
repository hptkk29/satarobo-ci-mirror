"use client";

import type { ReactNode } from "react";
import { NumberTicker } from "@/components/magic/number-ticker";
import { RevealOnScroll } from "@/components/motion/reveal-on-scroll";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface Stat {
  value: number;
  suffix?: string;
  label: string;
  icon?: ReactNode;
}

interface SectionStatsProps {
  eyebrow?: string;
  title?: string;
  stats: Stat[];
  className?: string;
}

// Stats section với NumberTicker + gradient numbers cam-tím. White bg.
export function SectionStats({ eyebrow, title, stats, className }: SectionStatsProps) {
  return (
    <section className={cn("bg-white", tokens.spacing.section, className)}>
      <div className={tokens.spacing.container}>
        {(eyebrow || title) && (
          <div className="text-center mb-12 md:mb-16">
            {eyebrow && <p className={cn(tokens.typography.eyebrow, "mb-3")}>{eyebrow}</p>}
            {title && <h2 className={tokens.typography.display.h2}>{title}</h2>}
          </div>
        )}

        <div
          className={cn(
            "grid gap-8 md:gap-12",
            stats.length === 2 && "grid-cols-2",
            stats.length === 3 && "grid-cols-1 md:grid-cols-3",
            stats.length === 4 && "grid-cols-2 md:grid-cols-4",
            stats.length > 4 && "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
          )}
        >
          {stats.map((stat, i) => (
            <RevealOnScroll key={i} delay={i * 0.1}>
              <div className="text-center">
                {stat.icon && (
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-orange-50 text-orange-500 mb-4">
                    {stat.icon}
                  </div>
                )}
                <div className="text-5xl md:text-6xl font-bold bg-gradient-to-br from-orange-500 to-purple-700 bg-clip-text text-transparent mb-2">
                  <NumberTicker value={stat.value} className="text-transparent bg-clip-text" />
                  {stat.suffix}
                </div>
                <div className="text-sm md:text-base text-neutral-600 uppercase tracking-wider">
                  {stat.label}
                </div>
              </div>
            </RevealOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}
