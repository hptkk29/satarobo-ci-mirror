import type { OnlInterruptionStatus, Prisma, PrismaClient } from "@prisma/client";
import type { SnapshotDe } from "./cham-diem";

/**
 * E-LEARNING ONLINE — GIÁN ĐOẠN LƯỢT THI KHI ADMIN THU HỒI + BỒI HOÀN CÓ KIỂM SOÁT (P0 Mobile, chính sách Owner = phương án A). Bảng `Onl*` (công ty).
 *
 * Quy tắc (mỗi quy tắc có ca test `ONL-GD-*`):
 * 1. CHỈ thu hồi do ADMIN (`loaiThuHoi = "ADMIN"`) làm gián đoạn lượt. Hoàn tiền / bảo mật / khác / hết hạn tự nhiên ⇒ KHÔNG gián đoạn, KHÔNG bồi hoàn.
 * 2. CHỈ lượt đang IN_PROGRESS và CÒN HẠN lúc thu hồi (`dueAt` rỗng hoặc `now < dueAt`). Lượt đã nộp/đã chấm/hết giờ/chưa bắt đầu ⇒ không đụng.
 * 3. Lượt gián đoạn: giữ NGUYÊN (không xoá, không chấm, không sửa điểm, không hồi sinh thời gian), nháp được giữ; trạng thái INTERRUPTED; không ghi thêm.
 * 4. Bồi hoàn xảy ra lúc CẤP LẠI sau thu hồi (`MO_LAI_SAU_THU_HOI`): mỗi sự kiện gián đoạn ⇒ tối đa MỘT quyền dùng một lượt thay thế (`interruptionId` duy nhất ⇒ cấp lại bao nhiêu lần cũng không trùng).
 * 5. KHÔNG có trần cứng: mỗi sự kiện gián đoạn HỢP LỆ (lượt thật đang làm, còn hạn, do Admin thu hồi) đều được bồi hoàn — Admin thu hồi bao nhiêu lần thì học viên không mất lượt bấy nhiêu lần.
 *    Chống lạm dụng = ngưỡng XEM XÉT cấu hình được (`CauHinhBoiHoan`): vượt ngưỡng trong cửa sổ ngày ⇒ `PENDING_REVIEW` (chưa bồi hoàn) cho tới khi Admin DUYỆT/TỪ CHỐI có lý do (`quyetBoiHoan`). Mặc định chỉ là điểm khởi đầu, KHÔNG phải quyết định của Owner.
 * 6. D2 (Owner 21/11/2026): thi lại KHÔNG giới hạn ⇒ bồi hoàn KHÔNG còn là hạn mức lượt. Nó là quyền dùng MỘT lượt thay thế có liên kết tới sự kiện gián đoạn và GIỮ ĐÚNG bản chụp đề của lượt bị gián đoạn (D3);
 *    lượt thay thế mới có hạn riêng (không hồi sinh giờ của lượt cũ). Mỗi sự kiện gián đoạn chỉ một lượt thay thế (unique), kể cả khi retry/cấp lại nhiều lần. Lịch sử không bị sửa.
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type LoaiThuHoi = "ADMIN" | "HOAN_TIEN" | "BAO_MAT" | "KHAC";
export const LOAI_THU_HOI: readonly LoaiThuHoi[] = ["ADMIN", "HOAN_TIEN", "BAO_MAT", "KHAC"];
export type CauHinhBoiHoan = {
  /** Số bồi hoàn tự động tối đa trong cửa sổ cho mỗi (quyền × bài); sự kiện kế tiếp chờ Admin xem xét. `Infinity` = không bao giờ xem xét. */
  nguongXemXet: number;
  /** Cửa sổ (ngày) tính ngưỡng. */
  cuaSoNgay: number;
};
/** Mặc định = KHÔNG BAO GIỜ chuyển sang xem xét (không trần, theo D2). Người gọi (A) có thể truyền ngưỡng chống lạm dụng qua `capQuyenHoc({ cauHinhBoiHoan })`; sự kiện vượt ngưỡng chờ Admin quyết định. */
export const CAU_HINH_BOI_HOAN_MAC_DINH: CauHinhBoiHoan = { nguongXemXet: Number.POSITIVE_INFINITY, cuaSoNgay: 30 };

