import { describe, expect, it } from "vitest";
import {
  changMacDinh,
  chuoiCoMatDaiNhat,
  dungBanDo,
  gomKyNang,
  moTaChang,
  tinhHuyHieu,
  type BuoiVaoBanDo,
  type DauVaoHuyHieu,
} from "./hv-hanh-trinh-thuan";

const b = (order: number, p: Partial<BuoiVaoBanDo> = {}): BuoiVaoBanDo => ({
  id: `s${order}`,
  order,
  title: `Bài ${order}`,
  ngayNgan: "T7, 07/11",
  past: false,
  attendance: "FUTURE",
  ...p,
});

describe("bản đồ chặng", () => {
  const buoi: BuoiVaoBanDo[] = [
    b(1, { past: true, attendance: "PRESENT" }),
    b(2, { past: true, attendance: "ABSENT" }),
    b(3, { past: true, attendance: "MAKEUP" }),
    b(4, { past: true, attendance: "UNMARKED" }),
    b(5),
    b(6, { title: "Demo cuối học phần" }),
    b(7, { attendance: "CANCELLED", title: "Đã huỷ" }),
    b(8, { title: "Buổi học" }),
  ];
  const ds = dungBanDo(buoi, "s5", 48, new Set(["s1"]));
  const chang = ds.flatMap((h) => h.chang);

  it("[HVG-01] 48 chặng chia 4 học phần × 12, kể cả chặng chưa có buổi", () => {
    expect(ds).toHaveLength(4);
    expect(ds.every((h) => h.chang.length === 12)).toBe(true);
    expect(chang[47]?.n).toBe(48);
    expect(chang[47]?.trangThai).toBe("toi");
  });
  it("[HVG-02] trạng thái từng chặng đi theo điểm danh, buổi tiếp theo, buổi huỷ", () => {
    const tt = (n: number) => chang.find((c) => c.n === n)?.trangThai;
    expect(tt(1)).toBe("xong");
    expect(tt(2)).toBe("vang");
    expect(tt(3)).toBe("xong"); // đã học bù ⇒ sáng màu cam
    expect(tt(4)).toBe("chua-cham");
    expect(tt(5)).toBe("sau");
    expect(tt(6)).toBe("toi");
    // buổi đã huỷ không có chặng riêng ⇒ coi như chưa có buổi
    expect(tt(7)).toBe("toi");
  });
  it("[HVG-03] buổi demo đánh dấu sao, tên 'Buổi học' (chưa ghim giáo trình) thành null chứ không bịa", () => {
    expect(chang.find((c) => c.n === 6)?.demo).toBe(true);
    expect(chang.find((c) => c.n === 1)?.demo).toBe(false);
    expect(chang.find((c) => c.n === 8)?.ten).toBeNull();
    expect(chang.find((c) => c.n === 1)?.ten).toBe("Bài 1");
  });
  it("[HVG-04] chip học phần: đang ở đây / chưa mở / hoàn thành", () => {
    expect(ds[0]?.chip).toBe("Em đang ở đây");
    expect(ds[1]?.chip).toBe("Chưa mở");
    const hetHp1 = Array.from({ length: 12 }, (_, i) => b(i + 1, { past: true, attendance: "PRESENT" }));
    const ds2 = dungBanDo([...hetHp1, b(13)], "s13", 48, new Set());
    expect(ds2[0]?.chip).toBe("Hoàn thành");
    expect(ds2[1]?.chip).toBe("Em đang ở đây");
  });
  it("[HVG-05] khoá 24 buổi chỉ có 2 học phần; chặng có ảnh được đánh dấu", () => {
    expect(dungBanDo([], null, 24, new Set())).toHaveLength(2);
    expect(chang.find((c) => c.n === 1)?.coSanPham).toBe(true);
    expect(chang.find((c) => c.n === 2)?.coSanPham).toBe(false);
  });
  it("[HVG-06] mô tả chặng không hứa điều chưa biết; chặng mặc định là chặng đã học gần nhất", () => {
    expect(moTaChang({ ...chang[0]!, trangThai: "xong", coSanPham: false }).ghi).toBe("Em đã học buổi này.");
    expect(moTaChang({ ...chang[0]!, trangThai: "xong", coSanPham: true }).ghi).toContain("Góc sản phẩm");
    expect(moTaChang({ ...chang[0]!, trangThai: "sau", ngayNgan: "T7, 07/11" }).nhan).toBe("CHẶNG TIẾP THEO · T7, 07/11");
    expect(moTaChang({ ...chang[0]!, trangThai: "toi" }).nhan).toBe("CHƯA TỚI");
    expect(changMacDinh(ds)).toBe(3);
    expect(changMacDinh(dungBanDo([], null, 12, new Set()))).toBe(1);
  });
});

