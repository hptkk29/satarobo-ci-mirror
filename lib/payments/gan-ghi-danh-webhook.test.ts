// lib/payments/gan-ghi-danh-webhook.test.ts — LƯỚI GHIM MÃ NGUỒN (mẫu ở CLAUDE.md).
//
// ─────────────────────────────────────────────────────────────────────────────
// LUẬT CẦN KHOÁ: khoản `Payment` do TIỀN VỀ QUA QR sinh ra phải mang `enrollmentId`
// khi không mơ hồ.
//
// VÌ SAO TEST THUẦN KHÔNG CHỨNG MINH ĐƯỢC. `chonGhiDanhChoKhoan` là hàm thuần và
// test nó bao nhiêu cũng xanh — nó đã xanh suốt trong khi con bug nằm ở chỗ
// `allocateToOrder` KHÔNG GỌI nó: `tx.payment.create` ở `payos-ingest.ts` tạo khoản
// mà không truyền `enrollmentId` (grep `enrollmentId` trong tệp đó ra ĐÚNG 0 kết
// quả). Thứ cần kiểm là một lời gọi Prisma, không phải giá trị trả về ⇒ đúng hình
// dạng mà lưới ghim mã nguồn sinh ra để bắt.
//
// HẬU QUẢ ĐÃ ĐO (vì sao đáng ghim):
//  · `confirmPayment` (lib/finance/payment.ts:~433) mở đầu bằng
//    `if (!existing.enrollmentId) return fail(...)` ⇒ khoản do webhook sinh
//    KHÔNG BAO GIỜ xác nhận được;
//  · ⇒ TRỤC A (`accountantStatus: CONFIRMED`) không cộng ⇒ `/cong-no` và cổng phụ
//    huynh KHÔNG giảm nợ cho mọi đồng tiền về qua QR;
//  · ⇒ thêm tầng nữa: cổng phụ huynh cộng theo quan hệ `Enrollment.payments`, khoản
//    `enrollmentId = null` không trừ vào công nợ của ghi danh nào.
//  Tiền thật đã vào tài khoản, màn hình vẫn báo nợ nguyên.
//
// BỐN MẮT, mỗi mắt chặn một cách bug quay lại:
//   1. `tx.payment.create` TRUYỀN `enrollmentId`, và lấy từ hàm dùng chung
//   2. câu tra ứng viên đúng luật: theo học viên CỦA ĐƠN · loại ghi danh đã xoá mềm ·
//      `take: 2` để còn nhận ra ca mơ hồ
//   3. quy tắc dùng LẠI `chonGhiDanhChoKhoan`, không viết bản thứ hai
//   4. marker `[auto:<provider>:<txn>]` GIỮ NGUYÊN, KHÔNG gọi
//      `ensureOrderPaymentRecorded` (hai họ marker của hàm đó bị
//      `lib/orders/installments.ts` xoá mềm mỗi lần ai bấm "Lưu kế hoạch")
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chonGhiDanhChoKhoan, MUC_GAN } from "@/lib/finance/gan-ghi-danh-khoan";

// ⚠️ `import.meta.url` trong cấu hình vitest của repo này KHÔNG phải URL `file://`
// (fileURLToPath ném) — dùng `process.cwd()`. Xem CLAUDE.md mục "LƯỚI GHIM MÃ NGUỒN".
const NGUON = "lib/payments/payos-ingest.ts";
const src = readFileSync(resolve(process.cwd(), NGUON), "utf8");
const dong = src.split(/\r?\n/);

/** Chỉ số các dòng khớp `re`. Dùng để khẳng định SỐ LẦN khớp (luật 11). */
function viTri(re: RegExp): number[] {
  const out: number[] = [];
  dong.forEach((d, i) => {
    if (re.test(d)) out.push(i);
  });
  return out;
}

/** Cắt một lát mã, BỎ dòng chú thích — kẻo chính chú thích giải thích bản vá lại
 *  làm lưới xanh giả (đã cắn ba lần trong repo này, xem luật 11). */
function lat(tu: number, den: number): string {
  return dong
    .slice(tu, den)
    .filter((d) => !/^\s*(\/\/|\*|\/\*)/.test(d))
    .join("\n");
}

