// @vitest-environment node
/**
 * [NHH-POL-10-DB-*] — THỬ TÍNH chính sách trên Postgres THẬT (04 §14, 05 PR10).
 *
 * Thứ chỉ DB mới chứng minh:
 *   · "hiện tại" của thử tính KHỚP SỔ THẬT do engine ghi trên cùng các khoản (cùng `lapThu` + `tinhDongChoKhoan`), và đề xuất = hiện hành ⇒ chênh 0;
 *   · thử tính KHÔNG ghi gì: đếm dòng MỌI bảng sổ / kỳ / hàng chờ / audit / sự kiện trước-sau bằng nhau — và CÙNG bộ đếm ấy PHÁT HIỆN ghi khi
 *     chạy engine thật (đối chứng dương: bộ đếm không bị mù);
 *   · phạm vi cơ sở của người bấm (khoản của cơ sở khác không lọt vào; id bản nháp của cơ sở khác ra câu "không tìm thấy");
 *   · khoản không tính được (chưa gắn bé, đơn không có lead) được ĐẾM RIÊNG, không số 0 giả;
 *   · trần số khoản: cắt thì NÓI (cat), và biên khoảng ngày MỞ (00:00 VN của ngày sau không vào).
 *
 * Chạy: `pnpm test:hoa-hong-db`. `pnpm test:unit` trần sẽ SKIP.
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18) rồi dọn bằng `donKichBan`. Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import type { Actor } from "../../lib/auth/actor";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { docQuyTacCuaVersion } from "../../lib/hoa-hong/chinh-sach-service";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { khoangMacDinh } from "../../lib/hoa-hong/mo-phong";
import { thuTinhPhienBan } from "../../lib/hoa-hong/mo-phong-hanh-dong";
import { moPhongChinhSach } from "../../lib/hoa-hong/mo-phong-db";
import {
  boiCanh,
  D,
  datMocCutover,
  donKichBan,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  ganNguon,
  hoanTien,
  tienVe,
  type KichBan,
  type RuleFx,
  SEED_V1,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-POL-10-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

let soNhap = 100;
/** Bản NHÁP thay chính sách của kịch bản (version mới, hiệu lực HẸN tương lai — thử tính vẫn áp nó lên khoảng đã qua). */
async function taoNhap(k: KichBan, rules: RuleFx[]): Promise<string> {
  const vai = new Map((await db.beneficiaryRole.findMany({ select: { id: true, code: true } })).map((v) => [v.code, v.id]));
  soNhap += 1;
  const ver = await db.commissionPolicyVersion.create({
    data: { policyId: k.chinhSach.policyId, versionNo: soNhap, status: "DRAFT", effectiveFrom: new Date("2026-12-01T00:00:00.000Z"), reason: "nháp fixture", scopeType: "GLOBAL", scopeKey: "GLOBAL" },
  });
  await db.commissionRule.createMany({
    data: rules.map((r) => ({
      versionId: ver.id,
      transactionTypeCode: r.loai ?? "NEW",
      beneficiaryRoleId: vai.get(r.vai)!,
      revenueComponent: "TUITION" as const,
      calcKind: r.kieu ?? "PERCENT",
      rate: (r.kieu ?? "PERCENT") === "PERCENT" ? r.rate! : null,
      fixedAmount: r.kieu === "FIXED_PER_PURCHASE" ? r.tien! : null,
    })),
  });
  return ver.id;
}

const seedVoi = (sale: number): RuleFx[] => SEED_V1.map((r) => (r.vai === "SALE" ? { ...r, rate: sale } : r));

type Tuy = { tuNgay?: string; denNgay?: string; tamNhin?: "ALL" | string[]; path?: string | null; tranSoKhoan?: number };
async function chay(k: KichBan, deXuat: RuleFx[], t: Tuy = {}) {
  const versionId = await taoNhap(k, deXuat);
  const bc = await boiCanh(k, NOW);
  return moPhongChinhSach({
    client: db,
    bc,
    now: NOW,
    quyTacDeXuat: await docQuyTacCuaVersion(db, versionId),
    policyIdDeXuat: k.chinhSach.policyId,
    tuNgay: t.tuNgay ?? "2026-10-01",
    denNgay: t.denNgay ?? "2026-10-31",
    coSoTrongTamNhin: t.tamNhin ?? "ALL",
    pathPhamVi: t.path === undefined ? k.ouPath : t.path,
    tranSoKhoan: t.tranSoKhoan ?? 500,
  });
}

