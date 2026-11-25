"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

type SparkleColor = "orange" | "purple";
type Density = "low" | "medium" | "high";

interface SparklesProps {
  className?: string;
  density?: Density;
  colors?: SparkleColor[];
}

interface Sparkle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
}

const DENSITY_COUNT: Record<Density, number> = { low: 8, medium: 15, high: 25 };
const COLOR_MAP: Record<SparkleColor, string> = {
  orange: "#F97316",
  purple: "#7C3AED",
};

// Random sparkles cam-tím floating. Strategic use: hero, CTA sections.
// Random vị trí generate client-side để không break SSR hydration.
export function Sparkles({
  className,
  density = "medium",
  colors = ["orange", "purple"],
}: SparklesProps) {
  const [sparkles, setSparkles] = useState<Sparkle[]>([]);

  useEffect(() => {
    const count = DENSITY_COUNT[density];
    const next: Sparkle[] = Array.from({ length: count }).map((_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 2,
      color: COLOR_MAP[colors[i % colors.length]],
      delay: Math.random() * 5,
      duration: Math.random() * 3 + 2,
    }));
    setSparkles(next);
  }, [density, colors]);

  return (
    <div
      className={cn("absolute inset-0 overflow-hidden pointer-events-none", className)}
      aria-hidden="true"
    >
      {sparkles.map((s) => (
        <motion.div
          key={s.id}
          className="absolute rounded-full"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            backgroundColor: s.color,
            boxShadow: `0 0 ${s.size * 2}px ${s.color}`,
          }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0] }}
          transition={{
            duration: s.duration,
            delay: s.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
