// @vitest-environment node
/**
 * [UAT-SO-*] — CÁC CON SỐ CỦA CHECKLIST UAT (docs/source-commission/09-uat-checklist.md, bước 3–10), đo bằng ENGINE THẬT trên Postgres THẬT.
 *
 * Checklist chỉ được in con số mà ca này đã thấy engine tính ra. Luồng của ca = luồng của người nghiệm thu:
 *   1. bộ nạp UAT (`napDuLieuHoaHongUat`, cùng lõi với scripts/hoa-hong/uat-nap-du-lieu.ts) dựng nguồn mẫu · chính sách mẫu · lead · đơn · khoản thu;
 *   2. TRƯỚC khi kích hoạt nháp nào: "Tính kỳ" bằng lớp mỏng THẬT của màn Kỳ (`tinhKyHanhDong` + `PHU_THUOC_THAT`: đọc cờ và mốc cutover từ DB) ⇒ cột "trước";
 *   3. nâng trần lên 0,10 và kích hoạt các nháp qua service + guardrail THẬT ⇒ Tính kỳ lại trên sổ sạch ⇒ cột "sau".
 *
 * Giữa hai lượt Tính ca này TRUNCATE sổ (`donSoCai`) để hai lượt đo cùng một đầu vào — người nghiệm thu thật Tính MỘT lần sau khi kích hoạt (sổ không tự ghi đè ô đã có:
 * đổi chính sách sau khi Tính ⇒ INPUT_DRIFT cho người duyệt), và xem cột "trước" bằng nút Thử tính.
 *
 *   [UAT-SO-00] cổng DB chấp nhận DB test này; từ chối khi cùng URL nhưng tên DB tự khai là PROD; thiếu tài khoản UAT ⇒ nạp từ chối (không tạo gì)
 *   [UAT-SO-01] dry-run KHÔNG ghi gì; apply dựng đủ; apply lần hai KHÔNG thêm khoản thu / đơn / lead nào (idempotent)
 *   [UAT-SO-02] S02 nguồn mẫu: 9% → 10% khi nâng trần và kích hoạt chính sách mẫu (SOURCE_OWNER 1% về chủ nguồn)
 *   [UAT-SO-03] S03 phụ huynh giới thiệu     [UAT-SO-04] S04 nhân sự giới thiệu     [UAT-SO-05] S05 + S05B quảng cáo, chủ nguồn
 *   [UAT-SO-06] S06 ngoài cửa sổ ghi công     [UAT-SO-07] S07 khách tự đến NEW       [UAT-SO-08] S08 RENEWAL (0 đ → 200.000)
 *   [UAT-SO-09] S09 ba lần thanh toán           [UAT-SO-10] S10 hoàn một phần           [UAT-SO-11] "Tính kỳ" của kỳ TƯƠNG LAI chạy được ở "hôm nay" trước kỳ T
 *   [UAT-SO-12] mọi dòng sổ của bộ UAT: không dòng nào sai người nhận; không hàng chờ ngoài S05B
 *
 * LUẬT 18: mỗi ca chạy ĐƯỢC MỘT MÌNH — toàn bộ luồng ở `beforeAll`, ca chỉ đọc kết quả. LUẬT 19: `NOW` tuyệt đối.
 * Chạy: `pnpm test:hoa-hong-db` (cần DB trống đã `migrate deploy` + `seed-roles`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { lapKeHoachSeedV1 } from "../../lib/hoa-hong/ke-hoach-seed-v1";
import { taoChinhSach, taoVanBan } from "../../lib/hoa-hong/chinh-sach-service";
import { PHU_THUOC_THAT, tinhKyHanhDong } from "../../lib/hoa-hong/ky-hanh-dong";
import { thuTinhPhienBan } from "../../lib/hoa-hong/mo-phong-hanh-dong";
import { resolveActorUncached } from "../../lib/auth/actor";
import { can } from "../../lib/auth/can";
import { dungBoiCanhTuMoc } from "../../lib/hoa-hong/boi-canh";
import { apDungDoiNguonSauThu } from "../../lib/hoa-hong/doi-nguon-sau-thu";
import { duyetDeXuat } from "../../lib/hoa-hong/duyet-de-xuat";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { CAU_LOI_MOC_HIEU_LUC, mocHieuLucTuNgayVN } from "../../lib/nguon/chu-nguon-lich-su";
import { suaNguon } from "../../lib/nguon/danh-muc-ghi";
import { CAU_THIEU_QUYEN_KICH_HOAT } from "../../lib/nguon/danh-muc-ghi-dau-vao";
import { doiNguonLead } from "../../lib/nguon/doi-nguon-lead";
import { chaySoBong } from "../../lib/hoa-hong/so-bong-db";
import { clearSettingsCache } from "../../lib/settings/service";
import { kiemCongDbUat } from "../../lib/uat/cong-db-uat";
import {
  CHINH_SACH_MAU,
  EMAIL_UAT,
  KICH_BAN_UAT,
  NGUON_MAU,
  NGUOI_NHAN_THEO_VAI,
  NHAP_CAN_KICH_HOAT,
  TIEN_TO_UAT,
  VAI_HUONG,
  mocGhiNhanUat,
  thangCutoverSomNhat,
  tongTheoKy,
  type KhoaNguoiUat,
  type KichBanUat,
  type TienTheoVai,
  type VaiHuong,
} from "../../lib/uat/kich-ban-hoa-hong";
import { napDuLieuHoaHongUat, type KetQuaNapUat } from "../../lib/uat/nap-du-lieu-hoa-hong";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { CO_NGUON_DAY_DU, damBaoDanhMucGoc, damBaoToChuc, datCoNguon } from "../lead-intake/_nguon-fixture";
import { D, SEED_V1, datMocCutover, donSoCai, donViHoiSo, ganVai, lamNhanVien, nguoiKyHo, taoChinhSachFx } from "./_kich-ban";
import { HIEU_LUC_CS, NOW_CS, baoDamNguoiPhuTrach, datTranHoaHong, donNguoiPhuTrach, lamSachChinhSach, thuKichHoat } from "./_nguon-dong";

if (!RUN_DB_TESTS) console.warn(`[UAT-SO] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NHAN = "fx-uat-so";
/** "Hôm nay" của lượt UAT: 10/10/2026 — TRƯỚC tháng cutover. */
const NOW = new Date("2026-10-10T03:00:00.000Z");
const KY_T = thangCutoverSomNhat(NOW);
const HAU_TO_CS = "uatso";

type DongSo = { paymentId: string | null; roleCode: string; amount: number; beneficiaryUserId: string | null };
type Do = { theoKy: Map<string, number>; theoKhoan: Map<string, number>; tien: Map<string, Record<string, number>>; nguoi: Map<string, Record<string, Set<string | null>>>; hold: Map<string, string[]>; soDong: Map<string, number> };

let nap: KetQuaNapUat;
let napDryRun: KetQuaNapUat;
let nap2: KetQuaNapUat;
let demTruocApply: Dem;
let demSauApply: Dem;
let demSauApply2: Dem;
let truoc: Do;
let sau: Do;
/** So bóng của kỳ T với đồng hồ 05/12/2026 — đọc ở `beforeAll` (sau Tính kỳ, TRƯỚC mọi ca ghi DB) để ca [UAT-SO-18] chỉ đọc kết quả và không phụ thuộc thứ tự các ca. */
let soBong: Awaited<ReturnType<typeof chaySoBong>>;
let uidTheoKhoa = new Map<KhoaNguoiUat, string>();
const congKetQua: { ok: boolean; prod: boolean; thieuTaiKhoan: string; dbThat: { ten: string; ok: boolean } } = { ok: false, prod: false, thieuTaiKhoan: "", dbThat: { ten: "", ok: false } };
let tinhTruocKyT: { ok: boolean; ma?: string } = { ok: false };
const banDauChinhSach: string[] = [];
/** Số khoản mà lượt "Tính kỳ" báo đã quét (toast "Đã tính kỳ … — quét N khoản") ở lượt Tính CUỐI của từng kỳ. */
const soKhoanQuet = new Map<string, number>();
/** "Thử tính" của chính sách nháp mẫu (chủ nguồn 1%) trên kỳ T, ở trần 9% và 10%, TRƯỚC khi kích hoạt. */
type ThuTinh = { tran: number; hienTai: number; deXuat: number; chenh: number; khoanViPhamTran: number };
const thuTinhMau: ThuTinh[] = [];

