import "server-only";
import { db } from "@/lib/db";
import { loiMaHocVien } from "@/lib/students/ma-hoc-vien-dang";

// lib/students/ma-hoc-vien-kiem.ts — phần ĐỌC DB của cổng mã học viên (phần thuần: `ma-hoc-vien-dang.ts`).
//
// Dùng ở mọi nơi NHẬN một mã từ người/tệp: nút «Sửa mã» (`change-code.ts`), form học viên, nhập Excel. Đọc `Center` bằng `db`
// trần có chủ đích: đây là tra METADATA (mã cơ sở), không phải dữ liệu học viên; qua `scopedDb` thì quản trị không phủ hết cơ sở
// sẽ nhận `null` và cổng đọc thành "không có gì để đối chiếu" — mở toang đúng lúc phải đóng.

/** Lỗi của mã học viên MỚI so với cơ sở `centerId` của học viên; `null` nếu hợp lệ. Học viên chưa có cơ sở ⇒ chỉ kiểm hình dạng. */
export async function loiMaHocVienTheoCoSo(ma: string, centerId: string | null): Promise<string | null> {
  if (!centerId) return loiMaHocVien(ma, null);
  const center = await db.center.findUnique({ where: { id: centerId }, select: { code: true } });
  // Cơ sở có mà chưa khai mã ⇒ không có tiền tố hợp lệ nào để đối chiếu: từ chối, đừng cho qua im lặng.
  if (!center?.code) return "Cơ sở của học viên chưa có mã (Center.code) — khai mã cơ sở trước khi đặt mã học viên.";
  return loiMaHocVien(ma, center.code);
}

/** Mã của MỌI cơ sở đang có — cho nơi chưa biết cơ sở từng dòng (nhập Excel). */
export async function layMaCoSoHopLe(): Promise<string[]> {
  const rows = await db.center.findMany({ select: { code: true } });
  return rows.map((r) => r.code).filter((c): c is string => !!c);
}
