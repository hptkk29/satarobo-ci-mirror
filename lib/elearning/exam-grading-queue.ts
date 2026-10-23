import type { ScopedDb } from "@/lib/actions/factory";
import { chamMayDuoc } from "@/lib/elearning/exam-grading";
import { cueInlineSchema, laCauChamDuoc, locCauHoiChoNguoiHoc } from "@/lib/elearning/lesson-cue";

/**
 * Đổi các chỉ số người học đã chọn thành NHÃN đọc được.
 *
 * Hiện "0, 2" là hiện dữ liệu thô: người chấm không biết người học chọn gì nên
 * không soi được điểm máy, và khối chỉ-đọc thành nhiễu.
 *
 * Nội dung câu không đọc được thì rơi về chỉ số — vẫn hơn ô trắng, và chính đó là
 * câu người chấm sắp phải cho điểm bằng tay.
 */
function nhanDaChon(contentJson: unknown, daChon: number[]): string {
  if (daChon.length === 0) return "(bỏ trống)";
  const r = cueInlineSchema.safeParse(contentJson);
  if (!r.success || !laCauChamDuoc(r.data)) return daChon.join(", ");
  const cua = new Map(
    locCauHoiChoNguoiHoc(r.data).luaChon.map((lc) => [lc.ma, lc.nhan]),
  );
  return daChon.map((i) => cua.get(String(i)) ?? String(i)).join(" · ");
}

/**
 * EL-14e — HÀNG CHỜ CHẤM TAY.
 *
 * ⚠️ Xếp NGƯỜI CHỜ LÂU NHẤT lên trước, không phải người nộp gần nhất. Đây là bài
 * nghĩa vụ có hạn chót cứng: người nộp sớm mà bị đọc sau cùng là người chịu rủi ro
 * quá hạn cao nhất, dù họ đã làm đúng phần của mình.
 *
 * ⚠️ Đọc QUA `scopedDb` — chính lượt đọc đó là cổng cách ly cơ sở. Đọc bằng `db`
 * trần rồi tự so `centerId` là dựng bản kiểm phạm vi thứ hai, và bản thứ hai sẽ lệch.
 */

/** Trần dòng của một lần nạp hàng chờ. */
export const TRAN_HANG_CHO = 200;

export type DongHangCho = {
  attemptId: string;
  tenDe: string;
  tenNguoiHoc: string;
  attemptNo: number;
  nopLuc: Date | null;
  /** Số ngày đã chờ, làm tròn xuống. `null` khi thiếu mốc nộp. */
  soNgayCho: number | null;
};

export type KetQuaHangCho = {
  dong: DongHangCho[];
  /**
   * `true` = còn bài chờ chấm KHÔNG nằm trong danh sách này.
   *
   * ⚠️ Phải nói ra. Cắt cứng ở 200 dòng mà im lặng thì người chấm đọc hết trang và
   * tin là đã hết việc — trong khi huy hiệu ở màn đề thi đếm KHÔNG giới hạn nên
   * hiện một con số khác. Hai con số lệch nhau, không ai giải thích được, và bài
   * thứ 201 là bài chờ lâu nhất không bao giờ ai thấy.
   */
  conNua: boolean;
};

export async function napHangCho(
  db: ScopedDb,
  opt: { bayGio: Date; take?: number },
): Promise<KetQuaHangCho> {
  const tran = opt.take ?? TRAN_HANG_CHO;
  const luot = await db.trnExamAttempt.findMany({
    where: { status: "PENDING_GRADE" },
    select: {
      id: true,
      userId: true,
      attemptNo: true,
      submittedAt: true,
      exam: { select: { title: true } },
    },
    // Chờ lâu nhất lên đầu. `submittedAt` null (không nên có, nhưng có thể) rơi về
    // cuối chứ không biến mất — một dòng không xếp được vẫn phải nhìn thấy.
    orderBy: { submittedAt: "asc" },
    // Lấy dư MỘT dòng để biết còn nữa hay không, rồi cắt lại — rẻ hơn một lượt
    // `count` thứ hai, và không bao giờ lệch với chính danh sách vừa đọc.
    take: tran + 1,
  });
  const conNua = luot.length > tran;
  if (conNua) luot.length = tran;
  if (luot.length === 0) return { dong: [], conNua: false };

  const nguoi = await db.user.findMany({
    where: { id: { in: [...new Set(luot.map((l) => l.userId))] } },
    select: { id: true, name: true, email: true },
  });
  const tenCua = new Map(nguoi.map((u) => [u.id, u.name ?? u.email ?? u.id]));

  const dong = luot.map((l) => ({
    attemptId: l.id,
    tenDe: l.exam.title,
    tenNguoiHoc: tenCua.get(l.userId) ?? l.userId,
    attemptNo: l.attemptNo,
    nopLuc: l.submittedAt,
    soNgayCho:
      l.submittedAt == null
        ? null
        : Math.max(
            0,
            Math.floor(
              (opt.bayGio.getTime() - l.submittedAt.getTime()) / 86_400_000,
            ),
          ),
  }));
  return { dong, conNua };
}

