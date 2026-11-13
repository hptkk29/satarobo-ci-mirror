// [DAD] — nhận biết học viên đã ẩn danh theo NĐ13 (lib/students/da-an-danh.ts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  hocVienDaAnDanhTheoNhatKy,
  tenLaDaAnDanh,
  TIEN_TO_TEN_DA_AN_DANH,
} from "./da-an-danh";

describe("[DAD] học viên đã ẩn danh", () => {
  it("[DAD-01] tên mang tiền tố ẩn danh — cả dạng NFC lẫn NFD (gõ từ macOS/iOS)", () => {
    expect(tenLaDaAnDanh(`${TIEN_TO_TEN_DA_AN_DANH} abc123]`)).toBe(true);
    expect(tenLaDaAnDanh(`${TIEN_TO_TEN_DA_AN_DANH} abc123]`.normalize("NFD"))).toBe(true);
  });

  it("[DAD-02] tên thường, rỗng, null ⇒ KHÔNG coi là đã ẩn danh", () => {
    expect(tenLaDaAnDanh("Đỗ Duy Khoa")).toBe(false);
    expect(tenLaDaAnDanh("Đã xoá")).toBe(false); // thiếu dấu "[" — không phải dấu của hệ thống
    expect(tenLaDaAnDanh("")).toBe(false);
    expect(tenLaDaAnDanh(null)).toBe(false);
  });

  it("[DAD-03] tra nhật ký: đúng MỘT câu, lọc Student + ERASE_PII, trả tập id có dòng", async () => {
    const findMany = vi.fn(async (_args: unknown) => [{ entityId: "s2" }]);
    const kq = await hocVienDaAnDanhTheoNhatKy({ auditLog: { findMany } }, ["s1", "s2"]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0]).toEqual({
      where: { entityType: "Student", action: "ERASE_PII", entityId: { in: ["s1", "s2"] } },
      select: { entityId: true },
    });
    expect([...kq]).toEqual(["s2"]);
  });

  it("[DAD-04] danh sách rỗng ⇒ KHÔNG truy vấn", async () => {
    const findMany = vi.fn(async (_args: unknown) => [] as { entityId: string }[]);
    const kq = await hocVienDaAnDanhTheoNhatKy({ auditLog: { findMany } }, []);
    expect(findMany).not.toHaveBeenCalled();
    expect(kq.size).toBe(0);
  });
});

// Lưới ghim mã nguồn (mẫu CLAUDE.md "LƯỚI GHIM MÃ NGUỒN"): hai đường nối lead KHÔNG có DB
// trong bộ unit — thứ cần khoá là "lời gọi kiểm ẩn danh có mặt ở đúng chỗ". Bỏ chú thích
// trước khi soi (chú thích giải thích bản vá chứa đúng các chuỗi đang tìm).
function maKhongChuThich(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

describe("[DAD] các đường nối lead hỏi dấu ẩn danh", () => {
  it("[DAD-05] convert dùng lại HV: kiểm CẢ tên lẫn nhật ký, và chặn nối khi đã ẩn danh", () => {
    const s = maKhongChuThich("lib/crm/convert-lead-v2.ts");
    expect(s.match(/tenLaDaAnDanh\(cu\.name\)/g)?.length).toBe(1);
    expect(s.match(/hocVienDaAnDanhTheoNhatKy\(tx, \[existingId\]\)/g)?.length).toBe(1);
    expect(s.match(/cu\.leadId === null && !daAnDanh/g)?.length).toBe(1);
  });

  it("[DAD-06] script nối lead: loại lúc lập kế hoạch VÀ kiểm lại trong transaction ghi", () => {
    const s = maKhongChuThich("scripts/noi-hoc-vien-voi-lead.ts");
    expect(s.match(/hocVienDaAnDanhTheoNhatKy\(db, lo\)/g)?.length).toBe(1);
    expect(s.match(/hocVienDaAnDanhTheoNhatKy\(tx, /g)?.length).toBe(1);
    expect(s.match(/!tenLaDaAnDanh\(s\.name\)/g)?.length).toBe(2);
  });
});
