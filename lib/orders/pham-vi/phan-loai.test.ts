// @vitest-environment node
/**
 * Giao diện tạo đơn theo PHẠM VI HỌC — phần THUẦN: đơn nào ẩn khối kế hoạch nhiều đợt, đơn nào giữ giao diện + payload cũ.
 * Ca nào khẳng định "KHÔNG ẩn / KHÔNG đổi" đều có đối chứng dương ngay cạnh (luật 11: ca chỉ khẳng định sự VẮNG MẶT luôn
 * xanh khi tính năng hỏng hoàn toàn).
 */
import { describe, expect, it } from "vitest";
import {
  chonKeHoachDotGui,
  dongLaPhamVi,
  khoaTrongPhamVi,
  laDongGhiDanhKhoa,
  phanLoaiGiaoDienDon,
  thongBaoDonTron,
  type DongPhanLoai,
} from "./phan-loai";
import { keHoachDon, type DongVao, type BoiCanhDon } from "./ke-hoach-don";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";

const K48: DongPhanLoai = { loai: "COURSE_ENROLLMENT", tongSoBuoiKhoa: 48, soBuoiMua: 48 };
const K12: DongPhanLoai = { loai: "COURSE_ENROLLMENT", tongSoBuoiKhoa: 12, soBuoiMua: 12 };
const SP: DongPhanLoai = { loai: "PRODUCT", tongSoBuoiKhoa: null, soBuoiMua: null };
const CHUA_CHON: DongPhanLoai = { loai: "COURSE_ENROLLMENT", tongSoBuoiKhoa: null, soBuoiMua: null };

describe("[P6-01] vị từ dòng: đúng khoá 48 buổi ghi danh, không hơn", () => {
  it("khoá 48 + ghi danh ⇒ theo phạm vi (dương); khoá 12/11/23/9 buổi, sản phẩm, dòng chưa chọn khoá ⇒ KHÔNG", () => {
    expect(dongLaPhamVi(K48)).toBe(true);
    expect(dongLaPhamVi({ ...K48, soBuoiMua: null })).toBe(true); // không khai số buổi vẫn là dòng phạm vi (planner mới từ chối thiếu số buổi)
    expect(dongLaPhamVi({ ...K48, soBuoiMua: 20 })).toBe(true); // số buổi lẻ vẫn thuộc phạm vi — bị TỪ CHỐI chứ không rơi về đường cũ
    for (const tong of [9, 11, 12, 23, null]) expect(dongLaPhamVi({ ...K48, tongSoBuoiKhoa: tong })).toBe(false);
    expect(dongLaPhamVi(SP)).toBe(false);
    expect(dongLaPhamVi({ ...K48, loai: "PRODUCT" })).toBe(false);
    expect(dongLaPhamVi(CHUA_CHON)).toBe(false);
  });
  it("hai vị từ thành phần khớp với hợp của chúng", () => {
    expect(laDongGhiDanhKhoa("COURSE_ENROLLMENT")).toBe(true);
    expect(laDongGhiDanhKhoa("COURSE_PACKAGE")).toBe(false);
    expect(khoaTrongPhamVi({ tongSoBuoiKhoa: 48, soBuoiMua: 12 })).toBe(true);
    expect(khoaTrongPhamVi({ tongSoBuoiKhoa: 12, soBuoiMua: 12 })).toBe(false);
  });
});

