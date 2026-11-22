// @vitest-environment node
/**
 * [AFA-*] — Server Action của tab Affiliate: cổng ĐĂNG NHẬP → QUYỀN → DỮ LIỆU → CỜ chạy ĐÚNG THỨ TỰ và KHÔNG gọi hàm ghi khi bị chặn.
 *
 *   [AFA-01] mọi action chưa đăng nhập ⇒ `ok:false` + hàm ghi KHÔNG được gọi + chưa hỏi quyền (đối chứng thứ tự: auth() đứng trước)
 *   [AFA-02] thiếu `affiliates:manage` ⇒ từ chối, hàm ghi KHÔNG được gọi; quyền được hỏi bằng ĐÚNG khoá `affiliates:manage` (khoá mà giao diện dùng để vẽ nút ghi)
 *   [AFA-03] cờ affiliate TẮT ⇒ từ chối dù có quyền (action là endpoint POST độc lập với trang 404)
 *   [AFA-04] dữ liệu sai hình ⇒ từ chối trước khi chạm hàm ghi
 *   [AFA-05] ĐỐI CHỨNG DƯƠNG: đủ đăng nhập + quyền + cờ ⇒ hàm ghi được gọi ĐÚNG MỘT LẦN với đúng người, đúng tham số (mốc ISO → Date); thành công ⇒ revalidate
 *   [AFA-06] lưới ghim mã nguồn: MỌI `export async function` đều `await auth()` → `checkPermission("affiliates:manage")` → … trước mọi await khác, và có kiểm cờ (action mới quên cổng ⇒ đỏ)
 *
 * Hàm ghi và đọc quyền được GIẢ — luật ghi đã có ca riêng (Postgres thật ở tests/hoa-hong/affiliate-doi-tac.spec.ts); ở đây chỉ canh DÂY NỐI của action.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const M = vi.hoisted(() => ({
  auth: vi.fn(),
  checkPermission: vi.fn(),
  docCoModule: vi.fn(),
  revalidatePath: vi.fn(),
  resolveActor: vi.fn(),
  taoDoiTac: vi.fn(),
  suaDoiTac: vi.fn(),
  doiTrangThaiDoiTac: vi.fn(),
  taoLoai: vi.fn(),
  suaLoai: vi.fn(),
  batTatLoai: vi.fn(),
  taoNhan: vi.fn(),
  suaNhan: vi.fn(),
  batTatNhan: vi.fn(),
  timNguoiGioiThieu: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: M.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: M.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: M.resolveActor }));
vi.mock("@/lib/nguon-hoa-hong/module-scope", () => ({ docCoModule: M.docCoModule }));
vi.mock("next/cache", () => ({ revalidatePath: M.revalidatePath }));
vi.mock("@/lib/affiliate/ghi-doi-tac", () => ({ taoDoiTac: M.taoDoiTac, suaDoiTac: M.suaDoiTac, doiTrangThaiDoiTac: M.doiTrangThaiDoiTac }));
vi.mock("@/lib/affiliate/ghi-loai-nhan", () => ({
  taoLoai: M.taoLoai,
  suaLoai: M.suaLoai,
  batTatLoai: M.batTatLoai,
  taoNhan: M.taoNhan,
  suaNhan: M.suaNhan,
  batTatNhan: M.batTatNhan,
}));
vi.mock("@/lib/nguon/tim-nguoi-gioi-thieu", () => ({ timNguoiGioiThieu: M.timNguoiGioiThieu }));

import * as A from "./_actions";

const MOC = "2026-10-13T03:00:00.000Z";
const NGUOI = { userId: "u-1", ten: "Marketing Hội sở" };
const KQ_OK = { ok: true, doi: true, truongDoi: ["name"], capNhatLuc: MOC, id: "x", ma: "MA", trangThai: "ACTIVE", den: "ACTIVE", dangDung: true };

type Ca = {
  ten: string;
  chay: () => Promise<unknown>;
  ghi: ReturnType<typeof vi.fn>;
  /** Tham số hàm ghi phải nhận khi mọi cổng qua. */
  mong: Record<string, unknown>;
  /** Có `revalidatePath` khi thành công (sửa không đổi gì thì không). */
  revalidate: boolean;
};

const VAO = { vao: { a: 1 } };
const SUA = { id: "id-1", updatedAtDaThay: MOC, vao: { a: 1 }, lyDo: "  lý do  " };
const DOI = { id: "id-1", updatedAtDaThay: MOC, den: "SUSPENDED", lyDo: LY() };
const TAT = { id: "id-1", updatedAtDaThay: MOC, batLai: false, lyDo: LY() };
function LY(): string {
  return "Lý do đủ dài để qua cổng";
}

