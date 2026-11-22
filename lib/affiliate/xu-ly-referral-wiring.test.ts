// @vitest-environment node
/**
 * [XLW-*] — LƯỚI GHIM MÃ NGUỒN cho DÂY NỐI của xử lý tay referral (AFF-L3b). Hàm ghi chạm DB nên không dựng được trong vitest thuần; ca hành vi thật nằm ở
 * `tests/hoa-hong/affiliate-referral-xem-tay.spec.ts` ([RXT-DB-*]). Lưới này canh phần mà ca đó có thể đi vòng — gỡ một lời gọi mà mọi ca hành vi vẫn xanh.
 * Khuôn `khung-day-noi.test.ts`: đọc mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s`. Mỗi ca đã được CẤY lại lỗi để thấy đỏ (xem closeout/l3b-referral-xem-tay.md).
 *
 *   [XLW-01] Server Action: mỗi hàm gác `auth()` → quyền `affiliate_referrals:manage` (literal) → cờ affiliate; input zod `.strict()`; không có ô tiền
 *   [XLW-02] `xuLyReferral`: scope TRƯỚC giao dịch · khoá hàng · khoá lạc quan (so mốc + updateMany có điều kiện) · máy trạng thái · nhật ký + audit CÙNG giao dịch
 *   [XLW-03] DUYỆT ghi attribution qua `ghiNguonKhiDuyetReferral` đúng MỘT lần, TRƯỚC khi sửa referral; kết quả từ chối được ném, không nuốt
 *   [XLW-04] `ghiNguonKhiDuyetReferral`: đường GHI duy nhất đi qua ghi-nguon.ts; `taoMoi:false` và `!r.ok` đều THROW; quyết định qua hàm thuần; không ghi UNKNOWN
 *   [XLW-05] khai tay: schema strict · scope phiếu · nguồn giải từ cấu hình (không từ client) · MANUAL_REVIEW · khoá giao dịch · sự kiện + audit
 *   [XLW-06] không tự dựng khoá bản chụp ở chỗ ghi tay: dùng `dungSnapshotReferral`
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;
/** Vị trí khớp ĐẦU TIÊN (hoặc -1). */
const vt = (s: string, re: RegExp) => s.search(re);

const ACTIONS = "app/(admin)/admin/nguon-hoa-hong/referral/_actions.ts";
const GHI = "lib/affiliate/ghi-referral-xu-ly.ts";
const NGUON = "lib/nguon/ghi-nguon-affiliate-duyet.ts";

