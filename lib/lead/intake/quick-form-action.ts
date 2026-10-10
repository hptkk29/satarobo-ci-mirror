"use server";

// Nhập khách hàng SAU ĐĂNG NHẬP — `admin.satarobo.vn/nhap-khach-hang`.
//
// Đặt ở `lib/` chứ không cạnh trang: chủ dự án chốt 23/08 rằng site Sale sau này
// cũng có biểu mẫu này. Action + `<QuickLeadForm>` + `loadIntakeCenterOptions()`
// là bộ ba dùng chung — trang chỉ ghép lại. Chép logic sang chỗ thứ hai là mở
// đường cho hai biểu mẫu lệch nhau.
//
// Vì sao có màn này: biểu mẫu cũ (`sale.satarobo.vn`) công khai và bắt người
// nhập **gõ tay mã nhân viên của mình** mỗi lần. Gõ sai thì lead giao nhầm
// người; gõ mã người khác thì không ai chặn.
//
// Màn này bỏ ô mã nhân viên và lấy danh tính từ phiên đăng nhập.
//
// ⚠️ KHÔNG mở đường ghi lead thứ hai: vẫn đi qua `ingestIntakeLead()` như mọi
// nguồn khác, nên được hưởng nguyên chuỗi đang chạy — chuẩn hoá SĐT, chống
// trùng theo cửa sổ cấu hình, tra cơ sở, tra người phụ trách theo mã NV, tự
// chia, ghi `LeadActivity`.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { ingestIntakeLead } from "@/lib/lead/intake/ingest";
import { mapInternalForm } from "@/lib/lead/intake/map-internal-form";
import { getStaffIdentity } from "@/lib/lead/intake/staff-identity";
import { epChonNguonChoMaCoSo } from "@/lib/nguon/nguon-cho-form-nhap";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";
import { ipKhachHang } from "@/lib/security/client-ip";
import {
  hasAnyContent,
  internalLeadSchema,
  type InternalLeadResult,
} from "@/lib/validators/internal-lead";

// ⚠️ File này là `"use server"` ⇒ CHỈ được export hàm async. Kiểu
// `InternalLeadResult` cố ý nằm ở `lib/validators/internal-lead.ts`: loader sinh
// export VALUE cho mọi export ở đây, nên `export type` sẽ giết toàn bộ action
// trong module lúc chạy (E352 — đã xảy ra thật trong repo này).

