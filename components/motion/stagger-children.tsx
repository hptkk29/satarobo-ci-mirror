"use client";

import { motion, type Variants } from "motion/react";
import type { ReactNode } from "react";

interface StaggerChildrenProps {
  children: ReactNode;
  staggerDelay?: number;
  className?: string;
}

const container: Variants = {
  hidden: { opacity: 0 },
  show: (staggerDelay: number) => ({
    opacity: 1,
    transition: { staggerChildren: staggerDelay },
  }),
};

// Mỗi child nên wrap trong <motion.div variants={staggerItem}>.
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export function StaggerChildren({
  children,
  staggerDelay = 0.1,
  className,
}: StaggerChildrenProps) {
  return (
    <motion.div
      variants={container}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true }}
      custom={staggerDelay}
      className={className}
    >
      {children}
    </motion.div>
  );
}
