import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { whereCase } from "./case-doc";

// [TCX] Tab "Case hoàn thành" (20/10/2026): case đã chốt không còn chất đống trong "Case dạy bù".
// Trước đó tab "Case dạy bù" liệt kê MỌI trạng thái trong khi số trên tab chỉ đếm case sắp dạy.

// Đọc mã ĐÃ BỎ chú thích (chú thích giải thích bản vá chứa đúng những chuỗi đang tìm) và chuẩn hoá CRLF.
const ma = (p: string) =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("[TCX-01] whereCase nhận một trạng thái HOẶC một nhóm", () => {
  it("không khai ⇒ không lọc trạng thái", () => {
    expect(whereCase({ chiCuaSale: null })).not.toHaveProperty("status");
  });
  it("một trạng thái ⇒ so bằng", () => {
    expect(whereCase({ chiCuaSale: null, trangThai: "SCHEDULED" })).toMatchObject({ status: "SCHEDULED" });
  });
  it("một nhóm ⇒ `in` đúng nhóm đó (không thêm, không bớt)", () => {
    const w = whereCase({ chiCuaSale: null, trangThai: ["COMPLETED", "NO_SHOW", "CANCELLED"] });
    expect(w.status).toEqual({ in: ["COMPLETED", "NO_SHOW", "CANCELLED"] });
  });
  it("nhóm không dính trạng thái SCHEDULED — đó là ranh giới giữa hai tab", () => {
    const w = whereCase({ chiCuaSale: null, trangThai: ["COMPLETED", "NO_SHOW", "CANCELLED"] });
    expect(JSON.stringify(w.status)).not.toContain("SCHEDULED");
  });
});

describe("[TCX-02] màn /hoc-bu: ranh giới hai tab case đi qua CÙNG bộ lọc ở số đếm và danh sách", () => {
  const page = ma("app/(admin)/admin/hoc-bu/page.tsx");

  it("có tab `case-xong` và nó đứng sau tab `case`", () => {
    expect(page).toContain('type Tab = "can-bu" | "case" | "case-xong" | "da-huy";');
    const i = page.indexOf('["case", "Case dạy bù"');
    const j = page.indexOf('["case-xong", "Case hoàn thành"');
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
  });

  it("tab `case` lấy case CHƯA chốt (đã duyệt đang chờ dạy + chờ duyệt); tab `case-xong` lấy nhóm đã chốt (hoặc đúng trạng thái đang lọc)", () => {
    // 20/10/2026: case Sale tạo ở trạng thái chờ duyệt — nếu tab chỉ lấy SCHEDULED thì nó biến mất khỏi CẢ hai tab, Sale không biết case của mình đang ở đâu.
    expect(page).toContain('const CASE_DANG_MO = ["SCHEDULED", "PENDING_APPROVAL"]');
    expect(page).toContain('trangThai: tab === "case" ? CASE_DANG_MO : (tt ?? CASE_DA_CHOT)');
    // số trên tab dùng đúng hai biểu thức đó
    expect(page).toContain("whereCase({ ...chung, trangThai: CASE_DANG_MO })");
    expect(page).toContain("whereCase({ ...chung, trangThai: tt ?? CASE_DA_CHOT })");
  });

  it("lọc trạng thái CHỈ có ở tab `case-xong`, và chỉ bày ba giá trị đã chốt (không bày `Sắp dạy`)", () => {
    expect(page).toContain('const tt = tab === "case-xong" ? CASE_DA_CHOT.find((x) => x === sp.tt) : undefined;');
    expect(page).toContain("luaChon={CASE_DA_CHOT.map(");
    expect(page).toContain('const CASE_DA_CHOT = ["COMPLETED", "NO_SHOW", "CANCELLED"]');
  });

  it("bốn tab ở 375px cuộn NGANG trong thanh tab, không kéo cả trang", () => {
    expect(page).toMatch(/<nav className="[^"]*overflow-x-auto[^"]*" aria-label="Học bù">/);
    expect(page).toContain("shrink-0");
  });

  it("chi tiết case: link quay lại đi theo trạng thái (đã chốt ⇒ tab `case-xong`)", () => {
    const ct = ma("app/(admin)/admin/hoc-bu/case/[id]/page.tsx");
    // Case CHỜ DUYỆT chưa chốt: nó nằm ở tab `case` cùng case sắp dạy (không bao giờ ở `case-xong`).
    expect(ct).toContain('href={mo || choDuyet ? "/hoc-bu?tab=case" : "/hoc-bu?tab=case-xong"}');
  });
});
