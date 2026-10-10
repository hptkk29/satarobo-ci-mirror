// lib/cham-cong/don/hoan-tac.ts — HOÀN TÁC hệ quả của một đơn ĐÃ DUYỆT khi quản lý duyệt HUỶ (đợt 11
// đơn từ, BA §15). MỘT handler cho MỖI loại — `Record<WorkRequestKindV, …>` ⇒ thêm loại đơn mà quên khai
// cách hoàn tác là LỖI BIÊN DỊCH, không phải một nhánh im lặng "huỷ mà không hoàn tác gì".
//
// Luật chung:
//   · Chạy TRONG giao dịch của lượt duyệt huỷ (`huy-don.ts`); từ chối = `throw new DecideError` ⇒ rollback
//     cả cụm, đơn giữ CANCEL_REQUESTED (luật rollback — `return` không rollback).
//   · Chỉ hoàn tác đúng thứ ĐƠN NÀY đã làm, đọc từ ảnh chụp `appliedEffect` lúc duyệt. Thứ đã bị người
//     khác sửa sau đó (ô ca bị xếp lại, lượt quét bị ghi đè lần nữa) ⇒ TỪ CHỐI, không đè lên việc của họ.
//   · Ảnh chụp thiếu (đơn duyệt trước khi có ảnh chụp đó) ⇒ TỪ CHỐI kèm lời chỉ đường — không dựng lại
//     "đơn này hồi đó đã làm gì" bằng phỏng đoán.
//   · Đơn chỉ tác động qua NGỮ CẢNH (muộn/sớm, OT, từ xa, công tác, nghỉ một phần, làm ngày nghỉ, chấm
//     ngoài): không có gì trên lưới để gỡ — đổi trạng thái là ngữ cảnh tự rơi; chỉ đánh dấu tính lại.
//   · Không xoá cứng bất kỳ dữ liệu chấm công gốc nào: ô ca và lượt quét chỉ đổi trạng thái.
import type { Prisma, SessionStatus, TimeLogReviewStatus } from "@prisma/client";
import { findLockedSessions } from "@/lib/classes/phases-service";
import { dichLoiTrungBuoi, khoaLopBuoi } from "@/lib/classes/buoi-ghi";
import { adjustSession } from "@/lib/classes/adjust";
import { writeAudit } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { vnDateOnly, vnYmd } from "@/lib/time/vn";
import type { WorkRequestKindV } from "@/lib/work-request";
import { nhanPhut } from "../dong-phut-don";
import { khoaNguonNgay, khoaQuyNghiBu, NGUON_QUY, soDuNghiBu } from "../nghi-bu";
import { khoaOTrongTx } from "../ghi-o";
import { markAttendanceDayDirty } from "../recompute";
import { DecideError, HREF_DON_CUA_TOI, type DecideNotify, type DonCanDuyet, type ODaThay } from "./kieu";
import { laNghiMotPhan } from "./nghi-mot-phan";

export type DonCanHuy = DonCanDuyet & { appliedEffect: unknown };

export type NguCanhHoanTac = {
  tx: Prisma.TransactionClient;
  don: DonCanHuy;
  actor: { id: string; name: string };
  now: Date;
  canWriteCenter: (centerId: string) => boolean;
  dateLabel: string;
};

export type KetQuaHoanTac = {
  messages: string[];
  /** Người bị ảnh hưởng NGOÀI người nộp (người nhận ca, người làm thay…) — báo thêm. */
  notify: DecideNotify[];
  /** Ảnh chụp những gì đã hoàn tác — vào `cancelEffect` + audit. */
  hieuQua: Record<string, unknown>;
};

export type HoanTacDon = (ctx: NguCanhHoanTac) => Promise<KetQuaHoanTac>;

const MOT_NGAY = 86_400_000;

/** Đơn duyệt trước khi có ảnh chụp cần cho việc hoàn tác — câu từ chối chung. */
const THIEU_ANH_CHUP =
  "Đơn này được duyệt trước khi hệ thống lưu đủ dữ liệu để tự hoàn tác — từ chối yêu cầu huỷ rồi sửa trực tiếp trên lịch ca / bảng công";

