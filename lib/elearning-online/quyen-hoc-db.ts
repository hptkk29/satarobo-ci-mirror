import { chuyenTienDoHocThu } from "./hoc-thu-chuyen";
import { ghiGianDoanKhiThuHoi, taoBoiHoanSauCapLai, type CauHinhBoiHoan, type LoaiThuHoi } from "./gian-doan-db";
import type { Prisma, PrismaClient } from "@prisma/client";
import { docCaiDatHocTap } from "./cai-dat-hoc-tap";
import { banDuocLucNay } from "./danh-muc-cong-khai";
import { docTienDoKhoaTheoQuyen } from "./tien-do-khoa-db";
import { baiCoMoDuoc, type BaiTrongBan, type TienDoBai } from "./tien-do";
import {
  kiemTraTruyCapNoiDung,
  quyetDinhCap,
  quyetDinhThuHoi,
  type HanhDongCap,
  type LoaiCap,
  type MaTuChoiTruyCap,
  type QuyenHienCo,
} from "./quyen-hoc";
import type { KyHan } from "./thoi-han";

/**
 * E-LEARNING ONLINE — LỚP DB CỦA QUYỀN HỌC (cấp · gia hạn · thu hồi · cổng truy cập), dùng `quyetDinhCap`/`quyetDinhThuHoi` thuần.
 *
 * Đây là NĂNG LỰC mà Workstream A (đơn hàng/webhook) và màn quản trị gọi — E-learning KHÔNG chạm `Order`/`payments`.
 *
 * Bất biến (mỗi cái có ca test DB riêng, `tests/elearning/onl-quyen-hoc-db.test.ts`):
 * 1. MỘT dòng quyền cho (học viên × khoá): khoá duy nhất ở DB. Hai lần cấp song song ⇒ một lần tạo, một lần thấy dòng và gia hạn/từ chối theo luật.
 * 2. `idempotencyKey` duy nhất: gọi lại (webhook/retry) KHÔNG cấp thêm, trả kết quả cũ (`daXuLyTruocDo: true`).
 * 3. Mọi cổng đứng TRƯỚC phép ghi đầu tiên; từ chối = `return` khi chưa ghi gì (luật rollback của repo).
 * 4. Hết hạn KHÔNG bao giờ được ghi bởi cron; đọc suy từ `expiresAt`.
 */

type Db = PrismaClient;
const MIN_KEY = 8;

export type MaLoiDb =
  | "KHOA_KHONG_TON_TAI"
  | "KHOA_KHONG_DANG_BAN"
  | "HOC_VIEN_KHONG_TON_TAI"
  | "KHOA_KHONG_CHO_GIA_HAN"
  | "DA_TRON_DOI"
  | "CHUA_CO_QUYEN_DE_GIA_HAN"
  | "KY_HAN_THIEU"
  | "KHOA_IDEMPOTENCY_KHONG_HOP_LE"
  | "THIEU_THAM_CHIEU_DON"
  | "LY_DO_QUA_NGAN"
  | "CHUA_CO_QUYEN"
  | "DA_THU_HOI"
  | "TIEN_QUYET_CHUA_DAT";

export type KetQuaCapDb =
  | { ok: true; daXuLyTruocDo: boolean; entitlementId: string; hanhDong: HanhDongCap; hetHan: Date | null }
  | { ok: false; ma: MaLoiDb; thongBao: string };

const KIND_THEO_HANH_DONG = {
  TAO_MOI: "GRANTED",
  GIA_HAN: "RENEWED",
  MO_LAI_SAU_HET_HAN: "REOPENED_AFTER_EXPIRY",
  MO_LAI_SAU_THU_HOI: "REOPENED_AFTER_REVOKE",
} as const;
const HANH_DONG_THEO_KIND: Record<string, HanhDongCap> = {
  GRANTED: "TAO_MOI",
  RENEWED: "GIA_HAN",
  REOPENED_AFTER_EXPIRY: "MO_LAI_SAU_HET_HAN",
  REOPENED_AFTER_REVOKE: "MO_LAI_SAU_THU_HOI",
};

