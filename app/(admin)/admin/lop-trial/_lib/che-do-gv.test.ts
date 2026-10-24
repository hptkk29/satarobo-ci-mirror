// Bốn tổ hợp quyền → ba tầng. Bảng chân trị đủ 2² ca, không lấy mẫu.
//
// Vì sao đáng một tệp test riêng cho bốn dòng `if`: cái sai ở đây KHÔNG ném lỗi và
// KHÔNG làm đỏ bất cứ bộ nào khác — nó chỉ làm ô chọn giáo viên THIẾU TÊN, mà "thiếu
// tên" thì người dùng đọc thành "hệ thống chưa cập nhật" rồi đi hỏi tay. Đúng lớp lỗi
// affordance nói dối (luật 12).
import { describe, expect, it } from "vitest";
import { quyRaCheDo } from "./che-do-gv";

describe("quyRaCheDo — ba tầng chọn giáo viên (V1-d)", () => {
  it("Đào tạo (trials:assign-teacher) ⇒ TAT_CA", () => {
    expect(quyRaCheDo({ toanHe: true, theoCoSo: false })).toBe("TAT_CA");
  });

  it("Quản lý cơ sở (trials:assign-teacher-center) ⇒ THEO_CO_SO", () => {
    expect(quyRaCheDo({ toanHe: false, theoCoSo: true })).toBe("THEO_CO_SO");
  });

  it("không khoá nào (Sale) ⇒ LOC_THEO_CA — tầng HẸP nhất, fail-closed", () => {
    expect(quyRaCheDo({ toanHe: false, theoCoSo: false })).toBe("LOC_THEO_CA");
  });

  it("có CẢ HAI khoá ⇒ TAT_CA (ALLOW-wins), KHÔNG rơi xuống THEO_CO_SO", () => {
    // Ca canh lỗi thật: đảo thứ tự hai dòng `if` trong `quyRaCheDo` thì SUPER_ADMIN
    // (giữ cả hai khoá) tụt xuống tầng hẹp hơn và mất giáo viên trong ô chọn — im lặng.
    expect(quyRaCheDo({ toanHe: true, theoCoSo: true })).toBe("TAT_CA");
  });
});
