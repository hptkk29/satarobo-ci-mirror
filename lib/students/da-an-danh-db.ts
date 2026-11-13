// lib/students/da-an-danh-db.ts — bản CÓ DB của `da-an-danh.ts`, cho action/route (25/09/2026).
// Tách file vì `app/(admin)/**` không được import `@/lib/db` trần (ESLint), còn phần thuần
// (`da-an-danh.ts`) phải dùng được cả ở script lẫn test không có DB.
import "server-only";
import { db } from "@/lib/db";
import { hocVienDaAnDanhTheoNhatKy, tenLaDaAnDanh } from "./da-an-danh";

/**
 * Học viên đã bị ẩn danh theo NĐ13 chưa — kiểm CẢ HAI dấu (tên "[Đã xoá…" + nhật ký
 * ERASE_PII). Đọc nhật ký bằng `db` trần có chủ đích: đây là câu hỏi CÓ/KHÔNG về một hồ sơ
 * người gọi đã được phép mở, không trả dữ liệu gì ra.
 */
export async function hocVienDaAnDanh(hv: { id: string; name: string }): Promise<boolean> {
  if (tenLaDaAnDanh(hv.name)) return true;
  return (await hocVienDaAnDanhTheoNhatKy(db, [hv.id])).has(hv.id);
}
