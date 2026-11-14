// @vitest-environment node
// [SPL] Nhãn buổi ở ô «Buổi học» khi giao bài (12/11/2026): «Buổi N · tên bài», KHÔNG phải ngày.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveSessionPickerLabel } from "./session-project-name";

describe("[SPL] deriveSessionPickerLabel", () => {
  it("[SPL-01] có số buổi theo lộ trình + tên bài ⇒ «Buổi 5 · Tên bài» (planOrder 0-based ⇒ +1)", () => {
    expect(deriveSessionPickerLabel({ planOrder: 4, lessonTitle: "Dò line chuyên sâu (PID)" })).toBe("Buổi 5 · Dò line chuyên sâu (PID)");
  });

  it("[SPL-02] KHÔNG chứa ngày (dd-mm) và KHÔNG chứa mã học phần dù tên bài mang tiền tố «HP2 - »", () => {
    const nhan = deriveSessionPickerLabel({ planOrder: 4, lessonTitle: "HP2 - Dự án cuối học phần", moduleCode: "HP2" });
    expect(nhan).not.toMatch(/\d{1,2}[-/]\d{1,2}/);
    expect(nhan).not.toMatch(/HP\d/);
    expect(nhan).toBe("Buổi 5 · Dự án cuối học phần");
  });

  it("[SPL-03] không có giáo án: dùng hạng theo ngày (sessionNumber) làm nấc cuối, và chủ đề nhập tay làm tên", () => {
    expect(deriveSessionPickerLabel({ sessionNumber: 7, topic: "Demo cuối học phần" })).toBe("Buổi 7 · Demo cuối học phần");
  });

  it("[SPL-04] thiếu số ⇒ chỉ tên; thiếu cả hai ⇒ chuỗi rỗng (caller tự đặt «Buổi học»)", () => {
    expect(deriveSessionPickerLabel({ topic: "Chủ đề" })).toBe("Chủ đề");
    expect(deriveSessionPickerLabel({ sessionNumber: 3 })).toBe("Buổi 3");
    expect(deriveSessionPickerLabel({})).toBe("");
  });

  it("[SPL-05] dây nối: loader giao bài dùng nhãn này, không còn format ngày", () => {
    const s = readFileSync("app/(teacher)/teacher/cham-bai/_data.ts", "utf8");
    expect(s).toContain("deriveSessionPickerLabel(");
    expect(s).not.toContain("sessionFmt");
  });
});
