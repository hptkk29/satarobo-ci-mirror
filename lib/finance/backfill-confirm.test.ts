import { describe, it, expect } from "vitest";
import { BACKFILL_PAYMENT_MARKER, installmentMarker } from "./payment-markers";
import { LY_DO_BO, lapKeHoachXacNhan, nenXacNhanHangLoat } from "./backfill-confirm";
import { KHOAN_DA_XAC_NHAN } from "./debt";

const ACTOR = "u-ketoan";

const khoan = (over: Partial<Parameters<typeof nenXacNhanHangLoat>[0]> = {}) => ({
  id: "p1",
  note: `Nhập liệu ban đầu ${BACKFILL_PAYMENT_MARKER}`,
  accountantStatus: "PENDING",
  enrollmentId: "e1",
  recordedById: "u-sale",
  amount: 9_000_000,
  loaiDon: "COURSE",
  ...over,
});

describe("[BF-01] chỉ nhận khoản NHẬP LIỆU BAN ĐẦU", () => {
  it("khoản backfill đủ điều kiện → nhận", () => {
    expect(nenXacNhanHangLoat(khoan(), ACTOR)).toEqual({ nhan: true });
  });

  it("khoản của kế hoạch đợt → KHÔNG nhận", () => {
    // Lượt hàng loạt này CHỈ dành cho dữ liệu cũ. Quét cả khoản tự sinh của kế hoạch là
    // xác nhận mù tiền của nghiệp vụ đang chạy.
    const r = nenXacNhanHangLoat(khoan({ note: `Đợt 1 ${installmentMarker(1)}` }), ACTOR);
    expect(r).toEqual({ nhan: false, lyDo: LY_DO_BO.KHONG_PHAI_BACKFILL });
  });

  it("khoản kế toán gõ tay (không marker) → KHÔNG nhận", () => {
    expect(nenXacNhanHangLoat(khoan({ note: "CK Vietcombank 05/09" }), ACTOR).nhan).toBe(false);
    expect(nenXacNhanHangLoat(khoan({ note: null }), ACTOR).nhan).toBe(false);
  });
});

describe("[BF-02] giữ NGUYÊN mọi cổng của confirmPayment", () => {
  it("đã xử lý rồi → bỏ, không xác nhận lại", () => {
    for (const st of ["CONFIRMED", "REJECTED", "REFUNDED", "ADJUSTED"]) {
      expect(nenXacNhanHangLoat(khoan({ accountantStatus: st }), ACTOR)).toEqual({
        nhan: false,
        lyDo: LY_DO_BO.DA_XU_LY,
      });
    }
  });

  it("chưa gắn ghi danh → bỏ (confirmPayment không sinh được phiếu thu)", () => {
    expect(nenXacNhanHangLoat(khoan({ enrollmentId: null }), ACTOR)).toEqual({
      nhan: false,
      lyDo: LY_DO_BO.CHUA_GAN_GHI_DANH,
    });
  });

  it("TÁCH NHIỆM VỤ — người ghi nhận không tự xác nhận được, kể cả ở lượt hàng loạt", () => {
    // Đây là cổng dễ bị "tối ưu cho tiện" nhất. Bỏ nó là bỏ lớp kiểm soát duy nhất giữa
    // người nhập tiền và người xác nhận tiền.
    expect(nenXacNhanHangLoat(khoan({ recordedById: ACTOR }), ACTOR)).toEqual({
      nhan: false,
      lyDo: LY_DO_BO.TU_XAC_NHAN,
    });
  });

  it("số tiền rác → bỏ", () => {
    expect(nenXacNhanHangLoat(khoan({ amount: 0 }), ACTOR).nhan).toBe(false);
    expect(nenXacNhanHangLoat(khoan({ amount: -1 }), ACTOR).nhan).toBe(false);
    expect(nenXacNhanHangLoat(khoan({ amount: Number.NaN }), ACTOR).nhan).toBe(false);
  });
});

describe("[BF-03] lapKeHoachXacNhan — màn xem thử phải nói được SỐ", () => {
  it("chia nhận/bỏ, cộng tổng, đếm theo lý do", () => {
    const plan = lapKeHoachXacNhan(
      [
        khoan({ id: "a", amount: 9_000_000 }),
        khoan({ id: "b", amount: 1_000_000 }),
        khoan({ id: "c", enrollmentId: null, amount: 5_000_000 }),
        khoan({ id: "d", recordedById: ACTOR, amount: 7_000_000 }),
        khoan({ id: "e", accountantStatus: KHOAN_DA_XAC_NHAN.accountantStatus, amount: 2_000_000 }),
      ],
      ACTOR,
    );
    expect(plan.nhan.map((p) => p.id)).toEqual(["a", "b"]);
    expect(plan.tongNhan).toBe(10_000_000);
    expect(plan.bo).toHaveLength(3);
    expect(plan.demTheoLyDo[LY_DO_BO.CHUA_GAN_GHI_DANH]).toBe(1);
    expect(plan.demTheoLyDo[LY_DO_BO.TU_XAC_NHAN]).toBe(1);
    expect(plan.demTheoLyDo[LY_DO_BO.DA_XU_LY]).toBe(1);
  });

  it("ca ĐỘI NHỎ — người nhập chính là người xác nhận ⇒ BỎ HẾT, và nói ra", () => {
    // Khả năng cao nhất trong thực tế. Màn PHẢI hiện con số này chứ không báo "xong 0
    // khoản" rồi thôi — người vận hành cần biết VÌ SAO để đổi người xác nhận.
    const plan = lapKeHoachXacNhan(
      [khoan({ id: "a", recordedById: ACTOR }), khoan({ id: "b", recordedById: ACTOR })],
      ACTOR,
    );
    expect(plan.nhan).toHaveLength(0);
    expect(plan.demTheoLyDo[LY_DO_BO.TU_XAC_NHAN]).toBe(2);
  });

  it("danh sách rỗng → không lỗi", () => {
    const plan = lapKeHoachXacNhan([], ACTOR);
    expect(plan).toEqual({ nhan: [], bo: [], tongNhan: 0, demTheoLyDo: {} });
  });
});

describe("[BF-04] đơn KIT / THI không có ghi danh — cùng luật `thieuGhiDanh` với lõi xác nhận", () => {
  for (const loaiDon of ["PRODUCT", "EXAM"]) {
    it(`${loaiDon} chưa gắn ghi danh ⇒ NHẬN (confirmPayment cấp phiếu enrollmentId = null)`, () => {
      expect(nenXacNhanHangLoat(khoan({ enrollmentId: null, loaiDon }), ACTOR)).toEqual({ nhan: true });
    });
  }

  it("đối chứng: COURSE / loại lạ / không có đơn chưa gắn ghi danh ⇒ VẪN bỏ (fail-closed)", () => {
    for (const loaiDon of ["COURSE", "PACKAGE", null]) {
      expect(nenXacNhanHangLoat(khoan({ enrollmentId: null, loaiDon }), ACTOR)).toEqual({
        nhan: false,
        lyDo: LY_DO_BO.CHUA_GAN_GHI_DANH,
      });
    }
  });

  it("KIT vẫn giữ cổng TÁCH NHIỆM VỤ — miễn ghi danh không miễn cổng khác", () => {
    expect(
      nenXacNhanHangLoat(khoan({ enrollmentId: null, loaiDon: "PRODUCT", recordedById: ACTOR }), ACTOR),
    ).toEqual({ nhan: false, lyDo: LY_DO_BO.TU_XAC_NHAN });
  });
});
