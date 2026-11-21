// @vitest-environment node
/**
 * LƯỚI GHIM MÃ NGUỒN của HÀNH ĐỘNG ĐẶT MỐC CUTOVER (hướng D) và của SO BÓNG (hướng H). Ca hành vi ở `tests/hoa-hong/cutover-hanh-dong.spec.ts` ([CUT-*]) và
 * `tests/hoa-hong/so-bong.spec.ts` ([SBG-*]); lưới này canh những thứ test hành vi KHÔNG chạm tới:
 *
 *   [CUT-W1]  Server Action: `auth()` → `assertPermission(<khoá>)` ĐỨNG ĐẦU hàm, trước zod / resolveActor / mọi lời gọi; hai khoá — xem trước `settings:view`, xác nhận
 *             `settings:edit` — và trang vẽ nút bằng ĐÚNG hai khoá đó (luật 12). Không khoá thứ ba.
 *   [CUT-W2]  component KHÔNG import `cutover.ts` · không gọi `saveGlobalSettingAction` · không nhắc khoá `hoaHong.kyCutover`: client không có đường ghi mốc nào ngoài action
 *   [CUT-W3]  đúng MỘT lời gọi `quyetDinhDatMoc` (trong `danhGiaDatMoc`) dùng chung bởi xem trước và `datMocCutover`; hai chỗ gọi `danhGiaDatMoc`, KHÔNG chỗ nào gọi thẳng
 *   [CUT-W4]  bốn trường bằng chứng và ba tham số compare-and-set là BẮT BUỘC (không `?`, không mặc định)
 *   [CUT-W5]  bằng chứng nạp NGOÀI khoá: `napGoiBangChung(` đứng TRƯỚC `client.$transaction(` trong `datMocCutover`, và bản thân nó không mở transaction / khoá
 *   [CUT-W6]  trang + action + component không import `@/lib/db` trần (cổng DB đã đóng)
 *   [SBG-W2]  CHỈ ĐỌC: không lệnh ghi nào trong `so-bong*.ts`, `cutover-kiem-tra*.ts`, `cutover-hanh-dong.ts` (ngoài lời gọi `datMocCutover`)
 *   [SBG-W3]  so bóng dùng mốc GIẢ `KY_SOM_NHAT` cho `lapThu` (mốc = P sẽ ra BO_QUA mọi khoản) và lấy bộ chính sách hiệu lực tại ĐẦU kỳ P
 *   [SBG-W4]  không đọc đồng hồ thật (luật 19): `now` là tham số bắt buộc, không `new Date()` / `Date.now()`
 *
 * Quy tắc viết lưới (CLAUDE.md luật 11/14): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số lần khớp, không cờ `/s`; mỗi lưới có phép tự-kiểm «đã tìm thấy hàm».
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const doc = (p: string): string => boChuThich(readFileSync(resolve(process.cwd(), p), "utf8"));
const dem = (s: string, m: RegExp): number => (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;

function thanHam(code: string, ten: string): string {
  const re = new RegExp(`^(?:export )?(?:async )?function ${ten}\\b`, "m");
  const m = re.exec(code);
  if (!m) throw new Error(`Không tìm thấy hàm ${ten}`);
  const tu = m.index;
  const sau = code.slice(tu + m[0].length);
  const ke = /^(?:export )?(?:async )?function \w+|^export (?:const|type|class|interface) /m.exec(sau);
  return code.slice(tu, ke ? tu + m[0].length + ke.index : undefined);
}

const ACTIONS = "app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/_actions.ts";
const PAGE = "app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/page.tsx";
const MAN = "app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/_components/chuyen-hoa-hong-man.tsx";
const THE = "app/(admin)/admin/cau-hinh-van-hanh/_components/the-chuyen-hoa-hong.tsx";

describe("[CUT-W1] quyền ở Server Action: đứng ĐẦU hàm, đúng khoá mà nút vẽ", () => {
  const a = doc(ACTIONS);

  it("[CUT-W1] xem trước: `await auth()` rồi `assertPermission(\"settings:view\")` TRƯỚC zod / điều phối; xác nhận: `settings:edit` TRƯỚC zod / resolveActor / điều phối", () => {
    for (const [ham, khoa, sau] of [
      ["xemTruocCutoverAction", "settings:view", ["safeParse(", "xemTruocCutover("]],
      ["xacNhanCutoverAction", "settings:edit", ["safeParse(", "resolveActor(", "xacNhanCutover("]],
    ] as const) {
      const than = thanHam(a, ham);
      expect(dem(than, /\bawait auth\(\)/), `${ham}: auth()`).toBe(1);
      expect(dem(than, /\bassertPermission\(/), `${ham}: số lời gọi assertPermission`).toBe(1);
      expect(than, `${ham}: khoá`).toContain(`assertPermission("${khoa}")`);
      const iQuyen = than.indexOf("assertPermission(");
      expect(than.indexOf("await auth()"), `${ham}: auth trước quyền`).toBeLessThan(iQuyen);
      for (const s of sau) expect(iQuyen, `${ham}: quyền phải đứng trước ${s}`).toBeLessThan(than.indexOf(s));
    }
  });

  it("[CUT-W1] chỉ HAI khoá trong tệp action; trang vẽ quyền ghi bằng `checkPermission(\"settings:edit\")` (cùng khoá action) và quyền vào bằng PAGE_GATES — không khoá thứ ba", () => {
    const khoa = new Set([...a.matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1]));
    expect([...khoa].sort()).toEqual(["settings:edit", "settings:view"]);
    const p = doc(PAGE);
    expect(dem(p, /checkPermission\("settings:edit"\)/)).toBe(1);
    expect(dem(p, /PAGE_GATES\["\/cau-hinh-van-hanh\/chuyen-hoa-hong"\]/)).toBe(1);
    expect(p).not.toMatch(/checkPermission\("(?!settings:edit)/);
  });

  it("[CUT-W1] nút ghi chỉ vẽ khi `suaDuoc` (prop từ settings:edit): hộp «Xác nhận» rẽ nhánh ĐÚNG MỘT chỗ theo `p.suaDuoc`; lối vào từ tab Hoa hồng gác bằng cùng PAGE_GATES", () => {
    const m = doc(MAN);
    expect(dem(m, /\{p\.suaDuoc \? \(/)).toBe(1);
    expect(dem(m, /xacNhanCutoverAction\(/)).toBe(1);
    const tab = doc("app/(admin)/admin/cau-hinh-van-hanh/page.tsx");
    expect(dem(tab, /checkAnyPermission\(PAGE_GATES\["\/cau-hinh-van-hanh\/chuyen-hoa-hong"\]\)/)).toBe(1);
    expect(dem(tab, /<TheChuyenHoaHong /)).toBe(1);
  });
});

describe("[CUT-W2] client KHÔNG có đường ghi mốc nào ngoài Server Action", () => {
  it("[CUT-W2] component + thẻ không import `cutover` (value), không `saveGlobalSettingAction`, không nhắc khoá mốc", () => {
    for (const f of [MAN, THE]) {
      const t = doc(f);
      expect(t, f).not.toMatch(/from "@\/lib\/hoa-hong\/cutover"/);
      expect(t, f).not.toMatch(/saveGlobalSettingAction|saveCenterSettingAction/);
      expect(t, f).not.toMatch(/hoaHong\.kyCutover|KHOA_KY_CUTOVER/);
    }
    // import `cutover-hanh-dong` của component phải là `import type` (kiểu thôi) — nó kéo `@/lib/db`
    expect(doc(MAN)).toMatch(/import type \{[^}]*\} from "@\/lib\/hoa-hong\/cutover-hanh-dong"/);
    expect(dem(doc(MAN), /from "@\/lib\/hoa-hong\/cutover-hanh-dong"/)).toBe(1);
  });
});

describe("[CUT-W3] MỘT cổng cho xem trước và ghi", () => {
  const cut = doc("lib/hoa-hong/cutover.ts");
  it("[CUT-W3] `quyetDinhDatMoc(` được GỌI đúng một lần ở cutover.ts (trong danhGiaDatMoc); các tệp khác không gọi", () => {
    const goi = dem(cut, /\bquyetDinhDatMoc\(/) - dem(cut, /\bfunction quyetDinhDatMoc\(/);
    expect(goi).toBe(1);
    expect(dem(thanHam(cut, "danhGiaDatMoc"), /\bquyetDinhDatMoc\(/)).toBe(1);
    for (const f of ["lib/hoa-hong/cutover-hanh-dong.ts", "lib/hoa-hong/cutover-kiem-tra-db.ts", ACTIONS]) expect(doc(f), f).not.toMatch(/\bquyetDinhDatMoc\(/);
  });

  it("[CUT-W3] `danhGiaDatMoc(` được gọi ở CẢ HAI nơi: datMocCutover (trong khoá) và xemTruocCutover (không khoá) — mỗi nơi đúng một lần", () => {
    expect(dem(thanHam(cut, "datMocCutover"), /\bdanhGiaDatMoc\(/)).toBe(1);
    const ha = doc("lib/hoa-hong/cutover-hanh-dong.ts");
    expect(dem(thanHam(ha, "xemTruocCutover"), /\bdanhGiaDatMoc\(/)).toBe(1);
    expect(dem(thanHam(ha, "xemTruocCutover"), /\bnapGoiBangChung\(/)).toBe(1);
  });
});

describe("[CUT-W7] cảnh báo không chặn: MỘT hàm cho xem trước và ghi audit", () => {
  const cut = doc("lib/hoa-hong/cutover.ts");
  const ha = doc("lib/hoa-hong/cutover-hanh-dong.ts");
  it("[CUT-W7] `canhBaoChoDatMoc(` được gọi đúng một lần ở datMocCutover và đúng một lần ở xemTruocCutover; `canhBaoChinhSach(` chỉ được gọi bên trong canhBaoChoDatMoc", () => {
    expect(dem(thanHam(cut, "datMocCutover"), /\bcanhBaoChoDatMoc\(/)).toBe(1);
    expect(dem(thanHam(ha, "xemTruocCutover"), /\bcanhBaoChoDatMoc\(/)).toBe(1);
    expect(dem(cut, /\bcanhBaoChinhSach\(/) - dem(cut, /\bfunction canhBaoChinhSach\(/)).toBe(1);
    expect(dem(thanHam(cut, "canhBaoChoDatMoc"), /\bcanhBaoChinhSach\(/)).toBe(1);
    expect(ha, "xem trước không được tự tính cảnh báo bằng hàm riêng").not.toMatch(/\bcanhBaoChinhSach\(/);
  });
  it("[CUT-W7] xem trước KHÔNG hard-code `canhBao: []` (khối «Cảnh báo không chặn» của trang không được chết); xác nhận dựng câu báo bằng `thongBaoDatMoc(ketQua)`", () => {
    expect(ha).not.toMatch(/canhBao:\s*\[\]/);
    expect(dem(thanHam(ha, "xacNhanCutover"), /\bthongBaoDatMoc\(ketQua\)/)).toBe(1);
  });
});

describe("[CUT-W4] tham số bằng chứng và compare-and-set là BẮT BUỘC", () => {
  const cut = doc("lib/hoa-hong/cutover.ts");
  it("[CUT-W4] DauVaoDatMoc khai đủ bốn trường không `?`; datMocCutover nhận cuDaXem · dauVanDaXem · phuThuoc không `?`", () => {
    const khoi = cut.slice(cut.indexOf("export type DauVaoDatMoc = {"), cut.indexOf("export type QuyetDinhDatMoc"));
    for (const t of ["invalidAttribution: number | null;", "holdNghiemTrongDuKien: number | null;", "unexpectedDelta: number | null;", "diTruChuaSanSang: boolean | null;"]) {
      expect(khoi, t).toContain(t);
    }
    expect(khoi).not.toMatch(/(?:invalidAttribution|holdNghiemTrongDuKien|unexpectedDelta|diTruChuaSanSang)\?:/);
    const chuKy = cut.slice(cut.indexOf("export async function datMocCutover("), cut.indexOf("): Promise<KetQuaDatMoc>"));
    expect(chuKy).toContain("cuDaXem: string | null; dauVanDaXem: string; phuThuoc: PhuThuocDatMoc");
    expect(chuKy).not.toMatch(/(?:cuDaXem|dauVanDaXem|phuThuoc)\?:/);
  });
});

describe("[CUT-W5] bằng chứng nạp NGOÀI khoá độc quyền", () => {
  const cut = doc("lib/hoa-hong/cutover.ts");
  it("[CUT-W5] trong datMocCutover: `napGoiBangChung(` đứng TRƯỚC `client.$transaction(`; bản thân napGoiBangChung không mở transaction hay khoá", () => {
    const than = thanHam(cut, "datMocCutover");
    expect(dem(than, /\bnapGoiBangChung\(/)).toBe(1);
    expect(than.indexOf("napGoiBangChung(")).toBeLessThan(than.indexOf("client.$transaction("));
    const nap = thanHam(cut, "napGoiBangChung");
    expect(nap).not.toMatch(/\$transaction|\$executeRaw|pg_advisory/);
  });
});

describe("[CUT-W6] cổng DB đã đóng: trang · action · component không import `@/lib/db` trần", () => {
  it.each([PAGE, ACTIONS, MAN, THE, "app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/loading.tsx", "app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/error.tsx"])("[CUT-W6] %s", (f) => {
    expect(doc(f)).not.toMatch(/from "@\/lib\/db"/);
  });
});

describe("[SBG-W2] so bóng và precheck CHỈ ĐỌC", () => {
  const GHI = /\.(?:create|createMany|update|updateMany|upsert|delete|deleteMany)\(|\$executeRaw|\$transaction|writeAudit\(|publishEvent\(/;
  // `createHash(…).update(…)` là băm chuỗi, không phải lệnh ghi DB — bỏ nó khỏi phép quét (nếu không, chính dấu vân sẽ làm lưới đỏ oan).
  const docChiDoc = (f: string): string => doc(f).replace(/createHash\([^)]*\)\s*\.update\(/g, "createHash()(");
  it.each(["lib/hoa-hong/so-bong.ts", "lib/hoa-hong/so-bong-db.ts", "lib/hoa-hong/so-bong-nhan.ts", "lib/hoa-hong/cutover-kiem-tra.ts", "lib/hoa-hong/cutover-kiem-tra-db.ts"])("[SBG-W2] %s không có lệnh ghi", (f) => {
    expect(docChiDoc(f), f).not.toMatch(GHI);
  });

  it("[SBG-W2] cutover-hanh-dong.ts: lệnh ghi duy nhất là lời gọi `datMocCutover(` (một lần, trong xacNhanCutover); xem trước KHÔNG gọi nó", () => {
    const ha = docChiDoc("lib/hoa-hong/cutover-hanh-dong.ts");
    expect(ha).not.toMatch(GHI);
    expect(dem(ha, /\bdatMocCutover\(/)).toBe(1);
    expect(dem(thanHam(ha, "xacNhanCutover"), /\bdatMocCutover\(/)).toBe(1);
    expect(thanHam(ha, "xemTruocCutover")).not.toMatch(/\bdatMocCutover\(/);
  });

  it("[SBG-W2] so-bong-db chỉ import MỘT hàm của quet-khoan.ts: `lapThu` (không phải hàm ghi)", () => {
    const t = doc("lib/hoa-hong/so-bong-db.ts");
    expect(t).toMatch(/import \{ lapThu \} from "\.\/quet-khoan";/);
    expect(dem(t, /from "\.\/quet-khoan"/)).toBe(1);
  });
});

describe("[SBG-W3] so bóng: mốc giả cho lapThu, bộ chính sách tại đầu kỳ P", () => {
  const t = doc("lib/hoa-hong/so-bong-db.ts");
  it("[SBG-W3] bối cảnh dựng bằng `dungBoiCanhTuMoc(client, i.now, KY_SOM_NHAT)` và đặt `kyCutover: KY_SOM_NHAT`; không dùng kyP làm mốc", () => {
    expect(dem(t, /dungBoiCanhTuMoc\(client, i\.now, KY_SOM_NHAT\)/)).toBe(1);
    expect(dem(t, /kyCutover: KY_SOM_NHAT/)).toBe(1);
    expect(t).not.toMatch(/kyCutover:\s*i\.kyP/);
    expect(t).not.toMatch(/dungBoiCanhTuMoc\([^)]*kyP/);
  });
  it("[SBG-W3] bộ quy tắc lấy bằng `boQuyTacTaiKy(…, i.kyP)` → lọc `dangHieuLucTai(q, dau)` tại ĐẦU kỳ (khoangKy(kyP).start), rồi dời hiệu lực về đầu thời gian", () => {
    expect(dem(t, /boQuyTacTaiKy\(goc\.hoaHong\.quyTac, i\.kyP\)/)).toBe(1);
    const h = thanHam(t, "boQuyTacTaiKy");
    expect(h).toContain("khoangKy(kyP).start");
    expect(h).toContain("dangHieuLucTai(q, dau)");
    expect(dem(t, /effectiveFrom: new Date\(0\)/)).toBe(1);
  });
});

describe("[SBG-W5] thành phần khoản bị loại: quyết định ở MỘT hàm thuần, truyền đủ lý do loại", () => {
  const t = doc("lib/hoa-hong/so-bong-db.ts");
  it("[SBG-W5] `thanhPhanNgoaiPhamVi` kết thúc bằng `thanhPhanKhoanBoQua(pb, lyDoBoQua)` (không tự rẽ nhánh lại); chỗ gọi truyền `lap.lyDo`; không gọi `phanLoaiDongDon`", () => {
    expect(dem(thanHam(t, "thanhPhanNgoaiPhamVi"), /\bthanhPhanKhoanBoQua\(pb, lyDoBoQua\)/)).toBe(1);
    expect(dem(t, /\bthanhPhanNgoaiPhamVi\(client, p, lap\.lyDo\)/)).toBe(1);
    expect(thanHam(t, "thanhPhanNgoaiPhamVi")).not.toMatch(/pb\.loai\b|pb\.thanhPhan\b/);
    expect(t).not.toMatch(/\bphanLoaiDongDon\(/);
  });
});

describe("[SBG-W4] không đồng hồ thật", () => {
  it.each(["lib/hoa-hong/so-bong.ts", "lib/hoa-hong/so-bong-db.ts", "lib/hoa-hong/cutover-kiem-tra.ts", "lib/hoa-hong/cutover-kiem-tra-db.ts"])("[SBG-W4] %s", (f) => {
    expect(doc(f), f).not.toMatch(/new Date\(\)|Date\.now\(/);
  });
  it("[SBG-W4] `now`, cửa sổ, kỳ P và trần số khoản là trường BẮT BUỘC của DauVaoSoBong (không `?`)", () => {
    const t = doc("lib/hoa-hong/so-bong-db.ts");
    const khoi = t.slice(t.indexOf("export type DauVaoSoBong = {"), t.indexOf("const doiHieuLuc"));
    for (const f of ["now: Date;", "kyP: string;", "tuNgay: string;", "denNgay: string;", "tranSoKhoan: number;"]) expect(khoi, f).toContain(f);
    expect(khoi).not.toMatch(/(?:now|kyP|tuNgay|denNgay|tranSoKhoan)\?:/);
  });
});
