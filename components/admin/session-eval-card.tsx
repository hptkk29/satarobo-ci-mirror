import { displayProjectName } from "@/lib/lms/session-project-name";
import {
  EVAL_OVERALL_LABEL,
  evalLevelText,
  evalNotesProse,
  groupedEvalCriteria,
  type EvalNotes,
} from "@/lib/lms/session-eval-rubric";

// Thẻ hiển thị MỘT phiếu nhận xét buổi (StudentSessionFeedback) cho phía quản lý.
// Chỉ đọc, không state → server component, dùng được cả trong trang lớp lẫn trang buổi.
// Cách render bám theo bản phụ huynh đang thấy (components/portal/nhan-xet-page.tsx)
// để QL/Đào tạo và PH đọc cùng một nội dung, không lệch cách hiểu.

const GROUPS = groupedEvalCriteria();

export type SessionEvalCardData = {
  projectName: string | null;
  notes: EvalNotes | null;
  rubric: Record<string, number> | null;
  comment: string;
  rating: number | null;
  teacherName: string | null;
};

function RatingStars({ rating }: { rating: number }) {
  const r = Math.min(5, Math.max(0, Math.trunc(rating)));
  return (
    <p className="text-sm text-amber-500" aria-label={`Đánh giá ${r}/5 sao`}>
      {"★".repeat(r)}
      {"☆".repeat(5 - r)}
    </p>
  );
}

/** comment cũ lưu nhiều dòng "Nhãn: nội dung" — tách nhãn cho dễ đọc. */
function CommentBody({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1 rounded-lg bg-muted/50 p-3">
      {lines.map((l, i) => {
        const m = l.match(/^([^:]+):\s*(.*)$/);
        return (
          <p key={i} className="text-sm leading-relaxed text-muted-foreground">
            {m ? (
              <>
                <span className="font-semibold text-primary">{m[1]}:</span> {m[2]}
              </>
            ) : (
              l
            )}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Văn xuôi của phiếu. Hai dạng dữ liệu cùng tồn tại từ 21/08 (xem evalNotesProse):
 * phiếu mới = một đoạn "Đánh giá chung"; phiếu cũ = 4 mục có nhãn.
 */
function NotesBody({ notes }: { notes: EvalNotes }) {
  const prose = evalNotesProse(notes);
  if (!prose) return null;
  if (prose.kind === "overall") {
    return (
      <div className="space-y-1 rounded-lg bg-muted/50 p-3">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          {EVAL_OVERALL_LABEL}
        </p>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
          {prose.text}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-lg bg-muted/50 p-3">
      {prose.rows.map((r) => (
        <p key={r.key} className="text-sm leading-relaxed text-muted-foreground">
          <span className="font-semibold text-primary">{r.label}:</span> {r.text}
        </p>
      ))}
    </div>
  );
}

function RubricBody({ rubric }: { rubric: Record<string, number> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {GROUPS.map(([group, items]) => {
        const rows = items.filter((c) => rubric[c.id] != null);
        if (rows.length === 0) return null;
        return (
          <div key={group} className="rounded-lg bg-muted/50 p-3">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {group}
            </p>
            <div className="mt-1.5 space-y-1.5">
              {rows.map((c) => (
                <div key={c.id}>
                  <p className="text-sm font-semibold text-foreground">
                    {c.name}{" "}
                    <span className="font-normal text-muted-foreground">
                      ({rubric[c.id]}/5)
                    </span>
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {evalLevelText(c.id, rubric[c.id]) || `Mức ${rubric[c.id]}/5`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SessionEvalCard({
  title,
  subtitle,
  data,
}: {
  /** Dòng đầu thẻ — tuỳ ngữ cảnh: tên buổi (xem theo HV) hoặc tên HV (xem theo buổi). */
  title: string;
  subtitle?: string | null;
  data: SessionEvalCardData;
}) {
  const { projectName, notes, rubric, comment, rating, teacherName } = data;
  const hasProse = notes != null || comment.trim().length > 0;

  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <header className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm font-bold text-foreground">{title}</h4>
        <p className="text-xs text-muted-foreground">
          {subtitle}
          {subtitle && teacherName ? " · " : ""}
          {teacherName ? `GV: ${teacherName}` : ""}
        </p>
      </header>

      {projectName && (
        <p className="mb-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">Dự án:</span>{" "}
          {displayProjectName(projectName)}
        </p>
      )}

      {rating != null && <RatingStars rating={rating} />}

      {/* Phiếu mới lưu comment = 4 mục notes nối lại → render CẢ HAI là lặp nội dung. */}
      <div className="mt-2 space-y-3">
        {notes ? (
          <NotesBody notes={notes} />
        ) : comment.trim() ? (
          <CommentBody text={comment} />
        ) : (
          <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {rubric
              ? "Buổi này giáo viên đánh giá qua bảng năng lực bên dưới."
              : "Phiếu chưa có nội dung nhận xét."}
          </p>
        )}

        {rubric && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Đánh giá năng lực
            </p>
            <RubricBody rubric={rubric} />
          </div>
        )}
      </div>

      {!hasProse && !rubric && rating == null && (
        <p className="mt-2 text-xs italic text-muted-foreground">
          Phiếu trống — giáo viên đã mở phiếu nhưng chưa điền nội dung nào.
        </p>
      )}
    </article>
  );
}
