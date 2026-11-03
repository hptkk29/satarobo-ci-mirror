// [GLD-*] — LƯỚI GHIM MÃ NGUỒN cho đường ghi `VoucherRedemption` [28/09/2026].
//
// ── VÌ SAO KHÔNG PHẢI TEST THUẦN ─────────────────────────────────────────────────────
// Thứ cần khoá ở đây không phải một GIÁ TRỊ TRẢ VỀ mà là HÌNH DẠNG của mấy lời gọi
// Prisma: ghi lượt dùng có nằm trong cùng transaction với đơn không, phép tăng
// `usedCount` có điều kiện chống đua không, và thua đua thì `throw` hay `return`.
// Test thuần viết kiểu nào cũng xanh vì nó không chạm tới tầng ấy — đúng ca đã sinh ra
// mẫu "LƯỚI GHIM MÃ NGUỒN" trong CLAUDE.md (`[DS-01b]`).
//
// Bộ e2e R7 có chạm DB thật, nhưng nó không phân biệt được "đúng nhờ thiết kế" với "đúng
// nhờ may" — một lượt chạy tuần tự vẫn xanh với phép "đọc rồi so rồi ghi" (đua chỉ nổ khi
// có hai lượt cùng lúc). Lưới này khoá THIẾT KẾ; R7 khoá HÀNH VI.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Đọc mã nguồn, BỎ CHÚ THÍCH — chú thích giải thích bản vá thường chứa đúng chuỗi đang tìm. */
function boChuThich(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .map((d) => d.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

const ACTION = "app/(admin)/admin/orders/_actions.ts";

describe("[GLD-01] lượt dùng ghi TRONG transaction tạo đơn", () => {
  const ma = boChuThich(ACTION);

  it("có lời gọi `tx.voucherRedemption.create`", () => {
    // `tx.` chứ không `sdb.`/`db.`: ghi ngoài transaction là mở ca "đơn có giảm giá mà
    // không có dấu vết đã dùng mã", rồi `usedCount` không bao giờ đúng.
    expect(ma).toMatch(/tx\.voucherRedemption\.create\(/);
    expect(ma, "ghi lượt dùng NGOÀI transaction").not.toMatch(
      /(?:sdb|db)\.voucherRedemption\.create\(/,
    );
  });

  it("mang `orderItemId` — lượt dùng gắn theo DÒNG, không theo đơn", () => {
    expect(ma).toMatch(/orderItemId:\s*itemIds\[/);
  });

  it("số tiền ghi là SỐ THẬT đã trừ (`k.giam`), không phải số chương trình hứa", () => {
    // Ảnh chụp phải khớp tiền đã vào sổ. `gopGiamGia` kẹp khoản cuối theo phần còn lại
    // của dòng, nên "số chương trình hứa" và "số trừ được" lệch nhau ở ca biên.
    expect(ma).toMatch(/discountApplied:\s*k\.giam/);
  });
});

describe("[GLD-02] tăng `usedCount` phải CHỐNG ĐUA bằng điều kiện trong `where`", () => {
  const ma = boChuThich(ACTION);

  it("dùng `updateMany` có `usedCount: { lt: ... }`", () => {
    // 🔴 Đây là ca lưới này sinh ra để chặn. "Đọc `usedCount` → so với `quantity` → ghi"
    // xanh ở mọi lượt chạy tuần tự, và hỏng đúng lúc hai sale bán suất cuối cùng cùng
    // lúc: cả hai đọc 9 < 10, cả hai ghi, chương trình phát 11 suất.
    expect(ma).toMatch(/tx\.voucher\.updateMany\(/);
    expect(ma).toMatch(/usedCount:\s*\{\s*lt:/);
  });

  it("THUA ĐUA thì `throw`, KHÔNG `return`", () => {
    // Luật rollback của repo: trong callback `$transaction`, `return` KHÔNG rollback. Ở
    // đây đã ghi đơn + phiếu thu + lượt dùng rồi, nên `return` để lại một đơn hưởng ưu
    // đãi đã hết suất — và người dùng vẫn nhận thông báo từ chối.
    const khoi = ma.slice(ma.indexOf("updateMany"), ma.indexOf("updateMany") + 900);
    expect(khoi, "không thấy `throw` sau phép tăng có điều kiện").toMatch(
      /count === 0[\s\S]{0,200}throw/,
    );
    expect(khoi).not.toMatch(/count === 0[\s\S]{0,120}return\s*\{/);
  });

  it("`quantity == null` (không giới hạn) vẫn tăng, không bỏ qua", () => {
    // Bỏ qua là `usedCount` của mã không giới hạn đứng ở 0 mãi — con số "đã dùng" trên
    // màn quản trị thành vô nghĩa cho đúng nhóm mã hay dùng nhất.
    expect(ma).toMatch(/quantity == null[\s\S]{0,300}increment:\s*1/);
  });
});

describe("[GLD-03] trần theo NGƯỜI đọc `usageLimitPerUser`, và đứng TRƯỚC transaction", () => {
  const ma = boChuThich(ACTION);

  it("có đọc `usageLimitPerUser`", () => {
    // Cột này có từ đầu và tới 28/09 vẫn **0 nơi đọc** — một trần không ai đọc là một
    // trần không tồn tại: người vận hành khai "mỗi khách 1 lượt" rồi yên tâm nhầm.
    expect(ma).toMatch(/usageLimitPerUser/);
    expect(ma).toMatch(/voucherRedemption\.count\(/);
  });

  it("cổng nằm TRƯỚC `$transaction` — luật rollback: cổng đứng trước phép ghi đầu tiên", () => {
    const iTran = ma.indexOf("usageLimitPerUser");
    const iTx = ma.indexOf("$transaction");
    expect(iTran, "không tìm thấy phép đọc trần").toBeGreaterThan(0);
    expect(iTx, "không tìm thấy transaction").toBeGreaterThan(0);
    expect(iTran, "cổng trần theo người phải đứng TRƯỚC transaction").toBeLessThan(iTx);
  });
});

describe("[GLD-04] id dòng đơn sinh TRƯỚC, không đọc ngược sau khi tạo", () => {
  const ma = boChuThich(ACTION);

  it("`itemIds` sinh sẵn và được gán vào `id` của từng dòng", () => {
    // Prisma KHÔNG hứa thứ tự quan hệ đọc ra khớp thứ tự mảng đầu vào, và hai con học
    // CÙNG khoá là hai dòng giống hệt nhau — không ghép ngược được theo nội dung.
    expect(ma).toMatch(/const itemIds = data\.items\.map\(\(\) => randomUUID\(\)\)/);
    expect(ma).toMatch(/id:\s*itemIds\[i\]!/);
  });
});

describe("[GLD-05] DÂY NỐI CLIENT→SERVER: payload phải chở `voucherId`", () => {
  // 🔴 SỰ CỐ SINH RA CA NÀY [29/09/2026] — và nó là ca đắt nhất của cả đợt.
  //
  // Payload của form dựng bằng danh sách trường TƯỜNG MINH
  // (`kieu`/`giaTri`/`lyDo`/`loai`), nên `voucherId` mới thêm KHÔNG tự đi theo. Đo trên
  // đơn thật `ORD-260929-000001`: màn hình hiện đúng "SR.QD.240 · FULL4HP15
  // −1.584.000đ", `lyDo` vào DB đúng câu tự sinh, **mà `discounts[].voucherId` là `null`
  // và `VoucherRedemption` 0 dòng**. Toàn bộ phần ghi lượt dùng CÂM HOÀN TOÀN.
  //
  // ⚠️ VÌ SAO MẮT KHÔNG THẤY: câu `lyDo` do CLIENT tính cũng bằng chữ mà server sẽ tính,
  // nên nhánh "không tìm thấy mã" của server cho ra bản ghi trông Y HỆT bản đúng. Không
  // lỗi, không cảnh báo, không ca test nào đỏ — đúng họ "cột ghi mà không ai đọc", lần
  // này là "cột đọc mà không ai ghi".
  //
  // Bài học: **một trường mới đi qua ranh giới client→server thì phải ghim DÂY NỐI**,
  // vì test hành vi hai đầu đều xanh khi khúc giữa đứt.
  const form = boChuThich("app/(admin)/admin/orders/_components/order-create-form.tsx");

  it("payload `discounts` có `voucherId`", () => {
    expect(form).toMatch(/voucherId:\s*k\.voucherId\s*\?\?\s*null/);
  });

  it("validator nhận `voucherId` — hai đầu phải cùng biết về trường này", () => {
    const val = boChuThich("lib/validators/order.ts");
    expect(val).toMatch(/voucherId:\s*z\.string\(\)/);
  });

  it("server ĐỌC `k.voucherId` để tra mã, không chỉ chở qua", () => {
    const ma = boChuThich(ACTION);
    expect(ma).toMatch(/\.map\(\(k\) => k\.voucherId\)/);
    expect(ma).toMatch(/maTheoId\.get\(k\.voucherId\)/);
  });

  it("chưa chọn mã ⇒ form CHẶN, không lặng lẽ vứt khoản", () => {
    // Payload lọc `giaTri > 0`, mà khoản chưa chọn mã có `giaTri = 0` ⇒ rụng im lặng:
    // sale bấm Lưu, đơn lưu với giá NGUYÊN, ưu đãi bốc hơi không một lời.
    expect(form).toMatch(/k\.voucherId === ""/);
    expect(form).toMatch(/Chưa chọn chương trình khuyến mãi/);
  });
});
