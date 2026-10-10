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
  tinhPhuHuynhHienHuu,
  type DauVaoPhanLoai,
  type GhiDanhPhanLoai,
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
const MOC = new Date("2026-09-15T03:00:00.000Z");

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

function truoc(p: Partial<LanMuaTruoc> = {}): LanMuaTruoc {
  return { orderItemId: "oi-cu", orderId: "o-cu", taoLuc: T0, daHuy: false, thucThu: 5_000_000, moHo: false, ...p };
}

function dau(p: Partial<DauVaoPhanLoai> = {}): DauVaoPhanLoai {
  return {
    dong: { orderItemId: "oi-moi", orderId: "o-moi", thanhPhan: "TUITION", trangThai: "ACTIVE", taoLuc: T1 },
    studentId: "s1",
    ghiDanh: ghiDanh(),
    lanMuaTruoc: [],
    ghiDanhMoCoi: [],
    phuHuynh: { hienHuu: false, can: null },
    coLead: true,
    moc: MOC,
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
        dong: { orderItemId: "oi-cu", orderId: "o-cu", thanhPhan: "TUITION", trangThai: "ACTIVE", taoLuc: T0 },
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

  it("[NHH-TRX-01c] lần mua trước đã hoàn sạch / đơn bị huỷ không tính là 'lần trước' ⇒ NEW; đối chứng lần mua thật ⇒ RENEWAL", () => {
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ thucThu: 0 })] })).loai).toBe("NEW");
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ thucThu: -1_000 })] })).loai).toBe("NEW");
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ daHuy: true })] })).loai).toBe("NEW");
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ thucThu: 1 })] })).loai).toBe("RENEWAL");
  });

  it("[NHH-TRX-01d] bé quay lại sau 1 năm nghỉ vẫn RENEWAL — không định nghĩa bằng thời gian nghỉ", () => {
    const xa = new Date("2025-01-10T03:00:00.000Z");
    expect(phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ taoLuc: xa })] })).loai).toBe("RENEWAL");
  });

  it("[NHH-TRX-01e] lịch sử MƠ HỒ (tiền của đơn nhiều dòng chưa gắn con) ⇒ xem tay, không đoán; có bằng chứng chắc thì RENEWAL thắng", () => {
    const mo = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ thucThu: 0, moHo: true })] }));
    expect(mo.loai).toBe("MANUAL_REVIEW");
    expect(mo.trangThai).toBe("MANUAL_REVIEW_REQUIRED");
    expect(mo.maLuat).toBe("LICH_SU_MO_HO");
    const chac = phanLoaiGiaoDich(
      dau({ lanMuaTruoc: [truoc({ thucThu: 0, moHo: true }), truoc({ orderItemId: "oi-chac", orderId: "o-chac" })] }),
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

  it("[NHH-TRX-01g] hai lần mua cùng giây: thứ tự quyết bằng id ⇒ đúng MỘT bên là RENEWAL (không cùng NEW, không cùng RENEWAL)", () => {
    const a = phanLoaiGiaoDich(
      dau({
        dong: { orderItemId: "oi-a", orderId: "o-a", thanhPhan: "TUITION", trangThai: "ACTIVE", taoLuc: T1 },
        lanMuaTruoc: [truoc({ orderItemId: "oi-b", orderId: "o-b", taoLuc: T1 })],
      }),
    );
    const b = phanLoaiGiaoDich(
      dau({
        dong: { orderItemId: "oi-b", orderId: "o-b", thanhPhan: "TUITION", trangThai: "ACTIVE", taoLuc: T1 },
        lanMuaTruoc: [truoc({ orderItemId: "oi-a", orderId: "o-a", taoLuc: T1 })],
      }),
    );
    expect([a.loai, b.loai].sort()).toEqual(["NEW", "RENEWAL"]);
    // Cấy 08/10 (đảo `<` thành `>` ở datTruoc): vẫn 'đúng một bên' nên ca trên xanh. Hướng PHẢI ghim — chú thích của hàm
    // nói "hoà giờ thì id NHỎ hơn đứng trước": oi-a là lần mua đầu (NEW), oi-b là lần sau (RENEWAL).
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
    const huy = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ thucThu: 0, moHo: true, daHuy: true })] }));
    expect(huy.loai).toBe("NEW");
    expect(huy.bangChung.lanMuaMoHoIds).toEqual([]);
    const song = phanLoaiGiaoDich(dau({ lanMuaTruoc: [truoc({ thucThu: 0, moHo: true, daHuy: false })] }));
    expect(song.maLuat).toBe("LICH_SU_MO_HO");
  });
});

