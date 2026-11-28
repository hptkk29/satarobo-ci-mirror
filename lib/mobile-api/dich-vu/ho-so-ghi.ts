import { z } from "zod";

import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { hasMediaConsent, setMediaConsent } from "@/lib/lms/media-consent";
import { canonicalPhone } from "@/lib/phone";

import type { MaHocVienDaKiem } from "../so-huu";
import { LoiApiMobile, type NguoiGoi } from "../xac-thuc/dich-vu";

/**
 * V8.4 — GHI hồ sơ phụ huynh từ app (G2): sửa địa chỉ + phụ huynh thứ hai · đồng ý hình ảnh · người được phép đón con. Mọi ghi đều có AUDIT.
 *
 * ⛔ KHÔNG cho sửa: TÊN phụ huynh (chưa được duyệt trên app), EMAIL/SĐT ĐĂNG NHẬP (đổi SĐT phải qua OTP — chưa có nhà cung cấp OTP ⇒ không có đường tắt), mật khẩu (đã có `/parent/password`).
 * Tái dùng ĐÚNG phép ghi của web: `User.address` + `Student.parent2Name/parent2Phone` (mọi con của hộ) như `updateParentProfile` của cổng phụ huynh; đồng ý ảnh qua `setMediaConsent` (cùng audit của web).
 */
const sach = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