const CA: Ca[] = [
  { ten: "taoDoiTacAction", chay: () => A.taoDoiTacAction(VAO), ghi: M.taoDoiTac, mong: { nguoi: NGUOI, vao: VAO.vao }, revalidate: true },
  { ten: "suaDoiTacAction", chay: () => A.suaDoiTacAction(SUA), ghi: M.suaDoiTac, mong: { nguoi: NGUOI, id: "id-1", updatedAtDaThay: new Date(MOC), vao: SUA.vao, lyDo: "lý do" }, revalidate: true },
  {
    ten: "doiTrangThaiDoiTacAction",
    chay: () => A.doiTrangThaiDoiTacAction(DOI),
    ghi: M.doiTrangThaiDoiTac,
    mong: { nguoi: NGUOI, id: "id-1", updatedAtDaThay: new Date(MOC), den: "SUSPENDED", lyDo: LY(), now: expect.any(Date) },
    revalidate: true,
  },
  { ten: "taoLoaiAction", chay: () => A.taoLoaiAction(VAO), ghi: M.taoLoai, mong: { nguoi: NGUOI, vao: VAO.vao }, revalidate: true },
  { ten: "suaLoaiAction", chay: () => A.suaLoaiAction({ id: "id-1", updatedAtDaThay: MOC, vao: { a: 1 } }), ghi: M.suaLoai, mong: { nguoi: NGUOI, id: "id-1", updatedAtDaThay: new Date(MOC), vao: { a: 1 } }, revalidate: true },
  { ten: "batTatLoaiAction", chay: () => A.batTatLoaiAction(TAT), ghi: M.batTatLoai, mong: { nguoi: NGUOI, id: "id-1", updatedAtDaThay: new Date(MOC), batLai: false, lyDo: LY() }, revalidate: true },
  { ten: "taoNhanAction", chay: () => A.taoNhanAction(VAO), ghi: M.taoNhan, mong: { nguoi: NGUOI, vao: VAO.vao }, revalidate: true },
  { ten: "suaNhanAction", chay: () => A.suaNhanAction({ id: "id-1", updatedAtDaThay: MOC, vao: { a: 1 } }), ghi: M.suaNhan, mong: { nguoi: NGUOI, id: "id-1", updatedAtDaThay: new Date(MOC), vao: { a: 1 } }, revalidate: true },
  { ten: "batTatNhanAction", chay: () => A.batTatNhanAction(TAT), ghi: M.batTatNhan, mong: { nguoi: NGUOI, id: "id-1", updatedAtDaThay: new Date(MOC), batLai: false, lyDo: LY() }, revalidate: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  M.auth.mockResolvedValue({ user: { id: "u-1", name: "Marketing Hội sở", email: "mk@satarobo.vn" } });
  M.checkPermission.mockResolvedValue(true);
  M.docCoModule.mockResolvedValue({ nguon: true, engine: true, affiliate: true });
  M.resolveActor.mockResolvedValue({ userId: "u-1" });
  for (const f of [M.taoDoiTac, M.suaDoiTac, M.doiTrangThaiDoiTac, M.taoLoai, M.suaLoai, M.batTatLoai, M.taoNhan, M.suaNhan, M.batTatNhan]) f.mockResolvedValue(KQ_OK);
  M.timNguoiGioiThieu.mockResolvedValue([{ loai: "NHAN_SU", employeeId: "e1", ten: "Nguyễn Văn A", ma: "NV001", vai: "SALE" }]);
});

describe("[AFA-01] chưa đăng nhập", () => {
  for (const c of CA) {
    it(`${c.ten}: ok:false, KHÔNG hỏi quyền, KHÔNG gọi hàm ghi`, async () => {
      M.auth.mockResolvedValue(null);
      const r = (await c.chay()) as { ok: boolean; truong?: string };
      expect(r.ok).toBe(false);
      expect(r.truong).toBe("quyen");
      expect(M.checkPermission).not.toHaveBeenCalled();
      expect(c.ghi).not.toHaveBeenCalled();
      expect(M.revalidatePath).not.toHaveBeenCalled();
    });
  }
  it("timNhanVienAction: ok:false và không tìm", async () => {
    M.auth.mockResolvedValue({ user: {} }); // có phiên nhưng không có id
    expect(await A.timNhanVienAction({ q: "an" })).toMatchObject({ ok: false });
    expect(M.timNguoiGioiThieu).not.toHaveBeenCalled();
  });
});

