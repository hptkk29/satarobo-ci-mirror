// Ca [CDC-*] — hoá đơn ĐÃ XÁC NHẬN nào "cần điều chỉnh".
//
// Kế hoạch §2.2: cờ này SUY RA lúc đọc, KHÔNG lưu cột — nếu lưu thì `refundPayment`,
// `adjustPayment` và huỷ đơn (ba đường tiền, diện R7) phải thêm một phép ghi mới. Suy ra thì không
// chạm đường tiền nào, và cờ tự hết khi hoá đơn bị HUỶ (GĐ 8 — quyết định (1) 27/09).
import { describe, it, expect } from "vitest";
import { canDieuChinh } from "./can-dieu-chinh";
import type { YeuCauHoanVao } from "./hoan-tien-don";
import { LY_DO_DA_XUAT_NGOAI, LY_DO_KHACH_KHONG_LAY } from "./ly-do-khong-xuat";

const XN = new Date("2026-09-20T03:00:00Z");
const TRUOC = new Date("2026-09-19T03:00:00Z");
const SAU = new Date("2026-09-21T03:00:00Z");

type Vao = Parameters<typeof canDieuChinh>[0];
const vao = (o: Partial<Vao> = {}): Vao => ({
  hoaDon: { trangThai: "DA_XAC_NHAN", xacNhanLuc: XN, tongTien: 3_000_000, lyDo: null, createdAt: TRUOC },
  khoan: [{ paymentId: "p1", soTien: 3_000_000 }],
  rongHienTai: new Map([["p1", 3_000_000]]),
  dongTroVao: [],
  trangThaiDon: "CONFIRMED",
  yeuCauHoan: [],
  phamViKhoan: [{ orderItemId: null, enrollmentId: null }],
  ...o,
});

describe("[CDC-01] hoá đơn sạch ⇒ không cần điều chỉnh", () => {
  it("không có gì đổi sau khi xác nhận", () => {
    expect(canDieuChinh(vao())).toEqual({ can: false, lyDo: [] });
  });

  it("bút toán tạo ĐÚNG lúc xác nhận không tính là 'sau khi xuất' (biên — chốt 26/09)", () => {
    // Phép cấy 26/09 (`>` → `>=`) để mọi ca XANH: không ca nào đặt đúng biên. Chốt: hoá đơn phản
    // ánh trạng thái TẠI `xacNhanLuc`, nên bút toán cùng mốc không kích lý do "sau khi xuất". Đây
    // không phải lỗ tiền: nếu bút toán ấy làm lệch số thì vế "số tiền hiện tại khác tổng" vẫn bắt.
    expect(
      canDieuChinh(vao({ dongTroVao: [{ adjustmentOfId: "p1", createdAt: new Date(XN), deletedAt: null }] })),
    ).toEqual({ can: false, lyDo: [] });
    const lech = canDieuChinh(
      vao({
        dongTroVao: [{ adjustmentOfId: "p1", createdAt: new Date(XN), deletedAt: null }],
        rongHienTai: new Map([["p1", 2_000_000]]),
      }),
    );
    expect(lech.can, "cùng mốc nhưng làm lệch số ⇒ vế so tổng vẫn bắt").toBe(true);
    expect(lech.lyDo).toHaveLength(1);
  });

  it("bút toán trỏ vào khoản TRƯỚC lúc xác nhận không tính (hoá đơn đã phản ánh nó)", () => {
    expect(
      canDieuChinh(vao({ dongTroVao: [{ adjustmentOfId: "p1", createdAt: TRUOC, deletedAt: null }] })).can,
    ).toBe(false);
  });
});

describe("[CDC-02] ba lý do cần điều chỉnh", () => {
  it("hoàn / điều chỉnh SAU khi xác nhận", () => {
    const r = canDieuChinh(
      vao({
        dongTroVao: [{ adjustmentOfId: "p1", createdAt: SAU, deletedAt: null }],
        rongHienTai: new Map([["p1", 1_000_000]]),
      }),
    );
    expect(r.can).toBe(true);
    expect(r.lyDo).toHaveLength(2); // có bút toán mới VÀ tổng đã lệch
  });

  it("đơn bị huỷ / hoàn sau khi xuất", () => {
    for (const st of ["CANCELLED", "REFUNDED"]) {
      expect(canDieuChinh(vao({ trangThaiDon: st })).can, st).toBe(true);
    }
  });

  it("số ròng hiện tại khác tổng trên hoá đơn (vd điều chỉnh không mang dấu thời gian đáng tin)", () => {
    expect(canDieuChinh(vao({ rongHienTai: new Map([["p1", 2_500_000]]) })).can).toBe(true);
  });

  it("bút toán đã XOÁ MỀM không tính", () => {
    expect(
      canDieuChinh(vao({ dongTroVao: [{ adjustmentOfId: "p1", createdAt: SAU, deletedAt: SAU }] })).can,
    ).toBe(false);
  });
});

