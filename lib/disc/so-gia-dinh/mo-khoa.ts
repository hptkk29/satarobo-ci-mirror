import "server-only";
/**
 * V8.31 — PHIÊN MỞ KHOÁ DISC Ở MÁY CHỦ (PIN thật sự bảo vệ dữ liệu). MỘT nơi duy nhất quyết định:
 *   · ĐẶT PIN lần đầu (chỉ cần đăng nhập + chủ sổ; CAS ⇒ hai lượt đồng thời không đè nhau);
 *   · ĐỔI PIN (bắt buộc `pinCu` HOẶC `matKhau`; PIN đang khoá ⇒ CHỈ `matKhau`);
 *   · MỞ KHOÁ (PIN hoặc mật khẩu) ⇒ tạo `DiscUnlockSession` gắn ĐÚNG phiên đăng nhập; KHOÁ LẠI; CHẾ ĐỘ TRẺ EM (hạ quyền phiên xuống «chỉ làm bài của một thành viên»);
 *   · KIỂM QUYỀN `kiemQuyen(ctx, yêu cầu)` — guard TẬP TRUNG mà mọi route Mobile / server action Web / trang Web đi qua.
 * Hiệu lực phiên được TÍNH khi kiểm (không dựa móc thu hồi): chủ sổ · `tokenVersion` hiện tại ≡ lúc mở · `pinPhienBan` hiện tại ≡ lúc mở · idle · tuyệt đối · đồng hồ MÁY CHỦ.
 * ĐẾM LẦN SAI NGUYÊN TỬ: tiêu một lượt bằng MỘT câu UPDATE có điều kiện TRƯỚC khi so (song song N lần đoán ⇒ chỉ ≤ 5 lượt được so, phần còn lại bị chặn mà không tốn so sánh).
 * Cờ `DISC_PIN_ENFORCE_ENABLED` TẮT ⇒ `kiemQuyen` cho qua và KHÔNG chạm bảng mới; BẬT ⇒ lỗi DB / thiếu bảng ⇒ TỪ CHỐI (fail-closed). Quy tắc đặt/đổi PIN KHÔNG phụ thuộc cờ.
 * Không bao giờ ghi/ log PIN, mật khẩu, băm, token. Sổ KHÔNG nhận id từ client: luôn tìm theo `ownerUserId = userId` của phiên.
 */
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

import { Prisma } from "@prisma/client";

import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { isDiscPinEnforceEnabled } from "@/lib/flags";

import { bamPin, dangKhoaPin, kiemPin, PHUT_KHOA_PIN, SO_LAN_SAI_TOI_DA } from "./pin";

export type KenhMoKhoa = "MOBILE" | "WEB";
export type PhamViDisc = "DOC" | "GHI" | "LAM_BAI";
export const PHAM_VI_DAY_DU: readonly PhamViDisc[] = ["DOC", "GHI", "LAM_BAI"];

/** Ngữ cảnh gọi — CHỈ chứa thứ máy chủ tự xác thực được. KHÔNG có trường nào do client khai là «đã mở khoá». */
export type BoiCanhDisc = {
  readonly userId: string;
  readonly kenh: KenhMoKhoa;
  /** MOBILE: `MobileSession.id` của phiên đã qua `xacThucAccess`. */
  readonly phienDangNhapId: string | null;
  /** WEB: token THÔ đọc từ cookie HttpOnly (chỉ để băm tra cứu). */
  readonly tokenWeb: string | null;
  /** Phiên đang ở chế độ học sinh ⇒ không bao giờ được mở/dùng khoá DISC. */
  readonly hocSinhId: string | null;
  /** MOBILE: phiên bản app client khai lúc đăng nhập — CHỈ cho cổng tương thích `DISC_PIN_MIN_APP_VERSION` (không phải bằng chứng bảo mật). WEB: không dùng. */
  readonly phienBanApp?: string | null;
  readonly requestId?: string | null;
};

export type MaLoiMoKhoa =
  | "DISC_CHUA_MO_KHOA"
  | "DISC_PHIEN_HET_HAN"
  | "DISC_PHIEN_THU_HOI"
  | "DISC_KHONG_DU_QUYEN"
  | "CAN_PIN_CU_HOAC_MAT_KHAU"
  | "DISC_PIN_XUNG_DOT"
  | "MAT_KHAU_SAI"
  | "MAT_KHAU_BI_KHOA"
  | "DISC_LOI_HE_THONG"
  | "DISC_CAN_CAP_NHAT_APP"
  | "PIN_SAI"
  | "PIN_BI_KHOA"
  | "CHUA_DAT_PIN"
  | "KHONG_CO_SO"
  | "DU_LIEU_KHONG_HOP_LE"
  | "KHONG_TIM_THAY";
export type LoiMoKhoa = { readonly ok: false; readonly loi: MaLoiMoKhoa; readonly thongBao: string };
export type OkMoKhoa<T> = { readonly ok: true } & T;
export type KetQuaMoKhoa<T> = OkMoKhoa<T> | LoiMoKhoa;

const loi = (ma: MaLoiMoKhoa, thongBao: string): LoiMoKhoa => ({ ok: false, loi: ma, thongBao });
const TEN_AUDIT = "Phụ huynh (sổ DISC)";

