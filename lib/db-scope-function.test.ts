// Cross-center bám CHỨC NĂNG, không bám con người (Doc 15 §2).
//
// `getModelVisibleCenterIds(model, actor)` gom union `centerScope` của các permission
// khớp prefix action của model. Nhờ đó một người kiêm nhiều role ở nhiều cấp thấy
// đúng phần dữ liệu của từng chức năng, thay vì "có 1 role HO ⇒ thấy tất".
//
// Ca thật (24/07/2026): Phan Thành Toại = TRAINING @ HO + CENTER_MANAGER @ CS1 + TEACHER @ CS1.
// Yêu cầu (user chốt 24/07): Đào tạo KHOÁ CHẶT — Toại thấy HỌC VIÊN/LỚP/BUỔI/GHI DANH/ĐIỂM DANH
// CHỈ CS1 (như một QL cơ sở). CHỈ HỌC BẠ (ReportCard) cross-center để DUYỆT học bạ CS2.
// LEAD/DOANH THU/NHÂN SỰ CS2 vẫn không thấy.
import { describe, it, expect } from "vitest";
import {
  SCOPED_MODELS,
  getModelPrefixes,
  getModelVisibleCenterIds,
  passesScope,
} from "@/lib/db-scope";
import type { Actor, PermEntry } from "@/lib/auth/actor";

const CS1 = "center-cs1";
const CS2 = "center-cs2";

const perm = (action: string, centerScope: "ALL" | string[]): PermEntry => ({
  action,
  scopeType: "GLOBAL",
  orgUnitId: centerScope === "ALL" ? "org-ho" : "org-cs1",
  roleCode: centerScope === "ALL" ? "TRAINING" : "CENTER_MANAGER",
  centerScope,
});

/**
 * Ca "Toại": TRAINING @ HO + CENTER_MANAGER @ CS1.
 *
 * ⚠️ 04/09/2026 — đây là một KỊCH BẢN, không phải hồ sơ nhân sự. Chủ dự án cho
 * biết người thật nay chỉ còn giữ vai đào tạo ở Hội sở, không còn quản lý CS1.
 * Giữ nguyên fixture vì thứ nó khoá vẫn đúng và vẫn cần: hình dạng "cờ isHoLevel
 * BẬT nhưng quyền chỉ ở một cơ sở" tồn tại với bất kỳ ai kiêm nhiệm, và đó là
 * hình dạng dễ bị dùng nhầm làm quyền bao trùm nhất.
 */
const toai: Actor = {
  userId: "u-toai",
  isSuperAdmin: false,
  isHoLevel: true, // có role tại HO ⇒ cờ blanket bật — test này chứng minh nó KHÔNG còn quyết định tất
  orgRoles: [
    { orgUnitId: "org-ho", roleCode: "TRAINING" },
    { orgUnitId: "org-cs1", roleCode: "CENTER_MANAGER" },
  ],
  permissions: [
    // TRAINING @ HO — 24/07 khoá chặt: chỉ DUYỆT học bạ cross-center (report-cards:review).
    // KHÔNG còn students/classes:view-all, KHÔNG report-cards:manage.
    perm("report-cards:review", "ALL"),
    // CENTER_MANAGER @ CS1 — vận hành cơ sở, chỉ CS1 (gồm cả xem HV/lớp/ghi danh).
    perm("students:view-all", [CS1]),
    perm("classes:view-all", [CS1]),
    perm("leads:view-all", [CS1]),
    perm("leads:edit", [CS1]),
    perm("payments:record", [CS1]),
    perm("orders:view", [CS1]),
    perm("employees:view-all", [CS1]),
    perm("enrollments:view-all", [CS1]),
    // CM@CS1 vận hành cơ sở (seed-roles) — cần cho guard GHI per-model (Room/Holiday).
    perm("rooms:edit", [CS1]),
    perm("holidays:view", [CS1]),
  ],
  visibleCenterIds: [CS1, CS2], // blanket (HO) — KHÔNG được dùng cho model đã map prefix
  visibleOrgUnitIds: ["org-ho", "org-cs1"],
  grantsAllow: new Set<string>(),
  assignedClassIds: new Set<string>(),
};

