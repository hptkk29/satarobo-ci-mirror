// @vitest-environment node
// [KB-*] Tóm tắt khác biệt SLA/thông báo trước khi lưu — thuần.
import { describe, expect, it } from "vitest";
import type { QuyTac } from "@/lib/ai-lead/dich-vu/bo-quy-tac-schema";
import { moTaQuyTac, soThayDoi, tomTatKhacBiet } from "./khac-biet-quy-tac";

const CS1 = "co-so-nguyen-huu-tho";
const ten = (id: string) => (id === CS1 ? "Nguyễn Hữu Thọ" : id);
const sla = (claim: number, resolve: number, scope: Extract<QuyTac, { kind: "SLA" }>["scope"] = { type: "DEFAULT" }): QuyTac => ({ kind: "SLA", scope, claimMinutes: claim, resolveMinutes: resolve });
const tb = (after: number, to: Extract<QuyTac, { kind: "NOTIFY" }>["to"] = ["CENTER_MANAGER"], centerId: string | null = null): QuyTac => ({ kind: "NOTIFY", event: "SLA_CLAIM_OVERDUE", centerId, afterMinutes: after, to });
const route: QuyTac = { kind: "ROUTE_PAGE_TO_CAMPUS", agentId: "cm0agentaaaaaaaaaaaaaaaa1", pageId: "104500000000777", centerId: CS1 };

describe("[KB-01] tomTatKhacBiet", () => {
  it("giống hệt ⇒ không khác biệt; quy tắc ROUTE/AUTO không bị tính (không thuộc màn này)", () => {
    const k = tomTatKhacBiet([sla(30, 240), tb(0), route], [tb(0), sla(30, 240), route], ten);
    expect(soThayDoi(k)).toBe(0);
  });
  it("THÊM / SỬA / XOÁ phân loại đúng theo khoá máy chủ; SLA đổi phút = sửa (hiện trước ⇒ sau)", () => {
    const k = tomTatKhacBiet(
      [sla(30, 240), sla(10, 60, { type: "CAMPUS", centerId: CS1 }), tb(0)],
      [sla(20, 240), tb(0), tb(60, ["HO_REVIEWERS"])],
      ten,
    );
    expect(k.sua).toEqual(["SLA mặc định: nhận trong 30′, xử lý trong 240′  ⇒  SLA mặc định: nhận trong 20′, xử lý trong 240′"]);
    expect(k.xoa).toEqual(["SLA cơ sở Nguyễn Hữu Thọ: nhận trong 10′, xử lý trong 60′"]);
    expect(k.them).toHaveLength(1);
    expect(k.them[0]).toMatch(/sau 60′ \(leo thang\).*Người duyệt hồ sơ AI ở Hội sở/);
    expect(soThayDoi(k)).toBe(3);
  });
  it("thông báo đổi NHÓM nhận (cùng sự kiện/cơ sở/phút) = sửa; đổi SỐ PHÚT = xoá + thêm (khoá chứa afterMinutes)", () => {
    const doiNhom = tomTatKhacBiet([tb(0, ["CENTER_MANAGER"])], [tb(0, ["CENTER_MANAGER", "HO_REVIEWERS"])], ten);
    expect(doiNhom.sua).toHaveLength(1);
    expect(doiNhom.them.length + doiNhom.xoa.length).toBe(0);
    const doiPhut = tomTatKhacBiet([tb(30)], [tb(45)], ten);
    expect(doiPhut.xoa).toHaveLength(1);
    expect(doiPhut.them).toHaveLength(1);
    expect(doiPhut.sua).toHaveLength(0);
  });
  it("mô tả: bậc 0 là «ngay», cơ sở lạ rơi về mã (không ném); quy tắc không thuộc màn ⇒ rỗng", () => {
    expect(moTaQuyTac(tb(0, ["INTEGRATION_VIEWERS"], "cs-la"), ten)).toMatch(/ngay · cơ sở cs-la → Người xem Trung tâm kết nối AI/);
    expect(moTaQuyTac(route, ten)).toBe("");
  });
});
