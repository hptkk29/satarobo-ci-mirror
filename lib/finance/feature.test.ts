// Ca [FEAT-*] — công tắc thu học phí linh hoạt. Phủ TS-07 (US-05/AC3) và pre-mortem T8.
//
// T8 xếp "cờ bật tính năng là cờ chết" vào nhóm CHẶN GO-LIVE, với bằng chứng: `PAYMENT_LEDGER_V2`
// có trong mã, 0 đường gọi thật, không có trong 40 biến env prod. Nên bộ này canh HAI thứ khác
// nhau: phép giải cờ đúng, VÀ không ai đọc cờ ngoài một chỗ.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { giaiCongTac, KHOA_CONG_TAC } from "./feature";

/**
 * Trần cho ca QUÉT CẢ CÂY — cùng con số và cùng lý do với `ghi-nhan.test.ts`.
 *
 * ⚠️ ĐẶT VÌ MỘT PHÉP ĐO, không phải vì phòng xa: chạy cả bộ với RBAC bật, ca này ĐỎ 2/5 lượt
 * với `Test timed out in 5000ms`. Nó đọc ~1.400 tệp trong khi các worker khác đang giành đĩa,
 * nên 5s chưa bao giờ là ngân sách đúng cho nó.
 *
 * ⚠️ Và tôi đã CHẨN ĐOÁN SAI nó một lần — gọi là "assertion thật, không phải hết giờ" vì chỉ
 * đọc dòng tóm tắt. Câu lỗi thật nằm ngay dưới và nó nói rõ "timed out". Đọc ĐỦ câu lỗi.
 *
 * Chạm 30s là tín hiệu THẬT (repo phình hoặc đĩa hỏng), không phải nhiễu.
 */
const TRAN_QUET_MS = 30_000;

describe("[FEAT-01] mặc định TẮT — prod không đổi hành vi khi merge", () => {
  it("toàn hệ tắt, cơ sở không khai gì ⇒ TẮT", () => {
    expect(giaiCongTac({ toanHe: false })).toBe(false);
  });

  it("khoá trong registry mặc định `false`", () => {
    // Đọc thẳng registry: một mặc định `true` lọt vào đây là bật tính năng cho toàn prod ngay
    // lần deploy kế tiếp, và không có màn nào báo.
    const src = readFileSync(resolve(process.cwd(), "lib/settings/registry.ts"), "utf8");
    const khoi = new RegExp(`"${KHOA_CONG_TAC}": def\\(\\{[^}]*?\\}\\)`, "s").exec(src)?.[0] ?? "";
    expect(khoi).toContain("default: false");
    expect(khoi).toContain("centerOverridable: true");
  });
});

describe("[FEAT-02] override của cơ sở chạy CẢ HAI chiều", () => {
  it("toàn hệ TẮT + cơ sở BẬT ⇒ bật (pilot một cơ sở)", () => {
    expect(giaiCongTac({ toanHe: false, coSo: true })).toBe(true);
  });

  it("toàn hệ BẬT + cơ sở TẮT ⇒ tắt (gỡ một cơ sở khi nó gặp sự cố)", () => {
    // Chiều này dễ bị bỏ vì "ai lại tắt một cơ sở". Nhưng đó đúng là việc cần làm khi một cơ sở
    // gặp sự cố: gỡ nó ra, không phải tắt cả nhà.
    expect(giaiCongTac({ toanHe: true, coSo: false })).toBe(false);
  });

  it("toàn hệ BẬT + cơ sở KHÔNG khai gì ⇒ bật", () => {
    expect(giaiCongTac({ toanHe: true })).toBe(true);
  });

  it("`undefined` (không khai) KHÁC `false` (khai tắt)", () => {
    // Gộp hai thứ này là làm mất khả năng gỡ một cơ sở — đúng ca vận hành mà công tắc riêng
    // sinh ra để phục vụ.
    expect(giaiCongTac({ toanHe: true, coSo: undefined })).toBe(true);
    expect(giaiCongTac({ toanHe: true, coSo: false })).toBe(false);
  });
});

/**
 * Bóc chú thích trước khi soi — lưới phải soi MÃ, không soi lời kể về mã.
 *
 * ⚠️ Ba chi tiết, cả ba đã trả giá trong đúng một ngày:
 *  · tách dòng bằng `/\r?\n/`, KHÔNG phải `"\n"` — nhiều tệp của repo là CRLF;
 *  · dùng `[^\n]*`, KHÔNG phải `.*` — trong JavaScript `.` KHÔNG khớp `\r`, nên regex gặp dòng
 *    còn `\r` là không khớp gì và hàm trả về NGUYÊN VĂN (sáng 16/09: một phép bóc y hệt bóc
 *    được 0 dòng và trông hệt như đang làm việc);
 *  · và chính chú thích "cờ không ở đây" trong `lib/flags.ts` CHỨA chuỗi khoá đang bị cấm —
 *    lưới đỏ vì một câu văn, không vì một đường gọi (chiều 16/09).
 */
