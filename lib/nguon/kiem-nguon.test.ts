/**
 * Ca [NHH-SRC-04]/[NHH-SRC-05] — `kiemThamChieu`, `kiemGiaiTrinh` (03 §2.8, §9). THUẦN.
 */
import { describe, expect, it } from "vitest";
import { kiemGiaiTrinh, kiemThamChieu, thamChieuSangNguoi } from "./kiem-nguon";

describe("[NHH-SRC-05] kiemGiaiTrinh — nhóm bắt giải trình ≥ 10 ký tự SAU trim", () => {
  const nhom11 = { requiresNote: true };
  const nhomThuong = { requiresNote: false };
  it("biên: 9 ký tự ⇒ lỗi; 10 ⇒ qua", () => {
    expect(kiemGiaiTrinh(nhom11, "123456789")).not.toBeNull();
    expect(kiemGiaiTrinh(nhom11, "1234567890")).toBeNull();
  });
  it("chuỗi 12 ký tự toàn khoảng trắng ⇒ lỗi (trim)", () => {
    expect(kiemGiaiTrinh(nhom11, "            ")).not.toBeNull();
  });
  it("null/undefined ⇒ lỗi với nhóm bắt giải trình", () => {
    expect(kiemGiaiTrinh(nhom11, null)).not.toBeNull();
  });
  it("đối chứng: nhóm thường không đòi giải trình dù để trống", () => {
    expect(kiemGiaiTrinh(nhomThuong, null)).toBeNull();
    expect(kiemGiaiTrinh(nhomThuong, "")).toBeNull();
  });
});

describe("[NHH-SRC-04] kiemThamChieu — nguồn ✅ bắt chọn NGƯỜI", () => {
  const rong = { employeeId: null, parentUserId: null, studentId: null, affiliateId: null };
  it("EMPLOYEE cần employeeId; thiếu ⇒ lỗi; có ⇒ qua", () => {
    expect(kiemThamChieu({ referrerRequirement: "EMPLOYEE" }, null)).not.toBeNull();
    expect(kiemThamChieu({ referrerRequirement: "EMPLOYEE" }, rong)).not.toBeNull();
    expect(kiemThamChieu({ referrerRequirement: "EMPLOYEE" }, { ...rong, employeeId: "E1" })).toBeNull();
  });
  it("PARENT cần user HOẶC học viên", () => {
    expect(kiemThamChieu({ referrerRequirement: "PARENT" }, rong)).not.toBeNull();
    expect(kiemThamChieu({ referrerRequirement: "PARENT" }, { ...rong, parentUserId: "U1" })).toBeNull();
    expect(kiemThamChieu({ referrerRequirement: "PARENT" }, { ...rong, studentId: "S1" })).toBeNull();
  });
  it("AFFILIATE_ORG cần affiliateId (không master ⇒ thực tế chưa chọn được trước PR11)", () => {
    expect(kiemThamChieu({ referrerRequirement: "AFFILIATE_ORG" }, rong)).not.toBeNull();
    expect(kiemThamChieu({ referrerRequirement: "AFFILIATE_ORG" }, { ...rong, affiliateId: "A1" })).toBeNull();
  });
  it("EVENT/NONE: không bắt người (sự kiện chỉ là tuỳ chọn)", () => {
    expect(kiemThamChieu({ referrerRequirement: "EVENT" }, null)).toBeNull();
    expect(kiemThamChieu({ referrerRequirement: "NONE" }, null)).toBeNull();
  });
  it("nhóm KHÔNG đòi người mà vẫn gửi người ⇒ lỗi (không lặng lẽ bỏ qua rồi ghi lệch loại)", () => {
    expect(kiemThamChieu({ referrerRequirement: "NONE" }, { ...rong, employeeId: "E1" })).not.toBeNull();
  });
});

describe("thamChieuSangNguoi — ánh xạ ThamChieuNguon ⇒ cột referrer*", () => {
  it("nhân viên ⇒ kind EMPLOYEE đúng một cột", () => {
    expect(thamChieuSangNguoi({ employeeId: "E1", parentUserId: null, studentId: null, affiliateId: null })).toEqual({
      referrerKind: "EMPLOYEE",
      referrerEmployeeId: "E1",
      referrerParentUserId: null,
      referrerStudentId: null,
      referrerAffiliateId: null,
    });
  });
  it("phụ huynh ⇒ kind PARENT; null ⇒ không người", () => {
    expect(
      thamChieuSangNguoi({ employeeId: null, parentUserId: "U1", studentId: "S1", affiliateId: null }).referrerKind,
    ).toBe("PARENT");
    expect(thamChieuSangNguoi(null).referrerKind).toBeNull();
  });
});

