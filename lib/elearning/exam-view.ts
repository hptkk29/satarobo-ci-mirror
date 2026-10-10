import "server-only";

import type { ScopedDb } from "@/lib/actions/factory";
import { cueInlineSchema, laCauChamDuoc, locCauHoiChoNguoiHoc } from "@/lib/elearning/lesson-cue";
import { soLuotChoPhep, AN_HAN_GIAY } from "@/lib/elearning/exam-grading";

/**
 * EL-14d — DỰNG DỮ LIỆU TRANG LÀM BÀI.
 *
 * ⚠️ ĐÂY là chỗ chống lộ đề. Trang thi chỉ được nhận NHÃN và MÃ lựa chọn; đáp án
 * đúng (`isCorrect`, `correctIndex`, `explanation`) không bao giờ đi xuống. Bơm cả
 * `contentJson` xuống rồi ẩn ở giao diện là gửi đáp án trong thân phản hồi — không
 * ai thấy trên màn hình, nhưng nó nằm trong tab Network và trong mọi bộ nhớ đệm.
 *
 * ⚠️ Trộn thứ tự làm Ở ĐÂY và TẤT ĐỊNH theo lượt thi — nhưng MÃ lựa chọn giữ nguyên
 * chỉ số gốc. Trộn cả mã thì server chấm theo một thứ tự, client hiện theo thứ tự
 * khác, và người bấm đúng bị chấm sai.
 */

export type CauDeThiChoNguoiHoc = {
  examQuestionId: string;
  stem: string;
  type: string;
  points: number;
  luaChon: { ma: string; nhan: string }[];
  daChon: string[];
  textAnswer: string | null;
};

export type NenLamBai = {
  tenDe: string;
  durationMin: number;
  passScore: number;
  maxScore: number;
  soLuotConLai: number;
  luotDangLam: {
    attemptId: string;
    conLaiGiay: number;
    cacCau: CauDeThiChoNguoiHoc[];
  } | null;
  ketQuaGanNhat: {
    status: string;
    totalScore: number | null;
    passed: boolean | null;
  } | null;
};

/**
 * Trộn TẤT ĐỊNH theo một hạt giống.
 *
 * ⚠️ KHÔNG dùng `Math.random()`. Trang này là Server Component, nên nó chạy lại mỗi
 * lượt tải — và trộn ngẫu nhiên nghĩa là thứ tự lựa chọn NHẢY LOẠN mỗi lần người
 * học tải lại trang giữa lúc đang thi. Lựa chọn đã lưu vẫn đúng (mã giữ chỉ số
 * gốc), nhưng người đang làm bài thì mất phương hướng, và họ sẽ nghĩ hệ thống hỏng.
 *
 * Hạt giống là `attemptId` + `questionId`: cùng một lượt thi thì thứ tự cố định,
 * hai người khác nhau thì khác nhau, và hai lượt của cùng một người cũng khác nhau.
 */
function hatGiong(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function tron<T>(a: T[], seed: string): T[] {
  const r = [...a];
  let x = hatGiong(seed) || 1;
  for (let i = r.length - 1; i > 0; i -= 1) {
    // Xorshift32 — đủ đều cho việc đảo thứ tự hiển thị, và tất định.
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    const j = x % (i + 1);
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

export async function nenLamBai(i: {
  db: ScopedDb;
  userId: string;
  enrollmentId: string;
  examId: string;
}): Promise<NenLamBai | null> {
  const de = await i.db.trnExam.findFirst({
    where: { id: i.examId, deletedAt: null, isActive: true },
    select: {
      id: true,
      title: true,
      durationMin: true,
      passScore: true,
      maxScore: true,
      maxAttempts: true,
      shuffleQuestions: true,
      shuffleChoices: true,
    },
  });
  // Đề chưa kích hoạt ⇒ `null`, và trang gọi nói rõ vì sao. Hiện khung làm bài trên
  // một đề nháp là cho thi trên thang điểm còn đổi được.
  if (!de) return null;

  const [daThi, soMoKhoa] = await Promise.all([
    i.db.trnExamAttempt.findMany({
      where: { examId: de.id, userId: i.userId },
      select: {
        id: true,
        status: true,
        startedAt: true,
        totalScore: true,
        passed: true,
        submittedAt: true,
      },
      orderBy: { attemptNo: "desc" },
    }),
    i.db.trnExamUnlock.count({ where: { examId: de.id, userId: i.userId } }),
  ]);

  const tran = soLuotChoPhep({ maxAttempts: de.maxAttempts, soLanMoKhoa: soMoKhoa });
  const dangMo = daThi.find((a) => a.status === "IN_PROGRESS") ?? null;
  const daNop = daThi.find((a) => a.status !== "IN_PROGRESS") ?? null;

  let luotDangLam: NenLamBai["luotDangLam"] = null;
  if (dangMo) {
    const cacCau = await i.db.trnExamQuestion.findMany({
      where: { examId: de.id },
      select: {
        id: true,
        points: true,
        question: { select: { stem: true, type: true, contentJson: true } },
      },
      orderBy: { orderIndex: "asc" },
    });
    const traLoi = await i.db.trnExamAnswer.findMany({
      where: { attemptId: dangMo.id },
      select: { examQuestionId: true, selectedChoiceIds: true, textAnswer: true },
    });
    const cua = new Map(traLoi.map((a) => [a.examQuestionId, a]));

    const dung: CauDeThiChoNguoiHoc[] = cacCau.map((c) => {
      const r = cueInlineSchema.safeParse(c.question.contentJson);
      const loc = r.success && laCauChamDuoc(r.data) ? locCauHoiChoNguoiHoc(r.data) : null;
      const a = cua.get(c.id);
      return {
        examQuestionId: c.id,
        stem: c.question.stem,
        type: c.question.type,
        points: c.points,
        // Câu tự luận (và câu hỏng khuôn) không có lựa chọn — người học gõ chữ.
        luaChon:
          de.shuffleChoices && loc
            ? tron(loc.luaChon, `${dangMo.id}:${c.id}`)
            : (loc?.luaChon ?? []),
        daChon: a?.selectedChoiceIds ?? [],
        textAnswer: a?.textAnswer ?? null,
      };
    });

    const troi = Math.floor((Date.now() - dangMo.startedAt.getTime()) / 1000);
    luotDangLam = {
      attemptId: dangMo.id,
      // ⚠️ Kèm ân hạn, đúng con số server dùng để phán. Hiển thị một hạn CHẶT hơn
      // hạn thật là làm người học hoảng và nộp sớm; lỏng hơn là để họ tin mình còn
      // giờ trong khi server đã đóng.
      conLaiGiay: Math.max(0, de.durationMin * 60 + AN_HAN_GIAY - troi),
      cacCau: de.shuffleQuestions ? tron(dung, dangMo.id) : dung,
    };
  }

  return {
    tenDe: de.title,
    durationMin: de.durationMin,
    passScore: de.passScore,
    maxScore: de.maxScore,
    soLuotConLai: Math.max(0, tran - daThi.length),
    luotDangLam,
    ketQuaGanNhat: daNop
      ? { status: daNop.status, totalScore: daNop.totalScore, passed: daNop.passed }
      : null,
  };
}
