// @vitest-environment node
/**
 * [NHH-DOI-DB-*] — "DỜI HÀNG CHỜ SANG KỲ SAU" (điều phối `doiHangChoSangKyHanhDong` + Server Action `doiHangChoSangKySauAction`) trên Postgres THẬT.
 *
 * Service (`doiHangChoSangKySau`) đã có bộ riêng (`so-ky-hang-cho` PER-08f, `so-xuat-quyen`). Bộ này canh những gì lớp điều phối + action thêm:
 *   · CỔNG ĐỨNG TRƯỚC PHÉP GHI: `bamKy` (mở kỳ SAU) là phép ghi và chạy TRƯỚC transaction của service ⇒ hàng chờ không dời được (sai mã · đã đóng · không chặn kỳ nào ·
 *     ngoài phạm vi · thiếu lý do · engine tắt) phải bị chặn mà KHÔNG có kỳ tháng sau nào được tạo. Mỗi ca "bị từ chối" đo cả `blockingPeriodId` lẫn SỐ KỲ THÁNG SAU;
 *   · chỉ đúng hai mã cứng dời được (cùng hàm với nút ở tab Sổ);
 *   · ma trận quyền vai × action chạy THẬT (RBAC v2 từ Postgres): vai được ⇒ hàng chờ đổi chỗ + audit DEFER; vai không được ⇒ `KHONG_QUYEN` nêu khoá, DB nguyên trạng,
 *     và kết quả cho id THẬT == kết quả cho id KHÔNG TỒN TẠI (không lộ tồn tại).
 *
 * Mỗi ca dựng cơ sở riêng (luật 18) ⇒ chạy ĐƯỢC MỘT MÌNH. Ngày TUYỆT ĐỐI (luật 19). Hàng chờ dựng thẳng bằng Prisma (đã có kỳ cha thật qua `bamKy`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { doiHangChoSangKyHanhDong, type PhuThuoc } from "../../lib/hoa-hong/ky-hanh-dong";
import { bamKy } from "../../lib/hoa-hong/ky-db";
import { demHangChoChan } from "../../lib/hoa-hong/ky-service";
import type { MaHold } from "../../lib/hoa-hong/hang-cho";
import { doiHangChoSangKySauAction } from "../../app/(admin)/admin/nguon-hoa-hong/ky/_actions";
import { clearSettingsCache } from "../../lib/settings/service";
import { boiCanh, D, datMocCutover, donKichBan, dungKichBan, ganVai, nguoiKyHo, nguoiKyQlcs, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-DOI-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const THANG = "2026-10";
const KY_SAU = "2026-11";
const LY_DO = "chờ văn bản của BGĐ, dời sang kỳ sau";
const cuaToi: KichBan[] = [];
const holdIds: string[] = [];
async function kb(tien: string) {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.03 }] });
  cuaToi.push(k);
  return k;
}

function phuThuoc(k: KichBan, engine = true): PhuThuoc {
  return {
    engineBat: async () => engine,
    xuatLuongBat: async () => true,
    dungBoiCanh: async (now) => (engine ? { loai: "BAT", bc: await boiCanh(k, now) } : { loai: "TAT", lyDo: "ENGINE_TAT" }),
    soThangDoiSoat: async () => 0,
  };
}

/** Kỳ THÁNG 10 của cơ sở kịch bản (mở bằng đường thật `bamKy`) + MỘT hàng chờ mở chặn kỳ đó. */
async function dungHold(k: KichBan, code: MaHold, p: { status?: "OPEN" | "RESOLVED"; chan?: boolean } = {}) {
  const ky = await bamKy(db, { thang: THANG, centerId: k.centerId, orgUnitId: k.ouId, kyCutover: "2026-10" });
  const h = await db.commissionHold.create({
    data: {
      holdKey: `${k.ma}:${code}:${holdIds.length}`,
      code,
      severity: "HARD",
      status: p.status ?? "OPEN",
      blockingPeriodId: p.chan === false ? null : ky.id,
      centerId: k.centerId,
      detail: { lyDo: "fixture" },
      ...(p.status === "RESOLVED" ? { resolvedAt: NOW, resolutionNote: "fixture" } : {}),
    },
  });
  holdIds.push(h.id);
  return { hold: h, kyId: ky.id };
}
const hold = (id: string) => db.commissionHold.findUniqueOrThrow({ where: { id } });
const soKySau = (k: KichBan) => db.commissionPeriod.count({ where: { period: KY_SAU, centerId: k.centerId } });
const soDefer = (id: string) => db.auditLog.count({ where: { entityType: "CommissionHold", entityId: id, action: "DEFER" } });

