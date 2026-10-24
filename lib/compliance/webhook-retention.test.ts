/**
 * S9-B7 — LUẬT lưu trữ dấu vết webhook + outbox sự kiện (phần THUẦN).
 *
 * File này CỐ Ý chỉ nạp `webhook-retention-rules` (không `@/lib/db`, không
 * `server-only`): job CI `unit-tests` chạy KHÔNG có Postgres và KHÔNG có biến
 * `DATABASE_URL`, nên một test kéo theo PrismaClient sẽ hoặc nổ, hoặc phải bọc
 * `skipIf` rồi im lặng bỏ qua — tức mất luôn lưới cho phần quan trọng nhất:
 * cái mốc thời gian và cái điều kiện `where` quyết định xoá dòng nào.
 *
 * Phần chạm DB thật nằm ở `tests/nen/webhook-retention.spec.ts` (job
 * `chat-db-tests`, có Postgres 16 — xem `.github/workflows/ci.yml`).
 */
import { describe, it, expect } from "vitest";
import {
  WEBHOOK_RETENTION_DAYS,
  TRANG_THAI_DOMAIN_EVENT_DA_XONG,
  mocCatLuuTru,
  dieuKienXoaWebhookDelivery,
  dieuKienXoaDomainEvent,
} from "@/lib/compliance/webhook-retention-rules";

const NGAY = 24 * 60 * 60 * 1_000;
const BAY_GIO = new Date("2026-06-15T00:00:00.000Z");

describe("S9-B7 · luật lưu trữ webhook (THUẦN)", () => {
  it("[ZC-18-R1] mặc định giữ 30 ngày", () => {
    expect(WEBHOOK_RETENTION_DAYS).toBe(30);
  });

  it("[ZC-18-R2] mốc cắt = bây giờ trừ đúng số ngày giữ lại", () => {
    expect(mocCatLuuTru(BAY_GIO).toISOString()).toBe("2026-05-16T00:00:00.000Z");
    expect(mocCatLuuTru(BAY_GIO, 1).toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });

  it("[ZC-18-R3] số ngày giữ lại < 1 hoặc không phải số ⇒ NÉM, không tự hiểu là 0", () => {
    // Đây là chốt an toàn thật, không phải phòng thủ thừa: `ngayGiuLai = 0` cho ra
    // mốc cắt = ĐÚNG BÂY GIỜ, tức xoá sạch cả dòng vừa ghi một giây trước. Một số
    // 0 lọt vào từ biến môi trường gõ nhầm (`Number("") === 0`) là đủ để mất cả
    // bảng mà không có lỗi nào.
    expect(() => mocCatLuuTru(BAY_GIO, 0)).toThrow();
    expect(() => mocCatLuuTru(BAY_GIO, -5)).toThrow();
    expect(() => mocCatLuuTru(BAY_GIO, Number.NaN)).toThrow();
  });

  it("[ZC-18-R4] WebhookDelivery lọc theo receivedAt, KHÔNG lọc theo trạng thái", () => {
    // Cả bảng đều là dấu vết chứa payload thô (tên + SĐT phụ huynh). Giữ lại dòng
    // FAILED thì đúng nhu cầu replay nhưng sai nhu cầu tuân thủ — và một dòng FAILED
    // quá 30 ngày thì cũng không còn ai replay nữa.
    const w = dieuKienXoaWebhookDelivery(new Date("2026-05-16T00:00:00.000Z"));
    expect(w).toEqual({ receivedAt: { lt: new Date("2026-05-16T00:00:00.000Z") } });
    expect(Object.keys(w)).not.toContain("status");
  });

  it("[ZC-18-R5] DomainEvent CHỈ xoá dòng đã xử lý xong", () => {
    const cutoff = new Date("2026-05-16T00:00:00.000Z");
    expect(dieuKienXoaDomainEvent(cutoff)).toEqual({
      status: { in: [...TRANG_THAI_DOMAIN_EVENT_DA_XONG] },
      createdAt: { lt: cutoff },
    });
  });

  it("[ZC-18-R6] tập trạng thái 'đã xong' KHÔNG chứa PENDING/PROCESSING/FAILED", () => {
    // PENDING/PROCESSING = đang chờ dispatcher, xoá là mất side-effect vĩnh viễn.
    // FAILED = đang cần điều tra, xoá là xoá luôn bằng chứng.
    for (const cam of ["PENDING", "PROCESSING", "FAILED"]) {
      expect(TRANG_THAI_DOMAIN_EVENT_DA_XONG as readonly string[]).not.toContain(cam);
    }
    expect(TRANG_THAI_DOMAIN_EVENT_DA_XONG as readonly string[]).toContain("DONE");
  });

  it("[ZC-18-R7] 'DONE' là chữ mà dispatcher thật sự ghi (không phải 'PROCESSED')", () => {
    // `DomainEvent.status` là String tự do, không enum ⇒ gõ sai một chữ thì cron
    // chạy hằng đêm, trả về 0, không lỗi, và bảng cứ phình mãi. Neo vào đúng chuỗi
    // mà `lib/events/dispatcher.ts` ghi khi xử lý xong.
    //
    // `PROCESSED` là trạng thái của bảng KHÁC (`WebhookStatus` của WebhookDelivery)
    // — hai bảng, hai bộ chữ, rất dễ lẫn.
    expect(TRANG_THAI_DOMAIN_EVENT_DA_XONG as readonly string[]).not.toContain("PROCESSED");
  });

  it("[ZC-18-R8] mốc cắt luôn là mốc TUYỆT ĐỐI, không phụ thuộc múi giờ máy chạy", () => {
    const a = mocCatLuuTru(BAY_GIO, 30).getTime();
    expect(BAY_GIO.getTime() - a).toBe(30 * NGAY);
  });
});
