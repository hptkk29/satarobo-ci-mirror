/**
 * `canManageSessionClass` — quản lý cơ sở GẮN VAI Ở HỘI SỞ (18/10/2026).
 *
 * Đo prod: chị Dương Thị Mỹ Trang mang `HO:CENTER_MANAGER` nên `User.centerId` TRỐNG. Cổng cũ so
 * `lớp.centerId === User.centerId` ⇒ luôn trượt ⇒ chị bị xếp xuống nhóm CSKH (sửa điểm danh trong 7 ngày) dù
 * màn ghi "quá hạn cần Quản lý cơ sở thực hiện". Cơ sở của quản lý là PHẠM VI VAI, không phải cột cũ.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fresh: vi.fn(),
  resolveActor: vi.fn(),
  passesScope: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./_feedback-core", () => ({ saveSessionFeedbackCore: vi.fn(), saveSessionEvalCore: vi.fn() }));
vi.mock("@/lib/auth/fresh-gate-user", () => ({ getFreshGateUser: h.fresh }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/db-scope", () => ({ scopedDb: vi.fn(), passesScope: h.passesScope }));

import { canManageSessionClass } from "./_actions";

const LOP_CS2 = { teacherId: "gv-1", assistantId: "tg-1", centerId: "co-so-hoang-dieu" };
const nguoi = (role: string, centerId: string | null) => ({ id: "u-1", role, centerId });

beforeEach(() => {
  vi.clearAllMocks();
  h.resolveActor.mockResolvedValue({ marker: "actor" });
  h.passesScope.mockReturnValue(false);
});

describe("[CMS] canManageSessionClass — CENTER_MANAGER", () => {
  it("[CMS-01] cùng cơ sở theo cột cũ ⇒ được, KHÔNG phải hỏi phạm vi vai", async () => {
    h.fresh.mockResolvedValue({ id: "u-1", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: "co-so-hoang-dieu" });
    expect(await canManageSessionClass(nguoi("CENTER_MANAGER", "co-so-hoang-dieu"), LOP_CS2)).toBe(true);
    expect(h.resolveActor).not.toHaveBeenCalled();
  });

  it("[CMS-02] centerId TRỐNG nhưng lớp nằm trong phạm vi vai (HO) ⇒ được — đúng ca chị Trang", async () => {
    h.fresh.mockResolvedValue({ id: "u-1", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: null });
    h.passesScope.mockReturnValue(true);
    expect(await canManageSessionClass(nguoi("CENTER_MANAGER", null), LOP_CS2)).toBe(true);
    expect(h.passesScope).toHaveBeenCalledWith("Class", { centerId: "co-so-hoang-dieu" }, { marker: "actor" });
  });

  it("[CMS-03] lớp NGOÀI phạm vi vai ⇒ KHÔNG (đối chứng của CMS-02: không phải ai trống centerId cũng qua)", async () => {
    h.fresh.mockResolvedValue({ id: "u-1", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: null });
    h.passesScope.mockReturnValue(false);
    expect(await canManageSessionClass(nguoi("CENTER_MANAGER", null), LOP_CS2)).toBe(false);
  });

  it("[CMS-04] cơ sở khác theo cột cũ và ngoài phạm vi vai ⇒ KHÔNG", async () => {
    h.fresh.mockResolvedValue({ id: "u-1", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: "co-so-khac" });
    expect(await canManageSessionClass(nguoi("CENTER_MANAGER", "co-so-khac"), LOP_CS2)).toBe(false);
  });

  it("[CMS-05] lớp không có cơ sở ⇒ KHÔNG, và không hỏi phạm vi (fail-closed)", async () => {
    h.fresh.mockResolvedValue({ id: "u-1", role: "CENTER_MANAGER", roles: ["CENTER_MANAGER"], centerId: null });
    h.passesScope.mockReturnValue(true);
    expect(await canManageSessionClass(nguoi("CENTER_MANAGER", null), { ...LOP_CS2, centerId: null })).toBe(false);
    expect(h.passesScope).not.toHaveBeenCalled();
  });
});

describe("[CMS] canManageSessionClass — các vai khác không đổi", () => {
  it("[CMS-06] CSKH trống centerId + phạm vi vai thấy lớp ⇒ vẫn KHÔNG (chỉ CENTER_MANAGER được hưởng nhánh phạm vi)", async () => {
    h.fresh.mockResolvedValue({ id: "u-1", role: "SALES_CSM", roles: ["SALES_CSM"], centerId: null });
    h.passesScope.mockReturnValue(true);
    expect(await canManageSessionClass(nguoi("SALES_CSM", null), LOP_CS2)).toBe(false);
    expect(h.resolveActor).not.toHaveBeenCalled();
  });

  it("[CMS-07] giáo viên chính / trợ giảng của lớp ⇒ được; giáo viên khác ⇒ không", async () => {
    h.fresh.mockResolvedValue({ id: "gv-1", role: "TEACHER", roles: ["TEACHER"], centerId: null });
    expect(await canManageSessionClass({ id: "gv-1", role: "TEACHER", centerId: null }, LOP_CS2)).toBe(true);
    expect(await canManageSessionClass({ id: "tg-1", role: "TEACHER", centerId: null }, LOP_CS2)).toBe(true);
    expect(await canManageSessionClass({ id: "gv-9", role: "TEACHER", centerId: null }, LOP_CS2)).toBe(false);
  });
});