describe("[GGW] tiền về qua QR phải gắn ghi danh — lưới ghim mã nguồn", () => {
  it("[GGW-01] tx.payment.create TRUYỀN enrollmentId, lấy từ kết quả hàm dùng chung", () => {
    // Mã TRƯỚC bản vá: khối `data: {` chỉ có orderId · amount · method · paidDate ·
    // note · saleStatus · accountantStatus · recordedById · centerId. Không dòng nào
    // tên `enrollmentId` trong CẢ tệp.
    const taoKhoan = viTri(/^\s*await tx\.payment\.create\(\{$/);
    expect(taoKhoan, `phải có ĐÚNG 1 lời gọi tx.payment.create trong ${NGUON}`).toHaveLength(1);

    // Khối `data` kết thúc ở dòng cuối cùng của nó là `centerId: order.centerId,`.
    const dau = taoKhoan[0]!;
    const cuoi = dong.findIndex((d, i) => i > dau && /^\s*centerId: order\.centerId,$/.test(d));
    expect(cuoi, "không tìm thấy đuôi khối data của tx.payment.create").toBeGreaterThan(dau);

    const than = lat(dau, cuoi + 1);
    const gan = than.match(/^\s*enrollmentId:/gm) ?? [];
    expect(gan, "khối data của tx.payment.create thiếu trường enrollmentId").toHaveLength(1);
    // Phải là KẾT QUẢ của hàm dùng chung, không phải một phép `length === 1` gõ tại chỗ.
    expect(than, "enrollmentId phải lấy từ kết quả chonGhiDanhChoKhoan(...)").toMatch(
      /enrollmentId:\s*\w+\.ghiDanhId\b/,
    );
  });

  it("[GGW-02] nguồn ƯU TIÊN: ghi danh mà CHÍNH ĐƠN trỏ tới, gộp trùng, khoá theo học viên", () => {
    // ĐO 14/09/2026 trên satarobo_local, 496 đơn còn sống: chỉ dùng luật "học viên có
    // đúng một ghi danh còn sống" thì 32 đơn gắn được / 461 MƠ HỒ (6,5%) — vì
    // `COMPLETED` không bị xoá mềm (191 dòng) nên em học xong Sata1 lên Sata2 đã thành
    // mơ hồ. Đọc `OrderItem` trước: 493/496 (99,4%), 0 đơn trỏ ≥2 ghi danh. Bỏ nguồn
    // này đi là vá xong mà 93% tiền về qua QR vẫn không xác nhận được.
    // ⚠️ SỬA 17/09/2026 — nay có ĐÚNG HAI câu tra `orderItem` trong tệp, hai mục đích khác
    // nhau, và ca này phải phân biệt được chúng thay vì đếm suông:
    //   · NGUỒN GHI DANH (câu dưới đây) — lọc `enrollmentId: { not: null }`;
    //   · ĐẾM DÒNG HÀNG (PHIÊN B) — để gắn `Payment.orderItemId` khi đơn có ĐÚNG một con.
    // Giữ nguyên `toHaveLength(1)` là ca đỏ vì một lý do sai; đổi thành `>= 1` là mất luôn
    // thứ ca này canh (không được đẻ bản thứ hai của NGUỒN GHI DANH).
    const tra = viTri(/tx\.orderItem\.findMany\(\{/);
    expect(tra, `phải có ĐÚNG 2 câu tra dòng hàng trong ${NGUON}`).toHaveLength(2);
    const nguon = tra.filter((d) => lat(d, d + 14).includes("enrollmentId: { not: null }"));
    expect(nguon, "phải có ĐÚNG 1 câu tra làm NGUỒN GHI DANH").toHaveLength(1);

    const than = lat(nguon[0]!, nguon[0]! + 14);
    expect(than, "phải tra dòng hàng của CHÍNH đơn này").toMatch(/orderId: order\.id\b/);
    expect(than, "chỉ lấy dòng hàng CÓ trỏ ghi danh").toMatch(
      /enrollmentId:\s*\{\s*not:\s*null\s*\}/,
    );
    // Thiếu vế này là gắn tiền vào ghi danh đã bỏ.
    expect(than, "phải loại ghi danh đã xoá mềm (deletedAt: null)").toMatch(
      /deletedAt:\s*null/,
    );
    // Item trỏ ghi danh của em KHÁC = dữ liệu hỏng; gắn vào là rót tiền sang sổ nhà khác.
    expect(than, "phải khoá theo học viên của đơn khi đơn có studentId").toMatch(
      /order\.studentId\s*\?\s*\{\s*studentId: order\.studentId\s*\}/,
    );
    // Học phí + giáo cụ cùng trỏ MỘT ghi danh là chuyện thường. Không gộp trùng thì
    // đơn chắc chắn nhất lại bị đếm thành "≥2 ⇒ mơ hồ ⇒ null".
    const gop = src.match(/new Set\(dongHangCoGhiDanh\.map/g) ?? [];
    expect(gop, "phải gộp trùng enrollmentId của các dòng hàng").toHaveLength(1);
  });

  it("[GGW-02b] nguồn LÙI: học viên CỦA ĐƠN · bỏ ghi danh đã xoá mềm · take 2", () => {
    const tra = viTri(/tx\.enrollment\.findMany\(\{/);
    expect(tra, `phải có ĐÚNG 1 câu tra ghi danh trong ${NGUON}`).toHaveLength(1);

    // Lấy cả 4 dòng TRƯỚC: chỗ đó là hai cổng chặn — "đã có nguồn ưu tiên rồi" và
    // "đơn không có studentId".
    const than = lat(tra[0]! - 4, tra[0]! + 8);
    expect(than, "phải tra theo học viên của ĐƠN, không phải của lead hay của lớp").toMatch(
      /studentId: order\.studentId\b/,
    );
    // Thiếu vế này là đem ghi danh đã xoá mềm ra đếm ⇒ em còn đúng 1 lớp sống vẫn
    // bị coi là mơ hồ, hoặc tệ hơn: gắn tiền vào ghi danh đã bỏ.
    expect(than, "phải loại ghi danh đã xoá mềm (deletedAt: null)").toMatch(
      /deletedAt:\s*null/,
    );
    // `take: 1` biến ca mơ hồ thành ca chắc chắn và gắn bừa vào ghi danh đầu bảng.
    expect(than, "phải take: 2 để còn nhận ra ca có ≥2 ghi danh").toMatch(/take:\s*2\b/);
    // Ca biên "đơn tạo ở /orders/new không có studentId" → không tra, danh sách rỗng.
    expect(than, "đơn không có studentId phải rơi về danh sách ứng viên RỖNG").toMatch(
      /order\.studentId[\s\S]{0,400}:\s*\[\]/,
    );
    // Chỉ lùi khi nguồn ưu tiên RỖNG. Lùi khi nguồn (1) trả ≥2 là lấy một ghi danh mà
    // chính đơn còn chưa chọn nổi — đúng kiểu đoán mà cả khối này đi tránh.
    expect(than, "chỉ được lùi khi nguồn ưu tiên rỗng").toMatch(
      /idTheoDon\.length\s*>\s*0/,
    );
  });

  it("[GGW-03] dùng LẠI chonGhiDanhChoKhoan, không viết bản thứ hai của luật", () => {
    expect(src, "phải import quy tắc dùng chung").toContain(
      'from "@/lib/finance/gan-ghi-danh-khoan"',
    );
    const goi = src.match(/chonGhiDanhChoKhoan\(/g) ?? [];
    expect(goi, "phải gọi chonGhiDanhChoKhoan ĐÚNG 1 lần").toHaveLength(1);
  });

  it("[GGW-04] GIỮ marker [auto:<provider>:<txn>], KHÔNG gọi ensureOrderPaymentRecorded", () => {
    // Marker riêng theo mã giao dịch: mỗi lần tiền về là một dòng, webhook retry vẫn
    // idempotent. Đổi sang marker của ensureOrderPaymentRecorded là mời
    // `lib/orders/installments.ts` xoá mềm tiền ngân hàng ở lần "Lưu kế hoạch" kế tiếp.
    expect(src, "marker phải neo theo providerTxnId").toContain(
      "[auto:${provider.toLowerCase()}:${providerTxnId}]",
    );
    // ⚠️ KHÔNG khẳng định trên TÊN TRẦN: chú thích giải thích bản vá có nhắc tên hàm
    // này (trong dấu nháy ngược) — neo vào tên trần là lưới đỏ giả. Neo vào LỜI GỌI.
    expect(src, "không được gọi ensureOrderPaymentRecorded ở đường webhook").not.toMatch(
      /ensureOrderPaymentRecorded\s*\(/,
    );
    expect(src, "không được import sổ marker của đường xác nhận đơn").not.toMatch(
      /from "@\/lib\/finance\/payment"/,
    );
  });

  it("[GGW-05] bốn ca biên, chạy qua đúng quy tắc mà đường webhook nạp", () => {
    // Đường webhook nạp ứng viên ở dạng chỉ có `id` (tên lớp/khoá chỉ phục vụ màn chọn
    // tay). Ba nhánh dưới là ba kết cục mà `allocateToOrder` có thể rơi vào, sau khi
    // hai nguồn ứng viên đã chạy.
    const uv = (id: string) => ({ id, tenLop: null, tenKhoa: null, finalPrice: null });

    // (a) đơn không có dòng ghi danh VÀ không có studentId (đơn tạo ở /orders/new)
    //     → danh sách RỖNG → null. Đo prod-local: 3/496 đơn.
    const khongCo = chonGhiDanhChoKhoan([]);
    expect(khongCo.muc).toBe(MUC_GAN.KHONG_CO);
    expect(khongCo.ghiDanhId).toBeNull();

    // (b) đúng một ghi danh còn sống (ghi danh đã deletedAt đã bị `where` loại, dòng
    //     hàng trùng đã gộp) → gắn. Đo prod-local: 493/496 đơn.
    const motCai = chonGhiDanhChoKhoan([uv("enr-1")]);
    expect(motCai.muc).toBe(MUC_GAN.CHAC_CHAN);
    expect(motCai.ghiDanhId).toBe("enr-1");

    // (c) đơn trỏ ≥2 ghi danh khác nhau, hoặc (nhánh lùi) em có ≥2 ghi danh còn sống →
    //     MƠ HỒ → null. Đoán hộ ở đây là cộng tiền vào công nợ của khoá khác.
    const nhieu = chonGhiDanhChoKhoan([uv("enr-1"), uv("enr-2")]);
    expect(nhieu.muc).toBe(MUC_GAN.PHAI_CHON);
    expect(nhieu.ghiDanhId).toBeNull();
  });
});
