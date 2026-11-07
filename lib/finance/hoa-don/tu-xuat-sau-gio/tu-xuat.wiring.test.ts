import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Lưới ghim DÂY NỐI của «tự xuất hoá đơn sau n giờ» (BGĐ 03/11/2026) — phần không có test hành vi nào bắt được: mặc định TẮT của công tắc, số giờ là CẤU HÌNH (không hằng ẩn),
// pha P4 nằm trong cron đối soát SAU P1, đường phát hành là máy trạng thái chung (không `loDem`), và KHÔNG có đường tự xác nhận tiền.
// Đọc mã nguồn đã bỏ chú thích (chú thích giải thích bản vá thường chứa đúng chuỗi đang cấm).

const doc = (f: string) =>
  readFileSync(resolve(process.cwd(), f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dem = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

const RUNNER = "lib/finance/hoa-don/tu-xuat-sau-gio/chay-tu-xuat.ts";

describe("[TXW] dây nối tự xuất sau n giờ", () => {
  it("[TXW-1] công tắc TẮT mặc định, KHÔNG cài riêng theo cơ sở; số giờ mặc định 2, số nguyên 1..72 — cả hai khai ở registry", () => {
    // Đọc THÔ: registry có chuỗi chứa "/*" nên bộ bỏ chú thích khối ăn mất cả đoạn; khoá `": def({` chỉ có ở mã.
    const reg = readFileSync(resolve(process.cwd(), "lib/settings/registry.ts"), "utf8");
    const khoi = (key: string) => {
      const i = reg.indexOf(`"${key}": def({`);
      expect(i, key).toBeGreaterThan(-1);
      return reg.slice(i, reg.indexOf("}),", i));
    };
    const bat = khoi("hoaDon.tuXuatBat");
    expect(bat).toMatch(/schema:\s*z\.boolean\(\)/);
    expect(bat).toMatch(/default:\s*false/);
    expect(bat).toMatch(/centerOverridable:\s*false/);
    const gio = khoi("hoaDon.tuXuatSauGio");
    expect(gio).toMatch(/schema:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(72\)/);
    expect(gio).toMatch(/default:\s*2\b/);
    expect(gio).toMatch(/centerOverridable:\s*false/);
  });

  it("[TXW-2] nhãn vận hành cho cả hai khoá (admin sửa được trong Cấu hình vận hành), có đơn vị «giờ»", () => {
    const nhan = readFileSync(resolve(process.cwd(), "lib/settings/nhan-van-hanh.ts"), "utf8");
    for (const key of ["hoaDon.tuXuatBat", "hoaDon.tuXuatSauGio"]) {
      const i = nhan.indexOf(`"${key}": {`);
      expect(i, key).toBeGreaterThan(-1);
      expect(nhan.slice(i, nhan.indexOf("},", i)), key).toMatch(/canThan:\s*true/);
    }
    const i = nhan.indexOf(`"hoaDon.tuXuatSauGio": {`);
    expect(nhan.slice(i, nhan.indexOf("},", i))).toMatch(/donVi:\s*"giờ"/);
  });

  it("[TXW-3] cấu hình đọc ở MỘT chỗ (feature.ts): cần màn Hoá đơn BẬT; công tắc TẮT thì KHÔNG đọc số giờ", () => {
    const src = doc("lib/finance/hoa-don/feature.ts");
    const i = src.indexOf("export async function docCauHinhTuXuat");
    expect(i).toBeGreaterThan(-1);
    const ham = src.slice(i, src.indexOf("\n}", i));
    expect(ham).toMatch(/getSetting\(KHOA_HOA_DON\)/);
    expect(ham).toMatch(/getSetting\(KHOA_TU_XUAT_BAT\)/);
    expect(dem(ham, /getSetting\(KHOA_TU_XUAT_SAU_GIO\)/g)).toBe(1);
    expect(ham.indexOf("if (!man || !bat)")).toBeGreaterThan(-1);
    expect(ham.indexOf("if (!man || !bat)")).toBeLessThan(ham.indexOf("getSetting(KHOA_TU_XUAT_SAU_GIO)"));
    // Không nơi nào ngoài feature.ts đọc hai khoá này trực tiếp.
    for (const f of [RUNNER, "lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db.ts", "app/api/cron/hoa-don-misa-doi-soat/route.ts"]) {
      expect(doc(f), f).not.toMatch(/getSetting\(\s*["']hoaDon\.tuXuat/);
    }
  });

  it("[TXW-4] cron: pha P4 gọi đúng MỘT điểm vào, SAU P1 (đối soát bản treo) và SAU P3; kết quả dưới khoá `tuXuat`; maxDuration đủ rộng", () => {
    const route = doc("app/api/cron/hoa-don-misa-doi-soat/route.ts");
    expect(dem(route, /\bchayTuXuatCuaCron\(/g)).toBe(1);
    const i1 = route.indexOf("doiSoatPhatHanhTreo(");
    const i3 = route.indexOf("chayDonDepNguoiMua(");
    const i4 = route.indexOf("chayTuXuatCuaCron(");
    expect(i1).toBeGreaterThan(-1);
    expect(i3).toBeGreaterThan(-1);
    expect(i4).toBeGreaterThan(i3);
    expect(i4).toBeGreaterThan(i1);
    expect(route).toMatch(/\.\.\.\(tuXuat === null \? \{\} : \{ tuXuat \}\)/);
    expect(route).toMatch(/export const maxDuration = 120;/);
  });

  it("[TXW-5] phát hành đi qua CHÍNH máy trạng thái: đúng một batDauPhatHanh + một guiPhatHanh, KHÔNG `loDem` (người mua là thông tin PH khai, không phải «tiêu dùng»), người bấm là hệ thống", () => {
    const src = doc(RUNNER);
    expect(dem(src, /\bbatDauPhatHanh\(/g)).toBe(1);
    expect(dem(src, /\bguiPhatHanh\(/g)).toBe(1);
    expect(src).not.toMatch(/\bloDem\b|nguoiMuaChoLoDem|tenHocVienChoLanThu/);
    expect(dem(src, /actor:\s*SYSTEM_ACTOR/g)).toBe(1);
    expect(dem(src, /id:\s*SYSTEM_USER_ID/g)).toBe(1);
  });

  it("[TXW-6] lần thu phải qua `lyDoBoQuaTuXuat` TRƯỚC khi chạm máy phát hành; chỉ khoản CONFIRMED; KHÔNG đường tự xác nhận tiền", () => {
    const src = doc(RUNNER);
    expect(dem(src, /\blyDoBoQuaTuXuat\(/g)).toBe(1);
    expect(src.indexOf("lyDoBoQuaTuXuat(")).toBeLessThan(src.indexOf("batDauPhatHanh("));
    expect(dem(src, /accountantStatus:\s*\{\s*not:\s*"CONFIRMED"\s*\}/g)).toBe(1);
    expect(src).not.toMatch(/\bchotHoaDon\(|\bxacNhanKhoan\w*\(|\bconfirmPayment\(/);
  });

  it("[TXW-7] cổng thời gian: yêu cầu lấy theo `guiLuc ≤ now − n giờ` VÀ `≥ now − 7 ngày`, chỉ DANG_MO, chỉ cơ sở thí điểm + luồng QR bật; trần mỗi lượt có mặt", () => {
    const src = doc(RUNNER);
    expect(src).toMatch(/trangThai:\s*"DANG_MO",\s*centerId:\s*\{\s*in:\s*coSo\s*\},\s*guiLuc:\s*\{\s*not:\s*null,\s*lte:\s*toiGio,\s*gte:\s*sanNgay\s*\}/);
    expect(dem(src, /\bcoSoNguoiMuaDuoc\(\)/g)).toBe(1);
    expect(dem(src, /\bconTrongHanTuXuat\(/g)).toBe(1);
    expect(src).toMatch(/take:\s*TRAN_YEU_CAU_MOI_LUOT/);
    expect(src).toMatch(/TRAN_PHAT_HANH_MOI_LUOT\s*=\s*10\b/);
  });

  it("[TXW-8] đóng yêu cầu CHỈ sau khi có hoá đơn được tạo, bằng `updateMany` có điều kiện `trangThai: \"DANG_MO\"` + `centerId` của chính yêu cầu", () => {
    const src = doc(RUNNER);
    expect(dem(src, /\bdongYeuCau\(yc,/g)).toBe(1);
    expect(src).toMatch(/if \(taoDuoc > 0\)\s*\{\s*try \{\s*if \(await dongYeuCau\(yc, input\.now\)\)/);
    expect(src).toMatch(/updateMany\(\{ where: \{ id: yc\.id, centerId: yc\.centerId, trangThai: "DANG_MO" \}, data: \{ trangThai: "DA_AP_DUNG"/);
  });

  it("[TXW-9] giờ tự xuất hiển thị cho nhân viên và giờ cron dùng đến từ CÙNG một hàm `gioTuXuat` — không công thức thứ hai", () => {
    expect(dem(doc("lib/finance/hoa-don/yeu-cau-nguoi-mua-doc-db.ts"), /\bgioTuXuat\(/g)).toBe(1);
    const src = doc(RUNNER);
    // Cron tính ngưỡng ở câu tra (`toiGio`); hiển thị tính `gioTuXuat`. Hai đường phải cùng đơn vị: n × 3_600_000 ms.
    expect(src).toMatch(/input\.soGio \* 3_600_000/);
    expect(doc("lib/finance/hoa-don/tu-xuat-sau-gio/chon-lan-thu.ts")).toMatch(/kiemSoGio\(soGio\) \* 3_600_000/);
  });

  it("[TXW-10] lô 23h vẫn BỎ QUA đơn mà phụ huynh đang khai (KHACH_DANG_KHAI) — quần thể của tự xuất sau n giờ — để hai đường không giẫm chân nhau", () => {
    const src = doc("lib/finance/hoa-don/xuat-lo-dem/chon-lan-thu.ts");
    expect(src).toMatch(/bc\.donKhachDangKhai\.has\(d\.orderId\)\)\s*return "KHACH_DANG_KHAI"/);
  });
});
