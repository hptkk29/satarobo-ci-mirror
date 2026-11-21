// lib/ai-lead/ky.test.ts — CHỮ KÝ HMAC của hợp đồng AI Lead: test vector V1–V3 + đối chứng ÂM NEG-1..4 + biên lệch giờ + định dạng header.
// Thuần, không DB. Vector ở tests/fixtures/ai-lead/request-response-fixtures/hmac-vectors.json (khoá GIẢ, công khai).
//
// Mã ca: [AIL-KY-01..09]. Extension/Agent ký bằng WebCrypto (`crypto.subtle`), mã này dùng `node:crypto` — hai bên PHẢI ra cùng chữ ký ([AIL-KY-02]).
import { describe, it, expect } from "vitest";
import { createHash, createHmac, webcrypto } from "node:crypto";
import { bamThan, chuoiKy, kiemDinhDangHeader, kiemHopDong, kiemLechGio, kyChuoi, soChuKy } from "./ky";
import { docHmacVectors } from "./ho-tro-test";

const vec = docHmacVectors();
const V = (ten: string) => vec.vectors.find((v) => v.ten === ten)!;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Buffer.from(b).toString("hex");

async function kyWebCrypto(khoa: string, chuoi: string): Promise<string> {
  const k = await webcrypto.subtle.importKey("raw", enc.encode(khoa), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await webcrypto.subtle.sign("HMAC", k, enc.encode(chuoi)));
}