// ───────────────────────── Sửa hồ sơ ─────────────────────────
export const suaHoSoSchema = z
  .object({
    diaChi: z.string().trim().max(255, "Địa chỉ tối đa 255 ký tự.").nullable().optional(),
    phuHuynh2: z
      .object({
        ten: z.string().trim().max(120, "Tên tối đa 120 ký tự.").nullable().optional(),
        sdt: z.string().trim().max(20, "Số điện thoại không hợp lệ.").nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.diaChi !== undefined || (v.phuHuynh2 !== undefined && (v.phuHuynh2.ten !== undefined || v.phuHuynh2.sdt !== undefined)), { message: "Chưa có thông tin nào để cập nhật." });
export type SuaHoSoBody = z.infer<typeof suaHoSoSchema>;

export type KetQuaSuaHoSoDto = { diaChi: string | null; phuHuynh2: { ten: string | null; sdt: string | null }; capNhatLuc: string };

export async function suaHoSo(nguoi: NguoiGoi, body: SuaHoSoBody, now: Date = new Date()): Promise<KetQuaSuaHoSoDto> {
  const u = await db.user.findUnique({ where: { id: nguoi.userId }, select: { address: true } });
  const con = await db.student.findMany({ where: { parentUserId: nguoi.userId, deletedAt: null }, select: { id: true, parent2Name: true, parent2Phone: true, centerId: true } });
  const cu = { diaChi: u?.address ?? null, ten2: con[0]?.parent2Name ?? null, sdt2: con[0]?.parent2Phone ?? null };

  const diaChi = body.diaChi === undefined ? undefined : sach(body.diaChi) || null;
  const ten2 = body.phuHuynh2?.ten === undefined ? undefined : sach(body.phuHuynh2.ten) || null;
  let sdt2: string | null | undefined;
  if (body.phuHuynh2?.sdt !== undefined) {
    const t = sach(body.phuHuynh2.sdt);
    if (!t) sdt2 = null;
    else {
      const c = canonicalPhone(t);
      if (!c) throw new LoiApiMobile("VALIDATION", 400, "Số điện thoại phụ huynh thứ hai chưa đúng.");
      sdt2 = c;
    }
  }

  await db.$transaction(async (tx) => {
    if (diaChi !== undefined) await tx.user.update({ where: { id: nguoi.userId }, data: { address: diaChi } });
    if ((ten2 !== undefined || sdt2 !== undefined) && con.length > 0) {
      await tx.student.updateMany({ where: { parentUserId: nguoi.userId, deletedAt: null }, data: { ...(ten2 !== undefined ? { parent2Name: ten2 } : {}), ...(sdt2 !== undefined ? { parent2Phone: sdt2 } : {}) } });
    }
    const doi: string[] = [];
    if (diaChi !== undefined && diaChi !== cu.diaChi) doi.push("diaChi");
    if (ten2 !== undefined && ten2 !== cu.ten2) doi.push("phuHuynh2.ten");
    if (sdt2 !== undefined && sdt2 !== cu.sdt2) doi.push("phuHuynh2.sdt");
    if (doi.length > 0) {
      // Audit CHỈ ghi TÊN trường đã đổi (không ghi giá trị địa chỉ/SĐT — PII).
      await writeAudit({ actor: { id: nguoi.userId, name: "Phụ huynh (app)" }, module: "parent_profile", entityType: "User", entityId: nguoi.userId, action: "PROFILE_UPDATED_MOBILE", changedFields: doi, orgUnitId: con[0]?.centerId ?? null, tx });
    }
  });
  const sau = await db.user.findUnique({ where: { id: nguoi.userId }, select: { address: true } });
  const c0 = await db.student.findFirst({ where: { parentUserId: nguoi.userId, deletedAt: null }, select: { parent2Name: true, parent2Phone: true } });
  return { diaChi: sau?.address ?? null, phuHuynh2: { ten: c0?.parent2Name ?? null, sdt: c0?.parent2Phone ?? null }, capNhatLuc: now.toISOString() };
}

// ───────────────────────── Đồng ý hình ảnh ─────────────────────────
export const dongYAnhSchema = z.object({ dongY: z.boolean() }).strict();
export type DongYAnhBody = z.infer<typeof dongYAnhSchema>;
export type DongYAnhDto = { trangThai: "DA_DONG_Y" | "DA_THU_HOI" | "CHUA_CO"; lichSu: Array<{ luc: string; hanhDong: "DONG_Y" | "THU_HOI"; nguon: string }> };

export async function layDongYAnh(hs: MaHocVienDaKiem): Promise<DongYAnhDto> {
  const c = await db.studentConsent.findUnique({ where: { studentId_type: { studentId: hs, type: "CLASS_MEDIA" } }, select: { status: true } });
  const log = await db.auditLog.findMany({ where: { entityType: "StudentConsent", entityId: hs, action: { in: ["CONSENT_GRANTED", "CONSENT_REVOKED", "CONSENT_GRANTED_AT_CONVERT"] } }, orderBy: { createdAt: "desc" }, take: 50, select: { action: true, createdAt: true, newValues: true } });
  return {
    trangThai: !c ? "CHUA_CO" : c.status === "GRANTED" ? "DA_DONG_Y" : "DA_THU_HOI",
    lichSu: log.map((l) => ({ luc: l.createdAt.toISOString(), hanhDong: l.action === "CONSENT_REVOKED" ? ("THU_HOI" as const) : ("DONG_Y" as const), nguon: String((l.newValues as { source?: string } | null)?.source ?? "KHAC") })),
  };
}

/** Đổi đồng ý ảnh của MỘT con (cùng hàm + audit của web). Không đổi trạng thái ⇒ không ghi gì (không audit trùng). */
export async function datDongYAnh(hs: MaHocVienDaKiem, nguoi: NguoiGoi, body: DongYAnhBody): Promise<DongYAnhDto> {
  if (nguoi.hocSinhId) throw new LoiApiMobile("FORBIDDEN", 403, "Đang ở chế độ học sinh."); // phòng thủ; allow-list đã chặn
  const hienTai = await hasMediaConsent(hs);
  if (hienTai !== body.dongY) await setMediaConsent(hs, body.dongY, { actor: { id: nguoi.userId, name: "Phụ huynh (app)" }, source: "MOBILE_APP" });
  return layDongYAnh(hs);
}

// ───────────────────────── Người được phép đón con ─────────────────────────
export const QUAN_HE_DON = ["Ông", "Bà", "Bác", "Cô", "Chú", "Dì", "Cậu", "Anh/Chị", "Người giúp việc", "Khác"] as const;
export const TOI_DA_NGUOI_DON = 5;
const hoTen = z.string().trim().min(2, "Họ tên quá ngắn.").max(80, "Họ tên tối đa 80 ký tự.");
const ghiChu = z.string().trim().max(200, "Ghi chú tối đa 200 ký tự.");
export const themNguoiDonSchema = z.object({ hoTen, quanHe: z.enum(QUAN_HE_DON), soDienThoai: z.string().trim().min(8, "Số điện thoại chưa đúng.").max(20, "Số điện thoại chưa đúng."), ghiChu: ghiChu.optional() }).strict();
export const suaNguoiDonSchema = z
  .object({ hoTen: hoTen.optional(), quanHe: z.enum(QUAN_HE_DON).optional(), soDienThoai: z.string().trim().min(8).max(20).optional(), ghiChu: ghiChu.nullable().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Chưa có thông tin nào để cập nhật." });
export type ThemNguoiDonBody = z.infer<typeof themNguoiDonSchema>;
export type SuaNguoiDonBody = z.infer<typeof suaNguoiDonSchema>;

export type NguoiDonDto = { id: string; hoTen: string; quanHe: string; soDienThoai: string; ghiChu: string | null; themLuc: string };
const CHON = { id: true, hoTen: true, quanHe: true, soDienThoai: true, ghiChu: true, createdAt: true } as const;
const dto = (r: { id: string; hoTen: string; quanHe: string; soDienThoai: string; ghiChu: string | null; createdAt: Date }): NguoiDonDto => ({ id: r.id, hoTen: r.hoTen, quanHe: r.quanHe, soDienThoai: r.soDienThoai, ghiChu: r.ghiChu, themLuc: r.createdAt.toISOString() });
const khongThay = () => new LoiApiMobile("NOT_FOUND", 404, "Không tìm thấy dữ liệu.");

export async function layNguoiDon(hs: MaHocVienDaKiem): Promise<{ muc: NguoiDonDto[]; toiDa: number }> {
  const rows = await db.studentPickupContact.findMany({ where: { studentId: hs, trangThai: "ACTIVE" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: CHON });
  return { muc: rows.map(dto), toiDa: TOI_DA_NGUOI_DON };
}

async function khoaNguoiDon(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], hs: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pickup:${hs}`}, 0))`;
}
const sdtChuan = (raw: string): string => {
  const c = canonicalPhone(raw);
  if (!c) throw new LoiApiMobile("VALIDATION", 400, "Số điện thoại chưa đúng.");
  return c;
};
const auditDon = (nguoi: NguoiGoi, hs: string, id: string, action: string, changed: string[], tx: Parameters<typeof writeAudit>[0]["tx"]) =>
  // Audit KHÔNG ghi tên/SĐT người đón (PII) — chỉ id + tên trường đổi.
  writeAudit({ actor: { id: nguoi.userId, name: "Phụ huynh (app)" }, module: "student", entityType: "StudentPickupContact", entityId: id, action, changedFields: changed, newValues: { studentId: hs }, tx });

export async function themNguoiDon(hs: MaHocVienDaKiem, nguoi: NguoiGoi, body: ThemNguoiDonBody): Promise<NguoiDonDto> {
  const sdt = sdtChuan(body.soDienThoai);
  return db.$transaction(async (tx) => {
    await khoaNguoiDon(tx, hs);
    const song = await tx.studentPickupContact.findMany({ where: { studentId: hs, trangThai: "ACTIVE" }, select: { soDienThoai: true } });
    if (song.length >= TOI_DA_NGUOI_DON) throw new LoiApiMobile("VALIDATION", 422, `Mỗi bé tối đa ${TOI_DA_NGUOI_DON} người đón. Hãy gỡ bớt trước khi thêm.`);
    if (song.some((s) => s.soDienThoai === sdt)) throw new LoiApiMobile("VALIDATION", 409, "Số điện thoại này đã có trong danh sách người đón.", undefined, "NGUOI_DON_TRUNG_SDT");
    const r = await tx.studentPickupContact.create({ data: { studentId: hs, hoTen: sach(body.hoTen), quanHe: body.quanHe, soDienThoai: sdt, ghiChu: body.ghiChu ? sach(body.ghiChu) : null, taoBoiUserId: nguoi.userId }, select: CHON });
    await auditDon(nguoi, hs, r.id, "PICKUP_CONTACT_ADDED", ["hoTen", "quanHe", "soDienThoai"], tx);
    return dto(r);
  });
}

export async function suaNguoiDon(hs: MaHocVienDaKiem, nguoi: NguoiGoi, id: unknown, body: SuaNguoiDonBody): Promise<NguoiDonDto> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) throw khongThay();
  return db.$transaction(async (tx) => {
    await khoaNguoiDon(tx, hs);
    const cu = await tx.studentPickupContact.findFirst({ where: { id, studentId: hs, trangThai: "ACTIVE" }, select: CHON });
    if (!cu) throw khongThay(); // của bé khác / đã gỡ / không có ⇒ cùng 404
    const sdt = body.soDienThoai === undefined ? undefined : sdtChuan(body.soDienThoai);
    if (sdt !== undefined && sdt !== cu.soDienThoai) {
      const trung = await tx.studentPickupContact.findFirst({ where: { studentId: hs, trangThai: "ACTIVE", soDienThoai: sdt, id: { not: id } }, select: { id: true } });
      if (trung) throw new LoiApiMobile("VALIDATION", 409, "Số điện thoại này đã có trong danh sách người đón.", undefined, "NGUOI_DON_TRUNG_SDT");
    }
    const data = { ...(body.hoTen !== undefined ? { hoTen: sach(body.hoTen) } : {}), ...(body.quanHe !== undefined ? { quanHe: body.quanHe } : {}), ...(sdt !== undefined ? { soDienThoai: sdt } : {}), ...(body.ghiChu !== undefined ? { ghiChu: body.ghiChu ? sach(body.ghiChu) : null } : {}) };
    const r = await tx.studentPickupContact.update({ where: { id }, data, select: CHON });
    await auditDon(nguoi, hs, id, "PICKUP_CONTACT_UPDATED", Object.keys(data), tx);
    return dto(r);
  });
}

/** Gỡ quyền đón = THU HỒI (giữ dòng để truy vết, không xoá). Gỡ lần hai / dòng của bé khác ⇒ 404. */
export async function goNguoiDon(hs: MaHocVienDaKiem, nguoi: NguoiGoi, id: unknown, now: Date = new Date()): Promise<{ trangThai: "DA_GO" }> {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) throw khongThay();
  await db.$transaction(async (tx) => {
    await khoaNguoiDon(tx, hs);
    const r = await tx.studentPickupContact.updateMany({ where: { id, studentId: hs, trangThai: "ACTIVE" }, data: { trangThai: "REVOKED", thuHoiLuc: now, thuHoiBoiUserId: nguoi.userId } });
    if (r.count !== 1) throw khongThay();
    await auditDon(nguoi, hs, id, "PICKUP_CONTACT_REVOKED", ["trangThai"], tx);
  });
  return { trangThai: "DA_GO" };
}
