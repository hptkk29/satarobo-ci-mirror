// lib/parttime/ngu-canh-cham-cong.ts — NGỮ CẢNH của MỘT lần bấm "Chấm công" (SR.QD.238). THUẦN, không đồng hồ, không DB.
//
// MỘT NÚT, KHÔNG ĐỔI: người dùng không chọn VÀO / RA, không chọn "chấm ca" / "chấm tiết". Hàm này KHÔNG quyết hướng — nhận
// hướng do `suyHuongHomNay` (MỘT hàm cho dự đoán trên trang VÀ lượt ghi thật) rồi chỉ nói lượt ấy đang phục vụ việc gì hôm nay
// để thẻ "Hôm nay" + câu dự đoán nói đúng. Bằng chứng (muộn / sớm / đủ) KHÔNG tính ở đây — đọc nhãn P4 dựng sẵn.
//
// PHÂN LOẠI THEO DỮ LIỆU, KHÔNG THEO VAI RBAC: ca thường = `ShiftAssignment`; tiết dạy = `SessionStaffAssignment` (đứng chính /
// trợ giảng); trực = `OperationsDutyAssignment` TƯỜNG MINH. Người có vai TEACHER mà không có phân công ⇒ không có ngữ cảnh dạy;
// người vai khác có phân công ⇒ có. Không có dòng trực ⇒ KHÔNG BAO GIỜ có ngữ cảnh trực (dạy một tiết rồi về = 0 trực).
import type { WorkActivityType, WorkRole, StaffAssignmentType } from "@prisma/client";
import { cauDuDoan, NHAN_HUONG, type HuongLuot } from "@/lib/cham-cong/suy-huong";
import type { DichHoSo, NhanTuanThu } from "./nhan-tuan-thu";

export type LoaiNguCanh = "NORMAL_SHIFT" | "TEACHING_MAIN" | "TEACHING_ASSISTANT" | "OPERATIONS_DUTY";
export type NguCanhChinh = "NORMAL_SHIFT" | "TEACHING" | "OPERATIONS_DUTY" | "MIXED" | "NONE";

export type TietVao = {
  assignmentId: string;
  role: WorkRole;
  activity: WorkActivityType;
  assignmentType: StaffAssignmentType;
  nhanLop: string;
  centerId: string;
  centerCode: string | null;
  batDau: Date;
  ketThuc: Date;
  /** Giờ PHẢI có mặt = bắt đầu − 10' chuẩn bị (chính sách) — đọc từ P4, không tính lại. */
  requiredFrom: Date;
  /** Đã nhận ĐÚNG phiên bản hiện tại. */
  daNhan: boolean;
  /** Nhãn bằng chứng P4 (`nhanBangChung`) — null khi chưa có gì để nói. */
  bangChung: string | null;
  /** Hồ sơ buổi (tuân thủ: điểm danh + nhận xét học viên) — `nhanTuanThu`; null = không đọc được / không áp. */
  hoSo: NhanTuanThu | null;
  /** Đích lối tắt tới màn điểm danh / nhận xét ĐÃ CÓ (trang đích tự kiểm quyền). */
  dich: DichHoSo | null;
};
export type TrucVao = { dutyId: string; shiftCode: string; tu: Date; den: Date; centerId: string; centerCode: string | null; daNhan: boolean };
export type CaVao = { ten: string | null; timeLabel: string };

export type DauVaoNguCanh = {
  /** Kết quả `suyHuongHomNay` — nguồn DUY NHẤT của hướng. */
  huong: { huong: HuongLuot; trung: boolean; nhanBuoi: string | null; cheDo?: "CA" | "PARTTIME" };
  caThuong: CaVao | null;
  tiet: readonly TietVao[];
  truc: readonly TrucVao[];
  /** Cơ sở của điểm chấm đang quét. */
  centerHienTai: string | null;
  now: Date;
};

export type TietHienThi = {
  assignmentId: string;
  nhanVai: "Đứng chính" | "Trợ giảng";
  /** Nhãn khối trên thẻ: GIÁO VIÊN ĐỨNG CHÍNH · TRỢ GIẢNG · DẠY THAY · HỌC BÙ · HỌC VƯỢT · HỌC THỬ. */
  tieuDe: string;
  nhanLop: string;
  gio: string;
  coMatTruoc: string;
  khacCoSo: string | null;
  bangChung: string | null;
  hoSo: NhanTuanThu | null;
  dich: DichHoSo | null;
  /** Đã tới giờ bắt đầu phần dạy — mốc nhắc "cần điểm danh học viên" (không phải thông báo, chỉ làm nổi trên thẻ). */
  daBatDau: boolean;
};
export type TrucHienThi = { dutyId: string; shiftCode: string; gio: string; khacCoSo: string | null };
export type CanhBaoNguCanh = { ma: "CHUA_NHAN_LOP" | "CHUA_NHAN_TRUC" | "KHAC_CO_SO" | "KHONG_LICH"; cau: string };

