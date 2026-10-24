/**
 * lib/affiliate/ghi-loai-nhan.ts — MỘT NƠI GHI LOẠI ĐỐI TÁC (`AffiliateType`) và NHÃN (`AffiliateTag`) (AFF-P0b). Luật ở `ghi-loai-nhan-dau-vao.ts` (thuần).
 *
 * Cùng khuôn với `ghi-doi-tac.ts`: quyền + cờ do Server Action kiểm; khoá lạc quan (`FOR UPDATE` → so `getTime()` → ghi); cổng đứng TRƯỚC phép ghi, từ chối là `throw LoiGhiAffiliate`;
 * `writeAudit` cùng transaction; `updatedAtDaThay` BẮT BUỘC.
 *
 *  · Mã BẤT BIẾN: hàm sửa không nhận `code`. Trùng mã (kể cả đua) ⇒ «Mã đã có», không phải lỗi 500.
 *  · KHÔNG có hàm xoá. «Ngừng» chỉ lật `isActive`: đối tác cũ giữ loại/nhãn, ô chọn của đối tác MỚI chỉ liệt kê cái đang hoạt động (`ghi-doi-tac.ts` kiểm khi chọn).
 *  · Nguồn mặc định của loại: ACTIVE ∧ selectable (KHÔNG so mã nguồn). Chỉ kiểm khi nó THẬT SỰ đổi — nguồn bị ngừng sau này không chặn việc sửa tên loại.
 */
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { MODULE_AUDIT_AFFILIATE, LoiGhiAffiliate, aud, laLoiTrungKhoa, type KetQuaGhi, type NguoiGhi } from "./chung";
import { kiemBatTatDanhMuc, suaLoaiSchema, suaNhanSchema, taoLoaiSchema, taoNhanSchema } from "./ghi-loai-nhan-dau-vao";

type Tx = Prisma.TransactionClient;

export type KetQuaTaoDanhMuc = KetQuaGhi<{ id: string; ma: string; capNhatLuc: string }>;
export type KetQuaSuaDanhMuc = KetQuaGhi<{ doi: boolean; truongDoi: string[]; capNhatLuc: string }>;
export type KetQuaBatTatDanhMuc = KetQuaGhi<{ dangDung: boolean; capNhatLuc: string }>;

const khongTimThayLoai = (): LoiGhiAffiliate => new LoiGhiAffiliate("Không tìm thấy loại đối tác này.", "khongTimThay");
const khongTimThayNhan = (): LoiGhiAffiliate => new LoiGhiAffiliate("Không tìm thấy nhãn này.", "khongTimThay");
const vuaDoi = (ten: string): LoiGhiAffiliate => new LoiGhiAffiliate(`${ten} vừa được người khác thay đổi — hãy tải lại rồi thử lại.`, "vuaDoi");

function loiTuZod(e: { issues: readonly { path: PropertyKey[]; message: string }[] }): { ok: false; loi: string; truong: string } {
  const i = e.issues[0];
  return { ok: false, loi: i?.message ?? "Dữ liệu không hợp lệ.", truong: typeof i?.path[0] === "string" ? i.path[0] : "chung" };
}

async function kiemNguonMacDinh(tx: Tx, id: string): Promise<void> {
  const n = await tx.leadSourceGroup.findUnique({ where: { id }, select: { status: true, selectable: true, name: true } });
  if (!n) throw new LoiGhiAffiliate("Không tìm thấy nguồn này.", "defaultSourceGroupId");
  if (n.status !== "ACTIVE" || !n.selectable) {
    throw new LoiGhiAffiliate(`Nguồn «${n.name}» không dùng được làm nguồn mặc định (chỉ nguồn đang hoạt động và chọn được).`, "defaultSourceGroupId");
  }
}

// ── LOẠI ────────────────────────────────────────────────────────────────────────────────────────────

export async function taoLoai(p: { nguoi: NguoiGhi; vao: unknown }): Promise<KetQuaTaoDanhMuc> {
  const kq = taoLoaiSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const r = await db.$transaction(async (tx) => {
      if ((await tx.affiliateType.findUnique({ where: { code: v.code }, select: { id: true } })) !== null) throw new LoiGhiAffiliate(`Mã «${v.code}» đã có.`, "code");
      if (v.defaultSourceGroupId) await kiemNguonMacDinh(tx, v.defaultSourceGroupId);
      const tao = await tx.affiliateType.create({
        data: {
          code: v.code,
          name: v.name,
          description: v.description,
          defaultSourceGroupId: v.defaultSourceGroupId,
          requiresApproval: v.requiresApproval,
          partnerCanViewAmount: v.partnerCanViewAmount ?? null,
          sortOrder: v.sortOrder,
          isActive: true,
          createdById: p.nguoi.userId,
        },
        select: { id: true, code: true, updatedAt: true },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: "AffiliateType",
        entityId: tao.id,
        action: "AFFILIATE_LOAI_TAO",
        newValues: { code: v.code, name: v.name, defaultSourceGroupId: v.defaultSourceGroupId, requiresApproval: v.requiresApproval, partnerCanViewAmount: v.partnerCanViewAmount ?? null, sortOrder: v.sortOrder },
        reason: `Tạo loại đối tác «${v.name}» (${v.code})`,
      });
      return tao;
    });
    return { ok: true, id: r.id, ma: r.code, capNhatLuc: r.updatedAt.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    if (laLoiTrungKhoa(e)) return { ok: false, loi: `Mã «${v.code}» đã có.`, truong: "code" };
    throw e;
  }
}

