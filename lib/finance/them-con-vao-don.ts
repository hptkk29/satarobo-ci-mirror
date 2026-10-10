// lib/finance/them-con-vao-don.ts — THÊM MỘT CON VÀO ĐƠN ĐANG HỌC. PHIÊN F3 · US-19.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO ĐƯỜNG NÀY PHẢI TỒN TẠI — đo 22/09/2026
//
// `OrderItem` chỉ sinh ra ĐÚNG MỘT LẦN, lúc tạo đơn (`items: { create }` trong
// `createOrderManualAction`). `git grep "orderItem.create"` ra **0 dòng**. Nghĩa là gia đình
// có con thứ hai vào học giữa khoá thì không có cách nào ngoài **mở một đơn thứ hai** — và
// đơn thứ hai thì:
//   · phá cả cơ chế phiếu gộp một QR cho cả nhà (khoá gom là `Order.id`);
//   · làm công nợ theo con của gia đình nằm ở hai chỗ, không cộng lại được trên một màn;
//   · và ưu đãi anh em thành một con số gõ tay ở đơn nào đó, không ai đối chiếu được.
//
// ─────────────────────────────────────────────────────────────────────────────
// BỐN LUẬT TIỀN CỦA ĐƯỜNG NÀY
//
//  1. **Không đợt nào ĐÃ CÓ TIỀN bị sửa.** `keHoachHapThu` chỉ nhận đợt `daRot === 0`, và
//     phần không hấp thụ được trả ra `chuaHapThuDuoc` chứ không bị nuốt. Sửa `amountDue` của
//     đợt đã thu là đúng con bug đang GHIM ở repo (`[PR-02d]`).
//  2. **Không quyết toán âm.** Đợt giảm số bằng cách **VOID rồi tạo lại**, không `update`
//     tại chỗ — vì `PaymentRequest.matchKey` bền theo ĐỜI của phiếu, và một phiếu đổi số mà
//     giữ nguyên `matchKey` là mã QR cũ vẫn khớp vào số mới.
//  3. **Giá dòng mới đi qua cổng soát giá**, với giá niêm yết tra TỪ DB (`Course.price`).
//     Không bao giờ nhận `giaNiemYet` từ client — lý do đầy đủ ở `lib/orders/hinh-thuc-lop.ts`:
//     cho client cầm cả hai vế của phép so là mọi đơn bán rẻ đều "khớp".
//  4. **Cờ `billing.flexV1Enabled` gác ở tầng action** (`congDuongB`), như mọi đường khác của
//     module. Cờ tắt ⇒ nút không vẽ, action từ chối, màn cũ y nguyên.
//
// ⚠️ **KHÔNG chạm `Order.status`.** Đo trước khi quyết (`lib/payments/don-nhan-tien.ts`):
// chỉ `DRAFT`/`CANCELLED`/`REFUNDED` là không nhận được tiền tự động, còn `CONFIRMED` thì
// VẪN nhận. Nên thêm con vào một đơn đã chốt không tạo bẫy tiền: đợt của bé mới phát QR
// được, tiền về khớp được. Tự ý đẩy đơn `CONFIRMED` về `PENDING_PAYMENT` mới là việc phải
// hỏi — nó đổi ý nghĩa một cột mà báo cáo doanh thu đang đọc.
import "server-only";
// `Prisma` dùng cả như KIỂU (`Prisma.JsonValue`) và như GIÁ TRỊ (`Prisma.JsonNull`),
// nên KHÔNG `import type` — bản chỉ-kiểu làm `Prisma.JsonNull` thành lỗi biên dịch.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { ghiTienChoDon, type KetQuaGhi } from "@/lib/finance/ghi-tien-don";
import { recomputeRequestStatuses } from "@/lib/payments/payment-request";
import { soatGiaDon, LECH_GIA } from "@/lib/orders/price-guard";
import {
  dongThieuGiaiTrinh,
  khoanVuotTran,
  loiThieuGiaiTrinh,
  loiVuotTran,
  tienDon,
  type KhaiGiam,
} from "@/lib/orders/giam-gia-dong";
import {
  keHoachHapThu,
  tinhUuDaiAnhEm,
  type ChinhSachUuDai,
  type DongDeTinhUuDai,
  type HapThuMotDot,
  type UuDaiMotDong,
} from "@/lib/orders/chinh-sach-uu-dai";


