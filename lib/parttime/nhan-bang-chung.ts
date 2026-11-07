// lib/parttime/nhan-bang-chung.ts — NHÃN của bằng chứng chấm công P4 (thuần, dùng chung QLCS + GV). Một chỗ quyết chữ ⇒ hai
// màn không thể nói khác nhau về cùng một phân công (luật 12b). Không bao giờ nói "được tính công" — đó là P5.
import type { BangChungPhanCong } from "./bang-chung-cong";

export type ToneBangChung = "danger" | "warning" | "success" | "info" | "muted";
export type NhanBangChung = { nhan: string; tone: ToneBangChung; /** Câu dài cho `title` / trình đọc màn hình. */ chiTiet: string };

const gio = (d: Date) => d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" });

const LUU_Y = "Bằng chứng chấm công — chưa tính công.";

/** null = không có gì để hiện (ngày chính sách cũ, buổi chưa tới giờ, buổi huỷ không ai có mặt). */
export function nhanBangChung(bc: Pick<BangChungPhanCong, "trangThai" | "checkInAt" | "checkOutAt" | "treVaoPhut" | "raSomPhut" | "ngoaiLe" | "canhBaoLuot">): NhanBangChung | null {
  const canhBao = bc.canhBaoLuot.length ? ` Cảnh báo lượt quẹt: ${bc.canhBaoLuot.join(", ")}.` : "";
  switch (bc.trangThai) {
    case "KHONG_AP_DUNG":
    case "CHUA_DEN_GIO":
      return null;
    case "BUOI_DA_HUY":
      return bc.ngoaiLe.includes("SESSION_CANCELLED_WITH_ATTENDANCE")
        ? { nhan: "Có mặt ở buổi đã huỷ", tone: "warning", chiTiet: `Buổi đã huỷ nhưng có chấm công trong khung giờ — cần đối soát. ${LUU_Y}` }
        : null;
    case "KHONG_BANG_CHUNG":
      return bc.ngoaiLe.includes("PRESENT_AT_OTHER_CENTER")
        ? { nhan: "Chấm công ở cơ sở khác", tone: "warning", chiTiet: `Có lượt quẹt trong khung giờ nhưng ở cơ sở khác — không gắn cho buổi này. ${LUU_Y}` }
        : { nhan: "Chưa chấm", tone: "muted", chiTiet: `Không có lượt quẹt hợp lệ nào trong khung phải có mặt. ${LUU_Y}` };
    case "DA_VAO":
      return { nhan: `Đã vào ${gio(bc.checkInAt!)}`, tone: "info", chiTiet: `Đã vào lúc ${gio(bc.checkInAt!)}, chưa ra.${canhBao} ${LUU_Y}` };
    case "THIEU_RA":
      return { nhan: "Thiếu lượt ra", tone: "warning", chiTiet: `Vào ${gio(bc.checkInAt!)} nhưng không có lượt ra sau khi buổi kết thúc — cần đối soát.${canhBao} ${LUU_Y}` };
    case "DI_MUON":
      return { nhan: `Đi muộn ${bc.treVaoPhut}'`, tone: "warning", chiTiet: `Vào ${gio(bc.checkInAt!)}, muộn ${bc.treVaoPhut} phút so với giờ phải có mặt.${canhBao} ${LUU_Y}` };
    case "RA_SOM":
      return { nhan: `Ra sớm ${bc.raSomPhut}'`, tone: "warning", chiTiet: `Ra ${gio(bc.checkOutAt!)}, sớm ${bc.raSomPhut} phút so với giờ kết thúc buổi.${canhBao} ${LUU_Y}` };
    case "CHI_CHUAN_BI":
      return {
        nhan: "Chỉ có mặt giờ chuẩn bị",
        tone: "danger",
        chiTiet: `Vào ${gio(bc.checkInAt!)}, ra ${gio(bc.checkOutAt!)} — trước giờ bắt đầu dạy, không có mặt trong phần dạy: chưa đủ bằng chứng đã dạy, cần xem tay.${canhBao} ${LUU_Y}`,
      };
    case "SAI_NGUOI_DUNG_LOP":
      return { nhan: "Sai người đứng lớp", tone: "danger", chiTiet: `Người được ghi nhận đứng lớp là người khác người đã nhận phân công — cần đối soát. ${LUU_Y}` };
    case "DU_BANG_CHUNG":
      return {
        nhan: `Vào ${gio(bc.checkInAt!)} · ra ${gio(bc.checkOutAt!)}`,
        tone: bc.canhBaoLuot.length ? "info" : "success",
        chiTiet: `Có mặt đủ khung giờ: vào ${gio(bc.checkInAt!)}, ra ${gio(bc.checkOutAt!)}.${canhBao} ${LUU_Y}`,
      };
  }
}
