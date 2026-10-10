// @vitest-environment node
/**
 * V-3 · G-01a — ô "Link Facebook" của lead: NHẬP VÀO THÌ PHẢI ĐỌC RA ĐƯỢC.
 *
 * Lỗi thật đang có: `manualLeadSchema` khai `facebookUrl`, chuẩn hoá nó tử tế
 * (chặn `javascript:`, tự vá `https://`), rồi `createLeadManual` **không truyền
 * xuống `db.lead.create`**. Người gọi gửi link lên, action trả `{ ok: true }`,
 * và giá trị bốc hơi — không lỗi, không nhật ký, không dấu vết. Đúng loại hỏng
 * tệ nhất: bên gửi tin là đã lưu.
 *
 * Bằng chứng đây là VIỆC BỎ SÓT chứ không phải thiết kế: chú thích ngay tại
 * `updateLeadFields` (đường SỬA) viết "…action này chưa bao giờ ghi được: sửa
 * xong là mất im lặng. **Thêm cho cả hai đường**" — nhưng chỉ đường SỬA được
 * thêm thật, đường TẠO thì không.
 *
 * Vì sao pin bằng test thay vì chỉ vá một dòng: `facebookUrl` là thứ DUY NHẤT
 * đối khớp được lead Messenger-first (phễu SR.QD.217 L1→L2→L3) khi phụ huynh
 * chưa cho số. Mất nó lúc tạo là mất luôn đường nối lead ↔ hội thoại, và không
 * có cách nào dựng lại sau.
 *
 * Ca cuối cùng canh đúng chiều "đọc ra được": đường SỬA đọc `before` bằng
 * `select` hẹp — quên khai `facebookUrl` ở đó thì so-lệch-để-ghi-nhật-ký luôn
 * thấy `undefined !== "https://…"`, tức mọi lần lưu đều bịa ra một dòng "đã đổi
 * link Facebook" dù người dùng không đụng vào ô đó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  canViewLeadPii: vi.fn(),
  leadCreate: vi.fn(),
  leadUpdate: vi.fn(),
  leadFindFirst: vi.fn(),
  leadFindUnique: vi.fn(),
  logLeadAudit: vi.fn(),
  // V-6 · G-02 (25/08): đường SỬA nay ghi lead + ghi vết TRONG CÙNG một giao
  // dịch. Giao dịch giả trao lại đúng `leadUpdate` để 3 ca dưới vẫn soi được
  // `data` như trước — hành vi được pin không đổi, chỉ đường đi đổi.
  transaction: vi.fn(),
  centerIdForOrgUnit: vi.fn(),
  rejectHeadOffice: vi.fn(),
  autoAssignNewLead: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
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

import { createLeadManual, updateLeadFields } from "./actions";

/** Dữ liệu tối thiểu để phiếu qua được zod — phần còn lại là chuyện của ca test. */
const PHIEU = { parentName: "Chị Hường", phone: "0905123456" };

/** `data` mà action đã đưa cho Prisma ở lần ghi gần nhất. */
const dataTao = () => h.leadCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
const daSua = () => h.leadUpdate.mock.calls[0]?.[0]?.data as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", centerId: "cs1" } });
  h.checkPermission.mockResolvedValue(true);
  h.canViewLeadPii.mockResolvedValue(true);
  h.leadFindFirst.mockResolvedValue(null); // không trùng SĐT
  h.leadCreate.mockResolvedValue({ id: "lead-moi" });
  h.leadUpdate.mockResolvedValue({ id: "lead-cu" });
  h.logLeadAudit.mockResolvedValue(undefined);
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ lead: { update: h.leadUpdate } }),
  );
  h.centerIdForOrgUnit.mockResolvedValue("cs1");
  h.rejectHeadOffice.mockResolvedValue(null);
  h.autoAssignNewLead.mockResolvedValue(undefined);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
});

