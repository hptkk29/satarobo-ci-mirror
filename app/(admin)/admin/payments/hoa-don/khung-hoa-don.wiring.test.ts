/**
 * [HDNAV-W*] Lưới ghim DÂY NỐI của khung trang Hoá đơn (S5b).
 *
 * Hành vi của nav / thanh phạm vi đã có test riêng; thứ test hành vi KHÔNG chạm tới là RSC ráp chúng lại:
 *   · layout quên vẽ thanh phạm vi / nav, hoặc lấy danh sách cơ sở từ chỗ KHÔNG lọc phạm vi kế toán;
 *   · một trang vẽ lại ô chọn cơ sở riêng (lại thành 2–3 bản chép tay, lệch nhau về cách đổi URL);
 *   · trang Cảnh báo / Hoá đơn mất cổng quyền (layout KHÔNG thay được cổng của trang).
 * Neo vào LỜI GỌI / BIỂU THỨC ĐIỀU KIỆN + số lần khớp trên mã đã bỏ chú thích (CLAUDE.md luật 11, mẫu LƯỚI GHIM).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = "app/(admin)/admin/payments/hoa-don";
function doc(tuongDoi: string): string {
  const f = resolve(process.cwd(), GOC, tuongDoi);
  expect(existsSync(f), `thiếu ${tuongDoi}`).toBe(true);
  // Bỏ chú thích trước khi đếm: khối giải thích bản vá hay chứa đúng chuỗi đang canh.
  return readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const dem = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

describe("[HDNAV-W1] layout ráp nav + thanh phạm vi từ dữ liệu ĐÃ LỌC phạm vi", () => {
  const ma = doc("layout.tsx");

  it("vẽ đúng MỘT HoaDonNav và MỘT HoaDonScopeBar", () => {
    expect(dem(ma, /<HoaDonNav\b/g)).toBe(1);
    expect(dem(ma, /<HoaDonScopeBar\b/g)).toBe(1);
  });

  it("danh sách cơ sở đến từ napCoSoLocHoaDon(actor) (đã lọc phạm vi kế toán) — đúng 1 lời gọi, không tự tra bảng Center", () => {
    expect(dem(ma, /napCoSoLocHoaDon\(/g)).toBe(1);
    expect(ma).not.toMatch(/\.center\.find/);
    expect(ma).not.toMatch(/from "@\/lib\/db"/);
  });

  it("pháp nhân hiển thị suy bằng tomTatPhapNhanTheoCoSo trên danh sách pháp nhân của MÔI TRƯỜNG (không dùng hằng mặc định)", () => {
    expect(dem(ma, /tomTatPhapNhanTheoCoSo\(/g)).toBe(1);
    expect(ma).toMatch(/cauHinhHoaDonChoMoiTruong\(\)\.phapNhan/);
    expect(ma).not.toMatch(/CAU_HINH_HOA_DON_MAC_DINH/);
  });

  it("tab hiện theo CHÍNH khoá PAGE_GATES mà trang đích gác — hai khoá, mỗi khoá một lần hỏi quyền", () => {
    expect(dem(ma, /khuVucHienThi\(/g)).toBe(1);
    expect(ma).toMatch(/checkAnyPermission\(PAGE_GATES\["\/payments\/hoa-don"\]\)/);
    expect(ma).toMatch(/checkAnyPermission\(PAGE_GATES\["\/payments\/hoa-don\/cau-hinh"\]\)/);
  });

  it("cờ TẮT ⇒ notFound() đứng TRƯỚC auth(); chưa đăng nhập / không quyền nào ⇒ trả nguyên children (trang tự redirect)", () => {
    expect(ma).toMatch(/if \(!\(await laHoaDonBat\(\)\)\) notFound\(\);/);
    expect(ma.indexOf("laHoaDonBat()")).toBeLessThan(ma.indexOf("auth()"));
    expect(dem(ma, /return <>\{children\}<\/>;/g)).toBe(2);
  });

  it("trần chiều rộng + container có tên cho thanh phạm vi (không đổi AdminShell)", () => {
    expect(ma).toMatch(/@container\/hd/);
    expect(ma).toMatch(/max-w-\[\d+rem\]/);
  });

  it("layout là chủ DUY NHẤT của <h1> (PageHeader)", () => {
    expect(dem(ma, /<PageHeader\b/g)).toBe(1);
  });
});

describe("[HDNAV-W2] mỗi trang chỉ còn là NỘI DUNG của khung — không vẽ lại ô chọn cơ sở, không vẽ lại <h1>", () => {
  const TRANG = ["page.tsx", "canh-bao/page.tsx", "cau-hinh/page.tsx", "chung-tu-ngan-hang/page.tsx", "_components/trang-ban-chung-tu.tsx"];
  it.each(TRANG)("%s không có <select>, form GET 'Xem', hay PageHeader riêng", (f) => {
    const ma = doc(f);
    expect(ma).not.toMatch(/<select\b/);
    expect(ma).not.toMatch(/method="get"/);
    expect(ma).not.toMatch(/<PageHeader\b/);
  });

  it("bàn chứng từ không còn ô Cơ sở / Tháng (đã chuyển lên thanh phạm vi); ô Sắp xếp VẪN ở đây", () => {
    const ma = doc("_components/ban-chung-tu.tsx");
    expect(ma).not.toMatch(/aria-label="Cơ sở"/);
    expect(ma).not.toMatch(/aria-label="Tháng"/);
    expect(ma).toMatch(/aria-label="Sắp xếp"/);
  });
});

describe("[HDNAV-W3] cổng quyền KHÔNG dời đi đâu: mỗi trang tự gác (layout chưa đủ — CLAUDE.md luật 5)", () => {
  it.each([
    ["page.tsx", "/payments/hoa-don"],
    ["canh-bao/page.tsx", "/payments/hoa-don"],
    ["cau-hinh/page.tsx", "/payments/hoa-don/cau-hinh"],
  ])("%s: cờ → auth → PAGE_GATES[%s] → redirect", (f, khoa) => {
    const ma = doc(f);
    expect(ma).toMatch(/if \(!\(await laHoaDonBat\(\)\)\) notFound\(\);/);
    expect(ma).toMatch(/const session = await auth\(\);/);
    expect(ma).toContain(`PAGE_GATES["${khoa}"]`);
    expect(ma).toMatch(/redirect\("\/dashboard\?error=unauthorized"\)/);
    expect(ma.indexOf("laHoaDonBat()")).toBeLessThan(ma.indexOf("auth()"));
  });
});

describe("[HDNAV-W4] URL cũ + thông báo cũ vẫn chạy: chuyển hướng nằm ở MỘT chỗ dùng chung", () => {
  const ma = doc("_components/trang-ban-chung-tu.tsx");

  it("ngăn ghi thẳng trên URL thuộc khu vực khác ⇒ chuyển hướng TRƯỚC mọi lần nạp (không đợi lấy hàng chờ)", () => {
    const m = /if \(laNgan\(sp\.ngan\) && khuVucCuaNgan\(sp\.ngan\) !== khuVuc\) redirect\(chuyenKhuVuc\(sp, khuVucCuaNgan\(sp\.ngan\)\)\);/.exec(ma);
    expect(m).not.toBeNull();
    expect(m!.index).toBeLessThan(ma.indexOf("resolveActor("));
    expect(m!.index).toBeLessThan(ma.indexOf("napHangChoHoaDon("));
  });

  it("ngăn suy từ dòng chọn nằm khu vực khác ⇒ redirect(chuyenKhuVuc(…)) sau khi nạp — chọn ngăn qua chonNganTheoKhuVuc, không còn chonNgan trần", () => {
    expect(dem(ma, /chonNganTheoKhuVuc\(/g)).toBe(1);
    expect(ma).toMatch(/if \(lacSang\) redirect\(chuyenKhuVuc\(/);
    expect(ma).not.toMatch(/\bchonNgan\(/);
  });

  it("?hoaDon= không kèm cơ sở ⇒ chuẩn hoá URL để thanh phạm vi nói cùng một cơ sở với bảng", () => {
    expect(ma).toMatch(/sp\.hoaDon && !sp\.chon && !sp\.coSo && tuHoaDon/);
  });

  it("luật 'chưa chọn cơ sở ⇒ không nạp gì' còn nguyên ở nơi logic đã dời tới (thay [HDCS-W1] cũ đọc page.tsx)", () => {
    expect(dem(ma, /chonCoSoLamViec\(/g)).toBe(1);
    expect(ma).toMatch(/const chuaChonCoSo = coSoLamViec === null;/);
    expect(dem(ma, /napHangChoHoaDon\(/g)).toBe(1);
    expect(/chuaChonCoSo\s*\?\s*\{[^}]*dong:\s*\[\][^}]*\}\s*:\s*await napHangChoHoaDon\(/.test(ma)).toBe(true);
    expect(ma).toMatch(/const boLoc = \{ \.\.\.boLocTho, coSo: coSoLamViec \};/);
  });
});

describe("[HDNAV-W5] cau-hinh: thanh tab con KHÔNG hiện tab chưa có chức năng (luật 12)", () => {
  it("chỉ khai tab 'Pháp nhân & ký hiệu'; không có Nhà cung cấp / Ký số / Chính sách tự động / Mẫu thông báo / QR người mua", () => {
    const ma = doc("cau-hinh/_components/cau-hinh-tabs.tsx");
    expect(ma).toMatch(/Pháp nhân & ký hiệu/);
    for (const chua of ["Nhà cung cấp", "Ký số", "Chính sách tự động", "Mẫu thông báo", "QR người mua"]) {
      expect(ma, `tab "${chua}" chưa có chức năng thật mà đã hiện`).not.toContain(chua);
    }
  });
});
