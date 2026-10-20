// lib/finance/doi-khoa-db.ts — ĐỔI KHOÁ / ĐỔI LỚP: phần chạm DB. PHIÊN F4 · US-20.
//
// ─────────────────────────────────────────────────────────────────────────────
// MỘT THAO TÁC, MỘT TRANSACTION — và đó là toàn bộ cái khó
//
// AC1 đòi ba việc trong MỘT lượt: dừng dòng cũ (quyết toán theo buổi) · tạo dòng mới · chuyển
// dư sang dòng mới. Cộng thêm hai việc mà phép ghi tiền BUỘC phải có mới đúng:
//
//   · **chuyển ghi danh** sang lớp mới — vì `confirmPayment` TỪ CHỐI khoản chưa gắn ghi danh
//     (*"Khoản chưa gắn ghi danh, không thể sinh phiếu thu"*, `lib/finance/payment.ts:631`).
//     Tiền chuyển sang một dòng không có ghi danh là tiền không bao giờ xuất được phiếu thu.
//   · **đợt thu cho phần còn thiếu** của khoá mới (AC3).
//
// Cả năm chạy dưới MỘT khoá đơn (`ghiTienChoDon`). Để đạt được điều đó, hai thân hàm đã được
// TÁCH ra khỏi hai chỗ cũ, thay vì chép lại:
//   · `dungHocTrongTx`  ← `dungHocMotCon`      (`lib/finance/dung-hoc-con.ts`, PHIÊN D)
//   · `chuyenLopTrongTx` ← `transferEnrollment` (`app/(admin)/admin/enrollments/_actions.ts`)
//
// ─────────────────────────────────────────────────────────────────────────────
// THỨ TỰ CÓ CHỦ ĐÍCH, VÀ NÓ KHÔNG HOÁN VỊ ĐƯỢC
//
//   1. chuyển ghi danh  → sinh `enrollmentId` MỚI
//   2. tạo dòng hàng mới, gắn ghi danh mới
//   3. **đọc LẠI** `docSoTheoCon` — ảnh chụp đầu transaction chưa có dòng mới, và cổng phân
//      dư (`kiemPhanDu`) lấy trần nhận TỪ ẢNH CHỤP. Bỏ bước này thì phép chuyển dư bị từ
//      chối với câu "dòng không thuộc đơn này", trên chính cái dòng vừa tạo.
//   4. dừng dòng cũ, phân toàn bộ dư sang dòng mới (+ phần vượt đi hoàn/ví)
//   5. tạo đợt cho phần còn thiếu của khoá mới
//
// ⚠️ Bước 1 phải TRƯỚC bước 4: `dungHocTrongTx` kết thúc ghi danh cũ (`ketThucMotGhiDanh`),
// và một ghi danh đã kết thúc thì `chuyenLopTrongTx` từ chối chuyển.
import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { docSoTheoCon } from "@/lib/finance/debt";
import { ghiTienChoDon, taoDotChoConTrongTx, type KetQuaGhi } from "@/lib/finance/ghi-tien-don";
import { dungHocTrongTx } from "@/lib/finance/dung-hoc-con";
import { buoiDaDung, tinhQuyetToan, type BuoiCuaLop } from "@/lib/finance/dung-hoc";
import { keHoachDoiKhoa, kiemDoiKhoa, type KeHoachDoiKhoa } from "@/lib/finance/doi-khoa";
import { chuyenLopTrongTx, ChuyenLopError } from "@/lib/enrollments/chuyen-lop";
import { soatGiaDon, LECH_GIA } from "@/lib/orders/price-guard";
import { tienDon, type KhaiGiam } from "@/lib/orders/giam-gia-dong";


