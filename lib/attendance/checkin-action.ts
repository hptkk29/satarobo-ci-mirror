"use server";

// lib/attendance/checkin-action.ts — Server Action chấm công (L4, chấm công v3), DÙNG CHUNG cho
// admin `/cham-cong/checkin` và site GV `/teacher/cham-cong/checkin`.
//
// Luồng: màn hình quầy hiện QR XOAY (kiosk token 60s) → người quét mở trang check-in → trang xác
// minh token + cấp VÉ 120s (checkin-gate) → bấm MỘT nút "Chấm công" → action TIÊU VÉ NGUYÊN TỬ
// → MÁY CHỦ tự suy VÀO/RA theo ca (`suyHuongHomNay`, chốt 06/10/2026) → ghi StaffTimeLog (Q-07: ghi luôn + cờ NGOAI_VUNG/THIEU_GPS/SAI_NOI_LAM/TRUNG/VUOT_TRAN) → xếp
// hàng tính lại bảng công ngày. Chỉ từ chối khi vé hỏng / hết hạn / đã dùng.
//
// Bảng cũ `EmployeeCheckin` KHÔNG còn được ghi từ đây (đóng băng, Pha B drop).
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { ipKhachHang } from "@/lib/security/client-ip";
import { checkPermission } from "@/lib/auth/check-permission";
import { consumeTicket, hoanVe, recordRejectedLog, recordTimeLog } from "@/lib/cham-cong/timelog";
import { gioVNCuaLuot, suyHuongHomNay } from "@/lib/cham-cong/suy-huong-db";
import type { HuongLuot } from "@/lib/cham-cong/suy-huong";

const schema = z.object({
  ticketId: z.string().min(1),
  nonce: z.string().min(1),
  /**
   * ⚠️ KHÔNG CÒN ĐƯỢC ĐỌC (chấm công một nút, chốt 06/10/2026) — hướng do MÁY CHỦ suy theo ca.
   *
   * Giữ trong schema (tuỳ chọn) chỉ để trang đang MỞ SẴN của bản cũ (hai nút, vẫn gửi `type`)
   * không bị từ chối "Dữ liệu không hợp lệ" giữa lúc triển khai. Giá trị client gửi lên bị BỎ
   * QUA: tin nó là để lại đúng cửa bấm nhầm mà yêu cầu này sinh ra để đóng.
   */
  type: z.enum(["CHECK_IN", "CHECK_OUT"]).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  accuracyMeters: z.number().optional().nullable(),
});

export type RecordCheckinInput = z.input<typeof schema>;
export type RecordCheckinResult =
  | {
      ok: true;
      flags: string[];
      warning?: string;
      /** Hướng MÁY CHỦ đã ghi — màn hình in đúng cái này (luật 12), không tự đoán lại. */
      huong: HuongLuot;
      /** "buổi chiều" · "ca hôm nay" · null (không có ca). */
      nhanBuoi: string | null;
      /** "13:52" giờ VN — đúng mốc `loggedAt` của lượt vừa ghi. */
      gio: string;
      /** Bấm trùng trong vài phút — lượt được lưu nhưng không tính thêm. */
      trung: boolean;
    }
  /**
   * `veConDung` — vé CHƯA bị tiêu, bấm lại được ngay, không phải quét mã mới.
   *
   * Màn hình dựa vào cờ này để quyết định có khoá nút hay không. Thiếu nó thì mọi lỗi đều
   * khoá nút, và người bị từ chối vì một lý do sửa được tại chỗ (đứng sai chỗ) vẫn phải đi
   * xin quét mã mới — đúng cái bẫy chủ dự án chốt gỡ 16/09.
   */
  | { ok: false; error: string; veConDung?: boolean };

const FLAG_TEXT: Record<string, string> = {
  NGOAI_VUNG: "ngoài bán kính cơ sở",
  THIEU_GPS: "không có định vị",
  CHUA_TOA_DO: "cơ sở chưa khai toạ độ",
  SAI_NOI_LAM: "khác nơi làm theo lịch",
  CHAM_NGOAI_LICH: "hôm nay bạn không có ca",
  TRUNG_2_PHUT: "bấm trùng",
  VUOT_TRAN: "quá số lượt trong ngày",
  GPS_KEM_CHINH_XAC: "định vị kém chính xác",
};

