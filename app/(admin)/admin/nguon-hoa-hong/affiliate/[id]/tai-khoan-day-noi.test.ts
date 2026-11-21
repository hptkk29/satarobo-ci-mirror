/**
 * [ATD-*] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của trang chi tiết đối tác + tài khoản truy cập (AFF-L3a).
 *
 * Page / action kéo next-auth + Prisma nên không dựng được trong vitest thuần; HÀNH VI của hàm đọc / ghi được kiểm trên Postgres thật (`tests/hoa-hong/affiliate-tai-khoan.spec.ts`). Lưới này canh những thứ
 * mà ca hành vi KHÔNG phân biệt được (luật 11): nút vẽ bằng ĐÚNG khoá mà action kiểm; thứ tự cổng trong action; thứ tự khoá trong hàm ghi; cột legacy không hoàn tác gỡ/tạm ngừng.
 * Mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM số lần khớp, và mỗi ca có phép CẤY LỖI (ghi trong `docs/source-commission/closeout/l3a-doi-tac-tai-khoan.md`).
 *
 *   [ATD-A1] mỗi action: auth() → checkPermission("affiliates:manage") → zod/cờ → hàm ghi; đúng 6 action (thêm action thứ 7 mà quên cổng ⇒ đỏ)
 *   [ATD-P1] page: cổng vaoTab/PAGE_GATES, id giải bằng giaiMaTrenUrl, MỖI cờ quyền hỏi MỘT lần và truyền đúng chỗ
 *   [ATD-W1] hàm ghi: khoá hàng Affiliate TRƯỚC mọi phép ghi; không xoá gì khi gỡ; đồng bộ cột legacy ở ba đường đổi tập tài khoản
 *   [ATD-R1] hàm đọc: cột legacy chỉ tính khi CHƯA có dòng nối cho cặp đó (nếu không, tạm ngừng / gỡ bị chính cột cũ hoàn tác)
 *   [ATD-L1] danh sách: cả dòng là vùng bấm, nút trong dòng nổi lên
 *   [ATD-S1] tự giới thiệu: so SĐT/email của MỌI tài khoản còn gắn với đối tác, không chỉ người đại diện (hành vi: tests/lead-intake/affiliate-intake.spec.ts [AFI-04b])
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(process.cwd(), duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const APP = "app/(admin)/admin/nguon-hoa-hong/affiliate";
const ACTIONS = doc(`${APP}/[id]/_actions.ts`);
const PAGE = doc(`${APP}/[id]/page.tsx`);
const GHI = doc("lib/affiliate/tai-khoan-truy-cap-ghi.ts");
const DOC = doc("lib/affiliate/tai-khoan-truy-cap.ts");
const BANG = doc(`${APP}/_components/bang-doi-tac.tsx`);
const NHAN = doc("lib/affiliate/nhan-referral.ts");

/** Thân của MỌI callback `db.$transaction(async (tx) => { … })` — ghép ngoặc nhọn (đủ cho mã đã bỏ chú thích; chuỗi trong mã này không chứa ngoặc nhọn lẻ). */
function cacThanTransaction(src: string): string[] {
  const ra: string[] = [];
  let tu = 0;
  for (;;) {
    const i = src.indexOf("db.$transaction(async (tx) => {", tu);
    if (i < 0) return ra;
    let sau = src.indexOf("{", i + 20) + 1;
    const sau0 = sau;
    let muc = 1;
    while (muc > 0 && sau < src.length) {
      const c = src[sau++];
      if (c === "{") muc += 1;
      else if (c === "}") muc -= 1;
    }
    ra.push(src.slice(sau0, sau));
    tu = sau;
  }
}

