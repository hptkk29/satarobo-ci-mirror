// @vitest-environment node
/**
 * Bộ lọc bí mật cho Sentry ("log ứng dụng và Sentry KHÔNG chứa token, khoá…"). Hàm THUẦN —
 * chạy trong `pnpm test:unit`.
 *
 * 02/10/2026 — gỡ Cổng dữ liệu agent: bỏ các ca canh tiền tố khoá riêng của cổng
 * (`srk_`/`sra_`/`srm_`/`srs_`, [CBM-00]/[CBM-01] cũ) vì không còn gì sinh ra chúng. Bí mật mẫu
 * nay sinh bằng `randomBytes` ngay tại đây; các ca còn lại canh đúng luật cũ.
 *
 * Mã ca: [CBM-02..11] (hàm che + lọc sự kiện) · [CBM-W1..W2] (lưới dây nối ba tệp cấu hình Sentry).
 */
import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CHO_CHE,
  cheBiMat,
  locBreadcrumbSentry,
  locSuKienSentry,
} from "./che-bi-mat";

/**
 * Chuỗi ngẫu nhiên — hình dạng của token/mã ủy quyền thật. Hex (không base64url) vì bảng ký tự
 * Bearer theo RFC 6750 không có `_`: mẫu che Bearer dừng ở `_` là đúng chuẩn, không phải lỗ.
 */
function ngauNhien(soByte = 32): string {
  return randomBytes(soByte).toString("hex");
}

describe("cheBiMat — che chuỗi", () => {
  it("[CBM-02] che giá trị Authorization Bearer/Basic — kể cả token KHÔNG mang tiền tố", () => {
    const basic = Buffer.from(`client-x:${ngauNhien()}`).toString("base64");
    const lau = ngauNhien(18);
    const ra = cheBiMat(`authorization: Basic ${basic} | Authorization: Bearer ${lau} | bearer ${lau}`);
    expect(ra).not.toContain(basic);
    expect(ra).not.toContain(lau);
    expect(ra).toBe(`authorization: Basic ${CHO_CHE} | Authorization: Bearer ${CHO_CHE} | bearer ${CHO_CHE}`);
  });

  it("[CBM-03] che tham số OAuth trên URL/thân form và trong JSON (code, code_verifier, refresh_token, client_secret…)", () => {
    const code = ngauNhien();
    const ver = ngauNhien();
    const url = `http://127.0.0.1:33418/callback?code=${code}&state=st-1&iss=https%3A%2F%2Fsatarobo.vn`;
    const ra = cheBiMat(url);
    expect(ra).not.toContain(code);
    expect(ra).toContain("state=st-1"); // state không bí mật — giữ để điều tra
    const form = `grant_type=authorization_code&code=${code}&code_verifier=${ver}&client_id=mcc_x`;
    const raForm = cheBiMat(form);
    expect(raForm).not.toContain(code);
    expect(raForm).not.toContain(ver);
    expect(raForm).toContain("grant_type=authorization_code");
    const json = JSON.stringify({ code, code_verifier: ver, client_secret: "abc-khong-tien-to", password: "Mk@12345" });
    const raJson = cheBiMat(json);
    for (const v of [code, ver, "abc-khong-tien-to", "Mk@12345"]) expect(raJson).not.toContain(v);
  });

  it("[CBM-04] KHÔNG che chuỗi thường: mã yêu cầu, mã Prisma, văn xuôi", () => {
    const giu = [
      "ma_yeu_cau req_AbCdEf123456",
      "token phải gửi trong header Authorization",
      "PrismaClientKnownRequestError P2002 Unique constraint failed",
      "exit code 1",
      "[thanh-toan] lỗi { buoc: 'doi_soat' }",
    ];
    for (const s of giu) expect(cheBiMat(s), s).toBe(s);
  });
});

