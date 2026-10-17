// @vitest-environment node
/**
 * [PLM-P*] / [BLH-*] — LUẬT v5 của bộ phân loại NEW/RENEWAL (THUẦN, không DB, không đồng hồ).
 *
 *   (1) DÒNG THÊM MUỘN VÀO ĐƠN CÓ SẴN (`themConVaoDonAction`) là MỘT LẦN MUA RIÊNG — khác lần mua của chính đơn đó. Khoá K của nó là giờ máy chủ lúc dòng được thêm (bộ nạp đặt),
 *       và cặp (dòng thêm muộn · dòng gốc cùng đơn) KHÔNG còn bị coi là «cùng một quyết định mua» (`cungLanMua`). Lỗi gốc (reviewer vòng 5): dòng thêm muộn thừa kế K của đơn cũ ⇒ lần
 *       mua tái tục bị phân loại NEW 9% thay vì RENEWAL 2%.
 *   (2) BẢO LƯU xét ở CẢ ngày khai (`tau`) LẪN giờ máy chủ (`tauMay`); dính MỘT TRONG HAI ⇒ giữ (fail-closed) — người ghi khai ngày không chọn được «giữ 0đ» hay «trả đủ tỉ lệ».
 *
 * Mỗi ca tự dựng đầu vào (luật 18); ngày TUYỆT ĐỐI (luật 19).
 */
import { describe, it, expect } from "vitest";

import {
  cungLanMua,
  phanLoaiGiaoDich,
  tinhPhuHuynhHienHuu,
  type DauVaoPhanLoai,
  type GhiDanhPhanLoai,
  type KhoanThuLanMua,
  type LanMuaTruoc,
} from "./phan-loai-giao-dich";

const T0 = new Date("2026-03-01T03:00:00.000Z"); // đơn gốc / lần mua đầu
const T1 = new Date("2026-09-01T03:00:00.000Z"); // lúc dòng được THÊM MUỘN
const TTHU = new Date("2026-04-01T03:00:00.000Z");
const MOC = new Date("2026-09-15T03:00:00.000Z");

const khoan = (amount: number, paidDate: Date = TTHU): KhoanThuLanMua => ({ id: `k-${paidDate.getTime()}-${amount}`, paidDate, amount, ghiLuc: paidDate });

function ghiDanh(p: Partial<GhiDanhPhanLoai> = {}): GhiDanhPhanLoai {
  return { id: "e-hien-tai", courseId: "khoa-sata3", centerId: "cs1", renewedFromEnrollmentId: null, chuyenTu: [], chuyenDen: null, baoLuu: [], ...p };
}

/** Lần mua trước ĐÃ THU 5tr, không huỷ. */
function truoc(p: Partial<LanMuaTruoc> = {}): LanMuaTruoc {
  return { orderItemId: "oi-cu", orderId: "o-cu", taoLuc: T0, daHuy: false, trangThaiDon: "CONFIRMED", huyLuc: null, khoanThu: [khoan(5_000_000)], moHo: false, gioTaoChuaKiem: false, themMuon: false, ...p };
}

function dau(p: Partial<DauVaoPhanLoai> = {}): DauVaoPhanLoai {
  const tau = p.tau !== undefined ? p.tau : MOC;
  return {
    dong: { orderItemId: "oi-moi", orderId: "o-moi", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 },
    studentId: "s1",
    ghiDanh: ghiDanh(),
    lanMuaTruoc: [],
    ghiDanhMoCoi: [],
    phuHuynh: { hienHuu: false, can: null },
    coLead: true,
    tau,
    tauMay: tau,
    ...p,
  };
}

describe("[PLM-P1] `cungLanMua` — «cùng đơn = cùng một quyết định mua» chỉ đúng khi KHÔNG bên nào được thêm muộn", () => {
  const x = (orderId: string, themMuon: boolean) => ({ orderId, themMuon });
  it("[PLM-P1] cùng đơn · không bên nào muộn ⇒ cùng lần mua · một bên muộn ⇒ KHÁC lần mua · cả hai muộn ⇒ KHÁC (mỗi lần thêm là một quyết định mua) · khác đơn ⇒ KHÁC", () => {
    expect(cungLanMua(x("o1", false), x("o1", false))).toBe(true);
    expect(cungLanMua(x("o1", true), x("o1", false))).toBe(false);
    expect(cungLanMua(x("o1", false), x("o1", true))).toBe(false);
    expect(cungLanMua(x("o1", true), x("o1", true))).toBe(false);
    expect(cungLanMua(x("o1", false), x("o2", false))).toBe(false);
  });
});

