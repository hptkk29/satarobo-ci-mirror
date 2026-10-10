// lib/orders/don-nhiem.ts — ĐƠN CÓ DỮ LIỆU HỎNG THÌ KHOÁ LẠI. Thuần.
//
// ─────────────────────────────────────────────────────────────────────────────
// CHỦ DỰ ÁN CHỐT 16/09/2026, BƯỚC A3
//
// *"Đơn nhiễm: đặt cờ khoá — không phát QR, không nhắc nợ ZNS, không cho xếp lớp từ đơn
// đó; màn đơn hiện banner 'Đang chờ sửa dữ liệu'. Lý do: đơn đang mang tên con nhà khác,
// gửi ra ngoài là lộ thông tin."*
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO SUY RA, KHÔNG LƯU CỜ — và chủ dự án đã duyệt cách này
//
// Cả hai tiêu chí nhiễm đều TÍNH ĐƯỢC từ dữ liệu sẵn có. Một cột `isNhiem` thì phải có
// người nhớ cập nhật ở mọi đường ghi chạm tới đơn/khoản/học viên — và repo này đã dính
// đúng lớp bug ấy nhiều lần (cờ cũ đi, dữ liệu mới tới, không ai báo). Cờ suy ra không
// bao giờ cũ đi được: nó đọc chính thứ nó phán xét.
//
// Đổi lại: mỗi cổng phải TRẢ TIỀN cho một lượt tra. Nên loader gom theo TẬP đơn
// (`donNhiemTheoDon`), không hỏi từng đơn một.
//
// ─────────────────────────────────────────────────────────────────────────────
// HAI TIÊU CHÍ, VÀ CHÚNG KHÔNG CÙNG MỨC NGUY HIỂM
//
// (1) CON NHÀ KHÁC — đơn mang tên con của một gia đình không liên quan.
//     Đây là lý do có bước A3. Đo thật trên `satarobo_local`: `ORD-260915-000007` của
//     Chị Diễm (`84941000002`) ghi hai dòng là con của `84930000044` và `84930000150`,
//     và đơn đó đang có **3 QrSession ACTIVE**. Phát QR/ZNS từ đó là gửi tên một đứa trẻ
//     cho nhà khác — LỘ THÔNG TIN, không phải chỉ sai sổ.
//
//     ⚠️ Tiêu chí này KHÔNG THỂ xảy ra trên PROD hôm nay: cột `OrderItem.studentId` do
//     migration `20260915090000_order_item_hoc_vien` thêm, và migration đó CHƯA LÊN PROD
//     (còn trong PR #271). Prod báo `42703: column oi.studentId does not exist` khi chạy
//     câu quét — đó là bằng chứng, không phải lỗi câu SQL. Nên hôm nay đây là lưới CHẶN
//     TRƯỚC cho ngày PR #271 merge, chứ chưa phải đang cứu dữ liệu prod.
//
// (2) TIỀN ĐÃ VỀ MÀ CHƯA GẮN GHI DANH — sai SỔ, không lộ thông tin.
//     Đo: 4 đơn / 7 khoản / 20.154.000đ trên `satarobo_local`.
//
// Vì hai mức khác nhau nên hàm trả DANH SÁCH lý do, không trả một boolean: cổng QR và
// banner cần biết vì sao để nói đúng câu, và để sau này ai muốn nới một tiêu chí thì nới
// được mà không phải sửa phép suy.
import {
  hocVienLaCuaNguoiKhac,
  type HocVienTheoSdt,
} from "@/lib/orders/hoc-vien-dong-don";

export const MA_NHIEM = {
  /** Đơn mang tên con của gia đình khác. Nặng nhất — lộ thông tin nếu gửi ra ngoài. */
  CON_NHA_KHAC: "CON_NHA_KHAC",
  /** Tiền đã về mà chưa gắn ghi danh nào. Sai sổ, không lộ thông tin. */
  TIEN_CHUA_GAN: "TIEN_CHUA_GAN",
} as const;

export type MaNhiem = (typeof MA_NHIEM)[keyof typeof MA_NHIEM];

/** Đủ để phán xét + gọi được TÊN em trên banner. */
export type ConTrenDon = HocVienTheoSdt & { name: string };

export type DonNhiemInput = {
  sdtDon: string | null | undefined;
  sdtLead: string | null | undefined;
  /** Con ghi ở CẤP ĐƠN (`Order.studentId`). `null` khi đơn không khai. */
  conCapDon: ConTrenDon | null;
  /** Con ghi trên TỪNG DÒNG (`OrderItem.studentId`). */
  conTrenDong: readonly ConTrenDon[];
  /** Số khoản đã về mà `enrollmentId` còn trống. */
  soKhoanChuaGan: number;
  /** Tổng tiền của những khoản đó — để banner nói ra con số. */
  tienChuaGan: number;
};

export type DonNhiem = {
  nhiem: boolean;
  /** Các lý do, theo thứ tự NẶNG TRƯỚC. Rỗng khi sạch. */
  lyDo: MaNhiem[];
  /** TÊN các em không thuộc khách — banner phải gọi tên để người sửa biết sửa dòng nào. */
  conNhaKhac: string[];
  soKhoanChuaGan: number;
  tienChuaGan: number;
};

export const DON_SACH: DonNhiem = {
  nhiem: false,
  lyDo: [],
  conNhaKhac: [],
  soKhoanChuaGan: 0,
  tienChuaGan: 0,
};

/**
 * Đơn này có nhiễm không, và vì sao.
 *
 * ⚠️ Phép so "con có thuộc khách không" KHÔNG viết lại ở đây — nó gọi
 * `hocVienLaCuaNguoiKhac` (cùng hàm mà cổng server `createOrderManualAction` dùng). Hai
 * bản chép tay của cùng một luật là hai cách lệch: cổng chặn một tập, lưới khoá một tập
 * khác, và đơn nằm giữa hai tập thì không ai thấy.
 */
