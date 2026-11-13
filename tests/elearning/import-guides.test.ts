// @vitest-environment node
/**
 * EL-04 — script nhập 50 bài hướng dẫn.
 *
 * Hai tầng: hành vi của phần THUẦN (gom chương, đánh số bài, đếm bài), và guard
 * nguồn cho những luật "KHÔNG ĐƯỢC LÀM" mà chạy script một lần không chứng minh
 * được.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_GUIDES } from "@/app/(admin)/admin/huong-dan/_content/guides.generated";
import { PORTAL_GUIDES } from "@/app/(portal)/portal/huong-dan/_content/guides.generated";
import { TEACHER_GUIDES } from "@/app/(teacher)/teacher/huong-dan/_content/guides.generated";
import { computeMinReadSeconds } from "@/lib/elearning/reading";

const SRC = readFileSync(
  join(process.cwd(), "scripts/elearning-import-guides.ts"),
  "utf8",
);

describe("nguồn 50 bài", () => {
  it("đủ 50 bài từ ba bộ", () => {
    expect(
      ADMIN_GUIDES.length + PORTAL_GUIDES.length + TEACHER_GUIDES.length,
    ).toBe(50);
  });

  it("mọi bài có slug, title, category, body — không bài nào rỗng", () => {
    for (const b of [...ADMIN_GUIDES, ...PORTAL_GUIDES, ...TEACHER_GUIDES]) {
      expect(b.slug, b.slug).toBeTruthy();
      expect(b.title, b.slug).toBeTruthy();
      expect(b.category, b.slug).toBeTruthy();
      expect(b.body.length, b.slug).toBeGreaterThan(50);
    }
  });

  it("mọi bài tính ra minReadSeconds trong khoảng [30, 600]", () => {
    for (const b of [...ADMIN_GUIDES, ...PORTAL_GUIDES, ...TEACHER_GUIDES]) {
      const s = computeMinReadSeconds(b.body);
      expect(s, b.slug).toBeGreaterThanOrEqual(30);
      expect(s, b.slug).toBeLessThanOrEqual(600);
    }
  });

  it("body bắt đầu bằng `# ` — đúng chỗ demoteH1 phải xử", () => {
    // Nếu KHÔNG hạ cấp thì `h1: () => null` của renderer chung nuốt mất dòng đầu
    // của CẢ 50 BÀI, và mỗi bài mất đúng tiêu đề của nó.
    const coH1 = [...ADMIN_GUIDES, ...PORTAL_GUIDES, ...TEACHER_GUIDES].filter(
      (b) => /^#(?!#)\s/.test(b.body),
    );
    expect(coH1.length).toBeGreaterThan(40);
  });
});

describe("đánh số bài TRONG chương phải liên tục từ 0", () => {
  it("`order` trong tệp là thứ tự TOÀN SITE, không phải trong chương", () => {
    // Đây là bẫy thật: dùng thẳng `order` làm `orderIndex` sẽ vỡ khoá
    // `@@unique([moduleId, orderIndex])` ngay khi hai chương có bài cùng số —
    // hoặc tệ hơn, để trống số ở giữa và bài hiện sai thứ tự.
    for (const bo of [ADMIN_GUIDES, PORTAL_GUIDES, TEACHER_GUIDES]) {
      const theoChuong = new Map<string, number[]>();
      for (const b of bo) {
        theoChuong.set(b.category, [...(theoChuong.get(b.category) ?? []), b.order]);
      }
      // Ít nhất một chương có `order` KHÔNG bắt đầu từ 0 ⇒ chứng minh không thể
      // dùng thẳng. Nếu ngày nào đó tệ nguồn đổi và mọi chương đều bắt đầu từ 0,
      // case này đỏ và nhắc xem lại — chứ không âm thầm mất nghĩa.
      const coChuongLech = [...theoChuong.values()].some(
        (ds) => Math.min(...ds) !== 0,
      );
      expect(coChuongLech).toBe(true);
    }
  });

  it("script đánh số lại theo bộ đếm từng chương, không dùng thẳng `order`", () => {
    expect(SRC).toContain("demTheoChuong");
    expect(SRC).toContain("orderIndex: idx");
  });
});

describe("cổng rà bảo mật — không được né", () => {
  it("`--apply` đòi thêm `--da-ra-soat`", () => {
    // Cờ đó là CHỮ KÝ của người vận hành rằng họ đã đọc bản rà soát. Bỏ nó đi thì
    // bước rà soát thành một đoạn log không ai đọc.
    expect(SRC).toContain("DA_RA_SOAT");
    expect(SRC).toMatch(/if \(!DA_RA_SOAT\)/);
  });

  it("quét đủ bốn nhóm dấu hiệu", () => {
    for (const d of ["bảng giá", "lương", "ưu đãi", "CCCD"]) {
      expect(SRC, d).toContain(d);
    }
  });

  it("KHÔNG dùng securityLevel cao để né việc sửa nội dung", () => {
    // Mức bảo mật cao chỉ giới hạn AI THẤY khoá; nó không xoá nội dung nhạy cảm
    // khỏi bài. Nâng mức để "cho qua" là giấu vấn đề, không giải quyết.
    expect(SRC).toContain('securityLevel: "INTERNAL"');
    expect(SRC).not.toContain('securityLevel: "CONFIDENTIAL"');
    expect(SRC).not.toContain('securityLevel: "RESTRICTED"');
  });
});

describe("hai luật của khoá nhập vào", () => {
  it("fail-closed ghi TƯỜNG MINH, không dựa vào default", () => {
    expect(SRC).toContain('visibility: "ASSIGNED_ONLY"');
    expect(SRC).toContain("selfEnrollEnabled: false");
  });

  it("KHÔNG ghi vào model Course (bảng bán hàng công khai)", () => {
    expect(SRC).not.toMatch(/\bdb\.course\b/);
  });

  it("nói rõ di trú MỘT CHIỀU — chạy lại sẽ ghi đè", () => {
    // Không nói thì người soạn sửa bài trong hệ thống, ai đó chạy lại script, và
    // công sửa biến mất mà không ai nối được nguyên nhân.
    expect(SRC).toContain("MỘT CHIỀU");
    expect(SRC).toContain("GHI ĐÈ");
  });
});