export async function recordCheckin(input: RecordCheckinInput): Promise<RecordCheckinResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // Quyền self-action: GLOBAL cho mọi vai nhân sự (Q-12); nơi chấm không giới hạn — cờ SAI_NOI_LAM lo hậu kiểm.
  if (!(await checkPermission("hr_attendance:checkin", { centerId: null }))) return { ok: false, error: "Không có quyền chấm công" };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const d = parsed.data;
  const h = await headers();
  const ip = ipKhachHang(h); // luật IP dùng chung — bản cũ lấy phần tử ĐẦU của XFF (khách viết)
  const userAgent = h.get("user-agent");

  // Một mốc cho cả lượt: hướng suy theo mốc này và `loggedAt` ghi đúng mốc này — giờ in ra cho
  // người bấm và giờ quản lý thấy trong bảng công là MỘT con số.
  const now = new Date();
  const c = await consumeTicket({ ticketId: d.ticketId, nonce: d.nonce, userId: session.user.id });
  if (!c.ok) {
    // Lượt REJECTED không vào phép tính công — hướng chỉ để hậu kiểm, suy theo ca như lượt thật.
    const goiY = await suyHuongHomNay({ userId: session.user.id, workLocationId: null, now });
    await recordRejectedLog({ userId: session.user.id, workLocationId: null, direction: goiY.huong, reason: c.reason, ip });
    return { ok: false, error: c.reason === "TICKET_EXPIRED" ? "Vé chấm công đã hết hạn (2 phút). Quét lại mã QR." : c.reason === "TICKET_REUSED" ? "Vé này đã dùng. Quét lại mã QR để chấm lượt mới." : "Vé chấm công không hợp lệ. Quét lại mã QR." };
  }
  // ── HƯỚNG DO MÁY CHỦ QUYẾT (chủ dự án 06/10/2026: "Chấm công chỉ có 1 nút … hệ thống tự biết
  // khi nào là check in, khi nào là check out"). Luật ở `lib/cham-cong/suy-huong.ts`.
  const suy = await suyHuongHomNay({ userId: session.user.id, workLocationId: c.workLocationId, now });
  const r = await recordTimeLog({
    userId: session.user.id,
    workLocationId: c.workLocationId,
    direction: suy.huong,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    accuracyMeters: d.accuracyMeters ?? null,
    ticketId: d.ticketId,
    ip,
    userAgent,
    now,
  });
  if (!r.ok) {
    // Ghi lại lượt BỊ TỪ CHỐI. Với mã QR tĩnh in ra, việc ai đó quét nhiều lần từ ngoài vùng là
    // dấu hiệu đáng xem — không lưu thì lần bị chặn không để lại vết nào, và quản lý chỉ nghe
    // kể lại. `result: REJECTED` nên nó KHÔNG vào phép tính công (`recompute` chỉ đọc ACCEPTED).
    await recordRejectedLog({
      userId: session.user.id,
      workLocationId: c.workLocationId,
      direction: suy.huong,
      reason: r.rejectReason,
      ip,
    });
    // ⚠️ HOÀN VÉ (chốt 16/09/2026): không có gì được ghi thì vé không được phép mất.
    //
    // Chủ dự án: *"Vé chỉ bị tiêu khi lượt quét được GHI. Từ chối mà vẫn tiêu vé là cái bẫy
    // nặng nhất trong cả chuyện này."* Trước bản này, người đứng ngoài vùng bấm một lần là
    // vé chết, phải đi xin quét mã mới — trong khi việc họ cần làm chỉ là bước vào trong.
    //
    // Không nới bảo vệ: bấm lại bao nhiêu lần mà vẫn ngoài vùng thì vẫn bị từ chối bấy nhiêu
    // lần, và mỗi lần vẫn để lại một dòng `REJECTED` cho quản lý rà.
    const conDung = await hoanVe(d.ticketId);
    return { ok: false, error: r.error, veConDung: conDung };
  }
  revalidatePath("/cham-cong");
  const warn = r.flags.filter((f) => f !== "CHUA_TOA_DO").map((f) => FLAG_TEXT[f] ?? f);
  return {
    ok: true,
    flags: r.flags,
    warning: warn.length ? `Đã ghi, Quản lý sẽ rà: ${warn.join(", ")}.` : undefined,
    huong: suy.huong,
    nhanBuoi: suy.nhanBuoi,
    gio: gioVNCuaLuot(now),
    trung: suy.trung,
  };
}
