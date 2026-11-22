// app/(admin)/admin/nguon-hoa-hong/affiliate/_components/bang-loai.tsx — BẢNG LOẠI ĐỐI TÁC (chế độ `?xem=loai`): loại · nguồn mặc định · duyệt đối tác mới · số đối tác · số quy tắc campaign · trạng thái · thao tác.
//
// Cột nói thật (luật 12):
//  · «Đối tác» = số đối tác đang mang loại này (kể cả đã kết thúc); «Quy tắc» = số quy tắc campaign trỏ vào loại — hai con số này cho người bấm «Ngừng» biết mình đang động tới cái gì
//    (Ngừng KHÔNG đổi đối tác cũ, nhưng quy tắc campaign trỏ vào loại ngừng vẫn còn đó).
//  · Cột Thao tác chỉ có khi `coTheGhi` (= `affiliates:manage`, đúng khoá mà các action kiểm). Không có nút xoá: loại chỉ ngừng.
// Phân trang PHÍA SERVER (`DieuHuongTrangLink`), cùng khuôn các bảng khác của module. Vỏ bảng: vùng cuộn ngang là div CON; `w-full` đi cùng `min-w`.
import { Pencil } from "lucide-react";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { StatusPill } from "@/components/admin/ui/status-pill";
import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { NutBatTatDanhMuc } from "@/components/admin/nguon-hoa-hong/affiliate/bat-tat-danh-muc";
import { LoaiSheet } from "@/components/admin/nguon-hoa-hong/affiliate/loai-nhan-sheet";
import { INK_THEO_TONE } from "@/components/admin/nguon-hoa-hong/trang-thai-nguon-pill";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import type { DongLoai } from "@/lib/affiliate/doc-doi-tac";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

export function BangLoai({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
  coTheGhi,
  nguon,
}: {
  dong: DongLoai[];
  tong: number;
  trang: number;
  kichThuoc: number;
  hrefTrang: (trang: number) => string;
  /** Người xem được GHI không (`scope.has("affiliates:manage")`). BẮT BUỘC (luật 7). */
  coTheGhi: boolean;
  /** Nguồn chọn được làm mặc định — cho Sheet sửa. Chỉ có khi `coTheGhi`. */
  nguon: { id: string; ten: string }[];
}) {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = tong === 0 ? 0 : (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  return (
    <>
      <div className={VO_BANG}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={TH}>
                  Loại
                </th>
                <th scope="col" className={TH}>
                  Nguồn mặc định
                </th>
                <th scope="col" className={TH}>
                  Đối tác mới
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Đối tác
                </th>
                <th scope="col" title="Số quy tắc campaign trỏ vào loại này" className={cn(TH, "text-right")}>
                  Quy tắc
                </th>
                <th scope="col" className={TH}>
                  Trạng thái
                </th>
                {coTheGhi && (
                  <th scope="col" className={cn(TH, "text-right")}>
                    Thao tác
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {dong.map((d) => (
                <tr key={d.id} className={adminTr}>
                  <td className={cn(TD, "max-w-[18rem]")}>
                    <span className="block truncate font-medium text-foreground" title={d.ten}>
                      {d.ten}
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground" title={d.moTa ?? d.ma}>
                      {d.ma}
                      {d.moTa ? ` · ${d.moTa}` : ""}
                    </span>
                  </td>
                  <td className={cn(TD, "max-w-[14rem]")}>
                    {d.nguonMacDinh ? <span className="block truncate">{d.nguonMacDinh.ten}</span> : <span className="text-muted-foreground">Không có — xem tay</span>}
                  </td>
                  <td className={TD}>{d.canDuyet ? "Cần duyệt" : "Hoạt động ngay"}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{soVN(d.soDoiTac)}</td>
                  <td className={cn(TD, "text-right tabular-nums")}>{soVN(d.soQuyTac)}</td>
                  <td className={TD}>
                    <StatusPill tone={d.dangDung ? "success" : "muted"} className={INK_THEO_TONE[d.dangDung ? "success" : "muted"]}>
                      {d.dangDung ? "Đang dùng" : "Đã ngừng"}
                    </StatusPill>
                  </td>
                  {coTheGhi && (
                    <td className={cn(TD, "sticky right-0 z-10 bg-card text-right md:relative md:bg-transparent")}>
                      <span className="inline-flex items-center justify-end gap-2">
                        <LoaiSheet
                          dong={d}
                          nguon={nguon}
                          triggerAriaLabel={`Sửa loại ${d.ten}`}
                          triggerClassName="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:h-8 md:w-8"
                        >
                          <Pencil aria-hidden className="h-3.5 w-3.5" />
                        </LoaiSheet>
                        <NutBatTatDanhMuc loai="loai" muc={{ id: d.id, ten: d.ten, dangDung: d.dangDung, capNhatLuc: d.capNhatLuc }} bieuTuong />
                      </span>
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
          / {soVN(tong)} loại
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
    </>
  );
}
