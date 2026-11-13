// Ca [OSO-*] — ba ô số kế toán gõ khi lưu nháp hoá đơn.
import { describe, expect, it } from "vitest";
import { kiemOSoHoaDon, oSoDienSan, tenTepSach } from "./o-so-hoa-don";
import type { CauHinhCoSo } from "./cau-hinh-co-so";

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

describe("[OSO-10] điền sẵn: ngày phát hành = ngày thu, ký hiệu theo cấu hình của cơ sở (PR2); thiếu cấu hình ⇒ để trống (D1)", () => {
  const khong = { coSoId: null, cauHinhCoSo: [] } as const;
  const cfg = (o: Partial<CauHinhCoSo> = {}): CauHinhCoSo => ({
    id: "a",
    centerId: "cs1",
    phapNhanMa: "SATA_ROBO",
    kyHieu: "1C26MAI",
    hieuLucTu: "2026-01-01",
    hieuLucDen: "2026-12-31",
    dangBat: true,
    ...o,
  });
  it("chưa có nháp, chưa có cấu hình ⇒ ngày thu + ký hiệu TRỐNG, nguồn THIEU_CAU_HINH (không đoán 1C26TSR)", () => {
    expect(oSoDienSan({ nhap: null, ngayThu: "2026-10-20", ...khong })).toEqual({
      ngayPhatHanh: "2026-10-20",
      kyHieu: "",
      kyHieuTay: false,
      nguonKyHieu: "THIEU_CAU_HINH",
    });
  });
  it("có cấu hình hiệu lực ⇒ ký hiệu NGUYÊN CHUỖI cấu hình (1C26MAI), không phải mẫu 1C26TSR", () => {
    expect(oSoDienSan({ nhap: null, ngayThu: "2026-10-20", coSoId: "cs1", cauHinhCoSo: [cfg()] })).toMatchObject({
      kyHieu: "1C26MAI",
      nguonKyHieu: "CAU_HINH",
    });
  });
  it("cấu hình của cơ sở KHÁC không được mượn", () => {
    expect(oSoDienSan({ nhap: null, ngayThu: "2026-10-20", coSoId: "cs2", cauHinhCoSo: [cfg()] })).toMatchObject({
      kyHieu: "",
      nguonKyHieu: "THIEU_CAU_HINH",
    });
  });
  it("ngày thu nằm NGOÀI khoảng hiệu lực của cấu hình ⇒ ký hiệu trống (không tự đổi hai số năm)", () => {
    expect(oSoDienSan({ nhap: null, ngayThu: "2025-12-31", ...khong }).kyHieu).toBe("");
    expect(oSoDienSan({ nhap: null, ngayThu: "2027-01-01", coSoId: "cs1", cauHinhCoSo: [cfg()] })).toMatchObject({ kyHieu: "", nguonKyHieu: "THIEU_CAU_HINH" });
  });
  it("nháp đã lưu ký hiệu + ngày ⇒ GIỮ NGUYÊN của kế toán, đánh dấu 'tự gõ' (đổi ngày / cấu hình không ghi đè)", () => {
    expect(
      oSoDienSan({ nhap: { ngayPhatHanh: "2026-10-05", kyHieu: "1C26ABC" }, ngayThu: "2026-10-20", coSoId: "cs1", cauHinhCoSo: [cfg()] }),
    ).toEqual({ ngayPhatHanh: "2026-10-05", kyHieu: "1C26ABC", kyHieuTay: true, nguonKyHieu: "NHAP" });
  });
  it("nháp để trống ô nào thì ô đó mới điền sẵn", () => {
    expect(oSoDienSan({ nhap: { ngayPhatHanh: null, kyHieu: null }, ngayThu: "2026-10-20", ...khong })).toMatchObject({
      ngayPhatHanh: "2026-10-20",
      kyHieu: "",
      kyHieuTay: false,
    });
  });
  it("lần thu không có ngày thu / mẫu hỏng ⇒ để trống chứ không bịa", () => {
    expect(oSoDienSan({ nhap: null, ngayThu: "", ...khong })).toMatchObject({ ngayPhatHanh: "", kyHieu: "", kyHieuTay: false });
    expect(oSoDienSan({ nhap: null, ngayThu: "20/10/2026", ...khong }).ngayPhatHanh).toBe("");
  });
});
