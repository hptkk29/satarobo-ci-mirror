// @vitest-environment node
/**
 * [DMG-DB-*] — GHI DANH MỤC NGUỒN trên Postgres THẬT (`lib/nguon/danh-muc-ghi.ts`; SPEC nguồn động §4). Mọi nguồn do test TẠO có mã `DMG_*`.
 *
 *   [DMG-DB-01] tạo nguồn ACTIVE/DRAFT bằng DỮ LIỆU: dòng ra đúng thuộc tính, isSystem=false, audit NGUON_TAO CÙNG giao dịch
 *   [DMG-DB-02] mã trùng / khác hoa-thường / có khoảng trắng / MANUAL* / UNKNOWN / trùng nguồn hệ thống ⇒ từ chối, DB và audit KHÔNG đổi
 *   [DMG-DB-03] ĐUA tạo cùng mã: đúng một bên thắng, bên kia nhận «mã đã có» (không phải lỗi 500)
 *   [DMG-DB-04] khoá lạc quan: bản sửa thứ hai (đã thấy bản cũ) bị từ chối, 0 audit; nguồn HỆ THỐNG (updatedAt micro-giây) vẫn sửa được
 *   [DMG-DB-05] audit đúng hành động + cũ→mới + lý do; sửa thiếu lý do ⇒ DB và audit không đổi
 *   [DMG-DB-06] code BẤT BIẾN theo TỪNG loại tham chiếu (attribution · nguồn gốc · touchpoint · phiên bản chính sách · Page · nhóm nhân sự mặc định); gỡ tham chiếu ⇒ đổi được
 *   [DMG-DB-07] referrerRequirement/requiresNote khoá khi đã dùng, đổi được khi chưa
 *   [DMG-DB-08] nguồn HỆ THỐNG: không lưu trữ, không đổi mã; UNKNOWN đứng yên; sửa tên/cửa sổ/hoa hồng được
 *   [DMG-DB-09] nhóm mặc định «nhân sự giới thiệu»: không ngừng/tắt chọn được; đổi nhóm mặc định rồi thì bên kia khoá
 *   [DMG-DB-10] người phụ trách: không tồn tại/đã nghỉ bị chặn; chưa có tài khoản ⇒ cảnh báo; chủ đã nghỉ KHÔNG chặn sửa tên
 *   [DMG-DB-11] vòng đời trạng thái + hành động audit từng bước; không có xoá cứng
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: tự dựng tổ chức/danh mục, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: không đọc đồng hồ thật để so.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { docDaDung, type NguoiGhiNguon } from "../../lib/nguon/danh-muc-ghi";
import { doiTrangThaiNguon, suaNguon, taoNguon } from "./_nguon-dong";
import { ghiTouchpoint, taoNguonBanDau } from "../../lib/nguon/ghi-nguon";
import { layBangNguonTheoPage, layNhomNhanSuMacDinh } from "../../lib/nguon/feature";
import { clearSettingsCache } from "../../lib/settings/service";
import { damBaoDanhMucGoc, duLieuNguon } from "../lead-intake/_nguon-fixture";

if (!RUN_DB_TESTS) console.warn(`[DMG-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const P = "fx-dmg-";
const LY_DO = "Chủ dự án chốt ngày 09/10/2026";
let nguoi: NguoiGhiNguon;
let dem = 0;
const hau = () => `${Date.now().toString(36).toUpperCase()}${(dem += 1)}`;

const TAO_MAU = {
  name: "Nguồn thử",
  description: null,
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  sortOrder: 300,
  trangThai: "ACTIVE",
  attributionWindowDays: null,
  commissionEnabled: false,
  ownerOrgUnitId: null,
  ownerEmployeeId: null,
  effectiveFrom: null,
  effectiveTo: null,
} as const;

async function taoMau(ghi: Record<string, unknown> = {}) {
  const code = `DMG_${hau()}`;
  const r = await taoNguon({ nguoi, vao: { ...TAO_MAU, code, ...ghi } });
  if (!r.ok) throw new Error(`taoNguon: ${r.truong}: ${r.loi}`);
  const row = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: r.code } });
  return { id: r.id, code: r.code, updatedAt: row.updatedAt };
}
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const demAudit = (entityId?: string) => db.auditLog.count({ where: { entityType: "LeadSourceGroup", ...(entityId ? { entityId } : { actorName: { startsWith: P } }) } });

let demNv = 0;
async function nhanSu(o: { status?: "ACTIVE" | "RESIGNED"; coTaiKhoan?: boolean } = {}) {
  demNv += 1;
  const e = await db.employee.create({
    data: { employeeCode: `FXDMG${hau()}`, fullName: `${P}nv${demNv}`, jobTitle: "Nhân viên", department: "KINH_DOANH", status: o.status ?? "ACTIVE" },
  });
  if (o.coTaiKhoan) {
    const u = await seedUser({ email: `${P}nv${hau()}@ci.test`.toLowerCase(), role: "SALES_CSM", name: `${P}nv`, phone: null });
    await db.user.update({ where: { id: u.id }, data: { employeeId: e.id } });
  }
  return e.id;
}

async function datSetting(key: string, valueJson: unknown | null) {
  await db.systemSetting.deleteMany({ where: { key } });
  if (valueJson !== null) await db.systemSetting.create({ data: { key, valueJson: valueJson as never } });
  clearSettingsCache();
}

async function don() {
  const leads = await db.lead.findMany({ where: { parentName: { startsWith: P } }, select: { id: true } });
  const lid = leads.map((l) => l.id);
  await db.leadTouchpoint.deleteMany({ where: { leadId: { in: lid } } });
  await db.leadAttribution.deleteMany({ where: { leadId: { in: lid } } });
  await db.lead.deleteMany({ where: { id: { in: lid } } });
  const cs = await db.commissionPolicy.findMany({ where: { policyCode: { startsWith: P } }, select: { id: true } });
  await db.commissionPolicyVersion.deleteMany({ where: { policyId: { in: cs.map((c) => c.id) } } });
  await db.commissionPolicy.deleteMany({ where: { id: { in: cs.map((c) => c.id) } } });
  await db.leadSourceGroup.deleteMany({ where: { OR: [{ code: { startsWith: "DMG_" } }, { code: { startsWith: "MANUAL" } }] } }); // MANUAL*: rác của lần chạy hỏng (writer chặn tạo nó)
  await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", actorName: { startsWith: P } } });
  await db.systemSetting.deleteMany({ where: { key: { in: ["nguon.bangNguonTheoPage", "nguon.nhomNhanSuMacDinh"] } } });
  clearSettingsCache();
}

describe.skipIf(!RUN_DB_TESTS)("[DMG-DB] ghi danh mục nguồn — Postgres thật", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1"]);
    await damBaoDanhMucGoc(db);
    const u = await seedUser({ email: `${P}admin@ci.test`, role: "MARKETING", name: `${P}admin`, phone: null });
    nguoi = { userId: u.id, ten: `${P}admin` };
  }, 120_000);
  beforeEach(don);
  afterAll(async () => {
    await don();
    await damBaoDanhMucGoc(db); // trả 9 nguồn gốc về nguyên trạng (ca hệ thống có sửa tên/hoa hồng)
  }, 60_000);

  it("[DMG-DB-01] tạo nguồn ACTIVE bằng dữ liệu: dòng ra đúng thuộc tính, isSystem=false, documentNo NULL, audit NGUON_TAO cùng giao dịch; DRAFT ra DRAFT", async () => {
    const owner = await nhanSu({ coTaiKhoan: true });
    const code = `DMG_${hau()}`;
    const r = await taoNguon({
      nguoi,
      vao: { ...TAO_MAU, code: code.toLowerCase(), name: "TikTok Ads", description: "Quảng cáo TikTok", sourceType: "MARKETING", sortOrder: 321, attributionWindowDays: 45, commissionEnabled: true, ownerEmployeeId: owner },
    });
    expect(r).toMatchObject({ ok: true, code, canhBao: [] }); // mã đã chuẩn hoá HOA
    if (!r.ok) return;
    const row = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({
      code,
      name: "TikTok Ads",
      description: "Quảng cáo TikTok",
      sourceType: "MARKETING",
      referrerRequirement: "NONE",
      requiresNote: false,
      selectable: true,
      isSystem: false,
      documentNo: null,
      sortOrder: 321,
      status: "ACTIVE",
      attributionWindowDays: 45,
      commissionEnabled: true,
      ownerEmployeeId: owner,
      createdById: nguoi.userId,
      updatedById: nguoi.userId,
    });
    const nhatKy = await db.auditLog.findMany({ where: { entityType: "LeadSourceGroup", entityId: r.id } });
    expect(nhatKy).toHaveLength(1);
    expect(nhatKy[0]).toMatchObject({ action: "NGUON_TAO", module: "nguon-hoa-hong", actorId: nguoi.userId, actorName: nguoi.ten });
    expect((nhatKy[0]!.newValues as Record<string, unknown>).code).toBe(code);

    const nhap = await taoMau({ trangThai: "DRAFT" });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: nhap.id } })).status).toBe("DRAFT");
  });

  it("[DMG-DB-02] mã bị từ chối: trùng · khác hoa/thường · có khoảng trắng · MANUAL* · UNKNOWN · trùng nguồn HỆ THỐNG — DB và audit KHÔNG đổi", async () => {
    const co = await taoMau();
    const truoc = { nhom: await db.leadSourceGroup.count(), audit: await demAudit() };
    const thu = [co.code, co.code.toLowerCase(), `  ${co.code}  `, "paid_ads", "PAID_ADS", "MANUAL_REVIEW", "manualx", "UNKNOWN", "unknown", "AB", "CO DAU CACH"];
    for (const code of thu) {
      const r = await taoNguon({ nguoi, vao: { ...TAO_MAU, code } });
      expect(r, code).toMatchObject({ ok: false, truong: "code" });
    }
    expect({ nhom: await db.leadSourceGroup.count(), audit: await demAudit() }).toEqual(truoc);
    // đối chứng dương: mã hợp lệ khác vẫn tạo được
    expect((await taoNguon({ nguoi, vao: { ...TAO_MAU, code: `DMG_${hau()}` } })).ok).toBe(true);
  });

  it("[DMG-DB-03] ĐUA tạo cùng mã: đúng MỘT bên thắng, bên kia nhận lỗi ở ô `code`; một dòng", async () => {
    const code = `DMG_${hau()}`;
    const kq = await Promise.all([taoNguon({ nguoi, vao: { ...TAO_MAU, code } }), taoNguon({ nguoi, vao: { ...TAO_MAU, code, name: "Bản đua" } })]);
    expect(kq.filter((x) => x.ok)).toHaveLength(1);
    const thua = kq.find((x) => !x.ok)!;
    expect(thua).toMatchObject({ ok: false, truong: "code" });
    expect(await db.leadSourceGroup.count({ where: { code } })).toBe(1);
    expect(await demAudit()).toBe(1);
  });

  it("[DMG-DB-04] khoá lạc quan: người sửa sau (đã thấy bản cũ) bị từ chối, 0 audit thêm; nguồn HỆ THỐNG (updatedAt micro-giây do migration chèn) vẫn sửa được với updatedAt đọc qua Prisma", async () => {
    const n = await taoMau();
    const daThay = n.updatedAt;
    const a = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: daThay, vao: { name: "Bản của A" }, lyDo: null });
    expect(a).toMatchObject({ ok: true, doi: true });
    const sauA = await demAudit(n.id);
    const b = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: daThay, vao: { name: "Bản của B" }, lyDo: null });
    expect(b).toMatchObject({ ok: false, truong: "vuaDoi" });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).name).toBe("Bản của A");
    expect(await demAudit(n.id)).toBe(sauA);
    // bản sửa với updatedAt MỚI thì được
    expect((await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { name: "Bản của B" }, lyDo: null })).ok).toBe(true);

    // nguồn hệ thống: dòng do migration chèn bằng CURRENT_TIMESTAMP (micro-giây). Dựng lại đúng hình dạng đó, rồi sửa với updatedAt Prisma đọc về.
    const sys = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" } });
    await db.$executeRaw`UPDATE "LeadSourceGroup" SET "updatedAt" = '2026-10-01 03:00:00.123456+00' WHERE "id" = ${sys.id}`;
    const docLai = await moiNhat(sys.id);
    expect(await suaNguon({ nguoi, id: sys.id, updatedAtDaThay: docLai, vao: { description: "Khách tự đến" }, lyDo: null })).toMatchObject({ ok: true, doi: true });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: sys.id } })).description).toBe("Khách tự đến");
  });

  it("[DMG-DB-05] audit đúng hành động + cũ→mới + lý do: đổi cửa sổ · đổi người phụ trách · đổi hoa hồng · sửa chung; sửa thiếu lý do ⇒ DB và audit KHÔNG đổi", async () => {
    const n = await taoMau({ attributionWindowDays: 60 });
    const chu = await nhanSu({ coTaiKhoan: true });
    const lanDau = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: n.updatedAt, vao: { attributionWindowDays: 30 }, lyDo: LY_DO });
    expect(lanDau.ok).toBe(true);
    const lanHai = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { ownerEmployeeId: chu }, lyDo: LY_DO });
    expect(lanHai.ok).toBe(true);
    const lanBa = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { commissionEnabled: true }, lyDo: LY_DO });
    expect(lanBa.ok).toBe(true);
    const lanTu = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { name: "Tên mới", sortOrder: 9 }, lyDo: null });
    expect(lanTu.ok).toBe(true);

    const nk = await db.auditLog.findMany({ where: { entityType: "LeadSourceGroup", entityId: n.id }, orderBy: { createdAt: "asc" } });
    expect(nk.map((x) => x.action)).toEqual(["NGUON_TAO", "NGUON_DOI_CUA_SO", "NGUON_DOI_PHU_TRACH", "NGUON_DOI_HOA_HONG", "NGUON_SUA"]);
    expect(nk[1]).toMatchObject({ reason: LY_DO, changedFields: ["attributionWindowDays"], oldValues: { attributionWindowDays: 60 }, newValues: { attributionWindowDays: 30 } });
    expect(nk[2]).toMatchObject({ changedFields: ["ownerEmployeeId"], oldValues: { ownerEmployeeId: null }, newValues: { ownerEmployeeId: chu } });
    expect(nk[3]).toMatchObject({ oldValues: { commissionEnabled: false }, newValues: { commissionEnabled: true } });
    expect(nk[4]!.changedFields.sort()).toEqual(["name", "sortOrder"]);
    expect(nk.every((x) => x.actorId === nguoi.userId)).toBe(true);

    // thiếu lý do cho đổi nhạy cảm
    const truoc = await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } });
    const demTruoc = await demAudit(n.id);
    for (const patch of [{ attributionWindowDays: 10 }, { commissionEnabled: false }, { ownerEmployeeId: null }, { selectable: false }]) {
      expect(await suaNguon({ nguoi, id: n.id, updatedAtDaThay: truoc.updatedAt, vao: patch, lyDo: "ngắn" }), JSON.stringify(patch)).toMatchObject({ ok: false, truong: "lyDo" });
    }
    expect(await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).toEqual(truoc);
    expect(await demAudit(n.id)).toBe(demTruoc);
    // gửi lại nguyên giá trị cũ ⇒ không ghi, không audit
    const khong = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: truoc.updatedAt, vao: { name: truoc.name, commissionEnabled: truoc.commissionEnabled, code: truoc.code }, lyDo: null });
    expect(khong).toMatchObject({ ok: true, doi: false });
    expect(await demAudit(n.id)).toBe(demTruoc);
  });

  describe("[DMG-DB-06] code BẤT BIẾN theo TỪNG loại tham chiếu", () => {
    const loai = {
      attribution: async (g: { id: string; code: string }) => {
        const lead = await db.lead.create({ data: { parentName: `${P}ph${hau()}`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "MOI" } });
        await db.$transaction((tx) => taoNguonBanDau(tx, lead.id, duLieuNguon(g.id), null));
        return async () => {
          await db.leadAttribution.deleteMany({ where: { leadId: lead.id } });
        };
      },
      "nguồn gốc (originalGroupId)": async (g: { id: string; code: string }) => {
        const khac = await taoMau();
        const lead = await db.lead.create({ data: { parentName: `${P}ph${hau()}`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "MOI" } });
        await db.$transaction((tx) => taoNguonBanDau(tx, lead.id, duLieuNguon(khac.id, { originalGroupId: g.id }), null));
        return async () => {
          await db.leadAttribution.deleteMany({ where: { leadId: lead.id } });
        };
      },
      touchpoint: async (g: { id: string; code: string }) => {
        const lead = await db.lead.create({ data: { parentName: `${P}ph${hau()}`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "MOI" } });
        await db.$transaction((tx) => ghiTouchpoint(tx, lead.id, { kind: "TAO_LEAD", conversionEntry: null, claimedGroupId: g.id, signals: null }, null));
        return async () => {
          await db.leadTouchpoint.deleteMany({ where: { leadId: lead.id } });
        };
      },
      "phiên bản chính sách": async (g: { id: string; code: string }) => {
        const pol = await db.commissionPolicy.create({ data: { policyCode: `${P}pol${hau()}`, name: "CS thử" } });
        await db.commissionPolicyVersion.create({
          data: { policyId: pol.id, versionNo: 1, status: "DRAFT", effectiveFrom: new Date("2027-01-01T00:00:00Z"), reason: "fx", scopeType: "SOURCE_GROUP", scopeKey: `SOURCE_GROUP:${g.id}`, scopeSourceGroupId: g.id },
        });
        return async () => {
          await db.commissionPolicyVersion.deleteMany({ where: { policyId: pol.id } });
        };
      },
      "bảng Page→nguồn (theo MÃ)": async (g: { id: string; code: string }) => {
        await datSetting("nguon.bangNguonTheoPage", { [`${P}page`]: { groupCode: g.code } });
        return async () => datSetting("nguon.bangNguonTheoPage", null);
      },
      "nhóm nhân sự mặc định (theo MÃ)": async (g: { id: string; code: string }) => {
        await datSetting("nguon.nhomNhanSuMacDinh", g.code);
        return async () => datSetting("nguon.nhomNhanSuMacDinh", null);
      },
    } satisfies Record<string, (g: { id: string; code: string }) => Promise<() => Promise<void>>>;

    for (const [ten, gan] of Object.entries(loai)) {
      it(`[DMG-DB-06] ${ten}: có tham chiếu ⇒ đổi mã bị chặn + docDaDung báo đúng; gỡ tham chiếu ⇒ đổi mã được`, async () => {
        const n = await taoMau();
        const go = await gan(n);
        const boiCanh = { bangPage: await layBangNguonTheoPage(), nhomMacDinh: await layNhomNhanSuMacDinh() };
        expect((await docDaDung(db, n, boiCanh)).daDung, "docDaDung phải thấy tham chiếu").toBe(true);
        const bi = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { code: `${n.code}_X` }, lyDo: LY_DO });
        expect(bi, ten).toMatchObject({ ok: false, truong: "code" });
        expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).code).toBe(n.code);

        await go();
        const boiCanh2 = { bangPage: await layBangNguonTheoPage(), nhomMacDinh: await layNhomNhanSuMacDinh() };
        expect((await docDaDung(db, n, boiCanh2)).daDung, "gỡ rồi thì chưa dùng").toBe(false);
        const duoc = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { code: `${n.code}_X` }, lyDo: LY_DO });
        expect(duoc).toMatchObject({ ok: true, doi: true });
        expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).code).toBe(`${n.code}_X`);
      });
    }

    it("[DMG-DB-06] đổi mã sang mã của nguồn KHÁC (kể cả khác hoa/thường) bị chặn", async () => {
      const a = await taoMau();
      const b = await taoMau();
      const r = await suaNguon({ nguoi, id: b.id, updatedAtDaThay: b.updatedAt, vao: { code: a.code.toLowerCase() }, lyDo: LY_DO });
      expect(r).toMatchObject({ ok: false, truong: "code" });
      expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: b.id } })).code).toBe(b.code);
    });
  });

  it("[DMG-DB-07] referrerRequirement / requiresNote: CHƯA dùng ⇒ đổi được; ĐÃ dùng ⇒ khoá (lead cũ mang hình dạng cũ)", async () => {
    const n = await taoMau();
    const ok = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: n.updatedAt, vao: { referrerRequirement: "EMPLOYEE", requiresNote: true }, lyDo: LY_DO });
    expect(ok).toMatchObject({ ok: true, doi: true });
    expect(await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ referrerRequirement: "EMPLOYEE", requiresNote: true });

    const lead = await db.lead.create({ data: { parentName: `${P}ph${hau()}`, phone: `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, status: "MOI" } });
    await db.$transaction((tx) => taoNguonBanDau(tx, lead.id, duLieuNguon(n.id), null));
    const khoa = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { referrerRequirement: "NONE" }, lyDo: LY_DO });
    expect(khoa).toMatchObject({ ok: false, truong: "referrerRequirement" });
    const khoa2 = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { requiresNote: false }, lyDo: LY_DO });
    expect(khoa2).toMatchObject({ ok: false, truong: "requiresNote" });
    expect(await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).toMatchObject({ referrerRequirement: "EMPLOYEE", requiresNote: true });
    // nguồn đã dùng vẫn đổi được cửa sổ / hoa hồng
    expect((await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { attributionWindowDays: 20 }, lyDo: LY_DO })).ok).toBe(true);
  });

  it("[DMG-DB-08] nguồn HỆ THỐNG: không lưu trữ · không đổi mã · UNKNOWN đứng yên · sửa tên/cửa sổ/hoa hồng được (rồi trả nguyên trạng)", async () => {
    const lay = async (code: string) => db.leadSourceGroup.findUniqueOrThrow({ where: { code } });
    const unk = await lay("UNKNOWN");
    const ads = await lay("PAID_ADS");
    const dem0 = await demAudit();
    const cam: [string, Parameters<typeof doiTrangThaiNguon>[0]][] = [
      ["UNKNOWN→ARCHIVED", { nguoi, id: unk.id, updatedAtDaThay: unk.updatedAt, den: "ARCHIVED", lyDo: LY_DO }],
      ["UNKNOWN→INACTIVE", { nguoi, id: unk.id, updatedAtDaThay: unk.updatedAt, den: "INACTIVE", lyDo: LY_DO }],
      ["PAID_ADS→ARCHIVED", { nguoi, id: ads.id, updatedAtDaThay: ads.updatedAt, den: "ARCHIVED", lyDo: LY_DO }],
    ];
    for (const [ten, vao] of cam) expect(await doiTrangThaiNguon(vao), ten).toMatchObject({ ok: false, truong: "trangThai" });
    expect(await suaNguon({ nguoi, id: unk.id, updatedAtDaThay: unk.updatedAt, vao: { code: "UNKNOWN_2" }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "code" });
    expect(await suaNguon({ nguoi, id: unk.id, updatedAtDaThay: unk.updatedAt, vao: { commissionEnabled: true }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "commissionEnabled" });
    // Siết 09/10 (Q2): UNKNOWN còn khoá cửa sổ ghi công + đơn vị phụ trách (người phụ trách: ca thuần `[DMV-03b]` — cần một nhân sự thật để dựng ở đây).
    expect(await suaNguon({ nguoi, id: unk.id, updatedAtDaThay: unk.updatedAt, vao: { attributionWindowDays: 30 }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "attributionWindowDays" });
    expect(await suaNguon({ nguoi, id: unk.id, updatedAtDaThay: unk.updatedAt, vao: { ownerOrgUnitId: "bat-ky-don-vi" }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "ownerOrgUnitId" });
    expect(await suaNguon({ nguoi, id: ads.id, updatedAtDaThay: ads.updatedAt, vao: { code: "ADS_MOI" }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "code" });
    expect(await suaNguon({ nguoi, id: ads.id, updatedAtDaThay: ads.updatedAt, vao: { referrerRequirement: "PARENT" }, lyDo: LY_DO })).toMatchObject({ ok: false, truong: "referrerRequirement" });
    expect(await lay("UNKNOWN")).toEqual(unk);
    expect(await lay("PAID_ADS")).toEqual(ads);
    expect(await demAudit()).toBe(dem0);

    // đối chứng dương: sửa được tên + cửa sổ + hoa hồng của nguồn hệ thống
    const sua = await suaNguon({ nguoi, id: ads.id, updatedAtDaThay: ads.updatedAt, vao: { name: "Quảng cáo trả phí", attributionWindowDays: 45, commissionEnabled: false }, lyDo: LY_DO });
    expect(sua).toMatchObject({ ok: true, doi: true });
    expect(await lay("PAID_ADS")).toMatchObject({ name: "Quảng cáo trả phí", attributionWindowDays: 45, commissionEnabled: false, isSystem: true, status: "ACTIVE" });
  });

  it("[DMG-DB-09] nhóm mặc định «nhân sự giới thiệu»: không ngừng / tắt chọn được; đổi nhóm mặc định sang nguồn khác thì bên cũ ngừng được và bên mới bị khoá", async () => {
    const mac = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "EMPLOYEE_REFERRAL" } });
    expect(await layNhomNhanSuMacDinh()).toBe("EMPLOYEE_REFERRAL");
    expect(await doiTrangThaiNguon({ nguoi, id: mac.id, updatedAtDaThay: mac.updatedAt, den: "INACTIVE", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "trangThai" });
    expect(await suaNguon({ nguoi, id: mac.id, updatedAtDaThay: mac.updatedAt, vao: { selectable: false }, lyDo: LY_DO })).toMatchObject({ ok: false });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: mac.id } })).status).toBe("ACTIVE");

    const rieng = await taoMau({ referrerRequirement: "EMPLOYEE" });
    await datSetting("nguon.nhomNhanSuMacDinh", rieng.code);
    expect(await doiTrangThaiNguon({ nguoi, id: rieng.id, updatedAtDaThay: rieng.updatedAt, den: "INACTIVE", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "trangThai" });
    expect((await doiTrangThaiNguon({ nguoi, id: mac.id, updatedAtDaThay: mac.updatedAt, den: "INACTIVE", lyDo: LY_DO })).ok).toBe(true);
    await doiTrangThaiNguon({ nguoi, id: mac.id, updatedAtDaThay: await moiNhat(mac.id), den: "ACTIVE", lyDo: LY_DO }); // trả nguyên trạng
  });

  it("[DMG-DB-10] người phụ trách: id không có · đã nghỉ ⇒ chặn; chưa có tài khoản ⇒ CẢNH BÁO (engine sẽ treo phần của họ); chủ đã nghỉ KHÔNG chặn việc sửa tên", async () => {
    const khong = await taoNguon({ nguoi, vao: { ...TAO_MAU, code: `DMG_${hau()}`, ownerEmployeeId: "khong-co-nhan-su-nay" } });
    expect(khong).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
    const nghi = await nhanSu({ status: "RESIGNED", coTaiKhoan: true });
    expect(await taoNguon({ nguoi, vao: { ...TAO_MAU, code: `DMG_${hau()}`, ownerEmployeeId: nghi } })).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
    const donViLa = await taoNguon({ nguoi, vao: { ...TAO_MAU, code: `DMG_${hau()}`, ownerOrgUnitId: "khong-co-don-vi" } });
    expect(donViLa).toMatchObject({ ok: false, truong: "ownerOrgUnitId" });

    const khongTk = await nhanSu({ coTaiKhoan: false });
    const canh = await taoNguon({ nguoi, vao: { ...TAO_MAU, code: `DMG_${hau()}`, ownerEmployeeId: khongTk } });
    expect(canh).toMatchObject({ ok: true, canhBao: ["NGUOI_PHU_TRACH_CHUA_CO_TAI_KHOAN"] });

    const chu = await nhanSu({ coTaiKhoan: true });
    const n = await taoMau({ ownerEmployeeId: chu });
    await db.employee.update({ where: { id: chu }, data: { status: "RESIGNED" } });
    // biểu mẫu gửi lại cả ô phụ trách (không đổi) khi sửa tên ⇒ vẫn được
    const sua = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: n.updatedAt, vao: { name: "Tên mới", ownerEmployeeId: chu }, lyDo: null });
    expect(sua).toMatchObject({ ok: true, doi: true });
    // nhưng GÁN một người nghỉ mới thì chặn
    const dich = await suaNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { ownerEmployeeId: nghi }, lyDo: LY_DO });
    expect(dich).toMatchObject({ ok: false, truong: "ownerEmployeeId" });
  });

  it("[DMG-DB-11] vòng đời trạng thái: audit đúng hành động từng bước; ngừng cần lý do; lưu trữ rồi khôi phục về INACTIVE; không có xoá cứng", async () => {
    const n = await taoMau({ trangThai: "DRAFT" });
    const buoc = async (den: "ACTIVE" | "INACTIVE" | "ARCHIVED", lyDo: string | null) => doiTrangThaiNguon({ nguoi, id: n.id, updatedAtDaThay: await moiNhat(n.id), den, lyDo });
    expect(await buoc("ACTIVE", null)).toMatchObject({ ok: true, tu: "DRAFT", den: "ACTIVE" }); // kích hoạt bản nháp: không cần lý do
    expect(await buoc("INACTIVE", null)).toMatchObject({ ok: false, truong: "lyDo" });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("ACTIVE");
    expect((await buoc("INACTIVE", LY_DO)).ok).toBe(true);
    expect((await buoc("ACTIVE", LY_DO)).ok).toBe(true);
    expect((await buoc("ARCHIVED", LY_DO)).ok).toBe(true);
    expect(await buoc("ACTIVE", LY_DO)).toMatchObject({ ok: false, truong: "trangThai" }); // lưu trữ → phải qua INACTIVE
    expect((await buoc("INACTIVE", LY_DO)).ok).toBe(true);

    const nk = await db.auditLog.findMany({ where: { entityType: "LeadSourceGroup", entityId: n.id }, orderBy: { createdAt: "asc" } });
    expect(nk.map((x) => x.action)).toEqual(["NGUON_TAO", "NGUON_KICH_HOAT", "NGUON_NGUNG", "NGUON_MO_LAI", "NGUON_LUU_TRU", "NGUON_KHOI_PHUC"]);
    expect(nk[2]).toMatchObject({ reason: LY_DO, oldValues: { status: "ACTIVE" }, newValues: { status: "INACTIVE" } });
    // người gọi cũ (đã thấy trước các bước trên) bị từ chối
    expect(await doiTrangThaiNguon({ nguoi, id: n.id, updatedAtDaThay: n.updatedAt, den: "ACTIVE", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "vuaDoi" });
    // không tìm thấy
    expect(await doiTrangThaiNguon({ nguoi, id: "khong-co", updatedAtDaThay: n.updatedAt, den: "ACTIVE", lyDo: LY_DO })).toMatchObject({ ok: false, truong: "khongTimThay" });
  });
});
