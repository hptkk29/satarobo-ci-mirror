// @vitest-environment node
/**
 * XEM TRƯỚC giá theo phạm vi học (form tạo đơn) — phần THUẦN. Điều phải giữ:
 *   · xem trước = CÙNG planner với đường tạo đơn thật, chỉ bỏ MỘT bước (đối chiếu đơn giá khách gõ);
 *   · số xem trước ĐƯA VÀO đường thật thì được chấp nhận (vòng tròn) — nếu không, nút "Áp giá" dẫn sale vào đúng lỗi nó sinh ra để tránh;
 *   · đường tạo đơn thật VẪN từ chối đơn giá lệch (xem trước không phải cổng thứ hai, cũng không làm yếu cổng).
 * Ngày TUYỆT ĐỐI (luật 19): cửa sổ PL02 hết 31/12/2026.
 */
import { describe, expect, it } from "vitest";
import { keHoachDon, xemTruocKeHoachDon, type BoiCanhDon, type DongVao } from "./ke-hoach-don";
import { ketQuaXemTruoc } from "./xem-truoc";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";

const B = (o: Partial<BoiCanhDon> = {}): BoiCanhDon => ({
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: new Date("2026-10-11T03:00:00Z"),
  coKeHoachDot: false,
  ...o,
});
const D = (o: Partial<DongVao> = {}): DongVao => ({
  loai: "COURSE_ENROLLMENT",
  tenDong: "Sata 3",
  soLuong: 1,
  donGiaKhach: 10_560_000, // GIÁ NIÊM YẾT — đúng thứ form điền sẵn khi chọn khoá, và KHÔNG phải số máy chủ tính
  soKhoanGiam: 0,
  laLopNhom: true,
  tongSoBuoiKhoa: 48,
  soBuoiMua: 48,
  gia48: 10_560_000,
  conKhoa: "a",
  ...o,
});

describe("[P6-10] xem trước bỏ ĐÚNG bước đối chiếu đơn giá, không bước nào khác", () => {
  it("đơn giá khách = niêm yết (form điền sẵn): đường thật TỪ CHỐI và nói số đúng; xem trước trả SCOPE với số đó", () => {
    const that = keHoachDon([D()], B());
    expect(that).toMatchObject({ kieu: "REJECT" });
    expect((that as { thongBao: string }).thongBao).toContain("đơn giá phải là 8.976.000đ");

    const truoc = xemTruocKeHoachDon([D()], B());
    expect(truoc).toMatchObject({ kieu: "SCOPE", dong: [{ soBuoi: 48, loaiMua: "FULL", niemYet: 10_560_000, thanhTien: 8_976_000 }] });
  });
  it("[đối chiếu dương] đơn giá ĐÚNG ⇒ hai đường cho CÙNG một kết quả, từng trường", () => {
    for (const soBuoi of [12, 24, 36, 48]) {
      const truoc = xemTruocKeHoachDon([D({ soBuoiMua: soBuoi })], B());
      expect(truoc.kieu).toBe("SCOPE");
      const gia = (truoc as Extract<typeof truoc, { kieu: "SCOPE" }>).dong[0]!.thanhTien;
      expect(keHoachDon([D({ soBuoiMua: soBuoi, donGiaKhach: gia })], B())).toEqual(truoc);
    }
  });
  it("hai con: giá mỗi dòng theo thứ hạng; số xem trước đưa vào đường thật được CHẤP NHẬN (vòng tròn)", () => {
    const dong = [D({ conKhoa: "a" }), D({ tenDong: "Sata 4", conKhoa: "b", gia48: 11_520_000 })];
    const truoc = xemTruocKeHoachDon(dong, B());
    expect(truoc.kieu).toBe("SCOPE");
    const gia = (truoc as Extract<typeof truoc, { kieu: "SCOPE" }>).dong.map((d) => d.thanhTien);
    expect(new Set(gia).size).toBe(2);
    const that = keHoachDon(dong.map((d, i) => ({ ...d, donGiaKhach: gia[i]! })), B());
    expect(that).toEqual(truoc);
  });
});

