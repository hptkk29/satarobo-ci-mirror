// @vitest-environment node
/**
 * [LWN-*] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của tab «Link / QR / Mã» và hai đường công khai (AFF-P1): thứ test hành vi KHÔNG chạm tới (action là "use server" kéo next-auth + Prisma; page là Server
 * Component; route công khai dựng Response). Đọc mã ĐÃ BỎ CHÚ THÍCH; neo hẹp; ĐẾM số lần khớp; không cờ `/s` (luật 11). Mỗi ca đã được CẤY lại lỗi để thấy nó đỏ (báo cáo đợt).
 *
 *   [LWN-01] mọi Server Action gác quyền `affiliate_links:manage` Ở ĐẦU HÀM (auth → quyền → zod → cờ → hàm ghi); khoá có thật và có vai giữ
 *   [LWN-02] nút ghi vẽ bằng ĐÚNG khoá + cờ mà action kiểm (luật 12) — và token đầy đủ chỉ rời tầng đọc khi cùng điều kiện đó
 *   [LWN-03] thành phần CLIENT không kéo mã chỉ-máy-chủ (db · qrcode · token · hàm ghi/đọc DB) và không dùng dangerouslySetInnerHTML
 *   [LWN-04] hàm ghi: khoá hàng đúng thứ tự (campaign → website → membership → link); đếm hạn mức SAU khoá membership; vòng thử lại token bao QUANH $transaction; so mốc lạc quan bằng getTime(); audit cùng transaction
 *   [LWN-05] MỘT cổng hợp lệ: không nơi nào dựng DauVaoKiemLienKet / gọi kiemLienKet ngoài ghi-link-dau-vao
 *   [LWN-06] /r: điểm đến chỉ lấy từ kết quả lõi; no-store; cookie HttpOnly · Lax · Secure(prod) · Max-Age từ lõi; cờ gác trước mọi thứ
 *   [LWN-07] lõi công khai: giới hạn tần suất đứng TRƯỚC truy vấn DB; click ghi TRƯỚC khi dựng URL kèm clk; clk không bao giờ lấy từ request
 *   [LWN-08] beacon: không bao giờ `Access-Control-Allow-Origin: *`; ACAO chỉ qua acaoChoOrigin; luôn 204
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_ACTIONS } from "@/lib/auth/permissions";
import { ROLE_SEED } from "../../../../../prisma/seed-roles";

const GOC = process.cwd();
const KHOA_GHI = "affiliate_links:manage";

/** Bỏ chú thích dòng TRƯỚC, khối SAU — và khối CHỈ khi nó mở ở ĐẦU DÒNG (xem chú thích cùng hàm ở `website-day-noi.test.ts`). */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/(^|\n)[ \t]*\/\*[\s\S]*?\*\//g, "$1");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

