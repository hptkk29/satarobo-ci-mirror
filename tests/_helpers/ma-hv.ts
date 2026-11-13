import { chuanHoaMaCoSo, maHocVienTuSo } from "../../lib/students/ma-hoc-vien-dang";

// tests/_helpers/ma-hv.ts — mã học viên HỢP LỆ cho fixture.
//
// Từ 06/11/2026 DB có trigger `Student_studentCode_dang_trg` (migration `20261126090000_student_code_dang_duy_nhat`): mã học viên phải
// đúng MỘT dạng `CS1-26-AB3K9P` VÀ có tiền tố bằng `Center.code` của cơ sở học viên. Fixture không còn gõ tay `HV-001` / `HS-xyz` được.
//
// Quy tắc dùng: tiền tố PHẢI là mã của CHÍNH cơ sở mà học viên thuộc về — truyền `Center.code` (hoặc cả dòng Center) của nó.
// `khoa` là chuỗi/số bất kỳ phân biệt các học viên trong cùng test; cùng (maCoSo, khoa) luôn ra cùng một mã (tất định ⇒ chạy lại
// vẫn upsert đúng dòng cũ), khác khoá thì ra mã khác (băm FNV-1a 32 bit vào 31^6 ≈ 887 triệu mã).

const KHONG_GIAN = 31 ** 6;

function bam(khoa: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < khoa.length; i++) {
    h ^= khoa.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % KHONG_GIAN;
}

/** `maHv("CS1", "chat-hv01")` → `CS1-26-XXXXXX`. `maCoSo` có thể là chuỗi mã hoặc dòng Center. */
export function maHv(maCoSo: string | { code: string | null }, khoa: string | number): string {
  const ma = typeof maCoSo === "string" ? maCoSo : (maCoSo.code ?? "");
  if (!chuanHoaMaCoSo(ma)) throw new Error("maHv: cơ sở chưa có mã — fixture phải tạo Center có `code`");
  return maHocVienTuSo(ma, typeof khoa === "number" ? khoa : bam(khoa));
}
