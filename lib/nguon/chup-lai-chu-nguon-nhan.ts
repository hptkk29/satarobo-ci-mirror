/**
 * lib/nguon/chup-lai-chu-nguon-nhan.ts — phần «chụp lại chủ nguồn» mà GIAO DIỆN (client) được import: kiểu lý do, nhãn, kiểm lý do. THUẦN, không kéo mã máy chủ.
 *
 * Tách khỏi `chup-lai-chu-nguon-luat.ts` vì tệp đó import `TRANG_THAI_NGHI` của engine (`lib/hoa-hong/nguoi-huong.ts`) — một đường import vào bundle trình duyệt là mời mã máy chủ theo.
 */
import { LY_DO_TOI_THIEU_NGUON } from "./danh-muc-ghi-dau-vao";

export type LyDoChupLai = "THIEU_CHU" | "CHU_NGHI_VIEC" | "CHU_KHONG_CON_HO_SO";

export const NHAN_LY_DO_CHUP_LAI: Record<LyDoChupLai, string> = {
  THIEU_CHU: "Nguồn chưa có chủ lúc ghi nhận",
  CHU_NGHI_VIEC: "Chủ đã chụp nghỉ việc",
  CHU_KHONG_CON_HO_SO: "Chủ đã chụp không còn hồ sơ",
};

/** Lý do ≥ 10 ký tự sau trim (cùng ngưỡng với mọi lượt sửa nguồn). `null` = hợp lệ. */
export function kiemLyDoChupLai(lyDo: string | null | undefined): string | null {
  return (lyDo ?? "").trim().length >= LY_DO_TOI_THIEU_NGUON ? null : `Nhập lý do chụp lại (tối thiểu ${LY_DO_TOI_THIEU_NGUON} ký tự) — nó được ghi vào nhật ký.`;
}
