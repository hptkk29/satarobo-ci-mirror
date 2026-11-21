// @vitest-environment node
/**
 * [GTK-D*] — GIẢI THÍCH «VÌ SAO 0đ» (Hướng G): khoản thu ĐẦU TIÊN của lần mua NGOÀI cửa sổ ghi công. Postgres THẬT; nguồn ghi bằng đường nhập thật, dòng tiền bằng hàm ghi thật.
 *
 * Yêu cầu chủ dự án: sau cửa sổ, nguồn VẪN là nguồn cũ nhưng hoa hồng thu hút = không đủ điều kiện. Ledger/giải thích phải hiện:
 *   Nguồn · Chính sách và tỉ lệ · Điều kiện «Không đủ điều kiện» · Lý do ATTRIBUTION_WINDOW_EXPIRED · Hoa hồng 0. Sổ KHÔNG nhận dòng 0đ (CHECK `amount <> 0`), hàng chờ KHÔNG bị thêm việc.
 *
 *   [GTK-D1] ngoài cửa sổ ⇒ ô tính (0 dòng sổ) + 0 hàng chờ + ĐÚNG MỘT dòng giải thích đủ cột; nguồn giữ nguyên; vai khác (Sale) vẫn nhận tiền thật
 *   [GTK-D2] quét lại ⇒ vẫn một dòng (cùng id); đổi cửa sổ chung SAU khi lead đã ghi nguồn ⇒ KHÔNG đổi dòng cũ, KHÔNG INPUT_DRIFT
 *   [GTK-D3] UPDATE / DELETE bằng SQL thô bị trigger chặn — bảng chỉ-thêm
 *   [GTK-D4] giải thích KHÔNG vào sổ / tổng: tổng tiền của khoản không đổi; CHECK `amount <> 0` của sổ còn nguyên (lý do không ghi dòng 0đ)
 *   [GTK-D5] phạm vi người xem: chủ nguồn (view-self) chỉ dòng của mình; QLCS chỉ cơ sở mình; HO tất cả — KÈM đối chứng dương; không quyền ⇒ đóng cửa; id ngoài tầm ⇒ null
 *   [GTK-D6] ô cũ chưa có giải thích ⇒ lượt quét sau TỰ CHỮA; đang có INPUT_DRIFT chờ duyệt ⇒ KHÔNG ghi
 *   [GTK-D6d] từng cổng của `ghiGiaiThich` (drift · hash chưa duyệt · điều chỉnh chép · đã có tiền ròng · đã có dòng) chặn ĐÚNG phần của nó, kèm đối chứng dương
 *   [GTK-D7] hoàn tiền một khoản như vậy: quét khoản hoàn VÀ quét lại khoản gốc không lỗi, không sinh giải thích mới
 *   [GTK-D8] đổi nguồn làm vai thành SINH_DONG — qua LUỒNG THẬT (lập đề xuất → duyệt hai cấp bởi người khác nhau): giải thích cũ còn nguyên (chỉ-thêm) nhưng nói «đã được thay thế»
 *   [GTK-D8b] đổi nguồn KHÔNG đổi tiền trên ô cũ chưa có giải thích ⇒ lượt xử lý đổi nguồn tự chữa MỘT dòng (đường soVoiOThu của chế độ lập đề xuất)
 *
 * Chạy: `pnpm test:hoa-hong-db`. LUẬT 18: mỗi ca tự dựng, chạy ĐƯỢC MỘT MÌNH. LUẬT 19: ngày tuyệt đối.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 240_000 });

import { db } from "../../lib/db";
import { PermissionError } from "../../lib/auth/can";
import { docSoHoaHong } from "../../lib/hoa-hong/doc-so";
import { apDungDoiNguonSauThu } from "../../lib/hoa-hong/doi-nguon-sau-thu";
import { duyetDeXuat } from "../../lib/hoa-hong/duyet-de-xuat";
import { docGiaiThichKhongTien, docGiaiThichTheoId } from "../../lib/hoa-hong/giai-thich-doc";
import { ghiGiaiThich } from "../../lib/hoa-hong/giai-thich-db";
import { khoaNguoi } from "../../lib/hoa-hong/khoa-so";
import { docKhoan } from "../../lib/hoa-hong/nap-khoan";
import { lapThu, quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { clearSettingsCache } from "../../lib/settings/service";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { actorCua, boiCanh, D, datMocCutover, dongSoCuaKhoan, donKichBan, donViHoiSo, dungBe, dungKichBan, ganVai, hoanTien, lamNhanVien, themChinhSachNhom, tienVe, type KichBan, type RuleFx } from "./_kich-ban";
import { ghiNguonQuaDuongThat } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[GTK-D] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
/** Lead quy nguồn 12/09/2026 (giờ VN) ⇒ hạn ghi công (cửa sổ 90 ngày) = 11/12/2026. */
const QUY_NGUON = new Date("2026-09-12T03:00:00.000Z");
const NGOAI_CUA_SO = D("2026-12-20"); // ngày thu đầu tiên: sau hạn 9 ngày
const cuaToi: KichBan[] = [];
let dem = 0;

async function kb(tien: string, rules: RuleFx[] = []) {
  const k = await dungKichBan(tien, { rules });
  cuaToi.push(k);
  return k;
}

