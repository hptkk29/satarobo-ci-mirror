// `thuHoiThongBao` — đường THU HỒI thông báo (vá 08/09/2026).
//
// Trước bản vá này chuông của repo chưa từng có đường thu hồi: `entityId` được khai với ý
// "để SAU NÀY thu hồi khi đối tượng bị xoá" nhưng chưa ai làm. Hệ quả ở module lead là mỗi lượt
// đổi chủ để lại một chuông mồ côi ở người cũ.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => {
  // Khai tham số tường minh: `vi.fn(async () => …)` cho ra tuple RỖNG nên
  // `mock.calls[0][0]` không truy cập được và tsc đỏ.
  const updateMany = vi.fn(async (_a: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({
    count: 1,
  }));
  // Cho ca hồi quy A→B→A: chạy `ghiThongBaoNhanSu` THẬT trên một dòng đang REVOKED.
  const findMany = vi.fn(async (_a: unknown) => [] as unknown[]);
  const update = vi.fn(async (_a: unknown) => ({}));
  const upsert = vi.fn(async (_a: unknown) => ({}));
  return {
    updateMany,
    findMany,
    update,
    upsert,
    mockDb: { staffNotification: { updateMany, findMany, update, upsert } },
  };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/chat/broadcast", () => ({
  broadcastMessages: vi.fn(async () => true),
  notificationBumpBroadcasts: vi.fn(() => []),
}));

import { thuHoiThongBao, ghiThongBaoNhanSu } from "@/lib/notifications/notify";

beforeEach(() => {
  h.updateMany.mockReset().mockResolvedValue({ count: 1 });
  h.findMany.mockReset().mockResolvedValue([]);
  h.update.mockReset().mockResolvedValue({});
  h.upsert.mockReset().mockResolvedValue({});
});

/** Tham số của lượt updateMany đầu tiên. Ném lỗi có nghĩa nếu chưa gọi lần nào. */
function thamSo() {
  const a = h.updateMany.mock.calls[0]?.[0];
  if (!a) throw new Error("updateMany chưa được gọi lần nào");
  return a;
}

describe("[NOTI-THUHOI-T01] thu hồi đúng phạm vi", () => {
  it("chỉ đụng dòng đang ACTIVE, đúng người, đúng khoá", async () => {
    // Giới hạn `state: "ACTIVE"` là có chủ đích: một mục đã EXPIRED/REVOKED thì không có gì
    // để thu hồi nữa, và đè lại trạng thái của nó là ghi thừa vào đúng bảng mà sự cố egress
    // 05/09 dạy phải tiết chế.
    await thuHoiThongBao({ userIds: ["usr_a"], dedupeKey: "lead.moi:lead_1" });
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(thamSo()).toEqual({
      where: { userId: { in: ["usr_a"] }, dedupeKey: "lead.moi:lead_1", state: "ACTIVE" },
      data: { state: "REVOKED" },
    });
  });

  it("REVOKED chứ không xoá — giữ được vết đã từng báo cho ai", async () => {
    await thuHoiThongBao({ userIds: ["usr_a"], dedupeKey: "k" });
    const arg = thamSo();
    expect(arg.data).toEqual({ state: "REVOKED" });
  });

  it("lọc trùng và bỏ id rỗng", async () => {
    await thuHoiThongBao({ userIds: ["usr_a", "usr_a", "", "usr_b"], dedupeKey: "k" });
    const arg = thamSo().where.userId as { in: string[] };
    expect(arg.in).toEqual(["usr_a", "usr_b"]);
  });

  it("trả về số dòng đã thu hồi", async () => {
    h.updateMany.mockResolvedValue({ count: 3 });
    expect(await thuHoiThongBao({ userIds: ["usr_a"], dedupeKey: "k" })).toBe(3);
  });
});

