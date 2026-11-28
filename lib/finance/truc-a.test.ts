// lib/finance/truc-a.test.ts — Bước 6, CỔNG trục A (chạy trong CI, không cần DB).
//
// Đối xứng với `ghi-nhan.test.ts` của trục B. Trục A ("kế toán đã XÁC NHẬN bao nhiêu")
// nuôi công nợ · cổng phụ huynh · trang Học phí · báo cáo doanh thu. Trước Bước 4 nó có
// 15 nơi tự gõ lại điều kiện, trong đó **3 nơi quên `deletedAt: null`** — tức một khoản
// đã xoá sổ vẫn được cộng như tiền thật.
//
// Cổng này bắt mọi nơi ĐỌC phải đi qua `KHOAN_DA_XAC_NHAN` / `laKhoanDaXacNhan`, nên
// `deletedAt: null` không còn là thứ người viết phải nhớ.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { KHOAN_DA_XAC_NHAN, laKhoanDaXacNhan, tongDaXacNhan } from "./debt";

const GOC = process.cwd();
const THU_MUC_QUET = ["app", "lib", "components", "scripts"];

/**
 * Nơi được phép còn chuỗi `accountantStatus: "CONFIRMED"` — kèm LÝ DO.
 *
 * Luật thêm dòng mới: chỉ khi đó là chỗ **GHI** (đổi trạng thái phiếu thu / ghi
 * `AuditLog.newValues`). Chỗ **ĐỌC** thì dùng hằng, không xin ngoại lệ.
 */
const NGOAI_LE: Record<string, string> = {
  "lib/finance/debt.ts": "chính là nhà của trục A",
  "lib/finance/truc-a.test.ts": "TEST: chính cổng này — khẳng định hình dạng hằng",
  "lib/finance/payment.ts":
    "GHI: confirmPayment đổi trạng thái + adjustPayment tạo bút toán + AuditLog.newValues",
  "lib/finance/ghi-tien-don.ts":
    "GHI: chuyenTienGiuaConTrongTx (PHIÊN D, 21/09/2026) đẻ CẶP bút toán −/+ chuyển tiền giữa hai con cùng đơn. Cả hai dòng PHẢI mang CONFIRMED: chỉ phần đã xác nhận mới được chuyển, và nếu hai dòng khác trục thì tổng của trục kia không về 0 ⇒ công nợ một trong hai bé lệch vĩnh viễn. Đây là phép GHI, không phải một định nghĩa ĐỌC thứ hai. ⚠️ Hệ quả của ngoại lệ này: một điều kiện ĐỌC gõ tay trong chính tệp đó sẽ lọt lưới — tệp này là đường GHI tiền của cả module, nên mọi phép ĐỌC trong nó phải đi qua `docSoTheoCon`.",
  // Ba tệp dưới đây là TEST của nhánh `test`, khai nhận khi hợp nhất 16/09/2026. Chúng
  // DỰNG DỮ LIỆU MẪU mang trạng thái đó rồi mới gọi hàm thuần — không phải một đường
  // đọc thứ hai, nên không thuộc thứ cổng này sinh ra để chặn.
  "lib/crm/commission-run.test.ts": "TEST: dựng bút toán mẫu cho kỳ hoa hồng",
  "lib/reports/revenue-by-child.test.ts": "TEST: dựng bút toán mẫu cho bổ dọc theo con",
  "lib/reports/revenue-daily.test.ts": "TEST: dựng bút toán mẫu cho doanh thu theo ngày",
  "scripts/do-so-cu-moi-no4.ts":
    "SCRIPT ĐO chỉ-đọc: CỐ Ý gõ tay bộ lọc CŨ (chỉ CONFIRMED) để in số TRƯỚC bản vá NỢ-4 cạnh số SAU. Bộ lọc cũ không còn tồn tại dưới dạng hằng nên không import được — và đây không phải một đường đọc thứ hai.",
  "lib/finance/debt.test.ts":
    "TEST: dựng bút toán mẫu (thu / hoàn / điều chỉnh) cho computeEnrollmentDebt — NỢ-4",
};

function duyet(thuMuc: string, ra: string[]): void {
  for (const ten of readdirSync(thuMuc)) {
    if (ten === "node_modules" || ten === ".next") continue;
    const duongDan = join(thuMuc, ten);
    if (statSync(duongDan).isDirectory()) duyet(duongDan, ra);
    else if (/\.tsx?$/.test(ten)) ra.push(duongDan);
  }
}

function quetTatCaFile(): string[] {
  const ra: string[] = [];
  for (const t of THU_MUC_QUET) duyet(join(GOC, t), ra);
  return ra;
}

