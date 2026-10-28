// N-2 — luật "một đơn – một con" (quyết định B4, 24/08/2026).
//
// Thứ đắt nhất mà bộ test này canh: KHÔNG ĐOÁN. Phiếu 2 con mà hệ thống tự chọn một
// đứa là doanh thu của đứa kia biến mất, tổng vẫn khớp nên không ai thấy.
import { describe, it, expect } from "vitest";
import {
  inferLeadChildIdFromChildren,
  inferLeadChildIdForConvert,
  resolveOrderLeadChildId,
} from "./lead-child-link";

const con = (id: string, leadId = "lead-1") => ({ id, leadId });

describe("[N-2] inferLeadChildIdFromChildren — chỉ suy khi không thể sai", () => {
  it("phiếu KHÔNG có con → null", () => {
    expect(inferLeadChildIdFromChildren([])).toBeNull();
  });

  it("phiếu ĐÚNG 1 con → suy ra con đó", () => {
    expect(inferLeadChildIdFromChildren([con("c1")])).toBe("c1");
  });

  it("phiếu 2 con → null, KHÔNG chọn bừa đứa đầu", () => {
    expect(inferLeadChildIdFromChildren([con("c1"), con("c2")])).toBeNull();
  });
});

describe("[N-2] inferLeadChildIdForConvert — chốt ghi danh", () => {
  it("chốt đúng 1 học viên có gắn con → quy về con đó", () => {
    expect(inferLeadChildIdForConvert([{ leadChildId: "c1" }])).toBe("c1");
  });

  it("chốt 1 học viên KHÔNG gắn con (nhập tay) → null", () => {
    expect(inferLeadChildIdForConvert([{ leadChildId: null }])).toBeNull();
    expect(inferLeadChildIdForConvert([{}])).toBeNull();
    expect(inferLeadChildIdForConvert([{ leadChildId: "   " }])).toBeNull();
  });

  it("chốt 2 học viên cùng lượt → null (một đơn backfill chung, không chia được)", () => {
    expect(inferLeadChildIdForConvert([{ leadChildId: "c1" }, { leadChildId: "c2" }])).toBeNull();
  });

  it("chốt 0 học viên → null", () => {
    expect(inferLeadChildIdForConvert([])).toBeNull();
  });
});

describe("[N-2] resolveOrderLeadChildId — đường tạo đơn", () => {
  it("không chọn con + phiếu 1 con → tự suy, đánh dấu inferred", () => {
    const r = resolveOrderLeadChildId({
      leadId: "lead-1",
      requestedLeadChildId: null,
      children: [con("c1")],
    });
    expect(r).toEqual({ ok: true, leadChildId: "c1", inferred: true });
  });

  it("không chọn con + phiếu 2 con → null, đơn vẫn tạo được (không chặn bán hàng)", () => {
    const r = resolveOrderLeadChildId({
      leadId: "lead-1",
      requestedLeadChildId: "",
      children: [con("c1"), con("c2")],
    });
    expect(r).toEqual({ ok: true, leadChildId: null, inferred: false });
  });

  it("đơn vãng lai (không phiếu, không chọn con) → null, không lỗi", () => {
    const r = resolveOrderLeadChildId({
      leadId: null,
      requestedLeadChildId: null,
      children: [],
    });
    expect(r).toEqual({ ok: true, leadChildId: null, inferred: false });
  });

  it("chọn con nhưng KHÔNG gắn phiếu → từ chối", () => {
    const r = resolveOrderLeadChildId({
      leadId: "  ",
      requestedLeadChildId: "c1",
      children: [con("c1")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LEAD_CHILD_NEEDS_LEAD");
  });

  it("chọn con của PHIẾU KHÁC → từ chối (chống gắn chéo qua payload)", () => {
    const r = resolveOrderLeadChildId({
      leadId: "lead-1",
      requestedLeadChildId: "c9",
      children: [con("c9", "lead-2"), con("c1")],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LEAD_CHILD_NOT_IN_LEAD");
  });

  it("chọn con KHÔNG tồn tại / ngoài tầm nhìn (danh sách rỗng) → từ chối", () => {
    const r = resolveOrderLeadChildId({
      leadId: "lead-1",
      requestedLeadChildId: "khong-co",
      children: [],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("LEAD_CHILD_NOT_IN_LEAD");
  });

  it("chọn đúng con của phiếu → dùng đúng con đó, inferred = false", () => {
    const r = resolveOrderLeadChildId({
      leadId: "lead-1",
      requestedLeadChildId: " c2 ",
      children: [con("c1"), con("c2")],
    });
    expect(r).toEqual({ ok: true, leadChildId: "c2", inferred: false });
  });
});
