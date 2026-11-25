// @vitest-environment node
/**
 * [CTN-*] — phần THUẦN của «Chính sách áp dụng» ở chi tiết nguồn (`chi-tiet-nguon.ts`).
 *   [CTN-01] «ai nhận» đọc từ THUỘC TÍNH vai (resolverType/Key), không so mã vai; thiếu người ⇒ cờ `thieu` (treo hàng chờ), không "0đ giả"
 *   [CTN-02] tách hoa hồng NGUỒN (isAcquisition) ↔ giao dịch KHÁC theo thuộc tính dòng vai; tổng cộng bằng số nguyên micro
 *   [CTN-03] vai không có rule (KHONG_CO) vẫn nằm trong danh sách; ô chồng lấn / cố định ⇒ `khongTinDuoc`
 */
import { describe, expect, it } from "vitest";
import type { OMaTran } from "@/lib/hoa-hong/ma-tran-chinh-sach";
import { moTaNguoiHuong, tachHoaHongNguon, type DongChiTiet, type VaiHuongTho } from "./chi-tiet-nguon";

const vai = (ghi: Partial<VaiHuongTho> & Pick<VaiHuongTho, "code">): VaiHuongTho => ({
  name: ghi.code,
  resolverType: "TRANSACTION_ROLE",
  resolverKey: null,
  isAcquisition: false,
  ...ghi,
});

describe("[CTN-01] moTaNguoiHuong", () => {
  it("SOURCE_OWNER: có chủ + có tài khoản ⇒ nêu tên + mã; chưa khai chủ ⇒ thieu; chủ chưa có tài khoản ⇒ thieu", () => {
    const v = vai({ code: "SOURCE_OWNER", resolverType: "SOURCE_OWNER", resolverKey: "SOURCE_OWNER", isAcquisition: true });
    const ok = moTaNguoiHuong(v, { ten: "Trần Thị B", maNv: "SR.NV.020", coTaiKhoan: true });
    expect(ok.thieu).toBe(false);
    expect(ok.nhan).toContain("Trần Thị B");
    expect(ok.nhan).toContain("SR.NV.020");
    expect(moTaNguoiHuong(v, null)).toMatchObject({ thieu: true });
    expect(moTaNguoiHuong(v, { ten: "Chưa TK", maNv: null, coTaiKhoan: false })).toMatchObject({ thieu: true });
  });
  it("hành vi đi theo resolverType chứ KHÔNG theo mã: đổi mã vai nhưng giữ resolver ⇒ cùng kết quả", () => {
    const chu = { ten: "Chủ", maNv: null, coTaiKhoan: true };
    const a = moTaNguoiHuong(vai({ code: "SOURCE_OWNER", resolverType: "SOURCE_OWNER" }), chu);
    const b = moTaNguoiHuong(vai({ code: "TEN_BAT_KY_KHAC", resolverType: "SOURCE_OWNER" }), chu);
    expect(b).toEqual(a);
    expect(moTaNguoiHuong(vai({ code: "SOURCE_OWNER", resolverType: "TRANSACTION_ROLE" }), chu).nhan).not.toContain("Chủ");
  });
  it("DIRECT_PERSON: nêu rõ «theo từng lead»; REFERRER_PARENT_SALE nói là ẢNH CHỤP (khác Sale chốt đơn)", () => {
    for (const key of ["REFERRER_PARENT", "REFERRER_EMPLOYEE", "AFFILIATE", "REFERRER_PARENT_SALE"]) {
      expect(moTaNguoiHuong(vai({ code: key, resolverType: "DIRECT_PERSON", resolverKey: key }), null).nhan, key).toContain("theo từng lead");
    }
    expect(moTaNguoiHuong(vai({ code: "X", resolverType: "DIRECT_PERSON", resolverKey: "REFERRER_PARENT_SALE" }), null).nhan).toContain("ảnh chụp");
    expect(moTaNguoiHuong(vai({ code: "Y", resolverType: "DIRECT_PERSON", resolverKey: "KHONG_BIET" }), null).thieu).toBe(false);
  });
  it("SOURCE_MEMBER (chưa có bảng) ⇒ thieu; ORG_UNIT_ROLE / TRANSACTION_ROLE ⇒ không thieu", () => {
    expect(moTaNguoiHuong(vai({ code: "M", resolverType: "SOURCE_MEMBER" }), null).thieu).toBe(true);
    expect(moTaNguoiHuong(vai({ code: "Q", resolverType: "ORG_UNIT_ROLE" }), null).thieu).toBe(false);
    expect(moTaNguoiHuong(vai({ code: "S", resolverType: "TRANSACTION_ROLE" }), null).thieu).toBe(false);
  });
});

