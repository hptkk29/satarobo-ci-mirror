// @vitest-environment node
/**
 * [NHH-TRX-*] — phân loại giao dịch NEW / RENEWAL / MANUAL_REVIEW (04 §5, 05 AC-TRX). THUẦN.
 *
 * Mọi ngày là ngày TUYỆT ĐỐI (luật 19): hàm không đọc đồng hồ, `moc` là tham số bắt buộc.
 * Mỗi ca tự dựng đầu vào bằng `dau()` — không mượn trạng thái ca trước (luật 18).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BO_LUAT_PHAN_LOAI,
  phanLoaiGiaoDich,
  quanHeLanMua,
  tinhPhuHuynhHienHuu,
  xepLanMuaTruoc,
  xepLanMuaTruocAnToan,
  type DauVaoPhanLoai,
  type GhiDanhPhanLoai,
  type KhoanThuLanMua,
  type LanMuaTruoc,
} from "./phan-loai-giao-dich";
import {
  MASTER_LOAI_GIAO_DICH,
  kiemMasterLoaiGiaoDich,
  maLoaiDangBat,
  thanhPhanTheoLoaiDong,
} from "./loai-giao-dich";

const T0 = new Date("2026-03-01T03:00:00.000Z");
const T1 = new Date("2026-06-01T03:00:00.000Z");
/** τ của đơn đang xét = ngày thu ĐẦU TIÊN của đơn ấy (không phải giờ quét). Hàm thuần nhận nó như một DỮ LIỆU. */
const MOC = new Date("2026-09-15T03:00:00.000Z");
/** Ngày thu của lần mua trước trong fixture mặc định — trước τ. */
const TTHU = new Date("2026-04-01T03:00:00.000Z");
const ms = (d: Date, delta: number) => new Date(d.getTime() + delta);
let dem = 0;
/** `ghiLuc` (giờ máy chủ ghi khoản — luật v4) mặc định = `paidDate`: dữ liệu trung thực, hai cách đọc ngày thu trùng nhau. Ca nào cần lệch thì truyền `ghiLuc` riêng. */
const khoan = (amount: number, paidDate: Date = TTHU, id?: string, ghiLuc: Date = paidDate): KhoanThuLanMua => ({ id: id ?? `k${(dem += 1)}`, paidDate, amount, ghiLuc });

function ghiDanh(p: Partial<GhiDanhPhanLoai> = {}): GhiDanhPhanLoai {
  return {
    id: "e-hien-tai",
    courseId: "khoa-sata3",
    centerId: "cs1",
    renewedFromEnrollmentId: null,
    chuyenTu: [],
    chuyenDen: null,
    baoLuu: [],
    ...p,
  };
}

/** Mặc định: lần mua trước ĐÃ THU 5tr (trước τ), không huỷ — tức một lần mua thật. */
function truoc(p: Partial<LanMuaTruoc> = {}): LanMuaTruoc {
  return { orderItemId: "oi-cu", orderId: "o-cu", taoLuc: T0, daHuy: false, trangThaiDon: "CONFIRMED", huyLuc: null, khoanThu: [khoan(5_000_000)], moHo: false, gioTaoChuaKiem: false, themMuon: false, ...p };
}

/** Lần mua trước CHƯA có đồng nào, chưa huỷ — trạng thái "chưa chốt". */
const truocChuaThu = (p: Partial<LanMuaTruoc> = {}): LanMuaTruoc => truoc({ khoanThu: [], ...p });

function dau(p: Partial<DauVaoPhanLoai> = {}): DauVaoPhanLoai {
  // `tauMay` mặc định = `tau` (dữ liệu trung thực, hai cách đọc ngày thu trùng nhau); ca nào cần lệch thì truyền `tauMay` riêng.
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

describe("[NHH-TRX-01..03] NEW / RENEWAL theo HỌC VIÊN (04 §5.2)", () => {
  it("[NHH-TRX-01] lần mua đầu của học viên ⇒ NEW", () => {
    const r = phanLoaiGiaoDich(dau());
    expect(r.loai).toBe("NEW");
    expect(r.trangThai).toBe("CLASSIFIED");
    expect(r.maLuat).toBe("FIRST_PURCHASE");
    expect(r.lyDo.length).toBeGreaterThan(10);
  });

  it("[NHH-TRX-02] mua lần sau bằng ĐƠN KHÁC ⇒ RENEWAL; đối chứng: chính lần mua trước vẫn là NEW", () => {
    const sau = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc()] }));
    expect(sau.loai).toBe("RENEWAL");
    expect(sau.maLuat).toBe("PRIOR_PURCHASE");
    expect(sau.bangChung.lanMuaTruocIds).toEqual(["oi-cu"]);

    // Đối chứng dương: cùng cặp (cũ, mới) nhưng nhìn từ lần mua CŨ — lần mua kia chưa tạo ⇒ NEW.
    const cu = phanLoaiGiaoDich(
      dau({
        dong: { orderItemId: "oi-cu", orderId: "o-cu", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T0 },
        lanMuaTruoc: [truoc({ orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 })],
      }),
    );
    expect(cu.loai).toBe("NEW");
  });

  it("[NHH-TRX-03] ghi danh có renewedFromEnrollmentId (cờ tay) ⇒ RENEWAL dù chưa có lịch sử mua; đối chứng không cờ ⇒ NEW", () => {
    const co = phanLoaiGiaoDich(dau({ ghiDanh: ghiDanh({ renewedFromEnrollmentId: "e-khoa-truoc" }) }));
    expect(co.loai).toBe("RENEWAL");
    expect(co.maLuat).toBe("RENEWED_FROM_FLAG");
    expect(co.bangChung.ghiDanhGocTaiTucId).toBe("e-khoa-truoc");
    expect(phanLoaiGiaoDich(dau({ ghiDanh: ghiDanh() })).loai).toBe("NEW");
  });

  it("[NHH-TRX-01b] HĐ 12tr chia 3 đợt = CÙNG một OrderItem ⇒ NEW ×3; dòng khác trong CÙNG đơn không biến nó thành RENEWAL", () => {
    const d = dau({
      // một dòng học phí khác của CÙNG đơn, tạo trước — "cùng một quyết định mua"
      lanMuaTruoc: [truoc({ orderItemId: "oi-cung-don", orderId: "o-moi", taoLuc: T0 })],
    });
    const ba = [phanLoaiGiaoDich(d), phanLoaiGiaoDich(d), phanLoaiGiaoDich(d)];
    expect(ba.map((r) => r.loai)).toEqual(["NEW", "NEW", "NEW"]);
    expect(new Set(ba.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("[NHH-TRX-01c] lần mua trước đã hoàn sạch (TRƯỚC τ) / đơn bị huỷ không tính là 'lần trước' ⇒ NEW; đối chứng lần mua thật ⇒ RENEWAL; CHƯA thu & chưa huỷ ⇒ GIỮ chứ không NEW (v2)", () => {
    const hoanSach = truoc({ khoanThu: [khoan(5_000_000, TTHU, "k-thu"), khoan(-5_000_000, ms(TTHU, 1000), "k-hoan")] });
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [hoanSach] })).loai).toBe("NEW");
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ daHuy: true })] })).loai).toBe("NEW");
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ khoanThu: [khoan(1)] })] })).loai).toBe("RENEWAL");
    // v1 ghi 'thucThu: 0 ⇒ NEW'; v2 không đoán: chưa có đồng nào nhưng đơn còn sống ⇒ chưa biết có phải lần mua thật không.
    const giu = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu()] }));
    expect([giu.loai, giu.trangThai, giu.maLuat]).toEqual(["MANUAL_REVIEW", "MANUAL_REVIEW_REQUIRED", "PREVIOUS_PURCHASE_UNRESOLVED"]);
  });

  it("[NHH-TRX-01d] bé quay lại sau 1 năm nghỉ vẫn RENEWAL — không định nghĩa bằng thời gian nghỉ", () => {
    const xa = new Date("2025-01-10T03:00:00.000Z");
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ taoLuc: xa })] })).loai).toBe("RENEWAL");
  });

  it("[NHH-TRX-01e] lịch sử MƠ HỒ (tiền của đơn nhiều dòng chưa gắn con) ⇒ xem tay, không đoán; có bằng chứng chắc thì RENEWAL thắng", () => {
    const mo = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu({ moHo: true })] }));
    expect(mo.loai).toBe("MANUAL_REVIEW");
    expect(mo.trangThai).toBe("MANUAL_REVIEW_REQUIRED");
    expect(mo.maLuat).toBe("LICH_SU_MO_HO");
    const chac = phanLoaiGiaoDich(
      dau({ lanMuaTruoc: [truocChuaThu({ moHo: true }), truoc({ orderItemId: "oi-chac", orderId: "o-chac" })] }),
    );
    expect(chac.loai).toBe("RENEWAL");
  });

  it("[NHH-TRX-01f] ghi danh KHÔNG nối đơn nào, tạo trước dòng này ⇒ xung đột bằng chứng ⇒ xem tay; tạo SAU thì bỏ qua", () => {
    const truocDon = phanLoaiGiaoDich(dau({ ghiDanhMoCoi: [{ enrollmentId: "e-tay", taoLuc: T0 }] }));
    expect(truocDon.loai).toBe("MANUAL_REVIEW");
    expect(truocDon.trangThai).toBe("MANUAL_REVIEW_REQUIRED");
    expect(truocDon.maLuat).toBe("GHI_DANH_KHONG_DON");
    expect(truocDon.bangChung.ghiDanhXungDotIds).toEqual(["e-tay"]);
    const sauDon = phanLoaiGiaoDich(
      dau({ ghiDanhMoCoi: [{ enrollmentId: "e-tay", taoLuc: new Date("2026-08-01T03:00:00.000Z") }] }),
    );
    expect(sauDon.loai).toBe("NEW");
  });

  it("[NHH-TRX-01g] hai lần mua cùng giây: thứ tự quyết bằng id ĐƠN ⇒ đúng MỘT bên là RENEWAL (không cùng NEW, không cùng RENEWAL)", () => {
    const a = phanLoaiGiaoDich(
      dau({
        dong: { orderItemId: "oi-a", orderId: "o-a", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 },
        lanMuaTruoc: [truoc({ orderItemId: "oi-b", orderId: "o-b", taoLuc: T1 })],
      }),
    );
    const b = phanLoaiGiaoDich(
      dau({
        dong: { orderItemId: "oi-b", orderId: "o-b", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 },
        lanMuaTruoc: [truoc({ orderItemId: "oi-a", orderId: "o-a", taoLuc: T1 })],
      }),
    );
    expect([a.loai, b.loai].sort()).toEqual(["NEW", "RENEWAL"]);
    // Cấy 08/10 (đảo `<` thành `>` ở datTruoc): vẫn 'đúng một bên' nên ca trên xanh. Hướng PHẢI ghim — chú thích của hàm
    // nói "hoà giờ thì id NHỎ hơn đứng trước": o-a là lần mua đầu (NEW), o-b là lần sau (RENEWAL).
    expect({ a: a.loai, b: b.loai }).toEqual({ a: "NEW", b: "RENEWAL" });
  });

  it("[NHH-TRX-01h] biên: ghi danh mồ côi tạo CÙNG LÚC với dòng đang xét KHÔNG phải 'tạo trước' (so <, không <=)", () => {
    // Cấy 08/10 (< -> <=): 0 ca đỏ — fixture 01f chỉ có hai đầu rõ ràng (T0 < T1, 08/01 > T1), chưa có điểm chạm.
    const cungLuc = phanLoaiGiaoDich(dau({ ghiDanhMoCoi: [{ enrollmentId: "e-tay", taoLuc: T1 }] }));
    expect(cungLuc.loai).toBe("NEW");
    expect(cungLuc.bangChung.ghiDanhXungDotIds).toEqual([]);
    // đối chứng dương: sớm hơn một mili-giây thì xung đột
    const sat = phanLoaiGiaoDich(dau({ ghiDanhMoCoi: [{ enrollmentId: "e-tay", taoLuc: new Date(T1.getTime() - 1) }] }));
    expect(sat.maLuat).toBe("GHI_DANH_KHONG_DON");
  });

  it("[NHH-TRX-01i] lịch sử mơ hồ của đơn đã HUỶ không đòi xem tay; đối chứng: cùng dữ liệu mà đơn còn sống thì xem tay", () => {
    // Cấy 08/10 (bỏ `!l.daHuy` ở nhánh mơ hồ): 0 ca đỏ — 01c chỉ thử đơn huỷ CÓ tiền, 01e chỉ thử mơ hồ KHÔNG huỷ.
    const huy = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu({ moHo: true, daHuy: true })] }));
    expect(huy.loai).toBe("NEW");
    expect(huy.bangChung.lanMuaMoHoIds).toEqual([]);
    const song = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu({ moHo: true, daHuy: false })] }));
    expect(song.maLuat).toBe("LICH_SU_MO_HO");
  });
});

