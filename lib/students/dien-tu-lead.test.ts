// [DTL] — luật điền ô trống hồ sơ học viên từ lead nguồn (25/09/2026). THUẦN.
// Ba đường nối HV ↔ lead (convert · script nối HV cũ · nút "Gắn lead") cùng dựa vào đây,
// nên mỗi luật ở đầu `dien-tu-lead.ts` có đúng một ca ghim.
import { describe, it, expect } from "vitest";
import {
  dienTuLead,
  lopTuChuoi,
  nhanNguoiNhapLead,
  type LeadChildDeDien,
  type LeadDeDien,
  type StudentDeDien,
} from "./dien-tu-lead";

const HV_TRONG: StudentDeDien = {
  dateOfBirth: null,
  gender: null,
  school: null,
  currentGrade: null,
  parentEmail: null,
  parentGender: null,
  parentDob: null,
  parentFacebookUrl: null,
  city: null,
  ward: null,
  address: null,
  district: null,
};

const LEAD: LeadDeDien = {
  email: " ph@example.com ",
  facebookUrl: "https://www.facebook.com/ph.abc",
  parentGender: "FEMALE",
  parentDob: new Date("1988-03-04T00:00:00Z"),
  city: "Đà Nẵng",
  ward: "Phường Hải Châu",
  addressLine: "12 Lê Lợi",
};

const CON: LeadChildDeDien = {
  dob: new Date("2016-05-06T00:00:00Z"),
  gender: "Nữ",
  schoolName: " TH Lê Văn Tám ",
  gradeLevel: "Lớp 4",
};

describe("[DTL] dienTuLead", () => {
  it("[DTL-01] hồ sơ trắng ⇒ điền đủ từ lead + con (đã trim)", () => {
    expect(dienTuLead(HV_TRONG, LEAD, CON)).toEqual({
      dateOfBirth: CON.dob,
      gender: "FEMALE",
      school: "TH Lê Văn Tám",
      currentGrade: 4,
      parentEmail: "ph@example.com",
      parentGender: "FEMALE",
      parentDob: LEAD.parentDob,
      parentFacebookUrl: "https://www.facebook.com/ph.abc",
      city: "Đà Nẵng",
      ward: "Phường Hải Châu",
      address: "12 Lê Lợi",
    });
  });

  it("[DTL-02] luật 1 — ô ĐÃ CÓ giá trị KHÔNG bao giờ bị ghi đè", () => {
    const daCo: StudentDeDien = {
      dateOfBirth: new Date("2015-01-01T00:00:00Z"),
      gender: "MALE",
      school: "Trường cũ",
      currentGrade: 3,
      parentEmail: "cu@example.com",
      parentGender: "MALE",
      parentDob: new Date("1980-01-01T00:00:00Z"),
      parentFacebookUrl: "https://facebook.com/cu",
      city: "Huế",
      ward: null,
      address: null,
      district: null,
    };
    expect(dienTuLead(daCo, LEAD, CON)).toEqual({});
  });

  it("[DTL-03] chuỗi toàn khoảng trắng trên HV coi là TRỐNG ⇒ được điền", () => {
    const out = dienTuLead({ ...HV_TRONG, school: "   ", parentEmail: "" }, LEAD, CON);
    expect(out.school).toBe("TH Lê Văn Tám");
    expect(out.parentEmail).toBe("ph@example.com");
  });

  it("[DTL-04] luật 2 — KHÔNG trả tên/SĐT phụ huynh", () => {
    const out = dienTuLead(HV_TRONG, LEAD, CON) as Record<string, unknown>;
    expect("parentName" in out).toBe(false);
    expect("parentPhone" in out).toBe(false);
  });

  it("[DTL-05] luật 3 — HV đã có BẤT KỲ ô địa chỉ nào (kể cả district cũ) ⇒ không điền cụm địa chỉ", () => {
    for (const k of ["city", "ward", "address", "district"] as const) {
      const out = dienTuLead({ ...HV_TRONG, [k]: "có" }, LEAD, null);
      expect(out.city, k).toBeUndefined();
      expect(out.ward, k).toBeUndefined();
      expect(out.address, k).toBeUndefined();
    }
  });

  it("[DTL-06] luật 3 — lead có cụm thiếu ô ⇒ điền đúng các ô có, không bịa ô thiếu", () => {
    const out = dienTuLead(HV_TRONG, { ...LEAD, ward: null, addressLine: "  " }, null);
    expect(out.city).toBe("Đà Nẵng");
    expect("ward" in out).toBe(false);
    expect("address" in out).toBe(false);
  });

  it("[DTL-07] luật 4 — giới tính lạ / lớp không dịch được ⇒ bỏ qua, KHÔNG đoán", () => {
    const out = dienTuLead(HV_TRONG, null, { ...CON, gender: "bé gái", gradeLevel: "Mầm non" });
    expect("gender" in out).toBe(false);
    expect("currentGrade" in out).toBe(false);
  });

  it("[DTL-08] không có lead/con ⇒ không điền gì", () => {
    expect(dienTuLead(HV_TRONG, null, null)).toEqual({});
  });

  it("[DTL-09] chỉ có con (không lead) ⇒ chỉ điền phần của con", () => {
    const out = dienTuLead(HV_TRONG, null, CON);
    expect(Object.keys(out).sort()).toEqual(["currentGrade", "dateOfBirth", "gender", "school"]);
  });
});

