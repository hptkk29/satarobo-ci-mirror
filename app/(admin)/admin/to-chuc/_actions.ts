"use server";

// P1 · US-05 AC4 (Nền Hệ thống) — 3 Server Action tạo/sửa/xoá node cây tổ chức.
//
// Luật cứng của module:
//   - MỌI action: auth() → assertPermission(...) GỌI TRỰC TIẾP trong thân function
//     (lint authz/require-can-in-write-action đọc AST thân function — CẤM wrapper import,
//     CẤM xin vào inline-authz-allowlist). Không so role/centerId ở đây.
//   - Quyền: `centers:edit` — key CÓ SẴN trong registry (lib/permissions/registry/system.ts),
//     ma trận v1 = ["SUPER_ADMIN"], và đã là gate của mọi thao tác "cấu trúc tổ chức"
//     (xem app/(admin)/admin/centers/_actions.ts). KHÔNG chế key mới: registry là một
//     nguồn sự thật duy nhất và có test chặn trùng key.
//   - Luật nghiệp vụ (path/depth cả nhánh, chống vòng lặp, CENTER không làm cha REGION,
//     xoá mềm khi còn con) nằm NGUYÊN ở lib/org/org-service.ts — action chỉ dịch
//     OrgRuleError (code EN + message VI) thành { ok:false, error } cho UI. KHÔNG viết
//     lại luật ở đây; viết lại là có 2 nguồn sự thật.
//   - OrgUnit ∈ SCOPE_EXEMPT (lib/db-scope.ts — centerId chỉ là cầu nối Center cũ) nên
//     scopedDb không tự cách ly được cây; lớp bảo vệ DUY NHẤT là gate quyền ở trên.

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { assertPermission } from "@/lib/auth/check-permission";
import { OrgRuleError } from "@/lib/org/types";
import {
  createOrgUnit,
  softDeleteOrgUnit,
  updateOrgUnit,
} from "@/lib/org/org-service";
import {
  orgUnitAdminCreateSchema,
  orgUnitAdminUpdateSchema,
} from "@/lib/validators/orgunit";

type Result = { ok: true; id?: string } | { ok: false; error: string };

const KHONG_QUYEN = "Không có quyền quản trị cây tổ chức";

/** Route thật sau khi strip route-group: app/(admin)/admin/to-chuc → /admin/to-chuc. */
function revalidateOrgPaths() {
  revalidatePath("/admin/to-chuc");
  // Đơn vị loại CENTER hiển thị kèm ở màn danh mục cơ sở → làm mới luôn cho khỏi lệch.
  revalidatePath("/admin/centers");
}

/** OrgRuleError mang sẵn message tiếng Việt; lỗi lạ thì không phơi chi tiết ra UI. */
function toErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof OrgRuleError) return e.message;
  console.error("[to-chuc] thao tác thất bại:", e);
  return fallback;
}

// ─── 1. Tạo đơn vị ───────────────────────────────────────────────────────────

export async function createOrgUnitAction(input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("centers:edit");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  const parsed = orgUnitAdminCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  try {
    const created = await createOrgUnit({
      type: data.type,
      code: data.code,
      name: data.name,
      parentId: data.parentId,
      address: data.address,
      relationshipType: data.relationshipType,
      legalEntityId: data.legalEntityId,
      // centerId KHÔNG nhận từ form (xem lib/validators/orgunit.ts) — cầu ánh xạ
      // Center ↔ OrgUnit do script backfill US-07 quản.
    });
    revalidateOrgPaths();
    return { ok: true, id: created.id };
  } catch (e) {
    return { ok: false, error: toErrorMessage(e, "Không tạo được đơn vị, thử lại sau") };
  }
}

// ─── 2. Sửa đơn vị (đổi cha/mã ⇒ service tự tính lại path cả nhánh trong 1 tx) ──

export async function updateOrgUnitAction(id: string, input: unknown): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("centers:edit");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  const parsed = orgUnitAdminUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const data = parsed.data;

  try {
    await updateOrgUnit(id, {
      name: data.name,
      parentId: data.parentId,
      address: data.address,
      relationshipType: data.relationshipType,
      status: data.status,
      legalEntityId: data.legalEntityId,
    });
    revalidateOrgPaths();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: toErrorMessage(e, "Không lưu được thay đổi, thử lại sau") };
  }
}

// ─── 3. Xoá mềm đơn vị (service chặn nếu còn đơn vị con đang sống) ────────────

export async function deleteOrgUnitAction(id: string): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  try {
    await assertPermission("centers:edit");
  } catch {
    return { ok: false, error: KHONG_QUYEN };
  }

  try {
    await softDeleteOrgUnit(id);
    revalidateOrgPaths();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: toErrorMessage(e, "Không xoá được đơn vị, thử lại sau") };
  }
}
