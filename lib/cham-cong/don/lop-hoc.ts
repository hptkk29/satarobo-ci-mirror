// lib/cham-cong/don/lop-hoc.ts — handler duyệt đơn LỚP HỌC: nghỉ buổi dạy · dạy thay (đợt 3 đơn
// từ, 08/10/2026). Thay `lib/work-request-apply.ts`.
//
// ── Đổi gì so với bản cũ ─────────────────────────────────────────────────────────────────────
// Bản cũ đổi đơn sang APPROVED TRƯỚC, rồi gọi `cancelSession`/`adjustSession` — hai hàm tự mở
// transaction riêng — và nếu áp thất bại thì "BÙ TRỪ": ghi đơn về PENDING. Giữa hai bước đó có một
// quãng đơn đã APPROVED mà buổi chưa đổi, và nếu chính bước bù trừ lỗi thì quãng đó thành vĩnh viễn.
// Nay hai hàm nhận `tx` của lượt duyệt ⇒ đơn + buổi học + audit cùng commit hoặc cùng rollback
// (BA §14). Không còn đường bù trừ.
//
// Luật áp giữ nguyên: không tìm thấy buổi / dạy thay thiếu người / huỷ không được ⇒ `throw` ⇒ đơn
// GIỮ PENDING kèm `applyError` để người duyệt thấy vì sao.
import type { Prisma } from "@prisma/client";
import { adjustSession, cancelSession } from "@/lib/classes/adjust";
import { vnDateAt } from "@/lib/time/vn";
import { DecideError, HREF_DON_CUA_TOI, type HandlerDon } from "./kieu";

/**
 * Buổi học của lớp trong ĐÚNG ngày VN của đơn (bỏ buổi đã huỷ). `fromDate` là `@db.Date` (nửa đêm
 * UTC của ngày VN) còn `ClassSession.date` mang GIỜ THẬT — khung ngày phải dựng theo giờ VN. Bản cũ
 * dựng bằng `new Date(y, m, d)` theo múi giờ MÁY CHỦ: trên VPS (UTC) buổi 06:30 sáng VN rơi sang
 * ngày hôm trước và đơn báo "không tìm thấy buổi".
 */
async function buoiTrongNgay(tx: Prisma.TransactionClient, classId: string, ngay: Date) {
  const batDau = vnDateAt(ngay.getUTCFullYear(), ngay.getUTCMonth(), ngay.getUTCDate());
  const ketThuc = vnDateAt(ngay.getUTCFullYear(), ngay.getUTCMonth(), ngay.getUTCDate() + 1);
  return tx.classSession.findFirst({
    where: { classId, date: { gte: batDau, lt: ketThuc }, status: { notIn: ["CANCELLED"] } },
    orderBy: { date: "asc" },
    select: { id: true },
  });
}

async function buoiCuaDon(ctx: Parameters<HandlerDon>[0]): Promise<string> {
  const { tx, don } = ctx;
  if (!don.classId || !don.fromDate) throw new DecideError("Đơn thiếu lớp/ngày — hãy cập nhật lịch thủ công.");
  const buoi = await buoiTrongNgay(tx, don.classId, don.fromDate);
  if (!buoi) throw new DecideError("Không tìm thấy buổi học của lớp trong ngày này — hãy cập nhật lịch thủ công.");
  return buoi.id;
}

export const duyetNghiBuoiDay: HandlerDon = async (ctx) => {
  const { tx, don, actor, dateLabel, kindLabel } = ctx;
  const sessionId = await buoiCuaDon(ctx);
  const truoc = await tx.classSession.findUnique({ where: { id: sessionId }, select: { status: true } });
  const r = await cancelSession({
    sessionId,
    reason: `Duyệt đơn nghỉ dạy: ${don.reason}`.slice(0, 500),
    actorId: actor.id,
    actorName: actor.name,
    sourceWorkRequestId: don.id,
    tx,
  });
  if (!r.ok) throw new DecideError(r.error ?? "Không huỷ được buổi học — xử lý thủ công.");
  // Đợt 11 — ẢNH CHỤP PHIÊN BẢN hai buổi NGAY SAU khi đơn đổi chúng: huỷ đơn chỉ hoàn tác khi cả hai
  // còn đúng như thế này (ai sửa buổi gốc / dời buổi bù sau đó ⇒ từ chối, không ghi đè việc của họ).
  const phienBan = async (id: string) => {
    const b = await tx.classSession.findUniqueOrThrow({ where: { id }, select: { date: true, updatedAt: true, status: true } });
    return { ngay: b.date.toISOString(), capNhat: b.updatedAt.toISOString(), trangThai: b.status };
  };
  const phien = { goc: await phienBan(sessionId), bu: r.makeupSessionId ? await phienBan(r.makeupSessionId) : null };
  const message = "Đã huỷ buổi học tương ứng.";
  return {
    applied: true,
    messages: [message],
    notify: [{ userId: don.requesterId, title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`, body: `${actor.name} đã duyệt — ${message}`, href: HREF_DON_CUA_TOI }],
    hieuQua: { sessionId, trangThai: { truoc: truoc?.status ?? null, sau: "CANCELLED" }, buoiBu: r.makeupSessionId ?? null, phienBan: phien },
  };
};

export const duyetDayThay: HandlerDon = async (ctx) => {
  const { tx, don, actor, dateLabel, kindLabel } = ctx;
  // Kiểm người dạy thay TRƯỚC khi tìm buổi: thiếu người là lỗi của đơn, không phải của lịch.
  if (!don.targetUserId) throw new DecideError("Đơn chưa chọn người dạy thay — gán thủ công.");
  const sessionId = await buoiCuaDon(ctx);
  const truoc = await tx.classSession.findUnique({ where: { id: sessionId }, select: { substituteTeacherId: true } });
  const r = await adjustSession({ sessionId, teacherId: don.targetUserId, actorId: actor.id, actorName: actor.name, tx });
  if (!r.ok) throw new DecideError(r.error ?? "Không gán được GV dạy thay — xử lý thủ công.");
  const message = "Đã gán giáo viên dạy thay cho buổi học.";
  return {
    applied: true,
    // Chỉ đổi GV ⇒ trùng phòng CÓ SẴN của buổi không chặn đơn nữa (09/10/2026), nhưng người
    // duyệt vẫn phải biết — cảnh báo đi kèm, không vào tin báo cho người nộp.
    messages: r.canhBao ? [message, r.canhBao] : [message],
    notify: [{ userId: don.requesterId, title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`, body: `${actor.name} đã duyệt — ${message}`, href: HREF_DON_CUA_TOI }],
    hieuQua: { sessionId, gvDayThay: { truoc: truoc?.substituteTeacherId ?? null, sau: don.targetUserId } },
  };
};