export function donNhiemDuLieu(input: DonNhiemInput): DonNhiem {
  const con: ConTrenDon[] = [
    ...(input.conCapDon ? [input.conCapDon] : []),
    ...input.conTrenDong,
  ];
  const nhaKhac = hocVienLaCuaNguoiKhac(con, input.sdtDon, input.sdtLead);
  // Khử trùng theo id: cùng một em có thể vừa ở cấp đơn vừa ở dòng.
  const tenNhaKhac = [
    ...new Map(nhaKhac.map((h) => [h.id, h.name])).values(),
  ];

  const soKhoanChuaGan = Math.max(0, Math.trunc(input.soKhoanChuaGan || 0));
  const lyDo: MaNhiem[] = [];
  // Thứ tự NẶNG TRƯỚC: banner in lý do đầu tiên làm câu chính.
  if (tenNhaKhac.length > 0) lyDo.push(MA_NHIEM.CON_NHA_KHAC);
  if (soKhoanChuaGan > 0) lyDo.push(MA_NHIEM.TIEN_CHUA_GAN);

  return {
    nhiem: lyDo.length > 0,
    lyDo,
    conNhaKhac: tenNhaKhac,
    soKhoanChuaGan,
    tienChuaGan: Math.max(0, Math.round(input.tienChuaGan || 0)),
  };
}

/**
 * Có được GỬI RA NGOÀI không (mã QR, tin ZNS nhắc nợ).
 *
 * ⚠️ CHỈ tiêu chí CON_NHÀ_KHÁC mới chặn đường gửi ra ngoài. "Tiền chưa gắn ghi danh" là
 * sai sổ NỘI BỘ — chặn QR vì nó là phạt nhầm người: phụ huynh không quét được mã chỉ vì
 * kế toán chưa đối soát xong, trong khi chính họ đang muốn trả tiền.
 *
 * Tách hai câu hỏi ra làm hai hàm (thay vì một `nhiem` dùng chung) chính là để chỗ này
 * không bị siết quá tay.
 */
export function chanGuiRaNgoai(d: DonNhiem): boolean {
  return d.lyDo.includes(MA_NHIEM.CON_NHA_KHAC);
}

/** Hình dạng tối thiểu của client Prisma mà loader cần — để test tiêm được bản giả. */
export type DbDocDonNhiem = {
  order: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: {
        id: true;
        customerPhone: true;
        student: { select: { id: true; name: true; parentPhone: true } };
        lead: { select: { phone: true } };
        items: {
          select: {
            student: { select: { id: true; name: true; parentPhone: true } };
          };
        };
      };
    }) => Promise<
      Array<{
        id: string;
        customerPhone: string | null;
        student: ConTrenDon | null;
        lead: { phone: string | null } | null;
        items: Array<{ student: ConTrenDon | null }>;
      }>
    >;
  };
  payment: {
    findMany: (args: {
      where: { orderId: { in: string[] }; enrollmentId: null; deletedAt: null };
      select: { orderId: true; amount: true };
    }) => Promise<Array<{ orderId: string | null; amount: number }>>;
  };
};

/**
 * Đơn nào đang nhiễm — cho một TẬP đơn, HAI lượt tra, không N+1.
 *
 * ⚠️ TRUYỀN `scopedDb(actor)` cho đường có người dùng; cron thì truyền `db` trần vì nó
 * chạy không có actor. Nói ra ở đây để người gọi chọn có ý thức, đừng chọn theo quán tính:
 * `Order` và `Payment` đều ∈ SCOPED_MODELS, nên `sdb` sẽ tự lọc theo tầm nhìn — đúng cho
 * màn hình, và SAI cho cron (cron mà bị lọc thì nó chỉ khoá được một phần).
 *
 * Tập rỗng ⇒ Map rỗng, KHÔNG tra gì.
 */
export async function donNhiemTheoDon(
  db: DbDocDonNhiem,
  orderIds: readonly string[],
): Promise<Map<string, DonNhiem>> {
  const ids = [...new Set(orderIds.filter((v) => !!v))];
  if (ids.length === 0) return new Map();

  const [don, khoan] = await Promise.all([
    db.order.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        customerPhone: true,
        student: { select: { id: true, name: true, parentPhone: true } },
        lead: { select: { phone: true } },
        items: {
          select: { student: { select: { id: true, name: true, parentPhone: true } } },
        },
      },
    }),
    db.payment.findMany({
      where: { orderId: { in: ids }, enrollmentId: null, deletedAt: null },
      select: { orderId: true, amount: true },
    }),
  ]);

  const treo = new Map<string, { n: number; tien: number }>();
  for (const k of khoan) {
    if (!k.orderId) continue;
    const cur = treo.get(k.orderId) ?? { n: 0, tien: 0 };
    cur.n += 1;
    cur.tien += k.amount;
    treo.set(k.orderId, cur);
  }

  const ra = new Map<string, DonNhiem>();
  for (const o of don) {
    const t = treo.get(o.id) ?? { n: 0, tien: 0 };
    ra.set(
      o.id,
      donNhiemDuLieu({
        sdtDon: o.customerPhone,
        sdtLead: o.lead?.phone ?? null,
        conCapDon: o.student ?? null,
        conTrenDong: o.items
          .map((it) => it.student)
          .filter((s): s is ConTrenDon => !!s),
        soKhoanChuaGan: t.n,
        tienChuaGan: t.tien,
      }),
    );
  }
  return ra;
}
