// lib/cham-cong/checkin-gate.ts — cổng vào trang check-in (L4): xác minh mã kiosk TĨNH → cấp vé.
// Dùng chung cho admin `/cham-cong/checkin` và site GV `/teacher/cham-cong/checkin`.
//
// Từ 07/09/2026 chỉ còn MỘT họ mã (tĩnh, dán ở quầy). Mã xoay 60s đã gỡ — xem `kiosk-token.ts`.
import "server-only";
import { db } from "@/lib/db";
import { getSigningSecret } from "@/lib/security/signing-key";
import { laMaXoayDoiCu, verifyStaticKioskToken } from "./kiosk-token";
import { issueTicket } from "./timelog";

export type CheckinGate =
  | { ok: true; ticketId: string; nonce: string; expiresAt: string; workLocation: { id: string; name: string; geofenceEnabled: boolean } }
  | { ok: false; error: string };

export async function prepareCheckin(input: { token: string | undefined; workLocationId: string | undefined; userId: string; ip?: string | null }): Promise<CheckinGate> {
  if (!input.token || !input.workLocationId) return { ok: false, error: "Mã QR không hợp lệ. Quét lại mã dán tại quầy chấm công." };

  // Mã đời cũ (họ xoay của màn TV, đã gỡ 07/09) vẫn còn trong ảnh chụp và trong lịch sử trình
  // duyệt. Nói thẳng là nó đã ngừng dùng — để "Mã QR không hợp lệ" thì người ta đứng bấm lại.
  if (laMaXoayDoiCu(input.token)) {
    return {
      ok: false,
      error: "Mã QR đời cũ đã ngừng dùng. Quét tờ mã dán tại quầy chấm công.",
    };
  }

  const secret = getSigningSecret();
  const v = verifyStaticKioskToken(input.token, secret);
  if (!v.ok) return { ok: false, error: "Mã QR không hợp lệ. Quét lại mã dán tại quầy chấm công." };
  const workLocationId = v.workLocationId;
  const keyVersion = v.keyVersion;

  if (workLocationId !== input.workLocationId) return { ok: false, error: "Mã QR không khớp điểm chấm công." };
  const wl = await db.workLocation.findUnique({ where: { id: workLocationId }, select: { id: true, name: true, isActive: true, geofenceEnabled: true, latitude: true, longitude: true, qrKeyVersion: true } });
  if (!wl || !wl.isActive) return { ok: false, error: "Điểm chấm công đã tắt. Báo Quản lý cơ sở." };

  // Mã in đời cũ: chữ ký vẫn đúng nhưng tờ giấy đã bị thu hồi. Nói rõ để người quét đi lấy mã
  // mới chứ không đứng bấm lại.
  if (keyVersion !== wl.qrKeyVersion) {
    return { ok: false, error: "Mã QR này đã bị thu hồi. Quét tờ mã MỚI dán tại quầy — hỏi Quản lý cơ sở nếu chưa thấy." };
  }
  const t = await issueTicket({ userId: input.userId, workLocationId: wl.id, ip: input.ip });
  return { ok: true, ticketId: t.ticketId, nonce: t.nonce, expiresAt: t.expiresAt.toISOString(), workLocation: { id: wl.id, name: wl.name, geofenceEnabled: wl.geofenceEnabled } };
}
