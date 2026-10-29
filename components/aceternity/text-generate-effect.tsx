"use client";

import React, { useEffect } from "react";
import { motion, stagger, useAnimate } from "motion/react";
import { cn } from "@/lib/utils";

// Aceternity-style word-by-word fade with optional blur. SSR renders the
// whole sentence at opacity-0 (SEO + bot reads it just fine); the client
// effect animates each <span> to opacity 1 with a staggered delay.

export function TextGenerateEffect({
  words,
  className,
  filter = true,
  duration = 0.5,
}: {
  words: string;
  className?: string;
  filter?: boolean;
  duration?: number;
}) {
  const [scope, animate] = useAnimate();
  const wordsArray = words.split(" ");

  useEffect(() => {
    animate(
      "span",
      { opacity: 1, filter: filter ? "blur(0px)" : "none" },
      { duration, delay: stagger(0.1) },
    );
    // animate's identity is stable from useAnimate's hook; only re-run on
    // content/style changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words, filter, duration]);

  return (
    <div className={cn("font-medium", className)}>
      <motion.div ref={scope}>
        {wordsArray.map((word, idx) => (
          <motion.span
            key={`${word}-${idx}`}
            className="opacity-0"
            style={{ filter: filter ? "blur(10px)" : "none" }}
          >
            {word}{" "}
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
}
