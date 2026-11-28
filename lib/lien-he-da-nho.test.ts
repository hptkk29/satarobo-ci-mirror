/**
 * [LHN-*] Liên hệ người lớn «nhớ trên máy này» (DISC · Tủ sách · Sức khoẻ). Dữ liệu BỊA; mốc thời gian TUYỆT ĐỐI truyền vào (luật 19).
 */
import { describe, expect, it } from "vitest";
import { HAN_LIEN_HE_DA_NHO_NGAY, KHOA_LIEN_HE_DA_NHO, docLienHeDaNho, ghiLienHeDaNho, xoaLienHeDaNho, type KhoLienHe } from "./lien-he-da-nho";

const T0 = Date.UTC(2026, 10, 14, 3, 0, 0);
const NGAY = 86_400_000;

function khoGia(): KhoLienHe & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}
const khoHong: KhoLienHe = {
  getItem: () => {
    throw new Error("chặn");
  },
  setItem: () => {
    throw new Error("chặn");
  },
  removeItem: () => {
    throw new Error("chặn");
  },
};

const LIEN_HE = { hoTen: "  Nguyễn Thị Giả ", soDienThoai: "0905 000 111", email: "gia@example.com", thanhPho: "Tp Đà Nẵng", phuong: "Phường Giả", soNha: "12 Đường Giả" };

describe("[LHN-01] ghi rồi đọc", () => {
  it("khứ hồi, cắt khoảng trắng đầu/cuối", () => {
    const k = khoGia();
    expect(ghiLienHeDaNho(k, LIEN_HE, T0)).toBe(true);
    expect(docLienHeDaNho(k, T0 + 1000)).toEqual({ hoTen: "Nguyễn Thị Giả", soDienThoai: "0905 000 111", email: "gia@example.com", thanhPho: "Tp Đà Nẵng", phuong: "Phường Giả", soNha: "12 Đường Giả" });
  });
  it("trường tuỳ chọn để trống ⇒ null (Tủ sách/Sức khoẻ không hỏi email)", () => {
    const k = khoGia();
    ghiLienHeDaNho(k, { hoTen: "Giả", soDienThoai: "0905000111" }, T0);
    expect(docLienHeDaNho(k, T0)).toMatchObject({ email: null, thanhPho: null, phuong: null, soNha: null });
  });
});

describe("[LHN-02] CHỈ thông tin liên hệ của người lớn — không dữ liệu của bé", () => {
  it("trường lạ truyền vào (tên bé, năm sinh, điểm) KHÔNG rơi xuống kho", () => {
    const k = khoGia();
    const doiTuongLan = { ...LIEN_HE, hocSinh: { hoTen: "Bé Giả", namSinh: 2017 }, tenHocSinh: "Bé Giả", diem: { D: 9 }, ketQua: "x", baiLam: [1, 2] };
    ghiLienHeDaNho(k, doiTuongLan, T0);
    const tho = k.map.get(KHOA_LIEN_HE_DA_NHO)!;
    expect(tho).not.toMatch(/Bé Giả|hocSinh|tenHocSinh|namSinh|diem|ketQua|baiLam/);
    expect(Object.keys(JSON.parse(tho)).sort()).toEqual(["email", "hoTen", "luuLuc", "phuong", "soDienThoai", "soNha", "thanhPho", "v"]);
  });
  it("chỉ ghi vào MỘT khoá, không đụng khoá khác (đối chứng dương)", () => {
    const k = khoGia();
    k.setItem("khoa-khac-gia", "giu-lai");
    ghiLienHeDaNho(k, LIEN_HE, T0);
    xoaLienHeDaNho(k);
    expect(k.map.get("khoa-khac-gia")).toBe("giu-lai");
    expect(k.map.has(KHOA_LIEN_HE_DA_NHO)).toBe(false);
  });
});

describe("[LHN-03] hạn dùng", () => {
  it(`trong ${HAN_LIEN_HE_DA_NHO_NGAY} ngày ⇒ đọc được; qua hạn ⇒ null VÀ bị xoá khỏi máy`, () => {
    const k = khoGia();
    ghiLienHeDaNho(k, LIEN_HE, T0);
    expect(docLienHeDaNho(k, T0 + HAN_LIEN_HE_DA_NHO_NGAY * NGAY)).not.toBeNull();
    expect(docLienHeDaNho(k, T0 + HAN_LIEN_HE_DA_NHO_NGAY * NGAY + 1)).toBeNull();
    expect(k.map.has(KHOA_LIEN_HE_DA_NHO)).toBe(false);
  });
  it("mốc ở TƯƠNG LAI xa (đồng hồ lệch/giả mạo) ⇒ không tin, xoá", () => {
    const k = khoGia();
    ghiLienHeDaNho(k, LIEN_HE, T0 + 10 * NGAY);
    expect(docLienHeDaNho(k, T0)).toBeNull();
    expect(k.map.has(KHOA_LIEN_HE_DA_NHO)).toBe(false);
  });
});

describe("[LHN-04] không ghi nửa vời, không tin dữ liệu hỏng", () => {
  it("thiếu họ tên hoặc SĐT ⇒ không ghi", () => {
    const k = khoGia();
    expect(ghiLienHeDaNho(k, { hoTen: " ", soDienThoai: "0905000111" }, T0)).toBe(false);
    expect(ghiLienHeDaNho(k, { hoTen: "Giả", soDienThoai: "" }, T0)).toBe(false);
    expect(k.map.size).toBe(0);
  });
  it("JSON hỏng / sai hình dạng / kiểu sai ⇒ null và dọn", () => {
    for (const tho of ["{khong-phai-json", '{"v":2}', JSON.stringify({ v: 1, luuLuc: T0, hoTen: 5, soDienThoai: "0905000111", email: null, thanhPho: null, phuong: null, soNha: null })]) {
      const k = khoGia();
      k.map.set(KHOA_LIEN_HE_DA_NHO, tho);
      expect(docLienHeDaNho(k, T0)).toBeNull();
      expect(k.map.has(KHOA_LIEN_HE_DA_NHO)).toBe(false);
    }
  });
  it("chuỗi quá dài bị cắt lúc ghi (không để kho phình)", () => {
    const k = khoGia();
    ghiLienHeDaNho(k, { ...LIEN_HE, hoTen: "A".repeat(500) }, T0);
    expect(docLienHeDaNho(k, T0)?.hoTen).toHaveLength(80);
  });
});

describe("[LHN-05] kho chặn/không có ⇒ sống sót, im lặng", () => {
  it("setItem/getItem/removeItem ném lỗi ⇒ không văng", () => {
    expect(ghiLienHeDaNho(khoHong, LIEN_HE, T0)).toBe(false);
    expect(docLienHeDaNho(khoHong, T0)).toBeNull();
    expect(() => xoaLienHeDaNho(khoHong)).not.toThrow();
  });
  it("không có kho (null) ⇒ false/null", () => {
    expect(ghiLienHeDaNho(null, LIEN_HE, T0)).toBe(false);
    expect(docLienHeDaNho(null, T0)).toBeNull();
    expect(() => xoaLienHeDaNho(null)).not.toThrow();
  });
});
