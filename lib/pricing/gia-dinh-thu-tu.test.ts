// @vitest-environment node
/**
 * `gia-dinh-thu-tu.ts` — nhận diện gia đình + thứ tự con + thứ tự sản phẩm 48 (D4, chủ dự án chốt 18/10/2026).
 * Mọi ca dùng ngày TUYỆT ĐỐI (luật 19), không đọc đồng hồ. Ví dụ "ngày tạo đơn ≠ ngày tiền về" ở [GDT-17] là đúng ví dụ gửi chủ dự án (docs §12).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { cuaSoHieuLucPL02 } from "./hieu-luc-chinh-sach";
import {
  phanLoaiDangHocTuTruoc,
  xacDinhGiaDinh,
  xetThuTuChoDong,
  type ConTrongGiaDinh,
  type DauVaoThuTu,
  type DongCungDon,
  type HocVienGiaDinh,
  type LanMuaLichSu,
} from "./gia-dinh-thu-tu";

const d = (s: string) => new Date(`${s}+07:00`);
const hv = (id: string, parentUserId: string | null, p1: string | null = null, p2: string | null = null): HocVienGiaDinh => ({
  studentId: id,
  parentUserId,
  parentPhone: p1,
  parent2Phone: p2,
});

describe("[GDT-01..07] xác định gia đình — không bao giờ tự gộp", () => {
  const hoSo = { userId: "U1", phone: "84905123456" };
  const a = hv("A", "U1", "0905123456");
  const b = hv("B", "U1", "84905123456", "0911000111");

  it("[GDT-01] một hồ sơ rõ ràng, SĐT khác định dạng (0… / 84…) vẫn khớp ⇒ XAC_DINH", () => {
    const r = xacDinhGiaDinh({ hocVien: a, hoSo, cacConCungHoSo: [a, b], hocVienKhacHoSoCungSdt: [], hoSoKhacCungSdt: [] });
    expect(r).toEqual({ trangThai: "XAC_DINH", khoaGiaDinh: "U1", hocVienIds: ["A", "B"] });
  });
  it("[GDT-02] chưa liên kết phụ huynh ⇒ CHO_XAC_MINH, không có khoá gia đình", () => {
    const x = hv("X", null, "0905123456");
    const r = xacDinhGiaDinh({ hocVien: x, hoSo: null, cacConCungHoSo: [], hocVienKhacHoSoCungSdt: [a], hoSoKhacCungSdt: [] });
    expect(r).toEqual({ trangThai: "CHO_XAC_MINH", lyDo: [{ ma: "CHUA_LIEN_KET_PHU_HUYNH", hocVienIds: ["X"], hoSoIds: [] }] });
  });
  it("[GDT-03] parentUserId trỏ vào hồ sơ không tồn tại ⇒ CHO_XAC_MINH", () => {
    const r = xacDinhGiaDinh({ hocVien: a, hoSo: null, cacConCungHoSo: [a], hocVienKhacHoSoCungSdt: [], hoSoKhacCungSdt: [] });
    expect(r.trangThai).toBe("CHO_XAC_MINH");
    if (r.trangThai === "CHO_XAC_MINH") expect(r.lyDo[0]?.ma).toBe("HO_SO_PHU_HUYNH_KHONG_TIM_THAY");
  });
  it("[GDT-03b] hồ sơ tra được lại KHÔNG phải hồ sơ mà học viên trỏ tới (tra sai dòng) ⇒ CHO_XAC_MINH, không tin", () => {
    const r = xacDinhGiaDinh({ hocVien: a, hoSo: { userId: "U9", phone: "84905123456" }, cacConCungHoSo: [a], hocVienKhacHoSoCungSdt: [], hoSoKhacCungSdt: [] });
    expect(r.trangThai).toBe("CHO_XAC_MINH");
    if (r.trangThai === "CHO_XAC_MINH") expect(r.lyDo[0]?.ma).toBe("HO_SO_PHU_HUYNH_KHONG_TIM_THAY");
  });
  it("[GDT-04] hai tài khoản phụ huynh cùng SĐT ⇒ TRUNG_HO_SO_PHU_HUYNH, liệt kê cả hai", () => {
    const r = xacDinhGiaDinh({
      hocVien: a,
      hoSo,
      cacConCungHoSo: [a],
      hocVienKhacHoSoCungSdt: [],
      hoSoKhacCungSdt: [{ userId: "U9", phone: "0905123456" }],
    });
    expect(r).toEqual({ trangThai: "CHO_XAC_MINH", lyDo: [{ ma: "TRUNG_HO_SO_PHU_HUYNH", hocVienIds: [], hoSoIds: ["U1", "U9"] }] });
  });
  it("[GDT-05] học viên thuộc hồ sơ khác nhưng cùng SĐT phụ huynh ⇒ CHO_XAC_MINH (có thể là anh chị em bị tách)", () => {
    const khac = hv("K", "U2", "0905123456");
    const r = xacDinhGiaDinh({ hocVien: a, hoSo, cacConCungHoSo: [a], hocVienKhacHoSoCungSdt: [khac], hoSoKhacCungSdt: [] });
    expect(r).toEqual({ trangThai: "CHO_XAC_MINH", lyDo: [{ ma: "HOC_VIEN_KHAC_HO_SO_CUNG_SDT", hocVienIds: ["K"], hoSoIds: [] }] });
  });
  it("[GDT-06] học viên có SĐT phụ huynh mà không số nào khớp hồ sơ ⇒ LECH_SDT_VOI_HO_SO; học viên không có SĐT thì KHÔNG bị nghi", () => {
    const lech = hv("L", "U1", "0987654321", "0976543210");
    const trong = hv("T", "U1");
    const r = xacDinhGiaDinh({ hocVien: a, hoSo, cacConCungHoSo: [a, lech, trong], hocVienKhacHoSoCungSdt: [], hoSoKhacCungSdt: [] });
    expect(r).toEqual({ trangThai: "CHO_XAC_MINH", lyDo: [{ ma: "LECH_SDT_VOI_HO_SO", hocVienIds: ["L"], hoSoIds: ["U1"] }] });
    const ok = xacDinhGiaDinh({ hocVien: a, hoSo, cacConCungHoSo: [a, trong], hocVienKhacHoSoCungSdt: [], hoSoKhacCungSdt: [] });
    expect(ok.trangThai).toBe("XAC_DINH");
  });
  it("[GDT-07] gom nhiều tín hiệu: trả đủ mọi lý do, vẫn không có khoá gia đình", () => {
    const r = xacDinhGiaDinh({
      hocVien: a,
      hoSo,
      cacConCungHoSo: [a, hv("L", "U1", "0987654321")],
      hocVienKhacHoSoCungSdt: [hv("K", "U2", "0905123456")],
      hoSoKhacCungSdt: [{ userId: "U9", phone: "0905123456" }],
    });
    expect(r.trangThai).toBe("CHO_XAC_MINH");
    if (r.trangThai === "CHO_XAC_MINH") {
      expect(r.lyDo.map((l) => l.ma).sort()).toEqual(["HOC_VIEN_KHAC_HO_SO_CUNG_SDT", "LECH_SDT_VOI_HO_SO", "TRUNG_HO_SO_PHU_HUYNH"]);
    }
    expect("khoaGiaDinh" in r).toBe(false);
  });
});

// ─── Thứ tự con / sản phẩm 48 ────────────────────────────────────────────────────────────────────────────────────────
const CUA_SO = cuaSoHieuLucPL02();
const con = (id: string, dang: ConTrongGiaDinh["dangHocTuTruoc"] = "KHONG"): ConTrongGiaDinh => ({ studentId: id, dangHocTuTruoc: dang });
let seq = 0;
const lan = (p: Partial<LanMuaLichSu> & Pick<LanMuaLichSu, "studentId">): LanMuaLichSu => {
  seq += 1;
  return {
    orderItemId: `OI${seq}`,
    orderId: `O${seq}`,
    soBuoi: 24,
    traGopNhieuDot: false,
    conHieuLuc: true,
    taoLuc: d("2026-09-05T09:00:00"),
    ngayTienVe: [d("2026-09-05T10:00:00")],
    ...p,
  };
};
const vao = (p: Partial<DauVaoThuTu> & Pick<DauVaoThuTu, "cacConGiaDinh">): DauVaoThuTu => ({
  coSo: "NGAY_TAO_DON",
  cuaSo: CUA_SO,
  dong: { orderItemId: "NEW1", orderId: "ONEW", studentId: "B", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") },
  lichSu: [],
  cungDon: [],
  phuHuynhChon: null,
  ...p,
});
const lyDoMa = (r: ReturnType<typeof xetThuTuChoDong>) => (r.trangThai === "CHO_XAC_MINH" ? r.lyDo.map((l) => l.ma).sort() : []);
const hang = (r: ReturnType<typeof xetThuTuChoDong>) => (r.trangThai === "XAC_DINH" ? [r.thuTuCon, r.thuTuSanPham48] : r);

describe("[GDT-10..16] thứ tự con", () => {
  it("[GDT-10] gia đình chưa mua gì ⇒ con thứ nhất", () => {
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")] })))).toEqual([1, null]);
  });
  it("[GDT-11] con A đã mua ở đơn trước ⇒ con B là thứ hai; con C là thứ ba", () => {
    const lichSu = [lan({ studentId: "A", taoLuc: d("2026-09-05T09:00:00") }), lan({ studentId: "B", taoLuc: d("2026-09-10T09:00:00") })];
    const cs = [con("A"), con("B"), con("C")];
    const c = xetThuTuChoDong(vao({ cacConGiaDinh: cs, lichSu, dong: { orderItemId: "N", orderId: "ON", studentId: "C", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") } }));
    expect(hang(c)).toEqual([3, null]);
  });
  it("[GDT-12] thứ hạng BỀN theo con: A đã mua đầu tiên, mua lần hai vẫn là con thứ nhất dù B mua sau", () => {
    const lichSu = [lan({ studentId: "A", taoLuc: d("2026-09-05T09:00:00") }), lan({ studentId: "B", taoLuc: d("2026-09-10T09:00:00") })];
    const r = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu, dong: { orderItemId: "N", orderId: "ON", studentId: "A", soBuoi: 12, taoLuc: d("2026-10-01T09:00:00") } }));
    expect(hang(r)).toEqual([1, null]);
  });
  it("[GDT-13] con đang học từ trước (chưa mua trong đợt) tính là con thứ nhất ⇒ con mới là thứ hai", () => {
    const r = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A", "CO"), con("B")] }));
    expect(hang(r)).toEqual([2, null]);
    if (r.trangThai === "XAC_DINH") expect(r.canCu.conDungTruoc).toEqual(["A"]);
  });
  it("[GDT-14] hai con đang học từ trước: con mới là thứ ba; còn khi chính dòng này là của một trong hai ⇒ CHO_XAC_MINH (không biết ai thứ nhất)", () => {
    const cs = [con("A", "CO"), con("C", "CO"), con("B")];
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: cs })))).toEqual([3, null]);
    const r = xetThuTuChoDong(vao({ cacConGiaDinh: cs, dong: { orderItemId: "N", orderId: "ON", studentId: "A", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") } }));
    expect(lyDoMa(r)).toEqual(["NHIEU_CON_DANG_HOC_TU_TRUOC"]);
  });
  it("[GDT-14b] chỉ MỘT con đang học từ trước và chính dòng này là của con đó ⇒ vẫn là con thứ nhất, kể cả khi con khác đã mua trong đợt", () => {
    const daMua = lan({ studentId: "B", taoLuc: d("2026-09-05T09:00:00") });
    const r = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A", "CO"), con("B")], lichSu: [daMua], dong: { orderItemId: "N", orderId: "ON", studentId: "A", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") } }));
    expect(hang(r)).toEqual([1, null]);
  });
  it("[GDT-15] con từng ghi danh nhưng chưa rõ đang học ⇒ CHO_XAC_MINH (không đoán)", () => {
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A", "KHONG_RO"), con("B")] })))).toEqual(["CON_DANG_HOC_TU_TRUOC_KHONG_RO"]);
  });
  it("[GDT-16] mua CÙNG LÚC hai con: thiếu lựa chọn của phụ huynh ⇒ CHO_XAC_MINH; có lựa chọn ⇒ theo lựa chọn (kể cả khoá rẻ đứng đầu); lựa chọn sai ⇒ CHO_XAC_MINH", () => {
    const cungDon: DongCungDon[] = [{ orderItemId: "NEW2", studentId: "C", soBuoi: 48 }];
    const cs = [con("B"), con("C")];
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: cs, cungDon })))).toEqual(["CUNG_LUC_CHUA_CHON_THU_TU"]);
    const chon = (thuTuCon: string[]) => ({ thuTuCon, thuTuSanPham48: [], ghiBoiUserId: "U-sale", ghiLuc: d("2026-10-01T09:05:00") });
    const b1 = xetThuTuChoDong(vao({ cacConGiaDinh: cs, cungDon, phuHuynhChon: chon(["B", "C"]) }));
    expect(hang(b1)).toEqual([1, null]);
    if (b1.trangThai === "XAC_DINH") expect(b1.canCu.phuHuynhChon?.ghiBoiUserId).toBe("U-sale"); // truy được ai ghi lựa chọn
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: cs, cungDon, phuHuynhChon: chon(["C", "B"]) })))).toEqual([2, null]);
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: cs, cungDon, phuHuynhChon: chon(["B"]) })))).toEqual(["LUA_CHON_KHONG_HOP_LE"]);
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: cs, cungDon, phuHuynhChon: chon(["B", "B"]) })))).toEqual(["LUA_CHON_KHONG_HOP_LE"]);
    // lựa chọn THỪA phần tử (một con không thuộc nhóm mua cùng lúc) cũng không hợp lệ
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: cs, cungDon, phuHuynhChon: chon(["B", "C", "X"]) })))).toEqual(["LUA_CHON_KHONG_HOP_LE"]);
  });
});

describe("[GDT-17..24] cơ sở thứ tự, cửa sổ chương trình, dữ liệu thiếu", () => {
  // Ví dụ gửi chủ dự án: đơn của A tạo trước nhưng tiền về SAU đơn của B.
  const donA = lan({ studentId: "A", soBuoi: 24, taoLuc: d("2026-09-05T09:00:00"), ngayTienVe: [d("2026-09-20T09:00:00")] });
  const donB = lan({ studentId: "B", soBuoi: 24, taoLuc: d("2026-09-10T09:00:00"), ngayTienVe: [d("2026-09-12T09:00:00")] });
  const dongB = { orderItemId: "N", orderId: "ON", studentId: "B", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") };

  it("[GDT-17] hai cơ sở cho hai đáp án KHÁC NHAU: B là con thứ HAI theo ngày tạo đơn, nhưng là con thứ NHẤT theo ngày tiền về", () => {
    const cs = [con("A"), con("B")];
    expect(hang(xetThuTuChoDong(vao({ coSo: "NGAY_TAO_DON", cacConGiaDinh: cs, lichSu: [donA, donB], dong: dongB })))).toEqual([2, null]);
    expect(hang(xetThuTuChoDong(vao({ coSo: "NGAY_TIEN_VE", cacConGiaDinh: cs, lichSu: [donA, donB], dong: dongB })))).toEqual([1, null]);
  });
  it("[GDT-18] ngoài cửa sổ 01/09–31/12/2026 không tính vào lịch sử (trước 01/09; từ 01/01/2027)", () => {
    const truoc = lan({ studentId: "A", taoLuc: d("2026-08-31T23:59:59"), ngayTienVe: [] });
    const sau = lan({ studentId: "A", taoLuc: d("2027-01-01T00:00:00"), ngayTienVe: [] });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [truoc, sau] })))).toEqual([1, null]);
    // mép TRÊN phải đo với dòng đang xét tạo SAU mép (nếu không, lần mua đứng sau dòng đang xét nên không đổi hạng dù có bị tính nhầm)
    const dongSauMep = { orderItemId: "N", orderId: "ON", studentId: "B", soBuoi: 24, taoLuc: d("2027-01-02T00:00:00") };
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [sau], dong: dongSauMep })))).toEqual([1, null]);
    const sauMotGiay = lan({ studentId: "A", taoLuc: d("2026-12-31T23:59:59"), ngayTienVe: [] });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [sauMotGiay], dong: dongSauMep })))).toEqual([2, null]);
    // Hai mép TRONG cửa sổ vẫn tính: đúng 00:00 ngày 01/09 và 23:00 ngày 31/12 (dòng đang xét tạo sau đó).
    const matDau = lan({ studentId: "A", taoLuc: d("2026-09-01T00:00:00"), ngayTienVe: [] });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [matDau] })))).toEqual([2, null]);
    const matCuoi = lan({ studentId: "A", taoLuc: d("2026-12-31T23:00:00"), ngayTienVe: [] });
    const dongCuoi = { orderItemId: "N", orderId: "ON", studentId: "B", soBuoi: 24, taoLuc: d("2026-12-31T23:59:59") };
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [matCuoi], dong: dongCuoi })))).toEqual([2, null]);
  });
  it("[GDT-19] đơn đã huỷ / hoàn không tính", () => {
    const huy = lan({ studentId: "A", conHieuLuc: false });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [huy] })))).toEqual([1, null]);
  });
  it("[GDT-20] theo ngày tiền về: đơn của anh chị chưa có tiền không tính, đánh dấu TẠM TÍNH và nêu đơn nào", () => {
    const chuaTien = lan({ studentId: "A", ngayTienVe: [] });
    const r = xetThuTuChoDong(vao({ coSo: "NGAY_TIEN_VE", cacConGiaDinh: [con("A"), con("B")], lichSu: [chuaTien] }));
    expect(hang(r)).toEqual([1, null]);
    if (r.trangThai === "XAC_DINH") {
      expect(r.canCu.tamTinh).toBe(true);
      expect(r.canCu.donChuaCoTien).toEqual([chuaTien.orderId]);
    }
    // cùng dữ liệu, cơ sở ngày tạo đơn: đơn đó tính bình thường, không tạm tính
    const t = xetThuTuChoDong(vao({ coSo: "NGAY_TAO_DON", cacConGiaDinh: [con("A"), con("B")], lichSu: [chuaTien] }));
    expect(hang(t)).toEqual([2, null]);
    if (t.trangThai === "XAC_DINH") expect(t.canCu.tamTinh).toBe(false);
  });
  it("[GDT-21] nhiều khoản tiền về: chỉ CHO_XAC_MINH khi các ngày của nó nằm đè lên con khác; không đè thì vẫn xếp được", () => {
    const hai = lan({ studentId: "A", ngayTienVe: [d("2026-09-10T09:00:00"), d("2026-09-25T09:00:00")] });
    const xenGiua = lan({ studentId: "C", ngayTienVe: [d("2026-09-15T09:00:00")] });
    const cs = [con("A"), con("B"), con("C")];
    const dongB2 = { ...dongB, taoLuc: d("2026-10-01T09:00:00") };
    expect(lyDoMa(xetThuTuChoDong(vao({ coSo: "NGAY_TIEN_VE", cacConGiaDinh: cs, lichSu: [hai, xenGiua], dong: dongB2 })))).toEqual([]); // B chưa có tiền ⇒ sau cả hai; A,C đè nhau không ảnh hưởng hạng của B
    expect(hang(xetThuTuChoDong(vao({ coSo: "NGAY_TIEN_VE", cacConGiaDinh: cs, lichSu: [hai, xenGiua], dong: dongB2 })))).toEqual([3, null]);
    // con C là người đang được xếp, và khoảng tiền về của A bao trùm ngày của C ⇒ không phân biệt được
    const dongC = { orderItemId: "N2", orderId: "ON2", studentId: "C", soBuoi: 24, taoLuc: d("2026-10-02T09:00:00") };
    const rC = xetThuTuChoDong(vao({ coSo: "NGAY_TIEN_VE", cacConGiaDinh: cs, lichSu: [hai, xenGiua], dong: dongC }));
    expect(lyDoMa(rC)).toEqual(["THU_TU_KHONG_PHAN_BIET_DUOC"]); // 15/09 của C nằm GIỮA hai khoản của A (10/09 và 25/09) ⇒ không biết ai trước
  });
  it("[GDT-22] hai con khác nhau cùng một thời điểm ở hai đơn khác nhau ⇒ không phân biệt được", () => {
    const t = d("2026-09-05T09:00:00");
    const r = xetThuTuChoDong(
      vao({
        cacConGiaDinh: [con("A"), con("B")],
        lichSu: [lan({ studentId: "A", taoLuc: t })],
        dong: { orderItemId: "N", orderId: "ON", studentId: "B", soBuoi: 24, taoLuc: t },
      }),
    );
    expect(lyDoMa(r)).toEqual(["THU_TU_KHONG_PHAN_BIET_DUOC"]);
  });
  it("[GDT-23] lần mua trong lịch sử không gắn học viên ⇒ CHO_XAC_MINH (có thể là con khác đã mua trước)", () => {
    const r = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [lan({ studentId: null })] }));
    expect(lyDoMa(r)).toEqual(["DONG_CHUA_GAN_HOC_VIEN"]);
    const r2 = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], cungDon: [{ orderItemId: "X", studentId: null, soBuoi: 12 }] }));
    expect(lyDoMa(r2)).toEqual(["DONG_CHUA_GAN_HOC_VIEN"]);
  });
  it("[GDT-24] ngày hỏng ⇒ CHO_XAC_MINH; lịch sử lẫn dòng của chính đơn đang xét ⇒ ném lỗi lập trình", () => {
    const hong = lan({ studentId: "A", taoLuc: new Date("khong-phai-ngay") });
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [hong] })))).toEqual(["NGAY_KHONG_HOP_LE"]);
    const lanCungDon = lan({ studentId: "A", orderId: "ONEW" });
    expect(() => xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [lanCungDon] }))).toThrow(/cungDon/);
  });
});

describe("[GDT-25..26] học viên NGOÀI danh sách con đã liên kết của gia đình (rà soát độc lập 19/10)", () => {
  it("[GDT-25] lịch sử có học viên không thuộc gia đình (đơn khớp theo SĐT, dòng đứng tên cháu) ⇒ CHO_XAC_MINH, KHÔNG đếm là con đứng trước", () => {
    const cuaChau = lan({ studentId: "CHAU", taoLuc: d("2026-09-05T09:00:00") });
    const r = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A")], lichSu: [cuaChau], dong: { orderItemId: "N", orderId: "ON", studentId: "A", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") } }));
    expect(r).toEqual({ trangThai: "CHO_XAC_MINH", lyDo: [{ ma: "HOC_VIEN_NGOAI_GIA_DINH", hocVienIds: ["CHAU"], orderItemIds: [] }] });
    // ĐỐI CHỨNG DƯƠNG: cùng lịch sử nhưng em CHAU đã được liên kết vào gia đình ⇒ xếp bình thường, A là con thứ hai
    const ok = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("CHAU")], lichSu: [cuaChau], dong: { orderItemId: "N", orderId: "ON", studentId: "A", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") } }));
    expect(hang(ok)).toEqual([2, null]);
  });
  it("[GDT-26] dòng cùng đơn / dòng đang xét đứng tên học viên ngoài danh sách ⇒ cũng CHO_XAC_MINH; lần mua ngoài cửa sổ hoặc đã huỷ của người ngoài không làm phiền", () => {
    const r1 = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A")], cungDon: [{ orderItemId: "X", studentId: "LA", soBuoi: 12 }], dong: { orderItemId: "N", orderId: "ON", studentId: "A", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") } }));
    expect(lyDoMa(r1)).toContain("HOC_VIEN_NGOAI_GIA_DINH");
    const r2 = xetThuTuChoDong(vao({ cacConGiaDinh: [con("A")], dong: { orderItemId: "N", orderId: "ON", studentId: "KHAC", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") } }));
    expect(lyDoMa(r2)).toContain("HOC_VIEN_NGOAI_GIA_DINH");
    const huy = lan({ studentId: "CHAU", conHieuLuc: false });
    const cu = lan({ studentId: "CHAU", taoLuc: d("2026-08-01T09:00:00"), ngayTienVe: [] });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A")], lichSu: [huy, cu], dong: { orderItemId: "N", orderId: "ON", studentId: "A", soBuoi: 24, taoLuc: d("2026-10-01T09:00:00") } })))).toEqual([1, null]);
  });
});

describe("[GDT-30..36] thứ tự sản phẩm 48 — khoá đếm KHÁC thứ tự con", () => {
  const dong48 = { orderItemId: "N48", orderId: "ON48", studentId: "B", soBuoi: 48, taoLuc: d("2026-10-01T09:00:00") };
  it("[GDT-30] không mua đủ 48 buổi ⇒ không có thứ tự sản phẩm 48", () => {
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")] })))).toEqual([1, null]);
  });
  it("[GDT-31] gói 48 đầu tiên của gia đình ⇒ thứ nhất; đã có gói 48 của CON KHÁC ⇒ thứ hai", () => {
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")], dong: dong48 })))).toEqual([1, 1]);
    const a48 = lan({ studentId: "A", soBuoi: 48 });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [a48], dong: dong48 })))).toEqual([2, 2]);
  });
  it("[GDT-32] CÙNG con mua gói 48 lần hai: là sản phẩm thứ HAI nhưng vẫn là con thứ NHẤT (hai khoá đếm tách bạch — MT-09c)", () => {
    const b48 = lan({ studentId: "B", soBuoi: 48 });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")], lichSu: [b48], dong: dong48 })))).toEqual([1, 2]);
  });
  it("[GDT-33] sản phẩm không đủ 48 buổi KHÔNG tính vào thứ tự sản phẩm 48 (SR.QD.233 Đ3.2)", () => {
    const a36 = lan({ studentId: "A", soBuoi: 36 });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [a36], dong: dong48 })))).toEqual([2, 1]);
  });
  it("[GDT-34] gói 48 cũ ở đơn trả góp nhiều đợt, hoặc không rõ số buổi ⇒ CHO_XAC_MINH (không phải 'trọn gói trong 01 lần')", () => {
    const tg = lan({ studentId: "A", soBuoi: 48, traGopNhieuDot: true });
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [tg], dong: dong48 })))).toEqual(["DON_CU_TRA_GOP_CO_THE_LA_48_BUOI"]);
    const khongRo = lan({ studentId: "A", soBuoi: null });
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [khongRo], dong: dong48 })))).toEqual(["SO_BUOI_KHONG_RO"]);
  });
  it("[GDT-35] hai gói 48 trong CÙNG đơn: phụ huynh chọn thứ tự sản phẩm; thiếu ⇒ CHO_XAC_MINH", () => {
    const cungDon: DongCungDon[] = [{ orderItemId: "N48b", studentId: "B", soBuoi: 48 }];
    expect(lyDoMa(xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")], dong: dong48, cungDon })))).toEqual(["CUNG_LUC_CHUA_CHON_THU_TU"]);
    const chon = (ids: string[]) => ({ thuTuCon: [], thuTuSanPham48: ids, ghiBoiUserId: "U", ghiLuc: d("2026-10-01T09:05:00") });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")], dong: dong48, cungDon, phuHuynhChon: chon(["N48b", "N48"]) })))).toEqual([1, 2]);
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")], dong: dong48, cungDon, phuHuynhChon: chon(["N48", "N48b"]) })))).toEqual([1, 1]);
  });
  it("[GDT-35b] gói 48 cũ của gia đình trùng đúng thời điểm với dòng đang xét ⇒ không phân biệt được ai trước", () => {
    const t = d("2026-10-01T09:00:00");
    // cùng một con (B) ⇒ thứ tự CON không mơ hồ; chỉ thứ tự SẢN PHẨM 48 là không phân biệt được
    const trung = lan({ studentId: "B", soBuoi: 48, taoLuc: t });
    const r = xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")], lichSu: [trung], dong: { ...dong48, taoLuc: t } }));
    expect(r).toEqual({ trangThai: "CHO_XAC_MINH", lyDo: [{ ma: "THU_TU_KHONG_PHAN_BIET_DUOC", hocVienIds: [], orderItemIds: [trung.orderItemId, "N48"].sort() }] });
  });
  it("[GDT-37] dòng CÙNG ĐƠN chưa biết số buổi có thể là gói 48 nữa ⇒ CHO_XAC_MINH (không xếp dòng 48 này 'thứ nhất'); biết số buổi (12) thì xếp bình thường", () => {
    const r = xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")], dong: dong48, cungDon: [{ orderItemId: "KHONGRO", studentId: "B", soBuoi: null }] }));
    expect(r).toEqual({ trangThai: "CHO_XAC_MINH", lyDo: [{ ma: "SO_BUOI_KHONG_RO", hocVienIds: [], orderItemIds: ["KHONGRO"] }] });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("B")], dong: dong48, cungDon: [{ orderItemId: "R12", studentId: "B", soBuoi: 12 }] })))).toEqual([1, 1]);
  });
  it("[GDT-36] gói 48 cũ của gia đình ngoài cửa sổ hoặc đã huỷ không tính", () => {
    const cu = lan({ studentId: "A", soBuoi: 48, taoLuc: d("2026-08-01T09:00:00"), ngayTienVe: [] });
    const huy = lan({ studentId: "A", soBuoi: 48, conHieuLuc: false });
    expect(hang(xetThuTuChoDong(vao({ cacConGiaDinh: [con("A"), con("B")], lichSu: [cu, huy], dong: dong48 })))).toEqual([1, 1]);
  });
});

describe("[GDT-PIN] chưa nối vào đường nào (cờ TẮT ⇒ đường cũ nguyên văn)", () => {
  const goc = process.cwd();
  const duyet = (dir: string, ra: string[]): string[] => {
    for (const t of readdirSync(dir)) {
      if (t === "node_modules" || t === ".next" || t.startsWith(".")) continue;
      const p = join(dir, t);
      if (statSync(p).isDirectory()) duyet(p, ra);
      else if (/\.(ts|tsx)$/.test(t) && !/(gia-dinh-thu-tu|de-xuat-doi-chuong-trinh)(-db)?\.(test\.)?ts$/.test(t)) ra.push(p);
    }
    return ra;
  };
  it("không tệp nguồn nào ở app/ · lib/ · components/ import gia-dinh-thu-tu (nối vào là đổi hành vi — phải sửa lưới này CÓ CHỦ ĐÍCH)", () => {
    const tep = ["app", "lib", "components"].flatMap((x) => duyet(resolve(goc, x), []));
    expect(tep.length).toBeGreaterThan(100);
    const nhap = tep.filter((p) => /from\s+["'][^"']*gia-dinh-thu-tu(-db)?["']/.test(readFileSync(p, "utf8")));
    expect(nhap.map((p) => p.replace(goc, ""))).toEqual([]);
  }, 30_000);
});

describe("[GDT-40..45] phân loại 'đang học từ trước' từ ghi danh", () => {
  const gd = (status: string, ngay: string) => ({ status, createdAt: d(ngay) });
  const TRUOC = "2026-06-01T09:00:00";
  const TRONG = "2026-09-10T09:00:00";
  it("[GDT-40] không ghi danh ⇒ KHONG; chỉ ghi danh CANCELLED ⇒ KHONG (chưa từng học)", () => {
    expect(phanLoaiDangHocTuTruoc([], false, CUA_SO)).toBe("KHONG");
    expect(phanLoaiDangHocTuTruoc([gd("CANCELLED", TRUOC)], false, CUA_SO)).toBe("KHONG");
  });
  it("[GDT-41] ghi danh đang học (ACTIVE / CONFIRMED / STUDYING) tạo TRƯỚC 01/09 ⇒ CO", () => {
    for (const s of ["ACTIVE", "CONFIRMED", "STUDYING"]) expect(phanLoaiDangHocTuTruoc([gd(s, TRUOC)], false, CUA_SO)).toBe("CO");
  });
  it("[GDT-42] ghi danh đang học tạo TRONG đợt: đã có lần mua ⇒ KHONG (hạng tính theo lần mua, không đếm hai lần); chưa có lần mua ⇒ KHONG_RO", () => {
    expect(phanLoaiDangHocTuTruoc([gd("ACTIVE", TRONG)], true, CUA_SO)).toBe("KHONG");
    expect(phanLoaiDangHocTuTruoc([gd("ACTIVE", TRONG)], false, CUA_SO)).toBe("KHONG_RO");
  });
  it("[GDT-43] đã học xong / nghỉ / chuyển / chờ / bảo lưu ⇒ KHONG_RO (chưa chốt 'đang học' hay 'từng học' — MT-09e)", () => {
    for (const s of ["COMPLETED", "WITHDREW", "TRANSFERRED", "PENDING", "PAUSED"]) {
      expect(phanLoaiDangHocTuTruoc([gd(s, TRUOC)], false, CUA_SO), s).toBe("KHONG_RO");
      expect(phanLoaiDangHocTuTruoc([gd(s, TRUOC)], true, CUA_SO), `${s} có mua`).toBe("KHONG_RO");
    }
  });
  it("[GDT-44] nhiều ghi danh: một cái đang học từ trước thắng mọi cái kết thúc; mép 00:00 01/09 tính là TRONG đợt", () => {
    expect(phanLoaiDangHocTuTruoc([gd("COMPLETED", TRUOC), gd("STUDYING", TRUOC)], false, CUA_SO)).toBe("CO");
    expect(phanLoaiDangHocTuTruoc([gd("ACTIVE", "2026-09-01T00:00:00")], false, CUA_SO)).toBe("KHONG_RO");
    expect(phanLoaiDangHocTuTruoc([gd("ACTIVE", "2026-08-31T23:59:59")], false, CUA_SO)).toBe("CO");
  });
});
