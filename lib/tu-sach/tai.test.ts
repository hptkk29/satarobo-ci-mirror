/**
 * [TS-TAI-*] Xin link tải ebook (kho R2 và thẻ mở khoá được tiêm).
 *   [TS-TAI-01] chưa để lại thông tin ⇒ 401, KHÔNG chạm kho (không ký, không HEAD)
 *   [TS-TAI-02] đã mở khoá + có tệp ⇒ link ký, TTL 5 phút, tên tệp ASCII an toàn
 *   [TS-TAI-03] số lạ / không có sách / kho chưa cấu hình / chưa nhập tệp ⇒ lỗi đúng loại, KHÔNG ký link cho tệp không tồn tại
 *   [TS-TAI-04] kho ném lỗi ⇒ 503 chung, không lộ nội dung lỗi
 */
import { describe, expect, it, vi } from "vitest";
import { soEbookHopLe, tenTepTai, TTL_LINK_TAI_GIAY, xinLinkTai, type KhoTep } from "./tai";

function kho(o: Partial<KhoTep> = {}) {
  const k = {
    daCauHinh: vi.fn(() => true),
    tonTai: vi.fn(async () => true),
    kyLinkTai: vi.fn(async (khoa: string, ten: string, ttl: number) => `https://r2.example/${khoa}?ten=${ten}&ttl=${ttl}`),
    ...o,
  };
  return k;
}

describe("[TS-TAI-01] cổng thông tin", () => {
  it("chưa mở khoá ⇒ 401 và KHÔNG chạm kho", async () => {
    const k = kho();
    expect(await xinLinkTai({ soTho: "3", daMoKhoa: false, kho: k })).toEqual({ ok: false, trangThai: 401, loi: "CHUA_DE_LAI_THONG_TIN" });
    expect(k.daCauHinh).not.toHaveBeenCalled();
    expect(k.tonTai).not.toHaveBeenCalled();
    expect(k.kyLinkTai).not.toHaveBeenCalled();
  });
});

describe("[TS-TAI-02] thành công", () => {
  it("ký đúng khoá PDF, TTL 5 phút, tên tệp ASCII", async () => {
    const k = kho();
    const r = await xinLinkTai({ soTho: "1", daMoKhoa: true, kho: k });
    expect(r.ok).toBe(true);
    expect(k.tonTai).toHaveBeenCalledWith("tu-sach/ebook/1/sach.pdf");
    expect(k.kyLinkTai).toHaveBeenCalledWith("tu-sach/ebook/1/sach.pdf", expect.stringMatching(/^Sata-Robo-Ebook-1-[A-Za-z0-9-]+\.pdf$/), TTL_LINK_TAI_GIAY);
    expect(TTL_LINK_TAI_GIAY).toBe(300);
  });
  it("tenTepTai bỏ dấu, không có ký tự lạ (đi vào header)", () => {
    const ten = tenTepTai({ so: 7, tieuDe: "Script Đối Thoại Tuổi Teen: “Mẹ ơi!”\r\nX" });
    expect(ten).toMatch(/^Sata-Robo-Ebook-7-[A-Za-z0-9-]+\.pdf$/);
    expect(ten).not.toMatch(/["\r\n\\;]/);
  });
});

describe("[TS-TAI-03] không có gì để tải", () => {
  it.each([["abc"], [""], ["-1"], ["1.5"], ["1234"], ["../1"]])("số %j ⇒ 400, không chạm kho", async (so) => {
    const k = kho();
    const r = await xinLinkTai({ soTho: so, daMoKhoa: true, kho: k });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && [400, 404]).toContain(!r.ok && r.trangThai);
    expect(k.kyLinkTai).not.toHaveBeenCalled();
  });
  it("số hợp lệ nhưng không phải ebook (21, 0) ⇒ 404 KHONG_CO_SACH", async () => {
    for (const so of ["21", "0", "999"]) expect(await xinLinkTai({ soTho: so, daMoKhoa: true, kho: kho() })).toEqual({ ok: false, trangThai: 404, loi: "KHONG_CO_SACH" });
  });
  it("kho chưa cấu hình ⇒ CHUA_CO_TEP, không HEAD, không ký", async () => {
    const k = kho({ daCauHinh: vi.fn(() => false) });
    expect(await xinLinkTai({ soTho: "2", daMoKhoa: true, kho: k })).toEqual({ ok: false, trangThai: 404, loi: "CHUA_CO_TEP" });
    expect(k.tonTai).not.toHaveBeenCalled();
    expect(k.kyLinkTai).not.toHaveBeenCalled();
  });
  it("tệp chưa nhập ⇒ CHUA_CO_TEP, KHÔNG ký link", async () => {
    const k = kho({ tonTai: vi.fn(async () => false) });
    expect(await xinLinkTai({ soTho: "2", daMoKhoa: true, kho: k })).toEqual({ ok: false, trangThai: 404, loi: "CHUA_CO_TEP" });
    expect(k.kyLinkTai).not.toHaveBeenCalled();
  });
});

describe("[TS-TAI-04] lỗi kho", () => {
  it("503 chung, không lộ lỗi", async () => {
    const k = kho({ tonTai: vi.fn(async () => { throw new Error("AccessDenied: secret-bucket-xyz"); }) });
    const r = await xinLinkTai({ soTho: "2", daMoKhoa: true, kho: k });
    expect(r).toEqual({ ok: false, trangThai: 503, loi: "LOI_KHO" });
    expect(JSON.stringify(r)).not.toMatch(/AccessDenied|secret/);
  });
});

describe("soEbookHopLe", () => {
  it("chỉ nhận 1–20", () => {
    expect(soEbookHopLe("1")).toBe(1);
    expect(soEbookHopLe("20")).toBe(20);
    expect(soEbookHopLe("21")).toBeNull();
    expect(soEbookHopLe("01")).toBe(1);
  });
});
