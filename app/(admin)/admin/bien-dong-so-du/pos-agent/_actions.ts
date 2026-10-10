"use server";

// MÁY ĐỒNG BỘ POS AGENT trên `/admin/bien-dong-so-du/pos-agent` (GĐ4 POS — docs/pos-gd4-thiet-ke.md §9.2).
//
// Ba việc: TẠO máy đồng bộ cho một merchant portal · TẠO LẠI bí mật · BẬT/TẮT. Cổng = `settings:edit` (chỉ Quản
// trị tối cao — T24), HẸP hơn quyền XEM màn (`payments:import-pos`): bí mật máy đồng bộ mở được đường ghi tiền
// tự động của cả một cơ sở. KHÔNG quyền mới ⇒ không cần `seed-prod-roles.yml`. Hỏi quyền NGAY ĐẦU mỗi action,
// viết thẳng trong thân (luật lint `authz/require-can-in-write-action`).
//
// BÍ MẬT (T2): DẪN XUẤT từ `POS_AGENT_MASTER_KEY` — DB chỉ giữ `secretVersion`. Bí mật chỉ đi ra ở GIÁ TRỊ TRẢ của
// hai action tạo / tạo lại (client giữ trong state hộp thoại, xoá khi đóng). KHÔNG `console.*`, KHÔNG vào
// `writeAudit` (oldValues/newValues chỉ `secretVersion`), KHÔNG vào sự kiện / URL. Lưới [POS4-BM-01].
//
// Phạm vi đi qua `scopedDb` + `passesScope` (PosAgent ∈ SCOPED_MODELS) — không so `centerId`/`role` tại chỗ
// (lint `no-inline-authz`). `scopedDb` KHÔNG che WRITE ⇒ phép tạo đặt `centerId` TƯỜNG MINH.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { passesScope, scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { writeAudit } from "@/lib/audit/audit-log";
import { daoKhoaAgent, masterKeyCoSan } from "@/lib/payments/pos/agent/khoa";
import { originTuHeaders } from "@/lib/push/origin";

const QUYEN = "settings:edit";
const LOI_QUYEN = "Chỉ Quản trị tối cao tạo / đổi bí mật / bật-tắt POS Agent.";
const LOI_KHOA =
  "Máy chủ chưa đặt POS_AGENT_MASTER_KEY (≥ 32 ký tự) — chưa tạo / đổi được bí mật POS Agent. Báo bộ phận kỹ thuật.";

const RE_ID = /^[a-z0-9]{20,40}$/;

const taoSchema = z.object({
  centerId: z.string().trim().min(1, "Chọn cơ sở").max(64),
  merchantCode: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{4,32}$/, "Mã merchant gồm 4–32 chữ IN HOA / số, vd NCCPH6KE")),
});

const taoLaiSchema = z.object({
  agentId: z.string().regex(RE_ID, "POS Agent không hợp lệ"),
  /** Version màn đang thấy — phép đổi CÓ ĐIỀU KIỆN theo nó (hai người bấm cùng lúc thì người sau bị từ chối). */
  secretVersionDangThay: z.number().int().min(1),
});

const doiSchema = z.object({
  agentId: z.string().regex(RE_ID, "POS Agent không hợp lệ"),
  active: z.boolean(),
});

/** Cấu hình dán vào trang Options của extension (hợp đồng §2.1) — bí mật CHỈ ở đây, một lần. */
export type CauHinhAgent = {
  agentId: string;
  merchantCode: string;
  centerCode: string;
  satAroboBaseUrl: string;
  biMat: string;
};

type KetQua<T> = ({ ok: true } & T) | { ok: false; error: string };

function lamMoi() {
  revalidatePath("/admin/bien-dong-so-du/pos-agent");
  revalidatePath("/bien-dong-so-du/pos-agent");
}

function loiDauTien(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Dữ liệu không hợp lệ";
}

function laTrungKhoa(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === "P2002";
}

/** Origin của màn admin đang mở — địa chỉ agent gọi về (hợp đồng §1). Không suy được ⇒ chuỗi rỗng (màn nhắc tự điền). */
async function diaChiGoc(): Promise<string> {
  return originTuHeaders(await headers()) ?? "";
}

