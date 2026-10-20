// [QRQ-*] — Cổng quyền XUẤT QR: giao diện và máy chủ phải hỏi CÙNG MỘT quyền.
//
// ── SỰ CỐ 02/10/2026 ─────────────────────────────────────────────────────────────────
// Chủ dự án báo bằng hai đơn thật trên `test` (`ORD-261002-000001` đã qua quản lý duyệt,
// `ORD-261002-000002` không cần duyệt): **không đơn nào có nút xuất QR**, trong khi người
// dùng là `UAT — Tư vấn viên CS1` (vai `CENTER_SALES_CSM`).
//
// Đo `prisma/seed-roles.ts`:
//     CENTER_SALES_CSM   → payments:record · orders:view · orders:create · orders:view-pii
//     CENTER_ACCOUNTANT  → payments:record
//     HO_ACCOUNTANT / CENTER_MANAGER → orders:manage + payments:record
// ⇒ Sale và Kế toán cơ sở KHÔNG có `orders:manage`.
//
// Mà cả hai cổng đều hỏi `orders:manage`:
//   · `_qr-actions.ts` (QR đời cũ, `QrSession`);
//   · `canIssue = canManage && …` ở bảng đợt — gác CẢ HAI đường QR.
// ⇒ **Sale chưa bao giờ xuất được QR**, từ `d5294f837` (03/08/2026). Không phải hồi quy.
//
// Mâu thuẫn thẳng với luật ghi trong CLAUDE.md: *"đơn đang chờ duyệt thì sale KHÔNG xuất
// được QR cho khách"* — câu đó chỉ có nghĩa nếu lúc KHÔNG chờ duyệt thì sale CÓ xuất được.
// Và đường QR đời MỚI (phiếu gộp) đã chọn `payments:record` từ 24/09 (`taoPhieuGopAction`
// → `congDuongB(orderId, "payments:record")`, lưới `[QTD-W1]`). Đường cũ không sửa theo.
//
// ⚠️ LUẬT LƯỚI NÀY KHOÁ không phải là "quyền nào đúng" — mà là **giao diện và máy chủ phải
// hỏi CÙNG một quyền**. Lệch nhau thì hoặc nút sáng rồi ăn từ chối (lời hứa suông), hoặc —
// tệ hơn, như ca này — nút không được vẽ và người dùng không có gì để bấm, cũng không có
// câu nào giải thích. Luật 12.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ⚠️ Bỏ chú thích DÒNG trước, rồi mới khối. Đảo lại là sai: một dấu mở khối nằm bên trong
 * một chú thích `//` sẽ mở ra một khối GIẢ và nuốt mã thật tới dấu đóng kế tiếp (đo trên
 * `payments/_actions.ts`: 4.771 ký tự biến mất). Lưới khi đó soi bản mã THIẾU — yếu đi mà
 * vẫn xanh.
 */
function boChuThich(s: string): string {
  return s.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

const doc = (p: string) => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));

const QR_ACTIONS = doc("app/(admin)/admin/orders/_qr-actions.ts");
const BANG = doc("app/(admin)/admin/orders/_components/payment-requests-section.tsx");
const SEED = doc("prisma/seed-roles.ts");

/** Khối khai báo của một vai trong seed — cắt tới `code: "` kế tiếp. */
function khoiVai(ten: string): string {
  const i = SEED.indexOf(`code: "${ten}"`);
  if (i < 0) return "";
  const j = SEED.indexOf('code: "', i + 10);
  return SEED.slice(i, j > 0 ? j : SEED.length);
}

