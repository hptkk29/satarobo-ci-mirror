// lib/auth/do-manh-mat-khau.ts — THANG ĐO độ mạnh mật khẩu hiển thị ở màn Kích hoạt / Quên mật khẩu.
//
// ⚠️ CHỈ LÀ GỢI Ý CHO NGƯỜI GÕ. Luật thật (tối thiểu 8 ký tự) nằm ở server action — thanh này KHÔNG
// chặn ai và không thay thế kiểm tra phía máy chủ. Đếm 4 tiêu chí như artifact: đủ 8 ký tự · có cả hoa
// lẫn thường · có số · có ký tự đặc biệt.

export const NHAN_DO_MANH = ["Nhập ít nhất 8 ký tự", "Yếu", "Trung bình", "Khá mạnh", "Rất mạnh"] as const;

export type DoManh = { diem: 0 | 1 | 2 | 3 | 4; nhan: (typeof NHAN_DO_MANH)[number] };

export function doManhMatKhau(mk: string): DoManh {
  let d = 0;
  if (mk.length >= 8) d++;
  if (/[A-Z]/.test(mk) && /[a-z]/.test(mk)) d++;
  if (/\d/.test(mk)) d++;
  if (/[^A-Za-z0-9]/.test(mk)) d++;
  const diem = d as DoManh["diem"];
  return { diem, nhan: mk.length ? NHAN_DO_MANH[diem] : NHAN_DO_MANH[0] };
}
