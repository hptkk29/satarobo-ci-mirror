// lib/finance/cho-de-xuat-hoan-tien.test.ts — danh sách "đã nghỉ học, đã đóng tiền, chưa
// có đề xuất hoàn". Phần THUẦN + một lưới ghim mã nguồn canh chỗ dễ lệch nhất.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";
import {
  dungDongChoDeXuat,
  laViecConLam,
  sapXepChoDeXuat,
  type DongChoDeXuat,
} from "@/lib/finance/cho-de-xuat-hoan-tien";

const MOC = new Date("2026-09-15T00:00:00+07:00");
const d = (s: string) => new Date(`${s}T10:00:00+07:00`);

const GHI_DANH = {
  id: "e1",
  classId: "c1",
  finalPrice: 4_000_000,
  tuition: null,
  studentName: "Bé An",
  className: "Sata 3 – CS1",
};

describe("[CDX-01..05] dungDongChoDeXuat — sổ buổi quyết định có đề xuất được không", () => {
  it("[CDX-01] sổ đã chốt hết phần đã qua ⇒ đề xuất được, số đúng công thức", () => {
    const r = dungDongChoDeXuat({
      ghiDanh: GHI_DANH,
      buoi: [
        { date: d("2026-08-01"), status: "COMPLETED" },
        { date: d("2026-09-01"), status: "COMPLETED" },
        { date: d("2026-12-01"), status: "SCHEDULED" },
      ],
      daThu: 4_000_000,
      moc: MOC,
    });
    expect(r.choDeXuat).toBe(true);
    expect(r.muc).toBe("TIN_DUOC");
    expect(r.sessionsTotal).toBe(3);
    expect(r.sessionsLearned).toBe(2);
    // Σ đã thu − buổi đã học × đơn giá = 4.000.000 − 2 × round(4.000.000/3).
    expect(r.deXuatDuKien).toBe(1_333_334);
  });

  it("[CDX-02] buổi quá hạn chưa chốt mà sổ đọc ra 0 buổi học ⇒ CHẶN", () => {
    const r = dungDongChoDeXuat({
      ghiDanh: GHI_DANH,
      buoi: [
        { date: d("2026-09-01"), status: "SCHEDULED" },
        { date: d("2026-09-08"), status: "SCHEDULED" },
      ],
      daThu: 4_000_000,
      moc: MOC,
    });
    expect(r.choDeXuat).toBe(false);
    expect(r.muc).toBe("KHONG_TIN_DUOC");
    expect(r.soBuoiChuaChot).toBe(2);
    // Vẫn TÍNH ra số, nhưng màn CỐ Ý không in nó — đây đúng là con số không tin được:
    // 100% học phí cho một lớp có thể đã dạy gần hết.
    expect(r.deXuatDuKien).toBe(4_000_000);
  });

  it("[CDX-03] thiếu vài buổi nhưng đã có buổi chốt ⇒ VẪN đề xuất, kèm cảnh báo", () => {
    // Chặn cả ca này là chặn mọi lớp đang chạy — tính năng vô dụng theo kiểu khác.
    const r = dungDongChoDeXuat({
      ghiDanh: GHI_DANH,
      buoi: [
        { date: d("2026-08-01"), status: "COMPLETED" },
        { date: d("2026-09-08"), status: "SCHEDULED" },
      ],
      daThu: 4_000_000,
      moc: MOC,
    });
    expect(r.choDeXuat).toBe(true);
    expect(r.muc).toBe("THIEU_MOT_SO_BUOI");
    expect(r.lyDo).toContain("1 buổi");
  });

  it("[CDX-04] buổi HUỶ không vào tổng và không làm sổ thành chưa chốt", () => {
    // `CANCELLED` cố ý không bao giờ `COMPLETED`; tính nó là chặn nhầm cả lớp bình thường.
    const r = dungDongChoDeXuat({
      ghiDanh: GHI_DANH,
      buoi: [
        { date: d("2026-08-01"), status: "COMPLETED" },
        { date: d("2026-08-08"), status: "CANCELLED" },
      ],
      daThu: 4_000_000,
      moc: MOC,
    });
    expect(r.sessionsTotal).toBe(1);
    expect(r.soBuoiChuaChot).toBe(0);
    expect(r.choDeXuat).toBe(true);
  });

  it("[CDX-05] chưa chốt giá (finalPrice null) thì rơi về tuition, không nổ", () => {
    const r = dungDongChoDeXuat({
      ghiDanh: { ...GHI_DANH, finalPrice: null, tuition: 3_000_000 },
      buoi: [{ date: d("2026-08-01"), status: "COMPLETED" }],
      daThu: 1_000_000,
      moc: MOC,
    });
    expect(r.deXuatDuKien).toBe(0); // 1.000.000 − 1 × 3.000.000, clamp ≥ 0
  });
});

