// @vitest-environment node
/**
 * Ô "Đơn vị làm việc" KHÔNG được nhận lựa chọn mà lúc lưu sẽ bị vứt bỏ.
 *
 * ─── Bẫy đã xảy ra thật (22/08/2026) ─────────────────────────────────────────
 * `handleSubmit` gửi `orgUnitId: isHO ? null : data.orgUnitId || null`. Nhưng ô
 * chọn đơn vị VẪN BẬT khi công tắc "Nhân viên HO" đang ON, nên người dùng chọn
 * được CS1, bấm Lưu, thấy toast "Đã cập nhật" — và KHÔNG GÌ được ghi.
 *
 * Bốn giáo viên parttime đã mất một vòng đúng như vậy: Nhân sự báo đã cập nhật
 * hồ sơ, nhưng đo lại trên prod thì `User.orgUnitId` và `Employee.orgUnitId` vẫn
 * trống, và cả bốn vẫn ở HO-level ⇒ vẫn đọc được dữ liệu của MỌI cơ sở.
 *
 * Đây là loại lỗi tệ nhất trong nhóm lỗi giao diện: nó không báo gì, và nó khiến
 * người vận hành tin rằng việc đã xong. Cách vá đúng không phải thêm một dòng
 * cảnh báo — mà là làm cho thao tác vứt-bỏ trở thành BẤT KHẢ THI.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "components/admin/nhan-su/employee-form.tsx"),
  "utf8",
);

describe("form nhân sự — ô đơn vị không được nhận giá trị sẽ bị vứt", () => {
  it("đường LƯU vẫn null hoá orgUnitId khi bật HO (hành vi đúng, giữ nguyên)", () => {
    // Neo dương: nếu ai đó đổi đường lưu thì case dưới mất nghĩa, và test này
    // sẽ đỏ để nhắc xem lại cả cặp.
    expect(SRC).toContain("orgUnitId: isHO ? null :");
  });

  it("⇒ ô chọn đơn vị PHẢI bị khoá khi đang bật HO", () => {
    // Không có dòng này thì người dùng chọn được thứ sẽ bị vứt.
    expect(SRC).toMatch(/<select[\s\S]{0,200}disabled=\{isHO\}/);
  });

  it("và phải nói VÌ SAO bị khoá, kèm cách đi tiếp", () => {
    // Một ô xám không lời giải thích chỉ đổi "im lặng vứt bỏ" thành "im lặng
    // chặn" — người vận hành vẫn không biết phải làm gì.
    expect(SRC).toContain("tắt công tắc trên");
  });

  it("bật HO vẫn xoá lựa chọn đang có (không để lại giá trị chết trong form)", () => {
    expect(SRC).toMatch(/setIsHO\(v\)[\s\S]{0,120}orgUnitId: ""/);
  });
});
