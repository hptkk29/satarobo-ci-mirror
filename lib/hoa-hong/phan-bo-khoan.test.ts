// @vitest-environment node
/**
 * [NHH-TRX-07] / [NHH-TRX-08] — tách THÀNH PHẦN và phân bổ xuống HỌC VIÊN của một khoản thu (04 §4.3, §4.4). THUẦN.
 * Ví dụ số: V7 của 04 (đơn 10tr học phí + 2tr kit).
 */
import { describe, it, expect } from "vitest";

import { phanBoKhoan, soDongHocPhi, type DauVaoPhanBo, type DongDonPhanBo } from "./phan-bo-khoan";

const dong = (id: string, loai: string, p: Partial<DongDonPhanBo> = {}): DongDonPhanBo => ({
  orderItemId: id,
  loai,
  enrollmentId: null,
  studentId: null,
  enrollmentStudentId: null,
  ...p,
});

function dau(p: Partial<DauVaoPhanBo> = {}): DauVaoPhanBo {
  return {
    soTien: 10_000_000,
    orderItemId: null,
    enrollmentId: null,
    enrollmentStudentId: null,
    orderType: "COURSE",
    dongDon: [dong("oi-hp", "COURSE_ENROLLMENT", { studentId: "hv-1" })],
    hocVienTheoLeadChild: null,
    conNoTheoDong: new Map(),
    ...p,
  };
}

describe("[NHH-TRX-07] thành phần — chỉ HỌC PHÍ đi tiếp (D17)", () => {
  it("khoản gắn dòng học phí ⇒ TUITION, cách tách DONG, học viên của dòng", () => {
    expect(phanBoKhoan(dau({ orderItemId: "oi-hp" }))).toEqual({
      loai: "TACH",
      orderItemId: "oi-hp",
      thanhPhan: "TUITION",
      cachTach: "DONG",
      studentId: "hv-1",
    });
  });

  it("khoản gắn dòng HỌC CỤ (PRODUCT) ⇒ ngoài phạm vi, KHÔNG tính hoa hồng", () => {
    const r = phanBoKhoan(
      dau({ orderItemId: "oi-kit", dongDon: [dong("oi-hp", "COURSE_ENROLLMENT", { studentId: "hv-1" }), dong("oi-kit", "PRODUCT")] }),
    );
    expect(r).toMatchObject({ loai: "NGOAI_PHAM_VI", thanhPhan: "MATERIAL", cachTach: "DONG" });
  });

  it("lệ phí thi / phí học bù ⇒ OTHER, ngoài phạm vi", () => {
    for (const loai of ["EXAM_REGISTRATION", "MAKEUP_FEE"]) {
      const r = phanBoKhoan(dau({ orderItemId: "x", dongDon: [dong("x", loai)] }));
      expect(r).toMatchObject({ loai: "NGOAI_PHAM_VI", thanhPhan: "OTHER" });
    }
  });

  it("dòng có loại LẠ ⇒ giữ PENDING_REGULATION (không tự coi là học phí, không tự coi là ngoài phạm vi)", () => {
    const r = phanBoKhoan(dau({ orderItemId: "x", dongDon: [dong("x", "LOAI_MOI_CHUA_BIET")] }));
    expect(r).toMatchObject({ loai: "GIU", ma: "PENDING_REGULATION" });
  });

  it("khoản không gắn, mọi dòng cùng một thành phần ⇒ MOT_THANH_PHAN, dòng duy nhất", () => {
    expect(phanBoKhoan(dau())).toEqual({
      loai: "TACH",
      orderItemId: "oi-hp",
      thanhPhan: "TUITION",
      cachTach: "MOT_THANH_PHAN",
      studentId: "hv-1",
    });
    expect(phanBoKhoan(dau({ dongDon: [dong("oi-kit", "PRODUCT")], orderType: "PRODUCT" }))).toMatchObject({ loai: "NGOAI_PHAM_VI", thanhPhan: "MATERIAL" });
  });
});