describe("[CDX-09..12] laViecConLam — lọc báo động giả", () => {
  const lam = (p: Partial<DongChoDeXuat>): DongChoDeXuat => ({
    enrollmentId: "x",
    classId: "c",
    studentName: "n",
    className: "l",
    daThu: 5_200_000,
    soBuoiChuaChot: 0,
    sessionsLearned: 12,
    sessionsTotal: 12,
    muc: "TIN_DUOC",
    choDeXuat: true,
    lyDo: "",
    deXuatDuKien: 0,
    ...p,
  });

  it("[CDX-09] học hết khoá, hoàn ra 0đ ⇒ KHÔNG phải việc", () => {
    // 12/18 ca trên `satarobo_local` là loại này: học hết 12/12 buổi rồi mới đóng ghi
    // danh. Hiện chúng kèm nút "Tạo đề xuất" là mời ghi 12 dòng RefundRequest 0đ vào sổ.
    expect(laViecConLam(lam({ deXuatDuKien: 0 }))).toBe(false);
  });

  it("[CDX-10] 4đ là BỤI LÀM TRÒN, không phải tiền hoàn", () => {
    // Quan sát thật: 5.200.000 − 12 × round(5.200.000/12) = 5.200.000 − 5.199.996 = 4.
    expect(laViecConLam(lam({ deXuatDuKien: 4 }))).toBe(false);
    // Chặn trên của dư là `sessionsTotal` đồng — đúng ngưỡng thì vẫn là bụi…
    expect(laViecConLam(lam({ deXuatDuKien: 12 }))).toBe(false);
    // …hơn một đồng nữa thì không còn giải thích được bằng làm tròn.
    expect(laViecConLam(lam({ deXuatDuKien: 13 }))).toBe(true);
  });

  it("[CDX-11] tiền thật ⇒ là việc", () => {
    expect(laViecConLam(lam({ deXuatDuKien: 1_300_003 }))).toBe(true);
  });

  it("[CDX-12] ca BỊ CHẶN luôn giữ, kể cả khi số đọc ra 0", () => {
    // Chính vì con số chưa tin được nên mới chặn — lọc nó đi là giấu mất việc phải làm.
    expect(
      laViecConLam(
        lam({ choDeXuat: false, muc: "KHONG_TIN_DUOC", deXuatDuKien: 0 }),
      ),
    ).toBe(true);
  });
});

describe("[CDX-06..07] sapXepChoDeXuat", () => {
  const lam = (p: Partial<DongChoDeXuat>): DongChoDeXuat => ({
    enrollmentId: "x",
    classId: "c",
    studentName: "n",
    className: "l",
    daThu: 0,
    soBuoiChuaChot: 0,
    sessionsLearned: 0,
    sessionsTotal: 0,
    muc: "TIN_DUOC",
    choDeXuat: true,
    lyDo: "",
    deXuatDuKien: 0,
    ...p,
  });

  it("[CDX-06] ca BỊ CHẶN lên trước — đó là việc cần người đi chốt sổ", () => {
    const ra = sapXepChoDeXuat([
      lam({ enrollmentId: "duoc", choDeXuat: true, daThu: 9_000_000 }),
      lam({ enrollmentId: "chan", choDeXuat: false, daThu: 1_000 }),
    ]);
    expect(ra.map((r) => r.enrollmentId)).toEqual(["chan", "duoc"]);
  });

  it("[CDX-07] trong cùng nhóm: tiền lớn trước, và KHÔNG sửa mảng gốc", () => {
    const goc = [
      lam({ enrollmentId: "nho", daThu: 1_000_000 }),
      lam({ enrollmentId: "to", daThu: 8_000_000 }),
    ];
    expect(sapXepChoDeXuat(goc).map((r) => r.enrollmentId)).toEqual([
      "to",
      "nho",
    ]);
    expect(goc.map((r) => r.enrollmentId)).toEqual(["nho", "to"]);
  });
});

// ── LƯỚI GHIM MÃ NGUỒN ───────────────────────────────────────────────────────
//
// Thứ cần khoá là một CẶP: màn này đếm buổi trong bộ nhớ, còn `createRefundRequest` đếm
// bằng hai `classSession.count` trên DB. Hai phép đếm phải nói cùng một câu. Test hành vi
// không chứng minh được điều đó — mỗi bên test riêng thì bên nào cũng xanh, trong khi số
// trên màn và số được ghi vào `RefundRequest` đã lệch nhau.
//
// Hậu quả nếu lệch: màn hứa "đề xuất dự kiến 1.333.334", bấm nút xong bảng dưới hiện một
// số khác. Không lỗi, không log — chỉ kế toán đối chiếu mới thấy.
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("[CDX-08] hai phép đếm buổi phải TRÙNG nhau", () => {
  it("createRefundRequest: tổng loại CANCELLED, đã học đếm COMPLETED", () => {
    const src = doc("lib/finance/refund.ts");
    expect(src).toContain(
      'where: { classId: enrollment.classId, status: { not: "CANCELLED" } },',
    );
    expect(src).toContain(
      'where: { classId: enrollment.classId, status: "COMPLETED" },',
    );
  });

  it("màn chờ đề xuất: CÙNG hai điều kiện đó, viết bằng JS", () => {
    const src = doc("lib/finance/cho-de-xuat-hoan-tien.ts");
    expect(src).toContain(
      'buoi.filter((b) => b.status !== "CANCELLED").length',
    );
    expect(src).toContain(
      'buoi.filter((b) => b.status === "COMPLETED").length',
    );
  });
});
