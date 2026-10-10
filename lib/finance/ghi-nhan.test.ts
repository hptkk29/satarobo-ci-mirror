// lib/finance/ghi-nhan.test.ts — CỔNG chống mọc lại bản chép tay của trục B.
//
// Bước 4b. Trục B ("hệ thống đã ghi nhận bao nhiêu") từng có 9 nơi tự gõ lại điều kiện
// `saleStatus: "RECORDED", deletedAt: null`. Chín bản chép tay nghĩa là chín cơ hội để một
// người sửa lệch một chỗ mà không ai biết — mà đây là con số in trên mã QR và con số máy
// dùng để đối khớp tiền về.
//
// Cổng này KHÔNG cấm chuỗi `saleStatus: "RECORDED"` — nó là giá trị hợp lệ khi GHI một
// phiếu thu mới. Cổng chỉ cấm dùng chuỗi đó làm ĐIỀU KIỆN LỌC ngoài `ghi-nhan.ts`.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  KHOAN_DA_GHI_NHAN,
  SALE_STATUS_DA_GHI_NHAN,
  laKhoanDaGhiNhan,
  sumRecorded,
} from "./ghi-nhan";

const GOC = process.cwd();
const THU_MUC_QUET = ["app", "lib"];

/**
 * Nơi được phép còn chuỗi `saleStatus: "RECORDED"` — kèm LÝ DO.
 *
 * Luật thêm dòng mới: chỉ khi đó là chỗ **GHI** (tạo phiếu thu / ghi AuditLog.newValues).
 * Nếu là chỗ **ĐỌC** thì không xin ngoại lệ — dùng `KHOAN_DA_GHI_NHAN`.
 */