describe.skipIf(!RUN_DB_TESTS)("[NHH-DOI-DB] dời hàng chờ sang kỳ sau", () => {
  const truocRbac = process.env.RBAC_V2_ENABLED;
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  beforeEach(() => {
    process.env.RBAC_V2_ENABLED = "true";
    SESS.current = null;
  });
  afterAll(async () => {
    if (truocRbac === undefined) delete process.env.RBAC_V2_ENABLED;
    else process.env.RBAC_V2_ENABLED = truocRbac;
    await db.auditLog.deleteMany({ where: { entityType: "CommissionHold", entityId: { in: holdIds } } });
    await db.commissionHold.deleteMany({ where: { id: { in: holdIds } } });
    await donKichBan(cuaToi);
    await datMocCutover(null);
    await db.systemSetting.deleteMany({ where: { key: "hoaHong.engineBat" } });
    clearSettingsCache();
  }, 60_000);

  it("[NHH-DOI-DB-01] hai mã cứng dời được: hàng chờ đổi sang kỳ sau, đúng MỘT audit DEFER mang lý do, kỳ cũ hết bị chặn, kỳ sau được mở đúng một lần", async () => {
    const k = await kb("doi01");
    const ho = await nguoiKyHo();
    const pt = phuThuoc(k);
    for (const code of ["PENDING_REGULATION", "MANUAL_REVIEW_REQUIRED"] as const) {
      const { hold: h, kyId } = await dungHold(k, code);
      expect(await demHangChoChan(db, kyId)).toBeGreaterThan(0);
      const r = await doiHangChoSangKyHanhDong(pt, { nguoi: ho, now: NOW, holdId: h.id, lyDo: LY_DO });
      expect(r, JSON.stringify(r)).toMatchObject({ ok: true, kySau: KY_SAU });
      expect((r as { thongBao: string }).thongBao).toContain("11/2026");
      const ky11 = await db.commissionPeriod.findFirstOrThrow({ where: { period: KY_SAU, centerId: k.centerId } });
      expect((await hold(h.id)).blockingPeriodId).toBe(ky11.id);
      expect((await hold(h.id)).status).toBe("OPEN"); // KHÔNG xoá hàng chờ
      expect(await soDefer(h.id)).toBe(1);
      const ad = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionHold", entityId: h.id, action: "DEFER" } });
      expect(ad.reason).toBe(LY_DO);
      expect(await soKySau(k)).toBe(1); // mở một lần, lần hai tái dùng
    }
    // cả hai hàng chờ đã chuyển hết: kỳ 10 không còn bị chặn
    const ky10 = await db.commissionPeriod.findFirstOrThrow({ where: { period: THANG, centerId: k.centerId } });
    expect(await demHangChoChan(db, ky10.id)).toBe(0);
  });

  it("[NHH-DOI-DB-02] KHÔNG dời được ⇒ từ chối mà KHÔNG có kỳ tháng sau nào được tạo (cổng đứng TRƯỚC bamKy): mã ngoài tập · đã đóng · không chặn kỳ nào", async () => {
    const k = await kb("doi02");
    const ho = await nguoiKyHo();
    const pt = phuThuoc(k);
    // đối chứng dương: cùng cơ sở, cùng người, hàng chờ đúng loại ⇒ dời được (để biết fixture + người thao tác không phải lý do từ chối)
    const tot = await dungHold(k, "PENDING_REGULATION");
    const cho = await doiHangChoSangKyHanhDong(pt, { nguoi: ho, now: NOW, holdId: tot.hold.id, lyDo: LY_DO });
    expect(cho.ok, JSON.stringify(cho)).toBe(true);
    // dọn kỳ 11 của đối chứng để đo "không tạo" cho các ca dưới
    await db.commissionHold.update({ where: { id: tot.hold.id }, data: { blockingPeriodId: tot.kyId } });
    await db.commissionPeriod.deleteMany({ where: { period: KY_SAU, centerId: k.centerId } });
    expect(await soKySau(k)).toBe(0);

    const cacCa: { ten: string; code: MaHold; p?: Parameters<typeof dungHold>[2]; ma: string }[] = [
      { ten: "CAP_EXCEEDED", code: "CAP_EXCEEDED", ma: "HANG_CHO_KHONG_DOI_DUOC" },
      { ten: "POLICY_OVERLAP", code: "POLICY_OVERLAP", ma: "HANG_CHO_KHONG_DOI_DUOC" },
      { ten: "CHUA_GAN_CON (mềm chặn khoá)", code: "CHUA_GAN_CON", ma: "HANG_CHO_KHONG_DOI_DUOC" },
      { ten: "INPUT_DRIFT", code: "INPUT_DRIFT", ma: "HANG_CHO_KHONG_DOI_DUOC" },
      { ten: "đúng mã nhưng đã RESOLVED", code: "PENDING_REGULATION", p: { status: "RESOLVED" }, ma: "HANG_CHO_KHONG_MO" },
      { ten: "đúng mã nhưng không chặn kỳ nào", code: "MANUAL_REVIEW_REQUIRED", p: { chan: false }, ma: "HANG_CHO_KHONG_CHAN" },
    ];
    for (const c of cacCa) {
      const { hold: h } = await dungHold(k, c.code, c.p);
      const truoc = await hold(h.id);
      const r = await doiHangChoSangKyHanhDong(pt, { nguoi: ho, now: NOW, holdId: h.id, lyDo: LY_DO });
      expect(r, c.ten).toMatchObject({ ok: false, ma: c.ma });
      expect((await hold(h.id)).blockingPeriodId, c.ten).toBe(truoc.blockingPeriodId);
      expect(await soDefer(h.id), c.ten).toBe(0);
      expect(await soKySau(k), `${c.ten}: bamKy không được chạy`).toBe(0);
    }
    // id không tồn tại ⇒ cùng kiểu từ chối "không mở", cũng không tạo kỳ
    const la = await doiHangChoSangKyHanhDong(pt, { nguoi: ho, now: NOW, holdId: "khong-ton-tai-doi02", lyDo: LY_DO });
    expect(la).toMatchObject({ ok: false, ma: "HANG_CHO_KHONG_MO" });
    expect(await soKySau(k)).toBe(0);
  });

  it("[NHH-DOI-DB-03] thiếu lý do · engine tắt ⇒ từ chối, hàng chờ nguyên trạng, không tạo kỳ sau; đối chứng: có lý do + engine bật ⇒ dời được", async () => {
    const k = await kb("doi03");
    const ho = await nguoiKyHo();
    const { hold: h } = await dungHold(k, "PENDING_REGULATION");
    const truoc = (await hold(h.id)).blockingPeriodId;

    const ngan = await doiHangChoSangKyHanhDong(phuThuoc(k), { nguoi: ho, now: NOW, holdId: h.id, lyDo: "ngắn" });
    expect(ngan).toMatchObject({ ok: false, ma: "THIEU_LY_DO" });
    const tat = await doiHangChoSangKyHanhDong(phuThuoc(k, false), { nguoi: ho, now: NOW, holdId: h.id, lyDo: LY_DO });
    expect(tat).toMatchObject({ ok: false, ma: "ENGINE_TAT" });
    for (const r of [ngan, tat]) expect(r.ok).toBe(false);
    expect((await hold(h.id)).blockingPeriodId).toBe(truoc);
    expect(await soKySau(k)).toBe(0);
    expect(await soDefer(h.id)).toBe(0);

    const ok = await doiHangChoSangKyHanhDong(phuThuoc(k), { nguoi: ho, now: NOW, holdId: h.id, lyDo: LY_DO });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(await soKySau(k)).toBe(1);
  });

  it("[NHH-DOI-DB-04] phạm vi cơ sở: QLCS CS1 KHÔNG dời được hàng chờ của kỳ CS2 (NGOAI_PHAM_VI, không tạo kỳ CS2 tháng sau); đối chứng: dời được của chính CS1", async () => {
    const k1 = await kb("doi04a");
    const k2 = await kb("doi04b");
    const ql1 = await nguoiKyQlcs(k1);
    const cuaCs2 = await dungHold(k2, "PENDING_REGULATION");
    const r = await doiHangChoSangKyHanhDong(phuThuoc(k2), { nguoi: ql1, now: NOW, holdId: cuaCs2.hold.id, lyDo: LY_DO });
    expect(r).toMatchObject({ ok: false, ma: "NGOAI_PHAM_VI" });
    expect((await hold(cuaCs2.hold.id)).blockingPeriodId).toBe(cuaCs2.kyId);
    expect(await soKySau(k2)).toBe(0);
    expect(await soDefer(cuaCs2.hold.id)).toBe(0);

    const cuaCs1 = await dungHold(k1, "MANUAL_REVIEW_REQUIRED");
    const ok = await doiHangChoSangKyHanhDong(phuThuoc(k1), { nguoi: ql1, now: NOW, holdId: cuaCs1.hold.id, lyDo: LY_DO });
    expect(ok.ok, JSON.stringify(ok)).toBe(true);
    expect(await soKySau(k1)).toBe(1);
  });

  // ── Ma trận quyền: Server Action thật, RBAC v2 thật ────────────────────────────────────────────────────────
  it("[NHH-DOI-DB-05] ma trận vai × doiHangChoSangKySauAction: chỉ SUPER_ADMIN và Kế toán HO (commission_periods:manage) dời được; vai khác bị chặn Ở ĐẦU HÀM — nêu khoá, DB nguyên, id thật == id không tồn tại", async () => {
    const DUOC = ["SUPER_ADMIN", "HO_ACCOUNTANT"] as const;
    const VAI = {
      SUPER_ADMIN: { role: "SUPER_ADMIN", don: "HO" },
      HO_ACCOUNTANT: { role: "ACCOUNTANT", don: "HO" },
      GIAM_DOC: { role: "HR", don: "HO" },
      HO_HR: { role: "HR", don: "HO" },
      HO_SALE: { role: "SALES_CSM", don: "HO" },
      CENTER_MANAGER: { role: "CENTER_MANAGER", don: "CS1" },
      CENTER_ACCOUNTANT: { role: "ACCOUNTANT", don: "CS1" },
      CENTER_SALES_CSM: { role: "SALES_CSM", don: "CS1" },
      TEACHER: { role: "TEACHER", don: "CS1" },
    } as const;
    await db.systemSetting.deleteMany({ where: { key: "hoaHong.engineBat" } });
    await db.systemSetting.create({ data: { key: "hoaHong.engineBat", valueJson: true } });
    clearSettingsCache();

    // tự kiểm: ma trận chỉ nêu vai CÓ trong DB (thiếu vai ⇒ "bị chặn" xanh vì lý do sai: người dùng không có vai nào)
    const co = new Set((await db.roleDef.findMany({ where: { code: { in: Object.keys(VAI) } }, select: { code: true } })).map((r) => r.code));
    for (const ten of Object.keys(VAI)) expect(co.has(ten), `RoleDef ${ten} chưa seed (chạy prisma/seed-roles.ts)`).toBe(true);

    const k = await kb("doi05");
    const dangNhap = async (ten: keyof typeof VAI) => {
      const v = VAI[ten];
      const email = `fx-doi05-${ten.toLowerCase()}-${Date.now().toString(36)}@ci.test`;
      const u = await seedUser({ email, role: v.role as never, name: `fx-doi05-${ten}`, phone: null });
      await ganVai(u.id, (await db.orgUnit.findFirstOrThrow({ where: { code: v.don, deletedAt: null }, select: { id: true } })).id, ten);
      SESS.current = { user: { id: u.id, role: v.role, roles: [v.role], centerId: null, name: `fx-doi05-${ten}`, email } };
    };

    for (const ten of Object.keys(VAI) as (keyof typeof VAI)[]) {
      await dangNhap(ten);
      const { hold: h, kyId } = await dungHold(k, "PENDING_REGULATION");
      const thanh = await doiHangChoSangKySauAction({ holdId: h.id, lyDo: LY_DO });
      if ((DUOC as readonly string[]).includes(ten)) {
        expect(thanh, `${ten} phải dời được: ${JSON.stringify(thanh)}`).toMatchObject({ ok: true });
        expect((await hold(h.id)).blockingPeriodId, ten).not.toBe(kyId);
        expect(await soDefer(h.id), ten).toBe(1);
      } else {
        expect(thanh, ten).toMatchObject({ ok: false, ma: "KHONG_QUYEN" });
        expect((thanh as { loi: string }).loi, ten).toContain("commission_periods:manage");
        expect((await hold(h.id)).blockingPeriodId, ten).toBe(kyId);
        expect(await soDefer(h.id), ten).toBe(0);
        const la = await doiHangChoSangKySauAction({ holdId: "khong-ton-tai-doi05", lyDo: LY_DO });
        expect(la, `${ten}: id thật và id không tồn tại phải cho cùng kết quả`).toEqual(thanh);
      }
    }
    // chưa đăng nhập ⇒ chặn trước mọi thứ
    SESS.current = null;
    expect(await doiHangChoSangKySauAction({ holdId: "x", lyDo: LY_DO })).toMatchObject({ ok: false, ma: "CHUA_DANG_NHAP" });
    // đầu vào rác (sau khi qua quyền) ⇒ DAU_VAO_SAI, không chạm DB
    await dangNhap("SUPER_ADMIN");
    expect(await doiHangChoSangKySauAction({ holdId: "", lyDo: LY_DO })).toMatchObject({ ok: false, ma: "DAU_VAO_SAI" });
  });
});