export type DoiKhoaInput = {
  orderId: string;
  /** Dòng hàng của bé đang học — sẽ bị dừng & quyết toán. */
  orderItemId: string;
  /** Lớp ĐÍCH. Khoá học suy từ lớp, không nhận từ người gọi. */
  targetClassId: string;
  /** Buổi cuối của khoá CŨ. `null` = dùng gợi ý (buổi gần nhất đã qua). */
  buoiCuoiId: string | null;
  /** Giá ghi cho dòng mới. Cổng soát giá so với `Course.price` của khoá ĐÍCH. */
  unitPriceMoi: number;
  /** Khoản giảm sale gõ cho dòng mới. */
  giamMoi?: readonly KhaiGiam[] | null;
  /** Hạn của đợt thu cho phần còn thiếu. `null` = đợt không hạn. */
  hanDotConThieu?: Date | null;
  lyDo: string;
  ghiChu?: string | null;
  tranPhanTram: number;
  actor: AuditActor;
  now?: Date;
};

export type XemTruocDoiKhoa = {
  tenCu: string;
  tenKhoaCu: string | null;
  tenLopMoi: string;
  tenKhoaMoi: string;
  soBuoiDaDung: number;
  giaTriDaDung: number;
  hocPhiMoi: number;
  ke: KeHoachDoiKhoa;
  /** Câu chặn. `null` = xem trước hợp lệ. */
  loi: string | null;
};

/** Phần đọc dùng chung cho xem trước và lượt ghi — một chỗ, để hai bên không lệch nhau. */
async function docBoiCanh(
  client: Pick<typeof db, "orderItem" | "class" | "classSession">,
  input: Pick<DoiKhoaInput, "orderId" | "orderItemId" | "targetClassId">,
) {
  const dong = await client.orderItem.findFirst({
    where: { id: input.orderItemId, orderId: input.orderId, order: { deletedAt: null } },
    select: {
      id: true,
      itemName: true,
      totalPrice: true,
      discountAmount: true,
      status: true,
      enrollmentId: true,
      order: { select: { id: true, centerId: true, orgUnitId: true, status: true } },
      enrollment: {
        select: {
          id: true,
          classId: true,
          course: { select: { name: true, totalSessions: true } },
        },
      },
    },
  });
  if (!dong) return null;

  const lopMoi = await client.class.findFirst({
    where: { id: input.targetClassId, deletedAt: null },
    select: {
      id: true,
      name: true,
      courseId: true,
      centerId: true,
      course: { select: { name: true, price: true, totalSessions: true } },
    },
  });

  const buoiCuaLop: BuoiCuaLop[] = dong.enrollment?.classId
    ? (
        await client.classSession.findMany({
          where: { classId: dong.enrollment.classId },
          select: { id: true, date: true, status: true },
          orderBy: { date: "asc" },
        })
      ).map((b) => ({ id: b.id, date: b.date, status: b.status }))
    : [];

  return { dong, lopMoi, buoiCuaLop };
}

/** Trạng thái đơn KHÔNG đổi khoá được — cùng danh sách với đường thêm con (F3). */
const TRANG_THAI_KHONG_DOI = ["DRAFT", "CANCELLED", "REFUNDED"] as const;

/**
 * Dựng màn XEM TRƯỚC. Chỉ đọc — không ghi một dòng nào.
 *
 * ⚠️ `now` là THAM SỐ (luật 19): gợi ý "buổi gần nhất đã qua" phụ thuộc đồng hồ, và nó quyết
 * định bé phải trả bao nhiêu.
 */