export type CauDeCham = {
  examQuestionId: string;
  stem: string;
  type: string;
  points: number;
  /**
   * `true` = câu ĐÃ CÓ ĐIỂM ⇒ chỉ đọc.
   *
   * ⚠️ Suy từ ĐIỂM, không từ LOẠI câu. Một câu trắc nghiệm mà hệ thống không đọc
   * nổi `contentJson` sẽ KHÔNG có điểm — `chamMotCau` cố ý để dành nó cho người —
   * và nếu ở đây suy theo loại thì màn chấm dán nhãn "hệ thống đã chấm 0/N" cho
   * một câu chưa ai chấm, khoá không cho sửa, rồi con số 0 đó vào hồ sơ nhân sự.
   */
  daCoDiem: boolean;
  /**
   * `true` = câu thuộc loại đáng lẽ máy chấm, nhưng máy KHÔNG chấm được.
   *
   * Người chấm cần biết vì sao tự nhiên phải chấm tay một câu trắc nghiệm — không
   * nói thì họ tưởng màn hình hỏng và đi hỏi, còn lượt thi thì đứng lại.
   */
  mayKhongDocDuoc: boolean;
  baiLam: string;
  score: number | null;
  graderNote: string | null;
};

export type LuotDeCham = {
  attemptId: string;
  tenDe: string;
  tenNguoiHoc: string;
  attemptNo: number;
  nopLuc: Date | null;
  passScore: number;
  maxScore: number;
  cacCau: CauDeCham[];
};

export async function napLuotDeCham(
  db: ScopedDb,
  attemptId: string,
): Promise<LuotDeCham | null> {
  const luot = await db.trnExamAttempt.findFirst({
    where: { id: attemptId, status: "PENDING_GRADE" },
    select: {
      id: true,
      examId: true,
      userId: true,
      attemptNo: true,
      submittedAt: true,
      exam: { select: { title: true, passScore: true, maxScore: true } },
    },
  });
  if (!luot) return null;

  const [cacCau, traLoi, nguoi] = await Promise.all([
    db.trnExamQuestion.findMany({
      where: { examId: luot.examId },
      select: {
        id: true,
        points: true,
        orderIndex: true,
        question: { select: { stem: true, type: true, contentJson: true } },
      },
      orderBy: { orderIndex: "asc" },
    }),
    db.trnExamAnswer.findMany({
      where: { attemptId: luot.id },
      select: {
        examQuestionId: true,
        textAnswer: true,
        selectedChoiceIds: true,
        score: true,
        graderNote: true,
      },
    }),
    db.user.findFirst({
      where: { id: luot.userId },
      select: { name: true, email: true },
    }),
  ]);
  const traLoiCua = new Map(traLoi.map((a) => [a.examQuestionId, a]));

  return {
    attemptId: luot.id,
    tenDe: luot.exam.title,
    tenNguoiHoc: nguoi?.name ?? nguoi?.email ?? luot.userId,
    attemptNo: luot.attemptNo,
    nopLuc: luot.submittedAt,
    passScore: luot.exam.passScore,
    maxScore: luot.exam.maxScore,
    cacCau: cacCau.map((c) => {
      const a = traLoiCua.get(c.id);
      const loaiMay = chamMayDuoc(c.question.type);
      const daCoDiem = a?.score != null;
      const daChon = (a?.selectedChoiceIds ?? [])
        .map(Number)
        .filter(Number.isInteger);
      return {
        examQuestionId: c.id,
        stem: c.question.stem,
        type: c.question.type,
        points: c.points,
        daCoDiem,
        mayKhongDocDuoc: loaiMay && !daCoDiem,
        // Câu KHÔNG có dòng trả lời = người học BỎ TRỐNG. Nói thẳng chữ đó, vì
        // một ô trắng trông y hệt lỗi tải dữ liệu, và người chấm sẽ đi hỏi.
        //
        // Câu trắc nghiệm hiện NHÃN lựa chọn, không hiện chỉ số thô: "0, 2" không
        // nói cho người chấm biết người học đã chọn gì, nên họ không soi được điểm.
        baiLam: loaiMay
          ? nhanDaChon(c.question.contentJson, daChon)
          : (a?.textAnswer?.trim() ?? "") || "(bỏ trống)",
        score: a?.score ?? null,
        graderNote: a?.graderNote ?? null,
      };
    }),
  };
}
