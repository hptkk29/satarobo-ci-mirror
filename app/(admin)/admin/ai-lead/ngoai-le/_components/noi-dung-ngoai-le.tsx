// Phần ĐỘNG của màn «Ngoại lệ» (đọc dữ liệu + dựng danh sách). Tách khỏi page.tsx để test được (RTL không render component async lồng trong trang) và vì page chỉ được export mặc định.
// Lỗi đọc không đưa nội dung lỗi ra màn (lỗi Prisma có thể kèm giá trị cột = PII).
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/admin/ui/states";
import { resolveActor } from "@/lib/auth/actor";
import { canViewLeadPii } from "@/lib/auth/check-permission";
import { SO_DONG_TOI_DA } from "@/lib/ai-lead/dich-vu/duyet";
import { danhSachNgoaiLe, type KetQuaDanhSachNgoaiLe, type LocNgoaiLe } from "@/lib/ai-lead/dich-vu/ngoai-le";
import { CO_LOC_NGOAI_LE, hrefTheoLoai } from "../_lib/doc-bo-loc";
import { BoLocNgoaiLe } from "./bo-loc-ngoai-le";
import { DanhSachNgoaiLe } from "./danh-sach-ngoai-le";

export async function NoiDungNgoaiLe({ loc, userId }: { loc: LocNgoaiLe; userId: string }) {
  const now = new Date();
  let kq: KetQuaDanhSachNgoaiLe;
  try {
    const [actor, coPii] = await Promise.all([resolveActor(userId), canViewLeadPii()]);
    kq = await danhSachNgoaiLe(actor, loc, coPii, now);
  } catch {
    // Không đưa nội dung lỗi ra màn (lỗi Prisma có thể kèm giá trị cột = PII). Sentry đã bắt ở tầng trên khi cần.
    // Có nút «Tải lại» thật (liên kết về chính URL + bộ lọc đang chọn): chữ «Tải lại trang» một mình là lời hứa suông trên điện thoại (luật 12), vùng chạm ≥44px.
    return (
      <ErrorState
        description="Không đọc được danh sách ngoại lệ. Tải lại trang; nếu vẫn lỗi, báo bộ phận kỹ thuật kèm giờ xảy ra."
        action={
          <Link
            href={hrefTheoLoai(loc, loc.loai && loc.loai !== "tat-ca" ? loc.loai : null)}
            className="inline-flex min-h-11 items-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Tải lại
          </Link>
        }
      />
    );
  }

  return (
    <>
      <BoLocNgoaiLe loc={loc} dem={kq.dem} pages={kq.tuyChon.pages} coSo={kq.tuyChon.coSo} />
      {kq.hang.length === 0 ? (
        <EmptyState
          title={CO_LOC_NGOAI_LE(loc) ? "Không có ngoại lệ nào khớp bộ lọc" : "Không có ngoại lệ nào cần xử lý"}
          description={
            CO_LOC_NGOAI_LE(loc)
              ? "Chọn «Tất cả» hoặc xoá lọc để xem toàn bộ ngoại lệ trong phạm vi của bạn."
              : "Mọi hồ sơ AI trong cơ sở bạn phụ trách đều tạo lead được, đã có sale phụ trách và còn trong hạn. Hồ sơ đang chờ duyệt bình thường nằm ở «Hồ sơ chờ AI»."
          }
        />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
            {kq.biCat
              ? `Hiện ${kq.hang.length} ngoại lệ đứng đầu trong ${kq.tong} ngoại lệ khớp (tối đa ${SO_DONG_TOI_DA}). Chọn loại hoặc thu hẹp bộ lọc để xem phần còn lại.`
              : `${kq.tong} ngoại lệ khớp bộ lọc. Lỗi tạo lead đứng trước, rồi lead chưa có sale, rồi quá hạn; trong mỗi loại việc cũ nhất đứng trước.`}
          </p>
          <DanhSachNgoaiLe hang={kq.hang} khoaTrang={JSON.stringify(loc)} />
        </>
      )}
    </>
  );
}
