import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NhaCungCapChuaHoTro, type HoaDonNhaCungCap } from "./hop-dong";
import { MST_NGUOI_BAN_MAU, phieuMauHopDong } from "./bo-test-hop-dong";
import { NANG_LUC, duocPhep } from "./nang-luc";
import { taoViettelSInvoiceAdapter } from "./stub-chua-ho-tro";

afterEach(() => vi.restoreAllMocks());

/** Gọi MỌI phương thức của stub (kể cả tuỳ chọn) và trả về từng lời gọi để soát. */
function moiLoiGoi(adapter: HoaDonNhaCungCap): ReadonlyArray<readonly [string, () => Promise<unknown>]> {
  const p = phieuMauHopDong("hdncc-st");
  const m = MST_NGUOI_BAN_MAU;
  const goc = { soHoaDon: "1", kyHieu: "1C26TSR", ngayHoaDon: new Date("2026-09-30T00:00:00.000Z"), maTraCuu: "MA" };
  const a = adapter;
  const dinh = <T>(f: T | undefined, ten: string): T => {
    if (f === undefined) throw new Error(`stub thiếu phương thức ${ten}`);
    return f;
  };
  return [
    ["phatHanh", () => a.phatHanh(p)],
    ["traCuu", () => a.traCuu("khoa", m)],
    ["taiTep(pdf)", () => a.taiTep("MA", "pdf", m)],
    ["taiTep(xml)", () => a.taiTep("MA", "xml", m)],
    ["kiemTraKetNoi", () => dinh(a.kiemTraKetNoi, "kiemTraKetNoi").call(a)],
    ["layPhapNhan", () => dinh(a.layPhapNhan, "layPhapNhan").call(a, m)],
    ["layDanhMucMauKyHieu", () => dinh(a.layDanhMucMauKyHieu, "layDanhMucMauKyHieu").call(a, m, 2026)],
    ["layTrangThai", () => dinh(a.layTrangThai, "layTrangThai").call(a, "MA", m)],
    ["guiEmail", () => dinh(a.guiEmail, "guiEmail").call(a, { maTraCuu: "MA", mstNguoiBan: m, nguoiNhan: ["a@b.vn"] })],
    ["dieuChinh", () => dinh(a.dieuChinh, "dieuChinh").call(a, { phieu: p, goc, lyDo: "x" })],
    ["thayThe", () => dinh(a.thayThe, "thayThe").call(a, { phieu: p, goc, lyDo: "x" })],
    ["huy", () => dinh(a.huy, "huy").call(a, { goc, lyDo: "x" })],
    ["baoSaiSot", () => dinh(a.baoSaiSot, "baoSaiSot").call(a, { goc, lyDo: "x" })],
  ];
}

// VIN-HOADON đã ra khỏi danh sách stub (02/11/2026) — adapter thật ở vin-adapter.ts, test ở vin-adapter.test.ts.
const CAC_STUB = [
  { ten: "ViettelSInvoiceAdapter", tao: taoViettelSInvoiceAdapter, ma: "VIETTEL_SINVOICE" as const, phaiNhac: [/OD-07/, /sandbox/i, /tài liệu/i] },
];

describe.each(CAC_STUB)("[HDNCC-ST] $ten — stub BLOCKED", ({ tao, ma, phaiNhac }) => {
  it("[HDNCC-ST-01] adapterImplements=false và duocPhep=false cho MỌI năng lực; providerSupports=CHUA_XAC_MINH (không bịa)", () => {
    const adapter = tao();
    expect(adapter.nhaCungCap).toBe(ma);
    for (const nl of NANG_LUC) {
      expect(adapter.nangLuc[nl].adapterImplements, nl).toBe(false);
      expect(duocPhep(adapter.nangLuc, nl), nl).toBe(false);
      expect(adapter.nangLuc[nl].providerSupports, nl).toBe("CHUA_XAC_MINH");
      expect(adapter.nangLuc[nl].ghiChu, nl).toMatch(/OD-07/);
    }
  });

  it("[HDNCC-ST-02] MỌI lời gọi (13 phương thức) bị từ chối bằng NhaCungCapChuaHoTro, mã EN PROVIDER_NOT_SUPPORTED, thông điệp VI nêu OD-07 + điều còn thiếu", async () => {
    const adapter = tao();
    const lois = moiLoiGoi(adapter);
    expect(lois).toHaveLength(13);
    for (const [ten, goi] of lois) {
      const loi = await goi().then(
        () => null,
        (e: unknown) => e,
      );
      expect(loi, ten).toBeInstanceOf(NhaCungCapChuaHoTro);
      if (loi instanceof NhaCungCapChuaHoTro) {
        expect(loi.ma, ten).toBe("PROVIDER_NOT_SUPPORTED");
        expect(loi.nhaCungCap, ten).toBe(ma);
        for (const mau of phaiNhac) expect(loi.message, ten).toMatch(mau);
      }
    }
  });

  it("[HDNCC-ST-03] lỗi gắn đúng năng lực bị gọi (taiTep pdf ≠ xml)", async () => {
    const adapter = tao();
    const pdf = await adapter.taiTep("MA", "pdf", MST_NGUOI_BAN_MAU).catch((e: unknown) => e);
    const xml = await adapter.taiTep("MA", "xml", MST_NGUOI_BAN_MAU).catch((e: unknown) => e);
    expect(pdf).toBeInstanceOf(NhaCungCapChuaHoTro);
    expect(xml).toBeInstanceOf(NhaCungCapChuaHoTro);
    if (pdf instanceof NhaCungCapChuaHoTro && xml instanceof NhaCungCapChuaHoTro) {
      expect(pdf.nangLuc).toBe("TAI_PDF");
      expect(xml.nangLuc).toBe("TAI_XML");
    }
  });

  it("[HDNCC-ST-04] stub KHÔNG gọi mạng và không rò URL/endpoint/credential vào thông điệp", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = tao();
    for (const [, goi] of moiLoiGoi(adapter)) {
      const loi = await goi().catch((e: unknown) => e);
      if (loi instanceof Error) expect(loi.message).not.toMatch(/https?:\/\/|password|bearer/i);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("[HDNCC-ST-05] moiTruongVanHanh=CHUA_CO (không phải môi trường nào) và adapter đóng băng", () => {
    const adapter = tao();
    expect(adapter.moiTruongVanHanh).toBe("CHUA_CO");
    expect(Object.isFrozen(adapter)).toBe(true);
  });
});

describe("[HDNCC-ST] mã nguồn stub — không bịa endpoint/tham số", () => {
  it("[HDNCC-ST-06] tệp stub không chứa URL nào (https://, http://) — không có đường dẫn API tự nghĩ ra", () => {
    const nguon = readFileSync(resolve(process.cwd(), "lib/finance/hoa-don/nha-cung-cap/stub-chua-ho-tro.ts"), "utf8");
    expect(nguon.length).toBeGreaterThan(500); // chống đọc rỗng
    expect(nguon).not.toMatch(/https?:\/\//);
    expect(nguon).not.toMatch(/\bfetch\s*\(/);
  });
});
