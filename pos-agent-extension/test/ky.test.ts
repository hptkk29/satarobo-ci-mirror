/**
 * Chữ ký HMAC-SHA256 của extension phải ra ĐÚNG các test vector cố định trong hợp đồng
 * `docs/pos-agent-api.md` §3.8 — cùng vector máy chủ (GĐ4) dùng. Ba vector + hai đối chứng ÂM.
 *
 * Vì sao kiểm thêm bằng cách ĐỌC chính tệp hợp đồng ([EXT-KY-07]): hằng số chép tay trong
 * test có thể lệch hợp đồng mà không ai biết; đọc thẳng tệp thì hợp đồng đổi là test đỏ.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, createHmac } from "node:crypto";
import { SHA256_RONG, dungChuoiKy, hmacSha256Hex, kyYeuCau, sha256Hex, taoNonce } from "../src/lib/ky";
import { thanHeartbeat } from "../src/lib/than-api";
import { dungLo } from "../src/lib/dong-bo";
import { chuanHoaGiaoDich } from "../src/lib/payload";
import { AGENT_ID, BI_MAT, MASTER_KEY } from "./ho-tro/du-lieu";

// `core.autocrlf=true` trên máy Windows ⇒ tệp .md có thể về CRLF khi checkout: chuẩn hoá trước khi so.
const HOP_DONG = readFileSync(resolve(process.cwd(), "docs/pos-agent-api.md"), "utf8").replace(/\r\n/g, "\n");

const V2_THAN =
  '{"extensionVersion":"0.1.0","sessionState":"READY","sessionExpiresAt":"2026-10-08T08:15:00+07:00","lastSyncedAt":"2026-10-07T10:19:30+07:00","profileName":"CS1"}';
const V3_THAN =
  '{"syncId":"sync-20261007-102000-cs1","batchIndex":0,"final":true,"windowFrom":"2026-10-07 08:20:00","windowTo":"2026-10-07 10:20:00","jobIds":["cm9posjob0000000000000001"],"transactions":[{"transaction_id":"TXN20261007000123","transaction_type":"PAYMENT","transaction_detail_status":"SUCCESS","transaction_master_status":"SUCCESS","order_description":"Học phí bé An K7M2N","authorization_id":"123456","card_transaction_id":"628012345678","order_amount":6732000,"transaction_master_amount":6732000,"transaction_detail_amount":6732000,"fee":null,"currency":"VND","transaction_time":"2026/10/07 10:18:42","merchant_code":"NCCPH6KE","store_code":"CH9TSGU9","terminal_code":"QTT45XWQT","payment_method":"CARD","service_type":"OMSMARTPOS","sender_card_number":"411111******1111","sender_card_type":"VISA","accounting_reference_id":null,"settlement_id":null}]}';

const VECTOR = [
  {
    ten: "V1",
    phuongThuc: "GET" as const,
    duongDan: "/api/pos-agent/jobs",
    ts: "1791343200000",
    nonce: "5f0c1a9e2b7d4c3e8a6f1b2d3c4e5f60",
    than: "",
    bamThan: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    sig: "de599aaf3f7a7a273d9d7f19a905e26f4f7cba4adba4e699f557608a4f6332ce",
  },
  {
    ten: "V2",
    phuongThuc: "POST" as const,
    duongDan: "/api/pos-agent/heartbeat",
    ts: "1791343201500",
    nonce: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    than: V2_THAN,
    bamThan: "c8aaf8aa0140c43d277596ee81d2baf1f2c9e9169fed8a270fd10a922b0ab69d",
    sig: "fa2e93875455a9d6bd3d8cdbe73e79a7eceda1ff68c863391f90028684c6da33",
  },
  {
    ten: "V3",
    phuongThuc: "POST" as const,
    duongDan: "/api/pos-agent/transactions",
    ts: "1791343203000",
    nonce: "0123456789abcdef0123456789abcdef",
    than: V3_THAN,
    bamThan: "c46861f341034deca561173052b5373fddc866df93da36bc1f7750eb1ccee224",
    sig: "964e19ab22f156cc5d1397b7585474e7e8163e1e1833cfc926953b086241034a",
  },
];

/** Đối chứng ÂM của V1 (hợp đồng §3.8): hai lỗi cài đặt hay gặp ra chữ ký KHÁC. */
const SAI_KHOA_HEX_DECODE = "603836a5b0acfc3b187cf1166c7f9fd3bfa1c17d2800d030d65a87fdc422f2b0";
const SAI_THUA_XUONG_DONG = "8626e2c4c5f4b62e620e6c5358c295aaa97be43915515aa911ce5d64925d6872";

