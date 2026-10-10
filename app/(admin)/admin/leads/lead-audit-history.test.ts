// @vitest-environment node
/**
 * V-6 · G-02 — sửa lead thì phải CÒN VẾT, và người có thẩm quyền phải ĐỌC ĐƯỢC vết đó.
 *
 * Spec G-02: 3 ô định danh (Tên PH · SĐT PH · Tên HS) sale sửa được, nhưng "bắt
 * buộc ghi audit log (ai sửa, lúc nào, giá trị cũ → mới), hiển thị ở trang chi
 * tiết lead". Hai nửa của câu đó đang hỏng, mỗi nửa một kiểu:
 *
 * (a) GHI — `updateLeadFields` ghi lead bằng `db.lead.update` TRẦN rồi mới
 *     `logLeadAudit(...).catch(() => {})` ở NGOÀI. Hai lệnh không cùng số phận:
 *     lệnh ghi vết hỏng thì bản ghi VẪN lưu, và lỗi bị `.catch` nuốt sạch. Kết
 *     quả đúng bằng thứ spec cấm: tên/SĐT đổi mà không còn vết nào, không ai
 *     biết là đã mất vết. Anh em cùng file `updateLeadChild` đã làm ĐÚNG từ
 *     08/08 (audit nằm trong `db.$transaction`, chú thích ghi rõ "KHÔNG .catch()
 *     nuốt lỗi ở đây nữa") — nên đây là chỗ bị bỏ sót, không phải chủ ý.
 *
 * (b) ĐỌC — trang chi tiết lead KHÔNG có mục lịch sử nào. Vết chỉ vào bảng
 *     `AuditLog`, mà trình xem duy nhất (`/admin/audit-log`) gác sau
 *     `audit-logs:view` — quyền này CHỈ SUPER_ADMIN có (v1: lib/auth/permissions.ts;
 *     v2: prisma/seed-roles.ts còn nguyên đoạn chú thích "#05 QL cơ sở xem audit
 *     log" nhưng KHÔNG còn dòng RolePermission nào). Tức QLCS — đúng người cần
 *     soi sale có sửa trộm tên khách không — không xem được gì.
 *
 * ⚠️ Ranh giới của bản vá (b): `AuditLog` KHÔNG nằm trong `SCOPED_MODELS` ⇒
 * `scopedDb` KHÔNG lọc hộ. Mở nhật ký bằng một quyền GLOBAL là mở nhật ký TOÀN
 * HỆ, kể cả module ngoài lead. Vì vậy màn này phải LỌC CỨNG theo đúng bản ghi
 * lead đang mở (`entityType: "Lead"` + `entityId` của chính lead đó), và tuyệt
 * đối không nhận bộ lọc từ người gọi. Các ca dưới canh đúng ranh giới đó.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

// ─── Phần 1: harness cho `updateLeadFields` (đường GHI) ──────────────────────
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  canViewLeadPii: vi.fn(),
  leadUpdate: vi.fn(),
  leadFindFirst: vi.fn(),
  leadFindUnique: vi.fn(),
  transaction: vi.fn(),
  logLeadAudit: vi.fn(),
  centerIdForOrgUnit: vi.fn(),
  rejectHeadOffice: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
}));

/** Client giao dịch giả — cùng mock `leadUpdate` để ca test soi được `data`. */
const txClient = { lead: { update: h.leadUpdate } };

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
      update: h.leadUpdate,
      findFirst: h.leadFindFirst,
      findUnique: h.leadFindUnique,
    },
    leadChild: { findUnique: vi.fn() },
    trialEnrollment: { count: vi.fn() },
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

import { updateLeadFields } from "./actions";
import {
  LEAD_IDENTITY_FIELDS,
  canViewLeadAuditHistory,
  getLeadAuditHistory,
  maskLeadAuditValues,
  touchesLeadIdentity,
} from "@/lib/lead/audit-history";
import { MASKED_TEXT } from "@/lib/lead/pii";

