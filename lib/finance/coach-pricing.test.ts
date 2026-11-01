// Giá lớp Coach theo SR.QD.219 Điều 5 — test dựng từ CHÍNH BẢNG trong công văn.
//
// Mọi con số dưới đây trích nguyên văn `E:\Cong_van\32 - SR.QD.219 - Chính sách giá bán
// sản phẩm tạo trung tâm đào tạo Sata Robo.docx`, Điều 4 + Điều 5. Đừng sửa số ở đây để
// test xanh — sai số nghĩa là công thức sai, hoặc công văn đã đổi (thì sửa cả hai).

import { describe, it, expect } from "vitest";
import {
  HE_SO_COACH,
  giaMoiBuoi,
  giaCoachMoiBuoi,
  tinhHocPhiTheoBuoi,
  type CoachFormat,
  CoachKhongApDung,
  laKhoaLoaiTruCoach,
} from "./coach-pricing";

describe("[CO-01] hệ số đúng công văn Mục 5.2", () => {
  it("1-1 ×2,0 · 1-2 ×1,8 · 1-4 ×1,5 · lớp nhóm ×1", () => {
    expect(HE_SO_COACH.ONE_ON_ONE).toBe(2.0);
    expect(HE_SO_COACH.ONE_ON_TWO).toBe(1.8);
    expect(HE_SO_COACH.ONE_ON_FOUR).toBe(1.5);
    expect(HE_SO_COACH.GROUP).toBe(1);
  });
});

describe("[CO-02] giá/buổi = giá niêm yết ÷ tổng số buổi (Mục 5.2)", () => {
  it("Sata3: 10.560.000 ÷ 48 = 220.000 — khớp bảng Điều 5", () => {
    expect(giaMoiBuoi(10_560_000, 48)).toBe(220_000);
  });

  it("Sata7: 14.400.000 ÷ 48 = 300.000", () => {
    expect(giaMoiBuoi(14_400_000, 48)).toBe(300_000);
  });

  it("0 buổi → 0, không chia cho 0", () => {
    expect(giaMoiBuoi(10_000_000, 0)).toBe(0);
    expect(giaMoiBuoi(10_000_000, -3)).toBe(0);
  });
});

describe("[CO-03] BẢNG QUY ĐỔI trong công văn phải khớp tới từng đồng", () => {
  // Mã khóa | giá/buổi niêm yết | Coach 1-1 | Coach 1-2 | Coach 1-4
  const BANG: [string, number, number, number, number][] = [
    ["Sata1", 150_000, 300_000, 270_000, 225_000],
    ["Sata2", 190_000, 380_000, 342_000, 285_000],
    ["Sata3", 220_000, 440_000, 396_000, 330_000],
    ["Sata4", 240_000, 480_000, 432_000, 360_000],
    ["Sata5", 260_000, 520_000, 468_000, 390_000],
    ["Sata6", 280_000, 560_000, 504_000, 420_000],
    ["Sata7", 300_000, 600_000, 540_000, 450_000],
  ];

  for (const [ma, goc, mot, hai, bon] of BANG) {
    it(`${ma}: ${goc.toLocaleString("vi-VN")} → ${mot.toLocaleString("vi-VN")} / ${hai.toLocaleString("vi-VN")} / ${bon.toLocaleString("vi-VN")}`, () => {
      expect(giaCoachMoiBuoi(goc, "ONE_ON_ONE")).toBe(mot);
      expect(giaCoachMoiBuoi(goc, "ONE_ON_TWO")).toBe(hai);
      expect(giaCoachMoiBuoi(goc, "ONE_ON_FOUR")).toBe(bon);
    });
  }

  it("lớp nhóm giữ nguyên giá niêm yết", () => {
    expect(giaCoachMoiBuoi(220_000, "GROUP")).toBe(220_000);
  });
});

