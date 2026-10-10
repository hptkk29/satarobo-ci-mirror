// lib/security/url-db-cuc-bo.test.ts — "chuỗi DB này có phải Postgres TRÊN MÁY không". THUẦN.
//
// Từ 28/09/2026 DB prod/test nằm trên VPS và chỉ tới được qua SSH tunnel:
//   127.0.0.1:5433 → DB PROD · 127.0.0.1:5435 → DB TEST (test.satarobo.vn, tên `satarobo_test`)
// (docs/VPS-VAN-HANH.md, .github/actions/tunnel-vps). Mọi cổng "chỉ xoá DB local" của repo nhận
// diện local bằng `127.0.0.1`/`localhost` (+ tên `satarobo_test`) ⇒ tunnel TRÔNG Y HỆT DB máy
// ⇒ một lệnh `pnpm test:*-db` với DATABASE_URL trỏ :5435 là TRUNCATE sạch dữ liệu của
// test.satarobo.vn. Tệp này là MỘT chỗ trả lời, và lưới cuối tệp giữ cho nó là chỗ duy nhất.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONG_TUNNEL_VPS,
  congTunnelVps,
  laDbCucBo,
  laTenDbTest,
  loiTunnelVps,
} from "./url-db-cuc-bo";

const MAY = "postgresql://postgres:postgres@127.0.0.1:5432/satarobo_test";
const MAY_KHONG_CONG = "postgresql://postgres:postgres@localhost/satarobo_test";
const TUNNEL_PROD = "postgresql://satarobo:matkhau@127.0.0.1:5433/satarobo";
const TUNNEL_TEST = "postgresql://satarobo_test:matkhau@127.0.0.1:5435/satarobo_test";

