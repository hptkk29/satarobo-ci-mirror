import { describe, expect, it } from "vitest";
import { cauTomTatMay, idThiKeTiep, locHangThi, nhanCho, tomTatMayCham } from "./cham-thi-hien";

describe("[CTH-01] nhãn chờ: màu chỉ bổ sung cho chữ, đỏ từ 3 ngày", () => {
  it("các mốc", () => {
    expect(nhanCho(null)).toEqual({ chu: "chưa rõ mốc nộp", sac: "muted" });
    expect(nhanCho(0)).toEqual({ chu: "nộp hôm nay", sac: "muted" });
    expect(nhanCho(1)).toEqual({ chu: "chờ 1 ngày", sac: "muted" });
    expect(nhanCho(2)).toEqual({ chu: "chờ 2 ngày", sac: "warning" });
    expect(nhanCho(3)).toEqual({ chu: "chờ 3 ngày", sac: "danger" });
    expect(nhanCho(10).sac).toBe("danger");
  });
});

describe("[CTH-02] tìm không dấu theo tên người hoặc tên đề; rỗng giữ nguyên thứ tự", () => {
  const ds = [
    { attemptId: "a", tenNguoiHoc: "Phạm Thu Trang", tenDe: "Kiểm tra cuối khoá — An toàn điện" },
    { attemptId: "b", tenNguoiHoc: "Bảo An", tenDe: "Kiểm tra chặng 2 — RoboSim 1" },
  ];
  it("khớp", () => {
    expect(locHangThi(ds, "").map((d) => d.attemptId)).toEqual(["a", "b"]);
    expect(locHangThi(ds, undefined)).toHaveLength(2);
    expect(locHangThi(ds, "trang").map((d) => d.attemptId)).toEqual(["a"]);
    expect(locHangThi(ds, "ROBOSIM").map((d) => d.attemptId)).toEqual(["b"]);
    expect(locHangThi(ds, "an toan").map((d) => d.attemptId)).toEqual(["a"]);
    expect(locHangThi(ds, "khong co")).toEqual([]);
  });
});

describe("[CTH-03] lượt kế tiếp sau khi chốt", () => {
  const ds = [{ attemptId: "a" }, { attemptId: "b" }, { attemptId: "c" }];
  it("liền sau, rồi liền trước, rồi null; id lạ ⇒ lượt đầu", () => {
    expect(idThiKeTiep(ds, "a")).toBe("b");
    expect(idThiKeTiep(ds, "b")).toBe("c");
    expect(idThiKeTiep(ds, "c")).toBe("b");
    expect(idThiKeTiep([{ attemptId: "a" }], "a")).toBeNull();
    expect(idThiKeTiep([], "a")).toBeNull();
    expect(idThiKeTiep(ds, "lạ")).toBe("a");
  });
});

describe("[CTH-04] tóm tắt phần máy chấm", () => {
  it("đếm câu máy chấm / đúng (đủ điểm tối đa) / điểm / còn chấm tay — đúng ví dụ thiết kế 9/10 · 9 điểm · 2 tay", () => {
    const may = Array.from({ length: 10 }, (_, i) => ({ daCoDiem: true, score: i < 9 ? 1 : 0, points: 1 }));
    const tay = [{ daCoDiem: false, score: null, points: 2 }, { daCoDiem: false, score: null, points: 1 }];
    const t = tomTatMayCham([...may, ...tay]);
    expect(t).toEqual({ soCauMay: 10, soDung: 9, diemMay: 9, soCauTay: 2 });
    expect(cauTomTatMay(t)).toBe("Phần máy chấm: 9/10 câu đúng — 9 điểm. Còn 2 câu cần chấm tay.");
  });
  it("🔴 câu CHƯA có điểm không bao giờ tính là máy chấm (kể cả trắc nghiệm máy không đọc nổi); điểm một phần không phải 'đúng'", () => {
    expect(tomTatMayCham([{ daCoDiem: false, score: null, points: 1 }])).toMatchObject({ soCauMay: 0, soCauTay: 1 });
    expect(tomTatMayCham([{ daCoDiem: true, score: 1, points: 2 }])).toMatchObject({ soCauMay: 1, soDung: 0, diemMay: 1 });
    expect(cauTomTatMay({ soCauMay: 0, soDung: 0, diemMay: 0, soCauTay: 3 })).toBe("Không có câu nào máy tự chấm. Còn 3 câu cần chấm tay.");
  });
});
