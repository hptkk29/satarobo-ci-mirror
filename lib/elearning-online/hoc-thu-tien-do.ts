import type { Prisma, PrismaClient } from "@prisma/client";
import { docChinhSachHocThu } from "./hoc-thu-chuyen";
import { capQuyenHoc, type KetQuaCapDb } from "./quyen-hoc-db";
import { banDuocLucNay } from "./danh-muc-cong-khai";
import { kiemTraTruyCapBaiMienPhi } from "./ve-hoc-thu";

/**
 * FREE MODE — CHÍNH SÁCH + TIẾN ĐỘ + TỰ NHẬN + NÂNG CẤP (Owner F1–F4, 25/11/2026). Nối tiếp `ve-hoc-thu.ts` (OD06=A: dùng ĐĂNG NHẬP HIỆN TẠI).
 *
 * F1 Tiến độ học thử lưu trên SERVER theo học viên × khoá × bài (`OnlFreeLessonProgress`). KHÔNG tạo quyền học giả: `OnlLessonProgress` gắn `entitlementId` nên không tái dùng được.
 * F2 `tuNhanKhoaMienPhi`: CHỈ khi (a) khoá được công bố cho đăng ký miễn phí (`settingsJson.hocThu.dangKyMienPhi` của BẢN ĐANG CHẠY), (b) khoá đang mở bán, (c) backend (A) xác nhận học viên đủ
 *    điều kiện (`duDieuKien`), (d) CHƯA TỪNG có quyền học khoá này (kể cả hết hạn/bị thu hồi — tự nhận không phải đường mở lại). Giá 0 KHÔNG đồng nghĩa được tự nhận.
 * F3 Giới hạn (`gioiHanSoBai`, `hanNgay`) cấu hình trong cài đặt khoá, KHÔNG hard-code; vắng ⇒ không giới hạn. Chỉ VIDEO/READ do Đào tạo bật `freePreview` (đã ở `ve-hoc-thu.ts`).
 * F4 `chuyenTienDoHocThu`: khi quyền học THẬT được tạo/mở lại ⇒ chuyển tiến độ học thử sang `OnlLessonProgress` (giữ phần tốt hơn, không ghi trùng, không tạo lượt thi/điểm), đánh dấu đã chuyển.
 *
 * Danh tính: `studentId` do A suy từ phiên đăng nhập (người học thật sự). Phụ huynh KHÔNG được ghi tiến độ/đáp án của học viên — việc chặn token phụ huynh là ở lớp HTTP của A.
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;
const NGAY = 86_400_000;

export type MaLoiHocThu = "CHUA_DANG_NHAP" | "KHONG_TIM_THAY" | "HOC_VIEN_KHONG_TON_TAI" | "DA_CO_QUYEN_HOC" | "VUOT_GIOI_HAN_BAI" | "HET_HAN_HOC_THU" | "CAI_DAT_KHONG_HOP_LE";
export type TienDoHocThu = { lessonStableId: string; status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"; percent: number; completedAt: Date | null; firstAccessAt: Date };
export type KetQuaMoBaiMienPhi =
  | { ok: true; bai: Extract<Awaited<ReturnType<typeof kiemTraTruyCapBaiMienPhi>>, { ok: true }>["bai"]; tienDo: TienDoHocThu }
  | { ok: false; ma: MaLoiHocThu };

async function daCoQuyenDangHieuLuc(db: Db | Tx, studentId: string, courseId: string, now: Date): Promise<boolean> {
  const q = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId, courseId } }, select: { status: true, expiresAt: true } });
  return !!q && q.status === "ACTIVE" && (q.expiresAt === null || q.expiresAt.getTime() > now.getTime());
}

const ra = (r: { status: string; percent: number; completedAt: Date | null; firstAccessAt: Date; lessonStableId: string }): TienDoHocThu => ({
  lessonStableId: r.lessonStableId,
  status: r.status as TienDoHocThu["status"],
  percent: r.percent,
  completedAt: r.completedAt,
  firstAccessAt: r.firstAccessAt,
});

/**
 * MỞ một bài miễn phí: kiểm bài (VIDEO/READ, `freePreview`, khoá đang bán) → kiểm GIỚI HẠN (F3) → ghi dấu lần đầu học (dòng tiến độ `IN_PROGRESS`).
 * Có quyền học đang hiệu lực ⇒ `DA_CO_QUYEN_HOC` (A chuyển sang API học có phí; không ghi tiến độ học thử trùng).
 */
