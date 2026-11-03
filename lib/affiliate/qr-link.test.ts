/**
 * [QRL-*] QR của link giới thiệu (AFF-P1).
 *
 *   [QRL-01] SVG hợp lệ, không script, không liên kết ngoài; token khác ⇒ hình khác (có thật mã hoá token)
 *   [QRL-02] QR mã hoá ĐÚNG `<gốc>/r/<TOKEN>` — không `?aff=`, không PII (bắt chuỗi thật được đưa cho thư viện)
 *   [QRL-03] chuỗi dài (tới trần) không bay màu; vượt trần / rỗng ⇒ ném
 *   [QRL-04] data-URI đảo ngược về đúng SVG
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import QRCode from "qrcode";
import { DO_DAI_QR_TOI_DA, dungQrChoToken, dungQrSvg, svgThanhDataUri } from "./qr-link";

afterEach(() => vi.restoreAllMocks());

const GOC = "https://satarobo.vn";

describe("[QRL-01] SVG", () => {
  it("là SVG, không script/on*/liên kết ngoài", async () => {
    const svg = await dungQrChoToken(GOC, "K8F29XQ47M");
    expect(svg.startsWith("<svg") || svg.startsWith("<?xml")).toBe(true);
    expect(svg).not.toMatch(/<script|onload=|onclick=|javascript:|<foreignObject|href=|<image/i);
  });
  it("hai token khác nhau ⇒ hai hình khác nhau", async () => {
    const a = await dungQrChoToken(GOC, "K8F29XQ47M");
    const b = await dungQrChoToken(GOC, "K8F29XQ47N");
    expect(a).not.toBe(b);
  });
});

describe("[QRL-02] nội dung QR", () => {
  it("đúng `<gốc>/r/<TOKEN>`, không PII, không query", async () => {
    const spy = vi.spyOn(QRCode, "toString");
    await dungQrChoToken(GOC, "K8F29XQ47M");
    expect(spy).toHaveBeenCalledTimes(1);
    const noiDung = spy.mock.calls[0]![0] as string;
    expect(noiDung).toBe("https://satarobo.vn/r/K8F29XQ47M");
    expect(noiDung).not.toMatch(/\?|aff=|@|phone|email/i);
  });
  it("gốc hay token hỏng ⇒ ném, không tạo hình nửa vời", async () => {
    await expect(dungQrChoToken("http://satarobo.vn", "K8F29XQ47M")).rejects.toThrow();
    await expect(dungQrChoToken(GOC, "hỏng")).rejects.toThrow();
    await expect(dungQrChoToken(`${GOC}/?sdt=0905123456`, "K8F29XQ47M")).rejects.toThrow();
  });
});

describe("[QRL-03] độ dài", () => {
  it("chuỗi dài tới trần vẫn ra SVG", async () => {
    const svg = await dungQrSvg(`https://satarobo.vn/r/${"A".repeat(DO_DAI_QR_TOI_DA - 23)}`);
    expect(svg).toContain("<svg");
  });
  it("rỗng hoặc vượt trần ⇒ ném", async () => {
    await expect(dungQrSvg("")).rejects.toThrow();
    await expect(dungQrSvg("x".repeat(DO_DAI_QR_TOI_DA + 1))).rejects.toThrow();
  });
});

describe("[QRL-04] data-URI", () => {
  it("giải mã base64 về đúng SVG", async () => {
    const svg = await dungQrChoToken(GOC, "K8F29XQ47M");
    const uri = svgThanhDataUri(svg);
    expect(uri.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(Buffer.from(uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8")).toBe(svg);
  });
});
