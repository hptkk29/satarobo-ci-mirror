import "server-only";
// lib/finance/dung-hoc-con.ts — DỪNG HỌC MỘT CON: xem trước, rồi ghi.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHIÊN D · Chủ dự án chốt 21/09/2026
//
// Ca gốc: đơn hai con, đợt 1 đóng cho cả hai, đợt 2 chỉ còn một con học. Trước hôm nay
// hệ thống không có cách nào diễn đạt việc đó — nó vẫn đòi đủ học phí của bé đã nghỉ, và
// phần phụ huynh đã đóng dư nằm lại trong sổ mà không ai còn lý do đi tìm.
//
// Phép SỐ HỌC nằm ở `lib/finance/dung-hoc.ts` (thuần, test không cần Postgres). Tệp này
// là phần chạm DB: đọc để xem trước, và ghi trong đúng một transaction.
//
// ─────────────────────────────────────────────────────────────────────────────
// THỨ TỰ GHI, VÀ VÌ SAO NÓ LÀ THỨ TỰ ĐÓ
//
//   1. VOID mọi đợt của bé (kể cả đợt đã nhận một phần) + cho mã QR chết theo
//   2. đóng / huỷ phiếu gộp đang mở có dòng của bé
//   3. đóng dấu quyết toán lên `OrderItem` (STOPPED + 6 cột snapshot)
//   4. chuyển phần dư sang bé khác  (bút toán −/+, `chuyenTienGiuaConTrongTx`)
//   5. đặt yêu cầu hoàn cho phần còn lại của dư  (PENDING, KHÔNG chi tiền)
//   6. kết thúc ghi danh — phần KHÔNG-TIỀN, `ketThucMotGhiDanh`
//   7. `recomputeRequestStatuses` + nhật ký
//
// ⚠️ TẤT CẢ CỔNG TỪ CHỐI ĐỨNG TRƯỚC BƯỚC 1. Trong Prisma, `return` từ callback
// `$transaction` **KHÔNG rollback** — chỉ `throw` mới rollback (CLAUDE.md mục 7). Một cổng
// `return { ok: false }` đặt sau bước 1 nghĩa là: đợt của bé đã VOID, phiếu gộp đã đóng, và
// người dùng nhận thông báo "không làm được". Repo này đã trả giá đúng một lần cho hình
// dạng ấy (`goGanTheoCon`, ca `[GDC-c2]`).
import type { Prisma, RefundTrigger } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit, type AuditActor } from "@/lib/audit/audit-log";
import { noTheoCon } from "@/lib/finance/debt";
import {
  buoiDaDung,
  kiemPhanDu,
  tinhQuyetToan,
  type BuoiCuaLop,
  type LyDoDungHoc,
  type PhanDu,
} from "@/lib/finance/dung-hoc";
import {
  chuyenTienGiuaConTrongTx,
  ghiTienChoDon,
  type KetQuaGhi,
} from "@/lib/finance/ghi-tien-don";
import type { NoTheoConKetQua } from "@/lib/finance/no-theo-con";
import { doiTrangThaiPhieuTrongTx, phieuGopCuaConTrongTx } from "@/lib/finance/phieu-gop";
import { taoYeuCauHoanTuDungHoc } from "@/lib/finance/refund";
import { recomputeRequestStatuses } from "@/lib/payments/payment-request";
import { soiUuDaiAnhEm, type KhoanGiamDaLuu } from "@/lib/orders/uu-dai-anh-em";
import { syncConversationMembership } from "@/lib/chat/sync-membership";
import { ketThucMotGhiDanh } from "@/lib/students/ket-thuc-ghi-danh";

type Tx = Prisma.TransactionClient;

/**
 * `OrderItemStopReason` → `RefundTrigger`.
 *
 * Hai enum có sẵn, và chúng khớp nhau gần hết — ánh xạ ở MỘT chỗ để bảng
 * `/admin/hoan-tien` lọc theo `trigger` vẫn nói đúng chuyện.
 */
const TRIGGER_THEO_LY_DO: Record<LyDoDungHoc, RefundTrigger> = {
  PH_CHU_DONG: "WITHDRAW",
  TRUNG_TAM_HUY: "CLASS_CANCELLED",
  KHAC: "MANUAL",
};

export type BuoiXemTruoc = {
  id: string;
  date: Date;
  status: string;
  /** Buổi này có nằm trong tập "đã dùng" theo lựa chọn hiện tại không. */
  daDung: boolean;
};

