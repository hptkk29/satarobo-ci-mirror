import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Lưới ghim DÂY NỐI của «Xuất liền» (BGĐ đổi yêu cầu 09/11/2026; thay lưới [TXW] của «tự xuất sau n giờ» đã gỡ) — phần không có test hành vi nào bắt được:
// đường phát hành là máy trạng thái chung (không `loDem`), lần thu phải qua cổng chọn TRƯỚC khi chạm máy phát hành, KHÔNG đường tự xác nhận tiền, đóng yêu cầu CHỈ sau khi có hoá đơn,
// action kiểm quyền + cờ + dấu đối chiếu TRƯỚC khi phát hành, và «tự xuất sau n giờ» không còn dấu vết nào (cấu hình, cron, mã).
// Đọc mã nguồn đã bỏ chú thích (chú thích giải thích bản vá thường chứa đúng chuỗi đang cấm).

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const tho = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");
const dem = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

const RUNNER = "lib/finance/hoa-don/xuat-lien/chay-xuat-lien.ts";
const ACTION = "app/(admin)/admin/orders/_actions-nguoi-mua.ts";

describe("[XLW] dây nối xuất liền", () => {
  it("[XLW-1] «tự xuất sau n giờ» KHÔNG còn dấu vết: hai khoá cấu hình, hàm đọc cấu hình, hàm chạy, hằng «n giờ» đều đã gỡ", () => {
    // Đọc THÔ cho registry / nhãn (có chuỗi chứa "/*" làm bộ bỏ chú thích ăn mất cả đoạn).
    for (const f of ["lib/settings/registry.ts", "lib/settings/nhan-van-hanh.ts", "lib/finance/hoa-don/feature.ts"]) {
      expect(tho(f), f).not.toMatch(/hoaDon\.tuXuat|KHOA_TU_XUAT|docCauHinhTuXuat/);
    }
    const src = doc(RUNNER);
    expect(src).not.toMatch(/chayTuXuat|docCauHinhTuXuat|conTrongHanTuXuat|gioTuXuat|soGio/);
    expect(doc("lib/finance/hoa-don/xuat-lien/chon-lan-thu.ts")).not.toMatch(/gioTuXuat|kiemSoGio|denGioTuXuat|conTrongHanTuXuat|TOI_DA_NGAY_CHO_TU_XUAT/);
    expect(doc("app/api/cron/hoa-don-misa-doi-soat/route.ts")).not.toMatch(/TuXuat|tuXuat/);
  });

  it("[XLW-2] phát hành đi qua CHÍNH máy trạng thái: đúng một batDauPhatHanh + một guiPhatHanh, KHÔNG `loDem` (người mua là thông tin phụ huynh khai, không phải «tiêu dùng»), actor hệ thống, người bấm là tham số", () => {
    const src = doc(RUNNER);
    expect(dem(src, /\bbatDauPhatHanh\(/g)).toBe(1);
    expect(dem(src, /\bguiPhatHanh\(/g)).toBe(1);
    expect(src).not.toMatch(/\bloDem\b|nguoiMuaChoLoDem|tenHocVienChoLanThu/);
    expect(dem(src, /actor:\s*SYSTEM_ACTOR/g)).toBe(1);
    expect(dem(src, /nguoiBam:\s*ctx\.nguoiBam/g)).toBe(1);
    expect(dem(src, /id:\s*SYSTEM_USER_ID/g)).toBe(0); // người bấm đến từ NGƯỜI GỌI (Sale), không cứng «hệ thống»
  });

  it("[XLW-3] lần thu phải qua `lyDoBoQuaTuXuat` TRƯỚC khi chạm máy phát hành; chỉ khoản CONFIRMED; KHÔNG đường tự xác nhận tiền", () => {
    const src = doc(RUNNER);
    expect(dem(src, /\blyDoBoQuaTuXuat\(/g)).toBe(1);
    expect(src.indexOf("lyDoBoQuaTuXuat(")).toBeLessThan(src.indexOf("batDauPhatHanh("));
    expect(dem(src, /accountantStatus:\s*\{\s*not:\s*"CONFIRMED"\s*\}/g)).toBe(1);
    expect(src).not.toMatch(/\bchotHoaDon\(|\bxacNhanKhoan\w*\(|\bconfirmPayment\(/);
    // Bản xem trước (hộp đối chiếu) dùng CHÍNH cổng chọn đó — cái Sale thấy là cái sẽ được xuất.
    const xt = doc("lib/finance/hoa-don/xuat-lien.ts");
    expect(dem(xt, /\blyDoBoQuaTuXuat\(/g)).toBe(1);
    expect(dem(xt, /accountantStatus:\s*\{\s*not:\s*"CONFIRMED"\s*\}/g)).toBe(1);
  });

  it("[XLW-4] đóng yêu cầu CHỈ sau khi có hoá đơn được tạo, bằng `updateMany` có điều kiện `trangThai: \"DANG_MO\"` + `centerId` của chính yêu cầu; xếp thư NGAY chỉ khi đã XÁC NHẬN xong", () => {
    const src = doc(RUNNER);
    expect(dem(src, /\bdongYeuCau\(yc,/g)).toBe(1);
    expect(src).toMatch(/updateMany\(\{ where: \{ id: yc\.id, centerId: yc\.centerId, trangThai: "DANG_MO" \}, data: \{ trangThai: "DA_AP_DUNG"/);
    const xl = src.slice(src.indexOf("export async function xuatLienDon"));
    expect(xl.indexOf("if (taoDuoc > 0)")).toBeGreaterThan(xl.indexOf("xuLyMotYeuCau("));
    expect(xl.indexOf("dongYeuCau(yc, input.now,")).toBeGreaterThan(xl.indexOf("if (taoDuoc > 0)"));
    expect(xl).toMatch(/if \(kq\.daXuat > 0\) guiNgay = await guiThuNgay\(\)/);
    // Lô cuối ngày đóng yêu cầu sau khi hoá đơn của đơn đó được tạo (DA_XUAT hoặc DANG_PHAT_HANH).
    expect(dem(doc("lib/finance/hoa-don/xuat-lo-dem/chay-lo-dem.ts"), /await dongYeuCauSauXuat\(d\.orderId\)/g)).toBe(2);
  });

  it("[XLW-5] action: quyền + cờ thí điểm + dấu đối chiếu đứng TRƯỚC phát hành; xuatLienDon được gọi đúng MỘT lần, sau khi so dấu", () => {
    const src = doc(ACTION);
    expect(dem(src, /\bxuatLienDon\(/g)).toBe(1);
    const iQuyen = src.indexOf("duocXuLyYeuCau(b.actor, centerId)");
    const iCo = src.indexOf("coSoNguoiMuaDuoc()");
    const iDau = src.indexOf("xt.dauVan !== dauVan");
    const iXuat = src.indexOf("xuatLienDon(");
    expect(iQuyen).toBeGreaterThan(-1);
    expect(iCo).toBeGreaterThan(-1);
    expect(iDau).toBeGreaterThan(-1);
    expect(iXuat).toBeGreaterThan(Math.max(iQuyen, iCo, iDau));
    // Người bấm = người đăng nhập (nhật ký ghi tên Sale), không cứng «hệ thống».
    expect(src).toMatch(/xuatLienDon\(\{ orderId, centerId: b\.centerId, nguoiBam: b\.nguoi/);
  });

  it("[XLW-6] thư: hoá đơn do HỆ THỐNG tạo (lô) hẹn 8h sáng; lượt do NGƯỜI tạo (Xuất liền / Gửi lại) đi ngay — MỘT điều kiện duy nhất ở handler xếp thư", () => {
    const src = doc("lib/finance/hoa-don/gui-email.ts");
    expect(dem(src, /g\.guiBoiId === SYSTEM_USER_ID \? \{ scheduledAt: thoiDiemGuiThuHoaDonLo\(opts\.now \?\? new Date\(\)\) \} : \{\}/g)).toBe(1);
    expect(dem(src, /\bscheduledAt\b/g)).toBe(1); // không đường nào khác tự hẹn giờ
  });

  it("[XLW-7] MỌI hoá đơn xác nhận xong phát sự kiện chung `hoa-don.da-xuat` trong CÙNG transaction chốt (một chỗ, khoá chống trùng theo hoá đơn); handler đăng ký một lần", () => {
    const chot = doc("lib/finance/hoa-don/chot-hoa-don.ts");
    expect(dem(chot, /publishEvent\("hoa-don\.da-xuat", \{ hoaDonId \}, \{ tx, dedupeKey: `hoa-don\.da-xuat:\$\{hoaDonId\}` \}\)/g)).toBe(1);
    const gui = doc("lib/finance/hoa-don/gui-email.ts");
    expect(dem(gui, /on\("hoa-don\.da-xuat"/g)).toBe(1);
  });

  it("[XLW-8] «Xuất liền» GIỮ đơn cọc chưa trả đủ: runner VÀ bản xem trước đều truyền cờ của dòng vào bộ chọn (mỗi nơi đúng MỘT chỗ), bộ chọn có mã lý do riêng", () => {
    expect(dem(doc(RUNNER), /cocChuaTraDu:\s*d\.cocChuaTraDu/g)).toBe(1);
    expect(dem(doc("lib/finance/hoa-don/xuat-lien.ts"), /cocChuaTraDu:\s*d\.cocChuaTraDu/g)).toBe(1);
    expect(doc("lib/finance/hoa-don/xuat-lien/chon-lan-thu.ts")).toMatch(/if \(d\.cocChuaTraDu\) return "DON_COC_CHUA_TRA_DU"/);
  });
});
