// @vitest-environment node
/**
 * [NHH-FLOW-*] / [NHH-POL-04] / [NHH-SRC-11] / [NHH-TRX-*] / [NHH-W5d] — LUỒNG đầu-cuối ở tầng DB:
 *   NGUỒN (quy bằng hàm ghi thật của lib/nguon) → LEAD → PHÂN LOẠI → KHOẢN THU (recordPayment → confirmPayment thật) → SỔ.
 *
 * ⚠️ Tài liệu bộ `docs/source-commission` KHÔNG định nghĩa các "luồng A–F" của chủ dự án; bản dưới đây là DIỄN GIẢI của người viết, ghi rõ để
 * người đọc sửa nếu lệch ý:
 *   A — Facebook Ad (nhóm QUẢNG CÁO) → khách MỚI → HĐ 12tr chia 3 đợt, Sale 3% ⇒ 120.000đ mỗi đợt.
 *   B — Phụ huynh GIỚI THIỆU (hoa hồng thu hút chịu cửa sổ 90 ngày): trong cửa sổ có tiền, ngoài cửa sổ KHÔNG, nguồn giữ nguyên; biên ngày 90/91;
 *       đợt thu sau kế thừa tư cách của LẦN MUA.
 *   C — Nhân sự GIỚI THIỆU (nguồn EMPLOYEE_REFERRAL): người giới thiệu là một nhân viên (Employee → User) nhận hoa hồng thu hút.
 *   D — Khách TỰ ĐẾN / KHÔNG RÕ NGUỒN: mức THẤP NHẤT trong các nhóm, tính động (D7).
 *   F — TÁI TỤC (lần mua thứ hai của cùng học viên) = RENEWAL = 0đ khi chưa có chính sách (D16); con thứ HAI của phụ huynh hiện hữu vẫn là NEW.
 *   (E — Sự kiện/Đối tác: KHÔNG có module/master ở repo — không dựng master giả; Affiliate 0 dòng.)
 *
 * Chạy: `pnpm test:hoa-hong-db`. Mỗi ca tự dựng kịch bản (luật 18); ngày TUYỆT ĐỐI (luật 19) — xem `_kich-ban.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
// Trần thời gian của bộ: mặc định 5s là trần của máy nhanh + DB mới tinh. DB test TÍCH khoản qua các lượt chạy (sổ bất biến không dọn được) và các ca quét toàn hệ
// chậm dần theo đó — đo 08/10: cùng mã, lượt 1 đỏ vì timeout, lượt 2 xanh. Nâng trần ở ĐÚNG bộ này, không phải toàn repo.
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { docViSao, duKienCuaToi } from "../../lib/hoa-hong/doc-so";
import { quetKy } from "../../lib/hoa-hong/quet-ky";
import {
  actorCua,
  boiCanh,
  D,
  datMocCutover,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  ganNguon,
  ganVai,
  hoanTien,
  nguoiKyHo,
  nguoiKyQlcs,
  donKichBan,
  taoChinhSachFx,
  themChinhSachNhom,
  tienVe,
  tomTat,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-FLOW] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2027-02-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-FLOW] luồng nguồn → lead → phân loại → khoản thu → sổ", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await db.leadSourceGroup.updateMany({ where: { code: "WALK_IN" }, data: { commissionEnabled: false } });
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-FLOW-A] Facebook Ad → khách MỚI → HĐ 12tr chia 3 đợt 4tr, Sale 3% ⇒ 120.000đ MỖI đợt (kỳ 10/11/12), nhóm nguồn QUẢNG CÁO chụp lên dòng; quét cả kỳ cũng chỉ 1 dòng/đợt", async () => {
    const k = await kb("flowA", { rules: [{ vai: "SALE", rate: 0.03 }] });
    await ganNguon(k, "PAID_ADS");
    const bc = await boiCanh(k, D("2026-12-20"));
    const be = await dungBe(k, "a", { tongTien: 12_000_000 });
    const dot = [
      await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-10-05") }),
      await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-11-05") }),
      await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-12-05") }),
    ];
    // quét THEO KỲ (đường cron/nút Tính), không gọi từng khoản
    for (const thang of ["2026-10", "2026-11", "2026-12"]) {
      const r = await quetKy(db, bc, { thang, centerId: k.centerId, soThangDoiSoat: 0 });
      expect(r.loi).toEqual([]);
    }
    const dong = (await Promise.all(dot.map(dongSoCuaKhoan))).flat();
    expect(dong).toHaveLength(3);
    expect(dong.map((d) => [d.amount, d.transactionTypeCode, d.sourceGroupCode, d.beneficiaryUserId, d.entryKind])).toEqual([
      [120_000, "NEW", "PAID_ADS", k.sale.id, "ORIGINAL"],
      [120_000, "NEW", "PAID_ADS", k.sale.id, "ORIGINAL"],
      [120_000, "NEW", "PAID_ADS", k.sale.id, "ORIGINAL"],
    ]);
    expect(dong.every((d) => d.attributionId !== null)).toBe(true);
    // quét lại cả ba kỳ: không đẻ thêm gì (idempotent đường kỳ)
    for (const thang of ["2026-10", "2026-11", "2026-12"]) await quetKy(db, bc, { thang, centerId: k.centerId, soThangDoiSoat: 0 });
    expect(await db.commissionTransaction.count({ where: { paymentId: { in: dot } } })).toBe(3);
  });

  it("[NHH-FLOW-B] Phụ huynh GIỚI THIỆU: trong cửa sổ 90 ngày có hoa hồng thu hút; NGOÀI cửa sổ thì KHÔNG nhưng nguồn giữ nguyên; biên ngày 90 (còn) / 91 (hết); đợt sau kế thừa tư cách của LẦN MUA", async () => {
    const k = await kb("flowB", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    const nhom = await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.02 }]);
    // lead được quy nguồn 01/10/2026 (giờ VN). Ngày 90 = 30/12/2026 còn TRONG, ngày 91 = 31/12/2026 NGOÀI.
    await ganNguon(k, "PARENT_REFERRAL", { phHuynhUserId: ph.id, attributedAt: new Date("2026-10-01T03:00:00.000Z") });
    const bc = await boiCanh(k, NOW);

    const trong = await dungBe(k, "trong", { tongTien: 10_000_000 });
    const biên = await tienVe(k, trong, { soTien: 10_000_000, ngay: new Date("2026-12-30T16:59:00.000Z") }); // 23:59 +07 ngày 30/12 = ngày thứ 90
    await quetKhoan(db, bc, biên);
    expect(tomTat(await dongSoCuaKhoan(biên))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT:${ph.id}`]: 200_000 });

    const ngoai = await dungBe(k, "ngoai", { tongTien: 10_000_000 });
    const quaHan = await tienVe(k, ngoai, { soTien: 10_000_000, ngay: new Date("2026-12-30T17:01:00.000Z") }); // 00:01 +07 ngày 31/12 = ngày thứ 91
    await quetKhoan(db, bc, quaHan);
    expect(tomTat(await dongSoCuaKhoan(quaHan))).toEqual({ [`SALE:${k.sale.id}`]: 400_000 }); // KHÔNG có REFERRER_PARENT
    // nguồn KHÔNG đổi (báo cáo nguồn giữ nguyên) và KHÔNG có hàng chờ (luật tất định, không còn gì để người quyết)
    const nguon = await db.lead.findUniqueOrThrow({ where: { id: k.lead!.id }, select: { attribution: { select: { group: { select: { code: true } } } } } });
    expect(nguon.attribution?.group.code).toBe("PARENT_REFERRAL");
    expect(await db.commissionHold.count({ where: { paymentId: quaHan } })).toBe(0);

    // đợt 2 của CÙNG lần mua, trả chậm sau cửa sổ: thừa hưởng tư cách của lần mua (đợt 1 trong cửa sổ)
    const hd = await dungBe(k, "hd", { tongTien: 20_000_000 });
    const dot1 = await tienVe(k, hd, { soTien: 10_000_000, ngay: new Date("2026-12-01T03:00:00.000Z") });
    const dot2 = await tienVe(k, hd, { soTien: 10_000_000, ngay: new Date("2027-02-10T03:00:00.000Z") }); // 132 ngày sau
    await quetKhoan(db, bc, dot1);
    await quetKhoan(db, bc, dot2);
    expect((await dongSoCuaKhoan(dot2)).map((d) => d.roleCode).sort()).toEqual(["REFERRER_PARENT", "SALE"]);
    void nhom;
  });

  // Cấy 08/10 (bỏ `ngoaiCuaSo` khỏi `inputHash`): 0 ca đỏ — KHÔNG ca nào đổi cửa sổ ghi công SAU khi ô đã có dòng thu hút. Cửa sổ là đầu vào TRÔI được (setting `nguon.cuaSoGhiCongNgay`,
  // ngày thu đầu đổi khi khoản đầu bị bác, `attributedAt` đổi khi đổi nguồn có quyền) và hậu quả là tiền: vai thu hút vẫn được trả ngoài cửa sổ mà không ai biết.
  it("[NHH-FLOW-B2] cửa sổ ghi công đổi SAU khi ô đã có dòng thu hút ⇒ lượt quét kế tiếp báo INPUT_DRIFT đòi lại phần thu hút (không trả im lặng ngoài cửa sổ); đối chứng cửa sổ không đổi ⇒ KHONG_DOI", async () => {
    const k = await kb("flowB2", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const ph = await seedUser({ email: `${k.ma}-phgt@ci.test`, role: "PARENT", name: `${k.ma}-phgt`, phone: null });
    await themChinhSachNhom(k, "PARENT_REFERRAL", [{ vai: "REFERRER_PARENT", rate: 0.02 }]);
    await ganNguon(k, "PARENT_REFERRAL", { phHuynhUserId: ph.id, attributedAt: new Date("2026-10-01T03:00:00.000Z") });
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: new Date("2026-12-01T03:00:00.000Z") }); // ngày thứ 61 kể từ 01/10
    await quetKhoan(db, bc, id);
    expect(tomTat(await dongSoCuaKhoan(id))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_PARENT:${ph.id}`]: 200_000 });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "KHONG_DOI" }); // đối chứng: cùng cửa sổ 90 ngày ⇒ không trôi

    const hep = await boiCanh(k, NOW, "2026-10", { cuaSoNgay: 30 }); // ngày thứ 61 nay NGOÀI cửa sổ
    const r = await quetKhoan(db, hep, id);
    expect(r).toMatchObject({ loai: "TROI", lyDo: "LECH_TIEN" });
    expect(r.loai === "TROI" && r.chenh.map((c) => [c.key.split("|")[0], c.chenh])).toEqual([["REFERRER_PARENT", -200_000]]);
    const drift = await db.commissionHold.findMany({ where: { paymentId: id, code: "INPUT_DRIFT" } });
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ severity: "HARD", status: "OPEN" });
    expect(await dongSoCuaKhoan(id)).toHaveLength(2); // sổ KHÔNG tự đổi — người duyệt quyết
  });

  it("[NHH-FLOW-C] Nhân sự GIỚI THIỆU (nguồn EMPLOYEE_REFERRAL): Employee → User nhận hoa hồng thu hút; người giới thiệu nghỉ việc ⇒ hàng chờ NGUOI_HUONG_NGHI, 0 dòng cho họ", async () => {
    const k = await kb("flowC", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const nv = await db.employee.create({ data: { employeeCode: `E${k.ma}`.toUpperCase().slice(0, 20), fullName: `NV GT ${k.ma}`, jobTitle: "Sale", department: "KINH_DOANH", status: "ACTIVE" } });
    const gt = await seedUser({ email: `${k.ma}-nvgt@ci.test`, role: "SALES_CSM", name: `${k.ma}-nvgt`, phone: null });
    await db.user.update({ where: { id: gt.id }, data: { employeeId: nv.id } });
    await themChinhSachNhom(k, "EMPLOYEE_REFERRAL", [{ vai: "REFERRER_EMPLOYEE", rate: 0.01 }]);
    await ganNguon(k, "EMPLOYEE_REFERRAL", { nhanSuEmployeeId: nv.id, attributedAt: new Date("2026-11-01T03:00:00.000Z") });
    const bc = await boiCanh(k, NOW);

    const a = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc, a);
    expect(tomTat(await dongSoCuaKhoan(a))).toEqual({ [`SALE:${k.sale.id}`]: 400_000, [`REFERRER_EMPLOYEE:${gt.id}`]: 100_000 });

    await db.employee.update({ where: { id: nv.id }, data: { status: "RESIGNED" } });
    const b = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2026-11-21") });
    await quetKhoan(db, bc, b);
    expect(tomTat(await dongSoCuaKhoan(b))).toEqual({ [`SALE:${k.sale.id}`]: 400_000 });
    expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: b } })).detail).toMatchObject({ vai: "REFERRER_EMPLOYEE", lyDo: "NGUOI_HUONG_NGHI" });
    // dòng đã ghi TRƯỚC khi nghỉ giữ nguyên
    expect(tomTat(await dongSoCuaKhoan(a))[`REFERRER_EMPLOYEE:${gt.id}`]).toBe(100_000);
  });

  it("[NHH-FLOW-D] Nguồn KHÔNG RÕ (UNKNOWN / chưa quy nguồn) ⇒ mức THẤP NHẤT trong các nhóm, tính ĐỘNG: hạ một nhóm xuống dưới mức cũ ⇒ UNKNOWN theo; nguồn đã biết không bị ảnh hưởng", async () => {
    const walkIn = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "WALK_IN" }, select: { commissionEnabled: true } });
    try {
      const k = await kb("flowD", { rules: [{ vai: "SALE", rate: 0.04 }] });
      // Nguồn động: WALK_IN mặc định `commissionEnabled = false` ⇒ rule riêng của nó BẤT HOẠT và KHÔNG kéo UNKNOWN xuống. Ca này đo đúng cơ chế "mức thấp nhất"
      // nên BẬT cờ cho WALK_IN (trả lại ở `finally` NGAY trong ca — luật 18; afterAll chỉ là lưới dự phòng).
      await db.leadSourceGroup.update({ where: { code: "WALK_IN" }, data: { commissionEnabled: true } });
      await themChinhSachNhom(k, "PAID_ADS", [{ vai: "SALE", rate: 0.03 }]);
      await themChinhSachNhom(k, "WALK_IN", [{ vai: "SALE", rate: 0.05 }]);
      const bc = await boiCanh(k, NOW);

      // chưa quy nguồn (lead cũ trước khi bật nguon.enabled) ⇒ coi là UNKNOWN
      const a = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
      await quetKhoan(db, bc, a);
      const dA = (await dongSoCuaKhoan(a))[0]!;
      expect(dA).toMatchObject({ amount: 300_000, sourceGroupCode: "UNKNOWN", attributionId: null }); // min(GLOBAL 4%, QC 3%, TT 5%, …) = 3%
      expect((dA.candidates as { nguonKhongRo: boolean }).nguonKhongRo).toBe(true);
      expect(dA.reason).toMatch(/UNKNOWN|thấp nhất/i);

      // hạ WALK_IN xuống 2% ⇒ UNKNOWN theo 2%
      await db.commissionRule.updateMany({ where: { version: { policy: { policyCode: `${k.ma}-pol-walk_in` } } }, data: { rate: 0.02 } });
      const bc2 = await boiCanh(k, NOW);
      const b = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2026-11-06") });
      await quetKhoan(db, bc2, b);
      expect((await dongSoCuaKhoan(b))[0]!.amount).toBe(200_000);

      // lead có nguồn ĐÃ BIẾT (QUẢNG CÁO) ⇒ 3% theo nhóm, không bị kéo xuống 2%
      await ganNguon(k, "PAID_ADS");
      const c = await tienVe(k, await dungBe(k, "c"), { soTien: 10_000_000, ngay: D("2026-11-07") });
      await quetKhoan(db, bc2, c);
      expect((await dongSoCuaKhoan(c))[0]).toMatchObject({ amount: 300_000, sourceGroupCode: "PAID_ADS" });
    } finally {
      // trả cờ về ĐÚNG giá trị trước ca (luật 18: ca sau, chạy riêng hay chạy chung, thấy cùng một trạng thái)
      await db.leadSourceGroup.update({ where: { code: "WALK_IN" }, data: { commissionEnabled: walkIn.commissionEnabled } });
    }
  });

  it("[NHH-FLOW-F] TÁI TỤC: lần mua thứ hai của cùng học viên = RENEWAL ⇒ 0đ khi chưa có chính sách (D16): có ô, 0 dòng, không hàng chờ; còn con thứ HAI của phụ huynh hiện hữu vẫn là NEW", async () => {
    const k = await kb("flowF");
    const bc = await boiCanh(k, NOW);
    const be1 = await dungBe(k, "hv1", { ngayDon: D("2026-09-01") });
    const lan1 = await tienVe(k, be1, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await quetKhoan(db, bc, lan1);
    expect((await dongSoCuaKhoan(lan1)).every((d) => d.transactionTypeCode === "NEW")).toBe(true);

    // lần mua thứ HAI của CÙNG học viên: đơn khác, dòng khác ⇒ RENEWAL
    const lan2Be = await dungBe(k, "hv1b", { ngayDon: D("2026-11-01") });
    await db.orderItem.update({ where: { id: lan2Be.orderItemId }, data: { studentId: be1.studentId } });
    const lan2 = await tienVe(k, lan2Be, { soTien: 10_000_000, ngay: D("2026-11-05") });
    const r = await quetKhoan(db, bc, lan2);
    expect(r).toMatchObject({ loai: "DA_GHI", soDong: 0, tong: 0 });
    expect(await dongSoCuaKhoan(lan2)).toEqual([]);
    expect((await db.studentTransaction.findUniqueOrThrow({ where: { orderItemId: lan2Be.orderItemId } })).transactionTypeCode).toBe("RENEWAL");
    expect(await db.commissionCalcSlot.count({ where: { paymentId: lan2 } })).toBe(1); // ô ghi nhận "đã tính, kết quả 0" — thay đổi sau này là INPUT_DRIFT
    expect(await db.commissionHold.count({ where: { paymentId: lan2 } })).toBe(0);

    // con thứ HAI của PH hiện hữu (cùng lead, học viên KHÁC): vẫn NEW, kèm bằng chứng phuHuynhHienHuu
    const be2 = await dungBe(k, "hv2", { ngayDon: D("2026-11-10") });
    const con2 = await tienVe(k, be2, { soTien: 10_000_000, ngay: D("2026-11-12") });
    await quetKhoan(db, bc, con2);
    expect((await dongSoCuaKhoan(con2)).every((d) => d.transactionTypeCode === "NEW")).toBe(true);
    const st = await db.studentTransaction.findUniqueOrThrow({ where: { orderItemId: be2.orderItemId } });
    expect((st.evidence as { phuHuynhHienHuu?: { hienHuu?: boolean } }).phuHuynhHienHuu?.hienHuu).toBe(true);
  });

  it("[NHH-VAT-01] VAT theo NGÀY GỐC của tiền, không theo hôm nay: bảng VAT đổi 0% → 10% từ 01/11/2026; đợt thu 05/10 (trước mốc) cơ sở = đủ gross, đợt thu 05/11 (sau mốc) bỏ VAT; quét ở 20/02/2027 (VAT hôm nay 10%) vẫn giữ nguyên; dòng sổ CHỤP vatRate; hoàn đợt 05/10 vào 10/01/2027 đảo theo VAT của DÒNG GỐC (0%), không phải VAT hôm nay", async () => {
    const k = await kb("vat1", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const bc0 = await boiCanh(k, NOW);
    const bc = { ...bc0, hoaHong: { ...bc0.hoaHong, vatTheoNgay: [{ tuNgay: "2026-11-01", tiLe: 0.1 }] } };
    const be = await dungBe(k, "a", { tongTien: 12_000_000 });
    const truoc = await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-10-05") });
    const sau = await tienVe(k, be, { soTien: 4_400_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, truoc);
    await quetKhoan(db, bc, sau);
    const r = async (id: string) => (await dongSoCuaKhoan(id)).map((d) => [d.grossAmount, Number(d.vatRate), d.netBase, d.amount]);
    expect(await r(truoc)).toEqual([[4_000_000, 0, 4_000_000, 120_000]]); // VAT lúc 05/10 = 0 ⇒ 3% × 4.000.000
    expect(await r(sau)).toEqual([[4_400_000, 0.1, 4_000_000, 120_000]]); // VAT lúc 05/11 = 10% ⇒ 4,4tr bỏ VAT = 4tr ⇒ 3% = 120.000

    const hoan = await hoanTien(k, truoc, { soTien: 2_000_000, ngay: D("2027-01-10") });
    expect((await quetKhoan(db, bc, hoan)).loai).toBe("DA_DAO");
    // cơ sở đảo = 2.000.000 / (1 + 0%) — VAT của DÒNG GỐC; VAT hôm nay (10%) sẽ cho 1.818.182 ⇒ −54.545
    expect((await dongSoCuaKhoan(hoan)).map((d) => [d.amount, d.netBase, Number(d.vatRate)])).toEqual([[-60_000, -2_000_000, 0]]);

    // đối chứng: dòng gốc CÓ VAT 10% — hoàn 2.200.000 (gồm VAT) ⇒ cơ sở đảo 2.000.000 (bỏ VAT bằng vatRate CHỤP trên dòng gốc) ⇒ −60.000;
    // nếu quên bỏ VAT thì ra −66.000 (đảo thừa 10%)
    const hoanSau = await hoanTien(k, sau, { soTien: 2_200_000, ngay: D("2027-01-11") });
    expect((await quetKhoan(db, bc, hoanSau)).loai).toBe("DA_DAO");
    expect((await dongSoCuaKhoan(hoanSau)).map((d) => [d.amount, d.netBase, Number(d.vatRate)])).toEqual([[-60_000, -2_000_000, 0.1]]);
  });

  it("[NHH-POL-V2] version mới của CÙNG chính sách (3% → 4% từ 01/12): đợt thu trước mốc giữ 3% (120.000 + 120.000), đợt sau mốc 4% (160.000); quét lại đợt cũ không đẻ dòng thứ hai; hoàn đợt 2 thu hồi THEO TỈ LỆ GỐC (−120.000, không phải 4%); 'dự kiến' dùng chính sách HÔM NAY; 'Vì sao' đọc từ ảnh chụp", async () => {
    const k = await kb("polv2", { rules: [{ vai: "SALE", rate: 0.03 }] });
    await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    await ganVai(k.saleAdmin.id, k.ouId, "CENTER_SALES_CSM"); // người CÙNG vai nhưng KHÔNG phải người hưởng — đối chứng cho "Vì sao"
    const bc1 = await boiCanh(k, NOW);
    const be = await dungBe(k, "a", { tongTien: 12_000_000 });
    const d1 = await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-10-05") });
    const d2 = await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc1, d1);
    await quetKhoan(db, bc1, d2);

    // v2 hiệu lực 00:00 ngày 01/12 giờ VN; v1 bị đóng tại đúng mốc ấy
    await taoChinhSachFx(k.ma, [{ vai: "SALE", rate: 0.04 }], 2, k.chinhSach.policyId, "2026-11-30T17:00:00.000Z");
    const bc2 = await boiCanh(k, NOW);
    const sale = await actorCua(k.sale.id);

    // "dự kiến" của phần còn lại (4tr) theo chính sách HÔM NAY (v2 4%) — trước khi đợt 3 về
    const dk = await duKienCuaToi(db, bc2, sale, { leadId: k.lead!.id });
    expect(dk.duKienCuaToi.map((x) => [x.roleCode, x.soTien])).toEqual([["SALE", 160_000]]);
    expect(dk.daGhiCuaToi.map((x) => x.amount).sort()).toEqual([120_000, 120_000]);

    const d3 = await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-12-05") });
    await quetKhoan(db, bc2, d3);
    // quét lại hai đợt cũ dưới bối cảnh MỚI: v1 vẫn là bản hiệu lực tại ngày thu của chúng ⇒ không dòng mới, không hàng chờ
    await quetKhoan(db, bc2, d1);
    await quetKhoan(db, bc2, d2);
    const dong = async (id: string) => (await dongSoCuaKhoan(id)).map((d) => [d.amount, d.versionNo, d.entryKind]);
    expect(await dong(d1)).toEqual([[120_000, 1, "ORIGINAL"]]);
    expect(await dong(d2)).toEqual([[120_000, 1, "ORIGINAL"]]);
    expect(await dong(d3)).toEqual([[160_000, 2, "ORIGINAL"]]);
    expect(await db.commissionHold.count({ where: { paymentId: { in: [d1, d2, d3] } } })).toBe(0);
    expect(await db.commissionCalcSlot.count({ where: { paymentId: { in: [d1, d2, d3] } } })).toBe(3);

    // hoàn toàn bộ đợt 2 (tháng 1/2027): thu hồi theo tỉ lệ + người hưởng của dòng GỐC — v2 (4%) không liên quan
    const hoan = await hoanTien(k, d2, { soTien: 4_000_000, ngay: D("2027-01-10") });
    expect((await quetKhoan(db, bc2, hoan)).loai).toBe("DA_DAO");
    const rev = (await dongSoCuaKhoan(hoan))[0]!;
    const goc = (await dongSoCuaKhoan(d2))[0]!;
    expect(rev).toMatchObject({ amount: -120_000, entryKind: "REVERSAL", refEntryId: goc.id, beneficiaryUserId: k.sale.id });

    // "Vì sao": dựng từ ẢNH CHỤP trên dòng; người xem trong tầm thấy, người ngoài tầm nhận null (không lộ tồn tại)
    const chu = (v: { buoc: { nhan: string; giaTri: string }[] }) => v.buoc.map((b) => `${b.nhan}: ${b.giaTri}`).join(" | ");
    const vs3 = (await docViSao(db, sale, (await dongSoCuaKhoan(d3))[0]!.id))!;
    expect(chu(vs3)).toContain("phiên bản 2");
    expect(chu(vs3)).toContain("4.000.000đ × 4% = 160.000đ");
    const vs1 = (await docViSao(db, sale, (await dongSoCuaKhoan(d1))[0]!.id))!;
    expect(chu(vs1)).toContain("phiên bản 1");
    expect(chu(vs1)).toContain("4.000.000đ × 3% = 120.000đ");
    const vsRev = (await docViSao(db, sale, rev.id))!;
    expect(vsRev.tieuDe).toMatch(/Thu hồi/);
    expect(chu(vsRev)).toContain(goc.id);
    expect(chu(vsRev)).toContain("−120.000đ");
    expect(await docViSao(db, await actorCua(k.saleAdmin.id), rev.id)).toBeNull(); // cùng vai nhưng dòng của người khác ⇒ KHÔNG thấy
    expect(await docViSao(db, (await nguoiKyHo()).quyen, rev.id)).not.toBeNull(); // đối chứng dương: Kế toán HO thấy
  });

  // Rà độc lập 08/10: ngăn "Vì sao" in "Tổng tỉ lệ X% ≤ trần" — X là Σ tỉ lệ MỌI vai của khoản (GV Trial trong trần). Sale trừ tỉ lệ của mình ra là biết tổng tỉ lệ các vai khác, nhân với cơ sở tính
  // (cũng hiện) ra tiền của họ — đúng thứ quyết định "Sale chỉ thấy hoa hồng của CHÍNH MÌNH" cấm. Phạm vi dòng đã đúng (null cho dòng người khác); lỗ nằm ở NỘI DUNG của dòng của chính mình.
  it("[NHH-SEC-09] ngăn 'Vì sao' của người chỉ có view-self KHÔNG chứa tổng tỉ lệ các vai; người có tầm nhìn cơ sở / Hội sở vẫn thấy tổng", async () => {
    const k = await kb("sec09", { rules: [{ vai: "SALE", rate: 0.03 }, { vai: "MARKETING", rate: 0.02 }, { vai: "CENTER_MANAGER", rate: 0.01 }] });
    await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM"); // Sale THẬT: chỉ có view-self
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, await boiCanh(k, NOW), id);
    const dong = await dongSoCuaKhoan(id);
    expect(dong.map((d) => [d.roleCode, d.amount]).sort()).toEqual([["CENTER_MANAGER", 100_000], ["MARKETING", 200_000], ["SALE", 300_000]]);
    expect(Number(dong[0]!.equivalentRate)).toBeCloseTo(0.06, 6); // ảnh chụp trên dòng CÓ tổng — chỉ ngăn hiển thị cho Sale được che
    const dongSale = dong.find((d) => d.roleCode === "SALE")!;
    const chu = (v: { buoc: { nhan: string; giaTri: string; ghiChu?: string }[]; canhBao: string[] } | null) => JSON.stringify(v);

    const cuaSale = (await docViSao(db, await actorCua(k.sale.id), dongSale.id))!;
    const buocTran = cuaSale.buoc.find((b) => b.nhan === "Kiểm trần")!;
    expect(buocTran).toBeDefined(); // vẫn có bước trần (nói "trong trần"), chỉ không có tổng
    expect(chu(cuaSale)).not.toMatch(/Tổng tỉ lệ/);
    expect(chu(cuaSale)).not.toMatch(/6%/);
    expect(chu(cuaSale)).not.toMatch(/200.000|100.000/); // tiền của vai khác không xuất hiện ở bất kỳ chỗ nào
    expect(cuaSale.buoc.find((b) => b.nhan === "Công thức")!.giaTri).toContain("3%"); // đối chứng: phần CỦA MÌNH vẫn đầy đủ

    // đối chứng dương: QLCS (tầm nhìn cơ sở) và Kế toán HO thấy tổng
    expect(chu(await docViSao(db, (await nguoiKyQlcs(k)).quyen, dongSale.id))).toMatch(/Tổng tỉ lệ 6%/);
    expect(chu(await docViSao(db, (await nguoiKyHo()).quyen, dongSale.id))).toMatch(/Tổng tỉ lệ 6%/);
  });

  it("[NHH-SEC-09b] QLCS của cơ sở A xem dòng Sale CỦA CHÍNH MÌNH ở cơ sở B (xem được nhờ view-self, ngoài tầm nhìn cơ sở) ⇒ KHÔNG thấy tổng tỉ lệ; đối chứng: cùng người xem dòng của cơ sở MÌNH quản lý ⇒ thấy", async () => {
    const a = await kb("sec09ba", { rules: [{ vai: "SALE", rate: 0.03 }, { vai: "MARKETING", rate: 0.02 }] });
    const b = await kb("sec09bb", { rules: [{ vai: "SALE", rate: 0.03 }, { vai: "MARKETING", rate: 0.02 }] });
    const x = a.qlcs.id;
    const nguoiX = (await nguoiKyQlcs(a)).quyen; // QLCS neo tại A
    await db.lead.update({ where: { id: b.lead!.id }, data: { convertedById: x } }); // ở cơ sở B, X là người hưởng Sale
    const idB = await tienVe(b, await dungBe(b, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, await boiCanh(b, NOW), idB);
    const idA = await tienVe(a, await dungBe(a, "a"), { soTien: 10_000_000, ngay: D("2026-11-06") });
    await quetKhoan(db, await boiCanh(a, NOW), idA);
    const dongX_B = (await dongSoCuaKhoan(idB)).find((d) => d.roleCode === "SALE" && d.beneficiaryUserId === x)!;
    const dongA = (await dongSoCuaKhoan(idA)).find((d) => d.roleCode === "SALE")!;
    const vsB = await docViSao(db, nguoiX, dongX_B.id);
    expect(vsB).not.toBeNull(); // thấy được dòng của chính mình
    expect(JSON.stringify(vsB)).not.toMatch(/Tổng tỉ lệ/);
    expect(JSON.stringify(await docViSao(db, nguoiX, dongA.id))).toMatch(/Tổng tỉ lệ 5%/); // đối chứng dương: dòng thuộc cơ sở mình quản lý
  });

  it("[NHH-POL-04] trần 9% từ cấu hình: Σ 9% qua; Σ 9,01% ⇒ 0 dòng + 0 ô + hàng chờ CỨNG CAP_EXCEEDED (không tự cắt); sửa chính sách rồi Tính lại ⇒ hàng chờ tự đóng và dòng được ghi", async () => {
    const k = await kb("pol04", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }, { vai: "MARKETING", rate: 0.01 }, { vai: "TRIAL_TEACHER", rate: 0.0101 }] });
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "GIU", hangCho: ["CAP_EXCEEDED"] });
    expect(await dongSoCuaKhoan(id)).toEqual([]);
    expect(await db.commissionCalcSlot.count({ where: { paymentId: id } })).toBe(0);
    const h = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id } });
    expect(h).toMatchObject({ code: "CAP_EXCEEDED", severity: "HARD", status: "OPEN" });
    expect((h.detail as { tiLeTuongDuong: number; tran: number }).tran).toBe(0.09);
    expect(h.blockingPeriodId).not.toBeNull();

    // chính sách sửa về đúng 9% (version mới, hiệu lực trước ngày thu) ⇒ Tính lại
    await taoChinhSachFx(k.ma, [{ vai: "SALE", rate: 0.04 }, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }, { vai: "MARKETING", rate: 0.01 }, { vai: "TRIAL_TEACHER", rate: 0.01 }], 2, k.chinhSach.policyId, "2026-05-01T00:00:00.000Z");
    const bc2 = await boiCanh(k, NOW);
    await quetKhoan(db, bc2, id);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: h.id } })).status).toBe("RESOLVED");
    expect((await dongSoCuaKhoan(id)).reduce((s, d) => s + d.amount, 0)).toBe(800_000); // 4 vai (không có GV trial) — trần không cắt ai
  });

  it("[NHH-W3b] trần là CẤU HÌNH chảy vào engine: Σ 9,5% ⇒ CAP_EXCEEDED ở trần mặc định; nâng `crm.commissionMaxTotalRate` lên 10% ⇒ cùng khoản ghi đủ dòng; hạ về mặc định ⇒ khoản MỚI cùng cấu hình lại bị chặn", async () => {
    const KEY = "crm.commissionMaxTotalRate";
    const cu = await db.systemSetting.findUnique({ where: { key: KEY } });
    const dat = (v: number | null) =>
      v === null
        ? db.systemSetting.deleteMany({ where: { key: KEY } })
        : db.systemSetting.upsert({ where: { key: KEY }, create: { key: KEY, valueJson: v, updatedByName: "fx-w3b" }, update: { valueJson: v, updatedByName: "fx-w3b" } });
    const k = await kb("w3b", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }, { vai: "MARKETING", rate: 0.01 }, { vai: "TRIAL_TEACHER", rate: 0.015 }] });
    try {
      await dat(null);
      const a = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
      expect(await quetKhoan(db, await boiCanh(k, NOW), a)).toMatchObject({ loai: "GIU", hangCho: ["CAP_EXCEEDED"] });
      await dat(0.1);
      expect(await quetKhoan(db, await boiCanh(k, NOW), a)).toMatchObject({ loai: "DA_GHI" });
      expect((await dongSoCuaKhoan(a)).reduce((s, d) => s + d.amount, 0)).toBe(800_000); // 4+1+2+1 = 8% (không có GV Trial) — trần chỉ là cổng, không cắt
      // Dòng sổ CHỤP trần đã dùng để duyệt khoản này (setting lúc ghi = 10%), không phải hằng 9%. Cấy 08/10: `capRate` viết cứng 0.09 ⇒ 0 ca đỏ.
      expect([...new Set((await dongSoCuaKhoan(a)).map((d) => Number(d.capRate)))]).toEqual([0.1]);
      expect((await db.commissionHold.findFirstOrThrow({ where: { paymentId: a, code: "CAP_EXCEEDED" } })).status).toBe("RESOLVED");
      await dat(null);
      const b = await tienVe(k, await dungBe(k, "b"), { soTien: 10_000_000, ngay: D("2026-11-06") });
      expect(await quetKhoan(db, await boiCanh(k, NOW), b)).toMatchObject({ loai: "GIU", hangCho: ["CAP_EXCEEDED"] });
    } finally {
      if (cu) await dat(Number(cu.valueJson));
      else await dat(null);
    }
  });

  it("[NHH-POL-04c] GV Trial NẰM TRONG trần: 4 vai Sale 8% + GV Trial 1,01% ⇒ vượt trần dù 4 vai còn lại hợp lệ; đối chứng GV Trial 1% ⇒ qua", async () => {
    const quyTac = (gv: number) => [{ vai: "SALE", rate: 0.04 }, { vai: "SALE_ADMIN", rate: 0.01 }, { vai: "CENTER_MANAGER", rate: 0.02 }, { vai: "MARKETING", rate: 0.01 }, { vai: "TRIAL_TEACHER", rate: gv }];
    const vuot = await kb("pol04b1", { rules: quyTac(0.0101) });
    const idVuot = await tienVe(vuot, await dungBe(vuot, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    expect(await quetKhoan(db, await boiCanh(vuot, NOW), idVuot)).toMatchObject({ loai: "GIU", hangCho: ["CAP_EXCEEDED"] });
    const qua = await kb("pol04b2", { rules: quyTac(0.01) });
    const idQua = await tienVe(qua, await dungBe(qua, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    expect((await quetKhoan(db, await boiCanh(qua, NOW), idQua)).loai).toBe("DA_GHI");
  });

  it("[NHH-W5d] quét lại nhiều lần KHÔNG sửa số trên sổ: mọi dòng sổ (id · số tiền · băm · thời điểm tạo) giữ nguyên", async () => {
    const k = await kb("frd08");
    const bc = await boiCanh(k, NOW);
    const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
    await quetKhoan(db, bc, id);
    const truoc = JSON.stringify((await dongSoCuaKhoan(id)).map((d) => [d.id, d.amount, d.inputHash, d.createdAt.toISOString()]));
    for (let i = 0; i < 3; i++) await quetKhoan(db, bc, id);
    expect(JSON.stringify((await dongSoCuaKhoan(id)).map((d) => [d.id, d.amount, d.inputHash, d.createdAt.toISOString()]))).toBe(truoc);
  });
});
