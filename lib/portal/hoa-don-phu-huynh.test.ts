// @vitest-environment node
// [HDPH-CO] Cờ hoá đơn quyết định có đọc/hiện hoá đơn hay không (chạm DB thật ở tests/finance/hoa-don-phu-huynh-db.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ laHoaDonBat: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), kho: vi.fn(), donFindMany: vi.fn() }));

vi.mock("@/lib/finance/hoa-don/feature", () => ({ laHoaDonBat: m.laHoaDonBat }));
vi.mock("@/lib/finance/hoa-don/kho-tep", () => ({ khoHoaDonDaCauHinh: m.kho }));
vi.mock("@/lib/db", () => ({ db: { hoaDonDienTu: { findMany: m.findMany, findFirst: m.findFirst }, order: { findMany: m.donFindMany } } }));

import { docHoaDonDeTai, docMucHoaDon } from "@/lib/portal/hoa-don-phu-huynh";

beforeEach(() => {
  vi.clearAllMocks();
  m.kho.mockReturnValue(true);
  m.findMany.mockResolvedValue([]);
  m.donFindMany.mockResolvedValue([{ invoiceBuyerName: "Nguyễn Văn A", invoiceCompanyName: null, invoiceTaxCode: null, invoiceEmail: null }]);
});

describe("[HDPH-CO] cờ hoá đơn", () => {
  it("cờ TẮT ⇒ { bat:false } và KHÔNG chạm bảng hoá đơn", async () => {
    m.laHoaDonBat.mockResolvedValue(false);
    expect(await docMucHoaDon(["s1"])).toEqual({ bat: false, items: [] });
    expect(m.findMany).not.toHaveBeenCalled();
  });
  it("cờ BẬT nhưng KHÔNG đơn nào có nhu cầu ⇒ ẩn hẳn (bat:false), KHÔNG đọc bảng hoá đơn", async () => {
    m.laHoaDonBat.mockResolvedValue(true);
    m.donFindMany.mockResolvedValue([]);
    expect(await docMucHoaDon(["s1"])).toEqual({ bat: false, items: [] });
    expect(m.findMany).not.toHaveBeenCalled();
  });
  it("đơn trả về từ DB nhưng cột người mua trống (lọc thô lọt) ⇒ vẫn KHÔNG nhu cầu", async () => {
    m.laHoaDonBat.mockResolvedValue(true);
    m.donFindMany.mockResolvedValue([{ invoiceBuyerName: " ", invoiceCompanyName: null, invoiceTaxCode: "", invoiceEmail: null }]);
    expect((await docMucHoaDon(["s1"])).bat).toBe(false);
  });
  it("có nhu cầu, chưa có hoá đơn đã xuất ⇒ bat:true, items rỗng (màn nói «sẽ hiện ở đây…»)", async () => {
    m.laHoaDonBat.mockResolvedValue(true);
    expect(await docMucHoaDon(["s1"])).toEqual({ bat: true, items: [] });
  });
  it("cờ BẬT (đối chứng dương) ⇒ bat:true và có truy vấn, kèm điều kiện DA_XAC_NHAN", async () => {
    m.laHoaDonBat.mockResolvedValue(true);
    const r = await docMucHoaDon(["s1"]);
    expect(r.bat).toBe(true);
    expect(m.findMany).toHaveBeenCalledTimes(1);
    expect(m.findMany.mock.calls[0][0].where.trangThai).toBe("DA_XAC_NHAN");
    expect(JSON.stringify(m.findMany.mock.calls[0][0].where.AND)).toContain("invoiceTaxCode");
  });
  it("cờ BẬT nhưng phụ huynh chưa có con ⇒ ẩn, không truy vấn", async () => {
    m.laHoaDonBat.mockResolvedValue(true);
    expect(await docMucHoaDon([])).toEqual({ bat: false, items: [] });
    expect(m.findMany).not.toHaveBeenCalled();
  });
  it("tra để tải: DB trả hoá đơn nhưng đơn KHÔNG có nhu cầu ⇒ null (kiểm lại bằng hàm thuần)", async () => {
    m.findFirst.mockResolvedValue({ id: "hd1", order: { invoiceBuyerName: null, invoiceCompanyName: null, invoiceTaxCode: null, invoiceEmail: null } });
    expect(await docHoaDonDeTai(["s1"], "hd1")).toBeNull();
    m.findFirst.mockResolvedValue({ id: "hd1", order: { invoiceBuyerName: "A", invoiceCompanyName: null, invoiceTaxCode: null, invoiceEmail: null } });
    expect((await docHoaDonDeTai(["s1"], "hd1"))?.id).toBe("hd1");
  });
  it("tra một hoá đơn để tải: không có con ⇒ null, không truy vấn", async () => {
    expect(await docHoaDonDeTai([], "hd1")).toBeNull();
    expect(m.findFirst).not.toHaveBeenCalled();
  });
});
