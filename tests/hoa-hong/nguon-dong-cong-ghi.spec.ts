// @vitest-environment node
/**
 * [W2G-*] — CỔNG «ĐỤNG TIỀN» CHUNG của đường ghi danh mục nguồn + Page → nguồn (Postgres THẬT). W2, 10/10/2026 — gt3 R3-M2/M3/M5 · gt2 R1-M1/M4 · gt1 R2-M1.
 *
 *   [W2G-01] MA TRẬN QUYỀN: cờ `coQuyenKichHoat` lấy từ `can()` trên vai THẬT (HO_MARKETING: không · Giám đốc: có · Quản trị tối cao: có); nguồn có chính sách riêng đang ACTIVE —
 *            Marketing vẫn sửa TÊN/mô tả, nhưng KHÔNG ngừng · tắt chọn · dời Page vào/ra; hai vai có quyền thì làm được (đối chứng dương)
 *   [W2G-02] TẠO / KÍCH HOẠT: rule SOURCE_OWNER chung đang chạy — tạo nguồn ACTIVE có chủ cần quyền; «tạo Nháp rồi Kích hoạt» KHÔNG đi vòng qua cổng; không có rule thì không đòi
 *   [W2G-03] TẮT `commissionEnabled` khi chính sách riêng có dòng THU HÚT ⇒ CHẶN kể cả người đủ quyền; chỉ gồm EXCLUDE ⇒ tắt được; nguồn không chính sách ⇒ tắt được
 *   [W2G-04] HẠ TRẦN `crm.commissionMaxTotalRate` dưới tổng chính sách đang ACTIVE ⇒ TỪ CHỐI kèm tổng + chính sách + đường lui; nâng / giữ nguyên / không chính sách ⇒ qua;
 *            và `saveGlobalSettingAction` thật sự gọi phép kiểm (khoá lưu KHÔNG đổi khi bị chặn)
 *   [W2G-05] KHOÁ: bốn đường ghi đều chờ khoá advisory chính sách; đọc bảng Page→nguồn / trạng thái nhóm đích TRONG transaction sau khoá (không đọc bản cũ trước khoá)
 *   [W2G-06] NÚT ≡ CỔNG trên dữ liệu THẬT: dữ liệu nút lấy từ `docDanhMucNguon`; mọi nút `thaoTacTrangThai` vẽ ra thì `doiTrangThaiNguon` THẬT nhận, mọi lý do «không có nút» thì cổng thật từ chối
 *   [W2G-07] `docDinhTienNguon`: chính sách riêng · dòng thu hút · rule chủ-nguồn (chung / riêng / bất kỳ) đọc đúng từ DB
 *   [W2G-08] `luuPageMappingAction` (RBAC v2 thật): lý do bắt buộc khi đổi nguồn; nguồn dính tiền + vai thiếu quyền ⇒ field `quyen`, bảng KHÔNG đổi; audit mang lý do + cũ→mới
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng hiện trường, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.setConfig({ testTimeout: 180_000 });

import type { Actor } from "../../lib/auth/actor";
import { can } from "../../lib/auth/can";
import { db } from "../../lib/db";
import { khoaChinhSach } from "../../lib/hoa-hong/chinh-sach-service";
import { loiHaTranVoiChinhSachActive } from "../../lib/hoa-hong/kiem-tran-moi";
import { luuPageMappingAction } from "../../app/(admin)/admin/nguon-hoa-hong/nguon/_actions";
import { saveGlobalSettingAction } from "../../app/(admin)/admin/cau-hinh-van-hanh/actions";
import { luuNguonCuaPage as luuNguonCuaPageThat } from "../../lib/nguon/bang-nguon-theo-page";
import { doiTrangThaiNguon as doiTrangThaiNguonThat, suaNguon as suaNguonThat, taoNguon as taoNguonThat } from "../../lib/nguon/danh-muc-ghi";
import { docDinhTienNguon, ruleChuChayChoNguon } from "../../lib/nguon/dinh-tien-nguon";
import { docDanhMucNguon } from "../../lib/nguon/doc-danh-muc";
import { docFormSuaNguon, docFormTaoNguon } from "../../lib/nguon/doc-form-nguon";
import { thaoTacTrangThai } from "../../lib/nguon/form-nguon";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { actorCua, donKichBan, dungKichBan, ganVai, lamNhanVien, type KichBan } from "./_kich-ban";
import { baoDamNguoiPhuTrach, chinhSachNguonQuaService, datTranHoaHong, donNguoiPhuTrach, lamSachChinhSach, rule, thuKichHoat, trangThaiPhienBan } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[W2G] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-w2g";
const NOW = new Date("2026-10-10T03:00:00.000Z");
const LY_DO = "Chủ dự án chốt ngày 10/10/2026";
const KEY_PAGE = "nguon.bangNguonTheoPage";
const cuaToi: KichBan[] = [];
let admin: { userId: string; ten: string };
let stamp = 0;
let chu: { userId: string; employeeId: string };
let mkt: { id: string; actor: Actor; email: string; role: string };
let gd: { id: string; actor: Actor; email: string; role: string };
let sa: { id: string; actor: Actor; email: string; role: string };

// Bọc: mọi tham số nguy hiểm KHAI TƯỜNG MINH ở chỗ gọi (cờ quyền) — không mặc định `true` ở đây, để ca nào cũng thấy mình đang giả định ai.
const tao = (vao: Record<string, unknown>, coQuyenKichHoat: boolean) => taoNguonThat({ nguoi: admin, vao, coQuyenKichHoat });
const sua = async (id: string, vao: Record<string, unknown>, coQuyenKichHoat: boolean) =>
  suaNguonThat({ nguoi: admin, id, updatedAtDaThay: await moi(id), vao, lyDo: LY_DO, coQuyenKichHoat, now: NOW });
const doiTT = async (id: string, den: "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED", coQuyenKichHoat: boolean) =>
  doiTrangThaiNguonThat({ nguoi: admin, id, updatedAtDaThay: await moi(id), den, lyDo: LY_DO, coQuyenKichHoat, now: NOW });
const luuPage = (actor: Actor, pageId: string, groupCode: string | null, p: { lyDo?: string | null; coQuyenKichHoat: boolean; campaignCode?: string | null }) =>
  luuNguonCuaPageThat({ actor, actorName: NHAN, pageId, groupCode, campaignCode: p.campaignCode ?? null, lyDo: p.lyDo === undefined ? LY_DO : p.lyDo, coQuyenKichHoat: p.coQuyenKichHoat, now: NOW });

const moi = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const trangThai = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).status;
const bangPage = async (): Promise<Record<string, { groupCode: string; campaignCode?: string }>> =>
  ((await db.systemSetting.findUnique({ where: { key: KEY_PAGE } }))?.valueJson ?? {}) as Record<string, { groupCode: string; campaignCode?: string }>;
const demAuditPage = () => db.auditLog.count({ where: { entityType: "SystemSetting", entityId: KEY_PAGE, action: "PAGE_MAPPING" } });

const MAU = {
  name: "Nguồn thử",
  description: null,
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  sortOrder: 600,
  trangThai: "ACTIVE",
  attributionWindowDays: null,
  commissionEnabled: true,
  ownerOrgUnitId: null,
  ownerEmployeeId: null,
  effectiveFrom: null,
  effectiveTo: null,
} as const;

async function taoNhom(hau: string, ghi: Record<string, unknown> = {}) {
  stamp += 1;
  const code = `W2G_${hau}_${Date.now().toString(36).toUpperCase()}${stamp}`;
  const r = await tao({ ...MAU, code, name: `W2G ${hau}`, ...ghi }, true);
  if (!r.ok) throw new Error(`taoNguon(${hau}): ${r.truong}: ${r.loi}`);
  return { id: r.id, code: r.code };
}

async function kb(tien: string, rules = [{ vai: "SALE", rate: 0.04 }]) {
  const k = await dungKichBan(tien, { rules });
  cuaToi.push(k);
  return k;
}

/**
 * Nguồn ACTIVE, có chủ, có chính sách RIÊNG đang ACTIVE (`rules`) — nguồn «đang dính tiền». Dùng CHUNG một kịch bản `k` trong cả ca: mỗi `kb` thêm một chính sách chung SALE 4% ở GLOBAL, hai bộ như vậy
 * cùng hạng ⇒ guardrail báo `CHONG_LAN_RULE` ở lần kích hoạt thứ hai (lỗi của fixture, không phải của thứ đang đo).
 */