describe("[AFA-02] thiếu quyền", () => {
  for (const c of CA) {
    it(`${c.ten}: từ chối, nêu khoá, KHÔNG gọi hàm ghi; hỏi ĐÚNG khoá affiliates:manage`, async () => {
      M.checkPermission.mockResolvedValue(false);
      const r = (await c.chay()) as { ok: boolean; loi?: string; truong?: string };
      expect(r.ok).toBe(false);
      expect(r.loi).toContain("affiliates:manage");
      expect(r.truong).toBe("quyen");
      expect(M.checkPermission.mock.calls.map((x) => x[0])).toEqual(["affiliates:manage"]);
      expect(M.docCoModule).not.toHaveBeenCalled(); // quyền đứng TRƯỚC cờ
      expect(c.ghi).not.toHaveBeenCalled();
    });
  }
  it("timNhanVienAction: thiếu quyền ⇒ không tìm (người chỉ có affiliates:view không dò được danh bạ nhân viên)", async () => {
    M.checkPermission.mockResolvedValue(false);
    expect(await A.timNhanVienAction({ q: "an" })).toMatchObject({ ok: false });
    expect(M.timNguoiGioiThieu).not.toHaveBeenCalled();
    expect(M.checkPermission.mock.calls.map((x) => x[0])).toEqual(["affiliates:manage"]);
  });
});

describe("[AFA-03] cờ affiliate tắt", () => {
  for (const c of CA) {
    it(`${c.ten}: có quyền mà cờ tắt ⇒ từ chối, KHÔNG gọi hàm ghi`, async () => {
      M.docCoModule.mockResolvedValue({ nguon: true, engine: true, affiliate: false });
      const r = (await c.chay()) as { ok: boolean; loi?: string };
      expect(r.ok).toBe(false);
      expect(r.loi).toMatch(/chưa được bật/);
      expect(c.ghi).not.toHaveBeenCalled();
    });
  }
  it("timNhanVienAction: cờ tắt ⇒ không tìm", async () => {
    M.docCoModule.mockResolvedValue({ nguon: true, engine: true, affiliate: false });
    expect(await A.timNhanVienAction({ q: "an" })).toMatchObject({ ok: false });
    expect(M.timNguoiGioiThieu).not.toHaveBeenCalled();
  });
});

describe("[AFA-04] dữ liệu sai hình", () => {
  it("thiếu id / mốc thời gian rác / trạng thái lạ ⇒ từ chối trước khi chạm hàm ghi", async () => {
    expect(await A.suaDoiTacAction({ vao: {}, lyDo: null })).toMatchObject({ ok: false });
    expect(await A.suaDoiTacAction({ ...SUA, updatedAtDaThay: "không phải ngày" })).toMatchObject({ ok: false });
    expect(await A.doiTrangThaiDoiTacAction({ ...DOI, den: "XOA_SACH" })).toMatchObject({ ok: false });
    expect(await A.batTatLoaiAction({ ...TAT, batLai: "có" })).toMatchObject({ ok: false });
    expect(await A.taoDoiTacAction({ vao: "không phải đối tượng" })).toMatchObject({ ok: false });
    expect(await A.taoLoaiAction(null)).toMatchObject({ ok: false });
    for (const f of [M.taoDoiTac, M.suaDoiTac, M.doiTrangThaiDoiTac, M.taoLoai, M.batTatLoai]) expect(f).not.toHaveBeenCalled();
  });
});

describe("[AFA-05] đối chứng dương: đủ đăng nhập + quyền + cờ", () => {
  for (const c of CA) {
    it(`${c.ten}: gọi hàm ghi ĐÚNG MỘT LẦN với đúng tham số; thành công ⇒ revalidate`, async () => {
      const r = (await c.chay()) as { ok: boolean };
      expect(r.ok).toBe(true);
      expect(c.ghi).toHaveBeenCalledTimes(1);
      expect(c.ghi).toHaveBeenCalledWith(c.mong);
      expect(M.revalidatePath).toHaveBeenCalledWith("/admin/nguon-hoa-hong/affiliate");
    });
  }
  it("thất bại của hàm ghi được trả NGUYÊN VĂN và KHÔNG revalidate", async () => {
    M.suaDoiTac.mockResolvedValue({ ok: false, loi: "Đối tác vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" });
    expect(await A.suaDoiTacAction(SUA)).toEqual({ ok: false, loi: "Đối tác vừa được người khác thay đổi — hãy tải lại rồi thử lại.", truong: "vuaDoi" });
    expect(M.revalidatePath).not.toHaveBeenCalled();
  });
  it("sửa mà không đổi gì (doi:false) ⇒ không revalidate", async () => {
    M.suaDoiTac.mockResolvedValue({ ok: true, doi: false, truongDoi: [], capNhatLuc: MOC });
    await A.suaDoiTacAction(SUA);
    expect(M.revalidatePath).not.toHaveBeenCalled();
  });
  it("timNhanVienAction: tìm NHAN_SU, không tìm theo SĐT, không xem PII, giới hạn 8", async () => {
    const r = await A.timNhanVienAction({ q: "an" });
    expect(r).toMatchObject({ ok: true });
    expect(M.timNguoiGioiThieu).toHaveBeenCalledWith({ userId: "u-1" }, expect.objectContaining({ loai: "NHAN_SU", q: "an", gioiHan: 8, coTheTimTheoSdt: false, canViewPii: false }));
  });
});