/** Con mới sale khai. `courseId` là nguồn GIÁ NIÊM YẾT — không nhận giá từ client. */
export type ConMoi = {
  itemName: string;
  courseId: string;
  quantity: number;
  /** Giá ghi trên dòng. Cổng soát giá so nó với `Course.price` đọc từ DB. */
  unitPrice: number;
  /** Khoản giảm sale gõ tay. Ưu đãi anh em TỰ ĐỘNG được cộng thêm, không thay thế. */
  giam?: readonly KhaiGiam[] | null;
  studentId?: string | null;
  enrollmentId?: string | null;
};

export type ThayDoiMotCon = {
  orderItemId: string;
  ten: string;
  /** `null` = dòng MỚI (chưa có trên đơn). */
  laConMoi: boolean;
  thanhTienCu: number;
  thanhTienMoi: number;
  uuDai: UuDaiMotDong;
  /** Đợt phải huỷ & tạo lại. Rỗng với con mới (chưa có đợt nào). */
  doiDot: HapThuMotDot[];
  /** Đợt bị bỏ qua vì ĐÃ nhận tiền — màn hình phải nói ra. */
  dotDaCoTien: { id: string; installmentNo: number; daRot: number }[];
  /**
   * Phần giảm KHÔNG hấp thụ được vào đợt nào ⇒ bé sẽ ĐÓNG THỪA đúng số này.
   *
   * ⚠️ Không phải lỗi, và cũng không được che: phụ huynh đã đóng nhiều hơn học phí mới là
   * một khoản tiền THẬT của họ, xử lý bằng đường chuyển sang bé khác (F1) hoặc hoàn tiền.
   */
  seDongThua: number;
};

export type XemTruocThemCon = {
  /** Chính sách ĐANG hiệu lực cho cơ sở của đơn — in ra để người bấm biết mình đang theo gì. */
  chinhSach: ChinhSachUuDai;
  con: ThayDoiMotCon[];
  tongDonCu: number;
  tongDonMoi: number;
  /** Câu chặn. `null` = xem trước hợp lệ, bấm được. */
  loi: string | null;
};

type DongTrenDon = {
  id: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  discountAmount: number;
  discounts: Prisma.JsonValue;
  status: string;
};

/** Khoản giảm đã lưu trên dòng, đọc lại thành `KhaiGiam` để tính lại được. */
function khaiLai(discounts: Prisma.JsonValue): KhaiGiam[] {
  if (!Array.isArray(discounts)) return [];
  const ra: KhaiGiam[] = [];
  for (const k of discounts) {
    if (!k || typeof k !== "object") continue;
    const o = k as Record<string, unknown>;
    const kieu = o.kieu === "PHAN_TRAM" ? "PHAN_TRAM" : "SO_TIEN";
    const giaTri = Number(o.giaTri);
    if (!Number.isFinite(giaTri)) continue;
    ra.push({
      kieu,
      giaTri,
      lyDo: typeof o.lyDo === "string" ? o.lyDo : null,
      loai: typeof o.loai === "string" ? (o.loai as KhaiGiam["loai"]) : null,
    });
  }
  return ra;
}

/** Ưu đãi anh em TỰ ĐỘNG trên dòng — nhận ra bằng `loai: "ANH_EM"` + cờ dưới. */
const MARKER_TU_DONG = "[tự tính]";

function laUuDaiTuDong(k: KhaiGiam): boolean {
  return k.loai === "ANH_EM" && (k.lyDo ?? "").includes(MARKER_TU_DONG);
}

