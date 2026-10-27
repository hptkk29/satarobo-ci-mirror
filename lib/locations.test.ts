/**
 * Bất biến của danh sách cơ sở TĨNH dùng cho site công khai.
 *
 * Vì sao khoá bằng test: form `/lien-he` quy NHÃN cơ sở khách chọn về `code` rồi
 * gửi lên `/api/leads` (`CENTER_CODE_BY_LABEL`). Bản đồ đó khoá theo NHÃN, nên
 * hai cơ sở ra cùng một nhãn là một cơ sở vĩnh viễn không chọn tới được — và
 * lead sẽ rơi vào nhánh "hệ thống tự chia cơ sở" thay vì về đúng nơi khách chọn.
 * Không có gì nổ, không log nào báo.
 */
import { describe, it, expect } from "vitest";
import { operationalLocations, OPENING_HOURS_SCHEMA } from "./locations";

const centerLabel = (name: string, address: string) =>
  `${name.split(" - ")[0] ?? name} - ${address}`;

describe("cơ sở vận hành (danh sách tĩnh cho site công khai)", () => {
  const ds = operationalLocations();

  it("có ít nhất một cơ sở", () => {
    expect(ds.length).toBeGreaterThan(0);
  });

  it("mọi cơ sở đều có mã", () => {
    for (const c of ds) expect(c.code.trim()).not.toBe("");
  });

  it("mã KHÔNG trùng nhau", () => {
    expect(new Set(ds.map((c) => c.code)).size).toBe(ds.length);
  });

  it("NHÃN hiển thị không trùng nhau — nhãn là khoá của bản đồ nhãn→mã", () => {
    // Đây là bất biến thật sự quan trọng: trùng nhãn = mất một cơ sở khỏi ô chọn.
    const nhan = ds.map((c) => centerLabel(c.name, c.address));
    expect(new Set(nhan).size).toBe(nhan.length);
  });

  it("nhãn giữ được tiền tố 'Cơ sở N' để phụ huynh phân biệt", () => {
    // Bản trước cắt sai làm ô chỉ hiện địa chỉ, phụ huynh không biết đâu là cơ sở nào.
    for (const c of ds) {
      expect(centerLabel(c.name, c.address)).toContain(c.name.split(" - ")[0]);
    }
  });
});

/**
 * Giờ mở cửa: bản cho NGƯỜI ĐỌC và bản cho MÁY ĐỌC phải nói cùng một điều.
 *
 * Trước 21/09/2026 hai bản lệch nhau ở CẢ HAI đầu: `/lien-he` in "T2 - T7: 8:00 - 20:00"
 * ngay phía trên, trong khi JSON-LD của chính trang đó phát `'Mo-Su 08:00-21:00'` — thừa
 * Chủ nhật và thừa một tiếng. Không ai thấy, vì một bản chỉ máy đọc.
 */
describe("giờ mở cửa — bản chữ và bản schema.org", () => {
  const THU: Record<string, string> = {
    T2: "Mo", T3: "Tu", T4: "We", T5: "Th", T6: "Fr", T7: "Sa", CN: "Su",
  };

  it("[GIO-01] OPENING_HOURS_SCHEMA suy ra đúng từ workingHours của cơ sở", () => {
    for (const c of operationalLocations()) {
      // "T2 - T7: 8:00 - 20:00" → ["T2","T7","8","00","20","00"]
      const m = c.workingHours.match(
        /^(T\d|CN)\s*-\s*(T\d|CN):\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/,
      );
      expect(m, `không đọc được workingHours của ${c.code}: "${c.workingHours}"`).not.toBeNull();
      if (!m) continue;
      const [, tuThu, denThu, gioMo, phutMo, gioDong, phutDong] = m;
      const mong =
        `${THU[tuThu!]}-${THU[denThu!]} ` +
        `${gioMo!.padStart(2, "0")}:${phutMo}-${gioDong!.padStart(2, "0")}:${phutDong}`;
      expect(OPENING_HOURS_SCHEMA, `lệch với ${c.code}`).toBe(mong);
    }
  });

  it("[GIO-02] KHÔNG khai mở cửa Chủ nhật — cơ sở nghỉ CN", () => {
    expect(OPENING_HOURS_SCHEMA).not.toContain("Su");
  });
});