describe("[NHH-TRX-04] con thứ hai của phụ huynh hiện hữu (04 §5.2, 01 Q-04)", () => {
  const anhChi = [
    { studentId: "s-anh", cungLead: true, cungSdt: false, lanMua: [truoc({ orderItemId: "oi-anh", orderId: "o-anh" })] },
  ];

  it("[NHH-TRX-04] bé 2 chưa từng mua ⇒ NEW (lịch sử theo HỌC VIÊN, không theo phụ huynh)", () => {
    const ph = tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: anhChi, coDinhDanh: true });
    const r = phanLoaiGiaoDich(dau({ phuHuynh: ph }));
    expect(r.loai).toBe("NEW");
  });

  it("[NHH-TRX-04b] bằng chứng phuHuynhHienHuu = true cho bé 2; đối chứng dương bé 1 (không ai mua trước) ⇒ false", () => {
    const be2 = tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: anhChi, coDinhDanh: true });
    expect(be2).toEqual({ hienHuu: true, can: "CUNG_LEAD" });
    expect(phanLoaiGiaoDich(dau({ phuHuynh: be2 })).bangChung.phuHuynhHienHuu).toEqual(be2);

    const be1 = tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: [], coDinhDanh: true });
    expect(be1).toEqual({ hienHuu: false, can: null });
  });

  it("[NHH-TRX-04c] cùng SĐT phụ huynh (không cùng lead) cũng tính; anh chị mua SAU hoặc đã hoàn sạch thì không", () => {
    const cungSdt = [{ studentId: "s-x", cungLead: false, cungSdt: true, lanMua: [truoc()] }];
    expect(tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: cungSdt, coDinhDanh: true })).toEqual({
      hienHuu: true,
      can: "CUNG_SDT",
    });
    const sau = [
      {
        studentId: "s-x",
        cungLead: true,
        cungSdt: true,
        lanMua: [truoc({ taoLuc: new Date("2026-08-01T00:00:00.000Z") })],
      },
    ];
    expect(tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: sau, coDinhDanh: true }).hienHuu).toBe(false);
    const hoan = [
      {
        studentId: "s-x",
        cungLead: true,
        cungSdt: true,
        lanMua: [truoc({ khoanThu: [khoan(5_000_000, TTHU, "k1"), khoan(-5_000_000, ms(TTHU, 1000), "k2")] })],
      },
    ];
    expect(tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: hoan, coDinhDanh: true }).hienHuu).toBe(false);
  });

  it("[NHH-TRX-04e] anh/chị mua CÙNG ĐƠN với bé đang xét không làm phụ huynh thành 'hiện hữu' (cần lần mua ở ĐƠN KHÁC)", () => {
    // Cấy 08/10 (bỏ `l.orderId !== dong.orderId` trong bằng chứng PH hiện hữu): 0 ca đỏ.
    const cungDon = [{ studentId: "s-anh", cungLead: true, cungSdt: true, lanMua: [truoc({ orderItemId: "oi-anh", orderId: "o-moi" })] }];
    expect(tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: cungDon, coDinhDanh: true }).hienHuu).toBe(false);
    // đối chứng dương: cùng dữ liệu nhưng lần mua của anh/chị nằm ở đơn KHÁC ⇒ hiện hữu
    const donKhac = [{ studentId: "s-anh", cungLead: true, cungSdt: true, lanMua: [truoc({ orderItemId: "oi-anh", orderId: "o-anh" })] }];
    expect(tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: donKhac, coDinhDanh: true }).hienHuu).toBe(true);
  });

  it("[NHH-TRX-04d] không có lead lẫn SĐT phụ huynh hợp lệ ⇒ KHÔNG BIẾT (null), không khẳng định false", () => {
    expect(tinhPhuHuynhHienHuu({ tau: MOC, tauMay: MOC, dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, ungVien: [], coDinhDanh: false })).toEqual({
      hienHuu: null,
      can: null,
    });
  });
});

describe("[NHH-TRX-05] UPSELL / CROSS_SELL / WINBACK có master nhưng tắt, bộ phân loại không ra", () => {
  it("[NHH-TRX-05] master: ba mã tắt + CHUYEN_TRUNG_TAM tắt, mọi dòng bật đều có bộ phân loại", () => {
    const tat = MASTER_LOAI_GIAO_DICH.filter((d) => !d.isActive).map((d) => d.code);
    expect(tat).toEqual(["UPSELL", "CROSS_SELL", "WINBACK", "CHUYEN_TRUNG_TAM"]);
    expect(maLoaiDangBat()).toEqual(["NEW", "RENEWAL"]);
    expect(kiemMasterLoaiGiaoDich(MASTER_LOAI_GIAO_DICH)).toEqual([]);
  });

  it("[NHH-TRX-05b] cố tình bật một mã không có bộ phân loại ⇒ bị bắt (bản thuần của CHECK DB)", () => {
    const hong = MASTER_LOAI_GIAO_DICH.map((d) => (d.code === "UPSELL" ? { ...d, isActive: true } : d));
    expect(kiemMasterLoaiGiaoDich(hong)).toEqual(["UPSELL"]);
  });

  it("[NHH-TRX-05c] quét nhiều hình dạng đầu vào: kết quả luôn thuộc {NEW, RENEWAL, MANUAL_REVIEW, NGOAI_PHAM_VI}", () => {
    const hinh: DauVaoPhanLoai[] = [
      dau(),
      dau({ lanMuaTruoc: [truoc()] }),
      dau({ lanMuaTruoc: [truoc(), truoc({ orderItemId: "x2", orderId: "o2" })] }),
      dau({ ghiDanh: ghiDanh({ renewedFromEnrollmentId: "e0" }) }),
      dau({ studentId: null }),
      dau({ dong: { orderItemId: "p", orderId: "o", thanhPhan: "MATERIAL", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 } }),
    ];
    for (const h of hinh) {
      expect(["NEW", "RENEWAL", "MANUAL_REVIEW", "NGOAI_PHAM_VI"]).toContain(phanLoaiGiaoDich(h).loai);
    }
  });

  it("[NHH-TRX-05d] mã nguồn bộ phân loại không chứa tên các loại tắt (chú thích bỏ trước khi so)", () => {
    const code = boChuThich(readFileSync(resolve(process.cwd(), "lib/hoa-hong/phan-loai-giao-dich.ts"), "utf8"));
    for (const ma of ["UPSELL", "CROSS_SELL", "WINBACK", "CHUYEN_TRUNG_TAM"]) {
      expect(code.split(ma).length - 1, ma).toBe(0);
    }
  });
});

