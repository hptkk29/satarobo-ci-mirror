export interface PortalGuide {
  /** Slug trên URL: /portal/huong-dan/<slug>. */
  slug: string;
  /** Thứ tự đọc (theo tiền tố số của file nguồn). */
  order: number;
  title: string;
  category: string;
  description: string;
  /** Trang chức năng tương ứng — nút "Mở trang" ở cuối bài. */
  pagePath?: string;
  /** Nội dung markdown — đồng bộ từ bộ nguồn `satarobo-huongdan/sitephuhuynh`. */
  body: string;
}
