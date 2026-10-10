import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { resolveActor } from "@/lib/auth/actor";
import {
  LoiXungDotLich,
  checkScheduleConflicts,
  dungThongDiepXungDot,
  khoaLichTrongTx,
  kiemTrungThaoTacBuoi,
  layHocVienDangHocCuaLop,
  rowsToSlots,
  sessionWindow,
  type KhungYeuCau,
} from "@/lib/lms/schedule-conflict";
import { phamViKiemTrung } from "@/lib/lms/scheduling";
import { vnAddDays, vnYmd } from "@/lib/time/vn";
import { findLockedSessions } from "@/lib/classes/phases-service";
import { LoiLichLop, dauSuaTay, dichLoiTrungBuoi, khoaLopBuoi, themBuoi } from "@/lib/classes/buoi-ghi";

// =============================================================================
// R7-06 — Điều chỉnh buổi học: HỦY buổi (sinh buổi bù cuối lịch, giữ tổng số buổi)
// + CHỈNH buổi (đổi ngày/giáo viên/phòng). Buổi đã COMPLETED bị khoá — không sửa.
// Side-effect (thông báo) đi qua DomainEvent `class.session_changed` (idempotent).
//
// `tx` (đợt 3 đơn từ, 08/10/2026): truyền vào khi phép huỷ/chỉnh là MỘT PHẦN của quyết định lớn
// hơn — duyệt đơn nghỉ dạy / dạy thay. Khi đó hàm KHÔNG mở transaction riêng mà ghi trong giao
// dịch của nơi gọi, nên "đơn APPROVED" và "buổi đã đổi" cùng commit hoặc cùng rollback (BA §14).
// Bỏ trống ⇒ hàm tự mở transaction như cũ (màn lớp học gọi kiểu này).
// =============================================================================

const MAKEUP_GAP_DAYS = 7;

/**
 * PURE — ngày buổi bù: SAU buổi muộn nhất hiện có (mặc định +7 ngày so với max),
 * để "nối thêm 1 buổi ở cuối" giữ nguyên tổng số buổi. existingDates rỗng →
 * +7 ngày so với afterDate.
 */
export function buildMakeupDate(existingDates: Date[], afterDate: Date): Date {
  let latest = afterDate;
  for (const d of existingDates) {
    if (d.getTime() > latest.getTime()) latest = d;
  }
  return vnAddDays(latest, MAKEUP_GAP_DAYS);
}

/**
 * HỦY 1 buổi (status=CANCELLED, KHÔNG xoá) + sinh 1 buổi bù ở cuối lịch (giữ tổng
 * số buổi active). Ghi AuditLog. Buổi đã COMPLETED → không cho huỷ.
 */
