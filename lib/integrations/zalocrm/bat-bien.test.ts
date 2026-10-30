// @vitest-environment node
/**
 * BẤT BIẾN CỦA TRỤC ZALOCRM — bản song sinh của `tests/goi-dien/bat-bien.test.ts:253-299` (OmiCall — đã gỡ 06/10/2026).
 *
 * Bộ này KHÔNG chạy hàm nào. Nó đọc MÃ NGUỒN dạng chuỗi và khẳng định bảy bước của
 * webhook xuất hiện ĐÚNG THỨ TỰ. Vì sao phải làm kiểu kỳ lạ đó: thứ tự chính là phần
 * quan trọng nhất của khuôn, mà không có test nào chạy-thật bắt được việc ai đó
 * chuyển `rateLimit` xuống sau `req.text()` — mã vẫn chạy, vẫn xanh, chỉ là cửa đã
 * mở. Đây là thứ DUY NHẤT giữ thứ tự khỏi trôi khi người sau sửa file.
 *
 * Hai bài học đã trả giá ở bản trục gọi, giữ nguyên ở đây:
 *  · phải cắt từ chỗ ĐỊNH NGHĨA hàm trở đi — thứ tự cần canh là thứ tự GỌI, không
 *    phải thứ tự khai (`kiemChuKy` khai phía trên nhưng được gọi ở bước 5);
 *  · phải lọc dòng chú thích, nếu không test tự bắt chính lời giải thích của mình.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const doc = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Bỏ dòng bình luận để test không tự bắt chính lời giải thích của mình. */
const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return (
        !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") && !t.startsWith("///")
      );
    })
    .join("\n");

const WH_FULL = chiMa(doc("lib/integrations/zalocrm/webhook.ts"));
const WH = WH_FULL.slice(WH_FULL.indexOf("export async function xuLyWebhookZalocrm"));

describe("Webhook ZaloCRM — bảy bước, đúng thứ tự", () => {
  it("có đủ 7 bước, ĐÚNG THỨ TỰ", () => {
    const buoc = [
      "rateLimit(", //          1. giới hạn tần suất — KÈM org trong khoá
      "content-length", //      2. chặn thân quá lớn TRƯỚC khi đọc
      "traCauHinhOrg", //       3. tra org + bí mật (fail-closed)
      "req.text()", //          4. đọc thân thô ĐÚNG MỘT LẦN
      "kiemChuKyZalocrm", //    5. HMAC bắt buộc
      "logWebhookDelivery(", // 6. ghi vết TRƯỚC khi xử lý
      "markWebhookDelivery(", // 7. đánh dấu kết quả
    ];
    let truoc = -1;
    for (const b of buoc) {
      const i = WH.indexOf(b);
      expect(i, `thiếu bước: ${b}`).toBeGreaterThan(-1);
      expect(i, `sai thứ tự tại: ${b}`).toBeGreaterThan(truoc);
      truoc = i;
    }
  });

  it("đọc thân thô ĐÚNG MỘT LẦN — chữ ký tính trên chính chuỗi đã đọc", () => {
    // Đọc hai lần thì lần thứ hai trả rỗng (stream đã tiêu), và chữ ký tính trên
    // chuỗi rỗng sẽ khớp với... không gì cả. Triệu chứng là 401 ngẫu nhiên.
    expect((WH.match(/req\.text\(\)/g) ?? []).length).toBe(1);
  });

  it("tra cấu hình org XONG rồi mới đọc thân — HMAC cần biết khoá của org nào", () => {
    expect(WH.indexOf("traCauHinhOrg")).toBeLessThan(WH.indexOf("req.text()"));
  });
});

