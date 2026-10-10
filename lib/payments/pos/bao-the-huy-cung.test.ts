// lib/payments/pos/bao-the-huy-cung.test.ts — VIỆC 6 (chốt, rà đối kháng): BÁO NGƯỜI TẠO PHIẾU THẺ khi phiếu của họ bị HUỶ KÈM bởi "Dừng học" / "Đổi khoá". THUẦN (mock `notifyStaff`).
//
// Vì sao: người bấm Dừng học thấy hộp xác nhận + toast, nhưng người đang giữ phiếu thẻ (sale ở quầy, khách đứng cạnh máy) KHÔNG thấy gì — hộp của họ đóng im lặng ở lần làm mới kế tiếp.
// Khách quẹt theo mã cũ thì tiền vào hàng chờ gắn tay (đúng như chủ dự án chốt), nhưng sale đã phát mã mới cho phần còn nợ ⇒ quẹt lần hai. Thông báo là tín hiệu duy nhất đến ĐÚNG người.
//
// Luật: SAU commit (hàm không nhận `tx`) · KHÔNG BAO GIỜ làm hỏng việc đã commit (nuốt lỗi) · không báo chính người bấm · một thông báo cho MỘT phiếu (dedupe theo phiếu) ·
// nội dung KHÔNG số tiền / tên khách / SĐT (như `pos.sai-ma:`).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({ notifyStaff: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/notify", () => ({ notifyStaff: h.notifyStaff }));

import { baoNguoiTaoTheDaHuy } from "./bao-the-huy-cung";

const THE = (intentId: string, ma: string, nguoiTaoId: string) => ({ intentId, ma, trangThaiTruoc: "CHO_QUET" as const, nguoiTaoId });

beforeEach(() => {
  vi.clearAllMocks();
  h.notifyStaff.mockResolvedValue(1);
});

describe("[HN6-BT] baoNguoiTaoTheDaHuy", () => {
  it("[HN6-BT-01] báo ĐÚNG người tạo từng phiếu, mỗi phiếu một thông báo có dedupeKey riêng, nội dung có mã phiếu + lệnh 'ĐỪNG cho khách quẹt', trỏ về trang đơn", async () => {
    await baoNguoiTaoTheDaHuy({ orderId: "o1", nguon: "DUNG_HOC", actorId: "quan-ly", daHuy: [THE("i1", "H6WR4", "sale-a"), THE("i2", "K7M2N", "sale-b")] });
    expect(h.notifyStaff).toHaveBeenCalledTimes(2);
    const goi = h.notifyStaff.mock.calls.map((c) => c[0] as { userIds: string[]; dedupeKey: string; title: string; body: string; href: string; entityId: string });
    expect(goi.map((g) => g.userIds)).toEqual([["sale-a"], ["sale-b"]]);
    expect(new Set(goi.map((g) => g.dedupeKey)).size, "dedupe riêng từng phiếu").toBe(2);
    expect(goi[0]!.dedupeKey).toBe("pos.the-huy-cung:i1");
    expect(goi[0]!.body).toMatch(/H6WR4/);
    expect(goi[0]!.body).toMatch(/dừng học/i);
    expect(goi[0]!.body).toMatch(/ĐỪNG cho khách quẹt/);
    expect(goi[0]!.href).toBe("/orders/o1");
    expect(goi[0]!.entityId).toBe("o1");
  });

  it("[HN6-BT-02] đổi khoá nói 'đổi khoá', không nói 'dừng học' (hai đường dùng chung thân nhưng người đọc cần đúng việc đã làm)", async () => {
    await baoNguoiTaoTheDaHuy({ orderId: "o1", nguon: "DOI_KHOA", actorId: "quan-ly", daHuy: [THE("i1", "H6WR4", "sale-a")] });
    const g = h.notifyStaff.mock.calls[0]![0] as { body: string };
    expect(g.body).toMatch(/đổi khoá/i);
    expect(g.body).not.toMatch(/dừng học/i);
  });

  it("[HN6-BT-03] ĐỐI CHỨNG DƯƠNG — người tạo phiếu CHÍNH LÀ người bấm ⇒ không báo họ (họ vừa thấy hộp xác nhận); người khác vẫn được báo", async () => {
    await baoNguoiTaoTheDaHuy({ orderId: "o1", nguon: "DUNG_HOC", actorId: "sale-a", daHuy: [THE("i1", "H6WR4", "sale-a"), THE("i2", "K7M2N", "sale-b")] });
    expect(h.notifyStaff).toHaveBeenCalledTimes(1);
    expect((h.notifyStaff.mock.calls[0]![0] as { userIds: string[] }).userIds).toEqual(["sale-b"]);
  });

  it("[HN6-BT-04] không phiếu nào bị huỷ ⇒ không gọi gì", async () => {
    await baoNguoiTaoTheDaHuy({ orderId: "o1", nguon: "DUNG_HOC", actorId: "quan-ly", daHuy: [] });
    expect(h.notifyStaff).not.toHaveBeenCalled();
  });

  it("[HN6-BT-05] thông báo LỖI không làm hỏng việc đã commit: hàm không ném, phiếu sau vẫn được báo", async () => {
    h.notifyStaff.mockRejectedValueOnce(new Error("redis chết"));
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(baoNguoiTaoTheDaHuy({ orderId: "o1", nguon: "DUNG_HOC", actorId: "quan-ly", daHuy: [THE("i1", "H6WR4", "sale-a"), THE("i2", "K7M2N", "sale-b")] })).resolves.toBeUndefined();
    expect(h.notifyStaff, "phiếu thứ hai vẫn được thử").toHaveBeenCalledTimes(2);
    loi.mockRestore();
  });

  it("[HN6-BT-06] nội dung KHÔNG mang số tiền / tên khách / SĐT (chỉ mã phiếu — như `pos.sai-ma:`)", async () => {
    await baoNguoiTaoTheDaHuy({ orderId: "o1", nguon: "DUNG_HOC", actorId: "quan-ly", daHuy: [THE("i1", "H6WR4", "sale-a")] });
    const g = h.notifyStaff.mock.calls[0]![0] as { title: string; body: string };
    expect(`${g.title} ${g.body}`).not.toMatch(/\d{1,3}([.,]\d{3})+\s*đ|\b0\d{9}\b|VND/);
  });
});

