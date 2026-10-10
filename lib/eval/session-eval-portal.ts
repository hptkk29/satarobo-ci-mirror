// lib/eval/session-eval-portal.ts — FL4-02: ĐỌC phiếu đánh giá BUỔI HỌC (SESSION_EVAL)
// cho PORTAL phụ huynh. File MỚI riêng cho lane EVAL-B — KHÔNG sửa session-eval.ts /
// rounds.ts / schema.ts (EVAL-A/EVAL-C giữ); chỉ IMPORT type + parseOptions thuần.
//
// Phụ huynh xem phiếu của ĐÚNG con đang chọn (active site). Caller (page) phải gọi
// requireActiveStudent() trước — helper nhận studentId đã verify ownership, KHÔNG nhận
// studentId từ URL (không lộ studentId). Ảnh buổi gate theo StudentConsent CLASS_MEDIA.
//
// PURE (test được, không DB): renderAnswers — map EvalAnswer → khối hiển thị theo loại
// câu hỏi (sao / đáp án / tự luận), bỏ câu chưa trả lời, sắp theo thứ tự câu hỏi.
import { db } from "@/lib/db";
import { hasMediaConsent } from "@/lib/lms/media-consent";
import { resolveMediaUrl } from "@/lib/storage/signed-url";
import { parseOptions, type QuestionType } from "@/lib/eval/schema";
import {
  applyEvalPhotoGate,
  blockedEvalPhotoUrls,
  type MirrorRow,
} from "@/lib/eval/session-eval-photo-gate";

/** Đáp án thô để render — valueOptions là Json (Prisma) nên nhận unknown, parseOptions narrow. */
export type RawAnswer = {
  questionId: string;
  valueNumber?: number | null;
  valueOptions?: unknown;
  valueText?: string | null;
};

// ─── PURE — render 1 đáp án theo loại câu hỏi ────────────────────────────────
export type QuestionMeta = {
  label: string;
  type: QuestionType;
  order: number;
};

export type RenderedAnswer = {
  questionId: string;
  label: string;
  type: QuestionType;
  /** STAR_RATING — số sao đã chọn (1–5), null nếu không phải sao. */
  stars: number | null;
  /** RADIO/CHECKBOX — (các) đáp án đã chọn. */
  options: string[] | null;
  /** TEXTBOX hoặc ghi chú tự do (allowCustomText) — nhận xét tự luận. */
  text: string | null;
  /** PHOTO — URL ảnh (chỉ trả khi PH đã consent CLASS_MEDIA; ngược lại null). */
  photos: string[] | null;
};

/** Đáp án đã trả lời thật sự (không phải câu để trống) → mới hiển thị. */
function isAnswered(a: RenderedAnswer): boolean {
  return (
    a.stars != null ||
    (a.options != null && a.options.length > 0) ||
    (a.text != null && a.text.length > 0) ||
    (a.photos != null && a.photos.length > 0)
  );
}

/**
 * PURE — map đáp án đã lưu của 1 phiếu sang khối hiển thị, dùng metadata câu hỏi
 * (label/type/order). Bỏ đáp án không khớp câu hỏi nào, bỏ câu chưa trả lời, sắp
 * theo thứ tự câu hỏi (order) để PH đọc đúng bố cục GV dựng.
 */
export function renderAnswers(
  questionMeta: Map<string, QuestionMeta>,
  answers: ReadonlyArray<RawAnswer>,
): RenderedAnswer[] {
  const out: { rendered: RenderedAnswer; order: number }[] = [];
  for (const a of answers) {
    const meta = questionMeta.get(a.questionId);
    if (!meta) continue; // câu hỏi đã xóa / không thuộc form → bỏ qua

    const rendered: RenderedAnswer = {
      questionId: a.questionId,
      label: meta.label,
      type: meta.type,
      stars: null,
      options: null,
      text: null,
      photos: null,
    };

    if (meta.type === "STAR_RATING") {
      rendered.stars = a.valueNumber ?? null;
    } else if (meta.type === "RADIO" || meta.type === "CHECKBOX") {
      const opts = parseOptions(a.valueOptions);
      rendered.options = opts.length > 0 ? opts : null;
    } else if (meta.type === "PHOTO") {
      const urls = parseOptions(a.valueOptions);
      rendered.photos = urls.length > 0 ? urls : null;
    } else {
      // TEXTBOX
      const t = (a.valueText ?? "").trim();
      rendered.text = t.length > 0 ? t : null;
    }

    // Ghi chú tự do (allowCustomText) đi kèm STAR/RADIO/CHECKBOX → hiển thị cùng.
    if (meta.type !== "TEXTBOX" && meta.type !== "PHOTO") {
      const ct = (a.valueText ?? "").trim();
      if (ct.length > 0) rendered.text = ct;
    }

    if (isAnswered(rendered)) out.push({ rendered, order: meta.order });
  }
  out.sort((x, y) => x.order - y.order);
  return out.map((o) => o.rendered);
}

