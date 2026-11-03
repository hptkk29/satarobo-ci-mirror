// @vitest-environment node
/**
 * Khung trình học KHÔNG được làm mất nhịp đo cuối (đo 24/10/2026: đọc 12 giây rồi bấm "Bài sau" bằng `<Link>` ⇒ server nhận 0 dòng).
 *
 * Lưới ghim MÃ NGUỒN (luật 11: neo chuỗi hẹp, đếm số lần khớp, và đã cấy thử): lưới hành vi thật nằm ở e2e
 * `[EL-UX] rời bài không làm mất tiến độ đọc`; ca ở đây chặn việc ai đó "tối ưu" lại thành `<Link>` trước khi e2e kịp chạy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { laTrangBai } from "@/app/(elearning)/elearning/_components/lien-ket";

const doc = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const chiMa = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("[KBH-01] laTrangBai", () => {
  it("nhận trang một bài, kể cả clean URL của host e-learning", () => {
    expect(laTrangBai("/elearning/hoc/e1/l1")).toBe(true);
    expect(laTrangBai("/hoc/e1/l1")).toBe(true);
    expect(laTrangBai("/elearning/hoc/e1/l1/")).toBe(true);
  });
  it("không nhận đề cương, danh sách, trang khác", () => {
    expect(laTrangBai("/elearning/hoc/e1")).toBe(false);
    expect(laTrangBai("/elearning/khoa-cua-toi")).toBe(false);
    expect(laTrangBai("/elearning")).toBe(false);
    expect(laTrangBai("/")).toBe(false);
  });
});

describe("[KBH-02] liên kết rời trang bài là `<a href>` thường", () => {
  const khung = chiMa(doc("app/(elearning)/elearning/hoc/_components/khung-bai-hoc.tsx"));

  it("khung trình học không import hay dùng `next/link`", () => {
    expect(khung).not.toContain("next/link");
    expect(khung).not.toContain("<Link");
  });

  it("có đúng bốn chỗ dựng `<a` tới bài/đề cương trong mã: hai ở khung (về đề cương, cây bài) + hai ở `chuyen-bai.tsx` (Bài trước, Bài sau)", () => {
    // 26/10/2026: Bài trước/Bài sau tách thành component CLIENT `ChuyenBaiNav` để biến mất ngay khi bấm "Bắt đầu làm bài". Lý lẽ của
    // lưới này (mọi liên kết rời bài là `<a>` thường để nhịp đo cuối kịp gửi) KHÔNG đổi — chỉ chỗ đặt hai liên kết.
    const chuyen = chiMa(doc("app/(elearning)/elearning/hoc/_components/chuyen-bai.tsx"));
    expect((khung.match(/<a$|<a\s/gm) ?? []).length).toBe(2);
    expect((chuyen.match(/<a$|<a\s/gm) ?? []).length).toBe(2);
    expect(chuyen).not.toContain("next/link");
    expect(chuyen).not.toContain("<Link");
    expect(chuyen).toContain("Bài trước:");
    expect(chuyen).toContain("Bài sau:");
    // Khung dựng đúng component đó (không còn khối viết tay thứ hai).
    expect(khung).toContain("<ChuyenBaiNav");
    expect(khung).not.toContain("Bài trước:");
  });

  it("thanh bên và thanh trên chuyển sang tải trang đầy đủ khi đang ở trang bài", () => {
    const sb = chiMa(doc("app/(elearning)/elearning/_components/sidebar.tsx"));
    const tb = chiMa(doc("app/(elearning)/elearning/_components/topbar.tsx"));
    expect(sb).toContain("laTrangBai(duongDan)");
    expect((sb.match(/toanTrang=\{toanTrang\}/g) ?? []).length).toBe(3);
    expect(sb).not.toContain("next/link");
    expect(tb).toContain("laTrangBai(duongDan)");
  });
});

describe("[KBH-03] đang có lượt thi dở thì không vẽ Bài trước/Bài sau", () => {
  it("trang bài truyền `anChuyenBai` theo `luotDangLam`, khung tôn trọng nó", () => {
    const page = chiMa(doc("app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx"));
    expect(page).toContain("anChuyenBai: nen.luotDangLam != null");
    const khung = chiMa(doc("app/(elearning)/elearning/hoc/_components/khung-bai-hoc.tsx"));
    // Neo vào BIỂU THỨC điều kiện, không vào chỗ đặt chữ: khung chỉ dựng nút nối khi `anChuyenBai` TẮT.
    expect(khung).toMatch(/!anChuyenBai\s*\?\s*<ChuyenBaiNav\b/);
  });
});
