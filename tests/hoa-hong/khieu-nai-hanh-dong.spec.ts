// @vitest-environment node
/**
 * [NHH-DSP-HD*] — ĐIỀU PHỐI khiếu nại (`lib/hoa-hong/khieu-nai-hanh-dong.ts`) trên Postgres THẬT: map lỗi về ô, thông báo CHỈ gửi sau commit và CHỈ khi thành công,
 * engine tắt ⇒ từ chối không ghi gì.
 *
 * Hàm GỬI thông báo (`khieu-nai-gui-thong-bao`, server-only) bị giả lập — nội dung thông báo do `khieu-nai-thong-bao.test.ts` giữ; ở đây canh QUYẾT ĐỊNH "gửi hay không,
 * gửi lúc nào, gửi với tham số nào".
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18). Cờ `hoaHong.engineBat` đặt trong beforeAll, GỠ trong afterAll. Ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/hoa-hong/khieu-nai-gui-thong-bao", () => ({ baoKhieuNaiMoi: vi.fn(), baoKetQuaKhieuNai: vi.fn() }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { hanhDongDong, hanhDongNhan, hanhDongQuyet, hanhDongTao } from "../../lib/hoa-hong/khieu-nai-hanh-dong";
import { baoKetQuaKhieuNai, baoKhieuNaiMoi } from "../../lib/hoa-hong/khieu-nai-gui-thong-bao";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import { actorCua, boiCanh, D, datMocCutover, donKichBan, donViHoiSo, dongSoCuaKhoan, dungBe, dungKichBan, ganNguon, ganVai, tienVe, type KichBan } from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-DSP-HD] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const cuaToi: KichBan[] = [];
const bao1 = vi.mocked(baoKhieuNaiMoi);
const bao2 = vi.mocked(baoKetQuaKhieuNai);
const LY_DO = "Dòng hoa hồng này tính thiếu so với thoả thuận ban đầu của tôi với công ty";
const BANG_CHUNG = [{ ghiChu: "Tin nhắn Zalo ngày 05/10/2026 của quản lý xác nhận mức hưởng" }];

async function dungCa(ten: string) {
  const k = await dungKichBan(ten);
  cuaToi.push(k);
  await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
  await ganNguon(k, "PAID_ADS");
  const bc = await boiCanh(k, NOW);
  const pay = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
  await quetKhoan(db, bc, pay);
  const dong = (await dongSoCuaKhoan(pay)).find((d) => d.roleCode === "SALE")!;
  return { k, pay, dong };
}
async function dungHR(ten: string) {
  const u = await seedUser({ email: `${ten}-${Date.now().toString(36)}@ci.test`, role: "HR", name: `HR ${ten}`, phone: null });
  await ganVai(u.id, await donViHoiSo(), "HO_HR");
  return { u, actor: await actorCua(u.id), nguoi: { id: u.id, ten: `HR ${ten}` } };
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-DSP-HD] điều phối khiếu nại", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    await db.systemSetting.upsert({ where: { key: "hoaHong.engineBat" }, update: { valueJson: true }, create: { key: "hoaHong.engineBat", valueJson: true } });
  }, 120_000);
  afterAll(async () => {
    await db.systemSetting.deleteMany({ where: { key: "hoaHong.engineBat" } });
    await db.$executeRaw`TRUNCATE "CommissionDispute"`;
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);
  beforeEach(() => {
    bao1.mockReset();
    bao2.mockReset();
  });

  it("[NHH-DSP-HD1] tạo: thành công ⇒ thông báo 'khiếu nại mới' gửi ĐÚNG MỘT LẦN, SAU commit (lúc gửi khiếu nại đã đọc được trong DB), với kỳ + cơ sở + người gửi", async () => {
    const { k, dong } = await dungCa("dsphd1");
    let thayTrongDb = false;
    bao1.mockImplementation(async (i) => {
      thayTrongDb = (await db.commissionDispute.count({ where: { id: i.disputeId } })) === 1;
    });
    const r = await hanhDongTao({ actor: await actorCua(k.sale.id), nguoi: { id: k.sale.id, ten: "Sale" }, dauVao: { dich: { loai: "DONG", id: dong.id }, lyDo: LY_DO, bangChung: BANG_CHUNG } });
    expect(r.ok).toBe(true);
    expect(bao1).toHaveBeenCalledTimes(1);
    expect(bao1.mock.calls[0]![0]).toMatchObject({ centerId: k.centerId, raisedByUserId: k.sale.id, ky: "2026-10", laKhoanThu: false, disputeId: r.ok ? r.disputeId : "?" });
    expect(thayTrongDb).toBe(true);
    expect(bao2).not.toHaveBeenCalled();
  });

  it("[NHH-DSP-HD2] tạo THẤT BẠI (thiếu bằng chứng / đích của người khác) ⇒ lỗi theo Ô hoặc câu chung, KHÔNG thông báo, KHÔNG ghi", async () => {
    const { k, dong } = await dungCa("dsphd2");
    const actor = await actorCua(k.sale.id);
    const nguoi = { id: k.sale.id, ten: "Sale" };
    const thieu = await hanhDongTao({ actor, nguoi, dauVao: { dich: { loai: "DONG", id: dong.id }, lyDo: LY_DO, bangChung: [] } });
    expect(thieu).toMatchObject({ ok: false, chung: null });
    expect(!thieu.ok && thieu.loi.map((l) => l.truong)).toEqual(["bangChung"]);
    const sai = await hanhDongTao({ actor, nguoi, dauVao: { dich: { loai: "DONG", id: "khong-co" }, lyDo: LY_DO, bangChung: BANG_CHUNG } });
    expect(sai).toMatchObject({ ok: false, loi: [] });
    expect(!sai.ok && sai.chung).toMatch(/Không tìm thấy/);
    expect(bao1).not.toHaveBeenCalled();
    expect(await db.commissionDispute.count({ where: { raisedByUserId: k.sale.id } })).toBe(0);
  });

  it("[NHH-DSP-HD3] nhận ⇒ KHÔNG gửi thông báo (05 §3 không định nghĩa); quyết điều chỉnh tiền ⇒ báo 'kết quả' cho NGƯỜI KHIẾU NẠI với lý do quyết định", async () => {
    const { k, dong } = await dungCa("dsphd3");
    const hr = await dungHR("dsphd3");
    const t = await hanhDongTao({ actor: await actorCua(k.sale.id), nguoi: { id: k.sale.id, ten: "Sale" }, dauVao: { dich: { loai: "DONG", id: dong.id }, lyDo: LY_DO, bangChung: BANG_CHUNG } });
    if (!t.ok) throw new Error("tạo hỏng");
    bao1.mockClear();
    expect(await hanhDongNhan({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW })).toMatchObject({ ok: true, nguoiXuLyId: hr.u.id });
    expect(bao1).not.toHaveBeenCalled();
    expect(bao2).not.toHaveBeenCalled();

    const q = await hanhDongQuyet({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW, dauVao: { loai: "DUYET_TIEN", lyDo: "Đã đối chiếu biên bản, bù phần thiếu", soTien: 50_000 } });
    expect(q).toMatchObject({ ok: true, loai: "DA_DUYET_TIEN" });
    expect(bao2).toHaveBeenCalledTimes(1);
    expect(bao2.mock.calls[0]![0]).toEqual({ disputeId: t.disputeId, raisedByUserId: k.sale.id, ketQua: "DUOC_DUYET_DIEU_CHINH_TIEN", lyDoQuyetDinh: "Đã đối chiếu biên bản, bù phần thiếu" });
  });

  it("[NHH-DSP-HD4] từ chối ⇒ kết quả TU_CHOI; quyết THẤT BẠI (người không phải người xử lý) ⇒ câu chung, KHÔNG thông báo; lý do thiếu ⇒ lỗi theo ô", async () => {
    const { k, dong } = await dungCa("dsphd4");
    const hr = await dungHR("dsphd4-a");
    const hr2 = await dungHR("dsphd4-b");
    const t = await hanhDongTao({ actor: await actorCua(k.sale.id), nguoi: { id: k.sale.id, ten: "Sale" }, dauVao: { dich: { loai: "DONG", id: dong.id }, lyDo: LY_DO, bangChung: BANG_CHUNG } });
    if (!t.ok) throw new Error("tạo hỏng");
    await hanhDongNhan({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW });

    const khongPhaiNguoiXuLy = await hanhDongQuyet({ actor: hr2.actor, nguoi: hr2.nguoi, disputeId: t.disputeId, now: NOW, dauVao: { loai: "TU_CHOI", lyDo: "Người khác cố từ chối khiếu nại" } });
    expect(khongPhaiNguoiXuLy).toMatchObject({ ok: false, loi: [] });
    expect(!khongPhaiNguoiXuLy.ok && khongPhaiNguoiXuLy.chung).toMatch(/người khác xử lý/);
    const thieuLyDo = await hanhDongQuyet({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW, dauVao: { loai: "TU_CHOI", lyDo: "" } });
    expect(!thieuLyDo.ok && thieuLyDo.loi.map((l) => l.truong)).toEqual(["lyDo"]);
    expect(bao2).not.toHaveBeenCalled();

    const ok = await hanhDongQuyet({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW, dauVao: { loai: "TU_CHOI", lyDo: "Hồ sơ thoả thuận không ghi mức hưởng này" } });
    expect(ok.ok).toBe(true);
    expect(bao2.mock.calls[0]![0]).toMatchObject({ ketQua: "TU_CHOI", lyDoQuyetDinh: "Hồ sơ thoả thuận không ghi mức hưởng này" });
  });

  it("[NHH-DSP-HD5] engine TẮT ⇒ quyết định bị từ chối bằng câu nói rõ lý do, khiếu nại giữ nguyên, KHÔNG thông báo; đối chứng: bật lại thì quyết được", async () => {
    const { k, dong } = await dungCa("dsphd5");
    const hr = await dungHR("dsphd5");
    const t = await hanhDongTao({ actor: await actorCua(k.sale.id), nguoi: { id: k.sale.id, ten: "Sale" }, dauVao: { dich: { loai: "DONG", id: dong.id }, lyDo: LY_DO, bangChung: BANG_CHUNG } });
    if (!t.ok) throw new Error("tạo hỏng");
    await hanhDongNhan({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW });
    const dat = (bat: boolean) => db.systemSetting.upsert({ where: { key: "hoaHong.engineBat" }, update: { valueJson: bat }, create: { key: "hoaHong.engineBat", valueJson: bat } });
    try {
      await dat(false);
      const r = await hanhDongQuyet({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW, dauVao: { loai: "TU_CHOI", lyDo: "Từ chối khi engine đang tắt" } });
      expect(r).toMatchObject({ ok: false });
      expect(!r.ok && r.chung).toMatch(/đang tắt/);
      expect((await db.commissionDispute.findUniqueOrThrow({ where: { id: t.disputeId } })).status).toBe("UNDER_REVIEW");
      expect(bao2).not.toHaveBeenCalled();
    } finally {
      await dat(true);
    }
    expect((await hanhDongQuyet({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW, dauVao: { loai: "TU_CHOI", lyDo: "Từ chối sau khi engine bật lại" } })).ok).toBe(true);
  });

  it("[NHH-DSP-HD6] đóng khiếu nại 'sửa nguồn' khi CHƯA có dòng đổi nguồn ⇒ câu chung chỉ đường; lỗi KHÔNG lường trước ⇒ câu chung, không lộ chi tiết kỹ thuật (và có log)", async () => {
    const { k, dong } = await dungCa("dsphd6");
    const hr = await dungHR("dsphd6");
    const t = await hanhDongTao({ actor: await actorCua(k.sale.id), nguoi: { id: k.sale.id, ten: "Sale" }, dauVao: { dich: { loai: "DONG", id: dong.id }, lyDo: LY_DO, bangChung: BANG_CHUNG } });
    if (!t.ok) throw new Error("tạo hỏng");
    await hanhDongNhan({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW });
    await hanhDongQuyet({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW, dauVao: { loai: "DUYET_DOI_NGUON", lyDo: "Nguồn ghi sai, cần sửa ở màn lead" } });
    const chua = await hanhDongDong({ actor: hr.actor, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW });
    expect(chua).toMatchObject({ ok: false });
    expect(!chua.ok && chua.chung).toMatch(/đổi nguồn ở màn lead/);

    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // `actor` hỏng (thiếu hẳn mảng quyền) ⇒ lỗi TypeError bên trong `can()` — không phải HoaHongError.
      const hong = await hanhDongNhan({ actor: {} as never, nguoi: hr.nguoi, disputeId: t.disputeId, now: NOW });
      expect(hong).toMatchObject({ ok: false, loi: [] });
      expect(!hong.ok && hong.chung).toMatch(/thử lại sau/);
      expect(!hong.ok && hong.chung).not.toMatch(/TypeError|undefined|Cannot read/);
      expect(log).toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
