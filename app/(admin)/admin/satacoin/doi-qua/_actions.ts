"use server";

import { revalidatePath } from "next/cache";
import type { Session } from "next-auth";
import { z } from "zod";

import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { resolveActor } from "@/lib/auth/actor";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { getModelVisibleCenterIds, passesScope, scopedDb } from "@/lib/db-scope";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { datHanMucGiaoVien } from "@/lib/satacoin/han-muc";
import { LoiDoiQua, xuLyYeuCauDoiQua } from "@/lib/satacoin/doi-qua";

/**
 * WP8 — màn nhân sự ĐỔI QUÀ SATACOIN. Mọi action: phiên → quyền (`satacoin:redeem`; danh mục quà toàn cục: `satacoin:catalog`; hạn mức giáo viên: `satacoin:quota`) → cách ly cơ sở → luật ở `lib/satacoin/*` → audit.
 * Luật (giữ/hoàn coin, tồn kho, khoá, trạng thái) KHÔNG viết lại ở đây. Không có action nào cộng coin: hoàn tất chỉ TRỪ khoản đã giữ.
 */
type KetQua = { ok: true } | { ok: false; error: string };

async function cong(session: Session | null, quyen: "satacoin:redeem" | "satacoin:quota" | "satacoin:catalog"): Promise<string | null> {
  if (!session?.user) return "Chưa đăng nhập";
  if (!(await checkPermission(quyen))) return "Không có quyền";
  return null;
}

const xuLySchema = z.object({
  redemptionId: z.string().min(1),
  hanhDong: z.enum(["DUYET", "TU_CHOI", "HOAN_TAT"]),
  ghiChu: z.string().trim().max(500).optional(),
});

