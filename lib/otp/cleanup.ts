import "server-only";
import { db } from "@/lib/db";

/**
 * AUTH-SĐT P0 §3.7 — chính sách lưu trữ cho dấu vết OTP.
 *
 * `OtpDeliveryLog` gắn `onDelete: Cascade` vào `OtpRequest` nên xoá request là
 * log con đi theo — chỉ cần một lệnh xoá, không phải hai.
 */
export const OTP_RETENTION_DAYS = 90;

export type OtpPurgeResult = {
  cutoff: string;
  deletedRequests: number;
};

/** THUẦN — mốc thời gian cắt, tách ra để test được không cần DB. */
export function otpPurgeCutoff(now: Date, retentionDays = OTP_RETENTION_DAYS): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60_000);
}

export async function purgeExpiredOtpRecords(now: Date = new Date()): Promise<OtpPurgeResult> {
  const cutoff = otpPurgeCutoff(now);
  const { count } = await db.otpRequest.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { cutoff: cutoff.toISOString(), deletedRequests: count };
}
