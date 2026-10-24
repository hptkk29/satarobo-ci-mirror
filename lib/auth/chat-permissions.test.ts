// US-05 — Bộ test ma trận quyền chat, TẦNG TĨNH (pure, không DB — chạy mọi nơi kể cả
// CI unit-tests). "Người review thứ hai" chặn merge (pre-mortem T2).
//
// Nguồn sự thật: docs/chat-realtime/permissions.md (ma trận resource × operation × vai)
// + delta docs/chat-realtime/00-dieu-chinh-cho-repo.md mục D (ánh xạ vai) + E.2 (bộ action).
//
// Mỗi Ô của ma trận được dịch thành ≥1 assertion, chạy trên CẢ HAI tầng RBAC:
//   - v1: can(role, action) — matrix tĩnh lib/auth/permissions.ts (đang chạy local/dev).
//   - v2: can(actor, action, target) — lib/auth/can.ts với actor dựng từ CHÍNH
//     prisma/seed-roles.ts (test pin luôn nội dung seed, không hand-copy mock).
//
// Mã ô ghi cạnh assertion để truy vết: [TS-xx.y] = TestScenarios-chat-realtime;
// [MTX-...] = hàng/cột trong permissions.md không có số TS riêng.
//
// LƯU Ý PHẠM VI TẦNG TĨNH: can() chỉ gate VAI + SCOPE (ASSIGNED/CENTER/OWN...).
// Các điều kiện "participant hiệu lực", "≤15 phút", "bắt buộc lý do", "ARCHIVED/LOCKED"
// là việc của Server Action — pin ở tầng động tests/chat/permission-matrix.spec.ts.
import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { can as canV1 } from "@/lib/auth/permissions";
import { can as canV2 } from "@/lib/auth/can";
import { buildActor, type UserOrgRoleRow } from "@/lib/auth/actor";
import type { OrgUnitNode } from "@/lib/org/types";
import { ROLE_SEED } from "../../prisma/seed-roles";

const CHAT_ACTIONS = [
  "chat:read",
  "chat:send",
  "chat:announce",
  "chat:moderate",
  "chat:admin",
] as const;

// ─── V2 fixtures — cùng khuôn với lib/auth/can.test.ts ───────────────────────
const ORG: OrgUnitNode[] = [
  { id: "root", code: "SATAROBO", type: "ROOT", parentId: null, centerId: null },
  { id: "ho", code: "HO", type: "HO", parentId: "root", centerId: null },
  { id: "cs1", code: "CS1", type: "CENTER", parentId: "root", centerId: "c1" },
  { id: "cs2", code: "CS2", type: "CENTER", parentId: "root", centerId: "c2" },
];
const PAST = new Date("2000-01-01");
const NOW = new Date("2026-08-08");
const U = "u-self"; // userId của actor đang test

/** Perms lấy từ CHÍNH ROLE_SEED — test đỏ ngay nếu seed v2 thiếu/lệch action chat. */
function seedPermsOf(code: string): UserOrgRoleRow["role"]["permissions"] {
  const r = ROLE_SEED.find((x) => x.code === code);
  if (!r) throw new Error(`ROLE_SEED thiếu RoleDef ${code}`);
  return r.perms.map((p) => ({ action: p.action, scopeType: p.scopeType }));
}

function actorOf(code: string, orgUnitId: string, opts: { classes?: string[] } = {}) {
  return buildActor({
    userId: U,
    rows: [
      {
        orgUnitId,
        status: "ACTIVE",
        effectiveFrom: PAST,
        effectiveTo: null,
        role: { code, isActive: true, permissions: seedPermsOf(code) },
      },
    ],
    orgNodes: ORG,
    assignedClassIds: opts.classes,
    now: NOW,
  });
}

// Target theo seed chuẩn TestScenarios: LopA (CS1), LopB (CS2), DM (centerId=null).
const LOPA = { classId: "lopA", centerId: "c1" };
const LOPB = { classId: "lopB", centerId: "c2" };
const DM = { centerId: null }; // DM_TEACHER_PARENT — delta E.3: DM có centerId=null

