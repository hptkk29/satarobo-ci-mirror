import Link from "next/link";
import { ArrowRight, BookOpen, CalendarClock, TriangleAlert } from "lucide-react";
import {
  daXong,
  dongHan,
  trangThaiHienThi,
  type KhoaRut,
} from "@/lib/elearning/dashboard-pure";
import { MUC_CHU, TrangThaiBadge } from "./trang-thai-badge";
import { TienDo } from "./tien-do";

/** Chữ của nút hành động trên thẻ — suy từ trạng thái thật, không phải nhãn cố định. */
export function nhanHanhDong(k: Pick<KhoaRut, "status" | "progressPercent">): string {
  if (daXong(k.status)) return "Xem lại";
  return k.status === "IN_PROGRESS" || k.progressPercent > 0 ? "Tiếp tục" : "Bắt đầu";
}

/**
 * Thẻ khoá học. CẢ THẺ là một liên kết tới đề cương (`/elearning/hoc/{enrollmentId}`) — vùng bấm = vùng trông như
 * bấm được. Khoá chưa có ảnh bìa (TrnCourse không có cột ảnh) nên dùng ô biểu tượng thay vì ảnh giả.
 */
export function TheKhoa({ khoa, now }: { khoa: KhoaRut; now: Date }) {
  const tt = trangThaiHienThi(khoa, now);
  const han = dongHan(khoa, now);
  const HanIcon = han?.sac === "danger" ? TriangleAlert : CalendarClock;
  return (
    <Link
      href={`/elearning/hoc/${khoa.enrollmentId}`}
      className="group flex h-full min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-ink">
          <BookOpen className="h-5 w-5" aria-hidden />
        </span>
        <TrangThaiBadge sac={tt.sac}>{tt.nhan}</TrangThaiBadge>
      </div>

      <h3 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-foreground">
        {khoa.tenKhoa}
      </h3>

      <div>
        <TienDo phanTram={khoa.progressPercent} nhan={khoa.tenKhoa} />
        <p className="mt-1.5 text-xs text-muted-foreground">{khoa.progressPercent}% hoàn thành</p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3">
        {han ? (
          <p className={`flex min-w-0 items-center gap-1.5 text-xs ${MUC_CHU[han.sac]}`}>
            <HanIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{han.chu}</span>
          </p>
        ) : (
          <span />
        )}
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary-ink">
          {nhanHanhDong(khoa)}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
