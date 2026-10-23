// @vitest-environment node
/**
 * EL-05 — GỘP TẬP NGƯỜI HỌC: `(∪ luật) ∪ thêm tay ⊖ loại trừ`.
 *
 * Luật 5 và luật 6 của §10.2 đều là luật về CÁCH NÓI VỚI NGƯỜI DÙNG, không phải
 * về truy vấn:
 *
 * - luật 5: xem trước phải LIỆT KÊ ĐỦ TÊN, không chỉ đếm. Ở quy mô 15 người, một
 *   luật sai chỉ lộ ra khi nhìn thấy tên; con số "8 người" thì luôn trông đúng.
 * - luật 6: người chưa có cơ sở bị TỪ CHỐI, và phải được nêu ĐÍCH DANH. Prod chỉ
 *   4/15 người có `centerId`.
 *
 * Nên phần lớn case dưới đây kiểm rằng người bị loại KHÔNG BIẾN MẤT — họ chuyển
 * sang một nhóm có tên, có lý do, và người giao bài đọc được.
 */
import { describe, it, expect } from "vitest";
import { gopTapNguoiHoc, type NguoiTrongTap } from "@/lib/elearning/audience";

const nguoi = (o: Partial<NguoiTrongTap> & { employeeId: string }): NguoiTrongTap => ({
  userId: `u-${o.employeeId}`,
  employeeCode: `NV${o.employeeId}`,
  fullName: `Người ${o.employeeId}`,
  jobTitle: "Giáo viên",
  centerId: "cs1",
  orgUnitId: "ou1",
  departmentId: "d1",
  managerId: null,
  joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  ...o,
});

describe("gộp tập: hợp luật, hợp thêm tay, trừ loại trừ", () => {
  it("một người vừa khớp luật vừa được thêm tay chỉ tính MỘT lần", () => {
    // Trùng lặp ở đây nghĩa là hai lượt ghi danh cho cùng một người — vỡ
    // `@@unique([courseId, userId, cycle])` của `TrnEnrollment` lúc ghi.
    const a = nguoi({ employeeId: "1" });
    const r = gopTapNguoiHoc({ theoLuat: [a], themTay: [a], loaiTruUserId: [] });
    expect(r.nhan).toHaveLength(1);
  });

  it("loại trừ thắng cả luật lẫn thêm tay", () => {
    const a = nguoi({ employeeId: "1" });
    const b = nguoi({ employeeId: "2" });
    const r = gopTapNguoiHoc({
      theoLuat: [a, b],
      themTay: [b],
      loaiTruUserId: ["u-2"],
    });
    expect(r.nhan.map((x) => x.employeeId)).toEqual(["1"]);
  });

  it("người bị loại trừ KHÔNG biến mất — vẫn hiện thành nhóm riêng", () => {
    // Biến mất im lặng là cách chắc chắn nhất để người giao bài tưởng danh sách
    // loại trừ chưa có hiệu lực, rồi thêm lần nữa.
    const b = nguoi({ employeeId: "2" });
    const r = gopTapNguoiHoc({ theoLuat: [b], themTay: [], loaiTruUserId: ["u-2"] });
    expect(r.biLoaiTru.map((x) => x.employeeId)).toEqual(["2"]);
  });
});

describe("luật 6 — thiếu `centerId` là TỪ CHỐI, nêu đích danh", () => {
  it("người chưa có cơ sở không nằm trong nhóm nhận", () => {
    const a = nguoi({ employeeId: "1", centerId: null });
    const r = gopTapNguoiHoc({ theoLuat: [a], themTay: [], loaiTruUserId: [] });
    expect(r.nhan).toHaveLength(0);
    expect(r.thieuCoSo).toHaveLength(1);
  });

  it("nhóm thiếu cơ sở mang đủ TÊN và MÃ để Nhân sự tra ngay", () => {
    // "Một số nhân sự thiếu cơ sở" buộc người giao bài đi dò từng người. Ở quy mô
    // 15 người thì nêu tên là làm được, và làm được thì phải làm.
    const a = nguoi({ employeeId: "1", centerId: null, fullName: "Trần Thị B" });
    const r = gopTapNguoiHoc({ theoLuat: [a], themTay: [], loaiTruUserId: [] });
    expect(r.thieuCoSo[0]?.fullName).toBe("Trần Thị B");
    expect(r.thieuCoSo[0]?.employeeCode).toBe("NV1");
  });

  it("thêm tay cũng KHÔNG lách được luật 6", () => {
    // Đường thêm tay là đường dễ quên nhất: người ta tự gõ tên vào thì cảm giác
    // như đã xác nhận thủ công rồi.
    const a = nguoi({ employeeId: "1", centerId: null });
    const r = gopTapNguoiHoc({ theoLuat: [], themTay: [a], loaiTruUserId: [] });
    expect(r.nhan).toHaveLength(0);
    expect(r.thieuCoSo).toHaveLength(1);
  });
});