const idlePhut = () => Number(process.env.DISC_UNLOCK_IDLE_PHUT ?? 15);
const tuyetDoiPhut = () => Number(process.env.DISC_UNLOCK_TUYET_DOI_PHUT ?? 60);
/**
 * NGƯỠNG KHOÁ (D3 — máy chủ quyết định; MẶC ĐỊNH KỸ THUẬT, CHƯA phải chính sách Owner duyệt): 5 lần sai ⇒ khoá 15 phút (PIN và mật khẩu mỗi loại một bộ đếm).
 * Cấu hình bằng env, kẹp trong khoảng an toàn (ngoài khoảng/không phải số ⇒ dùng mặc định, không bao giờ nới quá khoảng):
 * `DISC_PIN_SAI_TOI_DA` (3–10, mặc định 5) · `DISC_PIN_KHOA_PHUT` (1–1440, mặc định 15) · `DISC_MAT_KHAU_KHOA_PHUT` (1–1440, mặc định 15).
 */
function soTrongKhoang(v: string | undefined, mac: number, lo: number, hi: number): number {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isInteger(n) && n >= lo && n <= hi ? n : mac;
}
export const nguongSaiToiDa = () => soTrongKhoang(process.env.DISC_PIN_SAI_TOI_DA, SO_LAN_SAI_TOI_DA, 3, 10);
export const phutKhoaPin = () => soTrongKhoang(process.env.DISC_PIN_KHOA_PHUT, PHUT_KHOA_PIN, 1, 1440);
export const phutKhoaMatKhau = () => soTrongKhoang(process.env.DISC_MAT_KHAU_KHOA_PHUT, 15, 1, 1440);

/** `a.b.c` → số; segment không phải số ⇒ 0 (coi như cũ). */
function tachPhienBan(v: string): number[] {
  return v.split(/[.+-]/).slice(0, 3).map((x) => (/^\d{1,6}$/.test(x) ? Number(x) : 0));
}
/** `a` có NHỎ HƠN `b` không (so từng đoạn số). */
export function phienBanNhoHon(a: string, b: string): boolean {
  const x = tachPhienBan(a), y = tachPhienBan(b);
  for (let i = 0; i < 3; i++) {
    const p = x[i] ?? 0, q = y[i] ?? 0;
    if (p !== q) return p < q;
  }
  return false;
}
/** Cổng phiên bản tối thiểu cho sổ có PIN: chưa đặt `DISC_PIN_MIN_APP_VERSION` ⇒ KHÔNG chặn; đặt rồi mà app không khai / khai thấp hơn ⇒ quá cũ. */
export function appQuaCu(phienBan: string | null, toiThieu: string | undefined = process.env.DISC_PIN_MIN_APP_VERSION): boolean {
  const t = (toiThieu ?? "").trim();
  if (!t) return false;
  if (!phienBan) return true;
  return phienBanNhoHon(phienBan, t);
}
const BUOC_CHAM_HOAT_DONG_MS = 30_000;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const pinSo = /^\d{4}$/;
const trong = (s: unknown) => typeof s !== "string" || s.length === 0;

/* ───────────────────────── audit (không lộ bí mật; chống làm đầy bảng) ───────────────────────── */

function ghiAudit(ctx: BoiCanhDisc, soId: string, action: string, newValues: Record<string, unknown>, tx?: Prisma.TransactionClient) {
  return writeAudit({
    actor: { id: ctx.userId, name: TEN_AUDIT },
    module: "disc",
    entityType: "DiscGiaDinh",
    entityId: soId,
    action,
    newValues: { kenh: ctx.kenh, phien: ctx.phienDangNhapId ? ctx.phienDangNhapId.slice(0, 8) : null, ...(ctx.requestId ? { requestId: ctx.requestId } : {}), ...newValues },
    tx,
  });
}

/** Ghi audit THẤT BẠI có giới hạn: tối đa MỘT mục cho mỗi (sổ, hành động) trong 60 giây — kẻ đoán PIN không làm đầy bảng. Lỗi audit KHÔNG bao giờ biến thành cho qua. */
async function ghiAuditThatBaiCoGioiHan(ctx: BoiCanhDisc, soId: string, action: string, newValues: Record<string, unknown>, now: Date): Promise<void> {
  try {
    const gan = await db.auditLog.count({ where: { module: "disc", entityId: soId, action, createdAt: { gte: new Date(now.getTime() - 60_000) } } });
    if (gan === 0) await ghiAudit(ctx, soId, action, newValues);
  } catch {
    /* ghi audit thất bại không đổi quyết định TỪ CHỐI */
  }
}

/* ───────────────────────── đếm lần sai NGUYÊN TỬ ───────────────────────── */

type TieuLan = { duocSo: boolean; vuaKhoa: boolean };

