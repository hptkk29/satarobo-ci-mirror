// lib/ai-lead/khoa.test.ts — DẪN XUẤT khoá Agent AI Lead từ AI_LEAD_AGENT_MASTER_KEY. Thuần (đổi process.env tạm, khôi phục sau mỗi ca).
//
// Mã ca: [AIL-KH-01..07] · [AIL-KH-W1] (lưới dây nối: chỉ MỘT nơi đọc biến môi trường). Khoá master trong test là chuỗi GIẢ.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { daoKhoaAgent, khoaGiaChoAgentLa, masterKeyCoSan, nguCanhDanXuat } from "./khoa";
import { laDanhTinhFixture } from "./hop-dong";
import { boChuThich } from "./ho-tro-test";

const BIEN = "AI_LEAD_AGENT_MASTER_KEY";
const MASTER = "master-key-GIA-chi-de-test-0123456789abcdef";
let cu: string | undefined;

beforeEach(() => {
  cu = process.env[BIEN];
  process.env[BIEN] = MASTER;
});
afterEach(() => {
  if (cu === undefined) delete process.env[BIEN];
  else process.env[BIEN] = cu;
});

const doc = (master: string, agentId: string, v: number) =>
  createHmac("sha256", Buffer.from(master, "utf8")).update(Buffer.from(`ailead:${agentId}:${v}`, "utf8")).digest("hex");

describe("[AIL-KH-01] dẫn xuất đúng công thức hex(HMAC-SHA256(master, 'ailead:<agentId>:<version>'))", () => {
  it("khớp tính độc lập; 64 ký tự hex thường", () => {
    const k = daoKhoaAgent("clx9abcdefghij0123456789a", 1);
    expect(k).toBe(doc(MASTER, "clx9abcdefghij0123456789a", 1));
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
  it("ngữ cảnh dẫn xuất là 'ailead:<id>:<v>' (tách miền khỏi khoá POS `<id>:<v>`)", () => {
    expect(nguCanhDanXuat("abc", 3)).toBe("ailead:abc:3");
    const pos = createHmac("sha256", Buffer.from(MASTER, "utf8")).update(Buffer.from("abc:3", "utf8")).digest("hex");
    expect(daoKhoaAgent("abc", 3)).not.toBe(pos);
  });
});

describe("[AIL-KH-02] khoá khác nhau theo agent, theo phiên bản (xoay khoá ⇒ khoá cũ chết ngay), theo master", () => {
  it("khác agent · khác version · khác master", () => {
    const a = daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 1);
    expect(daoKhoaAgent("agent-bbbbbbbbbbbbbbbbbbbb", 1)).not.toBe(a);
    expect(daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 2)).not.toBe(a);
    process.env[BIEN] = `${MASTER}-khac`;
    expect(daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 1)).not.toBe(a);
  });
  it("cùng đầu vào ⇒ cùng khoá (tất định)", () => {
    expect(daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 5)).toBe(daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 5));
  });
});

describe("[AIL-KH-03] thiếu / ngắn master key ⇒ null (route trả 503 NOT_CONFIGURED), KHÔNG BAO GIỜ ký bằng khoá rỗng", () => {
  it("thiếu", () => {
    delete process.env[BIEN];
    expect(masterKeyCoSan()).toBe(false);
    expect(daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 1)).toBeNull();
  });
  it("rỗng · 31 ký tự ⇒ chưa cấu hình; đúng 32 ký tự ⇒ có", () => {
    process.env[BIEN] = "";
    expect(masterKeyCoSan()).toBe(false);
    process.env[BIEN] = "x".repeat(31);
    expect(masterKeyCoSan()).toBe(false);
    expect(daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 1)).toBeNull();
    process.env[BIEN] = "x".repeat(32);
    expect(masterKeyCoSan()).toBe(true);
    expect(daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 1)).not.toBeNull();
  });
});

