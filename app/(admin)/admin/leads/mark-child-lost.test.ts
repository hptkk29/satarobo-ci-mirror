// @vitest-environment node
/**
 * C-06 — Sale đánh dấu một đứa con là RỚT.
 *
 * Hình dạng dữ liệu do chủ dự án chốt 24/08/2026 (B5 + 12(b)) và nó lệch tầng có chủ
 * đích: TRẠNG THÁI rớt theo TỪNG CON (`LeadChild.status = LOST`), còn LÝ DO rớt là
 * MỘT ô ghi chú tự do ở cấp PHỤ HUYNH (`Lead.lostNote` + `Lead.lostAt`). Không có
 * danh mục lý do — bảng `LeadLostReason` đã bị bỏ khỏi phạm vi.
 *
 * Ba thứ phải canh bằng test vì làm sai là MẤT DỮ LIỆU chứ không phải hiện sai:
 *
 * (a) Con rớt sau ĐÈ ghi chú của con trước — chấp nhận, nhưng chỉ chấp nhận được nếu
 *     mỗi lượt đánh dấu để lại vết đủ để lần ra lý do CỦA TỪNG CON. Vết phải mang cả
 *     `leadChildId` (định danh, không đổi) lẫn tên con (đọc được), và phải nằm TRONG
 *     cùng giao dịch với lượt ghi — ghi vết ở ngoài rồi nuốt lỗi thì đúng bằng không
 *     có vết, đây là lỗi đã phải vá một lần ở `updateLeadFields` (V-6 · G-02).
 *
 * (b) Gỡ một con khỏi trạng thái rớt CHỈ được xoá `Lead.lostNote`/`lostAt` khi không
 *     còn con nào rớt. Xoá vô điều kiện = xoá mất lý do của đứa còn lại.
 *
 * (c) Đường GỠ rớt không được nhận `LOST` làm đích: nhận là mở một cửa đánh dấu rớt
 *     KHÔNG qua ô lý do bắt buộc — tức vô hiệu hoá đúng thứ C-06 sinh ra để bảo đảm.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  childFindUnique: vi.fn(),
  childUpdate: vi.fn(),
  childCount: vi.fn(),
  leadUpdate: vi.fn(),
  activityCreate: vi.fn(),
  logLeadAudit: vi.fn(),
  transaction: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: h.checkPermission,
  canViewLeadPii: vi.fn(async () => true),
}));
vi.mock("@/lib/auth/permissions", () => ({ hasRole: vi.fn(() => false) }));
vi.mock("@/lib/db", () => ({
  db: {
    lead: {
      create: vi.fn(),
      update: h.leadUpdate,
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    leadChild: { findUnique: h.childFindUnique, count: h.childCount },
    trialEnrollment: { count: vi.fn(async () => 0) },
    $transaction: h.transaction,
  },
}));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({})),
}));
vi.mock("@/lib/audit/log", () => ({
  logLeadAudit: h.logLeadAudit,
  getAuditActor: vi.fn(() => ({ actorId: "u-sale", actorName: "Sale CS1" })),
}));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/org/org-service", () => ({ centerIdForOrgUnit: vi.fn() }));
vi.mock("@/lib/enrollment-flow", () => ({ rejectHeadOffice: vi.fn() }));
vi.mock("@/lib/lead/auto-assign", () => ({
  autoAssignNewLead: vi.fn(),
  manualAssignLead: vi.fn(),
  reassignForCenter: vi.fn(),
}));
vi.mock("@/lib/lead/assign", () => ({ autoAssignLead: vi.fn(), reassignOpenLeads: vi.fn() }));
vi.mock("@/lib/lead/assignment", () => ({ assignmentWrite: vi.fn() }));
vi.mock("@/lib/lead/sharing", () => ({ leadSharingEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/crm/transfer-validate", () => ({ validateTransferTarget: vi.fn() }));
vi.mock("@/lib/payments/summary", () => ({ getLeadPaymentSummary: vi.fn() }));
vi.mock("@/lib/students/sync-name", () => ({ syncLeadChildNameToStudents: vi.fn() }));
// 26/09 — updateLeadFields/updateLeadChild dội ô chung sang học viên (lib/students/dong-bo-lead-db.ts);
// bộ này canh chuyện khác nên giả lập phần đó — dây nối có lưới riêng [DBL-W*].
vi.mock("@/lib/students/dong-bo-lead-db", () => ({
  dongBoTuLead: vi.fn(async () => ({ leadIds: [], studentIds: [] })),
  dongBoTuCon: vi.fn(async () => ({ leadIds: [], studentIds: [] })),
}));
vi.mock("@/lib/students/prior-history", () => ({
  getPriorHistoryByPhone: vi.fn(async () => []),
  summarizePriorHistory: vi.fn(() => ""),
}));
vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: vi.fn() }));

import { markLeadChildLostAction, unmarkLeadChildLostAction } from "./actions";

/** Một đứa con của phiếu CS1, do chính người đang đăng nhập phụ trách. */
const CON = {
  id: "child-1",
  fullName: "Bé Minh",
  leadId: "lead-1",
  status: null as string | null,
  lead: { id: "lead-1", centerId: "cs1", assignedToId: "u-sale" },
};

