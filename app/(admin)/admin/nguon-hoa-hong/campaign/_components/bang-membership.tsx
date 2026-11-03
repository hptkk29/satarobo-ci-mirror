// app/(admin)/admin/nguon-hoa-hong/campaign/_components/bang-membership.tsx — DANH SÁCH THÀNH VIÊN (đối tác trong campaign) ở trang chi tiết campaign.
//
// Phân trang PHÍA SERVER (`docMembership` cắt skip/take SAU khi lọc trạng thái trên URL) + `DieuHuongTrangLink`. Chỉ hiện tên · mã · loại đối tác — KHÔNG SĐT / email.
//
// Cột «Thao tác» chỉ có khi `coTheGhi` (người xem có `affiliate_memberships:manage` — đúng khoá mà các action thành viên kiểm). Mỗi nút lấy từ `thaoTacKhaDung`
// (xem `nut-membership.tsx`) nên thao tác chắc chắn bị từ chối không có nút. Dòng không có chevron/mũi tên: không có gì để «mở».
//
// Server component; phần tương tác (hộp thoại lý do, sửa) là client component `NutMembership`.
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { NHAN_LOAI_DOI_TAC, ngayHienThi, soVN } from "@/components/admin/nguon-hoa-hong/campaign/nhan-campaign";
import { NutMembership } from "@/components/admin/nguon-hoa-hong/campaign/nut-membership";
import { TrangThaiMembershipPill } from "@/components/admin/nguon-hoa-hong/campaign/trang-thai-pill";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import type { DongMembershipView, TrangThaiCampaign } from "@/lib/affiliate/ghi-campaign-dau-vao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

export function BangMembership({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
  campaignStatus,
  coTheGhi,
  dangLoc,
}: {
  dong: readonly DongMembershipView[];
  tong: number;
  trang: number;
  kichThuoc: number;
  hrefTrang: (trang: number) => string;
  campaignStatus: TrangThaiCampaign;
  /** Người xem có `affiliate_memberships:manage` không. BẮT BUỘC (luật 7). */
  coTheGhi: boolean;
  /** Đang lọc theo một trạng thái — để câu rỗng nói đúng. */
  dangLoc: boolean;
}) {
  if (dong.length === 0) {
    return (
      <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
        {dangLoc ? "Không có đối tác nào ở trạng thái này." : "Chưa có đối tác nào trong campaign này."}
        {!dangLoc && coTheGhi && campaignStatus !== "ENDED" ? " Thêm đối tác ở form bên trên." : ""}
      </p>
    );
  }
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  return (
    <>
      <div className={VO_BANG}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Đối tác
                </th>
                <th scope="col" className={TH}>
                  Trạng thái
                </th>
                <th scope="col" className={TH}>
                  Nhóm
                </th>
                <th scope="col" className={TH}>
                  Hiệu lực
                </th>
                {coTheGhi && (
                  <th scope="col" className={cn(TH, "text-right")}>
                    Thao tác
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {dong.map((m) => (
                <tr key={m.id} className={adminTr}>
                  <td className={cn(TD, "max-w-[16rem]")}>
                    <span className="block truncate font-medium">{m.doiTac.ten}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="font-mono">{m.doiTac.code}</span> · {NHAN_LOAI_DOI_TAC[m.doiTac.kind]}
                      {m.doiTac.loai ? ` · ${m.doiTac.loai}` : ""}
                      {m.doiTac.status !== "ACTIVE" ? " · đối tác không hoạt động" : ""}
                    </span>
                  </td>
                  <td className={TD}>
                    <TrangThaiMembershipPill status={m.status} />
                    {m.approvedAt && m.status !== "PENDING" && <span className="mt-0.5 block text-xs text-muted-foreground">Duyệt {ngayHienThi(m.approvedAt)}</span>}
                  </td>
                  <td className={cn(TD, "max-w-[10rem] truncate text-muted-foreground")}>{m.groupLabel ?? "—"}</td>
                  <td className={TD}>
                    {ngayHienThi(m.effectiveFrom)} – {m.effectiveTo ? ngayHienThi(m.effectiveTo) : "không giới hạn"}
                  </td>
                  {coTheGhi && (
                    <td className={cn(TD, "whitespace-normal text-right")}>
                      <NutMembership dong={m} campaignStatus={campaignStatus} />
                    </td>
                  )}
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
          / {soVN(tong)} đối tác
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
    </>
  );
}
