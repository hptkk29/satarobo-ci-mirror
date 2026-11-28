// Phần THUẦN của trang Đề cương khoá: mô tả thời lượng từng bài, dòng "hạn đã được gia hạn", dòng hoàn thành.
// Không import React/DB ⇒ test được bằng Vitest.
//
// ⚠️ Chỉ nói thứ ĐO ĐƯỢC từ dữ liệu: bài không có số đo thật (vd. bài tập, buổi trực tiếp) thì KHÔNG bịa thời lượng.

const nhanLoai: Record<string, string> = {
  READ: "Bài đọc",
  VIDEO: "Video",
  QUIZ: "Bài kiểm tra",
  TASK: "Bài tập",
  LIVE_SESSION: "Buổi trực tiếp",
  SCORM: "Gói SCORM",
};

function phut(giay: number): number {
  return Math.max(1, Math.round(giay / 60));
}

/**
 * "Video · 12 phút" · "Bài đọc · 3 phút" · "Bài kiểm tra · 13 câu". `null` khi không có số đo:
 *  · VIDEO thiếu `durationSec`  → không nói thời lượng;
 *  · READ  → `minReadSeconds` là thời gian ĐỌC TỐI THIỂU để tính xong (không phải độ dài bài) nên nói đúng nghĩa đó;
 *  · QUIZ  → số câu của đề (`soCau` null = chưa gắn đề / không đếm được).
 */
export function moTaThoiLuongBai(
  kind: string,
  o: { durationSec: number | null; minReadSeconds: number | null; soCau: number | null },
): string | null {
  const ten = nhanLoai[kind];
  if (!ten) return null;
  if (kind === "VIDEO" && o.durationSec && o.durationSec > 0) return `${ten} · ${phut(o.durationSec)} phút`;
  if (kind === "READ" && o.minReadSeconds && o.minReadSeconds > 0) return `${ten} · đọc tối thiểu ${phut(o.minReadSeconds)} phút`;
  if (kind === "QUIZ" && o.soCau && o.soCau > 0) return `${ten} · ${o.soCau} câu`;
  return null;
}

/**
 * MỘT định nghĩa "n/m bài" cho cả Tổng quan và Đề cương: chỉ tính bài BẮT BUỘC của phiên bản đã xuất bản mới nhất; bài chưa có
 * dòng phiên bản ⇒ coi là bắt buộc (mặc định phía chặt, như `napDeCuongKhoa`).
 *
 * `baiCuaKhoa`: các bài (chưa xoá) của khoá · `requiredCuaBai`: map bài → cờ bắt buộc của bản chốt (rỗng nếu khoá chưa có bản
 * xuất bản) · `daXong`: tập id bài người này đã hoàn thành trong lượt.
 */
export function tinhTienDoBatBuoc(
  baiCuaKhoa: readonly string[],
  requiredCuaBai: ReadonlyMap<string, boolean>,
  daXong: ReadonlySet<string>,
): { xong: number; tong: number } {
  let tong = 0;
  let xong = 0;
  for (const id of baiCuaKhoa) {
    if (requiredCuaBai.get(id) === false) continue;
    tong += 1;
    if (daXong.has(id)) xong += 1;
  }
  return { xong, tong };
}

/** Tốc độ đọc giả định (từ/phút) cho ước lượng — tiếng Việt, tài liệu công việc. Chỉ là ƯỚC LƯỢNG hiển thị, không dùng để tính hoàn thành. */
export const TU_MOI_PHUT = 200;

/**
 * Ước lượng thời gian đọc (phút, làm tròn LÊN, tối thiểu 1) từ số TỪ của nội dung Markdown. Bỏ ký hiệu Markdown thuần
 * (`#`, `*`, `-`, `>` đứng riêng, khối mã/URL không bị bỏ — vẫn là chữ người đọc). `null` khi nội dung trống: không bịa "1 phút".
 *
 * ⚠️ KHÁC `minReadSeconds`: đó là SÀN thời gian tối thiểu để bài được tính đã đọc (do người soạn đặt), không phải độ dài bài.
 */
export function uocLuongPhutDoc(contentMd: string | null | undefined): number | null {
  if (!contentMd) return null;
  const tu = contentMd
    .split(/\s+/)
    .map((t) => t.replace(/^[#>*\-+`~_|]+|[#>*\-+`~_|]+$/g, ""))
    .filter((t) => t.length > 0).length;
  if (tu === 0) return null;
  return Math.max(1, Math.ceil(tu / TU_MOI_PHUT));
}

const ngayVn = (d: Date) => new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" }).format(d);

/**
 * Dải "Hạn của bạn đã được gia hạn đến dd/mm" — CHỈ khi `dueAt` thật sự khác `dueAtOriginal` (bất biến) và dời ra sau.
 * Kèm lý do khi có (do người xử lý nhập). `null` khi không có gia hạn: không đoán từ `slaGraceDays` (đó là khoản miễn trừ riêng).
 */
export function dongGiaHan(o: {
  dueAt: Date | null;
  dueAtOriginal: Date | null;
  extensionReason: string | null;
}): string | null {
  if (!o.dueAt || !o.dueAtOriginal) return null;
  if (o.dueAt.getTime() <= o.dueAtOriginal.getTime()) return null;
  const lyDo = o.extensionReason?.trim();
  return `Hạn của bạn đã được gia hạn đến ${ngayVn(o.dueAt)} (hạn ban đầu ${ngayVn(o.dueAtOriginal)})${lyDo ? `. Lý do: ${lyDo}` : "."}`;
}

/** "Bạn đã hoàn thành khoá ngày dd/mm" — `null` khi chưa có `completedAt` (không bịa ngày). */
export function dongHoanThanh(completedAt: Date | null): string | null {
  return completedAt ? `Bạn đã hoàn thành khoá ngày ${ngayVn(completedAt)}.` : null;
}
