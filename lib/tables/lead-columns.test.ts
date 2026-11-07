/**
 * DANH MỤC CỘT bảng Lead — mỗi khoá phải có một `case` trong `LeadCell`.
 *
 * Vì sao khoá bằng test: thêm cột vào danh mục mà quên `case` thì cột hiện trong hộp
 * chọn, người dùng bật lên, và ô luôn trống — trông y hệt "dữ liệu bị mất". Không lỗi
 * nào nổ, không ai biết cho tới khi có người hỏi vì sao khách nào cũng không có email.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { LEAD_COLUMNS, cotMacDinh, chuanHoaCot, doiChoCot, laNhapLai } from "./lead-columns";

const NGUON = path.join(
  process.cwd(),
  "app",
  "(admin)",
  "admin",
  "leads",
  "_components",
  "leads-table.tsx",
);

describe("danh mục cột bảng Lead", () => {
  it("mỗi khoá cột có một `case` trong LeadCell", () => {
    const src = fs.readFileSync(NGUON, "utf8");
    const thieu = LEAD_COLUMNS.filter((c) => !src.includes(`case '${c.key}':`)).map((c) => c.key);
    expect(thieu, `thiếu case trong LeadCell cho: ${thieu.join(", ")}`).toEqual([]);
  });

  it("khoá không trùng nhau", () => {
    expect(new Set(LEAD_COLUMNS.map((c) => c.key)).size).toBe(LEAD_COLUMNS.length);
  });

  it("bộ mặc định KHÔNG chứa 'Lần nhập gần nhất' (chốt 30/08)", () => {
    // Cột này chỉ có nghĩa với phiếu khách quay lại; bật mặc định thì đa số dòng in ra
    // đúng bằng "Ngày nhận lead" — tốn một cột ngang mà không nói thêm gì.
    expect(cotMacDinh()).not.toContain("lastInboundAt");
    expect(LEAD_COLUMNS.some((c) => c.key === "lastInboundAt")).toBe(true);
  });

  it("cột bắt buộc luôn được kèm, kể cả khi người dùng bỏ nó đi", () => {
    const batBuoc = LEAD_COLUMNS.filter((c) => c.batBuoc).map((c) => c.key);
    expect(batBuoc.length).toBeGreaterThan(0);
    for (const k of batBuoc) expect(chuanHoaCot(["phone"])).toContain(k);
  });

  it("giá trị hỏng / khoá lạ → rơi về bộ mặc định, KHÔNG ra bảng trắng", () => {
    expect(chuanHoaCot(null)).toEqual(cotMacDinh());
    expect(chuanHoaCot("linh tinh")).toEqual(cotMacDinh());
    expect(chuanHoaCot(["cot_khong_ton_tai"])).toEqual(cotMacDinh());
  });

  it("GIỮ NGUYÊN thứ tự người dùng đã chọn (đảo chốt 30/08 — cho phép sắp xếp)", () => {
    // Kể cả cột BẮT BUỘC cũng được dời: "bắt buộc" nghĩa là không TẮT được, không
    // phải là bị ghim ở cột đầu. Ghim nó lại thì người dùng dời được 13 cột và cột
    // thứ 14 tự nhảy về chỗ cũ — trông như nút hỏng.
    const nguoc = [...LEAD_COLUMNS].map((c) => c.key).reverse();
    expect(chuanHoaCot(nguoc)).toEqual(nguoc);
  });

  it("cột BẮT BUỘC thiếu thì chèn lên ĐẦU, không phải giữa bảng", () => {
    // Nó là cột định danh; nằm giữa thì người đọc không biết mỗi dòng nói về ai cho
    // tới khi cuộn tới nó.
    const ra = chuanHoaCot(["phone", "status", "center"]);
    expect(ra[0]).toBe("parentName");
  });

  it("doiChoCot dời một bậc, và KHÔNG rơi ra ngoài mảng", () => {
    const c = ["a", "b", "c"];
    expect(doiChoCot(c, "b", -1)).toEqual(["b", "a", "c"]);
    expect(doiChoCot(c, "b", 1)).toEqual(["a", "c", "b"]);
    // Đầu/cuối mảng và khoá lạ → trả nguyên trạng, không ném.
    expect(doiChoCot(c, "a", -1)).toEqual(c);
    expect(doiChoCot(c, "c", 1)).toEqual(c);
    expect(doiChoCot(c, "z", 1)).toEqual(c);
    // Không sửa mảng gốc.
    expect(c).toEqual(["a", "b", "c"]);
  });
});

describe("laNhapLai — nhãn 'nhập lại' trên ô Ngày nhận lead", () => {
  const TAO = "2026-06-04T15:26:00.000Z";

  it("mốc nhập MỚI HƠN ngày tạo ⇒ đúng là khách quay lại", () => {
    expect(laNhapLai(TAO, "2026-09-07T15:26:00.000Z")).toBe(true);
  });

  it("BẰNG ngày tạo ⇒ SAI — đây là ca thường gặp nhất, không phải ngoại lệ", () => {
    // Lúc tạo lead, `lastInboundAt` được đặt BẰNG `createdAt` (intake/ingest.ts,
    // assign-lead.ts). Dùng `>=` là dán nhãn "nhập lại" lên MỌI phiếu — nhãn mất sạch
    // ý nghĩa mà nhìn qua không ai thấy sai.
    expect(laNhapLai(TAO, TAO)).toBe(false);
  });

  it("mốc CŨ HƠN ngày tạo (dữ liệu lệch) ⇒ SAI, không dán nhãn bừa", () => {
    expect(laNhapLai(TAO, "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("null / undefined (lead trước migration 29/08) ⇒ SAI, không kết luận gì", () => {
    expect(laNhapLai(TAO, null)).toBe(false);
    expect(laNhapLai(TAO, undefined)).toBe(false);
  });
});
