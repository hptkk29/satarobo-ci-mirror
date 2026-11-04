import { describe, expect, it } from "vitest";
import {
  assemblyManualInputSchema,
  checkAssemblyManualUrl,
  safeAssemblyManualUrl,
} from "./assembly-manual";

// Đường dẫn mẫu đã xác minh ngày 22/10/2026 (báo cáo khảo sát ZMROBO).
const MAU = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car";

describe("checkAssemblyManualUrl", () => {
  it("[LR3D-V01] đường dẫn mẫu hợp lệ và GIỮ NGUYÊN (không mã hoá đôi %20)", () => {
    const r = checkAssemblyManualUrl(MAU);
    expect(r).toEqual({ ok: true, url: MAU });
    expect((r as { url: string }).url).not.toContain("%2520");
  });

  it("[LR3D-V02] khoảng trắng dán thô được mã hoá đúng MỘT lần, và chạy lại không đổi (idempotent)", () => {
    const r = checkAssemblyManualUrl(
      "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha Set A/03.Catapult Car",
    );
    expect(r).toEqual({ ok: true, url: MAU });
    const lai = checkAssemblyManualUrl((r as { url: string }).url);
    expect(lai).toEqual({ ok: true, url: MAU });
  });

  it("[LR3D-V03] chấp nhận khoảng trắng đầu/cuối, tên host viết hoa, và :443 rõ ràng", () => {
    expect(checkAssemblyManualUrl(`  ${MAU}  `)).toEqual({ ok: true, url: MAU });
    expect(
      checkAssemblyManualUrl("HTTPS://WWW.ZMROBO.NET/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car"),
    ).toEqual({ ok: true, url: MAU });
    expect(
      checkAssemblyManualUrl("https://www.zmrobo.net:443/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car"),
    ).toEqual({ ok: true, url: MAU });
  });

  const TU_CHOI: [string, string][] = [
    ["[LR3D-V10] sai giao thức http", "http://www.zmrobo.net/modelmanual/model?modelUrl=A/B"],
    ["[LR3D-V11] javascript:", "javascript:alert(1)"],
    ["[LR3D-V12] data:", "data:text/html,<script>alert(1)</script>"],
    ["[LR3D-V13] file:", "file:///etc/passwd"],
    ["[LR3D-V14] sai host (không www)", "https://zmrobo.net/modelmanual/model?modelUrl=A/B"],
    ["[LR3D-V15] host giả mạo (hậu tố)", "https://www.zmrobo.net.evil.com/modelmanual/model?modelUrl=A/B"],
    ["[LR3D-V16] host giả mạo (tiền tố)", "https://evilwww.zmrobo.net/modelmanual/model?modelUrl=A/B"],
    ["[LR3D-V17] host giả mạo qua userinfo", "https://www.zmrobo.net@evil.com/modelmanual/model?modelUrl=A/B"],
    ["[LR3D-V18] có tên đăng nhập", "https://user:pass@www.zmrobo.net/modelmanual/model?modelUrl=A/B"],
    ["[LR3D-V19] cổng lạ", "https://www.zmrobo.net:8443/modelmanual/model?modelUrl=A/B"],
    ["[LR3D-V20] sai đường dẫn", "https://www.zmrobo.net/modelmanual?modelUrl=A/B"],
    ["[LR3D-V21] đường dẫn thừa đuôi /", "https://www.zmrobo.net/modelmanual/model/?modelUrl=A/B"],
    ["[LR3D-V22] đường dẫn dài hơn", "https://www.zmrobo.net/modelmanual/model/x?modelUrl=A/B"],
    ["[LR3D-V23] thiếu modelUrl", "https://www.zmrobo.net/modelmanual/model"],
    ["[LR3D-V24] modelUrl trống", "https://www.zmrobo.net/modelmanual/model?modelUrl="],
    ["[LR3D-V25] modelUrl chỉ có khoảng trắng", "https://www.zmrobo.net/modelmanual/model?modelUrl=%20%20"],
    ["[LR3D-V26] tham số lặp", "https://www.zmrobo.net/modelmanual/model?modelUrl=A&modelUrl=B"],
    ["[LR3D-V27] tham số lạ kèm theo", "https://www.zmrobo.net/modelmanual/model?modelUrl=A/B&utm_source=x"],
    ["[LR3D-V28b] dấu & thừa ở cuối", "https://www.zmrobo.net/modelmanual/model?modelUrl=A/B&"],
    ["[LR3D-V28c] hai dấu & thừa ở cuối", "https://www.zmrobo.net/modelmanual/model?modelUrl=A/B&&"],
    ["[LR3D-V28] chỉ có tham số lạ", "https://www.zmrobo.net/modelmanual/model?foo=A/B"],
    ["[LR3D-V29] có fragment", "https://www.zmrobo.net/modelmanual/model?modelUrl=A/B#x"],
    ["[LR3D-V30] fragment trơ '#'", "https://www.zmrobo.net/modelmanual/model?modelUrl=A/B#"],
    ["[LR3D-V31] xuống dòng giấu trong host (bộ phân tích sẽ nuốt)", "https://www.zm\nrobo.net/modelmanual/model?modelUrl=A/B"],
    ["[LR3D-V32] tab giấu trong đường dẫn", "https://www.zmrobo.net/model\tmanual/model?modelUrl=A/B"],
    ["[LR3D-V33] rỗng", ""],
    ["[LR3D-V34] chỉ khoảng trắng", "   "],
    ["[LR3D-V35] không phải URL", "alpha set a catapult car"],
    ["[LR3D-V36] quá dài", `https://www.zmrobo.net/modelmanual/model?modelUrl=${"a".repeat(500)}`],
  ];
  it.each(TU_CHOI)("%s ⇒ từ chối", (_ten, raw) => {
    const r = checkAssemblyManualUrl(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
  });
});

describe("round-trip: cái đã LƯU phải qua được lớp kiểm lúc HIỂN THỊ", () => {
  it("[LR3D-R01] chuỗi có dấu cách/tiếng Việt dài (dạng chuẩn hoá phình ra) ⇒ hoặc bị từ chối lúc lưu, hoặc đọc lại được", () => {
    for (const n of [1, 10, 30, 40, 60, 100]) {
      const raw = "https://www.zmrobo.net/modelmanual/model?modelUrl=" + "Bộ lắp ráp/".repeat(n) + "x";
      const r = checkAssemblyManualUrl(raw);
      if (r.ok) {
        expect(r.url.length, `n=${n}`).toBeLessThanOrEqual(500);
        expect(safeAssemblyManualUrl(r.url), `n=${n}`).toBe(r.url);
      } else {
        expect(r.error).toMatch(/dài quá/);
      }
    }
  });

  it("[LR3D-R02] mọi URL hợp lệ chạy qua validator hai lần ⇒ cùng kết quả (idempotent)", () => {
    for (const raw of [MAU, MAU.replace(/%20/g, " "), "https://www.zmrobo.net/modelmanual/model?modelUrl=Bộ A/Mô hình 01"]) {
      const a = checkAssemblyManualUrl(raw);
      expect(a.ok).toBe(true);
      if (a.ok) expect(checkAssemblyManualUrl(a.url)).toEqual(a);
    }
  });
});

describe("biên độ dài", () => {
  const voiDoDai = (n: number) => {
    const goc = "https://www.zmrobo.net/modelmanual/model?modelUrl=";
    return goc + "a".repeat(n - goc.length);
  };
  it("[LR3D-L01] đúng 500 ký tự ⇒ nhận; 501 ⇒ từ chối", () => {
    expect(checkAssemblyManualUrl(voiDoDai(500)).ok).toBe(true);
    expect(checkAssemblyManualUrl(voiDoDai(501)).ok).toBe(false);
  });
  it("[LR3D-L02] tên đúng 120 ký tự ⇒ nhận; 121 ⇒ từ chối", () => {
    expect(assemblyManualInputSchema.safeParse({ url: MAU, setName: "a".repeat(120) }).success).toBe(true);
    expect(assemblyManualInputSchema.safeParse({ url: MAU, modelName: "a".repeat(121) }).success).toBe(false);
  });
});

describe("safeAssemblyManualUrl (lớp kiểm lúc hiển thị)", () => {
  it("[LR3D-S02] trả bản CHUẨN HOÁ (không trả nguyên chuỗi thô bẩn trong DB)", () => {
    expect(
      safeAssemblyManualUrl("  https://WWW.ZMROBO.NET/modelmanual/model?modelUrl=Alpha Set A/03.Catapult Car "),
    ).toBe(MAU);
  });

  it("[LR3D-S01] hợp lệ ⇒ trả URL; null/rỗng/sai ⇒ null (ẩn nút)", () => {
    expect(safeAssemblyManualUrl(MAU)).toBe(MAU);
    expect(safeAssemblyManualUrl(null)).toBeNull();
    expect(safeAssemblyManualUrl(undefined)).toBeNull();
    expect(safeAssemblyManualUrl("")).toBeNull();
    expect(safeAssemblyManualUrl("javascript:alert(1)")).toBeNull();
    // Dữ liệu lọt vào DB bằng đường khác (SQL tay) vẫn không thành href.
    expect(safeAssemblyManualUrl("https://evil.example/modelmanual/model?modelUrl=A")).toBeNull();
  });
});

describe("assemblyManualInputSchema", () => {
  it("[LR3D-I01] đủ ba ô ⇒ chuẩn hoá, cắt khoảng trắng tên", () => {
    const r = assemblyManualInputSchema.safeParse({
      url: MAU,
      setName: "  Alpha Set A ",
      modelName: " 03.Catapult Car ",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ url: MAU, setName: "Alpha Set A", modelName: "03.Catapult Car" });
    }
  });

  it("[LR3D-I08] schema trả đường dẫn CHUẨN HOÁ (thứ mà action sẽ ghi), không phải chuỗi thô", () => {
    const r = assemblyManualInputSchema.parse({
      url: "  https://WWW.ZMROBO.NET/modelmanual/model?modelUrl=Alpha Set A/03.Catapult Car ",
    });
    expect(r?.url).toBe(MAU);
  });

  it("[LR3D-I02] chỉ có đường dẫn ⇒ hai tên là null (không phải chuỗi rỗng)", () => {
    const r = assemblyManualInputSchema.parse({ url: MAU });
    expect(r).toEqual({ url: MAU, setName: null, modelName: null });
    const r2 = assemblyManualInputSchema.parse({ url: MAU, setName: "", modelName: "   " });
    expect(r2).toEqual({ url: MAU, setName: null, modelName: null });
  });

  it("[LR3D-I03] cả ba trống/thiếu/null ⇒ null (GỠ liên kết)", () => {
    expect(assemblyManualInputSchema.parse({})).toBeNull();
    expect(assemblyManualInputSchema.parse({ url: "", setName: "", modelName: "" })).toBeNull();
    expect(assemblyManualInputSchema.parse({ url: null, setName: null, modelName: null })).toBeNull();
    expect(assemblyManualInputSchema.parse({ url: "  ", setName: " ", modelName: "\t" })).toBeNull();
  });

  it("[LR3D-I04] có tên mà thiếu đường dẫn ⇒ LỖI ở ô url, không âm thầm bỏ tên", () => {
    const r = assemblyManualInputSchema.safeParse({ url: "", setName: "Alpha Set A" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["url"]);
    expect(assemblyManualInputSchema.safeParse({ modelName: "x" }).success).toBe(false);
  });

  it("[LR3D-I05] đường dẫn sai ⇒ lỗi ở ô url với thông báo tiếng Việt", () => {
    const r = assemblyManualInputSchema.safeParse({ url: "http://www.zmrobo.net/modelmanual/model?modelUrl=A" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(["url"]);
      expect(r.error.issues[0]?.message).toMatch(/https/);
    }
  });

  it("[LR3D-I06] tên quá dài / có ký tự điều khiển ⇒ lỗi ở đúng ô", () => {
    const dai = assemblyManualInputSchema.safeParse({ url: MAU, setName: "a".repeat(121) });
    expect(dai.success).toBe(false);
    if (!dai.success) expect(dai.error.issues[0]?.path).toEqual(["setName"]);
    const dk = assemblyManualInputSchema.safeParse({ url: MAU, modelName: "a\u0000b" });
    expect(dk.success).toBe(false);
    if (!dk.success) expect(dk.error.issues[0]?.path).toEqual(["modelName"]);
  });

  it("[LR3D-I07] khoá lạ trong payload bị bỏ, kiểu sai bị từ chối", () => {
    const r = assemblyManualInputSchema.parse({ url: MAU, version: 99, lessonId: "x" });
    expect(Object.keys(r ?? {}).sort()).toEqual(["modelName", "setName", "url"]);
    expect(assemblyManualInputSchema.safeParse({ url: 123 }).success).toBe(false);
  });
});
