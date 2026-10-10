// A0-04 — scopedDb: inject/passesScope (THUẦN) + introspection chống miss model.
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import {
  injectScope,
  injectSoftDelete,
  passesScope,
  SCOPED_MODELS,
  getModelPrefixes,
  SCOPE_EXEMPT,
  SOFT_DELETE_MODELS,
  isMakeupExceptionModel,
  MAKEUP_EXCEPTION_MODELS,
} from "@/lib/db-scope";
import { buildActor } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";

const ORG: OrgUnitNode[] = [
  { id: "root", code: "SATAROBO", type: "ROOT", parentId: null, centerId: null },
  { id: "ho", code: "HO", type: "HO", parentId: "root", centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "root", centerId: "c1" },
  { id: "cs2", code: "CS2", type: "CENTER", parentId: "root", centerId: "c2" },
];
const row = (
  orgUnitId: string,
  code: string,
  permissions: { action: string; scopeType: "GLOBAL" | "CENTER" | "CLASS" | "OWN" | "CHILDREN" | "ASSIGNED" }[] = []
) => ({
  orgUnitId, status: "ACTIVE", effectiveFrom: new Date("2000-01-01"), effectiveTo: null,
  role: { code, isActive: true, permissions },
});
const make = (rows: ReturnType<typeof row>[]) => buildActor({ userId: "u1", rows, orgNodes: ORG });

const center = make([
  row("cs1", "CENTER_MANAGER", [
    { action: "leads:view-all", scopeType: "CENTER" },
    { action: "orders:view", scopeType: "CENTER" },
  ]),
]); // visible [c1]
const ho = make([
  row("ho", "HO_ACCOUNTANT", [
    { action: "payments:manage", scopeType: "CENTER" },
    { action: "leads:view-all", scopeType: "CENTER" },
    { action: "orders:view", scopeType: "CENTER" },
  ]),
]); // isHoLevel
const sa = make([row("ho", "SUPER_ADMIN")]); // isSuperAdmin
const noCenter = make([]); // visible []

describe("[A0-04] injectScope", () => {
  it("center user → thêm where centerId IN [visible]", () => {
    expect(injectScope("Lead", {}, center)).toEqual({ where: { centerId: { in: ["c1"] } } });
  });

  it("giữ where cũ qua AND", () => {
    expect(injectScope("Lead", { where: { status: "NEW" } }, center)).toEqual({
      where: { AND: [{ status: "NEW" }, { centerId: { in: ["c1"] } }] },
    });
  });

  it("[A0-04-T10-03] where rỗng cố lấy tất cả → vẫn bị AND scope", () => {
    const r = injectScope("Lead", { where: {} }, center) as { where: unknown };
    expect(r.where).toEqual({ AND: [{}, { centerId: { in: ["c1"] } }] });
  });

  it("SUPER_ADMIN / HO → không inject (cross-center)", () => {
    expect(injectScope("Lead", {}, sa)).toEqual({});
    expect(injectScope("Lead", {}, ho)).toEqual({});
  });

  it("[A0-04-T1-01] model không scope (RoleDef) → không inject (AC9)", () => {
    expect(injectScope("RoleDef", {}, center)).toEqual({});
  });

  it("[A0-04-T8-01] visibleCenterIds rỗng → centerId IN [] (list rỗng, không lộ)", () => {
    expect(injectScope("Lead", {}, noCenter)).toEqual({ where: { centerId: { in: [] } } });
  });
});

// FL3-02 — Enrollment + ClassSession flip SCOPE_EXEMPT → SCOPED_MODELS.
const enrollClerk = make([
  row("cs1", "SALES_CSM", [
    { action: "enrollments:view-all", scopeType: "CENTER" },
    { action: "sessions:view", scopeType: "CENTER" },
  ]),
]); // visible [c1], có perm enrollments: + sessions:

