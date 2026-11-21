// MA TRẬN CHÍNH SÁCH chỉ đọc (06 §5.2): dòng = vai hưởng, cột = nhóm nguồn + "Không rõ nguồn"; ô = tỉ lệ đang THẮNG.
// Server component thuần; dữ liệu là kết quả `dungMaTran` (cùng bộ chọn với engine). Mỗi ô có chữ "riêng/chung" cho biết nó đến từ
// chính sách CỤ THỂ hay MỨC NỀN (không chỉ màu). Bấm một ô nhảy sang chính sách đang thắng ở ô đó. Cột đầu dính trái khi cuộn ngang
// (tablet). Dòng cuối: tổng mỗi cột so với trần; cột vượt trần tô danger KÈM chữ.
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { VO_BANG } from "@/components/admin/nguon-hoa-hong/classes";
import { adminTh } from "@/components/admin/ui/table";
import type { DongMaTran, MaTran, OMaTran } from "@/lib/hoa-hong/ma-tran-chinh-sach";
import { tachNhomVai } from "@/lib/hoa-hong/nhom-hoa-hong";
import { MO_TA_NHOM_HOA_HONG } from "@/lib/nguon/nhan-hien-thi";
import { dinhDangDong } from "@/lib/hoa-hong/vi-sao";
import { cn } from "@/lib/utils";

const TH = cn(adminTh, "px-3");
const CELL = "block min-h-11 px-3 py-1.5 text-sm";
const STICKY = "sticky left-0 z-[1] bg-card";

function Nhan({ cuThe }: { cuThe: boolean }) {
  return <span className={cn("block text-[11px] leading-tight", cuThe ? "font-semibold text-primary-ink" : "text-muted-foreground")}>{cuThe ? "riêng" : "chung"}</span>;
}

function O({ o, tenNhom }: { o: OMaTran; tenNhom: ReadonlyMap<string, string> }) {
  if (o.kieu === "KHONG_CO") {
    return (
      <span className={cn(CELL, "text-muted-foreground")}>
        <span aria-hidden>—</span>
        <span className="sr-only">Không có chính sách</span>
      </span>
    );
  }
  if (o.kieu === "CHONG_LAN") {
    return (
      <span className={cn(CELL, "font-medium text-state-danger-ink")} title={o.lyDo}>
        Chồng lấn
      </span>
    );
  }
  const noiDung =
    o.kieu === "PERCENT" ? (
      <span className="font-medium tabular-nums text-foreground">{o.phanTram}%</span>
    ) : o.kieu === "EXCLUDE" ? (
      <span className="text-muted-foreground">Không trả</span>
    ) : o.kieu === "CO_DINH" ? (
      <span className="font-medium tabular-nums text-foreground">{dinhDangDong(o.soTien)}</span>
    ) : (
      <span className="text-muted-foreground">Thưởng bậc</span>
    );
  const phu = o.kieu === "PERCENT" && o.nhomMin ? `thấp nhất: ${tenNhom.get(o.nhomMin) ?? o.nhomMin}` : null;
  return (
    <Link
      href={`/nguon-hoa-hong/chinh-sach/${o.policyId}?v=${o.version}`}
      title={`${o.policyCode} v${o.version}${phu ? ` · ${phu}` : ""}`}
      className={cn(CELL, "hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring")}
    >
      {noiDung}
      <Nhan cuThe={o.cuThe} />
      {phu && <span className="block max-w-[8rem] truncate text-[11px] leading-tight text-muted-foreground">{phu}</span>}
    </Link>
  );
}

