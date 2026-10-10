// @vitest-environment node
/**
 * [DYN-NOHARD-*] — LƯỚI CHỐNG CỨNG HOÁ (SPEC nguồn động §0): lõi quy nguồn + lõi tính hoa hồng KHÔNG được rẽ nhánh theo MÃ nguồn
 * (ngoại lệ DUY NHẤT: "UNKNOWN", 03 T3) và KHÔNG được có tỉ lệ 2%/1% gắn tên nguồn. Hành vi khác nhau theo nguồn phải đi qua THUỘC TÍNH
 * của dòng master (`referrerRequirement` · `requiresNote` · `selectable` · `attributionWindowDays` · `commissionEnabled` · `ownerEmployeeId`)
 * hoặc resolver — để admin tạo nguồn thứ 10 mà không sửa mã.
 *
 * ── Cách quét (hẹp, đếm số lần khớp, bỏ chú thích — luật 11/14) ──────────────────────────────────────────────────────────────
 *  · Quét `lib/hoa-hong` · `lib/nguon` · `lib/crm` · `lib/orders` · `lib/finance` (đợt W5 mở rộng: phép cấy R1 số 6 — `process.env.X === "PAID_ADS"`
 *    trong `lib/crm/commission-run.ts`, đường tính hoa hồng CŨ — từng lọt vì nằm NGOÀI hai thư mục đầu), bỏ tệp test, BỎ CHÚ THÍCH
 *    (giải thích bản vá hay chứa đúng chuỗi đang cấm). Quét trên CẢ VĂN BẢN (không theo dòng) nên so sánh xuống dòng cũng bắt được.
 *  · Mã KHÔNG nhập nhằng (PARENT_REFERRAL · PAID_ADS · CENTER_ORGANIC · WALK_IN · EMPLOYEE_REFERRAL + 6 mã nhãn cũ): cấm — ở BẤT KỲ nơi nào
 *    của tệp quét, với nháy đơn / kép / BACKTICK —
 *      SO_SANH_MA        `=== "X"` · `!== "X"` · `"X" ===` · `case "X":`
 *      TAP_HOP_MA        mã nằm trong dấu `[…]` (mảng `.includes/.indexOf/.some`, `new Set([…])`, truy cập `BANG["X"]`) · `.has/.get/.add/
 *                        .includes/.indexOf…("X")`
 *      KHOA_THEO_MA      khoá đối tượng trỏ tên nguồn (`{ "X": … }`, `{ X: … }`); riêng EMPLOYEE_REFERRAL / PARENT_REFERRAL KHÔNG bị cấm ở dạng khoá
 *                        TRẦN vì trùng tên enum `SourceIdentificationMethod` (xem `nhan-hien-thi.ts`)
 *      TOAN_TU_BA_NGOI   `cond ? "X" : …` · `cond ? … : "X"` (dấu `?:` của thuộc tính tuỳ chọn KHÔNG tính)
 *      SO_SANH_QUA_BIEN  `const K = "X"` rồi `=== K` · `case K:` · `.includes(K)` · `[K]` (bí danh bay hơi)
 *  · Mã NHẬP NHẰNG (EVENT · OTHER · PARTNER — trùng tên với phạm vi chính sách, loại yêu cầu người giới thiệu, nhóm ngày nghỉ, thành phần
 *    doanh thu): CHỈ cấm khi vế trái là một biến mã nguồn (`code` · `groupCode` · `nhomCode` · `sourceGroupCode` · `.code`) — nếu cấm
 *    `case "EVENT":` thì chặn oan `switch (referrerRequirement)` / `switch (scopeType)`.
 *  · TI_LE_GAN_TEN: mã nguồn VÀ `0.01`/`0.02`/`"2%"`/`"1%"` trong CỬA SỔ ±2 dòng (hai dòng riêng `const K = …` / `const R = 0.01` từng lọt).
 *  · Ngoại lệ KHAI TƯỜNG MINH bên dưới, có lý do — tệp ngoài danh sách mà vi phạm là đỏ.
 *
 * Lưới này đã được CẤY lỗi hai đợt: (1) thêm `if (group.code === "PAID_ADS")` vào chon-quy-tac, `case "WALK_IN":`, `code === "OTHER"`, tỉ lệ gắn tên
 * nguồn; (2) đợt W5 cấy lại 8 phép của reviewer R1 (5 phép lọt bản cũ) + 5 dạng thêm trên TỆP THẬT, khôi phục byte-exact — xem commit.
 * Bản đối chứng dương `[DYN-NOHARD-02]` giữ 11 dạng đó ở dạng bộ nhớ để mọi lần chạy đều đo lại.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MA_KHONG_NHAP_NHANG = [
  "PARENT_REFERRAL",
  "PAID_ADS",
  "CENTER_ORGANIC",
  "WALK_IN",
  "EMPLOYEE_REFERRAL",
  // mã nhãn cũ (bốn nhóm nhân sự trước khi gộp · hai nhóm đổi tên) — không có lý do nào xuất hiện trong so sánh của lõi
  "SALE_REFERRAL",
  "MANAGEMENT_REFERRAL",
  "TEACHER_REFERRAL",
  "STAFF_REFERRAL",
  "ADVERTISING",
  "CENTER_CONTENT",
] as const;
const MA_NHAP_NHANG = ["EVENT", "OTHER", "PARTNER"] as const;
/** Hai mã trùng tên với `SourceIdentificationMethod` (EMPLOYEE_REFERRAL · PARENT_REFERRAL): khoá TRẦN của đối tượng có thể là enum cách xác định. */
const MA_TRUNG_ENUM_CACH_XAC_DINH = new Set<string>(["EMPLOYEE_REFERRAL", "PARENT_REFERRAL"]);

