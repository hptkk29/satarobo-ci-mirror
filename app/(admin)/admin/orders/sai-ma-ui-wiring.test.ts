// Ca [HN3-UW1..UW3] — LƯỚI GHIM MÃ NGUỒN cho LỚP HIỂN THỊ của "Tôi nhập sai mã trên máy" (Việc 3 · lượt hoàn thiện giao diện 09/10/2026). THUẦN.
//
// Vì sao cần lưới (luật 11): test HÀNH VI (`payment-requests-sai-ma.test.tsx`, `khu-sai-ma-pos.test.tsx`) xanh vĩnh viễn kể cả khi
//   · một prop bắt buộc bị đổi thành `?` có mặc định — mất mốc so mã / mất ngữ cảnh hộp thoại / hộp mời quẹt lại mà không lỗi nào báo;
//   · jsdom KHÔNG có bố cục, nên vùng chạm 44px và chiều rộng cố định ở 375px chỉ canh được bằng văn bản mã.
// Mỗi ca khẳng định SỐ LẦN khớp của một BIỂU THỨC (không neo vào chỗ đặt dòng) trên mã ĐÃ BÓC CHÚ THÍCH (chú thích giải thích bản vá thường
// chứa đúng chuỗi đang cấm — đã dính ở `[NDC-07]`). Mã TRƯỚC bản vá ghi tại từng ca.
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
const dem = (ma: string, re: RegExp) => [...ma.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;

const BUOC = doc("app/(admin)/admin/orders/_components/buoc-sai-ma.tsx");
const HOP = doc("app/(admin)/admin/orders/_components/hop-phieu-pos.tsx");
const KHU = doc("app/(admin)/admin/bien-dong-so-du/_components/khu-sai-ma-pos.tsx");
const NUT = doc("app/(admin)/admin/bien-dong-so-du/_components/nut-xu-ly-sai-ma.tsx");

describe("[HN3-UW1] prop BẮT BUỘC (luật 11): thiếu một prop là lỗi biên dịch, không phải hộp im lặng làm sai", () => {
  it("`maDung` (bước chọn) · `choLamMoi` (nội dung phiếu) · `tomTat` (nút xử lý): khai không `?`, không mặc định, truyền đủ ở chỗ gọi duy nhất", () => {
    // Mã TRƯỚC bản vá: không có ba prop này — bước chọn không in mã đúng, hộp mời quẹt lại trong lúc chờ trang mới, hộp thoại từ chối không nói dòng nào.
    expect(dem(BUOC, /\bmaDung: string;/)).toBe(1);
    expect(dem(BUOC, /\bmaDung\?:/)).toBe(0);
    expect(dem(BUOC, /\bmaDung\s*=\s*["'`]/), "không mặc định").toBe(0);
    expect(dem(HOP, /\bmaDung=\{phieu\.code5\}/), "truyền mã CỦA PHIẾU đang xem, không chuỗi nào khác").toBe(1);

    expect(dem(HOP, /\bchoLamMoi: boolean;/)).toBe(1);
    expect(dem(HOP, /\bchoLamMoi\?:/)).toBe(0);
    expect(dem(HOP, /\bchoLamMoi=\{guiDangCho !== null\}/)).toBe(1);

    expect(dem(NUT, /\btomTat: string;/)).toBe(1);
    expect(dem(NUT, /\btomTat\?:/)).toBe(0);
    expect(dem(KHU, /\btomTat=\{`\$\{d\.maDon\} · \$\{fmt\(d\.soTien\)\}đ/), "tóm tắt dựng từ CHÍNH dòng đang vẽ").toBe(1);
    expect(dem(KHU, /<NutXuLySaiMa\b/), "đúng một chỗ vẽ nút xử lý").toBe(1);
  });
});

describe("[HN3-UW2] lớp hiển thị TỰ BẢO VỆ: lọc số tiền ở bước chọn, làm sạch ghi chú ở cả hai màn", () => {
  it("bước chọn: danh sách VÀ trạng thái trống đều dựng từ mảng ĐÃ LỌC theo tiền; trống thì rơi về câu nguyên văn của đặc tả", () => {
    // Mã TRƯỚC bản vá: `ok.ungVien.length === 0` / `ok.ungVien.map(` — một thẻ lệch tiền do máy chủ lẫn vào thành nút "Đúng giao dịch này".
    expect(dem(BUOC, /ok\.ungVien\.filter\(\(u\) => u\.soTien === ok\.soTien\)/)).toBe(1);
    expect(dem(BUOC, /\bok\.ungVien\.map\(/), "không map thẳng danh sách chưa lọc").toBe(0);
    expect(dem(BUOC, /\bok\.ungVien\.length\b/), "không đo độ dài danh sách chưa lọc").toBe(0);
    expect(dem(BUOC, /ok\.cau \?\? CAU_KHONG_UNG_VIEN/), "trống sau lọc ⇒ câu đặc tả, không bước trắng").toBe(1);
    expect(dem(BUOC, /ok\.cau \?\? ""/)).toBe(0);
  });

  it("ghi chú: MỘT chỗ đọc `u.ghiChu` / `d.ghiChu` và nó nằm TRONG `lamSachGhiChuHienThi(` — chữ và `title` dùng chuỗi đã làm sạch", () => {
    // Mã TRƯỚC bản vá: `title={u.ghiChu || undefined}` + `{`“${u.ghiChu}”`}` — ký tự điều hướng hai chiều và chuỗi dài vô hạn đi thẳng vào màn.
    expect(dem(BUOC, /\bu\.ghiChu\b/), "mọi lần đọc ghi chú trong bước chọn").toBe(1);
    expect(dem(BUOC, /lamSachGhiChuHienThi\(u\.ghiChu\)/)).toBe(1);
    expect(dem(KHU, /\bd\.ghiChu\b/), "mọi lần đọc ghi chú trong bảng kế toán").toBe(1);
    expect(dem(KHU, /lamSachGhiChuHienThi\(d\.ghiChu\)/)).toBe(1);
    for (const [ten, ma] of [
      ["buoc-sai-ma", BUOC],
      ["khu-sai-ma-pos", KHU],
      ["nut-xu-ly-sai-ma", NUT],
    ] as const) {
      expect(dem(ma, /dangerouslySetInnerHTML/), `${ten}: chữ người gõ không bao giờ thành HTML`).toBe(0);
    }
  });

  it("hộp phiếu: sau khi GỬI thành công xoá câu Kiểm tra cũ VÀ đặt câu tạm của máy chủ; lỗi mạng đi qua try/catch, không để lọt lên error boundary", () => {
    // Mã TRƯỚC bản vá: `vuaKiem` sống qua `router.refresh()` (hộp không đóng) ⇒ hộp tiếp tục in "Chưa thấy giao dịch…" sau khi đã gửi.
    expect(dem(HOP, /\bdatVuaKiem\(null\);/)).toBe(1);
    expect(dem(HOP, /\bdatDaGui\(\{/)).toBe(1);
    expect(dem(HOP, /guiDangCho !== null\s*\? \{ thongDiep: guiDangCho\.thongDiep/), "câu tạm đứng ĐẦU chuỗi ưu tiên").toBe(1);
    // Cả hai điểm gọi `timUngVienSaiMaAction` và điểm gọi `guiSaiMaAction` đều nằm trong `try {` (rớt kết nối ⇒ câu tiếng Việt).
    expect(dem(HOP, /try \{\s*(?:datTimKq\()?\s*(?:res = )?await (?:timUngVienSaiMaAction|guiSaiMaAction)\(/), "ba lời gọi action sai mã").toBe(3);
    expect(dem(NUT, /try \{\s*res = await (?:duyetSaiMaAction|tuChoiSaiMaAction)\(/), "hai lời gọi action kế toán").toBe(2);
  });
});

describe("[HN3-UW3] 375px: vùng chạm ≥ 44px và không chiều rộng cố định — jsdom không có bố cục nên canh bằng văn bản mã", () => {
  it("bước chọn của sale: nút chọn · 'Báo admin' · 'Quay lại phiếu' đủ 44px ở màn hẹp; không `w-[Npx]`; ghi chú bị kẹp 2 dòng", () => {
    // Mã TRƯỚC bản vá của 'Quay lại phiếu': `h-9` (36px) ở mọi màn.
    expect(dem(BUOC, /className="mt-3 min-h-11 w-full gap-2"/), "nút chọn từng ứng viên").toBe(1);
    expect(dem(BUOC, /min-h-11 w-full gap-2 sm:min-h-9 sm:w-auto/), "Báo admin").toBe(1);
    expect(dem(BUOC, /\bh-11 w-fit\b[^"]*\bsm:h-9\b/), "Quay lại phiếu").toBe(1);
    expect(dem(BUOC, /\bw-\[\d+(?:px|rem)\]/), "chiều rộng cố định").toBe(0);
    expect(dem(BUOC, /line-clamp-2 break-words/), "ghi chú bị kẹp").toBe(1);
  });

  it("hộp thoại từ chối của kế toán: hai nút đủ 44px ở màn hẹp, thu về 36px ở màn rộng; không chiều rộng cố định trong hộp", () => {
    expect(dem(NUT, /\bmin-h-11\b[^"]*\bsm:min-h-9\b/), "Đóng + Xác nhận từ chối").toBe(2);
    expect(dem(NUT, /\bw-\[\d+(?:px|rem)\]/)).toBe(0);
  });
});
