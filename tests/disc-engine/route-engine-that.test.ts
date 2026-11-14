/**
 * [ENG-RT-*] Route /api/disc/bo-de với ENGINE THẬT (không engine giả, không mock engine).
 * Chỉ giả rate-limit (Upstash). Chứng minh: ensureDiscEngine() thật sự nối engine vào route, bộ đề phát ra
 * đúng đối tượng, và JSON gửi cho khách KHÔNG mang trọng số/khoá chấm/đáp án chiều.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rateLimit }));

import { datEngine, layEngine } from "@/lib/disc/engine";
import { POST } from "@/app/api/disc/bo-de/route";

const req = (body: unknown) =>
  new Request("http://localhost/api/disc/bo-de", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const env0 = { ...process.env };
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T03:00:00Z"));
  process.env.DISC_ENABLED = "true";
  m.rateLimit.mockResolvedValue({ success: true, remaining: 1, resetAt: 0 });
  datEngine(null);
});
afterEach(() => {
  vi.useRealTimers();
  datEngine(null);
  process.env = { ...env0 };
});

describe("[ENG-RT] /api/disc/bo-de chạy bằng engine thật", () => {
  it("[ENG-RT-01] chưa gọi gì: layEngine() null; sau POST đầu tiên route tự đăng ký engine thật", async () => {
    expect(layEngine()).toBeNull();
    const res = await POST(req({ vai: "PH", namSinh: 1988 }));
    expect(res.status).toBe(200);
    expect(layEngine()).not.toBeNull();
  });

  it("[ENG-RT-02] phụ huynh ⇒ bộ đề PH, 200, không-store", async () => {
    const res = await POST(req({ vai: "PH", namSinh: 1988 }));
    const j = (await res.json()) as { ok: boolean; boDe: { doiTuong: string; cauHoi: Array<Record<string, unknown>> } };
    expect(j.ok).toBe(true);
    expect(j.boDe.doiTuong).toBe("PH");
    expect(j.boDe.cauHoi.length).toBeGreaterThan(10);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("[ENG-RT-03] học sinh lớp 1 ⇒ bộ quan sát MN do người lớn trả lời hộ (hàng rào <8 tuổi)", async () => {
    const res = await POST(req({ vai: "HS", bacHoc: "lop-1", namSinh: 2019 }));
    const j = (await res.json()) as { ok: boolean; boDe?: { doiTuong: string; nguoiLonTraLoiHo: boolean } };
    if (res.status === 200) {
      expect(j.boDe?.nguoiLonTraLoiHo).toBe(true);
      expect(j.boDe?.doiTuong).toBe("MN");
    } else {
      // Bậc học/định dạng khác của adapter: vẫn KHÔNG được phát bộ tự làm cho trẻ lớp 1.
      expect(res.status).toBe(400);
    }
  });

  it("[ENG-RT-04] JSON phát cho khách chỉ có {id, noiDung} từng câu — không trọng số/khoá chấm/chiều", async () => {
    const res = await POST(req({ vai: "PH", namSinh: 1988 }));
    const text = await res.text();
    const j = JSON.parse(text) as { boDe: { cauHoi: Array<Record<string, unknown>> } };
    for (const c of j.boDe.cauHoi) expect(Object.keys(c).sort()).toEqual(["id", "noiDung"]);
    expect(text).not.toMatch(/trongSo|truc|dao|khoaBiMat|checksum/i);
  });

  it("[ENG-RT-05] năm sinh vô lý ⇒ 400, không phát bộ đề", async () => {
    const res = await POST(req({ vai: "PH", namSinh: 1800 }));
    expect(res.status).toBe(400);
  });
});
