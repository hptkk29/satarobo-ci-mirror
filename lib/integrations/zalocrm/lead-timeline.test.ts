// @vitest-environment node
/**
 * S5 (L8) — DÒNG THỜI GIAN LEAD cho tin nhắn đi qua nick Zalo cá nhân.
 *
 * Ghi một mốc lên phiếu lead nghe như việc vặt, nhưng đây là chỗ dễ làm hỏng
 * ĐÚNG HAI THỨ ĐO LƯỜNG mà cả cơ chế SLA dựa vào, và hỏng thì hỏng CÂM:
 *
 *  1. `type: "MESSAGE"` nằm trong `LEAD_OUTREACH_TYPES` ⇒ mỗi lượt ghi đóng
 *     VĨNH VIỄN `Lead.firstContactAt` (`updateMany where firstContactAt: null`,
 *     không có đường undo). Ghi cho một tin KHÁCH GỬI ĐẾN là tắt cảnh báo SLA-3
 *     ("Chưa liên hệ khách > 3 giờ") của một phiếu CHƯA AI NHẤC MÁY.
 *  2. Ghi `MESSAGE` cho lead CHƯA GIAO còn khoá luôn cơ chế tự chia lead:
 *     `hasSaleInteraction` (`lib/lead/auto-assign.ts`) đếm mọi dòng MESSAGE và
 *     coi phiếu đó là "sale đã tương tác" ⇒ không auto-chia nữa. Phiếu nằm im.
 *
 * Nên luật S-9 (chốt 27/08/2026) chia bốn ca, và bộ test này ghim đủ bốn:
 *
 *  | tin ĐÃ GỬI ĐI được          | ghi gì | làm mới đồng hồ |
 *  |-----------------------------|--------|-----------------|
 *  | có chủ, người gửi là chủ    | MESSAGE| CÓ              |
 *  | có chủ, người gửi là người khác | MESSAGE | KHÔNG      |
 *  | CHƯA giao cho ai            | NOTE máy | KHÔNG         |
 *  | TIN ĐẾN                     | không ghi gì | —         |
 *
 * ⚠️ Test mock `@/lib/db` nhưng KHÔNG mock `recordLeadActivity`: hai cú ghi phụ
 * (bump `lastActivityAt`, đóng `firstContactAt`) là thứ đang được kiểm, mock cửa
 * ghi đi là test còn lại chỉ kiểm chính mình.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const create = vi.fn();
  const update = vi.fn();
  const updateMany = vi.fn();
  return {
    create,
    update,
    updateMany,
    tx: { leadActivity: { create }, lead: { update, updateMany } },
    $transaction: vi.fn(),
  };
});

// `@/lib/db` dựng PrismaClient ngay lúc import (cần DATABASE_URL) — mock cả
// module để bộ test này THUẦN, chạy được ở mọi máy không có Postgres.
vi.mock("@/lib/db", () => ({ db: { $transaction: h.$transaction } }));

import {
  META_NEN_TANG_ZALO,
  META_NGUON_ZALOCRM,
  NGUOI_GUI_KHONG_MAP_DUOC,
  NOI_DUNG_TRONG,
  ghiMocNhanTinLead,
  quyetDinhMocNhanTin,
  type TinNhanZaloDeGhi,
} from "./lead-timeline";

const MOC = new Date("2026-09-06T03:00:00.000Z");

/** Ca nền: tin ĐI, đã gửi được, lead có chủ và chính chủ gõ. */
const nen = (chinhSua: Partial<TinNhanZaloDeGhi> = {}): TinNhanZaloDeGhi => ({
  leadId: "lead-1",
  inboxMessageId: "im-1",
  noiDung: "Chào chị, lớp Sata 1 khai giảng thứ 7 ạ",
  huong: "DI",
  daGuiDuoc: true,
  sentByUserId: "u-sale",
  actorName: "Sale A",
  assignedToId: "u-sale",
  coQuyenDieuPhoi: false,
  ...chinhSua,
});

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ id: "act-1", createdAt: MOC });
  h.update.mockReset().mockResolvedValue({ id: "lead-1" });
  h.updateMany.mockReset().mockResolvedValue({ count: 1 });
  h.$transaction.mockReset().mockImplementation(async (cb: (t: unknown) => unknown) => cb(h.tx));
});

// ─── Phần 1: LUẬT (hàm thuần, không chạm DB) ─────────────────────────────────