export type NguCanhChamCong = {
  direction: HuongLuot;
  contexts: LoaiNguCanh[];
  primary: NguCanhChinh;
  normalShift: CaVao | null;
  /** Tiết đã nhận hôm nay, theo giờ. */
  teaching: TietHienThi[];
  /** Tiết đáng hiện ĐẦU thẻ (đang diễn ra ⇒ sắp tới gần nhất ⇒ vừa xong) — CHỈ cho giao diện, không dùng tính công. */
  nextTeaching: TietHienThi | null;
  sauDo: TietHienThi | null;
  operationsDuty: TrucHienThi | null;
  warnings: CanhBaoNguCanh[];
  cauDuDoan: string;
  /** Sau lượt này, lượt kế (ngoài vài phút bấm trùng) sẽ là hướng nào — CHỈ khi hướng theo hiện diện (ngày Parttime). */
  huongTiepTheo: HuongLuot | null;
};

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

function tieuDe(t: TietVao): string {
  if (t.activity === "TRIAL") return "HỌC THỬ";
  if (t.activity === "MAKEUP") return "HỌC BÙ";
  if (t.activity === "ADVANCE") return "HỌC VƯỢT";
  if (t.role === "TEACHING_ASSISTANT") return "TRỢ GIẢNG";
  if (t.assignmentType === "SUBSTITUTE") return "DẠY THAY";
  return "GIÁO VIÊN ĐỨNG CHÍNH";
}

function hienThi(t: TietVao, centerHienTai: string | null, now: Date): TietHienThi {
  return {
    assignmentId: t.assignmentId,
    nhanVai: t.role === "MAIN_TEACHER" ? "Đứng chính" : "Trợ giảng",
    tieuDe: tieuDe(t),
    nhanLop: t.nhanLop,
    gio: `${hhmm(t.batDau)}–${hhmm(t.ketThuc)}`,
    coMatTruoc: hhmm(t.requiredFrom),
    khacCoSo: centerHienTai && t.centerId !== centerHienTai ? (t.centerCode ?? "cơ sở khác") : null,
    bangChung: t.bangChung,
    hoSo: t.hoSo,
    dich: t.dich,
    daBatDau: now.getTime() >= t.batDau.getTime(),
  };
}

/** Tiết để hiện đầu thẻ: đang trong khung phải có mặt → sắp tới gần nhất → vừa xong gần nhất. */
function chonTietDau(tiet: readonly TietVao[], now: Date): number {
  const t = now.getTime();
  const dang = tiet.findIndex((x) => x.requiredFrom.getTime() <= t && t <= x.ketThuc.getTime());
  if (dang >= 0) return dang;
  const sap = tiet.findIndex((x) => x.requiredFrom.getTime() > t);
  if (sap >= 0) return sap;
  return tiet.length - 1;
}

