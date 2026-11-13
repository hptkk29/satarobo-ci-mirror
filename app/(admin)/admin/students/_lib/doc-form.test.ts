// [DFH] — đọc form hồ sơ học viên + lọc khoá sau parse (25/09/2026). THUẦN, không DB.
//
// Hai lỗi mà bộ ca này ghim (xem đầu `doc-form.ts`):
//   1. ô CÓ MẶT nhưng RỖNG từng thành `undefined` ⇒ Prisma bỏ qua ⇒ không xoá được ô.
//   2. `.partial()` của zod 4 vẫn áp `.default()` ⇒ lượt sửa không gửi `status`/`allergies`
//      lặng lẽ mở lại HV đang bảo lưu và xoá sạch dị ứng.
// Các ca đi QUA CHÍNH schema thật (`studentUpdateSchema`/`studentCreateSchema`) chứ không
// dừng ở hàm đọc form — lỗi (1) chỉ lộ ra khi ghép form × validator.
import { describe, it, expect } from "vitest";
import { docFormHocVien, chiGiuKhoaCoMat } from "./doc-form";
import { studentCreateSchema, studentUpdateSchema } from "@/lib/validators/student";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const BAT_BUOC = {
  name: "Nguyễn Văn A",
  parentName: "Trần Thị B",
  parentPhone: "0905123456",
  orgUnitId: "ou-cs1",
};

/** Đường sửa đầy đủ như `updateStudent`: đọc form → parse → lọc khoá có mặt. */
function duongSua(entries: Record<string, string>) {
  const raw = docFormHocVien(fd(entries), "update");
  const parsed = studentUpdateSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  return chiGiuKhoaCoMat(parsed.data, raw);
}

