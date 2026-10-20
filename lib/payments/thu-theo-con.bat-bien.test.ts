// Ca [BTC-*] — BẤT BIẾN của thiết kế "công nợ theo CON, QR theo ĐƠN".
//
// ─────────────────────────────────────────────────────────────────────────────
// VIẾT TRƯỚC KHI HIỆN THỰC — chủ dự án chốt 16/09: *"sau công tắc, fixture + test bất biến
// trước"*. Nên tệp này có HAI loại ca, và phải đọc được cái nào là cái nào:
//
//   · ca THƯỜNG — bất biến đã hiện thực xong, xanh hôm nay, đỏ nếu ai phá.
//   · ca `it.fails` — bất biến của phần CHƯA XÂY. Hôm nay thân ca ném nên CI không đỏ;
//     xây xong nó chuyển XANH và vitest báo "expected to fail" ⇒ buộc người xây gỡ ghim.
//     Đó là cách tệp này biến thành danh sách việc tự kiểm.
//
// [16/09, đợt 2] Migration `20260916120000_payment_request_theo_con` đã hiện thực chiều
// CON trên lược đồ, nên 4 trong 5 ca hẹn đã GỠ GHIM và chuyển thành ca thường. Còn đúng
// MỘT hẹn: `payment-request.ts` sinh đợt theo từng dòng.
//
// FIXTURE dùng SỐ THẬT, không số tròn: đơn `ORD-260915-000007` trên `satarobo_local` —
// hai con, tổng 18.468.000đ, kế hoạch 5 đợt + cọc 2.000.000đ. Dữ liệu tròn trịa trong test
// là dữ liệu không kiểm được gì (luật đọc số của repo).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planAllocation, type AllocTarget } from "@/lib/payments/allocation";
import {
  BUOC_DONG,
  docThuTuRot,
  lechTongDotCuaDong,
  thuTuRot,
  TRAN_SO_DONG,
} from "./thu-tu-rot";

/** Hai dòng của đơn thật — số lấy từ DB, không bịa. */
const DONG_BE_A = { thuTuDong: 0, thanhTien: 8_976_000 }; // Sata3
const DONG_BE_B = { thuTuDong: 1, thanhTien: 9_492_000 }; // Sata4

/** Dựng một phiếu thu cho bộ chia waterfall đã có sẵn. */
const phieu = (
  id: string,
  thuTuDong: number,
  installmentNo: number,
  amountDue: number,
  allocated = 0,
): AllocTarget => ({
  id,
  amountDue,
  allocated,
  sortOrder: thuTuRot({ thuTuDong, installmentNo }),
  status: allocated > 0 ? "PARTIAL" : "PENDING",
});