describe("[CO-04] Mục 5.3 — hệ số nhân vào giá SAU khuyến mãi, không phải giá gốc", () => {
  it("khuyến mãi 25% rồi mới nhân hệ số 1-1", () => {
    // Sata3 giá gốc 10.560.000 / 48 buổi = 220.000/buổi. Khuyến mãi còn 165.000/buổi.
    // Công văn: "giá/buổi làm căn cứ tính hệ số Coach là giá/buổi SAU khuyến mãi tại
    // thời điểm chốt đăng ký, KHÔNG phải giá niêm yết gốc."
    const r = tinhHocPhiTheoBuoi({
      giaNiemYet: 10_560_000,
      tongSoBuoi: 48,
      soBuoiMua: 48,
      coachFormat: "ONE_ON_ONE",
      giamGia: { type: "PERCENT", value: 25 },
    });
    expect(r.giaMoiBuoiSauGiam).toBe(165_000);
    expect(r.giaCoachMoiBuoi).toBe(330_000); // 165.000 × 2,0
    expect(r.thanhTien).toBe(330_000 * 48);
  });

  it("làm NGƯỢC (nhân hệ số trước rồi mới giảm) ra số KHÁC — đây là cái bẫy của 5.3", () => {
    // Giữ làm chứng: 220.000 × 2,0 = 440.000 rồi giảm 25% = 330.000 — ở ca % thì TRÙNG.
    // Nhưng với giảm theo SỐ TIỀN thì hai thứ tự cho kết quả khác hẳn.
    const dungThuTu = tinhHocPhiTheoBuoi({
      giaNiemYet: 10_560_000,
      tongSoBuoi: 48,
      soBuoiMua: 1,
      coachFormat: "ONE_ON_ONE",
      giamGia: { type: "AMOUNT", value: 20_000 }, // giảm 20.000 trên GIÁ/BUỔI
    });
    // Đúng 5.3: (220.000 − 20.000) × 2,0 = 400.000
    expect(dungThuTu.giaCoachMoiBuoi).toBe(400_000);
    // Sai thứ tự sẽ ra 220.000×2 − 20.000 = 420.000 — lệch 20.000/buổi.
    expect(dungThuTu.giaCoachMoiBuoi).not.toBe(420_000);
  });
});

describe("[CO-05] mua LẺ số buổi (Mục 5.4 học thêm / 5.5 học bù tính tiền)", () => {
  it("học thêm 3 buổi Coach 1-4 của Sata5", () => {
    const r = tinhHocPhiTheoBuoi({
      giaNiemYet: 12_480_000,
      tongSoBuoi: 48,
      soBuoiMua: 3,
      coachFormat: "ONE_ON_FOUR",
      giamGia: null,
    });
    expect(r.giaMoiBuoiSauGiam).toBe(260_000);
    expect(r.giaCoachMoiBuoi).toBe(390_000); // 260.000 × 1,5 — khớp bảng công văn
    expect(r.thanhTien).toBe(1_170_000);
  });

  it("0 buổi → 0đ", () => {
    const r = tinhHocPhiTheoBuoi({
      giaNiemYet: 12_480_000,
      tongSoBuoi: 48,
      soBuoiMua: 0,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
    });
    expect(r.thanhTien).toBe(0);
  });
});

describe("[CO-06] Sata8 KHÔNG áp dụng Coach — công văn nói thẳng", () => {
  it("khoá loại trừ → ném, không âm thầm tính ra một con số", () => {
    // "Sata8 không áp dụng hình thức Coach do đây là gói cam kết chuyên biệt 5 buổi,
    // giá cố định theo Điều 3." Âm thầm trả về một con số là bịa ra giá không có căn cứ.
    expect(() =>
      tinhHocPhiTheoBuoi({
        giaNiemYet: 5_000_000,
        tongSoBuoi: 5,
        soBuoiMua: 5,
        coachFormat: "ONE_ON_ONE",
        giamGia: null,
        khoaKhongApDungCoach: true,
      }),
    ).toThrow(/Sata8|không áp dụng/i);
  });

  it("khoá loại trừ + lớp NHÓM → vẫn tính bình thường", () => {
    const r = tinhHocPhiTheoBuoi({
      giaNiemYet: 5_000_000,
      tongSoBuoi: 5,
      soBuoiMua: 5,
      coachFormat: "GROUP",
      giamGia: null,
      khoaKhongApDungCoach: true,
    });
    expect(r.thanhTien).toBe(5_000_000);
  });
});

describe("[CO-07] hệ số phải LẤY TỪ CẤU HÌNH được, không khoá cứng", () => {
  it("truyền bảng hệ số riêng thì dùng bảng đó", () => {
    // Chủ dự án chốt: mọi chính sách phải admin sửa được ở màn cấu hình. Hằng trong mã
    // chỉ là MẶC ĐỊNH; đường nào chạm DB phải đọc `getSetting` rồi truyền vào đây.
    const r = tinhHocPhiTheoBuoi({
      giaNiemYet: 10_560_000,
      tongSoBuoi: 48,
      soBuoiMua: 1,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
      heSo: { ...HE_SO_COACH, ONE_ON_ONE: 2.5 },
    });
    expect(r.giaCoachMoiBuoi).toBe(550_000); // 220.000 × 2,5
  });

  it("hệ số rác → dùng mặc định, không ném giữa đường tiền", () => {
    const r = tinhHocPhiTheoBuoi({
      giaNiemYet: 10_560_000,
      tongSoBuoi: 48,
      soBuoiMua: 1,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
      heSo: { ...HE_SO_COACH, ONE_ON_ONE: Number.NaN as unknown as number },
    });
    expect(r.giaCoachMoiBuoi).toBe(440_000);
  });
});

