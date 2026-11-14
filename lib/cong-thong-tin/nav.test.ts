/**
 * [CTT-NAV-*] Hằng nhãn + đường dẫn của «Tủ sách» và «Sức khỏe». Việc chèn vào menu theo cờ đã chuyển sang nhóm «Góc gia đình»
 * (`lib/public/goc-gia-dinh.ts`, ca `[GOC-*]`) — hai hàm chèn riêng từng mục đã gỡ để không có hai nơi quyết định.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SUC_KHOE_NAV, TU_SACH_NAV } from "./nav";

describe("[CTT-NAV-01] hằng nav", () => {
  it("nhãn và đường dẫn đúng", () => {
    expect([TU_SACH_NAV.label, TU_SACH_NAV.href]).toEqual(["Tủ sách", "/tu-sach"]);
    expect([SUC_KHOE_NAV.label, SUC_KHOE_NAV.href]).toEqual(["Sức khỏe", "/suc-khoe"]);
  });
  it("hai hàm chèn riêng từng mục KHÔNG còn tồn tại (đối chứng: nếu ai thêm lại, hai nơi quyết định sẽ trôi khỏi nhau)", () => {
    const s = readFileSync("lib/cong-thong-tin/nav.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(s).not.toMatch(/export function chenMuc/);
  });
});
