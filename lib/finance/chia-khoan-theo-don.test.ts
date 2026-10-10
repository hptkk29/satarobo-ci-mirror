// lib/finance/chia-khoan-theo-don.test.ts — tiền của đơn nào về học viên của đơn đó.
//
// Số liệu trong các ca dưới là SỐ ĐO THẬT từ lượt chạy tay đầu-cuối 15/09/2026 trên
// `satarobo_local`, không phải số tròn bịa ra: đúng những con số mà bản cũ chia sai.
import { describe, it, expect } from "vitest";
import { chiaKhoanTheoDon } from "./chia-khoan-theo-don";

const KHOA_S4 = "course-sata4";
const KHOA_S3 = "course-sata3";
const KHOI = { enrollmentId: "e-khoi", studentId: "hv-khoi", courseId: KHOA_S4, finalPrice: 11_520_000 };
const NGOC = { enrollmentId: "e-ngoc", studentId: "hv-ngoc", courseId: KHOA_S3, finalPrice: 10_560_000 };

describe("[CHIA-01] MỖI CON MỘT ĐƠN — tiền không được chảy sang em kia", () => {
  it("đơn chỉ có Khôi ⇒ Khôi nhận TRỌN 2.880.000đ", () => {
    const r = chiaKhoanTheoDon(2_880_000, [{ studentId: "hv-khoi", courseId: null, thanhTien: 11_520_000 }], [KHOI, NGOC]);
    expect(r.phan).toEqual([{ enrollmentId: "e-khoi", amount: 2_880_000 }]);
    expect(r.duongLui).toBe(false);
  });

  it("đơn chỉ có Ngọc ⇒ Ngọc nhận TRỌN 5.280.000đ", () => {
    const r = chiaKhoanTheoDon(5_280_000, [{ studentId: "hv-ngoc", courseId: null, thanhTien: 10_560_000 }], [KHOI, NGOC]);
    expect(r.phan).toEqual([{ enrollmentId: "e-ngoc", amount: 5_280_000 }]);
  });

  it("KHÔNG tách khi chỉ một em — một mảnh là thêm dòng sổ vô ích", () => {
    const r = chiaKhoanTheoDon(2_880_000, [{ studentId: "hv-khoi", courseId: null, thanhTien: 11_520_000 }], [KHOI, NGOC]);
    expect(r.phan).toHaveLength(1);
  });

  it("đúng con số bản CŨ chia sai: 1.043.478 / 956.522 không được xuất hiện nữa", () => {
    const r = chiaKhoanTheoDon(2_880_000, [{ studentId: "hv-khoi", courseId: null, thanhTien: 11_520_000 }], [KHOI, NGOC]);
    expect(r.phan.map((p) => p.amount)).not.toContain(956_522);
    expect(r.phan.map((p) => p.amount)).not.toContain(1_043_478);
  });
});

describe("[CHIA-02] EM KHÔNG CÓ TRÊN ĐƠN KHÔNG NHẬN ĐỒNG NÀO", () => {
  const SUN = { enrollmentId: "e-sun", studentId: "hv-sun", courseId: "course-sata5", finalPrice: 8_000_000 };

  it("lead 3 con, đơn bán cho 2 con ⇒ chỉ 2 em được chia", () => {
    const r = chiaKhoanTheoDon(
      2_617_000,
      [
        { studentId: "hv-khoi", courseId: null, thanhTien: 11_520_000 },
        { studentId: "hv-ngoc", courseId: null, thanhTien: 10_560_000 },
      ],
      [KHOI, NGOC, SUN],
    );
    expect(r.phan.map((p) => p.enrollmentId).sort()).toEqual(["e-khoi", "e-ngoc"]);
    expect(r.phan.find((p) => p.enrollmentId === "e-sun")).toBeUndefined();
    expect(r.phan.reduce((s, p) => s + p.amount, 0)).toBe(2_617_000);
  });
});