describe("[AIL-KY-01] test vector V1–V3 (hợp đồng): từng bước ra đúng giá trị", () => {
  it.each(["V1", "V2", "V3"])("%s: băm thân → chuỗi ký → chữ ký", (ten) => {
    const v = V(ten);
    expect(Buffer.byteLength(v.body, "utf8")).toBe(v.bodyBytes);
    expect(bamThan(Buffer.from(v.body, "utf8"))).toBe(v.bodySha256);
    const chuoi = chuoiKy({ method: v.method, path: v.path, ts: v.ts, nonce: v.nonce, bamThan: bamThan(Buffer.from(v.body, "utf8")) });
    expect(chuoi).toBe(v.chuoiKy);
    expect(kyChuoi(vec.agentSecret, chuoi)).toBe(v.sig);
  });
  it("V1 là GET thân rỗng ⇒ băm của chuỗi rỗng (e3b0…b855)", () => {
    expect(V("V1").bodyBytes).toBe(0);
    expect(bamThan(new Uint8Array(0))).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
  it("chuỗi ký có ĐÚNG 4 dấu xuống dòng, không dấu cuối", () => {
    for (const v of vec.vectors) {
      expect(v.chuoiKy.split("\n")).toHaveLength(5);
      expect(v.chuoiKy.endsWith("\n")).toBe(false);
    }
  });
});

describe("[AIL-KY-02] node:crypto ≡ WebCrypto (Agent ký bằng WebCrypto)", () => {
  it.each(["V1", "V2", "V3"])("%s", async (ten) => {
    const v = V(ten);
    expect(await kyWebCrypto(vec.agentSecret, v.chuoiKy)).toBe(kyChuoi(vec.agentSecret, v.chuoiKy));
  });
});

describe("[AIL-KY-03] đối chứng ÂM NEG-1..4: cách ký SAI ra đúng chữ ký sai đã công bố — và KHÁC chữ ký đúng", () => {
  const neg = (ten: string) => vec.negatives.find((n) => n.ten.startsWith(ten))!.sig;
  const hm = (khoa: Buffer, chuoi: string) => createHmac("sha256", khoa).update(Buffer.from(chuoi, "utf8")).digest("hex");
  const sha = (s: string) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

  it("NEG-1: hex-decode secret thành 32 byte làm khoá", () => {
    const v = V("V1");
    const sai = hm(Buffer.from(vec.agentSecret, "hex"), v.chuoiKy);
    expect(sai).toBe(neg("NEG-1"));
    expect(sai).not.toBe(kyChuoi(vec.agentSecret, v.chuoiKy));
  });
  it("NEG-2: thừa \\n cuối chuỗi ký", () => {
    const v = V("V1");
    const sai = hm(Buffer.from(vec.agentSecret, "utf8"), `${v.chuoiKy}\n`);
    expect(sai).toBe(neg("NEG-2"));
    expect(sai).not.toBe(v.sig);
  });
  it("NEG-3: path thiếu tiền tố /api", () => {
    const v = V("V1");
    const chuoi = chuoiKy({ method: v.method, path: v.path.replace(/^\/api/, ""), ts: v.ts, nonce: v.nonce, bamThan: v.bodySha256 });
    const sai = kyChuoi(vec.agentSecret, chuoi);
    expect(sai).toBe(neg("NEG-3"));
    expect(sai).not.toBe(v.sig);
  });
  it("NEG-4: băm bản thụt lề (null, 2) nhưng gửi bản compact", () => {
    const v = V("V2");
    const thut = JSON.stringify(JSON.parse(v.body), null, 2);
    const sai = kyChuoi(vec.agentSecret, chuoiKy({ method: v.method, path: v.path, ts: v.ts, nonce: v.nonce, bamThan: sha(thut) }));
    expect(sai).toBe(neg("NEG-4"));
    expect(sai).not.toBe(v.sig);
  });
  it("chữ ký sai không trùng chữ ký đúng nào", () => {
    const dung = new Set(vec.vectors.map((v) => v.sig));
    for (const n of vec.negatives) expect(dung.has(n.sig), n.ten).toBe(false);
  });
});

describe("[AIL-KY-04] soChuKy: thời gian hằng, không phân biệt hoa thường, khác độ dài ⇒ false (không ném)", () => {
  const dung = V("V1").sig;
  it("bằng / khác / khác độ dài / hoa thường", () => {
    expect(soChuKy(dung, dung)).toBe(true);
    expect(soChuKy(dung.toUpperCase(), dung)).toBe(true);
    expect(soChuKy(dung, dung.replace(/^./, dung[0] === "0" ? "1" : "0"))).toBe(false);
    expect(soChuKy(dung, dung.slice(0, 63))).toBe(false);
    expect(soChuKy("", dung)).toBe(false);
    expect(soChuKy(dung, "")).toBe(false);
  });
});

describe("[AIL-KY-05] lệch giờ: ĐÚNG ngưỡng vẫn qua, ngưỡng + 1 ms thì không", () => {
  const now = 1_793_000_000_000;
  it("ngưỡng mặc định 300 000 ms (hai chiều)", () => {
    expect(kiemLechGio(now - 300_000, now, 300_000)).toBe(true);
    expect(kiemLechGio(now + 300_000, now, 300_000)).toBe(true);
    expect(kiemLechGio(now - 300_001, now, 300_000)).toBe(false);
    expect(kiemLechGio(now + 300_001, now, 300_000)).toBe(false);
    expect(kiemLechGio(now, now, 300_000)).toBe(true);
  });
  it("ngưỡng là THAM SỐ: đổi ngưỡng đổi kết quả (không có hằng ẩn)", () => {
    expect(kiemLechGio(now - 100_000, now, 60_000)).toBe(false);
    expect(kiemLechGio(now - 100_000, now, 120_000)).toBe(true);
  });
});

describe("[AIL-KY-06] kiemDinhDangHeader: bốn header ký, theo tên X-AiLead-*", () => {
  const v = V("V3");
  const header = (o: Partial<Record<string, string>> = {}) => {
    const m: Record<string, string> = {
      "x-ailead-agent": vec.agentId,
      "x-ailead-ts": v.ts,
      "x-ailead-nonce": v.nonce,
      "x-ailead-sig": v.sig,
      "x-ailead-contract": "1",
      ...o,
    };
    return (ten: string) => (ten in m ? m[ten]! : null);
  };
  it("đầy đủ ⇒ ok, chữ ký hạ chữ thường, ts đổi thành số", () => {
    const r = kiemDinhDangHeader(header({ "x-ailead-sig": v.sig.toUpperCase() }));
    expect(r).toEqual({ ok: true, agentId: vec.agentId, ts: v.ts, tsMs: Number(v.ts), nonce: v.nonce, sig: v.sig });
  });
  it.each([
    ["agent quá ngắn", { "x-ailead-agent": "abc" }, "X-AiLead-Agent"],
    ["agent có chữ hoa", { "x-ailead-agent": "CM9ailagenttest00000001" }, "X-AiLead-Agent"],
    ["ts 12 chữ số", { "x-ailead-ts": "179300000000" }, "X-AiLead-Ts"],
    ["ts có chữ", { "x-ailead-ts": "17930000000a0" }, "X-AiLead-Ts"],
    ["nonce 15 ký tự", { "x-ailead-nonce": "a".repeat(15) }, "X-AiLead-Nonce"],
    ["nonce có dấu cách", { "x-ailead-nonce": "a".repeat(15) + " " }, "X-AiLead-Nonce"],
    ["sig 63 ký tự", { "x-ailead-sig": "a".repeat(63) }, "X-AiLead-Sig"],
    ["sig không phải hex", { "x-ailead-sig": "g".repeat(64) }, "X-AiLead-Sig"],
  ])("sai định dạng: %s", (_t, o, ten) => {
    expect(kiemDinhDangHeader(header(o))).toEqual({ ok: false, loi: ten });
  });
  it("thiếu header ⇒ lỗi đúng tên; KHÔNG đọc nhầm header của POS (X-Agent-*)", () => {
    const doc = (t: string) => ({ "x-agent-id": vec.agentId, "x-agent-ts": v.ts, "x-agent-nonce": v.nonce, "x-agent-sig": v.sig } as Record<string, string>)[t] ?? null;
    expect(kiemDinhDangHeader(doc)).toEqual({ ok: false, loi: "X-AiLead-Agent" });
  });
  it("thứ tự báo lỗi: agent → ts → nonce → sig (header đầu tiên sai thắng)", () => {
    expect(kiemDinhDangHeader(header({ "x-ailead-agent": "x", "x-ailead-ts": "x" }))).toEqual({ ok: false, loi: "X-AiLead-Agent" });
    expect(kiemDinhDangHeader(header({ "x-ailead-ts": "x", "x-ailead-sig": "x" }))).toEqual({ ok: false, loi: "X-AiLead-Ts" });
  });
  it("kết quả lỗi KHÔNG chứa giá trị header (có thể là bí mật)", () => {
    const r = kiemDinhDangHeader(header({ "x-ailead-sig": "BI-MAT-KHONG-DUOC-LO" }));
    expect(JSON.stringify(r)).not.toContain("BI-MAT");
  });
});

describe("[AIL-KY-07] kiemHopDong (bước 2): đúng '1' mới qua — vắng hoặc khác đều UNSUPPORTED_CONTRACT", () => {
  it("1 ⇒ qua; 2, '', ' 1', '01', vắng ⇒ không", () => {
    const doc = (v: string | null) => (ten: string) => (ten === "x-ailead-contract" ? v : null);
    expect(kiemHopDong(doc("1"))).toBe(true);
    for (const x of ["2", "", " 1", "01", "1.0", null]) expect(kiemHopDong(doc(x)), String(x)).toBe(false);
  });
});
