import { describe, it, expect } from "vitest";
import {
  validateZipEntries,
  normalizeRootPrefix,
  resolveLaunchPath,
  type ZipEntry,
} from "./ingest";

const ok = (entries: ZipEntry[]) => validateZipEntries(entries);

describe("validateZipEntries", () => {
  it("gói hợp lệ → ok + totalBytes/count", () => {
    const r = ok([
      { path: "imsmanifest.xml", size: 100 },
      { path: "index.html", size: 2000 },
      { path: "assets/", size: 0 },
      { path: "assets/app.js", size: 500 },
      { path: "assets/logo.png", size: 1500 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(5);
    expect(r.totalBytes).toBe(4100);
  });

  it("reject .exe (ngoài whitelist)", () => {
    const r = ok([
      { path: "index.html", size: 10 },
      { path: "virus.exe", size: 10 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("virus.exe");
  });

  it("reject .bat / .sh", () => {
    expect(ok([{ path: "run.bat", size: 1 }]).ok).toBe(false);
    expect(ok([{ path: "run.sh", size: 1 }]).ok).toBe(false);
  });

  it("reject path traversal '../x'", () => {
    const r = ok([
      { path: "index.html", size: 10 },
      { path: "../escape.html", size: 10 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("an toàn");
  });

  it("reject absolute path bắt đầu '/'", () => {
    expect(ok([{ path: "/etc/passwd.html", size: 10 }]).ok).toBe(false);
  });

  it("reject ổ đĩa Windows 'C:'", () => {
    expect(ok([{ path: "C:/evil.html", size: 10 }]).ok).toBe(false);
  });

  it("reject traversal kiểu backslash '..\\\\x'", () => {
    expect(ok([{ path: "..\\evil.html", size: 10 }]).ok).toBe(false);
  });

  it("reject vượt số entry (≤ maxEntries)", () => {
    const entries = Array.from({ length: 3 }, (_, i) => ({
      path: `f${i}.html`,
      size: 1,
    }));
    const r = validateZipEntries(entries, { maxEntries: 2 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("số tệp");
  });

  it("reject vượt dung lượng (≤ maxBytes)", () => {
    const r = validateZipEntries([{ path: "big.mp4", size: 5000 }], {
      maxBytes: 1000,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("dung lượng");
  });

  it("thư mục (kết thúc '/') bỏ qua kiểm tra extension", () => {
    const r = ok([
      { path: "folder/", size: 0 },
      { path: "folder/index.html", size: 10 },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe("normalizeRootPrefix", () => {
  it("một thư mục gốc đơn → trả prefix", () => {
    expect(
      normalizeRootPrefix([
        "package/imsmanifest.xml",
        "package/index.html",
        "package/assets/app.js",
      ]),
    ).toBe("package/");
  });

  it("nhiều gốc → ''", () => {
    expect(
      normalizeRootPrefix(["a/x.html", "b/y.html"]),
    ).toBe("");
  });

  it("có tệp ở gốc → '' (không phải gốc đơn)", () => {
    expect(
      normalizeRootPrefix(["imsmanifest.xml", "pkg/index.html"]),
    ).toBe("");
  });

  it("danh sách rỗng → ''", () => {
    expect(normalizeRootPrefix([])).toBe("");
  });
});

describe("resolveLaunchPath", () => {
  it("strip root prefix khỏi launchUrl chứa prefix", () => {
    expect(resolveLaunchPath("package/index.html", "package/")).toBe(
      "index.html",
    );
  });

  it("giữ nguyên launchUrl tương đối khi không có root", () => {
    expect(resolveLaunchPath("content/start.html", "")).toBe(
      "content/start.html",
    );
  });

  it("bỏ './' và '/' đầu", () => {
    expect(resolveLaunchPath("./index.html", "")).toBe("index.html");
    expect(resolveLaunchPath("/index.html", "")).toBe("index.html");
  });
});
