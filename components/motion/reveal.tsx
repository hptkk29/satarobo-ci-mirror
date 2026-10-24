"use client";

import { motion, useReducedMotion, type TargetAndTransition, type Transition } from "motion/react";
import type { ReactNode } from "react";

// Một wrapper "hiện khi cuộn tới" với NHIỀU KIỂU, để mỗi khối trên trang có cử động riêng
// thay vì cùng một kiểu fade-up. Chạy 1 lần; mọi kiểu ≤ 600ms (ngân sách trang public).
// Người bật "giảm chuyển động" chỉ thấy hiện dần, không dịch/xoay/phóng.
export type RevealVariant =
  | "blur" //        mờ + nhoè → rõ (đoạn văn)
  | "wipe-right" //  quét mở từ trái sang phải (clip-path)
  | "wipe-left" //   quét mở từ phải sang trái
  | "flip-up" //     lật lên kiểu 3D quanh trục ngang
  | "pop" //         bật nảy từ nhỏ (lò xo)
  | "slide-left" //  trượt vào từ bên trái
  | "slide-right" // trượt vào từ bên phải
  | "mask-up" //     chữ trồi lên từ sau mặt nạ
  | "swing"; //      rơi xuống + lắc nhẹ về thẳng

const EASE = [0.22, 1, 0.36, 1] as const;

const VARIANTS: Record<
  RevealVariant,
  { from: TargetAndTransition; to: TargetAndTransition; transition?: Transition }
> = {
  blur: {
    from: { opacity: 0, filter: "blur(10px)", y: 12 },
    to: { opacity: 1, filter: "blur(0px)", y: 0 },
  },
  "wipe-right": {
    from: { opacity: 0.2, clipPath: "inset(0 100% 0 0 round 24px)" },
    to: { opacity: 1, clipPath: "inset(0 0% 0 0 round 24px)" },
  },
  "wipe-left": {
    from: { opacity: 0.2, clipPath: "inset(0 0 0 100% round 24px)" },
    to: { opacity: 1, clipPath: "inset(0 0 0 0% round 24px)" },
  },
  "flip-up": {
    from: { opacity: 0, rotateX: 35, y: 40, transformPerspective: 1000 },
    to: { opacity: 1, rotateX: 0, y: 0, transformPerspective: 1000 },
  },
  pop: {
    from: { opacity: 0, scale: 0.6 },
    to: { opacity: 1, scale: 1 },
    transition: { type: "spring", stiffness: 260, damping: 18, mass: 0.8 },
  },
  "slide-left": {
    from: { opacity: 0, x: -60 },
    to: { opacity: 1, x: 0 },
  },
  "slide-right": {
    from: { opacity: 0, x: 60 },
    to: { opacity: 1, x: 0 },
  },
  "mask-up": {
    from: { y: "110%" },
    to: { y: "0%" },
  },
  swing: {
    from: { opacity: 0, y: -30, rotate: -6 },
    to: { opacity: 1, y: 0, rotate: 0 },
    transition: { type: "spring", stiffness: 200, damping: 12 },
  },
};

interface RevealProps {
  children: ReactNode;
  variant: RevealVariant;
  delay?: number;
  className?: string;
}

export function Reveal({ children, variant, delay = 0, className }: RevealProps) {
  const reduce = useReducedMotion();
  const v = VARIANTS[variant];
  const viewport = { once: true, margin: "0px 0px -12% 0px" };
  const transition: Transition = { duration: 0.6, ease: EASE, ...v.transition, delay };

  if (reduce) {
    return (
      <motion.div
        className={className}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={viewport}
        transition={{ duration: 0.4, delay }}
      >
        {children}
      </motion.div>
    );
  }

  // Mặt nạ: khung ngoài cắt tràn, phần trong trồi lên. Khung NGOÀI canh viewport —
  // phần trong nằm ngoài vùng cắt nên IntersectionObserver không bao giờ thấy nó.
  if (variant === "mask-up") {
    return (
      <motion.div
        className={`overflow-hidden ${className ?? ""}`}
        initial="hidden"
        whileInView="show"
        viewport={viewport}
      >
        <motion.div variants={{ hidden: v.from, show: v.to }} transition={transition}>
          {children}
        </motion.div>
      </motion.div>
    );
  }

  return (
    <motion.div
      className={className}
      initial={v.from}
      whileInView={v.to}
      viewport={viewport}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}
