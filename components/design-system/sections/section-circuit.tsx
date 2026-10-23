import type { ReactNode } from "react";
import { CircuitPattern } from "@/components/design-system/decorations/circuit-pattern";
import { tokens } from "@/lib/design-tokens";
import { cn } from "@/lib/utils";

interface SectionCircuitProps {
  children: ReactNode;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  className?: string;
}

// Section với subtle circuit pattern ở 2 góc. Use cho stats, features.
export function SectionCircuit({
  children,
  eyebrow,
  title,
  subtitle,
  className,
}: SectionCircuitProps) {
  return (
    <section
      className={cn("relative overflow-hidden bg-white", tokens.spacing.section, className)}
    >
      <CircuitPattern className="absolute top-0 right-0 w-1/2 h-1/2 text-orange-100 opacity-50" />
      <CircuitPattern className="absolute bottom-0 left-0 w-1/3 h-1/3 text-purple-100 opacity-40 rotate-180" />

      <div className={cn(tokens.spacing.container, "relative z-10")}>
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