function hq(don: DonCanHuy): Record<string, unknown> {
  return don.appliedEffect && typeof don.appliedEffect === "object" ? (don.appliedEffect as Record<string, unknown>) : {};
}

/** Đánh dấu tính lại MỌI ngày của đơn (người nộp, và người phụ nếu truyền). */
async function tinhLaiCacNgay(tx: Prisma.TransactionClient, don: DonCanHuy, userIds: readonly string[] = [don.requesterId]) {
  if (!don.fromDate) return 0;
  const den = don.toDate ?? don.fromDate;
  let n = 0;
  for (let d = new Date(don.fromDate); d <= den; d = new Date(d.getTime() + MOT_NGAY)) {
    for (const u of userIds) await markAttendanceDayDirty(u, d, { tx, reason: "CANCEL_REQUEST" });
    n += 1;
  }
  return n;
}

/** Đơn chỉ tác động qua ngữ cảnh: đổi trạng thái là đủ — chỉ đánh dấu tính lại. */
const chiTinhLai: HoanTacDon = async ({ tx, don, dateLabel }) => {
  const soNgay = await tinhLaiCacNgay(tx, don);
  return {
    messages: [`Đơn không còn hiệu lực từ ${dateLabel}${soNgay > 1 ? ` (${soNgay} ngày)` : ""} — tính lại công các ngày đó`],
    notify: [],
    hieuQua: { tinhLai: soNgay },
  };
};

/**
 * OT / làm ngày nghỉ từng cộng quỹ nghỉ bù ⇒ huỷ sẽ làm lần tính lại sau ghi dòng ÂM. Nếu người đó đã
 * NGHỈ BÙ bằng chính phần đó, quỹ sẽ âm — chặn trước, dưới khoá theo người (cùng khoá đường dùng quỹ).
 */
async function chanQuyAm(tx: Prisma.TransactionClient, don: DonCanHuy, nguon: string) {
  if (!don.fromDate) return;
  const r = await tx.compTimeLedger.aggregate({
    where: { userId: don.requesterId, sourceType: nguon, sourceId: khoaNguonNgay(don.requesterId, don.fromDate) },
    _sum: { minutes: true },
  });
  const daCong = r._sum.minutes ?? 0;
  if (daCong <= 0) return;
  await khoaQuyNghiBu(tx, don.requesterId);
  const soDu = await soDuNghiBu(tx, don.requesterId);
  if (soDu - daCong < 0) {
    throw new DecideError(
      `Đơn này đã cộng ${nhanPhut(daCong)} vào quỹ nghỉ bù và người nộp đã dùng phần đó (quỹ còn ${nhanPhut(Math.max(0, soDu))}) — huỷ sẽ làm quỹ âm. Huỷ đơn nghỉ bù tương ứng trước.`,
    );
  }
}

const huyTangCaHoacLamNgayNghi =
  (nguon: string): HoanTacDon =>
  async (ctx) => {
    await chanQuyAm(ctx.tx, ctx.don, nguon);
    const kq = await chiTinhLai(ctx);
    return { ...kq, messages: [...kq.messages, "Phần quỹ nghỉ bù đã cộng từ đơn (nếu có) được trừ lại khi tính lại công"] };
  };

