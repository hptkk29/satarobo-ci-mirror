import "server-only";
import { requireActiveStudent } from "@/lib/portal/session";
import { getStudentUpcomingSessions } from "@/lib/portal/learning";
import { docCoSoCoTheChuyen } from "@/lib/portal/yeu-cau-hub";
import { vnYmd } from "@/lib/time/vn";
import type { TuyChon } from "@/components/portal/yeu-cau/form-yeu-cau-loai";

// Dữ liệu chọn cho các màn con «Gửi yêu cầu» (buổi sắp tới cho Xin nghỉ, cơ sở khác cho Chuyển cơ sở, ngày sớm nhất cho
// Bảo lưu). Mọi thứ tra theo CON ĐANG CHỌN từ `requireActiveStudent()` — id học viên không đi qua URL.
export async function docTuyChon(loai: "nghi" | "bao-luu" | "doi-lop" | "doi-co-so" | "khac"): Promise<TuyChon & { tenCon: string }> {
  const { ctx, studentId } = await requireActiveStudent();
  const [buoi, coSoDich] = await Promise.all([
    loai === "nghi" ? getStudentUpcomingSessions(studentId) : Promise.resolve([]),
    loai === "doi-co-so" ? docCoSoCoTheChuyen(ctx.activeStudent?.centerId ?? null) : Promise.resolve([]),
  ]);
  return {
    tenCon: ctx.activeStudent?.name ?? "",
    homNay: vnYmd(new Date()),
    buoiSapToi: buoi.map((s) => ({ id: s.id, label: `${s.nhanNgay} · ${s.className} — ${s.nhan}` })),
    coSoDich,
  };
}
