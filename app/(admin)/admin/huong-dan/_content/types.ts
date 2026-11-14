export interface AdminGuide {
  /** Slug trên URL: /huong-dan/<slug> (URL gọn — proxy rewrite /admin/huong-dan). */
  slug: string;
  /** Thứ tự đọc (theo tiền tố số của file nguồn). */
  order: number;
  title: string;
  category: string;
  description: string;
  /** Trang chức năng tương ứng — nút "Mở trang" ở cuối bài (URL gọn như sidebar). */
  pagePath?: string;
  /** Nội dung markdown — đồng bộ từ bộ nguồn `satarobo-huongdan/siteadmin`. */
  body: string;
}
