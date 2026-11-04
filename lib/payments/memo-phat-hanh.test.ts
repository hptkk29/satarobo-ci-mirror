// Ca [MPH-*] — chọn khuôn memo lúc phát hành QR, theo công tắc.
//
// Hai loại ca, và ranh giới giữa chúng là chủ ý: phép CHỌN là hàm thuần nên kiểm được mọi
// nhánh; phần ĐỌC CẤU HÌNH chạm DB nên kiểm bằng LƯỚI GHIM MÃ NGUỒN (CLAUDE.md) — luật ở đây
// đúng dạng "lời gọi này phải truyền tham số kia", thứ mà test hành vi không chứng minh được.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chonKhuonMemo } from "./memo-phat-hanh";
import { sinhMa } from "./ma-phieu";

const MA = sinhMa(42);

describe("[MPH-01] phép chọn khuôn", () => {
  it("cờ BẬT + có mã mới ⇒ khuôn MỚI", () => {
    expect(chonKhuonMemo({ bat: true, maMoi: MA })).toBe("MOI");
  });

  it("cờ TẮT ⇒ khuôn CŨ, dù có mã mới", () => {
    expect(chonKhuonMemo({ bat: false, maMoi: MA })).toBe("CU");
  });

  it("cờ BẬT nhưng phiếu CHƯA có mã ⇒ khuôn CŨ", () => {
    // Bật cờ không làm phiếu cũ mọc mã ra. Thiếu vế này thì mọi phiếu sinh trước lúc bật sẽ in
    // một memo có chỗ của mã bỏ trống — tức một QR không khớp được gì.
    for (const x of [null, undefined, ""]) {
      expect(chonKhuonMemo({ bat: true, maMoi: x }), JSON.stringify(x)).toBe("CU");
    }
  });
});

describe("[MPH-02] LƯỚI: đường phát hành phải HỎI công tắc, và hỏi theo CƠ SỞ", () => {
  const src = () =>
    readFileSync(resolve(process.cwd(), "lib/payments/memo-phat-hanh.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(/\r?\n/)
      .map((d) => d.replace(/\/\/[^\n]*$/, ""))
      .join("\n");

  it("gọi `laThuTienLinhHoatBat` và TRUYỀN `orgUnitId`", () => {
    // Bỏ tham số đó thì hàm vẫn chạy, vẫn trả memo, vẫn xanh mọi test — chỉ có công tắc riêng
    // từng cơ sở tàng hình. Đã đo đúng lớp lỗi này ở `lib/finance/feature.ts` hôm nay.
    const goi = src().match(/laThuTienLinhHoatBat\(\s*input\.orgUnitId/g) ?? [];
    expect(goi).toHaveLength(1);
  });

  it("nhánh CŨ delegate sang `noiDungCkCoKhoa`, KHÔNG tự dựng chuỗi", () => {
    // Dựng lại khuôn cũ tại chỗ là đẻ bản sao thứ hai của phép chia ngân sách 25 ký tự — và hai
    // bản sao sẽ lệch nhau ở đúng ngày ai đó sửa một bên.
    expect(src()).toContain("noiDungCkCoKhoa(");
  });

  it("KHÔNG đụng `matchKey` của phiếu đã có (bất biến #3)", () => {
    // Hàm này chỉ chọn khuôn cho QR SẮP IN. Một phép gán `matchKey =` ở đây nghĩa là mã của
    // phiếu đang sống bị viết lại, và mọi ảnh QR phụ huynh đang giữ thành không khớp được.
    expect(/matchKey\s*[:=]\s*(?!input)/.test(src())).toBe(false);
  });
});
