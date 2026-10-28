// app/(elearning)/elearning/_components/menu.ts — MENU KHU HỌC TẬP NỘI BỘ, hàm THUẦN của quyền.
//
// Trước đây `layout.tsx` vừa hỏi quyền vừa dựng mảng link phẳng 12 mục. Tách phần DỰNG MENU ra đây để:
//   • test được bằng bảng "tổ hợp quyền → tập href thấy được" (tests/elearning/menu-dieu-huong.test.ts) —
//     đó là lưới chống lộ mục menu (và, với F-01, chống lộ báo cáo toàn hệ cho quản lý cơ sở);
//   • khung giao diện (thanh bên / ngăn kéo) chỉ VẼ, không quyết gì về quyền.
//
// ⚠️ Đây KHÔNG phải cổng bảo vệ. Cổng thật là `can()` ở từng trang + từng Server Action (giữ nguyên). Menu chỉ
// quyết định có VẼ lối vào hay không. Các boolean đi vào đây do `layout.tsx` tính bằng `can(actor, "elearning:…")`
// — KHÔNG so vai, KHÔNG so centerId (luật `no-inline-authz`).
//
// ⚠️ Mỗi mục chỉ trỏ route ĐÃ CÓ. Mục brief nhắc mà chưa có route (Lộ trình học, Kết quả học tập, Năng lực nhân
// sự…) KHÔNG vào menu — xem docs/elearning/ux/wave1-khao-sat.md §3.

export type KhuId = "hoc-tap" | "dao-tao" | "co-so" | "bao-cao" | "quan-tri";

export type BieuTuong =
  | "tong-quan"
  | "khoa"
  | "chung-nhan"
  | "du-lieu"
  | "chuong-trinh"
  | "soan"
  | "cau-hoi"
  | "de-thi"
  | "khung-cham"
  | "giao-bai"
  | "cham-bai"
  | "cham-thi"
  | "yeu-cau"
  | "co-so"
  | "bao-cao"
  | "phong-ban"
  | "ket-qua"
  | "ma-tran"
  | "hieu-qua"
  | "tu-dong"
  | "danh-gia"
  | "thong-bao";

/** Các boolean quyền do layout tính bằng `can()`; `evalLinkBat` là cờ EL-21 (`ELEARNING_EVAL_LINK_ENABLED`). */
export type QuyenMenu = {
  /** `elearning:content:author` */
  soan: boolean;
  /** `elearning:exam:grade` */
  cham: boolean;
  /** `elearning:assignment:create` */
  giao: boolean;
  /** `elearning:progress:view-all` */
  baoCao: boolean;
  /**
   * `elearning:progress:view-team` — F-01: quản lý cơ sở. Chỉ có hiệu lực khi KHÔNG có `baoCao`
   * (người xem toàn hệ đã có mục "Báo cáo"; hiện cả hai là vẽ hai mục cùng một đích).
   */
  baoCaoDoi: boolean;
  /** `elearning:requirement:manage` */
  quanLyYeuCau: boolean;
  /** `elearning:program:manage` */
  quanLyChuongTrinh: boolean;
  /** Cờ EL-21 — mặc định OFF; OFF thì ẩn mục "Mức đánh giá". */
  evalLinkBat: boolean;
};

export type MucMenu = {
  href: string;
  nhan: string;
  bieuTuong: BieuTuong;
};

export type KhuMenu = {
  id: KhuId;
  nhan: string;
  /** Một câu nói khu này dùng để làm gì — hiện ở bộ chuyển khu. */
  moTa: string;
  muc: MucMenu[];
};

const KHU: { id: KhuId; nhan: string; moTa: string }[] = [
  { id: "hoc-tap", nhan: "Học tập", moTa: "Khoá được giao, chứng nhận của bạn" },
  { id: "dao-tao", nhan: "Đào tạo", moTa: "Soạn nội dung, giao khoá, chấm bài" },
  { id: "co-so", nhan: "Quản lý cơ sở", moTa: "Tiến độ nhân viên cơ sở bạn quản lý" },
  { id: "bao-cao", nhan: "Báo cáo & tuân thủ", moTa: "Ma trận, chứng nhận, báo cáo toàn hệ" },
  { id: "quan-tri", nhan: "Quản trị chương trình", moTa: "Tự động hoá và mức đánh giá" },
];