describe("[NHH-TRX-06] ca dính đổi khoá / chuyển cơ sở / bảo lưu / dừng học (04 §5.2 bước 2)", () => {
  it("[NHH-TRX-06a] đổi khoá (ghi danh nhận từ ghi danh KHÁC KHOÁ) ⇒ PENDING_REGULATION, không phải xem tay", () => {
    const r = phanLoaiGiaoDich(
      dau({ ghiDanh: ghiDanh({ chuyenTu: [{ enrollmentId: "e-cu", courseId: "khoa-sata2", centerId: "cs1" }] }) }),
    );
    expect(r.loai).toBe("MANUAL_REVIEW");
    expect(r.trangThai).toBe("PENDING_REGULATION");
    expect(r.maLuat).toBe("DOI_KHOA");
  });

  it("[NHH-TRX-06a2] ghi danh ĐÃ chuyển đi sang khoá khác cũng dính đổi khoá (khoản thu về dòng cũ)", () => {
    const r = phanLoaiGiaoDich(
      dau({ ghiDanh: ghiDanh({ chuyenDen: { enrollmentId: "e-moi", courseId: "khoa-sata4", centerId: "cs1" } }) }),
    );
    expect(r.trangThai).toBe("PENDING_REGULATION");
    expect(r.maLuat).toBe("DOI_KHOA");
  });

  it("[NHH-TRX-06b] chuyển cơ sở (cùng khoá, khác cơ sở) ⇒ PENDING_REGULATION", () => {
    const r = phanLoaiGiaoDich(
      dau({ ghiDanh: ghiDanh({ chuyenTu: [{ enrollmentId: "e-cu", courseId: "khoa-sata3", centerId: "cs2" }] }) }),
    );
    expect(r.trangThai).toBe("PENDING_REGULATION");
    expect(r.maLuat).toBe("CHUYEN_CO_SO");
  });

  it("[NHH-TRX-06c] bảo lưu ĐANG hiệu lực tại mốc ⇒ PENDING_REGULATION; đã kết thúc / chưa bắt đầu tại mốc ⇒ không dính (đối chứng)", () => {
    const dangBaoLuu = phanLoaiGiaoDich(
      dau({ ghiDanh: ghiDanh({ baoLuu: [{ batDau: new Date("2026-09-01T00:00:00.000Z"), ketThuc: null }] }) }),
    );
    expect(dangBaoLuu.trangThai).toBe("PENDING_REGULATION");
    expect(dangBaoLuu.maLuat).toBe("BAO_LUU");

    const daKetThuc = phanLoaiGiaoDich(
      dau({
        ghiDanh: ghiDanh({
          baoLuu: [{ batDau: new Date("2026-07-01T00:00:00.000Z"), ketThuc: new Date("2026-08-01T00:00:00.000Z") }],
        }),
      }),
    );
    expect(daKetThuc.loai).toBe("NEW");
    const chuaBatDau = phanLoaiGiaoDich(
      dau({ ghiDanh: ghiDanh({ baoLuu: [{ batDau: new Date("2026-10-01T00:00:00.000Z"), ketThuc: null }] }) }),
    );
    expect(chuaBatDau.loai).toBe("NEW");
  });

  it("[NHH-TRX-06c2] biên bảo lưu [bắt đầu, kết thúc): đúng mốc kết thúc ⇒ đã hết; đúng mốc bắt đầu ⇒ đang dính", () => {
    // Cấy 08/10 (`>` -> `>=` ở ketThuc): 0 ca đỏ — 06c chỉ thử mốc cách xa hai đầu cả tháng.
    const ketThucDungMoc = phanLoaiGiaoDich(dau({ ghiDanh: ghiDanh({ baoLuu: [{ batDau: new Date("2026-08-01T00:00:00.000Z"), ketThuc: MOC }] }) }));
    expect(ketThucDungMoc.loai).toBe("NEW");
    const sapHet = phanLoaiGiaoDich(dau({ ghiDanh: ghiDanh({ baoLuu: [{ batDau: new Date("2026-08-01T00:00:00.000Z"), ketThuc: new Date(MOC.getTime() + 1) }] }) }));
    expect(sapHet.maLuat).toBe("BAO_LUU");
    const batDauDungMoc = phanLoaiGiaoDich(dau({ ghiDanh: ghiDanh({ baoLuu: [{ batDau: MOC, ketThuc: null }] }) }));
    expect(batDauDungMoc.maLuat).toBe("BAO_LUU");
    const batDauSauMoc = phanLoaiGiaoDich(dau({ ghiDanh: ghiDanh({ baoLuu: [{ batDau: new Date(MOC.getTime() + 1), ketThuc: null }] }) }));
    expect(batDauSauMoc.loai).toBe("NEW");
  });

  it("[NHH-TRX-06e] dòng đã DỪNG HỌC mà vẫn có khoản THU mới ⇒ PENDING_REGULATION", () => {
    const r = phanLoaiGiaoDich(
      dau({ dong: { orderItemId: "oi-moi", orderId: "o-moi", thanhPhan: "TUITION", trangThai: "STOPPED", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 } }),
    );
    expect(r.trangThai).toBe("PENDING_REGULATION");
    expect(r.maLuat).toBe("DUNG_HOC");
  });

  it("[NHH-TRX-06f] CHUYỂN LỚP (cùng khoá, cùng cơ sở) chưa có văn bản nhận diện ⇒ xem tay; cơ sở không rõ ⇒ cũng xem tay (không đoán)", () => {
    const lop = phanLoaiGiaoDich(
      dau({ ghiDanh: ghiDanh({ chuyenTu: [{ enrollmentId: "e-cu", courseId: "khoa-sata3", centerId: "cs1" }] }) }),
    );
    expect(lop.loai).toBe("MANUAL_REVIEW");
    expect(lop.trangThai).toBe("MANUAL_REVIEW_REQUIRED");
    expect(lop.maLuat).toBe("CHUYEN_LOP");

    const khongRo = phanLoaiGiaoDich(
      dau({
        ghiDanh: ghiDanh({
          centerId: null,
          chuyenTu: [{ enrollmentId: "e-cu", courseId: "khoa-sata3", centerId: "cs1" }],
        }),
      }),
    );
    expect(khongRo.trangThai).toBe("MANUAL_REVIEW_REQUIRED");
    expect(khongRo.maLuat).toBe("CHUYEN_KHONG_RO");
  });

  it("[NHH-TRX-06g] thứ tự ưu tiên: dính đổi khoá thắng cờ tái tục và lịch sử mua (PENDING_REGULATION trước RENEWAL)", () => {
    const r = phanLoaiGiaoDich(
      dau({
        ghiDanh: ghiDanh({
          renewedFromEnrollmentId: "e0",
          chuyenTu: [{ enrollmentId: "e-cu", courseId: "khoa-sata2", centerId: "cs1" }],
        }),
        lanMuaTruoc: [truoc()],
      }),
    );
    expect(r.trangThai).toBe("PENDING_REGULATION");
  });
});

describe("[NHH-TRX-07] chỉ Học phí đi vào phân loại (D17)", () => {
  it("[NHH-TRX-07] học cụ / lệ phí thi / phí học bù ⇒ NGOAI_PHAM_VI, không NEW/RENEWAL; đối chứng học phí ⇒ NEW", () => {
    for (const thanhPhan of ["MATERIAL", "OTHER", "EQUIPMENT"] as const) {
      const r = phanLoaiGiaoDich(
        dau({ dong: { orderItemId: "p", orderId: "o", thanhPhan, trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 } }),
      );
      expect(r.loai).toBe("NGOAI_PHAM_VI");
      expect(r.maLuat).toBe("NGOAI_PHAM_VI");
    }
    expect(phanLoaiGiaoDich(dau()).loai).toBe("NEW");
  });

  it("[NHH-TRX-07b] thành phần theo loại dòng đơn; loại lạ ⇒ null (không tự coi là học phí)", () => {
    expect(thanhPhanTheoLoaiDong("COURSE_ENROLLMENT")).toBe("TUITION");
    expect(thanhPhanTheoLoaiDong("COURSE_PACKAGE")).toBe("TUITION");
    expect(thanhPhanTheoLoaiDong("PRODUCT")).toBe("MATERIAL");
    expect(thanhPhanTheoLoaiDong("EXAM_REGISTRATION")).toBe("OTHER");
    expect(thanhPhanTheoLoaiDong("MAKEUP_FEE")).toBe("OTHER");
    expect(thanhPhanTheoLoaiDong("MOT_LOAI_MOI")).toBeNull();
  });
});

