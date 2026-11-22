"use server";

// app/(admin)/admin/nguon-hoa-hong/nguon/_actions-chup-lai.ts — Server Action «CHỤP LẠI CHỦ NGUỒN cho lead cũ» (W3 · gt2 R1-H1, 10/10/2026). File RIÊNG (không nằm trong `_actions.ts`).
//
// MỎNG: xác thực → HAI quyền (đều là cổng thật, không phải cờ — đổi chủ đã chụp là đổi ai nhận tiền) → cờ → gọi dịch vụ MỘT LÔ. Luật chọn lead · khoá · audit ở `lib/nguon/chup-lai-chu-nguon.ts`.
//   · `sources:manage`               — cùng khoá với «Sửa nguồn» (người xem trang chi tiết mới thấy nút);
//   · `commission_policies:activate` — «đụng tiền»: cùng khoá mà `suaNguon` đòi khi đổi người phụ trách của nguồn đang dính tiền. KHÔNG đẻ quyền mới.
// Hai lời gọi `checkPermission("…")` đứng NGAY SAU `auth()`, trước mọi `await` khác (lưới `[NHH-H-GATE-02]`); đừng thay bằng helper — lưới đếm literal.
//
// ⚠️ KHÔNG `revalidatePath` ở đây (đã đo khi chụp giao diện): action được gọi LẶP theo lô từ hộp thoại, mà hộp thoại là con của nút do SERVER vẽ có điều kiện «còn lead cần chụp lại». Làm mới trang sau mỗi lô
// thì lô cuối (hết lead) khiến nút biến mất và hộp thoại bị gỡ ngay giữa chừng — người dùng không bao giờ thấy kết quả. Trang là `force-dynamic`; nút tự `router.refresh()` khi người dùng ĐÓNG hộp thoại.
//
// MỖI lượt gọi xử lý MỘT lô (≤ `CO_LO_CHUP_LAI` dòng) và trả `conTro`; giao diện lặp. Không có vòng lặp ở đây: một Server Action dài là một transaction dài (trần 5 giây) hoặc một request treo.
//
// ⚠️ File "use server" ⇒ CHỈ export hàm async.
import { z } from "zod";
import { auth } from "@/lib/auth";
import { resolveActor } from "@/lib/auth/actor";
import { checkPermission } from "@/lib/auth/check-permission";
import { chupLaiChuNguonMotLo } from "@/lib/nguon/chup-lai-chu-nguon";
import { CO_LO_CHUP_LAI, duPhamViChupLai } from "@/lib/nguon/chup-lai-chu-nguon-luat";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import type { KetQuaChupLaiAction } from "@/lib/nguon/ket-qua-action";

const chupLaiSchema = z.object({
  nguonId: z.string().trim().min(1).max(64),
  /** `Employee.id` chủ nguồn mà hộp thoại đã hiện cho người bấm. */
  chuDuKien: z.string().trim().min(1).max(64),
  lyDo: z.string().max(500).nullish(),
  conTro: z.string().trim().min(1).max(64).nullable(),
});

const tenNguoi = (u: { name?: string | null; email?: string | null }) => u.name ?? u.email ?? "Nhân viên";

export async function chupLaiChuNguonAction(input: unknown): Promise<KetQuaChupLaiAction> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("sources:manage"))) {
    return { ok: false, error: "Không có quyền sửa nguồn (sources:manage).", field: "quyen" };
  }
  if (!(await checkPermission("commission_policies:activate"))) {
    return { ok: false, error: "Chụp lại chủ nguồn là đổi ai nhận hoa hồng — cần thêm quyền kích hoạt chính sách (commission_policies:activate). Nhờ Quản trị hệ thống hoặc Giám đốc.", field: "quyen" };
  }
  const parsed = chupLaiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  if (!(await laQuanLyNguonBat())) return { ok: false, error: "Quản lý nguồn chưa được bật." };
  // Lớp THỨ BA (fin3 R5 LOW4): lô ghi trên lead của MỌI cơ sở và `scopedDb` không che write, nên người bấm phải có tầm nhìn toàn hệ thống. Hai quyền trên hôm nay chỉ vai Hội sở giữ, nhưng một người neo ở
  // một cơ sở được cấp thêm vai thứ hai vẫn gom đủ cả hai — không có cổng này thì họ sửa lead của cơ sở khác. Trang vẽ nút bằng CÙNG hàm (`duPhamViChupLai`). Đứng SAU cờ (lưới [NHH-H-GATE-07]).
  if (!duPhamViChupLai(await resolveActor(session.user.id))) {
    return { ok: false, error: "Chụp lại chủ nguồn chạy trên lead của mọi cơ sở — cần tài khoản có tầm nhìn toàn hệ thống (Hội sở).", field: "quyen" };
  }

  const kq = await chupLaiChuNguonMotLo({
    nguoi: { userId: session.user.id, ten: tenNguoi(session.user) },
    nguonId: parsed.data.nguonId,
    chuDuKien: parsed.data.chuDuKien,
    lyDo: parsed.data.lyDo ?? null,
    conTro: parsed.data.conTro,
    coLo: CO_LO_CHUP_LAI,
    now: new Date(),
  });
  if (!kq.ok) return { ok: false, error: kq.loi, field: kq.truong };
  return { ok: true, daChup: kq.daChup, boQua: kq.boQua, conTro: kq.conTro, hetLead: kq.hetLead, theoLyDo: kq.theoLyDo };
}
