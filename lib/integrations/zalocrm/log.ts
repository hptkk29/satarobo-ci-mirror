import "server-only";
// lib/integrations/zalocrm/log.ts — NHẬT KÝ TÍCH HỢP của trục ZaloCRM.
//
// Đây là thứ làm mục "Tích hợp" (`/admin/tich-hop`) đỏ lên khi webhook rơi vào
// 404/401, và là câu trả lời duy nhất cho câu hỏi "vì sao hộp thư trống?".
//
// ⚠️ BA ĐIỀU ĐÃ RÀNG SẴN Ở ĐÂY, đừng gỡ:
//  1. `provider = "ZALOCRM:<org>"` — cột `provider` là chuỗi tự do và màn Tích hợp
//     lọc bằng `startsWith("ZALOCRM")`. Thiếu hậu tố org thì ba cơ sở trộn chung một
//     dòng thời gian và không tách được cái nào của ai.
//  2. Payload đi qua `ducPayload` TRƯỚC khi ghi. `IntegrationLog` KHÔNG nằm trong
//     `SCOPED_MODELS`/`SCOPE_EXEMPT`/`NULL_IS_GLOBAL_MODELS` ⇒ `scopedDb` cho đi qua
//     nguyên vẹn ⇒ KHÔNG cách ly cơ sở. Ghi nguyên văn ở đây là để SĐT/nội dung chat
//     của CS1 hiện với người CS2.
//  3. `IntegrationStatus` KHÔNG có `SENT` (`PENDING | SUCCESS | SKIPPED | FAILED`).
//     `SENT` trên màn Tích hợp là của `ZaloMessageLog` — model khác. Ghi `"SENT"` ở
//     đây là lỗi Prisma lúc CHẠY, không phải lúc build.
import type { IntegrationDirection, IntegrationStatus, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ducPayload } from "./duc-payload";
import { PROVIDER_ZALOCRM } from "./types";

/** Trần độ dài thông điệp lỗi. Khuôn lấy từ `lib/crm/meta-webhook.ts:107`. */
const TRAN_LOI = 1_000;

/** Van cho nhật ký "org lạ": request đến từ bất kỳ ai, nên phải có trần. */
const THROTTLE_MAX = 20;
const THROTTLE_WINDOW_MS = 60_000;

/** Khoá `IntegrationLog.provider` của một org. */
export function providerLogKey(org: string): string {
  return `${PROVIDER_ZALOCRM}:${org}`;
}

export type GhiNhatKyInput = {
  orgCode: string;
  /** Nhãn hành động, dạng `WEBHOOK_*` / `API_*`. Ngắn, không dấu, để lọc được. */
  action: string;
  status: IntegrationStatus;
  /** Mặc định `PULL`: webhook là dữ liệu ĐI VÀO, không phải mình đẩy đi. */
  direction?: IntegrationDirection;
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string | null;
  /**
   * Khoá rate-limit. CHỈ truyền cho những đường mà người lạ gọi được vô hạn (org
   * lạ, chữ ký sai): mỗi org bịa ra là một khoá rate-limit webhook riêng, nên nếu
   * không có van thứ hai thì bảng này phình không giới hạn.
   *
   * Bỏ trống = ghi thẳng (đường đã qua xác thực).
   */
  khoaThrottle?: string | null;
};

/**
 * Ghi một dòng nhật ký. Trả `id`, hoặc `null` khi bị chặn/ghi hỏng.
 *
 * ⚠️ KHÔNG BAO GIỜ NÉM. Nhật ký hỏng không được làm hỏng lượt webhook — nếu không,
 * một sự cố ở bảng phụ biến thành mất tin ở bảng chính.
 */
export async function ghiNhatKyZalocrm(input: GhiNhatKyInput): Promise<string | null> {
  try {
    if (input.khoaThrottle) {
      const rl = await rateLimit({
        key: input.khoaThrottle,
        max: THROTTLE_MAX,
        windowMs: THROTTLE_WINDOW_MS,
      });
      if (!rl.success) return null;
    }

    const row = await db.integrationLog.create({
      data: {
        provider: providerLogKey(input.orgCode),
        direction: input.direction ?? "PULL",
        action: input.action,
        status: input.status,
        requestPayload: (ducPayload(input.requestPayload ?? {}) ?? {}) as Prisma.InputJsonValue,
        responsePayload:
          input.responsePayload === undefined
            ? undefined
            : ((ducPayload(input.responsePayload) ?? {}) as Prisma.InputJsonValue),
        errorMessage: input.errorMessage ? String(input.errorMessage).slice(0, TRAN_LOI) : null,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.error("[zalocrm] không ghi được IntegrationLog:", err);
    return null;
  }
}