export async function xemTruocDoiKhoa(
  input: Pick<
    DoiKhoaInput,
    "orderId" | "orderItemId" | "targetClassId" | "buoiCuoiId" | "unitPriceMoi" | "giamMoi" | "tranPhanTram" | "now"
  > & { lyDo?: string },
): Promise<{ ok: true; data: XemTruocDoiKhoa } | { ok: false; error: string }> {
  const bc = await docBoiCanh(db, input);
  if (!bc) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };
  if (!bc.lopMoi) return { ok: false as const, error: "Không tìm thấy lớp đích" };
  if ((TRANG_THAI_KHONG_DOI as readonly string[]).includes(bc.dong.order?.status ?? "")) {
    return { ok: false as const, error: "Đơn đang ở trạng thái không đổi khoá được" };
  }

  const so = await docSoTheoCon(db, input.orderId);
  const conNay = so.con.find((c) => c.orderItemId === bc.dong.id);
  if (!conNay) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

  const tinh = tinhSoDoiKhoa({ bc, input, daThuCu: conNay.daThu });
  if (!tinh.ok) return { ok: false as const, error: tinh.error };

  return {
    ok: true as const,
    data: {
      tenCu: bc.dong.itemName,
      tenKhoaCu: bc.dong.enrollment?.course?.name ?? null,
      tenLopMoi: bc.lopMoi.name,
      tenKhoaMoi: bc.lopMoi.course?.name ?? "",
      soBuoiDaDung: tinh.soBuoiDaDung,
      giaTriDaDung: tinh.giaTriDaDung,
      hocPhiMoi: tinh.hocPhiMoi,
      ke: tinh.ke,
      loi:
        kiemDoiKhoa({
          dongCuDaDung: bc.dong.status === "STOPPED",
          trungLopHienTai: bc.dong.enrollment?.classId === input.targetClassId,
          coGhiDanhCu: !!bc.dong.enrollmentId,
          hocPhiMoi: tinh.hocPhiMoi,
          // Xem trước không đòi lý do — người bấm gõ nó ở bước xác nhận.
          lyDo: input.lyDo ?? "xem-truoc",
        }) ?? null,
    },
  };
}

type BoiCanh = NonNullable<Awaited<ReturnType<typeof docBoiCanh>>>;

/**
 * Phép tính chung của xem trước và lượt ghi.
 *
 * ⚠️ Một hàm, hai người gọi — CỐ Ý. Hai phép tính song song là màn hình hứa một số rồi sổ ghi
 * một số khác, và ca `[TCD-17]` của F3 đã phải sinh ra để canh đúng chuyện đó ở đường thêm con.
 */
function tinhSoDoiKhoa(args: {
  bc: BoiCanh;
  input: Pick<DoiKhoaInput, "buoiCuoiId" | "unitPriceMoi" | "giamMoi" | "tranPhanTram" | "now">;
  daThuCu: number;
}):
  | { ok: true; soBuoiDaDung: number; giaTriDaDung: number; hocPhiMoi: number; ke: KeHoachDoiKhoa; buoiCuoiIdDung: string | null }
  | { ok: false; error: string } {
  const { bc, input } = args;
  const moc = input.now ?? new Date();

  const buoiCuoi = input.buoiCuoiId
    ? bc.buoiCuaLop.find((b) => b.id === input.buoiCuoiId)
    : (() => {
        const daQua = bc.buoiCuaLop.filter(
          (b) => b.date.getTime() <= moc.getTime() && b.status !== "CANCELLED",
        );
        return daQua.length > 0 ? daQua[daQua.length - 1] : undefined;
      })();
  if (input.buoiCuoiId && !buoiCuoi) {
    return { ok: false as const, error: "Buổi được chọn không thuộc lớp của bé này" };
  }

  const daDung = buoiCuoi ? buoiDaDung(bc.buoiCuaLop, buoiCuoi.date) : [];
  const qt = tinhQuyetToan({
    hocPhiThuc: Math.max(0, bc.dong.totalPrice - bc.dong.discountAmount),
    soBuoiCamKet: bc.dong.enrollment?.course?.totalSessions ?? null,
    soBuoiDaDung: daDung.length,
    // ⚠️ `PH_CHU_DONG`, KHÔNG `TRUNG_TAM_HUY`. Đổi khoá là bé vẫn học tiếp ở chỗ mình, nên
    // phần ĐÃ HỌC vẫn phải trả. `TRUNG_TAM_HUY` cho phí 0 và nó thắng mọi phép tính khác —
    // dùng nhầm ở đây là tặng không toàn bộ phần đã học cho mọi lượt đổi khoá.
    lyDo: "PH_CHU_DONG",
    tenKhoa: bc.dong.enrollment?.course?.name ?? null,
  });
  if ("khongTinhDuoc" in qt) return { ok: false as const, error: qt.loi };

  const tienMoi = tienDon(
    [{ unitPrice: input.unitPriceMoi, quantity: 1, giam: input.giamMoi ?? [] }],
    { tranPhanTram: input.tranPhanTram },
  ).dong[0]!;

  return {
    ok: true as const,
    soBuoiDaDung: daDung.length,
    giaTriDaDung: qt.giaTriDaDung,
    hocPhiMoi: tienMoi.thanhTien,
    ke: keHoachDoiKhoa({
      daThuCu: args.daThuCu,
      giaTriDaDung: qt.giaTriDaDung,
      moi: {
        hocPhiThuc: tienMoi.thanhTien,
        soBuoiCamKet: bc.lopMoi?.course?.totalSessions ?? null,
      },
    }),
    buoiCuoiIdDung: buoiCuoi?.id ?? null,
  };
}

