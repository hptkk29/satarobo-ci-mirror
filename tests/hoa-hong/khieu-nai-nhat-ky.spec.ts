// @vitest-environment node
/**
 * [NHH-DSP-NK*] — NHẬT KÝ của tab Khiếu nại & lịch sử (ba tab con: Đổi nguồn · Lịch sử chính sách · Nhật ký), trên Postgres THẬT.
 *
 * AuditLog không nằm trong `scopedDb`; cách ly duy nhất là cột `orgUnitId`. Mỗi ca có ĐỐI CHỨNG DƯƠNG (CLAUDE.md luật 11): ca "không thấy dòng của cơ sở khác"
 * đi kèm "thấy dòng của cơ sở mình" và "HR Hội sở thấy cả hai".
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`. Dòng audit của ca mang `entityId` đuôi 6 ký tự riêng (mã ngắn in ra màn) để nhận ra giữa các dòng của bộ test khác;
 * AuditLog không bất biến ở tầng DB nên dọn bằng xoá theo `entityId` của ca. Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { docNhatKy, dungThayDoi } from "../../lib/hoa-hong/nhat-ky-doc";
import { actorCua, donKichBan, donViHoiSo, dungKichBan, ganVai, nguoiKyQlcs, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-DSP-NK] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const cuaToi: KichBan[] = [];
const idsDon: string[] = [];

async function ghi(o: { entityType: string; action: string; orgUnitId: string | null; module?: string; dau: string; reason?: string; oldValues?: object; newValues?: object }) {
  const entityId = `nk-${Date.now().toString(36)}-${o.dau}`;
  const r = await db.auditLog.create({
    data: {
      actorName: "Người làm nk",
      module: o.module ?? "hoa-hong",
      entityType: o.entityType,
      entityId,
      action: o.action,
      orgUnitId: o.orgUnitId,
      reason: o.reason ?? null,
      oldValues: o.oldValues,
      newValues: o.newValues,
      changedFields: Object.keys(o.newValues ?? {}),
    },
  });
  idsDon.push(r.id);
  return r.entityId.slice(-6).toUpperCase();
}
const maCua = async (actor: Awaited<ReturnType<typeof actorCua>>, kenh: Parameters<typeof docNhatKy>[2]) => new Set((await docNhatKy(db, actor, kenh, { coTrang: 100 })).muc.map((m) => m.maDoiTuong));

describe.skipIf(!RUN_DB_TESTS)("[NHH-DSP-NK] nhật ký các tab con", () => {
  let a: KichBan;
  let b: KichBan;
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    a = await dungKichBan("dspnka");
    b = await dungKichBan("dspnkb");
    cuaToi.push(a, b);
  }, 120_000);
  afterAll(async () => {
    await db.auditLog.deleteMany({ where: { id: { in: idsDon } } });
    await donKichBan(cuaToi);
  }, 60_000);

  async function hr(ten: string, orgUnitId?: string) {
    const u = await seedUser({ email: `${ten}-${Date.now().toString(36)}@ci.test`, role: "HR", name: ten, phone: null });
    await ganVai(u.id, orgUnitId ?? (await donViHoiSo()), "HO_HR");
    return actorCua(u.id);
  }

  it("[NHH-DSP-NK1] Đổi nguồn: chỉ hành động đổi nguồn của Lead, trong tầm nhìn Lead của người xem; HR cơ sở A không thấy dòng của cơ sở B; HR Hội sở thấy cả hai", async () => {
    const mA = await ghi({ entityType: "Lead", action: "DOI_NGUON", orgUnitId: a.ouId, dau: "LDA001", reason: "Phụ huynh xác nhận người giới thiệu", oldValues: { nhom: "PAID_ADS" }, newValues: { nhom: "PARENT_REFERRAL" } });
    const mB = await ghi({ entityType: "Lead", action: "DOI_NGUON_SAU_THU", orgUnitId: b.ouId, dau: "LDB001" });
    const khac = await ghi({ entityType: "Lead", action: "UPDATE", orgUnitId: a.ouId, dau: "LDA002" }); // không phải hành động nguồn
    const lai = await ghi({ entityType: "Order", action: "DOI_NGUON", orgUnitId: a.ouId, dau: "ODA001" }); // không phải Lead

    const hrA = await hr("nk1a", a.ouId);
    const hrHo = await hr("nk1ho");
    const thayA = await maCua(hrA, "doi-nguon");
    expect(thayA.has(mA)).toBe(true);
    expect(thayA.has(mB)).toBe(false);
    expect(thayA.has(khac)).toBe(false);
    expect(thayA.has(lai)).toBe(false);
    const thayHo = await maCua(hrHo, "doi-nguon");
    expect([thayHo.has(mA), thayHo.has(mB), thayHo.has(khac), thayHo.has(lai)]).toEqual([true, true, false, false]);

    const dong = (await docNhatKy(db, hrA, "doi-nguon", { coTrang: 100 })).muc.find((m) => m.maDoiTuong === mA)!;
    expect(dong).toMatchObject({ hanhDong: "Đổi nguồn", doiTuong: "Lead", lyDo: "Phụ huynh xác nhận người giới thiệu", nguoi: "Người làm nk" });
    expect(dong.thayDoi).toEqual([{ truong: "Nguồn", cu: "Nguồn từ Quảng Cáo", moi: "Nguồn từ phụ huynh giới thiệu" }]);
  });

  it("[NHH-DSP-NK2] Lịch sử chính sách: gồm thực thể chính sách/văn bản/phiên bản; chính sách HỘI SỞ (không gắn đơn vị) hiện cho mọi người xem được chính sách; dòng cơ sở khác thì không", async () => {
    const hoiSo = await ghi({ entityType: "CommissionPolicyVersion", action: "ACTIVATE", orgUnitId: null, dau: "PLHO01" });
    const coSoA = await ghi({ entityType: "CommissionPolicy", action: "CREATE", orgUnitId: a.ouId, dau: "PLA001" });
    const coSoB = await ghi({ entityType: "RegulationDocument", action: "CREATE", orgUnitId: b.ouId, dau: "PLB001" });
    const khacModule = await ghi({ entityType: "CommissionPolicy", action: "CREATE", orgUnitId: a.ouId, dau: "PLA002", module: "khac" });
    const khong = await ghi({ entityType: "CommissionPeriod", action: "LOCK", orgUnitId: a.ouId, dau: "PLA003" });

    const hrA = await hr("nk2a", a.ouId);
    const thayA = await maCua(hrA, "chinh-sach");
    expect([thayA.has(hoiSo), thayA.has(coSoA), thayA.has(coSoB), thayA.has(khacModule), thayA.has(khong)]).toEqual([true, true, false, false, false]);
    const thayHo = await maCua(await hr("nk2ho"), "chinh-sach");
    expect([thayHo.has(hoiSo), thayHo.has(coSoA), thayHo.has(coSoB)]).toEqual([true, true, true]);
  });

  it("[NHH-DSP-NK3] Nhật ký: sổ/kỳ/hàng chờ/khiếu nại trong module; KHÔNG lặp lại dòng chính sách; người KHÔNG giữ quyền duyệt không thấy dòng KHIẾU NẠI (lý do quyết định là chuyện của HR)", async () => {
    const ky = await ghi({ entityType: "CommissionPeriod", action: "LOCK", orgUnitId: a.ouId, dau: "NKA001", reason: "khoá kỳ để chi lương" });
    const kn = await ghi({ entityType: "CommissionDispute", action: "DECIDE", orgUnitId: a.ouId, dau: "NKA002", reason: "Quyết định có lý do" });
    const kyB = await ghi({ entityType: "CommissionPeriod", action: "LOCK", orgUnitId: b.ouId, dau: "NKB001" });
    const cs = await ghi({ entityType: "CommissionPolicy", action: "CREATE", orgUnitId: a.ouId, dau: "NKA003" });
    const slot = await ghi({ entityType: "CommissionCalcSlot", action: "CALCULATE", orgUnitId: a.ouId, dau: "NKA004" }); // engine ghi audit từng ô tính — không thuộc Nhật ký

    // QLCS cơ sở A: có view-center (thấy sổ/kỳ của A) nhưng KHÔNG giữ quyền duyệt khiếu nại
    await ganVai(a.qlcs.id, a.ouId, "CENTER_SALES_CSM");
    const qlcs = (await nguoiKyQlcs(a)).quyen;
    const thayQl = await maCua(qlcs, "nhat-ky");
    expect([thayQl.has(ky), thayQl.has(kn), thayQl.has(kyB), thayQl.has(cs)]).toEqual([true, false, false, false]);
    // đối chứng dương: HR cơ sở A (giữ quyền duyệt) thấy cả dòng khiếu nại; vẫn không thấy cơ sở B và dòng chính sách
    const thayHr = await maCua(await hr("nk3a", a.ouId), "nhat-ky");
    expect([thayHr.has(ky), thayHr.has(kn), thayHr.has(kyB), thayHr.has(cs), thayHr.has(slot)]).toEqual([true, true, false, false, false]);
  });

  it("[NHH-DSP-NK4] sắp mới nhất trước, phân trang đếm đúng; trang quá biên ⇒ rỗng chứ không lỗi; tổng không phụ thuộc cỡ trang", async () => {
    const hrHo = await hr("nk4");
    for (const d of ["PG0001", "PG0002", "PG0003"]) await ghi({ entityType: "CommissionHold", action: "DISMISS", orgUnitId: a.ouId, dau: d });
    const tat = await docNhatKy(db, hrHo, "nhat-ky", { coTrang: 2, trang: 1 });
    expect(tat.muc).toHaveLength(2);
    const hai = await docNhatKy(db, hrHo, "nhat-ky", { coTrang: 2, trang: 2 });
    expect(hai.tongSo).toBe(tat.tongSo);
    const luc = tat.muc.map((m) => m.luc.getTime());
    expect(luc).toEqual([...luc].sort((x, y) => y - x));
    const xa = await docNhatKy(db, hrHo, "nhat-ky", { coTrang: 2, trang: 99999 });
    expect(xa.muc).toEqual([]);
  });
});

describe("[NHH-DSP-NK5] dungThayDoi (thuần)", () => {
  it("chỉ giữ trường ĐÃ ĐỔI; che SĐT/email; cắt giá trị dài; tối đa 6 trường", () => {
    const t = dungThayDoi({ a: 1, phone: "0818823720", email: "ab@x.vn", giu: "y" }, { a: 2, phone: "0900000000", email: "cd@x.vn", giu: "y" }, []);
    expect(t.map((x) => x.truong).sort()).toEqual(["a", "email", "phone"]);
    const phone = t.find((x) => x.truong === "phone")!;
    expect(phone.cu).not.toContain("0818823720");
    expect(phone.moi).not.toContain("0900000000");
    expect(dungThayDoi({ x: "a".repeat(300) }, { x: "b" }, [])[0]!.cu.length).toBeLessThanOrEqual(90);
    // khoá kỹ thuật (id, hash) KHÔNG in ra; trường quen thuộc có nhãn tiếng Việt; trạng thái đổi sang chữ theo loại thực thể; tiền có dấu chấm nghìn
    const ky = dungThayDoi({ status: "OPEN", paymentId: "p1", inputHash: "abc", tong: 0 }, { status: "LOCKED", paymentId: "p2", inputHash: "def", tong: 1_200_000 }, [], "CommissionPeriod");
    expect(ky).toEqual([
      { truong: "Trạng thái", cu: "Đang mở", moi: "Đã khoá" },
      { truong: "Tổng", cu: "0đ", moi: "1.200.000đ" },
    ]);
    // cùng mã trạng thái "OPEN" nhưng khác thực thể ⇒ khác chữ (khiếu nại ≠ kỳ)
    expect(dungThayDoi({ status: "OPEN" }, { status: "UNDER_REVIEW" }, [], "CommissionDispute")).toEqual([{ truong: "Trạng thái", cu: "Mới tiếp nhận", moi: "Đang xem xét" }]);
    const nhieu = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i]));
    const nhieuMoi = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, i + 1]));
    expect(dungThayDoi(nhieu, nhieuMoi, [])).toHaveLength(6);
    expect(dungThayDoi(null, null, [])).toEqual([]);
  });
});
