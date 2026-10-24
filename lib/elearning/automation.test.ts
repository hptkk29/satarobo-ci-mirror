// @vitest-environment node
/**
 * EL-18 — cỗ máy tự động hoá.
 *
 * Bộ này canh ba thứ, và cả ba là quyết định đã ký chứ không phải sở thích:
 *  · KHÔNG có hành động chế tài (QĐ-CDA-06);
 *  · điều kiện có CẤU TRÚC, không phải biểu thức tự do;
 *  · mọi lần xét trả về một câu tiếng Việt nói VÌ SAO — đây là thứ phân biệt một cỗ
 *    máy luật với một mô hình đoán.
 */
import { describe, it, expect } from "vitest";
import {
  HANH_DONG,
  HANH_DONG_BI_CAM,
  KICH_HOAT,
  khoaChongTrungLuat,
  luatSchema,
  xetLuat,
  type DoiTuong,
} from "@/lib/elearning/automation";

const D = (s: string) => new Date(s);
const NOW = D("2026-06-01T00:00:00Z");

const nguoi = (p: Partial<DoiTuong> = {}): DoiTuong => ({
  userId: "u1",
  departmentId: "dep-a",
  joinedAt: D("2026-05-20T00:00:00Z"),
  courseId: null,
  ...p,
});

describe("🔴 KHÔNG có hành động chế tài — và đó là chủ đích", () => {
  it("enum hành động chỉ có ba giá trị, không giá trị nào mang tính phạt", () => {
    // QĐ-CDA-06: "không leo thang kỷ luật, KHÔNG cờ đỏ hồ sơ nhân sự ở BẤT KỲ giá trị
    // cấu hình nào". Chúng vắng mặt trong enum chứ không bị tắt bằng một cờ — cờ tắt
    // được thì bật được, còn giá trị không có trong enum thì phải qua migration.
    expect([...HANH_DONG]).toEqual(["GIAO_KHOA", "GIAO_LO_TRINH", "GUI_NHAC"]);
    for (const cam of HANH_DONG_BI_CAM) {
      expect(HANH_DONG as readonly string[]).not.toContain(cam);
    }
  });

  it("zod BÁC một hành động ngoài danh sách", () => {
    const r = luatSchema.safeParse({
      code: "L1",
      title: "Thử",
      trigger: "NHAN_SU_MOI",
      action: "GAN_CO_HO_SO",
      conditionJson: { trongVongNgay: 30 },
    });
    expect(r.success).toBe(false);
  });

  it("bốn kích hoạt, không hơn", () => {
    expect(KICH_HOAT).toHaveLength(4);
  });
});

describe("🔴 điều kiện có CẤU TRÚC, không phải biểu thức tự do", () => {
  it("khoá lạ trong điều kiện bị BÁC ngay lúc lưu", () => {
    // `.strict()`: một khoá viết sai chính tả bị bác thay vì lặng lẽ không khớp gì —
    // người vận hành ngồi đợi một luật không bao giờ chạy là cách hỏng tệ hơn nhiều.
    const r = luatSchema.safeParse({
      code: "L1",
      title: "Thử",
      trigger: "NHAN_SU_MOI",
      action: "GUI_NHAC",
      conditionJson: { trongVongNgay: 30, bieuThuc: "user.age > 30" },
      actionJson: { tieuDe: "x", noiDung: "y" },
    });
    expect(r.success).toBe(false);
  });

  it("hành động thiếu tham số của nó thì BÁC", () => {
    // Lưu được nhưng chạy vào hư không thì nhật ký đầy dòng FAILED mà không ai biết
    // vì sao.
    for (const [action, thieu] of [
      ["GIAO_KHOA", {}],
      ["GIAO_LO_TRINH", {}],
      ["GUI_NHAC", { tieuDe: "chỉ có tiêu đề" }],
    ] as const) {
      const r = luatSchema.safeParse({
        code: "L1",
        title: "Thử",
        trigger: "KHOA_HOAN_THANH",
        action,
        actionJson: thieu,
      });
      expect(r.success, action).toBe(false);
    }
  });

  it("kích hoạt 'nhân sự mới' phải khai số ngày", () => {
    const r = luatSchema.safeParse({
      code: "L1",
      title: "Thử",
      trigger: "NHAN_SU_MOI",
      action: "GUI_NHAC",
      actionJson: { tieuDe: "x", noiDung: "y" },
    });
    expect(r.success).toBe(false);
  });
});

