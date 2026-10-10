// @vitest-environment node
/**
 * [NHH-DSP-R*] / [NHH-DSP-V*] — ĐỌC khiếu nại (phạm vi người xem) và "nút nói thật", trên Postgres THẬT.
 *
 * Phạm vi (02 §11.1, 05 §1.4): người khiếu nại thấy khiếu nại CỦA MÌNH ở mọi cơ sở (`raisedByUserId`, không qua scopedDb); người DUYỆT thấy khiếu nại trong tầm nhìn
 * cơ sở của quyền duyệt; người chỉ giữ `commission:view-center` KHÔNG thấy khiếu nại của người khác. Mỗi ca có ĐỐI CHỨNG DƯƠNG (CLAUDE.md luật 11: ca chỉ khẳng định
 * SỰ VẮNG MẶT luôn ĐẠT khi tính năng hỏng hoàn toàn).
 *
 * `[NHH-DSP-V1]`: bảng `viecDuocLam` (nút VẼ) so với hành vi THẬT của service (nút BẤM): việc nào `true` thì service KHÔNG ném lỗi cổng; việc nào `false` thì service
 * ném đúng một trong các lỗi cổng. Hai bên lệch nhau là một nút bấm được mà server từ chối (luật 12).
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18). Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { PermissionError } from "../../lib/auth/can";
import { HoaHongError } from "../../lib/hoa-hong/kieu";
import { demKhieuNaiCanXuLy, docChiTietKhieuNai, docDanhSachKhieuNai, phamViKhieuNai } from "../../lib/hoa-hong/khieu-nai-doc";
import { dongKhieuNaiDoiNguon, nhanKhieuNai, quyetDinhKhieuNai, taoKhieuNai, type NguoiKhieuNai } from "../../lib/hoa-hong/khieu-nai";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import {
  actorCua,
  boiCanh,
  D,
  datMocCutover,
  donKichBan,
  donViHoiSo,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  ganNguon,
  ganVai,
  nguoiKyQlcs,
  tienVe,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-DSP-R] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const cuaToi: KichBan[] = [];
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}
const LY_DO = "Dòng hoa hồng này tính thiếu so với thoả thuận ban đầu của tôi với công ty";
const BANG_CHUNG = [{ ghiChu: "Tin nhắn Zalo ngày 05/10/2026 của quản lý xác nhận mức hưởng" }];
const nguoiCua = async (u: { id: string; name?: string | null }): Promise<NguoiKhieuNai> => ({ userId: u.id, ten: u.name ?? u.id, quyen: await actorCua(u.id) });
async function dungHR(ten: string, orgUnitId?: string): Promise<NguoiKhieuNai> {
  const u = await seedUser({ email: `${ten}-${Date.now().toString(36)}@ci.test`, role: "HR", name: `HR ${ten}`, phone: null });
  await ganVai(u.id, orgUnitId ?? (await donViHoiSo()), "HO_HR");
  return nguoiCua(u);
}
async function dungCa(ten: string, p: Parameters<typeof dungKichBan>[1] = {}, ganVaiNguoiHuong = true) {
  const k = await kb(ten, p);
  // Người HƯỞNG phải neo vai thật tại đơn vị của cơ sở (RBAC v2 đọc quyền TỪ DỮ LIỆU) — trừ ca cần người neo vai ở cơ sở KHÁC.
  if (ganVaiNguoiHuong) for (const u of [k.sale, k.saleAdmin, k.qlcs]) await ganVai(u.id, k.ouId, "CENTER_SALES_CSM");
  await ganNguon(k, "PAID_ADS");
  const bc = await boiCanh(k, NOW);
  const pay = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
  await quetKhoan(db, bc, pay);
  const dong = await dongSoCuaKhoan(pay);
  return { k, bc, pay, dong, cua: (vai: string) => dong.find((d) => d.roleCode === vai)! };
}
const tao = (nguoi: NguoiKhieuNai, transactionId: string) =>
  taoKhieuNai(db, { nguoi, dauVao: { dich: { loai: "DONG", id: transactionId }, lyDo: LY_DO, bangChung: BANG_CHUNG } });
async function loiCua(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  return null;
}
const idsCua = async (n: NguoiKhieuNai, boLoc: Parameters<typeof docDanhSachKhieuNai>[2] = { trangThai: "TAT_CA" }) => (await docDanhSachKhieuNai(db, n.quyen, boLoc, NOW)).dong.map((d) => d.id);

describe.skipIf(!RUN_DB_TESTS)("[NHH-DSP-R] đọc khiếu nại", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
  }, 120_000);
  afterAll(async () => {
    await db.$executeRaw`TRUNCATE "CommissionDispute"`;
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  it("[NHH-DSP-R1] người khiếu nại thấy khiếu nại CỦA MÌNH dù neo vai ở cơ sở KHÁC; QLCS cùng cơ sở giao dịch (chỉ view-center) KHÔNG thấy của người khác — kèm đối chứng dương", async () => {
    const a = await dungCa("dspr1", {}, false);
    const khac = await kb("dspr1k"); // cơ sở khác — nơi Sale này neo vai
    await ganVai(a.k.sale.id, khac.ouId, "CENTER_SALES_CSM");
    const sale = await nguoiCua(a.k.sale);
    const kn = await tao(sale, a.cua("SALE").id);

    // Sale neo ở cơ sở KHÁC (centerScope = [khác]) vẫn thấy khiếu nại của mình trên dòng của cơ sở A
    expect(await idsCua(sale)).toEqual([kn.disputeId]);
    expect((await docChiTietKhieuNai(db, sale.quyen, kn.disputeId, async () => []))?.id).toBe(kn.disputeId);

    // QLCS của cơ sở A: có view-self + view-center nhưng KHÔNG có quyền duyệt ⇒ danh sách rỗng và chi tiết null (dù biết id)
    await ganVai(a.k.qlcs.id, a.k.ouId, "CENTER_SALES_CSM"); // QLCS cũng là người hưởng ⇒ có view-self
    const qlcs = (await nguoiKyQlcs(a.k)) as NguoiKhieuNai;
    expect(await idsCua(qlcs)).toEqual([]);
    expect(await docChiTietKhieuNai(db, qlcs.quyen, kn.disputeId, async () => [])).toBeNull();
    // đối chứng dương: QLCS thấy khiếu nại do CHÍNH MÌNH gửi
    const knQl = await tao(qlcs, a.cua("CENTER_MANAGER").id);
    expect(await idsCua(qlcs)).toEqual([knQl.disputeId]);
  });

  it("[NHH-DSP-R2] người DUYỆT: thấy khiếu nại trong tầm nhìn cơ sở; HR neo cơ sở KHÁC không thấy; HR neo Hội sở thấy cả hai cơ sở", async () => {
    const a = await dungCa("dspr2a");
    const b = await dungCa("dspr2b");
    const knA = await tao(await nguoiCua(a.k.sale), a.cua("SALE").id);
    const knB = await tao(await nguoiCua(b.k.sale), b.cua("SALE").id);

    const hrA = await dungHR("dspr2-a", a.k.ouId);
    const hrHo = await dungHR("dspr2-ho");
    expect((await idsCua(hrA)).sort()).toEqual([knA.disputeId]);
    const tatCa = await idsCua(hrHo);
    expect(tatCa).toEqual(expect.arrayContaining([knA.disputeId, knB.disputeId]));
    // HR của A không đọc được chi tiết khiếu nại của B (id đúng nhưng ngoài tầm nhìn)
    expect(await docChiTietKhieuNai(db, hrA.quyen, knB.disputeId, async () => [])).toBeNull();
    expect((await docChiTietKhieuNai(db, hrHo.quyen, knB.disputeId, async () => []))?.id).toBe(knB.disputeId);
  });

  it("[NHH-DSP-R3] người không giữ quyền nào ⇒ PermissionError (fail-closed), không phải danh sách rỗng", async () => {
    const a = await dungCa("dspr3");
    const khongQuyen = await nguoiCua(a.k.qc); // không neo vai nào ⇒ không có view-self
    expect(() => phamViKhieuNai(khongQuyen.quyen)).toThrow(PermissionError);
    await expect(docDanhSachKhieuNai(db, khongQuyen.quyen, {}, NOW)).rejects.toThrow(PermissionError);
    // đối chứng dương: có vai ⇒ không ném
    const coVai = await nguoiCua(a.k.sale);
    expect(() => phamViKhieuNai(coVai.quyen)).not.toThrow();
  }, 60_000);

  it("[NHH-DSP-R4] lọc trạng thái trên URL: 'đang mở' ≠ 'đã quyết' ≠ 'tất cả'; đang mở cũ nhất lên đầu; phân trang đếm đúng; soDangMo không phụ thuộc bộ lọc", async () => {
    const a = await dungCa("dspr4");
    const sale = await nguoiCua(a.k.sale);
    const hr = await dungHR("dspr4");
    const kn1 = await tao(sale, a.cua("SALE").id);
    const kn2 = await tao(await nguoiCua(a.k.saleAdmin), a.cua("SALE_ADMIN").id);
    await nhanKhieuNai(db, { disputeId: kn1.disputeId, nguoi: hr, now: NOW });
    await quyetDinhKhieuNai(db, a.bc, { disputeId: kn1.disputeId, nguoi: hr, dauVao: { loai: "TU_CHOI", lyDo: "Không đủ căn cứ để điều chỉnh" } });

    const mo = await docDanhSachKhieuNai(db, hr.quyen, { trangThai: "DANG_MO", centerId: a.k.centerId }, NOW);
    expect(mo.dong.map((d) => d.id)).toEqual([kn2.disputeId]);
    const daQuyet = await docDanhSachKhieuNai(db, hr.quyen, { trangThai: "DA_QUYET", centerId: a.k.centerId }, NOW);
    expect(daQuyet.dong.map((d) => [d.id, d.ketQua])).toEqual([[kn1.disputeId, "TU_CHOI"]]);
    const tat = await docDanhSachKhieuNai(db, hr.quyen, { trangThai: "TAT_CA", centerId: a.k.centerId, coTrang: 1 }, NOW);
    expect(tat.tongSo).toBe(2);
    expect(tat.dong).toHaveLength(1);
    expect(daQuyet.soDangMo).toBeGreaterThanOrEqual(1);
    // mặc định (không khai trạng thái) = đang mở
    expect((await docDanhSachKhieuNai(db, hr.quyen, { centerId: a.k.centerId }, NOW)).dong.map((d) => d.id)).toEqual([kn2.disputeId]);
    // dòng mô tả đích: DONG mang vai + kỳ + người hưởng
    expect(mo.dong[0]!.dich).toMatchObject({ loai: "DONG", vai: "SALE_ADMIN", ky: "2026-10" });
  });

  it("[NHH-DSP-R5] số cần xử lý: HR đếm khiếu nại ĐANG MỞ trong phạm vi, TRỪ khiếu nại do chính mình gửi; người không giữ quyền duyệt ⇒ null (không phải 0)", async () => {
    const a = await dungCa("dspr5");
    const hr = await dungHR("dspr5", a.k.ouId);
    const truoc = (await demKhieuNaiCanXuLy(db, hr.quyen))!;
    await tao(await nguoiCua(a.k.sale), a.cua("SALE").id);
    expect(await demKhieuNaiCanXuLy(db, hr.quyen)).toBe(truoc + 1);
    // HR cũng có dòng hoa hồng và tự khiếu nại ⇒ KHÔNG tính vào việc chờ của chính họ
    await ganVai(a.k.saleAdmin.id, a.k.ouId, "HO_HR");
    const adminHr = await nguoiCua(a.k.saleAdmin);
    await tao(adminHr, a.cua("SALE_ADMIN").id);
    expect(await demKhieuNaiCanXuLy(db, adminHr.quyen)).toBe(truoc + 1);
    expect(await demKhieuNaiCanXuLy(db, hr.quyen)).toBe(truoc + 2);
    expect(await demKhieuNaiCanXuLy(db, (await nguoiCua(a.k.sale)).quyen)).toBeNull();
  });

  it("[NHH-DSP-R5b] số cần xử lý KHÔNG đếm khiếu nại của cơ sở khác: HR neo cơ sở A đếm +0, HR neo Hội sở đếm +1 (đối chứng dương)", async () => {
    const a = await dungCa("dspr5b-a");
    const b = await dungCa("dspr5b-b");
    const hrA = await dungHR("dspr5b-a", a.k.ouId);
    const hrHo = await dungHR("dspr5b-ho");
    const truocA = (await demKhieuNaiCanXuLy(db, hrA.quyen))!;
    const truocHo = (await demKhieuNaiCanXuLy(db, hrHo.quyen))!;
    await tao(await nguoiCua(b.k.sale), b.cua("SALE").id); // khiếu nại ở cơ sở B
    expect(await demKhieuNaiCanXuLy(db, hrA.quyen)).toBe(truocA); // cấy 09/10: nới phạm vi đếm thành {} ⇒ ca này đỏ (R5 cũ chỉ dựng cùng cơ sở nên xanh)
    expect(await demKhieuNaiCanXuLy(db, hrHo.quyen)).toBe(truocHo + 1);
  });

  it("[NHH-DSP-R6] chi tiết: người khiếu nại thấy lý do/bằng chứng/lịch sử của MÌNH và 'Vì sao' của dòng; KHÔNG thấy dòng của người khác trên khoản; người duyệt thấy dòng của khoản + danh sách vai", async () => {
    const a = await dungCa("dspr6", { rules: [{ vai: "CENTER_MANAGER", rate: 0.02 }] });
    const sale = await nguoiCua(a.k.sale);
    const kn = await taoKhoanThu(sale, a.pay);
    const hr = await dungHR("dspr6");

    const ctSale = (await docChiTietKhieuNai(db, sale.quyen, kn.disputeId, async () => []))!;
    expect(ctSale).toMatchObject({ lyDo: LY_DO, bangChung: [BANG_CHUNG[0]!.ghiChu], trangThai: "OPEN", ketQua: "CHO_XU_LY" });
    expect(ctSale.dich).toMatchObject({ loai: "KHOAN", paymentId: a.pay, soTien: 10_000_000 });
    expect((ctSale.dich as { dongCuaKhoan: unknown }).dongCuaKhoan).toBeNull();
    expect(ctSale.choQuyet).toBeNull();
    expect(ctSale.viec).toEqual({ nhan: false, nhanLai: false, giao: false, quyet: false, dongDoiNguon: false });
    expect(ctSale.lichSu.map((m) => m.hanhDong)).toEqual(["Gửi khiếu nại"]);

    const ctHr = (await docChiTietKhieuNai(db, hr.quyen, kn.disputeId, async () => [{ id: hr.userId, ten: hr.ten }]))!;
    const dongs = (ctHr.dich as { dongCuaKhoan: { vai: string }[] }).dongCuaKhoan;
    expect(dongs.map((d) => d.vai)).toEqual(["CENTER_MANAGER"]);
    expect(ctHr.viec.nhan).toBe(true);
    expect(ctHr.choQuyet?.vai.map((v) => v.code)).toEqual(expect.arrayContaining(["SALE", "REFERRER_EMPLOYEE"]));
    expect(ctHr.choQuyet?.ungVienXuLy).toEqual([{ id: hr.userId, ten: hr.ten }]);
  });

  it("[NHH-DSP-R7] chi tiết khiếu nại về MỘT DÒNG: 'Vì sao' dựng từ ảnh chụp; dòng điều chỉnh sau khi duyệt hiện số tiền + kỳ; 'sửa nguồn' chưa có dòng đổi nguồn ⇒ daCoDongDoiNguon = false", async () => {
    const a = await dungCa("dspr7");
    const sale = await nguoiCua(a.k.sale);
    const hr = await dungHR("dspr7");
    const kn = await tao(sale, a.cua("SALE").id);
    const ct0 = (await docChiTietKhieuNai(db, sale.quyen, kn.disputeId, async () => []))!;
    expect(ct0.dich).toMatchObject({ loai: "DONG" });
    const vs = (ct0.dich as { viSao: { tieuDe: string; buoc: { nhan: string; giaTri: string }[] } | null }).viSao!;
    expect(vs.tieuDe).toContain("SALE");
    expect(vs.buoc.map((b) => b.nhan)).toContain("Công thức");
    // người xem chỉ có view-self ⇒ ngăn "Vì sao" KHÔNG in tổng tỉ lệ các vai (tiền của vai khác)
    expect(vs.buoc.find((b) => b.nhan === "Kiểm trần")!.giaTri).toMatch(/^Trong trần/);
    // người duyệt có tầm nhìn cơ sở ⇒ thấy tổng tỉ lệ
    const ctHr = (await docChiTietKhieuNai(db, hr.quyen, kn.disputeId, async () => []))!;
    expect((ctHr.dich as { viSao: { buoc: { nhan: string; giaTri: string }[] } }).viSao.buoc.find((b) => b.nhan === "Kiểm trần")!.giaTri).toMatch(/^Tổng tỉ lệ/);

    await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr, now: NOW });
    await quyetDinhKhieuNai(db, a.bc, { disputeId: kn.disputeId, nguoi: hr, dauVao: { loai: "DUYET_TIEN", lyDo: "Đã đối chiếu biên bản, bù phần thiếu", soTien: 50_000 } });
    const ct1 = (await docChiTietKhieuNai(db, sale.quyen, kn.disputeId, async () => []))!;
    expect(ct1).toMatchObject({ trangThai: "CLOSED", ketQua: "DUOC_DUYET_DIEU_CHINH_TIEN", dongDieuChinh: { soTien: 50_000, ky: "2026-11" }, daCoDongDoiNguon: null });
    expect(ct1.quyetDinh).toMatchObject({ lyDo: "Đã đối chiếu biên bản, bù phần thiếu" });
    expect(ct1.lichSu.map((m) => m.hanhDong)).toEqual(["Gửi khiếu nại", "Nhận xử lý", "Quyết định", "Đóng khiếu nại"]);

    // 'sửa nguồn' chưa có dòng đổi nguồn
    const kn2 = await tao(await nguoiCua(a.k.saleAdmin), a.cua("SALE_ADMIN").id);
    await nhanKhieuNai(db, { disputeId: kn2.disputeId, nguoi: hr, now: NOW });
    await quyetDinhKhieuNai(db, a.bc, { disputeId: kn2.disputeId, nguoi: hr, dauVao: { loai: "DUYET_DOI_NGUON", lyDo: "Nguồn ghi sai, cần sửa ở màn lead" } });
    const ct2 = (await docChiTietKhieuNai(db, hr.quyen, kn2.disputeId, async () => []))!;
    expect(ct2).toMatchObject({ trangThai: "APPROVED", daCoDongDoiNguon: false });
    expect(ct2.viec.dongDoiNguon).toBe(true);
  });

  // ── NÚT NÓI THẬT ─────────────────────────────────────────────────────────────────────────────

  it("[NHH-DSP-V1] `viecDuocLam` (nút VẼ) khớp service THẬT (nút BẤM): nhận (kể cả nhận lại) · quyết · đóng-sửa-nguồn là 'vẽ ⇔ cổng cho qua'; giao 'vẽ ⇒ cho qua' (service rộng hơn UI có chủ đích: HR trưởng giao lại được cho người khác); người chính là người khiếu nại / không giữ quyền duyệt ⇒ cổng từ chối MỌI việc", async () => {
    // Mã lỗi CỦA CỔNG (quyền · danh tính · trạng thái · người xử lý). `CHUA_CO_DONG_DOI_NGUON` KHÔNG thuộc tập này: cổng đã qua, chỉ là việc đổi nguồn chưa xong.
    const CONG = new Set(["CHUA_NHAN", "KHONG_PHAI_NGUOI_XU_LY", "CHUYEN_TRANG_THAI_SAI", "KHONG_CO_QUYEN", "NGUOI_DUYET_LA_NGUOI_KHIEU_NAI", "KHONG_DONG_DUOC", "DA_DANG_XU_LY", "KHONG_TIM_THAY_KHIEU_NAI"]);
    const hr1 = await dungHR("dspv1-a");
    const hr2 = await dungHR("dspv1-b");
    type Buoc = "nhan" | "giao" | "quyet" | "dongDoiNguon";
    const BUOC: Buoc[] = ["nhan", "giao", "quyet", "dongDoiNguon"];
    const TRANG_THAI = ["OPEN", "BOI_HR1", "SUA_NGUON"] as const;
    const NGUOI_XEM = ["hr1", "hr2", "kiem", "khongDuyet"] as const;

    let soCa = 0;
    for (const tt of TRANG_THAI) {
      for (const xem of NGUOI_XEM) {
        const ca = await dungCa(`dspv1-${tt}-${xem}`);
        // Thêm khoản thu cho cùng Sale ⇒ mỗi bước chạy trên một khiếu nại RIÊNG (người khiếu nại × đích khác nhau).
        const dongSale = [ca.cua("SALE")];
        for (let i = 1; i < BUOC.length; i += 1) {
          const pay = await tienVe(ca.k, await dungBe(ca.k, `b${i}`), { soTien: 10_000_000, ngay: D("2026-10-12") });
          await quetKhoan(db, ca.bc, pay);
          dongSale.push((await dongSoCuaKhoan(pay)).find((d) => d.roleCode === "SALE")!);
        }
        if (xem === "kiem") await ganVai(ca.k.sale.id, await donViHoiSo(), "HO_HR"); // Sale này vừa có dòng, vừa giữ quyền duyệt
        const claimant = await nguoiCua(ca.k.sale);
        const nguoiXem: NguoiKhieuNai = xem === "hr1" ? hr1 : xem === "hr2" ? hr2 : xem === "kiem" ? claimant : ((await nguoiKyQlcs(ca.k)) as NguoiKhieuNai);
        const khac = xem === "hr1" ? hr2 : hr1;

        for (const [i, buoc] of BUOC.entries()) {
          const kn = await tao(claimant, dongSale[i]!.id);
          if (tt !== "OPEN") await nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: hr1, now: NOW });
          if (tt === "SUA_NGUON") await quyetDinhKhieuNai(db, ca.bc, { disputeId: kn.disputeId, nguoi: hr1, dauVao: { loai: "DUYET_DOI_NGUON", lyDo: "Nguồn ghi sai, cần sửa ở màn lead" } });

          const ct = await docChiTietKhieuNai(db, nguoiXem.quyen, kn.disputeId, async () => []);
          const viec = ct?.viec ?? { nhan: false, nhanLai: false, giao: false, quyet: false, dongDoiNguon: false };
          const loi = await loiCua(() => {
            switch (buoc) {
              case "nhan":
                return nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: nguoiXem, now: NOW });
              case "giao":
                return nhanKhieuNai(db, { disputeId: kn.disputeId, nguoi: nguoiXem, nguoiNhanId: khac.userId, now: NOW });
              case "quyet":
                return quyetDinhKhieuNai(db, ca.bc, { disputeId: kn.disputeId, nguoi: nguoiXem, dauVao: { loai: "TU_CHOI", lyDo: "Không đủ căn cứ để điều chỉnh" } });
              case "dongDoiNguon":
                return dongKhieuNaiDoiNguon(db, { disputeId: kn.disputeId, nguoi: nguoiXem, now: NOW });
            }
          });
          if (loi !== null && !(loi instanceof HoaHongError)) throw loi; // lỗi lạ = lỗi thật, không nuốt
          const biCong = loi instanceof HoaHongError && CONG.has(loi.ma);
          const ten = `${tt} · ${xem} · ${buoc}`;
          const ve = buoc === "nhan" ? viec.nhan || viec.nhanLai : viec[buoc];

          if (ve) expect(biCong, `${ten}: nút VẼ mà server từ chối (${loi instanceof HoaHongError ? loi.ma : "?"})`).toBe(false);
          if (buoc !== "giao") expect(!biCong, `${ten}: nút ${ve ? "vẽ" : "không vẽ"} nhưng server ${biCong ? "từ chối" : "cho qua"}`).toBe(ve);
          // Người không giữ quyền duyệt / chính người khiếu nại: KHÔNG việc nào qua được cổng.
          if (xem === "khongDuyet" || xem === "kiem") expect(biCong, `${ten}: ${xem} không được qua cổng`).toBe(true);
          soCa += 1;
        }
      }
    }
    expect(soCa).toBe(3 * 4 * 4);
  }, 600_000);
});

async function taoKhoanThu(nguoi: NguoiKhieuNai, paymentId: string) {
  return taoKhieuNai(db, { nguoi, dauVao: { dich: { loai: "KHOAN", id: paymentId }, lyDo: LY_DO, bangChung: BANG_CHUNG } });
}