async function nguonDinhTien(k: KichBan, hau: string, rules = [rule("SOURCE_OWNER", 0.01)], ghi: Record<string, unknown> = {}) {
  const g = await taoNhom(hau, { ownerEmployeeId: chu.employeeId, ...ghi });
  const cs = await chinhSachNguonQuaService(k, { hau: hau.toLowerCase(), sourceGroupId: g.id, rules });
  expect(await thuKichHoat(cs.versionId), `kích hoạt chính sách riêng ${hau}`).toEqual([]);
  return { ...g, versionId: cs.versionId };
}

/** Gỡ vai (UserOrgRole) của người dùng do ca này dựng — `UserOrgRole` không có quan hệ `user` để lọc theo email. */
async function donVaiCuaToi() {
  const us = await db.user.findMany({ where: { email: { startsWith: NHAN } }, select: { id: true } });
  await db.userOrgRole.deleteMany({ where: { userId: { in: us.map((u) => u.id) } } });
}

async function dungPage(id: string, centerId: string | null = null) {
  return db.facebookPageMapping.create({ data: { pageId: `w2g-${id}`, pageName: `W2G Page ${id}`, scopeType: centerId ? "CENTER" : "HO", centerId, isActive: true } });
}

async function dungNguoi(hau: string, roleEnum: string, vai: string, donVi = "HO") {
  const u = await seedUser({ email: `${NHAN}-${hau}@ci.test`, role: roleEnum as never, name: `${NHAN}-${hau}`, phone: null });
  await db.userOrgRole.deleteMany({ where: { userId: u.id } });
  const ou = await db.orgUnit.findFirstOrThrow({ where: { code: donVi, deletedAt: null }, select: { id: true } });
  await ganVai(u.id, ou.id, vai);
  return { id: u.id, actor: await actorCua(u.id), email: `${NHAN}-${hau}@ci.test`, role: roleEnum };
}

