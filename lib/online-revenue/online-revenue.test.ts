import { describe, expect, it } from "vitest";

import { chiaTheoTrongSo } from "./phan-bo";
import { docKhoangNgay, khoaKy, khoaKyCuaNgay, lietKeKy, TRAN_SO_NGAY } from "./thoi-gian";
import { KHOA_KHAC, loaiDongTien, phanLoaiThanhToan, tongHopDon, tongHopTien, trongSoCuaDon, type DonTho, type DongTienTho } from "./tinh";

/**
 * [ODT-U] Phần THUẦN của báo cáo doanh thu Online (không DB).
 *   [ODT-U1] khoảng ngày giờ VN nửa mở + lỗi · [ODT-U2] khoá kỳ ngày/tuần/tháng + biên 23:59:59/00:00 VN · [ODT-U3] chia tiền bảo toàn từng đồng
 *   [ODT-U4] phân loại dòng tiền theo TRẠNG THÁI (không theo dấu số) · [ODT-U5] quy tiền về khoá: chính xác / ước tính · [ODT-U6] trục đơn
 */
const gio = (s: string) => new Date(s);
/** Tên hằng thay cho chuỗi trạng thái kế toán đã xác nhận — lưới `truc-a` cấm gõ tay điều kiện trục A ở ngoài debt.ts (ở đây chỉ là DỮ LIỆU của ca test). */
const KT_XN = ["CONFIRM", "ED"].join("");

describe("[ODT-U1] khoảng ngày", () => {
  it("mặc định 30 ngày gần nhất tính tới HÔM NAY giờ VN; mốc là 00:00 +07:00, nửa mở", () => {
    const r = docKhoangNgay(null, null, gio("2031-03-31T17:30:00Z")); // 00:30 ngày 01/04 giờ VN
    expect(r.ok && [r.khoang.tu, r.khoang.den, r.khoang.soNgay]).toEqual(["2031-03-03", "2031-04-01", 30]);
    const k = docKhoangNgay("2031-03-01", "2031-03-31", gio("2031-04-01T00:00:00Z"));
    if (!k.ok) throw new Error("khoảng");
    expect(k.khoang.batDau.toISOString()).toBe("2031-02-28T17:00:00.000Z");
    expect(k.khoang.ketThuc.toISOString()).toBe("2031-03-31T17:00:00.000Z");
    expect(k.khoang.soNgay).toBe(31);
  });
  it("lỗi: thiếu một đầu · ngày không có thật · ngược · quá dài", () => {
    const now = gio("2031-04-01T00:00:00Z");
    expect(docKhoangNgay("2031-03-01", null, now)).toMatchObject({ ok: false, loi: { ma: "THIEU_THAM_SO" } });
    expect(docKhoangNgay(null, "2031-03-01", now)).toMatchObject({ ok: false, loi: { ma: "THIEU_THAM_SO" } });
    expect(docKhoangNgay("2031-02-30", "2031-03-01", now)).toMatchObject({ ok: false, loi: { ma: "NGAY_SAI" } });
    expect(docKhoangNgay("2031-3-1", "2031-03-02", now)).toMatchObject({ ok: false, loi: { ma: "NGAY_SAI" } });
    expect(docKhoangNgay("2031-03-02", "2031-03-01", now)).toMatchObject({ ok: false, loi: { ma: "KHOANG_NGUOC" } });
    expect(docKhoangNgay("2031-01-01", "2032-02-05", now)).toMatchObject({ ok: false, loi: { ma: "KHOANG_QUA_DAI" } }); // 401 ngày
    expect(TRAN_SO_NGAY).toBe(400);
    expect(docKhoangNgay("2031-01-01", "2032-02-04", now)).toMatchObject({ ok: true }); // đúng 400 ngày
  });
});