describe("[P6-11] mọi từ chối KHÁC vẫn nguyên vẹn ở xem trước — nó không phải đường lách", () => {
  const nhu = (dong: DongVao[], b = B()) => {
    // Cho đúng giá để so từ chối còn lại; dùng chính xem trước để biết số đúng khi dòng tính được.
    return [xemTruocKeHoachDon(dong, b), keHoachDon(dong, b)] as const;
  };
  it("cờ TẮT ⇒ LEGACY ở cả hai", () => {
    const [a, b] = nhu([D()], B({ phamViBat: false }));
    expect(a).toEqual({ kieu: "LEGACY" });
    expect(b).toEqual({ kieu: "LEGACY" });
  });
  it("[20/10/2026] khoản giảm thêm trên dòng SCOPE KHÔNG còn REJECT — xem trước và đường thật đều ra SCOPE y hệt dòng không khoản (giá do máy chủ tính, khoản thêm nằm ngoài planner)", () => {
    const [xemTruoc] = nhu([D({ soKhoanGiam: 1 })]);
    expect(xemTruoc).toMatchObject({ kieu: "SCOPE" });
    expect(xemTruoc).toEqual(xemTruocKeHoachDon([D({ soKhoanGiam: 0 })], B()));
    // Đường thật (có đối chiếu giá): đơn giá ĐÚNG số máy chủ tính + có khoản thêm ⇒ SCOPE, không phải REJECT.
    if (xemTruoc.kieu !== "SCOPE") throw new Error("không phải SCOPE");
    const gia = xemTruoc.dong[0]!.thanhTien;
    expect(keHoachDon([D({ soKhoanGiam: 2, donGiaKhach: gia })], B())).toMatchObject({ kieu: "SCOPE" });
  });
  it("số lượng ≠ 1, số buổi lẻ, Coach ⇒ REJECT cùng một câu", () => {
    for (const o of [{ soLuong: 2 }, { soBuoiMua: 20 }, { laLopNhom: false }, { soBuoiMua: null }] as Partial<DongVao>[]) {
      const [a, b] = nhu([D(o)]);
      expect(a).toMatchObject({ kieu: "REJECT" });
      expect(a).toEqual(b);
    }
  });
  it("đơn trộn ⇒ REJECT cùng một câu; đơn không có dòng 48 ⇒ LEGACY", () => {
    const [a, b] = nhu([D(), D({ tenDong: "Sata 1", tongSoBuoiKhoa: 11, soBuoiMua: 11, conKhoa: "b" })]);
    expect(a).toMatchObject({ kieu: "REJECT" });
    expect(a).toEqual(b);
    const [c, d] = nhu([D({ tongSoBuoiKhoa: 11, soBuoiMua: 11 })]);
    expect(c).toEqual({ kieu: "LEGACY" });
    expect(d).toEqual({ kieu: "LEGACY" });
  });
  it("cửa sổ chính sách: ngoài cửa sổ ⇒ REJECT ở cả hai (xem trước không báo giá cho ngày không được bán)", () => {
    const [a, b] = nhu([D()], B({ taoDon: new Date("2027-01-05T03:00:00Z") }));
    expect(a).toMatchObject({ kieu: "REJECT" });
    expect(a).toEqual(b);
  });
});

/** Ngưỡng của cơ sở đơn (máy chủ đọc bằng `getSetting(..., { orgUnitId })`) — các giá trị KHÁC NHAU để lộ ánh xạ nhầm trường. */
const NGUONG = { tranGiamPhamVi: 25, tranSoDot: 4, tranUuDaiMoiDong: 1, tranTungKhoan: 50 } as const;

describe("[P6-12] ketQuaXemTruoc — hình dạng form đọc", () => {
  it("SCOPE ⇒ từng dòng mang soBuoi, loaiMua, niêm yết, % giảm, thành tiền; cùng thứ tự đầu vào", () => {
    const dong = [D({ soBuoiMua: 12 }), D({ tenDong: "Sata 4", conKhoa: "b", gia48: 11_520_000, soBuoiMua: 48 })];
    const kq = ketQuaXemTruoc(xemTruocKeHoachDon(dong, B()), NGUONG);
    expect(kq).toMatchObject({ ok: true, kieu: "SCOPE" });
    if (kq.ok !== true || kq.kieu !== "SCOPE") throw new Error("không phải SCOPE");
    expect(kq.nguong).toEqual(NGUONG); // ngưỡng của cơ sở đi nguyên vẹn tới form (không rơi, không đổi trường)
    expect(kq.dong.map((d) => d.soBuoi)).toEqual([12, 48]);
    expect(kq.dong.map((d) => d.loaiMua)).toEqual(["MILESTONE", "FULL"]);
    // Từng con số khớp planner — không chỉ "hợp lý" (thành tiền ≤ niêm yết đúng cả khi đọc nhầm sang cột niêm yết).
    const goc = xemTruocKeHoachDon(dong, B());
    if (goc.kieu !== "SCOPE") throw new Error("không phải SCOPE");
    expect(kq.dong.map((d) => d.thanhTien)).toEqual(goc.dong.map((d) => d.thanhTien));
    expect(kq.dong.map((d) => d.niemYet)).toEqual(goc.dong.map((d) => d.niemYet));
    expect(kq.dong.map((d) => d.phanTramApDung)).toEqual(goc.dong.map((d) => d.pricingSnapshot.phanTramApDung));
    expect(kq.dong[1]!.thanhTien).toBeLessThan(kq.dong[1]!.niemYet); // dòng 48 buổi của con thứ hai có giảm ⇒ khác niêm yết (bắt ánh xạ nhầm cột)
    for (const d of kq.dong) {
      expect(Number.isInteger(d.thanhTien) && d.thanhTien > 0).toBe(true);
      expect(d.thanhTien).toBeLessThanOrEqual(d.niemYet);
      expect(d.phanTramApDung).toBeGreaterThanOrEqual(0);
    }
  });
  it("[P6-12b] SCOPE mà thiếu ngưỡng ⇒ NÉM (lỗi lập trình), không trả kết quả thiếu im lặng", () => {
    expect(() => ketQuaXemTruoc(xemTruocKeHoachDon([D()], B()), null)).toThrow(/thiếu ngưỡng/);
  });
  it("LEGACY và REJECT đi qua nguyên vẹn", () => {
    expect(ketQuaXemTruoc({ kieu: "LEGACY" }, null)).toEqual({ ok: true, kieu: "LEGACY" });
    expect(ketQuaXemTruoc({ kieu: "REJECT", thongBao: "x" }, null)).toEqual({ ok: true, kieu: "REJECT", thongBao: "x" });
  });
});

describe("[PB-K1] xem trước: cổng thứ hạng con nguyên vẹn", () => {
  it("nhiều dòng mà có dòng thiếu con ⇒ REJECT, và là CÙNG kết quả với đường thật", () => {
    const dong = [D({ conKhoa: "a" }), D({ tenDong: "Sata 4", conKhoa: null, gia48: 11_520_000 })];
    const a = xemTruocKeHoachDon(dong, B());
    expect(a).toMatchObject({ kieu: "REJECT" });
    expect(a).toEqual(keHoachDon(dong, B()));
  });
});
