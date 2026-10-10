/**
 * Ca [DYN-NC-*] — `signals.nguon`: ẢNH CHỤP người phụ trách nguồn + cửa sổ ghi công (res4-1 · res3-3). THUẦN.
 * Ba trạng thái KHÔNG được gộp: vắng khoá (di trú) ⇒ nguồn sống; hợp lệ ⇒ bản chụp (kể cả `chuNhanVienId = null` = "không có người" CÓ THẨM QUYỀN);
 * sai hình dạng ⇒ fail-closed, KHÔNG rơi về nguồn sống.
 */
import { describe, expect, it } from "vitest";
import { chupNguon, docNguonChup, nguonChupSchema, nguonHieuLucChoEngine } from "./nguon-chup";

const SONG = { cuaSoRiengNgay: 30, chuNhanVienId: "E-SONG" };

describe("[DYN-NC-01] docNguonChup — ba trạng thái", () => {
  it("khoá `nguon` VẮNG (hàng di trú / hàng cũ) ⇒ CHUA_CO", () => {
    expect(docNguonChup({ duongVao: "facebook" })).toEqual({ trangThai: "CHUA_CO" });
    expect(docNguonChup(null)).toEqual({ trangThai: "CHUA_CO" });
    expect(docNguonChup([1, 2])).toEqual({ trangThai: "CHUA_CO" });
    expect(docNguonChup("xyz")).toEqual({ trangThai: "CHUA_CO" });
  });
  it("hợp lệ ⇒ HOP_LE; chuNhanVienId null vẫn hợp lệ", () => {
    expect(docNguonChup({ nguon: { cuaSoNgay: 45, chuNhanVienId: "E1" } })).toEqual({ trangThai: "HOP_LE", nguon: { cuaSoNgay: 45, chuNhanVienId: "E1" } });
    expect(docNguonChup({ nguon: { cuaSoNgay: 45, chuNhanVienId: null } })).toEqual({ trangThai: "HOP_LE", nguon: { cuaSoNgay: 45, chuNhanVienId: null } });
  });
  it("có khoá nhưng sai hình dạng ⇒ HONG (kiểu sai · thiếu trường · trường lạ · ngoài biên · null)", () => {
    for (const x of [null, "x", [], {}, { cuaSoNgay: "90", chuNhanVienId: null }, { cuaSoNgay: 0, chuNhanVienId: null }, { cuaSoNgay: 3651, chuNhanVienId: null }, { cuaSoNgay: 1.5, chuNhanVienId: null }, { cuaSoNgay: 9 }, { cuaSoNgay: 9, chuNhanVienId: "" }, { cuaSoNgay: 9, chuNhanVienId: null, la: 1 }]) {
      expect(docNguonChup({ nguon: x }), JSON.stringify(x)).toEqual({ trangThai: "HONG" });
    }
  });
});

describe("[DYN-NC-02] nguonHieuLucChoEngine — bản chụp THẮNG nguồn sống; chỉ hàng CHƯA có bản chụp mới rơi về sống", () => {
  it("có bản chụp ⇒ dùng bản chụp, KHÔNG nhìn nguồn sống (cửa sổ và chủ đều của bản chụp)", () => {
    const r = nguonHieuLucChoEngine({ nguon: { cuaSoNgay: 90, chuNhanVienId: "E-LUC-GHI" } }, SONG);
    expect(r).toEqual({ cuaSoRiengNgay: 90, chuNhanVienId: "E-LUC-GHI", nguonGoc: "BAN_CHUP" });
  });
  it("bản chụp 'không có người' (null) ⇒ KHÔNG rơi về chủ sống — nguồn lúc ghi chưa có chủ thì chủ khai SAU không hưởng ngược lên lead cũ", () => {
    const r = nguonHieuLucChoEngine({ nguon: { cuaSoNgay: 90, chuNhanVienId: null } }, SONG);
    expect(r.chuNhanVienId).toBeNull();
    expect(r.nguonGoc).toBe("BAN_CHUP");
  });
  it("đối chứng dương: hàng chưa có bản chụp ⇒ nguồn SỐNG", () => {
    expect(nguonHieuLucChoEngine({ duongVao: "web" }, SONG)).toEqual({ cuaSoRiengNgay: 30, chuNhanVienId: "E-SONG", nguonGoc: "NGUON_SONG" });
    expect(nguonHieuLucChoEngine(null, SONG).nguonGoc).toBe("NGUON_SONG");
  });
  it("bản chụp HỎNG ⇒ fail-closed: không chủ, cửa sổ chung; TUYỆT ĐỐI không rơi về nguồn sống", () => {
    const r = nguonHieuLucChoEngine({ nguon: { cuaSoNgay: "x" } }, SONG);
    expect(r).toEqual({ cuaSoRiengNgay: null, chuNhanVienId: null, nguonGoc: "BAN_CHUP_HONG" });
  });
});

describe("[DYN-NC-03] chupNguon — con số HIỆU LỰC; chủ nguồn luôn được chụp nguyên (chủ nguồn tự nhập lead của nguồn mình là việc bình thường)", () => {
  it("nguồn có cửa sổ riêng ⇒ chụp cửa sổ riêng; không có ⇒ chụp setting chung LÚC ĐÓ (không để NULL: đổi setting sau này không dịch hàng cũ)", () => {
    expect(chupNguon({ cuaSoRiengNgay: 30, cuaSoMacDinhNgay: 90, chuNhanVienId: "E1" })).toEqual({ cuaSoNgay: 30, chuNhanVienId: "E1" });
    expect(chupNguon({ cuaSoRiengNgay: null, cuaSoMacDinhNgay: 90, chuNhanVienId: null })).toEqual({ cuaSoNgay: 90, chuNhanVienId: null });
  });
  it("[FIX-F1c] chủ nguồn KHÔNG bao giờ bị gỡ khỏi bản chụp: hàm không còn tham số chặn (chủ nguồn tự nhập không bị TU_CLAIM ở đường tạo)", () => {
    expect(chupNguon({ cuaSoRiengNgay: null, cuaSoMacDinhNgay: 90, chuNhanVienId: "E1" }).chuNhanVienId).toBe("E1");
  });
  it("mọi bản chụp dựng ra đều qua được schema đọc (ghi và đọc cùng một hình dạng)", () => {
    for (const c of [chupNguon({ cuaSoRiengNgay: 1, cuaSoMacDinhNgay: 90, chuNhanVienId: "E" }), chupNguon({ cuaSoRiengNgay: null, cuaSoMacDinhNgay: 3650, chuNhanVienId: null })]) {
      expect(nguonChupSchema.safeParse(c).success).toBe(true);
    }
  });
});
