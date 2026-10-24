// lib/parttime/cong-viec.ts — chia tab của màn "Công việc của tôi" (site GV · SR.QD.238 · P3b). THUẦN.
//
// ⚠️ "Đã qua" KHÔNG lọc theo COMPLETED: chưa đường nào đặt phân công về COMPLETED (đóng phân công theo buổi chốt là
// P4 — `06-ATTENDANCE-BINDING-DESIGN.md`). Tab lọc COMPLETED sẽ RỖNG VĨNH VIỄN mà trông như "chưa có gì" (luật 12). Nên nó
// là "đã qua và mình đã nhận" — ghi đúng như thế trên nhãn.
import type { PhanCongCuaToi } from "./bang-phan-cong";

// "Cần xác nhận" ĐẦU TIÊN: nó là tab mặc định khi có việc chờ và mang con số duy nhất cần hành động — đặt thứ ba thì ở
// 375px nó nằm lấp ló ngoài mép phải thanh tab cuộn ngang (đo thật 13/10/2026).
export const MA_TAB = ["can-xac-nhan", "hom-nay", "sap-toi", "da-qua", "doi-soat"] as const;
export type MaTab = (typeof MA_TAB)[number];
export const laMaTab = (x: string | undefined | null): x is MaTab => !!x && (MA_TAB as readonly string[]).includes(x);

export const NHAN_TAB: Record<MaTab, string> = {
  "hom-nay": "Hôm nay",
  "sap-toi": "Sắp tới",
  "can-xac-nhan": "Cần xác nhận",
  "da-qua": "Đã qua · đã gán",
  "doi-soat": "Đối soát",
};

/** Cửa sổ của màn "Công việc của tôi" — MỘT chỗ, vì dải nhắc ở Tổng quan đọc cùng phép (luật 12b). */
export const SO_NGAY_SAP_TOI = 14;
export const SO_NGAY_DA_QUA = 30;

const DA_NHAN = new Set(["ACCEPTED", "ACTIVE", "COMPLETED"]);

type Muc = Pick<PhanCongCuaToi, "ngay" | "status" | "role" | "sourceType" | "nguoiDungLop">;

/** Một phân công có thể nằm ở HAI tab (vd. hôm nay + cần xác nhận) — tab là góc nhìn, không phải ngăn kéo. */
export function chiaTab<T extends Muc>(ds: readonly T[], homNay: string, userId: string): Record<MaTab, T[]> {
  return {
    "hom-nay": ds.filter((x) => x.ngay === homNay),
    "sap-toi": ds.filter((x) => x.ngay > homNay && DA_NHAN.has(x.status)),
    "can-xac-nhan": ds.filter((x) => x.status === "WAITING_ACCEPTANCE"),
    "da-qua": ds.filter((x) => x.ngay < homNay && DA_NHAN.has(x.status)).reverse(),
    // Buổi lớp đã qua, mình được phân đứng chính, mà người được quy công là người khác. Chỉ để đối chiếu — KHÔNG số công.
    "doi-soat": ds
      .filter((x) => x.ngay < homNay && x.role === "MAIN_TEACHER" && x.sourceType === "CLASS_SESSION" && x.nguoiDungLop != null && x.nguoiDungLop.id !== userId)
      .reverse(),
  };
}
