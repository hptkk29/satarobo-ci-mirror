// @vitest-environment node
/**
 * EL-18 — HÀNH VI của bộ thi hành luật tự động hoá (`onChayLuatTuDong`).
 *
 * Trước đây bộ này chỉ được canh bằng lưới đọc mã. Rà soát đối kháng 24/10/2026 tìm ra hai lỗi mà
 * chỉ test hành vi mới bắt được:
 *
 *  1. NHẬT KÝ đóng dấu cơ sở của LUẬT thay vì cơ sở của NGƯỜI BỊ TÁC ĐỘNG. Luật dùng chung
 *     (`centerId = null`) ⇒ mọi dòng nhật ký có `centerId = NULL` ⇒ vô hình với mọi người cấp cơ sở;
 *     luật của cơ sở này chạy cho người cơ sở kia ⇒ người cơ sở này đọc được hồ sơ đào tạo của người
 *     cơ sở kia. `TrnAutomationLog` được khai là bảng "thuộc cơ sở của người bị tác động".
 *  2. GUI_NHAC dùng khoá chống trùng `elearning_auto:<luật>:<người>` KHÔNG có mốc sự kiện: lần kích
 *     hoạt thứ hai cho cùng (luật, người) bị \`notifyStaff\` nuốt, mà nhật ký vẫn ghi APPLIED "Đã gửi
 *     nhắc" — cỗ máy khai rằng đã làm một việc nó không làm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({
  luat: [] as Record<string, unknown>[],
  ghiDanh: new Map<string, Record<string, unknown>>(),
  nhanVien: new Map<string, Record<string, unknown>>(),
  nhatKy: [] as Record<string, unknown>[],
  taoGhiDanh: vi.fn(async (_a: { data: Record<string, unknown> }) => ({})),
  notify: vi.fn(async (_a: Record<string, unknown>) => 1),
}));

vi.mock("@/lib/db", () => ({
  db: {
    trnAutomationRule: { findMany: async () => h.luat },
    trnEnrollment: {
      findUnique: async (a: { where: { id: string } }) => h.ghiDanh.get(a.where.id) ?? null,
      findFirst: async () => null,
      create: h.taoGhiDanh,
    },
    trnCertificate: { findUnique: async () => null },
    employee: {
      findFirst: async (a: { where: { userAccount: { id: string } } }) =>
        h.nhanVien.get(a.where.userAccount.id) ?? null,
    },
    trnLearningPathStep: { findMany: async () => [] },
    trnAutomationLog: {
      create: async (a: { data: Record<string, unknown> }) => {
        h.nhatKy.push(a.data);
        return a.data;
      },
    },
  },
}));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notify }));
vi.mock("@/lib/auth/hosts", () => ({ elearningHomeUrl: () => "https://e-learning.test" }));
const dangKy = vi.hoisted(() => ({ on: vi.fn() }));
vi.mock("@/lib/events/registry", () => ({ on: dangKy.on }));

import {
  onChayLuatTuDong,
  registerElearningAutomationHandlers,
} from "@/lib/elearning/_handlers/automation-run";

const nguoiCS2 = {
  departmentId: "dep1",
  joinedAt: new Date("2026-01-01T00:00:00Z"),
  centerId: "CS2",
  orgUnitId: "OU-CS2",
};

const sukien = (enrollmentId: string) => ({
  id: `ev-${enrollmentId}`,
  type: "elearning.enrollment.completed",
  payload: { enrollmentId },
});

const luat = (o: Record<string, unknown>) => ({
  id: "luat-1",
  title: "Nhắc sau khi xong khoá",
  action: "GUI_NHAC",
  conditionJson: {},
  actionJson: { tieuDe: "Chúc mừng", noiDung: "Bạn đã xong khoá." },
  dueDays: 30,
  centerId: null,
  orgUnitId: null,
  ...o,
});

beforeEach(() => {
  h.luat = [];
  h.ghiDanh = new Map([
    ["gd-1", { userId: "u1", courseId: "k1", centerId: "CS2", orgUnitId: "OU-CS2" }],
    ["gd-2", { userId: "u1", courseId: "k2", centerId: "CS2", orgUnitId: "OU-CS2" }],
  ]);
  h.nhanVien = new Map([["u1", nguoiCS2]]);
  h.nhatKy = [];
  h.taoGhiDanh.mockClear();
  h.notify.mockClear();
});

describe("🔴 nhật ký mang cơ sở của NGƯỜI BỊ TÁC ĐỘNG, không phải của luật", () => {
  it("luật DÙNG CHUNG (centerId null) ⇒ dòng nhật ký vẫn mang cơ sở của người học", async () => {
    h.luat = [luat({ centerId: null, orgUnitId: null })];
    await onChayLuatTuDong(sukien("gd-1"));
    expect(h.nhatKy).toHaveLength(1);
    expect(h.nhatKy[0]!.centerId).toBe("CS2");
    expect(h.nhatKy[0]!.orgUnitId).toBe("OU-CS2");
  });

  it("luật của CS1 chạy cho người CS2 ⇒ dòng nhật ký thuộc CS2, KHÔNG thuộc CS1", async () => {
    h.luat = [luat({ centerId: "CS1", orgUnitId: "OU-CS1" })];
    await onChayLuatTuDong(sukien("gd-1"));
    expect(h.nhatKy[0]!.centerId).toBe("CS2");
    expect(h.nhatKy[0]!.centerId).not.toBe("CS1");
  });

  it("dòng KHÔNG KHỚP điều kiện cũng mang cơ sở của người học", async () => {
    h.luat = [luat({ conditionJson: { courseId: "khoa-khac" } })];
    await onChayLuatTuDong(sukien("gd-1"));
    expect(h.nhatKy[0]!.outcome).toBe("SKIPPED");
    expect(h.nhatKy[0]!.centerId).toBe("CS2");
  });

  it("ĐỐI CHỨNG: hành động GIAO_KHOA giao đúng khoá và gắn cơ sở của người học vào ghi danh", async () => {
    h.luat = [luat({ action: "GIAO_KHOA", actionJson: { courseId: "k9" } })];
    await onChayLuatTuDong(sukien("gd-1"));
    expect(h.taoGhiDanh).toHaveBeenCalledTimes(1);
    const d = h.taoGhiDanh.mock.calls[0]![0].data;
    expect(d.courseId).toBe("k9");
    expect(d.centerId).toBe("CS2");
    expect(h.nhatKy[0]!.outcome).toBe("APPLIED");
  });
});

describe("🔴 GUI_NHAC — khoá chống trùng có MỐC sự kiện", () => {
  it("hai sự kiện KHÁC nhau (hai lượt hoàn thành) cho cùng (luật, người) ⇒ hai khoá thông báo KHÁC nhau", async () => {
    h.luat = [luat({})];
    await onChayLuatTuDong(sukien("gd-1"));
    await onChayLuatTuDong(sukien("gd-2"));
    const khoa = h.notify.mock.calls.map((c) => c[0]!.dedupeKey as string);
    expect(khoa).toHaveLength(2);
    expect(new Set(khoa).size).toBe(2);
  });

  it("CÙNG một sự kiện chạy lại (hàng đợi thử lại) ⇒ CÙNG khoá — vẫn idempotent", async () => {
    h.luat = [luat({})];
    await onChayLuatTuDong(sukien("gd-1"));
    await onChayLuatTuDong(sukien("gd-1"));
    const khoa = h.notify.mock.calls.map((c) => c[0]!.dedupeKey as string);
    expect(khoa[0]).toBe(khoa[1]);
  });

  it("khoá thông báo giữ tiền tố `elearning_auto:` (catalog nhận diện theo tiền tố)", async () => {
    h.luat = [luat({})];
    await onChayLuatTuDong(sukien("gd-1"));
    expect(String(h.notify.mock.calls[0]![0].dedupeKey)).toMatch(/^elearning_auto:/);
  });
});

describe("không luật nào bật ⇒ cỗ máy không làm gì và không ghi gì", () => {
  it("0 luật ⇒ 0 dòng nhật ký, 0 thông báo, 0 ghi danh", async () => {
    h.luat = [];
    await onChayLuatTuDong(sukien("gd-1"));
    expect(h.nhatKy).toHaveLength(0);
    expect(h.notify).not.toHaveBeenCalled();
    expect(h.taoGhiDanh).not.toHaveBeenCalled();
  });
});

describe("🔴 đăng ký handler: BỐN loại sự kiện, viết THẲNG từng `on(\"…\")`", () => {
  it("đăng ký đúng bốn sự kiện kích hoạt, mỗi loại một lần", () => {
    dangKy.on.mockClear();
    registerElearningAutomationHandlers();
    const loai = dangKy.on.mock.calls.map((c) => c[0] as string).sort();
    expect(loai).toEqual([
      "elearning.certificate.expired",
      "elearning.employee.new",
      "elearning.enrollment.completed",
      "elearning.requirement.applied",
    ]);
  });

  it("nguồn viết literal từng `on(\"loại\", …)` — lưới `khop-phat-nghe` quét chuỗi literal, vòng lặp trên Object.keys làm nó mù", () => {
    const src = readFileSync(join(process.cwd(), "lib/elearning/_handlers/automation-run.ts"), "utf8");
    for (const t of [
      "elearning.certificate.expired",
      "elearning.employee.new",
      "elearning.enrollment.completed",
      "elearning.requirement.applied",
    ]) {
      expect(src, t).toContain(`on("${t}", onChayLuatTuDong)`);
    }
  });
});
