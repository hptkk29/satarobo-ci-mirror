// @vitest-environment node
/**
 * [SRC-INT-50..59] — BỘ DỮ LIỆU UAT «UAT SOURCE FINAL» (lane C2 · mục 7) trên Postgres THẬT, đi qua ĐÚNG đường mà workflow `seed-test-data.yml` (`uat-nap-ghi`) chạy:
 * `seedTaiKhoan` (tài khoản N1/N2/chỉ-xem, mật khẩu từ UAT_PASSWORD) → `napNguonFinalUat` (lead đại diện nguồn · nguồn tuỳ biến · hàng chờ do ENGINE thật sinh ra).
 *
 *   [SRC-INT-50] dry-run KHÔNG ghi gì (đếm rộng), báo SE_TAO cho mọi mục; apply lần hai báo DA_CO hết
 *   [SRC-INT-51] engine TẮT / chưa có mốc / chưa có chính sách ⇒ phần hàng chờ báo THIEU đúng lý do và KHÔNG ghi dòng sổ nào, KHÔNG tự bật cờ / đặt mốc / kích hoạt chính sách; phần lead vẫn nạp đủ
 *   [SRC-INT-52] năm lead mới quy nguồn đúng nhóm + phương thức + người giới thiệu (chụp lúc ghi nhận); nguồn tuỳ biến có chủ; lead OTHER có giải trình
 *   [SRC-INT-53] ba lead nhãn cũ KHÔNG có quy nguồn (mồi cho vét lead cũ), nhãn nằm trong bảng 28 nhãn; mốc đã đặt thì không tạo thêm lead chưa quy nguồn
 *   [SRC-INT-54] ba tài khoản qua seed THẬT: N1/N2 giữ commission_periods:manage CHỈ tại CS1 (không ở CS2); tài khoản chỉ-xem không giữ; N1 ≠ N2
 *   [SRC-INT-55] có đủ hai hàng chờ OPEN do engine dựng (INPUT_DRIFT · PAYMENT_WITHDRAWN), mỗi hàng trên đúng khoản thu của nó, kỳ T+3
 *   [SRC-INT-56] sổ hoa hồng của hai khoản chỉ do ENGINE ghi (kind ORIGINAL, có ô tính) và BẤT BIẾN (UPDATE / DELETE bị trigger chặn)
 *   [SRC-INT-57] chạy nạp lần hai KHÔNG sinh thêm lead / đơn / khoản thu / dòng sổ / hàng chờ / quy nguồn nào
 *   [SRC-INT-58] bốn mắt THẬT trên hàng chờ INPUT_DRIFT: N1 đề nghị, N2 quyết ⇒ ghi điều chỉnh; N1 tự quyết bị chặn; người chỉ-xem bị từ chối; N1/N2 không phải người hưởng
 *   [SRC-INT-59] hai hàng chờ tạo ở kỳ KHÁC kỳ của bộ S02–S10B (T..T+2) ⇒ không đổi số «quét N khoản» của checklist 09
 *
 * LUẬT 18: toàn bộ luồng ở `beforeAll`, ca chỉ đọc kết quả. LUẬT 19: `NOW` tuyệt đối. Chạy: `pnpm test:hoa-hong-db` (DB trống đã `migrate deploy` + `seed-roles`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { resolveActorUncached } from "../../lib/auth/actor";
import { coQuyenTaiCoSo } from "../../lib/auth/quyen-tai-co-so";
import { dungBoiCanhQuet } from "../../lib/hoa-hong/boi-canh";
import { deNghiXuLy, quyetXuLy, xemTruocXuLy } from "../../lib/hoa-hong/hang-cho-xu-ly-service";
import { HOC_PHI_NGUON_FINAL, KHOA_XU_LY_HANG_CHO, KICH_BAN_HANG_CHO, LEAD_CU, LEAD_MOI, MA_NGUON_FINAL, NGUON_TUY_BIEN, TIEN_TO_NGUON_FINAL, EMAIL_NGUON_FINAL, ghiChuKhoanHangCho, kyCuaHangCho, phoneLeadCu, phoneLeadMoi } from "../../lib/uat/nguon-final";
import { napNguonFinalUat, type KetQuaNapNf } from "../../lib/uat/nguon-final-db";
import { EMAIL_UAT } from "../../lib/uat/kich-ban-hoa-hong";
import { anhXaNhanCu, chuanHoaNhanNguon } from "../../lib/nguon/anh-xa-nhan-cu";
import { clearSettingsCache } from "../../lib/settings/service";
import { seedTaiKhoan } from "../../prisma/seed-uat/00-tai-khoan";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { D, SEED_V1, datMocCutover, donSoCai, taoChinhSachFx } from "./_kich-ban";
import { baoDamNguoiPhuTrach, datLaiChuNguon, donNguoiPhuTrach, lamSachChinhSach } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[SRC-INT-5x] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

/** "Hôm nay" của lượt nạp: 20/10/2026 — TRƯỚC tháng cutover. */
const NOW = D("2026-10-20");
const KY_T = "2026-11";
const NHAN = "fx-src-int5";
const HAU_TO_CS = "srcint5";
const NGUONG = "hoaHong.nguongDuyetHaiCap";

