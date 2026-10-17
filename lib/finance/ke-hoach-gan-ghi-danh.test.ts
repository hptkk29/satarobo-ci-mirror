// Ca [KHGD-*] — kế hoạch gắn ghi danh cho khoản chưa gắn (GĐ 8b, `ke-hoach-gan-ghi-danh.ts`). THUẦN.
//
// Fixture mang HÌNH DẠNG THẬT của luồng lead: dòng đơn lập từ `/orders/new?leadId=` có `studentId`
// NULL + `metadata.courseId` (học viên chỉ ra đời ở bước chuyển đổi) — `[KHGD-02]`.
import { describe, expect, it } from "vitest";
import {
  dauKeHoachGan,
  lapKeHoachGanGhiDanh,
  type GhiDanhUngVien,
  type KhoanChuaGan,
} from "./ke-hoach-gan-ghi-danh";
import type { DongDonCoHocVien } from "./chia-khoan-theo-don";

// Trạng thái kế toán dựng bằng hằng — lưới `truc-a` quét cả tệp test.
const DA_XAC_NHAN = "CONFIRMED";

const khoan = (o: Partial<KhoanChuaGan> & { id: string }): KhoanChuaGan => ({
  amount: 3_000_000,
  paymentType: "PAYMENT",
  accountantStatus: "PENDING",
  rong: o.amount ?? 3_000_000,
  ...o,
});
const gd = (enrollmentId: string, studentId: string, courseId: string, o: Partial<GhiDanhUngVien> = {}): GhiDanhUngVien => ({
  enrollmentId,
  studentId,
  courseId,
  finalPrice: 3_000_000,
  centerId: "cs1",
  ...o,
});
const dongDon = (studentId: string | null, courseId: string | null, thanhTien = 3_000_000): DongDonCoHocVien => ({
  studentId,
  courseId,
  thanhTien,
});

type Vao = Parameters<typeof lapKeHoachGanGhiDanh>[0];
const vao = (o: Partial<Vao> = {}): Vao => ({
  khoan: [khoan({ id: "p1" })],
  dongDon: [dongDon("s1", "sata4")],
  ghiDanh: [gd("e1", "s1", "sata4")],
  coHocVien: true,
  daKhoa: new Map(),
  trongTam: () => true,
  ...o,
});
const dong0 = (o: Partial<Vao> = {}) => lapKeHoachGanGhiDanh(vao(o)).dong[0]!;