/**
 * Khoản giảm của một dòng SAU khi áp lại ưu đãi anh em tự động.
 *
 * ⚠️ **Gỡ khoản tự tính CŨ trước khi thêm khoản mới.** Không gỡ thì mỗi lượt thêm con lại
 * chồng thêm một khoản 10% nữa, và học phí của bé tụt dần mỗi lần gia đình có thêm em — lỗi
 * chỉ lộ ra ở nhà có ba con.
 *
 * ⚠️ Khoản sale GÕ TAY (kể cả `loai: "ANH_EM"` gõ tay) thì GIỮ NGUYÊN. Máy không được xoá
 * quyết định của người: sale có thể đã hứa một mức riêng với phụ huynh, và `discountReason`
 * là thứ duy nhất chứng minh điều đó.
 */
function giamSauKhiApUuDai(cu: readonly KhaiGiam[], uuDai: UuDaiMotDong): KhaiGiam[] {
  const giuLai = cu.filter((k) => !laUuDaiTuDong(k));
  if (uuDai.phanTram <= 0) return giuLai;
  return [
    ...giuLai,
    {
      kieu: "PHAN_TRAM",
      giaTri: uuDai.phanTram,
      loai: "ANH_EM",
      lyDo: `Ưu đãi anh chị em — con thứ ${uuDai.hang} ${MARKER_TU_DONG}`,
    },
  ];
}

