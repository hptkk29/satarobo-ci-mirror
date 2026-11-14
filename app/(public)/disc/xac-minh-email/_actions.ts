"use server";

import { notFound, redirect } from "next/navigation";
import { isDiscEnabled } from "@/lib/flags";
import { rateLimit } from "@/lib/rate-limit";
import { getRequestMetadata } from "@/lib/audit/headers";
import { xacMinhEmail } from "@/lib/disc/email";
import { emailStore, xepThuThat } from "@/lib/disc/email-prisma";
import { gocUngDungEmail } from "@/lib/disc/email-goc";
import { gopIpChoGioiHan } from "@/lib/disc/phone-key";

const TRANG = "/disc/xac-minh-email";

/**
 * POST xác nhận email — việc DUY NHẤT làm thay đổi trạng thái. GET trang chỉ vẽ nút (trình quét thư/bot tự mở liên kết bằng GET
 * nên không được xác minh hộ). Kết quả đi qua `redirect` (PRG): token KHÔNG nằm lại trong URL sau khi dùng, F5 không gửi lại.
 * Mọi nguyên nhân thất bại (token lạ · hết hạn · đã dùng · bài đã xoá · quá tần suất · thiếu cấu hình) ra CÙNG `?kq=loi`.
 * Không log token, không log email.
 */
export async function xacNhanEmailDiscAction(formData: FormData): Promise<void> {
  if (!isDiscEnabled()) notFound();

  const t = formData.get("t");
  const { ip } = await getRequestMetadata();
  const rl = await rateLimit({ key: `disc-email-verify:ip:${gopIpChoGioiHan(ip ?? "unknown")}`, max: 20, windowMs: 60 * 60_000 });
  const goc = gocUngDungEmail();
  if (!rl.success || !goc) redirect(`${TRANG}?kq=loi`);

  const r = await xacMinhEmail({ token: typeof t === "string" ? t : null, goc, store: emailStore, xepThu: xepThuThat, now: new Date() });
  if (!r.ok) redirect(`${TRANG}?kq=loi`);
  // QUEUED ≠ SENT: `xepBaoCao` chỉ nói thư ĐÃ ĐƯỢC XẾP HÀNG hay chưa, không bao giờ nói "đã gửi".
  redirect(r.xepBaoCao ? `${TRANG}?kq=ok` : `${TRANG}?kq=chua-xep`);
}