/** Gọi TRONG giao dịch thu hồi (đã giữ khoá quyền). Trả số lượt bị gián đoạn. */
export async function ghiGianDoanKhiThuHoi(tx: Tx, o: { entitlementId: string; studentId: string; courseId: string; loaiThuHoi: LoaiThuHoi; actorUserId: string | null; revokeEventId: string; now: Date }): Promise<{ soLuot: number }> {
  if (o.loaiThuHoi !== "ADMIN") return { soLuot: 0 };
  // Khoá các lượt đang làm của quyền này (thứ tự khoá: quyền → lượt, cùng nộp/lưu nháp) ⇒ submit/autosave đồng thời xếp hàng, kết quả xác định.
  const ds = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "OnlAttempt" WHERE "entitlementId" = ${o.entitlementId} AND "status" = 'IN_PROGRESS' ORDER BY "number" ASC FOR UPDATE`;
  let n = 0;
  for (const { id } of ds) {
    const a = await tx.onlAttempt.findUniqueOrThrow({ where: { id }, select: { id: true, assessmentId: true, dueAt: true, draftRevision: true } });
    if (a.dueAt && o.now.getTime() >= a.dueAt.getTime()) continue; // đã quá hạn lúc thu hồi: không phải do thu hồi ⇒ để tự chốt theo hạn
    const soNhap = await tx.onlAttemptDraft.count({ where: { attemptId: a.id } });
    await tx.onlAttempt.update({ where: { id: a.id }, data: { status: "INTERRUPTED" } });
    await tx.onlAttemptInterruption.create({
      data: { attemptId: a.id, entitlementId: o.entitlementId, studentId: o.studentId, courseId: o.courseId, assessmentId: a.assessmentId, reasonCode: o.loaiThuHoi, revokeEventId: o.revokeEventId, revokedByUserId: o.actorUserId, interruptedAt: o.now, dueAtAtInterrupt: a.dueAt, draftCount: soNhap, draftRevisionAtInterrupt: a.draftRevision },
    });
    n++;
  }
  return { soLuot: n };
}

/** Gọi TRONG giao dịch CẤP LẠI sau thu hồi (đã giữ khoá quyền). Idempotent: chạy lại không tạo thêm. */
export async function taoBoiHoanSauCapLai(tx: Tx, o: { entitlementId: string; studentId: string; grantEventId: string; actorUserId: string | null; now: Date; cauHinh?: CauHinhBoiHoan }): Promise<{ daBoiHoan: number; choXemXet: number; khongCan: number }> {
  const cauHinh = o.cauHinh ?? CAU_HINH_BOI_HOAN_MAC_DINH;
  const mo = await tx.onlAttemptInterruption.findMany({ where: { entitlementId: o.entitlementId, status: "OPEN" }, orderBy: { interruptedAt: "asc" }, select: { id: true, assessmentId: true } });
  const kq = { daBoiHoan: 0, choXemXet: 0, khongCan: 0 };
  for (const g of mo) {
    await tx.$queryRaw`SELECT "id" FROM "OnlAttemptInterruption" WHERE "id" = ${g.id} FOR UPDATE`;
    const lai = await tx.onlAttemptInterruption.findUniqueOrThrow({ where: { id: g.id }, select: { status: true } });
    if (lai.status !== "OPEN") continue; // request khác vừa xử lý
    let trangThai: OnlInterruptionStatus;
    {
      const tuNgay = new Date(o.now.getTime() - cauHinh.cuaSoNgay * 86_400_000);
      const daCo = await tx.onlAttemptCompensation.count({ where: { entitlementId: o.entitlementId, assessmentId: g.assessmentId, grantedAt: { gte: tuNgay } } });
      if (daCo >= cauHinh.nguongXemXet) {
        trangThai = "PENDING_REVIEW"; // KHÔNG từ chối: chờ Admin quyết định
        kq.choXemXet++;
      } else {
        const r = await tx.onlAttemptCompensation.createMany({ data: [{ interruptionId: g.id, entitlementId: o.entitlementId, studentId: o.studentId, assessmentId: g.assessmentId, grantEventId: o.grantEventId, grantedByUserId: o.actorUserId, grantedAt: o.now }], skipDuplicates: true });
        trangThai = "COMPENSATED";
        kq.daBoiHoan += r.count;
      }
    }
    await tx.onlAttemptInterruption.update({ where: { id: g.id }, data: { status: trangThai } });
  }
  return kq;
}

export type KetQuaQuyetBoiHoan = { ok: true; trangThai: "COMPENSATED" | "DENIED"; daXuLyTruocDo: boolean } | { ok: false; ma: "KHONG_TON_TAI" | "KHONG_CHO_XEM_XET" | "LY_DO_QUA_NGAN" | "QUYET_KHONG_HOP_LE"; thongBao: string };

/** Admin xử lý trường hợp ngoại lệ: DUYỆT ⇒ tạo đúng MỘT quyền bồi hoàn; TỪ CHỐI ⇒ DENIED. Cần lý do ≥ 10 ký tự. Gọi lại cùng quyết định ⇒ idempotent; quyết định ngược lại sau khi đã quyết ⇒ từ chối. Quyền kiểm ở tầng action. */
export async function quyetBoiHoan(db: Db, o: { interruptionId: string; quyet: "DUYET" | "TU_CHOI"; actorUserId: string; lyDo: string; now: Date }): Promise<KetQuaQuyetBoiHoan> {
  if (o.quyet !== "DUYET" && o.quyet !== "TU_CHOI") return { ok: false, ma: "QUYET_KHONG_HOP_LE", thongBao: "Quyết định phải là DUYET hoặc TU_CHOI" };
  if (o.lyDo.trim().length < 10) return { ok: false, ma: "LY_DO_QUA_NGAN", thongBao: "Lý do phải có ít nhất 10 ký tự" };
  return db.$transaction(async (tx): Promise<KetQuaQuyetBoiHoan> => {
    await tx.$queryRaw`SELECT "id" FROM "OnlAttemptInterruption" WHERE "id" = ${o.interruptionId} FOR UPDATE`;
    const g = await tx.onlAttemptInterruption.findUnique({ where: { id: o.interruptionId }, select: { id: true, status: true, entitlementId: true, studentId: true, assessmentId: true } });
    if (!g) return { ok: false, ma: "KHONG_TON_TAI", thongBao: "Không tìm thấy sự kiện gián đoạn" };
    const muon = o.quyet === "DUYET" ? "COMPENSATED" : "DENIED";
    if (g.status === muon) return { ok: true, trangThai: muon, daXuLyTruocDo: true };
    if (g.status !== "PENDING_REVIEW") return { ok: false, ma: "KHONG_CHO_XEM_XET", thongBao: "Sự kiện này không ở trạng thái chờ xem xét" };
    if (muon === "COMPENSATED") await tx.onlAttemptCompensation.createMany({ data: [{ interruptionId: g.id, entitlementId: g.entitlementId, studentId: g.studentId, assessmentId: g.assessmentId, grantedByUserId: o.actorUserId, grantedAt: o.now }], skipDuplicates: true });
    await tx.onlAttemptInterruption.update({ where: { id: g.id }, data: { status: muon, reviewedByUserId: o.actorUserId, reviewedAt: o.now, reviewReason: o.lyDo.trim() } });
    return { ok: true, trangThai: muon, daXuLyTruocDo: false };
  });
}

/** Quyền lượt thay thế ĐANG CHỜ của (quyền × bài), cũ nhất trước, kèm bản chụp đề của lượt bị gián đoạn (D3). Gọi trong giao dịch đã giữ khoá quyền. */
export async function layBoiHoanKhaDung(tx: Tx, entitlementId: string, assessmentId: string): Promise<{ compensationId: string; snapshot: SnapshotDe; versionNumber: number | null } | null> {
  const c = await tx.onlAttemptCompensation.findFirst({ where: { entitlementId, assessmentId, status: "AVAILABLE" }, orderBy: { grantedAt: "asc" }, select: { id: true, interruption: { select: { attempt: { select: { snapshotJson: true, versionNumber: true } } } } } });
  if (!c) return null;
  return { compensationId: c.id, snapshot: c.interruption.attempt.snapshotJson as unknown as SnapshotDe, versionNumber: c.interruption.attempt.versionNumber };
}

export type ThongTinLuotConLai = { /** Luôn `null` = KHÔNG giới hạn (D2). */ toiDa: null; daDung: number; /** Số lượt thay thế (giữ bản chụp đề cũ) đang chờ. */ luotThayTheDangCho: number; conLai: null };

/** Học viên xem: đã làm bao nhiêu lượt; còn lượt thay thế đang chờ không. Không giới hạn số lượt. KHÔNG có điểm/đáp án. */
export async function docLuotConLai(db: Db | Tx, o: { entitlementId: string; assessmentId: string }): Promise<ThongTinLuotConLai> {
  const [daDung, cho] = await Promise.all([db.onlAttempt.count({ where: { entitlementId: o.entitlementId, assessmentId: o.assessmentId } }), db.onlAttemptCompensation.count({ where: { entitlementId: o.entitlementId, assessmentId: o.assessmentId, status: "AVAILABLE" } })]);
  return { toiDa: null, daDung, luotThayTheDangCho: cho, conLai: null };
}

/** Admin xem lịch sử gián đoạn + bồi hoàn của một khoá (hoặc một quyền). Không có đáp án đúng. Quyền kiểm ở tầng action. */
export function docLichSuGianDoan(db: Db, o: { courseId?: string; entitlementId?: string; take?: number }) {
  return db.onlAttemptInterruption.findMany({
    where: { ...(o.courseId ? { courseId: o.courseId } : {}), ...(o.entitlementId ? { entitlementId: o.entitlementId } : {}) },
    orderBy: { interruptedAt: "desc" },
    take: Math.min(o.take ?? 100, 500),
    select: {
      id: true, attemptId: true, entitlementId: true, studentId: true, courseId: true, assessmentId: true, reasonCode: true, status: true, revokeEventId: true, revokedByUserId: true, interruptedAt: true, dueAtAtInterrupt: true, draftCount: true, reviewedByUserId: true, reviewedAt: true, reviewReason: true,
      attempt: { select: { number: true, status: true } },
      compensation: { select: { id: true, status: true, grantEventId: true, grantedByUserId: true, grantedAt: true, usedAttemptId: true, usedAt: true } },
    },
  });
}

// ───────── EX-01 — Admin cấp bù lượt thi vì LỖI HỆ THỐNG ĐÃ XÁC MINH (không cần thu hồi) ─────────

export type KetQuaCapBuHeThong =
  | { ok: true; interruptionId: string; compensationId: string; daCoTruocDo: boolean }
  | { ok: false; ma: "LUOT_KHONG_TON_TAI" | "LUOT_DANG_LAM" | "LUOT_DA_GIAN_DOAN_DO_THU_HOI" | "LY_DO_QUA_NGAN" | "THIEU_BANG_CHUNG"; thongBao: string };

export const MA_LOI_HE_THONG = "LOI_HE_THONG";

/**
 * Owner EX-01: CHỈ cấp bù khi lỗi hệ thống được XÁC MINH hoặc có quyết định của quản trị có quyền; KHÔNG tự cấp khi học sinh tự thoát / hết giờ hợp lệ. Hàm này là đường "quyết định của quản trị":
 * không bao giờ được gọi từ luồng làm bài/tự chốt — chỉ từ action có quyền `onl:student:grant`. Bắt buộc lý do ≥ 10 ký tự VÀ bằng chứng (mã sự cố / ghi chú xác minh ≥ 5 ký tự), vào nhật ký.
 * Hành vi:
 *  - Chỉ cho lượt ĐÃ ĐÓNG (EXPIRED/SUBMITTED/GRADED…). Lượt đang làm (IN_PROGRESS) ⇒ từ chối (cứ tiếp tục); lượt đã bị gián đoạn do thu hồi ⇒ từ chối (đi đường `quyetBoiHoan`/cấp lại).
 *  - KHÔNG sửa lượt cũ: không đổi trạng thái, điểm, đáp án, chứng nhận (EX-02: không sửa kết quả hoàn tất). Chỉ tạo QUYỀN dùng MỘT lượt thay thế mang bản chụp đề của lượt đó.
 *  - Mỗi lượt tối đa MỘT lần bù (`OnlAttemptInterruption.attemptId` duy nhất): gọi lại / đồng thời ⇒ cùng kết quả (`daCoTruocDo: true`), không bù vô hạn.
 */
export async function capBuLoiHeThong(db: Db, o: { attemptId: string; actorUserId: string; lyDo: string; bangChung: string; now: Date }): Promise<KetQuaCapBuHeThong> {
  if (o.lyDo.trim().length < 10) return { ok: false, ma: "LY_DO_QUA_NGAN", thongBao: "Lý do phải có ít nhất 10 ký tự" };
  if (o.bangChung.trim().length < 5) return { ok: false, ma: "THIEU_BANG_CHUNG", thongBao: "Cần bằng chứng xác minh lỗi hệ thống (mã sự cố / ghi chú, ≥ 5 ký tự)" };
  return db.$transaction(async (tx): Promise<KetQuaCapBuHeThong> => {
    await tx.$queryRaw`SELECT "id" FROM "OnlAttempt" WHERE "id" = ${o.attemptId} FOR UPDATE`;
    const a = await tx.onlAttempt.findUnique({ where: { id: o.attemptId }, select: { id: true, status: true, entitlementId: true, studentId: true, assessmentId: true, dueAt: true, draftRevision: true, entitlement: { select: { courseId: true } } } });
    if (!a) return { ok: false, ma: "LUOT_KHONG_TON_TAI", thongBao: "Không tìm thấy lượt thi" };
    const cu = await tx.onlAttemptInterruption.findUnique({ where: { attemptId: a.id }, select: { id: true, reasonCode: true, compensation: { select: { id: true } } } });
    if (cu) {
      if (cu.reasonCode === MA_LOI_HE_THONG && cu.compensation) return { ok: true, interruptionId: cu.id, compensationId: cu.compensation.id, daCoTruocDo: true };
      return { ok: false, ma: "LUOT_DA_GIAN_DOAN_DO_THU_HOI", thongBao: "Lượt này đã được xử lý ở đường gián đoạn/bồi hoàn do thu hồi — dùng đường duyệt bồi hoàn" };
    }
    if (a.status === "IN_PROGRESS" || a.status === "INTERRUPTED") return { ok: false, ma: "LUOT_DANG_LAM", thongBao: "Lượt đang làm hoặc đang gián đoạn — không cấp bù; học viên tiếp tục lượt này" };
    const soNhap = await tx.onlAttemptDraft.count({ where: { attemptId: a.id } });
    const g = await tx.onlAttemptInterruption.create({
      data: {
        attemptId: a.id, entitlementId: a.entitlementId, studentId: a.studentId, courseId: a.entitlement.courseId, assessmentId: a.assessmentId, reasonCode: MA_LOI_HE_THONG, status: "COMPENSATED",
        interruptedAt: o.now, dueAtAtInterrupt: a.dueAt, draftCount: soNhap, draftRevisionAtInterrupt: a.draftRevision,
        reviewedByUserId: o.actorUserId, reviewedAt: o.now, reviewReason: `${o.lyDo.trim()} | bằng chứng: ${o.bangChung.trim()}`,
      },
      select: { id: true },
    });
    const c = await tx.onlAttemptCompensation.create({ data: { interruptionId: g.id, entitlementId: a.entitlementId, studentId: a.studentId, assessmentId: a.assessmentId, grantedByUserId: o.actorUserId, grantedAt: o.now }, select: { id: true } });
    return { ok: true, interruptionId: g.id, compensationId: c.id, daCoTruocDo: false };
  });
}