describe("[P6-02] phân loại giao diện đơn", () => {
  it("cờ BẬT + mọi dòng khoá 48 ⇒ PHAM_VI (một dòng, nhiều dòng)", () => {
    expect(phanLoaiGiaoDienDon({ phamViBat: true, dong: [K48] })).toEqual({ kieu: "PHAM_VI" });
    expect(phanLoaiGiaoDienDon({ phamViBat: true, dong: [K48, { ...K48, soBuoiMua: 24 }] })).toEqual({ kieu: "PHAM_VI" });
  });
  it("[đối chứng] cờ TẮT, cùng đúng dòng ấy ⇒ CU (cơ sở chưa bật giữ giao diện cũ)", () => {
    expect(phanLoaiGiaoDienDon({ phamViBat: false, dong: [K48] })).toEqual({ kieu: "CU" });
    expect(phanLoaiGiaoDienDon({ phamViBat: false, dong: [K48, SP] })).toEqual({ kieu: "CU" });
  });
  it("[đối chứng] cờ BẬT nhưng đơn thường ⇒ CU: khoá không 48, sản phẩm, đơn rỗng, dòng chưa chọn khoá", () => {
    for (const dong of [[K12], [SP], [], [CHUA_CHON], [K12, SP]]) {
      expect(phanLoaiGiaoDienDon({ phamViBat: true, dong })).toEqual({ kieu: "CU" });
    }
  });
  it("[PB-L1] dòng khoá 48 ở CUỐI: [K12, K48] ⇒ TRON chỉ dòng 0 (không PHAM_VI) — fixture trộn không được luôn để dòng phạm vi ở đầu", () => {
    expect(phanLoaiGiaoDienDon({ phamViBat: true, dong: [K12, K48] })).toEqual({ kieu: "TRON", chiSoDongKhac: [0] });
  });
  it("cờ BẬT + đơn TRỘN ⇒ TRON, chỉ đúng chỉ số các dòng KHÁC; giao diện cũ không bị ẩn", () => {
    expect(phanLoaiGiaoDienDon({ phamViBat: true, dong: [K48, K12] })).toEqual({ kieu: "TRON", chiSoDongKhac: [1] });
    expect(phanLoaiGiaoDienDon({ phamViBat: true, dong: [K12, K48, CHUA_CHON] })).toEqual({ kieu: "TRON", chiSoDongKhac: [0, 2] });
  });
});

describe("[P6-03] keHoachDot gửi lên", () => {
  const DOTS = [{ amount: 10_000_000 }, { amount: 2_000_000 }];
  it("PHAM_VI ⇒ null, kể cả khi state kế hoạch cũ còn đầy đợt", () => {
    expect(chonKeHoachDotGui({ kieu: "PHAM_VI" }, DOTS)).toBeNull();
  });
  it("[đối chiếu dương] CU và TRON ⇒ trả NGUYÊN tham chiếu mảng đợt cũ (payload không đổi một byte); null đi qua null", () => {
    expect(chonKeHoachDotGui({ kieu: "CU" }, DOTS)).toBe(DOTS);
    expect(chonKeHoachDotGui({ kieu: "TRON", chiSoDongKhac: [1] }, DOTS)).toBe(DOTS);
    expect(chonKeHoachDotGui({ kieu: "CU" }, null)).toBeNull();
  });
  it("đổi khoá qua lại: quyết định chỉ theo chế độ HIỆN TẠI (48 → 12 → 48), không nhớ chế độ trước", () => {
    const lanLuot = [K48, K12, K48].map((d) => chonKeHoachDotGui(phanLoaiGiaoDienDon({ phamViBat: true, dong: [d] }), DOTS));
    expect(lanLuot).toEqual([null, DOTS, null]);
  });
});

describe("[P6-04] câu đơn trộn: form và planner máy chủ dùng CÙNG một câu", () => {
  const B: BoiCanhDon = {
    phamViBat: true,
    nguonGia48: "Course.price",
    chinhSach: CHINH_SACH_PL02,
    hieuLuc: cuaSoHieuLucPL02(),
    cheDoMocNgay: "ORDER_CREATED",
    thuTuMacDinh: "LOWER_VALUE_FIRST",
    taoDon: new Date("2026-10-11T03:00:00Z"),
    coKeHoachDot: false,
  };
  const d = (o: Partial<DongVao>): DongVao => ({
    loai: "COURSE_ENROLLMENT",
    tenDong: "Sata 3",
    soLuong: 1,
    donGiaKhach: 8_976_000,
    soKhoanGiam: 0,
    laLopNhom: true,
    tongSoBuoiKhoa: 48,
    soBuoiMua: 48,
    gia48: 10_560_000,
    conKhoa: "a",
    ...o,
  });
  it("planner từ chối đơn trộn bằng đúng chuỗi của thongBaoDonTron", () => {
    const r = keHoachDon([d({}), d({ tenDong: "Sata 1", tongSoBuoiKhoa: 11, soBuoiMua: 11, conKhoa: "b" })], B);
    expect(r).toEqual({ kieu: "REJECT", thongBao: thongBaoDonTron(["Dòng 2 (Sata 1)"]) });
  });
});
