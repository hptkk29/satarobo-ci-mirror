// @vitest-environment node
/**
 * [NHH-SO-DB-*] — TAB SỔ HOA HỒNG, tầng ĐỌC trên Postgres thật (06 §5.3, §5.6; 05 AC-SEC-04/05/09, AC-COM):
 *   hàng chờ trước sổ · sổ "Tất cả" (lọc/phạm vi) · ngăn "Vì sao con số này" · "hoa hồng dự kiến của bạn".
 *
 * Quy tắc phạm vi cần khoá (mọi ca có ĐỐI CHỨNG DƯƠNG — luật 11 "ca chỉ khẳng định sự vắng mặt luôn đạt khi tính năng hỏng hoàn toàn"):
 *   · Sale (chỉ `view-self`) thấy dòng CỦA MÌNH, kể cả dòng ở cơ sở khác; bộ lọc người khác bị ÉP về mình;
 *   · QLCS CS1 thấy CS1, KHÔNG thấy CS2; Kế toán HO thấy cả hai;
 *   · hàng chờ: chỉ `view-center`; QLCS CS1 không thấy hàng chờ CS2;
 *   · ngăn "Vì sao": dòng ngoài tầm nhìn ⇒ null; Sale không thấy tổng tỉ lệ các vai, không đọc nhật ký thao tác.
 *
 * Mỗi ca tự dựng kịch bản (luật 18); ngày TUYỆT ĐỐI (luật 19). Chạy: `pnpm test:hoa-hong-db`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.setConfig({ testTimeout: 60_000 });

import { can, PermissionError } from "../../lib/auth/can";
import { db } from "../../lib/db";
import { RUN_DB_TESTS, LY_DO_BO_QUA } from "../_helpers/db-gate";
import { assertTestDb, seedOrg } from "../e2e/_helpers/seed";
import { clearSettingsCache } from "../../lib/settings/service";
import { docTrangSo, docLuaChonBoLocSo } from "../../lib/hoa-hong/doc-so-giao-dien";
import { demHangChoSo, docHangChoSoCuaToi, KICH_THUOC_HANG_CHO_SO } from "../../lib/hoa-hong/hang-cho-so-doc";
import type { LoaiHangChoSo } from "../../lib/hoa-hong/hang-cho-so-nhom";
import { docViSaoDayDu } from "../../lib/hoa-hong/vi-sao-doc";
import { docDuKienChoMan } from "../../lib/hoa-hong/du-kien-man-hinh-doc";
import type { QuyenLienKet } from "../../lib/hoa-hong/hang-cho-so";
import { taoKhieuNai } from "../../lib/hoa-hong/khieu-nai";
import { KEY_TAO_KHIEU_NAI, veNutKhieuNaiDong } from "../../lib/hoa-hong/khieu-nai-ma";
import { quetKhoan } from "../../lib/hoa-hong/quet-khoan";
import {
  actorCua,
  boiCanh,
  D,
  datMocCutover,
  donKichBan,
  dongSoCuaKhoan,
  dungBe,
  dungKichBan,
  ganVai,
  hoanTien,
  huyChinhSach,
  nguoiKyHo,
  nguoiKyQlcs,
  tienVe,
  type KichBan,
} from "./_kich-ban";

if (!RUN_DB_TESTS) console.warn(`[NHH-SO-DB] BỎ QUA bộ chạm DB: ${LY_DO_BO_QUA}`);


/** Gọi hàm đọc thật với dạng tham số của trang (cơ sở · nhóm việc · trang · quyền link). */
const docHangChoSo = (a: Parameters<typeof docHangChoSoCuaToi>[0], o: { coSoId: string | null; loai: LoaiHangChoSo | null; trang: number; quyen: QuyenLienKet }) =>
  docHangChoSoCuaToi(a, { ...(o.coSoId ? { centerId: o.coSoId } : {}), ...(o.loai ? { loai: o.loai } : {}), trang: o.trang, coTrang: KICH_THUOC_HANG_CHO_SO, quyen: o.quyen });

const NOW = D("2026-12-20");
const KHONG_QUYEN: QuyenLienKet = { don: false, lead: false, chinhSach: false, nguoiPhuTrach: false, nguon: false };
const DU_QUYEN: QuyenLienKet = { don: true, lead: true, chinhSach: true, nguoiPhuTrach: true, nguon: true };
const cuaToi: KichBan[] = [];
const holdCuaToi: string[] = [];
const KEY_BAT = "hoaHong.engineBat";

