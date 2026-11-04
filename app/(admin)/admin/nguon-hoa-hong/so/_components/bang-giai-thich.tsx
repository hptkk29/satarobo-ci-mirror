// app/(admin)/admin/nguon-hoa-hong/so/_components/bang-giai-thich.tsx — góc nhìn «Không đủ điều kiện» của tab Sổ (Hướng G): các khoản mà vai có chính sách nhưng KHÔNG phát sinh tiền.
//
// Cùng khuôn với `bang-so.tsx` (bảng dày, RSC, cả dòng là vùng bấm — luật 12: nút ở ô cuối neo `after:inset-0` vào `<tr relative>`), nhưng KHÁC ở ba điểm cố ý:
//   · đây KHÔNG phải sổ: không "Tổng hoa hồng", không trạng thái chi — cột tiền nói «0đ» (chữ mờ) và «Lẽ ra X» ở dòng phụ, vì «lẽ ra» không phải khoản nợ;
//   · «Không đủ điều kiện» là kết quả BÌNH THƯỜNG của luật cửa sổ ⇒ chip TRUNG TÍNH, không đỏ/cam, và lý do ngắn («Quá hạn 9 ngày») nằm ngay dưới;
//   · không có nút khiếu nại: không có dòng sổ nào để khiếu nại.
// Màn hẹp (< xl, 1280px): chỉ còn Người hưởng (kèm vai · kỳ) · Hoa hồng · chevron; phần còn lại nằm trong ngăn.
import { ChevronRight } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { GiaiThichSheet } from "@/components/admin/nguon-hoa-hong/giai-thich-sheet";
import { ChipKhongDuDieuKien } from "@/components/admin/nguon-hoa-hong/giai-thich-noi-dung";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { TbodyDieuHuong } from "@/components/admin/nguon-hoa-hong/tbody-dieu-huong";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import { kyHienThi } from "@/lib/hoa-hong/dinh-dang";
import type { DongGiaiThichTrang } from "@/lib/hoa-hong/giai-thich-doc";
import { lyDoNgan } from "@/lib/hoa-hong/giai-thich-khong-tien";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-2");
const TD = cn(adminTd, "px-2 py-2");
const TU_XL = "hidden xl:table-cell"; // 7 cột cần ~968px: dưới 1280px giữ bản gọn (Người · Hoa hồng) để «0đ / lẽ ra» không nằm ngoài vùng nhìn
/** "Người phụ trách nguồn (…)" → bỏ phần ngoặc: ô hẹp không đủ chỗ; tên đầy đủ nằm ở `title` và trong ngăn. */
const tenVaiNgan = (ten: string): string => ten.replace(/\s*\([^)]*\)\s*$/, "") || ten;

export function BangGiaiThich({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
}: {
  dong: DongGiaiThichTrang[];
  tong: number;
  trang: number;
  kichThuoc: number;
  hrefTrang: (trang: number) => string;
}) {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = tong === 0 ? 0 : (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  return (
    <>
      <div className={VO_BANG}>
        <div className="relative overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-left xl:min-w-[968px]">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={cn(TH, TU_XL, "w-[4.5rem]")}>
                  Kỳ
                </th>
                <th scope="col" className={cn(TH, "sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]")} title="Người lẽ ra được hưởng nếu khoản đủ điều kiện">
                  Người hưởng dự kiến
                </th>
                <th scope="col" className={cn(TH, TU_XL, "w-[8rem]")}>
                  Học viên
                </th>
                <th scope="col" className={cn(TH, TU_XL, "w-[8.5rem]")} title="Nguồn của khoản thu và chính sách (văn bản · phiên bản) đã chụp lúc tính">
                  Nguồn
                </th>
                <th scope="col" className={cn(TH, TU_XL, "w-[9.5rem]")}>
                  Điều kiện
                </th>
                <th scope="col" className={cn(TH, "w-[7.5rem] text-right")} title="Hoa hồng thực tế là 0đ; «Lẽ ra» là số tiền nếu khoản đủ điều kiện (không phải khoản nợ)">
                  Hoa hồng
                </th>
                <th scope="col" aria-label="Xem vì sao" className={cn(TH, "w-8")} />
              </tr>
            </thead>
            <TbodyDieuHuong>
              {dong.map((d) => {
                const chinhSach = `${d.documentNumber} v${d.versionNo}`;
                const ten = d.nguoiHuong?.ten ?? "Chưa rõ người";
                const tieuDe = [ten, d.tenVai, d.tenHocVien, d.tenNhom, chinhSach].filter(Boolean).join(" · ");
                return (
                  <tr key={d.id} className={cn(adminTr, "group relative h-14 cursor-pointer")}>
                    <td className={cn(TD, TU_XL, "tabular-nums")}>{kyHienThi(d.naturalPeriod)}</td>
                    <td className={cn(TD, "sticky left-0 z-10 bg-card group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]")}>
                      <span className="block truncate font-medium">{ten}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        <span className="xl:hidden">{kyHienThi(d.naturalPeriod)} · </span>
                        {tenVaiNgan(d.tenVai)}
                      </span>
                    </td>
                    <td className={cn(TD, TU_XL, "truncate")}>{d.tenHocVien ?? <span className="text-muted-foreground">—</span>}</td>
                    <td className={cn(TD, TU_XL)}>
                      <span className="block truncate">{d.tenNhom}</span>
                      <span className="block truncate text-xs text-muted-foreground">{chinhSach}</span>
                    </td>
                    <td className={cn(TD, TU_XL)}>
                      <ChipKhongDuDieuKien />
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{d.daCoTien ? "Đã được thay thế" : lyDoNgan(d.reasonCode, d.chiTiet)}</span>
                    </td>
                    <td className={cn(TD, "text-right")}>
                      <span className="block tabular-nums text-muted-foreground">0đ</span>
                      <span className="block whitespace-nowrap text-xs tabular-nums text-muted-foreground">Lẽ ra {dinhDangDong(d.wouldBeAmount)}</span>
                    </td>
                    <td className={cn(TD, "w-8 text-muted-foreground")}>
                      <GiaiThichSheet
                        id={d.id}
                        moTa={`${ten} · ${d.tenVai}`}
                        dieuHuongHang
                        triggerAriaLabel={`Xem vì sao ${ten} không có hoa hồng, lẽ ra ${dinhDangDong(d.wouldBeAmount)}`}
                        title={tieuDe}
                        triggerClassName="flex h-6 w-6 items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0 after:z-20 after:content-['']"
                      >
                        <ChevronRight aria-hidden className="h-4 w-4" />
                      </GiaiThichSheet>
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
          / {soVN(tong)} khoản
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
    </>
  );
}