describe("[NOTI-THUHOI-T02] không chạm DB khi không có gì để làm", () => {
  it("danh sách người rỗng", async () => {
    expect(await thuHoiThongBao({ userIds: [], dedupeKey: "k" })).toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("toàn id rỗng", async () => {
    expect(await thuHoiThongBao({ userIds: ["", ""], dedupeKey: "k" })).toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("khoá rỗng — KHÔNG được quét cả bảng", async () => {
    // Nếu để lọt `dedupeKey` rỗng thì `where` mất một vế và câu update quét theo mỗi userId,
    // tức thu hồi SẠCH mọi thông báo của người đó. Chặn ở đây, không dựa vào nơi gọi.
    expect(await thuHoiThongBao({ userIds: ["usr_a"], dedupeKey: "" })).toBe(0);
    expect(h.updateMany).not.toHaveBeenCalled();
  });
});

describe("[NOTI-THUHOI-T03] THU HỒI PHẢI ĐẢO NGƯỢC ĐƯỢC — ca A→B→A", () => {
  // Đây là ca mà lăng kính phản biện tìm ra sau khi ba cổng đã xanh: nếu `ghiThongBaoNhanSu`
  // không đọc và không so cột `state` thì REVOKED thành ngõ cụt MỘT CHIỀU. Lead chuyển từ A
  // sang B (chuông của A bị thu hồi) rồi chuyển TRẢ về A: nội dung y hệt ⇒ `continue` ⇒ không
  // ghi, không rung, dòng nằm REVOKED vĩnh viễn ⇒ A không bao giờ biết mình được trả lead.
  // Tệ hơn hiện trạng trước bản vá, vì lúc đó A ít nhất còn giữ cái chuông cũ.

  /** Dòng cũ của A, nội dung Y HỆT thứ `baoSaleCoLeadMoi` sẽ dựng lại. */
  function dongCu(state: string) {
    return {
      userId: "usr_a",
      readAt: null,
      title: "Bạn có lead mới",
      body: 'Lead "Chị Lan" vừa được chia cho bạn. Gọi sớm giúp tăng tỉ lệ chốt.',
      href: "/leads/lead_1",
      groupKey: "action_required",
      priority: 1,
      entityType: "lead",
      entityId: "lead_1",
      expiresAt: null,
      state,
    };
  }

  const noiDungY_HET = {
    userIds: ["usr_a"],
    dedupeKey: "lead.moi:lead_1",
    title: "Bạn có lead mới",
    body: 'Lead "Chị Lan" vừa được chia cho bạn. Gọi sớm giúp tăng tỉ lệ chốt.',
    href: "/leads/lead_1",
    entityId: "lead_1",
  };

  it("dòng đang REVOKED + nội dung y hệt → VẪN ghi lại, bật ACTIVE, và rung", async () => {
    h.findMany.mockResolvedValue([dongCu("REVOKED")]);
    const kq = await ghiThongBaoNhanSu(noiDungY_HET);

    expect(h.update).toHaveBeenCalledTimes(1);
    const data = (h.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.state).toBe("ACTIVE");
    expect(data.readAt).toBeNull();
    // Người nhận phải được RUNG: đây là một lần phát sinh mới, không phải bản trùng.
    expect(kq.canRung).toEqual(["usr_a"]);
  });

  it("dòng đang ACTIVE + nội dung y hệt → vẫn KHÔNG ghi, KHÔNG rung (giữ bài học egress 05/09)", async () => {
    h.findMany.mockResolvedValue([dongCu("ACTIVE")]);
    const kq = await ghiThongBaoNhanSu(noiDungY_HET);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
    expect(kq.canRung).toEqual([]);
  });

  it("dòng EXPIRED cũng sống lại — cùng một luật, không phải ngoại lệ riêng cho REVOKED", async () => {
    h.findMany.mockResolvedValue([dongCu("EXPIRED")]);
    const kq = await ghiThongBaoNhanSu(noiDungY_HET);
    expect(h.update).toHaveBeenCalledTimes(1);
    expect((h.update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data.state).toBe(
      "ACTIVE",
    );
    expect(kq.canRung).toEqual(["usr_a"]);
  });
});
