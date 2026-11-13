// lib/portal/qua-tang.ts — DANH MỤC «Quà tặng» của cổng phụ huynh (12/11/2026). THUẦN (không DB, dùng được ở client).
//
// «Quà tặng» = hộp gom các tính năng MIỄN PHÍ của Sata Robo dành cho ba mẹ (Khám phá DISC · Sức khỏe cả nhà · Tủ sách gia đình) và
// các tính năng free sẽ phát triển sau. Chủ dự án chốt 12/11/2026: thay ba mục menu rời bằng MỘT ô «Quà tặng» + MỘT ô «Khuyến mãi».
//
// Thêm quà mới = thêm MỘT dòng vào `DANH_MUC_QUA_TANG` (kèm cờ bật/tắt của nó) — không sửa màn. Mỗi quà theo CỜ RIÊNG của trang đích: cờ tắt
// ⇒ quà không hiện ⇒ không có link chết (trang đích vốn tự 404 khi cờ tắt). Hộp quà tắt hẳn khi MỌI cờ tắt.

export type MaQuaTang = "disc" | "suc-khoe" | "tu-sach";

export type QuaTang = {
  ma: MaQuaTang;
  href: string;
  ten: string;
  /** Dòng phụ dưới tên. */
  phu: string;
  mo: string;
  nut: string;
  /** Cặp màu nền/chữ của ô biểu tượng (token tương phản đã duyệt ở board M-Qua-tang). */
  nen: string;
  chu: string;
};

export const DANH_MUC_QUA_TANG: readonly QuaTang[] = [
  {
    ma: "disc",
    href: "/portal/disc",
    ten: "Khám phá DISC",
    phu: "Tính cách cả nhà",
    mo: "Mỗi người làm một bài ngắn để hiểu cách mình và con hành xử, rồi nhận gợi ý cách nói chuyện cho từng cặp trong nhà.",
    nut: "Mở DISC",
    nen: "#f3eaf8",
    chu: "#620c8b",
  },
  {
    ma: "suc-khoe",
    href: "/portal/suc-khoe",
    ten: "Sức khoẻ cả nhà",
    phu: "Thói quen từng người",
    mo: "Khảo sát thói quen ăn, ngủ, vận động của từng người và nhận lời khuyên cụ thể theo hướng dẫn WHO, Viện Dinh dưỡng.",
    nut: "Mở Sức khoẻ",
    nen: "#e3f4ee",
    chu: "#0f5c55",
  },
  {
    ma: "tu-sach",
    href: "/portal/tu-sach",
    ten: "Tủ sách cho ba mẹ",
    phu: "20 cẩm nang · SGK",
    mo: "Cẩm nang Ban Đào tạo Sata Robo soạn cho ba mẹ, tải về in được; kèm đường dẫn sách giáo khoa chính thức.",
    nut: "Mở Tủ sách",
    nen: "#fff1e4",
    chu: "#c2570c",
  },
];

export type CoQuaTang = { disc: boolean; sucKhoe: boolean; tuSach: boolean };

/** Các quà ĐANG MỞ theo cờ (giữ thứ tự danh mục). */
export function quaTangDangMo(co: CoQuaTang): QuaTang[] {
  const bat: Record<MaQuaTang, boolean> = { disc: co.disc, "suc-khoe": co.sucKhoe, "tu-sach": co.tuSach };
  return DANH_MUC_QUA_TANG.filter((q) => bat[q.ma]);
}

/** Hộp quà có mở không — MỘT hàm cho menu, ô ở trang chủ, và cổng của chính trang `/portal/qua-tang`. */
export const coQuaTangNao = (co: CoQuaTang): boolean => quaTangDangMo(co).length > 0;
