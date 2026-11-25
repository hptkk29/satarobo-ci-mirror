import { promises as fs } from "fs";
import path from "path";
import type { Metadata } from "next";
import Link from "next/link";
import { KhungChinhSach } from "@/components/public/phap-ly/khung-chinh-sach";
import { HuyHieuBoCongThuong } from "@/components/public/huy-hieu-bo-cong-thuong";
import { LEGAL_INDEX_SLUG, LEGAL_PAGES } from "@/lib/legal-pages";
import { tachVanBan } from "@/lib/legal/tach-van-ban";
import { SATA_ROBO_CONTACT, SATA_ROBO_PHONE } from "@/lib/locations";

// Trang MỤC LỤC các chính sách. Hai lý do tồn tại, cả hai đều cụ thể:
//  1. Cán bộ tiếp nhận hồ sơ BCT có MỘT url để kiểm đủ 10 chính sách, thay vì phải dò chân trang.
//  2. Ô tích "Chính sách hoạt động của website" (yêu cầu mục [4]) cần một đích để gắn link —
//     và cái tên đó KHÔNG có trong bộ 11 file gửi kèm, nên trỏ về mục lục là cách đọc ít suy
//     diễn nhất. ⚠️ Vẫn phải xác nhận lại với đơn vị tư vấn.
// Giao diện CHÉP từ artifact "ChinhSach-chinh-sach": khối pháp nhân `.legal` + 11 thẻ `.pol-card`.
// Khối pháp nhân lấy từ `lib/locations.ts` (đủ cơ quan cấp + ngày cấp + huy hiệu Bộ Công Thương — hồ sơ BCT đòi).
export const metadata: Metadata = {
  title: "Chính sách của website",
  description:
    "Toàn bộ chính sách áp dụng cho khách hàng khi giao dịch trên website satarobo.vn: bảo mật, giá, thanh toán, giao hàng, đổi trả, chấm dứt dịch vụ và quyền nghĩa vụ các bên.",
  alternates: { canonical: "https://satarobo.vn/chinh-sach" },
  openGraph: {
    title: "Chính sách của website | Sata Robo",
    description: "Toàn bộ chính sách áp dụng khi giao dịch trên satarobo.vn.",
    url: "https://satarobo.vn/chinh-sach",
    siteName: "Sata Robo",
  },
  robots: { index: true, follow: true },
};

/** Ngày cập nhật MỚI NHẤT trong các văn bản (đọc từ chính file .md; không có ⇒ null ⇒ không in dòng ngày). */
async function ngayCapNhatMoiNhat(): Promise<string | null> {
  const ngay: { chuoi: string; thoiDiem: number }[] = [];
  for (const p of LEGAL_PAGES) {
    try {
      const vb = tachVanBan(await fs.readFile(path.join(process.cwd(), "content", "legal", `${p.slug}.md`), "utf-8"));
      const m = vb.ngayCapNhat?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (vb.ngayCapNhat && m) ngay.push({ chuoi: vb.ngayCapNhat, thoiDiem: Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!) });
    } catch {
      // thiếu file thì bỏ qua — dòng ngày chỉ là thông tin phụ
    }
  }
  ngay.sort((a, b) => b.thoiDiem - a.thoiDiem);
  return ngay[0]?.chuoi ?? null;
}

