/**
 * [DISC-QA-GATE-*] Cổng cờ OFF: khi DISC_ENABLED không phải đúng chuỗi "true" thì /disc,
 * /disc/bat-dau và /api/disc/* đều 404 và KHÔNG làm việc gì (không DB, không OTP, không email).
 *
 * Hai tầng:
 *  A. HÀNH VI cho route đã có (`/disc`): gọi thật Server Component với cờ tắt/bật.
 *  B. LƯỚI QUÉT cho mọi route DISC (hiện có hoặc do agent khác thêm sau): mỗi `page.tsx` /
 *     `route.ts` dưới `app/(public)/disc` và `app/api/disc` phải đặt cổng cờ TRƯỚC mọi việc khác.
 *     Route chưa tồn tại ⇒ `it.todo` có tên rõ (không xanh giả).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { boChuThich, docTep, GOC_REPO, lietKeTep, tuongDoi } from "./_quet";

class NotFoundGia extends Error {
  readonly digest = "NEXT_NOT_FOUND";
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundGia("NEXT_NOT_FOUND");
  },
}));

const cu = process.env.DISC_ENABLED;
afterEach(() => {
  if (cu === undefined) delete process.env.DISC_ENABLED;
  else process.env.DISC_ENABLED = cu;
});

describe("[DISC-QA-GATE-01] trang /disc — hành vi thật", () => {
  it.each([[undefined], [""], ["false"], ["1"], ["TRUE"], ["True"], [" true"]])("cờ=%j ⇒ notFound()", async (v) => {
    if (v === undefined) delete process.env.DISC_ENABLED;
    else process.env.DISC_ENABLED = v;
    const { default: Trang } = await import("../../app/(public)/disc/page");
    expect(() => Trang()).toThrow(NotFoundGia);
  });
  it("đối chứng dương: cờ='true' ⇒ dựng được cây React (không 404)", async () => {
    process.env.DISC_ENABLED = "true";
    const { default: Trang } = await import("../../app/(public)/disc/page");
    const cay = Trang();
    expect(cay).toBeTruthy();
    expect(typeof cay).toBe("object");
  });
  it("trang động: cờ đọc lúc CHẠY, không bị bake vào bản dựng", () => {
    const s = boChuThich(docTep(join(GOC_REPO, "app/(public)/disc/page.tsx")));
    expect(s).toMatch(/export const dynamic\s*=\s*"force-dynamic"/);
  });
});

/** Cổng hợp lệ: gọi isDiscEnabled() và rẽ sang 404 TRƯỚC mọi việc có tác dụng phụ. */
function kiemCong(rel: string, ma: string): string[] {
  const loi: string[] = [];
  const viTriCong = ma.search(/isDiscEnabled\s*\(\s*\)/);
  if (viTriCong === -1) return [`${rel}: không gọi isDiscEnabled()`];
  const laApi = /\/route\.tsx?$/.test(rel);
  const la404 = laApi
    ? /status:\s*404/.test(ma) || /notFound\s*\(/.test(ma)
    : /notFound\s*\(/.test(ma);
  if (!la404) loi.push(`${rel}: có cờ nhưng không trả 404`);
  // Cổng phải đứng TRƯỚC: await, đọc body, auth(), db, OTP, email.
  const viec = /\bawait\b|\.(?:json|text|formData)\s*\(\s*\)|\bauth\s*\(|\bdb\.|scopedDb|portalDb|requestOtp|sendEmail|enqueue/;
  const m = viec.exec(ma);
  if (m && m.index < viTriCong) loi.push(`${rel}: "${m[0]}" chạy TRƯỚC cổng cờ`);
  return loi;
}

describe("[DISC-QA-GATE-02] lưới quét: mọi route DISC có cổng cờ đứng đầu", () => {
  const trang = lietKeTep("app/(public)/disc", /^(page|layout)\.tsx?$/);
  const api = lietKeTep("app/api/disc", /^route\.tsx?$/);

  it("lưới không rỗng: tìm thấy ít nhất trang landing /disc", () => {
    expect(trang.map(tuongDoi)).toContain("app/(public)/disc/page.tsx");
  });
  it("mọi page.tsx dưới app/(public)/disc có cổng cờ hợp lệ", () => {
    const loi = trang
      .filter((p) => /page\.tsx?$/.test(p))
      .flatMap((p) => kiemCong(tuongDoi(p), boChuThich(docTep(p))));
    expect(loi).toEqual([]);
  });
  it("mọi route.ts dưới app/api/disc có cổng cờ hợp lệ (nếu có)", () => {
    const loi = api.flatMap((p) => kiemCong(tuongDoi(p), boChuThich(docTep(p))));
    expect(loi).toEqual([]);
  });

  // Route CHƯA có ⇒ it.todo có tên (hiện trong báo cáo vitest, KHÔNG xanh giả). Có rồi ⇒ ca thật: lưới ở trên đã quét nó.
  const batDau = existsSync(join(GOC_REPO, "app/(public)/disc/bat-dau/page.tsx"));
  if (batDau) {
    it("/disc/bat-dau tồn tại và nằm trong tập mà lưới GATE-02 quét", () => {
      expect(trang.map(tuongDoi)).toContain("app/(public)/disc/bat-dau/page.tsx");
    });
  } else {
    it.todo("/disc/bat-dau chưa có route — BLOCKED: engine/giấy phép (chưa kiểm được 404 khi cờ tắt)");
  }
  if (api.length > 0) {
    it("/api/disc/*: có route và nằm trong tập mà lưới GATE-02 quét", () => {
      expect(api.map(tuongDoi).every((x) => x.startsWith("app/api/disc/"))).toBe(true);
    });
  } else {
    it.todo("/api/disc/* chưa có route — BLOCKED: server action/API chưa dựng (chưa kiểm được 404 khi cờ tắt)");
  }
});

describe("[DISC-QA-GATE-03] kiemCong tự kiểm (luật 14: lưới phải có răng)", () => {
  it("bắt: không có cờ", () => {
    expect(kiemCong("app/api/disc/x/route.ts", "export async function POST(){ return Response.json({ok:true}) }")).not.toEqual([]);
  });
  it("bắt: có cờ nhưng không 404", () => {
    expect(kiemCong("app/api/disc/x/route.ts", "export async function POST(){ if(!isDiscEnabled()) return Response.json({}); }")).not.toEqual([]);
  });
  it("bắt: await/auth chạy trước cổng", () => {
    expect(
      kiemCong("app/api/disc/x/route.ts", "export async function POST(r){ const b=await r.json(); if(!isDiscEnabled()) return Response.json({},{status:404}); }"),
    ).not.toEqual([]);
  });
  it("bắt: trang không dùng notFound()", () => {
    expect(kiemCong("app/(public)/disc/x/page.tsx", "export default function P(){ if(!isDiscEnabled()) return null; }")).not.toEqual([]);
  });
  it("đối chứng dương: route hợp lệ ⇒ không lỗi", () => {
    expect(
      kiemCong("app/api/disc/x/route.ts", "export async function POST(r){ if(!isDiscEnabled()) return Response.json({},{status:404}); const b=await r.json(); }"),
    ).toEqual([]);
    expect(kiemCong("app/(public)/disc/x/page.tsx", "export default function P(){ if(!isDiscEnabled()) notFound(); return 1 }")).toEqual([]);
  });
});
