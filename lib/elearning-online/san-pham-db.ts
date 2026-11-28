import type { Prisma, PrismaClient } from "@prisma/client";
import { kiemTraTruyCapChoPhuHuynh } from "./hoc-tap";
import { khungChamSchema, kiemTepNop, tinhDiemSanPham, type CauHinhSanPham, type KhungChamInput, type TepNop, type TieuChi } from "./san-pham";
import type { SnapshotDe } from "./cham-diem";

/**
 * E-LEARNING ONLINE — NỘP + CHẤM SẢN PHẨM (Postgres). Bảng `OnlSubmission`/`OnlRubric` (công ty), KHÔNG `Trn*`.
 * Quyền ở tầng action: khung chấm `onl:assessment:manage`, chấm `onl:assessment:grade`. Hàm ở đây tự kiểm QUYỀN SỞ HỮU của người nộp.
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type MaLoiSanPham =
  | "KHOA_KHONG_TON_TAI"
  | "KHUNG_KHONG_HOP_LE"
  | "KHUNG_TRUNG_MA"
  | "KHUNG_KHONG_TON_TAI"
  | "LUOT_KHONG_TON_TAI"
  | "CAU_KHONG_PHAI_SAN_PHAM"
  | "TEP_KHONG_HOP_LE"
  | "DA_NOP"
  | "LUOT_DA_DONG"
  | "SAN_PHAM_KHONG_TON_TAI"
  | "SAN_PHAM_KHONG_CHAM_DUOC"
  | "DIEM_KHONG_HOP_LE"
  | "SAI_PHU_HUYNH"
  | "KHONG_CO_QUYEN_HOC"
  | string;
export type FailSP = { ok: false; ma: MaLoiSanPham; thongBao: string };
const fail = (ma: MaLoiSanPham, thongBao: string): FailSP => ({ ok: false, ma, thongBao });

const HOAT_DONG = ["SUBMITTED", "GRADED", "RESUBMIT_REQUESTED"] as const;

// ───────── Khung chấm ─────────

export async function luuKhungCham(db: Db, input: unknown, actorUserId: string | null): Promise<{ ok: true; id: string } | FailSP> {
  const p = khungChamSchema.safeParse(input);
  if (!p.success) return fail("KHUNG_KHONG_HOP_LE", p.error.issues[0]?.message ?? "Khung chấm không hợp lệ");
  const k: KhungChamInput = p.data;
  const khoa = await db.onlCourse.findFirst({ where: { id: k.courseId, deletedAt: null }, select: { id: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  const trung = await db.onlRubric.findFirst({ where: { courseId: k.courseId, code: k.code, ...(k.id ? { id: { not: k.id } } : {}) }, select: { id: true } });
  if (trung) return fail("KHUNG_TRUNG_MA", "Mã khung chấm đã dùng trong khoá này");
  const data = { code: k.code, title: k.title, criteriaJson: k.criteria as unknown as Prisma.InputJsonValue, archived: k.archived ?? false };
  if (k.id) {
    const cu = await db.onlRubric.findUnique({ where: { id: k.id }, select: { courseId: true } });
    if (!cu || cu.courseId !== k.courseId) return fail("KHUNG_KHONG_TON_TAI", "Khung chấm không tồn tại trong khoá này");
    await db.onlRubric.update({ where: { id: k.id }, data }); // bài đã nộp giữ BẢN CHỤP khung — sửa ở đây không đổi cách chấm chúng
    return { ok: true, id: k.id };
  }
  const c = await db.onlRubric.create({ data: { ...data, courseId: k.courseId, createdByUserId: actorUserId }, select: { id: true } });
  return { ok: true, id: c.id };
}

export const docKhungChamCuaKhoa = (db: Db, courseId: string) =>
  db.onlRubric.findMany({ where: { courseId }, orderBy: { createdAt: "asc" }, select: { id: true, code: true, title: true, criteriaJson: true, archived: true } });

// ───────── Nộp ─────────

type DauVaoNop = { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; attemptId: string; questionId: string; file: TepNop; now: Date };

/** Nộp (hoặc NỘP LẠI sau khi được yêu cầu) sản phẩm cho MỘT câu của MỘT lượt. Trả mã bài nộp — đó là "câu trả lời" của câu sản phẩm. */
export async function nopSanPham(db: Db, input: DauVaoNop): Promise<{ ok: true; submissionId: string; nopLai: boolean } | FailSP> {
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return fail(cong.ma, "Không vào được bài này");
  return db.$transaction(async (tx): Promise<{ ok: true; submissionId: string; nopLai: boolean } | FailSP> => {
    const q = await tx.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
    if (!q) return fail("KHONG_CO_QUYEN_HOC", "Không có quyền học");
    await tx.$queryRaw`SELECT "id" FROM "OnlEntitlement" WHERE "id" = ${q.id} FOR UPDATE`;
    const a = await tx.onlAttempt.findUnique({ where: { id: input.attemptId } });
    if (!a || a.entitlementId !== q.id || a.studentId !== input.studentId || a.lessonStableId !== input.lessonStableId) return fail("LUOT_KHONG_TON_TAI", "Không tìm thấy lượt làm bài");
    const snap = a.snapshotJson as unknown as SnapshotDe;
    const cau = snap.cau.find((c) => c.id === input.questionId && c.type === "PRODUCT");
    if (!cau) return fail("CAU_KHONG_PHAI_SAN_PHAM", "Câu này không nhận bài nộp sản phẩm");
    const cfg = (cau.cauHinh ?? {}) as unknown as CauHinhSanPham;
    const hienTai = await tx.onlSubmission.findFirst({ where: { attemptId: a.id, questionId: cau.id, status: { in: [...HOAT_DONG] } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
    const nopLai = a.status === "SUBMITTED";
    if (a.status !== "IN_PROGRESS" && !(nopLai && hienTai?.status === "RESUBMIT_REQUESTED")) return fail(a.status === "SUBMITTED" ? "DA_NOP" : "LUOT_DA_DONG", a.status === "SUBMITTED" ? "Bài đã nộp — chỉ nộp lại khi người chấm yêu cầu" : "Lượt làm bài đã đóng");
    if (a.status === "IN_PROGRESS" && a.dueAt && input.now.getTime() > a.dueAt.getTime()) return fail("LUOT_DA_DONG", "Lượt làm bài đã hết giờ");
    const kt = kiemTepNop(cfg, input.file, { courseId: input.courseId, studentId: input.studentId });
    if (!kt.ok) return fail("TEP_KHONG_HOP_LE", kt.thongBao);

    let rubricSnapshot: Prisma.InputJsonValue | undefined;
    if (cfg.rubricId) {
      const r = await tx.onlRubric.findFirst({ where: { id: cfg.rubricId, courseId: input.courseId }, select: { id: true, code: true, title: true, criteriaJson: true } });
      if (r) rubricSnapshot = { id: r.id, code: r.code, title: r.title, criteria: r.criteriaJson } as unknown as Prisma.InputJsonValue;
    }
    if (hienTai) await tx.onlSubmission.update({ where: { id: hienTai.id }, data: { status: "SUPERSEDED" } });
    const moi = await tx.onlSubmission.create({
      data: {
        courseId: input.courseId, attemptId: a.id, questionId: cau.id, studentId: input.studentId,
        fileKey: input.file.key, fileName: input.file.name, mimeType: input.file.mime, sizeBytes: input.file.sizeBytes, durationSec: input.file.durationSec ?? null,
        rubricId: cfg.rubricId && rubricSnapshot ? cfg.rubricId : null, rubricSnapshotJson: rubricSnapshot, supersedesId: hienTai?.id ?? null,
      },
      select: { id: true },
    });
    if (nopLai) {
      const tl = { ...((a.answersJson ?? {}) as Record<string, unknown>), [cau.id]: moi.id };
      await tx.onlAttempt.update({ where: { id: a.id }, data: { answersJson: tl as Prisma.InputJsonValue } });
    }
    return { ok: true, submissionId: moi.id, nopLai };
  });
}

/** Giữ lại trong câu trả lời CHỈ những mã bài nộp thật sự thuộc lượt này + câu này + học viên này (không nhận mã của người khác). */
export async function lamSachTraLoiSanPham(tx: Db | Tx, a: { id: string; studentId: string }, snap: SnapshotDe, traLoi: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sp = snap.cau.filter((c) => c.type === "PRODUCT");
  if (sp.length === 0) return traLoi;
  const ra = { ...traLoi };
  for (const c of sp) {
    const id = ra[c.id];
    const hop = typeof id === "string" ? await tx.onlSubmission.findFirst({ where: { id, attemptId: a.id, questionId: c.id, studentId: a.studentId, status: { in: [...HOAT_DONG] } }, select: { id: true } }) : null;
    if (!hop) delete ra[c.id];
  }
  return ra;
}

// ───────── Chấm ─────────

export type DauVaoCham = { submissionId: string; graderUserId: string; scores?: Record<string, unknown>; diemTrucTiep?: number; feedback?: string | null; now: Date };

export async function chamSanPham(db: Db, input: DauVaoCham): Promise<{ ok: true; points: number; toiDa: number } | FailSP> {
  return db.$transaction(async (tx): Promise<{ ok: true; points: number; toiDa: number } | FailSP> => {
    await tx.$queryRaw`SELECT "id" FROM "OnlSubmission" WHERE "id" = ${input.submissionId} FOR UPDATE`;
    const s = await tx.onlSubmission.findUnique({ where: { id: input.submissionId }, include: { attempt: { select: { id: true, status: true, snapshotJson: true } } } });
    if (!s) return fail("SAN_PHAM_KHONG_TON_TAI", "Không tìm thấy bài nộp");
    if (s.status === "GRADED") return fail("DA_CHAM", "Bài nộp này đã được chấm");
    if (s.status !== "SUBMITTED") return fail("SAN_PHAM_KHONG_CHAM_DUOC", s.status === "RESUBMIT_REQUESTED" ? "Đang chờ học viên nộp lại" : "Bài nộp đã được thay bằng bản mới");
    if (s.attempt.status !== "SUBMITTED") return fail("SAN_PHAM_KHONG_CHAM_DUOC", "Lượt làm bài chưa nộp hoặc đã chấm xong");
    const cau = (s.attempt.snapshotJson as unknown as SnapshotDe).cau.find((c) => c.id === s.questionId);
    if (!cau) return fail("SAN_PHAM_KHONG_CHAM_DUOC", "Không tìm thấy câu hỏi của bài nộp");
    const khung = (s.rubricSnapshotJson as { criteria?: TieuChi[] } | null)?.criteria;
    let diem: number;
    let ghiChiTiet: Prisma.InputJsonValue | undefined;
    if (khung && khung.length > 0) {
      const t = tinhDiemSanPham(khung, input.scores ?? {}, cau.points);
      if (!t.ok) return fail("DIEM_KHONG_HOP_LE", t.thongBao);
      diem = t.diemCau;
      ghiChiTiet = input.scores as Prisma.InputJsonValue;
    } else {
      const d = input.diemTrucTiep;
      if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > cau.points) return fail("DIEM_KHONG_HOP_LE", `Điểm phải là số nguyên từ 0 đến ${cau.points}`);
      diem = d;
    }
    await tx.onlSubmission.update({ where: { id: s.id }, data: { status: "GRADED", points: diem, scoresJson: ghiChiTiet, feedback: input.feedback?.trim() || null, gradedByUserId: input.graderUserId, gradedAt: input.now } });
    return { ok: true, points: diem, toiDa: cau.points };
  });
}

/** Yêu cầu học viên nộp lại (bài chưa chấm). Lượt vẫn ở trạng thái chờ chấm; học viên nộp lại được cho tới khi người chấm chấm bản mới. */
export async function yeuCauNopLai(db: Db, input: { submissionId: string; graderUserId: string; lyDo: string }): Promise<{ ok: true } | FailSP> {
  if (input.lyDo.trim().length < 10) return fail("DIEM_KHONG_HOP_LE", "Nêu lý do (≥ 10 ký tự) để học viên biết cần sửa gì");
  return db.$transaction(async (tx): Promise<{ ok: true } | FailSP> => {
    await tx.$queryRaw`SELECT "id" FROM "OnlSubmission" WHERE "id" = ${input.submissionId} FOR UPDATE`;
    const s = await tx.onlSubmission.findUnique({ where: { id: input.submissionId }, select: { id: true, status: true } });
    if (!s) return fail("SAN_PHAM_KHONG_TON_TAI", "Không tìm thấy bài nộp");
    if (s.status !== "SUBMITTED") return fail("SAN_PHAM_KHONG_CHAM_DUOC", "Chỉ yêu cầu nộp lại với bài đang chờ chấm");
    await tx.onlSubmission.update({ where: { id: s.id }, data: { status: "RESUBMIT_REQUESTED", feedback: input.lyDo.trim(), gradedByUserId: input.graderUserId } });
    return { ok: true };
  });
}

/** Điểm các câu sản phẩm của một lượt, lấy từ bài nộp ĐÃ CHẤM. Thiếu chấm / đang chờ nộp lại ⇒ lỗi (không đoán). Không nộp gì ⇒ 0. */
export async function diemSanPhamCuaLuot(tx: Db | Tx, a: { id: string }, snap: SnapshotDe): Promise<{ ok: true; diem: Record<string, number> } | FailSP> {
  const diem: Record<string, number> = {};
  for (const c of snap.cau.filter((x) => x.type === "PRODUCT")) {
    const s = await tx.onlSubmission.findFirst({ where: { attemptId: a.id, questionId: c.id, status: { in: [...HOAT_DONG] } }, orderBy: { createdAt: "desc" }, select: { status: true, points: true } });
    if (!s) { diem[c.id] = 0; continue; }
    if (s.status === "RESUBMIT_REQUESTED") return fail("SAN_PHAM_KHONG_CHAM_DUOC", "Còn bài đang chờ học viên nộp lại");
    if (s.status !== "GRADED" || s.points === null) return fail("SAN_PHAM_CHUA_CHAM", "Còn bài sản phẩm chưa chấm");
    diem[c.id] = s.points;
  }
  return { ok: true, diem };
}

// ───────── Đọc ─────────

/** Danh sách chờ chấm của một khoá (người chấm). Không trả khoá tệp ở danh sách. */
export const docSanPhamChoCham = (db: Db, courseId: string) =>
  db.onlSubmission.findMany({
    where: { courseId, status: "SUBMITTED" },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, fileName: true, mimeType: true, sizeBytes: true, durationSec: true, rubricSnapshotJson: true, question: { select: { id: true, stem: true, points: true } }, student: { select: { id: true, name: true } } },
  });

/** Chi tiết một bài nộp cho NGƯỜI CHẤM (quyền kiểm ở action) — có khoá tệp để xin vé xem. */
export const docSanPhamDeCham = (db: Db, submissionId: string) =>
  db.onlSubmission.findUnique({ where: { id: submissionId }, select: { id: true, courseId: true, status: true, fileKey: true, fileName: true, mimeType: true, sizeBytes: true, durationSec: true, rubricSnapshotJson: true, scoresJson: true, points: true, feedback: true, student: { select: { id: true, name: true } }, question: { select: { id: true, stem: true, points: true } } } });

/** Học viên/phụ huynh xem bài của CHÍNH mình. Người lạ ⇒ null (không phân biệt "không có" với "không phải của bạn"). */
export async function docSanPhamCuaToi(db: Db, input: { parentUserId: string; submissionId: string }) {
  const s = await db.onlSubmission.findUnique({ where: { id: input.submissionId }, select: { id: true, status: true, fileKey: true, fileName: true, mimeType: true, points: true, feedback: true, student: { select: { id: true, parentUserId: true } } } });
  if (!s || s.student.parentUserId !== input.parentUserId) return null;
  const { student: _hv, ...ra } = s;
  void _hv;
  return ra;
}
