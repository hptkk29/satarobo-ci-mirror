/**
 * Đơn vị của một người nằm ở HAI bảng — sửa một là sửa cả hai.
 *
 * Test THUẦN với client giả: thứ cần chứng minh là LUẬT (khi nào kéo theo, khi nào không,
 * nhận nhau bằng gì), không phải SQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/audit/audit-log", () => ({ writeAudit: vi.fn(async () => null) }));
// Neo lại vai là việc của `reconcileUserOrgRoles` (đã có test riêng); ở đây chỉ cần biết
// nó CÓ ĐƯỢC GỌI hay không, và gọi với hai đầu neo nào.
vi.mock("@/lib/auth/org-role-sync", () => ({
  reconcileUserOrgRoles: vi.fn(async () => ({ granted: [], revoked: [] })),
}));

import { keoHoSoTheoTaiKhoan, keoTaiKhoanTheoHoSo } from "@/lib/hr/sync-employee-unit";
import { writeAudit } from "@/lib/audit/audit-log";
import { reconcileUserOrgRoles } from "@/lib/auth/org-role-sync";

type Ban = {
  id: string;
  centerId: string | null;
  orgUnitId: string | null;
  employeeId?: string | null;
  // Khớp `select` thật của `keoTaiKhoanTheoHoSo` — thiếu hai ô này thì double nói dối
  // về hình dạng dữ liệu Prisma trả về.
  role?: string;
  roles?: string[];
};

function fakeTx(opts: { taiKhoan?: Ban | null; hoSo?: Ban | null }) {
  const userUpdate = vi.fn(async () => ({}));
  const empUpdate = vi.fn(async () => ({}));
  return {
    tx: {
      user: {
        findFirst: vi.fn(async () =>
          opts.taiKhoan
            ? { role: "TEACHER", roles: [], ...opts.taiKhoan }
            : null,
        ),
        update: userUpdate,
      },
      employee: {
        findUnique: vi.fn(async () => opts.hoSo ?? null),
        update: empUpdate,
      },
    } as never,
    userUpdate,
    empUpdate,
  };
}

const ACTOR = { id: "admin1", name: "Admin" };

beforeEach(() => vi.clearAllMocks());

describe("hồ sơ nhân sự → tài khoản", () => {
  it("đổi cơ sở ở hồ sơ ⇒ tài khoản đổi theo CẢ HAI cột", async () => {
    const { tx, userUpdate } = fakeTx({
      taiKhoan: { id: "u1", centerId: "cs1", orgUnitId: "org-cs1" },
    });
    const coGhi = await keoTaiKhoanTheoHoSo(tx, {
      employeeId: "e1",
      donVi: { centerId: "cs2", orgUnitId: "org-cs2" },
      actor: ACTOR,
    });
    expect(coGhi).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { centerId: "cs2", orgUnitId: "org-cs2" },
    });
  });

  it("chuyển về Hội sở (centerId = null) ⇒ vẫn kéo theo, KHÔNG bỏ qua vì null", async () => {
    // Nhân sự Hội sở có `centerId = null` một cách hợp lệ. Coi null là "không có gì để
    // đồng bộ" là đúng cái làm hồ sơ TGĐ lệch tài khoản suốt mấy tháng.
    const { tx, userUpdate } = fakeTx({
      taiKhoan: { id: "u1", centerId: "cs1", orgUnitId: "org-cs1" },
    });
    await keoTaiKhoanTheoHoSo(tx, {
      employeeId: "e1",
      donVi: { centerId: null, orgUnitId: "org-ho" },
      actor: ACTOR,
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { centerId: null, orgUnitId: "org-ho" },
    });
  });

  it("cùng centerId nhưng KHÁC orgUnitId ⇒ vẫn phải kéo theo", async () => {
    // Ca này KHÔNG hiếm sau P1: mọi phòng ban của Hội sở đều `centerId = null`, phân biệt
    // nhau bằng `orgUnitId`. Chỉ so `centerId` là chuyển người từ phòng Đào tạo sang
    // phòng Kế toán mà tài khoản vẫn nằm phòng cũ.
    const { tx, userUpdate } = fakeTx({
      taiKhoan: { id: "u1", centerId: null, orgUnitId: "org-dao-tao" },
    });
    const coGhi = await keoTaiKhoanTheoHoSo(tx, {
      employeeId: "e1",
      donVi: { centerId: null, orgUnitId: "org-ke-toan" },
      actor: ACTOR,
    });
    expect(coGhi).toBe(true);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { centerId: null, orgUnitId: "org-ke-toan" },
    });
  });

  it("hai bên đã khớp ⇒ KHÔNG ghi, KHÔNG đẻ dòng audit rác", async () => {
    const { tx, userUpdate } = fakeTx({
      taiKhoan: { id: "u1", centerId: "cs1", orgUnitId: "org-cs1" },
    });
    const coGhi = await keoTaiKhoanTheoHoSo(tx, {
      employeeId: "e1",
      donVi: { centerId: "cs1", orgUnitId: "org-cs1" },
      actor: ACTOR,
    });
    expect(coGhi).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("hồ sơ chưa có tài khoản ⇒ no-op, không nổ", async () => {
    const { tx, userUpdate } = fakeTx({ taiKhoan: null });
    expect(
      await keoTaiKhoanTheoHoSo(tx, {
        employeeId: "e1",
        donVi: { centerId: "cs2", orgUnitId: "org-cs2" },
        actor: ACTOR,
      }),
    ).toBe(false);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("có ghi ⇒ có audit, và audit NÓI RÕ đây là đồng bộ tự động", async () => {
    const { tx } = fakeTx({ taiKhoan: { id: "u1", centerId: null, orgUnitId: null } });
    await keoTaiKhoanTheoHoSo(tx, {
      employeeId: "e1",
      donVi: { centerId: "cs2", orgUnitId: "org-cs2" },
      actor: ACTOR,
    });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "User", reason: expect.stringContaining("Đồng bộ") }),
    );
  });
});

describe("tài khoản → hồ sơ nhân sự", () => {
  it("đổi đơn vị ở tài khoản ⇒ hồ sơ đổi theo", async () => {
    const { tx, empUpdate } = fakeTx({ hoSo: { id: "e1", centerId: null, orgUnitId: null } });
    const coGhi = await keoHoSoTheoTaiKhoan(tx, {
      employeeId: "e1",
      donVi: { centerId: "cs1", orgUnitId: "org-cs1" },
      actor: ACTOR,
    });
    expect(coGhi).toBe(true);
    expect(empUpdate).toHaveBeenCalledWith({
      where: { id: "e1" },
      data: { centerId: "cs1", orgUnitId: "org-cs1" },
    });
  });

  it("tài khoản KHÔNG gắn hồ sơ (phụ huynh) ⇒ no-op, và KHÔNG đẻ hồ sơ nhân sự", async () => {
    const { tx, empUpdate } = fakeTx({ hoSo: { id: "e1", centerId: null, orgUnitId: null } });
    expect(
      await keoHoSoTheoTaiKhoan(tx, {
        employeeId: null,
        donVi: { centerId: "cs1", orgUnitId: "org-cs1" },
        actor: ACTOR,
      }),
    ).toBe(false);
    expect(empUpdate).not.toHaveBeenCalled();
  });

  it("employeeId trỏ hồ sơ không tồn tại ⇒ no-op, không nổ", async () => {
    const { tx, empUpdate } = fakeTx({ hoSo: null });
    expect(
      await keoHoSoTheoTaiKhoan(tx, {
        employeeId: "khong-co",
        donVi: { centerId: "cs1", orgUnitId: "org-cs1" },
        actor: ACTOR,
      }),
    ).toBe(false);
    expect(empUpdate).not.toHaveBeenCalled();
  });
});

describe("đổi đơn vị ⇒ NEO LẠI VAI (không thì đổi cơ sở chỉ là đổi nhãn)", () => {
  it("chuyển từ Hội sở về CS1 ⇒ gọi reconcile với đúng hai đầu neo", async () => {
    // Ca thật trên prod: giáo viên parttime neo tại Hội sở ⇒ isHoLevel ⇒ đọc được
    // học viên/điểm danh/nhận xét của MỌI cơ sở. Gán họ về CS1 trên màn nhân sự mà
    // không neo lại vai thì không thu hẹp được gì.
    const { tx } = fakeTx({
      taiKhoan: {
        id: "u-parttime",
        centerId: null,
        orgUnitId: "org-ho",
        role: "TEACHER",
        roles: ["TEACHER"],
      },
    });
    await keoTaiKhoanTheoHoSo(tx, {
      employeeId: "e1",
      donVi: { centerId: "cs1", orgUnitId: "org-cs1" },
      actor: ACTOR,
    });
    expect(reconcileUserOrgRoles).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(reconcileUserOrgRoles).mock.calls[0]?.[0];
    expect(arg?.userId).toBe("u-parttime");
    expect(arg?.previous.orgUnitId).toBe("org-ho");
    expect(arg?.next.orgUnitId).toBe("org-cs1");
    // Vai KHÔNG đổi — chỉ đổi chỗ neo. Đổi vai là đường khác, có lý do bắt buộc.
    expect(arg?.previous.roles).toEqual(arg?.next.roles);
    expect(arg?.reason).toBeTruthy();
  });

  it("đơn vị đích null (người Hội sở) ⇒ KHÔNG neo lại, và không ném lỗi", async () => {
    // `reconcileUserOrgRoles` fail-closed khi không có đơn vị neo. Gọi nó ở đây là
    // chặn luôn việc lưu hồ sơ. Giữ nguyên hiện trạng: không nới quyền cho ai, và
    // nhóm thiếu đơn vị neo do script chẩn đoán rà.
    const { tx, userUpdate } = fakeTx({
      taiKhoan: { id: "u1", centerId: "cs1", orgUnitId: "org-cs1", roles: ["HR"] },
    });
    await expect(
      keoTaiKhoanTheoHoSo(tx, {
        employeeId: "e1",
        donVi: { centerId: null, orgUnitId: null },
        actor: ACTOR,
      }),
    ).resolves.toBe(true);
    expect(userUpdate).toHaveBeenCalled();
    expect(reconcileUserOrgRoles).not.toHaveBeenCalled();
  });

  it("chỉ đổi centerId, giữ nguyên orgUnitId ⇒ KHÔNG neo lại vai", async () => {
    // Neo vai bám `orgUnitId`. Đụng vào `UserOrgRole` khi chỗ neo không đổi là
    // sinh dòng audit rác và một nhịp thu-hồi-rồi-cấp-lại không cần thiết.
    const { tx } = fakeTx({
      taiKhoan: { id: "u1", centerId: null, orgUnitId: "org-cs1", roles: ["TEACHER"] },
    });
    await keoTaiKhoanTheoHoSo(tx, {
      employeeId: "e1",
      donVi: { centerId: "cs1", orgUnitId: "org-cs1" },
      actor: ACTOR,
    });
    expect(reconcileUserOrgRoles).not.toHaveBeenCalled();
  });

  it("tài khoản chưa có vai roles[] ⇒ dùng vai chính, không gọi với mảng rỗng", async () => {
    const { tx } = fakeTx({
      taiKhoan: {
        id: "u1",
        centerId: null,
        orgUnitId: "org-ho",
        role: "SALES_CSM",
        roles: [],
      },
    });
    await keoTaiKhoanTheoHoSo(tx, {
      employeeId: "e1",
      donVi: { centerId: "cs2", orgUnitId: "org-cs2" },
      actor: ACTOR,
    });
    const arg = vi.mocked(reconcileUserOrgRoles).mock.calls[0]?.[0];
    expect(arg?.next.roles).toEqual(["SALES_CSM"]);
  });
});