describe("[NHH-TRX-07] V7 — đơn trộn 10tr học phí + 2tr kit, khoản KHÔNG gắn dòng (04 §4.3 bước 3–4)", () => {
  const don = [dong("oi-hp", "COURSE_ENROLLMENT", { studentId: "hv-1" }), dong("oi-kit", "PRODUCT")];

  it("(a) học phí đã thu đủ, kit còn nợ 2tr, khoản 2tr ⇒ CON_NO_DUY_NHAT = kit ⇒ ngoài phạm vi (0đ hoa hồng, không phải 66.667đ)", () => {
    const r = phanBoKhoan(dau({ soTien: 2_000_000, dongDon: don, conNoTheoDong: new Map([["oi-hp", 0], ["oi-kit", 2_000_000]]) }));
    expect(r).toMatchObject({ loai: "NGOAI_PHAM_VI", thanhPhan: "MATERIAL", cachTach: "CON_NO_DUY_NHAT" });
  });

  it("(a') đối chứng dương: học phí còn nợ, kit đã đủ ⇒ khoản rơi vào HỌC PHÍ", () => {
    const r = phanBoKhoan(dau({ soTien: 4_000_000, dongDon: don, conNoTheoDong: new Map([["oi-hp", 10_000_000], ["oi-kit", 0]]) }));
    expect(r).toMatchObject({ loai: "TACH", orderItemId: "oi-hp", thanhPhan: "TUITION", cachTach: "CON_NO_DUY_NHAT", studentId: "hv-1" });
  });

  it("(b) khoản 6tr không gắn, CẢ HAI còn nợ ⇒ hàng chờ CHUA_GAN_CON (không chia theo giá, không đoán)", () => {
    const r = phanBoKhoan(dau({ soTien: 6_000_000, dongDon: don, conNoTheoDong: new Map([["oi-hp", 10_000_000], ["oi-kit", 2_000_000]]) }));
    expect(r).toMatchObject({ loai: "GIU", ma: "CHUA_GAN_CON" });
  });

  it("khoản LỚN HƠN phần còn nợ của thành phần duy nhất còn nợ ⇒ không đoán, CHUA_GAN_CON", () => {
    const r = phanBoKhoan(dau({ soTien: 3_000_000, dongDon: don, conNoTheoDong: new Map([["oi-hp", 0], ["oi-kit", 2_000_000]]) }));
    expect(r).toMatchObject({ loai: "GIU", ma: "CHUA_GAN_CON" });
  });

  it("không còn nợ thành phần nào (đóng thừa) ⇒ CHUA_GAN_CON", () => {
    const r = phanBoKhoan(dau({ soTien: 1_000, dongDon: don, conNoTheoDong: new Map([["oi-hp", 0], ["oi-kit", 0]]) }));
    expect(r).toMatchObject({ loai: "GIU", ma: "CHUA_GAN_CON" });
  });
});

