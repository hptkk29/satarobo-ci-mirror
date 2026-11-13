// @vitest-environment node
/**
 * [PW-01..PW-10] — ĐỀ NGHỊ (cấp 1) của hàng chờ `PAYMENT_WITHDRAWN` / `INPUT_DRIFT` gắn với ẢNH CHỤP, không chỉ với hạn 7 ngày, trên Postgres THẬT.
 *
 * Lỗ đo được (18/10/2026, trước bản vá): đề nghị là một dòng `RELEASE_REQUEST` trong AuditLog, "còn hiệu lực" = đúng `holdKey` + chưa quá 7 ngày. `holdKey` của
 * `PAYMENT_WITHDRAWN` KHÔNG đổi khi hàng chờ được MỞ LẠI (`ghiHangCho` biến RESOLVED → OPEN giữ nguyên khoá), và dòng đề nghị không ghi dấu "đã dùng" ⇒ một đề nghị cũ
 * sống lại sau khi hàng chờ đóng–mở: người thứ hai duyệt trên một tình huống mà người đề nghị CHƯA TỪNG THẤY.
 *
 * Ảnh chụp của một đề nghị = (hàng chờ · `holdKey` · tiền ảnh hưởng · mốc mở-lại lúc lập). Đề nghị cũ hết hiệu lực khi: đã được dùng để đóng hàng chờ (APPLY / DISMISS
 * ghi `batKy.deNghi.auditId`), hàng chờ được mở lại sau nó (dòng `REOPEN`), hoặc tiền ảnh hưởng khác lúc lập.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18). Sổ BẤT BIẾN nên không dọn được bằng xoá. `now` của service = đồng hồ thật (AuditLog.createdAt do Postgres đóng).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { ghiHangCho } from "../../lib/hoa-hong/hang-cho";
import { giaiHangCho } from "../../lib/hoa-hong/giai-hang-cho";
import { deNghiXuLy, docDauVetXuLy, quyetXuLy } from "../../lib/hoa-hong/hang-cho-xu-ly-service";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import type { NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
import { actorCua, boiCanh, D, datMocCutover, donKichBan, donViHoiSo, dongSoCuaKhoan, dungBe, dungKichBan, ganVai, nguoiKyHo, tienVe, tuChoi, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[PW] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const KHOA_NGUONG = "hoaHong.nguongDuyetHaiCap";
const LY_DO = "Đã đối chiếu với kế toán trưởng";
const BANG_CHUNG = "Biên bản đối chiếu 14/10, phiếu PT-2026-1234";

type Nguoi = NguoiThaoTacKy & { userId: string };
let A: Nguoi;
let B: Nguoi;
let C: Nguoi;
const cuaToi: KichBan[] = [];
const kb = async (ten: string) => {
  const k = await dungKichBan(ten, { rules: [{ vai: "SALE", rate: 0.03 }] });
  cuaToi.push(k);
  return k;
};
const datNguong = (n: number | null) =>
  n === null ? db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } }) : db.systemSetting.upsert({ where: { key: KHOA_NGUONG }, update: { valueJson: n }, create: { key: KHOA_NGUONG, valueJson: n } });
const bay = () => new Date();
const demInputCorrection = async (paymentId: string) => (await dongSoCuaKhoan(paymentId)).filter((d) => d.entryKind === "INPUT_CORRECTION").length;

async function nguoiHo(ten: string): Promise<Nguoi> {
  const u = await seedUser({ email: `fx-pw-${ten}-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: `Kế toán HO ${ten}`, phone: null });
  await ganVai(u.id, await donViHoiSo(), "HO_ACCOUNTANT");
  return { userId: u.id, ten: `Kế toán HO ${ten}`, quyen: await actorCua(u.id) };
}

/** Khoản thu 10tr (Sale 3% ⇒ 300.000) bị kế toán từ chối ⇒ PAYMENT_WITHDRAWN. */
async function khoanBiRut(ten: string) {
  const k = await kb(ten);
  const bc = await boiCanh(k, NOW);
  const bi = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
  await quetKhoan(db, bc, bi);
  await tuChoi(k, bi);
  await quetKhoan(db, bc, bi);
  const hold = await db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: bi } });
  return { k, bc, bi, hold };
}

const denghi = (bc: Awaited<ReturnType<typeof boiCanh>>, holdId: string, nguoi: Nguoi, quyetDinh: "AP_DUNG" | "GIU_NGUYEN" = "AP_DUNG") =>
  deNghiXuLy(db, bc, { holdId, quyetDinh, lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi, now: bay() });
