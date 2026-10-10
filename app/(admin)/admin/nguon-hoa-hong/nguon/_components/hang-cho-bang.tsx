// app/(admin)/admin/nguon-hoa-hong/nguon/_components/hang-cho-bang.tsx — HÀNG CHỜ NGUỒN (06 §5.1): bảng dày,
// dòng 44px, mỗi dòng là MỘT lead chưa đủ căn cứ nguồn.
//
// Cả dòng là vùng bấm (luật 12): `<tr relative cursor-pointer>` + nút tên lead mang `after:inset-0` phủ kín hàng. Bấm mở
// **Sheet "Gán nguồn"** ngay trên hàng chờ, không rời trang (06 §5.1) — Sheet là client component, bảng vẫn là RSC: chỉ nút tên
// và Sheet của nó xuống trình duyệt.
//
// ⚠️ Ai cũng mở được Sheet (cổng của tab là `sources:view`), nhưng Sheet chỉ CÓ FORM khi máy chủ nói người này đổi được nguồn
// của lead này; không thì nó nêu tên khoá còn thiếu. Đường sang hồ sơ lead là một liên kết TRONG Sheet, và chỉ có khi
// `coTheMoLead` (`leads:view-all` ∨ `leads:view-own` — đúng cổng của `/leads/[id]`, vốn đá người thiếu quyền về /dashboard thầm
// lặng). `coTheMoLead` BẮT BUỘC, không mặc định (luật 7).
//
// `title` nằm trên phần tử TRÊN CÙNG của ô tên (nút): lớp phủ `after:inset-0` che mọi `title` ở <td> bên dưới, nên chữ bị
// `truncate` (cơ sở, nhãn cũ, tên dài) sẽ không có cách nào đọc đủ.
//
// Thứ tự cột: Lead · Vấn đề · Nguồn hiện tại · Cơ sở · Đường vào · Tuổi. "Vấn đề" là lý do bảng này tồn tại nên đứng
// ngay sau Lead; khi vùng cuộn ngang hẹp (tablet), thứ rơi ra ngoài tầm mắt là cột phụ.
//
// Server component thuần: không JS nào xuống trình duyệt cho một bảng chỉ-đọc.
// Bọc cuộn ngang ở div CON (vùng cuộn không trùng thẻ bo góc — luật vỏ bảng 06/09).
import { ChevronRight } from "lucide-react";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { nhanTuoi, soVN } from "@/components/admin/nguon-hoa-hong/nhan-nguon";
import { VanDePill } from "@/components/admin/nguon-hoa-hong/nguon-status-pill";
import { GanNguonSheet } from "@/components/admin/nguon-hoa-hong/gan-nguon-sheet";
import { TbodyDieuHuong } from "@/components/admin/nguon-hoa-hong/tbody-dieu-huong";
import { DieuHuongTrangLink } from "@/components/ui/dieu-huong-trang-link";
import type { HangChoNguonDong } from "@/lib/nguon/doc-hang-cho";
import { cn } from "@/lib/utils";

/** Bảng 7 cột chen trong khung ~976px (sidebar 256px) ⇒ ô hẹp hơn mặc định (px-3, không px-5). */
const TH = cn(adminTh, "px-3");
const TD = cn(adminTd, "px-3");

export function HangChoBang({
  dong,
  tong,
  trang,
  kichThuoc,
  hrefTrang,
  coTheMoLead,
}: {
  dong: HangChoNguonDong[];
  tong: number;
  trang: number;
  kichThuoc: number;
  /** Địa chỉ của một trang — page dựng (giữ cơ sở + vấn đề), bảng không biết bộ lọc. */
  hrefTrang: (trang: number) => string;
  /** Người xem có mở được `/leads/[id]` không (`leads:view-all` hoặc `leads:view-own`). Page tính, bảng không đoán. */
  coTheMoLead: boolean;
}) {
  const soTrang = Math.max(1, Math.ceil(tong / kichThuoc));
  const tu = tong === 0 ? 0 : (trang - 1) * kichThuoc + 1;
  const den = Math.min(tong, trang * kichThuoc);
  return (
    <>
      <div className={VO_BANG}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className={TH}>
                Lead
              </th>
              <th scope="col" className={TH}>
                Vấn đề
              </th>
              <th scope="col" className={TH}>
                Nguồn hiện tại
              </th>
              <th scope="col" className={TH}>
                Cơ sở
              </th>
              <th scope="col" className={TH}>
                Đường vào
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Tuổi
              </th>
              <th scope="col" aria-label="Mở" className={cn(TH, "w-8")} />
            </tr>
          </thead>
          <TbodyDieuHuong>
            {dong.map((d) => {
              const tenHienThi = d.tenLead || "(chưa có tên)";
              const tieuDe = [tenHienThi, d.coSo?.name, d.nhanGoc ? `nhãn cũ: ${d.nhanGoc}` : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <tr key={d.leadId} className={cn(adminTr, "relative cursor-pointer")}>
                  <td className={cn(TD, "max-w-[16rem]")}>
                    <GanNguonSheet
                      leadId={d.leadId}
                      tenLead={tenHienThi}
                      coTheMoLead={coTheMoLead}
                      dieuHuongHang
                      triggerAriaLabel={`Gán nguồn cho ${tenHienThi}`}
                      triggerClassName="block max-w-full truncate text-left font-medium text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring after:absolute after:inset-0 after:content-['']"
                      title={tieuDe}
                    >
                      {tenHienThi}
                    </GanNguonSheet>
                  </td>
                  <td className={TD}>
                    <span className="flex items-center gap-1.5">
                      {d.lyDo.map((l) => (
                        <VanDePill key={l} lyDo={l} canhBao={d.canhBao} />
                      ))}
                    </span>
                  </td>
                  <td className={TD}>
                    <span className="flex items-baseline gap-1.5">
                      <span className="max-w-[11rem] truncate">{d.nguon.name}</span>
                      {d.nhanGoc && (
                        // Nhãn cũ cắt RIÊNG (không cắt chung với tên nguồn, và KHÔNG bọc dấu nháy: cắt giữa chừng sẽ để lại một dấu nháy mở hở).
                        <span className="max-w-[7rem] truncate text-muted-foreground">cũ: {d.nhanGoc}</span>
                      )}
                    </span>
                  </td>
                  <td className={cn(TD, "max-w-[8rem] truncate")}>
                    {d.coSo ? (d.coSo.code ?? d.coSo.name) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={cn(TD, "text-muted-foreground")}>{d.duongVao ?? "—"}</td>
                  <td className={cn(TD, "text-right tabular-nums text-muted-foreground")}>{nhanTuoi(d.tuoiNgay)}</td>
                  <td className={cn(TD, "w-10 text-muted-foreground")}>
                    <ChevronRight aria-hidden className="h-4 w-4" />
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
          / {soVN(tong)} lead
        </p>
        <DieuHuongTrangLink trang={trang} soTrang={soTrang} hrefCua={hrefTrang} />
      </div>
    </>
  );
}
