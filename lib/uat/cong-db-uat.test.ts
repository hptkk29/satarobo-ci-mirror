// [UAT-DB-*] — cổng chặn DB lạ của bộ nạp dữ liệu UAT hoa hồng. THUẦN: chạy được khi DB chết (job Unit tests của CI).
//
// Cấy lỗi (luật 14): mỗi vế của cổng có MỘT ca đỏ riêng; xem bảng cấy ở docs/source-commission/09-uat-checklist.md §"Lưới đã cấy".
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { TEN_DB_LAM_VIEC, kiemCongDbUat, kiemUrlDbUat, laTenDbUat, type MaTuChoiDbUat } from "./cong-db-uat";

const MK = "matkhau-bi-mat-123";
const url = (host: string, cong: string, db: string) => `postgresql://postgres:${MK}@${host}:${cong}/${db}`;
const LOCAL = url("127.0.0.1", "5432", "satarobo_test_nuat");

const urlOk = (u: string, tunnel = false) => kiemUrlDbUat({ url: u, choPhepTunnelTest: tunnel });
const ma = (u: string, tunnel = false): MaTuChoiDbUat | "OK" => {
  const r = urlOk(u, tunnel);
  return r.ok ? "OK" : r.ma;
};

describe("[UAT-DB] lớp 1 — URL", () => {
  it("[UAT-DB-01] DB máy này, tên UAT hợp lệ ⇒ qua; trả đúng host/cổng/tên", () => {
    expect(urlOk(LOCAL)).toEqual({ ok: true, tenDb: "satarobo_test_nuat", host: "127.0.0.1", cong: "5432", quaTunnelTest: false });
    expect(ma(url("localhost", "5432", "satarobo_lamviec"))).toBe("OK");
    expect(ma(url("127.0.0.1", "5432", "satarobo_test"))).toBe("OK");
    expect(ma(url("127.0.0.1", "5432", "satarobo_test_x"))).toBe("OK"); // đối chứng của ca 05: cùng chuỗi, chỉ khác cổng — cổng mới là thứ chặn
  });

  it("[UAT-DB-02] ĐỐI CHỨNG DƯƠNG + ÂM theo định nghĩa DB test DÙNG CHUNG: ci_test / satarobo_test* / satarobo_lamviec QUA; prod, tên lạ, tên viết hoa, hậu tố sai TỪ CHỐI", () => {
    // Dương — gồm `ci_test`/`ci_test_<hậu tố>` (DB của CI): bản đầu của cổng từ chối chúng và [UAT-SO-00] phải tự dựng tên DB riêng để né.
    for (const ten of ["ci_test", "ci_test_kem", "satarobo_test", "satarobo_test_x", "satarobo_test_t3", "satarobo_test_nuat", "satarobo_lamviec"]) {
      expect(ma(url("127.0.0.1", "5432", ten)), ten).toBe("OK");
    }
    // Âm — tên prod đã biết có mã riêng (nói đúng lý do); phần còn lại là "không phải DB test".
    for (const ten of ["satarobo", "satarobo_prod", "satarobo_production", "prod", "production", "postgres"]) {
      expect(ma(url("127.0.0.1", "5432", ten)), ten).toBe("TEN_DB_PROD_DA_BIET");
    }
    for (const ten of ["satarobo_local", "satarobo_dev", "Satarobo_Test", "CI_TEST", "satarobo_test-x", "satarobo_testing", "ci_testing", "satarobo_lamviec2", "xsatarobo_test", "xci_test", "template1"]) {
      expect(ma(url("127.0.0.1", "5432", ten)), ten).toBe("TEN_DB_KHONG_PHAI_UAT");
    }
    expect(laTenDbUat("satarobo_test_nuat")).toBe(true);
    expect(laTenDbUat(TEN_DB_LAM_VIEC)).toBe(true);
  });

  it("[UAT-DB-13] cổng soi TÊN DB đã tách, không soi cả chuỗi: user/tham số mang chữ 'satarobo_test'/'ci_test' không biến DB prod thành DB test; ci_test qua tunnel/host xa vẫn TỪ CHỐI", () => {
    // user của tunnel TEST là `satarobo_test`; DB là prod ⇒ soi cả chuỗi (như `laTenDbTest(url)`) cho qua.
    expect(ma("postgresql://satarobo_test:x@127.0.0.1:5432/satarobo")).toBe("TEN_DB_PROD_DA_BIET");
    expect(ma("postgresql://ci_test:x@127.0.0.1:5432/satarobo_local")).toBe("TEN_DB_KHONG_PHAI_UAT");
    expect(ma("postgresql://postgres:x@127.0.0.1:5432/satarobo?application_name=ci_test")).toBe("TEN_DB_PROD_DA_BIET");
    // đối chứng dương cùng hình dạng: tham số chứa chữ lạ nhưng TÊN DB là test ⇒ qua
    expect(ma("postgresql://postgres:x@127.0.0.1:5432/ci_test?application_name=satarobo")).toBe("OK");
    // tên DB hợp lệ KHÔNG cứu được host/cổng sai
    expect(ma(url("127.0.0.1", "5433", "ci_test"))).toBe("TUNNEL_PROD");
    expect(ma(url("127.0.0.1", "5435", "ci_test"))).toBe("TUNNEL_TEST_CHUA_CHO_PHEP");
    expect(ma(url("db.supabase.co", "5432", "ci_test"))).toBe("HOST_KHONG_PHAI_MAY_NAY");
    expect(ma(url("10.0.0.5", "5432", "satarobo_test_x"))).toBe("HOST_KHONG_PHAI_MAY_NAY");
  });

  it("[UAT-DB-14] lớp current_database(): ci_test qua với apply + xác nhận; tên prod do DB tự khai thì TỪ CHỐI dù URL nói khác", () => {
    const u = url("127.0.0.1", "5432", "ci_test");
    expect(kiemCongDbUat({ url: u, tenDbThat: "ci_test", choPhepTunnelTest: false, xacNhanDb: "ci_test", apply: true })).toMatchObject({ ok: true, tenDb: "ci_test" });
    expect(kiemCongDbUat({ url: u, tenDbThat: "ci_test", choPhepTunnelTest: false, xacNhanDb: null, apply: false })).toMatchObject({ ok: true });
    expect(kiemCongDbUat({ url: u, tenDbThat: "satarobo", choPhepTunnelTest: false, xacNhanDb: "satarobo", apply: true })).toMatchObject({ ok: false, ma: "CURRENT_DATABASE_LECH_URL" });
  });

  it("[UAT-DB-15] LƯỚI GHIM: cổng KHÔNG tự định nghĩa 'DB test' — tên đi qua laTenDbLaDbTest của lib/security/url-db-cuc-bo (đúng 2 lời gọi: lớp URL + lớp current_database), không có chữ 'satarobo_test'/'ci_test' trong mã", () => {
    const ma = boChuThich(readFileSync(resolve(process.cwd(), "lib/uat/cong-db-uat.ts"), "utf8"));
    expect(ma.match(/\blaTenDbLaDbTest\(|\blaTenDbUat\(/g)?.length, "lời gọi vị từ tên-DB-test").toBeGreaterThanOrEqual(2);
    expect(ma).toMatch(/from\s+["']@\/lib\/security\/url-db-cuc-bo["']/);
    expect(ma, "tự viết lại tên DB test ở đây là bản chép thứ hai").not.toMatch(/satarobo_test|ci_test/);
  });
});

/** Bỏ chú thích dòng/khối trước khi soi (luật 11): chú thích giải thích bản vá chứa đúng chuỗi lưới đang cấm. */
function boChuThich(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[\s;{}(),])\/\/.*$/gm, "$1");
}

describe("[UAT-DB] lớp 1 — URL (tiếp)", () => {
  it("[UAT-DB-02b] lời từ chối tên prod nói đúng lý do và KHÔNG chứa mật khẩu", () => {
    const r = urlOk(url("127.0.0.1", "5432", "satarobo"));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.ma).toBe("TEN_DB_PROD_DA_BIET");
      expect(r.lyDo).toContain("satarobo");
      expect(r.lyDo).not.toContain(MK);
    }
  });

  it("[UAT-DB-03] host không phải máy này ⇒ TỪ CHỐI, kể cả khi tên DB hợp lệ", () => {
    for (const host of ["db.abc.supabase.co", "10.0.0.5", "203.0.113.9", "0.0.0.0", "pg.example.test", "127.0.0.2"]) {
      expect(ma(url(host, "5432", "satarobo_test")), host).toBe("HOST_KHONG_PHAI_MAY_NAY");
    }
  });

  it("[UAT-DB-04] mẹo userinfo: `…@127.0.0.1:5432@evil/…` — hàm dùng chung nhìn chuỗi thấy 127.0.0.1, host THẬT là evil ⇒ vẫn TỪ CHỐI", () => {
    const meo = `postgresql://postgres:x@127.0.0.1:5432@pg.evil.test/satarobo_test`;
    expect(ma(meo)).toBe("HOST_KHONG_PHAI_MAY_NAY");
  });

  it("[UAT-DB-05] tunnel PROD (:5433) ⇒ TỪ CHỐI vô điều kiện, KỂ CẢ khi bật cờ cho phép tunnel TEST", () => {
    const u = url("127.0.0.1", "5433", "satarobo_test");
    expect(ma(u, false)).toBe("TUNNEL_PROD");
    expect(ma(u, true)).toBe("TUNNEL_PROD");
    expect(ma(`${url("localhost", "5432", "satarobo_test")}?port=5433`, true)).toBe("TUNNEL_PROD");
  });

  it("[UAT-DB-06] tunnel TEST (:5435): mặc định TỪ CHỐI; chỉ qua khi nói rõ; vẫn đòi host máy này và tên UAT", () => {
    const u = url("127.0.0.1", "5435", "satarobo_test");
    expect(ma(u, false)).toBe("TUNNEL_TEST_CHUA_CHO_PHEP");
    expect(urlOk(u, true)).toEqual({ ok: true, tenDb: "satarobo_test", host: "127.0.0.1", cong: "5435", quaTunnelTest: true });
    expect(ma(url("db.supabase.co", "5435", "satarobo_test"), true)).toBe("HOST_KHONG_PHAI_MAY_NAY");
    expect(ma(url("127.0.0.1", "5435", "satarobo"), true)).toBe("TEN_DB_PROD_DA_BIET");
    expect(ma(`${url("127.0.0.1", "5432", "satarobo_test")}?port=5435`, false)).toBe("TUNNEL_TEST_CHUA_CHO_PHEP");
  });

  it("[UAT-DB-07] URL trống / rác / sai giao thức ⇒ TỪ CHỐI; lời từ chối KHÔNG chứa mật khẩu", () => {
    expect(ma("")).toBe("URL_TRONG");
    expect(ma("   ")).toBe("URL_TRONG");
    expect(ma("khong-phai-url")).toBe("URL_KHONG_DOC_DUOC");
    expect(ma(`mysql://root:${MK}@127.0.0.1:3306/satarobo_test`)).toBe("URL_KHONG_DOC_DUOC");
    expect(ma(`postgresql://u:${MK}@127.0.0.1:5432/`)).toBe("URL_KHONG_DOC_DUOC");
    for (const u of [url("10.0.0.5", "5432", "satarobo_test"), url("127.0.0.1", "5433", "satarobo_test"), url("127.0.0.1", "5432", "prod"), `mysql://r:${MK}@h/x`]) {
      const r = urlOk(u);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.lyDo, "lời từ chối làm lộ mật khẩu").not.toContain(MK);
    }
  });
});

