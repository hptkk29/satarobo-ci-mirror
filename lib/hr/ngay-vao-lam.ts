// lib/hr/ngay-vao-lam.ts — `Employee.joinedAt` là NGÀY LÀM VIỆC CHÍNH THỨC.
// THUẦN, test không cần DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// Định nghĩa (chốt 08/09/2026)
//
// `joinedAt` = ngày làm việc CHÍNH THỨC, KHÔNG phải ngày thử việc. Nó nuôi "số năm gắn
// bó" trên trang công khai `/vinh-danh` và sau này là thâm niên — cả hai đều tính từ
// ngày chính thức.
//
// Người đang thử việc, chưa có ngày chính thức ⇒ `joinedAt = NULL`. "Còn làm việc" vẫn
// quyết bằng `status`/`isActive`, nên NULL không làm ai biến mất khỏi danh sách nào.
//
// NGÀY THỬ VIỆC hiện KHÔNG có chỗ lưu — đó là vé riêng, đừng nhét vào `joinedAt`.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao cần một cổng thay vì đọc thẳng
//
// Đo prod 08/09/2026: **13 hồ sơ có `joinedAt` = 1970-01-01** và **14 hồ sơ có
// `endDate` = 1970-01-01**. Đó là NULL bị ghi thành 0 (mốc Unix), không phải ngày thật.
//
// Phép trừ ngày với 1970 KHÔNG ném lỗi — nó chỉ ra số sai: `computeYears` cũ trả ~57 và
// con số đó đi thẳng lên `/vinh-danh` dưới dạng "57 năm gắn bó". Cùng họ với bug so nửa
// đêm: sai lặng lẽ, trông như dữ liệu thật.
//
// Migration dọn dữ liệu là một việc; cổng này là việc khác — mã KHÔNG được tin mốc 1970
// kể cả khi dữ liệu còn sót, và kể cả khi một đường ghi nào đó tái tạo nó.

/**
 * Mốc phân định. Mọi giá trị TRƯỚC ngày này là mốc Unix do "không nhập" bị ghi thành 0,
 * không phải ngày vào làm thật — Sata Robo thành lập năm 2023.
 */
const MOC_UNIX = new Date("1970-01-02T00:00:00Z");

/**
 * Bỏ mốc Unix khỏi một NGÀY CÔNG VIỆC (vào làm / kết thúc hợp đồng).
 *
 * ⚠️ CHỈ dùng cho ngày công việc. KHÔNG dùng cho `dateOfBirth`: sinh ngày 01/01/1970 là
 * một ngày THẬT và hợp lệ, chặn nó là xoá dữ liệu đúng.
 */
export function boMocUnix(d: Date | null | undefined): Date | null {
  if (!d) return null;
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return null;
  if (t.getTime() < MOC_UNIX.getTime()) return null;
  return t;
}

/** Ngày vào làm dùng được, hoặc `null` khi thiếu / là mốc Unix / không hợp lệ. */
export function ngayVaoLamHopLe(d: Date | null | undefined): Date | null {
  return boMocUnix(d);
}
