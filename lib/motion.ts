import type { Variants } from "motion/react";

// Reusable Framer Motion variants for Sata Robo client UI.
// Pair with components/motion/* wrappers (FadeIn, RevealOnScroll,
// StaggerChildren) — those wrappers are still preferred for simple
// fade/scroll-in cases; these variants give finer control for one-off
// orchestrations (hero composition, complex card grids, etc.).

type Direction = "up" | "down" | "left" | "right";

export function fadeIn(direction: Direction = "up", delay = 0): Variants {
  return {
    hidden: {
      opacity: 0,
      y: direction === "up" ? 40 : direction === "down" ? -40 : 0,
      x: direction === "left" ? 40 : direction === "right" ? -40 : 0,
    },
    show: {
      opacity: 1,
      y: 0,
      x: 0,
      transition: { type: "spring", duration: 0.8, delay },
    },
  };
}

export function staggerContainer(
  staggerChildren = 0.15,
  delayChildren = 0,
): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren, delayChildren } },
  };
}

export function scaleIn(delay = 0): Variants {
  return {
    hidden: { opacity: 0, scale: 0.8 },
    show: {
      opacity: 1,
      scale: 1,
      transition: { type: "spring", duration: 0.6, delay },
    },
  };
}

// Reduced-motion respecting viewport options. Use with
// motion.div initial="hidden" whileInView="show" viewport={DEFAULT_VIEWPORT}.
export const DEFAULT_VIEWPORT = { once: true, amount: 0.25 } as const;