/** Khoá tư vấn mức GIAO DỊCH (nhả khi commit/rollback) cho một cặp (học viên × khoá). `hashtextextended` (PG ≥ 11) cho khoá 64-bit. */
async function khoaTuVanQuyen(tx: Prisma.TransactionClient, studentId: string, courseId: string): Promise<void> {
  // `$executeRaw`, không `$queryRaw`: hàm trả kiểu `void` mà Prisma không giải mã được.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`onl-quyen:${studentId}:${courseId}`}, 0))`;
}

const laP2002 = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

export type CapQuyenInput = {
  studentId: string;
  courseId: string;
  loai: LoaiCap;
  /** BẮT BUỘC, ≥ 8 ký tự. Webhook: dùng id giao dịch/đơn ổn định; quản trị: khoá sinh ở client cho mỗi lần bấm. */
  idempotencyKey: string;
  now: Date;
  orderId?: string | null;
  orderItemId?: string | null;
  actorUserId?: string | null;
  reason?: string | null;
  /**
   * CR-01 (Workstream A, 20/11/2026): thời điểm NGƯỜI GỌI đã kiểm cổng "đang bán" lúc ĐẶT ĐƠN. Chỉ áp cho `loai: "MUA"` và BẮT BUỘC kèm `orderId` (dấu vết).
   * Có ⇒ cổng "đang bán" LÚC GỌI được miễn: tiền đã nhận thì quyền phải được cấp dù khoá bị gỡ khỏi bán/hết hẹn giờ giữa lúc đặt đơn và lúc tiền về.
   * KHÔNG miễn: khoá không tồn tại/đã xoá, học viên không tồn tại, luật cấp (`quyetDinhCap`). Không truyền ⇒ hành vi cũ nguyên vẹn.
   * Ghi vào sổ sự kiện (`reason`) để kiểm toán thấy cổng đã được miễn và theo lời khai của ai.
   */
  daKiemCongBanLucDatDon?: Date | null;
  /** P0 Mobile: ngưỡng xem xét bồi hoàn (xem `gian-doan-db.ts`). Không truyền ⇒ mặc định kỹ thuật (CHƯA phải chính sách Owner). */
  cauHinhBoiHoan?: CauHinhBoiHoan;
};

export async function capQuyenHoc(db: Db, input: CapQuyenInput): Promise<KetQuaCapDb> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < MIN_KEY) {
    return { ok: false, ma: "KHOA_IDEMPOTENCY_KHONG_HOP_LE", thongBao: `Khoá idempotency phải có ít nhất ${MIN_KEY} ký tự` };
  }
  if (input.daKiemCongBanLucDatDon && !input.orderId) {
    return { ok: false, ma: "THIEU_THAM_CHIEU_DON", thongBao: "Miễn cổng đang-bán chỉ hợp lệ khi có đơn hàng tham chiếu (orderId)" };
  }
  // Va khoá duy nhất khi hai lượt cùng TẠO một quyền: lượt thua thử lại một lần — lúc đó thấy dòng của lượt thắng.
  for (let lan = 0; ; lan++) {
    try {
      return await capQuyenHocMotLan(db, input);
    } catch (e) {
      if (laP2002(e) && lan < 2) continue;
      throw e;
    }
  }
}

/**
 * C13 — học viên đã ĐẠT khoá tiên quyết chưa? "Hoàn thành hợp lệ" HOẶC "chứng nhận hợp lệ đã cấp" (Owner 25/11/2026).
 *  · chứng nhận `ISSUED` của khoá đó (bền: kể cả khi quyền sau này bị thu hồi / khoá đổi bản) ⇒ đạt;
 *  · hoặc quyền khoá đó KHÔNG bị thu hồi (hết hạn vẫn tính) và tiến độ SỐNG `hoanThanh` ⇒ đạt;
 *  · khoá tiên quyết đã xoá mềm / không còn ⇒ coi như không có điều kiện (không chặn mãi mãi vì một khoá không còn để học).
 */
async function daDatTienQuyet(tx: Prisma.TransactionClient, studentId: string, tienQuyetId: string): Promise<boolean> {
  const khoaTQ = await tx.onlCourse.findFirst({ where: { id: tienQuyetId, deletedAt: null }, select: { id: true } });
  if (!khoaTQ) return true;
  const cn = await tx.onlCertificate.findFirst({ where: { studentId, courseId: tienQuyetId, status: "ISSUED" }, select: { id: true } });
  if (cn) return true;
  const q = await tx.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId, courseId: tienQuyetId } }, select: { id: true, status: true } });
  if (!q || q.status === "REVOKED") return false;
  return (await docTienDoKhoaTheoQuyen(tx, q.id, tienQuyetId)).hoanThanh;
}

