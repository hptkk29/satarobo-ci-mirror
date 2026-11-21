/**
 * [VTW-*] — LƯỚI GHIM MÃ NGUỒN cho dây nối «vượt trần chỉ đường theo quyền» + «nguồn trong trình soạn» (E2a, 09/10/2026) — phần mà test hành vi KHÔNG chạm tới vì page là Server
 * Component (kéo next-auth + Prisma, không dựng được trong vitest). Khuôn của `chinh-sach-wiring.test.ts`: đọc mã ĐÃ BỎ CHÚ THÍCH, neo hẹp, ĐẾM SỐ LẦN khớp, không cờ `/s` (luật 11).
 *
 *   [VTW-01] mỗi trang dựng HangRaoBar / TrinhSoan hỏi quyền sửa trần BẰNG `docCoQuyenSuaTran()` (đúng 1 lời gọi) và TRUYỀN nó xuống; `docCoQuyenSuaTran` hỏi ĐÚNG `QUYEN_SUA_TRAN`
 *   [VTW-02] hai trang soạn truyền `coQuyenQuanLyNguon` bằng ĐÚNG `sources:manage`, và `docDuLieuSoan` nhận `now`
 *   [VTW-03] KHÔNG có đường nào để trình soạn tự nâng trần: cụm thành phần của builder không import action/service cấu hình, không nhắc `setGlobalSetting`
 *   [VTW-04] `?nguon=`: trang tạo mới đọc qua `nguonChonSanTuMa(` (lọc UNKNOWN / nguồn không hoạt động) và chỉ lấy id từ danh sách máy chủ
 *   [VTW-05] thành phần: prop `coQuyenSuaTran` / `coQuyenQuanLyNguon` KHÔNG có giá trị mặc định (luật 7) ở mọi nơi khai
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const T = "app/(admin)/admin/nguon-hoa-hong/chinh-sach";

function boChuThich(s: string): string {
  return s
    .split(/\r?\n/)
    .map((d) => d.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
const doc = (duong: string) => boChuThich(readFileSync(resolve(GOC, duong), "utf8"));
const dem = (s: string, re: RegExp) => [...s.matchAll(re)].length;

const TRANG_QUYEN_TRAN = [`${T}/moi/page.tsx`, `${T}/[policyId]/soan/page.tsx`, `${T}/[policyId]/page.tsx`];

describe("[VTW-01] quyền sửa trần đi từ máy chủ xuống thành phần", () => {
  for (const t of TRANG_QUYEN_TRAN) {
    it(`${t}: đúng 1 lời gọi docCoQuyenSuaTran() và truyền xuống bằng coQuyenSuaTran={coQuyenSuaTran}`, () => {
      const s = doc(t);
      expect(dem(s, /\bdocCoQuyenSuaTran\(\)/g)).toBe(1);
      expect(dem(s, /\bcoQuyenSuaTran=\{coQuyenSuaTran\}/g)).toBe(1);
    });
  }

  it("docCoQuyenSuaTran hỏi ĐÚNG khoá QUYEN_SUA_TRAN (một lời gọi checkPermission), không khoá gõ tay", () => {
    const s = doc("lib/hoa-hong/quyen-sua-tran.ts");
    expect(dem(s, /\bcheckPermission\(QUYEN_SUA_TRAN\)/g)).toBe(1);
    expect(dem(s, /["']settings:/g)).toBe(0);
  });
});

describe("[VTW-02] quyền quản lý nguồn + đồng hồ cho dữ liệu soạn", () => {
  for (const t of [`${T}/moi/page.tsx`, `${T}/[policyId]/soan/page.tsx`]) {
    it(`${t}: coQuyenQuanLyNguon = scope.has("sources:manage") (1 lần); docDuLieuSoan(actor, now) (1 lần)`, () => {
      const s = doc(t);
      // W4: cờ nguồn tắt thì `/nguon-hoa-hong/nguon/<mã>` là 404 (vaoTab) — hai cờ nguồn / engine độc lập — nên «mở được cấu hình nguồn» = quyền ∧ cờ.
      expect(dem(s, /\bcoQuyenQuanLyNguon=\{scope\.has\("sources:manage"\) && scope\.co\.nguon\}/g)).toBe(1);
      expect(dem(s, /\bdocDuLieuSoan\(actor, now\)/g)).toBe(1);
    });
  }
});

describe("[VTW-03] trình soạn KHÔNG tự nâng trần", () => {
  const TEP = [
    "components/admin/nguon-hoa-hong/khoi-vuot-tran.tsx",
    "components/admin/nguon-hoa-hong/hang-rao-bar.tsx",
    `${T}/_components/trinh-soan.tsx`,
    `${T}/_components/buoc-kich-hoat.tsx`,
    `${T}/_components/cac-buoc.tsx`,
    `${T}/_components/thu-tinh-ket-qua.tsx`,
    `${T}/_components/thu-tinh-that.tsx`,
  ];
  for (const t of TEP) {
    it(`${t}: không import màn/action cấu hình, không nhắc ghi cấu hình`, () => {
      const s = doc(t);
      expect(dem(s, /cau-hinh-van-hanh\/(?:actions|_actions)/g)).toBe(0);
      expect(dem(s, /@\/lib\/settings\/(?:service|registry)/g)).toBe(0);
      expect(dem(s, /\b(?:setGlobalSetting|setSetting|saveSettingAction|setCenterSetting)\b/g)).toBe(0);
    });
  }

  it("_actions.ts của builder cũng không ghi cấu hình", () => {
    const s = doc(`${T}/_actions.ts`);
    expect(dem(s, /\b(?:setGlobalSetting|setSetting|saveSettingAction)\b/g)).toBe(0);
  });
});

describe("[VTW-04] ?nguon= chọn sẵn nguồn", () => {
  it("moi/page.tsx: đọc ?nguon= bằng motGiaTri, chọn qua nguonChonSanTuMa(…, dl.nhomNguon) (1 lần) và dùng nguonChonSan.id — không bao giờ lấy id từ URL", () => {
    const s = doc(`${T}/moi/page.tsx`);
    expect(dem(s, /\bnguonChonSanTuMa\(motGiaTri\(sp\.nguon\), dl\.nhomNguon\)/g)).toBe(1);
    expect(dem(s, /sourceGroupId:\s*nguonChonSan\.id\b/g)).toBe(1);
    expect(dem(s, /sourceGroupId:\s*sp\./g)).toBe(0);
    // phạm vi chỉ được đặt KHI có nguồn chọn sẵn (cấy `false ?` ở đây làm ?nguon= chết âm thầm mà ba dòng trên vẫn khớp)
    expect(dem(s, /\.\.\.\(nguonChonSan\s*\?\s*\{\s*phamVi:\s*\{\s*loai:\s*"SOURCE_GROUP"/g)).toBe(1);
  });
});

describe("[VTW-05] prop quyền là BẮT BUỘC, không mặc định", () => {
  const TEP = [
    "components/admin/nguon-hoa-hong/khoi-vuot-tran.tsx",
    "components/admin/nguon-hoa-hong/hang-rao-bar.tsx",
    `${T}/_components/trinh-soan.tsx`,
    `${T}/_components/buoc-kich-hoat.tsx`,
    `${T}/_components/cac-buoc.tsx`,
    `${T}/_components/kieu-soan.ts`,
    `${T}/_components/thu-tinh-ket-qua.tsx`,
    `${T}/_components/thu-tinh-that.tsx`,
  ];
  for (const t of TEP) {
    it(`${t}: không có \`coQuyenSuaTran = …\` / \`coQuyenQuanLyNguon = …\` / \`coQuyenSuaTran?:\` (mặc định hay tuỳ chọn đều là đường im lặng)`, () => {
      const s = doc(t);
      expect(dem(s, /\bcoQuyen(?:SuaTran|QuanLyNguon)\s*=\s*(?:true|false)\b/g)).toBe(0);
      expect(dem(s, /\bcoQuyen(?:SuaTran|QuanLyNguon)\?\s*:/g)).toBe(0);
    });
  }
});
