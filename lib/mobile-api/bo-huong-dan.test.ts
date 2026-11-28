import { describe, expect, it } from "vitest";

import { ketLuan } from "@/lib/portal/chuyen-can-thuan";
import { tomTatDiHoc } from "@/lib/portal/tong-quan-thuan";

import { boCauHuongDan, boMenhDeHuongDan, ghiTrangThaiKhongHuongDan, ketLuanDiDong } from "./bo-huong-dan";

/**
 * [BHD-*] Ẩn câu hướng dẫn thao tác app chưa làm được (B4.5). Các ca chạy HÀM THẬT `ketLuan` của web trên lưới đầu vào — nếu web đổi chữ và một câu bảo-làm-gì lọt qua thì lưới đỏ.
 */
const CUE_TONG_QUAT = /(gửi|chọn|xin|đăng ký|bấm|nhấn|đặt lịch|liên hệ|vào mục)/i;

const soBuoi = (vangKhongBu: number, choBu: number, chuaCham: number) =>
  ({ lopDaHoc: 30, conDaHoc: 28, coMat: 28, bu: 0, choBu, vangKhongBu, chuaCham, conLai: 18, tongNhom: 48, tiLe: null }) as never;

describe("[BHD] ẩn câu hướng dẫn thao tác", () => {
  it("[BHD-01] đúng ca của chủ dự án: «Ba mẹ gửi đơn học bù…» bị bỏ, câu SỰ KIỆN còn nguyên; không có `viec`", () => {
    const web = ketLuan({ ten: "Em An", s: soBuoi(1, 0, 0), soBuoiChoBu: [] });
    expect(web.giaiThich).toContain("Ba mẹ gửi đơn học bù"); // đối chứng: web CÓ câu đó
    const dd = ketLuanDiDong(web);
    expect(dd.giaiThich).toBe("Lớp đã học 30 buổi. Em An đã học 28, còn 1 buổi vắng chưa có đơn bù.");
    expect(dd.tieuDe).toBe("Có 1 buổi vắng chưa có lịch bù");
    expect(Object.keys(dd).sort()).toEqual(["giaiThich", "sac", "tieuDe"]);
    expect(JSON.stringify(dd)).not.toMatch(/Gửi đơn học bù|Chọn giờ|Xin học bù|href|portal/i);
  });

  it("[BHD-02] LƯỚI: vangKhongBu 0..4 × choBu 0..4 × chuaCham 0..3 × tên (có/không) ⇒ không giải thích nào còn dấu hiệu bảo-làm-gì; luôn còn ít nhất câu SỰ KIỆN", () => {
    let n = 0;
    for (let v = 0; v <= 4; v++)
      for (let c = 0; c <= 4; c++)
        for (let k = 0; k <= 3; k++)
          for (const ten of ["Em An", ""]) {
            const dd = ketLuanDiDong(ketLuan({ ten, s: soBuoi(v, c, k), soBuoiChoBu: c ? [5, 7].slice(0, Math.min(c, 2)) : [] }));
            expect(dd.giaiThich, `v=${v} c=${c} k=${k}`).not.toMatch(CUE_TONG_QUAT);
            expect(dd.giaiThich.length, `v=${v} c=${c} k=${k}: mất cả câu sự kiện`).toBeGreaterThan(10);
            expect(dd.tieuDe, `v=${v} c=${c} k=${k}`).not.toMatch(CUE_TONG_QUAT);
            n++;
          }
    expect(n).toBe(5 * 5 * 4 * 2);
  });

  it("[BHD-03] câu có dấu hiệu bị bỏ THEO TỪNG CÂU; không còn câu nào ⇒ rỗng; câu trạng thái giữ", () => {
    expect(boCauHuongDan("A đã học 3 buổi. Ba mẹ gửi đơn học bù. Con chưa mất buổi nào.")).toBe("A đã học 3 buổi. Con chưa mất buổi nào.");
    expect(boCauHuongDan("Hãy chọn giờ học bù ngay.")).toBe("");
    expect(boCauHuongDan("")).toBe("");
  });

  it("[BHD-04] ghi chú trạng thái: «đang chờ chọn giờ học bù» ⇒ «đang chờ học bù»; phần sự kiện trước đó giữ nguyên; chuỗi khác không đổi", () => {
    expect(ghiTrangThaiKhongHuongDan("Vắng có phép — đang chờ chọn giờ học bù.")).toBe("Vắng có phép — đang chờ học bù.");
    expect(ghiTrangThaiKhongHuongDan("Vắng không phép ngày 05/11. Buổi này đang chờ chọn giờ học bù.")).toBe("Vắng không phép ngày 05/11. Buổi này đang chờ học bù.");
    expect(ghiTrangThaiKhongHuongDan("Đã học bù.")).toBe("Đã học bù.");
  });
  it("[BHD-05] tóm tắt nhận xét `tomTatDiHoc` (hàm THẬT của web): «Vắng N buổi — chờ chọn giờ bù» ⇒ «chờ học bù»; LƯỚI không còn dấu hiệu chọn-giờ", () => {
    const web = tomTatDiHoc({ daHoc: 30, coMat: 28, vang: 1, chuaCham: 1, canBu: 1 });
    expect(web.phu).toContain("chờ chọn giờ bù"); // đối chứng: web CÓ cụm đó
    expect(ghiTrangThaiKhongHuongDan(web.phu)).toBe("Vắng 1 buổi — chờ học bù · 1 buổi chưa chấm");
    for (let canBu = 0; canBu <= 4; canBu++)
      for (let vang = 0; vang <= 4; vang++)
        for (let chuaCham = 0; chuaCham <= 3; chuaCham++) {
          const t = tomTatDiHoc({ daHoc: 30, coMat: 25, vang, chuaCham, canBu });
          expect(ghiTrangThaiKhongHuongDan(t.phu), `canBu=${canBu} vang=${vang} chuaCham=${chuaCham}`).not.toMatch(/chọn giờ/i);
        }
  });

  it("[BHD-06] thông báo HỌC BÙ: «phụ huynh đặt lịch học bù giúp con» bị bỏ, vế SỰ KIỆN giữ; thông báo thường không bị cắt", () => {
    const body = "Bài 5 — Robot — vắng buổi này, phụ huynh đặt lịch học bù giúp con.";
    expect(boMenhDeHuongDan(body)).toBe("Bài 5 — Robot — vắng buổi này.");
    expect(boMenhDeHuongDan("Trung tâm đã xếp lịch học bù: thứ Bảy 08:00.")).toBe("Trung tâm đã xếp lịch học bù: thứ Bảy 08:00."); // không có dấu hiệu bảo-làm-gì ⇒ nguyên văn
    expect(boMenhDeHuongDan("Hãy đăng ký ngay.")).toBe(""); // cả câu là hướng dẫn ⇒ bỏ
    expect(boMenhDeHuongDan("")).toBe("");
  });
});
