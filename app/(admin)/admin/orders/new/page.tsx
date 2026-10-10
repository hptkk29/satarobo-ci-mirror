import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { provinces } from "vietnam-address-data";
import { auth } from "@/lib/auth";
import { getSetting } from "@/lib/settings/service";
import { checkPermission, canViewLeadPii } from "@/lib/auth/check-permission";
import { maskLeadPiiFields } from "@/lib/lead/pii";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { nationalPhone } from "@/lib/phone";
import { docMaChoDon } from "@/lib/khuyen-mai/chon-cho-don";
import { loadCreateOrderFormData } from "../_actions";
import { OrderCreateForm } from "../_components/order-create-form";

export const metadata = { title: "Tạo đơn hàng | Admin" };
export const dynamic = "force-dynamic";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // G-A (21/08/2026) — cổng tạo đơn là `orders:create`; `orders:manage` chỉ còn
  // quyết định có được tạo đơn KHÔNG gắn lead hay không (xem dưới).
  if (!(await checkPermission("orders:create"))) {
    redirect("/dashboard?error=unauthorized");
  }
  const canManageAll = await checkPermission("orders:manage");

  const data = await loadCreateOrderFormData();
  // Trần % giảm — THAM SỐ VẬN HÀNH (`orders.maxDiscountPercent`, mặc định 50). Đọc ở đây
  // rồi truyền xuống form: client không gọi được `getSetting`, và một hằng cứng ở client
  // là con số thứ hai sống song song với cấu hình. Server action đọc LẠI độc lập — đây
  // chỉ là lớp trải nghiệm, không phải lớp bảo vệ.
  const tranPhanTram = await getSetting("orders.maxDiscountPercent");
  // Mã khuyến mãi cho ô "Khoản giảm" [28/09/2026]. Nạp MỘT LẦN ở RSC rồi lọc tinh ở
  // client theo khoá/cơ sở/giá của từng dòng — tập này nhỏ (mã đang bật của các văn bản
  // đã từng hiệu lực) và điều kiện thật phụ thuộc những thứ người dùng còn đang gõ, nên
  // gọi lại server mỗi phím là đắt mà không chính xác hơn.
  //
  // ⚠️ Đây CHỈ là lớp trải nghiệm. `createOrderManualAction` đọc lại mã từ DB và TỰ tính
  // số tiền — số client gửi không được tin, đúng bài học ở `lib/orders/hinh-thuc-lop.ts`.
  const { ma: maKhuyenMai, maCoSoTheoCenter } = await docMaChoDon();

  // convert-v2: tạo đơn GẮN lead (từ trang convert). Đọc lead trong tầm nhìn cơ sở
  // actor (scopedDb) — ngoài scope/không tồn tại → bỏ qua leadId (đơn walk-in thường).
  const { leadId } = await searchParams;
  let lead: { id: string; parentName: string; phone: string; email: string | null; centerId: string | null } | null = null;
  let leadAssignedToId: string | null = null;
  // CON KHAI TRONG LEAD — nguồn sự thật "con của phụ huynh này" khi lead chưa chốt.
  // Tên biến theo `main` (`conLead`) vì biểu mẫu lấy bản của `main` và prop tên vậy.
  let conLead: { id: string; fullName: string }[] = [];
  if (leadId) {
    const actor = await resolveActor(session.user.id);
    const row = await scopedDb(actor).lead.findUnique({
      where: { id: leadId },
      select: {
        id: true, parentName: true, phone: true, email: true, centerId: true, assignedToId: true,
        // CON KHAI TRONG LEAD [16/09/2026] — nguồn sự thật "con của phụ huynh này" khi lead
        // chưa chốt. Đo: 121/125 lead không có `Student` nào khớp SĐT, nên nếu ô chọn học
        // viên chỉ biết bảng `Student` thì 96,8% ca không chọn được đúng em.
        //
        // Đọc kèm trong CÙNG lượt đọc phiếu (phiếu đã qua scope) — không đọc thẳng
        // `LeadChild`: bảng đó không có `centerId` nên `scopedDb` là pass-through.
        children: { select: { id: true, fullName: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (row) {
      const { assignedToId, children, ...rest } = row;
      lead = rest;
      leadAssignedToId = assignedToId;
      conLead = children;
    }
  }

  // G-A — Sale (chỉ có `orders:create`) chỉ tạo đơn cho khách CỦA MÌNH. Chặn ngay
  // ở trang thay vì để họ điền xong cả form rồi mới báo lỗi khi bấm Lưu.
  // Server action vẫn kiểm lại độc lập — đây chỉ là lớp trải nghiệm, không phải
  // lớp bảo vệ (gọi thẳng action vẫn bị `checkOrderCreateOwnership()` chặn).
  if (!canManageAll) {
    if (!lead) {
      redirect("/leads?error=chon-khach-truoc-khi-tao-don");
    }
    if (leadAssignedToId !== session.user.id) {
      redirect(`/leads/${lead.id}?error=khong-phai-khach-cua-ban`);
    }
  }

  // S-1 (26/08/2026) — `orders:create` KHÔNG kéo theo quyền đọc liên hệ khách.
  // Vai giữ nó: SUPER_ADMIN, Quản lý cơ sở (mất `leads:view-pii` từ Q9), **Kế
  // toán** (chưa bao giờ có), Sale (có). Trước S-1, mở
  // `/orders/new?leadId=…` là đọc được nguyên tên + SĐT của phiếu.
  const canViewPii = await canViewLeadPii();
  const piiLead = lead ? maskLeadPiiFields(lead, canViewPii) : null;
  // Ô điền sẵn: thiếu quyền thì để TRỐNG, KHÔNG điền bản che. `customerPhone` có
  // lưới đỡ (`phoneVn` từ chối chuỗi đã đục) nhưng `customerName` thì không —
  // điền sẵn tên che là mời người dùng bấm Lưu và tạo đơn mang tên "Nguyễn T. L.".
  const khachDienSan =
    lead && canViewPii
      ? { name: lead.parentName, phone: lead.phone, email: lead.email ?? "" }
      : undefined;

  return (
    /* Trần 104rem (1664px) thay cho `max-w-4xl` (896px) cũ. Form nay hai cột nên cần
       bề ngang thật; vẫn phải CÓ trần vì ở 4k/8k một form trải hết màn thì mắt phải
       quét cả mét giữa nhãn và ô nhập. Cùng con số với màn chi tiết đơn. */
    <div className="mx-auto w-full max-w-[104rem]">
      <Link
        href={lead ? `/leads/${lead.id}/convert` : "/orders"}
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {lead ? "Quay lại chốt lead" : "Quay lại danh sách"}
      </Link>

      <h1 className="mb-1 text-2xl font-bold text-foreground">
        Tạo đơn hàng thủ công
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {piiLead
          ? `Đơn gắn với lead "${piiLead.parentName}" — sau khi ghi nhận thanh toán sẽ đủ điều kiện chốt (convert).`
          : "Dùng cho khách walk-in tại trung tâm hoặc nhập tay đơn đã thoả thuận offline. Một đơn nhận NHIỀU dòng — phụ huynh có hai con học hai khoá thì vẫn là một đơn, một công nợ, một mã QR."}
      </p>

      {lead && !canViewPii && (
        <p className="mb-6 rounded-xl border border-amber-500/40 bg-card p-4 text-sm text-muted-foreground">
          <strong className="text-amber-600 dark:text-amber-500">
            Bạn không có quyền xem liên hệ của khách
          </strong>
          {" — "}ô Tên và SĐT người mua để trống, xin khách đọc rồi nhập tay.
        </p>
      )}

      <OrderCreateForm
        paymentMethods={data.paymentMethods}
        courses={data.courses}
        products={data.products}
        centers={data.centers}
        students={data.students}
        conLeadBanDau={conLead}
        maKhuyenMai={maKhuyenMai}
        maCoSoTheoCenter={maCoSoTheoCenter}
        provinces={provinces.map((p) => ({ value: p.id, label: p.name }))}
        leadId={lead?.id ?? null}
        defaultCustomer={khachDienSan}
        defaultCenterId={lead?.centerId ?? null}
        // Sale (không có `orders:manage`) KHÔNG đổi được cơ sở: cổng server đã ép theo
        // cơ sở của lead, nên để ô mở là cho họ chọn một thứ sẽ bị vứt im lặng.
        lockCenter={!canManageAll}
        tranPhanTram={tranPhanTram}
      />
    </div>
  );
}
