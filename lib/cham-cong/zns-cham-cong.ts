import "server-only";
// lib/cham-cong/zns-cham-cong.ts — P2.6 bộ chuyển ZNS cho nhân sự (chấm công), đi qua DomainEvent có sẵn.
//
// Luồng: Server Action (sau khi đã ghi thông báo trong ứng dụng) ⇒ `phatZnsChamCong` ghi một DomainEvent
// `cham-cong.zns` có `dedupeKey` ⇒ dispatcher chạy `xuLyZnsChamCong` ⇒ `sendZaloNotification`.
//   · Không có hệ thống sự kiện mới, không bảng mới: dùng outbox `DomainEvent` + `ZaloMessageLog` sẵn có.
//   · THỬ LẠI do dispatcher lo: gửi LỖI (FAILED) ⇒ handler NÉM ⇒ sự kiện về PENDING, lượt sau chạy lại (tới
//     `maxAttempts`). Không rollback nghiệp vụ — khiếu nại đã được xử lý, chỉ tin nhắn chưa tới.
//   · CHỐNG GỬI ĐÔI khi thử lại: trước khi gửi, tìm lượt `SENT` cùng (SĐT × mẫu × template_data) trong
//     `ZaloMessageLog` (bảng không có cột khoá chống trùng; không thêm migration cho việc này).
//   · TẮT AN TOÀN: luật ở `quyetDinhZnsChamCong` (thuần). Mặc định `shift.znsBat` TẮT, mã mẫu rỗng ⇒ KHÔNG
//     một lượt gọi nhà cung cấp nào, kể cả khi `ZALO_LIVE` bật. Trên `test` ZNS luôn SIMULATED.
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { getSetting } from "@/lib/settings/service";
import { sendZaloNotification } from "@/lib/zalo/service";
import { znsProvider, type ZaloProvider } from "@/lib/zalo/provider";
import {
  KHOA_MAU_ZNS,
  LOAI_ZNS_CHAM_CONG,
  quyetDinhZnsChamCong,
  thamSoZnsChamCong,
  type LoaiZnsChamCong,
  type LyDoKhongGui,
} from "./zns-cham-cong-thuan";

export const SU_KIEN_ZNS_CHAM_CONG = "cham-cong.zns";

const payloadSchema = z.object({
  loai: z.enum(LOAI_ZNS_CHAM_CONG),
  userId: z.string().min(1),
  ky: z.string().regex(/^\d{4}-\d{2}$/),
  ketQua: z.string().nullable(),
});

/**
 * Xếp một tin ZNS cho nhân sự. Công tắc TẮT ⇒ không ghi sự kiện nào (outbox không phình vì một kênh đang tắt);
 * handler vẫn hỏi lại công tắc lúc chạy, vì nó có thể bị tắt giữa hai nhịp.
 * `dedupeKey` BẮT BUỘC (luật 7): cùng khoá ⇒ cùng một sự kiện, bấm đúp / thử lại không xếp hai tin.
 */
export async function phatZnsChamCong(input: {
  loai: LoaiZnsChamCong;
  userId: string;
  ky: string;
  /** Kết quả xử lý khiếu nại (nhãn hành động); `null` với lời mời xác nhận. */
  ketQua: string | null;
  dedupeKey: string;
}): Promise<void> {
  if (!(await getSetting("shift.znsBat"))) return;
  await publishEvent(
    SU_KIEN_ZNS_CHAM_CONG,
    { loai: input.loai, userId: input.userId, ky: input.ky, ketQua: input.ketQua },
    { dedupeKey: `zns.${input.dedupeKey}` },
  );
}

/** Handler — trả lý do KHÔNG gửi (để test đọc), ném khi gửi LỖI để dispatcher thử lại. */
export async function xuLyZnsChamCong(
  ev: DomainEventLite,
  provider: ZaloProvider = znsProvider,
): Promise<{ gui: true } | { gui: false; lyDo: LyDoKhongGui | "PAYLOAD" }> {
  const p = payloadSchema.safeParse(ev.payload);
  if (!p.success) return { gui: false, lyDo: "PAYLOAD" }; // payload hỏng thì thử lại cũng vô ích
  const { loai, userId, ky, ketQua } = p.data;
  const [bat, mau, user] = await Promise.all([
    getSetting("shift.znsBat"),
    getSetting(KHOA_MAU_ZNS[loai]),
    db.user.findUnique({ where: { id: userId }, select: { phone: true, name: true } }),
  ]);
  const sdt = user?.phone ?? null;
  // Tên đọc LÚC GỬI (không chở trong payload): payload chỉ mang khoá, dữ liệu cá nhân không nằm lại trong outbox.
  const params = thamSoZnsChamCong(loai, { ten: user?.name ?? "", ky, ketQua: ketQua ?? undefined });
  const mauSach = mau.trim();
  const daGui =
    bat && sdt && /^\d+$/.test(mauSach)
      ? !!(await db.zaloMessageLog.findFirst({
          where: { toPhone: sdt, templateKey: mauSach, status: "SENT", payload: { equals: params as Prisma.InputJsonValue } },
          select: { id: true },
        }))
      : false;
  const qd = quyetDinhZnsChamCong({ bat, mau: mauSach, sdt, daGui });
  if (!qd.gui) return qd;
  const r = await sendZaloNotification({ toPhone: sdt!, templateKey: mauSach, params }, provider);
  if (r.status === "FAILED") throw new Error(`ZNS chấm công (${loai}) gửi lỗi — log ${r.logId}; dispatcher sẽ thử lại`);
  return { gui: true };
}

export function registerZnsChamCongHandlers(): void {
  on(SU_KIEN_ZNS_CHAM_CONG, async (ev) => {
    await xuLyZnsChamCong(ev);
  });
}
