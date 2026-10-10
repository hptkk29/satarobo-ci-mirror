// app/(public)/chinh-sach-bao-mat/page.test.ts — S8 / lô L10 (06/09/2026).
//
// VÌ SAO CÓ FILE NÀY. Trang chính sách bảo mật là thứ duy nhất trong repo có giá
// trị pháp lý với người ngoài, và cho tới nay **không một test nào chạm vào nó**
// (chỉ `tests/manual/public-contrast.spec.ts` mở trang lên soi màu). Nội dung
// nằm rải ở HAI file — `page.tsx` (metadata + phụ đề) và
// `content/legal/chinh-sach-bao-mat.md` (thân bài) — nên kiểu hỏng dễ xảy ra
// nhất không phải "quên sửa", mà là **sửa một nửa**: phụ đề nói văn bản mới,
// thân bài vẫn dẫn văn bản cũ. Không có gì báo, kể cả `pnpm build`.
//
// Test này KHÔNG dựng React (kéo theo `next/link` + design tokens cho một trang
// tĩnh là đắt vô ích). Nó đọc mã nguồn dạng chuỗi — cùng lối với
// `lib/lead/lead-pii-callsites.test.ts`.
//
// ⚠️ Nó khoá SỰ NHẤT QUÁN và SỰ CÓ MẶT, không khoá tính đúng đắn pháp lý. Câu
// chữ vẫn phải qua luật sư (chốt 9.2 là "làm trước, luật sư sau").
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DUONG_DAN_MD = path.join("content", "legal", "chinh-sach-bao-mat.md");
const DUONG_DAN_PAGE = path.join(
  "app",
  "(public)",
  "chinh-sach-bao-mat",
  "page.tsx",
);

const thanBai = fs.readFileSync(DUONG_DAN_MD, "utf8");

/** Mã của `page.tsx`, đã BỎ chú thích — chú thích ở đó nhắc lại cả tên văn bản
 *  cũ lẫn mới để giải thích lần đổi, soi cả chú thích thì ca "không còn dẫn văn
 *  bản cũ" đỏ vĩnh viễn dù trang đã đúng. Bỏ chú thích DÒNG trước, KHỐI sau. */
const maPage = fs
  .readFileSync(DUONG_DAN_PAGE, "utf8")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("[ZC-PL] trang chính sách bảo mật — căn cứ pháp lý", () => {
  it("[ZC-PL-01] thân bài dẫn Luật Bảo vệ dữ liệu cá nhân 91/2025 và Nghị định 356/2025", () => {
    expect(thanBai).toMatch(/91\/2025/);
    expect(thanBai).toMatch(/356\/2025/);
  });

  it("[ZC-PL-02] phụ đề + metadata của page.tsx dẫn CÙNG hai văn bản đó", () => {
    expect(maPage).toMatch(/91\/2025/);
    expect(maPage).toMatch(/356\/2025/);
  });

  it("[ZC-PL-03] không chỗ nào còn dẫn NĐ 13/2023 làm căn cứ đang áp dụng", () => {
    // Trang này nói ở thì hiện tại ("Theo …, Anh/Chị có các quyền"). Còn sót số
    // hiệu cũ nghĩa là đang nói với người đọc một căn cứ không còn là căn cứ.
    expect(thanBai).not.toMatch(/13\/2023/);
    expect(maPage).not.toMatch(/13\/2023/);
  });
});

describe("[ZC-PL] trang chính sách bảo mật — tin nhắn tới nick Zalo công ty", () => {
  it("[ZC-PL-04] có nói rõ tin nhắn tới nick Zalo công ty ĐƯỢC ĐỌC và ĐƯỢC LƯU", () => {
    // Ba mảnh phải cùng có mặt: kênh nào (nick Zalo), ai đọc (nhân viên phụ
    // trách + quản lý), và số phận của nội dung (lưu lại). Thiếu vế "quản lý"
    // là câu chuyện khác hẳn — người ta hình dung một cuộc trò chuyện riêng với
    // một nhân viên, mà thực tế cấp trên của nhân viên đó cũng đọc được.
    expect(thanBai).toMatch(/nick Zalo/i);
    expect(thanBai).toMatch(/nhân viên phụ trách/i);
    expect(thanBai).toMatch(/quản lý/i);
    expect(thanBai).toMatch(/lưu lại/i);
  });

  it("[ZC-PL-05] nêu mục đích là chăm sóc khách hàng", () => {
    expect(thanBai).toMatch(/chăm sóc khách hàng/i);
  });
});
