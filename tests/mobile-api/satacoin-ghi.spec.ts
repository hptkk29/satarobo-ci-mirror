import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// `lib/portal/muc-tam-an` → `lib/flags` không cần phiên web; chặn `@/lib/auth` như bộ xác thực di động (không có đường nào được gọi `auth()` thật).
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));

import { db } from "@/lib/db";
import { layDanhMucQua } from "@/lib/mobile-api/dich-vu/doi-qua";
import { laySataCoin, nhanGiaoDichCoin } from "@/lib/mobile-api/dich-vu/satacoin";
import { soDuVi } from "@/lib/satacoin/doi-qua";
import type { MaHocVienDaKiem } from "@/lib/mobile-api/so-huu";
import { getBalance, ghiGiaoDichTrongTx, grantByRule, recordTransaction, reverseTransaction } from "@/lib/satacoin/service";
import { laDbCucBo, laTenDbLaDbTest, tenDbCuaUrl } from "@/lib/security/url-db-cuc-bo";

/**
 * SataCoin (M2-SC) trên POSTGRES THẬT — TÍNH TOÀN VẸN KHI GHI + DTO của mobile. Mã ca: SCG. MỖI CA XANH KHI CHẠY MỘT MÌNH (học viên riêng từng ca).
 *   [SCG-01] số dư == Σ amount; trừ quá số dư bị từ chối và KHÔNG ghi gì (số dư không đổi)
 *   [SCG-02] 20 lượt trừ ĐỒNG THỜI trên số dư vừa đủ cho 5 lượt ⇒ đúng 5 lượt thành công, số dư cuối == 0 (không bao giờ âm)
 *   [SCG-03] cùng `eventKey` ghi hai lần (tuần tự và 10 lượt đồng thời) ⇒ CHỈ MỘT giao dịch; lượt sau trả đúng giao dịch cũ (`trungLap`)
 *   [SCG-04] `eventKey` có phạm vi theo học viên: cùng khoá ở học viên khác ⇒ ghi bình thường; không khoá ⇒ ghi mọi lần
 *   [SCG-05] đảo: lượt đảo thứ hai (tuần tự và 10 lượt đồng thời) ⇒ đúng MỘT dòng REVERSAL; không đảo được dòng đảo; không ném lỗi thô
 *   [SCG-06] đảo một khoản CỘNG đã bị tiêu (số dư sẽ âm) ⇒ từ chối, không ghi; đảo khoản TRỪ luôn được
 *   [SCG-07] số tiền không hợp lệ (0, số thực, NaN) ⇒ từ chối, không ghi
 *   [SCG-08] học viên không tồn tại / đã xoá mềm ⇒ từ chối
 *   [SCG-09] DTO mobile: tổng nhận / đã dùng bỏ giao dịch đã bị đảo; không lộ ghi chú nhân viên; `doiQua.choPhep` luôn false; cờ TẮT ⇒ null
 *   [SCG-10] DTO: học viên A không bao giờ thấy giao dịch của học viên B; quy tắc chỉ gồm quy tắc CỘNG đang bật của cơ sở mình
 *   [SCG-11] nhãn giao dịch (hàm thuần): quy tắc → «Đổi quà» → «Đảo giao dịch» → lý do nhân viên
 *   [SCG-12] `grantByRule` truyền `eventKey` (tự động cộng hai lần cho cùng sự kiện ⇒ một dòng)
 *   [SCG-14] (lưới ghim mã nguồn, không cần DB) hai đường ghi ví — `service.ts` và `doi-qua.ts` (đổi quà WP8) — khoá CÙNG MỘT đối tượng: hàng `Student` `FOR UPDATE`
 *   [SCG-15] trừ / đảo tính coin ĐANG GIỮ cho yêu cầu đổi quà (WP8): khả dụng = sổ cái − giữ
 *   [SCG-16] `ghiGiaoDichTrongTx` (cho doi-qua.ts): ghi trong transaction người gọi, eventKey trùng ⇒ không ghi thêm
 *   [SCG-17] khoản TRỪ của một yêu cầu đổi quà ĐÃ GIAO không đảo trực tiếp được (sổ cái và phiếu không lệch nhau); khoản trừ thường vẫn đảo được
 *   [SCG-18] MỘT nguồn số dư: getBalance = soDuVi.soDu = DTO SataCoin.soDu = DTO danh mục quà.soDu (web và mobile cùng sổ cái); khả dụng = số dư − phần đang giữ
 *   [SCG-19] `doiQua.choPhep` do MÁY CHỦ quyết: có ≥1 quà đang mở ⇒ true; ngừng quà của ca ⇒ bằng «còn quà nào khác đang mở không» (không đụng dữ liệu của bộ test khác)
 *   [SCG-13] ĐUA giữa «đảo khoản cộng» và «trừ» (cùng học viên, 24 học viên song song) ⇒ số dư KHÔNG BAO GIỜ âm
 * Cổng DB: chỉ chạy trên DB cục bộ tên satarobo_vitest / satarobo_test* / ci_test*; dữ liệu mang tiền tố `scgtest-`, dọn ở afterAll. KHÔNG chạy với DB UAT hay DB dùng chung.
 */
