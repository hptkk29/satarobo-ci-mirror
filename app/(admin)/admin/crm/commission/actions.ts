"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { hasRole } from "@/lib/auth/permissions";
import { checkPermission } from "@/lib/auth/check-permission";
import {
  approveStatement,
  reopenStatement,
  CommissionStmtError,
} from "@/lib/crm/commission-statement";
import { chotKyHoaHong, type KetQuaChotKy } from "@/lib/crm/commission-run";

type Result = { ok: true } | { ok: false; error: string };

function actorFromSession(s: { id: string; name?: string | null; email?: string | null; role: string; roles?: string[] }) {
  return {
    id: s.id,
    name: s.name ?? s.email ?? s.id,
    isSuperAdmin: hasRole(s, "SUPER_ADMIN"),
  };
}

export async function approveStatementAction(period: string, reason: string): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("commission_periods:manage")))
    return { ok: false, error: "Không có quyền chốt kỳ hoa hồng" };
  try {
    await approveStatement(actorFromSession(session.user), period, reason);
    revalidatePath("/admin/crm/commission");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof CommissionStmtError ? e.message : "Lỗi duyệt" };
  }
}

/**
 * Chốt (hoặc chốt lại) kỳ hoa hồng từ TIỀN ĐÃ THU trong kỳ.
 *
 * Gate `commission_periods:manage` — cùng quyền với duyệt/mở lại kỳ.
 *
 * 27/08/2026 — SIẾT: trước đây ba việc này gác bằng `payments:manage`, mà key đó
 * `CENTER_ACCOUNTANT` cũng giữ ở scope GLOBAL ⇒ kế toán MỘT cơ sở bấm chốt được kỳ
 * của CẢ CÔNG TY. Bảng kê là bảng KỲ toàn hệ thống (`period` @unique, không có
 * `centerId`) nên đường GHI không có gì cắt theo cơ sở — cách duy nhất là tách key và
 * chỉ cấp cho cấp Hội sở. Cách ly cơ sở ở màn XEM (lọc theo
 * `CommissionLine.recipientId → User.centerId`) giữ nguyên như cũ.
 *
 * Chạy lại kỳ đang DRAFT/REOPENED là AN TOÀN — `chotKyHoaHong` xoá rồi ghi lại cả kỳ
 * trong một transaction. Kỳ đã APPROVED bị từ chối (phải REOPEN trước).
 */
export async function chotKyHoaHongAction(
  period: string,
  reason: string,
): Promise<{ ok: true; ketQua: KetQuaChotKy } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("commission_periods:manage")))
    return { ok: false, error: "Không có quyền chốt kỳ hoa hồng" };
  try {
    const ketQua = await chotKyHoaHong(actorFromSession(session.user), { period, reason });
    revalidatePath("/admin/crm/commission");
    return { ok: true, ketQua };
  } catch (e) {
    if (e instanceof CommissionStmtError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Lỗi chốt kỳ hoa hồng" };
  }
}

export async function reopenStatementAction(period: string, reason: string): Promise<Result> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // RBAC gate (đồng bộ approveStatementAction). Lưu ý: `reopenStatement` ở tầng lib
  // CÒN một cổng nữa — chỉ SUPER_ADMIN mới mở lại được kỳ đã duyệt. Quyền này là điều
  // kiện CẦN, không phải đủ.
  if (!(await checkPermission("commission_periods:manage")))
    return { ok: false, error: "Không có quyền chốt kỳ hoa hồng" };
  try {
    await reopenStatement(actorFromSession(session.user), period, reason);
    revalidatePath("/admin/crm/commission");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof CommissionStmtError ? e.message : "Lỗi mở lại" };
  }
}
