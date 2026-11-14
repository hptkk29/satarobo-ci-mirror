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

describe("[AIL-SEN-03] AI Lead Gateway: tên nhạy cảm theo danh sách", () => {
  it.each(["x-ailead-sig", "X-AiLead-Sig", "x-ailead-nonce", "X-AiLead-Agent", "psid", "fbName", "phoneRaw", "phoneCanonical", "agentSecret"])("%s", (ten) =>
    expect(laTenNhayCam(ten)).toBe(true),
  );
  it("đối chứng: header hợp đồng và trường định tuyến KHÔNG bị che", () => {
    expect(laTenNhayCam("x-ailead-contract")).toBe(false);
    expect(laTenNhayCam("campusCode")).toBe(false);
    expect(laTenNhayCam("pageId")).toBe(false);
  });
  it("[AIL-SEN-04] cheSauBiMat: header + thân của một sự kiện cổng AI Lead", () => {
    const ev = {
      request: {
        url: "https://admin.satarobo.vn/api/ai-lead-agent/v1/heartbeats",
        headers: { "X-AiLead-Sig": "sig-bi-mat-1", "x-ailead-agent": "agent-bi-mat-2", "x-ailead-contract": "1" },
        data: { psid: "psid-bi-mat-3", fbName: "ten-bi-mat-4", phoneRaw: "sdt-bi-mat-5", environment: "TEST" },
      },
    };
    const ra = cheSauBiMat(ev);
    const chuoi = JSON.stringify(ra);
    for (const v of ["sig-bi-mat-1", "agent-bi-mat-2", "psid-bi-mat-3", "ten-bi-mat-4", "sdt-bi-mat-5"]) expect(chuoi, v).not.toContain(v);
    expect(ra.request.headers["x-ailead-contract"]).toBe("1");
    expect(ra.request.data.environment).toBe("TEST");
  });
});

describe("[DISC-SEN-02] DISC: tên khoá hồ sơ trẻ/phụ huynh bị che (F-14)", () => {
  // Bộ này so `toLowerCase()` mà KHÔNG bỏ `_` ⇒ đưa vào CAMELCASE đúng như schema/payload để bắt lỗi "viết camelCase trong tập chữ thường".
  const KHOA_DISC = [
    "soDienThoai", "phoneKey", "emailTo", "birthYear", "namSinh", "namSinhCon", "tenPhuHuynh", "tenCon", "traLoi", "otp",
    "reportSnapshot", "downloadTokenHash", "claimCodeHash", "maNhan", "tokenTai",
  ] as const;
  // P1: khoá CHUNG chỉ che trong sự kiện thuộc đường DISC.
  const KHOA_CHUNG = ["fullName", "hoTen", "email", "result", "ketQua", "diem", "tomTat"] as const;

  it.each(KHOA_DISC)("%s: che MỌI NƠI", (khoa) => expect(laTenNhayCam(khoa)).toBe(true));
  it.each(KHOA_CHUNG)("%s: KHÔNG che toàn app, chỉ che trong đường DISC (P1)", (khoa) => {
    expect(laTenNhayCam(khoa)).toBe(false);
    expect(laTenNhayCam(khoa, true)).toBe(true);
  });

  it("đối chứng dương: tên trường kỹ thuật KHÔNG bị che", () => {
    for (const t of ["requestId", "submissionId", "status", "route", "claimStatus", "emailStatus"]) expect(laTenNhayCam(t), t).toBe(false);
  });

  it("cheSauBiMat: object hồ sơ lồng trong sự kiện — giá trị biến mất, trường kỹ thuật còn", () => {
    const ev = {
      extra: { data: { tenPhuHuynh: "gia-ten-be", phoneKey: "gia-khoa-sdt", subjects: [{ birthYear: 2015, traLoi: { q1: 9 } }] }, submissionId: "sub-1" },
    };
    const chuoi = JSON.stringify(cheSauBiMat(ev));
    for (const v of ["gia-ten-be", "gia-khoa-sdt", "2015", '"q1":9']) expect(chuoi, v).not.toContain(v);
    expect(chuoi).toContain("sub-1");
  });
});