describe("[AIL-KH-04] secretVersion không hợp lệ ⇒ NÉM (lỗi lập trình, không phải cấu hình)", () => {
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("version %s", (v) => {
    expect(() => daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", v)).toThrow(/secretVersion/);
  });
  it("kiểm version TRƯỚC khi nhìn master: thiếu master + version sai vẫn ném (không nuốt lỗi lập trình thành 'chưa cấu hình')", () => {
    delete process.env[BIEN];
    expect(() => daoKhoaAgent("agent-aaaaaaaaaaaaaaaaaaaa", 0)).toThrow(/secretVersion/);
  });
});

describe("[AIL-KH-05] khoá GIẢ cho agent không tồn tại (P1)", () => {
  it("tất định, KHÁC khoá thật của cùng id ở mọi version, và không phụ thuộc DB", () => {
    const id = "khongtontai0000000000";
    expect(khoaGiaChoAgentLa(id)).toBe(khoaGiaChoAgentLa(id));
    expect(khoaGiaChoAgentLa(id)).toMatch(/^[0-9a-f]{64}$/);
    for (const v of [1, 2, 3]) expect(khoaGiaChoAgentLa(id)).not.toBe(daoKhoaAgent(id, v));
  });
  it("vẫn trả chuỗi khi thiếu master (đường đó đã bị chặn ở bước 1; đây là lưới an toàn, không ném)", () => {
    delete process.env[BIEN];
    expect(khoaGiaChoAgentLa("khongtontai0000000000")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("[AIL-KH-06] agentId của FIXTURE (cm9ailagenttest…) bị coi là danh tính cấm — khoá.ts vẫn dẫn xuất được, nên việc chặn là của lớp cấp khoá", () => {
  it("dẫn xuất KHÔNG tự từ chối id fixture (lớp cấp khoá/khởi động dùng `laDanhTinhFixture`)", () => {
    expect(daoKhoaAgent("cm9ailagenttest00000001", 1)).not.toBeNull();
    expect(laDanhTinhFixture({ agentId: "cm9ailagenttest00000001" })).toBe(true);
  });
});

describe("[AIL-KH-W1] lưới dây nối: `AI_LEAD_AGENT_MASTER_KEY` chỉ được ĐỌC ở lib/ai-lead/khoa.ts", () => {
  function* duyet(thuMuc: string): Generator<string> {
    for (const t of readdirSync(thuMuc)) {
      if (t === "node_modules" || t === ".next") continue;
      const p = join(thuMuc, t);
      const s = statSync(p);
      if (s.isDirectory()) yield* duyet(p);
      else if (/\.(ts|tsx|mjs)$/.test(t) && !/\.test\.(ts|tsx)$/.test(t)) yield p;
    }
  }
  it("không tệp mã chạy thật nào ngoài khoa.ts nhắc `process.env.AI_LEAD_AGENT_MASTER_KEY`", () => {
    const goc = process.cwd();
    const vi: string[] = [];
    let soTepDuyet = 0;
    for (const thuMuc of ["lib", "app", "components", "scripts"]) {
      for (const p of duyet(resolve(goc, thuMuc))) {
        soTepDuyet++;
        const ten = relative(goc, p).replace(/\\/g, "/");
        if (ten === "lib/ai-lead/khoa.ts") continue;
        const src = boChuThich(readFileSync(p, "utf8"));
        if (/process\.env\.AI_LEAD_AGENT_MASTER_KEY|process\.env\[\s*["']AI_LEAD_AGENT_MASTER_KEY["']\s*\]/.test(src)) vi.push(ten);
      }
    }
    expect(soTepDuyet, "lưới phải thật sự duyệt cây").toBeGreaterThan(1000);
    expect(vi).toEqual([]);
  });
  it("đối chứng dương: khoa.ts THẬT SỰ đọc biến này (nếu không lưới trên xanh vì lý do sai)", () => {
    const src = boChuThich(readFileSync(resolve(process.cwd(), "lib/ai-lead/khoa.ts"), "utf8"));
    expect(src).toMatch(/process\.env\.AI_LEAD_AGENT_MASTER_KEY/);
  });
});
