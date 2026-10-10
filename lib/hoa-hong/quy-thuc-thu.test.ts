// @vitest-environment node
/**
 * [NHH-TRX-13] — quy thực thu về từng dòng học phí (nền của bước "lần mua trước có thật không").
 * THUẦN; mỗi ca tự dựng dữ liệu (luật 18).
 */
import { describe, it, expect } from "vitest";
import { quyThucThuTheoDong, type ButToanQuy, type DongCuaDon } from "./quy-thuc-thu";

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
});
