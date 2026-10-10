// app/(admin)/admin/nguon-hoa-hong/so/_components/bang-so.tsx — SỔ "Tất cả" (06 §5.3): bảng dày, table-first, RSC, phân trang + lọc Ở TẦNG TRUY VẤN.
//
// Mỗi dòng là một dòng SỔ BẤT BIẾN. Cả dòng là vùng bấm (luật 12): nút "Vì sao" nằm ở ô cuối với `after:inset-0 after:z-20` neo vào `<tr relative>`, phủ kín hàng KỂ CẢ ô
// "Người hưởng" đang `sticky` (ô dính là phần tử định vị nên một lớp phủ đặt TRONG nó sẽ chỉ phủ đúng ô đó — đó là lý do nút nằm ở ô không dính). Bấm mở ngăn "Vì sao".
// `title` nằm trên NÚT (phần tử trên cùng): lớp phủ che mọi `title` ở `<td>` bên dưới.
//
// Tiền: căn phải, `tabular-nums`, dòng âm in '−' và tô danger-ink; dòng điều chỉnh có mũi tên trỏ về dòng gốc. 9 chữ số không tràn (ô `whitespace-nowrap`).
// Thứ tự cột: brief §5.3 đặt Vai · Nguồn · Chính sách thành cột riêng; ở đây Vai nằm dưới tên người hưởng và Chính sách dưới Nguồn (xem "Bố cục chốt theo SỐ ĐO" bên dưới).
// Server component thuần cho bảng; chỉ nút Sheet + `<tbody>` nhận phím là client. Bọc cuộn ngang ở div CON (vùng cuộn không trùng thẻ bo góc).
import type { ReactNode } from "react";
import { ChevronRight, CornerDownRight } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { TrangThaiChiPill } from "@/components/admin/nguon-hoa-hong/commission-status-pill";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { TbodyDieuHuong } from "@/components/admin/nguon-hoa-hong/tbody-dieu-huong";
import { TienDong } from "@/components/admin/nguon-hoa-hong/vi-sao-noi-dung";
import { ViSaoSheet } from "@/components/admin/nguon-hoa-hong/vi-sao-sheet";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import type { DongSoTrang } from "@/lib/hoa-hong/doc-so-giao-dien";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";
import { dinhDangDong, phanTram } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

// Bố cục chốt theo SỐ ĐO (chụp thật 1280px, khung nội dung ~976px): 12 cột một dòng rộng ~1500px nên cột TIỀN (Hoa hồng) nằm ngoài màn đầu — thứ người ta mở sổ để xem.
// Nay: 10 cột, hai dòng ở ba ô (Người hưởng·Vai, Kỳ·kỳ hiệu lực, Nguồn·Chính sách), `px-2` + `table-fixed` ⇒ tổng đúng 968px, KHÔNG cuộn ngang ở 1280.
// Dưới `md` (điện thoại) chỉ còn Người hưởng (kèm vai · kỳ) · Hoa hồng · chevron; phần còn lại nằm trong ngăn "Vì sao". Tablet: cuộn ngang, cột Người hưởng ghim trái.
const TH = cn(adminTh, "px-2");
const TD = cn(adminTd, "px-2 py-2");
/** Cột chỉ từ `md` trở lên (điện thoại bỏ — xem đầu tệp). */
const TU_MD = "hidden md:table-cell";

/** Nhãn NGẮN cho loại dòng khác `ORIGINAL` — ô "Loại GD" chỉ rộng ~7rem. Nhãn đầy đủ nằm trong ngăn "Vì sao". */
const NHAN_KIND_NGAN: Record<string, string> = {
  LATE_ARRIVAL: "Đến muộn",
  REVERSAL: "Thu hồi",
  SOURCE_CORRECTION: "Đổi nguồn",
  INPUT_CORRECTION: "Điều chỉnh",
  DISPUTE_ADJUSTMENT: "Khiếu nại",
  LEGACY_REVERSAL: "Thu hồi sổ cũ",
  PERIOD_BONUS: "Thưởng bậc",
};
const NHAN_LOAI_GD: Record<string, string> = { NEW: "Mới", RENEWAL: "Tái tục" };

/** "Sale (người chốt đơn)" → "Sale": phần chú thích trong ngoặc làm nhãn loại + vai không vừa một dòng của ô hẹp; tên đầy đủ nằm ở `title` của nút và trong ngăn "Vì sao". */
const tenVaiNgan = (ten: string): string => ten.replace(/\s*\([^)]*\)\s*$/, "") || ten;

/** "2026-10" → "10/2026". */