describe("[NHH-TRX-04] con thứ hai của phụ huynh hiện hữu (04 §5.2, 01 Q-04)", () => {
  const anhChi = [
    { studentId: "s-anh", cungLead: true, cungSdt: false, lanMua: [truoc({ orderItemId: "oi-anh", orderId: "o-anh" })] },
  ];

  it("[NHH-TRX-04] bé 2 chưa từng mua ⇒ NEW (lịch sử theo HỌC VIÊN, không theo phụ huynh)", () => {
    const ph = tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: anhChi, coDinhDanh: true });
    const r = phanLoaiGiaoDich(dau({ phuHuynh: ph }));
    expect(r.loai).toBe("NEW");
  });

  it("[NHH-TRX-04b] bằng chứng phuHuynhHienHuu = true cho bé 2; đối chứng dương bé 1 (không ai mua trước) ⇒ false", () => {
    const be2 = tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: anhChi, coDinhDanh: true });
    expect(be2).toEqual({ hienHuu: true, can: "CUNG_LEAD" });
    expect(phanLoaiGiaoDich(dau({ phuHuynh: be2 })).bangChung.phuHuynhHienHuu).toEqual(be2);

    const be1 = tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: [], coDinhDanh: true });
    expect(be1).toEqual({ hienHuu: false, can: null });
  });

  it("[NHH-TRX-04c] cùng SĐT phụ huynh (không cùng lead) cũng tính; anh chị mua SAU hoặc đã hoàn sạch thì không", () => {
    const cungSdt = [{ studentId: "s-x", cungLead: false, cungSdt: true, lanMua: [truoc()] }];
    expect(tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: cungSdt, coDinhDanh: true })).toEqual({
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
    expect(tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: sau, coDinhDanh: true }).hienHuu).toBe(false);
    const hoan = [{ studentId: "s-x", cungLead: true, cungSdt: true, lanMua: [truoc({ thucThu: 0 })] }];
    expect(tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: hoan, coDinhDanh: true }).hienHuu).toBe(false);
  });

  it("[NHH-TRX-04e] anh/chị mua CÙNG ĐƠN với bé đang xét không làm phụ huynh thành 'hiện hữu' (cần lần mua ở ĐƠN KHÁC)", () => {
    // Cấy 08/10 (bỏ `l.orderId !== dong.orderId` trong bằng chứng PH hiện hữu): 0 ca đỏ.
    const cungDon = [{ studentId: "s-anh", cungLead: true, cungSdt: true, lanMua: [truoc({ orderItemId: "oi-anh", orderId: "o-moi" })] }];
    expect(tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: cungDon, coDinhDanh: true }).hienHuu).toBe(false);
    // đối chứng dương: cùng dữ liệu nhưng lần mua của anh/chị nằm ở đơn KHÁC ⇒ hiện hữu
    const donKhac = [{ studentId: "s-anh", cungLead: true, cungSdt: true, lanMua: [truoc({ orderItemId: "oi-anh", orderId: "o-anh" })] }];
    expect(tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: donKhac, coDinhDanh: true }).hienHuu).toBe(true);
  });

  it("[NHH-TRX-04d] không có lead lẫn SĐT phụ huynh hợp lệ ⇒ KHÔNG BIẾT (null), không khẳng định false", () => {
    expect(tinhPhuHuynhHienHuu({ dong: { orderItemId: "oi-moi", orderId: "o-moi", taoLuc: T1 }, ungVien: [], coDinhDanh: false })).toEqual({
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
      dau({ dong: { orderItemId: "p", orderId: "o", thanhPhan: "MATERIAL", trangThai: "ACTIVE", taoLuc: T1 } }),
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
      dau({ dong: { orderItemId: "oi-moi", orderId: "o-moi", thanhPhan: "TUITION", trangThai: "STOPPED", taoLuc: T1 } }),
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
        dau({ dong: { orderItemId: "p", orderId: "o", thanhPhan, trangThai: "ACTIVE", taoLuc: T1 } }),
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

/** Bỏ chú thích khối và chú thích dòng trước khi đếm chuỗi — chú thích giải thích bản vá hay chứa đúng chuỗi đang cấm. */
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
