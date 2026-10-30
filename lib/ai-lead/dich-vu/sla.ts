// lib/ai-lead/dich-vu/sla.ts — MỨC SLA của một hồ sơ chờ. HÀM THUẦN: `now` là THAM SỐ (luật 19: không đọc đồng hồ thật).
//
// Hai đồng hồ (design §2): `slaClaimDueAt` — hạn có người NHẬN; `slaResolveDueAt` — hạn XỬ LÝ XONG. Hạn do Gateway tính lúc tạo hồ sơ từ tham số `ai.slaClaimMinutes`/`ai.slaResolveMinutes`
// (OD-04) — tệp này chỉ ĐỌC hạn đã ghi, không tự tính lại (tính lại ở hai nơi là hai đồng hồ lệch nhau).
import { laKetThuc, daRaLead } from "./dieu-kien";

export type MucSla = "KHONG_AP_DUNG" | "TRONG_HAN" | "SAP_HAN" | "QUA_HAN_NHAN" | "QUA_HAN_XU_LY";

export type DauVaoSla = {
  state: string;
  claimedById: string | null;
  slaClaimDueAt: Date | null;
  slaResolveDueAt: Date | null;
};

/** «Sắp hết hạn» khi còn ≤ chừng này phút — chỉ là gợi ý hiển thị, KHÔNG phải ngưỡng nghiệp vụ. */
export const SAP_HAN_PHUT = 15;

export function mucSla(d: DauVaoSla, now: Date, sapHanPhut: number = SAP_HAN_PHUT): MucSla {
  // Hồ sơ đã ra lead hoặc đã đóng: hết đồng hồ (lead chưa có chủ là việc của màn «Chưa phân công», không phải SLA của hồ sơ).
  if (laKetThuc(d.state) || daRaLead(d.state)) return "KHONG_AP_DUNG";
  const t = now.getTime();
  // Quá hạn XỬ LÝ nặng hơn quá hạn NHẬN: xét trước.
  if (d.slaResolveDueAt && d.slaResolveDueAt.getTime() < t) return "QUA_HAN_XU_LY";
  if (d.claimedById === null && d.slaClaimDueAt && d.slaClaimDueAt.getTime() < t) return "QUA_HAN_NHAN";
  const gan = sapHanPhut * 60_000;
  const han = d.claimedById === null ? d.slaClaimDueAt : d.slaResolveDueAt;
  if (han && han.getTime() - t <= gan) return "SAP_HAN";
  return d.slaClaimDueAt || d.slaResolveDueAt ? "TRONG_HAN" : "KHONG_AP_DUNG";
}

export const NHAN_SLA: Record<MucSla, string> = {
  KHONG_AP_DUNG: "",
  TRONG_HAN: "Trong hạn",
  SAP_HAN: "Sắp hết hạn",
  QUA_HAN_NHAN: "Quá hạn nhận",
  QUA_HAN_XU_LY: "Quá hạn xử lý",
};

export function laQuaHan(m: MucSla): boolean {
  return m === "QUA_HAN_NHAN" || m === "QUA_HAN_XU_LY";
}