export default async function ChinhSachIndexPage() {
  const c = SATA_ROBO_CONTACT;
  const ngayCapNhat = await ngayCapNhatMoiNhat();
  return (
    <KhungChinhSach
      slug={LEGAL_INDEX_SLUG}
      title="Chính sách của website"
      subtitle="Toàn bộ chính sách áp dụng cho khách hàng khi giao dịch trên satarobo.vn"
      breadcrumbLabel="Chính sách của website"
      ngayCapNhat={ngayCapNhat}
      hienLienHe={false}
    >
      <div className="legal sv a-blur">
        <div>
          <small>Đơn vị chủ quản</small>
          <b>{c.legalNameUpper}</b>
        </div>
        <div>
          <small>Mã số doanh nghiệp</small>
          <b>{c.businessCode}</b>
          <span>
            do {c.businessCodeIssuer} cấp ngày {c.businessCodeIssuedAt}
          </span>
        </div>
        <div>
          <small>Địa chỉ</small>
          <b>{c.address}</b>
        </div>
        <div>
          <small>Liên hệ</small>
          <b>
            <a href={`tel:${SATA_ROBO_PHONE.tho}`}>{SATA_ROBO_PHONE.hien}</a> · <a href={`mailto:${c.emails.general}`}>{c.emails.general}</a>
          </b>
        </div>
        <div>
          <HuyHieuBoCongThuong />
        </div>
      </div>
      <div className="pol-cards">
        <Link href="/dieu-khoan-su-dung" className="pol-card lift sv d2 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z"></path>
              <path d="M6.5 17A2.5 2.5 0 0 0 4 19.5 2.5 2.5 0 0 0 6.5 22H20v-5"></path>
            </svg>
          </span>
          <b>
            Điều khoản sử dụng
          </b>
          <small>
            Quy định khi truy cập, sở hữu trí tuệ, hành vi bị cấm.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/chinh-sach-bao-mat" className="pol-card lift sv d3 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
            </svg>
          </span>
          <b>
            Chính sách bảo mật
          </b>
          <small>
            Thu thập, sử dụng, lưu trữ và bảo vệ dữ liệu.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/quyen-rieng-tu" className="pol-card lift sv d4 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
            </svg>
          </span>
          <b>
            Trung tâm quyền riêng tư
          </b>
          <small>
            Quản lý cookie và quyền dữ liệu cá nhân.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/chinh-sach-gia" className="pol-card lift sv  a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="6" width="20" height="12" rx="2"></rect>
              <circle cx="12" cy="12" r="2.5"></circle>
            </svg>
          </span>
          <b>
            Chính sách về giá
          </b>
          <small>
            Niêm yết, áp dụng và điều chỉnh giá.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/chinh-sach-thanh-toan" className="pol-card lift sv d2 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2" y="6" width="20" height="12" rx="2"></rect>
              <circle cx="12" cy="12" r="2.5"></circle>
            </svg>
          </span>
          <b>
            Chính sách thanh toán
          </b>
          <small>
            Hình thức thanh toán và bảo mật giao dịch.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/chinh-sach-hoan-tra" className="pol-card lift sv d3 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="8" width="18" height="13" rx="1"></rect>
              <path d="M12 8v13M3 12h18M12 8S10 3 7.5 4 9 8 12 8zm0 0s2-5 4.5-4S15 8 12 8z"></path>
            </svg>
          </span>
          <b>
            Chính sách đổi trả hàng và hoàn tiền
          </b>
          <small>
            Đổi trả học cụ, bộ kit và hoàn tiền.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/chinh-sach-giao-hang" className="pol-card lift sv d4 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"></path>
            </svg>
          </span>
          <b>
            Chính sách giao hàng
          </b>
          <small>
            Phạm vi, thời gian, phí giao hàng.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/phuong-thuc-cung-cap-dich-vu" className="pol-card lift sv  a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"></path>
              <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"></path>
            </svg>
          </span>
          <b>
            Phương thức cung cấp dịch vụ
          </b>
          <small>
            Cách nhận và sử dụng khoá học, dịch vụ.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/chinh-sach-cham-dut-dich-vu" className="pol-card lift sv d2 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <path d="M12 6v6l4 2"></path>
            </svg>
          </span>
          <b>
            Chính sách chấm dứt dịch vụ và hoàn tiền
          </b>
          <small>
            Chấm dứt khoá học và mức hoàn học phí.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/cac-dieu-kien-va-han-che" className="pol-card lift sv d3 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="6"></circle>
              <circle cx="12" cy="12" r="2"></circle>
            </svg>
          </span>
          <b>
            Các điều kiện và hạn chế trong giao hàng và cung cấp dịch vụ
          </b>
          <small>
            Giới hạn thời gian, địa lý, số lượng.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/quyen-va-nghia-vu-cac-ben" className="pol-card lift sv d4 a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"></path>
            </svg>
          </span>
          <b>
            Quyền và nghĩa vụ của các bên
          </b>
          <small>
            Quyền, nghĩa vụ của Sata Robo và khách hàng.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
        <Link href="/phuong-thuc-tiep-nhan-phan-anh" className="pol-card lift sv  a-pop">
          <span className="ico">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"></path>
            </svg>
          </span>
          <b>
            Phương thức tiếp nhận và giải quyết phản ánh, yêu cầu, khiếu nại
          </b>
          <small>
            Kênh và trình tự giải quyết khiếu nại.
          </small>
          <em>
            Xem chi tiết →
          </em>
        </Link>
      </div>
    </KhungChinhSach>
  );
}
