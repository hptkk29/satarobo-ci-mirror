import Link from "next/link";
import { RotateCw } from "lucide-react";
import { formatDateVN } from "@/lib/format/date";
import { adminTd, adminTh, adminTr } from "@/components/admin/ui/table";
import { PhanTrangBang } from "@/components/ui/phan-trang-bang";
import { cn } from "@/lib/utils";
import type { NearingEndItem } from "@/lib/students/renewal";

// Tab "Sắp hết khoá" của màn /enrollments (01/10/2026 — gộp từ /students/sap-het-khoa).
// Đây là HÀNG VIỆC tái tục: mỗi dòng là một phụ huynh cần gọi, nên cột quan trọng nhất (số
// buổi còn lại) đứng trước và nút "Tái tục" là hành động chính.

/** ≤ 2 buổi = phải gọi ngay tuần này. */
const GAP = 2;

export function TabSapHetKhoa({ items, nguong }: { items: NearingEndItem[]; nguong: number }) {
  const gap = items.filter((i) => i.remaining <= GAP).length;

  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
        Chưa có học viên nào còn ≤ {nguong} buổi.
      </p>
    );
  }

  return (
    <>
      <dl className="mb-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl border border-state-danger-soft bg-state-danger-soft/40 px-4 py-3">
          <dt className="text-xs text-state-danger-ink">Gọi ngay (≤ {GAP} buổi)</dt>
          <dd className="text-2xl font-semibold tabular-nums text-state-danger-ink">{gap}</dd>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">Sắp tới (≤ {nguong} buổi)</dt>
          <dd className="text-2xl font-semibold tabular-nums text-foreground">{items.length - gap}</dd>
        </div>
      </dl>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <PhanTrangBang cuonNgang>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className={cn(adminTh, "w-28")}>Còn lại</th>
                <th className={adminTh}>Học viên</th>
                <th className={adminTh}>Lớp · Khoá</th>
                <th className={adminTh}>Cơ sở</th>
                <th className={adminTh}>Dự kiến kết thúc</th>
                <th className={cn(adminTh, "text-right")}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.enrollmentId} className={adminTr}>
                  <td className={adminTd}>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                        it.remaining <= GAP
                          ? "bg-state-danger-soft text-state-danger-ink"
                          : "bg-state-warning-soft text-state-warning-ink",
                      )}
                    >
                      {it.remaining}/{it.total} buổi
                    </span>
                  </td>
                  <td className={cn(adminTd, "font-medium")}>{it.studentName}</td>
                  <td className={cn(adminTd, "max-w-[260px]")}>
                    <p className="truncate">{it.className}</p>
                    <p className="truncate text-xs text-muted-foreground">{it.courseName}</p>
                  </td>
                  <td className={cn(adminTd, "text-muted-foreground")}>{it.centerName ?? "—"}</td>
                  <td className={cn(adminTd, "tabular-nums")}>
                    {it.expectedEndDate ? formatDateVN(it.expectedEndDate) : "—"}
                  </td>
                  <td className={cn(adminTd, "text-right")}>
                    <div className="inline-flex items-center justify-end gap-2">
                      {/* BGĐ 31/07 — TÁI TỤC: pre-fill form ghi danh + nối khoá trước. */}
                      <Link
                        href={`/enrollments/new?studentId=${it.studentId}&renewedFrom=${it.enrollmentId}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      >
                        <RotateCw className="size-3.5" aria-hidden />
                        Tái tục
                      </Link>
                      <Link
                        href={`/students/${it.studentId}/edit`}
                        className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted"
                      >
                        Hồ sơ
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PhanTrangBang>
      </div>
    </>
  );
}
