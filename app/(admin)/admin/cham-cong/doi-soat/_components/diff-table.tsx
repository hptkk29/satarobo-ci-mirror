"use client";

// diff-table.tsx — bảng "ô nào lệch" của một kỳ đối soát.
//
// Vì sao có: bản cũ in bảng lệch rồi để người dùng tự đi tìm ngày đó ở màn khác. Mỗi dòng ở đây
// có ĐƯỜNG ĐI tới đúng nơi sửa (`/cham-cong?date=…&coSo=…`) — không có nó thì bảng chỉ tố cáo
// mà không giúp được gì.
//
// Dễ vỡ:
// - `PhanTrangBang` chỉ phân trang khi thấy ĐÚNG MỘT `<tbody>` — đừng thêm tbody thứ hai.
// - `max-w`+`truncate` phải nằm trên một `<span className="block …">` BÊN TRONG ô, không phải trên
//   `<td>`: bảng này `table-layout: auto`, trình duyệt bỏ qua `max-width` của ô, mà `adminTd` lại
//   có sẵn `whitespace-nowrap` ⇒ tên dài không cắt mà nở ra kéo cả cột đi ngang.
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { ShiftCodeChip } from "@/components/cham-cong/ui/shift-code-chip";
import { PILL } from "@/components/admin/cham-cong/classes";
import { hrefWith } from "@/lib/cham-cong/scope-href";
import { cn } from "@/lib/utils";
import type { ReconcileReport } from "@/lib/cham-cong/reconcile";

type Diff = ReconcileReport["cellDiffs"][number];

/** 4 loại lệch — nhãn tiếng Việt giữ nguyên như bản cũ (người vận hành đã quen). */
const KIND: Record<Diff["kind"], { text: string; cls: string }> = {
  MISSING_SYS: { text: "Sheet có ca, hệ thống trống", cls: "bg-state-danger-soft text-state-danger-ink" },
  MISSING_SHEET: { text: "Hệ thống có ca, Sheet trống", cls: "bg-state-danger-soft text-state-danger-ink" },
  CODE: { text: "Khác mã ca", cls: "bg-state-warning-soft text-state-warning-ink" },
  UNITS: { text: "Khác số công", cls: "bg-state-info-soft text-state-info-ink" },
};

export function DiffTable({
  rows,
  periodKey,
  coSo,
}: {
  rows: Diff[];
  periodKey: string;
  coSo: string | null;
}) {
  return (
    <PhanTrangBang cuonNgang tenDonVi="ô" khoaGhiNho="doi-soat-lech">
      <table className="w-full min-w-[760px]">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th scope="col" className={adminTh}>Người</th>
            <th scope="col" className={adminTh}>Ngày</th>
            <th scope="col" className={adminTh}>Sheet</th>
            <th scope="col" className={adminTh}>Hệ thống</th>
            <th scope="col" className={`${adminTh} text-right`}>Công Sheet</th>
            <th scope="col" className={`${adminTh} text-right`}>Công HT</th>
            <th scope="col" className={adminTh}>Loại lệch</th>
            <th scope="col" className={adminTh}>
              <span className="sr-only">Nơi sửa</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const date = `${periodKey}-${String(d.day).padStart(2, "0")}`;
            const kind = KIND[d.kind];
            return (
              <tr key={`${d.sheetName}-${d.day}-${d.kind}`} className={cn(adminTr, "h-11")}>
                <td className={cn(adminTd, "py-0 font-medium")}>
                  <span className="block max-w-[12rem] truncate" title={d.sheetName}>
                    {d.sheetName}
                  </span>
                </td>
                <td className={cn(adminTd, "py-0 tabular-nums")}>{d.day}</td>
                <td className={cn(adminTd, "py-0")}>
                  <ShiftCodeChip code={d.sheetCode ?? null} size="sm" />
                </td>
                <td className={cn(adminTd, "py-0")}>
                  <ShiftCodeChip code={d.sysCode ?? null} size="sm" />
                </td>
                <td className={cn(adminTd, "py-0 text-right tabular-nums")}>{d.sheetUnits}</td>
                <td className={cn(adminTd, "py-0 text-right tabular-nums")}>
                  {d.sysUnits ?? <span className="text-muted-foreground">chưa tính</span>}
                </td>
                <td className={cn(adminTd, "py-0")}>
                  <span className={cn(PILL, kind.cls)}>{kind.text}</span>
                </td>
                <td className={cn(adminTd, "py-0")}>
                  <Link
                    href={hrefWith("/cham-cong", { coSo, date })}
                    aria-label={`Mở bảng công ngày ${d.day} của ${d.sheetName}`}
                    className="inline-flex items-center gap-1 font-medium text-primary-ink hover:underline"
                  >
                    Bảng công ngày
                    <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </PhanTrangBang>
  );
}
