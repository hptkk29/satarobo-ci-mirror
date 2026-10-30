// @vitest-environment node
/**
 * [T1-01..T1-10] — «HÀNG CHỜ CẦN XỬ LÝ» (R9 · T1): `INPUT_DRIFT` / `PAYMENT_WITHDRAWN` thấy được → xem trước → đề nghị → duyệt → ghi, trên Postgres THẬT.
 *
 * Dòng tiền dựng bằng HÀM GHI THẬT (xem `_kich-ban.ts`); hàng chờ do ENGINE sinh (`quetKhoan`), KHÔNG chèn tay — trừ ca mô phỏng hàng chờ của đề xuất.
 * Phép GHI TIỀN duy nhất vẫn là `giaiHangCho` (dòng `INPUT_CORRECTION` mới); service ở đây chỉ gác thêm: phạm vi · một/hai người · trần tiền · dấu vết.
 *
 * ⚠️ AN TOÀN DB: không `resetDb()`; mỗi ca tự dựng kịch bản (luật 18). Sổ BẤT BIẾN nên không dọn được bằng xoá.
 * ⚠️ ĐỒNG HỒ: `bc` (boi cảnh quét) dùng ngày tuyệt đối; `now` của SERVICE phải là đồng hồ thật vì dấu thời gian của AuditLog do Postgres đóng (hạn đề nghị so với nó).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg, seedUser } from "../e2e/_helpers/seed";
import { chuyenXemTayHangChoAction, deNghiHangChoAction, quyetHangChoAction, xemTruocHangChoAction } from "../../app/(admin)/admin/nguon-hoa-hong/so/_actions-hang-cho";
import type { Actor, PermEntry } from "../../lib/auth/actor";
import { ghiHangCho } from "../../lib/hoa-hong/hang-cho";
import { dongCoDieuKien } from "../../lib/hoa-hong/giai-hang-cho";
import { docHangChoSo } from "../../lib/hoa-hong/hang-cho-so-doc";
import { HAN_DE_NGHI_MS } from "../../lib/hoa-hong/hang-cho-xu-ly";
import { chuyenXemTay, deNghiXuLy, quyetXuLy, xemTruocXuLy } from "../../lib/hoa-hong/hang-cho-xu-ly-service";
import { demHangChoChan, type NguoiThaoTacKy } from "../../lib/hoa-hong/ky-service";
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
  ganVai,
  nguoiKyHo,
  nguoiKyQlcs,
  tienVe,
  tuChoi,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[T1] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);

const NOW = D("2026-11-20");
const KHOA_NGUONG = "hoaHong.nguongDuyetHaiCap";
const LY_DO = "Đã đối chiếu với kế toán trưởng";
const BANG_CHUNG = "Biên bản đối chiếu 14/10, phiếu PT-2026-1234";

let A: NguoiThaoTacKy & { userId: string };
let B: NguoiThaoTacKy & { userId: string };
const cuaToi: KichBan[] = [];
const kb = async (tien: string) => {
  const k = await dungKichBan(tien, { rules: [{ vai: "SALE", rate: 0.03 }] });
  cuaToi.push(k);
  return k;
};
const datNguong = (n: number | null) =>
  n === null ? db.systemSetting.deleteMany({ where: { key: KHOA_NGUONG } }) : db.systemSetting.upsert({ where: { key: KHOA_NGUONG }, update: { valueJson: n }, create: { key: KHOA_NGUONG, valueJson: n } });
const bay = () => new Date();
const demSo = (paymentId: string) => db.commissionTransaction.count({ where: { OR: [{ paymentId }, { calcSlot: { paymentId } }] } });

async function nguoiHoThu2(): Promise<NguoiThaoTacKy & { userId: string }> {
  const u = await seedUser({ email: `fx-hcx-ho2-${Date.now().toString(36)}@ci.test`, role: "ACCOUNTANT", name: "Kế toán HO thứ hai", phone: null });
  await ganVai(u.id, await donViHoiSo(), "HO_ACCOUNTANT");
  return { userId: u.id, ten: "Kế toán HO thứ hai", quyen: await actorCua(u.id) };
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

/** Người chốt đổi sau khi thu (không qua `doiNguonLead` ⇒ không phát sự kiện đổi nguồn) ⇒ INPUT_DRIFT: Sale cũ −300.000 / Sale mới +300.000. */
async function troiNguoiChot(ten: string) {
  const k = await kb(ten);
  const bc = await boiCanh(k, NOW);
  const id = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-11-05") });
  await quetKhoan(db, bc, id);
  const moi = await seedUser({ email: `${k.ma}-sale-moi@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-moi`, phone: null });
  await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: moi.id } });
  await quetKhoan(db, bc, id);
  const hold = await db.commissionHold.findFirstOrThrow({ where: { paymentId: id, code: "INPUT_DRIFT" } });
  return { k, bc, id, moi, hold };
}