describe("[DTL] lopTuChuoi", () => {
  it("[DTL-10] dịch nhãn lớp phổ biến; ngoài 1–12 hoặc không có số ⇒ null", () => {
    expect(lopTuChuoi("Lớp 4")).toBe(4);
    expect(lopTuChuoi("lớp 10")).toBe(10);
    expect(lopTuChuoi("Khối 5")).toBe(5);
    expect(lopTuChuoi("4")).toBe(4);
    expect(lopTuChuoi("Lớp 4 lên 5")).toBe(4);
    expect(lopTuChuoi("Mầm non")).toBeNull();
    expect(lopTuChuoi("Lớp 13")).toBeNull();
    expect(lopTuChuoi("0")).toBeNull();
    expect(lopTuChuoi(null)).toBeNull();
    expect(lopTuChuoi("")).toBeNull();
  });

  it("[DTL-12] ô lớp gõ TUỔI / MẦM NON / KHOẢNG lớp ⇒ null (không biến tuổi thành lớp)", () => {
    for (const s of ["Mầm non 5 tuổi", "MG 5t", "10 tuổi", "5t", "8 tuoi", "Mẫu giáo lớn", "Nhà trẻ 3"]) {
      expect(lopTuChuoi(s), s).toBeNull();
    }
    expect(lopTuChuoi("Lớp 1-2"), "khoảng lớp").toBeNull();
    expect(lopTuChuoi("Học lớp 4"), "số không đứng đầu").toBeNull();
    // Khuôn lớp thật vẫn nhận — kể cả tên lớp có chữ/ký hiệu và chữ gõ không dấu / NFD.
    expect(lopTuChuoi("4A1")).toBe(4);
    expect(lopTuChuoi("5/2")).toBe(5);
    expect(lopTuChuoi("khoi 5")).toBe(5);
    expect(lopTuChuoi("L3")).toBe(3);
    expect(lopTuChuoi("Lớp 6".normalize("NFD"))).toBe(6);
  });
});

describe("[DTL] nhanNguoiNhapLead", () => {
  it("[DTL-11] khuôn MÃ_Tên; thiếu một vế thì in vế còn lại; thiếu cả hai ⇒ null", () => {
    expect(nhanNguoiNhapLead("HO.KD.001", "Nguyễn Văn A")).toBe("HO.KD.001_Nguyễn Văn A");
    expect(nhanNguoiNhapLead(" HO.KD.001 ", " Nguyễn Văn A ")).toBe("HO.KD.001_Nguyễn Văn A");
    expect(nhanNguoiNhapLead(null, "Nguyễn Văn A")).toBe("Nguyễn Văn A");
    expect(nhanNguoiNhapLead("HO.KD.001", "  ")).toBe("HO.KD.001");
    expect(nhanNguoiNhapLead(undefined, null)).toBeNull();
  });
});
