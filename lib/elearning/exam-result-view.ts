import type { ScopedDb } from "@/lib/actions/factory";
import { cueInlineSchema, laCauChamDuoc, locCauHoiChoNguoiHoc, type CauHoiCue } from "@/lib/elearning/lesson-cue";
import { duocXemDapAn, laCauSo, soLuotChoPhep } from "@/lib/elearning/exam-grading";
import { cauSoSchema } from "@/lib/elearning/cham-so";

/**
 * KẾT QUẢ MỘT LƯỢT THI cho NGƯỜI THI — màn "Xem lại bài kiểm tra" (`/hoc/[lượt]/[bài]/ket-qua`).
 *
 * ⚠️ MODULE RIÊNG, cố ý: `exam-view.ts` (loader của lúc ĐANG THI) bị lưới `lam-bai-thi-ui` ghim "không có `isCorrect`/`correctIndex`".
 * Loader này CÓ đọc đáp án đúng nên phải nằm ngoài tệp đó — gộp vào là phải gỡ lưới chống lộ đề.
 *
 * ⚠️ LỘ ĐÁP ÁN ở tầng DỮ LIỆU, không ở giao diện. `duocXemDapAn` (chính sách của ĐỀ: NEVER / AFTER_EACH_ATTEMPT / AFTER_LAST_ATTEMPT) quyết định
 * MỘT lần ở đây; khi KHÔNG được xem thì kết quả TỪNG CÂU (đúng/sai, điểm, đáp án đúng, lời giải) bị bỏ HẲN khỏi phần trả về — kể cả cờ
 * đúng/sai, vì với câu hai lựa chọn "sai" đã là "đáp án là cái còn lại". Chỉ còn tổng điểm, đạt/chưa đạt và câu NGƯỜI THI đã trả lời.
 *
 * ⚠️ Chỉ lượt ĐÃ NỘP (không bao giờ `IN_PROGRESS`) và chỉ của CHÍNH `userId`: lượt của người khác ≡ không có lượt.
 */

export type CauKetQua = {
  thuTu: number;
  stem: string;
  type: string;
  points: number;
  /** Nhãn các lựa chọn NGƯỜI THI đã chọn (câu chọn). */
  daChon: string[];
  /** Câu tự luận: chữ đã gõ. */
  textAnswer: string | null;
  /** CHỈ có khi được xem đáp án. `null` = chưa chấm (chờ người) hoặc không được xem. */
  dung: boolean | null;
  diem: number | null;
  /** Nhãn đáp án ĐÚNG (câu chấm máy) — CHỈ có khi được xem đáp án. */
  dapAnDung: string[] | null;
  giaiThich: string | null;
  /** Câu NHẬP SỐ: gợi ý của người soạn — CHỈ khi được xem đáp án VÀ trả lời SAI (đã nộp). Câu khác / đúng / chưa được xem ⇒ `null`. */
  goiY?: string | null;
};

export type KetQuaThi = {
  tenDe: string;
  passScore: number;
  maxScore: number;
  luot: {
    attemptNo: number;
    status: string;
    submittedAt: Date | null;
    totalScore: number | null;
    passed: boolean | null;
    /** Còn câu chờ người chấm ⇒ `totalScore`/`passed` là `null`. */
    choChamTay: boolean;
    feedback: string | null;
  };
  soLuotDaDung: number;
  soLuotChoPhep: number;
  /** Kết luận của `duocXemDapAn` — màn dùng để NÓI VÌ SAO chưa có đáp án. */
  choPhepXemDapAn: boolean;
  /** Chính sách của đề (NEVER / AFTER_EACH_ATTEMPT / AFTER_LAST_ATTEMPT) — không nhạy cảm; để màn nói ĐÚNG vì sao chưa có đáp án. */
  chinhSachXemDapAn: string;
  /** Rỗng khi KHÔNG được xem đáp án? Không: vẫn liệt kê câu + điều NGƯỜI THI đã chọn; chỉ bỏ đúng/sai/điểm/đáp án/lời giải. */
  cacCau: CauKetQua[];
};

/** "60 cm (± 1)" — đáp án đúng của câu nhập số, đúng một định dạng cho màn kết quả. */
export function nhanDapAnSo(c: { answer: number; tolerance: number; unit?: string }): string {
  const so = String(c.answer).replace(".", ",");
  const sai = c.tolerance > 0 ? ` (± ${String(c.tolerance).replace(".", ",")})` : "";
  return `${so}${c.unit ? ` ${c.unit}` : ""}${sai}`;
}

