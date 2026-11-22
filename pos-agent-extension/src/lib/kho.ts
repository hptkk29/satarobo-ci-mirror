/**
 * Kho lưu trữ — bọc `chrome.storage.local` (bền qua khởi động lại Chrome) và
 * `chrome.storage.session` (mất khi tắt Chrome / nạp lại extension). Lõi chỉ thấy giao diện này,
 * nên test chạy được với kho giả trong bộ nhớ.
 *
 * Khoá dùng:
 *   local   — `cauHinh` (không bí mật) · `biMat` (agentSecret, CHỈ đường ký đọc) · `lastSyncedAt`
 *   session — `phien` · `tabId` · `nhanhDen` · `nextPollGanNhat` · `lechGio` · `dung` · `statusCho`
 *             · `loiMo` · `tapHeader` · `tapNhan` · `canQuetBuTu` · `chanDen` · `lanDongBoCuoi`
 *             · `truongQuaDai` (1.1 — khoá máy chủ báo FIELD_TOO_LONG)
 */
export interface KhoLuuTru {
  doc<T>(khoa: string): Promise<T | undefined>;
  ghi(gia: Record<string, unknown>): Promise<void>;
  xoa(khoa: readonly string[]): Promise<void>;
}
