// @vitest-environment node
// [LR3D-T*] Nút "Lắp ráp 3D" ở site giáo viên: chỉ dựng khi đường dẫn QUA validator, và là liên kết
// mở tab mới an toàn, không mang dữ liệu học viên/lớp.
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LapRap3dLink } from "./lap-rap-3d-link";

const URL_OK = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car";
const html = (m: Parameters<typeof LapRap3dLink>[0]["manual"]) => renderToStaticMarkup(<LapRap3dLink manual={m} />);

describe("LapRap3dLink", () => {
  it("[LR3D-T01] có đường dẫn hợp lệ ⇒ <a> mở TAB MỚI, rel an toàn, href đúng bằng URL đã lưu", () => {
    const out = html({ url: URL_OK, setName: "Alpha Set A", modelName: "03.Catapult Car" });
    expect(out).toContain(`href="${URL_OK}"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("Lắp ráp 3D");
    expect(out).toContain("Alpha Set A · 03.Catapult Car");
  });

  it("[LR3D-T02] href KHÔNG mang thêm gì ngoài URL đã lưu (không studentId/classId/token)", () => {
    const out = html({ url: URL_OK, setName: null, modelName: null });
    const href = /href="([^"]+)"/.exec(out)?.[1];
    expect(href).toBe(URL_OK);
    expect(out).not.toMatch(/studentId|classId|token|session/i);
  });

  it("[LR3D-T06] href là bản CHUẨN HOÁ dù DB lưu chuỗi thô (khoảng trắng, host viết hoa)", () => {
    const out = html({
      url: "https://WWW.ZMROBO.NET/modelmanual/model?modelUrl=Alpha Set A/03.Catapult Car",
      setName: null,
      modelName: null,
    });
    expect(out).toContain(`href="${URL_OK}"`);
  });

  it("[LR3D-T03] không có dữ liệu ⇒ KHÔNG dựng gì (không placeholder)", () => {
    expect(html(null)).toBe("");
  });

  it("[LR3D-T04] URL không qua validator (dữ liệu bẩn trong DB) ⇒ KHÔNG dựng nút", () => {
    for (const url of [
      "javascript:alert(1)",
      "http://www.zmrobo.net/modelmanual/model?modelUrl=A",
      "https://evil.example/modelmanual/model?modelUrl=A",
      "https://www.zmrobo.net.evil.com/modelmanual/model?modelUrl=A",
      "",
    ]) {
      expect(html({ url, setName: "x", modelName: "y" }), url).toBe("");
    }
  });

  it("[LR3D-T05] không có tên đối chiếu ⇒ nút vẫn dựng, nhãn không có phần tên", () => {
    const out = html({ url: URL_OK, setName: null, modelName: null });
    expect(out).toContain('aria-label="Lắp ráp 3D (mở tab mới)"');
  });
});