describe("[BTC-01] THỨ TỰ RÓT: hết đợt của con thứ nhất rồi mới sang con thứ hai", () => {
  it("dòng trước LUÔN đứng trước mọi đợt của dòng sau", () => {
    // Đây là lý do `sortOrder` không thể chỉ bằng `installmentNo`: hai phiếu "đợt 1" của
    // hai em sẽ cùng giá trị, và thứ tự rót rơi về so sánh cuid — tức ngẫu nhiên.
    const dotCuoiCuaDongDau = thuTuRot({ thuTuDong: 0, installmentNo: 99 });
    const dotDauCuaDongSau = thuTuRot({ thuTuDong: 1, installmentNo: 0 });
    expect(dotCuoiCuaDongDau).toBeLessThan(dotDauCuaDongSau);
  });

  it("trong cùng một dòng, đợt nhỏ đứng trước", () => {
    expect(thuTuRot({ thuTuDong: 1, installmentNo: 1 })).toBeLessThan(
      thuTuRot({ thuTuDong: 1, installmentNo: 2 }),
    );
  });

  it("ĐƠN ÁNH — đọc ngược ra đúng cặp (dòng, đợt)", () => {
    for (let d = 0; d < TRAN_SO_DONG; d++)
      for (const dot of [0, 1, 5, 12, 99]) {
        expect(docThuTuRot(thuTuRot({ thuTuDong: d, installmentNo: dot }))).toEqual({
          thuTuDong: d,
          installmentNo: dot,
        });
      }
  });

  it("đầu vào RÁC không bao giờ cho ra thứ tự ÂM", () => {
    // Ca này thêm SAU khi cấy lỗi "bỏ kẹp số âm" KHÔNG làm lưới đỏ — không ca nào truyền
    // số âm nên phép kẹp là mã chết trước mắt lưới. Mà `sortOrder` âm KHÔNG vô hại:
    // `planAllocation` sắp tăng dần, nên một dòng hỏng sẽ được rót TRƯỚC mọi dòng lành.
    for (const x of [-1, -100, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(thuTuRot({ thuTuDong: x, installmentNo: 1 }), `dong=${x}`).toBeGreaterThanOrEqual(0);
      expect(thuTuRot({ thuTuDong: 0, installmentNo: x }), `dot=${x}`).toBeGreaterThanOrEqual(0);
    }
    // Và dòng RÁC không được chen lên trước dòng THẬT đầu tiên.
    expect(thuTuRot({ thuTuDong: -5, installmentNo: 1 })).toBeGreaterThanOrEqual(
      thuTuRot({ thuTuDong: 0, installmentNo: 0 }),
    );
  });

  it("BƯỚC phải LỚN HƠN số đợt tối đa — hạ nó xuống là lỗi tiền im lặng", () => {
    // `TRAN_SO_DOT = 12` (+ cọc + phiếu thu toàn đơn). Ca này đỏ ngay khi ai đó hạ BUOC_DONG.
    expect(BUOC_DONG).toBeGreaterThan(12 + 2);
  });
});

describe("[BTC-02] WATERFALL: thiếu lấp dần theo thứ tự dòng", () => {
  /** Bé A: cọc 2tr + 2 đợt. Bé B: 2 đợt. Tổng khớp thành tiền từng dòng. */
  const phieuCuaDon = (): AllocTarget[] => [
    phieu("a-coc", 0, 1, 2_000_000),
    phieu("a-d2", 0, 2, 3_488_000),
    phieu("a-d3", 0, 3, 3_488_000),
    phieu("b-d1", 1, 1, 4_746_000),
    phieu("b-d2", 1, 2, 4_746_000),
  ];

  it("tiền vừa đủ cọc của bé A ⇒ chỉ cọc của bé A được rót", () => {
    const r = planAllocation(2_000_000, phieuCuaDon());
    expect(r.lines.map((l) => l.paymentRequestId)).toEqual(["a-coc"]);
    expect(r.credit).toBe(0);
  });

  it("tiền đủ cả bé A ⇒ lấp HẾT bé A rồi mới chạm bé B", () => {
    const tienBeA = 2_000_000 + 3_488_000 + 3_488_000;
    const r = planAllocation(tienBeA, phieuCuaDon());
    expect(r.lines.map((l) => l.paymentRequestId)).toEqual(["a-coc", "a-d2", "a-d3"]);
    // Bé B KHÔNG được chạm tới — đây là điều `sortOrder = installmentNo` làm sai.
    expect(r.lines.some((l) => l.paymentRequestId.startsWith("b-"))).toBe(false);
  });

  it("tiền lẻ giữa chừng ⇒ phiếu đang dở thành PARTIAL, KHÔNG nhảy cóc", () => {
    const r = planAllocation(2_000_000 + 1_000_000, phieuCuaDon());
    expect(r.lines).toEqual([
      { paymentRequestId: "a-coc", amount: 2_000_000, roundingWaived: 0 },
      { paymentRequestId: "a-d2", amount: 1_000_000, roundingWaived: 0 },
    ]);
  });

  it("THỪA ⇒ ra `credit` (ví gia đình), KHÔNG rót bừa vào đâu", () => {
    const tongDon = 2_000_000 + 3_488_000 + 3_488_000 + 4_746_000 + 4_746_000;
    const r = planAllocation(tongDon + 500_000, phieuCuaDon());
    expect(r.credit).toBe(500_000);
    expect(r.lines.reduce((s, l) => s + l.amount, 0)).toBe(tongDon);
  });

  it("QR của ĐỢT CỤ THỂ thắng thứ tự — sale xuất QR đợt nào, tiền vào đợt đó", () => {
    // `startId` là phiếu tra được từ `matchKey` trên nội dung CK.
    const r = planAllocation(4_746_000, phieuCuaDon(), "b-d1");
    expect(r.lines[0]?.paymentRequestId).toBe("b-d1");
  });
});

describe("[BTC-03] Σ ĐỢT CỦA MỘT DÒNG === THÀNH TIỀN DÒNG ĐÓ", () => {
  it("khớp ⇒ lệch 0", () => {
    expect(lechTongDotCuaDong(DONG_BE_A.thanhTien, [2_000_000, 3_488_000, 3_488_000])).toBe(0);
    expect(lechTongDotCuaDong(DONG_BE_B.thanhTien, [4_746_000, 4_746_000])).toBe(0);
  });

  it("khai THỪA / THIẾU ⇒ trả đúng con số lệch, để màn in ra được", () => {
    expect(lechTongDotCuaDong(8_976_000, [9_000_000])).toBe(24_000);
    expect(lechTongDotCuaDong(8_976_000, [8_000_000])).toBe(-976_000);
  });

  it("số rác không làm hỏng phép cộng", () => {
    expect(lechTongDotCuaDong(1_000, [Number.NaN, 1_000])).toBe(0);
    expect(lechTongDotCuaDong(Number.NaN, [1_000])).toBe(1_000);
  });
});

// ═══ CHIỀU "CON" TRÊN LƯỢC ĐỒ — VÀ LƯỚI DUY NHẤT CANH MIGRATION ═══════════════
//
// ⚠️ ĐO ĐƯỢC 16/09, và đây là lý do các ca dưới phải đọc thẳng văn bản migration:
// `prisma migrate diff` **BỎ QUA HẲN** chỉ mục có mệnh đề `WHERE`. Đo cụ thể — dựng DB
// nháp, `migrate deploy` đủ 253 migration, rồi diff với `schema.prisma`: 63 dòng ra, và
// KHÔNG dòng nào nhắc tới hai khoá duy nhất từng phần của bảng này.
//
// Nghĩa là xoá nhầm hai câu `CREATE UNIQUE INDEX` trong migration thì DB mất sạch lưới
// chống phiếu trùng, trong khi `typecheck`, `lint`, và cả phép rà drift đều XANH. Không
// cổng tự động nào khác canh chúng. Các ca dưới là lưới duy nhất.
//
// Theo luật 11 của repo (test grep mã nguồn là loại MONG MANH NHẤT): neo chuỗi hẹp, KHÔNG
// dùng cờ `/s`, ĐẾM số lần khớp, và **bóc chú thích trước khi soi** — chú thích giải
// thích bản vá thường chứa đúng chuỗi đang tìm.

const MIGRATION_CON =
  "prisma/migrations/20260916120000_payment_request_theo_con/migration.sql";

/**
 * Bóc chú thích khỏi văn bản mã, để lưới soi MÃ chứ không soi lời kể về mã.
 *
 * ⚠️ HAI chi tiết ở đây từng làm chính lưới này VÔ HIỆU TRONG IM LẶNG, và cả hai đều
 * không biểu hiện gì ngoài một ca xanh nhầm:
 *
 *   1. Tách dòng bằng `/\r?\n/`, KHÔNG phải `"\n"`. `prisma/schema.prisma` là CRLF (đo
 *      bằng `file`: "with CRLF line terminators"), nên tách bằng `"\n"` để lại một `\r`
 *      ở cuối mỗi dòng.
 *   2. Dùng `[^\n]*`, KHÔNG phải `.*`. Trong JavaScript, `.` KHÔNG khớp `\r` — nên
 *      `/\/\/.*$/` gặp dòng còn `\r` là không khớp gì cả, hàm trả về NGUYÊN VĂN và chú
 *      thích còn nguyên.
 *
 * Đo 16/09, cùng một phép bóc trên cùng một tệp: Python bỏ đúng dòng chú thích (`.` của
 * Python CÓ khớp `\r`), JavaScript bỏ 0 dòng. Lưới vẫn "chạy", vẫn xanh với mọi ca lành,
 * và chỉ lộ ra khi có người viết đúng chuỗi cấm vào một chú thích — đúng lúc nó phải
 * đáng tin nhất thì nó lại báo động giả. Ca `[BTC-07]` canh chính hàm này: lưới canh lưới.
 */
function bocChuThich(vanBan: string, moChuThich: RegExp): string {
  return vanBan
    .split(/\r?\n/)
    .map((d) => d.replace(moChuThich, ""))
    .join("\n");
}

const MO_JS = /\/\/[^\n]*$/;
const MO_SQL = /--[^\n]*$/;

/** Văn bản `schema.prisma`, đã bóc chú thích `//` (và `///`). */
function docSchema(): string {
  return bocChuThich(
    readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8"),
    MO_JS,
  );
}

/** Văn bản migration, đã bóc chú thích `-- …` với cùng lý do. */
function docMigration(): string {
  return bocChuThich(
    readFileSync(resolve(process.cwd(), MIGRATION_CON), "utf8"),
    MO_SQL,
  );
}

function modelPaymentRequest(): string {
  return /model PaymentRequest \{[\s\S]*?\n\}/.exec(docSchema())?.[0] ?? "";
}

describe("[BTC-04] chiều CON: cột `orderItemId` + khoá duy nhất chia đôi", () => {
  it("PaymentRequest có cột `orderItemId`, và nó NULLABLE", () => {
    // Nullable là thứ giữ cho migration additive: mọi dòng cũ ở lại với NULL. Đặt NOT
    // NULL là phải backfill một cột không suy ngược được, trên bảng tiền của prod.
    expect(modelPaymentRequest()).toMatch(/\n\s*orderItemId\s+String\?/);
  });

  it("schema KHÔNG được khai lại `@@unique([orderId, installmentNo])`", () => {
    // Khai lại là `migrate dev` sinh câu dựng lại khoá ĐẦY ĐỦ ⇒ đơn hai con hết tạo được
    // phiếu đợt 1 cho em thứ hai, ngay lúc chạy migration, và không lỗi nào báo trước.
    // Ca này soi bản ĐÃ BÓC CHÚ THÍCH: chú thích ngay trên chỗ đó có nhắc đúng chuỗi này.
    const khop =
      modelPaymentRequest().match(/@@unique\(\[orderId, installmentNo\]\)/g) ?? [];
    expect(khop).toHaveLength(0);
  });

  it("migration có ĐỦ HAI khoá duy nhất từng phần, đúng hai nhánh", () => {
    const sql = docMigration();
    // Luồng CŨ — giữ nguyên tên khoá, thu hẹp về đúng tập dòng cũ (`orderItemId IS NULL`).
    const nhanhCu =
      sql.match(
        /CREATE UNIQUE INDEX[^;]*"PaymentRequest_orderId_installmentNo_key"[^;]*WHERE "orderItemId" IS NULL;/g,
      ) ?? [];
    // Luồng MỚI — đây là thứ cho phép hai con cùng có "đợt 1" trên một đơn.
    const nhanhMoi =
      sql.match(
        /CREATE UNIQUE INDEX[^;]*"PaymentRequest_orderItemId_installmentNo_key"[^;]*WHERE "orderItemId" IS NOT NULL;/g,
      ) ?? [];
    expect({ cu: nhanhCu.length, moi: nhanhMoi.length }).toEqual({ cu: 1, moi: 1 });

    // Và khoá ĐẦY ĐỦ cũ phải bị gỡ trước đó — còn nó thì nhánh mới vô nghĩa, vì khoá cũ
    // vẫn cấm hai phiếu cùng `installmentNo` trên một đơn.
    expect(sql).toMatch(/DROP INDEX[^;]*"PaymentRequest_orderId_installmentNo_key";/);
  });
});

describe("[BTC-05] phiếu thu GỘP — một QR cho cả nhà", () => {
  it("có `PaymentBill` và `PaymentBillLine`", () => {
    const schema = docSchema();
    expect(/^model PaymentBill \{/m.test(schema)).toBe(true);
    expect(/^model PaymentBillLine \{/m.test(schema)).toBe(true);
  });

  it("mỗi đơn tối đa MỘT phiếu gộp đang mở — do DB gác, không do mã nhớ kiểm", () => {
    // Đếm phiếu OPEN ở tầng mã rồi mới tạo KHÔNG chặn được hai lượt bấm đồng thời: cả hai
    // cùng đọc thấy 0, cả hai cùng ghi ⇒ hai mã QR cùng sống cho một gia đình, khách quét
    // mã cũ, tiền về khớp phiếu đã bỏ. Chỉ chỉ mục từng phần mới chặn được.
    const khop =
      docMigration().match(
        /CREATE UNIQUE INDEX[^;]*"PaymentBill_orderId_open_key"[^;]*WHERE "status" = 'OPEN';/g,
      ) ?? [];
    expect(khop).toHaveLength(1);
  });

  it("CẢ HAI bảng mới phải tự BẬT RLS", () => {
    // Bảng mới ra đời với RLS TẮT — migration bật hàng loạt (20260617) chỉ chạy MỘT LẦN,
    // và 31 bảng sinh sau nó đã từng nằm trần cho anon/authenticated (sự cố 09/08). Thiếu
    // dòng này là sổ tiền của phụ huynh phơi qua PostgREST.
    const sql = docMigration();
    for (const bang of ["PaymentBill", "PaymentBillLine"]) {
      expect(sql).toContain(`ALTER TABLE "${bang}" ENABLE ROW LEVEL SECURITY;`);
    }
  });
});

describe("[BTC-07] LƯỚI CANH LƯỚI — phép bóc chú thích phải THẬT SỰ bóc", () => {
  // Vì sao có nhóm ca này: 16/09, `docSchema()` bản đầu bóc được **0 dòng** trên
  // `schema.prisma` (CRLF + `.` của JS không khớp `\r`). Hệ quả là ca [BTC-04] đỏ ngay
  // trên bản ĐÃ VÁ, vì nó đọc trúng chuỗi cấm nằm trong một câu chú thích CẤM chuỗi đó.
  // Một lưới bóc-chú-thích hỏng không tự tố cáo: nó chỉ hoặc im, hoặc báo động giả.
  it("bóc được chú thích JS trên dòng kết thúc bằng CRLF", () => {
    const vao = '  // @@unique([orderId, installmentNo])\r\n  orderItemId String?\r\n';
    const ra = bocChuThich(vao, MO_JS);
    expect(ra).not.toContain("@@unique");
    expect(ra).toContain("orderItemId String?");
  });

  it("bóc được chú thích SQL trên dòng kết thúc bằng CRLF", () => {
    const vao = '-- CREATE UNIQUE INDEX "X" ...\r\nCREATE TABLE "Y" (\r\n';
    const ra = bocChuThich(vao, MO_SQL);
    expect(ra).not.toContain("CREATE UNIQUE INDEX");
    expect(ra).toContain('CREATE TABLE "Y" (');
  });

  it("và nó đang bóc trên TỆP THẬT, không chỉ trên chuỗi gõ tay", () => {
    // Luật 9 của repo: cổng được cho ăn bằng đầu vào gõ tay thì nó kiểm CỔNG, không kiểm
    // HỆ THỐNG. Hai ca trên là đầu vào gõ tay; ca này chạy trên đúng hai tệp mà [BTC-04]
    // và [BTC-05] soi. Vế đầu mỗi cặp khẳng định tệp THỰC SỰ có chú thích — thiếu nó thì
    // vế sau xanh vì "không có gì để bóc", tức xanh vô nghĩa.
    const coDongMo = (v: string, mo: string) =>
      v.split(/\r?\n/).some((d) => d.trimStart().startsWith(mo));

    const schemaTho = readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8");
    expect(coDongMo(schemaTho, "//")).toBe(true);
    expect(coDongMo(docSchema(), "//")).toBe(false);

    const sqlTho = readFileSync(resolve(process.cwd(), MIGRATION_CON), "utf8");
    expect(coDongMo(sqlTho, "--")).toBe(true);
    expect(coDongMo(docMigration(), "--")).toBe(false);
  });
});

/**
 * Thân của một hàm, cắt từ dòng khai tới hàm kế tiếp cùng cấp.
 *
 * ⚠️ Cắt bằng "tới khai báo `export async function` kế tiếp" chứ không đếm ngoặc: đếm ngoặc trên văn bản thô là
 * đếm cả ngoặc trong chuỗi và trong chú thích. Ở đây chỉ cần một khoanh vùng ĐỦ HẸP để
 * `indexOf` sau đó không vớ sang hàm khác.
 */
function thanHam(src: string, khai: string): string {
  const i = src.indexOf(khai);
  if (i < 0) throw new Error(`không thấy hàm: ${khai} — lưới đang soi nhầm chỗ`);
  const j = src.indexOf("export async function", i + khai.length);
  return src.slice(i, j < 0 ? undefined : j);
}

describe("[BTC-06] luồng MỚI không được gọi bộ chia theo TỶ LỆ", () => {
  it("bộ chia waterfall đã có sẵn — KHÔNG viết bộ thứ hai", () => {
    // Chủ dự án: *"Không chia theo tỷ lệ, không gọi allocateByWeight / chia-khoan-theo-don
    // trên luồng mới."* `planAllocation` đã làm đúng việc đó từ 03/08 — ca này ghim rằng
    // nó tồn tại và vẫn là đường dùng, để người sau đừng dựng thêm một bộ chia nữa.
    expect(typeof planAllocation).toBe("function");
    const r = planAllocation(1, [phieu("x", 0, 1, 10)]);
    expect(r.lines).toEqual([{ paymentRequestId: "x", amount: 1, roundingWaived: 0 }]);
  });

  it.fails("`materializeInstallmentRequests` sinh đợt theo từng DÒNG", () => {
    // HẸN: xanh khi đường ghi cấp đơn biết sinh đợt cho từng con.
    //
    // ⚠️ BẢN CŨ CỦA CA NÀY XANH VÌ LÝ DO SAI, và đó là bài học đắt hơn chính cái hẹn.
    // Nó hỏi `/orderItemId/.test(src)` — tức "chuỗi `orderItemId` có xuất hiện đâu đó
    // trong tệp không". Ngày 24/09/2026 tôi thêm `orderItemId` vào KIỂU ĐỌC
    // `PaymentRequestView` (cho một cái bảng chỉ để hiển thị, không ghi gì) và ca này lập
    // tức chuyển xanh — trong khi đường ghi KHÔNG đổi một dòng nào.
    //
    // Đúng luật 11: lưới ghim VĂN BẢN chứ không ghim LUẬT thì nó bắn vì chuyện khác. Bản
    // này neo vào đúng thứ cái hẹn nói tới: lời gọi `create` BÊN TRONG hàm ấy có khai
    // `orderItemId` không.
    const src = readFileSync(
      resolve(process.cwd(), "lib/payments/payment-request.ts"),
      "utf8",
    );
    const than = thanHam(src, "export async function materializeInstallmentRequests");
    const create = than.slice(than.indexOf("paymentRequest.create"));
    expect(create.slice(0, create.indexOf("});")).includes("orderItemId")).toBe(true);
  });

  it.fails("`materializeInstallmentRequests` chỉ soi phiếu CẤP ĐƠN", () => {
    // GHIM MỘT LỖ ĐÃ ĐO (24/09/2026), chưa tới lượt vá — `it.fails` là HẸN, không phải
    // quên (luật: đừng dùng `it.skip`).
    //
    // Hàm đọc `tx.paymentRequest.findMany({ where: { orderId } })` — KHÔNG lọc
    // `orderItemId`. Rồi nó khoá map theo `installmentNo`:
    //
    //     const byNo = new Map(existing.map((r) => [r.installmentNo, r]));
    //
    // Đợt theo CON cũng đánh số 1,2,3… (khoá duy nhất từng phần là
    // `[orderItemId, installmentNo]`), nên trên một đơn có CẢ HAI loại đợt:
    //   · `byNo.get(1)` có thể trả phiếu CỦA MỘT BÉ ⇒ hàm UPDATE `amountDue` / `dueDate` /
    //     `matchKey` của bé đó theo số của đợt cấp đơn;
    //   · vòng "VOID phiếu dư" bên dưới duyệt `existing` và VOID mọi phiếu có
    //     `installmentNo` ngoài kế hoạch ⇒ đợt thứ 5 của một bé bị huỷ im lặng.
    //
    // Cả hai đều là sai lệch SỐ TIỀN nhìn thấy được, và không lỗi nào báo.
    //
    // Đường tới: tạo đợt theo con trên đơn CHƯA có kế hoạch (lúc đó `tongDotDangMoDon = 0`
    // nên cổng `kiemTaoDot` cho qua), rồi lưu kế hoạch trả góp cho đơn.
    //
    // Vá là đợt RIÊNG — nó chạm đường GHI tiền, khác hẳn lượt 24/09 vốn chỉ thêm một bảng
    // để đọc.
    const src = readFileSync(
      resolve(process.cwd(), "lib/payments/payment-request.ts"),
      "utf8",
    );
    const than = thanHam(src, "export async function materializeInstallmentRequests");
    const doc = than.slice(than.indexOf("const existing = await tx.paymentRequest.findMany"));
    expect(doc.slice(0, doc.indexOf("});")).includes("orderItemId: null")).toBe(true);
  });
});
