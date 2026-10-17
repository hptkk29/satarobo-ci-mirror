// Cổng chặn: MỌI trang của cổng phụ huynh phải có lối vào trong sidebar v2.
//
// ─────────────────────────────────────────────────────────────────────────────
// Vì sao có bộ test này (06/09/2026)
//
// `components/portal/v2-shell.tsx` là LỐI VÀO DUY NHẤT khi `PORTAL_V2_ENABLED` bật —
// và prod đang bật. Bản v1 (`app/(portal)/portal/_components/portal-nav.tsx`) có 22 mục;
// bản v2 ra đời với 12, và không ai đối chiếu lại. Kết quả: BẢY trang vẫn chạy đúng,
// vẫn có dữ liệu, nhưng không còn đường nào để phụ huynh mở —
// `bai-tap` · `bai-thi` · `ket-qua` · `bai-giang` · `danh-gia` · `danh-gia-gv` ·
// `satacoin`.
//
// Không lỗi, không log, không test đỏ. Tệ hơn: tài liệu hướng dẫn ngay trong portal vẫn
// dặn phụ huynh mở `/portal/bai-thi`, `/portal/ket-qua`, `/portal/bai-giang` — họ đọc
// hướng dẫn rồi đi tìm trong menu và không thấy gì.
//
// Bộ này quét thư mục route và đối chiếu với danh sách `href` có trong v2-shell. Thêm
// một trang mới mà quên khai vào nav ⇒ đỏ ngay.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GOC = path.join("app", "(portal)", "portal");
const SHELL = path.join("components", "portal", "v2-shell.tsx");

/**
 * Trang CỐ Ý không có mục riêng trên sidebar. Thêm dòng ở đây là một quyết định, không
 * phải thủ tục cho qua cổng.
 */
const NGOAI_LE: ReadonlyArray<[route: string, lyDo: string]> = [
  [
    "/portal/lich-hoc",
    "Bản V1 của trang Lịch học. Bản V2 dùng /portal/lich (có lịch tháng + buổi kế tiếp) " +
      "và đã có mục riêng; hai mục cùng nghĩa nằm cạnh nhau chỉ làm phụ huynh phân vân.",
  ],
  [
    "/portal/ho-so-con/chi-tiet",
    'Trang CHI TIẾT một con — vào bằng cách bấm thẻ con ở mục "Các con". Trang chi tiết ' +
      "không có mục sidebar riêng, đúng như /portal/bai-tap/[assignmentId].",
  ],
];

/** Route con của cổng học sinh — có nav riêng, kiểm bằng `studentNav`. */
const TIEN_TO_HOC_SINH = "/portal/hoc-sinh/";

function routesCoTrang(): string[] {
  const ra: string[] = [];
  const di = (thuMuc: string, url: string) => {
    for (const m of fs.readdirSync(thuMuc, { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      // `_components`, `_lib`… không phải route; `[id]` là trang chi tiết, vào từ danh sách.
      if (m.name.startsWith("_") || m.name.startsWith("(") || m.name.startsWith("[")) continue;
      const p = path.join(thuMuc, m.name);
      const u = `${url}/${m.name}`;
      if (fs.existsSync(path.join(p, "page.tsx"))) ra.push(u);
      di(p, u);
    }
  };
  di(GOC, "/portal");
  return ra;
}

/** Mọi `href: "/portal/..."` xuất hiện trong nguồn v2-shell. */
function hrefTrongShell(): Set<string> {
  const src = fs.readFileSync(SHELL, "utf8");
  return new Set([...src.matchAll(/href:\s*"(\/portal[^"]*)"/g)].map((m) => m[1]!));
}

/** Đường dẫn `router.push("/portal/...")` trong menu avatar. */
function pushTrongShell(): Set<string> {
  const src = fs.readFileSync(SHELL, "utf8");
  return new Set(
    [...src.matchAll(/router\.push\("(\/portal[^"]*)"\)/g)].map((m) => m[1]!),
  );
}

describe("Sidebar v2 — mọi trang portal đều có lối vào", () => {
  it("quét được cả hai phía (chốt chặn: regex hỏng thì mọi ca dưới xanh giả)", () => {
    expect(routesCoTrang().length).toBeGreaterThan(15);
    expect(hrefTrongShell().size).toBeGreaterThan(10);
    expect(hrefTrongShell().has("/portal/hoc-phi")).toBe(true);
  });

  it("không trang nào bị bỏ rơi khỏi nav", () => {
    const co = new Set([...hrefTrongShell(), ...pushTrongShell()]);
    const mienTru = new Set(NGOAI_LE.map(([r]) => r));
    const mocoi = routesCoTrang().filter(
      (r) => !co.has(r) && !mienTru.has(r) && !r.startsWith(TIEN_TO_HOC_SINH),
    );
    expect(
      mocoi,
      `Trang KHÔNG có lối vào nào trên sidebar v2:\n  ${mocoi.join("\n  ")}\n` +
        "→ Thêm mục vào `parentNav` (components/portal/v2-shell.tsx), hoặc khai vào " +
        "NGOAI_LE kèm lý do. Bảy trang từng nằm im ở đây suốt từ ngày prod bật cờ v2 — " +
        "chạy đúng, có dữ liệu, không ai mở được.",
    ).toEqual([]);
  });

  it("route của cổng HỌC SINH có mục trong studentNav", () => {
    const co = hrefTrongShell();
    const mocoi = routesCoTrang().filter(
      (r) => r.startsWith(TIEN_TO_HOC_SINH) && !co.has(r),
    );
    expect(
      mocoi,
      `Trang cổng học sinh không có lối vào: ${mocoi.join(", ")}`,
    ).toEqual([]);
  });

  it("danh sách ngoại lệ không để lại rác", () => {
    const co = new Set([...hrefTrongShell(), ...pushTrongShell()]);
    const thuc = new Set(routesCoTrang());
    for (const [route, lyDo] of NGOAI_LE) {
      expect(thuc.has(route), `${route} không còn là một route có trang`).toBe(true);
      expect(
        co.has(route),
        `${route} NAY đã có mục trên sidebar — bỏ khỏi NGOAI_LE`,
      ).toBe(false);
      expect(lyDo.length, `${route} phải có lý do thật`).toBeGreaterThan(40);
    }
  });
});