describe("[CO-08] mọi hình thức đều có tên đọc được cho màn hình", () => {
  it("4 hình thức, không thiếu cái nào", () => {
    const ds: CoachFormat[] = ["GROUP", "ONE_ON_ONE", "ONE_ON_TWO", "ONE_ON_FOUR"];
    for (const f of ds) expect(HE_SO_COACH[f]).toBeGreaterThan(0);
  });
});

describe("[CO-09] khoá bị công văn LOẠI TRỪ khỏi Coach — nhận ra bằng gì", () => {
  // Ghi chú Điều 5: "Sata8 KHÔNG áp dụng Coach" (gói cam kết 5 buổi, giá cố định Điều 3).
  //
  // ⚠️ ĐÂY LÀ MỘT PHÉP ĐOÁN THEO TÊN, VÀ NÓ ĐƯỢC KHAI RA ĐÚNG CHỖ NÀY.
  // `Course` không có cột "được Coach hay không", và thêm cột là ALTER trên bảng có dữ
  // liệu prod (luật cứng #4 — phải là story riêng có dry-run). Nên đường nhận dạng tạm
  // thời là slug/code/tên. Hệ quả phải biết: đặt tên khoá mới kiểu "Sata 8 nâng cao" thì
  // nó cũng bị loại khỏi Coach, và đó là hướng sai AN TOÀN (chặn nhầm còn hơn bán nhầm
  // một hình thức công văn cấm).
  it("slug sata-8 → loại trừ", () => {
    expect(laKhoaLoaiTruCoach({ slug: "sata-8", code: null, name: "Sata 8" })).toBe(true);
  });

  it("tên có 'Sata 8' (có khoảng trắng) → loại trừ", () => {
    expect(
      laKhoaLoaiTruCoach({ slug: null, code: null, name: "Sata 8 — Gói cam kết" }),
    ).toBe(true);
  });

  it("code SATA8 → loại trừ", () => {
    expect(laKhoaLoaiTruCoach({ slug: null, code: "SATA8", name: null })).toBe(true);
  });

  it("Sata 1–4 và combo KHÔNG bị loại trừ", () => {
    for (const x of [
      { slug: "sata-1", code: null, name: "Sata 1 — Nhập môn Robotics" },
      { slug: "sata-4", code: null, name: "Sata 4 — Lập trình khối" },
      { slug: "combo-1-2", code: null, name: "Combo Sata 1 & 2" },
    ]) {
      expect(laKhoaLoaiTruCoach(x)).toBe(false);
    }
  });

  it("KHÔNG khớp nhầm 'Sata 18' / 'Sata 80'", () => {
    // Khớp lỏng theo "chứa 'sata8'" thì mọi khoá đánh số bắt đầu bằng 8 đều bị chặn.
    expect(laKhoaLoaiTruCoach({ slug: "sata-18", code: null, name: "Sata 18" })).toBe(false);
    expect(laKhoaLoaiTruCoach({ slug: "sata-80", code: null, name: "Sata 80" })).toBe(false);
  });

  it("khoá rỗng / thiếu cả ba trường → KHÔNG loại trừ", () => {
    // Fail-open có chủ đích: chặn Coach vì không đọc được tên là chặn một việc bán hàng
    // hợp lệ. Hướng an toàn của ca này ngược với ca "Sata 8 nâng cao" ở trên, và đó là
    // lý do nó được viết ra chứ không suy.
    expect(laKhoaLoaiTruCoach({ slug: null, code: null, name: null })).toBe(false);
  });

  it("nối được với tinhHocPhiTheoBuoi: khoá loại trừ + Coach → NÉM", () => {
    expect(() =>
      tinhHocPhiTheoBuoi({
        giaNiemYet: 3_000_000,
        tongSoBuoi: 5,
        soBuoiMua: 5,
        coachFormat: "ONE_ON_ONE",
        giamGia: null,
        khoaKhongApDungCoach: laKhoaLoaiTruCoach({ slug: "sata-8", code: null, name: null }),
      }),
    ).toThrow(CoachKhongApDung);
  });
});