/** Ô ca: khôi phục ô cũ, huỷ ô đơn tạo — chỉ khi ô của đơn VẪN là ô đang dùng của ngày đó. */
async function traLaiO(ctx: NguCanhHoanTac, danhSach: ODaThay[]) {
  const { tx, canWriteCenter } = ctx;
  const ghi: { userId: string; ngay: string; khoiPhuc: string | null }[] = [];
  for (const o of danhSach) {
    const ngay = new Date(o.workDate);
    const nhan = vnYmd(new Date(ngay.getTime() + 12 * 3_600_000));
    // T04: cùng khoá (người, tháng) với `chayLenhO` — hoàn tác không được chen ngang một lượt ghi ô đang chạy (đọc-rồi-ghi không khoá ⇒ hai ô ACTIVE / ô mất).
    await khoaOTrongTx(tx, o.userId, ngay);
    const dangDung = await tx.shiftAssignment.findFirst({
      where: { userId: o.userId, workDate: ngay, status: "ACTIVE" },
      select: { id: true, centerId: true },
    });
    if (!dangDung || dangDung.id !== o.sauId) {
      throw new DecideError(`Lịch ca ngày ${nhan} đã được sửa sau khi duyệt đơn — không tự hoàn tác được, xếp lại ca trực tiếp trên lưới rồi từ chối yêu cầu huỷ`);
    }
    if (!canWriteCenter(dangDung.centerId)) throw new DecideError(`Không có quyền sửa ca ngày ${nhan} ở cơ sở này`);
    // Huỷ ô của đơn TRƯỚC — chỉ mục "mỗi người mỗi ngày một ô ACTIVE" không cho hai ô cùng sống.
    const huy = await tx.shiftAssignment.updateMany({ where: { id: o.sauId, status: "ACTIVE" }, data: { status: "CANCELLED", note: "Huỷ theo yêu cầu huỷ đơn" } });
    if (huy.count !== 1) throw new DecideError(`Lịch ca ngày ${nhan} vừa thay đổi — tải lại rồi thử lại`);
    if (o.truocId) {
      const cu = await tx.shiftAssignment.findUnique({ where: { id: o.truocId }, select: { status: true, centerId: true } });
      if (!cu || cu.status !== "CANCELLED") throw new DecideError(`Ô ca cũ ngày ${nhan} không còn để khôi phục — xếp lại trực tiếp trên lưới`);
      if (!canWriteCenter(cu.centerId)) throw new DecideError(`Không có quyền khôi phục ca ngày ${nhan} ở cơ sở này`);
      await tx.shiftAssignment.update({ where: { id: o.truocId }, data: { status: "ACTIVE" } });
    }
    await markAttendanceDayDirty(o.userId, ngay, { tx, reason: "CANCEL_REQUEST" });
    ghi.push({ userId: o.userId, ngay: nhan, khoiPhuc: o.truocId });
  }
  return ghi;
}

function docO(don: DonCanHuy): ODaThay[] | null {
  const o = hq(don).o;
  if (!Array.isArray(o)) return null;
  return o.filter(
    (x): x is ODaThay =>
      !!x && typeof x === "object" && typeof (x as ODaThay).userId === "string" && typeof (x as ODaThay).sauId === "string" && typeof (x as ODaThay).workDate === "string",
  );
}

const huyODaThay: HoanTacDon = async (ctx) => {
  const o = docO(ctx.don);
  if (o === null) throw new DecideError(THIEU_ANH_CHUP);
  const ghi = await traLaiO(ctx, o);
  const notify: DecideNotify[] = [];
  for (const u of new Set(ghi.map((g) => g.userId))) {
    if (u === ctx.don.requesterId) continue;
    notify.push({
      userId: u,
      title: `Lịch ca ${ctx.dateLabel} trở lại như trước`,
      body: `${ctx.actor.name} đã duyệt huỷ một đơn có xếp ca cho bạn — ca của bạn ngày này quay về như trước khi đơn được duyệt.`,
      href: "/cham-cong/lich-ca",
    });
  }
  return {
    messages: [ghi.length ? `Khôi phục lịch ca ${ghi.length} ô (${[...new Set(ghi.map((g) => g.ngay))].join(", ")})` : "Lịch ca không có ô nào do đơn này đổi"],
    notify,
    hieuQua: { o: ghi },
  };
};

const huyNghiPhep: HoanTacDon = async (ctx) => (laNghiMotPhan(ctx.don) ? chiTinhLai(ctx) : huyODaThay(ctx));

