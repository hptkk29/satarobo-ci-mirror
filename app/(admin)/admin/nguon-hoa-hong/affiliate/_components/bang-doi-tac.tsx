// app/(admin)/admin/nguon-hoa-hong/affiliate/_components/bang-doi-tac.tsx — BẢNG ĐỐI TÁC của tab Affiliate: tên · loại · nhãn · trạng thái · chương trình · lead · đã chốt · mã ?ref= (+ sao chép link) · thao tác.
//
// ── Cột nói thật (luật 12) ────────────────────────────────────────────────────────────────────────────────
//  · KHÔNG có cột Link/Referral/Hoa hồng: chúng chưa tồn tại (AFF-P1/P2) — vẽ cột chưa có là lời hứa suông.
//  · «Lead» / «Đã chốt» đếm qua `scopedDb` ⇒ người cấp cơ sở chỉ đếm lead cơ sở mình. `phamViLead === "GIOI_HAN"` thì tiêu đề cột và dòng chú thích dưới bảng NÓI RÕ con số bị cắt.
//  · «Chương trình» = số membership ĐANG HOẠT ĐỘNG (không phải số từng tham gia).
//  · SĐT/email dưới tên đã được CHE ở tầng đọc nếu người xem không có `affiliates:manage`; bảng không biết bản thật.
//  · Nút «Link» (AFF-WEB) chỉ có với đối tác ĐANG HOẠT ĐỘNG và người xem có `affiliate_links:manage` (`coTheLink` — URL cuối mang token nên che ở tầng đọc): có link dùng được ⇒ sao chép URL CUỐI của link đó;
//    chưa có ⇒ nút dẫn sang tab «Link / QR / Mã» (chỉ khi đối tác có chương trình đang chạy — không có thì tab đó cũng không phát được). KHÔNG dựng link `?ref=` từ một tên miền cứng. Mã bị khoá (đã có lead) hiện ổ khoá.
//  · Cột Thao tác (Sửa · Đổi trạng thái) chỉ có khi `coTheGhi` (= `affiliates:manage`, đúng khoá mà action kiểm); đối tác ĐÃ KẾT THÚC không có nút nào (hồ sơ đóng).
//  · Không có nút xoá: kết thúc đối tác không xoá lead / attribution / sổ.
// Server component; chỉ các nút (client) xuống trình duyệt. Vỏ bảng: vùng cuộn ngang là div CON (không trùng thẻ bo góc); `w-full` đi cùng `min-w`.
import Link from "next/link";
import { Lock, Pencil } from "lucide-react";
import { NhanDanhMuc } from "./nhan-danh-muc";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { DoiTacSheet } from "@/components/admin/nguon-hoa-hong/affiliate/doi-tac-sheet";
import { NutDoiTrangThaiDoiTac } from "@/components/admin/nguon-hoa-hong/affiliate/doi-trang-thai-doi-tac";
import { SaoChepLink } from "@/components/admin/nguon-hoa-hong/affiliate/sao-chep-link";
import { TrangThaiDoiTacPill } from "@/components/admin/nguon-hoa-hong/affiliate/trang-thai-doi-tac-pill";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import type { DongDoiTac, PhamViLead, TuyChonDoiTac } from "@/lib/affiliate/doc-doi-tac";
import type { LinkDangDung } from "@/lib/affiliate/doc-link";
import { NHAN_KIEU_DOI_TAC } from "@/lib/affiliate/ghi-doi-tac-dau-vao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");
/** Nhãn tối đa hiển thị trong ô; phần còn lại gộp «+N» (tên đầy đủ ở `title`). */
const NHAN_TOI_DA_TRONG_O = 2;

