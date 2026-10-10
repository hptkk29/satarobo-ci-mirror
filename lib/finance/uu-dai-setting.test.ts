// lib/finance/uu-dai-setting.test.ts — LƯỚI: chính sách ưu đãi chỉ đọc ở MỘT chỗ.
//
// Cùng khuôn `[FEAT-03]` của `lib/finance/feature.test.ts`, và cùng lý do: rải
// `getSetting("billing.sibling…")` khắp nơi là mỗi chỗ tự quyết định nghĩa của chính sách,
// và quản lý đổi một mức % sẽ đổi được 9 chỗ trong 10 — không lỗi nào báo.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTING_KEYS } from "@/lib/settings/registry";

/** Sáu khoá chính sách ưu đãi — suy từ REGISTRY, không chép tay. */
const KHOA_CHINH_SACH = SETTING_KEYS.filter(
  (k) => k.startsWith("billing.sibling") || k === "billing.lateDiscountAbsorb",
);

/** Nơi DUY NHẤT được đọc chúng, cộng hai tệp KHAI chúng. */
const DUOC_DOC = [
  "lib/finance/uu-dai-setting.ts",
  "lib/settings/registry.ts",
  "lib/settings/nhan-van-hanh.ts",
];

/**
 * Tệp ĐANG ĐƯỢC GIT THEO DÕI trong `lib/`+`app/` có chứa một trong sáu khoá — tìm bằng
 * `git grep`, KHÔNG nạp cả cây vào Node.
 *
 * ⚠️ Bản trước `git ls-files` rồi `readFileSync` TỪNG tệp. Đo 27/09/2026 sau lượt gộp
 * main→test: **2.231 tệp / 16,5 MB / 11,6 giây** — vượt hẳn trần 5s mặc định của vitest, và
 * ca này bắt đầu đỏ theo TẢI MÁY chứ không theo mã. Nâng trần là vá triệu chứng: phép quét
 * vẫn O(toàn bộ mã nguồn) và sẽ vượt lại ở lượt thêm tệp sau.
 *
 * `git grep -l -F` để chính git tìm: một tiến trình, không đọc tệp nào vào Node, và nó vẫn
 * chỉ soi tệp git THEO DÕI — giữ đúng bài học của `[FEAT-03]` (`readdirSync` cả cây thì bản
 * nháp của kịch bản cấy lỗi cũng vào danh sách và lưới đỏ theo thứ không nằm trong repo).
 *
 * `git grep` trả mã thoát **1 khi KHÔNG khớp gì** — đó là ca BÌNH THƯỜNG ở đây, nên phải
 * bắt lỗi và đọc `status`, không để `execFileSync` ném.
 */
function tepPham(khoa: readonly string[]): string[] {
  // KHÔNG cần cờ nào để loại tệp chưa theo dõi: `git grep` mặc định chỉ soi tệp git
  // THEO DÕI. (`--untracked` là cờ để THÊM chúng vào, và nó không nhận giá trị.)
  const args = ["grep", "-l", "-F"];
  for (const k of khoa) args.push("-e", `"${k}"`, "-e", `'${k}'`);
  args.push("--", "lib", "app");
  let ra: string;
  try {
    ra = execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    // 1 = không tệp nào khớp. Mọi mã khác là git thật sự lỗi ⇒ ném tiếp, đừng nuốt thành
    // "sạch" — một lưới im lặng khi hạ tầng hỏng tệ hơn không có lưới (luật 6).
    if (err.status !== 1) throw e;
    ra = err.stdout ?? "";
  }
  return ra
    .split(/\r?\n/)
    .filter((d) => /\.tsx?$/.test(d))
    .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
    .filter((d) => !DUOC_DOC.includes(d));
}

describe("[UDS] chính sách ưu đãi anh em — một nguồn đọc", () => {
  it("[UDS-01] sáu khoá chính sách đều CÓ TRONG registry", () => {
    // Ca chống TAUTOLOGY: `KHOA_CHINH_SACH` suy từ registry, nên đổi tên khoá mà quên sửa
    // tiền tố ở đây sẽ làm danh sách RỖNG và ca [UDS-02] xanh vĩnh viễn mà không quét gì.
    expect(KHOA_CHINH_SACH.sort()).toEqual([
      "billing.lateDiscountAbsorb",
      "billing.siblingAutoEnabled",
      "billing.siblingPercentSecond",
      "billing.siblingPercentThird",
      "billing.siblingStacksFullPay",
      "billing.siblingTarget",
    ]);
  });

  it("[UDS-02] không tệp nào ngoài `uu-dai-setting.ts` đọc sáu khoá đó", () => {
    const tep = tepPham(KHOA_CHINH_SACH);
    // In kèm KHOÁ nào bị đọc ở đâu, để người sửa không phải mở từng tệp dò.
    const pham = tep.flatMap((duong) => {
      const noiDung = readFileSync(resolve(process.cwd(), duong), "utf8");
      return KHOA_CHINH_SACH.filter(
        (k) => noiDung.includes(`"${k}"`) || noiDung.includes(`'${k}'`),
      ).map((k) => `${duong} → ${k}`);
    });
    expect(
      pham,
      `Chính sách ưu đãi phải đọc qua \`docChinhSachUuDai\`:\n  - ${pham.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("[UDS-03] `uu-dai-setting.ts` đọc ĐỦ sáu khoá, không thiếu khoá nào", () => {
    // Chiều ngược lại, và nó âm thầm: thêm một khoá chính sách vào registry mà quên đọc nó
    // trong hàm gom thì chính sách ấy KHÔNG BAO GIỜ có tác dụng — quản lý cài xong, không
    // đổi gì, và không lỗi nào báo. Đúng lớp lỗi câm mà cờ `PAYMENT_LEDGER_V2` đã dạy.
    const ma = readFileSync(resolve(process.cwd(), "lib/finance/uu-dai-setting.ts"), "utf8");
    const thieu = KHOA_CHINH_SACH.filter((k) => !ma.includes(`"${k}"`));
    expect(thieu, `Khoá khai trong registry mà không ai đọc:\n  - ${thieu.join("\n  - ")}`).toEqual(
      [],
    );
  });
});