describe("[FL3-02] Enrollment + ClassSession auto-scope (flip EXEMPT→SCOPED)", () => {
  it("Enrollment + ClassSession nằm trong SCOPED_MODELS, không còn trong SCOPE_EXEMPT", () => {
    expect(SCOPED_MODELS.has("Enrollment")).toBe(true);
    expect(SCOPED_MODELS.has("ClassSession")).toBe(true);
    expect(SCOPE_EXEMPT.has("Enrollment")).toBe(false);
    expect(SCOPE_EXEMPT.has("ClassSession")).toBe(false);
  });

  it("Attendance ∈ SCOPED_MODELS (flip #04), không còn exempt", () => {
    expect(SCOPED_MODELS.has("Attendance")).toBe(true);
    expect(SCOPE_EXEMPT.has("Attendance")).toBe(false);
  });

  it("injectScope(Attendance) — center-actor không HO → centerId IN visibleCenterIds", () => {
    expect(injectScope("Attendance", {}, enrollClerk)).toEqual({
      where: { centerId: { in: ["c1"] } },
    });
  });

  it("injectScope(Enrollment) — clerk có perm enrollments: → centerId IN [c1]", () => {
    expect(injectScope("Enrollment", {}, enrollClerk)).toEqual({
      where: { centerId: { in: ["c1"] } },
    });
  });

  it("injectScope(ClassSession) — clerk có perm sessions: → centerId IN [c1]", () => {
    expect(injectScope("ClassSession", {}, enrollClerk)).toEqual({
      where: { centerId: { in: ["c1"] } },
    });
  });

  it("injectScope giữ where cũ qua AND (Enrollment)", () => {
    expect(
      injectScope("Enrollment", { where: { status: "STUDYING" } }, enrollClerk),
    ).toEqual({ where: { AND: [{ status: "STUDYING" }, { centerId: { in: ["c1"] } }] } });
  });

  it("actor center KHÔNG có perm enrollments: → fallback visibleCenterIds (vẫn cách ly)", () => {
    // `center` chỉ có leads:/orders: → prefix enrollments: không khớp → fallback [c1].
    expect(injectScope("Enrollment", {}, center)).toEqual({
      where: { centerId: { in: ["c1"] } },
    });
  });

  it("SUPER_ADMIN / HO → không inject (cross-center)", () => {
    expect(injectScope("Enrollment", {}, sa)).toEqual({});
    expect(injectScope("ClassSession", {}, sa)).toEqual({});
    expect(injectScope("Enrollment", {}, ho)).toEqual({});
    expect(injectScope("ClassSession", {}, ho)).toEqual({});
  });

  it("passesScope (IDOR) — record khác cơ sở → false, cùng cơ sở → true", () => {
    expect(passesScope("Enrollment", { centerId: "c2" }, enrollClerk)).toBe(false);
    expect(passesScope("Enrollment", { centerId: "c1" }, enrollClerk)).toBe(true);
    expect(passesScope("ClassSession", { centerId: "c2" }, enrollClerk)).toBe(false);
    expect(passesScope("ClassSession", { centerId: null }, enrollClerk)).toBe(false);
    expect(passesScope("Enrollment", { centerId: "c2" }, sa)).toBe(true); // SA bypass
  });

  it("ClassSession SCOPED bình thường NHƯNG vẫn ∈ MAKEUP_EXCEPTION (đọc chéo khi học bù)", () => {
    expect(SCOPED_MODELS.has("ClassSession")).toBe(true);
    expect(isMakeupExceptionModel("ClassSession")).toBe(true);
    // Enrollment KHÔNG trong makeup exception → luôn cách ly, kể cả luồng học bù.
    expect(isMakeupExceptionModel("Enrollment")).toBe(false);
  });
});