export function BangSo({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
  hanhDong,
}: {
  dong: DongSoTrang[];
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Địa chỉ của một trang — page dựng (giữ mọi bộ lọc), bảng không biết bộ lọc. */
  hrefTrang: (trang: number) => string;
  /** Chỗ neo hành động theo dòng ở chân ngăn "Vì sao" (track Khiếu nại cắm vào đây). Không truyền ⇒ ngăn không có chân. */
  hanhDong?: (d: DongSoTrang) => ReactNode;
}) {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = tong === 0 ? 0 : (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  return (
    <>
      <div className={VO_BANG}>
        <div className="relative overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-left md:min-w-[968px]">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={cn(TH, TU_MD, "w-[4.5rem]")}>
                  Kỳ
                </th>
                <th scope="col" className={cn(TH, "sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]")}>
                  Người hưởng
                </th>
                <th scope="col" className={cn(TH, TU_MD, "w-[8rem]")}>
                  Học viên
                </th>
                <th scope="col" className={cn(TH, TU_MD, "w-[7.5rem]")} title="Nguồn của khoản thu và chính sách (văn bản · phiên bản) đã áp dụng">
                  Nguồn
                </th>
                <th scope="col" className={cn(TH, TU_MD, "w-[4.5rem]")}>
                  Loại GD
                </th>
                <th scope="col" className={cn(TH, TU_MD, "w-[7rem] text-right")}>
                  Tiền gốc
                </th>
                <th scope="col" className={cn(TH, TU_MD, "w-[3.5rem] text-right")}>
                  Tỷ lệ
                </th>
                <th scope="col" className={cn(TH, "w-[7rem] text-right")}>
                  Hoa hồng
                </th>
                <th scope="col" className={cn(TH, TU_MD, "w-[6rem]")}>
                  Trạng thái
                </th>
                <th scope="col" aria-label="Xem vì sao" className={cn(TH, "w-8")} />
              </tr>
            </thead>
            <TbodyDieuHuong>
              {dong.map((d) => {
                const laDieuChinh = d.refEntryId !== null;
                const nhanKind = NHAN_KIND_NGAN[d.kind];
                const chinhSach = d.vanBan ? `${d.vanBan}${d.versionNo ? ` v${d.versionNo}` : ""}` : null;
                const tieuDe = [d.nguoiHuong.ten, d.tenVai, d.tenHocVien, d.tenNhomNguon, chinhSach].filter(Boolean).join(" · ");
                return (
                  <tr key={d.id} className={cn(adminTr, "group relative h-14 cursor-pointer")}>
                    <td className={cn(TD, TU_MD, "tabular-nums")}>
                      {kyHienThi(d.kyGhi)}
                      {d.lateArrival && <span className="block text-xs text-muted-foreground">HL {kyHienThi(d.kyHieuLuc)}</span>}
                    </td>
                    <td className={cn(TD, "sticky left-0 z-10 bg-card group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]")}>
                      <span className="flex items-center gap-1.5">
                        {laDieuChinh && <CornerDownRight aria-label="Điều chỉnh của một dòng gốc" role="img" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className="truncate font-medium">{d.nguoiHuong.ten}</span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="md:hidden">{kyHienThi(d.kyGhi)} · </span>
                        {/* Nhãn loại dòng (Thu hồi · Đổi nguồn…) ĐỨNG TRƯỚC vai: ô hẹp bị cắt ở cuối, và đó là thứ phân biệt một dòng âm với dòng gốc. */}
                        {nhanKind && `${nhanKind} · `}
                        {tenVaiNgan(d.tenVai)}
                      </span>
                    </td>
                    <td className={cn(TD, TU_MD, "truncate")}>
                      {d.tenHocVien ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className={cn(TD, TU_MD)}>
                      <span className="block truncate">{d.nhomNguon === "UNKNOWN" ? "Chưa rõ nguồn" : d.tenNhomNguon}</span>
                      <span className="block truncate text-xs text-muted-foreground">{chinhSach ?? "—"}</span>
                    </td>
                    <td className={cn(TD, TU_MD)}>{NHAN_LOAI_GD[d.loaiGiaoDich] ?? d.loaiGiaoDich}</td>
                    <td className={cn(TD, TU_MD, "text-right")}>
                      <TienDong soTien={d.netBase} />
                    </td>
                    <td className={cn(TD, TU_MD, "text-right tabular-nums")}>{d.rate !== null ? phanTram(d.rate) : <span className="text-muted-foreground">—</span>}</td>
                    <td className={cn(TD, "text-right font-semibold")}>
                      <TienDong soTien={d.amount} />
                    </td>
                    <td className={cn(TD, TU_MD)}>
                      <TrangThaiChiPill trangThai={d.payoutStatus} ngan />
                    </td>
                    <td className={cn(TD, "w-8 text-muted-foreground")}>
                      <ViSaoSheet
                        entryId={d.id}
                        moTa={`${d.nguoiHuong.ten} · ${d.tenVai}`}
                        dieuHuongHang
                        hanhDong={hanhDong?.(d)}
                        triggerAriaLabel={`Xem vì sao ${dinhDangDong(d.amount)} của ${d.nguoiHuong.ten}`}
                        title={tieuDe}
                        triggerClassName="flex h-6 w-6 items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0 after:z-20 after:content-['']"
                      >
                        <ChevronRight aria-hidden className="h-4 w-4" />
                      </ViSaoSheet>
                    </td>
                  </tr>
                );
              })}
            </TbodyDieuHuong>
          </table>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Hiển thị{" "}
          <b className="tabular-nums text-foreground">
            {soVN(tu)}–{soVN(den)}
          </b>{" "}
          / {soVN(tong)} dòng
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
    </>
  );
}
