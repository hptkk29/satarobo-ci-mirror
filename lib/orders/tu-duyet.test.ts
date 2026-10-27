import { describe, expect, it } from "vitest";
import { chanTuDuyetDon, LY_DO_KHONG_TU_DUYET, VAI_TU_DUYET_DON, type ActorTuDuyet } from "./tu-duyet";

// Chủ dự án chốt 20/10/2026: "admin, qlcs thì không cần chặn, còn các role khác thì chặn hết".
const actor = (isSuperAdmin: boolean, ...vai: string[]): ActorTuDuyet => ({ isSuperAdmin, orgRoles: vai.map((roleCode) => ({ roleCode })) });
const chan = (a: ActorTuDuyet, nguoiTaoId: string | null | undefined = "u1", actorId = "u1") => chanTuDuyetDon({ nguoiTaoId, actorId, actor: a });

describe("[TDD-01] chặn tự duyệt đơn do chính mình tạo", () => {
  it("kế toán tạo đơn rồi tự duyệt ⇒ bị chặn, kèm câu nói rõ", () => {
    expect(chan(actor(false, "CENTER_ACCOUNTANT"))).toBe(LY_DO_KHONG_TU_DUYET);
    expect(chan(actor(false, "HO_ACCOUNTANT"))).toBe(LY_DO_KHONG_TU_DUYET);
  });
  it("tư vấn viên tạo và tự duyệt ⇒ bị chặn; người không có vai nào cũng bị chặn", () => {
    expect(chan(actor(false, "CENTER_SALES_CSM"))).toBe(LY_DO_KHONG_TU_DUYET);
    expect(chan(actor(false))).toBe(LY_DO_KHONG_TU_DUYET);
  });
  it("Quản lý cơ sở tự duyệt đơn mình ⇒ không chặn", () => {
    expect(chan(actor(false, "CENTER_MANAGER"))).toBeNull();
  });
  it("Quản trị hệ thống tự duyệt ⇒ không chặn", () => {
    expect(chan(actor(true))).toBeNull();
  });
  it("người khác tạo ⇒ không chặn, dù là kế toán", () => {
    expect(chan(actor(false, "CENTER_ACCOUNTANT"), "u2")).toBeNull();
  });
  it("đơn không ghi người tạo (đơn cũ/convert) ⇒ không chặn mù", () => {
    expect(chan(actor(false, "CENTER_ACCOUNTANT"), null)).toBeNull();
    expect(chanTuDuyetDon({ nguoiTaoId: undefined, actorId: "u1", actor: actor(false, "CENTER_ACCOUNTANT") })).toBeNull();
  });
  it("tập vai được miễn đúng hai vai đã chốt (thêm vai là nới quyền tiền)", () => {
    expect([...VAI_TU_DUYET_DON].sort()).toEqual(["CENTER_MANAGER", "SUPER_ADMIN"]);
  });
});
