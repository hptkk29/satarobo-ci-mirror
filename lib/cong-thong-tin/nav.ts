/**
 * Nhãn + đường dẫn lối vào «Tủ sách» và «Sức khỏe» (07/11/2026). Từ 10/11/2026 hai mục này đứng trong nhóm «Góc gia đình»
 * (`lib/public/goc-gia-dinh.ts`, cùng mục DISC) — nơi đó mới là chỗ quyết định mục nào hiện theo cờ. Đừng chèn hai mục này
 * thẳng vào một danh sách menu: đó là cách tách ra thành hai bản trôi khỏi nhau (`[PUBLIC-NAV-T02]`).
 */
export const TU_SACH_NAV = { label: "Tủ sách", href: "/tu-sach" } as const;
export const SUC_KHOE_NAV = { label: "Sức khỏe", href: "/suc-khoe" } as const;

/** Cờ của hai cổng thông tin, đọc ở SERVER rồi truyền xuống bằng prop (client không tự đoán cờ). */
export type CoCongThongTin = { tuSach: boolean; sucKhoe: boolean };