export function dungNguCanh(v: DauVaoNguCanh): NguCanhChamCong {
  const tiet = [...v.tiet].filter((x) => x.daNhan).sort((a, b) => a.batDau.getTime() - b.batDau.getTime());
  const truc = v.truc.filter((x) => x.daNhan).sort((a, b) => a.tu.getTime() - b.tu.getTime());
  const warnings: CanhBaoNguCanh[] = [];
  const chuaNhan = v.tiet.filter((x) => !x.daNhan).length;
  if (chuaNhan) warnings.push({ ma: "CHUA_NHAN_LOP", cau: `${chuaNhan} buổi hôm nay bạn chưa xác nhận nhận lớp — mở "Công việc của tôi".` });
  if (v.truc.some((x) => !x.daNhan)) warnings.push({ ma: "CHUA_NHAN_TRUC", cau: `Có ca trực hôm nay bạn chưa xác nhận — mở "Công việc của tôi".` });

  const contexts: LoaiNguCanh[] = [];
  if (v.caThuong) contexts.push("NORMAL_SHIFT");
  if (tiet.some((x) => x.role === "MAIN_TEACHER")) contexts.push("TEACHING_MAIN");
  if (tiet.some((x) => x.role === "TEACHING_ASSISTANT")) contexts.push("TEACHING_ASSISTANT");
  if (truc.length) contexts.push("OPERATIONS_DUTY");
  const coDay = tiet.length > 0;
  const coTruc = truc.length > 0;
  const soLoai = [!!v.caThuong, coDay, coTruc].filter(Boolean).length;
  const primary: NguCanhChinh = soLoai === 0 ? "NONE" : soLoai > 1 ? "MIXED" : coDay ? "TEACHING" : coTruc ? "OPERATIONS_DUTY" : "NORMAL_SHIFT";

  const teaching = tiet.map((x) => hienThi(x, v.centerHienTai, v.now));
  const i = tiet.length ? chonTietDau(tiet, v.now) : -1;
  const nextTeaching = i >= 0 ? teaching[i] : null;
  const sauDo = i >= 0 && i + 1 < teaching.length ? teaching[i + 1] : null;
  const t0 = truc.find((x) => x.tu.getTime() <= v.now.getTime() && v.now.getTime() <= x.den.getTime()) ?? truc.find((x) => x.tu.getTime() > v.now.getTime()) ?? truc[truc.length - 1];
  const operationsDuty = t0 ? { dutyId: t0.dutyId, shiftCode: t0.shiftCode, gio: `${hhmm(t0.tu)}–${hhmm(t0.den)}`, khacCoSo: v.centerHienTai && t0.centerId !== v.centerHienTai ? (t0.centerCode ?? "cơ sở khác") : null } : null;
  if (nextTeaching?.khacCoSo) warnings.push({ ma: "KHAC_CO_SO", cau: `Tiết ${nextTeaching.nhanLop} ở ${nextTeaching.khacCoSo} — bạn đang chấm ở điểm khác. Lượt chỉ làm bằng chứng cho việc ở đúng cơ sở quét.` });
  if (primary === "NONE") warnings.push({ ma: "KHONG_LICH", cau: "Hôm nay chưa có lịch làm việc / phân công phù hợp." });

  const huongTiepTheo = v.huong.cheDo === "PARTTIME" ? (v.huong.huong === "CHECK_IN" ? "CHECK_OUT" : "CHECK_IN") : null;
  return { direction: v.huong.huong, contexts, primary, normalShift: v.caThuong, teaching, nextTeaching, sauDo, operationsDuty, warnings, cauDuDoan: cauNguCanh(v.huong, primary, coDay, coTruc, nextTeaching), huongTiepTheo };
}

/**
 * Thẻ có dùng khối ngữ cảnh không. Nhân viên CHỈ có ca thường (hướng theo ca, không cảnh báo) ⇒ KHÔNG — thẻ cũ nguyên vẹn.
 * Còn lại ⇒ CÓ, kể cả khi việc chính vẫn là ca thường: có cảnh báo (vd ô ca + tiết CHƯA nhận) hoặc hướng đã chuyển sang theo
 * hiện diện (ngày Parttime) — luật đổi bên dưới thì màn hình phải nói ra, không được trông y như cũ. `[CTX-17]`.
 */
export function hienKhoiNguCanh(nc: NguCanhChamCong | null | undefined): nc is NguCanhChamCong {
  return !!nc && (nc.primary !== "NORMAL_SHIFT" || nc.warnings.length > 0 || nc.huongTiepTheo !== null);
}

/** Câu dự đoán THEO NGỮ CẢNH. Ca thường / không lịch / bấm trùng ⇒ ĐÚNG câu cũ (`cauDuDoan`) — màn của nhân viên thường không đổi. */
function cauNguCanh(h: DauVaoNguCanh["huong"], primary: NguCanhChinh, coDay: boolean, coTruc: boolean, next: TietHienThi | null): string {
  if (h.trung || primary === "NORMAL_SHIFT" || primary === "NONE") return cauDuDoan(h);
  const dich = NHAN_HUONG[h.huong];
  if (h.huong === "CHECK_OUT") return `Dự đoán: lần này sẽ ghi ${dich} · công việc hôm nay.`;
  if (coDay && coTruc) return `Dự đoán: lần này sẽ ghi ${dich} · ca trực + lịch dạy hôm nay.`;
  if (coDay && primary === "MIXED") return `Dự đoán: lần này sẽ ghi ${dich} · ca hôm nay + lịch dạy.`;
  if (coDay) return `Dự đoán: lần này sẽ ghi ${dich} · tiết dạy ${next?.nhanLop ?? "hôm nay"}.`;
  return `Dự đoán: lần này sẽ ghi ${dich} · ca trực.`;
}