/**
 * Trần thời gian cho hai ca QUÉT MÃ NGUỒN — phép tính ghi ngay đây theo nếp của
 * `vitest.cham-cong.config.ts`.
 *
 * Đo 15/09/2026 trên máy dev (Windows): chạy MỘT MÌNH mất 1,28s cho ~2.000 tệp; chạy
 * trong cả bộ `pnpm test:unit` (506 tệp test song song, đĩa bị giành) mất **8,31s** và
 * vượt trần mặc định 5s ⇒ cả bộ ĐỎ với thông báo "Test timed out", không phải với một
 * vi phạm nào. Đây đúng là thứ luật 19 cảnh báo: ca đỏ vì ĐỒNG HỒ chứ không vì mã.
 *
 * Trần 30s = ~3,6× lần đo tệ nhất. KHÔNG phải "nâng cho hết đỏ": việc của ca này là
 * đọc thật ~2.000 tệp, nên 5s vốn chưa bao giờ là ngân sách đúng cho nó. Nếu ca này
 * chạm 30s thì đó là tín hiệu thật (repo phình hoặc đĩa hỏng), không phải nhiễu.
 */
const TRAN_QUET_MS = 30_000;

describe("[BUOC-6] trục A chỉ có MỘT nhà", () => {
  const files = quetTatCaFile();

  it("quét được đủ file (chống cổng rỗng)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("không nơi nào ngoài debt.ts tự gõ lại điều kiện `accountantStatus: CONFIRMED`", { timeout: TRAN_QUET_MS }, () => {
    const viPham: string[] = [];
    for (const f of files) {
      const key = relative(GOC, f).split(sep).join("/");
      if (NGOAI_LE[key]) continue;
      if (/accountantStatus:\s*"CONFIRMED"/.test(readFileSync(f, "utf8"))) viPham.push(key);
    }
    expect(
      viPham,
      `Dùng KHOAN_DA_XAC_NHAN / laKhoanDaXacNhan từ @/lib/finance/debt thay vì gõ tay:\n${viPham.join("\n")}`,
    ).toEqual([]);
  });

  it("mọi ngoại lệ khai trong NGOAI_LE đều còn tồn tại và còn chứa chuỗi đó", { timeout: TRAN_QUET_MS }, () => {
    for (const [key, lyDo] of Object.entries(NGOAI_LE)) {
      const co = /accountantStatus:\s*"CONFIRMED"/.test(readFileSync(join(GOC, key), "utf8"));
      expect(co, `${key} (${lyDo}) không còn chuỗi — xoá khỏi NGOAI_LE`).toBe(true);
    }
  });
});

describe("[BUOC-6] hằng của trục A luôn mang `deletedAt: null`", () => {
  it("KHOAN_DA_XAC_NHAN loại khoản đã xoá mềm", () => {
    expect(KHOAN_DA_XAC_NHAN).toEqual({ accountantStatus: "CONFIRMED", deletedAt: null });
  });

  it("laKhoanDaXacNhan trả false cho khoản đã xoá mềm", () => {
    expect(laKhoanDaXacNhan({ accountantStatus: "CONFIRMED", deletedAt: null })).toBe(true);
    expect(laKhoanDaXacNhan({ accountantStatus: "CONFIRMED" })).toBe(true);
    expect(
      laKhoanDaXacNhan({ accountantStatus: "CONFIRMED", deletedAt: new Date("2026-09-01") }),
    ).toBe(false);
    expect(laKhoanDaXacNhan({ accountantStatus: "PENDING", deletedAt: null })).toBe(false);
    expect(laKhoanDaXacNhan({ accountantStatus: "REJECTED", deletedAt: null })).toBe(false);
    expect(laKhoanDaXacNhan({ accountantStatus: "REFUNDED", deletedAt: null })).toBe(false);
  });

  it("KHÔNG lọc theo paymentType — bút toán ADJUSTMENT phải được cộng", () => {
    // Lọc `paymentType = 'PAYMENT'` ở đây là ném điều chỉnh đi lần nữa — đúng cái lỗi
    // cả đợt này đang sửa.
    expect("paymentType" in KHOAN_DA_XAC_NHAN).toBe(false);
  });

  it("tongDaXacNhan cộng được dòng ÂM (delta của điều chỉnh giảm)", () => {
    expect(tongDaXacNhan([{ amount: 4_000_000 }, { amount: -1_000_000 }])).toBe(3_000_000);
  });

  it("KHÔNG lọc theo saleStatus — đó là câu hỏi của trục B", () => {
    expect("saleStatus" in KHOAN_DA_XAC_NHAN).toBe(false);
  });
});
