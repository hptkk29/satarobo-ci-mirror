// Đường GHI việc-cần-đẩy. Không chạm Postgres — `@/lib/db` mock.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const createMany = vi.fn(async (_a: { data: unknown[]; skipDuplicates?: boolean }) => ({
    count: 0,
  }));
  /** Danh sách loại được đẩy — mặc định của hệ. Ca đọc-hỏng tự đặt lại trong chính ca đó. */
  const getGlobalSetting = vi.fn(async (_k: string) => ["lead.moi:"] as unknown);
  return { createMany, getGlobalSetting, mockDb: { webPushOutbox: { createMany } } };
});

vi.mock("@/lib/db", () => ({ db: h.mockDb }));
vi.mock("@/lib/settings/read-global", () => ({ getGlobalSetting: h.getGlobalSetting }));

import { ghiOutboxPush, HAN_MAC_DINH_MS } from "./outbox";
import { LY_DO_NGOAI_DANH_SACH } from "./cau-hinh-allowlist";

const NOW = new Date("2026-09-08T10:00:00.000Z");

/** Tham số của lần `createMany` gần nhất. */
function goi(): { data: Record<string, unknown>[]; skipDuplicates?: boolean } {
  const c = h.createMany.mock.calls.at(-1)?.[0];
  if (!c) throw new Error("createMany chưa được gọi lần nào");
  return c as { data: Record<string, unknown>[]; skipDuplicates?: boolean };
}

beforeEach(() => {
  h.createMany.mockReset().mockResolvedValue({ count: 1 });
  h.getGlobalSetting.mockReset().mockResolvedValue(["lead.moi:"]);
});

describe("[PUSH-D4-T24] lọc theo allowlist ngay ở đường ghi", () => {
  it("lead.moi: ⇒ ghi PENDING", async () => {
    await ghiOutboxPush({ userIds: ["u1"], dedupeKey: "lead.moi:lead_1", now: NOW });
    expect(goi().data).toEqual([
      expect.objectContaining({
        userId: "u1",
        dedupeKey: "lead.moi:lead_1",
        status: "PENDING",
      }),
    ]);
  });

  it("loại KHÔNG được bật ⇒ VẪN ghi, nhưng thẳng SKIPPED + có lý do", async () => {
    // Ghi chứ không bỏ qua: đây là sổ trả lời câu "vì sao tôi không nhận được thông báo X".
    // Không có dòng nào thì người hỏi không phân biệt được "loại này cố ý không đẩy" với
    // "kênh hỏng", và cách duy nhất tìm ra là đọc mã nguồn.
    await ghiOutboxPush({ userIds: ["u1"], dedupeKey: "sla:SLA-1:lead_1", now: NOW });
    const d = goi().data[0];
    expect(d).toMatchObject({ status: "SKIPPED" });
    // Neo vào HẰNG được export chứ không vào một mẩu chuỗi: sửa câu chữ cho dễ hiểu hơn là
    // việc nên làm, không phải việc phải làm đỏ một test (luật 11).
    expect(d?.lastError).toBe(LY_DO_NGOAI_DANH_SACH);
  });

  it("người vận hành BẬT thêm loại đó ⇒ chính khoá ấy ghi PENDING", async () => {
    // Đây là ca chứng minh cấu hình THẬT SỰ điều khiển đường ghi — không phải chỉ hiện trên
    // màn hình. Cùng một khoá `sla:`, chỉ khác danh sách, cho hai kết quả ngược nhau.
    h.getGlobalSetting.mockResolvedValue(["lead.moi:", "sla:"]);
    await ghiOutboxPush({ userIds: ["u1"], dedupeKey: "sla:SLA-1:lead_1", now: NOW });
    expect(goi().data[0]).toMatchObject({ status: "PENDING" });
  });

  it("danh sách RỖNG ⇒ mọi loại đều SKIPPED, kể cả lead.moi:", async () => {
    // Bỏ chọn hết trên màn cấu hình = tắt kênh theo loại. Nếu rỗng bị hiểu thành "bật hết"
    // thì đúng cú bấm ấy sẽ đẩy toàn bộ 51 loại vào máy mọi nhân viên.
    h.getGlobalSetting.mockResolvedValue([]);
    await ghiOutboxPush({ userIds: ["u1"], dedupeKey: "lead.moi:lead_1", now: NOW });
    expect(goi().data[0]).toMatchObject({ status: "SKIPPED" });
  });

  it("⚠️ ĐỌC CẤU HÌNH HỎNG ⇒ giữ PENDING, KHÔNG chốt SKIPPED", async () => {
    // `SKIPPED` là trạng thái CHỐT — engine chỉ quét PENDING/FAILED — nên chốt nó vì một cú
    // chập DB 2 giây là XOÁ SỔ mọi thông báo đẩy đang chờ, không lượt nào cứu được.
    //
    // Đây KHÔNG phải fail-open: quyết định gửi nằm ở engine, và engine đọc lại danh sách
    // trước khi bắn; nếu chính nó cũng không đọc được thì nó thoát cả lượt. Không cú push nào
    // rời máy mà chưa đọc được cấu hình một lần thành công.
    h.getGlobalSetting.mockRejectedValue(new Error("P1001 không tới được DB"));
    await ghiOutboxPush({ userIds: ["u1"], dedupeKey: "sla:SLA-1:lead_1", now: NOW });
    expect(goi().data[0]).toMatchObject({ status: "PENDING" });
  });
});

