// @vitest-environment node
/**
 * [CTN-W1..W10] — LƯỚI GHIM MÃ NGUỒN cho dây nối của trang CHI TIẾT NGUỒN (SPEC nguồn động §4 mục 4/6).
 *
 * Page là Server Component kéo next-auth + Prisma nên không dựng được trong vitest; cổng quyền / thứ tự mục / nguồn dữ liệu của nó chỉ ghim được bằng văn bản mã nguồn ĐÃ BỎ CHÚ THÍCH.
 * Luật 11 (CLAUDE.md): neo hẹp vào BIỂU THỨC (khoá quyền, tên hàm đọc), ĐẾM số lần khớp, không cờ `/s`; không neo vào chỗ đặt `await`. Luật 14: mỗi ca đã được CẤY lại lỗi để thấy nó đỏ.
 *
 *   [CTN-W1]  liên kết «Sửa nguồn» VÀ nút «Đổi trạng thái» chỉ vẽ khi người xem có ĐÚNG khoá mà các action kiểm, cùng MỘT cổng coTheGhi
 *   [CTN-W2]  «Tạo chính sách»: khoá hỏi ở trang = khoá trình soạn kiểm ở đích; tham số `?nguon=` của liên kết = tham số đích đọc và đưa qua hàm thuần
 *   [CTN-W3]  trang CHỈ ĐỌC: không Server Action, không ghi DB, không `@/lib/db` trần
 *   [CTN-W4]  đủ BẢY mục, đúng thứ tự, mỗi mục đúng một lần
 *   [CTN-W5]  cờ engine lấy từ `scope.co.engine` (không hằng): tắt thì mục Chính sách nói
 *   [CTN-W6]  các câu đọc độc lập cùng MỘT lượt song song (độ sâu tuần tự): số `await` của trang bị chặn
 *   [CTN-W7]  nhật ký có giới hạn: mặc định nhỏ, «xem tất cả» dùng đúng trần của hàm đọc
 *   [CTN-W8]  nguồn là danh mục MỞ: không mã nguồn mặc định, không danh sách giá trị nhóm nguồn trong UI của trang (nhãn nằm ở Record<enum> duy nhất)
 *   [CTN-W9]  đếm người giới thiệu đi qua `scopedDb(actor).lead` — không đọc thẳng bảng attribution, không `db` trần
 *   [CTN-W10] mỗi mục đọc qua `docMuc` (cô lập lỗi) — không `await` trần một hàm đọc
 *   [CTN-W11] nút «Đổi trạng thái»: đúng một nút, dựng từ mục thông tin, gọi action gác CHÍNH khoá sources:manage; mã đích mặc định từ docMaDichMacDinh() (không mảng gõ tay)
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KHOA_SOAN_CHINH_SACH, KHOA_SUA_NGUON, hrefTaoChinhSachChoNguon } from "@/components/admin/nguon-hoa-hong/chi-tiet-nguon/lien-ket-nguon";

const GOC = process.cwd();

/** Bỏ chú thích dòng TRƯỚC, khối SAU (chú thích dòng hay nhắc `lib/x/*` — chuỗi `/*` đó mở một "khối" giả nuốt mã thật). */
function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const PAGE = "app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/page.tsx";
const ACTIONS = "app/(admin)/admin/nguon-hoa-hong/nguon/_actions.ts";
const MOI = "app/(admin)/admin/nguon-hoa-hong/chinh-sach/moi/page.tsx";
const DIR_MUC = "components/admin/nguon-hoa-hong/chi-tiet-nguon";

