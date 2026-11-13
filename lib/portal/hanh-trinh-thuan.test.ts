import { describe, expect, it } from "vitest";
import {
  dungDongBai,
  dungLuoiThang,
  gomTheoHocPhan,
  idBuoiMoc,
  thangKe,
  type BuoiHanhTrinh,
} from "@/lib/portal/hanh-trinh-thuan";

const NOW = new Date("2026-11-01T03:00:00.000Z"); // CN 01/11/2026 10:00 VN

const buoi = (o: Partial<BuoiHanhTrinh> & { id: string }): BuoiHanhTrinh => ({
  order: 1,
  tieuDe: "Bài",
  dateISO: "2026-10-01T10:00:00.000Z",
  nhanThu: "T5",
  ngayNgan: "01/10",
  past: true,
  today: false,
  attendance: "PRESENT",
  hocPhan: "HP1",
  ...o,
});

describe("[HT-01] dungDongBai", () => {
  const base = { tiepTheoId: "n", canBuIds: new Set<string>(["v1"]), mocIds: new Set<string>(["m"]), now: NOW };
  it("có mặt / vắng chờ bù / vắng thường / chưa chấm / huỷ", () => {
    expect(dungDongBai(buoi({ id: "a" }), base).trangThai).toBe("xong");
    expect(dungDongBai(buoi({ id: "v1", attendance: "EXCUSED" }), base).trangThai).toBe("vang-cho-bu");
    expect(dungDongBai(buoi({ id: "v2", attendance: "EXCUSED" }), base).trangThai).toBe("vang");
    expect(dungDongBai(buoi({ id: "c", attendance: "UNMARKED" }), base).trangThai).toBe("chua-cham");
    expect(dungDongBai(buoi({ id: "h", attendance: "CANCELLED" }), base).trangThai).toBe("huy");
  });
  it("buổi tiếp theo ≤ 7 ngày = 'Tuần này', xa hơn = 'Buổi kế tiếp'", () => {
    const gan = buoi({ id: "n", attendance: "FUTURE", past: false, dateISO: "2026-11-05T10:00:00.000Z" });
    const xa = buoi({ id: "n", attendance: "FUTURE", past: false, dateISO: "2026-12-05T10:00:00.000Z" });
    expect(dungDongBai(gan, base).nhan).toBe("Tuần này");
    expect(dungDongBai(xa, base).nhan).toBe("Buổi kế tiếp");
  });
  it("buổi trong mocIds chưa tới (không phải buổi tiếp) là mốc lớn — KHÔNG còn nhận theo tên «Demo…»; bài không tên báo chuaCoTen", () => {
    const d = dungDongBai(buoi({ id: "m", attendance: "FUTURE", past: false, tieuDe: "Báo cáo cuối học phần" }), base);
    expect(d.trangThai).toBe("moc");
    expect(d.laMoc).toBe(true);
    const demo = dungDongBai(buoi({ id: "d11", attendance: "FUTURE", past: false, tieuDe: "Demo cuối học phần" }), base);
    expect(demo.trangThai).toBe("sap");
    expect(demo.laMoc).toBe(false);
    expect(dungDongBai(buoi({ id: "k", tieuDe: "" }), base).chuaCoTen).toBe(true);
  });
});

describe("[HT-04] mốc lớn = buổi CUỐI của mỗi học phần (chủ dự án 13/11/2026: buổi 12, không phải buổi 11)", () => {
  const b = (id: string, order: number, hocPhan: string | null, attendance: BuoiHanhTrinh["attendance"] = "FUTURE") => ({ id, order, hocPhan, attendance });
  it("[HT-04a] khoá 48 buổi: mốc là buổi 12 · 24 (bài 11 «Demo…» KHÔNG phải mốc)", () => {
    const ds = [
      ...Array.from({ length: 12 }, (_, i) => b(`hp1-${i + 1}`, i + 1, "HP1")),
      ...Array.from({ length: 12 }, (_, i) => b(`hp2-${i + 13}`, i + 13, "HP2")),
    ];
    expect([...idBuoiMoc(ds)].sort()).toEqual(["hp1-12", "hp2-24"]);
  });
  it("[HT-04b] buổi cuối bị HUỶ ⇒ mốc lùi về buổi cuối còn diễn ra; khoá không chia học phần ⇒ không có mốc", () => {
    expect([...idBuoiMoc([b("a", 11, "HP1"), b("z", 12, "HP1", "CANCELLED")])]).toEqual(["a"]);
    expect(idBuoiMoc([b("x", 1, null), b("y", 2, null)]).size).toBe(0);
  });
  it("[HT-04c] không phụ thuộc thứ tự đầu vào", () => {
    expect([...idBuoiMoc([b("c", 12, "HP1"), b("a", 1, "HP1"), b("b", 7, "HP1")])]).toEqual(["c"]);
  });
});