export async function taoPosAgentAction(input: unknown): Promise<KetQua<CauHinhAgent>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) return { ok: false, error: LOI_QUYEN };
  if (!masterKeyCoSan()) return { ok: false, error: LOI_KHOA };
  const parsed = taoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: loiDauTien(parsed.error) };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const coSo = await sdb.center.findFirst({
    where: { id: parsed.data.centerId },
    select: { id: true, code: true, name: true },
  });
  // `Center` ∈ SCOPE_EXEMPT ⇒ câu trên KHÔNG tự lọc theo tầm nhìn. Phép tạo là phép GHI một bản ghi SCOPED
  // ⇒ tự hỏi phạm vi trên đúng bản ghi sắp tạo (ca `[POS4-Q-03]` "cơ sở có thật nhưng ngoài phạm vi").
  if (!coSo || !passesScope("PosAgent", { centerId: coSo.id }, actor)) {
    return { ok: false, error: "Không tìm thấy cơ sở (hoặc cơ sở ngoài phạm vi của bạn)" };
  }

  let agent: { id: string; merchantCode: string };
  try {
    agent = await sdb.posAgent.create({
      data: { centerId: coSo.id, merchantCode: parsed.data.merchantCode, createdById: session.user.id },
      select: { id: true, merchantCode: true },
    });
  } catch (err) {
    if (laTrungKhoa(err)) {
      return { ok: false, error: `Merchant ${parsed.data.merchantCode} đã có POS Agent — dùng "Tạo lại bí mật" trên thẻ của nó.` };
    }
    throw err;
  }
  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId ?? "", name: actorName },
    module: "finance",
    entityType: "PosAgent",
    entityId: agent.id,
    action: "POS_AGENT_TAO",
    newValues: { merchantCode: agent.merchantCode, centerId: coSo.id, secretVersion: 1 },
    orgUnitId: coSo.id,
  });
  lamMoi();
  return {
    ok: true,
    agentId: agent.id,
    merchantCode: agent.merchantCode,
    centerCode: coSo.code ?? "",
    satAroboBaseUrl: await diaChiGoc(),
    biMat: daoKhoaAgent(agent.id, 1),
  };
}

export async function taoLaiBiMatAgentAction(input: unknown): Promise<KetQua<CauHinhAgent & { secretVersion: number }>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) return { ok: false, error: LOI_QUYEN };
  if (!masterKeyCoSan()) return { ok: false, error: LOI_KHOA };
  const parsed = taoLaiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: loiDauTien(parsed.error) };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const agent = await sdb.posAgent.findFirst({
    where: { id: parsed.data.agentId },
    select: { id: true, centerId: true, merchantCode: true, secretVersion: true, center: { select: { code: true } } },
  });
  if (!agent || !passesScope("PosAgent", agent, actor)) return { ok: false, error: "Không tìm thấy POS Agent" };

  const cu = parsed.data.secretVersionDangThay;
  const moi = cu + 1;
  // CÓ ĐIỀU KIỆN theo version màn đang thấy: đổi 0 dòng ⇒ có người vừa đổi trước — KHÔNG trả bí mật nào.
  const doi = await sdb.posAgent.updateMany({
    where: { id: agent.id, secretVersion: cu },
    data: { secretVersion: moi, secretDoiLuc: new Date() },
  });
  if (doi.count === 0) return { ok: false, error: "Bí mật vừa được người khác đổi — tải lại trang rồi thử lại." };

  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId ?? "", name: actorName },
    module: "finance",
    entityType: "PosAgent",
    entityId: agent.id,
    action: "POS_AGENT_TAO_LAI_BI_MAT",
    oldValues: { secretVersion: cu },
    newValues: { secretVersion: moi },
    orgUnitId: agent.centerId,
  });
  lamMoi();
  return {
    ok: true,
    agentId: agent.id,
    merchantCode: agent.merchantCode,
    centerCode: agent.center.code ?? "",
    satAroboBaseUrl: await diaChiGoc(),
    secretVersion: moi,
    biMat: daoKhoaAgent(agent.id, moi),
  };
}

/**
 * Bật / tắt. TẮT là cách DUY NHẤT đưa một cơ sở về chế độ đọc file khi máy đồng bộ hỏng nhiều ngày (T15/T24):
 * agent tắt ⇒ mọi request của nó 401 `AGENT_DISABLED`, sale thôi bị "Tạm mất kết nối", phiếu đọc dữ liệu import.
 */
export async function doiTrangThaiAgentAction(input: unknown): Promise<KetQua<object>> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission(QUYEN))) return { ok: false, error: LOI_QUYEN };
  if (!masterKeyCoSan()) return { ok: false, error: LOI_KHOA };
  const parsed = doiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: loiDauTien(parsed.error) };

  const actor = await resolveActor(session.user.id);
  const sdb = scopedDb(actor);
  const agent = await sdb.posAgent.findFirst({
    where: { id: parsed.data.agentId },
    select: { id: true, centerId: true, active: true, merchantCode: true },
  });
  if (!agent || !passesScope("PosAgent", agent, actor)) return { ok: false, error: "Không tìm thấy POS Agent" };

  await sdb.posAgent.update({ where: { id: agent.id }, data: { active: parsed.data.active } });
  const { actorId, actorName } = getAuditActor(session);
  await writeAudit({
    actor: { id: actorId ?? "", name: actorName },
    module: "finance",
    entityType: "PosAgent",
    entityId: agent.id,
    action: parsed.data.active ? "POS_AGENT_BAT" : "POS_AGENT_TAT",
    oldValues: { active: agent.active },
    newValues: { active: parsed.data.active, merchantCode: agent.merchantCode },
    orgUnitId: agent.centerId,
  });
  lamMoi();
  return { ok: true };
}
