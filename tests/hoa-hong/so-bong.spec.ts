// @vitest-environment node
/**
 * [SBG-*] — SO BÓNG engine cũ ↔ mới trên Postgres THẬT (05 §7.5 bước 3). Phần thuần ở `lib/hoa-hong/so-bong.test.ts`; ở đây là thứ chỉ DB mới chứng minh:
 *
 *   · cùng một khoản thu đi qua CẢ HAI engine THẬT (`mapButToanHoaHong` → `tinhHoaHongTheoKy` và `lapThu` → `tinhDongChoKhoan`): chỉ bộ chính sách chung ⇒ hai bên TRÙNG TỪNG ĐỒNG,
 *     kể cả khoản lẻ (3.333.333đ) chia cho hai Marketing — nếu hai engine làm tròn khác nhau thì cổng precheck KHÔNG BAO GIỜ mở, nên phải đo trước mọi thứ khác;
 *   · «không so mã nguồn»: nguồn do admin TẠO (mã bất kỳ) mang dòng loại trừ vẫn ra đúng mã lý do;
 *   · các lệch có chủ đích (Marketing bị loại · đổi người nhận sang chủ nguồn · nguồn giới thiệu +2% · học cụ ra khỏi cơ sở) ra EXPECTED (từ AFF-L2 thêm: tái tục kiểu cũ — hai engine định nghĩa «tái tục» khác nhau, engine mới là chuẩn; chính sách campaign Affiliate), lệch lỗi (Sale 3,99% · đổi người cùng vai ·
 *     vượt trần) ra UNEXPECTED;
 *   · khoản thiếu dữ liệu (GIU / vai treo có hàng chờ) đếm ở hàng chờ DỰ KIẾN — và vai treo «bình thường» (không có GV Trial) thì KHÔNG đếm;
 *   · so bóng KHÔNG GHI GÌ: đếm dòng 17 bảng trước/sau — và CÙNG bộ đếm phát hiện ghi khi chạy engine thật (đối chứng dương: bộ đếm không bị mù);
 *   · tất định (hai lượt cùng dấu vân; đổi phiên bản chính sách thì đổi dấu) và KHÔNG cắt im lặng khi vượt trần số khoản.
 *
 * Chạy: `pnpm test:hoa-hong-db`. `pnpm test:unit` trần sẽ SKIP.
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18) rồi dọn bằng `donKichBan`; mỗi ca dùng MỘT THÁNG riêng làm cửa sổ để khoản của ca khác không lọt vào.
 * Ngày TUYỆT ĐỐI (luật 19): `NOW` là hằng.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedUser } from "../e2e/_helpers/seed";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { chaySoBong } from "../../lib/hoa-hong/so-bong-db";
import type { BaoCaoSoBong } from "../../lib/hoa-hong/so-bong";
import { datTranHoaHong } from "./_nguon-dong";
import {
  SEED_V1,
  boiCanh,
  D,
  datMocCutover,
  donKichBan,
  dungBe,
  dungKichBan,
  ganNguon,
  kiemCuaSoSach,
  lamNhanVien,
  taoChinhSachFx,
  themChinhSachNhom,
  themGvTrial,
  tienVe,
  type KichBan,
  type RuleFx,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[SBG-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const KY_P = "2027-01";

/** Ngày cuối tháng "YYYY-MM". */
const cuoiThang = (thang: string): string => {
  const [y, m] = thang.split("-").map(Number) as [number, number];
  return `${thang}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

// Kịch bản đang chạy của `caSach` — để `chay` KHẲNG ĐỊNH cửa sổ đo không còn khoản thu của spec khác (so bóng cộng MỌI khoản thu của CẢ DB trong cửa sổ).
let dangChay: KichBan | null = null;

async function chay(thang: string, tran = 500): Promise<BaoCaoSoBong> {
  if (!dangChay) throw new Error("chay() phải được gọi trong caSach — cần kịch bản để biết khoản nào là của mình");
  // Cổng ĐẦU VÀO (đo 11/10/2026): [SBG-13d] từng đỏ «tổng 3 / giữ 2 thay vì 1 / 0» chỉ khi chạy cả thư mục vì spec chạy trước để lại khoản thu cùng tháng. Thà NÉM nêu tên đơn còn sót.
  await kiemCuaSoSach([dangChay], `${thang}-01`, cuoiThang(thang));
  return chaySoBong({ client: db, now: NOW, kyP: KY_P, tuNgay: `${thang}-01`, denNgay: cuoiThang(thang), tranSoKhoan: tran });
}

const cuaToi: KichBan[] = [];
const nhomTuTao: string[] = [];

/** Dựng kịch bản, chạy `fn`, rồi DỌN (chính sách → huỷ/xoá, sổ cái cắt, nhóm nguồn tự tạo xoá) kể cả khi `fn` ném. */
async function caSach<T>(tien: string, p: Parameters<typeof dungKichBan>[1], fn: (k: KichBan) => Promise<T>): Promise<T> {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  dangChay = k;
  try {
    return await fn(k);
  } finally {
    dangChay = null;
    await donKichBan([k]);
    for (const code of nhomTuTao.splice(0)) await db.leadSourceGroup.deleteMany({ where: { code } });
  }
}

const dong = (b: BaoCaoSoBong, vai: string) => b.dong.filter((d) => d.roleCode === vai);
const maExpected = (b: BaoCaoSoBong) => Object.keys(b.expected.theoMa).sort();

/** Đếm dòng MỌI bảng mà so bóng không được phép chạm. */
async function demBang() {
  const [a, b, c, d, e, f, g, h, i, j, l, m, n, o, p, q, r] = await Promise.all([
    db.commissionTransaction.count(),
    db.commissionHold.count(),
    db.commissionCalcSlot.count(),
    db.commissionPeriod.count(),
    db.commissionPayoutBatch.count(),
    db.studentTransaction.count(),
    db.auditLog.count(),
    db.domainEvent.count(),
    db.commissionPolicy.count(),
    db.commissionPolicyVersion.count(),
    db.commissionRule.count(),
    db.regulationDocument.count(),
    db.leadAttribution.count(),
    db.leadTouchpoint.count(),
    db.systemSetting.count(),
    db.commissionStatement.count(),
    db.commissionLine.count(),
  ]);
  return { commissionTransaction: a, commissionHold: b, commissionCalcSlot: c, commissionPeriod: d, commissionPayoutBatch: e, studentTransaction: f, auditLog: g, domainEvent: h, commissionPolicy: i, commissionPolicyVersion: j, commissionRule: l, regulationDocument: m, leadAttribution: n, leadTouchpoint: o, systemSetting: p, commissionStatement: q, commissionLine: r };
}

describe.skipIf(!RUN_DB_TESTS)("[SBG-DB] so bóng engine cũ ↔ mới", () => {
  beforeAll(async () => {
    assertTestDb();
    await datMocCutover(null); // so bóng KHÔNG phụ thuộc mốc cutover (dùng mốc giả); gỡ để chắc không ca nào dựa vào nó
  }, 60_000);
  afterAll(async () => {
    await datTranHoaHong(null);
    await donKichBan(cuaToi);
  }, 60_000);

  it("[SBG-01d] CHỈ bộ chính sách chung: hai engine trùng TỪNG ĐỒNG — kể cả khoản lẻ chia cho hai Marketing; 0 EXPECTED, 0 UNEXPECTED", async () => {
    await caSach("sbg01", {}, async (k) => {
      // Hai người cùng phụ trách Marketing của cơ sở: phía cũ chia đều 1%, phía mới cũng chia — nếu hai bên làm tròn khác nhau thì lệch 1đ/khoản và cổng không bao giờ mở.
      await db.centerCommissionAssignee.create({ data: { centerId: k.centerId, role: "QC", userId: k.qc2.id, effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), note: k.ma } });
      const be = await dungBe(k, "a", { tongTien: 30_000_000, ngayDon: D("2026-02-01") });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-03-10") });
      await tienVe(k, be, { soTien: 3_333_333, ngay: D("2026-03-12") });
      await tienVe(k, be, { soTien: 7_777_777, ngay: D("2026-03-20") });
      const b = await chay("2026-03");
      expect(b.khoan).toMatchObject({ tong: 3, tinhDuoc: 3, chuaTinh: 0, loiCauHinh: 0 });
      expect(b.unexpected.soDong, JSON.stringify(b.dong.filter((d) => d.loai === "UNEXPECTED"))).toBe(0);
      expect(b.expected.soDong).toBe(0);
      expect(b.match.soDong).toBeGreaterThanOrEqual(12); // 3 khoản × (Sale · Sale Admin · QLCS · 2 Marketing) = 15 dòng
      expect(dong(b, "MARKETING")).toHaveLength(6); // 3 khoản × 2 người
      expect(b.match.cu).toBe(b.match.moi);
      expect(b.hold.tong).toBe(0); // GV Trial không có ⇒ treo «bình thường», KHÔNG phải hàng chờ dự kiến
    });
  });

  it("[SBG-02d] nguồn do admin TẠO (mã bất kỳ) có dòng loại trừ Marketing ⇒ MARKETING_REMOVED_FOR_NON_AD_SOURCE — không phụ thuộc mã nguồn; đối chứng: lead KHÔNG có nguồn ⇒ vẫn 9%", async () => {
    await caSach("sbg02", {}, async (k) => {
      const ma = `FXSBG02${Date.now().toString(36).toUpperCase()}`;
      nhomTuTao.push(ma);
      await db.leadSourceGroup.create({ data: { code: ma, name: `FX nguồn tự tạo ${ma}`, sortOrder: 950, commissionEnabled: false } });
      await themChinhSachNhom(k, ma, [{ vai: "MARKETING", kieu: "EXCLUDE" }]);
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-03-01") });
      await ganNguon(k, ma, { attributedAt: D("2026-03-01") });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-04-10") });
      const b = await chay("2026-04");
      expect(maExpected(b)).toEqual(["MARKETING_REMOVED_FOR_NON_AD_SOURCE"]);
      expect(b.expected.cu).toBe(100_000);
      expect(b.expected.moi).toBe(0);
      expect(b.unexpected.soDong, JSON.stringify(b.dong.filter((d) => d.loai === "UNEXPECTED"))).toBe(0);
      expect(b.match.soDong).toBeGreaterThanOrEqual(3); // Sale · Sale Admin · QLCS vẫn khớp

      // Đối chứng dương: bỏ nguồn của lead ⇒ UNKNOWN ⇒ mức THẤP NHẤT giữa các nhóm đang hoạt động — nhóm tự tạo có dòng loại trừ nên UNKNOWN cũng mất Marketing,
      // nhưng mã lý do PHẢI khác (nguồn không rõ), không lẫn với «nguồn không quảng cáo».
      await db.leadTouchpoint.deleteMany({ where: { leadId: k.lead!.id } });
      await db.leadAttribution.deleteMany({ where: { leadId: k.lead!.id } });
      const b2 = await chay("2026-04");
      expect(maExpected(b2), JSON.stringify({ dong: b2.dong.filter((d) => d.loai !== "MATCH"), khoan: b2.khoan })).toEqual(["MARKETING_REMOVED_UNKNOWN_SOURCE"]);
      expect(b2.unexpected.soDong).toBe(0);
    });
  });

  it("[SBG-04d] chủ nguồn thay Marketing (1% ↔ 1%): hai dòng đối nhau MARKETING_MOVED_TO_SOURCE_OWNER, tổng 0 (ca «lệch 1 đồng ⇒ UNEXPECTED» ở bộ thuần [SBG-04])", async () => {
    await caSach("sbg04", {}, async (k) => {
      const ma = `FXSBG04${Date.now().toString(36).toUpperCase()}`;
      nhomTuTao.push(ma);
      const chu = await lamNhanVien(k.qc2.id, `${k.ma}-chu`);
      await db.leadSourceGroup.create({ data: { code: ma, name: `FX quảng cáo ${ma}`, sortOrder: 951, commissionEnabled: true, ownerEmployeeId: chu } });
      await themChinhSachNhom(k, ma, [
        { vai: "SOURCE_OWNER", rate: 0.01 },
        { vai: "MARKETING", kieu: "EXCLUDE" },
      ]);
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-04-01") });
      await ganNguon(k, ma, { attributedAt: D("2026-04-05") });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-05-10") });
      const b = await chay("2026-05");
      expect(maExpected(b), JSON.stringify(b.dong.filter((d) => d.loai !== "MATCH"))).toEqual(["MARKETING_MOVED_TO_SOURCE_OWNER"]);
      expect(b.expected.soDong).toBe(2);
      expect(b.expected.chenh).toBe(0);
      expect(b.unexpected.soDong).toBe(0);
    });
  });

  it("[SBG-06d] nguồn giới thiệu: vai thu hút +2% ⇒ ACQUISITION_ADDED_BY_SOURCE_POLICY và Marketing bị loại ⇒ hai mã khác nhau; cần nâng trần lên 10%", async () => {
    await caSach("sbg06", {}, async (k) => {
      await datTranHoaHong(0.1);
      try {
        const ma = `FXSBG06${Date.now().toString(36).toUpperCase()}`;
        nhomTuTao.push(ma);
        await db.leadSourceGroup.create({ data: { code: ma, name: `FX giới thiệu ${ma}`, sortOrder: 952, commissionEnabled: true } });
        await themChinhSachNhom(k, ma, [
          { vai: "REFERRER_PARENT_SALE", rate: 0.02 },
          { vai: "MARKETING", kieu: "EXCLUDE" },
        ]);
        const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-05-01") });
        await ganNguon(k, ma, { attributedAt: D("2026-05-05"), phHuynhUserId: k.qc.id, saleUserId: k.sale.id });
        await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-06-10") });
        const b = await chay("2026-06");
        expect(maExpected(b), JSON.stringify(b.dong.filter((d) => d.loai !== "MATCH"))).toEqual(["ACQUISITION_ADDED_BY_SOURCE_POLICY", "MARKETING_REMOVED_FOR_NON_AD_SOURCE"]);
        expect(b.expected.chenh).toBe(100_000); // +200.000 người giới thiệu, −100.000 Marketing
        expect(b.unexpected.soDong).toBe(0);
      } finally {
        await datTranHoaHong(null);
      }
    });
  });

  it("[SBG-07d] lỗi thật trong engine mới (Sale 3,99% thay vì 4%) ⇒ đúng một dòng UNEXPECTED trên vai Sale; các vai khác khớp", async () => {
    await caSach("sbg07", { rules: SEED_V1.map((r): RuleFx => (r.vai === "SALE" ? { ...r, rate: 0.0399 } : r)) }, async (k) => {
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-06-01") });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-07-10") });
      const b = await chay("2026-07");
      expect(b.unexpected.soDong).toBe(1);
      expect(b.unexpected.chenh).toBe(-1_000); // 4% − 3,99% = 0,01% × 10.000.000 đ
      expect(dong(b, "SALE")[0]).toMatchObject({ loai: "UNEXPECTED", cu: 400_000, moi: 399_000, ma: "SO_TIEN_KHAC_THEO_NGUON_KHONG_RO" }); // lead của kịch bản không có nguồn ⇒ engine mới coi UNKNOWN (mức thấp nhất) — vẫn UNEXPECTED, chỉ mã chẩn đoán khác
      expect(b.expected.soDong).toBe(0);
    });
  });

  it("[SBG-11d] tái tục: học viên ĐÃ có lần mua trước (engine mới ⇒ tái tục) nhưng ghi danh không gắn cờ `renewedFromEnrollmentId` (engine cũ ⇒ học viên mới) ⇒ EXPECTED EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE (AFF-L2 D-E: engine MỚI là nguồn sự thật; trước đó ca này ra UNEXPECTED PHAN_LOAI_TAI_TUC_KHAC)", async () => {
    await caSach("sbg11", {}, async (k) => {
      // Lần mua TRƯỚC có thực thu — ngày nằm ngoài mọi cửa sổ của bộ này (so bóng cộng MỌI khoản thu trong cửa sổ của cả DB).
      const truoc = await dungBe(k, "b", { tongTien: 10_000_000, ngayDon: D("2025-05-01") });
      await tienVe(k, truoc, { soTien: 10_000_000, ngay: D("2025-05-10") });
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-07-01") });
      // `dungBe` luôn dựng học viên MỚI: gắn dòng đơn của lần mua TRƯỚC về học viên của «a» (đây mới là «đã có lần mua KHÁC»; phân loại đi theo học viên của dòng đơn).
      await db.orderItem.update({ where: { id: truoc.orderItemId }, data: { studentId: be.studentId } });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-08-10") });
      const b = await chay("2026-08");
      expect(b.expected.theoMa, JSON.stringify({ dong: b.dong, khoan: b.khoan })).toHaveProperty("EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE");
      expect(b.expected.theoMa.EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE!.cu).toBeGreaterThan(0);
      expect(b.expected.theoMa.EXPECTED_LEGACY_CLASSIFICATION_DIFFERENCE!.moi).toBe(0);
      // ĐỐI CHỨNG DƯƠNG của mọi thứ còn lại: lệch ĐÃ được giải thích thì không còn UNEXPECTED; cổng cutover (UNEXPECTED > 0) không chặn vì nó.
      expect(b.unexpected.soDong).toBe(0);
    });
  });

  it("[SBG-12d] học cụ: engine cũ trả hoa hồng trên đơn kit, engine mới bỏ ra ngoài ⇒ MATERIAL_OUT_OF_BASE (EXPECTED, D17); lệ phí thi ⇒ UNEXPECTED (04 §4.3 «SUY… Q9»)", async () => {
    await caSach("sbg12", {}, async (k) => {
      const be = await dungBe(k, "a", { tongTien: 2_000_000, ngayDon: D("2026-08-01") });
      await db.order.update({ where: { id: be.orderId }, data: { type: "PRODUCT" } });
      await db.orderItem.update({ where: { id: be.orderItemId }, data: { type: "PRODUCT" } });
      await tienVe(k, be, { soTien: 2_000_000, ngay: D("2026-09-10") });
      const b = await chay("2026-09");
      expect(maExpected(b)).toEqual(["MATERIAL_OUT_OF_BASE"]);
      expect(b.expected.cu).toBe(160_000); // 8% của 2.000.000 (Sale 4 · Sale Admin 1 · QLCS 2 · Marketing 1 — GV Trial không nằm trong chuỗi cũ)
      expect(b.expected.moi).toBe(0);
      expect(b.unexpected.soDong).toBe(0);
      expect(b.ngoai.khoanKhongPhaiHocPhi).toEqual({ soKhoan: 1, soTien: 2_000_000 });

      // đối chứng: cùng khoản nhưng dòng là lệ phí thi (OTHER) ⇒ KHÔNG được chấp nhận
      await db.orderItem.update({ where: { id: be.orderItemId }, data: { type: "EXAM_REGISTRATION" } });
      const b2 = await chay("2026-09");
      expect(b2.expected.soDong).toBe(0);
      expect(b2.unexpected.theoMa).toHaveProperty("THANH_PHAN_KHAC_CHUA_CHOT");
    });
  });

  it("[SBG-13d] khoản thiếu dữ liệu (dòng đơn chưa có học viên ⇒ GIU) đếm ở hàng chờ DỰ KIẾN, KHÔNG thành dòng UNEXPECTED; vai treo thật (không ai phụ trách Marketing) cũng đếm; treo «bình thường» (không có GV Trial) thì KHÔNG", async () => {
    await caSach("sbg13", {}, async (k) => {
      // Tháng 2025-07: KHÔNG spec nào khác của bộ này đặt khoản thu vào đó. Bản đầu dùng 2026-10 — đúng THÁNG HIỆN TẠI của đồng hồ thật lúc viết, nên các spec dùng ngày mặc định
      // của `tienVe` đã để lại 152 khoản ở cửa sổ ấy và ca đỏ khi chạy CẢ bộ (xanh khi chạy một mình — luật 18). Ca này không cần người phụ trách Marketing nên không bị mốc 2026-01-01 của fixture chặn.
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2025-06-01") });
      await db.orderItem.update({ where: { id: be.orderItemId }, data: { studentId: null, enrollmentId: null } });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2025-07-10") });
      const b = await chay("2025-07");
      expect(b.khoan).toMatchObject({ tong: 1, chuaTinh: 1, tinhDuoc: 0 });
      expect(b.dong).toHaveLength(0);
      expect(b.unexpected.soDong).toBe(0);
      expect(b.hold).toMatchObject({ tong: 1, khoanGiu: 1 });
      expect(b.chuaTinh.tienCuDuKien).toBe(800_000);
      expect(Object.keys(b.chuaTinh.theoMa)).toEqual(["CHO_HOC_VIEN"]);
    });
    await caSach("sbg13b", { qc: false }, async (k) => {
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-01-01") });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-02-10") });
      const b = await chay("2026-02");
      expect(b.hold).toMatchObject({ tong: 1, khoanGiu: 0, treoCoHangCho: 1 }); // Marketing không có ai phụ trách ⇒ hàng chờ
    });
  });

  it("[SBG-14d] vượt trần tổng tỉ lệ ⇒ engine mới ghi 0 dòng ⇒ mọi dòng cũ là UNEXPECTED với mã VUOT_TRAN", async () => {
    await caSach("sbg14", { rules: SEED_V1.map((r): RuleFx => (r.vai === "MARKETING" ? { ...r, rate: 0.03 } : r)) }, async (k) => {
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2025-12-01") });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-01-10") });
      const b = await chay("2026-01");
      expect(b.khoan.loiCauHinh).toBe(1);
      expect(Object.keys(b.unexpected.theoMa)).toEqual(["VUOT_TRAN"]);
      expect(b.unexpected.moi).toBe(0);
      expect(b.unexpected.cu).toBe(800_000);
    });
  });

  it("[SBG-15d] GV Trial: engine mới trả 1%, phía cũ ghi lúc convert ⇒ không so theo khoản, nhưng ĐẾM RIÊNG ở `ngoai.trialTeacher`; 0 UNEXPECTED", async () => {
    await caSach("sbg15", {}, async (k) => {
      const gv = await seedUser({ email: `${k.ma}-gv@ci.test`, role: "TEACHER", name: `${k.ma}-gv`, phone: null });
      const leadChildId = await themGvTrial(k, gv.id, "a");
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2025-11-01"), leadChildId });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2025-12-10") });
      const b = await chay("2025-12");
      expect(b.ngoai.trialTeacher).toEqual({ soKhoan: 1, soDong: 1, soTien: 100_000 });
      expect(b.unexpected.soDong).toBe(0);
      expect(b.dong.some((d) => d.roleCode === "TRIAL_TEACHER")).toBe(false);
    });
  });

  it("[SBG-09] CHỈ ĐỌC: đếm dòng 17 bảng sổ / kỳ / hàng chờ / audit / sự kiện trước = sau — và CÙNG bộ đếm PHÁT HIỆN ghi khi chạy engine thật (đối chứng dương: bộ đếm không mù)", async () => {
    await caSach("sbg09", {}, async (k) => {
      // Khoản phải nằm SAU `effectiveFrom` của chính sách fixture (engine THẬT không dời hiệu lực như so bóng nên khoản cũ hơn ⇒ 0 dòng và bộ đếm không thấy gì),
      // và trong cửa sổ MỘT NGÀY riêng (so bóng cộng mọi khoản của cả DB). 18/11/2026 ≤ NOW.
      const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-11-01") });
      const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-11-18") });
      await kiemCuaSoSach([k], "2026-11-18", "2026-11-18");
      const truoc = await demBang();
      const b = await chaySoBong({ client: db, now: NOW, kyP: KY_P, tuNgay: "2026-11-18", denNgay: "2026-11-18", tranSoKhoan: 500 });
      expect(b.khoan.tinhDuoc).toBe(1);
      expect(await demBang()).toEqual(truoc);

      // đối chứng dương: engine THẬT ghi ⇒ bộ đếm phải thấy. Đường ghi đọc lại mốc từ DB (ghi-so.ts) nên mốc phải đặt THẬT, không chỉ trong bối cảnh.
      let sau: Awaited<ReturnType<typeof demBang>>;
      await datMocCutover("2026-11");
      try {
        const bc = await boiCanh(k, NOW, "2026-11");
        expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "DA_GHI" });
        sau = await demBang();
      } finally {
        await datMocCutover(null);
      }
      expect(sau.commissionTransaction).toBeGreaterThan(truoc.commissionTransaction);
      expect(sau.commissionCalcSlot).toBeGreaterThan(truoc.commissionCalcSlot);
    });
  });

  it("[SBG-10d] tất định: hai lượt cùng dấu vân; thêm phiên bản chính sách hiệu lực tại P ⇒ dấu vân ĐỔI; khoản mới trong cửa sổ ⇒ dấu vân ĐỔI", async () => {
    await caSach("sbg10", {}, async (k) => {
      const be = await dungBe(k, "a", { tongTien: 20_000_000, ngayDon: D("2025-09-01") });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2025-10-10") });
      const a1 = await chay("2025-10");
      const a2 = await chay("2025-10");
      expect(a2.dauVan).toBe(a1.dauVan);
      expect(a1.dauVan).toMatch(/^[0-9a-f]{64}$/);

      // phiên bản chính sách mới (đóng bản cũ) ⇒ bộ hiệu lực tại P đổi ⇒ dấu vân đổi
      await taoChinhSachFx(k.ma, SEED_V1, 2, k.chinhSach.policyId, "2026-04-01T00:00:00.000Z");
      const b = await chay("2025-10");
      expect(b.dauVan).not.toBe(a1.dauVan);
      expect(b.chinhSach.map((c) => c.version)).toContain(2);

      // một khoản mới trong cửa sổ ⇒ đổi
      await tienVe(k, be, { soTien: 5_000_000, ngay: D("2025-10-20") });
      const c = await chay("2025-10");
      expect(c.dauVan).not.toBe(b.dauVan);
    });
  });

  it("[SBG-16d] KHÔNG cắt im lặng: vượt trần số khoản ⇒ NÉM QUA_NHIEU_KHOAN; cửa sổ ở tương lai / sai ⇒ NÉM; đối chứng: đủ trần thì chạy", async () => {
    await caSach("sbg16", {}, async (k) => {
      const be = await dungBe(k, "a", { tongTien: 20_000_000, ngayDon: D("2025-08-01") });
      await tienVe(k, be, { soTien: 5_000_000, ngay: D("2025-09-05") });
      await tienVe(k, be, { soTien: 5_000_000, ngay: D("2025-09-15") });
      await expect(chay("2025-09", 1)).rejects.toMatchObject({ ma: "QUA_NHIEU_KHOAN" });
      await expect(chay("2025-09", 2)).resolves.toMatchObject({ khoan: { tong: 2 } });
      await expect(chaySoBong({ client: db, now: NOW, kyP: KY_P, tuNgay: "2026-11-01", denNgay: "2026-12-31", tranSoKhoan: 10 })).rejects.toMatchObject({ ma: "KHOANG_KHONG_HOP_LE" });
      await expect(chaySoBong({ client: db, now: NOW, kyP: "2027-13", tuNgay: "2025-09-01", denNgay: "2025-09-30", tranSoKhoan: 10 })).rejects.toMatchObject({ ma: "KY_KHONG_HOP_LE" });
    });
  });
});