/** Thân một hàm `export async function <ten>` (đến hàm export kế tiếp / hết tệp). */
function thanHam(src: string, ten: string): string {
  const i = src.indexOf(`export async function ${ten}`);
  expect(i, `không thấy hàm ${ten}`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf("export async function", i + 10);
  return src.slice(i, j === -1 ? undefined : j);
}

describe("[CTN-W1] «Sửa nguồn» + «Đổi trạng thái» chỉ vẽ cho người có ĐÚNG khoá của action", () => {
  const page = doc(PAGE);
  it("trang hỏi `scope.has(\"sources:manage\")` đúng 1 lần (biến `coTheGhi`); liên kết `hrefSuaNguon` VÀ nút `<NutDoiTrangThai` cùng đứng trong nhánh `actions={coTheGhi ? …}`", () => {
    expect(dem(page, new RegExp(`const coTheGhi = scope\\.has\\(\\s*"${KHOA_SUA_NGUON}"\\s*\\)`, "g"))).toBe(1);
    expect(dem(page, new RegExp(`scope\\.has\\(\\s*"${KHOA_SUA_NGUON}"\\s*\\)`, "g"))).toBe(1);
    expect(dem(page, /\bhrefSuaNguon\(/g)).toBe(1);
    expect(dem(page, /<NutDoiTrangThai\b/g)).toBe(1);
    expect(dem(page, /actions=\{\s*coTheGhi\s*\?/g)).toBe(1);
    // cả hai nằm SAU điều kiện (không vẽ vô điều kiện)
    const cong = page.search(/actions=\{\s*coTheGhi\s*\?/);
    expect(cong).toBeGreaterThan(0);
    expect(page.indexOf("hrefSuaNguon(")).toBeGreaterThan(cong);
    expect(page.indexOf("<NutDoiTrangThai")).toBeGreaterThan(cong);
  });
  it("`suaNguonAction` kiểm CHÍNH khoá đó ở đầu hàm (ghim hai phía: đổi một bên là đỏ)", () => {
    const sua = thanHam(doc(ACTIONS), "suaNguonAction");
    expect(dem(sua, new RegExp(`checkPermission\\(\\s*"${KHOA_SUA_NGUON}"\\s*\\)`, "g"))).toBe(1);
  });
});

describe("[CTN-W2] «Tạo chính sách cho nguồn này»", () => {
  const page = doc(PAGE);
  const moi = doc(MOI);
  it("trang hỏi `commission_policies:manage` đúng 1 lần (quyền SOẠN) và tab chính sách mở được", () => {
    expect(dem(page, new RegExp(`coQuyenSoan:\\s*scope\\.has\\(\\s*"${KHOA_SOAN_CHINH_SACH}"\\s*\\)`, "g"))).toBe(1);
    expect(dem(page, /tabChinhSachMoDuoc:\s*scope\.tabMoDuoc\(\s*"chinh-sach"\s*\)/g)).toBe(1);
  });
  it("trình soạn ở đích kiểm CHÍNH khoá đó", () => {
    expect(dem(moi, new RegExp(`scope\\.has\\(\\s*"${KHOA_SOAN_CHINH_SACH}"\\s*\\)`, "g"))).toBeGreaterThanOrEqual(1);
  });
  it("tham số liên kết = tham số đích đọc, và đi qua hàm thuần với danh sách nguồn trình soạn đã tải", () => {
    const thamSo = new URL(hrefTaoChinhSachChoNguon("ZALO_OA"), "http://x").searchParams;
    expect([...thamSo.keys()]).toEqual(["nguon"]);
    expect(dem(moi, /\bsp\.nguon\b/g)).toBe(1);
    expect(dem(moi, /\bnguonChonSanTuMa\(\s*motGiaTri\(\s*sp\.nguon\s*\)\s*,\s*dl\.nhomNguon\s*\)/g)).toBe(1);
    expect(dem(moi, /\bsourceGroupId:\s*nguonChonSan\.id\b/g)).toBe(1);
  });
});

describe("[CTN-W3] trang CHỈ ĐỌC", () => {
  const page = doc(PAGE);
  it("không Server Action, không import _actions, không `@/lib/db`, không phép ghi", () => {
    expect(dem(page, /["']use server["']/g)).toBe(0);
    expect(dem(page, /from\s+["'][^"']*_actions["']/g)).toBe(0);
    expect(dem(page, /from\s+["']@\/lib\/db["']/g)).toBe(0);
    expect(dem(page, /\.(create|update|upsert|delete|deleteMany|updateMany)\(/g)).toBe(0);
  });
});

describe("[CTN-W4] bảy mục, đúng thứ tự", () => {
  it("Thông tin · Attribution · Đối tượng · Chính sách · Tracking · Thống kê · Lịch sử — mỗi mục 1 lần", () => {
    const page = doc(PAGE);
    const thuTu = ["MucThongTin", "MucAttribution", "MucDoiTuong", "MucChinhSach", "MucTracking", "MucThongKe", "MucLichSu"];
    const vitri = thuTu.map((t) => {
      expect(dem(page, new RegExp(`<${t}\\b`, "g")), `<${t}>`).toBe(1);
      return page.indexOf(`<${t}`);
    });
    expect([...vitri].sort((a, b) => a - b)).toEqual(vitri);
  });
});

describe("[CTN-W5] cờ engine", () => {
  it("`engineBat={scope.co.engine}` đúng 1 lần — không hằng true/false", () => {
    const page = doc(PAGE);
    expect(dem(page, /engineBat=\{\s*scope\.co\.engine\s*\}/g)).toBe(1);
    expect(dem(page, /engineBat=\{\s*(true|false)\s*\}/g)).toBe(0);
  });
});

describe("[CTN-W6] độ sâu tuần tự của trang", () => {
  it("đúng 3 `await` (vaoTab · params+searchParams · [trang + hàng chờ]) — thêm một await nối đuôi là đỏ; hàng chờ chung lượt với trang", () => {
    const page = doc(PAGE);
    expect(dem(page, /\bawait\b/g)).toBe(3);
    expect(dem(page, /\bPromise\.all\(\s*\[\s*docTrangChiTietNguon\(/g)).toBe(1);
    expect(dem(page, /docSoHangChoTheoTab\(\s*actor\s*,\s*scope\s*\)/g)).toBe(1);
    // mã đích mặc định cho nút trạng thái cùng lượt song song (không thêm await): chỉ đọc khi người xem GHI được
    expect(dem(page, /coTheGhi\s*\?\s*docMaDichMacDinh\(\)\s*:\s*Promise\.resolve/g)).toBe(1);
    expect(dem(page, /docMaDichMacDinh\(\)/g)).toBe(1);
  });
});

describe("[CTN-W6b] hai câu hỏi QUYỀN trong lượt song song không được làm văng cả trang", () => {
  it("`coQuyenKichHoatChinhSach()` và `docCoQuyenSuaTran()` đều bọc `.catch(() => false)` (fail-closed); không còn lời gọi trần nào", () => {
    // Cấy: gỡ một trong hai `.catch` ⇒ lỗi thoáng qua của `auth()`/tra grant làm cả trang chi tiết nguồn rơi vào error.tsx.
    const page = doc(PAGE);
    expect(dem(page, /coQuyenKichHoatChinhSach\(\)\.catch\(\(\)\s*=>\s*false\)/g)).toBe(1);
    expect(dem(page, /docCoQuyenSuaTran\(\)\.catch\(\(\)\s*=>\s*false\)/g)).toBe(1);
    expect(dem(page, /coQuyenKichHoatChinhSach\(\)/g)).toBe(1);
    expect(dem(page, /docCoQuyenSuaTran\(\)/g)).toBe(1);
  });
});

describe("[CTN-W7] nhật ký có giới hạn", () => {
  it("mặc định ≤ 50 dòng; «xem tất cả» dùng TRAN_LICH_SU_NGUON của hàm đọc (không hằng thứ hai)", () => {
    const page = doc(PAGE);
    const m = /const LICH_SU_MAC_DINH\s*=\s*(\d+)/.exec(page);
    expect(m, "thiếu hằng LICH_SU_MAC_DINH").not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(50);
    expect(dem(page, /lichSuToiDa:\s*xemTatCa\s*\?\s*TRAN_LICH_SU_NGUON\s*:\s*LICH_SU_MAC_DINH/g)).toBe(1);
  });
});

describe("[CTN-W8] nguồn là danh mục MỞ — UI không so mã, không liệt kê giá trị", () => {
  const tep = [PAGE, ...readdirSync(resolve(GOC, DIR_MUC)).filter((t) => /\.(ts|tsx)$/.test(t) && !/\.test\./.test(t)).map((t) => join(DIR_MUC, t))];
  it("không có mã nguồn mặc định trong trang và các mục (trừ nhãn Record<enum> ở nhan-chi-tiet.ts cho GIÁ TRỊ ENUM, không phải mã nguồn)", () => {
    expect(tep.length).toBeGreaterThanOrEqual(8);
    for (const t of tep) {
      const s = doc(t);
      for (const ma of ["PARENT_REFERRAL", "PAID_ADS", "CENTER_ORGANIC", "WALK_IN", "EMPLOYEE_REFERRAL", "EVENT", "PARTNER"]) {
        expect(dem(s, new RegExp(`["'\`]${ma}["'\`]`, "g")), `${t}: "${ma}"`).toBe(0);
      }
    }
  });
  it("giá trị enum nhóm nguồn chỉ liệt kê ở MỘT nơi (nhan-chi-tiet.ts)", () => {
    for (const t of tep.filter((x) => !x.endsWith("nhan-chi-tiet.ts"))) {
      expect(dem(doc(t), /["']MARKETING["']/g), t).toBe(0);
    }
  });
  it("UNKNOWN: ngoại lệ DUY NHẤT được so mã — qua hằng MA_NGUON_KHONG_RO, không chuỗi trần", () => {
    const page = doc(PAGE);
    expect(dem(page, /["']UNKNOWN["']/g)).toBe(0);
    expect(dem(page, /laKhongRo:\s*ma\s*===\s*MA_NGUON_KHONG_RO/g)).toBe(1);
  });
});

describe("[CTN-W9] đếm người giới thiệu: cách ly cơ sở", () => {
  const src = doc("lib/nguon/dem-nguoi-gioi-thieu.ts");
  it("qua scopedDb(actor).lead; không `db` trần, không đọc thẳng leadAttribution", () => {
    expect(dem(src, /\bscopedDb\(\s*actor\s*\)/g)).toBe(1);
    expect(dem(src, /\bsdb\.lead\.count\(/g)).toBe(1);
    expect(dem(src, /from\s+["']@\/lib\/db["']/g)).toBe(0);
    expect(dem(src, /\bleadAttribution\b/g)).toBe(0);
  });
});

describe("[CTN-W10] cô lập lỗi theo mục", () => {
  const src = doc("lib/nguon/doc-trang-chi-tiet.ts");
  it("sáu câu đọc độc lập trong MỘT Promise.all, mỗi câu bọc docMuc", () => {
    expect(dem(src, /\bPromise\.all\(/g)).toBe(1);
    for (const ten of ["docChiTietNguon", "docNguonDeSua", "demNguoiGioiThieuTheoLoai", "docChinhSachApDungCuaNguon", "docHoaHongCuaNguon", "docLichSuNguon"]) {
      expect(dem(src, new RegExp(`docMuc\\(\\s*"[^"]+"\\s*,\\s*\\(\\)\\s*=>\\s*${ten}\\(`, "g")), ten).toBe(1);
    }
  });
});

describe("[CTN-W11] nút «Đổi trạng thái» của trang chi tiết", () => {
  const page = doc(PAGE);
  const nut = doc("components/admin/nguon-hoa-hong/doi-trang-thai-nguon.tsx");
  const actions = doc(ACTIONS);
  it("trang vẽ ĐÚNG một nút, dựng từ `nguonChoNutTrangThai(trang.nguon)` (mục lỗi ⇒ không nút), mã đích mặc định từ `docMaDichMacDinh()` (không mảng gõ tay)", () => {
    expect(dem(page, /<NutDoiTrangThai\b/g)).toBe(1);
    expect(dem(page, /const nutTrangThai = nguonChoNutTrangThai\(\s*trang\.nguon\s*\)/g)).toBe(1);
    expect(dem(page, /nutTrangThai\s*&&\s*<NutDoiTrangThai\b/g)).toBe(1);
    expect(dem(page, /dichMacDinh=\{dichMacDinh\}/g)).toBe(1);
    expect(dem(page, /dichMacDinh=\{\s*\[/g)).toBe(0);
  });
  it("nút gọi `doiTrangThaiNguonAction` và action kiểm CHÍNH khoá `sources:manage` ở đầu hàm (hai phía trùng một chuỗi)", () => {
    expect(dem(nut, /\bdoiTrangThaiNguonAction\(/g)).toBe(1);
    const i = actions.indexOf("export async function doiTrangThaiNguonAction");
    expect(i).toBeGreaterThanOrEqual(0);
    const j = actions.indexOf("export async function", i + 10);
    const than = actions.slice(i, j === -1 ? undefined : j);
    expect(dem(than, new RegExp(`checkPermission\\(\\s*"${KHOA_SUA_NGUON}"\\s*\\)`, "g"))).toBe(1);
  });
});

describe("[CTN-W12] liên kết «Nâng trần» của mục Chính sách gác theo quyền sửa ô trần (W4)", () => {
  const page = doc(PAGE);
  const muc = doc(`${DIR_MUC}/muc-chinh-sach.tsx`);
  it("trang hỏi quyền bằng `docCoQuyenSuaTran()` đúng 1 lần (trong Promise.all) và truyền xuống bằng `coQuyenSuaTran={coQuyenSuaTran}` đúng 1 lần", () => {
    expect(dem(page, /\bdocCoQuyenSuaTran\(\)/g)).toBe(1);
    expect(dem(page, /\bcoQuyenSuaTran=\{coQuyenSuaTran\}/g)).toBe(1);
  });
  it("mục Chính sách quyết lối ra bằng `quyetDinhLoiRaTran(` (1 lần), vẽ <Link> nâng trần từ `loiRa.lienKet`, KHÔNG từ `h.duongDan`; prop quyền BẮT BUỘC (không mặc định, không tuỳ chọn)", () => {
    expect(dem(muc, /\bquyetDinhLoiRaTran\(/g)).toBe(1);
    expect(dem(muc, /\bloiRa\.lienKet\b/g)).toBeGreaterThanOrEqual(2);
    expect(dem(muc, /\bh\.duongDan\b/g)).toBe(1); // chỉ là đầu vào của quyetDinhLoiRaTran
    expect(dem(muc, /href=\{h\./g)).toBe(0);
    expect(dem(muc, /\bcoQuyenSuaTran\s*=\s*(?:true|false)\b/g)).toBe(0);
    expect(dem(muc, /\bcoQuyenSuaTran\?\s*:/g)).toBe(0);
  });
});