// ─── DB-backed — phiếu SESSION_EVAL của 1 học sinh ───────────────────────────
export type SessionEvalCard = {
  responseId: string;
  roundName: string;
  classSessionId: string;
  sessionDate: Date | null;
  sessionTopic: string | null;
  className: string | null;
  classCode: string | null;
  teacherName: string | null;
  submittedAt: Date;
  answers: RenderedAnswer[];
};

/**
 * Phiếu đánh giá buổi (SESSION_EVAL) của 1 học sinh, nhóm theo buổi học.
 * studentId PHẢI là con đã verify ownership (active site) — KHÔNG nhận từ URL.
 * Mỗi response = 1 phiếu (đợt × buổi × HS); join answers→question để render đúng loại.
 */
export async function getStudentSessionEvals(studentId: string): Promise<SessionEvalCard[]> {
  const responses = await db.evalResponse.findMany({
    where: { studentId, round: { scope: "SESSION_EVAL" }, classSessionId: { not: null } },
    orderBy: { submittedAt: "desc" },
    take: 200,
    select: {
      id: true,
      submittedAt: true,
      classSessionId: true,
      round: { select: { name: true } },
      answers: { select: { questionId: true, valueNumber: true, valueOptions: true, valueText: true } },
    },
  });
  if (responses.length === 0) return [];

  // Metadata câu hỏi (label/type/order) cho mọi questionId xuất hiện.
  const questionIds = [...new Set(responses.flatMap((r) => r.answers.map((a) => a.questionId)))];
  const questions = questionIds.length
    ? await db.evalQuestion.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, label: true, type: true, order: true },
      })
    : [];
  const questionMeta = new Map<string, QuestionMeta>(
    questions.map((q) => [q.id, { label: q.label, type: q.type, order: q.order }]),
  );

  // Thông tin buổi học (ngày/chủ đề/lớp/GV) cho mọi classSessionId.
  const sessionIds = [...new Set(responses.map((r) => r.classSessionId!).filter(Boolean))];
  const sessions = sessionIds.length
    ? await db.classSession.findMany({
        where: { id: { in: sessionIds } },
        select: {
          id: true,
          date: true,
          topic: true,
          class: { select: { name: true, classCode: true, teacher: { select: { name: true } } } },
        },
      })
    : [];
  const sessionMeta = new Map(sessions.map((s) => [s.id, s]));

  // Ảnh PHOTO trong phiếu (urls ở valueOptions) qua HAI cổng:
  //  1. StudentConsent CLASS_MEDIA — chưa consent → bỏ hẳn câu PHOTO (như cũ).
  //  2. F-04 — phải ĐÃ DUYỆT trong hàng duyệt ảnh lớp. Trước bản vá cổng này không tồn
  //     tại: giáo viên bấm Lưu phiếu là ảnh ra thẳng cổng phụ huynh, không ai duyệt.
  //     Ảnh mới luôn có bản ghi ClassSessionMedia (ghi cùng transaction lưu phiếu —
  //     xem lib/eval/session-eval.ts); ảnh KHÔNG có bản ghi nào là ảnh trước bản vá,
  //     cố ý giữ nguyên để phụ huynh không mất ảnh đang xem. Chi tiết + cách đóng nốt
  //     điều khoản chuyển tiếp: lib/eval/session-eval-photo-gate.ts.
  const consentGranted = await hasMediaConsent(studentId);
  const photoUrls = new Set<string>();
  if (consentGranted) {
    for (const r of responses) {
      for (const a of r.answers) {
        const meta = questionMeta.get(a.questionId);
        if (meta?.type === "PHOTO") for (const u of parseOptions(a.valueOptions)) photoUrls.add(u);
      }
    }
  }
  const urlList = [...photoUrls];
  const [resolved, mirrorRows] = await Promise.all([
    Promise.all(urlList.map(async (u) => [u, await resolveMediaUrl(u)] as const)),
    urlList.length
      ? db.classSessionMedia.findMany({
          where: { fileUrl: { in: urlList } },
          select: { fileUrl: true, status: true },
        })
      : Promise.resolve([] as MirrorRow[]),
  ]);
  const urlMap = new Map(resolved);
  const blockedPhotos = blockedEvalPhotoUrls(mirrorRows);

  return responses.map((r) => {
    const sess = r.classSessionId ? sessionMeta.get(r.classSessionId) : undefined;
    // Thứ tự BẮT BUỘC: lọc consent → lọc F-04 (trên URL THÔ) → mới ký URL. Ký trước
    // rồi mới lọc thì key trong bảng chặn không còn khớp và cổng thành vô hiệu.
    const answers = applyEvalPhotoGate(
      renderAnswers(questionMeta, r.answers)
        // chưa consent → ẩn câu ảnh
        .filter((a) => a.type !== "PHOTO" || consentGranted),
      blockedPhotos,
    ).map((a) =>
      a.type === "PHOTO" && a.photos
        ? { ...a, photos: a.photos.map((u) => urlMap.get(u) ?? u) }
        : a,
    );
    return {
      responseId: r.id,
      roundName: r.round.name,
      classSessionId: r.classSessionId!,
      sessionDate: sess?.date ?? null,
      sessionTopic: sess?.topic ?? null,
      className: sess?.class.name ?? null,
      classCode: sess?.class.classCode ?? null,
      teacherName: sess?.class.teacher?.name ?? null,
      submittedAt: r.submittedAt,
      answers,
    };
  });
}

