// lib/cham-cong/don/ca-nghi-cong.ts — handler duyệt đơn CA / NGHỈ / CHỈNH CÔNG / MUỘN-SỚM /
// chỉ-ghi-nhận (đợt 3 đơn từ, 08/10/2026). Thân từng nhánh CHUYỂN NGUYÊN từ chuỗi if/else cũ của
// `decideRequest` — đổi duy nhất: trả thêm `hieuQua` (giá trị cũ → mới) để audit ghi trong giao dịch.
//
// Mọi phép ghi đi qua `ctx.tx` (KHÔNG scope): ghi đè chỉnh công phải thấy MỌI lượt của ngày, kể cả
// lượt quét ở cơ sở khác (xem `ghiDongChinhTay`).
import { maNghiTrenLuoi } from "@/lib/work-request";
import { vnYmd } from "@/lib/time/vn";
import { setAssignmentCell } from "../cells";
import { resolveHomeCenter } from "../home-center";
import { markAttendanceDayDirty } from "../recompute";
import { cheDoChoDon, dungDongChinhTay, ghiDongChinhTay, moTaMoc, soMocCuaCa } from "../sua-gio-quet";
import { DecideError, ghiNhanO, HREF_DON_CUA_TOI, templateCode, type DecideNotify, type HandlerDon, type ODaThay } from "./kieu";
import { duyetNghiMotPhan, laNghiMotPhan } from "./nghi-mot-phan";

export const duyetDoiCa: HandlerDon = async ({ tx, don, actor, map, canWriteCenter, boQuaKyDaChot, dateLabel }) => {
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  const messages: string[] = [];
  const notify: DecideNotify[] = [];
  const ca: { userId: string; truoc: string | null; sau: string }[] = [];
  const o: ODaThay[] = [];
  const newCode = await templateCode(tx, don.requesterNewTemplateId);
  if (!newCode) throw new DecideError("Mã ca mới không còn trong danh mục");
  const home = await resolveHomeCenter(don.requesterId);
  const r = await setAssignmentCell({ tx, userId: don.requesterId, workDate: don.fromDate, code: newCode, homeUnit: home.centerCode, centerMap: map, source: "SWAP", sourceRequestId: don.id, note: `Đơn đổi ca ${don.id}`, actorUserId: actor.id, canWriteCenter, boQuaKyDaChot });
  if (r.error) throw new DecideError(r.error);
  ghiNhanO(o, don.requesterId, don.fromDate, r);
  ca.push({ userId: don.requesterId, truoc: r.before?.templateCode ?? null, sau: newCode });
  messages.push(`Ca của người nộp ${dateLabel}: ${r.before?.templateCode ?? "—"} → ${newCode}`);
  notify.push({ userId: don.requesterId, title: `Ca ${dateLabel} đổi: ${r.before?.templateCode ?? "—"} → ${newCode}`, body: `${actor.name} đã duyệt đơn đổi ca của bạn.`, href: "/cham-cong/lich-ca" });
  if (don.targetUserId && don.targetNewTemplateId) {
    const tCode = await templateCode(tx, don.targetNewTemplateId);
    if (!tCode) throw new DecideError("Mã ca của người nhận thay không còn trong danh mục");
    const tHome = await resolveHomeCenter(don.targetUserId);
    const r2 = await setAssignmentCell({ tx, userId: don.targetUserId, workDate: don.fromDate, code: tCode, homeUnit: tHome.centerCode, centerMap: map, source: "SWAP", sourceRequestId: don.id, note: `Nhận ca theo đơn ${don.id}`, actorUserId: actor.id, canWriteCenter, boQuaKyDaChot });
    if (r2.error) throw new DecideError(`Người nhận ca: ${r2.error}`);
    ghiNhanO(o, don.targetUserId, don.fromDate, r2);
    ca.push({ userId: don.targetUserId, truoc: r2.before?.templateCode ?? null, sau: tCode });
    messages.push(`Ca người nhận: ${r2.before?.templateCode ?? "—"} → ${tCode}`);
    notify.push({ userId: don.targetUserId, title: `Bạn nhận ca ${dateLabel}: ${r2.before?.templateCode ?? "—"} → ${tCode}`, body: `${actor.name} duyệt đơn đổi ca — bạn nhận ca thay.`, href: "/cham-cong/lich-ca" });
  }
  return { applied: true, messages, notify, hieuQua: { ngay: dateLabel, ca, o } };
};