describe("[FIX-C3] injectSoftDelete", () => {
  it("model tài chính, where rỗng → thêm deletedAt: null (ẩn row đã xóa)", () => {
    expect(injectSoftDelete("Order", {})).toEqual({ where: { deletedAt: null } });
    expect(injectSoftDelete("Payment", {})).toEqual({ where: { deletedAt: null } });
    expect(injectSoftDelete("Receipt", {})).toEqual({ where: { deletedAt: null } });
    expect(injectSoftDelete("Enrollment", {})).toEqual({ where: { deletedAt: null } });
  });

  it("giữ where cũ qua AND", () => {
    expect(injectSoftDelete("Order", { where: { status: "PAID" } })).toEqual({
      where: { AND: [{ status: "PAID" }, { deletedAt: null }] },
    });
  });

  it("call-site cố ý đọc trash (deletedAt đề cập) → KHÔNG override", () => {
    expect(injectSoftDelete("Order", { where: { deletedAt: { not: null } } })).toEqual({
      where: { deletedAt: { not: null } },
    });
    // include cả đã xóa
    expect(injectSoftDelete("Order", { where: { deletedAt: undefined } })).toEqual({
      where: { deletedAt: undefined },
    });
  });

  it("model không soft-delete → không đụng", () => {
    expect(injectSoftDelete("Lead", {})).toEqual({});
    expect(injectSoftDelete("Student", { where: { status: "ACTIVE" } })).toEqual({
      where: { status: "ACTIVE" },
    });
  });

  it("SOFT_DELETE_MODELS đúng 4 model tài chính", () => {
    expect([...SOFT_DELETE_MODELS].sort()).toEqual(
      ["Enrollment", "Order", "Payment", "Receipt"].sort(),
    );
  });
});

describe("[A0-04] passesScope (IDOR findUnique)", () => {
  it("center: record cùng center true, khác center false", () => {
    expect(passesScope("Lead", { centerId: "c1" }, center)).toBe(true);
    expect(passesScope("Lead", { centerId: "c2" }, center)).toBe(false);
  });
  it("[R7-00-AC4] Order/Lead chéo cơ sở → false (chặn IDOR sửa-theo-id)", () => {
    // CM@CS1 thao tác record CS2 bằng id → bị chặn ở tầng passesScope.
    expect(passesScope("Order", { centerId: "c2" }, center)).toBe(false);
    expect(passesScope("Order", { centerId: "c1" }, center)).toBe(true);
    expect(passesScope("Order", { centerId: "c2" }, sa)).toBe(true); // SUPER_ADMIN bypass
  });
  it("[A0-04-T8-02] center: record centerId=null → false (an toàn)", () => {
    expect(passesScope("Lead", { centerId: null }, center)).toBe(false);
  });
  it("[A0-04-T8-03] HO: record centerId=null → true", () => {
    expect(passesScope("Lead", { centerId: null }, ho)).toBe(true);
  });
  it("SUPER_ADMIN: mọi record true", () => {
    expect(passesScope("Lead", { centerId: "c2" }, sa)).toBe(true);
  });
  it("model không scope → true", () => {
    expect(passesScope("RoleDef", { centerId: "c2" }, center)).toBe(true);
  });
  it("record null → false", () => {
    expect(passesScope("Lead", null, center)).toBe(false);
  });
});

describe("[A0-04-T12-01] introspection — mọi model có centerId đều được phân loại", () => {
  it("không model nào bị bỏ sót khỏi SCOPED_MODELS ∪ SCOPE_EXEMPT", () => {
    const withCenterId = Prisma.dmmf.datamodel.models
      .filter((m) => m.fields.some((f) => f.name === "centerId"))
      .map((m) => m.name);
    const categorized = new Set([...SCOPED_MODELS, ...SCOPE_EXEMPT]);
    const missed = withCenterId.filter((m) => !categorized.has(m));
    expect(missed).toEqual([]); // thêm model mới có centerId → phải đưa vào 1 trong 2 set
  });

  it("SCOPED_MODELS và SCOPE_EXEMPT rời nhau", () => {
    const overlap = [...SCOPED_MODELS].filter((m) => SCOPE_EXEMPT.has(m));
    expect(overlap).toEqual([]);
  });
});