export type XemTruocDungHoc = {
  orderItemId: string;
  ten: string;
  khoa: string | null;
  hocPhiThuc: number;
  /** Đã có ghi danh chưa — không có thì bỏ qua phần rời lớp, chỉ quyết toán tiền. */
  coGhiDanh: boolean;

  /** Toàn bộ buổi của lớp, để sale nhìn bằng mắt rồi xác nhận. */
  buoi: BuoiXemTruoc[];
  /** Buổi cuối HỆ THỐNG gợi ý — buổi gần nhất đã qua. `null` = bé chưa học buổi nào. */
  goiYBuoiCuoiId: string | null;
  /** Buổi cuối đang được chọn (bằng gợi ý nếu người gọi chưa chọn gì). */
  buoiCuoiId: string | null;
  soBuoiDaDung: number;
  soBuoiCamKet: number | null;

  /** `null` khi chưa tính được — `loiQuyetToan` nói vì sao. */
  donGiaBuoi: number | null;
  giaTriDaDung: number | null;
  loiQuyetToan: string | null;
  canhBao: string[];

  /** TRỤC A (`CONFIRMED`) của riêng bé này. */
  daThu: number;
  /** Tiền đã về mà kế toán chưa xác nhận — KHÔNG được chuyển, hiện riêng. */
  choXacNhan: number;
  /** `daThu − giaTriDaDung`. Dương = dư phải phân hết; âm = bé còn nợ. */
  chenh: number | null;

  /** Đợt sẽ bị huỷ khi xác nhận. `daRot > 0` là đợt đã nhận một phần. */
  dotSeHuy: { id: string; installmentNo: number; amountDue: number; daRot: number }[];
  /** Phiếu gộp đang mở có dòng của bé này. */
  phieuGop: { billId: string; daNhan: number; hanhDong: "HUY" | "DONG" } | null;
  /** Các bé CÒN LẠI của đơn, kèm trần nhận. */
  conConLai: { orderItemId: string; ten: string; conNo: number }[];

  /**
   * ĐƠN CÓ ƯU ĐÃI ANH CHỊ EM — chỉ để NHẮC, `null` khi không có [PHIÊN E, 21/09/2026].
   *
   * ⚠️ **KHÔNG đổi một đồng nào.** Chủ dự án chốt: bé còn lại GIỮ nguyên ưu đãi đã chốt
   * trên đơn; thu hồi (nếu BGĐ muốn) là thao tác TAY có quyền QLCS, việc sau. Trường này
   * cố ý tách khỏi `canhBao` ở trên — `canhBao` đến từ phép quyết toán TIỀN
   * (`tinhQuyetToan`), còn đây là một lời nhắc chính sách. Trộn hai thứ vào một mảng là
   * ngày nào đó có người đọc lời nhắc này như một cảnh báo về số tiền.
   */
  canhBaoUuDaiAnhEm: string | null;
  /** Dòng nào mang dấu vết ưu đãi anh em — để người vận hành tự kiểm. */
  dauVetUuDaiAnhEm: { orderItemId: string; ten: string; theoNhan: boolean }[];
};

/**
 * Dựng màn XEM TRƯỚC. Chỉ đọc — không ghi một dòng nào.
 *
 * ⚠️ `now` là THAM SỐ (luật 19): gợi ý "buổi gần nhất đã qua" phụ thuộc đồng hồ, và một ca
 * test dùng ngày tuyệt đối trong fixture cộng một hàm rơi về `new Date()` là ca hẹn giờ nổ.
 */