describe("locSuKienSentry / locBreadcrumbSentry — che trên cả sự kiện", () => {
  it("[CBM-05] message, exception.value, request (headers, cookies, data dạng chuỗi lẫn object, query_string, url), extra, contexts, tags, breadcrumbs lồng trong sự kiện", () => {
    const tok = ngauNhien();
    const ref = ngauNhien();
    const code = ngauNhien();
    const sec = ngauNhien();
    const suKien = {
      message: `không đổi được Bearer ${tok}`,
      exception: { values: [{ type: "Error", value: `gọi lỗi refresh_token=${ref}`, stacktrace: { frames: [{ vars: { token: tok } }] } }] },
      request: {
        url: `https://satarobo.vn/api/x/authorize?code=${code}`,
        query_string: `refresh_token=${ref}&x=1`,
        headers: { Authorization: `Bearer ${tok}`, cookie: "sr-phien=abc", "X-SR-Signature": "v1=deadbeef", "user-agent": "curl/8" },
        cookies: { "sr-phien": "abc" },
        data: { grant_type: "refresh_token", refresh_token: ref, code, client_secret: sec, ghi_chu: `xem Basic ${sec}` },
      },
      extra: { secret: sec, lop: { sau: { nua: [`Bearer ${tok}`] } } },
      contexts: { tichHop: { token: tok } },
      tags: { tt: `access_token=${tok}` },
      breadcrumbs: [{ category: "console", message: `log Bearer ${tok}`, data: { arguments: [`Bearer ${ref}`] } }],
    };
    const ra = locSuKienSentry(suKien);
    const chuoi = JSON.stringify(ra);
    for (const v of [tok, ref, code, sec, "sr-phien=abc", "deadbeef"]) expect(chuoi, v).not.toContain(v);
    expect(ra.request?.headers?.["user-agent"]).toBe("curl/8"); // header vô hại giữ nguyên
    expect((ra.request?.data as Record<string, unknown>).grant_type).toBe("refresh_token");
    expect(ra.request?.cookies).toBeUndefined();
  });

  it("[CBM-06] request.data là CHUỖI (thân form thô) cũng được che", () => {
    const code = ngauNhien();
    const ver = ngauNhien();
    const ra = locSuKienSentry({ request: { data: `grant_type=authorization_code&code=${code}&code_verifier=${ver}` } });
    expect(String(ra.request?.data)).not.toContain(code);
    expect(String(ra.request?.data)).not.toContain(ver);
  });

  it("[CBM-07] breadcrumb: message + data (url điều hướng mang code=, đối số console) được che; breadcrumb vô hại giữ nguyên", () => {
    const tok = ngauNhien();
    const code = ngauNhien();
    const bc = locBreadcrumbSentry({
      category: "navigation",
      message: `đi tới Bearer ${tok}`,
      data: { from: "/login", to: `http://127.0.0.1:1/cb?code=${code}`, arguments: [`Bearer ${tok}`] },
    });
    const chuoi = JSON.stringify(bc);
    for (const v of [tok, code]) expect(chuoi).not.toContain(v);
    expect(bc?.data?.from).toBe("/login");
    const vo = { category: "ui.click", message: "button#luu" };
    expect(locBreadcrumbSentry({ ...vo })).toEqual(vo);
  });

  it("[CBM-08] không vỡ trên dữ liệu lạ: vòng tham chiếu, lồng rất sâu, số/null/Date, sự kiện rỗng", () => {
    const khoa = `Bearer ${ngauNhien()}`;
    const vong: Record<string, unknown> = { a: khoa };
    vong.tu = vong;
    let sau: Record<string, unknown> = { la: `Bearer ${ngauNhien()}` };
    for (let i = 0; i < 50; i++) sau = { con: sau };
    const ra = locSuKienSentry({ extra: { vong, sau, so: 1, rong: null, luc: new Date(0) } });
    // Sửa TẠI CHỖ: chính object vòng đã được che.
    expect(vong.a).toBe(`Bearer ${CHO_CHE}`);
    expect(vong.tu).toBe(vong);
    expect((ra.extra as Record<string, unknown>).so).toBe(1);
    expect((ra.extra as Record<string, unknown>).luc).toEqual(new Date(0));
    expect(locSuKienSentry({})).toEqual({});
  });

  it("[CBM-09] lồng sâu quá trần ⇒ nhánh bị THAY bằng chỗ che (fail closed), không để lọt khoá ở tầng sâu", () => {
    // Chuỗi KHÔNG khớp mẫu nào ở tầng sâu — chỉ trần độ sâu mới che được nó.
    const khoa = ngauNhien();
    let sau: unknown = khoa;
    for (let i = 0; i < 60; i++) sau = [sau];
    const ra = locSuKienSentry({ extra: { sau } });
    expect(JSON.stringify(ra)).not.toContain(khoa.slice(-20));
  });
});