describe("[CDC-03] khi nào KHÔNG hỏi", () => {
  it("hoá đơn chưa xác nhận / không xuất / đã bị thay ⇒ không bao giờ 'cần điều chỉnh'", () => {
    for (const trangThai of ["NHAP", "KHONG_XUAT", "THAY_THE"]) {
      expect(
        canDieuChinh(vao({ hoaDon: { trangThai, xacNhanLuc: null, tongTien: 3_000_000, lyDo: null, createdAt: TRUOC }, trangThaiDon: "CANCELLED" })).can,
        trangThai,
      ).toBe(false);
    }
  });

  it("hoá đơn ĐÃ HUỶ (THAY_THE) với đơn huỷ + tiền lệch ⇒ vẫn không — cờ tự hết khi huỷ (GĐ 8)", () => {
    const daHuy = vao({
      hoaDon: { trangThai: "THAY_THE", xacNhanLuc: XN, tongTien: 3_000_000, lyDo: null, createdAt: TRUOC },
      trangThaiDon: "CANCELLED",
      rongHienTai: new Map([["p1", 1_000_000]]),
      dongTroVao: [{ adjustmentOfId: "p1", createdAt: SAU, deletedAt: null }],
    });
    expect(canDieuChinh(daHuy)).toEqual({ can: false, lyDo: [] });
    // Đối chứng: đúng dữ liệu đó trên bản CÒN xác nhận ⇒ cần điều chỉnh, đủ ba lý do.
    const conXacNhan = canDieuChinh({ ...daHuy, hoaDon: { ...daHuy.hoaDon, trangThai: "DA_XAC_NHAN" } });
    expect(conXacNhan.can).toBe(true);
    expect(conXacNhan.lyDo).toHaveLength(3);
  });
});

describe("[CDC-09] bản đã huỷ không bao giờ 'cần điều chỉnh'", () => {
  it("THAY_THE ⇒ can=false, lyDo rỗng — kể cả khi mọi điều kiện kích đều đúng", () => {
    expect(
      canDieuChinh(
        vao({
          hoaDon: { trangThai: "THAY_THE", xacNhanLuc: XN, tongTien: 3_000_000, lyDo: null, createdAt: TRUOC },
          trangThaiDon: "REFUNDED",
          rongHienTai: new Map([["p1", 0]]),
        }),
      ),
    ).toEqual({ can: false, lyDo: [] });
  });
});

// ── 29/09 (chủ dự án chốt) ────────────────────────────────────────────────────────────────────────
const hoanDuyet = (lucDuyet: Date | null, o: Partial<YeuCauHoanVao> = {}): YeuCauHoanVao => ({
  id: "rr1",
  status: "APPROVED",
  soTien: 1_000_000,
  lucDuyet,
  createdAt: TRUOC,
  ten: "Bé An",
  phamVi: { orderItemIds: [], enrollmentIds: [] },
  ...o,
});

describe("[CDC-10] (Q1a) hoàn học phí qua /hoan-tien ĐÃ DUYỆT sau khi xác nhận ⇒ cần điều chỉnh", () => {
  it("duyệt SAU xacNhanLuc ⇒ can, câu nói số tiền + tên + việc tiếp (huỷ)", () => {
    const r = canDieuChinh(vao({ yeuCauHoan: [hoanDuyet(SAU)] }));
    expect(r.can).toBe(true);
    expect(r.lyDo).toEqual([
      "Đã duyệt hoàn 1.000.000đ cho Bé An ngày 21/09 — lập hoá đơn điều chỉnh ở MISA rồi huỷ và tải bản đúng",
    ]);
  });

  it("đối chứng âm: duyệt TRƯỚC xacNhanLuc / còn CHỜ / bị TỪ CHỐI ⇒ không", () => {
    expect(canDieuChinh(vao({ yeuCauHoan: [hoanDuyet(TRUOC)] })).can).toBe(false);
    expect(canDieuChinh(vao({ yeuCauHoan: [hoanDuyet(null, { status: "PENDING", createdAt: SAU })] })).can).toBe(false);
    expect(canDieuChinh(vao({ yeuCauHoan: [hoanDuyet(SAU, { status: "REJECTED" })] })).can).toBe(false);
  });

  it("ĐÃ CHI (PAID) sau mốc cũng tính — tiền đã ra khỏi túi khách thật", () => {
    expect(canDieuChinh(vao({ yeuCauHoan: [hoanDuyet(SAU, { status: "PAID" })] })).can).toBe(true);
  });
});