describe("[DISC-SEN-03] P1: khoá chung (email · result · diem · ketQua · họ tên) KHÔNG bị che ngoài đường DISC", () => {
  const nguoiKhac = () => ({
    request: { url: "https://admin.satarobo.vn/orders/abc", data: { email: "khach-gia@example.test", result: "ok", diem: 7, ketQua: "dat", fullName: "Nguyen Gia", hoTen: "Nguyen Gia", tomTat: "ts" } },
    extra: { email: "khach-gia@example.test", result: "ok" },
  });
  it("sự kiện của module khác giữ nguyên dữ liệu điều tra", () => {
    const ra = cheSauBiMat(nguoiKhac());
    expect(ra.request.data).toEqual({ email: "khach-gia@example.test", result: "ok", diem: 7, ketQua: "dat", fullName: "Nguyen Gia", hoTen: "Nguyen Gia", tomTat: "ts" });
    expect(ra.extra).toEqual({ email: "khach-gia@example.test", result: "ok" });
  });
  it.each([
    ["request.url /api/disc/luu", { request: { url: "https://satarobo.vn/api/disc/luu", data: { email: "khach-gia@example.test", result: "r", fullName: "n" } } }],
    ["request.url /disc/ket-qua", { request: { url: "/disc/ket-qua?x=1", data: { email: "khach-gia@example.test", result: "r", fullName: "n" } } }],
    ["request.url /portal/disc/abc", { request: { url: "https://hocvien.satarobo.vn/portal/disc/abc", data: { email: "khach-gia@example.test", result: "r", fullName: "n" } } }],
    ["transaction", { transaction: "POST /api/disc/luu", extra: { email: "khach-gia@example.test", result: "r", fullName: "n" } }],
    ["span.description", { description: "GET /api/disc/tai", data: { email: "khach-gia@example.test", result: "r", fullName: "n" } }],
  ])("đường DISC (%s) ⇒ khoá chung bị che", (_ten, ev) => {
    const chuoi = JSON.stringify(cheSauBiMat(structuredClone(ev)));
    expect(chuoi).not.toContain("khach-gia@example.test");
    expect(chuoi).toContain("[REDACTED]");
  });
  it("đối chứng: '/discount', '/disco' KHÔNG phải đường DISC", () => {
    const ra = cheSauBiMat({ request: { url: "https://satarobo.vn/discount/1", data: { email: "khach-gia@example.test" } } });
    expect(ra.request.data.email).toBe("khach-gia@example.test");
  });
  it("khoá ĐẶC THÙ DISC che dù KHÔNG phải đường DISC (traLoi · otp · namSinhCon · tokenTai · tenPhuHuynh · tenCon)", () => {
    const ra = cheSauBiMat({ extra: { traLoi: { q1: 4 }, otp: "123456", namSinhCon: 2015, tokenTai: "tok-gia-1234", tenPhuHuynh: "Phu Huynh Gia", tenCon: "Be Gia", requestId: "r1" } });
    const chuoi = JSON.stringify(ra);
    for (const v of ['"q1":4', "123456", "2015", "tok-gia-1234", "Phu Huynh Gia", "Be Gia"]) expect(chuoi, v).not.toContain(v);
    expect(chuoi).toContain("r1");
  });
  it("?t= của liên kết xác minh email DISC bị che (tên 't' quá ngắn để che toàn app), t= ở nơi khác thì KHÔNG", () => {
    const tok = "abcDEF123_-token-gia-xyz";
    expect(cheSauBiMat(`https://satarobo.vn/disc/xac-minh-email?t=${tok}`)).not.toContain(tok);
    expect(cheSauBiMat(`https://satarobo.vn/disc/xac-minh-email?x=1&t=${tok}`)).not.toContain(tok);
    expect(cheSauBiMat("https://satarobo.vn/tim-kiem?t=abc123")).toContain("t=abc123");
  });
});
