// student-eval-dialog.tsx — Phiếu "Nhận xét buổi học" 1 HV (port TeachUI StudentEvalDialog).
//
// Dự án (TỰ ĐIỀN theo buổi, chỉ đọc) + ① ô "Đánh giá chung" ≤ 2000 ký tự kèm khối gợi ý
// + ② rubric 9 tiêu chí (dropdown 5 mức). Lưu qua saveSessionEval (self-gated own-class).
// Dialog CONTROLLED + Button onClick (pattern site GV — KHÔNG DialogTrigger render).
//
// ⚠️ 21/08 — ĐỔI HAI THỨ, đừng "khôi phục" lại bản cũ:
//   • 4 ô rời (Kiến thức/Kỹ năng/Thái độ/Đề xuất) → MỘT ô "Đánh giá chung". Phiếu cũ mở
//     ra được ghép sẵn thành một đoạn có nhãn (`toOverallText`) — KHÔNG mồi ô rỗng, vì
//     upsert ghi đè trọn cột `notes`: mồi rỗng là bấm Lưu xoá trắng chữ giáo viên đã viết.
//   • Ô "Dự án" hết là <input>. Tên dự án suy từ chính buổi học (deriveSessionProjectName
//     ở phía server) — trước đây mọi phiếu đều mang hằng "Dự án 1: Làm quen hệ thống"
//     kể cả buổi 9, vì ô được mồi sẵn và không ai sửa.
// ⚠️ Câu 46: props CHỈ tên HV — không SĐT/email/tên PH.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronRight,
  CircleCheck,
  ClipboardPen,
  FileDown,
  Save,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_EVAL_LEVEL,
  EVAL_CRITERIA,
  EVAL_OVERALL_GUIDE_INTRO,
  EVAL_OVERALL_GUIDE_ITEMS,
  EVAL_OVERALL_GUIDE_NOTE,
  EVAL_OVERALL_LABEL,
  EVAL_OVERALL_MAX,
  groupedEvalCriteria,
  toOverallText,
  type EvalNotes,
} from "@/lib/lms/session-eval-rubric";
import { saveSessionEval } from "@/app/(admin)/admin/sessions/[id]/_actions";

export type StudentEvalExisting = {
  projectName: string | null;
  notes: EvalNotes;
  rubric: Record<string, number>;
} | null;

const GROUPS = groupedEvalCriteria();

/** Dữ liệu phiếu gửi đi — cùng hình dạng `saveSessionEval` nhận. */
export type PhieuNhanXetGui = {
  sessionId: string;
  studentId: string;
  projectName: string;
  notes: { overall: string };
  rubric: Record<string, number>;
};