export async function xemTruocDungHoc(input: {
  orderId: string;
  orderItemId: string;
  lyDo: LyDoDungHoc;
  /** Buổi cuối sale chọn. Bỏ trống ⇒ dùng gợi ý của hệ thống. */
  buoiCuoiId?: string | null;
  now?: Date;
}): Promise<{ ok: true; data: XemTruocDungHoc } | { ok: false; error: string }> {
  const dong = await db.orderItem.findFirst({
    where: { id: input.orderItemId, orderId: input.orderId, order: { deletedAt: null } },
    select: {
      id: true,
      itemName: true,
      totalPrice: true,
      discountAmount: true,
      status: true,
      enrollmentId: true,
      enrollment: {
        select: {
          classId: true,
          course: { select: { name: true, totalSessions: true } },
        },
      },
    },
  });
  if (!dong) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

  // PHIÊN E — soi CẢ ĐƠN, không chỉ dòng đang dừng: ưu đãi anh em theo bản chất nằm trên
  // bé THỨ HAI, nên soi mỗi dòng đang dừng là bỏ sót đúng ca thường gặp nhất.
  const moiDong = await db.orderItem.findMany({
    where: { orderId: input.orderId },
    select: { id: true, itemName: true, discounts: true, discountReason: true },
    orderBy: { createdAt: "asc" },
  });
  const uuDai = soiUuDaiAnhEm(
    moiDong.map((d) => ({
      orderItemId: d.id,
      ten: d.itemName,
      khoanGiam: Array.isArray(d.discounts) ? (d.discounts as KhoanGiamDaLuu[]) : null,
      lyDoGop: d.discountReason,
    })),
  );
  if (dong.status === "STOPPED") {
    return { ok: false as const, error: "Bé này đã dừng học rồi" };
  }

  const buoiCuaLop: BuoiCuaLop[] = dong.enrollment?.classId
    ? (
        await db.classSession.findMany({
          where: { classId: dong.enrollment.classId },
          select: { id: true, date: true, status: true },
          orderBy: { date: "asc" },
        })
      ).map((b) => ({ id: b.id, date: b.date, status: b.status }))
    : [];

  const moc = input.now ?? new Date();
  // Gợi ý = buổi gần nhất ĐÃ QUA và không bị huỷ. Cố ý KHÔNG hỏi `status = COMPLETED`:
  // buổi quá khứ phần lớn còn `SCHEDULED` (đo prod 07/09: 209/287), nên hỏi vậy là gợi ý
  // một buổi từ đời nào.
  const daQua = buoiCuaLop.filter((b) => b.date.getTime() <= moc.getTime() && b.status !== "CANCELLED");
  const goiY = daQua.length > 0 ? daQua[daQua.length - 1]!.id : null;

  const buoiCuoiId = input.buoiCuoiId === undefined ? goiY : input.buoiCuoiId;
  const buoiCuoi = buoiCuoiId ? buoiCuaLop.find((b) => b.id === buoiCuoiId) : undefined;
  if (buoiCuoiId && !buoiCuoi) {
    return { ok: false as const, error: "Buổi được chọn không thuộc lớp của bé này" };
  }

  const daDung = buoiCuoi ? buoiDaDung(buoiCuaLop, buoiCuoi.date) : [];
  const tapDaDung = new Set(daDung.map((b) => b.id));
  const hocPhiThuc = Math.max(0, dong.totalPrice - dong.discountAmount);
  const soBuoiCamKet = dong.enrollment?.course?.totalSessions ?? null;

  const qt = tinhQuyetToan({
    hocPhiThuc,
    soBuoiCamKet,
    soBuoiDaDung: daDung.length,
    lyDo: input.lyDo,
    tenKhoa: dong.enrollment?.course?.name ?? null,
  });

  const so = await noTheoCon(input.orderId);
  const conNay = so.con.find((c) => c.orderItemId === dong.id);
  const daThu = conNay?.daThu ?? 0;
  const giaTriDaDung = "khongTinhDuoc" in qt ? null : qt.giaTriDaDung;

  const dotSeHuy = (conNay?.dotDangMo ?? []).map((d) => ({
    id: d.id,
    installmentNo: d.installmentNo,
    amountDue: d.amountDue,
    daRot: d.daRot,
  }));

  const phieu = await docPhieuGopChoXemTruoc(input.orderId, dong.id);

  return {
    ok: true as const,
    data: {
      orderItemId: dong.id,
      ten: dong.itemName,
      khoa: dong.enrollment?.course?.name ?? null,
      hocPhiThuc,
      coGhiDanh: dong.enrollmentId != null,
      buoi: buoiCuaLop.map((b) => ({ ...b, daDung: tapDaDung.has(b.id) })),
      goiYBuoiCuoiId: goiY,
      buoiCuoiId: buoiCuoiId ?? null,
      soBuoiDaDung: daDung.length,
      soBuoiCamKet,
      donGiaBuoi: "khongTinhDuoc" in qt ? null : qt.donGiaBuoi,
      giaTriDaDung,
      loiQuyetToan: "khongTinhDuoc" in qt ? qt.loi : null,
      canhBao: "khongTinhDuoc" in qt ? [] : qt.canhBao,
      daThu,
      choXacNhan: conNay?.choXacNhan ?? 0,
      chenh: giaTriDaDung == null ? null : daThu - giaTriDaDung,
      dotSeHuy,
      phieuGop: phieu,
      conConLai: so.con
        .filter((c) => c.orderItemId !== dong.id)
        .map((c) => ({ orderItemId: c.orderItemId, ten: c.ten, conNo: c.conNo })),
      canhBaoUuDaiAnhEm: uuDai.canhBao,
      dauVetUuDaiAnhEm: uuDai.dauVet,
    },
  };
}

