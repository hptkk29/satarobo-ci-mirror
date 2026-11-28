import { boDau } from "@/lib/elearning/nguoi-hoc";
import type { DongChoCham } from "@/lib/elearning/task-grading-queue";

/**
 * P8 — HIỂN THỊ hàng chờ chấm bài tập theo thiết kế `QtChamBai` (master-detail). THUẦN. Không đổi luật chấm/hạn chấm: chỉ diễn đạt lại
 * `dueGradeAt` + `quaHanNgayLam` (đã tính ở `napHangChoTap`) và chọn bài kế tiếp sau khi chấm.
 */
export const TAB_CHAM = ["tat-ca", "nhan-vien", "hoc-vien-online"] as const;
export type TabCham = (typeof TAB_CHAM)[number];

export type NhanHan = { chu: string; sac: "danger" | "warning" | "muted" };

/** "Trễ 1 ngày" (quá hạn ≥ 1 ngày làm việc) · "Đã đến hạn" · "Còn 4 giờ" (< 24 giờ) · "Còn 2 ngày" · "Chưa rõ hạn". */
export function chuHanCham(d: Pick<DongChoCham, "dueGradeAt" | "quaHanNgayLam">, now: Date): NhanHan {
  if (d.quaHanNgayLam > 0) return { chu: `Trễ ${d.quaHanNgayLam} ngày`, sac: "danger" };
  if (!d.dueGradeAt) return { chu: "Chưa rõ hạn", sac: "muted" };
  const ms = d.dueGradeAt.getTime() - now.getTime();
  if (ms <= 0) return { chu: "Đã đến hạn", sac: "danger" };
  if (ms < 24 * 3600_000) return { chu: `Còn ${Math.max(1, Math.ceil(ms / 3600_000))} giờ`, sac: "warning" };
  return { chu: `Còn ${Math.floor(ms / 86_400_000)} ngày`, sac: "muted" };
}

/** Tìm theo tên người học hoặc tên bài (không phân biệt hoa/thường/dấu). Rỗng ⇒ giữ nguyên. */
export function locHangCham<T extends Pick<DongChoCham, "tenNguoiHoc" | "tenBai">>(ds: readonly T[], q: string | undefined): T[] {
  const k = boDau((q ?? "").trim());
  return k === "" ? [...ds] : ds.filter((d) => boDau(d.tenNguoiHoc).includes(k) || boDau(d.tenBai).includes(k));
}

/** Bài để mở SAU KHI chấm xong `idHienTai`: bài liền sau trong danh sách đang hiện, không có thì bài liền trước, không còn gì ⇒ null. */
export function idKeTiep(ds: readonly { submissionId: string }[], idHienTai: string): string | null {
  const i = ds.findIndex((d) => d.submissionId === idHienTai);
  if (i < 0) return ds[0]?.submissionId ?? null;
  return ds[i + 1]?.submissionId ?? ds[i - 1]?.submissionId ?? null;
}