async function capQuyenHocMotLan(db: Db, input: CapQuyenInput): Promise<KetQuaCapDb> {
  return db.$transaction(async (tx) => {
    // ── KHOÁ TƯ VẤN theo (học viên × khoá) — PHẢI là câu ĐẦU, trước kiểm khoá idempotency ──
    // CR-02: `SELECT … FOR UPDATE` ở dưới trả RỖNG khi dòng quyền chưa tồn tại nên không khoá được gì. Không có khoá này, lượt THUA đua cùng khoá idempotency
    // kiểm khoá ở câu đầu (chưa thấy sự kiện của lượt THẮNG), rồi đọc quyền ở câu sau (đã thấy dòng lượt THẮNG vừa commit) ⇒ rơi vào luật ⇒ LỖI LUẬT OAN
    // dù sự kiện của chính khoá này đã ghi. Khoá theo cặp (không theo khoá idempotency) để cấp/thu hồi khác khoá cũng xếp hàng.
    await khoaTuVanQuyen(tx, input.studentId, input.courseId);
    // ── CỔNG (chưa ghi gì) ──
    const daCo = await tx.onlEntitlementEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { entitlementId: true, kind: true, toExpiresAt: true } });
    if (daCo) {
      return { ok: true, daXuLyTruocDo: true, entitlementId: daCo.entitlementId, hanhDong: HANH_DONG_THEO_KIND[daCo.kind] ?? "TAO_MOI", hetHan: daCo.toExpiresAt };
    }
    const khoa = await tx.onlCourse.findFirst({
      where: { id: input.courseId, deletedAt: null },
      select: { id: true, validityMonths: true, renewalEnabled: true, saleStatus: true, saleOpensAt: true, prerequisiteMode: true, prerequisiteCourseId: true },
    });
    if (!khoa) return { ok: false, ma: "KHOA_KHONG_TON_TAI", thongBao: "Khoá online không tồn tại" };
    const mienCongBan = input.loai === "MUA" && !!input.daKiemCongBanLucDatDon;
    if (input.loai === "MUA" && !mienCongBan && !banDuocLucNay(khoa.saleStatus, khoa.saleOpensAt, input.now)) {
      return { ok: false, ma: "KHOA_KHONG_DANG_BAN", thongBao: "Khoá không ở trạng thái đang bán" };
    }
    const hocVien = await tx.student.findUnique({ where: { id: input.studentId }, select: { id: true } });
    if (!hocVien) return { ok: false, ma: "HOC_VIEN_KHONG_TON_TAI", thongBao: "Học viên không tồn tại" };

    // Khoá dòng quyền (nếu có) để hai lượt cấp song song trên CÙNG dòng xếp hàng.
    await tx.$queryRaw`SELECT "id" FROM "OnlEntitlement" WHERE "studentId" = ${input.studentId} AND "courseId" = ${input.courseId} FOR UPDATE`;
    const hien = await tx.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } } });
    const quyen: QuyenHienCo | null = hien ? { trangThai: hien.status, hetHan: hien.expiresAt, anchorDay: hien.anchorDay } : null;
    const ky: KyHan = khoa.validityMonths === null ? { loai: "TRON_DOI" } : { loai: "THANG", soThang: khoa.validityMonths };

    const qd = quyetDinhCap({ now: input.now, loai: input.loai, quyen, ky, choPhepGiaHan: khoa.renewalEnabled });
    if (!qd.ok) return { ok: false, ma: qd.ma, thongBao: qd.thongBao };
    // C13 (Owner 25/11/2026): TIÊN QUYẾT `REQUIRED` — chỉ khi TẠO MỚI / MỞ LẠI quyền (gia hạn người đang có quyền không bị chặn); `RECOMMENDED`/`NONE` không chặn. Trước mọi phép ghi.
    const taoHoacMoLai = !hien || qd.hanhDong === "MO_LAI_SAU_HET_HAN" || qd.hanhDong === "MO_LAI_SAU_THU_HOI";
    if (taoHoacMoLai && khoa.prerequisiteMode === "REQUIRED" && khoa.prerequisiteCourseId && !(await daDatTienQuyet(tx, input.studentId, khoa.prerequisiteCourseId))) {
      return { ok: false, ma: "TIEN_QUYET_CHUA_DAT", thongBao: "Học viên chưa hoàn thành khoá tiên quyết (cần hoàn thành khoá hoặc có chứng nhận hợp lệ của khoá đó)" };
    }

    // ── GHI ──
    const nguon = input.loai === "CAP_MIEN_PHI" ? ("FREE_GRANT" as const) : ("PURCHASE" as const);
    let entitlementId: string;
    if (!hien) {
      const moi = await tx.onlEntitlement.create({
        data: {
          studentId: input.studentId,
          courseId: input.courseId,
          status: "ACTIVE",
          source: nguon,
          startsAt: input.now,
          expiresAt: qd.hetHan,
          anchorDay: qd.anchorDay,
          validityMonthsSnapshot: khoa.validityMonths,
        },
        select: { id: true },
      });
      entitlementId = moi.id;
    } else {
      const moLai = qd.hanhDong === "MO_LAI_SAU_HET_HAN" || qd.hanhDong === "MO_LAI_SAU_THU_HOI";
      const data: Prisma.OnlEntitlementUpdateInput = {
        expiresAt: qd.hetHan,
        anchorDay: qd.anchorDay,
        validityMonthsSnapshot: khoa.validityMonths,
        ...(moLai ? { status: "ACTIVE", source: nguon, startsAt: input.now, revokedAt: null, revokedReason: null, revokedByUserId: null } : {}),
      };
      await tx.onlEntitlement.update({ where: { id: hien.id }, data });
      entitlementId = hien.id;
    }
    // F4 (Owner 25/11/2026): quyền học THẬT được tạo/mở lại ⇒ chuyển tiến độ học thử (idempotent; không đụng lượt thi/điểm).
    if (!hien || qd.hanhDong === "MO_LAI_SAU_HET_HAN" || qd.hanhDong === "MO_LAI_SAU_THU_HOI") await chuyenTienDoHocThu(tx, { studentId: input.studentId, courseId: input.courseId, entitlementId, now: input.now });
    const suKienCap = await tx.onlEntitlementEvent.create({
      select: { id: true },
      data: {
        entitlementId,
        kind: KIND_THEO_HANH_DONG[qd.hanhDong],
        source: nguon,
        idempotencyKey: input.idempotencyKey,
        monthsAdded: qd.thangDaCong,
        fromExpiresAt: hien?.expiresAt ?? null,
        toExpiresAt: qd.hetHan,
        orderId: input.orderId ?? null,
        orderItemId: input.orderItemId ?? null,
        reason: input.reason ?? (mienCongBan ? `Đã kiểm cổng đang-bán lúc đặt đơn (${input.daKiemCongBanLucDatDon!.toISOString()}); cổng lúc thu tiền được miễn` : null),
        actorUserId: input.actorUserId ?? null,
      },
    });
    // P0 Mobile: cấp lại SAU thu hồi ⇒ mỗi lượt từng bị gián đoạn được tối đa MỘT quyền bồi hoàn (idempotent, có trần).
    if (qd.hanhDong === "MO_LAI_SAU_THU_HOI") await taoBoiHoanSauCapLai(tx, { entitlementId, studentId: input.studentId, grantEventId: suKienCap.id, actorUserId: input.actorUserId ?? null, now: input.now, cauHinh: input.cauHinhBoiHoan });
    return { ok: true, daXuLyTruocDo: false, entitlementId, hanhDong: qd.hanhDong, hetHan: qd.hetHan };
  });
}

