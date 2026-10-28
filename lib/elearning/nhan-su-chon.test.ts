import { describe, it, expect } from "vitest";
import type { ScopedDb } from "@/lib/actions/factory";
import { TRAN_NHAN_SU_CHON, dieuKienNhanSuChon, nhanNhanSu, napNhanSuChon } from "./nhan-su-chon";

type Dong = {
  fullName: string;
  employeeCode: string;
  jobTitle: string;
  departmentRef: { name: string } | null;
  userAccount: { id: string } | null;
};

function dbGia(dong: Dong[]) {
  const goi: unknown[] = [];
  const db = {
    employee: {
      findMany: async (args: { take: number }) => {
        goi.push(args);
        return dong.slice(0, args.take);
      },
    },
  } as unknown as ScopedDb;
  return { db, goi };
}

const mot = (i: number, over: Partial<Dong> = {}): Dong => ({
  fullName: `Nhân sự ${i}`,
  employeeCode: `SR.NV.${i}`,
  jobTitle: "Chuyên viên",
  departmentRef: { name: "Phòng Nhân sự" },
  userAccount: { id: `u${i}` },
  ...over,
});

describe("[NSC-01] nhãn nhân sự", () => {
  it("có chức danh + phòng ban thì in cả hai; thiếu thì không in dấu thừa", () => {
    expect(nhanNhanSu(mot(1))).toBe("Nhân sự 1 (SR.NV.1) — Chuyên viên · Phòng Nhân sự");
    expect(nhanNhanSu(mot(2, { departmentRef: null }))).toBe("Nhân sự 2 (SR.NV.2) — Chuyên viên");
    expect(nhanNhanSu(mot(3, { jobTitle: " ", departmentRef: null }))).toBe("Nhân sự 3 (SR.NV.3)");
  });
});

describe("[NSC-02] nạp danh sách", () => {
  it("trả `User.id` (thứ action nhận), KHÔNG phải mã nhân viên; lọc đúng người đang làm + có tài khoản", async () => {
    const { db, goi } = dbGia([mot(1), mot(2)]);
    const r = await napNhanSuChon(db);
    expect(r.ds.map((x) => x.userId)).toEqual(["u1", "u2"]);
    expect(r.daCat).toBe(false);
    const where = (goi[0] as { where: unknown }).where as Record<string, unknown>;
    // Có tài khoản VÀ tài khoản đăng nhập được (cùng ba vế với `lib/auth.ts`): ô chọn không liệt kê người mà server sẽ từ chối.
    expect(where).toMatchObject({
      isActive: true,
      status: "ACTIVE",
      userAccount: { is: { isActive: true, deletedAt: null, accountStatus: "ACTIVE" } },
    });
  });

  it("[NSC-02b] ô chọn và cổng server cùng một vị từ: `dieuKienNhanSuChon(id)` = vị từ liệt kê + đúng id", () => {
    const ds = dieuKienNhanSuChon() as { userAccount: { is: Record<string, unknown> } };
    const mot = dieuKienNhanSuChon("u9") as { userAccount: { is: Record<string, unknown> } };
    expect(mot.userAccount.is).toEqual({ ...ds.userAccount.is, id: "u9" });
    expect({ ...mot, userAccount: undefined }).toEqual({ ...ds, userAccount: undefined });
  });

  it("người không có tài khoản bị loại, không bao giờ ra `undefined` làm userId", async () => {
    const { db } = dbGia([mot(1), mot(2, { userAccount: null }), mot(3)]);
    const r = await napNhanSuChon(db);
    expect(r.ds.map((x) => x.userId)).toEqual(["u1", "u3"]);
  });

  it("vượt trần ⇒ cắt đúng trần và báo `daCat` (không lặng lẽ thiếu người)", async () => {
    const nhieu = Array.from({ length: TRAN_NHAN_SU_CHON + 5 }, (_, i) => mot(i));
    const { db, goi } = dbGia(nhieu);
    const r = await napNhanSuChon(db);
    expect(r.ds).toHaveLength(TRAN_NHAN_SU_CHON);
    expect(r.daCat).toBe(true);
    // đọc trần + 1 để PHÂN BIỆT "đúng trần" với "vượt trần"
    expect((goi[0] as { take: number }).take).toBe(TRAN_NHAN_SU_CHON + 1);
  });

  it("đúng bằng trần ⇒ KHÔNG báo cắt", async () => {
    const { db } = dbGia(Array.from({ length: TRAN_NHAN_SU_CHON }, (_, i) => mot(i)));
    expect((await napNhanSuChon(db)).daCat).toBe(false);
  });
});