describe("[NHH-SRC-04b] nhóm KHÔNG đòi người (NONE/EVENT): MỌI loại người lạc vào đều bị từ chối, không chỉ nhân sự", () => {
  // Cấy `coNhanSu || coPhuHuynh || coDoiTac` → `coNhanSu`: ca cũ chỉ gửi nhân sự, nên phụ huynh/đối tác lạc loại
  // lọt qua và bị ghi lệch loại người (thứ mà chú thích ở nhánh này nói là "nuốt dữ liệu").
  const nguoi = {
    nhanSu: { employeeId: "E1", parentUserId: null, studentId: null, affiliateId: null },
    phuHuynhUser: { employeeId: null, parentUserId: "U1", studentId: null, affiliateId: null },
    phuHuynhHocVien: { employeeId: null, parentUserId: null, studentId: "S1", affiliateId: null },
    doiTac: { employeeId: null, parentUserId: null, studentId: null, affiliateId: "A1" },
  } as const;
  for (const requirement of ["NONE", "EVENT"] as const) {
    for (const [ten, ref] of Object.entries(nguoi)) {
      it(`${requirement} + ${ten} ⇒ lỗi`, () => {
        expect(kiemThamChieu({ referrerRequirement: requirement }, ref)).toMatch(/không có người giới thiệu/);
      });
    }
    it(`${requirement} + không người ⇒ qua (đối chứng dương)`, () => {
      expect(kiemThamChieu({ referrerRequirement: requirement }, null)).toBeNull();
    });
  }
});

describe("[NHH-SRC-04c] thamChieuSangNguoi — mọi nhánh người; nhân sự thắng; phụ huynh chỉ có học viên vẫn là PARENT", () => {
  // Cấy `ref?.parentUserId || ref?.studentId` → `ref?.parentUserId`: phụ huynh chọn bằng HỌC VIÊN (không có tài khoản PH) rơi sang
  // 'không người' — attribution nói nhóm Phụ huynh giới thiệu mà không biết ai giới thiệu.
  const base = { employeeId: null, parentUserId: null, studentId: null, affiliateId: null };
  it("chỉ studentId ⇒ PARENT mang đúng studentId, user null", () => {
    expect(thamChieuSangNguoi({ ...base, studentId: "S1" })).toEqual({
      referrerKind: "PARENT",
      referrerEmployeeId: null,
      referrerParentUserId: null,
      referrerStudentId: "S1",
      referrerAffiliateId: null,
    });
  });
  it("chỉ parentUserId ⇒ PARENT; cả hai ⇒ PARENT mang cả hai", () => {
    expect(thamChieuSangNguoi({ ...base, parentUserId: "U1" }).referrerKind).toBe("PARENT");
    expect(thamChieuSangNguoi({ ...base, parentUserId: "U1", studentId: "S1" })).toMatchObject({ referrerParentUserId: "U1", referrerStudentId: "S1" });
  });
  it("chỉ affiliateId ⇒ AFFILIATE", () => {
    expect(thamChieuSangNguoi({ ...base, affiliateId: "A1" })).toEqual({
      referrerKind: "AFFILIATE",
      referrerEmployeeId: null,
      referrerParentUserId: null,
      referrerStudentId: null,
      referrerAffiliateId: "A1",
    });
  });
  it("nhiều loại cùng gửi: nhân sự THẮNG, rồi phụ huynh, rồi đối tác — và các cột còn lại luôn null (khớp CHECK một-loại)", () => {
    expect(thamChieuSangNguoi({ employeeId: "E1", parentUserId: "U1", studentId: "S1", affiliateId: "A1" })).toEqual({
      referrerKind: "EMPLOYEE",
      referrerEmployeeId: "E1",
      referrerParentUserId: null,
      referrerStudentId: null,
      referrerAffiliateId: null,
    });
    expect(thamChieuSangNguoi({ employeeId: null, parentUserId: "U1", studentId: null, affiliateId: "A1" }).referrerKind).toBe("PARENT");
  });
});
