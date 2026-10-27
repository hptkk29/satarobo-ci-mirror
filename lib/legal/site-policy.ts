// lib/legal/site-policy.ts — SỔ ĐỒNG Ý chính sách hoạt động của website (hồ sơ BCT mục 4).
//
// NỘI DUNG + `SITE_POLICY_VERSION` nằm ở `lib/legal/site-policy-content.ts` (không chạm
// DB) vì màn cổng là Client Component — để chung file này là kéo Prisma vào bundle client.
//
// ⚠️ KHÔNG `"use server"`: file này export hàm thường. Cửa cho Client Component là
// `app/(portal)/portal/hoc-phi/actions.ts`.
//
// ⚠️ KHÔNG `import "server-only"` — cùng lý do đã ghi ở `lib/chat/policy.ts`: module phải
// chạy được dưới vitest node + `tsx`. Chốt chặn không lọt xuống client là `@/lib/db`.
//
// ⚠️ ĐỌC BẰNG `db` TRẦN, KHÔNG qua `portalDb`: `portalDb(owner)` cách ly theo QUAN HỆ SỞ
// HỮU HỌC VIÊN, mà `SitePolicyAcceptance` không có đường sở hữu nào ⇒ nó sẽ pass-through,
// không thêm một chút an toàn nào, trong khi buộc phải dựng `PortalOwner` trước (thêm một
// truy vấn) chỉ để không dùng tới. Câu hỏi "người này đã đồng ý chưa" là câu hỏi mức hệ
// thống về chính người đang đăng nhập. ESLint cấm `@/lib/db` trần trong `app/(portal)/**`,
// nhưng ở `lib/` thì cho phép — đó là lý do truy vấn nằm ở đây chứ không nằm trong action.
import { cache } from "react";
import { db } from "@/lib/db";
import { SITE_POLICY_KEY, SITE_POLICY_VERSION } from "@/lib/legal/site-policy-content";

/**
 * Người này đã đồng ý bản chính sách ĐANG PHÁT HÀNH chưa.
 *
 * `cache` của React: một request có thể hỏi nhiều lần nhưng chỉ đi DB một lần. KHÔNG dùng
 * cache xuyên-request: đây là trạng thái của MỘT người; vừa bấm đồng ý xong mà còn đọc bản
 * cũ vài phút thì đúng bằng "bấm mà không vào được".
 */
export const hasAcceptedSitePolicy = cache(async (userId: string): Promise<boolean> => {
  if (!userId) return false;
  const row = await db.sitePolicyAcceptance.findUnique({
    where: {
      userId_policyKey_version: {
        userId,
        policyKey: SITE_POLICY_KEY,
        version: SITE_POLICY_VERSION,
      },
    },
    select: { userId: true },
  });
  return row !== null;
});

/**
 * Ghi mốc đồng ý. Idempotent: bấm 2 lần / 2 tab đua nhau vẫn ra đúng 1 dòng.
 *
 * ⚠️ `update: {}` RỖNG là có chủ đích — mốc cần lưu là lần ĐẦU. Nhét `acceptedAt: new Date()`
 * vào đó thì mỗi lần F5 lại dời bằng chứng, tức phá đúng thứ bảng này sinh ra để giữ.
 */
export async function recordSitePolicyAcceptance(
  userId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  await db.sitePolicyAcceptance.upsert({
    where: {
      userId_policyKey_version: {
        userId,
        policyKey: SITE_POLICY_KEY,
        version: SITE_POLICY_VERSION,
      },
    },
    create: {
      userId,
      policyKey: SITE_POLICY_KEY,
      version: SITE_POLICY_VERSION,
      ip: meta?.ip ?? null,
      userAgent: meta?.userAgent ?? null,
    },
    update: {}, // cố ý rỗng — không dời acceptedAt, không ghi đè ip/userAgent lần đầu
  });
}

/** Đếm số người đã đồng ý bản hiện hành — cho báo cáo tiến độ xác nhận. */
export async function countSitePolicyAccepted(): Promise<number> {
  return db.sitePolicyAcceptance.count({
    where: { policyKey: SITE_POLICY_KEY, version: SITE_POLICY_VERSION },
  });
}
