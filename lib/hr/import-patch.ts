// lib/hr/import-patch.ts — nhập nhân sự: đường CẬP NHẬT là VÁ, không phải THAY THẾ.
// THUẦN, test không cần DB.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao (08/09/2026)
//
// `app/api/admin/import/employees/route.ts` trước đây dùng `update: base` với TOÀN BỘ
// trường. Cột thiếu trong file → Zod biến `undefined` thành `null` → GHI ĐÈ NULL. Và
// `status` có `.default("ACTIVE")` nên một file gán cơ sở thiếu cột `status` sẽ IM LẶNG
// cho người đã nghỉ đi làm lại — kèm `isActive` suy theo.
//
// Tức lượt nhập để sửa MỘT cột có thể xoá phone, email, ngày sinh, ngày vào làm, môn
// dạy, chứng chỉ… của cả bảng, không để lại AuditLog nào (endpoint này không ghi audit).
//
// ⚠️ "CÓ MẶT" nghĩa là gì: client dựng object đủ khoá rồi `JSON.stringify`, mà khoá
// `undefined` bị bỏ — nên Ô TRỐNG và CỘT THIẾU tới server giống hệt nhau, và cả hai đều
// nghĩa là KHÔNG ĐỤNG TỚI. Muốn XOÁ một trường thì sửa ở màn hồ sơ, không qua import.
// Đây là chiều an toàn, chọn có chủ đích: nhập nhầm không xoá được dữ liệu.

/** Cột trong file → (các) trường được phép ghi. Cột nguồn khác tên cột đích thì khai ở đây. */
export const ANH_XA_COT: Readonly<Record<string, readonly string[]>> = {
  fullName: ["fullName"],
  jobTitle: ["jobTitle"],
  department: ["department"],
  phone: ["phone"],
  email: ["email"],
  dateOfBirth: ["dateOfBirth"],
  gender: ["gender"],
  nationalId: ["nationalId"],
  contractType: ["contractType"],
  joinedAt: ["joinedAt"],
  endDate: ["endDate"],
  address: ["address"],
  subjects: ["subjects"],
  certifications: ["certifications"],
  bio: ["bio"],
  emergencyContact: ["emergencyContact"],
  notes: ["notes"],
  // Cột nguồn là slug/mã, trường đích là id (+ ghi kép orgUnitId).
  centerSlug: ["centerId", "orgUnitId"],
  managerCode: ["managerId"],
  // `isActive` SUY TỪ `status` ⇒ chỉ tính lại khi file có cột `status`.
  status: ["status", "isActive"],
};

/**
 * Dựng `data` cho `employee.update` — CHỈ những trường có cột tương ứng trong file.
 *
 * `giaTri` là bản ghi đã chuẩn hoá đầy đủ (dùng cho đường TẠO MỚI); hàm này lọc nó theo
 * `coMat`. Trả object RỖNG nghĩa là file không có cột nào để ghi ⇒ caller đừng gọi
 * `update`, vì `update` với data rỗng vẫn đụng `updatedAt`.
 */
/**
 * Những cột THỰC SỰ có mặt trong file, theo nghĩa của màn nhập:
 * **ô để trống là GIỮ NGUYÊN, không phải xoá.**
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CA SINH RA HÀM NÀY — sự cố PROD 08/09/2026
 *
 * Một file 9 cột (`centerSlug, dateOfBirth, department, employeeCode, endDate,
 * fullName, jobTitle, joinedAt, status`) trong đó ba cột ngày ĐỂ TRỐNG đã XOÁ TRẮNG
 * `dateOfBirth`/`joinedAt`/`endDate` trên 9 hồ sơ. Mất thật: ngày sinh của SR.NV.001 và
 * SR.NV.010, và `endDate = 2030-12-31` của SR.NV.001.
 *
 * Chuỗi ba mắt:
 *   1. `ExcelImporter` đọc sheet với `{ defval: null }` ⇒ ô trống thành `null`,
 *      KHÔNG phải vắng mặt;
 *   2. màn nhập cho ba cột ngày đi thẳng (`row.joinedAt as …`) trong khi mọi cột khác
 *      qua `asString()` — hàm trả `undefined`, và `JSON.stringify` rụng `undefined`
 *      nhưng GIỮ `null`;
 *   3. route dựng `coMat` bằng `Object.keys(row)` — `null` là key có mặt.
 *
 * Mắt 2 giải thích vì sao ĐÚNG ba cột ngày chết còn `department`/`status`/`email` để
 * trống thì không: chúng rụng khỏi payload từ trước. Đối chứng có thật trong audit prod
 * cùng ngày — một lượt nhập có 6 cột trống kiểu đó chỉ đổi mỗi `phone`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO CỔNG ĐẶT Ở ĐÂY, KHÔNG PHẢI Ở MÀN NHẬP
 *
 * Vá mắt 2 chỉ chữa một client. Route là nơi GHI, nên nó phải tự định nghĩa "có cột" —
 * và định nghĩa đó phải trùng câu đang in trên màn: ô trống = giữ nguyên.
 *
 * Cổng theo GIÁ TRỊ nên nó kín cho MỌI HỌ CỘT, không riêng ngày: enum (`status`,
 * `gender`, `contractType`), quan hệ (`centerSlug`, `managerCode`), JSON
 * (`subjects`, `certifications`), chuỗi. Vá riêng ba cột ngày là để y nguyên cái bẫy
 * cho cột thứ tư ai đó thêm sau.
 *
 * ⚠️ Hệ quả có chủ đích: **không có cách nào XOÁ một trường qua file nhập.** Đó là
 * chiều an toàn đã chọn, và màn nhập nói thẳng ra — muốn xoá thì sửa ở màn hồ sơ.
 */
export function cotCoMat(row: Readonly<Record<string, unknown>>): Set<string> {
  const co = new Set<string>();
  for (const [k, v] of Object.entries(row)) {
    // `null` (ô trống qua `defval: null`) · `undefined` · chuỗi rỗng hoặc chỉ khoảng
    // trắng ⇒ KHÔNG tính là có cột.
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    co.add(k);
  }
  return co;
}

export function dungPatchNhanSu(
  giaTri: Readonly<Record<string, unknown>>,
  coMat: ReadonlySet<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [cot, truongs] of Object.entries(ANH_XA_COT)) {
    if (!coMat.has(cot)) continue;
    for (const t of truongs) patch[t] = giaTri[t];
  }
  return patch;
}
