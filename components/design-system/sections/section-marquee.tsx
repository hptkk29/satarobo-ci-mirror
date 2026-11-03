"use client";

import type { ReactNode } from "react";
import { Marquee } from "@/components/magic/marquee";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface SectionMarqueeProps {
  eyebrow?: string;
  title?: string;
  items: ReactNode[];
  className?: string;
  reverse?: boolean;
  /** Duration of scroll in seconds. Default 30s */
  duration?: number;
}

// Section với horizontal marquee (logo strip, testimonials, partner brands).
export function SectionMarquee({
  eyebrow,
  title,
  items,
  className,
  reverse = false,
  duration = 30,
}: SectionMarqueeProps) {
  return (
    <section className={cn("bg-neutral-50", tokens.spacing.sectionSm, className)}>
      <div className={tokens.spacing.container}>
        {(eyebrow || title) && (
          <div className="text-center mb-8">
            {eyebrow && <p className={cn(tokens.typography.eyebrow, "mb-2")}>{eyebrow}</p>}
            {title && <h3 className={tokens.typography.heading.h3}>{title}</h3>}
          </div>
        )}

        <Marquee
          reverse={reverse}
          pauseOnHover
          style={{ ["--duration" as string]: `${duration}s` }}
        >
          {items.map((item, i) => (
            <div key={i} className="mx-8 flex items-center">
              {item}
            </div>
          ))}
        </Marquee>
      </div>
    </section>
  );
}
