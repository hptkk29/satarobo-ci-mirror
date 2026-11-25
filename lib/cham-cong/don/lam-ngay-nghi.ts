// lib/cham-cong/don/lam-ngay-nghi.ts — handler duyệt đơn LÀM NGÀY NGHỈ / NGÀY LỄ (đợt 9, BA 4.6) và
// CHẤM CÔNG NGOÀI ĐỊA ĐIỂM (đợt 10, BA 4.9).
//
// Cả hai KHÔNG ghi ô ca, không ghi lượt quét: duyệt kiểm hợp lệ, chốt khung, rồi (làm ngày nghỉ) đánh
// dấu ngày tính lại. Engine / cổng chấm ngoài đọc đơn đã duyệt qua ngữ cảnh đơn — huỷ đơn = đổi trạng
// thái + tính lại, không có gì phải hoàn tác trên lưới.
import { getSetting } from "@/lib/settings/service";
import { khoangTu } from "../khoang-gio";
import { laLeCoHieuLuc, ngayLeCuaNgay } from "../ngay-le-db";
import { markAttendanceDayDirty } from "../recompute";
import { DecideError, HREF_DON_CUA_TOI, type DonCanDuyet, type HandlerDon } from "./kieu";
import { nhanKhoang } from "./tang-ca";

function motNgayCoKhung(don: DonCanDuyet, ten: string) {
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  if (don.toDate && don.toDate.getTime() !== don.fromDate.getTime()) {
    throw new DecideError(`${ten} chỉ một ngày mỗi đơn — tách thành nhiều đơn`);
  }
  const khung = khoangTu(don.startTime, don.endTime);
  if (!khung) throw new DecideError(`${ten} cần khung giờ hợp lệ (giờ kết thúc sau giờ bắt đầu)`);
  return { ngay: don.fromDate, khung };
}

export const duyetLamNgayNghi: HandlerDon = async ({ tx, don, actor, note, dateLabel, kindLabel }) => {
  const { ngay, khung } = motNgayCoKhung(don, "Làm ngày nghỉ / ngày lễ");
  const ca = await tx.shiftAssignment.findFirst({
    where: { userId: don.requesterId, workDate: ngay, status: "ACTIVE" },
    select: { centerId: true, orgUnitId: true, isLeave: true, attendanceMode: true, template: { select: { kind: true } } },
  });
  if (ca?.isLeave) throw new DecideError("Ngày này người nộp đang có lịch nghỉ phép — không duyệt làm ngày nghỉ được");
  const coSo = ca?.centerId ?? don.centerId;
  const laLe = laLeCoHieuLuc(await ngayLeCuaNgay(tx, coSo, ngay));
  const coCaLam = !!ca && ca.attendanceMode !== "NONE" && ca.template.kind !== "OFF";
  if (coCaLam && !laLe) {
    throw new DecideError("Ngày này người nộp có ca làm việc bình thường — dùng đơn \"Tăng ca\" cho phần làm ngoài ca");
  }
  const loai = laLe ? ("LE" as const) : ("NGHI" as const);
  // CHỤP chính sách quy đổi LÚC DUYỆT — cùng lý do đơn OT (`tang-ca.ts`): đổi cấu hình về sau không được
  // biến phút đã duyệt-để-trả-tiền thành nghỉ bù hồi tố.
  const orgUnitId = ca?.orgUnitId ?? don.orgUnitId;
  const cheDo = await getSetting("shift.lamNgayNghiQuyDoi", { orgUnitId });
  const quyDoi = cheDo === "NGHI_BU" ? { cheDo, tyLe: await getSetting("shift.nghiBuTyLe", { orgUnitId }) } : { cheDo, tyLe: null };

  await tx.workRequest.update({ where: { id: don.id }, data: { approvedStartTime: don.startTime, approvedEndTime: don.endTime } });
  await markAttendanceDayDirty(don.requesterId, ngay, { tx, reason: "HOLIDAY_WORK" });

  const cot = laLe ? "Làm ngày lễ" : "Làm ngày nghỉ";
  const veQuy = quyDoi.cheDo === "NGHI_BU" ? `; quy đổi NGHỈ BÙ ×${quyDoi.tyLe}` : "";
  return {
    applied: true,
    messages: [`${cot} ${dateLabel} ${nhanKhoang(khung)} — chỉ phút chấm công thật trong khung vào cột "${cot}"${veQuy}`],
    notify: [
      {
        userId: don.requesterId,
        title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`,
        body: `${actor.name} duyệt ${cot.toLowerCase()} ${nhanKhoang(khung)} — nhớ chấm công lúc bắt đầu và kết thúc${note ? ` — ${note}` : ""}.`,
        href: HREF_DON_CUA_TOI,
      },
    ],
    hieuQua: { ngay: dateLabel, loai, khung: nhanKhoang(khung), quyDoi },
  };
};

export const duyetChamNgoai: HandlerDon = async ({ tx, don, actor, note, dateLabel, kindLabel }) => {
  const { ngay, khung } = motNgayCoKhung(don, "Chấm công ngoài địa điểm");
  const ca = await tx.shiftAssignment.findFirst({
    where: { userId: don.requesterId, workDate: ngay, status: "ACTIVE" },
    select: { centerId: true, orgUnitId: true, isLeave: true, attendanceMode: true, template: { select: { kind: true } } },
  });
  if (!ca || ca.isLeave || ca.attendanceMode === "NONE" || ca.template.kind === "OFF") {
    throw new DecideError("Ngày này người nộp không có ca làm việc — không có gì để chấm ngoài địa điểm");
  }
  const dungSai = await getSetting("shift.chamNgoaiDungSaiPhut", { orgUnitId: ca.orgUnitId });
  return {
    applied: true,
    messages: [`Ngày ${dateLabel}, ${nhanKhoang(khung)} (±${dungSai}′): được chấm công ngoài điểm chấm — công vẫn tính theo lượt chấm thật`],
    notify: [
      {
        userId: don.requesterId,
        title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`,
        body: `${actor.name} đã duyệt — trong khung ${nhanKhoang(khung)} bấm nút "Chấm công" trên trang Chấm công ở đâu cũng được${note ? ` — ${note}` : ""}.`,
        href: HREF_DON_CUA_TOI,
      },
    ],
    hieuQua: { ngay: dateLabel, khung: nhanKhoang(khung), dungSaiPhut: dungSai, diaDiem: don.detail },
  };
};