describe("Những nhánh KHÔNG được chép từ OmiCall", () => {
  const CA_TEP = chiMa(doc("lib/integrations/zalocrm/webhook.ts"));

  it("KHÔNG có nhánh fail-open 'không có secret thì cho qua'", () => {
    // `lib/calls/webhook.ts:79` (OmiCall — đã gỡ 06/10/2026) — `if (!secret) return { ok: true };` — là ngoại lệ
    // riêng của OmiCall (chưa biết nhà cung cấp có ký hay không). Chép sang đây là
    // webhook nhận mọi payload của người lạ rồi ghi thẳng vào hộp thư + dòng thời
    // gian lead.
    expect(CA_TEP).not.toMatch(/!secret\s*\)\s*return\s*\{\s*ok:\s*true/);
    expect(CA_TEP).not.toMatch(/chế độ stub/i);
  });

  it("chữ ký RỖNG cũng bị từ chối — không chỉ chữ ký SAI", () => {
    expect(CA_TEP).toContain("401");
    // Có nhánh xử lý header vắng/rỗng chứ không chỉ so chuỗi.
    expect(CA_TEP).toMatch(/header[\s\S]{0,200}(trim\(\)|!header)/);
  });

  it("dùng `safeEqual` dùng chung, KHÔNG đẻ bản so sánh thứ tư", () => {
    // Repo đã có ba bản `safeEqual` song song (`lib/security/safe-equal.ts`, bản sao
    // trong `lib/lead/webhook.ts`, bản inline trong `lib/crm/meta-webhook.ts`).
    expect(CA_TEP).toContain('from "@/lib/security/safe-equal"');
    expect(CA_TEP).not.toMatch(/timingSafeEqual/);
  });

  it("có nhánh 5xx cho lỗi HẠ TẦNG — không phải luôn 200 như OmiCall", () => {
    expect(CA_TEP).toMatch(/httpStatus:\s*5\d\d/);
  });

  it("có nhánh 200 cho lỗi NGHIỆP VỤ — không bắt bên gửi retry vô ích", () => {
    expect(CA_TEP).toMatch(/httpStatus:\s*200/);
  });
});

