// @vitest-environment node
/**
 * Cổng CỜ ở tầng API của khu E-learning (đặc tả v1.4 §4.8).
 *
 * Trước đây `ELEARNING_ENABLED` chỉ tắt TRANG. `/api/*` là "infra path" của `decideRoute()` nên đi
 * thẳng qua proxy, và không route nào dưới `app/api/elearning/` hỏi cờ — cờ OFF mà ai có phiên + quyền
 * vẫn gọi được nhịp đọc / nhịp xem / nộp bài / tải chứng nhận. Mức rollback 1 của đặc tả ("ẩn hoàn
 * toàn, dữ liệu giữ nguyên") vì vậy không đúng.
 *
 * Ba lớp canh:
 *  1. HÀNH VI của hai hàm cổng (cờ OFF ⇒ 404 / 503, ON ⇒ null — có đối chứng dương);
 *  2. NGUỒN: MỌI `route.ts` dưới `app/api/elearning/` gọi `chanApiKhiTat()` và gọi nó TRƯỚC `await`
 *     đầu tiên — thêm route mới mà quên là đỏ;
 *  3. NGUỒN: các điểm ĐO XEM VIDEO (nhịp xem + màn phát) hỏi `ELEARNING_VIDEO_ENABLED`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const h = vi.hoisted(() => ({ tra: vi.fn(async (_token: string) => null as unknown) }));
vi.mock("@/lib/elearning/certificate-verify", () => ({ traChungNhan: h.tra }));
// Trang gọi `headers()` để lấy IP chặn tần suất — ngoài request scope của Next nó ném, nên giả lập.
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) }));

import { chanApiKhiTat, chanVideoKhiTat } from "@/lib/elearning/api-gate";
import XacThucPage from "@/app/(elearning)/xac-thuc/[token]/page";

const GOC = process.cwd();
const doc = (p: string) => readFileSync(join(GOC, p), "utf8");

/** Bỏ chú thích để đếm/so vị trí trên MÃ, không trên lời giải thích bản vá (luật 11). */
function chiMa(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function duongRoute(thuMuc: string): string[] {
  const kq: string[] = [];
  for (const ten of readdirSync(thuMuc)) {
    const p = join(thuMuc, ten);
    if (statSync(p).isDirectory()) kq.push(...duongRoute(p));
    else if (ten === "route.ts") kq.push(relative(GOC, p).replace(/\\/g, "/"));
  }
  return kq;
}

const ENV_CU = {
  chung: process.env.ELEARNING_ENABLED,
  video: process.env.ELEARNING_VIDEO_ENABLED,
};
afterEach(() => {
  if (ENV_CU.chung === undefined) delete process.env.ELEARNING_ENABLED;
  else process.env.ELEARNING_ENABLED = ENV_CU.chung;
  if (ENV_CU.video === undefined) delete process.env.ELEARNING_VIDEO_ENABLED;
  else process.env.ELEARNING_VIDEO_ENABLED = ENV_CU.video;
});

describe("hàm cổng — hành vi", () => {
  it("cờ chung OFF ⇒ 404 NOT_FOUND (không lộ rằng route có tồn tại)", async () => {
    delete process.env.ELEARNING_ENABLED;
    const r = chanApiKhiTat();
    expect(r).not.toBeNull();
    expect(r!.status).toBe(404);
    const body = (await r!.json()) as { ok: boolean; error: { code: string } };
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("ĐỐI CHỨNG DƯƠNG: cờ chung ON ⇒ null (cho đi tiếp)", () => {
    process.env.ELEARNING_ENABLED = "true";
    expect(chanApiKhiTat()).toBeNull();
  });

  it('chỉ chuỗi "true" mới mở — "1"/"True" vẫn bị chặn', () => {
    for (const v of ["1", "True", "TRUE", "yes", ""]) {
      process.env.ELEARNING_ENABLED = v;
      expect(chanApiKhiTat()?.status, `giá trị ${JSON.stringify(v)}`).toBe(404);
    }
  });

  it("cờ VIDEO OFF ⇒ 503 FEATURE_OFF, kể cả khi cờ chung ON", async () => {
    process.env.ELEARNING_ENABLED = "true";
    delete process.env.ELEARNING_VIDEO_ENABLED;
    const r = chanVideoKhiTat();
    expect(r).not.toBeNull();
    expect(r!.status).toBe(503);
    const body = (await r!.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FEATURE_OFF");
  });

  it("ĐỐI CHỨNG DƯƠNG: cờ VIDEO ON ⇒ null", () => {
    process.env.ELEARNING_ENABLED = "true";
    process.env.ELEARNING_VIDEO_ENABLED = "true";
    expect(chanVideoKhiTat()).toBeNull();
  });

  it("cờ VIDEO ON nhưng cờ chung OFF ⇒ vẫn bị chặn ở cổng chung (không cờ nào mở được site một mình)", () => {
    delete process.env.ELEARNING_ENABLED;
    process.env.ELEARNING_VIDEO_ENABLED = "true";
    expect(chanApiKhiTat()?.status).toBe(404);
  });
});

describe("nguồn — mọi route E-learning đều qua cổng cờ chung", () => {
  const routes = duongRoute(join(GOC, "app", "api", "elearning"));

  it("tìm thấy các route (lưới không rỗng)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(9);
  });

  for (const r of routes) {
    it(`${r} gọi chanApiKhiTat() TRƯỚC await đầu tiên`, () => {
      const m = chiMa(doc(r));
      const gate = m.indexOf("chanApiKhiTat()");
      expect(gate, "thiếu chanApiKhiTat()").toBeGreaterThan(-1);
      // Gọi mà BỎ kết quả là cổng trang trí: tên hàm có mặt, route vẫn chạy khi cờ OFF.
      expect(m, "kết quả của cổng không được dùng để return").toMatch(
        /=\s*chanApiKhiTat\(\);\s*if\s*\(\w+\)\s*return\s+\w+\s*;/,
      );
      const awaitDau = m.indexOf("await ");
      expect(awaitDau === -1 || gate < awaitDau, "cổng đứng SAU một await").toBe(true);
    });
  }
});

describe("nguồn — điểm ĐO XEM VIDEO hỏi cờ VIDEO", () => {
  it("route nhịp xem video gọi chanVideoKhiTat()", () => {
    expect(chiMa(doc("app/api/elearning/video-heartbeat/route.ts"))).toContain("chanVideoKhiTat()");
  });

  it("màn phát video của người học hỏi isElearningVideoEnabled()", () => {
    expect(
      chiMa(doc("app/(elearning)/elearning/hoc/[enrollmentId]/[lessonId]/page.tsx")),
    ).toContain("isElearningVideoEnabled()");
  });
});

describe("🔴 trang xác minh công khai — cờ chung OFF ⇒ 404, KHÔNG tra DB (đặc tả: ẩn hoàn toàn)", () => {
  // Cổng cờ ở `decideRoute()` chỉ chạy trên host e-learning. Host công khai / host lạ (localhost, test)
  // đi nhánh khác của proxy và để `/xac-thuc/*` lọt tới trang: không có cổng ở chính trang thì cờ OFF
  // vẫn trả họ tên + mã nhân viên cho bất kỳ ai cầm token.
  const params = (token: string) => ({ params: Promise.resolve({ token }) });

  it("cờ OFF ⇒ notFound() và traChungNhan KHÔNG được gọi", async () => {
    delete process.env.ELEARNING_ENABLED;
    h.tra.mockClear();
    await expect(XacThucPage(params("a".repeat(32)))).rejects.toMatchObject({
      digest: expect.stringContaining("404"),
    });
    expect(h.tra).not.toHaveBeenCalled();
  });

  it("ĐỐI CHỨNG DƯƠNG: cờ ON ⇒ tra token (trang không bị 404 oan)", async () => {
    process.env.ELEARNING_ENABLED = "true";
    h.tra.mockClear();
    await XacThucPage(params("a".repeat(32)));
    expect(h.tra).toHaveBeenCalledTimes(1);
  });
});