describe("[CHIA-03] MỘT ĐƠN NHIỀU DÒNG — vẫn chia, nhưng theo TIỀN DÒNG của đơn", () => {
  it("hai con chung một đơn, không giảm giá", () => {
    const r = chiaKhoanTheoDon(
      1_000_000,
      [
        { studentId: "hv-khoi", courseId: null, thanhTien: 600_000 },
        { studentId: "hv-ngoc", courseId: null, thanhTien: 400_000 },
      ],
      [KHOI, NGOC],
    );
    expect(r.phan).toEqual([
      { enrollmentId: "e-khoi", amount: 600_000 },
      { enrollmentId: "e-ngoc", amount: 400_000 },
    ]);
  });

  it("⚠️ cân theo TIỀN DÒNG chứ KHÔNG theo finalPrice — khác nhau khi có giảm giá", () => {
    // Khôi được bớt nửa giá: dòng 5.760.000 trong khi finalPrice vẫn 11.520.000.
    const r = chiaKhoanTheoDon(
      1_000_000,
      [
        { studentId: "hv-khoi", courseId: null, thanhTien: 5_760_000 },
        { studentId: "hv-ngoc", courseId: null, thanhTien: 10_560_000 },
      ],
      [KHOI, NGOC],
    );
    // Theo TIỀN DÒNG: 5.760.000/16.320.000 = 35,29% → 352.941đ.
    // Theo finalPrice thì là 11.520.000/22.080.000 = 52,17% → 521.739đ. Lệch 168.798đ trên
    // một khoản 1.000.000đ — đó là khoảng cách giữa hai cách cân, và là lý do phải chọn.
    expect(r.phan[0]!.amount).toBe(352_941);
    expect(r.phan[1]!.amount).toBe(647_059);
    expect(r.phan[0]!.amount + r.phan[1]!.amount).toBe(1_000_000);
  });

  it("một em NHIỀU DÒNG trên cùng đơn ⇒ cộng dồn trọng số của em đó", () => {
    const r = chiaKhoanTheoDon(
      900_000,
      [
        { studentId: "hv-khoi", courseId: null, thanhTien: 300_000 },
        { studentId: "hv-khoi", courseId: null, thanhTien: 300_000 },
        { studentId: "hv-ngoc", courseId: null, thanhTien: 300_000 },
      ],
      [KHOI, NGOC],
    );
    expect(r.phan).toEqual([
      { enrollmentId: "e-khoi", amount: 600_000 },
      { enrollmentId: "e-ngoc", amount: 300_000 },
    ]);
  });
});

describe("[CHIA-04] BẤT BIẾN TỔNG — Σ các phần === số tiền, luôn luôn", () => {
  it("số lẻ chia 2 và 3 em", () => {
    for (const tien of [1, 999, 2_617_000, 10_000_001, 18_468_000]) {
      const r2 = chiaKhoanTheoDon(
        tien,
        [
          { studentId: "hv-khoi", courseId: null, thanhTien: 11_520_000 },
          { studentId: "hv-ngoc", courseId: null, thanhTien: 10_560_000 },
        ],
        [KHOI, NGOC],
      );
      expect(r2.phan.reduce((s, p) => s + p.amount, 0), `2 em, tiền=${tien}`).toBe(tien);
    }
  });
});

describe("[CHIA-05] ĐƯỜNG LUI — đơn không khai học viên trên dòng nào", () => {
  it("chia theo finalPrice cho mọi ghi danh, VÀ dựng cờ để đếm", () => {
    const r = chiaKhoanTheoDon(1_000_000, [{ studentId: null, courseId: null, thanhTien: 5_000_000 }], [KHOI, NGOC]);
    expect(r.duongLui).toBe(true);
    expect(r.phan.reduce((s, p) => s + p.amount, 0)).toBe(1_000_000);
    expect(r.phan).toHaveLength(2);
  });

  it("đơn khai học viên NGOÀI danh sách ghi danh ⇒ cũng là đường lui, không mất tiền", () => {
    const r = chiaKhoanTheoDon(
      1_000_000,
      [{ studentId: "hv-la-mat", courseId: null, thanhTien: 5_000_000 }],
      [KHOI, NGOC],
    );
    expect(r.duongLui).toBe(true);
    expect(r.phan.reduce((s, p) => s + p.amount, 0)).toBe(1_000_000);
  });
});

