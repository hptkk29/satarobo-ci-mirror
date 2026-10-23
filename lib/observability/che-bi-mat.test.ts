// @vitest-environment node
/**
 * Bộ che bí mật dùng cho Sentry (server + edge + client).
 * Hình dạng sự kiện chép theo thứ Sentry v10 thật sự gửi: ErrorEvent.request
 * (url, query_string dạng chuỗi / object / mảng cặp, headers), breadcrumb `fetch`
 * (data.url), span http (`url.full`, `http.query`, description).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { DA_CHE, cheChuoi, cheSauBiMat, laTenNhayCam } from "./che-bi-mat";

const KHOA = "khoa-bi-mat-ben-ngoai-123456";

describe("[CBM-01] cheChuoi — tham số query nhạy cảm", () => {
  it.each([
    ["https://h/api/auth?apiKey=abc", "https://h/api/auth?apiKey=[REDACTED]"],
    ["https://h/x?a=1&secret=s3&b=2", "https://h/x?a=1&secret=[REDACTED]&b=2"],
    ["/api/webhooks/google-form?SECRET=s", "/api/webhooks/google-form?SECRET=[REDACTED]"],
    ["api_key=k&token=t", "api_key=[REDACTED]&token=[REDACTED]"],
    ["?access_token=zz#frag", "?access_token=[REDACTED]#frag"],
    ["Failed to parse URL from https://h/api/auth?apiKey=k1 x", "Failed to parse URL from https://h/api/auth?apiKey=[REDACTED] x"],
  ])("%s", (vao, ra) => {
    expect(cheChuoi(vao)).toBe(ra);
  });

  it("không đụng tham số vô hại có tên CHỨA chữ nhạy cảm", () => {
    expect(cheChuoi("?hook_type=call&tokenizer=on&page=1")).toBe("?hook_type=call&tokenizer=on&page=1");
  });

  it("che `Bearer …`", () => {
    expect(cheChuoi("Authorization: Bearer eyJ0eXAi.abc-def_ghi=")).toBe(`Authorization: Bearer ${DA_CHE}`);
  });

  it("che giá trị bí mật CỤ THỂ ở bất kỳ đâu (cả dạng mã hoá URL)", () => {
    expect(cheChuoi(`boom ${KHOA}`, [KHOA])).toBe(`boom ${DA_CHE}`);
    const kyTuDac = "a+b/c=d&e f-12345";
    expect(cheChuoi(`x=${encodeURIComponent(kyTuDac)}`, [kyTuDac])).toBe(`x=${DA_CHE}`);
  });

  it("bỏ qua giá trị bí mật quá ngắn (tránh thay nhầm)", () => {
    expect(cheChuoi("abc abc", ["abc"])).toBe("abc abc");
  });
});

describe("[CBM-02] tên nhạy cảm", () => {
  it.each(["x-webhook-secret", "X-Webhook-Secret", "x-api-key", "X-Api-Key", "Authorization", "cookie", "apiKey", "api_key", "secret", "token", "password"])(
    "%s",
    (ten) => expect(laTenNhayCam(ten)).toBe(true),
  );
  it("tên thường không bị coi là nhạy cảm", () => {
    expect(laTenNhayCam("content-type")).toBe(false);
    expect(laTenNhayCam("x-request-id")).toBe(false);
  });
});

describe("[CBM-03] cheSauBiMat — sự kiện Sentry", () => {
  it("ErrorEvent từ route webhook: url + query_string + headers", () => {
    const ev = {
      message: "lỗi xử lý webhook",
      request: {
        url: "https://satarobo.vn/api/webhooks/google-form?secret=bi-mat-webhook",
        query_string: "secret=bi-mat-webhook&x=1",
        headers: {
          "x-webhook-secret": "h1-bi-mat",
          "X-Api-Key": "h2-bi-mat",
          "x-api-key": "h4-bi-mat",
          "content-type": "application/json",
        },
      },
    };
    const ra = cheSauBiMat(ev);
    expect(ra).toBe(ev); // sửa tại chỗ, cùng tham chiếu
    const s = JSON.stringify(ra);
    for (const bm of ["bi-mat-webhook", "h1-bi-mat", "h2-bi-mat", "h4-bi-mat"]) {
      expect(s).not.toContain(bm);
    }
    expect(ra.request.headers["content-type"]).toBe("application/json");
    expect(ra.request.query_string).toBe("secret=[REDACTED]&x=1");
  });

  it("query_string dạng object và dạng mảng cặp", () => {
    const a = { request: { query_string: { secret: "s-1", apiKey: "k-1", page: "2" } } };
    cheSauBiMat(a);
    expect(a.request.query_string).toEqual({ secret: DA_CHE, apiKey: DA_CHE, page: "2" });

    const b = { request: { query_string: [["apiKey", "k-2"], ["page", "1"]] } };
    cheSauBiMat(b);
    expect(b.request.query_string).toEqual([["apiKey", DA_CHE], ["page", "1"]]);
  });

  it("span http: url.full, http.query, description", () => {
    const span = {
      description: `GET https://api.vi-du.com/api/auth?apiKey=${KHOA}`,
      data: {
        "url.full": `https://api.vi-du.com/api/auth?apiKey=${KHOA}`,
        "http.query": `?apiKey=${KHOA}`,
        "http.method": "GET",
      },
    };
    cheSauBiMat(span, [KHOA]);
    expect(JSON.stringify(span)).not.toContain(KHOA);
    expect(span.data["http.method"]).toBe("GET");
  });

  it("transaction: spans lồng sâu cũng bị che; object vòng không làm treo", () => {
    const vong: Record<string, unknown> = { name: "vòng" };
    vong.self = vong;
    const tx = {
      spans: [{ data: { "url.full": "https://h/x?token=t-bi-mat" } }],
      extra: { vong },
      contexts: { cfg: { password: "p-bi-mat" } },
    };
    cheSauBiMat(tx);
    const s = JSON.stringify(tx, (k, v: unknown) => (k === "self" ? undefined : v));
    expect(s).not.toContain("t-bi-mat");
    expect(s).not.toContain("p-bi-mat");
  });

  it("object đóng băng không làm bộ che ném", () => {
    const ev = Object.freeze({ request: Object.freeze({ url: "https://h?secret=s" }) });
    expect(() => cheSauBiMat(ev)).not.toThrow();
  });
});

describe("[CBM-05] cấu hình Sentry thật sự CẮM bộ che (lưới ghim mã nguồn)", () => {
  // Bộ che chỉ có tác dụng nếu các hook của Sentry gọi nó. Test hành vi ở trên xanh
  // mãi dù không file cấu hình nào cắm — nên ghim chính lời gọi (luật 11: neo vào
  // LỜI GỌI `cheSauBiMat(`, không vào dòng import).
  const doc = (p: string) =>
    readFileSync(resolve(process.cwd(), p), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it.each([
    ["sentry.server.config.ts", ["beforeSend", "beforeSendTransaction", "beforeSendSpan", "beforeBreadcrumb"]],
    ["sentry.edge.config.ts", ["beforeSend", "beforeSendTransaction", "beforeSendSpan", "beforeBreadcrumb"]],
    ["instrumentation-client.ts", ["beforeSend", "beforeBreadcrumb"]],
  ] as const)("%s", (tep, hooks) => {
    const src = doc(tep);
    const RE_HOOK = /\b(beforeSend|beforeSendTransaction|beforeSendSpan|beforeBreadcrumb)\(/g;
    const moc = [...src.matchAll(RE_HOOK)].map((m) => ({ ten: m[1], viTri: m.index ?? 0 }));
    for (const h of hooks) {
      const dsHook = moc.filter((m) => m.ten === h);
      expect(dsHook.length, `${tep}: phải khai đúng một ${h}(`).toBe(1);
      const batDau = dsHook[0]!.viTri;
      const ke = moc.find((m) => m.viTri > batDau);
      const doan = src.slice(batDau, ke ? ke.viTri : undefined);
      expect(doan, `${tep}: ${h} phải gọi cheSauBiMat(`).toContain("cheSauBiMat(");
    }
  });
});