async function taoNhom(hau: string, chuEmployeeId: string) {
  dem += 1;
  return db.leadSourceGroup.create({
    data: {
      code: `GTK_${hau}_${Date.now().toString(36)}${dem}`.toUpperCase(),
      name: `GTK nguồn ${hau}`,
      referrerRequirement: "NONE",
      sortOrder: 700 + dem,
      commissionEnabled: true,
      ownerEmployeeId: chuEmployeeId,
    },
    select: { id: true, code: true },
  });
}

async function nhanSu(k: KichBan, hau: string) {
  const u = await seedUser({ email: `${k.ma}-${hau}@ci.test`, role: "SALES_CSM", name: `${k.ma}-${hau}`, phone: null });
  return { userId: u.id, empId: await lamNhanVien(u.id, `${k.ma}-${hau}`) };
}

const chon = (groupId: string) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh: null });

/** Kịch bản chuẩn: nguồn có chủ A, chính sách SOURCE_OWNER 1% riêng của nguồn, lead quy nguồn 12/09, MỘT khoản 10tr thu ngày 20/12 (ngoài cửa sổ). */
async function canh(tien: string, p: { sale?: boolean; thu?: Date } = {}) {
  const k = await kb(tien, p.sale ? [{ vai: "SALE", rate: 0.04 }] : []);
  const A = await nhanSu(k, "a");
  const g = await taoNhom(tien, A.empId);
  await themChinhSachNhom(k, g.code, [{ vai: "SOURCE_OWNER", rate: 0.01 }]);
  await ghiNguonQuaDuongThat(k, { nguonChon: chon(g.id) }, QUY_NGUON);
  const bc = await boiCanh(k, NOW);
  const be = await dungBe(k, "a", { tongTien: 10_000_000 });
  const khoan = await tienVe(k, be, { soTien: 10_000_000, ngay: p.thu ?? NGOAI_CUA_SO });
  return { k, A, g, bc, be, khoan };
}

const dongGiaiThich = (calcSlotPaymentId: string) => db.commissionExplainLine.findMany({ where: { paymentId: calcSlotPaymentId }, orderBy: [{ roleCode: "asc" }, { beneficiaryKey: "asc" }] });