describe("[QRQ] cổng quyền xuất QR", () => {
  it("[QRQ-01] máy chủ hỏi payments:record — KHÔNG phải orders:manage", () => {
    expect(QR_ACTIONS).toContain('checkPermission("payments:record")');
    expect(
      QR_ACTIONS,
      "quay lại `orders:manage` ⇒ Sale và Kế toán cơ sở lại không xuất được QR",
    ).not.toContain('checkPermission("orders:manage")');
  });

  it("[QRQ-02] bảng đợt gác ô QR bằng ĐÚNG quyền đó", () => {
    expect(BANG).toMatch(/const canIssue = duocPhatPhieu &&/);
    expect(
      BANG,
      "gác bằng `canManage` (orders:manage) ⇒ ô QR biến mất với Sale, không một lời giải thích",
    ).not.toMatch(/const canIssue = canManage/);
  });

  it("[QRQ-03] Sale và Kế toán cơ sở CÓ payments:record (nền của bản vá)", () => {
    // Nếu seed đổi, bản vá mất nền và phải đọc lại — lưới phải đỏ chứ không im lặng.
    for (const vai of ["CENTER_SALES_CSM", "CENTER_ACCOUNTANT"]) {
      const k = khoiVai(vai);
      expect(k, `không tìm thấy vai ${vai} trong seed`).not.toBe("");
      expect(k, `${vai} mất \`payments:record\` ⇒ họ lại không xuất được QR`).toContain(
        '"payments:record"',
      );
    }
  });

  it("[QRQ-04] ĐỐI CHỨNG DƯƠNG — vai quản lý KHÔNG mất quyền sau bản vá", () => {
    // Ca "Sale thấy nút" một mình vẫn ĐẠT khi ai đó nới cổng thành `true`. Ca này khoá
    // đầu còn lại: hai vai vốn xuất được QR phải vẫn có `payments:record`.
    for (const vai of ["HO_ACCOUNTANT", "CENTER_MANAGER"]) {
      expect(khoiVai(vai), `${vai} mất quyền xuất QR sau khi đổi cổng`).toContain(
        '"payments:record"',
      );
    }
  });

  it("[QRQ-06] nới quyền KHÔNG được làm mất cổng DUYỆT trên cùng đường đó", () => {
    // Chủ dự án chốt 02/10: *"nếu tạo đơn không cần qly duyệt thì cho xuất luôn, nếu cần
    // quản lý duyệt thì không cho đến khi nào quản lý duyệt thì cho xuất"*.
    //
    // Vế thứ hai VỐN ĐÃ CÓ (`guardIssuable` → `lyDoChuaDuyetQr`), và nó độc lập với quyền.
    // Nhưng đây đúng là rủi ro của bản vá quyền: mở rộng ai đi được vào đường phát QR thì
    // cổng duyệt nằm trên đường ấy phải còn nguyên. Gỡ nó đi là sale phát mã cho đơn chưa
    // ai ký — mà cổng quyền thì vẫn xanh, không lỗi nào báo.
    const CORE = doc("app/(admin)/admin/orders/_qr-core.ts");
    expect(CORE, "guardIssuable không còn hỏi cổng duyệt").toContain("lyDoChuaDuyetQr(");
    // Và phải hỏi TRƯỚC khi trả về bất cứ thứ gì khác trong guard — nếu nó tụt xuống dưới
    // các nhánh `return` khác thì đơn chờ duyệt vẫn lọt ở một số trạng thái phiếu.
    const i = CORE.indexOf("function guardIssuable");
    expect(i).toBeGreaterThan(-1);
    const than = CORE.slice(i, CORE.indexOf("\n}", i));
    const viTriDuyet = than.indexOf("lyDoChuaDuyetQr(");
    expect(viTriDuyet, "guardIssuable không gọi cổng duyệt").toBeGreaterThan(-1);
    // Cổng duyệt phải đứng TRƯỚC mọi nhánh `return "<câu từ chối>"` khác. Tụt xuống dưới
    // là đơn chờ duyệt lọt qua ở những trạng thái phiếu mà nhánh trên đã trả lời xong.
    expect(
      than.slice(0, viTriDuyet),
      "có nhánh `return \"…\"` đứng TRƯỚC cổng duyệt — đơn chờ duyệt sẽ lọt",
    ).not.toMatch(/return\s+["'`]/);
  });

  it("[QRQ-05] cách ly cơ sở KHÔNG dựa vào cổng quyền này", () => {
    // Cổng hỏi không kèm target (quyền GLOBAL), nên vế chống rò giữa cơ sở phải nằm ở
    // `scopedDb` trong core. Gỡ `resolveActor` là mất vế đó mà cổng quyền vẫn xanh.
    expect(QR_ACTIONS).toContain("resolveActor(session.user.id)");
  });
});
