import type { OnlAttemptStatus, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { capChungNhanTuDong } from "./chung-nhan";
import { chamBai, veChoHocVien, type SnapshotDe } from "./cham-diem";
import { kiemTraTruyCapChoPhuHuynh } from "./hoc-tap";
import { kiemDapAnNhap } from "./nhap-dap-an";
import { lamSachTraLoiSanPham } from "./san-pham-db";

/**
 * E-LEARNING ONLINE — NHÁP ĐÁP ÁN PHÍA MÁY CHỦ + TỰ CHỐT LƯỢT QUÁ HẠN (P0 Mobile). Bảng `Onl*` (công ty); KHÔNG Offline/Nội bộ.
 *
 * Bất biến:
 * 1. Máy chủ là nguồn sự thật về GIỜ: mọi quyết định hạn dùng `now` do SERVER truyền vào (không đọc giờ điện thoại). Nháp chỉ nhận khi `now ≤ dueAt`; sau đó là cutoff.
 * 2. Nháp đã được máy chủ ACK (`ok: true` + `SAVED`) nằm trong DB — còn sau khi khởi động lại. Đáp án chưa ACK KHÔNG được coi là đã lưu.
 * 3. Khoá lạc quan theo (lượt × câu): `baseRevision` phải bằng revision máy chủ; cũ hơn ⇒ CONFLICT (kèm bản máy chủ), mới hơn ⇒ AHEAD. Thiết bị cũ không ghi đè thiết bị mới.
 * 4. Idempotent: (lượt × requestId) duy nhất — gọi lại cùng requestId trả đúng kết quả cũ, không ghi hai lần, không tính vào tần suất.
 * 5. Chốt quá hạn: lượt còn IN_PROGRESS khi `now ≥ dueAt + DUNG_SAI` được chấm từ nháp (đúng một lần — khoá dòng lượt); không có nháp nào ⇒ EXPIRED (hành vi cũ). Câu tự luận/sản phẩm ⇒ chờ chấm tay.
 * 6. Lượt INTERRUPTED (Admin thu hồi giữa chừng) KHÔNG bao giờ bị chốt/chấm rớt và không ghi thêm nháp.
 * 7. DTO không chứa đáp án đúng/giải thích: chỉ `veChoHocVien` (đã bỏ khoá) + đáp án CỦA HỌC VIÊN.
 */

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export const DUNG_SAI_CHOT_GIAY = 60;
export type CauHinhTanSuat = { toiDaYeuCauMoiPhut: number; cuaSoGiay: number; toiDaCauMoiYeuCau: number };
/** Mặc định kỹ thuật (KHÔNG phải quyết định Owner, chưa đo trên Mobile thật). Truyền cấu hình thật qua tham số `cauHinh` của `luuNhap`. Số câu/yêu cầu bị chặn trên cứng ở lược đồ (100). */
export const TAN_SUAT_NHAP: CauHinhTanSuat = { toiDaYeuCauMoiPhut: 90, cuaSoGiay: 60, toiDaCauMoiYeuCau: 50 };
const TOI_DA_CAU_TREN_CUNG = 100;

export type MaLoiNhap =
  | "SAI_PHU_HUYNH"
  | "LUOT_KHONG_TON_TAI"
  | "LUOT_DA_CHOT"
  | "LUOT_BI_GIAN_DOAN"
  | "HET_GIO"
  | "CAU_KHONG_THUOC_LUOT"
  | "DAP_AN_KHONG_HOP_LE"
  | "YEU_CAU_KHONG_HOP_LE"
  | "VUOT_TAN_SUAT"
  | "KHONG_CO_QUYEN_HOC"
  | string;
export type FailNhap = { ok: false; ma: MaLoiNhap; thongBao: string; retryAfterSec?: number; daChot?: boolean };
const fail = (ma: MaLoiNhap, thongBao: string, extra: Partial<FailNhap> = {}): FailNhap => ({ ok: false, ma, thongBao, ...extra });

// ───────── Chốt lượt (dùng chung cho NỘP và TỰ CHỐT) ─────────

export async function ghiTienDoTuKetQua(tx: Tx, o: { entitlementId: string; lessonStableId: string; scorePercent: number; passed: boolean; now: Date; soBan: number }) {
  const hien = await tx.onlLessonProgress.findUnique({ where: { entitlementId_lessonStableId: { entitlementId: o.entitlementId, lessonStableId: o.lessonStableId } }, select: { status: true, percent: true, bestScore: true } });
  const best = Math.max(hien?.bestScore ?? -1, o.scorePercent);
  if (hien?.status === "COMPLETED") {
    if (best !== hien.bestScore) await tx.onlLessonProgress.update({ where: { entitlementId_lessonStableId: { entitlementId: o.entitlementId, lessonStableId: o.lessonStableId } }, data: { bestScore: best } });
    return;
  }
  await tx.onlLessonProgress.upsert({
    where: { entitlementId_lessonStableId: { entitlementId: o.entitlementId, lessonStableId: o.lessonStableId } },
    create: { entitlementId: o.entitlementId, lessonStableId: o.lessonStableId, status: o.passed ? "COMPLETED" : "IN_PROGRESS", percent: o.passed ? 100 : 0, bestScore: best, completedAt: o.passed ? o.now : null, completedVersionNumber: o.passed ? o.soBan : null },
    update: o.passed ? { status: "COMPLETED", percent: 100, bestScore: best, completedAt: o.now, completedVersionNumber: o.soBan } : { status: "IN_PROGRESS", bestScore: best },
  });
}

type LuotDong = { id: string; studentId: string; entitlementId: string; lessonStableId: string; snapshotJson: unknown };

/** Chấm + ghi kết quả + tiến độ + chứng nhận cho MỘT lượt (đã khoá, đang IN_PROGRESS). MỘT nơi duy nhất — NỘP và TỰ CHỐT cùng đi qua đây. */
export async function ghiKetQuaChotLuot(tx: Tx, a: LuotDong, o: { traLoi: Record<string, unknown>; now: Date; submittedAt: Date; lyDo: "SUBMIT" | "DEADLINE_AUTO"; soBan: number }) {
  const snap = a.snapshotJson as unknown as SnapshotDe;
  const traLoi = await lamSachTraLoiSanPham(tx, { id: a.id, studentId: a.studentId }, snap, o.traLoi);
  const kq = chamBai(snap, traLoi);
  const chamXong = !kq.canChamTay;
  await tx.onlAttempt.update({
    where: { id: a.id },
    data: {
      status: chamXong ? "GRADED" : "SUBMITTED",
      submittedAt: o.submittedAt,
      answersJson: traLoi as Prisma.InputJsonValue,
      earnedPoints: kq.earned,
      totalPoints: kq.total,
      scorePercent: kq.scorePercent,
      passed: kq.passed,
      finalizedAt: o.now,
      finalizeReason: o.lyDo,
      ...(chamXong ? { gradedAt: o.now } : {}),
    },
  });
  await tx.onlAttemptDraft.updateMany({ where: { attemptId: a.id, finalizedAt: null }, data: { finalizedAt: o.now } });
  let chungNhan: string | null = null;
  let vuaCap = false;
  if (chamXong && kq.scorePercent !== null && kq.passed !== null) {
    await ghiTienDoTuKetQua(tx, { entitlementId: a.entitlementId, lessonStableId: a.lessonStableId, scorePercent: kq.scorePercent, passed: kq.passed, now: o.now, soBan: o.soBan });
    if (kq.passed) {
      const cn = await capChungNhanTuDong(tx, a.entitlementId, o.now);
      if (cn.ok) {
        chungNhan = cn.code;
        vuaCap = !cn.daCo;
      }
    }
  }
  return { chamXong, chungNhan, vuaCap };
}

export type KetQuaChot = { ket: "KHONG_CAN" | "CHUA_DEN_HAN" | "DA_CHOT_TU_NHAP" | "HET_HAN_KHONG_NHAP" | "BO_QUA_DANG_KHOA"; trangThai?: OnlAttemptStatus; chamXong?: boolean };

/**
 * Chốt MỘT lượt quá hạn. KHOÁ dòng lượt (`FOR UPDATE`, hoặc `SKIP LOCKED` cho worker) ⇒ hai worker / worker + người đọc không chấm hai lần.
 * Chỉ động vào lượt IN_PROGRESS đã quá `dueAt + DUNG_SAI`; INTERRUPTED/đã chốt ⇒ KHONG_CAN. Gọi trong giao dịch — lỗi giữa chừng ⇒ cuộn lại, chạy lại được.
 */
export async function chotLuotQuaHanTrongTx(tx: Tx, attemptId: string, now: Date, tuyChon: { boQuaNeuDangKhoa?: boolean } = {}): Promise<KetQuaChot> {
  const khoa = tuyChon.boQuaNeuDangKhoa
    ? await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OnlAttempt" WHERE "id" = ${attemptId} FOR UPDATE SKIP LOCKED`
    : await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OnlAttempt" WHERE "id" = ${attemptId} FOR UPDATE`;
  if (khoa.length === 0) return { ket: tuyChon.boQuaNeuDangKhoa ? "BO_QUA_DANG_KHOA" : "KHONG_CAN" };
  const a = await tx.onlAttempt.findUnique({ where: { id: attemptId }, include: { entitlement: { select: { courseId: true } } } });
  if (!a || a.status !== "IN_PROGRESS" || !a.dueAt) return { ket: "KHONG_CAN", trangThai: a?.status };
  if (now.getTime() < a.dueAt.getTime() + DUNG_SAI_CHOT_GIAY * 1000) return { ket: "CHUA_DEN_HAN", trangThai: a.status };
  const nhap = await tx.onlAttemptDraft.findMany({ where: { attemptId, savedAt: { lte: a.dueAt } }, select: { questionId: true, answerJson: true } });
  if (nhap.length === 0) {
    await tx.onlAttempt.update({ where: { id: a.id }, data: { status: "EXPIRED", submittedAt: now, finalizedAt: now, finalizeReason: "NO_DRAFT_EXPIRED" } }); // giữ hành vi cũ: tính một lượt đã dùng
    return { ket: "HET_HAN_KHONG_NHAP", trangThai: "EXPIRED" };
  }
  const ban = await tx.onlCourseVersion.findFirst({ where: { courseId: a.entitlement.courseId, status: "PUBLISHED" }, select: { number: true } });
  const r = await ghiKetQuaChotLuot(tx, a, { traLoi: Object.fromEntries(nhap.map((d) => [d.questionId, d.answerJson])), now, submittedAt: a.dueAt, lyDo: "DEADLINE_AUTO", soBan: a.versionNumber ?? ban?.number ?? 1 });
  return { ket: "DA_CHOT_TU_NHAP", trangThai: r.chamXong ? "GRADED" : "SUBMITTED", chamXong: r.chamXong };
}

/** Worker/cron (A vận hành): chốt tối đa `gioiHan` lượt quá hạn, mỗi lượt MỘT giao dịch riêng (một lượt lỗi không kéo cả lô). Chạy lại bao nhiêu lần cũng không chấm trùng. */
export async function doiSoatLuotQuaHan(db: Db, o: { now: Date; gioiHan?: number }): Promise<{ daChot: number; hetHanKhongNhap: number; boQua: number; loi: { attemptId: string; thongBao: string }[]; conLai: boolean }> {
  const gioiHan = Math.min(Math.max(Math.floor(o.gioiHan ?? 50), 1), 500);
  const ds = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OnlAttempt" WHERE "status" = 'IN_PROGRESS' AND "dueAt" IS NOT NULL AND "dueAt" + (${DUNG_SAI_CHOT_GIAY} * interval '1 second') <= ${o.now} ORDER BY "dueAt" ASC LIMIT ${gioiHan + 1}`;
  const kq = { daChot: 0, hetHanKhongNhap: 0, boQua: 0, loi: [] as { attemptId: string; thongBao: string }[], conLai: ds.length > gioiHan };
  for (const { id } of ds.slice(0, gioiHan)) {
    try {
      const r = await db.$transaction((tx) => chotLuotQuaHanTrongTx(tx, id, o.now, { boQuaNeuDangKhoa: true }));
      if (r.ket === "DA_CHOT_TU_NHAP") kq.daChot++;
      else if (r.ket === "HET_HAN_KHONG_NHAP") kq.hetHanKhongNhap++;
      else kq.boQua++;
    } catch (e) {
      kq.loi.push({ attemptId: id, thongBao: e instanceof Error ? e.message : "lỗi không rõ" });
    }
  }
  return kq;
}

// ───────── Lưu nháp ─────────

export const luuNhapSchema = z
  .object({
    requestId: z.string().trim().min(8).max(100),
    deviceId: z.string().trim().min(1).max(100).optional(),
    items: z
      .array(z.object({ questionId: z.string().min(1).max(60), answer: z.unknown(), baseRevision: z.number().int().min(0).max(1_000_000) }).strict())
      .min(1)
      .max(TOI_DA_CAU_TREN_CUNG),
  })
  .strict();

export type DauVaoNhap = { parentUserId: string; studentId: string; courseId: string; lessonStableId: string; attemptId: string; now: Date };
export type KetQuaMotCau =
  | { questionId: string; ketQua: "SAVED"; revision: number; savedAt: string }
  | { questionId: string; ketQua: "CONFLICT" | "AHEAD"; serverRevision: number; serverAnswer: unknown; serverSavedAt: string | null };
export type NhapDaLuu = { ok: true; replayed: boolean; trangThai: OnlAttemptStatus; serverNow: string; hetGioLuc: string | null; giayConLai: number | null; draftRevision: number; items: KetQuaMotCau[] };

const giayConLai = (due: Date | null, now: Date) => (due ? Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 1000)) : null);
const bang = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export async function luuNhap(db: Db, input: DauVaoNhap & { yeuCau: unknown }, cauHinh: CauHinhTanSuat = TAN_SUAT_NHAP): Promise<NhapDaLuu | FailNhap> {
  const p = luuNhapSchema.safeParse(input.yeuCau);
  if (!p.success) return fail("YEU_CAU_KHONG_HOP_LE", p.error.issues[0]?.message ?? "Yêu cầu không hợp lệ");
  const y = p.data;
  if (y.items.length > cauHinh.toiDaCauMoiYeuCau) return fail("YEU_CAU_KHONG_HOP_LE", `Tối đa ${cauHinh.toiDaCauMoiYeuCau} câu mỗi yêu cầu`);
  if (new Set(y.items.map((i) => i.questionId)).size !== y.items.length) return fail("YEU_CAU_KHONG_HOP_LE", "Một yêu cầu không được ghi hai lần cùng một câu");
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return fail(cong.ma, "Không vào được bài này");

  return db.$transaction(async (tx): Promise<NhapDaLuu | FailNhap> => {
    const q = await tx.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
    if (!q) return fail("KHONG_CO_QUYEN_HOC", "Không có quyền học");
    await tx.$queryRaw`SELECT "id" FROM "OnlEntitlement" WHERE "id" = ${q.id} FOR UPDATE`; // cùng thứ tự khoá với nộp/thu hồi: quyền trước, lượt sau
    await tx.$queryRaw`SELECT "id" FROM "OnlAttempt" WHERE "id" = ${input.attemptId} FOR UPDATE`;
    const a = await tx.onlAttempt.findUnique({ where: { id: input.attemptId } });
    if (!a || a.entitlementId !== q.id || a.studentId !== input.studentId || a.lessonStableId !== input.lessonStableId) return fail("LUOT_KHONG_TON_TAI", "Không tìm thấy lượt làm bài");

    // Gọi lại cùng requestId ⇒ trả đúng kết quả đã ghi (kể cả khi lượt đã chốt sau đó). Không tính vào tần suất.
    const cu = await tx.onlAttemptDraftOp.findUnique({ where: { attemptId_requestId: { attemptId: a.id, requestId: y.requestId } }, select: { resultJson: true } });
    if (cu) {
      const kq = cu.resultJson as unknown as { items: KetQuaMotCau[]; draftRevision: number };
      return { ok: true, replayed: true, trangThai: a.status, serverNow: input.now.toISOString(), hetGioLuc: a.dueAt?.toISOString() ?? null, giayConLai: giayConLai(a.dueAt, input.now), draftRevision: kq.draftRevision, items: kq.items };
    }
    if (a.status === "INTERRUPTED") return fail("LUOT_BI_GIAN_DOAN", "Lượt làm bài đã bị gián đoạn do thu hồi quyền");
    if (a.status !== "IN_PROGRESS") return fail("LUOT_DA_CHOT", "Lượt làm bài đã được chốt — không ghi thêm đáp án");
    if (a.dueAt && input.now.getTime() > a.dueAt.getTime()) {
      const r = await chotLuotQuaHanTrongTx(tx, a.id, input.now); // đọc/ghi sau hạn ⇒ chốt lười nếu đã quá dung sai
      return fail("HET_GIO", "Đã quá thời gian làm bài — máy chủ không nhận thêm đáp án", { daChot: r.ket === "DA_CHOT_TU_NHAP" || r.ket === "HET_HAN_KHONG_NHAP" });
    }

    const tu = new Date(input.now.getTime() - cauHinh.cuaSoGiay * 1000);
    const gan = await tx.onlAttemptDraftOp.findMany({ where: { attemptId: a.id, createdAt: { gt: tu } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    if (gan.length >= cauHinh.toiDaYeuCauMoiPhut) {
      const doi = Math.max(1, Math.ceil((gan[0]!.createdAt.getTime() + cauHinh.cuaSoGiay * 1000 - input.now.getTime()) / 1000));
      return fail("VUOT_TAN_SUAT", "Gửi nháp quá nhanh — thử lại sau", { retryAfterSec: doi });
    }

    // Giai đoạn 1: kiểm TẤT CẢ trước khi ghi (một câu sai ⇒ cả yêu cầu bị từ chối, không ghi nửa chừng).
    const snap = a.snapshotJson as unknown as SnapshotDe;
    const theoId = new Map(snap.cau.map((c) => [c.id, c]));
    const hopLe: { questionId: string; type: (typeof snap.cau)[number]["type"]; value: unknown; base: number }[] = [];
    for (const it of y.items) {
      const c = theoId.get(it.questionId);
      if (!c) return fail("CAU_KHONG_THUOC_LUOT", "Có câu hỏi không thuộc lượt làm bài này");
      const k = kiemDapAnNhap(c, it.answer);
      if (!k.ok) return fail("DAP_AN_KHONG_HOP_LE", k.thongBao);
      hopLe.push({ questionId: it.questionId, type: c.type, value: k.value, base: it.baseRevision });
    }
    // Giai đoạn 2: ghi theo khoá lạc quan.
    const hien = new Map((await tx.onlAttemptDraft.findMany({ where: { attemptId: a.id, questionId: { in: hopLe.map((h) => h.questionId) } } })).map((d) => [d.questionId, d]));
    const items: KetQuaMotCau[] = [];
    let daGhi = 0;
    for (const h of hopLe) {
      const d = hien.get(h.questionId);
      const srv = d?.revision ?? 0;
      if (h.base !== srv) {
        items.push({ questionId: h.questionId, ketQua: h.base < srv ? "CONFLICT" : "AHEAD", serverRevision: srv, serverAnswer: d?.answerJson ?? null, serverSavedAt: d?.savedAt.toISOString() ?? null });
        continue;
      }
      if (d && bang(d.answerJson, h.value)) {
        items.push({ questionId: h.questionId, ketQua: "SAVED", revision: d.revision, savedAt: d.savedAt.toISOString() }); // không đổi gì: giữ revision
        continue;
      }
      const moi = srv + 1;
      await tx.onlAttemptDraft.upsert({
        where: { attemptId_questionId: { attemptId: a.id, questionId: h.questionId } },
        create: { attemptId: a.id, studentId: a.studentId, courseId: input.courseId, assessmentId: a.assessmentId, versionNumber: a.versionNumber, questionId: h.questionId, questionType: h.type, answerJson: h.value as Prisma.InputJsonValue, revision: moi, deviceId: y.deviceId ?? null, savedAt: input.now },
        update: { answerJson: h.value as Prisma.InputJsonValue, revision: moi, deviceId: y.deviceId ?? null, savedAt: input.now },
      });
      daGhi++;
      items.push({ questionId: h.questionId, ketQua: "SAVED", revision: moi, savedAt: input.now.toISOString() });
    }
    const draftRevision = daGhi > 0 ? a.draftRevision + 1 : a.draftRevision;
    if (daGhi > 0) await tx.onlAttempt.update({ where: { id: a.id }, data: { draftRevision } });
    await tx.onlAttemptDraftOp.create({ data: { attemptId: a.id, requestId: y.requestId, resultJson: { items, draftRevision } as unknown as Prisma.InputJsonValue, createdAt: input.now } });
    return { ok: true, replayed: false, trangThai: "IN_PROGRESS", serverNow: input.now.toISOString(), hetGioLuc: a.dueAt?.toISOString() ?? null, giayConLai: giayConLai(a.dueAt, input.now), draftRevision, items };
  });
}

// ───────── Đọc trạng thái lượt + nháp ─────────

export type LuotNhapDto = {
  attemptId: string;
  soLuot: number;
  trangThai: OnlAttemptStatus;
  serverNow: string;
  hetGioLuc: string | null;
  giayConLai: number | null;
  draftRevision: number;
  /** Đáp án CỦA HỌC VIÊN đã được máy chủ ACK. Không có đáp án đúng. */
  nhap: { questionId: string; revision: number; savedAt: string; dapAn: unknown }[];
  /** Chỉ khi còn IN_PROGRESS: đề đã bỏ khoá + giải thích. */
  de: ReturnType<typeof veChoHocVien> | null;
  gianDoan: { thuHoiLuc: string; trangThai: "OPEN" | "COMPENSATED" | "NO_COMPENSATION_NEEDED" | "CAP_REACHED" | "PENDING_REVIEW" | "DENIED" } | null;
  lyDoChot: string | null;
};

/** Đọc lượt (+ chốt lười nếu đã quá hạn). Quyền: phụ huynh đúng con + quyền học còn hiệu lực. */
export async function docTrangThaiLuot(db: Db, input: DauVaoNhap): Promise<{ ok: true; luot: LuotNhapDto } | FailNhap> {
  const cong = await kiemTraTruyCapChoPhuHuynh(db, input);
  if (!cong.ok) return fail(cong.ma, "Không vào được bài này");
  return db.$transaction(async (tx): Promise<{ ok: true; luot: LuotNhapDto } | FailNhap> => {
    const q = await tx.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
    if (!q) return fail("KHONG_CO_QUYEN_HOC", "Không có quyền học");
    const truoc = await tx.onlAttempt.findUnique({ where: { id: input.attemptId }, select: { entitlementId: true, studentId: true, lessonStableId: true } });
    if (!truoc || truoc.entitlementId !== q.id || truoc.studentId !== input.studentId || truoc.lessonStableId !== input.lessonStableId) return fail("LUOT_KHONG_TON_TAI", "Không tìm thấy lượt làm bài");
    await chotLuotQuaHanTrongTx(tx, input.attemptId, input.now); // lười: học viên mở lại sau hạn ⇒ máy chủ chốt ngay
    const a = await tx.onlAttempt.findUniqueOrThrow({ where: { id: input.attemptId }, include: { interruption: { select: { interruptedAt: true, status: true } }, drafts: { orderBy: { savedAt: "asc" } } } });
    const snap = a.snapshotJson as unknown as SnapshotDe;
    return {
      ok: true,
      luot: {
        attemptId: a.id,
        soLuot: a.number,
        trangThai: a.status,
        serverNow: input.now.toISOString(),
        hetGioLuc: a.dueAt?.toISOString() ?? null,
        giayConLai: a.status === "IN_PROGRESS" ? giayConLai(a.dueAt, input.now) : null,
        draftRevision: a.draftRevision,
        nhap: a.drafts.map((d) => ({ questionId: d.questionId, revision: d.revision, savedAt: d.savedAt.toISOString(), dapAn: d.answerJson })),
        de: a.status === "IN_PROGRESS" ? veChoHocVien(snap) : null,
        gianDoan: a.interruption ? { thuHoiLuc: a.interruption.interruptedAt.toISOString(), trangThai: a.interruption.status } : null,
        lyDoChot: a.finalizeReason,
      },
    };
  });
}
