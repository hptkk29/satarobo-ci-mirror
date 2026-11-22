// @vitest-environment node
/**
 * [GHH-*] — GỘP LEAD đổi nguồn/người hưởng của lead ĐÃ THU TIỀN phải đi CÙNG luồng với đổi nguồn thường (08 §17.v6.nguon), trên Postgres THẬT.
 *
 * Lỗ (rà vòng 5, góc bảo mật): `gopLead` → `gopNguonLead` → `doiNguonKhiGop` đổi `LeadAttribution` của lead chính SAU khi đã thu tiền mà KHÔNG phát
 * `nguon.da-doi-sau-thanh-toan` như `doiNguonLead`. Cổng chặn "Áp dụng" ở `giaiHangCho` chỉ nhìn DomainEvent ⇒ không thấy ⇒ lượt quét sinh INPUT_DRIFT mang phần chênh do
 * nguồn và MỘT Kế toán "Áp dụng" ghi thẳng sổ (không ngưỡng, không cấp hai, không kiểm người hưởng ≠ người bấm).
 *
 *   [GHH-01] PROBE gốc: lead chính PAID_ADS thu 10tr đã quét; lead phụ cùng SĐT có quy nguồn PARENT_REFERRAL sớm hơn; gộp thật ⇒ MỘT sự kiện (cùng khoá/payload với đổi nguồn thường);
 *            quét lại ra INPUT_DRIFT mà "Áp dụng" bị từ chối HANG_CHO_DOI_NGUON_CHUA_QUA_DUYET (sổ không đổi); consumer lập đề xuất PENDING; duyệt ⇒ SOURCE_CORRECTION về ĐÚNG phụ huynh
 *   [GHH-02] gộp CHẠY THỬ (apply:false) ⇒ 0 sự kiện, nguồn lead chính nguyên (rollback cuốn theo cả sự kiện)
 *   [GHH-03] ĐỐI CHỨNG ÂM: lead chính CHƯA có khoản thu thực ⇒ đổi nguồn do gộp KHÔNG phát sự kiện
 *   [GHH-04] lead chính THẮNG first-claim nhưng lead phụ mang theo khoản thu ⇒ phát sự kiện (khoản thu dời sang chính, nay đo theo nguồn của chính); phụ KHÔNG có tiền ⇒ không phát
 *   [GHH-05] chỉ phụ có quy nguồn (dời sang chính, `DOI_DONG_PHU`) mà chính đã có tiền ⇒ phát sự kiện, `tuNhom = null`
 *   [GHH-06] không có người đề xuất (script không có User) mà khoản thu thực bị đổi cách tính ⇒ NÉM, không gộp gì (cả chạy thử); không đụng tiền đã thu thì null vẫn gộp được
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { apDungDoiNguonSauThu } from "../../lib/hoa-hong/doi-nguon-sau-thu";
import { duyetDeXuat } from "../../lib/hoa-hong/duyet-de-xuat";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { gopLead } from "../../lib/lead/gop-lead";
import { damBaoDanhMucGoc } from "../lead-intake/_nguon-fixture";
import { boiCanh, D, datMocCutover, donKichBan, dungBe, dungKichBan, ganNguon, nguoiKyHo, themChinhSachNhom, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[GHH] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const SU_KIEN = "nguon.da-doi-sau-thanh-toan";

describe.skipIf(!RUN_DB_TESTS)("[GHH] gộp lead đổi nguồn sau khi thu tiền ⇒ sự kiện đổi nguồn sau thu", () => {
  const cuaToi: KichBan[] = [];
  let NGUOI: Awaited<ReturnType<typeof nguoiKyHo>>;

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    NGUOI = await nguoiKyHo();
  }, 120_000);
  afterAll(async () => {
    await db.$executeRaw`TRUNCATE "CommissionAdjustmentRequest", "CommissionDispute"`;
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  /** Lead PHỤ cùng SĐT với lead chính của kịch bản (gộp đòi cùng khoá SĐT), có hay không có quy nguồn. */
  async function leadPhu(k: KichBan, hau: string, nguon: { nhom: string; phHuynhUserId: string; attributedAt: Date } | null): Promise<KichBan> {
    const lead = await db.lead.create({
      data: { parentName: `${k.ma}-${hau}`, phone: k.lead!.phone, status: "DA_DANG_KY", convertedById: k.sale.id, adminId: k.saleAdmin.id, centerId: k.centerId },
    });
    const kp = { ...k, lead };
    if (nguon) await ganNguon(kp, nguon.nhom, { phHuynhUserId: nguon.phHuynhUserId, attributedAt: nguon.attributedAt });
    return kp;
  }

  const suKienCua = (leadId: string) => db.domainEvent.findMany({ where: { type: SU_KIEN, payloadJson: { path: ["leadId"], equals: leadId } }, orderBy: { createdAt: "asc" } });
  const demDieuChinh = (paymentId: string) => db.commissionTransaction.count({ where: { entryKind: { in: ["INPUT_CORRECTION", "SOURCE_CORRECTION", "DISPUTE_ADJUSTMENT"] }, calcSlot: { paymentId } } });

  /** Lead chính PAID_ADS (+ tuỳ chọn khoản thu 10tr ĐÃ QUÉT) và phụ huynh giới thiệu. */
  async function dung(ten: string, p: { coTien: boolean }) {
    const k = await dungKichBan(ten, { rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.01 }]);
    await damBaoDanhMucGoc(db);
    await ganNguon(k, "PAID_ADS", { attributedAt: D("2026-10-01") });
    const bc = await boiCanh(k, NOW);
    let goc: string | null = null;
    if (p.coTien) {
      goc = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
      await quetKhoan(db, bc, goc);
    }
    const nguoiGop = await seedUser({ email: `${k.ma}-gop@ci.test`, role: "SALES_CSM", name: `${k.ma}-gop`, phone: null });
    return { k, ph, bc, goc, nguoiGop: nguoiGop.id };
  }
  const gop = (x: { k: KichBan }, phu: KichBan, o: { apply: boolean; actorUserId: string | null }) =>
    gopLead(db, { phuId: phu.lead!.id, chinhId: x.k.lead!.id, apply: o.apply, actorName: "Hệ thống (gộp lead)", actorUserId: o.actorUserId });

  it("[GHH-01] PROBE gốc: gộp làm ĐỔI nguồn của lead đã thu tiền ⇒ phát sự kiện ⇒ 'Áp dụng' INPUT_DRIFT bị chặn, đề xuất chờ duyệt, duyệt đủ cấp mới về đúng phụ huynh", async () => {
    // Cấy: gỡ lời phát sự kiện ở đường gộp ⇒ 0 sự kiện, 'Áp dụng' ghi thẳng sổ (DA_AP_DUNG) ⇒ đỏ.
    const x = await dung("ghh01", { coTien: true });
    const phu = await leadPhu(x.k, "phu", { nhom: "PARENT_REFERRAL", phHuynhUserId: x.ph.id, attributedAt: D("2026-09-01") });
    const kq = await gop(x, phu, { apply: true, actorUserId: x.nguoiGop });
    expect(kq.nguon.cach).toBe("PHU_THANG");

    const evs = await suKienCua(x.k.lead!.id);
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ status: "PENDING", dedupeKey: `${SU_KIEN}:${x.k.lead!.id}:gop:${phu.lead!.id}` });
    expect(evs[0]!.payloadJson).toMatchObject({
      leadId: x.k.lead!.id,
      tuNhom: "PAID_ADS",
      denNhom: "PARENT_REFERRAL",
      denNguoi: { kind: "PARENT", parentUserId: x.ph.id },
      actorId: x.nguoiGop,
      canDieuChinh: true,
    });

    // Quét lại: nguồn đã đổi ⇒ lệch đầu vào ⇒ hàng chờ INPUT_DRIFT mang phần chênh do nguồn.
    expect(await quetKhoan(db, x.bc, x.goc!)).toMatchObject({ loai: "TROI" });
    const hang = await db.commissionHold.findFirstOrThrow({ where: { paymentId: x.goc!, code: "INPUT_DRIFT", status: "OPEN" } });
    await expect(giaiHangCho(db, x.bc, { holdId: hang.id, quyetDinh: "AP_DUNG", lyDo: "Một người áp dụng chênh lệch do gộp lead", nguoi: NGUOI })).rejects.toMatchObject({
      ma: "HANG_CHO_DOI_NGUON_CHUA_QUA_DUYET",
    });
    expect(await demDieuChinh(x.goc!)).toBe(0);

    // Consumer của sự kiện lập ĐỀ XUẤT chờ duyệt (không ghi sổ), rồi duyệt ⇒ SOURCE_CORRECTION về ĐÚNG phụ huynh.
    expect((await apDungDoiNguonSauThu(db, x.bc, { leadId: x.k.lead!.id, refEventId: evs[0]!.id, requestedById: x.nguoiGop })).theoKetQua).toEqual({ DE_XUAT: 1 });
    const dx = await db.commissionAdjustmentRequest.findFirstOrThrow({ where: { paymentId: x.goc!, origin: "SOURCE_CHANGE" } });
    expect(dx.status).toBe("PENDING");
    expect(await demDieuChinh(x.goc!)).toBe(0);
    expect(await duyetDeXuat(db, x.bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: NGUOI, lyDo: "Duyệt đề xuất đổi nguồn do gộp lead" })).toMatchObject({ loai: "DA_GHI" });
    const dongSo = await db.commissionTransaction.findMany({ where: { entryKind: "SOURCE_CORRECTION", calcSlot: { paymentId: x.goc! } }, select: { roleCode: true, beneficiaryUserId: true, amount: true } });
    expect(dongSo.some((d) => d.roleCode === "REFERRER_PARENT" && d.beneficiaryUserId === x.ph.id && Number(d.amount) === 100_000)).toBe(true);
  });

  it("[GHH-02] gộp CHẠY THỬ ⇒ 0 sự kiện, nguồn lead chính nguyên", async () => {
    const x = await dung("ghh02", { coTien: true });
    const phu = await leadPhu(x.k, "phu", { nhom: "PARENT_REFERRAL", phHuynhUserId: x.ph.id, attributedAt: D("2026-09-01") });
    const kq = await gop(x, phu, { apply: false, actorUserId: x.nguoiGop });
    expect(kq).toMatchObject({ daGhi: false, nguon: { cach: "PHU_THANG" } });
    expect(await suKienCua(x.k.lead!.id)).toHaveLength(0);
    const nguon = await db.leadAttribution.findUniqueOrThrow({ where: { leadId: x.k.lead!.id }, include: { group: { select: { code: true } } } });
    expect(nguon.group.code).toBe("PAID_ADS");
    expect((await db.lead.findUniqueOrThrow({ where: { id: phu.lead!.id } })).deletedAt).toBeNull();
  });

  it("[GHH-03] ĐỐI CHỨNG ÂM: lead chính CHƯA có khoản thu thực ⇒ đổi nguồn do gộp KHÔNG phát sự kiện — nhưng nguồn VẪN đổi (đối chứng dương)", async () => {
    const x = await dung("ghh03", { coTien: false });
    const phu = await leadPhu(x.k, "phu", { nhom: "PARENT_REFERRAL", phHuynhUserId: x.ph.id, attributedAt: D("2026-09-01") });
    const kq = await gop(x, phu, { apply: true, actorUserId: x.nguoiGop });
    expect(kq.nguon.cach).toBe("PHU_THANG");
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: x.k.lead!.id }, include: { group: { select: { code: true } } } })).group.code).toBe("PARENT_REFERRAL");
    expect(await suKienCua(x.k.lead!.id)).toHaveLength(0);
  });

  it("[GHH-04] lead chính THẮNG first-claim nhưng lead phụ MANG THEO khoản thu ⇒ phát sự kiện; phụ KHÔNG có tiền ⇒ không phát", async () => {
    // Cấy: bỏ `phuCoTienThuc` khỏi điều kiện phát ⇒ ca có tiền của phụ không phát ⇒ đỏ.
    const x = await dung("ghh04", { coTien: true });
    const ph2 = await seedUser({ email: `${x.k.ma}-ph2@ci.test`, role: "PARENT", name: `${x.k.ma}-ph2`, phone: null });
    // chính attributedAt 2026-10-01 SỚM hơn phụ 2026-10-05 ⇒ chính thắng
    const phuKhongTien = await leadPhu(x.k, "p0", { nhom: "PARENT_REFERRAL", phHuynhUserId: ph2.id, attributedAt: D("2026-10-05") });
    expect((await gop(x, phuKhongTien, { apply: true, actorUserId: x.nguoiGop })).nguon.cach).toBe("CHINH_GIU");
    expect(await suKienCua(x.k.lead!.id)).toHaveLength(0);

    const phuCoTien = await leadPhu(x.k, "p1", { nhom: "PARENT_REFERRAL", phHuynhUserId: ph2.id, attributedAt: D("2026-10-06") });
    await tienVe(phuCoTien, await dungBe(phuCoTien, "b", { tongTien: 5_000_000 }), { soTien: 5_000_000, ngay: D("2026-10-13") });
    expect((await gop(x, phuCoTien, { apply: true, actorUserId: x.nguoiGop })).nguon.cach).toBe("CHINH_GIU");
    const evs = await suKienCua(x.k.lead!.id);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.dedupeKey).toBe(`${SU_KIEN}:${x.k.lead!.id}:gop:${phuCoTien.lead!.id}`);
  });

  it("[GHH-05] chỉ PHỤ có quy nguồn (dời sang chính) mà chính đã có tiền ⇒ phát sự kiện, tuNhom = null", async () => {
    const k = await dungKichBan("ghh05", { rules: [{ vai: "SALE", rate: 0.04 }] });
    cuaToi.push(k);
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await damBaoDanhMucGoc(db);
    await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const nguoiGop = await seedUser({ email: `${k.ma}-gop@ci.test`, role: "SALES_CSM", name: `${k.ma}-gop`, phone: null });
    const phu = await leadPhu(k, "phu", { nhom: "PARENT_REFERRAL", phHuynhUserId: ph.id, attributedAt: D("2026-09-01") });
    expect(await db.leadAttribution.count({ where: { leadId: k.lead!.id } })).toBe(0);
    const kq = await gop({ k }, phu, { apply: true, actorUserId: nguoiGop.id });
    expect(kq.nguon.cach).toBe("DOI_DONG_PHU");
    const evs = await suKienCua(k.lead!.id);
    expect(evs).toHaveLength(1);
    expect(evs[0]!.payloadJson).toMatchObject({ tuNhom: null, denNhom: "PARENT_REFERRAL", actorId: nguoiGop.id });
  });

  it("[GHH-06] khoản thu thực bị đổi cách tính mà KHÔNG có người đề xuất ⇒ NÉM, không gộp gì (cả chạy thử); đối chứng: không đụng tiền đã thu thì null vẫn gộp được", async () => {
    // Cấy: bỏ `throw` ở `baoDoiNguonKhiGop` khi `actorId === null` ⇒ gộp thành công với sự kiện actorId null (FAILED mãi, giữ cổng, không đường thoát) ⇒ đỏ.
    const x = await dung("ghh06", { coTien: true });
    const phu = await leadPhu(x.k, "phu", { nhom: "PARENT_REFERRAL", phHuynhUserId: x.ph.id, attributedAt: D("2026-09-01") });
    for (const apply of [false, true]) {
      await expect(gop(x, phu, { apply, actorUserId: null }), `apply=${apply}`).rejects.toThrow(/nguoi_de_xuat/);
    }
    // cả lượt lùi: không sự kiện, nguồn chính nguyên, lead phụ còn sống
    expect(await suKienCua(x.k.lead!.id)).toHaveLength(0);
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: x.k.lead!.id }, include: { group: { select: { code: true } } } })).group.code).toBe("PAID_ADS");
    expect((await db.lead.findUniqueOrThrow({ where: { id: phu.lead!.id } })).deletedAt).toBeNull();
    // đối chứng dương: cùng cặp lead, CÓ người đề xuất ⇒ gộp được và phát đúng một sự kiện
    expect((await gop(x, phu, { apply: true, actorUserId: x.nguoiGop })).nguon.cach).toBe("PHU_THANG");
    expect(await suKienCua(x.k.lead!.id)).toHaveLength(1);

    // null chỉ được phép khi lượt gộp không đổi tiền của khoản đã thu: lead chính CHƯA có thu thực
    const y = await dung("ghh06b", { coTien: false });
    const phuY = await leadPhu(y.k, "phu", { nhom: "PARENT_REFERRAL", phHuynhUserId: y.ph.id, attributedAt: D("2026-09-01") });
    expect((await gop(y, phuY, { apply: true, actorUserId: null })).nguon.cach).toBe("PHU_THANG");
    expect(await suKienCua(y.k.lead!.id)).toHaveLength(0);
  });
});
