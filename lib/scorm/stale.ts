// QA 20/07 — gói SCORM kẹt UPLOADING/PROCESSING (upload đứt giữa chừng, process
// treo/crash) sẽ hiện "Đang xử lý…" VĨNH VIỄN trên /scorm + editor giáo trình
// (thực tế DEV có bản kẹt 500+ giờ). Xử lý bình thường chỉ mất vài giây → quá
// ngưỡng này coi như kẹt, hiển thị như bản lỗi để admin "Dọn" và đẩy lại.

export const SCORM_PROCESSING_STALE_MS = 15 * 60 * 1000;

export const SCORM_STALE_ERROR =
  "kẹt xử lý (quá 15 phút) — dọn bản này rồi đẩy lại tệp";

export function isScormProcessingStale(
  status: string,
  createdAt: Date,
  now: number = Date.now(),
): boolean {
  return (
    (status === "UPLOADING" || status === "PROCESSING") &&
    now - createdAt.getTime() >= SCORM_PROCESSING_STALE_MS
  );
}
