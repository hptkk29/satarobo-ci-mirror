// [NKW-*] — LƯỚI GHIM MÃ NGUỒN cho T14: mỗi phép GHI nghiệp vụ học bù có một dòng nhật ký, ghi TRONG giao dịch của chính nó, từ một DANH SÁCH ĐÓNG.
//
// Test hành vi (`tests/hoc-bu/nhat-ky.test.ts`) chứng minh vòng đời để lại đủ dấu vết. Thứ nó KHÔNG canh: một phép ghi MỚI quên nhật ký, nhật ký bị dời ra
// ngoài giao dịch (lỗi giữa chừng để lại phép ghi không dấu vết — đúng bản cũ ghi ở server action SAU khi dịch vụ commit), hay một tên hành động tự chế
// ngoài danh sách (không ai tìm thấy khi tra).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HANH_DONG, KHOA_HANH_DONG } from "@/lib/hoc-bu/nhat-ky-thuan";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const boChuThich = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((d) => !d.trim().startsWith("//"))
    .join("\n");
const ma = (p: string) => boChuThich(doc(p));
function than(src: string, ten: string): string {
  const m = new RegExp(`(?:^|\\n)(?:export )?async function ${ten}\\(`).exec(src);
  expect(m, `không thấy hàm ${ten}`).not.toBeNull();
  const dau = m!.index;
  const ke = src.slice(dau + 10).search(/\n(?:\/\*\*|export (?:async )?function|(?:async )?function|export const|const|type|interface) /);
  return src.slice(dau, ke === -1 ? undefined : dau + 10 + ke);
}
function tepTs(dir: string): string[] {
  const ra: string[] = [];
  for (const t of readdirSync(resolve(process.cwd(), dir))) {
    const d = join(dir, t);
    if (statSync(resolve(process.cwd(), d)).isDirectory()) ra.push(...tepTs(d));
    else if (/\.tsx?$/.test(t) && !/\.test\.tsx?$/.test(t)) ra.push(d.split("\\").join("/")); // Windows: `join` ra dấu \
  }
  return ra;
}

const CD = "lib/hoc-bu/case-db.ts";
const DD = "lib/hoc-bu/case-diem-danh-db.ts";
const DOI = "lib/hoc-bu/don-doi-db.ts";
const ACT = "app/(admin)/admin/hoc-bu/_actions.ts";
const SUA = "lib/hoc-bu/sua-du-lieu-db.ts";

/** hành động → [tệp, hàm chứa lời ghi]. Thêm phép ghi mới = thêm một dòng ở đây VÀ ở `HANH_DONG`. */
const BAN_DO: [khoa: string, tep: string, ham: string][] = [
  ["hoc-bu.tao-case", CD, "taoCaseVaXep"],
  ["hoc-bu.xep-vao-case", CD, "xepVaoCaseCoSan"],
  ["hoc-bu.sua-case", CD, "suaCase"],
  ["hoc-bu.huy-case", CD, "huyCase"],
  ["hoc-bu.tao-phi", CD, "taoPhiBu"],
  ["hoc-bu.mien-phi", CD, "mienPhiBu"],
  ["hoc-bu.go-mien-phi", CD, "goMienPhiBu"],
  ["hoc-bu.go-muc-khoi-case", DD, "nhaMucTrongTx"],
  ["hoc-bu.doi-trang-thai-case", DD, "chotLaiCaseTrongTx"],
  ["hoc-bu.cong-day-sau-chot-ky", DD, "chotLaiCaseTrongTx"],
  ["hoc-bu.diem-danh-be", DD, "diemDanhBe"],
  ["hoc-bu.diem-danh-ghi-de-qua-han", DD, "diemDanhBe"],
  ["hoc-bu.sua-diem-danh-be", DD, "suaDiemDanhBe"],
  ["hoc-bu.danh-gia-muc", DD, "ghiDanhGiaMuc"],
  ["hoc-bu.huy-dong", ACT, "huyBuoiCanBuAction"],
  ["hoc-bu.khoi-phuc-dong", ACT, "khoiPhucBuoiCanBuAction"],
  // Bốn hành động dây chuyền (đơn bị loại · hoàn một phần) cùng đi qua MỘT hàm `xuLyDongMatPhi`; mỗi đường truyền tên hành động của mình.
  ["hoc-bu.go-khoi-case-vi-phi-bi-loai", DOI, "xetLaiSauKhiDonBiLoai"],
  ["hoc-bu.phi-bi-loai-sau-khi-bu", DOI, "xetLaiSauKhiDonBiLoai"],
  ["hoc-bu.go-khoi-case-vi-phi-thieu", DOI, "xetLaiSauKhiHoanMotPhan"],
  ["hoc-bu.phi-thieu-sau-khi-bu", DOI, "xetLaiSauKhiHoanMotPhan"],
  ["hoc-bu.sua-du-lieu", SUA, "ghiVetSua"],
  ["hoc-bu.nang-cap-case", CD, "nangCapCaseTheoYeuCau"],
];