describe("Quyết định đã chốt, ghim bằng chuỗi trong mã", () => {
  const CA_TEP = chiMa(doc("lib/integrations/zalocrm/webhook.ts"));
  const DICH = chiMa(doc("lib/integrations/zalocrm/dich-payload.ts"));

  it("`source` của WebhookDelivery mang org — KHÔNG dùng lại tên 'zalo'", () => {
    // `"zalo"` đã bị webhook Zalo OA chiếm (`lib/lead/webhook.ts:21`); trộn hai nguồn
    // là báo cáo và màn Replay đọc nhầm nhà cung cấp.
    expect(CA_TEP).toMatch(/`zalocrm:\$\{org\}`|"zalocrm:" \+ org/);
    expect(CA_TEP).not.toMatch(/source:\s*"zalo"/);
  });

  it("khoá rate-limit kèm org, trần 600/phút", () => {
    expect(CA_TEP).toMatch(/webhook:zalocrm:\$\{org\}/);
    // Con số ở một hằng có tên chứ không gõ tại chỗ — nhưng vẫn phải ghim, vì hạ nó
    // xuống mức của OMICall (120) là làm nghẹt đúng giờ cao điểm của một nick.
    expect(CA_TEP).toMatch(/TRAN_MOI_PHUT\s*=\s*600/);
    expect(CA_TEP).toMatch(/max:\s*TRAN_MOI_PHUT/);
  });

  it("`channelMessageId` mang tiền tố org (chốt 1) — ghim ngay trong bảng dịch", () => {
    // Khoá chống trùng `@@unique([channel, channelMessageId])` KHÔNG kèm accountId:
    // bỏ tiền tố là tin của org sau bị NUỐT IM LẶNG.
    expect(DICH).toMatch(/channelMessageId:\s*`\$\{orgCode\}:\$\{messageId\}`/);
  });

  it("`accountId` lấy từ nick, KHÔNG phải hằng 'zalocrm' (chốt 2)", () => {
    expect(DICH).toMatch(/accountId:\s*zcrmAccountId/);
    expect(DICH).not.toMatch(/accountId:\s*"zalocrm"/);
  });

  it("payload đi qua hàm đục TRƯỚC khi vào `logWebhookDelivery` (chốt 8)", () => {
    const i = CA_TEP.indexOf("logWebhookDelivery(");
    const khoi = CA_TEP.slice(i, i + 400);
    expect(khoi).toMatch(/payload:\s*ducPayload\(/);
  });

  it("hội thoại NHÓM bị loại ngay ở tầng dịch (chốt 9.6)", () => {
    expect(DICH).toMatch(/laNhom\(/);
    expect(DICH).toMatch(/HOI_THOAI_NHOM/);
  });
});

describe("Vỏ HTTP giữ nguyên khuôn 'mỏng'", () => {
  const ROUTE = chiMa(doc("app/api/webhooks/zalocrm/[org]/route.ts"));

  it("cờ tính năng OFF ⇒ 404 (chưa bật thì không lộ ra rằng địa chỉ này có thật)", () => {
    expect(ROUTE).toMatch(/isZalocrmEnabled\(\)/);
    expect(ROUTE).toMatch(/status:\s*404/);
  });

  it("`params` được await — Next 16 trả Promise", () => {
    expect(ROUTE).toMatch(/await params/);
  });

  it("runtime nodejs + force-dynamic (cần crypto/Prisma, không được cache)", () => {
    expect(ROUTE).toMatch(/runtime = "nodejs"/);
    expect(ROUTE).toMatch(/dynamic = "force-dynamic"/);
  });

  it("KHÔNG có logic trong vỏ — chỉ gọi hàm rồi trả kết quả", () => {
    // Rate-limit/chữ ký/ghi vết nằm ở `webhook.ts` để test bất biến canh được thứ tự.
    // Kéo một bước lên route (như webhook Messenger đang làm) là mất lưới đó.
    expect(ROUTE).not.toMatch(/rateLimit\(/);
    expect(ROUTE).not.toMatch(/createHmac/);
    expect(ROUTE.split("\n").filter((l) => l.trim()).length).toBeLessThan(30);
  });
});

describe("Ranh giới module (đặc tả §5 — mọi thứ chạm mạng sau một hàm thuần)", () => {
  it("`dich-payload.ts` và `duc-payload.ts` KHÔNG chạm DB / server-only", () => {
    for (const f of ["dich-payload.ts", "duc-payload.ts"]) {
      const src = doc(`lib/integrations/zalocrm/${f}`);
      expect(src, f).not.toMatch(/from "@\/lib\/db"/);
      expect(src, f).not.toMatch(/^import "server-only"/m);
    }
  });

  it("KHÔNG file nào của lô chạm thẳng `db.inbox*` (lưới `cong-truy-cap.test.ts`)", () => {
    // Ba bảng `Inbox*` mang `orgUnitId` chứ không `centerId` ⇒ `scopedDb` KHÔNG che
    // chúng. Truy vấn thẳng từ đây là thấy hội thoại của MỌI cơ sở.
    for (const f of ["webhook.ts", "nap-su-kien.ts", "dich-payload.ts", "client.ts"]) {
      const src = chiMa(doc(`lib/integrations/zalocrm/${f}`));
      expect(src, f).not.toMatch(/\b\w+\.(inboxConversation|inboxMessage|inboxIdentity)\b/);
    }
  });

  it("`client.ts` tự đặt hạn giờ — repo KHÔNG có HTTP client dùng chung", () => {
    const src = chiMa(doc("lib/integrations/zalocrm/client.ts"));
    expect(src).toMatch(/AbortController/);
    expect(src).toMatch(/clearTimeout/);
  });

  it("mọi truy vấn `ZaloCrm*` đều tự thêm `deletedAt: null`", () => {
    // Hai bảng này CÓ `deletedAt` nhưng KHÔNG nằm trong `SOFT_DELETE_MODELS`
    // (`lib/soft-delete.ts`) ⇒ không có lưới tự động nào thêm hộ điều kiện đó.
    const src = chiMa(doc("lib/integrations/zalocrm/nap-su-kien.ts"));
    const truyVan = [...src.matchAll(/db\.zaloCrm(Nick|Thread)\.(findFirst|findMany|findUnique)\(\{[\s\S]{0,400}?\}\)/g)];
    expect(truyVan.length, "không thấy truy vấn ZaloCrm* nào — regex đã mục?").toBeGreaterThan(0);
    for (const m of truyVan) {
      expect(m[0], `truy vấn thiếu deletedAt: ${m[0].slice(0, 90)}`).toMatch(/deletedAt/);
    }
  });
});