/** Thư mục lõi bị quét. `lib/crm` · `lib/orders` · `lib/finance` thêm ở đợt W5 (đường tính hoa hồng cũ + chốt đơn + sổ tiền). */
const THU_MUC_QUET = ["lib/hoa-hong", "lib/nguon", "lib/crm", "lib/orders", "lib/finance"] as const;

/** Tệp được PHÉP nhắc mã nguồn trong so sánh/tỉ lệ — mỗi dòng một LÝ DO. Thêm tệp vào đây là một quyết định, không phải một cú sửa lưới. */
const NGOAI_LE: Readonly<Record<string, string>> = {
  "lib/nguon/danh-muc-goc.ts": "DỮ LIỆU MẶC ĐỊNH: 9 dòng master gốc (lưới [NHH-SRC-01c] so với migration)",
  "lib/nguon/anh-xa-nhan-cu.ts": "ADAPTER nhãn cũ 28 dòng → nguồn mới (dữ liệu lịch sử của văn bản 06/10)",
  "lib/nguon/di-tru-bang.ts": "bảng di trú nhãn cũ × nguồn đích (công cụ chạy tay)",
  "lib/nguon/di-tru-db.ts": "đọc dữ liệu di trú nhãn cũ (công cụ chạy tay)",
  "lib/hoa-hong/ke-hoach-seed-v1.ts": "SEED chính sách mặc định: nơi DUY NHẤT tỉ lệ 2%/1% gắn tên nguồn được phép sống (policy, không phải hằng của lõi)",
};

const NHAY = "[\"'`]";
const BIEN_MA = String.raw`(?:\b(?:code|groupCode|nhomCode|sourceGroupCode|maNhom)|\.code)`;