export function MaTranBang({ maTran, nhomTheoMa, tranPhanTram }: { maTran: MaTran; nhomTheoMa: ReadonlyMap<string, string>; tranPhanTram: string | null }) {
  const tenCot = new Map(maTran.cot.map((c) => [c.khoa, c.nhan]));
  // Hai nhóm vai (theo `isAcquisition`): hoa hồng NGUỒN và hoa hồng GIAO DỊCH khác. Tách chỗ ngồi, KHÔNG tách tổng — trần đếm cả hai nên hàng «Tổng» dưới cùng vẫn là một.
  const nhomDong = tachNhomVai(maTran.dong.map((d) => ({ isAcquisition: d.vai.isAcquisition, d }))).map((n) => ({ ...n, dong: n.vai.map((x) => x.d) as DongMaTran[] }));
  const chongLan = maTran.dong.flatMap((d) =>
    d.o.flatMap((o) => (o.kieu === "CHONG_LAN" ? [{ khoa: `${d.vai.code}|${o.cot}`, vai: d.vai.name, cot: tenCot.get(o.cot) ?? o.cot, lyDo: o.lyDo }] : [])),
  );
  return (
    <>
      <div className={VO_BANG}>
        {/* `relative`: `sr-only` là position:absolute — không có tổ tiên định vị trong vùng cuộn thì nó lọt ra ngoài `overflow-x-auto`
            và kéo cả TRANG tràn ngang (đã gặp ở tab Nguồn, đo 08/10). */}
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left" style={{ minWidth: `${12 + maTran.cot.length * 7.5}rem` }}>
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th scope="col" className={cn(TH, STICKY, "bg-muted/40 min-w-[11rem]")}>
                  Vai hưởng
                </th>
                {maTran.cot.map((c) => (
                  <th key={c.khoa} scope="col" className={cn(TH, "min-w-[7.5rem] max-w-[8.5rem] whitespace-normal align-bottom", c.laUnknown && "border-l border-border")} title={c.laUnknown ? "Không rõ nguồn = mức thấp nhất của từng vai trên các nhóm nguồn, tính động" : c.nhan}>
                    {/* Hai dòng, không cắt một dòng: nhiều nhóm mở đầu bằng "Nguồn từ …" nên cắt đuôi làm các cột giống hệt nhau. */}
                    <span className="line-clamp-2 normal-case tracking-normal">{c.nhan}</span>
                  </th>
                ))}
              </tr>
            </thead>
            {nhomDong.map((n) => (
              <tbody key={n.khoa} data-nhom-hoa-hong={n.khoa}>
                <tr className="border-b border-border/60 bg-muted/20">
                  <th scope="rowgroup" colSpan={maTran.cot.length + 1} className="px-3 py-2 text-left align-top">
                    {/* sticky: khi bảng cuộn ngang, tên nhóm ở lại bên trái thay vì trôi ra ngoài tầm mắt */}
                    <span className="sticky left-3 inline-block text-sm font-semibold text-foreground">{n.nhan}</span>
                    <span className="sticky left-3 ml-2 inline-block text-xs font-normal text-muted-foreground">{MO_TA_NHOM_HOA_HONG[n.khoa]}</span>
                  </th>
                </tr>
                {n.dong.map((d) => (
                  <tr key={d.vai.code} className="border-b border-border/60 last:border-0">
                    <th scope="row" className={cn(STICKY, "whitespace-nowrap px-3 py-2 text-left text-sm font-medium text-foreground")}>
                      {d.vai.name}
                    </th>
                    {d.o.map((o) => (
                      <td key={o.cot} className={cn("p-0 align-middle", o.cot === "UNKNOWN" && "border-l border-border")}>
                        <O o={o} tenNhom={nhomTheoMa} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr className="border-t border-border bg-muted/40">
                <th scope="row" className={cn(STICKY, "bg-muted/40 whitespace-nowrap px-3 py-2.5 text-left text-sm font-semibold text-foreground")}>
                  Tổng{tranPhanTram !== null ? ` / trần ${tranPhanTram}%` : ""}
                </th>
                {maTran.tong.map((t) => (
                  <td key={t.khoa} className={cn("whitespace-nowrap px-3 py-2.5 text-sm font-semibold tabular-nums", t.khoa === "UNKNOWN" && "border-l border-border", t.vuotTran && tranPhanTram !== null ? "text-state-danger-ink" : "text-foreground")}>
                    {t.tongPhanTram}%{t.khongTinDuoc ? "*" : ""}
                    {t.vuotTran && tranPhanTram !== null && (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold leading-tight">
                        <TriangleAlert aria-hidden className="h-3 w-3" />
                        vượt trần
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {/* Ô chồng lấn phải NÓI chính sách nào chồng nhau bằng chữ nhìn thấy: `title` không có trên màn cảm ứng và với người dùng bàn phím. */}
      {chongLan.length > 0 && (
        <section aria-label="Ô chồng lấn" className="mt-3 rounded-lg border border-state-danger-ink/30 bg-state-danger-soft px-3 py-2.5">
          <p className="text-xs font-semibold text-state-danger-ink">Ô chồng lấn — cần sửa chính sách cho hết trùng hạng</p>
          <ul className="mt-1 grid gap-1 text-xs text-foreground">
            {chongLan.map((c) => (
              <li key={c.khoa}>
                <b>{c.vai}</b> · {c.cot}: {c.lyDo}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
        <li>
          <b className="text-primary-ink">riêng</b> = ô lấy từ chính sách cụ thể (theo nhóm nguồn, cơ sở…); <b className="text-foreground">chung</b> = mức nền áp cho mọi nguồn. Cụ thể thắng chung; hai rule cùng
          hạng là “Chồng lấn”.
        </li>
        <li>Hàng «Tổng» cộng <b className="text-foreground">cả hai nhóm</b> (hoa hồng nguồn và giao dịch khác) — trần áp cho tổng này.</li>
        <li>“Không rõ nguồn” = mức thấp nhất của từng vai trên các nhóm nguồn, tính động mỗi lần — hạ một nhóm xuống thì cột này đi theo.</li>
        {maTran.tong.some((t) => t.khongTinDuoc) && <li>* Cột có ô chồng lấn hoặc rule kiểu khác (số tiền cố định, thưởng bậc) — tổng chỉ là phần quy được ra phần trăm.</li>}
      </ul>
    </>
  );
}
