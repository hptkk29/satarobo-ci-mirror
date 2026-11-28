import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { getPolicyAcceptance } from "@/lib/elearning/policy-acceptance";
import { TieuDeTrang as PageHeader } from "@/app/(elearning)/elearning/_components/ui/tieu-de-trang";
import { EmptyState } from "@/components/admin/ui/states";
import { TrangThaiBadge } from "../../_components/ui/trang-thai-badge";
import { Khoi, TrangQuanTri } from "../../_components/ui/trang";
import { AcceptPolicyButton } from "../_components/accept-policy-button";

/**
 * XÁC NHẬN CHÍNH SÁCH THEO DÕI HỌC TẬP — trang riêng (tách khỏi "Dữ liệu của tôi").
 *
 * Đích của lời chặn "Cần xác nhận trước khi bắt đầu" ở trang bài. Nói ĐỦ phạm vi dữ liệu thu TRƯỚC khi có nút bấm: bản ghi đồng
 * ý của người không biết mình đồng ý điều gì không có giá trị làm bằng chứng.
 *
 * ⚠️ KHÔNG in "ngày hiệu lực" của phiên bản: hệ thống chỉ có số phiên bản (`ELEARNING_POLICY_VERSION`), chưa có bảng ngày hiệu
 * lực — bịa một ngày ở trang pháp lý là tệ hơn không có. Chỉ in thứ có thật: phiên bản đang hiệu lực + ngày người này đã xác nhận.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Chính sách theo dõi học tập | Sata Robo",
  robots: { index: false, follow: false },
};

const gio = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(d) : "—";

export default async function ChinhSachPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return (
      <TrangQuanTri rong="hep">
        <EmptyState title="Chưa đăng nhập" description="Đăng nhập rồi mở lại trang này." />
      </TrangQuanTri>
    );
  }
  const policy = await getPolicyAcceptance(session.user.id);

  return (
    <TrangQuanTri rong="hep">
      <nav aria-label="Vị trí" className="text-sm">
        <Link
          href="/elearning/du-lieu-cua-toi"
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-primary-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Dữ liệu của tôi
        </Link>
      </nav>
      <PageHeader
        title="Chính sách theo dõi học tập"
        subtitle="Hệ thống ghi nhận gì trong lúc bạn học, giữ bao lâu, và bạn có quyền gì."
      />

      <Khoi tieuDe="Hệ thống ghi nhận những gì">
        <div className="text-sm text-muted-foreground">
          <ul className="list-inside list-disc space-y-1">
            <li>Số giây bạn ở lại trang bài học, và phần trăm bài đã cuộn qua.</li>
            <li>Thời điểm hoạt động gần nhất trên mỗi bài.</li>
            <li>Với bài video: các đoạn đã xem, số lần tua, và câu hỏi chèn giữa bài.</li>
            <li>
              Dấu vân kỹ thuật của phiên xem — <strong>không</strong> lưu địa chỉ IP đầy đủ, chỉ lưu bản băm và tiền tố mạng.
            </li>
          </ul>
          <p className="mt-2">
            Dữ liệu đo hành vi (đoạn xem, đếm tua) bị <strong>xoá sau 90 ngày</strong>. Chứng từ hoàn thành thì giữ dài để làm bằng
            chứng đào tạo.
          </p>
        </div>
      </Khoi>

      <Khoi tieuDe="Quyền của bạn">
        <p className="text-sm text-muted-foreground">
          Bạn xem được toàn bộ dữ liệu này ở <Link href="/elearning/du-lieu-cua-toi" className="text-primary-ink underline-offset-2 hover:underline">Dữ liệu của tôi</Link>. Muốn xin bản sao, đính chính, hoặc rút lại đồng ý theo dõi: liên hệ phòng Đào tạo. Rút đồng ý thì hệ thống{" "}
          <strong>ngừng thu nhịp học ngay</strong>, và nghĩa vụ học chuyển sang hình thức khác (điểm danh trực tiếp / xác nhận của
          quản lý trực tiếp) chứ <strong>không tự huỷ</strong>.
        </p>
      </Khoi>

      <Khoi tieuDe="Xác nhận của bạn">
        <div className="text-sm text-muted-foreground">
          <p>
            Bản đang hiệu lực: <strong className="text-foreground">{policy.currentVersion}</strong>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <TrangThaiBadge sac={policy.accepted ? "success" : "warning"}>{policy.accepted ? "Đã xác nhận" : "Cần xác nhận"}</TrangThaiBadge>
            {policy.accepted ? (
              <>
                Bạn đã xác nhận bản <strong>{policy.acceptedVersion}</strong> lúc {gio(policy.acceptedAt)}.
              </>
            ) : policy.acceptedVersion ? (
              <>
                Bạn đã xác nhận bản <strong>{policy.acceptedVersion}</strong> lúc {gio(policy.acceptedAt)}, nhưng bản đó không còn
                hiệu lực. Cần xác nhận lại bản mới trước khi học tiếp.
              </>
            ) : (
              <>Bạn chưa xác nhận bản nào. Cần xác nhận trước khi bắt đầu học.</>
            )}
          </p>
          {!policy.accepted && (
            <div className="mt-3">
              <AcceptPolicyButton version={policy.currentVersion} />
            </div>
          )}
        </div>
      </Khoi>
    </TrangQuanTri>
  );
}