const huyChinhCong: HoanTacDon = async ({ tx, don, actor, now, dateLabel }) => {
  const e = hq(don);
  const soDongMoi = typeof e.soDongMoi === "number" ? e.soDongMoi : null;
  const thayThe = Array.isArray(e.thayThe) ? (e.thayThe as { id: string; reviewStatus: string; reviewNote: string | null; reviewedById: string | null; reviewedAt: string | null }[]) : null;
  if (soDongMoi === null || thayThe === null || !don.fromDate) throw new DecideError(THIEU_ANH_CHUP);
  // Cùng khoá với `ghiDongChinhTay` — không chen giữa một lượt sửa giờ khác của cùng ngày.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chinh-tay:${don.requesterId}:${don.fromDate.toISOString().slice(0, 10)}`})::bigint)`;
  const dongCuaDon = await tx.staffTimeLog.findMany({
    where: { adjustRequestId: don.id, reviewStatus: { not: "DISMISSED" } },
    select: { id: true },
  });
  if (dongCuaDon.length !== soDongMoi) {
    throw new DecideError(`Giờ chấm công ngày ${dateLabel} đã được sửa lại sau khi duyệt đơn — không tự hoàn tác được, sửa trực tiếp trên bảng công rồi từ chối yêu cầu huỷ`);
  }
  if (thayThe.length) {
    const conBiThay = await tx.staffTimeLog.count({ where: { id: { in: thayThe.map((l) => l.id) }, reviewStatus: "DISMISSED" } });
    if (conBiThay !== thayThe.length) throw new DecideError(`Các lượt quét cũ ngày ${dateLabel} đã thay đổi sau khi duyệt đơn — sửa trực tiếp trên bảng công`);
  }
  // Mốc chỉnh tay của đơn: KHÔNG xoá — thôi tính (DISMISSED) kèm căn cứ, như mọi lượt bị thay.
  await tx.staffTimeLog.updateMany({
    where: { id: { in: dongCuaDon.map((l) => l.id) } },
    data: { reviewStatus: "DISMISSED", reviewedById: actor.id, reviewedAt: now, reviewNote: `Thôi tính — đơn chỉnh công ${dateLabel} đã được huỷ` },
  });
  // Lượt bị đơn thay ⇒ về ĐÚNG trạng thái / ghi chú trước khi bị thay.
  for (const l of thayThe) {
    await tx.staffTimeLog.update({
      where: { id: l.id },
      data: {
        reviewStatus: l.reviewStatus as TimeLogReviewStatus,
        reviewNote: l.reviewNote,
        reviewedById: l.reviewedById,
        reviewedAt: l.reviewedAt ? new Date(l.reviewedAt) : null,
      },
    });
  }
  await markAttendanceDayDirty(don.requesterId, don.fromDate, { tx, reason: "CANCEL_REQUEST" });
  return {
    messages: [`Thôi tính ${dongCuaDon.length} mốc chỉnh tay của đơn${thayThe.length ? `, khôi phục ${thayThe.length} lượt quét cũ` : ""} — tính lại công ${dateLabel}`],
    notify: [],
    hieuQua: { thoiTinh: dongCuaDon.map((l) => l.id), khoiPhuc: thayThe.map((l) => l.id) },
  };
};

const huyNghiBu: HoanTacDon = async ({ tx, don, actor, dateLabel }) => {
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  // Số hoàn = ĐÚNG dòng trừ của đơn này (không tính lại theo ca hôm nay — ca có thể đã đổi).
  const tru = await tx.compTimeLedger.findUnique({ where: { khoa: `${NGUON_QUY.NGHI_BU}:${don.id}` }, select: { minutes: true, centerId: true, orgUnitId: true } });
  let hoan = 0;
  if (tru && tru.minutes < 0) {
    hoan = -tru.minutes;
    await khoaQuyNghiBu(tx, don.requesterId);
    await tx.compTimeLedger.create({
      data: {
        userId: don.requesterId,
        centerId: tru.centerId,
        orgUnitId: tru.orgUnitId,
        minutes: hoan,
        sourceType: NGUON_QUY.HOAN_NGHI_BU,
        sourceId: don.id,
        workDate: don.fromDate,
        // UNIQUE — duyệt huỷ lặp / thử lại không hoàn hai lần.
        khoa: `${NGUON_QUY.HOAN_NGHI_BU}:${don.id}`,
        note: `Hoàn do huỷ đơn nghỉ bù ${dateLabel}`,
        createdById: actor.id,
      },
    });
  }
  await markAttendanceDayDirty(don.requesterId, don.fromDate, { tx, reason: "CANCEL_REQUEST" });
  return {
    messages: [hoan ? `Hoàn ${nhanPhut(hoan)} vào quỹ nghỉ bù; ngày ${dateLabel} lại phải chấm công như thường` : `Ngày ${dateLabel} lại phải chấm công như thường`],
    notify: [],
    hieuQua: { hoanPhut: hoan },
  };
};

