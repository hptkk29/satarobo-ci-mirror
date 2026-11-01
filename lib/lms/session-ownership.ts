// lib/lms/session-ownership.ts — #06 (L6): predicate THUẦN "buổi có thuộc GV này không".
//
// Tách khỏi file 'use server' (chỉ export async được) để unit-test được + tái dùng ở cả
// action lẫn e2e. Buổi THUỘC GV khi:
//   - lớp ∈ assignedClassIds (GV đứng lớp / trợ giảng — resolveActor nạp từ Class), HOẶC
//   - GV là người DẠY THAY buổi này (substituteTeacherId === userId), HOẶC
//   - GV là người THỰC DẠY buổi này (actualTeacherId === userId).
// Cách ly CƠ SỞ do scopedDb(actor).findUnique lo (IDOR → null); predicate này chỉ xét
// quyền-sở-hữu-buổi, KHÔNG chạm dữ liệu PH (câu 46).
export function isSessionOwnedByTeacher(
  session: {
    classId: string;
    substituteTeacherId: string | null;
    actualTeacherId: string | null;
  },
  teacher: { userId: string; assignedClassIds: ReadonlySet<string> },
): boolean {
  return (
    teacher.assignedClassIds.has(session.classId) ||
    session.substituteTeacherId === teacher.userId ||
    session.actualTeacherId === teacher.userId
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QUYỀN ≠ CÔNG — hai câu hỏi khác nhau trên cùng một bản ghi
// ─────────────────────────────────────────────────────────────────────────────
//
// `isSessionOwnedByTeacher` ở trên trả lời *"giáo viên này có được XEM/SỬA buổi này
// không"*. Nó gồm cả `assignedClassIds` — tức mọi người được phân vào lớp, kể cả TRỢ
// GIẢNG, đều "sở hữu" mọi buổi của lớp.
//
// Đó là câu trả lời ĐÚNG cho quyền và SAI cho công. Đã đo trên prod 08/09/2026: dùng
// `assignedClassIds` làm thước đo công quy cho một trợ giảng **76 buổi** mà người ấy
// không đứng lớp. Luật đã ghi: *tập dựng cho mục đích A không dùng cho mục đích B khi
// chưa kiểm lại định nghĩa* (`docs/luat-doc-so-va-ket-luan.md`).
//
// Hai hàm dưới đây trả lời câu CÔNG, và cố ý đặt cạnh hàm trên để lần đọc sau thấy ngay
// hai câu hỏi là hai câu.

/**
 * Ai được quy công buổi này — MỘT người, hoặc `null` khi không xác định được.
 *
 * Thứ tự có ý nghĩa, đừng đổi:
 *  1. `actualTeacherId` — người THỰC DẠY, ghi lúc hoàn tất buổi. Đây là sự thật sau cùng.
 *  2. `substituteTeacherId` — người được xếp DẠY THAY (`lib/classes/adjust.ts:245`). Là
 *     kế hoạch, nên thua sự thật ở bước 1 nhưng thắng giáo viên trên hồ sơ lớp.
 *  3. `class.teacherId` — giáo viên phụ trách lớp. Mặc định khi không ai đổi gì.
 *
 * ⚠️ **KHÔNG có `assistantId` trong chuỗi này.** Trợ giảng không đứng lớp thay giáo viên;
 * đưa vào đây là tái tạo đúng phép đếm sai 76 buổi ở trên.
 *
 * ⚠️ Bước 2 là thứ ba chỗ đếm đã BỎ SÓT trước 08/09/2026
 * (`bao-cao/hieu-suat-gv`, `dashboard/manager-dashboard`, `teacher/bang-cong`) — cả ba
 * viết `actualTeacherId ?? class.teacherId`, nên mỗi lần quản lý đổi giáo viên cho một
 * buổi là buổi ấy bị quy công cho người KHÔNG dạy. Prod đo được 2 buổi có dạy thay và
 * cả 2 tình cờ không lệch; nhưng đường ghi còn sống, nên đây là lỗ chờ chứ không phải
 * lỗ đã lành (luật 1).
 */
export function giaoVienDuocQuyCong(session: {
  actualTeacherId: string | null;
  substituteTeacherId: string | null;
  class?: { teacherId: string | null } | null;
}): string | null {
  return (
    session.actualTeacherId ??
    session.substituteTeacherId ??
    session.class?.teacherId ??
    null
  );
}

/**
 * Buổi này `userId` đứng lớp với tư cách NGƯỜI DẠY THAY không? [11/10/2026 — màn "Dạy thay" site GV]
 *
 * Cùng phép với cách công tính vai (`lib/cham-cong/cong-day-db.ts`: MAIN ⇔ người đứng lớp là GV phụ
 * trách; còn lại là SUBSTITUTE): màn hình và bảng công không thể nói hai điều khác nhau về cùng một buổi.
 * Lớp chưa gán GV phụ trách (thỉnh giảng) thì không có gì để so — chỉ coi là dạy thay khi buổi đó
 * THẬT SỰ có người dạy thay là mình.
 */
export function laNguoiDayThay(
  userId: string,
  session: {
    actualTeacherId: string | null;
    substituteTeacherId: string | null;
    class?: { teacherId: string | null } | null;
  },
): boolean {
  if (giaoVienDuocQuyCong(session) !== userId) return false;
  const chinh = session.class?.teacherId ?? null;
  return chinh == null ? session.substituteTeacherId === userId : chinh !== userId;
}

/**
 * Điều kiện Prisma `OR` cho *"những buổi tính vào công của người này"*.
 *
 * Dùng cho bảng công cá nhân. Khác `isSessionOwnedByTeacher` ở chỗ **không** có
 * `assignedClassIds`: bảng công phải đếm buổi người ấy ĐỨNG LỚP, không phải mọi buổi của
 * lớp họ được phân vào.
 *
 * `classIds` là danh sách lớp mà người này là GIÁO VIÊN PHỤ TRÁCH — người gọi tự lọc,
 * hàm này không đoán hộ.
 */
export function dieuKienBuoiTinhCong(
  userId: string,
  classIds: readonly string[],
): { OR: Record<string, unknown>[] } {
  return {
    OR: [
      ...(classIds.length > 0 ? [{ classId: { in: [...classIds] } }] : []),
      { actualTeacherId: userId },
      // Nhánh BỊ THIẾU trước 08/09/2026 — buổi được xếp dạy thay không hiện trên bảng
      // công của chính người dạy thay.
      { substituteTeacherId: userId },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CÔNG DẠY THEO NGƯỜI THẬT SỰ DẠY (chủ dự án chốt 11/10/2026)
// ─────────────────────────────────────────────────────────────────────────────
//
// *"Công dạy giáo viên phải đúng người đó dạy, người đó điểm danh, người đó nhận xét — cuối tháng
// tính đúng công người đó dạy. Sale, quản lý không điểm danh hộ."*
//
// Công của một buổi thuộc về `giaoVienDuocQuyCong` (ở trên). Muốn "người điểm danh = người nhận công"
// thì chỉ cần mọi đường GHI điểm danh / nhận xét đòi người thao tác CHÍNH LÀ người đó — và đó là việc
// hàm này làm, ở MỘT chỗ. Giáo viên vắng thì quản lý cơ sở gán người dạy thay (Điều chỉnh buổi / duyệt đơn
// nghỉ có chọn GV thay) TRƯỚC; khi đó `substituteTeacherId` đổi và người dạy thay mới là người được ghi.
//
// ⚠️ Cố ý KHÔNG có nhánh "quản lý / SUPER_ADMIN được qua". Ngoại lệ ấy chính là đường điểm danh hộ.
// ⚠️ Trợ giảng cũng không qua: `giaoVienDuocQuyCong` không có `assistantId` (xem ghi chú ở trên), nên cho họ
// ghi là cho người KHÔNG nhận công ghi thay người nhận công.
// ⚠️ Không xác định được người đứng lớp (lớp thỉnh giảng chưa có GV chính, buổi chưa gán ai) ⇒ KHÔNG chặn:
// không có ai để so, và chặn ở đây là đóng cả lớp lại.

export type ViecCuaNguoiDay = "điểm danh" | "nhận xét";

/**
 * Câu từ chối nếu `userId` KHÔNG phải người đứng lớp của buổi; `null` = được làm.
 * `viec` chỉ để câu nói đúng việc — luật không đổi theo nó.
 */
export function loiKhongPhaiNguoiDay(
  userId: string,
  session: {
    actualTeacherId: string | null;
    substituteTeacherId: string | null;
    class?: { teacherId: string | null } | null;
  },
  viec: ViecCuaNguoiDay,
): string | null {
  const nguoi = giaoVienDuocQuyCong(session);
  if (nguoi === null || nguoi === userId) return null;
  return (
    `Buổi này do giáo viên khác đứng lớp — chỉ người dạy buổi mới được ${viec} (công dạy tính theo người đó). ` +
    `Nếu bạn là người dạy, nhờ quản lý cơ sở gán bạn dạy thay ở mục "Điều chỉnh" của buổi rồi ${viec} lại.`
  );
}
