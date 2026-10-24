// @vitest-environment node
/**
 * [CL-*] — «QUẢN LÝ CHIA LEAD»: GHI = giữ ĐÚNG khoá TẠI cơ sở; ĐỌC/XUẤT = tầm nhìn đo bằng CHÍNH khoá gác màn; SĐT/tên PH che theo `leads:view-pii`
 * (rà độc lập 20/10/2026, M1 + L1). THUẦN, không DB — ca Postgres thật ở `tests/lead-intake/chia-lead-nguoi-kiem.spec.ts`.
 *
 * Gốc: `visibleCenterIds` GỘP tầm nhìn của mọi vai ⇒ người kiêm QLCS@CS1 + Sale@CS2 «thấy» CS2; cổng cũ `isSuperAdmin || isHoLevel || visibleCenterIds.includes(centerId)`
 * cho họ tắt nhận lead / chỉnh lượt của cơ sở CS2. Hai nơi ĐỌC còn spread `{ id: co_so }` ĐÈ danh sách cơ sở được phép.
 *
 *   [CL-01] `locCoSoTheoTamNhin`  — GIAO tầm nhìn với cơ sở yêu cầu; không bao giờ mở rộng
 *   [CL-02] `anPiiSoChia`         — che tên PH + SĐT theo hai cờ
 *   [CL-W1] khoá gác trang khớp `PAGE_GATES`
 *   [CL-W2] `gac` của Server Action hỏi `coQuyenTaiCoSo(actor, perm, centerId)`, không còn tầm nhìn
 *   [CL-W3] bốn nơi ĐỌC/XUẤT đo bằng `tamNhinCuaKhoa` + `locCoSoTheoTamNhin`, không còn `visibleCenterIds`/`isHoLevel`
 *   [CL-W4] route xuất + tab Sổ chia che PII ở SERVER
 *   [CL-W5] mọi action của màn đi qua `gac` (không action nào bỏ cổng)
 *   [CL-W6] `updateLeadNote` hỏi `leads:overwrite` TẠI cơ sở của lead
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PAGE_GATES } from "@/lib/auth/page-gates";

import { KHOA_TRANG_CHIA_LEAD, KHOA_XUAT_SO_CHIA, anPiiSoChia, locCoSoTheoTamNhin } from "./pham-vi-so-chia";

describe("[CL-01] locCoSoTheoTamNhin — GIAO, không ghi đè", () => {
  it("[CL-01a] tầm nhìn ALL: không yêu cầu ⇒ mọi cơ sở; có yêu cầu ⇒ đúng cơ sở đó", () => {
    expect(locCoSoTheoTamNhin("ALL", null)).toEqual({});
    expect(locCoSoTheoTamNhin("ALL", undefined)).toEqual({});
    expect(locCoSoTheoTamNhin("ALL", "CS2")).toEqual({ id: "CS2" });
  });

  it("[CL-01b] tầm nhìn [CS1]: không yêu cầu ⇒ {CS1}; yêu cầu CS1 ⇒ {CS1}; yêu cầu CS2 (ngoài tầm) ⇒ RỖNG, KHÔNG phải CS2", () => {
    expect(locCoSoTheoTamNhin(["CS1"], null)).toEqual({ id: { in: ["CS1"] } });
    expect(locCoSoTheoTamNhin(["CS1"], "CS1")).toEqual({ id: { in: ["CS1"] } });
    expect(locCoSoTheoTamNhin(["CS1"], "CS2")).toEqual({ id: { in: [] } }); // lỗi cũ: spread {id: co_so} ĐÈ danh sách ⇒ {id: "CS2"}
  });

  it("[CL-01c] không giữ khoá ở cơ sở nào (tầm nhìn []) ⇒ rỗng dù yêu cầu gì — fail-closed", () => {
    expect(locCoSoTheoTamNhin([], null)).toEqual({ id: { in: [] } });
    expect(locCoSoTheoTamNhin([], "CS1")).toEqual({ id: { in: [] } });
  });

  it("[CL-01d] chỉ trả MỘT khoá `id` (không để chỗ gọi spread đè lên nhau)", () => {
    expect(Object.keys(locCoSoTheoTamNhin(["CS1", "CS2"], "CS2"))).toEqual(["id"]);
    expect(locCoSoTheoTamNhin(["CS1", "CS2"], "CS2")).toEqual({ id: { in: ["CS2"] } });
  });
});

describe("[CL-02] anPiiSoChia — che ở dữ liệu, theo hai cờ", () => {
  const rows = [
    { id: "r1", parentName: "Nguyễn Thị Lan", phone: "0905123456", chiaCho: "Sale A" },
    { id: "r2", parentName: null, phone: null, chiaCho: null },
  ];

  it("[CL-02a] xemPii + xemSdt ⇒ nguyên văn (đối chứng dương)", () => {
    expect(anPiiSoChia(rows, { xemPii: true, xemSdt: true })).toEqual(rows);
  });

  it("[CL-02b] thiếu `leads:view-pii` ⇒ SĐT KHÔNG còn là số thật, tên PH bị rút gọn; cột khác giữ nguyên; null giữ null", () => {
    const [a, b] = anPiiSoChia(rows, { xemPii: false, xemSdt: false });
    expect(a.phone).not.toBe("0905123456");
    expect(a.phone).not.toContain("905123456");
    expect(a.parentName).toBe("Nguyễn T. L.");
    expect(a.chiaCho).toBe("Sale A");
    expect(b.phone).toBeNull();
    expect(b.parentName).toBeNull();
  });

  it("[CL-02c] bị DENY riêng trường `phone` (xemPii bật, xemSdt tắt) ⇒ tên giữ, SĐT che", () => {
    const [a] = anPiiSoChia(rows, { xemPii: true, xemSdt: false });
    expect(a.parentName).toBe("Nguyễn Thị Lan");
    expect(a.phone).not.toContain("905123456");
  });

  it("[CL-02d] không sửa mảng đầu vào", () => {
    const goc = JSON.stringify(rows);
    anPiiSoChia(rows, { xemPii: false, xemSdt: false });
    expect(JSON.stringify(rows)).toBe(goc);
  });
});

// ── lưới ghim dây nối (đọc mã nguồn ĐÃ BỎ CHÚ THÍCH; đếm SỐ LẦN khớp — chú thích giải thích bản vá chứa đúng chuỗi đang cấm) ──
const doc = (p: string): string =>
  readFileSync(resolve(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dem = (s: string, m: string | RegExp): number => (typeof m === "string" ? s.split(m).length - 1 : (s.match(new RegExp(m.source, m.flags.includes("g") ? m.flags : `${m.flags}g`)) ?? []).length);

const ACTIONS = "app/(admin)/admin/quan-ly-chia-lead/_actions.ts";
const PAGE = "app/(admin)/admin/quan-ly-chia-lead/page.tsx";
const LICH_SU = "app/(admin)/admin/quan-ly-chia-lead/lich-su/page.tsx";
const EXPORT = "app/api/admin/crm/so-chia-lead-export/route.ts";
const SO_CHIA = "app/(admin)/admin/quan-ly-chia-lead/_components/so-chia.tsx";
const LEADS_ACTIONS = "app/(admin)/admin/leads/actions.ts";

describe("[CL-W] dây nối", () => {
  it("[CL-W1] khoá gác trang trong thư viện KHỚP `PAGE_GATES` (đổi cổng trang mà quên phạm vi = phạm vi đo sai khoá); khoá xuất = quyền gốc của mã xuất", () => {
    expect([...KHOA_TRANG_CHIA_LEAD]).toEqual([...PAGE_GATES["/quan-ly-chia-lead"]]);
    expect(KHOA_XUAT_SO_CHIA).toBe("lead_pool:manage");
  });

  it("[CL-W2] `gac`: hỏi `coQuyenTaiCoSo(actor, perm, centerId)` đúng 1 lần; KHÔNG còn tầm nhìn (`visibleCenterIds`, `isHoLevel`, `isSuperAdmin`) làm quyền ghi", () => {
    const d = doc(ACTIONS);
    expect(dem(d, /coQuyenTaiCoSo\(actor, perm, centerId\)/)).toBe(1);
    expect(dem(d, /visibleCenterIds|isHoLevel|isSuperAdmin/)).toBe(0);
  });

  it("[CL-W3] trang · lịch sử · route xuất: `tamNhinCuaKhoa` + `locCoSoTheoTamNhin`, KHÔNG còn `visibleCenterIds` / `isHoLevel` / `nhieuCoSo` / spread `{ id: …co_so }`", () => {
    const THEO_TEP: Record<string, RegExp> = {
      [PAGE]: /tamNhinCuaKhoa\(actor, \.\.\.KHOA_TRANG_CHIA_LEAD\)/,
      [LICH_SU]: /tamNhinCuaKhoa\(actor, \.\.\.KHOA_TRANG_CHIA_LEAD\)/,
      [EXPORT]: /tamNhinCuaKhoa\(actor, KHOA_XUAT_SO_CHIA\)/,
    };
    for (const [tep, dang] of Object.entries(THEO_TEP)) {
      const d = doc(tep);
      expect(dem(d, dang), `${tep}: tamNhinCuaKhoa`).toBe(1);
      expect(dem(d, /locCoSoTheoTamNhin\(tam, /), `${tep}: locCoSoTheoTamNhin`).toBe(1);
      expect(dem(d, /visibleCenterIds|isHoLevel|nhieuCoSo/), `${tep}: tầm nhìn gộp`).toBe(0);
      expect(dem(d, /\{ id: (sp|q)\b/), `${tep}: spread đè id`).toBe(0);
    }
  });

  it("[CL-W4] route xuất + tab Sổ chia: SĐT/tên PH đi qua `anPiiSoChia` với `canViewLeadPii()` + mặt nạ trường `phone`; dữ liệu ghi ra tệp / xuống JSX là bản ĐÃ che", () => {
    for (const tep of [EXPORT, SO_CHIA]) {
      const d = doc(tep);
      expect(dem(d, /anPiiSoChia\(rows, \{ xemPii, xemSdt: xemPii && !maTranPii\.includes\("phone"\) \}\)/), `${tep}: anPiiSoChia`).toBe(1);
      expect(dem(d, /await canViewLeadPii\(\)/), `${tep}: canViewLeadPii`).toBe(1);
      expect(dem(d, /rowsHienThi\.map\(/), `${tep}: dùng bản đã che`).toBe(1);
      expect(dem(d, /\brows\.map\(/), `${tep}: không còn đọc dòng thô`).toBe(0);
    }
  });

  it("[CL-W5] mọi action xuất ra của màn đi qua `gac` (không action nào bỏ cổng)", () => {
    const d = doc(ACTIONS);
    const soAction = dem(d, /export async function \w+Action\(/);
    expect(soAction).toBe(5);
    expect(dem(d, /await gac\(input\.centerId, "(lead_pool:manage|leads:assign-config)"\)/)).toBe(soAction);
  });

  it("[CL-W6] `updateLeadNote`: `duocDe` hỏi `leads:overwrite` TẠI cơ sở của lead (không chỉ cờ toàn cục)", () => {
    const d = doc(LEADS_ACTIONS);
    const dau = d.indexOf("export async function updateLeadNote(");
    const cuoi = d.indexOf("export async function deleteLead(");
    expect(dau).toBeGreaterThan(-1);
    expect(cuoi).toBeGreaterThan(dau);
    const than = d.slice(dau, cuoi);
    expect(dem(than, /const duocDe = \(await checkPermission\('leads:overwrite'\)\) && coQuyenTaiCoSo\(actor, 'leads:overwrite', before\.centerId\)/)).toBe(1);
    expect(dem(than, /\bduocDe\b/)).toBe(2); // khai + dùng — không có nhánh thứ hai tự hỏi quyền
  });
});