export async function suaLoai(p: { nguoi: NguoiGhi; id: string; updatedAtDaThay: Date; vao: unknown }): Promise<KetQuaSuaDanhMuc> {
  const kq = suaLoaiSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AffiliateType" WHERE "id" = ${p.id} FOR UPDATE`;
      const dong = await tx.affiliateType.findUnique({ where: { id: p.id } });
      if (!dong) throw khongTimThayLoai();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi("Loại đối tác");
      const cu: Record<string, unknown> = {};
      const moi: Record<string, unknown> = {};
      const doi = (ten: string, a: unknown, b: unknown): boolean => {
        if (a === b) return false;
        cu[ten] = a;
        moi[ten] = b;
        return true;
      };
      doi("name", dong.name, v.name);
      doi("description", dong.description, v.description);
      const nguonDoi = doi("defaultSourceGroupId", dong.defaultSourceGroupId, v.defaultSourceGroupId);
      doi("requiresApproval", dong.requiresApproval, v.requiresApproval);
      // `undefined` = biểu mẫu không gửi ô này ⇒ KHÔNG đổi (gửi `null` mới là «theo mặc định»).
      const xemTienDoi = v.partnerCanViewAmount !== undefined && doi("partnerCanViewAmount", dong.partnerCanViewAmount, v.partnerCanViewAmount);
      doi("sortOrder", dong.sortOrder, v.sortOrder);
      const truongDoi = Object.keys(moi);
      if (truongDoi.length === 0) return { doi: false as const, capNhatLuc: dong.updatedAt, truongDoi };
      if (nguonDoi && v.defaultSourceGroupId) await kiemNguonMacDinh(tx, v.defaultSourceGroupId);
      const cn = await tx.affiliateType.update({
        where: { id: p.id },
        data: {
          name: v.name,
          description: v.description,
          defaultSourceGroupId: v.defaultSourceGroupId,
          requiresApproval: v.requiresApproval,
          sortOrder: v.sortOrder,
          ...(xemTienDoi ? { partnerCanViewAmount: v.partnerCanViewAmount } : {}),
        },
        select: { updatedAt: true },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: "AffiliateType",
        entityId: p.id,
        action: "AFFILIATE_LOAI_SUA",
        oldValues: cu,
        newValues: moi,
        changedFields: truongDoi,
        reason: `Sửa loại đối tác «${v.name}» (${dong.code})`,
      });
      return { doi: true as const, capNhatLuc: cn.updatedAt, truongDoi };
    });
    return { ok: true, doi: ra.doi, truongDoi: ra.truongDoi, capNhatLuc: ra.capNhatLuc.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    throw e;
  }
}

/** `batLai = true` ⇒ bật lại; `false` ⇒ ngừng (đòi lý do). Đối tác đã có loại này KHÔNG bị đụng. */
export async function batTatLoai(p: { nguoi: NguoiGhi; id: string; updatedAtDaThay: Date; batLai: boolean; lyDo: string | null }): Promise<KetQuaBatTatDanhMuc> {
  try {
    const ra = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AffiliateType" WHERE "id" = ${p.id} FOR UPDATE`;
      const dong = await tx.affiliateType.findUnique({ where: { id: p.id }, select: { code: true, name: true, isActive: true, updatedAt: true } });
      if (!dong) throw khongTimThayLoai();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi("Loại đối tác");
      const kiem = kiemBatTatDanhMuc({ dangBat: dong.isActive, batLai: p.batLai, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, "lyDo");
      const cn = await tx.affiliateType.update({ where: { id: p.id }, data: { isActive: p.batLai }, select: { updatedAt: true } });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: "AffiliateType",
        entityId: p.id,
        action: p.batLai ? "AFFILIATE_LOAI_BAT_LAI" : "AFFILIATE_LOAI_NGUNG",
        oldValues: { isActive: dong.isActive },
        newValues: { isActive: p.batLai },
        reason: (p.lyDo ?? "").trim() || `Bật lại loại đối tác «${dong.name}» (${dong.code})`,
      });
      return cn.updatedAt;
    });
    return { ok: true, dangDung: p.batLai, capNhatLuc: ra.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    throw e;
  }
}