// ── [AFA-06] lưới ghim mã nguồn ────────────────────────────────────────────────────────────────────

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const NGUON = boChuThich(readFileSync(resolve(process.cwd(), "app/(admin)/admin/nguon-hoa-hong/affiliate/_actions.ts"), "utf8"));

/** Thân hàm `export async function <ten>(...) { ... }` — đếm ngoặc nhọn. */
function thanHam(src: string, ten: string): string {
  const bat = src.indexOf(`export async function ${ten}(`);
  if (bat < 0) throw new Error(`không thấy ${ten}`);
  const mo = src.indexOf("{", src.indexOf(")", bat));
  let sau = 0;
  for (let j = mo; j < src.length; j++) {
    if (src[j] === "{") sau++;
    else if (src[j] === "}" && --sau === 0) return src.slice(mo + 1, j);
  }
  throw new Error(`thân ${ten} không đóng`);
}

describe("[AFA-06] lưới ghim mã nguồn của tệp action", () => {
  const TEN = [...NGUON.matchAll(/export\s+async\s+function\s+(\w+)\s*\(/g)].map((m) => m[1]!);

  it("tệp 'use server' và CHỈ export hàm async (mọi export khác thành endpoint POST hoặc làm vỡ build)", () => {
    expect(readFileSync(resolve(process.cwd(), "app/(admin)/admin/nguon-hoa-hong/affiliate/_actions.ts"), "utf8").trimStart().startsWith('"use server"')).toBe(true);
    const exports = [...NGUON.matchAll(/^export\s+(?!async\s+function\b)(\w+)/gm)].map((m) => m[1]);
    expect(exports.filter((e) => e !== "type"), "export không phải hàm async").toEqual([]);
  });

  it("đủ 10 action (9 ghi + 1 tìm nhân viên) — thêm action phải sửa lưới này", () => {
    expect(TEN.sort()).toEqual(
      [
        "batTatLoaiAction",
        "batTatNhanAction",
        "doiTrangThaiDoiTacAction",
        "suaDoiTacAction",
        "suaLoaiAction",
        "suaNhanAction",
        "taoDoiTacAction",
        "taoLoaiAction",
        "taoNhanAction",
        "timNhanVienAction",
      ].sort(),
    );
  });

  it("mỗi action: await auth() → checkPermission(\"affiliates:manage\") → các await khác; có kiểm cờ docCoModule().affiliate SAU quyền", () => {
    for (const ten of TEN) {
      const than = thanHam(NGUON, ten);
      const iAuth = than.search(/await\s+auth\s*\(\s*\)/);
      const iQuyen = than.search(/await\s+checkPermission\(\s*"affiliates:manage"\s*\)/);
      const iCo = than.search(/\(await\s+docCoModule\(\)\)\.affiliate/);
      expect(iAuth, `${ten}: thiếu await auth()`).toBeGreaterThanOrEqual(0);
      expect(iQuyen, `${ten}: thiếu checkPermission("affiliates:manage")`).toBeGreaterThan(iAuth);
      expect(iCo, `${ten}: thiếu kiểm cờ`).toBeGreaterThan(iQuyen);
      // await ĐẦU TIÊN ngoài auth/checkPermission phải đứng SAU cổng quyền
      const re = /\bawait\s+([A-Za-z_$][\w$.]*)/g;
      for (let x = re.exec(than); x; x = re.exec(than)) {
        if (x[1] === "auth" || x[1] === "checkPermission") continue;
        expect(x.index, `${ten}: await ${x[1]} đứng trước cổng quyền`).toBeGreaterThan(iQuyen);
        break;
      }
    }
  });

  it("không import @/lib/db trần (ESLint cấm trong app/(admin)) và không so vai tại chỗ", () => {
    expect(NGUON).not.toMatch(/from\s+["']@\/lib\/db["']/);
    expect(NGUON).not.toMatch(/\.role\b|\broles\b\s*\.|isSuperAdmin/);
  });
});