const TRUOC = {
  id: "lead-cu",
  parentName: "Nguyễn Thị Lan",
  phone: "0905123456",
  email: null,
  childName: "Nguyễn Minh Bảo",
  childAge: null,
  centerId: "cs1",
  orgUnitId: "ou-cs1",
  courseId: null,
  source: "Facebook",
  note: null,
  facebookUrl: null,
  assignedToId: "u-sale",
  createdById: "u-sale",
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ user: { id: "u-sale", centerId: "cs1" } });
  h.checkPermission.mockResolvedValue(true);
  h.canViewLeadPii.mockResolvedValue(true);
  h.leadFindFirst.mockResolvedValue(null); // không trùng SĐT
  h.leadFindUnique.mockResolvedValue(TRUOC);
  h.leadUpdate.mockResolvedValue({ id: "lead-cu" });
  h.logLeadAudit.mockResolvedValue(undefined);
  h.centerIdForOrgUnit.mockResolvedValue("cs1");
  h.rejectHeadOffice.mockResolvedValue(null);
  h.resolveActor.mockResolvedValue({ userId: "u-sale" });
  h.passesScope.mockReturnValue(true);
  // Giao dịch thật của Prisma trao client `tx` cho callback; ta trao client giả.
  h.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txClient));
});

describe("[V-6 G-02a] updateLeadFields — ghi vết đi CÙNG giao dịch với lượt sửa", () => {
  it("sửa ô định danh → lượt ghi lead nằm TRONG `db.$transaction`", async () => {
    const res = await updateLeadFields("lead-cu", { parentName: "Nguyễn Thị Lan Anh" });

    expect(res.ok).toBe(true);
    expect(h.transaction).toHaveBeenCalledTimes(1);
    // Lệnh ghi phải đi qua client của giao dịch, không phải `db` trần.
    expect(h.leadUpdate).toHaveBeenCalledTimes(1);
  });

  it("`logLeadAudit` nhận ĐÚNG client `tx` của giao dịch đó (không phải lệnh rời)", async () => {
    await updateLeadFields("lead-cu", { parentName: "Nguyễn Thị Lan Anh" });

    expect(h.logLeadAudit).toHaveBeenCalledTimes(1);
    const ghi = h.logLeadAudit.mock.calls[0][0] as { tx?: unknown; changedFields?: string[] };
    expect(ghi.tx).toBe(txClient);
    expect(ghi.changedFields).toEqual(["parentName"]);
  });

  it("ghi vết HỎNG → cả giao dịch đổ, action báo lỗi (không lưu lặng lẽ)", async () => {
    h.logLeadAudit.mockRejectedValue(new Error("audit down"));

    const res = await updateLeadFields("lead-cu", { phone: "0905999888" });

    // Trước bản vá: `.catch(() => {})` nuốt lỗi ⇒ `{ ok: true }` mà không còn vết.
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("SĐT đổi + đúng 1 giao dịch cho cả hai lệnh (không mở giao dịch thứ hai)", async () => {
    await updateLeadFields("lead-cu", { phone: "0905999888" });

    expect(h.transaction).toHaveBeenCalledTimes(1);
    const ghi = h.logLeadAudit.mock.calls[0][0] as {
      oldValues: Record<string, unknown>;
      newValues: Record<string, unknown>;
    };
    expect(ghi.oldValues.phone).toBe("0905123456");
    expect(ghi.newValues.phone).toBe("84905999888"); // zod chuẩn hoá về dạng 84…
  });

  it("không đổi gì → không ghi vết rỗng, nhưng vẫn chỉ 1 giao dịch", async () => {
    await updateLeadFields("lead-cu", { parentName: "Nguyễn Thị Lan" });

    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.logLeadAudit).not.toHaveBeenCalled();
  });
});

describe("[V-6 G-02a] chốt chặn nguồn — đừng gỡ ngược lại", () => {
  const src = fs.readFileSync("app/(admin)/admin/leads/actions.ts", "utf8");
  /** Bỏ chú thích rồi mới quét: chú thích GIẢI THÍCH lỗi cũ có nhắc đúng chuỗi này. */
  const boChuThich = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const than = (() => {
    const i = src.indexOf("export async function updateLeadFields");
    const j = src.indexOf("export async function autoAssignNewLeadAction");
    return boChuThich(src.slice(i, j > i ? j : i + 6000));
  })();

  it("thân `updateLeadFields` KHÔNG còn `logLeadAudit(...).catch(` nuốt lỗi", () => {
    expect(than).toContain("logLeadAudit");
    expect(/logLeadAudit\([\s\S]*?\)\s*\.catch\(/.test(than)).toBe(false);
  });

  it("thân `updateLeadFields` có mở `db.$transaction`", () => {
    expect(than).toContain("db.$transaction");
  });
});

// ─── Phần 2: đường ĐỌC — cổng quyền + lọc cứng + che PII ─────────────────────
describe("[V-6 G-02b] canViewLeadAuditHistory — ai được xem vết", () => {
  it("QLCS (leads:view-all) xem được — đây là người spec nhắm tới", () => {
    expect(canViewLeadAuditHistory({ canViewAllLeads: true, canViewAuditLogs: false })).toBe(true);
  });

  it("người giữ `audit-logs:view` xem được (kiểm toán/BGĐ)", () => {
    expect(canViewLeadAuditHistory({ canViewAllLeads: false, canViewAuditLogs: true })).toBe(true);
  });

  it("sale thường (chỉ leads:view-own) KHÔNG xem được — không tự xoá dấu của mình", () => {
    expect(canViewLeadAuditHistory({ canViewAllLeads: false, canViewAuditLogs: false })).toBe(false);
  });
});

describe("[V-6 G-02b] getLeadAuditHistory — LỌC CỨNG theo đúng lead đang mở", () => {
  const rows = [
    {
      id: "a2",
      createdAt: new Date("2026-08-24T03:00:00.000Z"),
      actorName: "Sale CS1",
      action: "lead.update",
      changedFields: ["parentName"],
      reason: null,
      oldValues: { parentName: "Nguyễn Thị Lan" },
      newValues: { parentName: "Nguyễn Thị Lan Anh" },
    },
    {
      id: "a1",
      createdAt: new Date("2026-08-23T03:00:00.000Z"),
      actorName: "Sale CS1",
      action: "lead.create",
      changedFields: [],
      reason: null,
      oldValues: null,
      newValues: { source: "Facebook" },
    },
  ];
  const findMany = vi.fn(async (_args: unknown) => rows);
  const sdb = { auditLog: { findMany } } as unknown as Parameters<typeof getLeadAuditHistory>[0];

  beforeEach(() => findMany.mockClear());

  it("`where` chỉ có đúng entityType Lead + entityId của lead đang mở", async () => {
    await getLeadAuditHistory(sdb, "lead-cu");

    const arg = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toEqual({ entityType: "Lead", entityId: "lead-cu" });
  });

  it("KHÔNG lọc thêm theo orgUnitId — dòng cũ orgUnitId null sẽ biến mất khỏi vết", async () => {
    await getLeadAuditHistory(sdb, "lead-cu");

    const arg = findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect("orgUnitId" in arg.where).toBe(false);
  });

  it("mới nhất lên trước + có trần số dòng (không kéo cả nghìn dòng ra trang)", async () => {
    await getLeadAuditHistory(sdb, "lead-cu");

    const arg = findMany.mock.calls[0][0] as {
      orderBy: unknown;
      take: number;
    };
    expect(arg.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    expect(arg.take).toBeGreaterThan(0);
    expect(arg.take).toBeLessThanOrEqual(200);
  });

  it("`take` do người gọi đưa vẫn bị kẹp trần", async () => {
    await getLeadAuditHistory(sdb, "lead-cu", { take: 5000 });

    const arg = findMany.mock.calls[0][0] as { take: number };
    expect(arg.take).toBeLessThanOrEqual(200);
  });

  it("dòng trả ra đánh dấu lượt chạm ô ĐỊNH DANH (3 ô của spec G-02)", async () => {
    const out = await getLeadAuditHistory(sdb, "lead-cu");

    expect(out).toHaveLength(2);
    expect(out[0].touchesIdentity).toBe(true);
    expect(out[1].touchesIdentity).toBe(false);
    expect(typeof out[0].createdAt).toBe("string"); // đã tuần tự hoá để xuống client
  });
});

describe("[V-6 G-02b] touchesLeadIdentity — đúng 3 ô spec chốt", () => {
  it("3 ô định danh là Tên PH · SĐT PH · Tên HS", () => {
    expect([...LEAD_IDENTITY_FIELDS].sort()).toEqual(["childName", "parentName", "phone"]);
  });

  it("đổi nguồn/ghi chú không phải chạm định danh", () => {
    expect(touchesLeadIdentity(["source", "note"])).toBe(false);
    expect(touchesLeadIdentity(["note", "phone"])).toBe(true);
  });
});

describe("[V-6 G-02b] maskLeadAuditValues — vết cũng là PII, không được hở", () => {
  const vet = {
    parentName: "Nguyễn Thị Lan",
    phone: "0905123456",
    email: "lan.nguyen@gmail.com",
    childName: "Nguyễn Minh Bảo",
    note: "PH hẹn gọi lại tối",
    childAdded: "Nguyễn Minh Khôi",
    source: "Facebook",
  };

  it("có quyền xem PII → trả nguyên văn", () => {
    expect(maskLeadAuditValues(vet, true)).toEqual(vet);
  });

  it("không có quyền → che tên PH / SĐT / email / tên HS / ghi chú", () => {
    const out = maskLeadAuditValues(vet, false)!;

    expect(out.parentName).not.toBe(vet.parentName);
    expect(out.phone).not.toBe(vet.phone);
    expect(out.email).not.toBe(vet.email);
    expect(out.childName).not.toBe(vet.childName);
    expect(out.note).toBe(MASKED_TEXT);
  });

  it("tên con trong vết thêm/xoá/sửa con cũng bị che (đừng chỉ che cột `childName`)", () => {
    const out = maskLeadAuditValues(vet, false)!;

    expect(out.childAdded).not.toBe("Nguyễn Minh Khôi");
  });

  it("ô KHÔNG phải PII giữ nguyên — che sạch thì vết mất hết công dụng", () => {
    const out = maskLeadAuditValues(vet, false)!;

    expect(out.source).toBe("Facebook");
  });

  it("null vào → null ra", () => {
    expect(maskLeadAuditValues(null, false)).toBeNull();
  });
});

describe("[V-6 G-02b] chốt chặn nguồn — trang chi tiết lead", () => {
  const src = fs.readFileSync("app/(admin)/admin/leads/[id]/page.tsx", "utf8");

  it("trang có nạp lịch sử thay đổi của CHÍNH lead đang mở", () => {
    expect(src).toContain("getLeadAuditHistory");
    expect(src).toContain("canViewLeadAuditHistory");
  });

  it("KHÔNG mở trình xem nhật ký chung trên trang lead", () => {
    // `queryUnifiedAuditLogs` đọc CẢ bảng AuditLog theo bộ lọc tự do — dùng ở đây
    // là biến trang lead thành cửa hậu vào nhật ký toàn hệ.
    expect(src).not.toContain("queryUnifiedAuditLogs");
  });

  it("vết được che PII theo cùng cổng `canViewPii` của trang", () => {
    expect(src).toContain("maskLeadAuditValues");
  });
});