/** Tiêu MỘT lượt thử PIN. `duocSo=false` ⇒ đang khoá (không so sánh). `vuaKhoa=true` ⇒ lượt này chạm ngưỡng (vẫn được so: đúng thì mở + gỡ khoá, sai thì báo khoá). */
async function tieuLanPin(soId: string, now: Date): Promise<TieuLan> {
  const khoaDen = new Date(now.getTime() + phutKhoaPin() * 60_000);
  const toiDa = nguongSaiToiDa();
  const hang = await db.$queryRaw<Array<{ pinSai: number; pinKhoaDen: Date | null }>>(Prisma.sql`
    UPDATE "DiscGiaDinh" SET
      "pinSai" = CASE WHEN "pinSai" + 1 >= ${toiDa} THEN 0 ELSE "pinSai" + 1 END,
      "pinKhoaDen" = CASE WHEN "pinSai" + 1 >= ${toiDa} THEN ${khoaDen} ELSE "pinKhoaDen" END
    WHERE "id" = ${soId} AND ("pinKhoaDen" IS NULL OR "pinKhoaDen" <= ${now})
    RETURNING "pinSai", "pinKhoaDen"`);
  if (hang.length === 0) return { duocSo: false, vuaKhoa: false };
  const k = hang[0]!.pinKhoaDen;
  return { duocSo: true, vuaKhoa: k !== null && k.getTime() > now.getTime() };
}

async function tieuLanMatKhau(soId: string, now: Date): Promise<TieuLan> {
  const khoaDen = new Date(now.getTime() + phutKhoaMatKhau() * 60_000);
  const toiDa = nguongSaiToiDa();
  const hang = await db.$queryRaw<Array<{ matKhauSai: number; matKhauKhoaDen: Date | null }>>(Prisma.sql`
    UPDATE "DiscGiaDinh" SET
      "matKhauSai" = CASE WHEN "matKhauSai" + 1 >= ${toiDa} THEN 0 ELSE "matKhauSai" + 1 END,
      "matKhauKhoaDen" = CASE WHEN "matKhauSai" + 1 >= ${toiDa} THEN ${khoaDen} ELSE "matKhauKhoaDen" END
    WHERE "id" = ${soId} AND ("matKhauKhoaDen" IS NULL OR "matKhauKhoaDen" <= ${now})
    RETURNING "matKhauSai", "matKhauKhoaDen"`);
  if (hang.length === 0) return { duocSo: false, vuaKhoa: false };
  const k = hang[0]!.matKhauKhoaDen;
  return { duocSo: true, vuaKhoa: k !== null && k.getTime() > now.getTime() };
}

/* ───────────────────────── đọc sổ / người dùng ───────────────────────── */

type SoPin = { id: string; pinHash: string | null; pinPhienBan: number; pinKhoaDen: Date | null };
const laySoPin = (userId: string): Promise<SoPin | null> =>
  db.discGiaDinh.findUnique({ where: { ownerUserId: userId }, select: { id: true, pinHash: true, pinPhienBan: true, pinKhoaDen: true } });

type NguoiDung = { password: string | null; tokenVersion: number };
async function layNguoiDungHopLe(userId: string): Promise<NguoiDung | null> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { password: true, tokenVersion: true, isActive: true, deletedAt: true } });
  if (!u || !u.isActive || u.deletedAt) return null;
  return { password: u.password, tokenVersion: u.tokenVersion };
}

/** Phiên mở khoá hiện tại của NGỮ CẢNH (MOBILE: theo phiên đăng nhập; WEB: theo băm token). Chỉ hàng chưa thu hồi. */
async function timPhien(ctx: BoiCanhDisc, giaDinhId: string) {
  if (ctx.kenh === "MOBILE") {
    if (!ctx.phienDangNhapId) return null;
    return db.discUnlockSession.findFirst({ where: { giaDinhId, kenh: "MOBILE", phienDangNhapId: ctx.phienDangNhapId, thuHoiLuc: null }, orderBy: { taoLuc: "desc" } });
  }
  if (!ctx.tokenWeb) return null;
  return db.discUnlockSession.findFirst({ where: { giaDinhId, kenh: "WEB", tokenHash: sha256(ctx.tokenWeb), thuHoiLuc: null } });
}

async function thuHoiTatCa(giaDinhId: string, ly: string, now: Date, tx?: Prisma.TransactionClient): Promise<number> {
  const c = tx ?? db;
  const r = await c.discUnlockSession.updateMany({ where: { giaDinhId, thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: ly } });
  return r.count;
}

/* ───────────────────────── 1. KIỂM QUYỀN (guard tập trung) ───────────────────────── */

export type YeuCauQuyen = { readonly phamVi: PhamViDisc; readonly thanhVienId?: string };
export type PhienDaKiem = { readonly canMoKhoa: boolean; readonly giaDinhId: string | null; readonly phamVi: readonly PhamViDisc[]; readonly thanhVienGioiHan: string | null };

type PhienHang = NonNullable<Awaited<ReturnType<typeof timPhien>>>;
type DanhGiaPhien = { ok: true; phien: PhienHang } | { ok: false; loi: LoiMoKhoa };

