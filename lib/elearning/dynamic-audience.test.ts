// @vitest-environment node
/**
 * EL-05 — tập ĐỘNG chạy đêm.
 *
 * Đường này KHÔNG AI BẤM NÚT: không màn xem trước, không ai đọc thông báo lúc nó
 * chạy. Nên mọi case ở đây hỏi cùng một câu — nếu thứ này sai, sáng mai có ai
 * nhìn thấy không?
 */
import { describe, it, expect } from "vitest";
import { soSanhTapDong, LY_DO_ROI_TAP } from "@/lib/elearning/dynamic-audience";
import type { NguoiTrongTap } from "@/lib/elearning/audience";

const nguoi = (i: string, o: Partial<NguoiTrongTap> = {}): NguoiTrongTap => ({
  employeeId: `e${i}`,
  userId: `u${i}`,
  employeeCode: `NV${i}`,
  fullName: `Người ${i}`,
  jobTitle: "Giáo viên",
  centerId: "cs1",
  orgUnitId: "ou1",
  departmentId: "d1",
  managerId: null,
  joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...o,
});

const so = (o: Partial<Parameters<typeof soSanhTapDong>[0]> = {}) =>
  soSanhTapDong({ nhan: [], thieuCoSo: [], thieuTaiKhoan: [], hienCo: [], ...o });

describe("người mới vào tập", () => {
  it("khớp luật mà chưa có ghi danh ⇒ thêm mới", () => {
    const r = so({ nhan: [nguoi("1")] });
    expect(r.themMoi.map((x) => x.userId)).toEqual(["u1"]);
  });

  it("đã có ghi danh rồi ⇒ KHÔNG tạo lần hai", () => {
    // Tạo lại mỗi đêm sẽ va `@@unique([courseId, userId, cycle])`, và nếu không
    // va thì tệ hơn: người học có hai dòng, mọi phép đếm nhân đôi.
    const r = so({
      nhan: [nguoi("1")],
      hienCo: [{ id: "en1", userId: "u1", status: "IN_PROGRESS" }],
    });
    expect(r.themMoi).toHaveLength(0);
  });
});

describe("người rời tập", () => {
  it("không còn khớp luật ⇒ thu hồi", () => {
    const r = so({ hienCo: [{ id: "en1", userId: "u1", status: "IN_PROGRESS" }] });
    expect(r.thuHoiId).toEqual(["en1"]);
  });

  it("đã thu hồi rồi thì KHÔNG thu hồi lại mỗi đêm", () => {
    // Thu hồi lại mỗi đêm là ghi đè `revokedAt` liên tục và đẩy một dòng vô
    // nghĩa vào sổ audit mỗi 24 giờ — sổ audit đầy thì nó hết là bằng chứng.
    const r = so({ hienCo: [{ id: "en1", userId: "u1", status: "REVOKED" }] });
    expect(r.thuHoiId).toHaveLength(0);
  });

  it("người ĐÃ HỌC XONG rời tập vẫn KHÔNG bị thu hồi", () => {
    // Đổi phòng ban sau khi học xong là chuyện bình thường. Thu hồi họ là xoá
    // bằng chứng của một việc đã hoàn thành thật.
    for (const st of ["COMPLETED", "COMPLETED_LATE"] as const) {
      const r = so({ hienCo: [{ id: "en1", userId: "u1", status: st }] });
      expect(r.thuHoiId, st).toHaveLength(0);
    }
  });

  it("người đang QUÁ HẠN rời tập thì vẫn thu hồi", () => {
    const r = so({ hienCo: [{ id: "en1", userId: "u1", status: "OVERDUE" }] });
    expect(r.thuHoiId).toEqual(["en1"]);
  });

  it("còn trong tập thì không đụng tới", () => {
    const r = so({
      nhan: [nguoi("1")],
      hienCo: [{ id: "en1", userId: "u1", status: "IN_PROGRESS" }],
    });
    expect(r.thuHoiId).toHaveLength(0);
  });
});

describe("hàng đợi chờ dữ liệu Nhân sự — nhóm dễ trôi nhất của cả module", () => {
  it("thiếu cơ sở ⇒ vào hàng đợi, KHÔNG tạo ghi danh", () => {
    const r = so({ thieuCoSo: [nguoi("9", { centerId: null })] });
    expect(r.themMoi).toHaveLength(0);
    expect(r.choDuLieuNhanSu.map((x) => x.employeeCode)).toEqual(["NV9"]);
  });

  it("thiếu tài khoản cũng vào cùng hàng đợi đó", () => {
    const r = so({ thieuTaiKhoan: [nguoi("8", { userId: null })] });
    expect(r.choDuLieuNhanSu.map((x) => x.employeeCode)).toEqual(["NV8"]);
  });

  it("thiếu CẢ HAI chỉ kể MỘT lần trong hàng đợi", () => {
    // Cùng một người đếm hai lần thì con số hàng đợi to hơn số người thật, và
    // Nhân sự đi tìm một người không tồn tại.
    const x = nguoi("7", { userId: null, centerId: null });
    const r = so({ thieuCoSo: [x], thieuTaiKhoan: [x] });
    expect(r.choDuLieuNhanSu).toHaveLength(1);
  });

  it("hàng đợi mang đủ TÊN, không phải chỉ con số", () => {
    const r = so({ thieuCoSo: [nguoi("9", { fullName: "Phạm Thị D" })] });
    expect(r.choDuLieuNhanSu[0]?.fullName).toBe("Phạm Thị D");
  });
});

describe("lý do thu hồi tự động là một hằng, không phải chuỗi gõ tay", () => {
  it("có hằng `LY_DO_ROI_TAP` để mọi nơi dùng chung", () => {
    // Gõ tay mỗi chỗ một kiểu thì báo cáo lọc theo lý do sẽ sót, và không ai
    // biết là đang sót.
    expect(LY_DO_ROI_TAP).toBe("rời tập luật");
  });
});
