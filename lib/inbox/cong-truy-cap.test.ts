// @vitest-environment node
/**
 * CỔNG TRUY CẬP — lưới cuối của cách ly cơ sở cho hộp thư.
 *
 * Ba bảng `Inbox*` mang `orgUnitId` chứ không `centerId` (luật cứng Nền Hệ thống #3),
 * mà `scopedDb` chỉ auto-scope theo `centerId`. Nghĩa là ở module này KHÔNG có lưới
 * tự động nào: cách ly chỉ tồn tại nếu MỌI truy vấn đều gộp `inboxOrgScopeWhere`.
 *
 * Một `db.inboxConversation.findMany(...)` viết vội ở màn khác sẽ trả về hội thoại
 * của MỌI cơ sở, và không có gì báo — màn hình vẫn đầy dữ liệu, chỉ là dữ liệu của
 * người khác. Nên luật là: chỉ `lib/inbox/` được chạm ba bảng đó.
 *
 * Đây là test đọc MÃ NGUỒN, cùng loại với `page-gates.test.ts` và
 * `bang-coverage.test.ts` — nó bắt được thứ mà test hành vi không bắt được, vì cái
 * cần bắt là "chỗ nào được phép viết", không phải "viết ra cái gì".
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const THU_MUC_QUET = ["app", "components", "lib", "scripts"];
const DUOI = new Set([".ts", ".tsx"]);

/**
 * Nơi ĐƯỢC phép chạm thẳng `db.inbox*`.
 *
 * ⚠️ Thêm dòng vào đây là một quyết định, không phải thủ tục: mỗi dòng là một chỗ
 * phải tự nhớ gộp `inboxOrgScopeWhere(actor)`. Nếu chỉ vì "tiện" thì đừng thêm —
 * viết hàm trong `lib/inbox/queries.ts` rồi gọi ra.
 */
const DUOC_PHEP = [
  "lib/inbox/",
  // Bộ e2e chạm DB dựng dữ liệu bằng Prisma client thẳng — nó KHÔNG chạy trong
  // đường phục vụ người dùng nên không có gì để cách ly.
  "tests/",
];

function liet(thuMuc: string, ra: string[] = []): string[] {
  const day = path.join(ROOT, thuMuc);
  if (!fs.existsSync(day)) return ra;
  for (const m of fs.readdirSync(day, { withFileTypes: true })) {
    const p = path.join(thuMuc, m.name);
    if (m.isDirectory()) {
      if (m.name === "node_modules" || m.name === ".next") continue;
      liet(p, ra);
    } else if (DUOI.has(path.extname(m.name))) {
      ra.push(p);
    }
  }
  return ra;
}