function dapAnDungCua(cau: CauHoiCue): string[] {
  const nhan = new Map(locCauHoiChoNguoiHoc(cau).luaChon.map((l) => [l.ma, l.nhan]));
  const ma =
    cau.type === "single" ? [String(cau.correctIndex)] : cau.type === "multiple" ? cau.correctIndices.map(String) : [String(cau.correct)];
  return ma.map((m) => nhan.get(m) ?? m);
}

export async function napKetQuaThi(
  db: ScopedDb,
  input: { enrollmentId: string; lessonId: string; userId: string },
): Promise<KetQuaThi | null> {
  const bai = await db.trnLesson.findFirst({
    where: { id: input.lessonId, deletedAt: null, kind: "QUIZ" },
    select: { examId: true },
  });
  if (!bai?.examId) return null;

  const de = await db.trnExam.findFirst({
    where: { id: bai.examId, deletedAt: null },
    select: { id: true, title: true, passScore: true, maxScore: true, maxAttempts: true, showAnswerPolicy: true },
  });
  if (!de) return null;

  const [luotDaNop, soMoKhoa] = await Promise.all([
    db.trnExamAttempt.findMany({
      // Lượt ĐÃ NỘP của CHÍNH người này — `userId` nằm trong `where`.
      where: { examId: de.id, userId: input.userId, enrollmentId: input.enrollmentId, status: { not: "IN_PROGRESS" } },
      orderBy: { attemptNo: "desc" },
      select: { id: true, attemptNo: true, status: true, submittedAt: true, totalScore: true, passed: true, feedback: true },
    }),
    db.trnExamUnlock.count({ where: { examId: de.id, userId: input.userId } }),
  ]);
  const luot = luotDaNop[0];
  if (!luot) return null;

  const tran = soLuotChoPhep({ maxAttempts: de.maxAttempts, soLanMoKhoa: soMoKhoa });
  const choPhep = duocXemDapAn({ policy: de.showAnswerPolicy, soLuotDaDung: luotDaNop.length, soLuotChoPhep: tran });

  const [cacCauDe, traLoi] = await Promise.all([
    db.trnExamQuestion.findMany({
      where: { examId: de.id },
      orderBy: { orderIndex: "asc" },
      select: { id: true, points: true, question: { select: { stem: true, type: true, contentJson: true, explanation: true } } },
    }),
    db.trnExamAnswer.findMany({
      where: { attemptId: luot.id },
      select: { examQuestionId: true, selectedChoiceIds: true, textAnswer: true, isCorrect: true, score: true },
    }),
  ]);
  const cua = new Map(traLoi.map((a) => [a.examQuestionId, a]));

  const cacCau: CauKetQua[] = cacCauDe.map((c, i) => {
    const r = cueInlineSchema.safeParse(c.question.contentJson);
    const cau = r.success && laCauChamDuoc(r.data) ? r.data : null;
    const nhan = new Map((cau ? locCauHoiChoNguoiHoc(cau).luaChon : []).map((l) => [l.ma, l.nhan]));
    const a = cua.get(c.id);
    const so = laCauSo(c.question.type) ? cauSoSchema.safeParse(c.question.contentJson) : null;
    return {
      thuTu: i + 1,
      stem: c.question.stem,
      type: c.question.type,
      points: c.points,
      daChon: (a?.selectedChoiceIds ?? []).map((m) => nhan.get(m) ?? m),
      textAnswer: a?.textAnswer ?? null,
      // ⚠️ Mọi thứ dưới đây chỉ ĐƯỢC ĐIỀN khi `choPhep` — nếu không, trả `null` (không phải giá trị thật rồi để giao diện ẩn).
      dung: choPhep ? (a?.isCorrect ?? null) : null,
      diem: choPhep ? (a?.score ?? null) : null,
      dapAnDung: choPhep && cau ? dapAnDungCua(cau) : choPhep && so?.success ? [nhanDapAnSo(so.data)] : null,
      giaiThich: choPhep ? (c.question.explanation ?? null) : null,
      goiY: choPhep && so?.success && a?.isCorrect === false ? (so.data.hint ?? null) : null,
    };
  });

  return {
    tenDe: de.title,
    passScore: de.passScore,
    maxScore: de.maxScore,
    luot: {
      attemptNo: luot.attemptNo,
      status: luot.status,
      submittedAt: luot.submittedAt,
      totalScore: luot.totalScore,
      passed: luot.passed,
      choChamTay: luot.status === "PENDING_GRADE",
      feedback: luot.feedback,
    },
    soLuotDaDung: luotDaNop.length,
    soLuotChoPhep: tran,
    choPhepXemDapAn: choPhep,
    chinhSachXemDapAn: de.showAnswerPolicy,
    cacCau,
  };
}
