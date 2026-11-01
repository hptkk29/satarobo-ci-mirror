// lib/nguon/gan-dong-don-theo-khoan.test.ts — [GDK-*] lõi THUẦN của «gắn dòng đơn ↔ ghi danh theo khoản thu đã gắn». Không DB, không đồng hồ.
import { describe, expect, it } from "vitest";
import {
  PHAM_VI_GAN_DONG_THEO_KHOAN,
  dongDauRaGanDong,
  dungBanGhiLuotGanDong,
  khopTenKhoa,
  lapKeHoachGanDong,
  quyetDinhGhiGanDong,
  type DuLieuMotMuc,
  type MucPhamVi,
} from "./gan-dong-don-theo-khoan";

const PV: readonly MucPhamVi[] = [
  { code: "ORD-T-1", orderItemId: "oi-1", studentId: "hv-1", enrollmentId: "gd-1", tongDon: 4_000_000 },
  { code: "ORD-T-2", orderItemId: "oi-2", studentId: "hv-1", enrollmentId: "gd-1", tongDon: 3_920_000 },
];

/** Dữ liệu «hình dạng thật»: đơn nhập tay, Payment ĐÃ gắn dòng đơn + ghi danh, KHÔNG phân bổ ngân hàng, dòng đơn chưa gắn. */
function mot(pv: MucPhamVi, o: Partial<DuLieuMotMuc> & { dong?: { studentId: string | null; enrollmentId: string | null } } = {}): DuLieuMotMuc {
  return {
    don: {
      id: `id-${pv.code}`, code: pv.code, type: "COURSE", status: "CONFIRMED", deletedAt: null, studentId: pv.studentId, centerId: "cs1", totalAmount: pv.tongDon,
      items: [{ id: pv.orderItemId, type: "COURSE_ENROLLMENT", studentId: o.dong?.studentId ?? null, enrollmentId: o.dong?.enrollmentId ?? null, itemName: "Sata 3" }],
    },
    khoan: [{ id: `k-${pv.code}`, orderItemId: pv.orderItemId, enrollmentId: pv.enrollmentId, amount: pv.tongDon }],
    hocVien: { id: pv.studentId, deletedAt: null, centerId: "cs1" },
    ghiDanh: { id: pv.enrollmentId, studentId: pv.studentId, status: "ACTIVE", centerId: "cs1", deletedAt: null, tenKhoa: "Sata3 — Ươm Mầm Tài Năng" },
    soGhiDanhSong: 1,
    dongTroVaoGhiDanh: [],
    ...o,
  };
}
const tatCa = (sua: (pv: MucPhamVi, d: DuLieuMotMuc) => DuLieuMotMuc = (_pv, d) => d) => PV.map((pv) => sua(pv, mot(pv)));
const ke = (du: readonly DuLieuMotMuc[]) => lapKeHoachGanDong({ phamVi: PV, du });
const maLoi = (du: readonly DuLieuMotMuc[]) => ke(du).loi.map((l) => l.ma);

