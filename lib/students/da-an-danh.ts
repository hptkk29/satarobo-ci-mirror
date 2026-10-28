// lib/students/da-an-danh.ts — "học viên này đã bị ẩn danh theo NĐ13 chưa?" (25/09/2026).
//
// Vì sao có file này — lỗi đo được ở lượt rà đối kháng:
// Ẩn danh (`applyStudentErasure`) GIỮ bản ghi Student (không `deletedAt`), giữ ghi danh /
// đơn / khoản thu / nhật ký chốt lead (nghĩa vụ lưu sổ), và đặt NULL các ô PII. Mà luật
// "điền ô trống từ lead" (`dien-tu-lead.ts`) coi ô NULL là ô CHƯA ĐIỀN ⇒ nối một học viên
// đã ẩn danh về lead là GHI LẠI chính các PII vừa xoá (ngày sinh, email, link FB phụ
// huynh…) — lượt xoá theo yêu cầu bị đảo ngược mà không ai thấy. Bốn chuỗi bằng chứng của
// script nối lead vẫn trỏ đúng về lead của gia đình đó, nên đây KHÔNG phải ca hiếm.
//
// LUẬT: mọi đường NỐI học viên ↔ lead (script, nút "Gắn lead", convert dùng lại HV) phải
// hỏi ở đây trước, và từ chối học viên đã ẩn danh.
//
// Hai dấu hiệu, dùng CẢ HAI (không cái nào đủ một mình):
//   · tên bắt đầu bằng "[Đã xoá" — `buildErasureData` đặt, `retention.ts` cũng đọc đúng dấu
//     này; rẻ, không cần truy vấn. Nhưng tên SỬA ĐƯỢC ở form hồ sơ sau khi ẩn danh.
//   · dòng AuditLog `entityType: "Student"`, `action: "ERASE_PII"` — không sửa được (nhật
//     ký chỉ ghi thêm), nhưng phải truy vấn.
//
// THUẦN, trừ `hocVienDaAnDanhTheoNhatKy` nhận client làm THAM SỐ (script dùng PrismaClient
// trần, action dùng `db` trong lib/) — file không import gì phía server.

/** Tiền tố tên mà `buildErasureData` đặt cho học viên đã ẩn danh. */
export const TIEN_TO_TEN_DA_AN_DANH = "[Đã xoá";

/** `AuditLog.action` của lượt ẩn danh (lib/compliance/erasure.ts). */
export const HANH_DONG_AN_DANH = "ERASE_PII";

/** Tên có mang dấu ẩn danh không. So ở dạng NFC — chuỗi gõ từ macOS/iOS hay ở dạng NFD. */
export function tenLaDaAnDanh(name: string | null | undefined): boolean {
  if (typeof name !== "string") return false;
  return name.normalize("NFC").startsWith(TIEN_TO_TEN_DA_AN_DANH.normalize("NFC"));
}

/** Đủ hình dạng để tra nhật ký — `db`, `tx`, hay PrismaClient trần của script đều khớp. */
export type ClientTraNhatKy = {
  auditLog: {
    findMany(args: {
      where: { entityType: string; action: string; entityId: { in: string[] } };
      select: { entityId: true };
    }): Promise<{ entityId: string }[]>;
  };
};

/**
 * Tập id (trong `ids`) CÓ dòng nhật ký ẩn danh. Một câu cho cả lô — chỗ gọi tự chia lô nếu
 * danh sách lớn. `ids` rỗng ⇒ không truy vấn.
 */
export async function hocVienDaAnDanhTheoNhatKy(
  client: ClientTraNhatKy,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await client.auditLog.findMany({
    where: { entityType: "Student", action: HANH_DONG_AN_DANH, entityId: { in: [...ids] } },
    select: { entityId: true },
  });
  return new Set(rows.map((r) => r.entityId));
}

/** Câu lỗi dùng chung khi từ chối nối lead cho học viên đã ẩn danh. */
export const LOI_DA_AN_DANH =
  "Hồ sơ này đã được ẩn danh theo NĐ13 — không nối lead và không điền lại thông tin từ lead.";
