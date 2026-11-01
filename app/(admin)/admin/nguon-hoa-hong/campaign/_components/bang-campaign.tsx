// app/(admin)/admin/nguon-hoa-hong/campaign/_components/bang-campaign.tsx — DANH SÁCH CAMPAIGN Affiliate: bảng dày, dòng 44px, mỗi dòng mở trang chi tiết campaign.
//
// Cả dòng là vùng bấm (luật 12): `<tr relative cursor-pointer>` + liên kết tên campaign mang `after:inset-0`. Không có mũi tên/chevron trơ.
// Phân trang PHÍA SERVER (25 campaign/trang, `docDanhSachCampaign` cắt bằng skip/take sau khi lọc trạng thái trên URL) + `DieuHuongTrangLink`.
//
// Cột nói thật: «Đối tác» là số thành viên ĐANG THAM GIA (ACTIVE), không phải mọi dòng thành viên; «Hiệu lực» thêm nhãn «Đã hết hạn» / «Chưa bắt đầu» tính từ `now` của trang.
// Mô hình SPLIT ghi rõ «cần chính sách riêng — chưa dùng được» ngay trong bảng (campaign đó không kích hoạt được).
//
// Server component thuần: không JS nào xuống trình duyệt cho một bảng chỉ-đọc. Bọc cuộn ngang ở div CON (vùng cuộn không trùng thẻ bo góc — luật vỏ bảng 06/09).
import Link from "next/link";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { NHAN_LUU_Y_HIEU_LUC, nhanHieuLuc, soVN } from "@/components/admin/nguon-hoa-hong/campaign/nhan-campaign";
import { TrangThaiCampaignPill } from "@/components/admin/nguon-hoa-hong/campaign/trang-thai-pill";
import { INK_THEO_TONE } from "@/components/admin/nguon-hoa-hong/trang-thai-nguon-pill";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { MO_TA_MO_HINH, NHAN_MO_HINH, moHinhKichHoatDuoc, type DongCampaignView } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");
const PHU_LG = "hidden lg:table-cell";

export function BangCampaign({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
  now,
}: {
  dong: readonly DongCampaignView[];
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Địa chỉ của một trang — page dựng (giữ bộ lọc trạng thái), bảng không biết bộ lọc. */
  hrefTrang: (trang: number) => string;
  now: Date;
}) {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = tong === 0 ? 0 : (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  return (
    <>
      <div className={VO_BANG}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Campaign
                </th>
                <th scope="col" className={TH}>
                  Trạng thái
                </th>
                <th scope="col" className={cn(TH, PHU_LG)}>
                  Mô hình ghi nhận
                </th>
                <th scope="col" className={TH}>
                  Hiệu lực
                </th>
                <th scope="col" className={cn(TH, "text-right")} title="Số đối tác đang tham gia (không tính chờ duyệt, tạm ngừng, đã kết thúc)">
                  Đối tác
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Website
                </th>
              </tr>
            </thead>
            <tbody>
              {dong.map((c) => {
                const hl = nhanHieuLuc(c.effectiveFrom, c.effectiveTo, now);
                return (
                  <tr key={c.id} className={cn(adminTr, "relative cursor-pointer")}>
                    <td className={cn(TD, "max-w-[16rem]")}>
                      <Link href={`/nguon-hoa-hong/campaign/${encodeURIComponent(c.code)}`} className="block truncate font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0">
                        {c.name}
                      </Link>
                      <span className="block truncate font-mono text-xs text-muted-foreground">{c.code}</span>
                    </td>
                    <td className={TD}>
                      <TrangThaiCampaignPill status={c.status} />
                    </td>
                    <td className={cn(TD, PHU_LG, "max-w-[14rem]")}>
                      <span className="block truncate text-foreground">{NHAN_MO_HINH[c.attributionModel]}</span>
                      {!moHinhKichHoatDuoc(c.attributionModel) && <span className="block truncate text-xs text-state-warning-ink">{MO_TA_MO_HINH[c.attributionModel]}</span>}
                    </td>
                    <td className={TD}>
                      <span className="block">{hl.chu}</span>
                      {hl.luuY && c.status !== "ENDED" && (
                        <StatusPill tone="warning" className={cn(INK_THEO_TONE.warning, "mt-0.5")}>
                          {NHAN_LUU_Y_HIEU_LUC[hl.luuY]}
                        </StatusPill>
                      )}
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>{soVN(c.soDoiTacHoatDong)}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{soVN(c.soWebsite)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Hiển thị{" "}
          <b className="tabular-nums text-foreground">
            {soVN(tu)}–{soVN(den)}
          </b>{" "}
          / {soVN(tong)} campaign
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
    </>
  );
}