describe.skipIf(!RUN_DB_TESTS)("[GTK-D] giải thích khoản thu hút ngoài cửa sổ ghi công", () => {
  beforeAll(async () => {
    assertTestDb();
    await damBaoToChuc({ donVi: ["HO"], vai: ["HO_ACCOUNTANT"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await datMocCutover("2026-10");
  }, 480_000);

  beforeEach(async () => {
    await datCoNguon(CO_NGUON_DAY_DU);
  });

  afterAll(async () => {
    await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
    clearSettingsCache();
    await donKichBan(cuaToi);
    const nhom = (await db.leadSourceGroup.findMany({ where: { code: { startsWith: "GTK_" } }, select: { id: true } })).map((g) => g.id);
    await db.leadTouchpoint.deleteMany({ where: { claimedGroupId: { in: nhom } } });
    await db.leadAttribution.deleteMany({ where: { OR: [{ groupId: { in: nhom } }, { originalGroupId: { in: nhom } }] } });
    await db.leadSourceGroup.deleteMany({ where: { code: { startsWith: "GTK_" } } });
    await datMocCutover(null);
  }, 300_000);

  it("[GTK-D1] ngoài cửa sổ: ô tính có (0 dòng sổ), 0 hàng chờ, ĐÚNG MỘT dòng giải thích đủ cột; nguồn GIỮ NGUYÊN", async () => {
    const { k, A, g, bc, khoan } = await canh("d1");
    const r = await quetKhoan(db, bc, khoan);
    expect(r).toMatchObject({ loai: "DA_GHI", soDong: 0, tong: 0 });

    const o = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: khoan } });
    expect(o.originalLineCount).toBe(0);
    expect(await dongSoCuaKhoan(khoan)).toHaveLength(0); // sổ KHÔNG nhận dòng 0đ
    expect(await db.commissionHold.count({ where: { paymentId: khoan } })).toBe(0); // hàng chờ KHÔNG bị thêm việc

    const gt = await dongGiaiThich(khoan);
    expect(gt).toHaveLength(1);
    expect(gt[0]).toMatchObject({
      calcSlotId: o.id,
      paymentId: khoan,
      roleCode: "SOURCE_OWNER",
      reasonCode: "ATTRIBUTION_WINDOW_EXPIRED",
      beneficiaryKey: `USER:${A.userId}`,
      beneficiaryKind: "USER",
      beneficiaryUserId: A.userId,
      beneficiaryAffiliateId: null,
      beneficiaryName: `${k.ma}-a`,
      sourceGroupId: g.id,
      sourceGroupCode: g.code,
      transactionTypeCode: "NEW",
      versionNo: 1,
      calcKind: "PERCENT",
      wouldBeAmount: 100_000,
      netBase: 10_000_000,
      naturalPeriod: "2026-12",
      centerId: k.centerId,
      orgUnitId: k.ouId,
      inputHash: o.firstInputHash,
    });
    expect(Number(gt[0]!.rate)).toBe(0.01);
    expect(gt[0]!.documentNumber).toContain(k.ma);
    expect(gt[0]!.details).toMatchObject({ cuaSoNgay: 90, hanGhiCong: "2026-12-11", soNgayTre: 9 });
    expect(gt[0]!.beneficiaryRoleId).toBe(bc.idVai.get("SOURCE_OWNER"));

    // nguồn GIỮ NGUYÊN (báo cáo theo nguồn không đổi) — KHÔNG đổi sang UNKNOWN/OTHER
    const nguon = await db.lead.findUniqueOrThrow({ where: { id: k.lead!.id }, select: { attribution: { select: { group: { select: { code: true } } } } } });
    expect(nguon.attribution?.group.code).toBe(g.code);
  });

  it("[GTK-D1b] đối chứng: có thêm vai Sale 4% ⇒ Sale vẫn nhận 400.000đ, vai thu hút 0 dòng sổ + một dòng giải thích; khoản TRONG cửa sổ ⇒ có dòng sổ, KHÔNG giải thích", async () => {
    const x = await canh("d1b", { sale: true });
    await quetKhoan(db, x.bc, x.khoan);
    const sau = await dongSoCuaKhoan(x.khoan);
    expect(sau.map((d) => [d.roleCode, d.amount])).toEqual([["SALE", 400_000]]);
    expect((await dongGiaiThich(x.khoan)).map((d) => [d.roleCode, d.wouldBeAmount])).toEqual([["SOURCE_OWNER", 100_000]]);

    const trong = await tienVe(x.k, await dungBe(x.k, "trong", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-12-11") }); // ngày thứ 90: còn trong
    await quetKhoan(db, x.bc, trong);
    expect((await dongSoCuaKhoan(trong)).map((d) => [d.roleCode, d.amount]).sort()).toEqual([["SALE", 400_000], ["SOURCE_OWNER", 100_000]]);
    expect(await dongGiaiThich(trong)).toHaveLength(0);
  });

  it("[GTK-D2] quét lại ⇒ vẫn MỘT dòng cùng id; đổi cửa sổ chung SAU khi lead đã ghi nguồn ⇒ KHÔNG đổi dòng cũ, KHÔNG INPUT_DRIFT", async () => {
    const { k, g, bc, khoan } = await canh("d2");
    await quetKhoan(db, bc, khoan);
    const [truoc] = await dongGiaiThich(khoan);
    expect(await quetKhoan(db, bc, khoan)).toMatchObject({ loai: "KHONG_DOI" });
    expect(await quetKhoan(db, bc, khoan)).toMatchObject({ loai: "KHONG_DOI" });
    expect((await dongGiaiThich(khoan)).map((d) => d.id)).toEqual([truoc!.id]);

    // Setting chung 90 → 365 và cửa sổ riêng của nguồn → 365: lead ĐÃ có bản chụp cửa sổ (90) nên không trôi.
    await db.systemSetting.upsert({ where: { key: "nguon.cuaSoGhiCongNgay" }, update: { valueJson: 365 }, create: { key: "nguon.cuaSoGhiCongNgay", valueJson: 365 } });
    await db.leadSourceGroup.update({ where: { id: g.id }, data: { attributionWindowDays: 365 } });
    clearSettingsCache();
    try {
      const bc2 = await boiCanh(k, NOW);
      expect(await quetKhoan(db, bc2, khoan)).toMatchObject({ loai: "KHONG_DOI" });
      expect(await db.commissionHold.count({ where: { paymentId: khoan, code: "INPUT_DRIFT" } })).toBe(0);
      const sau = await dongGiaiThich(khoan);
      expect(sau.map((d) => d.id)).toEqual([truoc!.id]);
      expect(sau[0]).toMatchObject({ wouldBeAmount: 100_000, inputHash: truoc!.inputHash });
      expect(sau[0]!.details).toMatchObject({ cuaSoNgay: 90 }); // ảnh chụp lúc ghi, không đổi theo hôm nay
    } finally {
      await db.systemSetting.deleteMany({ where: { key: "nguon.cuaSoGhiCongNgay" } });
      clearSettingsCache();
    }
  });

  it("[GTK-D3] UPDATE / DELETE bằng SQL thô bị trigger chặn — bảng chỉ-thêm", async () => {
    const { bc, khoan } = await canh("d3");
    await quetKhoan(db, bc, khoan);
    const [d] = await dongGiaiThich(khoan);
    await expect(db.$executeRaw`UPDATE "CommissionExplainLine" SET "wouldBeAmount" = 1 WHERE "id" = ${d!.id}`).rejects.toThrow(/chỉ-thêm/);
    await expect(db.$executeRaw`UPDATE "CommissionExplainLine" SET "reasonCode" = 'X' WHERE "id" = ${d!.id}`).rejects.toThrow(/chỉ-thêm/);
    await expect(db.$executeRaw`DELETE FROM "CommissionExplainLine" WHERE "id" = ${d!.id}`).rejects.toThrow(/chỉ-thêm/);
    expect(await dongGiaiThich(khoan)).toMatchObject([{ id: d!.id, wouldBeAmount: 100_000, reasonCode: "ATTRIBUTION_WINDOW_EXPIRED" }]);
    // RLS bật (chỉ ENABLE, không FORCE) và trigger có mặt trong catalog — Prisma không đọc được cả hai nên đây là lưới duy nhất
    const [rls] = await db.$queryRaw<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'CommissionExplainLine'`;
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
    const [tg] = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM pg_trigger WHERE tgname = 'CommissionExplainLine_chi_them_bud' AND NOT tgisinternal`;
    expect(Number(tg!.n)).toBe(1);
  });

  it("[GTK-D4] giải thích KHÔNG vào sổ/tổng: tổng tiền của khoản không đổi; CHECK `amount <> 0` của sổ còn nguyên; CHECK người hưởng của bảng giải thích chặn dòng sai", async () => {
    const x = await canh("d4", { sale: true });
    await quetKhoan(db, x.bc, x.khoan);
    expect(await dongGiaiThich(x.khoan)).toHaveLength(1);
    expect((await db.commissionTransaction.aggregate({ where: { paymentId: x.khoan }, _sum: { amount: true }, _count: true }))._sum.amount).toBe(400_000); // chỉ Sale
    const ho = await donViHoiSo();
    const kt = await seedUser({ email: `${x.k.ma}-kt-ho@ci.test`, role: "ACCOUNTANT", name: `${x.k.ma}-kt-ho` });
    await ganVai(kt.id, ho, "HO_ACCOUNTANT");
    const so = await docSoHoaHong(db, await actorCua(kt.id), { nhomNguon: x.g.code, coTrang: 200 });
    expect(so.tongTien).toBe(400_000); // sổ đọc từ bảng sổ — dòng giải thích không cộng vào đâu
    expect(so.dong.map((d) => d.roleCode)).toEqual(["SALE"]);

    const [chk] = await db.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'CommissionTransaction_so_tien_chk'`;
    expect(chk!.def).toMatch(/amount.*<>\s*0/); // LÝ DO không ghi dòng 0đ vào sổ
    // người hưởng sai hình dạng (kind USER mà thiếu userId) bị CHẶN ở DB
    const [d] = await dongGiaiThich(x.khoan);
    await expect(
      db.$executeRaw`INSERT INTO "CommissionExplainLine" ("id","calcSlotId","paymentId","roleCode","beneficiaryRoleId","beneficiaryKey","beneficiaryKind","reasonCode","sourceGroupId","sourceGroupCode","transactionTypeCode","policyId","policyVersionId","versionNo","ruleId","documentNumber","calcKind","wouldBeAmount","netBase","naturalPeriod","details","inputHash","centerId","orgUnitId")
        VALUES ('chk-1', ${d!.calcSlotId}, ${x.khoan}, 'R', 'r', 'USER:x', 'USER', 'X', 's', 's', 'NEW', 'p', 'v', 1, 'r', 'd', 'PERCENT', 1, 1, '2026-12', '{}'::jsonb, 'h', ${x.k.centerId}, ${x.k.ouId})`,
    ).rejects.toThrow(/nguoi_huong_chk/);
  });

  it("[GTK-D5] phạm vi người xem: chủ nguồn (view-self) chỉ thấy dòng CỦA MÌNH; QLCS chỉ cơ sở mình; HO tất cả — KÈM đối chứng dương; không quyền ⇒ đóng cửa; id ngoài tầm ⇒ null", async () => {
    const a = await canh("d5a");
    const b = await canh("d5b");
    await quetKhoan(db, a.bc, a.khoan);
    await quetKhoan(db, b.bc, b.khoan);
    const [ga] = await dongGiaiThich(a.khoan);
    const [gb] = await dongGiaiThich(b.khoan);

    await ganVai(a.A.userId, a.k.ouId, "CENTER_SALES_CSM"); // chủ nguồn A: chỉ view-self
    await ganVai(b.A.userId, b.k.ouId, "CENTER_SALES_CSM");
    await ganVai(a.k.qlcs.id, a.k.ouId, "CENTER_MANAGER");
    const ho = await seedUser({ email: `${a.k.ma}-kt-ho@ci.test`, role: "ACCOUNTANT", name: `${a.k.ma}-kt-ho` });
    await ganVai(ho.id, await donViHoiSo(), "HO_ACCOUNTANT");

    const trongNhom = async (userId: string, nhom: string) => (await docGiaiThichKhongTien(db, await actorCua(userId), { nhomNguon: nhom, coTrang: 200 })).dong.map((d) => d.id);

    // chủ nguồn A: dòng của mình (ĐỐI CHỨNG DƯƠNG) và KHÔNG thấy dòng của chủ nguồn B
    expect(await trongNhom(a.A.userId, a.g.code)).toEqual([ga!.id]);
    expect(await trongNhom(a.A.userId, b.g.code)).toEqual([]);
    expect(await trongNhom(b.A.userId, b.g.code)).toEqual([gb!.id]);
    // lọc người khác bị ÉP về mình, không ném lỗi, không lộ
    expect((await docGiaiThichKhongTien(db, await actorCua(a.A.userId), { nguoiHuong: b.A.userId, nhomNguon: b.g.code })).dong).toEqual([]);
    // QLCS cơ sở A: thấy dòng của NGƯỜI KHÁC (chủ nguồn) trong cơ sở mình; KHÔNG thấy cơ sở B
    expect(await trongNhom(a.k.qlcs.id, a.g.code)).toEqual([ga!.id]);
    expect(await trongNhom(a.k.qlcs.id, b.g.code)).toEqual([]);
    // HO thấy CẢ HAI
    expect(await trongNhom(ho.id, a.g.code)).toEqual([ga!.id]);
    expect(await trongNhom(ho.id, b.g.code)).toEqual([gb!.id]);

    // đọc theo id: trong tầm ⇒ có; ngoài tầm ⇒ null (không lộ tồn tại)
    expect((await docGiaiThichTheoId(db, await actorCua(a.A.userId), ga!.id))?.id).toBe(ga!.id);
    expect(await docGiaiThichTheoId(db, await actorCua(a.A.userId), gb!.id)).toBeNull();
    expect(await docGiaiThichTheoId(db, await actorCua(a.k.qlcs.id), gb!.id)).toBeNull();
    expect((await docGiaiThichTheoId(db, await actorCua(ho.id), gb!.id))?.id).toBe(gb!.id);

    // không có cả hai key ⇒ đóng cửa
    const ph = await seedUser({ email: `${a.k.ma}-ph@ci.test`, role: "PARENT", name: `${a.k.ma}-ph` });
    await expect(docGiaiThichKhongTien(db, await actorCua(ph.id), {})).rejects.toThrow(PermissionError);
    // phân trang bị kẹp
    expect(await docGiaiThichKhongTien(db, await actorCua(ho.id), { coTrang: 100_000 })).toMatchObject({ coTrang: 200 });
  });

  it("[GTK-D6] ô CŨ chưa có giải thích ⇒ lượt quét sau TỰ CHỮA; đang có INPUT_DRIFT chờ duyệt ⇒ KHÔNG ghi", async () => {
    const { k, bc, khoan } = await canh("d6");
    await quetKhoan(db, bc, khoan);
    const o = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: khoan } });

    // (a) giả lập ô tạo TRƯỚC khi có tính năng: bảng rỗng (TRUNCATE không chạy trigger theo dòng). Quét kế tiếp tự chữa.
    await db.$executeRaw`TRUNCATE "CommissionExplainLine"`;
    expect(await dongGiaiThich(khoan)).toHaveLength(0);
    expect(await quetKhoan(db, bc, khoan)).toMatchObject({ loai: "KHONG_DOI" });
    const chua = await dongGiaiThich(khoan);
    expect(chua).toHaveLength(1);
    expect(chua[0]).toMatchObject({ calcSlotId: o.id, roleCode: "SOURCE_OWNER", wouldBeAmount: 100_000 });
    expect(await quetKhoan(db, bc, khoan)).toMatchObject({ loai: "KHONG_DOI" });
    expect(await dongGiaiThich(khoan)).toHaveLength(1); // chữa MỘT lần, không đẻ thêm

    // (b) đầu vào THẬT đổi (cửa sổ bản chụp 90 → 365 ⇒ vai thu hút nay TRONG cửa sổ) ⇒ ô đã có 0 dòng mà kỳ vọng +100.000đ ⇒ INPUT_DRIFT chờ duyệt.
    await db.$executeRaw`TRUNCATE "CommissionExplainLine"`;
    await db.$executeRaw`UPDATE "LeadAttribution" SET "signals" = jsonb_set("signals", '{nguon,cuaSoNgay}', '365') WHERE "leadId" = ${k.lead!.id}`;
    const r = await quetKhoan(db, bc, khoan);
    expect(r).toMatchObject({ loai: "TROI", lyDo: "LECH_TIEN" });
    expect(await db.commissionHold.count({ where: { paymentId: khoan, code: "INPUT_DRIFT", status: "OPEN" } })).toBe(1);
    expect(await dongGiaiThich(khoan)).toHaveLength(0); // đang chờ duyệt ⇒ KHÔNG ghi giải thích cho một hiện trạng chưa chốt
  });

  it("[GTK-D6c] INPUT_DRIFT bị «giữ nguyên» (DISMISSED) khi sổ đang TRẢ tiền cho vai thu hút ⇒ hash đã chấp nhận nhưng KHÔNG ghi «0đ» cho người đang có tiền", async () => {
    const { k, bc, khoan } = await canh("d6c", { thu: D("2026-12-01") }); // ngày thứ 80: TRONG cửa sổ ⇒ vai thu hút có dòng sổ thật
    await quetKhoan(db, bc, khoan);
    expect((await dongSoCuaKhoan(khoan)).map((d) => [d.roleCode, d.amount])).toEqual([["SOURCE_OWNER", 100_000]]);
    expect(await dongGiaiThich(khoan)).toHaveLength(0);

    // cửa sổ bản chụp co 90 → 30 ⇒ ngày 80 nay NGOÀI cửa sổ ⇒ kỳ vọng mất 100.000đ, sổ vẫn đang trả ⇒ INPUT_DRIFT chờ duyệt
    await db.$executeRaw`UPDATE "LeadAttribution" SET "signals" = jsonb_set("signals", '{nguon,cuaSoNgay}', '30') WHERE "leadId" = ${k.lead!.id}`;
    expect(await quetKhoan(db, bc, khoan)).toMatchObject({ loai: "TROI", lyDo: "LECH_TIEN" });
    expect(await dongGiaiThich(khoan)).toHaveLength(0); // đang chờ duyệt ⇒ chưa giải thích

    // người rà chọn «giữ nguyên»: hash đi vào `hashDaChapNhan` ⇒ lượt quét sau là KHONG_DOI — và đây là lúc cổng «đã có tiền ròng» phải cứu
    await db.commissionHold.updateMany({ where: { paymentId: khoan, code: "INPUT_DRIFT" }, data: { status: "DISMISSED" } });
    expect(await quetKhoan(db, bc, khoan)).toMatchObject({ loai: "KHONG_DOI" });
    expect((await dongSoCuaKhoan(khoan)).map((d) => [d.roleCode, d.amount])).toEqual([["SOURCE_OWNER", 100_000]]); // sổ vẫn trả
    expect(await dongGiaiThich(khoan)).toHaveLength(0); // KHÔNG có «0đ / không đủ điều kiện» mâu thuẫn với dòng sổ đang trả
  });

  it("[GTK-D6d] từng cổng của `ghiGiaiThich` chặn ĐÚNG phần của nó — có đối chứng dương cùng đầu vào, chỉ khác một cổng", async () => {
    // D6/D6c đi qua quét thật nhưng KHÔNG chạm riêng cổng «đang drift / hash chưa duyệt»: ở đó đầu vào đổi làm vai thu hút hết «treo», nên không còn gì để ghi dù cổng có hay không
    // (cấy thử: gỡ `y.coDrift || !y.hashDuocChapNhan` ⇒ cả bộ vẫn xanh). Ca này gọi thẳng hàm với CÙNG kế hoạch thu và đổi MỘT cổng mỗi lần.
    const { A, bc, khoan } = await canh("d6d");
    await quetKhoan(db, bc, khoan);
    const o = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: khoan } });
    await db.$executeRaw`TRUNCATE "CommissionExplainLine"`;
    const p = await docKhoan(db, khoan);
    const lap = await lapThu(db, bc, p!);
    if (lap.loai !== "TINH") throw new Error(`kỳ vọng kế hoạch TINH, được ${lap.loai}`);
    const ghi = (mau: Partial<Parameters<typeof ghiGiaiThich>[1]> & { chepTu?: unknown }) =>
      db.$transaction((tx) =>
        ghiGiaiThich(tx, { kh: { ...lap.kh, chepTu: mau.chepTu ?? lap.kh.chepTu }, bc, slotId: o.id, netBase: 10_000_000, hash: "h-d6d", hashDuocChapNhan: true, coDrift: false, rong: new Map(), ...mau }),
      );
    const dem = () => db.commissionExplainLine.count({ where: { paymentId: khoan } });

    expect(await ghi({ coDrift: true })).toBe(0); // đang INPUT_DRIFT chờ duyệt
    expect(await ghi({ hashDuocChapNhan: false })).toBe(0); // hash chưa ai chấp nhận
    expect(await ghi({ chepTu: { ghiChu: "điều chỉnh tăng chép từ ô gốc" } })).toBe(0); // không có «vai treo» của riêng khoản này
    expect(await ghi({ rong: new Map([[khoaNguoi("SOURCE_OWNER", "USER", A.userId), 100_000]]) })).toBe(0); // người này ĐANG có tiền ròng ⇒ không ghi «0đ»
    expect(await dem()).toBe(0);
    expect(await ghi({})).toBe(1); // ĐỐI CHỨNG DƯƠNG: cùng kế hoạch, mọi cổng mở ⇒ ghi
    expect(await ghi({})).toBe(0); // gọi lại: đã có dòng cho (ô × vai × người × lý do) ⇒ không ghi thêm
    expect(await dem()).toBe(1);
  });

  it("[GTK-D7] hoàn tiền một khoản như vậy: quét khoản hoàn VÀ quét lại khoản gốc không lỗi, KHÔNG sinh giải thích mới", async () => {
    const { k, bc, khoan } = await canh("d7", { sale: true });
    await quetKhoan(db, bc, khoan);
    const [truoc] = await dongGiaiThich(khoan);
    expect(truoc).toBeDefined();

    const hoan = await hoanTien(k, khoan, { soTien: 5_000_000, ngay: D("2026-12-25") });
    const bc2 = await boiCanh(k, NOW);
    await quetKhoan(db, bc2, hoan); // đảo phần của Sale; vai thu hút không có dòng để đảo
    // quét lại khoản GỐC: cơ sở còn lại đã giảm ⇒ hash mới ĐƯỢC chấp nhận (CHENH_BANG_0) — bản nháp "ghi theo hashMoi" sẽ đẻ dòng thứ hai ở đây
    const lai = await quetKhoan(db, bc2, khoan);
    expect(lai.loai).not.toBe("TROI");
    const sau = await dongGiaiThich(khoan);
    expect(sau.map((d) => d.id)).toEqual([truoc!.id]);
    expect(sau[0]).toMatchObject({ wouldBeAmount: 100_000, inputHash: truoc!.inputHash }); // ảnh chụp lúc ghi, không co theo khoản hoàn
    expect(await db.commissionExplainLine.count({ where: { paymentId: hoan } })).toBe(0); // khoản hoàn không có giải thích riêng
    expect(await db.commissionHold.count({ where: { paymentId: khoan, code: "INPUT_DRIFT" } })).toBe(0);
  });

  /** Người duyệt THẬT (Kế toán HO: giữ `commission_periods:manage`, KHÔNG phải chủ nguồn, KHÔNG phải người đổi nguồn). */
  async function nguoiDuyet(k: KichBan, hau: string) {
    const u = await seedUser({ email: `${k.ma}-duyet-${hau}@ci.test`, role: "ACCOUNTANT", name: `${k.ma}-duyet-${hau}` });
    await ganVai(u.id, await donViHoiSo(), "HO_ACCOUNTANT");
    return { userId: u.id, ten: `${k.ma}-duyet-${hau}`, quyen: await actorCua(u.id) };
  }

  it("[GTK-D8] đổi nguồn làm vai thu hút nay TRONG cửa sổ — ĐI QUA LUỒNG THẬT (lập đề xuất → hai cấp duyệt bởi hai người khác nhau): giải thích cũ NGUYÊN VẸN (chỉ-thêm), sổ không đổi trước khi duyệt, đọc ra «đã được thay thế» sau khi duyệt cấp hai", async () => {
    // Luật cũ (nguồn đổi ⇒ lượt quét TỰ ghi SOURCE_CORRECTION) đã bị hướng B+C ĐẢO: đổi nguồn chỉ LẬP ĐỀ XUẤT; dòng sổ chỉ sinh sau khi người khác duyệt đủ cấp.
    const KHOA_NGUONG = "hoaHong.nguongDuyetHaiCap";
    await db.systemSetting.upsert({ where: { key: KHOA_NGUONG }, update: { valueJson: 50_000 }, create: { key: KHOA_NGUONG, valueJson: 50_000 } }); // 100.000đ ≥ ngưỡng ⇒ BẮT BUỘC hai cấp
    clearSettingsCache();
    try {
      const { k, A, bc, khoan } = await canh("d8");
      await quetKhoan(db, bc, khoan);
      const xem = await nguoiDuyet(k, "xem");
      const [gt] = await dongGiaiThich(khoan);
      expect(gt).toBeDefined();
      expect(await docGiaiThichTheoId(db, xem.quyen, gt!.id)).toMatchObject({ daCoTien: false, wouldBeAmount: 100_000 }); // 0đ ngoài cửa sổ: «lẽ ra 100.000đ»
      expect(await dongSoCuaKhoan(khoan)).toHaveLength(0);
      const o = await db.commissionCalcSlot.findFirstOrThrow({ where: { paymentId: khoan } });

      // ── ĐỔI NGUỒN: cửa sổ bản chụp 90 → 365 ⇒ ngày thu nay TRONG cửa sổ; người đổi nguồn là một nhân viên riêng ──
      await db.$executeRaw`UPDATE "LeadAttribution" SET "signals" = jsonb_set("signals", '{nguon,cuaSoNgay}', '365') WHERE "leadId" = ${k.lead!.id}`;
      const nguoiDoi = await seedUser({ email: `${k.ma}-doi-nguon@ci.test`, role: "SALES_CSM", name: `${k.ma}-doi-nguon`, phone: null });
      const lap = await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: `ev-${k.ma}`, requestedById: nguoiDoi.id });
      expect(lap.theoKetQua).toEqual({ DE_XUAT: 1 });

      // ── TRƯỚC KHI DUYỆT: sổ KHÔNG đổi một đồng, giải thích đứng nguyên, đề xuất chờ hai cấp ──
      const dx = await db.commissionAdjustmentRequest.findFirstOrThrow({ where: { paymentId: khoan, origin: "SOURCE_CHANGE" } });
      expect(dx).toMatchObject({ status: "PENDING", governance: "SECOND_APPROVAL_REQUIRED", thresholdSnapshot: 50_000, absTotal: 100_000, requestedById: nguoiDoi.id });
      expect(await dongSoCuaKhoan(khoan)).toHaveLength(0);
      expect(await dongGiaiThich(khoan)).toEqual([gt]); // cùng id, cùng MỌI cột (kể cả createdAt) — lượt lập đề xuất không viết lại, không thêm dòng
      expect(await docGiaiThichTheoId(db, xem.quyen, gt!.id)).toMatchObject({ daCoTien: false });
      expect(await db.commissionHold.count({ where: { paymentId: khoan, code: "INPUT_DRIFT", status: "OPEN" } })).toBe(1);

      // ── CẤP 1 ──
      const duyet1 = await nguoiDuyet(k, "cap1");
      expect(await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: duyet1, lyDo: "Cấp 1 đã đối chiếu nguồn mới" })).toMatchObject({ loai: "DA_DUYET_CAP_1" });
      expect(await dongSoCuaKhoan(khoan)).toHaveLength(0); // cấp 1 chưa ghi sổ
      expect(await dongGiaiThich(khoan)).toEqual([gt]);
      expect(await docGiaiThichTheoId(db, xem.quyen, gt!.id)).toMatchObject({ daCoTien: false });
      // tách nhiệm: người cấp 1, người ĐỔI NGUỒN và người HƯỞNG (chủ nguồn) đều KHÔNG duyệt được cấp hai — kể cả khi giữ khoá quyền
      await ganVai(nguoiDoi.id, await donViHoiSo(), "HO_ACCOUNTANT");
      await ganVai(A.userId, await donViHoiSo(), "HO_ACCOUNTANT");
      const cam = [
        { nguoi: duyet1, lyDo: "Cấp 1 tự duyệt tiếp cấp 2 của mình" },
        { nguoi: { userId: nguoiDoi.id, ten: "Người đổi nguồn", quyen: await actorCua(nguoiDoi.id) }, lyDo: "Người đổi nguồn tự duyệt cấp hai" },
        { nguoi: { userId: A.userId, ten: "Chủ nguồn", quyen: await actorCua(A.userId) }, lyDo: "Người hưởng tự duyệt cấp hai" },
      ];
      for (const c of cam) await expect(duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: c.nguoi, lyDo: c.lyDo })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
      expect(await dongSoCuaKhoan(khoan)).toHaveLength(0);

      // ── CẤP 2 (người khác tất cả) ⇒ GHI SỔ ──
      const duyet2 = await nguoiDuyet(k, "cap2");
      expect(await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: duyet2, lyDo: "Cấp 2 đồng ý ghi điều chỉnh vào sổ" })).toMatchObject({ loai: "DA_GHI", cap: 2, tong: 100_000 });
      expect(await db.commissionAdjustmentRequest.findUniqueOrThrow({ where: { id: dx.id } })).toMatchObject({ status: "POSTED", approver1Id: duyet1.userId, approver2Id: duyet2.userId });
      expect((await dongSoCuaKhoan(khoan)).map((d) => [d.roleCode, d.entryKind, d.amount])).toEqual([["SOURCE_OWNER", "SOURCE_CORRECTION", 100_000]]);
      expect((await db.commissionTransaction.aggregate({ where: { paymentId: khoan }, _sum: { amount: true } }))._sum.amount).toBe(100_000); // tổng = ĐÚNG dòng điều chỉnh

      // ── SAU KHI DUYỆT: dòng giải thích KHÔNG bị sửa/xoá/nhân đôi — chỉ đọc ra «đã được thay thế» (daCoTien) ──
      expect(await dongGiaiThich(khoan)).toEqual([gt]);
      expect(await docGiaiThichTheoId(db, xem.quyen, gt!.id)).toMatchObject({ id: gt!.id, daCoTien: true, wouldBeAmount: 100_000 });
      expect(await quetKhoan(db, bc, khoan)).toMatchObject({ loai: "KHONG_DOI" }); // quét lại: không ghi thêm dòng sổ, không thêm giải thích
      expect(await dongGiaiThich(khoan)).toEqual([gt]);
      expect((await db.commissionCalcSlot.findUniqueOrThrow({ where: { id: o.id } })).originalLineCount).toBe(0); // ô gốc không bị viết lại
      expect(await db.commissionHold.count({ where: { paymentId: khoan, status: "OPEN" } })).toBe(0);
    } finally {
      await db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } });
      clearSettingsCache();
    }
  });

  it("[GTK-D8b] đổi nguồn KHÔNG đổi tiền (vẫn ngoài cửa sổ) trên ô CŨ chưa có giải thích ⇒ lượt xử lý đổi nguồn TỰ CHỮA đúng MỘT dòng, không đề xuất, không dòng sổ", async () => {
    // Đây là đường `soVoiOThu` do ĐỔI NGUỒN gọi (chế độ lập đề xuất): D6 chỉ phủ chế độ QUÉT thường. Không có đề xuất nào mở hàng chờ ⇒ cổng `coDrift` mở.
    const { k, bc, khoan } = await canh("d8b");
    await quetKhoan(db, bc, khoan);
    await db.$executeRaw`TRUNCATE "CommissionExplainLine"`; // giả lập ô tạo TRƯỚC khi có tính năng
    expect(await dongGiaiThich(khoan)).toHaveLength(0);
    await db.$executeRaw`UPDATE "LeadAttribution" SET "signals" = jsonb_set("signals", '{nguon,cuaSoNgay}', '60') WHERE "leadId" = ${k.lead!.id}`; // co cửa sổ 90 → 60: vẫn NGOÀI
    const nguoiDoi = await seedUser({ email: `${k.ma}-doi-nguon@ci.test`, role: "SALES_CSM", name: `${k.ma}-doi-nguon`, phone: null });
    const lap = await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: `ev-${k.ma}`, requestedById: nguoiDoi.id });
    expect(lap.theoKetQua).toEqual({ KHONG_DOI: 1 });
    expect(await db.commissionAdjustmentRequest.count({ where: { paymentId: khoan } })).toBe(0);
    expect(await dongSoCuaKhoan(khoan)).toHaveLength(0);
    const gt = await dongGiaiThich(khoan);
    expect(gt).toHaveLength(1);
    expect(gt[0]).toMatchObject({ roleCode: "SOURCE_OWNER", reasonCode: "ATTRIBUTION_WINDOW_EXPIRED", wouldBeAmount: 100_000 });
    expect(gt[0]!.details).toMatchObject({ cuaSoNgay: 60 }); // theo đầu vào HIỆN TẠI của lượt xử lý
    await apDungDoiNguonSauThu(db, bc, { leadId: k.lead!.id, refEventId: `ev-${k.ma}`, requestedById: nguoiDoi.id }); // chạy lại: vẫn một dòng
    expect((await dongGiaiThich(khoan)).map((d) => d.id)).toEqual([gt[0]!.id]);
  });
});
