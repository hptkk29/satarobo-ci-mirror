"use client";

import { useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

/**
 * "Bài trước / Bài sau" của khung trình học + kho trạng thái "đang mở lượt thi".
 *
 * ⚠️ VÌ SAO NÓ LÀ COMPONENT CLIENT. Trang bài thi là Server Component: `anChuyenBai` chỉ biết "đang có lượt dở" sau khi
 * server render lại. Giữa lúc bấm "Bắt đầu làm bài" và lúc RSC mới về, trang vẫn là bản CŨ (chưa có lượt) nên vẫn vẽ hai nút
 * nối trang ngay dưới nút "Đang mở…". Lượt thi lúc đó ĐÃ được tạo ở máy chủ và ĐANG TÍNH GIỜ — bấm "Bài sau" là rời một lượt
 * mà người học chưa hề thấy đề. Nút phải biến mất NGAY khi bấm, không đợi server.
 *
 * Kho là một biến cấp module + `useSyncExternalStore` (không Context): `ExamRunner` (con của trang) và `ChuyenBaiNav` (con của
 * khung) là hai nhánh khác nhau của cây, không có tổ tiên chung nào ở phía client để đặt Provider mà không đổi cấu trúc trang.
 * Giá trị mặc định ở server là `false` ⇒ HTML đầu tiên giống hệt bản cũ (không lệch hydrate).
 */

let dangMoLuot = false;
const nguoiNghe = new Set<() => void>();

/** Bật khi bấm "Bắt đầu làm bài", tắt khi màn thi đã hiện, khi lỗi, hoặc khi `ExamRunner` bị gỡ. */
export function datDangMoLuotThi(v: boolean): void {
  if (dangMoLuot === v) return;
  dangMoLuot = v;
  for (const f of nguoiNghe) f();
}

export function useDangMoLuotThi(): boolean {
  return useSyncExternalStore(
    (f) => {
      nguoiNghe.add(f);
      return () => {
        nguoiNghe.delete(f);
      };
    },
    () => dangMoLuot,
    () => false,
  );
}

export type BaiNoi = { lessonId: string; title: string } | null;

export function ChuyenBaiNav({
  enrollmentId,
  truoc,
  sau,
}: {
  enrollmentId: string;
  truoc: BaiNoi;
  sau: BaiNoi;
}) {
  const dangMo = useDangMoLuotThi();
  if (dangMo) return null;
  if (!truoc && !sau) return null;
  return (
    <nav aria-label="Chuyển bài" className="mt-8 flex items-center justify-between gap-3 border-t border-border pt-4">
      {truoc ? (
        <a
          href={`/elearning/hoc/${enrollmentId}/${truoc.lessonId}`}
          className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
          <span className="truncate">Bài trước: {truoc.title}</span>
        </a>
      ) : (
        <span />
      )}
      {sau ? (
        <a
          href={`/elearning/hoc/${enrollmentId}/${sau.lessonId}`}
          className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground outline-none hover:bg-primary-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span className="truncate">Bài sau: {sau.title}</span>
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}