const pct = (tiLe: string): OMaTran => ({
  cot: "c", kieu: "PERCENT", tiLe, phanTram: String(Number(tiLe) * 100), cuThe: true, policyId: "p", policyCode: "P", version: 1, phamVi: "SOURCE_GROUP",
});
const dong = (code: string, laThuHut: boolean, o: OMaTran): DongChiTiet => ({ vai: { code, name: code, laThuHut }, nguoiHuong: { nhan: "x", thieu: false }, o });

describe("[CTN-02] tachHoaHongNguon", () => {
  it("tách theo isAcquisition và cộng riêng từng nhóm", () => {
    const r = tachHoaHongNguon([
      dong("SALE", false, pct("0.04")),
      dong("MARKETING", false, pct("0.01")),
      dong("REFERRER_EMPLOYEE", true, pct("0.02")),
      dong("SOURCE_OWNER", true, pct("0.015")),
    ]);
    expect(r.nguon.dong.map((d) => d.vai.code)).toEqual(["REFERRER_EMPLOYEE", "SOURCE_OWNER"]);
    expect(r.khac.dong.map((d) => d.vai.code)).toEqual(["SALE", "MARKETING"]);
    expect(r.nguon.tongPhanTram).toBe("3,5");
    expect(r.khac.tongPhanTram).toBe("5");
  });
  it("cộng bằng số nguyên: 0,1% + 0,2% = 0,3% (không dính sai số dấu phẩy động)", () => {
    const r = tachHoaHongNguon([dong("A", true, pct("0.001")), dong("B", true, pct("0.002"))]);
    expect(r.nguon.tongPhanTram).toBe("0,3");
  });
  it("hai nhóm rỗng ⇒ tổng 0, không ném", () => {
    const r = tachHoaHongNguon([]);
    expect(r.nguon).toEqual({ dong: [], tongPhanTram: "0", khongTinDuoc: false });
    expect(r.khac.dong).toEqual([]);
  });
});

describe("[CTN-03] ô không phải PERCENT", () => {
  it("KHONG_CO vẫn nằm trong danh sách (người đọc cần thấy «vai này KHÔNG được gì từ nguồn này») và không cộng", () => {
    const r = tachHoaHongNguon([dong("SALE", false, { cot: "c", kieu: "KHONG_CO" }), dong("MKT", false, pct("0.01"))]);
    expect(r.khac.dong).toHaveLength(2);
    expect(r.khac.tongPhanTram).toBe("1");
    expect(r.khac.khongTinDuoc).toBe(false);
  });
  it("CHONG_LAN / CO_DINH ⇒ khongTinDuoc (tổng chỉ là phần biết được)", () => {
    const co = tachHoaHongNguon([dong("A", true, { cot: "c", kieu: "CHONG_LAN", lyDo: "x" }), dong("B", true, pct("0.02"))]);
    expect(co.nguon).toMatchObject({ tongPhanTram: "2", khongTinDuoc: true });
    const codinh = tachHoaHongNguon([dong("A", false, { cot: "c", kieu: "CO_DINH", soTien: 100000, cuThe: false, policyId: "p", policyCode: "P", version: 1, phamVi: "GLOBAL" })]);
    expect(codinh.khac.khongTinDuoc).toBe(true);
  });
});
