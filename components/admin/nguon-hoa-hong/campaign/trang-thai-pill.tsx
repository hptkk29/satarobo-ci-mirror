// components/admin/nguon-hoa-hong/campaign/trang-thai-pill.tsx — pill trạng thái CAMPAIGN và MEMBERSHIP, CLIENT-SAFE (chỉ import thuần).
//
// Bọc `StatusPill` (06 §0: không viết pill thứ ba). Tông theo thang NGỮ NGHĨA, không mượn màu thương hiệu (DESIGN.md §1): đang chạy = success; chờ / tạm dừng = warning;
// nháp / kết thúc = muted. CHỮ nằm ở bảng gốc trong `lib/affiliate/*-dau-vao.ts` — pill, chip lọc, hộp thoại và nhật ký cùng nói một chữ.
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import { NHAN_TRANG_THAI_CAMPAIGN, type TrangThaiCampaign } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { NHAN_TRANG_THAI_MEMBERSHIP, type TrangThaiMembership } from "@/lib/affiliate/ghi-membership-dau-vao";
import { cn } from "@/lib/utils";
import { INK_THEO_TONE } from "../trang-thai-nguon-pill";

const TONE_CAMPAIGN: Record<TrangThaiCampaign, PillTone> = { DRAFT: "muted", ACTIVE: "success", PAUSED: "warning", ENDED: "muted" };
const TONE_MEMBERSHIP: Record<TrangThaiMembership, PillTone> = { PENDING: "info", ACTIVE: "success", SUSPENDED: "warning", ENDED: "muted" };

export function TrangThaiCampaignPill({ status, className }: { status: TrangThaiCampaign; className?: string }) {
  const tone = TONE_CAMPAIGN[status];
  return (
    <StatusPill tone={tone} className={cn(INK_THEO_TONE[tone], className)}>
      {NHAN_TRANG_THAI_CAMPAIGN[status]}
    </StatusPill>
  );
}

export function TrangThaiMembershipPill({ status, className }: { status: TrangThaiMembership; className?: string }) {
  const tone = TONE_MEMBERSHIP[status];
  return (
    <StatusPill tone={tone} className={cn(INK_THEO_TONE[tone], className)}>
      {NHAN_TRANG_THAI_MEMBERSHIP[status]}
    </StatusPill>
  );
}
