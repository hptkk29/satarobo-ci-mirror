// app/(admin)/admin/lop-trial/_lib/gv-hop-le.ts — CỔNG GHI của ô "Giáo viên", phần THUẦN.
//
// Một câu hỏi, và nó KHÔNG phải câu hỏi mà `getAssignableTeachers` trả lời:
//
//   `getAssignableTeachers` trả lời "ai được CHỌN MỚI hôm nay".
//   Cửa SỬA một buổi cũ hỏi "giá trị ĐANG NẰM TRÊN BẢN GHI có được giữ lại không".
//
// Trộn hai câu đó là gốc của một lỗi chặn cứng đã có thật trên đường ghi (vá 17/09/2026).
//
// ── BẰNG CHỨNG, ĐỌC TỪ CÂU TRUY VẤN ───────────────────────────────────────────────────
// `lib/teachers/assignable.ts:41` đặt `deletedAt: null` ở TẦNG NGOÀI của `where`, cạnh
// `OR`, nên Prisma AND nó với MỌI nhánh — kể cả nhánh cứu hộ `{ id: { in: includeIds } }`:
//
//     deletedAt IS NULL AND ( <GV đang hoạt động> OR id IN (includeIds) )
//
// Hệ quả chia làm hai, và chỉ một nửa được cứu:
//   · `isActive = false` (nghỉ việc, chưa xoá) → `includeIds` CÓ cứu được.
//   · `deletedAt` đã đặt (xoá mềm)            → `includeIds` KHÔNG cứu được.
//
// Ở vế thứ hai, một lượt sửa chỉ đổi mỗi GIỜ của buổi cũ — gửi lại ĐÚNG `teacherId` đang
// nằm trên bản ghi — bị từ chối bằng "Người được chọn không phải giáo viên đang hoạt
// động". Buổi đó không còn sửa được bằng bất kỳ đường nào trên giao diện, và thông báo
// lỗi chỉ về phía ô Giáo viên nên người dùng đi đổi giáo viên (mất dữ liệu sổ sách: ai
// THẬT SỰ đã dạy buổi đó) thay vì báo lỗi.
//
// ⚠️ Vá ở ĐÂY chứ KHÔNG nới `getAssignableTeachers`: hàm đó là danh sách dùng chung của
// bốn màn khác, và với câu hỏi CỦA NÓ ("ai được chọn mới") thì loại người đã xoá là ĐÚNG.
// Nới nó ra là cho phép gán một tài khoản đã xoá vào một buổi hoàn toàn mới.

/**
 * Giáo viên `teacherId` có được phép nằm trên buổi này không.
 *
 * @param dsChonDuoc id do `getAssignableTeachers({ includeIds: giuThem })` trả về.
 *   ⚠️ KHÔNG được coi tập này là đầy đủ — xem khối bằng chứng ở đầu file.
 * @param giuThem giáo viên ĐANG gán sẵn trên bản ghi. Giá trị đang có luôn hợp lệ: cổng
 *   này gác việc ĐƯA NGƯỜI MỚI VÀO, không gác việc giữ nguyên thứ đã ở đó. `null` trong
 *   mảng = buổi chưa có giáo viên, bỏ qua.
 *
 * Không tham số nào có mặc định (luật 7): cả ba đều là thứ quyết định một lượt GHI có đi
 * qua hay không, và "quên truyền `giuThem`" chính là hình dạng của lỗi đang vá.
 */
export function gvXepDuocTheoDanhSach(input: {
  teacherId: string;
  dsChonDuoc: readonly string[];
  giuThem: readonly (string | null)[];
}): boolean {
  // Vế này phải đứng TRƯỚC: nó là vế duy nhất cứu được tài khoản đã xoá mềm, và đó cũng
  // là vế rẻ nhất (không chạm DB).
  if (input.giuThem.includes(input.teacherId)) return true;
  return input.dsChonDuoc.includes(input.teacherId);
}