export async function xuLyYeuCauAction(input: unknown): Promise<KetQua> {
  const session = await auth();
  const err = await cong(session, "satacoin:redeem");
  if (err) return { ok: false, error: err };
  const p = xuLySchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = p.data;
  // Từ chối phải có LÝ DO (phụ huynh đọc được ở app).
  if (d.hanhDong === "TU_CHOI" && (d.ghiChu ?? "").length < 3) return { ok: false, error: "Vui lòng ghi lý do từ chối" };

  // Cách ly cơ sở: yêu cầu phải thuộc tầm nhìn của actor (chống IDOR giữa các cơ sở).
  const scopeActor = await resolveActor(session!.user.id);
  const sdb = scopedDb(scopeActor);
  const yc = await sdb.sataCoinRedemption.findUnique({ where: { id: d.redemptionId }, select: { id: true, centerId: true, studentId: true, status: true, coinCost: true } });
  if (!yc || !passesScope("SataCoinRedemption", yc, scopeActor)) return { ok: false, error: "Không tìm thấy yêu cầu" };

  try {
    const sau = await xuLyYeuCauDoiQua({ redemptionId: yc.id, actorUserId: session!.user.id, hanhDong: d.hanhDong, ghiChu: d.ghiChu ?? null });
    const actor = getAuditActor(session);
    await writeAudit({
      actor: { id: actor.actorId, name: actor.actorName },
      module: "satacoin",
      entityType: "SataCoinRedemption",
      entityId: yc.id,
      action: `satacoin.redemption.${d.hanhDong.toLowerCase()}`,
      oldValues: { status: yc.status },
      newValues: { status: sau.status, coinCost: yc.coinCost },
      reason: d.ghiChu || undefined,
      orgUnitId: await orgUnitIdForCenter(yc.centerId),
    });
  } catch (e) {
    if (e instanceof LoiDoiQua) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/admin/satacoin/doi-qua");
  return { ok: true };
}

const quaSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(2, "Nhập tên quà").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  coinCost: z.coerce.number().int("Số coin phải là số nguyên").min(1, "Quà phải có giá ít nhất 1 coin").max(1_000_000),
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export async function luuQuaAction(input: unknown): Promise<KetQua> {
  const session = await auth();
  // Danh mục quà là dữ liệu DÙNG CHUNG mọi cơ sở (đổi giá = đổi cho cả hệ thống) ⇒ chỉ quản trị cấp hệ thống; QLCS chỉ có `satacoin:redeem`.
  const err = await cong(session, "satacoin:catalog");
  if (err) return { ok: false, error: err };
  const p = quaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = p.data;
  const data = { name: d.name, description: d.description || null, coinCost: d.coinCost, isActive: d.isActive, sortOrder: d.sortOrder };
  const sdb = scopedDb(await resolveActor(session!.user.id));
  const actor = getAuditActor(session);
  let id = d.id;
  if (id) {
    const cu = await sdb.sataCoinGift.findUnique({ where: { id }, select: { id: true } });
    if (!cu) return { ok: false, error: "Không tìm thấy món quà" };
    await sdb.sataCoinGift.update({ where: { id }, data }); // đổi giá KHÔNG đổi yêu cầu đang giữ (đã chụp coinCost lúc gửi)
  } else {
    id = (await sdb.sataCoinGift.create({ data: { ...data, createdById: session!.user.id }, select: { id: true } })).id;
  }
  await writeAudit({ actor: { id: actor.actorId, name: actor.actorName }, module: "satacoin", entityType: "SataCoinGift", entityId: id, action: d.id ? "satacoin.gift.update" : "satacoin.gift.create", newValues: data });
  revalidatePath("/admin/satacoin/doi-qua");
  return { ok: true };
}

const tonSchema = z.object({
  giftId: z.string().min(1),
  centerId: z.string().min(1),
  delta: z.coerce.number().int().refine((n) => n !== 0 && Math.abs(n) <= 100_000, "Số lượng điều chỉnh phải khác 0"),
  reason: z.string().trim().min(3, "Ghi lý do điều chỉnh").max(200),
});

/** Nhập/điều chỉnh tồn kho theo cơ sở bằng ĐỘ LỆCH (không đặt số tuyệt đối: tránh đè lên phần vừa bị yêu cầu giữ chỗ). Trừ có điều kiện ⇒ không bao giờ âm. */
export async function dieuChinhTonKhoAction(input: unknown): Promise<KetQua> {
  const session = await auth();
  const err = await cong(session, "satacoin:redeem");
  if (err) return { ok: false, error: err };
  const p = tonSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = p.data;
  const scopeActor = await resolveActor(session!.user.id);
  const sdb = scopedDb(scopeActor);
  if (!passesScope("SataCoinGiftStock", { centerId: d.centerId }, scopeActor)) return { ok: false, error: "Không có quyền với cơ sở này" };
  const [qua, coSo] = await Promise.all([sdb.sataCoinGift.findUnique({ where: { id: d.giftId }, select: { id: true } }), sdb.center.findUnique({ where: { id: d.centerId }, select: { id: true } })]);
  if (!qua || !coSo) return { ok: false, error: "Không tìm thấy quà hoặc cơ sở" };
  const orgUnitId = await orgUnitIdForCenter(d.centerId);

  if (d.delta > 0) {
    await sdb.sataCoinGiftStock.upsert({
      where: { giftId_centerId: { giftId: d.giftId, centerId: d.centerId } },
      create: { giftId: d.giftId, centerId: d.centerId, orgUnitId, quantity: d.delta },
      update: { quantity: { increment: d.delta } },
    });
  } else {
    const r = await sdb.sataCoinGiftStock.updateMany({ where: { giftId: d.giftId, centerId: d.centerId, quantity: { gte: -d.delta } }, data: { quantity: { decrement: -d.delta } } });
    if (r.count === 0) return { ok: false, error: "Tồn kho không đủ để giảm" };
  }
  const actor = getAuditActor(session);
  await writeAudit({ actor: { id: actor.actorId, name: actor.actorName }, module: "satacoin", entityType: "SataCoinGiftStock", entityId: `${d.giftId}:${d.centerId}`, action: "satacoin.stock.adjust", newValues: { delta: d.delta }, reason: d.reason, orgUnitId });
  revalidatePath("/admin/satacoin/doi-qua");
  return { ok: true };
}

const hanMucSchema = z.object({ teacherUserId: z.string().min(1), capPerMonth: z.coerce.number().int(), note: z.string().trim().max(300).optional() });

export async function datHanMucAction(input: unknown): Promise<KetQua> {
  const session = await auth();
  const err = await cong(session, "satacoin:quota");
  if (err) return { ok: false, error: err };
  const p = hanMucSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const truoc = await scopedDb(await resolveActor(session!.user.id)).teacherCoinQuota.findUnique({ where: { userId: p.data.teacherUserId }, select: { capPerMonth: true } });
  const kq = await datHanMucGiaoVien({ adminId: session!.user.id, teacherUserId: p.data.teacherUserId, capPerMonth: p.data.capPerMonth, note: p.data.note ?? null });
  if (!kq.ok) return { ok: false, error: kq.loi };
  const actor = getAuditActor(session);
  await writeAudit({ actor: { id: actor.actorId, name: actor.actorName }, module: "satacoin", entityType: "TeacherCoinQuota", entityId: p.data.teacherUserId, action: "satacoin.quota.set", oldValues: { capPerMonth: truoc?.capPerMonth ?? null }, newValues: { capPerMonth: p.data.capPerMonth }, reason: p.data.note || undefined });
  revalidatePath("/admin/satacoin/doi-qua");
  return { ok: true };
}

/** Danh sách cơ sở actor được nhập kho (cho ô chọn). */
export async function coSoNhapKho(): Promise<Array<{ id: string; name: string }>> {
  const session = await auth();
  if ((await cong(session, "satacoin:redeem")) !== null) return [];
  const actor = await resolveActor(session!.user.id);
  const thay = getModelVisibleCenterIds("SataCoinGiftStock", actor);
  return scopedDb(actor).center.findMany({ where: thay === "ALL" ? {} : { id: { in: thay } }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}