const URL_DB = process.env.DATABASE_URL ?? "";
const TEN_DB = tenDbCuaUrl(URL_DB);
const RUN = laDbCucBo(URL_DB) && TEN_DB !== null && (TEN_DB === "satarobo_vitest" || laTenDbLaDbTest(TEN_DB));

const NS = "scgtest-";
const hs = (id: string) => id as unknown as MaHocVienDaKiem;
let dem = 0;

/** Học viên MỚI cho từng ca (mỗi ca xanh khi chạy MỘT MÌNH — không mượn trạng thái ca trước). */
async function moi(coSo: "cs1" | "cs2" = "cs1", daXoa = false): Promise<string> {
  const id = `${NS}hs-${++dem}-${Math.random().toString(36).slice(2, 7)}`;
  await db.student.create({ data: { id, name: `${NS}${dem}`, centerId: `${NS}${coSo}`, ...(daXoa ? { deletedAt: new Date() } : {}) } as never });
  return id;
}

async function don() {
  await db.sataCoinTransaction.deleteMany({ where: { studentId: { startsWith: NS } } });
  await db.sataCoinRule.deleteMany({ where: { code: { startsWith: "SCGTEST_" } } });
  await db.student.deleteMany({ where: { id: { startsWith: NS } } });
  await db.center.deleteMany({ where: { id: { startsWith: NS } } });
}