// ─── DB-backed — ảnh buổi học của con (gate theo StudentConsent CLASS_MEDIA) ──
export type SessionMediaItem = {
  id: string;
  url: string;
  caption: string | null;
  takenAt: Date | null;
  tagged: boolean;
};

/**
 * Ảnh ClassSessionMedia APPROVED gắn các buổi của con, nhóm theo classSessionId.
 * Privacy (Doc 15 / C6.x): chỉ trả ảnh khi con đã GRANTED consent CLASS_MEDIA; thu hồi
 * → ẩn ngay (trả map rỗng). Hiển thị ảnh gắn thẻ con HOẶC ảnh chung cả lớp (isClassWide);
 * ảnh gắn thẻ HS khác / không tag & không class-wide → KHÔNG hiện (bất biến C6.2).
 * sessionIds đã giới hạn ở các buổi con được đánh giá → không lộ buổi của HS khác.
 */
export async function getSessionMediaForStudent(
  studentId: string,
  sessionIds: string[],
): Promise<Map<string, SessionMediaItem[]>> {
  const result = new Map<string, SessionMediaItem[]>();
  if (sessionIds.length === 0) return result;

  const consentGranted = await hasMediaConsent(studentId);
  if (!consentGranted) return result;

  const rawMedia = await db.classSessionMedia.findMany({
    where: {
      classSessionId: { in: sessionIds },
      status: "APPROVED",
      OR: [{ tags: { some: { studentId } } }, { isClassWide: true }],
    },
    select: {
      id: true,
      classSessionId: true,
      fileUrl: true,
      caption: true,
      takenAt: true,
      createdAt: true,
      tags: { where: { studentId }, select: { id: true }, take: 1 },
    },
    orderBy: [{ takenAt: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  if (rawMedia.length === 0) return result;

  const urls = await Promise.all(rawMedia.map((m) => resolveMediaUrl(m.fileUrl)));

  rawMedia.forEach((m, i) => {
    if (!m.classSessionId) return;
    const item: SessionMediaItem = {
      id: m.id,
      url: urls[i] ?? m.fileUrl,
      caption: m.caption,
      takenAt: m.takenAt,
      tagged: m.tags.length > 0,
    };
    const list = result.get(m.classSessionId);
    if (list) list.push(item);
    else result.set(m.classSessionId, [item]);
  });

  return result;
}