describe("locSuKienSentry — các hình dạng còn lại (rà đối kháng 29/09)", () => {
  it("[CBM-10] request.query_string dạng MẢNG CẶP [khoá, giá trị] (kiểu QueryParams của SDK): giá trị của khoá nhạy cảm bị che dù không tiền tố", () => {
    const code = ngauNhien();
    const ver = ngauNhien();
    const ra = locSuKienSentry({ request: { query_string: [["code", code], ["code_verifier", ver], ["state", "st-1"]] } });
    const chuoi = JSON.stringify(ra);
    expect(chuoi).not.toContain(code);
    expect(chuoi).not.toContain(ver);
    expect(chuoi).toContain("st-1");
  });

  it("[CBM-11] khoá object mang bí mật tiếng Việt (biMat, maXacThuc, matKhau) bị che ở MỌI chỗ", () => {
    const ra = locSuKienSentry({ extra: { biMat: "JBSWY3DPEHPK3PXP", maXacThuc: "123456", matKhau: "Mk@12345", ten: "giữ" } });
    const chuoi = JSON.stringify(ra);
    for (const v of ["JBSWY3DPEHPK3PXP", "123456", "Mk@12345"]) expect(chuoi, v).not.toContain(v);
    expect(chuoi).toContain("giữ");
  });
});

// ─── Lưới dây nối: ba nơi Sentry.init phải cắm bộ lọc ─────────────────────────────────────────
function boChuThich(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("[CBM-W] dây nối bộ lọc vào cấu hình Sentry", () => {
  const TEP = ["sentry.server.config.ts", "sentry.edge.config.ts", "instrumentation-client.ts"];

  it("[CBM-W1] cả ba tệp gọi locSuKienSentry trong beforeSend VÀ locBreadcrumbSentry trong beforeBreadcrumb (đúng một lần mỗi thứ)", () => {
    for (const t of TEP) {
      const src = boChuThich(readFileSync(resolve(process.cwd(), t), "utf8"));
      expect(src.match(/beforeSend\s*[(:]/g)?.length ?? 0, `${t}: beforeSend`).toBe(1);
      expect(src.match(/locSuKienSentry\(/g)?.length ?? 0, `${t}: lời gọi locSuKienSentry(`).toBe(1);
      expect(src.match(/beforeBreadcrumb\s*[(:]/g)?.length ?? 0, `${t}: beforeBreadcrumb`).toBe(1);
      expect(src.match(/locBreadcrumbSentry\(/g)?.length ?? 0, `${t}: lời gọi locBreadcrumbSentry(`).toBe(1);
    }
  });

  it("[CBM-W2] lời gọi bộ lọc nằm TRONG thân beforeSend/beforeBreadcrumb, và giá trị trả về là kết quả lọc", () => {
    for (const t of TEP) {
      const src = boChuThich(readFileSync(resolve(process.cwd(), t), "utf8"));
      expect(src, `${t}: beforeSend phải trả locSuKienSentry(...)`).toMatch(/return\s+locSuKienSentry\(/);
      expect(src, `${t}: beforeBreadcrumb phải trả locBreadcrumbSentry(...)`).toMatch(/return\s+locBreadcrumbSentry\(/);
    }
  });
});