/** Hiệu lực của phiên mở khoá, TÍNH theo đồng hồ máy chủ + trạng thái hiện tại (không dựa móc thu hồi). Lỗi DB ném lên cho người gọi (fail-closed ở đó). */
async function danhGiaPhien(ctx: BoiCanhDisc, so: SoPin, now: Date): Promise<DanhGiaPhien> {
  const phien = await timPhien(ctx, so.id);
  if (!phien) return { ok: false, loi: loi("DISC_CHUA_MO_KHOA", "Cần nhập mã PIN để mở sổ DISC.") };
  const u = await layNguoiDungHopLe(ctx.userId);
  if (!u) return { ok: false, loi: loi("DISC_PHIEN_THU_HOI", "Phiên mở khoá không còn hiệu lực.") };
  const hetTuyetDoi = phien.hetHanTuyetDoi.getTime() <= now.getTime();
  const hetIdle = now.getTime() - phien.hoatDongLuc.getTime() >= idlePhut() * 60_000;
  if (hetTuyetDoi || hetIdle) {
    await db.discUnlockSession.updateMany({ where: { id: phien.id, thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: hetTuyetDoi ? "het-han-tuyet-doi" : "het-han-idle" } });
    return { ok: false, loi: loi("DISC_PHIEN_HET_HAN", "Phiên mở khoá đã hết hạn. Nhập lại mã PIN.") };
  }
  if (phien.userId !== ctx.userId || phien.giaDinhId !== so.id || phien.phienBanPin !== so.pinPhienBan || phien.tokenVersionLucMo !== u.tokenVersion) {
    await db.discUnlockSession.updateMany({ where: { id: phien.id, thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: "doi-pin-hoac-mat-khau" } });
    return { ok: false, loi: loi("DISC_PHIEN_THU_HOI", "Phiên mở khoá đã bị thu hồi. Nhập lại mã PIN.") };
  }
  return { ok: true, phien };
}

/**
 * Quyết định truy cập DISC. Cờ TẮT ⇒ cho qua (không chạm bảng mới). Cờ BẬT: người dùng ở chế độ học sinh ⇒ TỪ CHỐI; chưa có sổ / sổ chưa đặt PIN ⇒ cho qua (không có gì để mở khoá; tầng
 * domain tự trả 404 «chưa có sổ»); PIN đang khoá ⇒ TỪ CHỐI mọi phiên; ngược lại cần phiên mở khoá còn hiệu lực + đủ phạm vi. Mọi lỗi ⇒ TỪ CHỐI.
 */
export async function kiemQuyen(ctx: BoiCanhDisc, yc: YeuCauQuyen, now: Date = new Date()): Promise<KetQuaMoKhoa<PhienDaKiem>> {
  if (!isDiscPinEnforceEnabled()) return { ok: true, canMoKhoa: false, giaDinhId: null, phamVi: PHAM_VI_DAY_DU, thanhVienGioiHan: null };
  try {
    const so = await laySoPin(ctx.userId);
    if (!so || !so.pinHash) return { ok: true, canMoKhoa: false, giaDinhId: so?.id ?? null, phamVi: PHAM_VI_DAY_DU, thanhVienGioiHan: null };
    // Sổ ĐÃ có PIN: phiên chế độ học sinh KHÔNG bao giờ mở/dùng được khoá DISC (không thể nhập PIN, không thừa hưởng phiên của ba mẹ).
    if (ctx.hocSinhId) return loi("DISC_KHONG_DU_QUYEN", "Chế độ học sinh không truy cập được sổ DISC của ba mẹ.");
    if (dangKhoaPin({ pinSai: 0, khoaDen: so.pinKhoaDen }, now)) return loi("PIN_BI_KHOA", "Mã PIN đang bị khoá. Dùng mật khẩu để mở khoá.");
    // TƯƠNG THÍCH (D4): sổ ĐÃ có PIN mà app quá cũ (chưa có màn mở khoá) ⇒ lỗi RÕ «cần cập nhật» thay vì «chưa mở khoá» mà app không hiểu. Chỉ Mobile; chỉ khi đặt `DISC_PIN_MIN_APP_VERSION`.
    if (ctx.kenh === "MOBILE" && appQuaCu(ctx.phienBanApp ?? null)) return loi("DISC_CAN_CAP_NHAT_APP", "Cần cập nhật ứng dụng SataRobo để mở sổ DISC đã đặt mã PIN.");
    const dg = await danhGiaPhien(ctx, so, now);
    if (!dg.ok) return dg.loi;
    const phien = dg.phien;
    if (!phien.scopes.includes(yc.phamVi)) return loi("DISC_KHONG_DU_QUYEN", "Chế độ này không cho phép thao tác này. Nhập mã PIN để mở đầy đủ.");
    if (phien.thanhVienGioiHan && yc.thanhVienId !== phien.thanhVienGioiHan) return loi("DISC_KHONG_DU_QUYEN", "Chế độ này chỉ làm bài của một thành viên. Nhập mã PIN để mở đầy đủ.");
    // Chạm hoạt động (idle) — bước thô để không ghi mỗi lần gọi.
    await db.discUnlockSession.updateMany({ where: { id: phien.id, thuHoiLuc: null, hoatDongLuc: { lt: new Date(now.getTime() - BUOC_CHAM_HOAT_DONG_MS) } }, data: { hoatDongLuc: now } });
    return { ok: true, canMoKhoa: true, giaDinhId: so.id, phamVi: phien.scopes as PhamViDisc[], thanhVienGioiHan: phien.thanhVienGioiHan };
  } catch {
    return loi("DISC_LOI_HE_THONG", "Hệ thống bảo vệ sổ DISC đang gặp sự cố. Vui lòng thử lại sau.");
  }
}

/* ───────────────────────── 2. TRẠNG THÁI TỐI THIỂU ───────────────────────── */

