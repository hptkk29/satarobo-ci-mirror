// @vitest-environment node
// [LRB-N*] Nút "Lắp ráp 3D" của MỘT bài trong ca bù + khối tài liệu (KhoiTaiLieuBu) mang nó.
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("sonner", () => ({ toast: { error: () => undefined, success: () => undefined } }));

import { NutLapRap3d } from "./nut-lap-rap-3d";
import { KhoiTaiLieuBu } from "./tai-lieu-bu";

const URL_A = "https://www.zmrobo.net/modelmanual/model?modelUrl=Alpha%20Set%20A/03.Catapult%20Car";
const MANUAL = { url: URL_A, setName: "Alpha Set A", modelName: "03.Catapult Car" };
const dem = (s: string, sub: string) => s.split(sub).length - 1;
const KHONG_TAI_LIEU = { scorm: null, deKiemTra: [] };

describe("[LRB-N] NutLapRap3d", () => {
  it("[LRB-N01] liên kết hợp lệ ⇒ <a> mở TAB MỚI, rel an toàn, href đúng chuỗi đã lưu", () => {
    const out = renderToStaticMarkup(<NutLapRap3d manual={MANUAL} />);
    expect(out).toContain(`href="${URL_A}"`);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("Lắp ráp 3D");
    expect(out).toContain('aria-label="Lắp ráp 3D: Alpha Set A · 03.Catapult Car (mở tab mới)"');
  });

  it("[LRB-N02] có tên bài ⇒ tên đọc-màn-hình nêu bài (ca 3 bài có 3 nút khác tên); nhãn nhìn thấy vẫn là 'Lắp ráp 3D'", () => {
    const out = renderToStaticMarkup(<NutLapRap3d manual={MANUAL} tenBai="Buổi 2 · Xe leo dốc" />);
    expect(out).toContain('aria-label="Lắp ráp 3D — Buổi 2 · Xe leo dốc: Alpha Set A · 03.Catapult Car (mở tab mới)"');
  });

  it("[LRB-N03] không gắn (null) ⇒ không dựng gì, không báo lỗi giả", () => {
    expect(renderToStaticMarkup(<NutLapRap3d manual={null} />)).toBe("");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["host lạ", "https://evil.example.com/modelmanual/model?modelUrl=a"],
    ["host giả có chứa zmrobo.net", "https://www.zmrobo.net.evil.com/modelmanual/model?modelUrl=a"],
    ["http", "http://www.zmrobo.net/modelmanual/model?modelUrl=a"],
    ["userinfo", "https://u:p@www.zmrobo.net/modelmanual/model?modelUrl=a"],
    ["thêm tham số", `${URL_A}&studentId=hv1`],
    ["fragment", `${URL_A}#x`],
    ["rỗng", ""],
  ])("[LRB-N04] đường dẫn bẩn (%s) ⇒ KHÔNG dựng <a>", (_ten, url) => {
    const out = renderToStaticMarkup(<NutLapRap3d manual={{ url, setName: "S", modelName: "M" }} />);
    expect(out).toBe("");
    expect(out).not.toContain("href");
  });
});

describe("[LRB-K] KhoiTaiLieuBu × Lắp ráp 3D", () => {
  const ve = (p: { taiLieu?: Parameters<typeof KhoiTaiLieuBu>[0]["taiLieu"]; hrefScorm?: string | null; lapRap3d: Parameters<typeof KhoiTaiLieuBu>[0]["lapRap3d"]; tenBai?: string }) =>
    renderToStaticMarkup(
      <KhoiTaiLieuBu taiLieu={p.taiLieu ?? KHONG_TAI_LIEU} hrefScorm={p.hrefScorm ?? null} lapRap3d={p.lapRap3d} tenBai={p.tenBai} soCoMat={2} guiBai={null} />,
    );

  it("[LRB-K01] bài có link nhưng KHÔNG có gói SCORM ⇒ vẫn có nút 3D (không phụ thuộc SCORM)", () => {
    const out = ve({ lapRap3d: MANUAL });
    expect(out).toContain("chưa có gói SCORM");
    expect(dem(out, "data-lap-rap-3d")).toBe(1);
    expect(out).toContain(`href="${URL_A}"`);
  });

  it("[LRB-K02] bài có SCORM + link ⇒ đủ cả hai nút, không nút nào mất", () => {
    const out = ve({ taiLieu: { scorm: { id: "p1", name: "Giáo án 2" }, deKiemTra: [] }, hrefScorm: "/teacher/scorm/play/p1?from=/teacher/hoc-bu/c1", lapRap3d: MANUAL });
    expect(out).toContain("Mở bài giảng");
    expect(out).toContain('href="/teacher/scorm/play/p1?from=/teacher/hoc-bu/c1"');
    expect(dem(out, "data-lap-rap-3d")).toBe(1);
  });

  it("[LRB-K03] bài không gắn link ⇒ KHÔNG có nút 3D và không có chữ báo lỗi", () => {
    const out = ve({ lapRap3d: null });
    expect(out).not.toContain("data-lap-rap-3d");
    expect(out).not.toContain("Lắp ráp 3D");
  });

  it("[LRB-K04] màn không mở SCORM (admin: hrefScorm null) vẫn hiện nút 3D", () => {
    const out = ve({ taiLieu: { scorm: { id: "p1", name: "Giáo án 2" }, deKiemTra: [] }, hrefScorm: null, lapRap3d: MANUAL });
    expect(out).not.toContain("Mở bài giảng");
    expect(dem(out, "data-lap-rap-3d")).toBe(1);
  });

  it("[LRB-K05] khối dựng lại link bẩn bằng validator ⇒ không có <a> dù prop mang link bẩn", () => {
    const out = ve({ lapRap3d: { url: "javascript:alert(1)", setName: null, modelName: null } });
    expect(out).not.toContain("data-lap-rap-3d");
    expect(out).not.toContain("javascript:");
  });

  it("[LRB-K06] tenBai đi tới tên đọc-màn-hình của nút", () => {
    expect(ve({ lapRap3d: MANUAL, tenBai: "Buổi 3" })).toContain("Lắp ráp 3D — Buổi 3:");
  });
});
