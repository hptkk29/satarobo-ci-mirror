// Ca [SHA-P*] + [SHA-W1] — "một tờ hoá đơn chỉ gắn cho MỘT hoá đơn còn sống" (GĐ 8 bước 13).
//
// [SHA-P*]: câu báo theo phạm vi người xem — ngoài phạm vi thì KHÔNG nói mã đơn / số hoá đơn.
// [SHA-W1]: lưới ghim DÂY NỐI — cổng thật chạy trong transaction ghi, và phải đứng TRƯỚC phép ghi của
// CẢ HAI đường (tạo nháp · sửa nháp). Hành vi đo ở `tests/finance/hoa-don-ghi.test.ts` [SHA-01..07];
// lưới này bắt ca "gỡ lời gọi ở một đường" mà bộ DB chỉ phát hiện nếu có ca cho đúng đường ấy.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { thongDiepTepTrung, type TepDangGiu } from "./trung-tep";

const GIU: TepDangGiu = {
  id: "hdA",
  orderId: "donA",
  centerId: "cs1",
  kyHieu: "1C26TSR",
  soHoaDon: "127",
  trangThai: "DA_XAC_NHAN",
  maDon: "ORD-260910-000001",
};

describe("[SHA-P] câu báo tệp trùng", () => {
  it("[SHA-P1] trong phạm vi ⇒ nêu số hoá đơn + trạng thái + mã đơn", () => {
    expect(thongDiepTepTrung(GIU, { xemDuoc: true, cungDon: false })).toBe(
      "Tệp PDF này đã gắn cho hoá đơn 1C26TSR-127 (đã xuất) của đơn ORD-260910-000001 — mỗi tờ hoá đơn chỉ gắn cho một lần thu. Kiểm lại tệp",
    );
  });

  it("[SHA-P2] ngoài phạm vi ⇒ KHÔNG mã đơn, KHÔNG số hoá đơn", () => {
    const c = thongDiepTepTrung(GIU, { xemDuoc: false, cungDon: false });
    expect(c).toBe("Tệp PDF này đã gắn cho một hoá đơn ở cơ sở khác — kiểm lại tệp");
    expect(c).not.toContain("ORD-");
    expect(c).not.toContain("127");
  });

  it("[SHA-P3] cùng đơn ⇒ nói 'lần thu khác trên cùng đơn'; nháp nói 'nháp'; chưa ghi số nói rõ", () => {
    expect(thongDiepTepTrung({ ...GIU, trangThai: "NHAP", soHoaDon: null }, { xemDuoc: true, cungDon: true })).toBe(
      "Tệp PDF này đã gắn cho hoá đơn 1C26TSR (nháp) của một lần thu khác trên cùng đơn — mỗi tờ hoá đơn chỉ gắn cho một lần thu. Kiểm lại tệp",
    );
    expect(thongDiepTepTrung({ ...GIU, kyHieu: null, soHoaDon: null }, { xemDuoc: true, cungDon: false })).toContain("hoá đơn (chưa ghi số)");
  });
});

describe("[SHA-W1] cổng tệp trùng đứng TRƯỚC phép ghi ở CẢ HAI đường", () => {
  // Bỏ chú thích TRƯỚC khi đếm — chú thích giải thích bản vá hay chứa đúng chuỗi đang tìm (luật 11).
  const ma = readFileSync(resolve(process.cwd(), "lib/finance/hoa-don/ghi-hoa-don.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const than = (ten: string) => {
    const dau = ma.indexOf(`export async function ${ten}(`);
    expect(dau).toBeGreaterThan(-1);
    const sau = ma.indexOf("\nexport ", dau + 1);
    return ma.slice(dau, sau === -1 ? undefined : sau);
  };

  it("đúng HAI lời gọi kiểm trong transaction", () => {
    expect(ma.match(/hoaDonDangGiuTepPdf\(tx,/g)?.length).toBe(2);
  });

  it("tạo nháp: khoá + kiểm trước `.hoaDonDienTu.create(`", () => {
    const t = than("taoHoaDonChoLanThu");
    const khoa = t.indexOf("khoaVanTayPdfTrongTx(tx,");
    const kiem = t.indexOf("hoaDonDangGiuTepPdf(tx,");
    expect(khoa).toBeGreaterThan(-1);
    expect(khoa).toBeLessThan(kiem);
    expect(kiem).toBeLessThan(t.indexOf(".hoaDonDienTu.create("));
  });

  it("sửa nháp: khoá + kiểm (trừ CHÍNH bản nháp) trước `.hoaDonDienTu.updateMany(`", () => {
    const t = than("capNhatHoaDonNhap");
    const kiem = t.indexOf("hoaDonDangGiuTepPdf(tx, input.pdf.sha256, input.hoaDonId)");
    expect(t.indexOf("khoaVanTayPdfTrongTx(tx,")).toBeGreaterThan(-1);
    expect(kiem).toBeGreaterThan(-1);
    expect(kiem).toBeLessThan(t.indexOf(".hoaDonDienTu.updateMany("));
  });
});
