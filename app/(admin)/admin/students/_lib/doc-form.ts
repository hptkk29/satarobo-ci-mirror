// app/(admin)/admin/students/_lib/doc-form.ts — ĐỌC FormData của form hồ sơ học viên
// (25/09/2026). Tách khỏi `_actions.ts` vì file đó là `'use server'` — chỉ được export
// hàm async, nên không test thuần được phần đọc form.
//
// ── LỖI "KHÔNG XOÁ ĐƯỢC Ô" (đo 25/09/2026) ────────────────────────────────────────
// Bản cũ (`readForm`) biến ô CÓ MẶT nhưng RỖNG thành `undefined`. Prisma bỏ qua khoá
// `undefined` ⇒ người dùng xoá trắng email/trường/ghi chú/giới tính rồi bấm Lưu, form
// báo thành công, DB GIỮ NGUYÊN giá trị cũ — lời hứa suông (luật 12). Ảnh đại diện
// cũng vậy: gỡ ảnh xong lưu, ảnh cũ quay lại.
//
// LUẬT MỚI — phân biệt "không đụng" với "xoá trắng" bằng SỰ CÓ MẶT của khoá:
//   · khoá VẮNG MẶT trong FormData        ⇒ `undefined` (không đụng cột đó)
//   · khoá CÓ MẶT với chuỗi rỗng ""       ⇒ `""` (validator đổi thành null ⇒ XOÁ)
//   · khoá có giá trị                     ⇒ giá trị đã trim
// Ngoại lệ (cố ý):
//   · `studentCode` rỗng ⇒ `undefined` — form này KHÔNG bao giờ xoá mã học viên
//     (tạo mới: để trống thì hệ thống tự sinh; sửa: mã đổi qua luồng có lý do riêng).
//   · `name` / `parentName` / `parentPhone` vắng hoặc rỗng ⇒ `""` — bắt buộc, để
//     validator báo lỗi như trước (không lặng lẽ giữ giá trị cũ).
//   · `status` vắng hoặc rỗng ⇒ `undefined` — trạng thái không "xoá" được; tạo mới
//     thì schema tự đặt ACTIVE.
//   · `allergies` có mặt ⇒ mảng đã parse (có thể `[]` = xoá hết); vắng ⇒ `undefined`.
//
// ── BẪY THỨ HAI: `.partial()` VẪN ÁP `.default()` (đo zod 4.4.3, 25/09/2026) ──────
// `studentUpdateSchema = studentCreateSchema.partial()` nhưng khoá vắng mặt vẫn ra
// `status: "ACTIVE"` và `allergies: []` ⇒ một lượt sửa không gửi hai ô đó sẽ LẶNG LẼ
// mở lại học viên đang Bảo lưu/Tốt nghiệp và xoá sạch dị ứng. `chiGiuKhoaCoMat` lọc
// kết quả parse về đúng những khoá người dùng thật sự gửi.
//
// THUẦN — không import server, không đụng DB.

export type CheDoDocForm = "create" | "update";

/** Hình dạng thô (chưa validate) đưa vào `studentCreateSchema` / `studentUpdateSchema`. */
export type FormHocVienTho = {
  name: string;
  studentCode?: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  email?: string;
  avatarUrl?: string;

  currentGrade?: string;
  school?: string;

  parentName: string;
  parentPhone?: string;
  parentEmail?: string;
  parentRelation?: string;
  parentNationalId?: string;
  parentGender?: string;
  parentDob?: string;
  parentFacebookUrl?: string;
  parent2Name?: string;
  parent2Phone?: string;
  parent2Relation?: string;

  address?: string;
  ward?: string;
  district?: string;
  city?: string;

  bloodType?: string;
  allergies?: string[];
  healthNotes?: string;

  enrollmentDate?: string;
  preferredOrgUnitId?: string;
  notes?: string;
  status?: string;

  orgUnitId?: string;
};

/**
 * Khoá tuỳ chọn đọc theo luật "vắng ⇒ undefined · rỗng ⇒ '' · có chữ ⇒ trim".
 * Gồm cả khoá CŨ mà form mới không gửi nữa (nhóm máu, quận/huyện, đơn vị mong muốn,
 * ngày đăng ký, SĐT/email riêng của HV) — vắng mặt thì không đụng, dữ liệu cũ giữ nguyên.
 */
const KHOA_TUY_CHON = [
  "dateOfBirth",
  "gender",
  "phone",
  "email",
  "avatarUrl",
  "currentGrade",
  "school",
  "parentEmail",
  "parentRelation",
  "parentNationalId",
  "parentGender",
  "parentDob",
  "parentFacebookUrl",
  "parent2Name",
  "parent2Phone",
  "parent2Relation",
  "address",
  "ward",
  "district",
  "city",
  "bloodType",
  "healthNotes",
  "enrollmentDate",
  "preferredOrgUnitId",
  "notes",
  "orgUnitId",
] as const satisfies readonly (keyof FormHocVienTho)[];

