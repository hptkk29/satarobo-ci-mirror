// Ca [TCW-*] — LƯỚI GHIM MÃ NGUỒN của trang công khai "thông tin người mua hoá đơn" (S11, phía phụ huynh).
//
// Hành vi (cờ TẮT không gọi dịch vụ, rate-limit trước DB, không lộ mã lỗi) đo ở `lib/finance/hoa-don/yeu-cau-nguoi-mua-cong-khai.test.ts`, `_actions.test.ts` và Postgres thật.
// Lưới này khoá thứ mã KHÔNG làm / làm ở ĐÚNG chỗ mà test hành vi không chứng minh được:
//   · trang không kéo analytics / JSON-LD / dữ liệu đơn-học viên, có noindex + không Referer, và là `force-dynamic`;
//   · trang và action đi vào dịch vụ CHỈ qua bộ điều phối (đi tắt `moBangToken` / `guiThongTinPhuHuynh` là bỏ cổng cờ + rate-limit);
//   · thứ tự cổng trong bộ điều phối (hạn mức → cơ sở → cờ → dịch vụ);
//   · không có ô giấy tờ tuỳ thân; bộ điều phối không đọc đồng hồ, không `console`.
// Cách viết (CLAUDE.md "lưới ghim mã nguồn"): đọc mã đã BÓC chú thích; neo vào lời gọi / biểu thức; đếm SỐ LẦN khớp; mỗi ca đã cấy lỗi để thấy ĐỎ.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
const doc = (f: string) => boChuThich(readFileSync(resolve(process.cwd(), f), "utf8"));
const dem = (src: string, re: RegExp) => src.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))?.length ?? 0;

const TRANG_DIR = "app/(public)/thong-tin-hoa-don/[ma]";
const TRANG = `${TRANG_DIR}/page.tsx`;
const ACTION = `${TRANG_DIR}/_actions.ts`;
const FORM = `${TRANG_DIR}/_components/form-thong-tin-nguoi-mua.tsx`;
const THONG_BAO = `${TRANG_DIR}/_components/thong-bao-lien-ket.tsx`;
const HANG_SO = `${TRANG_DIR}/_hang-so.ts`;
const LIB = "lib/finance/hoa-don";
const DIEU_PHOI = `${LIB}/yeu-cau-nguoi-mua-cong-khai.ts`;
const NOI_DAY = `${LIB}/yeu-cau-nguoi-mua-cong-khai-db.ts`;
const BIEU_MAU = `${LIB}/yeu-cau-nguoi-mua-bieu-mau.ts`;
const TAT_CA_APP = [TRANG, ACTION, FORM, THONG_BAO, HANG_SO] as const;