describe("[UDB] nhận diện tunnel VPS", () => {
  it("[UDB-01] cổng 5433 (PROD) và 5435 (TEST) là tunnel — kể cả khi host là 127.0.0.1/localhost", () => {
    expect(congTunnelVps(TUNNEL_PROD)).toBe("5433");
    expect(congTunnelVps(TUNNEL_TEST)).toBe("5435");
    expect(congTunnelVps("postgresql://u:p@localhost:5435/satarobo_test?schema=public")).toBe("5435");
    expect(congTunnelVps("postgresql://u:p@127.0.0.1:5433")).toBe("5433");
    expect(Object.keys(CONG_TUNNEL_VPS).sort()).toEqual(["5433", "5435"]);
  });

  it("[UDB-02] tunnel KHÔNG phải DB máy, dù tên DB là satarobo_test", () => {
    expect(laDbCucBo(TUNNEL_TEST)).toBe(false);
    expect(laDbCucBo(TUNNEL_PROD)).toBe(false);
    // Tên vẫn "trông như DB test" — chính vì thế cổng nào chỉ hỏi tên là cổng hở.
    expect(laTenDbTest(TUNNEL_TEST)).toBe(true);
  });

  it("[UDB-03] mật khẩu có ký tự lạ không che được cổng (đọc sau dấu @ CUỐI, như kiem-url-tunnel.sh)", () => {
    expect(congTunnelVps("postgresql://u:pa/ss?x@127.0.0.1:5435/satarobo_test")).toBe("5435");
    expect(congTunnelVps("postgresql://u:p@127.0.0.1/db?port=5433")).toBe("5433");
  });

  it("[UDB-04] lời từ chối gọi tên cổng, nói đó là dữ liệu THẬT và chỉ đường về cổng 5432", () => {
    const loi = loiTunnelVps(TUNNEL_TEST)!;
    expect(loi).toContain("5435");
    expect(loi).toContain("test.satarobo.vn");
    expect(loi).toContain("5432");
    expect(loiTunnelVps(TUNNEL_PROD)!).toContain("PROD");
    // Không bao giờ in chuỗi kết nối (có mật khẩu).
    expect(loi).not.toContain("matkhau");
  });

  it("[UDB-05] đối chứng dương: Postgres trên máy (cổng 5432 hoặc không ghi cổng) VẪN là DB máy", () => {
    for (const u of [MAY, MAY_KHONG_CONG, "postgresql://postgres:postgres@127.0.0.1:5432/satarobo_test_ipcaddy"]) {
      expect(congTunnelVps(u), u).toBeNull();
      expect(laDbCucBo(u), u).toBe(true);
      expect(loiTunnelVps(u), u).toBeNull();
    }
    // Cổng khác tình cờ chứa 5433 như chuỗi con thì không phải tunnel.
    expect(congTunnelVps("postgresql://u:p@127.0.0.1:15433/x")).toBeNull();
    expect(congTunnelVps("postgresql://u:p@127.0.0.1:54330/x")).toBeNull();
    // Máy xa không phải DB máy (hành vi cũ giữ nguyên).
    expect(laDbCucBo("postgresql://u:p@aws-0-ap.pooler.supabase.com:5432/postgres")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LƯỚI QUÉT CÂY — không ai tự viết lại phép "DB này có phải local không".
//
// Trước bản vá có MƯỜI BẢY bản chép tay của cùng một biểu thức (tests/cham-cong ×9,
// tests/_helpers/db-gate.ts, tests/e2e/_helpers/seed.ts, tests/nen/webhook-retention.spec.ts,
// prisma/seed-lms, prisma/seed-test-*, scripts/…). Vá tunnel ở một bản thì mười sáu bản kia
// vẫn hở. Luật nay: tệp nào đọc chuỗi DB (`DATABASE_URL`) mà tự nhận diện 127.0.0.1/localhost
// là ĐỎ — gọi `laDbCucBo` / `congTunnelVps` của tệp này.
//
// ⚠️ Lưới văn bản (luật 11): bỏ chú thích TRƯỚC khi soi, bộ soi là hàm thuần có ca riêng, và
// danh sách cho phép phải tự chứng minh nó còn cần (mỗi mục phải khớp ≥1 lần).
// ─────────────────────────────────────────────────────────────────────────────

/** Bỏ chú thích khối / JSX / dòng / cuối dòng trước khi soi. */
function boChuThich(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

/** Có tự nhận diện host local trong một tệp đọc chuỗi DB không. */
export function tuNhanDienDbLocal(src: string): boolean {
  const than = boChuThich(src);
  if (!/DATABASE_URL/.test(than)) return false;
  return /127\\\.0\\\.0\\\.1|[!=]==\s*["'](?:127\.0\.0\.1|localhost)["']/.test(than);
}

const VUNG_DB = ["tests", "scripts", "prisma"];
/** Chỉ tệp có lý do, ghi ngay cạnh. */
const DUOC_PHEP_DB = new Map<string, string>([
  [
    "scripts/cleanup-test-data.ts",
    "chiều NGƯỢC: từ chối DB local (script chỉ dọn Supabase) — tunnel 127.0.0.1 bị từ chối theo đúng ý",
  ],
]);

function quetCay(goc: string[], nhan: (rel: string, src: string) => boolean): { trung: string[]; soTep: number } {
  const trung: string[] = [];
  let soTep = 0;
  const di = (thuMuc: string) => {
    for (const e of fs.readdirSync(thuMuc, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
      const p = path.join(thuMuc, e.name);
      if (e.isDirectory()) di(p);
      else if (/\.(ts|tsx|mts|mjs|js|cjs)$/.test(e.name)) {
        soTep += 1;
        const rel = path.relative(process.cwd(), p).split(path.sep).join("/");
        if (nhan(rel, fs.readFileSync(p, "utf8"))) trung.push(rel);
      }
    }
  };
  for (const g of goc) di(path.resolve(process.cwd(), g));
  return { trung, soTep };
}

describe("[UDB-LUOI] một chỗ nhận diện DB máy", () => {
  it("[UDB-LUOI-01] bộ soi: bắt các dạng chép tay, bỏ qua chú thích và tệp không đọc DATABASE_URL", () => {
    const ENV = "const u = process.env.DATABASE_URL ?? '';\n";
    expect(tuNhanDienDbLocal(ENV + "const l = /(@|\\/\\/)(localhost|127\\.0\\.0\\.1)[:/]/.test(u);")).toBe(true);
    expect(tuNhanDienDbLocal(ENV + "if (!/127\\.0\\.0\\.1|localhost|satarobo_test/i.test(u)) throw 1;")).toBe(true);
    expect(tuNhanDienDbLocal(ENV + 'const local = host === "127.0.0.1" || host === "localhost";')).toBe(true);
    // Dạng phủ định (prisma/seed-uat-case-trial.ts cũ — bản lọt bộ soi đầu tiên).
    expect(tuNhanDienDbLocal(ENV + 'if (host !== "127.0.0.1" && host !== "localhost") throw 1;')).toBe(true);
    // Chỉ trong chú thích ⇒ không tính.
    expect(tuNhanDienDbLocal(ENV + "// cũ: /127\\.0\\.0\\.1/.test(u)\nconst x = 1;")).toBe(false);
    expect(tuNhanDienDbLocal(ENV + "/* host === \"localhost\" */ const x = 1;")).toBe(false);
    expect(tuNhanDienDbLocal(ENV + "const x = laDbCucBo(u); // thay cho /127\\.0\\.0\\.1/")).toBe(false);
    // Không đọc chuỗi DB (vd kiểm redirect_uri OAuth) ⇒ ngoài phạm vi lưới này.
    expect(tuNhanDienDbLocal("const LOOP = /^http:\\/\\/(localhost|127\\.0\\.0\\.1)/;")).toBe(false);
  });

  it("[UDB-LUOI-02] tests/ scripts/ prisma/: không tệp nào ngoài danh sách tự nhận diện DB local", () => {
    const { trung, soTep } = quetCay(VUNG_DB, (rel, src) => !rel.endsWith("url-db-cuc-bo.test.ts") && tuNhanDienDbLocal(src));
    expect(soTep, "quét ra quá ít tệp — sai cwd? lưới đang không chạm cây thật").toBeGreaterThan(300);
    const sai = trung.filter((t) => !DUOC_PHEP_DB.has(t));
    expect(sai, "tự nhận diện 127.0.0.1/localhost ⇒ tunnel VPS (:5433/:5435) lọt qua. Dùng lib/security/url-db-cuc-bo.ts").toEqual([]);
  });

  it("[UDB-LUOI-03] danh sách cho phép không mục: mỗi mục còn tồn tại và còn khớp", () => {
    for (const [tep] of DUOC_PHEP_DB) {
      const src = fs.readFileSync(path.resolve(process.cwd(), tep), "utf8");
      expect(tuNhanDienDbLocal(src), `${tep} không còn khớp — gỡ khỏi danh sách`).toBe(true);
    }
  });
});
