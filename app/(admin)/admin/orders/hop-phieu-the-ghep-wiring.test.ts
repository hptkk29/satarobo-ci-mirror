// Ca [HNG-W1..W7] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của hộp phiếu thẻ sau khi GHÉP Việc 3 × Việc 4 (docs/pos-hai-nut-khai-may.md §7.8). THUẦN.
//
// Thứ cần khoá là những dây mà test hành vi (`payment-requests-hop-the-loi-ra.test.tsx`, `[HN3-R*]`, `[HN4-U*]`) KHÔNG chạm tới được — luật 11: một đầu vào
// BẮT BUỘC bị gõ cứng, một lời gọi bị gỡ, một transition thứ hai mọc ra, đều để mọi test hàm thuần xanh. Neo vào BIỂU THỨC (không neo chỗ đặt dòng), bóc chú
// thích TRƯỚC khi đếm (chú thích giải thích bản vá hay chứa đúng chuỗi lưới đang tìm), khẳng định SỐ LẦN khớp. Mỗi ca ghi mã TRƯỚC ghép trông thế nào.
//
// Đọc tệp bằng `docOrRong`: tệp chưa tồn tại ⇒ chuỗi rỗng ⇒ từng ca đỏ ở ĐÚNG khẳng định của nó (không phải một lỗi ENOENT cho cả bộ).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function bocChuThich(v: string): string {
  return v
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/[^\n]*$/, "$1"))
    .join("\n");
}
function docOrRong(tep: string): string {
  try {
    return bocChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
  } catch {
    return "";
  }
}
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;

/** Cắt thân MỘT hàm cấp module: từ `function <ten>(` tới `function` cấp module kế tiếp (hoặc hết tệp). */
function thanHam(ma: string, ten: string): string {
  const dau = ma.search(new RegExp(`^(export )?function ${ten}\\b`, "m"));
  if (dau < 0) return "";
  const sau = ma.slice(dau + 1).search(/^(export )?(async )?function \w/m);
  return sau < 0 ? ma.slice(dau) : ma.slice(dau, dau + 1 + sau);
}

const HOP = docOrRong("app/(admin)/admin/orders/_components/hop-phieu-pos.tsx");
const NUT = docOrRong("app/(admin)/admin/orders/_components/huy-phieu-the-dialog.tsx");
const LIB = docOrRong("lib/payments/pos/nut-trong-hop-phieu-the.ts");
const NGOAI = thanHam(HOP, "HopPhieuPos");
const TRONG = thanHam(HOP, "NoiDungPhieu");

