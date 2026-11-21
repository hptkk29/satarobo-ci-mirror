// lib/finance/khoan-bi-bo-loc.luoi.test.ts — LƯỚI GHIM MÃ NGUỒN (mẫu ở CLAUDE.md).
//
// ─── LUẬT CẦN KHOÁ ───────────────────────────────────────────────────────────
// "Danh sách khoản chờ gắn ghi danh phải tra bằng điều kiện MỞ — khoản chưa gắn hiện ra
//  BẤT KỂ marker nào sinh ra nó."
//
// Test thuần KHÔNG chứng minh được luật này, và đó không phải lời phàn nàn mà là chính
// hình dạng con bug: `vuongMacCuaKhoan` có thể xanh 100% với mọi khoản cổng thanh toán
// trong khi màn hình vẫn trắng trơn — vì thứ sai nằm ở `where` của một câu Prisma, tức
// ở DỮ LIỆU ĐƯỢC KÉO VỀ, chứ không ở giá trị trả về của bất kỳ hàm nào. Cho ăn thủ công
// một khoản `[auto:payos:*]` rồi khẳng định nó "hiện" là kiểm cổng chứ không kiểm hệ
// thống (luật 9): trên đường thật, khoản đó chưa từng tới được cổng.
//
// ─── MÃ TRƯỚC BẢN VÁ ─────────────────────────────────────────────────────────
//   where: {
//     deletedAt: null,
//     accountantStatus: "PENDING",
//     note: { contains: BACKFILL_PAYMENT_MARKER },   // ← CHỈ khoản nhập từ Excel
//   },
//   const plan = lapKeHoachXacNhan(rows as unknown as BackfillCandidate[], actorId);
//   const chon = chonGhiDanhChoKhoan(hvId ? (theoHocVien.get(hvId) ?? []) : []);
//
// ─── ⚠️ BẪY CỦA CHÍNH LƯỚI NÀY (luật 11) ─────────────────────────────────────
// Khối chú thích ngay trên ĐANG CHỨA đúng chuỗi mà lưới đi cấm, và bản vá trong
// `_actions.ts` cũng chép lại dòng cũ để giải thích. Một lưới ngây thơ vì thế XANH VĨNH
// VIỄN dù mã bị hoàn nguyên. Nên mọi phép so ở đây chạy trên bản ĐÃ BÓC CHÚ THÍCH, và
// `[KBB-00]` tự kiểm cái bóc đó trước — lưới không tự chứng minh được mình thì vô dụng.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ⚠️ `import.meta.url` trong cấu hình vitest của repo này KHÔNG phải URL `file://`
// (fileURLToPath ném) — dùng `process.cwd()`. Xem CLAUDE.md mục "LƯỚI GHIM MÃ NGUỒN".
const ACTIONS = "app/(admin)/admin/payments/_actions.ts";
const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/** Bỏ mọi DÒNG chỉ có chú thích. Giữ nguyên số dòng để lỗi còn chỉ đúng chỗ. */
function bocChuThich(src: string): string {
  return src
    .split("\n")
    .map((d) => {
      const t = d.trimStart();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : d;
    })
    .join("\n");
}

/** Thân của một `export async function <ten>` — tới `export` cấp cao kế tiếp. */
function thanHam(src: string, ten: string): string {
  const dau = src.indexOf(`export async function ${ten}`);
  if (dau < 0) return "";
  const sau = src.indexOf("\nexport ", dau + 1);
  return sau < 0 ? src.slice(dau) : src.slice(dau, sau);
}

const SACH = bocChuThich(doc(ACTIONS));
const THAN = thanHam(SACH, "khoanBiBoAction");

describe("[KBB-00] lưới phải tự chứng minh cái bóc chú thích có làm việc", () => {
  it("tìm được thân hàm", () => {
    expect(THAN.length, "không thấy khoanBiBoAction trong _actions.ts").toBeGreaterThan(500);
  });

  it("bản đã bóc KHÔNG còn câu giải thích bản vá", () => {
    // Câu này chỉ tồn tại trong chú thích. Còn thấy nó ⇒ bộ bóc hỏng ⇒ mọi khẳng định
    // dưới đây đang đọc cả chú thích và xanh giả.
    expect(SACH).not.toContain("BẢN VÁ 14/09/2026");
    expect(SACH).not.toContain("TRƯỚC ĐÂY Ở ĐÂY CHỈ CÓ MỘT DÒNG");
  });
});