export async function cancelSession(opts: {
  sessionId: string;
  reason: string;
  actorId: string | null;
  actorName: string;
  tx?: Prisma.TransactionClient;
  /**
   * Đơn từ sinh ra lượt huỷ này (đợt 11 đơn từ) — ghi lên BUỔI BÙ để huỷ đơn tìm đúng buổi bù của nó.
   * Huỷ buổi từ màn lớp học thì không truyền (null).
   */
  sourceWorkRequestId?: string | null;
}): Promise<{ ok: boolean; makeupSessionId?: string; error?: string }> {
  const { sessionId, reason, actorId, actorName } = opts;
  const client = opts.tx ?? db;
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: "Lý do (reason) là bắt buộc khi huỷ buổi" };
  }

  const session = await client.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      classId: true,
      date: true,
      status: true,
      topic: true,
      lessonId: true,
      planId: true,
      centerId: true,
    },
  });
  if (!session) return { ok: false, error: "Buổi học không tồn tại" };
  if (session.status === "COMPLETED") {
    return { ok: false, error: "Buổi đã hoàn thành — không thể huỷ" };
  }
  if (session.status === "CANCELLED") {
    return { ok: false, error: "Buổi đã bị huỷ trước đó" };
  }

  // 19/08 — KHÔNG huỷ buổi ĐÃ ĐƯỢC DÙNG (đã điểm danh / có nhận xét / đã giao bài / có
  // ảnh lớp). Chặn theo `status` là chưa đủ: điểm danh KHÔNG đổi status buổi (chỉ
  // completeSession đổi, mà nó nằm sau cờ SESSION_LIFECYCLE_V2 đang OFF), nên một buổi đã
  // dạy xong với 20 bản ghi điểm danh vẫn mang nhãn SCHEDULED và huỷ được. Huỷ xong thì
  // buổi đó rơi khỏi mọi phép tính chuyên cần (buổi CANCELLED không tính học, không tính
  // vắng) ⇒ số buổi đã học của cả lớp tụt xuống mà không ai biết vì sao.
  // Dùng chung định nghĩa "buổi đã dùng" với màn đổi lịch (findLockedSessions).
  const lockedCancel = await findLockedSessions(
    [sessionId],
    new Map([[sessionId, session.status]]),
  );
  const cancelReason = lockedCancel.get(sessionId);
  if (cancelReason) {
    return {
      ok: false,
      error: `Buổi ${cancelReason} — không thể huỷ. Sửa dữ liệu của buổi trước, hoặc dời buổi thay vì huỷ.`,
    };
  }

  // F2 — buổi THAY THẾ (bù cuối lịch) cũng phải qua lõi trùng lịch: GV + phòng của lớp (buổi mới không có GV dạy thay / phòng riêng) và học viên
  // đang học của lớp với case dạy bù của chính họ. Lớp/khung giờ đọc ở đây; NGÀY thay thế tính DƯỚI khoá lớp (xem trong transaction).
  const lopCuaBuoi = await db.class.findUnique({
    where: { id: session.classId },
    select: { teacherId: true, roomId: true, startTime: true, endTime: true },
  });

  let result: { makeupSessionId: string };
  try {
    const ghi = async (tx: Prisma.TransactionClient) => {
      // T03: KHOÁ lớp rồi mới quyết. Trước đây các buổi còn lại được đọc NGOÀI giao dịch rồi `update` không điều kiện:
      // bấm "Huỷ" hai lần (hoặc hai buổi cùng lúc) tính cùng một ngày bù ⇒ hai buổi bù trùng ngày.
      await khoaLopBuoi(tx, session.classId);

      // Huỷ CÓ ĐIỀU KIỆN: lượt thứ hai (đã có người huỷ/hoàn tất buổi này) không còn gì để huỷ ⇒ từ chối, không sinh thêm buổi bù.
      const huy = await tx.classSession.updateMany({
        where: { id: sessionId, status: "SCHEDULED" },
        data: { status: "CANCELLED" },
      });
      if (huy.count !== 1) {
        throw new LoiLichLop("BUOI_DA_DOI", "Buổi này vừa được huỷ hoặc hoàn tất bởi người khác — tải lại trang.");
      }

      // Các buổi còn lại của lớp (không tính buổi đang huỷ) để tính ngày buổi bù cuối — đọc DƯỚI khoá.
      const siblings = await tx.classSession.findMany({
        where: { classId: session.classId, id: { not: sessionId }, status: { not: "CANCELLED" } },
        select: { date: true },
      });
      const makeupDate = buildMakeupDate(
        siblings.map((s) => s.date),
        session.date,
      );

      // F2 — KIỂM trước khi tạo: ứng viên thay thế → GV → phòng → học viên → `checkScheduleConflicts`, trong CHÍNH transaction và dưới khoá lớp. Trùng ⇒
      // ném ⇒ toàn bộ rollback (buổi cũ KHÔNG bị huỷ, không có buổi thay thế, không audit/sự kiện). Trước đây: huỷ cũ → tạo thay thế → checker phát hiện sau.
      if (lopCuaBuoi?.startTime) {
        const hocVien = await layHocVienDangHocCuaLop(tx, session.classId);
        const khung: KhungYeuCau = sessionWindow(makeupDate, lopCuaBuoi.startTime, lopCuaBuoi.endTime);
        const tham = { khung, teacherId: lopCuaBuoi.teacherId, roomId: lopCuaBuoi.roomId, studentIds: hocVien };
        if (tham.teacherId || tham.roomId || hocVien.length > 0) {
          await khoaLichTrongTx(tx, tham);
          const kq = await checkScheduleConflicts(
            { ...tham, nguonHocVien: ["MAKEUP_CASE"], exclude: [{ type: "CLASS", id: session.classId }] },
            tx,
          );
          if (kq.coXungDot) throw new LoiXungDotLich("", kq, { buoiThayThe: makeupDate });
        }
      }

      // Buổi bù do HỆ THỐNG nối thêm — không phải buổi chỉnh tay (suaTay = null).
      const makeup = await themBuoi(
        tx,
        {
          classId: session.classId,
          date: makeupDate,
          topic: session.topic,
          lessonId: session.lessonId,
          planId: session.planId,
          centerId: session.centerId, // FL3-02 — denormalize từ buổi gốc/lớp cho scopedDb
          status: "SCHEDULED",
          // Đơn từ sinh ra lượt huỷ này (đợt 11 đơn từ) — để huỷ đơn tìm đúng buổi bù của nó.
          sourceWorkRequestId: opts.sourceWorkRequestId ?? null,
        },
        null,
      );

      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "classes",
        entityType: "ClassSession",
        entityId: sessionId,
        action: "CANCEL_SESSION",
        oldValues: { status: session.status, date: session.date },
        newValues: { status: "CANCELLED", makeupSessionId: makeup.id, makeupDate },
        reason,
        tx,
      });

      await publishEvent(
        "class.session_changed",
        {
          classId: session.classId,
          sessionId,
          change: "CANCELLED",
          makeupSessionId: makeup.id,
        },
        { tx },
      );

      return { makeupSessionId: makeup.id };
    };
    // `tx` của nơi gọi (đơn nghỉ dạy / dạy thay duyệt trong MỘT giao dịch): ghi cùng giao dịch ấy, không mở cái riêng.
    result = opts.tx ? await ghi(opts.tx) : await db.$transaction(ghi);
  } catch (err) {
    if (err instanceof LoiXungDotLich) {
      const actor = actorId ? await resolveActor(actorId).catch(() => undefined) : undefined;
      const cau = await dungThongDiepXungDot(err.ketQua, { actor });
      const ngay = err.boiCanh.buoiThayThe ? vnYmd(err.boiCanh.buoiThayThe).split("-").reverse().join("/") : "";
      return {
        ok: false,
        error: `Không huỷ được buổi vì buổi thay thế (bù cuối lịch${ngay ? `, ngày ${ngay}` : ""}) bị trùng lịch — ${cau.join(" ")} Xử lý trùng lịch (hoặc dời buổi thay vì huỷ) rồi huỷ lại.`,
      };
    }
    // Có `tx` của người gọi: lỗi CSDL (vd. P2002) đã làm hỏng giao dịch ấy ⇒ ném lên để họ rollback; chỉ lỗi nghiệp vụ thuần mới trả `ok:false`.
    if (opts.tx && !(err instanceof LoiLichLop)) throw err;
    const loi = dichLoiTrungBuoi(err);
    if (loi) return { ok: false, error: loi.message };
    throw err;
  }

  return { ok: true, makeupSessionId: result.makeupSessionId };
}