export function StudentEvalDialog({
  sessionId,
  studentId,
  studentName,
  courseName,
  sessionTopic,
  sessionDate,
  projectName,
  existing,
  done,
  pdfHref,
  luu,
}: {
  sessionId: string;
  studentId: string;
  studentName: string;
  courseName: string;
  sessionTopic: string;
  sessionDate: string;
  /** Tên dự án SUY TỪ BUỔI (deriveSessionProjectName) — chỉ đọc, GV không gõ nữa. */
  projectName: string;
  existing: StudentEvalExisting;
  done: boolean;
  /** Không truyền = không có nút "Xuất PDF". */
  pdfHref?: string;
  /**
   * Đường LƯU thay thế (29/09/2026 — case học bù ghi vào buổi vắng gốc qua cổng riêng). Không
   * truyền = lưu như buổi chính (`saveSessionEval`). Cùng một hộp thoại, cùng luật phiếu.
   */
  luu?: (p: PhieuNhanXetGui) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(done);

  // Phiếu cũ (4 mục) được GHÉP lại thành một đoạn có nhãn — xem ghi chú đầu file.
  const moiBanDau = toOverallText(existing?.notes);
  const [overall, setOverall] = useState(moiBanDau);
  const overallLen = overall.trim().length;
  // Trần 2000 chỉ chặn khi GV ĐÃ SỬA nội dung. Phiếu cũ ghép lại dài hơn 2000 mà giữ
  // nguyên thì vẫn lưu được (vd chỉ muốn đổi một ô năng lực) — server có cùng luật này.
  const tooLong = overallLen > EVAL_OVERALL_MAX && overall.trim() !== moiBanDau.trim();
  /** GV có thực sự động vào bảng năng lực chưa (9 tiêu chí mở ra đã sẵn mức 3). */
  const [ratingsTouched, setRatingsTouched] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>(() => {
    const seed: Record<string, number> = {};
    for (const c of EVAL_CRITERIA)
      seed[c.id] = existing?.rubric?.[c.id] ?? DEFAULT_EVAL_LEVEL;
    return seed;
  });

  function submit() {
    // 19/08 — CHẶN phiếu bịa.
    //
    // Hộp thoại mở ra là đã có sẵn tên dự án (suy từ buổi) + cả 9 tiêu chí ở mức 3 (tiện
    // cho GV, giữ nguyên). Nhưng bấm Lưu ngay lúc đó thì hệ thống ghi một phiếu ĐẦY ĐỦ mà
    // không ai đánh giá gì, học viên bị đánh dấu "đã nhận xét", và phụ huynh mở cổng ra
    // đọc được bảng năng lực toàn mức 3 như thể giáo viên đã chấm. Phiếu ĐANG SỬA thì
    // không chặn — nội dung cũ vẫn còn nguyên đó.
    //
    // ⚠️ Chốt này CHỈ có ở client: `saveSessionEvalCore` không kiểm rỗng. Hiện vô hại vì
    // hộp thoại luôn gửi đủ 9 tiêu chí rubric ⇒ dòng ghi ra không bao giờ trắng, và các
    // màn đếm "đã nhận xét x/y" (site GV, /admin/attendance) đếm theo DÒNG. Ngày nào bỏ
    // rubric khỏi payload thì phải thêm chốt rỗng ở server, không thì hai màn đó báo
    // "nhận xét xong" cho những buổi chưa ai viết gì.
    if (!existing && overallLen === 0 && !ratingsTouched) {
      toast.error(
        "Phiếu chưa có nội dung — viết phần đánh giá chung hoặc chấm một tiêu chí rồi lưu.",
      );
      return;
    }
    // Phiếu CŨ ghép lại có thể dài hơn trần 2000 — chặn ở đây kèm số dư để GV tự rút gọn,
    // thay vì cắt ngầm (mất chữ) hay để zod trả một câu lỗi không nói được thừa bao nhiêu.
    if (tooLong) {
      toast.error(
        `Đánh giá chung dài ${overallLen} ký tự — vượt ${overallLen - EVAL_OVERALL_MAX} ký tự so với giới hạn ${EVAL_OVERALL_MAX}. Rút gọn rồi lưu lại.`,
      );
      return;
    }
    start(async () => {
      const res = await (luu ?? saveSessionEval)({
        sessionId,
        studentId,
        projectName,
        // Chỉ gửi `overall`: server tự dọn 4 khoá cũ về rỗng (EMPTY_NOTES spread) nên
        // phiếu cũ vừa viết lại không hiển thị song song hai bản nội dung.
        notes: { overall },
        rubric: ratings,
      });
      if (res.ok) {
        toast.success(`Đã lưu phiếu nhận xét — ${studentName}`);
        setSaved(true);
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        size="sm"
        variant={saved ? "outline" : "default"}
        onClick={() => setOpen(true)}
      >
        <ClipboardPen className="h-4 w-4" aria-hidden />
        {saved ? "Xem phiếu" : "Nhận xét"}
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Button>
      {saved && pdfHref && (
        <a
          href={pdfHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileDown className="h-3.5 w-3.5" aria-hidden /> Xuất PDF
        </a>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        {/* base DialogContent mặc định sm:max-w-sm (384px) → PHẢI override ở CHÍNH
            modifier sm: nếu không phiếu bị bó hẹp; 2 cột cần ~896px. */}
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-4xl overflow-y-auto p-5 sm:max-w-4xl">
          <DialogHeader className="mb-3">
            <DialogTitle>Nhận xét buổi học</DialogTitle>
            <DialogDescription>
              {studentName} · {courseName} · {sessionTopic} ({sessionDate})
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Dự án — TỰ ĐIỀN theo buổi (không còn ô nhập tay, xem ghi chú đầu file). */}
            <div>
              <p className="mb-1 text-sm font-semibold text-foreground">Dự án</p>
              <p className="rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-sm text-foreground">
                {projectName}
              </p>
            </div>

            <div className="grid items-start gap-4 md:grid-cols-2">
              {/* ① Nhận xét của giáo viên */}
              <section>
                <SectionTitle num={1} title="Nhận xét của giáo viên" />
                <div className="space-y-2 rounded-xl border border-border border-l-4 border-l-primary bg-muted/40 p-3.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <label
                      htmlFor="ev-overall"
                      className="text-xs font-bold text-primary-ink"
                    >
                      {EVAL_OVERALL_LABEL}{" "}
                      <span className="text-state-danger-ink" aria-hidden>
                        *
                      </span>
                    </label>
                    <span
                      className={cn(
                        "text-[11px] tabular-nums",
                        tooLong
                          ? "font-semibold text-state-danger-ink"
                          : "text-muted-foreground",
                      )}
                    >
                      {overallLen}/{EVAL_OVERALL_MAX}
                    </span>
                  </div>
                  <textarea
                    id="ev-overall"
                    value={overall}
                    onChange={(e) => setOverall(e.target.value)}
                    rows={10}
                    aria-invalid={tooLong || undefined}
                    placeholder="Nhận xét chung về buổi học của học viên (Kiến thức – Kỹ năng – Thái độ – Đề xuất)..."
                    className={cn(
                      "w-full resize-y rounded-lg border bg-card px-2.5 py-1.5 text-xs text-foreground outline-none focus:ring-2 dark:focus:ring-primary",
                      tooLong
                        ? "border-state-danger-soft focus:ring-state-danger-soft"
                        : "border-border focus:border-primary-soft focus:ring-primary-soft",
                    )}
                  />
                  <OverallGuide />
                </div>
              </section>

              {/* ② Đánh giá chi tiết năng lực */}
              <section className="space-y-3">
                <SectionTitle num={2} title="Đánh giá chi tiết năng lực" />
                <div className="space-y-3">
                  {GROUPS.map(([group, items]) => (
                    <div
                      key={group}
                      className="rounded-xl border border-border p-3.5"
                    >
                      <p className="mb-2 text-sm font-bold text-primary-ink">
                        {group}
                      </p>
                      <div className="space-y-2">
                        {items.map((c) => (
                          <div
                            key={c.id}
                            className="grid grid-cols-[1fr_1.2fr] items-center gap-1"
                          >
                            <label
                              htmlFor={`ev-${c.id}`}
                              className="line-clamp-2 text-xs font-semibold text-foreground"
                            >
                              {c.name}
                            </label>
                            <select
                              id={`ev-${c.id}`}
                              value={ratings[c.id]}
                              onChange={(e) => {
                                setRatingsTouched(true);
                                setRatings((r) => ({
                                  ...r,
                                  [c.id]: Number(e.target.value),
                                }));
                              }}
                              className="w-full rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-primary-soft focus:ring-2 focus:ring-primary-soft dark:focus:ring-primary"
                            >
                              {c.levels.map((lv) => (
                                <option key={lv.value} value={lv.value}>
                                  {lv.text}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Thao tác */}
            <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
              {saved && (
                <Badge
                  variant="outline"
                  className="border-state-success-soft bg-state-success-soft text-state-success-ink dark:border-state-success"
                >
                  <CircleCheck className="h-3.5 w-3.5" aria-hidden /> Đã lưu
                  nhận xét
                </Badge>
              )}
              <Button
                variant={saved ? "outline" : "default"}
                onClick={submit}
                disabled={pending}
              >
                <Save className="mr-1.5 h-4 w-4" aria-hidden />
                {pending ? "Đang lưu…" : "Lưu nhận xét"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Khối gợi ý cách viết "Đánh giá chung" (chốt 21/08). Mặc định MỞ: đây là thứ thay cho
 * 4 ô nhãn cũ — gập sẵn thì giáo viên mất luôn manh mối phải viết đủ 4 khía cạnh.
 */
function OverallGuide() {
  return (
    <details open className="rounded-lg border border-border bg-card/70 px-2.5 py-2">
      {/* Câu mở đầu VỪA là nhãn gập VỪA là nội dung hướng dẫn — đừng thêm một <p> lặp
          lại nó bên dưới (đã thử, và nó hiện ra hai lần trong hộp thoại). */}
      <summary className="cursor-pointer list-none text-[11px] font-semibold italic text-primary-ink marker:content-none">
        {EVAL_OVERALL_GUIDE_INTRO}
      </summary>
      <div className="mt-1.5 space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {EVAL_OVERALL_GUIDE_ITEMS.map((it) => (
          <p key={it.label} className="italic">
            <span className="font-bold text-primary-ink not-italic">{it.label}:</span>{" "}
            {it.text}
          </p>
        ))}
        <p>
          <span className="font-bold text-foreground">Lưu ý:</span>{" "}
          {EVAL_OVERALL_GUIDE_NOTE}
        </p>
      </div>
    </details>
  );
}

function SectionTitle({ num, title }: { num: number; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-extrabold text-white">
        {num}
      </span>
      <h3 className="text-sm font-bold uppercase tracking-wide text-primary-ink">
        {title}
      </h3>
    </div>
  );
}