const huyDayThay: HoanTacDon = async ({ tx, don, actor, now, dateLabel }) => {
  const e = hq(don);
  const sessionId = typeof e.sessionId === "string" ? e.sessionId : null;
  const gv = e.gvDayThay as { truoc?: string | null; sau?: string | null } | undefined;
  if (!sessionId || !gv || typeof gv.sau !== "string") throw new DecideError(THIEU_ANH_CHUP);
  const buoi = await tx.classSession.findUnique({ where: { id: sessionId }, select: { id: true, date: true, status: true, substituteTeacherId: true } });
  if (!buoi) throw new DecideError("Buổi học của đơn không còn — xử lý trên màn lớp học");
  if (buoi.substituteTeacherId !== gv.sau) throw new DecideError("Giáo viên dạy thay của buổi đã được đổi sau khi duyệt đơn — xử lý trên màn lớp học");
  // Buổi đã diễn ra / đã dùng (điểm danh, nhận xét, bài tập, ảnh) ⇒ dạy thay đã là sự thật, không gỡ.
  if (buoi.date < vnDateOnly(now)) throw new DecideError(`Buổi ${dateLabel} đã qua — giáo viên dạy thay đã dạy, không huỷ được`);
  const khoa = await findLockedSessions([buoi.id], new Map([[buoi.id, buoi.status]]));
  if (khoa.has(buoi.id)) throw new DecideError(`Buổi ${dateLabel} đã ${khoa.get(buoi.id)} — không gỡ giáo viên dạy thay được`);
  const r = await adjustSession({ sessionId, teacherId: gv.truoc ?? null, actorId: actor.id, actorName: actor.name, tx });
  if (!r.ok) throw new DecideError(r.error ?? "Không trả lại giáo viên cho buổi học được — xử lý trên màn lớp học");
  return {
    messages: ["Gỡ giáo viên dạy thay khỏi buổi học, trả buổi về như trước khi duyệt"],
    notify: [
      {
        userId: gv.sau,
        title: `Buổi dạy thay ${dateLabel} đã được huỷ`,
        body: `${actor.name} đã duyệt huỷ đơn dạy thay — bạn không còn dạy buổi này.`,
        href: "/lich",
      },
    ],
    hieuQua: { sessionId, gvDayThay: { truoc: gv.sau, sau: gv.truoc ?? null } },
  };
};

/**
 * Số dòng dữ liệu nghiệp vụ đang bám vào một buổi học — buổi BÙ có bất kỳ dòng nào thì đã "phát sinh
 * dữ liệu", gỡ nó là xoá dấu vết của việc đã xảy ra. Đọc TRONG giao dịch (cùng ảnh với phép ghi).
 * Phủ mọi bảng trỏ tới buổi học, kể cả cột phẳng không FK (`Attendance.makeupSessionId`, `MakeupNeed`).
 */
async function duLieuBamVaoBuoi(tx: Prisma.TransactionClient, sessionId: string): Promise<string[]> {
  const dem: [string, Promise<number>][] = [
    ["điểm danh", tx.attendance.count({ where: { OR: [{ sessionId }, { makeupSessionId: sessionId }] } })],
    ["nhận xét", tx.studentSessionFeedback.count({ where: { classSessionId: sessionId } })],
    ["bài tập về nhà", tx.homeworkAssignment.count({ where: { classSessionId: sessionId } })],
    ["bài tập", tx.assignment.count({ where: { classSessionId: sessionId } })],
    ["ảnh lớp", tx.classSessionMedia.count({ where: { classSessionId: sessionId } })],
    ["ảnh / video", tx.mediaAsset.count({ where: { classSessionId: sessionId } })],
    ["duyệt ảnh", tx.sessionMediaReview.count({ where: { classSessionId: sessionId } })],
    ["đánh giá kỹ năng", tx.studentSkillAssessment.count({ where: { classSessionId: sessionId } })],
    ["phiếu đánh giá", tx.evalResponse.count({ where: { classSessionId: sessionId } })],
    ["học bù xếp vào", tx.makeupNeed.count({ where: { makeupSessionId: sessionId } })],
    ["yêu cầu phụ huynh", tx.parentRequest.count({ where: { sessionId } })],
    ["bài giảng SCORM", tx.scormAttempt.count({ where: { classSessionId: sessionId } })],
  ];
  const so = await Promise.all(dem.map(([, p]) => p));
  return dem.filter((_, i) => so[i]! > 0).map(([ten]) => ten);
}