/** Bỏ comment để chuỗi trong `// …` không bị đếm là mã thật. */
function boComment(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// `db.inboxX`, `tx.inboxX`, `client.inboxX`… — mọi thứ gọi model qua Prisma client.
const CHAM_BANG = /\b\w+\.(inboxConversation|inboxMessage|inboxIdentity)\b/;

describe("chỉ `lib/inbox/` được chạm thẳng ba bảng Inbox*", () => {
  it("không file nào ngoài danh sách cho phép truy vấn `db.inbox*`", () => {
    const viPham: string[] = [];
    for (const tm of THU_MUC_QUET) {
      for (const f of liet(tm)) {
        const duong = f.split(path.sep).join("/");
        if (DUOC_PHEP.some((d) => duong.startsWith(d))) continue;
        const src = boComment(fs.readFileSync(path.join(ROOT, f), "utf8"));
        if (CHAM_BANG.test(src)) viPham.push(duong);
      }
    }
    expect(
      viPham,
      "File dưới đây truy vấn thẳng bảng Inbox*. `scopedDb` KHÔNG che chúng " +
        "(chúng mang `orgUnitId`, scopedDb chỉ lọc `centerId`) ⇒ truy vấn này thấy " +
        "hội thoại của MỌI cơ sở. Chuyển vào `lib/inbox/queries.ts` và gộp " +
        `\`inboxOrgScopeWhere(actor)\`:\n  - ${viPham.join("\n  - ")}\n`,
    ).toEqual([]);
  });

  it("mọi truy vấn ĐỌC trong `queries.ts` truyền `where` bằng BỘ DỰNG, không viết tay", () => {
    // Không đếm số lần gọi `inboxOrgScopeWhere` — đếm là phép đo sai: một bộ dựng
    // dùng cho ba truy vấn vẫn chỉ gọi một lần, mà một `where` viết tay quên lọc
    // thì cũng không làm con số thay đổi.
    //
    // Đo đúng thứ cần đo: `where` phải là LỜI GỌI một trong ba bộ dựng (mỗi bộ tự
    // gộp scope trong thân nó), hoặc là biến ngoại lệ đã đặt tên tường minh.
    const BO_DUNG = ["dungWhere", "whereMotHoiThoai", "whereDem"];
    const NGOAI_LE = [
      // Tin CON của một hội thoại đã qua cổng đơn vị ngay phía trên.
      "whereTinCuaHoiThoai",
      // `where` đã dựng sẵn bằng `dungWhere` rồi truyền cho cả findMany lẫn count.
      "whereDs",
    ];
    const src = fs.readFileSync(path.join(ROOT, "lib/inbox/queries.ts"), "utf8");

    // `db.inboxX.findMany({ where: <biểu thức>` — bắt phần ngay sau `where:`.
    const re =
      /\b\w+\.(inboxConversation|inboxMessage|inboxIdentity)\.(findMany|findFirst|count)\(\{\s*where:\s*([A-Za-z_$][\w$]*)/g;
    const xau: string[] = [];
    let m: RegExpExecArray | null;
    let soTruyVan = 0;
    while ((m = re.exec(src)) !== null) {
      soTruyVan++;
      const bieuThuc = m[3];
      if (!BO_DUNG.includes(bieuThuc) && !NGOAI_LE.includes(bieuThuc)) {
        xau.push(`${m[1]}.${m[2]} dùng \`where: ${bieuThuc}\``);
      }
    }

    // Regex chỉ khớp khi `where` là một ĐỊNH DANH; `where: { … }` viết tay sẽ không
    // khớp và làm số đếm hụt. Kiểm số đếm để chính test này không mục đi trong im lặng.
    const tongDoc = (src.match(
      /\b\w+\.(inboxConversation|inboxMessage|inboxIdentity)\.(findMany|findFirst|count)\(/g,
    ) ?? []).length;
    expect(
      soTruyVan,
      "Có truy vấn hộp thư truyền `where` bằng object literal viết tay. Phải gọi " +
        `một trong các bộ dựng (${BO_DUNG.join(", ")}) để scope đơn vị không thể bị quên.`,
    ).toBe(tongDoc);

    expect(xau, `Truy vấn dùng \`where\` không rõ nguồn:\n  - ${xau.join("\n  - ")}\n`).toEqual([]);
  });

  it("cả ba bộ dựng `where` đều gộp `inboxOrgScopeWhere`", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib/inbox/queries.ts"), "utf8");
    for (const ten of ["dungWhere", "whereMotHoiThoai", "whereDem"]) {
      const i = src.indexOf(`function ${ten}(`);
      expect(i, `không thấy bộ dựng ${ten}`).toBeGreaterThan(-1);
      // Thân hàm = tới khai báo tiếp theo (đủ chính xác cho kiểm tra một dòng gọi).
      const than = src.slice(i, src.indexOf("\nfunction ", i + 1) + 1 || undefined);
      expect(than, `${ten} phải gộp inboxOrgScopeWhere(actor)`).toContain(
        "inboxOrgScopeWhere(",
      );
    }
  });
});

describe("hộp thư KHÔNG giữ cột liên hệ nào", () => {
  it("schema của ba bảng Inbox* không có `phone`/`email`", () => {
    // Quyết định chống rò: bảng không có cột thì không có gì để quên che. Ai thêm
    // `phone` vào đây để "cho tiện" sẽ mở lại đúng loại lỗ mà đợt trước vừa bịt 7 chỗ.
    const schema = fs.readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8");
    for (const model of ["InboxIdentity", "InboxConversation", "InboxMessage"]) {
      const than = schema.slice(schema.indexOf(`model ${model} {`));
      const khoi = than.slice(0, than.indexOf("\n}"));
      expect(khoi, `${model} không được có cột phone`).not.toMatch(/^\s*phone\s/m);
      expect(khoi, `${model} không được có cột email`).not.toMatch(/^\s*email\s/m);
    }
  });
});
