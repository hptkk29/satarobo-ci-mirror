import { describe, expect, it } from "vitest";
import { chiTietCacNgay, dongLichHoc, dungDanhSachLich, type BuoiLich } from "./hv-lich-thuan";

const NOW = new Date("2026-11-05T03:00:00Z"); // Thứ Năm 05/11, 10:00 giờ VN
const b = (order: number, dateISO: string, p: Partial<BuoiLich> = {}): BuoiLich => ({
  id: `s${order}`,
  order,
  title: `Bài ${order}`,
  dateISO,
  past: false,
  attendance: "FUTURE",
  ...p,
});

const buoi: BuoiLich[] = [
  b(5, "2026-10-17T13:00:00Z", { past: true, attendance: "PRESENT" }),
  b(6, "2026-10-24T13:00:00Z", { past: true, attendance: "ABSENT" }),
  b(7, "2026-10-31T13:00:00Z", { past: true, attendance: "PRESENT" }),
  b(8, "2026-11-07T13:00:00Z"),
  b(9, "2026-11-14T13:00:00Z", { title: "Buổi học" }),
  b(10, "2026-11-21T13:00:00Z", { title: "Demo cuối học phần" }),
  b(11, "2026-11-28T13:00:00Z", { attendance: "CANCELLED" }),
  b(12, "2026-12-05T13:00:00Z"),
];

describe("danh sách lịch", () => {
  const { sapToi, daHoc } = dungDanhSachLich(buoi, "s8", NOW);
  it("[HVL-01] sắp tới: buổi tiếp theo đứng đầu, bỏ buổi huỷ, tối đa 5", () => {
    expect(sapToi.map((d) => d.n)).toEqual([8, 9, 10, 12]);
    expect(sapToi[0]).toMatchObject({ chip: "tiep", tiep: true, ngay: "T7, 07/11", ten: "Bài 8" });
  });
  it("[HVL-02] bài chưa có tên ⇒ ten null (chữ mờ), buổi demo ⇒ chip 'Em trình bày'", () => {
    expect(sapToi.find((d) => d.n === 9)?.ten).toBeNull();
    expect(sapToi.find((d) => d.n === 10)?.chip).toBe("trinh-bay");
    expect(sapToi.find((d) => d.n === 12)?.chip).toBe("sap");
  });
  it("[HVL-03] đã học: mới nhất trước, chip theo điểm danh, nhãn 'N tuần trước' theo ngày lịch", () => {
    expect(daHoc.map((d) => d.n)).toEqual([7, 6, 5]);
    expect(daHoc[0]).toMatchObject({ chip: "co-mat", ngay: "T7 · 5 ngày trước" });
    expect(daHoc[1]).toMatchObject({ chip: "vang", ngay: "T7 · 2 tuần trước" });
  });
  it("[HVL-04] đã học bù / chưa chấm có chip riêng, không lẫn thành 'Có mặt'", () => {
    const r = dungDanhSachLich(
      [b(1, "2026-10-01T13:00:00Z", { past: true, attendance: "MAKEUP" }), b(2, "2026-10-08T13:00:00Z", { past: true, attendance: "UNMARKED" })],
      null,
      NOW,
    );
    expect(r.daHoc.map((d) => d.chip)).toEqual(["chua-cham", "da-bu"]);
    expect(r.sapToi).toHaveLength(0);
  });
  it("[HVL-05] quá 5 buổi thì chỉ lấy 5 buổi gần nhất của mỗi tab", () => {
    const nhieu = Array.from({ length: 9 }, (_, i) => b(i + 1, `2026-12-${String(i + 6).padStart(2, "0")}T13:00:00Z`));
    expect(dungDanhSachLich(nhieu, "s1", NOW).sapToi).toHaveLength(5);
    const qua = Array.from({ length: 9 }, (_, i) => b(i + 1, `2026-10-${String(i + 1).padStart(2, "0")}T13:00:00Z`, { past: true, attendance: "PRESENT" }));
    const d = dungDanhSachLich(qua, null, NOW).daHoc;
    expect(d.map((x) => x.n)).toEqual([9, 8, 7, 6, 5]);
  });
});

describe("chi tiết ngày", () => {
  const ct = chiTietCacNgay(buoi, "s8", "20:00 - 21:00");
  it("[HVL-06] khoá theo ngày LỊCH VN (13:00Z = 20:00 VN cùng ngày), nhãn có thứ", () => {
    expect(ct["2026-11-07"]).toMatchObject({ n: 8, nhanNgay: "T7, 07/11 · 20:00 - 21:00", ghi: "Buổi tiếp theo của em" });
    expect(ct["2026-10-31"]?.ghi).toBe("Em đã học buổi này · có mặt");
    expect(ct["2026-10-24"]?.ghi).toBe("Em vắng buổi này · sẽ học bù");
    expect(ct["2026-11-14"]?.ghi).toBe("Sắp tới");
  });
  it("[HVL-07] buổi đã huỷ không có chi tiết (ngày đó trống), buổi chưa có tên ⇒ ten null", () => {
    expect(ct["2026-11-28"]).toBeUndefined();
    expect(ct["2026-11-14"]?.ten).toBeNull();
  });
  it("[HVL-08] buổi 02:00 sáng VN (19:00Z hôm trước) rơi đúng ngày VN, không lùi ngày", () => {
    const x = chiTietCacNgay([b(1, "2026-11-06T19:00:00Z")], null, null);
    expect(Object.keys(x)).toEqual(["2026-11-07"]);
  });
});

describe("dòng lịch học", () => {
  it("[HVL-09] ghép thứ · giờ · phòng, thiếu mảnh nào bỏ mảnh đó, thiếu hết ⇒ null", () => {
    expect(dongLichHoc({ thuDayDu: "Thứ Bảy", gio: "20:00 - 21:00", phong: "P302" })).toBe("Em học Thứ Bảy · 20:00 - 21:00 · P302");
    expect(dongLichHoc({ thuDayDu: "Thứ Bảy", gio: null, phong: null })).toBe("Em học Thứ Bảy");
    expect(dongLichHoc({ thuDayDu: null, gio: null, phong: null })).toBeNull();
  });
});