const duyet = (bc: Awaited<ReturnType<typeof boiCanh>>, holdId: string, nguoi: Nguoi, tienDaThay = 300_000, quyetDinh: "AP_DUNG" | "GIU_NGUYEN" = "AP_DUNG") =>
  quyetXuLy(db, bc, { holdId, quyetDinh, lyDo: "Đồng ý, số khớp biên bản", bangChung: "Biên bản 14/10 đã kiểm", tienDaThay, nguoi, now: bay() });

/** Kế toán xác nhận lại khoản ⇒ lượt quét TỰ ĐÓNG hàng chờ (RESOLVED, không APPLY) ⇒ bị từ chối lần nữa ⇒ lượt quét MỞ LẠI đúng dòng hàng chờ cũ (cùng `holdKey`). */
async function dongRoiMoLai(x: { k: KichBan; bc: Awaited<ReturnType<typeof boiCanh>>; bi: string; hold: { id: string } }) {
  await db.payment.update({ where: { id: x.bi }, data: { accountantStatus: "CONFIRMED" } });
  await quetKhoan(db, x.bc, x.bi);
  expect((await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } })).status, "đối chứng: lượt quét tự đóng khi khoản quay lại thực thu").toBe("RESOLVED");
  await db.payment.update({ where: { id: x.bi }, data: { accountantStatus: "REJECTED" } });
  await quetKhoan(db, x.bc, x.bi);
  const sau = await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } });
  expect(sau.status, "đối chứng: lượt quét mở lại đúng dòng hàng chờ cũ").toBe("OPEN");
  return sau;
}