describe("xét luật — luôn kèm LÝ DO đọc được", () => {
  const luat = (dk: Record<string, unknown> = {}) => ({
    trigger: "NHAN_SU_MOI",
    conditionJson: { trongVongNgay: 30, ...dk },
  });

  it("trong ngưỡng ⇒ khớp, và nói rõ bao nhiêu ngày", () => {
    const r = xetLuat(luat(), nguoi(), NOW);
    expect(r.khop).toBe(true);
    expect(r.lyDo).toContain("12 ngày");
  });

  it("quá ngưỡng ⇒ không khớp, vẫn nói rõ", () => {
    const r = xetLuat(luat(), nguoi({ joinedAt: D("2026-01-01") }), NOW);
    expect(r.khop).toBe(false);
    expect(r.lyDo).toContain("quá ngưỡng");
  });

  it("🔴 THIẾU ngày vào làm ⇒ nói là thiếu dữ liệu, không nói 'không đủ điều kiện'", () => {
    // Hai câu ấy dẫn tới hai việc khác nhau: một bên là bổ sung hồ sơ, bên kia là
    // không làm gì cả.
    const r = xetLuat(luat(), nguoi({ joinedAt: null }), NOW);
    expect(r.khop).toBe(false);
    expect(r.lyDo).toContain("chưa có ngày vào làm");
  });

  it("ngày vào làm ở TƯƠNG LAI ⇒ chưa xét", () => {
    const r = xetLuat(luat(), nguoi({ joinedAt: D("2026-12-01") }), NOW);
    expect(r.khop).toBe(false);
    expect(r.lyDo).toContain("tương lai");
  });

  it("lọc phòng ban áp cho MỌI kích hoạt", () => {
    const r = xetLuat(
      { trigger: "KHOA_HOAN_THANH", conditionJson: { departmentId: "dep-b" } },
      nguoi(),
      NOW,
    );
    expect(r.khop).toBe(false);
    expect(r.lyDo).toContain("phòng ban");
  });

  it("KHOA_HOAN_THANH lọc đúng khoá luật chờ", () => {
    expect(
      xetLuat(
        { trigger: "KHOA_HOAN_THANH", conditionJson: { courseId: "k1" } },
        nguoi({ courseId: "k2" }),
        NOW,
      ).khop,
    ).toBe(false);
    expect(
      xetLuat(
        { trigger: "KHOA_HOAN_THANH", conditionJson: { courseId: "k1" } },
        nguoi({ courseId: "k1" }),
        NOW,
      ).khop,
    ).toBe(true);
  });

  it("🔴 kích hoạt LẠ không bị coi là 'không khớp' im lặng", () => {
    // Thêm một giá trị vào enum mà quên viết luật xét thì nó phải nổi lên, không lặng
    // lẽ thành một luật chết.
    const r = xetLuat({ trigger: "KICH_HOAT_MOI", conditionJson: {} }, nguoi(), NOW);
    expect(r.khop).toBe(false);
    expect(r.lyDo).toContain("chưa có luật xét");
  });
});

describe("🔴 khoá chống trùng gắn với MỐC NGHIỆP VỤ", () => {
  it("cùng luật + cùng người + cùng mốc ⇒ cùng khoá", () => {
    const a = khoaChongTrungLuat({ ruleId: "r1", userId: "u1", moc: "e1" });
    const b = khoaChongTrungLuat({ ruleId: "r1", userId: "u1", moc: "e1" });
    expect(a).toBe(b);
  });

  it("mốc KHÁC ⇒ khoá khác — luật chạy lại được cho việc mới", () => {
    // Dùng `<ruleId>:<userId>` trần thì một luật "khoá hoàn thành → giao khoá kế" chỉ
    // chạy được đúng MỘT LẦN trong đời người đó, kể cả cho những khoá khác.
    expect(khoaChongTrungLuat({ ruleId: "r1", userId: "u1", moc: "e1" })).not.toBe(
      khoaChongTrungLuat({ ruleId: "r1", userId: "u1", moc: "e2" }),
    );
  });

  it("KHÔNG chứa thời gian — nếu không thì không chống được gì", () => {
    const k = khoaChongTrungLuat({ ruleId: "r1", userId: "u1", moc: "e1" });
    expect(k).toBe("r1:u1:e1");
    expect(k).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
