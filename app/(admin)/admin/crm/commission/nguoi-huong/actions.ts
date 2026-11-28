"use server";

// Màn khai NGƯỜI HƯỞNG hoa hồng theo cơ sở (QC 1% · Quản lý TT 2%) — chốt 27/08/2026.
//
// Gate `commission-assignee:manage` (chỉ SUPER_ADMIN). KHÔNG mượn `payments:manage`:
// đó là quyền của kế toán — người TRẢ tiền không nên đồng thời chỉ định người NHẬN.
// Cũng không mượn `centers:edit`, để việc nới quyền sửa cơ sở về sau không vô tình nới
// luôn quyền chuyển hướng tiền hoa hồng.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { assertPermission } from "@/lib/auth/check-permission";
import { PermissionError } from "@/lib/auth/can";
import {
  themPhanCong,
  ketThucPhanCong,
  PhanCongError,
  VAI_HOA_HONG_CO_SO,
} from "@/lib/crm/commission-assignee-store";

type Result = { ok: true } | { ok: false; error: string };

const themSchema = z.object({
  centerId: z.string().trim().min(1, "Chọn cơ sở"),
  role: z.enum(VAI_HOA_HONG_CO_SO),
  userId: z.string().trim().min(1, "Chọn tài khoản người hưởng"),
  // `<input type="date">` trả "YYYY-MM-DD" (giờ địa phương của người nhập). Quy về
  // 00:00 GIỜ VIỆT NAM, không phải 00:00 UTC: lệch 7 tiếng ở biên ngày là bút toán
  // xác nhận sáng sớm rơi nhầm sang người phụ trách hôm trước.
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày bắt đầu không hợp lệ"),
  note: z.string().trim().max(500).optional(),
});

const ketThucSchema = z.object({
  id: z.string().trim().min(1),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày kết thúc không hợp lệ"),
});

/** "YYYY-MM-DD" → 00:00 ngày đó GIỜ VIỆT NAM, quy về UTC. */
function ngayVN(s: string): Date {
  return new Date(`${s}T00:00:00+07:00`);
}

async function nguoiThucHien() {
  const session = await auth();
  if (!session?.user) return null;
  await assertPermission("commission-assignee:manage");
  return {
    id: session.user.id,
    name: session.user.name ?? session.user.email ?? session.user.id,
  };
}

function loi(e: unknown): Result {
  if (e instanceof PermissionError) return { ok: false, error: "Không có quyền" };
  if (e instanceof PhanCongError) return { ok: false, error: e.message };
  return { ok: false, error: e instanceof Error ? e.message : "Lỗi không xác định" };
}

export async function themPhanCongAction(input: unknown): Promise<Result> {
  let actor;
  try {
    actor = await nguoiThucHien();
  } catch (e) {
    return loi(e);
  }
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = themSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  try {
    await themPhanCong(actor, {
      centerId: parsed.data.centerId,
      role: parsed.data.role,
      userId: parsed.data.userId,
      effectiveFrom: ngayVN(parsed.data.effectiveFrom),
      note: parsed.data.note ?? null,
    });
  } catch (e) {
    // Khoá `@@unique(centerId, role, userId, effectiveFrom)` — bấm hai lần.
    if (e instanceof Error && e.message.includes("Unique constraint")) {
      return { ok: false, error: "Dòng này đã có rồi (cùng cơ sở, vai, người, ngày bắt đầu)." };
    }
    return loi(e);
  }
  revalidatePath("/admin/crm/commission/nguoi-huong");
  revalidatePath("/admin/crm/commission");
  revalidatePath("/admin/centers");
  return { ok: true };
}

export async function ketThucPhanCongAction(input: unknown): Promise<Result> {
  let actor;
  try {
    actor = await nguoiThucHien();
  } catch (e) {
    return loi(e);
  }
  if (!actor) return { ok: false, error: "Chưa đăng nhập" };

  const parsed = ketThucSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  try {
    await ketThucPhanCong(actor, {
      id: parsed.data.id,
      effectiveTo: ngayVN(parsed.data.effectiveTo),
    });
  } catch (e) {
    return loi(e);
  }
  revalidatePath("/admin/crm/commission/nguoi-huong");
  revalidatePath("/admin/crm/commission");
  revalidatePath("/admin/centers");
  return { ok: true };
}
