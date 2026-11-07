"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef, type ReactNode } from "react";

interface PortraitRevealProps {
  /** Lớp nền của khung (gradient, chấm…) — đứng yên, chỉ khung zoom. */
  backdrop: ReactNode;
  /** Ảnh người — zoom/trượt riêng, tách khỏi khung. */
  children: ReactNode;
  /** Nghiêng nhẹ khung theo phía ảnh nằm: -1 = ảnh bên trái, 1 = bên phải. */
  side?: -1 | 1;
  className?: string;
  frameClassName?: string;
}

// Chân dung xuất hiện khi cuộn tới, chạy 1 lần:
//  1. khung zoom-in từ 70% + xoay nhẹ về thẳng;
//  2. người trồi lên từ đáy khung, zoom từ 115% về 100% (trễ hơn khung một nhịp);
//  3. vòng sáng cam phía sau loé lên.
// Sau đó: cuộn trang thì người trôi nhẹ (parallax), rê chuột thì khung phóng nhẹ.
// Người bật "giảm chuyển động" chỉ thấy hiện dần.
export function PortraitReveal({
  backdrop,
  children,
  side = -1,
  className,
  frameClassName,
}: PortraitRevealProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const personY = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [12, -12]);
  const ease = [0.22, 1, 0.36, 1] as const;
  const viewport = { once: true, margin: "0px 0px -15% 0px" };

  return (
    <div ref={ref} className={`relative ${className ?? ""}`}>
      {/* Vòng sáng phía sau khung */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-6 -z-10 rounded-[2.5rem] bg-gradient-to-br from-orange-400 to-purple-500 blur-2xl"
        initial={{ opacity: 0, scale: 0.6 }}
        whileInView={{ opacity: 0.55, scale: 1.05 }}
        viewport={viewport}
        transition={{ delay: 0.25, duration: 0.6, ease }}
      />

      <motion.div
        className={frameClassName}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.7, rotate: 4 * side, y: 30 }}
        whileInView={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
        whileHover={reduce ? undefined : { scale: 1.03, rotate: -1.5 * side }}
        viewport={viewport}
        transition={{ duration: 0.6, ease }}
      >
        {backdrop}
        <motion.div className="absolute inset-x-0 top-0 -bottom-6" style={{ y: personY }}>
          <motion.div
            className="absolute inset-0 origin-bottom"
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.15, y: 60 }}
            whileInView={{ opacity: 1, scale: 1, y: 0 }}
            viewport={viewport}
            transition={{ delay: 0.15, duration: 0.6, ease }}
          >
            {children}
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