export type TrangThaiPinDto = {
  coSo: boolean;
  coPin: boolean;
  /** Máy chủ có ÉP mở khoá không (cờ). Tắt ⇒ PIN chỉ còn là khoá giao diện + quy tắc đặt/đổi. */
  epMayChu: boolean;
  /** Phiên hiện tại đã mở khoá và còn hiệu lực. Không có PIN ⇒ `true`. */
  daMoKhoa: boolean;
  cheDo: "DAY_DU" | "TRE_EM" | null;
  khoaDenLuc: string | null;
  hetHanTuyetDoiLuc: string | null;
  idleGiay: number;
};

export async function docTrangThaiPin(ctx: BoiCanhDisc, now: Date = new Date()): Promise<KetQuaMoKhoa<{ trangThai: TrangThaiPinDto }>> {
  const epMayChu = isDiscPinEnforceEnabled();
  const mau = { epMayChu, idleGiay: idlePhut() * 60 };
  const rong = { khoaDenLuc: null, hetHanTuyetDoiLuc: null, cheDo: null } as const;
  try {
    const so = await laySoPin(ctx.userId);
    if (!so) return { ok: true, trangThai: { coSo: false, coPin: false, daMoKhoa: true, ...rong, ...mau } };
    if (!so.pinHash) return { ok: true, trangThai: { coSo: true, coPin: false, daMoKhoa: true, ...rong, ...mau } };
    const khoa = dangKhoaPin({ pinSai: 0, khoaDen: so.pinKhoaDen }, now) ? so.pinKhoaDen!.toISOString() : null;
    if (!epMayChu || ctx.hocSinhId || khoa) return { ok: true, trangThai: { coSo: true, coPin: true, daMoKhoa: false, ...rong, khoaDenLuc: khoa, ...mau } };
    const dg = await danhGiaPhien(ctx, so, now);
    if (!dg.ok) return { ok: true, trangThai: { coSo: true, coPin: true, daMoKhoa: false, ...rong, ...mau } };
    return {
      ok: true,
      trangThai: { coSo: true, coPin: true, daMoKhoa: true, cheDo: dg.phien.scopes.includes("DOC") ? "DAY_DU" : "TRE_EM", khoaDenLuc: null, hetHanTuyetDoiLuc: dg.phien.hetHanTuyetDoi.toISOString(), ...mau },
    };
  } catch {
    return loi("DISC_LOI_HE_THONG", "Không đọc được trạng thái PIN.");
  }
}

/* ───────────────────────── 3. ĐẶT / ĐỔI PIN ───────────────────────── */

export type DauVaoDatPin = { pin: string; pinCu?: string; matKhau?: string };

export function phanTichDatPin(raw: unknown): { ok: true; d: DauVaoDatPin } | { ok: false; thongBao: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, thongBao: "Thông tin chưa hợp lệ." };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!["pin", "pinCu", "matKhau"].includes(k)) return { ok: false, thongBao: "Thông tin chưa hợp lệ." }; // strict: khoá lạ (vd `daXacMinh`, `pinVerified`) ⇒ từ chối
  if (typeof o.pin !== "string" || !pinSo.test(o.pin)) return { ok: false, thongBao: "Mã PIN gồm đúng 4 chữ số." };
  if (o.pinCu !== undefined && (typeof o.pinCu !== "string" || !pinSo.test(o.pinCu))) return { ok: false, thongBao: "Mã PIN hiện tại gồm đúng 4 chữ số." };
  if (o.matKhau !== undefined && (typeof o.matKhau !== "string" || o.matKhau.length === 0 || o.matKhau.length > 200)) return { ok: false, thongBao: "Mật khẩu chưa hợp lệ." };
  if (o.pinCu !== undefined && o.matKhau !== undefined) return { ok: false, thongBao: "Chỉ gửi mã PIN hiện tại HOẶC mật khẩu." };
  return { ok: true, d: { pin: o.pin, ...(o.pinCu !== undefined ? { pinCu: o.pinCu as string } : {}), ...(o.matKhau !== undefined ? { matKhau: o.matKhau as string } : {}) } };
}

async function soSanhMatKhau(userId: string, matKhau: string): Promise<boolean> {
  const u = await layNguoiDungHopLe(userId);
  return !!u?.password && (await bcrypt.compare(matKhau, u.password));
}

