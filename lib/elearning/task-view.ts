import type { ScopedDb } from "@/lib/actions/factory";
import { dsMucSchema, type Muc } from "@/lib/elearning/rubric-shape";

/**
 * EL-15c — DỮ LIỆU cho màn NỘP BÀI TẬP của người học.
 *
 * ⚠️ Người học ĐƯỢC xem khung chấm trước khi làm. Giấu tiêu chí đi là bắt họ đoán
 * mình bị đo bằng gì — khác hẳn đề thi, nơi giấu đáp án là điều kiện của phép đo.
 * Ở bài thực hành, biết trước tiêu chí CHÍNH LÀ một phần của việc học.
 */

export type TepDaNop = { key: string; name: string; mime: string; size: number };

export type LuotNopCuaToi = {
  submissionId: string;
  attemptNo: number;
  status: string;
  submittedAt: Date | null;
  dueGradeAt: Date | null;
  score: number | null;
  passed: boolean | null;
  feedback: string | null;
  tep: TepDaNop[];
  /** Điểm từng tiêu chí, chỉ có khi đã chấm. */
  diemTieuChi: { label: string; muc: string; points: number; note: string | null }[];
};

export type NenNopBai = {
  tenKhung: string;
  passPoints: number;
  totalPoints: number;
  tieuChi: { label: string; description: string | null; levels: Muc[] }[];
  /** Lượt gần nhất, `null` nếu chưa nộp lần nào. */
  ganNhat: LuotNopCuaToi | null;
  /** `true` = còn nộp được (chưa nộp lần nào, hoặc bị trả về sửa, hoặc chưa đạt). */
  nopDuoc: boolean;
};

function docTep(raw: unknown): TepDaNop[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is TepDaNop =>
      typeof x === "object" && x !== null && typeof (x as TepDaNop).key === "string",
  );
}

export async function nenNopBai(input: {
  db: ScopedDb;
  userId: string;
  lessonId: string;
  rubricId: string;
}): Promise<NenNopBai | null> {
  const khung = await input.db.trnRubric.findFirst({
    where: { id: input.rubricId, deletedAt: null },
    select: {
      title: true,
      passPoints: true,
      totalPoints: true,
      criteria: {
        select: { id: true, label: true, description: true, levelsJson: true },
        orderBy: { orderIndex: "asc" },
      },
    },
  });
  if (!khung) return null;

  const lan = await input.db.trnSubmission.findFirst({
    where: { lessonId: input.lessonId, userId: input.userId },
    // Sắp theo `attemptNo`, KHÔNG theo `createdAt`: hai lượt trong cùng một giây
    // sẽ xếp tuỳ ý.
    orderBy: { attemptNo: "desc" },
    select: {
      id: true,
      attemptNo: true,
      status: true,
      submittedAt: true,
      dueGradeAt: true,
      score: true,
      passed: true,
      feedback: true,
      attachmentsJson: true,
      scores: {
        select: {
          levelIndex: true,
          points: true,
          note: true,
          criterion: { select: { label: true, levelsJson: true } },
        },
      },
    },
  });

  const daCham = lan?.status === "GRADED" || lan?.status === "NEEDS_REVISION";

  return {
    tenKhung: khung.title,
    passPoints: khung.passPoints,
    totalPoints: khung.totalPoints,
    tieuChi: khung.criteria.map((c) => {
      const r = dsMucSchema.safeParse(c.levelsJson);
      return {
        label: c.label,
        description: c.description,
        // Tiêu chí hỏng khuôn ⇒ danh sách mức RỖNG, không làm vỡ cả trang. Cổng
        // kích hoạt khung đã chặn ca này; đây là lưới đỡ cho khung cũ.
        levels: r.success ? r.data : [],
      };
    }),
    ganNhat: lan
      ? {
          submissionId: lan.id,
          attemptNo: lan.attemptNo,
          status: lan.status,
          submittedAt: lan.submittedAt,
          dueGradeAt: lan.dueGradeAt,
          score: lan.score,
          passed: lan.passed,
          // ⚠️ Nhận xét chỉ hiện KHI ĐÃ CHẤM. Lộ sớm không xảy ra ở đây (chưa chấm
          // thì cột rỗng), nhưng viết rõ điều kiện để nó không đổi âm thầm.
          feedback: daCham ? lan.feedback : null,
          tep: docTep(lan.attachmentsJson),
          diemTieuChi: daCham
            ? lan.scores.map((s) => {
                const r = dsMucSchema.safeParse(s.criterion.levelsJson);
                const ten = r.success ? r.data[s.levelIndex]?.label : undefined;
                return {
                  label: s.criterion.label,
                  muc: ten ?? `mức ${s.levelIndex + 1}`,
                  points: s.points,
                  note: s.note,
                };
              })
            : [],
        }
      : null,
    // Còn nộp được khi: chưa nộp lần nào · bị trả về sửa · đã chấm mà CHƯA ĐẠT.
    // Đang chờ chấm thì KHÔNG — đẻ hai lượt cùng chờ là người chấm không biết đọc
    // bản nào.
    nopDuoc:
      !lan ||
      lan.status === "NEEDS_REVISION" ||
      (lan.status === "GRADED" && lan.passed !== true),
  };
}