/**
 * CHỈNH 1 buổi: đổi ngày (+ giáo viên/phòng). Buổi COMPLETED → khoá.
 * ⚠️ Schema: ClassSession có cột `roomId` (W2-4b) nhưng KHÔNG có cột teacherId.
 * → date + roomId được ghi thẳng vào buổi; teacherId vẫn ghi AuditLog làm yêu cầu
 *   thay-thế GV cấp buổi (substitute) cho tới khi có cột riêng (ngoài scope).
 */
export async function adjustSession(opts: {
  sessionId: string;
  date?: Date;
  teacherId?: string | null;
  roomId?: string | null;
  actorId: string | null;
  actorName: string;
  tx?: Prisma.TransactionClient;
}): Promise<{ ok: boolean; error?: string; canhBao?: string }> {
  const { sessionId, date, teacherId, roomId, actorId, actorName } = opts;
  const client = opts.tx ?? db;

  const session = await client.classSession.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      classId: true,
      date: true,
      status: true,
      roomId: true,
      actualRoomId: true,
      actualTeacherId: true,
      substituteRoomId: true,
      substituteTeacherId: true,
    },
  });
  if (!session) return { ok: false, error: "Buổi học không tồn tại" };
  if (session.status === "COMPLETED") {
    return { ok: false, error: "Buổi đã hoàn thành — không thể chỉnh" };
  }

  const hasDate = date !== undefined;
  const hasTeacher = teacherId !== undefined;
  const hasRoom = roomId !== undefined;
  if (!hasDate && !hasTeacher && !hasRoom) {
    return { ok: false, error: "Không có thay đổi nào" };
  }

  // 19/08 — DỜI NGÀY một buổi đã được dùng là VIẾT LẠI LỊCH SỬ: điểm danh ngày 05/08 bỗng
  // hiện thành 12/08, phiếu nhận xét và ảnh lớp đi theo. Màn đổi lịch theo giai đoạn đã
  // chặn bằng findLockedSessions từ lâu, riêng đường "Điều chỉnh" từng buổi thì quên.
  // Chỉ chặn khi ĐỔI NGÀY — đổi GV dạy thay / phòng vẫn cho, đó là ghi nhận thực tế.
  if (hasDate && date.getTime() !== session.date.getTime()) {
    const locked = await findLockedSessions(
      [sessionId],
      new Map([[sessionId, session.status]]),
    );
    const reason = locked.get(sessionId);
    if (reason) {
      return { ok: false, error: `Buổi ${reason} — không thể dời ngày.` };
    }
  }

  // W2-4 (LMS-6) / T4.2 — chặn đổi buổi gây trùng GV/phòng với LỚP KHÁC.
  // Phòng/GV hiệu lực TRƯỚC và SAU thao tác tính bằng CÙNG luật với buổi đối chiếu
  // (`rowsToSlots`: substitute ?? actual ?? cấp buổi ?? lớp). Chỉ CHẶN vì thứ thao tác này
  // làm đổi (09/10/2026 — duyệt "Dạy thay" từng bị chặn vì trùng phòng CÓ SẴN của buổi;
  // xem `phamViKiemTrung`). Thiếu dữ liệu (lớp chưa có startTime) → KHÔNG chặn.
  const cls = await client.class.findUnique({
    where: { id: session.classId },
    select: { teacherId: true, roomId: true, startTime: true, endTime: true },
  });
  let canhBao: string | undefined;
  // T09 — việc KIỂM trùng chuyển vào transaction (dưới khoá hẹp GV/phòng × ngày), qua lõi đa nguồn: nay lớp chính cũng thấy case dạy bù và
  // buổi lớp trial (HB-28). Ở đây chỉ dựng THAM SỐ kiểm.
  let kiemLich: { khung: KhungYeuCau; teacherId: string | null; roomId: string | null; hocVien: boolean } | null = null;
  if (cls?.startTime) {
    const [truoc] = rowsToSlots([{ ...session, class: cls }]);
    const [sau] = rowsToSlots([
      {
        ...session,
        roomId: hasRoom ? roomId ?? null : session.roomId,
        substituteTeacherId: hasTeacher ? teacherId ?? null : session.substituteTeacherId,
        class: cls,
      },
    ]);
    const candDate = hasDate ? date! : session.date;
    // Mốc đầu PHẢI áp giờ lớp. Bản cũ truyền `candDate` thô (thường 00:00 vì ô chọn
    // ngày không kèm giờ) trong khi mốc cuối lại áp giờ ⇒ khung kéo dài bất thường
    // (vd 00:00 → 19:30) và đè lên mọi buổi khác trong ngày. Cùng họ lỗi với
    // sessionWindow — xem ghi chú ở lib/lms/schedule-conflict.ts.
    const khung = sessionWindow(candDate, cls.startTime, cls.endTime);
    const doiGio = hasDate && date!.getTime() !== session.date.getTime();
    const taiNguyenTruoc = { roomId: truoc!.roomId ?? null, teacherId: truoc!.teacherId ?? null };
    const taiNguyenSau = { roomId: sau!.roomId ?? null, teacherId: sau!.teacherId ?? null };
    // Cảnh báo trùng CÓ SẴN (thao tác không đổi nó) — chỉ lấy `canhBao`: việc CHẶN nằm trong transaction bên dưới, dưới khoá hẹp.
    const kq = await kiemTrungThaoTacBuoi({
      sessionId,
      classId: session.classId,
      truoc: taiNguyenTruoc,
      sau: taiNguyenSau,
      doiGio,
      startAt: khung.startAt,
      endAt: khung.endAt,
    });
    canhBao = kq.canhBao ?? undefined;
    // Chỉ CHẶN vì thứ thao tác này làm đổi (09/10/2026 — xem `phamViKiemTrung`); soát TOÀN HỆ THỐNG (không lọc cơ sở): GV có thể dạy 2 cơ sở.
    const pv = phamViKiemTrung({ truoc: taiNguyenTruoc, sau: taiNguyenSau, doiGio });
    const teacherChan = pv.chanGv ? taiNguyenSau.teacherId : null;
    const roomChan = pv.chanPhong ? taiNguyenSau.roomId : null;
    // Học viên của lớp chỉ kiểm khi ĐỔI NGÀY (đổi GV dạy thay / phòng không dời giờ học của bé) — T09-F1.
    if (teacherChan || roomChan || hasDate) {
      kiemLich = { khung: { startAt: khung.startAt, endAt: khung.endAt }, teacherId: teacherChan, roomId: roomChan, hocVien: hasDate };
    }
  }

  const oldValues: Record<string, unknown> = { date: session.date };
  const newValues: Record<string, unknown> = {};
  if (hasDate) newValues.date = date;
  // teacherId (P4b reconcile): GV dạy-thay cấp buổi nay PERSIST vào cột
  // ClassSession.substituteTeacherId (cột đã có ở FixLMS lineage), không chỉ audit.
  // GV hiệu lực cho conflict detection ở trên đã xét substitute. null = trả về GV lớp.
  if (hasTeacher) newValues.substituteTeacherId = teacherId;
  // roomId (W2-4b): có cột cấp buổi → ghi thẳng vào ClassSession.roomId.
  if (hasRoom) {
    oldValues.roomId = session.roomId;
    newValues.roomId = roomId ?? null;
  }

  // Đổi NGÀY thật sự (khác ngày cũ) là "chỉnh tay": buổi mang dấu để các lần áp lại lịch tự động không kéo nó đi.
  // Đổi phòng / GV dạy thay KHÔNG đặt dấu: không đường tự động nào đụng tới hai thứ đó, nên ghim ngày chỉ làm buổi
  // đứng yên trên ngày nghỉ một cách khó hiểu.
  const doiNgayThat = hasDate && date!.getTime() !== session.date.getTime();

  try {
    const ghiBuoi = async (tx: Prisma.TransactionClient) => {
      if (kiemLich) {
        const { hocVien: kiemHocVien, ...tham } = kiemLich;
        const studentIds = kiemHocVien ? await layHocVienDangHocCuaLop(tx, session.classId) : [];
        await khoaLichTrongTx(tx, { ...tham, studentIds });
        const kq = await checkScheduleConflicts(
          { ...tham, studentIds, nguonHocVien: ["MAKEUP_CASE"], exclude: [{ type: "CLASS", id: session.classId }] },
          tx,
        );
        if (kq.coXungDot) throw new LoiXungDotLich("", kq);
      }
      if (hasDate || hasRoom || hasTeacher) {
        if (doiNgayThat) {
          // T03: khoá lớp + kiểm DƯỚI khoá — không dời vào đúng giờ của một buổi còn sống khác; không đè lượt vừa sửa xen giữa.
          await khoaLopBuoi(tx, session.classId);
          const trung = await tx.classSession.findFirst({
            where: { classId: session.classId, id: { not: sessionId }, date: date!, status: { not: "CANCELLED" } },
            select: { id: true },
          });
          if (trung) throw new LoiLichLop("TRUNG_BUOI", "Lớp đã có một buổi học vào đúng giờ này — chọn giờ khác hoặc dời buổi kia trước.");
          const ghi = await tx.classSession.updateMany({
            where: { id: sessionId, date: session.date, status: session.status },
            data: {
              date: date!,
              ...(hasRoom ? { roomId: roomId ?? null } : {}),
              ...(hasTeacher ? { substituteTeacherId: teacherId ?? null } : {}),
              ...dauSuaTay(actorId, new Date()),
            },
          });
          if (ghi.count !== 1) throw new LoiLichLop("BUOI_DA_DOI", "Buổi vừa được người khác sửa — tải lại trang rồi làm lại.");
        } else {
          await tx.classSession.update({
            where: { id: sessionId },
            data: {
              ...(hasRoom ? { roomId: roomId ?? null } : {}),
              ...(hasTeacher ? { substituteTeacherId: teacherId ?? null } : {}),
            },
          });
        }
      }

      await writeAudit({
        actor: { id: actorId, name: actorName },
        module: "classes",
        entityType: "ClassSession",
        entityId: sessionId,
        action: "ADJUST_SESSION",
        oldValues,
        newValues,
        tx,
      });

      await publishEvent(
        "class.session_changed",
        {
          classId: session.classId,
          sessionId,
          change: "ADJUSTED",
          fields: Object.keys(newValues),
        },
        { tx },
      );
    };
    if (opts.tx) await ghiBuoi(opts.tx);
    else await db.$transaction(ghiBuoi);
  } catch (err) {
    if (err instanceof LoiXungDotLich) {
      // Câu nói CỤ THỂ từng trùng ("GV Nguyễn A đang có lớp Robotics 6A từ 18:00–19:30."), dựng NGOÀI transaction. Nguồn ở cơ sở người
      // sửa không đọc được thì chỉ nói loại việc (xem `dungThongDiepXungDot`).
      const actor = actorId ? await resolveActor(actorId).catch(() => undefined) : undefined;
      const cau = await dungThongDiepXungDot(err.ketQua, { actor });
      return { ok: false, error: `Trùng lịch — ${cau.join(" ")}` };
    }
    if (opts.tx && !(err instanceof LoiLichLop)) throw err;
    const loi = dichLoiTrungBuoi(err);
    if (loi) return { ok: false, error: loi.message };
    throw err;
  }

  return { ok: true, ...(canhBao ? { canhBao } : {}) };
}
