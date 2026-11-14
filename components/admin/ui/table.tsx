import * as React from "react";
import { cn } from "@/lib/utils";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";

/**
 * Mật độ bảng admin — DESIGN.md §2. Port từ `nhhatvy/TeachUI` (`src/components/ui/table.tsx`).
 *
 * SỐ ĐO TRƯỚC KHI SỬA (chụp ở /students ngày 11/08): dòng cao 65–71px và KHÔNG ĐỀU
 * NHAU. Nguyên nhân không phải padding mà là XUỐNG DÒNG: tên học viên, tên cơ sở
 * ("Trụ sở chính - Nguyễn Hữu Thọ"), header cột ("TRẠNG THÁI") và cả badge đều tự vỡ
 * dòng, nên mỗi dòng cao một kiểu tuỳ nội dung. Đó là thứ làm bảng trông lộn xộn.
 *
 * ⇒ `whitespace-nowrap` trên CẢ `th` LẪN `td` là luật, không phải tuỳ chọn. Ô nào thật
 * sự cần chữ dài thì tự thêm `max-w-[…] truncate` cho ô ĐÓ — cắt chữ có kiểm soát,
 * không để trình duyệt tự quyết.
 *
 * Hai cách dùng:
 *  1. `<DataTable>` cho bảng mới.
 *  2. Xuất `adminTh` / `adminTd` / `adminTr` để bảng viết tay sẵn có nhận mật độ đúng
 *     bằng một dòng sửa, không phải viết lại markup.
 */

/** Ô header: chữ nhỏ, in hoa, màu mờ — không cạnh tranh với dữ liệu. */
export const adminTh =
  "whitespace-nowrap px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** Ô dữ liệu: py-3.5 + text-sm ⇒ dòng ~44px, đúng chuẩn admin dày. */
export const adminTd = "whitespace-nowrap px-5 py-3.5 text-sm text-foreground";

export const adminTr =
  "border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50";

export interface Column<T> {
  key: string;
  header: string;
  /** Class thêm cho CẢ th và td của cột này (căn phải cho số, giới hạn bề rộng…). */
  className?: string;
  render?: (row: T, index: number) => React.ReactNode;
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  empty,
  rowKey,
  className,
}: {
  columns: Column<T>[];
  data: T[];
  /** Trạng thái rỗng. Truyền `<EmptyState>` để nói rõ vì sao rỗng (DESIGN.md §5). */
  empty?: React.ReactNode;
  rowKey?: (row: T, index: number) => string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card", className)}>
      <PhanTrangBang cuonNgang>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((col) => (
                <th key={col.key} scope="col" className={cn(adminTh, col.className)}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-5 py-10 text-center">
                  {empty ?? (
                    <span className="text-sm text-muted-foreground">Chưa có dữ liệu.</span>
                  )}
                </td>
              </tr>
            ) : (
              data.map((row, i) => (
                <tr key={rowKey?.(row, i) ?? String(row.id ?? i)} className={adminTr}>
                  {columns.map((col) => (
                    <td key={col.key} className={cn(adminTd, col.className)}>
                      {col.render ? col.render(row, i) : String(row[col.key] ?? "")}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </PhanTrangBang>
    </div>
  );
}
