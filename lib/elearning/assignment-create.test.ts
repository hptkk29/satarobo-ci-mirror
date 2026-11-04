// @vitest-environment node
/**
 * EL-05 — action tạo lượt giao, chạy qua `runAction` thật với cấu hình thật.
 *
 * Case quan trọng nhất là case đầu của nhóm "luật 6": người thiếu `centerId`
 * KHÔNG chặn cả lượt giao. Đọc nhanh phần `fail("MISSING_CENTER", …)` của kế
 * hoạch rất dễ hiểu thành "chặn", nhưng dòng Test của chính mục đó nói ngược lại:
 * *0 dòng cho người đó, thông báo có TÊN người đó, những người còn lại vẫn được
 * giao đủ*. Chặn cả lượt là tê liệt — prod chỉ 4/15 người có cơ sở.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
  employees: [] as unknown[],
  users: [] as unknown[],
  center: { id: "c-ho" } as unknown,
  lesson: null as unknown,
  courses: [] as unknown[],
  taoAssignment: vi.fn(async (_a: unknown) => ({ id: "a1" })),
  createMany: vi.fn(async (_a: { data: unknown[] }) => ({ count: 0 })),
  publish: vi.fn(async () => null),
  enrollmentIds: [] as string[],
  orgForCenter: vi.fn(async (cid: string) => (cid === "cs-mo-coi" ? null : `ou-${cid}`)),
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/events/publish", () => ({ publishEvent: h.publish }));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: h.orgForCenter }));

const fakeTx = {
  trnAssignment: { create: h.taoAssignment },
  trnEnrollment: {
    createMany: h.createMany,
    // `phatSuKienGhiDanhMoi` tra lại id sau `createMany` (Prisma không trả id).
    findMany: vi.fn(async () => h.enrollmentIds.map((id) => ({ id }))),
  },
};

vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    employee: {
      findMany: vi.fn(async (a: { distinct?: unknown }) => (a.distinct ? [] : h.employees)),
    },
    user: { findMany: vi.fn(async () => h.users) },
    center: { findFirst: vi.fn(async () => h.center) },
    trnLesson: { findFirst: vi.fn(async () => h.lesson) },
    trnCourse: { findMany: vi.fn(async () => h.courses) },
    trnEnrollment: { findMany: vi.fn(async () => []) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
  }),
}));

import { runAction } from "@/lib/actions/factory";
import { cauHinhTaoLuotGiao } from "@/lib/elearning/assignment-create";

const ACTOR = {
  userId: "u-dt",
  isSuperAdmin: false,
  isHoLevel: true,
  orgRoles: [],
  permissions: [],
  visibleCenterIds: [],
  visibleOrgUnitIds: [],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
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

const CO_BAN = {
  contentType: "COURSE" as const,
  contentId: "c1",
  title: "An toàn lao động",
  luat: [{ centerId: ["cs1"] }],
};

const chay = (input: Record<string, unknown>, reason?: string) =>
  runAction(cauHinhTaoLuotGiao, ACTOR, { ...CO_BAN, ...input }, {
    actorName: "Đào tạo",
    reason,
  });

beforeEach(() => {
  h.employees = [nv("1")];
  h.users = [];
  h.center = { id: "c-ho" };
  h.lesson = null;
  h.courses = [];
  h.can.mockReturnValue(true);
  h.taoAssignment.mockClear();
  h.createMany.mockClear();
  h.publish.mockClear();
});

const hangDaGhi = () =>
  (h.createMany.mock.calls[0]?.[0]?.data ?? []) as Record<string, unknown>[];

describe("luật 6 — thiếu cơ sở KHÔNG chặn cả lượt giao", () => {
  it("người thiếu cơ sở bị bỏ qua, người còn lại VẪN được giao đủ", async () => {
    h.employees = [nv("1"), nv("2", { centerId: null }), nv("3")];
    const { res } = await chay({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.soGhiDanh).toBe(2);
    expect(hangDaGhi()).toHaveLength(2);
  });

  it("thông báo nêu ĐÍCH DANH người bị bỏ qua", async () => {
    h.employees = [nv("1"), nv("2", { centerId: null, fullName: "Lê Văn C" })];
    const { res } = await chay({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.thieuCoSo).toEqual([{ fullName: "Lê Văn C", employeeCode: "NV2" }]);
  });

  it("KHÔNG ghi dòng nào có `centerId` null", async () => {
    // Ghi dòng NULL là biến "chưa biết cơ sở" thành một bản ghi tàng hình với
    // mọi người cấp cơ sở — không ai thấy để sửa.
    h.employees = [nv("1", { centerId: null })];
    await chay({ audienceMode: "DYNAMIC" });
    expect(hangDaGhi().every((r) => r.centerId)).toBe(true);
  });
});

describe("hai cột hạn và ngoại lệ nộp trễ", () => {
  it("`dueAt` null KHÔNG biến thành 1970-01-01", async () => {
    // `z.coerce.date()` nuốt `null` thành mốc epoch — một hạn chót đã quá hạn 56
    // năm, và mọi người nhận bài đều lập tức "quá hạn".
    const { res } = await chay({ dueAt: null });
    expect(res.ok).toBe(true);
    expect(hangDaGhi()[0]?.dueAt).toBeNull();
  });

  it("hai cột hạn ghi cùng giá trị lúc tạo", async () => {
    await chay({ dueAt: "2026-09-01T10:00:00.000Z" });
    const r = hangDaGhi()[0];
    expect(r?.dueAt).toEqual(r?.dueAtOriginal);
  });

  it("bài BẮT BUỘC + cho nộp trễ mà KHÔNG có lý do ⇒ từ chối", async () => {
    const { res } = await chay({ isMandatory: true, allowLate: true });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe("reason");
  });

  it("có lý do thì cho qua, và lý do vào sổ audit", async () => {
    const { res } = await chay({ isMandatory: true, allowLate: true }, "Đợt đầu, nới hạn");
    expect(res.ok).toBe(true);
    expect(JSON.stringify(h.audit.mock.calls)).toContain("Đợt đầu");
  });
});

describe("QĐ-CDA-08 — chỉ hai kênh, chặn ngay ở tầng nhập", () => {
  it("kênh thứ ba (ZALO) bị từ chối", async () => {
    const { res } = await chay({ notifyChannels: ["IN_APP", "ZALO"] });
    expect(res.ok).toBe(false);
  });

  it("IN_APP + EMAIL thì hợp lệ", async () => {
    const { res } = await chay({ notifyChannels: ["IN_APP", "EMAIL"] });
    expect(res.ok).toBe(true);
  });
});

describe("nở nội dung theo cấp", () => {
  it("LESSON nở về khoá chứa bài", async () => {
    h.lesson = { module: { courseId: "khoa-cua-bai" } };
    await chay({ contentType: "LESSON", contentId: "bai-1" });
    expect(hangDaGhi()[0]?.courseId).toBe("khoa-cua-bai");
  });

  it("PATH nở thành các khoá thành viên", async () => {
    h.courses = [{ id: "k1" }, { id: "k2" }];
    await chay({ contentType: "PATH", contentId: "lo-trinh" });
    expect(hangDaGhi().map((r) => r.courseId)).toEqual(["k1", "k2"]);
  });

  it("nội dung không nở ra khoá nào ⇒ từ chối, không tạo lượt giao rỗng", async () => {
    h.lesson = null;
    const { res } = await chay({ contentType: "LESSON", contentId: "khong-co" });
    expect(res.ok).toBe(false);
    expect(h.taoAssignment).not.toHaveBeenCalled();
  });
});

describe("tập rỗng: TĨNH chặn, ĐỘNG cho qua", () => {
  it("lượt TĨNH không ai khớp ⇒ từ chối (gần như luôn là luật gõ sai)", async () => {
    h.employees = [];
    const { res } = await chay({ audienceMode: "STATIC" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("EMPTY_AUDIENCE");
  });

  it("lượt ĐỘNG tập rỗng hôm nay là bình thường ⇒ vẫn tạo", async () => {
    // Người mới vào sẽ rơi vào đêm sau. Chặn ở đây là bắt Đào tạo phải đợi có
    // người khớp mới lập được luật.
    h.employees = [];
    const { res } = await chay({ audienceMode: "DYNAMIC" });
    expect(res.ok).toBe(true);
  });
});

describe("`orgUnitId` lấy theo cơ sở của NGƯỜI HỌC", () => {
  it("người CS2 nhận dòng mang đơn vị của CS2, không của lượt giao", async () => {
    // Lượt giao neo Hội sở, nhưng hồ sơ học phải nằm đúng đơn vị của người học —
    // nếu không quản lý CS2 không thấy nhân sự của mình.
    h.employees = [nv("1", { centerId: "cs2" })];
    await chay({});
    expect(hangDaGhi()[0]?.orgUnitId).toBe("ou-cs2");
  });

  it("cơ sở chưa gắn đơn vị ⇒ LOẠI dòng đó, không lấy đơn vị lượt giao thay", async () => {
    // Điền đại là xếp hồ sơ học của người này vào nhầm đơn vị — và `orgUnitId`
    // chính là cột quyết định ai nhìn thấy.
    h.employees = [nv("1", { centerId: "cs-mo-coi" }), nv("2")];
    const { res } = await chay({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(hangDaGhi()).toHaveLength(1);
    expect(res.data.coSoChuaCoDonVi).toEqual(["cs-mo-coi"]);
  });
});

describe("sự kiện đi TRONG giao dịch", () => {
  it("có phát `elearning.assignment.created` kèm khoá chống trùng", async () => {
    await chay({});
    expect(h.publish).toHaveBeenCalled();
    const [ten, , opts] = h.publish.mock.calls[0] as unknown as [
      string,
      unknown,
      { dedupeKey?: string },
    ];
    expect(ten).toBe("elearning.assignment.created");
    expect(opts.dedupeKey).toContain("a1");
  });
});

describe("gác quyền", () => {
  it("thiếu `elearning:assignment:create` ⇒ từ chối và KHÔNG ghi gì", async () => {
    h.can.mockReturnValue(false);
    const { res } = await chay({});
    expect(res.ok).toBe(false);
    expect(h.taoAssignment).not.toHaveBeenCalled();
  });
});
