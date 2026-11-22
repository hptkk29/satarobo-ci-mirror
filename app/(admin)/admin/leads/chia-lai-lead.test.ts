// @vitest-environment node
/**
 * S-2b — NÚT "Chia lại lead" (trang chi tiết lead) BÁO THÀNH CÔNG GIẢ.
 *
 * Hiện trạng đo được (25/08/2026): nút gọi `autoAssignNewLeadAction`, action gọi
 * `autoAssignNewLead` rồi **vứt bỏ** mọi thông tin kết quả (`skipped`,
 * `assignedToId`, `mode`) và luôn trả `{ ok: true }`. Giao diện thấy `ok` là bắn
 * toast **"Đã chia lại lead theo cấu hình cơ sở"**.
 *
 * `autoAssignNewLead` có NĂM đường không làm gì mà vẫn trả `ok: true`:
 *   1. lead đã có người phụ trách  → `{ ok, skipped: true, assignedToId }`
 *   2. lead đã có tương tác của sale → `{ ok, skipped: true }`
 *   3. cơ sở đặt chế độ "Gán tay"    → `{ ok, assignedToId: null, mode: MANUAL }`
 *   4. cơ sở không còn tư vấn viên   → `{ ok, assignedToId: null }`
 *   5. lead chưa thuộc cơ sở nào     → `{ ok, assignedToId: null, centerId: null }`
 *
 * Đường (1) là đường THƯỜNG GẶP NHẤT: nút nằm trên trang chi tiết lead, mà lead
 * ở đó gần như luôn đã có người phụ trách. Nghĩa là cái nút tên "Chia LẠI lead"
 * về bản chất **không bao giờ chia lại được** — nó chỉ chia lead chưa phân công —
 * nhưng lần nào bấm cũng báo xanh. Quản lý tin là đã đổi người, thực tế lead vẫn
 * nằm y chỗ cũ.
 *
 * Chữa: KHÔNG đổi luật chia (khoá-khi-đã-tương-tác là quyết định có chủ đích của
 * Đợt D, đổi nó là việc của chủ dự án). Chỉ bắt action nói đúng chuyện đã xảy ra:
 * `ok: true` **chỉ khi thật sự ghi được người nhận mới**, còn lại trả lý do cụ
 * thể để người bấm biết phải làm gì tiếp.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  canViewLeadPii: vi.fn(),
  autoAssignNewLead: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
  revalidatePath: vi.fn(),
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
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/db-scope", () => ({
  passesScope: h.passesScope,
  scopedDb: vi.fn(() => ({})),
}));
vi.mock("@/lib/audit/log", () => ({
  logLeadAudit: vi.fn(),
  getAuditActor: vi.fn(() => ({ actorId: "u-ql", actorName: "Quản lý CS1" })),
}));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/org/org-service", () => ({ centerIdForOrgUnit: vi.fn() }));
vi.mock("@/lib/enrollment-flow", () => ({ rejectHeadOffice: vi.fn() }));
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
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: h.revalidatePath }));

import { autoAssignNewLeadAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-ql", centerId: "cs1" } });
  h.checkPermission.mockResolvedValue(true);
  h.canViewLeadPii.mockResolvedValue(true);
});

describe("[S-2b] 'Chia lại lead' — chỉ báo xanh khi THẬT SỰ đổi được người nhận", () => {
  it("chia được thật → ok:true kèm người nhận", async () => {
    h.autoAssignNewLead.mockResolvedValue({
      ok: true,
      assignedToId: "u-sale-2",
      centerId: "cs1",
      mode: "ROUND_ROBIN",
    });

    const res = await autoAssignNewLeadAction("lead-1");

    expect(res).toEqual({ ok: true, assignedToId: "u-sale-2" });
  });

  it("lead ĐÃ có người phụ trách → KHÔNG báo xanh, chỉ chỗ đổi người", async () => {
    h.autoAssignNewLead.mockResolvedValue({
      ok: true,
      skipped: true,
      assignedToId: "u-sale-cu",
    });

    const res = await autoAssignNewLeadAction("lead-1");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/đã có người phụ trách/i);
    expect(res.error).toMatch(/Gán tay/); // nói luôn phải làm gì tiếp
  });

  it("lead đã có tương tác của sale (khoá tự chia) → KHÔNG báo xanh", async () => {
    h.autoAssignNewLead.mockResolvedValue({ ok: true, skipped: true });

    const res = await autoAssignNewLeadAction("lead-1");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/tương tác/i);
  });

  it("cơ sở đặt chế độ 'Gán tay' → KHÔNG báo xanh", async () => {
    h.autoAssignNewLead.mockResolvedValue({
      ok: true,
      assignedToId: null,
      centerId: "cs1",
      mode: "MANUAL",
    });

    const res = await autoAssignNewLeadAction("lead-1");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Gán tay/);
  });

  it("cơ sở không còn tư vấn viên → KHÔNG báo xanh, nói rõ lead vẫn chưa phân", async () => {
    h.autoAssignNewLead.mockResolvedValue({
      ok: true,
      assignedToId: null,
      centerId: "cs1",
      mode: "ROUND_ROBIN",
    });

    const res = await autoAssignNewLeadAction("lead-1");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/tư vấn viên/i);
  });

  it("lead chưa thuộc cơ sở nào → KHÔNG báo xanh, bảo chọn cơ sở trước", async () => {
    h.autoAssignNewLead.mockResolvedValue({
      ok: true,
      assignedToId: null,
      centerId: null,
      mode: "ROUND_ROBIN",
    });

    const res = await autoAssignNewLeadAction("lead-1");

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/cơ sở/i);
  });

  it("lỗi thật từ tầng chia → giữ nguyên lời nhắn của tầng dưới", async () => {
    h.autoAssignNewLead.mockResolvedValue({ ok: false, error: "Lead không tồn tại" });

    const res = await autoAssignNewLeadAction("lead-1");

    expect(res).toEqual({ ok: false, error: "Lead không tồn tại" });
  });

  it("không đổi được gì thì KHÔNG làm mới cache — không có gì để làm mới", async () => {
    h.autoAssignNewLead.mockResolvedValue({
      ok: true,
      skipped: true,
      assignedToId: "u-sale-cu",
    });

    await autoAssignNewLeadAction("lead-1");

    expect(h.revalidatePath).not.toHaveBeenCalled();
  });

  it("cổng quyền giữ nguyên: thiếu leads:assign → 'Không có quyền'", async () => {
    h.checkPermission.mockResolvedValue(false);

    const res = await autoAssignNewLeadAction("lead-1");

    expect(res).toEqual({ ok: false, error: "Không có quyền" });
    expect(h.autoAssignNewLead).not.toHaveBeenCalled();
  });
});