export async function moBaiMienPhi(db: Db, input: { studentId: string; courseId: string; lessonStableId: string; now: Date }): Promise<KetQuaMoBaiMienPhi> {
  if (!input.studentId) return { ok: false, ma: "CHUA_DANG_NHAP" };
  const bai = await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: input.studentId, courseId: input.courseId, lessonStableId: input.lessonStableId, now: input.now });
  if (!bai.ok) return { ok: false, ma: bai.ma };
  if (await daCoQuyenDangHieuLuc(db, input.studentId, input.courseId, input.now)) return { ok: false, ma: "DA_CO_QUYEN_HOC" };
  const cs = await docChinhSachHocThu(db, input.courseId);
  if (!cs) return { ok: false, ma: "CAI_DAT_KHONG_HOP_LE" };
  const hs = await db.student.findUnique({ where: { id: input.studentId }, select: { id: true } });
  if (!hs) return { ok: false, ma: "HOC_VIEN_KHONG_TON_TAI" };

  return db.$transaction(async (tx) => {
    // Khoá theo (học viên × khoá): hai lượt mở song song không vượt giới hạn bài.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`onl-free:${input.studentId}:${input.courseId}`}, 0))`;
    const dong = await tx.onlFreeLessonProgress.findMany({ where: { studentId: input.studentId, courseId: input.courseId }, select: { lessonStableId: true, status: true, percent: true, completedAt: true, firstAccessAt: true } });
    const hien = dong.find((d) => d.lessonStableId === input.lessonStableId);
    const dauTien = dong.length ? new Date(Math.min(...dong.map((d) => d.firstAccessAt.getTime()))) : null;
    if (cs.chinhSach.hanNgay !== null && dauTien && input.now.getTime() >= dauTien.getTime() + cs.chinhSach.hanNgay * NGAY) return { ok: false as const, ma: "HET_HAN_HOC_THU" as const };
    if (hien) return { ok: true as const, bai: bai.bai, tienDo: ra({ ...hien, lessonStableId: hien.lessonStableId }) };
    if (cs.chinhSach.gioiHanSoBai !== null && dong.length >= cs.chinhSach.gioiHanSoBai) return { ok: false as const, ma: "VUOT_GIOI_HAN_BAI" as const };
    const moi = await tx.onlFreeLessonProgress.create({ data: { studentId: input.studentId, courseId: input.courseId, lessonStableId: input.lessonStableId, status: "IN_PROGRESS", percent: 0, firstAccessAt: input.now } });
    return { ok: true as const, bai: bai.bai, tienDo: ra(moi) };
  });
}

export type KetQuaGhiTienDoHocThu = { ok: true; tienDo: TienDoHocThu } | { ok: false; ma: MaLoiHocThu | "CHUA_MO_BAI" | "PHAN_TRAM_KHONG_HOP_LE" };

/**
 * Ghi tiến độ bài miễn phí ĐÃ MỞ (`moBaiMienPhi`). ĐƠN ĐIỆU: phần trăm không bao giờ giảm, `COMPLETED` không bao giờ lùi, `completedAt` đặt MỘT lần.
 * VIDEO xong khi `percent` ≥ `tinhDaXemPhanTramVideo` của bản đang chạy; READ xong khi `hoanThanh = true`. Hạn học thử được kiểm LẠI ở đây.
 */