/** Mọi thứ mà bộ nạp có thể ghi — dry-run phải để NGUYÊN bảng đếm này (đếm RỘNG: một phép ghi lọt khỏi dry-run ở bảng nào cũng phải làm ca đỏ). */
const demUat = async () => ({
  don: await db.order.count({ where: { code: { startsWith: TIEN_TO_UAT } } }),
  lead: await db.lead.count({ where: { parentName: { startsWith: TIEN_TO_UAT } } }),
  payment: await db.payment.count({ where: { note: { startsWith: "UAT:" } } }),
  hocVien: await db.student.count({ where: { id: { startsWith: TIEN_TO_UAT } } }),
  lopTrial: await db.trialClassV2.count({ where: { code: { startsWith: TIEN_TO_UAT } } }),
  khoaHoc: await db.course.count({ where: { id: { startsWith: TIEN_TO_UAT } } }),
  lop: await db.class.count({ where: { id: { startsWith: TIEN_TO_UAT } } }),
  nguoiPhuTrach: await db.centerCommissionAssignee.count({ where: { note: { startsWith: TIEN_TO_UAT } } }),
  nguonMau: await db.leadSourceGroup.count({ where: { code: NGUON_MAU.code } }),
  vanBan: await db.regulationDocument.count({ where: { documentCode: CHINH_SACH_MAU.vanBan } }),
  chinhSachMau: await db.commissionPolicy.count({ where: { policyCode: { in: [CHINH_SACH_MAU.nguon, CHINH_SACH_MAU.taiTuc] } } }),
  mocCutover: await db.systemSetting.count({ where: { key: "hoaHong.kyCutover" } }),
  chuNguonPaidAds: await db.leadSourceGroup.count({ where: { code: "PAID_ADS", ownerEmployeeId: { not: null } } }),
});
type Dem = Awaited<ReturnType<typeof demUat>>;
const KHONG_GI: Dem = { don: 0, lead: 0, payment: 0, hocVien: 0, lopTrial: 0, khoaHoc: 0, lop: 0, nguoiPhuTrach: 0, nguonMau: 0, vanBan: 0, chinhSachMau: 0, mocCutover: 0, chuNguonPaidAds: 0 };

const tomLai = (so: Record<string, number> | undefined): TienTheoVai => Object.fromEntries(Object.entries(so ?? {}).filter(([, v]) => v !== 0)) as TienTheoVai;

/**
 * Dọn mọi thứ bộ nạp UAT đã dựng (mã đơn / ghi chú khoản thu / mã học viên mang tiền tố UAT) để spec chạy lại được trên cùng DB. Sổ cái cắt bằng `donSoCai`
 * (bất biến — xoá theo dòng bị trigger chặn); phần còn lại xoá theo thứ tự khoá ngoại. KHÔNG xoá tài khoản (chúng được đánh dấu xoá mềm ở đầu ca).
 */
async function donDauVetUat(): Promise<void> {
  await donSoCai();
  const pay = (await db.payment.findMany({ where: { note: { startsWith: "UAT:" } }, select: { id: true } })).map((p) => p.id);
  await db.receipt.deleteMany({ where: { paymentId: { in: pay } } });
  await db.payment.deleteMany({ where: { id: { in: pay } } });
  const don = (await db.order.findMany({ where: { code: { startsWith: TIEN_TO_UAT } }, select: { id: true } })).map((o) => o.id);
  await db.orderItem.deleteMany({ where: { orderId: { in: don } } });
  await db.order.deleteMany({ where: { id: { in: don } } });
  await db.enrollment.deleteMany({ where: { id: { startsWith: TIEN_TO_UAT } } });
  // quy nguồn trỏ Student (người giới thiệu) bằng FK Restrict ⇒ gỡ quy nguồn TRƯỚC học viên
  const lead = (await db.lead.findMany({ where: { parentName: { startsWith: TIEN_TO_UAT } }, select: { id: true } })).map((l) => l.id);
  await db.leadTouchpoint.deleteMany({ where: { leadId: { in: lead } } });
  await db.leadAttribution.deleteMany({ where: { leadId: { in: lead } } });
  await db.student.deleteMany({ where: { id: { startsWith: TIEN_TO_UAT } } });
  await db.class.deleteMany({ where: { id: { startsWith: TIEN_TO_UAT } } });
  await db.course.deleteMany({ where: { id: { startsWith: TIEN_TO_UAT } } });
  const lop = (await db.trialClassV2.findMany({ where: { code: { startsWith: TIEN_TO_UAT } }, select: { id: true } })).map((c) => c.id);
  await db.trialAttendance.deleteMany({ where: { trialSession: { trialClassId: { in: lop } } } });
  await db.trialEnrollment.deleteMany({ where: { trialClassId: { in: lop } } });
  await db.trialClassSession.deleteMany({ where: { trialClassId: { in: lop } } });
  await db.trialClassV2.deleteMany({ where: { id: { in: lop } } });
  await db.leadChild.deleteMany({ where: { leadId: { in: lead } } });
  await db.lead.deleteMany({ where: { id: { in: lead } } });
}

/** Tài khoản UAT: xoá mềm + gỡ vai v2 (spec dựng lại đúng thứ nó cần ở mỗi lần chạy). */
async function xoaMemTaiKhoanUat(): Promise<void> {
  const ids = (await db.user.findMany({ where: { email: { in: Object.values(EMAIL_UAT) } }, select: { id: true } })).map((u) => u.id);
  await db.userOrgRole.deleteMany({ where: { userId: { in: ids } } });
  await db.user.updateMany({ where: { email: { in: Object.values(EMAIL_UAT) } }, data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") } });
}

async function coNhanVien(userId: string, ma: string): Promise<void> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { employeeId: true } });
  if (!u.employeeId) await lamNhanVien(userId, ma);
}

async function tinhTatCaKy(): Promise<void> {
  const nguoi = await nguoiKyHo();
  const cs1 = await db.center.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } });
  for (const ky of nap.cacKy) {
    const r = await tinhKyHanhDong(PHU_THUOC_THAT, { nguoi, now: NOW, thang: ky, centerId: cs1.id });
    expect(r.ok, `Tính kỳ ${ky}: ${JSON.stringify(r)}`).toBe(true);
    if (r.ok) soKhoanQuet.set(ky, r.soKhoan);
  }
}

