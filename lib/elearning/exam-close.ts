import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/lib/actions/factory";
import { writeAudit } from "@/lib/audit/audit-log";
import { SYSTEM_ACTOR_NAME } from "@/lib/auth/system-actor";
import { chamLuotThi } from "@/lib/elearning/exam-close-pure";

/**
 * F-05 — ĐÓNG MỘT LƯỢT THI: nguồn DUY NHẤT cho cả người học bấm "Nộp bài" lẫn hệ thống đóng lượt bỏ dở.
 *
 * ─── CHỐNG ĐUA ────────────────────────────────────────────────────────────────
 * Phép GHI ĐẦU TIÊN trong giao dịch là CLAIM có điều kiện:
 *   `updateMany({ where: { id, status: "IN_PROGRESS" }, data: { status: "PENDING_GRADE", submittedAt } })`
 * `count === 0` nghĩa là bên kia (người học / lượt cron khác) đã đóng trước ⇒ `throw LuotDaDongError` (CHỈ `throw` mới
 * rollback; `return` thì commit — luật cứng #7). Sau khi claim, hàng bị khoá, nên câu trả lời được ĐỌC TRONG giao dịch.
 * Hệ quả: một lượt chỉ được chấm MỘT lần, chỉ một bên chạy được bước "ghi xong bài học" (bên thắng claim), nên không
 * có chứng nhận trùng.
 *
 * ⚠️ Không sửa `selectedChoiceIds`/`textAnswer`: chỉ `isCorrect`/`score` của câu chấm máy được ghi.
 */

export const TUY_CHON_GIAO_DICH = { timeout: 20_000, maxWait: 10_000 } as const;

export class LuotDaDongError extends Error {
  constructor() {
    super("Lượt thi đã được đóng bởi bên khác");
    this.name = "LuotDaDongError";
  }
}

export type LuotCanDong = {
  id: string;
  examId: string;
  attemptNo: number;
  passScore: number;
  centerId: string | null;
  orgUnitId: string | null;
};

export type KetQuaDongLuot = {
  status: "PENDING_GRADE" | "GRADED";
  totalScore: number | null;
  passed: boolean | null;
  choChamTay: boolean;
};

export async function dongLuotThi(
  db: ScopedDb,
  i: {
    luot: LuotCanDong;
    via: "LEARNER" | "AUTO_EXPIRY";
    /** Mốc ghi `submittedAt` (cooldown đếm từ đây). Người học: giờ nộp thật. Hệ thống: hạn chót làm bài. */
    submittedAt: Date;
    /** Chỉ lượt hệ thống đóng mới ghi audit ở đây (đường người học đã có audit của factory). */
    audit?: { reason: string; extra: Record<string, unknown> };
  },
): Promise<KetQuaDongLuot> {
  // Định nghĩa câu hỏi bất biến khi đề đã kích hoạt ⇒ đọc TRƯỚC giao dịch (giữ giao dịch ngắn: trần 5s của Prisma).
  const cacCau = await db.trnExamQuestion.findMany({
    where: { examId: i.luot.examId },
    select: {
      id: true,
      points: true,
      question: { select: { type: true, contentJson: true } },
    },
  });

  // ⚠️ Giao dịch tương tác mặc định chỉ sống 5 giây (P2028). Chấm một đề dài = 1 `upsert` cho MỖI câu qua WAN; quá trần thì ROLLBACK
  // và lượt thi kẹt vĩnh viễn (cron thử lại mãi, người học bấm Nộp cũng lỗi). Nâng trần có chủ đích cho phép ghi này.
  return db.$transaction(async (t) => {
    // 1) CLAIM — phép ghi đầu tiên.
    const claim = await t.trnExamAttempt.updateMany({
      where: { id: i.luot.id, status: "IN_PROGRESS" },
      data: { status: "PENDING_GRADE", submittedAt: i.submittedAt },
    });
    if (claim.count === 0) throw new LuotDaDongError();

    // 2) Đọc câu trả lời SAU claim (hàng đã khoá ⇒ tập câu trả lời không còn đổi).
    const traLoi = await t.trnExamAnswer.findMany({
      where: { attemptId: i.luot.id },
      select: { id: true, examQuestionId: true, selectedChoiceIds: true },
    });
    const { ketCau, tong } = chamLuotThi({ cacCau, traLoi, passScore: i.luot.passScore });

    // 3) Điểm từng câu chấm máy. Câu chấm tay để `null`.
    for (const k of ketCau) {
      if (k.kq.cham !== "MAY") continue;
      await t.trnExamAnswer.upsert({
        where: {
          attemptId_examQuestionId: { attemptId: i.luot.id, examQuestionId: k.examQuestionId },
        },
        update: { isCorrect: k.kq.dung, score: k.kq.diem },
        create: {
          attemptId: i.luot.id,
          examQuestionId: k.examQuestionId,
          isCorrect: k.kq.dung,
          score: k.kq.diem,
        },
      });
    }

    // 4) Chốt trạng thái. `PENDING_GRADE` là trạng thái RIÊNG khi còn câu chấm tay.
    const status = tong.choChamTay ? "PENDING_GRADE" : "GRADED";
    await t.trnExamAttempt.update({
      where: { id: i.luot.id },
      data: {
        status,
        gradedAt: tong.choChamTay ? null : i.submittedAt,
        totalScore: tong.totalScore,
        passed: tong.passed,
      },
    });

    // 5) Audit (cùng giao dịch ⇒ có đóng là có dấu vết, và ngược lại).
    if (i.audit) {
      await writeAudit({
        tx: t as unknown as Prisma.TransactionClient,
        actor: { id: null, name: SYSTEM_ACTOR_NAME },
        module: "elearning",
        entityType: "TrnExamAttempt",
        entityId: i.luot.id,
        action: "UPDATE",
        reason: i.audit.reason,
        orgUnitId: i.luot.orgUnitId,
        newValues: {
          closedBy: i.via,
          attemptNo: i.luot.attemptNo,
          status,
          totalScore: tong.totalScore,
          passed: tong.passed,
          ...i.audit.extra,
        },
      });
    }

    return {
      status,
      totalScore: tong.totalScore,
      passed: tong.passed,
      choChamTay: tong.choChamTay,
    } satisfies KetQuaDongLuot;
  }, TUY_CHON_GIAO_DICH);
}
