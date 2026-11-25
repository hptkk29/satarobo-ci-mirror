// components/admin/nguon-hoa-hong/referral/trang-thai-referral-pill.tsx — pill TRẠNG THÁI của một lượt referral. CLIENT-SAFE (chỉ import tệp thuần).
//
// Chữ ở `NHAN_TRANG_THAI_REFERRAL`, tông ở `TONE_TRANG_THAI_REFERRAL` (lib/affiliate/ghi-referral-dau-vao.ts) — chip lọc, pill và trang chi tiết cùng nói một chữ.
// Bọc `StatusPill` (không viết pill thứ ba); `title` nói trạng thái này nghĩa là gì với khách và hoa hồng.
import { StatusPill } from "@/components/admin/ui/status-pill";
import { MO_TA_TRANG_THAI_REFERRAL, NHAN_TRANG_THAI_REFERRAL, TONE_TRANG_THAI_REFERRAL, type TrangThaiReferral } from "@/lib/affiliate/ghi-referral-dau-vao";
import { cn } from "@/lib/utils";
import { INK_THEO_TONE } from "../trang-thai-nguon-pill";

export function TrangThaiReferralPill({ trangThai, className }: { trangThai: TrangThaiReferral; className?: string }) {
  const tone = TONE_TRANG_THAI_REFERRAL[trangThai];
  return (
    <StatusPill tone={tone} className={cn(INK_THEO_TONE[tone], className)}>
      <span title={MO_TA_TRANG_THAI_REFERRAL[trangThai]}>{NHAN_TRANG_THAI_REFERRAL[trangThai]}</span>
    </StatusPill>
  );
}