async function doSoCai(): Promise<Do> {
  const khoan = await db.payment.findMany({ where: { note: { startsWith: "UAT:" } }, select: { id: true, note: true } });
  const maCua = new Map(khoan.map((p) => [p.id, /^UAT:(S\d+B?):/.exec(p.note ?? "")?.[1] ?? "?"]));
  const ghiChuCua = new Map(khoan.map((p) => [p.id, p.note ?? ""]));
  const goc = await db.commissionTransaction.findMany({
    where: { paymentId: { in: khoan.map((p) => p.id) } },
    select: { paymentId: true, roleCode: true, amount: true, beneficiaryUserId: true, period: { select: { period: true } } },
  });
  const dong: DongSo[] = goc.map((d) => ({ paymentId: d.paymentId, roleCode: d.roleCode, amount: d.amount, beneficiaryUserId: d.beneficiaryUserId }));
  const theoKy = new Map<string, number>();
  const theoKhoan = new Map<string, number>();
  for (const d of goc) {
    theoKy.set(d.period.period, (theoKy.get(d.period.period) ?? 0) + d.amount);
    const gc = ghiChuCua.get(d.paymentId ?? "") ?? "?";
    theoKhoan.set(gc, (theoKhoan.get(gc) ?? 0) + d.amount);
  }
  const tien = new Map<string, Record<string, number>>();
  const nguoi = new Map<string, Record<string, Set<string | null>>>();
  const soDong = new Map<string, number>();
  for (const d of dong) {
    const ma = maCua.get(d.paymentId ?? "") ?? "?";
    soDong.set(ma, (soDong.get(ma) ?? 0) + 1);
    const t = tien.get(ma) ?? {};
    t[d.roleCode] = (t[d.roleCode] ?? 0) + d.amount;
    tien.set(ma, t);
    const n = nguoi.get(ma) ?? {};
    (n[d.roleCode] ??= new Set()).add(d.beneficiaryUserId);
    nguoi.set(ma, n);
  }
  const hold = new Map<string, string[]>();
  for (const h of await db.commissionHold.findMany({ where: { paymentId: { in: khoan.map((p) => p.id) } }, select: { paymentId: true, detail: true } })) {
    const ma = maCua.get(h.paymentId ?? "") ?? "?";
    const ly = (h.detail as { lyDo?: string } | null)?.lyDo ?? "?";
    hold.set(ma, [...(hold.get(ma) ?? []), ly]);
  }
  return { theoKy, theoKhoan, tien, nguoi, hold, soDong };
}

/** Tạo + kích hoạt chính sách phạm vi nguồn từ rule của kế hoạch seed (cùng nội dung mà `seed-chinh-sach-v1.ts` gieo thành bản nháp). Trả mã chặn. */
async function kichHoatNhapCuaNguon(maNhom: string): Promise<string[]> {
  const muc = lapKeHoachSeedV1().chinhSach.find((c) => c.maNhom === maNhom);
  if (!muc) throw new Error(`Kế hoạch seed không có chính sách cho ${maNhom}`);
  const nhom = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: maNhom }, select: { id: true } });
  const hau = maNhom.toLowerCase().replace(/_/g, "");
  const nguoiThaoTac = { userId: null, ten: "Admin fixture uat-so" };
  const vb = await taoVanBan({
    documentCode: `${HAU_TO_CS}-vb-${hau}`,
    title: "Quy định hoa hồng theo nguồn (fixture UAT)",
    kind: "COMMISSION_POLICY",
    issuedOn: "2026-02-20",
    publishedOn: "2026-03-02",
    effectiveOn: "2026-03-23",
    approvedByName: "Hồ Đắc Phúc",
    approvedById: null,
    fileKey: "documents/fx-uat-so.pdf",
    fileName: "fx-uat-so.pdf",
    fileUrl: "https://example.test/fx-uat-so.pdf",
    ownerOrgUnitId: null,
    actor: nguoiThaoTac,
    now: NOW_CS,
  });
  const policyCode = `${HAU_TO_CS}-src-${hau}`;
  const cs = await taoChinhSach({
    policyCode,
    name: `Nháp ${maNhom} (fixture UAT)`,
    description: null,
    ownerOrgUnitId: null,
    phamVi: { loai: "SOURCE_GROUP", sourceGroupId: nhom.id },
    effectiveFrom: HIEU_LUC_CS,
    effectiveTo: null,
    reason: "SR.QD.fixture uat-so",
    documentId: vb.id,
    rules: [...muc.rules],
    actor: nguoiThaoTac,
    now: NOW_CS,
  });
  banDauChinhSach.push(policyCode);
  return thuKichHoat(cs.versionId);
}

async function kichHoatChinhSachMau(ma: string): Promise<string[]> {
  const v = await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: ma }, status: "DRAFT" }, select: { id: true } });
  return thuKichHoat(v.id);
}

/**
 * Dọn MỌI thứ của spec và của bộ nạp UAT (chính sách + văn bản mẫu và fixture, quy nguồn, học viên, nguồn mẫu, người phụ trách, tài khoản UAT → xoá mềm).
 * Gọi ở ĐẦU ca (dấu vết lần trước, kể cả khi lần trước chết giữa chừng) lẫn CUỐI ca — nên spec chạy lại được trên cùng DB, và bộ lead-intake chạy SAU
 * trên cùng DB xoá được danh mục nguồn (FK Restrict).
 */
async function donMoiThu(): Promise<void> {
  await datTranHoaHong(null);
  await donSoCai();
  const maCs = { OR: [{ policyCode: { in: [...banDauChinhSach, CHINH_SACH_MAU.nguon, CHINH_SACH_MAU.taiTuc] } }, { policyCode: { startsWith: HAU_TO_CS } }] };
  const phienBan = await db.commissionPolicyVersion.findMany({ where: { policy: maCs }, select: { id: true, documentId: true } });
  await db.commissionPolicyVersion.deleteMany({ where: { id: { in: phienBan.map((v) => v.id) } } });
  await db.commissionPolicy.deleteMany({ where: maCs });
  await db.regulationDocument.deleteMany({ where: { OR: [{ id: { in: phienBan.map((v) => v.documentId).filter((x): x is string => !!x) } }, { documentCode: CHINH_SACH_MAU.vanBan }] } });
  await donDauVetUat();
  await xoaMemTaiKhoanUat();
  await db.leadSourceGroup.updateMany({ where: { code: "PAID_ADS" }, data: { ownerEmployeeId: null } });
  // LỊCH SỬ chủ nguồn bất biến (trigger chặn DELETE theo dòng): lượt nạp trước để lại khoảng chủ ĐÃ HẸN NGÀY (18 tháng T) ⇒ lượt sau khai chủ lại bị `DA_CO_THAY_DOI_HEN_GIO`. TRUNCATE không chạy trigger theo dòng (DB test).
  await db.$executeRaw`TRUNCATE "LeadSourceOwnerPeriod"`;
  await db.auditLog.deleteMany({ where: { entityType: "LeadSourceGroup", entityId: { in: (await db.leadSourceGroup.findMany({ where: { code: NGUON_MAU.code }, select: { id: true } })).map((g) => g.id) } } });
  await db.leadSourceGroup.deleteMany({ where: { code: NGUON_MAU.code } });
  await db.centerCommissionAssignee.deleteMany({ where: { note: { startsWith: TIEN_TO_UAT } } });
  await donNguoiPhuTrach(NHAN);
}

