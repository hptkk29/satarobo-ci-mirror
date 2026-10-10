// @vitest-environment node
/**
 * [CTN-DB-*] — MỘT lượt đọc cho TRANG chi tiết một nguồn (`lib/nguon/doc-trang-chi-tiet.ts`; SPEC nguồn động §4 mục 4) trên Postgres THẬT.
 *
 *   [CTN-DB-01] «Đối tượng liên quan»: đếm lead theo LOẠI người giới thiệu, qua `scopedDb` — Hội sở thấy hai cơ sở, QLCS CS1 chỉ thấy CS1 (CÁCH LY)
 *   [CTN-DB-02] ghép trang: mã lạ ⇒ null; mã có ⇒ đủ bảy nguồn dữ liệu `ok`; tên đơn vị được đọc ra (không in id thô)
 *   [CTN-DB-03] QUYỀN theo mục: GV (không `sources:view`) nhận QUYEN ở ba mục tự gác, hoa hồng = null (≠ 0); HO có quyền ⇒ cả bảy ok (đối chứng dương)
 *   [CTN-DB-04] nhật ký có GIỚI HẠN: xin n thì trả đúng n + cờ «còn nữa»; đủ đúng n thì KHÔNG báo còn; chạm trần 200 thì nói «có thể còn»
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng. LUẬT 19: ngày tuyệt đối. Tệp chạy được MỘT MÌNH trên DB trống đã migrate + seed vai.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { docTrangChiTietNguon } from "../../lib/nguon/doc-trang-chi-tiet";
import { demNguoiGioiThieuTheoLoai } from "../../lib/nguon/dem-nguoi-gioi-thieu";
import { clearSettingsCache } from "../../lib/settings/service";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { actorCua, D, donKichBan, dungKichBan, ganVai, lamNhanVien, nguoiKyHo, nguoiKyQlcs, type KichBan } from "./_kich-ban";
import { ghiNguonQuaDuongThat, suaNguon, themLead, taoNguon } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[CTN-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-ctn";
const NOW = D("2027-02-20");
const ATTRIBUTED = new Date("2026-10-01T03:00:00.000Z");
const cuaToi: KichBan[] = [];
let admin: { userId: string; ten: string };
let stamp = 0;

async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [] });
  cuaToi.push(k);
  return k;
}

const MAU = {
  name: "Nguồn thử",
  description: null,
  sourceType: "MARKETING",
  referrerRequirement: "NONE",
  requiresNote: false,
  selectable: true,
  sortOrder: 400,
  trangThai: "ACTIVE",
  attributionWindowDays: null,
  commissionEnabled: false,
  ownerOrgUnitId: null,
  ownerEmployeeId: null,
  effectiveFrom: null,
  effectiveTo: null,
} as const;

async function taoNguonCtn(hau: string, ghi: Record<string, unknown> = {}) {
  stamp += 1;
  const code = `CTN_${hau}_${Date.now().toString(36).toUpperCase()}${stamp}`;
  const r = await taoNguon({ nguoi: admin, vao: { ...MAU, code, name: `CTN ${hau}`, ...ghi } });
  if (!r.ok) throw new Error(`taoNguon(${hau}): ${r.truong}: ${r.loi}`);
  return { id: r.id, code: r.code };
}
const moiNhat = async (id: string) => (await db.leadSourceGroup.findUniqueOrThrow({ where: { id } })).updatedAt;
const chon = (groupId: string, p: { employeeId?: string | null; parentUserId?: string | null } = {}) => ({
  groupId,
  employeeId: p.employeeId ?? null,
  parentUserId: p.parentUserId ?? null,
  studentId: null,
  affiliateId: null,
  giaiTrinh: null,
});

describe.skipIf(!RUN_DB_TESTS)("[CTN-DB] trang chi tiết nguồn — một lượt đọc, cô lập theo mục", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT", "CENTER_SALES_CSM", "TEACHER"] });
    await damBaoDanhMucGoc(db);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    const u = await seedUser({ email: `${NHAN}-admin@ci.test`, role: "MARKETING", name: `${NHAN}-admin`, phone: null });
    admin = { userId: u.id, ten: `${NHAN}-admin` };
  }, 120_000);
  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });
  afterAll(async () => {
    await donKichBan(cuaToi);
    // lead thêm bằng themLead (donKichBan chỉ dọn lead đầu của kịch bản) — attribution là FK Restrict sang nhóm nguồn nên phải gỡ trước khi xoá nhóm
    const gan = await db.leadAttribution.findMany({ where: { group: { code: { startsWith: "CTN_" } } }, select: { leadId: true } });
    const leadIds = gan.map((g) => g.leadId);
    await db.leadTouchpoint.deleteMany({ where: { leadId: { in: leadIds } } });
    await db.leadAttribution.deleteMany({ where: { leadId: { in: leadIds } } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "CTN_" } } });
    await db.auditLog.deleteMany({ where: { OR: [{ actorName: { startsWith: NHAN } }, { reason: { startsWith: NHAN } }] } });
    await damBaoDanhMucGoc(db);
  }, 90_000);

  it("[CTN-DB-01] đếm lead theo LOẠI người giới thiệu qua scopedDb — Hội sở thấy cả hai cơ sở, QLCS CS1 chỉ thấy CS1", async () => {
    const k1 = await kb("c01a");
    const k2 = await kb("c01b");
    const ph = await seedUser({ email: `${k1.ma}-ph@ci.test`, role: "PARENT", name: `${NHAN}-ph`, phone: null });
    const ns = await seedUser({ email: `${k1.ma}-ns@ci.test`, role: "SALES_CSM", name: `${NHAN}-ns`, phone: null });
    const nsId = await lamNhanVien(ns.id, "ns");
    await ganVai(ns.id, k1.ouId, "CENTER_SALES_CSM");
    const nNv = await taoNguonCtn("NV", { referrerRequirement: "EMPLOYEE" });
    const nPh = await taoNguonCtn("PH", { referrerRequirement: "PARENT" });

    // 2 lead CS1 + 1 lead CS2 giới thiệu bởi nhân sự; 1 lead CS1 giới thiệu bởi phụ huynh
    const k1b = await themLead(k1, "b");
    await ghiNguonQuaDuongThat(k1, { nguonChon: chon(nNv.id, { employeeId: nsId }) }, ATTRIBUTED);
    await ghiNguonQuaDuongThat(k1b, { nguonChon: chon(nNv.id, { employeeId: nsId }) }, ATTRIBUTED, k1b.lead!.id);
    await ghiNguonQuaDuongThat(k2, { nguonChon: chon(nNv.id, { employeeId: nsId }) }, ATTRIBUTED);
    const k1c = await themLead(k1, "c");
    await ghiNguonQuaDuongThat(k1c, { nguonChon: chon(nPh.id, { parentUserId: ph.id }) }, ATTRIBUTED, k1c.lead!.id);

    const ho = (await nguoiKyHo()).quyen;
    const ql1 = (await nguoiKyQlcs(k1)).quyen;

    expect(await demNguoiGioiThieuTheoLoai(ho, nNv.code)).toEqual({ EMPLOYEE: 3, PARENT: 0, AFFILIATE: 0 });
    expect(await demNguoiGioiThieuTheoLoai(ho, nPh.code)).toEqual({ EMPLOYEE: 0, PARENT: 1, AFFILIATE: 0 });
    // CÁCH LY: QLCS CS1 không đếm lead CS2 (3 → 2)
    expect(await demNguoiGioiThieuTheoLoai(ql1, nNv.code)).toEqual({ EMPLOYEE: 2, PARENT: 0, AFFILIATE: 0 });
    // mã lạ ⇒ toàn số 0, không ném
    expect(await demNguoiGioiThieuTheoLoai(ho, "KHONG_CO_NGUON_NAY")).toEqual({ EMPLOYEE: 0, PARENT: 0, AFFILIATE: 0 });
  });

  it("[CTN-DB-02] ghép trang: mã lạ ⇒ null; mã có ⇒ đủ nguồn dữ liệu ok; tên đơn vị đọc ra (không id thô)", async () => {
    const k = await kb("c02");
    const ho = (await nguoiKyHo()).quyen;
    const gan = await taoNguonCtn("DV", { ownerOrgUnitId: k.ouId });
    const khong = await taoNguonCtn("KDV");

    expect(await docTrangChiTietNguon(ho, "KHONG_CO_NGUON_NAY", { now: NOW, lichSuToiDa: 10 })).toBeNull();

    const t = (await docTrangChiTietNguon(ho, gan.code, { now: NOW, lichSuToiDa: 10 }))!;
    for (const [ten, r] of Object.entries({ chiTiet: t.chiTiet, nguon: t.nguon, nguoiGioiThieu: t.nguoiGioiThieu, chinhSach: t.chinhSach, hoaHong: t.hoaHong, lichSu: t.lichSu })) {
      expect(r.ok, `mục ${ten}`).toBe(true);
    }
    expect(t.tenDonVi).toBe(`ĐV ${k.ma}`);
    expect(t.nguon.ok && t.nguon.du.ownerOrgUnitId).toBe(k.ouId);

    const t2 = (await docTrangChiTietNguon(ho, khong.code, { now: NOW, lichSuToiDa: 10 }))!;
    expect(t2.tenDonVi).toBeNull(); // nguồn không gắn đơn vị
    // nguồn mới tạo có đúng MỘT dòng nhật ký (tạo)
    expect(t2.lichSu.ok && t2.lichSu.du.muc.map((m) => m.hanhDong)).toEqual(["NGUON_TAO"]);
  });

  it("[CTN-DB-03] QUYỀN theo mục: GV (không sources:view) ⇒ QUYEN ở ba mục tự gác, hoa hồng null (≠ 0); HO ⇒ cả sáu mục ok (đối chứng dương)", async () => {
    const n = await taoNguonCtn("QX");
    const ho = (await nguoiKyHo()).quyen;
    const gvUser = await seedUser({ email: `${NHAN}-gv@ci.test`, role: "TEACHER", name: `${NHAN}-gv`, phone: null });
    const gv = await actorCua(gvUser.id);
    expect(gv.permissions.some((p) => p.action === "sources:view")).toBe(false); // tiền đề

    const tGv = (await docTrangChiTietNguon(gv, n.code, { now: NOW, lichSuToiDa: 10 }))!;
    expect(tGv.nguon).toEqual({ ok: false, loai: "QUYEN" });
    expect(tGv.chinhSach).toEqual({ ok: false, loai: "QUYEN" });
    expect(tGv.lichSu).toEqual({ ok: false, loai: "QUYEN" });
    expect(tGv.hoaHong).toEqual({ ok: true, du: null }); // không quyền xem hoa hồng ⇒ null, KHÔNG phải số 0

    const tHo = (await docTrangChiTietNguon(ho, n.code, { now: NOW, lichSuToiDa: 10 }))!;
    expect([tHo.chiTiet.ok, tHo.nguon.ok, tHo.nguoiGioiThieu.ok, tHo.chinhSach.ok, tHo.lichSu.ok]).toEqual([true, true, true, true, true]);
    expect(tHo.hoaHong.ok && tHo.hoaHong.du).not.toBeNull();
  });

  it("[CTN-DB-04] nhật ký có giới hạn: xin n ⇒ đúng n + «còn nữa»; đủ đúng n ⇒ KHÔNG báo còn; chạm trần 200 ⇒ «có thể còn»", async () => {
    const n = await taoNguonCtn("LS");
    // 11 lần sửa tên ⇒ 12 dòng nhật ký (1 tạo + 11 sửa)
    for (let i = 1; i <= 11; i += 1) {
      const r = await suaNguon({ nguoi: admin, id: n.id, updatedAtDaThay: await moiNhat(n.id), vao: { name: `CTN LS lần ${i}` }, lyDo: null });
      expect(r).toMatchObject({ ok: true, doi: true });
    }
    const ho = (await nguoiKyHo()).quyen;
    const doc = async (toiDa: number) => {
      const t = (await docTrangChiTietNguon(ho, n.code, { now: NOW, lichSuToiDa: toiDa }))!;
      if (!t.lichSu.ok) throw new Error("nhật ký không đọc được");
      return t.lichSu.du;
    };
    const a = await doc(5);
    expect(a.muc).toHaveLength(5);
    expect(a.biCat).toBe(true);
    expect(a.muc[0]!.hanhDong).toBe("NGUON_SUA"); // mới nhất trước
    const b = await doc(12);
    expect(b.muc).toHaveLength(12);
    expect(b.biCat).toBe(false); // đủ ĐÚNG n dòng ⇒ không nói «còn nữa»
    expect(b.muc.at(-1)!.hanhDong).toBe("NGUON_TAO");
    const c = await doc(13);
    expect(c.muc).toHaveLength(12);
    expect(c.biCat).toBe(false);
    const d = await doc(11);
    expect(d.muc).toHaveLength(11);
    expect(d.biCat).toBe(true); // 12 > 11

    // chạm TRẦN 200: 205 dòng ⇒ chỉ đọc được 200, và nói thật là có thể còn
    await db.auditLog.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({
        actorName: `${NHAN}-bulk`,
        module: "nguon-hoa-hong",
        entityType: "LeadSourceGroup",
        entityId: n.id,
        action: "NGUON_SUA",
        changedFields: ["name"],
        reason: `${NHAN} bulk ${i}`,
      })),
    });
    const e = await doc(500);
    expect(e.muc).toHaveLength(200);
    expect(e.biCat).toBe(true);
  });
});
