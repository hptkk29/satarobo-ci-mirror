/**
 * Ca test cho cổng sức khoẻ danh mục nền (luật 14: lưới an toàn phải có test của chính nó).
 *
 * Hàm được kiểm là THUẦN nên mọi tổ hợp kiểm được không cần Postgres — và mỗi ngưỡng cấy
 * lại được: đổi một dấu so sánh trong `kiem-suc-khoe` là một ca ở đây đỏ.
 */
import { describe, expect, it } from "vitest";

import {
  coCanhBaoNang,
  kiemSucKhoeDanhMuc,
  type DemDanhMuc,
} from "./suc-khoe-danh-muc";

/** Hình dạng LÀNH MẠNH — bằng đúng danh mục trong mã nguồn + 2 cơ sở vận hành. */
const LANH: DemDanhMuc = {
  maCa: 21,
  loaiNghi: 8,
  phanLoaiBuoi: 7,
  soPhanLoaiMacDinh: 1,
  loaiCongDay: 6,
  diemCham: 2,
  coSoVanHanh: 2,
};

const ma = (d: DemDanhMuc) => kiemSucKhoeDanhMuc(d).map((c) => c.ma);

describe("kiemSucKhoeDanhMuc", () => {
  it("hình dạng lành mạnh ⇒ KHÔNG cảnh báo gì", () => {
    // Anti-vacuity: nếu ca này đỏ thì mọi ca dưới đây vô nghĩa (chúng chỉ đếm phần THÊM).
    expect(kiemSucKhoeDanhMuc(LANH)).toEqual([]);
    expect(coCanhBaoNang([])).toBe(false);
  });

  // ── HÌNH DẠNG PROD 09/09/2026, đo thật ──────────────────────────────────────
  it("hình dạng prod 09/09: hai bảng rỗng ⇒ đúng hai cảnh báo NẶNG", () => {
    const prod: DemDanhMuc = { ...LANH, phanLoaiBuoi: 0, soPhanLoaiMacDinh: 0, loaiCongDay: 0 };
    expect(ma(prod)).toEqual(["CONG_DAY_RONG", "PHAN_LOAI_RONG"]);
    expect(coCanhBaoNang(kiemSucKhoeDanhMuc(prod))).toBe(true);
  });

  it("bảng loại công dạy rỗng là thứ ĐẦU TIÊN được nói — nó làm công dạy ra 0", () => {
    const ds = kiemSucKhoeDanhMuc({ ...LANH, loaiCongDay: 0, maCa: 0, loaiNghi: 0 });
    expect(ds[0]?.ma).toBe("CONG_DAY_RONG");
    expect(ds[0]?.noi).toContain("TẤT CẢ giáo viên");
  });

  // ── phân loại buổi + cờ mặc định ────────────────────────────────────────────
  it("bảng phân loại RỖNG ⇒ chỉ báo rỗng, KHÔNG báo thêm 'thiếu mặc định'", () => {
    // Báo hai lần cho cùng một nguyên nhân chỉ làm loãng khối cảnh báo.
    expect(ma({ ...LANH, phanLoaiBuoi: 0, soPhanLoaiMacDinh: 0 })).toEqual(["PHAN_LOAI_RONG"]);
  });

  it("có phân loại nhưng KHÔNG dòng nào mặc định ⇒ NẶNG", () => {
    const ds = kiemSucKhoeDanhMuc({ ...LANH, soPhanLoaiMacDinh: 0 });
    expect(ds.map((c) => c.ma)).toEqual(["MAC_DINH_SAI"]);
    expect(ds[0]?.muc).toBe("NANG");
    expect(ds[0]?.noi).toContain("Không phân loại buổi nào");
  });

  it("HAI dòng cùng giữ mặc định ⇒ NẶNG, và câu chữ nói ra con số", () => {
    // Partial unique index chặn ca này ở tầng DB, nhưng cổng vẫn phải biết đọc — index có
    // thể chưa được apply trên một môi trường nào đó, và lúc ấy đây là thứ duy nhất nói.
    const ds = kiemSucKhoeDanhMuc({ ...LANH, soPhanLoaiMacDinh: 2 });
    expect(ds.map((c) => c.ma)).toEqual(["MAC_DINH_SAI"]);
    expect(ds[0]?.noi).toContain("2 phân loại buổi");
  });

  it("đúng 1 dòng mặc định ⇒ im lặng", () => {
    expect(ma({ ...LANH, soPhanLoaiMacDinh: 1 })).toEqual([]);
  });

  // ── hai danh mục còn lại ────────────────────────────────────────────────────
  it("mã ca rỗng ⇒ NẶNG", () => {
    expect(ma({ ...LANH, maCa: 0 })).toEqual(["MA_CA_RONG"]);
  });

  it("loại nghỉ rỗng ⇒ NẶNG", () => {
    expect(ma({ ...LANH, loaiNghi: 0 })).toEqual(["LOAI_NGHI_RONG"]);
  });

  // ── điểm chấm: NHẸ, và so theo CƠ SỞ chứ không theo danh mục ────────────────
  it("thiếu điểm chấm ⇒ NHẸ, và nói ĐÚNG số cơ sở còn thiếu", () => {
    const ds = kiemSucKhoeDanhMuc({ ...LANH, diemCham: 0, coSoVanHanh: 3 });
    expect(ds.map((c) => c.ma)).toEqual(["THIEU_DIEM_CHAM"]);
    expect(ds[0]?.muc).toBe("NHE");
    expect(ds[0]?.noi).toContain("3 cơ sở");
    expect(coCanhBaoNang(ds)).toBe(false);
  });

  it("thừa điểm chấm so với số cơ sở ⇒ KHÔNG cảnh báo", () => {
    // Cơ sở đóng cửa mà điểm chấm còn lại là chuyện bình thường, đừng kêu.
    expect(ma({ ...LANH, diemCham: 5, coSoVanHanh: 2 })).toEqual([]);
  });

  it("đủ điểm chấm ⇒ im lặng (ngưỡng là <, không phải <=)", () => {
    expect(ma({ ...LANH, diemCham: 2, coSoVanHanh: 2 })).toEqual([]);
  });

  // ── tổ hợp xấu nhất ─────────────────────────────────────────────────────────
  it("mọi thứ rỗng ⇒ liệt kê đủ, không nuốt cái nào", () => {
    expect(
      ma({
        maCa: 0,
        loaiNghi: 0,
        phanLoaiBuoi: 0,
        soPhanLoaiMacDinh: 0,
        loaiCongDay: 0,
        diemCham: 0,
        coSoVanHanh: 2,
      }),
    ).toEqual([
      "CONG_DAY_RONG",
      "PHAN_LOAI_RONG",
      "MA_CA_RONG",
      "LOAI_NGHI_RONG",
      "THIEU_DIEM_CHAM",
    ]);
  });

  it("mỗi cảnh báo phải nói được LÀM GÌ, không chỉ nói cái gì hỏng", () => {
    // Một cảnh báo không kèm việc phải làm thì người đọc vẫn kẹt — luật 12 áp cho câu chữ.
    for (const c of kiemSucKhoeDanhMuc({
      maCa: 0, loaiNghi: 0, phanLoaiBuoi: 0, soPhanLoaiMacDinh: 0,
      loaiCongDay: 0, diemCham: 0, coSoVanHanh: 2,
    })) {
      expect(c.lam.length, `${c.ma} thiếu câu 'làm gì'`).toBeGreaterThan(10);
      expect(c.noi.length, `${c.ma} thiếu câu 'chuyện gì'`).toBeGreaterThan(10);
    }
  });
});
