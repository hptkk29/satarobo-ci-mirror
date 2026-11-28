// @vitest-environment node
/** [CBT-*] P8 — hiển thị hàng chờ chấm bài tập (thuần). Ca có DB + trình duyệt: `tests/e2e/elearning/cham-bai-tap.spec.ts`. */
import { describe, expect, it } from "vitest";
import { chuHanCham, idKeTiep, locHangCham } from "./cham-bai-tap-hien";

const NOW = new Date("2026-11-20T05:00:00.000Z");
const gio = (h: number) => new Date(NOW.getTime() + h * 3600_000);

describe("[CBT-H] nhãn hạn chấm", () => {
  it("[CBT-H-01] 🔴 quá hạn ≥ 1 ngày làm việc ⇒ 'Trễ N ngày' (đỏ); còn < 24 giờ ⇒ 'Còn N giờ' (làm tròn LÊN, tối thiểu 1); ≥ 24 giờ ⇒ 'Còn N ngày'; đã qua mốc nhưng chưa tròn 1 ngày làm việc ⇒ 'Đã đến hạn'; không có hạn ⇒ 'Chưa rõ hạn'", () => {
    expect(chuHanCham({ dueGradeAt: gio(-30), quaHanNgayLam: 1 }, NOW)).toEqual({ chu: "Trễ 1 ngày", sac: "danger" });
    expect(chuHanCham({ dueGradeAt: gio(3.2), quaHanNgayLam: 0 }, NOW)).toEqual({ chu: "Còn 4 giờ", sac: "warning" });
    expect(chuHanCham({ dueGradeAt: gio(0.1), quaHanNgayLam: 0 }, NOW)).toEqual({ chu: "Còn 1 giờ", sac: "warning" });
    expect(chuHanCham({ dueGradeAt: gio(50), quaHanNgayLam: 0 }, NOW)).toEqual({ chu: "Còn 2 ngày", sac: "muted" });
    expect(chuHanCham({ dueGradeAt: gio(-2), quaHanNgayLam: 0 }, NOW)).toEqual({ chu: "Đã đến hạn", sac: "danger" });
    expect(chuHanCham({ dueGradeAt: null, quaHanNgayLam: 0 }, NOW)).toEqual({ chu: "Chưa rõ hạn", sac: "muted" });
  });
});

describe("[CBT-L] lọc + chuyển bài", () => {
  const ds = [
    { submissionId: "a", tenNguoiHoc: "Lê Văn Hùng", tenBai: "Quay video giới thiệu RoboSim" },
    { submissionId: "b", tenNguoiHoc: "Nguyễn Minh Khoa", tenBai: "Ảnh lắp Alpha" },
    { submissionId: "c", tenNguoiHoc: "Bảo An", tenBai: "Robot dọn bàn" },
  ];
  it("[CBT-L-01] tìm theo tên người HOẶC tên bài, không phân biệt hoa/thường/dấu; rỗng ⇒ giữ nguyên; không khớp ⇒ rỗng", () => {
    expect(locHangCham(ds, "hung").map((d) => d.submissionId)).toEqual(["a"]);
    expect(locHangCham(ds, "ALPHA").map((d) => d.submissionId)).toEqual(["b"]);
    expect(locHangCham(ds, "robo").map((d) => d.submissionId)).toEqual(["a", "c"]);
    expect(locHangCham(ds, "  ")).toHaveLength(3);
    expect(locHangCham(ds, undefined)).toHaveLength(3);
    expect(locHangCham(ds, "zzz")).toEqual([]);
  });
  it("[CBT-L-02] 🔴 sau khi chấm: mở bài LIỀN SAU; hết thì bài LIỀN TRƯỚC; chỉ còn một bài ⇒ null; id không có trong danh sách ⇒ bài đầu", () => {
    expect(idKeTiep(ds, "a")).toBe("b");
    expect(idKeTiep(ds, "b")).toBe("c");
    expect(idKeTiep(ds, "c")).toBe("b");
    expect(idKeTiep([ds[0]!], "a")).toBeNull();
    expect(idKeTiep(ds, "khong-co")).toBe("a");
    expect(idKeTiep([], "a")).toBeNull();
  });
});
