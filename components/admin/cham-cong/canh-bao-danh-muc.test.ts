/**
 * Cảnh báo danh mục nền phải ĐƯỢC CẮM ở cả hai chỗ đã định — luật 14.
 *
 * `suc-khoe-danh-muc.test.ts` kiểm phần LUẬT (14 ca, thuần, không cần DB). File này kiểm
 * một thứ khác hẳn và không kém quan trọng: **khối cảnh báo có thật sự được render không.**
 * Hai hook an toàn của repo chết nhiều tháng đúng vì không ai kiểm vế thứ hai này.
 *
 * ⚠️ Đây là test GREP MÃ NGUỒN — loại mong manh nhất (luật 11). Nên:
 *   · bỏ CHÚ THÍCH trước mọi phép so — chú thích giải thích bản vá chứa đúng chuỗi bộ so
 *     đang tìm, và cái bẫy đó đã cắn SÁU lần trong hai ngày;
 *   · neo chuỗi hẹp nhất (`<CanhBaoDanhMuc`), không dùng cờ `/s`;
 *   · khẳng định cả SỐ LẦN khớp, không chỉ có/không;
 *   · đã cấy lại lỗi (gỡ chỗ cắm) và thấy đỏ đúng ca.
 *
 * Vì sao không test hành vi qua trình duyệt: khối này chỉ hiện khi danh mục RỖNG, mà dựng
 * một prod-rỗng trong bộ a0 nghĩa là xoá danh mục của chính bộ test đó. Ranh giới ở đây là
 * "được render hay không", và ranh giới đó đọc được ở tầng mã nguồn.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const GOC = process.cwd();

/** Bỏ `//`, `/* *\/` và `{/* *\/}` trước khi soi — xem cảnh báo ở đầu file. */
function boChuThich(src: string): string {
  return src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "")
    .split(String.fromCharCode(10))
    .filter((l) => !/^\s*\/\//.test(l))
    .join(String.fromCharCode(10));
}

function doc(p: string): string {
  return boChuThich(readFileSync(join(GOC, p), "utf8"));
}

function demKhop(src: string, chuoi: string): number {
  return src.split(chuoi).length - 1;
}

const CAM = [
  {
    ten: "ConfigTabs — lối vào duy nhất của 6 màn danh mục",
    file: "components/admin/cham-cong/config-tabs.tsx",
  },
  {
    ten: "màn Công dạy — không đi qua ConfigTabs, và là màn cần cảnh báo nhất",
    file: "app/(admin)/admin/cham-cong/cong-day/page.tsx",
  },
];

describe("khối cảnh báo danh mục nền phải được CẮM", () => {
  it.each(CAM)("$ten", ({ file }) => {
    const src = doc(file);
    expect(demKhop(src, "CanhBaoDanhMuc"), `${file} phải nhập VÀ render CanhBaoDanhMuc`)
      .toBeGreaterThanOrEqual(2); // 1 lần ở `import`, ≥1 lần ở JSX
    expect(demKhop(src, "<CanhBaoDanhMuc"), `${file} phải RENDER đúng một khối`).toBe(1);
  });

  it("truyền phạm vi cơ sở, KHÔNG để mặc định 'tất cả' (luật 7)", () => {
    // `docSucKhoeDanhMuc` không có tham số mặc định — nếu ai đó thêm một cái, cảnh báo
    // "thiếu điểm chấm" sẽ nói cho người CS1 biết CS2 đang thiếu gì.
    for (const { file } of CAM) {
      expect(doc(file), `${file} phải truyền coSoVanHanhIds`).toContain("coSoVanHanhIds");
    }
    const lib = doc("lib/cham-cong/suc-khoe-danh-muc-db.ts");
    expect(lib, "tham số phạm vi phải BẮT BUỘC, không có dấu `=` mặc định").toMatch(
      /coSoVanHanhIds: readonly string\[\],/,
    );
  });

  it("cổng này KHÔNG được chặn — không `redirect`, không `notFound`", () => {
    // Chặn màn Cấu hình khi danh mục rỗng là khoá đúng cái cửa người ta cần vào để sửa.
    const src = doc("components/admin/cham-cong/canh-bao-danh-muc.tsx");
    expect(src).not.toContain("redirect(");
    expect(src).not.toContain("notFound(");
    expect(src).not.toContain("throw ");
  });

  it("có GHI LOG — cổng không chặn thì log là thứ duy nhất còn lại", () => {
    const lib = doc("lib/cham-cong/suc-khoe-danh-muc-db.ts");
    expect(demKhop(lib, "[suc-khoe-danh-muc]"), "tiền tố log phải cố định để lọc được").toBe(1);
    expect(lib).toContain("console.warn");
  });
});
