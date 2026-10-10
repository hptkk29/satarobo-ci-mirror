// components/admin/sidebar-flag-wiring.test.ts — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của
// mọi mục sidebar gắn feature flag. Khuôn: CLAUDE.md mục "Mẫu test: LƯỚI GHIM MÃ NGUỒN".
//
// 🔴 VÌ SAO CÓ FILE NÀY — sự cố 17/09/2026, đúng lớp lỗi "hàm thuần có test, dây nối thì
// không", lần này ở tầng giao diện:
//
//   · `sidebar.tsx` khai mục `{ label: "Zalo CRM", …, flag: "zalocrm" }`;
//   · nó chỉ hiện khi `it.flag === "zalocrm" && zalocrmEnabled`;
//   · `zalocrmEnabled` có MẶC ĐỊNH `false`;
//   · và **không ai truyền nó vào** — `layout.tsx` chuyền `evalV2Enabled`, `scormEnabled`,
//     `classGroupEnabled` nhưng bỏ sót cái thứ tư, `AdminShell` cũng không khai prop.
//
// ⇒ Mục "Zalo CRM" KHÔNG BAO GIỜ hiện, với MỌI vai, kể cả khi `ZALOCRM_ENABLED=true`.
// Không có lỗi biên dịch (prop tuỳ chọn, có mặc định), không ca test nào đỏ, và triệu
// chứng ngoài đời là "tôi không thấy mục Zalo CRM trên sidebar" — rất dễ bị chẩn thành
// lỗi phân quyền, vì cổng quyền `zalocrm:use` nằm ngay cạnh và trông rất giống nguyên nhân.
//
// Ca `④ Giáo vụ KHÔNG thấy mục Zalo CRM` trong bản nghiệm thu còn ĐẠT vì lý do SAI: menu
// ẩn với tất cả mọi người, không riêng Giáo vụ.
//
// ⚠️ Lưới này soi CẢ BỐN cờ, không riêng cờ vừa hỏng — thêm một mục gắn cờ mới mà quên
// nối dây thì nó đỏ ngay, thay vì phải chờ ai đó phát hiện bằng mắt.
//
// ⚠️ Luật 11: neo hẹp, đếm số lần khớp, không dùng cờ `/s`, và tên prop được RÚT RA TỪ
// CHÍNH biểu thức lọc (`it.flag === "x" && <prop>`) chứ không suy theo quy ước — cờ
// `eval` dùng prop `evalV2Enabled`, suy theo tên là sai ngay ca đầu tiên.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const SIDEBAR = "components/admin/sidebar.tsx";
const LAYOUT = "app/(admin)/admin/layout.tsx";
const SHELL = "components/admin/admin-shell.tsx";

const nguonSidebar = doc(SIDEBAR);
const nguonLayout = doc(LAYOUT);
const nguonShell = doc(SHELL);

/** Mọi giá trị `flag: "x"` khai trong danh mục mục sidebar. */
function coTrongDanhMuc(): string[] {
  return [...nguonSidebar.matchAll(/flag:\s*"([a-zA-Z0-9]+)"/g)].map((m) => m[1]).sort();
}

/** Ánh xạ cờ → tên prop, rút từ chính biểu thức lọc `it.flag === "x" && <prop>`. */
function copDayNoi(): Map<string, string> {
  const ra = new Map<string, string>();
  for (const m of nguonSidebar.matchAll(
    /it\.flag\s*===\s*"([a-zA-Z0-9]+)"\s*&&\s*([a-zA-Z0-9_]+)/g,
  )) {
    ra.set(m[1], m[2]);
  }
  return ra;
}

describe("[SB-FLAG] mọi mục sidebar gắn cờ đều được NỐI DÂY tới tận layout", () => {
  const danhMuc = coTrongDanhMuc();
  const cap = copDayNoi();

  it("quét được cờ (chống cổng rỗng)", () => {
    // Không có cờ nào ⇒ regex hỏng hoặc file đổi hình, chứ không phải "không còn cờ".
    expect(danhMuc.length, `${SIDEBAR}: không tìm thấy \`flag: "…"\` nào`).toBeGreaterThan(0);
  });

  it("mỗi cờ trong danh mục đều có một nhánh lọc tương ứng", () => {
    // Khai `flag: "x"` mà quên nhánh `it.flag === "x" && …` ⇒ mục hiện VÔ ĐIỀU KIỆN,
    // tức cờ mất tác dụng theo chiều ngược lại — cũng hỏng câm.
    const thieu = danhMuc.filter((f) => !cap.has(f));
    expect(thieu, `${SIDEBAR}: cờ khai trong danh mục nhưng không có nhánh lọc`).toEqual([]);
  });

  for (const [co, prop] of copDayNoi()) {
    it(`cờ "${co}" → prop \`${prop}\` phải đi hết SIDEBAR → SHELL → LAYOUT`, () => {
      // 1. Sidebar phải KHAI prop (nếu không thì nó luôn `undefined`).
      expect(
        (nguonSidebar.match(new RegExp(String.raw`^\s+${prop}\?:\s*boolean;`, "gm")) ?? []).length,
        `${SIDEBAR}: thiếu khai \`${prop}?: boolean\``,
      ).toBe(1);

      // 2. AdminShell phải NHẬN và CHUYỀN TIẾP.
      expect(
        (nguonShell.match(new RegExp(String.raw`^\s+${prop}:\s*boolean;`, "gm")) ?? []).length,
        `${SHELL}: thiếu khai \`${prop}: boolean\` — dây đứt ở giữa`,
      ).toBe(1);

      // 3. Layout phải TRUYỀN GIÁ TRỊ THẬT. Đây là mắt xích đã đứt ngày 17/09: ba cờ kia
      //    có dòng này, riêng `zalocrmEnabled` thì không, và không gì báo.
      expect(
        (nguonLayout.match(new RegExp(String.raw`${prop}=\{`, "g")) ?? []).length,
        `${LAYOUT}: thiếu \`${prop}={…}\` — cờ có bật cũng không tới được sidebar`,
      ).toBe(1);
    });
  }
});