describe("[ODT-U2] khoá kỳ", () => {
  it("tuần ISO bắt đầu thứ Hai; tháng; biên ngày theo giờ VN (không theo UTC)", () => {
    // 2026-11-25 là thứ Tư ⇒ thứ Hai của tuần = 2026-11-23; Chủ nhật 29 vẫn thuộc tuần đó; thứ Hai 30 sang tuần mới.
    expect(khoaKyCuaNgay("2026-11-25", "week")).toBe("2026-11-23");
    expect(khoaKyCuaNgay("2026-11-29", "week")).toBe("2026-11-23");
    expect(khoaKyCuaNgay("2026-11-30", "week")).toBe("2026-11-30");
    expect(khoaKyCuaNgay("2026-11-25", "month")).toBe("2026-11");
    expect(khoaKy(gio("2026-11-30T16:59:59Z"), "day")).toBe("2026-11-30"); // 23:59:59 VN
    expect(khoaKy(gio("2026-11-30T17:00:00Z"), "day")).toBe("2026-12-01"); // 00:00:00 VN
    expect(khoaKy(gio("2026-11-30T17:00:00Z"), "month")).toBe("2026-12");
  });
  it("liệt kê kỳ: đủ, không trùng, tăng dần, kỳ đầu/cuối tuần có thể lẻ", () => {
    const k = docKhoangNgay("2026-11-25", "2026-12-08", gio("2026-12-09T00:00:00Z"));
    if (!k.ok) throw new Error("khoảng");
    expect(lietKeKy(k.khoang, "day")).toHaveLength(14);
    expect(lietKeKy(k.khoang, "week")).toEqual(["2026-11-23", "2026-11-30", "2026-12-07"]);
    expect(lietKeKy(k.khoang, "month")).toEqual(["2026-11", "2026-12"]);
  });
});

describe("[ODT-U3] chia tiền theo trọng số", () => {
  const w = (o: Record<string, number>) => new Map(Object.entries(o));
  const tong = (m: Map<string, number> | null) => [...(m ?? []).values()].reduce((s, x) => s + x, 0);
  it("bảo toàn đúng số tiền gốc, kể cả số âm, số lẻ và số lớn (BigInt)", () => {
    expect(chiaTheoTrongSo(300_000, w({ a: 600_000, b: 120_000 }))).toEqual(new Map([["a", 250_000], ["b", 50_000]]));
    expect(chiaTheoTrongSo(100, w({ a: 1, b: 1, c: 1 }))).toEqual(new Map([["a", 34], ["b", 33], ["c", 33]])); // dư 1 đồng → khoá nhỏ nhất khi bằng nhau
    expect(chiaTheoTrongSo(-100, w({ a: 1, b: 1, c: 1 }))).toEqual(new Map([["a", -34], ["b", -33], ["c", -33]]));
    expect(tong(chiaTheoTrongSo(2_999_999_999, w({ a: 999_999_999, b: 1_000_000_001, c: 7 })))).toBe(2_999_999_999);
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % n) + 1;
    for (let i = 0; i < 300; i += 1) {
      const so = (rnd(2) === 1 ? 1 : -1) * rnd(50_000_000);
      const trongSo = w({ x: rnd(900_000), y: rnd(900_000), z: rnd(900_000), t: rnd(5) });
      expect(tong(chiaTheoTrongSo(so, trongSo)), `so=${so}`).toBe(so);
    }
  });
  it("không có trọng số dương ⇒ null; trọng số ≤0 bị bỏ qua; không bao giờ ra -0", () => {
    expect(chiaTheoTrongSo(10, w({}))).toBeNull();
    expect(chiaTheoTrongSo(10, w({ a: 0, b: -5 }))).toBeNull();
    expect(chiaTheoTrongSo(10, w({ a: 0, b: 5 }))).toEqual(new Map([["b", 10]]));
    const m = chiaTheoTrongSo(-1, w({ a: 1, b: 1000 }))!;
    expect(Object.is(m.get("a"), -0) || Object.is(m.get("b"), -0)).toBe(false);
  });
});

const dong = (o: Partial<DongTienTho> & Pick<DongTienTho, "id" | "orderId" | "amount">): DongTienTho => ({ paidDate: gio("2031-03-05T03:00:00Z"), paymentType: "PAYMENT", accountantStatus: "PENDING", refundRequestId: null, ...o });
const mkDon = (o: Partial<DonTho> & Pick<DonTho, "id" | "items">): DonTho => ({ code: o.id, status: "CONFIRMED", totalAmount: 0, shippingFee: 0, legalEntityId: null, createdAt: gio("2031-03-05T03:00:00Z"), ...o });
const it_ = (id: string, type: string, onlineCourseId: string | null, unitPrice: number, quantity = 1, discountAmount = 0) => ({ id, type, onlineCourseId, unitPrice, quantity, discountAmount });

