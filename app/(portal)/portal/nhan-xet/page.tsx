import { requireActiveStudent } from "@/lib/portal/session";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import {
  getStudentSessionEvals,
  getSessionMediaForStudent,
  type RenderedAnswer,
} from "@/lib/eval/session-eval-portal";
import { ngayVN } from "@/lib/format/date";
import { isPortalV2Enabled } from "@/lib/flags";
import {
  getSessionNumberMapForClasses,
  getStudentFeedback,
  parseFeedbackNotes,
  parseFeedbackRubric,
} from "@/lib/portal/feedback";
import {
  EVAL_OVERALL_LABEL,
  evalLevelText,
  evalNotesProse,
  groupedEvalCriteria,
} from "@/lib/lms/session-eval-rubric";
import { sessionNumberLabel } from "@/lib/lms/session-order";
import { resolveDisplayProjectName } from "@/lib/lms/session-project-name";
import { NhanXetPageV2 } from "@/components/portal/nhan-xet-page";

// Nhóm rubric (9 tiêu chí × 4 nhóm) — cùng nguồn nhãn với V2 (components/portal/nhan-xet-page).
const RUBRIC_GROUPS = groupedEvalCriteria();

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Nhận xét | Sata Robo",
  robots: { index: false },
};

function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// LMS-2 / FL4-02 — phụ huynh xem nhận xét theo buổi của ĐÚNG con đang chọn (active site).
// Hiển thị song song: (1) nhận xét StudentSessionFeedback — comment+rating VÀ phiếu
// mở rộng site GV (Dự án + 4 mục văn xuôi + rubric 9 tiêu chí, FIX #2 08/2026 — trước
// đây V1 chỉ render comment nên phiếu rubric-only ra card trống) và (2) phiếu đánh
// giá buổi học mới (SESSION_EVAL) kèm ảnh buổi (gate theo consent).
export default async function NhanXetPage() {
  const { ctx, studentId } = await requireActiveStudent();

  // Portal v2 — trang Nhận xét giống SataUI (master-detail).
  if (isPortalV2Enabled()) {
    // 06/09 — truyền LIMIT rõ ràng. Mặc định của hàm là 20 (đủ cho 3 thẻ ở bảng tin),
    // nhưng trang Nhận xét là nơi phụ huynh xem lại cả khoá: bản v1 nạp 100, bản v2 lặng
    // lẽ cắt còn 20 nên nhận xét các buổi đầu khoá biến mất mà không có nút "xem thêm".
    const [items, evals] = await Promise.all([
      getStudentFeedback(studentId, 100),
      // Parity với bản v1: phiếu SESSION_EVAL của module Đánh giá. Bản v2 trước đây bỏ
      // hẳn nhóm này, nên trung tâm nào chấm buổi bằng module đó thì phụ huynh mất sạch
      // phần ấy kể từ ngày prod bật cờ v2.
      getStudentSessionEvals(studentId).catch(() => []),
    ]);
    return (
      <NhanXetPageV2
        kids={ctx.children.map((c) => ({ id: c.id, name: c.name }))}
        activeId={ctx.activeStudent?.id ?? null}
        studentName={ctx.activeStudent?.name ?? "con"}
        items={items}
        phieuDanhGia={evals.map((ev) => ({
          responseId: ev.responseId,
          tieuDe: [ev.classCode, ev.className ?? ev.roundName].filter(Boolean).join(" · "),
          // Ngày tính sẵn ở server theo lịch VN — component là client, thiết bị phụ
          // huynh có thể ở múi giờ khác.
          nhanNgay: ev.sessionDate ? ngayVN(ev.sessionDate) : "—",
          teacherName: ev.teacherName,
          sessionTopic: ev.sessionTopic,
          answers: ev.answers.map((a) => ({
            questionId: a.questionId,
            label: a.label,
            stars: a.stars,
            options: a.options,
            text: a.text,
          })),
        }))}
      />
    );
  }

  // StudentSessionFeedback KHÔNG thuộc SCOPED_MODELS → scopedDb pass-through
  // (cách ly bằng ownership: studentId đã verify qua requireActiveStudent; nested
  // include classSession/class chỉ đọc metadata buổi của chính feedback đó).
  const sdb = scopedDb(await resolveActor(ctx.parentUserId));
  const [feedbacks, evals] = await Promise.all([
    sdb.studentSessionFeedback.findMany({
      where: { studentId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        comment: true,
        rating: true,
        // FIX #2 — phiếu mở rộng site GV (Dự án + 4 mục + rubric 9 tiêu chí): V1 trước
        // đây chỉ đọc comment+rating → phiếu rubric-only ra card TRỐNG với phụ huynh.
        projectName: true,
        notes: true,
        rubric: true,
        createdAt: true,
        classSessionId: true,
        classSession: {
          select: {
            classId: true,
            date: true,
            topic: true,
            plan: { select: { customTitle: true, order: true } },
            lesson: { select: { order: true, title: true, moduleCode: true } },
            class: {
              select: {
                name: true,
                classCode: true,
                teacher: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    getStudentSessionEvals(studentId),
  ]);

  // R1 21/08 — SỐ BUỔI cho phụ huynh, tính trên TOÀN BỘ buổi của các lớp có phiếu
  // (lib/lms/session-order), để phụ huynh và giáo viên gọi một buổi bằng cùng một số.
  // ⚠️ Bản V2 (components/portal/nhan-xet-page) lấy số qua lib/portal/feedback — file
  // ĐÓ KHÔNG phục vụ trang này — hai bản có hai đường lấy số buổi riêng, sửa một bên là
  // "sửa xong mà không thấy đổi".
  // ⚠️ ĐÍNH CHÍNH 06/09: bản ghi chú cũ ở đây viết "cờ PORTAL_V2_ENABLED mặc định OFF nên
  // V1 mới là bản phụ huynh đang thấy". SAI với thực tế đang chạy — `lib/flags.ts` mặc
  // định OFF, nhưng Vercel **Production đặt `PORTAL_V2_ENABLED="true"`**, nên KHÁCH HÀNG
  // THẬT ĐANG XEM BẢN V2. Câu đó đã dẫn người sửa vào đúng nhánh không ai dùng một lần
  // rồi (04/09). Sửa lỗi hiển thị của phụ huynh thì V2 là bản phải sửa TRƯỚC.
  const fbClassIds = [
    ...new Set(
      feedbacks.map((f) => f.classSession?.classId).filter((x): x is string => !!x),
    ),
  ];
  const [mediaBySession, sessionNumberOf] = await Promise.all([
    // Ảnh buổi gắn các buổi có phiếu đánh giá — gate theo StudentConsent CLASS_MEDIA.
    getSessionMediaForStudent(
      studentId,
      evals.map((e) => e.classSessionId),
    ),
    getSessionNumberMapForClasses(fbClassIds),
  ]);

  const hasAny = feedbacks.length > 0 || evals.length > 0;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold text-neutral-900">
        Nhận xét của giáo viên
      </h1>

      {!hasAny && (
        <p className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">
          Chưa có nhận xét nào cho con.
        </p>
      )}

      {/* (2) Phiếu đánh giá buổi học (SESSION_EVAL) */}
      {evals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Phiếu đánh giá buổi học
          </h2>
          <ul className="space-y-3">
            {evals.map((ev) => {
              const media = mediaBySession.get(ev.classSessionId) ?? [];
              return (
                <li
                  key={ev.responseId}
                  className="rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-neutral-900">
                      {ev.classCode ? `${ev.classCode} · ` : ""}
                      {ev.className ?? ev.roundName}
                    </span>
                    {ev.sessionDate && (
                      <span className="text-xs tabular-nums text-neutral-500">
                        {fmtDate(ev.sessionDate)}
                      </span>
                    )}
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                    <span>GV: {ev.teacherName ?? "—"}</span>
                    {ev.sessionTopic && <span>· {ev.sessionTopic}</span>}
                  </div>

                  {ev.answers.length === 0 ? (
                    <p className="text-sm text-neutral-500">
                      Phiếu chưa có nội dung.
                    </p>
                  ) : (
                    <dl className="space-y-2">
                      {ev.answers.map((a) => (
                        <AnswerRow key={a.questionId} answer={a} />
                      ))}
                    </dl>
                  )}

                  {media.length > 0 && (
                    <div className="mt-3 border-t border-neutral-100 pt-3">
                      <p className="mb-1.5 text-xs font-medium text-neutral-500">
                        Hình ảnh buổi học
                      </p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {media.map((m) => (
                          <a
                            key={m.id}
                            href={m.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="overflow-hidden rounded-lg border border-neutral-200"
                          >
                            <img
                              src={m.url}
                              alt={m.caption ?? "Ảnh buổi học"}
                              className="h-20 w-full object-cover sm:h-24"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* (1) Nhận xét cũ (StudentSessionFeedback) — giữ song song */}
      {feedbacks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Nhận xét theo buổi
          </h2>
          <ul className="space-y-3">
            {feedbacks.map((f) => {
              // FIX #2 — parse phiếu mở rộng bằng ĐÚNG helper của V2 (lib/portal/feedback)
              // để 2 bản không lệch nội dung: notes ưu tiên hơn comment (phiếu mới lưu
              // comment = 4 mục nối lại, render cả 2 sẽ lặp); rubric render theo nhóm.
              // 21/08 — MỘT cửa đọc văn xuôi: phiếu mới ("Đánh giá chung") lẫn phiếu cũ
              // (4 mục). Xem lib/lms/session-eval-rubric#evalNotesProse.
              const prose = evalNotesProse(parseFeedbackNotes(f.notes));
              const rubric = parseFeedbackRubric(f.rubric);
              return (
                <li
                  key={f.id}
                  className="rounded-xl border border-neutral-200 bg-white p-4"
                >
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-neutral-900">
                      {sessionNumberOf.has(f.classSessionId)
                        ? `${sessionNumberLabel(sessionNumberOf.get(f.classSessionId))} · `
                        : ""}
                      {f.classSession.class.classCode
                        ? `${f.classSession.class.classCode} · `
                        : ""}
                      {f.classSession.class.name}
                    </span>
                    <span className="text-xs tabular-nums text-neutral-500">
                      {fmtDate(f.classSession.date)}
                    </span>
                  </div>
                  <div className="mb-1.5 flex items-center gap-2 text-xs text-neutral-600">
                    <span>GV: {f.classSession.class.teacher?.name ?? "—"}</span>
                    {f.rating != null && (
                      <span className="text-amber-500">
                        {"★".repeat(f.rating)}
                        {"☆".repeat(5 - f.rating)}
                      </span>
                    )}
                  </div>

                  {/* 26/08 — tên dự án suy từ BUỔI, không in bản sao đông cứng trên
                      phiếu: cùng một buổi mà mỗi học viên lưu một "dự án" khác nhau
                      (xem resolveDisplayProjectName). */}
                  {(() => {
                    const duAn = resolveDisplayProjectName(
                      {
                        sessionNumber:
                          sessionNumberOf.get(f.classSessionId) ?? null,
                        planTitle: f.classSession?.plan?.customTitle,
                        planOrder: f.classSession?.plan?.order,
                        lessonTitle: f.classSession?.lesson?.title,
                        lessonOrder: f.classSession?.lesson?.order,
                        moduleCode: f.classSession?.lesson?.moduleCode,
                        topic: f.classSession?.topic,
                      },
                      f.projectName,
                    );
                    return duAn ? (
                      <p className="mb-1.5 text-sm text-neutral-700">
                        <span className="font-semibold text-neutral-900">
                          Dự án:
                        </span>{" "}
                        {duAn}
                      </p>
                    ) : null;
                  })()}

                  {prose?.kind === "overall" ? (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        {EVAL_OVERALL_LABEL}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-neutral-700">
                        {prose.text}
                      </p>
                    </div>
                  ) : prose?.kind === "legacy" ? (
                    <div className="space-y-1">
                      {prose.rows.map((fld) => (
                        <p
                          key={fld.key}
                          className="whitespace-pre-wrap text-sm text-neutral-700"
                        >
                          <span className="font-semibold text-neutral-900">
                            {fld.label}:
                          </span>{" "}
                          {fld.text}
                        </p>
                      ))}
                    </div>
                  ) : f.comment?.trim() ? (
                    <p className="whitespace-pre-wrap text-sm text-neutral-700">
                      {f.comment}
                    </p>
                  ) : (
                    <p className="text-sm text-neutral-500">
                      {rubric
                        ? "Buổi này giáo viên đánh giá qua bảng năng lực bên dưới."
                        : "Chưa có nội dung nhận xét chi tiết cho buổi này."}
                    </p>
                  )}

                  {rubric && (
                    <div className="mt-3 space-y-2.5 border-t border-neutral-100 pt-3">
                      {RUBRIC_GROUPS.map(([group, items]) => {
                        const rows = items.filter((c) => rubric[c.id] != null);
                        if (rows.length === 0) return null;
                        return (
                          <div key={group}>
                            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                              {group}
                            </p>
                            <div className="mt-1 space-y-1.5">
                              {rows.map((c) => (
                                <div key={c.id}>
                                  <p className="text-sm font-medium text-neutral-900">
                                    {c.name}
                                  </p>
                                  <p className="text-sm leading-relaxed text-neutral-600">
                                    {evalLevelText(c.id, rubric[c.id]) ||
                                      `Mức ${rubric[c.id]}/5`}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function AnswerRow({ answer }: { answer: RenderedAnswer }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{answer.label}</dt>
      <dd className="text-sm text-neutral-800">
        {answer.type === "STAR_RATING" && answer.stars != null && (
          <span className="text-amber-500">
            {"★".repeat(answer.stars)}
            {"☆".repeat(5 - answer.stars)}
          </span>
        )}
        {(answer.type === "RADIO" || answer.type === "CHECKBOX") &&
          answer.options && <span>{answer.options.join(", ")}</span>}
        {answer.type === "PHOTO" &&
          answer.photos &&
          answer.photos.length > 0 && (
            <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {answer.photos.map((u) => (
                <a
                  key={u}
                  href={u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="overflow-hidden rounded-lg border border-neutral-200"
                >
                  <img
                    src={u}
                    alt="Ảnh dự án"
                    className="h-20 w-full object-cover sm:h-24"
                  />
                </a>
              ))}
            </div>
          )}
        {answer.type !== "PHOTO" && answer.text && (
          <span className="whitespace-pre-wrap">{answer.text}</span>
        )}
      </dd>
    </div>
  );
}
