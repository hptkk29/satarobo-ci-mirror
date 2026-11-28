// @vitest-environment node
/** [TQV-*] QtTongQuan — dải số liệu, danh sách "Cần xử lý", dòng ngày. Hàm thuần: chỉ sắp xếp/đặt chữ số liệu thật, không tính chỉ số mới. */
import { describe, expect, it } from "vitest";
import { dongCanXuLy, ngayDayDu, thongKeTongQuan } from "./tong-quan-dao-tao-view";
import type { TongQuanDaoTao } from "./dao-tao-overview";

const DAY_DU: TongQuanDaoTao = {
  cham: { taoChoCham: 5, taoQuaHanCham: 2, thiChoCham: 3 },
  giao: { luotGiaoDangMo: 4 },
  soan: { khoaNhap: 1, khoaDaXuatBan: 6, khoaChoDuyet: 2, khoaDaDuyet: 1 },
  tienDo: { luotQuaHan: 9, luotDangHoc: 40 },
};

describe("[TQV-01] dải số liệu", () => {
  it("đủ quyền ⇒ 4 ô theo thứ tự thiết kế; 'Bài chờ chấm' = bài tập + bài thi, phụ ghi số quá hạn chấm", () => {
    const o = thongKeTongQuan(DAY_DU);
    expect(o.map((x) => x.nhan)).toEqual(["Bài chờ chấm", "Lượt học quá hạn", "Lượt giao đang mở", "Khoá chờ duyệt"]);
    expect(o[0]).toMatchObject({ so: 8, sac: "warning", phu: "2 bài tập quá hạn chấm" });
    expect(o[1]).toMatchObject({ so: 9, sac: "danger", phu: "40 lượt đang học" });
    expect(o[3]).toMatchObject({ so: 2, phu: "1 khoá đã duyệt, chờ xuất bản" });
  });

  it("🔴 thiếu quyền ⇒ KHÔNG có ô (không hiện số 0 giả cho khối người này không được xem)", () => {
    expect(thongKeTongQuan({ giao: { luotGiaoDangMo: 1 } }).map((x) => x.nhan)).toEqual(["Lượt giao đang mở"]);
    expect(thongKeTongQuan({})).toEqual([]);
  });

  it("không có gì quá hạn ⇒ không tô màu cảnh báo", () => {
    const o = thongKeTongQuan({ cham: { taoChoCham: 1, taoQuaHanCham: 0, thiChoCham: 0 }, tienDo: { luotQuaHan: 0, luotDangHoc: 3 } });
    expect(o.map((x) => x.sac)).toEqual(["mac-dinh", "mac-dinh"]);
  });
});

describe("[TQV-02] danh sách 'Cần xử lý'", () => {
  it("chỉ liệt kê việc có số > 0, đúng thứ tự gấp; chấm quá hạn thì nút chính", () => {
    const v = dongCanXuLy(DAY_DU);
    expect(v.map((x) => x.href)).toEqual([
      "/elearning/cham-bai-tap",
      "/elearning/cham-bai",
      "/elearning/bao-cao",
      "/elearning/soan-khoa?tab=cho-duyet",
      "/elearning/soan-khoa?tab=da-duyet",
    ]);
    expect(v[0]).toMatchObject({ tieuDe: "5 bài tập chờ chấm", phu: "2 bài đã quá hạn chấm", nut: "Chấm", noiBat: true });
    expect(v[1]!.noiBat).toBe(false);
  });

  it("🔴 mọi số bằng 0 ⇒ danh sách rỗng (trang nói 'không có việc nào', không liệt kê dòng 0)", () => {
    expect(
      dongCanXuLy({
        cham: { taoChoCham: 0, taoQuaHanCham: 0, thiChoCham: 0 },
        soan: { khoaNhap: 2, khoaDaXuatBan: 2, khoaChoDuyet: 0, khoaDaDuyet: 0 },
        tienDo: { luotQuaHan: 0, luotDangHoc: 5 },
      }),
    ).toEqual([]);
  });

  it("🔴 thiếu quyền chấm ⇒ không có dòng chấm dù (giả sử) dữ liệu có", () => {
    expect(dongCanXuLy({ soan: { khoaNhap: 0, khoaDaXuatBan: 0, khoaChoDuyet: 1, khoaDaDuyet: 0 } }).map((x) => x.href)).toEqual(["/elearning/soan-khoa?tab=cho-duyet"]);
  });
});

describe("[TQV-03] dòng ngày", () => {
  it("'Thứ Ba 17/11/2026' theo giờ Việt Nam, kể cả khi UTC còn ngày hôm trước", () => {
    expect(ngayDayDu(new Date("2026-11-16T18:30:00Z"))).toBe("Thứ Ba 17/11/2026");
    expect(ngayDayDu(new Date("2026-11-19T05:00:00Z"))).toBe("Thứ Năm 19/11/2026");
  });
});
