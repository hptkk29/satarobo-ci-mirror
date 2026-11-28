// Ca [DCX-*] — đọc + đối chiếu XML hoá đơn (PR3). Mẫu XML theo CẤU TRÚC TT 78/2021 (MISA / VIN HOADON dùng chung thẻ).
import { describe, expect, it } from "vitest";
import { docXmlHoaDon, doiChieuXml, type SoLieuNhap } from "./doi-chieu-xml";

const XML = (o: { so?: string; mau?: string | null; kh?: string; ngay?: string; mst?: string; tien?: string; ns?: boolean } = {}) => {
  const p = o.ns ? "ns2:" : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<${p}HDon xmlns:ns2="http://example.test"><${p}DLHDon><${p}TTChung>
<${p}PBan>2.0.1</${p}PBan><${p}THDon>Hóa đơn giá trị gia tăng</${p}THDon>
${o.mau === null ? "" : `<${p}KHMSHDon>${o.mau ?? "1"}</${p}KHMSHDon>`}<${p}KHHDon>${o.kh ?? "C26MAI"}</${p}KHHDon>
<${p}SHDon>${o.so ?? "00000127"}</${p}SHDon><${p}NLap>${o.ngay ?? "2026-10-17"}</${p}NLap>
</${p}TTChung><${p}NDHDon><${p}NBan><${p}Ten>CÔNG TY CỔ PHẦN CÔNG NGHỆ GIÁO DỤC SATA ROBO</${p}Ten><${p}MST>${o.mst ?? "0402301783"}</${p}MST></${p}NBan>
<${p}NMua><${p}Ten>Nguyễn Văn A</${p}Ten><${p}MST>9999999999</${p}MST></${p}NMua>
<${p}TToan><${p}TgTCThue>2777778</${p}TgTCThue><${p}TgTThue>222222</${p}TgTThue><${p}TgTTTBSo>${o.tien ?? "3000000"}</${p}TgTTTBSo></${p}TToan>
</${p}NDHDon></${p}DLHDon></${p}HDon>`;
};

const NHAP: SoLieuNhap = { kyHieu: "1C26MAI", soHoaDon: "127", ngayPhatHanh: "2026-10-17", mstNguoiBan: "0402301783", tongTien: 3_000_000 };

describe("[DCX-01] đọc XML", () => {
  it("bóc đủ số · ký hiệu (KHMSHDon+KHHDon) · ngày · MST NGƯỜI BÁN (không lẫn MST người mua) · tổng tiền", () => {
    expect(docXmlHoaDon(XML())).toEqual({ kyHieu: "1C26MAI", soHoaDon: "127", ngayLap: "2026-10-17", mstNguoiBan: "0402301783", tongThanhToan: 3_000_000 });
  });
  it("chịu tiền tố namespace; tiền có phần thập phân", () => {
    expect(docXmlHoaDon(XML({ ns: true, tien: "3000000.00" }))).toMatchObject({ soHoaDon: "127", tongThanhToan: 3_000_000, mstNguoiBan: "0402301783" });
  });
  it("không phải XML hoá đơn ⇒ null; thẻ giả trong chú thích / CDATA không tính", () => {
    expect(docXmlHoaDon("<a><b>1</b></a>")).toBeNull();
    expect(docXmlHoaDon("")).toBeNull();
    expect(docXmlHoaDon(`<x><!-- <SHDon>999</SHDon> --><y/></x>`)).toBeNull();
    expect(docXmlHoaDon(`<x><![CDATA[<SHDon>999</SHDon>]]></x>`)).toBeNull();
  });
  it("khối NBan vắng ⇒ không lấy MST người mua làm MST người bán", () => {
    const x = XML().replace(/<NBan>[\s\S]*?<\/NBan>/, "");
    expect(docXmlHoaDon(x)?.mstNguoiBan).toBeNull();
  });
});

describe("[DCX-02] đối chiếu", () => {
  it("khớp hoàn toàn (số có/không số 0 đứng đầu, ký hiệu hoa/thường) ⇒ KHOP, ghi các trường đã so", () => {
    const r = doiChieuXml(XML(), { ...NHAP, soHoaDon: "0000127", kyHieu: "1c26mai" });
    expect(r).toEqual({ loai: "KHOP", daSo: ["số hoá đơn", "ký hiệu", "ngày lập", "MST người bán", "số tiền"] });
  });
  it("lệch SỐ ⇒ nói rõ hai giá trị", () => {
    const r = doiChieuXml(XML(), { ...NHAP, soHoaDon: "128" });
    expect(r).toMatchObject({ loai: "LECH", lech: [expect.stringMatching(/Số hoá đơn: XML ghi 127, đang nhập 128/)] });
  });
  it("lệch KÝ HIỆU, NGÀY, TIỀN, PHÁP NHÂN ⇒ mỗi trường một dòng", () => {
    const r = doiChieuXml(XML(), { kyHieu: "1C26MNV", soHoaDon: "127", ngayPhatHanh: "2026-10-18", mstNguoiBan: "0402341070", tongTien: 2_900_000 });
    expect(r.loai).toBe("LECH");
    if (r.loai !== "LECH") return;
    expect(r.lech).toHaveLength(4);
    expect(r.lech.join("|")).toMatch(/Ký hiệu.*1C26MAI.*1C26MNV/);
    expect(r.lech.join("|")).toMatch(/Ngày phát hành/);
    expect(r.lech.join("|")).toMatch(/Pháp nhân bán.*0402301783.*0402341070/);
    expect(r.lech.join("|")).toMatch(/Số tiền/);
  });
  it("XML thiếu KHMSHDon (chỉ 'C26MAI') ⇒ so phần đuôi, không báo lệch oan", () => {
    expect(doiChieuXml(XML({ mau: null }), NHAP)).toMatchObject({ loai: "KHOP" });
  });
  it("trường bên nhập còn TRỐNG ⇒ bỏ qua trường đó (không kết tội thiếu)", () => {
    const r = doiChieuXml(XML(), { kyHieu: null, soHoaDon: "127", ngayPhatHanh: null, mstNguoiBan: null, tongTien: null });
    expect(r).toEqual({ loai: "KHOP", daSo: ["số hoá đơn"] });
  });
  it("XML không đọc được trường nào để so ⇒ KHONG_DOC_DUOC (cảnh báo, không chặn)", () => {
    expect(doiChieuXml("<a/>", NHAP)).toEqual({ loai: "KHONG_DOC_DUOC" });
    expect(doiChieuXml(XML(), { kyHieu: null, soHoaDon: null, ngayPhatHanh: null, mstNguoiBan: null, tongTien: null })).toEqual({ loai: "KHONG_DOC_DUOC" });
  });
});
