// components/admin/nguon-hoa-hong/policy-version-badge.tsx — `PolicyVersionBadge` + pill trạng thái phiên bản (06 §7).
//
// Trạng thái → chữ + tông ở MỘT chỗ (`lib/hoa-hong/trang-thai-phien-ban.ts`); component chỉ bọc `StatusPill` (06 §0: không viết
// pill thứ ba) và ép chữ về `-ink` — `StatusPill` tô bằng màu SÁNG, trượt AA trên nền trắng (xem `nguon-status-pill.tsx`).
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import type { TrangThaiPhienBan } from "@/lib/hoa-hong/chon-quy-tac";
import { trangThaiPhienBanHienThi } from "@/lib/hoa-hong/trang-thai-phien-ban";
import { cn } from "@/lib/utils";

const INK: Record<PillTone, string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  brand: "text-primary-ink",
  muted: "",
};

export function TrangThaiPhienBanPill({
  status,
  effectiveFrom,
  effectiveTo,
  now,
  className,
}: {
  status: TrangThaiPhienBan;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  /** BẮT BUỘC: "đang áp dụng" phụ thuộc ngày, mà component không được đọc đồng hồ (luật 19). */
  now: Date;
  className?: string;
}) {
  const t = trangThaiPhienBanHienThi({ status, effectiveFrom, effectiveTo }, now);
  return (
    <StatusPill tone={t.tone} className={cn(INK[t.tone], className)}>
      {t.nhan}
    </StatusPill>
  );
}

/** "v2" — số phiên bản, tabular để cột thẳng hàng. Chữ "Phiên bản" nằm ở tiêu đề cột / nhãn, không lặp trong từng ô. */
export function PolicyVersionBadge({ versionNo, className }: { versionNo: number; className?: string }) {
  return (
    <span
      title={`Phiên bản ${versionNo}`}
      className={cn("inline-flex shrink-0 items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-semibold tabular-nums text-foreground", className)}
    >
      v{versionNo}
    </span>
  );
}
