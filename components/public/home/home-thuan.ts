// Hàm THUẦN + dữ liệu tĩnh của trang chủ `/` (không DB, không React) — test ở home-thuan.test.ts.
// Nguồn nội dung: artifact "Sata Robo — Website mới" (board Main). Số liệu giá/giờ/SĐT lấy từ
// repo (lib/uu-dai, lib/locations, bảng giá khoá học) — chỗ nào artifact lệch repo thì THEO REPO.
import { dinhDangTien } from "@/lib/gia-cong-khai";
import { TRIAL_SESSION_MINUTES, TRIAL_TEST_MINUTES } from "@/lib/uu-dai";
import { SATA_ROBO_PHONE } from "@/lib/locations";

/** Khoá theo năm: 12 tháng × 4 buổi ⇒ học phí tháng = học phí năm / 12 (cùng luật với trang khoá học). */
const SO_THANG_TRONG_NAM = 12;

/** Giá niêm yết (VND) của các khoá dùng ở trang chủ. null = chưa có nguồn nào ⇒ KHÔNG in giá. */
export type GiaTrangChu = {
  sata1: number | null;
  sata3: number | null;
  sata4: number | null;
  sata5: number | null;
};

/** Slug đúng của bốn khoá lấy giá cho trang chủ. */
export const SLUG_GIA_TRANG_CHU = ["sata1", "sata3", "sata4", "sata5"] as const;

/**
 * Dựng bảng giá trang chủ từ các dòng `Course`. Khớp slug CHÍNH XÁC (khoá demo `sata-3`, `sata-1`…
 * không được lọt vào), chỉ nhận khoá đang công khai và có giá > 0; còn lại là null ⇒ thẻ bỏ dòng giá.
 */
export function dungGiaTrangChu(
  hang: readonly { slug: string; price: number | null; isPublished: boolean }[],
): GiaTrangChu {
  const lay = (slug: string): number | null => {
    const h = hang.find((x) => x.slug === slug);
    return h && h.isPublished && typeof h.price === "number" && h.price > 0 ? h.price : null;
  };
  return { sata1: lay("sata1"), sata3: lay("sata3"), sata4: lay("sata4"), sata5: lay("sata5") };
}

/** "880.000đ" từ học phí năm; null khi không có giá thật (không bịa số). */
export function giaThangTuNam(giaNam: number | null): string | null {
  if (typeof giaNam !== "number" || !Number.isFinite(giaNam) || giaNam <= 0) return null;
  return dinhDangTien(Math.round(giaNam / SO_THANG_TRONG_NAM));
}

/** "2.400.000đ" từ học phí trọn khoá; null khi không có giá thật. */
export function giaTronKhoa(gia: number | null): string | null {
  if (typeof gia !== "number" || !Number.isFinite(gia) || gia <= 0) return null;
  return dinhDangTien(gia);
}

// ───────────────────────────── [01] Giá trên bốn thẻ khoá học ─────────────────────────────

/** Chuỗi giá đã định dạng trên từng thẻ; null ⇒ thẻ BỎ khối giá (không có nguồn giá thật). */
export type GiaTheKhoa = { combo: string | null; sata3: string | null; sata4: string | null; sata5: string | null };

/** Thẻ combo = giá trọn khoá của Sata1; Sata3/4/5 = học phí năm chia 12 (đúng như thẻ của artifact). */
export function chuoiGiaThe(g: GiaTrangChu): GiaTheKhoa {
  return { combo: giaTronKhoa(g.sata1), sata3: giaThangTuNam(g.sata3), sata4: giaThangTuNam(g.sata4), sata5: giaThangTuNam(g.sata5) };
}

// ───────────────────────────── Robot con sẽ tự lắp ─────────────────────────────

export type MoHinhRobot = { ma: string; ten: string; kyNang: string };
export type BoRobot = { id: "alpha" | "beta" | "intel"; ten: string; phu: string; moTa: string; moHinh: readonly MoHinhRobot[] };