/** Bỏ chú thích khối + dòng (tránh `://` của URL). Giữ số dòng để báo lỗi. */
export function boChuThich(v: string): string {
  return v
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

export type ViPham = {
  dong: number;
  loai: "SO_SANH_MA" | "TI_LE_GAN_TEN" | "TAP_HOP_MA" | "KHOA_THEO_MA" | "TOAN_TU_BA_NGOI" | "SO_SANH_QUA_BIEN";
  trich: string;
};

/** Cửa sổ (số dòng mỗi phía) để một tỉ lệ được coi là "gắn" với mã nguồn. */
const CUA_SO_TI_LE = 2;

/** THUẦN — quét một tệp ĐÃ bỏ chú thích. Quét trên CẢ VĂN BẢN (một so sánh xuống dòng vẫn bị bắt); mỗi (dòng, loại) báo MỘT lần. */
export function quetCungHoa(src: string): ViPham[] {
  const dong = src.split(/\r?\n/);
  const dongCuaViTri = (vt: number): number => src.slice(0, vt).split("\n").length;
  const ra: ViPham[] = [];
  const thay = new Set<string>();
  const ghi = (vt: number, loai: ViPham["loai"]): void => {
    const d = dongCuaViTri(vt);
    const khoa = `${d}:${loai}`;
    if (thay.has(khoa)) return;
    thay.add(khoa);
    ra.push({ dong: d, loai, trich: (dong[d - 1] ?? "").trim() });
  };
  const quet = (re: RegExp, loai: ViPham["loai"], viTri: (m: RegExpExecArray) => number = (m) => m.index): void => {
    for (const m of src.matchAll(re)) ghi(viTri(m as RegExpExecArray), loai);
  };

  const khongNhapNhang = MA_KHONG_NHAP_NHANG.join("|");
  const nhapNhang = MA_NHAP_NHANG.join("|");
  const duyNhat = MA_KHONG_NHAP_NHANG.filter((m) => !MA_TRUNG_ENUM_CACH_XAC_DINH.has(m)).join("|");
  const lit = `${NHAY}(?:${khongNhapNhang})${NHAY}`;

  // 1) so sánh trực tiếp (nháy đơn/kép/backtick; một vế hay cả hai; xuống dòng được)
  quet(new RegExp(String.raw`(?:[!=]==?\s*${lit}|${lit}\s*[!=]==?|\bcase\s+${lit}\s*:)`, "g"), "SO_SANH_MA");
  quet(new RegExp(String.raw`${BIEN_MA}\s*[!=]==?\s*${NHAY}(?:${nhapNhang})${NHAY}`, "g"), "SO_SANH_MA");
  quet(new RegExp(String.raw`${NHAY}(?:${nhapNhang})${NHAY}\s*[!=]==?\s*${BIEN_MA}`, "g"), "SO_SANH_MA");

  // 2) tập hợp / tra cứu theo mã: mã nằm trong `[…]`, hoặc là đối số của .has/.get/.includes…
  quet(new RegExp(String.raw`\[[^\[\]]*${lit}[^\[\]]*\]`, "g"), "TAP_HOP_MA");
  quet(new RegExp(String.raw`\.(?:includes|indexOf|lastIndexOf|has|get|add|set|delete|startsWith|endsWith|test|localeCompare)\(\s*${lit}`, "g"), "TAP_HOP_MA");

  // 3) khoá đối tượng trỏ tên nguồn: `{ "X": … }`, `, X: …`. Khoá TRẦN của hai mã trùng tên enum `SourceIdentificationMethod` thì bỏ qua.
  quet(new RegExp(String.raw`[{,]\s*${lit}\s*:`, "g"), "KHOA_THEO_MA", (m) => m.index + 1 + m[0].slice(1).search(/\S/));
  quet(new RegExp(String.raw`(?:^|[{,])\s*(?:${duyNhat})\s*:(?!:)`, "gm"), "KHOA_THEO_MA", (m) => m.index + m[0].search(/[A-Z]/));

  // 4) toán tử ba ngôi chọn mã (dấu `?:` của thuộc tính tuỳ chọn và `?.` không tính)
  quet(new RegExp(String.raw`(?<!\?)\?(?![:.?])\s*${lit}\s*:`, "g"), "TOAN_TU_BA_NGOI");
  quet(new RegExp(String.raw`(?<!\?)\?(?![:.?])[^?:;\n]*:\s*${lit}`, "g"), "TOAN_TU_BA_NGOI");

  // 5) bí danh: `const K = "X"` rồi dùng K để so sánh / tra. Khai báo trơn và truyền K làm đối số hàm thường thì không phải so sánh.
  const reBiDanh = new RegExp(String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=;\n]+)?\s*=\s*${lit}`, "g");
  for (const m of src.matchAll(reBiDanh)) {
    const k = (m[1] ?? "").replace(/\$/g, String.raw`\$`);
    if (!k) continue;
    quet(new RegExp(String.raw`(?:[!=]==?\s*\b${k}\b(?!\s*[.(\w])|(?<![\w.$])${k}\s*[!=]==?|\bcase\s+${k}\s*:|\.(?:includes|indexOf|lastIndexOf|has|get|add|set|delete)\(\s*${k}\b|\[\s*${k}\s*\])`, "g"), "SO_SANH_QUA_BIEN");
  }

  // 6) tỉ lệ gắn tên nguồn: mã nguồn (nháy hay trần) và 0.01/0.02/"2%"/"1%" cách nhau không quá CUA_SO_TI_LE dòng
  const reMaNguon = new RegExp(String.raw`\b(?:${khongNhapNhang})\b`);
  const reTiLe = /(?<![\w.])0?\.0[12]\b|["'][12]%["']|\b[12]\s*%/;
  dong.forEach((d, i) => {
    if (!reMaNguon.test(d)) return;
    const tu = Math.max(0, i - CUA_SO_TI_LE);
    const den = Math.min(dong.length - 1, i + CUA_SO_TI_LE);
    for (let j = tu; j <= den; j++) {
      if (reTiLe.test(dong[j] ?? "")) {
        const khoa = `${i + 1}:TI_LE_GAN_TEN`;
        if (!thay.has(khoa)) {
          thay.add(khoa);
          ra.push({ dong: i + 1, loai: "TI_LE_GAN_TEN", trich: d.trim() });
        }
        break;
      }
    }
  });

  return ra.sort((a, b) => a.dong - b.dong || a.loai.localeCompare(b.loai));
}

describe("[DYN-NOHARD-01] bộ quét tự chứng minh: mỗi dạng vi phạm bị bắt ĐÚNG; dạng hợp lệ không bị bắt oan", () => {
  const loai = (src: string) => quetCungHoa(boChuThich(src)).map((v) => v.loai);

  it("mã KHÔNG nhập nhằng: `===`, `!==`, `case` ⇒ 3 lần; ngược lại (vế phải/ trái đảo) cũng bắt", () => {
    const mau = [
      'if (group.code === "PAID_ADS") x();',
      'if (nhomCode !== "WALK_IN") y();',
      'switch (k) { case "PARENT_REFERRAL": return 1; }',
      'const ok = "EMPLOYEE_REFERRAL" === g.code;',
    ].join("\n");
    const v = quetCungHoa(mau);
    expect(v.filter((x) => x.loai === "SO_SANH_MA")).toHaveLength(4);
  });

  it("mã NHẬP NHẰNG: chỉ bắt khi vế trái là biến mã nguồn; `case \"EVENT\":` của switch phạm vi / loại yêu cầu KHÔNG bị bắt oan", () => {
    expect(quetCungHoa('if (code === "OTHER") z();')).toHaveLength(1);
    expect(quetCungHoa('if (nhom.groupCode !== "PARTNER") z();')).toHaveLength(1);
    expect(quetCungHoa('if (x.code === "EVENT") z();')).toHaveLength(1);
    expect(quetCungHoa('switch (req) {\n case "EVENT":\n  return null;\n case "NONE":\n  return 1;\n}')).toHaveLength(0);
    expect(quetCungHoa('return n.referrerRequirement === "NONE" || n.referrerRequirement === "EVENT";')).toHaveLength(0);
    expect(quetCungHoa('const t = c.kind === "OTHER";')).toHaveLength(0);
    expect(quetCungHoa('const ds = ["NONE", "EVENT", "OTHER"];')).toHaveLength(0);
  });

  it('"UNKNOWN" là ngoại lệ DUY NHẤT: so sánh mã UNKNOWN không bị bắt; gán/khai báo mã (không so sánh) không bị bắt', () => {
    expect(quetCungHoa('const unknown = !nguon || nguon.groupCode === "UNKNOWN";')).toHaveLength(0);
    expect(quetCungHoa('const DICH = { quangCao: "PAID_ADS", phuHuynh: "PARENT_REFERRAL" };')).toHaveLength(0);
    expect(quetCungHoa('return ket("EMPLOYEE_REFERRAL", stt);')).toHaveLength(0);
    // trùng tên với enum SourceIdentificationMethod: khoá TRẦN và giá trị `method:` KHÔNG phải mã nhóm nguồn
    expect(quetCungHoa('const NHAN = {\n  EMPLOYEE_REFERRAL: "Nhân sự giới thiệu",\n  PARENT_REFERRAL: "Phụ huynh giới thiệu",\n};')).toHaveLength(0);
    expect(quetCungHoa('return { groupCode: g, method: "EMPLOYEE_REFERRAL", ly: "x" };')).toHaveLength(0);
  });

  it("tỉ lệ gắn tên nguồn: dòng có mã nguồn + 0.02 / 0.01 / '2%' bị bắt; số tiền/tỉ lệ KHÔNG gắn tên nguồn thì không", () => {
    const v = quetCungHoa(
      boChuThich(['const rate = 0.02; // x', 'nhom("PARENT_REFERRAL", 0.02);', 'tiLe["PAID_ADS"] = 0.01;', 'const bang = { PARENT_REFERRAL: 0.02 };', "", "", "", 'const nhan = "PARENT_REFERRAL"; // 2%', "", "", "", 'moTa("EMPLOYEE_REFERRAL", "2%");'].join("\n")),
    );
    // dòng 8 (chỉ có `// 2%` trong chú thích) KHÔNG bị bắt: chú thích đã bỏ, và 0.02 ở dòng 4 cách 4 dòng (> cửa sổ 2)
    expect(v.filter((x) => x.loai === "TI_LE_GAN_TEN").map((x) => x.dong)).toEqual([2, 3, 4, 12]);
  });

  // ── Các dạng R1 cấy lọt lưới cũ (gt2 M6): MỖI dạng phải bị bắt, đúng loại ────────────────────────────────────────────────
  it("[DYN-NOHARD-01b] tập hợp mã: `[…].includes(…)`, `new Set([…]).has(…)`, `.has(\"X\")`, truy cập `[\"X\"]` ⇒ TAP_HOP_MA", () => {
    expect(loai('const q = ["PAID_ADS"].includes(c.code);')).toEqual(["TAP_HOP_MA"]);
    expect(loai("const q = ['WALK_IN', 'CENTER_ORGANIC'].indexOf(g) >= 0;")).toEqual(["TAP_HOP_MA"]);
    expect(loai('const S = new Set(["WALK_IN"]);\nif (S.has(g)) y();')).toEqual(["TAP_HOP_MA"]);
    expect(loai('if (dich.has("PAID_ADS")) y();')).toEqual(["TAP_HOP_MA"]);
    expect(loai('const t = BANG["PAID_ADS"];')).toEqual(["TAP_HOP_MA"]);
    expect(loai("const t = [`PAID_ADS`].some((m) => m === g);")).toEqual(["TAP_HOP_MA"]);
  });

  it("[DYN-NOHARD-01c] so sánh bằng BACKTICK, so sánh XUỐNG DÒNG, `case` bằng backtick ⇒ SO_SANH_MA", () => {
    expect(loai("const q = c.code === `PAID_ADS`;")).toEqual(["SO_SANH_MA"]);
    expect(loai('if (c.sourceGroupId ===\n  "PAID_ADS") x();')).toEqual(["SO_SANH_MA"]);
    expect(loai("switch (c) {\n  case `WALK_IN`:\n    break;\n}")).toEqual(["SO_SANH_MA"]);
    expect(loai('if (process.env.X === "PAID_ADS") y();')).toEqual(["SO_SANH_MA"]);
  });

  it("[DYN-NOHARD-01d] khoá đối tượng trỏ tên nguồn (có nháy hoặc trần) và toán tử ba ngôi chọn mã ⇒ KHOA_THEO_MA / TOAN_TU_BA_NGOI", () => {
    expect(loai('const T = { "PAID_ADS": x };')).toEqual(["KHOA_THEO_MA"]);
    expect(loai("const T = {\n  a: 1,\n  WALK_IN: x,\n};")).toEqual(["KHOA_THEO_MA"]);
    expect(loai('const g = laQuangCao ? "PAID_ADS" : x;')).toEqual(["TOAN_TU_BA_NGOI"]);
    expect(loai('const g = laQuangCao ? x : `WALK_IN`;')).toEqual(["TOAN_TU_BA_NGOI"]);
    // dấu `?:` của thuộc tính tuỳ chọn KHÔNG phải toán tử ba ngôi
    expect(loai('type T = { nguon?: "PAID_ADS" };')).toEqual([]);
  });

  it("[DYN-NOHARD-01e] mã và tỉ lệ ở HAI DÒNG khác nhau (cửa sổ ±2 dòng) ⇒ TI_LE_GAN_TEN; cách 3 dòng thì không", () => {
    expect(loai('const K = "PAID_ADS";\nconst R = 0.01;')).toEqual(["TI_LE_GAN_TEN"]);
    expect(loai('const a = "PAID_ADS";\nconst z = 1;\nconst R = 0.01;')).toEqual(["TI_LE_GAN_TEN"]);
    expect(loai('const a = "PAID_ADS";\nconst z = 1;\nconst y = 2;\nconst R = 0.01;')).toEqual([]);
    expect(loai('const T = {\n  PAID_ADS:\n    f(),\n    0.01,\n};')).toContain("TI_LE_GAN_TEN");
  });

  it("[DYN-NOHARD-01f] bí danh: `const K = \"PAID_ADS\"` rồi so sánh / tra bằng K ⇒ SO_SANH_QUA_BIEN (khai báo trơn thì không)", () => {
    expect(loai('const K = "PAID_ADS";\nif (x.code === K) y();')).toEqual(["SO_SANH_QUA_BIEN"]);
    expect(loai('const K = `WALK_IN`;\nconst ok = K !== g.code;')).toEqual(["SO_SANH_QUA_BIEN"]);
    expect(loai('const K = "PAID_ADS";\nswitch (c) {\n  case K:\n    break;\n}')).toEqual(["SO_SANH_QUA_BIEN"]);
    expect(loai('const K = "PAID_ADS";\nif (DS.includes(K)) y();')).toEqual(["SO_SANH_QUA_BIEN"]);
    expect(loai('const K = "PAID_ADS";\nreturn ket(K, 1);')).toEqual([]);
    expect(loai('const KHAC = 5;\nif (x === KHAC) y();')).toEqual([]);
  });
});