/** `nguoiKyQlcs` gán vai MỘT lần (khoá duy nhất user×đơn vị×vai) ⇒ nhớ lại theo kịch bản. */
const qlcsDaDung = new Map<string, ReturnType<typeof actorCua>>();
async function qlcsCua(k: KichBan) {
  if (!qlcsDaDung.has(k.ma)) {
    await nguoiKyQlcs(k);
    qlcsDaDung.set(k.ma, actorCua(k.qlcs.id));
  }
  return await qlcsDaDung.get(k.ma)!;
}
async function kb(tien: string, p: Parameters<typeof dungKichBan>[1] = {}) {
  const k = await dungKichBan(tien, p);
  cuaToi.push(k);
  return k;
}
/** Hàng chờ dựng THẲNG (cho các mã mà đường quét khó dựng được trong một ca): `holdKey` riêng, đóng ở afterAll. */
async function themHold(k: KichBan, code: "POLICY_OVERLAP" | "CAP_EXCEEDED" | "INPUT_DRIFT" | "NO_ORG_UNIT" | "CHUA_GAN_CON" | "NEGATIVE_BALANCE", detail: object, p: { orderId?: string | null } = {}) {
  const mem = code === "CHUA_GAN_CON" || code === "NEGATIVE_BALANCE";
  const h = await db.commissionHold.create({
    data: {
      holdKey: `fx:${k.ma}:${code}:${holdCuaToi.length}`,
      code,
      severity: mem ? "SOFT" : "HARD",
      status: "OPEN",
      orderId: p.orderId ?? null,
      detail: detail as never,
      centerId: k.centerId,
      orgUnitId: k.ouId,
    },
  });
  holdCuaToi.push(h.id);
  return h.id;
}

