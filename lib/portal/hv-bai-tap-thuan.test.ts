import { describe, expect, it } from "vitest";
import {
  chonBaiCanLam,
  diemHienThi,
  dungBaiDaNop,
  kieuBaiThi,
  moTaLuot,
  type BaiTapTho,
  type ThiTho,
} from "./hv-bai-tap-thuan";

const NOW = new Date("2026-11-05T03:00:00Z"); // Thứ Năm 05/11, 10:00 giờ VN
const bai = (id: string, p: Partial<BaiTapTho> = {}): BaiTapTho => ({
  id,
  title: `Bài ${id}`,
  dueAt: null,
  done: false,
  closed: false,
  overdue: false,
  ...p,
});

describe("bài cần làm", () => {
  it("[HVB-01] chỉ lấy bài CHƯA nộp và CÒN nộp được; bài đã nộp, bài đã đóng bị loại", () => {
    const ds = chonBaiCanLam(
      [
        { order: 7, assignment: bai("a", { dueAt: "2026-11-06T16:59:00Z" }) },
        { order: 6, assignment: bai("b", { done: true }) },
        { order: 5, assignment: bai("c", { closed: true, overdue: true, dueAt: "2026-10-01T16:59:00Z" }) },
        { order: 4, assignment: null },
      ],
      [],
      NOW,
    );
    expect(ds.map((d) => d.id)).toEqual(["a"]);
    expect(ds[0]?.buoi).toBe(7);
    expect(ds[0]?.han.nhan).toBe("Hạn ngày mai");
  });
  it("[HVB-02] sắp theo hạn gần nhất lên đầu, bài không đặt hạn xuống cuối; bài ngoài lộ trình vẫn hiện, không trùng", () => {
    const ds = chonBaiCanLam(
      [
        { order: 3, assignment: bai("khong-han") },
        { order: 2, assignment: bai("xa", { dueAt: "2026-11-20T16:59:00Z" }) },
        { order: 1, assignment: bai("gan", { dueAt: "2026-11-06T16:59:00Z" }) },
      ],
      [bai("ngoai", { dueAt: "2026-11-10T16:59:00Z" }), bai("gan", { dueAt: "2026-11-06T16:59:00Z" })],
      NOW,
    );
    expect(ds.map((d) => d.id)).toEqual(["gan", "ngoai", "xa", "khong-han"]);
    expect(ds.find((d) => d.id === "ngoai")?.buoi).toBeNull();
    expect(ds.filter((d) => d.id === "gan")).toHaveLength(1);
  });
});

describe("bài đã nộp", () => {
  it("[HVB-03] điểm thang 10 chỉ hiện số, thang khác kèm mẫu số, dấu phẩy kiểu VN", () => {
    expect(diemHienThi(9, 10)).toEqual({ chu: "9", thang10: true });
    expect(diemHienThi(8.5, 10)).toEqual({ chu: "8,5", thang10: true });
    expect(diemHienThi(45, 50)).toEqual({ chu: "45/50", thang10: false });
  });
  it("[HVB-04] mới nhất trước; chưa chấm ⇒ chờ chấm (không bịa điểm 0); nộp trễ được gắn cờ; nhận xét rỗng thành null", () => {
    const ds = dungBaiDaNop(
      [
        { id: "cu", title: "Cũ", status: "GRADED", score: 9, tong: 10, feedback: "  Tốt lắm  ", submittedAt: "2026-10-02T03:00:00Z" },
        { id: "moi", title: "Mới", status: "SUBMITTED", score: null, tong: 10, feedback: null, submittedAt: "2026-10-23T03:00:00Z" },
        { id: "tre", title: "Trễ", status: "LATE", score: null, tong: 10, feedback: "   ", submittedAt: "2026-10-16T03:00:00Z" },
        { id: "chamChuaDiem", title: "X", status: "GRADED", score: null, tong: 10, feedback: null, submittedAt: "2026-09-01T03:00:00Z" },
      ],
      new Map([["moi", 5], ["cu", 2]]),
    );
    expect(ds.map((d) => d.id)).toEqual(["moi", "tre", "cu", "chamChuaDiem"]);
    expect(ds[0]).toMatchObject({ buoi: 5, ngayNop: "23/10", choCham: true, diem: null });
    expect(ds[1]).toMatchObject({ tre: true, loi: null, buoi: null });
    expect(ds[2]).toMatchObject({ choCham: false, loi: "Tốt lắm" });
    expect(ds[2]?.diem?.chu).toBe("9");
    expect(ds[3]?.choCham).toBe(true);
  });
});

describe("bài thi", () => {
  const thi = (p: Partial<ThiTho> = {}): ThiTho => ({
    id: "t",
    title: "Kiểm tra",
    durationMinutes: 5,
    isOpen: true,
    closeAt: null,
    maxAttempts: 1,
    attemptsUsed: 0,
    attemptStatus: null,
    totalScore: null,
    ...p,
  });
  it("[HVB-05] làm được / đang làm dở / hết lượt / chưa mở / đã đóng", () => {
    expect(kieuBaiThi(thi(), NOW)).toBe("lam-duoc");
    expect(kieuBaiThi(thi({ attemptStatus: "IN_PROGRESS", attemptsUsed: 1 }), NOW)).toBe("dang-lam");
    expect(kieuBaiThi(thi({ attemptStatus: "GRADED", attemptsUsed: 1 }), NOW)).toBe("het-luot");
    expect(kieuBaiThi(thi({ attemptStatus: "GRADED", attemptsUsed: 1, maxAttempts: 3 }), NOW)).toBe("lam-duoc");
    expect(kieuBaiThi(thi({ isOpen: false, closeAt: null }), NOW)).toBe("chua-mo");
    expect(kieuBaiThi(thi({ isOpen: false, closeAt: "2026-11-01T00:00:00Z" }), NOW)).toBe("da-dong");
  });
  it("[HVB-06] mô tả số lần làm", () => {
    expect(moTaLuot(thi())).toBe("5 phút · làm 1 lần");
    expect(moTaLuot(thi({ maxAttempts: 3, attemptsUsed: 1 }))).toBe("5 phút · làm được 3 lần (đã dùng 1)");
  });
});