describe("[V-3 G-01a] createLeadManual — link Facebook nhập vào phải xuống DB", () => {
  it("có gõ link → `db.lead.create` nhận đúng ô `facebookUrl` (đã chuẩn hoá)", async () => {
    const res = await createLeadManual({ ...PHIEU, facebookUrl: "facebook.com/chi.huong" });

    expect(res.ok).toBe(true);
    expect(h.leadCreate).toHaveBeenCalledTimes(1);
    expect(dataTao().facebookUrl).toBe("https://facebook.com/chi.huong");
  });

  it("tên tài khoản trần → vá thành link facebook.com đầy đủ, KHÔNG lưu chuỗi trần", async () => {
    // "minh.nguyen.549" là dạng người ta gõ nhiều nhất. Lưu trần thì `<a href>`
    // ở màn chi tiết trỏ vào đường dẫn tương đối của chính admin.
    await createLeadManual({ ...PHIEU, facebookUrl: "minh.nguyen.549" });

    expect(dataTao().facebookUrl).toBe("https://www.facebook.com/minh.nguyen.549");
  });

  it("chuỗi độc `javascript:` → lưu null, tuyệt đối không lọt xuống DB", async () => {
    // Giá trị này được đổ thẳng vào `<a href>` ở màn chi tiết lead ⇒ lưu được là
    // XSS một-cú-bấm cho chính người trực CRM.
    const res = await createLeadManual({ ...PHIEU, facebookUrl: "javascript:alert(1)" });

    expect(res.ok).toBe(true); // gõ dở không bị chặn cả phiếu — cảnh báo lo ở đường nhập
    expect(dataTao().facebookUrl).toBeNull();
    expect(JSON.stringify(dataTao())).not.toContain("javascript:");
  });

  it("bỏ trống ô → lưu null, KHÔNG đẻ chuỗi rỗng", async () => {
    // Chuỗi rỗng làm hỏng mọi phép `if (lead.facebookUrl)` và mọi truy vấn
    // `facebookUrl: { not: null }` đang dùng để lọc lead Messenger.
    await createLeadManual({ ...PHIEU, facebookUrl: "" });

    expect(dataTao().facebookUrl).toBeNull();
  });

  it("không gửi ô nào → vẫn tạo được lead (ô này không bắt buộc)", async () => {
    const res = await createLeadManual({ ...PHIEU });

    expect(res.ok).toBe(true);
    expect(dataTao().facebookUrl).toBeNull();
  });

  it("nhật ký kiểm toán CREATE ghi lại link — không thì không ai truy được ai điền", async () => {
    await createLeadManual({ ...PHIEU, facebookUrl: "facebook.com/chi.huong" });

    expect(h.logLeadAudit).toHaveBeenCalledTimes(1);
    const ghi = h.logLeadAudit.mock.calls[0][0] as {
      action: string;
      newValues: Record<string, unknown>;
    };
    expect(ghi.action).toBe("CREATE");
    expect(ghi.newValues.facebookUrl).toBe("https://facebook.com/chi.huong");
  });
});

describe("[V-3 G-01a] updateLeadFields — đường SỬA (pin lại, đừng gỡ)", () => {
  const TRUOC = {
    id: "lead-cu",
    parentName: "Chị Hường",
    phone: "84905123456",
    email: null,
    childName: null,
    childAge: null,
    centerId: "cs1",
    orgUnitId: "ou-cs1",
    courseId: null,
    source: "Nhập tay",
    note: null,
    facebookUrl: null,
    assignedToId: "u-sale",
    createdById: "u-sale",
  };

  beforeEach(() => {
    h.leadFindUnique.mockResolvedValue(TRUOC);
  });

  it("sửa link → `db.lead.update` nhận `facebookUrl` đã chuẩn hoá", async () => {
    const res = await updateLeadFields("lead-cu", { facebookUrl: "facebook.com/chi.huong" });

    expect(res.ok).toBe(true);
    expect(daSua().facebookUrl).toBe("https://facebook.com/chi.huong");
  });

  it("xoá trắng ô → ghi null (gỡ được link sai, không kẹt vĩnh viễn)", async () => {
    h.leadFindUnique.mockResolvedValue({ ...TRUOC, facebookUrl: "https://facebook.com/nham" });

    await updateLeadFields("lead-cu", { facebookUrl: "" });

    expect(daSua().facebookUrl).toBeNull();
  });

  it("không đụng ô → KHÔNG đưa `facebookUrl` vào lệnh ghi (đừng đè trắng)", async () => {
    h.leadFindUnique.mockResolvedValue({ ...TRUOC, facebookUrl: "https://facebook.com/chi.huong" });

    await updateLeadFields("lead-cu", { parentName: "Chị Hường A" });

    expect("facebookUrl" in daSua()).toBe(false);
  });
});

describe("[V-3 G-01a] chốt chặn nguồn — hai chỗ không được lệch nhau", () => {
  const src = fs.readFileSync("app/(admin)/admin/leads/actions.ts", "utf8");

  it("`before` của đường SỬA vẫn select `facebookUrl` (nếu không, nhật ký bịa ra thay đổi)", () => {
    const i = src.indexOf("export async function updateLeadFields");
    expect(i).toBeGreaterThan(-1);
    const than = src.slice(i, i + 2500);
    expect(than).toContain("facebookUrl: true");
  });

  it("ô này vẫn nằm trong ALLOWLIST người nhập phiếu được sửa", () => {
    const i = src.indexOf("const INTAKE_EDITABLE_FIELDS");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 400)).toContain("'facebookUrl'");
  });
});