type PhienBuoi = { ngay: string; capNhat: string; trangThai: string };

function docPhienBan(e: Record<string, unknown>): { goc: PhienBuoi; bu: PhienBuoi | null } | null {
  const p = e.phienBan as { goc?: PhienBuoi; bu?: PhienBuoi | null } | undefined;
  if (!p || !p.goc || typeof p.goc.capNhat !== "string" || typeof p.goc.ngay !== "string") return null;
  return { goc: p.goc, bu: p.bu && typeof p.bu.capNhat === "string" ? p.bu : null };
}

/**
 * Huỷ đơn "Nghỉ buổi dạy" đã duyệt: buổi gốc SỐNG LẠI, buổi bù do CHÍNH đơn sinh ra bị gỡ (đổi sang
 * CANCELLED — không xoá cứng, vẫn mang `sourceWorkRequestId` để truy ngược). Chỉ khi cả hai buổi còn
 * ĐÚNG phiên bản chụp lúc duyệt, buổi bù chưa diễn ra, chưa phát sinh dữ liệu nào, và buổi gốc chưa qua.
 * Mọi phép ghi là `updateMany` CÓ ĐIỀU KIỆN (id + trạng thái + `updatedAt`) — thử lại / chạy chồng không
 * khôi phục hai lần; lệch thì `throw` để rollback cả cụm.
 */
