// Ca [HN1-W1..W5] — LƯỚI GHIM MÃ NGUỒN cho "hai nút QR / Thẻ POS chung một mã" (09/10/2026). THUẦN.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §1. Hành vi đã có ca riêng (kenh-thu.test.ts · RTL · DB) — lưới này canh
// phần mà test hành vi KHÔNG chạm tới: DÂY NỐI. Một sự thật đi qua nhiều tầng (máy chủ tính → trang → bảng →
// panel) và quên một mắt xích thì KHÔNG lỗi biên dịch nếu prop tuỳ chọn, KHÔNG ca hành vi nào đỏ (luật 11).
//
// ⚠️ Mỗi ca neo vào BIỂU THỨC chứ không neo vào cách viết: số lần khớp, thứ tự hai lời gọi trong cùng một hàm,
// một hình dạng cấm. Bóc chú thích TRƯỚC khi đếm — chú thích giải thích bản vá luôn chứa đúng chuỗi đang tìm.
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

/** Đoạn mã từ lần xuất hiện đầu của `dau` tới `cuoi` (không gồm `cuoi`). Ném nếu một đầu mút mất — lưới không được xanh vì tìm không ra. */
function doan(ma: string, dau: string, cuoi: string): string {
  const i = ma.indexOf(dau);
  const j = ma.indexOf(cuoi, i + dau.length);
  if (i < 0 || j < 0) throw new Error(`lưới mất mốc: "${i < 0 ? dau : cuoi}"`);
  return ma.slice(i, j);
}

const TRANG = doc("app/(admin)/admin/orders/[id]/page.tsx");
const BANG = doc("app/(admin)/admin/orders/_components/payment-requests-section.tsx");
const HOP = doc("app/(admin)/admin/orders/_components/hop-phieu-pos.tsx");
const CONG_NO = doc("app/(admin)/admin/orders/_components/cong-no-theo-con.tsx");
const KENH = doc("lib/payments/kenh-thu.ts");
const PHIEU_GOP = doc("lib/finance/phieu-gop.ts");

