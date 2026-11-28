import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ── Luật: THAM SỐ CÓ MẶC ĐỊNH NGUY HIỂM THÌ BỎ MẶC ĐỊNH ─────────────────────
//
// `docs/luat-doc-so-va-ket-luan.md`: *tham số có mặc định nguy hiểm (gửi tin · ghi tiền ·
// giao bài · xoá · mở rộng phạm vi nhìn) thì bỏ mặc định — để `tsc` liệt kê call site,
// vì mắt thấy 2 chỗ mà trình biên dịch thấy 6. Mặc định của SCOPE phải fail-closed,
// không bao giờ là "ALL".*
//
// Hai chỗ dưới đây đã vá 08/09/2026. Ca test này canh chúng KHÔNG quay lại — thêm lại
// một dấu `?` hay một `?? "NOW"` là chuyện của một dòng, và `tsc` sẽ IM LẶNG cho qua vì
// mọi call site hiện tại vẫn truyền đủ. Chính vì thế nó cần một ca canh riêng.
//
// ⚠️ Tại sao là test VĂN BẢN chứ không phải test hành vi: hành vi sau khi vá KHÔNG đổi —
// mọi call site vốn đã truyền đủ đối số, `tsc` xanh ngay lần đầu. Thứ đã đổi là **hợp
// đồng của hàm**, và hợp đồng chỉ đọc được ở chữ ký.

const GOC = join(__dirname, "..");
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");

describe("assignHomeworkForSession — assignMode BẮT BUỘC", () => {
  const src = doc("lib/lms/assignment.ts");

  // `NOW` = giao bài NGAY và bắn thông báo cho phụ huynh NGAY. Là mặc định của một tham
  // số tuỳ chọn, nó nghĩa là: call site mới quên một dòng ⇒ tin nhắn bay tới phụ huynh,
  // không lỗi, không cảnh báo.
  it("KHÔNG còn `assignMode?` ở chữ ký", () => {
    expect(src).toContain("assignMode: AssignMode;");
    expect(src).not.toContain("assignMode?: AssignMode");
  });

  it('KHÔNG còn `opts.assignMode ?? "NOW"` — mặc định gửi tin phải biến mất hẳn', () => {
    // ⚠️ Bản đầu của ca này khẳng định file KHÔNG chứa chuỗi `?? "NOW"` — và nó đỏ ngay,
    // vì chính CHÚ THÍCH giải thích bản vá có nhắc lại chuỗi đó. Soi MÃ, không soi văn
    // xuôi: chỉ chuỗi có `opts.` phía trước mới là dòng lệnh.
    expect(src).not.toContain('opts.assignMode ?? "NOW"');
    expect(src).toContain("const assignMode: AssignMode = opts.assignMode;");
  });

  it("nói RÕ vì sao ngay tại chữ ký — hợp đồng không lời giải thích sẽ bị 'dọn' lại", () => {
    // ⚠️ Bản đầu dùng `indexOf("assignMode: AssignMode;")` — nó bắt trúng chữ ký của
    // `computeHomeworkDueAt` ở TRÊN, không phải chỗ vừa vá. Neo bằng chính câu chú thích
    // rồi kiểm chữ ký nằm NGAY SAU nó.
    expect(src).toMatch(
      /KHÔNG có mặc định[\s\S]{0,1400}?assignMode: AssignMode;/,
    );
  });
});

describe("lead-handover — visibleCenterIds BẮT BUỘC, không mặc định ALL", () => {
  const src = doc("lib/lead-handover/service.ts");

  // Mặc định `"ALL"` nghĩa là: call site mới quên một đối số ⇒ người của cơ sở này bàn
  // giao được lead của cơ sở kia, im lặng. Mặc định của scope phải fail-closed.
  it('KHÔNG còn `= "ALL"` ở bất kỳ chữ ký nào trong file', () => {
    expect(src).not.toMatch(/visibleCenterIds:\s*VisibleCenterIds\s*=\s*"ALL"/);
  });

  it("KHÔNG còn `visibleCenterIds?:` ở tham số của bulkReassignLeads", () => {
    expect(src).not.toContain("visibleCenterIds?: VisibleCenterIds");
  });

  it('KHÔNG còn `?? "ALL"` ở chỗ gọi resolveWhere', () => {
    expect(src).not.toContain('?? "ALL"');
  });

  it("nói RÕ vì sao — và nhắc service KHÔNG tự suy scope", () => {
    // Service không có `actor`, nên nó không thể tự tính tầm nhìn. Người gọi phải lấy
    // `getModelVisibleCenterIds("Lead", actor)` rồi truyền vào.
    expect(src).toContain("fail-closed");
    expect(src).toContain("getModelVisibleCenterIds");
  });
});