describe.skipIf(!RUN_DB_TESTS)("[T1] hàng chờ cần xử lý — INPUT_DRIFT · PAYMENT_WITHDRAWN", () => {
  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    A = await nguoiKyHo();
    B = await nguoiHoThu2();
  }, 120_000);
  afterAll(async () => {
    await datNguong(null);
    await donKichBan(cuaToi);
    await datMocCutover(null);
  }, 60_000);

  // ── T1-01 / T1-02: HIỆN ĐƯỢC, đủ cột ───────────────────────────────────────────────────────

  it("[T1-01] PAYMENT_WITHDRAWN hiện ở danh sách hàng chờ: lý do · cơ sở · khoản · tiền ảnh hưởng · ngày tạo · trạng thái xử lý · các hành động làm được", async () => {
    const { k, bi, hold } = await khoanBiRut("t101");
    const kq = await docHangChoSo(db, A.quyen, { centerId: k.centerId, bayGio: bay() });
    const d = kq.dong.find((x) => x.id === hold.id);
    expect(d).toBeDefined();
    expect(d).toMatchObject({ ma: "PAYMENT_WITHDRAWN", paymentId: bi, centerId: k.centerId, tienAnhHuong: 300_000, chanKhoa: true });
    expect(d!.lyDo).toMatch(/không còn/i);
    expect(d!.taoLuc).toBeInstanceOf(Date);
    expect(d!.xuLy).toMatchObject({ trangThai: "CHUA_XU_LY", deNghi: null, xemTay: null });
    expect([d!.xuLy!.huong.giaiPhong.duoc, d!.xuLy!.huong.tuChoi.duoc, d!.xuLy!.huong.chuyenXemTay.duoc]).toEqual([true, true, true]);
  });

  it("[T1-02] INPUT_DRIFT hiện: tiền ảnh hưởng = Σ|chênh| (−300.000 và +300.000 ⇒ 600.000); mã khác KHÔNG có `xuLy` (đối chứng: chỉ hai mã được mở)", async () => {
    const { k, hold } = await troiNguoiChot("t102");
    // đối chứng: một hàng chờ mã khác trong cùng cơ sở
    await db.$transaction((tx) =>
      ghiHangCho(tx, { holdKey: `T102-KHAC:${k.ma}`, code: "MANUAL_REVIEW_REQUIRED", paymentId: hold.paymentId, orderId: null, orderItemId: null, studentId: null, entryId: null, calcSlotId: null, blockingPeriodId: null, centerId: k.centerId, orgUnitId: k.ouId, detail: {} }, NOW),
    );
    const kq = await docHangChoSo(db, A.quyen, { centerId: k.centerId, bayGio: bay() });
    const drift = kq.dong.find((x) => x.id === hold.id)!;
    expect(drift).toMatchObject({ ma: "INPUT_DRIFT", tienAnhHuong: 600_000 });
    expect(drift.xuLy).not.toBeNull();
    const khac = kq.dong.find((x) => x.ma === "MANUAL_REVIEW_REQUIRED")!;
    expect(khac.xuLy).toBeNull();
    expect(khac.tienAnhHuong).toBeNull();
  });

  // ── T1-03: người không được phép ───────────────────────────────────────────────────────────

  it("[T1-03] KHÔNG ĐƯỢC PHÉP: chưa đăng nhập ⇒ bốn action đều từ chối, 0 dòng ghi; QLCS cơ sở KHÁC ⇒ không thấy, không xem trước, không quyết (cùng một câu — không lộ hàng chờ có tồn tại); đối chứng dương: người HO làm được", async () => {
    const { k, bc, id, hold } = await troiNguoiChot("t103");
    const truoc = await demSo(id);

    // (a) Server Action không phiên đăng nhập (auth() = null ở môi trường test)
    const vao = { holdId: hold.id, quyetDinh: "AP_DUNG" as const, lyDo: LY_DO, bangChung: BANG_CHUNG };
    for (const r of [
      await xemTruocHangChoAction({ holdId: hold.id }),
      await deNghiHangChoAction(vao),
      await quyetHangChoAction({ ...vao, tienDaThay: 600_000 }),
      await chuyenXemTayHangChoAction({ holdId: hold.id, lyDo: LY_DO }),
    ]) {
      expect(r).toMatchObject({ ok: false, ma: "CHUA_DANG_NHAP" });
    }

    // (b) QLCS của một cơ sở khác
    const ngoai = await kb("t103-ngoai");
    const qNgoai = { ...(await nguoiKyQlcs(ngoai)), userId: ngoai.qlcs.id } as NguoiThaoTacKy & { userId: string };
    const thay = await docHangChoSo(db, qNgoai.quyen, { bayGio: bay() });
    expect(thay.dong.some((x) => x.id === hold.id)).toBe(false);
    const loiNgoai = { ma: "HANG_CHO_KHONG_MO" };
    await expect(xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: qNgoai, now: bay() })).rejects.toMatchObject(loiNgoai);
    await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: qNgoai, now: bay() })).rejects.toMatchObject(loiNgoai);
    await expect(deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: qNgoai, now: bay() })).rejects.toMatchObject(loiNgoai);
    await expect(chuyenXemTay(db, { holdId: hold.id, lyDo: LY_DO, nguoi: qNgoai, now: bay() })).rejects.toMatchObject(loiNgoai);
    // id không tồn tại ⇒ CÙNG một mã/câu (không phân biệt "không có" với "ngoài phạm vi")
    await expect(xemTruocXuLy(db, bc, { holdId: "khong-ton-tai", nguoi: qNgoai, now: bay() })).rejects.toMatchObject(loiNgoai);

    expect(await demSo(id)).toBe(truoc);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id } })).toBe(0);

    // (c) đối chứng dương: người HO xem trước được
    const xem = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() });
    expect(xem.giaiPhong).toMatchObject({ ok: true, tongTuyetDoi: 600_000 });
    expect(k.centerId).toBeTruthy();
  });

  // ── T1-04: quyết hợp lệ ────────────────────────────────────────────────────────────────────

  it("[T1-04a] GIẢI PHÓNG INPUT_DRIFT dưới ngưỡng: một người, lý do + bằng chứng ⇒ đúng dòng INPUT_CORRECTION như `giaiHangCho`, hàng chờ RESOLVED, XEM TRƯỚC không ghi gì", async () => {
    await datNguong(null); // mặc định 10tr
    const { bc, id, hold, moi, k } = await troiNguoiChot("t104a");
    const kyTruoc = await db.commissionPeriod.count({ where: { centerId: k.centerId } });

    const xem = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() });
    expect(xem).toMatchObject({ cap: "MOT_CAP", lyDoCap: "DUOI_NGUONG", tien: 600_000, trangThai: "CHUA_XU_LY" });
    expect(xem.giaiPhong).toMatchObject({ ok: true, tongTuyetDoi: 600_000, tongRong: 0 });
    // XEM TRƯỚC không ghi: không dòng sổ, không kỳ mới, hàng chờ vẫn OPEN, không kiểm toán
    expect(await demSo(id)).toBe(1);
    expect(await db.commissionPeriod.count({ where: { centerId: k.centerId } })).toBe(kyTruoc);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id } })).toBe(0);

    // thiếu lý do / bằng chứng ⇒ từ chối TRƯỚC khi ghi
    await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "ngắn", bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "THIEU_LY_DO" });
    await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: "ngắn", tienDaThay: 600_000, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "THIEU_LY_DO" });
    expect(await demSo(id)).toBe(1);

    const r = await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() });
    expect(r).toMatchObject({ loai: "DA_XU_LY", cap: "MOT_CAP", ketQua: { loai: "DA_AP_DUNG", soDong: 2, tong: 0 } });
    const dc = (await dongSoCuaKhoan(id)).filter((d) => d.entryKind === "INPUT_CORRECTION");
    expect(dc.map((d) => d.amount).sort((a, b) => a - b)).toEqual([-300_000, 300_000]);
    expect(dc.every((d) => d.refEventType === "HOLD" && d.refEventId === hold.id && d.reasonCode === "INPUT_DRIFT_AP_DUNG")).toBe(true);
    expect(dc.some((d) => d.beneficiaryUserId === moi.id && d.amount === 300_000)).toBe(true);
    const sau = await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(sau).toMatchObject({ status: "RESOLVED", resolvedById: A.userId });
    expect(sau.resolutionNote).toContain(LY_DO);
    expect(sau.resolutionNote).toContain(BANG_CHUNG);
    expect((await quetKhoan(db, bc, id)).loai).toBe("KHONG_DOI");
  });

  it("[T1-04b] TRẦN TIỀN: bấm trên con số CŨ nhỏ hơn số tính lại ⇒ TIEN_DA_DOI, 0 dòng, hàng chờ OPEN; ngưỡng − 1 chặn cả khi người xem khai số lớn; đối chứng dương: khai đủ thì ghi", async () => {
    await datNguong(null);
    const { bc, id, hold } = await troiNguoiChot("t104b");
    await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 599_999, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "TIEN_DA_DOI" });
    expect(await demSo(id)).toBe(1);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    // ngưỡng 600.000 ⇒ 600.000 là "đạt ngưỡng" ⇒ phải hai người (một người không quyết được dù khai số lớn)
    await datNguong(600_000);
    await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 999_999_999, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
    await datNguong(null);
    expect(await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() })).toMatchObject({ loai: "DA_XU_LY" });
  });

  it("[T1-04c] TIỀN LỚN ⇒ HAI NGƯỜI: một người không quyết được; đề nghị rồi vẫn không tự duyệt; người KHÁC duyệt thì ghi; đề nghị hết hạn / sai chiều thì không duyệt được", async () => {
    await datNguong(100_000); // 600.000 ≥ 100.000
    try {
      const { bc, id, hold } = await troiNguoiChot("t104c");
      const xem = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() });
      expect(xem).toMatchObject({ cap: "HAI_CAP", lyDoCap: "TU_NGUONG", nguong: 100_000 });

      // một người quyết thẳng ⇒ chặn, 0 ghi
      await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
      expect(await demSo(id)).toBe(1);

      // cấp 1: đề nghị — hàng chờ vẫn MỞ, sổ không đổi, idempotent
      expect(await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() })).toEqual({ loai: "DA_GHI", tien: 600_000 });
      expect(await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() })).toEqual({ loai: "DA_CO_TRUOC" });
      expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id, action: "RELEASE_REQUEST" } })).toBe(1);
      expect(await demSo(id)).toBe(1);
      expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
      const dsA = await docHangChoSo(db, A.quyen, { centerId: hold.centerId!, bayGio: bay() });
      expect(dsA.dong.find((x) => x.id === hold.id)!.xuLy).toMatchObject({ trangThai: "CHO_DUYET_CAP_HAI", deNghi: { nguoiId: A.userId, tien: 600_000, quyetDinh: "AP_DUNG" } });

      // người đề nghị KHÔNG tự duyệt
      await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "CUNG_NGUOI" });
      // sai chiều: cấp 1 đề nghị GIẢI PHÓNG, cấp 2 không đổi sang TỪ CHỐI
      await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: B, now: bay() })).rejects.toMatchObject({ ma: "QUYET_DINH_KHAC_DE_NGHI" });
      // đề nghị HẾT HẠN
      const quaHan = new Date(Date.now() + HAN_DE_NGHI_MS + 60_000);
      await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: B, now: quaHan })).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
      expect(await demSo(id)).toBe(1);

      // người KHÁC duyệt ⇒ ghi
      const r = await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Đồng ý, số khớp biên bản", bangChung: "Biên bản 14/10 đã kiểm", tienDaThay: 600_000, nguoi: B, now: bay() });
      expect(r).toMatchObject({ loai: "DA_XU_LY", cap: "HAI_CAP", ketQua: { loai: "DA_AP_DUNG", soDong: 2 } });
      expect(await demSo(id)).toBe(3);
      expect(await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).toMatchObject({ status: "RESOLVED", resolvedById: B.userId });
    } finally {
      await datNguong(null);
    }
  });

  it("[T1-04d] HAI CẤP có TRẦN: cấp 1 nêu 600.000; nếu đầu vào đổi làm số tính lại LỚN hơn trần thì cấp 2 không ghi (TIEN_DA_DOI hoặc DAU_VAO_DA_DOI), hàng chờ OPEN", async () => {
    await datNguong(100_000);
    try {
      const { k, bc, id, hold } = await troiNguoiChot("t104d");
      await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() });
      // người chốt đổi LẦN NỮA sau đề nghị ⇒ hash đầu vào đổi
      const nua = await seedUser({ email: `${k.ma}-sale-nua@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-nua`, phone: null });
      await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: nua.id } });
      await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: B, now: bay() })).rejects.toMatchObject({ ma: expect.stringMatching(/^(TIEN_DA_DOI|DAU_VAO_DA_DOI)$/) });
      expect(await demSo(id)).toBe(1);
      expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    } finally {
      await datNguong(null);
    }
  });

  it("[T1-04e] PAYMENT_WITHDRAWN: giải phóng = đảo sạch (−300.000), xem trước nói đúng số đó; dưới ngưỡng một người", async () => {
    await datNguong(null);
    const { bc, bi, hold } = await khoanBiRut("t104e");
    const xem = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() });
    expect(xem).toMatchObject({ cap: "MOT_CAP", tien: 300_000 });
    expect(xem.giaiPhong).toMatchObject({ ok: true, tongTuyetDoi: 300_000, tongRong: -300_000 });
    const r = await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 300_000, nguoi: A, now: bay() });
    expect(r).toMatchObject({ loai: "DA_XU_LY", ketQua: { loai: "DA_AP_DUNG", soDong: 1, tong: -300_000 } });
    expect((await dongSoCuaKhoan(bi)).map((d) => [d.entryKind, d.amount])).toEqual([["ORIGINAL", 300_000], ["INPUT_CORRECTION", -300_000]]);
  });

  it("[T1-04f] TỪ CHỐI (giữ nguyên): đóng hàng chờ, sổ KHÔNG đổi; từ ngưỡng thì cũng cần hai người và cấp 2 phải đúng chiều", async () => {
    await datNguong(null);
    const x = await khoanBiRut("t104f1");
    expect(await quyetXuLy(db, x.bc, { holdId: x.hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "Bấm nhầm, đã xác nhận lại ở phiếu khác", bangChung: BANG_CHUNG, tienDaThay: 0, nguoi: A, now: bay() })).toMatchObject({ loai: "DA_XU_LY", ketQua: { loai: "DA_GIU_NGUYEN" } });
    expect(await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } })).toMatchObject({ status: "DISMISSED", resolvedById: A.userId });
    expect((await dongSoCuaKhoan(x.bi)).map((d) => d.entryKind)).toEqual(["ORIGINAL"]);

    await datNguong(100_000);
    try {
      const y = await khoanBiRut("t104f2");
      await expect(quyetXuLy(db, y.bc, { holdId: y.hold.id, quyetDinh: "GIU_NGUYEN", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 0, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "CAN_DE_NGHI_CAP_1" });
      await deNghiXuLy(db, y.bc, { holdId: y.hold.id, quyetDinh: "GIU_NGUYEN", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() });
      await expect(quyetXuLy(db, y.bc, { holdId: y.hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 300_000, nguoi: B, now: bay() })).rejects.toMatchObject({ ma: "QUYET_DINH_KHAC_DE_NGHI" });
      expect(await quyetXuLy(db, y.bc, { holdId: y.hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "Đồng ý giữ nguyên, đã kiểm", bangChung: BANG_CHUNG, tienDaThay: 0, nguoi: B, now: bay() })).toMatchObject({ loai: "DA_XU_LY", cap: "HAI_CAP" });
      expect(await db.commissionHold.findUniqueOrThrow({ where: { id: y.hold.id } })).toMatchObject({ status: "DISMISSED", resolvedById: B.userId });
    } finally {
      await datNguong(null);
    }
  });

  // ── T1-05: bấm lặp ────────────────────────────────────────────────────────────────────────

  it("[T1-05] BẤM LẶP IDEMPOTENT: cùng người bấm lại ⇒ DA_XU_LY_TRUOC, không ghi lần hai; bấm đúp ĐỒNG THỜI ⇒ đúng MỘT lượt ghi; NGƯỜI KHÁC bấm sau khi đã đóng ⇒ lỗi (không im lặng)", async () => {
    await datNguong(null);
    const { bc, id, hold } = await troiNguoiChot("t105");
    const vao = { holdId: hold.id, quyetDinh: "AP_DUNG" as const, lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() };
    const kq = await Promise.allSettled([quyetXuLy(db, bc, vao), quyetXuLy(db, bc, vao)]);
    const loai = kq.map((x) => (x.status === "fulfilled" ? x.value.loai : `LOI:${(x.reason as { ma?: string }).ma}`)).sort();
    // một lượt GHI + một lượt idempotent (hoặc, nếu lượt hai đến SAU khi đã đóng, cũng DA_XU_LY_TRUOC)
    expect(loai).toEqual(["DA_XU_LY", "DA_XU_LY_TRUOC"]);
    expect(await demSo(id)).toBe(3);
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id, action: "APPLY" } })).toBe(1);

    // bấm lại SAU khi đã xong
    expect(await quyetXuLy(db, bc, vao)).toEqual({ loai: "DA_XU_LY_TRUOC" });
    expect(await demSo(id)).toBe(3);
    // quyết định KHÁC của cùng người trên hàng chờ đã đóng ⇒ không phải idempotent ⇒ lỗi
    await expect(quyetXuLy(db, bc, { ...vao, quyetDinh: "GIU_NGUYEN" })).rejects.toMatchObject({ ma: "TRANG_THAI_DA_DOI" });
    // người KHÁC bấm sau ⇒ lỗi
    await expect(quyetXuLy(db, bc, { ...vao, nguoi: B })).rejects.toMatchObject({ ma: "TRANG_THAI_DA_DOI" });
    expect(await demSo(id)).toBe(3);
  });

  // ── T1-06: sổ cũ bất biến ──────────────────────────────────────────────────────────────────

  it("[T1-06] SỔ CŨ BẤT BIẾN: giải phóng chỉ THÊM dòng mới; dòng gốc nguyên vẹn; sửa/xoá dòng sổ trực tiếp bị DB từ chối; service KHÔNG đổi trạng thái hàng chờ bằng cách nào ngoài `giaiHangCho`", async () => {
    await datNguong(null);
    const { bc, bi, hold } = await khoanBiRut("t106");
    const truoc = await dongSoCuaKhoan(bi);
    await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 300_000, nguoi: A, now: bay() });
    const sau = await dongSoCuaKhoan(bi);
    expect(sau).toHaveLength(truoc.length + 1);
    const goc = sau.find((d) => d.id === truoc[0]!.id)!;
    expect(goc).toMatchObject({ amount: truoc[0]!.amount, entryKind: truoc[0]!.entryKind, netBase: truoc[0]!.netBase });
    expect(goc.createdAt.getTime()).toBe(truoc[0]!.createdAt.getTime());
    await expect(db.commissionTransaction.update({ where: { id: goc.id }, data: { amount: 1 } })).rejects.toThrow();
    await expect(db.commissionTransaction.delete({ where: { id: goc.id } })).rejects.toThrow();
    expect((await dongSoCuaKhoan(bi)).find((d) => d.id === goc.id)!.amount).toBe(truoc[0]!.amount);
  });

  // ── T1-07: kiểm toán đủ ────────────────────────────────────────────────────────────────────

  it("[T1-07] KIỂM TOÁN ĐỦ: người · trạng thái cũ → mới · lý do · bằng chứng · thời điểm · mã liên quan — cho đề nghị, chuyển xem tay, duyệt và từ chối", async () => {
    await datNguong(100_000);
    try {
      const { bc, hold, id } = await troiNguoiChot("t107");
      const t0 = Date.now();
      await chuyenXemTay(db, { holdId: hold.id, lyDo: "Cần kế toán trưởng xem số này", nguoi: A, now: bay() });
      await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() });
      await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Duyệt cấp hai sau khi kiểm", bangChung: "Phiếu PT-2026-9999", tienDaThay: 600_000, nguoi: B, now: bay() });

      const au = await db.auditLog.findMany({ where: { entityType: "CommissionHold", entityId: hold.id }, orderBy: { createdAt: "asc" } });
      expect(au.map((x) => x.action)).toEqual(["ESCALATE_MANUAL", "RELEASE_REQUEST", "APPLY"]);
      for (const x of au) {
        expect(x.module).toBe("hoa-hong");
        expect(x.actorId).toBeTruthy();
        expect(x.actorName).toBeTruthy();
        expect(x.reason && x.reason.length >= 10).toBe(true);
        expect(x.createdAt.getTime()).toBeGreaterThanOrEqual(t0 - 5_000);
        expect(x.orgUnitId).toBeTruthy();
      }
      const [xt, dn, ap] = au;
      expect(xt!.actorId).toBe(A.userId);
      expect(xt!.newValues).toMatchObject({ status: "OPEN", holdKey: hold.holdKey });
      expect(dn!.oldValues).toMatchObject({ status: "OPEN", code: "INPUT_DRIFT" });
      expect(dn!.newValues).toMatchObject({ quyetDinh: "AP_DUNG", tien: 600_000, holdKey: hold.holdKey, lyDo: LY_DO, bangChung: BANG_CHUNG });
      expect(ap!.actorId).toBe(B.userId);
      expect(ap!.oldValues).toMatchObject({ status: "OPEN", code: "INPUT_DRIFT" });
      expect(ap!.newValues).toMatchObject({ status: "RESOLVED", ketQua: "DA_AP_DUNG", batKy: { cap: "HAI_CAP", bangChung: "Phiếu PT-2026-9999", deNghi: { auditId: dn!.id, nguoiId: A.userId, tien: 600_000 } } });
      expect(ap!.reason).toContain("Cấp 1");
      // dòng điều chỉnh trỏ ngược về hàng chờ — "mã liên quan" tra được hai chiều
      expect((await dongSoCuaKhoan(id)).filter((d) => d.entryKind === "INPUT_CORRECTION").every((d) => d.refEventId === hold.id)).toBe(true);
    } finally {
      await datNguong(null);
    }
  });

  // ── T1-08: chuyển xem tay ──────────────────────────────────────────────────────────────────

  it("[T1-08] CHUYỂN XEM TAY: dấu vết + nhãn; hàng chờ vẫn MỞ và vẫn CHẶN khoá kỳ; idempotent; thiếu lý do bị từ chối", async () => {
    const { k, hold } = await khoanBiRut("t108");
    const chan = await demHangChoChan(db, hold.blockingPeriodId!);
    await expect(chuyenXemTay(db, { holdId: hold.id, lyDo: "ngắn", nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "THIEU_LY_DO" });
    expect(await chuyenXemTay(db, { holdId: hold.id, lyDo: "Cần kế toán trưởng xem khoản này", nguoi: A, now: bay() })).toEqual({ loai: "DA_GHI" });
    expect(await chuyenXemTay(db, { holdId: hold.id, lyDo: "Cần kế toán trưởng xem khoản này", nguoi: B, now: bay() })).toEqual({ loai: "DA_CO_TRUOC" });
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id, action: "ESCALATE_MANUAL" } })).toBe(1);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await demHangChoChan(db, hold.blockingPeriodId!)).toBe(chan);
    const d = (await docHangChoSo(db, A.quyen, { centerId: k.centerId, bayGio: bay() })).dong.find((x) => x.id === hold.id)!;
    expect(d.xuLy).toMatchObject({ trangThai: "DA_CHUYEN_XEM_TAY", xemTay: { tenNguoi: A.ten } });
  });

  // ── T1-09: hàng chờ của đề xuất ────────────────────────────────────────────────────────────

  it("[T1-09] HÀNG CHỜ CỦA ĐỀ XUẤT (`proposalId`) không xử lý được ở đây: không nút, service từ chối, 0 ghi — lối đi duy nhất là duyệt đề xuất", async () => {
    const k = await kb("t109");
    const bc = await boiCanh(k, NOW);
    const key = `T109-DX:${k.ma}`;
    await db.$transaction((tx) =>
      ghiHangCho(tx, { holdKey: key, code: "INPUT_DRIFT", paymentId: null, orderId: null, orderItemId: null, studentId: null, entryId: null, calcSlotId: null, blockingPeriodId: null, centerId: k.centerId, orgUnitId: k.ouId, detail: { proposalId: "dx_t109", chenh: [{ key: "SALE|USER|x", chenh: 100 }] } }, NOW),
    );
    const hold = await db.commissionHold.findUniqueOrThrow({ where: { holdKey: key } });
    const d = (await docHangChoSo(db, A.quyen, { centerId: k.centerId, bayGio: bay() })).dong.find((x) => x.id === hold.id)!;
    expect([d.xuLy!.huong.giaiPhong.duoc, d.xuLy!.huong.tuChoi.duoc, d.xuLy!.huong.chuyenXemTay.duoc]).toEqual([false, false, false]);
    expect(d.xuLy!.huong.deXuatId).toBe("dx_t109");
    await expect(xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "HANG_CHO_KHONG_XU_LY_DUOC" });
    await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 0, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "HANG_CHO_KHONG_XU_LY_DUOC" });
    await expect(chuyenXemTay(db, { holdId: hold.id, lyDo: LY_DO, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "HANG_CHO_KHONG_XU_LY_DUOC" });
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id } })).toBe(0);
  });

  // ── T1-11..13: lỗi do reviewer độc lập tìm ra (14/10/2026) ──────────────────────────────────

  it("[T1-11] ĐÓNG CÓ ĐIỀU KIỆN: hàng chờ đã bị người khác ĐÓNG (DISMISSED) trong lúc 'Áp dụng' đang chạy ⇒ KHÔNG ghi đè thành RESOLVED, ném TRANG_THAI_DA_DOI (rollback cả dòng sổ); chạy song song 'Giải phóng' × 'Từ chối' ⇒ trạng thái cuối khớp với sổ", async () => {
    // (a) tính chất của cổng, trực tiếp
    const x = await khoanBiRut("t111a");
    await db.commissionHold.update({ where: { id: x.hold.id }, data: { status: "DISMISSED", resolvedById: B.userId, resolvedAt: new Date(), resolutionNote: "người khác đã giữ nguyên" } });
    await expect(db.$transaction((tx) => dongCoDieuKien(tx, x.hold.id, { status: "RESOLVED", resolvedAt: new Date(), resolvedById: A.userId, resolutionNote: "áp dụng muộn" }))).rejects.toMatchObject({ ma: "TRANG_THAI_DA_DOI" });
    expect(await db.commissionHold.findUniqueOrThrow({ where: { id: x.hold.id } })).toMatchObject({ status: "DISMISSED", resolvedById: B.userId });
    // đối chứng dương: hàng chờ còn OPEN thì đóng được
    const y = await khoanBiRut("t111b");
    await db.$transaction((tx) => dongCoDieuKien(tx, y.hold.id, { status: "RESOLVED", resolvedAt: new Date(), resolvedById: A.userId, resolutionNote: "đóng hợp lệ" }));
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: y.hold.id } })).status).toBe("RESOLVED");

    // (b) bất biến dưới đua THẬT, bất kể ai thắng: RESOLVED ⇔ có dòng điều chỉnh; DISMISSED ⇔ không có
    await datNguong(null);
    for (let i = 0; i < 3; i++) {
      const z = await khoanBiRut(`t111c${i}`);
      const kq = await Promise.allSettled([
        quyetXuLy(db, z.bc, { holdId: z.hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 300_000, nguoi: A, now: bay() }),
        quyetXuLy(db, z.bc, { holdId: z.hold.id, quyetDinh: "GIU_NGUYEN", lyDo: "Người thứ hai giữ nguyên số đã tính", bangChung: BANG_CHUNG, tienDaThay: 0, nguoi: B, now: bay() }),
      ]);
      expect(kq.filter((r) => r.status === "fulfilled").length, `lượt ${i}`).toBe(1);
      const cuoi = await db.commissionHold.findUniqueOrThrow({ where: { id: z.hold.id } });
      const soDong = (await dongSoCuaKhoan(z.bi)).filter((d) => d.entryKind === "INPUT_CORRECTION").length;
      if (cuoi.status === "RESOLVED") {
        expect(soDong, `lượt ${i}: RESOLVED phải có dòng điều chỉnh`).toBe(1);
        expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: z.hold.id, action: "DISMISS" } })).toBe(0);
      } else {
        expect(cuoi.status, `lượt ${i}`).toBe("DISMISSED");
        expect(soDong, `lượt ${i}: DISMISSED không được có dòng điều chỉnh`).toBe(0);
        expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: z.hold.id, action: "APPLY" } })).toBe(0);
      }
    }
  });

  it("[T1-12] PHẠM VI GHI = nơi giữ ĐÚNG `commission_periods:manage`: người quản lý kỳ ở CS-A nhưng chỉ XEM hoa hồng ở CS-B thấy hàng chờ CS-B mà KHÔNG xem trước / đề nghị / quyết / chuyển xem tay được; ở CS-A (đối chứng dương) làm được", async () => {
    const kA = await kb("t112a");
    const kBb = await kb("t112b");
    const bcA = await boiCanh(kA, NOW);
    const bcB = await boiCanh(kBb, NOW);
    const tao = async (k: KichBan, bc: typeof bcA) => {
      const bi = await tienVe(k, await dungBe(k, "a"), { soTien: 10_000_000, ngay: D("2026-10-12") });
      await quetKhoan(db, bc, bi);
      await tuChoi(k, bi);
      await quetKhoan(db, bc, bi);
      return db.commissionHold.findFirstOrThrow({ where: { code: "PAYMENT_WITHDRAWN", paymentId: bi } });
    };
    const holdA = await tao(kA, bcA);
    const holdB = await tao(kBb, bcB);
    const perm = (action: string, centerScope: string[]): PermEntry => ({ action, scopeType: "GLOBAL", orgUnitId: kA.ouId, roleCode: "FIXTURE", centerScope } as PermEntry);
    const tuyBien: Actor = {
      ...A.quyen,
      isSuperAdmin: false,
      isHoLevel: false,
      grantsAllow: new Set(),
      visibleCenterIds: [kA.centerId, kBb.centerId],
      permissions: [perm("commission:view-center", [kA.centerId, kBb.centerId]), perm("commission_periods:manage", [kA.centerId])],
    };
    const nguoi: NguoiThaoTacKy = { userId: A.userId, ten: "Quản lý kỳ CS-A, chỉ xem CS-B", quyen: tuyBien };

    // nhìn thấy cả hai (phạm vi ĐỌC gộp theo tiền tố) — đó chính là khe mà phép kiểm GHI phải bịt
    const ds = await docHangChoSo(db, tuyBien, { bayGio: bay() });
    expect(ds.dong.some((d) => d.id === holdB.id)).toBe(true);
    const khongMo = { ma: "HANG_CHO_KHONG_MO" };
    await expect(xemTruocXuLy(db, bcB, { holdId: holdB.id, nguoi, now: bay() })).rejects.toMatchObject(khongMo);
    await expect(deNghiXuLy(db, bcB, { holdId: holdB.id, quyetDinh: "GIU_NGUYEN", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi, now: bay() })).rejects.toMatchObject(khongMo);
    await expect(quyetXuLy(db, bcB, { holdId: holdB.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 300_000, nguoi, now: bay() })).rejects.toMatchObject(khongMo);
    await expect(chuyenXemTay(db, { holdId: holdB.id, lyDo: LY_DO, nguoi, now: bay() })).rejects.toMatchObject(khongMo);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: holdB.id } })).status).toBe("OPEN");
    expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: holdB.id } })).toBe(0);
    // đối chứng dương: cùng người, hàng chờ ở CS-A (nơi giữ manage)
    expect((await xemTruocXuLy(db, bcA, { holdId: holdA.id, nguoi, now: bay() })).giaiPhong).toMatchObject({ ok: true, tongTuyetDoi: 300_000 });
    // SUPER_ADMIN và per-user grant là ngoại lệ toàn cục có chủ đích
    expect((await xemTruocXuLy(db, bcB, { holdId: holdB.id, nguoi: { ...nguoi, quyen: { ...tuyBien, grantsAllow: new Set(["commission_periods:manage"]) } }, now: bay() })).giaiPhong.ok).toBe(true);
  });

  it("[T1-13] ĐỀ NGHỊ phải đủ TRẦN: tiền TĂNG sau khi người A lập đề nghị ⇒ A lập lại được (đề nghị mới nâng trần) thay vì nhận «đã có» rồi người B gặp TIEN_DA_DOI mãi", async () => {
    await datNguong(100_000);
    try {
      const { bc, hold, id } = await troiNguoiChot("t113");
      expect(await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() })).toEqual({ loai: "DA_GHI", tien: 600_000 });
      // gửi lại cùng đề nghị, tiền không đổi ⇒ vẫn idempotent
      expect(await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() })).toEqual({ loai: "DA_CO_TRUOC" });
      // số tiền đo được TĂNG (detail của hàng chờ ghi số lớn hơn; `tienChoCap` lấy max của detail và bản xem trước)
      const d = hold.detail as { chenh: { key: string; chenh: number }[] };
      await db.commissionHold.update({ where: { id: hold.id }, data: { detail: { ...d, chenh: d.chenh.map((c) => ({ ...c, chenh: c.chenh * 3 })) } } });
      expect(await deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() })).toEqual({ loai: "DA_GHI", tien: 1_800_000 });
      expect(await db.auditLog.count({ where: { entityType: "CommissionHold", entityId: hold.id, action: "RELEASE_REQUEST" } })).toBe(2);
      // người B duyệt theo đề nghị MỚI NHẤT (trần 1.800.000 ≥ số thật 600.000) ⇒ ghi được
      const r = await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: "Đồng ý theo đề nghị mới nhất", bangChung: "Biên bản 14/10 đã kiểm", tienDaThay: 600_000, nguoi: B, now: bay() });
      expect(r).toMatchObject({ loai: "DA_XU_LY", cap: "HAI_CAP", ketQua: { loai: "DA_AP_DUNG", soDong: 2 } });
      expect(await demSo(id)).toBe(3);
    } finally {
      await datNguong(null);
    }
  });

  // ── T1-10: KHÔNG "ép pass" ─────────────────────────────────────────────────────────────────

  it("[T1-10] KHÔNG ÉP PASS: đầu vào đã đổi sau khi hàng chờ lập ⇒ xem trước báo cổng nào chặn, 'Giải phóng' bị từ chối, nhưng 'Từ chối' vẫn dùng được; 0 dòng sổ khi bị chặn", async () => {
    await datNguong(null);
    const { k, bc, id, hold } = await troiNguoiChot("t110");
    const nua = await seedUser({ email: `${k.ma}-sale-nua@ci.test`, role: "SALES_CSM", name: `${k.ma}-sale-nua`, phone: null });
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: nua.id } });

    const xem = await xemTruocXuLy(db, bc, { holdId: hold.id, nguoi: A, now: bay() });
    expect(xem.giaiPhong).toMatchObject({ ok: false, ma: "DAU_VAO_DA_DOI" });
    await expect(quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 600_000, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "DAU_VAO_DA_DOI" });
    await expect(deNghiXuLy(db, bc, { holdId: hold.id, quyetDinh: "AP_DUNG", lyDo: LY_DO, bangChung: BANG_CHUNG, nguoi: A, now: bay() })).rejects.toMatchObject({ ma: "DAU_VAO_DA_DOI" });
    expect(await demSo(id)).toBe(1);
    expect((await db.commissionHold.findUniqueOrThrow({ where: { id: hold.id } })).status).toBe("OPEN");
    // an toàn tiền: "Từ chối" (không ghi) vẫn được
    expect(await quyetXuLy(db, bc, { holdId: hold.id, quyetDinh: "GIU_NGUYEN", lyDo: LY_DO, bangChung: BANG_CHUNG, tienDaThay: 0, nguoi: A, now: bay() })).toMatchObject({ loai: "DA_XU_LY", ketQua: { loai: "DA_GIU_NGUYEN" } });
    expect(await demSo(id)).toBe(1);
  });
});