const TAT_CA_EMAIL = [...Object.values(EMAIL_UAT), ...Object.values(EMAIL_NGUON_FINAL)];

const dem = async () => {
  const khoan = (await db.payment.findMany({ where: { note: { startsWith: `${MA_NGUON_FINAL}:` } }, select: { id: true } })).map((p) => p.id);
  const lead = (await db.lead.findMany({ where: { parentName: { startsWith: TIEN_TO_NGUON_FINAL } }, select: { id: true } })).map((l) => l.id);
  return {
    lead: lead.length,
    quyNguon: await db.leadAttribution.count({ where: { leadId: { in: lead } } }),
    don: await db.order.count({ where: { code: { startsWith: MA_NGUON_FINAL } } }),
    khoan: khoan.length,
    hocVien: await db.student.count({ where: { id: { startsWith: MA_NGUON_FINAL } } }),
    khoa: await db.course.count({ where: { id: { startsWith: MA_NGUON_FINAL } } }),
    nguonTuyBien: await db.leadSourceGroup.count({ where: { code: NGUON_TUY_BIEN.code } }),
    dongSo: await db.commissionTransaction.count({ where: { paymentId: { in: khoan } } }),
    hangCho: await db.commissionHold.count({ where: { paymentId: { in: khoan } } }),
    o: await db.commissionCalcSlot.count({ where: { paymentId: { in: khoan } } }),
  };
};
type Dem = Awaited<ReturnType<typeof dem>>;
const TRONG: Dem = { lead: 0, quyNguon: 0, don: 0, khoan: 0, hocVien: 0, khoa: 0, nguonTuyBien: 0, dongSo: 0, hangCho: 0, o: 0 };

async function don(): Promise<void> {
  await donSoCai();
  const khoan = (await db.payment.findMany({ where: { note: { startsWith: `${MA_NGUON_FINAL}:` } }, select: { id: true } })).map((p) => p.id);
  await db.receipt.deleteMany({ where: { paymentId: { in: khoan } } });
  await db.payment.deleteMany({ where: { id: { in: khoan } } });
  const donIds = (await db.order.findMany({ where: { code: { startsWith: MA_NGUON_FINAL } }, select: { id: true } })).map((o) => o.id);
  await db.orderItem.deleteMany({ where: { orderId: { in: donIds } } });
  await db.order.deleteMany({ where: { id: { in: donIds } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: MA_NGUON_FINAL } } });
  const lead = (await db.lead.findMany({ where: { parentName: { startsWith: TIEN_TO_NGUON_FINAL } }, select: { id: true } })).map((l) => l.id);
  await db.leadTouchpoint.deleteMany({ where: { leadId: { in: lead } } });
  await db.leadAttribution.deleteMany({ where: { leadId: { in: lead } } });
  await db.student.deleteMany({ where: { id: { startsWith: MA_NGUON_FINAL } } });
  await db.class.deleteMany({ where: { id: { startsWith: MA_NGUON_FINAL } } });
  await db.course.deleteMany({ where: { id: { startsWith: MA_NGUON_FINAL } } });
  await db.leadChild.deleteMany({ where: { leadId: { in: lead } } });
  await db.lead.deleteMany({ where: { id: { in: lead } } });
  // Lịch sử chủ nguồn bất biến (trigger chặn DELETE theo dòng): nguồn tuỳ biến vừa tạo có một dòng — TRUNCATE không chạy trigger theo dòng (DB test).
  await db.$executeRaw`TRUNCATE "LeadSourceOwnerPeriod"`;
  const nguon = (await db.leadSourceGroup.findMany({ where: { code: NGUON_TUY_BIEN.code }, select: { id: true } })).map((g) => g.id);
  await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", entityId: { in: nguon } } });
  await db.leadSourceGroup.deleteMany({ where: { code: NGUON_TUY_BIEN.code } });
  // Chính sách chung của ca: sổ đã TRUNCATE ở đầu hàm nên xoá được (FK Restrict từ sổ không còn) — không xoá thì lượt chạy sau đụng `documentCode` unique của văn bản.
  const phienBan = await db.commissionPolicyVersion.findMany({ where: { policy: { policyCode: { startsWith: HAU_TO_CS } } }, select: { id: true, documentId: true } });
  await db.commissionPolicyVersion.deleteMany({ where: { id: { in: phienBan.map((v) => v.id) } } }); // quy tắc xoá theo (Cascade)
  await db.commissionPolicy.deleteMany({ where: { policyCode: { startsWith: HAU_TO_CS } } });
  await db.regulationDocument.deleteMany({ where: { id: { in: phienBan.map((v) => v.documentId).filter((x): x is string => !!x) } } });
  await donNguoiPhuTrach(NHAN);
}