// ── NHÃN ────────────────────────────────────────────────────────────────────────────────────────────

export async function taoNhan(p: { nguoi: NguoiGhi; vao: unknown }): Promise<KetQuaTaoDanhMuc> {
  const kq = taoNhanSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const r = await db.$transaction(async (tx) => {
      if ((await tx.affiliateTag.findUnique({ where: { code: v.code }, select: { id: true } })) !== null) throw new LoiGhiAffiliate(`Mã «${v.code}» đã có.`, "code");
      const tao = await tx.affiliateTag.create({
        data: { code: v.code, name: v.name, description: v.description, isActive: true, createdById: p.nguoi.userId },
        select: { id: true, code: true, updatedAt: true },
      });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: "AffiliateTag",
        entityId: tao.id,
        action: "AFFILIATE_NHAN_TAO",
        newValues: { code: v.code, name: v.name },
        reason: `Tạo nhãn «${v.name}» (${v.code})`,
      });
      return tao;
    });
    return { ok: true, id: r.id, ma: r.code, capNhatLuc: r.updatedAt.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    if (laLoiTrungKhoa(e)) return { ok: false, loi: `Mã «${v.code}» đã có.`, truong: "code" };
    throw e;
  }
}

export async function suaNhan(p: { nguoi: NguoiGhi; id: string; updatedAtDaThay: Date; vao: unknown }): Promise<KetQuaSuaDanhMuc> {
  const kq = suaNhanSchema.safeParse(p.vao);
  if (!kq.success) return loiTuZod(kq.error);
  const v = kq.data;
  try {
    const ra = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AffiliateTag" WHERE "id" = ${p.id} FOR UPDATE`;
      const dong = await tx.affiliateTag.findUnique({ where: { id: p.id } });
      if (!dong) throw khongTimThayNhan();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi("Nhãn");
      const cu: Record<string, unknown> = {};
      const moi: Record<string, unknown> = {};
      if (dong.name !== v.name) {
        cu.name = dong.name;
        moi.name = v.name;
      }
      if (dong.description !== v.description) {
        cu.description = dong.description;
        moi.description = v.description;
      }
      const truongDoi = Object.keys(moi);
      if (truongDoi.length === 0) return { doi: false as const, capNhatLuc: dong.updatedAt, truongDoi };
      const cn = await tx.affiliateTag.update({ where: { id: p.id }, data: { name: v.name, description: v.description }, select: { updatedAt: true } });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: "AffiliateTag",
        entityId: p.id,
        action: "AFFILIATE_NHAN_SUA",
        oldValues: cu,
        newValues: moi,
        changedFields: truongDoi,
        reason: `Sửa nhãn «${v.name}» (${dong.code})`,
      });
      return { doi: true as const, capNhatLuc: cn.updatedAt, truongDoi };
    });
    return { ok: true, doi: ra.doi, truongDoi: ra.truongDoi, capNhatLuc: ra.capNhatLuc.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    throw e;
  }
}

export async function batTatNhan(p: { nguoi: NguoiGhi; id: string; updatedAtDaThay: Date; batLai: boolean; lyDo: string | null }): Promise<KetQuaBatTatDanhMuc> {
  try {
    const ra = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "AffiliateTag" WHERE "id" = ${p.id} FOR UPDATE`;
      const dong = await tx.affiliateTag.findUnique({ where: { id: p.id }, select: { code: true, name: true, isActive: true, updatedAt: true } });
      if (!dong) throw khongTimThayNhan();
      if (dong.updatedAt.getTime() !== p.updatedAtDaThay.getTime()) throw vuaDoi("Nhãn");
      const kiem = kiemBatTatDanhMuc({ dangBat: dong.isActive, batLai: p.batLai, lyDo: p.lyDo });
      if (!kiem.ok) throw new LoiGhiAffiliate(kiem.loi, "lyDo");
      const cn = await tx.affiliateTag.update({ where: { id: p.id }, data: { isActive: p.batLai }, select: { updatedAt: true } });
      await writeAudit({
        tx,
        actor: aud(p.nguoi),
        module: MODULE_AUDIT_AFFILIATE,
        entityType: "AffiliateTag",
        entityId: p.id,
        action: p.batLai ? "AFFILIATE_NHAN_BAT_LAI" : "AFFILIATE_NHAN_NGUNG",
        oldValues: { isActive: dong.isActive },
        newValues: { isActive: p.batLai },
        reason: (p.lyDo ?? "").trim() || `Bật lại nhãn «${dong.name}» (${dong.code})`,
      });
      return cn.updatedAt;
    });
    return { ok: true, dangDung: p.batLai, capNhatLuc: ra.toISOString() };
  } catch (e) {
    if (e instanceof LoiGhiAffiliate) return { ok: false, loi: e.message, truong: e.truong };
    throw e;
  }
}
