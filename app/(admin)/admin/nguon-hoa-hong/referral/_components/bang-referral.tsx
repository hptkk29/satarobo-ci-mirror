// app/(admin)/admin/nguon-hoa-hong/referral/_components/bang-referral.tsx — DANH SÁCH REFERRAL: bảng dày, dòng 44px, mỗi dòng mở trang chi tiết.
//
// Cả dòng là vùng bấm (luật 12): `<tr relative cursor-pointer>` + liên kết ở ô «Thời điểm» mang `after:inset-0`. Không có mũi tên/chevron trơ.
// Phân trang PHÍA SERVER (25 dòng/trang, `docDanhSachReferral` cắt bằng skip/take) + `DieuHuongTrangLink`.
//
// PII: bảng KHÔNG nhận và KHÔNG vẽ tên/SĐT/email của khách. Cột «Phiếu khách» chỉ có mã rút gọn; nó là LIÊN KẾT chỉ khi người xem mở được phiếu (`phieu.leadId` do máy chủ quyết — null ⇒ chỉ in mã).
// Liên kết phiếu nằm TRÊN lớp phủ của dòng (`relative z-10`) để bấm vào nó mở phiếu chứ không mở chi tiết referral.
//
// Cột «Nguồn đã giải» nói thật: lượt không có bậc quyết định nguồn thì in «Chưa quy được nguồn» (cột trong DB là NOT NULL nên mang nhóm «Không xác định» làm chỗ giữ — đó không phải nguồn đã giải).
// Server component thuần: không JS nào xuống trình duyệt cho một bảng chỉ-đọc.
import Link from "next/link";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { TrangThaiReferralPill } from "@/components/admin/nguon-hoa-hong/referral/trang-thai-referral-pill";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { NHAN_CACH_DEN_REFERRAL, thoiDiemHienThi, type DongReferral } from "@/lib/affiliate/ghi-referral-dau-vao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");
const PHU_LG = "hidden lg:table-cell";
const PHU_XL = "hidden xl:table-cell";

export const CHU_CHUA_QUY_NGUON = "Chưa quy được nguồn";

export function PhieuKhach({ phieu }: { phieu: DongReferral["phieu"] }) {
  if (!phieu.coPhieu || phieu.maRutGon === null) return <span className="text-muted-foreground">Chưa gắn phiếu</span>;
  if (phieu.leadId !== null) {
    return (
      <Link
        href={`/leads/${encodeURIComponent(phieu.leadId)}`}
        aria-label={`Mở phiếu khách ${phieu.maRutGon}`}
        className="relative z-10 font-mono text-xs font-medium text-primary-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        #{phieu.maRutGon}
      </Link>
    );
  }
  return (
    <span className="font-mono text-xs text-muted-foreground" title="Bạn không mở được phiếu khách này (thiếu quyền xem khách, hoặc phiếu ngoài cơ sở của bạn).">
      #{phieu.maRutGon}
    </span>
  );
}

export function BangReferral({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
}: {
  dong: readonly DongReferral[];
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Địa chỉ của một trang — page dựng (giữ bộ lọc trạng thái), bảng không biết bộ lọc. */
  hrefTrang: (trang: number) => string;
}) {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = tong === 0 ? 0 : (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  return (
    <>
      <div className={VO_BANG}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left lg:min-w-[860px]">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Thời điểm
                </th>
                <th scope="col" className={TH}>
                  Đối tác
                </th>
                <th scope="col" className={cn(TH, PHU_LG)}>
                  Campaign
                </th>
                <th scope="col" className={cn(TH, PHU_LG)} title="Nhóm nguồn mà cấu hình campaign giải ra cho đối tác này lúc ghi nhận. Với lượt không Hợp lệ, đó không nhất thiết là nguồn cuối cùng của khách.">
                  Nguồn đã giải
                </th>
                <th scope="col" className={cn(TH, PHU_XL)}>
                  Cách đến
                </th>
                <th scope="col" className={TH}>
                  Trạng thái
                </th>
                <th scope="col" className={cn(TH, PHU_LG)}>
                  Lý do / ghi chú
                </th>
                <th scope="col" className={TH}>
                  Phiếu khách
                </th>
              </tr>
            </thead>
            <tbody>
              {dong.map((r) => (
                <tr key={r.id} className={cn(adminTr, "relative cursor-pointer")}>
                  <td className={cn(TD, "tabular-nums")}>
                    <Link
                      href={`/nguon-hoa-hong/referral/${encodeURIComponent(r.id)}`}
                      aria-label={`Xem chi tiết referral lúc ${thoiDiemHienThi(r.luc)}`}
                      className="block font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0"
                    >
                      {thoiDiemHienThi(r.luc)}
                    </Link>
                  </td>
                  <td className={cn(TD, "max-w-[14rem]")}>
                    <span className="block truncate font-medium text-foreground">{r.doiTac.ten}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{r.doiTac.ma}</span>
                  </td>
                  <td className={cn(TD, PHU_LG, "max-w-[14rem]")}>
                    <span className="block truncate text-foreground">{r.campaign.ten}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{r.campaign.ma}</span>
                  </td>
                  <td className={cn(TD, PHU_LG, "max-w-[12rem]")}>
                    {r.nguon !== null ? <span className="block truncate text-foreground">{r.nguon}</span> : <span className="block truncate text-muted-foreground">{CHU_CHUA_QUY_NGUON}</span>}
                  </td>
                  <td className={cn(TD, PHU_XL)}>{NHAN_CACH_DEN_REFERRAL[r.cachDen]}</td>
                  <td className={TD}>
                    <TrangThaiReferralPill trangThai={r.trangThai} />
                  </td>
                  <td className={cn(TD, PHU_LG, "max-w-[16rem]")}>
                    <span className={cn("block truncate", r.lyDo.dang === "TRONG" ? "text-muted-foreground" : "text-foreground")} title={r.lyDo.day}>
                      {r.lyDo.ngan}
                    </span>
                  </td>
                  <td className={TD}>
                    <PhieuKhach phieu={r.phieu} />
                  </td>
                </tr>
              ))}
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
          / {soVN(tong)} lượt
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
    </>
  );
}