const huyNghiBuoiDay: HoanTacDon = async ({ tx, don, actor, now, dateLabel }) => {
  const e = hq(don);
  const sessionId = typeof e.sessionId === "string" ? e.sessionId : null;
  const buoiBu = typeof e.buoiBu === "string" ? e.buoiBu : null;
  const truoc = (e.trangThai as { truoc?: string | null } | undefined)?.truoc ?? null;
  const phien = docPhienBan(e);
  if (!sessionId || !buoiBu || !truoc || !phien || !phien.bu) throw new DecideError(THIEU_ANH_CHUP);

  const DOI_LICH = "Không thể huỷ đơn vì lịch học đã được thay đổi sau khi đơn được duyệt — xếp lại trên màn lớp học";
  const goc = await tx.classSession.findUnique({ where: { id: sessionId }, select: { id: true, classId: true, date: true, status: true, updatedAt: true } });
  const bu = await tx.classSession.findUnique({ where: { id: buoiBu }, select: { id: true, date: true, status: true, updatedAt: true, sourceWorkRequestId: true } });
  if (!goc || !bu) throw new DecideError(DOI_LICH);
  // Buổi bù phải là buổi do CHÍNH đơn này sinh ra — không đoán theo "buổi cuối của lớp".
  if (bu.sourceWorkRequestId !== don.id) throw new DecideError(DOI_LICH);
  const khop = (b: { date: Date; updatedAt: Date; status: string }, p: PhienBuoi) =>
    b.date.toISOString() === p.ngay && b.updatedAt.toISOString() === p.capNhat && b.status === p.trangThai;
  if (!khop(goc, phien.goc) || !khop(bu, phien.bu)) throw new DecideError(DOI_LICH);
  if (bu.date <= now) throw new DecideError("Không thể huỷ đơn vì buổi học bù đã diễn ra");
  if (goc.date <= now) throw new DecideError(`Không thể huỷ đơn vì buổi gốc ${dateLabel} đã qua — khôi phục nó không còn ý nghĩa`);
  // T03: khoá lớp trước khi đổi trạng thái buổi — cùng khoá với `buoi-ghi.ts`, nên không đua với một lượt dời / sinh buổi của lớp này.
  await khoaLopBuoi(tx, goc.classId);
  const bam = await duLieuBamVaoBuoi(tx, buoiBu);
  if (bam.length) throw new DecideError(`Không thể huỷ đơn vì buổi học bù đã phát sinh dữ liệu (${bam.join(", ")})`);

  // Buổi bù TRƯỚC (gỡ thứ đơn tạo ra), rồi buổi gốc — cả hai có điều kiện phiên bản.
  const goBu = await tx.classSession.updateMany({
    where: { id: buoiBu, sourceWorkRequestId: don.id, status: bu.status, updatedAt: bu.updatedAt },
    data: { status: "CANCELLED" },
  });
  // Khôi phục buổi gốc có thể đụng chỉ mục "một lớp không hai buổi còn sống cùng giờ" (T03) nếu lớp đã xếp buổi khác vào đúng giờ ấy
  // sau khi đơn được duyệt — dịch thành lời nói được thay vì để lỗi CSDL thô nổi lên (ném ⇒ rollback cả cụm, đơn giữ CANCEL_REQUESTED).
  let songLai: { count: number };
  try {
    songLai = await tx.classSession.updateMany({
      where: { id: sessionId, status: "CANCELLED", updatedAt: goc.updatedAt },
      data: { status: truoc as SessionStatus },
    });
  } catch (err) {
    if (dichLoiTrungBuoi(err)) throw new DecideError("Không thể huỷ đơn vì lớp đã có buổi khác đúng giờ của buổi gốc — xếp lại trên màn lớp học");
    throw err;
  }
  if (goBu.count !== 1 || songLai.count !== 1) throw new DecideError("Lịch học vừa thay đổi — tải lại rồi thử lại");

  await writeAudit({
    actor,
    module: "classes",
    entityType: "ClassSession",
    entityId: sessionId,
    action: "RESTORE_SESSION",
    oldValues: { status: "CANCELLED", makeupSessionId: buoiBu, makeupStatus: bu.status },
    newValues: { status: truoc, makeupSessionId: buoiBu, makeupStatus: "CANCELLED", workRequestId: don.id },
    reason: `Huỷ đơn nghỉ buổi dạy ${dateLabel}`,
    tx,
  });
  await publishEvent("class.session_changed", { classId: goc.classId, sessionId, change: "RESTORED", makeupSessionId: buoiBu }, { tx });
  return {
    messages: [`Khôi phục buổi học ${dateLabel}; gỡ buổi bù đã thêm cuối lịch`],
    notify: [],
    hieuQua: { sessionId, khoiPhuc: truoc, buoiBu, buoiBuSau: "CANCELLED" },
  };
};

const khongCoGiDeHoanTac: HoanTacDon = async ({ dateLabel }) => ({
  messages: [`Đơn chỉ được ghi nhận (${dateLabel}) — không có gì trên lịch để hoàn tác`],
  notify: [],
  hieuQua: {},
});

export const HOAN_TAC_DON: Record<WorkRequestKindV, HoanTacDon> = {
  CLASS_CHANGE: khongCoGiDeHoanTac,
  SUB_TEACH: huyDayThay,
  CLASS_OFF: huyNghiBuoiDay,
  SHIFT_SWAP: huyODaThay,
  OT: huyTangCaHoacLamNgayNghi(NGUON_QUY.OT),
  LATE_EARLY: chiTinhLai,
  TIMESHEET_FIX: huyChinhCong,
  LEAVE: huyNghiPhep,
  REMOTE: chiTinhLai,
  BUSINESS_TRIP: chiTinhLai,
  COMP_LEAVE: huyNghiBu,
  HOLIDAY_WORK: huyTangCaHoacLamNgayNghi(NGUON_QUY.LAM_NGAY_NGHI),
  OUTSIDE_ATTENDANCE: chiTinhLai,
};

export { HREF_DON_CUA_TOI };
