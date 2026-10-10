// @vitest-environment node
/**
 * [NHH-NK-01] — `conThucThu`: bản BỘ NHỚ của `WHERE_THUC_THU` (khoản có còn thuộc thực thu không). THUẦN.
 *
 * Vì sao có tệp này (lượt cấy lỗi PR5b/PR5c, 08/10): hàm này quyết định khoản bị rút (kế toán từ chối / XOÁ MỀM) có bị đảo hay không và `kiemKhoanVanNhuCu` có chặn
 * lượt ghi hay không. Bỏ vế `deletedAt === null` ⇒ khoản đã xoá mềm vẫn được tính là "đã thu" ⇒ 0 ca đỏ (mọi ca DB chỉ thử TỪ CHỐI, không thử xoá mềm).
 */
import { describe, expect, it } from "vitest";

import { TRANG_THAI_THUC_THU } from "@/lib/finance/thuc-thu";

import { conThucThu } from "./nap-khoan";

describe("[NHH-NK-01] conThucThu", () => {
  it("đối chứng dương: chưa xoá + mọi trạng thái thuộc thực thu ⇒ true", () => {
    for (const s of TRANG_THAI_THUC_THU) expect(conThucThu({ deletedAt: null, accountantStatus: s as never }), s).toBe(true);
  });

  it("XOÁ MỀM ⇒ false dù trạng thái kế toán vẫn thuộc thực thu", () => {
    for (const s of TRANG_THAI_THUC_THU) expect(conThucThu({ deletedAt: new Date("2026-10-05T03:00:00.000Z"), accountantStatus: s as never }), s).toBe(false);
  });

  it("REJECTED ⇒ false dù chưa xoá", () => {
    expect(conThucThu({ deletedAt: null, accountantStatus: "REJECTED" })).toBe(false);
  });
});