describe.skipIf(!RUN_DB_TESTS)("[W2G] cổng «đụng tiền» chung — danh mục nguồn + Page → nguồn", () => {
  const truocRbac = process.env.RBAC_V2_ENABLED;

  beforeAll(async () => {
    assertTestDb();
    process.env.RBAC_V2_ENABLED = "true";
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["HO_MARKETING", "GIAM_DOC", "SUPER_ADMIN"] });
    await damBaoDanhMucGoc(db);
    await donVaiCuaToi();
    const u = await seedUser({ email: `${NHAN}-admin@ci.test`, role: "SUPER_ADMIN", name: `${NHAN}-admin`, phone: null });
    admin = { userId: u.id, ten: `${NHAN}-admin` };
    mkt = await dungNguoi("mkt", "MARKETING", "HO_MARKETING");
    gd = await dungNguoi("gd", "CENTER_MANAGER", "GIAM_DOC");
    sa = await dungNguoi("sa", "SUPER_ADMIN", "SUPER_ADMIN");
    const c = await seedUser({ email: `${NHAN}-chu@ci.test`, role: "SALES_CSM", name: `${NHAN}-chu`, phone: null });
    // chạy lại trên cùng DB: `seedUser` là upsert (cùng userId) nên nhân sự của lượt trước còn đó — dùng lại, không tạo trùng mã (luật 18)
    const cu = await db.user.findUniqueOrThrow({ where: { id: c.id }, select: { employeeId: true } });
    chu = { userId: c.id, employeeId: cu.employeeId ?? (await lamNhanVien(c.id, `${NHAN}-chu`)) };
  }, 180_000);

  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: { in: [KEY_PAGE, "nguon.nhomNhanSuMacDinh"] } } });
    await db.auditLog.deleteMany({ where: { entityType: "SystemSetting", entityId: KEY_PAGE } }); // đếm audit ở từng ca không bị ca trước cộng dồn (luật 18)
    clearSettingsCache();
    await lamSachChinhSach();
    await baoDamNguoiPhuTrach(NHAN);
    await datTranHoaHong(null);
  }, 120_000);

  afterAll(async () => {
    await datTranHoaHong(null);
    await lamSachChinhSach();
    await donKichBan(cuaToi);
    await donNguoiPhuTrach(NHAN);
    await db.systemSetting.deleteMany({ where: { key: { in: [KEY_PAGE, "nguon.nhomNhanSuMacDinh"] } } });
    await db.facebookPageMapping.deleteMany({ where: { pageId: { startsWith: "w2g-" } } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorName: { startsWith: NHAN } }, { entityType: "SystemSetting", entityId: KEY_PAGE }] } });
    const nhom = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: "W2G_" } }, select: { id: true } })).map((g) => g.id);
    await db.leadSourceGroup.deleteMany({ where: { id: { in: nhom } } });
    await donVaiCuaToi();
    clearSettingsCache();
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
  }, 120_000);

  it("[W2G-01] MA TRẬN: cờ quyền lấy từ can() trên vai thật; nguồn có chính sách riêng ACTIVE — Marketing sửa TÊN được, KHÔNG ngừng · tắt chọn · dời Page; Giám đốc / Quản trị tối cao làm được", async () => {
    // Cấy: bỏ `TRUONG_DOI_KHA_NANG_NHAN_LEAD` khỏi `canQuyenKichHoat` ⇒ ca selectable/ngừng của Marketing lọt qua (đỏ); bỏ `canQuyenKichHoatGanPage` khỏi `luuNguonCuaPage` ⇒ ca Page (đỏ).
    const flag = (a: Actor) => can(a, "commission_policies:activate");
    expect([flag(mkt.actor), flag(gd.actor), flag(sa.actor)], "tiền đề lấy từ vai THẬT: Marketing không · Giám đốc có · Quản trị tối cao có").toEqual([false, true, true]);
    // HO_MARKETING phải GIỮ sources:manage (đối chứng: nó vẫn là người sửa nguồn hằng ngày)
    expect(can(mkt.actor, "sources:manage")).toBe(true);

    const a = await nguonDinhTien(await kb("w2g01"), "A");
    expect(await trangThai(a.id)).toBe("ACTIVE");
    // Marketing: đổi TÊN / mô tả ⇒ được (không đụng tiền)
    expect(await sua(a.id, { name: "Tên mới do Marketing" }, flag(mkt.actor))).toMatchObject({ ok: true, doi: true });
    expect(await sua(a.id, { description: "Mô tả mới" }, flag(mkt.actor))).toMatchObject({ ok: true, doi: true });
    // …nhưng KHÔNG tắt «chọn được» / đặt hạn / ngừng / lưu trữ
    expect(await sua(a.id, { selectable: false }, flag(mkt.actor))).toMatchObject({ ok: false, truong: "quyen" });
    expect(await sua(a.id, { effectiveTo: new Date("2027-12-31T00:00:00.000Z") }, flag(mkt.actor))).toMatchObject({ ok: false, truong: "quyen" });
    expect(await doiTT(a.id, "INACTIVE", flag(mkt.actor))).toMatchObject({ ok: false, truong: "quyen" });
    expect(await doiTT(a.id, "ARCHIVED", flag(mkt.actor))).toMatchObject({ ok: false, truong: "quyen" });
    const hang = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: a.id } });
    expect(hang).toMatchObject({ status: "ACTIVE", selectable: true, effectiveTo: null });
    // câu từ chối NÊU TÊN khoá
    const tuChoi = await doiTT(a.id, "INACTIVE", flag(mkt.actor));
    expect(tuChoi.ok === false && tuChoi.loi).toContain("commission_policies:activate");

    // Giám đốc + Quản trị tối cao: làm được đủ — đối chứng dương cho hai hàm sửa / đổi trạng thái (làm TRƯỚC phần Page: nguồn đã được gán cho một Page thì thành đích mặc định, không ngừng / tắt chọn được)
    expect(await sua(a.id, { selectable: false }, flag(gd.actor))).toMatchObject({ ok: true, doi: true });
    expect(await sua(a.id, { selectable: true }, flag(sa.actor))).toMatchObject({ ok: true, doi: true });
    expect(await doiTT(a.id, "INACTIVE", flag(gd.actor))).toMatchObject({ ok: true });
    expect(await doiTT(a.id, "ACTIVE", flag(sa.actor))).toMatchObject({ ok: true });

    // Page: dời Page VÀO nguồn dính tiền ⇒ chặn; dời RA khỏi nguồn dính tiền ⇒ chặn; đối chứng: hai nguồn không dính tiền ⇒ được
    const khong = await taoNhom("KHONG", { commissionEnabled: false });
    await dungPage("p1");
    expect(await luuPage(mkt.actor, "w2g-p1", a.code, { coQuyenKichHoat: flag(mkt.actor) })).toMatchObject({ ok: false, truong: "quyen" });
    expect(await bangPage()).toEqual({});
    expect(await luuPage(mkt.actor, "w2g-p1", khong.code, { coQuyenKichHoat: flag(mkt.actor) })).toEqual({ ok: true, doi: true });
    expect(await luuPage(gd.actor, "w2g-p1", a.code, { coQuyenKichHoat: flag(gd.actor) })).toEqual({ ok: true, doi: true }); // Giám đốc dời vào được
    expect(await luuPage(mkt.actor, "w2g-p1", khong.code, { coQuyenKichHoat: flag(mkt.actor) })).toMatchObject({ ok: false, truong: "quyen" }); // dời RA khỏi nguồn dính tiền
    expect((await bangPage())["w2g-p1"]).toEqual({ groupCode: a.code });

  });

  it("[W2G-02] rule SOURCE_OWNER chung đang chạy: tạo nguồn ACTIVE CÓ CHỦ cần quyền; «tạo Nháp rồi Kích hoạt» không đi vòng; không có rule thì không đòi", async () => {
    // Cấy: bỏ cổng quyền ở `doiTrangThaiNguon` ⇒ ca «Nháp rồi Kích hoạt» lọt (đỏ); bỏ ở `taoNguon` ⇒ ca tạo ACTIVE (đỏ).
    const k = await kb("w2g02");
    const chuaChu = await db.leadSourceGroup.findMany({ where: { status: "ACTIVE", ownerEmployeeId: null }, select: { id: true } });
    // trước khi có rule chung: tạo ACTIVE có chủ, thiếu quyền ⇒ qua (đối chứng dương: không rule thì không có gì để đòi)
    const truocRule = await tao({ ...MAU, code: `W2G_TR_${Date.now().toString(36).toUpperCase()}`, name: "W2G trước rule", ownerEmployeeId: chu.employeeId }, false);
    expect(truocRule.ok).toBe(true);
    const cs = await chinhSachNguonQuaService(k, { hau: "chung", sourceGroupId: null, rules: [rule("SOURCE_OWNER", 0.01)] });
    try {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: chu.employeeId } });
      expect(await thuKichHoat(cs.versionId)).toEqual([]);

      const ma = (hau: string) => `W2G_${hau}_${Date.now().toString(36).toUpperCase()}${(stamp += 1)}`;
      const truoc = await db.leadSourceGroup.count();
      const chan = await tao({ ...MAU, code: ma("B1"), name: "W2G B1", ownerEmployeeId: chu.employeeId }, false);
      expect(chan).toMatchObject({ ok: false, truong: "quyen" });
      expect(chan.ok === false && chan.loi).toContain("commission_policies:activate");
      expect(await db.leadSourceGroup.count(), "chặn thì không tạo dòng").toBe(truoc);
      expect((await tao({ ...MAU, code: ma("B2"), name: "W2G B2", ownerEmployeeId: chu.employeeId }, true)).ok).toBe(true);

      // Nháp có chủ ⇒ tạo được (tiền chưa chảy)…
      const nhap = await tao({ ...MAU, code: ma("B3"), name: "W2G B3", trangThai: "DRAFT", ownerEmployeeId: chu.employeeId }, false);
      expect(nhap.ok).toBe(true);
      if (!nhap.ok) return;
      // …nhưng KÍCH HOẠT thì cổng đứng đó
      expect(await doiTT(nhap.id, "ACTIVE", false)).toMatchObject({ ok: false, truong: "quyen" });
      expect(await trangThai(nhap.id)).toBe("DRAFT");
      expect(await doiTT(nhap.id, "ACTIVE", true)).toMatchObject({ ok: true });
      // mở lại sau khi ngừng cũng là chỗ tiền chảy lại
      expect(await doiTT(nhap.id, "INACTIVE", true)).toMatchObject({ ok: true });
      expect(await doiTT(nhap.id, "ACTIVE", false)).toMatchObject({ ok: false, truong: "quyen" });

      // Nguồn KHÔNG chủ: bị cổng cũ «chưa có người phụ trách» chặn trước cổng quyền (thứ tự như nút)
      const khongChu = await tao({ ...MAU, code: ma("B4"), name: "W2G B4", ownerEmployeeId: null }, false);
      expect(khongChu).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
    } finally {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: null } });
    }
  });

  it("[W2G-03] TẮT commissionEnabled: chính sách riêng có dòng THU HÚT ⇒ CHẶN kể cả người đủ quyền (nguồn không đổi); chỉ gồm EXCLUDE ⇒ tắt được; nguồn không chính sách ⇒ tắt được", async () => {
    // Cấy: bỏ `chanTatHoaHongNguon` khỏi `suaNguon` ⇒ ca đầu đỏ; đổi `laDongThuHut` thành `() => true` ⇒ ca EXCLUDE đỏ (tắt bị chặn oan).
    const k = await kb("w2g03");
    const a = await nguonDinhTien(k, "TAT", [rule("MARKETING", 0.01)]);
    const r = await sua(a.id, { commissionEnabled: false }, true);
    expect(r).toMatchObject({ ok: false, truong: "commissionEnabled" });
    expect(r.ok === false && r.loi).toContain("thu hút");
    expect(r.ok === false && r.loi).toContain("Chính sách hoa hồng"); // đường lui nêu trong câu
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: a.id } })).commissionEnabled, "nguồn không đổi").toBe(true);
    expect(await db.auditLog.count({ where: { entityType: "LeadSourceGroup", entityId: a.id, action: "NGUON_DOI_HOA_HONG" } })).toBe(0);

    // chỉ EXCLUDE (kiểu «nguồn khác không trả Marketing») ⇒ tắt được
    const ex = await nguonDinhTien(k, "EXC", [rule("MARKETING", 0, { calcKind: "EXCLUDE", rate: null })]);
    expect(await sua(ex.id, { commissionEnabled: false }, true)).toMatchObject({ ok: true, doi: true });
    // nguồn không có chính sách riêng ⇒ tắt được
    const khong = await taoNhom("KHONG2", { commissionEnabled: true });
    expect(await sua(khong.id, { commissionEnabled: false }, true)).toMatchObject({ ok: true, doi: true });
    // BẬT cờ không bị cổng này đụng (đã có guardrail riêng)
    expect(await sua(khong.id, { commissionEnabled: true }, true)).toMatchObject({ ok: true, doi: true });
  });

  it("[W2G-04] HẠ TRẦN dưới tổng chính sách ACTIVE ⇒ TỪ CHỐI kèm tổng + chính sách + đường lui; nâng / giữ / không chính sách ⇒ qua; action thật gọi phép kiểm", async () => {
    // Cấy: bỏ khối `loiHaTranVoiChinhSachActive` ở `saveGlobalSettingAction` ⇒ ca action (đỏ); đổi `tranMoi >= hienTai` thành `>` ⇒ giữ nguyên bị kiểm oan (không đỏ nhưng chậm) — ca «giữ» đo kết quả.
    const k = await kb("w2g04", [{ vai: "SALE", rate: 0.04 }, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }]);
    const g = await taoNhom("TRAN", { commissionEnabled: true });
    const cs = await chinhSachNguonQuaService(k, { hau: "tran", sourceGroupId: g.id, rules: [rule("MARKETING", 0.02)] });
    expect(await thuKichHoat(cs.versionId)).toEqual([]); // chung 4+1+2 = 7% + riêng 2% = 9% (đúng trần mặc định 9%)

    const loi = await loiHaTranVoiChinhSachActive(0.08, NOW);
    expect(loi).not.toBeNull();
    expect(loi).toContain("9%"); // tổng lớn nhất hiện hành
    expect(loi).toContain(cs.policyCode); // chính sách nào
    expect(loi).toContain("giữ trần tối thiểu 9%"); // đường lui
    expect(loi).toContain("Chính sách hoa hồng");
    // nâng / giữ nguyên ⇒ qua
    expect(await loiHaTranVoiChinhSachActive(0.09, NOW)).toBeNull();
    expect(await loiHaTranVoiChinhSachActive(0.1, NOW)).toBeNull();

    // qua ACTION thật (RBAC v2): chỉ Quản trị tối cao lưu được khoá này; bị chặn thì giá trị lưu KHÔNG đổi
    SESS.current = { user: { id: sa.id, role: sa.role, roles: [sa.role], centerId: null, name: `${NHAN}-sa`, email: sa.email } };
    const chan = await saveGlobalSettingAction({ key: "crm.commissionMaxTotalRate", value: 0.08, reason: LY_DO });
    expect(chan).toMatchObject({ ok: false, error: { code: "VALIDATION", field: "crm.commissionMaxTotalRate" } });
    expect(chan.ok === false && chan.error.message).toContain(cs.policyCode);
    expect(await db.systemSetting.findUnique({ where: { key: "crm.commissionMaxTotalRate" } }), "bị chặn thì không ghi").toBeNull();
    // giá trị ngoài sàn Zod: câu lỗi vẫn là của Zod (phép kiểm trần không che nó)
    const duoiSan = await saveGlobalSettingAction({ key: "crm.commissionMaxTotalRate", value: 0.05, reason: LY_DO });
    expect(duoiSan.ok === false && duoiSan.error.message).not.toContain(cs.policyCode);
    // đối chứng dương: nâng trần ⇒ lưu được
    expect(await saveGlobalSettingAction({ key: "crm.commissionMaxTotalRate", value: 0.1, reason: LY_DO })).toEqual({ ok: true });
    // …rồi hạ về 9% đúng bằng tổng ⇒ qua; hạ xuống 8% lần nữa ⇒ chặn dù trần hiện tại là 10%
    expect(await saveGlobalSettingAction({ key: "crm.commissionMaxTotalRate", value: 0.09, reason: LY_DO })).toEqual({ ok: true });
    expect(await saveGlobalSettingAction({ key: "crm.commissionMaxTotalRate", value: 0.08, reason: LY_DO })).toMatchObject({ ok: false });
    SESS.current = null;

    // không còn chính sách nào ACTIVE ⇒ hạ xuống sàn được
    await lamSachChinhSach();
    expect(await loiHaTranVoiChinhSachActive(0.08, NOW)).toBeNull();
  });

  it("[W2G-05] KHOÁ: mỗi đường ghi CHỜ khoá advisory chính sách; nhóm đích / bảng Page đọc LẠI trong transaction sau khoá", async () => {
    // Cấy: bỏ `khoaTapChinhSach(tx)` khỏi một đường ⇒ ca «chờ khoá» của đường đó đỏ; đọc `docBoiCanhDaDung()` ngoài tx ở `doiTrangThaiNguon` ⇒ ca «bảng Page thấy muộn» đỏ;
    // đọc nhóm đích ngoài tx ở `luuNguonCuaPage` ⇒ ca «nhóm bị ngừng lúc ta chờ» đỏ.
    // Nhả khoá LUÔN chạy, kể cả khi một `expect` ở giữa ném (fin3 R5 LOW2: trước đây `tha()` nằm ngoài `finally`, khoá treo 60 giây và kéo [W2G-06..08] đỏ lan — tập ca đỏ là 4 thay vì 1).
    // `tha()` idempotent: nhả lần hai không làm gì.
    const dangGiu: { tha: () => void; xong: Promise<unknown> }[] = [];
    onTestFinished(async () => {
      for (const g of dangGiu) {
        g.tha();
        await g.xong.catch(() => undefined);
      }
    });
    /** Giữ khoá advisory trong một transaction MỞ cho tới khi gọi `tha()`; `viec` chạy bên trong sau khi đã giữ khoá (ghi mà CHƯA commit). */
    async function giuKhoa(viec: (tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]) => Promise<void> = async () => {}) {
      let tha!: () => void;
      let daGiu!: () => void;
      const chaGiu = new Promise<void>((r) => (daGiu = r));
      const chaTha = new Promise<void>((r) => (tha = r));
      const xong = db.$transaction(
        async (tx) => {
          await khoaChinhSach(tx);
          await viec(tx);
          daGiu();
          await chaTha;
        },
        { timeout: 60_000, maxWait: 30_000 },
      );
      await chaGiu;
      const giu = { tha, xong };
      dangGiu.push(giu);
      return giu;
    }
    /** Chờ tới khi CÓ ít nhất một phiên đang đứng chờ khoá advisory (`pg_locks`) — tức đường ghi đã đọc xong mọi thứ nó đọc TRƯỚC khoá. Xác định, không phụ thuộc đồng hồ. */
    const doiCoNguoiCho = async (): Promise<void> => {
      for (let i = 0; i < 600; i++) {
        const r = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
        if (Number(r[0]?.n ?? 0) > 0) return;
        await new Promise((res) => setTimeout(res, 100));
      }
      throw new Error("không thấy phiên nào chờ khoá advisory");
    };
    const dangCho = async <T,>(p: Promise<T>): Promise<boolean> => {
      let xong = false;
      void p.then(
        () => (xong = true),
        () => (xong = true),
      );
      await new Promise((r) => setTimeout(r, 700));
      return !xong;
    };

    // (a) mỗi đường ghi CHỜ khoá
    const n1 = await taoNhom("K1");
    const n2 = await taoNhom("K2", { trangThai: "DRAFT" });
    const n3 = await taoNhom("K3");
    await dungPage("k1");
    const duong: [string, () => Promise<unknown>][] = [
      ["taoNguon", () => tao({ ...MAU, code: `W2G_K0_${Date.now().toString(36).toUpperCase()}`, name: "W2G K0" }, true)],
      ["suaNguon", () => sua(n1.id, { name: "W2G K1 đổi" }, true)],
      ["doiTrangThaiNguon", async () => doiTT(n2.id, "ACTIVE", true)],
      ["luuNguonCuaPage", () => luuPage(sa.actor, "w2g-k1", n3.code, { coQuyenKichHoat: true })],
    ];
    for (const [ten, chay] of duong) {
      const giu = await giuKhoa();
      const p = chay();
      expect(await dangCho(p), `${ten} phải CHỜ khoá advisory`).toBe(true);
      giu.tha();
      await giu.xong;
      const kq = (await p) as { ok: boolean };
      expect(kq.ok, `${ten} xong sau khi nhả khoá`).toBe(true);
    }

    // (b) bảng Page→nguồn đổi TRONG LÚC chờ khoá: `doiTrangThaiNguon` phải thấy bản mới (đích mặc định ⇒ từ chối), không phải bản đọc trước khoá
    const g = await taoNhom("K4");
    await dungPage("k4");
    const giuB = await giuKhoa(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: KEY_PAGE },
        update: { valueJson: { "w2g-k4": { groupCode: g.code } } },
        create: { key: KEY_PAGE, valueJson: { "w2g-k4": { groupCode: g.code } } },
      });
    });
    const ngung = doiTT(g.id, "INACTIVE", true);
    await doiCoNguoiCho();
    expect(await dangCho(ngung)).toBe(true);
    giuB.tha();
    await giuB.xong;
    const kqNgung = await ngung;
    expect(kqNgung, "nhóm vừa được gán cho một Page ⇒ không ngừng được").toMatchObject({ ok: false, truong: "trangThai" });
    expect(await trangThai(g.id)).toBe("ACTIVE");

    // (c) nhóm đích bị NGỪNG trong lúc chờ khoá: `luuNguonCuaPage` phải thấy trạng thái mới, không gán Page vào nguồn đã ngừng
    const h = await taoNhom("K5");
    await dungPage("k5");
    const giuC = await giuKhoa(async (tx) => {
      await tx.leadSourceGroup.update({ where: { id: h.id }, data: { status: "INACTIVE" } });
    });
    const gan = luuPage(sa.actor, "w2g-k5", h.code, { coQuyenKichHoat: true });
    await doiCoNguoiCho();
    expect(await dangCho(gan)).toBe(true);
    giuC.tha();
    await giuC.xong;
    expect(await gan).toMatchObject({ ok: false, truong: "nguon" });
    expect((await bangPage())["w2g-k5"], "Page không bị trỏ vào nguồn đã ngừng").toBeUndefined();

    // (d) kích hoạt rule chủ-nguồn CHUNG đúng lúc một nguồn mới KHÔNG chủ vào: guardrail đã đọc danh mục nguồn NGOÀI transaction, nên `kichHoat` phải so lại dưới khoá (`NGUON_DA_DOI`) —
    // không thì rule chạy với nguồn không chủ ⇒ hold vĩnh viễn ngay từ lead đầu tiên (08 §14 mục 5, phần còn hở trước W2).
    const k2 = await kb("w2g05d");
    const chuaChu = await db.leadSourceGroup.findMany({ where: { status: "ACTIVE", ownerEmployeeId: null }, select: { id: true } });
    const cs = await chinhSachNguonQuaService(k2, { hau: "chung", sourceGroupId: null, rules: [rule("SOURCE_OWNER", 0.01)] });
    try {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((x) => x.id) } }, data: { ownerEmployeeId: chu.employeeId } });
      const maMoi = `W2G_K6_${Date.now().toString(36).toUpperCase()}`;
      const giuD = await giuKhoa(async (tx) => {
        await tx.leadSourceGroup.create({ data: { code: maMoi, name: "W2G K6 nguồn mới không chủ", status: "ACTIVE", sourceType: "MARKETING", sortOrder: 900, isSystem: false } });
      });
      const kichHoatChung = thuKichHoat(cs.versionId).then(
        () => null,
        (e: unknown) => e,
      );
      await doiCoNguoiCho(); // guardrail đã đọc xong danh mục nguồn (CŨ) và đang đứng chờ khoá
      expect(await dangCho(kichHoatChung), "kích hoạt phải CHỜ khoá advisory").toBe(true);
      giuD.tha();
      await giuD.xong;
      expect(await kichHoatChung, "nguồn mới không chủ vào trước ⇒ kết quả kiểm đã cũ").toMatchObject({ ma: "NGUON_DA_DOI" });
      expect(await trangThaiPhienBan(cs.versionId), "bị chặn ⇒ vẫn là bản nháp").toBe("DRAFT");
      // đối chứng dương: khai chủ cho nguồn mới rồi kích hoạt lại ⇒ qua
      await db.leadSourceGroup.update({ where: { code: maMoi }, data: { ownerEmployeeId: chu.employeeId } });
      expect(await thuKichHoat(cs.versionId)).toEqual([]);
      expect(await trangThaiPhienBan(cs.versionId)).toBe("ACTIVE");
    } finally {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((x) => x.id) } }, data: { ownerEmployeeId: null } });
    }
  });

  it("[W2G-06] NÚT ≡ CỔNG trên dữ liệu thật: dữ liệu nút lấy từ docDanhMucNguon; nút vẽ ra thì máy chủ nhận, 'không có nút' thì máy chủ từ chối — hai trạng thái rule chung × cờ quyền", async () => {
    // Cấy: bỏ `ownerEmployeeId`/`ruleChuChay` khỏi `docDanhMucNguon` ⇒ nút «Kích hoạt» nguồn chưa chủ lọt (đỏ); bỏ `chinhSachRieng` ⇒ nút «Ngừng» của nguồn có chính sách lọt khi thiếu quyền (đỏ).
    const k = await kb("w2g06");
    const dinh = await nguonDinhTien(k, "N1"); // ACTIVE + chủ + chính sách riêng
    const nhapKhongChu = await taoNhom("N2", { trangThai: "DRAFT", ownerEmployeeId: null });
    const nhapCoChu = await taoNhom("N3", { trangThai: "DRAFT", ownerEmployeeId: chu.employeeId });
    const ngungCoChu = await taoNhom("N4", { ownerEmployeeId: chu.employeeId });
    expect(await doiTT(ngungCoChu.id, "INACTIVE", true)).toMatchObject({ ok: true });
    const ids = { dinh: dinh.id, nhapKhongChu: nhapKhongChu.id, nhapCoChu: nhapCoChu.id, ngungCoChu: ngungCoChu.id };

    const chuaChu = await db.leadSourceGroup.findMany({ where: { status: "ACTIVE", ownerEmployeeId: null, id: { notIn: Object.values(ids) } }, select: { id: true } });
    const csChung = await chinhSachNguonQuaService(k, { hau: "chung", sourceGroupId: null, rules: [rule("SOURCE_OWNER", 0.01)] });
    let soNutDuoc = 0;
    let soNutChan = 0;
    try {
      for (const co of ["khong-rule-chung", "co-rule-chung"] as const) {
        if (co === "co-rule-chung") {
          // dọn đường để rule chung kích hoạt được (guardrail đòi mọi nguồn ĐANG HOẠT ĐỘNG có chủ), rồi khôi phục ở finally
          await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: chu.employeeId } });
          expect(await thuKichHoat(csChung.versionId)).toEqual([]);
        }
        for (const coQuyen of [true, false]) {
          const actor = (coQuyen ? gd : mkt).actor;
          const danhMuc = await docDanhMucNguon(sa.actor, { now: NOW, trangThai: null, coSoId: null }); // dữ liệu nút không phụ thuộc người xem; QUYỀN mới phụ thuộc (coQuyen)
          for (const [ten, id] of Object.entries(ids)) {
            const dong = danhMuc.dong.find((d) => d.id === id)!;
            const goc = dong.status;
            const tt = thaoTacTrangThai({
              nguon: { code: dong.code, isSystem: dong.isSystem, status: dong.status, ownerEmployeeId: dong.ownerEmployeeId },
              dichMacDinh: new Set<string>(),
              dinhTien: { chinhSachRieng: dong.chinhSachRieng, ruleChuChay: dong.ruleChuChay },
              coQuyenKichHoat: coQuyen,
              now: NOW,
            });
            const nhan = `${co} · quyền=${coQuyen} · ${ten}`;
            for (const t of tt.duoc) {
              const r = await doiTT(id, t.den, can(actor, "commission_policies:activate"));
              expect(r.ok, `${nhan}: nút «${t.nhan}» vẽ ra mà máy chủ từ chối: ${r.ok ? "" : r.loi}`).toBe(true);
              soNutDuoc += 1;
              await db.leadSourceGroup.update({ where: { id }, data: { status: goc } }); // khôi phục để lượt kế đo cùng trạng thái
            }
            for (const t of tt.khongDuoc) {
              const r = await doiTT(id, t.den, can(actor, "commission_policies:activate"));
              expect(r.ok, `${nhan}: «${t.nhan}» bị ẩn nhưng máy chủ nhận`).toBe(false);
              expect(await trangThai(id), nhan).toBe(goc);
              soNutChan += 1;
            }
          }
        }
      }
    } finally {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: null } });
    }
    // ca phải THỰC SỰ đo cả hai phía (không phải hai danh sách rỗng)
    expect(soNutDuoc).toBeGreaterThan(10);
    expect(soNutChan).toBeGreaterThan(5);
  });

  it("[W2G-07] docDinhTienNguon: chính sách riêng · dòng thu hút · rule chủ-nguồn (chung / riêng / bất kỳ) đọc đúng từ DB", async () => {
    const k = await kb("w2g07");
    const a = await taoNhom("D1");
    const b = await nguonDinhTien(k, "D2", [rule("SOURCE_OWNER", 0.01)]);
    const c = await nguonDinhTien(k, "D3", [rule("MARKETING", 0, { calcKind: "EXCLUDE", rate: null })]);
    const d = await nguonDinhTien(k, "D4", [rule("MARKETING", 0.01), rule("SALE", 0, { calcKind: "EXCLUDE", rate: null })]);
    const dt = await docDinhTienNguon(db, [a.id, b.id, c.id, d.id]);
    expect(dt.theoNguon.get(a.id)).toEqual({ chinhSachRieng: false, coDongThuHutRieng: false, ruleChuRieng: false });
    expect(dt.theoNguon.get(b.id)).toEqual({ chinhSachRieng: true, coDongThuHutRieng: true, ruleChuRieng: true });
    expect(dt.theoNguon.get(c.id)).toEqual({ chinhSachRieng: true, coDongThuHutRieng: false, ruleChuRieng: false }); // chỉ EXCLUDE
    expect(dt.theoNguon.get(d.id)).toEqual({ chinhSachRieng: true, coDongThuHutRieng: true, ruleChuRieng: false });
    expect(dt.ruleChuBatKy).toBe(true); // b có rule SOURCE_OWNER ở phạm vi riêng
    expect(dt.ruleChuChung).toBe(false);
    expect(ruleChuChayChoNguon(dt, b.id)).toBe(true);
    expect(ruleChuChayChoNguon(dt, a.id)).toBe(false); // rule riêng của nguồn KHÁC không chạy trên a
    expect(ruleChuChayChoNguon(dt, null)).toBe(false);
    // màn hình đọc CÙNG nguồn dữ liệu: biểu mẫu SỬA nhận đủ bốn cờ; biểu mẫu TẠO nhận «rule chủ-nguồn chạy trên nguồn mới»
    expect((await docFormSuaNguon(sa.actor, b.code))!.boiCanh.dinhTien).toEqual({ chinhSachRieng: true, coDongThuHutRieng: true, ruleChuNguonBatKy: true, ruleChuChay: true });
    expect((await docFormSuaNguon(sa.actor, c.code))!.boiCanh.dinhTien).toEqual({ chinhSachRieng: true, coDongThuHutRieng: false, ruleChuNguonBatKy: true, ruleChuChay: false });
    expect((await docFormTaoNguon(sa.actor)).ruleChuChay).toBe(false);
    // rule chung
    const chuaChu = await db.leadSourceGroup.findMany({ where: { status: "ACTIVE", ownerEmployeeId: null }, select: { id: true } });
    const cs = await chinhSachNguonQuaService(k, { hau: "chung", sourceGroupId: null, rules: [rule("SOURCE_OWNER", 0.01)] });
    try {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: chu.employeeId } });
      expect(await thuKichHoat(cs.versionId)).toEqual([]);
      const dt2 = await docDinhTienNguon(db, [a.id]);
      expect(dt2.ruleChuChung).toBe(true);
      expect(ruleChuChayChoNguon(dt2, a.id)).toBe(true);
      expect(ruleChuChayChoNguon(dt2, null)).toBe(true); // nguồn đang TẠO cũng bị rule chung
      expect((await docFormTaoNguon(sa.actor)).ruleChuChay, "biểu mẫu tạo biết rule chung đang chạy").toBe(true);
      expect((await docFormSuaNguon(sa.actor, a.code))!.boiCanh.dinhTien.ruleChuChay).toBe(true);
    } finally {
      await db.leadSourceGroup.updateMany({ where: { id: { in: chuaChu.map((g) => g.id) } }, data: { ownerEmployeeId: null } });
    }
    expect((await docDinhTienNguon(db, [])).theoNguon.size).toBe(0);
  });

  it("[W2G-08] luuPageMappingAction (RBAC thật): đổi nguồn cần lý do ≥ 10 ký tự; chỉ đổi mã chiến dịch thì không; nguồn dính tiền + Marketing ⇒ field 'quyen'; Quản trị tối cao qua; audit mang lý do + cũ→mới", async () => {
    // Cấy: bỏ `loiLyDoGanPage` ⇒ ca lý do (đỏ); action không hỏi `coQuyenKichHoatChinhSach` (mặc định true) ⇒ ca Marketing (đỏ); audit `reason` về câu tự sinh ⇒ ca audit (đỏ).
    const a = await nguonDinhTien(await kb("w2g08"), "PG");
    const khong = await taoNhom("PG2", { commissionEnabled: false });
    await dungPage("a8");
    const nguoi = (n: { id: string; email: string; role: string }) => {
      SESS.current = { user: { id: n.id, role: n.role, roles: [n.role], centerId: null, name: n.email, email: n.email } };
    };
    nguoi(mkt);
    // lý do thiếu / ngắn ⇒ từ chối field lyDo, bảng + audit không đổi
    for (const lyDo of [undefined, "", "ngắn"]) {
      const r = await luuPageMappingAction({ pageId: "w2g-a8", groupCode: khong.code, ...(lyDo === undefined ? {} : { lyDo }) });
      expect(r, JSON.stringify(lyDo)).toMatchObject({ ok: false, field: "lyDo" });
    }
    expect(await bangPage()).toEqual({});
    expect(await demAuditPage()).toBe(0);
    // đủ lý do, hai nguồn KHÔNG dính tiền ⇒ Marketing lưu được; audit mang lý do + cũ → mới
    expect(await luuPageMappingAction({ pageId: "w2g-a8", groupCode: khong.code, lyDo: `  ${LY_DO}  ` })).toEqual({ ok: true, doi: true });
    const au = await db.auditLog.findFirstOrThrow({ where: { entityType: "SystemSetting", entityId: KEY_PAGE, action: "PAGE_MAPPING" }, orderBy: { createdAt: "desc" } });
    expect(au.reason).toBe(LY_DO);
    expect(au.oldValues).toMatchObject({ pageId: "w2g-a8", nguon: null });
    expect(au.newValues).toMatchObject({ pageId: "w2g-a8", nguon: { groupCode: khong.code } });
    // chỉ đổi MÃ CHIẾN DỊCH (nguồn giữ nguyên) ⇒ không cần lý do
    expect(await luuPageMappingAction({ pageId: "w2g-a8", groupCode: khong.code, campaignCode: "CD1" })).toEqual({ ok: true, doi: true });
    // không đổi gì ⇒ ok, không hỏi lý do, không audit thêm
    const truoc = await demAuditPage();
    expect(await luuPageMappingAction({ pageId: "w2g-a8", groupCode: khong.code, campaignCode: "CD1" })).toEqual({ ok: true, doi: false });
    expect(await demAuditPage()).toBe(truoc);
    // nguồn MỚI dính tiền + Marketing (thiếu quyền kích hoạt) ⇒ field 'quyen', nêu khoá, bảng KHÔNG đổi
    const chan = await luuPageMappingAction({ pageId: "w2g-a8", groupCode: a.code, lyDo: LY_DO });
    expect(chan).toMatchObject({ ok: false, field: "quyen" });
    expect(chan.ok === false && chan.error).toContain("commission_policies:activate");
    expect((await bangPage())["w2g-a8"]).toEqual({ groupCode: khong.code, campaignCode: "CD1" });
    // Quản trị tối cao: cùng lượt đổi ⇒ qua (đối chứng dương)
    nguoi(sa);
    expect(await luuPageMappingAction({ pageId: "w2g-a8", groupCode: a.code, lyDo: LY_DO })).toEqual({ ok: true, doi: true });
    expect((await bangPage())["w2g-a8"]).toEqual({ groupCode: a.code });
    SESS.current = null;
  });
});