describe("người chưa có tài khoản đăng nhập cũng phải hiện ra", () => {
  it("không `userId` ⇒ không nhận bài, và được nêu tên", () => {
    // Có hồ sơ nhân sự mà chưa có tài khoản thì không đăng nhập được, không học
    // được. Im lặng bỏ qua là để họ vắng mặt khỏi mọi báo cáo mà không ai biết.
    const a = nguoi({ employeeId: "1", userId: null });
    const r = gopTapNguoiHoc({ theoLuat: [a], themTay: [], loaiTruUserId: [] });
    expect(r.nhan).toHaveLength(0);
    expect(r.thieuTaiKhoan.map((x) => x.employeeId)).toEqual(["1"]);
  });

  it("thiếu CẢ HAI thì hiện ở CẢ HAI nhóm", () => {
    // Chỉ báo một lỗi thì Nhân sự sửa xong cái đó, giao lại, và người này vẫn
    // trượt — lần này vì lý do kia. Hai vòng cho một người.
    const a = nguoi({ employeeId: "1", userId: null, centerId: null });
    const r = gopTapNguoiHoc({ theoLuat: [a], themTay: [], loaiTruUserId: [] });
    expect(r.thieuTaiKhoan).toHaveLength(1);
    expect(r.thieuCoSo).toHaveLength(1);
    expect(r.nhan).toHaveLength(0);
  });
});

describe("luật 5 — xem trước là DANH SÁCH TÊN, không phải con số", () => {
  it("mọi nhóm đều trả bản ghi đủ tên, không phải số đếm", () => {
    const r = gopTapNguoiHoc({
      theoLuat: [nguoi({ employeeId: "1" }), nguoi({ employeeId: "2", centerId: null })],
      themTay: [],
      loaiTruUserId: [],
    });
    for (const nhom of [r.nhan, r.thieuCoSo]) {
      for (const x of nhom) {
        expect(x.fullName).toBeTruthy();
        expect(x.employeeCode).toBeTruthy();
      }
    }
  });

  it("thứ tự ỔN ĐỊNH theo tên — xem trước hai lần phải giống nhau", () => {
    // Danh sách nhảy thứ tự giữa hai lần bấm làm người ta không so được, và mất
    // luôn tác dụng của việc liệt kê tên.
    const ds = [
      nguoi({ employeeId: "3", fullName: "Cường" }),
      nguoi({ employeeId: "1", fullName: "An" }),
      nguoi({ employeeId: "2", fullName: "Bình" }),
    ];
    const r1 = gopTapNguoiHoc({ theoLuat: ds, themTay: [], loaiTruUserId: [] });
    const r2 = gopTapNguoiHoc({
      theoLuat: [...ds].reverse(),
      themTay: [],
      loaiTruUserId: [],
    });
    expect(r1.nhan.map((x) => x.fullName)).toEqual(["An", "Bình", "Cường"]);
    expect(r2.nhan.map((x) => x.fullName)).toEqual(r1.nhan.map((x) => x.fullName));
  });
});

describe("số đếm phải khớp danh sách, không đếm riêng", () => {
  it("`tong` = số người thực sự nhận, không tính người bị loại", () => {
    // Đếm riêng một đường và liệt kê một đường là cách sinh ra màn hình tự mâu
    // thuẫn: "sẽ giao cho 8 người" bên trên, 6 dòng tên bên dưới.
    const r = gopTapNguoiHoc({
      theoLuat: [
        nguoi({ employeeId: "1" }),
        nguoi({ employeeId: "2", centerId: null }),
        nguoi({ employeeId: "3", userId: null }),
        nguoi({ employeeId: "4" }),
      ],
      themTay: [],
      loaiTruUserId: ["u-4"],
    });
    expect(r.tong).toBe(r.nhan.length);
    expect(r.tong).toBe(1);
  });
});
