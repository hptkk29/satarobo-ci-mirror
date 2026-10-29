// @vitest-environment node
/**
 * [RAL-01..RAL-05] — HÀNG CHỜ ĐÓNG RỒI MỞ LẠI (cùng `holdKey`) PHẢI "ÁP DỤNG" ĐƯỢC LẠI, trên Postgres THẬT (UAT T1 bước 10–11; 13 §…).
 *
 * Lỗ đo được (rà độc lập 20/10/2026, trước bản vá): `ghiHangCho` MỞ LẠI một hàng chờ RESOLVED giữ nguyên `id` + `holdKey`; lượt giải ghi `INPUT_CORRECTION` với khoá idempotency
 * `INPUT_CORRECTION|<holdId>|<ô>|<vai>|<kind>|<người>` — y hệt khoá của lần áp dụng đầu ⇒ `ghiChenhLech` trả `TRUNG` ⇒ `DA_AP_DUNG_TRUOC`. Hàng chờ kẹt OPEN (chặn khoá kỳ); lối thoát
 * còn lại là "Giữ nguyên" ⇒ DISMISSED vĩnh viễn ⇒ hoa hồng của khoản đã bị từ chối vẫn được trả.
 *
 * Chu kỳ tái hiện: khoản 10tr (Sale 3% ⇒ 300.000) · TỪ CHỐI → giải (−300.000) · XÁC NHẬN LẠI → INPUT_DRIFT giải (+300.000) · TỪ CHỐI LẦN HAI → hàng chờ PAYMENT_WITHDRAWN MỞ LẠI → giải lại.
 *
 * Luật sau bản vá: khoá điều chỉnh mang THẾ HỆ MỞ LẠI (id dòng `REOPEN` mới nhất của hàng chờ, `null` = chưa từng mở lại ⇒ khoá cũ, tương thích ngược). Cùng thế hệ ⇒ vẫn idempotent; thế hệ mới ⇒
 * dòng điều chỉnh MỚI. Chỉ áp cho hai đường tính chênh lệch THEO RÒNG HIỆN TẠI (`INPUT_DRIFT`, đảo sạch khoản THU): hai đường TRẢ LẠI SỐ ĐÃ THU HỒI (khoản HOÀN, `LEGACY_REVERSAL`) tính từ dòng đảo chứ không
 * từ ròng, nên khoá cũ là CHỐT DUY NHẤT chống trả lại hai lần — [RAL-05] ghim điều đó.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18). Sổ BẤT BIẾN. Ngày TUYỆT ĐỐI (luật 19); `now` của service = đồng hồ thật (AuditLog.createdAt do Postgres đóng).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { ghiHangCho } from "../../lib/hoa-hong/hang-cho";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import type { NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
import { boiCanh, D, datMocCutover, donKichBan, dongSoCuaKhoan, dungBe, dungKichBan, hoanTien, nguoiKyHo, tienVe, tuChoi, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[RAL] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
let NGUOI: NguoiThaoTacKy & { userId: string };
const cuaToi: KichBan[] = [];

type Cu = { k: KichBan; bc: Awaited<ReturnType<typeof boiCanh>>; bi: string; moi: { id: string }; ba: { id: string } };
async function khoanThu(ten: string): Promise<Cu> {
  const k = await dungKichBan(ten, { rules: [{ vai: "SALE", rate: 0.03 }] });
  cuaToi.push(k);
  const bc = await boiCanh(k, NOW);
  const bi = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
  await quetKhoan(db, bc, bi);
  const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi`, phone: null });
  const ba = await seedUser({ email: `${k.ma}-sale-ba@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-ba`, phone: null });
  return { k, bc, bi, moi, ba };
}
const giai = (x: Pick<Cu, "bc">, holdId: string, lyDo = "Áp dụng theo chu kỳ từ chối / xác nhận lại") => giaiHangCho(db, x.bc, { holdId, quyetDinh: "AP_DUNG", lyDo, nguoi: NGUOI });
const rongKhoan = async (bi: string) => (await dongSoCuaKhoan(bi)).reduce((t, d) => t + d.amount, 0);
const dongHold = (holdId: string) => db.commissionTransaction.findMany({ where: { refEventType: "HOLD", refEventId: holdId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const reopenCua = (holdId: string) => db.auditLog.count({ where: { entityType: "CommissionHold", entityId: holdId, action: "REOPEN" } });
const datSale = (x: Cu, userId: string) => db.lead.update({ where: { id: x.k.lead!.id }, data: { convertedById: userId } });

/** Kế toán TỪ CHỐI (lần đầu bằng hàm thật, các lần sau ghi thẳng như ca PW) → lượt quét dựng / MỞ LẠI hàng chờ PAYMENT_WITHDRAWN. */
async function tuChoiRoiQuet(x: Cu, lanDau: boolean) {
  if (lanDau) await tuChoi(x.k, x.bi);
  else await db.payment.update({ where: { id: x.bi }, data: { accountantStatus: "REJECTED" } });
  await quetKhoan(db, x.bc, x.bi);
  return db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: x.bi } });
}
/** Người chốt đổi (hoặc đổi lại) ⇒ lượt quét dựng / MỞ LẠI hàng chờ INPUT_DRIFT cho chính đầu vào đó (cùng đầu vào ⇒ cùng hash ⇒ cùng `holdKey`). */
async function doiNguoiChotRoiQuet(x: Cu, userId: string) {
  await datSale(x, userId);
  await db.payment.update({ where: { id: x.bi }, data: { accountantStatus: "CONFIRMED" } });
  await quetKhoan(db, x.bc, x.bi);
  return db.commissionHold.findFirstOrThrow({ where: { code: "INPUT_DRIFT", paymentId: x.bi, status: "OPEN" } });
}
/** Đầu vào đổi từ Sale ban đầu sang B và người duyệt ÁP DỤNG: ròng +300.000 về B. Trả hàng chờ drift (ô, hash B). */
async function dungDenB(x: Cu) {
  const dB = await doiNguoiChotRoiQuet(x, x.moi.id);
  await giai(x, dB.id);
  return dB;
}
/**
 * B → C → B: lượt về B gặp lại ĐÚNG đầu vào đã áp dụng (hash B không còn là hash "đã chấp nhận" vì lượt gần nhất là C) ⇒ hàng chờ drift (ô, hash B) RESOLVED bị MỞ LẠI. Ròng về B.
 * (Quay về Sale BAN ĐẦU thì không được: hash đầu tiên của ô luôn nằm trong `hashDaChapNhan` — xem "finding để lại" trong báo cáo.)
 */
