// Ca [OSO-*] — ba ô số kế toán gõ khi lưu nháp hoá đơn.
import { describe, expect, it } from "vitest";
import { kiemOSoHoaDon, tenTepSach } from "./o-so-hoa-don";

const HOM_NAY = "2026-09-26";
const kiem = (o: Parameters<typeof kiemOSoHoaDon>[0]) => kiemOSoHoaDon(o, HOM_NAY);

describe("[OSO-01] để trống được — nút Xác nhận tự nói còn thiếu gì", () => {
  it("cả ba trống ⇒ ok, đều null", () => {
    expect(kiem({})).toEqual({ ok: true, data: { kyHieu: null, soHoaDon: null, ngayPhatHanh: null } });
    expect(kiem({ kyHieu: "  ", soHoaDon: "", ngayPhatHanh: null })).toMatchObject({ ok: true });
  });
});

describe("[OSO-02] số hoá đơn", () => {
  it("bỏ số 0 đứng đầu — '00000127' và '127' là MỘT hoá đơn", () => {
    expect(kiem({ soHoaDon: "00000127" })).toMatchObject({ ok: true, data: { soHoaDon: "127" } });
    expect(kiem({ soHoaDon: "127" })).toMatchObject({ ok: true, data: { soHoaDon: "127" } });
  });
  it("chữ, quá 8 số, toàn số 0 ⇒ lỗi", () => {
    expect(kiem({ soHoaDon: "12A" }).ok).toBe(false);
    expect(kiem({ soHoaDon: "123456789" }).ok).toBe(false);
    expect(kiem({ soHoaDon: "0000" }).ok).toBe(false);
  });
});

describe("[OSO-03] ngày phát hành", () => {
  it("hợp lệ ⇒ Date nửa đêm UTC", () => {
    const r = kiem({ ngayPhatHanh: "2026-09-12" });
    expect(r.ok && r.data.ngayPhatHanh?.toISOString()).toBe("2026-09-12T00:00:00.000Z");
  });
  it("ngày tràn (31/02), sai dạng, tương lai, quá xa ⇒ lỗi", () => {
    expect(kiem({ ngayPhatHanh: "2026-02-31" }).ok).toBe(false);
    expect(kiem({ ngayPhatHanh: "12/09/2026" }).ok).toBe(false);
    expect(kiem({ ngayPhatHanh: "2026-09-27" }).ok).toBe(false);
    expect(kiem({ ngayPhatHanh: HOM_NAY }).ok).toBe(true);
    expect(kiem({ ngayPhatHanh: "2019-12-31" }).ok).toBe(false);
  });
});

describe("[OSO-04] ký hiệu", () => {
  it("chuẩn hoa chữ; có ngày thì năm phải khớp", () => {
    expect(kiem({ kyHieu: "1c26tsr", ngayPhatHanh: "2026-09-12" })).toMatchObject({ ok: true, data: { kyHieu: "1C26TSR" } });
    const sai = kiem({ kyHieu: "1C25TSR", ngayPhatHanh: "2026-09-12" });
    expect(sai.ok).toBe(false);
  });
  it("chưa có ngày ⇒ chỉ kiểm hình dạng", () => {
    expect(kiem({ kyHieu: "1C25TSR" }).ok).toBe(true);
    expect(kiem({ kyHieu: "TSR" }).ok).toBe(false);
  });
});

describe("[OSO-05] tên tệp", () => {
  it("bỏ đường dẫn + ký tự điều khiển + nháy kép; rỗng ⇒ tên mặc định", () => {
    expect(tenTepSach("C:\\fakepath\\HD 127.pdf", "pdf")).toBe("HD 127.pdf");
    expect(tenTepSach("/home/u/HD 128.pdf", "pdf")).toBe("HD 128.pdf");
    expect(tenTepSach('a"b\u0007.pdf', "pdf")).toBe("ab.pdf");
    expect(tenTepSach("", "xml")).toBe("hoa-don.xml");
  });
});
