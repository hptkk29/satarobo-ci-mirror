// lib/cham-cong/don/nghi-mot-phan.ts — handler NGHỈ MỘT PHẦN CA (đợt 7: nghỉ phép nửa buổi / theo giờ)
// và NGHỈ BÙ (đợt 8, mọi thời lượng).
//
// Cả hai KHÔNG ghi ô ca (ca giữ nguyên — xem đầu `nghi-trong-ca.ts`): duyệt kiểm hợp lệ, (nghỉ bù) trừ
// quỹ, rồi đánh dấu ngày tính lại; engine đọc đơn đã duyệt qua ngữ cảnh. Nghỉ phép CẢ NGÀY vẫn đi
// đường ô P/X cũ (`duyetNghiPhep`).
import type { Prisma } from "@prisma/client";
import { toMinutes } from "../catalog";
import { cumQuetKyVong } from "../cum-quet";
import { nghiCuaDon } from "../don-trong-ngay";
import { nhanPhut } from "../dong-phut-don";
import { giao, tong, type Khoang } from "../khoang-gio";
import { giaiKhungNghi } from "../nghi-trong-ca";
import { khoaQuyNghiBu, NGUON_QUY, soDuNghiBu } from "../nghi-bu";
import { markAttendanceDayDirty } from "../recompute";
import { DecideError, HREF_DON_CUA_TOI, type DonCanDuyet, type HandlerDon } from "./kieu";

export const NHAN_THOI_LUONG: Record<"FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY", string> = {
  FULL_DAY: "cả ngày",
  HALF_DAY_AM: "nửa buổi sáng",
  HALF_DAY_PM: "nửa buổi chiều",
  HOURLY: "theo giờ",
};

/** Nghỉ phép có phải loại MỘT PHẦN ca (đi đường này) không. */
export const laNghiMotPhan = (d: Pick<DonCanDuyet, "leaveDurationType">) =>
  d.leaveDurationType === "HALF_DAY_AM" || d.leaveDurationType === "HALF_DAY_PM" || d.leaveDurationType === "HOURLY";

/** Số phút nghỉ NẰM TRONG ca của ngày đơn — chặn mọi trường hợp không áp được (BA 4.10). */
export async function phutNghiTrongCa(
  tx: Prisma.TransactionClient,
  don: DonCanDuyet,
  coLuong: boolean,
): Promise<{ phut: number; centerId: string; orgUnitId: string | null }> {
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  if (don.toDate && don.toDate.getTime() !== don.fromDate.getTime()) {
    throw new DecideError("Nghỉ nửa buổi / theo giờ / nghỉ bù chỉ một ngày mỗi đơn — tách thành nhiều đơn");
  }
  const ca = await tx.shiftAssignment.findFirst({
    where: { userId: don.requesterId, workDate: don.fromDate, status: "ACTIVE" },
    select: { centerId: true, orgUnitId: true, segments: true, soCapQuetKyVong: true, isLeave: true, attendanceMode: true, template: { select: { kind: true } } },
  });
  if (!ca || ca.isLeave || ca.attendanceMode === "NONE" || ca.template.kind === "OFF") {
    throw new DecideError("Ngày này không có ca làm việc — không có gì để nghỉ");
  }
  const gioCa: Khoang[] = ((ca.segments as { start: string; end: string }[] | null) ?? []).map((s) => ({ start: toMinutes(s.start), end: toMinutes(s.end) }));
  const soCap = ([0, 1, 2] as const).includes(ca.soCapQuetKyVong as 0 | 1 | 2) ? (ca.soCapQuetKyVong as 0 | 1 | 2) : 1;
  const nghi = nghiCuaDon({ ...don, approvedStartTime: null, approvedEndTime: null, leavePaidRatio: coLuong ? 1 : 0, tyLeNghiBu: null, loaiNgayNghi: null });
  if (!nghi) throw new DecideError("Khung giờ nghỉ không hợp lệ (cần đủ giờ bắt đầu và kết thúc)");
  const g = giaiKhungNghi([nghi], cumQuetKyVong(gioCa, soCap), gioCa);
  if (g.khongAp) throw new DecideError("Ca của ngày này không chia buổi sáng / chiều — chọn nghỉ theo giờ hoặc cả ngày");
  const phut = tong(giao(gioCa, g.khung));
  if (phut === 0) throw new DecideError("Khung nghỉ không nằm trong giờ ca của ngày này");
  return { phut, centerId: ca.centerId, orgUnitId: ca.orgUnitId };
}