async function bRoiCRoiVeB(x: Cu, dB: { id: string }) {
  const dC = await doiNguoiChotRoiQuet(x, x.ba.id);
  await giai(x, dC.id);
  const dB2 = await doiNguoiChotRoiQuet(x, x.moi.id);
  expect(dB2.id, "đối chứng: cùng đầu vào B ⇒ cùng holdKey ⇒ hàng chờ drift cũ được MỞ LẠI").toBe(dB.id);
  await giai(x, dB.id);
  expect(await rongKhoan(x.bi), "đối chứng: ròng +300.000 về B").toBe(300_000);
}

describe.skipIf(!RUN_DB_TESTS)("[RAL] hàng chờ mở lại ⇒ áp dụng lại được", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    NGUOI = await nguoiKyHo();
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[RAL-01] PAYMENT_WITHDRAWN: giải → (đầu vào đổi C rồi về B, áp dụng drift) → từ chối lần hai, hàng chờ MỞ LẠI cùng id ⇒ giải LẠI ghi dòng đảo MỚI (−300.000), ròng về 0, hàng chờ RESOLVED", async () => {
    const x = await khoanThu("ral01");
    const dB = await dungDenB(x);
    const pw = await tuChoiRoiQuet(x, true);
    expect(await giai(x, pw.id)).toMatchObject({ loai: "DA_AP_DUNG", soDong: 1, tong: -300_000 });
    expect(await rongKhoan(x.bi)).toBe(0);

    await bRoiCRoiVeB(x, dB);
    const pw2 = await tuChoiRoiQuet(x, false);
    expect(pw2.id, "đối chứng: lượt quét MỞ LẠI đúng dòng hàng chờ cũ (cùng id, cùng holdKey)").toBe(pw.id);
    expect(pw2.status).toBe("OPEN");
    expect(await reopenCua(pw.id)).toBe(1);

    expect(await giai(x, pw.id), "lần giải thứ hai của CÙNG hàng chờ (thế hệ mới)").toMatchObject({ loai: "DA_AP_DUNG", soDong: 1, tong: -300_000 });
    expect(await rongKhoan(x.bi)).toBe(0);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: pw.id } })).status).toBe("RESOLVED");
    const dong = await dongHold(pw.id);
    expect(dong.map((d) => d.amount)).toEqual([-300_000, -300_000]);
    expect(new Set(dong.map((d) => d.idempotencyKey)).size, "hai dòng, hai khoá khác nhau").toBe(2);
    expect(dong[0]!.idempotencyKey, "thế hệ 0 giữ NGUYÊN khoá cũ (tương thích ngược với sổ đã có)").toBe(`INPUT_CORRECTION|${pw.id}|${dong[0]!.calcSlotId}|SALE|USER|${x.moi.id}`);
    expect(dong.every((d) => d.refEventType === "HOLD" && d.refEventId === pw.id), "dòng vẫn tham chiếu ĐÚNG hàng chờ (thế hệ chỉ nằm trong khoá idempotency)").toBe(true);
  });

  it("[RAL-02] INPUT_DRIFT: B→C→B làm hàng chờ (ô, hash B) RESOLVED bị MỞ LẠI ⇒ áp dụng lần hai ghi dòng MỚI, không DA_AP_DUNG_TRUOC; ròng về đúng Sale B", async () => {
    const x = await khoanThu("ral02");
    const dB = await dungDenB(x);
    expect(await dongHold(dB.id)).toHaveLength(2); // A −300.000 · B +300.000
    await bRoiCRoiVeB(x, dB);
    expect(await reopenCua(dB.id)).toBe(1);
    const dong = await dongHold(dB.id);
    expect(dong).toHaveLength(4); // lần hai: B +300.000 · C −300.000 (hai dòng MỚI, hai khoá MỚI)
    expect(new Set(dong.map((d) => d.idempotencyKey)).size).toBe(4);
    const theoNguoi = new Map<string, number>();
    for (const d of await dongSoCuaKhoan(x.bi)) theoNguoi.set(d.beneficiaryUserId ?? "-", (theoNguoi.get(d.beneficiaryUserId ?? "-") ?? 0) + d.amount);
    expect(theoNguoi.get(x.moi.id)).toBe(300_000);
    expect(theoNguoi.get(x.k.sale.id)).toBe(0);
    expect(theoNguoi.get(x.ba.id)).toBe(0);
  });

  it("[RAL-03] mở lại LẦN HAI ⇒ ba thế hệ, ba khoá khác nhau, ba dòng; khoá thế hệ 1 và 2 mang đúng hậu tố REOPEN của riêng mình", async () => {
    const x = await khoanThu("ral03");
    const dB = await dungDenB(x);
    const pw = await tuChoiRoiQuet(x, true);
    await giai(x, pw.id);
    for (let lan = 1; lan <= 2; lan++) {
      await bRoiCRoiVeB(x, dB);
      await tuChoiRoiQuet(x, false);
      expect(await reopenCua(pw.id)).toBe(lan);
      expect(await giai(x, pw.id)).toMatchObject({ loai: "DA_AP_DUNG", soDong: 1, tong: -300_000 });
      expect(await rongKhoan(x.bi)).toBe(0);
    }
    const dong = await dongHold(pw.id);
    expect(dong).toHaveLength(3);
    const khoa = dong.map((d) => d.idempotencyKey);
    expect(new Set(khoa).size).toBe(3);
    const mocs = (await db.auditLog.findMany({ where: { entityType: "CommissionHold", entityId: pw.id, action: "REOPEN" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map((a) => a.id);
    expect(mocs).toHaveLength(2);
    expect(khoa[1]).toContain(mocs[0]!);
    expect(khoa[2]).toContain(mocs[1]!);
    expect(khoa[1]).not.toContain(mocs[1]!);
  });

  it("[RAL-04] CÙNG THẾ HỆ vẫn idempotent: hàng chờ bị mở lại BẰNG TAY (không thêm dấu REOPEN) khi ròng còn lệch ⇒ khoá TRÙNG khoá thế hệ vừa giải ⇒ DA_AP_DUNG_TRUOC, 0 dòng thêm, hàng chờ còn OPEN", async () => {
    const x = await khoanThu("ral04");
    const dB = await dungDenB(x);
    const pw = await tuChoiRoiQuet(x, true);
    await giai(x, pw.id);
    await bRoiCRoiVeB(x, dB);
    await tuChoiRoiQuet(x, false);
    await giai(x, pw.id); // thế hệ 1 (sau REOPEN #1) đã giải, ròng 0
    await bRoiCRoiVeB(x, dB); // ròng +300.000 về B trở lại
    // Khoản bị từ chối lần nữa nhưng KHÔNG qua lượt quét (không REOPEN mới); hàng chờ bị mở bằng tay: thế hệ KHÔNG đổi ⇒ khoá của lượt giải thế hệ 1 phải còn chặn.
    await db.payment.update({ where: { id: x.bi }, data: { accountantStatus: "REJECTED" } });
    await db.commissionHold.update({ where: { id: pw.id }, data: { status: "OPEN", resolvedAt: null, resolvedById: null, resolutionNote: null } });
    expect(await reopenCua(pw.id)).toBe(1);
    expect(await rongKhoan(x.bi)).toBe(300_000);
    const truoc = (await dongHold(pw.id)).length;
    await expect(giai(x, pw.id)).rejects.toMatchObject({ ma: "DA_AP_DUNG_TRUOC" });
    expect((await dongHold(pw.id)).length).toBe(truoc);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: pw.id } })).status).toBe("OPEN");
    expect(await rongKhoan(x.bi)).toBe(300_000);
  });

  it("[RAL-05] KHOẢN HOÀN bị bác rồi hàng chờ MỞ LẠI ⇒ KHÔNG trả lại hai lần: đường khôi phục hoàn tính từ dòng ĐẢO (không từ ròng) nên khoá cũ là chốt DUY NHẤT — giải lần hai vẫn DA_AP_DUNG_TRUOC, hàng chờ còn OPEN", async () => {
    const x = await khoanThu("ral05");
    const hoan = await hoanTien(x.k, x.bi, { soTien: 4_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, x.bc, hoan);
    await tuChoi(x.k, hoan);
    await quetKhoan(db, x.bc, hoan);
    const hold = await db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: hoan } });
    expect(await giai(x, hold.id)).toMatchObject({ loai: "DA_AP_DUNG", tong: 120_000 });
    // mở lại đúng đường engine (có dấu REOPEN) — như một lượt quét sẽ làm nếu ròng của khoản hoàn còn lệch
    await db.$transaction(async (tx) => {
      await tx.commissionHold.update({ where: { id: hold.id }, data: { status: "RESOLVED" } });
      await ghiHangCho(tx, { holdKey: hold.holdKey, code: hold.code, paymentId: hold.paymentId, orderId: hold.orderId, orderItemId: hold.orderItemId, studentId: hold.studentId, entryId: hold.entryId, calcSlotId: hold.calcSlotId, blockingPeriodId: hold.blockingPeriodId, centerId: hold.centerId, orgUnitId: hold.orgUnitId, detail: hold.detail as Record<string, unknown> }, NOW);
    });
    expect(await reopenCua(hold.id)).toBe(1);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    await expect(giai(x, hold.id)).rejects.toMatchObject({ ma: "DA_AP_DUNG_TRUOC" });
    expect(await db.commissionTransaction.count({ where: { entryKind: "INPUT_CORRECTION", refEventId: hold.id } }), "đúng MỘT dòng trả lại").toBe(1);
  });
});