describe("[NHH-TRX-08] học viên (04 §4.4)", () => {
  it("dòng chưa có studentId nhưng ghi danh của dòng có học viên ⇒ lấy của ghi danh", () => {
    const r = phanBoKhoan(dau({ orderItemId: "oi-hp", dongDon: [dong("oi-hp", "COURSE_ENROLLMENT", { enrollmentStudentId: "hv-ghi-danh" })] }));
    expect(r).toMatchObject({ loai: "TACH", studentId: "hv-ghi-danh" });
  });

  it("dòng chưa có học viên, đơn có leadChild khớp ĐÚNG MỘT Student ⇒ dùng học viên đó", () => {
    const r = phanBoKhoan(dau({ orderItemId: "oi-hp", dongDon: [dong("oi-hp", "COURSE_ENROLLMENT")], hocVienTheoLeadChild: "hv-lc" }));
    expect(r).toMatchObject({ loai: "TACH", studentId: "hv-lc" });
  });

  it("dòng đã xác định nhưng chưa có Student ở đâu cả (đơn tạo trước convert) ⇒ CHO_HOC_VIEN (mềm, tự giải khi có Student)", () => {
    const r = phanBoKhoan(dau({ orderItemId: "oi-hp", dongDon: [dong("oi-hp", "COURSE_ENROLLMENT")] }));
    expect(r).toMatchObject({ loai: "GIU", ma: "CHO_HOC_VIEN" });
  });

  it("đơn NHIỀU dòng học phí, khoản chưa gắn con ⇒ CHUA_GAN_CON — không chia tỉ lệ cho các bé", () => {
    const r = phanBoKhoan(
      dau({ dongDon: [dong("oi-a", "COURSE_ENROLLMENT", { studentId: "hv-a" }), dong("oi-b", "COURSE_ENROLLMENT", { studentId: "hv-b" })] }),
    );
    expect(r).toMatchObject({ loai: "GIU", ma: "CHUA_GAN_CON" });
  });

  it("khoản gắn ghi danh (không gắn dòng) khớp ĐÚNG MỘT dòng học phí ⇒ dòng đó", () => {
    const r = phanBoKhoan(
      dau({
        enrollmentId: "gd-b",
        dongDon: [dong("oi-a", "COURSE_ENROLLMENT", { enrollmentId: "gd-a", studentId: "hv-a" }), dong("oi-b", "COURSE_ENROLLMENT", { enrollmentId: "gd-b", studentId: "hv-b" })],
      }),
    );
    expect(r).toMatchObject({ loai: "TACH", orderItemId: "oi-b", studentId: "hv-b", cachTach: "DONG" });
  });

  it("khoản gắn ghi danh mà ghi danh không khớp dòng nào, đơn nhiều dòng ⇒ học viên của ghi danh, ô không gắn dòng", () => {
    const r = phanBoKhoan(
      dau({
        enrollmentId: "gd-x",
        enrollmentStudentId: "hv-x",
        dongDon: [dong("oi-a", "COURSE_ENROLLMENT", { studentId: "hv-a" }), dong("oi-b", "COURSE_ENROLLMENT", { studentId: "hv-b" })],
      }),
    );
    expect(r).toMatchObject({ loai: "TACH", orderItemId: null, studentId: "hv-x" });
  });

  it("orderItemId trỏ dòng KHÔNG thuộc đơn ⇒ CHUA_GAN_CON (không đoán)", () => {
    expect(phanBoKhoan(dau({ orderItemId: "oi-la" }))).toMatchObject({ loai: "GIU", ma: "CHUA_GAN_CON" });
  });
});

describe("đơn KHÔNG có dòng nào — lùi về loại đơn (04 §4.3)", () => {
  const khong = (orderType: string, p: Partial<DauVaoPhanBo> = {}) => phanBoKhoan(dau({ dongDon: [], orderType, ...p }));
  it("COURSE/PACKAGE ⇒ học phí; PRODUCT ⇒ học cụ (ngoài); EXAM ⇒ OTHER (ngoài)", () => {
    expect(khong("COURSE", { enrollmentStudentId: "hv-e", enrollmentId: "gd" })).toMatchObject({ loai: "TACH", thanhPhan: "TUITION", orderItemId: null, studentId: "hv-e" });
    expect(khong("PACKAGE", { hocVienTheoLeadChild: "hv-lc" })).toMatchObject({ loai: "TACH", studentId: "hv-lc" });
    expect(khong("PRODUCT")).toMatchObject({ loai: "NGOAI_PHAM_VI", thanhPhan: "MATERIAL" });
    expect(khong("EXAM")).toMatchObject({ loai: "NGOAI_PHAM_VI", thanhPhan: "OTHER" });
  });
  it("COMBO không dòng ⇒ PENDING_REGULATION (không có văn bản nói phần nào là học phí)", () => {
    expect(khong("COMBO")).toMatchObject({ loai: "GIU", ma: "PENDING_REGULATION" });
  });
  it("học phí mà không ra học viên ⇒ CHUA_GAN_CON", () => {
    expect(khong("COURSE")).toMatchObject({ loai: "GIU", ma: "CHUA_GAN_CON" });
  });
});