describe("[CDC-11] (Q3) KHONG_XUAT 'Đã xuất ngoài hệ thống' — mốc là lúc ĐÁNH DẤU (createdAt)", () => {
  const MOC_DANH_DAU = XN; // bản không xuất không có xacNhanLuc
  const xuatNgoai = (lyDo: string | null = LY_DO_DA_XUAT_NGOAI): Vao["hoaDon"] => ({
    trangThai: "KHONG_XUAT",
    xacNhanLuc: null,
    tongTien: 3_000_000,
    lyDo,
    createdAt: MOC_DANH_DAU,
  });

  it("bút toán trỏ vào khoản SAU lúc đánh dấu ⇒ can; TRƯỚC ⇒ không", () => {
    expect(canDieuChinh(vao({ hoaDon: xuatNgoai(), dongTroVao: [{ adjustmentOfId: "p1", createdAt: SAU, deletedAt: null }] })).can).toBe(true);
    expect(canDieuChinh(vao({ hoaDon: xuatNgoai(), dongTroVao: [{ adjustmentOfId: "p1", createdAt: TRUOC, deletedAt: null }] })).can).toBe(false);
  });

  it("Σ ròng khác tổng lúc đánh dấu ⇒ can", () => {
    expect(canDieuChinh(vao({ hoaDon: xuatNgoai(), rongHienTai: new Map([["p1", 2_000_000]]) })).can).toBe(true);
  });

  it("hoàn học phí duyệt SAU lúc đánh dấu ⇒ can, việc tiếp là GỠ DẤU (bản không xuất không có nút huỷ)", () => {
    const r = canDieuChinh(vao({ hoaDon: xuatNgoai(), yeuCauHoan: [hoanDuyet(SAU)] }));
    expect(r.lyDo).toEqual([
      "Đã duyệt hoàn 1.000.000đ cho Bé An ngày 21/09 — lập hoá đơn điều chỉnh ở MISA rồi gỡ dấu 'Đã xuất ngoài hệ thống' và tải bản đúng",
    ]);
  });

  it("sạch ⇒ không (đối chứng của ba ca trên)", () => {
    expect(canDieuChinh(vao({ hoaDon: xuatNgoai() }))).toEqual({ can: false, lyDo: [] });
  });

  it("đối chứng: lý do KHÁC ('Khách không lấy hoá đơn', 'Khác: …', null) với ĐÚNG dữ liệu kích ⇒ không bao giờ", () => {
    for (const lyDo of [LY_DO_KHACH_KHONG_LAY, "Khác: khách xin để sau", null]) {
      const r = canDieuChinh(
        vao({
          hoaDon: xuatNgoai(lyDo),
          dongTroVao: [{ adjustmentOfId: "p1", createdAt: SAU, deletedAt: null }],
          rongHienTai: new Map([["p1", 1_000_000]]),
          yeuCauHoan: [hoanDuyet(SAU)],
        }),
      );
      expect(r, String(lyDo)).toEqual({ can: false, lyDo: [] });
    }
  });

  it("đơn đã huỷ KHÔNG bật cờ cho bản 'đã xuất ngoài' (đánh dấu trên đơn huỷ là đường thường); bản đã xác nhận thì có", () => {
    expect(canDieuChinh(vao({ hoaDon: xuatNgoai(), trangThaiDon: "CANCELLED" })).can).toBe(false);
    expect(canDieuChinh(vao({ trangThaiDon: "CANCELLED" })).can).toBe(true);
  });
});

describe("[CDC-12] (29/09) cờ hoàn theo KHOẢN — hoàn cho bé khác cùng đơn không bật cờ hoá đơn này", () => {
  const cuaBeA = { orderItemIds: ["oi-a"], enrollmentIds: ["gd-a"] };
  it("hoá đơn chỉ chứa khoản bé B + hoàn bé A ⇒ không; khoản bé A ⇒ có; gộp cả hai ⇒ có", () => {
    const yc = [hoanDuyet(SAU, { phamVi: cuaBeA })];
    expect(canDieuChinh(vao({ yeuCauHoan: yc, phamViKhoan: [{ orderItemId: "oi-b", enrollmentId: "gd-b" }] }))).toEqual({ can: false, lyDo: [] });
    expect(canDieuChinh(vao({ yeuCauHoan: yc, phamViKhoan: [{ orderItemId: "oi-a", enrollmentId: "gd-a" }] })).can).toBe(true);
    expect(
      canDieuChinh(vao({ yeuCauHoan: yc, phamViKhoan: [{ orderItemId: "oi-b", enrollmentId: "gd-b" }, { orderItemId: "oi-a", enrollmentId: null }] })).can,
    ).toBe(true);
  });
  it("yêu cầu mơ hồ ⇒ theo cả đơn (bật cả ở hoá đơn bé B)", () => {
    expect(canDieuChinh(vao({ yeuCauHoan: [hoanDuyet(SAU)], phamViKhoan: [{ orderItemId: "oi-b", enrollmentId: "gd-b" }] })).can).toBe(true);
  });
});