describe("[CHIA-06] ca biên", () => {
  it("không có ghi danh nào ⇒ rỗng, không ném", () => {
    expect(chiaKhoanTheoDon(1_000_000, [{ studentId: "hv-khoi", courseId: null, thanhTien: 1 }], []).phan).toEqual([]);
  });

  it("số tiền 0 / âm / NaN ⇒ rỗng", () => {
    for (const t of [0, -5, Number.NaN]) {
      expect(chiaKhoanTheoDon(t, [{ studentId: "hv-khoi", courseId: null, thanhTien: 1 }], [KHOI]).phan, `t=${t}`).toEqual([]);
    }
  });

  it("mọi dòng 0đ (học bổng toàn phần) ⇒ chia ĐỀU, không chia cho 0", () => {
    const r = chiaKhoanTheoDon(
      1_000_000,
      [
        { studentId: "hv-khoi", courseId: null, thanhTien: 0 },
        { studentId: "hv-ngoc", courseId: null, thanhTien: 0 },
      ],
      [KHOI, NGOC],
    );
    expect(r.phan.map((p) => p.amount)).toEqual([500_000, 500_000]);
  });
});

// ═══ KHỚP THEO KHOÁ HỌC ═══════════════════════════════════════════════════════
//
// ⚠️ ĐÂY LÀ NHÁNH CHẠY THẬT CỦA LUỒNG LEAD, không phải ca hiếm. Đo 15/09/2026 trên
// `satarobo_local`: đơn lập từ `/orders/new?leadId=…` có `OrderItem.studentId` = NULL ở MỌI
// dòng, vì `Student` chỉ ra đời ở bước Chuyển đổi — SAU khi đơn đã tồn tại.
// Bản vá đầu của tôi chỉ khớp theo `studentId`, nên nó rơi 100% vào đường lui và chia sai y
// hệt bản cũ: ORD-…008 (đơn Sata4 của Khôi) vẫn ra 1.043.478 / 956.522. Chỉ CHẠY THẬT mới
// lộ ra — test thuần với fixture có `studentId` thì xanh hết.
describe("[CHIA-07] dòng đơn KHÔNG có studentId ⇒ khớp theo KHOÁ HỌC", () => {
  it("đơn Sata4 ⇒ trọn tiền về em học Sata4, KHÔNG chảy sang em học Sata3", () => {
    const r = chiaKhoanTheoDon(
      2_880_000,
      [{ studentId: null, courseId: KHOA_S4, thanhTien: 11_520_000 }],
      [KHOI, NGOC],
    );
    expect(r.phan).toEqual([{ enrollmentId: "e-khoi", amount: 2_880_000 }]);
    expect(r.duongLui).toBe(false);
    // Đúng hai con số bản cũ chia sai trên chính ca này.
    expect(r.phan.map((p) => p.amount)).not.toContain(956_522);
  });

  it("đơn Sata3 ⇒ trọn tiền về em học Sata3", () => {
    const r = chiaKhoanTheoDon(
      5_280_000,
      [{ studentId: null, courseId: KHOA_S3, thanhTien: 10_560_000 }],
      [KHOI, NGOC],
    );
    expect(r.phan).toEqual([{ enrollmentId: "e-ngoc", amount: 5_280_000 }]);
  });

  it("một đơn HAI DÒNG hai khoá ⇒ chia theo tiền dòng của từng khoá", () => {
    const r = chiaKhoanTheoDon(
      1_000_000,
      [
        { studentId: null, courseId: KHOA_S4, thanhTien: 600_000 },
        { studentId: null, courseId: KHOA_S3, thanhTien: 400_000 },
      ],
      [KHOI, NGOC],
    );
    expect(r.phan).toEqual([
      { enrollmentId: "e-khoi", amount: 600_000 },
      { enrollmentId: "e-ngoc", amount: 400_000 },
    ]);
  });

  it("HỌC VIÊN thắng KHOÁ HỌC khi có cả hai — studentId chắc chắn hơn", () => {
    // Dòng khai studentId của Ngọc nhưng courseId của Sata4 (khoá của Khôi).
    const r = chiaKhoanTheoDon(
      1_000_000,
      [{ studentId: "hv-ngoc", courseId: KHOA_S4, thanhTien: 10_560_000 }],
      [KHOI, NGOC],
    );
    expect(r.phan).toEqual([{ enrollmentId: "e-ngoc", amount: 1_000_000 }]);
  });

  it("khoá của đơn không ai học ⇒ đường lui, không mất tiền", () => {
    const r = chiaKhoanTheoDon(
      1_000_000,
      [{ studentId: null, courseId: "course-khong-ai-hoc", thanhTien: 1 }],
      [KHOI, NGOC],
    );
    expect(r.duongLui).toBe(true);
    expect(r.phan.reduce((s, p) => s + p.amount, 0)).toBe(1_000_000);
  });
});