// Actor seed chuẩn (TestScenarios "Seed chuẩn"):
const ph1 = () => actorOf("PARENT", "cs1"); // PH 2 con cùng LopA
const gv1 = () => actorOf("TEACHER", "cs1", { classes: ["lopA"] }); // dạy LopA
const gv3 = () => actorOf("TEACHER", "cs1", { classes: ["lopA", "lopB"] }); // dạy chéo cơ sở
const tg1 = () => actorOf("ASSISTANT_TEACHER", "cs1", { classes: ["lopA"] });
const ql1 = () => actorOf("CENTER_MANAGER", "cs1"); // quản CS1
const qlLop1 = () => actorOf("CENTER_CLASS_MANAGER", "cs1");
const sale1 = () => actorOf("CENTER_SALES_CSM", "cs1"); // P0: 403 toàn bộ
const daoTao = () => actorOf("TRAINING", "ho"); // KHÔNG có ô nào trong ma trận chat
const admin1 = () => actorOf("SUPER_ADMIN", "ho");

// ═════════════════════════════════════════════════════════════════════════════
// TẦNG V1 — can(role, action), matrix tĩnh lib/auth/permissions.ts
// ═════════════════════════════════════════════════════════════════════════════

describe("US-05 v1 — nhóm lớp (CLASS_GROUP), permissions.md ma trận", () => {
  it("[MTX-CG-READ] Đọc tin: PH/GV/QLCS/Admin ✅ — Sale ❌ [TS-01.6]", () => {
    expect(canV1("PARENT", "chat:read")).toBe(true); // ô PH ✅ lớp của con
    expect(canV1("TEACHER", "chat:read")).toBe(true); // ô GV ✅ lớp mình dạy
    expect(canV1("CENTER_MANAGER", "chat:read")).toBe(true); // ô QLCS ✅ lớp cơ sở mình
    expect(canV1("SUPER_ADMIN", "chat:read")).toBe(true); // ô Admin ⚠️ (F-AUDIT enforce ở action)
    // F5 (mở phạm vi 10/08/2026): Sale nay CÓ `chat:read`, nhưng đó là chìa cho kênh 1-1
    // với phụ huynh mình phụ trách. Ô NHÓM LỚP của Sale vẫn ❌ — v1 là ma trận TĨNH không
    // có target nên không diễn tả nổi sự khác biệt đó; chốt chặn thật nằm ở v2 (scope OWN
    // không khớp target nhóm lớp) + quan hệ `Enrollment.saleId` trong handler openDm.
    // Xem case "[F5] Sale KHÔNG lọt vào nhóm lớp" ở khối v2 bên dưới.
    expect(canV1("SALES_CSM", "chat:read")).toBe(true);
  });

  it("[MTX-CG-CHAT] Gửi CHAT: PH/GV/QLCS ✅ — Sale ❌ — Admin ❌ (US-15 AC4) [TS-03.1a/3a]", () => {
    expect(canV1("PARENT", "chat:send")).toBe(true); // [TS-03.1a] ph1 gửi CHAT → 200
    expect(canV1("TEACHER", "chat:send")).toBe(true);
    expect(canV1("CENTER_MANAGER", "chat:send")).toBe(true); // [TS-03.3a] chốt QLCS=MEMBER
    expect(canV1("SALES_CSM", "chat:send")).toBe(true); // F5 — chỉ có nghĩa cho 1-1, xem chú thích trên
    // Ô Admin "❌ (nếu không phải thành viên)" — v1 pin deny toàn phần (ngoại lệ duy
    // nhất của luật SUPER_ADMIN-phủ-mọi-action, xem permissions.ts + permissions.test.ts).
    expect(canV1("SUPER_ADMIN", "chat:send")).toBe(false); // [TS-03.4b][US-15 AC4]
  });

  it("[MTX-CG-ANN] Gửi ANNOUNCEMENT: GV/QLCS/Admin ✅ — PH ❌ — Sale ❌ [TS-03.1b/2a/3a/4a]", () => {
    expect(canV1("TEACHER", "chat:announce")).toBe(true); // [TS-03.2a]
    expect(canV1("CENTER_MANAGER", "chat:announce")).toBe(true); // [TS-03.3a]
    expect(canV1("SUPER_ADMIN", "chat:announce")).toBe(true); // [TS-03.4a]
    expect(canV1("PARENT", "chat:announce")).toBe(false); // [TS-03.1b] PH gửi ANN → 403
    expect(canV1("SALES_CSM", "chat:announce")).toBe(false); // [TS-01.6]
  });

  it("[MTX-CG-MOD] Gỡ tin người khác: GV/Admin ✅ — PH/QLCS/Sale ❌ [TS-03.6]", () => {
    expect(canV1("TEACHER", "chat:moderate")).toBe(true); // [TS-03.6b] GV nhóm mình + lý do
    expect(canV1("SUPER_ADMIN", "chat:moderate")).toBe(true); // ô Admin ✅ + lý do
    expect(canV1("PARENT", "chat:moderate")).toBe(false); // [TS-03.6a] ph1 gỡ tin ph2 → 403
    expect(canV1("CENTER_MANAGER", "chat:moderate")).toBe(false); // [TS-03.6c] ql1 gỡ → 403
    expect(canV1("SALES_CSM", "chat:moderate")).toBe(false); // [TS-01.6]
  });
});