export const BO_ROBOT: readonly BoRobot[] = [
  {
    id: "alpha",
    ten: "Alpha Set",
    phu: "Sata3 · Lớp 1–2",
    moTa: "Alpha Set: chi tiết to, màu sáng, an toàn cho bé lớp 1–2. Con lắp theo sơ đồ, ra lệnh bằng thẻ lệnh và khối kéo thả, có cảm biến chạm, màu sắc, khoảng cách.",
    moHinh: [
      { ma: "a666ac3e1e338d2186c3c7704b0fa511", ten: "Khủng long", kyNang: "Cơ cấu tay quay" },
      { ma: "6d64d0aed432227fd19aaa18afd44f09", ten: "Nhện máy", kyNang: "Chân cơ khí" },
      { ma: "8c9365e26dd4ede7db958a30894e4cc3", ten: "Xe mô tô", kyNang: "Bánh xe & truyền động" },
      { ma: "757f5506e2bfc9f119f240ff0c85b9cf", ten: "Máy bay", kyNang: "Cánh quạt & động cơ" },
      { ma: "dd966068efe92510461254bf4f9d08b1", ten: "Tua-bin gió", kyNang: "Năng lượng gió" },
      { ma: "b12251c25fa9398ac9004b9d8bbdc30b", ten: "Xe nâng hàng", kyNang: "Ròng rọc & nâng hạ" },
    ],
  },
  {
    id: "beta",
    ten: "Beta Set",
    phu: "Sata4 · Sata6 · Lớp 3+",
    moTa: "Beta Set: bộ điều khiển trung tâm và cảm biến chính xác cao. Con tự viết logic cho robot dò line, tránh vật cản, rồi tối ưu để đi thi đấu.",
    moHinh: [
      { ma: "dbdef77fa2d35499f574fa1ec71acf88", ten: "Xe dò line", kyNang: "Cảm biến dò line" },
      { ma: "905ff0dd9c6dc83a67626cb74cc37dd2", ten: "Xe tránh vật cản", kyNang: "Cảm biến siêu âm" },
      { ma: "09fd7f896dc358d880c0f8c19aa00030", ten: "Cơ cấu bánh răng", kyNang: "Truyền động & gỡ lỗi" },
      { ma: "368d0fd5444dc86f2fdc53229baed55b", ten: "Bộ điều khiển trung tâm", kyNang: "Lập trình & màn hình" },
    ],
  },
  {
    id: "intel",
    ten: "Intel Set",
    phu: "Sata5 · Sata7 · AI & IoT",
    moTa: "Intel Set: camera AI thế hệ mới + MCU hiệu năng cao. Học theo dự án: robot nhận diện khuôn mặt, vật thể, QR code, cử chỉ và kết nối IoT.",
    moHinh: [
      { ma: "f5f7c32bbcd018254cf34914d98fd82c", ten: "Xe địa hình đa hướng", kyNang: "Bánh mecanum" },
      { ma: "a4a79a0d61a4560ccd90b725cfe0df99", ten: "Xe bánh xích vòng", kyNang: "Vượt địa hình" },
      { ma: "b08d704ff20f13117e0b8e9b31de1a63", ten: "Xe xúc gắp", kyNang: "Cánh tay gắp" },
      { ma: "83b7b0f4a6a49ceb5e0f2d7c8216b256", ten: "Bọ 6 chân", kyNang: "Cơ cấu đi bộ" },
      { ma: "adf64e0aa6eb46054b9ac6dc4bc2d038", ten: "Xe đua F1", kyNang: "Tốc độ & điều khiển" },
      { ma: "0f72f010d69f5bd7650a9e5a4f2a072a", ten: "Robot hình người", kyNang: "Camera & cảm biến" },
    ],
  },
];

