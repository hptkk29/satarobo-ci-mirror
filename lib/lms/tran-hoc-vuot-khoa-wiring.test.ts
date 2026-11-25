// lib/lms/tran-hoc-vuot-khoa-wiring.test.ts — LƯỚI GHIM DÂY NỐI của TRẦN HỌC VƯỢT THEO KHOÁ [28/10/2026]. KHÔNG DB.
//
// Hành vi đo ở `[XBD-24..26]` (thuần) · `[FCD-02b]` (form) · `[CDH-17]` + `[XL-DB-41]` (Postgres thật). Lưới này canh thứ test hành vi KHÔNG chắc bắt được: quên truyền mức khoá
// ở MỘT trong ba chỗ (màn lọc lớp, máy chủ chuyển đổi, quyền học xếp lớp) làm khoá đó rơi về mức cơ sở mà không lỗi nào báo.
// Luật 11: neo biểu thức/lời GỌI trên mã ĐÃ BỎ CHÚ THÍCH, đếm SỐ LẦN.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const doc = (tep: string) => boChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (s: string, re: RegExp) => s.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

describe("[THK-W] trần học vượt theo khoá — dây nối", () => {
  it("[THK-W1] bộ nạp màn chuyển đổi: mỗi DÒNG mang `tran` của KHOÁ (mức khoá thắng mức cơ sở), nạp cột từ Course", () => {
    const CDD = doc("lib/orders/chuyen-doi-don.ts");
    expect(CDD).toMatch(/tran:\s*tranHocVuotCuaKhoa\(k\?\.catchUpMaxSessions \?\? null,\s*boiCanh\.tran\)/);
    expect(dem(CDD, /catchUpMaxSessions:\s*true/)).toBe(1);
  });

  it("[THK-W2] máy chủ chuyển đổi xét lớp theo `goc.tran` CỦA DÒNG, không còn dùng trần cơ sở chung ở phép xét", () => {
    const ACT = doc("app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts");
    expect(ACT).toMatch(/xetTheoBuoiBatDau\(\{[^}]*tran:\s*goc\.tran\s*\}\)/);
    expect(ACT).not.toMatch(/xetTheoBuoiBatDau\(\{[^}]*tran:\s*boiCanh\.tran/);
  });

  it("[THK-W3] form: phép xét lớp đọc `d.tran`; không còn prop `tran` chung", () => {
    const FORM = doc("app/(admin)/admin/orders/[id]/chuyen-doi/_components/form-chuyen-doi.tsx");
    expect(FORM).toMatch(/tran:\s*d\.tran/);
    expect(FORM).not.toMatch(/\btran=\{/);
  });

  it("[THK-W4] quyền học xếp lớp: cấu hình của RIÊNG khoá (mức khoá thắng) đi vào CẢ phép tính lập kế hoạch lẫn `xepLopTrongTx`", () => {
    const XEP = doc("lib/entitlements/xep-lop-tu-don.ts");
    expect(dem(XEP, /catchUpMaxSessions:\s*tranHocVuotCuaKhoa\(/)).toBe(1);
    expect(XEP).toMatch(/cauHinh:\s*k\.cauHinh,/); // xepLopTrongTx (dưới khoá)
    expect(dem(XEP, /(?<![.\w])cauHinh,\s*baiMoiBuoiHocVuot,\s*batDauChon:/)).toBe(1); // tinhBatDauKhiXepLop (kế hoạch) dùng `cauHinh` của khoá
  });

  it("[THK-W5] action cấu hình khoá: cổng `gate()` TRƯỚC phép ghi, biên 0..48 + null, audit; trang khoá vẽ mục và nạp cột", () => {
    const ACT = doc("app/(admin)/admin/courses/[id]/_actions.ts");
    const i = ACT.indexOf("export async function luuTranHocVuotKhoaAction");
    const than = ACT.slice(i);
    expect(than.indexOf("gate()")).toBeGreaterThan(-1);
    expect(than.indexOf("gate()")).toBeLessThan(than.indexOf("course.update("));
    expect(ACT).toMatch(/z\.number\(\)\.int\(\)\.min\(0,[^)]*\)\.max\(48,[^)]*\)\.nullable\(\)/);
    expect(than).toMatch(/writeAudit\(/);
    const PAGE = doc("app/(admin)/admin/courses/[id]/page.tsx");
    expect(PAGE).toMatch(/catchUpMaxSessions:\s*true/);
    expect(PAGE).toMatch(/<HocVuotSection courseId=\{course\.id\} tran=\{course\.catchUpMaxSessions\} canEdit=\{canEdit\}/);
  });
});
