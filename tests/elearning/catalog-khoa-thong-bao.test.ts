// @vitest-environment node
/**
 * Mọi khoá thông báo mà khu E-learning phát qua `notifyStaff` phải được KHAI trong
 * `lib/notifications/catalog.ts`.
 *
 * Khoá không khai thì `classifyNotification` rơi về giá trị tự do (`known = false`): thông báo vẫn đến
 * nhưng sai nhóm / sai mức ưu tiên, và màn cấu hình thông báo đẩy KHÔNG liệt kê nó nên không ai bật /
 * tắt được. Đã xảy ra với `el.nhac:` / `el.cham-tre:` (khai bù 23/10) và `elearning_auto:` (EL-18).
 */
import { describe, expect, it } from "vitest";
import { catalogEntries, classifyNotification } from "@/lib/notifications/catalog";

/** Ví dụ khoá thật cho từng nguồn thông báo của khu — dựng đúng như mã phát. */
const KHOA_PHAT = [
  ["EL-06 giao khoá", "el.enr:enr1"],
  ["EL-06 quá hạn", "el.over:enr1"],
  ["EL-06 hoàn thành", "el.done:enr1"],
  ["EL-06 nhắc theo mốc", "el.nhac:enr1:T_MINUS_1D"],
  ["EL-15d nhắc người chấm", "el.cham-tre:2026-10-24"],
  ["EL-16 chứng nhận sắp hết hạn", "elearning_cert_expiry:cert1:T_MINUS_30D"],
  ["EL-18 nhắc của luật tự động hoá", "elearning_auto:luat1:u1:enr1"],
] as const;

describe("khoá thông báo E-learning đều đã khai trong catalog", () => {
  for (const [nguon, khoa] of KHOA_PHAT) {
    it(`${nguon} (${khoa}) ⇒ known`, () => {
      expect(classifyNotification(khoa).known, `chưa khai tiền tố cho ${khoa}`).toBe(true);
    });
  }

  it("ĐỐI CHỨNG ÂM: một khoá lạ thật sự KHÔNG known (phép đo có răng)", () => {
    expect(classifyNotification("elearning_khong_ton_tai:x").known).toBe(false);
  });

  it("mọi mục e-learning trong catalog có NHÃN (màn cấu hình thông báo đẩy hiện nhãn, không hiện khoá thô)", () => {
    const eL = catalogEntries().filter(
      (e) => e.prefix.startsWith("el.") || e.prefix.startsWith("elearning_"),
    );
    expect(eL.length).toBeGreaterThanOrEqual(KHOA_PHAT.length);
    for (const e of eL) expect(e.label?.trim(), e.prefix).toBeTruthy();
  });
});