function bocChuThich(v: string): string {
  return v
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/\/\/[^\n]*$/, ""))
    .join("\n");
}

describe("[FEAT-03] LƯỚI: không ai đọc cờ ngoài `lib/finance/feature.ts`", () => {
  /**
   * Mọi tệp `.ts`/`.tsx` ĐANG ĐƯỢC GIT THEO DÕI trong `lib/` và `app/`, bỏ test và bỏ chính
   * file công tắc.
   *
   * ⚠️ DÙNG `git ls-files`, KHÔNG `readdirSync` cả cây — chủ dự án chốt 17/09 sau khi ca này
   * ĐỎ MỘT LẦN rồi xanh lại ở ba lượt chạy sau, và tôi không bắt được danh sách tệp vi phạm.
   *
   * `readdirSync` đọc cây tệp SỐNG, trong lúc các worker vitest khác chạy song song. Bất cứ
   * tệp `.ts` nào xuất hiện thoáng qua dưới `lib/` hoặc `app/` — bản nháp của một kịch bản cấy
   * lỗi, một tệp tạm, một lượt `git checkout` đang dở — đều vào danh sách quét. Lưới đỏ theo
   * thứ KHÔNG nằm trong repo, và lưới đỏ không dựng lại được là lưới không ai tin.
   *
   * `git ls-files` trả TẬP TẤT ĐỊNH: chỉ tệp đã theo dõi, không `node_modules`, không `.next`,
   * không tệp tạm, không phụ thuộc thứ tự chạy.
   */
  function quetMa(): { duong: string; noiDung: string }[] {
    const ra = execFileSync("git", ["ls-files", "--", "lib", "app"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split(/\r?\n/)
      .filter((d) => /\.tsx?$/.test(d))
      .filter((d) => !/\.(test|spec)\.tsx?$/.test(d))
      .filter((d) => d !== "lib/finance/feature.ts")
      .filter((d) => d !== "lib/settings/registry.ts") // nơi KHAI khoá
      .filter((d) => d !== "lib/settings/nhan-van-hanh.ts") // nhãn cho người vận hành
      // Tệp đã theo dõi nhưng vừa bị xoá trong cây làm việc: `git ls-files` vẫn liệt kê.
      .filter((d) => existsSync(resolve(process.cwd(), d)))
      .map((d) => ({
        duong: d,
        noiDung: bocChuThich(readFileSync(resolve(process.cwd(), d), "utf8")),
      }));

    // LƯỚI CANH LƯỚI: `git ls-files` trả rỗng (không phải repo git, hoặc `git` không có trong
    // PATH) thì hai ca dưới XANH VĨNH VIỄN mà chẳng quét gì. Ngưỡng đặt thấp hơn thực tế rất
    // nhiều nên nó không vỡ khi repo co lại, nhưng đủ để bắt ca "quét 0 tệp".
    expect(ra.length, "phép quét không đọc được tệp nào — `git ls-files` hỏng?").toBeGreaterThan(
      200,
    );
    return ra;
  }

  // Quét MỘT LẦN cho cả hai ca. Gọi hai lần là đọc ~1.400 tệp hai lượt, và phép đọc ấy nằm
  // TRONG thân `it` nên nó tính vào trần thời gian của TỪNG ca.
  const daQuet = quetMa();

  it("0 tệp nào khác nhắc chuỗi khoá cài đặt", { timeout: TRAN_QUET_MS }, () => {
    // Rải `getSetting("billing.flexV1Enabled")` khắp nơi là mỗi chỗ tự quyết định nghĩa của
    // "bật", và tắt cờ sẽ tắt được 9 chỗ trong 10 — đúng hình dạng sự cố mà T8 mô tả.
    //
    // ⚠️ Lưới này soi VĂN BẢN nên nó mong manh (luật 11). Hai thứ giữ nó khỏi vô dụng: neo vào
    // chuỗi khoá HẸP (`billing.flexV1Enabled`, không phải `flexV1`), và ca `[FEAT-04]` chứng
    // minh phép quét thật sự đọc được tệp.
    const viPham = daQuet
      .filter((f) => f.noiDung.includes(KHOA_CONG_TAC))
      .map((f) => f.duong);
    expect(viPham).toEqual([]);
  });

  it("và chỉ `laThuTienLinhHoatBat` được gọi từ ngoài — không ai gọi `giaiCongTac` trực tiếp", { timeout: TRAN_QUET_MS }, () => {
    // `giaiCongTac` là hàm thuần để TEST phép giải; gọi nó ở đường chạy thật nghĩa là ai đó đã
    // tự đi tra DB rồi tự giải — tức lại có hai nơi quyết định nghĩa của "bật".
    const viPham = daQuet
      .filter((f) => /\bgiaiCongTac\s*\(/.test(f.noiDung))
      .map((f) => f.duong);
    expect(viPham).toEqual([]);
  });
});

describe("[FEAT-04] LƯỚI CANH LƯỚI — phép quét mã phải thật sự đọc được tệp", () => {
  it("phép bóc chú thích THẬT SỰ bóc — kể cả dòng CRLF", () => {
    // Bóc chú thích là bản vá cho lần lưới đỏ vì một câu văn. Ca này canh bản vá: một phép bóc
    // hỏng bóc được 0 dòng và trông y hệt một phép bóc đang làm việc.
    const vao = `  // ${KHOA_CONG_TAC} chỉ là chú thích\r\nconst x = 1;\r\n`;
    const ra = bocChuThich(vao);
    expect(ra).not.toContain(KHOA_CONG_TAC);
    expect(ra).toContain("const x = 1;");
    expect(bocChuThich(`/* ${KHOA_CONG_TAC} */\r\nok`)).not.toContain(KHOA_CONG_TAC);
    // Còn ĐƯỜNG GỌI THẬT thì KHÔNG được bóc — kẻo lưới hoá vô dụng.
    expect(bocChuThich(`getSetting("${KHOA_CONG_TAC}")`)).toContain(KHOA_CONG_TAC);
  });

  it("`lib/flags.ts` vẫn nhắc tên khoá trong CHÚ THÍCH — và đó là chủ ý", () => {
    // Chú thích ở đó dẫn người đọc từ nơi họ tưởng có cờ tới nơi cờ thật sự nằm. Ca này ghim
    // rằng lưới KHÔNG buộc phải xoá lời giải thích để được xanh: ai "sửa" bằng cách gỡ chú
    // thích thì ca này đỏ.
    const flags = readFileSync(resolve(process.cwd(), "lib/flags.ts"), "utf8");
    expect(flags).toContain(KHOA_CONG_TAC);
    expect(bocChuThich(flags)).not.toContain(KHOA_CONG_TAC);
  });

  it("`laThuTienLinhHoatBat` PHẢI truyền `orgUnitId` xuống `getSetting`", () => {
    // LƯỚI GHIM MÃ NGUỒN (CLAUDE.md): luật ở đây có dạng "lời gọi này phải truyền tham số kia",
    // và test hành vi KHÔNG chứng minh được — `getSetting` chạm DB, nên mọi ca kiểm sẽ là test
    // tích hợp, và test tích hợp thì không ai viết đủ ca.
    //
    // Bỏ tham số đó đi thì hàm vẫn chạy, vẫn trả boolean, vẫn xanh mọi test — chỉ có **công tắc
    // riêng từng cơ sở tàng hình**: `CenterSetting` không bao giờ được tra, và người vận hành
    // bật/tắt cho một cơ sở mà không có tác dụng gì, không lỗi nào báo. Đo được: cấy đúng lỗi
    // này ở lượt đầu và KHÔNG ca nào đỏ.
    const src = bocChuThich(readFileSync(resolve(process.cwd(), "lib/finance/feature.ts"), "utf8"));
    const than = /export async function laThuTienLinhHoatBat[\s\S]*?\n\}/.exec(src)?.[0] ?? "";
    expect(than).not.toBe("");
    const goi = than.match(/getSetting\(\s*KHOA_CONG_TAC\s*,\s*\{\s*orgUnitId:/g) ?? [];
    expect(goi).toHaveLength(1);
  });

  it("phép liệt kê tệp ra > 200 tệp, và có tệp mà ta biết chắc tồn tại", () => {
    // Nếu `quetMa` trả mảng rỗng (sai đường dẫn, lỗi quyền, đổi cấu trúc thư mục) thì hai ca
    // trên XANH VĨNH VIỄN và trông y hệt một lưới đang làm việc. Đây là bài học đã trả giá ở
    // `docSchema()`: một phép bóc chú thích hỏng bóc được 0 dòng và không ai biết.
    //
    // ⚠️ SỬA 17/09 — dùng CHÍNH nguồn mà `quetMa` dùng (`git ls-files`), không phải
    // `readdirSync`. Lưới canh lưới mà đọc nguồn KHÁC thì nó canh một phép quét không tồn tại:
    // `git ls-files` có thể trả rỗng trong khi `readdirSync` vẫn ra 300 tệp, và ca này vẫn
    // xanh trong lúc lưới thật đã chết.
    const files = execFileSync("git", ["ls-files", "--", "lib"], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split(/\r?\n/)
      .filter((d) => /\.tsx?$/.test(d));
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain("lib/finance/feature.ts");
    expect(files).toContain("lib/settings/registry.ts");
    // Và tệp liệt kê được phải ĐỌC được — `git ls-files` in cả tệp đã xoá khỏi cây làm việc.
    expect(existsSync(resolve(process.cwd(), "lib/finance/feature.ts"))).toBe(true);
  });
});
