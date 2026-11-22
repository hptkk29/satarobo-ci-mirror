// Ca [POS4-KY-01..04] — chữ ký HMAC của hợp đồng POS Agent (GĐ4). THUẦN.
//
// Bộ vector chung với extension GĐ5: `tests/fixtures/pos/agent-hmac-vectors.json` (dựng từ CHÍNH
// docs/pos-agent-api.md §3.8 — thân V2/V3 đọc từ tệp hợp đồng, không gõ tay). Đổi chuỗi ký là đỏ ở đây
// VÀ ở bộ test của extension — đúng thứ hợp đồng muốn.
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHmac } from "node:crypto";
import { bamThan, chuoiKy, kyChuoi, kiemDinhDangHeader, kiemLechGio } from "./ky";
import { daoKhoaAgent, masterKeyCoSan } from "./khoa";

type Vector = {
  ten: string;
  method: "GET" | "POST";
  path: string;
  ts: string;
  nonce: string;
  body: string;
  bodyBytes: number;
  bodySha256: string;
  chuoiKy: string;
  sig: string;
};
const V = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/pos/agent-hmac-vectors.json"), "utf8")) as {
  masterKey: string;
  agentId: string;
  secretVersion: number;
  agentSecret: string;
  vectors: Vector[];
  doiChungAm: { V1_khoaHexDecode: string; V1_thuaXuongDong: string };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("[POS4-KY-01] chuỗi ký + băm thân + chữ ký ra ĐÚNG vector V1–V3", () => {
  it("bộ vector đủ ba và trỏ đúng ba endpoint", () => {
    expect(V.vectors.map((v) => v.ten)).toEqual(["V1", "V2", "V3"]);
    expect(V.vectors.map((v) => `${v.method} ${v.path}`)).toEqual([
      "GET /api/pos-agent/jobs",
      "POST /api/pos-agent/heartbeat",
      "POST /api/pos-agent/transactions",
    ]);
  });

  it.each(V.vectors.map((v) => [v.ten, v] as const))("%s", (_ten, v) => {
    const byte = new TextEncoder().encode(v.body);
    // Byte UTF-8, không đếm ký tự JS (V3 có tiếng Việt: 857 byte).
    expect(byte.length).toBe(v.bodyBytes);
    expect(bamThan(byte)).toBe(v.bodySha256);
    const ck = chuoiKy({ method: v.method, path: v.path, ts: v.ts, nonce: v.nonce, bamThan: v.bodySha256 });
    expect(ck).toBe(v.chuoiKy);
    expect(ck.split("\n")).toHaveLength(5); // đúng 4 dấu "\n", không thừa ở cuối
    expect(kyChuoi(V.agentSecret, ck)).toBe(v.sig);
  });

  it("thân rỗng (GET) ⇒ e3b0…b855", () => {
    expect(bamThan(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("[POS4-KY-02] khoá agent DẪN XUẤT từ master key (T2) — DB không giữ bí mật", () => {
  it("version 1 = agentSecret của vector; version 2 KHÁC (tạo lại secret = khoá cũ chết)", () => {
    vi.stubEnv("POS_AGENT_MASTER_KEY", V.masterKey);
    expect(masterKeyCoSan()).toBe(true);
    const k1 = daoKhoaAgent(V.agentId, 1);
    expect(k1).toBe(V.agentSecret);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
    const k2 = daoKhoaAgent(V.agentId, 2);
    expect(k2).not.toBe(k1);
    expect(k2).toMatch(/^[0-9a-f]{64}$/);
    // Agent khác cùng version ⇒ khoá khác.
    expect(daoKhoaAgent("cm9posagentcs2test0000002", 1)).not.toBe(k1);
  });

  it("thiếu env hoặc < 32 ký tự ⇒ masterKeyCoSan false VÀ daoKhoaAgent NÉM (không bao giờ ký bằng khoá rỗng)", () => {
    vi.stubEnv("POS_AGENT_MASTER_KEY", "");
    expect(masterKeyCoSan()).toBe(false);
    expect(() => daoKhoaAgent(V.agentId, 1)).toThrow();
    vi.stubEnv("POS_AGENT_MASTER_KEY", "x".repeat(31));
    expect(masterKeyCoSan()).toBe(false);
    expect(() => daoKhoaAgent(V.agentId, 1)).toThrow();
    // Đối chứng dương: đúng 32 ký tự là đủ.
    vi.stubEnv("POS_AGENT_MASTER_KEY", "x".repeat(32));
    expect(masterKeyCoSan()).toBe(true);
    expect(daoKhoaAgent(V.agentId, 1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("version không phải số nguyên ≥ 1 ⇒ NÉM", () => {
    vi.stubEnv("POS_AGENT_MASTER_KEY", V.masterKey);
    expect(() => daoKhoaAgent(V.agentId, 0)).toThrow();
    expect(() => daoKhoaAgent(V.agentId, 1.5)).toThrow();
  });
});

describe("[POS4-KY-03] đối chứng ÂM — cài sai ra chữ ký KHÁC V1", () => {
  const v1 = V.vectors[0]!;

  it("khoá hex-decode (32 byte) thay vì UTF-8 của chuỗi 64 ký tự ⇒ 603836a5…", () => {
    const sai = createHmac("sha256", Buffer.from(V.agentSecret, "hex")).update(v1.chuoiKy, "utf8").digest("hex");
    expect(sai).toBe(V.doiChungAm.V1_khoaHexDecode);
    expect(sai).not.toBe(v1.sig);
  });

  it("thừa '\\n' sau băm thân ⇒ 8626e2c4…", () => {
    expect(kyChuoi(V.agentSecret, `${v1.chuoiKy}\n`)).toBe(V.doiChungAm.V1_thuaXuongDong);
    expect(V.doiChungAm.V1_thuaXuongDong).not.toBe(v1.sig);
  });

  it("method chữ thường · path có query · ts đổi định dạng ⇒ chữ ký khác", () => {
    const goc = { method: "GET", path: v1.path, ts: v1.ts, nonce: v1.nonce, bamThan: v1.bodySha256 };
    for (const sua of [{ method: "get" }, { path: `${v1.path}?x=1` }, { ts: "1791343200" }, { ts: ` ${v1.ts}` }]) {
      expect(kyChuoi(V.agentSecret, chuoiKy({ ...goc, ...sua })), JSON.stringify(sua)).not.toBe(v1.sig);
    }
  });
});

describe("[POS4-KY-04] lệch giờ: biên 300 000 ms qua, 300 001 ms trượt — cả hai phía", () => {
  const NOW = 1_791_343_200_000;
  it.each([
    [NOW - 300_000, true],
    [NOW + 300_000, true],
    [NOW - 300_001, false],
    [NOW + 300_001, false],
    [NOW, true],
  ])("ts=%s ⇒ %s", (ts, qua) => {
    expect(kiemLechGio(ts, NOW)).toBe(qua);
  });
});

describe("kiemDinhDangHeader — luật §3.1 của hợp đồng", () => {
  const H = {
    "x-agent-id": "cm9posagentcs1test0000001",
    "x-agent-ts": "1791343200000",
    "x-agent-nonce": "5f0c1a9e2b7d4c3e8a6f1b2d3c4e5f60",
    "x-agent-sig": "de599aaf3f7a7a273d9d7f19a905e26f4f7cba4adba4e699f557608a4f6332ce",
  };
  const doc = (h: Record<string, string>) => kiemDinhDangHeader((k) => h[k.toLowerCase()] ?? null);

  it("đúng định dạng ⇒ ok; chữ ký IN HOA được hạ chữ thường", () => {
    expect(doc(H)).toEqual({ ok: true, agentId: H["x-agent-id"], ts: H["x-agent-ts"], tsMs: 1791343200000, nonce: H["x-agent-nonce"], sig: H["x-agent-sig"] });
    const hoa = doc({ ...H, "x-agent-sig": H["x-agent-sig"].toUpperCase() });
    expect(hoa.ok && hoa.sig).toBe(H["x-agent-sig"]);
  });

  it.each([
    ["thiếu id", { "x-agent-id": "" }],
    ["id có chữ hoa", { "x-agent-id": "CM9POSAGENTCS1TEST000001" }],
    ["ts 10 chữ số (giây)", { "x-agent-ts": "1791343200" }],
    ["ts có khoảng trắng", { "x-agent-ts": " 1791343200000" }],
    ["nonce ngắn", { "x-agent-nonce": "abc" }],
    ["nonce ký tự lạ", { "x-agent-nonce": "5f0c1a9e2b7d4c3e8a6f1b2d3c4e5f6!" }],
    ["sig 63 hex", { "x-agent-sig": "a".repeat(63) }],
    ["sig không hex", { "x-agent-sig": "g".repeat(64) }],
  ])("%s ⇒ lỗi", (_t, sua) => {
    expect(doc({ ...H, ...sua }).ok).toBe(false);
  });
});