function thanHam(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}(`);
  if (i < 0) throw new Error(`không thấy hàm ${ten}`);
  const j = src.indexOf("\nexport async function ", i + 10);
  return src.slice(i, j < 0 ? undefined : j);
}

describe("[ATD-A1] Server Action: cổng đứng ĐẦU hàm, đúng khoá mà nút dùng", () => {
  const ten = [...ACTIONS.matchAll(/export async function (\w+)\(/g)].map((m) => m[1]!);
  it("đúng sáu action (liên kết · gỡ · tạm ngừng · mở lại · đổi đại diện · tìm)", () => {
    expect(ten.sort()).toEqual(["doiDaiDienAction", "goLienKetAction", "lienKetUserAction", "moLaiCongAction", "tamNgungCongAction", "timUserAction"]);
  });
  for (const t of ["doiDaiDienAction", "goLienKetAction", "lienKetUserAction", "moLaiCongAction", "tamNgungCongAction", "timUserAction"]) {
    it(`${t}: await auth() → checkPermission("affiliates:manage") → cờ affiliate, theo thứ tự, trước mọi await khác`, () => {
      const than = thanHam(ACTIONS, t);
      const iAuth = than.search(/await\s+auth\(\)/);
      const iQuyen = than.search(/await\s+checkPermission\(\s*"affiliates:manage"\s*\)/);
      const iCo = than.search(/\(await\s+docCoModule\(\)\)\.affiliate/);
      expect(iAuth, `${t}: thiếu auth()`).toBeGreaterThan(-1);
      expect(iQuyen, `${t}: thiếu checkPermission`).toBeGreaterThan(iAuth);
      expect(iCo, `${t}: thiếu kiểm cờ affiliate`).toBeGreaterThan(iQuyen);
      // await ĐẦU TIÊN sau auth() phải là cổng quyền; không await nào chen giữa
      const giua = than.slice(iAuth + 12, iQuyen);
      expect(dem(giua, /\bawait\b/g), `${t}: có await chen giữa auth và quyền`).toBe(0);
      expect(dem(than, /checkPermission\(/g), `${t}: hỏi đúng MỘT khoá`).toBe(1);
    });
  }
  it("không import db trần; không action nào nhận userId từ client để ghi nhật ký (người ghi luôn từ phiên)", () => {
    expect(dem(ACTIONS, /@\/lib\/db\b/g)).toBe(0);
    expect(dem(ACTIONS, /nguoi: \{ userId: session\.user\.id, ten: tenNguoi\(session\.user\) \}/g)).toBe(5);
  });
});

describe("[ATD-P1] page: cổng, id trên URL, mỗi cờ quyền một lần và đúng chỗ", () => {
  it("vaoTab('affiliate') → PAGE_GATES → giaiMaTrenUrl(id) → notFound; không import db", () => {
    expect(dem(PAGE, /await vaoTab\("affiliate"\)/g)).toBe(1);
    expect(dem(PAGE, /scope\.any\(PAGE_GATES\["\/nguon-hoa-hong\/affiliate"\]\)/g)).toBe(1);
    expect(dem(PAGE, /\bgiaiMaTrenUrl\(idTho\)/g)).toBe(1);
    expect(dem(PAGE, /ID_RE\.test\(id\)/g)).toBe(1);
    expect(dem(PAGE, /if \(!ctDoiTac \|\| !onboarding\) notFound\(\);/g)).toBe(1);
    expect(dem(PAGE, /@\/lib\/db\b/g)).toBe(0);
  });
  it("MỖI cờ quyền hỏi MỘT lần; `affiliates:manage` đi vào PII BẰNG BIẾN (coTheXemLienHe), không hằng", () => {
    expect(dem(PAGE, /scope\.has\("affiliates:manage"\)/g)).toBe(1);
    expect(dem(PAGE, /scope\.has\("affiliate_memberships:manage"\)/g)).toBe(1);
    expect(dem(PAGE, /docDoiTacTheoId\(actor, id, coTheGhi\)/g)).toBe(1);
    expect(dem(PAGE, /coTheXemLienHe: coTheGhi/g)).toBe(1);
  });
  it("nút ghi tài khoản/hồ sơ ← `coTheGhi` (affiliates:manage); ghi danh + duyệt thành viên ← `coTheThanhVien` (affiliate_memberships:manage) — mỗi nút theo khoá của action của nó", () => {
    expect(dem(PAGE, /<KhoiTaiKhoanTruyCap\b[^>]*coTheGhi=\{coTheGhi\}/g)).toBe(1);
    expect(dem(PAGE, /<GhiDanhCampaign\b[^>]*coTheGhi=\{coTheThanhVien\}/g)).toBe(1);
    expect(dem(PAGE, /<KhoiChuongTrinhDoiTac\b[^>]*coTheThanhVien=\{coTheThanhVien\}/g)).toBe(1);
    expect(dem(PAGE, /coTheGhi && tuyChon \?/g)).toBe(1); // nút Sửa hồ sơ + đổi trạng thái
  });
  it("loading.tsx có mặt (mọi route có khung chờ)", () => {
    expect(existsSync(resolve(process.cwd(), `${APP}/[id]/loading.tsx`))).toBe(true);
  });
});

describe("[ATD-W1] hàm ghi", () => {
  it("MỌI hàm bắt đầu bằng khoá hàng Affiliate (FOR UPDATE) trước khi đọc/ghi dòng truy cập; đúng bốn chỗ khoá", () => {
    expect(dem(GHI, /FOR UPDATE/g)).toBe(1); // một định nghĩa khoá
    expect(dem(GHI, /await khoaDoiTac\(tx, /g)).toBe(3); // lienKetUser + doiDaiDien + moDong (dùng chung cho gỡ · tạm ngừng · mở lại)
    expect(dem(GHI, /await moDong\(tx, v\.id, v\.updatedAtDaThay, p\.nguoi, p\.now\)/g)).toBe(3); // gỡ · tạm ngừng · mở lại
    // trong lienKetUser / doiDaiDien: khoá TRƯỚC phép ghi đầu tiên
    for (const t of ["lienKetUser", "doiDaiDien"]) {
      const than = thanHam(GHI, t);
      expect(than.indexOf("khoaDoiTac("), t).toBeGreaterThan(-1);
      expect(than.indexOf("khoaDoiTac("), t).toBeLessThan(than.search(/\.(create|update)\(/));
    }
  });
  it("gỡ liên kết KHÔNG xoá gì: không delete/deleteMany ở cả tệp ghi (Party, lead, attribution, sổ giữ nguyên)", () => {
    expect(dem(GHI, /\.(delete|deleteMany)\(/g)).toBe(0);
    expect(dem(GHI, /\baffiliate\.(delete|update)\b[^;]*status/g)).toBe(0);
  });
  it("cổng đứng TRƯỚC phép ghi: từ chối là `throw`, không `return { ok: false` trong callback $transaction", () => {
    const cacThan = cacThanTransaction(GHI);
    expect(cacThan.length).toBe(5); // lienKetUser · goLienKet · tamNgungCong · moLaiCong · doiDaiDien
    for (const than of cacThan) expect(dem(than, /return \{ ok: false/g)).toBe(0);
    expect(dem(GHI, /throw new LoiGhiAffiliate\(/g)).toBeGreaterThanOrEqual(8); // đối chứng dương: từ chối bằng `throw`
  });
  it("cột legacy được đồng bộ ở ba đường đổi tập tài khoản (liên kết · gỡ · đổi đại diện), và CHỈ khi giá trị đổi", () => {
    expect(dem(GHI, /await dongBoCotCu\(tx, /g)).toBe(3);
    expect(dem(GHI, /if \(can !== hienTai\) await tx\.affiliate\.update\(\{ where: \{ id: partyId \}, data: \{ userId: can \} \}\)/g)).toBe(1);
  });
  it("mỗi hàm ghi có audit CÙNG transaction (writeAudit có `tx`)", () => {
    expect(dem(GHI, /await writeAudit\(\{\s*tx,/g)).toBe(6); // 5 thao tác (liên kết gồm cả mở lại) + nhận nuôi liên kết cũ
  });
});

describe("[ATD-R1] hàm đọc: cột legacy không được hoàn tác tạm ngừng / gỡ", () => {
  it("điểm vào cổng: dòng nối ACTIVE ∪ cột legacy CHỈ khi chưa có dòng nối cho cặp (accessUsers: none)", () => {
    const ham = DOC.slice(DOC.indexOf("export async function partyIdsVaoDuoc"), DOC.indexOf("export async function userIdsGanVoiDoiTac"));
    expect(dem(ham, /affiliatePartyUser\.findMany\(\{ where: \{ userId, status: "ACTIVE" \}/g)).toBe(1);
    expect(dem(ham, /accessUsers: \{ none: \{ userId \} \}/g)).toBe(1);
  });
  it("so tự giới thiệu: tài khoản ACTIVE ∪ SUSPENDED (tạm ngừng không biến họ thành người ngoài), REVOKED thì không", () => {
    const ham = DOC.slice(DOC.indexOf("export async function userIdsGanVoiDoiTac"), DOC.indexOf("// ── Danh sách tài khoản"));
    expect(dem(ham, /status: \{ in: \["ACTIVE", "SUSPENDED"\] \}/g)).toBe(1);
  });
});

describe("[ATD-S1] tự giới thiệu so MỌI tài khoản còn gắn với đối tác", () => {
  // LÝ LẼ (không phải cách viết): danh tính đối tác dùng để chặn tự giới thiệu phải gồm SĐT/email của MỌI tài khoản còn gắn, ở CẢ BA đường (tự động · khai tay · duyệt tay).
  // Từ khi vá reviewer (13/10/2026) điều đó nằm ở MỘT hàm `danhTinhDoiTacDeChan`; lưới dây nối của ba đường là `[XLW-07]` (xu-ly-referral-wiring.test.ts), ca hành vi là `[RXT-DB-11b]`.
  const CHUNG = doc("lib/affiliate/danh-tinh-doi-tac.ts");
  it("`nhan-referral` lấy danh tính từ hàm dùng chung, không tự đọc một `party.userId` đơn lẻ", () => {
    expect(dem(NHAN, /await danhTinhDoiTacDeChan\(/g)).toBe(1);
    expect(dem(NHAN, /db\.user\.findUnique\(\{ where: \{ id: asset\.party\.userId \}/g)).toBe(0);
  });
  it("hàm dùng chung hỏi `userIdsGanVoiDoiTac`, đọc SĐT/email của TẤT CẢ các tài khoản đó rồi đưa vào phép so", () => {
    expect(dem(CHUNG, /await userIdsGanVoiDoiTac\(party\.id, client\)/g)).toBe(1);
    expect(dem(CHUNG, /client\.user\.findMany\(\{ where: \{ id: \{ in: idTaiKhoan \} \}, select: \{ phone: true, email: true \} \}\)/g)).toBe(1);
    expect(dem(CHUNG, /phones: \[party\.phone, \.\.\.taiKhoan\.map\(\(t\) => t\.phone\), party\.employee\?\.phone\]/g)).toBe(1);
    expect(dem(CHUNG, /emails: \[party\.email, \.\.\.taiKhoan\.map\(\(t\) => t\.email\), party\.employee\?\.email\]/g)).toBe(1);
  });
});

describe("[ATD-L1] danh sách đối tác: cả dòng là vùng bấm", () => {
  it("<tr relative cursor-pointer> + liên kết tên mang after:inset-0; nút trong dòng nổi lên bằng relative z-10", () => {
    expect(dem(BANG, /cn\(adminTr, "relative cursor-pointer"\)/g)).toBe(1);
    expect(dem(BANG, /href=\{`\/nguon-hoa-hong\/affiliate\/\$\{encodeURIComponent\(d\.id\)\}`\}[^>]*after:absolute after:inset-0/g)).toBe(1);
    expect(dem(BANG, /relative z-10/g)).toBeGreaterThanOrEqual(2); // sao chép link + cột thao tác
  });
});