async function docDon(client: Pick<typeof db, "order">, orderId: string) {
  return client.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: {
      id: true,
      status: true,
      centerId: true,
      orgUnitId: true,
      shippingFee: true,
      totalAmount: true,
      items: {
        select: {
          id: true,
          itemName: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          discountAmount: true,
          discounts: true,
          status: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

/** Trạng thái đơn KHÔNG thêm con được. Lý do ở chú thích đầu tệp (mục "KHÔNG chạm status"). */
const TRANG_THAI_KHONG_THEM = ["DRAFT", "CANCELLED", "REFUNDED"] as const;

/**
 * Dựng màn XEM TRƯỚC (US-19 AC5: *"xem trước hiện rõ số thay đổi của từng con"*).
 *
 * Chỉ đọc — không ghi một dòng nào. Cùng khuôn `xemTruocDungHoc` của PHIÊN D.
 */
export async function xemTruocThemCon(input: {
  orderId: string;
  conMoi: ConMoi;
  chinhSach: ChinhSachUuDai;
  tranPhanTram: number;
}): Promise<{ ok: true; data: XemTruocThemCon } | { ok: false; error: string }> {
  const don = await docDon(db, input.orderId);
  if (!don) return { ok: false as const, error: "Không tìm thấy đơn hàng" };
  if ((TRANG_THAI_KHONG_THEM as readonly string[]).includes(don.status)) {
    return {
      ok: false as const,
      error: "Đơn đang ở trạng thái không thêm con được (nháp, đã huỷ, hoặc đã hoàn tiền)",
    };
  }

  const kiem = await kiemConMoi(db, input.conMoi, input.tranPhanTram);
  if (!kiem.ok) return { ok: false as const, error: kiem.error };

  const dot = await db.paymentRequest.findMany({
    where: { orderId: don.id, status: { in: ["PENDING", "PARTIAL"] } },
    select: {
      id: true,
      orderItemId: true,
      installmentNo: true,
      amountDue: true,
      dueDate: true,
      allocations: { select: { amount: true } },
    },
  });

  return {
    ok: true as const,
    data: dungXemTruoc({
      don,
      dot: dot.map((d) => ({
        id: d.id,
        orderItemId: d.orderItemId,
        installmentNo: d.installmentNo,
        amountDue: d.amountDue,
        dueDate: d.dueDate,
        daRot: d.allocations.reduce((s, a) => s + a.amount, 0),
      })),
      conMoi: input.conMoi,
      chinhSach: input.chinhSach,
      tranPhanTram: input.tranPhanTram,
    }),
  };
}

type DotChoXemTruoc = {
  id: string;
  orderItemId: string | null;
  installmentNo: number;
  amountDue: number;
  dueDate: Date | null;
  daRot: number;
};

/**
 * Phép dựng xem trước, tách khỏi phần đọc DB.
 *
 * ⚠️ Tách ra KHÔNG phải để "sạch": nó là chỗ duy nhất phép tính này kiểm được mà không cần
 * Postgres, và nó là phép tính quyết định tiền của cả nhà.
 */
function dungXemTruoc(input: {
  don: { items: DongTrenDon[]; shippingFee: number; totalAmount: number };
  dot: readonly DotChoXemTruoc[];
  conMoi: ConMoi;
  chinhSach: ChinhSachUuDai;
  tranPhanTram: number;
}): XemTruocThemCon {
  const DONG_MOI = "__con-moi__";

  // Dòng hiện có + dòng mới, theo đúng thứ tự sẽ có trên đơn sau khi thêm.
  const deTinhUuDai: DongDeTinhUuDai[] = [
    ...input.don.items.map((d, i) => ({
      orderItemId: d.id,
      ten: d.itemName,
      tamTinh: d.totalPrice,
      thuTuVaoDon: i,
      // Bé ĐÃ DỪNG HỌC không còn tính là một con của gia đình cho mục đích ưu đãi.
      conDangHoc: d.status !== "STOPPED",
      coUuDaiDongFull: khaiLai(d.discounts).some((k) => k.loai === "DONG_SOM"),
    })),
    {
      orderItemId: DONG_MOI,
      ten: input.conMoi.itemName,
      tamTinh:
        Math.max(0, Math.round(input.conMoi.unitPrice)) *
        Math.max(0, Math.round(input.conMoi.quantity)),
      thuTuVaoDon: input.don.items.length,
      conDangHoc: true,
      coUuDaiDongFull: (input.conMoi.giam ?? []).some((k) => k.loai === "DONG_SOM"),
    },
  ];

  const uuDai = tinhUuDaiAnhEm({ dong: deTinhUuDai, chinhSach: input.chinhSach });
  const uuDaiTheoDong = new Map(uuDai.map((u) => [u.orderItemId, u]));

  // Khoản giảm MỚI của từng dòng = khoản gõ tay (giữ) + ưu đãi anh em tự tính (thay).
  const giamMoi = new Map<string, KhaiGiam[]>();
  for (const d of input.don.items) {
    giamMoi.set(d.id, giamSauKhiApUuDai(khaiLai(d.discounts), uuDaiTheoDong.get(d.id)!));
  }
  giamMoi.set(
    DONG_MOI,
    giamSauKhiApUuDai(input.conMoi.giam ?? [], uuDaiTheoDong.get(DONG_MOI)!),
  );

  const thuTu = [...input.don.items.map((d) => d.id), DONG_MOI];
  const tienMoi = tienDon(
    thuTu.map((id) => {
      const cu = input.don.items.find((d) => d.id === id);
      return cu
        ? { unitPrice: cu.unitPrice, quantity: cu.quantity, giam: giamMoi.get(id) }
        : {
            unitPrice: input.conMoi.unitPrice,
            quantity: input.conMoi.quantity,
            giam: giamMoi.get(DONG_MOI),
          };
    }),
    { phiVanChuyen: input.don.shippingFee, tranPhanTram: input.tranPhanTram },
  );

  const con: ThayDoiMotCon[] = thuTu.map((id, i) => {
    const cu = input.don.items.find((d) => d.id === id);
    const moi = tienMoi.dong[i]!;
    const thanhTienCu = cu ? cu.totalPrice - cu.discountAmount : 0;
    const canGiam = Math.max(0, thanhTienCu - moi.thanhTien);

    const dotCuaCon = input.dot.filter((x) => x.orderItemId === id);
    const ke = keHoachHapThu({
      dot: dotCuaCon,
      canGiam: cu ? canGiam : 0,
      cach: input.chinhSach.hapThu,
    });

    return {
      orderItemId: id,
      ten: cu?.itemName ?? input.conMoi.itemName,
      laConMoi: !cu,
      thanhTienCu,
      thanhTienMoi: moi.thanhTien,
      uuDai: uuDaiTheoDong.get(id)!,
      doiDot: ke.doi,
      dotDaCoTien: ke.boQuaVeDaCoTien,
      seDongThua: ke.chuaHapThuDuoc,
    };
  });

  return {
    chinhSach: input.chinhSach,
    con,
    tongDonCu: input.don.totalAmount,
    tongDonMoi: tienMoi.tongDon,
    loi: null,
  };
}

/**
 * Cổng của dòng MỚI: hình dạng · giải trình · trần % · và SOÁT GIÁ với `Course.price` từ DB.
 *
 * ⚠️ Giá niêm yết tra TỪ DB, không nhận từ client (luật 3 ở đầu tệp).
 */
async function kiemConMoi(
  client: Pick<typeof db, "course">,
  con: ConMoi,
  tranPhanTram: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!con.itemName.trim()) return { ok: false as const, error: "Thiếu tên con" };
  if (!(Math.round(con.quantity) >= 1)) {
    return { ok: false as const, error: "Số lượng phải từ 1" };
  }
  if (!(Math.round(con.unitPrice) >= 0)) {
    return { ok: false as const, error: "Học phí không được âm" };
  }

  const giam = con.giam ?? [];
  const mot = { unitPrice: con.unitPrice, quantity: con.quantity, giam };
  const thieu = dongThieuGiaiTrinh([mot], tranPhanTram);
  if (thieu.length > 0) return { ok: false as const, error: loiThieuGiaiTrinh(thieu) };

  const vuot = khoanVuotTran([mot], tranPhanTram);
  if (vuot.length > 0) return { ok: false as const, error: loiVuotTran(vuot, tranPhanTram) };

  const khoa = await client.course.findFirst({
    where: { id: con.courseId },
    select: { price: true, name: true },
  });
  if (!khoa) return { ok: false as const, error: "Không tìm thấy khoá học" };
  if (khoa.price == null || khoa.price <= 0) {
    // Cùng câu chặn với `bulk-convert` (`COURSE_NO_PRICE`): khoá chưa khai giá thì mọi phép
    // soát giá thành vô nghĩa, và một dòng bán 0đ trông y như một dòng bán đúng giá.
    return { ok: false as const, error: `Khoá "${khoa.name}" chưa cấu hình giá` };
  }

  const soat = soatGiaDon([
    {
      itemName: con.itemName,
      giaNiemYet: khoa.price,
      giaGhi: con.unitPrice,
      soLuong: con.quantity,
    },
  ]);
  const lech = soat.dongLech.find((d) => d.ket === LECH_GIA.THAP_HON);
  if (lech) {
    return {
      ok: false as const,
      error:
        `Học phí ghi (${lech.giaGhi.toLocaleString("vi-VN")}đ) THẤP HƠN giá niêm yết ` +
        `(${lech.giaNiemYet.toLocaleString("vi-VN")}đ). Bớt cho khách thì khai bằng khoản ` +
        `giảm giá có lý do, đừng hạ giá dòng — hạ giá dòng là không còn dấu vết đã bớt bao nhiêu.`,
    };
  }

  return { ok: true as const };
}

export type KetQuaThemCon = {
  orderItemId: string;
  /** Số con của đơn sau khi thêm. */
  soCon: number;
  /** Số đợt đã huỷ & tạo lại vì ưu đãi đổi. */
  soDotDaDoi: number;
  tongDonMoi: number;
};

/**
 * Thêm con vào đơn. MỘT lượt ghi, dưới khoá của đơn.
 *
 * Thứ tự: MỌI CỔNG → tạo dòng mới → áp lại ưu đãi cho các dòng cũ → VOID + tạo lại đợt đổi
 * số → cập nhật tổng đơn → tính lại trạng thái phiếu → nhật ký.
 *
 * ⚠️ Cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback — `return` KHÔNG cuộn ngược).
 */
export async function themConVaoDon(input: {
  orderId: string;
  conMoi: ConMoi;
  chinhSach: ChinhSachUuDai;
  tranPhanTram: number;
  lyDo: string;
  actor: AuditActor;
}): Promise<KetQuaGhi<KetQuaThemCon>> {
  // Cổng NGOÀI transaction: hai câu tra chỉ-đọc, không cần khoá đơn giữ trong lúc chạy.
  if (!input.lyDo.trim()) {
    return { ok: false as const, error: "Phải ghi lý do thêm con vào đơn" };
  }
  const kiem = await kiemConMoi(db, input.conMoi, input.tranPhanTram);
  if (!kiem.ok) return { ok: false as const, error: kiem.error };

  return ghiTienChoDon(input.orderId, async (tx) => {
    const don = await docDon(tx as unknown as Pick<typeof db, "order">, input.orderId);
    if (!don) return { ok: false as const, error: "Không tìm thấy đơn hàng" };
    if ((TRANG_THAI_KHONG_THEM as readonly string[]).includes(don.status)) {
      return {
        ok: false as const,
        error: "Đơn đang ở trạng thái không thêm con được (nháp, đã huỷ, hoặc đã hoàn tiền)",
      };
    }

    const dotTho = await tx.paymentRequest.findMany({
      where: { orderId: don.id, status: { in: ["PENDING", "PARTIAL"] } },
      select: {
        id: true,
        orderItemId: true,
        installmentNo: true,
        amountDue: true,
        dueDate: true,
        allocations: { select: { amount: true } },
      },
    });
    const dot: DotChoXemTruoc[] = dotTho.map((d) => ({
      id: d.id,
      orderItemId: d.orderItemId,
      installmentNo: d.installmentNo,
      amountDue: d.amountDue,
      dueDate: d.dueDate,
      daRot: d.allocations.reduce((s, a) => s + a.amount, 0),
    }));

    // Phép tính CHẠY LẠI trong khoá, trên số vừa đọc — không tin số của màn xem trước.
    const ke = dungXemTruoc({
      don,
      dot,
      conMoi: input.conMoi,
      chinhSach: input.chinhSach,
      tranPhanTram: input.tranPhanTram,
    });

    // ── HẾT CỔNG. Từ đây là phép ghi. ────────────────────────────────────────

    const conMoiKe = ke.con.find((c) => c.laConMoi)!;
    const giamConMoi = giamSauKhiApUuDai(input.conMoi.giam ?? [], conMoiKe.uuDai);
    const tienConMoi = tienDon(
      [
        {
          unitPrice: input.conMoi.unitPrice,
          quantity: input.conMoi.quantity,
          giam: giamConMoi,
        },
      ],
      { tranPhanTram: input.tranPhanTram },
    ).dong[0]!;

    const dongMoi = await tx.orderItem.create({
      data: {
        orderId: don.id,
        type: "COURSE_ENROLLMENT",
        itemName: input.conMoi.itemName.trim(),
        quantity: Math.round(input.conMoi.quantity),
        unitPrice: Math.round(input.conMoi.unitPrice),
        totalPrice: tienConMoi.tamTinh,
        discountAmount: tienConMoi.giam,
        discountPercent: tienConMoi.phanTram,
        discountReason:
          tienConMoi.khoan
            .filter((k) => k.giam > 0 && k.lyDo)
            .map((k) => k.lyDo)
            .join(" · ") || null,
        discounts:
          tienConMoi.khoan.length > 0
            ? (tienConMoi.khoan as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        studentId: input.conMoi.studentId || null,
        enrollmentId: input.conMoi.enrollmentId || null,
        // ⚠️ `OrderItem` KHÔNG có `centerId`: cách ly cơ sở của một dòng suy từ ĐƠN
        // (`Order.centerId`), và `SCOPED_MODELS` lọc `OrderItem` qua quan hệ đó. Thêm cột
        // thứ hai ở đây là mở một đường lệch giữa dòng và đơn của chính nó.
      },
      select: { id: true },
    });

    // Áp lại ưu đãi cho các dòng CŨ + sửa đợt của chúng.
    let soDotDaDoi = 0;
    // Giảm giá MỚI của từng dòng cũ — `Order.discountAmount` phải là ĐÚNG tổng các dòng.
    // Hai đường nhập cho cùng một con tiền là định nghĩa của sổ lệch (chú thích ở
    // `createOrderManualAction`), nên không được suy tổng từ đâu khác.
    const giamMoiTheoDongCu = new Map<string, number>();
    for (const c of ke.con) {
      if (c.laConMoi) continue;
      const cu = don.items.find((d) => d.id === c.orderItemId)!;
      const giam = giamSauKhiApUuDai(khaiLai(cu.discounts), c.uuDai);
      const t = tienDon([{ unitPrice: cu.unitPrice, quantity: cu.quantity, giam }], {
        tranPhanTram: input.tranPhanTram,
      }).dong[0]!;

      giamMoiTheoDongCu.set(cu.id, t.giam);

      if (t.giam !== cu.discountAmount) {
        await tx.orderItem.update({
          where: { id: cu.id },
          data: {
            discountAmount: t.giam,
            discountPercent: t.phanTram,
            discountReason:
              t.khoan
                .filter((k) => k.giam > 0 && k.lyDo)
                .map((k) => k.lyDo)
                .join(" · ") || null,
            discounts:
              t.khoan.length > 0
                ? (t.khoan as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
          },
        });
      }

      // Đợt đổi số: VOID rồi TẠO LẠI (luật 2 ở đầu tệp — `matchKey` bền theo đời phiếu).
      for (const d of c.doiDot) {
        await tx.paymentRequest.update({ where: { id: d.id }, data: { status: "VOID" } });
        await tx.qrSession.updateMany({
          where: { paymentRequestId: d.id, status: "ACTIVE" },
          data: { status: "EXPIRED" },
        });
        if (d.soMoi > 0) {
          const max = await tx.paymentRequest.aggregate({
            where: { orderItemId: cu.id },
            _max: { installmentNo: true },
          });
          await tx.paymentRequest.create({
            data: {
              orderId: don.id,
              orderItemId: cu.id,
              centerId: don.centerId,
              installmentNo: (max._max.installmentNo ?? 0) + 1,
              amountDue: d.soMoi,
              dueDate: dot.find((x) => x.id === d.id)?.dueDate ?? null,
              status: "PENDING",
            },
          });
        }
        soDotDaDoi++;
      }
    }

    await tx.order.update({
      where: { id: don.id },
      data: {
        subtotal: don.items.reduce((s, d) => s + d.totalPrice, 0) + tienConMoi.tamTinh,
        discountAmount:
          don.items.reduce((s, d) => s + (giamMoiTheoDongCu.get(d.id) ?? d.discountAmount), 0) +
          tienConMoi.giam,
        totalAmount: ke.tongDonMoi,
      },
    });

    await recomputeRequestStatuses(tx, don.id);

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: don.id,
      action: "THEM_CON_VAO_DON",
      changedFields: ["items", "discountAmount", "totalAmount"],
      oldValues: {
        tongDon: ke.tongDonCu,
        con: don.items.map((d) => ({
          id: d.id,
          ten: d.itemName,
          thanhTien: d.totalPrice - d.discountAmount,
        })),
      },
      newValues: {
        tongDon: ke.tongDonMoi,
        conMoi: { id: dongMoi.id, ten: input.conMoi.itemName.trim(), thanhTien: tienConMoi.thanhTien },
        chinhSach: input.chinhSach,
        con: ke.con.map((c) => ({
          id: c.orderItemId,
          ten: c.ten,
          hang: c.uuDai.hang,
          phanTram: c.uuDai.phanTram,
          thanhTienCu: c.thanhTienCu,
          thanhTienMoi: c.thanhTienMoi,
          doiDot: c.doiDot,
          seDongThua: c.seDongThua,
        })),
      },
      reason: input.lyDo.trim(),
      orgUnitId: don.orgUnitId,
    });

    return {
      ok: true as const,
      orderItemId: dongMoi.id,
      soCon: don.items.length + 1,
      soDotDaDoi,
      tongDonMoi: ke.tongDonMoi,
    };
  });
}