/** Bản chỉ-đọc của `phieuGopCuaConTrongTx`, kèm sẵn quyết định huỷ hay đóng. */
async function docPhieuGopChoXemTruoc(
  orderId: string,
  orderItemId: string,
): Promise<{ billId: string; daNhan: number; hanhDong: "HUY" | "DONG" } | null> {
  const p = await phieuGopCuaConTrongTx(db as unknown as Tx, orderId, orderItemId);
  if (!p || !p.coDongCuaCon) return null;
  return { billId: p.billId, daNhan: p.daNhan, hanhDong: p.daNhan > 0 ? "DONG" : "HUY" };
}

export type KetQuaDungHoc = {
  soBuoiDaDung: number;
  giaTriDaDung: number;
  chenh: number;
  soDotDaHuy: number;
  daChuyen: number;
  daDatHoan: number;
  refundRequestId: string | null;
};

/**
 * Dừng học một con — ghi thật.
 *
 * Bảy cổng, TẤT CẢ đứng TRƯỚC phép ghi đầu tiên:
 *   1. dòng hàng thuộc CHÍNH đơn này, đơn chưa xoá mềm;
 *   2. bé chưa dừng học (`status !== STOPPED`) — chống bấm hai lần;
 *   3. buổi cuối (nếu có) phải là buổi CỦA LỚP bé đang học;
 *   4. ghi chú BẮT BUỘC khi sale sửa khác gợi ý, hoặc khi lý do là `KHAC`;
 *   5. quyết toán tính được (khoá đã khai số buổi cam kết);
 *   6. dư > 0 ⇒ phép phân dư hợp lệ và Σ ĐÚNG BẰNG dư;
 *   7. dư ≤ 0 ⇒ không được gửi kèm phần phân nào.
 */
export async function dungHocMotCon(input: {
  orderId: string;
  orderItemId: string;
  lyDo: LyDoDungHoc;
  buoiCuoiId: string | null;
  ghiChu: string | null;
  /** Rỗng khi không có dư. Σ phải ĐÚNG BẰNG dư — `kiemPhanDu`. */
  phanDu: readonly PhanDu[];
  actor: AuditActor;
  now?: Date;
}): Promise<KetQuaGhi<KetQuaDungHoc>> {
  // Đường "Dừng học" của màn đơn: bé nghỉ thật ⇒ kết thúc ghi danh. Hành vi y như trước
  // khi thân hàm được tách (F4).
  return ghiTienChoDon(input.orderId, (tx, so) =>
    dungHocTrongTx(tx, so, { ...input, ketThucGhiDanh: true }),
  );
}

/**
 * Thân của `dungHocMotCon`, chạy TRONG transaction của người gọi. [Tách ở F4 · 22/09/2026]
 *
 * ⚠️ Tách ra vì F4 ("đổi khoá / đổi lớp") phải làm ba việc trong MỘT transaction: dừng dòng
 * cũ · tạo dòng mới · chuyển dư sang dòng mới. `ghiTienChoDon` không lồng được (khoá advisory
 * + transaction của Prisma), nên hoặc tách thân ra, hoặc chép lại toàn bộ phép dừng học sang
 * chỗ thứ hai. Chép lại là hai bản luật tiền song song — thứ repo này đã trả giá vài lần.
 *
 * ⚠️ `so` là ảnh chụp công nợ theo con, đọc DƯỚI KHOÁ. Người gọi phải truyền ảnh chụp ĐÚNG
 * THỜI ĐIỂM: F4 tạo dòng mới TRƯỚC rồi mới dừng dòng cũ, nên nó phải đọc lại `docSoTheoCon`
 * sau khi tạo — cổng phân dư (`kiemPhanDu`) lấy trần nhận từ `so.con`, và dòng chưa có trong
 * ảnh chụp thì bị từ chối với câu "không thuộc đơn này".
 *
 * Hành vi KHÔNG đổi so với bản cũ — 22 ca `[DHC-*]` là bằng chứng của phép tách này.
 */