export type KetQuaThuHoiDb =
  | { ok: true; daXuLyTruocDo: boolean; entitlementId: string }
  | { ok: false; ma: MaLoiDb; thongBao: string };

export async function thuHoiQuyenHoc(
  db: Db,
  input: {
    studentId: string;
    courseId: string;
    reason: string;
    idempotencyKey: string;
    now: Date;
    actorUserId?: string | null;
    /**
     * P0 Mobile: LOẠI thu hồi. CHỈ "ADMIN" (quản trị thu hồi) làm gián đoạn lượt đang làm và mở quyền bồi hoàn. Mặc định "KHAC" = KHÔNG bồi hoàn
     * (hoàn tiền → "HOAN_TIEN", khoá tài khoản bảo mật → "BAO_MAT" cũng không bồi hoàn). Người gọi tự động (A) PHẢI truyền đúng loại.
     */
    loaiThuHoi?: LoaiThuHoi;
  },
): Promise<KetQuaThuHoiDb> {
  if (!input.idempotencyKey || input.idempotencyKey.trim().length < MIN_KEY) {
    return { ok: false, ma: "KHOA_IDEMPOTENCY_KHONG_HOP_LE", thongBao: `Khoá idempotency phải có ít nhất ${MIN_KEY} ký tự` };
  }
  const lyDo = (input.reason ?? "").trim();
  if (lyDo.length < 10) return { ok: false, ma: "LY_DO_QUA_NGAN", thongBao: "Lý do thu hồi phải có ít nhất 10 ký tự" };
  return db.$transaction(async (tx) => {
    await khoaTuVanQuyen(tx, input.studentId, input.courseId); // cùng khoá với cấp quyền — xem CR-02 ở `capQuyenHocMotLan`
    const daCo = await tx.onlEntitlementEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { entitlementId: true } });
    if (daCo) return { ok: true, daXuLyTruocDo: true, entitlementId: daCo.entitlementId };
    await tx.$queryRaw`SELECT "id" FROM "OnlEntitlement" WHERE "studentId" = ${input.studentId} AND "courseId" = ${input.courseId} FOR UPDATE`;
    const hien = await tx.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } } });
    const qd = quyetDinhThuHoi(hien ? { trangThai: hien.status } : null);
    if (!qd.ok) return { ok: false, ma: qd.ma, thongBao: qd.thongBao };
    await tx.onlEntitlement.update({
      where: { id: hien!.id },
      data: { status: "REVOKED", revokedAt: input.now, revokedReason: lyDo, revokedByUserId: input.actorUserId ?? null },
    });
    const suKien = await tx.onlEntitlementEvent.create({
      data: {
        entitlementId: hien!.id,
        kind: "REVOKED",
        idempotencyKey: input.idempotencyKey,
        fromExpiresAt: hien!.expiresAt,
        toExpiresAt: hien!.expiresAt,
        reason: lyDo,
        actorUserId: input.actorUserId ?? null,
      },
      select: { id: true },
    });
    // P0 Mobile: bảo toàn lượt đang làm (không chấm rớt) khi QUẢN TRỊ thu hồi — cùng giao dịch, cùng khoá quyền.
    await ghiGianDoanKhiThuHoi(tx, { entitlementId: hien!.id, studentId: input.studentId, courseId: input.courseId, loaiThuHoi: input.loaiThuHoi ?? "KHAC", actorUserId: input.actorUserId ?? null, revokeEventId: suKien.id, now: input.now });
    return { ok: true, daXuLyTruocDo: false, entitlementId: hien!.id };
  });
}