describe("[DYN-NOHARD-02] lõi quy nguồn + lõi hoa hồng KHÔNG so mã nguồn (trừ UNKNOWN) và KHÔNG có tỉ lệ gắn tên nguồn", () => {
  function tepCanQuet(): string[] {
    const ra = execFileSync("git", ["ls-files", "--", ...THU_MUC_QUET], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
      .split(/\r?\n/)
      .filter((d) => /\.(ts|tsx)$/.test(d))
      .filter((d) => !/\.(test|spec)\.(ts|tsx)$/.test(d))
      .filter((d) => existsSync(resolve(process.cwd(), d)));
    // Tệp MỚI chưa `git add` cũng phải bị quét (lưới không được mù với thứ vừa viết)
    const moi = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", ...THU_MUC_QUET], { cwd: process.cwd(), encoding: "utf8" })
      .split(/\r?\n/)
      .filter((d) => /\.(ts|tsx)$/.test(d) && !/\.(test|spec)\.(ts|tsx)$/.test(d));
    return [...new Set([...ra, ...moi])];
  }

  it("quét ĐƯỢC tệp (không quét rỗng), phủ CẢ năm thư mục, và mọi ngoại lệ khai tường minh đều CÒN TỒN TẠI (không để danh sách mục)", () => {
    const tep = tepCanQuet();
    expect(tep.length).toBeGreaterThan(300);
    for (const thuMuc of THU_MUC_QUET) {
      expect(tep.filter((t) => t.startsWith(`${thuMuc}/`)).length, `${thuMuc} không có tệp nào được quét`).toBeGreaterThan(5);
    }
    // đường tính hoa hồng CŨ (lib/crm/commission-run.ts) phải nằm trong tầm quét: phép cấy R1 số 6 từng lọt vì nó ở NGOÀI thư mục quét
    expect(tep).toContain("lib/crm/commission-run.ts");
    for (const t of Object.keys(NGOAI_LE)) {
      expect(tep, `ngoại lệ ${t} không còn là tệp được quét — xoá khỏi danh sách`).toContain(t);
      expect(NGOAI_LE[t]!.length).toBeGreaterThan(20);
    }
  });

  it("0 vi phạm ngoài danh sách ngoại lệ (báo tệp:dòng nếu có)", () => {
    const vp = tepCanQuet()
      .filter((t) => !(t in NGOAI_LE))
      .flatMap((t) => quetCungHoa(boChuThich(readFileSync(resolve(process.cwd(), t), "utf8"))).map((v) => `${t}:${v.dong} [${v.loai}] ${v.trich}`));
    expect(vp).toEqual([]);
  });

  it("đối chứng dương trên TỆP THẬT: nhét từng dạng vi phạm (gồm 8 phép R1 từng lọt) vào văn bản của chon-quy-tac.ts / commission-run.ts thì bộ quét bắt đúng loại", () => {
    const goc = readFileSync(resolve(process.cwd(), "lib/hoa-hong/chon-quy-tac.ts"), "utf8");
    const gocCrm = readFileSync(resolve(process.cwd(), "lib/crm/commission-run.ts"), "utf8");
    expect(quetCungHoa(boChuThich(goc))).toHaveLength(0);
    expect(quetCungHoa(boChuThich(gocCrm))).toHaveLength(0);
    const cay = goc.replace("function khopPhamVi(", 'function khopPhamVi(\n  // cấy\n  void (0 as unknown as { code: string }).code === "PAID_ADS";\n');
    expect(cay).not.toBe(goc);
    expect(quetCungHoa(boChuThich(cay)).filter((v) => v.loai === "SO_SANH_MA")).toHaveLength(1);

    const R1: ReadonlyArray<{ ten: string; them: string; ky: ViPham["loai"]; tep?: "crm" }> = [
      { ten: "R1-1 một dòng", them: 'if (c.sourceGroupId === "PAID_ADS") x();', ky: "SO_SANH_MA" },
      { ten: "R1-2 mảng .includes", them: 'const q = ["PAID_ADS"].includes(c.code);', ky: "TAP_HOP_MA" },
      { ten: "R1-3 backtick", them: "const q = c.code === `PAID_ADS`;", ky: "SO_SANH_MA" },
      { ten: "R1-4 khoá + 0.01 trên 3 dòng", them: "const T = {\n  PAID_ADS:\n    f(),\n    0.01,\n};", ky: "TI_LE_GAN_TEN" },
      { ten: "R1-5 hai dòng riêng K / R", them: 'const K = "PAID_ADS";\nconst R = 0.01;', ky: "TI_LE_GAN_TEN" },
      { ten: "R1-6 ngoài thư mục cũ (lib/crm)", them: 'if (process.env.X === "PAID_ADS") y();', ky: "SO_SANH_MA", tep: "crm" },
      { ten: "R1-7 nhiều dòng", them: 'if (c.sourceGroupId ===\n  "PAID_ADS") x();', ky: "SO_SANH_MA" },
      { ten: "Set.has", them: 'const S = new Set(["WALK_IN"]);\nif (S.has(g)) y();', ky: "TAP_HOP_MA" },
      { ten: "switch backtick", them: "switch (c) {\n  case `WALK_IN`:\n    break;\n}", ky: "SO_SANH_MA" },
      { ten: "ba ngôi", them: 'const g = laQuangCao ? "PAID_ADS" : x;', ky: "TOAN_TU_BA_NGOI" },
      { ten: "bí danh", them: 'const K = "PAID_ADS";\nif (x.code === K) y();', ky: "SO_SANH_QUA_BIEN" },
    ];
    for (const ca of R1) {
      const nen = ca.tep === "crm" ? gocCrm : goc;
      const v = quetCungHoa(boChuThich(`${nen}\n${ca.them}\n`));
      expect(
        v.map((x) => x.loai),
        `phép cấy "${ca.ten}" phải bị bắt đúng loại ${ca.ky}`,
      ).toContain(ca.ky);
    }
  });
});
