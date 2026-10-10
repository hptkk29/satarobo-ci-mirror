/**
 * "Lượt sửa này ĐỔI những trường nào?" — để dòng lịch sử kể đúng việc đã làm.
 *
 * ── VÌ SAO KHÔNG LIỆT KÊ CẢ FORM ──────────────────────────────────────────────────────
 * Form lead/con gửi lên TOÀN BỘ các ô mỗi lần lưu, kể cả ô không ai chạm. Lấy nguyên
 * danh sách ô gửi lên mà ghi vào lịch sử thì mọi lượt sửa đều đọc là "sửa hồ sơ lead: tên
 * phụ huynh, email, tên con, tuổi con, khoá quan tâm…" — đúng về mặt dữ liệu gửi đi, và
 * vô dụng với người đọc, vì nó không phân biệt được lượt sửa một ô với lượt bấm Lưu suông.
 *
 * Sai lầm này đã xảy ra một lần ở chính repo: thông báo "Không sửa được" của khoá ô
 * (`loiOKhoa`) từng kể tên cả những trường người dùng KHÔNG chạm, vì nó đọc danh sách ô
 * gửi lên chứ không so với giá trị đang lưu.
 *
 * ── HAI GIÁ TRỊ "TRỐNG" PHẢI COI LÀ MỘT ───────────────────────────────────────────────
 * `null` (DB) và `""` (form) là cùng một nghĩa "chưa điền". Không gộp thì mỗi lượt bấm Lưu
 * trên một hồ sơ có ô để trống đều sinh một dòng lịch sử "đã sửa" giả.
 */

/** So `cu` với `moi`, chỉ trên các khoá CÓ MẶT trong `moi` và CÓ NHÃN. */
export function truongDaDoi(
  cu: Record<string, unknown>,
  moi: Record<string, unknown>,
  nhan: Record<string, string>,
): string[] {
  const ra: string[] = [];
  for (const [khoa, ten] of Object.entries(nhan)) {
    if (!(khoa in moi)) continue;
    if (!bang(cu[khoa], moi[khoa])) ra.push(ten);
  }
  return ra;
}

function bang(a: unknown, b: unknown): boolean {
  if (trong(a) && trong(b)) return true;
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : Date.parse(String(a));
    const tb = b instanceof Date ? b.getTime() : Date.parse(String(b));
    // Ngày không đọc được ở một bên ⇒ so bằng chuỗi thay vì kết luận "khác nhau"
    // (kết luận sai chỉ sinh dòng lịch sử giả, nhưng vẫn là nói không đúng).
    if (Number.isNaN(ta) || Number.isNaN(tb)) return String(a) === String(b);
    return ta === tb;
  }
  return String(a) === String(b);
}

function trong(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

/** Nhãn tiếng Việt cho các ô của MỘT CON trong lead (`leadChildData`). */
export const NHAN_TRUONG_CON: Record<string, string> = {
  fullName: "tên",
  dob: "ngày sinh",
  ageYears: "tuổi",
  gender: "giới tính",
  schoolName: "trường",
  gradeLevel: "khối lớp",
  interestedCourseId: "khoá quan tâm",
  interestedCenterId: "cơ sở quan tâm",
  note: "ghi chú",
};

/** Nhãn tiếng Việt cho các ô của HỒ SƠ LEAD. */
export const NHAN_TRUONG_LEAD: Record<string, string> = {
  parentName: "tên phụ huynh",
  phone: "số điện thoại",
  email: "email",
  childName: "tên con",
  childAge: "tuổi con",
  courseId: "khoá quan tâm",
  centerId: "đơn vị",
  source: "nguồn",
  note: "ghi chú",
  facebookUrl: "Facebook",
  zaloPhone: "Zalo",
  address: "địa chỉ",
};