const MOC_TX = new Date("2026-08-25T03:00:00.000Z");

const daGhiCon = () => h.childUpdate.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
const daGhiPhieu = () => h.leadUpdate.mock.calls[0]?.[0] as { where: unknown; data: Record<string, unknown> };
/** Mọi ô của phiếu đã bị lượt chạy này ghi — gộp cả những lần `update` không liên quan. */
const oPhieuDaGhi = () =>
  h.leadUpdate.mock.calls.flatMap((c) =>
    Object.keys((c[0] as { data: Record<string, unknown> }).data),
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", name: "Sale CS1", centerId: "cs1" } });
  h.checkPermission.mockResolvedValue(true);
  h.childFindUnique.mockResolvedValue({ ...CON });
  h.childUpdate.mockResolvedValue({ id: CON.id });
  h.childCount.mockResolvedValue(1);
  h.leadUpdate.mockResolvedValue({ id: "lead-1" });
  // N-4 — đường ghi hoạt động chung đọc `createdAt` của dòng vừa tạo để bump
  // `Lead.lastActivityAt`; tx giả phải trả nó như Prisma thật.
  h.activityCreate.mockResolvedValue({ id: "act-1", createdAt: MOC_TX });
  h.logLeadAudit.mockResolvedValue(undefined);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      leadChild: { update: h.childUpdate, count: h.childCount },
      lead: { update: h.leadUpdate },
      leadActivity: { create: h.activityCreate },
    }),
  );
});