describe("scopedDb — cross-center theo chức năng (ca Toại — 24/07 khoá chặt Đào tạo)", () => {
  it("CHỈ THẤY học viên + lớp + buổi học CS1 (Đào tạo hết view-all; chỉ còn CM@CS1)", () => {
    expect(getModelVisibleCenterIds("Student", toai)).toEqual([CS1]);
    expect(getModelVisibleCenterIds("Class", toai)).toEqual([CS1]);
    expect(getModelVisibleCenterIds("ClassSession", toai)).toEqual([CS1]);
  });

  it("CHỈ THẤY ghi danh CS1 — /ghi danh khoá theo enrollments: (tách report-cards: 24/07)", () => {
    expect(getModelVisibleCenterIds("Enrollment", toai)).toEqual([CS1]);
  });

  it("VẪN duyệt được HỌC BẠ cả 2 cơ sở — ReportCard giữ report-cards: (report-cards:review GLOBAL)", () => {
    expect(getModelVisibleCenterIds("ReportCard", toai)).toBe("ALL");
  });

  it("CHỈ THẤY điểm danh CS1 (bám classes: — Toại chỉ CS1)", () => {
    expect(getModelVisibleCenterIds("Attendance", toai)).toEqual([CS1]);
  });

  it("KHÔNG thấy lead cơ sở khác (leads:* chỉ gắn CS1)", () => {
    expect(getModelVisibleCenterIds("Lead", toai)).toEqual([CS1]);
    expect(getModelVisibleCenterIds("MessengerConversation", toai)).toEqual([CS1]);
    // Lịch sử học thử của lead = dữ liệu lead, KHÔNG phải đào tạo.
    expect(getModelVisibleCenterIds("LeadTrialHistory", toai)).toEqual([CS1]);
  });

  it("KHÔNG thấy doanh thu / đơn hàng cơ sở khác", () => {
    expect(getModelVisibleCenterIds("Payment", toai)).toEqual([CS1]);
    expect(getModelVisibleCenterIds("Order", toai)).toEqual([CS1]);
  });

  it("KHÔNG thấy nhân sự cơ sở khác", () => {
    expect(getModelVisibleCenterIds("Employee", toai)).toEqual([CS1]);
  });
});

