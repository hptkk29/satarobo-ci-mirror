"use client";

import { Printer } from "lucide-react";

// Nút "In học bạ" — cần client component nhỏ vì window.print() (HocBaPageV2 là RSC).
export function HocBaPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
    >
      <Printer className="size-4" /> In học bạ
    </button>
  );
}