describe("[HN1-W] dây nối hai nút QR / Thẻ POS", () => {
  it("[HN1-W1] bảng phiếu thu: panel QR KHÔNG còn vẽ vô điều kiện; hai ô của dòng do MỘT hàm thuần quyết", () => {
    // Mã TRƯỚC bản vá: `{phieuGop && <PhieuGopQr …/>}` — vẽ MỖI KHI có phiếu gộp, nên bấm "Thẻ POS" (cũng đẻ ra
    // phiếu gộp) là bung luôn ảnh QR + "Nội dung CK".
    expect(dem(BANG, /\{\s*phieuGop\s*&&\s*\(?\s*<PhieuGopQr\b/), "khối QR vô điều kiện đã gỡ").toBe(0);
    expect(dem(BANG, /<PhieuGopQr\b/), "đúng một chỗ vẽ panel QR").toBe(1);
    expect(dem(BANG, /\bdocDieuKhienQr\(/), "panel QR theo state 'đang xem kênh nào'").toBe(1);
    // Component không tự viết điều kiện của hai ô.
    expect(dem(BANG, /\bkenhCuaDong\(/)).toBe(1);
    expect(dem(BANG, /\bnutThuThe\(/), "`nutThuThe` nay do `kenhCuaDong` gọi (một chỗ)").toBe(0);
    expect(dem(KENH, /\bnutThuThe\(/), "…và `kenhCuaDong` gọi nó đúng một lần").toBe(1);
    expect(dem(BANG, /\bnutHuyPhieuGop\(/)).toBe(1);
  });

  it("[HN1-W1b] nút thứ hai KHÔNG có đường phát phiếu gộp mới: đúng một lời gọi phát, ở đúng một chỗ", () => {
    // Nút nào bấm trước thì phát (một lần); nút sau DÙNG LẠI mã. Một lời gọi `phatPhieuChoDot(r)` thứ hai ở
    // một nút khác là cách quay lại lỗi "mỗi nút một mã" — DB vẫn chặn (chỉ mục từng phần), nhưng người dùng ăn lỗi.
    expect(dem(BANG, /\btaoPhieuGopAction\(/)).toBe(1);
    expect(dem(BANG, /\bphatPhieuChoDot\(r\)/), "lời gọi phát nằm ở nút 'Xuất QR' và chỉ ở đó").toBe(1);
  });

  it("[HN1-W2] trang đơn tính `theDangMo` TRONG lô có sẵn (không `await` riêng), theo cờ — KHÔNG theo quyền `pos-check`", () => {
    // `[DST-01]` đếm `await`; ca này nói RÕ thủ phạm. Và `phieuPos` chỉ nạp khi có `payments:pos-check` (page.tsx) —
    // người chỉ có `payments:record` vẫn thấy nút QR + Huỷ, nên sự thật "có thẻ đang mở" PHẢI đi đường khác.
    expect(dem(TRANG, /\bdocTheDangMoCuaDon\(/)).toBe(1);
    expect(dem(TRANG, /await\s+docTheDangMoCuaDon\(/)).toBe(0);
    expect(dem(TRANG, /batThuTheoCon\s*\?\s*docTheDangMoCuaDon\(/), "gác theo cờ thu theo con").toBe(1);
    expect(TRANG, "KHÔNG gác theo quyền thẻ").not.toMatch(/duocThuThePos\s*\?\s*docTheDangMoCuaDon/);
    expect(doan(TRANG, "phieuGop = {", "};"), "kết quả đi vào phiếu gộp đưa xuống bảng").toMatch(/\btheDangMo\b/);
  });

  it("[HN1-W3] `PhieuGopView.theDangMo` khai BẮT BUỘC (luật 7): thiếu là `tsc` liệt kê chỗ dựng", () => {
    expect(dem(CONG_NO, /\btheDangMo:\s*TheDangMo\s*\|\s*null;/)).toBe(1);
    expect(dem(CONG_NO, /\btheDangMo\?:/)).toBe(0);
  });

  it("[HN1-W4] cổng huỷ: nằm trong `huyPhieuGop`, TRƯỚC `doiTrangThaiPhieuTrongTx`; KHÔNG nằm trong `TrongTx`, KHÔNG trong `dongPhieuGop`", () => {
    const huy = doan(PHIEU_GOP, "export async function huyPhieuGop(", "export async function dongPhieuGop(");
    const iCong = huy.search(/\bdocTheDangMoCuaPhieuGop\(tx\b/);
    const iGhi = huy.search(/\bdoiTrangThaiPhieuTrongTx\(tx\b/);
    expect(iCong, "huyPhieuGop phải hỏi thẻ đang mở dưới giao dịch").toBeGreaterThanOrEqual(0);
    expect(iGhi, "…rồi mới gọi phép đổi trạng thái").toBeGreaterThan(iCong);
    expect(dem(huy, /\bkhoaDonTrongTx\(tx\b/), "dưới khoá đơn — khoá tạo phiếu thẻ cũng lấy").toBe(1);
    expect(huy.search(/\bkhoaDonTrongTx\(tx\b/), "khoá đứng TRƯỚC cổng").toBeLessThan(iCong);

    // V1: dừng học gọi `TrongTx` SAU phép ghi đầu tiên và bỏ qua `{ ok: false }` — cổng ở đó để lại đợt VOID + phiếu OPEN.
    const trongTx = doan(PHIEU_GOP, "export async function doiTrangThaiPhieuTrongTx(", "export async function phieuGopCuaConTrongTx(");
    expect(trongTx, "cổng thẻ KHÔNG ở trong hàm dùng chung với dừng học").not.toMatch(/docTheDangMoCuaPhieuGop|posPaymentIntent/);
    // V7: đóng phiếu (kế toán, đã nhận tiền) không bị chặn.
    const dong = doan(PHIEU_GOP, "export async function dongPhieuGop(", "export type LyDoChuaChia");
    expect(dong).not.toMatch(/docTheDangMoCuaPhieuGop/);
  });

  it("[HN1-W5] hộp thẻ: câu 'cùng mã' và cảnh báo hai kênh có mặt; prop cảnh báo khai bắt buộc", () => {
    expect(dem(HOP, /Cùng mã với QR chuyển khoản/)).toBe(1);
    // Đếm chỗ DÙNG (biểu thức JSX), không đếm dòng import — tên hằng có mặt ở dòng import ngay cả khi lời dùng đã gỡ.
    expect(dem(HOP, /\{CAU_CANH_BAO_HAI_KENH\}/), "cảnh báo dùng ĐÚNG hằng chung với panel QR").toBe(1);
    // Hai nơi khai: `HopPhieuPos` (nhận từ bảng) và `NoiDungPhieu` (nơi thật sự in) — cả hai bắt buộc.
    expect(dem(HOP, /\bcanhBaoHaiKenh:\s*boolean;/)).toBe(2);
    expect(dem(HOP, /\bcanhBaoHaiKenh\?:/)).toBe(0);
    // Panel QR dùng cùng hằng.
    expect(dem(BANG, /\{CAU_CANH_BAO_HAI_KENH\}/)).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RÀ ĐỐI KHÁNG VIỆC 1 (09/10/2026) — dây nối của các bản vá
// ─────────────────────────────────────────────────────────────────────────────

const ACTIONS = doc("app/(admin)/admin/orders/_actions.ts");
const PHIEU_POS = doc("lib/payments/pos/phieu-pos.ts");
const THE_DANG_MO = doc("lib/payments/pos/the-dang-mo.ts");

describe("[HN2-W] dây nối bản vá rà đối kháng", () => {
  it("[HN2-W1] 'phát phiếu 1 đợt hoặc dùng lại' có ĐÚNG MỘT hàm, hai nơi gọi; không ai gọi `taoPhieuGop(` trần", () => {
    // Nút nào bấm sau phải DÙNG LẠI mã (đặc tả 3). Hai nơi gọi `taoPhieuGop` trần là hai nơi tự xử lý va chạm — và nơi
    // quên xử lý sẽ trả 'huỷ hoặc đóng phiếu đó trước' cho đúng mã mình vừa muốn dùng.
    expect(dem(ACTIONS, /\bphatHoacDungLaiPhieuGop\(/), "action 'Xuất QR'").toBe(1);
    expect(dem(PHIEU_POS, /\bphatHoacDungLaiPhieuGop\(/), "action 'Thẻ POS'").toBe(1);
    expect(dem(ACTIONS, /\btaoPhieuGop\(/)).toBe(0);
    expect(dem(PHIEU_POS, /\btaoPhieuGop\(/)).toBe(0);
    // Hàm dùng lại KHÔNG đổi nghĩa `taoPhieuGop` (tests/finance/phieu-gop.test.ts vẫn ghim việc nó từ chối).
    expect(dem(PHIEU_GOP, /export async function phatHoacDungLaiPhieuGop\(/)).toBe(1);
    const ham = doan(PHIEU_GOP, "export async function phatHoacDungLaiPhieuGop(", "export async function docPhieuGopDangMo(");
    expect(dem(ham, /\btaoPhieuGop\(/), "gọi taoPhieuGop đúng một lần").toBe(1);
    expect(dem(ham, /["']daCoPhieuMo["']\s+in\s+g\b/), "chỉ tra lại khi chính chỉ mục một-đơn-một-phiếu từ chối").toBe(1);
  });

  it("[HN2-W2] bảng đưa SỰ THẬT MÁY CHỦ và trạng thái bận vào `kenhCuaDong`; câu 'đợt khác giữ mã' đọc từ kết quả, không tự dựng", () => {
    const goi = doan(BANG, "kenhCuaDong({", "});");
    expect(goi).toMatch(/\btheDangMo:\s*phieuGop\?\.theDangMo\s*\?\?\s*null\b/);
    expect(goi, "trạng thái bận đi vào từ state của bảng, không phải hằng").toMatch(/\bdangBan:\s*(?!false\b|true\b)\w+/);
    // Câu và nhãn do hàm thuần dựng (`qr.cau` / `qr.chu`) — bảng không tự gọi `loiDotKhacDangGiu`.
    expect(dem(BANG, /\bloiDotKhacDangGiu\(/)).toBe(0);
    expect(dem(KENH, /\bloiDotKhacDangGiu\(/), "…và hàm thuần dựng nó ở ĐÚNG MỘT chỗ").toBe(1);
  });

  it("[HN2-W3] nhánh THẤT BẠI của 'Huỷ phiếu' tự chữa: bỏ bước xác nhận + làm mới trang", () => {
    const that = doan(BANG, "if (!r.ok) {", 'toast.success(kieu === "HUY"');
    expect(that).toMatch(/\btoast\.error\(r\.error\)/);
    expect(that, "bỏ bước 'Xác nhận huỷ' (nút chắc chắn ăn lại câu từ chối)").toMatch(/\bdatChoHuy\(false\)/);
    expect(that, "máy chủ nạp lại ⇒ `theDangMo` mới ⇒ nút Huỷ chuyển sang câu giải thích").toMatch(/\brouter\.refresh\(\)/);
  });

  it("[HN2-W4] `PhieuTheDeXetMo.lastResultKind` khai BẮT BUỘC (luật 7) và `the-dang-mo.ts` đọc nó từ DB", () => {
    const luat = doc("lib/payments/pos/phieu-pos-luat.ts");
    expect(dem(luat, /\blastResultKind:\s*PosCheckResult\["kind"\]\s*\|\s*null;\s*\r?\n\s*bankTransaction:/)).toBe(1);
    expect(dem(THE_DANG_MO, /\blastResultKind:\s*true\b/), "select phiếu thẻ").toBe(1);
  });
});