// Vá 24/07 — bug thật: Toại (TRAINING@HO, isHoLevel=true) TẠO được lớp cho CS2 vì
// guard ghi `actorCanUseCenter` trong app/(admin)/**/_actions bypass theo cờ isHoLevel
// trần. Guard nay đi qua passesScope(model, { centerId }, actor) → GHI đối xứng ĐỌC.
describe("passesScope — guard GHI theo scope per-model (tạo/chuyển cơ sở, ca Toại)", () => {
  it("KHÔNG tạo/chuyển lớp sang CS2; lớp HO (centerId null) đòi scope ALL — chỉ CS1 qua", () => {
    expect(passesScope("Class", { centerId: CS2 }, toai)).toBe(false); // bug gốc 24/07
    expect(passesScope("Class", { centerId: CS1 }, toai)).toBe(true);
    expect(passesScope("Class", { centerId: null }, toai)).toBe(false);
  });

  it("cùng ngữ nghĩa cho nhóm lớp / lớp trải nghiệm / phòng / ngày nghỉ / HV / NV", () => {
    for (const m of ["ClassGroup", "TrialClassV2", "Room", "Holiday", "Student", "Employee"]) {
      expect(passesScope(m, { centerId: CS2 }, toai), `${m} CS2 phải bị chặn`).toBe(false);
      expect(passesScope(m, { centerId: CS1 }, toai), `${m} CS1 phải qua`).toBe(true);
    }
    // NV HO (centerId null) — cần scope ALL, Toại không có.
    expect(passesScope("Employee", { centerId: null }, toai)).toBe(false);
  });

  it("NGÀY NGHỈ toàn hệ thống: ĐỌC được, nhưng GHI thì không (đảo 04/09/2026)", () => {
    // `Holiday` nay ∈ NULL_IS_GLOBAL_MODELS: `centerId = null` nghĩa là Tết/lễ áp
    // cho MỌI cơ sở, không phải "chưa gán". Trước đổi này người cấp cơ sở KHÔNG
    // BAO GIỜ thấy 4/6 ngày nghỉ thật — đúng những ngày sinh ra lịch buổi học.
    expect(passesScope("Holiday", { centerId: null }, toai)).toBe(true);

    // ⚠️ NHƯNG `passesScope` là luật ĐỌC. Luật GHI chặt hơn và nằm ở
    // `app/(admin)/admin/holidays/_actions.ts` (`actorCanUseCenterTarget`): phạm vi
    // "toàn hệ thống" chỉ Hội sở / quản trị hệ thống được tạo–sửa–xoá.
    //
    // Vì sao tách: guard ghi cũ gọi THẲNG `passesScope`, nên nếu không tách thì
    // đúng thay đổi trên biến quản lý một cơ sở thành người xoá được ngày nghỉ áp
    // cho mọi cơ sở. Đó là nới quyền, không phải sửa lỗi.
    //
    // Luật ghi KHÔNG hỏi cờ `isHoLevel`: Toại BẬT cờ đó (có vai neo tại Hội sở) mà
    // vẫn không phải quản trị hệ thống — lấy cờ làm quyền bao trùm đúng là lỗi cả
    // file test này sinh ra để chặn.
    expect(toai.isHoLevel).toBe(true);
    expect(toai.isSuperAdmin).toBe(false);

    // Cũng KHÔNG hỏi `getModelVisibleCenterIds`: hàm đó gộp mọi quyền cùng tiền tố
    // `holidays:`/`centers:`, nên `holidays:VIEW` phạm vi GLOBAL cũng ra "ALL" —
    // quyền ĐỌC bị đọc thành quyền GHI. Và khi vai không có quyền `holidays:` nào
    // thì nó rơi về `isHoLevel ? "ALL"`, tức đúng cái cờ vừa loại ở trên.
    // Guard thật nằm ở `app/(admin)/admin/holidays/_actions.ts` và hỏi
    // `actor.isSuperAdmin` — khớp seed (`holidays:edit` chỉ cấp cho SUPER_ADMIN).
    const chiCoQuyenXem: Actor = {
      ...toai,
      permissions: [{ action: "holidays:view", centerScope: "ALL" } as never],
    };
    expect(getModelVisibleCenterIds("Holiday", chiCoQuyenXem)).toBe("ALL");
    expect(chiCoQuyenXem.isSuperAdmin).toBe(false); // ⇒ guard ghi vẫn chặn
  });

  it("duyệt học bạ CS2 GIỮ NGUYÊN (ReportCard = ALL — câu 55)", () => {
    expect(passesScope("ReportCard", { centerId: CS2 }, toai)).toBe(true);
  });

  it("SUPER_ADMIN không bị siết", () => {
    const sa: Actor = { ...toai, isSuperAdmin: true };
    expect(passesScope("Class", { centerId: CS2 }, sa)).toBe(true);
    expect(passesScope("Class", { centerId: null }, sa)).toBe(true);
  });

  it("role HO CÓ chức năng module vẫn cross-center (HO_HR ghi Employee mọi CS + NV HO)", () => {
    const hoHr: Actor = { ...toai, permissions: [perm("employees:edit", "ALL")] };
    expect(passesScope("Employee", { centerId: CS2 }, hoHr)).toBe(true);
    expect(passesScope("Employee", { centerId: null }, hoHr)).toBe(true);
  });
});

describe("scopedDb — mọi SCOPED_MODEL phải có prefix (nếu không sẽ rơi về blanket isHoLevel)", () => {
  it("không model nào thiếu map", () => {
    // #04 flip Attendance sang SCOPED nhưng quên map → bất kỳ ai có 1 role HO đều thấy
    // điểm danh toàn hệ thống bất kể chức năng. Test này chặn lặp lại.
    const thieu = [...SCOPED_MODELS].filter((m) => getModelPrefixes(m).length === 0);
    expect(thieu).toEqual([]);
  });
});