describe("[PUSH-D4-T25] chống trùng và hạn sống", () => {
  it("skipDuplicates BẬT — dòng đã có KHÔNG bị kéo về PENDING", async () => {
    // Nếu đây là `upsert` thì mỗi lần `reopen` kéo một mục đã đọc về chưa đọc sẽ là một lần
    // đẩy lại, kể cả khi dòng cũ đã SENT và người ta đã cầm máy đọc rồi. 4 nơi trong repo đang
    // bật `reopen: true`.
    await ghiOutboxPush({ userIds: ["u1"], dedupeKey: "lead.moi:lead_1", now: NOW });
    expect(goi().skipDuplicates).toBe(true);
  });

  it("hạn mặc định 6 giờ — ngày bật công tắc KHÔNG xả tin cũ hàng loạt", async () => {
    // Công tắc đang TẮT mà điểm móc vẫn ghi dòng PENDING. Không có hạn thì ngày ai đó gạt bật
    // là mọi dòng tồn từ trước bay ra cùng lúc.
    await ghiOutboxPush({ userIds: ["u1"], dedupeKey: "lead.moi:lead_1", now: NOW });
    expect(goi().data[0]?.expiresAt).toEqual(new Date(NOW.getTime() + HAN_MAC_DINH_MS));
  });

  it("hạn của chính thông báo NGẮN hơn ⇒ lấy mốc sớm hơn", async () => {
    const som = new Date(NOW.getTime() + 60_000);
    await ghiOutboxPush({
      userIds: ["u1"],
      dedupeKey: "lead.moi:lead_1",
      expiresAt: som,
      now: NOW,
    });
    expect(goi().data[0]?.expiresAt).toEqual(som);
  });

  it("hạn của thông báo DÀI hơn (badge 30 ngày) ⇒ vẫn kẹp về 6 giờ", async () => {
    await ghiOutboxPush({
      userIds: ["u1"],
      dedupeKey: "lead.moi:lead_1",
      expiresAt: new Date(NOW.getTime() + 30 * 24 * 3600_000),
      now: NOW,
    });
    expect(goi().data[0]?.expiresAt).toEqual(new Date(NOW.getTime() + HAN_MAC_DINH_MS));
  });
});

describe("[PUSH-D4-T26] danh sách người nhận", () => {
  it("lọc trùng và id rỗng", async () => {
    await ghiOutboxPush({
      userIds: ["u1", "u1", "", "u2"],
      dedupeKey: "lead.moi:lead_1",
      now: NOW,
    });
    expect(goi().data.map((d) => d.userId)).toEqual(["u1", "u2"]);
  });

  it("danh sách rỗng ⇒ không gọi DB", async () => {
    expect(await ghiOutboxPush({ userIds: [], dedupeKey: "lead.moi:x" })).toBe(0);
    expect(await ghiOutboxPush({ userIds: ["", ""], dedupeKey: "lead.moi:x" })).toBe(0);
    expect(h.createMany).not.toHaveBeenCalled();
  });

  it("dedupeKey rỗng ⇒ không gọi DB", async () => {
    expect(await ghiOutboxPush({ userIds: ["u1"], dedupeKey: "" })).toBe(0);
    expect(h.createMany).not.toHaveBeenCalled();
  });
});

describe("[PUSH-D4-T27] KHÔNG BAO GIỜ NÉM", () => {
  it("bảng chưa tồn tại (migration chưa chạy) ⇒ nuốt lỗi, trả 0", async () => {
    // Hàm này được gọi từ `notifyStaff` — đường ghi DUY NHẤT của mọi thông báo nhân sự. Lỗi
    // lọt ra ngoài sẽ làm hỏng điểm danh, giao bài, chuyển lead… mọi thứ có chuông. Và ca này
    // đang chờ sẵn: migration hai bảng push CHƯA chạy ở môi trường nào.
    h.createMany.mockRejectedValue(
      Object.assign(new Error('The table `public.WebPushOutbox` does not exist'), {
        code: "P2021",
      }),
    );
    await expect(
      ghiOutboxPush({ userIds: ["u1"], dedupeKey: "lead.moi:lead_1" }),
    ).resolves.toBe(0);
  });
});