export async function dungHocTrongTx(
  tx: Tx,
  so: NoTheoConKetQua,
  input: {
    orderId: string;
    orderItemId: string;
    lyDo: LyDoDungHoc;
    buoiCuoiId: string | null;
    ghiChu: string | null;
    phanDu: readonly PhanDu[];
    actor: AuditActor;
    now?: Date;
    /**
     * Có kết thúc ghi danh của bé không (bước 6).
     *
     * ⚠️ BẮT BUỘC, KHÔNG mặc định (luật 7) — để `tsc` liệt kê đủ chỗ gọi. Mặc định ở đây
     * nguy hiểm theo chiều ĐÓNG: F4 ("đổi khoá") đã CHUYỂN ghi danh sang lớp mới trước khi
     * gọi hàm này, nên kết thúc nó nữa là đẩy một ghi danh đang `TRANSFERRED` sang
     * `WITHDREW` — bé trông như đã nghỉ học trong khi em vừa chuyển lớp. Đo được: ca
     * `[DKD-03]` đỏ với `WITHDREW` ở bản đầu.
     */
    ketThucGhiDanh: boolean;
  },
): Promise<KetQuaGhi<KetQuaDungHoc>> {
  {
    // ── CỔNG 1 ──────────────────────────────────────────────────────────────
    const dong = await tx.orderItem.findFirst({
      where: { id: input.orderItemId, orderId: input.orderId, order: { deletedAt: null } },
      select: {
        id: true,
        itemName: true,
        totalPrice: true,
        discountAmount: true,
        status: true,
        enrollmentId: true,
        order: { select: { centerId: true, code: true } },
        enrollment: {
          select: {
            id: true,
            status: true,
            classId: true,
            course: { select: { name: true, totalSessions: true } },
          },
        },
      },
    });
    if (!dong) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

    // ── CỔNG 2 ──────────────────────────────────────────────────────────────
    if (dong.status === "STOPPED") {
      return { ok: false as const, error: "Bé này đã dừng học rồi — tải lại trang" };
    }

    const conNay = so.con.find((c) => c.orderItemId === dong.id);
    if (!conNay) return { ok: false as const, error: "Dòng hàng không thuộc đơn này" };

    // ── CỔNG 3 — buổi cuối phải là buổi CỦA LỚP BÉ ĐANG HỌC ─────────────────
    //
    // ⚠️ Nhận `sessionId`, KHÔNG nhận một chuỗi ngày. Nhận ngày là mở cửa cho lệch múi
    // giờ (Vercel chạy UTC, máy dev +07 — memory `tz-utc-vs-vn-landmine`) đúng vào con số
    // quyết định bé phải trả bao nhiêu tiền.
    const buoiCuaLop: BuoiCuaLop[] = dong.enrollment?.classId
      ? (
          await tx.classSession.findMany({
            where: { classId: dong.enrollment.classId },
            select: { id: true, date: true, status: true },
            orderBy: { date: "asc" },
          })
        ).map((b) => ({ id: b.id, date: b.date, status: b.status }))
      : [];

    const buoiCuoi = input.buoiCuoiId
      ? buoiCuaLop.find((b) => b.id === input.buoiCuoiId)
      : undefined;
    if (input.buoiCuoiId && !buoiCuoi) {
      return { ok: false as const, error: "Buổi được chọn không thuộc lớp của bé này" };
    }

    // ── CỔNG 4 — sửa gợi ý thì phải nói vì sao ───────────────────────────────
    const moc = input.now ?? new Date();
    const daQua = buoiCuaLop.filter(
      (b) => b.date.getTime() <= moc.getTime() && b.status !== "CANCELLED",
    );
    const goiY = daQua.length > 0 ? daQua[daQua.length - 1]!.id : null;
    const ghiChu = (input.ghiChu ?? "").trim();
    if ((input.buoiCuoiId ?? null) !== goiY && !ghiChu) {
      return {
        ok: false as const,
        error:
          "Bạn chọn buổi cuối khác buổi hệ thống gợi ý — phải ghi chú lý do " +
          "(số buổi này quyết định bé phải trả bao nhiêu).",
      };
    }
    if (input.lyDo === "KHAC" && !ghiChu) {
      return { ok: false as const, error: 'Lý do "Khác" thì phải ghi rõ' };
    }

    // ── CỔNG 5 — quyết toán ─────────────────────────────────────────────────
    const daDung = buoiCuoi ? buoiDaDung(buoiCuaLop, buoiCuoi.date) : [];
    const hocPhiThuc = Math.max(0, dong.totalPrice - dong.discountAmount);
    const soBuoiCamKet = dong.enrollment?.course?.totalSessions ?? null;
    const qt = tinhQuyetToan({
      hocPhiThuc,
      soBuoiCamKet,
      soBuoiDaDung: daDung.length,
      lyDo: input.lyDo,
      tenKhoa: dong.enrollment?.course?.name ?? null,
    });
    if ("khongTinhDuoc" in qt) return { ok: false as const, error: qt.loi };

    const chenh = conNay.daThu - qt.giaTriDaDung;

    // ── CỔNG 6 · 7 — phân dư ────────────────────────────────────────────────
    let phan: PhanDu[] = [];
    if (chenh > 0) {
      const kiem = kiemPhanDu({
        du: chenh,
        phan: input.phanDu,
        tranNhan: so.con
          .filter((c) => c.orderItemId !== dong.id)
          .map((c) => ({ orderItemId: c.orderItemId, ten: c.ten, conNo: c.conNo })),
      });
      if (!kiem.ok) return { ok: false as const, error: kiem.loi };
      phan = kiem.phan;
    } else if (input.phanDu.length > 0) {
      return {
        ok: false as const,
        error:
          chenh === 0
            ? "Bé này đã đóng vừa đúng phần đã học — không có gì để phân"
            : `Bé này còn NỢ ${(-chenh).toLocaleString("vi-VN")}đ, không có khoản dư nào để phân`,
      };
    }

    // ── HẾT CỔNG. Từ đây trở xuống là phép ghi. ─────────────────────────────

    const centerId = dong.order?.centerId ?? null;

    // 1 · VOID mọi đợt đang mở của bé, KỂ CẢ đợt đã nhận một phần.
    const soDotDaHuy = await huyDotKhiDungHoc(tx, {
      orderId: input.orderId,
      orderItemId: dong.id,
      dot: conNay.dotDangMo.map((d) => ({ id: d.id })),
    });

    // 2 · phiếu gộp đang mở có dòng của bé.
    const phieu = await phieuGopCuaConTrongTx(tx, input.orderId, dong.id);
    if (phieu?.coDongCuaCon) {
      // Chưa nhận đồng nào → HUỶ (sale phát lại mã mới cho phần còn lại); đã nhận một phần
      // → ĐÓNG (ngừng thu tiếp mà giữ dấu vết). Đúng luật đã chốt cho phiếu gộp; ở đây chỉ
      // chọn nhánh, không phát minh nhánh thứ ba.
      await doiTrangThaiPhieuTrongTx(
        tx,
        {
          orderId: input.orderId,
          billId: phieu.billId,
          lyDo: `Dừng học: ${dong.itemName}`,
          actor: input.actor,
        },
        phieu.daNhan > 0 ? "CLOSED" : "VOID",
      );
    }

    // 3 · đóng dấu quyết toán.
    await tx.orderItem.update({
      where: { id: dong.id },
      data: {
        status: "STOPPED",
        stoppedAt: moc,
        stoppedById: input.actor.id || null,
        lastSessionDate: buoiCuoi?.date ?? null,
        usedSessions: daDung.length,
        committedSessions: soBuoiCamKet,
        stopUnitPrice: qt.donGiaBuoi,
        usedValue: qt.giaTriDaDung,
        stopReason: input.lyDo,
        stopNote: ghiChu || null,
      },
    });

    // 4 · chuyển phần dư sang bé khác.
    const phanChuyen = phan.filter(
      (p): p is Extract<PhanDu, { kieu: "CHUYEN" }> => p.kieu === "CHUYEN",
    );
    let daChuyen = 0;
    if (phanChuyen.length > 0) {
      const kq = await chuyenTienGiuaConTrongTx(tx, {
        orderId: input.orderId,
        tuOrderItemId: dong.id,
        phan: phanChuyen.map((p) => ({ orderItemId: p.orderItemId, soTien: p.soTien })),
        centerId,
        lyDo: `Dừng học ${dong.itemName}`,
        maNghiepVu: dong.id,
      });
      daChuyen = kq.tong;
    }

    // 5 · đặt yêu cầu hoàn cho phần còn lại — PENDING, KHÔNG chi tiền.
    const daDatHoan = phan
      .filter((p) => p.kieu === "HOAN")
      .reduce((s, p) => s + p.soTien, 0);
    let refundRequestId: string | null = null;
    if (daDatHoan > 0) {
      const rr = await taoYeuCauHoanTuDungHoc({
        tx,
        orderItemId: dong.id,
        enrollmentId: dong.enrollmentId,
        centerId,
        trigger: TRIGGER_THEO_LY_DO[input.lyDo],
        soTien: daDatHoan,
        reason:
          `Dừng học ${dong.itemName} (đơn ${dong.order?.code ?? input.orderId}) — ` +
          `đã dùng ${daDung.length} buổi` +
          (ghiChu ? `. ${ghiChu}` : ""),
        paidConfirmed: conNay.daThu,
        soBuoiCamKet: soBuoiCamKet ?? 0,
        soBuoiDaDung: daDung.length,
        donGiaBuoi: qt.donGiaBuoi,
        requestedById: input.actor.id || null,
        actorName: input.actor.name,
      });
      refundRequestId = rr.id;
    }

    // 6 · phần KHÔNG-TIỀN của việc rời lớp. Dòng đơn chưa gắn ghi danh thì bỏ qua — chốt
    // của chủ dự án 21/09 ("chỉ quyết toán tiền").
    //
    // ⚠️ `ketThucGhiDanh === false` khi người gọi ĐÃ định đoạt ghi danh theo cách khác —
    // F4 chuyển nó sang lớp mới. Kết thúc thêm lần nữa là ghi đè `TRANSFERRED` bằng
    // `WITHDREW`, tức sổ học vụ nói bé đã nghỉ trong khi em vừa chuyển lớp.
    if (input.ketThucGhiDanh && dong.enrollment) {
      await ketThucMotGhiDanh({
        tx,
        ghiDanh: {
          id: dong.enrollment.id,
          status: dong.enrollment.status,
          classId: dong.enrollment.classId,
        },
        actorId: input.actor.id || null,
        actorName: input.actor.name,
        reason: `Dừng học trên đơn ${dong.order?.code ?? input.orderId}${ghiChu ? ` — ${ghiChu}` : ""}`,
        orgUnitId: centerId,
        // NGÀY HIỆU LỰC = ngày buổi cuối, không phải lúc bấm nút. Bé chưa học buổi nào thì
        // không có ngày nào để khai — để trống còn hơn khai một ngày bịa.
        ...(buoiCuoi?.date ? { endedAt: buoiCuoi.date } : {}),
      });
      await syncConversationMembership(tx, dong.enrollment.classId);
    }

    // 7 · tính lại trạng thái đợt của CẢ đơn (đợt vừa VOID rơi khỏi phép tính "đã đủ tiền").
    await recomputeRequestStatuses(tx, input.orderId);

    await writeAudit({
      tx,
      actor: input.actor,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "CON_DUNG_HOC",
      oldValues: {
        orderItemId: dong.id,
        ten: dong.itemName,
        hocPhiThuc,
        daThu: conNay.daThu,
        choXacNhan: conNay.choXacNhan,
      },
      newValues: {
        lyDo: input.lyDo,
        buoiCuoiId: input.buoiCuoiId,
        lastSessionDate: buoiCuoi?.date?.toISOString() ?? null,
        goiYBuoiCuoiId: goiY,
        suaKhacGoiY: (input.buoiCuoiId ?? null) !== goiY,
        soBuoiDaDung: daDung.length,
        soBuoiCamKet,
        donGiaBuoi: qt.donGiaBuoi,
        giaTriDaDung: qt.giaTriDaDung,
        chenh,
        soDotDaHuy,
        phieuGop: phieu?.coDongCuaCon
          ? { billId: phieu.billId, hanhDong: phieu.daNhan > 0 ? "CLOSED" : "VOID" }
          : null,
        daChuyen,
        phanChuyen: phanChuyen.map((p) => ({ orderItemId: p.orderItemId, soTien: p.soTien })),
        daDatHoan,
        refundRequestId,
        ketThucGhiDanh: dong.enrollment?.id ?? null,
      },
      reason: ghiChu || `Dừng học ${dong.itemName}`,
      orgUnitId: centerId,
    });

    return {
      ok: true as const,
      soBuoiDaDung: daDung.length,
      giaTriDaDung: qt.giaTriDaDung,
      chenh,
      soDotDaHuy,
      daChuyen,
      daDatHoan,
      refundRequestId,
    };
  }
}

