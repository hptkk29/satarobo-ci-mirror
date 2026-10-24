// @vitest-environment node
/**
 * [LOW1] `leads:overwrite` hỏi TẠI CƠ SỞ CỦA LEAD ở `updateLeadFields` (rà độc lập 20/10/2026, cùng họ «nhìn thấy ≠ ghi» với [PVG-04]).
 *
 * `checkPermission('leads:overwrite')` — quyền seed `GLOBAL` — đúng cho MỌI cơ sở; `passesScope` chỉ là TẦM NHÌN. Người kiêm QLCS@CS1 (giữ `leads:overwrite`) + Sale@CS2 (chỉ thấy lead CS2, chỉ
 * `leads:edit`) từng đổi được ba ô khoá (SĐT · đơn vị · nguồn) của lead CS2. Nay ô khoá chỉ đè được khi người sửa GIỮ khoá ĐÚNG tại cơ sở của lead (`coQuyenTaiCoSo`).
 * Mỗi ca «bị chặn» có ĐỐI CHỨNG DƯƠNG (luật 11): cùng người sửa lead CS1 ⇒ được; vai ALL ⇒ được ở CS2.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  canViewLeadPii: vi.fn(),
  leadCreate: vi.fn(),
  leadUpdate: vi.fn(),
  leadFindFirst: vi.fn(),
  leadFindUnique: vi.fn(),
  childCreate: vi.fn(),
  childUpdate: vi.fn(),
  childFindUnique: vi.fn(),
  childFindMany: vi.fn(),
  logLeadAudit: vi.fn(),
  transaction: vi.fn(),
  leadActivityCreate: vi.fn(),
  centerIdForOrgUnit: vi.fn(),
  rejectHeadOffice: vi.fn(),
  autoAssignNewLead: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  syncName: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({
  checkPermission: h.checkPermission,
  canViewLeadPii: h.canViewLeadPii,
}));
vi.mock("@/lib/auth/permissions", () => ({ hasRole: vi.fn(() => false) }));
vi.mock("@/lib/db", () => ({
  db: {
    lead: {
      create: h.leadCreate,
      update: h.leadUpdate,
      findFirst: h.leadFindFirst,
      findUnique: h.leadFindUnique,
    },
    leadChild: {
      create: h.childCreate,
      update: h.childUpdate,
      findUnique: h.childFindUnique,
      findMany: h.childFindMany,
    },
    leadActivity: { create: h.leadActivityCreate },
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
// PR2: cờ nguồn mặc định TẮT — bộ này không bàn chuyện nguồn (đã có tests/lead-intake/nguon-noi-day-duong.spec.ts). Không giả hai mô-đun
// này thì `getSetting` chạm `db.systemSetting` của `db` giả (không có bảng đó) và ca đỏ vì lý do chẳng liên quan.
vi.mock("@/lib/nguon/feature", () => ({ laQuanLyNguonBat: async () => false }));
vi.mock("@/lib/nguon/noi-day", () => ({
  chuanBiQuyNguon: async (_db: unknown, rows: unknown[]) => rows.map(() => ({ bat: false })),
  ghiQuyNguonLeadMoi: async () => {},
}));
vi.mock("@/lib/org/org-service", () => ({ centerIdForOrgUnit: h.centerIdForOrgUnit }));
vi.mock("@/lib/enrollment-flow", () => ({ rejectHeadOffice: h.rejectHeadOffice }));
vi.mock("@/lib/lead/auto-assign", () => ({
  autoAssignNewLead: h.autoAssignNewLead,
  manualAssignLead: vi.fn(),
  reassignForCenter: vi.fn(),
}));
vi.mock("@/lib/lead/assign", () => ({ autoAssignLead: vi.fn(), reassignOpenLeads: vi.fn() }));
vi.mock("@/lib/lead/assignment", () => ({ assignmentWrite: vi.fn() }));
vi.mock("@/lib/lead/sharing", () => ({ leadSharingEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/crm/transfer-validate", () => ({ validateTransferTarget: vi.fn() }));
vi.mock("@/lib/payments/summary", () => ({ getLeadPaymentSummary: vi.fn() }));
vi.mock("@/lib/students/sync-name", () => ({ syncLeadChildNameToStudents: h.syncName }));
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

import { loiOKhoa } from "@/lib/lead/quyen-sua-lead";
import { updateLeadFields } from "./actions";


beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", centerId: "cs1" } });
  h.checkPermission.mockResolvedValue(true);
  h.canViewLeadPii.mockResolvedValue(true);
  h.leadFindFirst.mockResolvedValue(null);
  h.leadCreate.mockResolvedValue({ id: "lead-moi" });
  h.leadUpdate.mockResolvedValue({ id: "lead-cu" });
  h.childCreate.mockResolvedValue({ id: "con-moi", fullName: "Bé Bin" });
  h.childUpdate.mockResolvedValue({ id: "con-cu" });
  h.childFindMany.mockResolvedValue([]);
  h.logLeadAudit.mockResolvedValue(undefined);
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      // PR2: `createLeadManual` nay tạo lead TRONG `db.$transaction` (cùng giao dịch với quy nguồn) ⇒ `tx.lead.create`.
      lead: { update: h.leadUpdate, create: h.leadCreate },
      leadChild: {
        create: h.childCreate,
        update: h.childUpdate,
        findMany: h.childFindMany,
      },
      // Hợp nhất 20/09: `addLeadChild` nay gọi `ghiTuongTacLead(tx, …)` (cửa ghi lịch
      // sử tương tác do `main` dựng ở #301). Thiếu `leadActivity` trong `tx` giả thì
      // lỗi là `Cannot read properties of undefined (reading 'create')` — đọc như mã
      // hỏng chứ không như bộ giả thiếu một bảng.
      leadActivity: { create: h.leadActivityCreate },
    }),
  );
  h.centerIdForOrgUnit.mockResolvedValue("cs1");
  h.rejectHeadOffice.mockResolvedValue(null);
  h.autoAssignNewLead.mockResolvedValue(undefined);
  h.passesScope.mockReturnValue(true);
  h.syncName.mockResolvedValue({ studentIds: [] });
});

const perm = (centerScope: "ALL" | string[]) => ({ action: "leads:overwrite", scopeType: "GLOBAL", orgUnitId: "ou", roleCode: "FX", centerScope });
const actorCo = (permissions: ReturnType<typeof perm>[]) => ({ userId: "u-sale", isSuperAdmin: false, permissions, grantsAllow: new Set<string>() });

const LEAD = (centerId: string) => ({
  id: "lead-cu",
  parentName: "Chị Hường",
  phone: "84905123456",
  email: null,
  childName: null,
  childAge: null,
  centerId,
  orgUnitId: `ou-${centerId}`,
  courseId: null,
  source: "Nhập tay",
  note: null,
  facebookUrl: null,
  parentGender: null,
  parentDob: null,
  city: null,
  ward: null,
  addressLine: null,
  campaignName: null,
  campaignId: null,
  adsetId: null,
  adId: null,
  nextFollowUpAt: null,
  assignedToId: "u-sale",
  createdById: "u-sale",
});

describe("[LOW1] updateLeadFields — `leads:overwrite` đo TẠI cơ sở của lead", () => {
  it("[LOW1-a] QLCS@CS1 (overwrite ở CS1) kiêm Sale@CS2: đổi SĐT lead CS2 ⇒ TỪ CHỐI, không ghi; ĐỐI CHỨNG DƯƠNG: cùng người đổi SĐT lead CS1 ⇒ được", async () => {
    h.resolveActor.mockResolvedValue(actorCo([perm(["cs1"])]));
    h.leadFindUnique.mockResolvedValue(LEAD("cs2"));
    const chan = await updateLeadFields("lead-cu", { phone: "0905999888" });
    expect(chan).toEqual({ ok: false, error: loiOKhoa(["phone"]) }); // đúng câu «ô khoá» — không phải một lỗi khác (vd «Lead không tồn tại») làm ca xanh vì lý do sai
    expect(h.leadUpdate).not.toHaveBeenCalled();

    h.leadFindUnique.mockResolvedValue(LEAD("cs1"));
    const duoc = await updateLeadFields("lead-cu", { phone: "0905999888" });
    expect(duoc.ok).toBe(true);
    expect(h.leadUpdate).toHaveBeenCalled();
  });

  it("[LOW1-b] vai ALL (neo Hội sở) đổi SĐT lead CS2 ⇒ được; ô KHÔNG khoá (thành phố) của lead CS2 vẫn sửa được dù không giữ overwrite ở CS2 (không chặn quá tay)", async () => {
    h.resolveActor.mockResolvedValue(actorCo([perm("ALL")]));
    h.leadFindUnique.mockResolvedValue(LEAD("cs2"));
    expect((await updateLeadFields("lead-cu", { phone: "0905999888" })).ok).toBe(true);

    h.leadUpdate.mockClear();
    h.resolveActor.mockResolvedValue(actorCo([perm(["cs1"])]));
    expect((await updateLeadFields("lead-cu", { city: "Đà Nẵng" })).ok).toBe(true);
    expect(h.leadUpdate).toHaveBeenCalled();
  });
});