/** Vắng mặt (hoặc là File) ⇒ undefined; có mặt ⇒ chuỗi đã trim (có thể ""). */
function docO(fd: FormData, key: string): string | undefined {
  if (!fd.has(key)) return undefined;
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : undefined;
}

/** Có mặt và có chữ ⇒ chuỗi; còn lại ⇒ undefined. */
function coChuHoacBo(fd: FormData, key: string): string | undefined {
  const v = docO(fd, key);
  return v ? v : undefined;
}

function parseAllergies(value: string): string[] {
  if (value === "") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((s) => (typeof s === "string" ? s.trim() : String(s).trim()))
        .filter((s) => s.length > 0);
    }
  } catch {
    // chuỗi không phải JSON ⇒ coi như danh sách rỗng (giữ hành vi cũ)
  }
  return [];
}

/**
 * Đọc FormData của form hồ sơ học viên. `mode` hiện KHÔNG đổi luật đọc (hai chế độ đọc
 * giống nhau) — tham số giữ lại để chỗ gọi nói rõ mình đang ở đường nào, và để luật
 * riêng từng chế độ (nếu có sau này) không phải đổi chữ ký.
 */
export function docFormHocVien(fd: FormData, mode: CheDoDocForm): FormHocVienTho {
  void mode;
  const out: FormHocVienTho = {
    name: docO(fd, "name") ?? "",
    parentName: docO(fd, "parentName") ?? "",
    parentPhone: docO(fd, "parentPhone") ?? "",
  };

  const code = coChuHoacBo(fd, "studentCode");
  if (code !== undefined) out.studentCode = code;

  const status = coChuHoacBo(fd, "status");
  if (status !== undefined) out.status = status;

  for (const k of KHOA_TUY_CHON) {
    const v = docO(fd, k);
    if (v !== undefined) out[k] = v;
  }

  const allergies = docO(fd, "allergies");
  if (allergies !== undefined) out.allergies = parseAllergies(allergies);

  return out;
}

/**
 * Giữ lại CHỈ những khoá mà người dùng thật sự gửi (`raw[k] !== undefined`).
 *
 * Dùng SAU `studentUpdateSchema.safeParse(raw)`: zod áp `.default()` cho khoá vắng mặt
 * kể cả qua `.partial()`, nên không lọc thì `status` về ACTIVE và `allergies` về `[]`
 * ở MỌI lượt sửa không gửi hai ô đó.
 */
export function chiGiuKhoaCoMat<T extends Record<string, unknown>>(
  parsed: T,
  raw: Partial<Record<keyof T, unknown>>,
): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(parsed) as (keyof T)[]) {
    if (raw[k] !== undefined) out[k] = parsed[k];
  }
  return out;
}

/**
 * Đổi CƠ SỞ thì "cơ sở ưu tiên" có đi theo không (25/09/2026).
 *
 * Form hồ sơ đã bỏ ô "Đơn vị mong muốn" (quyết định D3), nên không còn chỗ nào sửa
 * `preferredCenterId` — mà cột đó vẫn được đọc: cột "Cơ sở" ở danh sách /students ưu tiên nó
 * hơn `centerId`, bộ lọc theo cơ sở cũng vậy, và cổng phụ huynh dùng nó để chọn thông báo /
 * khảo sát. Import Excel ghi HAI cột bằng nhau, nên sau một lần đổi cơ sở trên form, học
 * viên hiện sai cơ sở ở mọi màn đó mà không còn cách sửa.
 *
 * Luật hẹp, không đoán: chỉ khi ưu tiên ĐANG TRÙNG cơ sở cũ (tức nó chỉ là bản sao) thì mới
 * dời theo cơ sở mới. Ưu tiên khác cơ sở cũ là một lựa chọn thật — giữ nguyên. Form có gửi
 * ô ưu tiên (đường cũ / import) thì để form quyết.
 *
 * Trả `null` = không đụng.
 */
export function uuTienTheoCoSoMoi(input: {
  truoc: { centerId: string | null; preferredCenterId: string | null };
  centerIdMoi: string | null | undefined;
  orgUnitIdMoi: string | null | undefined;
  formGuiUuTien: boolean;
}): { preferredCenterId: string | null; preferredOrgUnitId: string | null } | null {
  const { truoc, centerIdMoi, orgUnitIdMoi, formGuiUuTien } = input;
  if (formGuiUuTien || centerIdMoi === undefined) return null;
  if (centerIdMoi === truoc.centerId) return null;
  if (truoc.preferredCenterId === null || truoc.preferredCenterId !== truoc.centerId) return null;
  return { preferredCenterId: centerIdMoi, preferredOrgUnitId: orgUnitIdMoi ?? null };
}
