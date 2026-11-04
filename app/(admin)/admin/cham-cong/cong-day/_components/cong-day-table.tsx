"use client";

// Bảng công dạy theo NGƯỜI — mỗi dòng một giáo viên, cột phụ tách theo loại.
//
// Vì sao bày cả phần tách theo loại ngay trên dòng chứ không giấu vào panel: câu hỏi duy nhất
// người ta hỏi ở màn này là "vì sao người này được ngần đó công", và câu trả lời luôn là phép
// cộng của vài loại. Giấu nó đi là biến một con số giải thích được thành một con số phải tin.
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PILL } from "@/components/admin/cham-cong/classes";
import { cn } from "@/lib/utils";

export type CongDayRow = {
  userId: string;
  name: string;
  employeeCode: string | null;
  tongCong: number;
  /** "12,5" — đã định dạng ở server. */
  tongCongLabel: string;
  tongBuoi: number;
  dong: {
    code: string;
    name: string;
    buoi: number;
    congLabel: string;
    tinhVaoKy: boolean;
    boQuaThieuGio: number;
  }[];
};

export function CongDayTable({ rows }: { rows: CongDayRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <PhanTrangBang cuonNgang tenDonVi="giáo viên" khoaGhiNho="cong-day">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th scope="col" className={cn(adminTh, "sticky left-0 z-10 bg-muted/40")}>Giáo viên</th>
              <th scope="col" className={adminTh}>Tách theo loại</th>
              <th scope="col" className={cn(adminTh, "text-right")}>Buổi</th>
              <th scope="col" className={cn(adminTh, "text-right")}>Công dạy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className={adminTr}>
                <td className={cn(adminTd, "sticky left-0 z-10 bg-card align-top")}>
                  <span className="inline-block max-w-[13rem] truncate align-middle font-medium" title={r.name}>
                    {r.name}
                  </span>
                  {r.employeeCode && (
                    <span className="ml-2 align-middle font-mono text-[11px] text-muted-foreground">
                      {r.employeeCode}
                    </span>
                  )}
                </td>
                <td className={cn(adminTd, "align-top")}>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1">
                    {r.dong.map((d) => (
                      <li key={d.code} className="text-xs">
                        <span className={d.tinhVaoKy ? "text-foreground" : "text-muted-foreground"}>
                          {d.name}
                        </span>{" "}
                        <span className="tabular-nums text-muted-foreground">
                          {d.buoi} buổi → {d.congLabel}
                        </span>
                        {!d.tinhVaoKy && (
                          <span className={cn(PILL, "ml-1.5 bg-muted text-muted-foreground")}>
                            chỉ theo dõi
                          </span>
                        )}
                        {d.boQuaThieuGio > 0 && (
                          <span
                            className={cn(PILL, "ml-1.5 bg-state-warning-soft text-state-warning-ink")}
                            title="Loại này tính theo giờ, nhưng những buổi đó không suy được giờ nên chưa tính"
                          >
                            {d.boQuaThieuGio} buổi thiếu giờ
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className={cn(adminTd, "text-right align-top tabular-nums")}>{r.tongBuoi}</td>
                <td className={cn(adminTd, "text-right align-top font-semibold tabular-nums")}>
                  {r.tongCongLabel}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
