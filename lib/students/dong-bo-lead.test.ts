/**
 * Ca [DBL-*] — phần THUẦN của đồng bộ hai chiều hồ sơ học viên ↔ phiếu lead (26/09/2026).
 *
 * Chủ dự án 26/09: "đổi 1 nơi thì các nơi khác phải đổi hết". Ba chỗ dễ sai nhất, và cả ba đều
 * im lặng nếu sai: (1) SĐT hai bên lưu hai dạng ("0905…" vs "84905…") ⇒ so thô là mỗi lượt lưu
 * "đổi" SĐT một lần và đẻ nhật ký rỗng ruột; (2) ô vắng mặt bị coi là xoá ⇒ lượt sửa một ô đè
 * trắng mọi ô khác; (3) giá trị không dịch được ("Mầm non") bị ép thành một số lớp.
 */
import { describe, expect, it } from "vitest";
import {
  bangNhau,
  chiOConLead,
  chiOKhacDich,
  chiOPhLead,
  conHvSangLead,
  conLeadSangHv,
  oDaDoi,
  phHvSangLead,
  phLeadSangHv,
} from "./dong-bo-lead";

describe("bangNhau — so theo NGHĨA", () => {
  it("[DBL-01] SĐT so dạng chuẩn: 0905… ≡ 84905… ≡ +84 905 …", () => {
    expect(bangNhau("parentPhone", "0905123456", "84905123456")).toBe(true);
    expect(bangNhau("phone", "+84 905 123 456", "0905123456")).toBe(true);
    // Đối chứng: số khác ⇒ khác.
    expect(bangNhau("phone", "0905123456", "0905123457")).toBe(false);
  });

  it("[DBL-02] ngày so theo NGÀY LỊCH VN; chuỗi bỏ khoảng trắng hai đầu; rỗng ≡ null", () => {
    expect(
      bangNhau("parentDob", new Date("1988-02-03T00:00:00Z"), new Date("1988-02-03T10:00:00Z")),
    ).toBe(true);
    expect(bangNhau("email", " a@b.vn ", "a@b.vn")).toBe(true);
    expect(bangNhau("email", "", null)).toBe(true);
    expect(bangNhau("email", "a@b.vn", null)).toBe(false);
  });
});

describe("oDaDoi / chiOKhacDich — chỉ ô CÓ MẶT và THẬT SỰ đổi", () => {
  it("[DBL-03] ô vắng mặt KHÔNG bị coi là xoá; xoá trắng (null) LÀ đổi", () => {
    const truoc: Record<string, string | null> = {
      email: "a@b.vn",
      city: "Tp Đà Nẵng",
      ward: "Phường Hải Châu",
    };
    expect(oDaDoi(truoc, { email: "c@d.vn" })).toEqual({ email: "c@d.vn" });
    expect(oDaDoi(truoc, { ward: null })).toEqual({ ward: null });
    expect(oDaDoi(truoc, { city: "Tp Đà Nẵng" })).toEqual({});
  });

  it("[DBL-04] đích đang mang đúng nghĩa đó ⇒ không ghi (không đẻ nhật ký rỗng ruột)", () => {
    expect(chiOKhacDich({ phone: "84905123456" }, { phone: "0905123456" })).toEqual({});
    expect(chiOKhacDich({ phone: "84905123456" }, { phone: "0905999999" })).toEqual({
      phone: "0905999999",
    });
  });
});

describe("đổi định dạng giữa hai bên", () => {
  it("[DBL-05] HV → Lead: SĐT về dạng chuẩn 84…; SĐT hỏng KHÔNG ghi; tên trống KHÔNG ghi", () => {
    expect(phHvSangLead({ parentPhone: "0905 123 456", parentEmail: "" })).toEqual({
      phone: "84905123456",
      email: null,
    });
    expect(phHvSangLead({ parentPhone: "123" })).toEqual({});
    // Lead.parentName / Lead.phone là NOT NULL — xoá trắng ở hồ sơ không được dội sang.
    expect(phHvSangLead({ parentName: "  " })).toEqual({});
    expect(phHvSangLead({ address: "12 Lê Lợi", city: "Tp Đà Nẵng" })).toEqual({
      addressLine: "12 Lê Lợi",
      city: "Tp Đà Nẵng",
    });
  });

  it("[DBL-06] Lead → HV: SĐT về dạng nội địa 0… (hồ sơ HV hiển thị dạng đó)", () => {
    expect(phLeadSangHv({ phone: "84905123456", facebookUrl: "https://facebook.com/x" })).toEqual({
      parentPhone: "0905123456",
      parentFacebookUrl: "https://facebook.com/x",
    });
    expect(phLeadSangHv({ addressLine: null })).toEqual({ address: null });
  });

  it("[DBL-07] con HV → LeadChild: 'Nữ' và 'Lớp 7' — đúng chữ màn lead ghi", () => {
    expect(conHvSangLead({ gender: "FEMALE", currentGrade: 7, school: " TH A " })).toEqual({
      gender: "Nữ",
      gradeLevel: "Lớp 7",
      schoolName: "TH A",
    });
    expect(conHvSangLead({ gender: null, currentGrade: null })).toEqual({
      gender: null,
      gradeLevel: null,
    });
  });

  it("[DBL-08] LeadChild → HV: 'Lớp 4' → 4, 'MALE'/'Nam' → MALE; không dịch được ⇒ KHÔNG ghi ô đó", () => {
    expect(conLeadSangHv({ gradeLevel: "Lớp 4", gender: "Nam" })).toEqual({
      currentGrade: 4,
      gender: "MALE",
    });
    expect(conLeadSangHv({ gender: "MALE" })).toEqual({ gender: "MALE" });
    // "Mầm non" không phải một số lớp; giới tính lạ không đoán ⇒ ô đó không có trong patch.
    expect(conLeadSangHv({ gradeLevel: "Mầm non", gender: "?" })).toEqual({});
    // Xoá trắng thì dội xoá.
    expect(conLeadSangHv({ gradeLevel: "", gender: null })).toEqual({
      currentGrade: null,
      gender: null,
    });
  });

  it("[DBL-09] lọc patch ghi Lead/LeadChild về đúng ô chung CÓ MẶT", () => {
    expect(
      chiOPhLead({ parentName: "A", note: "x", courseId: "c", ward: null, email: undefined }),
    ).toEqual({ parentName: "A", ward: null });
    expect(chiOConLead({ fullName: "B", dob: null, gradeLevel: "Lớp 2", note: "y" })).toEqual({
      dob: null,
      gradeLevel: "Lớp 2",
    });
  });
});
