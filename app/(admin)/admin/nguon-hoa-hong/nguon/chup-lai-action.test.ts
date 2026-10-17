// @vitest-environment node
/**
 * [CLC-ACT-*] — HÀNH VI của `chupLaiChuNguonAction`, mọi phụ thuộc giả lập (không Postgres, không next-auth).
 *
 *   [CLC-ACT-01] chưa đăng nhập · thiếu `sources:manage` · thiếu `commission_policies:activate` · cờ tắt · dữ liệu lỗi ⇒ dịch vụ KHÔNG được gọi
 *   [CLC-ACT-02] thành công: truyền đúng người · nguồn · chủ dự kiến · lý do · con trỏ · cỡ lô · đồng hồ; KHÔNG làm mới trang (làm mới giữa chừng gỡ hộp thoại đang chạy — đo khi chụp giao diện)
 *   [CLC-ACT-03] dịch vụ từ chối ⇒ trả lỗi kèm tên ô, KHÔNG làm mới
 *   [CLC-ACT-04] HAI khoá, độc lập: thiếu MỘT trong hai là đủ để từ chối (đối chứng dương: đủ cả hai thì qua)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  revalidatePath: vi.fn(),
  chup: vi.fn(),
  nguonBat: vi.fn(),
  actor: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: M.revalidatePath }));
vi.mock("@/lib/auth", () => ({ auth: M.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: M.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: M.actor }));
vi.mock("@/lib/nguon/feature", () => ({ laQuanLyNguonBat: M.nguonBat }));
vi.mock("@/lib/nguon/chup-lai-chu-nguon", () => ({ chupLaiChuNguonMotLo: M.chup }));

import { CO_LO_CHUP_LAI } from "@/lib/nguon/chup-lai-chu-nguon-luat";
import { chupLaiChuNguonAction } from "./_actions-chup-lai";

const DAU_VAO = { nguonId: "ng1", chuDuKien: "emp1", lyDo: "Khai chủ nguồn sau khi lead đã ghi nhận", conTro: null };
const KQ_OK = { ok: true, daChup: 3, boQua: 0, conTro: "att9", hetLead: false, theoLyDo: { THIEU_CHU: 3, CHU_NGHI_VIEC: 0, CHU_KHONG_CON_HO_SO: 0 } };

beforeEach(() => {
  for (const f of Object.values(M)) f.mockReset();
  M.auth.mockResolvedValue({ user: { id: "u1", name: "Quản trị", email: "qt@satarobo.vn" } });
  M.checkPermission.mockResolvedValue(true);
  M.nguonBat.mockResolvedValue(true);
  M.actor.mockResolvedValue({ isSuperAdmin: true, isHoLevel: true });
  M.chup.mockResolvedValue(KQ_OK);
});

describe("[CLC-ACT-01] cổng vào: từ chối TRƯỚC khi chạm dịch vụ", () => {
  it("chưa đăng nhập", async () => {
    M.auth.mockResolvedValue(null);
    expect(await chupLaiChuNguonAction(DAU_VAO)).toMatchObject({ ok: false, error: "Chưa đăng nhập" });
    expect(M.checkPermission).not.toHaveBeenCalled();
    expect(M.chup).not.toHaveBeenCalled();
  });
  it("thiếu sources:manage", async () => {
    M.checkPermission.mockImplementation(async (k: string) => k !== "sources:manage");
    expect(await chupLaiChuNguonAction(DAU_VAO)).toMatchObject({ ok: false, field: "quyen" });
    expect(M.chup).not.toHaveBeenCalled();
  });
  it("thiếu commission_policies:activate", async () => {
    M.checkPermission.mockImplementation(async (k: string) => k !== "commission_policies:activate");
    expect(await chupLaiChuNguonAction(DAU_VAO)).toMatchObject({ ok: false, field: "quyen", error: expect.stringContaining("commission_policies:activate") });
    expect(M.chup).not.toHaveBeenCalled();
  });
  it("cờ quản lý nguồn tắt", async () => {
    M.nguonBat.mockResolvedValue(false);
    expect(await chupLaiChuNguonAction(DAU_VAO)).toMatchObject({ ok: false });
    expect(M.chup).not.toHaveBeenCalled();
  });
  it("dữ liệu lỗi (thiếu nguồn · thiếu chủ dự kiến · con trỏ không phải chuỗi)", async () => {
    for (const v of [{}, { ...DAU_VAO, nguonId: "" }, { ...DAU_VAO, chuDuKien: "" }, { ...DAU_VAO, conTro: 5 }, null, "x"]) {
      expect(await chupLaiChuNguonAction(v), JSON.stringify(v)).toMatchObject({ ok: false });
    }
    expect(M.chup).not.toHaveBeenCalled();
  });
});

describe("[CLC-ACT-02] thành công", () => {
  it("truyền đúng tham số xuống dịch vụ và trả kết quả của lô", async () => {
    const t0 = Date.now();
    const kq = await chupLaiChuNguonAction({ ...DAU_VAO, conTro: "att5" });
    expect(kq).toEqual(KQ_OK);
    expect(M.chup).toHaveBeenCalledTimes(1);
    const g = M.chup.mock.calls[0]![0] as { nguoi: unknown; nguonId: string; chuDuKien: string; lyDo: string; conTro: string; coLo: number; now: Date };
    expect(g).toMatchObject({ nguoi: { userId: "u1", ten: "Quản trị" }, nguonId: "ng1", chuDuKien: "emp1", lyDo: DAU_VAO.lyDo, conTro: "att5", coLo: CO_LO_CHUP_LAI });
    expect(g.now.getTime()).toBeGreaterThanOrEqual(t0);
  });
  it("KHÔNG gọi revalidatePath — kể cả lô cuối ghi dòng: làm mới trang gỡ nút (hết lead) và hộp thoại đang chạy biến mất cùng nút", async () => {
    await chupLaiChuNguonAction(DAU_VAO);
    M.chup.mockResolvedValue({ ...KQ_OK, daChup: 2, hetLead: true, conTro: null });
    await chupLaiChuNguonAction(DAU_VAO);
    expect(M.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("[CLC-ACT-03] dịch vụ từ chối", () => {
  it("trả lỗi kèm tên ô, không làm mới", async () => {
    M.chup.mockResolvedValue({ ok: false, loi: "Người phụ trách nguồn vừa được đổi", truong: "chuDoi" });
    expect(await chupLaiChuNguonAction(DAU_VAO)).toEqual({ ok: false, error: "Người phụ trách nguồn vừa được đổi", field: "chuDoi" });
    expect(M.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("[CLC-ACT-04] hai khoá độc lập", () => {
  it("chỉ khi ĐỦ CẢ HAI mới qua; hỏi đúng hai khoá, theo thứ tự", async () => {
    await chupLaiChuNguonAction(DAU_VAO);
    expect(M.checkPermission.mock.calls.map((c) => c[0])).toEqual(["sources:manage", "commission_policies:activate"]);
    expect(M.chup).toHaveBeenCalledTimes(1);
  });
});

describe("[CLC-ACT-05] phạm vi người bấm (lớp thứ ba)", () => {
  it("đủ hai quyền nhưng KHÔNG có tầm nhìn toàn hệ thống (vai neo ở một cơ sở được cấp thêm vai) ⇒ từ chối, dịch vụ KHÔNG được gọi; đối chứng dương: Quản trị tối cao / Hội sở qua", async () => {
    M.actor.mockResolvedValue({ isSuperAdmin: false, isHoLevel: false });
    expect(await chupLaiChuNguonAction(DAU_VAO)).toMatchObject({ ok: false, field: "quyen", error: expect.stringContaining("mọi cơ sở") });
    expect(M.chup).not.toHaveBeenCalled();
    M.actor.mockResolvedValue({ isSuperAdmin: false, isHoLevel: true });
    expect(await chupLaiChuNguonAction(DAU_VAO)).toMatchObject({ ok: true });
    M.actor.mockResolvedValue({ isSuperAdmin: true, isHoLevel: false });
    expect(await chupLaiChuNguonAction(DAU_VAO)).toMatchObject({ ok: true });
    expect(M.chup).toHaveBeenCalledTimes(2);
  });
  it("hỏi actor của ĐÚNG người đăng nhập, và chỉ SAU hai quyền (thiếu quyền thì không tốn truy vấn actor)", async () => {
    M.checkPermission.mockImplementation(async (k: string) => k !== "commission_policies:activate");
    await chupLaiChuNguonAction(DAU_VAO);
    expect(M.actor).not.toHaveBeenCalled();
    M.checkPermission.mockResolvedValue(true);
    await chupLaiChuNguonAction(DAU_VAO);
    expect(M.actor).toHaveBeenCalledWith("u1");
  });
});
