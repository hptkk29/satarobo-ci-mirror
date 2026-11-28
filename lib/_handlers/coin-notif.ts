// lib/_handlers/coin-notif.ts — V8.24 (BR-COIN-01): thông báo SataCoin cho PHỤ HUYNH.
//
//   coin.earned       { txId, studentId }            → «SataCoin mới»: con được CỘNG coin (EARN / ADJUST dương)
//   coin.redemption   { redemptionId, status }       → yêu cầu đổi quà ĐƯỢC DUYỆT / BỊ TỪ CHỐI / ĐÃ TRAO
//
// Ghi vào bảng `Notification` (audience=STUDENT + studentId; dedupeKey `coin.…`) — chính nguồn mà chuông phụ huynh web và `GET /notifications` của app đã đọc; loại `coin` của app suy từ TIỀN TỐ dedupeKey.
// ⛔ Cờ `PORTAL_SATACOIN_ENABLED` TẮT ⇒ KHÔNG tạo thông báo (cùng công tắc với route `satacoin/gifts/gift-redemptions`).
// ⛔ Không tin payload: đọc lại giao dịch / yêu cầu; chỉ báo khi dòng thật sự khớp (cộng dương đúng học viên · trạng thái hiện tại = trạng thái trong sự kiện).
// ⛔ Nội dung KHÔNG có ghi chú/lý do của nhân viên; KHÔNG gửi push. Trừ coin / đảo giao dịch KHÔNG báo (chưa có quy định). Tin KHÔNG vào danh sách cho phép của học sinh (`TIEN_TO_TIN_HOC_SINH`) ⇒ chỉ phụ huynh thấy.
// Idempotent: `dedupeKey` UNIQUE. Cố ý KHÔNG nuốt lỗi DB (để outbox retry).
import { db } from "@/lib/db";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { mucSataCoinDangHien } from "@/lib/portal/muc-tam-an";

const str = (v: unknown): string => (v == null ? "" : String(v));

export async function onCoinEarnedNotif(event: DomainEventLite): Promise<void> {
  if (!mucSataCoinDangHien()) return; // SataCoin đang ẩn (PORTAL_SATACOIN_ENABLED tắt) ⇒ không báo về thứ không hiện
  const txId = str(event.payload.txId);
  const studentId = str(event.payload.studentId);
  if (!txId || !studentId) return;
  const t = await db.sataCoinTransaction.findUnique({ where: { id: txId }, select: { id: true, studentId: true, amount: true, type: true, centerId: true } });
  if (!t || t.studentId !== studentId || t.amount <= 0 || (t.type !== "EARN" && t.type !== "ADJUST")) return;
  await db.notification.createMany({
    data: [{ title: "SataCoin mới", body: `Con vừa được cộng ${t.amount} SataCoin.`, audience: "STUDENT" as const, studentId: t.studentId, centerId: t.centerId, isPublished: true, dedupeKey: `coin.earned:${t.id}` }],
    skipDuplicates: true,
  });
}

const NOI_DUNG_DOI_QUA: Record<string, { title: string; body: (qua: string) => string }> = {
  APPROVED: { title: "Yêu cầu đổi quà đã được duyệt", body: (q) => `Trung tâm đã duyệt yêu cầu đổi «${q}» — chờ trao quà.` },
  REJECTED: { title: "Yêu cầu đổi quà bị từ chối", body: (q) => `Trung tâm đã từ chối yêu cầu đổi «${q}» — coin đã được hoàn lại.` },
  DELIVERED: { title: "Đã trao quà", body: (q) => `Con đã nhận quà «${q}».` },
};

export async function onCoinRedemptionNotif(event: DomainEventLite): Promise<void> {
  if (!mucSataCoinDangHien()) return;
  const redemptionId = str(event.payload.redemptionId);
  const status = str(event.payload.status);
  const nd = NOI_DUNG_DOI_QUA[status];
  if (!redemptionId || !nd) return;
  const r = await db.sataCoinRedemption.findUnique({ where: { id: redemptionId }, select: { id: true, studentId: true, status: true, centerId: true, gift: { select: { name: true } } } });
  if (!r || r.status !== status) return; // sự kiện cũ (trạng thái đã đi tiếp) hoặc không có
  await db.notification.createMany({
    data: [{ title: nd.title, body: nd.body(r.gift.name), audience: "STUDENT" as const, studentId: r.studentId, centerId: r.centerId, isPublished: true, dedupeKey: `coin.redemption:${r.id}:${status}` }],
    skipDuplicates: true,
  });
}

export function registerCoinNotifHandlers(): void {
  on("coin.earned", onCoinEarnedNotif);
  on("coin.redemption", onCoinRedemptionNotif);
}
