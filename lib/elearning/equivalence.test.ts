// @vitest-environment node
/**
 * EL-09 — công nhận tương đương + điểm danh buổi trực tiếp.
 *
 * Bốn luật thi hành của C8 không lane nào được diễn giải khác, và ba trong bốn
 * cái đó là về NGÀY THÁNG — thứ sai thì sai vĩnh viễn vì hạn tái chứng nhận tính
 * từ nó.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  can: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
  khoa: { id: "k1", title: "An toàn" } as unknown,
  nhanSu: {
    centerId: "cs1",
    orgUnitId: "ou1",
    fullName: "Lê Văn C",
    employeeCode: "NV9",
  } as unknown,
  daCo: null as unknown,
  bai: { id: "b1", kind: "LIVE_SESSION", title: "Buổi 1" } as unknown,
  ghiDanh: { id: "en1", userId: "u-hv" } as unknown,
  taoEq: vi.fn(async (_a: { data: Record<string, unknown> }) => ({ id: "eq1" })),
  taoEn: vi.fn(async (_a: { data: Record<string, unknown> }) => ({ id: "en1" })),
  upsertTienDo: vi.fn(
    async (_a: { where: unknown; update: Record<string, unknown>; create: Record<string, unknown> }) => ({}),
  ),
  orgForCenter: vi.fn(async () => "ou1"),
}));

vi.mock("@/lib/auth/can", () => ({ can: h.can }));
vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: h.audit }));
vi.mock("@/lib/org/org-service", () => ({ orgUnitIdForCenter: h.orgForCenter }));

const tx = {
  trnEquivalence: { create: h.taoEq },
  trnEnrollment: { create: h.taoEn },
};

vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    trnCourse: { findFirst: vi.fn(async () => h.khoa) },
    employee: { findFirst: vi.fn(async () => h.nhanSu) },
    trnEquivalence: { findFirst: vi.fn(async () => h.daCo) },
    trnLesson: { findFirst: vi.fn(async () => h.bai) },
    trnEnrollment: { findFirst: vi.fn(async () => h.ghiDanh) },
    trnLessonProgress: { upsert: h.upsertTienDo },
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  }),
}));

import { runAction } from "@/lib/actions/factory";
import {
  cauHinhCongNhanTuongDuong,
  cauHinhDiemDanhBuoi,
} from "@/lib/elearning/equivalence";

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

const GOC = "2024-03-15T00:00:00.000Z";

const congNhan = (input: Record<string, unknown> = {}, reason: string | null = "Có chứng chỉ ngoài") =>
  runAction(
    cauHinhCongNhanTuongDuong,
    ACTOR,
    {
      userId: "u-hv",
      courseId: "k1",
      evidenceSource: "Chứng chỉ An toàn lao động số 123/2024",
      originalEffectiveAt: GOC,
      ...input,
    },
    { actorName: "Đào tạo", reason },
  );

const duLieuEn = () => h.taoEn.mock.calls[0]?.[0].data;
const duLieuEq = () => h.taoEq.mock.calls[0]?.[0].data;

beforeEach(() => {
  h.can.mockReturnValue(true);
  h.khoa = { id: "k1", title: "An toàn" };
  h.nhanSu = { centerId: "cs1", orgUnitId: "ou1", fullName: "Lê Văn C", employeeCode: "NV9" };
  h.daCo = null;
  h.bai = { id: "b1", kind: "LIVE_SESSION", title: "Buổi 1" };
  h.ghiDanh = { id: "en1", userId: "u-hv" };
  h.taoEq.mockClear();
  h.taoEn.mockClear();
  h.upsertTienDo.mockClear();
});

describe("luật 1 — bốn cột của lượt ghi danh sinh ra", () => {
  it("status COMPLETED, source EQUIVALENCE", async () => {
    const { res } = await congNhan();
    expect(res.ok).toBe(true);
    expect(duLieuEn()?.status).toBe("COMPLETED");
    expect(duLieuEn()?.source).toBe("EQUIVALENCE");
  });

  it("`completedAt` = ngày hiệu lực GỐC, KHÔNG phải bây giờ", async () => {
    // Mọi phép tính hạn tái chứng nhận đứng trên cột này (luật 4). Lấy ngày bấm
    // nút là kéo dài hiệu lực thêm đúng khoảng thời gian người ta chậm nhập.
    await congNhan();
    expect((duLieuEn()?.completedAt as Date).toISOString()).toBe(GOC);
  });

  it("`verifiedAt` = BÂY GIỜ, khác mốc học", async () => {
    await congNhan();
    const v = duLieuEn()?.verifiedAt as Date;
    expect(v.getTime()).toBeGreaterThan(new Date(GOC).getTime());
  });
});

describe("luật 3 — đứng NGOÀI phân hoạch đúng-hạn/trễ", () => {
  it("KHÔNG đặt `dueAtOriginal`", async () => {
    // Gán một cái hạn giả sẽ kéo lượt này vào mẫu số của một phép đo mà nó không
    // thuộc về, và tỉ lệ đúng hạn đổi vì một người chưa từng học ở đây.
    await congNhan();
    expect(duLieuEn()?.dueAtOriginal).toBeNull();
    expect(duLieuEn()?.dueAt).toBeNull();
    expect(duLieuEn()?.isLate).toBe(false);
  });
});

describe("kiểm tra đầu vào — ba cái đều về ngày tháng hoặc trách nhiệm", () => {
  it("ngày hiệu lực gốc ở TƯƠNG LAI ⇒ từ chối", async () => {
    // Hạn tái chứng nhận sẽ trôi về phía trước một khoảng không ai quyết.
    const mai = new Date(Date.now() + 86400000).toISOString();
    const { res } = await congNhan({ originalEffectiveAt: mai });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.field).toBe("originalEffectiveAt");
  });

  it("`null` ngày gốc KHÔNG thành 1970-01-01", async () => {
    const { res } = await congNhan({ originalEffectiveAt: null });
    expect(res.ok).toBe(false);
    expect(h.taoEq).not.toHaveBeenCalled();
  });

  it("KHÔNG tự công nhận cho chính mình", async () => {
    // Điểm kiểm soát duy nhất của luồng này là có người thứ hai đứng tên.
    const { res } = await congNhan({ userId: "u-dt" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("SELF_APPROVAL");
  });

  it("bằng chứng quá ngắn ⇒ từ chối", async () => {
    // Một lượt công nhận không nêu được bằng chứng thì nó chỉ là một lời nói.
    const { res } = await congNhan({ evidenceSource: "ok" });
    expect(res.ok).toBe(false);
  });

  it("bắt buộc nhập lý do", async () => {
    const { res } = await congNhan({}, null);
    expect(res.ok).toBe(false);
    expect(h.taoEq).not.toHaveBeenCalled();
  });

  it("người học chưa có cơ sở ⇒ từ chối, NÊU TÊN", async () => {
    // Cùng hàng rào với đường giao bài (QĐ-CDA-10): bản ghi `centerId` null tàng
    // hình với mọi người cấp cơ sở.
    h.nhanSu = { centerId: null, orgUnitId: null, fullName: "Lê Văn C", employeeCode: "NV9" };
    const { res } = await congNhan();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("MISSING_CENTER");
    expect(res.error.message).toContain("NV9");
  });

  it("công nhận LẦN HAI cho cùng khoá ⇒ từ chối", async () => {
    h.daCo = { id: "eq-cu" };
    const { res } = await congNhan();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("ALREADY_DONE");
  });
});

describe("sổ công nhận ghi đủ để đối chiếu", () => {
  it("người xác nhận lấy từ ACTOR, bằng chứng và ngày gốc ghi nguyên", async () => {
    await congNhan();
    expect(duLieuEq()?.confirmedByUserId).toBe("u-dt");
    expect(duLieuEq()?.evidenceSource).toContain("123/2024");
    expect((duLieuEq()?.originalEffectiveAt as Date).toISOString()).toBe(GOC);
  });
});

describe("điểm danh buổi TRỰC TIẾP", () => {
  const tick = (daDu: boolean) =>
    runAction(
      cauHinhDiemDanhBuoi,
      ACTOR,
      { enrollmentId: "en1", lessonId: "b1", daDu },
      { actorName: "Giảng viên" },
    );

  it("tick ĐÃ DỰ ⇒ DONE + có mốc xác nhận + ghi ai tick", async () => {
    const { res } = await tick(true);
    expect(res.ok).toBe(true);
    const u = h.upsertTienDo.mock.calls[0]?.[0].update;
    expect(u?.status).toBe("DONE");
    expect(u?.verifiedAt).toBeInstanceOf(Date);
    expect(u?.attendanceMarkedByUserId).toBe("u-dt");
  });

  it("BỎ tick ⇒ xoá mốc xác nhận, không giữ lại", async () => {
    // Một dòng vừa "chưa dự" vừa mang `verifiedAt` là hai câu trả lời cho một
    // câu hỏi.
    await tick(false);
    const u = h.upsertTienDo.mock.calls[0]?.[0].update;
    expect(u?.status).toBe("NOT_STARTED");
    expect(u?.verifiedAt).toBeNull();
    expect(u?.completedAt).toBeNull();
  });

  it("nhật ký ai tick vẫn ghi kể cả khi BỎ tick", async () => {
    // Bỏ tick cũng là một quyết định cần biết ai làm.
    await tick(false);
    expect(h.upsertTienDo.mock.calls[0]?.[0].update.attendanceMarkedByUserId).toBe("u-dt");
  });

  it("bài KHÔNG phải Buổi trực tiếp ⇒ từ chối", async () => {
    // Cho tick bài trực tuyến là mở đường qua mặt toàn bộ phép đo tiến độ: ai đó
    // "tick xong" một bài video mà chưa xem phút nào.
    h.bai = { id: "b1", kind: "VIDEO", title: "Video 1" };
    const { res } = await tick(true);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("WRONG_KIND");
    expect(h.upsertTienDo).not.toHaveBeenCalled();
  });

  it("thiếu quyền ⇒ từ chối", async () => {
    h.can.mockReturnValue(false);
    const { res } = await tick(true);
    expect(res.ok).toBe(false);
    expect(h.upsertTienDo).not.toHaveBeenCalled();
  });
});