/** Lưới 4 mô hình dùng bố cục 4 cột (`.kit-grid.c4`), còn lại 3 cột — đúng như artifact. */
export function lopLuoiBo(bo: BoRobot): string {
  return bo.moHinh.length === 4 ? "kit-grid c4" : "kit-grid";
}

/** Bộ đang chọn; id lạ rơi về bộ đầu (Alpha) thay vì ném lỗi. */
export function chonBo(id: string): BoRobot {
  return BO_ROBOT.find((b) => b.id === id) ?? BO_ROBOT[0];
}

// ───────────────────────────── [06] Câu hỏi thường gặp ─────────────────────────────

export type CauHoi = { q: string; a: string };

/**
 * 5 câu hỏi của artifact. Số liệu theo REPO: thời lượng học thử lấy từ `@/lib/uu-dai`, học phí lấy
 * từ giá thật (thiếu giá thì câu trả lời KHÔNG nêu số, chỉ mời liên hệ — không bịa).
 */
export function dungCauHoi(gia: GiaTrangChu): CauHoi[] {
  const thang = giaThangTuNam(gia.sata3);
  const tron = giaTronKhoa(gia.sata1);
  const hocPhi =
    thang && tron
      ? `Học phí chia theo tháng, mỗi tháng 4 buổi: khoá chuyên sâu chỉ từ ${thang}/tháng, khoá luyện thi tính trọn khoá từ ${tron} (đã gồm VAT).`
      : `Học phí chia theo tháng, mỗi tháng 4 buổi; khoá luyện thi tính trọn khoá (đã gồm VAT). Học phí thay đổi theo từng đợt ưu đãi — gọi hoặc nhắn Zalo ${SATA_ROBO_PHONE.hien} để nhận giá mới nhất.`;
  return [
    {
      q: "Con có được học thử 1-1 miễn phí không?",
      a: `Có. Buổi học thử gồm ${TRIAL_TEST_MINUTES} phút test năng lực đầu vào và ${TRIAL_SESSION_MINUTES} phút học 1 kèm 1 cùng giáo viên. Hoàn toàn 0 đồng, không ràng buộc đăng ký.`,
    },
    {
      q: "Con học lớp mấy thì vào khoá nào?",
      a: "Lớp 1–2 học Sata3, lớp 3–4 học Sata4, lớp 5 học Sata5, lớp 6–7 học Sata6 và lớp 8 học Sata7. Học viên muốn thi Robotics có thêm khoá luyện thi Sata1, Sata2, Combo và Sata8.",
    },
    { q: "Học phí đóng thế nào?", a: hocPhi },
    {
      q: "Sata Robo cam kết hoàn tiền ra sao?",
      a: "Hoàn 100% học phí nếu ba mẹ không hài lòng sau buổi học đầu tiên, không cần lý do, trong 3 ngày làm việc.",
    },
    { q: "Con nghỉ một buổi thì sao?", a: "Con được sắp xếp học bù tại cơ sở đang học để theo kịp tiến độ lớp." },
  ];
}

/** Câu FAQ nào đang mở; bấm lại câu đang mở thì đóng (-1), như artifact. */
export function doiCauMo(dangMo: number, bam: number): number {
  return dangMo === bam ? -1 : bam;
}

// ───────────────────────────── [05] Phản hồi phụ huynh ─────────────────────────────

/** Số thẻ phản hồi tối đa ở trang chủ (artifact vẽ 4 thẻ). */
export const SO_PHAN_HOI_TOI_DA = 4;

/**
 * Chọn phản hồi để hiển thị: bỏ bản ghi rỗng nội dung/tên, tối đa 4. Danh sách rỗng ⇒ mảng rỗng
 * (khối bị ẩn, KHÔNG dựng khung giữ chỗ).
 */
export function chonPhanHoiTrangChu<T extends { name: string; content: string }>(danhSach: readonly T[]): T[] {
  return danhSach.filter((t) => t.content.trim() !== "" && t.name.trim() !== "").slice(0, SO_PHAN_HOI_TOI_DA);
}
