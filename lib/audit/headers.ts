import { headers } from "next/headers";

import { ipKhachHang } from "@/lib/security/client-ip";

export type RequestMetadata = {
  ip?: string;
  userAgent?: string;
};

/**
 * Extract IP + User-Agent từ incoming request headers.
 * Phải gọi trong context Server Component / Server Action.
 * Trả về object rỗng nếu fail — audit không được phép crash request.
 *
 * IP đi qua luật DÙNG CHUNG (`lib/security/client-ip.ts`). Bản cũ lấy phần tử ĐẦU của
 * `x-forwarded-for` — phần tử do khách viết — nên nhật ký ghi IP do kẻ tấn công chọn, và khoá
 * chặn OTP theo IP ở `/quen-mat-khau` + `/kich-hoat` (đọc `ip` từ đây) đổi theo ý họ mỗi lượt.
 * Ca `[AUD-IP-*]` ghim.
 */
export async function getRequestMetadata(): Promise<RequestMetadata> {
  try {
    const h = await headers();
    return {
      ip: ipKhachHang(h) ?? undefined,
      userAgent: h.get("user-agent") ?? undefined,
    };
  } catch {
    return {};
  }
}
