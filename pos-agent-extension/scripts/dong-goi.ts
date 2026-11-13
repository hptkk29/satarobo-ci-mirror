/**
 * Đóng gói "SataRobo POS Agent" để cài bằng "Load unpacked".
 *
 *   pnpm exec tsx pos-agent-extension/scripts/dong-goi.ts            # cả PROD + TEST
 *   pnpm exec tsx pos-agent-extension/scripts/dong-goi.ts --moi-truong=PROD
 *
 * Ra: `pos-agent-extension/dist/<prod|test>/` (thư mục nạp thẳng được) +
 *     `pos-agent-extension/dist/satarobo-pos-agent-<phiên bản>-<prod|test>.zip` (+ SHA-256).
 * Không thêm phụ thuộc: biên dịch bằng `typescript`, nén bằng `jszip` — cả hai đã có trong repo.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import JSZip from "jszip";
import { bienDichTs } from "./bien-dich";
import { dungManifest } from "../src/manifest";
import { PHIEN_BAN, type MoiTruongSatarobo } from "../src/lib/hang-so";

const SCRIPT_CO_DIEN = ["content-main.ts", "content-isolated.ts"];
const MODULE_GOC = ["background.ts", "options.ts"];
const TINH = ["options.html", "options.css"];
/** Ngày cố định trong .zip ⇒ cùng mã nguồn cho cùng tệp nén (so SHA-256 được giữa hai máy). */
const NGAY_ZIP = new Date(Date.UTC(2026, 9, 7, 0, 0, 0));

/** Thư mục `pos-agent-extension/` — chạy từ gốc repo hay từ chính thư mục đó đều được. */
export function timGocExtension(cwd: string = process.cwd()): string {
  for (const ung of [join(cwd, "pos-agent-extension"), cwd]) {
    if (existsSync(join(ung, "src", "manifest.ts")) && existsSync(join(ung, "src", "content-main.ts"))) return resolve(ung);
  }
  throw new Error("Không tìm thấy thư mục pos-agent-extension (chạy lệnh từ gốc repo).");
}

export interface KetQuaDongGoi {
  thuMuc: string;
  tepZip: string;
  danhSach: string[];
  sha256: string;
}

export async function dongGoi(p: { moiTruong: MoiTruongSatarobo; thuMucRa: string; gocExt?: string }): Promise<KetQuaDongGoi> {
  const goc = p.gocExt ?? timGocExtension();
  const src = join(goc, "src");
  const thuMuc = join(p.thuMucRa, p.moiTruong.toLowerCase());
  rmSync(thuMuc, { recursive: true, force: true });
  mkdirSync(join(thuMuc, "lib"), { recursive: true });

  const danhSach: string[] = [];
  const ghi = (rel: string, noiDung: string | Buffer): void => {
    writeFileSync(join(thuMuc, ...rel.split("/")), noiDung);
    danhSach.push(rel);
  };
  const doc = (rel: string): string => readFileSync(join(src, ...rel.split("/")), "utf8");

  for (const f of SCRIPT_CO_DIEN) ghi(f.replace(/\.ts$/, ".js"), bienDichTs(doc(f), f, "script"));
  for (const f of MODULE_GOC) ghi(f.replace(/\.ts$/, ".js"), bienDichTs(doc(f), f, "module"));
  const lib = readdirSync(join(src, "lib"))
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"))
    .sort();
  for (const f of lib) ghi(`lib/${f.replace(/\.ts$/, ".js")}`, bienDichTs(doc(`lib/${f}`), f, "module"));
  for (const f of TINH) ghi(f, readFileSync(join(src, f)));
  ghi("manifest.json", `${JSON.stringify(dungManifest(p.moiTruong), null, 2)}\n`);

  const zip = new JSZip();
  // `createFolders: false`: JSZip tự tạo mục thư mục "lib/" mang GIỜ HIỆN TẠI ⇒ mỗi lần nén ra
  // SHA-256 khác nhau dù mã không đổi. Bỏ mục thư mục (bộ giải nén nào cũng tự dựng theo đường dẫn).
  for (const rel of [...danhSach].sort()) {
    zip.file(rel, readFileSync(join(thuMuc, ...rel.split("/"))), { date: NGAY_ZIP, createFolders: false });
  }
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
  const tepZip = join(p.thuMucRa, `satarobo-pos-agent-${PHIEN_BAN}-${p.moiTruong.toLowerCase()}.zip`);
  writeFileSync(tepZip, buf);
  return { thuMuc, tepZip, danhSach: [...danhSach].sort(), sha256: createHash("sha256").update(buf).digest("hex") };
}

async function chayTuDongLenh(): Promise<void> {
  const thamSo = process.argv.slice(2);
  const mt = thamSo.find((a) => a.startsWith("--moi-truong="))?.split("=")[1]?.toUpperCase();
  const ds: MoiTruongSatarobo[] = mt === "PROD" || mt === "TEST" ? [mt] : ["PROD", "TEST"];
  if (mt && mt !== "PROD" && mt !== "TEST") throw new Error("--moi-truong chỉ nhận PROD hoặc TEST");
  const goc = timGocExtension();
  const ra = join(goc, "dist");
  mkdirSync(ra, { recursive: true });
  for (const moiTruong of ds) {
    const kq = await dongGoi({ moiTruong, thuMucRa: ra, gocExt: goc });
    console.log(`[${moiTruong}] thư mục nạp: ${kq.thuMuc}`);
    console.log(`[${moiTruong}] gói: ${kq.tepZip}`);
    console.log(`[${moiTruong}] SHA-256: ${kq.sha256} · ${kq.danhSach.length} tệp`);
  }
}

if (basename(process.argv[1] ?? "").startsWith("dong-goi")) {
  chayTuDongLenh().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
