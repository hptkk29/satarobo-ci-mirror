// @vitest-environment node
/**
 * [AFR5-CLS-*] — R5 (chốt 13/10/2026): Affiliate KHÔNG có phân loại NEW/RENEWAL riêng. Chính sách Affiliate chỉ ĐỌC kết quả phân loại của engine hiện hữu
 * (`lib/hoa-hong/phan-loai-giao-dich*`: thứ tự mua theo `taoLuc` + `Order.id`). Lưới ghim LÝ LẼ: không tệp nào của `lib/affiliate` (ngoài test) tự tính hay đọc cờ tay.
 *
 *   [AFR5-CLS-01] không import `phan-loai-giao-dich*` và không nhắc `renewedFromEnrollmentId` / `xepLanMuaTruoc` / `cungLanMua` / `quanHeLanMua`
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = resolve(process.cwd(), "lib/affiliate");
const tepNguon = readdirSync(GOC).filter((t) => t.endsWith(".ts") && !t.endsWith(".test.ts") && !t.endsWith(".spec.ts"));

describe("[AFR5-CLS-01] Affiliate không tự phân loại NEW/RENEWAL", () => {
  it("có tệp để quét (đối chứng: lưới không rỗng)", () => {
    expect(tepNguon.length).toBeGreaterThan(20);
  });
  it.each(["phan-loai-giao-dich", "renewedFromEnrollmentId", "xepLanMuaTruoc", "cungLanMua", "quanHeLanMua"])("không tệp nào nhắc %s", (tu) => {
    const vi = tepNguon.filter((t) => readFileSync(join(GOC, t), "utf8").includes(tu));
    expect(vi).toEqual([]);
  });
});
