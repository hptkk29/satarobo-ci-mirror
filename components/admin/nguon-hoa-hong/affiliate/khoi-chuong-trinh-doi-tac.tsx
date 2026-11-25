// components/admin/nguon-hoa-hong/affiliate/khoi-chuong-trinh-doi-tac.tsx — «CHƯƠNG TRÌNH ĐỐI TÁC ĐANG THAM GIA» của trang chi tiết đối tác (AFF-L3a): mỗi campaign một thẻ, kèm trạng thái thành viên, hiệu lực,
// XEM TRƯỚC NGUỒN khách (`giaiNguonCuaDoiTac`) và các nút duyệt / tạm ngừng / kết thúc.
//
// Server component. Nút (client) là CHÍNH `NutMembership` của tab Campaign — danh sách nút lấy từ `thaoTacKhaDung`, gọi `doiTrangThaiMembershipAction` (khoá `affiliate_memberships:manage`). Vì vậy
// `coTheThanhVien` = `scope.has("affiliate_memberships:manage")` (luật 12: nút chỉ vẽ khi máy chủ sẽ nhận); người thiếu khoá đó vẫn thấy thẻ nhưng không thấy nút.
import Link from "next/link";
import { StatusPill, type PillTone } from "@/components/admin/ui/status-pill";
import type { ChuongTrinhCuaDoiTac } from "@/lib/affiliate/doc-ho-so-doi-tac";
import { NHAN_TRANG_THAI_CAMPAIGN, type DongMembershipView } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { NHAN_TRANG_THAI_MEMBERSHIP, type TrangThaiMembership } from "@/lib/affiliate/ghi-membership-dau-vao";
import { NutMembership } from "../campaign/nut-membership";
import { INK_THEO_TONE } from "../trang-thai-nguon-pill";
import { NguonXemTruoc } from "./nguon-xem-truoc";

const TONE: Record<TrangThaiMembership, PillTone> = { PENDING: "warning", ACTIVE: "success", SUSPENDED: "warning", ENDED: "muted" };

const ngayVN = (iso: string): string => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

export type DoiTacTom = DongMembershipView["doiTac"];

export function KhoiChuongTrinhDoiTac({ chuongTrinh, doiTac, coTheThanhVien }: { chuongTrinh: readonly ChuongTrinhCuaDoiTac[]; doiTac: DoiTacTom; coTheThanhVien: boolean }) {
  if (chuongTrinh.length === 0) {
    return (
      <p data-rong="chuong-trinh" className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
        Đối tác chưa tham gia campaign nào. Ghi danh ở mục bên dưới (đối tác phải đang hoạt động).
      </p>
    );
  }
  return (
    <ul aria-label="Chương trình đối tác tham gia" className="space-y-3">
      {chuongTrinh.map((c) => {
        const dong: DongMembershipView = {
          id: c.membershipId,
          doiTac,
          status: c.trangThai,
          groupLabel: c.nhom,
          effectiveFrom: c.tu,
          effectiveTo: c.den,
          approvedAt: null,
          capNhatLuc: c.capNhatLuc,
        };
        return (
          <li key={c.membershipId} data-chuong-trinh={c.campaign.ma} className="rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 break-words text-sm font-semibold text-foreground">
                <Link href={`/nguon-hoa-hong/campaign/${encodeURIComponent(c.campaign.ma)}`} className="rounded text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  {c.campaign.ten}
                </Link>{" "}
                <span className="font-mono text-xs font-normal text-muted-foreground">{c.campaign.ma}</span>
                <span className="ml-2 text-xs font-normal text-muted-foreground">campaign {NHAN_TRANG_THAI_CAMPAIGN[c.campaign.trangThai].toLowerCase()}</span>
              </p>
              <StatusPill tone={TONE[c.trangThai]} className={INK_THEO_TONE[TONE[c.trangThai]]}>
                {NHAN_TRANG_THAI_MEMBERSHIP[c.trangThai]}
              </StatusPill>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Hiệu lực từ {ngayVN(c.tu)}
              {c.den ? ` đến ${ngayVN(c.den)}` : " (không giới hạn)"}
              {c.nhom ? ` · nhóm ${c.nhom}` : ""}
            </p>
            {c.trangThai !== "ENDED" && (
              <div className="mt-2">
                <p className="text-xs text-muted-foreground">Nguồn khách của đối tác trong campaign này:</p>
                <NguonXemTruoc ketQua={c.nguon} />
              </div>
            )}
            {coTheThanhVien && (
              <div className="mt-3 flex justify-end">
                <NutMembership dong={dong} campaignStatus={c.campaign.trangThai} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
