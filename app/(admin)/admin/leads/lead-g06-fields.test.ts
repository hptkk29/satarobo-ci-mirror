// @vitest-environment node
/**
 * G-06 — bốn nhóm trường bổ sung: NHẬP VÀO THÌ PHẢI XUỐNG ĐƯỢC DB.
 *
 * · mốc chốt        → `LeadChild.closedAt`   (máy ghi ở đường chốt ghi danh)
 * · giá trị hợp đồng → `LeadChild.contractValue` (🔴 KHÔNG phải doanh thu)
 * · mã campaign     → `Lead.campaignName` + 3 ID Meta
 * · ngày hẹn kế tiếp → `Lead.nextFollowUpAt`
 *
 * Vì sao pin bằng test chứ không tin typecheck: G-01 (đợt ngay trước, cùng khu vực)
 * đã có đúng hai lỗi CHẢY MÁU DỮ LIỆU biên dịch sạch và trả `{ ok: true }` — schema
 * khai một ô mà `db.lead.create` không truyền xuống, và ô ghi mã của bảng khác. Cả
 * hai đều mất dữ liệu không một dòng nhật ký.
 *
 * Ca cuối cùng canh chiều ngược của đường SỬA: `before` đọc bằng `select` HẸP. Quên
 * khai một cột ở đó thì phép so-lệch-để-ghi-nhật-ký luôn thấy `undefined !== <giá
 * trị>`, tức mỗi lần bấm Lưu đẻ một dòng "đã đổi mã campaign" dù không ai đụng vào —
 * và một nhật ký hay bịa thì không làm chứng được nữa.
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
  loadCodes: vi.fn(),
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
// Danh mục mã cơ sở là dữ liệu, không phải hằng trong mã — test bơm vào đúng như
// đời thật đọc từ `Center.code`.
vi.mock("@/lib/ads/center-codes", () => ({ loadKnownCenterCodes: h.loadCodes }));
vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: vi.fn() }));

import { createLeadManual, updateLeadFields, addLeadChild } from "./actions";

const PHIEU = { parentName: "Chị Hường", phone: "0905123456" };

const dataTao = () => h.leadCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
const daSua = () => h.leadUpdate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
const conMoi = () => h.childCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;

/** Bản ghi `before` mà `updateLeadFields` đọc — đủ khoá để phép so-lệch chạy sạch. */
const LEAD_CU = {
  id: "lead-cu",
  parentName: "Chị Hường",
  phone: "84905123456",
  email: null,
  childName: null,
  childAge: null,
  centerId: "cs1",
  orgUnitId: "ou-cs1",
  courseId: null,
  source: "Ads",
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
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", centerId: "cs1" } });
  h.checkPermission.mockResolvedValue(true);
  h.canViewLeadPii.mockResolvedValue(true);
  h.leadFindFirst.mockResolvedValue(null);
  h.leadFindUnique.mockResolvedValue(LEAD_CU);
  h.leadCreate.mockResolvedValue({ id: "lead-moi" });
  h.leadUpdate.mockResolvedValue({ id: "lead-cu" });
  h.childCreate.mockResolvedValue({ id: "con-moi", fullName: "Bé Bin" });
  h.childUpdate.mockResolvedValue({ id: "con-cu" });
  h.childFindMany.mockResolvedValue([]);
  h.logLeadAudit.mockResolvedValue(undefined);
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      lead: { update: h.leadUpdate },
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
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  h.syncName.mockResolvedValue({ studentIds: [] });
  h.loadCodes.mockResolvedValue(new Set(["CS1", "CS2"]));
});