describe.skipIf(!RUN_DB_TESTS)("[NHH-SO-DB] tab Sổ — tầng đọc", () => {
  let k1: KichBan; // CS1: có lead; Sale 4% + Quản lý cơ sở 2%
  let k2: KichBan; // CS2: cùng hình dạng, người khác
  let thu1: string;
  let thu2: string;

  beforeAll(async () => {
    assertTestDb();
    await seedOrg(["HO", "CS1", "CS2"]);
    await datMocCutover("2026-10");
    const rules = [{ vai: "SALE", rate: 0.04 }, { vai: "CENTER_MANAGER", rate: 0.02 }];
    k1 = await kb("soui1", { rules });
    k2 = await kb("soui2", { rules });
    for (const k of [k1, k2]) await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    const t1 = await tienVe(k1, await dungBe(k1, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-10-12") });
    const t2 = await tienVe(k2, await dungBe(k2, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-10-12") });
    thu1 = t1;
    thu2 = t2;
    await quetKhoan(db, await boiCanh(k1, NOW), t1);
    await quetKhoan(db, await boiCanh(k2, NOW), t2);
  }, 180_000);

  afterAll(async () => {
    if (holdCuaToi.length > 0) await db.commissionHold.updateMany({ where: { id: { in: holdCuaToi } }, data: { status: "RESOLVED", resolvedAt: NOW, resolutionNote: "dọn fixture so-ui" } });
    await donKichBan(cuaToi);
    await datMocCutover(null);
    await db.systemSetting.deleteMany({ where: { key: KEY_BAT } });
    clearSettingsCache();
  }, 60_000);

  // ── Sổ "Tất cả" ───────────────────────────────────────────────────────────────────────────────────────
  it("[NHH-SO-DB-01] Sale chỉ thấy dòng CỦA MÌNH; bộ lọc người khác bị ÉP về mình; QLCS/HO thấy cả hai vai (đối chứng dương: dòng QLCS CÓ trong sổ)", async () => {
    const sale1 = await actorCua(k1.sale.id);
    const dong = (await docTrangSo(sale1, { centerId: k1.centerId, coTrang: 200 })).dong;
    expect(dong.map((d) => [d.roleCode, d.amount, d.nguoiHuong.id])).toEqual([["SALE", 400_000, k1.sale.id]]);
    // lọc theo QLCS ⇒ không ném, không lộ: vẫn là dòng của chính Sale
    const ep = (await docTrangSo(sale1, { centerId: k1.centerId, nguoiHuong: k1.qlcs.id, coTrang: 200 })).dong;
    expect(ep.map((d) => d.nguoiHuong.id)).toEqual([k1.sale.id]);
    // đối chứng dương: người có tầm nhìn cơ sở thấy CẢ dòng của QLCS
    const ql = await qlcsCua(k1);
    const cua = (await docTrangSo(ql, { centerId: k1.centerId, coTrang: 200 })).dong;
    expect(cua.map((d) => d.roleCode).sort()).toEqual(["CENTER_MANAGER", "SALE"]);
  });

  it("[NHH-SO-DB-02] QLCS CS1 KHÔNG thấy dòng CS2 (kể cả khi tự lọc cơ sở CS2); Kế toán HO thấy cả hai", async () => {
    const ql = await qlcsCua(k1);
    const ho = (await nguoiKyHo()).quyen;
    expect((await docTrangSo(ql, { centerId: k2.centerId, coTrang: 200 })).dong).toEqual([]);
    expect((await docTrangSo(ql, { centerId: k2.centerId, coTrang: 200 })).tongSo).toBe(0);
    const hai = async (a: typeof ho) => ({
      cs1: (await docTrangSo(a, { centerId: k1.centerId, coTrang: 200 })).tongSo,
      cs2: (await docTrangSo(a, { centerId: k2.centerId, coTrang: 200 })).tongSo,
    });
    expect(await hai(ho)).toEqual({ cs1: 2, cs2: 2 });
    expect(await hai(ql)).toEqual({ cs1: 2, cs2: 0 });
  });

  it("[NHH-SO-DB-03] Sale CS1 xem được dòng của CHÍNH MÌNH ở cơ sở khác nhưng không thấy dòng CS2 của người khác", async () => {
    // Sale CS1 cũng là người hưởng ở CS2 (ca 'lead CS1, đơn CS2'): thêm một khoản CS2 mà người hưởng là Sale CS1.
    const k = await kb("soui3", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const sale1 = await actorCua(k1.sale.id);
    await db.lead.update({ where: { id: k.lead!.id }, data: { convertedById: k1.sale.id } });
    await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    const t = await tienVe(k, await dungBe(k, "a", { tongTien: 5_000_000 }), { soTien: 5_000_000, ngay: D("2026-10-14") });
    await quetKhoan(db, await boiCanh(k, NOW), t);
    const dong = (await docTrangSo(sale1, { centerId: k.centerId, coTrang: 200 })).dong;
    expect(dong.map((d) => [d.roleCode, d.amount, d.centerId])).toEqual([["SALE", 200_000, k.centerId]]);
    expect((await docTrangSo(sale1, { centerId: k2.centerId, coTrang: 200 })).dong).toEqual([]);
  });

  it("[NHH-SO-DB-04] bộ lọc: vai · loại giao dịch · trạng thái chi · nhóm nguồn — mỗi bộ lọc có đối chứng ÂM và DƯƠNG", async () => {
    const ho = (await nguoiKyHo()).quyen;
    const co = { centerId: k1.centerId, coTrang: 200 };
    expect((await docTrangSo(ho, { ...co, roleCode: "SALE" })).dong.map((d) => d.roleCode)).toEqual(["SALE"]);
    expect((await docTrangSo(ho, { ...co, roleCode: "TRIAL_TEACHER" })).dong).toEqual([]);
    expect((await docTrangSo(ho, { ...co, loaiGiaoDich: "NEW" })).tongSo).toBe(2);
    expect((await docTrangSo(ho, { ...co, loaiGiaoDich: "RENEWAL" })).tongSo).toBe(0);
    expect((await docTrangSo(ho, { ...co, trangThaiChi: "PENDING" })).tongSo).toBe(2);
    expect((await docTrangSo(ho, { ...co, trangThaiChi: "PAID" })).tongSo).toBe(0);
    const nhom = (await docTrangSo(ho, co)).dong[0]!.nhomNguon;
    expect((await docTrangSo(ho, { ...co, nhomNguon: nhom })).tongSo).toBe(2);
    expect((await docTrangSo(ho, { ...co, nhomNguon: "KHONG_CO_NHOM_NAY" })).tongSo).toBe(0);
    expect((await docTrangSo(ho, { ...co, thang: "2026-10" })).tongSo).toBe(2);
    expect((await docTrangSo(ho, { ...co, thang: "2025-01" })).tongSo).toBe(0);
  });

  it("[NHH-SO-DB-05] mỗi dòng mang TÊN để hiển thị: học viên, nhóm nguồn, vai, văn bản + phiên bản; tổng tiền cộng đúng", async () => {
    const ho = (await nguoiKyHo()).quyen;
    const r = await docTrangSo(ho, { centerId: k1.centerId, coTrang: 200 });
    const sale = r.dong.find((d) => d.roleCode === "SALE")!;
    expect(sale.tenHocVien).toBe(`Bé a ${k1.ma}`);
    expect(sale.tenVai.length).toBeGreaterThan(0);
    expect(sale.tenNhomNguon.length).toBeGreaterThan(0);
    expect(sale.vanBan).not.toBeNull();
    expect(sale.versionNo).toBe(1);
    expect(r.tongTien).toBe(600_000);
  });

  it("[NHH-SO-DB-06] lựa chọn bộ lọc: Sale không có danh sách người hưởng; QLCS CS1 không thấy người của CS2; HO thấy cả hai", async () => {
    const sale1 = await actorCua(k1.sale.id);
    const ql = await qlcsCua(k1);
    const ho = (await nguoiKyHo()).quyen;
    const luaSale = await docLuaChonBoLocSo(sale1);
    expect(luaSale.nguoiHuong).toEqual([]);
    expect(luaSale.thang).toContain("2026-10");
    const idCua = async (a: typeof ho) => new Set((await docLuaChonBoLocSo(a)).nguoiHuong.map((n) => n.id));
    const cuaQl = await idCua(ql);
    expect(cuaQl.has(k1.sale.id)).toBe(true);
    expect(cuaQl.has(k2.sale.id)).toBe(false);
    const cuaHo = await idCua(ho);
    expect(cuaHo.has(k1.sale.id) && cuaHo.has(k2.sale.id)).toBe(true);
  });

  it("[NHH-SO-DB-07] người không có quyền xem sổ ⇒ ném PermissionError (fail-closed), không rơi về rỗng", async () => {
    // Người dùng nội bộ KHÔNG có vai nào (`UserOrgRole` rỗng) ⇒ actor không giữ khoá hoa hồng nào.
    const a = await actorCua(k1.ketToanB.id);
    await expect(docTrangSo(a, { coTrang: 10 })).rejects.toBeInstanceOf(PermissionError);
    await expect(docLuaChonBoLocSo(a)).rejects.toBeInstanceOf(PermissionError);
    await expect(docViSaoDayDu(a, "bat-ky")).rejects.toBeInstanceOf(PermissionError);
  });

  // ── Hàng chờ trước sổ ─────────────────────────────────────────────────────────────────────────────────
  it("[NHH-SO-DB-10] ĐƠN KHÔNG CÓ LEAD ⇒ hàng chờ 'Chưa phân giải người hưởng' mang nhãn 'đơn chưa nối lead', KHÔNG vào nhóm nguồn, link là ĐƠN; không dòng sổ nào cho vai Sale", async () => {
    const k = await kb("soui10", { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }] });
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const t = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), t);
    const ho = (await nguoiKyHo()).quyen;
    const r = await docHangChoSo(ho, { coSoId: k.centerId, loai: null, trang: 1, quyen: DU_QUYEN });
    const dong = r.dong.find((d) => d.ma === "UNRESOLVED_BENEFICIARY");
    expect(dong).toBeDefined();
    expect(dong).toMatchObject({ loai: "CHUA_PHAN_GIAI_NGUOI_HUONG", nhom: "CHUA_PHAN_GIAI_NGUOI_HUONG", khongCoLead: true });
    expect(dong!.lyDo).toMatch(/không có lead/i);
    expect(dong!.lienKet?.href).toBe(`/orders/${be.orderId}`);
    expect(dong!.tenHocVien).toBe(`Bé a ${k.ma}`);
    expect(dong!.tienVai).toBe(400_000);
    expect(await dongSoCuaKhoan(t)).toEqual([]);
    // thiếu quyền mở đơn ⇒ vẫn nêu việc, KHÔNG có link
    const khong = await docHangChoSo(ho, { coSoId: k.centerId, loai: null, trang: 1, quyen: KHONG_QUYEN });
    expect(khong.dong.find((d) => d.ma === "UNRESOLVED_BENEFICIARY")).toMatchObject({ lienKet: null });
    expect(khong.dong.find((d) => d.ma === "UNRESOLVED_BENEFICIARY")!.buoc.length).toBeGreaterThan(5);
  });

  it("[NHH-SO-DB-11] đếm: tổng · chặn khoá · theo nhóm — và số nhóm KHÔNG đổi theo nhóm đang lọc", async () => {
    const k = await kb("soui11", { rules: [{ vai: "SALE", rate: 0.04 }] });
    await themHold(k, "POLICY_OVERLAP", { lyDo: "Hai chính sách chồng nhau ở vai SALE." });
    await themHold(k, "CAP_EXCEEDED", { lyDo: "Tổng tỉ lệ vượt trần." });
    // HAI hàng chờ CÙNG mã: nếu bộ đếm cộng 1 cho mỗi mã thay vì số dòng của mã, ca có đúng một hàng chờ mỗi mã sẽ không bao giờ lộ
    await themHold(k, "CAP_EXCEEDED", { lyDo: "Tổng tỉ lệ vượt trần (ô khác)." });
    await themHold(k, "INPUT_DRIFT", { lyDo: "Dữ liệu đổi." });
    await themHold(k, "CHUA_GAN_CON", { lyDo: "Khoản thu chưa gắn bé." });
    await themHold(k, "NEGATIVE_BALANCE", { lyDo: "Sổ âm ròng." });
    const ho = (await nguoiKyHo()).quyen;
    const dem = await demHangChoSo(ho, k.centerId);
    expect(dem.canXuLy).toBe(6);
    expect(dem.dem.CHAN_KHOA_KY).toBe(5); // NEGATIVE_BALANCE không chặn khoá
    expect(dem.demTheoLoai).toEqual({ CHUA_PHAN_GIAI_NGUOI_HUONG: 0, CHO_CHINH_SACH: 1, VUOT_TRAN: 2, THIEU_DU_LIEU_THANH_TOAN: 1, CHO_DIEU_CHINH: 1, SO_DU_AM: 1 });
    const loc = await docHangChoSo(ho, { coSoId: k.centerId, loai: "CHO_DIEU_CHINH", trang: 1, quyen: KHONG_QUYEN });
    expect(loc.tongSo).toBe(1);
    expect(loc.dong.map((d) => d.ma)).toEqual(["INPUT_DRIFT"]);
    expect(loc.dong[0]!.nhom === "CHAN_KHOA_KY").toBe(true); // loại «Chờ điều chỉnh» (INPUT_DRIFT) vẫn CHẶN khoá kỳ
    // «Số dư âm» là MỘT LOẠI riêng, không chặn khoá — hai chiều (loại / chặn khoá) độc lập, cùng đọc từ một mã
    const am = await docHangChoSo(ho, { coSoId: k.centerId, loai: "SO_DU_AM", trang: 1, quyen: KHONG_QUYEN });
    expect(am.dong.map((d) => d.ma)).toEqual(["NEGATIVE_BALANCE"]);
    expect(am.dong[0]!.nhom === "CHAN_KHOA_KY").toBe(false);
    // số trên chip KHÔNG đổi theo loại đang lọc (cùng một `groupBy`, không phụ thuộc bộ lọc)
    expect(loc.demTheoLoai).toEqual(dem.demTheoLoai);
    expect(loc.canXuLy).toBe(6);
    // đối chứng: bỏ lọc nhóm thì thấy đủ 6
    expect((await docHangChoSo(ho, { coSoId: k.centerId, loai: null, trang: 1, quyen: KHONG_QUYEN })).tongSo).toBe(6);
  });

  it("[NHH-SO-DB-12] hàng chờ cách ly cơ sở: QLCS CS1 KHÔNG thấy hàng chờ CS2 (kể cả khi tự lọc cơ sở CS2); HO thấy cả hai", async () => {
    const a = await kb("soui12a", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const b = await kb("soui12b", { rules: [{ vai: "SALE", rate: 0.04 }] });
    await themHold(a, "POLICY_OVERLAP", { lyDo: "A" });
    await themHold(b, "POLICY_OVERLAP", { lyDo: "B" });
    const ql = await qlcsCua(a);
    const ho = (await nguoiKyHo()).quyen;
    expect((await demHangChoSo(ql, a.centerId)).canXuLy).toBe(1);
    expect((await demHangChoSo(ql, b.centerId)).canXuLy).toBe(0);
    expect((await docHangChoSo(ql, { coSoId: b.centerId, loai: null, trang: 1, quyen: KHONG_QUYEN })).dong).toEqual([]);
    expect((await demHangChoSo(ho, a.centerId)).canXuLy).toBe(1);
    expect((await demHangChoSo(ho, b.centerId)).canXuLy).toBe(1);
  });

  it("[NHH-SO-DB-13] hàng chờ KHÔNG dành cho Sale (chỉ view-self): ném PermissionError ở cả đếm lẫn đọc", async () => {
    const sale1 = await actorCua(k1.sale.id);
    await expect(demHangChoSo(sale1, null)).rejects.toBeInstanceOf(PermissionError);
    await expect(docHangChoSo(sale1, { coSoId: null, loai: null, trang: 1, quyen: KHONG_QUYEN })).rejects.toBeInstanceOf(PermissionError);
  });

  it("[NHH-SO-DB-14] phân trang Ở TẦNG TRUY VẤN: 27 việc ⇒ trang 1 có đúng 25, trang 2 có 2, không trùng; hàng chờ đã RESOLVED không đếm", async () => {
    const k = await kb("soui14", { rules: [{ vai: "SALE", rate: 0.04 }] });
    const ids: string[] = [];
    for (let i = 0; i < 27; i += 1) ids.push(await themHold(k, "POLICY_OVERLAP", { lyDo: `việc ${i}` }));
    const ho = (await nguoiKyHo()).quyen;
    const t1 = await docHangChoSo(ho, { coSoId: k.centerId, loai: null, trang: 1, quyen: KHONG_QUYEN });
    const t2 = await docHangChoSo(ho, { coSoId: k.centerId, loai: null, trang: 2, quyen: KHONG_QUYEN });
    expect(t1.tongSo).toBe(27);
    expect(t1.dong).toHaveLength(KICH_THUOC_HANG_CHO_SO);
    expect(t2.dong).toHaveLength(2);
    expect(new Set([...t1.dong, ...t2.dong].map((d) => d.id)).size).toBe(27);
    await db.commissionHold.update({ where: { id: ids[0]! }, data: { status: "RESOLVED", resolvedAt: NOW } });
    expect((await demHangChoSo(ho, k.centerId)).canXuLy).toBe(26);
  });

  it("[NHH-SO-DB-15] một nguồn cho hai trục (nhóm chặn / loại việc): tổng `dem` = tổng `demTheoLoai` = `canXuLy`; không truyền `quyen` ⇒ KHÔNG dòng nào có link (fail-closed); đối chứng: có quyền thì có link", async () => {
    const k = await kb("soui15", { coLead: false, rules: [{ vai: "SALE", rate: 0.04 }] });
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const t = await tienVe(k, be, { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, await boiCanh(k, NOW), t);
    await themHold(k, "POLICY_OVERLAP", { lyDo: "chồng" }, { orderId: be.orderId });
    await themHold(k, "NEGATIVE_BALANCE", { lyDo: "âm" });
    const ho = (await nguoiKyHo()).quyen;
    const tong = (r: Record<string, number>) => Object.values(r).reduce((a, c) => a + c, 0);
    const r = await docHangChoSoCuaToi(ho, { centerId: k.centerId, coTrang: 100 });
    expect(tong(r.dem)).toBe(r.canXuLy);
    expect(tong(r.demTheoLoai)).toBe(r.canXuLy);
    expect(r.canXuLy).toBeGreaterThanOrEqual(3);
    expect(r.dong.every((d) => d.lienKet === null)).toBe(true);
    const co = await docHangChoSoCuaToi(ho, { centerId: k.centerId, coTrang: 100, quyen: DU_QUYEN });
    expect(co.dong.some((d) => d.lienKet !== null)).toBe(true);
    // hai trục đếm cùng kết quả với `demHangChoSo` (pill/công tắc) — một nguồn
    const d2 = await demHangChoSo(ho, k.centerId);
    expect([d2.canXuLy, d2.dem, d2.demTheoLoai]).toEqual([r.canXuLy, r.dem, r.demTheoLoai]);
  });

  it("[NHH-SO-DB-16] NÚT KHIẾU NẠI trên dòng sổ THẬT: điều kiện vẽ (`veNutKhieuNaiDong`) dùng ĐÚNG id mà máy chủ kiểm — Sale thấy nút ở dòng của mình VÀ `taoKhieuNai` nhận dòng ấy; QLCS xem cùng dòng (thấy được) ⇒ không nút VÀ máy chủ từ chối", async () => {
    const sale = await actorCua(k1.sale.id);
    const ql = await qlcsCua(k1);
    const dongSale = (await docTrangSo(sale, { centerId: k1.centerId, coTrang: 200 })).dong.find((d) => d.roleCode === "SALE")!;
    expect(dongSale).toBeDefined();
    // id trên dòng sổ ĐÚNG là id người dùng (cùng thứ `laDongCuaToi` so với `beneficiaryUserId`) — id bịa sẽ cho "không nút" với MỌI người mà không ca âm nào đỏ
    expect(dongSale.nguoiHuong).toMatchObject({ kind: "USER", id: k1.sale.id });
    expect(veNutKhieuNaiDong(dongSale, k1.sale.id, can(sale, KEY_TAO_KHIEU_NAI))).toBe(true);
    const dauVao = { dich: { loai: "DONG", id: dongSale.id }, lyDo: "Dòng hoa hồng này tính thiếu so với thoả thuận ban đầu của tôi với công ty", bangChung: [{ ghiChu: "Tin nhắn Zalo ngày 05/10/2026 xác nhận mức hưởng" }] };
    const r = await taoKhieuNai(db, { nguoi: { userId: k1.sale.id, ten: "Sale", quyen: sale }, dauVao });
    expect(r.disputeId.length).toBeGreaterThan(5); // đối chứng dương: máy chủ NHẬN dòng mà nút hứa
    // QLCS THẤY cùng dòng (view-center) nhưng đó không phải dòng của họ
    const thayBoiQl = (await docTrangSo(ql, { centerId: k1.centerId, coTrang: 200 })).dong.find((d) => d.id === dongSale.id);
    expect(thayBoiQl).toBeDefined();
    expect(veNutKhieuNaiDong(thayBoiQl!, k1.qlcs.id, can(ql, KEY_TAO_KHIEU_NAI))).toBe(false);
    await expect(taoKhieuNai(db, { nguoi: { userId: k1.qlcs.id, ten: "QLCS", quyen: ql }, dauVao })).rejects.toThrow();
    // dòng của CHÍNH QLCS thì QLCS thấy nút (đối chứng dương cho vế «cùng id»)
    const dongQl = (await docTrangSo(ql, { centerId: k1.centerId, coTrang: 200 })).dong.find((d) => d.nguoiHuong.id === k1.qlcs.id)!;
    expect(dongQl).toBeDefined();
    expect(veNutKhieuNaiDong(dongQl, k1.qlcs.id, can(ql, KEY_TAO_KHIEU_NAI))).toBe(true);
    await db.$executeRaw`TRUNCATE "CommissionDispute"`; // khiếu nại không xoá được từng dòng (trigger) — dọn bằng cắt bảng như khieu-nai.spec
  });

  // ── Ngăn "Vì sao con số này" ──────────────────────────────────────────────────────────────────────────
  it("[NHH-SO-DB-20] 'Vì sao': dòng CỦA MÌNH ⇒ đủ chuỗi; dòng của người khác / cơ sở khác ⇒ null (không lộ có tồn tại)", async () => {
    const sale1 = await actorCua(k1.sale.id);
    const ql1 = await qlcsCua(k1);
    const dong1 = await dongSoCuaKhoan(thu1);
    const dong2 = await dongSoCuaKhoan(thu2);
    const dSale1 = dong1.find((d) => d.roleCode === "SALE")!;
    const dQl1 = dong1.find((d) => d.roleCode === "CENTER_MANAGER")!;
    const dSale2 = dong2.find((d) => d.roleCode === "SALE")!;
    const v = await docViSaoDayDu(sale1, dSale1.id);
    expect(v).not.toBeNull();
    expect(v!.muc.map((m) => m.nhan)).toContain("Khoản thu gốc");
    expect(v!.tomTat.soTien).toBe(400_000);
    expect(await docViSaoDayDu(sale1, dQl1.id)).toBeNull(); // dòng QLCS cùng khoản
    expect(await docViSaoDayDu(sale1, dSale2.id)).toBeNull(); // dòng Sale CS2
    expect(await docViSaoDayDu(ql1, dSale2.id)).toBeNull(); // QLCS CS1 ↛ CS2
    // đối chứng dương: QLCS CS1 mở được dòng QLCS cùng cơ sở; HO mở được dòng CS2
    expect(await docViSaoDayDu(ql1, dQl1.id)).not.toBeNull();
    expect(await docViSaoDayDu((await nguoiKyHo()).quyen, dSale2.id)).not.toBeNull();
  });

  it("[NHH-SO-DB-21] 'Vì sao': Sale KHÔNG thấy tổng tỉ lệ các vai và KHÔNG đọc nhật ký thao tác; QLCS thấy cả hai (NHH-SEC-09)", async () => {
    const dSale1 = (await dongSoCuaKhoan(thu1)).find((d) => d.roleCode === "SALE")!;
    // Một thao tác THẬT của người khác trên ô tính: audit mang tên người + lý do (và `newValues` có tổng tiền các vai — thứ Sale không được đọc).
    await db.auditLog.create({
      data: {
        actorId: k1.ketToanA.id,
        actorName: "Trần Kế Toán",
        module: "hoa-hong",
        entityType: "CommissionCalcSlot",
        entityId: dSale1.calcSlotId!,
        action: "APPLY",
        reason: "Khách đổi nguồn",
        newValues: { tongTienCacVai: 700_000 },
        changedFields: [],
      },
    });
    const sale = await docViSaoDayDu(await actorCua(k1.sale.id), dSale1.id);
    const ql = await docViSaoDayDu(await qlcsCua(k1), dSale1.id);
    const tran = (v: typeof sale) => v!.muc.find((m) => m.nhan === "Kiểm trần")!.giaTri;
    expect(tran(sale)).toMatch(/^Trong trần/);
    expect(tran(ql)).toMatch(/^Tổng tỉ lệ/);
    // nhật ký: Sale chỉ có dòng thời gian suy từ dòng sổ (không tên người khác, không lý do, không thao tác của người khác)
    expect(sale!.thoiGian.map((t) => t.nhan)).toEqual(["Ghi vào sổ"]);
    expect(JSON.stringify(sale)).not.toContain("Trần Kế Toán");
    expect(JSON.stringify(sale)).not.toContain("700000");
    // đối chứng DƯƠNG: QLCS đọc nhật ký ô tính — thấy thao tác kèm người làm + lý do; và KHÔNG thấy `newValues` (tiền các vai)
    expect(ql!.thoiGian.map((t) => t.nhan)).toEqual(["Ghi vào sổ", "Áp dụng thay đổi"]);
    expect(ql!.thoiGian[1]).toMatchObject({ nguoi: "Trần Kế Toán", lyDo: "Khách đổi nguồn" });
    expect(JSON.stringify(ql)).not.toContain("700000");
  });

  it("[NHH-SO-DB-22] 'Vì sao': hoàn tiền ⇒ điều chỉnh liên quan Original ↔ Reversal, kỳ hiệu lực/ghi sổ; Sale chỉ thấy dòng điều chỉnh của MÌNH", async () => {
    const k = await kb("soui22", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "CENTER_MANAGER", rate: 0.02 }] });
    await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    const bc = await boiCanh(k, NOW);
    const t = await tienVe(k, await dungBe(k, "a", { tongTien: 10_000_000 }), { soTien: 10_000_000, ngay: D("2026-10-12") });
    await quetKhoan(db, bc, t);
    const hoan = await hoanTien(k, t, { soTien: 4_000_000, ngay: D("2026-11-20") });
    await quetKhoan(db, bc, hoan);
    const dao = (await dongSoCuaKhoan(hoan)).find((d) => d.roleCode === "SALE")!;
    expect(dao.entryKind).toBe("REVERSAL");
    const sale = await actorCua(k.sale.id);
    const v = await docViSaoDayDu(sale, dao.id);
    expect(v).not.toBeNull();
    expect(v!.dieuChinh.map((d) => [d.laDongGoc, d.muiTen, d.soTien])).toEqual([
      [true, false, 400_000],
      [false, true, -160_000],
    ]);
    expect(v!.dieuChinh.find((d) => d.laDongNay)!.soTien).toBe(-160_000);
    expect(v!.dieuChinh[1]!.lyDo).toMatch(/hoàn/);
    // Chuỗi gốc ↔ điều chỉnh là THEO TỪNG NGƯỜI HƯỞNG (mỗi vai một dòng gốc riêng): dòng thu hồi của QLCS KHÔNG nằm trong chuỗi của Sale.
    const ho = await docViSaoDayDu((await nguoiKyHo()).quyen, dao.id);
    expect(ho!.dieuChinh.map((d) => d.soTien)).toEqual([400_000, -160_000]);
    expect(JSON.stringify(v)).not.toContain("-80000");
  });

  // ── "Hoa hồng dự kiến của bạn" ────────────────────────────────────────────────────────────────────────
  it("[NHH-SO-DB-30] dự kiến: engine TẮT ⇒ khối ẨN (không số); engine BẬT ⇒ có phần của CHÍNH MÌNH, không phần của vai khác; người không liên quan ⇒ ẨN", async () => {
    const k = await kb("soui30", { rules: [{ vai: "SALE", rate: 0.04 }, { vai: "CENTER_MANAGER", rate: 0.02 }] });
    await ganVai(k.sale.id, k.ouId, "CENTER_SALES_CSM");
    const sale = await actorCua(k.sale.id);
    const be = await dungBe(k, "a", { tongTien: 10_000_000 });
    const dat = async (bat: boolean) => {
      await db.systemSetting.upsert({ where: { key: KEY_BAT }, create: { key: KEY_BAT, valueJson: bat, updatedByName: "fx-so-ui" }, update: { valueJson: bat, updatedByName: "fx-so-ui" } });
      clearSettingsCache();
    };
    await dat(false);
    expect(await docDuKienChoMan(sale, { orderId: be.orderId }, NOW)).toEqual({ loai: "AN" });
    // `docDuKienChoMan` nạp MỌI chính sách đang hiệu lực: các kịch bản trước cùng GLOBAL ⇒ chồng lấn. Huỷ chúng để ca này chỉ đo chính sách của nó.
    await huyChinhSach(cuaToi.filter((x) => x !== k).flatMap((x) => [x.chinhSach.policyCode, ...x.chinhSachThem]));
    await dat(true);
    const v = await docDuKienChoMan(sale, { orderId: be.orderId }, NOW);
    expect(v.loai).toBe("HIEN");
    if (v.loai !== "HIEN") return;
    expect(v.duKien?.dong).toEqual([{ vai: expect.any(String), soTien: 400_000 }]); // chỉ SALE — không có 200.000đ của Quản lý cơ sở
    expect(v.duKien?.tong).toBe(400_000);
    expect(JSON.stringify(v)).not.toContain("200000");
    // người không liên quan (kế toán): không có phần nào ⇒ ẨN
    await ganVai(k.ketToanA.id, k.ouId, "CENTER_SALES_CSM");
    expect(await docDuKienChoMan(await actorCua(k.ketToanA.id), { orderId: be.orderId }, NOW)).toEqual({ loai: "AN" });
    await dat(false);
    await huyChinhSach([k.chinhSach.policyCode]);
  });
});