describe("[R7-08-AC6] makeup exception KHÔNG rò sang query khác", () => {
  it("whitelist chỉ gồm model lịch/lớp/bù — Class & MakeupNeed được nới", () => {
    expect(isMakeupExceptionModel("Class")).toBe(true);
    expect(isMakeupExceptionModel("MakeupNeed")).toBe(true);
    expect(isMakeupExceptionModel("ClassSession")).toBe(true);
    expect(isMakeupExceptionModel("Lesson")).toBe(true);
  });

  it("Lead/Order/Student/Payment KHÔNG nằm trong exception → vẫn cách ly cơ sở", () => {
    for (const m of ["Lead", "Order", "Student", "Payment"]) {
      expect(isMakeupExceptionModel(m)).toBe(false);
      // Vẫn là model scoped → injectScope phải ép centerId IN [visible].
      expect(SCOPED_MODELS.has(m)).toBe(true);
      expect(injectScope(m, {}, center)).toEqual({ where: { centerId: { in: ["c1"] } } });
    }
  });

  it("không vô tình whitelist model nhạy cảm (Lead/Order/Student/Payment)", () => {
    const sensitive = ["Lead", "Order", "Student", "Payment"];
    const leaked = sensitive.filter((m) => MAKEUP_EXCEPTION_MODELS.has(m));
    expect(leaked).toEqual([]);
  });
});

/**
 * ⚠️ GUARD NÀY LẤP MỘT LỖ ĐÃ BIẾT.
 *
 * `getModelPrefixes()` quyết định đọc quyền nào để tính phạm vi cơ sở cho một
 * model. Quên khai một model `Trn*` ở đó thì nó rơi vào `default: return []` —
 * và hàm gọi hiểu là "không ràng buộc theo quyền nào", tức NỚI ra, không siết
 * lại. Bất kỳ ai có một vai neo tại Hội sở, kể cả vai chẳng liên quan đào tạo,
 * đọc được dữ liệu của mọi cơ sở.
 *
 * Trước guard này KHÔNG có test nào canh nhánh đó — và đây đúng là lỗi #04 từng
 * mắc với `Attendance`, chỉ khác tên bảng.
 */
describe("[EL-14] mọi model Trn* được scope đều khai tiền tố quyền", () => {
  it("không model `Trn*` nào rơi vào nhánh mặc định", () => {
    const thieu = [...SCOPED_MODELS]
      .filter((m) => m.startsWith("Trn"))
      .filter((m) => getModelPrefixes(m).length === 0);
    expect(thieu).toEqual([]);
  });

  it("và tiền tố ấy là `elearning:`", () => {
    for (const m of [...SCOPED_MODELS].filter((x) => x.startsWith("Trn"))) {
      expect(getModelPrefixes(m), m).toContain("elearning:");
    }
  });
});

// ── ZaloCRM (L1) — hai bảng ánh xạ hạ tầng ────────────────────────────────────
// Bộ [A0-04-T12-01] ở trên đã bắt "model có centerId mà chưa phân loại", nhưng nó
// chỉ nói "thiếu ai đó", không nói "xếp NHẦM chỗ". Xếp `ZaloCrmNick` vào
// SCOPED_MODELS mà quên `getModelPrefixes` là NỚI quyền diện rộng (lỗi #04 đã mắc
// thật với `Attendance`), nên chỗ nó thuộc về phải được ghim tường minh.
describe("[ZC-DB-01] hai bảng ZaloCrm* nằm ở SCOPE_EXEMPT, KHÔNG ở SCOPED_MODELS", () => {
  for (const model of ["ZaloCrmNick", "ZaloCrmThread"]) {
    it(`${model} — SCOPE_EXEMPT có, SCOPED_MODELS không`, () => {
      expect(SCOPE_EXEMPT.has(model), `${model} phải nằm trong SCOPE_EXEMPT`).toBe(true);
      expect(SCOPED_MODELS.has(model), `${model} KHÔNG được nằm trong SCOPED_MODELS`).toBe(
        false,
      );
    });

    // Hệ quả PHẢI NHỚ của việc ở SCOPE_EXEMPT: `injectScope` thoát ngay ở dòng đầu,
    // tức scopedDb KHÔNG lọc gì cho hai bảng này — cả đọc lẫn ghi phải tự gác theo
    // `actor.visibleCenterIds` (`lib/integrations/zalocrm/nick-admin.ts`). Ghim lại ở
    // đây để không ai đọc "đã khai vào db-scope" thành "đã được cách ly".
    it(`${model} — scopedDb KHÔNG chèn điều kiện centerId nào`, () => {
      expect(injectScope(model, {}, center)).toEqual({});
    });
  }
});
