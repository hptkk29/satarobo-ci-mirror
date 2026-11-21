// @vitest-environment node
/**
 * [NHH-TRX-SIB-03*] — "bé" của khoản thu khi tìm buổi trial cho GV Trial (audit XII · GAP-3). THUẦN + lưới dây nối.
 *
 * Lỗi cũ: `order.leadChildId ?? sv?.leadChildId` — đơn hai bé, bé B trả tiền ở dòng của mình mà đi tìm buổi trial của bé A (bé trên đơn).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { leadChildChoGvTrial } from "./be-cua-khoan";

describe("[NHH-TRX-SIB-03] leadChildChoGvTrial — chỉ đổi đúng ca bé trên đơn là của HỌC VIÊN KHÁC", () => {
  it("[NHH-TRX-SIB-03a] đơn hai bé: bé trên đơn (A) đã thuộc học viên A, người trả tiền là B có bé riêng ⇒ dùng bé của B", () => {
    expect(
      leadChildChoGvTrial({ studentLeadChildId: "be-B", orderLeadChildId: "be-A", hocVienTheoLeadChildCuaDon: "hv-A", studentId: "hv-B" }),
    ).toBe("be-B");
  });

  it("[NHH-TRX-SIB-03b] người trả tiền (B) CHƯA gắn bé mà bé trên đơn thuộc học viên khác (A) ⇒ null (không GV Trial) — không mượn bé của anh/chị", () => {
    expect(
      leadChildChoGvTrial({ studentLeadChildId: null, orderLeadChildId: "be-A", hocVienTheoLeadChildCuaDon: "hv-A", studentId: "hv-B" }),
    ).toBeNull();
  });

  it("[NHH-TRX-SIB-03c] HÀNH VI CŨ GIỮ NGUYÊN: bé trên đơn CHƯA thuộc học viên nào (đơn một bé, học viên chưa gắn bé) ⇒ dùng bé trên đơn — không được làm mất GV Trial (23 ca DB đỏ ở CI)", () => {
    expect(leadChildChoGvTrial({ studentLeadChildId: null, orderLeadChildId: "be-A", hocVienTheoLeadChildCuaDon: null, studentId: "hv-B" })).toBe("be-A");
  });

  it("[NHH-TRX-SIB-03d] bé trên đơn CHÍNH là bé của người trả tiền ⇒ dùng bé trên đơn", () => {
    expect(leadChildChoGvTrial({ studentLeadChildId: "be-A", orderLeadChildId: "be-A", hocVienTheoLeadChildCuaDon: "hv-A", studentId: "hv-A" })).toBe("be-A");
  });

  it("[NHH-TRX-SIB-03e] đơn KHÔNG có bé ⇒ bé của người trả tiền; cả hai đều trống ⇒ null", () => {
    expect(leadChildChoGvTrial({ studentLeadChildId: "be-B", orderLeadChildId: null, hocVienTheoLeadChildCuaDon: null, studentId: "hv-B" })).toBe("be-B");
    expect(leadChildChoGvTrial({ studentLeadChildId: null, orderLeadChildId: null, hocVienTheoLeadChildCuaDon: null, studentId: "hv" })).toBeNull();
  });

  it("[NHH-TRX-SIB-03f] học viên TÁI SỬ DỤNG từ lead cũ: Student.leadChildId là bé CŨ, đơn mới mang bé MỚI chưa thuộc học viên nào ⇒ theo bé MỚI (bản đầu của PR trả bé cũ — sai)", () => {
    expect(leadChildChoGvTrial({ studentLeadChildId: "be-cu", orderLeadChildId: "be-moi", hocVienTheoLeadChildCuaDon: null, studentId: "hv-1" })).toBe("be-moi");
  });
});
describe("[NHH-TRX-SIB-03w] dây nối: CẢ HAI nơi dựng đầu vào chính sách đều đi qua leadChildChoGvTrial", () => {
  const doc = (f: string) =>
    readFileSync(resolve(process.cwd(), f), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/[^\n]*/gm, "$1");

  it("[NHH-TRX-SIB-03w-1] quet-khoan.ts (đường GHI) và doc-so.ts (dự kiến) gọi đúng MỘT lần; không còn `order.leadChildId ??` / `o.leadChildId ??`", () => {
    const qk = doc("lib/hoa-hong/quet-khoan.ts");
    const ds = doc("lib/hoa-hong/doc-so.ts");
    expect((qk.match(/leadChildChoGvTrial\(/g) ?? []).length).toBe(1);
    expect((ds.match(/leadChildChoGvTrial\(/g) ?? []).length).toBe(1);
    expect(qk).not.toMatch(/leadChildId:\s*order\.leadChildId\s*\?\?/);
    expect(ds).not.toMatch(/leadChildId:\s*o\.leadChildId\s*\?\?/);
  });
});
