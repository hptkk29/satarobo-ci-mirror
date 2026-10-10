// @vitest-environment node
/**
 * [CLC-W*] — LƯỚI GHIM MÃ NGUỒN cho «chụp lại chủ nguồn» (W3). Hành vi đã có ca Postgres thật ([CLC-DB-*]); lưới này canh những thứ mà hành vi KHÔNG chứng minh được vì chúng là
 * «ai gọi ai» / «ai được ghi bảng nào»:
 *
 *   [CLC-W1] đúng MỘT `UPDATE "LeadAttribution"` thô trong cả cây mã và nó nằm ở `ghi-nguon.ts` (tầng ghi duy nhất); không accessor ghi nào mới
 *   [CLC-W2] phép ghi chỉ đổi `chuNhanVienId`: KHÔNG chạm `cuaSoNgay` · `attributedAt` · `groupId` · `changeReason` (đổi cửa sổ/nhóm là hồi tố)
 *   [CLC-W3] dịch vụ: khoá advisory + khoá hàng nguồn + khoá dòng + MỘT lời gọi ghi + audit TRONG transaction; so `chuDuKien`; không phát sự kiện đổi nguồn, không đi qua `suaNguon`
 *   [CLC-W4] Server Action: "use server", chỉ export hàm async, không chạm bảng nguồn, không vòng lặp (một lô mỗi lượt), cờ SAU cổng quyền
 *   [CLC-W5] trang chi tiết nguồn: đọc + vẽ nút CHỈ khi đủ HAI khoá của action; mục «Đối tượng liên quan» chỉ vẽ khi có lead cần chụp
 *   [CLC-W6] giao diện (client) KHÔNG import tệp luật có mã máy chủ (`-luat`), chỉ `-nhan`
 *
 * Neo chuỗi hẹp trên mã ĐÃ BỎ chú thích, khẳng định cả SỐ LẦN khớp (luật 11). Đã cấy lỗi — xem commit.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ALL_ACTIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../prisma/seed-roles";

const GOC = process.cwd();

/** Bỏ chú thích dòng TRƯỚC rồi khối (chú thích dòng hay nhắc `lib/nguon/*` — chuỗi `/*` mở nhầm một «khối» nuốt mã thật). Không đụng `://` trong chuỗi. */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (p: string) => boChuThich(readFileSync(resolve(GOC, p), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

function duyet(dir: string, ra: string[]): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next" || e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) duyet(p, ra);
    else if (/\.(ts|tsx|mts)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name)) ra.push(p);
  }
  return ra;
}

/** Thân hàm `export async function <ten>(...) { ... }` (đếm ngoặc). */
function thanHam(src: string, ten: string): string | null {
  const bat = src.indexOf(`export async function ${ten}(`);
  if (bat < 0) return null;
  let i = src.indexOf("(", bat);
  let sau = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") sau++;
    else if (src[i] === ")" && --sau === 0) break;
  }
  const mo = src.indexOf("{", i);
  let d = 0;
  for (let j = mo; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}" && --d === 0) return src.slice(mo + 1, j);
  }
  return null;
}

const GHI = "lib/nguon/ghi-nguon.ts";
const DICH_VU = "lib/nguon/chup-lai-chu-nguon.ts";
const ACTION = "app/(admin)/admin/nguon-hoa-hong/nguon/_actions-chup-lai.ts";
const TRANG = "app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/page.tsx";
const MUC = "components/admin/nguon-hoa-hong/chi-tiet-nguon/muc-doi-tuong.tsx";
const NUT = "components/admin/nguon-hoa-hong/chup-lai-chu-nguon.tsx";