describe("[UAT-DB] lớp 2 + 3 — current_database() và xác nhận tên", () => {
  const goi = (p: Partial<Parameters<typeof kiemCongDbUat>[0]> = {}) =>
    kiemCongDbUat({ url: LOCAL, tenDbThat: "satarobo_test_nuat", choPhepTunnelTest: false, xacNhanDb: null, apply: false, ...p });

  it("[UAT-DB-08] dry-run: current_database() trùng URL ⇒ qua, KHÔNG cần xác nhận tên", () => {
    expect(goi()).toMatchObject({ ok: true, tenDb: "satarobo_test_nuat" });
  });

  it("[UAT-DB-09] current_database() trống / khác URL / không khớp mẫu UAT ⇒ TỪ CHỐI (DB tự khai thắng URL)", () => {
    expect(goi({ tenDbThat: null })).toMatchObject({ ok: false, ma: "CURRENT_DATABASE_KHONG_RO" });
    expect(goi({ tenDbThat: "  " })).toMatchObject({ ok: false, ma: "CURRENT_DATABASE_KHONG_RO" });
    // URL nói UAT nhưng DB thật là prod (proxy/pooler đổi tên)
    expect(goi({ tenDbThat: "satarobo" })).toMatchObject({ ok: false, ma: "CURRENT_DATABASE_LECH_URL" });
    expect(goi({ tenDbThat: "satarobo_test" })).toMatchObject({ ok: false, ma: "CURRENT_DATABASE_LECH_URL" });
  });

  it("[UAT-DB-10] --apply cần gõ lại ĐÚNG tên DB; thiếu hoặc sai ⇒ TỪ CHỐI; đúng ⇒ qua", () => {
    expect(goi({ apply: true })).toMatchObject({ ok: false, ma: "CHUA_XAC_NHAN_TEN_DB" });
    expect(goi({ apply: true, xacNhanDb: "satarobo_test" })).toMatchObject({ ok: false, ma: "CHUA_XAC_NHAN_TEN_DB" });
    expect(goi({ apply: true, xacNhanDb: "SATAROBO_TEST_NUAT" })).toMatchObject({ ok: false, ma: "CHUA_XAC_NHAN_TEN_DB" });
    expect(goi({ apply: true, xacNhanDb: "satarobo_test_nuat" })).toMatchObject({ ok: true });
    // đối chứng: dry-run mà có xác nhận thừa cũng không sao
    expect(goi({ apply: false, xacNhanDb: "sai-tên" })).toMatchObject({ ok: true });
  });

  it("[UAT-DB-11] lớp URL đứng TRƯỚC: URL sai thì không bao giờ tới lớp current_database() (lý do nói đúng lớp)", () => {
    const r = goi({ url: url("10.0.0.5", "5432", "satarobo_test_nuat") });
    expect(r).toMatchObject({ ok: false, ma: "HOST_KHONG_PHAI_MAY_NAY" });
    const t = goi({ url: url("127.0.0.1", "5433", "satarobo_test_nuat"), apply: true, xacNhanDb: "satarobo_test_nuat" });
    expect(t).toMatchObject({ ok: false, ma: "TUNNEL_PROD" });
  });

  it("[UAT-DB-12] tunnel TEST đã cho phép vẫn phải qua lớp 2 + 3 (tên DB thật, xác nhận)", () => {
    const u = url("127.0.0.1", "5435", "satarobo_test");
    expect(kiemCongDbUat({ url: u, tenDbThat: "satarobo_test", choPhepTunnelTest: true, xacNhanDb: null, apply: true })).toMatchObject({ ok: false, ma: "CHUA_XAC_NHAN_TEN_DB" });
    expect(kiemCongDbUat({ url: u, tenDbThat: "satarobo_test", choPhepTunnelTest: true, xacNhanDb: "satarobo_test", apply: true })).toMatchObject({ ok: true, quaTunnelTest: true });
    expect(kiemCongDbUat({ url: u, tenDbThat: "satarobo", choPhepTunnelTest: true, xacNhanDb: "satarobo", apply: true })).toMatchObject({ ok: false, ma: "CURRENT_DATABASE_LECH_URL" });
  });
});
