/**
 * [DISC-MD-*] Siêu dữ liệu trang DISC (F-15): màn làm bài KHÔNG lập chỉ mục và tiêu đề trung tính;
 * trang giới thiệu có thể lập chỉ mục. Mọi dữ liệu BỊA; không DB.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => undefined, redirect: () => undefined }));

describe("[DISC-MD-01] /disc/bat-dau", () => {
  it("noindex + nofollow, tiêu đề cố định trung tính, không rò referrer", async () => {
    const { metadata } = await import("./bat-dau/page");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(typeof metadata.title).toBe("string");
    expect(metadata.title as string).toBe("Làm bài khám phá DISC | Sata Robo");
    expect(metadata.referrer).toBe("no-referrer");
  });
  it("tiêu đề không có chỗ cho tên/số: không placeholder, không chữ số", async () => {
    const { metadata } = await import("./bat-dau/page");
    expect(String(metadata.title)).not.toMatch(/[0-9{}$]/);
  });
});

describe("[DISC-MD-02] /disc (giới thiệu)", () => {
  it("được phép lập chỉ mục; có canonical; tiêu đề tĩnh", async () => {
    const { metadata } = await import("./page");
    const robots = metadata.robots as { index?: boolean } | string | null | undefined;
    if (robots && typeof robots === "object") expect(robots.index).not.toBe(false);
    if (typeof robots === "string") expect(robots).not.toMatch(/noindex/);
    expect((metadata.alternates?.canonical as string) ?? "").toMatch(/\/disc$/);
    expect(String(metadata.title)).toMatch(/DISC/);
  });
});