describe("[ZC-08] quyetDinhMocNhanTin — bốn ca của luật S-9", () => {
  it("[ZC-08a] lead có chủ, người gửi LÀ chủ phiếu ⇒ MESSAGE, làm mới đồng hồ", () => {
    const qd = quyetDinhMocNhanTin(nen());
    expect(qd.ghi).toBe(true);
    if (!qd.ghi) return;
    expect(qd.type).toBe("MESSAGE");
    expect(qd.lamMoiDongHo).toBe(true);
    expect(qd.metadata.system).toBeUndefined();
  });

  it("[ZC-08a'] người gửi KHÔNG phải chủ nhưng có quyền điều phối ⇒ vẫn làm mới", () => {
    const qd = quyetDinhMocNhanTin(
      nen({ sentByUserId: "u-quan-ly", coQuyenDieuPhoi: true }),
    );
    expect(qd.ghi && qd.type).toBe("MESSAGE");
    expect(qd.ghi && qd.lamMoiDongHo).toBe(true);
  });

  it("[ZC-08b] lead có chủ, người gửi là người KHÁC ⇒ MESSAGE nhưng KHÔNG làm mới", () => {
    // Dòng nhật ký vẫn phải lưu — đồng nghiệp nhắn hộ là việc hợp lệ. Thứ bị
    // chốt là đồng hồ, không phải quyền ghi.
    const qd = quyetDinhMocNhanTin(nen({ sentByUserId: "u-nguoi-la" }));
    expect(qd.ghi && qd.type).toBe("MESSAGE");
    expect(qd.ghi && qd.lamMoiDongHo).toBe(false);
  });

  it("[ZC-08c] lead CHƯA GIAO ⇒ NOTE mang dấu máy, KHÔNG phải MESSAGE", () => {
    // Đây là ca đắt nhất: ghi MESSAGE ở đây khoá luôn `hasSaleInteraction` ⇒
    // phiếu không bao giờ được tự chia cho ai nữa.
    const qd = quyetDinhMocNhanTin(nen({ assignedToId: null }));
    expect(qd.ghi).toBe(true);
    if (!qd.ghi) return;
    expect(qd.type).toBe("NOTE");
    expect(qd.metadata.system).toBe(true);
    expect(qd.lamMoiDongHo).toBe(false);
  });

  it("[ZC-08d] TIN ĐẾN ⇒ KHÔNG ghi gì, kể cả khi lead có chủ", () => {
    // Bump `lastActivityAt` cho tin đến là che mất đúng thứ cần cảnh báo:
    // "khách nhắn mà Sale im". Khối Hộp thư đọc thẳng `Inbox*` theo leadId.
    expect(quyetDinhMocNhanTin(nen({ huong: "DEN" }))).toEqual({
      ghi: false,
      lyDo: "TIN_DEN",
    });
  });

  it("[ZC-08d'] tin ĐI nhưng CHƯA gửi được ⇒ chưa ghi mốc nào", () => {
    // Tin còn ở hàng đợi / lỗi gửi không phải một lượt chạm khách.
    expect(quyetDinhMocNhanTin(nen({ daGuiDuoc: false }))).toEqual({
      ghi: false,
      lyDo: "CHUA_GUI_DUOC",
    });
  });

  it("[ZC-08e] content = `[Zalo] …`, metadata đủ 4 trường đối soát", () => {
    const qd = quyetDinhMocNhanTin(nen());
    expect(qd.ghi && qd.content).toBe("[Zalo] Chào chị, lớp Sata 1 khai giảng thứ 7 ạ");
    expect(qd.ghi && qd.metadata).toEqual({
      platform: META_NEN_TANG_ZALO,
      content: "Chào chị, lớp Sata 1 khai giảng thứ 7 ạ",
      via: META_NGUON_ZALOCRM,
      inboxMessageId: "im-1",
    });
  });

  it("nhãn nền tảng đúng chữ `Zalo` — huy hiệu của panel dòng thời gian đọc chuỗi này", () => {
    // `MESSAGE_PLATFORMS` của `lead-activity-panel.tsx` là ["SMS","Zalo","Messenger"].
    expect(META_NEN_TANG_ZALO).toBe("Zalo");
  });

  it("tin không có chữ (ảnh/sticker) ⇒ content vẫn khác rỗng", () => {
    // `LeadActivity.content` là cột NOT NULL và panel in thẳng chuỗi này.
    const qd = quyetDinhMocNhanTin(nen({ noiDung: "   " }));
    expect(qd.ghi && qd.content).toBe(`[Zalo] ${NOI_DUNG_TRONG}`);
    expect(qd.ghi && qd.metadata.content).toBe(NOI_DUNG_TRONG);
  });

  it("người gửi KHÔNG map được về User ⇒ không bao giờ là chủ phiếu", () => {
    // Nick lạ / tài khoản ZaloCRM chưa nối với User Sata. Fail-closed.
    const qd = quyetDinhMocNhanTin(nen({ sentByUserId: null }));
    expect(qd.ghi && qd.lamMoiDongHo).toBe(false);
    expect(NGUOI_GUI_KHONG_MAP_DUOC).not.toBe("");
  });

  it("🔴 sentinel người-gửi-không-map-được không được trùng dạng một `User.id`", () => {
    // Nếu nó trông như một id thật thì một ngày nào đó nó trùng `assignedToId`
    // và người-không-xác-định bỗng thành chủ phiếu.
    expect(NGUOI_GUI_KHONG_MAP_DUOC).toMatch(/[^a-z0-9]/);
  });
});

