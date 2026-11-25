// @vitest-environment node
/**
 * [NHH-TRX-13] — quy thực thu về từng dòng học phí (nền của bước "lần mua trước có thật không").
 * THUẦN; mỗi ca tự dựng dữ liệu (luật 18).
 */
import { describe, it, expect } from "vitest";
import { quyKhoanTheoDong, quyThucThuTheoDong, type ButToanQuy, type DongCuaDon } from "./quy-thuc-thu";

const hocPhi = (id: string, orderId: string, enrollmentId: string | null = null): DongCuaDon => ({
  orderItemId: id,
  orderId,
  laHocPhi: true,
  enrollmentId,
});
const hocCu = (id: string, orderId: string): DongCuaDon => ({ orderItemId: id, orderId, laHocPhi: false, enrollmentId: null });
const bt = (p: Partial<ButToanQuy> & { orderId: string; amount: number }): ButToanQuy => ({
  orderItemId: null,
  enrollmentId: null,
  ...p,
});

describe("[NHH-TRX-13] quyThucThuTheoDong", () => {
  it("[NHH-TRX-13a] bút toán gắn dòng ⇒ cộng đúng dòng; hoàn (âm) trừ ra", () => {
    const r = quyThucThuTheoDong(
      [hocPhi("a", "o1"), hocPhi("b", "o1")],
      [bt({ orderId: "o1", orderItemId: "a", amount: 3_000_000 }), bt({ orderId: "o1", orderItemId: "a", amount: -1_000_000 }), bt({ orderId: "o1", orderItemId: "b", amount: 500 })],
    );
    expect(r.get("a")).toEqual({ thucThu: 2_000_000, moHo: false });
    expect(r.get("b")).toEqual({ thucThu: 500, moHo: false });
  });

  it("[NHH-TRX-13b] bút toán gắn dòng học cụ ⇒ bỏ; dòng học cụ không có kết quả", () => {
    const r = quyThucThuTheoDong([hocPhi("a", "o1"), hocCu("k", "o1")], [bt({ orderId: "o1", orderItemId: "k", amount: 900_000 })]);
    expect(r.get("a")).toEqual({ thucThu: 0, moHo: false });
    expect(r.has("k")).toBe(false);
  });

  it("[NHH-TRX-13c] không gắn dòng nhưng có enrollmentId khớp đúng một dòng học phí ⇒ dòng đó", () => {
    const r = quyThucThuTheoDong(
      [hocPhi("a", "o1", "e-a"), hocPhi("b", "o1", "e-b")],
      [bt({ orderId: "o1", enrollmentId: "e-b", amount: 7_000 })],
    );
    expect(r.get("b")?.thucThu).toBe(7_000);
    expect(r.get("a")).toEqual({ thucThu: 0, moHo: false });
  });

  it("[NHH-TRX-13d] đơn chỉ có MỘT dòng (chính nó): khoản không gắn thuộc dòng đó; đối chứng đơn có thêm dòng học cụ ⇒ KHÔNG đoán, mơ hồ", () => {
    const don1 = quyThucThuTheoDong([hocPhi("a", "o1")], [bt({ orderId: "o1", amount: 4_000 })]);
    expect(don1.get("a")).toEqual({ thucThu: 4_000, moHo: false });

    const donKit = quyThucThuTheoDong([hocPhi("a", "o2"), hocCu("k", "o2")], [bt({ orderId: "o2", amount: 4_000 })]);
    expect(donKit.get("a")).toEqual({ thucThu: 0, moHo: true });
  });

  it("[NHH-TRX-13e] đơn nhiều dòng học phí + khoản chưa gắn ⇒ dòng nào chưa có tiền chắc thì mơ hồ; dòng đã có tiền chắc thì KHÔNG mơ hồ", () => {
    const r = quyThucThuTheoDong(
      [hocPhi("a", "o1"), hocPhi("b", "o1")],
      [bt({ orderId: "o1", amount: 6_000_000 }), bt({ orderId: "o1", orderItemId: "a", amount: 1_000 })],
    );
    expect(r.get("a")).toEqual({ thucThu: 1_000, moHo: false });
    expect(r.get("b")).toEqual({ thucThu: 0, moHo: true });
  });

  it("[NHH-TRX-13f] khoản chưa gắn đã bị hoàn sạch (Σ ≤ 0) ⇒ không mơ hồ", () => {
    const r = quyThucThuTheoDong(
      [hocPhi("a", "o1"), hocPhi("b", "o1")],
      [bt({ orderId: "o1", amount: 6_000_000 }), bt({ orderId: "o1", amount: -6_000_000 })],
    );
    expect(r.get("a")).toEqual({ thucThu: 0, moHo: false });
    expect(r.get("b")).toEqual({ thucThu: 0, moHo: false });
  });

  it("[NHH-TRX-13g] tiền của đơn này không chảy sang đơn khác", () => {
    const r = quyThucThuTheoDong(
      [hocPhi("a", "o1"), hocPhi("b", "o2")],
      [bt({ orderId: "o1", orderItemId: "a", amount: 10 }), bt({ orderId: "o2", amount: 20 })],
    );
    expect(r.get("a")?.thucThu).toBe(10);
    expect(r.get("b")?.thucThu).toBe(20);
  });

  it("[PLD-Q1] quyKhoanTheoDong trả CHÍNH các bút toán đã quy (id + ngày thu giữ nguyên), và tổng từng dòng KHỚP quyThucThuTheoDong ở mọi ca quy", () => {
    const dongs = [hocPhi("a", "o1", "e-a"), hocPhi("b", "o1", "e-b"), hocCu("k", "o1"), hocPhi("c", "o2")];
    const ngay = (n: number) => new Date(`2026-10-0${n}T03:00:00.000Z`);
    const buts = [
      { id: "p1", paidDate: ngay(1), ...bt({ orderId: "o1", orderItemId: "a", amount: 3_000 }) }, // gắn dòng
      { id: "p2", paidDate: ngay(2), ...bt({ orderId: "o1", enrollmentId: "e-b", amount: 2_000 }) }, // qua ghi danh
      { id: "p3", paidDate: ngay(3), ...bt({ orderId: "o1", orderItemId: "a", amount: -1_000 }) }, // hoàn
      { id: "p4", paidDate: ngay(4), ...bt({ orderId: "o1", orderItemId: "k", amount: 900 }) }, // học cụ ⇒ bỏ
      { id: "p5", paidDate: ngay(5), ...bt({ orderId: "o1", amount: 7_000 }) }, // chưa gắn, đơn nhiều dòng ⇒ không dòng nào nhận
      { id: "p6", paidDate: ngay(6), ...bt({ orderId: "o2", amount: 4_000 }) }, // đơn một dòng ⇒ dòng đó
    ];
    const kq = quyKhoanTheoDong(dongs, buts);
    expect(kq.get("a")?.map((x) => x.id)).toEqual(["p1", "p3"]);
    expect(kq.get("b")?.map((x) => x.id)).toEqual(["p2"]);
    expect(kq.get("c")?.map((x) => x.id)).toEqual(["p6"]);
    expect(kq.get("a")?.[0]?.paidDate).toEqual(ngay(1));
    expect(kq.has("k")).toBe(false); // dòng học cụ không có mục
    const tong = quyThucThuTheoDong(dongs, buts);
    for (const [id, ds] of kq) expect(ds.reduce((s, x) => s + x.amount, 0), id).toBe(tong.get(id)?.thucThu);
    // Bút toán p5 (chưa gắn) không xuất hiện ở dòng nào.
    expect([...kq.values()].flat().some((x) => x.id === "p5")).toBe(false);
  });
});
