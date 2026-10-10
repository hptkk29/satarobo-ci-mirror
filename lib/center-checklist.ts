// Module Quản lý lớp phần 4 — định nghĩa item checklist mở/đóng cơ sở.

export const OPEN_FIELDS = [
  { key: "openPower", label: "Bật điện / điều hoà" },
  { key: "openDevices", label: "Wifi / thiết bị chung" },
  { key: "openRoomsReady", label: "Phòng sẵn sàng theo lịch" },
  { key: "openCleanCommon", label: "Vệ sinh khu chung" },
  { key: "openSecurity", label: "An ninh không bất thường" },
] as const;

export const CLOSE_FIELDS = [
  { key: "closePower", label: "Tắt điện" },
  { key: "closeDevices", label: "Tắt điều hoà / thiết bị" },
  { key: "closeLock", label: "Khoá cửa" },
  { key: "closeKpiBoard", label: "Cập nhật bảng chỉ tiêu" },
  { key: "closeSafety", label: "An toàn điện / nước / cháy nổ" },
  { key: "closeHandover", label: "Bàn giao / ghi nhận bất thường" },
] as const;

export const ALL_CHECKLIST_KEYS = [
  ...OPEN_FIELDS.map((f) => f.key),
  ...CLOSE_FIELDS.map((f) => f.key),
] as const;

export type ChecklistKey = (typeof ALL_CHECKLIST_KEYS)[number];

/** Đủ = tất cả item mở + đóng đều true. */
export function isChecklistComplete(rec: Partial<Record<ChecklistKey, boolean>> | null): boolean {
  if (!rec) return false;
  return ALL_CHECKLIST_KEYS.every((k) => rec[k] === true);
}
