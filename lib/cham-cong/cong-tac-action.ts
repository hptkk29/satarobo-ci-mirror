"use server";

// lib/cham-cong/cong-tac-action.ts — Server Action chấm công ĐI CÔNG TÁC (phần A, 15/09/2026).
//
// ── ĐƯỜNG THỨ HAI, KHÔNG PHẢI MỘT NHÁNH CỦA ĐƯỜNG QR ────────────────────────────────────
//
// Chốt của chủ dự án: "KHÔNG mã QR. KHÔNG ghim toạ độ nơi công tác — công tác nhiều nơi,
// không xác định trước." và "Đường công tác là ĐƯỜNG THỨ HAI, không sửa đường QR; có source
// riêng trong StaffTimeLog để phân biệt được."
//
// Khác `lib/attendance/checkin-action.ts` ở đúng hai chỗ, và chỉ hai:
//   · KHÔNG có vé (`consumeTicket`) — không quét gì thì không có vé để tiêu;
//   · `workLocationId: null` ⇒ `recordTimeLog` bỏ hai vế kiểm đầu (điểm chấm tồn tại/bật ·
//     geofence). Ba vế còn lại (độ chính xác GPS · trần lượt/ngày · trùng 2 phút) chạy y nguyên.
//
// ── KHÔNG GEOFENCE nghĩa là không gì chặn người bấm từ nhà ──────────────────────────────
//
// Nói thẳng ra vì nó là giới hạn THẬT, không phải sót. Chủ dự án chốt cái bù:
//   "hiện toạ độ trên panel chi tiết cho quản lý rà, không tự gắn cờ."
// ⇒ Toạ độ vẫn được LƯU mỗi lượt bấm (cột `latitude`/`longitude`/`accuracyMeters`), nhưng
//   đường này KHÔNG tự sinh cờ vị trí nào. Quản lý nhìn và tự kết luận.
//
// ── Toạ độ là DỮ LIỆU VỊ TRÍ CÁ NHÂN ────────────────────────────────────────────────────
// Chỉ ghi tại ĐÚNG thời điểm bấm — không theo dõi nền, không xin quyền vị trí liên tục.
// KHÔNG CHẶN khi trình duyệt không trả toạ độ: "Người ở chỗ sóng kém mà không chấm được là
// hỏng đúng mục đích." Thiếu GPS ⇒ cờ `THIEU_GPS`, vẫn ghi lượt.
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { db } from "@/lib/db";
import { ipKhachHang } from "@/lib/security/client-ip";
import { vnDateOnly } from "@/lib/time/vn";
import { flagInfo } from "./flag-labels";
import { recordTimeLog } from "./timelog";
import { gioVNCuaLuot, suyHuongHomNay } from "./suy-huong-db";
import type { HuongLuot } from "./suy-huong";
import { getSetting } from "@/lib/settings/service";
import { vnMinuteOfDay } from "./recompute";
import { docDonHieuLucNgay } from "./don-trong-ngay-db";
import { quyenChamNgoai } from "./cham-ngoai";

const schema = z.object({
  /**
   * ⚠️ KHÔNG CÒN ĐƯỢC ĐỌC (một nút, chốt 06/10/2026) — hướng do máy chủ suy theo ca, CÙNG luật
   * với đường QR (`suyHuongHomNay`). Giữ tuỳ chọn để trang hai nút đang mở sẵn không bị từ
   * chối giữa lúc triển khai; giá trị gửi lên bị BỎ QUA.
   */
  type: z.enum(["CHECK_IN", "CHECK_OUT"]).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  accuracyMeters: z.number().optional().nullable(),
});

export type ChamCongTacInput = z.input<typeof schema>;
export type ChamCongTacResult =
  | {
      ok: true;
      flags: string[];
      warning?: string;
      /** Hướng MÁY CHỦ đã ghi — màn hình in đúng cái này (luật 12). */
      huong: HuongLuot;
      nhanBuoi: string | null;
      /** "13:52" giờ VN — đúng mốc `loggedAt`. */
      gio: string;
      trung: boolean;
    }
  | { ok: false; error: string };

