// @vitest-environment node
// [BL8-ACT] Cổng của Server Action "Nhập ca bảo lưu cũ": đăng nhập → ĐÚNG quyền (`bao-luu:approve`) → mọi id trình duyệt gửi phải nằm trong tầm nhìn cơ sở
// → mới gọi dịch vụ. Luật nghiệp vụ đã có ca thuần `legacy-nhap.test.ts` và ca Postgres `tests/finance/bao-luu-nhap-legacy.test.ts`.
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  quyen: new Set<string>(),
  dangNhap: true,
  sv: { id: "hv1" } as { id: string } | null,
  gd: { id: "gd1" } as { id: string } | null,
  rs: { id: "r1" } as { id: string } | null,
  xem: vi.fn(),
  nhap: vi.fn(),
  reval: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => h.reval(...a) }));
vi.mock("@/lib/auth", () => ({ auth: async () => (h.dangNhap ? { user: { id: "u-toi", name: "Tôi" } } : null) }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: async (a: string) => h.quyen.has(a) }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: async () => ({ id: "u-toi" }) }));
vi.mock("@/lib/db-scope", () => ({
  scopedDb: () => ({
    student: { findFirst: async () => h.sv },
    enrollment: { findFirst: async () => h.gd },
    studentReserve: { findUnique: async () => h.rs },
  }),
}));
vi.mock("@/lib/bao-luu/legacy-nhap-db", () => ({
  xemTruocLegacy: (...a: unknown[]) => h.xem(...a),
  nhapLegacy: (...a: unknown[]) => h.nhap(...a),
}));

import { nhapLegacyAction, xemTruocLegacyAction } from "./_actions";

const CA = { nhom: "B" as const, studentId: "hv1", enrollmentId: "gd1", reserveId: null, ngayBatDau: "2026-08-15", applicationFileKey: "bao-luu/2026-10/aaaaaaaa11111111.pdf" };
const DAY_DU = ["bao-luu:approve"];

beforeEach(() => {
  h.quyen = new Set(DAY_DU);
  h.dangNhap = true;
  h.sv = { id: "hv1" };
  h.gd = { id: "gd1" };
  h.rs = { id: "r1" };
  for (const f of [h.xem, h.nhap, h.reval]) f.mockReset();
  h.xem.mockResolvedValue({
    ok: true,
    loLoi: [],
    cac: [
      {
        ca: CA, tenHocVien: "An", khoa: "Sata 3", enrollmentTruoc: "PAUSED", loi: [], canhBao: ["x"],
        ke: { hanhDong: "TAO_MOI", startedAt: new Date("2026-08-14T17:00:00Z"), han: new Date("2027-02-28T17:00:00Z"), quaHan: false, soNgayQuaHan: 0, chuyenGhiDanhSangPaused: false, enrollmentId: "gd1" },
      },
    ],
  });
  h.nhap.mockResolvedValue({ ok: true, data: { soCa: 1, reserveIds: ["r9"], classIds: ["l1"] } });
});

const ca = (o: object = {}) => ({ cas: [{ ...CA, ...o }] });
const goiHet = async (v = ca()) => [await xemTruocLegacyAction(v), await nhapLegacyAction(v)];
const chuaGoi = () => {
  expect(h.xem).not.toHaveBeenCalled();
  expect(h.nhap).not.toHaveBeenCalled();
};