export async function datHoacDoiPin(ctx: BoiCanhDisc, raw: unknown, now: Date = new Date()): Promise<KetQuaMoKhoa<{ hanhDong: "DAT" | "DOI"; goKhoa: boolean }>> {
  if (ctx.hocSinhId) return loi("DISC_KHONG_DU_QUYEN", "Chế độ học sinh không đặt/đổi được mã PIN.");
  const p = phanTichDatPin(raw);
  if (!p.ok) return loi("DU_LIEU_KHONG_HOP_LE", p.thongBao);
  const d = p.d;
  const so = await laySoPin(ctx.userId);
  if (!so) return loi("KHONG_CO_SO", "Chưa có sổ gia đình.");
  const bam = bamPin(d.pin);

  // ── Đặt lần đầu: không cần bằng chứng; CAS «pinHash IS NULL» ⇒ hai lượt đồng thời chỉ MỘT thắng ──
  if (!so.pinHash) {
    // (có gửi bằng chứng cho sổ chưa có PIN: bỏ qua — không có gì để chứng minh)
    const dat = await db.$transaction(async (tx) => {
      const r = await tx.discGiaDinh.updateMany({ where: { id: so.id, pinHash: null }, data: { pinHash: bam, pinPhienBan: { increment: 1 }, pinSai: 0, pinKhoaDen: null } });
      if (r.count !== 1) return false;
      await thuHoiTatCa(so.id, "dat-pin", now, tx);
      await ghiAudit(ctx, so.id, "disc.pin.dat", {}, tx);
      return true;
    });
    return dat ? { ok: true, hanhDong: "DAT", goKhoa: false } : loi("DISC_PIN_XUNG_DOT", "Mã PIN vừa được đặt ở nơi khác. Hãy tải lại.");
  }

  // ── Đổi: BẮT BUỘC bằng chứng ──
  const dangKhoa = dangKhoaPin({ pinSai: 0, khoaDen: so.pinKhoaDen }, now);
  if (trong(d.pinCu) && trong(d.matKhau)) {
    await ghiAuditThatBaiCoGioiHan(ctx, so.id, "disc.pin.doi-that-bai", { lyDo: "thieu-bang-chung" }, now);
    return loi("CAN_PIN_CU_HOAC_MAT_KHAU", "Cần mã PIN hiện tại hoặc mật khẩu tài khoản để đổi mã PIN.");
  }
  let cach: "PIN_CU" | "MAT_KHAU";
  if (!trong(d.pinCu)) {
    if (dangKhoa) return loi("PIN_BI_KHOA", "Mã PIN đang bị khoá. Dùng mật khẩu tài khoản để đặt lại.");
    const t = await tieuLanPin(so.id, now);
    if (!t.duocSo) return loi("PIN_BI_KHOA", "Nhập sai nhiều lần. Dùng mật khẩu tài khoản để đặt lại.");
    if (!kiemPin(d.pinCu!, so.pinHash)) {
      if (t.vuaKhoa) await khiVuaKhoaPin(ctx, so.id, now);
      else await ghiAuditThatBaiCoGioiHan(ctx, so.id, "disc.pin.unlock-failed", { nguon: "doi-pin" }, now);
      return t.vuaKhoa ? loi("PIN_BI_KHOA", "Nhập sai nhiều lần. Dùng mật khẩu tài khoản để đặt lại.") : loi("PIN_SAI", "Mã PIN hiện tại chưa đúng.");
    }
    cach = "PIN_CU";
  } else {
    const t = await tieuLanMatKhau(so.id, now);
    if (!t.duocSo) return loi("MAT_KHAU_BI_KHOA", "Nhập sai mật khẩu nhiều lần. Thử lại sau ít phút.");
    if (!(await soSanhMatKhau(ctx.userId, d.matKhau!))) {
      await ghiAuditThatBaiCoGioiHan(ctx, so.id, "disc.pin.unlock-failed", { nguon: "doi-pin-mat-khau" }, now);
      return t.vuaKhoa ? loi("MAT_KHAU_BI_KHOA", "Nhập sai mật khẩu nhiều lần. Thử lại sau ít phút.") : loi("MAT_KHAU_SAI", "Mật khẩu chưa đúng.");
    }
    cach = "MAT_KHAU";
  }

  // Đã chứng minh. CAS theo phiên bản + băm hiện hành: hai lượt đổi đồng thời ⇒ MỘT thắng; thua ⇒ XUNG_DOT (không ghi đè).
  const goKhoa = dangKhoa && cach === "MAT_KHAU";
  const ok = await db.$transaction(async (tx) => {
    const r = await tx.discGiaDinh.updateMany({
      where: { id: so.id, pinPhienBan: so.pinPhienBan, pinHash: so.pinHash },
      data: { pinHash: bam, pinPhienBan: { increment: 1 }, pinSai: 0, pinKhoaDen: null, ...(cach === "MAT_KHAU" ? { matKhauSai: 0, matKhauKhoaDen: null } : {}) },
    });
    if (r.count !== 1) return false;
    const thuHoi = await thuHoiTatCa(so.id, "doi-pin", now, tx);
    await ghiAudit(ctx, so.id, "disc.pin.doi", { cach }, tx);
    if (goKhoa) await ghiAudit(ctx, so.id, "disc.pin.go-khoa", { cach }, tx);
    if (thuHoi > 0) await ghiAudit(ctx, so.id, "disc.pin.session-revoked", { lyDo: "doi-pin", soPhien: thuHoi }, tx);
    return true;
  });
  return ok ? { ok: true, hanhDong: "DOI", goKhoa } : loi("DISC_PIN_XUNG_DOT", "Mã PIN vừa được đổi ở nơi khác. Hãy thử lại.");
}

async function khiVuaKhoaPin(ctx: BoiCanhDisc, soId: string, now: Date): Promise<void> {
  try {
    const n = await thuHoiTatCa(soId, "pin-khoa", now);
    await ghiAudit(ctx, soId, "disc.pin.khoa", {});
    if (n > 0) await ghiAudit(ctx, soId, "disc.pin.session-revoked", { lyDo: "pin-khoa", soPhien: n });
  } catch {
    /* khoá đã được ghi ở DB; lỗi audit không làm mở khoá */
  }
}

/* ───────────────────────── 4. MỞ KHOÁ / KHOÁ LẠI / CHẾ ĐỘ TRẺ EM ───────────────────────── */

export type DauVaoMoKhoa = { pin: string } | { matKhau: string };

