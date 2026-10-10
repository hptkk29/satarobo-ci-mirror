import type { ScopedDb } from "@/lib/actions/factory";
import { dsMucSchema, type Muc } from "@/lib/elearning/rubric-shape";
import { demNgayLamViec } from "@/lib/elearning/ngay-lam-viec";

/**
 * EL-15c — HÀNG CHỜ CHẤM BÀI TẬP.
 *
 * ⚠️ Màn RIÊNG, không gộp với hàng chờ chấm bài thi. Cùng NGƯỜI chấm, nhưng khác
 * NHỊP và khác HÌNH DẠNG: bài thi không có cột hạn chấm nào, bài tập có `dueGradeAt`
 * và index `[status, dueGradeAt]`; thi chấm theo N CÂU (gõ số), tập chấm theo N TIÊU
 * CHÍ (chọn MỘT mức); và khái niệm "câu máy đã chấm ⇒ chỉ đọc" chiếm phần lớn form
 * thi thì với bài tập là vô nghĩa.
 *
 * ⚠️ Xếp theo HẠN CHẤM, không theo lúc nộp. Hai lượt nộp cùng ngày có thể có hạn
 * khác nhau nếu vắt qua cuối tuần, và thứ người chấm cần biết là "cái nào sắp vỡ
 * SLA", không phải "cái nào tới trước".
 */

export const TRAN_HANG_CHO_TAP = 200;

export type DongChoCham = {
  submissionId: string;
  tenNguoiHoc: string;
  tenBai: string;
  attemptNo: number;
  nopLuc: Date | null;
  dueGradeAt: Date | null;
  /** Số ngày làm việc đã QUÁ hạn chấm. 0 = còn trong hạn. */
  quaHanNgayLam: number;
};

export type KetQuaHangChoTap = {
  dong: DongChoCham[];
  /** `true` = còn bài chờ chấm ngoài danh sách này. */
  conNua: boolean;
};

export async function napHangChoTap(
  db: ScopedDb,
  opt: { bayGio: Date; take?: number },
): Promise<KetQuaHangChoTap> {
  const tran = opt.take ?? TRAN_HANG_CHO_TAP;
  const ds = await db.trnSubmission.findMany({
    where: { status: "SUBMITTED" },
    select: {
      id: true,
      userId: true,
      attemptNo: true,
      submittedAt: true,
      dueGradeAt: true,
      lessonId: true,
    },
    // Hạn sớm nhất lên đầu. `null` rơi về cuối chứ không biến mất — một dòng không
    // xếp được vẫn phải nhìn thấy.
    orderBy: { dueGradeAt: "asc" },
    // Lấy dư MỘT dòng để biết còn nữa hay không: rẻ hơn một lượt `count` thứ hai,
    // và không bao giờ lệch với chính danh sách vừa đọc.
    take: tran + 1,
  });
  const conNua = ds.length > tran;
  if (conNua) ds.length = tran;
  if (ds.length === 0) return { dong: [], conNua: false };

  // ⚠️ Bài học tra RIÊNG, không `include`. `TrnSubmission.lessonId` là cột trần
  // KHÔNG có khoá ngoại (khác `TrnVideoSession.lessonId` có Cascade) — nợ có sẵn
  // của lược đồ, ghi ra để không ai tưởng đây là chỗ viết cẩu thả. Hệ quả kèm theo:
  // xoá một bài học sẽ để lại lượt nộp mồ côi, và bảng dưới đây sẽ thiếu tên bài.
  const [nguoi, bai] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...new Set(ds.map((x) => x.userId))] } },
      select: { id: true, name: true, email: true },
    }),
    db.trnLesson.findMany({
      where: { id: { in: [...new Set(ds.map((x) => x.lessonId))] } },
      select: { id: true, title: true },
    }),
  ]);
  const tenCua = new Map(nguoi.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const tenBaiCua = new Map(bai.map((b) => [b.id, b.title]));

  return {
    dong: ds.map((x) => ({
      submissionId: x.id,
      tenNguoiHoc: tenCua.get(x.userId) ?? x.userId,
      tenBai: tenBaiCua.get(x.lessonId) ?? "(bài đã xoá)",
      attemptNo: x.attemptNo,
      nopLuc: x.submittedAt,
      dueGradeAt: x.dueGradeAt,
      quaHanNgayLam: x.dueGradeAt
        ? demNgayLamViec(x.dueGradeAt, opt.bayGio)
        : 0,
    })),
    conNua,
  };
}

