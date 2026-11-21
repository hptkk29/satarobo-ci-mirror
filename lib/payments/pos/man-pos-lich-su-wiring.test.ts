// [POS-LS-*] — LƯỚI GHIM MÃ NGUỒN cho lịch sử import + UI tồn của màn `/bien-dong-so-du`
// (nợ 4 + audit /impeccable, 30/09/2026). THUẦN.
//
// Bóc chú thích TRƯỚC khi đếm (chú thích giải thích bản vá chứa đúng chuỗi đang tìm), đếm SỐ LẦN
// khớp. Mỗi ca ghi mã TRƯỚC bản vá.
import { describe, expect, it } from "vitest";
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

const TRANG = doc("app/(admin)/admin/bien-dong-so-du/page.tsx");
const KHU = doc("app/(admin)/admin/bien-dong-so-du/_components/khu-the-pos.tsx");
const NHAP = doc("app/(admin)/admin/bien-dong-so-du/_components/nhap-file-pos.tsx");
const BANG = doc("app/(admin)/admin/bien-dong-so-du/_components/bank-txn-client.tsx");

describe("[POS-LS] lịch sử import + UI tồn", () => {
  it("[POS-LS-01] trang SUY trạng thái lượt khi đọc, truyền đồng hồ đọc một lần (không cron ghi)", () => {
    // Mã TRƯỚC bản vá: bảng lịch sử không có trạng thái — lượt dừng giữa chừng trông như lượt xong.
    expect(dem(TRANG, /trangThai: trangThaiHienThiLo\(/)).toBe(1);
    expect(dem(TRANG, /\bdocLuc,?\s*\)/), "đồng hồ đọc truyền vào hàm thuần").toBe(1);
    expect(dem(TRANG, /capNhatLuc: l\.updatedAt/)).toBe(1);
    expect(dem(KHU, /\{l\.trangThai\.nhan\}/), "cột Trạng thái in nhãn").toBe(1);
    expect(dem(KHU, /\{l\.trangThai\.chiTiet\}/), "kèm x/y lô").toBe(1);
  });

  it("[POS-LS-02] số 'Tự khớp' chỉ tô xanh khi > 0 — cả bảng lịch sử lẫn panel kết quả", () => {
    // Mã TRƯỚC bản vá: `text-state-success-ink` cứng trên ô Tự khớp; `tone="success"` cứng ở panel.
    expect(dem(KHU, /l\.soTuKhop > 0 \? "font-semibold text-state-success-ink"/)).toBe(1);
    expect(dem(NHAP, /tone=\{ketQua\.tuKhop > 0 \? "success" : undefined\}/)).toBe(1);
    expect(dem(NHAP, /nhan="Tự khớp"[^/]*tone="success"/)).toBe(0);
  });

  it("[POS-LS-03] cột 'Xử lý' của bảng giao dịch DÍNH MÉP PHẢI, nền đục ở cả th lẫn td", () => {
    // Mã TRƯỚC bản vá: `<th className="w-44 px-3 py-2">Xử lý</th>` — ở 1280px bị đẩy ra sau thanh cuộn.
    expect(BANG).toMatch(/const O_DINH = "sticky right-0 z-10[^"]*";/);
    expect(dem(BANG, /\$\{O_DINH\}/), "th + td").toBe(2);
    expect(BANG).toMatch(/<th className=\{`\$\{O_DINH\}[^`]*\bbg-muted\b/);
    expect(dem(BANG, /i\.status === "UNMATCHED" \? NEN_O_DINH_CAN_XU_LY : NEN_O_DINH/)).toBe(1);
  });

  it("[POS-LS-04] thử lại cùng file TÁI DÙNG lượt dở; chỉ mở lượt mới khi chưa có batchId", () => {
    // Mã TRƯỚC bản vá: mỗi lần bấm Nhập gọi `batDauNhapPosAction` trước vòng lô ⇒ mỗi lần thử lại
    // thêm một lượt (và lượt 0 dòng khi lô 1 hỏng).
    expect(dem(NHAP, /luotDo !== null && luotDo\.khoa === khoaFile \? luotDo : null/), "nhận ra lượt dở").toBe(2);
    expect(dem(NHAP, /let batchId: string \| null = tiep\?\.batchId \?\? null;/)).toBe(1);
    expect(dem(NHAP, /batDauNhapPosAction\(\{/)).toBe(1);
    const iNhanh = NHAP.search(/if \(batchId === null\) \{\s*const bd = await batDauNhapPosAction/);
    expect(iNhanh, "batDau chỉ nằm trong nhánh chưa có lượt").toBeGreaterThan(-1);
    expect(dem(NHAP, /nhapLoPosAction\(\{ batchId, lo: i \+ 1,/), "lô gửi kèm chỉ số").toBe(1);
  });
});