describe("[G-06] mã campaign + ngày hẹn kế tiếp — đường TẠO", () => {
  it("nhập đủ → `db.lead.create` nhận đúng 5 ô", async () => {
    const res = await createLeadManual({
      ...PHIEU,
      campaignName: "CS1_LEAD_ROBOTICS-L1_VIDEO_0826_A03",
      campaignId: "1203",
      adsetId: "4506",
      adId: "7809",
      nextFollowUpAt: "2026-09-02",
    });

    expect(res.ok).toBe(true);
    const d = dataTao();
    expect(d.campaignName).toBe("CS1_LEAD_ROBOTICS-L1_VIDEO_0826_A03");
    expect(d.campaignId).toBe("1203");
    expect(d.adsetId).toBe("4506");
    expect(d.adId).toBe("7809");
    expect(d.nextFollowUpAt).toBeInstanceOf(Date);
    expect((d.nextFollowUpAt as Date).toISOString().slice(0, 10)).toBe("2026-09-02");
  });

  it("bỏ trống → null hết, KHÔNG đẻ chuỗi rỗng", async () => {
    await createLeadManual({
      ...PHIEU,
      campaignName: "",
      campaignId: "",
      adsetId: "",
      adId: "",
      nextFollowUpAt: "",
    });
    const d = dataTao();
    expect(d.campaignName).toBeNull();
    expect(d.campaignId).toBeNull();
    expect(d.adsetId).toBeNull();
    expect(d.adId).toBeNull();
    expect(d.nextFollowUpAt).toBeNull();
  });

  it("không gửi ô nào → vẫn tạo được phiếu (cả 5 đều không bắt buộc)", async () => {
    const res = await createLeadManual({ ...PHIEU });
    expect(res.ok).toBe(true);
    expect(dataTao().campaignName).toBeNull();
    expect(dataTao().nextFollowUpAt).toBeNull();
  });

  it("mã campaign SAI khuôn SR.QD.232 → từ chối cả phiếu, không ghi gì", async () => {
    const res = await createLeadManual({ ...PHIEU, campaignName: "chien dich he 2026" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("SR.QD.232");
    expect(h.leadCreate).not.toHaveBeenCalled();
  });

  it("mã cơ sở LẠ nhưng đúng khuôn → vẫn nhận (mở cơ sở mới là thêm dữ liệu)", async () => {
    const res = await createLeadManual({ ...PHIEU, campaignName: "CS9_LEAD_X_VIDEO_0826_A1" });
    expect(res.ok).toBe(true);
    expect(dataTao().campaignName).toBe("CS9_LEAD_X_VIDEO_0826_A1");
  });

  it("không gõ mã campaign → KHÔNG tốn câu truy vấn danh mục cơ sở", async () => {
    await createLeadManual({ ...PHIEU });
    expect(h.loadCodes).not.toHaveBeenCalled();
  });
});

describe("[G-06] mã campaign + ngày hẹn kế tiếp — đường SỬA", () => {
  it("gửi khoá → ghi; ô rỗng → xoá trắng về null", async () => {
    await updateLeadFields("lead-cu", {
      campaignName: "CS2_MESS_COMBO12_IMAGE_0826_B07",
      nextFollowUpAt: "2026-09-10",
    });
    const d = daSua();
    expect(d.campaignName).toBe("CS2_MESS_COMBO12_IMAGE_0826_B07");
    expect((d.nextFollowUpAt as Date).toISOString().slice(0, 10)).toBe("2026-09-10");
  });

  it("KHÔNG gửi khoá → không đụng tới ô đó (khác hẳn 'gửi rỗng')", async () => {
    // Thiếu phân biệt này thì mỗi lượt sửa một ô sẽ ĐÈ TRẮNG bốn ô kia.
    await updateLeadFields("lead-cu", { parentName: "Chị Hường B" });
    const d = daSua();
    expect("campaignName" in d).toBe(false);
    expect("nextFollowUpAt" in d).toBe(false);
    expect("adsetId" in d).toBe(false);
  });

  it("sửa ô khác KHÔNG bị vấp lỗi khuôn campaign (chỉ kiểm khi có gửi khoá)", async () => {
    const res = await updateLeadFields("lead-cu", { parentName: "Chị Hường B" });
    expect(res.ok).toBe(true);
    expect(h.loadCodes).not.toHaveBeenCalled();
  });

  it("mã campaign sai khuôn → từ chối, KHÔNG ghi bản ghi nào", async () => {
    const res = await updateLeadFields("lead-cu", { campaignName: "khuyenmai" });
    expect(res.ok).toBe(false);
    expect(h.leadUpdate).not.toHaveBeenCalled();
  });

  it("lưu mà không đổi gì → KHÔNG đẻ dòng nhật ký kiểm toán rỗng ruột", async () => {
    // Đây là ca `select` hẹp thiếu cột: `before.campaignName` là `undefined` thì
    // phép so-lệch luôn đúng và nhật ký bịa ra một lần "đã đổi mã campaign".
    h.leadFindUnique.mockResolvedValue({
      ...LEAD_CU,
      campaignName: "CS1_LEAD_X_VIDEO_0826_A1",
      nextFollowUpAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    await updateLeadFields("lead-cu", {
      campaignName: "CS1_LEAD_X_VIDEO_0826_A1",
      nextFollowUpAt: "2026-09-02",
    });
    expect(h.logLeadAudit).not.toHaveBeenCalled();
  });
});

describe("[G-06] giá trị hợp đồng — theo TỪNG CON", () => {
  it("nhập số → xuống `leadChild.create`", async () => {
    const res = await addLeadChild({
      leadId: "lead-cu",
      fullName: "Bé Bin",
      contractValue: "12000000",
    });
    expect(res.ok).toBe(true);
    expect(conMoi().contractValue).toBe(12_000_000);
  });

  it("gõ có dấu phân cách như trên hợp đồng → vẫn ra số", async () => {
    await addLeadChild({ leadId: "lead-cu", fullName: "Bé Bin", contractValue: "12.000.000 đ" });
    expect(conMoi().contractValue).toBe(12_000_000);
  });

  it("để trống → null = CHƯA NHẬP, không phải 0", async () => {
    // Gộp hai thứ này là biến mọi phiếu chưa ai điền thành "hợp đồng 0 đồng".
    await addLeadChild({ leadId: "lead-cu", fullName: "Bé Bin", contractValue: "" });
    expect(conMoi().contractValue).toBeNull();
  });

  it("hợp đồng 0 đồng (học bổng toàn phần) giữ đúng số 0", async () => {
    await addLeadChild({ leadId: "lead-cu", fullName: "Bé Bin", contractValue: 0 });
    expect(conMoi().contractValue).toBe(0);
  });

  it("số âm → từ chối, không ghi con nào", async () => {
    const res = await addLeadChild({ leadId: "lead-cu", fullName: "Bé Bin", contractValue: -1 });
    expect(res.ok).toBe(false);
    expect(h.childCreate).not.toHaveBeenCalled();
  });

  it("chữ không có số → từ chối, KHÔNG lặng lẽ thành null", async () => {
    const res = await addLeadChild({
      leadId: "lead-cu",
      fullName: "Bé Bin",
      contractValue: "mười hai triệu",
    });
    expect(res.ok).toBe(false);
    expect(h.childCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quét mã nguồn — mấy ràng buộc không có cách nào kiểm bằng cách gọi hàm
// ─────────────────────────────────────────────────────────────────────────────
describe("[G-06] schema + migration + nơi ghi mốc chốt", () => {
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const MIGRATION = "prisma/migrations/20260826160000_g06_lead_extra_fields/migration.sql";
  const COT_LEAD = ["campaignName", "campaignId", "adsetId", "adId", "nextFollowUpAt"];
  const COT_CON = ["closedAt", "contractValue"];

  it("7 cột mới đều có trong schema VÀ có migration đi kèm", () => {
    // Cột khai trong schema mà không có migration = prod đổ ngay lượt đọc đầu tiên
    // ("column does not exist"), còn máy dev im ru vì Prisma Client sinh từ schema.
    const sql = fs.readFileSync(MIGRATION, "utf8");
    for (const o of [...COT_LEAD, ...COT_CON]) {
      expect(schema, `schema.prisma thiếu cột ${o}`).toContain(o);
      expect(sql, `migration thiếu ADD COLUMN "${o}"`).toContain(`ADD COLUMN "${o}"`);
    }
  });

  it("migration THUẦN THÊM — không DROP / không NOT NULL / không đổi kiểu", () => {
    const sql = fs
      .readFileSync(MIGRATION, "utf8")
      .split("\n")
      .filter((d) => !d.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/DROP\s/i);
    expect(sql).not.toMatch(/NOT NULL/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
    expect(sql).not.toMatch(/\bUPDATE\b/i); // không backfill đoán mò trong migration
  });

  it("5 ô mới KHÔNG lọt vào allowlist của người nhập phiếu", () => {
    // `INTAKE_EDITABLE_FIELDS` = đúng bộ ô của biểu mẫu /nhap-khach-hang. Mấy ô này
    // không có ở đó ⇒ mở ra là cấp thêm năng lực cho vai `edit-own-intake` mà không
    // ai quyết định. Allowlist phải hỏng theo chiều an toàn.
    const src = fs.readFileSync("app/(admin)/admin/leads/actions.ts", "utf8");
    const i = src.indexOf("const INTAKE_EDITABLE_FIELDS");
    expect(i).toBeGreaterThan(-1);
    const danhSach = src.slice(i, src.indexOf("] as const", i));
    for (const o of COT_LEAD) expect(danhSach).not.toContain(`'${o}'`);
  });

  it("MỐC CHỐT ghi TRONG transaction của đường chốt ghi danh, không phải lượt rời", () => {
    // Ghi rời sau commit là đẻ khe "đã ghi danh nhưng chưa có mốc chốt", và khe đó
    // không có job nào đối soát — nó chỉ hiện ra dưới dạng số báo cáo thấp hơn thực.
    const src = fs.readFileSync("lib/crm/convert-lead-v2.ts", "utf8");
    const moTx = src.indexOf("db.$transaction");
    const noiGhi = src.indexOf("tx.leadChild.updateMany");
    expect(moTx).toBeGreaterThan(-1);
    expect(noiGhi).toBeGreaterThan(moTx);
    // Đúng `tx.` chứ không phải `db.` — `db.` là ra ngoài transaction.
    expect(src).not.toContain("db.leadChild.updateMany");
    // Chặn ghi nhầm sang con của phiếu khác (bulk-convert nhận dữ liệu từ file).
    expect(src.slice(noiGhi, noiGhi + 400)).toContain("leadId: lead.id");
  });

  it("con từng RỚT nay vào học → lý do rớt của phiếu đi qua ĐÚNG hàm quyết định C-06", () => {
    // Đặt `status = ENROLLED` cho một đứa đang `LOST` có thể làm `Lead.lostNote` hết
    // chỗ bám. Xoá vô điều kiện là xoá mất lý do rớt của ĐỨA CÒN LẠI (bẫy B5), nên
    // phải đếm số con còn rớt rồi để `decideLeadLostFields` quyết — không tự xử tại chỗ.
    const src = fs.readFileSync("lib/crm/convert-lead-v2.ts", "utf8");
    expect(src).toContain("decideLeadLostFields");
    expect(src).toContain('intent: "unmark"');
    expect(src).toMatch(/status:\s*"LOST"/);
  });

  it("`Order.leadChildId` vẫn theo luật MỘT ĐƠN – MỘT CON, không bị mốc chốt kéo theo", () => {
    // Hai luật khác nhau có chủ đích: tiền của một đơn chung không chia được cho hai
    // đứa (B4), nhưng "đứa này đã thành học viên" thì cả hai đều đúng.
    const src = fs.readFileSync("lib/crm/convert-lead-v2.ts", "utf8");
    expect(src).toContain("inferLeadChildIdForConvert");
    expect(src).toContain("resolveClosedLeadChildIds");
  });
});
