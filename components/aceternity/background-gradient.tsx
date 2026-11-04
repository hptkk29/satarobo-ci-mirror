"use client";

import React from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

// Aceternity-style animated gradient halo behind any content.
// Rebranded to Sata Robo palette (orange #F97316 / purple #A855F7 /
// yellow #EAB308). The dark anchor color (#141316) is kept so the
// gradient still pops against light surfaces.

export interface BackgroundGradientProps {
  children?: React.ReactNode;
  className?: string;
  containerClassName?: string;
  animate?: boolean;
}

const SATA_GRADIENT =
  "bg-[radial-gradient(circle_farthest-side_at_0_100%,#F97316,transparent),radial-gradient(circle_farthest-side_at_100%_0,#A855F7,transparent),radial-gradient(circle_farthest-side_at_100%_100%,#EAB308,transparent),radial-gradient(circle_farthest-side_at_0_0,#F97316,#141316)]";

const VARIANTS = {
  initial: { backgroundPosition: "0 50%" },
  animate: {
    backgroundPosition: ["0, 50%", "100% 50%", "0 50%"] as string[],
  },
} as const;

export function BackgroundGradient({
  children,
  className,
  containerClassName,
  animate = true,
}: BackgroundGradientProps) {
  return (
    <div className={cn("relative p-[4px] group", containerClassName)}>
      <motion.div
        variants={animate ? VARIANTS : undefined}
        initial={animate ? "initial" : undefined}
        animate={animate ? "animate" : undefined}
        transition={
          animate
            ? {
                duration: 5,
                repeat: Infinity,
                repeatType: "reverse",
              }
            : undefined
        }
        style={{ backgroundSize: animate ? "400% 400%" : undefined }}
        className={cn(
          "absolute inset-0 rounded-3xl z-[1] opacity-60 group-hover:opacity-100 blur-xl transition duration-500 will-change-transform",
          SATA_GRADIENT,
        )}
      />
      <motion.div
        variants={animate ? VARIANTS : undefined}
        initial={animate ? "initial" : undefined}
        animate={animate ? "animate" : undefined}
        transition={
          animate
            ? {
                duration: 5,
                repeat: Infinity,
                repeatType: "reverse",
              }
            : undefined
        }
        style={{ backgroundSize: animate ? "400% 400%" : undefined }}
        className={cn(
          "absolute inset-0 rounded-3xl z-[1] will-change-transform",
          SATA_GRADIENT,
        )}
      />
      <div className={cn("relative z-10", className)}>{children}</div>
    </div>
  );
}
