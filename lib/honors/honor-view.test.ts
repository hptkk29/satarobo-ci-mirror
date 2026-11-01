import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { computeYears } from "./honor-view";

const GOC = join(__dirname, "..", "..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");

/** 08/09/2026 12:00 giờ VN — mốc "bây giờ" cố định để test không phụ thuộc ngày chạy. */
const BAY_GIO = new Date("2026-09-08T05:00:00Z");

describe("computeYears — số năm gắn bó", () => {
  // ⚠️ CA SINH RA BẢN VÁ: 13 hồ sơ trên prod mang joinedAt = 1970-01-01 (NULL bị ghi
  // thành 0). Bản cũ trả ~57 và con số đó đi thẳng lên trang công khai /vinh-danh.
  it("mốc Unix 1970 → null, KHÔNG phải 57", () => {
    expect(computeYears(new Date("1970-01-01T00:00:00Z"), BAY_GIO)).toBeNull();
  });

  it("thiếu dữ liệu → null, KHÔNG phải 0", () => {
    // Số 0 trông như một sự thật ("vào làm chưa tới một năm"); ô trống thì không giả vờ biết.
    expect(computeYears(null, BAY_GIO)).toBeNull();
    expect(computeYears(undefined, BAY_GIO)).toBeNull();
    expect(computeYears(new Date("không phải ngày"), BAY_GIO)).toBeNull();
  });

  it("ngày vào làm ở TƯƠNG LAI → null, không đoán", () => {
    expect(computeYears(new Date("2027-01-01T00:00:00Z"), BAY_GIO)).toBeNull();
  });

  // ⚠️ Bản cũ chia "30 ngày = 1 tháng" ⇒ một "năm" chỉ dài 360 ngày, thổi phồng ~1,4%.
  // Ba ca dưới là chỗ sai lệch lộ ra.
  it("đếm bằng LỊCH: chưa tới ngày kỷ niệm thì CHƯA cộng năm", () => {
    // Vào làm 09/09/2024 → tới 08/09/2026 mới được 1 năm 364 ngày ⇒ 1, không phải 2.
    expect(computeYears(new Date("2024-09-09T00:00:00Z"), BAY_GIO)).toBe(1);
    // Đúng ngày kỷ niệm ⇒ tròn 2.
    expect(computeYears(new Date("2024-09-08T00:00:00Z"), BAY_GIO)).toBe(2);
  });

  it("mốc dài: 10 năm lịch KHÔNG bị làm tròn thành 10 năm rưỡi", () => {
    // Bản cũ: 3653 ngày / 30 / 12 = 10,14 → 10 (may mắn đúng), nhưng ở 5 năm thì
    // 1826/30/12 = 5,07 → 5; sai lệch tích luỹ chỉ lộ ở rìa ngày kỷ niệm — xem ca trên.
    expect(computeYears(new Date("2016-09-08T00:00:00Z"), BAY_GIO)).toBe(10);
    expect(computeYears(new Date("2016-09-09T00:00:00Z"), BAY_GIO)).toBe(9);
  });

  it("vào làm hôm nay → 0 (đó là sự thật, khác với KHÔNG BIẾT)", () => {
    expect(computeYears(new Date("2026-09-08T00:00:00Z"), BAY_GIO)).toBe(0);
  });
});

describe("không nơi nào tin mốc 1970", () => {
  it("honor-view đi qua cổng ngayVaoLamHopLe", () => {
    const src = doc("lib/honors/honor-view.ts");
    expect(src).toContain("ngayVaoLamHopLe(joinedAt)");
    // Phép chia "30 ngày = 1 tháng" phải biến mất hẳn.
    expect(src).not.toContain("24 * 30");
  });

  it("hồ sơ giáo viên cũng đi qua cổng đó", () => {
    const src = doc("app/(teacher)/teacher/ho-so/page.tsx");
    expect(src).toContain("ngayVaoLamHopLe(user.employee?.joinedAt)");
  });

  it("nơi hiển thị ẨN dòng khi không có số — không in '0 năm'", () => {
    for (const f of [
      "app/(public)/vinh-danh/[slug]/page.tsx",
      "components/honors/spotlight.tsx",
    ]) {
      expect(doc(f), `${f} phải kiểm cả null lẫn > 0`).toContain(
        "view.years != null && view.years > 0",
      );
    }
  });
});
