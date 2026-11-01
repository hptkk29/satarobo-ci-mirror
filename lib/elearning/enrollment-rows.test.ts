// @vitest-environment node
/**
 * EL-05 — dựng hàng `TrnEnrollment`.
 *
 * Hai thứ ở đây sai thì SAI VĨNH VIỄN, không sửa lại được bằng một lần chạy sau:
 * hạn chót và ảnh chụp tổ chức. Nên test bám đúng hai thứ đó.
 */
import { describe, it, expect } from "vitest";
import { dungHangGhiDanh } from "@/lib/elearning/enrollment-rows";
import type { NguoiTrongTap } from "@/lib/elearning/audience";

const NOW = new Date("2026-08-23T00:00:00.000Z");

const nguoi = (o: Partial<NguoiTrongTap> = {}): NguoiTrongTap => ({
  employeeId: "e1",
  userId: "u1",
  employeeCode: "NV1",
  fullName: "Người 1",
  jobTitle: "Giáo viên",
  centerId: "cs1",
  orgUnitId: "ou1",
  departmentId: "d1",
  managerId: null,
  joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...o,
});

const chay = (o: Partial<Parameters<typeof dungHangGhiDanh>[0]> = {}) =>
  dungHangGhiDanh({
    nguoi: [nguoi()],
    courseIds: ["c1"],
    assignmentId: "a1",
    han: { dueAt: null, dueRelativeDays: null, dueAnchor: "ASSIGNED_AT" },
    now: NOW,
    ...o,
  });

describe("hai cột hạn — `dueAtOriginal` là cột BẤT BIẾN", () => {
  it("lúc tạo, hai cột mang CÙNG giá trị", () => {
    const han = new Date("2026-09-01T10:00:00.000Z");
    const r = chay({ han: { dueAt: han, dueRelativeDays: null, dueAnchor: "ASSIGNED_AT" } });
    expect(r.rows[0]?.dueAt).toEqual(han);
    expect(r.rows[0]?.dueAtOriginal).toEqual(han);
  });

  it("không đặt hạn ⇒ cả hai cột `null`, không tự bịa hạn", () => {
    // Tự gán một hạn mặc định là biến bài tự chọn thành bài có hạn, và người học
    // bị tính quá hạn cho một mốc chưa ai quyết.
    const r = chay();
    expect(r.rows[0]?.dueAt).toBeNull();
    expect(r.rows[0]?.dueAtOriginal).toBeNull();
  });
});

