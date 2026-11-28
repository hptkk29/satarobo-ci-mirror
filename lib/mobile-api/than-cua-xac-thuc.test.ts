import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { THAN_TOI_DA_BYTE, docThanJson } from "./cong";

/**
 * [SEC03] TRẦN THÂN YÊU CẦU cho các route CỬA XÁC THỰC (login/refresh/logout + 4 OTP — người gọi CHƯA có token). Bản cũ `docThanJson` gọi `req.json()` không trần.
 *   [SEC03-01] thân lớn khai qua Content-Length ⇒ 413 PAYLOAD_TOO_LARGE, KHÔNG đọc thân
 *   [SEC03-02] thân dạng LUỒNG không khai độ dài (chunked) vượt trần ⇒ 413 — đọc dừng khi vượt, không nuốt cả thân
 *   [SEC03-03] biên: đúng trần thì qua lớp chặn; thân hợp lệ nhỏ ⇒ ok; JSON hỏng / sai lược đồ ⇒ 400 VALIDATION (hành vi cũ giữ nguyên)
 *   [SEC03-04] ghim nguồn: `docThanJson` KHÔNG còn gọi `.json()` trực tiếp và đi qua cả hai lớp chặn
 */
const schema = z.object({ a: z.string().max(50_000).optional(), n: z.number().int().optional() });
const URL_X = "http://localhost/api/mobile/v1/auth/login";
const post = (body: BodyInit | null, headers: Record<string, string> = {}, extra: RequestInit = {}) => new Request(URL_X, { method: "POST", headers: { "content-type": "application/json", ...headers }, body, ...extra });
const maLoi = async (r: { ok: false; res: Response }) => ({ s: r.res.status, c: ((await r.res.json()) as { error?: { code?: string } }).error?.code });

describe("[SEC03] trần thân yêu cầu của cửa xác thực", () => {
  it("[SEC03-01] thân lớn khai qua Content-Length ⇒ 413, không đọc thân", async () => {
    const lon = JSON.stringify({ a: "x".repeat(THAN_TOI_DA_BYTE + 10) });
    const r = await docThanJson(post(lon), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(await maLoi(r)).toEqual({ s: 413, c: "PAYLOAD_TOO_LARGE" });
    // Content-Length khai tay (không cần thân thật): bị chặn TRƯỚC khi chạm tới thân
    let soRut = 0;
    const thanTheoDoi = new ReadableStream<Uint8Array>({ pull(c) { soRut++; c.enqueue(new TextEncoder().encode("{}")); } });
    const yeuCau = post(thanTheoDoi, { "content-length": String(THAN_TOI_DA_BYTE + 1) }, { duplex: "half" } as RequestInit);
    await new Promise((r) => setTimeout(r, 20)); // để constructor của Request rút xong phần của nó
    const truoc = soRut; // ta chỉ đo số lần rút do `docThanJson` gây ra
    const r2 = await docThanJson(yeuCau, schema);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.res.status).toBe(413);
    expect(soRut).toBe(truoc);
  });

  it("[SEC03-02] thân dạng luồng không khai độ dài vượt trần ⇒ 413; đọc dừng khi vượt", async () => {
    const mot = new TextEncoder().encode('{"a":"' + "y".repeat(8_192));
    let daBom = 0;
    const luong = new ReadableStream<Uint8Array>({
      pull(c) {
        // bơm mãi (kẻ tấn công không dừng); nếu đọc không có trần thì vòng này không bao giờ kết thúc
        if (daBom > THAN_TOI_DA_BYTE * 4) { c.close(); return; }
        daBom += mot.byteLength;
        c.enqueue(mot);
      },
    });
    const r = await docThanJson(post(luong, {}, { duplex: "half" } as RequestInit), schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(await maLoi(r)).toEqual({ s: 413, c: "PAYLOAD_TOO_LARGE" });
    expect(daBom).toBeLessThan(THAN_TOI_DA_BYTE * 2); // dừng ngay sau khi vượt trần, không nuốt cả luồng
  });

  it("[SEC03-03] biên + hành vi cũ: thân nhỏ hợp lệ ok; ngay dưới trần qua; JSON hỏng/sai lược đồ ⇒ 400", async () => {
    const ok = await docThanJson(post(JSON.stringify({ n: 5 })), schema);
    expect(ok).toEqual({ ok: true, data: { n: 5 } });
    const gan = JSON.stringify({ a: "z".repeat(40_000) }); // ≪ trần, ≤ max của lược đồ
    expect((await docThanJson(post(gan), schema)).ok).toBe(true);
    const hong = await docThanJson(post("{không-phải-json"), schema);
    expect(hong.ok).toBe(false);
    if (!hong.ok) expect(await maLoi(hong)).toEqual({ s: 400, c: "VALIDATION" });
    const rong = await docThanJson(post(""), schema);
    expect(rong.ok).toBe(false);
    if (!rong.ok) expect((await maLoi(rong)).s).toBe(400);
    const sai = await docThanJson(post(JSON.stringify({ n: "không-phải-số" })), schema);
    expect(sai.ok).toBe(false);
    if (!sai.ok) expect(await maLoi(sai)).toEqual({ s: 400, c: "VALIDATION" });
  });

  it("[SEC03-04] ghim nguồn: docThanJson không gọi .json() trực tiếp, đi qua chanThanQuaLon + đọc có trần", () => {
    const src = readFileSync(resolve(process.cwd(), "lib/mobile-api/cong.ts"), "utf8").replace(/\r\n/g, "\n");
    const i = src.indexOf("export async function docThanJson");
    const ham = src.slice(i, src.indexOf("\n}\n", i) + 3).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(i).toBeGreaterThan(-1);
    expect(ham).not.toMatch(/\.json\(\)/);
    expect(ham).toMatch(/chanThanQuaLon\(req\)/);
    expect(ham).toMatch(/docThanCoTran\(req, schema\)/);
  });
});