/** Nghỉ phép nửa buổi / theo giờ (đợt 7) — gọi từ `duyetNghiPhep` khi đơn không phải cả ngày. */
export const duyetNghiMotPhan: HandlerDon = async ({ tx, don, actor, note, dateLabel }) => {
  const lt = don.leaveTypeId ? await tx.leaveType.findUnique({ where: { id: don.leaveTypeId }, select: { code: true, name: true, paidRatio: true } }) : null;
  const coLuong = (lt?.paidRatio ?? 0) > 0;
  const { phut } = await phutNghiTrongCa(tx, don, coLuong);
  await markAttendanceDayDirty(don.requesterId, don.fromDate!, { tx, reason: "LEAVE_PART" });
  const kieu = NHAN_THOI_LUONG[don.leaveDurationType!];
  const khung = don.leaveDurationType === "HOURLY" ? ` ${don.startTime}–${don.endTime}` : "";
  return {
    applied: true,
    messages: [`Nghỉ ${kieu}${khung} ngày ${dateLabel} (${nhanPhut(phut)}${coLuong ? ", có lương" : ", không lương"}) — ca giữ nguyên, phần còn lại vẫn chấm như thường`],
    notify: [
      {
        userId: don.requesterId,
        title: `Đơn nghỉ ${dateLabel} đã duyệt`,
        body: `${actor.name} đã duyệt nghỉ ${kieu}${khung} — chỉ thời gian này được miễn chấm công${note ? ` — ${note}` : ""}.`,
        href: HREF_DON_CUA_TOI,
      },
    ],
    hieuQua: { ngay: dateLabel, thoiLuong: don.leaveDurationType, khung: khung.trim() || null, phutNghi: phut, loaiNghi: lt?.code ?? null },
  };
};

/** Nghỉ bù (đợt 8): kiểm quỹ ĐỦ (dưới khoá theo người) ⇒ trừ quỹ ⇒ tính lại. Quỹ không bao giờ âm. */
export const duyetNghiBu: HandlerDon = async ({ tx, don, actor, note, dateLabel, kindLabel }) => {
  const { phut, centerId, orgUnitId } = await phutNghiTrongCa(tx, don, true);
  await khoaQuyNghiBu(tx, don.requesterId);
  const soDuTruoc = await soDuNghiBu(tx, don.requesterId);
  if (soDuTruoc < phut) {
    throw new DecideError(`Quỹ nghỉ bù còn ${nhanPhut(Math.max(0, soDuTruoc))}, đơn cần ${nhanPhut(phut)} — không đủ để duyệt`);
  }
  await tx.compTimeLedger.create({
    data: {
      userId: don.requesterId,
      centerId,
      orgUnitId,
      minutes: -phut,
      sourceType: NGUON_QUY.NGHI_BU,
      sourceId: don.id,
      workDate: don.fromDate,
      // UNIQUE — duyệt lại / thử lại không trừ hai lần.
      khoa: `${NGUON_QUY.NGHI_BU}:${don.id}`,
      note: `Nghỉ bù ${dateLabel}`,
      createdById: actor.id,
    },
  });
  await markAttendanceDayDirty(don.requesterId, don.fromDate!, { tx, reason: "COMP_LEAVE" });
  const kieu = NHAN_THOI_LUONG[don.leaveDurationType ?? "FULL_DAY"];
  return {
    applied: true,
    messages: [`Trừ quỹ nghỉ bù ${nhanPhut(phut)} (${nhanPhut(soDuTruoc)} → ${nhanPhut(soDuTruoc - phut)}); nghỉ ${kieu} ngày ${dateLabel}`],
    notify: [
      {
        userId: don.requesterId,
        title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`,
        body: `${actor.name} đã duyệt — trừ ${nhanPhut(phut)} quỹ nghỉ bù, còn ${nhanPhut(soDuTruoc - phut)}${note ? ` — ${note}` : ""}.`,
        href: HREF_DON_CUA_TOI,
      },
    ],
    hieuQua: { ngay: dateLabel, thoiLuong: don.leaveDurationType ?? "FULL_DAY", phutTru: phut, soDu: { truoc: soDuTruoc, sau: soDuTruoc - phut } },
  };
};