describe("[HN6-BT-W] DÂY NỐI — chỉ ca hành vi không chứng minh được 'có ai gọi hàm này không'", () => {
  const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  const boChuThich = (s: string) => s.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  const dem = (s: string, re: RegExp) => [...s.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))].length;

  it("[HN6-BT-W1] dừng học và đổi khoá mỗi nơi gọi ĐÚNG MỘT lần, với nguồn đúng, và gọi SAU transaction (ngoài `ghiTienChoDon`)", () => {
    const dungHoc = boChuThich(doc("lib/finance/dung-hoc-con.ts"));
    const doiKhoa = boChuThich(doc("lib/finance/doi-khoa-db.ts"));
    expect(dem(dungHoc, /\bbaoNguoiTaoTheDaHuy\(\{/), "dừng học").toBe(1);
    expect(dem(dungHoc, /nguon: "DUNG_HOC"/)).toBe(1);
    expect(dem(doiKhoa, /\bbaoNguoiTaoTheDaHuy\(\{/), "đổi khoá").toBe(1);
    expect(dem(doiKhoa, /nguon: "DOI_KHOA"/)).toBe(1);
    // Sau transaction: lời gọi đứng SAU `ghiTienChoDon(` trong tệp, và chỉ khi kết quả `ok`.
    expect(dungHoc.indexOf("baoNguoiTaoTheDaHuy({")).toBeGreaterThan(dungHoc.indexOf("await ghiTienChoDon("));
    expect(doiKhoa.indexOf("baoNguoiTaoTheDaHuy({")).toBeGreaterThan(doiKhoa.indexOf("await ghiTienChoDon("));
    expect(dem(dungHoc, /if \(!kq\.ok\) return kq;\s*const \{ theDaHuy, \.\.\.ra \} = kq;\s*await baoNguoiTaoTheDaHuy\(/), "chỉ báo khi ghi thành công, và bóc id người dùng khỏi kết quả trả client").toBe(1);
    expect(dem(doiKhoa, /if \(kq\.ok\) await baoNguoiTaoTheDaHuy\(/), "chỉ báo khi ghi thành công").toBe(1);
  });

  it("[HN6-BT-W2] hàm báo KHÔNG nhận `tx` và không tự mở transaction (thông báo ngoài transaction đang giữ khoá)", () => {
    const m = boChuThich(doc("lib/payments/pos/bao-the-huy-cung.ts"));
    expect(dem(m, /\btx\b/)).toBe(0);
    expect(dem(m, /\$transaction/)).toBe(0);
    expect(dem(m, /\bnotifyStaff\(/), "đúng một lời gọi, trong vòng lặp từng phiếu").toBe(1);
  });
});