export type TieuChiDeCham = {
  criterionId: string;
  label: string;
  description: string | null;
  levels: Muc[];
  /** Mức đã chọn ở lần chấm trước (khi trả về sửa rồi mở lại). */
  levelIndexCu: number | null;
  noteCu: string | null;
};

export type LuotNopDeCham = {
  submissionId: string;
  tenNguoiHoc: string;
  tenBai: string;
  attemptNo: number;
  nopLuc: Date | null;
  dueGradeAt: Date | null;
  contentText: string;
  tep: { key: string; name: string; mime: string; size: number }[];
  tenKhung: string;
  passPoints: number;
  totalPoints: number;
  tieuChi: TieuChiDeCham[];
  /** `true` = có tiêu chí không đọc được mức ⇒ không chấm được, phải báo Đào tạo. */
  coTieuChiHong: boolean;
};

export async function napLuotNopDeCham(
  db: ScopedDb,
  submissionId: string,
): Promise<LuotNopDeCham | null> {
  const lan = await db.trnSubmission.findFirst({
    where: { id: submissionId, status: "SUBMITTED" },
    select: {
      id: true,
      userId: true,
      attemptNo: true,
      submittedAt: true,
      dueGradeAt: true,
      contentText: true,
      attachmentsJson: true,
      rubricId: true,
      lessonId: true,
      scores: {
        select: { criterionId: true, levelIndex: true, note: true },
      },
    },
  });
  if (!lan || !lan.rubricId) return null;

  // ⚠️ Khung đọc TỪ LƯỢT NỘP, không từ bài. Cột trên bài sửa được bất cứ lúc nào;
  // đọc nó ở đây là chấm bài cũ bằng thước mới.
  const khung = await db.trnRubric.findFirst({
    where: { id: lan.rubricId },
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

  const [nguoi, bai] = await Promise.all([
    db.user.findFirst({
      where: { id: lan.userId },
      select: { name: true, email: true },
    }),
    db.trnLesson.findFirst({
      where: { id: lan.lessonId },
      select: { title: true },
    }),
  ]);
  const cu = new Map(lan.scores.map((s) => [s.criterionId, s]));

  const tieuChi: TieuChiDeCham[] = khung.criteria.map((c) => {
    const r = dsMucSchema.safeParse(c.levelsJson);
    const truoc = cu.get(c.id);
    return {
      criterionId: c.id,
      label: c.label,
      description: c.description,
      levels: r.success ? r.data : [],
      levelIndexCu: truoc?.levelIndex ?? null,
      noteCu: truoc?.note ?? null,
    };
  });

  const tep = Array.isArray(lan.attachmentsJson)
    ? (lan.attachmentsJson as { key: string; name: string; mime: string; size: number }[])
    : [];

  return {
    submissionId: lan.id,
    tenNguoiHoc: nguoi?.name ?? nguoi?.email ?? lan.userId,
    tenBai: bai?.title ?? "(bài đã xoá)",
    attemptNo: lan.attemptNo,
    nopLuc: lan.submittedAt,
    dueGradeAt: lan.dueGradeAt,
    // Bài làm trống trông y hệt lỗi tải dữ liệu — nói thẳng.
    contentText: lan.contentText?.trim() || "(không có phần viết)",
    tep,
    tenKhung: khung.title,
    passPoints: khung.passPoints,
    totalPoints: khung.totalPoints,
    tieuChi,
    coTieuChiHong: tieuChi.some((t) => t.levels.length === 0),
  };
}