describe("[HNG-W] dây nối hộp phiếu thẻ đã ghép", () => {
  it("[HNG-W1] `nutTrongHopPhieuThe` gọi ĐÚNG MỘT lần, trong `NoiDungPhieu`, mỗi đầu vào lấy từ ĐÚNG nguồn — không đầu vào nào gõ cứng", () => {
    // Mã TRƯỚC ghép: không có hàm này — nút huỷ vẽ theo `phieu.huyPhieuThe.huyDuoc` một mình, dòng "Chưa huỷ được" theo `h === CHO_QUET || THAT_BAI`; ghép Việc 3
    // vào thì nút còn sáng trong cửa sổ "vừa gửi" và sau từ chối hộp in HAI lệnh "ĐỪNG cho khách quẹt lại".
    expect(dem(HOP, /\bnutTrongHopPhieuThe\(/), "đúng một lời gọi").toBe(1);
    expect(dem(TRONG, /\bnutTrongHopPhieuThe\(/), "nằm trong NoiDungPhieu").toBe(1);
    expect(dem(NGOAI, /\bnutTrongHopPhieuThe\(/), "hộp ngoài không tự gọi").toBe(0);
    const goi = TRONG.match(/\bnutTrongHopPhieuThe\(\{([\s\S]*?)\}\)/)?.[1] ?? "";
    expect(goi, "hienThi lấy từ `h`").toMatch(/\bhienThi:\s*h\b/);
    expect(goi, "phán quyết huỷ lấy từ view").toMatch(/\bhuyPhieuThe:\s*phieu\.huyPhieuThe\b/);
    expect(goi, "yêu cầu sai mã lấy từ view").toMatch(/\bsaiMa:\s*phieu\.saiMa\b/);
    for (const bien of ["nutSaiMa", "daBiTuChoi", "choLamMoi", "dangHuy"]) {
      expect(goi, `${bien}: truyền CHÍNH biến cùng tên`).toMatch(new RegExp(`(?:^|[\\s,{])${bien}\\s*(?:,|$)`));
      expect(dem(goi, new RegExp(`\\b${bien}\\s*:\\s*(?:true|false)\\b`)), `${bien} không gõ cứng`).toBe(0);
    }
    // `nutSaiMa` do HÀM CỦA VIỆC 3 tính trên câu ĐANG HIỆN (`hien`), một lời gọi duy nhất — lưới `[HN3-W10]` giữ dây ấy; đây giữ việc nó đi vào hàm ghép.
    // Neo từng BIỂU THỨC (không neo thứ tự thuộc tính / tên import): đảo chỗ hai thuộc tính hay thêm một tên import là refactor vô hại.
    expect(dem(TRONG, /const nutSaiMa = nutNhapSaiMa\(/), "một lời gọi, gán vào `nutSaiMa`").toBe(1);
    const goiNhap = TRONG.match(/const nutSaiMa = nutNhapSaiMa\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
    expect(goiNhap, "hienThi lấy từ `h`").toMatch(/\bhienThi:\s*h\b/);
    expect(goiNhap, "câu ĐANG HIỆN").toMatch(/\bthongDiep:\s*hien\?\.thongDiep\b/);
    expect(dem(HOP, /import \{[^}]*\bnutTrongHopPhieuThe\b[^}]*\} from "@\/lib\/payments\/pos\/nut-trong-hop-phieu-the";/), "nhập hàm quyết từ đúng module").toBe(1);
  });

  it("[HNG-W2] MỘT hàm `boCauKiemCu` cho cả hai đường bỏ câu Kiểm tra cũ: khai một lần, gọi ngay TRƯỚC `datDaGui({`, và là `onBoKetQuaCu` của nút huỷ", () => {
    // Mã TRƯỚC ghép: `datVuaKiem(null); datVuaKiemCua(null);` chép HAI lần (gửi sai mã · `onBoKetQuaCu` nội tuyến) — lưới `[HN3-UW2]` (đếm đúng MỘT) đỏ ngay lúc ghép.
    expect(dem(NGOAI, /function boCauKiemCu\(\)/)).toBe(1);
    expect(dem(NGOAI, /\bboCauKiemCu\(\);\s*datDaGui\(\{/), "đường gửi sai mã thành công").toBe(1);
    expect(dem(NGOAI, /\bonBoKetQuaCu=\{boCauKiemCu\}/), "đường huỷ phiếu thẻ").toBe(1);
    expect(dem(NGOAI, /\bdatVuaKiem\(null\);/), "chỉ còn trong hàm gom").toBe(1);
    expect(dem(NGOAI, /\bdatVuaKiemCua\(null\);/), "chỉ còn trong hàm gom").toBe(1);
  });

  it("[HNG-W3] transition của lượt huỷ nằm ở HỘP NGOÀI và có mặt trong `dongDuoc`; nút huỷ KHÔNG giữ transition thứ hai cho cùng một việc", () => {
    // Mã TRƯỚC ghép: `useTransition` nằm trong `NutVaHop` ⇒ `dongDuoc` (`!dangTao && !dangKiem && !dangBao && !dangTim && !dangGui`) không biết "đang huỷ" ⇒
    // hộp ngoài đóng được ở cửa sổ giữa lúc hộp xác nhận đã đóng và lúc trang mới về (docs §7.5-B mục 6).
    expect(dem(NGOAI, /const \[dangHuy, startHuy\] = useTransition\(\);/)).toBe(1);
    expect(dem(NGOAI, /const dongDuoc = [^;]*!dangHuy\b[^;]*;/), "dongDuoc có `!dangHuy` (vị trí trong chuỗi `&&` không quan trọng)").toBe(1);
    expect(dem(NGOAI, /<NoiDungPhieu[\s\S]*?\bdangHuy=\{dangHuy\}[\s\S]*?\bbatDauHuy=\{startHuy\}/)).toBe(1);
    expect(dem(TRONG, /\bdangChay=\{dangHuy\}/), "nút huỷ nhận cờ đang huỷ của hộp ngoài").toBe(1);
    expect(dem(TRONG, /\bbatDau=\{batDauHuy\}/), "nút huỷ dùng CHÍNH transition của hộp ngoài").toBe(1);
    expect(dem(TRONG, /\bdangHuy: boolean;/), "khai BẮT BUỘC").toBe(1);
    expect(dem(TRONG, /\bbatDauHuy: TransitionStartFunction;/), "khai BẮT BUỘC").toBe(1);
    expect(dem(NUT, /\buseTransition\(/), "nút huỷ không tự mở transition").toBe(0);
    expect(dem(NUT, /\bdangChay: boolean;/), "khai BẮT BUỘC").toBeGreaterThanOrEqual(2);
    expect(dem(NUT, /\bbatDau: TransitionStartFunction;/), "khai BẮT BUỘC").toBeGreaterThanOrEqual(2);
  });

  it("[HNG-W4] component KHÔNG tự quyết huỷ được hay không: không đọc `huyDuoc` / `ma` của phán quyết ở hộp — chỉ vẽ theo `nut`", () => {
    // Hai nơi cùng quyết "huỷ được không" là hai nơi có ngày cãi nhau (khuôn `nutThuThe` / `kenhCuaDong`). `phieu.huyPhieuThe` chỉ được ĐƯA VÀO hàm quyết
    // và ĐƯA VÀO dòng lý do (để in cặp câu) — không được so.
    expect(dem(HOP, /\bhuyDuoc\b/)).toBe(0);
    expect(dem(HOP, /\.huyPhieuThe\.(?:huyDuoc|ma|lyDo|viecNenLam|canXacNhanManh)\b/)).toBe(0);
    expect(dem(TRONG, /\{nut\.huyPhieuThe === "NUT" && \(\s*<NutHuyPhieuThe\b/), "nút sau cổng của hàm quyết").toBe(1);
    // Dòng lý do: đúng MỘT cổng của hàm quyết, đứng trước đúng MỘT `<DongKhongHuyDuoc` (khung bọc không quan trọng); tông cảnh báo lấy từ `nut.tienDangBay`, component không tự so.
    expect(dem(TRONG, /nut\.huyPhieuThe === "DONG_LY_DO"/), "dòng lý do sau cổng của hàm quyết").toBe(1);
    expect(dem(TRONG, /<DongKhongHuyDuoc\b/)).toBe(1);
    expect(dem(TRONG, /<DongKhongHuyDuoc\b[^>]*\bcanh=\{nut\.tienDangBay\}/), "tông cảnh báo theo hàm quyết").toBe(1);
    expect(TRONG.search(/nut\.huyPhieuThe === "DONG_LY_DO"/)).toBeLessThan(TRONG.search(/<DongKhongHuyDuoc\b/));
  });

  it("[HNG-W5] khi đang huỷ, các việc khác trên CÙNG phiếu đứng yên: 'Kiểm tra thanh toán' và 'Báo admin' khoá theo `dangHuy` (đối xứng với nút huỷ khoá khi Kiểm tra/Báo admin chạy)", () => {
    // Neo BIỂU THỨC `disabled={…}` có đủ hai biến — KHÔNG neo thứ tự toán hạng (`a || b` ≡ `b || a`).
    const khoaBoi = (bien: string) => {
      const ra = [...TRONG.matchAll(/disabled=\{([^}]*)\}/g)].map((m) => m[1] ?? "");
      return ra.filter((e) => new RegExp(`\\b${bien}\\b`).test(e) && /\bdangHuy\b/.test(e)).length;
    };
    expect(khoaBoi("dangKiem"), "Kiểm tra thanh toán").toBe(1);
    expect(khoaBoi("dangBao"), "Báo admin").toBe(1);
    const dangBan = TRONG.match(/\bdangBan=\{([^}]*)\}/)?.[1] ?? "";
    for (const bien of ["dangKiem", "dangBao", "dangTao"]) expect(dangBan, `nút huỷ khoá khi hộp đang ${bien}`).toMatch(new RegExp(`\\b${bien}\\b`));
  });

  it("[HNG-W6] câu nói khác biệt vẽ khi `nut.phanBiet`, lấy từ HẰNG — component không gõ lại chữ", () => {
    expect(dem(TRONG, /\{nut\.phanBiet && <p\b[^>]*>\{CAU_PHAN_BIET_HAI_NUT\}<\/p>\}/)).toBe(1);
    expect(dem(HOP, /CHƯA quẹt/), "không gõ lại câu ở component").toBe(0);
    // Nút nhập sai mã vẽ theo KẾT QUẢ của hàm ghép (không theo `nutSaiMa` trần — bỏ qua hai ngoại lệ vừa gửi / đang giữ yêu cầu).
    expect(dem(TRONG, /\{!dangKiem && nut\.nhapSaiMa && \(/)).toBe(1);
    expect(dem(TRONG, /\{!dangKiem && nutSaiMa && \(/)).toBe(0);
  });

  it("[HNG-W7] hàm quyết là THUẦN và là LÁ: không React / Next / DB / server-only; chỉ import kiểu của luật phiếu thẻ và hằng nhãn của hợp đồng Việc 4", () => {
    expect(LIB, "tệp tồn tại").not.toBe("");
    expect(dem(LIB, /from "(?:react|react-dom|next[^"]*|server-only|@\/lib\/db[^"]*|@prisma\/client)"/)).toBe(0);
    // Neo MODULE được import (không neo danh sách tên): thêm một kiểu / hằng từ hai module lá này là hợp lệ. Vòng import mới là thứ phải chặn.
    expect(dem(LIB, /^import type \{[^}]*\} from "\.\/phieu-pos-luat";$/m), "chỉ KIỂU từ phieu-pos-luat (không vòng import)").toBe(1);
    expect(dem(LIB, /^import \{[^}]*\} from "\.\/huy-phieu-the-cau";$/m), "hằng + kiểu từ tệp văn bản lá").toBe(1);
    expect(dem(LIB, /^import\b/m), "đúng hai module được import").toBe(2);
  });
});
