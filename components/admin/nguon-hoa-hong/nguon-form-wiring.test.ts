// @vitest-environment node
/**
 * [NGF-W*] — LƯỚI GHIM MÃ NGUỒN của giao diện GHI danh mục nguồn (danh sách · biểu mẫu Tạo/Sửa · hộp thoại trạng thái).
 *
 * Hành vi đã có ca RTL (`nguon-form.test.tsx`, `nguon-danh-muc-ui.test.tsx`) và ca Postgres (`[FUI-DB-04/05]`). Lưới này canh thứ chúng KHÔNG thấy: DÂY NỐI.
 *   · một nút ghi gọi nhầm action (hoặc không gọi gì) — test RTL tiêm hàm giả nên không bắt được;
 *   · khoá quyền mà giao diện dùng để VẼ nút lệch khoá mà action kiểm ở đầu hàm (luật 12): vẽ bằng khoá A, action gác khoá B ⇒ nút bấm được mà máy chủ từ chối;
 *   · luật chép tay vào giao diện (biểu thức mã, ngưỡng lý do, danh sách mã nguồn) — luật phải ở MỘT chỗ;
 *   · nút xoá.
 *
 *   [NGF-W1] tự-kiểm: đã đọc đủ các tệp
 *   [NGF-W2] ba action ghi gác CÙNG MỘT khoá `sources:manage`; các trang vẽ nút / form hỏi CHÍNH khoá ấy + cờ module
 *   [NGF-W3] mỗi nút ghi gọi ĐÚNG action của nó, đúng một lần
 *   [NGF-W4] nút ghi của bảng chỉ nằm trong nhánh `coTheGhi`
 *   [NGF-W5] giao diện không chép luật: không biểu thức mã, không ngưỡng lý do, không mã nguồn gõ cứng; danh sách lựa chọn lấy từ schema
 *   [NGF-W6] không có đường xoá
 *   [NGF-W7] trang danh sách đẩy bộ lọc nhóm xuống truy vấn và `coTheGhi` xuống bảng
 *   [NGF-W8] hai component CLIENT (biểu mẫu · hộp thoại) KHÔNG kéo mã máy chủ vào gói trình duyệt: đồ thị import giá trị không chạm db / db-scope / next/headers / server-only
 *
 * Quy tắc viết lưới (luật 11/14): neo vào LỜI GỌI, bỏ chú thích trước khi so, đếm số lần khớp, không cờ `/s`. Đã CẤY lỗi (xem báo cáo): đổi khoá, gỡ lời gọi action, đưa nút ra ngoài nhánh quyền,
 * chép biểu thức mã, gõ cứng danh sách nhóm, thêm nút xoá.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const boChuThich = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
// Chuẩn hoá CRLF → LF: tệp có thể nằm trên đĩa dưới dạng CRLF (Windows, autocrlf) hay LF (CI) — lưới không được phụ thuộc điều đó.
const doc = (t: string) => boChuThich(readFileSync(resolve(process.cwd(), t), "utf8").split("\r\n").join("\n"));
const dem = (s: string, m: string | RegExp) =>
  typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length;

const ACTIONS = "app/(admin)/admin/nguon-hoa-hong/nguon/_actions.ts";
const PAGE_DS = "app/(admin)/admin/nguon-hoa-hong/nguon/page.tsx";
const PAGE_TAO = "app/(admin)/admin/nguon-hoa-hong/nguon/tao/page.tsx";
const PAGE_SUA = "app/(admin)/admin/nguon-hoa-hong/nguon/[maNguon]/sua/page.tsx";
const BANG = "app/(admin)/admin/nguon-hoa-hong/nguon/_components/bang-nguon.tsx";
const FORM = "components/admin/nguon-hoa-hong/nguon-form.tsx";
const HOP_THOAI = "components/admin/nguon-hoa-hong/doi-trang-thai-nguon.tsx";
const NHAN = "components/admin/nguon-hoa-hong/nhan-danh-muc.ts";
const GIAO_DIEN = [BANG, FORM, HOP_THOAI, NHAN] as const;

const KHOA_GHI = "sources:manage";

/** Thân `export async function <ten>(…) { … }` — đếm ngoặc. */
function thanHam(src: string, ten: string): string {
  const bat = src.indexOf(`export async function ${ten}(`);
  expect(bat, ten).toBeGreaterThanOrEqual(0);
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
  throw new Error(`không đóng được thân ${ten}`);
}