describe("[BL8-ACT] cổng của Server Action nhập ca LEGACY", () => {
  it("[BL8-ACT-01] chưa đăng nhập ⇒ cả hai action từ chối, dịch vụ không được gọi", async () => {
    h.dangNhap = false;
    for (const r of await goiHet()) expect(r).toMatchObject({ ok: false, error: "Chưa đăng nhập" });
    chuaGoi();
  });

  it("[BL8-ACT-02] thiếu `bao-luu:approve` (chỉ view/create/center-pause/exception) ⇒ từ chối — KHÔNG đẻ quyền mới, KHÔNG nhận quyền lập", async () => {
    for (const q of [["bao-luu:view"], ["bao-luu:create"], ["bao-luu:center-pause"], ["bao-luu:exception"], ["bao-luu:view", "bao-luu:create"]]) {
      h.quyen = new Set(q);
      for (const r of await goiHet()) expect(r, q.join()).toMatchObject({ ok: false, error: expect.stringContaining("Chỉ Quản lý cơ sở / Admin") });
    }
    chuaGoi();
  });

  it("[BL8-ACT-03] IDOR: học viên / ghi danh / dòng cũ NGOÀI tầm nhìn ⇒ 'không tìm thấy', dịch vụ không được gọi", async () => {
    h.sv = null;
    for (const r of await goiHet()) expect(r).toMatchObject({ ok: false, error: "Không tìm thấy học viên" });
    h.sv = { id: "hv1" };
    h.gd = null;
    for (const r of await goiHet()) expect(r).toMatchObject({ ok: false, error: "Không tìm thấy ghi danh" });
    h.gd = { id: "gd1" };
    h.rs = null;
    for (const r of await goiHet(ca({ nhom: "A", reserveId: "r1" }))) expect(r).toMatchObject({ ok: false, error: "Không tìm thấy dòng bảo lưu" });
    chuaGoi();
  });

  it("[BL8-ACT-04] dữ liệu xấu bị chặn trước dịch vụ: lô rỗng, quá 50 ca, nhóm lạ, ngày sai định dạng", async () => {
    expect(await xemTruocLegacyAction({ cas: [] })).toMatchObject({ ok: false });
    expect(await nhapLegacyAction({ cas: Array.from({ length: 51 }, () => CA) })).toMatchObject({ ok: false, error: expect.stringContaining("tối đa 50") });
    expect(await nhapLegacyAction(ca({ nhom: "Z" as never }))).toMatchObject({ ok: false });
    expect(await nhapLegacyAction(ca({ ngayBatDau: "08/10/2026" }))).toMatchObject({ ok: false });
    chuaGoi();
  });

  it("[BL8-ACT-05] XEM TRƯỚC chỉ gọi dịch vụ xem trước (KHÔNG ghi, KHÔNG revalidate) và trả DTO tuần tự hoá được (ngày dạng ISO)", async () => {
    const r = await xemTruocLegacyAction(ca());
    expect(r).toMatchObject({ ok: true, sanSang: true, loLoi: [] });
    if (!r.ok) return;
    expect(r.cac[0]).toMatchObject({ tenHocVien: "An", trangThaiGhiDanhTruoc: "PAUSED", batDau: "2026-08-14T17:00:00.000Z", han: "2027-02-28T17:00:00.000Z", canhBao: ["x"] });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(h.nhap).not.toHaveBeenCalled();
    expect(h.reval).not.toHaveBeenCalled();
  });

  it("[BL8-ACT-06] GHI gọi dịch vụ ghi với người đang đăng nhập và revalidate; dịch vụ từ chối ⇒ lỗi chuyển nguyên văn, KHÔNG revalidate", async () => {
    const r = await nhapLegacyAction(ca());
    expect(r).toEqual({ ok: true, soCa: 1 });
    expect(h.nhap).toHaveBeenCalledWith([CA], { id: "u-toi", name: "Tôi" }, expect.any(Date));
    expect(h.reval).toHaveBeenCalled();
    expect(h.xem).not.toHaveBeenCalled();

    h.reval.mockClear();
    h.nhap.mockResolvedValue({ ok: false, loi: ["Ca 1 (An): Chưa khai Ngày hiệu lực quy chế", "Ca 2: Thiếu đơn"] });
    expect(await nhapLegacyAction(ca())).toEqual({ ok: false, error: "Ca 1 (An): Chưa khai Ngày hiệu lực quy chế\nCa 2: Thiếu đơn" });
    expect(h.reval).not.toHaveBeenCalled();
  });
});