describe("[PLM-P2..P4] học viên có dòng KHÁC trong CÙNG đơn — dòng thêm muộn là lần mua riêng", () => {
  const dongMuon = { orderItemId: "oi-muon", orderId: "o-chung", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: true, taoLuc: T1 } as const;

  it("[PLM-P2] dòng thêm muộn + dòng gốc ĐÃ THU của CÙNG học viên trong CÙNG đơn ⇒ RENEWAL PRIOR_PURCHASE (không còn là «một lần mua»)", () => {
    const r = phanLoaiGiaoDich(dau({ dong: dongMuon, lanMuaTruoc: [truoc({ orderItemId: "oi-goc", orderId: "o-chung", taoLuc: T0 })] }));
    expect(r.loai).toBe("RENEWAL");
    expect(r.maLuat).toBe("PRIOR_PURCHASE");
    expect(r.bangChung.lanMuaTruocIds).toEqual(["oi-goc"]);
  });

  it("[PLM-P3] đối chứng dương: cả hai dòng sinh CÙNG lúc với đơn (không dòng nào muộn) ⇒ vẫn MỘT lần mua ⇒ NEW — hành vi cũ giữ nguyên", () => {
    const dongThuong = { ...dongMuon, themMuon: false, taoLuc: T0 } as const;
    const r = phanLoaiGiaoDich(dau({ dong: dongThuong, lanMuaTruoc: [truoc({ orderItemId: "oi-goc", orderId: "o-chung", taoLuc: T0 })] }));
    expect(r.loai).toBe("NEW");
    expect(r.maLuat).toBe("FIRST_PURCHASE");
  });

  it("[PLM-P4] nhìn từ dòng GỐC: dòng thêm muộn (K sau) KHÔNG là tiền lệ của nó ⇒ dòng gốc vẫn NEW, kể cả khi dòng muộn đã có tiền", () => {
    const dongGoc = { orderItemId: "oi-goc", orderId: "o-chung", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T0 } as const;
    const r = phanLoaiGiaoDich(dau({ dong: dongGoc, lanMuaTruoc: [truoc({ orderItemId: "oi-muon", orderId: "o-chung", taoLuc: T1, themMuon: true })] }));
    expect(r.loai).toBe("NEW");
    expect(r.maLuat).toBe("FIRST_PURCHASE");
  });
});

describe("[PLM-P5] phụ huynh hiện hữu: anh/chị cùng đơn mà dòng đang xét được THÊM MUỘN thì đã có trước", () => {
  const anhChi = (themMuon: boolean) => [
    {
      studentId: "s-anh",
      cungLead: true,
      cungSdt: false,
      lanMua: [truoc({ orderItemId: "oi-anh", orderId: "o-chung", taoLuc: T0, themMuon })],
    },
  ];
  const ph = (themMuonDong: boolean, ungVien: ReturnType<typeof anhChi>) =>
    tinhPhuHuynhHienHuu({
      tau: MOC,
      tauMay: MOC,
      dong: { orderItemId: "oi-moi", orderId: "o-chung", gioTaoChuaKiem: false, themMuon: themMuonDong, taoLuc: T1 },
      ungVien,
      coDinhDanh: true,
    });

  it("[PLM-P5] dòng thêm muộn ⇒ dòng của anh/chị trong cùng đơn là «đã có trước» (hienHuu = true); dòng cùng lúc đơn ⇒ như cũ (cùng đơn không tính)", () => {
    expect(ph(true, anhChi(false)).hienHuu).toBe(true);
    expect(ph(false, anhChi(false)).hienHuu).toBe(false);
  });
});

describe("[BLH] bảo lưu xét ở CẢ ngày khai (tau) LẪN giờ máy chủ (tauMay) — dính MỘT TRONG HAI ⇒ giữ", () => {
  const TRONG = new Date("2026-06-15T03:00:00.000Z"); // giữa kỳ bảo lưu
  const NGOAI = new Date("2026-05-20T03:00:00.000Z"); // trước kỳ bảo lưu
  const BAO_LUU = [{ batDau: new Date("2026-06-01T03:00:00.000Z"), ketThuc: new Date("2026-06-30T03:00:00.000Z") }];
  const chay = (tau: Date | null, tauMay: Date | null) =>
    phanLoaiGiaoDich(dau({ tau, tauMay, ghiDanh: ghiDanh({ baoLuu: BAO_LUU }) }));

  it("[BLH-01] ngày khai NGOÀI kỳ bảo lưu nhưng giờ máy chủ TRONG kỳ (lùi paidDate để thoát bảo lưu) ⇒ vẫn BAO_LUU, PENDING_REGULATION", () => {
    const r = chay(NGOAI, TRONG);
    expect(r.trangThai).toBe("PENDING_REGULATION");
    expect(r.maLuat).toBe("BAO_LUU");
  });

  it("[BLH-02] chiều ngược: ngày khai TRONG kỳ, giờ máy chủ NGOÀI ⇒ cũng BAO_LUU (hai cách đọc lệch ⇒ không để người khai chọn)", () => {
    expect(chay(TRONG, NGOAI).maLuat).toBe("BAO_LUU");
  });

  it("[BLH-03] đối chứng dương: cả hai cách đọc cùng NGOÀI kỳ ⇒ không dính bảo lưu ⇒ NEW; cả hai cùng TRONG ⇒ BAO_LUU như cũ", () => {
    expect(chay(NGOAI, NGOAI).loai).toBe("NEW");
    expect(chay(TRONG, TRONG).maLuat).toBe("BAO_LUU");
  });

  it("[BLH-04] đơn chưa có khoản thu (tau = tauMay = null) ⇒ xét lượt còn MỞ, không đổi: kỳ đã đóng ⇒ NEW · lượt còn mở ⇒ BAO_LUU", () => {
    expect(chay(null, null).loai).toBe("NEW");
    const mo = phanLoaiGiaoDich(dau({ tau: null, tauMay: null, ghiDanh: ghiDanh({ baoLuu: [{ batDau: new Date("2026-06-01T03:00:00.000Z"), ketThuc: null }] }) }));
    expect(mo.maLuat).toBe("BAO_LUU");
  });
});