describe("Chữ ký HMAC — test vector hợp đồng (§3.8)", () => {
  it("[EXT-KY-01] agentSecret của vector = hex(HMAC(master, agentId:1)) — khoá test đúng như hợp đồng", () => {
    const tinh = createHmac("sha256", MASTER_KEY).update(`${AGENT_ID}:1`).digest("hex");
    expect(tinh).toBe(BI_MAT);
  });

  for (const v of VECTOR) {
    it(`[EXT-KY-02/${v.ten}] SHA-256 thân + chữ ký X-Agent-Sig khớp ĐÚNG vector`, async () => {
      expect(await sha256Hex(v.than)).toBe(v.bamThan);
      const h = await kyYeuCau({
        agentId: AGENT_ID,
        biMat: BI_MAT,
        phuongThuc: v.phuongThuc,
        duongDan: v.duongDan,
        than: v.than,
        ts: v.ts,
        nonce: v.nonce,
      });
      expect(h).toEqual({
        "X-Agent-Contract": "1",
        "X-Agent-Id": AGENT_ID,
        "X-Agent-Ts": v.ts,
        "X-Agent-Nonce": v.nonce,
        "X-Agent-Sig": v.sig,
      });
    });
  }

  it("[EXT-KY-03] chuỗi ký đúng 4 dấu LF, không LF cuối; thân rỗng băm = hằng SHA256_RONG", () => {
    const v = VECTOR[0];
    const s = dungChuoiKy(v.phuongThuc, v.duongDan, v.ts, v.nonce, v.bamThan);
    expect(s).toBe(`GET\n/api/pos-agent/jobs\n1791343200000\n5f0c1a9e2b7d4c3e8a6f1b2d3c4e5f60\n${v.bamThan}`);
    expect(s.split("\n")).toHaveLength(5);
    expect(s.endsWith("\n")).toBe(false);
    expect(SHA256_RONG).toBe(v.bamThan);
  });

  it("[EXT-KY-04] V3 băm theo BYTE UTF-8 (857 byte) — không theo số ký tự JS", async () => {
    expect(Buffer.byteLength(V3_THAN, "utf8")).toBe(857);
    expect(V3_THAN.length).not.toBe(857);
    expect(await sha256Hex(V3_THAN)).toBe(createHash("sha256").update(V3_THAN, "utf8").digest("hex"));
  });

  it("[EXT-KY-05] đối chứng ÂM: chữ ký đúng KHÁC hai cách cài sai mà hợp đồng liệt kê", async () => {
    const v = VECTOR[0];
    const chuoi = dungChuoiKy(v.phuongThuc, v.duongDan, v.ts, v.nonce, v.bamThan);
    // node:crypto tính lại đúng hai số sai của hợp đồng ⇒ bảng đối chứng là thật
    expect(createHmac("sha256", Buffer.from(BI_MAT, "hex")).update(chuoi).digest("hex")).toBe(SAI_KHOA_HEX_DECODE);
    expect(createHmac("sha256", BI_MAT).update(`${chuoi}\n`).digest("hex")).toBe(SAI_THUA_XUONG_DONG);
    const dung = await hmacSha256Hex(BI_MAT, chuoi);
    expect(dung).toBe(v.sig);
    expect(dung).not.toBe(SAI_KHOA_HEX_DECODE);
    expect(dung).not.toBe(SAI_THUA_XUONG_DONG);
  });

  it("[EXT-KY-06] thân V2 dựng bằng thanHeartbeat + V3 dựng từ dòng portal qua chuanHoaGiaoDich + dungLo ra ĐÚNG từng byte vector", async () => {
    const hb = thanHeartbeat({
      sessionState: "READY",
      sessionExpiresAt: "2026-10-08T08:15:00+07:00",
      sessionExpiresSource: null,
      lastSyncedAt: Date.parse("2026-10-07T10:19:30+07:00"),
      profileName: "CS1",
    });
    expect(JSON.stringify(hb)).toBe(V2_THAN);

    const v3 = JSON.parse(V3_THAN) as { transactions: unknown[] };
    const dong = chuanHoaGiaoDich(v3.transactions[0]);
    expect(dong).not.toBeNull();
    const lo = dungLo({
      syncId: "sync-20261007-102000-cs1",
      batchIndex: 0,
      final: true,
      windowFrom: "2026-10-07 08:20:00",
      windowTo: "2026-10-07 10:20:00",
      jobIds: ["cm9posjob0000000000000001"],
      transactions: dong ? [dong] : [],
    });
    const than = JSON.stringify(lo);
    expect(than).toBe(V3_THAN);
    const h = await kyYeuCau({
      agentId: AGENT_ID,
      biMat: BI_MAT,
      phuongThuc: "POST",
      duongDan: "/api/pos-agent/transactions",
      than,
      ts: "1791343203000",
      nonce: "0123456789abcdef0123456789abcdef",
    });
    expect(h["X-Agent-Sig"]).toBe(VECTOR[2].sig);
  });

  it("[EXT-KY-07] hằng số của test KHỚP chính tệp hợp đồng docs/pos-agent-api.md", () => {
    const sig = [...HOP_DONG.matchAll(/\*\*`X-Agent-Sig`\*\*\s*\|\s*\*\*`([0-9a-f]{64})`\*\*/g)].map((m) => m[1]);
    const ts = [...HOP_DONG.matchAll(/\| `X-Agent-Ts` \| `([0-9]{13})`/g)].map((m) => m[1]);
    const nonce = [...HOP_DONG.matchAll(/\| `X-Agent-Nonce` \| `([0-9a-f]{32})` \|/g)].map((m) => m[1]);
    const bam = [...HOP_DONG.matchAll(/\| SHA-256 thân \| `([0-9a-f]{64})` \|/g)].map((m) => m[1]);
    expect(sig).toEqual(VECTOR.map((v) => v.sig));
    expect(ts).toEqual(VECTOR.map((v) => v.ts));
    expect(nonce).toEqual(VECTOR.map((v) => v.nonce));
    expect(bam).toEqual(VECTOR.map((v) => v.bamThan));
    const than2 = /\*\*V2 —[^\n]*\n\n```\n([^\n]+)\n```/.exec(HOP_DONG)?.[1];
    const than3 = /\*\*V3 —[^\n]*\n[^\n]*\n\n```\n([^\n]+)\n```/.exec(HOP_DONG)?.[1];
    expect(than2).toBe(V2_THAN);
    expect(than3).toBe(V3_THAN);
    expect(HOP_DONG).toContain(`| \`agentId\` | \`${AGENT_ID}\` |`);
    expect(HOP_DONG).toContain(`\`${BI_MAT}\``);
    expect(HOP_DONG).toContain(`\`${MASTER_KEY}\``);
    expect(HOP_DONG).toContain(`\`${SAI_KHOA_HEX_DECODE}\``);
    expect(HOP_DONG).toContain(`\`${SAI_THUA_XUONG_DONG}\``);
  });

  it("[EXT-KY-08] từ chối ký đầu vào sai hợp đồng (bắt lỗi mã ngay ở extension)", async () => {
    const goc = {
      agentId: AGENT_ID,
      biMat: BI_MAT,
      phuongThuc: "GET" as const,
      duongDan: "/api/pos-agent/jobs",
      than: "",
      ts: "1791343200000",
      nonce: "5f0c1a9e2b7d4c3e8a6f1b2d3c4e5f60",
    };
    await expect(kyYeuCau({ ...goc, duongDan: "/api/pos-agent/jobs?x=1" })).rejects.toThrow();
    await expect(kyYeuCau({ ...goc, duongDan: "/api/pos-agent/jobs/" })).rejects.toThrow();
    await expect(kyYeuCau({ ...goc, duongDan: "api/pos-agent/jobs" })).rejects.toThrow();
    await expect(kyYeuCau({ ...goc, ts: "179134320000" })).rejects.toThrow();
    await expect(kyYeuCau({ ...goc, nonce: "ngan" })).rejects.toThrow();
    await expect(kyYeuCau({ ...goc, biMat: BI_MAT.toUpperCase() })).rejects.toThrow();
    await expect(kyYeuCau({ ...goc, agentId: "AGENT-HOA" })).rejects.toThrow();
    await expect(kyYeuCau({ ...goc, than: "{}" })).rejects.toThrow(); // GET phải thân rỗng
  });

  it("[EXT-KY-09] nonce: 32 hex thường, mỗi lần một giá trị mới", () => {
    const ds = Array.from({ length: 200 }, () => taoNonce());
    for (const n of ds) expect(n).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(ds).size).toBe(ds.length);
  });
});
