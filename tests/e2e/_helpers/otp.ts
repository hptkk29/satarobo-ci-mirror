import { createHmac } from "crypto";
import { expect } from "@playwright/test";
import { db } from "../../../lib/db";
import { getSigningSecret } from "../../../lib/security/signing-key";

/**
 * Cách e2e biết mã OTP — dùng chung cho mọi spec đi qua OTP.
 *
 * `codeHash` là HMAC một chiều nên không đọc ngược được. Cửa test
 * `OTP_TEST_FIXED_CODE` (P2) KHÔNG dùng được ở tầng e2e: job CI chạy `pnpm start`
 * ⇒ `NODE_ENV=production`, mà `lib/otp/service.ts` CỐ Ý throw **ngay lúc nạp
 * module** khi thấy biến đó trên production (nó biến mọi mã thành hằng số công
 * khai). Throw ở tầng module nên cả trang không render nổi — đã dính 01/08.
 *
 * Thay vào đó: ghi đè `codeHash` bằng hash của một mã đã biết. Chỉ nạp "tri thức
 * về mã"; CAS tiêu mã, đếm attempts, hạn dùng, cooldown vẫn đi đường thật.
 */
export const OTP_TEST_CODE = "424242";

/** Cùng công thức với `hashCode()` trong lib/otp/service.ts. */
export function hashOtp(code: string): string {
  return createHmac("sha256", getSigningSecret()).update(code).digest("hex");
}

/**
 * Đợi OtpRequest của `target` + `purpose` xuất hiện rồi đặt mã về `OTP_TEST_CODE`.
 *
 * Trả về số dòng khớp để ca test khẳng định luôn `target` được lưu ĐÚNG DẠNG
 * canonical — lệch dạng ở đây là lỗi câm kinh điển: gửi được mã nhưng verify
 * không bao giờ khớp.
 */
export async function forceKnownOtp(
  target: string,
  purpose: "ACTIVATION" | "RESET" | "CHANGE_CONTACT",
): Promise<number> {
  await expect
    .poll(async () => db.otpRequest.count({ where: { target, purpose } }), { timeout: 15_000 })
    .toBe(1);
  const res = await db.otpRequest.updateMany({
    where: { target, purpose },
    data: { codeHash: hashOtp(OTP_TEST_CODE) },
  });
  return res.count;
}
