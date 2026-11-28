import type { Prisma, PrismaClient } from "@prisma/client";
import { boCucMacDinh, boCucSchema, khoaPhoi, kiemPhoi, kiemTruocKhiDuyet, sha256Hex, snapshotChoBanCu, type CanhBao, type CnSnapshot } from "./cn-mau";
import { dungPdfChungNhan } from "./cn-pdf";
import { chuanHoaMaChungNhan, hienThiMaChungNhan } from "./ma-chung-nhan";
import type { KhoTaiSan } from "./cn-tai-san";

/**
 * E-LEARNING ONLINE — phôi chứng nhận của khoá (Postgres). Bảng `OnlCertificateTemplate` BẤT BIẾN (trigger): sửa bố cục = tạo PHIÊN BẢN MỚI;
 * chứng nhận đã cấp giữ bản chụp + khoá ngoại tới đúng phiên bản đã dùng. Quyền ở tầng action (`onl:course:manage` soạn phôi, `onl:certificate:issue` tải PDF).
 */
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type MaLoiMau = "KHOA_KHONG_TON_TAI" | "PHOI_KHONG_HOP_LE" | "BO_CUC_KHONG_HOP_LE" | "MAU_KHONG_TON_TAI" | "DA_DUYET" | "KHONG_DUYET_DUOC" | "KHO_LOI";
export type FailMau = { ok: false; ma: MaLoiMau; thongBao: string };
const fail = (ma: MaLoiMau, thongBao: string): FailMau => ({ ok: false, ma, thongBao });

const CHON_MAU = { id: true, courseId: true, version: true, status: true, backgroundKey: true, backgroundSha256: true, backgroundMime: true, widthPx: true, heightPx: true, fieldsJson: true, createdAt: true, approvedAt: true } as const;

async function soBanTiepTheo(tx: Db | Tx, courseId: string) {
  const m = await tx.onlCertificateTemplate.aggregate({ where: { courseId }, _max: { version: true } });
  return (m._max.version ?? 0) + 1;
}

/** Tải phôi MỚI (ảnh) cho khoá ⇒ phiên bản NHÁP với bố cục mặc định (hoặc bố cục truyền vào). Ảnh ghi vào kho MỘT LẦN theo mã băm. */
export async function taiPhoiLen(db: Db, kho: KhoTaiSan, input: { courseId: string; bytes: Uint8Array; fields?: unknown; actorUserId: string | null }): Promise<{ ok: true; id: string; version: number; canhBao: CanhBao[] } | FailMau> {
  const khoa = await db.onlCourse.findFirst({ where: { id: input.courseId, deletedAt: null }, select: { id: true } });
  if (!khoa) return fail("KHOA_KHONG_TON_TAI", "Khoá không tồn tại");
  const kp = kiemPhoi(input.bytes);
  if (!kp.ok) return fail("PHOI_KHONG_HOP_LE", kp.thongBao);
  const bc = boCucSchema.safeParse(input.fields ?? boCucMacDinh());
  if (!bc.success) return fail("BO_CUC_KHONG_HOP_LE", bc.error.issues[0]?.message ?? "Bố cục không hợp lệ");
  const sha = sha256Hex(input.bytes);
  const key = khoaPhoi(input.courseId, sha, kp.anh.ext);
  try {
    await kho.ghiMotLan(key, input.bytes, kp.anh.mime);
  } catch {
    return fail("KHO_LOI", "Không ghi được phôi vào kho");
  }
  for (let lan = 0; lan < 3; lan++) {
    try {
      const m = await db.onlCertificateTemplate.create({
        data: { courseId: input.courseId, version: await soBanTiepTheo(db, input.courseId), status: "DRAFT", backgroundKey: key, backgroundSha256: sha, backgroundMime: kp.anh.mime, widthPx: kp.anh.width, heightPx: kp.anh.height, fieldsJson: bc.data as unknown as Prisma.InputJsonValue, createdByUserId: input.actorUserId },
        select: { id: true, version: true },
      });
      return { ok: true, id: m.id, version: m.version, canhBao: kiemTruocKhiDuyet({ fields: bc.data, anh: { widthPx: kp.anh.width, heightPx: kp.anh.height } }) };
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // hai người tải cùng lúc va số phiên bản ⇒ thử số kế tiếp
    }
  }
  return fail("KHO_LOI", "Không cấp được số phiên bản — thử lại");
}

