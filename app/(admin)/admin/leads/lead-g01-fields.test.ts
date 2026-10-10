// @vitest-environment node
/**
 * G-01 — sáu ô còn thiếu của bộ thông tin khách hàng: NHẬP VÀO THÌ PHẢI ĐỌC RA.
 *
 * Năm ô ở cấp phụ huynh (`parentGender`, `parentDob`, `city`, `ward`,
 * `addressLine`) + một ô ở cấp con (`LeadChild.classId` — lớp đang học tại trung
 * tâm).
 *
 * Vì sao pin bằng test chứ không tin vào typecheck: đợt 1 của chính khu vực này
 * đã có đúng hai lỗi CHẢY MÁU DỮ LIỆU kiểu đó — `manualLeadSchema` khai
 * `facebookUrl` rồi `db.lead.create` không truyền xuống (V-3 · G-01a), và ô "Cơ
 * sở quan tâm" nạp picker bằng `OrgUnit.id` trong khi cột lưu `Center.id`
 * (V-4 · G-01b). Cả hai đều biên dịch sạch, đều trả `{ ok: true }`, và đều mất
 * dữ liệu không một dòng nhật ký.
 *
 * Ca cuối cùng canh chiều ngược: `before` của đường SỬA đọc bằng `select` hẹp.
 * Quên khai một cột ở đó thì phép so-lệch-để-ghi-nhật-ký luôn thấy
 * `undefined !== <giá trị>`, tức mọi lần bấm Lưu đều bịa ra một dòng "đã đổi địa
 * chỉ" dù không ai đụng vào ô đó — và nhật ký kiểm toán mất giá trị làm chứng.
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
vi.mock("next/cache", () => ({
  // 16/09/2026 — bản `main` của `actions.ts` dùng `unstable_cache`; mock thiếu nó là
  // cả tệp test chết ngay lúc nạp, không phải một ca đỏ.
  unstable_cache: <T,>(fn: T) => fn, revalidatePath: vi.fn() }));

import { createLeadManual, updateLeadFields, addLeadChild, updateLeadChild } from "./actions";

const PHIEU = { parentName: "Chị Hường", phone: "0905123456" };

const dataTao = () => h.leadCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
const daSua = () => h.leadUpdate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
const conMoi = () => h.childCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
const conSua = () => h.childUpdate.mock.calls[0]?.[0]?.data as Record<string, unknown>;

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
});

describe("[G-01] createLeadManual — 5 ô cấp phụ huynh xuống được DB", () => {
  it("nhập đủ → `db.lead.create` nhận đúng cả 5 ô", async () => {
    const res = await createLeadManual({
      ...PHIEU,
      parentGender: "FEMALE",
      parentDob: "1985-03-12",
      city: "Đà Nẵng",
      ward: "Phường Hải Châu",
      addressLine: "12 Lê Lợi",
    });

    expect(res.ok).toBe(true);
    const d = dataTao();
    expect(d.parentGender).toBe("FEMALE");
    expect(d.parentDob).toBeInstanceOf(Date);
    expect((d.parentDob as Date).toISOString().slice(0, 10)).toBe("1985-03-12");
    expect(d.city).toBe("Đà Nẵng");
    expect(d.ward).toBe("Phường Hải Châu");
    expect(d.addressLine).toBe("12 Lê Lợi");
  });

  it("bỏ trống → null hết, KHÔNG đẻ chuỗi rỗng", async () => {
    // Chuỗi rỗng làm hỏng mọi `if (lead.city)` và mọi truy vấn `city: { not: null }`
    // — đúng câu truy vấn mà PRD dùng để đo "địa chỉ đã ra khỏi note chưa".
    await createLeadManual({
      ...PHIEU,
      city: "",
      ward: "",
      addressLine: "",
      parentGender: "",
      parentDob: "",
    });

    const d = dataTao();
    expect(d.city).toBeNull();
    expect(d.ward).toBeNull();
    expect(d.addressLine).toBeNull();
    expect(d.parentGender).toBeNull();
    expect(d.parentDob).toBeNull();
  });

  it("không gửi ô nào → vẫn tạo được lead (cả 5 đều không bắt buộc)", async () => {
    const res = await createLeadManual({ ...PHIEU });
    expect(res.ok).toBe(true);
    expect(dataTao().city).toBeNull();
    expect(dataTao().parentDob).toBeNull();
  });

  it("ngày sinh ở TƯƠNG LAI → từ chối cả phiếu", async () => {
    const maiSau = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await createLeadManual({ ...PHIEU, parentDob: maiSau });

    expect(res.ok).toBe(false);
    expect(h.leadCreate).not.toHaveBeenCalled();
  });

  it("giới tính lạ (chuỗi tự do) → từ chối, không lọt giá trị ngoài enum xuống DB", async () => {
    const res = await createLeadManual({ ...PHIEU, parentGender: "Nam" });

    expect(res.ok).toBe(false);
    expect(h.leadCreate).not.toHaveBeenCalled();
  });
});

describe("[G-01] updateLeadFields — đường SỬA", () => {
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
    parentGender: null,
    parentDob: null,
    city: null,
    ward: null,
    addressLine: null,
    assignedToId: "u-sale",
    createdById: "u-sale",
  };

  beforeEach(() => {
    h.leadFindUnique.mockResolvedValue(TRUOC);
  });

  it("sửa địa chỉ → `db.lead.update` nhận đủ 3 mẩu", async () => {
    const res = await updateLeadFields("lead-cu", {
      city: "Đà Nẵng",
      ward: "Phường Hải Châu",
      addressLine: "12 Lê Lợi",
    });

    expect(res.ok).toBe(true);
    expect(daSua().city).toBe("Đà Nẵng");
    expect(daSua().ward).toBe("Phường Hải Châu");
    expect(daSua().addressLine).toBe("12 Lê Lợi");
  });

  it("xoá trắng ô → ghi null (gỡ được địa chỉ sai, không kẹt vĩnh viễn)", async () => {
    h.leadFindUnique.mockResolvedValue({ ...TRUOC, city: "Hà Nội" });

    await updateLeadFields("lead-cu", { city: "" });

    expect(daSua().city).toBeNull();
  });

  it("không đụng ô → KHÔNG đưa vào lệnh ghi (đừng đè trắng dữ liệu người khác nhập)", async () => {
    h.leadFindUnique.mockResolvedValue({
      ...TRUOC,
      city: "Đà Nẵng",
      parentDob: new Date("1985-03-12"),
    });

    await updateLeadFields("lead-cu", { parentName: "Chị Hường A" });

    const d = daSua();
    expect("city" in d).toBe(false);
    expect("ward" in d).toBe(false);
    expect("addressLine" in d).toBe(false);
    expect("parentGender" in d).toBe(false);
    expect("parentDob" in d).toBe(false);
  });

  it("lưu lại ĐÚNG ngày sinh cũ → KHÔNG bịa ra một dòng nhật ký 'đã đổi'", async () => {
    // `Date` so bằng `!==` là so tham chiếu: hai đối tượng cùng mốc thời gian vẫn
    // khác nhau. Không xử lý thì mỗi lần bấm Lưu lại đẻ một bản ghi kiểm toán rỗng
    // ruột (giá trị cũ = giá trị mới), và nhật ký mất giá trị làm chứng.
    h.leadFindUnique.mockResolvedValue({
      ...TRUOC,
      parentDob: new Date("1985-03-12T00:00:00.000Z"),
    });

    await updateLeadFields("lead-cu", { parentDob: "1985-03-12" });

    expect(h.logLeadAudit).not.toHaveBeenCalled();
  });

  it("đổi sang ngày sinh KHÁC → vẫn ghi nhật ký", async () => {
    h.leadFindUnique.mockResolvedValue({
      ...TRUOC,
      parentDob: new Date("1985-03-12T00:00:00.000Z"),
    });

    await updateLeadFields("lead-cu", { parentDob: "1990-01-01" });

    expect(h.logLeadAudit).toHaveBeenCalledTimes(1);
    const ghi = h.logLeadAudit.mock.calls[0][0] as { changedFields: string[] };
    expect(ghi.changedFields).toContain("parentDob");
  });
});

describe("[G-01] LeadChild.classId — lớp đang học tại trung tâm", () => {
  it("addLeadChild ghi được `classId`", async () => {
    h.leadFindUnique.mockResolvedValue({ id: "lead-1", centerId: "cs1" });

    const res = await addLeadChild({ leadId: "lead-1", fullName: "Bé Bin", classId: "class-9" });

    expect(res.ok).toBe(true);
    expect(conMoi().classId).toBe("class-9");
  });

  it("addLeadChild không khai lớp → null (chưa xếp lớp, không phải lớp rỗng)", async () => {
    h.leadFindUnique.mockResolvedValue({ id: "lead-1", centerId: "cs1" });

    await addLeadChild({ leadId: "lead-1", fullName: "Bé Bin" });

    expect(conMoi().classId).toBeNull();
  });

  it("updateLeadChild đổi được lớp, và gỡ được về null", async () => {
    h.childFindUnique.mockResolvedValue({
      id: "con-cu",
      leadId: "lead-1",
      fullName: "Bé Bin",
      interestedCourseId: null,
      lead: { centerId: "cs1", courseId: null },
    });

    await updateLeadChild("con-cu", { fullName: "Bé Bin", classId: "class-9" });
    expect(conSua().classId).toBe("class-9");

    h.childUpdate.mockClear();
    await updateLeadChild("con-cu", { fullName: "Bé Bin", classId: "" });
    expect((h.childUpdate.mock.calls[0]?.[0]?.data as Record<string, unknown>).classId).toBeNull();
  });
});

describe("[G-01] chốt chặn nguồn — mấy chỗ không được lệch nhau", () => {
  const MIGRATION = "prisma/migrations/20260826140000_g01_lead_customer_fields/migration.sql";
  const src = fs.readFileSync("app/(admin)/admin/leads/actions.ts", "utf8");
  const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
  const CAC_O = ["parentGender", "parentDob", "city", "ward", "addressLine"] as const;

  it("`before` của đường SỬA select đủ 5 ô (nếu thiếu, nhật ký bịa ra thay đổi)", () => {
    const i = src.indexOf("export async function updateLeadFields");
    expect(i).toBeGreaterThan(-1);
    const than = src.slice(i, i + 3500);
    for (const o of CAC_O) expect(than).toContain(`${o}: true`);
  });

  it("6 cột mới đều có trong schema VÀ có migration đi kèm", () => {
    // Cột khai trong schema mà không có migration = prod đổ ngay lượt đọc đầu
    // tiên ("column does not exist"), còn máy dev thì im ru vì Prisma Client sinh
    // từ schema chứ không từ DB.
    const sql = fs.readFileSync(MIGRATION, "utf8");
    for (const o of [...CAC_O, "classId"]) {
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
  });

  it("5 ô mới KHÔNG lọt vào allowlist của người nhập phiếu", () => {
    // `INTAKE_EDITABLE_FIELDS` = đúng bộ ô của biểu mẫu /nhap-khach-hang. Mấy ô
    // này không có ở đó, nên mở ra là cấp thêm năng lực cho vai `edit-own-intake`
    // mà không ai quyết định — allowlist phải hỏng theo chiều an toàn.
    const i = src.indexOf("const INTAKE_EDITABLE_FIELDS");
    expect(i).toBeGreaterThan(-1);
    const danhSach = src.slice(i, src.indexOf("] as const", i));
    for (const o of CAC_O) expect(danhSach).not.toContain(`'${o}'`);
  });
});
