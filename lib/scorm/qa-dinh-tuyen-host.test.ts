// @vitest-environment node
// QA ĐỘC LẬP (24/10/2026) — ROUTING THEO HOST của đường SCORM: viewer gọi `/api/scorm/gia-han` và iframe nạp `/api/scorm/asset/<mã gói>/…`
// từ CẢ HAI host (admin.* và giaovien.*). Mọi ca QAG/QAR/QPL khác gọi thẳng route hoặc giả `fetch`, KHÔNG đi qua `proxy.ts → decideRoute()`.
// Nếu đường mới bị 308/403 ở một host thì viewer coi 404/405/403-lạ là "dừng IM LẶNG" (fail-open) ⇒ bản vá "ngồi yên >10 phút" không làm gì ở host đó
// và không lỗi nào hiện ra. Bộ này đóng đúng khe đó ở tầng quyết định thuần.
//
// Giới hạn: `decideRoute` không thấy METHOD (POST/GET/HEAD) — quyết định theo (host, path, vai trò, phiên). Phần `proxy.ts` ngoài `decideRoute`
// (canonical-hoá, cookie, matcher) không được kiểm ở đây; UAT trình duyệt thật (host thật) mới kiểm được trọn.
import { describe, expect, it, vi } from "vitest";

// ── Cổng cấy lỗi (luật 14): QA_DOT_BIEN_POLICY=<đường dẫn tuyệt đối> thay `@/lib/auth/route-policy` bằng bản sao ĐỘT BIẾN do script của QA tạo ở
// thư mục tạm; bình thường biến này không có ⇒ module thật, file đột biến chưa từng được nạp.
vi.mock("@/lib/auth/route-policy", async (goc) => {
  const that = await goc<typeof import("@/lib/auth/route-policy")>();
  const f = process.env.QA_DOT_BIEN_POLICY;
  if (!f) return that;
  return (await import(/* @vite-ignore */ f)) as typeof that;
});
import { decideRoute, type HostKind, type MaybeRole, type RouteDecision } from "@/lib/auth/route-policy";

const GOI = "cmuz8xsix01vlh3dv9t2bz8d1";
const DUONG_API = [
  "/api/scorm/gia-han",
  `/api/scorm/asset/${GOI}/res/index.html`,
  `/api/scorm/asset/${GOI}/res/data/video1.mp4`,
  `/api/scorm/asset/${GOI}/source.pdf`,
  "/api/scorm/runtime",
];
const CO = { teacherSiteEnabled: true, commonLoginAtRoot: false, elearningEnabled: false } as const;
const quyet = (hostKind: HostKind, pathname: string, role: MaybeRole, sessionValid = role !== null): RouteDecision =>
  decideRoute({ hostKind, pathname, role, sessionValid, ...CO });

const CAP: Array<[HostKind, MaybeRole, string]> = [
  ["teacher", "TEACHER", "giaovien × GV"],
  ["admin", "SUPER_ADMIN", "admin × SUPER_ADMIN"],
  ["admin", "TRAINING", "admin × TRAINING (Đào tạo xem giáo án)"],
  ["admin", "CENTER_MANAGER", "admin × QLCS"],
  ["admin", "TEACHER", "admin × GV (GV thuần vào admin host bị chuyển sang giaovien — API vẫn phải qua)"],
];

describe("[QAD] routing theo host cho đường API SCORM", () => {
  for (const [host, role, nhan] of CAP) {
    for (const p of DUONG_API) {
      it(`[QAD-01] ${nhan}: ${p.replace(GOI, "<gói>")} ⇒ next (không 307/308, không rewrite, không về login)`, () => {
        expect(quyet(host, p, role)).toEqual({ type: "next" });
      });
    }
  }

  it("[QAD-02] không có phiên (vé hết hạn / chưa đăng nhập) vẫn `next` ở tầng host — việc từ chối 401/403 là của chính route, KHÔNG phải của proxy", () => {
    for (const host of ["admin", "teacher"] as const) {
      for (const p of DUONG_API) expect(quyet(host, p, null, false), `${host} ${p}`).toEqual({ type: "next" });
    }
  });

  it("[QAD-03] phiên bị vô hiệu (tokenVersion lệch) cũng `next` với /api/ — route tự kiểm; proxy không được nuốt thành redirect HTML cho một lời gọi fetch", () => {
    for (const p of ["/api/scorm/gia-han", `/api/scorm/asset/${GOI}/res/index.html`]) {
      expect(quyet("teacher", p, "TEACHER", false), p).toEqual({ type: "next" });
    }
  });

  it("[QAD-04] ĐỐI CHỨNG DƯƠNG: bộ so khớp biết 'chặn' — khách ẩn danh vào trang admin / trang GV bị đá về đăng nhập; PARENT vào site GV không lọt", () => {
    const a = quyet("admin", "/scorm/play/" + GOI, null, false);
    expect(a.type).toBe("redirectPath");
    const g = quyet("teacher", "/teacher/scorm/play/" + GOI, null, false);
    expect(["redirectPath", "redirectHost"]).toContain(g.type);
    const p = quyet("teacher", "/teacher", "PARENT");
    expect(p.type).not.toBe("next");
  });
});

describe("[QAD] routing theo host cho CHÍNH hai trang play (lối vào của viewer)", () => {
  it("[QAD-10] site GV: `/teacher/scorm/play/<id>` với GV ⇒ next", () => {
    expect(quyet("teacher", `/teacher/scorm/play/${GOI}`, "TEACHER")).toEqual({ type: "next" });
  });

  it("[QAD-11] admin: `/scorm/play/<id>` (đường sạch trên host admin) với SUPER_ADMIN và TRAINING ⇒ phục vụ được (next hoặc rewrite vào /admin/scorm/play/…)", () => {
    for (const role of ["SUPER_ADMIN", "TRAINING"] as const) {
      const d = quyet("admin", `/scorm/play/${GOI}`, role);
      expect(["next", "rewrite"], `${role}: ${JSON.stringify(d)}`).toContain(d.type);
      if (d.type === "rewrite") expect(d.path).toBe(`/admin/scorm/play/${GOI}`);
    }
  });

  it("[QAD-12] admin: lối vào kiểu cũ có tiền tố `/admin/scorm/play/<id>` (teaching-materials) không bị đẩy ra ngoài host/đăng nhập — chỉ được next/rewrite/làm sạch đường dẫn", () => {
    const d = quyet("admin", `/admin/scorm/play/${GOI}`, "SUPER_ADMIN");
    if (d.type === "redirectPath") expect(d.path).toBe(`/scorm/play/${GOI}`);
    else expect(["next", "rewrite"], JSON.stringify(d)).toContain(d.type);
    expect(d.type).not.toBe("redirectHost");
  });
});