export const duyetNghiPhep: HandlerDon = async (ctx) => {
  // Nửa buổi / theo giờ (đợt 7) KHÔNG ghi ô ca — đi đường riêng. Cả ngày (và đơn cũ, NULL) như dưới.
  if (laNghiMotPhan(ctx.don)) return duyetNghiMotPhan(ctx);
  const { tx, don, actor, map, canWriteCenter, boQuaKyDaChot, dateLabel } = ctx;
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  const notify: DecideNotify[] = [];
  const to = don.toDate ?? don.fromDate;
  const lt = don.leaveTypeId ? await tx.leaveType.findUnique({ where: { id: don.leaveTypeId }, select: { code: true, paidRatio: true, isActive: true } }) : null;
  // Mã ca ghi lên lưới: nghỉ có lương ⇒ "P", không lương ⇒ "X" (mã Sheet — K-06 theo MISA).
  // Luật ở MỘT chỗ (`maNghiTrenLuoi`) — câu "Khi duyệt sẽ: …" trên màn duyệt đọc cùng hàm.
  const code = maNghiTrenLuoi(lt?.paidRatio);
  const home = await resolveHomeCenter(don.requesterId);
  const ngay: { ngay: string; truoc: string | null; sau: string }[] = [];
  const o: ODaThay[] = [];
  for (let d = new Date(don.fromDate); d <= to; d = new Date(d.getTime() + 86_400_000)) {
    const ymd = vnYmd(new Date(d.getTime() + 12 * 3_600_000));
    const r = await setAssignmentCell({ tx, userId: don.requesterId, workDate: d, code, homeUnit: home.centerCode, centerMap: map, source: "LEAVE", sourceRequestId: don.id, note: lt ? `Nghỉ ${lt.code}` : "Nghỉ", actorUserId: actor.id, canWriteCenter, boQuaKyDaChot });
    if (r.error) throw new DecideError(`${ymd}: ${r.error}`);
    ghiNhanO(o, don.requesterId, d, r);
    ngay.push({ ngay: ymd, truoc: r.before?.templateCode ?? null, sau: code });
  }
  const n = ngay.length;
  const messages = [`Đã ghi ${code} cho ${n} ngày`];
  notify.push({ userId: don.requesterId, title: `Đơn nghỉ ${dateLabel} đã duyệt`, body: `${actor.name} đã duyệt — ${n} ngày ghi mã ${code}.`, href: "/cham-cong/lich-ca" });
  let nguoiThay: { userId: string; truoc: string | null; sau: string } | null = null;
  if (don.targetUserId && don.targetNewTemplateId) {
    const tCode = await templateCode(tx, don.targetNewTemplateId);
    if (!tCode) throw new DecideError("Mã ca của người làm thay không còn trong danh mục");
    const tHome = await resolveHomeCenter(don.targetUserId);
    const r2 = await setAssignmentCell({ tx, userId: don.targetUserId, workDate: don.fromDate, code: tCode, homeUnit: tHome.centerCode, centerMap: map, source: "SWAP", sourceRequestId: don.id, note: `Làm thay theo đơn nghỉ ${don.id}`, actorUserId: actor.id, canWriteCenter, boQuaKyDaChot });
    if (r2.error) throw new DecideError(`Người làm thay: ${r2.error}`);
    ghiNhanO(o, don.targetUserId, don.fromDate, r2);
    nguoiThay = { userId: don.targetUserId, truoc: r2.before?.templateCode ?? null, sau: tCode };
    notify.push({ userId: don.targetUserId, title: `Bạn làm thay ${dateLabel}: ca ${tCode}`, body: `${actor.name} duyệt đơn nghỉ — bạn làm thay ca ${tCode}.`, href: "/cham-cong/lich-ca" });
  }
  return { applied: true, messages, notify, hieuQua: { loaiNghi: lt?.code ?? null, ngay, nguoiThay, o } };
};

