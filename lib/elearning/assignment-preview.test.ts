// @vitest-environment node
/**
 * EL-05 — action "xem trước tập người học", chạy qua `runAction` thật.
 *
 * Test này gọi ĐÚNG cấu hình mà máy chủ chạy (`cauHinhXemTruoc`), không phải một
 * bản chép sang test — xem ghi chú đầu `assignment-preview.ts`.
 *
 * Case đáng giá nhất là case cuối: lỗi luật lọc phải ra thông báo NGƯỜI DÙNG SỬA
 * ĐƯỢC, không phải 500. Người giao bài chọn nhầm một chiều rồi nhận "Có lỗi xảy
 * ra" thì họ không có đường nào để tự thoát.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
  employees: [] as unknown[],
  jobTitles: [] as unknown[],
  enrollments: [] as unknown[],
  soLanGoiEmployee: 0,
  truyVanGhiDanh: [] as unknown[],
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    employee: {
      findMany: vi.fn(async (a: { distinct?: unknown; where?: unknown }) => {
        if (a.distinct) return h.jobTitles;
        h.soLanGoiEmployee += 1;
        return h.employees;
      }),
    },
    trnEnrollment: {
      findMany: vi.fn(async (a: unknown) => {
        h.truyVanGhiDanh.push(a);
        return h.enrollments;
      }),
    },
  }),
}));

import { runAction } from "@/lib/actions/factory";
import { cauHinhXemTruoc } from "@/lib/elearning/assignment-preview";

const ACTOR = {
  userId: "u-dt",
  role: "TRAINING",
  roles: ["TRAINING"],
  centerId: null,
  isHoLevel: true,
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  permissions: new Map(),
} as unknown as Parameters<typeof runAction>[1];

const nv = (i: string, o: Record<string, unknown> = {}) => ({
  id: `e${i}`,
  employeeCode: `NV${i}`,
  fullName: `Người ${i}`,
  jobTitle: "Giáo viên",
  centerId: "cs1",
  orgUnitId: "ou1",
  departmentId: "d1",
  managerId: null,
  joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  userAccount: { id: `u${i}` },
  ...o,
});

const chay = (input: unknown) =>
  runAction(cauHinhXemTruoc, ACTOR, input, { actorName: "Đào tạo" });

beforeEach(() => {
  h.employees = [];
  h.jobTitles = [];
  h.enrollments = [];
  h.soLanGoiEmployee = 0;
  h.truyVanGhiDanh = [];
  h.can.mockReturnValue(true);
});

describe("gác quyền", () => {
  it("không có `elearning:assignment:create` ⇒ từ chối", () => {
    h.can.mockReturnValue(false);
    return chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC" }).then(({ res }) => {
      expect(res.ok).toBe(false);
    });
  });
});

describe("luật 5 — trả DANH SÁCH TÊN, không chỉ con số", () => {
  it("kết quả mang đủ tên và mã nhân viên", async () => {
    h.employees = [nv("1"), nv("2")];
    const { res } = await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nhan.map((x) => x.fullName)).toEqual(["Người 1", "Người 2"]);
    expect(res.data.tong).toBe(2);
  });
});

describe("luật 6 — thiếu cơ sở bị tách ra, nêu đích danh", () => {
  it("người `centerId` null không vào nhóm nhận", async () => {
    h.employees = [nv("1"), nv("2", { centerId: null })];
    const { res } = await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.tong).toBe(1);
    expect(res.data.thieuCoSo.map((x) => x.employeeCode)).toEqual(["NV2"]);
  });
});

describe("sổ audit ghi HÌNH DẠNG, không nhân bản danh sách nhân sự", () => {
  it("không có tên người nào lọt vào bản ghi audit", async () => {
    // Sổ audit là nơi ghi AI ĐÃ LÀM GÌ, không phải bản sao thứ hai của dữ liệu
    // nhân sự — nhân bản vào đó là nhân thêm một chỗ phải bảo vệ.
    h.employees = [nv("1", { fullName: "Trần Thị B" })];
    await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC" });
    const ghi = JSON.stringify(h.audit.mock.calls);
    expect(ghi).not.toContain("Trần Thị B");
    expect(ghi).toContain("soNhan");
  });
});

describe("chỉ nạp danh sách chức danh KHI luật cần tới", () => {
  it("luật không lọc chức danh ⇒ không tra `distinct`", async () => {
    h.employees = [nv("1")];
    await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC" });
    expect(h.soLanGoiEmployee).toBe(1);
  });

  it("luật có lọc chức danh ⇒ có tra danh sách có thật", async () => {
    h.jobTitles = [{ jobTitle: "Giáo viên" }];
    h.employees = [nv("1")];
    await chay({ luat: [{ jobTitle: ["giáo viên"] }], mode: "STATIC" });
    expect(h.soLanGoiEmployee).toBe(1);
  });
});

describe("lỗi luật lọc ra thông báo SỬA ĐƯỢC, không phải 500", () => {
  it("luật tự tham chiếu trong lượt giao ĐỘNG ⇒ mã lỗi có nghĩa", async () => {
    const { res } = await chay({
      luat: [{ courseCompleted: { courseId: "c1", da: true } }],
      mode: "DYNAMIC",
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FILTER_SELF_REFERENTIAL");
    expect(res.error.field).toBe("courseCompleted");
  });

  it("chiều lọc chưa có nền ⇒ nói rõ chiều nào", async () => {
    const { res } = await chay({ luat: [{ team: ["x"] }], mode: "STATIC" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("FILTER_NO_DATA_SOURCE");
    expect(res.error.message).toContain("team");
  });
});

describe("[ELP-DACO] người đã có lượt học khoá này được nêu TRƯỚC khi giao", () => {
  it("🔴 có `courseId` và có ghi danh cùng khoá ⇒ `daCoGhiDanh` nêu đích danh (userId + tên + mã); người khác không bị nêu", async () => {
    h.employees = [nv("1"), nv("2")];
    h.enrollments = [{ userId: "u2" }];
    const { res } = await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC", courseId: "k1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.daCoGhiDanh).toEqual([{ userId: "u2", fullName: "Người 2", employeeCode: "NV2" }]);
    expect(res.data.tong).toBe(2); // vẫn nằm trong tập nhận: "bỏ qua" là việc của lượt giao, không đổi con số xem trước
  });

  it("đối chứng: không gửi `courseId` ⇒ rỗng và KHÔNG tra bảng ghi danh", async () => {
    h.employees = [nv("1")];
    h.enrollments = [{ userId: "u1" }];
    const { res } = await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.daCoGhiDanh).toEqual([]);
    expect(h.truyVanGhiDanh).toEqual([]); // không có khoá để so ⇒ không tra bảng ghi danh
  });

  it("🔴 truy vấn ghi danh đúng khoá + đúng chu kỳ mặc định + chỉ những userId trong tập", async () => {
    h.employees = [nv("1"), nv("2")];
    h.enrollments = [];
    await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC", courseId: "k9" });
    expect(h.truyVanGhiDanh).toHaveLength(1);
    expect(h.truyVanGhiDanh[0]).toMatchObject({ where: { courseId: "k9", cycle: 1, userId: { in: ["u1", "u2"] } } });
  });

  it("🔴 người đã bị loại trừ nhưng có thể được chọn lại trên danh sách vẫn được tính vào 'đã có lượt' (không để nút đếm sai khi họ được chọn lại)", async () => {
    h.employees = [nv("1"), nv("2")];
    h.enrollments = [{ userId: "u2" }];
    const { res } = await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC", courseId: "k1", loaiTruUserId: ["u2"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.nhan.map((x) => x.userId)).toEqual(["u1"]);
    expect(res.data.biLoaiTru.map((x) => x.userId)).toEqual(["u2"]);
    expect(res.data.daCoGhiDanh.map((x) => x.userId)).toEqual(["u2"]);
  });

  it("ghi ĐẾM (không tên) vào audit, không nhân bản tên người", async () => {
    h.employees = [nv("1")];
    h.enrollments = [{ userId: "u1" }];
    await chay({ luat: [{ centerId: ["cs1"] }], mode: "STATIC", courseId: "k1" });
    const lanGhi = JSON.stringify(h.audit.mock.calls);
    expect(lanGhi).toContain("soDaCoGhiDanh");
    expect(lanGhi).not.toContain("Người 1");
  });
});