describe("hạn tương đối", () => {
  it("mốc `ASSIGNED_AT`: cộng từ ngày giao", () => {
    const r = chay({
      han: { dueAt: null, dueRelativeDays: 7, dueAnchor: "ASSIGNED_AT" },
    });
    expect(r.rows[0]?.dueAt?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });

  it("mốc `JOINED_AT`: cộng từ ngày vào làm của TỪNG người", () => {
    // Đây là kiểu hạn dành cho khoá nhập môn: mỗi người có 30 ngày kể từ ngày
    // vào làm của chính họ, không phải kể từ ngày ai đó bấm giao.
    const r = chay({
      nguoi: [
        nguoi({ userId: "u1", joinedAt: new Date("2026-01-01T00:00:00.000Z") }),
        nguoi({ employeeId: "e2", userId: "u2", joinedAt: new Date("2026-06-01T00:00:00.000Z") }),
      ],
      han: { dueAt: null, dueRelativeDays: 30, dueAnchor: "JOINED_AT" },
    });
    expect(r.rows[0]?.dueAt?.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(r.rows[1]?.dueAt?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("hạn tuyệt đối THẮNG hạn tương đối", () => {
    const han = new Date("2026-09-09T00:00:00.000Z");
    const r = chay({ han: { dueAt: han, dueRelativeDays: 7, dueAnchor: "ASSIGNED_AT" } });
    expect(r.rows[0]?.dueAt).toEqual(han);
  });

  it("mốc `JOINED_AT` mà thiếu ngày vào làm ⇒ TÁCH RA, không đoán", () => {
    // Lấy đại ngày giao thay thế là âm thầm cho người này một hạn khác hẳn ý
    // người giao — và không ai biết cho tới khi họ bị tính quá hạn.
    const r = chay({
      nguoi: [nguoi({ joinedAt: null })],
      han: { dueAt: null, dueRelativeDays: 30, dueAnchor: "JOINED_AT" },
    });
    expect(r.rows).toHaveLength(0);
    expect(r.khongTinhDuocHan.map((x) => x.employeeCode)).toEqual(["NV1"]);
  });
});

describe("ảnh chụp tổ chức — ghi một lần, đủ cột", () => {
  it("chụp đơn vị, phòng ban và chức danh tại thời điểm giao", () => {
    const r = chay({ nguoi: [nguoi({ jobTitle: "Trợ giảng", departmentId: "d9" })] });
    expect(r.rows[0]?.snapJobTitle).toBe("Trợ giảng");
    expect(r.rows[0]?.snapDepartmentId).toBe("d9");
    expect(r.rows[0]?.snapOrgUnitId).toBe("ou1");
  });

  it("`snapPositionId` để `null` — bảng `Position` rỗng trên prod", () => {
    expect(chay().rows[0]?.snapPositionId).toBeNull();
  });

  it("quản lý trực tiếp: đổi `Employee.managerId` sang `userId`", () => {
    const r = chay({
      nguoi: [nguoi({ managerId: "e-sep" })],
      managerUserIdTheoEmployeeId: { "e-sep": "u-sep" },
    });
    expect(r.rows[0]?.snapManagerUserId).toBe("u-sep");
  });

  it("không tra được tài khoản quản lý ⇒ `null`, không ghi nhầm `employeeId`", () => {
    // Ghi `employeeId` vào cột `snapManagerUserId` là trộn hai không gian khoá:
    // báo cáo sẽ join hụt và im lặng bỏ người đó khỏi mẫu số.
    const r = chay({ nguoi: [nguoi({ managerId: "e-sep" })] });
    expect(r.rows[0]?.snapManagerUserId).toBeNull();
  });
});

describe("hàng rào lặp lại ở tầng dựng hàng", () => {
  it("thiếu `centerId` hoặc `userId` ⇒ KHÔNG dựng hàng nào", () => {
    // `audience.ts` đã lọc rồi, nhưng hàm này còn chạy từ đường ĐỘNG mỗi đêm —
    // nơi không ai bấm nút và không ai đọc màn xem trước.
    expect(chay({ nguoi: [nguoi({ centerId: null })] }).rows).toHaveLength(0);
    expect(chay({ nguoi: [nguoi({ userId: null })] }).rows).toHaveLength(0);
  });

  it("`centerId` của hàng lấy theo NGƯỜI HỌC, không theo người giao", () => {
    // Cách ly cơ sở của dữ liệu học đứng trên cơ sở của người học. Lấy theo người
    // giao thì lượt học của nhân sự CS2 nằm dưới CS1 và quản lý CS2 không thấy.
    const r = chay({ nguoi: [nguoi({ centerId: "cs2" })] });
    expect(r.rows[0]?.centerId).toBe("cs2");
  });
});

describe("nở nhiều khoá", () => {
  it("mỗi người × mỗi khoá là một hàng", () => {
    const r = chay({
      nguoi: [nguoi({ userId: "u1" }), nguoi({ employeeId: "e2", userId: "u2" })],
      courseIds: ["c1", "c2"],
    });
    expect(r.rows).toHaveLength(4);
  });

  it("chu kỳ tái chứng nhận khai theo từng khoá, mặc định 1", () => {
    const r = chay({ courseIds: ["c1", "c2"], cycleTheoCourseId: { c2: 3 } });
    expect(r.rows.find((x) => x.courseId === "c1")?.cycle).toBe(1);
    expect(r.rows.find((x) => x.courseId === "c2")?.cycle).toBe(3);
  });
});