describe("huy hiệu — chỉ loại có luật thật", () => {
  const goc: DauVaoHuyHieu = { daHoc: 0, tong: 48, baiDungHan: 0, coBaiDiemToiDa: false, diemDanh: [], nhom: null };
  const co = (i: Partial<DauVaoHuyHieu>) => new Set(tinhHuyHieu({ ...goc, ...i }).filter((h) => h.da).map((h) => h.ma));

  it("[HVG-07] đúng 8 huy hiệu, không bịa 4 loại thiếu dữ liệu", () => {
    const ds = tinhHuyHieu(goc);
    expect(ds).toHaveLength(8);
    const ten = ds.map((h) => h.ten).join("|");
    for (const khongCo of ["Kỹ sư nhí", "Diễn giả", "Nhà sáng chế", "Thợ săn lỗi"]) expect(ten).not.toContain(khongCo);
    expect(ds.every((h) => !h.da)).toBe(true);
  });
  it("[HVG-08] mỗi huy hiệu sáng đúng ở ngưỡng của nó, không sớm hơn", () => {
    expect(co({ daHoc: 0 }).has("buoi-dau")).toBe(false);
    expect(co({ daHoc: 1 }).has("buoi-dau")).toBe(true);
    expect(co({ baiDungHan: 2 }).has("dung-hen")).toBe(false);
    expect(co({ baiDungHan: 3 }).has("dung-hen")).toBe(true);
    expect(co({ daHoc: 11 }).has("xong-hoc-phan")).toBe(false);
    expect(co({ daHoc: 12 }).has("xong-hoc-phan")).toBe(true);
    expect(co({ daHoc: 23 }).has("nua-chang")).toBe(false);
    expect(co({ daHoc: 24 }).has("nua-chang")).toBe(true);
    expect(co({ daHoc: 47 }).has("ve-dich")).toBe(false);
    expect(co({ daHoc: 48 }).has("ve-dich")).toBe(true);
    expect(co({ coBaiDiemToiDa: true }).has("diem-10")).toBe(true);
    expect(co({ nhom: "GOOD" }).has("dong-doi")).toBe(false);
    expect(co({ nhom: "EXCELLENT" }).has("dong-doi")).toBe(true);
  });
  it("[HVG-09] khoá 12 buổi: 'nửa chặng đường' không tự sáng (tránh trùng 'xong học phần'); khoá 0 buổi không sáng gì vì chia 0", () => {
    expect(co({ tong: 12, daHoc: 12 }).has("nua-chang")).toBe(false);
    expect(co({ tong: 12, daHoc: 12 }).has("ve-dich")).toBe(true);
    expect(co({ tong: 0, daHoc: 0 }).has("ve-dich")).toBe(false);
  });
  it("[HVG-10] 'có mặt 5 buổi liền': vắng cắt chuỗi, buổi huỷ/chưa chấm không cắt cũng không cộng", () => {
    const P = "PRESENT";
    expect(chuoiCoMatDaiNhat([P, P, P, P, "ABSENT", P, P, P, P])).toBe(4);
    expect(chuoiCoMatDaiNhat([P, P, "CANCELLED", P, "UNMARKED", P, P])).toBe(5);
    expect(chuoiCoMatDaiNhat([P, P, "EXCUSED", P, P, P, P, P])).toBe(5);
    expect(chuoiCoMatDaiNhat([])).toBe(0);
    expect(co({ diemDanh: [P, P, P, P, P] }).has("cham-chi")).toBe(true);
    expect(co({ diemDanh: [P, P, P, P, "ABSENT", P] }).has("cham-chi")).toBe(false);
  });
});

describe("kỹ năng", () => {
  it("[HVG-11] lấy mức MỚI NHẤT mỗi kỹ năng, mức lạ bị bỏ", () => {
    const ds = gomKyNang([
      { skill: "SENSOR", level: "EXCELLENT" },
      { skill: "SENSOR", level: "BASIC" },
      { skill: "TEAMWORK", level: "NEED_SUPPORT" },
      { skill: "CREATIVITY", level: "???" },
    ]);
    expect(ds).toEqual([
      { ten: "Cảm biến", pct: 95, chu: "Xuất sắc", sac: "tot" },
      { ten: "Hợp tác nhóm", pct: 45, chu: "Đang tập", sac: "tap" },
    ]);
  });
});
