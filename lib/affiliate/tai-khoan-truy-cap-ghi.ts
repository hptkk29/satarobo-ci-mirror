/**
 * lib/affiliate/tai-khoan-truy-cap-ghi.ts — MỘT NƠI GHI quan hệ User ↔ AffiliateParty: `lienKetUser` · `goLienKet` · `tamNgungCong` · `moLaiCong` · `doiDaiDien` (AFF-L3a).
 * Luật ĐƯỢC / KHÔNG ĐƯỢC ở `tai-khoan-truy-cap-dau-vao.ts` (thuần); tệp này đọc DB rồi ghi.
 *
 * ── Khuôn (chép `ghi-doi-tac.ts` / `ghi-membership.ts`) ──────────────────────────────────────────────────────
 *  · Quyền (`affiliates:manage`) và cờ do NƠI GỌI kiểm ở Server Action. Hàm này không biết ai đang bấm ngoài `nguoi` để ghi nhật ký.
 *  · THỨ TỰ KHOÁ: hàng `Affiliate` (`FOR UPDATE`) TRƯỚC, rồi mới đọc/ghi các dòng `AffiliatePartyUser` của nó. Chính khoá này giữ luật «tối đa MỘT người đại diện chưa gỡ» (không có chỉ mục duy nhất
 *    từng phần — Prisma không mô hình hoá được): hai người cùng đặt đại diện cho một đối tác tuần tự, người sau thấy người trước.
 *  · KHOÁ LẠC QUAN theo `updatedAt` của DÒNG TRUY CẬP mà người bấm ĐÃ THẤY (khoá hàng → so `getTime()` trong JS, KHÔNG `updateMany({ where: { updatedAt } })` — micro- vs mili-giây).
 *    `updatedAtDaThay` BẮT BUỘC, không mặc định (luật 7).
 *  · MỌI cổng đứng TRƯỚC phép ghi đầu tiên; từ chối trong transaction là `throw LoiGhiAffiliate` (`return` KHÔNG rollback); nơi ngoài bắt và dịch ra `KetQuaTruyCap`.
 *  · `writeAudit` CÙNG transaction. Nhật ký chỉ ghi id tài khoản + vai + trạng thái + lý do — KHÔNG chép tên/SĐT/email.
 *  · KHÔNG BAO GIỜ xoá đối tác, lead, attribution hay sổ khi gỡ tài khoản: gỡ chỉ đổi trạng thái dòng truy cập (và cột legacy `Affiliate.userId`).
 *  · CỘT LEGACY `Affiliate.userId` được đồng bộ trong CÙNG transaction = người đại diện chưa gỡ (`userIdLegacy`), và CHỈ ghi khi giá trị thật sự đổi (ghi thừa làm `updatedAt` của đối tác nhích và
 *    bắt người đang sửa hồ sơ phải tải lại).
 */
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { MODULE_AUDIT_AFFILIATE, LoiGhiAffiliate, aud, laLoiTrungKhoa, type NguoiGhi } from "./chung";
import {
  doiDaiDienSchema,
  goSchema,
  kiemDoiDaiDien,
  kiemGoLienKet,
  kiemLienKet,
  kiemMoLaiCong,
  kiemTamNgung,
  lienKetSchema,
  moLaiSchema,
  tamNgungSchema,
  userIdLegacy,
  type DongTruyCapDeKiem,
  type KetQuaTruyCap,
  type TrangThaiTruyCap,
  type VaiTruyCap,
} from "./tai-khoan-truy-cap-dau-vao";

type Tx = Prisma.TransactionClient;

const ENTITY_AUDIT = "AffiliatePartyUser";

const khongTimThay = () => new LoiGhiAffiliate("Không tìm thấy liên kết tài khoản này.", "khongTimThay");
const vuaDoi = () => new LoiGhiAffiliate("Liên kết vừa được người khác thay đổi — hãy tải lại rồi thử lại.", "vuaDoi");

function loiTuZod(e: { issues: readonly { path: PropertyKey[]; message: string }[] }): { ok: false; loi: string; truong: string } {
  const i = e.issues[0];
  return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
}

function dich(e: unknown): { ok: false; loi: string; truong?: string } | null {
  if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
  return null;
}