describe("[NHH-TRX-09..12] thiếu dữ liệu ⇒ không đoán; thuần; tất định", () => {
  it("[NHH-TRX-09] không ra được học viên ⇒ xem tay (KHONG_RA_HOC_VIEN); đối chứng có học viên ⇒ phân loại", () => {
    const r = phanLoaiGiaoDich(dau({ studentId: null }));
    expect(r.loai).toBe("MANUAL_REVIEW");
    expect(r.trangThai).toBe("MANUAL_REVIEW_REQUIRED");
    expect(r.maLuat).toBe("KHONG_RA_HOC_VIEN");
    expect(phanLoaiGiaoDich(dau({ studentId: "s1" })).loai).toBe("NEW");
  });

  it("[NHH-TRX-10] đơn KHÔNG có lead không đổi NEW/RENEWAL (phân loại theo học viên) — chỉ ghi vào bằng chứng; người hưởng treo là việc của PR5", () => {
    const khong = phanLoaiGiaoDich(dau({ coLead: false }));
    const co = phanLoaiGiaoDich(dau({ coLead: true }));
    expect(khong.loai).toBe(co.loai);
    expect(khong.bangChung.coLead).toBe(false);
    expect(co.bangChung.coLead).toBe(true);
    const renew = phanLoaiGiaoDich(dau({ coLead: false, lanMuaTruoc: [truoc()] }));
    expect(renew.loai).toBe("RENEWAL");
  });

  it("[NHH-TRX-11] đầu vào không bị sửa; cùng đầu vào ⇒ cùng kết quả; phiên bản bộ luật được chụp", () => {
    const d = dau({
      lanMuaTruoc: [truoc()],
      ghiDanh: ghiDanh({
        baoLuu: [{ batDau: new Date("2026-01-01T00:00:00.000Z"), ketThuc: new Date("2026-02-01T00:00:00.000Z") }],
      }),
    });
    const truocKhi = JSON.stringify(d);
    const a = phanLoaiGiaoDich(d);
    const b = phanLoaiGiaoDich(d);
    expect(JSON.stringify(d)).toBe(truocKhi);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(BO_LUAT_PHAN_LOAI).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
  });

  it("[NHH-TRX-12] hàm không đọc đồng hồ thật (luật 19): mã nguồn không có Date.now / new Date()", () => {
    const code = boChuThich(readFileSync(resolve(process.cwd(), "lib/hoa-hong/phan-loai-giao-dich.ts"), "utf8"));
    expect(code.split("Date.now").length - 1).toBe(0);
    expect(code.split("new Date()").length - 1).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// [PLD-P] — LUẬT v2 (2026-10-16): phân loại là hàm của THỨ TỰ MUA + sự kiện CÓ MỐC, không của giờ quét.
//
// Khoá thứ tự của lần mua = (Order.createdAt, Order.id). τ = ngày thu ĐẦU của đơn đang xét, đưa vào như DỮ LIỆU
// (`tau`) — hàm không biết khoản nào vừa được quét, cũng không đọc đồng hồ.
// ═════════════════════════════════════════════════════════════════════════════════════════════
function hoanVi<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  const kq: T[][] = [];
  xs.forEach((x, i) => {
    for (const r of hoanVi([...xs.slice(0, i), ...xs.slice(i + 1)])) kq.push([x, ...r]);
  });
  return kq;
}

describe("[PLD-P] phân loại TẤT ĐỊNH theo thứ tự mua (luật v2)", () => {
  it("[PLD-P1] hoán vị mảng lanMuaTruoc (24 thứ tự) và thứ tự khoản thu trong mỗi lần mua KHÔNG đổi kết quả hay bằng chứng", () => {
    const e1 = truoc({ orderItemId: "oi-1", orderId: "o-1", khoanThu: [khoan(3_000_000, TTHU, "k-a"), khoan(2_000_000, ms(TTHU, 5), "k-b")] });
    const e2 = truocChuaThu({ orderItemId: "oi-2", orderId: "o-2" });
    const e3 = truoc({ orderItemId: "oi-3", orderId: "o-3", daHuy: true, huyLuc: ms(MOC, -1) });
    const e4 = truocChuaThu({ orderItemId: "oi-4", orderId: "o-4", moHo: true });
    const chuan = JSON.stringify(phanLoaiGiaoDich(dau({ lanMuaTruoc: [e1, e2, e3, e4] })));
    const r = phanLoaiGiaoDich(dau({ lanMuaTruoc: [e1, e2, e3, e4] }));
    expect(r.loai).toBe("RENEWAL");
    expect(r.bangChung.lanMuaTruocIds).toEqual(["oi-1"]);
    expect(r.bangChung.lanMuaChuaChotIds).toEqual(["oi-2"]);
    expect(r.bangChung.lanMuaMoHoIds).toEqual(["oi-4"]);
    expect(r.bangChung.lanMuaLoaiBo).toEqual([{ orderItemId: "oi-3", ma: "HUY_TRUOC_MOC" }]);
    for (const thuTu of hoanVi([e1, e2, e3, e4])) {
      expect(JSON.stringify(phanLoaiGiaoDich(dau({ lanMuaTruoc: thuTu })))).toBe(chuan);
    }
    // Đảo cả thứ tự khoản thu BÊN TRONG lần mua.
    const e1dao = { ...e1, khoanThu: [...e1.khoanThu].reverse() };
    expect(JSON.stringify(phanLoaiGiaoDich(dau({ lanMuaTruoc: [e1dao, e2, e3, e4] })))).toBe(chuan);
    // Không có lần mua chắc: mơ hồ thắng chưa chốt — và cũng bất biến theo thứ tự.
    const khongChac = [e2, e3, e4];
    const ref = JSON.stringify(phanLoaiGiaoDich(dau({ lanMuaTruoc: khongChac })));
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: khongChac })).maLuat).toBe("LICH_SU_MO_HO");
    for (const thuTu of hoanVi(khongChac)) expect(JSON.stringify(phanLoaiGiaoDich(dau({ lanMuaTruoc: thuTu })))).toBe(ref);
  });

  it("[PLD-P2] khoá thứ tự là (Order.createdAt, Order.id): hoà giờ thì id ĐƠN quyết — KHÔNG phải id dòng đơn; ngày khác nhau thì ngày quyết, id không liên quan", () => {
    // Hai thứ tự id cố ý NGƯỢC nhau: id dòng a < z nhưng id đơn z > a.
    const dongX = { orderItemId: "oi-a", orderId: "o-z", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 } as const;
    const dongY = { orderItemId: "oi-z", orderId: "o-a", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 } as const;
    const x = phanLoaiGiaoDich(dau({ dong: dongX, lanMuaTruoc: [truoc({ orderItemId: dongY.orderItemId, orderId: dongY.orderId, taoLuc: T1 })] }));
    const y = phanLoaiGiaoDich(dau({ dong: dongY, lanMuaTruoc: [truoc({ orderItemId: dongX.orderItemId, orderId: dongX.orderId, taoLuc: T1 })] }));
    // Đơn o-a đứng trước ⇒ dòng Y (đơn o-a) là lần mua đầu; dòng X (đơn o-z) là lần sau.
    expect({ x: x.loai, y: y.loai }).toEqual({ x: "RENEWAL", y: "NEW" });
    // Ngày quyết trước id: tiền lệ có id nhỏ hơn nhưng tạo SAU thì không phải tiền lệ.
    const sau = phanLoaiGiaoDich(dau({ dong: dongX, lanMuaTruoc: [truoc({ orderItemId: "oi-0", orderId: "o-0", taoLuc: ms(T1, 1) })] }));
    expect(sau.loai).toBe("NEW");
  });

  it("[PLD-P3] tiền lệ có BA trạng thái: đã thu ⇒ RENEWAL · chưa thu & chưa huỷ ⇒ GIỮ (không đoán) · đã huỷ ⇒ NEW; thứ tự ưu tiên giữa các nhánh", () => {
    const daThu = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc()] }));
    expect([daThu.loai, daThu.maLuat]).toEqual(["RENEWAL", "PRIOR_PURCHASE"]);

    const giu = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu({ orderItemId: "oi-nhap", orderId: "o-nhap" })] }));
    expect([giu.loai, giu.trangThai, giu.maLuat]).toEqual(["MANUAL_REVIEW", "MANUAL_REVIEW_REQUIRED", "PREVIOUS_PURCHASE_UNRESOLVED"]);
    expect(giu.bangChung.lanMuaChuaChotIds).toEqual(["oi-nhap"]);
    // Người vận hành phải thấy NGAY đơn nào đang giữ — lý do nêu id đơn.
    expect(giu.lyDo).toContain("o-nhap");

    const huy = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu({ daHuy: true, huyLuc: ms(MOC, 99) })] }));
    expect([huy.loai, huy.maLuat]).toEqual(["NEW", "FIRST_PURCHASE"]);
    expect(huy.bangChung.lanMuaLoaiBo).toEqual([{ orderItemId: "oi-cu", ma: "HUY_CHUA_TUNG_THU" }]);

    // Ưu tiên: lần mua chắc thắng chưa chốt (RENEWAL dù thế nào) · cờ tái tục thắng chưa chốt · văn bản chưa có (PENDING) thắng chưa chốt.
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu({ orderItemId: "x", orderId: "ox" }), truoc()] })).loai).toBe("RENEWAL");
    expect(phanLoaiGiaoDich(dau({ ghiDanh: ghiDanh({ renewedFromEnrollmentId: "e0" }), lanMuaTruoc: [truocChuaThu()] })).maLuat).toBe("RENEWED_FROM_FLAG");
    const pending = phanLoaiGiaoDich(dau({ ghiDanh: ghiDanh({ chuyenTu: [{ enrollmentId: "e-cu", courseId: "khoa-sata2", centerId: "cs1" }] }), lanMuaTruoc: [truocChuaThu()] }));
    expect(pending.trangThai).toBe("PENDING_REGULATION");
    // Mơ hồ (tiền chưa gắn dòng) thắng chưa chốt; chưa chốt thắng ghi danh mồ côi.
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu({ moHo: true })] })).maLuat).toBe("LICH_SU_MO_HO");
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truocChuaThu()], ghiDanhMoCoi: [{ enrollmentId: "e-tay", taoLuc: T0 }] })).maLuat).toBe("PREVIOUS_PURCHASE_UNRESOLVED");
    // Đối chứng dương: bỏ lần mua chưa chốt đi thì ghi danh mồ côi mới lộ ra.
    expect(phanLoaiGiaoDich(dau({ ghiDanhMoCoi: [{ enrollmentId: "e-tay", taoLuc: T0 }] })).maLuat).toBe("GHI_DANH_KHONG_DON");
  });

  it("[PLD-P4] huỷ / hoàn sạch so với τ — đủ ba phía < · = · >: mốc ≤ τ thì lần mua BỊ LOẠI (NEW); mốc > τ thì KHÔNG viết lại lịch sử (RENEWAL)", () => {
    const loai = (l: LanMuaTruoc) => phanLoaiGiaoDich(dau({ lanMuaTruoc: [l] })).loai;
    // Huỷ SAU khi đã có tiền.
    expect(loai(truoc({ daHuy: true, huyLuc: ms(MOC, -1) }))).toBe("NEW");
    expect(loai(truoc({ daHuy: true, huyLuc: MOC }))).toBe("NEW");
    expect(loai(truoc({ daHuy: true, huyLuc: ms(MOC, 1) }))).toBe("RENEWAL");
    // Đơn huỷ không để lại mốc (dữ liệu cũ) ⇒ coi như huỷ từ đầu — hành vi v1 giữ nguyên, có ghi vào bằng chứng.
    const khongMoc = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ daHuy: true, huyLuc: null })] }));
    expect(khongMoc.loai).toBe("NEW");
    expect(khongMoc.bangChung.lanMuaLoaiBo).toEqual([{ orderItemId: "oi-cu", ma: "HUY_KHONG_MOC" }]);
    // Hoàn sạch: tổng khoản thu có mốc ≤ τ về ≤ 0.
    const hoanTai = (mocHoan: Date) => truoc({ khoanThu: [khoan(5_000_000, TTHU, "k1"), khoan(-5_000_000, mocHoan, "k2")] });
    expect(loai(hoanTai(ms(MOC, -1)))).toBe("NEW");
    expect(loai(hoanTai(MOC))).toBe("NEW");
    expect(loai(hoanTai(ms(MOC, 1)))).toBe("RENEWAL");
    // Hoàn MỘT PHẦN thì vẫn còn tiền ⇒ vẫn là lần mua thật.
    expect(loai(truoc({ khoanThu: [khoan(5_000_000, TTHU, "k1"), khoan(-2_000_000, ms(MOC, -5), "k2")] }))).toBe("RENEWAL");
    // Lần mua trước CHỈ được thu SAU τ (thu muộn hơn B) vẫn là lần mua thật theo thứ tự đơn.
    expect(loai(truoc({ khoanThu: [khoan(5_000_000, ms(MOC, 1))] }))).toBe("RENEWAL");
    // Đã thu rồi hoàn sạch (≤ τ), SAU τ mới thu lại: tại τ nó không còn là lần mua thật ⇒ NEW; đây là quy ước, ghim để không trôi.
    expect(loai(truoc({ khoanThu: [khoan(5_000_000, TTHU, "k1"), khoan(-5_000_000, ms(TTHU, 9), "k2"), khoan(5_000_000, ms(MOC, 1), "k3")] }))).toBe("NEW");
    // Chỉ có khoản ÂM, chưa từng thu dương, chưa huỷ ⇒ không biết ⇒ giữ (không phải NEW).
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ khoanThu: [khoan(-1_000, TTHU)] })] })).maLuat).toBe("PREVIOUS_PURCHASE_UNRESOLVED");
  });

  it("[PLD-P5] chưa có τ (tau = null: dự kiến cho đơn chưa thu) — KHÔNG đọc đồng hồ: mọi lần huỷ / hoàn sạch đã biết đều tính là 'trước'; bảo lưu xét theo lượt còn MỞ", () => {
    const loai = (l: LanMuaTruoc) => phanLoaiGiaoDich(dau({ tau: null, lanMuaTruoc: [l] })).loai;
    expect(loai(truoc({ daHuy: true, huyLuc: ms(MOC, 999_999) }))).toBe("NEW");
    expect(loai(truoc({ khoanThu: [khoan(5_000_000, TTHU, "k1"), khoan(-5_000_000, ms(MOC, 999_999), "k2")] }))).toBe("NEW");
    expect(loai(truoc())).toBe("RENEWAL");
    expect(phanLoaiGiaoDich(dau({ tau: null, lanMuaTruoc: [truocChuaThu()] })).maLuat).toBe("PREVIOUS_PURCHASE_UNRESOLVED");

    const moTrong = (baoLuu: GhiDanhPhanLoai["baoLuu"]) => phanLoaiGiaoDich(dau({ tau: null, ghiDanh: ghiDanh({ baoLuu }) }));
    expect(moTrong([{ batDau: T0, ketThuc: null }]).maLuat).toBe("BAO_LUU");
    expect(moTrong([{ batDau: T0, ketThuc: T1 }]).loai).toBe("NEW");
    expect(phanLoaiGiaoDich(dau({ tau: null })).bangChung.tau).toBeNull();
  });

  it("[PLD-P6] mọi dòng của CÙNG một đơn dùng chung τ và khoá ⇒ cùng kết quả; τ được ghi vào bằng chứng", () => {
    const lanMuaTruoc = [truoc({ khoanThu: [khoan(5_000_000, TTHU, "k1"), khoan(-5_000_000, ms(MOC, 1), "k2")] })];
    const d1 = phanLoaiGiaoDich(dau({ dong: { orderItemId: "oi-1", orderId: "o-moi", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, lanMuaTruoc }));
    const d2 = phanLoaiGiaoDich(dau({ dong: { orderItemId: "oi-2", orderId: "o-moi", thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 }, lanMuaTruoc }));
    expect([d1.loai, d1.maLuat]).toEqual([d2.loai, d2.maLuat]);
    expect(d1.bangChung.tau).toBe(MOC.toISOString());
  });

  it("[PLD-P7] 'PH hiện hữu' dùng CÙNG vị từ lần-mua-thật: tiền lệ đã thu ⇒ true; đã huỷ/hoàn sạch ⇒ false; chưa chốt ⇒ null (KHÔNG BIẾT — không khẳng định false, cũng không giữ khoản)", () => {
    const ph = (lanMua: LanMuaTruoc[]) =>
      tinhPhuHuynhHienHuu({
        tau: MOC,
        tauMay: MOC,
        dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 },
        ungVien: [{ studentId: "s-anh", cungLead: true, cungSdt: false, lanMua }],
        coDinhDanh: true,
      });
    expect(ph([truoc({ orderItemId: "oi-anh", orderId: "o-anh" })])).toEqual({ hienHuu: true, can: "CUNG_LEAD" });
    expect(ph([truoc({ orderItemId: "oi-anh", orderId: "o-anh", daHuy: true, huyLuc: MOC })])).toEqual({ hienHuu: false, can: null });
    expect(ph([truocChuaThu({ orderItemId: "oi-anh", orderId: "o-anh" })])).toEqual({ hienHuu: null, can: null });
    // Có một anh/chị đã thu thật ⇒ true, dù anh/chị khác còn chưa chốt.
    expect(ph([truocChuaThu({ orderItemId: "oi-x", orderId: "o-x" }), truoc({ orderItemId: "oi-anh", orderId: "o-anh" })]).hienHuu).toBe(true);
    // Anh/chị mua SAU (theo khoá (ngày, id đơn)) thì không tính, kể cả chưa chốt.
    expect(ph([truocChuaThu({ orderItemId: "oi-anh", orderId: "o-anh", taoLuc: ms(T1, 1) })])).toEqual({ hienHuu: false, can: null });
  });

  it("[PLD-P8] xepLanMuaTruoc là hàm thuần của (lần mua, τ): gọi lặp ra y hệt, không sửa đầu vào", () => {
    const l = truoc({ khoanThu: [khoan(5_000_000, TTHU, "k1"), khoan(-1, ms(TTHU, 1), "k2")] });
    const truocKhi = JSON.stringify(l);
    expect(xepLanMuaTruoc(l, MOC)).toEqual({ ket: "TINH", ma: "DA_THU" });
    expect(xepLanMuaTruoc(l, MOC)).toEqual(xepLanMuaTruoc(l, MOC));
    expect(JSON.stringify(l)).toBe(truocKhi);
    expect(xepLanMuaTruoc(truocChuaThu(), MOC)).toEqual({ ket: "CHUA_CHOT", ma: "CHUA_THU_CHUA_HUY" });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// [PLD-M] — THỨ TỰ LẦN MUA KHI CÓ ĐƠN "GIỜ TẠO CHƯA KIỂM CHỨNG" (ghi bù / nhập giao dịch cũ). LUẬT v3 (2026-10-17, chủ dự án chốt §3/§4):
//   · KHÔNG có ngày nào do NGƯỜI NHẬP khai (`Payment.paidDate`, ngày trong audit, ngày trong sheet) đi vào khoá K. Hàm thuần không còn tham số nào để nhận nó.
//   · Đơn "chưa kiểm chứng" mang `taoLuc` = giờ MÁY CHỦ ghi nhận — chỉ là CẬN TRÊN của lúc mua thật (mua trước, nhập sau). Quan hệ trước/sau của một CẶP chỉ CHẮC khi đơn đứng SAU theo K
//     có giờ do máy chủ đặt; đơn đứng sau mà chưa kiểm chứng ⇒ không biết ⇒ GIỮ (BACKFILL_ORDER_TIME_UNVERIFIED), không đoán.
// Ca gốc (reviewer gộp UAT 11/10/2026): B tạo 10/10 thu 15/10, E' ghi bù nhập 12/10 — trước đây bản vá "tin ngày thu của E'" cho B = RENEWAL, nhưng ngày ấy do người nhập khai.
// ═════════════════════════════════════════════════════════════════════════════════════════════
const NGAY = (s: string) => new Date(`${s}T03:00:00.000Z`);

type DonThuTu = { orderItemId: string; orderId: string; taoLuc: Date; gioTaoChuaKiem: boolean };
const donTT = (orderId: string, taoLuc: Date, gioTaoChuaKiem = false): DonThuTu => ({ orderItemId: `oi-${orderId}`, orderId, taoLuc, gioTaoChuaKiem });
/** Dòng đang xét ở góc nhìn của một đơn. */
const dongCua = (d: DonThuTu): DauVaoPhanLoai["dong"] => ({ orderItemId: d.orderItemId, orderId: d.orderId, thanhPhan: "TUITION", trangThai: "ACTIVE", gioTaoChuaKiem: d.gioTaoChuaKiem, themMuon: false, taoLuc: d.taoLuc });
/** Lần mua trước nhìn từ đơn khác. `thu` = đã thu thật (TINH) hay chưa thu (CHUA_CHOT). */
const lanMuaCua = (d: DonThuTu, thu = true): LanMuaTruoc => truoc({ orderItemId: d.orderItemId, orderId: d.orderId, taoLuc: d.taoLuc, gioTaoChuaKiem: d.gioTaoChuaKiem, khoanThu: thu ? [khoan(5_000_000, TTHU, `k-${d.orderId}`)] : [] });
/** Phân loại đơn `x` khi học viên còn các đơn `khac` (mỗi đơn khác đã thu thật, trừ khi nói khác). */
const phanLoaiCua = (x: DonThuTu, khac: readonly DonThuTu[], thu: Record<string, boolean> = {}) =>
  phanLoaiGiaoDich(dau({ dong: dongCua(x), lanMuaTruoc: khac.map((k) => lanMuaCua(k, thu[k.orderId] ?? true)), tau: MOC }));

describe("[PLD-M] thứ tự lần mua — đơn giờ-tạo-chưa-kiểm-chứng không được đoán thứ tự", () => {
  it("[PLD-M1] bảng chân lý của MỘT CẶP: quan hệ chỉ CHẮC khi đơn đứng SAU theo K có giờ máy chủ; ngược lại KHÔNG BIẾT", () => {
    const T = (s: string) => NGAY(s);
    // [y trước x theo K?, y chưa kiểm chứng?, x chưa kiểm chứng?] → kết quả
    const ca: [string, DonThuTu, DonThuTu, string][] = [
      ["y trước, cả hai thường", donTT("y", T("2026-10-10")), donTT("x", T("2026-10-12")), "TRUOC_CHAC"],
      ["y sau, cả hai thường", donTT("y", T("2026-10-14")), donTT("x", T("2026-10-12")), "SAU_CHAC"],
      ["y trước, y ghi bù (mua trước nhập trước ⇒ vẫn trước x)", donTT("y", T("2026-10-10"), true), donTT("x", T("2026-10-12")), "TRUOC_CHAC"],
      ["y trước, x ghi bù (x có thể đã mua từ lâu)", donTT("y", T("2026-10-10")), donTT("x", T("2026-10-12"), true), "KHONG_BIET"],
      ["y sau, y ghi bù (y có thể đã mua trước x)", donTT("y", T("2026-10-14"), true), donTT("x", T("2026-10-12")), "KHONG_BIET"],
      ["y sau, x ghi bù (x nhập sớm hơn y ⇒ x mua trước y)", donTT("y", T("2026-10-14")), donTT("x", T("2026-10-12"), true), "SAU_CHAC"],
      ["y trước, cả hai ghi bù", donTT("y", T("2026-10-10"), true), donTT("x", T("2026-10-12"), true), "KHONG_BIET"],
      ["y sau, cả hai ghi bù", donTT("y", T("2026-10-14"), true), donTT("x", T("2026-10-12"), true), "KHONG_BIET"],
    ];
    for (const [ten, y, x, ra] of ca) expect(quanHeLanMua(y, x), ten).toBe(ra);
  });

  it("[PLD-M2] ca của reviewer: B thường (tạo 10/10, thu 15/10) + E' ghi bù (máy chủ nhận 12/10) ⇒ B KHÔNG đoán: giữ BACKFILL_ORDER_TIME_UNVERIFIED, bằng chứng nêu dòng của E'", () => {
    const b = donTT("b", NGAY("2026-10-10"));
    const e = donTT("e", NGAY("2026-10-12"), true);
    const r = phanLoaiCua(b, [e]);
    expect(r).toMatchObject({ loai: "MANUAL_REVIEW", trangThai: "MANUAL_REVIEW_REQUIRED", maLuat: "BACKFILL_ORDER_TIME_UNVERIFIED" });
    expect(r.bangChung.lanMuaThuTuChuaKiemIds).toEqual(["oi-e"]);
    expect(r.bangChung.lanMuaTruocIds).toEqual([]); // không tự coi E' là lần mua trước
    expect(r.lyDo).toMatch(/chưa được kiểm chứng|không biết/i);
  });

  it("[PLD-M3] chiều ngược lại: E' (ghi bù) nhìn B (thường, tạo trước nó) ⇒ E' cũng GIỮ — hai đơn không ai được đoán là lần mua đầu", () => {
    const b = donTT("b", NGAY("2026-10-10"));
    const e = donTT("e", NGAY("2026-10-12"), true);
    const r = phanLoaiCua(e, [b]);
    expect(r).toMatchObject({ loai: "MANUAL_REVIEW", maLuat: "BACKFILL_ORDER_TIME_UNVERIFIED" });
    expect(r.bangChung.lanMuaThuTuChuaKiemIds).toEqual(["oi-b"]);
  });

  it("[PLD-M4] đối chứng: đơn ghi bù nhập TRƯỚC khi B được tạo ⇒ E' chắc chắn là tiền lệ (mua ≤ nhập < tạo B) ⇒ B = RENEWAL, E' = NEW — không cần ngày nào do người nhập khai", () => {
    const e = donTT("e", NGAY("2026-10-08"), true);
    const b = donTT("b", NGAY("2026-10-10"));
    expect(phanLoaiCua(b, [e])).toMatchObject({ loai: "RENEWAL", maLuat: "PRIOR_PURCHASE" });
    expect(phanLoaiCua(e, [b])).toMatchObject({ loai: "NEW", maLuat: "FIRST_PURCHASE" });
  });

  it("[PLD-M5] KHAI NGÀY LÙI KHÔNG ĐỔI GÌ: đổi ngày của khoản thu (ngày người nhập khai, kể cả lùi rất xa hay tương lai) ⇒ phân loại của B và E' y hệt; đầu vào hàm thuần không còn chỗ nào để ngày ấy chen vào khoá K", () => {
    const b = donTT("b", NGAY("2026-10-10"));
    const e = donTT("e", NGAY("2026-10-12"), true);
    const mau = JSON.stringify([phanLoaiCua(b, [e]), phanLoaiCua(e, [b])]);
    for (const ngayKhai of ["2020-01-01", "2026-01-20", "2026-10-09", "2026-10-11", "2026-10-12", "2030-01-01"]) {
      const eKhai: LanMuaTruoc = { ...lanMuaCua(e), khoanThu: [khoan(5_000_000, NGAY(ngayKhai), "k-e")] };
      const bKhai: LanMuaTruoc = { ...lanMuaCua(b), khoanThu: [khoan(5_000_000, NGAY(ngayKhai), "k-b")] };
      const ra = JSON.stringify([phanLoaiGiaoDich(dau({ dong: dongCua(b), lanMuaTruoc: [eKhai], tau: MOC })), phanLoaiGiaoDich(dau({ dong: dongCua(e), lanMuaTruoc: [bKhai], tau: MOC }))]);
      expect(ra, ngayKhai).toBe(mau);
    }
  });

  it("[PLD-M6] tiền lệ CHẮC thắng đơn chưa kiểm chứng: đã có lần mua trước chắc chắn đã thu ⇒ RENEWAL bất kể đơn ghi bù; ngược lại tiền lệ chắc CHƯA chốt ⇒ PREVIOUS_PURCHASE_UNRESOLVED đứng trước", () => {
    const cu = donTT("cu", NGAY("2026-03-01"));
    const b = donTT("b", NGAY("2026-10-10"));
    const e = donTT("e", NGAY("2026-10-12"), true);
    expect(phanLoaiCua(b, [cu, e])).toMatchObject({ loai: "RENEWAL", maLuat: "PRIOR_PURCHASE" });
    const chuaChot = phanLoaiCua(b, [cu, e], { cu: false });
    expect(chuaChot).toMatchObject({ loai: "MANUAL_REVIEW", maLuat: "PREVIOUS_PURCHASE_UNRESOLVED" });
    expect(chuaChot.bangChung.lanMuaThuTuChuaKiemIds).toEqual(["oi-e"]); // vẫn nêu đơn chưa kiểm chứng để người xử lý thấy cả hai việc
  });

  it("[PLD-M7] đơn chưa kiểm chứng mà ĐÃ LOẠI (huỷ khi chưa từng thu) thì không cản: không có gì để đoán ⇒ B = NEW; còn nếu E' CHƯA thu (đang sống) thì vẫn giữ", () => {
    const b = donTT("b", NGAY("2026-10-10"));
    const e = donTT("e", NGAY("2026-10-12"), true);
    const eHuy: LanMuaTruoc = { ...lanMuaCua(e, false), daHuy: true, huyLuc: NGAY("2026-10-13"), trangThaiDon: "CANCELLED" };
    expect(phanLoaiGiaoDich(dau({ dong: dongCua(b), lanMuaTruoc: [eHuy], tau: MOC }))).toMatchObject({ loai: "NEW", maLuat: "FIRST_PURCHASE" });
    expect(phanLoaiCua(b, [e], { e: false })).toMatchObject({ loai: "MANUAL_REVIEW", maLuat: "BACKFILL_ORDER_TIME_UNVERIFIED" });
  });

  it("[PLD-M8] HOÁN VỊ: ba đơn (thường/ghi bù/thường) — mọi thứ tự mảng đầu vào cho đúng một kết quả cho từng đơn; hai đơn CÙNG giờ tạo phân xử bằng id, đổi id thì đổi vai", () => {
    const don = [donTT("a", NGAY("2026-10-10")), donTT("b", NGAY("2026-10-12"), true), donTT("c", NGAY("2026-10-14"))];
    for (const x of don) {
      const khac = don.filter((k) => k.orderId !== x.orderId);
      const chuan = JSON.stringify(phanLoaiCua(x, khac));
      for (const hv of hoanVi(khac)) expect(JSON.stringify(phanLoaiCua(x, hv)), `${x.orderId} ${hv.map((h) => h.orderId).join("")}`).toBe(chuan);
    }
    // Cùng giờ tạo (cả hai thường): id nhỏ hơn là lần mua trước; đổi id cho nhau thì đổi vai — và LUÔN có đúng một NEW một RENEWAL.
    for (const [idP, idQ] of [["don-a", "don-b"], ["don-b", "don-a"]] as const) {
      const p = donTT(idP, NGAY("2026-10-10"));
      const q = donTT(idQ, NGAY("2026-10-10"));
      const loai = [phanLoaiCua(p, [q]).loai, phanLoaiCua(q, [p]).loai].sort();
      expect(loai).toEqual(["NEW", "RENEWAL"]);
      expect(phanLoaiCua(donTT("don-a", NGAY("2026-10-10")), [donTT("don-b", NGAY("2026-10-10"))]).loai).toBe("NEW");
    }
    // Cùng giờ, một bên ghi bù: bên đứng sau theo id (bất kể là ai) mà chưa kiểm chứng ⇒ KHÔNG BIẾT; bên đứng sau mà thường ⇒ chắc.
    expect(quanHeLanMua(donTT("don-a", NGAY("2026-10-10"), true), donTT("don-b", NGAY("2026-10-10")))).toBe("TRUOC_CHAC");
    expect(quanHeLanMua(donTT("don-b", NGAY("2026-10-10"), true), donTT("don-a", NGAY("2026-10-10")))).toBe("KHONG_BIET");
  });

  it("[PLD-M9] nhiều khoản thu của cùng một đơn / đơn nhiều dòng KHÔNG đổi quan hệ: quan hệ là của ĐƠN, không của khoản — hai dòng cùng đơn không là tiền lệ của nhau", () => {
    const b = donTT("b", NGAY("2026-10-10"));
    const dongKhac = lanMuaCua({ ...b, orderItemId: "oi-b-2" }); // cùng đơn b
    expect(phanLoaiGiaoDich(dau({ dong: dongCua(b), lanMuaTruoc: [dongKhac], tau: MOC }))).toMatchObject({ loai: "NEW", maLuat: "FIRST_PURCHASE" });
    const e = donTT("e", NGAY("2026-10-12"), true);
    const nhieuKhoan: LanMuaTruoc = { ...lanMuaCua(e), khoanThu: [khoan(1_000_000, TTHU, "k1"), khoan(2_000_000, ms(TTHU, 86_400_000), "k2"), khoan(3_000_000, ms(TTHU, 2 * 86_400_000), "k3")] };
    expect(phanLoaiGiaoDich(dau({ dong: dongCua(b), lanMuaTruoc: [nhieuKhoan], tau: MOC }))).toMatchObject({ maLuat: "BACKFILL_ORDER_TIME_UNVERIFIED" });
  });

  it("[PLD-M10] thuần và tất định: gọi lặp ra y hệt, không sửa đầu vào", () => {
    const b = donTT("b", NGAY("2026-10-10"));
    const e = donTT("e", NGAY("2026-10-12"), true);
    const dauVao = dau({ dong: dongCua(b), lanMuaTruoc: [lanMuaCua(e)], tau: MOC });
    const truocKhi = JSON.stringify(dauVao);
    const r1 = phanLoaiGiaoDich(dauVao);
    expect(JSON.stringify(phanLoaiGiaoDich(dauVao))).toBe(JSON.stringify(r1));
    expect(JSON.stringify(dauVao)).toBe(truocKhi);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════
// [NKH] — LUẬT v4 (2026-10-17): phép so HUỶ / HOÀN của tiền lệ với τ KHÔNG tin ngày do người ghi khai.
//   Xếp tiền lệ bằng HAI cách đọc (ngày khai: `paidDate` + `tau` · giờ máy chủ: `ghiLuc` + `tauMay`). Cùng loại ⇒ dùng; khác loại ⇒ `PHU_THUOC_NGAY_KHAI` ⇒ giữ khoản, không đoán.
//   Bất biến: người khai ngày KHÔNG bao giờ làm ra NEW/RENEWAL khác với kết quả theo giờ máy chủ — chỉ ra đúng kết quả đó hoặc bị GIỮ.
//   Ngày TUYỆT ĐỐI (luật 19). `khoan(…)` mặc định `ghiLuc = paidDate` (dữ liệu trung thực); ca nào cần lệch thì truyền `ghiLuc` riêng.
// ═════════════════════════════════════════════════════════════════════════════════════════════
const HUY = NGAY("2026-09-20");
/** τ khai / τ máy chủ cho ca huỷ: «A còn sống tại τ» ⇔ τ < HUY (huỷ > τ). */
const TRUOC_HUY = NGAY("2026-09-15");
const SAU_HUY = NGAY("2026-09-25");
const DEP = ["MANUAL_REVIEW", "MANUAL_REVIEW_REQUIRED", "PRECEDENT_STATUS_DATE_DEPENDENT"];
const tt = (r: ReturnType<typeof phanLoaiGiaoDich>) => [r.loai, r.trangThai, r.maLuat];
/** A: đã thu rồi HUỶ lúc HUY (giờ máy chủ). B đang xét có τ khai `tau`, τ máy chủ `tauMay`. */
const caHuyNkh = (tau: Date | null, tauMay: Date | null, huyLuc: Date | null = HUY) =>
  phanLoaiGiaoDich(dau({ tau, tauMay, lanMuaTruoc: [truoc({ daHuy: true, huyLuc, trangThaiDon: "CANCELLED" })] }));

describe("[NKH] luật v4 — ngày thu / ngày hoàn do người ghi khai không quyết NEW/RENEWAL của tiền lệ đã thu rồi huỷ / hoàn", () => {
  it("[NKH-01] đối chứng DƯƠNG: hai cách đọc trùng nhau (dữ liệu trung thực) ⇒ y hệt luật cũ, KHÔNG thêm hold — huỷ SAU τ ⇒ RENEWAL; huỷ TRƯỚC τ ⇒ NEW", () => {
    const con = caHuyNkh(TRUOC_HUY, TRUOC_HUY);
    expect(tt(con)).toEqual(["RENEWAL", "CLASSIFIED", "PRIOR_PURCHASE"]);
    expect(con.bangChung.lanMuaPhuThuocNgayKhaiIds).toEqual([]);
    const chet = caHuyNkh(SAU_HUY, SAU_HUY);
    expect(tt(chet)).toEqual(["NEW", "CLASSIFIED", "FIRST_PURCHASE"]);
    expect(chet.bangChung.lanMuaLoaiBo).toEqual([{ orderItemId: "oi-cu", ma: "HUY_TRUOC_MOC" }]);
    expect(chet.bangChung.lanMuaPhuThuocNgayKhaiIds).toEqual([]);
  });

  it("[NKH-02] ca gốc §4: A thu rồi huỷ 20/09 — B khai thu 15/09 (A còn sống) nhưng máy chủ ghi 22/09 (A đã chết) ⇒ LỆCH ⇒ GIỮ PRECEDENT_STATUS_DATE_DEPENDENT, không RENEWAL 2%; bằng chứng nêu cả hai τ", () => {
    const r = caHuyNkh(TRUOC_HUY, NGAY("2026-09-22"));
    expect(tt(r)).toEqual(DEP);
    expect(r.bangChung.lanMuaPhuThuocNgayKhaiIds).toEqual(["oi-cu"]);
    expect(r.bangChung.lanMuaTruocIds).toEqual([]);
    expect(r.bangChung.lanMuaLoaiBo).toEqual([]);
    expect(r.bangChung.tau).toBe(TRUOC_HUY.toISOString());
    expect(r.bangChung.tauTheoGioMay).toBe(NGAY("2026-09-22").toISOString());
    expect(r.lyDo).toContain("o-cu");
  });

  it("[NKH-03] chiều ngược: B khai thu 25/09 (A đã chết ⇒ muốn thành NEW 9%) nhưng máy chủ ghi 18/09 (A còn sống) ⇒ LỆCH ⇒ GIỮ, không NEW", () => {
    const r = caHuyNkh(SAU_HUY, NGAY("2026-09-18"));
    expect(tt(r)).toEqual(DEP);
    expect(r.bangChung.lanMuaPhuThuocNgayKhaiIds).toEqual(["oi-cu"]);
  });

  it("[NKH-04] HOÀN SẠCH: tiền lệ thu +5tr rồi hoàn −5tr; ngày hoàn khai / giờ máy chủ ghi hoàn nằm hai phía τ ⇒ LỆCH ⇒ GIỮ (cả hai chiều); cùng phía ⇒ dùng kết quả chung", () => {
    const hoan = (khaiHoan: Date, ghiHoan: Date) =>
      phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ khoanThu: [khoan(5_000_000, TTHU, "k-thu"), { id: "k-hoan", paidDate: khaiHoan, amount: -5_000_000, ghiLuc: ghiHoan }] })] }));
    const truocTau = ms(MOC, -86_400_000);
    const sauTau = ms(MOC, 86_400_000);
    expect(tt(hoan(sauTau, truocTau))).toEqual(DEP); // khai hoàn MUỘN (A còn nguyên) · máy chủ ghi hoàn SỚM (A đã hoàn sạch)
    expect(tt(hoan(truocTau, sauTau))).toEqual(DEP); // khai hoàn SỚM (lùi để thành NEW 9%) · máy chủ ghi hoàn MUỘN
    expect(tt(hoan(truocTau, truocTau))).toEqual(["NEW", "CLASSIFIED", "FIRST_PURCHASE"]);
    expect(tt(hoan(sauTau, sauTau))).toEqual(["RENEWAL", "CLASSIFIED", "PRIOR_PURCHASE"]);
  });

  it("[NKH-05] hoán vị: thứ tự mảng khoản thu và mảng tiền lệ KHÔNG đổi kết quả (giữ lẫn quyết) — mọi hoán vị ra cùng một JSON", () => {
    const k1 = khoan(5_000_000, TTHU, "k1");
    const k2: KhoanThuLanMua = { id: "k2", paidDate: ms(MOC, 86_400_000), amount: -5_000_000, ghiLuc: ms(MOC, -86_400_000) }; // lệch
    const k3: KhoanThuLanMua = { id: "k3", paidDate: ms(MOC, -86_400_000), amount: -1_000, ghiLuc: ms(MOC, -86_400_000) };
    const hoanVi = <T,>(xs: readonly T[]): T[][] => (xs.length <= 1 ? [[...xs]] : xs.flatMap((x, i) => hoanVi([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
    const gio = (ks: KhoanThuLanMua[]) => JSON.stringify(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ khoanThu: ks })] })));
    const ra = hoanVi([k1, k2, k3]).map(gio);
    expect(new Set(ra).size).toBe(1);
    expect(JSON.parse(ra[0]!).maLuat).toBe("PRECEDENT_STATUS_DATE_DEPENDENT");
    // Hai tiền lệ: đổi thứ tự mảng tiền lệ cũng không đổi.
    const a = truoc({ khoanThu: [k1, k2] });
    const b = truoc({ orderItemId: "oi-cu2", orderId: "o-cu2", khoanThu: [khoan(5_000_000, TTHU, "kb")] });
    expect(JSON.stringify(phanLoaiGiaoDich(dau({ lanMuaTruoc: [a, b] })))).toBe(JSON.stringify(phanLoaiGiaoDich(dau({ lanMuaTruoc: [b, a] }))));
  });

  it("[NKH-06] đã có một tiền lệ CHẮC (cả hai cách đọc cùng ra TINH) ⇒ RENEWAL như cũ, kết quả không còn phụ thuộc tiền lệ mơ hồ; bằng chứng nêu cả hai", () => {
    const lech = truoc({ orderItemId: "oi-lech", orderId: "o-lech", daHuy: true, huyLuc: HUY, trangThaiDon: "CANCELLED" });
    const chac = truoc({ orderItemId: "oi-chac", orderId: "o-chac" });
    const r = phanLoaiGiaoDich(dau({ tau: TRUOC_HUY, tauMay: NGAY("2026-09-22"), lanMuaTruoc: [lech, chac] }));
    expect(tt(r)).toEqual(["RENEWAL", "CLASSIFIED", "PRIOR_PURCHASE"]);
    expect(r.bangChung.lanMuaTruocIds).toEqual(["oi-chac"]);
    expect(r.bangChung.lanMuaPhuThuocNgayKhaiIds).toEqual(["oi-lech"]);
  });

  it("[NKH-07] thứ tự các hold: tiền lệ CHƯA CHỐT đứng trước (tự nhả khi đơn ấy được thu / huỷ); hold phụ thuộc ngày khai đứng trước hold thứ-tự-mua-chưa-kiểm-chứng", () => {
    const lech = truoc({ orderItemId: "oi-lech", orderId: "o-lech", daHuy: true, huyLuc: HUY, trangThaiDon: "CANCELLED" });
    const chuaThu = truocChuaThu({ orderItemId: "oi-chua", orderId: "o-chua" });
    expect(phanLoaiGiaoDich(dau({ tau: TRUOC_HUY, tauMay: NGAY("2026-09-22"), lanMuaTruoc: [lech, chuaThu] })).maLuat).toBe("PREVIOUS_PURCHASE_UNRESOLVED");
    // đơn ghi bù đứng SAU dòng đang xét (thứ tự không kiểm chứng được) cùng lúc với một tiền lệ phụ thuộc ngày khai
    const ghiBu = truoc({ orderItemId: "oi-bu", orderId: "o-bu", taoLuc: ms(T1, 1000), gioTaoChuaKiem: true });
    expect(phanLoaiGiaoDich(dau({ tau: TRUOC_HUY, tauMay: NGAY("2026-09-22"), lanMuaTruoc: [lech, ghiBu] })).maLuat).toBe("PRECEDENT_STATUS_DATE_DEPENDENT");
  });

  it("[NKH-08] đơn chưa có khoản thu (tau = tauMay = null) ⇒ không có gì để lệch: tiền lệ đã hoàn sạch / huỷ vẫn LOẠI như luật v3, dù ngày khai và giờ máy chủ của khoản tiền lệ cách xa nhau", () => {
    const hoan: KhoanThuLanMua[] = [khoan(5_000_000, TTHU, "k-thu"), { id: "k-hoan", paidDate: ms(MOC, 999_999), amount: -5_000_000, ghiLuc: ms(MOC, -999_999) }];
    expect(tt(phanLoaiGiaoDich(dau({ tau: null, tauMay: null, lanMuaTruoc: [truoc({ khoanThu: hoan })] })))).toEqual(["NEW", "CLASSIFIED", "FIRST_PURCHASE"]);
    expect(tt(caHuyNkh(null, null))).toEqual(["NEW", "CLASSIFIED", "FIRST_PURCHASE"]);
  });

  it("[NKH-09] BẤT BIẾN: quét τ KHAI qua ±400 ngày (cả hai phía mọi mốc) với giờ máy chủ cố định ⇒ chỉ ra ĐÚNG kết quả theo giờ máy chủ hoặc bị GIỮ — không bao giờ ra kết quả ngược lại", () => {
    for (const [gioMay, dungTheoMay] of [[TRUOC_HUY, "RENEWAL"], [SAU_HUY, "NEW"]] as const) {
      const ketQuaTheoMay = tt(caHuyNkh(gioMay, gioMay))[0];
      expect(ketQuaTheoMay).toBe(dungTheoMay);
      let giu = 0;
      let quyet = 0;
      for (let ngay = -400; ngay <= 400; ngay += 1) {
        const khai = ms(HUY, ngay * 86_400_000);
        const r = caHuyNkh(khai, gioMay);
        const loai = tt(r)[0];
        expect([ketQuaTheoMay, "MANUAL_REVIEW"], `khai ${khai.toISOString()} / máy chủ ${gioMay.toISOString()}`).toContain(loai);
        if (loai === "MANUAL_REVIEW") {
          giu += 1;
          expect(r.maLuat).toBe("PRECEDENT_STATUS_DATE_DEPENDENT");
        } else quyet += 1;
      }
      // Cả hai kết cục đều xảy ra trong lưới quét (khai trùng phía với giờ máy chủ ⇒ quyết; ngược phía ⇒ giữ) — lưới không rỗng một nhánh.
      expect(giu).toBeGreaterThan(0);
      expect(quyet).toBeGreaterThan(0);
    }
    // Cùng bất biến cho NGÀY HOÀN do người khai (giờ máy chủ ghi hoàn cố định).
    for (const [ghiHoan, theoMay] of [[ms(MOC, -86_400_000), "NEW"], [ms(MOC, 86_400_000), "RENEWAL"]] as const) {
      for (let ngay = -400; ngay <= 400; ngay += 7) {
        const r = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ khoanThu: [khoan(5_000_000, TTHU, "k-thu"), { id: "k-hoan", paidDate: ms(MOC, ngay * 86_400_000), amount: -5_000_000, ghiLuc: ghiHoan }] })] }));
        expect([theoMay, "MANUAL_REVIEW"], `khai hoàn ${ngay} ngày quanh τ / ghi ${ghiHoan.toISOString()}`).toContain(r.loai);
      }
    }
  });

  it("[NKH-10] xepLanMuaTruocAnToan: hai cách đọc cùng LOẠI_BO nhưng khác mã ⇒ trả mã của GIỜ MÁY CHỦ (nhãn lưu vào bằng chứng không phụ thuộc ngày khai); khác loại ⇒ PHU_THUOC_NGAY_KHAI; thuần, không sửa đầu vào", () => {
    // huỷ lúc MOC+10: theo ngày khai (τ = MOC) huỷ SAU τ ⇒ không loại bằng huỷ, nhưng hoàn sạch (khai TRƯỚC τ) ⇒ HOAN_SACH_TRUOC_MOC;
    // theo giờ máy chủ (τ = MOC+20) huỷ TRƯỚC τ ⇒ HUY_TRUOC_MOC.
    const l = truoc({ daHuy: true, huyLuc: ms(MOC, 10), khoanThu: [khoan(5_000_000, TTHU, "k1"), { id: "k2", paidDate: ms(MOC, -5), amount: -5_000_000, ghiLuc: ms(MOC, 5) }] });
    const truocKhi = JSON.stringify(l);
    expect(xepLanMuaTruoc(l, MOC)).toEqual({ ket: "LOAI_BO", ma: "HOAN_SACH_TRUOC_MOC" });
    expect(xepLanMuaTruocAnToan(l, { tau: MOC, tauMay: ms(MOC, 20) })).toEqual({ ket: "LOAI_BO", ma: "HUY_TRUOC_MOC" });
    expect(xepLanMuaTruocAnToan(truoc(), { tau: MOC, tauMay: MOC })).toEqual({ ket: "TINH", ma: "DA_THU" });
    expect(xepLanMuaTruocAnToan(truocChuaThu(), { tau: MOC, tauMay: MOC })).toEqual({ ket: "CHUA_CHOT", ma: "CHUA_THU_CHUA_HUY" });
    expect(xepLanMuaTruocAnToan(truoc({ daHuy: true, huyLuc: HUY }), { tau: TRUOC_HUY, tauMay: SAU_HUY })).toEqual({ ket: "PHU_THUOC_NGAY_KHAI", ma: "PHU_THUOC_NGAY_KHAI" });
    expect(JSON.stringify(l)).toBe(truocKhi);
  });

  it("[NKH-11] «PH hiện hữu» dùng CÙNG vị từ: anh/chị có lần mua phụ thuộc ngày khai ⇒ null (KHÔNG BIẾT), không true cũng không false; có anh/chị khác đã thu chắc ⇒ true", () => {
    const ph = (lanMua: LanMuaTruoc[], tau: Date, tauMay: Date) =>
      tinhPhuHuynhHienHuu({
        tau,
        tauMay,
        dong: { orderItemId: "oi-moi", orderId: "o-moi", gioTaoChuaKiem: false, themMuon: false, taoLuc: T1 },
        ungVien: [{ studentId: "s-anh", cungLead: true, cungSdt: false, lanMua }],
        coDinhDanh: true,
      });
    const lech = truoc({ orderItemId: "oi-anh", orderId: "o-anh", daHuy: true, huyLuc: HUY, trangThaiDon: "CANCELLED" });
    expect(ph([lech], TRUOC_HUY, NGAY("2026-09-22"))).toEqual({ hienHuu: null, can: null });
    expect(ph([lech], SAU_HUY, SAU_HUY)).toEqual({ hienHuu: false, can: null }); // đối chứng: trung thực, A đã chết ⇒ không hiện hữu
    expect(ph([lech], TRUOC_HUY, TRUOC_HUY)).toEqual({ hienHuu: true, can: "CUNG_LEAD" }); // đối chứng: trung thực, A còn sống ⇒ hiện hữu
    expect(ph([lech, truoc({ orderItemId: "oi-anh2", orderId: "o-anh2" })], TRUOC_HUY, NGAY("2026-09-22")).hienHuu).toBe(true);
  });

  it("[NKH-12] đơn mà thứ tự mua KHÔNG kiểm chứng (ghi bù đứng sau) và lại là tiền lệ PHỤ THUỘC ngày khai KHÔNG được coi là «đã bị loại»: vẫn cản ⇒ BACKFILL_ORDER_TIME_UNVERIFIED, không NEW; đối chứng: loại ở CẢ HAI cách đọc thì không cản", () => {
    const ghiBuHuy = truoc({ orderItemId: "oi-bu", orderId: "o-bu", taoLuc: ms(T1, 1000), gioTaoChuaKiem: true, daHuy: true, huyLuc: HUY, trangThaiDon: "CANCELLED" });
    // ngày khai: huỷ ≤ τ ⇒ LOẠI BỎ; giờ máy chủ: huỷ > τ ⇒ TÍNH ⇒ lệch ⇒ không được coi là đã loại
    expect(phanLoaiGiaoDich(dau({ tau: SAU_HUY, tauMay: TRUOC_HUY, lanMuaTruoc: [ghiBuHuy] })).maLuat).toBe("BACKFILL_ORDER_TIME_UNVERIFIED");
    expect(phanLoaiGiaoDich(dau({ tau: TRUOC_HUY, tauMay: SAU_HUY, lanMuaTruoc: [ghiBuHuy] })).maLuat).toBe("BACKFILL_ORDER_TIME_UNVERIFIED");
    // đối chứng DƯƠNG: loại ở cả hai cách đọc ⇒ không cản ⇒ NEW
    expect(tt(phanLoaiGiaoDich(dau({ tau: SAU_HUY, tauMay: SAU_HUY, lanMuaTruoc: [ghiBuHuy] })))).toEqual(["NEW", "CLASSIFIED", "FIRST_PURCHASE"]);
  });

  it("[NKH-13] GHIM hệ quả đã biết: bút toán ĐIỀU CHỈNH (DELTA) mang `paidDate` của khoản GỐC nhưng được máy chủ ghi SAU — sửa số tiền của tiền lệ về 0 SAU khi B đã có tiền là «ngày khai ≤ τ, giờ ghi > τ» ⇒ lệch ⇒ GIỮ (luật v3 từng ra NEW). Sửa TRƯỚC khi B có tiền thì hai cách trùng ⇒ NEW", () => {
    const gocPaid = NGAY("2026-09-05");
    const dieuChinh = (ghiLuc: Date) => truoc({ khoanThu: [khoan(5_000_000, gocPaid, "k-goc"), { id: "k-delta", paidDate: gocPaid, amount: -5_000_000, ghiLuc }] });
    const sauKhiBCoTien = phanLoaiGiaoDich(dau({ tau: MOC, tauMay: MOC, lanMuaTruoc: [dieuChinh(ms(MOC, 86_400_000))] }));
    expect(tt(sauKhiBCoTien)).toEqual(DEP);
    expect(sauKhiBCoTien.bangChung.lanMuaPhuThuocNgayKhaiIds).toEqual(["oi-cu"]);
    expect(tt(phanLoaiGiaoDich(dau({ tau: MOC, tauMay: MOC, lanMuaTruoc: [dieuChinh(ms(MOC, -86_400_000))] })))).toEqual(["NEW", "CLASSIFIED", "FIRST_PURCHASE"]);
  });
});

/** Bỏ chú thích khối và chú thích dòng trước khi đếm chuỗi — chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm. */
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
