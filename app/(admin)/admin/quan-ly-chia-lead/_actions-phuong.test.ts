/**
 * [CTA-*] Server Action `luuChiaTheoPhuongAction` — cổng quyền, HAI chế độ.
 *   [CTA-01] chưa đăng nhập / không giữ quyền nào của màn ⇒ từ chối, KHÔNG gọi lib ghi nào
 *   [CTA-02] giữ `leads:assign-config` nhưng KHÔNG ở mọi cơ sở (Quản lý cơ sở được cấp GLOBAL) ⇒ KHÔNG vào chế độ toàn hệ thống: không có `lead_pool:manage` ⇒ từ chối
 *   [CTA-03] giữ `leads:assign-config` ở MỌI cơ sở (Quản trị tối cao · dòng quyền ALL · grant toàn cục) ⇒ ghi toàn hệ thống, kèm công tắc
 *   [CTA-04] đầu vào sai hình ⇒ lỗi rõ, KHÔNG ghi; kết quả lỗi của lib được trả nguyên
 *   [CTA-05] dây nối: tab chỉ hiện với cùng điều kiện mà action tự kiểm lại
 *   [CTA-06] Quản lý cơ sở (`lead_pool:manage`): ghi PHẦN CƠ SỞ MÌNH — cơ sở lấy từ quyền thật phía máy chủ, công tắc KHÔNG được chuyển đi
 *   [CTA-07] Quản lý cơ sở không quản lý cơ sở nào nhận lead ⇒ từ chối, không ghi
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  quyen: new Set<string>(),
  checkPermission: vi.fn(),
  resolveActor: vi.fn(),
  luu: vi.fn(),
  luuCoSo: vi.fn(),
  coSoCuaToi: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/auth/check-permission", () => ({ checkPermission: h.checkPermission }));
vi.mock("@/lib/auth/actor", () => ({ resolveActor: h.resolveActor }));
vi.mock("@/lib/lead/chia-theo-phuong-ghi", () => ({
  luuCauHinhPhuong: h.luu,
  luuPhuongCuaCoSo: h.luuCoSo,
  coSoCauHinhPhuongCuaToi: h.coSoCuaToi,
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));

import { luuChiaTheoPhuongAction } from "./_actions-phuong";

// Hình dạng actor mà `tamNhinCuaKhoa` đọc: isSuperAdmin · grantsAllow · permissions[{ action, centerScope }].
const KHOA = "leads:assign-config";
const HO_SO = { isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: [{ action: KHOA, centerScope: "ALL" }] };
const QLCS = { isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: [{ action: KHOA, centerScope: ["cs1"] }] };
const KHAC_KHOA = { isSuperAdmin: false, grantsAllow: new Set<string>(), permissions: [{ action: "leads:view", centerScope: "ALL" }] };
const QTTC = { isSuperAdmin: true, grantsAllow: new Set<string>(), permissions: [] };
const GRANT = { isSuperAdmin: false, grantsAllow: new Set<string>([KHOA]), permissions: [] };

const HOP_LE = { bat: true, thanhPho: "Tp Đà Nẵng", dong: [{ phuong: "Phường Hải Châu", coSoId: "cs2" }, { phuong: "Phường An Hải", coSoId: null }] };

beforeEach(() => {
  h.auth.mockReset().mockResolvedValue({ user: { id: "u1", name: "Quản trị", email: "a@x.vn" } });
  h.quyen.clear();
  h.quyen.add(KHOA).add("lead_pool:manage");
  h.checkPermission.mockReset().mockImplementation(async (k: string) => h.quyen.has(k));
  h.resolveActor.mockReset().mockResolvedValue(HO_SO);
  h.luu.mockReset().mockResolvedValue({ ok: true, bat: true, soPhuongDaDat: 1 });
  h.luuCoSo.mockReset().mockResolvedValue({ ok: true, bat: false, soPhuongDaDat: 2 });
  h.coSoCuaToi.mockReset().mockResolvedValue([{ id: "cs1", name: "Cơ sở 1" }]);
  h.revalidatePath.mockClear();
});

const khongGhiGi = () => {
  expect(h.luu).not.toHaveBeenCalled();
  expect(h.luuCoSo).not.toHaveBeenCalled();
  expect(h.revalidatePath).not.toHaveBeenCalled();
};

describe("[CTA-01] chưa đăng nhập / không giữ quyền nào của màn", () => {
  it("chưa đăng nhập", async () => {
    h.auth.mockResolvedValue(null);
    expect(await luuChiaTheoPhuongAction(HOP_LE)).toEqual({ ok: false, error: "Chưa đăng nhập" });
    khongGhiGi();
  });
  it("không giữ leads:assign-config lẫn lead_pool:manage", async () => {
    h.quyen.clear();
    h.resolveActor.mockResolvedValue(KHAC_KHOA);
    expect(await luuChiaTheoPhuongAction(HOP_LE)).toEqual({ ok: false, error: "Không có quyền" });
    khongGhiGi();
  });
});

describe("[CTA-02] có leads:assign-config nhưng không ở mọi cơ sở", () => {
  it("QLCS@CS1 được cấp assign-config mà KHÔNG có lead_pool:manage ⇒ từ chối", async () => {
    h.quyen.delete("lead_pool:manage");
    h.resolveActor.mockResolvedValue(QLCS);
    expect(await luuChiaTheoPhuongAction(HOP_LE)).toEqual({ ok: false, error: "Không có quyền" });
    khongGhiGi();
  });
  it("QLCS@CS1 được cấp assign-config + có lead_pool:manage ⇒ KHÔNG ghi toàn hệ thống (đối chứng của CTA-03): rơi vào chế độ cơ sở", async () => {
    h.resolveActor.mockResolvedValue(QLCS);
    await luuChiaTheoPhuongAction(HOP_LE);
    expect(h.luu).not.toHaveBeenCalled();
    expect(h.luuCoSo).toHaveBeenCalledTimes(1);
  });
});

describe("[CTA-03] giữ leads:assign-config ở mọi cơ sở", () => {
  it.each([["Hội sở (centerScope ALL)", HO_SO], ["Quản trị tối cao", QTTC], ["grant toàn cục", GRANT]])("%s ⇒ ghi toàn hệ thống", async (_ten, actor) => {
    h.resolveActor.mockResolvedValue(actor);
    const r = await luuChiaTheoPhuongAction({ ...HOP_LE, thanhPho: "  Tp Đà Nẵng  " });
    expect(r).toEqual({ ok: true, bat: true, soPhuongDaDat: 1 });
    expect(h.luu).toHaveBeenCalledWith({ bat: true, thanhPho: "Tp Đà Nẵng", dong: HOP_LE.dong, actor: { id: "u1", name: "Quản trị" } });
    expect(h.luuCoSo).not.toHaveBeenCalled();
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/quan-ly-chia-lead");
  });
  it("Quản trị chỉ có assign-config (không có lead_pool:manage) vẫn ghi được", async () => {
    h.quyen.delete("lead_pool:manage");
    expect((await luuChiaTheoPhuongAction(HOP_LE)).ok).toBe(true);
    expect(h.luu).toHaveBeenCalledTimes(1);
  });
});

describe("[CTA-04] đầu vào sai / lib báo lỗi", () => {
  it.each([
    [null],
    [{}],
    [{ ...HOP_LE, bat: "có" }],
    [{ ...HOP_LE, thanhPho: "" }],
    [{ ...HOP_LE, dong: [{ phuong: "", coSoId: null }] }],
    [{ ...HOP_LE, dong: Array.from({ length: 401 }, () => ({ phuong: "P", coSoId: null })) }],
  ])("%j ⇒ lỗi, không ghi (cả hai chế độ)", async (raw) => {
    expect((await luuChiaTheoPhuongAction(raw)).ok).toBe(false);
    h.resolveActor.mockResolvedValue(QLCS);
    expect((await luuChiaTheoPhuongAction(raw)).ok).toBe(false);
    khongGhiGi();
  });
  it("lib báo lỗi ⇒ trả nguyên, không revalidate (toàn hệ thống và cơ sở)", async () => {
    h.luu.mockResolvedValue({ ok: false, error: "Cơ sở không còn nhận lead mới." });
    expect(await luuChiaTheoPhuongAction(HOP_LE)).toEqual({ ok: false, error: "Cơ sở không còn nhận lead mới." });
    h.resolveActor.mockResolvedValue(QLCS);
    h.luuCoSo.mockResolvedValue({ ok: false, error: "«Phường Hải Châu» đang thuộc cơ sở khác — chỉ Quản trị đổi được." });
    expect((await luuChiaTheoPhuongAction(HOP_LE)).ok).toBe(false);
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("[CTA-06] Quản lý cơ sở ghi phần cơ sở mình", () => {
  it("cơ sở lấy từ quyền thật phía máy chủ; công tắc KHÔNG chuyển đi; có revalidate", async () => {
    h.quyen.delete(KHOA);
    h.resolveActor.mockResolvedValue({ ...QLCS, permissions: [{ action: "lead_pool:manage", centerScope: ["cs1"] }] });
    const r = await luuChiaTheoPhuongAction({ ...HOP_LE, bat: true });
    expect(r).toEqual({ ok: true, bat: false, soPhuongDaDat: 2 });
    expect(h.luuCoSo).toHaveBeenCalledWith({ thanhPho: "Tp Đà Nẵng", dong: HOP_LE.dong, coSoCuaToi: ["cs1"], actor: { id: "u1", name: "Quản trị" } });
    const doiso = h.luuCoSo.mock.calls[0]![0];
    expect(doiso).not.toHaveProperty("bat");
    expect(h.luu).not.toHaveBeenCalled();
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/quan-ly-chia-lead");
  });
  it("cơ sở do CLIENT khai trong đầu vào bị bỏ qua — chỉ tin tập tính ở máy chủ", async () => {
    h.quyen.delete(KHOA);
    h.resolveActor.mockResolvedValue(QLCS);
    await luuChiaTheoPhuongAction({ ...HOP_LE, coSoCuaToi: ["cs2", "cs3"] });
    expect(h.luuCoSo.mock.calls[0]![0].coSoCuaToi).toEqual(["cs1"]);
  });
});

describe("[CTA-07] Quản lý cơ sở không quản lý cơ sở nào nhận lead", () => {
  it("tập rỗng ⇒ từ chối, không ghi", async () => {
    h.quyen.delete(KHOA);
    h.coSoCuaToi.mockResolvedValue([]);
    h.resolveActor.mockResolvedValue(QLCS);
    expect(await luuChiaTheoPhuongAction(HOP_LE)).toEqual({ ok: false, error: "Bạn chưa quản lý cơ sở nào đang nhận lead." });
    khongGhiGi();
  });
});

describe("[CTA-05] dây nối trang", () => {
  const page = readFileSync(resolve(process.cwd(), "app/(admin)/admin/quan-ly-chia-lead/page.tsx"), "utf8").replace(/\r\n/g, "\n");
  const action = readFileSync(resolve(process.cwd(), "app/(admin)/admin/quan-ly-chia-lead/_actions-phuong.ts"), "utf8");
  it("toàn hệ thống: CÙNG phép đo ở trang và action (giữ leads:assign-config ở MỌI cơ sở)", () => {
    expect(page).toMatch(/const toanHePhuong = laQuanTri && tamNhinCuaKhoa\(actor, "leads:assign-config"\) === "ALL";/);
    expect(action).toMatch(/\(await checkPermission\("leads:assign-config"\)\) && tamNhinCuaKhoa\(actor, "leads:assign-config"\) === "ALL"/);
  });
  it("Quản lý cơ sở: CÙNG nguồn «cơ sở của tôi» ở trang và action, và tab chỉ hiện khi có ít nhất một cơ sở", () => {
    expect(page).toMatch(/await coSoCauHinhPhuongCuaToi\(actor\)/);
    expect(action).toMatch(/await coSoCauHinhPhuongCuaToi\(actor\)/);
    expect(page).toMatch(/const coTabPhuong = toanHePhuong \|\| coSoPhuongCuaToi\.length > 0;/);
    expect(page.match(/coTabPhuong/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // định nghĩa · chọn tab · hiện nhãn tab
  });
  it("?tab=phuong chỉ có tác dụng khi coTabPhuong (không mở tab bằng URL cho người không đủ quyền)", () => {
    expect(page).toMatch(/sp\.tab === "phuong" && coTabPhuong \? "phuong" : "pool"/);
  });
  it("chế độ cơ sở KHÔNG chuyển công tắc `bat` xuống lib", () => {
    const khoi = action.slice(action.indexOf("luuPhuongCuaCoSo({"), action.indexOf("luuPhuongCuaCoSo({") + 200);
    expect(khoi).not.toMatch(/\bbat\b/);
  });
});