export function BangDoiTac({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
  phamViLead,
  coTheGhi,
  coTheLink,
  linkDangDung,
  tuyChon,
}: {
  dong: DongDoiTac[];
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Địa chỉ của một trang — page dựng (giữ bộ lọc), bảng không biết bộ lọc. */
  hrefTrang: (trang: number) => string;
  phamViLead: PhamViLead;
  /** Người xem được GHI không (`scope.has("affiliates:manage")`). Page tính, bảng không đoán (luật 7: bắt buộc). */
  coTheGhi: boolean;
  /** Người xem được PHÁT / xem link đầy đủ không (`scope.has("affiliate_links:manage")`). Page tính, bảng không đoán (luật 7: bắt buộc). */
  coTheLink: boolean;
  /** Link đang dùng được của từng đối tác (theo id) — Rỗng khi `!coTheLink` (che ở tầng đọc). Bắt buộc (luật 11): quên truyền ⇒ nút «Link» biến mất, y hệt lỗi phân quyền. */
  linkDangDung: Readonly<Record<string, LinkDangDung>>;
  /** Tuỳ chọn cho biểu mẫu sửa. Chỉ có khi `coTheGhi`. */
  tuyChon: TuyChonDoiTac | null;
}) {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = tong === 0 ? 0 : (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  const tieuDeLead = phamViLead === "GIOI_HAN" ? "Lead (trong phạm vi bạn xem)" : "Lead";
  return (
    <>
      <div className={VO_BANG}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Đối tác
                </th>
                <th scope="col" className={TH}>
                  Loại
                </th>
                <th scope="col" className={TH}>
                  Nhãn
                </th>
                <th scope="col" className={TH}>
                  Trạng thái
                </th>
                <th scope="col" title="Số chương trình (campaign) đối tác đang tham gia" className={cn(TH, "text-right")}>
                  Chương trình
                </th>
                <th scope="col" title={tieuDeLead} className={cn(TH, "text-right")}>
                  Lead{phamViLead === "GIOI_HAN" ? "*" : ""}
                </th>
                <th scope="col" title="Lead đã chốt (đã đăng ký học)" className={cn(TH, "text-right")}>
                  Đã chốt{phamViLead === "GIOI_HAN" ? "*" : ""}
                </th>
                <th scope="col" className={TH}>
                  Mã giới thiệu
                </th>
                {coTheGhi && (
                  <th scope="col" className={cn(TH, "text-right")}>
                    Thao tác
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => {
                const lienHe = [d.dienThoai, d.email].filter(Boolean).join(" · ");
                // Dòng phụ dưới tên: cắt bằng `truncate` nên PHẢI có `title` mang đủ chữ (lớp phủ/cắt chữ không có cách nào khác để đọc tên tổ chức, nhân viên, liên hệ dài).
                const phu = [
                  NHAN_KIEU_DOI_TAC[d.kieu],
                  d.toChuc ? `thuộc ${d.toChuc.ten}` : null,
                  d.kieu === "ORGANIZATION" && d.soThanhVien > 0 ? `${soVN(d.soThanhVien)} thành viên` : null,
                  d.nhanVien ? `nhân viên ${d.nhanVien.ten}` : null,
                  lienHe || null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const dangHoatDong = d.trangThai === "ACTIVE";
                return (
                  <tr key={d.id} className={cn(adminTr, "relative cursor-pointer")}>
                    <td className={cn(TD, "max-w-[16rem]")}>
                      {/* Cả dòng là vùng bấm (luật 12): liên kết tên mang `after:inset-0`; các nút trong dòng nổi lên bằng `relative z-10`. */}
                      <Link href={`/nguon-hoa-hong/affiliate/${encodeURIComponent(d.id)}`} title={d.ten} className="block truncate font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0">
                        {d.ten}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground" title={phu}>
                        {phu}
                      </span>
                    </td>
                    <td className={TD}>
                      {d.loai ? (
                        <span className={d.loai.dangDung ? "text-foreground" : "text-muted-foreground"} title={d.loai.dangDung ? undefined : "Loại này đã ngừng — đối tác cũ vẫn giữ"}>
                          {d.loai.ten}
                          {d.loai.dangDung ? "" : " (đã ngừng)"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Chưa có loại</span>
                      )}
                    </td>
                    <td className={cn(TD, "max-w-[14rem]")}>
                      <NhanDanhMuc nhan={d.nhan} toiDa={NHAN_TOI_DA_TRONG_O} />
                    </td>
                    <td className={TD}>
                      <TrangThaiDoiTacPill trangThai={d.trangThai} />
                    </td>
                    <td className={cn(TD, "text-right tabular-nums")}>{soVN(d.soChuongTrinh)}</td>
                    <td className={cn(TD, "text-right tabular-nums")}>{soVN(d.soLead)}</td>
                    <td className={cn(TD, "text-right tabular-nums font-semibold text-state-success-ink")}>{soVN(d.soLeadDaChot)}</td>
                    <td className={TD}>
                      <span className="inline-flex items-center gap-2">
                        <span className="font-mono font-semibold text-foreground">{d.ma}</span>
                        {d.maDaKhoa && (
                          <span title="Mã đã có lead — không đổi được (đổi mã làm chết link đã in)">
                            <Lock role="img" aria-label="Mã đã khoá" className="h-3.5 w-3.5 text-muted-foreground" />
                          </span>
                        )}
                        {dangHoatDong && coTheLink && (
                          <span className="relative z-10">
                            <SaoChepLink
                              tenDoiTac={d.ten}
                              urlCuoi={linkDangDung[d.id]?.urlCuoi ?? null}
                              hrefTao={d.soChuongTrinh > 0 ? `/nguon-hoa-hong/link?doitac=${encodeURIComponent(d.ma)}` : null}
                            />
                          </span>
                        )}
                      </span>
                    </td>
                    {coTheGhi && (
                      <td className={cn(TD, "sticky right-0 z-10 bg-card text-right md:relative md:bg-transparent")}>
                        {d.trangThai === "ENDED" || !tuyChon ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <span className="relative z-10 inline-flex items-center justify-end gap-2">
                            <DoiTacSheet
                              dong={d}
                              tuyChon={tuyChon}
                              coTheTaoLink={coTheLink}
                              triggerAriaLabel={`Sửa đối tác ${d.ten}`}
                              triggerClassName="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8"
                            >
                              <Pencil aria-hidden className="h-3.5 w-3.5" />
                            </DoiTacSheet>
                            <NutDoiTrangThaiDoiTac
                              doiTac={{ id: d.id, ten: d.ten, trangThai: d.trangThai, loaiCanDuyet: d.loai ? d.loai.canDuyet : null, capNhatLuc: d.capNhatLuc }}
                              bieuTuong
                            />
                          </span>
                        )}
                      </td>
                    )}
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
          / {soVN(tong)} đối tác
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
      {phamViLead === "GIOI_HAN" && (
        <p className="mt-3 text-xs text-muted-foreground">
          * Số lead đếm trong các cơ sở bạn được xem; lead của cơ sở khác không nằm trong con số này.
        </p>
      )}
    </>
  );
}