describe("[CLC-W1] tầng ghi: đúng MỘT câu UPDATE thô vào bảng quy nguồn, ở ghi-nguon.ts", () => {
  it("quét cả cây (app · lib · components · scripts): 1 lần, đúng tệp", () => {
    const tep = ["app", "lib", "components", "scripts"].flatMap((t) => duyet(resolve(GOC, t), []));
    expect(tep.length, "lưới quét rỗng").toBeGreaterThan(300);
    const re = /UPDATE\s+"LeadAttribution"/gi;
    // Lọc rẻ trước (tên bảng có trong tệp không) rồi mới bỏ chú thích: quét hàng nghìn tệp mà bỏ chú thích từng tệp thì chậm.
    const co = tep
      .map((p) => ({ p: relative(GOC, p).replace(/\\/g, "/"), t: readFileSync(p, "utf8") }))
      .filter((x) => x.t.includes('"LeadAttribution"'))
      .map((x) => ({ p: x.p, n: dem(boChuThich(x.t), re) }))
      .filter((x) => x.n > 0);
    expect(co).toEqual([{ p: GHI, n: 1 }]);
  }, 60_000);

  it("dịch vụ và action KHÔNG ghi bảng quy nguồn (không UPDATE/INSERT/DELETE thô, không accessor ghi)", () => {
    for (const p of [DICH_VU, ACTION, "lib/nguon/chup-lai-chu-nguon-doc.ts", "lib/nguon/chup-lai-chu-nguon-sql.ts"]) {
      const ma = doc(p);
      expect(ma, p).not.toMatch(/(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+"LeadAttribution"/i);
      expect(ma, p).not.toMatch(/\.leadAttribution\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
    }
  });
});

describe("[CLC-W2] phép ghi chỉ đổi chuNhanVienId", () => {
  const than = thanHam(doc(GHI), "ghiChuNguonChupLo") ?? "";
  it("thân hàm tồn tại và có đúng MỘT jsonb_set vào '{nguon,chuNhanVienId}'", () => {
    expect(than.length).toBeGreaterThan(100);
    expect(dem(than, /jsonb_set\(/g)).toBe(1);
    expect(dem(than, /'\{nguon,chuNhanVienId\}'/g)).toBe(1);
    expect(than).toMatch(/jsonb_set\("signals", '\{nguon,chuNhanVienId\}', to_jsonb\(\$\{p\.chuMoi\}::text\), false\)/); // `false`: không tạo khoá mới
  });
  it("không động tới cửa sổ · ngày ghi nhận · nhóm · lý do đổi nguồn (đổi các cột đó là hồi tố / là «đổi nguồn»)", () => {
    expect(than).not.toMatch(/cuaSoNgay|attributedAt|originalGroupId|changeReason|changedById|"referrer/);
    // Tập SET gồm đúng hai cột: signals + updatedAt.
    const set = /SET\s+([\s\S]*?)\s+WHERE/.exec(than)?.[1] ?? "";
    expect([...set.matchAll(/"(\w+)"\s*=/g)].map((m) => m[1])).toEqual(["signals", "updatedAt"]);
    expect(than).toMatch(/"updatedAt"\s*=\s*\$\{p\.now\}/); // đồng hồ do người gọi đưa (luật 19), không NOW() của DB
    expect(than).not.toMatch(/\bNOW\(\)|clock_timestamp|CURRENT_TIMESTAMP/i);
  });
  it("WHERE tự kiểm lại: đúng nguồn · bản chụp hợp lệ · còn thuộc diện", () => {
    expect(than).toMatch(/"groupId" = \$\{p\.nguonId\}/);
    expect(than).toMatch(/\$\{BAN_CHUP_HOP_LE\}/);
    expect(than).toMatch(/\$\{dieuKienTheoChu\(/);
  });
});

describe("[CLC-W3] dịch vụ điều phối một lô", () => {
  const ma = doc(DICH_VU);
  it("khoá advisory + khoá hàng nguồn FOR SHARE + khoá dòng FOR UPDATE, mỗi thứ đúng một lần, trong $transaction", () => {
    expect(dem(ma, /pg_advisory_xact_lock/g)).toBe(1);
    expect(dem(ma, /FOR SHARE/g)).toBe(1);
    expect(dem(ma, /FOR UPDATE/g)).toBe(1);
    expect(dem(ma, /db\.\$transaction\(/g)).toBe(1);
    const iTx = ma.indexOf("db.$transaction(");
    for (const m of [/pg_advisory_xact_lock/, /FOR SHARE/, /FOR UPDATE/, /ghiChuNguonChupLo\(/, /writeAudit\(/]) expect(ma.search(m), String(m)).toBeGreaterThan(iTx);
  });
  it("thứ tự: advisory → FOR SHARE nguồn → FOR UPDATE dòng → ghi → audit", () => {
    const vt = [/pg_advisory_xact_lock/, /FOR SHARE/, /FOR UPDATE/, /ghiChuNguonChupLo\(/, /writeAudit\(/].map((m) => ma.search(m));
    expect([...vt].sort((a, b) => a - b)).toEqual(vt);
    expect(vt.every((v) => v >= 0)).toBe(true);
  });
  it("đúng MỘT lời gọi ghi và MỘT audit; audit mang tx (cùng transaction) và lý do", () => {
    expect(dem(ma, /ghiChuNguonChupLo\(/g)).toBe(1);
    expect(dem(ma, /writeAudit\(/g)).toBe(1);
    const a = ma.slice(ma.indexOf("writeAudit("));
    expect(a.slice(0, 120)).toMatch(/tx,/);
    expect(a).toMatch(/reason:\s*lyDo/);
    expect(a).toMatch(/action:\s*"NGUON_CHUP_LAI_CHU"/);
  });
  it("audit chỉ khi có dòng được ghi (chạy lại không để dấu giả)", () => {
    expect(ma).toMatch(/if \(ids\.length > 0\) \{\s*await writeAudit\(/);
  });
  it("so chủ người bấm đã thấy với chủ đọc LẠI sau khoá (đúng một chỗ), và kiểm chủ hiện tại hợp lệ", () => {
    expect(dem(ma, /chu\.employeeId !== p\.chuDuKien/g)).toBe(1);
    expect(dem(ma, /kiemChuHienTai\(/g)).toBe(1);
    expect(ma.search(/chu\.employeeId !== p\.chuDuKien/)).toBeLessThan(ma.search(/ghiChuNguonChupLo\(/));
  });
  it("không phát DomainEvent đổi nguồn, không đi qua suaNguon / doiNguonLead (đây không phải đổi nguồn của lead)", () => {
    expect(ma).not.toMatch(/publishEvent|nguon\.da-doi-sau-thanh-toan|suaNguon\(|doiNguonLead\(|doiNguon\(/);
  });
  it("cỡ lô bị chặn trước mọi truy vấn (trần CO_LO_TOI_DA)", () => {
    expect(ma.search(/p\.coLo > CO_LO_TOI_DA/)).toBeGreaterThan(0);
    expect(ma.search(/p\.coLo > CO_LO_TOI_DA/)).toBeLessThan(ma.indexOf("db.$transaction("));
  });
});

describe("[CLC-W4] Server Action", () => {
  const goc = readFileSync(resolve(GOC, ACTION), "utf8");
  const ma = boChuThich(goc);
  const than = thanHam(ma, "chupLaiChuNguonAction") ?? "";
  it('"use server" là câu đầu; chỉ export hàm async (loader của Next sinh export GIÁ TRỊ cho mọi export)', () => {
    expect(goc.trimStart().startsWith('"use server"')).toBe(true);
    const exports = [...ma.matchAll(/^export\s+(.*)$/gm)].map((m) => m[1]!);
    expect(exports.length).toBe(1);
    expect(exports[0]).toMatch(/^async function chupLaiChuNguonAction\(/);
  });
  it("hai khoá thật (∈ ALL_ACTIONS, có vai giữ cả hai) — đúng thứ tự, trước mọi await khác; cờ nguồn SAU cổng quyền", () => {
    const khoa = [...than.matchAll(/await\s+checkPermission\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]!);
    expect(khoa).toEqual(["sources:manage", "commission_policies:activate"]);
    for (const k of khoa) expect(ALL_ACTIONS as readonly string[], k).toContain(k);
    const vaiGiuCaHai = ROLE_SEED.filter((r) => khoa.every((k) => r.perms.some((p) => p.action === k))).map((r) => r.code);
    expect(vaiGiuCaHai.length, "không vai nào giữ cả hai khoá ⇒ nút chết với MỌI người").toBeGreaterThan(0);
    expect(than.search(/laQuanLyNguonBat\(/)).toBeGreaterThan(than.lastIndexOf("checkPermission("));
  });
  it("một lô mỗi lượt gọi: KHÔNG vòng lặp (for/while/do) trong action; cỡ lô là hằng CO_LO_CHUP_LAI; đồng hồ do action đưa", () => {
    expect(than).not.toMatch(/\b(?:for|while|do)\b\s*[({]/);
    expect(dem(than, /coLo:\s*CO_LO_CHUP_LAI/g)).toBe(1);
    expect(dem(than, /now:\s*new Date\(\)/g)).toBe(1);
    expect(dem(than, /chupLaiChuNguonMotLo\(/g)).toBe(1);
  });
  it("không chạm bảng quy nguồn (tên bảng / accessor) — lưới [QN-W11] cho `app/**`", () => {
    expect(goc).not.toMatch(/leadAttribution|"LeadAttribution"|leadTouchpoint/);
  });
  it("KHÔNG làm mới trang sau mỗi lô (không import next/cache, không revalidatePath/revalidateTag): lô cuối làm nút biến mất và gỡ hộp thoại đang chạy", () => {
    expect(ma).not.toMatch(/next\/cache|revalidatePath|revalidateTag|\bredirect\(|refresh\(/);
  });
});

describe("[CLC-W5] trang chi tiết nguồn vẽ nút nói thật (luật 12)", () => {
  const trang = doc(TRANG);
  it("đọc và dựng view CHỈ khi đủ HAI khoá của action (cùng literal)", () => {
    // `coTheGhi` = `scope.has("sources:manage")` (đúng MỘT chỗ — lưới [CTN-W1]); khoá thứ hai là literal của action.
    expect(dem(trang, /const coTheChupLai = coTheGhi && scope\.has\("commission_policies:activate"\) && duPhamViChupLai\(actor\);/g)).toBe(1);
    expect(dem(trang, /docCanChupLaiCuaToi\(/g)).toBe(1);
    expect(dem(trang, /coTheChupLai \? docCanChupLaiCuaToi\(ma\)/g)).toBe(1);
    // đọc nằm TRONG lượt song song của trang, không phải một `await` nối đuôi (độ sâu tuần tự — [CTN-W6])
    expect(trang).not.toMatch(/await\s+docCanChupLaiCuaToi/);
  });
  it("view chỉ tồn tại khi có lead cần chụp (tong > 0) và chủ hợp lệ; truyền vào MucDoiTuong đúng một chỗ", () => {
    // View còn tồn tại khi chỉ có lead GIỮ chủ cũ hoặc chỉ có lý do chưa chụp được (luật 12: màn nói thật về ca nguy hiểm); luôn đòi có chủ. Nút tự ẩn khi tong ≤ 0.
    expect(trang).toMatch(/chupLai && chupLai\.chu && \(chupLai\.tong > 0 \|\| chupLai\.giuChuCu > 0 \|\| chupLai\.khongChupDuoc !== null\)\s*\?/);
    expect(trang).toMatch(/giuChuCu: chupLai\.giuChuCu,/);
    expect(dem(trang, /chupLai=\{chupLaiView\}/g)).toBe(1);
  });
  it("mục «Đối tượng liên quan»: hàng + nút CHỈ khi chupLai.tong > 0", () => {
    const m = doc(MUC);
    expect(m).toMatch(/chupLai && chupLai\.tong > 0 && \(\s*<Hang nhan="Lead giữ chủ cũ">/);
    expect(dem(m, /<NutChupLaiChuNguon\b/g)).toBe(1);
  });
  it("hộp thoại ĐÓNG BĂNG số liệu lúc mở (`useState(viewMoi)`) và chỉ làm mới trang khi người dùng ĐÓNG hộp thoại, không giữa các lô", () => {
    const n = doc(NUT);
    expect(dem(n, /const \[view\] = useState\(viewMoi\)/g)).toBe(1);
    expect(dem(n, /router\.refresh\(\)/g)).toBe(1);
    const i = n.indexOf("function dongVaLamMoi()");
    expect(i).toBeGreaterThan(0);
    expect(n.slice(i, i + 160)).toMatch(/router\.refresh\(\)/);
    expect(n.indexOf("async function batDau()")).toBeLessThan(i); // batDau (vòng lô) đứng trước và không chứa refresh
    expect(n.slice(n.indexOf("async function batDau()"), i)).not.toMatch(/router\.refresh/);
  });
  it("nút tự ẩn khi view.tong <= 0 (lưới thứ hai) và gọi action thật mặc định", () => {
    const n = doc(NUT);
    expect(n).toMatch(/if \(view\.tong <= 0\) return null/);
    expect(n).toMatch(/CHUP_MAC_DINH: Chup = \(i\) => chupLaiChuNguonAction\(i\)/);
  });
});

describe("[CLC-W7] «đã chi cho chủ cũ» — MỘT định nghĩa, dùng ở cả ba nơi (fin3 R5 M1)", () => {
  const SQL = "lib/nguon/chup-lai-chu-nguon-sql.ts";
  const DOC = "lib/nguon/chup-lai-chu-nguon-doc.ts";
  it("định nghĩa: dòng sổ SOURCE_OWNER theo bản quy nguồn, Σ ròng ≠ 0, cột gọi tên ĐỦ (id trần trong truy vấn con là CommissionTransaction.id)", () => {
    const sql = doc(SQL);
    const kn = /export const DA_CHI_CHU_NGUON = Prisma\.sql`([\s\S]*?)`;/.exec(sql)?.[1] ?? "";
    expect(kn.length).toBeGreaterThan(50);
    expect(kn).toMatch(/ct\."resolverType" = 'SOURCE_OWNER'/);
    expect(kn).toMatch(/ct\."attributionId" = "LeadAttribution"\."id"/);
    expect(kn).toMatch(/GROUP BY ct\."beneficiaryUserId"\s+HAVING sum\(ct\."amount"\) <> 0/);
    expect(kn.replace(/ct\."\w+"|"LeadAttribution"\."id"/g, "")).not.toMatch(/[^.]"id"/); // không còn `"id"` trần
  });
  it("dùng ở ĐÚNG hai nơi định nghĩa diện: điều kiện chọn lô/ghi (dieuKienTheoChu, NOT) và câu đếm (docNhomChupLai, giữ lại cột để tách)", () => {
    expect(dem(doc(SQL), /AND NOT \$\{DA_CHI_CHU_NGUON\}/g)).toBe(1);
    expect(dem(doc(DOC), /\$\{DA_CHI_CHU_NGUON\} AS "daChi"/g)).toBe(1);
    // …và ghi-nguon / dịch vụ KHÔNG chép lại điều kiện: cả hai đi qua `dieuKienTheoChu`
    expect(doc(GHI)).not.toMatch(/CommissionTransaction|DA_CHI_CHU_NGUON/);
    expect(doc(DICH_VU)).not.toMatch(/CommissionTransaction|DA_CHI_CHU_NGUON/);
    expect(dem(doc(DICH_VU), /dieuKienTheoChu\(/g)).toBe(1);
    expect(dem(thanHam(doc(GHI), "ghiChuNguonChupLo") ?? "", /dieuKienTheoChu\(/g)).toBe(1);
  });
  it("câu đếm tách hai tập: lead sẽ chụp (canChup) và lead giữ chủ cũ (giuChuCu); `tong` KHÔNG cộng giuChuCu", () => {
    const d = doc(DOC);
    expect(d).toMatch(/\(d\.daChi \? ra\.giuChuCu : ra\.canChup\)\.push\(/);
    expect(d).toMatch(/return \(await docNhomChupLai\(client, p\)\)\.canChup;/);
    expect(d).toMatch(/tong: theoLyDo\.THIEU_CHU \+ theoLyDo\.CHU_NGHI_VIEC \+ theoLyDo\.CHU_KHONG_CON_HO_SO,/);
  });
  it("nhật ký ghi chủ cũ THEO TỪNG LEAD và câu hậu quả INPUT_DRIFT; khoá advisory dựng ở MỘT hàm", () => {
    const ma = doc(DICH_VU);
    expect(dem(ma, /chuCuTheoLead\[d\.leadId\] = chuCu;/g)).toBe(1);
    expect(ma).toMatch(/oldValues: \{ chuDaChup: Object\.fromEntries\(chuCuDem\), chuCuTheoLead \}/);
    expect(ma).toMatch(/hauQua: HAU_QUA_CHUP_LAI/);
    expect(dem(ma, /hashtextextended\(\$\{khoaChupLaiTheoNguon\(p\.nguonId\)\}, 0\)/g)).toBe(1);
  });
});

describe("[CLC-W8] cổng phạm vi: action và trang cùng hỏi MỘT hàm (fin3 R5 LOW4)", () => {
  it("action: resolveActor → duPhamViChupLai SAU hai quyền và SAU cờ; từ chối bằng field quyen", () => {
    const than = thanHam(doc(ACTION), "chupLaiChuNguonAction") ?? "";
    expect(dem(than, /duPhamViChupLai\(await resolveActor\(session\.user\.id\)\)/g)).toBe(1);
    expect(than.search(/duPhamViChupLai\(/)).toBeGreaterThan(than.search(/laQuanLyNguonBat\(/));
    expect(than.search(/laQuanLyNguonBat\(/)).toBeGreaterThan(than.lastIndexOf("checkPermission("));
    expect(than.slice(than.search(/duPhamViChupLai\(/), than.search(/chupLaiChuNguonMotLo\(/))).toMatch(/field: "quyen"/);
  });
  it("hàm phạm vi: fail-closed (chỉ `=== true`), không nhìn vai/cơ sở", () => {
    const luat = doc("lib/nguon/chup-lai-chu-nguon-luat.ts");
    const than = /export function duPhamViChupLai\([^)]*\): boolean \{([\s\S]*?)\n\}/.exec(luat)?.[1] ?? "";
    expect(than.length).toBeGreaterThan(20);
    expect(than).toMatch(/actor\.isSuperAdmin === true \|\| actor\.isHoLevel === true/);
    expect(than).not.toMatch(/\.role|centerId|roles/);
  });
});

describe("[CLC-W6] giao diện không kéo mã máy chủ", () => {
  it("nút import từ `-nhan` (thuần, client-safe), không phải `-luat` (kéo TRANG_THAI_NGHI của engine)", () => {
    const n = doc(NUT);
    expect(n).toMatch(/from "@\/lib\/nguon\/chup-lai-chu-nguon-nhan"/);
    expect(n).not.toMatch(/chup-lai-chu-nguon-luat|chup-lai-chu-nguon-doc|chup-lai-chu-nguon-sql|ghi-nguon|@\/lib\/db/);
    const nhan = doc("lib/nguon/chup-lai-chu-nguon-nhan.ts");
    expect([...nhan.matchAll(/from "([^"]+)"/g)].map((m) => m[1])).toEqual(["./danh-muc-ghi-dau-vao"]);
  });
});
