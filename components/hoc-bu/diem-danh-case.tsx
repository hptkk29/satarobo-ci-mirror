"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateVN } from "@/lib/format/date";
import type { BeTrongCase } from "@/lib/hoc-bu/case-doc";
import { StudentEvalDialog, type PhieuNhanXetGui } from "@/app/(teacher)/teacher/lop/_components/student-eval-dialog";

// ĐIỂM DANH + NHẬN XÉT BUỔI BÙ — dùng chung admin + site giáo viên (action truyền vào từ trang).
//
// Chốt 29/09/2026:
//   · có mặt ở buổi bù ⇒ buổi VẮNG gốc cập nhật thành có mặt (giữ dấu "đã bù");
//   · nhận xét nhập ở đây ghi vào buổi gốc "như nhập ở buổi chính" — dùng LẠI hộp thoại phiếu
//     nhận xét của buổi chính (rubric 9 tiêu chí + đánh giá chung), không dựng bản thứ hai;
//   · quản lý / giáo viên nhập; Sale chỉ XEM đã điểm danh / đã nhận xét chưa để nhắc giáo viên.
// GV điểm danh trên ĐIỆN THOẠI ngay trong lớp ⇒ nút 44px, chữ rõ.
// ⚠️ Chỉ token `:root` (site GV không có `.admin-scope`).

type KetQua = { ok: true } | { ok: false; error: string };

const CACH_XEP: Record<BeTrongCase["cachXep"], string> = {
  LUOT: "Lượt bù",
  PHI: "Đã thu phí",
  MIEN_PHI: "Miễn phí",
};

const PILL = "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold";
const TONE = {
  success: "bg-[color:var(--state-success-soft)] text-[color:var(--state-success)]",
  danger: "bg-[color:var(--state-danger-soft)] text-[color:var(--state-danger)]",
  warning: "bg-[color:var(--state-warning-soft)] text-[color:var(--state-warning)]",
  muted: "bg-muted text-muted-foreground",
};

export function DiemDanhCase({
  be,
  moDiemDanh,
  coTheNhap,
  thongTinBuoi,
  diemDanh,
  nhanXet,
  goKhoi,
}: {
  be: BeTrongCase[];
  /** Case còn SCHEDULED — chỉ lúc này mới điểm danh được. */
  moDiemDanh: boolean;
  /** Người xem được nhập điểm danh + nhận xét (quản lý / GV của case). Sale: false ⇒ chỉ xem. */
  coTheNhap: boolean;
  /** Để hộp thoại nhận xét in đúng khoá / buổi / ngày / dự án. */
  thongTinBuoi: { khoa: string; buoi: string; ngayIso: string; duAn: string };
  diemDanh: (caseStudentId: string, coMat: boolean) => Promise<KetQua>;
  nhanXet: (caseStudentId: string, p: PhieuNhanXetGui) => Promise<KetQua>;
  /** Không truyền = không cho gỡ (site giáo viên). */
  goKhoi?: (caseStudentId: string) => Promise<KetQua>;
}) {
  const router = useRouter();
  const [dang, setDang] = useState<string | null>(null);
  const [, start] = useTransition();

  function chay(id: string, viec: () => Promise<KetQua>, xong: string) {
    setDang(id);
    start(async () => {
      try {
        const kq = await viec();
        if (!kq.ok) toast.error(kq.error);
        else {
          toast.success(xong);
          router.refresh();
        }
      } catch {
        toast.error("Mất kết nối — chưa lưu được, thử lại");
      } finally {
        setDang(null);
      }
    });
  }

  if (be.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Case chưa có học viên nào.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {be.map((b) => {
        const ban = dang === b.id;
        const choDiemDanh = b.status === "PLACED" && moDiemDanh && coTheNhap;
        return (
          <li key={b.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{b.hocVien}</p>
              <p className="truncate text-xs text-muted-foreground">
                {b.lop}
                {b.ngayVang ? ` · vắng ${formatDateVN(b.ngayVang)}` : ""} · {CACH_XEP[b.cachXep]}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {choDiemDanh ? (
                <>
                  <button
                    type="button"
                    disabled={ban}
                    onClick={() => chay(b.id, () => diemDanh(b.id, true), `${b.hocVien}: có mặt`)}
                    className={cn(
                      "inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors hover:brightness-95 disabled:opacity-50 sm:flex-none",
                      TONE.success,
                    )}
                  >
                    <Check className="size-4" aria-hidden /> Có mặt
                  </button>
                  <button
                    type="button"
                    disabled={ban}
                    onClick={() => chay(b.id, () => diemDanh(b.id, false), `${b.hocVien}: vắng — quay lại danh sách cần bù`)}
                    className={cn(
                      "inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold transition-colors hover:brightness-95 disabled:opacity-50 sm:flex-none",
                      TONE.danger,
                    )}
                  >
                    <X className="size-4" aria-hidden /> Vắng
                  </button>
                  {goKhoi && (
                    <button
                      type="button"
                      disabled={ban}
                      onClick={() => chay(b.id, () => goKhoi(b.id), `Đã gỡ ${b.hocVien} khỏi case`)}
                      className="h-11 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                    >
                      Gỡ
                    </button>
                  )}
                </>
              ) : (
                <span className={cn(PILL, b.status === "PRESENT" ? TONE.success : b.status === "ABSENT" ? TONE.danger : TONE.muted)}>
                  {b.status === "PRESENT" ? "Có mặt" : b.status === "ABSENT" ? "Vắng" : "Chưa điểm danh"}
                </span>
              )}

              {b.status === "PRESENT" &&
                (coTheNhap ? (
                  <StudentEvalDialog
                    sessionId={b.missedSessionId}
                    studentId={b.studentId}
                    studentName={b.hocVien}
                    courseName={thongTinBuoi.khoa}
                    sessionTopic={thongTinBuoi.buoi}
                    sessionDate={thongTinBuoi.ngayIso}
                    projectName={thongTinBuoi.duAn}
                    existing={b.nhanXet}
                    done={b.nhanXet !== null}
                    luu={(p) => nhanXet(b.id, p)}
                  />
                ) : (
                  <span className={cn(PILL, b.nhanXet ? TONE.success : TONE.warning)}>
                    {b.nhanXet ? "Đã nhận xét" : "Chưa nhận xét"}
                  </span>
                ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
