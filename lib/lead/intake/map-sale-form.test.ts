import { describe, it, expect } from "vitest";
import { mapSaleForm, SALE_FORM_FIELDS } from "./map-sale-form";

/** Phiếu đầy đủ như Sale điền thật (tên trường giữ nguyên của MISA). */
function form(over: Record<string, string> = {}): Record<string, string> {
  return {
    [SALE_FORM_FIELDS.childName]: "Nguyễn Minh Khoa",
    [SALE_FORM_FIELDS.parentName]: "Chị Nguyễn Thị An",
    [SALE_FORM_FIELDS.phone]: "0905 123 456",
    [SALE_FORM_FIELDS.email]: "an@example.com",
    [SALE_FORM_FIELDS.centerIndex]: "2",
    [SALE_FORM_FIELDS.schoolName]: "TH Phù Đổng",
    [SALE_FORM_FIELDS.gradeLevel]: "Lớp 4",
    [SALE_FORM_FIELDS.employeeCode]: "NV001",
    [SALE_FORM_FIELDS.provinceId]: "7480",
    [SALE_FORM_FIELDS.address]: "12 Lê Lợi",
    ...over,
  };
}

function ok(payload: Record<string, string>) {
  const r = mapSaleForm(payload);
  if (!r.ok) throw new Error(`mong đợi map thành công, nhận: ${r.error}`);
  return r.lead;
}

describe("mapSaleForm — phiếu hợp lệ", () => {
  it("map đủ trường, SĐT về canonical 84…", () => {
    const lead = ok(form());
    expect(lead.parentName).toBe("Chị Nguyễn Thị An");
    expect(lead.phone).toBe("84905123456");
    expect(lead.email).toBe("an@example.com");
    expect(lead.centerHint).toEqual({ kind: "code", value: "CS2" });
    expect(lead.employeeCode).toBe("NV001");
    expect(lead.warnings).toEqual([]);
  });

  it("LastName là TÊN CON chứ không phải tên phụ huynh", () => {
    const lead = ok(form());
    expect(lead.children).toEqual([
      {
        fullName: "Nguyễn Minh Khoa",
        schoolName: "TH Phù Đổng",
        gradeLevel: "Lớp 4",
      },
    ]);
    expect(lead.parentName).not.toBe("Nguyễn Minh Khoa");
  });

  it("đổi mã tỉnh MISA thành tên đọc được trong ghi chú", () => {
    expect(ok(form()).noteLines).toContain("Tỉnh/TP: Đà Nẵng");
  });

  it("ghi địa chỉ và mã nhân viên vào ghi chú", () => {
    const notes = ok(form()).noteLines;
    expect(notes).toContain("Địa chỉ: 12 Lê Lợi");
    expect(notes).toContain("Nhân viên nhập: NV001");
  });
});

describe("mapSaleForm — chuẩn hoá SĐT", () => {
  // Hình dạng SĐT có thật trong dữ liệu (§6-F2 của plan).
  it.each([
    ["0905123456", "84905123456"],
    ["905123456", "84905123456"], // ô số nuốt mất số 0 đầu
    ["84905123456", "84905123456"],
    ["+84 905 123 456", "84905123456"],
    ["0905.123.456", "84905123456"],
  ])("%s → %s", (input, expected) => {
    expect(ok(form({ [SALE_FORM_FIELDS.phone]: input })).phone).toBe(expected);
  });
});

describe("mapSaleForm — từ chối", () => {
  it("thiếu SĐT ⇒ từ chối (MISA không bắt buộc, ta bắt buộc)", () => {
    const r = mapSaleForm(form({ [SALE_FORM_FIELDS.phone]: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Thiếu số điện thoại");
  });

  it.each(["79742424", "123", "02363123456", "abc"])(
    "SĐT sai dạng %s ⇒ từ chối chứ không đoán",
    (bad) => {
      const r = mapSaleForm(form({ [SALE_FORM_FIELDS.phone]: bad }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("không hợp lệ");
    },
  );
});

describe("mapSaleForm — phiếu thiếu thông tin", () => {
  it("thiếu tên PH ⇒ dựng fallback từ tên con + cảnh báo", () => {
    const lead = ok(form({ [SALE_FORM_FIELDS.parentName]: "" }));
    expect(lead.parentName).toBe("PH của Nguyễn Minh Khoa");
    expect(lead.warnings.join(" ")).toContain("không có tên phụ huynh");
  });

  it("thiếu cả tên PH lẫn tên con vẫn ra lead dùng được", () => {
    const lead = ok(
      form({
        [SALE_FORM_FIELDS.parentName]: "",
        [SALE_FORM_FIELDS.childName]: "",
      }),
    );
    expect(lead.parentName).toBe("Phụ huynh (chưa rõ tên)");
    expect(lead.children).toEqual([]);
  });

  it("không chọn cơ sở ⇒ centerHint null (rơi về auto-chia)", () => {
    expect(ok(form({ [SALE_FORM_FIELDS.centerIndex]: "" })).centerHint).toBeNull();
  });

  it("mã tỉnh lạ ⇒ cảnh báo, không nuốt im lặng", () => {
    const lead = ok(form({ [SALE_FORM_FIELDS.provinceId]: "99999" }));
    expect(lead.warnings.join(" ")).toContain("99999");
    expect(lead.noteLines.join(" ")).not.toContain("Tỉnh/TP:");
  });

  it("payload rỗng hoàn toàn ⇒ từ chối, không ném", () => {
    expect(mapSaleForm({}).ok).toBe(false);
  });
});

// ── Ca bổ sung sau vòng review đối kháng 16/08 ────────────────────────────────

describe("mapSaleForm — trần độ dài (endpoint công khai)", () => {
  it.each([
    [SALE_FORM_FIELDS.parentName, 101, "Tên phụ huynh"],
    [SALE_FORM_FIELDS.childName, 101, "Tên học sinh"],
    [SALE_FORM_FIELDS.address, 256, "Địa chỉ chi tiết"],
    [SALE_FORM_FIELDS.schoolName, 151, "Trường con đang học"],
  ])("%s dài %i ký tự ⇒ từ chối và nêu tên trường", (field, len, label) => {
    const r = mapSaleForm(form({ [field]: "x".repeat(len) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(label);
  });

  it("đúng bằng trần thì vẫn nhận", () => {
    expect(mapSaleForm(form({ [SALE_FORM_FIELDS.parentName]: "x".repeat(100) })).ok).toBe(
      true,
    );
  });
});

describe("mapSaleForm — email", () => {
  it("email sai định dạng ⇒ không lưu nhưng KHÔNG chặn phiếu", () => {
    const lead = ok(form({ [SALE_FORM_FIELDS.email]: "abc@@x" }));
    expect(lead.email).toBeNull();
    expect(lead.warnings.join(" ")).toContain("sai định dạng");
  });

  it("email hợp lệ vẫn giữ nguyên", () => {
    expect(ok(form()).email).toBe("an@example.com");
  });
});