// ─── Phần 2: ĐƯỜNG GHI — đi qua `recordLeadActivity`, đúng transaction ───────

describe("[ZC-08] ghiMocNhanTinLead — hai cú ghi phụ đúng theo luật", () => {
  it("[ZC-08a] chủ phiếu gõ ⇒ tạo dòng + bump `lastActivityAt` + đóng `firstContactAt`", async () => {
    await ghiMocNhanTinLead(nen());

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.create.mock.calls[0][0].data).toMatchObject({
      leadId: "lead-1",
      actorId: "u-sale",
      actorName: "Sale A",
      type: "MESSAGE",
      content: "[Zalo] Chào chị, lớp Sata 1 khai giảng thứ 7 ạ",
    });
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0]).toEqual({
      where: { id: "lead-1" },
      data: { lastActivityAt: MOC },
    });
    expect(h.updateMany).toHaveBeenCalledTimes(1);
    expect(h.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "lead-1", firstContactAt: null },
      data: { firstContactAt: MOC },
    });
  });

  it("[ZC-08b] người khác gõ ⇒ dòng VẪN lưu, hai cột đồng hồ đứng im", async () => {
    await ghiMocNhanTinLead(nen({ sentByUserId: "u-nguoi-la" }));

    expect(h.create).toHaveBeenCalledTimes(1);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("[ZC-08c] lead chưa giao ⇒ NOTE có dấu máy, `firstContactAt` còn nguyên", async () => {
    await ghiMocNhanTinLead(nen({ assignedToId: null }));

    const data = h.create.mock.calls[0][0].data;
    expect(data.type).toBe("NOTE");
    expect(data.metadata).toMatchObject({ system: true });
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("[ZC-08c'] dấu máy giữ `firstContactAt` KHÔNG bị đóng ngay cả khi đồng hồ được làm mới", async () => {
    // Cấp quản lý nhắn một phiếu chưa giao: `lastActivityAt` bump là đúng (có
    // hoạt động thật), nhưng "đã liên hệ lần đầu" thì CHƯA — và SLA-3 phải còn
    // kêu cho tới khi có người thật sự nhận phiếu.
    await ghiMocNhanTinLead(
      nen({ assignedToId: null, sentByUserId: "u-quan-ly", coQuyenDieuPhoi: true }),
    );

    expect(h.create.mock.calls[0][0].data.type).toBe("NOTE");
    expect(h.update).toHaveBeenCalledTimes(1);
    expect(h.updateMany).not.toHaveBeenCalled();
  });

  it("[ZC-08d] TIN ĐẾN ⇒ không mở transaction, không tạo dòng nào", async () => {
    await ghiMocNhanTinLead(nen({ huong: "DEN" }));

    expect(h.$transaction).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("[ZC-08d'] tin chưa gửi được ⇒ không tạo dòng nào", async () => {
    await ghiMocNhanTinLead(nen({ daGuiDuoc: false }));

    expect(h.$transaction).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("người gửi không map được ⇒ `actorId: null` (đường máy), đồng hồ đứng im", async () => {
    await ghiMocNhanTinLead(nen({ sentByUserId: null, actorName: "Nick Zalo CS1" }));

    expect(h.create.mock.calls[0][0].data).toMatchObject({
      actorId: null,
      actorName: "Nick Zalo CS1",
    });
    expect(h.update).not.toHaveBeenCalled();
  });

  it("🔴 lỗi DB KHÔNG bị nuốt — webhook phải trả 5xx để bên gửi retry", async () => {
    // `recordLeadActivity` cấm bọc `.catch()`: bump hỏng mà dòng vẫn lưu thì
    // đồng hồ đứng im và không ai biết. Cùng luật ở đây.
    h.update.mockRejectedValueOnce(new Error("connection lost"));
    await expect(ghiMocNhanTinLead(nen())).rejects.toThrow("connection lost");
  });

  it("🔴 mọi cú ghi nằm TRONG một transaction duy nhất", async () => {
    await ghiMocNhanTinLead(nen());
    expect(h.$transaction).toHaveBeenCalledTimes(1);
  });
});