/**
 * VOID mọi đợt đang mở của một bé vừa dừng học — **KỂ CẢ đợt đã nhận một phần**.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ NGOẠI LỆ CÓ TÊN RIÊNG, CHỈ GỌI ĐƯỢC TỪ ĐƯỜNG DỪNG HỌC
 *
 * `kiemHuyDot` (`lib/finance/no-theo-con.ts`) từ chối huỷ một đợt đã có tiền, và **luật đó
 * giữ nguyên**: sale bấm "Huỷ đợt" trên một đợt PARTIAL vẫn bị chặn như trước (ca `[HD-*]`
 * ghim). Hàm này không nới luật ấy — nó là một luật KHÁC cho một tình huống KHÁC, và chủ
 * dự án chốt riêng 21/09/2026.
 *
 * Vì sao ở đây phải huỷ cả đợt có tiền: bé đã dừng thì không còn phần nào để đòi. Để đợt
 * sống nghĩa là mã QR của nó vẫn in ra số tiền còn thiếu của một đứa trẻ đã nghỉ — đúng
 * lỗi "đòi thừa" mà cả module này sinh ra để chặn.
 *
 * ⚠️ KHÔNG xoá, KHÔNG đảo `PaymentAllocation` nào. Tiền đã nhận vẫn nằm nguyên ở Ledger-A
 * (`Payment`) và đã được cộng vào `daThu` của bé trước khi quyết toán — nó là một phần của
 * phép tính, không phải thứ để gỡ. Xoá phân bổ ở đây là làm tụt `daThu` SAU khi đã dùng nó
 * để tính chênh, tức sổ nói hai chuyện trong cùng một transaction.
 *
 * ⚠️ `deriveStatus` trả `VOID` vĩnh viễn khi `current === "VOID"`
 * (`lib/payments/allocation.ts:101`), nên `recomputeRequestStatuses` chạy sau sẽ KHÔNG lật
 * ngược các đợt này về `PARTIAL`. Đó là điều kiện để phép huỷ ở đây đứng vững — nếu ai đó
 * sửa `deriveStatus`, hàm này hỏng theo.
 */
