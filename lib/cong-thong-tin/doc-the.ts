import "server-only";
import { cookies } from "next/headers";
import { getSigningSecret } from "@/lib/security/signing-key";
import { COOKIE_MO_KHOA, kiemTheMoKhoa } from "./the-mo-khoa";

/**
 * Người đang xem ĐÃ để lại thông tin chưa (có cookie `sr_ctt` hợp lệ)? Dùng ở SERVER (trang + route tải) — không tin cờ nào ở trình duyệt.
 * Thiếu/yếu secret ký ⇒ KHÔNG ném: coi như CHƯA mở khoá (cổng đóng — an toàn hơn trang sập).
 * `bayGio` tiêm được để test.
 */
export async function daMoKhoa(bayGio: Date = new Date()): Promise<boolean> {
  try {
    const the = (await cookies()).get(COOKIE_MO_KHOA)?.value;
    return kiemTheMoKhoa(the, { bayGio, khoa: getSigningSecret() }).ok;
  } catch {
    return false;
  }
}