/** Đổi BỐ CỤC = tạo phiên bản NHÁP mới dùng lại CHÍNH ảnh của bản gốc (nội dung mẫu cũ không bao giờ bị sửa). */
export async function taoBanMoiTuBan(db: Db, input: { templateId: string; fields: unknown; actorUserId: string | null }): Promise<{ ok: true; id: string; version: number; canhBao: CanhBao[] } | FailMau> {
  const g = await db.onlCertificateTemplate.findUnique({ where: { id: input.templateId }, select: CHON_MAU });
  if (!g) return fail("MAU_KHONG_TON_TAI", "Mẫu không tồn tại");
  const bc = boCucSchema.safeParse(input.fields);
  if (!bc.success) return fail("BO_CUC_KHONG_HOP_LE", bc.error.issues[0]?.message ?? "Bố cục không hợp lệ");
  for (let lan = 0; lan < 3; lan++) {
    try {
      const m = await db.onlCertificateTemplate.create({
        data: { courseId: g.courseId, version: await soBanTiepTheo(db, g.courseId), status: "DRAFT", backgroundKey: g.backgroundKey, backgroundSha256: g.backgroundSha256, backgroundMime: g.backgroundMime, widthPx: g.widthPx, heightPx: g.heightPx, fieldsJson: bc.data as unknown as Prisma.InputJsonValue, createdByUserId: input.actorUserId },
        select: { id: true, version: true },
      });
      return { ok: true, id: m.id, version: m.version, canhBao: kiemTruocKhiDuyet({ fields: bc.data, anh: { widthPx: g.widthPx, heightPx: g.heightPx } }) };
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  return fail("KHO_LOI", "Không cấp được số phiên bản — thử lại");
}

/** Duyệt một bản NHÁP: bản đang áp dụng (nếu có) thành SUPERSEDED trong CÙNG giao dịch. Còn lỗi tràn khung ở các mẫu thử ⇒ từ chối. Chứng nhận ĐÃ CẤP không đổi. */
export async function duyetMau(db: Db, input: { templateId: string; actorUserId: string }): Promise<{ ok: true; thayThe: string | null } | FailMau> {
  return db.$transaction(async (tx): Promise<{ ok: true; thayThe: string | null } | FailMau> => {
    const m = await tx.onlCertificateTemplate.findUnique({ where: { id: input.templateId }, select: CHON_MAU });
    if (!m) return fail("MAU_KHONG_TON_TAI", "Mẫu không tồn tại");
    await tx.$queryRaw`SELECT "id" FROM "OnlCourse" WHERE "id" = ${m.courseId} FOR UPDATE`;
    const cu = await tx.onlCertificateTemplate.findUnique({ where: { id: m.id }, select: { status: true } });
    if (cu?.status !== "DRAFT") return fail(cu?.status === "APPROVED" ? "DA_DUYET" : "KHONG_DUYET_DUOC", cu?.status === "APPROVED" ? "Mẫu này đang áp dụng" : "Chỉ duyệt được bản nháp");
    const loi = kiemTruocKhiDuyet({ fields: boCucSchema.parse(m.fieldsJson), anh: { widthPx: m.widthPx, heightPx: m.heightPx } }).filter((c) => c.muc === "LOI");
    if (loi.length > 0) return fail("KHONG_DUYET_DUOC", loi[0]!.thongBao);
    const dang = await tx.onlCertificateTemplate.findFirst({ where: { courseId: m.courseId, status: "APPROVED" }, select: { id: true } });
    if (dang) await tx.onlCertificateTemplate.update({ where: { id: dang.id }, data: { status: "SUPERSEDED" } });
    await tx.onlCertificateTemplate.update({ where: { id: m.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByUserId: input.actorUserId } });
    return { ok: true, thayThe: dang?.id ?? null };
  });
}

export const docCacBanMau = (db: Db, courseId: string) => db.onlCertificateTemplate.findMany({ where: { courseId }, orderBy: { version: "desc" }, select: { ...CHON_MAU, _count: { select: { certificates: true } } } });

// ───────── Dựng PDF của MỘT chứng nhận ─────────

/** `snapshot` + `nenSha256` = ĐẦU VÀO dựng (kiểm bất biến chính xác; byte PDF của react-pdf KHÔNG ổn định giữa các lần dựng vì thứ tự đánh số đối tượng chạy đua). */
export type KetQuaPdf = { ok: true; pdf: Uint8Array; code: string; daThuHoi: boolean; tenTep: string; snapshot: CnSnapshot; nenSha256: string | null } | { ok: false; ma: "KHONG_TON_TAI" | "PHOI_MAT" | "PHOI_KHONG_KHOP"; thongBao: string };

/** Dựng lại chứng nhận THEO BẢN CHỤP lúc cấp (không theo mẫu hiện hành). Chứng nhận cấp trước V10.0 ⇒ khuôn mặc định từ các cột đã lưu. Quyền xem kiểm ở tầng gọi. */
export async function dungPdfTheoMa(db: Db, kho: KhoTaiSan, ma: string): Promise<KetQuaPdf> {
  const c = await db.onlCertificate.findUnique({ where: { code: chuanHoaMaChungNhan(ma) }, select: { code: true, status: true, studentName: true, courseName: true, finalScore: true, issuedAt: true, renderSnapshotJson: true } });
  if (!c) return { ok: false, ma: "KHONG_TON_TAI", thongBao: "Không tìm thấy chứng nhận" };
  const snap = (c.renderSnapshotJson as CnSnapshot | null) ?? snapshotChoBanCu({ hoTen: c.studentName, tenKhoa: c.courseName, finalScore: c.finalScore, capLuc: c.issuedAt, code: c.code });
  let nen: Uint8Array | null = null;
  if (snap.background) {
    nen = await kho.doc(snap.background.key);
    if (!nen) return { ok: false, ma: "PHOI_MAT", thongBao: "Không đọc được phôi của chứng nhận này" };
    if (sha256Hex(nen) !== snap.background.sha256) return { ok: false, ma: "PHOI_KHONG_KHOP", thongBao: "Phôi trong kho không khớp bản đã cấp" };
  }
  const pdf = await dungPdfChungNhan(snap, nen, { daThuHoi: c.status === "REVOKED", ngayTao: c.issuedAt });
  return { ok: true, pdf, code: c.code, daThuHoi: c.status === "REVOKED", tenTep: `chung-nhan-${hienThiMaChungNhan(c.code)}.pdf`, snapshot: snap, nenSha256: nen ? sha256Hex(nen) : null };
}

/** Xem thử bằng một mẫu NHÁP và dữ liệu mẫu (QoCNXem) — không ghi gì. */
export async function dungPdfXemThu(db: Db, kho: KhoTaiSan, templateId: string, mau: { hoTen: string; tenKhoa: string; finalScore: number | null }): Promise<{ ok: true; pdf: Uint8Array } | FailMau> {
  const m = await db.onlCertificateTemplate.findUnique({ where: { id: templateId }, select: CHON_MAU });
  if (!m) return fail("MAU_KHONG_TON_TAI", "Mẫu không tồn tại");
  const nen = await kho.doc(m.backgroundKey);
  if (!nen) return fail("KHO_LOI", "Không đọc được phôi");
  const { taoSnapshot, MA_THU } = await import("./cn-mau");
  const snap = taoSnapshot({ mau: m, du: { ...mau, capLuc: new Date(), code: MA_THU } });
  return { ok: true, pdf: await dungPdfChungNhan(snap, nen, { ngayTao: new Date(Date.UTC(2026, 10, 21)) }) };
}