async function huyDotKhiDungHoc(
  tx: Tx,
  input: { orderId: string; orderItemId: string; dot: readonly { id: string }[] },
): Promise<number> {
  if (input.dot.length === 0) return 0;
  const ids = input.dot.map((d) => d.id);

  const upd = await tx.paymentRequest.updateMany({
    // `orderId` + `orderItemId` trong `where` chứ không chỉ `id`: danh sách đợt đến từ
    // `docSoTheoCon` của chính đơn này, nhưng khoá lại ở tầng ghi thì rẻ, và nó chặn một
    // lượt sửa tương lai vô tình truyền id của đơn khác vào.
    where: {
      id: { in: ids },
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      status: { in: ["PENDING", "PARTIAL"] },
    },
    data: { status: "VOID" },
  });

  // Mã QR của đợt vừa huỷ phải chết theo — affordance phải nói thật (luật 12). Tiền về
  // muộn qua mã cũ sẽ rơi về `UNMATCHED` vì `locDonNhanTien`/đối khớp không nhận đợt VOID.
  await tx.qrSession.updateMany({
    where: { paymentRequestId: { in: ids }, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });

  return upd.count;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRẠNG THÁI DỪNG HỌC ĐỂ HIỂN THỊ TRÊN MÀN ĐƠN
// ─────────────────────────────────────────────────────────────────────────────

export type TrangThaiDungHocCuaCon = {
  daDung: boolean;
  stoppedAt: Date | null;
  lastSessionDate: Date | null;
  usedSessions: number | null;
  committedSessions: number | null;
  stopUnitPrice: number | null;
  usedValue: number | null;
  stopReason: LyDoDungHoc | null;
  stopNote: string | null;
  /** Σ yêu cầu hoàn đang CHỜ kế toán của dòng này. */
  choHoan: number;
  /** Kế toán đã TỪ CHỐI một yêu cầu hoàn của dòng này. */
  coHoanBiTuChoi: boolean;
};

/**
 * Đọc trạng thái dừng học + tình hình hoàn tiền của từng dòng trong đơn.
 *
 * ⚠️ Vì sao phải có `choHoan` RIÊNG thay vì để màn hình tự suy từ "đã thu > phải thu":
 * chủ dự án chốt 21/09 — *"Con STOPPED hiện rõ 'Chờ hoàn: X đ' (không hiện như 'đã thu
 * thừa' không lý do)"*. Hai câu đó là hai trạng thái nghiệp vụ khác hẳn nhau:
 *   · **chờ hoàn**       — đã có người quyết, kế toán đang cầm việc;
 *   · **dư chưa xử lý**  — kế toán TỪ CHỐI, hoặc chưa ai phân ⇒ sale phải chọn lại.
 * Gộp chúng thành một dòng "đóng thừa" là để một khoản tiền thật nằm im mà không ai biết
 * nó đang chờ ai.
 */
export async function docTrangThaiDungHoc(
  orderId: string,
): Promise<Record<string, TrangThaiDungHocCuaCon>> {
  const dong = await db.orderItem.findMany({
    where: { orderId },
    select: {
      id: true,
      status: true,
      stoppedAt: true,
      lastSessionDate: true,
      usedSessions: true,
      committedSessions: true,
      stopUnitPrice: true,
      usedValue: true,
      stopReason: true,
      stopNote: true,
      refundRequests: { select: { status: true, proposedAmount: true, approvedAmount: true } },
    },
  });

  const ra: Record<string, TrangThaiDungHocCuaCon> = {};
  for (const d of dong) {
    ra[d.id] = {
      daDung: d.status === "STOPPED",
      stoppedAt: d.stoppedAt,
      lastSessionDate: d.lastSessionDate,
      usedSessions: d.usedSessions,
      committedSessions: d.committedSessions,
      stopUnitPrice: d.stopUnitPrice,
      usedValue: d.usedValue,
      stopReason: (d.stopReason as LyDoDungHoc | null) ?? null,
      stopNote: d.stopNote,
      choHoan: d.refundRequests
        .filter((r) => r.status === "PENDING")
        .reduce((s, r) => s + r.proposedAmount, 0),
      coHoanBiTuChoi: d.refundRequests.some((r) => r.status === "REJECTED"),
    };
  }
  return ra;
}
