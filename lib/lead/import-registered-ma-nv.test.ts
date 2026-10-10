/**
 * Ca [IRM-*] — cột TUỲ CHỌN "Mã NV giới thiệu" của file ĐĂNG KÝ (parser thuần, 09/10/2026).
 * Parser chỉ GOM chữ người gõ theo phụ huynh (SĐT); giải ra người + cổng "không ép nguồn" ở `lib/nguon/ma-nv-gioi-thieu*.ts`.
 */
import { describe, expect, it } from "vitest";
import { parseRegisteredSheets, type SheetAoA } from "./import-registered";

const HDR = ["STT", "Ngày", "MÃ HỌC VIÊN", "Họ và Tên học viên", "Lớp", "Số điện thoại", "Nguồn", "Khoá học đăng ký", "Học phí", "Sales"];
const HDR_MA = [...HDR, "Mã NV giới thiệu"];

const sheet = (hdr: string[], rows: (string | number | null)[][]): SheetAoA[] => [{ name: "T10", rows: [hdr, ...rows] }];
const dong = (ten: string, sdt: string, ma?: string | null): (string | number | null)[] => [
  1, null, "CS1.HV.0001", ten, "Lớp 3", sdt, null, "Sata 4", 8640000, "Liên", ...(ma === undefined ? [] : [ma]),
];

describe("[IRM-01] cột 'Mã NV giới thiệu' của file đăng ký", () => {
  it("file KHÔNG có cột ⇒ referrerCodes rỗng (hành vi cũ, không ném)", () => {
    const r = parseRegisteredSheets(sheet(HDR, [dong("HV MỘT", "0905000001")]));
    expect(r.parents).toHaveLength(1);
    expect(r.parents[0]!.referrerCodes).toEqual([]);
  });

  it("có cột, ô trống / toàn khoảng trắng ⇒ rỗng", () => {
    const r = parseRegisteredSheets(sheet(HDR_MA, [dong("HV MỘT", "0905000001", null), dong("HV HAI", "0905000002", "   ")]));
    expect(r.parents.map((p) => p.referrerCodes)).toEqual([[], []]);
  });

  it("có mã ⇒ giữ NGUYÊN chữ người gõ (chuẩn hoá để sau, ở tầng giải mã)", () => {
    const r = parseRegisteredSheets(sheet(HDR_MA, [dong("HV MỘT", "0905000001", " nv.sr.002 ")]));
    expect(r.parents[0]!.referrerCodes).toEqual(["nv.sr.002"]);
  });

  it("tên cột đọc theo tên đã bỏ dấu; cột 'Sales' KHÔNG bị nhầm với cột người giới thiệu", () => {
    const r = parseRegisteredSheets(sheet(HDR_MA, [dong("HV MỘT", "0905000001", "SR.NV.002")]));
    expect(r.parents[0]!.salesName).toBe("Liên");
    expect(r.parents[0]!.referrerCodes).toEqual(["SR.NV.002"]);
  });

  it("nhiều dòng cùng SĐT (cùng một nhà) ⇒ gom MỌI mã, kể cả mã khác nhau — tầng gộp quyết, parser không chọn", () => {
    const r = parseRegisteredSheets(
      sheet(HDR_MA, [dong("HV MỘT", "0905000001", "SR.NV.002"), dong("HV HAI", "0905000001", null), dong("HV BA", "0905000001", "SR.NV.006")]),
    );
    expect(r.parents).toHaveLength(1);
    expect(r.parents[0]!.referrerCodes).toEqual(["SR.NV.002", "SR.NV.006"]);
  });
});