describe("US-05 v1 — quản trị (/admin/hoi-thoai, khoá, audit)", () => {
  it("[MTX-ADMIN] chat:admin: chỉ Admin ✅ — QLCS ❌ [US-15 AC5] — mọi vai khác ❌", () => {
    expect(canV1("SUPER_ADMIN", "chat:admin")).toBe(true); // ô Admin ✅
    expect(canV1("CENTER_MANAGER", "chat:admin")).toBe(false); // ô QLCS ❌ [US-15 AC5]
    expect(canV1("TEACHER", "chat:admin")).toBe(false); // TEACHER deny chat:admin
    expect(canV1("PARENT", "chat:admin")).toBe(false);
    expect(canV1("SALES_CSM", "chat:admin")).toBe(false); // [TS-01.6]
  });
});

describe("US-05 v1 — deny toàn phần theo vai (điều kiện chốt 07-08/08)", () => {
  // F5 mở phạm vi 10/08/2026: Sale nhận ĐÚNG HAI action (read/send) cho kênh 1-1 với phụ
  // huynh mình phụ trách. Ba action còn lại vẫn deny tuyệt đối — Sale không được gửi
  // thông báo, không gỡ tin người khác, không vào trang quản trị hội thoại.
  it("[TS-01.6][F5] SALES_CSM: chỉ chat:read + chat:send; announce/moderate/admin vẫn deny", () => {
    expect(canV1("SALES_CSM", "chat:read")).toBe(true);
    expect(canV1("SALES_CSM", "chat:send")).toBe(true);
    expect(canV1("SALES_CSM", "chat:announce")).toBe(false);
    expect(canV1("SALES_CSM", "chat:moderate")).toBe(false);
    expect(canV1("SALES_CSM", "chat:admin")).toBe(false);
  });

  it("PARENT: deny chat:announce / chat:moderate / chat:admin [TS-03.1b][TS-03.6a]", () => {
    expect(canV1("PARENT", "chat:announce")).toBe(false);
    expect(canV1("PARENT", "chat:moderate")).toBe(false);
    expect(canV1("PARENT", "chat:admin")).toBe(false);
  });

  it("CENTER_MANAGER: deny chat:moderate + chat:admin [TS-03.6c][US-15 AC5]", () => {
    expect(canV1("CENTER_MANAGER", "chat:moderate")).toBe(false);
    expect(canV1("CENTER_MANAGER", "chat:admin")).toBe(false);
  });

  it("TEACHER: deny chat:admin", () => {
    expect(canV1("TEACHER", "chat:admin")).toBe(false);
  });

  it("vai ngoài ma trận (HR/MARKETING/ACCOUNTANT/TRAINING) v1: không action chat nào", () => {
    // permissions.md chỉ có 5 cột: PH / GV / QLCS / Sale / Admin. Vai nào không có cột
    // thì không có ô nào — kể cả TRAINING (xem describe riêng bên dưới, tầng v2).
    for (const role of ["HR", "MARKETING", "ACCOUNTANT", "TRAINING"] as Role[]) {
      for (const a of CHAT_ACTIONS) expect(canV1(role, a)).toBe(false);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TẦNG V2 — can(actor, action, target), actor dựng từ CHÍNH prisma/seed-roles.ts
// ═════════════════════════════════════════════════════════════════════════════

describe("US-05 v2 — PH (PARENT, scope OWN)", () => {
  it("[MTX-CG-READ/PH][TS-01.1] đọc/gửi hội thoại CỦA MÌNH (target.createdById=mình) → allow", () => {
    expect(canV2(ph1(), "chat:read", { createdById: U })).toBe(true);
    expect(canV2(ph1(), "chat:send", { createdById: U })).toBe(true); // [TS-03.1a]
  });

  it("[TS-01.2] đọc hội thoại KHÔNG phải của mình / thiếu target → deny (an toàn)", () => {
    expect(canV2(ph1(), "chat:read", { createdById: "nguoi-khac" })).toBe(false);
    expect(canV2(ph1(), "chat:read")).toBe(false); // thiếu target → false
  });

  it("[TS-03.1b][TS-03.6a] PH deny announce/moderate/admin với MỌI target", () => {
    expect(canV2(ph1(), "chat:announce", LOPA)).toBe(false); // [TS-03.1b]
    expect(canV2(ph1(), "chat:announce", { createdById: U })).toBe(false);
    expect(canV2(ph1(), "chat:moderate", LOPA)).toBe(false); // [TS-03.6a]
    expect(canV2(ph1(), "chat:admin")).toBe(false);
  });
});

describe("US-05 v2 — GV (TEACHER, scope ASSIGNED theo phân công lớp)", () => {
  it("[MTX-CG-READ/GV][TS-03.2a] gv1 đọc/gửi/announce LopA (lớp mình dạy) → allow", () => {
    expect(canV2(gv1(), "chat:read", LOPA)).toBe(true);
    expect(canV2(gv1(), "chat:send", LOPA)).toBe(true);
    expect(canV2(gv1(), "chat:announce", LOPA)).toBe(true); // [TS-03.2a]
  });

  it("[TS-03.2b] gv1 vào LopB (không dạy) → deny cả read/send/announce/moderate", () => {
    expect(canV2(gv1(), "chat:read", LOPB)).toBe(false);
    expect(canV2(gv1(), "chat:send", LOPB)).toBe(false);
    expect(canV2(gv1(), "chat:announce", LOPB)).toBe(false); // [TS-03.2b]
    expect(canV2(gv1(), "chat:moderate", LOPB)).toBe(false);
  });

  it("[TS-01.5] gv3 dạy chéo cơ sở → thấy CẢ LopA (CS1) + LopB (CS2) — membership theo phân công, không theo centerId", () => {
    expect(canV2(gv3(), "chat:read", LOPA)).toBe(true);
    expect(canV2(gv3(), "chat:read", LOPB)).toBe(true);
    expect(canV2(gv3(), "chat:send", LOPB)).toBe(true);
  });

  it("[TS-03.6b][MTX-CG-MOD] gv1 gỡ tin người khác NHÓM MÌNH → allow; ngoài nhóm → deny (lý do enforce ở action)", () => {
    expect(canV2(gv1(), "chat:moderate", LOPA)).toBe(true); // [TS-03.6b]
    expect(canV2(gv1(), "chat:moderate", LOPB)).toBe(false);
  });

  it("GV deny chat:admin với mọi target [MTX-ADMIN]", () => {
    expect(canV2(gv1(), "chat:admin", LOPA)).toBe(false);
    expect(canV2(gv3(), "chat:admin")).toBe(false);
  });

  it("Trợ giảng (ASSISTANT_TEACHER) cùng bộ ASSIGNED với GV — lớp gán allow, lớp khác deny", () => {
    expect(canV2(tg1(), "chat:read", LOPA)).toBe(true);
    expect(canV2(tg1(), "chat:send", LOPA)).toBe(true);
    expect(canV2(tg1(), "chat:announce", LOPA)).toBe(true);
    expect(canV2(tg1(), "chat:moderate", LOPA)).toBe(true);
    expect(canV2(tg1(), "chat:read", LOPB)).toBe(false);
    expect(canV2(tg1(), "chat:admin")).toBe(false);
  });
});

describe("US-05 v2 — QLCS (CENTER_MANAGER, scope CENTER — MEMBER nhóm lớp cơ sở mình)", () => {
  it("[TS-03.3a][MTX-CG-CHAT/ANN] ql1 đọc + gửi CHAT + gửi ANNOUNCEMENT vào LopA (CS1) → allow cả ba", () => {
    expect(canV2(ql1(), "chat:read", LOPA)).toBe(true); // [TS-01.4]
    expect(canV2(ql1(), "chat:send", LOPA)).toBe(true); // [TS-03.3a] chốt QLCS=MEMBER
    expect(canV2(ql1(), "chat:announce", LOPA)).toBe(true); // [TS-03.3a]
  });

  it("[TS-01.4][TS-03.3b] ql1 sang LopB (CS2) → deny read/send/announce", () => {
    expect(canV2(ql1(), "chat:read", LOPB)).toBe(false); // [TS-01.4] ql1 đọc LopB → 403
    expect(canV2(ql1(), "chat:send", LOPB)).toBe(false); // [TS-03.3b]
    expect(canV2(ql1(), "chat:announce", LOPB)).toBe(false);
  });

  it("[TS-04.1][MTX-DM] QLCS với 1-1 (DM centerId=null) → CENTER scope tự deny đọc/gửi", () => {
    expect(canV2(ql1(), "chat:read", DM)).toBe(false); // [TS-04.1] ql1 đọc DM gv1↔ph1 → 403
    expect(canV2(ql1(), "chat:send", DM)).toBe(false); // ô DM/Gửi/QLCS ❌
  });

  it("[TS-03.6c][US-15 AC5] QLCS deny moderate + admin với mọi target", () => {
    expect(canV2(ql1(), "chat:moderate", LOPA)).toBe(false); // [TS-03.6c]
    expect(canV2(ql1(), "chat:admin")).toBe(false); // [US-15 AC5] /admin/hoi-thoai
    expect(canV2(ql1(), "chat:admin", LOPA)).toBe(false);
  });

  it("CENTER_CLASS_MANAGER (QL lớp học) — cùng bộ CENTER với QLCS, không moderate/admin", () => {
    expect(canV2(qlLop1(), "chat:read", LOPA)).toBe(true);
    expect(canV2(qlLop1(), "chat:send", LOPA)).toBe(true);
    expect(canV2(qlLop1(), "chat:announce", LOPA)).toBe(true);
    expect(canV2(qlLop1(), "chat:read", LOPB)).toBe(false);
    expect(canV2(qlLop1(), "chat:moderate", LOPA)).toBe(false);
    expect(canV2(qlLop1(), "chat:admin")).toBe(false);
  });

  /**
   * Chốt 09/08/2026 — "Giáo vụ được đối xử Y HỆT Quản lý cơ sở trong chat".
   * Ô-đối-ô, không chỉ "gần giống": 3 ô read/send/announce PHẢI trùng câu trả lời của
   * QLCS trên MỌI target, và 2 ô moderate/admin vẫn đóng cho cả hai.
   *
   * Nửa còn lại của chốt nằm ở tầng membership (Giáo vụ phải LÀ participant) —
   * `lib/chat/sync-membership.ts` + `lib/chat/sync-membership.test.ts`; quyền ở đây mà
   * không có membership thì vẫn là quyền chết (đúng tình trạng trước 09/08).
   */
  it("[chốt 09/08] Giáo vụ ≡ QLCS trên cả 5 ô × mọi target (read/send/announce ✅, moderate/admin ❌)", () => {
    for (const a of CHAT_ACTIONS) {
      for (const target of [LOPA, LOPB, DM, undefined]) {
        expect(
          canV2(qlLop1(), a, target),
          `ô ${a} × ${JSON.stringify(target)}: Giáo vụ phải trả lời GIỐNG QLCS`,
        ).toBe(canV2(ql1(), a, target));
      }
    }
    // Neo giá trị tuyệt đối (phòng trường hợp CẢ HAI cùng sai theo một hướng).
    expect(canV2(qlLop1(), "chat:read", LOPA)).toBe(true);
    expect(canV2(qlLop1(), "chat:send", LOPA)).toBe(true);
    expect(canV2(qlLop1(), "chat:announce", LOPA)).toBe(true);
    expect(canV2(qlLop1(), "chat:moderate", LOPA)).toBe(false);
    expect(canV2(qlLop1(), "chat:admin", LOPA)).toBe(false);
  });
});

describe("US-05 v2 — Sale (CENTER_SALES_CSM): P0 deny TOÀN BỘ [TS-01.6]", () => {
  it("[TS-01.6] sale1 gọi cả 5 action × mọi target (LopA/LopB/DM/không target) → deny", () => {
    for (const a of CHAT_ACTIONS) {
      expect(canV2(sale1(), a, LOPA)).toBe(false);
      expect(canV2(sale1(), a, LOPB)).toBe(false);
      expect(canV2(sale1(), a, DM)).toBe(false);
      expect(canV2(sale1(), a)).toBe(false);
    }
  });

  // F5 (10/08/2026) — Sale nay CÓ perm chat, nhưng ĐÚNG HAI cái và ĐÚNG scope OWN.
  // Case này giữ nguyên vai trò cũ: chống thêm nhầm. Điều nguy hiểm nhất là ai đó "cho
  // tiện" đổi sang CENTER — `scopeMatches` cho CENTER chỉ đòi `target.centerId` khớp, mà
  // nhóm lớp LUÔN có centerId ⇒ Sale lọt thẳng vào mọi nhóm lớp của cơ sở mình.
  it("[F5] seed v2 CENTER_SALES_CSM: đúng chat:read + chat:send, đúng scope OWN", () => {
    const chatPerms = seedPermsOf("CENTER_SALES_CSM")
      .filter((p) => p.action.startsWith("chat:"))
      .sort((a, b) => a.action.localeCompare(b.action));
    expect(chatPerms).toEqual([
      { action: "chat:read", scopeType: "OWN" },
      { action: "chat:send", scopeType: "OWN" },
    ]);
  });

  it("[F5] Sale KHÔNG lọt vào nhóm lớp: scope OWN không khớp target có classId/centerId", () => {
    const sale = actorOf("CENTER_SALES_CSM", "cs1");
    // Target nhóm lớp (`sendTargetOf` với hội thoại CLASS_GROUP mà Sale KHÔNG là thành viên).
    expect(canV2(sale, "chat:read", { classId: "lopA", centerId: "c1" })).toBe(false);
    expect(canV2(sale, "chat:send", { classId: "lopA", centerId: "c1" })).toBe(false);
    // Và không bao giờ được gửi thông báo / gỡ tin / vào trang quản trị.
    expect(canV2(sale, "chat:announce", { classId: "lopA", centerId: "c1" })).toBe(false);
    expect(canV2(sale, "chat:moderate", { classId: "lopA", centerId: "c1" })).toBe(false);
    expect(canV2(sale, "chat:admin")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRAINING — PIN CHỐNG TÁI PHÁT (vá 09/08/2026).
//
// Seed 08/08 từng cấp `{ action: "chat:read", scopeType: "GLOBAL" }` cho RoleDef
// TRAINING với lý do "giám sát nội dung giảng dạy". Ba lý do gỡ (ghi đủ ở chỗ khai
// trong prisma/seed-roles.ts):
//   • permissions.md KHÔNG có vai Đào tạo ở bất kỳ ô nào — quyền không có hợp đồng;
//   • GLOBAL đọc được MỌI hội thoại kể cả 1-1 GV↔PH, tức MẠNH HƠN Admin: ô "Đọc" của
//     Admin là ⚠️ có điều kiện — không phải thành viên thì phải qua F-AUDIT (bắt buộc
//     nhập lý do + ghi AuditLog TRƯỚC khi trả nội dung). Đào tạo đọc thẳng, không vết;
//   • không có call-site nào ở P0.
// Test này ĐỎ ngay nếu ai thêm lại theo quán tính.
// ─────────────────────────────────────────────────────────────────────────────
describe("US-05 — TRAINING (Đào tạo): KHÔNG có ô nào trong ma trận chat", () => {
  it("v2: cả 5 action × mọi target (LopA/LopB/DM/không target) → deny", () => {
    for (const a of CHAT_ACTIONS) {
      expect(canV2(daoTao(), a)).toBe(false);
      expect(canV2(daoTao(), a, LOPA)).toBe(false);
      expect(canV2(daoTao(), a, LOPB)).toBe(false);
      expect(canV2(daoTao(), a, DM)).toBe(false);
    }
  });

  it("v1: cả 5 action → deny", () => {
    for (const a of CHAT_ACTIONS) expect(canV1("TRAINING", a)).toBe(false);
  });

  it("seed v2 RoleDef TRAINING không chứa BẤT KỲ perm chat:* nào (kể cả scope khác GLOBAL)", () => {
    expect(seedPermsOf("TRAINING").filter((p) => p.action.startsWith("chat:"))).toEqual([]);
  });
});

describe("US-05 v2 — Admin HO (SUPER_ADMIN)", () => {
  it("[MTX-ADMIN][TS-03.4a] bypass → allow mọi action chat (kể cả chat:admin)", () => {
    for (const a of CHAT_ACTIONS) expect(canV2(admin1(), a, LOPA)).toBe(true);
    expect(canV2(admin1(), "chat:admin")).toBe(true);
  });

  it("[TS-03.4b] LƯU Ý: v2 bypass KHÔNG chặn được Admin gửi CHAT — chốt chặn nằm ở participant-check trong action (US-06) + v1 deny", () => {
    // Pin hành vi bypass để ai đổi can() v2 phải nhìn thấy hệ quả với ma trận chat.
    expect(canV2(admin1(), "chat:send", DM)).toBe(true); // v2 true — action layer phải tự chặn (US-15 AC4)
    expect(canV1("SUPER_ADMIN", "chat:send")).toBe(false); // v1 false — lớp phòng thủ pin ý định
  });
});

// ─── Pin seed v2 đúng đặc tả US-05 (chống drift khi ai đó sửa seed-roles) ─────
describe("US-05 — pin nội dung seed v2 cho 5 action chat", () => {
  const expectSeed = (code: string, expected: Record<string, string>) => {
    const chatPerms = Object.fromEntries(
      seedPermsOf(code)
        .filter((p) => p.action.startsWith("chat:"))
        .map((p) => [p.action, p.scopeType]),
    );
    expect(chatPerms).toEqual(expected);
  };

  it("PARENT: read/send OWN — không hơn", () => {
    expectSeed("PARENT", { "chat:read": "OWN", "chat:send": "OWN" });
  });

  it("TEACHER + ASSISTANT_TEACHER: read/send/announce/moderate ASSIGNED", () => {
    const boGV = {
      "chat:read": "ASSIGNED",
      "chat:send": "ASSIGNED",
      "chat:announce": "ASSIGNED",
      "chat:moderate": "ASSIGNED",
    };
    expectSeed("TEACHER", boGV);
    expectSeed("ASSISTANT_TEACHER", boGV);
  });

  it("CENTER_MANAGER + CENTER_CLASS_MANAGER: read/send/announce CENTER — không moderate/admin", () => {
    const boQL = {
      "chat:read": "CENTER",
      "chat:send": "CENTER",
      "chat:announce": "CENTER",
    };
    expectSeed("CENTER_MANAGER", boQL);
    expectSeed("CENTER_CLASS_MANAGER", boQL);
  });

  it("SUPER_ADMIN: cả 5 GLOBAL — vai DUY NHẤT được giữ chat:* ở scope GLOBAL", () => {
    expectSeed("SUPER_ADMIN", {
      "chat:read": "GLOBAL",
      "chat:send": "GLOBAL",
      "chat:announce": "GLOBAL",
      "chat:moderate": "GLOBAL",
      "chat:admin": "GLOBAL",
    });
    const globalChat = ROLE_SEED.filter((r) =>
      r.perms.some((p) => p.action.startsWith("chat:") && p.scopeType === "GLOBAL"),
    ).map((r) => r.code);
    expect(globalChat).toEqual(["SUPER_ADMIN"]);
  });

  it("TRAINING / HO_SALE / kế toán / HR / marketing: không perm chat nào", () => {
    for (const code of [
      "TRAINING",
      "HO_SALE",
      "HO_ACCOUNTANT",
      "CENTER_ACCOUNTANT",
      "HO_HR",
      "CENTER_HR",
      "HO_MARKETING",
    ]) {
      expect(seedPermsOf(code).filter((p) => p.action.startsWith("chat:"))).toEqual([]);
    }
  });
});