describe.skipIf(!RUN)("SataCoin — toàn vẹn khi ghi + DTO mobile", () => {
  beforeAll(async () => {
    await don();
    await db.center.create({ data: { id: `${NS}cs1`, name: "Cơ sở SCG 1", slug: `${NS}cs1`, address: "x" } });
    await db.center.create({ data: { id: `${NS}cs2`, name: "Cơ sở SCG 2", slug: `${NS}cs2`, address: "x" } });
  });
  afterAll(async () => {
    delete process.env.PORTAL_SATACOIN_ENABLED;
    await don();
  });

  it("[SCG-01] số dư == Σ amount; trừ quá số dư bị từ chối và không ghi gì", async () => {
    const A = await moi();
    expect((await recordTransaction({ studentId: A, amount: 50, type: "EARN", reason: "T" })).ok).toBe(true);
    expect((await recordTransaction({ studentId: A, amount: -20, type: "SPEND", reason: "REDEEM_GIFT" })).ok).toBe(true);
    expect(await getBalance(A)).toBe(30);
    const qua = await recordTransaction({ studentId: A, amount: -31, type: "SPEND", reason: "REDEEM_GIFT" });
    expect(qua.ok).toBe(false);
    expect(qua.error).toMatch(/Số dư không đủ \(hiện 30\)/);
    expect(await getBalance(A)).toBe(30);
    expect(await db.sataCoinTransaction.count({ where: { studentId: A } })).toBe(2);
  });

  it("[SCG-02] 20 lượt trừ đồng thời trên số dư vừa đủ cho 5 lượt ⇒ đúng 5 thành công, số dư cuối 0", async () => {
    const C = await moi();
    await recordTransaction({ studentId: C, amount: 100, type: "EARN", reason: "T" });
    const kq = await Promise.all(Array.from({ length: 20 }, () => recordTransaction({ studentId: C, amount: -20, type: "SPEND", reason: "REDEEM_GIFT" })));
    expect(kq.filter((k) => k.ok)).toHaveLength(5);
    expect(kq.filter((k) => !k.ok).every((k) => /Số dư không đủ/.test(k.error ?? ""))).toBe(true);
    expect(await getBalance(C)).toBe(0);
    expect(await db.sataCoinTransaction.count({ where: { studentId: C, type: "SPEND" } })).toBe(5);
  });

  it("[SCG-03] cùng eventKey ghi hai lần (tuần tự và 10 lượt đồng thời) ⇒ chỉ MỘT giao dịch", async () => {
    const D = await moi();
    const dau = await recordTransaction({ studentId: D, amount: 10, type: "EARN", reason: "T", eventKey: "su-kien-tuan-tu-1" });
    const hai = await recordTransaction({ studentId: D, amount: 10, type: "EARN", reason: "T", eventKey: "su-kien-tuan-tu-1" });
    expect(dau).toMatchObject({ ok: true });
    expect(dau.trungLap).toBeUndefined();
    expect(hai).toMatchObject({ ok: true, trungLap: true, txId: dau.txId });
    const dongThoi = await Promise.all(Array.from({ length: 10 }, () => recordTransaction({ studentId: D, amount: 7, type: "EARN", reason: "T", eventKey: "dong-thoi-1" })));
    expect(dongThoi.every((k) => k.ok)).toBe(true);
    expect(new Set(dongThoi.map((k) => k.txId)).size).toBe(1);
    expect(dongThoi.filter((k) => !k.trungLap)).toHaveLength(1);
    expect(await getBalance(D)).toBe(17); // 10 + 7, không phải 10 + 10 + 70
    expect(await db.sataCoinTransaction.count({ where: { studentId: D } })).toBe(2);
    // thử lại MỘT khoản TRỪ đã thành công, khi số dư đã về 0: phải nhận lại đúng giao dịch cũ — KHÔNG được báo "Số dư không đủ" cho việc đã làm xong
    const rut1 = await recordTransaction({ studentId: D, amount: -17, type: "SPEND", reason: "REDEEM_GIFT", eventKey: "rut-het" });
    const rut2 = await recordTransaction({ studentId: D, amount: -17, type: "SPEND", reason: "REDEEM_GIFT", eventKey: "rut-het" });
    expect(rut1.ok).toBe(true);
    expect(rut2).toMatchObject({ ok: true, trungLap: true, txId: rut1.txId });
    expect(await getBalance(D)).toBe(0);
  });

  it("[SCG-04] eventKey có phạm vi theo học viên (cùng khoá ở học viên khác ghi bình thường); không khoá thì ghi mọi lần", async () => {
    const X = await moi();
    const Y = await moi();
    const x = await recordTransaction({ studentId: X, amount: 10, type: "EARN", reason: "T", eventKey: "khoa-chung" });
    const y = await recordTransaction({ studentId: Y, amount: 10, type: "EARN", reason: "T", eventKey: "khoa-chung" });
    expect([x.ok, y.ok]).toEqual([true, true]);
    expect([x.trungLap, y.trungLap]).toEqual([undefined, undefined]);
    expect(x.txId).not.toBe(y.txId);
    await recordTransaction({ studentId: X, amount: 1, type: "EARN", reason: "T" });
    await recordTransaction({ studentId: X, amount: 1, type: "EARN", reason: "T" });
    expect(await getBalance(X)).toBe(12);
  });

  it("[SCG-05] đảo: lượt thứ hai (tuần tự và đồng thời) ⇒ đúng MỘT dòng REVERSAL; không đảo được dòng đảo", async () => {
    const D = await moi();
    await recordTransaction({ studentId: D, amount: 100, type: "EARN", reason: "T" });
    const goc = await recordTransaction({ studentId: D, amount: -5, type: "SPEND", reason: "REDEEM_GIFT" });
    const r1 = await reverseTransaction(goc.txId!, null);
    const r2 = await reverseTransaction(goc.txId!, null);
    expect(r1.ok).toBe(true);
    expect(r2).toMatchObject({ ok: false, error: "Giao dịch đã được đảo trước đó" });
    expect(await reverseTransaction(r1.reversalId!, null)).toMatchObject({ ok: false, error: "Không thể đảo một giao dịch đảo" });
    const goc2 = await recordTransaction({ studentId: D, amount: -4, type: "SPEND", reason: "REDEEM_GIFT" });
    const dt = await Promise.all(Array.from({ length: 10 }, () => reverseTransaction(goc2.txId!, null)));
    expect(dt.filter((k) => k.ok)).toHaveLength(1);
    expect(dt.filter((k) => !k.ok).every((k) => k.error === "Giao dịch đã được đảo trước đó")).toBe(true);
    expect(await db.sataCoinTransaction.count({ where: { reversedTxId: goc2.txId! } })).toBe(1);
    expect(await getBalance(D)).toBe(100); // hai khoản trừ đều đã được hoàn lại đúng một lần
  });

  it("[SCG-06] đảo khoản CỘNG đã bị tiêu ⇒ từ chối, không ghi; đảo khoản TRỪ luôn được", async () => {
    const B = await moi();
    const cong = await recordTransaction({ studentId: B, amount: 30, type: "EARN", reason: "T" });
    await recordTransaction({ studentId: B, amount: -25, type: "SPEND", reason: "REDEEM_GIFT" }); // còn 5
    const soDong = () => db.sataCoinTransaction.count({ where: { studentId: B } });
    const truoc = await soDong();
    const r = await reverseTransaction(cong.txId!, null);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/số dư sẽ âm \(hiện 5, cần trừ 30\)/);
    expect(await soDong()).toBe(truoc);
    expect(await getBalance(B)).toBe(5);
    const tru = await db.sataCoinTransaction.findFirstOrThrow({ where: { studentId: B, type: "SPEND" } });
    expect((await reverseTransaction(tru.id, null)).ok).toBe(true); // hoàn lại 25 ⇒ 30
    expect(await getBalance(B)).toBe(30);
    expect((await reverseTransaction(cong.txId!, null)).ok).toBe(true); // nay đủ số dư để đảo khoản cộng
    expect(await getBalance(B)).toBe(0);
  });

  it("[SCG-07] số tiền không hợp lệ ⇒ từ chối, không ghi", async () => {
    const A = await moi();
    expect((await recordTransaction({ studentId: A, amount: 0, type: "EARN", reason: "T" })).ok).toBe(false);
    expect((await recordTransaction({ studentId: A, amount: 1.5, type: "EARN", reason: "T" })).ok).toBe(false);
    expect((await recordTransaction({ studentId: A, amount: Number.NaN, type: "EARN", reason: "T" })).ok).toBe(false);
    expect(await db.sataCoinTransaction.count({ where: { studentId: A } })).toBe(0);
  });

  it("[SCG-08] học viên không tồn tại / đã xoá mềm ⇒ từ chối", async () => {
    const XOA = await moi("cs1", true);
    expect(await recordTransaction({ studentId: `${NS}khong-co`, amount: 5, type: "EARN", reason: "T" })).toMatchObject({ ok: false, error: "Không tìm thấy học viên" });
    expect(await recordTransaction({ studentId: XOA, amount: 5, type: "EARN", reason: "T" })).toMatchObject({ ok: false, error: "Không tìm thấy học viên" });
    expect(await db.sataCoinTransaction.count({ where: { studentId: { in: [XOA, `${NS}khong-co`] } } })).toBe(0);
  });

  it("[SCG-09] DTO: tổng bỏ giao dịch đã đảo; không lộ ghi chú nhân viên; doiQua.choPhep=false; cờ TẮT ⇒ null", async () => {
    const E = await moi();
    delete process.env.PORTAL_SATACOIN_ENABLED;
    expect(await laySataCoin(hs(E))).toBeNull();
    process.env.PORTAL_SATACOIN_ENABLED = "true";
    try {
      await db.sataCoinRule.create({ data: { code: "SCGTEST_DUNG_GIO", label: "Đi học đúng giờ (SCG)", amount: 10, isActive: true, centerId: null } });
      const cong = await recordTransaction({ studentId: E, amount: 40, type: "EARN", reason: "SCGTEST_DUNG_GIO", ruleCode: "SCGTEST_DUNG_GIO", note: "Ghi chú NỘI BỘ không được lộ" });
      await recordTransaction({ studentId: E, amount: -15, type: "SPEND", reason: "REDEEM_GIFT" });
      const bi = await recordTransaction({ studentId: E, amount: 8, type: "EARN", reason: "Thưởng nóng" });
      await reverseTransaction(bi.txId!, null); // +8 rồi đảo ⇒ không tính vào tổng nhận
      const d = (await laySataCoin(hs(E)))!;
      expect(d.soDu).toBe(await getBalance(E));
      expect(d.soDu).toBe(40 - 15);
      expect(d.tongNhan).toBe(40); // +8 đã bị đảo ⇒ không tính
      expect(d.tongDaDung).toBe(15);
      expect(d.doiQua).toEqual({ choPhep: false });
      const goc = d.giaoDich.find((g) => g.id === cong.txId)!;
      expect(goc).toMatchObject({ loai: "EARN", soCoin: 40, nhan: "Đi học đúng giờ (SCG)", daDao: false });
      expect(d.giaoDich.find((g) => g.id === bi.txId)).toMatchObject({ daDao: true });
      expect(d.giaoDich.find((g) => g.loai === "SPEND")).toMatchObject({ nhan: "Đổi quà", soCoin: -15 });
      expect(d.giaoDich.find((g) => g.loai === "REVERSAL")).toMatchObject({ nhan: "Đảo giao dịch", soCoin: -8 });
      expect(JSON.stringify(d)).not.toMatch(/NỘI BỘ|"note"|reversedTxId|createdById|centerId/);
      expect(d.nguon.find((n) => n.ma === "SCGTEST_DUNG_GIO")).toMatchObject({ nhan: "Đi học đúng giờ (SCG)", soLan: 1, soCoin: 40 });
      expect(d.nguon.every((n) => n.ma !== "Thưởng nóng")).toBe(true); // khoản đã đảo không nằm trong nguồn
    } finally {
      delete process.env.PORTAL_SATACOIN_ENABLED;
    }
  });

  it("[SCG-10] DTO: không lẫn học viên; quy tắc chỉ gồm quy tắc CỘNG đang bật của cơ sở mình hoặc dùng chung", async () => {
    const A = await moi("cs1");
    const B = await moi("cs2");
    await recordTransaction({ studentId: A, amount: 11, type: "EARN", reason: "T" });
    await recordTransaction({ studentId: B, amount: 22, type: "EARN", reason: "T" });
    process.env.PORTAL_SATACOIN_ENABLED = "true";
    try {
      await db.sataCoinRule.createMany({
        data: [
          { code: "SCGTEST_CHUNG", label: "Dùng chung", amount: 10, isActive: true, centerId: null },
          { code: "SCGTEST_CS1", label: "Chỉ cơ sở 1", amount: 5, isActive: true, centerId: `${NS}cs1` },
          { code: "SCGTEST_CS2", label: "Chỉ cơ sở 2", amount: 5, isActive: true, centerId: `${NS}cs2` },
          { code: "SCGTEST_TAT", label: "Đã tắt", amount: 5, isActive: false, centerId: null },
          { code: "SCGTEST_TRU", label: "Quy tắc trừ", amount: -10, isActive: true, centerId: null },
        ],
      });
      const CUA_CA = new Set(["SCGTEST_CHUNG", "SCGTEST_CS1", "SCGTEST_CS2", "SCGTEST_TAT", "SCGTEST_TRU"]); // quy tắc do CHÍNH ca này tạo (ca khác có thể để lại quy tắc của nó)
      const a = (await laySataCoin(hs(A)))!;
      const b = (await laySataCoin(hs(B)))!;
      const ma = (d: typeof a) => d.quyTac.map((r) => r.ma).filter((m) => CUA_CA.has(m)).sort();
      expect(ma(a)).toEqual(["SCGTEST_CHUNG", "SCGTEST_CS1"]);
      expect(ma(b)).toEqual(["SCGTEST_CHUNG", "SCGTEST_CS2"]);
      expect(a.quyTac.every((r) => r.soCoin > 0)).toBe(true);
      expect(a.giaoDich.map((g) => g.soCoin)).toEqual([11]);
      expect(b.giaoDich.map((g) => g.soCoin)).toEqual([22]);
      expect(a.soDu).toBe(11);
      expect(b.soDu).toBe(22);
    } finally {
      delete process.env.PORTAL_SATACOIN_ENABLED;
    }
  });

  it("[SCG-11] nhãn giao dịch (hàm thuần)", () => {
    const quyTac = new Map([["R1", "Quy tắc Một"]]);
    expect(nhanGiaoDichCoin({ type: "EARN", reason: "R1", ruleCode: "R1" }, quyTac)).toBe("Quy tắc Một");
    expect(nhanGiaoDichCoin({ type: "EARN", reason: "R1", ruleCode: null }, quyTac)).toBe("Quy tắc Một");
    expect(nhanGiaoDichCoin({ type: "SPEND", reason: "REDEEM_GIFT", ruleCode: null }, quyTac)).toBe("Đổi quà");
    expect(nhanGiaoDichCoin({ type: "REVERSAL", reason: "REVERSAL:R1", ruleCode: null }, quyTac)).toBe("Đảo giao dịch");
    expect(nhanGiaoDichCoin({ type: "ADJUST", reason: "  Sửa nhầm  ", ruleCode: null }, quyTac)).toBe("Sửa nhầm");
    expect(nhanGiaoDichCoin({ type: "ADJUST", reason: " ", ruleCode: null }, quyTac)).toBe("Điều chỉnh của trung tâm");
    expect(nhanGiaoDichCoin({ type: "EARN", reason: "", ruleCode: null }, quyTac)).toBe("Thưởng");
  });

  it("[SCG-12] grantByRule truyền eventKey: cộng hai lần cho cùng sự kiện ⇒ một dòng", async () => {
    const E = await moi();
    await db.sataCoinRule.create({ data: { code: "SCGTEST_GRANT", label: "Quy tắc cấp", amount: 10, isActive: true, centerId: null } });
    const l1 = await grantByRule({ studentId: E, ruleCode: "SCGTEST_GRANT", eventKey: "buoi-7-dung-gio" });
    const l2 = await grantByRule({ studentId: E, ruleCode: "SCGTEST_GRANT", eventKey: "buoi-7-dung-gio" });
    expect(l1.ok && l2.ok).toBe(true);
    expect(l2).toMatchObject({ trungLap: true, txId: l1.txId });
    expect(await getBalance(E)).toBe(10);
    expect(await grantByRule({ studentId: E, ruleCode: "KHONG_CO_QUY_TAC" })).toMatchObject({ ok: false });
  });

  it("[SCG-15] trừ / đảo phải tính coin ĐANG GIỮ cho yêu cầu đổi quà (khả dụng, không phải số dư thô)", async () => {
    const H = await moi();
    const cong = await recordTransaction({ studentId: H, amount: 100, type: "EARN", reason: "T" });
    const qua = await db.sataCoinGift.create({ data: { name: "Quà SCG", coinCost: 60 } });
    const yc = await db.sataCoinRedemption.create({
      data: { studentId: H, giftId: qua.id, centerId: `${NS}cs1`, coinCost: 60, status: "REQUESTED", requestedByUserId: "scg-user", idempotencyKey: `scg-${H}` },
    });
    try {
      // sổ cái 100, giữ 60 ⇒ khả dụng 40
      const qua50 = await recordTransaction({ studentId: H, amount: -50, type: "SPEND", reason: "REDEEM_GIFT" });
      expect(qua50.ok).toBe(false);
      expect(qua50.error).toMatch(/Số dư không đủ \(hiện 40, đang giữ 60/);
      expect((await recordTransaction({ studentId: H, amount: -40, type: "SPEND", reason: "REDEEM_GIFT" })).ok).toBe(true);
      // đảo khoản cộng 100: khả dụng 0 < 100 ⇒ từ chối
      expect((await reverseTransaction(cong.txId!, null)).ok).toBe(false);
    } finally {
      await db.sataCoinRedemption.delete({ where: { id: yc.id } });
      await db.sataCoinGift.delete({ where: { id: qua.id } });
    }
  });

  it("[SCG-16] ghiGiaoDichTrongTx: ghi trong transaction của người gọi, eventKey trùng ⇒ không ghi thêm", async () => {
    const K = await moi();
    const r = await db.$transaction(async (tx) => {
      const a = await ghiGiaoDichTrongTx(tx, { studentId: K, amount: 7, type: "EARN", reason: "T", eventKey: "doi-qua:x1", centerId: `${NS}cs1`, orgUnitId: null });
      const b = await ghiGiaoDichTrongTx(tx, { studentId: K, amount: 7, type: "EARN", reason: "T", eventKey: "doi-qua:x1", centerId: `${NS}cs1`, orgUnitId: null });
      return [a, b];
    });
    expect(r[0].trungLap).toBe(false);
    expect(r[1]).toEqual({ txId: r[0].txId, trungLap: true });
    expect(await getBalance(K)).toBe(7);
  });

  it("[SCG-17] khoản trừ của yêu cầu đổi quà đã giao không đảo trực tiếp; khoản trừ thường vẫn đảo được", async () => {
    const H = await moi();
    await recordTransaction({ studentId: H, amount: 100, type: "EARN", reason: "T" });
    const tru = await recordTransaction({ studentId: H, amount: -30, type: "SPEND", reason: "REDEEM_GIFT" });
    const thuong = await recordTransaction({ studentId: H, amount: -5, type: "SPEND", reason: "REDEEM_GIFT" });
    const qua = await db.sataCoinGift.create({ data: { name: "Quà SCG-17", coinCost: 30 } });
    const yc = await db.sataCoinRedemption.create({
      data: { studentId: H, giftId: qua.id, centerId: `${NS}cs1`, coinCost: 30, status: "DELIVERED", requestedByUserId: "scg-user", idempotencyKey: `scg17-${H}`, spendTxId: tru.txId! },
    });
    try {
      const r = await reverseTransaction(tru.txId!, null);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/yêu cầu đổi quà đã giao/);
      expect(await getBalance(H)).toBe(65); // không đổi
      expect((await reverseTransaction(thuong.txId!, null)).ok).toBe(true); // khoản trừ KHÔNG gắn yêu cầu ⇒ vẫn đảo được
      expect(await getBalance(H)).toBe(70);
    } finally {
      await db.sataCoinRedemption.delete({ where: { id: yc.id } });
      await db.sataCoinGift.delete({ where: { id: qua.id } });
    }
  });

  it("[SCG-18] MỘT nguồn số dư: sổ cái = soDuVi = DTO SataCoin = DTO danh mục quà; khả dụng = số dư − đang giữ", async () => {
    const H = await moi();
    await recordTransaction({ studentId: H, amount: 120, type: "EARN", reason: "T" });
    await recordTransaction({ studentId: H, amount: -20, type: "SPEND", reason: "REDEEM_GIFT" });
    const qua = await db.sataCoinGift.create({ data: { name: "Quà SCG-18", coinCost: 35 } });
    const yc = await db.sataCoinRedemption.create({ data: { studentId: H, giftId: qua.id, centerId: `${NS}cs1`, coinCost: 35, status: "REQUESTED", requestedByUserId: "scg-user", idempotencyKey: `scg18-${H}` } });
    process.env.PORTAL_SATACOIN_ENABLED = "true";
    try {
      const sach = await getBalance(H);
      const vi = await soDuVi(db, H);
      const sc = (await laySataCoin(hs(H)))!;
      const dm = await layDanhMucQua(hs(H));
      expect([sach, vi.soDu, sc.soDu, dm.soDu]).toEqual([100, 100, 100, 100]);
      expect(vi).toMatchObject({ soDu: 100, dangGiu: 35, khaDung: 65 });
      expect(dm).toMatchObject({ soDu: 100, dangGiu: 35, khaDung: 65 });
    } finally {
      delete process.env.PORTAL_SATACOIN_ENABLED;
      await db.sataCoinRedemption.delete({ where: { id: yc.id } });
      await db.sataCoinGift.delete({ where: { id: qua.id } });
    }
  });

  it("[SCG-19] doiQua.choPhep do máy chủ quyết theo danh mục quà đang mở", async () => {
    const H = await moi();
    process.env.PORTAL_SATACOIN_ENABLED = "true";
    const qua = await db.sataCoinGift.create({ data: { name: "Quà SCG-19", coinCost: 10, isActive: true } });
    try {
      expect((await laySataCoin(hs(H)))!.doiQua).toEqual({ choPhep: true });
      await db.sataCoinGift.update({ where: { id: qua.id }, data: { isActive: false } });
      // không đụng quà của bộ test khác (DB dùng chung): sau khi ngừng quà của ca này, choPhep == «còn quà nào khác đang mở không»
      const conKhac = (await db.sataCoinGift.count({ where: { isActive: true } })) > 0;
      expect((await laySataCoin(hs(H)))!.doiQua).toEqual({ choPhep: conKhac });
    } finally {
      delete process.env.PORTAL_SATACOIN_ENABLED;
      await db.sataCoinGift.delete({ where: { id: qua.id } });
    }
  });

  it("[SCG-13] đua giữa đảo khoản cộng và trừ ⇒ số dư không bao giờ âm", async () => {
    const hv = await Promise.all(Array.from({ length: 24 }, () => moi()));
    const goc = await Promise.all(hv.map((id) => recordTransaction({ studentId: id, amount: 30, type: "EARN", reason: "T" })));
    // mỗi học viên: ĐẢO khoản cộng 30 và TRỪ 25 cùng lúc — chỉ MỘT trong hai được thành công (nếu cả hai ⇒ −25)
    await Promise.all(hv.flatMap((id, i) => [reverseTransaction(goc[i].txId!, null), recordTransaction({ studentId: id, amount: -25, type: "SPEND", reason: "REDEEM_GIFT" })]));
    const so = await Promise.all(hv.map((id) => getBalance(id)));
    expect(so.every((x) => x >= 0)).toBe(true);
  });
});

describe("SataCoin — khoá ví dùng chung", () => {
  it("[SCG-14] service.ts DÙNG khoaHocVien + soDuVi của doi-qua.ts (một đối tượng khoá, một cách tính khả dụng); doi-qua.ts khoá Student FOR UPDATE; không còn khoá tư vấn riêng", () => {
    const boChuThich = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
    const sv = doc("lib/satacoin/service.ts");
    const dq = doc("lib/satacoin/doi-qua.ts");
    expect(sv).toMatch(/import \{[^}]*\bkhoaHocVien\b[^}]*\bsoDuVi\b[^}]*\} from "\.\/doi-qua"/);
    expect((sv.match(/await khoaHocVien\(tx, /g) ?? []).length).toBe(2); // ghi + đảo
    expect((dq.match(/SELECT "id" FROM "Student" WHERE "id" = \$\{studentId\} FOR UPDATE/g) ?? []).length).toBe(1);
    expect(sv).not.toMatch(/pg_advisory|FOR UPDATE/);
    expect(dq).not.toMatch(/pg_advisory/);
    expect(dq).not.toMatch(/from "\.\/service"/); // không vòng import
  });
});