export async function chamCongTac(input: ChamCongTacInput): Promise<ChamCongTacResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  // Cùng quyền self-action với đường QR (Q-12): GLOBAL cho mọi vai nhân sự.
  if (!(await checkPermission("hr_attendance:checkin", { centerId: null }))) {
    return { ok: false, error: "Không có quyền chấm công" };
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const d = parsed.data;

  // ── CỔNG: hôm nay PHẢI là ngày công tác ────────────────────────────────────────────────
  //
  // Hỏi theo `placeMode === "OFFSITE"`, KHÔNG theo mã "NG" — chủ dự án chốt: "Hai nút hiện
  // dựa vào điều kiện gì — đề xuất, đừng hardcode mã NG." Mã nào sau này khai `OFFSITE` cũng
  // dùng được đường này mà không ai phải nhớ sửa chỗ này.
  //
  // Cổng nằm Ở ĐÂY chứ không chỉ ở màn hình: nút ẩn đi không phải một cổng — Server Action
  // là một endpoint riêng, gọi thẳng được (bài học 20/08: "chặn ở layout CHƯA đủ").
  // Một mốc cho cả lượt: ngày của cổng, hướng suy ra và `loggedAt` cùng đọc mốc này.
  const now = new Date();
  const homNay = vnDateOnly(now);
  const [ca, donHomNay] = await Promise.all([
    db.shiftAssignment.findFirst({
      where: { userId: session.user.id, workDate: homNay, status: "ACTIVE" },
      select: { placeMode: true, templateCode: true, orgUnitId: true },
    }),
    docDonHieuLucNgay(db, session.user.id, homNay),
  ]);
  // Đợt 5–6 đơn từ (08/10/2026): ngoài ca công tác xếp tay, đơn CÔNG TÁC / LÀM TỪ XA đã duyệt phủ
  // lúc này cũng mở đường này — hỏi MỘT hàm (`quyenChamNgoai`), cùng hàm `recordTimeLog` dùng.
  const quyen = quyenChamNgoai({
    placeMode: ca?.placeMode ?? null,
    don: donHomNay,
    phut: vnMinuteOfDay(now),
    dungSaiPhut: await getSetting("shift.chamNgoaiDungSaiPhut", { orgUnitId: ca?.orgUnitId ?? null }),
  });
  if (!quyen) {
    return {
      ok: false,
      error: ca
        ? `Lúc này bạn không có ca công tác hay đơn làm từ xa / công tác đã duyệt (ca hôm nay: ${ca.templateCode}) — chấm bằng mã QR tại quầy.`
        : "Hôm nay bạn không có ca, cũng không có đơn công tác / làm từ xa đã duyệt — nộp đơn trước khi chấm ngoài văn phòng.",
    };
  }

  const h = await headers();
  const ip = ipKhachHang(h); // luật IP dùng chung — bản cũ lấy phần tử ĐẦU của XFF (khách viết)
  const userAgent = h.get("user-agent");

  const suy = await suyHuongHomNay({ userId: session.user.id, workLocationId: null, now });
  const r = await recordTimeLog({
    userId: session.user.id,
    workLocationId: null, // ← đường công tác
    direction: suy.huong,
    now,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
    accuracyMeters: d.accuracyMeters ?? null,
    source: "CONG_TAC",
    ip,
    userAgent,
  });
  if (!r.ok) {
    // Đường này KHÔNG có nhánh từ chối nào (không vé, không geofence) — nhưng `recordTimeLog`
    // là hàm dùng chung và có thể mọc nhánh mới. Trả lỗi ra thay vì giả định không bao giờ có.
    return { ok: false, error: r.error };
  }

  revalidatePath("/teacher/cham-cong");
  revalidatePath("/cham-cong");
  // Dùng `flagInfo` của module nhãn dùng chung, KHÔNG chép lại bảng chữ như
  // `checkin-action.ts` đang làm (`FLAG_TEXT` cục bộ ở đó) — hai bảng chữ cho cùng một cờ
  // là hai chỗ để lệch nhau, đúng lớp lỗi luật 12b.
  const warn = r.flags.filter((f) => f !== "CHUA_TOA_DO").map((f) => flagInfo(f).text);
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
