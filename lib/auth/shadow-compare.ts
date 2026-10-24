// lib/auth/shadow-compare.ts — A0-03: chạy can() v2 song song matrix cũ (v1),
// log lệch để thu thập trước khi bật flag ở prod (Doc 15 §2.4 shadow).
import { isRbacV2Enabled } from "@/lib/flags";

export type ShadowLogger = { warn: (message: string) => void };

/**
 * Quyết định kết quả quyền + log nếu v1≠v2.
 * - flag OFF → trả v1 (matrix cũ, an toàn) nhưng vẫn so v2 + log lệch.
 * - flag ON  → trả v2.
 */
export function decidePermission(params: {
  action: string;
  userId: string;
  v1: boolean;
  v2: boolean;
  flagOn?: boolean;
  logger?: ShadowLogger;
}): boolean {
  const flagOn = params.flagOn ?? isRbacV2Enabled();
  const logger = params.logger ?? console;
  if (params.v1 !== params.v2) {
    logger.warn(
      `[rbac-shadow] mismatch action=${params.action} user=${params.userId} v1=${params.v1} v2=${params.v2} (using ${flagOn ? "v2" : "v1"})`,
    );
  }
  return flagOn ? params.v2 : params.v1;
}