// ───────── Cổng truy cập nội dung (đọc DB, rồi gọi hàm thuần) ─────────

export type MaTruyCapDb = MaTuChoiTruyCap | "KHOA_CHUA_PHAT_HANH" | "BAI_KHONG_TON_TAI" | "CAI_DAT_KHONG_HOP_LE" | "BAI_CHUA_MO" | "BAI_DA_AN";
export type KetQuaTruyCapDb = { ok: true } | { ok: false; ma: MaTruyCapDb; lyDoMo?: "BAI_TRUOC_CHUA_XONG" | "CHUONG_TRUOC_CHUA_XONG" | "CHUA_DU_DIEU_KIEN_THI_CUOI" };

/**
 * MỘT cổng cho mọi đầu ra nội dung bài (trang học, API bài, vé media): có quyền? còn hạn? chưa thu hồi? bài đã mở theo thứ tự?
 * bài ẩn? bài đã xong + khoá bật "không cho xem lại"? Cài đặt đọc từ BẢN ĐANG CHẠY; cài đặt hỏng ⇒ ĐÓNG (không lặng lẽ cho xem).
 *
 * Thứ tự kiểm (rẻ → đắt, và quyền TRƯỚC mọi thứ nói về nội dung để không lộ bài nào tồn tại cho người không có quyền):
 * quyền · hạn · thu hồi → bản đang chạy → bài tồn tại → bài ẨN (chỉ người đã từng học nó) → bài chưa mở theo `moBaiTiepTheo` → không xem lại.
 */