export function phanTichMoKhoa(raw: unknown): { ok: true; d: DauVaoMoKhoa } | { ok: false; thongBao: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, thongBao: "Thông tin chưa hợp lệ." };
  const o = raw as Record<string, unknown>;
  const khoa = Object.keys(o);
  if (khoa.some((k) => k !== "pin" && k !== "matKhau") || khoa.length !== 1) return { ok: false, thongBao: "Chỉ gửi mã PIN HOẶC mật khẩu." };
  if (khoa[0] === "pin") return typeof o.pin === "string" && pinSo.test(o.pin) ? { ok: true, d: { pin: o.pin } } : { ok: false, thongBao: "Mã PIN gồm đúng 4 chữ số." };
  return typeof o.matKhau === "string" && o.matKhau.length > 0 && o.matKhau.length <= 200 ? { ok: true, d: { matKhau: o.matKhau } } : { ok: false, thongBao: "Mật khẩu chưa hợp lệ." };
}

export type KetQuaMoKhoaOk = { hetHanTuyetDoiLuc: string; idleGiay: number; cheDo: "DAY_DU"; tokenWebTho: string | null; cachXacMinh: "PIN" | "MAT_KHAU"; goKhoa: boolean };

export async function moKhoa(ctx: BoiCanhDisc, raw: unknown, now: Date = new Date()): Promise<KetQuaMoKhoa<KetQuaMoKhoaOk>> {
  if (ctx.hocSinhId) return loi("DISC_KHONG_DU_QUYEN", "Chế độ học sinh không mở được sổ DISC.");
  if (ctx.kenh === "MOBILE" && !ctx.phienDangNhapId) return loi("DISC_LOI_HE_THONG", "Thiếu định danh phiên đăng nhập.");
  const p = phanTichMoKhoa(raw);
  if (!p.ok) return loi("DU_LIEU_KHONG_HOP_LE", p.thongBao);
  const so = await laySoPin(ctx.userId);
  if (!so) return loi("KHONG_CO_SO", "Chưa có sổ gia đình.");
  if (!so.pinHash) return loi("CHUA_DAT_PIN", "Chưa đặt mã PIN.");
  const dangKhoa = dangKhoaPin({ pinSai: 0, khoaDen: so.pinKhoaDen }, now);

  let cach: "PIN" | "MAT_KHAU";
  if ("pin" in p.d) {
    if (dangKhoa) return loi("PIN_BI_KHOA", "Mã PIN đang bị khoá. Dùng mật khẩu để mở khoá.");
    const t = await tieuLanPin(so.id, now);
    if (!t.duocSo) return loi("PIN_BI_KHOA", "Nhập sai nhiều lần. Dùng mật khẩu để mở khoá.");
    if (!kiemPin(p.d.pin, so.pinHash)) {
      if (t.vuaKhoa) await khiVuaKhoaPin(ctx, so.id, now);
      else await ghiAuditThatBaiCoGioiHan(ctx, so.id, "disc.pin.unlock-failed", { nguon: "pin" }, now);
      return t.vuaKhoa ? loi("PIN_BI_KHOA", "Nhập sai nhiều lần. Dùng mật khẩu để mở khoá.") : loi("PIN_SAI", "Mã PIN chưa đúng.");
    }
    cach = "PIN";
  } else {
    const t = await tieuLanMatKhau(so.id, now);
    if (!t.duocSo) return loi("MAT_KHAU_BI_KHOA", "Nhập sai mật khẩu nhiều lần. Thử lại sau ít phút.");
    if (!(await soSanhMatKhau(ctx.userId, p.d.matKhau))) {
      await ghiAuditThatBaiCoGioiHan(ctx, so.id, "disc.pin.unlock-failed", { nguon: "mat-khau" }, now);
      return t.vuaKhoa ? loi("MAT_KHAU_BI_KHOA", "Nhập sai mật khẩu nhiều lần. Thử lại sau ít phút.") : loi("MAT_KHAU_SAI", "Mật khẩu chưa đúng.");
    }
    cach = "MAT_KHAU";
  }

  const u = await layNguoiDungHopLe(ctx.userId);
  if (!u) return loi("DISC_PHIEN_THU_HOI", "Tài khoản không còn hiệu lực.");
  const tokenWebTho = ctx.kenh === "WEB" ? randomBytes(32).toString("base64url") : null;
  const hetHan = new Date(now.getTime() + tuyetDoiPhut() * 60_000);
  // MỘT giao dịch: xác nhận phiên bản PIN còn nguyên + dọn bộ đếm + thay phiên cũ của CHÍNH phiên đăng nhập này + tạo phiên mới + audit. Audit hỏng ⇒ KHÔNG cấp phiên (fail-closed).
  const goKhoa = dangKhoa && cach === "MAT_KHAU";
  const ok = await db.$transaction(async (tx) => {
    const r = await tx.discGiaDinh.updateMany({
      where: { id: so.id, pinPhienBan: so.pinPhienBan },
      data: { pinSai: 0, pinKhoaDen: null, ...(cach === "MAT_KHAU" ? { matKhauSai: 0, matKhauKhoaDen: null } : {}) },
    });
    if (r.count !== 1) return false; // PIN vừa đổi giữa chừng
    if (ctx.kenh === "MOBILE") await tx.discUnlockSession.updateMany({ where: { giaDinhId: so.id, kenh: "MOBILE", phienDangNhapId: ctx.phienDangNhapId, thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: "thay-the" } });
    else if (ctx.tokenWeb) await tx.discUnlockSession.updateMany({ where: { giaDinhId: so.id, kenh: "WEB", tokenHash: sha256(ctx.tokenWeb), thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: "thay-the" } });
    await tx.discUnlockSession.create({
      data: {
        giaDinhId: so.id,
        userId: ctx.userId,
        kenh: ctx.kenh,
        phienDangNhapId: ctx.kenh === "MOBILE" ? ctx.phienDangNhapId : null,
        tokenHash: tokenWebTho ? sha256(tokenWebTho) : null,
        scopes: [...PHAM_VI_DAY_DU],
        phienBanPin: so.pinPhienBan,
        tokenVersionLucMo: u.tokenVersion,
        xacMinhBang: cach,
        xacMinhLuc: now,
        hoatDongLuc: now,
        hetHanTuyetDoi: hetHan,
      },
    });
    await ghiAudit(ctx, so.id, "disc.pin.unlock", { cach }, tx);
    if (goKhoa) await ghiAudit(ctx, so.id, "disc.pin.go-khoa", { cach }, tx);
    return true;
  });
  if (!ok) return loi("DISC_PIN_XUNG_DOT", "Mã PIN vừa thay đổi. Hãy thử lại.");
  return { ok: true, hetHanTuyetDoiLuc: hetHan.toISOString(), idleGiay: idlePhut() * 60, cheDo: "DAY_DU", tokenWebTho, cachXacMinh: cach, goKhoa };
}

