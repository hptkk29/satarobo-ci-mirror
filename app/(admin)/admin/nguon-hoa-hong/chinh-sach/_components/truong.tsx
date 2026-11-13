"use client";

// Ô form của builder: nhãn + điều khiển + dòng lỗi CẠNH Ô (PRD §72). Lỗi gắn `id` để điều khiển trỏ `aria-describedby`;
// `data-truong` đặt trên điều khiển (không phải trên vỏ) để "cuộn + focus ô lỗi đầu tiên" rơi vào đúng thứ gõ được.
import { useId } from "react";

import { LOI_O, NHAN_O } from "@/components/admin/nguon-hoa-hong/classes";
import { cn } from "@/lib/utils";

export type PropsDieuKhien = { id: string; "aria-invalid"?: true; "aria-describedby"?: string; "data-truong": string };

/** Vỏ một ô: `children` là hàm nhận thuộc tính a11y để gắn vào đúng điều khiển. */
export function Truong({
  truong,
  nhan,
  batBuoc,
  loi,
  goiY,
  className,
  children,
}: {
  truong: string;
  nhan: string;
  batBuoc?: boolean;
  loi?: string | null;
  goiY?: React.ReactNode;
  className?: string;
  children: (p: PropsDieuKhien) => React.ReactNode;
}) {
  const id = useId();
  const mo = `${id}-mo`;
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className={NHAN_O}>
        {nhan}
        {batBuoc && <span className="text-state-danger-ink"> *</span>}
      </label>
      {children({ id, "aria-invalid": loi ? true : undefined, "aria-describedby": loi || goiY ? mo : undefined, "data-truong": truong })}
      {loi ? (
        <p id={mo} role="alert" className={LOI_O}>
          {loi}
        </p>
      ) : goiY ? (
        <p id={mo} className="mt-1 text-xs text-muted-foreground">
          {goiY}
        </p>
      ) : null}
    </div>
  );
}

/** Nhóm chọn (radio / checkbox) có tiêu đề + lỗi; vỏ focusable (tabIndex -1) để lỗi nhảy được tới cả nhóm. */
export function NhomChon({
  truong,
  nhan,
  loi,
  goiY,
  children,
}: {
  truong: string;
  nhan: string;
  loi?: string | null;
  goiY?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  const mo = `${id}-mo`;
  return (
    <fieldset className="min-w-0" aria-describedby={loi || goiY ? mo : undefined}>
      <legend className={NHAN_O}>{nhan}</legend>
      <div data-truong={truong} tabIndex={-1} aria-invalid={loi ? true : undefined} className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {children}
      </div>
      {loi ? (
        <p id={mo} role="alert" className={LOI_O}>
          {loi}
        </p>
      ) : goiY ? (
        <p id={mo} className="mt-1 text-xs text-muted-foreground">
          {goiY}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Một lựa chọn radio / checkbox cao ≥ 44px (vùng chạm tablet). */
export function LuaChon({
  loai,
  name,
  checked,
  onChange,
  nhan,
  moTa,
  disabled,
}: {
  loai: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: (c: boolean) => void;
  nhan: string;
  moTa?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
        checked ? "border-primary bg-primary-soft" : "border-border bg-card hover:bg-muted",
        disabled && "cursor-not-allowed opacity-60 hover:bg-card",
      )}
    >
      <input
        type={loai}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{nhan}</span>
        {moTa && <span className="mt-0.5 block text-xs text-muted-foreground">{moTa}</span>}
      </span>
    </label>
  );
}
