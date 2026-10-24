// lib/classes/mo-lai-buoi.ts — "MỞ LẠI BUỔI" đã huỷ (11/10/2026).
//
// Vì sao có: duyệt đơn "Nghỉ buổi dạy" (hoặc bấm "Huỷ" ở màn lớp) luôn huỷ buổi + sinh buổi bù cuối lịch. Khi
// giáo viên nghỉ mà buổi VẪN học (có người dạy thay) thì không có đường nào trả buổi về — chỉ người nộp đơn tự xin huỷ
// được (`huy-don.ts`), và quản lý cơ sở thì không làm gì được với một buổi đã `CANCELLED`. Nút này cho QLCS tự gỡ.
//
// Việc làm trong MỘT giao dịch, dưới khoá lớp (`khoaLopBuoi` — cùng khoá với mọi đường ghi buổi của T03):
//   1. buổi gốc `CANCELLED` ⇒ `SCHEDULED` (updateMany có điều kiện status + updatedAt);
//   2. buổi bù do chính lượt huỷ sinh ra ⇒ `CANCELLED` (không xoá — vẫn truy ngược được), nếu nó còn SCHEDULED, chưa
//      diễn ra và chưa có dữ liệu nào bám vào; bù đã diễn ra / có dữ liệu thì TỪ CHỐI cả cụm;
//   3. tuỳ chọn: gán giáo viên dạy thay qua `adjustSession` TRONG CÙNG giao dịch (trùng lịch GV/phòng ⇒ throw ⇒ rollback);
//   4. audit `RESTORE_SESSION` + sự kiện `class.session_changed` (RESTORED).
//
// Luật rollback: mọi từ chối là `throw` (trong callback `$transaction`, `return` KHÔNG rollback) và mọi cổng đứng
// TRƯỚC phép ghi đầu tiên.
//
// Đơn nghỉ liên quan KHÔNG bị đổi: giáo viên vẫn nghỉ thật nên đơn giữ `APPROVED`. Hệ quả có chủ đích — `updatedAt` của
// hai buổi đổi nên `huyNghiBuoiDay` (hoàn tác đơn) sẽ từ chối vì "lịch đã bị sửa sau khi duyệt".
import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { duLieuBamVaoBuoi } from "@/lib/cham-cong/don/hoan-tac";
import { adjustSession } from "@/lib/classes/adjust";
import { khiKhoiPhucBuoi } from "@/lib/parttime/tich-hop";
import type { ThongBaoPhanCong } from "@/lib/parttime/phan-cong-db";
import { LoiLichLop, dichLoiTrungBuoi, khoaLopBuoi } from "@/lib/classes/buoi-ghi";
import { laBuoiLopNghi, quyetDinhMoLaiBuoi } from "@/lib/classes/mo-lai-buoi-quyet-dinh";

/** Lỗi nghiệp vụ của "Mở lại buổi" — câu nói được thẳng với người dùng. */
export class LoiMoLaiBuoi extends Error {}

export type KetQuaMoLai =
  | { ok: true; makeupSessionId: string | null; daGoBuoiBu: boolean; canhBao?: string; thongBaoPhanCong: ThongBaoPhanCong[] }
  | { ok: false; error: string };

/** Tìm buổi bù do lượt huỷ sinh ra: dấu audit `CANCEL_SESSION` trước, rồi tới đơn nghỉ đã duyệt (cả hai đều lưu id buổi bù). */
async function timBuoiBu(tx: Prisma.TransactionClient, classId: string, sessionId: string): Promise<string | null> {
  const huy = await tx.auditLog.findFirst({
    where: { entityType: "ClassSession", entityId: sessionId, action: "CANCEL_SESSION" },
    orderBy: { createdAt: "desc" },
    select: { newValues: true },
  });
  const nv = huy?.newValues && typeof huy.newValues === "object" ? (huy.newValues as Record<string, unknown>) : null;
  if (typeof nv?.makeupSessionId === "string") return nv.makeupSessionId;
  const don = await tx.workRequest.findFirst({
    where: { kind: "CLASS_OFF", classId, status: "APPROVED", appliedEffect: { path: ["sessionId"], equals: sessionId } },
    select: { appliedEffect: true },
  });
  const e = don?.appliedEffect && typeof don.appliedEffect === "object" ? (don.appliedEffect as Record<string, unknown>) : null;
  return typeof e?.buoiBu === "string" ? e.buoiBu : null;
}

