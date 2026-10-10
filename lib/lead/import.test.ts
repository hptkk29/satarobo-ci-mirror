import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  isValidPhone,
  parseChildAge,
  normalizeCenterCode,
  parseLeadImportRow,
  resolveDefaultCenterId,
  LEAD_IMPORT_COLUMNS,
  LEAD_IMPORT_CENTER_HEADER,
} from "./import";

describe("resolveDefaultCenterId — ô Cơ sở để trống (26/07)", () => {
  it("[IMP-C1] QL/sale 1 cơ sở → lead tự về cơ sở đó (trước đây bị chặn 'cần HO/SUPER_ADMIN')", () => {
    expect(resolveDefaultCenterId(["cs1"], "cs1")).toBe("cs1");
    expect(resolveDefaultCenterId(["cs1"], null)).toBe("cs1");
  });

  it("[IMP-C2] HO/SUPER_ADMIN (ALL) → giữ nguyên: để trống = lead không gắn cơ sở", () => {
    expect(resolveDefaultCenterId("ALL", "cs1")).toBeNull();
  });

  it("[IMP-C3] thấy nhiều cơ sở → lấy cơ sở gốc nếu nằm trong tầm nhìn, không thì null", () => {
    expect(resolveDefaultCenterId(["cs1", "cs2"], "cs2")).toBe("cs2");
    expect(resolveDefaultCenterId(["cs1", "cs2"], "cs9")).toBeNull();
    expect(resolveDefaultCenterId([], "cs1")).toBeNull();
  });
});

describe("lead import helpers", () => {
  it("normalizePhone chuẩn hoá mọi cách gõ về canonical 84XXXXXXXXX", () => {
    expect(normalizePhone("+84 901 234 567")).toBe("84901234567");
    expect(normalizePhone("0901.234.567")).toBe("84901234567");
    expect(normalizePhone("84901234567")).toBe("84901234567");
  });

  it("isValidPhone", () => {
    expect(isValidPhone("84901234567")).toBe(true);
    expect(isValidPhone("0123456789")).toBe(false); // đầu số 1 không hợp lệ
    expect(isValidPhone("12345")).toBe(false);
  });

  it("parseChildAge", () => {
    expect(parseChildAge("")).toEqual({ age: null });
    expect(parseChildAge("8")).toEqual({ age: 8 });
    expect("error" in parseChildAge("2")).toBe(true);
    expect("error" in parseChildAge("25")).toBe(true);
  });

  it("normalizeCenterCode — chỉ chuẩn hoá format, KHÔNG hardcode CS hợp lệ", () => {
    expect(normalizeCenterCode("")).toEqual({ code: null });
    expect(normalizeCenterCode("cs1")).toEqual({ code: "CS1" });
    expect(normalizeCenterCode(" CS2 ")).toEqual({ code: "CS2" });
    // CS3/CS4… mở thêm = data, helper phải chấp nhận (validity do DB resolve).
    expect(normalizeCenterCode("CS3")).toEqual({ code: "CS3" });
    // Format rõ ràng sai → lỗi sớm.
    expect("error" in normalizeCenterCode("@@")).toBe(true);
  });

  it("parseLeadImportRow hợp lệ", () => {
    const r = parseLeadImportRow({
      "Tên phụ huynh": "Nguyễn Văn A",
      "SĐT": "+84901234567",
      Email: "a@example.com",
      "Tên con": "Bé Bo",
      "Tuổi con": "8",
      [LEAD_IMPORT_CENTER_HEADER]: "CS1",
      "Khoá quan tâm": "Lập trình Robot",
      "Nguồn": "Sự kiện",
      "Ghi chú": "Quan tâm khoá hè",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.phone).toBe("84901234567");
      expect(r.data.centerCode).toBe("CS1");
      expect(r.data.childAge).toBe(8);
      expect(r.data.source).toBe("Sự kiện");
    }
  });

  it("parseLeadImportRow thiếu SĐT / sai SĐT", () => {
    expect(parseLeadImportRow({ "Tên phụ huynh": "A", "SĐT": "" }).ok).toBe(false);
    expect(parseLeadImportRow({ "Tên phụ huynh": "A", "SĐT": "abc" }).ok).toBe(false);
  });

  it("cột chuẩn đúng thứ tự", () => {
    expect(LEAD_IMPORT_COLUMNS[0]).toBe("Tên phụ huynh");
    expect(LEAD_IMPORT_COLUMNS[1]).toBe("SĐT");
    // 04/09/2026 — thêm cột "Sale phụ trách" (tuỳ chọn) ở CUỐI.
    expect(LEAD_IMPORT_COLUMNS.length).toBe(10);
    expect(LEAD_IMPORT_COLUMNS[9]).toContain("Sale phụ trách");
  });
});

describe("cột 'Sale phụ trách' — TUỲ CHỌN (chủ dự án chốt 04/09/2026)", () => {
  const dongCoBan = {
    "Tên phụ huynh": "Chị An",
    "SĐT": "0905123456",
  };

  it("để trống → saleRaw null ⇒ tầng chia hiểu là MÁY CHIA", () => {
    const r = parseLeadImportRow(dongCoBan);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.saleRaw).toBeNull();
  });

  it("khoảng trắng cũng tính là để trống", () => {
    const r = parseLeadImportRow({ ...dongCoBan, [LEAD_IMPORT_COLUMNS[9]]: "   " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.saleRaw).toBeNull();
  });

  it("nhận EMAIL", () => {
    const r = parseLeadImportRow({ ...dongCoBan, [LEAD_IMPORT_COLUMNS[9]]: "sale1@satarobo.vn" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.saleRaw).toBe("sale1@satarobo.vn");
  });

  it("nhận MÃ NHÂN VIÊN — người nhập cầm bảng nào gõ bảng đó", () => {
    const r = parseLeadImportRow({ ...dongCoBan, [LEAD_IMPORT_COLUMNS[9]]: "NV-012" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.saleRaw).toBe("NV-012");
  });

  it("gõ SAI vẫn NHẬN DÒNG — không bỏ lead vì một ô tuỳ chọn", () => {
    // Tầng thuần này không biết ai là sale; tra người + kiểm vai/cơ sở làm ở tầng
    // DB, và ở đó sai thì CẢNH BÁO rồi để máy chia. Mất một lead thật vì gõ sai
    // một ô tuỳ chọn là đổi hỏng lấy hỏng.
    const r = parseLeadImportRow({ ...dongCoBan, [LEAD_IMPORT_COLUMNS[9]]: "không-có-ai-tên-vậy" });
    expect(r.ok).toBe(true);
  });
});
