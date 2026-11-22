// lib/catalog/sale-catalog.ts — tra cứu danh mục cho tư vấn viên.
//
// Toàn bộ CHỈ ĐỌC: không server action, không migration. Mục đích hẹp và cụ thể —
// đang ngồi với phụ huynh thì tra được giá khoá, giá học cụ, và lớp nào còn chỗ,
// mà không phải quay về khu quản trị hay hỏi miệng đồng nghiệp.
//
// ⚠️ HAI THỨ CỐ Ý KHÔNG CÓ Ở ĐÂY
//
// 1. GIÁ VỐN và TỒN KHO của học cụ (`Product.costPrice`, `stockOnHand`).
//    Sale không có quyền kho. Cắt Ở TẦNG TRUY VẤN chứ không phải "không vẽ ra":
//    trả về rồi giấu trên giao diện là con số vẫn đi xuống trình duyệt trong
//    payload RSC, mở DevTools là đọc được.
//
// 2. VOUCHER. Hệ mã khuyến mãi đã GỠ 03/08/2026 theo chốt chủ dự án — giảm giá
//    nay nhập tay theo %/số tiền kèm giải trình, và `orderCreateManualSchema`
//    KHÔNG còn trường voucher nào (kiểm: 0 hit). Dựng màn tra mã cho Sale là cho
//    họ xem những mã không áp được vào đâu.
import "server-only";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";

/** Trạng thái lớp còn nhận học viên. Lấy đúng bộ mà màn ghi danh dùng để chọn lớp. */
export const TRANG_THAI_LOP_MO = ["PLANNED", "RECRUITING", "ACTIVE"] as const;

export type KhoaHocRow = {
  id: string;
  code: string | null;
  name: string;
  price: number | null;
};

export type HocCuRow = {
  id: string;
  sku: string;
  name: string;
  salePrice: number;
  category: string;
};

export type LopRow = {
  id: string;
  ten: string;
  tenKhoa: string;
  tenCoSo: string | null;
  status: string;
  siSo: number;
  sucChua: number;
  /** Còn bao nhiêu chỗ. Âm không xảy ra ở đây (đã kẹp về 0). */
  conTrong: number;
  lich: string | null;
  batDau: Date | null;
};

/**
 * Còn bao nhiêu chỗ trong lớp. THUẦN.
 *
 * Kẹp về 0 vì lớp có thể vượt sức chứa do xếp tay/chuyển lớp, và hiện "còn −2
 * chỗ" thì người tư vấn phải tự dịch trong đầu giữa lúc đang nói chuyện với khách.
 */
export function conTrong(siSo: number, sucChua: number): number {
  return Math.max(0, sucChua - siSo);
}

export type SaleCatalog = {
  khoaHoc: KhoaHocRow[];
  hocCu: HocCuRow[];
  lop: LopRow[];
};

/**
 * Danh mục tra cứu, đã lọc theo quyền của người xem.
 *
 * Ba khối độc lập nhau: ai có quyền nào thì nhận khối đó, không có thì nhận mảng
 * rỗng. Nạp cả ba rồi mới lọc là tốn truy vấn cho khối sẽ bị giấu.
 */
export async function getSaleCatalog(
  actor: Actor,
  quyen: { xemHocCu: boolean; xemLop: boolean; xemKhoaHoc: boolean },
): Promise<SaleCatalog> {
  const sdb = scopedDb(actor);

  const [khoaHoc, hocCu, lop] = await Promise.all([
    quyen.xemKhoaHoc
      ? sdb.course.findMany({
          // Chỉ khoá DẠY THẬT. Hai bản ghi "danh mục" (Lập trình Robot / Luyện
          // thi RoboSim) có `isTeachable=false` — chúng là trang marketing, không
          // phải thứ bán được, và cùng bộ lọc mà form tạo đơn dùng.
          where: { isActive: true, isTeachable: true },
          orderBy: { displayOrder: "asc" },
          select: { id: true, code: true, name: true, price: true },
        })
      : Promise.resolve([]),

    quyen.xemHocCu
      ? sdb.product.findMany({
          where: { status: "ACTIVE", category: { in: ["KIT_ROBOT", "SENSOR"] } },
          orderBy: { name: "asc" },
          take: 200,
          // KHÔNG `costPrice`, KHÔNG `stockOnHand` — xem ghi chú đầu file.
          select: { id: true, sku: true, name: true, salePrice: true, category: true },
        })
      : Promise.resolve([]),

    quyen.xemLop
      ? sdb.class.findMany({
          where: { deletedAt: null, status: { in: [...TRANG_THAI_LOP_MO] } },
          orderBy: [{ startDate: "asc" }, { name: "asc" }],
          take: 200,
          select: {
            id: true,
            name: true,
            classCode: true,
            status: true,
            maxStudents: true,
            schedule: true,
            startDate: true,
            course: { select: { name: true } },
            center: { select: { name: true } },
            // Sĩ số = số ghi danh còn sống. Đếm ở DB thay vì kéo cả danh sách:
            // trang này chỉ cần con số, và kéo roster của 200 lớp là vô ích.
            _count: { select: { enrollments: { where: { deletedAt: null } } } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    khoaHoc,
    hocCu,
    lop: lop.map((c) => {
      const siSo = c._count.enrollments;
      return {
        id: c.id,
        ten: c.classCode ? `${c.classCode} · ${c.name}` : c.name,
        tenKhoa: c.course?.name ?? "",
        tenCoSo: c.center?.name ?? null,
        status: c.status,
        siSo,
        sucChua: c.maxStudents,
        conTrong: conTrong(siSo, c.maxStudents),
        lich: c.schedule,
        batDau: c.startDate,
      };
    }),
  };
}