describe("[GDK] lập kế hoạch", () => {
  it("[GDK-01] hình dạng thật, chưa gắn ⇒ sẵn sàng ghi ĐÚNG 2 dòng, đúng id ghim, không lỗi", () => {
    const k = ke(tatCa());
    expect(k.dung).toBe(false);
    expect(k.loi).toEqual([]);
    expect(k.ghi.map((g) => [g.code, g.orderItemId, g.studentId, g.enrollmentId])).toEqual([
      ["ORD-T-1", "oi-1", "hv-1", "gd-1"],
      ["ORD-T-2", "oi-2", "hv-1", "gd-1"],
    ]);
    expect(k.daGanHet).toBe(false);
    expect(k.dongDauRa).toEqual(["gan-dong-don-theo-khoan/v1|id-ORD-T-1|ORD-T-1|oi-1|hv-1|gd-1", "gan-dong-don-theo-khoan/v1|id-ORD-T-2|ORD-T-2|oi-2|hv-1|gd-1"]);
    expect(k.sha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("[GDK-02] IDEMPOTENT: cả hai dòng đã gắn ĐÚNG ⇒ 0 dòng ghi, daGanHet", () => {
    const k = ke(tatCa((pv, d) => mot(pv, { dong: { studentId: pv.studentId, enrollmentId: pv.enrollmentId }, khoan: d.khoan })));
    expect(k.dung).toBe(false);
    expect(k.ghi).toEqual([]);
    expect(k.daGanHet).toBe(true);
    expect(k.dongDauRa).toEqual([]);
  });

  it("[GDK-03] lô LAI (một dòng đã gắn, một chưa) ⇒ DỪNG, không ghi gì", () => {
    const du = [mot(PV[0]!, { dong: { studentId: "hv-1", enrollmentId: "gd-1" } }), mot(PV[1]!)];
    const k = ke(du);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.loi.map((l) => l.ma)).toContain("LO_HON_HOP");
  });

  it("[GDK-04] dòng đơn đang trỏ SAI (khác id ghim) hoặc chỉ gắn một nửa ⇒ DỪNG, không sửa", () => {
    for (const dong of [{ studentId: "hv-khac", enrollmentId: "gd-1" }, { studentId: "hv-1", enrollmentId: null }, { studentId: null, enrollmentId: "gd-1" }]) {
      const k = ke([mot(PV[0]!, { dong }), mot(PV[1]!)]);
      expect(k.dung, JSON.stringify(dong)).toBe(true);
      expect(k.ghi).toEqual([]);
      expect(k.loi.map((l) => l.ma)).toContain("TRANG_THAI_DONG_LECH");
    }
  });
});

describe("[GDK] từng cổng fail-closed — mỗi ca đổi ĐÚNG một thứ và đòi ĐÚNG mã lỗi đó", () => {
  const ca: [string, string, (pv: MucPhamVi, d: DuLieuMotMuc) => DuLieuMotMuc][] = [
    ["GDK-10", "DON_DA_XOA", (_p, d) => ({ ...d, don: { ...d.don, deletedAt: new Date("2026-01-01T00:00:00Z") } })],
    ["GDK-11", "DON_KHONG_PHAI_KHOA_HOC", (_p, d) => ({ ...d, don: { ...d.don, type: "PRODUCT" } })],
    ["GDK-12", "TRANG_THAI_DON_LECH", (_p, d) => ({ ...d, don: { ...d.don, status: "CANCELLED" } })],
    ["GDK-13", "TONG_DON_LECH", (_p, d) => ({ ...d, don: { ...d.don, totalAmount: d.don.totalAmount + 1 } })],
    ["GDK-14", "HOC_VIEN_DON_LECH", (_p, d) => ({ ...d, don: { ...d.don, studentId: null } })],
    ["GDK-15", "SO_DONG_KHONG_DUNG", (_p, d) => ({ ...d, don: { ...d.don, items: [...d.don.items, { id: "oi-x", type: "COURSE_ENROLLMENT", studentId: null, enrollmentId: null, itemName: "Sata 3" }] } })],
    ["GDK-16", "DONG_KHAC_ID_GHIM", (_p, d) => ({ ...d, don: { ...d.don, items: [{ ...d.don.items[0]!, id: "oi-la" }] } })],
    ["GDK-17", "HOC_VIEN_KHONG_HOP_LE", (_p, d) => ({ ...d, hocVien: null })],
    ["GDK-18", "GHI_DANH_KHONG_HOP_LE", (_p, d) => ({ ...d, ghiDanh: null })],
    ["GDK-19", "GHI_DANH_KHONG_ACTIVE", (_p, d) => ({ ...d, ghiDanh: { ...d.ghiDanh!, status: "WITHDREW" } })],
    ["GDK-20", "GHI_DANH_LECH_HOC_VIEN", (_p, d) => ({ ...d, ghiDanh: { ...d.ghiDanh!, studentId: "hv-khac" } })],
    ["GDK-21", "GHI_DANH_LECH_CO_SO", (_p, d) => ({ ...d, ghiDanh: { ...d.ghiDanh!, centerId: "cs2" } })],
    ["GDK-22", "NHIEU_GHI_DANH", (_p, d) => ({ ...d, soGhiDanhSong: 2 })],
    ["GDK-23", "TEN_KHOA_LECH", (_p, d) => ({ ...d, ghiDanh: { ...d.ghiDanh!, tenKhoa: "Sata 4" } })],
    ["GDK-24", "KHONG_CO_PAYMENT", (_p, d) => ({ ...d, khoan: [] })],
    ["GDK-25", "PAYMENT_KHONG_GAN_DONG", (_p, d) => ({ ...d, khoan: [{ ...d.khoan[0]!, orderItemId: null }] })],
    ["GDK-26", "PAYMENT_KHONG_GAN_GHI_DANH", (_p, d) => ({ ...d, khoan: [{ ...d.khoan[0]!, enrollmentId: "gd-khac" }] })],
    ["GDK-27", "TIEN_PAYMENT_LECH", (_p, d) => ({ ...d, khoan: [{ ...d.khoan[0]!, amount: d.khoan[0]!.amount - 1 }] })],
    ["GDK-28", "DONG_TRO_NGOAI_PHAM_VI", (_p, d) => ({ ...d, dongTroVaoGhiDanh: [{ orderItemId: "oi-ngoai", orderId: "don-ngoai" }] })],
  ];
  it.each(ca)("[%s] %s ⇒ DỪNG cả lô, không dòng ghi", (_id, ma, sua) => {
    // Đổi MỘT mục (mục đầu); mục kia sạch ⇒ cả lô vẫn dừng.
    const du = [sua(PV[0]!, mot(PV[0]!)), mot(PV[1]!)];
    const k = ke(du);
    expect(k.dung).toBe(true);
    expect(k.ghi).toEqual([]);
    expect(k.dongDauRa).toEqual([]);
    expect(k.loi.map((l) => l.ma)).toContain(ma);
  });

  it("[GDK-29] hai dòng TRONG phạm vi cùng trỏ một ghi danh là CÓ CHỦ ĐÍCH: không bị coi là «ngoài phạm vi»", () => {
    const du = PV.map((pv) => mot(pv, { dongTroVaoGhiDanh: PV.map((p) => ({ orderItemId: p.orderItemId, orderId: `id-${p.code}` })) }));
    expect(maLoi(du)).toEqual([]);
  });

  it("[GDK-30] thiếu một đơn / đơn thừa ngoài phạm vi ⇒ DỪNG", () => {
    expect(maLoi([mot(PV[0]!)])).toContain("THIEU_DON");
    const thua = mot({ code: "ORD-LA", orderItemId: "oi-9", studentId: "hv-1", enrollmentId: "gd-1", tongDon: 1 });
    expect(maLoi([...tatCa(), thua])).toContain("DON_NGOAI_PHAM_VI");
  });

  it("[GDK-31] lỗi được báo HẾT một lượt (không dừng ở lỗi đầu): đổi hai thứ ⇒ thấy cả hai mã", () => {
    const du = [{ ...mot(PV[0]!), soGhiDanhSong: 2, khoan: [] }, mot(PV[1]!)];
    expect(maLoi(du)).toEqual(expect.arrayContaining(["NHIEU_GHI_DANH", "KHONG_CO_PAYMENT"]));
  });
});

describe("[GDK] cổng số duyệt + bản ghi lượt chạy", () => {
  const kh = ke(tatCa());
  it("[GDK-40] --expect: thiếu / NaN / lệch / thiếu quyền ghi / kế hoạch dừng ⇒ có câu từ chối; đúng ⇒ null", () => {
    expect(quyetDinhGhiGanDong({ soDuyet: null, keHoach: kh, ghiDuoc: true })).toMatch(/--expect/);
    expect(quyetDinhGhiGanDong({ soDuyet: Number.NaN, keHoach: kh, ghiDuoc: true })).toMatch(/số nguyên/);
    expect(quyetDinhGhiGanDong({ soDuyet: 1, keHoach: kh, ghiDuoc: true })).toMatch(/≠ kế hoạch/);
    expect(quyetDinhGhiGanDong({ soDuyet: 2, keHoach: kh, ghiDuoc: false })).toMatch(/không có quyền UPDATE/);
    expect(quyetDinhGhiGanDong({ soDuyet: 2, keHoach: kh, ghiDuoc: null })).toMatch(/Không kiểm được/);
    expect(quyetDinhGhiGanDong({ soDuyet: 2, keHoach: ke([mot(PV[0]!)]), ghiDuoc: true })).toMatch(/DỪNG/);
    expect(quyetDinhGhiGanDong({ soDuyet: 2, keHoach: kh, ghiDuoc: true })).toBeNull();
  });

  it("[GDK-41] bản ghi lượt chạy: số duyệt · số thực ghi · khớp; batDauLuc hỏng ⇒ ném (lõi không đọc đồng hồ)", () => {
    const luot = { batDauLuc: new Date("2026-11-02T03:00:00.000Z"), nguonChay: { actor: "a", triggeringActor: "b", runId: "9", runAttempt: "1" } };
    const b = dungBanGhiLuotGanDong({ luot, soDuyet: 2, keHoach: kh, daGhi: 2 });
    expect(b).toMatchObject({ expectedCount: 2, actualCount: 2, khop: true, soKeHoach: 2, donDaGan: ["ORD-T-1", "ORD-T-2"] });
    expect(() => dungBanGhiLuotGanDong({ luot: { ...luot, batDauLuc: new Date("x") }, soDuyet: 2, keHoach: kh, daGhi: 2 })).toThrow(/batDauLuc/);
  });
});

describe("[GDK] phạm vi cứng của PROD", () => {
  it("[GDK-51] khớp tên khoá theo TIỀN TỐ có biên chữ số: «Sata 3» khớp «Sata3 — Ươm Mầm Tài Năng»; không khớp «Sata 30», «Sata 4», tên quá ngắn", () => {
    expect(khopTenKhoa("Sata 3", "Sata3 — Ươm Mầm Tài Năng")).toBe(true);
    expect(khopTenKhoa("sata3", "SATA 3")).toBe(true);
    expect(khopTenKhoa("Sata 3", "Sata 30 — Nâng cao")).toBe(false);
    expect(khopTenKhoa("Sata 3", "Sata 4")).toBe(false);
    expect(khopTenKhoa("S3", "S3 Plus")).toBe(false);
    expect(khopTenKhoa("", "Sata 3")).toBe(false);
  });

  it("[GDK-50] đúng 2 mục, cùng một học viên + một ghi danh, tổng 7.920.000; id là cuid (không tên/SĐT)", () => {
    expect(PHAM_VI_GAN_DONG_THEO_KHOAN).toHaveLength(2);
    expect(new Set(PHAM_VI_GAN_DONG_THEO_KHOAN.map((p) => p.studentId)).size).toBe(1);
    expect(new Set(PHAM_VI_GAN_DONG_THEO_KHOAN.map((p) => p.enrollmentId)).size).toBe(1);
    expect(PHAM_VI_GAN_DONG_THEO_KHOAN.reduce((s, p) => s + p.tongDon, 0)).toBe(7_920_000);
    for (const p of PHAM_VI_GAN_DONG_THEO_KHOAN) {
      expect(p.code).toMatch(/^ORD-\d{6}-\d{6}$/);
      for (const id of [p.orderItemId, p.studentId, p.enrollmentId]) expect(id).toMatch(/^c[a-z0-9]{8,}$/);
    }
    expect(dongDauRaGanDong([])).toEqual([]);
  });
});