/** Dựng các khu làm việc người này thấy. Khu rỗng không xuất hiện; khu "Học tập" luôn có. */
export function menuElearning(q: QuyenMenu): KhuMenu[] {
  // Báo cáo đội chỉ khi KHÔNG có quyền xem toàn hệ (F-01) — phòng thủ ngay tại đây, không chỉ ở layout.
  const baoCaoDoi = q.baoCaoDoi && !q.baoCao;

  const muc: Record<KhuId, MucMenu[]> = {
    "hoc-tap": [
      { href: "/elearning", nhan: "Tổng quan", bieuTuong: "tong-quan" },
      { href: "/elearning/khoa-cua-toi", nhan: "Khoá của tôi", bieuTuong: "khoa" },
      { href: "/elearning/chung-nhan-cua-toi", nhan: "Chứng nhận của tôi", bieuTuong: "chung-nhan" },
      { href: "/elearning/du-lieu-cua-toi", nhan: "Dữ liệu của tôi", bieuTuong: "du-lieu" },
    ],
    "dao-tao": [
      // Tổng quan vận hành — hiện cho người có BẤT KỲ quyền vận hành nào; mỗi khối bên trong trang tự gác bằng quyền riêng.
      ...(q.soan || q.cham || q.giao
        ? [{ href: "/elearning/dao-tao", nhan: "Tổng quan Đào tạo", bieuTuong: "tong-quan" as const }]
        : []),
      ...(q.soan
        ? [
            { href: "/elearning/chuong-trinh", nhan: "Chương trình", bieuTuong: "chuong-trinh" as const },
            { href: "/elearning/soan-khoa", nhan: "Soạn khoá", bieuTuong: "soan" as const },
            { href: "/elearning/kho-cau-hoi", nhan: "Ngân hàng câu hỏi", bieuTuong: "cau-hoi" as const },
            { href: "/elearning/de-thi", nhan: "Đề thi", bieuTuong: "de-thi" as const },
            { href: "/elearning/khung-cham", nhan: "Khung chấm", bieuTuong: "khung-cham" as const },
          ]
        : []),
      ...(q.giao ? [{ href: "/elearning/giao-bai", nhan: "Giao khoá", bieuTuong: "giao-bai" as const }] : []),
      ...(q.cham
        ? [
            { href: "/elearning/cham-bai-tap", nhan: "Chấm bài tập", bieuTuong: "cham-bai" as const },
            { href: "/elearning/cham-bai", nhan: "Chấm bài thi", bieuTuong: "cham-thi" as const },
          ]
        : []),
      // Hiện cho cả người chỉ XEM được: họ cần biết nghĩa vụ nào đang áp cho người của mình. Nút khai bên
      // trong màn mới gác bằng `requirement:manage`.
      ...(q.baoCao || q.quanLyYeuCau
        ? [{ href: "/elearning/yeu-cau", nhan: "Yêu cầu đào tạo", bieuTuong: "yeu-cau" as const }]
        : []),
    ],
    "co-so": baoCaoDoi
      ? [{ href: "/elearning/bao-cao", nhan: "Báo cáo đội", bieuTuong: "co-so" as const }]
      : [],
    "bao-cao": [
      ...(q.baoCao
        ? [
            { href: "/elearning/bao-cao", nhan: "Tổng quan báo cáo", bieuTuong: "bao-cao" as const },
            { href: "/elearning/bao-cao-r4", nhan: "Theo phòng ban", bieuTuong: "phong-ban" as const },
            { href: "/elearning/bao-cao-r5", nhan: "Kết quả thi", bieuTuong: "ket-qua" as const },
          ]
        : []),
      ...(q.baoCao || q.quanLyYeuCau
        ? [{ href: "/elearning/ma-tran", nhan: "Ma trận đào tạo", bieuTuong: "ma-tran" as const }]
        : []),
      ...(q.baoCao
        ? [
            { href: "/elearning/chung-nhan", nhan: "Chứng nhận", bieuTuong: "chung-nhan" as const },
            { href: "/elearning/bao-cao-r7", nhan: "Hiệu quả đào tạo", bieuTuong: "hieu-qua" as const },
          ]
        : []),
    ],
    "quan-tri": [
      // Hiện cho cả người chỉ xem báo cáo: nhật ký thi hành là chỗ trả lời "vì sao người này được giao khoá đó".
      // Nút bật/tắt bên trong gác bằng `program:manage`.
      ...(q.quanLyChuongTrinh || q.baoCao
        ? [{ href: "/elearning/tu-dong-hoa", nhan: "Tự động hoá", bieuTuong: "tu-dong" as const }]
        : []),
      ...(q.quanLyChuongTrinh && q.evalLinkBat
        ? [{ href: "/elearning/muc-danh-gia", nhan: "Mức đánh giá", bieuTuong: "danh-gia" as const }]
        : []),
    ],
  };

  return KHU.filter((k) => k.id === "hoc-tap" || muc[k.id].length > 0).map((k) => ({ ...k, muc: muc[k.id] }));
}

