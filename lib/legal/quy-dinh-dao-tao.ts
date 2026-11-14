// lib/legal/quy-dinh-dao-tao.ts — SỔ ĐỒNG Ý «Quy định đào tạo học viên» (SR.VH.205), 12/11/2026.
//
// Dùng chung bảng `SitePolicyAcceptance` với chính sách website, khác `policyKey` (xem site-policy.ts).
// Đọc bằng `db` TRẦN (lý do y hệt site-policy.ts: sổ này không có đường sở hữu học viên để portalDb cách ly).
//
// AI PHẢI ĐỒNG Ý: phụ huynh CÓ ÍT NHẤT MỘT học viên đã đăng ký khoá (có ghi danh còn lịch sử học — đang học,
// tạm dừng hoặc đã hoàn thành). Tài khoản dùng bản miễn phí (chưa liên kết học viên nào, hoặc chỉ có học viên chưa
// ghi danh) KHÔNG bị chặn. Đây là MỘT hàm duy nhất — layout chặn và trang hồ sơ cùng gọi nó.
//
// KHÔNG `"use server"` và KHÔNG `server-only` (chạy được dưới vitest): cửa cho Client Component là
// `app/(portal)/portal/quy-dinh/actions.ts`.
import { cache } from "react";
import { db } from "@/lib/db";
import { GHI_DANH_CO_LICH_SU } from "@/lib/portal/trang-thai-ghi-danh";
import { QUY_DINH_KEY, QUY_DINH_PHIEN_BAN } from "@/lib/legal/quy-dinh-dao-tao-content";

/** Phụ huynh có con đã đăng ký khoá học (ghi danh thật) không. */
export const phuHuynhCoGhiDanh = cache(async (userId: string): Promise<boolean> => {
  if (!userId) return false;
  const row = await db.enrollment.findFirst({
    where: {
      status: { in: [...GHI_DANH_CO_LICH_SU] },
      deletedAt: null,
      student: { parentUserId: userId, deletedAt: null },
    },
    select: { id: true },
  });
  return row !== null;
});

export type TrangThaiDongY = { daDongY: boolean; luc: Date | null };

/** Đã đồng ý bản ĐANG PHÁT HÀNH chưa (+ mốc). `cache` của React = chỉ trong một request. */
export const docDongYQuyDinh = cache(async (userId: string): Promise<TrangThaiDongY> => {
  if (!userId) return { daDongY: false, luc: null };
  const row = await db.sitePolicyAcceptance.findUnique({
    where: {
      userId_policyKey_version: { userId, policyKey: QUY_DINH_KEY, version: QUY_DINH_PHIEN_BAN },
    },
    select: { acceptedAt: true },
  });
  return { daDongY: row !== null, luc: row?.acceptedAt ?? null };
});

/**
 * Cổng chặn: PHẢI hiện màn đồng ý thay cho cả cổng không.
 * = có con đã đăng ký ∧ chưa đồng ý bản hiện hành. Rẻ nhất trước: đã đồng ý thì khỏi hỏi ghi danh.
 */
export async function canChanQuyDinh(userId: string): Promise<boolean> {
  if ((await docDongYQuyDinh(userId)).daDongY) return false;
  return phuHuynhCoGhiDanh(userId);
}

/** Ghi mốc đồng ý. Idempotent; `update: {}` RỖNG có chủ đích (mốc cần giữ là lần ĐẦU — như site-policy.ts). */
export async function ghiDongYQuyDinh(
  userId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  await db.sitePolicyAcceptance.upsert({
    where: {
      userId_policyKey_version: { userId, policyKey: QUY_DINH_KEY, version: QUY_DINH_PHIEN_BAN },
    },
    create: {
      userId,
      policyKey: QUY_DINH_KEY,
      version: QUY_DINH_PHIEN_BAN,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    },
    update: {},
  });
}
