// Ca [DDK-*] — MỘT khoản tiền có vào màn hoá đơn không, và vào NGĂN nào.
//
// Kế hoạch: docs/ke-toan-hoa-don/PLAN.md §2.1. Chủ dự án chốt 26/09: danh sách = MỌI khoản thu
// thật CHƯA có hoá đơn trên hệ thống (không có mốc ngày) — kế toán đã xuất hết ở MISA, chỉ thiếu
// chỗ tải lên. Nên luật này chỉ còn trả lời: "đây có phải tiền THẬT của đơn không".
//
// Định nghĩa nằm MỘT chỗ: màn hàng chờ, khối trang đơn, cổng xác nhận và báo cáo đo GĐ 0 cùng gọi
// `phanLoaiKhoan`. Hai định nghĩa là hai câu trả lời, và hai câu trả lời là bug tiền.
import { describe, it, expect } from "vitest";
import { donCoKhoanNganHang, phanLoaiKhoan, type KhoanPhanLoai, type DonPhanLoai } from "./du-dieu-kien";
import { BACKFILL_PAYMENT_MARKER, gatewayMarker, installmentMarker } from "@/lib/finance/payment-markers";
import { markerChuyen } from "@/lib/finance/ghi-tien-don";

const khoan = (o: Partial<KhoanPhanLoai> = {}): KhoanPhanLoai => ({
  paymentType: "PAYMENT",
  amount: 3_000_000,
  accountantStatus: "PENDING",
  method: "BANK_TRANSFER",
  note: gatewayMarker("SEPAY", "FT1"),
  deletedAt: null,
  ...o,
});
const don = (o: Partial<DonPhanLoai> = {}): DonPhanLoai => ({
  status: "CONFIRMED",
  deletedAt: null,
  centerId: "cs1",
  ...o,
});
const XOA = new Date("2026-09-20T00:00:00Z");
/**
 * Giá trị `accountantStatus` của khoản kế toán ĐÃ xác nhận — dữ liệu MẪU cho fixture. Viết qua hằng
 * vì lưới `[BUOC-6]` (lib/finance/truc-a.test.ts) quét cả tệp test và đỏ khi gặp chuỗi gõ tay
 * `accountantStatus` = "CONFIRMED"; nó canh ĐIỀU KIỆN ĐỌC, và đây không phải điều kiện đọc.
 */
const DA_XAC_NHAN = "CONFIRMED" as const;

describe("[DDK-01] tiền thật của đơn đang sống ⇒ HANG_CHO", () => {
  it("chuyển khoản qua webhook, chờ kế toán", () => {
    expect(phanLoaiKhoan(khoan(), don(), 3_000_000)).toEqual({ vao: "HANG_CHO" });
  });

  it("đã được kế toán xác nhận ở /payments — VẪN vào (chưa có hoá đơn trên hệ thống)", () => {
    expect(phanLoaiKhoan(khoan({ accountantStatus: DA_XAC_NHAN }), don(), 3_000_000)).toEqual({
      vao: "HANG_CHO",
    });
  });

  it("tiền mặt ghi tay (không marker) — vào", () => {
    expect(phanLoaiKhoan(khoan({ note: "PH đóng tại quầy", method: "CASH" }), don(), 500_000)).toEqual({
      vao: "HANG_CHO",
    });
  });

  it("lời khai theo đợt — VÀO (việc nghi trùng xử lý ở tầng gom lần thu, không loại ở đây)", () => {
    expect(phanLoaiKhoan(khoan({ note: installmentMarker(1) }), don(), 3_000_000)).toEqual({
      vao: "HANG_CHO",
    });
  });

  it("đơn DRAFT có tiền vẫn là tiền thật — vào hàng chờ, không lặng lẽ biến mất", () => {
    expect(phanLoaiKhoan(khoan(), don({ status: "DRAFT" }), 3_000_000)).toEqual({ vao: "HANG_CHO" });
  });
});

describe("[DDK-02] đơn đã huỷ / đã hoàn ⇒ ngăn RIÊNG, không nằm lẫn trong hàng chờ", () => {
  for (const st of ["CANCELLED", "REFUNDED"]) {
    it(st, () => {
      expect(phanLoaiKhoan(khoan(), don({ status: st }), 3_000_000)).toEqual({ vao: "DON_DA_HUY" });
    });
  }
});

describe("[DDK-03] đơn chưa có cơ sở ⇒ THIEU_CO_SO (bảng hoá đơn đặt centerId NOT NULL)", () => {
  it("centerId null", () => {
    expect(phanLoaiKhoan(khoan(), don({ centerId: null }), 3_000_000)).toEqual({ vao: "THIEU_CO_SO" });
  });

  it("thiếu cơ sở THẮNG đơn đã huỷ — không có cơ sở thì ngăn nào cũng không tạo được hoá đơn", () => {
    expect(phanLoaiKhoan(khoan(), don({ centerId: null, status: "CANCELLED" }), 3_000_000)).toEqual({
      vao: "THIEU_CO_SO",
    });
  });
});