/** Mọi href mà `q` thấy — dùng cho test và cho phép "khu nào chứa đường dẫn này". */
export function moiHrefThay(khu: readonly KhuMenu[]): string[] {
  return khu.flatMap((k) => k.muc.map((m) => m.href));
}

// Đường dẫn con không trùng tiền tố với href của mục nào nhưng thuộc về một mục.
const BI_DANH: readonly (readonly [string, string])[] = [
  ["/elearning/hoc", "/elearning/khoa-cua-toi"], // đề cương + bài học = đi sâu vào "Khoá của tôi"
  ["/elearning/soan", "/elearning/soan-khoa"], // trình soạn bài thuộc soạn khoá (tiền tố `soan` ≠ `soan-khoa`)
];

const khopTienTo = (p: string, tienTo: string) => p === tienTo || p.startsWith(`${tienTo}/`);

/**
 * Trên host `e-learning.satarobo.vn` proxy rewrite clean URL (`/` → `/elearning`, `/ma-tran` → `/elearning/ma-tran`)
 * và `usePathname()` trả đường dẫn TRÌNH DUYỆT thấy. Đưa về dạng có tiền tố `/elearning` trước khi so khớp —
 * thiếu bước này, người vào bằng host thật không thấy mục nào sáng (đúng lớp lỗi "affordance nói dối").
 */
export function chuanHoaDuongDan(p: string): string {
  const s = p.length > 1 ? p.replace(/\/+$/, "") : p;
  if (s === "/" || s === "") return "/elearning";
  return s === "/elearning" || s.startsWith("/elearning/") ? s : `/elearning${s}`;
}

/**
 * Mục đang mở: href dài nhất khớp tiền tố đoạn (`/elearning/bao-cao-r4` KHÔNG khớp `/elearning/bao-cao`).
 * `/elearning` chỉ khớp chính nó. Trả `null` nếu đường dẫn không thuộc mục nào người này thấy.
 */
export function mucDangMo(khu: readonly KhuMenu[], duongDan: string): { khu: KhuId; href: string } | null {
  const p = chuanHoaDuongDan(duongDan);
  const dich = BI_DANH.find(([tuongUng]) => khopTienTo(p, tuongUng))?.[1] ?? null;
  let tot: { khu: KhuId; href: string } | null = null;
  for (const k of khu) {
    for (const m of k.muc) {
      const khop = m.href === "/elearning" ? p === m.href : khopTienTo(p, m.href) || m.href === dich;
      if (khop && (!tot || m.href.length > tot.href.length)) tot = { khu: k.id, href: m.href };
    }
  }
  return tot;
}

/** Khu đang mở theo đường dẫn; rơi về "Học tập" khi không khớp mục nào. */
export function khuDangMo(khu: readonly KhuMenu[], duongDan: string): KhuId {
  return mucDangMo(khu, duongDan)?.khu ?? "hoc-tap";
}
