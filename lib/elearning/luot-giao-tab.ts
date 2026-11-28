// Danh sách "Lượt giao đã tạo" chia hai tab theo URL (`?tab=dang-mo|da-dong`) — hàm THUẦN, không import React/DB.
//
// ⚠️ "ĐÃ ĐÓNG" ĐƯỢC SUY, không có cột: `TrnAssignmentStatus` chỉ có ACTIVE/REVOKED và không đường nào đóng lượt giao khi hết hạn (quyết định Q15
// mặc định: suy trước, thêm cột/cron sau nếu cần). Một lượt giao là ĐÃ ĐÓNG khi:
//   · THU_HOI — status ≠ ACTIVE (đã thu hồi cả lượt); hoặc
//   · XONG_HET — có người nhận và KHÔNG còn ai đang hoạt động (chưa bắt đầu / đang học / quá hạn) ⇒ mọi lượt đã hoàn thành hoặc thu hồi.
// Hạn chung không phải điều kiện: lượt giao quá hạn mà còn người chưa xong là VIỆC CẦN XỬ LÝ, không phải lượt đã đóng.

export const TAB_LUOT_GIAO = [
  { id: "dang-mo", nhan: "Đang mở" },
  { id: "da-dong", nhan: "Đã đóng" },
] as const;
export type TabLuotGiao = (typeof TAB_LUOT_GIAO)[number]["id"];
export const MA_TAB_LUOT_GIAO: readonly TabLuotGiao[] = TAB_LUOT_GIAO.map((t) => t.id);
export const TAB_LUOT_GIAO_MAC_DINH: TabLuotGiao = "dang-mo";

export type LyDoDong = "THU_HOI" | "XONG_HET";

export type TongHopLuotGiao = {
  soNguoi: number;
  soQuaHan: number;
  /** COMPLETED */
  soDat: number;
  /** COMPLETED_LATE */
  soTre: number;
  /** NOT_STARTED + IN_PROGRESS + OVERDUE */
  soConHoatDong: number;
  daDong: boolean;
  lyDoDong: LyDoDong | null;
};

/** `dem` = số ghi danh theo trạng thái (thiếu khoá = 0). */
export function tongHopLuotGiao(statusLuotGiao: string, dem: Readonly<Record<string, number>>): TongHopLuotGiao {
  const g = (k: string) => dem[k] ?? 0;
  const soNguoi = Object.values(dem).reduce((a, b) => a + b, 0);
  const soConHoatDong = g("NOT_STARTED") + g("IN_PROGRESS") + g("OVERDUE");
  const lyDoDong: LyDoDong | null = statusLuotGiao !== "ACTIVE" ? "THU_HOI" : soNguoi > 0 && soConHoatDong === 0 ? "XONG_HET" : null;
  return { soNguoi, soQuaHan: g("OVERDUE"), soDat: g("COMPLETED"), soTre: g("COMPLETED_LATE"), soConHoatDong, daDong: lyDoDong !== null, lyDoDong };
}

export function cauLyDoDong(l: TongHopLuotGiao): string | null {
  if (l.lyDoDong === "THU_HOI") return "Đã thu hồi cả lượt giao";
  if (l.lyDoDong === "XONG_HET") return `Mọi người đã xong: ${l.soDat} đạt · ${l.soTre} trễ`;
  return null;
}