describe("[KBB-01] câu tra phải MỞ — khoản chưa gắn hiện ra bất kể marker", () => {
  it("có vế `enrollmentId: null` nằm TRONG một nhánh OR", () => {
    // Không dùng cờ /s: giữ phép khớp trong phạm vi vài dòng liền nhau của mảng OR,
    // kẻo nó vắt qua nửa hàm rồi khớp bừa hai mảnh chẳng liên quan.
    expect(THAN, "thiếu nhánh OR chứa enrollmentId: null — đúng hình dạng bug cũ").toMatch(
      /OR:\s*\[[^\]]*\{\s*enrollmentId:\s*null\s*\}/,
    );
  });

  it("vế backfill VẪN còn — đây là vế MỞ THÊM, không phải vế THAY", () => {
    // Thay hẳn cũng là một cách "sửa", và nó giấu mất đúng nhóm màn sinh ra để phục vụ:
    // khoản nhập Excel đã gắn lớp nhưng vướng cổng tách nhiệm vụ.
    expect(THAN).toMatch(/\{\s*note:\s*\{\s*contains:\s*BACKFILL_PAYMENT_MARKER\s*\}\s*\}/);
  });

  it("đúng MỘT vế enrollmentId trong cả thân hàm-tra", () => {
    // Đếm số lần khớp (luật 11): hai vế `enrollmentId: null` nghĩa là ai đó vừa mở ở
    // `OR` vừa để lại một vế cứng ở `where` — và vế cứng thì lọc sạch nhóm backfill.
    const n = (THAN.match(/enrollmentId:\s*null/g) ?? []).length;
    expect(n, "số vế `enrollmentId: null` trong khoanBiBoAction").toBe(1);
  });

  it("loại cứng ADJUSTMENT + số âm ngay ở tầng DB", () => {
    expect(THAN).toMatch(/paymentType:\s*"PAYMENT"/);
    expect(THAN).toMatch(/amount:\s*\{\s*gt:\s*0\s*\}/);
  });
});

describe("[KBB-02] lý do phải tính bằng luật của DANH SÁCH, không phải luật của lượt hàng loạt", () => {
  it("thân hàm gọi vuongMacCuaKhoan", () => {
    expect(THAN).toMatch(/vuongMacCuaKhoan\(/);
  });

  it("KHÔNG còn gọi lapKeHoachXacNhan trong hàm này", () => {
    // Mở `where` mà vẫn hỏi `nenXacNhanHangLoat` cho mọi dòng thì khoản cổng hiện ra với
    // lý do "Không phải khoản nhập liệu ban đầu" — đúng chữ, và bảo người dùng rằng ở
    // đây không có việc gì để làm. Đó là bug thứ hai đội lốt bản vá.
    expect(THAN).not.toMatch(/lapKeHoachXacNhan\(/);
    // Nhưng hàm xác nhận hàng loạt thì VẪN phải dùng nó — nếu không, lưới này đang mừng
    // vì một thứ bị xoá nhầm.
    expect(SACH, "xacNhanHangLoat mất lapKeHoachXacNhan").toMatch(/lapKeHoachXacNhan\(/);
  });

  it("select có paymentType — thiếu là nhánh loại cứng chết câm", () => {
    // `vuongMacCuaKhoan` đọc `p.paymentType`; không `select` thì nó là `undefined`, so
    // với "ADJUSTMENT" ra false, và lưới loại bút toán điều chỉnh im lặng không tồn tại.
    expect(THAN).toMatch(/paymentType:\s*true/);
  });
});

describe("[KBB-03] màn KHÔNG được bày nút Gắn cho khoản đã gắn — luật 12", () => {
  it("mucGanChoKhoan nhận daGanGhiDanh lấy từ chính dòng khoản", () => {
    // Trước bản vá là `chonGhiDanhChoKhoan(ghi danh của em)` — khoản ĐÃ gắn mà em học một
    // lớp ra CHAC_CHAN ⇒ ô chọn + nút "Gắn" ⇒ `ganGhiDanhChoKhoanAction` từ chối. Lời hứa
    // suông: không test nào đỏ, console vẫn sạch, chỉ người bấm mới biết.
    expect(THAN).toMatch(/mucGanChoKhoan\(\{/);
    expect(THAN).toMatch(/daGanGhiDanh:\s*!!r\.enrollmentId/);
  });

  it("dòng lý do đi qua dongVuongMac — nhãn nguồn phải tới được màn hình", () => {
    // `KhoanBiBoView.lyDo` là trường DUY NHẤT màn đang vẽ. Tính nhãn nguồn rồi để trong
    // một trường không ai render là đúng hình dạng bug "số tính xong rồi không đi đâu cả".
    expect(THAN).toMatch(/lyDo:\s*dongVuongMac\(/);
  });
});
