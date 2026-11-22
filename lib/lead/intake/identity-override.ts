// lib/lead/intake/identity-override.ts — G-D (21/08/2026).
//
// Biểu mẫu nhập khách gửi mã nhân viên bằng ô người dùng TỰ GÕ (`CustomField26`).
// Ô đó quyết định lead được giao cho ai (`resolveOwner` trong `ingest.ts`), nhưng
// không có gì ngăn người này gõ mã người kia — vô tình hay cố ý.
//
// Khi phiếu đến kèm phiên đăng nhập, danh tính lấy từ PHIÊN; ô trên phiếu tụt
// xuống thành dữ liệu người dùng như mọi ô khác.
//
// Hàm THUẦN để test được, và để quy tắc này không nằm lẫn trong route handler.

export type EmployeeCodePick = {
  /** Mã dùng để tra người phụ trách; `null` = không xác định được ai. */
  code: string | null;
  /** Phiếu gửi lên một mã KHÁC mã của người đang đăng nhập — đáng ghi vết. */
  spoofed: boolean;
  source: "session" | "form" | "none";
};

const chuanHoa = (v: string | null | undefined): string | null =>
  v?.trim() ? v.trim() : null;

/**
 * @param fromSession mã nhân viên của tài khoản đang đăng nhập (null nếu ẩn danh
 *                    hoặc tài khoản chưa gắn hồ sơ nhân sự)
 * @param fromForm    mã người dùng gõ trên phiếu
 *
 * Phiên thắng. Không có phiên thì giữ nguyên hành vi cũ (dùng mã trên phiếu) —
 * đường ẩn danh vẫn phải chạy cho tới khi biểu mẫu cũ được thay.
 */
export function pickEmployeeCode(
  fromSession: string | null | undefined,
  fromForm: string | null | undefined,
): EmployeeCodePick {
  const phien = chuanHoa(fromSession);
  const phieu = chuanHoa(fromForm);

  if (phien) {
    const khac = phieu !== null && phieu.toLowerCase() !== phien.toLowerCase();
    return { code: phien, spoofed: khac, source: "session" };
  }
  return phieu
    ? { code: phieu, spoofed: false, source: "form" }
    : { code: null, spoofed: false, source: "none" };
}