describe("[NHH-TRX-SIB-01p] 'bé trên đơn' (Order.leadChildId) chỉ nói thay được cho dòng khi đơn có ĐÚNG MỘT dòng học phí (audit XII · GAP-1)", () => {
  const haiDongHocPhi = [dong("oi-a", "COURSE_ENROLLMENT", { studentId: "hv-a" }), dong("oi-b", "COURSE_ENROLLMENT")];

  it("[NHH-TRX-SIB-01p-1] đơn HAI dòng học phí, dòng B chưa có học viên, bé trên đơn là A ⇒ dòng B KHÔNG được gán cho A: CHO_HOC_VIEN", () => {
    const r = phanBoKhoan(dau({ orderItemId: "oi-b", dongDon: haiDongHocPhi, hocVienTheoLeadChild: "hv-a" }));
    expect(r).toMatchObject({ loai: "GIU", ma: "CHO_HOC_VIEN" });
  });

  it("[NHH-TRX-SIB-01p-2] cùng ca nhưng khoản đi qua nhánh ghi danh (không gắn dòng, ghi danh khớp đúng dòng B) ⇒ cũng CHO_HOC_VIEN", () => {
    const r = phanBoKhoan(
      dau({
        enrollmentId: "gd-b",
        dongDon: [dong("oi-a", "COURSE_ENROLLMENT", { studentId: "hv-a" }), dong("oi-b", "COURSE_ENROLLMENT", { enrollmentId: "gd-b" })],
        hocVienTheoLeadChild: "hv-a",
      }),
    );
    expect(r).toMatchObject({ loai: "GIU", ma: "CHO_HOC_VIEN" });
  });

  it("[NHH-TRX-SIB-01p-3] ĐỐI CHỨNG DƯƠNG: đơn MỘT dòng học phí (+ một dòng học cụ) ⇒ vẫn phân giải được qua bé trên đơn", () => {
    const r = phanBoKhoan(
      dau({ orderItemId: "oi-hp", dongDon: [dong("oi-hp", "COURSE_ENROLLMENT"), dong("oi-kit", "PRODUCT")], hocVienTheoLeadChild: "hv-lc" }),
    );
    expect(r).toMatchObject({ loai: "TACH", studentId: "hv-lc", orderItemId: "oi-hp" });
  });

  it("[NHH-TRX-SIB-01p-4] đơn hai dòng học phí mà dòng B ĐÃ có học viên ⇒ dùng học viên của dòng (bé trên đơn không can thiệp)", () => {
    const r = phanBoKhoan(
      dau({
        orderItemId: "oi-b",
        dongDon: [dong("oi-a", "COURSE_ENROLLMENT", { studentId: "hv-a" }), dong("oi-b", "COURSE_ENROLLMENT", { studentId: "hv-b" })],
        hocVienTheoLeadChild: "hv-a",
      }),
    );
    expect(r).toMatchObject({ loai: "TACH", studentId: "hv-b" });
  });

  it("[NHH-TRX-SIB-01p-6] đơn TRỘN (2 dòng học phí + học cụ), khoản chưa gắn dòng, chỉ MỘT dòng học phí còn nợ mà dòng đó chưa có học viên ⇒ KHÔNG gán cho bé trên đơn: CHO_HOC_VIEN (nhánh 5 cũng phải qua cổng)", () => {
    const r = phanBoKhoan(
      dau({
        soTien: 3_000_000,
        dongDon: [dong("oi-a", "COURSE_ENROLLMENT", { studentId: "hv-a" }), dong("oi-b", "COURSE_ENROLLMENT"), dong("oi-kit", "PRODUCT")],
        hocVienTheoLeadChild: "hv-a",
        conNoTheoDong: new Map([["oi-b", 5_000_000]]),
      }),
    );
    expect(r).toMatchObject({ loai: "GIU", ma: "CHO_HOC_VIEN" });
  });

  it("[NHH-TRX-SIB-01p-7] đối chứng dương của nhánh 5: CHỈ MỘT dòng học phí (+ học cụ), còn nợ ở dòng đó ⇒ vẫn phân giải qua bé trên đơn", () => {
    const r = phanBoKhoan(
      dau({
        soTien: 3_000_000,
        dongDon: [dong("oi-b", "COURSE_ENROLLMENT"), dong("oi-kit", "PRODUCT")],
        hocVienTheoLeadChild: "hv-lc",
        conNoTheoDong: new Map([["oi-b", 5_000_000]]),
      }),
    );
    expect(r).toMatchObject({ loai: "TACH", studentId: "hv-lc", cachTach: "CON_NO_DUY_NHAT" });
  });
  it("[NHH-TRX-SIB-01p-5] soDongHocPhi: chỉ đếm TUITION (học cụ / lệ phí / loại lạ không tính)", () => {
    expect(soDongHocPhi([dong("a", "COURSE_ENROLLMENT"), dong("b", "COURSE_PACKAGE"), dong("c", "PRODUCT"), dong("d", "MAKEUP_FEE"), dong("e", "LOAI_LA")])).toBe(2);
    expect(soDongHocPhi([])).toBe(0);
  });
});
