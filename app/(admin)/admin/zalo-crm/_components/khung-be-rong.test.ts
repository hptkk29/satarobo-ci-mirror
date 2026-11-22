// app/(admin)/admin/zalo-crm/_components/khung-be-rong.test.ts — LƯỚI GHIM MÃ NGUỒN cho
// BỀ RỘNG TỐI THIỂU của khung nhúng ZaloCRM. Khuôn: CLAUDE.md "Mẫu test: LƯỚI GHIM MÃ NGUỒN".
//
// 🔴 VÌ SAO — sự cố 17/09/2026, và nó hỏng CÂM theo kiểu tệ nhất: giao diện vẫn hiện, chỉ
// có dữ liệu là rỗng.
//
// Trong iframe, `window.innerWidth` là bề rộng của KHUNG chứ không phải của trình duyệt.
// Fork lấy đúng số đó:
//     frontend/src/composables/use-mobile.ts:5,13
//         const MOBILE_BREAKPOINT = 768;
//         isMobile.value = window.innerWidth < MOBILE_BREAKPOINT;
// Khung admin (sidebar ~256px + padding) làm một cửa sổ 1024 chỉ còn ~740px cho iframe
// ⇒ fork khởi động ở chế độ MOBILE. Ở chế độ đó:
//     frontend/src/views/ChatView.vue:651-653
//         onMounted(async () => { if (!isMobile.value) { await fetchZaloAccounts(); … } })
// TOÀN BỘ lượt nạp (nick · hội thoại · scope · socket) nằm trong nhánh desktop,
// `onMounted` chạy MỘT LẦN, và KHÔNG có `watch(isMobile)` nạp bù.
//
// ⇒ Khung hẹp lúc mở = KHÔNG BAO GIỜ nạp danh sách nick. Rộng ra sau đó thì giao diện
//   desktop hiện lên với dữ liệu RỖNG — đúng triệu chứng "Phạm vi xem 0 online · 0
//   offline" mà chủ dự án báo. Đo được: `/api/v1/zalo-accounts` gọi **0 trên 921** request.
//
// ⚠️ ĐÂY LÀ BÀI HỌC CHÍNH CỦA LƯỢT TRUY NÀY: tôi đã đo `getZaloScope` ở máy chủ ba lượt
// và lần nào cũng ĐÚNG — trong khi endpoint chưa từng được gọi. Câu hỏi đúng phải hỏi
// TRƯỚC là "đường này có được gọi không", rồi mới tới "nó trả về gì".
//
// Lưới này canh hai lớp CSS, vì gỡ lớp nào cũng đủ làm lỗi quay lại:
//   · `min-w-[900px]` trên iframe — vượt ngưỡng 768 với biên an toàn;
//   · `overflow-x-auto` ở khối bọc — giữ cho phần còn lại của trang admin không bị đẩy
//     ngang trên màn hẹp (chỉ ô này cuộn).
//
// ⚠️ Luật 11: neo hẹp, đếm số lần khớp, không dùng cờ `/s`. Đã cấy lại lỗi để chứng minh
// lưới đỏ — xem commit đi kèm.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DUONG_DAN = "app/(admin)/admin/zalo-crm/_components/zalocrm-frame.tsx";
const nguon = readFileSync(resolve(process.cwd(), DUONG_DAN), "utf8");

/** Ngưỡng mobile của fork. Đổi ở fork thì phải đổi cả ở đây VÀ ở `min-w-` của khung. */
const NGUONG_MOBILE_CUA_FORK = 768;

/**
 * ⚠️ Chỉ đếm trong `className="…"`, KHÔNG đếm cả tệp.
 *
 * Bản đầu của lưới này đếm toàn tệp và ĐỎ ngay trên mã đúng: chú thích giải thích bản vá
 * có nhắc nguyên văn `min-w-[900px]` và `overflow-x-auto`, nên mỗi chuỗi khớp 2 lần. Đây
 * đúng cái bẫy luật 11 cảnh báo — và nó đã cắn ba lần trong repo này.
 */
const CLASSNAME = /className="[^"]*"/g;
function demTrongClassName(mau: RegExp): number {
  return (nguon.match(CLASSNAME) ?? []).filter((c) => mau.test(c)).length;
}

describe("[ZC-KHUNG] khung nhúng phải rộng hơn ngưỡng mobile của fork", () => {
  it("iframe khai `min-w-[…px]`", () => {
    // Bản HỎNG cần bắt: `className="min-h-0 w-full flex-1 …"` — không có min-w, khung co
    // theo khối cha và tụt xuống dưới 768 trên laptop.
    expect(
      demTrongClassName(/min-w-\[\d+px\]/),
      `${DUONG_DAN}: iframe phải có \`min-w-[…px]\` — thiếu nó fork khởi động ở chế độ mobile`,
    ).toBe(1);
  });

  it(`bề rộng tối thiểu phải LỚN HƠN ${NGUONG_MOBILE_CUA_FORK}px`, () => {
    // Vế mà "có khai" không đủ: khai `min-w-[400px]` thì tệp vẫn qua ca trên mà vẫn hỏng.
    const cls = (nguon.match(CLASSNAME) ?? []).find((c) => /min-w-\[\d+px\]/.test(c)) ?? "";
    const m = /min-w-\[(\d+)px\]/.exec(cls);
    expect(m, `${DUONG_DAN}: không đọc được số trong \`min-w-[…px]\``).not.toBeNull();
    const rong = Number(m![1]);
    expect(
      rong,
      `${DUONG_DAN}: min-w = ${rong}px, không vượt ngưỡng mobile ${NGUONG_MOBILE_CUA_FORK}px ` +
        `của fork (use-mobile.ts) ⇒ ChatView bỏ qua fetchZaloAccounts`,
    ).toBeGreaterThan(NGUONG_MOBILE_CUA_FORK);
  });

  it("khối bọc có `overflow-x-auto` để trang admin không bị đẩy ngang", () => {
    // Thiếu vế này thì bề rộng tối thiểu đẩy CẢ TRANG giãn ra trên màn hẹp — sửa một lỗi
    // bằng cách đẻ một lỗi khác, và lần này người dùng thấy ngay.
    expect(
      demTrongClassName(/overflow-x-auto/),
      `${DUONG_DAN}: khối bọc iframe phải có \`overflow-x-auto\``,
    ).toBe(1);
  });
});