export async function createInternalLeadAction(
  input: unknown,
): Promise<InternalLeadResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("leads:create"))) {
    return { ok: false, error: "Không có quyền nhập khách hàng" };
  }

  const parsed = internalLeadSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ",
    };
  }
  // Không ô nào bắt buộc — nhưng phiếu TRẮNG thì không phải dữ liệu.
  if (!hasAnyContent(parsed.data)) {
    return { ok: false, error: "Phiếu trống — điền ít nhất một ô giúp nhé." };
  }

  // PR7 — cơ sở đã bật ÉP CHỌN NGUỒN thì phiếu PHẢI mang lựa chọn. Chặn Ở ĐÂY (máy chủ), không chỉ ở giao diện: ô chọn ẩn/bắt buộc
  // trên màn hình là lời hứa suông nếu một request thiếu `nguonChon` vẫn lọt. Master TẮT ⇒ false ngay (hành vi cũ, không tốn truy vấn).
  if (!parsed.data.nguonChon && (await epChonNguonChoMaCoSo(parsed.data.centerCode))) {
    return { ok: false, error: "Cơ sở này bắt buộc chọn nguồn khách — hãy chọn một nguồn (và người giới thiệu nếu nguồn yêu cầu)." };
  }

  // Danh tính người nhập LẤY TỪ PHIÊN — không nhận từ payload.
  const staff = await getStaffIdentity(
    session.user.id,
    session.user.name ?? session.user.email ?? "Không rõ",
  );

  const mapped = mapInternalForm(parsed.data, staff);
  if (!mapped.ok) return { ok: false, error: mapped.error };

  const h = await headers();
  const res = await ingestIntakeLead(mapped.lead, {
    // Kênh kỹ thuật phiếu đi vào (log/`LeadDuplicate`/cảnh báo sức khoẻ). Nguồn
    // marketing người nhập gõ đi vào `Lead.source` qua `mapped.lead.leadSource`.
    source: "sale-form-app",
    actorName: session.user.name ?? session.user.email ?? "Nhân viên",
    // NGƯỜI NHẬP — khác người CHĂM. Phiếu vẫn tự chia về Sale cơ sở như cũ;
    // cột này để chính người nhập theo được phiếu của mình (chủ dự án 23/08).
    createdByUserId: session.user.id,
    // 29/08 — ĐƯỜNG VÀO "FORM": sale nhập phiếu cho ĐÚNG cơ sở của mình thì phiếu
    // về tay chính họ và KHÔNG tiêu lượt (ca 1 của ma trận). Chọn cơ sở khác, hoặc
    // người nhập không phải sale (Marketing/Sale Hội sở/QLCS) → chia tự động.
    entryPoint: "FORM",
    // Luật IP dùng chung — bản cũ lấy phần tử ĐẦU của XFF (khách viết).
    ipAddress: ipKhachHang(h),
    userAgent: h.get("user-agent"),
    // Giữ NGUYÊN chuỗi cũ dù trang đã dời sang admin host: đây là nhãn nhận
    // dạng nguồn phiếu trong dữ liệu đã có, đổi là cắt đôi lịch sử báo cáo.
    landingPage: "/nhap-khach-hang",
    // Chốt 22/08: không ô nào bắt buộc, kể cả SĐT (lead quảng cáo FB thường chỉ
    // có link Facebook lúc mới thu về).
    allowMissingPhone: true,
    // Người nhập = người gõ máy (từ phiên): ingest tự giải thành `nguoiNhap`. Chưa có picker nguồn (PR7).
    // Lựa chọn tường minh ở ô chọn nguồn (PR7); null ⇒ không có (cờ tắt / cơ sở chưa ép) = hành vi cũ. Máy chủ kiểm lại trong
    // `chuanBiQuyNguon` (nhóm, người tồn tại + còn làm việc, giải trình) — lỗi ⇒ trả `res.error`, KHÔNG tạo lead.
    tinHieuNguon: { ...KHONG_CO_TIN_HIEU_NGUON, nguonChon: parsed.data.nguonChon },
  });

  if (!res.ok) return { ok: false, error: res.error ?? "Không lưu được phiếu" };

  // 29/08/2026 — GỠ bản sao sang MISA. Chủ dự án bỏ hẳn CRM của MISA, nên phiếu
  // nhập ở đây dừng lại ở Postgres: không gọi mạng ra ngoài, không webform, không
  // `WebhookDelivery` nguồn "misa-mirror-app" nào nữa. Đường replay tương ứng ở
  // `lib/crm/webhook-replay.ts` cũng đã gỡ.

  // Đường THẬT trong app dir là `/admin/leads` (clean URL `/leads` chỉ do
  // `decideRoute` rewrite ở tầng host). `revalidatePath` khớp theo route của
  // app dir nên phải dùng đường thật, không thì nó im lặng không làm gì.
  revalidatePath("/admin/leads");
  if (res.leadId) revalidatePath(`/admin/leads/${res.leadId}`);

  return {
    ok: true,
    leadId: res.leadId,
    duplicate: res.duplicate,
    childAdded: res.childAdded,
    // `res.warnings` gồm CẢ cảnh báo của tầng ingest (cơ sở không nhận ra, mã NV sai,
    // tài khoản ngưng hoạt động…) — thứ trước đây chỉ nằm trong `note`, người vừa
    // gõ phiếu không bao giờ thấy.
    //
    // 24/08 — ca "người nhập không giữ vai Sale" ĐÃ Bỏ khỏi danh sách này: đó là
    // đường đi bình thường chứ không phải sự cố (xem `resolveOwner` trong ingest.ts).
    warnings: res.warnings?.length ? res.warnings : undefined,
  };
}
