"use client";

import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type GlowColor = "orange" | "purple" | "none";

interface HoverLiftCardProps {
  children: ReactNode;
  className?: string;
  /** Distance px to lift on hover. Default 4 */
  liftDistance?: number;
  /** Scale on hover (1.0–1.05). Default 1.01 */
  scale?: number;
  glowColor?: GlowColor;
}

const GLOW_CLASS: Record<GlowColor, string> = {
  orange: "hover:shadow-[0_10px_40px_rgba(249,115,22,0.15)]",
  purple: "hover:shadow-[0_10px_40px_rgba(124,58,237,0.15)]",
  none: "hover:shadow-lg",
};

// Wrapper add subtle hover lift + glow. Use cho cards (course, blog, product).
export function HoverLiftCard({
  children,
  className,
  liftDistance = 4,
  scale = 1.01,
  glowColor = "orange",
}: HoverLiftCardProps) {
  return (
    <motion.div
      whileHover={{ y: -liftDistance, scale }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("transition-shadow duration-300", GLOW_CLASS[glowColor], className)}
    >
      {children}
    </motion.div>
  );
}