/**
 * Khoá hàng đối tác — MỌI hàm ghi của tệp này bắt đầu từ đây.
 * NHẬN NUÔI dữ liệu cũ: nếu cột legacy `Affiliate.userId` trỏ tới một tài khoản mà CHƯA có dòng nối (gắn bằng SQL sau migration, chưa qua màn này) thì tạo dòng ĐẠI DIỆN đang hoạt động ngay đây.
 * Thiếu bước này, `dongBoCotCu` sau đó sẽ ghi `userId = null` (vì tập dòng nối không có ai) và âm thầm tước quyền vào cổng của người đó. Chạy trong transaction của thao tác nên gate sau đó `throw` thì rollback cả bước này.
 */
async function khoaDoiTac(tx: Tx, partyId: string, nguoi: NguoiGhi, now: Date): Promise<{ status: "DRAFT" | "PENDING" | "ACTIVE" | "SUSPENDED" | "ENDED"; userId: string | null; name: string }> {
  await tx.$queryRaw`SELECT "id" FROM "Affiliate" WHERE "id" = ${partyId} FOR UPDATE`;
  const d = await tx.affiliate.findUnique({ where: { id: partyId }, select: { status: true, userId: true, name: true } });
  if (!d) throw new LoiGhiAffiliate("Không tìm thấy đối tác này.", "partyId");
  if (d.userId) {
    const [co, user] = await Promise.all([
      tx.affiliatePartyUser.findUnique({ where: { partyId_userId: { partyId, userId: d.userId } }, select: { id: true } }),
      tx.user.findUnique({ where: { id: d.userId }, select: { id: true } }),
    ]);
    if (!co && user) {
      const moi = await tx.affiliatePartyUser.create({ data: { partyId, userId: d.userId, role: "REPRESENTATIVE", status: "ACTIVE", grantedAt: now }, select: { id: true } });
      await writeAudit({
        tx,
        actor: aud(nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: moi.id,
        action: "AFFILIATE_TRUY_CAP_NHAN_NUOI",
        newValues: { partyId, userId: d.userId, role: "REPRESENTATIVE", status: "ACTIVE" },
        reason: `Nhận nuôi liên kết cũ (cột Affiliate.userId) của đối tác «${d.name}» vào bảng truy cập`,
      });
    }
  }
  return d;
}

async function docDongCuaDoiTac(tx: Tx, partyId: string): Promise<(DongTruyCapDeKiem & { id: string })[]> {
  const r = await tx.affiliatePartyUser.findMany({ where: { partyId }, select: { id: true, userId: true, role: true, status: true } });
  return r.map((x) => ({ id: x.id, userId: x.userId, role: x.role, status: x.status }));
}

/** Đồng bộ cột legacy với tập dòng HIỆN TẠI (đọc lại sau phép ghi). Chỉ ghi khi khác. */
async function dongBoCotCu(tx: Tx, partyId: string, hienTai: string | null): Promise<void> {
  const dong = await docDongCuaDoiTac(tx, partyId);
  const can = userIdLegacy(dong);
  if (can !== hienTai) await tx.affiliate.update({ where: { id: partyId }, data: { userId: can } });
}

const daiDienChuaGo = (dong: readonly DongTruyCapDeKiem[]) => dong.find((d) => d.role === "REPRESENTATIVE" && d.status !== "REVOKED") ?? null;

// ── LIÊN KẾT ─────────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaLienKet = KetQuaTruyCap<{ id: string; viec: "TAO" | "MO_LAI" }>;

export async function lienKetUser(p: { nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaLienKet> {
  const kq = lienKetSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      const doiTac = await khoaDoiTac(tx, v.partyId, p.nguoi, p.now);
      const [user, dong] = await Promise.all([
        tx.user.findUnique({ where: { id: v.userId }, select: { isActive: true, deletedAt: true, accountStatus: true, role: true, roles: true } }),
        docDongCuaDoiTac(tx, v.partyId),
      ]);
      const hienCo = dong.find((d) => d.userId === v.userId) ?? null;
      const cong = kiemLienKet({ doiTac, user, hienCo: hienCo ? { role: hienCo.role, status: hienCo.status } : null, vai: v.vai, daiDienHienTai: daiDienChuaGo(dong) });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);

      let id: string;
      if (cong.viec === "MO_LAI") {
        const cu = hienCo!;
        const moi = await tx.affiliatePartyUser.update({
          where: { id: cu.id },
          data: { role: v.vai, status: "ACTIVE", statusReason: null, statusChangedAt: p.now, statusChangedById: p.nguoi.userId, revokedAt: null, grantedById: p.nguoi.userId, grantedAt: p.now },
          select: { id: true },
        });
        id = moi.id;
      } else {
        const moi = await tx.affiliatePartyUser.create({
          data: { partyId: v.partyId, userId: v.userId, role: v.vai, status: "ACTIVE", grantedById: p.nguoi.userId, grantedAt: p.now },
          select: { id: true },
        });
        id = moi.id;
      }
      await dongBoCotCu(tx, v.partyId, doiTac.userId);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: id,
        action: cong.viec === "MO_LAI" ? "AFFILIATE_TRUY_CAP_LIEN_KET_LAI" : "AFFILIATE_TRUY_CAP_LIEN_KET",
        oldValues: hienCo ? { status: hienCo.status, role: hienCo.role } : undefined,
        newValues: { partyId: v.partyId, userId: v.userId, role: v.vai, status: "ACTIVE" },
        reason: `Liên kết tài khoản với đối tác «${doiTac.name}» (${v.vai === "REPRESENTATIVE" ? "người đại diện" : "thành viên"})`,
      });
      return { id, viec: cong.viec };
    });
    return { ok: true, id: ra.id, viec: ra.viec };
  } catch (e) {
    // Đua liên kết cùng cặp: người sau nhận P2002 — cũng là «đã liên kết», không phải lỗi 500.
    if (laLoiTrungKhoa(e)) return { ok: false, loi: "Tài khoản này vừa được liên kết với đối tác này.", truong: "userId" };
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── Chung cho thao tác trên MỘT dòng ───────────────────────────────────────────────────────────────────────────

async function khoaDongTheoId(tx: Tx, id: string): Promise<{ partyId: string }> {
  const truoc = await tx.affiliatePartyUser.findUnique({ where: { id }, select: { partyId: true } });
  if (!truoc) throw khongTimThay();
  return truoc;
}

type DongDaKhoa = { id: string; partyId: string; userId: string; role: VaiTruyCap; status: TrangThaiTruyCap; updatedAt: Date };

/** Khoá đối tác → đọc dòng → so khoá lạc quan. `partyId` là bất biến của dòng nên đọc trước khoá không sai. */
async function moDong(tx: Tx, id: string, updatedAtDaThay: Date, nguoi: NguoiGhi, now: Date): Promise<{ dong: DongDaKhoa; doiTac: Awaited<ReturnType<typeof khoaDoiTac>> }> {
  const { partyId } = await khoaDongTheoId(tx, id);
  const doiTac = await khoaDoiTac(tx, partyId, nguoi, now);
  const dong = await tx.affiliatePartyUser.findUnique({ where: { id }, select: { id: true, partyId: true, userId: true, role: true, status: true, updatedAt: true } });
  if (!dong) throw khongTimThay();
  if (dong.updatedAt.getTime() !== updatedAtDaThay.getTime()) throw vuaDoi();
  return { dong, doiTac };
}

// ── GỠ LIÊN KẾT ───────────────────────────────────────────────────────────────────────────────────────────────

export type KetQuaGo = KetQuaTruyCap<{ capNhatLuc: string }>;

export async function goLienKet(p: { nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaGo> {
  const kq = goSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      const { dong, doiTac } = await moDong(tx, v.id, v.updatedAtDaThay, p.nguoi, p.now);
      const cong = kiemGoLienKet({ status: dong.status, lyDo: v.lyDo });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);
      const moi = await tx.affiliatePartyUser.update({
        where: { id: dong.id },
        data: { status: "REVOKED", statusReason: v.lyDo, statusChangedAt: p.now, statusChangedById: p.nguoi.userId, revokedAt: p.now },
        select: { updatedAt: true },
      });
      await dongBoCotCu(tx, dong.partyId, doiTac.userId);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: dong.id,
        action: "AFFILIATE_TRUY_CAP_GO",
        oldValues: { status: dong.status, role: dong.role },
        newValues: { partyId: dong.partyId, userId: dong.userId, status: "REVOKED" },
        reason: v.lyDo ?? "",
      });
      return moi.updatedAt;
    });
    return { ok: true, capNhatLuc: ra.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── TẠM NGỪNG / MỞ LẠI CỔNG ───────────────────────────────────────────────────────────────────────────────────

export async function tamNgungCong(p: { nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaGo> {
  const kq = tamNgungSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      const { dong, doiTac } = await moDong(tx, v.id, v.updatedAtDaThay, p.nguoi, p.now);
      if (doiTac.status === "ENDED") throw new LoiGhiAffiliate("Đối tác đã kết thúc.", "partyId");
      const cong = kiemTamNgung({ status: dong.status, lyDo: v.lyDo });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);
      const moi = await tx.affiliatePartyUser.update({
        where: { id: dong.id },
        data: { status: "SUSPENDED", statusReason: v.lyDo, statusChangedAt: p.now, statusChangedById: p.nguoi.userId },
        select: { updatedAt: true },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: dong.id,
        action: "AFFILIATE_TRUY_CAP_TAM_NGUNG",
        oldValues: { status: dong.status },
        newValues: { partyId: dong.partyId, userId: dong.userId, status: "SUSPENDED" },
        reason: v.lyDo ?? "",
      });
      return moi.updatedAt;
    });
    return { ok: true, capNhatLuc: ra.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

export async function moLaiCong(p: { nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaGo> {
  const kq = moLaiSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      const { dong, doiTac } = await moDong(tx, v.id, v.updatedAtDaThay, p.nguoi, p.now);
      if (doiTac.status === "ENDED") throw new LoiGhiAffiliate("Đối tác đã kết thúc.", "partyId");
      const user = await tx.user.findUnique({ where: { id: dong.userId }, select: { isActive: true, deletedAt: true, accountStatus: true, role: true, roles: true } });
      const cong = kiemMoLaiCong({ status: dong.status, user });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);
      const moi = await tx.affiliatePartyUser.update({
        where: { id: dong.id },
        data: { status: "ACTIVE", statusReason: null, statusChangedAt: p.now, statusChangedById: p.nguoi.userId },
        select: { updatedAt: true },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: dong.id,
        action: "AFFILIATE_TRUY_CAP_MO_LAI",
        oldValues: { status: dong.status },
        newValues: { partyId: dong.partyId, userId: dong.userId, status: "ACTIVE" },
        reason: v.lyDo ?? "Mở lại cổng đối tác",
      });
      return moi.updatedAt;
    });
    return { ok: true, capNhatLuc: ra.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}

// ── ĐỔI NGƯỜI ĐẠI DIỆN ────────────────────────────────────────────────────────────────────────────────────────

export async function doiDaiDien(p: { nguoi: NguoiGhi; vao: unknown; now: Date }): Promise<KetQuaGo> {
  const kq = doiDaiDienSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      const doiTac = await khoaDoiTac(tx, v.partyId, p.nguoi, p.now);
      if (doiTac.status === "ENDED") throw new LoiGhiAffiliate("Đối tác đã kết thúc.", "partyId");
      const dong = await tx.affiliatePartyUser.findMany({
        where: { partyId: v.partyId },
        select: { id: true, userId: true, role: true, status: true, updatedAt: true },
      });
      const moi = dong.find((d) => d.id === v.id) ?? null;
      if (moi && moi.updatedAt.getTime() !== v.updatedAtDaThay.getTime()) throw vuaDoi();
      const cu = daiDienChuaGo(dong);
      const cong = kiemDoiDaiDien({ moi: moi ? { userId: moi.userId, role: moi.role, status: moi.status } : null, hienTai: cu ? { userId: cu.userId, role: cu.role, status: cu.status } : null });
      if (!cong.ok) throw new LoiGhiAffiliate(cong.loi, cong.truong);

      // Hạ người đại diện cũ TRƯỚC khi nâng người mới (đối tác không có lúc nào hai người đại diện, kể cả trong transaction).
      const cuId = dong.find((d) => d.role === "REPRESENTATIVE" && d.status !== "REVOKED")?.id ?? null;
      if (cuId) await tx.affiliatePartyUser.update({ where: { id: cuId }, data: { role: "MEMBER" } });
      const nang = await tx.affiliatePartyUser.update({ where: { id: v.id }, data: { role: "REPRESENTATIVE" }, select: { updatedAt: true } });
      await dongBoCotCu(tx, v.partyId, doiTac.userId);
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: ENTITY_AUDIT,
        entityId: v.id,
        action: "AFFILIATE_TRUY_CAP_DOI_DAI_DIEN",
        oldValues: { daiDienUserId: cu?.userId ?? null },
        newValues: { partyId: v.partyId, daiDienUserId: moi!.userId },
        reason: `Đổi người đại diện của đối tác «${doiTac.name}»`,
      });
      return nang.updatedAt;
    });
    return { ok: true, capNhatLuc: ra.toISOString() };
  } catch (e) {
    const d = dich(e);
    if (d) return d;
    throw e;
  }
}