/** KHOÁ LẠI: thu hồi phiên mở khoá của chính ngữ cảnh này (đăng nhập vẫn còn). */
export async function khoaLai(ctx: BoiCanhDisc, now: Date = new Date()): Promise<KetQuaMoKhoa<{ soPhien: number }>> {
  const so = await laySoPin(ctx.userId);
  if (!so) return { ok: true, soPhien: 0 };
  try {
    const phien = await timPhien(ctx, so.id);
    if (!phien) return { ok: true, soPhien: 0 };
    const r = await db.discUnlockSession.updateMany({ where: { id: phien.id, thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: "khoa-lai" } });
    if (r.count > 0) await ghiAudit(ctx, so.id, "disc.pin.session-revoked", { lyDo: "khoa-lai", soPhien: r.count });
    return { ok: true, soPhien: r.count };
  } catch {
    return loi("DISC_LOI_HE_THONG", "Không khoá lại được. Vui lòng thử lại.");
  }
}

/** Thu hồi MỌI phiên mở khoá của một người dùng (đăng xuất web, v.v.). Không cần ngữ cảnh. */
export async function thuHoiPhienDiscCuaNguoi(userId: string, ly: string, now: Date = new Date()): Promise<number> {
  const r = await db.discUnlockSession.updateMany({ where: { userId, thuHoiLuc: null }, data: { thuHoiLuc: now, lyDoThuHoi: ly } });
  return r.count;
}

/**
 * CHẾ ĐỘ TRẺ EM: hạ quyền phiên mở khoá xuống «chỉ làm bài của MỘT thành viên». Cần phiên ĐẦY ĐỦ còn hiệu lực. Thoát = `moKhoa` lại bằng PIN (phiên mới đầy đủ).
 * Cờ TẮT ⇒ không làm gì (trả không có hiệu lực) vì không có phiên nào để hạ.
 */
export async function vaoCheDoTreEm(ctx: BoiCanhDisc, thanhVienId: unknown, now: Date = new Date()): Promise<KetQuaMoKhoa<{ thanhVienId: string }>> {
  if (typeof thanhVienId !== "string" || thanhVienId.length === 0 || thanhVienId.length > 64) return loi("DU_LIEU_KHONG_HOP_LE", "Thông tin chưa hợp lệ.");
  if (!isDiscPinEnforceEnabled()) return loi("DISC_KHONG_DU_QUYEN", "Máy chủ chưa bật ép mã PIN.");
  const k = await kiemQuyen(ctx, { phamVi: "GHI" }, now);
  if (!k.ok) return k;
  if (!k.canMoKhoa || !k.giaDinhId) return loi("DISC_CHUA_MO_KHOA", "Cần đặt mã PIN trước khi vào chế độ trẻ em.");
  const tv = await db.discThanhVien.findFirst({ where: { id: thanhVienId, giaDinhId: k.giaDinhId, deletedAt: null }, select: { id: true } });
  if (!tv) return loi("KHONG_TIM_THAY", "Không tìm thấy thành viên.");
  const phien = await timPhien(ctx, k.giaDinhId);
  if (!phien) return loi("DISC_CHUA_MO_KHOA", "Cần nhập mã PIN để mở sổ DISC.");
  await db.$transaction(async (tx) => {
    await tx.discUnlockSession.update({ where: { id: phien.id }, data: { scopes: ["LAM_BAI"], thanhVienGioiHan: tv.id, hoatDongLuc: now } });
    await ghiAudit(ctx, k.giaDinhId!, "disc.pin.che-do-tre-em", { thanhVien: tv.id.slice(0, 8) }, tx);
  });
  return { ok: true, thanhVienId: tv.id };
}
