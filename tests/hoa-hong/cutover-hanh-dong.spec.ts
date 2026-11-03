// @vitest-environment node
/**
 * [CUT-*] — HÀNH ĐỘNG ĐẶT MỐC CUTOVER có xem trước + precheck + compare-and-set + audit, trên Postgres THẬT (05 §2.2c, §7.5; 08 §11 bước 7).
 * Luật cổng nghiệp vụ của mốc (bảng kê, manifest, dòng sổ mới, khoá advisory) đã có bộ riêng `cutover.spec.ts` ([NHH-PER-03*]); bộ này canh những gì LỚP MỚI thêm:
 *
 *   · QUYỀN ở Server Action, chạy THẬT (session giả CHỈ ở `auth()`, `assertPermission`/`resolveActor` đọc Postgres): chưa đăng nhập · thiếu `settings:edit` ⇒ KHÔNG đổi gì;
 *     đối chứng dương: Quản trị tối cao đi hết đường;
 *   · XEM TRƯỚC không ghi gì (đếm dòng 17 bảng + SystemSetting + AuditLog trước/sau);
 *   · PRECHECK là một phần của cổng ghi: từng điều kiện chặn, «không đo» chặn, DOI_MUON/GO không đòi;
 *   · COMPARE-AND-SET: mốc đã đổi ⇒ MOC_DA_DOI, dấu vân đã đổi ⇒ SO_LIEU_DA_DOI — cả hai KHÔNG ghi;
 *   · thành công: `SystemSetting` đổi + audit đủ (ai · lúc nào · cũ · mới · lý do · bằng chứng đã xem) + `docMocCutover` thấy mốc mới NGAY (không qua cache 300 giây);
 *   · lịch sử đọc đúng thứ tự; SAU cutover engine mới ghi kỳ P và không ghi kỳ < P.
 *
 * Số bằng chứng thật (hàng chờ · chênh) đo qua `xemTruocCutover` với PHU_THUOC thật; điều kiện cần số mà DB test khó dựng (Invalid · di trú xong) thì bơm qua `phuThuoc` giả.
 * Công cụ di trú THẬT (hướng EF, `lib/nguon/di-tru-tinh-trang.ts`) đã thay STUB: KHÔNG còn «sanSang luôn false». Bơm giả ở bộ này chỉ để đo các cổng KHÁC; còn câu hỏi «dữ liệu sạch / đã backfill thì cổng
 * di trú MỞ, thiếu quy nguồn / có Invalid / bảng vắng thì ĐÓNG đúng lý do» được đo ở bộ riêng `cutover-di-tru-that.spec.ts` ([CDT-*]) bằng `phuThuocCutoverThat` trên Postgres thật.
 *
 * Mỗi kịch bản dựng cơ sở riêng (luật 18) ⇒ chạy ĐƯỢC MỘT MÌNH. Ngày TUYỆT ĐỐI (luật 19). Mỗi ca dùng cửa sổ MỘT NGÀY riêng (11/2026) để khoản của ca khác không lọt vào.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

const SESS = vi.hoisted(() => ({
  current: null as null | { user: { id: string; role: string; roles: string[]; centerId: string | null; name: string; email: string } },
}));
vi.mock("@/lib/auth", () => ({ auth: async () => SESS.current }));
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidatePath: () => {} }));
vi.setConfig({ testTimeout: 120_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { datMocCutover, docMocCutover, napGoiBangChung } from "../../lib/hoa-hong/cutover";
import { docLichSuCutover, xemTruocCutover } from "../../lib/hoa-hong/cutover-hanh-dong";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { xacNhanCutoverAction, xemTruocCutoverAction } from "../../app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/_actions";
import { BANG_CHUNG_SACH, DAU_VAN_GIA_SACH, PHU_THUOC_SACH, datMocDaXem, phuThuocCoBangChung } from "./_cutover-phu-thuoc";
import { actorCua, boiCanh, D, datMocCutover as datMocTay, donKichBan, dungBe, dungKichBan, ganVai, donViHoiSo, kiemCuaSoSach, tienVe, SEED_V1, type KichBan, type RuleFx } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[CUT-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const KHOA = "hoaHong.kyCutover";
const P = "2027-03";
const NOW = D("2027-02-10");
const LY_DO = "BGĐ duyệt chuyển hoa hồng mới (ca test)";
const giaTriMoc = async () => (await db.systemSetting.findUnique({ where: { key: KHOA } }))?.valueJson ?? null;
const demAudit = () => db.auditLog.count({ where: { entityType: "SystemSetting", entityId: KHOA } });
// Cửa sổ MỘT NGÀY: so bóng cộng MỌI khoản thu trong cửa sổ của cả DB (không chỉ của kịch bản này), nên mỗi ca dùng một ngày RIÊNG — khoản của ca khác / spec khác không lọt vào.
// Phải nằm trong năm 2026: người phụ trách Marketing của fixture có hiệu lực từ 2026-01-01 (khoản trước đó không có ai ⇒ chênh vô nghĩa). Tháng 11-12/2026 không spec so bóng nào dùng.
const cuaSo = (ngay: string) => ({ tuNgay: ngay, denNgay: ngay });
// Cửa sổ cho ca ĐẾM khoản: trước khi đo KHẲNG ĐỊNH ngày ấy không còn khoản thu của spec khác (đo 11/10/2026: [CUT-A02] đỏ «tổng 12 thay vì 1» chỉ khi chạy cả thư mục — spec chạy trước
// ghi khoản thu 10/11/2026 rồi không dọn; thứ tự file do vitest xếp theo thời gian chạy lần trước nên không cố định). Có khoản lạ ⇒ NÉM nêu tên đơn, thay cho ca đỏ lệch số không ai giải thích được.
const cuaSoSach = async (ngay: string) => {
  await kiemCuaSoSach(cuaToi, ngay, ngay);
  return cuaSo(ngay);
};

const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}

let SA: { actor: Awaited<ReturnType<typeof actorCua>>; ten: string; id: string };
let KE_TOAN_ID = "";
const phien = (id: string, role: string, name: string) => ({ user: { id, role, roles: [role], centerId: null, name, email: `${name}@ci.test` } });

describe.skipIf(!RUN_DB_TESTS)("[CUT-DB] hành động đặt mốc cutover", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocTay(null);
    const ten = `Quản trị tối cao CUT ${Date.now().toString(36)}`;
    const sa = await seedUser({ email: `fx-cut-sa-${Date.now().toString(36)}@ci.test`, role: "SUPER_ADMIN", name: ten, phone: null });
    await ganVai(sa.id, await donViHoiSo(), "SUPER_ADMIN");
    SA = { actor: await actorCua(sa.id), ten, id: sa.id };
    const kt = await seedUser({ email: `fx-cut-kt-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Kế toán CUT", phone: null });
    await ganVai(kt.id, await donViHoiSo(), "HO_ACCOUNTANT");
    KE_TOAN_ID = kt.id;
  }, 120_000);
  afterEach(async () => {
    SESS.current = null;
    await datMocTay(null);
    // Dọn kịch bản của CA NÀY ngay: mỗi kịch bản cài một chính sách GLOBAL đang hiệu lực, hai chính sách cùng hạng sống chung ⇒ `CHONG_LAN` và so bóng ra «0 dòng» cho ca sau.
    await donKichBan(cuaToi.splice(0));
  });
  afterAll(async () => {
    await donKichBan(cuaToi);
    await datMocTay(null);
  }, 60_000);

  it("[CUT-A01] QUYỀN ở Server Action (RBAC chạy thật): chưa đăng nhập · kế toán (thiếu settings:view/edit) ⇒ từ chối và KHÔNG đổi gì; Quản trị tối cao đi hết đường (đối chứng dương)", async () => {
    await datMocTay(P);
    const truocAudit = await demAudit();
    const vao = { moi: null as string | null, ...cuaSo("2026-11-02") };

    // 1) chưa đăng nhập
    SESS.current = null;
    expect(await xemTruocCutoverAction(vao)).toMatchObject({ ok: false, ma: "CHUA_DANG_NHAP" });
    expect(await xacNhanCutoverAction({ moi: null, lyDo: LY_DO, ...cuaSo("2026-11-02"), cuDaXem: P, dauVanDaXem: "x" })).toMatchObject({ ok: false, ma: "CHUA_DANG_NHAP" });

    // 2) kế toán HO: KHÔNG có settings:view / settings:edit (không RoleDef nào của seed giữ) ⇒ KHONG_QUYEN, nêu khoá
    SESS.current = phien(KE_TOAN_ID, "ACCOUNTANT", "Kế toán CUT");
    const xem = await xemTruocCutoverAction(vao);
    expect(xem).toMatchObject({ ok: false, ma: "KHONG_QUYEN" });
    expect((xem as { loi: string }).loi).toContain("settings:view");
    const ghi = await xacNhanCutoverAction({ moi: null, lyDo: LY_DO, ...cuaSo("2026-11-02"), cuDaXem: P, dauVanDaXem: "x" });
    expect(ghi).toMatchObject({ ok: false, ma: "KHONG_QUYEN" });
    expect((ghi as { loi: string }).loi).toContain("settings:edit");
    expect(await giaTriMoc()).toBe(P);
    expect(await demAudit()).toBe(truocAudit);

    // 3) ĐỐI CHỨNG DƯƠNG: Quản trị tối cao xem trước rồi gỡ mốc (GO không đòi precheck) ⇒ ghi được, qua ĐÚNG hai action
    SESS.current = phien(SA.id, "SUPER_ADMIN", SA.ten);
    const x2 = await xemTruocCutoverAction(vao);
    expect(x2).toMatchObject({ ok: true, xem: { cu: P, moi: null, hanhDong: "GO", sanSang: true, canPrecheck: false, tacDong: null } });
    if (!x2.ok) throw new Error("tự kiểm");
    const g2 = await xacNhanCutoverAction({ moi: null, lyDo: LY_DO, ...cuaSo("2026-11-02"), cuDaXem: x2.xem.cu, dauVanDaXem: x2.xem.dauVan });
    expect(g2, JSON.stringify(g2)).toMatchObject({ ok: true });
    expect(await giaTriMoc()).toBeNull();
    expect(await demAudit()).toBe(truocAudit + 1);
  });

  it("[CUT-A02] XEM TRƯỚC KHÔNG GHI GÌ: đếm SystemSetting + AuditLog + 15 bảng sổ/hàng chờ/kỳ/chính sách trước = sau, trên cả đường DAT_LAN_DAU chạy so bóng thật", async () => {
    const k = await kb("cut-a02");
    const be = await dungBe(k, "a", { tongTien: 10_000_000, ngayDon: D("2026-11-01") });
    // Ngày 17/11/2026: KHÔNG spec nào khác trong `tests/hoa-hong` dùng (đo grep 11/10). Trước đây là 10/11 — `chu-nguon-khong-hoi-to.spec.ts` dựng khoản thu đúng ngày đó và để lại,
    // nên chạy CẢ thư mục thì `khoan.tong` ra 12 thay vì 1 (cửa sổ một ngày cộng MỌI khoản thu của cả DB), còn chạy riêng thì xanh — đỏ vì thứ tự, không vì mã.
    await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-11-17") });
    const dem = async () => ({
      setting: await db.systemSetting.count(),
      audit: await db.auditLog.count(),
      giaoDich: await db.commissionTransaction.count(),
      hangCho: await db.commissionHold.count(),
      o: await db.commissionCalcSlot.count(),
      ky: await db.commissionPeriod.count(),
      st: await db.studentTransaction.count(),
      chinhSach: await db.commissionPolicyVersion.count(),
      nguon: await db.leadAttribution.count(),
      bangKe: await db.commissionStatement.count(),
    });
    const truoc = await dem();
    const r = await xemTruocCutover({ moi: P, now: NOW, cuaSo: await cuaSoSach("2026-11-17") });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) throw new Error("tự kiểm");
    expect(r.xem.hanhDong).toBe("DAT_LAN_DAU");
    expect(r.xem.tacDong?.khoan.tong).toBe(1);
    expect(await dem()).toEqual(truoc);
    expect(await giaTriMoc()).toBeNull();
  });

  it("[CUT-A03] CẢNH BÁO KHÔNG CHẶN: xem trước nói ĐÚNG những gì đặt thật sẽ ghi vào audit (vai chưa có chính sách ACTIVE tại kỳ P); dời muộn / gỡ không cảnh báo ở cả hai phía", async () => {
    // Kịch bản chỉ có chính sách SALE ⇒ các vai khác chưa có chính sách ACTIVE hiệu lực tại đầu kỳ P. `canhBaoChinhSach` đọc DB trực tiếp, không qua `phuThuoc`,
    // nên bằng chứng giả ở bước ĐẶT không làm lệch phép so này (xem trước dùng `phuThuoc` thật, đặt dùng `PHU_THUOC_SACH`).
    await kb("cut-a03", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const xem = await xemTruocCutover({ moi: P, now: NOW, cuaSo: await cuaSoSach("2026-11-04") });
    if (!xem.ok) throw new Error(JSON.stringify(xem));
    expect(xem.xem.hanhDong).toBe("DAT_LAN_DAU");
    expect(xem.xem.canhBao.length, "xem trước phải CÓ cảnh báo — khối «Cảnh báo không chặn» không được chết").toBe(1);
    expect(xem.xem.canhBao[0]).toContain(`Chưa có chính sách ACTIVE hiệu lực tại ${P} cho vai:`);
    expect(xem.xem.canhBao[0]).not.toMatch(/vai:.*\bSALE\b/); // vai SALE có chính sách ⇒ không bị liệt kê (đối chứng: cảnh báo không phải chuỗi cố định)

    // ĐẶT thật (bằng chứng giả để qua precheck) ⇒ audit ghi ĐÚNG chuỗi mà xem trước đã hiện.
    const dat = await datMocDaXem(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW });
    expect(dat.canhBao).toEqual(xem.xem.canhBao);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "SystemSetting", entityId: KHOA }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect((a.newValues as { canhBao: unknown }).canhBao).toEqual(xem.xem.canhBao);

    // DOI_MUON: không giao thêm tháng nào cho engine mới ⇒ không cảnh báo, ở CẢ xem trước lẫn đặt thật.
    const muon = await xemTruocCutover({ moi: "2027-06", now: NOW, cuaSo: await cuaSoSach("2026-11-04") });
    if (!muon.ok) throw new Error(JSON.stringify(muon));
    expect(muon.xem.hanhDong).toBe("DOI_MUON");
    expect(muon.xem.canhBao).toEqual([]);
    expect((await datMocDaXem(db, SA, { mocMoi: "2027-06", lyDo: LY_DO, now: NOW })).canhBao).toEqual([]);
    // GO: cũng không.
    const go = await xemTruocCutover({ moi: null, now: NOW, cuaSo: await cuaSoSach("2026-11-04") });
    if (!go.ok) throw new Error(JSON.stringify(go));
    expect(go.xem.hanhDong).toBe("GO");
    expect(go.xem.canhBao).toEqual([]);
  });

  it("[CUT-P01d] bằng chứng THẬT từ so bóng: khoản lệch ngoài dự kiến (Sale 3,99%) ⇒ unexpectedDelta = 1 và CO_CHENH_BAT_NGO nằm trong danh sách chặn; engine khớp ⇒ 0 và KHÔNG có mã đó (đối chứng dương)", async () => {
    const lech = await kb("cut-p01a", { rules: SEED_V1.map((r): RuleFx => (r.vai === "SALE" ? { ...r, rate: 0.0399 } : r)) });
    await tienVe(lech, await dungBe(lech, "a", { tongTien: 10_000_000, ngayDon: D("2026-11-01") }), { soTien: 10_000_000, ngay: D("2026-11-11") });
    const a = await xemTruocCutover({ moi: P, now: NOW, cuaSo: await cuaSoSach("2026-11-11") });
    if (!a.ok) throw new Error(JSON.stringify(a));
    expect(a.xem.bangChung.unexpectedDelta).toBe(1);
    expect(a.xem.chan.map((c) => c.ma)).toContain("CO_CHENH_BAT_NGO");
    expect(a.xem.sanSang).toBe(false);
    expect(a.xem.tacDong?.unexpected.theoMa.map((m) => m.ma)).toEqual(["SO_TIEN_KHAC_THEO_NGUON_KHONG_RO"]) // lead của kịch bản không có nguồn ⇒ UNKNOWN; mã chẩn đoán, vẫn UNEXPECTED;

    await donKichBan(cuaToi.splice(0)); // hai chính sách GLOBAL sống chung ⇒ CHONG_LAN: dọn kịch bản «lệch» trước khi dựng kịch bản «khớp»
    const khop = await kb("cut-p01b");
    await tienVe(khop, await dungBe(khop, "a", { tongTien: 10_000_000, ngayDon: D("2026-11-01") }), { soTien: 10_000_000, ngay: D("2026-11-12") });
    const b = await xemTruocCutover({ moi: P, now: NOW, cuaSo: await cuaSoSach("2026-11-12") });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.xem.bangChung.unexpectedDelta).toBe(0);
    expect(b.xem.chan.map((c) => c.ma)).not.toContain("CO_CHENH_BAT_NGO");
  });

  it("[CUT-P02] hàng chờ DỰ KIẾN đo từ kết quả so bóng, không từ bảng CommissionHold: thiếu người phụ trách Marketing ⇒ 1; treo «bình thường» (không có GV Trial) ⇒ 0 — và bảng CommissionHold vẫn rỗng (engine tắt)", async () => {
    const co = await kb("cut-p02a", { qc: false });
    await tienVe(co, await dungBe(co, "a", { tongTien: 10_000_000, ngayDon: D("2026-11-01") }), { soTien: 10_000_000, ngay: D("2026-11-13") });
    const demHangChoTruoc = await db.commissionHold.count({ where: { paymentId: { not: null } } });
    const a = await xemTruocCutover({ moi: P, now: NOW, cuaSo: await cuaSoSach("2026-11-13") });
    if (!a.ok) throw new Error(JSON.stringify(a));
    expect(a.xem.bangChung.holdNghiemTrongDuKien).toBe(1);
    expect(a.xem.chan.map((c) => c.ma)).toContain("CO_HOLD_DU_KIEN");
    expect(await db.commissionHold.count({ where: { paymentId: { not: null } } })).toBe(demHangChoTruoc);

    await donKichBan(cuaToi.splice(0)); // như trên — nếu không, ca «đối chứng» ra 0 vì CHONG_LAN chứ không vì «treo bình thường»
    const khong = await kb("cut-p02b"); // đủ người phụ trách; không có GV Trial ⇒ KHONG_CO_GV_TRIAL là treo im lặng
    await tienVe(khong, await dungBe(khong, "a", { tongTien: 10_000_000, ngayDon: D("2026-11-01") }), { soTien: 10_000_000, ngay: D("2026-11-14") });
    const b = await xemTruocCutover({ moi: P, now: NOW, cuaSo: await cuaSoSach("2026-11-14") });
    if (!b.ok) throw new Error(JSON.stringify(b));
    expect(b.xem.bangChung.holdNghiemTrongDuKien).toBe(0);
    expect(b.xem.chan.map((c) => c.ma)).not.toContain("CO_HOLD_DU_KIEN");
  });

  it("[CUT-P03d] DOI_MUON và GO KHÔNG đòi precheck: không nạp bằng chứng (không so bóng), bốn số `null`, vẫn đặt được qua cổng nghiệp vụ; đối chứng: DAT_LAN_DAU với bốn số hỏng bị chặn", async () => {
    await datMocTay("2027-01");
    let goi = 0;
    const dem = { napBangChung: async () => (goi++, BANG_CHUNG_SACH) };
    const muon = await datMocDaXem(db, SA, { mocMoi: "2027-02", lyDo: LY_DO, now: NOW, phuThuoc: dem });
    expect(muon).toMatchObject({ cu: "2027-01", moi: "2027-02", hanhDong: "DOI_MUON" });
    const go = await datMocDaXem(db, SA, { mocMoi: null, lyDo: LY_DO, now: NOW, phuThuoc: dem });
    expect(go).toMatchObject({ cu: "2027-02", moi: null, hanhDong: "GO" });
    expect(goi, "DOI_MUON / GO không được nạp bằng chứng").toBe(0);
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "SystemSetting", entityId: KHOA }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect((a.newValues as { bangChung: Record<string, unknown> }).bangChung).toEqual({ invalidAttribution: null, holdNghiemTrongDuKien: null, unexpectedDelta: null, diTruChuaSanSang: null });

    // đối chứng: đặt lần đầu mà bằng chứng hỏng ⇒ chặn
    await expect(datMocDaXem(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW, phuThuoc: phuThuocCoBangChung({ invalidAttribution: 5, holdNghiemTrongDuKien: 5, unexpectedDelta: 5, diTruChuaSanSang: true }) })).rejects.toMatchObject({ ma: "CO_INVALID_NGUON" });
    expect(await giaTriMoc()).toBeNull();
  });

  it("[CUT-C01] dấu vân khác cái đã xem ⇒ SO_LIEU_DA_DOI và KHÔNG ghi; đối chứng: đúng dấu vân ⇒ ghi", async () => {
    const xem = await napGoiBangChung(db, PHU_THUOC_SACH, { moi: P, now: NOW });
    const truocAudit = await demAudit();
    await expect(
      datMocCutover(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW, cuDaXem: xem.cu, dauVanDaXem: "dau-van-cua-lan-xem-khac", phuThuoc: PHU_THUOC_SACH }),
    ).rejects.toMatchObject({ ma: "SO_LIEU_DA_DOI" });
    expect(await giaTriMoc()).toBeNull();
    expect(await demAudit()).toBe(truocAudit);
    await expect(datMocCutover(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW, cuDaXem: xem.cu, dauVanDaXem: xem.goi.dauVan, phuThuoc: PHU_THUOC_SACH })).resolves.toMatchObject({ moi: P });
  });

  it("[CUT-C02] mốc đã đổi từ lúc xem (cuDaXem ≠ mốc thật) ⇒ MOC_DA_DOI và KHÔNG ghi", async () => {
    const xem = await napGoiBangChung(db, PHU_THUOC_SACH, { moi: P, now: NOW });
    await datMocTay("2027-06"); // ai đó đặt mốc khác sau khi bạn xem
    await expect(
      datMocCutover(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW, cuDaXem: xem.cu, dauVanDaXem: xem.goi.dauVan, phuThuoc: PHU_THUOC_SACH }),
    ).rejects.toMatchObject({ ma: "MOC_DA_DOI" });
    expect(await giaTriMoc()).toBe("2027-06");
  });

  it("[CUT-C03] THÀNH CÔNG: SystemSetting đổi + audit đủ ai/lúc nào/cũ/mới/lý do/bằng chứng + docMocCutover thấy mốc mới NGAY", async () => {
    const truoc = new Date();
    const r = await datMocDaXem(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW });
    expect(r).toMatchObject({ cu: null, moi: P, hanhDong: "DAT_LAN_DAU", dauVan: DAU_VAN_GIA_SACH });
    expect(await giaTriMoc()).toBe(P);
    expect(await docMocCutover(db)).toBe(P); // đọc thẳng DB, không cache
    const a = await db.auditLog.findFirstOrThrow({ where: { entityType: "SystemSetting", entityId: KHOA }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(a).toMatchObject({ module: "hoa-hong", action: "CREATE", reason: LY_DO, actorId: SA.id, actorName: SA.ten });
    expect(a.createdAt.getTime()).toBeGreaterThanOrEqual(truoc.getTime() - 1000);
    expect(a.oldValues).toEqual({ value: null });
    expect(a.newValues).toMatchObject({ value: P, hanhDong: "DAT_LAN_DAU", dauVan: DAU_VAN_GIA_SACH, bangChung: BANG_CHUNG_SACH.bangChung });
    expect(a.newValues).toHaveProperty("tomTat");
  });

  it("[CUT-C04] precheck là một phần của cổng GHI: từng điều kiện hỏng ⇒ KHÔNG ghi; «không đo» (null) ⇒ THIEU_BANG_CHUNG; mốc nguyên trạng", async () => {
    const hong = [
      ["invalidAttribution", { invalidAttribution: 2 }, "CO_INVALID_NGUON"],
      ["holdNghiemTrongDuKien", { holdNghiemTrongDuKien: 2 }, "CO_HOLD_DU_KIEN"],
      ["unexpectedDelta", { unexpectedDelta: 2 }, "CO_CHENH_BAT_NGO"],
      ["diTruChuaSanSang", { diTruChuaSanSang: true }, "DI_TRU_CHUA_SAN_SANG"],
    ] as const;
    for (const [ten, o, ma] of hong) {
      await expect(datMocDaXem(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW, phuThuoc: phuThuocCoBangChung(o) }), ten).rejects.toMatchObject({ ma });
      expect(await giaTriMoc(), ten).toBeNull();
    }
    const khongDo = { napBangChung: async () => ({ bangChung: { invalidAttribution: null, holdNghiemTrongDuKien: null, unexpectedDelta: null, diTruChuaSanSang: null }, dauVan: "x", tomTat: {} }) };
    await expect(datMocDaXem(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW, phuThuoc: khongDo })).rejects.toMatchObject({ ma: "THIEU_BANG_CHUNG" });
    expect(await giaTriMoc()).toBeNull();
    // đối chứng dương: bốn số sạch ⇒ ghi
    await expect(datMocDaXem(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW, phuThuoc: phuThuocCoBangChung({}) })).resolves.toMatchObject({ moi: P });
  });

  it("[CUT-C05] lý do < 10 ký tự ⇒ THIEU_LY_DO · không phải quản trị tối cao ⇒ KHONG_CO_QUYEN — cả hai TRƯỚC khi nạp bằng chứng (không so bóng vô ích)", async () => {
    let goi = 0;
    const dem = { napBangChung: async () => (goi++, BANG_CHUNG_SACH) };
    // Gọi THẲNG `datMocCutover` (không qua `datMocDaXem`: đồ dùng đó tự nạp bằng chứng để mô phỏng bước «xem trước» nên sẽ tự cộng vào `goi`).
    const vao = { mocMoi: P, now: NOW, cuDaXem: null, dauVanDaXem: DAU_VAN_GIA_SACH, phuThuoc: dem };
    await expect(datMocCutover(db, SA, { ...vao, lyDo: "ngắn" })).rejects.toMatchObject({ ma: "THIEU_LY_DO" });
    const kt = { actor: await actorCua(KE_TOAN_ID), ten: "Kế toán CUT" };
    await expect(datMocCutover(db, kt, { ...vao, lyDo: LY_DO })).rejects.toMatchObject({ ma: "KHONG_CO_QUYEN" });
    expect(await giaTriMoc()).toBeNull();
    expect(goi, "cả hai lần từ chối đều TRƯỚC khi nạp bằng chứng").toBe(0);
  });

  it("[CUT-L01] lịch sử đọc từ AuditLog của ĐÚNG khoá này, MỚI nhất trước, có đủ người · mốc cũ→mới · lý do · bằng chứng", async () => {
    await datMocDaXem(db, SA, { mocMoi: P, lyDo: "lần một: đặt mốc lần đầu", now: NOW });
    await datMocDaXem(db, SA, { mocMoi: "2027-05", lyDo: "lần hai: dời mốc muộn hơn", now: NOW });
    await datMocDaXem(db, SA, { mocMoi: null, lyDo: "lần ba: gỡ mốc về trạng thái chưa đặt", now: NOW });
    // nhiễu: audit của khoá KHÁC không được lọt vào
    await db.auditLog.create({ data: { actorName: "nhiễu", module: "hoa-hong", entityType: "SystemSetting", entityId: "hoaHong.engineBat", action: "UPDATE", changedFields: [] } });
    const ls = await docLichSuCutover(3);
    expect(ls.map((d) => d.lyDo)).toEqual(["lần ba: gỡ mốc về trạng thái chưa đặt", "lần hai: dời mốc muộn hơn", "lần một: đặt mốc lần đầu"]);
    expect(ls[0]).toMatchObject({ nguoi: SA.ten, hanhDong: "GO", cu: "2027-05", moi: null });
    expect(ls[1]).toMatchObject({ hanhDong: "DOI_MUON", cu: P, moi: "2027-05" });
    expect(ls[2]).toMatchObject({ hanhDong: "DAT_LAN_DAU", cu: null, moi: P });
    expect(ls[2]!.bangChung).toEqual(BANG_CHUNG_SACH.bangChung);
    // GỠ mốc không đòi precheck ⇒ không có bằng chứng nào để ghi: lịch sử trả `null` (màn in «không đòi bằng chứng»), không phải bốn số `null`.
    expect(ls[0]!.bangChung).toBeNull();
    expect((await docLichSuCutover(1)).length).toBe(1);
  });

  it("[CUT-E01] SAU khi đặt mốc P bằng hành động này: khoản thu kỳ P được engine mới ghi dòng; khoản thu kỳ P−1 thì KHÔNG (kỳ cũ chỉ đọc, không tính lại)", async () => {
    const k = await kb("cut-e01", { rules: [{ vai: "SALE", rate: 0.03 }] });
    const be = await dungBe(k, "a", { tongTien: 20_000_000, ngayDon: D("2027-01-05") });
    const kyCu = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2027-02-20") });
    const kyMoi = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2027-03-05") });
    await datMocDaXem(db, SA, { mocMoi: P, lyDo: LY_DO, now: NOW });
    const bc = await boiCanh(k, D("2027-03-20"), (await docMocCutover(db))!);
    expect(bc.kyCutover).toBe(P);
    expect(await quetKhoan(db, bc, kyMoi)).toMatchObject({ loai: "DA_GHI" });
    expect(await quetKhoan(db, bc, kyCu)).toMatchObject({ loai: "BO_QUA", lyDo: "KHONG_PHAI_CHU" });
    expect(await db.commissionTransaction.count({ where: { paymentId: kyMoi } })).toBeGreaterThan(0);
    expect(await db.commissionTransaction.count({ where: { paymentId: kyCu } })).toBe(0);
    expect(await db.commissionPeriod.count({ where: { centerId: k.centerId, period: { lt: P } } })).toBe(0);
  });
});
