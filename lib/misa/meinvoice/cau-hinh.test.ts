import { describe, expect, it } from "vitest";
import { docCauHinhMisa } from "./cau-hinh";
import { congHoaDonTuEnv, moTaCauHinhMisa } from "./index";

const MAT_KHAU = "Mk-bi-mat-9f3a7c";
const APP_ID = "app-bi-mat-77d1";

function envDu(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    MISA_EINVOICE_MODE: "sandbox",
    MISA_EINVOICE_BASE_URL: "https://testapi.meinvoice.vn/api/v3",
    MISA_EINVOICE_APP_ID: APP_ID,
    MISA_EINVOICE_USERNAME: "ketoan@satarobo.vn",
    MISA_EINVOICE_PASSWORD: MAT_KHAU,
    MISA_EINVOICE_LOAI_HOA_DON: "co-ma",
    ...extra,
  };
}

const khongFetch = async (): Promise<Response> => {
  throw new Error("không được gọi mạng khi dựng cổng");
};

describe("[MEI-CH] cấu hình MISA meInvoice", () => {
  it("[MEI-CH-01] không khai MODE ⇒ off ⇒ null, không lỗi", () => {
    expect(congHoaDonTuEnv({}, khongFetch)).toBeNull();
    expect(moTaCauHinhMisa({})).toEqual({ cheDo: "off", cheDoKhai: "off", moiTruong: null, thieu: [], loi: null });
  });

  it("[MEI-CH-02] MODE lạ ⇒ off kèm câu lỗi", () => {
    const r = docCauHinhMisa({ MISA_EINVOICE_MODE: "prod" });
    expect(r.cauHinh).toBeNull();
    expect(r.loi).toMatch(/MISA_EINVOICE_MODE/);
  });

  it("[MEI-CH-03] gia-lap ⇒ cổng GIA_LAP, không cần biến nào", () => {
    const c = congHoaDonTuEnv({ MISA_EINVOICE_MODE: "gia-lap" }, khongFetch);
    expect(c?.cheDo).toBe("GIA_LAP");
    expect(c?.moiTruong).toBe("gia-lap");
  });

  it("[MEI-CH-04] sandbox đủ biến ⇒ cổng HSM sandbox", () => {
    const c = congHoaDonTuEnv(envDu(), khongFetch);
    expect(c?.cheDo).toBe("HSM");
    expect(c?.moiTruong).toBe("sandbox");
  });

  it("[MEI-CH-05] thiếu biến ⇒ null + liệt kê TÊN biến thiếu, KHÔNG lộ giá trị", () => {
    const env = envDu({ MISA_EINVOICE_USERNAME: "", MISA_EINVOICE_LOAI_HOA_DON: undefined });
    expect(congHoaDonTuEnv(env, khongFetch)).toBeNull();
    const m = moTaCauHinhMisa(env);
    expect(m.cheDo).toBe("off");
    expect(m.cheDoKhai).toBe("sandbox");
    expect(m.thieu).toEqual(["MISA_EINVOICE_USERNAME", "MISA_EINVOICE_LOAI_HOA_DON"]);
    const json = JSON.stringify(m);
    expect(json).not.toContain(MAT_KHAU);
    expect(json).not.toContain(APP_ID);
  });

  it("[MEI-CH-06] sandbox trỏ host production ⇒ TỪ CHỐI (null + lỗi)", () => {
    const env = envDu({ MISA_EINVOICE_BASE_URL: "https://api.meinvoice.vn/api/v3" });
    expect(congHoaDonTuEnv(env, khongFetch)).toBeNull();
    expect(moTaCauHinhMisa(env).loi).toMatch(/sandbox chỉ nhận host testapi\.meinvoice\.vn/);
  });

  it("[MEI-CH-07] production trỏ host test ⇒ TỪ CHỐI", () => {
    const env = envDu({ MISA_EINVOICE_MODE: "production" });
    expect(congHoaDonTuEnv(env, khongFetch)).toBeNull();
    expect(moTaCauHinhMisa(env).loi).toMatch(/production từ chối host/);
  });

  it("[MEI-CH-08] production host thật ⇒ cổng HSM production", () => {
    const env = envDu({ MISA_EINVOICE_MODE: "production", MISA_EINVOICE_BASE_URL: "https://api.meinvoice.vn/api/v3/" });
    const c = congHoaDonTuEnv(env, khongFetch);
    expect(c?.moiTruong).toBe("production");
    const r = docCauHinhMisa(env);
    expect(r.cauHinh && r.cauHinh.cheDo !== "gia-lap" ? r.cauHinh.baseUrl : "").toBe("https://api.meinvoice.vn/api/v3");
  });

  it("[MEI-CH-09] production host ngoài meinvoice.vn / http / sai đường dẫn ⇒ TỪ CHỐI", () => {
    for (const url of [
      "https://api.meinvoice.vn.evil.com/api/v3",
      "http://api.meinvoice.vn/api/v3",
      "https://api.meinvoice.vn",
      "https://u:p@api.meinvoice.vn/api/v3",
    ]) {
      const env = envDu({ MISA_EINVOICE_MODE: "production", MISA_EINVOICE_BASE_URL: url });
      expect(congHoaDonTuEnv(env, khongFetch), url).toBeNull();
      expect(moTaCauHinhMisa(env).loi ?? "").not.toContain("u:p");
    }
  });

  it("[MEI-CH-10] LOAI_HOA_DON sai giá trị ⇒ null", () => {
    expect(congHoaDonTuEnv(envDu({ MISA_EINVOICE_LOAI_HOA_DON: "co" }), khongFetch)).toBeNull();
  });
});
