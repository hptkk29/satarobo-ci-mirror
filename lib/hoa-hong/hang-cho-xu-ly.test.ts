// @vitest-environment node
/**
 * [HCX-*] — LUẬT THUẦN của «Hàng chờ cần xử lý» (R9 · T1): tiền bị ảnh hưởng · một hay hai người · ai làm được gì · tách nhiệm · hạn đề nghị.
 * Ca chạm DB (xem trước · đề nghị · duyệt · idempotent · sổ bất biến · audit) ở `tests/hoa-hong/hang-cho-xu-ly.spec.ts` (`[T1-*]`).
 *
 * Mọi ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, expect, it } from "vitest";

import {
  BANG_CHUNG_TOI_THIEU,
  CO_SO_NGUONG_HANG_CHO,
  HAN_DE_NGHI_MS,
  chuCapDuyet,
  chuVoHieu,
  deNghiConHieuLuc,
  deNghiDaDungCuaDongDong,
  docDeNghi,
  docXemTay,
  ganDauVoHieu,
  ghepLyDoKiemToan,
  huongXuLy,
  kiemLyDoVaBangChung,
  loiNguoiDuyet,
  quyetCapDuyet,
  tienChoCapTu,
  tienKhopDeNghi,
  tienTiepXuc,
  trangThaiXuLy,
  type DeNghiDaGhi,
} from "./hang-cho-xu-ly";

const T0 = new Date("2026-11-10T03:00:00Z");
const deNghi = (p: Partial<DeNghiDaGhi> = {}): DeNghiDaGhi => ({
  id: "au1",
  nguoiId: "u1",
  tenNguoi: "Người một",
  luc: T0,
  quyetDinh: "AP_DUNG",
  tien: 12_000_000,
  holdKey: "INPUT_DRIFT:slot:hash1",
  lyDo: "Đã đối chiếu với kế toán",
  bangChung: "PT-2026-1234",
  mocMoLai: null,
  vo: null,
  ...p,
});

describe("[HCX-01] tienTiepXuc — đo từ `detail` do engine ghi, null khi KHÔNG đo được", () => {
  it("INPUT_DRIFT: Σ|chênh| từng người (cả dương lẫn âm)", () => {
    expect(tienTiepXuc({ code: "INPUT_DRIFT", detail: { chenh: [{ key: "SALE|USER|a", chenh: -300_000 }, { key: "SALE|USER|b", chenh: 300_000 }] } })).toBe(600_000);
  });
  it("INPUT_DRIFT biến thể lỗi cấu hình (không có `chenh`) ⇒ null, không phải 0", () => {
    expect(tienTiepXuc({ code: "INPUT_DRIFT", detail: { loi: "VUOT_TRAN", rongTheoNguoi: { x: 5 } } })).toBeNull();
  });
  it("INPUT_DRIFT có phần tử hỏng hình ⇒ null (không bỏ qua phần tử rồi báo số nhỏ)", () => {
    expect(tienTiepXuc({ code: "INPUT_DRIFT", detail: { chenh: [{ chenh: 100 }, { chenh: "1" }] } })).toBeNull();
    expect(tienTiepXuc({ code: "INPUT_DRIFT", detail: { chenh: [{ chenh: 100 }, null] } })).toBeNull();
  });
  it("PAYMENT_WITHDRAWN khoản THU: Σ|ròng| theo người", () => {
    expect(tienTiepXuc({ code: "PAYMENT_WITHDRAWN", detail: { rongTheoNguoi: { "SALE|USER|a": 300_000, "ACQ|USER|b": -50_000 } } })).toBe(350_000);
  });
  it("PAYMENT_WITHDRAWN khoản HOÀN: Σ|tiền| các dòng đảo", () => {
    expect(tienTiepXuc({ code: "PAYMENT_WITHDRAWN", detail: { loaiKhoan: "HOAN", dongDao: [{ tien: -80_000 }, { tien: -40_000 }] } })).toBe(120_000);
  });
  it("detail không phải object / mã khác ⇒ null", () => {
    expect(tienTiepXuc({ code: "INPUT_DRIFT", detail: null })).toBeNull();
    expect(tienTiepXuc({ code: "INPUT_DRIFT", detail: [] })).toBeNull();
    expect(tienTiepXuc({ code: "CAP_EXCEEDED", detail: { chenh: [{ chenh: 1 }] } })).toBeNull();
  });
  it("chênh = 0 hết ⇒ 0 (đo được và bằng 0), khác null", () => {
    expect(tienTiepXuc({ code: "INPUT_DRIFT", detail: { chenh: [] } })).toBe(0);
  });
});

describe("[HCX-02] quyetCapDuyet — dưới ngưỡng một người; từ ngưỡng / không đo được / ngưỡng hỏng ⇒ hai người (fail-closed)", () => {
  it("dưới ngưỡng ⇒ MOT_CAP", () => {
    expect(quyetCapDuyet({ tien: 9_999_999, nguong: 10_000_000 })).toEqual({ cap: "MOT_CAP", lyDo: "DUOI_NGUONG" });
  });
  it("ĐÚNG ngưỡng ⇒ HAI_CAP (đạt hoặc vượt, cùng luật `quyetQuanTri`)", () => {
    expect(quyetCapDuyet({ tien: 10_000_000, nguong: 10_000_000 })).toEqual({ cap: "HAI_CAP", lyDo: "TU_NGUONG" });
    expect(quyetCapDuyet({ tien: 50_000_000, nguong: 10_000_000 }).cap).toBe("HAI_CAP");
  });
  it("tiền không đo được ⇒ HAI_CAP", () => {
    expect(quyetCapDuyet({ tien: null, nguong: 10_000_000 })).toEqual({ cap: "HAI_CAP", lyDo: "KHONG_DO_DUOC_TIEN" });
    expect(quyetCapDuyet({ tien: Number.NaN, nguong: 10_000_000 }).cap).toBe("HAI_CAP");
  });
  it("ngưỡng hỏng/thiếu ⇒ HAI_CAP kể cả tiền bằng 0", () => {
    expect(quyetCapDuyet({ tien: 0, nguong: null })).toEqual({ cap: "HAI_CAP", lyDo: "NGUONG_KHONG_DOC_DUOC" });
    expect(quyetCapDuyet({ tien: 0, nguong: -1 }).cap).toBe("HAI_CAP");
  });
  it("tiền 0 và ngưỡng hợp lệ ⇒ MOT_CAP (đối chứng dương: không ép hai người vô cớ)", () => {
    expect(quyetCapDuyet({ tien: 0, nguong: 10_000_000 }).cap).toBe("MOT_CAP");
  });
});

describe("[HCX-03] huongXuLy — cổng TĨNH: mã · trạng thái · đề xuất", () => {
  it("INPUT_DRIFT thường, OPEN ⇒ cả ba hành động làm được", () => {
    const h = huongXuLy({ code: "INPUT_DRIFT", status: "OPEN", detail: { chenh: [] } });
    expect([h.giaiPhong.duoc, h.tuChoi.duoc, h.chuyenXemTay.duoc, h.deXuatId]).toEqual([true, true, true, null]);
  });
  it("PAYMENT_WITHDRAWN, OPEN ⇒ cả ba hành động làm được", () => {
    const h = huongXuLy({ code: "PAYMENT_WITHDRAWN", status: "OPEN", detail: {} });
    expect([h.giaiPhong.duoc, h.tuChoi.duoc, h.chuyenXemTay.duoc]).toEqual([true, true, true]);
  });
  it("hàng chờ của ĐỀ XUẤT đang mở (`proposalId`) ⇒ KHÔNG hành động nào + trả `deXuatId` để dẫn đi", () => {
    const h = huongXuLy({ code: "INPUT_DRIFT", status: "OPEN", detail: { proposalId: "dx1" } });
    expect(h.giaiPhong.duoc).toBe(false);
    expect(h.tuChoi.duoc).toBe(false);
    expect(h.chuyenXemTay.duoc).toBe(false);
    expect(h.deXuatId).toBe("dx1");
    if (!h.giaiPhong.duoc) expect(h.giaiPhong.lyDo).toMatch(/đề xuất/);
  });
  it("đã đóng (RESOLVED / DISMISSED) ⇒ không hành động nào", () => {
    for (const status of ["RESOLVED", "DISMISSED"]) {
      const h = huongXuLy({ code: "INPUT_DRIFT", status, detail: {} });
      expect([h.giaiPhong.duoc, h.tuChoi.duoc, h.chuyenXemTay.duoc]).toEqual([false, false, false]);
    }
  });
  it("mã KHÔNG nằm trong tập giải được ⇒ không hành động nào (đối chứng: chỉ hai mã được mở)", () => {
    for (const code of ["CAP_EXCEEDED", "MANUAL_REVIEW_REQUIRED", "UNRESOLVED_BENEFICIARY", "NEGATIVE_BALANCE", "NO_ORG_UNIT"] as const) {
      const h = huongXuLy({ code, status: "OPEN", detail: {} });
      expect(h.giaiPhong.duoc, code).toBe(false);
    }
  });
});

describe("[HCX-04] lý do · bằng chứng", () => {
  it("thiếu lý do hoặc bằng chứng ⇒ từ chối, nói đúng cái nào", () => {
    expect(kiemLyDoVaBangChung({ lyDo: "ngắn", bangChung: "x".repeat(BANG_CHUNG_TOI_THIEU) })).toMatchObject({ ok: false, loi: expect.stringContaining("Lý do") });
    expect(kiemLyDoVaBangChung({ lyDo: "đủ dài rồi nhé", bangChung: "ngắn" })).toMatchObject({ ok: false, loi: expect.stringContaining("Bằng chứng") });
  });
  it("khoảng trắng không được tính là ký tự", () => {
    expect(kiemLyDoVaBangChung({ lyDo: "          ", bangChung: "          " }).ok).toBe(false);
  });
  it("đủ ⇒ ok và đã trim", () => {
    expect(kiemLyDoVaBangChung({ lyDo: "  đã đối chiếu kế toán  ", bangChung: "  PT-2026-1234  " })).toEqual({ ok: true, lyDo: "đã đối chiếu kế toán", bangChung: "PT-2026-1234" });
  });
  it("lý do kiểm toán gộp cả bằng chứng và đề nghị cấp 1", () => {
    expect(ghepLyDoKiemToan({ lyDo: "duyệt", bangChung: "PT-1" })).toBe("duyệt · Bằng chứng: PT-1");
    expect(ghepLyDoKiemToan({ lyDo: "duyệt", bangChung: "PT-1", deNghi: { ten: "An", lyDo: "đề nghị", bangChung: "PT-0" } })).toBe("duyệt · Bằng chứng: PT-1 · Cấp 1 (An): đề nghị · Bằng chứng cấp 1: PT-0");
  });
});

describe("[HCX-05] đề nghị cấp 1 — đọc lại từ kiểm toán, hiệu lực, tách nhiệm", () => {
  const raw = (nv: unknown) => ({ id: "au1", actorId: "u1", actorName: "Người một", createdAt: T0, newValues: nv, reason: null });
  it("đọc đúng dạng; hỏng hình ⇒ null (không đoán)", () => {
    const ok = docDeNghi(raw({ quyetDinh: "AP_DUNG", tien: 5, holdKey: "k", lyDo: "l", bangChung: "b" }));
    expect(ok).toMatchObject({ nguoiId: "u1", quyetDinh: "AP_DUNG", tien: 5, holdKey: "k" });
    expect(docDeNghi(raw({ quyetDinh: "KHAC", tien: 5, holdKey: "k", lyDo: "l", bangChung: "b" }))).toBeNull();
    expect(docDeNghi(raw({ quyetDinh: "AP_DUNG", tien: -1, holdKey: "k", lyDo: "l", bangChung: "b" }))).toBeNull();
    expect(docDeNghi(raw({ quyetDinh: "AP_DUNG", tien: 5, holdKey: 3, lyDo: "l", bangChung: "b" }))).toBeNull();
    expect(docDeNghi(raw(null))).toBeNull();
  });
  it("hiệu lực: đúng khoá hàng chờ ∧ chưa quá hạn; KHÔNG có cận dưới (máy ứng dụng chậm hơn đồng hồ DB vài giây không được làm đề nghị vừa lập thành vô hiệu)", () => {
    const d = deNghi();
    expect(deNghiConHieuLuc(d, { holdKey: d.holdKey, now: new Date(T0.getTime() + HAN_DE_NGHI_MS) })).toBe(true); // đúng hạn chót
    expect(deNghiConHieuLuc(d, { holdKey: d.holdKey, now: new Date(T0.getTime() + HAN_DE_NGHI_MS + 1) })).toBe(false);
    expect(deNghiConHieuLuc(d, { holdKey: "INPUT_DRIFT:slot:hashKhac", now: T0 })).toBe(false); // đầu vào đổi ⇒ khoá khác
    expect(deNghiConHieuLuc(d, { holdKey: d.holdKey, now: new Date(T0.getTime() - 5_000) })).toBe(true); // lệch đồng hồ 5 giây
  });
  it("tách nhiệm: cùng người ⇒ từ chối; người khác ⇒ cho; không rõ người ⇒ từ chối (fail-closed)", () => {
    expect(loiNguoiDuyet(deNghi({ nguoiId: "u1" }), "u1")).toMatch(/KHÁC/);
    expect(loiNguoiDuyet(deNghi({ nguoiId: "u1" }), "u2")).toBeNull();
    expect(loiNguoiDuyet(deNghi({ nguoiId: "u1" }), null)).not.toBeNull();
    expect(loiNguoiDuyet(deNghi({ nguoiId: null }), "u2")).not.toBeNull();
  });
});

describe("[HCX-06] trạng thái xử lý hiển thị", () => {
  const xemTay = docXemTay({ id: "x1", actorId: "u3", actorName: "Người ba", createdAt: T0, newValues: { holdKey: "K" }, reason: "cần xem tay" });
  it("đề nghị còn hiệu lực thắng 'xem tay'", () => {
    expect(trangThaiXuLy({ deNghi: deNghi({ holdKey: "K" }), xemTay, holdKey: "K", now: T0 })).toBe("CHO_DUYET_CAP_HAI");
  });
  it("đề nghị hết hạn / sai khoá ⇒ rơi về 'xem tay' hoặc 'chưa xử lý'", () => {
    expect(trangThaiXuLy({ deNghi: deNghi({ holdKey: "K" }), xemTay, holdKey: "K", now: new Date(T0.getTime() + HAN_DE_NGHI_MS + 1) })).toBe("DA_CHUYEN_XEM_TAY");
    expect(trangThaiXuLy({ deNghi: deNghi({ holdKey: "K" }), xemTay: null, holdKey: "K2", now: T0 })).toBe("CHUA_XU_LY");
  });
  it("dấu 'xem tay' của khoá cũ không còn đúng với hàng chờ có khoá mới", () => {
    expect(trangThaiXuLy({ deNghi: null, xemTay, holdKey: "K-moi", now: T0 })).toBe("CHUA_XU_LY");
    expect(trangThaiXuLy({ deNghi: null, xemTay, holdKey: "K", now: T0 })).toBe("DA_CHUYEN_XEM_TAY");
  });
});

describe("[HCX-07] ảnh chụp đề nghị — đã dùng · mở lại · tiền khớp (thuần)", () => {
  const sach = { daDung: new Set<string>(), moLaiCuoiId: null as string | null };
  const dn = (p: Partial<DeNghiDaGhi> = {}) => deNghi(p);

  it("đối chứng: đề nghị chưa dùng, chưa mở lại ⇒ không bị vô hiệu và còn hiệu lực", () => {
    const d = ganDauVoHieu(dn(), sach);
    expect(d.vo).toBeNull();
    expect(deNghiConHieuLuc(d, { holdKey: "INPUT_DRIFT:slot:hash1", now: T0 })).toBe(true);
  });
  it("ĐÃ DÙNG (id nằm trong tập đề nghị đã đóng hàng chờ) ⇒ DA_DUNG, hết hiệu lực dù cùng khoá và còn trong hạn", () => {
    const d = ganDauVoHieu(dn(), { daDung: new Set(["au1"]), moLaiCuoiId: null });
    expect(d.vo).toBe("DA_DUNG");
    expect(deNghiConHieuLuc(d, { holdKey: "INPUT_DRIFT:slot:hash1", now: T0 })).toBe(false);
  });
  it("MỞ LẠI sau đề nghị (mốc lúc lập ≠ dòng REOPEN mới nhất) ⇒ SAU_MO_LAI; đề nghị lập SAU lần mở lại (mốc = REOPEN mới nhất) thì dùng được", () => {
    expect(ganDauVoHieu(dn({ mocMoLai: null }), { daDung: new Set(), moLaiCuoiId: "ro1" }).vo).toBe("SAU_MO_LAI");
    expect(ganDauVoHieu(dn({ mocMoLai: "ro1" }), { daDung: new Set(), moLaiCuoiId: "ro1" }).vo).toBeNull();
    // mở lại LẦN HAI: đề nghị lập sau lần một cũng hết nghĩa
    expect(ganDauVoHieu(dn({ mocMoLai: "ro1" }), { daDung: new Set(), moLaiCuoiId: "ro2" }).vo).toBe("SAU_MO_LAI");
  });
  it("'đã dùng' thắng 'mở lại' khi cả hai (nhãn nói đúng lý do đầu tiên); không ai trong hai làm đề nghị sống lại", () => {
    expect(ganDauVoHieu(dn(), { daDung: new Set(["au1"]), moLaiCuoiId: "ro1" }).vo).toBe("DA_DUNG");
  });
  it("`docDeNghi` đọc `mocMoLai` (chuỗi) và coi thiếu / kiểu lạ là null; `vo` luôn khởi đầu null (do bộ đọc gắn, không lưu)", () => {
    const base = { id: "a", actorId: "u", actorName: "n", createdAt: T0, reason: "r" };
    const nv = { quyetDinh: "AP_DUNG", tien: 5, holdKey: "k", lyDo: "l", bangChung: "b" };
    expect(docDeNghi({ ...base, newValues: { ...nv, mocMoLai: "ro9" } })).toMatchObject({ mocMoLai: "ro9", vo: null });
    expect(docDeNghi({ ...base, newValues: nv })).toMatchObject({ mocMoLai: null, vo: null });
    expect(docDeNghi({ ...base, newValues: { ...nv, mocMoLai: 7 } })).toMatchObject({ mocMoLai: null });
  });
  it("`deNghiDaDungCuaDongDong`: lấy `batKy.deNghi.auditId` của dòng APPLY/DISMISS; đóng một người (không qua đề nghị) ⇒ null; dữ liệu lạ ⇒ null", () => {
    expect(deNghiDaDungCuaDongDong({ batKy: { cap: "HAI_CAP", deNghi: { auditId: "au7" } } })).toBe("au7");
    expect(deNghiDaDungCuaDongDong({ batKy: { cap: "MOT_CAP" } })).toBeNull();
    expect(deNghiDaDungCuaDongDong({ status: "RESOLVED" })).toBeNull();
    expect(deNghiDaDungCuaDongDong(null)).toBeNull();
    expect(deNghiDaDungCuaDongDong({ batKy: { deNghi: { auditId: 5 } } })).toBeNull();
  });
  it("`tienKhopDeNghi`: BẰNG, cả hai chiều (cao hơn lẫn thấp hơn đều không khớp); null (không đo được) so như 0 — cùng quy ước lúc ghi", () => {
    expect(tienKhopDeNghi({ tien: 600_000 }, 600_000)).toBe(true);
    expect(tienKhopDeNghi({ tien: 600_000 }, 600_001)).toBe(false);
    expect(tienKhopDeNghi({ tien: 600_000 }, 599_999)).toBe(false);
    expect(tienKhopDeNghi({ tien: 0 }, null)).toBe(true);
    expect(tienKhopDeNghi({ tien: 5 }, null)).toBe(false);
  });
  it("`tienChoCapTu`: max của hai số đo; thiếu một thì lấy số còn lại; thiếu cả hai ⇒ null", () => {
    expect(tienChoCapTu(300_000, 600_000)).toBe(600_000);
    expect(tienChoCapTu(1_800_000, 600_000)).toBe(1_800_000);
    expect(tienChoCapTu(null, 5)).toBe(5);
    expect(tienChoCapTu(5, null)).toBe(5);
    expect(tienChoCapTu(null, null)).toBeNull();
  });
  it("`chuVoHieu` có câu riêng cho từng lý do (người duyệt thấy ĐÚNG vì sao đề nghị không dùng được)", () => {
    expect(chuVoHieu("DA_DUNG")).toMatch(/đã được dùng/);
    expect(chuVoHieu("SAU_MO_LAI")).toMatch(/mở lại/);
    expect(chuVoHieu(null)).toMatch(/hết hạn/);
  });
});

describe("[HCX-08] ngưỡng = Σ|chênh| của đúng tập điều chỉnh MỘT thao tác resolve sẽ ghi (SUM_ABS_LOGICAL_EVENT)", () => {
  it("tên cơ sở tính ngưỡng được ghim (docs và audit đọc cùng hằng này)", () => {
    expect(CO_SO_NGUONG_HANG_CHO).toBe("SUM_ABS_LOGICAL_EVENT");
  });
  it("`quyetCapDuyet` nhận MỘT con số tiền (Σ của cả tập) — đạt ngưỡng ⇒ hai người dù từng dòng riêng lẻ dưới ngưỡng; dưới ngưỡng ⇒ một người", () => {
    // 4 dòng 300.000 ⇒ Σ 1.200.000: mỗi dòng < 1.000.000 nhưng cả tập ≥ ngưỡng
    const tong = [300_000, 300_000, 300_000, 300_000].reduce((t, x) => t + Math.abs(x), 0);
    expect(quyetCapDuyet({ tien: tong, nguong: 1_000_000 })).toEqual({ cap: "HAI_CAP", lyDo: "TU_NGUONG" });
    expect(quyetCapDuyet({ tien: 300_000, nguong: 1_000_000 })).toEqual({ cap: "MOT_CAP", lyDo: "DUOI_NGUONG" });
    expect(quyetCapDuyet({ tien: 1_000_000, nguong: 1_000_000 })).toEqual({ cap: "HAI_CAP", lyDo: "TU_NGUONG" }); // đúng bằng ngưỡng = đạt
  });
  it("fail-closed không đổi: không đo được tiền hoặc ngưỡng hỏng ⇒ hai người", () => {
    expect(quyetCapDuyet({ tien: null, nguong: 1_000_000 })).toEqual({ cap: "HAI_CAP", lyDo: "KHONG_DO_DUOC_TIEN" });
    expect(quyetCapDuyet({ tien: 5, nguong: null })).toEqual({ cap: "HAI_CAP", lyDo: "NGUONG_KHONG_DOC_DUOC" });
  });
  it("KHÔNG có đường cộng lịch sử / hàng chờ khác: không còn hàm `tienSuKien`, không còn lý do `TU_NGUONG_SU_KIEN` (bản #776 rộng hơn định nghĩa đã bị gỡ)", async () => {
    const m = (await import("./hang-cho-xu-ly")) as Record<string, unknown>;
    expect(m).not.toHaveProperty("tienSuKien");
    expect(chuCapDuyet("TU_NGUONG", (n) => `${n}đ`, 1_000_000)).toContain("1000000đ");
    expect(chuCapDuyet.length).toBe(3); // (lý do, định dạng, ngưỡng) — không có tham số "tiền cả khoản"
  });
});
