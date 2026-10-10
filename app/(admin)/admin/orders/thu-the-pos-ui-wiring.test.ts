// Ca [POS1-UI-W1..W4] · [POS1-UI-03] — LƯỚI GHIM MÃ NGUỒN cho giao diện thu thẻ POS (GĐ1). THUẦN.
//
// Thiết kế: docs/pos-gd1-thiet-ke.md §7. Thứ cần khoá là DÂY NỐI — test hành vi của `nutThuThe` /
// `dungPhieuPosView` xanh vĩnh viễn kể cả khi trang không truyền prop nào xuống (luật 11: prop cờ
// mặc định `false` không ai truyền là lỗi CÂM, triệu chứng "nút không bao giờ hiện" trông y hệt lỗi
// phân quyền). Bóc chú thích TRƯỚC khi đếm, khẳng định SỐ LẦN khớp. Mã TRƯỚC bản vá ghi tại từng ca.
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

const doc = (tep: string) => bocChuThich(readFileSync(resolve(process.cwd(), tep), "utf8"));
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, "g"))].length;

const TRANG = doc("app/(admin)/admin/orders/[id]/page.tsx");
const CHI_TIET = doc("app/(admin)/admin/orders/_components/order-detail-client.tsx");
const BANG = doc("app/(admin)/admin/orders/_components/payment-requests-section.tsx");
const HOP = doc("app/(admin)/admin/orders/_components/hop-phieu-pos.tsx");
const NHAP = doc("app/(admin)/admin/bien-dong-so-du/_components/nhap-file-pos.tsx");

const BA_PROP = ["duocThuThePos", "phieuPos", "mayPos"] as const;