describe("[KHGD] lapKeHoachGanGhiDanh", () => {
  it("[KHGD-01] một bé một ghi danh ⇒ GAN nguyên khoản", () => {
    expect(dong0()).toEqual({ paymentId: "p1", soTien: 3_000_000, ketQua: "GAN", phan: [{ enrollmentId: "e1", amount: 3_000_000 }] });
  });

  it("[KHGD-02] hình dạng thật của luồng lead: dòng đơn KHÔNG học viên + khoá học ⇒ vẫn GAN", () => {
    expect(dong0({ dongDon: [dongDon(null, "sata4")] })).toMatchObject({ ketQua: "GAN", phan: [{ enrollmentId: "e1" }] });
  });

  it("[KHGD-03] hai bé trên một đơn ⇒ TACH theo tiền dòng, tổng đúng bằng khoản", () => {
    const d = dong0({
      khoan: [khoan({ id: "p1", amount: 5_000_000 })],
      dongDon: [dongDon("s1", "sata4", 6_000_000), dongDon("s2", "sata3", 4_000_000)],
      ghiDanh: [gd("e1", "s1", "sata4"), gd("e2", "s2", "sata3")],
    });
    expect(d).toMatchObject({ ketQua: "TACH" });
    const phan = d.ketQua === "TACH" ? d.phan : [];
    expect(phan).toEqual([
      { enrollmentId: "e1", amount: 3_000_000 },
      { enrollmentId: "e2", amount: 2_000_000 },
    ]);
    expect(phan.reduce((s, p) => s + p.amount, 0)).toBe(5_000_000);
  });

  it("[KHGD-04] khoản đang nằm trong hoá đơn mà phải TÁCH ⇒ bỏ qua; đối chứng: một bé ⇒ vẫn GAN", () => {
    const daKhoa = new Map([["p1", { trangThai: "NHAP", so: "1C26TSR-127" }]]);
    const tach = dong0({
      daKhoa,
      dongDon: [dongDon("s1", "sata4"), dongDon("s2", "sata3")],
      ghiDanh: [gd("e1", "s1", "sata4"), gd("e2", "s2", "sata3")],
    });
    expect(tach).toMatchObject({ ketQua: "BO_QUA", ma: "PHAI_TACH_DA_KHOA", khoaHoaDon: { so: "1C26TSR-127" } });
    expect(dong0({ daKhoa })).toMatchObject({ ketQua: "GAN" });
  });

  it("[KHGD-05] không ghi danh nào: có học viên ⇒ KHONG_GHI_DANH; không học viên ⇒ KHONG_HOC_VIEN", () => {
    expect(dong0({ ghiDanh: [] })).toMatchObject({ ketQua: "BO_QUA", ma: "KHONG_GHI_DANH" });
    expect(dong0({ ghiDanh: [], coHocVien: false })).toMatchObject({ ketQua: "BO_QUA", ma: "KHONG_HOC_VIEN" });
  });

  it("[KHGD-06] đơn không khai học viên LẪN khoá (đường lui của convert) ⇒ KHONG_KHOP, không gắn bừa", () => {
    expect(dong0({ dongDon: [dongDon(null, null)] })).toMatchObject({ ketQua: "BO_QUA", ma: "KHONG_KHOP" });
  });

  it("[KHGD-07] MỘT bé có HAI ghi danh cùng khoá ⇒ MO_HO (không đoán); đối chứng: hai bé ⇒ TACH", () => {
    const moHo = dong0({ dongDon: [dongDon(null, "sata4")], ghiDanh: [gd("e1", "s1", "sata4"), gd("e2", "s1", "sata4")] });
    expect(moHo).toMatchObject({ ketQua: "BO_QUA", ma: "MO_HO" });
    expect(moHo.ketQua === "BO_QUA" && moHo.phanThu.length).toBe(2);
    expect(dong0({ dongDon: [dongDon(null, "sata4")], ghiDanh: [gd("e1", "s1", "sata4"), gd("e2", "s2", "sata4")] })).toMatchObject({
      ketQua: "TACH",
    });
  });

  it("[KHGD-08] bé có ghi danh Sata3 CŨ + Sata4 MỚI, dòng đơn khai Sata4 ⇒ gắn NGUYÊN khoản vào Sata4", () => {
    expect(dong0({ ghiDanh: [gd("e3", "s1", "sata3"), gd("e4", "s1", "sata4")] })).toEqual({
      paymentId: "p1",
      soTien: 3_000_000,
      ketQua: "GAN",
      phan: [{ enrollmentId: "e4", amount: 3_000_000 }],
    });
  });

  it("[KHGD-09] dòng gốc đã bị ĐẢO (ròng 0) và dòng điều chỉnh âm ⇒ không vào kế hoạch; đối chứng: chưa đảo ⇒ GAN", () => {
    const kh = lapKeHoachGanGhiDanh(
      vao({
        khoan: [
          khoan({ id: "goc-da-dao", rong: 0 }),
          khoan({ id: "dao", amount: -3_000_000, rong: -3_000_000, paymentType: "ADJUSTMENT" }),
        ],
      }),
    );
    expect(kh.dong).toEqual([]);
    expect(dong0({ khoan: [khoan({ id: "goc" })] })).toMatchObject({ paymentId: "goc", ketQua: "GAN" });
  });

  it("[KHGD-10] ghi danh ở cơ sở ngoài phạm vi người bấm ⇒ NGOAI_TAM", () => {
    const d = dong0({ trongTam: (c) => c === "cs2" });
    expect(d).toMatchObject({ ketQua: "BO_QUA", ma: "NGOAI_TAM" });
  });

  it("[KHGD-11] có khoản ĐÃ XÁC NHẬN mà chưa gắn ⇒ `chan` (đối chứng: toàn khoản chờ ⇒ null)", () => {
    expect(lapKeHoachGanGhiDanh(vao({ khoan: [khoan({ id: "p1", accountantStatus: DA_XAC_NHAN })] })).chan).toBe(
      "CO_KHOAN_DA_XAC_NHAN_CHUA_GAN",
    );
    expect(lapKeHoachGanGhiDanh(vao()).chan).toBeNull();
  });

  it("[KHGD-12] dấu kế hoạch: đổi theo ghi danh / số tiền; KHÔNG đổi theo dòng bỏ qua hay thứ tự đầu vào", () => {
    const goc = dauKeHoachGan(lapKeHoachGanGhiDanh(vao()));
    expect(dauKeHoachGan(lapKeHoachGanGhiDanh(vao({ ghiDanh: [gd("e9", "s1", "sata4")] })))).not.toBe(goc);
    expect(dauKeHoachGan(lapKeHoachGanGhiDanh(vao({ khoan: [khoan({ id: "p1", amount: 2_000_000 })] })))).not.toBe(goc);
    // Thêm một dòng BỎ QUA vào CÙNG kế hoạch ⇒ dấu giữ nguyên (nó không đổi thứ sẽ được ghi).
    const kh = lapKeHoachGanGhiDanh(vao());
    const coBoQua = {
      ...kh,
      dong: [...kh.dong, { paymentId: "px", soTien: 1_000_000, ketQua: "BO_QUA" as const, ma: "KHONG_KHOP" as const, phanThu: [], khoaHoaDon: null }],
    };
    expect(dauKeHoachGan(coBoQua)).toBe(goc);
    // Đối chứng: thêm một dòng SẼ GHI ⇒ dấu đổi.
    const coThemGan = { ...kh, dong: [...kh.dong, { paymentId: "px", soTien: 1_000_000, ketQua: "GAN" as const, phan: [{ enrollmentId: "e1", amount: 1_000_000 }] }] };
    expect(dauKeHoachGan(coThemGan)).not.toBe(goc);
    const hai = (thuTu: string[]) =>
      dauKeHoachGan(
        lapKeHoachGanGhiDanh(
          vao({
            khoan: thuTu.map((id) => khoan({ id })),
            dongDon: [dongDon("s1", "sata4"), dongDon("s2", "sata3")],
            ghiDanh: [gd("e1", "s1", "sata4"), gd("e2", "s2", "sata3")],
          }),
        ),
      );
    expect(hai(["a", "b"])).toBe(hai(["b", "a"]));
  });
});
