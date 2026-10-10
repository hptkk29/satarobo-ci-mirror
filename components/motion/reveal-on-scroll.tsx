"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

interface RevealOnScrollProps {
  children: ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
  distance?: number;
  direction?: "up" | "down" | "left" | "right";
}

// Reveal khi user scroll vào view. Chạy 1 lần.
export function RevealOnScroll({
  children,
  delay = 0,
  duration = 0.6,
  className,
  distance = 30,
  direction = "up",
}: RevealOnScrollProps) {
  const initial: { opacity: number; x?: number; y?: number } = { opacity: 0 };
  if (direction === "up") initial.y = distance;
  if (direction === "down") initial.y = -distance;
  if (direction === "left") initial.x = distance;
  if (direction === "right") initial.x = -distance;

  return (
    <motion.div
      initial={initial}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ delay, duration, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