export const duyetChinhCong: HandlerDon = async ({ tx, don, actor, note, now, map, canWriteCenter, dateLabel }) => {
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  const home = await resolveHomeCenter(don.requesterId);
  const a = await tx.shiftAssignment.findFirst({ where: { userId: don.requesterId, workDate: don.fromDate, status: "ACTIVE" }, select: { centerId: true, orgUnitId: true, soCapQuetKyVong: true } });
  const centerId = a?.centerId ?? don.centerId ?? home.centerId;
  if (!canWriteCenter(centerId)) throw new DecideError("Không có quyền chỉnh công ở cơ sở này");
  const orgUnitId = a?.orgUnitId ?? Object.values(map.byCode).find((c) => c.centerId === centerId)?.orgUnitId ?? null;
  // Dựng + ghi dòng đi qua LÕI DÙNG CHUNG (`sua-gio-quet.ts`) — cùng bản với đường quản lý sửa giờ
  // ngoài luồng đơn. Khác biệt: `canCu` (qua đơn thì `adjustRequestId = <id đơn>`) và chế độ.
  //
  // CHẾ ĐỘ (chủ dự án chốt 06/10/2026): đơn khai ĐỦ BỘ mốc của ca (2 mốc với ca một cặp quét, 4 mốc
  // với ca hai cặp) ⇒ GHI ĐÈ — lượt quét cũ của ngày giữ lại để xem nhưng thôi tính công. Thiếu ⇒
  // GHI THÊM như cũ: đơn "quên quét ra" chỉ khai một đầu, ghi đè ở đó là xoá luôn lượt vào thật.
  const moc = [don.requestedInAt, don.requestedOutAt, don.requestedIn2At, don.requestedOut2At];
  const cheDo = cheDoChoDon(moc, soMocCuaCa(a?.soCapQuetKyVong));
  const dung = dungDongChinhTay({
    userId: don.requesterId,
    centerId,
    orgUnitId,
    workDate: don.fromDate,
    moc,
    cheDo,
    actorId: actor.id,
    now,
    lyDo: note,
    canCu: { kieu: "DON", requestId: don.id },
  });
  if (!dung.ok) throw new DecideError(dung.error);
  const { thayThe } = await ghiDongChinhTay(tx, {
    userId: don.requesterId,
    workDate: don.fromDate,
    cheDo,
    rows: dung.rows,
    actorId: actor.id,
    now,
    lyDo: note,
    canCu: { kieu: "DON", requestId: don.id },
  });
  await markAttendanceDayDirty(don.requesterId, don.fromDate, { tx, reason: "TIMESHEET_FIX" });
  const thayCu = cheDo === "GHI_DE" ? ` (ghi đè — ${thayThe.length} lượt quét cũ giữ để xem, không còn tính công)` : "";
  return {
    applied: true,
    messages: [`Đã ghi ${dung.rows.length} mốc giờ chỉnh tay cho ${dateLabel}${thayCu}`],
    notify: [
      {
        userId: don.requesterId,
        title: `Đơn chỉnh công ${dateLabel} đã duyệt`,
        body: `${actor.name} đã ghi ${moTaMoc(moc)}${cheDo === "GHI_DE" ? " — thay cho các lượt quét cũ của ngày" : ""}.`,
        href: HREF_DON_CUA_TOI,
      },
    ],
    hieuQua: {
      ngay: dateLabel,
      cheDo,
      mocMoi: moTaMoc(moc),
      soLuotBiThay: thayThe.length,
      // Đợt 11 — đủ để huỷ đơn trả các lượt bị thay về ĐÚNG trạng thái cũ, và gỡ đúng số dòng đơn tạo.
      soDongMoi: dung.rows.length,
      thayThe: thayThe.map((l) => ({ id: l.id, reviewStatus: l.reviewStatus, reviewNote: l.reviewNote, reviewedById: l.reviewedById, reviewedAt: l.reviewedAt?.toISOString() ?? null })),
    },
  };
};

/**
 * Đi muộn / về sớm (đợt 2, Q-5 "miễn trừ"): engine đọc đơn đã duyệt mỗi lần tính lại công
 * (`muon-som-da-duyet.ts`), nên duyệt chỉ ĐÁNH DẤU ngày để tính lại — không chụp số phút ở đây (đơn
 * thường nộp trước ngày, lúc này chưa có lượt nào để so).
 */
export const duyetMuonSom: HandlerDon = async ({ tx, don, actor, note, dateLabel, kindLabel }) => {
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  await markAttendanceDayDirty(don.requesterId, don.fromDate, { tx, reason: "LATE_EARLY" });
  return {
    applied: true,
    messages: [`Ngày ${dateLabel}: phần đi muộn / về sớm trong khung đã xin không tính vi phạm`],
    notify: [{ userId: don.requesterId, title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`, body: `${actor.name} đã duyệt — phần muộn/sớm trong khung bạn xin không tính vi phạm${note ? ` — ${note}` : ""}.`, href: HREF_DON_CUA_TOI }],
    hieuQua: { ngayTinhLai: dateLabel },
  };
};

/**
 * OT / làm từ xa / công tác / đổi lớp: đơn là CĂN CỨ — duyệt không đổi lưới, lượt quét hay lịch lớp
 * (đợt 4, 7 của kế hoạch sẽ cho OT/công tác hệ quả thật; đổi lớp do quản lý làm trên màn lớp học).
 */
export const duyetChiGhiNhan: HandlerDon = async ({ don, actor, note, dateLabel, kindLabel }) => ({
  applied: false,
  messages: [],
  notify: [{ userId: don.requesterId, title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`, body: `${actor.name} đã duyệt đơn của bạn${note ? ` — ${note}` : ""}.`, href: HREF_DON_CUA_TOI }],
  hieuQua: null,
});
