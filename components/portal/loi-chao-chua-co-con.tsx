import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Lời chào cho tài khoản phụ huynh CHƯA liên kết học viên nào (05/11/2026) — thay câu «Tài khoản chưa được liên kết với học viên
 * nào…» (một ngõ cụt chữ). Khách làm DISC xong rồi vào cổng thường rơi vào đây: chưa có lịch học / học phí / nhận xét nào để xem, nên
 * trang nói thẳng điều đó và đưa ra việc làm được ngay: xem DISC (nếu khu DISC đang mở).
 *
 * KHÔNG có nút «Đăng ký học thử» (chủ dự án 05/11/2026): thông tin khách khai ở bài DISC đã về phiếu khách (lead) và đang được chia
 * cho cơ sở, nên bảo họ đăng ký lần nữa chỉ sinh phiếu trùng. Đừng thêm lại khi chưa hỏi.
 *
 * Thuần trình bày, KHÔNG tự tính gì: `coDisc` (cờ bật ∧ vai PARENT — cùng nguồn với `choPhepDisc` ở layout, nên nút chỉ hiện khi
 * `/portal/disc` thật sự mở được — luật 12) do layout truyền. Có bé gắn vào tài khoản thì layout không dựng thành phần này nữa.
 */
export function LoiChaoChuaCoCon({
  ten,
  coDisc,
  hotline,
}: {
  ten: string;
  coDisc: boolean;
  hotline: string;
}) {
  return (
    <section
      aria-labelledby="loi-chao-chua-co-con"
      className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 rounded-2xl border border-border bg-card px-6 py-10 text-center"
    >
      <h1 id="loi-chao-chua-co-con" className="text-xl font-bold text-foreground sm:text-2xl">
        Chào {ten}!
      </h1>
      <p className="text-sm leading-6 text-muted-foreground">
        Cảm ơn bạn đã đồng hành cùng Sata Robo. Tài khoản này chưa liên kết với bé nào đang học, nên chưa có lịch học, học phí hay nhận
        xét để xem. Khi bé đăng ký học, các mục đó sẽ tự mở ra ở đây.
      </p>
      {coDisc && (
        <Link href="/portal/disc" className={cn(buttonVariants({ size: "lg" }), "min-h-11 sm:min-w-44")}>
          Khám phá DISC
        </Link>
      )}
      <p className="text-xs text-muted-foreground">
        Cần hỗ trợ? Gọi{" "}
        <a href={`tel:${hotline.replace(/\D/g, "")}`} className="font-semibold text-foreground">
          {hotline}
        </a>
      </p>
    </section>
  );
}