describe.skipIf(!RUN_DB_TESTS)("[UAT-SO] số liệu của checklist UAT hoa hồng", () => {
  beforeAll(async () => {
    assertTestDb();
    // Dấu vết lần chạy trước (nếu có): dọn dữ liệu UAT và đánh dấu tài khoản UAT là đã xoá mềm — để ca [UAT-SO-00] luôn thấy đúng cảnh "chưa có tài khoản".
    await db.systemSetting.deleteMany({ where: { key: "hoaHong.kyCutover" } });
    await donMoiThu();
    // CI chạy CẢ thư mục `tests/hoa-hong` trên MỘT DB: spec đứng trước để lại lead chưa quy nguồn và khoản thu dở dang. Trang «Chuyển hoa hồng» (đường bộ nạp dùng để đặt mốc) CHẶN đúng hai thứ đó
    // (`DI_TRU_CHUA_SAN_SANG` · `CO_HOLD_DU_KIEN`) — là tính năng, không phải lỗi — nên ca này tự dọn dấu vết của spec khác thay vì nới precheck. Chỉ chạy được trên DB test (assertTestDb ở trên).
    await db.$executeRaw`TRUNCATE "Payment" CASCADE`;
    await db.lead.updateMany({ where: { deletedAt: null, attribution: { is: null } }, data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") } });
    expect(KY_T, "ví dụ trong checklist giả định tháng cutover T = 2026-11").toBe("2026-11");
    await damBaoToChuc({ donVi: ["HO", "CS1"], vai: ["SUPER_ADMIN", "CENTER_SALES_CSM", "HO_ACCOUNTANT", "CENTER_MANAGER"] });
    await damBaoDanhMucGoc(db);
    await datCoNguon(CO_NGUON_DAY_DU);
    await datMocCutover(null);
    await datTranHoaHong(null);
    await db.systemSetting.deleteMany({ where: { key: { in: ["nguon.cuaSoGhiCongNgay", "hoaHong.vatTheoNgay"] } } });
    await db.systemSetting.upsert({ where: { key: "hoaHong.engineBat" }, update: { valueJson: true }, create: { key: "hoaHong.engineBat", valueJson: true } });
    clearSettingsCache();
    await lamSachChinhSach();
    await donSoCai();

    // Cổng DB: hai đối chứng DƯƠNG. (1) URL/tên DB UAT TỰ DỰNG — không phụ thuộc máy chạy. (2) DB THẬT của lượt chạy (CI: `ci_test`; máy dev: `satarobo_test*`): cổng UAT dùng CHUNG định nghĩa DB test
    // với phần còn lại của repo (`laTenDbLaDbTest`), nên (2) PHẢI qua trên mọi DB mà `assertTestDb()` cho reset. Bản đầu của cổng từ chối `ci_test` ⇒ (2) đỏ ở CI (ci-guong 11/10/2026) và [UAT-SO-00] phải né bằng (1).
    // Chỉ khẳng định (2) vế DƯƠNG: đối chứng ÂM (prod/tunnel/host xa) nằm ở `lib/uat/cong-db-uat.test.ts`, chạy không cần DB.
    const TEN_DB_UAT_MAU = "satarobo_test_uat_cong";
    const url = `postgresql://postgres:postgres@127.0.0.1:5432/${TEN_DB_UAT_MAU}`;
    congKetQua.ok = kiemCongDbUat({ url, tenDbThat: TEN_DB_UAT_MAU, choPhepTunnelTest: false, xacNhanDb: TEN_DB_UAT_MAU, apply: true }).ok;
    congKetQua.prod = kiemCongDbUat({ url, tenDbThat: "satarobo", choPhepTunnelTest: false, xacNhanDb: "satarobo", apply: true }).ok;
    const [dbHienTai] = await db.$queryRaw<{ ten: string }[]>`SELECT current_database() AS ten`;
    congKetQua.dbThat = {
      ten: dbHienTai?.ten ?? "",
      ok: kiemCongDbUat({ url: process.env.DATABASE_URL ?? "", tenDbThat: dbHienTai?.ten ?? null, choPhepTunnelTest: false, xacNhanDb: dbHienTai?.ten ?? null, apply: true }).ok,
    };
    const truocKhiCoTk = await napDuLieuHoaHongUat({ apply: false, now: NOW, kyCutover: KY_T, datMocCutover: true, hoanTienSan: true });
    congKetQua.thieuTaiKhoan = truocKhiCoTk.thieu.join(" | ");
    await expect(napDuLieuHoaHongUat({ apply: true, now: NOW, kyCutover: KY_T, datMocCutover: true, hoanTienSan: true })).rejects.toThrow(/Chưa đủ điều kiện/);
    expect(await demUat(), "thiếu tài khoản UAT ⇒ nạp từ chối và KHÔNG tạo gì").toEqual(KHONG_GI);

    // Tài khoản UAT (đứng thay cho `pnpm db:seed:uat`): đúng email, đúng vai v1; vai v2 chỉ cần cho admin (SUPER_ADMIN ở HO) và nhân sự giới thiệu (vai Sale ở CS1).
    const taoTk = (khoa: KhoaNguoiUat, role: "SUPER_ADMIN" | "CENTER_MANAGER" | "SALES_CSM" | "TEACHER" | "MARKETING" | "ACCOUNTANT" | "HR" | "PARENT") =>
      seedUser({ email: EMAIL_UAT[khoa], role, name: `UAT ${khoa}`, phone: null });
    const tk = {
      admin: await taoTk("admin", "SUPER_ADMIN"),
      giamdoc: await taoTk("giamdoc", "CENTER_MANAGER"),
      sale1: await taoTk("sale1", "SALES_CSM"),
      sale2: await taoTk("sale2", "SALES_CSM"),
      sale3: await taoTk("sale3", "SALES_CSM"),
      sale5: await taoTk("sale5", "SALES_CSM"),
      saleho: await taoTk("saleho", "SALES_CSM"),
      giaovien: await taoTk("giaovien", "TEACHER"),
      marketing: await taoTk("marketing", "MARKETING"),
      ketoan: await taoTk("ketoan", "ACCOUNTANT"),
      nhansu: await taoTk("nhansu", "HR"),
      phuhuynh: await taoTk("phuhuynh", "PARENT"),
    };
    uidTheoKhoa = new Map(Object.entries(tk).map(([k, v]) => [k as KhoaNguoiUat, v.id]));
    await ganVai(tk.admin.id, await donViHoiSo(), "SUPER_ADMIN");
    const cs1Ou = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1", deletedAt: null }, select: { id: true } });
    await ganVai(tk.sale2.id, cs1Ou.id, "CENTER_SALES_CSM");
    await coNhanVien(tk.marketing.id, `${NHAN}-mkt`);
    await coNhanVien(tk.sale2.id, `${NHAN}-s2`);

    // HV_MOI (SR.QD.208, 9%) là chính sách ACTIVE duy nhất lúc đầu — đúng trạng thái sau khi chạy seed-chinh-sach-v1 --kich-hoat.
    const hv = await taoChinhSachFx(HAU_TO_CS, SEED_V1);
    banDauChinhSach.push(hv.policyCode);

    demTruocApply = await demUat();
    napDryRun = await napDuLieuHoaHongUat({ apply: false, now: NOW, kyCutover: KY_T, datMocCutover: true, hoanTienSan: true });
    expect(await demUat(), "dry-run KHÔNG được ghi").toEqual(demTruocApply);
    nap = await napDuLieuHoaHongUat({ apply: true, now: NOW, kyCutover: KY_T, datMocCutover: true, hoanTienSan: true });
    demSauApply = await demUat();
    nap2 = await napDuLieuHoaHongUat({ apply: true, now: NOW, kyCutover: KY_T, datMocCutover: true, hoanTienSan: true });
    demSauApply2 = await demUat();
    await baoDamNguoiPhuTrach(NHAN); // cơ sở khác (nếu còn sót) cũng cần người phụ trách thì guardrail mới cho kích hoạt
    clearSettingsCache();

    // ── "Tính kỳ" TRƯỚC khi kích hoạt nháp nào ⇒ cột "trước" ─────────────────────────────────────────────
    const nguoi = await nguoiKyHo();
    const cs1 = await db.center.findFirstOrThrow({ where: { code: "CS1" }, select: { id: true } });
    const th = await tinhKyHanhDong(PHU_THUOC_THAT, { nguoi, now: NOW, thang: KY_T, centerId: cs1.id });
    tinhTruocKyT = th.ok ? { ok: true } : { ok: false, ma: th.ma };
    await tinhTatCaKy();
    truoc = await doSoCai();

    // ── "Thử tính" của chính sách nháp mẫu (bước 2) ở trần 9% rồi 10%, TRƯỚC khi kích hoạt ───────────────────
    const phienBanMau = await db.commissionPolicyVersion.findFirstOrThrow({ where: { policy: { policyCode: CHINH_SACH_MAU.nguon }, status: "DRAFT" }, select: { id: true } });
    for (const tran of [0.09, 0.1]) {
      await datTranHoaHong(tran);
      const r = await thuTinhPhienBan({ actor: nguoi.quyen, now: D("2026-12-31"), versionId: phienBanMau.id, tuNgay: "2026-11-01", denNgay: "2026-11-30", orgUnitId: cs1Ou.id });
      if (!r.ok) throw new Error(`thử tính (trần ${tran}) lỗi: ${r.chung}`);
      thuTinhMau.push({ tran, hienTai: r.ketQua.hoaHong.hienTai, deXuat: r.ketQua.hoaHong.deXuat, chenh: r.ketQua.hoaHong.chenh, khoanViPhamTran: r.ketQua.tran.deXuat.soKhoan });
    }
    await datTranHoaHong(null);

    // ── Nâng trần + kích hoạt các nháp ⇒ Tính lại trên sổ sạch ⇒ cột "sau" ────────────────────────────────
    await datTranHoaHong(0.1);
    for (const ma of NHAP_CAN_KICH_HOAT) {
      const chan = await kichHoatNhapCuaNguon(ma);
      expect(chan, `kích hoạt nháp ${ma}`).toEqual([]);
    }
    for (const ma of [CHINH_SACH_MAU.nguon, CHINH_SACH_MAU.taiTuc]) expect(await kichHoatChinhSachMau(ma), `kích hoạt ${ma}`).toEqual([]);
    await donSoCai();
    await tinhTatCaKy();
    sau = await doSoCai();
    soBong = await chaySoBong({ client: db, now: new Date("2026-12-05T03:00:00.000Z"), kyP: KY_T, tuNgay: `${KY_T}-01`, denNgay: `${KY_T}-30`, tranSoKhoan: 1500 });
  }, 600_000);

  afterAll(async () => {
    await donMoiThu();
    await db.systemSetting.deleteMany({ where: { key: "hoaHong.engineBat" } });
    await datMocCutover(null);
    await datCoNguon({});
    await damBaoDanhMucGoc(db);
  }, 120_000);

  const kbCua = (ma: string): KichBanUat => KICH_BAN_UAT.find((k) => k.ma === ma)!;
  const khop = (r: Do, ma: string, kyVong: TienTheoVai) => {
    expect(tomLai(r.tien.get(ma)), `kịch bản ${ma}`).toEqual(tomLai(kyVong as Record<string, number>));
    // người nhận đúng người (mỗi vai có tiền chỉ về một người)
    for (const [vai, so] of Object.entries(tomLai(r.tien.get(ma))) as [VaiHuong, number][]) {
      if (so === 0) continue;
      const ai = r.nguoi.get(ma)?.[vai];
      expect([...(ai ?? [])], `người nhận vai ${vai} của ${ma}`).toEqual([uidTheoKhoa.get(NGUOI_NHAN_THEO_VAI[vai])]);
    }
  };

  it("[UAT-SO-00] cổng DB: chấp nhận DB test này; cùng URL nhưng tên DB tự khai là PROD ⇒ từ chối; thiếu tài khoản UAT ⇒ dry-run nói THIẾU và apply từ chối", async () => {
    expect(congKetQua.ok).toBe(true);
    expect(congKetQua.prod).toBe(false);
    expect(congKetQua.dbThat.ok, `cổng UAT phải nhận chính DB test đang chạy (${congKetQua.dbThat.ten}) — cùng định nghĩa với assertTestDb`).toBe(true);
    expect(congKetQua.thieuTaiKhoan).toContain("uat.admin@satarobo.vn");
  });

  it("[UAT-SO-01] dry-run không ghi gì; apply dựng đủ (11 đơn kịch bản + 1 đơn gốc RENEWAL); apply lần hai KHÔNG thêm đơn / lead / khoản thu nào", () => {
    expect(demTruocApply).toEqual(KHONG_GI);
    expect(napDryRun.muc.filter((m) => m.nhom === "Kịch bản").map((m) => m.trangThai)).toEqual(KICH_BAN_UAT.map(() => "SE_TAO"));
    expect(demSauApply.don).toBe(KICH_BAN_UAT.length + 1); // + đơn gốc của S08
    expect(demSauApply.payment).toBe(KICH_BAN_UAT.reduce((s, k) => s + k.thanhToan.length, 0) + 1 /* thu đơn gốc S08 */ + 2 /* hoàn S10 + S10B */);
    // đếm rộng: lần nạp thứ nhất dựng đủ mọi thứ (đối chứng dương cho lưới "dry-run không ghi")
    expect(demSauApply).toMatchObject({ hocVien: KICH_BAN_UAT.length + 1 /* + học viên của phụ huynh giới thiệu (S03) */, lopTrial: KICH_BAN_UAT.filter((k) => k.coGvTrial).length, khoaHoc: 2, lop: 2, nguoiPhuTrach: 2, nguonMau: 1, vanBan: 1, chinhSachMau: 2, mocCutover: 1, chuNguonPaidAds: 1 });
    expect(demSauApply2).toEqual(demSauApply);
    expect(nap2.muc.filter((m) => m.nhom === "Kịch bản").every((m) => m.trangThai === "DA_CO")).toBe(true);
    expect(nap.cacKy).toEqual(["2026-11", "2027-01"]);
  });

  it("[UAT-SO-02] S02 nguồn mẫu: 900.000 → 1.000.000 (SOURCE_OWNER 1% về chủ nguồn) sau khi nâng trần 0,10 và kích hoạt chính sách mẫu", () => {
    const k = kbCua("S02");
    khop(truoc, "S02", k.kyVong.truoc);
    khop(sau, "S02", k.kyVong.sau);
  });

  it("[UAT-SO-03] S03 phụ huynh giới thiệu: 900.000 → 1.000.000, Sale phụ trách phụ huynh nhận 200.000, Marketing cơ sở bị loại", () => {
    khop(truoc, "S03", kbCua("S03").kyVong.truoc);
    khop(sau, "S03", kbCua("S03").kyVong.sau);
    expect(sau.tien.get("S03")?.MARKETING ?? 0).toBe(0);
  });

  it("[UAT-SO-04] S04 nhân sự giới thiệu: 900.000 → 1.000.000, nhân sự giới thiệu nhận 200.000", () => {
    khop(truoc, "S04", kbCua("S04").kyVong.truoc);
    khop(sau, "S04", kbCua("S04").kyVong.sau);
  });

  it("[UAT-SO-05] S05 quảng cáo có chủ nguồn: 900.000 → 900.000 nhưng 100.000 đổi từ Marketing cơ sở sang CHỦ NGUỒN; S05B ghi nhận lúc chưa có chủ ⇒ 800.000 + hàng chờ, KHÔNG rơi về Marketing", () => {
    khop(truoc, "S05", kbCua("S05").kyVong.truoc);
    khop(sau, "S05", kbCua("S05").kyVong.sau);
    expect(sau.tien.get("S05")?.MARKETING ?? 0).toBe(0);
    khop(truoc, "S05B", kbCua("S05B").kyVong.truoc);
    khop(sau, "S05B", kbCua("S05B").kyVong.sau);
    expect(sau.hold.get("S05B") ?? []).toContain(kbCua("S05B").kyVong.holdSau);
    expect(truoc.hold.get("S05B") ?? [], "trước khi kích hoạt chính sách nguồn không có gì để treo").toEqual([]);
  });

  it("[UAT-SO-06] S06 khoản thu ngày thứ 101 (ngoài cửa sổ 90 ngày): 900.000 → 800.000, KHÔNG có dòng chủ nguồn; nguồn vẫn là PAID_ADS (không đổi sang UNKNOWN)", async () => {
    khop(truoc, "S06", kbCua("S06").kyVong.truoc);
    khop(sau, "S06", kbCua("S06").kyVong.sau);
    expect(sau.tien.get("S06")?.SOURCE_OWNER ?? 0).toBe(0);
    const a = await db.lead.findFirstOrThrow({ where: { parentName: `${TIEN_TO_UAT}S06-ph` }, select: { attribution: { select: { attributedAt: true, group: { select: { code: true } } } } } });
    expect(a.attribution?.group.code).toBe("PAID_ADS");
    // mốc ghi nhận phải là mốc TUYỆT ĐỐI của kịch bản (01/10/2026), không phải giờ máy lúc nạp — nếu không, "ngày thứ 101" trôi theo lịch
    expect(a.attribution?.attributedAt.toISOString()).toBe(mocGhiNhanUat(KY_T).toISOString());

    // GIẢI THÍCH «vì sao 0đ» (hướng G): ĐÚNG MỘT dòng cho chủ nguồn — ngoài sổ, đọc ra từ bảng chỉ-thêm; khoản TRONG cửa sổ (S05) thì không có.
    const gt = async (ghiChu: string) => {
      const khoan = await db.payment.findFirstOrThrow({ where: { note: ghiChu }, select: { id: true } });
      return db.commissionExplainLine.findMany({ where: { paymentId: khoan.id }, orderBy: { roleCode: "asc" } });
    };
    const s06 = await gt("UAT:S06:1");
    expect(s06).toHaveLength(1);
    expect(s06[0]).toMatchObject({ roleCode: "SOURCE_OWNER", reasonCode: "ATTRIBUTION_WINDOW_EXPIRED", wouldBeAmount: 100_000, netBase: 10_000_000, beneficiaryUserId: uidTheoKhoa.get("marketing") });
    expect(s06[0]!.details).toMatchObject({ cuaSoNgay: 90, hanGhiCong: "2026-12-30", soNgayTre: 11 }); // 01/10 + 90 ngày = 30/12/2026; thu 10/01/2027 trễ 11 ngày (= ngày thứ 101)
    expect(await gt("UAT:S05:1"), "đối chứng dương: khoản TRONG cửa sổ có dòng sổ, KHÔNG có giải thích «0đ»").toHaveLength(0);
  });

  it("[UAT-SO-07] S07 khách tự đến NEW: 900.000 → 800.000 (Marketing không trả)", () => {
    khop(truoc, "S07", kbCua("S07").kyVong.truoc);
    khop(sau, "S07", kbCua("S07").kyVong.sau);
  });

  it("[UAT-SO-08] S08 lần mua thứ hai (RENEWAL): 0 đ khi chưa có chính sách RENEWAL đang chạy (không lỗi, không hàng chờ); 200.000 (Sale 100.000 + QLCS 100.000) sau khi kích hoạt chính sách mẫu", () => {
    khop(truoc, "S08", kbCua("S08").kyVong.truoc);
    khop(sau, "S08", kbCua("S08").kyVong.sau);
    expect(truoc.hold.get("S08") ?? []).toEqual([]);
  });

  it("[UAT-SO-09] S09 một đơn ba lần thanh toán 4tr + 3tr + 3tr: cùng NEW cả ba, từng khoản đúng tỉ lệ (360.000 / 270.000 / 270.000 → 320.000 / 240.000 / 240.000), tổng bằng đúng một lần thu 10tr (900.000 → 800.000)", () => {
    khop(truoc, "S09", kbCua("S09").kyVong.truoc);
    khop(sau, "S09", kbCua("S09").kyVong.sau);
    for (const kk of kbCua("S09").tungKhoan!) {
      expect(truoc.theoKhoan.get(kk.ghiChu), `${kk.ghiChu} trước`).toBe(kk.truoc);
      expect(sau.theoKhoan.get(kk.ghiChu), `${kk.ghiChu} sau`).toBe(kk.sau);
    }
    expect(truoc.soDong.get("S09"), "3 khoản × 5 vai").toBe(15);
    expect(sau.soDong.get("S09"), "3 khoản × 4 vai (Marketing bị loại)").toBe(12);
  });

  it("[UAT-SO-10] S10 hoàn 4tr trên khoản 10tr: dòng ÂM thu hồi đúng 40% từng dòng gốc — ròng còn 60% (540.000 trước; 480.000 sau)", () => {
    khop(truoc, "S10", kbCua("S10").kyVong.truoc);
    khop(sau, "S10", kbCua("S10").kyVong.sau);
    for (const kk of kbCua("S10").tungKhoan!) {
      expect(truoc.theoKhoan.get(kk.ghiChu), `${kk.ghiChu} trước`).toBe(kk.truoc);
      expect(sau.theoKhoan.get(kk.ghiChu), `${kk.ghiChu} sau`).toBe(kk.sau);
    }
  });

  it("[UAT-SO-10B] S10B hoàn TOÀN BỘ 10tr: mọi dòng gốc bị đảo sạch, ròng 0 ở cả hai trạng thái (không lệch 1 đồng)", () => {
    khop(truoc, "S10B", kbCua("S10B").kyVong.truoc);
    khop(sau, "S10B", kbCua("S10B").kyVong.sau);
    for (const kk of kbCua("S10B").tungKhoan!) {
      expect(truoc.theoKhoan.get(kk.ghiChu), `${kk.ghiChu} trước`).toBe(kk.truoc);
      expect(sau.theoKhoan.get(kk.ghiChu), `${kk.ghiChu} sau`).toBe(kk.sau);
    }
    // đối chứng dương: sổ CÓ dòng cho S10B — ròng 0 không phải vì không có dòng nào. Trước: 5 vai × (gốc + đảo) = 10; sau (Marketing bị loại): 4 vai × 2 = 8.
    expect(truoc.soDong.get("S10B")).toBe(10);
    expect(sau.soDong.get("S10B")).toBe(8);
  });

  it("[UAT-SO-14] toast của nút Tính: kỳ T quét 14 khoản (12 khoản thu + 2 khoản hoàn của tháng T; khoản thu tháng 8 của đơn gốc S08 nằm ngoài); kỳ T+2 quét 13 — N là SỐ KHOẢN TRONG TẬP QUÉT (khoản của tháng + khoản đang có hàng chờ + khoản của 3 tháng gần nhất quét lại để đối soát), KHÔNG phải số lead", async () => {
    const khoanKyT = await db.payment.count({ where: { note: { startsWith: "UAT:" }, paidDate: { gte: new Date("2026-10-31T17:00:00.000Z"), lt: new Date("2026-11-30T17:00:00.000Z") } } });
    expect(khoanKyT).toBe(14);
    expect(soKhoanQuet.get(KY_T)).toBe(14);
    expect(soKhoanQuet.get("2027-01")).toBe(13);
  });

  it("[UAT-SO-15] Thử tính của chính sách mẫu (bước 2) trên kỳ 11/2026 — TOÀN kỳ (9 khoản NEW × 900.000 = 8.100.000 trên DB sạch): ở trần 9% đúng MỘT khoản (S02) vi phạm, bị chặn nguyên ⇒ Đề xuất 7.200.000 (Chênh −900.000); ở trần 10% Đề xuất 8.200.000 (Chênh +100.000), không vi phạm", () => {
    const [o9, o10] = thuTinhMau;
    expect(o9, JSON.stringify(thuTinhMau)).toMatchObject({ tran: 0.09, hienTai: 8_100_000, deXuat: 7_200_000, chenh: -900_000, khoanViPhamTran: 1 });
    expect(o10, JSON.stringify(thuTinhMau)).toMatchObject({ tran: 0.1, hienTai: 8_100_000, deXuat: 8_200_000, chenh: 100_000, khoanViPhamTran: 0 });
  });

  it("[UAT-SO-11] 'Tính kỳ' của kỳ T chạy được khi 'hôm nay' (10/10/2026) còn TRƯỚC kỳ T; kết quả là sổ có dòng", () => {
    expect(tinhTruocKyT, JSON.stringify(tinhTruocKyT)).toEqual({ ok: true });
    expect(truoc.tien.size).toBeGreaterThan(0);
  });

  it("[UAT-SO-13] tổng hoa hồng ròng của CẢ bộ UAT theo kỳ: kỳ T 6.840.000 → 6.980.000; kỳ T+2 (chỉ S06) 900.000 → 800.000", () => {
    const tong = (r: Do) => Object.fromEntries([...r.theoKy.entries()].sort());
    expect(tong(truoc)).toEqual(tongTheoKy(KY_T, "truoc"));
    expect(tong(sau)).toEqual(tongTheoKy(KY_T, "sau"));
  });

  it("[UAT-SO-12] mọi vai trong sổ UAT đều nằm trong danh sách vai đã khai; hàng chờ chỉ có ở S05B", () => {
    for (const r of [truoc, sau]) {
      for (const so of r.tien.values()) for (const vai of Object.keys(so)) expect(VAI_HUONG as readonly string[]).toContain(vai);
      expect([...r.hold.keys()].filter((ma) => ma !== "S05B"), "hàng chờ ngoài S05B").toEqual([]);
    }
  });

  it("[UAT-SO-18] bước 19: so bóng engine cũ ↔ mới trên bộ UAT — khoản thu UAT là TƯƠNG LAI ở 'hôm nay' nên cửa sổ tháng T bị TỪ CHỐI; với đồng hồ 05/12/2026: 12/12 khoản so được, 34 dòng KHỚP, chênh còn lại là EXPECTED (Marketing 1% · và S08 là EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE từ AFF-L2 D-E), UNEXPECTED = 0", async () => {
    const cuaSo = { tuNgay: `${KY_T}-01`, denNgay: `${KY_T}-30` };
    // 'hôm nay' (10/10/2026) đứng TRƯỚC cửa sổ ⇒ không có gì để so: từ chối chứ không so rỗng.
    await expect(chaySoBong({ client: db, now: NOW, kyP: KY_T, ...cuaSo, tranSoKhoan: 1500 })).rejects.toMatchObject({ ma: "KHOANG_KHONG_HOP_LE" });

    const b = soBong;
    expect(b.khoan).toMatchObject({ tong: 12, tinhDuoc: 12, chuaTinh: 0, ngoaiPhamVi: 0, loiCauHinh: 0 });
    expect(b.match.soDong).toBe(34);
    // chênh CÓ CHỦ ĐÍCH (bảng §6): Marketing bỏ khỏi 5 nguồn không quảng cáo (E1) · Marketing → chủ nguồn ở PAID_ADS (E2) · +2% người giới thiệu / +1% chủ nguồn mẫu (E6, E7)
    // S08: dòng đổi từ UNEXPECTED sang EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE (D-E, người điều phối chốt 13/10/2026) — số dòng và số tiền của S08 KHÔNG đổi, chỉ đổi cách GỌI TÊN chênh.
    const s08 = await db.payment.findFirstOrThrow({ where: { note: "UAT:S08:1" }, select: { id: true } });
    const dongS08 = b.dong.filter((d) => d.paymentId === s08.id);
    expect(dongS08.length, "ĐỐI CHỨNG DƯƠNG: S08 thực sự có dòng chênh").toBeGreaterThan(0);
    expect(dongS08.every((d) => d.loai === "EXPECTED_BUSINESS_DELTA" && d.ma === "EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE")).toBe(true);
    const theoMa = Object.fromEntries(Object.entries(b.expected.theoMa).map(([ma, x]) => [ma, x.soDong]));
    expect(theoMa).toEqual({ MARKETING_REMOVED_FOR_NON_AD_SOURCE: 9, MARKETING_MOVED_TO_SOURCE_OWNER: 2, ACQUISITION_ADDED_BY_SOURCE_POLICY: 3, EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE: dongS08.length });
    expect(b.expected.chenh).toBe(-200_000 + dongS08.reduce((s, d) => s + d.chenh, 0));
    // Không còn dòng UNEXPECTED nào: S08 (lần mua thứ hai) — engine cũ xếp theo GHI DANH (học viên mới, 9%), engine mới theo LỊCH SỬ MUA (tái tục) — nay là chênh được chấp nhận CHỈ TRONG báo cáo này.
    expect(b.unexpected.soDong, JSON.stringify(b.dong.filter((d) => d.loai === "UNEXPECTED"))).toBe(0);
    expect(b.hold.tong, "hàng chờ dự kiến = S05B").toBe(1);
  });

  // Hai ca CUỐI GHI vào DB (đổi nguồn S07 + duyệt đề xuất; đổi chủ nguồn mẫu) nên đứng SAU mọi ca chỉ-đọc kết quả của beforeAll (kể cả so bóng của [UAT-SO-18], đọc cả DB: chạy sau ca 16 sẽ thấy S07 đã sang PAID_ADS). Dựng bằng ĐÚNG hàm mà màn hình gọi (luật 9): doiNguonLead → apDungDoiNguonSauThu → duyetDeXuat.
  it("[UAT-SO-16] bước 12: đổi nguồn S07 (Khách tự đến → Quảng cáo) SAU khi đã thu ⇒ ĐỀ XUẤT (sổ chưa đổi); người đổi không tự duyệt; Kế toán duyệt ⇒ SOURCE_CORRECTION +100.000 cho chủ nguồn ⇒ S07 800.000 → 900.000; QLCS bị chặn", async () => {
    const lead = await db.lead.findFirstOrThrow({ where: { parentName: `${TIEN_TO_UAT}S07-ph` }, select: { id: true } });
    const paidAds = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: "PAID_ADS" }, select: { id: true } });
    const thamChieu = { employeeId: null, parentUserId: null, studentId: null, affiliateId: null };
    const doi = async (userId: string, ten: string, lyDo: string) => {
      const actor = await resolveActorUncached(userId);
      return doiNguonLead({ actor, actorName: ten, kiemQuyen: async (a) => can(actor, a), leadId: lead.id, groupId: paidAds.id, thamChieu, giaiTrinh: null, lyDo, bayGio: NOW });
    };
    const tongS07 = async () => (await db.commissionTransaction.aggregate({ where: { payment: { note: "UAT:S07:1" } }, _sum: { amount: true } }))._sum.amount ?? 0;
    expect(await tongS07()).toBe(800_000);

    // đối chứng ÂM: QLCS (giữ leads:overwrite, KHÔNG giữ sources:override-after-payment) bị chặn; sổ + nguồn không đổi
    const cs1Ou = await db.orgUnit.findFirstOrThrow({ where: { code: "CS1", deletedAt: null }, select: { id: true } });
    await ganVai(uidTheoKhoa.get("giamdoc")!, cs1Ou.id, "CENTER_MANAGER");
    const bi = await doi(uidTheoKhoa.get("giamdoc")!, "uat.giamdoc", "Thử đổi nguồn sau thanh toán bằng QLCS");
    expect(bi, JSON.stringify(bi)).toMatchObject({ ok: false, loi: expect.stringContaining("đã có khoản thu") }); // đúng lý do «đổi nguồn sau thanh toán», không phải «lead không tồn tại»
    expect((await db.leadAttribution.findUniqueOrThrow({ where: { leadId: lead.id }, select: { group: { select: { code: true } } } })).group.code).toBe("WALK_IN");
    expect(await db.domainEvent.count({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${lead.id}:` } } })).toBe(0);

    // đối chứng DƯƠNG: Quản trị tối cao đổi được
    const ok = await doi(uidTheoKhoa.get("admin")!, "uat.admin", "Khách xác nhận đến từ quảng cáo sau khi đóng tiền");
    expect(ok).toMatchObject({ ok: true, action: "DOI_NGUON_SAU_THU" });
    const ev = await db.domainEvent.findFirstOrThrow({ where: { type: "nguon.da-doi-sau-thanh-toan", dedupeKey: { startsWith: `nguon.da-doi-sau-thanh-toan:${lead.id}:` } } });

    // consumer của sự kiện (cron dispatch-events) chỉ LẬP ĐỀ XUẤT — sổ chưa đổi một đồng
    const bc = await dungBoiCanhTuMoc(db, NOW, KY_T);
    const lap = await apDungDoiNguonSauThu(db, bc, { leadId: lead.id, refEventId: ev.id, requestedById: uidTheoKhoa.get("admin")! });
    expect(lap.theoKetQua).toEqual({ DE_XUAT: 1 });
    const dx = await db.commissionAdjustmentRequest.findFirstOrThrow({ where: { leadId: lead.id, origin: "SOURCE_CHANGE" } });
    expect(dx).toMatchObject({ status: "PENDING", governance: "SINGLE_APPROVAL", absTotal: 100_000, netTotal: 100_000, requestedById: uidTheoKhoa.get("admin") });
    expect(await tongS07()).toBe(800_000);

    // người ĐỔI NGUỒN không tự duyệt (dù là Quản trị tối cao); Kế toán Hội sở (khác người) duyệt một cấp ⇒ ghi
    const ketoan = uidTheoKhoa.get("ketoan")!;
    await ganVai(ketoan, await donViHoiSo(), "HO_ACCOUNTANT");
    const nguoiDuyet = async (userId: string, ten: string) => ({ userId, ten, quyen: await resolveActorUncached(userId) });
    await expect(duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: await nguoiDuyet(uidTheoKhoa.get("admin")!, "uat.admin"), lyDo: "Tự duyệt đề xuất do chính mình đổi nguồn" })).rejects.toMatchObject({ ma: "KHONG_DUOC_DUYET" });
    expect(await tongS07()).toBe(800_000);
    expect(await duyetDeXuat(db, bc, { requestId: dx.id, nguonGoc: "SOURCE_CHANGE", nguoi: await nguoiDuyet(ketoan, "uat.ketoan"), lyDo: "Đã đối chiếu nguồn mới và đồng ý điều chỉnh" })).toMatchObject({ loai: "DA_GHI", cap: 1, soDong: 1, tong: 100_000, kyGhi: KY_T });

    const dong = await db.commissionTransaction.findMany({ where: { payment: { note: "UAT:S07:1" } }, select: { roleCode: true, entryKind: true, amount: true, beneficiaryUserId: true } });
    const chuyen = dong.filter((d) => d.entryKind === "SOURCE_CORRECTION");
    expect(chuyen).toEqual([{ roleCode: "SOURCE_OWNER", entryKind: "SOURCE_CORRECTION", amount: 100_000, beneficiaryUserId: uidTheoKhoa.get("marketing") }]);
    expect(dong.filter((d) => d.entryKind === "ORIGINAL").reduce((t, d) => t + d.amount, 0), "dòng gốc KHÔNG bị sửa").toBe(800_000);
    expect(await tongS07()).toBe(900_000);
    expect(await db.commissionHold.count({ where: { paymentId: dx.paymentId, status: "OPEN" } })).toBe(0);
  });

  it("[UAT-SO-17] bước 11: đổi chủ NGUỒN MẪU (S02) CÓ NGÀY HIỆU LỰC sau ngày thu ⇒ S02 vẫn về chủ cũ, quét lại không điều chỉnh; thiếu quyền kích hoạt / lùi ngày bị từ chối; lịch sử có hai khoảng", async () => {
    // Nguồn mẫu (không phải PAID_ADS): PAID_ADS đang có thay đổi chủ ĐÃ HẸN ngày (18 tháng T, do bộ nạp) nên chưa hẹn thêm được cho tới ngày đó (`DA_CO_THAY_DOI_HEN_GIO`).
    const nguon = await db.leadSourceGroup.findUniqueOrThrow({ where: { code: NGUON_MAU.code }, select: { id: true, updatedAt: true, ownerEmployeeId: true } });
    const nhanVienMoi = (await db.user.findUniqueOrThrow({ where: { id: uidTheoKhoa.get("sale2")! }, select: { employeeId: true } })).employeeId!;
    const khoanS02 = await db.payment.findFirstOrThrow({ where: { note: "UAT:S02:1" }, select: { id: true } });
    const tongS02 = async () => (await db.commissionTransaction.aggregate({ where: { paymentId: khoanS02.id }, _sum: { amount: true } }))._sum.amount ?? 0;
    expect(await tongS02()).toBe(1_000_000);
    const nguoi = (khoa: KhoaNguoiUat) => ({ userId: uidTheoKhoa.get(khoa)!, ten: `uat.${khoa}` });
    // Đồng hồ của ca này lấy từ DỮ LIỆU, không từ giờ máy: `taoNguon` ghi mốc khoảng KHỞI TẠO bằng giờ máy thật nên `NOW` cố định có thể đứng TRƯỚC nó (⇒ «đã hẹn ngày» oan).
    const khoiTao = await db.leadSourceOwnerPeriod.findFirstOrThrow({ where: { groupId: nguon.id, kind: "KHOI_TAO" }, select: { effectiveFrom: true } });
    const nowSua = new Date(khoiTao.effectiveFrom.getTime() + 3_600_000);
    const hieuLuc = new Date(Math.max(mocHieuLucTuNgayVN("2026-11-25", nowSua)!.getTime(), nowSua.getTime() + 86_400_000)); // SAU ngày thu của S02 (12/11)
    const sua = (khoa: KhoaNguoiUat, coQuyenKichHoat: boolean, hieuLucChuTu: Date | null) =>
      suaNguon({ nguoi: nguoi(khoa), id: nguon.id, updatedAtDaThay: nguon.updatedAt, vao: { ownerEmployeeId: nhanVienMoi }, lyDo: "Đổi người phụ trách nguồn mẫu cho UAT bước 11", coQuyenKichHoat, now: nowSua, hieuLucChuTu });

    // đối chứng ÂM: Marketing (sources:manage nhưng KHÔNG commission_policies:activate) đổi chủ nguồn đã dính tiền ⇒ từ chối; thiếu ngày hiệu lực; lùi ngày ⇒ từ chối
    // mỗi lượt bị từ chối vì ĐÚNG lý do của nó (không phải vì một cổng khác chặn hộ)
    expect(await sua("marketing", false, hieuLuc)).toMatchObject({ ok: false, loi: CAU_THIEU_QUYEN_KICH_HOAT });
    expect(await sua("admin", true, null)).toMatchObject({ ok: false, truong: "ownerEmployeeId", loi: expect.stringContaining("NGÀY HIỆU LỰC") });
    expect(await sua("admin", true, new Date(nowSua.getTime() - 86_400_000))).toMatchObject({ ok: false, truong: "ownerEmployeeId", loi: CAU_LOI_MOC_HIEU_LUC.LUI_NGAY });
    expect((await db.leadSourceGroup.findUniqueOrThrow({ where: { id: nguon.id }, select: { ownerEmployeeId: true } })).ownerEmployeeId, "ba lượt bị từ chối không đổi gì").toBe(nguon.ownerEmployeeId);
    expect(await db.leadSourceOwnerPeriod.count({ where: { groupId: nguon.id } })).toBe(1);

    // đối chứng DƯƠNG: Quản trị tối cao (đủ quyền) đổi được
    const doiDuoc = await sua("admin", true, hieuLuc);
    expect(doiDuoc.ok, JSON.stringify(doiDuoc)).toBe(true);
    const lichSu = await db.leadSourceOwnerPeriod.findMany({ where: { groupId: nguon.id }, orderBy: { effectiveFrom: "asc" }, select: { kind: true, ownerEmployeeId: true, effectiveFrom: true, effectiveTo: true } });
    expect(lichSu.map((k) => [k.kind, k.ownerEmployeeId])).toEqual([["KHOI_TAO", nguon.ownerEmployeeId], ["DOI_CHU", nhanVienMoi]]);
    expect(lichSu[0]!.effectiveTo?.toISOString()).toBe(hieuLuc.toISOString());
    expect(lichSu[1]!.effectiveFrom.toISOString()).toBe(hieuLuc.toISOString());
    expect(lichSu[1]!.effectiveTo).toBeNull();

    // S02 thu 12/11 < 25/11 ⇒ vẫn chủ cũ: quét lại KHÔNG điều chỉnh, KHÔNG hàng chờ, tổng không đổi
    const kq = await quetKhoan(db, await dungBoiCanhTuMoc(db, NOW, KY_T), khoanS02.id);
    expect(kq.loai).toBe("KHONG_DOI");
    expect(await tongS02()).toBe(1_000_000);
    expect(await db.commissionHold.count({ where: { paymentId: khoanS02.id, status: "OPEN" } })).toBe(0);
    expect(await db.commissionTransaction.count({ where: { paymentId: khoanS02.id, roleCode: "SOURCE_OWNER", beneficiaryUserId: uidTheoKhoa.get("marketing")! } })).toBe(1);
  });
});
