// components/admin/nguon-hoa-hong/commission-status-pill.tsx — ÁNH XẠ trạng thái hoa hồng → tông màu ở MỘT chỗ (06 §7 "CommissionStatusPill").
//
// Bọc `StatusPill` (06 §0: không viết pill thứ ba). Tông theo thang NGỮ NGHĨA, không mượn màu thương hiệu (DESIGN.md §1): đã chi = success;
// đang đi trên đường chi = info; việc cần người = warning; lỗi cấu hình / tiền bị rút = danger; chưa có / không chặn = muted.
// `StatusPill` tô bằng màu SÁNG (trượt AA trên nền trắng) nên luôn đè `text-state-*-ink` — cùng cách `nguon-status-pill.tsx`.
import type { CommissionPayoutStatus } from "@prisma/client";

import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import type { MaHold } from "@/lib/hoa-hong/hang-cho";
import { NHAN_MA_HANG_CHO } from "@/lib/hoa-hong/hang-cho-so-nhom";
import { NHAN_TRANG_THAI_CHI } from "@/lib/hoa-hong/vi-sao-day-du";
import { cn } from "@/lib/utils";

const INK: Record<PillTone, string> = {
  success: "text-state-success-ink",
  warning: "text-state-warning-ink",
  danger: "text-state-danger-ink",
  info: "text-state-info-ink",
  brand: "text-primary-ink",
  muted: "",
};

export const TONE_TRANG_THAI_CHI: Record<CommissionPayoutStatus, PillTone> = {
  PENDING: "muted",
  APPROVED: "info",
  EXPORTED: "info",
  PAID: "success",
};

/** Mã hàng chờ → tông. Lỗi cấu hình / tiền bị rút là danger; chưa có người nhận · sổ âm · chờ văn bản không phải việc gấp nên muted; còn lại là việc cần người = warning. */
export const TONE_HANG_CHO: Record<MaHold, PillTone> = {
  CAP_EXCEEDED: "danger",
  NO_ORG_UNIT: "danger",
  PAYMENT_WITHDRAWN: "danger",
  UNRESOLVED_BENEFICIARY: "muted",
  NEGATIVE_BALANCE: "muted",
  PENDING_REGULATION: "muted",
  POLICY_OVERLAP: "warning",
  CHUA_GAN_CON: "warning",
  CHO_HOC_VIEN: "warning",
  INTERNAL_TRANSFER: "warning",
  NEGATIVE_WITHOUT_ORIGIN: "warning",
  INPUT_DRIFT: "warning",
  MANUAL_REVIEW_REQUIRED: "warning",
};

/** Nhãn NGẮN cho ô bảng (cột Trạng thái chỉ rộng 6rem). Nhãn đầy đủ nằm ở ngăn "Vì sao" và ô lọc. */
export const NHAN_TRANG_THAI_CHI_NGAN: Record<CommissionPayoutStatus, string> = {
  PENDING: "Chưa chi",
  APPROVED: "Đã duyệt",
  EXPORTED: "Đã xuất",
  PAID: "Đã chi",
};

export function TrangThaiChiPill({ trangThai, ngan = false, className }: { trangThai: CommissionPayoutStatus; ngan?: boolean; className?: string }) {
  const tone = TONE_TRANG_THAI_CHI[trangThai];
  return (
    <StatusPill tone={tone} className={cn(INK[tone], className)}>
      {(ngan ? NHAN_TRANG_THAI_CHI_NGAN : NHAN_TRANG_THAI_CHI)[trangThai]}
    </StatusPill>
  );
}

/** Pill của một hàng chờ. Ca đơn chưa nối lead có nhãn riêng — đó không phải "chưa có người nhận" chung chung. */
export function HangChoPill({ ma, laDonChuaNoiLead, className }: { ma: MaHold; laDonChuaNoiLead?: boolean; className?: string }) {
  const tone = TONE_HANG_CHO[ma];
  return (
    <StatusPill tone={tone} className={cn(INK[tone], className)}>
      {laDonChuaNoiLead ? "Đơn chưa nối lead" : NHAN_MA_HANG_CHO[ma]}
    </StatusPill>
  );
}