const NGOAI_LE: Record<string, string> = {
  // ⚠️ `lib/finance/ghi-nhan.ts` ĐÃ RA KHỎI danh sách này [14/09/2026]: từ khi trục B
  // nhận cả `COLLECT_CONFIRMED`, chính nhà của nó cũng không còn gõ chuỗi
  // `saleStatus: "RECORDED"` nữa (mảng `SALE_STATUS_DA_GHI_NHAN` chỉ chứa giá trị trần).
  // Cổng "ngoại lệ chết" ở dưới đã báo đúng chỗ này — giữ lại dòng cũ là dựng một
  // ngoại lệ không còn che gì, đúng thứ cổng đó sinh ra để dọn.
  "lib/finance/ghi-nhan.test.ts": "TEST: chính cổng này — khẳng định hình dạng hằng",
  "lib/finance/payment.ts": "GHI: tạo phiếu thu + AuditLog.newValues (đường đọc đã dùng hằng)",
  "lib/crm/backfill-order.ts": "GHI: tạo phiếu thu backfill khi chuyển dữ liệu",
  "lib/finance/ghi-giao-dich-cu.ts":
    "GHI: tạo phiếu thu khi nhập giao dịch cũ từ sheet đăng ký",
  "lib/payments/payos-ingest.ts": "GHI: tạo phiếu thu từ cổng thanh toán",
  "lib/finance/ghi-tien-don.ts":
    "GHI: tạo phiếu thu khi gắn tay giao dịch theo con + chép trục của dòng gốc khi đảo bút toán",
  "lib/finance/phieu-gop.ts":
    "GHI: tạo phiếu thu cho TỪNG CON khi phiếu gộp được thu đủ qua webhook [PHIÊN C, 20/09/2026]",
  "lib/payments/summary.test.ts": "TEST: khẳng định đúng hình dạng `where` mà hằng sinh ra",
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
 * Trần thời gian cho hai ca QUÉT MÃ NGUỒN — phép tính ghi ngay đây, theo nếp
 * `vitest.cham-cong.config.ts` và ĐỐI XỨNG với `lib/finance/truc-a.test.ts` (trục A).
 *
 * Đo 15/09/2026 trên máy dev (Windows): chạy MỘT MÌNH mất 1,16s cho ~2.000 tệp; chạy
 * trong cả bộ `pnpm test:unit` (507 tệp test song song, đĩa bị giành) mất **11,79s** và
 * vượt trần mặc định 5s ⇒ cả bộ ĐỎ với thông báo "Test timed out", không phải với một
 * vi phạm nào. Đây đúng là thứ luật 19 cảnh báo: ca đỏ vì ĐỒNG HỒ chứ không vì mã.
 *
 * ⚠️ BÀI HỌC KÈM THEO: trục A đã được vá sáng nay, tệp này thì KHÔNG — vì hôm đó nó
 * tình cờ chạy kịp. Hai ca cùng một khuôn, cùng một điểm yếu, nhưng chỉ ca nào xui
 * mới lộ ra. Gặp một ca đỏ vì đồng hồ thì tìm luôn ANH EM CÙNG KHUÔN của nó, đừng vá
 * đúng ca vừa đỏ rồi coi là xong.
 *
 * Trần 30s = ~2,5× lần đo tệ nhất. KHÔNG phải "nâng cho hết đỏ": việc của ca này là
 * đọc thật ~2.000 tệp, nên 5s vốn chưa bao giờ là ngân sách đúng cho nó. Nếu nó chạm
 * 30s thì đó là tín hiệu thật (repo phình hoặc đĩa hỏng), không phải nhiễu.
 */
const TRAN_QUET_MS = 30_000;

describe("[BUOC-4b] trục B chỉ có MỘT nhà", () => {
  const files = quetTatCaFile();

  it("quét được đủ file (chống cổng rỗng)", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it("không nơi nào ngoài ghi-nhan.ts tự gõ lại điều kiện `saleStatus: RECORDED`", { timeout: TRAN_QUET_MS }, () => {
    const viPham: string[] = [];
    for (const f of files) {
      const key = relative(GOC, f).split(sep).join("/");
      if (NGOAI_LE[key]) continue;
      const noiDung = readFileSync(f, "utf8");
      if (/saleStatus:\s*"RECORDED"/.test(noiDung)) viPham.push(key);
    }
    expect(viPham, `Dùng KHOAN_DA_GHI_NHAN từ @/lib/finance/ghi-nhan thay vì gõ tay:\n${viPham.join("\n")}`).toEqual([]);
  });

  it("mọi ngoại lệ khai trong NGOAI_LE đều còn tồn tại và còn chứa chuỗi đó", { timeout: TRAN_QUET_MS }, () => {
    // Ngoại lệ chết là ngoại lệ nguy hiểm: nó nới cổng cho một file đã dọn xong.
    for (const [key, lyDo] of Object.entries(NGOAI_LE)) {
      const noiDung = readFileSync(join(GOC, key), "utf8");
      expect(/saleStatus:\s*"RECORDED"/.test(noiDung), `${key} (${lyDo}) không còn chuỗi — xoá khỏi NGOAI_LE`).toBe(true);
    }
  });
});

describe("[BUOC-4b] hằng của trục B", () => {
  it("nhận CẢ HAI trạng thái sale — COLLECT_CONFIRMED là bước ĐI SAU RECORDED", () => {
    // Vá 14/09/2026: lọc BẰNG "RECORDED" làm khoản tiến lên `COLLECT_CONFIRMED` rơi
    // khỏi trục B. Xem lib/finance/ghi-nhan.ts cho phép đo đầy đủ.
    expect(KHOAN_DA_GHI_NHAN.saleStatus).toEqual({
      in: ["RECORDED", "COLLECT_CONFIRMED"],
    });
  });

  it("lọc accountantStatus bằng `not: REJECTED` — KHÔNG phải `= CONFIRMED` [HT-05]", () => {
    // ⚠️ CA NÀY TỪNG GHIM ĐÚNG LUẬT CŨ, và luật cũ SAI. Bản trước khẳng định
    // `"accountantStatus" in KHOAN_DA_GHI_NHAN === false` với lý lẽ "khoản chờ kế toán
    // vẫn là tiền đã về" — vế lý lẽ ấy ĐÚNG và giữ nguyên, nhưng nó bị hiện thực bằng
    // cách KHÔNG lọc gì cả, nên khoản kế toán đã TỪ CHỐI cũng lọt (`[HT-05]`, vá
    // 24/09/2026).
    //
    // Nay khoá đúng HAI vế, và phải khoá cả hai:
    //  · CÓ vế `accountantStatus`            → khoản REJECTED bị loại;
    //  · vế ấy là `not: "REJECTED"`, KHÔNG phải `"CONFIRMED"` → khoản CHỜ kế toán vẫn vào.
    // Thiếu vế sau thì một bản "siết cho chặt" sẽ làm mọi khoản chưa ai duyệt biến mất
    // khỏi công nợ — lỗ lớn hơn lỗ vừa vá, và ca này là thứ duy nhất chặn.
    expect(Object.keys(KHOAN_DA_GHI_NHAN).sort()).toEqual([
      "accountantStatus",
      "deletedAt",
      "saleStatus",
    ]);
    expect(KHOAN_DA_GHI_NHAN.deletedAt).toBeNull();
    expect(KHOAN_DA_GHI_NHAN.accountantStatus).toEqual({ not: "REJECTED" });
  });

  it("KHÔNG lọc theo paymentType — bút toán ADJUSTMENT mang delta nên phải được cộng", () => {
    expect("paymentType" in KHOAN_DA_GHI_NHAN).toBe(false);
  });

  it("KHÔNG ép khoá enrollmentId — payos-ingest không bao giờ set, ép là nuốt tiền", () => {
    expect("enrollmentId" in KHOAN_DA_GHI_NHAN).toBe(false);
    expect(sumRecorded.length).toBe(1); // khoá duy nhất: orderId
  });
});

describe("[GN-01] cả hai trạng thái đều là 'đã ghi nhận'", () => {
  it("bộ trạng thái đúng theo enum trong schema", () => {
    expect([...SALE_STATUS_DA_GHI_NHAN].sort()).toEqual([
      "COLLECT_CONFIRMED",
      "RECORDED",
    ]);
  });

  it("điều kiện where dùng `in`, không phải so BẰNG", () => {
    expect(KHOAN_DA_GHI_NHAN.saleStatus).toEqual({
      in: SALE_STATUS_DA_GHI_NHAN,
    });
    expect(KHOAN_DA_GHI_NHAN.deletedAt).toBeNull();
  });

  it("mảng phải KHẢ BIẾN — Prisma từ chối mảng readonly ở `in`", () => {
    // Không phải chuyện thẩm mỹ: `as const` ở đây làm typecheck đỏ với một thông báo
    // dài 8 dòng rất khó đọc. Ghim lại để lần sau ai "dọn dẹp" thì thấy ngay.
    expect(Array.isArray(KHOAN_DA_GHI_NHAN.saleStatus.in)).toBe(true);
  });
});

describe("[GN-02] laKhoanDaGhiNhan — bản JS của cùng điều kiện", () => {
  /** Khoản bình thường: sale đã ghi nhận, kế toán chưa xử. */
  const k = (over: Partial<Parameters<typeof laKhoanDaGhiNhan>[0]> = {}) => ({
    saleStatus: "RECORDED",
    accountantStatus: "PENDING",
    ...over,
  });

  it("nhận RECORDED và COLLECT_CONFIRMED", () => {
    expect(laKhoanDaGhiNhan(k())).toBe(true);
    expect(laKhoanDaGhiNhan(k({ saleStatus: "COLLECT_CONFIRMED" }))).toBe(true);
  });

  it("loại khoản đã xoá mềm", () => {
    expect(laKhoanDaGhiNhan(k({ deletedAt: new Date() }))).toBe(false);
    expect(
      laKhoanDaGhiNhan(k({ saleStatus: "COLLECT_CONFIRMED", deletedAt: new Date() })),
    ).toBe(false);
  });

  it("trạng thái lạ ⇒ false, không lọt", () => {
    expect(laKhoanDaGhiNhan(k({ saleStatus: "REJECTED" }))).toBe(false);
    expect(laKhoanDaGhiNhan(k({ saleStatus: "" }))).toBe(false);
  });

  // ── [HT-05] vá 24/09/2026 ────────────────────────────────────────────────────
  it("[GN-02b] kế toán TỪ CHỐI ⇒ KHÔNG còn là 'đã thu'", () => {
    // Trước bản vá đây là `true`: `rejectPayment` chỉ đổi `accountantStatus`, không đụng
    // `saleStatus`, mà vế `saleStatus` của trục B là phép so LUÔN ĐÚNG (enum chỉ có hai
    // giá trị và cả hai đều nằm trong danh sách). Khoản bị từ chối vẫn được cộng vào
    // "đã thu" ở 35 chỗ gọi — trong đó có số in trên mã QR và tin ZNS gửi phụ huynh.
    expect(laKhoanDaGhiNhan(k({ accountantStatus: "REJECTED" }))).toBe(false);
  });

  it("[GN-02c] CHỜ kế toán thì VẪN tính — đừng 'sửa cho giống' trục A", () => {
    // Đối chứng dương. Không có ca này thì siết nhầm thành `=== "CONFIRMED"` vẫn xanh,
    // và mọi khoản chưa ai duyệt biến mất khỏi công nợ — một lỗ lớn hơn lỗ đang vá.
    expect(laKhoanDaGhiNhan(k({ accountantStatus: "PENDING" }))).toBe(true);
    // ⚠️ Cố ý KHÔNG khẳng định thêm trạng thái "kế toán đã duyệt" ở đây: gõ chuỗi ấy ra
    // là vi phạm lưới `truc-a.test.ts` ("trục A chỉ có MỘT nhà"), và nó KHÔNG thêm gì —
    // luật đang canh là `not REJECTED`, mà cặp PENDING/REJECTED đã phủ cả hai đầu.
  });

  it("[GN-02d] HOÀN TIỀN vẫn tính — dòng âm tự trừ ra, loại nó là trừ HAI lần", () => {
    // `refundPayment` tạo một dòng `amount` ÂM. Loại `REFUNDED` khỏi tổng là bỏ mất phép
    // trừ ấy, và công nợ sẽ cao hơn thực tế đúng bằng số đã hoàn.
    expect(laKhoanDaGhiNhan(k({ accountantStatus: "REFUNDED" }))).toBe(true);
  });
});

// ── LƯỚI GHIM MÃ NGUỒN ───────────────────────────────────────────────────────
//
// Thứ cần khoá KHÔNG chứng minh được bằng test thuần: `debt.ts` lọc trong BỘ NHỚ, và
// bản cũ so `p.saleStatus === KHOAN_DA_GHI_NHAN.saleStatus`. Từ khi trường đó thành
// `{ in: [...] }`, phép so ấy đem một CHUỖI so với một ĐỐI TƯỢNG ⇒ luôn `false` ⇒ cột
// "đã ghi nhận" của /cong-no im lặng về 0 cho MỌI dòng. Không lỗi, không cảnh báo,
// typecheck vẫn xanh (so sánh `===` giữa hai kiểu khác nhau không phải lỗi TS).
describe("[GN-03] debt.ts phải lọc bằng HÀM, không so với trường where", () => {
  const src = readFileSync(
    resolve(process.cwd(), "lib/finance/debt.ts"),
    "utf8",
  );

  it("dùng laKhoanDaGhiNhan", () => {
    expect(src).toContain("e.payments.filter(laKhoanDaGhiNhan)");
  });

  it("KHÔNG còn phép so chuỗi-với-đối-tượng", () => {
    // Mã TRƯỚC bản vá: `(p) => p.saleStatus === KHOAN_DA_GHI_NHAN.saleStatus`.
    //
    // ⚠️ Neo vào CẢ PHÉP SO (`p.saleStatus === KHOAN_DA_GHI_NHAN`), không neo vào
    // đường dẫn thuộc tính trần: chú thích giải thích bản vá ngay tại chỗ sửa CÓ nhắc
    // `KHOAN_DA_GHI_NHAN.saleStatus`, nên bản assert đầu bắt luôn chính nó và báo đỏ
    // giả. Đây là lần thứ ba cái bẫy luật 11 này cắn trong phiên — nó cắn được vì lời
    // giải thích tốt bao giờ cũng phải gọi tên thứ nó vừa bỏ đi.
    expect(src).not.toContain("p.saleStatus === KHOAN_DA_GHI_NHAN");
  });
});