export async function ghiTienDoHocThu(db: Db, input: { studentId: string; courseId: string; lessonStableId: string; percent: number; hoanThanh?: boolean; now: Date }): Promise<KetQuaGhiTienDoHocThu> {
  if (!input.studentId) return { ok: false, ma: "CHUA_DANG_NHAP" };
  if (!Number.isInteger(input.percent) || input.percent < 0 || input.percent > 100) return { ok: false, ma: "PHAN_TRAM_KHONG_HOP_LE" };
  const bai = await kiemTraTruyCapBaiMienPhi(db, { taiKhoanId: input.studentId, courseId: input.courseId, lessonStableId: input.lessonStableId, now: input.now });
  if (!bai.ok) return { ok: false, ma: bai.ma };
  if (await daCoQuyenDangHieuLuc(db, input.studentId, input.courseId, input.now)) return { ok: false, ma: "DA_CO_QUYEN_HOC" };
  const cs = await docChinhSachHocThu(db, input.courseId);
  if (!cs) return { ok: false, ma: "CAI_DAT_KHONG_HOP_LE" };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`onl-free:${input.studentId}:${input.courseId}`}, 0))`;
    const dong = await tx.onlFreeLessonProgress.findMany({ where: { studentId: input.studentId, courseId: input.courseId } });
    const hien = dong.find((d) => d.lessonStableId === input.lessonStableId);
    if (!hien) return { ok: false as const, ma: "CHUA_MO_BAI" as const };
    const dauTien = new Date(Math.min(...dong.map((d) => d.firstAccessAt.getTime())));
    if (cs.chinhSach.hanNgay !== null && input.now.getTime() >= dauTien.getTime() + cs.chinhSach.hanNgay * NGAY) return { ok: false as const, ma: "HET_HAN_HOC_THU" as const };
    const percent = Math.max(hien.percent, input.percent);
    const xong = hien.status === "COMPLETED" || input.hoanThanh === true || (bai.bai.kind === "VIDEO" && percent >= cs.tinhDaXemPhanTramVideo);
    const moi = await tx.onlFreeLessonProgress.update({
      where: { id: hien.id },
      data: { percent: xong && bai.bai.kind === "READ" ? 100 : percent, status: xong ? "COMPLETED" : "IN_PROGRESS", completedAt: hien.completedAt ?? (xong ? input.now : null) },
    });
    return { ok: true as const, tienDo: ra(moi) };
  });
}

/** Danh sách tiến độ học thử của học viên trong một khoá (chỉ của CHÍNH học viên đó — `studentId` do lớp HTTP suy từ phiên). */
export async function docTienDoHocThu(db: Db, input: { studentId: string; courseId: string }): Promise<TienDoHocThu[]> {
  if (!input.studentId) return [];
  const dong = await db.onlFreeLessonProgress.findMany({ where: { studentId: input.studentId, courseId: input.courseId }, orderBy: { firstAccessAt: "asc" } });
  return dong.map(ra);
}

/**
 * C11 — điều kiện tự nhận khoá miễn phí (Owner 25/11/2026): (1) học viên có phụ huynh đã XÁC MINH SĐT (`User.phoneVerifiedAt`); (2) số khoá `FREE_GRANT` ĐANG HOẠT ĐỘNG (ACTIVE, chưa hết hạn)
 * của CÙNG phụ huynh (= cùng SĐT, mọi con tính chung) chưa đạt `toiDa` (cấu hình `hocThu.toiDaKhoaMienPhi`; null = không giới hạn). Hết hạn/thu hồi nhả chỗ; khoá MUA tiền không tính.
 * Giới hạn đã biết: kiểm trước khi cấp, không khoá chéo — hai lần nhận song song của cùng phụ huynh trên hai khoá khác nhau có thể cùng lọt qua; N là chặn lạm dụng, không phải ràng buộc toàn vẹn.
 */
async function kiemDieuKienMienPhi(db: Db, input: { studentId: string; toiDa: number | null; now: Date }): Promise<{ ok: true } | { ok: false; ma: "CHUA_XAC_MINH_SDT" | "VUOT_SO_KHOA_MIEN_PHI" }> {
  const hv = await db.student.findUnique({ where: { id: input.studentId }, select: { parentUserId: true, parentUser: { select: { phoneVerifiedAt: true } } } });
  if (!hv?.parentUserId || !hv.parentUser?.phoneVerifiedAt) return { ok: false, ma: "CHUA_XAC_MINH_SDT" };
  if (input.toiDa !== null) {
    const dangDung = await db.onlEntitlement.count({
      where: { source: "FREE_GRANT", status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }], student: { parentUserId: hv.parentUserId } },
    });
    if (dangDung >= input.toiDa) return { ok: false, ma: "VUOT_SO_KHOA_MIEN_PHI" };
  }
  return { ok: true };
}

export type KetQuaTuNhan = { ok: true; ketQua: Extract<KetQuaCapDb, { ok: true }> } | { ok: false; ma: "CHUA_DANG_NHAP" | "KHONG_TIM_THAY" | "KHONG_DANG_KY_MIEN_PHI" | "KHONG_DU_DIEU_KIEN" | "CHUA_XAC_MINH_SDT" | "VUOT_SO_KHOA_MIEN_PHI" | "DA_TUNG_CO_QUYEN" | "CAI_DAT_KHONG_HOP_LE" | "HOC_VIEN_KHONG_TON_TAI" | "KHOA_IDEMPOTENCY_KHONG_HOP_LE" };

/**
 * F2 — học viên TỰ NHẬN khoá miễn phí (`FREE_GRANT`). Chỉ khi chính sách khoá cho phép + backend xác nhận đủ điều kiện (`duDieuKien`, do A tính) + chưa từng có quyền.
 * Cấp qua `capQuyenHoc` (cùng luật/khoá/idempotency/sổ sự kiện như mọi đường cấp) ⇒ F4 tự chạy.
 */
export async function tuNhanKhoaMienPhi(db: Db, input: { studentId: string; courseId: string; duDieuKien: boolean; idempotencyKey: string; now: Date }): Promise<KetQuaTuNhan> {
  if (!input.studentId) return { ok: false, ma: "CHUA_DANG_NHAP" };
  const k = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null, publishedVersionId: { not: null } }, select: { saleStatus: true, saleOpensAt: true } });
  if (!k || !banDuocLucNay(k.saleStatus, k.saleOpensAt, input.now)) return { ok: false, ma: "KHONG_TIM_THAY" };
  const cs = await docChinhSachHocThu(db, input.courseId);
  if (!cs) return { ok: false, ma: "CAI_DAT_KHONG_HOP_LE" };
  if (!cs.chinhSach.dangKyMienPhi) return { ok: false, ma: "KHONG_DANG_KY_MIEN_PHI" };
  if (input.duDieuKien !== true) return { ok: false, ma: "KHONG_DU_DIEU_KIEN" };
  // Lặp lại cùng khoá idempotency là lời gọi LẠI hợp lệ (trả kết quả cũ) — nên chỉ chặn khi quyền đã có từ một khoá KHÁC.
  const daCo = await db.onlEntitlement.findUnique({ where: { studentId_courseId: { studentId: input.studentId, courseId: input.courseId } }, select: { id: true } });
  if (daCo) {
    const lai = await db.onlEntitlementEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey }, select: { entitlementId: true } });
    if (lai?.entitlementId !== daCo.id) return { ok: false, ma: "DA_TUNG_CO_QUYEN" };
  } else {
    // C11 — điều kiện do E TỰ ép (không chỉ tin cờ của A): SĐT phụ huynh đã xác minh + chưa quá N khoá miễn phí đang hoạt động. Lần gọi LẠI hợp lệ (đã có quyền cùng khoá) bỏ qua để không tự chặn chính mình.
    const dk = await kiemDieuKienMienPhi(db, { studentId: input.studentId, toiDa: cs.chinhSach.toiDaKhoaMienPhi, now: input.now });
    if (!dk.ok) return dk;
  }
  const r = await capQuyenHoc(db, { studentId: input.studentId, courseId: input.courseId, loai: "CAP_MIEN_PHI", idempotencyKey: input.idempotencyKey, now: input.now, reason: "Học viên tự nhận khoá miễn phí (chính sách khoá, backend xác nhận đủ điều kiện)", actorUserId: null });
  if (!r.ok) return { ok: false, ma: r.ma === "HOC_VIEN_KHONG_TON_TAI" ? "HOC_VIEN_KHONG_TON_TAI" : r.ma === "KHOA_IDEMPOTENCY_KHONG_HOP_LE" ? "KHOA_IDEMPOTENCY_KHONG_HOP_LE" : "KHONG_TIM_THAY" };
  return { ok: true, ketQua: r };
}
