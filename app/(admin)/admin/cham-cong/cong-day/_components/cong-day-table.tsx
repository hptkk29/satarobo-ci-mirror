"use client";

// Bảng công dạy theo NGƯỜI — mỗi dòng một giáo viên, cột theo NHÓM (Lớp chính / Dạy thay / Học bù /
// Khác) + phần tách theo LOẠI danh mục ngay dưới tên.
//
// Vì sao vẫn bày phần tách theo loại ngay trên dòng chứ không giấu vào trang chi tiết: câu hỏi duy nhất
// người ta hỏi ở màn này là "vì sao người này được ngần đó công", và câu trả lời luôn là phép cộng của
// vài loại. Giấu nó đi là biến một con số giải thích được thành một con số phải tin. Trang chi tiết
// (bấm vào dòng) trả lời câu kế tiếp: "những buổi nào".
import Link from "next/link";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";

export type CongDayRow = {
  userId: string;
  name: string;
  employeeCode: string | null;
  /** Liên kết sang chi tiết tháng của người này (giữ kỳ, cơ sở, bộ lọc). */
  href: string;
  lopChinh: number;
  dayThay: number;
  hocBu: number;
  khac: number;
  tongBuoi: number;
  /** Trong `tongBuoi`, số buổi thuộc loại "chỉ theo dõi" (không góp vào công). */
  buoiChiTheoDoi: number;
  tongPhut: number;
  /** "42 giờ" / "90 phút" — đã định dạng ở server. */
  tongGioLabel: string;
  tongCong: number;
  /** "12,5" — đã định dạng ở server. */
  tongCongLabel: string;
  canKiemTra: number;
  /** Số dòng chi tiết (kể cả buổi rơi khỏi công) — dòng 0 thì không vào bảng. */
  soDong: number;
  dong: {
    code: string;
    name: string;
    buoi: number;
    congLabel: string;
    tinhVaoKy: boolean;
    boQuaThieuGio: number;
  }[];
};

export type CotSapXep = "ten" | "buoi" | "gio" | "kt";

export function CongDayTable({
  rows,
  sapXep,
  hrefSapXep,
}: {
  rows: CongDayRow[];
  sapXep: CotSapXep;
  hrefSapXep: Record<CotSapXep, string>;
}) {
  const th = (cot: CotSapXep, nhan: string, phai = true) => (
    <th scope="col" className={cn(adminTh, phai && "text-right")} aria-sort={sapXep === cot ? "descending" : undefined}>
      <Link href={hrefSapXep[cot]} className={cn("hover:underline", sapXep === cot && "text-foreground")}>
        {nhan}
        {sapXep === cot ? " ↓" : ""}
      </Link>
    </th>
  );
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <PhanTrangBang cuonNgang tenDonVi="giáo viên" khoaGhiNho="cong-day">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th scope="col" className={cn(adminTh, "sticky left-0 z-10 bg-muted/40")} aria-sort={sapXep === "ten" ? "ascending" : undefined}>
                <Link href={hrefSapXep.ten} className={cn("hover:underline", sapXep === "ten" && "text-foreground")}>
                  Giáo viên{sapXep === "ten" ? " ↑" : ""}
                </Link>
              </th>
              <th scope="col" className={cn(adminTh, "text-right")}>Lớp chính</th>
              <th scope="col" className={cn(adminTh, "text-right")}>Dạy thay</th>
              <th scope="col" className={cn(adminTh, "text-right")}>Học bù</th>
              <th scope="col" className={cn(adminTh, "text-right")}>Loại khác</th>
              {th("buoi", "Tổng buổi")}
              {th("gio", "Tổng giờ")}
              <th scope="col" className={cn(adminTh, "text-right")}>Công dạy</th>
              {th("kt", "Cần kiểm tra")}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className={cn(adminTr, "hover:bg-muted/30")}>
                <td className={cn(adminTd, "sticky left-0 z-10 bg-card align-top")}>
                  {/* Vùng bấm là TÊN, không phải cả dòng: ô này `sticky` nên lớp phủ `after:inset-0` chỉ phủ được
                      chính ô — đặt `cursor-pointer` lên `<tr>` là hứa một cú bấm không xảy ra (luật 12, đo 13/10). */}
                  <Link
                    href={r.href}
                    className="inline-block max-w-[13rem] truncate align-middle font-medium text-primary underline-offset-2 hover:underline"
                    title={`Xem từng buổi của ${r.name}`}
                  >
                    {r.name}
                  </Link>
                  {r.employeeCode && (
                    <span className="ml-2 align-middle font-mono text-[11px] text-muted-foreground">{r.employeeCode}</span>
                  )}
                  <ul className="mt-1 flex max-w-[22rem] flex-wrap gap-x-3 gap-y-0.5">
                    {r.dong.map((d) => (
                      <li key={d.code} className="text-[11px]">
                        <span className={d.tinhVaoKy ? "text-foreground" : "text-muted-foreground"}>{d.name}</span>{" "}
                        <span className="tabular-nums text-muted-foreground">
                          {d.buoi} → {d.congLabel}
                        </span>
                        {!d.tinhVaoKy && <span className={cn(PILL, "ml-1 bg-muted text-muted-foreground")}>chỉ theo dõi</span>}
                        {d.boQuaThieuGio > 0 && (
                          <span
                            className={cn(PILL, "ml-1 bg-state-warning-soft text-state-warning-ink")}
                            title="Loại này tính theo giờ, nhưng những buổi đó không suy được giờ nên chưa tính"
                          >
                            {d.boQuaThieuGio} thiếu giờ
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className={cn(adminTd, "text-right align-top tabular-nums")}>{r.lopChinh}</td>
                <td className={cn(adminTd, "text-right align-top tabular-nums")}>{r.dayThay}</td>
                <td className={cn(adminTd, "text-right align-top tabular-nums")}>{r.hocBu}</td>
                <td className={cn(adminTd, "text-right align-top tabular-nums")}>{r.khac}</td>
                <td className={cn(adminTd, "text-right align-top tabular-nums")}>{r.tongBuoi}</td>
                <td className={cn(adminTd, "text-right align-top tabular-nums")}>{r.tongGioLabel}</td>
                <td className={cn(adminTd, "text-right align-top font-semibold tabular-nums")}>{r.tongCongLabel}</td>
                <td className={cn(adminTd, "text-right align-top tabular-nums")}>
                  {r.canKiemTra > 0 ? (
                    <span className={cn(PILL, "bg-state-warning-soft text-state-warning-ink")}>{r.canKiemTra}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