describe("[HT-02] gomTheoHocPhan", () => {
  const ctx = { tiepTheoId: "p", canBuIds: new Set<string>(), mocIds: new Set<string>(), now: NOW };
  const mk = (id: string, hp: string | null, ngay: string, past: boolean) =>
    dungDongBai(buoi({ id, hocPhan: hp, dateISO: ngay, past, attendance: past ? "PRESENT" : "FUTURE", order: Number(id.replace(/\D/g, "")) || 1 }), ctx);
  it("học phần đã/đang học mở chi tiết, học phần xa chỉ liệt kê", () => {
    const r = gomTheoHocPhan([
      mk("a1", "HP1", "2026-10-01T10:00:00Z", true),
      mk("p2", "HP1", "2026-11-05T10:00:00Z", false),
      mk("b3", "HP2", "2027-01-05T10:00:00Z", false),
    ]);
    expect(r.map((h) => [h.ma, h.chiTiet])).toEqual([["HP1", true], ["HP2", false]]);
    expect(r[0]).toMatchObject({ ten: "Học phần 1", tong: 2, daHoc: 1 });
  });
  it("khoá không chia học phần ⇒ một nhóm 'Lộ trình', không bịa 'Học phần 1'", () => {
    const r = gomTheoHocPhan([mk("a1", null, "2026-10-01T10:00:00Z", true)]);
    expect(r).toHaveLength(1);
    expect(r[0]?.ten).toBe("Lộ trình");
  });
  it("buổi huỷ không tính vào tổng", () => {
    const huy = dungDongBai(buoi({ id: "h", attendance: "CANCELLED", past: false }), ctx);
    expect(gomTheoHocPhan([mk("a1", "HP1", "2026-10-01T10:00:00Z", true), huy])[0]?.tong).toBe(1);
  });
});

describe("[HT-03] lưới lịch tháng", () => {
  it("42 ô, tuần bắt đầu Thứ Hai: 01/11/2026 (Chủ nhật) nằm ở ô cuối hàng đầu", () => {
    const o = dungLuoiThang(2026, 10, [], null, NOW);
    expect(o).toHaveLength(42);
    expect(o[6]).toMatchObject({ ngay: 1, trongThang: true, homNay: true });
    expect(o[0]?.trongThang).toBe(false);
  });
  it("kiểu ngày: tiếp > xong > sắp; buổi huỷ bị bỏ", () => {
    const o = dungLuoiThang(
      2026,
      10,
      [
        { id: "x", dateISO: "2026-11-03T10:30:00.000Z", past: true, huy: false },
        { id: "n", dateISO: "2026-11-07T13:00:00.000Z", past: false, huy: false },
        { id: "s", dateISO: "2026-11-14T13:00:00.000Z", past: false, huy: false },
        { id: "h", dateISO: "2026-11-21T13:00:00.000Z", past: false, huy: true },
      ],
      "n",
      NOW,
    );
    const k = (d: number) => o.find((c) => c.trongThang && c.ngay === d)?.kieu;
    expect(k(3)).toBe("xong");
    expect(k(7)).toBe("tiep");
    expect(k(14)).toBe("sap");
    expect(k(21)).toBe("khong");
  });
  it("thangKe qua năm", () => {
    expect(thangKe(2026, 11, 1)).toEqual({ y: 2027, m0: 0 });
    expect(thangKe(2026, 0, -1)).toEqual({ y: 2025, m0: 11 });
  });
});