async function xoaMemTaiKhoan(): Promise<void> {
  const ids = (await db.user.findMany({ where: { email: { in: TAT_CA_EMAIL } }, select: { id: true } })).map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.user.updateMany({ where: { email: { in: TAT_CA_EMAIL } }, data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") } });
}

const datCo = async (khoa: string, v: unknown | null) => {
  if (v === null) await db.systemSetting.deleteMany({ where: { key: khoa } });
  else await db.systemSetting.upsert({ where: { key: khoa }, update: { valueJson: v as never }, create: { key: khoa, valueJson: v as never } });
  clearSettingsCache();
};
const datNguong = (n: number | null) => datCo(NGUONG, n);

const trangThaiNhom = (r: KetQuaNapNf, nhom: string) => r.muc.filter((m) => m.nhom === nhom).map((m) => m.trangThai);
const ghiChuNhom = (r: KetQuaNapNf, nhom: string) => r.muc.filter((m) => m.nhom === nhom).map((m) => m.ghiChu ?? "").join(" | ");

let demTrongRong: Dem;
let demSauDryRun: Dem;
let demSauTat: Dem;
let demSauMoc: Dem;
let demSauChinhSach: Dem;
let demSauLan1: Dem;
let demSauLan2: Dem;
let dryRun: KetQuaNapNf;
let lanEngineTat: KetQuaNapNf;
let lanChuaMoc: KetQuaNapNf;
let lanChuaChinhSach: KetQuaNapNf;
let lanDay: KetQuaNapNf;
let lanHai: KetQuaNapNf;
let dryRunSau: KetQuaNapNf;
let cs1Id = "";
let cs2Id = "";
const ketQua58: { cap: string; lyDo: string; xemCuaNguoiXem: string; tuQuyetBiChan: string; daGhi: number; tienGhi: number; hold: string } = { cap: "", lyDo: "", xemCuaNguoiXem: "", tuQuyetBiChan: "", daGhi: 0, tienGhi: 0, hold: "" };
const nguoiHuong58 = new Set<string | null>();

describe.skipIf(!RUN_DB_TESTS)("[SRC-INT-5x] UAT SOURCE FINAL — bộ nạp dữ liệu UAT cho lane UAT sau", () => {
  beforeAll(async () => {
    assertTestDb();
    process.env.UAT_PASSWORD = "ci-uat-source-final-pass"; // mật khẩu THỬ, chỉ tồn tại trong tiến trình test — seed tài khoản đòi biến này (không còn mật khẩu mặc định trong mã)
    await don();
    await xoaMemTaiKhoan();
    await db.systemSetting.deleteMany({ where: { key: { in: ["hoaHong.kyCutover", "hoaHong.engineBat", "nguon.cuaSoGhiCongNgay", "hoaHong.vatTheoNgay"] } } });
    await datNguong(null);
    await donSoCai();
    await lamSachChinhSach();
    await damBaoToChuc({ donVi: ["HO", "CS1", "CS2"], vai: ["SUPER_ADMIN", "CENTER_SALES_CSM", "HO_ACCOUNTANT", "CENTER_ACCOUNTANT", "CENTER_MANAGER", "HO_SALE", "HO_MARKETING", "TEACHER", "TRAINING", "HO_HR", "CENTER_CLASS_MANAGER"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await datLaiChuNguon({ code: "PAID_ADS" });
    cs1Id = (await db.center.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } })).id;
    cs2Id = (await db.center.findFirstOrThrow({ where: { code: "CS2" }, select: { id: true } })).id;

    // Tài khoản qua seed THẬT (bộ seed UAT 15 tài khoản, mật khẩu từ UAT_PASSWORD) — đúng thứ nút `tai-khoan-thieu-ghi` / `db:seed:uat` chạy.
    await seedTaiKhoan("TAT_CA");
    await baoDamNguoiPhuTrach(NHAN); // QL_TT + QC của mọi cơ sở (engine cần người hưởng QLCS/Marketing)

    // ── Lượt 0: dry-run trên DB trống ────────────────────────────────────────────────────────────────────
    demTrongRong = await dem();
    dryRun = await napNguonFinalUat({ apply: false, now: NOW });
    demSauDryRun = await dem();

    // ── Lượt 1: engine TẮT, chưa có mốc, chưa có chính sách ──────────────────────────────────────────────
    lanEngineTat = await napNguonFinalUat({ apply: true, now: NOW });
    demSauTat = await dem();
    // ── Lượt 2: engine BẬT nhưng CHƯA có mốc ─────────────────────────────────────────────────────────────
    await datCo("hoaHong.engineBat", true);
    lanChuaMoc = await napNguonFinalUat({ apply: true, now: NOW });
    demSauMoc = await dem();
    // ── Lượt 3: có mốc, CHƯA có chính sách ACTIVE ────────────────────────────────────────────────────────
    await datMocCutover(KY_T);
    clearSettingsCache();
    lanChuaChinhSach = await napNguonFinalUat({ apply: true, now: NOW });
    demSauChinhSach = await dem();
    // ── Lượt 4: đủ điều kiện (chính sách chung SR.QD.208 ACTIVE) ⇒ engine dựng hai hàng chờ ──────────────
    await taoChinhSachFx(HAU_TO_CS, SEED_V1);
    clearSettingsCache();
    lanDay = await napNguonFinalUat({ apply: true, now: NOW });
    demSauLan1 = await dem();
    // ── Lượt 5: nạp lại ⇒ không sinh gì thêm ─────────────────────────────────────────────────────────────
    lanHai = await napNguonFinalUat({ apply: true, now: NOW });
    demSauLan2 = await dem();
    dryRunSau = await napNguonFinalUat({ apply: false, now: NOW });

    // ── Bốn mắt THẬT trên hàng chờ INPUT_DRIFT bằng N1 / N2 của seed ─────────────────────────────────────
    const bcKq = await dungBoiCanhQuet(db, NOW);
    if (bcKq.loai !== "BAT") throw new Error("bối cảnh quét phải BẬT ở bước này");
    const bc = bcKq.bc;
    const user = async (email: string) => db.user.findFirstOrThrow({ where: { email }, select: { id: true, name: true } });
    const [u1, u2, uxem] = await Promise.all([user(EMAIL_NGUON_FINAL.duyet1), user(EMAIL_NGUON_FINAL.duyet2), user(EMAIL_NGUON_FINAL.xem)]);
    const nguoi = async (u: { id: string; name: string | null }) => ({ userId: u.id, ten: u.name ?? "?", quyen: await resolveActorUncached(u.id) });
    const [n1, n2, xem] = await Promise.all([nguoi(u1), nguoi(u2), nguoi(uxem)]);
    const khoanDrift = await db.payment.findFirstOrThrow({ where: { note: ghiChuKhoanHangCho("DRIFT") }, select: { id: true } });
    const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: khoanDrift.id, code: "INPUT_DRIFT" }, select: { id: true } });
    ketQua58.hold = hold.id;
    for (const d of await db.commissionTransaction.findMany({ where: { paymentId: khoanDrift.id }, select: { beneficiaryUserId: true } })) nguoiHuong58.add(d.beneficiaryUserId);
    await datNguong(100_000); // thấp hơn tổng chênh (800.000) ⇒ buộc hai cấp
    const xemTruoc = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: n1, now: NOW });
    ketQua58.cap = xemTruoc.cap;
    ketQua58.lyDo = xemTruoc.lyDoCap;
    try {
      await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: xem, now: NOW });
      ketQua58.xemCuaNguoiXem = "QUA (SAI)";
    } catch (e) {
      ketQua58.xemCuaNguoiXem = e instanceof Error ? e.message : String(e);
    }
    const lyDo = "Đã đối chiếu với kế toán trưởng";
    const bangChung = "Biên bản đối chiếu UAT SOURCE FINAL";
    await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo, bangChung, nguoi: n1, now: NOW });
    try {
      await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo, bangChung, tienDaThay: xemTruoc.tien ?? 0, nguoi: n1, now: NOW });
      ketQua58.tuQuyetBiChan = "QUA (SAI)";
    } catch (e) {
      ketQua58.tuQuyetBiChan = e instanceof Error ? e.message : String(e);
    }
    const r = await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Đồng ý, số khớp biên bản", bangChung: "Biên bản UAT SOURCE FINAL đã kiểm", tienDaThay: xemTruoc.tien ?? 0, nguoi: n2, now: NOW });
    expect(r).toMatchObject({ loai: "DA_XU_LY", cap: "HAI_CAP" });
    const ghi = await db.commissionTransaction.findMany({ where: { paymentId: khoanDrift.id, entryKind: "INPUT_CORRECTION" }, select: { amount: true } });
    ketQua58.daGhi = ghi.length;
    ketQua58.tienGhi = ghi.reduce((t, d) => t + Math.abs(d.amount), 0);
    await datNguong(null);
  }, 600_000);

  afterAll(async () => {
    await don();
    await xoaMemTaiKhoan();

    await db.systemSetting.deleteMany({ where: { key: { in: ["hoaHong.engineBat", "hoaHong.kyCutover"] } } });
    await datCoNguon({});
    await damBaoDanhMucGoc(db);
    clearSettingsCache();
  }, 120_000);

  it("[SRC-INT-50] dry-run trên DB trống KHÔNG ghi gì (đếm rộng) và báo SE_TAO cho mọi mục; sau khi nạp đủ, dry-run không còn SE_TAO nào", () => {
    expect(demTrongRong).toEqual(TRONG);
    expect(demSauDryRun, "dry-run không được ghi").toEqual(TRONG);
    for (const nhom of ["Nguồn tuỳ biến", "Lead mới", "Lead nhãn cũ"]) expect(new Set(trangThaiNhom(dryRun, nhom)), nhom).toEqual(new Set(["SE_TAO"]));
    expect(trangThaiNhom(dryRun, "Lead mới")).toHaveLength(LEAD_MOI.length);
    expect(trangThaiNhom(dryRun, "Lead nhãn cũ")).toHaveLength(LEAD_CU.length);
    // dry-run sau khi đã nạp đủ: không mục nào còn "sẽ tạo"
    expect(dryRunSau.muc.filter((m) => m.trangThai === "SE_TAO")).toEqual([]);
  });

  it("[SRC-INT-51] engine tắt / chưa mốc / chưa chính sách ⇒ hàng chờ THIEU đúng lý do, 0 dòng sổ, không tự bật gì; lead vẫn nạp đủ; đối chứng dương: đủ điều kiện thì hàng chờ ra thật", async () => {
    expect(ghiChuNhom(lanEngineTat, "Hàng chờ")).toContain("engine hoa hồng đang TẮT");
    expect(ghiChuNhom(lanChuaMoc, "Hàng chờ")).toContain("chưa đặt mốc cutover");
    expect(ghiChuNhom(lanChuaChinhSach, "Hàng chờ")).toContain("chưa có chính sách hoa hồng ACTIVE");
    for (const r of [lanEngineTat, lanChuaMoc, lanChuaChinhSach]) expect(new Set(trangThaiNhom(r, "Hàng chờ"))).toEqual(new Set(["THIEU"]));
    for (const d of [demSauTat, demSauMoc, demSauChinhSach]) {
      expect(d.dongSo, "chưa đủ điều kiện ⇒ không dòng sổ nào").toBe(0);
      expect(d.hangCho).toBe(0);
      expect(d.don, "không dựng đơn hàng chờ khi chưa chạy được engine").toBe(0);
      expect(d.lead).toBe(LEAD_MOI.length + 1 /* lead gốc của phụ huynh */ + LEAD_CU.length);
    }
    // bộ nạp không tự bật / đặt / kích hoạt: cờ và mốc là của người dựng ca; chính sách do ca tạo
    expect(await db.commissionPolicyVersion.count({ where: { status: "ACTIVE", policy: { policyCode: { not: { startsWith: HAU_TO_CS } } } } })).toBe(0);
    // đối chứng dương
    expect(new Set(trangThaiNhom(lanDay, "Hàng chờ"))).toEqual(new Set(["DA_TAO"]));
  });

  it("[SRC-INT-52] năm lead mới quy nguồn đúng nhóm · phương thức · người giới thiệu; nguồn tuỳ biến có chủ + cửa sổ; lead OTHER có giải trình", async () => {
    const nguoi = async (email: string) => db.user.findFirstOrThrow({ where: { email, deletedAt: null }, select: { id: true, employeeId: true } });
    const [sale2, sale3, marketing] = await Promise.all([nguoi(EMAIL_UAT.sale2), nguoi(EMAIL_UAT.sale3), nguoi(EMAIL_UAT.marketing)]);
    for (const lm of LEAD_MOI) {
      const l = await db.lead.findFirstOrThrow({ where: { phone: phoneLeadMoi(lm.ma), deletedAt: null }, select: { attribution: { include: { group: { select: { code: true } } } } } });
      expect(l.attribution?.group.code, `nhóm của ${lm.ma}`).toBe(lm.nhom);
    }
    const at = async (ma: (typeof LEAD_MOI)[number]["ma"]) =>
      (await db.lead.findFirstOrThrow({ where: { phone: phoneLeadMoi(ma), deletedAt: null }, select: { attribution: true } })).attribution!;
    expect((await at("PAID_ADS")).identificationMethod).toBe("AD_FORM_CAMPAIGN");
    expect(await at("PARENT_REFERRAL")).toMatchObject({ identificationMethod: "PARENT_REFERRAL", referrerKind: "PARENT", referrerSaleUserId: sale3.id });
    expect(await at("EMPLOYEE_REFERRAL")).toMatchObject({ identificationMethod: "EMPLOYEE_REFERRAL", referrerKind: "EMPLOYEE", referrerEmployeeId: sale2.employeeId });
    expect((await at("OTHER")).otherSourceNote ?? "").toContain(TIEN_TO_NGUON_FINAL);
    const nguon = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: NGUON_TUY_BIEN.code } });
    expect(nguon).toMatchObject({ ownerEmployeeId: marketing.employeeId, status: "ACTIVE", selectable: true, attributionWindowDays: NGUON_TUY_BIEN.cuaSoNgay, isSystem: false });
    expect(nguon.name.startsWith(TIEN_TO_NGUON_FINAL)).toBe(true);
  });

  it("[SRC-INT-53] ba lead nhãn cũ: CHƯA có quy nguồn, nhãn hợp lệ (không INVALID), đúng lớp AUTO · MANUAL_REVIEW · OTHER; mốc đã đặt ⇒ không tạo thêm lead chưa quy nguồn", async () => {
    for (const lc of LEAD_CU) {
      const l = await db.lead.findFirstOrThrow({ where: { phone: phoneLeadCu(lc.ma), deletedAt: null }, select: { id: true, source: true, createdAt: true, attribution: { select: { id: true } } } });
      expect(l.source).toBe(lc.nhan);
      expect(l.attribution, `lead nhãn cũ ${lc.ma} phải CHƯA có quy nguồn`).toBeNull();
      expect(l.createdAt.toISOString()).toBe(lc.taoLuc.toISOString());
      const kq = anhXaNhanCu({ nhan: l.source, createdAt: l.createdAt, affiliate: null, nguoiNhap: null, maNvTrongNote: null }, [], "EMPLOYEE_REFERRAL");
      expect(kq.loai, `nhãn «${lc.nhan}» phải nằm trong bảng 28 nhãn`).not.toBe("INVALID");
      expect(chuanHoaNhanNguon(lc.nhan)).not.toBeNull();
      if (kq.loai === "INVALID") continue;
      if (lc.ma === "AUTO") expect(kq.xemTay).toEqual([]);
      if (lc.ma === "MANUAL_REVIEW") expect(kq.xemTay).toContain("THIEU_NGUOI");
      if (lc.ma === "OTHER") {
        expect(kq.nhom).toBe("OTHER");
        expect(kq.xemTay).toContain("NHAN_CHOT_THEO_PHIEU");
      }
    }
    // Mốc cutover đã đặt: xoá một lead cũ rồi nạp lại ⇒ KHÔNG tạo lại (BO_QUA), vì vét lead cũ đã qua.
    await db.lead.deleteMany({ where: { phone: phoneLeadCu("AUTO") } });
    const sau = await napNguonFinalUat({ apply: true, now: NOW });
    expect(sau.muc.find((m) => m.nhom === "Lead nhãn cũ" && m.ma === "AUTO")?.trangThai).toBe("BO_QUA");
    expect(await db.lead.count({ where: { phone: phoneLeadCu("AUTO") } })).toBe(0);
  });

  it("[SRC-INT-54] ba tài khoản qua seed THẬT: N1/N2 giữ commission_periods:manage tại CS1 và KHÔNG tại CS2; chỉ-xem không giữ; N1 ≠ N2; không ai là SUPER_ADMIN", async () => {
    const actorCua = async (email: string) => resolveActorUncached((await db.user.findFirstOrThrow({ where: { email, deletedAt: null }, select: { id: true } })).id);
    const [n1, n2, xem] = await Promise.all([actorCua(EMAIL_NGUON_FINAL.duyet1), actorCua(EMAIL_NGUON_FINAL.duyet2), actorCua(EMAIL_NGUON_FINAL.xem)]);
    expect(n1.userId).not.toBe(n2.userId);
    for (const [ten, a] of [["N1", n1], ["N2", n2]] as const) {
      expect(a.isSuperAdmin, ten).toBe(false);
      expect(coQuyenTaiCoSo(a, KHOA_XU_LY_HANG_CHO, cs1Id), `${ten} tại CS1`).toBe(true);
      expect(coQuyenTaiCoSo(a, KHOA_XU_LY_HANG_CHO, cs2Id), `${ten} tại CS2 phải KHÔNG`).toBe(false);
      expect(a.isHoLevel, `${ten} không được thành cross-center`).toBe(false);
    }
    expect(xem.isSuperAdmin).toBe(false);
    expect(coQuyenTaiCoSo(xem, KHOA_XU_LY_HANG_CHO, cs1Id), "chỉ-xem tại CS1").toBe(false);
    expect(xem.permissions.some((p) => p.action === "commission:view-center"), "đối chứng dương: chỉ-xem THẤY sổ cơ sở").toBe(true);
    // mật khẩu băm từ UAT_PASSWORD (không phải chuỗi thô, không rỗng)
    const u = await db.user.findFirstOrThrow({ where: { email: EMAIL_NGUON_FINAL.duyet1 }, select: { password: true } });
    expect(u.password).toMatch(/^\$2[aby]\$/);
    expect(u.password).not.toContain("ci-uat-source-final-pass");
  });

  it("[SRC-INT-55] có ĐỦ hai hàng chờ do engine dựng — INPUT_DRIFT và PAYMENT_WITHDRAWN — mỗi hàng trên khoản thu của nó, ở kỳ T+3, bản ghi thật trong CommissionHold", async () => {
    for (const kb of KICH_BAN_HANG_CHO) {
      const khoan = await db.payment.findFirstOrThrow({ where: { note: ghiChuKhoanHangCho(kb.ma) }, select: { id: true, amount: true, paidDate: true } });
      expect(khoan.amount).toBe(HOC_PHI_NGUON_FINAL);
      expect(khoan.paidDate.toISOString().slice(0, 7), `kỳ của khoản ${kb.ma}`).toBe(kyCuaHangCho(KY_T));
      const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: khoan.id, code: kb.maHold }, select: { status: true, centerId: true } });
      // INPUT_DRIFT còn OPEN trước khi ca 58 xử lý: đọc ở ca này là SAU beforeAll ⇒ INPUT_DRIFT đã RESOLVED bởi bốn mắt; PAYMENT_WITHDRAWN vẫn OPEN.
      if (kb.ma === "WITHDRAWN") expect(hold.status).toBe("OPEN");
      expect(hold.centerId).toBe(cs1Id);
    }
    expect(trangThaiNhom(lanDay, "Hàng chờ")).toEqual(["DA_TAO", "DA_TAO"]);
    expect(ghiChuNhom(lanDay, "Hàng chờ")).toContain(kyCuaHangCho(KY_T));
  });

  it("[SRC-INT-56] sổ hoa hồng của hai khoản chỉ do ENGINE ghi (dòng ORIGINAL + ô tính) và BẤT BIẾN: UPDATE và DELETE trực tiếp bị trigger chặn", async () => {
    for (const kb of KICH_BAN_HANG_CHO) {
      const khoan = await db.payment.findFirstOrThrow({ where: { note: ghiChuKhoanHangCho(kb.ma) }, select: { id: true } });
      const dong = await db.commissionTransaction.findMany({ where: { paymentId: khoan.id }, select: { id: true, entryKind: true, amount: true } });
      expect(dong.length, `${kb.ma}: engine phải ghi dòng sổ`).toBeGreaterThan(0);
      expect(dong.some((d) => d.entryKind === "ORIGINAL"), `${kb.ma}: có dòng ORIGINAL do engine`).toBe(true);
      expect(await db.commissionCalcSlot.count({ where: { paymentId: khoan.id } }), `${kb.ma}: có ô tính`).toBeGreaterThan(0);
    }
    const mot = await db.commissionTransaction.findFirstOrThrow({ where: { payment: { note: { startsWith: `${MA_NGUON_FINAL}:` } } }, select: { id: true } });
    await expect(db.$executeRaw`UPDATE "CommissionTransaction" SET "amount" = "amount" + 1 WHERE "id" = ${mot.id}`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "CommissionTransaction" WHERE "id" = ${mot.id}`).rejects.toThrow();
  });

  it("[SRC-INT-57] nạp lần hai KHÔNG sinh thêm lead / quy nguồn / đơn / khoản thu / dòng sổ / ô tính / hàng chờ nào; mọi mục báo DA_CO", () => {
    // `demSauLan1` đo ngay sau lượt đủ điều kiện, `demSauLan2` sau lượt nạp lại.
    expect(demSauLan2).toEqual(demSauLan1);
    expect(demSauLan1.don).toBe(KICH_BAN_HANG_CHO.length);
    expect(demSauLan1.khoan).toBe(KICH_BAN_HANG_CHO.length);
    expect(demSauLan1.hangCho).toBeGreaterThanOrEqual(KICH_BAN_HANG_CHO.length);
    expect(demSauLan1.nguonTuyBien).toBe(1);
    expect(lanHai.muc.filter((m) => m.nhom !== "Tài khoản" && m.trangThai !== "DA_CO" && m.trangThai !== "BO_QUA")).toEqual([]);
    expect(trangThaiNhom(lanHai, "Hàng chờ")).toEqual(["DA_CO", "DA_CO"]);
    expect(new Set(trangThaiNhom(lanHai, "Tài khoản"))).toEqual(new Set(["DA_CO"]));
  });

  it("[SRC-INT-58] bốn mắt THẬT: ngưỡng thấp ⇒ HAI_CAP; N1 đề nghị + N2 quyết ⇒ ghi điều chỉnh; N1 tự quyết bị chặn; người chỉ-xem bị từ chối; N1/N2 không phải người hưởng của khoản", () => {
    expect(ketQua58.cap).toBe("HAI_CAP");
    expect(ketQua58.lyDo).toBe("TU_NGUONG");
    expect(ketQua58.tuQuyetBiChan, "N1 vừa đề nghị mà tự quyết phải bị chặn").not.toContain("QUA (SAI)");
    expect(ketQua58.tuQuyetBiChan.length).toBeGreaterThan(0);
    expect(ketQua58.xemCuaNguoiXem, "tài khoản chỉ-xem KHÔNG xử lý được hàng chờ").not.toContain("QUA (SAI)");
    expect(ketQua58.xemCuaNguoiXem.length).toBeGreaterThan(0);
    expect(ketQua58.daGhi, "đã ghi dòng điều chỉnh (Sale cũ −, Sale mới +)").toBe(2);
    expect(ketQua58.tienGhi).toBe(800_000);
    expect(nguoiHuong58.size).toBeGreaterThan(0);
  });

  it("[SRC-INT-58b] N1, N2 và người đề xuất/ghi sổ không nằm trong tập người hưởng của khoản (điều kiện để bốn mắt chạy được trên TEST)", async () => {
    const [n1, n2] = await Promise.all([db.user.findFirstOrThrow({ where: { email: EMAIL_NGUON_FINAL.duyet1 }, select: { id: true } }), db.user.findFirstOrThrow({ where: { email: EMAIL_NGUON_FINAL.duyet2 }, select: { id: true } })]);
    const khoan = (await db.payment.findMany({ where: { note: { startsWith: `${MA_NGUON_FINAL}:` } }, select: { id: true } })).map((p) => p.id);
    const huong = new Set((await db.commissionTransaction.findMany({ where: { paymentId: { in: khoan } }, select: { beneficiaryUserId: true } })).map((d) => d.beneficiaryUserId));
    expect(huong.has(n1.id)).toBe(false);
    expect(huong.has(n2.id)).toBe(false);
  });

  it("[SRC-INT-59] hai hàng chờ nằm ở kỳ T+3 — KHÁC mọi kỳ mà bộ S02–S10B của checklist 09 dùng (T..T+2) nên không đổi số «quét N khoản»", async () => {
    const kyBoCu = new Set([KY_T, "2026-12", "2027-01"]);
    expect(kyBoCu.has(kyCuaHangCho(KY_T))).toBe(false);
    for (const kb of KICH_BAN_HANG_CHO) {
      const khoan = await db.payment.findFirstOrThrow({ where: { note: ghiChuKhoanHangCho(kb.ma) }, select: { paidDate: true } });
      expect(kyBoCu.has(khoan.paidDate.toISOString().slice(0, 7))).toBe(false);
    }
  });
});