export type KetQuaDoiKhoa = {
  newOrderItemId: string;
  newEnrollmentId: string;
  soBuoiDaDung: number;
  giaTriDaDung: number;
  daChuyen: number;
  /** Phần dư vượt học phí mới — đi đường HOÀN TIỀN, xem `phanVuot` ở `doi-khoa.ts`. */
  phanVuot: number;
  /** `null` khi khoá mới không còn thiếu đồng nào. */
  dotConThieuId: string | null;
};

/**
 * Đổi khoá / đổi lớp cho một con — MỘT lượt ghi, dưới khoá của đơn.
 *
 * ⚠️ Mọi cổng đứng TRƯỚC phép ghi đầu tiên (luật rollback — `return` KHÔNG cuộn ngược).
 */
export async function doiKhoaChoCon(input: DoiKhoaInput): Promise<KetQuaGhi<KetQuaDoiKhoa>> {
  // Cổng NGOÀI transaction: hai câu tra chỉ-đọc, không cần giữ khoá đơn trong lúc chạy.
  const bcNgoai = await docBoiCanh(db, input);
  if (!bcNgoai) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };
  if (!bcNgoai.lopMoi) return { ok: false as const, error: "Không tìm thấy lớp đích" };
  if ((TRANG_THAI_KHONG_DOI as readonly string[]).includes(bcNgoai.dong.order?.status ?? "")) {
    return { ok: false as const, error: "Đơn đang ở trạng thái không đổi khoá được" };
  }

  // ⚠️ "Trùng lớp" nói TRƯỚC cổng soát giá. Người chọn nhầm chính lớp bé đang học thường
  // để nguyên ô học phí, nên soát giá bắn trước sẽ trả về một câu về GIÁ — và họ đi sửa
  // nhầm chỗ. Cùng lý lẽ thứ tự cổng với `kiemChuyenTien` (F1).
  if (bcNgoai.dong.enrollment?.classId === input.targetClassId) {
    return { ok: false as const, error: "Lớp đích trùng lớp bé đang học" };
  }

  const giaNiemYet = bcNgoai.lopMoi.course?.price ?? null;
  if (giaNiemYet == null || giaNiemYet <= 0) {
    return {
      ok: false as const,
      error: `Khoá "${bcNgoai.lopMoi.course?.name ?? "đích"}" chưa cấu hình giá`,
    };
  }
  const soat = soatGiaDon([
    {
      itemName: bcNgoai.lopMoi.course?.name ?? "",
      giaNiemYet,
      giaGhi: input.unitPriceMoi,
      soLuong: 1,
    },
  ]);
  if (soat.dongLech.some((d) => d.ket === LECH_GIA.THAP_HON)) {
    return {
      ok: false as const,
      error:
        `Học phí ghi THẤP HƠN giá niêm yết của khoá mới (${giaNiemYet.toLocaleString("vi-VN")}đ). ` +
        `Bớt cho khách thì khai bằng khoản giảm giá có lý do, đừng hạ giá dòng.`,
    };
  }

  return ghiTienChoDon(input.orderId, async (tx, so) => {
    const bc = await docBoiCanh(tx as unknown as Pick<typeof db, "orderItem" | "class" | "classSession">, input);
    if (!bc || !bc.lopMoi) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

    const conNay = so.con.find((c) => c.orderItemId === bc.dong.id);
    if (!conNay) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

    const loi = kiemDoiKhoa({
      dongCuDaDung: bc.dong.status === "STOPPED",
      trungLopHienTai: bc.dong.enrollment?.classId === input.targetClassId,
      coGhiDanhCu: !!bc.dong.enrollmentId,
      hocPhiMoi: input.unitPriceMoi,
      lyDo: input.lyDo,
    });
    if (loi) return { ok: false as const, error: loi };

    const tinh = tinhSoDoiKhoa({ bc, input, daThuCu: conNay.daThu });
    if (!tinh.ok) return { ok: false as const, error: tinh.error };

    // ── HẾT CỔNG. Từ đây là phép ghi. ────────────────────────────────────────

    // 1 · chuyển ghi danh sang lớp mới (sĩ số lớp đích kiểm lại TRONG transaction).
    // ⚠️ `chuyenLopTrongTx` NÉM khi từ chối, không trả `{ ok: false }` — và đó là hình dạng
    // ĐÚNG ở đây: nó ghi nhiều bước, nên một lời từ chối giữa chừng phải CUỘN NGƯỢC. `return`
    // trong callback `$transaction` không cuộn ngược (luật rollback). Lỗi bay ra khỏi
    // transaction rồi được dịch ở `.catch` cuối hàm.
    const chuyen = await chuyenLopTrongTx(tx, {
      oldEnrollmentId: bc.dong.enrollmentId!,
      targetClassId: input.targetClassId,
      reason: input.lyDo.trim(),
      actor: input.actor,
    });

    // 2 · dòng hàng MỚI, gắn ghi danh vừa tạo.
    const tienMoi = tienDon(
      [{ unitPrice: input.unitPriceMoi, quantity: 1, giam: input.giamMoi ?? [] }],
      { tranPhanTram: input.tranPhanTram },
    ).dong[0]!;
    const dongMoi = await tx.orderItem.create({
      data: {
        orderId: input.orderId,
        type: "COURSE_ENROLLMENT",
        itemName: bc.dong.itemName,
        quantity: 1,
        unitPrice: Math.round(input.unitPriceMoi),
        totalPrice: tienMoi.tamTinh,
        discountAmount: tienMoi.giam,
        discountPercent: tienMoi.phanTram,
        discountReason:
          tienMoi.khoan
            .filter((k) => k.giam > 0 && k.lyDo)
            .map((k) => k.lyDo)
            .join(" · ") || null,
        discounts:
          tienMoi.khoan.length > 0
            ? (tienMoi.khoan as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        enrollmentId: chuyen.newEnrollmentId,
      },
      select: { id: true },
    });

    // 3 · ĐỌC LẠI công nợ theo con — ảnh chụp đầu transaction chưa có dòng mới, mà cổng phân
    //     dư lấy trần nhận TỪ ẢNH CHỤP.
    const soMoi = await docSoTheoCon(tx, input.orderId);

    // 4 · dừng dòng cũ + phân dư.
    //
    // ⚠️ Σ phần phân phải ĐÚNG BẰNG dư (`kiemPhanDu`), nên phần vượt học phí mới phải có chỗ
    // đi: `HOAN` — tức một `RefundRequest` chờ kế toán. AC3 gọi chỗ ấy là "ví"; repo này có
    // `CreditBalance` và nó CÓ màn hình (`/bien-dong-so-du`), nhưng đường hoàn tiền mới là
    // đường có người xử lý và có trạng thái. Xem chú thích `phanVuot` ở `doi-khoa.ts`.
    const phanDu =
      tinh.ke.du > 0
        ? [
            ...(tinh.ke.chuyenSangMoi > 0
              ? [{ kieu: "CHUYEN" as const, orderItemId: dongMoi.id, soTien: tinh.ke.chuyenSangMoi }]
              : []),
            ...(tinh.ke.phanVuot > 0 ? [{ kieu: "HOAN" as const, soTien: tinh.ke.phanVuot }] : []),
          ]
        : [];

    const dung = await dungHocTrongTx(tx, soMoi, {
      orderId: input.orderId,
      orderItemId: bc.dong.id,
      lyDo: "PH_CHU_DONG",
      buoiCuoiId: input.buoiCuoiId,
      // Đổi khoá gần như luôn chọn buổi cuối khác gợi ý, mà cổng 4 của `dungHocTrongTx` đòi
      // ghi chú khi lệch gợi ý. Lý do đổi khoá LÀ lời giải thích ấy — chở nó xuống, đừng bắt
      // người bấm gõ hai lần cùng một câu.
      ghiChu: (input.ghiChu ?? "").trim() || `Đổi sang ${chuyen.targetClassName}: ${input.lyDo.trim()}`,
      phanDu,
      actor: input.actor,
      now: input.now,
      // ⚠️ KHÔNG kết thúc ghi danh: bước 1 vừa CHUYỂN nó sang lớp mới. Kết thúc nữa là
      // đẩy một ghi danh `TRANSFERRED` sang `WITHDREW` — bé trông như đã nghỉ học.
      ketThucGhiDanh: false,
    });
    if (!dung.ok) {
      // ⚠️ `throw`, KHÔNG `return`: tới đây đã ghi ghi danh mới + dòng mới. `return` để lại
      // chúng trong DB kèm một câu từ chối gửi cho người dùng (luật rollback).
      throw new DoiKhoaError(dung.error);
    }

    // 5 · phần còn thiếu của khoá mới ⇒ một đợt thu của dòng mới (AC3).
    let dotConThieuId: string | null = null;
    if (tinh.ke.conThieuMoi > 0) {
      // ⚠️ Đọc LẠI ảnh chụp lần nữa: bước 4 vừa VOID mọi đợt của dòng cũ và rót tiền sang
      // dòng mới, nên còn-nợ của dòng mới đã đổi. Cổng `kiemTaoDot` lấy trần TỪ ảnh chụp —
      // đưa ảnh cũ vào là nó đo trên số trước khi chuyển tiền.
      const soSauDung = await docSoTheoCon(tx, input.orderId);
      const dot = await taoDotChoConTrongTx(tx, soSauDung, {
        orderId: input.orderId,
        orderItemId: dongMoi.id,
        soTien: tinh.ke.conThieuMoi,
        dueDate: input.hanDotConThieu ?? null,
        centerId: bc.dong.order?.centerId ?? null,
        actor: input.actor,
      });
      if (!dot.ok) throw new DoiKhoaError(dot.error);
      dotConThieuId = dot.paymentRequestId;
    }

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "DOI_KHOA_CHO_CON",
      changedFields: ["items", "enrollment"],
      oldValues: {
        orderItemId: bc.dong.id,
        ten: bc.dong.itemName,
        khoaCu: bc.dong.enrollment?.course?.name ?? null,
        enrollmentId: bc.dong.enrollmentId,
        daThu: conNay.daThu,
      },
      newValues: {
        orderItemId: dongMoi.id,
        lopMoi: chuyen.targetClassName,
        khoaMoi: bc.lopMoi.course?.name ?? null,
        enrollmentId: chuyen.newEnrollmentId,
        soBuoiDaDung: tinh.soBuoiDaDung,
        giaTriDaDung: tinh.giaTriDaDung,
        hocPhiMoi: tinh.hocPhiMoi,
        ke: tinh.ke,
        dotConThieuId,
      },
      reason: input.lyDo.trim(),
      orgUnitId: bc.dong.order?.orgUnitId ?? null,
    });

    return {
      ok: true as const,
      newOrderItemId: dongMoi.id,
      newEnrollmentId: chuyen.newEnrollmentId,
      soBuoiDaDung: tinh.soBuoiDaDung,
      giaTriDaDung: tinh.giaTriDaDung,
      daChuyen: dung.daChuyen,
      phanVuot: tinh.ke.phanVuot,
      dotConThieuId,
    };
  }).catch((err) => {
    if (err instanceof DoiKhoaError || err instanceof ChuyenLopError) {
      return { ok: false as const, error: err.message };
    }
    throw err;
  });
}

/** Lỗi nghiệp vụ ném ra từ TRONG transaction để cuộn ngược mọi phép ghi đã làm. */
export class DoiKhoaError extends Error {}
