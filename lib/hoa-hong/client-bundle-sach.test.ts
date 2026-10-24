// [CBS-*] BUNDLE TRÌNH DUYỆT SẠCH — không `"use client"` nào của khu Nguồn & Hoa hồng / Cấu hình vận hành / nhập khách được với tới `lib/db.ts`.
//
// Sinh ra từ UAT thật (lane E2, 20/10/2026): trang «Chuyển sang hoa hồng mới» (`chuyen-hoa-hong-man.tsx`, client) vỡ bằng «PrismaClient is unable to run in this browser environment» vì
// `ky-man-hinh.ts` (thuần, import ở client) kéo `hang-cho.ts` chỉ để lấy MỘT hàm thuần (`hangChoChanKy`) — mà `hang-cho.ts` import `writeAudit` → `lib/db`. Không lỗi biên dịch, không ca unit nào
// đỏ (chúng chạy ở Node, nơi `lib/db` sống được), và trang bị vỡ là trang ĐẶT MỐC CUTOVER. Chỉ trình duyệt thật mới thấy.
//
// Cách đo: từ mỗi tệp có chỉ thị `"use client"` đi theo mọi import GIÁ TRỊ (bỏ `import type` và nhóm toàn `type`) qua alias `@/` + đường dẫn tương đối; chạm `lib/db.ts` (hoặc `server-only`) là đỏ,
// in cả CHUỖI import để người sửa biết cắt ở đâu. Không đo `import()` động (chỉ nạp khi chạy, không vào bundle đầu).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GOC = process.cwd();
const KHU_VUC = ["app/(admin)/admin/nguon-hoa-hong", "app/(admin)/admin/cau-hinh-van-hanh", "components/admin/nguon-hoa-hong", "components/lead-intake"];
const DICH_CAM = ["lib/db.ts", "server-only"];
const DUOI = [".ts", ".tsx", "/index.ts", "/index.tsx"];

function duyet(thuMuc: string, ra: string[] = []): string[] {
  const tuyetDoi = join(GOC, thuMuc);
  if (!existsSync(tuyetDoi)) return ra;
  for (const ten of readdirSync(tuyetDoi)) {
    const rel = `${thuMuc}/${ten}`;
    const st = statSync(join(GOC, rel));
    if (st.isDirectory()) duyet(rel, ra);
    else if (/\.(ts|tsx)$/.test(ten) && !/\.test\.(ts|tsx)$/.test(ten)) ra.push(rel);
  }
  return ra;
}

const docTep = (rel: string): string => readFileSync(join(GOC, rel), "utf8");
const laServer = (nguon: string): boolean => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(nguon);
const laClient = (nguon: string): boolean => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(nguon);

/** Các đích import GIÁ TRỊ của một tệp (đã bỏ `import type` và nhóm chỉ gồm specifier `type`). */
function importGiaTri(nguon: string): string[] {
  const ra: string[] = [];
  for (const m of nguon.matchAll(/(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g)) {
    if (m[2]) continue; // import type / export type
    const phan = m[3]!.trim();
    const trongNgoac = /^\{([\s\S]*)\}$/.exec(phan);
    if (trongNgoac && trongNgoac[1]!.split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    ra.push(m[4]!);
  }
  for (const m of nguon.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) ra.push(m[1]!);
  return ra;
}

function giai(tu: string, dich: string): string | null {
  let co: string | null = null;
  if (dich.startsWith("@/")) co = dich.slice(2);
  else if (dich.startsWith(".")) co = relative(GOC, resolve(dirname(join(GOC, tu)), dich)).replace(/\\/g, "/");
  if (co === null) return DICH_CAM.includes(dich) ? dich : null; // gói ngoài: chỉ `server-only` đáng kể
  if (DICH_CAM.includes(`${co}.ts`) || DICH_CAM.includes(co)) return "lib/db.ts";
  for (const d of ["", ...DUOI]) {
    const ung = `${co}${d}`;
    if (/\.(ts|tsx)$/.test(ung) && existsSync(join(GOC, ung)) && statSync(join(GOC, ung)).isFile()) return ung;
  }
  return null;
}

/** Chuỗi import từ `goc` tới tệp cấm đầu tiên, hoặc null. */
function duongToiDich(goc: string): string[] | null {
  const daDen = new Set<string>([goc]);
  const hang: string[][] = [[goc]];
  while (hang.length > 0) {
    const chuoi = hang.shift()!;
    const hienTai = chuoi[chuoi.length - 1]!;
    if (DICH_CAM.includes(hienTai)) return chuoi;
    if (!existsSync(join(GOC, hienTai))) continue;
    const nguon = docTep(hienTai);
    // `"use server"`: Next thay cả tệp bằng cuống RPC khi client import — phần thân (và `lib/db` bên trong) KHÔNG vào bundle trình duyệt.
    if (laServer(nguon)) continue;
    for (const d of importGiaTri(nguon)) {
      const g = giai(hienTai, d);
      if (g === null || daDen.has(g)) continue;
      daDen.add(g);
      hang.push([...chuoi, g]);
    }
  }
  return null;
}

describe("[CBS] bundle trình duyệt của khu Nguồn & Hoa hồng không với tới lib/db", () => {
  const tep = KHU_VUC.flatMap((k) => duyet(k));
  const client = tep.filter((t) => laClient(docTep(t)));

  it("[CBS-01] đối chứng: đọc thấy ≥ 30 tệp client trong các khu vực đo (bộ đọc không rỗng)", () => {
    expect(client.length).toBeGreaterThanOrEqual(30);
  });

  it("[CBS-02] bộ đo THẤY một đường tới lib/db khi có (đối chứng dương, không cần cấy mã thật): chuỗi dựng tay", () => {
    expect(importGiaTri(`import { a } from "@/lib/db";`)).toEqual(["@/lib/db"]);
    expect(importGiaTri(`import type { a } from "@/lib/db";`)).toEqual([]);
    expect(importGiaTri(`import { type A, type B } from "@/lib/db";`)).toEqual([]);
    expect(importGiaTri(`import { type A, b } from "@/lib/db";`)).toEqual(["@/lib/db"]);
    expect(giai("components/admin/x.tsx", "@/lib/db")).toBe("lib/db.ts");
    // `hang-cho.ts` → `writeAudit` → `lib/db`: nếu đường THẬT này còn chạm được từ một client thì bộ đo phải thấy.
    expect(duongToiDich("lib/hoa-hong/hang-cho.ts")).not.toBeNull();
  });

  it("[CBS-03] KHÔNG tệp client nào của khu vực chạm được lib/db.ts hay server-only", () => {
    const hong: string[] = [];
    for (const t of client) {
      const d = duongToiDich(t);
      if (d) hong.push(d.join("\n    → "));
    }
    expect(hong, `Tệp client kéo lib/db vào bundle trình duyệt (cắt ở mắt xích GIỮA — thường là một import giá trị chỉ để lấy hằng/hàm thuần):\n${hong.join("\n\n")}`).toEqual([]);
  });

  it("[CBS-04] ky-man-hinh.ts (thuần, client đọc) KHÔNG còn import './hang-cho' giá trị", () => {
    expect(duongToiDich("lib/hoa-hong/ky-man-hinh.ts")).toBeNull();
  });
});