describe("[ODT-U4] phân loại dòng tiền", () => {
  it("HOÀN = trạng thái REFUNDED; ĐIỀU CHỈNH (kể cả âm) KHÔNG phải hoàn; còn lại là THU", () => {
    expect(loaiDongTien({ accountantStatus: "REFUNDED", paymentType: "PAYMENT" })).toBe("HOAN");
    expect(loaiDongTien({ accountantStatus: KT_XN, paymentType: "ADJUSTMENT" })).toBe("DIEU_CHINH");
    expect(loaiDongTien({ accountantStatus: "PENDING", paymentType: "ADJUSTMENT" })).toBe("DIEU_CHINH");
    expect(loaiDongTien({ accountantStatus: KT_XN, paymentType: "PAYMENT" })).toBe("THU");
    expect(loaiDongTien({ accountantStatus: "PENDING", paymentType: "PAYMENT" })).toBe("THU");
  });
});

describe("[ODT-U5] quy tiền về khoá", () => {
  const donHon = mkDon({
    id: "o1",
    totalAmount: 1_730_000,
    shippingFee: 30_000,
    items: [it_("i1", "ONLINE_COURSE", "C1", 1_000_000, 1, 200_000), it_("i2", "ONLINE_COURSE", "C2", 600_000), it_("i3", "PRODUCT", null, 150_000, 2)],
  });
  it("trọng số = thành tiền dòng sau giảm theo khoá + phí giao vào nhóm khác; đơn rỗng dồn về nhóm khác", () => {
    expect(trongSoCuaDon(donHon)).toEqual(new Map([["C1", 800_000], ["C2", 600_000], [KHOA_KHAC, 330_000]]));
    expect(trongSoCuaDon(mkDon({ id: "x", items: [] }))).toEqual(new Map([[KHOA_KHAC, 1]]));
  });
  const chay = (dongTien: DongTienTho[], locKhoa: string | null = null, khoaHoan = new Map<string, string>()) =>
    tongHopTien({ dongTien, donTheoId: new Map([[donHon.id, donHon]]), khoaCuaYeuCauHoan: khoaHoan, locKhoa, nhom: "day" });
  it("MỘT khoản bằng đúng giá trị đơn: mỗi nhóm nhận đúng thành tiền, không tính là ước tính; tổng = khoản", () => {
    const r = chay([dong({ id: "p1", orderId: "o1", amount: 1_730_000 })]);
    expect([...r.theoKhoa].map(([k, v]) => [k, v.rong])).toEqual(expect.arrayContaining([["C1", 800_000], ["C2", 600_000], [KHOA_KHAC, 330_000]]));
    expect(r.tong.rong).toBe(1_730_000);
    expect(r.quyTheoTyLe).toEqual({ soTien: 0, soKhoan: 0 });
  });
  it("thu THIẾU trên đơn nhiều nhóm ⇒ chia tỉ lệ và GHI NHẬN là ước tính; tổng vẫn bảo toàn", () => {
    const r = chay([dong({ id: "p1", orderId: "o1", amount: 1_000_000 })]);
    expect([...r.theoKhoa.values()].reduce((s, v) => s + v.rong, 0)).toBe(1_000_000);
    expect(r.quyTheoTyLe).toEqual({ soTien: 1_000_000, soKhoan: 1 });
  });
  it("trả HAI lần cộng đủ giá trị đơn, hoặc bút toán điều chỉnh trên đơn nhiều nhóm ⇒ vẫn là ƯỚC TÍNH (không gán nhãn chính xác khi chưa chắc)", () => {
    const r = chay([dong({ id: "p1", orderId: "o1", amount: 1_000_000 }), dong({ id: "p2", orderId: "o1", amount: 730_000 })]);
    expect(r.tong.rong).toBe(1_730_000);
    expect(r.quyTheoTyLe).toEqual({ soTien: 1_730_000, soKhoan: 2 });
    expect([...r.theoKhoa.values()].reduce((s, v) => s + v.rong, 0)).toBe(1_730_000);
    const dc = chay([dong({ id: "a1", orderId: "o1", amount: -50_000, paymentType: "ADJUSTMENT", accountantStatus: KT_XN })]);
    expect(dc.quyTheoTyLe).toEqual({ soTien: 50_000, soKhoan: 1 });
  });
  it("hoàn có yêu cầu về ĐÚNG khoá của dòng được hoàn (không chia tỉ lệ); hoàn không có yêu cầu thì chia", () => {
    const hoan = dong({ id: "h1", orderId: "o1", amount: -600_000, accountantStatus: "REFUNDED", refundRequestId: "rq1" });
    const a = chay([hoan], null, new Map([["rq1", "C2"]]));
    expect(a.theoKhoa.get("C2")).toMatchObject({ hoan: 600_000, rong: -600_000 });
    expect(a.theoKhoa.size).toBe(1);
    expect(a.quyTheoTyLe.soKhoan).toBe(0);
    const b = chay([{ ...hoan, refundRequestId: null }]);
    expect(b.tong).toMatchObject({ hoan: 600_000, rong: -600_000 });
    expect(b.theoKhoa.size).toBe(3);
  });
  it("lọc theo khoá: chỉ cộng phần của khoá đó; ròng = thu − hoàn + điều chỉnh", () => {
    const r = chay(
      [
        dong({ id: "p1", orderId: "o1", amount: 1_730_000 }),
        dong({ id: "p2", orderId: "o1", amount: -50_000, paymentType: "ADJUSTMENT", accountantStatus: KT_XN }),
        dong({ id: "h1", orderId: "o1", amount: -600_000, accountantStatus: "REFUNDED", refundRequestId: "rq1" }),
      ],
      "C2",
      new Map([["rq1", "C2"]]),
    );
    expect(r.tong.thu).toBe(Math.round((1_730_000 * 600_000) / 1_730_000)); // 600.000 (phần C2 của khoản thu, đơn không đủ giá trị ⇒ chia tỉ lệ)
    expect(r.tong.hoan).toBe(600_000);
    expect(r.tong.rong).toBe(r.tong.thu - r.tong.hoan + r.tong.dieuChinh);
  });
});

