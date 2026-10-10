"use client";

import { useState } from "react";
import { ConsultModal } from "./consult-modal";

type Props = {
  courseSlug: string;
  courseName: string;
  courseDisplayName?: string;
  variant?: "primary" | "white" | "outline";
  size?: "md" | "lg";
  fullWidth?: boolean;
  children?: React.ReactNode;
};

// Nhịp/vệt sáng đi kèm variant, KHÔNG rắc ở nơi gọi: nền nút quyết định màu
// hiệu ứng (vệt trắng trên nút nền trắng là vô hình). Xem `.cta-*` trong globals.css.
const VARIANTS = {
  primary:
    "cta-pulse cta-shine bg-gradient-to-r from-orange-500 to-orange-600 text-white hover:from-orange-600 hover:to-orange-700",
  white:
    "cta-pulse-white cta-shine cta-shine-warm bg-white text-orange-600 hover:bg-orange-50",
  outline: "cta-shine border-2 border-white text-white hover:bg-white/10",
};

const SIZES = {
  md: "px-6 py-3 text-base",
  lg: "px-8 py-4 text-lg",
};

export function ConsultCtaButton({
  courseSlug,
  courseName,
  courseDisplayName,
  variant = "primary",
  size = "md",
  fullWidth = false,
  children,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={[
          "inline-flex items-center justify-center gap-2 rounded-xl font-bold transition",
          VARIANTS[variant],
          SIZES[size],
          fullWidth ? "w-full" : "",
        ].join(" ")}
      >
        {children ?? "Đặt buổi học thử 1-1 miễn phí"}
      </button>

      <ConsultModal
        open={open}
        onClose={() => setOpen(false)}
        courseSlug={courseSlug}
        courseName={courseName}
        courseDisplayName={courseDisplayName}
      />
    </>
  );
}
