// lib/cham-cong/don/tang-ca.ts — handler duyệt đơn TĂNG CA (đợt 4 đơn từ, BA 4.5 + QĐ-2).
//
// Duyệt KHÔNG cộng giờ đăng ký vào công. Nó chốt KHUNG được duyệt (quản lý có thể thu hẹp) rồi đánh
// dấu ngày tính lại; engine lấy khung đó giao với giờ làm thật (`tang-ca.ts` ở lib/cham-cong) — làm
// ít hơn khung thì trả ít hơn, làm ngoài khung thì không trả.
import { khoangTu, tong, tru, type Khoang } from "../khoang-gio";
import { laLeCoHieuLuc, ngayLeCuaNgay } from "../ngay-le-db";
import { markAttendanceDayDirty } from "../recompute";
import { toMinutes } from "../catalog";
import { getSetting } from "@/lib/settings/service";
import { DecideError, HREF_DON_CUA_TOI, type HandlerDon } from "./kieu";

const hhmm = (p: number) => `${String(Math.floor(p / 60)).padStart(2, "0")}:${String(p % 60).padStart(2, "0")}`;
export const nhanKhoang = (k: Khoang) => `${hhmm(k.start)}–${hhmm(k.end)}`;
export const nhanPhut = (p: number) => (p % 60 === 0 ? `${p / 60}h` : `${Math.floor(p / 60)}h${String(p % 60).padStart(2, "0")}`);

export const duyetTangCa: HandlerDon = async ({ tx, don, actor, note, dateLabel, kindLabel, dieuChinh }) => {
  if (!don.fromDate) throw new DecideError("Đơn thiếu ngày");
  const khungXin = khoangTu(don.startTime, don.endTime);
  if (!khungXin) throw new DecideError("Đơn tăng ca thiếu giờ bắt đầu / kết thúc hợp lệ");

  // Quản lý CHỈ được thu hẹp khung xin, không nới rộng: duyệt nhiều hơn người ta xin là tạo ra OT
  // không ai đề nghị (mặc định bảo thủ — ghi trong báo cáo đợt 4).
  let khungDuyet = khungXin;
  if (dieuChinh.otTu || dieuChinh.otDen) {
    const k = khoangTu(dieuChinh.otTu ?? don.startTime, dieuChinh.otDen ?? don.endTime);
    if (!k) throw new DecideError("Khung tăng ca được duyệt không hợp lệ (giờ kết thúc phải sau giờ bắt đầu)");
    if (k.start < khungXin.start || k.end > khungXin.end) {
      throw new DecideError(`Khung được duyệt phải nằm trong khung xin ${nhanKhoang(khungXin)}`);
    }
    khungDuyet = k;
  }

  // OT chỉ có nghĩa ở NGÀY LÀM VIỆC có ca. Ngày không ca / nghỉ / lễ là "làm ngày nghỉ / lễ" — loại
  // đơn riêng, tính vào cột riêng (engine trả sớm ở các nhánh đó nên OT sẽ ra 0 một cách im lặng).
  const ca = await tx.shiftAssignment.findFirst({
    where: { userId: don.requesterId, workDate: don.fromDate, status: "ACTIVE" },
    select: { centerId: true, orgUnitId: true, segments: true, isLeave: true, attendanceMode: true, template: { select: { kind: true } } },
  });
  if (!ca || ca.isLeave || ca.attendanceMode === "NONE" || ca.template.kind === "OFF") {
    throw new DecideError("Ngày này không có ca làm việc — dùng đơn \"Làm ngày nghỉ / ngày lễ\" thay cho tăng ca");
  }
  if (laLeCoHieuLuc(await ngayLeCuaNgay(tx, ca.centerId, don.fromDate))) {
    throw new DecideError("Ngày này là ngày lễ — dùng đơn \"Làm ngày nghỉ / ngày lễ\" thay cho tăng ca");
  }
  const gioCa: Khoang[] = ((ca.segments as { start: string; end: string }[] | null) ?? []).map((s) => ({
    start: toMinutes(s.start),
    end: toMinutes(s.end),
  }));
  const phutDuyet = tong(tru([khungDuyet], gioCa));
  if (phutDuyet === 0) throw new DecideError("Khung tăng ca nằm trọn trong giờ ca — giờ trong ca đã là công thường");

  await tx.workRequest.update({
    where: { id: don.id },
    data: { approvedStartTime: hhmm(khungDuyet.start), approvedEndTime: hhmm(khungDuyet.end) },
  });
  // CHỤP chính sách quy đổi LÚC DUYỆT (theo cơ sở của ca) — engine đọc ảnh chụp này, không đọc cấu
  // hình hiện hành: đổi TRA_TIEN → NGHI_BU về sau KHÔNG biến OT đã duyệt-để-trả-tiền thành nghỉ bù.
  const cheDo = await getSetting("shift.otQuyDoi", { orgUnitId: ca.orgUnitId });
  const quyDoi = cheDo === "NGHI_BU" ? { cheDo, tyLe: await getSetting("shift.nghiBuTyLe", { orgUnitId: ca.orgUnitId }) } : { cheDo, tyLe: null };
  await markAttendanceDayDirty(don.requesterId, don.fromDate, { tx, reason: "OT" });

  const thuHep = khungDuyet.start !== khungXin.start || khungDuyet.end !== khungXin.end;
  const veQuy = quyDoi.cheDo === "NGHI_BU" ? `; quy đổi NGHỈ BÙ ×${quyDoi.tyLe} (không trả tiền)` : "";
  const message = `Duyệt OT ${nhanKhoang(khungDuyet)} (${nhanPhut(phutDuyet)} ngoài ca)${thuHep ? ` — thu hẹp từ khung xin ${nhanKhoang(khungXin)}` : ""}; phút được trả đối chiếu chấm công thực tế${veQuy}`;
  return {
    applied: true,
    messages: [message],
    notify: [
      {
        userId: don.requesterId,
        title: `Đơn ${kindLabel} ${dateLabel} đã duyệt`,
        body: `${actor.name} duyệt OT ${nhanKhoang(khungDuyet)}${thuHep ? ` (bạn xin ${nhanKhoang(khungXin)})` : ""} — giờ được tính theo chấm công thực tế trong khung này${note ? ` — ${note}` : ""}.`,
        href: HREF_DON_CUA_TOI,
      },
    ],
    hieuQua: { ngay: dateLabel, khungXin: nhanKhoang(khungXin), khungDuyet: nhanKhoang(khungDuyet), phutDuyet, quyDoi },
  };
};
