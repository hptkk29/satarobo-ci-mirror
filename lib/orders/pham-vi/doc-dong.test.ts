// lib/orders/pham-vi/doc-dong.test.ts — GHI / ĐỌC dấu phạm vi trên `OrderItem.metadata`. THUẦN, không đồng hồ thật.
//
// Hai thứ test này khoá mà test của planner KHÔNG khoá được:
//   · dấu ghi ra đọc lại ĐƯỢC bằng chính các hàm đọc đang chạy thật (`soBuoiChoGhiDanh` của convert, `docHinhThucLop`,
//     `xetSoBuoiDong`) — nếu một trong số đó không thấy `soBuoi`, khách mua 12 buổi được học cả khoá (M2);
//   · `phamVi` do CLIENT gửi không bao giờ tới được DB.
import { describe, expect, it } from "vitest";
import { CHINH_SACH_PL02 } from "@/lib/pricing/tinh-gia-theo-moc";
import { cuaSoHieuLucPL02 } from "@/lib/pricing/hieu-luc-chinh-sach";
import { soBuoiChoGhiDanh, type DongDonChoGhiDanh } from "@/lib/finance/gia-tu-dong-don";
import { docHinhThucLop } from "@/lib/orders/hinh-thuc-lop";
import { docConLeadTuMetadata, veMetadataConLead } from "@/lib/orders/hoc-vien-dong-don";
import { xetSoBuoiDong } from "@/lib/orders/so-buoi-hoc-phan";
import { keHoachDon, type BoiCanhDon, type DongVao, type KetQuaDon } from "./ke-hoach-don";
import {
  KHOA_PHAM_VI,
  PHIEN_BAN_PHAM_VI,
  boPhamViCuaClient,
  docPhamViDong,
  laDonPhamVi,
  metadataChoDong,
  metadataDongPhamVi,
} from "./doc-dong";

const BOI_CANH: BoiCanhDon = {
  phamViBat: true,
  nguonGia48: "Course.price",
  chinhSach: CHINH_SACH_PL02,
  hieuLuc: cuaSoHieuLucPL02(),
  cheDoMocNgay: "ORDER_CREATED",
  thuTuMacDinh: "LOWER_VALUE_FIRST",
  taoDon: new Date("2026-10-11T03:00:00Z"),
  coKeHoachDot: false,
};
const dong = (o: Partial<DongVao> = {}): DongVao => ({
  loai: "COURSE_ENROLLMENT",
  tenDong: "Sata 3",
  soLuong: 1,
  donGiaKhach: 2_640_000,
  soKhoanGiam: 0,
  laLopNhom: true,
  tongSoBuoiKhoa: 48,
  soBuoiMua: 12,
  gia48: 10_560_000,
  conKhoa: "con-a",
  ...o,
});
const KHOA = "khoa-sata3";

function dongScope(o: Partial<DongVao> = {}): { kq: KetQuaDon; md: Record<string, unknown> } {
  const kq = keHoachDon([dong(o)], BOI_CANH);
  const md = metadataChoDong(kq, 0, { courseId: KHOA, soBuoi: o.soBuoiMua ?? 12 }, KHOA);
  if (kq.kieu !== "SCOPE" || !md) throw new Error("fixture: dòng không SCOPE");
  return { kq, md };
}