describe.skipIf(!RUN_DB_TESTS)("[PW] đề nghị cấp 1 gắn ảnh chụp — PAYMENT_WITHDRAWN", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    A = await nguoiKyHo();
    B = await nguoiHo("b");
    C = await nguoiHo("c");
    await datNguong(100_000); // 300.000 ≥ 100.000 ⇒ hai người
  }, 120_000);
  afterAll(async () => {
    await datNguong(null);
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[PW-01] LẬP ĐỀ NGHỊ: hàng chờ vẫn MỞ, sổ không đổi, một dòng RELEASE_REQUEST mang ảnh chụp (khoá hàng chờ · tiền · mốc mở-lại); lập lại y hệt thì idempotent", async () => {
    const { bc, bi, hold } = await khoanBiRut("pw01");
    expect(await denghi(bc, hold.id, A)).toEqual({ loai: "DA_GHI", tien: 300_000 });
    expect(await denghi(bc, hold.id, A)).toEqual({ loai: "DA_CO_TRUOC" });
    const au = await db.auditLog.findMany({ where: { entityType: "CommissionHold", entityId: hold.id, action: "RELEASE_REQUEST" } });
    expect(au).toHaveLength(1);
    expect(au[0]!.newValues).toMatchObject({ quyetDinh: "AP_DUNG", tien: 300_000, holdKey: hold.holdKey, mocMoLai: null });
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await demInputCorrection(bi)).toBe(0);
  });

  it("[PW-02] NGƯỜI KHÁC duyệt đề nghị còn hiệu lực ⇒ ghi đúng một dòng đảo, hàng chờ RESOLVED, APPLY ghi `batKy.deNghi.auditId` = id dòng đề nghị", async () => {
    const { bc, bi, hold } = await khoanBiRut("pw02");
    await denghi(bc, hold.id, A);
    const dn = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionHold", entityId: hold.id, action: "RELEASE_REQUEST" } });
    const r = await duyet(bc, hold.id, B);
    expect(r).toMatchObject({ loai: "DA_XU_LY", cap: "HAI_CAP", ketQua: { loai: "DA_AP_DUNG", soDong: 1, tong: -300_000 } });
    expect(await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).toMatchObject({ status: "RESOLVED", resolvedById: B.userId });
    const ap = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionHold", entityId: hold.id, action: "APPLY" } });
    expect(ap.newValues).toMatchObject({ batKy: { cap: "HAI_CAP", deNghi: { auditId: dn.id, nguoiId: A.userId, tien: 300_000 } } });
    expect(await demInputCorrection(bi)).toBe(1);
  });

  it("[PW-03] ĐỀ NGHỊ ĐÃ DÙNG KHÔNG DUYỆT LẦN HAI: người thứ ba duyệt sau khi đã đóng ⇒ lỗi; và đề nghị đã dùng KHÔNG còn được tính là 'chờ duyệt' (đọc từ dấu vết)", async () => {
    const { bc, bi, hold } = await khoanBiRut("pw03");
    await denghi(bc, hold.id, A);
    await duyet(bc, hold.id, B);
    await expect(duyet(bc, hold.id, C)).rejects.toMatchObject({ ma: "TRANG_THAI_DA_DOI" });
    expect(await demInputCorrection(bi)).toBe(1);
    const dv = (await docDauVetXuLy(db, [hold.id])).get(hold.id)!;
    expect(dv.deNghi, "đề nghị đã dùng phải mang dấu 'đã dùng'").toMatchObject({ vo: "DA_DUNG" });
  });

  it("[PW-04a] MỞ LẠI VÔ HIỆU ĐỀ NGHỊ CŨ (đường thật): A lập đề nghị → khoản được xác nhận lại, lượt quét tự đóng → bị từ chối lần nữa, lượt quét MỞ LẠI cùng hàng chờ ⇒ B KHÔNG duyệt được bằng đề nghị cũ, 0 dòng ghi, hàng chờ còn OPEN", async () => {
    const x = await khoanBiRut("pw04a");
    await denghi(x.bc, x.hold.id, A);
    await dongRoiMoLai(x);
    await expect(duyet(x.bc, x.hold.id, B)).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
    expect(await demInputCorrection(x.bi)).toBe(0);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } })).status).toBe("OPEN");
    // dấu vết: có một dòng REOPEN ghi việc mở lại
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: x.hold.id, action: "REOPEN" } })).toBe(1);
  });

  it("[PW-04b] ĐỀ NGHỊ ĐÃ DÙNG KHÔNG SỐNG LẠI SAU KHI HÀNG CHỜ BỊ MỞ LẠI: A lập → B duyệt (RESOLVED) → hàng chờ mở lại ⇒ C KHÔNG duyệt được bằng đề nghị đã dùng", async () => {
    const x = await khoanBiRut("pw04b");
    await denghi(x.bc, x.hold.id, A);
    await duyet(x.bc, x.hold.id, B);
    const h = await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } });
    expect(h.status).toBe("RESOLVED");
    // mở lại bằng đúng hàm ghi hàng chờ của engine (cùng `holdKey`)
    await db.$transaction((tx) =>
      ghiHangCho(tx, { holdKey: h.holdKey, code: h.code, paymentId: h.paymentId, orderId: h.orderId, orderItemId: h.orderItemId, studentId: h.studentId, entryId: h.entryId, calcSlotId: h.calcSlotId, blockingPeriodId: h.blockingPeriodId, centerId: h.centerId, orgUnitId: h.orgUnitId, detail: h.detail as Record<string, unknown> }, NOW),
    );
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } })).status).toBe("OPEN");
    await expect(duyet(x.bc, x.hold.id, C)).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
    expect(await demInputCorrection(x.bi)).toBe(1); // chỉ dòng của lượt duyệt đầu
  });

  it("[PW-04c] ĐỀ NGHỊ ĐÃ DÙNG VẪN VÔ HIỆU KỂ CẢ KHI MỞ LẠI KHÔNG ĐỂ DẤU `REOPEN` (hàng chờ mở lại TRƯỚC bản vá, hoặc bằng đường khác): dấu 'đã dùng' của chính lượt đóng là chốt thứ hai", async () => {
    const x = await khoanBiRut("pw04c");
    await denghi(x.bc, x.hold.id, A);
    await duyet(x.bc, x.hold.id, B);
    // mở lại KHÔNG qua `ghiHangCho` (mô phỏng dòng hàng chờ đã mở lại trước khi có dấu REOPEN)
    await db.commissionHold.update({ where: { id: x.hold.id }, data: { status: "OPEN", resolvedAt: null, resolvedById: null, resolutionNote: null } });
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: x.hold.id, action: "REOPEN" } })).toBe(0);
    await expect(duyet(x.bc, x.hold.id, C)).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
    expect(await demInputCorrection(x.bi)).toBe(1);
  });

  it("[PW-05] SAU KHI MỞ LẠI PHẢI CÓ ĐỀ NGHỊ MỚI: A lập lại (không nhận 'đã có'), đề nghị mới có mốc mở-lại, rồi B duyệt ghi được; đề nghị cũ vẫn vô hiệu", async () => {
    const x = await khoanBiRut("pw05");
    await denghi(x.bc, x.hold.id, A);
    await dongRoiMoLai(x);
    expect(await denghi(x.bc, x.hold.id, A), "đề nghị cũ vô hiệu ⇒ lập MỚI, không phải DA_CO_TRUOC").toEqual({ loai: "DA_GHI", tien: 300_000 });
    const hai = await db.auditLog.findMany({ where: { entityType: "CommissionHold", entityId: x.hold.id, action: "RELEASE_REQUEST" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(hai).toHaveLength(2);
    const reopen = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionHold", entityId: x.hold.id, action: "REOPEN" } });
    expect(hai[0]!.newValues).toMatchObject({ mocMoLai: null });
    expect(hai[1]!.newValues).toMatchObject({ mocMoLai: reopen.id });
    const r = await duyet(x.bc, x.hold.id, B);
    expect(r).toMatchObject({ loai: "DA_XU_LY", ketQua: { loai: "DA_AP_DUNG", soDong: 1 } });
    expect(await demInputCorrection(x.bi)).toBe(1);
  });

  it("[PW-06] TIỀN ẢNH HƯỞNG ĐỔI ⇒ ĐỀ NGHỊ VÔ HIỆU (cả hai chiều): lập khi số đo là 1.800.000 (detail), số đo nay là 300.000 ⇒ B nhận TIEN_DA_DOI; 0 dòng; đối chứng dương: số không đổi thì B duyệt được", async () => {
    // đối chứng dương trước: cùng kịch bản, KHÔNG đổi tiền ⇒ duyệt được
    const ok = await khoanBiRut("pw06ok");
    await denghi(ok.bc, ok.hold.id, A);
    expect(await duyet(ok.bc, ok.hold.id, B)).toMatchObject({ loai: "DA_XU_LY" });

    const x = await khoanBiRut("pw06");
    const d = x.hold.detail as { rongTheoNguoi: Record<string, number> };
    const detailLon = { ...d, rongTheoNguoi: Object.fromEntries(Object.entries(d.rongTheoNguoi).map(([k, v]) => [k, v * 6])) };
    await db.commissionHold.update({ where: { id: x.hold.id }, data: { detail: detailLon } });
    expect(await denghi(x.bc, x.hold.id, A)).toEqual({ loai: "DA_GHI", tien: 1_800_000 });
    // số đo GIẢM (về 300.000): trước bản vá đề nghị vẫn dùng được vì chỉ có trần "không được LỚN hơn"
    await db.commissionHold.update({ where: { id: x.hold.id }, data: { detail: x.hold.detail as object } });
    await expect(duyet(x.bc, x.hold.id, B)).rejects.toMatchObject({ ma: "TIEN_DA_DOI" });
    expect(await demInputCorrection(x.bi)).toBe(0);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } })).status).toBe("OPEN");
    // lập lại trên số mới ⇒ ghi đề nghị mới (không nhận 'đã có'), rồi duyệt được
    expect(await denghi(x.bc, x.hold.id, A)).toEqual({ loai: "DA_GHI", tien: 300_000 });
    expect(await duyet(x.bc, x.hold.id, B)).toMatchObject({ loai: "DA_XU_LY" });
  });

  it("[PW-07] TÁCH NHIỆM VẪN NGUYÊN: người lập không tự duyệt (cả đề nghị mới sau khi mở lại); sai chiều bị chặn; đối chứng dương: người khác duyệt được", async () => {
    const x = await khoanBiRut("pw07");
    await denghi(x.bc, x.hold.id, A);
    await expect(duyet(x.bc, x.hold.id, A)).rejects.toMatchObject({ ma: "CUNG_NGUOI" });
    await expect(duyet(x.bc, x.hold.id, B, 0, "GIU_NGUYEN")).rejects.toMatchObject({ ma: "QUYET_DINH_KHAC_DE_NGHI" });
    // sau khi mở lại: B lập đề nghị MỚI ⇒ B không tự duyệt đề nghị của chính mình, A duyệt được
    await dongRoiMoLai(x);
    await denghi(x.bc, x.hold.id, B);
    await expect(duyet(x.bc, x.hold.id, B)).rejects.toMatchObject({ ma: "CUNG_NGUOI" });
    expect(await demInputCorrection(x.bi)).toBe(0);
    expect(await duyet(x.bc, x.hold.id, A)).toMatchObject({ loai: "DA_XU_LY" });
  });

  it("[PW-08] DUYỆT ĐỒNG THỜI: hai người khác nhau cùng duyệt một đề nghị còn hiệu lực ⇒ đúng MỘT lượt thắng, đúng MỘT dòng đảo, một APPLY; người thua nhận TRANG_THAI_DA_DOI", async () => {
    for (let i = 0; i < 3; i++) {
      const x = await khoanBiRut(`pw08-${i}`);
      await denghi(x.bc, x.hold.id, A);
      const kq = await Promise.allSettled([duyet(x.bc, x.hold.id, B), duyet(x.bc, x.hold.id, C)]);
      expect(kq.filter((r) => r.status === "fulfilled").length, `lượt ${i}`).toBe(1);
      const thua = kq.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect((thua.reason as { ma?: string }).ma, `lượt ${i}`).toBe("TRANG_THAI_DA_DOI");
      expect(await demInputCorrection(x.bi), `lượt ${i}`).toBe(1);
      expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: x.hold.id, action: "APPLY" } }), `lượt ${i}`).toBe(1);
    }
  });

  it("[PW-08b] CỔNG TRONG KHOÁ: kể cả khi người gọi đọc đề nghị TRƯỚC khi hàng chờ bị đóng–mở (đọc cũ), `giaiHangCho` tự kiểm lại đề nghị TRONG khoá và từ chối trước phép ghi đầu tiên", async () => {
    const x = await khoanBiRut("pw08b");
    await denghi(x.bc, x.hold.id, A);
    const dn = await db.auditLog.findFirstOrThrow({ where: { entityType: "CommissionHold", entityId: x.hold.id, action: "RELEASE_REQUEST" } });
    await dongRoiMoLai(x); // đề nghị `dn` nay đã cũ
    await expect(
      giaiHangCho(db, x.bc, {
        holdId: x.hold.id,
        quyetDinh: "AP_DUNG",
        lyDo: "Duyệt trên đọc cũ của đề nghị",
        nguoi: B,
        tranTien: 300_000,
        deNghiXacNhan: { auditId: dn.id, tien: 300_000, holdKey: x.hold.holdKey, mocMoLai: null, nguoiId: A.userId },
      }),
    ).rejects.toMatchObject({ ma: "DE_NGHI_HET_HIEU_LUC" });
    expect(await demInputCorrection(x.bi)).toBe(0);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } })).status).toBe("OPEN");
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: x.hold.id, action: "APPLY" } })).toBe(0);
  });

  it("[PW-09] SỔ CÁI BẤT BIẾN: duyệt chỉ THÊM dòng; dòng gốc nguyên vẹn; sửa/xoá dòng sổ trực tiếp bị DB từ chối; đề nghị cũ bị vô hiệu cũng không đụng sổ", async () => {
    const x = await khoanBiRut("pw09");
    const truoc = await dongSoCuaKhoan(x.bi);
    await denghi(x.bc, x.hold.id, A);
    await dongRoiMoLai(x);
    await expect(duyet(x.bc, x.hold.id, B)).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
    expect(await dongSoCuaKhoan(x.bi)).toHaveLength(truoc.length);
    await denghi(x.bc, x.hold.id, A);
    await duyet(x.bc, x.hold.id, B);
    const sau = await dongSoCuaKhoan(x.bi);
    expect(sau).toHaveLength(truoc.length + 1);
    const goc = sau.find((d) => d.id === truoc[0]!.id)!;
    expect(goc).toMatchObject({ amount: truoc[0]!.amount, entryKind: truoc[0]!.entryKind, netBase: truoc[0]!.netBase });
    expect(goc.createdAt.getTime()).toBe(truoc[0]!.createdAt.getTime());
    await expect(db.commissionTransaction.update({ where: { id: goc.id }, data: { amount: 1 } })).rejects.toThrow();
    await expect(db.commissionTransaction.delete({ where: { id: goc.id } })).rejects.toThrow();
  });

  it("[PW-10] KIỂM TOÁN ĐỦ: RELEASE_REQUEST → REOPEN → RELEASE_REQUEST → APPLY, đúng thứ tự; mỗi dòng có người · module · cơ sở; APPLY trỏ đúng đề nghị MỚI (không phải đề nghị cũ)", async () => {
    const x = await khoanBiRut("pw10");
    await denghi(x.bc, x.hold.id, A);
    await dongRoiMoLai(x);
    await denghi(x.bc, x.hold.id, A);
    await duyet(x.bc, x.hold.id, B);
    const au = await db.auditLog.findMany({ where: { entityType: "CommissionHold", entityId: x.hold.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(au.map((r) => r.action)).toEqual(["RELEASE_REQUEST", "REOPEN", "RELEASE_REQUEST", "APPLY"]);
    for (const r of au) {
      expect(r.module).toBe("hoa-hong");
      expect(r.actorName).toBeTruthy();
      expect(r.orgUnitId).toBeTruthy();
    }
    const [, mo, dnMoi, ap] = au;
    expect(mo!.actorId).toBeNull(); // lượt quét của hệ thống
    expect(mo!.newValues).toMatchObject({ status: "OPEN", truoc: "RESOLVED", holdKey: x.hold.holdKey });
    expect(ap!.newValues).toMatchObject({ batKy: { deNghi: { auditId: dnMoi!.id } } });
  });
});