describe("[NKW] T14 — nhật ký học bù", { timeout: 30_000 }, () => {
  it("[NKW-01] mỗi hành động trong danh sách đóng được ghi ĐÚNG trong hàm đã khai (và ngược lại: bản đồ chỉ nhắc hành động có trong danh sách)", () => {
    const trongBanDo = new Set(BAN_DO.map(([k]) => k));
    for (const [khoa, tep, ham] of BAN_DO) {
      expect(KHOA_HANH_DONG as readonly string[], khoa).toContain(khoa);
      expect(than(ma(tep), ham), `${khoa} phải nằm trong ${ham}`).toContain(`"${khoa}"`);
    }
    // Mọi hành động của danh sách đóng đều có chỗ ghi đã khai — không hành động "mồ côi" nằm trong danh sách mà không ai ghi.
    expect(KHOA_HANH_DONG.filter((k) => !trongBanDo.has(k))).toEqual([]);
    expect(Object.keys(HANH_DONG).length).toBe(KHOA_HANH_DONG.length);
  });

  it("[NKW-02] nhật ký của dịch vụ ghi bằng `ghiNhatKy(tx, …)` — trong giao dịch; không còn `writeAudit` rải ở dịch vụ trừ ba chỗ cũ có chủ đích", () => {
    for (const [tep, ham] of [
      [CD, "taoCaseVaXep"], [CD, "xepVaoCaseCoSan"], [CD, "huyCase"], [CD, "nangCapCaseTheoYeuCau"], [CD, "taoPhiBu"], [CD, "mienPhiBu"], [CD, "goMienPhiBu"],
      [DD, "nhaMucTrongTx"], [DD, "chotLaiCaseTrongTx"], [DOI, "xuLyDongMatPhi"],
    ] as const) {
      const t = than(ma(tep), ham);
      expect(t, `${ham} phải ghi nhật ký bằng ghiNhatKy(tx,`).toContain("await ghiNhatKy(tx,");
      expect(t, `${ham} không được tự writeAudit`).not.toContain("writeAudit(");
    }
    // Ba nơi vẫn tự `writeAudit` (đã có từ trước T14, cùng giao dịch, có `tx`): sửa case · sửa điểm danh/ghi đè/đánh giá — đều truyền `tx`.
    for (const [tep, ham] of [[CD, "suaCase"], [DD, "diemDanhBe"], [DD, "suaDiemDanhBe"], [DD, "ghiDanhGiaMuc"]] as const) {
      const t = than(ma(tep), ham);
      const goi = t.match(/writeAudit\(\{[\s\S]*?\n\s*\}\);/g) ?? [];
      for (const g of goi) expect(g, `${ham}: writeAudit phải có tx`).toMatch(/\btx,?\s*\n?\s*\}\)/);
    }
  });

  it("[NKW-03] server action KHÔNG tự ghi nhật ký học bù sau khi dịch vụ commit: không còn `ghiAudit`, không còn module 'lms'; hai đường huỷ/khôi phục dòng ghi TRONG giao dịch của action", () => {
    const a = ma(ACT);
    expect(a).not.toContain("ghiAudit(");
    expect(a).not.toContain('module: "lms"');
    for (const ham of ["huyBuoiCanBuAction", "khoiPhucBuoiCanBuAction"]) {
      const t = than(a, ham);
      const iTx = t.indexOf("$transaction(");
      const iAu = t.indexOf("await writeAudit(");
      expect(iTx, `${ham} có giao dịch`).toBeGreaterThanOrEqual(0);
      expect(iAu, `${ham}: audit nằm SAU khi mở giao dịch`).toBeGreaterThan(iTx);
      expect(t.slice(iAu, iAu + 600), `${ham}: audit truyền tx`).toMatch(/\btx,\s*\n\s*\}\)/);
    }
    const gv = ma("app/(teacher)/teacher/hoc-bu/_actions.ts");
    expect(gv).not.toContain("writeAudit(");
  });

  it("[NKW-04] DANH SÁCH ĐÓNG: mọi chuỗi `\"hoc-bu.<tên>\"` trong mã nguồn đều là một hành động đã khai", () => {
    const khai = new Set<string>(KHOA_HANH_DONG);
    const dung = new Set<string>();
    const tep = [...tepTs("lib/hoc-bu"), "app/(admin)/admin/hoc-bu/_actions.ts", "app/(teacher)/teacher/hoc-bu/_actions.ts", ...tepTs("lib/_handlers")];
    for (const f of tep) {
      if (f.endsWith("nhat-ky-thuan.ts")) continue;
      for (const m of ma(f).matchAll(/"(hoc-bu\.[a-z-]+)"/g)) dung.add(m[1]!);
    }
    expect([...dung].filter((k) => !khai.has(k))).toEqual([]);
    expect(dung.size).toBeGreaterThanOrEqual(18);
  });

  it("[NKW-05] tên người làm: `ghiNhatKy` tra tên theo id TRONG giao dịch khi không truyền, và rơi về 'Hệ thống' khi không có người", () => {
    const g = ma("lib/hoc-bu/nhat-ky.ts");
    expect(g).toContain("tx.user.findUnique({ where: { id: p.actorId }");
    expect(g).toContain('"Hệ thống"');
    expect(g).toContain('module: "hoc-bu"');
    expect(g).toContain("tx,");
    // Một cửa: không nơi nào ngoài `nhat-ky.ts` tự ghi `module: "hoc-bu"` bằng `writeAudit` trừ các chỗ đã nêu ở NKW-02/03.
    const tuGhi = tepTs("lib/hoc-bu")
      .filter((f) => !f.endsWith("nhat-ky.ts"))
      .filter((f) => /module:\s*"hoc-bu"/.test(ma(f)));
    expect(tuGhi.sort()).toEqual([CD, DD].sort());
  });
});