describe("[DFH] docFormHocVien — vắng / rỗng / có chữ", () => {
  it("[DFH-01] khoá VẮNG MẶT ⇒ undefined (không đụng cột)", () => {
    const raw = docFormHocVien(fd(BAT_BUOC), "update");
    expect("email" in raw).toBe(false);
    expect("school" in raw).toBe(false);
    expect("notes" in raw).toBe(false);
    expect("gender" in raw).toBe(false);
    expect("parentFacebookUrl" in raw).toBe(false);
  });

  it("[DFH-02] khoá CÓ MẶT + rỗng ⇒ '' (để validator xoá về null)", () => {
    const raw = docFormHocVien(
      fd({ ...BAT_BUOC, email: "", school: "  ", notes: "", gender: "", avatarUrl: "" }),
      "update",
    );
    expect(raw.email).toBe("");
    expect(raw.school).toBe("");
    expect(raw.notes).toBe("");
    expect(raw.gender).toBe("");
    expect(raw.avatarUrl).toBe("");
  });

  it("[DFH-03] có chữ ⇒ trim", () => {
    const raw = docFormHocVien(fd({ ...BAT_BUOC, school: "  THCS Lê Lợi  " }), "create");
    expect(raw.school).toBe("THCS Lê Lợi");
  });

  it("[DFH-04] studentCode rỗng ⇒ undefined ở CẢ HAI chế độ (form không xoá mã HV)", () => {
    for (const mode of ["create", "update"] as const) {
      const raw = docFormHocVien(fd({ ...BAT_BUOC, studentCode: "   " }), mode);
      expect("studentCode" in raw, mode).toBe(false);
    }
    expect(docFormHocVien(fd({ ...BAT_BUOC, studentCode: " CS1-26-ABCDEF " }), "update").studentCode)
      .toBe("CS1-26-ABCDEF");
  });

  it("[DFH-05] name/parentName/parentPhone vắng ⇒ '' (bắt buộc ⇒ lỗi validate, không giữ ngầm)", () => {
    const raw = docFormHocVien(fd({}), "update");
    expect(raw.name).toBe("");
    expect(raw.parentName).toBe("");
    expect(raw.parentPhone).toBe("");
    const parsed = studentUpdateSchema.safeParse(raw);
    expect(parsed.success).toBe(false);
  });

  it("[DFH-06] status vắng hoặc rỗng ⇒ undefined", () => {
    expect("status" in docFormHocVien(fd(BAT_BUOC), "update")).toBe(false);
    expect("status" in docFormHocVien(fd({ ...BAT_BUOC, status: "" }), "update")).toBe(false);
    expect(docFormHocVien(fd({ ...BAT_BUOC, status: "PAUSED" }), "update").status).toBe("PAUSED");
  });

  it("[DFH-07] allergies: vắng ⇒ undefined · có mặt ⇒ mảng (kể cả [])", () => {
    expect("allergies" in docFormHocVien(fd(BAT_BUOC), "update")).toBe(false);
    expect(docFormHocVien(fd({ ...BAT_BUOC, allergies: "[]" }), "update").allergies).toEqual([]);
    expect(docFormHocVien(fd({ ...BAT_BUOC, allergies: "" }), "update").allergies).toEqual([]);
    expect(
      docFormHocVien(fd({ ...BAT_BUOC, allergies: '[" Tôm ", "", "Sữa"]' }), "update").allergies,
    ).toEqual(["Tôm", "Sữa"]);
  });

  it("[DFH-08] đọc 3 khoá mới của phụ huynh", () => {
    const raw = docFormHocVien(
      fd({ ...BAT_BUOC, parentGender: "FEMALE", parentDob: "1988-03-04", parentFacebookUrl: "fb.com/abc" }),
      "update",
    );
    expect(raw.parentGender).toBe("FEMALE");
    expect(raw.parentDob).toBe("1988-03-04");
    expect(raw.parentFacebookUrl).toBe("fb.com/abc");
  });

  it("[DFH-09] khoá CŨ (form mới không gửi) vẫn đọc được nếu có mặt", () => {
    const raw = docFormHocVien(
      fd({ ...BAT_BUOC, bloodType: "A_POS", district: "Hải Châu", enrollmentDate: "2025-01-02" }),
      "update",
    );
    expect(raw.bloodType).toBe("A_POS");
    expect(raw.district).toBe("Hải Châu");
    expect(raw.enrollmentDate).toBe("2025-01-02");
  });
});

