// @vitest-environment node
/**
 * [DNX-*] — "đổi nguồn sau thu chưa đi hết quy trình duyệt" (hàm THUẦN). Hành vi đầu-cuối (Postgres thật) ở tests/hoa-hong/so-dieu-chinh.spec.ts [DNS-V5..V7].
 */
import { describe, expect, it } from "vitest";

import { suKienDoiNguonChuaXong, type DeXuatDoiNguonCuaO, type SuKienDoiNguon } from "./doi-nguon-chua-xong";

// Mốc thời gian là ĐẦU VÀO tường minh (luật 19: không đọc đồng hồ thật). Trong sản phẩm cả hai cột đều do Postgres đóng dấu.
const T = (giay: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, giay));
const ev = (id: string, status: string, giay = 10): SuKienDoiNguon => ({ id, status, createdAt: T(giay) });
const dx = (refEventId: string | null, status: string, giay = 20): DeXuatDoiNguonCuaO => ({ refEventId, status, createdAt: T(giay) });
const ids = (r: readonly SuKienDoiNguon[]) => r.map((x) => x.id);

describe("[DNX] suKienDoiNguonChuaXong", () => {
  it("[DNX-01] sự kiện CHƯA được xử lý (PENDING / PROCESSING / FAILED), ô chưa có đề xuất ⇒ chặn — đúng khoảng hở RVX-C", () => {
    for (const status of ["PENDING", "PROCESSING", "FAILED"]) expect(ids(suKienDoiNguonChuaXong([ev("e1", status)], [])), status).toEqual(["e1"]);
  });

  it("[DNX-02] sự kiện DONE, ô KHÔNG có đề xuất nào của nó ⇒ không chặn (consumer đã xem, không có gì để lập)", () => {
    expect(suKienDoiNguonChuaXong([ev("e1", "DONE")], [])).toEqual([]);
    expect(suKienDoiNguonChuaXong([ev("e1", "DONE")], [dx("e-khac", "REJECTED")])).toEqual([]); // đề xuất của sự kiện KHÁC không liên quan
  });

  it("[DNX-03] đề xuất của sự kiện đã POSTED ⇒ ô khớp nguồn mới, KHÔNG chặn — kể cả khi bản ghi sự kiện còn PENDING (dispatcher chưa kịp đánh dấu)", () => {
    expect(suKienDoiNguonChuaXong([ev("e1", "PENDING")], [dx("e1", "POSTED")])).toEqual([]);
    expect(suKienDoiNguonChuaXong([ev("e1", "DONE")], [dx("e1", "POSTED")])).toEqual([]);
  });

  it("[DNX-04] đề xuất của sự kiện bị TỪ CHỐI / LỖI THỜI / đang CHỜ (kể cả sự kiện DONE) ⇒ chặn: đề xuất kết thúc mà không ghi không được 'Áp dụng' bù", () => {
    for (const status of ["REJECTED", "STALE", "PENDING", "APPROVED_L1"]) expect(ids(suKienDoiNguonChuaXong([ev("e1", "DONE")], [dx("e1", status)])), status).toEqual(["e1"]);
  });

  it("[DNX-05] hai sự kiện: chỉ trả sự kiện chưa giải — POSTED của e1 không giải e2", () => {
    const r = suKienDoiNguonChuaXong([ev("e1", "DONE"), ev("e2", "PENDING")], [dx("e1", "POSTED")]);
    expect(ids(r)).toEqual(["e2"]);
    // một đề xuất POSTED + một REJECTED cho CÙNG sự kiện (không xảy ra do chỉ mục, nhưng POSTED thắng): coi như giải
    expect(suKienDoiNguonChuaXong([ev("e1", "DONE")], [dx("e1", "REJECTED"), dx("e1", "POSTED")])).toEqual([]);
  });

  it("[DNX-06] không có sự kiện nào ⇒ rỗng; thuần: không sửa đầu vào, gọi lặp ra y hệt, thứ tự theo đầu vào", () => {
    expect(suKienDoiNguonChuaXong([], [dx("e1", "REJECTED")])).toEqual([]);
    const a = [ev("e2", "PENDING"), ev("e1", "FAILED")];
    const b = [dx("e2", "STALE")];
    const truoc = JSON.stringify([a, b]);
    expect(ids(suKienDoiNguonChuaXong(a, b))).toEqual(["e2", "e1"]);
    expect(ids(suKienDoiNguonChuaXong(a, b))).toEqual(["e2", "e1"]);
    expect(JSON.stringify([a, b])).toBe(truoc);
  });

  it("[DNX-07] đề xuất không có sự kiện (refEventId null) không giải và không bị coi là của sự kiện nào", () => {
    expect(ids(suKienDoiNguonChuaXong([ev("e1", "PENDING")], [dx(null, "POSTED")]))).toEqual(["e1"]);
  });

  // ── [DNX-08..11] sự kiện FAILED không được khoá "Áp dụng" vĩnh viễn (08 §17.R3b mục 1 "khe FAILED", vá ở §17.v4.Q) ─────────────────────────────────────────────────────
  // Dispatcher không có đường requeue FAILED, và đề xuất lập bằng script backfill mang `refEventId = audit:<id>` nên KHÔNG khớp `DomainEvent.id` ⇒ trước đây không gỡ được cổng.
  it("[DNX-08] sự kiện FAILED, ô có đề xuất POSTED của đường khác (audit:…) lập SAU sự kiện ⇒ đã xong, KHÔNG chặn (kể cả đúng cùng mốc: biên >=)", () => {
    expect(suKienDoiNguonChuaXong([ev("e1", "FAILED", 10)], [dx("audit:a1", "POSTED", 20)])).toEqual([]);
    expect(suKienDoiNguonChuaXong([ev("e1", "FAILED", 10)], [dx("audit:a1", "POSTED", 10)])).toEqual([]);
  });

  it("[DNX-09] ĐỐI CHỨNG ÂM — đề xuất POSTED lập TRƯỚC sự kiện FAILED (của một lần đổi nguồn cũ) KHÔNG mở khoá cho lần đổi mới: nếu không thì một đề xuất cũ mở lại đường một-người", () => {
    expect(ids(suKienDoiNguonChuaXong([ev("e2", "FAILED", 30)], [dx("e1", "POSTED", 20)]))).toEqual(["e2"]);
    expect(ids(suKienDoiNguonChuaXong([ev("e2", "FAILED", 30)], [dx("audit:a0", "POSTED", 29)]))).toEqual(["e2"]);
  });

  it("[DNX-10] chỉ FAILED được mở bằng đề xuất của đường khác: PENDING / PROCESSING còn chờ consumer; đề xuất sau đó mà CHƯA POSTED (đang chờ · bị từ chối · lỗi thời) cũng không giải", () => {
    for (const status of ["PENDING", "PROCESSING"]) expect(ids(suKienDoiNguonChuaXong([ev("e1", status, 10)], [dx("audit:a1", "POSTED", 20)])), status).toEqual(["e1"]);
    for (const status of ["PENDING", "APPROVED_L1", "REJECTED", "STALE"]) expect(ids(suKienDoiNguonChuaXong([ev("e1", "FAILED", 10)], [dx("audit:a1", status, 20)])), status).toEqual(["e1"]);
  });

  it("[DNX-11] hai sự kiện FAILED: đề xuất POSTED giữa hai mốc chỉ giải sự kiện ĐẾN TRƯỚC nó, không giải sự kiện đến sau", () => {
    const r = suKienDoiNguonChuaXong([ev("e1", "FAILED", 10), ev("e2", "FAILED", 30)], [dx("audit:a1", "POSTED", 20)]);
    expect(ids(r)).toEqual(["e2"]);
  });
});