describe("[POS1-UI-W] dây nối trang đơn → bảng phiếu thu → hộp phiếu POS", () => {
  it("[POS1-UI-W1] trang hỏi `payments:pos-check` TRONG lô quyền và nạp phiếu POS + máy TRONG lô có sẵn", () => {
    // Mã TRƯỚC bản vá: không có — trang không biết gì về phiếu POS, nút không bao giờ được vẽ.
    expect(dem(TRANG, /checkPermission\("payments:pos-check"\)/)).toBe(1);
    expect(dem(TRANG, /docPhieuPosTho\(order\.id\)/)).toBe(1);
    expect(dem(TRANG, /\.posTerminal\.findMany\(/)).toBe(1);
    // Không `await` riêng cho hai câu tra mới — `[DST-01]` đếm tổng, ca này nói RÕ thủ phạm.
    expect(dem(TRANG, /await\s+docPhieuPosTho\(/)).toBe(0);
    expect(dem(TRANG, /await\s+sdb\.posTerminal/)).toBe(0);
    // Gác bằng QUYỀN, KHÔNG bằng cờ `batThuTheoCon` (T8: cờ tắt vẫn xem được phiếu cũ).
    expect(TRANG).toMatch(/duocThuThePos\s*\?\s*docPhieuPosTho\(order\.id\)/);
    expect(TRANG).not.toMatch(/batThuTheoCon\s*\?\s*docPhieuPosTho/);
  });

  it("[POS1-UI-W2] ba prop truyền ĐỦ hai bậc và khai BẮT BUỘC (không `?`, không mặc định)", () => {
    for (const p of BA_PROP) {
      expect(dem(TRANG, new RegExp(`\\b${p}=\\{`)), `page.tsx truyền ${p}`).toBe(1);
      expect(dem(CHI_TIET, new RegExp(`\\b${p}=\\{${p}\\}`)), `order-detail-client truyền tiếp ${p}`).toBe(1);
      for (const [ten, ma] of [
        ["order-detail-client", CHI_TIET],
        ["payment-requests-section", BANG],
      ] as const) {
        expect(dem(ma, new RegExp(`\\b${p}:\\s`)), `${ten} khai ${p} bắt buộc`).toBe(1);
        expect(dem(ma, new RegExp(`\\b${p}\\?:`)), `${ten} không khai ${p} tuỳ chọn`).toBe(0);
        expect(dem(ma, new RegExp(`\\b${p}\\s*=\\s*(false|null|\\[\\])`)), `${ten} không mặc định ${p}`).toBe(0);
      }
    }
  });

  it("[POS1-UI-W3] ô dòng đợt quyết bằng `nutThuThe` (một chỗ), hộp phiếu POS gọi đúng ba action", () => {
    expect(dem(BANG, /\bnutThuThe\(/)).toBe(1);
    expect(dem(BANG, /<HopPhieuPos\b/)).toBe(1);
    expect(dem(HOP, /\btaoPhieuPosAction\(/)).toBe(1);
    expect(dem(HOP, /\bkiemTraPhieuPosAction\(/)).toBe(1);
    expect(dem(HOP, /\bbaoAdminPhieuPosAction\(/)).toBe(1);
  });

  it("[POS1-UI-W4] nút 'Báo admin' hỏi CÙNG hàm cổng máy chủ (`lyDoKhongBaoAdmin`), không tự chép điều kiện", () => {
    // Mã đã tránh: `ketQua === "NOT_FOUND" && Date.now() - tao > 600000` — luật hai nơi có ngày lệch.
    expect(dem(HOP, /\blyDoKhongBaoAdmin\(/)).toBe(1);
    expect(HOP).not.toMatch(/(?<![\d_])600_?000(?![\d_])/);
  });

  it("[POS1-UI-W5] hộp phiếu POS portal ra ngoài khung admin ⇒ mang `admin-scope` (không thì nút lấy màu CAM của :root)", () => {
    expect(HOP).toMatch(/<DialogContent[^>]*className="[^"]*\badmin-scope\b/);
  });
});

describe("[POS1-VA-W] rà đối kháng 06/10/2026 — dây nối trang đơn", () => {
  it("[POS1-VA-W1] cờ thu linh hoạt TẮT giữa chừng mà đơn còn phiếu POS ⇒ VẪN nạp phiếu gộp đang mở cho hộp POS; QR vẫn theo cờ", () => {
    // Mã TRƯỚC bản vá: `batThuTheoCon ? docPhieuGopDangMo(order.id) : Promise.resolve(null)` rồi truyền
    // CHÍNH `phieuMo` đó cho `dungPhieuPosChoDon` ⇒ cờ tắt là `soTienPhaiThu: null` ⇒ hộp in "Phiếu gộp
    // không còn khoản phải thu" trong khi phiếu gộp còn OPEN và mã vẫn nhận tiền (T8).
    expect(dem(TRANG, /const coPhieuPos = \(phieuPosTho\?\.length \?\? 0\) > 0;/)).toBe(1);
    expect(dem(TRANG, /batThuTheoCon \|\| coPhieuPos \? docPhieuGopDangMo\(order\.id\)/)).toBe(1);
    expect(dem(TRANG, /batThuTheoCon \? docPhieuGopDangMo\(/), "cổng cũ chỉ theo cờ đã gỡ").toBe(0);
    // QR / phiếu gộp của bảng vẫn theo cờ (cờ tắt ⇒ không in mã QR mới).
    expect(dem(TRANG, /const phieuMo = batThuTheoCon \? phieuMoTho : null;/)).toBe(1);
    // Hộp POS đọc bản KHÔNG theo cờ.
    expect(dem(TRANG, /dungPhieuPosChoDon\(\{ ds: phieuPosTho, phieuMo: phieuMoTho,/)).toBe(1);
    expect(dem(TRANG, /dungPhieuPosChoDon\(/)).toBe(1);
  });
});

describe("[POS1-UI-03] panel Import POS — nút 'Nhập N dòng' luôn thấy được", () => {
  it("thân cuộn co được (`min-h-0`), header/footer không co (`shrink-0`)", () => {
    // Mã TRƯỚC bản vá: thân `flex-1 space-y-5 overflow-y-auto` — phần tử flex mặc định
    // `min-height:auto` nên KHÔNG co, đẩy `SheetFooter` (nút Nhập) xuống dưới mép màn.
    const thanCuon = [...NHAP.matchAll(/className="([^"]*\boverflow-y-auto\b[^"]*)"/g)].map((m) => m[1]!.split(/\s+/));
    expect(thanCuon, "đúng MỘT vùng cuộn trong panel").toHaveLength(1);
    expect(thanCuon[0]).toEqual(expect.arrayContaining(["flex-1", "min-h-0"]));
    expect(NHAP).toMatch(/<SheetHeader className="[^"]*\bshrink-0\b/);
    expect(NHAP).toMatch(/<SheetFooter className="[^"]*\bshrink-0\b/);
  });

  it("[POS1-UI-04] toast của panel KHÔNG rơi về góc phải (Toaster chung `top-right` đè lên hướng dẫn)", () => {
    // Mã TRƯỚC bản vá: `toast.success(\`Nhập xong …\`)` không `position` ⇒ bong bóng nổi đúng góc
    // phải, chỗ panel in tiêu đề + chữ hướng dẫn. Mỗi lời gọi toast phải mang vị trí riêng.
    //
    // Rà đối kháng 06/10/2026 (`[POS1-VA-UI-04]`): bản vá đầu `position: viTriToast()` (top-center
    // khi < 640px) KHÔNG đổi gì ở ≤ 600px — sonner ép toast rộng hết màn ở đó. Nay vị trí do hàm
    // HÌNH HỌC `viTriToastPanel(window.innerWidth)` quyết, `null` ⇒ không toast; mọi toast mang
    // đúng vị trí ấy và đứng trong nhánh đã hỏi nó.
    const soToast = dem(NHAP, /\btoast\.(success|warning|error|info|message)\(/);
    expect(soToast, "panel phải còn toast kết quả").toBeGreaterThan(0);
    expect(dem(NHAP, /position: viTri \}/)).toBe(soToast);
    expect(dem(NHAP, /const viTri = viTriToastPanel\(window\.innerWidth\);/)).toBe(1);
    expect(dem(NHAP, /if \(viTri\) \{/)).toBe(1);
    expect(dem(NHAP, /viTriToast\(\)/), "hàm vị trí cũ (bỏ qua hình học sonner) đã gỡ").toBe(0);
    expect(dem(NHAP, /\btoast\(/), "toast trần cũng phải mang vị trí").toBe(0);
  });
});
