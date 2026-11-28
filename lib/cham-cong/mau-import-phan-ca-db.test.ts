// [MIPDB-*] Người trong file mẫu import = CHỈ nhân sự còn ACTIVE. Lưới (`loadLuoiPhanCa`) giả lập:
// nó chỉ biết "ai có ca", không biết ai đã nghỉ việc — nên người nghỉ việc còn ca cũ phải bị lọc ở đây.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cham-cong/luoi-phan-ca-db", () => ({
  loadLuoiPhanCa: vi.fn(async () => ({
    rows: [
      { userId: "u-hoat-dong", name: "Cô Hoạt Động", jobLabel: "Giáo viên", cells: { 3: { code: "CG" } } },
      { userId: "u-da-nghi", name: "Cô Đã Nghỉ", jobLabel: "Giáo viên", cells: { 4: { code: "CG" } } },
      { userId: "u-kiem-nhiem", name: "Thầy Kiêm Nhiệm", jobLabel: "Giáo viên", cells: { 5: { code: "CG", foreignUnit: "CS1" } } },
    ],
    templates: [
      { code: "CG", name: "Ca gãy", segments: [{ kind: "WORK", start: "08:00", end: "11:30" }], dayCredit: 1, soCapQuetKyVong: 2 },
    ],
  })),
}));

import { docDauVaoMau } from "@/lib/cham-cong/mau-import-phan-ca-db";

const NHAN_SU_ACTIVE = [
  { fullName: "Cô Hoạt Động", jobTitle: "Giáo viên", userAccount: { id: "u-hoat-dong", name: "x" } },
  { fullName: "Thầy Kiêm Nhiệm", jobTitle: "Giáo viên", userAccount: { id: "u-kiem-nhiem", name: "x" } },
  { fullName: "Bạn Mới Vào", jobTitle: "Tư vấn", userAccount: { id: "u-moi", name: "x" } },
];

function sdbGia() {
  const employeeFindMany = vi.fn(async () => NHAN_SU_ACTIVE);
  const sdb = {
    shiftWeeklyPattern: { findMany: vi.fn(async () => []) },
    employee: { findMany: employeeFindMany },
  };
  return { sdb: sdb as never, employeeFindMany };
}

describe("[MIPDB] docDauVaoMau — chỉ nhân sự còn ACTIVE", () => {
  const chung = { coSo: "cs2", ky: "2026-10", donVi: "CS2" as const, nhanKhoi: "CS2", orgUnitId: null, unitOf: () => "CS2", today: "2026-10-20" };

  it("[MIPDB-01] người đã nghỉ việc (còn ca cũ trên lưới) không có tên; người mới vào có hàng trống", async () => {
    const { sdb } = sdbGia();
    const v = await docDauVaoMau({ ...chung, sdb });
    expect(v.nguoi.map((n) => n.ten)).toEqual(["Cô Hoạt Động", "Bạn Mới Vào"]);
    expect(v.nguoi[0].o).toEqual({ 3: "CG" });
    expect(v.nguoi[1].o).toEqual({});
    expect(v.nguoiKiemNhiem).toEqual(["Thầy Kiêm Nhiệm"]);
  });

  it("[MIPDB-02] truy vấn nhân sự lọc status ACTIVE", async () => {
    const { sdb, employeeFindMany } = sdbGia();
    await docDauVaoMau({ ...chung, sdb });
    const arg = employeeFindMany.mock.calls[0] as unknown as [{ where: { status: string } }];
    expect(arg[0].where.status).toBe("ACTIVE");
  });

  it("[MIPDB-03] danh mục ca chỉ mang mã / tên / giờ — không công, không lần chấm", async () => {
    const { sdb } = sdbGia();
    const v = await docDauVaoMau({ ...chung, sdb });
    expect(v.maCa).toEqual([{ code: "CG", name: "Ca gãy", gio: "08:00–11:30" }]);
  });
});