/** Thân hàm `export async function <ten>(` … tới `export async function` kế tiếp / hết tệp. */
function than(src: string, ten: string): string {
  const a = src.indexOf(`export async function ${ten}(`);
  expect(a, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const b = src.indexOf("export async function ", a + 10);
  return b < 0 ? src.slice(a) : src.slice(a, b);
}

describe("[XLW-01] Server Action", () => {
  const src = doc(ACTIONS);

  it("ba action, mỗi cái: auth() → checkPermission(\"affiliate_referrals:manage\") → cờ affiliate — đúng thứ tự", () => {
    for (const ten of ["xuLyReferralAction", "khaiTayReferralAction", "timPhieuKhaiTayAction"]) {
      const t = than(src, ten);
      expect(dem(t, /\bawait auth\(\)/g), ten).toBe(1);
      expect(dem(t, /\bcheckPermission\(\s*"affiliate_referrals:manage"\s*\)/g), ten).toBe(1);
      expect(dem(t, /\(await docCoModule\(\)\)\.affiliate/g), ten).toBe(1);
      expect(vt(t, /\bauth\(\)/), ten).toBeLessThan(vt(t, /\bcheckPermission\(/));
      expect(vt(t, /\bcheckPermission\(/), ten).toBeLessThan(vt(t, /docCoModule\(\)/));
    }
  });

  it("quyền hỏi bằng literal đúng khoá — tổng cộng ĐÚNG ba lần trong tệp (một lần mỗi action)", () => {
    expect(dem(src, /\bcheckPermission\(\s*"affiliate_referrals:manage"\s*\)/g)).toBe(3);
    expect(dem(src, /\bcheckPermission\(\s*"leads:view-pii"\s*\)/g)).toBe(1); // chỉ ô tìm phiếu: để quyết che PII
    expect(dem(src, /\bcheckAnyPermission\(\s*\[\s*"leads:view-all"\s*,\s*"leads:view-own"\s*\]\s*\)/g)).toBe(1);
  });

  it("input xử lý tay là zod .strict() và không có khoá tiền / tỉ lệ / nguồn", () => {
    const t = src.slice(src.indexOf("const xuLyInput"), src.indexOf("export async function xuLyReferralAction"));
    expect(dem(t, /\.strict\(\)/g)).toBe(1);
    expect(dem(t, /\b(soTien|amount|rate|tiLe|commission|sourceGroupId|status|trangThai)\b/gi)).toBe(0);
    // khai tay: input thô đi thẳng vào hàm ghi, nơi schema `.strict()` từ chối khoá lạ (không có schema nới hơn ở đây)
    expect(dem(than(src, "khaiTayReferralAction"), /vao:\s*input\b/g)).toBe(1);
  });

  it("revalidate danh sách VÀ trang chi tiết sau khi xử lý xong (pill «Cần xem tay» đọc lại)", () => {
    const t = than(src, "xuLyReferralAction");
    expect(dem(t, /\brevalidatePath\(\s*BASE\s*\)/g)).toBe(1);
    expect(dem(t, /\brevalidatePath\(\s*`\$\{BASE\}\/\$\{parsed\.data\.id\}`\s*\)/g)).toBe(1);
  });
});

describe("[XLW-02] xuLyReferral", () => {
  const src = than(doc(GHI), "xuLyReferral");

  it("cách ly cơ sở: đọc qua scopedDb TRƯỚC giao dịch + passesScope lại TRONG giao dịch", () => {
    expect(dem(src, /\bscopedDb\(p\.actor\)\.affiliateReferral\.findUnique\(/g)).toBe(1);
    expect(dem(src, /\bpassesScope\(\s*"AffiliateReferral"/g)).toBe(2);
    expect(vt(src, /\bscopedDb\(/)).toBeLessThan(vt(src, /\bdb\.\$transaction\(/));
  });

  it("trong giao dịch: KHOÁ hàng (FOR UPDATE) → so mốc đã thấy → máy trạng thái → rồi mới ghi", () => {
    expect(dem(src, /FOR UPDATE/g)).toBe(1);
    expect(dem(src, /cu\.updatedAt\.getTime\(\) !== p\.updatedAtDaThay\.getTime\(\)/g)).toBe(1);
    expect(dem(src, /\bchuyenTrangThai\(\s*cu\.status\s*,\s*p\.hanhDong\s*\)/g)).toBe(1);
    expect(vt(src, /FOR UPDATE/)).toBeLessThan(vt(src, /p\.updatedAtDaThay\.getTime\(\)/));
    expect(vt(src, /p\.updatedAtDaThay\.getTime\(\)/)).toBeLessThan(vt(src, /\bchuyenTrangThai\(/));
    expect(vt(src, /\bchuyenTrangThai\(/)).toBeLessThan(vt(src, /\btx\.affiliateReferral\.updateMany\(/));
  });

  it("phép ghi referral CÓ ĐIỀU KIỆN theo mốc đã đọc; đổi 0 dòng ⇒ throw (không return)", () => {
    expect(dem(src, /\btx\.affiliateReferral\.updateMany\(\s*\{\s*where:\s*\{\s*id:\s*cu\.id\s*,\s*updatedAt:\s*cu\.updatedAt\s*\}/g)).toBe(1);
    expect(dem(src, /if\s*\(\s*r\.count\s*===\s*0\s*\)\s*throw vuaDoi\(\)/g)).toBe(1);
  });

  it("lý do + ghi chú kiểm TRƯỚC khi chạm DB; mọi hành động để lại sự kiện + audit CÙNG giao dịch", () => {
    expect(dem(src, /\bkiemLyDo\(\s*p\.lyDo\s*\)/g)).toBe(1);
    expect(dem(src, /\bkiemGhiChuBangChung\(/g)).toBe(2);
    expect(vt(src, /\bkiemLyDo\(/)).toBeLessThan(vt(src, /\bscopedDb\(/));
    expect(dem(src, /\btx\.affiliateReferralEvent\.create\(/g)).toBe(1);
    expect(dem(src, /\bwriteAudit\(\s*\{\s*tx\s*,/g)).toBe(1);
    expect(dem(src, /previousReason:\s*cu\.resolutionReason/g)).toBe(1); // không viết đè lịch sử im lặng
  });

  it("sự kiện xử lý sinh ra ĐỦ cột cơ sở: orgUnitId chỉ truyền khi biết (dòng chỉ-thêm không để backfill UPDATE đụng trigger)", () => {
    expect(dem(src, /\.\.\.\(cu\.orgUnitId \? \{ orgUnitId: cu\.orgUnitId \} : \{\}\)/g)).toBe(1);
    expect(dem(src, /orgUnitId:\s*cu\.orgUnitId\s*,/g)).toBe(1); // chỉ còn dòng audit
  });

  it("không có đường đi tắt tới VALID: `status` chỉ được gán từ kết quả máy trạng thái", () => {
    expect(dem(src, /\bstatus:\s*"VALID"/g)).toBe(0);
    expect(dem(src, /\bdu\.status\s*=\s*dang\b/g)).toBe(1);
    expect(dem(src, /\bconst dang = ct\.den\b/g)).toBe(1);
  });

  it("tách nhiệm + chống tự hưởng: người khai ≠ người duyệt khi còn người khác; người duyệt ≠ chính đối tác", () => {
    expect(dem(src, /\bcoNguoiXuLyKhac\(/g)).toBe(1);
    expect(dem(src, /cu\.createdById\s*===\s*p\.nguoi\.userId/g)).toBe(1);
    expect(dem(src, /cu\.party\.userId\s*===\s*p\.nguoi\.userId/g)).toBe(1);
  });
});

describe("[XLW-03] DUYỆT ghi attribution đúng đường", () => {
  const src = than(doc(GHI), "xuLyReferral");

  it("`ghiNguonKhiDuyetReferral` gọi đúng MỘT lần, và TRƯỚC khi sửa referral", () => {
    expect(dem(src, /\bghiNguonKhiDuyetReferral\(/g)).toBe(1);
    expect(vt(src, /\bghiNguonKhiDuyetReferral\(/)).toBeLessThan(vt(src, /\btx\.affiliateReferral\.updateMany\(/));
  });

  it("từ chối của lớp ghi nguồn bị NÉM (throw), không return im lặng — referral không thành VALID khi nguồn chưa ghi", () => {
    expect(dem(src, /if\s*\(\s*!gn\.ok\s*\)\s*throw new LoiGhiAffiliate\(/g)).toBe(1);
  });

  it("nguồn giải LẠI từ cấu hình, không lấy `sourceGroupId` cũ của referral làm nguồn ghi", () => {
    expect(dem(src, /\bgiaiNguonCuaDoiTac\(/g)).toBe(1);
    expect(dem(src, /groupId:\s*nguon\.sourceGroupId/g)).toBe(1);
    expect(dem(src, /groupId:\s*cu\.sourceGroupId/g)).toBe(0);
    expect(dem(src, /if\s*\(\s*nguon\.sourceGroupId\s*===\s*null\s*\)\s*throw/g)).toBe(1);
  });

  it("chuỗi đối tác/thành viên/campaign + tự giới thiệu kiểm lại HÔM NAY bằng cùng cổng với khai tay", () => {
    expect(dem(src, /\bkiemKhaiTay\(/g)).toBe(1);
    expect(dem(src, /\bkiemTuGioiThieu\(/g)).toBe(1);
  });
});

describe("[XLW-04] ghi-nguon-affiliate-duyet.ts", () => {
  const src = doc(NGUON);

  it("đường GHI duy nhất là hàm của ghi-nguon.ts — không tự chạm bảng nguồn bằng create/update", () => {
    expect(dem(src, /\bleadAttribution\.(create|createMany|update|updateMany|delete|deleteMany|upsert)\(/g)).toBe(0);
    expect(dem(src, /\btaoNguonBanDau\(/g)).toBe(1);
    expect(dem(src, /\bdoiNguon\(/g)).toBe(1);
  });

  it("đua thua bị NÉM: `taoMoi:false` và `!r.ok` — không nuốt (một touchpoint «thua» đã bị ghi, phải lùi cả giao dịch)", () => {
    expect(dem(src, /if\s*\(\s*!r\.taoMoi\s*\)\s*throw new NguonDuaGhiError\(\)/g)).toBe(1);
    expect(dem(src, /if\s*\(\s*!r\.ok\s*\)\s*throw new NguonDuaGhiError\(\)/g)).toBe(1);
  });

  it("quyết định đi qua hàm thuần MỘT lần; khoá hàng quy nguồn (FOR UPDATE) TRƯỚC khi đọc; mọi từ chối đứng TRƯỚC phép ghi đầu tiên", () => {
    expect(dem(src, /\bquyetDinhGhiNguonAffiliate\(\{/g)).toBe(1);
    expect(dem(src, /FROM "LeadAttribution" WHERE "leadId" = \$\{p\.leadId\} FOR UPDATE/g)).toBe(1);
    const ghiDau = vt(src, /\btaoNguonBanDau\(/);
    expect(vt(src, /if\s*\(\s*qd\.loai\s*===\s*"TU_CHOI"\s*\)\s*return/)).toBeLessThan(ghiDau);
    expect(vt(src, /return \{ ok: false, ma: "NGUON_KHONG_DUNG_DUOC"/)).toBeLessThan(ghiDau);
    expect(vt(src, /return \{ ok: false, ma: "PHIEU_KHONG_CON"/)).toBeLessThan(ghiDau);
  });

  it("ghi người giới thiệu là ĐỐI TÁC (không phải nhân sự / phụ huynh) với mã luật AFFILIATE_REFERRAL; không ghi nhóm «chờ»", () => {
    expect(dem(src, /referrerKind:\s*"AFFILIATE"/g)).toBe(1);
    expect(dem(src, /referrerAffiliateId:\s*p\.partyId/g)).toBe(1);
    expect(dem(src, /matchedRule:\s*"AFFILIATE_REFERRAL"/g)).toBe(2);
    expect(dem(src, /groupId:\s*p\.groupId/g)).toBe(2);
    expect(dem(src, /groupId:\s*"UNKNOWN"/g)).toBe(0);
    expect(dem(src, /\bstatus !== "ACTIVE"/g)).toBe(1);
  });

  it("đổi nhóm «chờ» dùng khoá lạc quan theo `updatedAt` đã đọc dưới khoá", () => {
    expect(dem(src, /daDocUpdatedAt:\s*cu\.updatedAt/g)).toBe(1);
  });
});

describe("[XLW-05] khaiTayReferral", () => {
  const src = than(doc(GHI), "khaiTayReferral");

  it("schema strict; phiếu qua scopedDb + passesScope; khoá giao dịch trước khi kiểm trùng; sự kiện + audit", () => {
    expect(dem(src, /\bkhaiTayReferralSchema\.safeParse\(p\.vao\)/g)).toBe(1);
    expect(dem(src, /\bscopedDb\(p\.actor\)\.lead\.findUnique\(/g)).toBe(1);
    expect(dem(src, /\bpassesScope\(\s*"Lead"/g)).toBe(1);
    expect(dem(src, /pg_advisory_xact_lock\(hashtext\(\$\{khoaGiaoDichKhaiTay\(v\)\}\)\)/g)).toBe(1);
    expect(vt(src, /pg_advisory_xact_lock/)).toBeLessThan(vt(src, /\bkiemKhaiTay\(/));
    expect(vt(src, /\bkiemKhaiTay\(/)).toBeLessThan(vt(src, /\btx\.affiliateReferral\.create\(/));
    expect(dem(src, /\btx\.affiliateReferralEvent\.create\(/g)).toBe(1);
    expect(dem(src, /\bwriteAudit\(\s*\{\s*tx\s*,/g)).toBe(1);
  });

  it("lượt khai tay LUÔN vào MANUAL_REVIEW (không tự chiếm attribution); nguồn giải từ CẤU HÌNH, không từ client; tiền không có chỗ vào", () => {
    expect(dem(src, /\bstatus:\s*"MANUAL_REVIEW"/g)).toBe(2); // referral + audit (sự kiện dùng toStatus)
    expect(dem(src, /\bstatus:\s*"VALID"/g)).toBe(0);
    expect(dem(src, /\bgiaiNguonCuaDoiTac\(/g)).toBe(1);
    expect(dem(src, /sourceGroupId:\s*nguon\.sourceGroupId/g)).toBe(1);
    expect(dem(src, /sourceGroupId:\s*v\./g)).toBe(0);
    expect(dem(src, /\b(soTien|amount|commission|rate|tiLe)\b/gi)).toBe(0);
  });

  it("centerId / orgUnitId CHÉP từ phiếu (cách ly cơ sở) và người khai được ghi (createdById)", () => {
    expect(dem(src, /centerId:\s*lead!\.centerId/g)).toBe(2);
    expect(dem(src, /orgUnitId:\s*lead!\.orgUnitId/g)).toBe(3); // referral + sự kiện (chỉ khi biết) + audit
    // sự kiện chỉ-thêm KHÔNG được mang `orgUnitId: null` tường minh — dòng sinh ra thiếu cột sẽ làm script backfill (UPDATE) đụng trigger chỉ-thêm
    expect(dem(src, /orgUnitId:\s*null\b/g)).toBe(0);
    expect(dem(src, /createdById:\s*p\.nguoi\.userId/g)).toBe(1);
  });
});

describe("[XLW-06] bản chụp dựng ở MỘT nơi", () => {
  it("cả hai đường ghi tay dùng dungSnapshotReferral (duyệt: 1, khai tay: 1) và không tự gõ khoá `affiliateCode:` / `tuNhan:`", () => {
    const g = doc(GHI);
    expect(dem(g, /\bdungSnapshotReferral\(/g)).toBe(2);
    expect(dem(g, /\btuNhan\s*:/g)).toBe(0);
    expect(dem(doc(NGUON), /\bdungSnapshotReferral\(/g)).toBe(0); // lớp nguồn nhận bản chụp đã dựng, không tự dựng
  });
});

describe("[XLW-07] chặn tự giới thiệu: MỘT hàm dựng danh tính đối tác cho cả ba đường", () => {
  // Đọc tệp THÔ (không qua `boChuThich`): `ghi-referral-xu-ly.ts` có chuỗi chứa `/*` làm bộ bỏ chú thích khối nuốt cả đoạn. Neo vào lời gọi có `await` nên chú thích không khớp.
  const tho = (duong: string) => readFileSync(resolve(GOC, duong), "utf8");
  it("duyệt · khai tay · tự động đều `await danhTinhDoiTacDeChan(`; không đường nào tự ghép SĐT/email của đối tác (chỉ người đại diện) tại chỗ", () => {
    const g = tho(GHI);
    expect(dem(g, /await danhTinhDoiTacDeChan\(/g)).toBe(2);
    expect(dem(g, /(?:phones|emails)\s*:\s*\[\s*(?:cu\.)?party\b/g)).toBe(0);
    const n = tho("lib/affiliate/nhan-referral.ts");
    expect(dem(n, /await danhTinhDoiTacDeChan\(/g)).toBe(1);
    expect(dem(n, /(?:phones|emails)\s*:\s*\[\s*asset\.party\b/g)).toBe(0);
    // hàm dùng chung phải đọc MỌI tài khoản còn gắn với đối tác (không chỉ người đại diện)
    expect(dem(tho("lib/affiliate/danh-tinh-doi-tac.ts"), /await userIdsGanVoiDoiTac\(/g)).toBe(1);
  });
});