describe("[TCW-1] trang: không phải trang marketing, không lộ dữ liệu đơn", () => {
  const trang = doc(TRANG);
  it("noindex + nofollow + không Referer + force-dynamic, mỗi thứ đúng MỘT lần", () => {
    expect(dem(trang, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/)).toBe(1);
    expect(dem(trang, /referrer:\s*"no-referrer"/)).toBe(1);
    expect(dem(trang, /export const dynamic\s*=\s*"force-dynamic"/)).toBe(1);
    expect(dem(trang, /index:\s*true|follow:\s*true/)).toBe(0);
  });
  it("không import analytics / JSON-LD / breadcrumb / animation / thư viện UI cấm, không nhúng HTML thô", () => {
    for (const f of TAT_CA_APP) {
      const s = doc(f);
      expect(dem(s, /from\s+"@\/components\/(public\/(ga4|meta-pixel)|seo|magic|motion|charts)/), f).toBe(0);
      expect(dem(s, /framer-motion|from\s+"motion|recharts|jsonld|JsonLd|breadcrumb|application\/ld\+json|dangerouslySetInnerHTML|gtag|fbq\(/i), f).toBe(0);
    }
  });
  it("không chạm Prisma / mô hình đơn-học viên / SĐT / số tiền: không import `@/lib/db`, không nhắc `order`, `student`, `customerPhone`, `totalAmount`", () => {
    for (const f of TAT_CA_APP) {
      const s = doc(f);
      expect(dem(s, /@\/lib\/db"|@prisma\/client|prisma\./), f).toBe(0);
      // `tenHocVien` KHÔNG còn bị cấm: từ 02/11/2026 nó là một ô của biểu mẫu (tên học viên do PH tự khai, tuỳ chọn) — không phải dữ liệu đọc từ mô hình học viên.
      expect(dem(s, /\border(Id|Code)?\b|\bstudent\w*|customerPhone|customerName|totalAmount|maDon/i), f).toBe(0);
    }
  });
  it("trang đi vào dịch vụ CHỈ qua `xuLyMoTrang` (đúng một lời gọi) và có chặn bot; không gọi thẳng `moBangToken`", () => {
    expect(dem(trang, /\bxuLyMoTrang\(/)).toBe(1);
    expect(dem(trang, /\blaBotXemTruoc\(/)).toBe(1);
    expect(dem(trang, /\bmoBangToken\b|\bguiThongTinPhuHuynh\b/)).toBe(0);
  });
  it("không tính toán/hiển thị ngày giờ, mã đơn hay số tiền ở trang: chỉ hai lời `new Date()` hợp lệ là `now` truyền vào bộ điều phối (đúng 1)", () => {
    expect(dem(trang, /new Date\(\)/)).toBe(1);
    expect(dem(trang, /now:\s*new Date\(\)/)).toBe(1);
  });
});

describe("[TCW-2] Server Action: mỏng, đi qua bộ điều phối, không log", () => {
  const act = doc(ACTION);
  it("`'use server'` + chỉ export hàm async + đúng MỘT lời gọi `xuLyGui` với phiên bản điều khoản từ hằng", () => {
    expect(readFileSync(resolve(process.cwd(), ACTION), "utf8").trimStart().startsWith('"use server"')).toBe(true);
    expect(dem(act, /^export\s/m)).toBe(1);
    expect(dem(act, /^export async function guiThongTinNguoiMuaAction\(/m)).toBe(1);
    expect(dem(act, /\bxuLyGui\(/)).toBe(1);
    expect(dem(act, /phienBanDieuKhoan:\s*PHIEN_BAN_DIEU_KHOAN/)).toBe(1);
  });
  it("không đi tắt vào dịch vụ, không đọc DB, không console", () => {
    expect(dem(act, /\bmoBangToken\b|\bguiThongTinPhuHuynh\b|@\/lib\/db"|console\./)).toBe(0);
  });
  it("IP lấy bằng `ipChoRateLimit` (cùng luật chống giả header với mọi nơi khác), không đọc thẳng x-forwarded-for", () => {
    expect(dem(act, /ipChoRateLimit\(/)).toBe(1);
    expect(dem(act, /x-forwarded-for|x-real-ip/i)).toBe(0);
  });
});

describe("[TCW-3] bộ điều phối: thứ tự cổng", () => {
  const dp = doc(DIEU_PHOI);
  const viTri = (re: RegExp) => dp.search(re);
  it("trong `quaCong`: hạn mức IP → hạn mức yêu cầu → đọc cơ sở → cờ, đúng thứ tự", () => {
    const a = viTri(/pt\.choPhep\(`hoa-don-nguoi-mua:\$\{loaiTanSuat\}:ip:/);
    const b = viTri(/pt\.choPhep\(`hoa-don-nguoi-mua:yeu-cau:/);
    const c = viTri(/pt\.docCoSo\(id\)/);
    const d = viTri(/pt\.hubBat\(coSo\)/);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(d).toBeGreaterThan(c);
  });
  it("cờ TẮT trả về TRƯỚC khi đọc cấu hình / gọi dịch vụ: `quaCong` đứng trước `pt.docCauHinh()` và `pt.mo(` / `pt.gui(` ở cả hai đường", () => {
    expect(dem(dp, /await quaCong\(/)).toBe(2);
    expect(dem(dp, /pt\.docCauHinh\(\)/)).toBe(2);
    expect(dem(dp, /pt\.mo\(/)).toBe(1);
    expect(dem(dp, /pt\.gui\(/)).toBe(1);
    const mo = dp.slice(dp.indexOf("export async function xuLyMoTrang"), dp.indexOf("// ── GỬI BIỂU MẪU"));
    const gui = dp.slice(dp.indexOf("export async function xuLyGui"));
    for (const [ten, s, goi] of [["mở", mo, "pt.mo("], ["gửi", gui, "pt.gui("]] as const) {
      expect(s.indexOf("await quaCong("), ten).toBeGreaterThan(-1);
      expect(s.indexOf(goi), ten).toBeGreaterThan(s.indexOf("await quaCong("));
      expect(s.indexOf("pt.docCauHinh()"), ten).toBeGreaterThan(s.indexOf("await quaCong("));
    }
  });
  it("đường GỬI: kiểm biểu mẫu nằm SAU cổng và TRƯỚC khi gọi dịch vụ; `donY` luôn có (không bao giờ null)", () => {
    const gui = dp.slice(dp.indexOf("export async function xuLyGui"));
    expect(gui.indexOf("kiemBieuMau(")).toBeGreaterThan(gui.indexOf("await quaCong("));
    expect(gui.indexOf("pt.gui(")).toBeGreaterThan(gui.indexOf("kiemBieuMau("));
    expect(dem(gui, /donY:\s*\{\s*phienBanDieuKhoan:\s*i\.phienBanDieuKhoan\s*\}/)).toBe(1);
    expect(dem(gui, /donY:\s*null/)).toBe(0);
  });
  it("bot và mã sai hình dạng bị chặn trước mọi cổng khác ở đường mở", () => {
    const mo = dp.slice(dp.indexOf("export async function xuLyMoTrang"), dp.indexOf("// ── GỬI BIỂU MẪU"));
    // Neo vào CÂU LỆNH trả về sớm, không chỉ vào chuỗi `i.laBot` (phép cấy `void i.laBot;` còn giữ chuỗi mà đã bỏ cổng).
    expect(dem(mo, /if \(i\.laBot\) return \{ kieu: "KHONG_CON_HIEU_LUC"/)).toBe(1);
    expect(mo.indexOf("i.laBot")).toBeGreaterThan(-1);
    expect(mo.indexOf("tachMaLienKet(")).toBeGreaterThan(mo.indexOf("i.laBot"));
    expect(mo.indexOf("await quaCong(")).toBeGreaterThan(mo.indexOf("tachMaLienKet("));
  });
  it("không đọc đồng hồ, không console, không import DB / Prisma (thuần; mọi thứ ngoài đi qua `PhuThuoc`)", () => {
    expect(dem(dp, /new Date\(|Date\.now\(|console\./)).toBe(0);
    expect(dem(dp, /@\/lib\/db"|@prisma\/client|from\s+"@\/lib\/(rate-limit|settings)/)).toBe(0);
  });
  it("lỗi bất ngờ chỉ ghi TÊN loại: `ghiLoi(tenLoi(e))`, không `e.message`/`String(e)`/`e.stack`", () => {
    expect(dem(dp, /pt\.ghiLoi\(tenLoi\(e\)\)/)).toBe(2);
    expect(dem(dp, /\be\.message|String\(e\)|\be\.stack|JSON\.stringify\(e/)).toBe(0);
  });
});

describe("[TCW-4] nối với hệ thật: log chỉ có tên lỗi; cờ + đọc cơ sở không có tác dụng phụ", () => {
  const nd = doc(NOI_DAY);
  it("đúng một `console.error`, chỉ nội suy `tenLoi`", () => {
    expect(dem(nd, /console\./)).toBe(1);
    expect(dem(nd, /console\.error\(`\[hoa-don-nguoi-mua\][^`$]*\$\{tenLoi\}`\)/)).toBe(1);
  });
  it("đọc cơ sở chỉ `findUnique … select: { centerId: true }` (không `update`/`create`/`$transaction`) và chặn id sai hình dạng trước khi chạm DB", () => {
    expect(dem(nd, /\.(update|updateMany|create|createMany|delete|deleteMany|upsert|\$transaction|\$executeRaw)\b/)).toBe(0);
    expect(dem(nd, /findUnique\(\{\s*where:\s*\{\s*id\s*\},\s*select:\s*\{\s*centerId:\s*true\s*\}\s*\}\)/)).toBe(1);
    expect(nd.indexOf("MAU_ID_YEU_CAU.test(id)")).toBeGreaterThan(-1);
    expect(nd.indexOf("MAU_ID_YEU_CAU.test(id)")).toBeLessThan(nd.indexOf("findUnique("));
  });
  it("cờ hỏi bằng `laHubNguoiMuaBatChoCoSo` (cờ THEO CƠ SỞ), không phải cờ toàn hệ", () => {
    expect(dem(nd, /hubBat:\s*laHubNguoiMuaBatChoCoSo/)).toBe(1);
  });
});

describe("[TCW-5] giấy tờ tuỳ thân: CHỈ CCCD (chủ dự án chốt 02/11/2026); không giấy tờ nào khác ở bất kỳ tầng nào", () => {
  it("không có `cmnd` / `soCanCuoc` / `passport` / `hoChieu` trong mã (đã bóc chú thích) của trang, biểu mẫu, bộ điều phối, bộ kiểm biểu mẫu", () => {
    for (const f of [...TAT_CA_APP, DIEU_PHOI, NOI_DAY, BIEU_MAU]) {
      expect(dem(doc(f), /cmnd|soCanCuoc|so_can_cuoc|passport|hoChieu/i), f).toBe(0);
    }
  });
  it("CCCD chỉ có ở NƠI ĐƯỢC PHÉP: biểu mẫu + bộ kiểm biểu mẫu; trang (page) và action KHÔNG đụng ô nhạy cảm nào — trang không truyền CCCD xuống form", () => {
    expect(dem(doc(FORM), /\bcccd\b/)).toBeGreaterThan(0);
    expect(dem(doc(BIEU_MAU), /\bcccd\b/)).toBeGreaterThan(0);
    expect(dem(doc(TRANG), /cccd|\bsdt\b|ngaySinh/i)).toBe(0);
    expect(dem(doc(ACTION), /cccd|\bsdt\b|ngaySinh/i)).toBe(0);
  });
  it("tập ô gửi đi là đúng `O_NGUOI_MUA` — biểu mẫu thô chỉ đọc 10 khoá + dongY", () => {
    const bm = doc(BIEU_MAU);
    const ham = bm.slice(bm.indexOf("export function docBieuMauTho"), bm.indexOf("export function kiemBieuMau"));
    expect(ham.length).toBeGreaterThan(50);
    expect(dem(ham, /loai:\s*chuoi\(r\.loai\)/)).toBe(1);
    expect(dem(ham, /[^A-Za-z]r\.\w+/)).toBe(11); // đúng 11 lần đọc khoá: loai · ten · diaChi · email · maSoThue · cccd · sdt · tenHocVien · ngaySinhHocVien · cccdHocVien · dongY
    expect(dem(ham, /[^A-Za-z]r\.(?!(loai|ten|diaChi|email|maSoThue|cccd|sdt|tenHocVien|ngaySinhHocVien|cccdHocVien|dongY)[^A-Za-z])\w+/)).toBe(0);
  });
});

describe("[TCW-6] hằng số đồng ý", () => {
  it("phiên bản điều khoản mang `-nhap` và nhãn đồng ý + câu quyền riêng tư tồn tại đúng một lần", () => {
    const s = readFileSync(resolve(process.cwd(), HANG_SO), "utf8");
    expect(dem(s, /PHIEN_BAN_DIEU_KHOAN\s*=\s*"[\d-]+-nhap(-[a-z]+)?"/)).toBe(1);
    expect(dem(s, /export const NHAN_DONG_Y\b/)).toBe(1);
    expect(dem(s, /export const NOI_DUNG_QUYEN_RIENG_TU\b/)).toBe(1);
  });
});