/** Thân hàm `export async function <ten>(...) { ... }` — đếm ngoặc. */
function thanHam(src: string, ten: string): string {
  const bat = src.indexOf(`export async function ${ten}(`);
  expect(bat, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
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
  throw new Error(`không đóng được ngoặc của ${ten}`);
}

const ACTIONS = doc("app/(admin)/admin/nguon-hoa-hong/link/_actions.ts");
const PAGE = doc("app/(admin)/admin/nguon-hoa-hong/link/page.tsx");
const DOC_LINK = doc("lib/affiliate/doc-link.ts");
const GHI_LINK = doc("lib/affiliate/ghi-link.ts");
const DAU_VAO = doc("lib/affiliate/ghi-link-dau-vao.ts");
const LOI_CK = doc("lib/affiliate/theo-doi-cong-khai.ts");
const ROUTE_R = doc("app/(public)/r/[token]/route.ts");
const ROUTE_CLICK = doc("app/api/public/affiliate/v1/click/route.ts");

const TEN_ACTION = ["phatLinkAction", "thuHoiLinkAction", "xoayLinkAction", "taoQrAction"] as const;

describe("[LWN-01] Server Action gác quyền Ở ĐẦU HÀM", () => {
  it("tệp có đúng 4 `export async function` — action MỚI thêm vào mà quên cổng ⇒ đỏ ở đây", () => {
    const ten = [...ACTIONS.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]);
    expect(ten.sort()).toEqual([...TEN_ACTION].sort());
  });

  it.each(TEN_ACTION)("%s: auth() → checkPermission(khoá ghi) → zod → cờ, theo đúng thứ tự, rồi mới tới hàm ghi/dựng", (ten) => {
    const t = thanHam(ACTIONS, ten);
    const iAuth = t.search(/await\s+auth\s*\(\s*\)/);
    const iCong = t.search(new RegExp(`await\\s+checkPermission\\(\\s*"${KHOA_GHI}"\\s*\\)`));
    const iZod = t.search(/\.safeParse\(/);
    const iCo = t.search(/\(await\s+docCoModule\(\)\)\.affiliate/);
    const iViec = t.search(/\bawait\s+(phatLink|thuHoiLink|xoayLink|docLinkChoQr)\(/);
    expect(iAuth, "thiếu await auth()").toBeGreaterThanOrEqual(0);
    expect(iCong, "thiếu cổng quyền").toBeGreaterThan(iAuth);
    expect(iZod, "thiếu zod").toBeGreaterThan(iCong);
    expect(iCo, "thiếu cổng cờ").toBeGreaterThan(iZod);
    expect(iViec, "thiếu lời gọi hàm ghi").toBeGreaterThan(iCo);
    // `await` đầu tiên KHÔNG phải của auth phải là cổng quyền.
    const dauTien = [...t.matchAll(/\bawait\s+([A-Za-z_$][\w$.]*)/g)].map((m) => m[1]);
    expect(dauTien[0]).toBe("auth");
    expect(dauTien[1]).toBe("checkPermission");
  });

  it("tệp action đếm: đúng 4 lần gọi checkPermission(khoá ghi) và 4 lần kiểm cờ; không khoá nào khác", () => {
    expect(dem(ACTIONS, new RegExp(`checkPermission\\(\\s*"${KHOA_GHI}"\\s*\\)`, "g"))).toBe(4);
    expect(dem(ACTIONS, /checkPermission\(/g)).toBe(4);
    expect(dem(ACTIONS, /\(await\s+docCoModule\(\)\)\.affiliate/g)).toBe(4);
    expect(dem(ACTIONS, /^"use server"/gm)).toBe(1);
  });

  it("tệp chỉ export hàm async (file 'use server' mà export hằng/đối tượng là lỗi biên dịch của Next)", () => {
    expect(dem(ACTIONS, /^export\s+(?!async function)(?!type\b)(?!interface\b)/gm)).toBe(0);
    expect(readFileSync(resolve(GOC, "app/(admin)/admin/nguon-hoa-hong/link/_actions.ts"), "utf8").startsWith('"use server"')).toBe(true);
  });

  it("khoá ghi có thật trong registry và có vai giữ (không phải khoá ma)", () => {
    expect((ALL_ACTIONS as readonly string[]).includes(KHOA_GHI)).toBe(true);
    const vai = ROLE_SEED.filter((r) => r.perms.some((p) => p.action === KHOA_GHI)).map((r) => r.code);
    expect(vai.length).toBeGreaterThan(0);
  });
});

describe("[LWN-02] nút ghi + token đầy đủ vẽ bằng ĐÚNG khoá + cờ của action", () => {
  it("page: `coTheGhi` = scope.has(khoá ghi) ∧ scope.co.affiliate — MỘT biểu thức, dùng cho cả nút lẫn mức che token", () => {
    expect(dem(PAGE, new RegExp(`const coTheGhi = scope\\.has\\("${KHOA_GHI}"\\) && scope\\.co\\.affiliate;`, "g"))).toBe(1);
    expect(dem(PAGE, /scope\.has\(/g)).toBe(1);
    expect(dem(PAGE, /coTheXemDayDu: coTheGhi/g)).toBe(1);
    expect(dem(PAGE, /<BangLink[^>]*coTheGhi=\{coTheGhi\}/g)).toBe(1);
    expect(dem(PAGE, /coTheGhi && tuyChonPhat \? <NutPhatLink/g)).toBe(1);
  });
  it("page: gọi vaoTab('link') đúng 1 lần; PAGE_GATES['/nguon-hoa-hong/link'] đúng 1 lần", () => {
    expect(dem(PAGE, /vaoTab\("link"\)/g)).toBe(1);
    expect(dem(PAGE, /PAGE_GATES\["\/nguon-hoa-hong\/link"\]/g)).toBe(1);
  });
  it("tầng đọc: token đầy đủ và địa chỉ dựng sẵn CHỈ khi coTheXemDayDu; người xem nhận anToken", () => {
    expect(dem(DOC_LINK, /token: loc\.coTheXemDayDu \? h\.publicToken : anToken\(h\.publicToken\),/g)).toBe(1);
    expect(dem(DOC_LINK, /if \(loc\.coTheXemDayDu && sach\) \{/g)).toBe(1);
    // `publicToken` chỉ được đọc ra ở: select, dựng link (trong khối trên), nhánh token ở trên, và loader theo token — không chỗ nào khác rò vào DongLink.
    // AFF-WEB: tệp thêm hai hàm có token (`docLinkChoQrCuaToi`, `docLinkDangDungTheoDoiTac`) nên ngân sách đo RIÊNG trên thân `docDanhSachLink` (nơi payload của người chỉ XEM được dựng) — con số 10 giữ nguyên ý.
    const batDau = DOC_LINK.indexOf("export async function docDanhSachLink(");
    const ketThuc = DOC_LINK.indexOf("export type TuyChonLoc =");
    expect(batDau).toBeGreaterThanOrEqual(0);
    expect(ketThuc).toBeGreaterThan(batDau);
    expect(dem(DOC_LINK.slice(batDau, ketThuc), /publicToken/g)).toBeLessThanOrEqual(10);
  });
  it("AFF-WEB: hàm lấy link đang dùng của đối tác cũng che từ GỐC — không quyền thì trả sớm, TRƯỚC mọi truy vấn", () => {
    const bat = DOC_LINK.indexOf("export async function docLinkDangDungTheoDoiTac(");
    expect(bat).toBeGreaterThanOrEqual(0);
    const than = DOC_LINK.slice(bat);
    const iChan = than.indexOf("if (!p.coTheXemDayDu || partyIds.length === 0) return ra;");
    const iTruyVan = than.indexOf("client.affiliateTrackingAsset.findMany(");
    expect(iChan).toBeGreaterThanOrEqual(0);
    expect(iTruyVan).toBeGreaterThan(iChan);
  });
  it("coTheXemDayDu BẮT BUỘC (luật 7): kiểu `LocLink` không đặt mặc định, và page truyền nó tường minh", () => {
    expect(dem(DOC_LINK, /coTheXemDayDu: boolean;/g)).toBe(2); // `LocLink` + tham số của `docLinkDangDungTheoDoiTac` (AFF-WEB) — cả hai đều BẮT BUỘC
    expect(dem(DOC_LINK, /coTheXemDayDu\?:/g)).toBe(0);
  });
});

describe("[LWN-03] thành phần CLIENT không kéo mã máy chủ", () => {
  const TEP = ["bang-link.tsx", "phat-link-sheet.tsx", "qr-dialog.tsx"].map((t) => ({ t, src: doc(`components/admin/nguon-hoa-hong/link/${t}`) }));
  it.each(TEP)("$t: có 'use client' và không import db · qrcode · token · hàm ghi/đọc DB · lõi công khai", ({ src }) => {
    expect(src.startsWith('"use client"')).toBe(true);
    for (const cam of [/from\s+"@\/lib\/db"/, /from\s+"qrcode"/, /qr-link"/, /affiliate\/token"/, /node:crypto/, /theo-doi-cong-khai"/, /dung-url-theo-doi"/, /affiliate\/ghi-link"(?!;)/]) {
      expect(cam.test(src), String(cam)).toBe(false);
    }
    // `doc-link` và `ghi-link` chỉ được import KIỂU (type-only) — hàm đọc/ghi DB không vào bundle.
    for (const m of src.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+"@\/lib\/affiliate\/(doc-link|ghi-link)"/g)) expect(m[1], m[0]).toBe("type ");
  });
  it("không `dangerouslySetInnerHTML` ở bất kỳ thành phần nào của tab (QR hiện bằng <img> data-URI)", () => {
    for (const { src } of TEP) expect(dem(src, /dangerouslySetInnerHTML/g)).toBe(0);
    expect(dem(TEP.find((x) => x.t === "qr-dialog.tsx")!.src, /<img\b/g)).toBe(1);
  });
  it("trang → thành phần client chỉ truyền DỮ LIỆU (không hàm): BangLink không có prop nào là hàm bắt buộc", () => {
    const bang = TEP.find((x) => x.t === "bang-link.tsx")!.src;
    expect(dem(bang, /hrefTrang/g)).toBe(0);
    expect(dem(PAGE, /<BangLink dong=\{ds\.dong\} coTheGhi=\{coTheGhi\} \/>/g)).toBe(1);
  });
});

describe("[LWN-04] hàm ghi", () => {
  const phat = thanHam(GHI_LINK, "phatLink");
  const xoay = thanHam(GHI_LINK, "xoayLink");
  const thuHoi = thanHam(GHI_LINK, "thuHoiLink");
  it("phatLink: khoá campaign → website → membership theo ĐÚNG thứ tự; đếm hạn mức SAU khoá membership; rồi mới create", () => {
    const a = phat.search(/await khoaChiaCampaign\(/);
    const b = phat.search(/await khoaChiaWebsite\(/);
    const c = phat.search(/await khoaMembership\(/);
    const d = phat.search(/tx\.affiliateTrackingAsset\.count\(/);
    const e = phat.search(/kiemPhatLink\(/);
    const f = phat.search(/tx\.affiliateTrackingAsset\.create\(/);
    expect([a, b, c, d, e, f].every((x) => x >= 0)).toBe(true);
    expect(a < b && b < c && c < d && d < e && e < f).toBe(true);
  });
  it("vòng thử lại token bao QUANH db.$transaction (không thử lại bên trong transaction đã bị huỷ)", () => {
    expect(dem(phat, /voiTokenMoi\([^)]*\(token\)\s*=>\s*\n?\s*db\.\$transaction\(/g)).toBe(1);
    expect(dem(xoay, /voiTokenMoi\([^)]*\(token\)\s*=>\s*\n?\s*db\.\$transaction\(/g)).toBe(1);
    expect(dem(GHI_LINK, /async function voiTokenMoi/g)).toBe(1);
    expect(dem(GHI_LINK, /for \(let lan = 0; lan < SO_LAN_THU_TOKEN; lan \+= 1\)/g)).toBe(1);
    // chỉ MỘT nơi nhận P2002 để thử lại
    expect(dem(GHI_LINK, /laLoiTrungKhoa\(/g)).toBe(1);
  });
  it("xoayLink: khoá link SAU membership; kiểm lại chuỗi bằng kiemPhatLink(laXoay: true) TRƯỚC khi thu hồi; thu hồi rồi mới tạo", () => {
    const a = xoay.search(/await khoaMembership\(/);
    const b = xoay.search(/await khoaLink\(/);
    const c = xoay.search(/kiemPhatLink\(/);
    const d = xoay.search(/tx\.affiliateTrackingAsset\.update\(/);
    const e = xoay.search(/tx\.affiliateTrackingAsset\.create\(/);
    expect(a >= 0 && a < b && b < c && c < d && d < e).toBe(true);
    expect(dem(xoay, /laXoay: true/g)).toBe(1);
    expect(dem(xoay, /rotatedFromId: cu\.id/g)).toBe(2); // dòng tạo + audit
  });
  it("mọi đường sửa (thu hồi · xoay) khoá hàng + so mốc lạc quan bằng getTime(); không updateMany theo updatedAt", () => {
    expect(dem(thuHoi, /await khoaLink\(/g)).toBe(1);
    expect(dem(thuHoi, /\.updatedAt\.getTime\(\) !== p\.updatedAtDaThay\.getTime\(\)/g)).toBe(1);
    expect(dem(xoay, /\.updatedAt\.getTime\(\) !== p\.updatedAtDaThay\.getTime\(\)/g)).toBe(1);
    expect(dem(GHI_LINK, /updateMany/g)).toBe(0);
    expect(dem(GHI_LINK, /updatedAtDaThay: Date;/g)).toBe(2); // BẮT BUỘC, không mặc định (luật 7)
  });
  it("audit cùng transaction ở MỌI đường ghi; không audit nào mang token đầy đủ", () => {
    expect(dem(GHI_LINK, /await writeAudit\(\{\s*tx,/g)).toBe(4);
    expect(dem(GHI_LINK, /anToken\(/g)).toBeGreaterThanOrEqual(4);
    expect(dem(GHI_LINK, /publicToken:[ \t]*(?!token\b)\S/g)).toBe(0); // chỉ `publicToken: token` (ghi), không bao giờ vào audit
    const dongAudit = GHI_LINK.split("\n").filter((l) => /newValues:/.test(l));
    expect(dongAudit).toHaveLength(4);
    for (const l of dongAudit) expect(l.replace(/anToken\([^)]*\)/g, "")).not.toMatch(/publicToken/); // mọi lần nhắc token trong audit đều đi qua anToken()
  });
  it("hàm ghi nhận đồng hồ từ ngoài (luật 19): không new Date() trong ghi-link.ts", () => {
    expect(dem(GHI_LINK, /new Date\(/g)).toBe(0);
  });
});

describe("[LWN-05] MỘT cổng hợp lệ", () => {
  const TEP_CUA_TOI = ["lib/affiliate/ghi-link.ts", "lib/affiliate/doc-link.ts", "lib/affiliate/theo-doi-cong-khai.ts", "app/(public)/r/[token]/route.ts", "app/api/public/affiliate/v1/click/route.ts"];
  it("không tệp nào ngoài ghi-link-dau-vao tự gọi kiemLienKet( hay dựng trangDichConHieuLuc", () => {
    for (const t of TEP_CUA_TOI) {
      const s = doc(t);
      expect(dem(s, /\bkiemLienKet\(/g), t).toBe(0);
      expect(dem(s, /trangDichConHieuLuc/g), t).toBe(0);
    }
    expect(dem(DAU_VAO, /\bkiemLienKet\(/g)).toBe(1);
    // AFF-L6: "còn hiệu lực" = tên miền đích còn ∈ danh sách của website ∧ còn khớp một trang đích đang bật CÓ ĐÚNG tên miền đó (hàm khớp dùng chung `trangDichKhopLink`).
    expect(dem(DAU_VAO, /trangDichConHieuLuc: hostTrongDanhSach\(c\.site\.allowedDomains, c\.taiSan\.landingHost\) && trangDichKhopLink\(c\.trangDich, c\.taiSan\.landingHost, c\.taiSan\.landingPath\)/g)).toBe(1);
  });
  it("bốn nơi hỏi đều đi qua kiemChuoiLink / kiemPhatLink", () => {
    expect(dem(LOI_CK, /kiemChuoiLink\(/g)).toBe(2); // /r + beacon
    expect(dem(DOC_LINK, /kiemChuoiLink\(/g)).toBe(2); // cột «dùng được không» của bảng + nút «Link» của đối tác (AFF-WEB: chọn link ĐANG DÙNG ĐƯỢC)
    expect(dem(GHI_LINK, /kiemPhatLink\(/g)).toBe(2); // phát + xoay
    expect(dem(DAU_VAO, /kiemChuoiLink\(chuoi, now\)/g)).toBe(1); // kiemPhatLink
  });
});

describe("[LWN-06] GET /r/:token", () => {
  it("cờ gác TRƯỚC lõi theo dõi: TẮT ⇒ chỉ `xuLyBamLinkKhiTat` (không lõi ghi, không cookie, KHÔNG 404 — R5 13/10/2026: không làm mất khách bấm QR đã in)", () => {
    const t = thanHam(ROUTE_R, "GET");
    const iCo = t.search(/await docCoTheoDoi\(\)/);
    const iTat = t.search(/await xuLyBamLinkKhiTat\(/);
    const iLoi = t.search(/await xuLyBamLink\(/);
    expect(iCo).toBeGreaterThanOrEqual(0);
    expect(iTat).toBeGreaterThan(iCo);
    expect(iLoi).toBeGreaterThan(iTat); // nhánh TẮT đứng trước lõi ghi
    expect(dem(t, /status: 404/g)).toBe(0);
    // nhánh TẮT không đặt cookie, không gọi lõi ghi
    const nhanhTat = t.slice(iCo, iLoi);
    expect(dem(nhanhTat, /datCookie\(/g)).toBe(0);
    expect(dem(nhanhTat, /xuLyBamLink\(/g)).toBe(0);
  });
  it("điểm đến CHỈ từ kết quả lõi: hai lời gọi redirect (nhánh tắt · nhánh bật), cả hai từ `.diemDen`; không dùng req.url / Host / Referer / searchParams trực tiếp để dựng nó", () => {
    expect(dem(ROUTE_R, /NextResponse\.redirect\((kq|tat)\.diemDen, 302\)/g)).toBe(2);
    expect(dem(ROUTE_R, /NextResponse\.redirect\(/g)).toBe(2);
    expect(dem(ROUTE_R, /req\.url|\.get\("host"\)|x-forwarded-host|req\.nextUrl\.(origin|host|href)/g)).toBe(0);
    // query chỉ đi vào lõi (để lõi lọc utm_*), không vào redirect
    expect(dem(ROUTE_R, /searchParams/g)).toBe(1);
  });
  it("Cache-Control no-store ở MỌI phản hồi (cả nhánh tắt); cookie HttpOnly · Lax · Secure(prod) · Path=/ · Max-Age từ lõi", () => {
    expect(dem(ROUTE_R, /"Cache-Control": "no-store, max-age=0"/g)).toBe(1);
    expect(dem(ROUTE_R, /for \(const \[k, v\] of Object\.entries\(KHONG_LUU\)\) (res|r)\.headers\.set\(k, v\);/g)).toBe(2);
    expect(dem(ROUTE_R, /httpOnly: true,/g)).toBe(1);
    expect(dem(ROUTE_R, /sameSite: "lax",/g)).toBe(1);
    expect(dem(ROUTE_R, /secure: process\.env\.NODE_ENV === "production",/g)).toBe(1);
    expect(dem(ROUTE_R, /path: "\/",/g)).toBe(1);
    expect(dem(ROUTE_R, /maxAge: c\.maxAgeGiay,/g)).toBe(1);
    expect(dem(ROUTE_R, /if \(kq\.cookieGioiThieu\) datCookie\(res, COOKIE_GIOI_THIEU, kq\.cookieGioiThieu\);/g)).toBe(1);
  });
});

describe("[LWN-07] lõi công khai", () => {
  const bam = thanHam(LOI_CK, "xuLyBamLink");
  const bay = thanHam(LOI_CK, "xuLyBeacon");
  it("giới hạn tần suất đứng TRƯỚC truy vấn DB — ở cả hai đường", () => {
    expect(bam.search(/await deps\.choPhepTanSuat\(/)).toBeGreaterThanOrEqual(0);
    expect(bam.search(/await deps\.choPhepTanSuat\(/)).toBeLessThan(bam.search(/taiChuoiLinkTheoToken\(/));
    expect(bay.search(/await deps\.choPhepTanSuat\(/)).toBeGreaterThanOrEqual(0);
    expect(bay.search(/await deps\.choPhepTanSuat\(/)).toBeLessThan(bay.search(/taiChuoiLinkTheoToken\(/));
  });
  it("token chuẩn hoá TRƯỚC khi chạm DB; token hỏng/lạ ⇒ KHONG_GHI", () => {
    expect(bam.search(/chuanHoaToken\(p\.tokenTho\)/)).toBeLessThan(bam.search(/taiChuoiLinkTheoToken\(/));
    expect(dem(bam, /if \(token === null\) return ve\("KHONG_GHI"\);/g)).toBe(1);
    expect(dem(bam, /if \(link === null\) return ve\("KHONG_GHI"\);/g)).toBe(1);
  });
  it("click ghi TRƯỚC khi dựng URL kèm clk; clk lấy từ kết quả ghi, KHÔNG từ query", () => {
    const iGhi = bam.search(/const clickId = await ghiLuotBam\(/);
    const iDung = bam.search(/dungUrlDich\(\{/);
    expect(iGhi).toBeGreaterThanOrEqual(0);
    expect(iGhi).toBeLessThan(iDung);
    expect(dem(bam, /\bclickId,/g)).toBeGreaterThanOrEqual(1);
    expect(dem(bam, /p\.query\.clk|query\[["']clk["']\]/g)).toBe(0);
    // query chỉ đi vào chuanHoaUtm
    expect(dem(bam, /p\.query/g)).toBe(1);
    expect(dem(bam, /chuanHoaUtm\(p\.query\)/g)).toBe(1);
  });
  it("link không hợp lệ: ghi click bằng mã lý do, KHÔNG cookie giới thiệu, đích sạch; sessionKey băm từ mã phiên (không IP/UA)", () => {
    const nhanh = bam.slice(bam.search(/if \(!kq\.ok\) \{/), bam.search(/const clickId = await ghiLuotBam/));
    expect(dem(nhanh, /outcome: kq\.ma/g)).toBe(1);
    expect(dem(nhanh, /cookieGioiThieu: null/g)).toBe(1);
    expect(dem(nhanh, /dungUrlTrangDich\(/g)).toBe(1);
    expect(dem(bam, /tinhSessionKey\(deps\.khoaHmac\(\), maPhien\)/g)).toBe(1);
    expect(dem(LOI_CK, /sessionKey[^\n]*(p\.ip|user-agent)/gi)).toBe(0);
  });
  it("trang chủ dự phòng lấy từ deps.goc (cấu hình), không từ request", () => {
    // AFF-WEB: gốc có thể `null` (môi trường chưa đặt AFFILIATE_PUBLIC_ORIGIN) ⇒ trang chủ dự phòng là `/` TƯƠNG ĐỐI — không bao giờ một tên miền cứng.
    expect(dem(LOI_CK, /const trangChu = \(goc: string \| null\) => \(goc === null \? "\/" : `\$\{goc\}\/`\);/g)).toBe(1);
    // mọi chỗ dùng trang chủ dự phòng (lõi bật, lõi tắt — R5) đều lấy từ deps.goc; không chỗ nào truyền gốc khác
    expect(dem(LOI_CK, /trangChu\(deps\.goc\)/g)).toBeGreaterThanOrEqual(3);
    expect(dem(LOI_CK, /trangChu\((?!deps\.goc\))/g)).toBe(0);

  });
});

describe("[LWN-08] beacon", () => {
  it("không bao giờ ACAO `*`; ACAO chỉ đặt từ acaoChoOrigin; luôn 204 (404 chỉ khi cờ tắt)", () => {
    expect(dem(ROUTE_CLICK, /Access-Control-Allow-Origin/g)).toBe(1);
    expect(dem(ROUTE_CLICK, /"\*"|'\*'/g)).toBe(0);
    expect(dem(LOI_CK, /"\*"|'\*'/g)).toBe(0);
    expect(dem(ROUTE_CLICK, /if \(acao\) res\.headers\.set\("Access-Control-Allow-Origin", acao\);/g)).toBe(1);
    expect(dem(ROUTE_CLICK, /status: 204/g)).toBe(2);
    expect(dem(ROUTE_CLICK, /Vary: "Origin"/g)).toBe(1);
    expect(dem(LOI_CK, /acao = acaoChoOrigin\(p\.origin, link\.chuoi\.site\.allowedDomains\)/g)).toBe(1);
  });
  it("URL nơi bấm PHẢI qua kiemUrlDuocPhep trên website của chính link, sau khi cắt query/fragment", () => {
    const bay = thanHam(LOI_CK, "xuLyBeacon");
    expect(dem(bay, /kiemUrlDuocPhep\(boQueryVaFragment\(than\.data\.landingUrl\), link\.site, link\.chuoi\.trangDich\)/g)).toBe(1);
    expect(dem(bay, /if \(!url\.ok\) return \{ acao, ketCuc: "KHONG_GHI" \};/g)).toBe(1);
  });
});