describe("[C-06] markLeadChildLostAction — cổng vào", () => {
  it("chưa đăng nhập → từ chối, không chạm DB", async () => {
    h.auth.mockResolvedValue(null);

    const res = await markLeadChildLostAction({ leadChildId: "child-1", lostNote: "Nhà xa" });

    expect(res.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("không có quyền `leads:edit` → từ chối, không chạm DB", async () => {
    h.checkPermission.mockResolvedValue(false);

    const res = await markLeadChildLostAction({ leadChildId: "child-1", lostNote: "Nhà xa" });

    expect(res.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("🔴 ô lý do bỏ trống → từ chối (đây là chỗ 'bắt buộc' phải có răng)", async () => {
    const res = await markLeadChildLostAction({ leadChildId: "child-1", lostNote: "   " });

    expect(res.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("con thuộc cơ sở khác → 'không tìm thấy', không ghi gì", async () => {
    h.passesScope.mockReturnValue(false);

    const res = await markLeadChildLostAction({ leadChildId: "child-1", lostNote: "Nhà xa" });

    expect(res.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("không phải người phụ trách và không có `leads:view-all` → từ chối", async () => {
    h.childFindUnique.mockResolvedValue({ ...CON, lead: { ...CON.lead, assignedToId: "u-khac" } });
    h.checkPermission.mockImplementation(async (key: string) => key !== "leads:view-all");

    const res = await markLeadChildLostAction({ leadChildId: "child-1", lostNote: "Nhà xa" });

    expect(res.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });
});

describe("[C-06] markLeadChildLostAction — hai tầng ghi", () => {
  it("trạng thái RỚT ghi ở CON, lý do + mốc ghi ở PHỤ HUYNH", async () => {
    const res = await markLeadChildLostAction({
      leadChildId: "child-1",
      lostNote: "  Phụ huynh chọn trung tâm gần nhà  ",
    });

    expect(res.ok).toBe(true);
    expect(daGhiCon().where).toEqual({ id: "child-1" });
    expect(daGhiCon().data).toEqual({ status: "LOST" });

    expect(daGhiPhieu().where).toEqual({ id: "lead-1" });
    expect(daGhiPhieu().data.lostNote).toBe("Phụ huynh chọn trung tâm gần nhà");
    expect(daGhiPhieu().data.lostAt).toBeInstanceOf(Date);
  });

  it("KHÔNG đụng `Lead.status` — phiếu vẫn ở trạng thái đang chăm của nó", async () => {
    // Chốt tường minh: OQ-G4 quyết định KHÔNG tự chuyển `Lead.status` sang LOST khi con
    // rớt. Ai thêm dòng đó vào sau này sẽ làm phiếu còn một đứa con đang tư vấn biến mất
    // khỏi mọi bảng lead đang chăm.
    await markLeadChildLostAction({ leadChildId: "child-1", lostNote: "Nhà xa" });

    expect(daGhiPhieu().data).not.toHaveProperty("status");
  });

  it("🔴 (a) vết để lần ra lý do TỪNG CON: nhật ký mang cả id lẫn tên con + lý do", async () => {
    await markLeadChildLostAction({ leadChildId: "child-1", lostNote: "Học phí cao" });

    const vet = h.logLeadAudit.mock.calls[0]?.[0] as {
      leadId: string;
      action: string;
      newValues: Record<string, unknown>;
      reason?: string;
      tx?: unknown;
    };
    expect(vet.leadId).toBe("lead-1");
    expect(vet.action).toBe("STATUS_CHANGE");
    expect(vet.newValues).toMatchObject({ leadChildId: "child-1", lostNote: "Học phí cao" });
    expect(JSON.stringify(vet.newValues)).toContain("Bé Minh");
    expect(vet.reason).toBe("Học phí cao");

    const timeline = h.activityCreate.mock.calls[0]?.[0]?.data as { content: string; leadId: string };
    expect(timeline.leadId).toBe("lead-1");
    expect(timeline.content).toContain("Bé Minh");
    expect(timeline.content).toContain("Học phí cao");
  });

  it("🔴 vết đi CÙNG giao dịch — vết hỏng thì lượt đánh dấu cũng không lưu", async () => {
    const vet = h.logLeadAudit.mock.calls;
    h.logLeadAudit.mockRejectedValue(new Error("audit chết"));

    const res = await markLeadChildLostAction({ leadChildId: "child-1", lostNote: "Nhà xa" });

    expect(res.ok).toBe(false);
    // `tx` phải được truyền xuống, nếu không vết nằm ngoài giao dịch và sống sót
    // độc lập với lượt ghi (đúng lỗi đã vá ở V-6 · G-02).
    expect(h.logLeadAudit.mock.calls[0]?.[0]).toHaveProperty("tx");
    expect(vet).toBeDefined();
  });
});

describe("[C-06] unmarkLeadChildLostAction — gỡ một con khỏi trạng thái rớt", () => {
  beforeEach(() => {
    h.childFindUnique.mockResolvedValue({ ...CON, status: "LOST" });
  });

  it("🔴 (b) CÒN con khác đang rớt → KHÔNG xoá lý do của phiếu", async () => {
    h.childCount.mockResolvedValue(1); // đứa còn lại vẫn rớt

    const res = await unmarkLeadChildLostAction({ leadChildId: "child-1", status: "CONSULTING" });

    expect(res.ok).toBe(true);
    expect(daGhiCon().data).toEqual({ status: "CONSULTING" });
    // N-4 — `lead.update` NAY còn được gọi để bump `lastActivityAt` (đường ghi
    // hoạt động chung). Thứ phải canh vẫn nguyên: không lượt ghi nào được chạm
    // `lostNote`/`lostAt` khi còn con khác đang rớt — chạm là xoá mất lý do của
    // đứa còn lại. Đo theo Ô BỊ GHI, không đo theo "có gọi update hay không".
    expect(oPhieuDaGhi()).not.toContain("lostNote");
    expect(oPhieuDaGhi()).not.toContain("lostAt");
  });

  it("(b) không còn con nào rớt → xoá cả lý do lẫn mốc", async () => {
    h.childCount.mockResolvedValue(0);

    const res = await unmarkLeadChildLostAction({ leadChildId: "child-1", status: "CONSULTING" });

    expect(res.ok).toBe(true);
    expect(daGhiPhieu().data).toEqual({ lostNote: null, lostAt: null });
  });

  it("🔴 đếm con còn rớt phải đọc TRONG giao dịch và SAU khi đã đổi trạng thái con", async () => {
    // Đếm trước khi ghi thì chính đứa vừa gỡ vẫn được tính là đang rớt ⇒ lý do không
    // bao giờ xoá được; đếm ngoài giao dịch thì hai người bấm cùng lúc ra hai kết quả.
    const thuTu: string[] = [];
    h.childUpdate.mockImplementation(async () => {
      thuTu.push("update");
      return { id: CON.id };
    });
    h.childCount.mockImplementation(async (args: { where: Record<string, unknown> }) => {
      thuTu.push("count");
      expect(args.where).toMatchObject({ leadId: "lead-1", status: "LOST" });
      return 0;
    });

    await unmarkLeadChildLostAction({ leadChildId: "child-1", status: "CONSULTING" });

    expect(thuTu).toEqual(["update", "count"]);
    expect(h.childCount).toHaveBeenCalledTimes(1);
  });

  it("🔴 (c) không cho gỡ về `LOST` — cửa hậu đánh dấu rớt bỏ qua ô lý do bắt buộc", async () => {
    const res = await unmarkLeadChildLostAction({ leadChildId: "child-1", status: "LOST" });

    expect(res.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("con không hề đang rớt → không làm gì, báo rõ (tránh xoá lý do của phiếu oan)", async () => {
    h.childFindUnique.mockResolvedValue({ ...CON, status: "CONSULTING" });

    const res = await unmarkLeadChildLostAction({ leadChildId: "child-1", status: "NEW" });

    expect(res.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("con thuộc cơ sở khác → từ chối, không chạm DB", async () => {
    h.passesScope.mockReturnValue(false);

    const res = await unmarkLeadChildLostAction({ leadChildId: "child-1", status: "CONSULTING" });

    expect(res.ok).toBe(false);
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("lượt gỡ cũng để lại vết (ai gỡ, gỡ đứa nào, về trạng thái gì)", async () => {
    h.childCount.mockResolvedValue(0);

    await unmarkLeadChildLostAction({ leadChildId: "child-1", status: "CONSULTING" });

    const vet = h.logLeadAudit.mock.calls[0]?.[0] as {
      oldValues: Record<string, unknown>;
      newValues: Record<string, unknown>;
      tx?: unknown;
    };
    expect(vet.oldValues).toMatchObject({ childStatus: "LOST", leadChildId: "child-1" });
    expect(vet.newValues).toMatchObject({ childStatus: "CONSULTING" });
    expect(vet).toHaveProperty("tx");
    expect(h.activityCreate).toHaveBeenCalledTimes(1);
  });
});