describe("[DFH] đường SỬA đầy đủ: form × schema × lọc khoá", () => {
  it("[DFH-10] xoá trắng email/trường/ghi chú/giới tính/ảnh ⇒ ghi NULL (lỗi 'không xoá được ô')", () => {
    const data = duongSua({
      ...BAT_BUOC,
      email: "",
      school: "",
      notes: "",
      gender: "",
      avatarUrl: "",
      parentEmail: "",
      parentFacebookUrl: "",
      parentDob: "",
      parentGender: "",
    });
    expect(data).toMatchObject({
      email: null,
      school: null,
      notes: null,
      gender: null,
      avatarUrl: null,
      parentEmail: null,
      parentFacebookUrl: null,
      parentDob: null,
      parentGender: null,
    });
    // Có mặt trong payload ghi (không phải undefined ⇒ Prisma SẼ ghi null).
    for (const k of ["email", "school", "notes", "gender", "avatarUrl"] as const) {
      expect(k in data, k).toBe(true);
    }
  });

  it("[DFH-11] khoá vắng mặt KHÔNG vào payload ghi", () => {
    const data = duongSua(BAT_BUOC);
    for (const k of ["email", "school", "notes", "gender", "bloodType", "district", "enrollmentDate", "phone"]) {
      expect(k in data, k).toBe(false);
    }
  });

  it("[DFH-12] sửa KHÔNG gửi status/allergies ⇒ KHÔNG ghi status='ACTIVE' / allergies=[]", () => {
    // Đối chứng: không lọc thì zod áp default (bằng chứng bẫy còn đó).
    const raw = docFormHocVien(fd(BAT_BUOC), "update");
    const parsed = studentUpdateSchema.parse(raw);
    expect(parsed.status).toBe("ACTIVE");
    expect(parsed.allergies).toEqual([]);

    const data = duongSua(BAT_BUOC);
    expect("status" in data).toBe(false);
    expect("allergies" in data).toBe(false);
  });

  it("[DFH-13] sửa CÓ gửi status/allergies ⇒ ghi đúng giá trị gửi", () => {
    const data = duongSua({ ...BAT_BUOC, status: "PAUSED", allergies: "[]" });
    expect(data.status).toBe("PAUSED");
    expect(data.allergies).toEqual([]);
  });

  it("[DFH-14] studentCode để trống khi sửa ⇒ KHÔNG xoá mã", () => {
    const data = duongSua({ ...BAT_BUOC, studentCode: "" });
    expect("studentCode" in data).toBe(false);
  });

  it("[DFH-15] link Facebook chuẩn hoá; chữ lạ ⇒ lỗi 'Link Facebook không hợp lệ'", () => {
    expect(duongSua({ ...BAT_BUOC, parentFacebookUrl: "minh.nguyen.549" }).parentFacebookUrl)
      .toBe("https://www.facebook.com/minh.nguyen.549");
    const bad = studentUpdateSchema.safeParse(
      docFormHocVien(fd({ ...BAT_BUOC, parentFacebookUrl: "javascript:alert(1)" }), "update"),
    );
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe("Link Facebook không hợp lệ");
  });

  it("[DFH-16] ngày sinh PH ở tương lai ⇒ từ chối; quá khứ ⇒ Date", () => {
    // Mốc tuyệt đối xa hai phía — không phụ thuộc đồng hồ thật (luật 19).
    const bad = studentUpdateSchema.safeParse(
      docFormHocVien(fd({ ...BAT_BUOC, parentDob: "2999-01-01" }), "update"),
    );
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe("Ngày sinh phụ huynh không được ở tương lai");
    const ok = duongSua({ ...BAT_BUOC, parentDob: "1985-06-07" });
    expect(ok.parentDob).toBeInstanceOf(Date);
    expect((ok.parentDob as Date).toISOString().slice(0, 10)).toBe("1985-06-07");
  });

  it("[DFH-17] giới tính PH lạ ⇒ lỗi validate (enum)", () => {
    const bad = studentUpdateSchema.safeParse(
      docFormHocVien(fd({ ...BAT_BUOC, parentGender: "Nữ" }), "update"),
    );
    expect(bad.success).toBe(false);
  });
});

describe("[DFH] đường TẠO", () => {
  it("[DFH-18] tạo mới: vắng status ⇒ ACTIVE, vắng allergies ⇒ [], ô vắng ⇒ null", () => {
    const raw = docFormHocVien(fd(BAT_BUOC), "create");
    const parsed = studentCreateSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.status).toBe("ACTIVE");
    expect(parsed.data.allergies).toEqual([]);
    expect(parsed.data.email).toBeNull();
    expect(parsed.data.parentFacebookUrl).toBeNull();
    expect(parsed.data.studentCode).toBeNull();
  });

  it("[DFH-19] tạo mới: rỗng ⇒ null (giống vắng)", () => {
    const parsed = studentCreateSchema.safeParse(
      docFormHocVien(fd({ ...BAT_BUOC, email: "", school: "", parentDob: "" }), "create"),
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.email).toBeNull();
    expect(parsed.data.school).toBeNull();
    expect(parsed.data.parentDob).toBeNull();
  });
});

describe("[DFH] chiGiuKhoaCoMat", () => {
  it("[DFH-20] chỉ giữ khoá mà raw có giá trị khác undefined (null vẫn giữ)", () => {
    const out = chiGiuKhoaCoMat(
      { a: 1, b: null, c: "x", d: [] as string[] },
      { a: "1", b: "", d: undefined },
    );
    expect(out).toEqual({ a: 1, b: null });
  });
});