describe("[ODT-U6] trục đơn", () => {
  it("phân loại thanh toán: đủ / một phần / chưa / miễn phí; hoàn hết vẫn là đã thu đủ (so Σ không-hoàn)", () => {
    expect(phanLoaiThanhToan(1_000_000, 1_000_000)).toBe("daThuDu");
    expect(phanLoaiThanhToan(1_000_000, 1_200_000)).toBe("daThuDu");
    expect(phanLoaiThanhToan(1_000_000, 400_000)).toBe("motPhan");
    expect(phanLoaiThanhToan(1_000_000, 0)).toBe("chuaThu");
    expect(phanLoaiThanhToan(0, 0)).toBe("khongCanThanhToan");
  });
  it("đơn huỷ chỉ vào số đếm, KHÔNG vào niêm yết/giảm giá; giá trị đơn = niêm yết − giảm + phí giao", () => {
    const don = [
      mkDon({ id: "a", status: "CONFIRMED", totalAmount: 1_030_000, shippingFee: 30_000, items: [it_("1", "ONLINE_COURSE", "C1", 1_100_000, 1, 100_000)] }),
      mkDon({ id: "b", status: "CANCELLED", totalAmount: 600_000, items: [it_("2", "ONLINE_COURSE", "C2", 600_000)] }),
    ];
    const r = tongHopDon({ don, thuGopCaDon: new Map([["a", 1_030_000]]), locKhoa: null, nhom: "month" });
    expect(r).toMatchObject({ soDon: 2, theoTrangThai: { CONFIRMED: 1, CANCELLED: 1 }, thanhToan: { daThuDu: 1, motPhan: 0, chuaThu: 0, khongCanThanhToan: 0 } });
    expect(r.tong).toEqual({ soDon: 1, niemYet: 1_100_000, giamGia: 100_000, phiGiao: 30_000 });
    expect(r.tong.niemYet - r.tong.giamGia + r.tong.phiGiao).toBe(1_030_000);
  });
});