/** Đếm dòng MỌI bảng mà thử tính không được phép chạm. */
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

const actorCoSo = (centerIds: string[]): Actor =>
  ({ userId: "fx-tt-cs", isSuperAdmin: false, isHoLevel: false, orgRoles: [], permissions: [], visibleCenterIds: centerIds, visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() }) as unknown as Actor;
const actorHo = { userId: "fx-tt-ho", isSuperAdmin: true, isHoLevel: true, orgRoles: [], permissions: [], visibleCenterIds: [], visibleOrgUnitIds: [], grantsAllow: new Set<string>(), assignedClassIds: new Set<string>() } as unknown as Actor;

describe.skipIf(!RUN_DB_TESTS)("[NHH-POL-10-DB] thử tính chính sách", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-POL-10-DB-01] 'hiện tại' KHỚP SỔ THẬT của engine trên cùng 3 đợt thu của MỘT lần mua (cả ba NEW); đề xuất = hiện hành ⇒ chênh 0 mọi chiều", async () => {
    const k = await kb("tt01");
    const be = await dungBe(k, "a", { tongTien: 12_000_000 });
    const dot = [await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-10-05") }), await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-10-12") }), await tienVe(k, be, { soTien: 4_000_000, ngay: D("2026-10-25") })];
    // sổ THẬT do engine ghi
    const bc = await boiCanh(k, NOW);
    for (const id of dot) expect(await quetKhoan(db, bc, id)).toMatchObject({ loai: "DA_GHI" });
    const sổ = (await Promise.all(dot.map(dongSoCuaKhoan))).flat();
    const soTheoVai = new Map<string, number>();
    for (const d of sổ) soTheoVai.set(d.roleCode, (soTheoVai.get(d.roleCode) ?? 0) + d.amount);
    const tongSo = sổ.reduce((s, d) => s + d.amount, 0);
    expect(sổ.every((d) => d.transactionTypeCode === "NEW")).toBe(true);
    expect(tongSo).toBe(960_000); // 4 vai có người: Sale 4 + Admin 1 + QLCS 2 + MKT 1 = 8%; GV Trial không có buổi trial

    const kq = await chay(k, SEED_V1);
    expect(kq.soKhoanTinhDuoc).toBe(3);
    expect(kq.coSo).toBe(12_000_000);
    expect(kq.hoaHong.hienTai).toBe(tongSo);
    for (const v of kq.phanRa.vai) expect(v.hienTai, v.khoa).toBe(soTheoVai.get(v.khoa));
    expect(kq.phanRa.vai).toHaveLength(soTheoVai.size);
    // nhãn là TÊN trong master, không phải mã
    const tenVai = new Map((await db.beneficiaryRole.findMany({ select: { code: true, name: true } })).map((v) => [v.code, v.name]));
    for (const v of kq.phanRa.vai) expect(v.nhan, v.khoa).toBe(tenVai.get(v.khoa));
    expect(kq.phanRa.donVi).toMatchObject([{ khoa: k.centerId, nhan: `ĐV ${k.ma}`, soKhoan: 3, coSo: 12_000_000 }]);
    const tenUnknown = (await db.leadSourceGroup.findFirstOrThrow({ where: { code: "UNKNOWN" }, select: { name: true } })).name;
    expect(kq.phanRa.nguon.map((d) => [d.khoa, d.nhan])).toEqual([["UNKNOWN", tenUnknown]]); // lead chưa có nguồn ⇒ UNKNOWN, nhãn là tên trong master
    // phân loại theo LẦN MUA: 3 đợt thu của cùng dòng đơn ⇒ cả 3 NEW
    expect(kq.phanRa.loai.map((d) => [d.khoa, d.soKhoan])).toEqual([["NEW", 3]]);
    // đề xuất = hiện hành ⇒ chênh 0 ở MỌI chiều
    expect(kq.hoaHong.chenh).toBe(0);
    for (const chieu of Object.values(kq.phanRa)) for (const d of chieu) expect(d.chenh, d.khoa).toBe(0);
    expect(kq.soNguoiAnhHuong).toBe(0);
    expect(kq.cat).toBeNull();
  });

  it("[NHH-POL-10-DB-02] đề xuất Sale 4% → 3%: chênh = −1% × cơ sở, chỉ hàng Sale đổi, đúng 1 người bị ảnh hưởng; sổ thật KHÔNG đổi", async () => {
    const k = await kb("tt02");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    const truoc = await demBang();
    const kq = await chay(k, seedVoi(0.03));
    expect(kq.coSo).toBe(10_000_000);
    expect(kq.hoaHong).toEqual({ hienTai: 800_000, deXuat: 700_000, chenh: -100_000 });
    const sale = kq.phanRa.vai.find((d) => d.khoa === "SALE")!;
    expect([sale.hienTai, sale.deXuat, sale.chenh]).toEqual([400_000, 300_000, -100_000]);
    for (const d of kq.phanRa.vai.filter((x) => x.khoa !== "SALE")) expect(d.chenh, d.khoa).toBe(0);
    expect(kq.soNguoiAnhHuong).toBe(1);
    expect(kq.tiLeHieuDung.hienTai).toBeCloseTo(0.08, 9);
    expect(kq.tiLeHieuDung.deXuat).toBeCloseTo(0.07, 9);
    // chỉ phép tạo bản nháp của CHÍNH ca (taoNhap) đổi bảng; thử tính không đẻ thêm gì
    const sau = await demBang();
    expect(sau.commissionTransaction).toBe(truoc.commissionTransaction);
    expect(sau.commissionPolicyVersion).toBe(truoc.commissionPolicyVersion + 1);
  });

  it("[NHH-POL-10] thử tính KHÔNG GHI GÌ: đếm dòng 17 bảng trước = sau — và bộ đếm PHÁT HIỆN ghi khi chạy engine thật (đối chứng dương)", async () => {
    const k = await kb("tt03");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    const versionId = await taoNhap(k, seedVoi(0.05));
    const quyTacDeXuat = await docQuyTacCuaVersion(db, versionId);
    const bc = await boiCanh(k, NOW);

    const truoc = await demBang();
    const kq = await moPhongChinhSach({ client: db, bc, now: NOW, quyTacDeXuat, policyIdDeXuat: k.chinhSach.policyId, tuNgay: "2026-10-01", denNgay: "2026-10-31", coSoTrongTamNhin: "ALL", pathPhamVi: k.ouPath, tranSoKhoan: 100 });
    const sau = await demBang();
    expect(kq.soKhoanTinhDuoc).toBe(1); // thử tính có chạy thật (không phải rỗng nên "không ghi" mới có nghĩa)
    expect(sau).toEqual(truoc);
    // khoản này CHƯA có StudentTransaction — thử tính tính phân loại trong bộ nhớ rồi bỏ, không lưu
    expect(await db.studentTransaction.count({ where: { orderItemId: be.orderItemId } })).toBe(0);

    // đối chứng dương: engine thật ghi ⇒ bộ đếm PHẢI thấy khác
    await quetKhoan(db, bc, id);
    const saoQuet = await demBang();
    expect(saoQuet.commissionTransaction).toBeGreaterThan(truoc.commissionTransaction);
    expect(saoQuet.commissionCalcSlot).toBeGreaterThan(truoc.commissionCalcSlot);
    expect(saoQuet.studentTransaction).toBeGreaterThan(truoc.studentTransaction);
    expect(saoQuet).not.toEqual(truoc);
  });

  it("[NHH-POL-10-DB-04] vượt trần: Σ 10% > 9% ⇒ khoản bị CỜ (khoản · vai · tỉ lệ · trần), KHÔNG tự cắt, đề xuất đóng góp 0; hiện tại vẫn ra tiền", async () => {
    const k = await kb("tt04");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    const kq = await chay(k, [...seedVoi(0.05)]); // Σ = 5+1+2+1+1 = 10%
    expect(kq.tran.gioiHan).toBeCloseTo(0.09, 9);
    expect(kq.tran.hienTai.soKhoan).toBe(0);
    expect(kq.tran.deXuat.soKhoan).toBe(1);
    const c = kq.tran.deXuat.danhSach[0]!;
    expect(c).toMatchObject({ paymentId: id, kichBan: "deXuat", loai: "NEW", coSo: 10_000_000 });
    expect(c.tiLe).toBeCloseTo(0.1, 9);
    expect(c.vai.map((v) => v.roleCode).sort()).toEqual(["CENTER_MANAGER", "MARKETING", "SALE", "SALE_ADMIN", "TRIAL_TEACHER"]);
    expect(kq.hoaHong.hienTai).toBe(800_000);
    expect(kq.hoaHong.deXuat).toBe(0);
    // giống engine thật: vượt trần ⇒ 0 dòng sổ (và hàng chờ CAP_EXCEEDED) — không tự bỏ vai nào cho vừa
    expect(await dongSoCuaKhoan(id)).toEqual([]);
  });

  it("[NHH-POL-10-DB-05] CHƯA THỂ TÍNH: khoản chưa gắn bé · vai không có người (đơn không có lead) được ĐẾM RIÊNG kèm lý do — không số 0 giả, không vào tổng", async () => {
    const k = await kb("tt05");
    // (a) đơn 2 bé, khoản thu KHÔNG gắn dòng nào ⇒ hàng chờ, không tính
    const beA = await dungBe(k, "a", { tongTien: 5_000_000 });
    await dungBe(k, "b", { tongTien: 5_000_000, donSan: beA.orderId });
    // khoản thu cũ chưa từng được gắn ghi danh: xác nhận được khi còn ghi danh, rồi gỡ ghi danh đi (dữ liệu trước convert)
    const chua = await tienVe(k, beA, { soTien: 3_000_000, ngay: D("2026-10-08"), gan: false });
    await db.payment.update({ where: { id: chua }, data: { enrollmentId: null } });
    // (b) đơn KHÔNG có lead ⇒ Sale + Sale Admin treo; QLCS + MKT vẫn có người
    const beC = await dungBe(k, "c", { tongTien: 10_000_000, coLead: false });
    await tienVe(k, beC, { soTien: 10_000_000, ngay: D("2026-10-09") });

    const kq = await chay(k, SEED_V1);
    expect(kq.chuaTinh.soKhoan).toBe(1);
    expect(kq.chuaTinh.theoLyDo[0]).toMatchObject({ soKhoan: 1, soTien: 3_000_000 });
    expect(kq.chuaTinh.theoLyDo[0]!.ma).toBe("CHUA_GAN_CON");
    expect(kq.soKhoanTinhDuoc).toBe(1);
    expect(kq.coSo).toBe(10_000_000); // khoản chưa gắn KHÔNG góp vào cơ sở
    const th = kq.thieuNguoi.hienTai.find((x) => x.ma === "KHONG_CO_LEAD")!;
    expect(th.soKhoan).toBe(2); // Sale + Sale Admin
    expect(th.soTien).toBe(500_000); // 4% + 1% tiềm năng — báo, không tính
    expect(kq.hoaHong.hienTai).toBe(300_000); // chỉ QLCS 2% + MKT 1%
    expect(kq.phanRa.vai.map((d) => d.khoa).sort()).toEqual(["CENTER_MANAGER", "MARKETING"]);
  });

  it("[NHH-POL-10-DB-06] hoàn tiền KHÔNG tính (đếm riêng, nói ra); khoản thu dương vẫn tính đủ", async () => {
    const k = await kb("tt06");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-05") });
    await hoanTien(k, id, { soTien: 2_000_000, ngay: D("2026-10-20") });
    const kq = await chay(k, SEED_V1);
    expect(kq.soKhoanTinhDuoc).toBe(1);
    expect(kq.ngoai.soKhoanHoan).toBe(1);
    expect(kq.ngoai.tienHoan).toBe(-2_000_000);
    expect(kq.soKhoanTrongKhoang).toBe(1); // khoản âm KHÔNG nằm trong số khoản thu dương
    expect(kq.cat).toBeNull();
    expect(kq.coSo).toBe(10_000_000);
    expect(kq.hoaHong.hienTai).toBe(800_000);
  });

  it("[NHH-POL-10-DB-07] CẮT có nói: tranSoKhoan=2 trên 3 khoản ⇒ xét 2 khoản MỚI nhất, cat báo số chưa xét + mốc ngày", async () => {
    const k = await kb("tt07");
    // số tiền KHÁC nhau để biết CHÍNH XÁC khoản nào được xét (khoản cũ nhất 10tr bị bỏ, 20tr + 30tr được giữ)
    for (const [ten, ngay, tien] of [["a", "2026-10-05", 10_000_000], ["b", "2026-10-12", 20_000_000], ["c", "2026-10-25", 30_000_000]] as const) {
      const be = await dungBe(k, ten, { tongTien: tien });
      await tienVe(k, be, { soTien: tien, ngay: D(ngay) });
    }
    const kq = await chay(k, SEED_V1, { tranSoKhoan: 2 });
    expect(kq.soKhoanTrongKhoang).toBe(3);
    expect(kq.soKhoanTinhDuoc).toBe(2);
    expect(kq.cat).toEqual({ tran: 2, soKhoanChuaXet: 1, xetTuNgay: "2026-10-12" });
    expect(kq.coSo).toBe(50_000_000);
    // đối chứng âm: không cắt thì cat = null
    const khongCat = await chay(k, SEED_V1, { tranSoKhoan: 3 });
    expect(khongCat.cat).toBeNull();
    expect(khongCat.soKhoanTinhDuoc).toBe(3);
    expect(khongCat.coSo).toBe(60_000_000);
  });

  it("[NHH-POL-10-DB-08] biên khoảng: 00:00 VN ngày 01/10 VÀO (đầu đóng) · 23:59:59 VN ngày 31/10 VÀO · 00:00 VN ngày 01/11 KHÔNG (đầu sau mở) · 23:59:59 VN ngày 30/09 KHÔNG", async () => {
    const k = await kb("tt08");
    const moc = ["2026-09-30T16:59:59.000Z", "2026-09-30T17:00:00.000Z", "2026-10-31T16:59:59.000Z", "2026-10-31T17:00:00.000Z"];
    for (const [i, t] of moc.entries()) {
      const be = await dungBe(k, `b${i}`, { tongTien: 10_000_000 });
      await tienVe(k, be, { soTien: 10_000_000, ngay: new Date(t) });
    }
    const kq = await chay(k, SEED_V1);
    expect(kq.soKhoanTrongKhoang).toBe(2); // 01/10 00:00 và 31/10 23:59:59
    expect(kq.soKhoanTinhDuoc).toBe(2);
    const thang11 = await chay(k, SEED_V1, { tuNgay: "2026-11-01", denNgay: "2026-11-30" });
    expect(thang11.soKhoanTrongKhoang).toBe(1); // đúng khoản 00:00 VN ngày 01/11
    const thang9 = await chay(k, SEED_V1, { tuNgay: "2026-09-01", denNgay: "2026-09-30" });
    expect(thang9.soKhoanTrongKhoang).toBe(1); // đúng khoản 23:59:59 ngày 30/09
  });

  it("[NHH-POL-10-DB-09] PHẠM VI cơ sở: tầm nhìn [A] chỉ thấy khoản của A; ALL thấy cả A và B (đối chứng dương); lọc theo đơn vị thu hẹp thêm", async () => {
    const a = await kb("tt09a");
    const b = await kb("tt09b");
    for (const [k, ten] of [[a, "a"], [b, "b"]] as const) {
      const be = await dungBe(k, ten, { tongTien: 10_000_000 });
      await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    }
    // chính sách GLOBAL của A áp cho cả hai cơ sở (bối cảnh chỉ nạp chính sách của A) — để B có số mà so
    const chiA = await chay(a, SEED_V1, { tamNhin: [a.centerId], path: null });
    expect(chiA.soKhoanTinhDuoc).toBe(1);
    expect(chiA.phanRa.donVi.map((d) => d.khoa)).toEqual([a.centerId]);
    const tatCa = await chay(a, SEED_V1, { tamNhin: "ALL", path: null });
    expect(tatCa.soKhoanTinhDuoc).toBeGreaterThanOrEqual(2);
    expect(tatCa.phanRa.donVi.map((d) => d.khoa)).toEqual(expect.arrayContaining([a.centerId, b.centerId]));
    // tầm nhìn [A] nhưng lọc đơn vị B ⇒ giao rỗng
    const giaoRong = await chay(a, SEED_V1, { tamNhin: [a.centerId], path: b.ouPath });
    expect(giaoRong.soKhoanTinhDuoc).toBe(0);
    expect(giaoRong.soKhoanTrongKhoang).toBe(0);
    // tầm nhìn rỗng ⇒ không thấy gì
    const khongThay = await chay(a, SEED_V1, { tamNhin: [], path: null });
    expect(khongThay.soKhoanTinhDuoc).toBe(0);
    // ALL + lọc đơn vị A ⇒ chỉ khoản của A (lọc đơn vị phải còn hiệu lực khi tầm nhìn là ALL)
    const allTrongA = await chay(a, SEED_V1, { tamNhin: "ALL", path: a.ouPath });
    expect(allTrongA.soKhoanTinhDuoc).toBe(1);
    expect(allTrongA.phanRa.donVi.map((d) => d.khoa)).toEqual([a.centerId]);
  });

  it("[NHH-POL-10-DB-09b] cơ sở của khoản suy theo ĐÚNG chuỗi của engine: Payment.centerId → đơn → lead (khoản cũ thiếu cột vẫn lọt đúng cơ sở)", async () => {
    const k = await kb("tt09c");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    const kh = await kb("tt09d"); // cơ sở khác: không được lẫn vào
    // (1) khoản chưa có cột cơ sở ⇒ lấy từ ĐƠN
    await db.payment.update({ where: { id }, data: { centerId: null } });
    const quaDon = await chay(k, SEED_V1, { tamNhin: [k.centerId], path: null });
    expect(quaDon.phanRa.donVi.map((d) => d.khoa)).toEqual([k.centerId]);
    expect(quaDon.soKhoanTinhDuoc).toBe(1);
    expect((await chay(k, SEED_V1, { tamNhin: [kh.centerId], path: null })).soKhoanTinhDuoc).toBe(0);
    // (2) đơn cũng thiếu cơ sở ⇒ lấy từ LEAD
    await db.order.update({ where: { id: be.orderId }, data: { centerId: null } });
    const quaLead = await chay(k, SEED_V1, { tamNhin: [k.centerId], path: null });
    expect(quaLead.phanRa.donVi.map((d) => d.khoa)).toEqual([k.centerId]);
    expect(quaLead.soKhoanTinhDuoc).toBe(1);
    expect((await chay(k, SEED_V1, { tamNhin: [kh.centerId], path: null })).soKhoanTinhDuoc).toBe(0);
  });

  it("[NHH-POL-10-DB-10] Server Action tầng dưới: bản nháp của cơ sở khác = 'không tìm thấy' (cùng câu với không tồn tại); khoảng sai trả lỗi khoảng; mặc định = 3 tháng trọn vẹn", async () => {
    const a = await kb("tt10a");
    const b = await kb("tt10b");
    const versionB = await taoNhap(b, SEED_V1);
    // bản nháp thuộc RIÊNG cơ sở B (centerId của bản ghi = B) — không còn là bản dùng chung
    await db.commissionPolicy.update({ where: { id: b.chinhSach.policyId }, data: { centerId: b.centerId } });
    await db.commissionPolicyVersion.update({ where: { id: versionB }, data: { centerId: b.centerId } });

    const tuA = await thuTinhPhienBan({ actor: actorCoSo([a.centerId]), now: NOW, versionId: versionB, tuNgay: null, denNgay: null, orgUnitId: null });
    expect(tuA).toEqual({ ok: false, chung: expect.stringMatching(/Không tìm thấy chính sách/) });
    const khongTonTai = await thuTinhPhienBan({ actor: actorCoSo([a.centerId]), now: NOW, versionId: "khong-co-id-nay", tuNgay: null, denNgay: null, orgUnitId: null });
    expect(khongTonTai).toEqual(tuA); // KHÔNG phân biệt "của người khác" với "không tồn tại"

    // mỗi cơ sở có MỘT khoản thu trong khoảng mặc định (08–10/2026): người chỉ thấy B chỉ được thấy khoản của B
    for (const [k, ten] of [[a, "a"], [b, "b"]] as const) await tienVe(k, await dungBe(k, ten, { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-10-10") });
    const tuB = await thuTinhPhienBan({ actor: actorCoSo([b.centerId]), now: NOW, versionId: versionB, tuNgay: null, denNgay: null, orgUnitId: null });
    expect(tuB.ok).toBe(true);
    if (tuB.ok) {
      expect(tuB.ketQua.soKhoanTrongKhoang).toBe(1); // KHÔNG phải 2: khoản của A nằm ngoài tầm nhìn
      expect(tuB.ketQua.phamVi.soCoSo).toBe(1);
      expect(tuB.ketQua.khoang).toEqual(khoangMacDinh(NOW)); // 2026-08-01 → 2026-10-31
      expect(tuB.chayLuc).toBe(NOW.toISOString());
      const v = await db.commissionPolicyVersion.findUniqueOrThrow({ where: { id: versionB }, select: { updatedAt: true } });
      expect(tuB.phienBanCapNhatLuc).toBe(v.updatedAt.toISOString());
    }
    // đối chứng dương: Hội sở (ALL) thấy CẢ HAI khoản
    const hoThay = await thuTinhPhienBan({ actor: actorHo, now: NOW, versionId: versionB, tuNgay: null, denNgay: null, orgUnitId: null });
    expect(hoThay.ok).toBe(true);
    if (hoThay.ok) expect(hoThay.ketQua.soKhoanTrongKhoang).toBeGreaterThanOrEqual(2);
    const ho = await thuTinhPhienBan({ actor: actorHo, now: NOW, versionId: versionB, tuNgay: "2026-10-31", denNgay: "2026-10-01", orgUnitId: null });
    expect(ho).toMatchObject({ ok: false, loiKhoang: expect.stringMatching(/từ ngày bắt đầu/) });
    const lech = await thuTinhPhienBan({ actor: actorHo, now: NOW, versionId: versionB, tuNgay: "2026-10-01", denNgay: null, orgUnitId: null });
    expect(lech).toMatchObject({ ok: false });
    const dvLa = await thuTinhPhienBan({ actor: actorHo, now: NOW, versionId: versionB, tuNgay: null, denNgay: null, orgUnitId: "khong-co-don-vi" });
    expect(dvLa).toEqual({ ok: false, chung: "Không tìm thấy đơn vị đã chọn." });
  });

  it("[NHH-POL-10-DB-11] thử tính KHÔNG phụ thuộc mốc cutover: khoản tháng 9 (TRƯỚC mốc 2026-10, engine thật sẽ bỏ qua vì thuộc sổ cũ) vẫn được tính", async () => {
    const k = await kb("tt11");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-09-10") });
    expect(await quetKhoan(db, await boiCanh(k, NOW), id)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_PHAI_CHU" }); // đối chứng: engine thật KHÔNG ghi
    const kq = await chay(k, SEED_V1, { tuNgay: "2026-09-01", denNgay: "2026-09-30" });
    expect(kq.soKhoanTinhDuoc).toBe(1);
    expect(kq.hoaHong.hienTai).toBe(800_000);
    expect(kq.ngoai.soKhoanKhongPhaiHocPhi).toBe(0);
  });

  it("[NHH-POL-10-DB-12] vai CHỈ có ở bản đề xuất (chính sách hiện hành chưa trả Marketing): có người hưởng, 'hiện tại' 0, 'đề xuất' > 0", async () => {
    const k = await kb("tt12", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    const kq = await chay(k, [{ vai: "SALE", rate: 0.04 }, { vai: "MARKETING", rate: 0.01 }]);
    expect(kq.hoaHong).toEqual({ hienTai: 400_000, deXuat: 500_000, chenh: 100_000 });
    const mkt = kq.phanRa.vai.find((d) => d.khoa === "MARKETING")!;
    expect([mkt.hienTai, mkt.deXuat]).toEqual([0, 100_000]);
    expect(kq.soNguoiAnhHuong).toBe(1);
  });

  it("[NHH-POL-10-DB-13] cặp chuyển tiền nội bộ giữa hai bé KHÔNG tính (engine thật cũng không tự quyết) — đếm riêng, nói ra", async () => {
    const k = await kb("tt13");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const id = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    await db.payment.update({ where: { id }, data: { method: "chuyen-noi-bo", note: "[chuyen:fx-tt13]" } });
    const kq = await chay(k, SEED_V1);
    expect(kq.soKhoanTinhDuoc).toBe(0);
    expect(kq.ngoai.soKhoanChuyenNoiBo).toBe(1);
    expect(kq.hoaHong.hienTai).toBe(0);
  });

  it("[NHH-POL-10-DB-14] phân rã theo NGUỒN dùng nhóm nguồn THẬT của lead (không phải UNKNOWN) và nhãn là tên nhóm", async () => {
    const k = await kb("tt14");
    await ganNguon(k, "PAID_ADS");
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-10") });
    const nhom = await db.leadSourceGroup.findFirstOrThrow({ where: { code: "PAID_ADS" }, select: { name: true } });
    const kq = await chay(k, SEED_V1);
    expect(kq.phanRa.nguon.map((d) => [d.khoa, d.nhan, d.soKhoan, d.coSo])).toEqual([["PAID_ADS", nhom.name, 1, 10_000_000]]);
    expect(kq.hoaHong.hienTai).toBe(800_000);
  });
});