describe("[ĐSC-07] ghi / đọc dấu phạm vi", () => {
  it("[ĐSC-07a] ghi ra đọc lại được, đủ các trường của snapshot", () => {
    const { md } = dongScope();
    const pv = docPhamViDong(md);
    expect(pv).not.toBeNull();
    expect(pv).toMatchObject({
      phienBan: PHIEN_BAN_PHAM_VI,
      loaiMua: "MILESTONE",
      soBuoiMua: 12,
      niemYet: 2_640_000,
      giamGia: 0,
      thanhTien: 2_640_000,
      // 10.560.000 ÷ 48 = 220.000 chia hết ⇒ có đơn giá/buổi.
      donGiaMoiBuoi: 220_000,
    });
    expect(pv!.pricingSnapshot).toMatchObject({ gia48: 10_560_000, nguonGia48: "Course.price", soBuoi: 12, thuTuCon: 1 });
    expect(md.courseId).toBe(KHOA);
  });

  it("[ĐSC-07b] giá 48 KHÔNG chia hết cho 48 ⇒ đơn giá/buổi là null, không làm tròn", () => {
    // Planner không bao giờ cho ra giá 48 lẻ (thành tiền sẽ không tròn đồng ⇒ từ chối), nên thay tay `gia48` của snapshot
    // để thử riêng nhánh "không chia hết cho 48" của hàm ghi.
    const { kq } = dongScope();
    if (kq.kieu !== "SCOPE") throw new Error("fixture");
    const p = kq.dong[0]!;
    const le = metadataDongPhamVi(KHOA, { ...p, pricingSnapshot: { ...p.pricingSnapshot, gia48: 10_560_001 } });
    expect(docPhamViDong(le)!.donGiaMoiBuoi).toBeNull();
  });

  it("[ĐSC-07c] M2 — `soBuoi` PHẢI nằm trong metadata, và hàm đọc của convert (`soBuoiChoGhiDanh`) thấy đúng số đã mua", () => {
    const { md } = dongScope();
    const veLead = veMetadataConLead(md, "lc-1");
    expect(veLead).not.toBeNull();
    const dongDon: DongDonChoGhiDanh = {
      leadChildId: docConLeadTuMetadata(veLead),
      courseId: docHinhThucLop(veLead).courseId,
      totalPrice: 2_640_000,
      soBuoi: docHinhThucLop(veLead).soBuoi,
      coPhamVi: docPhamViDong(veLead) !== null,
    };
    // Nếu `soBuoi` không được ghi, đây là `null` ⇒ convert đặt `buoiBatDau = NULL` = học ĐỦ KHOÁ.
    expect(soBuoiChoGhiDanh([dongDon], { leadChildId: "lc-1", courseId: KHOA })).toBe(12);
  });

  it("[ĐSC-07d] dòng SCOPE hợp lệ với luật duyệt 25/09: n ∈ {12,24,36,48} không phải vào hàng chờ duyệt", () => {
    const { md } = dongScope();
    const h = docHinhThucLop(md);
    expect(xetSoBuoiDong({ tongSoBuoiKhoa: 48, soBuoiMua: h.soBuoi })).toMatchObject({ apLuat: true, hopLe: true, canDuyet: false });
  });

  it("[ĐSC-07e] metadata dòng SCOPE là WHITELIST: khoá lạ của client (coachFormat giả, ghi chú, phamVi giả…) không lọt theo", () => {
    const kq = keHoachDon([dong()], BOI_CANH);
    const md = metadataChoDong(kq, 0, { courseId: KHOA, soBuoi: 12, coachFormat: "GROUP", ghiChu: "x", [KHOA_PHAM_VI]: { phienBan: 1, thanhTien: 1 } }, KHOA)!;
    expect(Object.keys(md).sort()).toEqual(["courseId", KHOA_PHAM_VI, "soBuoi"].sort());
    expect(docPhamViDong(md)!.thanhTien).toBe(2_640_000); // khối thật của máy chủ, không phải khối giả
  });

  it("[ĐSC-07f] dòng KHÔNG phải SCOPE: gỡ `phamVi` giả của client, giữ nguyên mọi khoá khác; không có khoá giả thì trả CHÍNH đối tượng", () => {
    const sach = { courseId: KHOA, soBuoi: 48 };
    expect(boPhamViCuaClient(sach)).toBe(sach); // cùng tham chiếu ⇒ đường cũ không đổi một byte
    expect(boPhamViCuaClient(null)).toBeNull();
    const gia = { courseId: KHOA, soBuoi: 48, coachFormat: "ONE_ON_ONE", [KHOA_PHAM_VI]: { phienBan: 1, loaiMua: "FULL", soBuoiMua: 48, thanhTien: 1 } };
    expect(boPhamViCuaClient(gia)).toEqual({ courseId: KHOA, soBuoi: 48, coachFormat: "ONE_ON_ONE" });
    expect(gia[KHOA_PHAM_VI]).toBeDefined(); // không sửa đối tượng đầu vào
    const legacy = metadataChoDong({ kieu: "LEGACY" }, 0, gia, KHOA);
    expect(legacy).toEqual({ courseId: KHOA, soBuoi: 48, coachFormat: "ONE_ON_ONE" });
    expect(docPhamViDong(legacy)).toBeNull();
  });

  it("[ĐSC-07g] đối chứng âm: dấu hỏng / giả hình dạng ⇒ đọc ra null (fail-closed về 'không phải SCOPE')", () => {
    const { md } = dongScope();
    const khoi = md[KHOA_PHAM_VI] as Record<string, unknown>;
    const voi = (v: Record<string, unknown>, ngoai: Record<string, unknown> = {}) => docPhamViDong({ ...md, ...ngoai, [KHOA_PHAM_VI]: { ...khoi, ...v } });
    expect(voi({})).not.toBeNull(); // đối chứng dương cho cả nhóm
    expect(voi({ phienBan: 2 })).toBeNull();
    expect(voi({ loaiMua: "CUSTOM" })).toBeNull();
    expect(voi({ soBuoiMua: 13 }, { soBuoi: 13 })).toBeNull(); // 13 không phải mốc
    expect(voi({ thanhTien: 1 })).toBeNull(); // niemYet ≠ thanhTien + giamGia
    expect(voi({ loaiMua: "FULL" })).toBeNull(); // FULL chỉ đi với 48
    expect(docPhamViDong({ ...md, soBuoi: 24 })).toBeNull(); // `soBuoi` ngoài khối lệch khối trong
    expect(voi({ pricingSnapshot: null })).toBeNull();
    // Nhất quán SỐ TIỀN (khu vực 'tiền về' sẽ tin khối này): mỗi phép cấy bỏ MỘT vế phải làm đúng một dòng dưới đỏ.
    const snap = khoi.pricingSnapshot as Record<string, unknown>;
    const tt = khoi.thanhTien as number;
    const gg = khoi.giamGia as number;
    expect(voi({ giamGia: gg + 1 })).toBeNull(); // niemYet ≠ thanhTien + giamGia, giamGia lệch (thanhTien đúng)
    expect(voi({ giamGia: -1, niemYet: tt - 1 })).toBeNull(); // giảm ÂM nhưng cộng khớp: thanhTien > niêm yết
    expect(voi({ thanhTien: -5, niemYet: gg - 5, pricingSnapshot: { ...snap, thanhTien: -5 } })).toBeNull(); // tiền ÂM nhưng cộng khớp
    expect(voi({ pricingSnapshot: { ...snap, thanhTien: tt + 1 } })).toBeNull(); // snapshot lệch thành tiền
    for (const x of [null, undefined, 0, "", [], { [KHOA_PHAM_VI]: "x" }, { [KHOA_PHAM_VI]: [] }]) expect(docPhamViDong(x), JSON.stringify(x)).toBeNull();
  });

  it("[ĐSC-07h] dòng SCOPE thiếu courseId hoặc kế hoạch ⇒ ném (không ghi một dòng SCOPE không dấu)", () => {
    const kq = keHoachDon([dong()], BOI_CANH);
    expect(() => metadataChoDong(kq, 0, {}, null)).toThrow(/thiếu courseId/);
    expect(() => metadataChoDong(kq, 5, {}, KHOA)).toThrow(/thiếu courseId/);
  });

  it("[ĐSC-07i] laDonPhamVi: có ít nhất một dòng SCOPE hợp lệ", () => {
    const { md } = dongScope();
    expect(laDonPhamVi([{ metadata: { courseId: KHOA } }, { metadata: md }])).toBe(true);
    expect(laDonPhamVi([{ metadata: { courseId: KHOA } }, { metadata: null }])).toBe(false);
    expect(laDonPhamVi([])).toBe(false);
  });
});