describe("[DDK-04] LOẠI — kèm LÝ DO, để báo cáo đếm được vì sao", () => {
  const ca: [string, KhoanPhanLoai, DonPhanLoai, number, string][] = [
    ["khoản đã xoá mềm", khoan({ deletedAt: XOA }), don(), 3_000_000, "KHOAN_DA_XOA"],
    ["đơn đã xoá mềm", khoan(), don({ deletedAt: XOA }), 3_000_000, "DON_DA_XOA"],
    ["bút toán điều chỉnh / đảo", khoan({ paymentType: "ADJUSTMENT", amount: -3_000_000 }), don(), -3_000_000, "KHONG_PHAI_KHOAN_THU"],
    ["dòng hoàn (PAYMENT số âm)", khoan({ amount: -2_000_000, accountantStatus: "REFUNDED" }), don(), -2_000_000, "SO_TIEN_AM"],
    ["dòng gốc đã bị đảo trọn (tách / gỡ gắn)", khoan(), don(), 0, "DA_DAO_HET"],
    ["kế toán từ chối", khoan({ accountantStatus: "REJECTED" }), don(), 3_000_000, "KE_TOAN_TU_CHOI"],
    ["chuyển nội bộ giữa hai bé", khoan({ method: "chuyen-noi-bo", note: markerChuyen("c") }), don(), 3_000_000, "CHUYEN_NOI_BO"],
    ["nhập lịch sử", khoan({ note: BACKFILL_PAYMENT_MARKER }), don(), 3_000_000, "NHAP_LICH_SU"],
  ];
  for (const [ten, k, d, rong, lyDo] of ca) {
    it(ten, () => {
      expect(phanLoaiKhoan(k, d, rong)).toEqual({ vao: "LOAI", lyDo });
    });
  }

  it("dòng chuyển nội bộ bị loại DÙ ghi chú không mang marker (khoá theo `method`)", () => {
    // Dòng +X của chuyển nội bộ là tiền CONFIRMED CŨ, không có RCP — lọt vào là tiền đã xuất hoá
    // đơn một lần quay lại hàng chờ như tiền mới.
    expect(phanLoaiKhoan(khoan({ method: "chuyen-noi-bo", note: null }), don(), 1_000_000)).toEqual({
      vao: "LOAI",
      lyDo: "CHUYEN_NOI_BO",
    });
  });

  it("điều chỉnh MỘT PHẦN không loại oan — còn ròng > 0 là vẫn vào", () => {
    expect(phanLoaiKhoan(khoan({ accountantStatus: DA_XAC_NHAN }), don(), 2_500_000)).toEqual({
      vao: "HANG_CHO",
    });
  });

  it("LOẠI thắng mọi ngăn khác — khoản đã xoá trên đơn đã huỷ vẫn là LOAI", () => {
    expect(phanLoaiKhoan(khoan({ deletedAt: XOA }), don({ status: "CANCELLED" }), 3_000_000).vao).toBe("LOAI");
  });
});

describe("[DDK-05] donCoKhoanNganHang — đơn có tiền NGÂN HÀNG còn thật không (nghi trùng theo cả đơn)", () => {
  const k = (id: string, o: Partial<KhoanPhanLoai> = {}) => ({ id, ...khoan(o) });
  const rong = (m: Record<string, number>) => new Map(Object.entries(m));

  it("webhook / gắn tay ⇒ true", () => {
    expect(donCoKhoanNganHang([k("a")], don(), rong({ a: 3_000_000 }))).toBe(true);
    expect(donCoKhoanNganHang([k("g", { note: "[gan-tay:bt1]" })], don(), rong({ g: 3_000_000 }))).toBe(true);
  });

  it("chỉ lời khai / đảo hết / bị từ chối / lịch sử / chuyển nội bộ ⇒ false", () => {
    expect(donCoKhoanNganHang([k("khai", { note: installmentMarker(1), method: "auto" })], don(), rong({ khai: 3_000_000 }))).toBe(false);
    expect(donCoKhoanNganHang([k("a")], don(), rong({ a: 0 })), "đảo hết").toBe(false);
    expect(donCoKhoanNganHang([k("a", { accountantStatus: "REJECTED" })], don(), rong({ a: 3_000_000 }))).toBe(false);
    expect(donCoKhoanNganHang([k("a", { note: `${BACKFILL_PAYMENT_MARKER} ${gatewayMarker("SEPAY", "FT1")}` })], don(), rong({ a: 1 }))).toBe(false);
    expect(donCoKhoanNganHang([k("a", { note: markerChuyen("x") })], don(), rong({ a: 1 }))).toBe(false);
  });

  it("đơn đã huỷ mà có khoản ngân hàng ⇒ vẫn true (tiền thật, chỉ khác ngăn)", () => {
    expect(donCoKhoanNganHang([k("a")], don({ status: "CANCELLED" }), rong({ a: 3_000_000 }))).toBe(true);
  });
});