export async function kiemTraTruyCapNoiDungDb(db: Db, input: { studentId: string; courseId: string; lessonStableId: string; now: Date }): Promise<KetQuaTruyCapDb> {
  const quyen = await db.onlEntitlement.findUnique({
    where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } },
    select: { id: true, status: true, expiresAt: true },
  });
  if (!quyen) return { ok: false, ma: "KHONG_CO_QUYEN" };
  const truocNoiDung = kiemTraTruyCapNoiDung({ now: input.now, quyen: { trangThai: quyen.status, hetHan: quyen.expiresAt }, chinhSachKhongXemLai: false, baiDaHoanThanh: false });
  if (!truocNoiDung.ok) return { ok: false, ma: truocNoiDung.ma };
  const khoa = await db.onlCourse.findUnique({ where: { id: input.courseId }, select: { publishedVersionId: true, deletedAt: true } });
  if (!khoa?.publishedVersionId || khoa.deletedAt) return { ok: false, ma: "KHOA_CHUA_PHAT_HANH" };
  const [ban, tienDoDong] = await Promise.all([
    db.onlCourseVersion.findUnique({
      where: { id: khoa.publishedVersionId },
      select: {
        settingsJson: true,
        chapters: { select: { id: true, stableId: true, orderIndex: true, hidden: true } },
        lessons: { select: { stableId: true, chapterId: true, kind: true, required: true, hidden: true, orderIndex: true } },
      },
    }),
    db.onlLessonProgress.findMany({ where: { entitlementId: quyen.id }, select: { lessonStableId: true, status: true } }),
  ]);
  if (!ban) return { ok: false, ma: "KHOA_CHUA_PHAT_HANH" };
  const bai = ban.lessons.find((b) => b.stableId === input.lessonStableId);
  if (!bai) return { ok: false, ma: "BAI_KHONG_TON_TAI" };
  const cd = docCaiDatHocTap(ban.settingsJson);
  if (!cd.ok) return { ok: false, ma: "CAI_DAT_KHONG_HOP_LE" };

  const tienDo: TienDoBai = Object.fromEntries(tienDoDong.map((t) => [t.lessonStableId, t.status]));
  const chuong = new Map(ban.chapters.map((c) => [c.id, c]));
  // Bài ẨN (hoặc nằm trong chương ẩn) chỉ mở với người ĐÃ BẮT ĐẦU/ĐÃ XONG nó ở bản trước; người chưa học không thấy nó tồn tại.
  const anHieuLuc = bai.hidden || !!chuong.get(bai.chapterId)?.hidden;
  if (anHieuLuc && !(tienDo[bai.stableId] === "IN_PROGRESS" || tienDo[bai.stableId] === "COMPLETED")) return { ok: false, ma: "BAI_DA_AN" };

  const cay: BaiTrongBan[] = [...ban.lessons]
    .sort((a, b) => (chuong.get(a.chapterId)?.orderIndex ?? 0) - (chuong.get(b.chapterId)?.orderIndex ?? 0) || a.orderIndex - b.orderIndex)
    .map((b, i) => ({
      stableId: b.stableId,
      chapterStableId: chuong.get(b.chapterId)?.stableId ?? "",
      kind: b.kind,
      required: b.required,
      hidden: b.hidden || !!chuong.get(b.chapterId)?.hidden,
      thuTu: i,
      thuTuChuong: chuong.get(b.chapterId)?.orderIndex ?? 0,
    }));
  // Bài đã học xong thì không bị khoá lại vì bản mới chèn bài bắt buộc phía trước (không "đóng cửa" người đã đi qua).
  if (tienDo[bai.stableId] !== "COMPLETED") {
    const mo = baiCoMoDuoc(cay, tienDo, cd.caiDat, bai.stableId);
    if (!mo.mo) return { ok: false, ma: "BAI_CHUA_MO", lyDoMo: mo.lyDo === "BAI_KHONG_TON_TAI" ? undefined : mo.lyDo };
  }
  const r = kiemTraTruyCapNoiDung({
    now: input.now,
    quyen: { trangThai: quyen.status, hetHan: quyen.expiresAt },
    chinhSachKhongXemLai: cd.caiDat.khongChoXemLaiBaiDaQua,
    baiDaHoanThanh: tienDo[bai.stableId] === "COMPLETED",
  });
  return r.ok ? { ok: true } : { ok: false, ma: r.ma };
}