describe("[NGF-W] dây nối giao diện ghi danh mục nguồn", () => {
  const t = Object.fromEntries([ACTIONS, PAGE_DS, PAGE_TAO, PAGE_SUA, BANG, FORM, HOP_THOAI, NHAN].map((f) => [f, doc(f)]));

  it("[NGF-W1] tự-kiểm: mọi tệp đọc được và không rỗng", () => {
    for (const [f, s] of Object.entries(t)) expect(s.length, f).toBeGreaterThan(200);
  });

  it("[NGF-W2] ba action ghi gác CHÍNH MỘT khoá; ba trang vẽ nút / biểu mẫu hỏi đúng khoá ấy ∧ cờ module", () => {
    const khoaCuaAction = (ten: string) => [...thanHam(t[ACTIONS]!, ten).matchAll(/checkPermission\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
    for (const ten of ["taoNguonAction", "suaNguonAction", "doiTrangThaiNguonAction"]) {
      expect(khoaCuaAction(ten), ten).toEqual([KHOA_GHI]);
    }
    // danh sách: quyền ghi = khoá ∧ cờ module (hai điều kiện mà action kiểm ở đầu hàm)
    expect(dem(t[PAGE_DS]!, new RegExp(`const coTheSua = scope\\.has\\("${KHOA_GHI}"\\);`))).toBe(2); // chế độ Page mapping + chế độ danh mục: cùng một khoá với action
    expect(dem(t[PAGE_DS]!, /const coTheGhi = coTheSua && nguonBat;/)).toBe(1);
    expect(dem(t[PAGE_DS]!, /laQuanLyNguonBat\(\)/)).toBe(1);
    // biểu mẫu tạo / sửa: người thiếu khoá thấy NoPermission nêu CHÍNH khoá. Cờ nguồn tắt ⇒ vaoTab("nguon") 404 (cùng cờ) nên trang KHÔNG còn nhánh «chưa được bật» (W4, [W4-L3])
    for (const f of [PAGE_TAO, PAGE_SUA]) {
      expect(dem(t[f]!, new RegExp(`!scope\\.has\\("${KHOA_GHI}"\\)`)), f).toBe(1);
      expect(dem(t[f]!, new RegExp(`permission="${KHOA_GHI}"`)), f).toBe(1);
      expect(dem(t[f]!, /\blaQuanLyNguonBat\b/), f).toBe(0);
      expect(dem(t[f]!, /\bvaoTab\("nguon"\)/), f).toBe(1);
    }
    // đọc dữ liệu biểu mẫu qua hàm TỰ GÁC (không đọc thẳng bảng ở trang)
    expect(dem(t[PAGE_TAO]!, /docFormTaoNguon\(actor\)/)).toBe(1);
    expect(dem(t[PAGE_SUA]!, /docFormSuaNguon\(actor, ma\)/)).toBe(1);
    // phụ đề liệt kê ô sửa được phải đi qua `phuDeTrangSua` (cùng cổng khoá với ô `disabled`), không gõ cứng — UNKNOWN từng bị nói sai (Q2)
    expect(dem(t[PAGE_SUA]!, /\bphuDeTrangSua\(/)).toBe(1);
    expect(dem(t[PAGE_SUA]!, /chỉ sửa được/)).toBe(0);
    expect(dem(t[PAGE_TAO]! + t[PAGE_SUA]! + t[PAGE_DS]!, /\bleadSourceGroup\b/)).toBe(0);
  });

  it("[NGF-W3] mỗi nút ghi gọi ĐÚNG action của nó, đúng một lần, import từ đúng tệp", () => {
    const NGUON_ACTIONS = '@/app/(admin)/admin/nguon-hoa-hong/nguon/_actions';
    expect(dem(t[FORM]!, `from "${NGUON_ACTIONS}"`)).toBe(1);
    expect(dem(t[FORM]!, /\btaoNguonAction\(/)).toBe(1);
    expect(dem(t[FORM]!, /\bsuaNguonAction\(/)).toBe(1);
    expect(dem(t[FORM]!, /\bdoiTrangThaiNguonAction\b/)).toBe(0);
    expect(dem(t[HOP_THOAI]!, `from "${NGUON_ACTIONS}"`)).toBe(1);
    expect(dem(t[HOP_THOAI]!, /\bdoiTrangThaiNguonAction\(/)).toBe(1);
    expect(dem(t[HOP_THOAI]!, /\b(taoNguonAction|suaNguonAction)\b/)).toBe(0);
    // bảng KHÔNG tự gọi action nào: nó chỉ vẽ nút (nút tự mang action của mình)
    expect(dem(t[BANG]!, /\b(taoNguonAction|suaNguonAction|doiTrangThaiNguonAction)\b/)).toBe(0);
    expect(dem(t[BANG]!, /<NutDoiTrangThai\b/)).toBe(1);
    // đường dẫn «Sửa» và «Tạo» khớp trang có thật
    // «Sửa» đi qua MỘT hàm dựng đường dẫn (`hrefSuaNguon`) dùng chung với trang chi tiết — hai bên từng tự gõ hai URL khác nhau và một bên chết (09/10); bảng KHÔNG được gõ lại URL.
    expect(dem(t[BANG]!, /\bhrefSuaNguon\(g\.code\)/)).toBe(1);
    expect(dem(t[BANG]!, /\/nguon\/\$\{[^}]*\}\/sua/)).toBe(0);
    expect(dem(t[PAGE_DS]!, /href="\/nguon-hoa-hong\/nguon\/tao"/)).toBe(2); // nút ở đầu trang + nút trong trạng thái rỗng
  });

  it("[NGF-W4] bảng: nút «Sửa» và nút trạng thái CHỈ nằm trong nhánh `coTheGhi ? (…)`", () => {
    const b = t[BANG]!;
    const dau = b.indexOf("{coTheGhi ? (\n                    <td");
    const ngoai = b.indexOf(") : (\n                    <td className={cn(TD, \"w-10");
    expect(dau, "nhánh coTheGhi (ô Thao tác)").toBeGreaterThan(0);
    expect(ngoai, "nhánh còn lại (chevron)").toBeGreaterThan(dau);
    const trong = b.slice(dau, ngoai);
    expect(dem(trong, /<NutDoiTrangThai\b/)).toBe(1);
    expect(dem(trong, /\bhrefSuaNguon\(/)).toBe(1);
    expect(dem(b.slice(0, dau) + b.slice(ngoai), /\bhrefSuaNguon\(|<NutDoiTrangThai\b/)).toBe(0);
    // tiêu đề cột «Thao tác» cũng đi theo cùng cờ
    expect(dem(b, /\{coTheGhi \? \(\s*<th/)).toBe(1);
    expect(dem(b, /coTheGhi: boolean/)).toBe(1); // bắt buộc, không mặc định (luật 7)
    expect(dem(b, /coTheGhi\s*=/)).toBe(0);
  });

  it("[NGF-W5] giao diện không chép luật: không biểu thức mã · không ngưỡng lý do · không mã nguồn gõ cứng; lựa chọn lấy từ schema", () => {
    for (const f of GIAO_DIEN) {
      const s = t[f]!;
      expect(dem(s, /A-Z0-9_/), `${f}: biểu thức mã chép tay`).toBe(0);
      expect(dem(s, /\.length\s*[<>]=?\s*10\b/), `${f}: ngưỡng lý do chép tay`).toBe(0);
      expect(dem(s, /"(PAID_ADS|PARENT_REFERRAL|CENTER_ORGANIC|WALK_IN|EMPLOYEE_REFERRAL|UNKNOWN)"/), `${f}: mã nguồn gõ cứng`).toBe(0);
    }
    // nhóm nguồn / cách xác định lấy từ mảng của schema
    expect(dem(t[NHAN]!, /LOAI_NGUON_CHON\.map\(/)).toBe(1);
    expect(dem(t[NHAN]!, /from "@\/lib\/nguon\/danh-muc-ghi-dau-vao"/)).toBe(1);
    expect(dem(t[FORM]!, /LOAI_NGUON_O_CHON\.map\(/)).toBe(1);
    expect(dem(t[FORM]!, /THU_TU_YEU_CAU_NGUOI\.map\(/)).toBe(1);
    // kiểm tra đi qua hàm THUẦN của lib, không if/else tại chỗ
    expect(dem(t[FORM]!, /\bphanTichSua\(/)).toBeGreaterThanOrEqual(2); // resolver + phân tích sống
    expect(dem(t[FORM]!, /\bkiemFormTao\(/)).toBe(1);
    expect(dem(t[FORM]!, /\btruongBiKhoa\(/)).toBe(1);
    expect(dem(t[HOP_THOAI]!, /\bkiemDoiTrangThai\(/)).toBe(1);
    expect(dem(t[HOP_THOAI]!, /\bthaoTacTrangThai\(/)).toBe(1);
  });

  it("[NGF-W6] KHÔNG có đường xoá: không action, không nút, không lời gọi xoá trong giao diện danh mục", () => {
    for (const f of [...GIAO_DIEN, PAGE_DS, PAGE_TAO, PAGE_SUA]) {
      expect(dem(t[f]!, /\b(xoaNguon|deleteNguon|removeNguon|leadSourceGroup\.delete)\b|>\s*Xo[áa]\s*<|Xo[áa] nguồn/i), f).toBe(0);
    }
    expect(dem(t[ACTIONS]!, /export async function (xoa|delete|remove)/i)).toBe(0);
  });

  it("[NGF-W7] trang danh sách: bộ lọc nhóm xuống truy vấn; `coTheGhi` + mã đích mặc định xuống bảng; nhóm lấy từ `LOAI_NGUON_BO_LOC` (không gõ tay)", () => {
    const p = t[PAGE_DS]!;
    expect(dem(p, /docDanhMucNguon\(actor, \{ now, trangThai, loai, coSoId \}\)/)).toBe(1);
    expect(dem(p, /<BangNguon\b[^>]*\bcoTheGhi=\{coTheGhi\}[^>]*\bdichMacDinh=\{dichMacDinh\}/)).toBe(1);
    expect(dem(p, /LOAI_NGUON_BO_LOC\.find\(/)).toBe(1);
    expect(dem(p, /LOAI_NGUON_BO_LOC\.map\(/)).toBe(1);
    expect(dem(p, /docMaDichMacDinh\(\)/)).toBe(1);
  });

  /**
   * [NGF-W8] Sự cố thật khi dựng (09/10/2026): hộp thoại đổi trạng thái (client) import `nguon-status-pill.tsx` — tệp ấy kéo `doc-hang-cho` → `db-scope` → `lib/audit/headers.ts` → `next/headers`.
   * Test RTL (vitest) KHÔNG bắt được (jsdom nạp mọi thứ), `tsc` KHÔNG bắt được; chỉ webpack báo "You're importing a component that needs next/headers" khi biên dịch trang. Lưới này duyệt đồ thị
   * import GIÁ TRỊ (bỏ `import type`) từ hai component client và đòi nó không chạm mã chỉ-máy-chủ. Module `"use server"` là ranh giới hợp lệ (client gọi action qua đó) nên không đi sâu vào.
   */
  describe("[NGF-W8] đồ thị import của component client sạch mã máy chủ", () => {
    const CAM = /(?:from|import)\s*\(?\s*["'](?:@\/lib\/db|@\/lib\/db-scope|next\/headers|server-only|@\/lib\/audit\/[^"']*|@\/lib\/auth\/actor|@\/lib\/auth\/check-permission)["']/;
    const ketQuaImport = (src: string): string[] => {
      const ra: string[] = [];
      for (const m of src.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm)) {
        if (m[1]) continue; // `import type` / `export type … from`
        ra.push(m[2]!);
      }
      return ra;
    };
    const giai = (tu: string, spec: string): string | null => {
      let goc: string;
      if (spec.startsWith("@/")) goc = spec.slice(2);
      else if (spec.startsWith(".")) goc = resolve(process.cwd(), tu, "..", spec).slice(process.cwd().length + 1).split("\\").join("/");
      else return null;
      for (const hau of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const duong = resolve(process.cwd(), goc + hau);
        if (existsSync(duong) && statSync(duong).isFile()) return goc + hau;
      }
      return null;
    };
    /** Dừng ở vi phạm ĐẦU TIÊN khi `dungSom` (bộ tự-kiểm không cần quét cả đồ thị máy chủ). */
    function duyet(batDau: string, dungSom = false): { thay: string[]; vuiPham: string[] } {
      const thay = new Set<string>();
      const vuiPham: string[] = [];
      const hang = [batDau];
      while (hang.length > 0) {
        const f = hang.pop()!;
        if (thay.has(f)) continue;
        thay.add(f);
        const tho = readFileSync(resolve(process.cwd(), f), "utf8").split("\r\n").join("\n");
        if (/^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(tho)) continue; // ranh giới Server Action
        const s = boChuThich(tho);
        if (CAM.test(s)) {
          vuiPham.push(f);
          if (dungSom) break;
        }
        for (const spec of ketQuaImport(s)) {
          const toi = giai(f, spec);
          if (toi) hang.push(toi);
        }
      }
      return { thay: [...thay], vuiPham };
    }

    for (const goc of [FORM, HOP_THOAI]) {
      it(`${goc}`, () => {
        const { thay, vuiPham } = duyet(goc);
        // tự-kiểm: thật sự đã đi qua chuỗi phụ thuộc (không phải quét rỗng)
        expect(thay.length, "đồ thị quá nhỏ — bộ duyệt hỏng").toBeGreaterThan(5);
        expect(thay).toContain("lib/nguon/danh-muc-ghi-dau-vao.ts");
        expect(thay).toContain("lib/nguon/form-nguon.ts");
        expect(vuiPham, `kéo mã máy chủ vào client: ${vuiPham.join(", ")}`).toEqual([]);
      });
    }

    it("tự-kiểm bộ duyệt: nó BẮT đúng sự cố cũ (nguon-status-pill kéo doc-hang-cho → db-scope)", () => {
      const { vuiPham } = duyet("components/admin/nguon-hoa-hong/nguon-status-pill.tsx", true);
      expect(vuiPham.length).toBeGreaterThan(0);
    });
  });
});
