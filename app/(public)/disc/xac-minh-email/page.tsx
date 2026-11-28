import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { isDiscEnabled } from "@/lib/flags";
import { xacNhanEmailDiscAction } from "./_actions";
import "@/app/(public)/pub-design/disc.css";

// Cờ đọc từ env lúc CHẠY + token nằm trong query ⇒ không bao giờ tĩnh hoá/cache.
export const dynamic = "force-dynamic";

// Trang mang token nhạy cảm trên URL: không cho công cụ tìm kiếm lập chỉ mục, không cho bộ nhớ đệm lưu, và KHÔNG gửi Referer
// sang bên thứ ba (meta referrer=no-referrer). Tiêu đề trung tính — không có tên người, không có thông tin hồ sơ.
export const metadata: Metadata = {
  title: "Xác nhận email | Sata Robo",
  robots: { index: false, follow: false, nocache: true, noarchive: true },
  referrer: "no-referrer",
};

type Props = { searchParams: Promise<{ t?: string | string[]; kq?: string | string[] }> };

const mot = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function XacMinhEmailPage({ searchParams }: Props) {
  if (!isDiscEnabled()) notFound();
  const sp = await searchParams;
  const kq = mot(sp.kq);
  const t = mot(sp.t);

  let noiDung: ReactNode;
  if (kq === "ok") {
    noiDung = (
      <>
        <h1 style={{ fontSize: "clamp(22px,2.2vw,30px)" }}>Đã xác nhận email</h1>
        <p className="dj-lead">
          Cảm ơn bạn. Chúng tôi đã xếp hàng một thư thông báo gửi tới email này; thư có thể đến chậm trong ít phút. Thư không kèm nội dung kết quả của
          trẻ — để xem kết quả, hãy vào trang nhận kết quả bằng số điện thoại và mã nhận bài.
        </p>
        <a className="btn btn-acc" href="/kich-hoat?disc=1">
          Nhận kết quả DISC
        </a>
      </>
    );
  } else if (kq === "chua-xep") {
    noiDung = (
      <>
        <h1 style={{ fontSize: "clamp(22px,2.2vw,30px)" }}>Đã xác nhận email</h1>
        <p className="dj-lead">Email đã được xác nhận nhưng thư thông báo chưa được xếp hàng. Bạn vẫn nhận được kết quả bằng số điện thoại và mã nhận bài.</p>
        <a className="btn btn-acc" href="/kich-hoat?disc=1">
          Nhận kết quả DISC
        </a>
      </>
    );
  } else if (kq === "loi" || !t || t.length > 200) {
    // MỘT câu chung cho mọi nguyên nhân (không phân biệt hết hạn / đã dùng / sai).
    noiDung = (
      <>
        <h1 style={{ fontSize: "clamp(22px,2.2vw,30px)" }}>Không xác nhận được email</h1>
        <p className="dj-lead">Liên kết không hợp lệ hoặc đã hết hạn.</p>
      </>
    );
  } else {
    // GET chỉ hiện NÚT. Trình quét thư / bot mở liên kết bằng GET nên không được tự xác minh.
    noiDung = (
      <>
        <h1 style={{ fontSize: "clamp(22px,2.2vw,30px)" }}>Xác nhận email của bạn</h1>
        <p className="dj-lead">Bấm nút bên dưới để xác nhận địa chỉ email này đã được dùng khi làm bài DISC tại Sata Robo.</p>
        <form action={xacNhanEmailDiscAction}>
          <input type="hidden" name="t" value={t} />
          <button type="submit" className="btn btn-acc">
            Xác nhận email
          </button>
        </form>
        <p className="dj-note">Nếu bạn không làm bài DISC, hãy bỏ qua — chúng tôi sẽ không gửi gì thêm.</p>
      </>
    );
  }

  return (
    <main className="wrap sec" style={{ paddingTop: 48, paddingBottom: 64 }}>
      <div className="dj-card dsoon">{noiDung}</div>
    </main>
  );
}