export async function moLaiBuoi(opts: {
  sessionId: string;
  /** Giáo viên dạy thay (tuỳ chọn). Bỏ trống/null ⇒ không đổi người dạy. */
  teacherId?: string | null;
  actorId: string | null;
  actorName: string;
  now: Date;
  reason?: string;
}): Promise<KetQuaMoLai> {
  const { sessionId, actorId, actorName, now } = opts;
  const teacherId = opts.teacherId || null;
  try {
    return await db.$transaction(async (tx) => {
      const s0 = await tx.classSession.findUnique({ where: { id: sessionId }, select: { classId: true } });
      if (!s0) throw new LoiMoLaiBuoi("Buổi học không tồn tại");
      // Khoá lớp TRƯỚC khi đọc lại — cùng khoá với mọi đường ghi buổi (T03).
      await khoaLopBuoi(tx, s0.classId);

      const s = await tx.classSession.findUnique({
        where: { id: sessionId },
        select: { id: true, classId: true, date: true, status: true, topic: true, updatedAt: true },
      });
      if (!s) throw new LoiMoLaiBuoi("Buổi học không tồn tại");

      const buoiBuId = await timBuoiBu(tx, s.classId, s.id);
      const bu = buoiBuId
        ? await tx.classSession.findFirst({
            where: { id: buoiBuId, classId: s.classId },
            select: { id: true, status: true, date: true, updatedAt: true },
          })
        : null;
      const lopNghi =
        laBuoiLopNghi(s.topic) ||
        // Dấu thứ hai: audit của Class mà `nghiBuoiLop` ghi (oldValues.buoiNghi.id) — phòng khi `topic` đã được sửa tay sau đó.
        (await tx.auditLog.count({
          where: { entityType: "Class", entityId: s.classId, action: "class.update", oldValues: { path: ["buoiNghi", "id"], equals: s.id } },
        })) > 0;
      const duLieuBu = bu && bu.status === "SCHEDULED" ? await duLieuBamVaoBuoi(tx, bu.id) : [];

      const qd = quyetDinhMoLaiBuoi({
        status: s.status,
        date: s.date,
        lopNghi,
        buoiBu: bu ? { id: bu.id, status: bu.status, date: bu.date, duLieu: duLieuBu } : null,
        now,
      });
      if (!qd.ok) throw new LoiMoLaiBuoi(qd.error);

      // Không mở lại vào đúng giờ của một buổi KHÁC còn sống (lớp đã xếp buổi mới vào chỗ đó sau khi huỷ).
      const trung = await tx.classSession.findFirst({
        where: { classId: s.classId, id: { not: s.id }, date: s.date, status: { not: "CANCELLED" } },
        select: { id: true },
      });
      if (trung) throw new LoiLichLop("TRUNG_BUOI", "Lớp đã có một buổi học khác đúng giờ này — không mở lại buổi trùng giờ.");

      // ── Từ đây mới ghi ──
      if (qd.goBuoiBu && bu) {
        const go = await tx.classSession.updateMany({
          where: { id: bu.id, classId: s.classId, status: bu.status as "SCHEDULED", updatedAt: bu.updatedAt },
          data: { status: "CANCELLED" },
        });
        if (go.count !== 1) throw new LoiMoLaiBuoi("Lịch học vừa thay đổi — tải lại rồi thử lại");
      }
      const songLai = await tx.classSession.updateMany({
        where: { id: s.id, status: "CANCELLED", updatedAt: s.updatedAt },
        data: { status: "SCHEDULED" },
      });
      if (songLai.count !== 1) throw new LoiMoLaiBuoi("Lịch học vừa thay đổi — tải lại rồi thử lại");

      // SR.QD.238 — buổi sống lại ⇒ dựng lại phân công mặc định; buổi bù vừa gỡ ⇒ huỷ phân công của nó.
      const thongBaoPhanCong = await khiKhoiPhucBuoi(tx, { sessionId: s.id, buoiBuId: qd.goBuoiBu && bu ? bu.id : null, actor: { id: actorId, name: actorName } });
      let canhBao: string | undefined;
      if (teacherId) {
        const r = await adjustSession({ dongBoPhanCong: true, sessionId: s.id, teacherId, actorId, actorName, tx });
        if (!r.ok) throw new LoiMoLaiBuoi(r.error ?? "Không gán được giáo viên dạy thay");
        canhBao = r.canhBao;
        thongBaoPhanCong.push(...(r.thongBaoPhanCong ?? []));
      }

      const buoiBuSau = bu ? (qd.goBuoiBu ? "CANCELLED" : bu.status) : null;
      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "classes",
        entityType: "ClassSession",
        entityId: s.id,
        action: "RESTORE_SESSION",
        oldValues: { status: "CANCELLED", makeupSessionId: bu?.id ?? null, makeupStatus: bu?.status ?? null },
        newValues: {
          status: "SCHEDULED",
          makeupSessionId: bu?.id ?? null,
          makeupStatus: buoiBuSau,
          ...(teacherId ? { substituteTeacherId: teacherId } : {}),
        },
        reason: opts.reason?.trim() || "Mở lại buổi đã huỷ",
        tx,
      });
      await publishEvent(
        "class.session_changed",
        { classId: s.classId, sessionId: s.id, change: "RESTORED", makeupSessionId: bu?.id ?? null },
        { tx },
      );
      return { ok: true as const, makeupSessionId: bu?.id ?? null, daGoBuoiBu: qd.goBuoiBu, thongBaoPhanCong, ...(canhBao ? { canhBao } : {}) };
    });
  } catch (err) {
    if (err instanceof LoiMoLaiBuoi || err instanceof LoiLichLop) return { ok: false, error: err.message };
    const loi = dichLoiTrungBuoi(err);
    if (loi) return { ok: false, error: loi.message };
    throw err;
  }
}
