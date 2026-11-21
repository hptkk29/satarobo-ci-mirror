import "server-only";
// lib/payments/pos/sai-ma-doc.ts — VIỆC 3: ĐỌC ứng viên cho "Tôi nhập sai mã trên máy" + hàng chờ của kế toán. CHỈ ĐỌC.
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §5.3.2. MỘT hàm đọc, HAI nơi gọi — cùng một câu hỏi, không hai bản luật:
//   · `timUngVienSaiMa`  — sale bấm nút: đọc bằng `scopedDb(actor)` (hiển thị) + `db` cho các câu tra để CHẶN;
//   · `docUngVienSaiMa`  — chính hàm lõi, `guiSaiMa` (sai-ma-ghi.ts) gọi LẠI DƯỚI KHOÁ bằng `tx` (bước gửi đòi giao dịch được
//     chọn NẰM TRONG kết quả này; xem trước ≠ quyết, máy chủ tính lại).
//
// ⚠️ HAI KHÁCH, KHÔNG PHẢI MỘT. `doc` là khách ĐỌC ỨNG VIÊN — truyền `scopedDb(actor)` cho hiển thị. `chan` là khách cho các câu
// tra để CHẶN (dòng hủy trỏ vào, dòng cùng RRN, mã đang có dòng mang, phiếu thẻ cạnh tranh, mã gần của phiếu khác, dữ liệu
// thiếu): KHÔNG BAO GIỜ scope — tra qua `scopedDb` thì đúng thứ cần chặn (dòng/phiếu của cơ sở khác) bị lọc mất, trả rỗng, và cổng
// đọc rỗng thành "không có gì cản" (CLAUDE.md, mục `PaymentMethod`). Dưới khoá cả hai là `tx`.
//
// ⚠️ Không `Promise.all` trên cùng một `tx`, và KHÔNG câu nào trong hàm lõi đi qua `db` trần khi `chan` là `tx`: mỗi lượt gửi giữ
// MỘT kết nối của pool trong lúc chờ khoá đơn — xin thêm kết nối thứ hai là cạn pool khi nhiều lượt cùng lúc.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { passesScope, type scopedDb } from "@/lib/db-scope";
import type { Actor } from "@/lib/auth/actor";
import { TIEN_TO_GO_GAN } from "@/lib/finance/ghi-tien-don";
import { docPhieuGopDangMo } from "@/lib/finance/phieu-gop";
import { gioVN } from "@/lib/format/thoi-gian-vn";
import { PROVIDER_THE_POS } from "./kieu";
import { laLoaiThanhToan } from "./phan-loai-pos";
import { phieuPosHetHan, TRANG_THAI_MO } from "./phieu-pos-luat";
import { tachMaPos, tachTokenGhiChu } from "./tach-ma-pos";
import { chonAgentChoPhieu, chonCheDoNguonPos, sucKhoeAgent } from "./agent/suc-khoe";
import { coDongTuChoiChuaGiai } from "./provider/tcb-agent";
import { CUA_SO_LUI_MS, DUNG_SAI_GIO_MAY_MS } from "./provider/doc-du-lieu";
import {
  cauKhongUngVien,
  SO_UNG_VIEN_TOI_DA,
  lamSachGhiChuHienThi,
  lanCanMa,
  locUngVien,
  demBiLoaiVeBac,
  phanLoaiSaiMa,
  tachLyDo,
  trangThaiHieuLuc,
  type DongUngVien,
  type HieuLucDangGiu,
  type HieuLucSaiMa,
  type KetQuaPhanLoai,
  type KetQuaTimSaiMa,
  type KieuSaiMa,
  type LyDoChoKeToan,
  type TrangThaiSaiMa,
  type UngVienHienThi,
} from "./sai-ma";

export type { KetQuaTimSaiMa, UngVienHienThi };
import { DAI_MA } from "@/lib/payments/ma-phieu";

type Tx = Prisma.TransactionClient;
/** Khách đã scope theo người xem. */
type Sdb = ReturnType<typeof scopedDb>;

/** Khách ĐỌC ứng viên — `scopedDb(actor)` khi hiển thị, `tx` dưới khoá. */
export type KhachDoc = Pick<Tx, "posCardTransaction" | "posTerminal">;
/** Khách cho các câu tra để CHẶN — KHÔNG scope (xem đầu tệp). */
export type KhachChan = Pick<
  Tx,
  "posCardTransaction" | "posPaymentIntent" | "posSaiMaYeuCau" | "paymentBill" | "posAgent" | "posTxnSource" | "posTerminal"
>;

/** Phần của phiếu thẻ mà việc đọc cần. `createdAt` là mốc của cửa sổ. */
export type IntentDeTim = {
  id: string;
  code5: string;
  createdAt: Date;
  centerId: string;
  posTerminalId: string | null;
  /** BẮT BUỘC: phiếu thẻ HUY CÙNG phiếu gộp với phiếu đang xét không phải đối thủ của chính nó (xem `canhTranh`). */
  paymentBillId: string;
  /**
   * BẮT BUỘC (luật 7) — Việc 5: ĐƠN của phiếu thẻ. Bộ nhớ "kế toán đã bác giao dịch này" khoá theo ĐƠN (`docGiaoDichDaBiBac`), không theo phiếu thẻ: phiếu thẻ
   * sống 24 giờ và thay được (hết hạn · huỷ · phiếu gộp đổi mã) trong khi đơn sống tiếp. Thiếu trường này `tsc` liệt kê mọi chỗ gọi — quên truyền là
   * quên luôn vết bác, và lỗi đó CÂM (không ca nào đỏ, tiền vào đơn không qua kế toán).
   */
  orderId: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// ĐIỀU KIỆN TRUY VẤN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Điều kiện CỨNG của câu truy vấn ứng viên (index `[matchStatus, thoiGianGiaoDich]`): đã qua phân loại mà chưa ra hàng chờ ·
 * đúng số phải thu HIỆN TẠI · trong cửa sổ [mở phiếu − 5′, hiện tại] (cận trên là `now`, KHÔNG cộng dung sai đồng hồ máy —
 * TỰ QUYẾT V59) · đúng MÁY (`maThietBi` của máy còn bật) · giao dịch tiền còn UNMATCHED, chưa phiếu thẻ nào nhận, chưa yêu cầu
 * nào còn sống giữ. Vế "kế toán đã bác giao dịch này cho ĐƠN" (Việc 5 — xem `docGiaoDichDaBiBac`; trước đó khoá theo phiếu thẻ) và các vế hủy/hoàn do
 * `locUngVien` (thuần) lo.
 *
 * Tách thành hàm thuần để ca `[HN3-L5]` đo từng vế mà không cần DB; hành vi thật đo ở `[HN3-DB-10]`.
 */
export function dungDieuKienUngVien(x: {
  conPhaiThu: number;
  maThietBi: readonly string[];
  tu: Date;
  den: Date;
}): Prisma.PosCardTransactionWhereInput {
  return {
    matchStatus: "CAN_XU_LY",
    soTien: x.conPhaiThu,
    maThietBi: { in: [...x.maThietBi] },
    thoiGianGiaoDich: { gte: x.tu, lte: x.den },
    bankTransaction: {
      is: {
        status: "UNMATCHED",
        provider: PROVIDER_THE_POS,
        posPaymentIntent: { is: null },
        posSaiMaYeuCau: { none: { trangThai: { not: "TU_CHOI" } } },
      },
    },
  };
}

const CHON_UNG_VIEN = {
  maGiaoDich: true,
  loaiGiaoDich: true,
  trangThai: true,
  soTien: true,
  thoiGianGiaoDich: true,
  dienGiai: true,
  soTheMasked: true,
  maThietBi: true,
  maGiaoDichThe: true,
  trangThaiHoanHuy: true,
  canhBaoHuy: true,
  bankTransactionId: true,
  bankTransaction: { select: { id: true, unmatchedNote: true } },
} as const satisfies Prisma.PosCardTransactionSelect;

/** Trần dòng đọc thô — đủ cho một máy trong một cửa sổ vài giờ; đọc theo giờ GIẢM dần để dòng mới nhất luôn vào. */
const TRAN_DONG_THO = 50;

// ─────────────────────────────────────────────────────────────────────────────
// BỘ NHỚ "KẾ TOÁN ĐÃ BÁC" — PHẠM VI ĐƠN (Việc 5)
// ─────────────────────────────────────────────────────────────────────────────

/** Kết quả của `docGiaoDichDaBiBac`. */
export type DaBiBac = {
  /** Số yêu cầu `TU_CHOI` của đơn (đếm DÒNG, không đếm giao dịch khác nhau) — đầu vào `soLanBiBac` của `phanLoaiSaiMa`. */
  soLan: number;
  /** `BankTransaction.id` của mọi giao dịch kế toán đã bác cho đơn — đầu vào `daBiBacChoDon` của `locUngVien`. */
  giaoDich: ReadonlySet<string>;
};

/**
 * Mọi giao dịch kế toán đã TỪ CHỐI cho ĐƠN `orderId` — qua BẤT KỲ phiếu thẻ nào của đơn, thuộc phiếu gộp nào, còn sống hay đã HET_HAN / HUY.
 * MỘT hàm cho CẢ HAI việc (loại giao dịch khỏi danh sách ứng viên · ép mọi đề nghị sau của đơn chờ kế toán): hai nơi tự hỏi là hai nơi có ngày
 * cãi nhau về phạm vi. Cũng là MỘT chỗ cho cả bước tìm (màn) lẫn bước gửi (máy chủ tính LẠI dưới khoá) — chúng cùng gọi `docUngVienSaiMa`.
 *
 * ── VÌ SAO ĐƠN, KHÔNG PHẢI PHIẾU THẺ (Việc 5, 10/10/2026 — đo ở `tests/finance/pos-bac-lach-phieu-moi.test.ts`) ─────────────────────────────────
 * Bản Việc 3 khoá theo `intentId`. Phiếu thẻ chỉ sống 24 giờ và THAY ĐƯỢC trong khi đơn sống tiếp: X quẹt ≤ 5′ cuối đời phiếu cũ, kế toán bác, phiếu cũ hết
 * hạn, "Thẻ POS" mở phiếu MỚI dùng lại cùng mã ⇒ phiếu mới "chưa từng bị bác" ⇒ X là ứng viên duy nhất ghi chú rỗng ⇒ TỰ GHI NHẬN: tiền vào đơn không qua
 * kế toán, đúng giao dịch kế toán vừa nói "không phải của khách này". Đường thay phiếu thẻ: hết hạn (sale bấm / poller) · huỷ tay (Việc 4) · phiếu gộp đổi mã.
 *
 * Phạm vi PHIẾU GỘP (`paymentBillId`) đóng được ba đường đầu nhưng để lọt đường thứ ba: huỷ phiếu gộp rồi phát lại MÃ MỚI là cho phép khi thẻ đã quá hạn
 * (`kieuTheDangMo` = null), và `taoPhieuPosTrongKhoa` đẩy phiếu thẻ cũ sang HUY. Phiếu gộp đổi, ĐƠN vẫn một — và lời bác của kế toán nghĩa là "không phải giao dịch
 * của KHÁCH này", khách ứng với đơn. Ca phân định: `[HN5-DB-05]`. Lý do thứ hai: bên GHI `TU_CHOI` (`tuChoiSaiMa`) và bên ĐỌC dưới khoá (`guiSaiMa`) cùng tuần tự trên
 * `khoaDonTrongTx` của đơn — phạm vi đơn khớp đúng khoá đang giữ, nên lượt đọc dưới khoá không bao giờ thấy vết bác nửa vời.
 *
 * ĐƠN KHÁC không bị ảnh hưởng: giao dịch bác cho đơn A vẫn là ứng viên hợp lệ của đơn B (có thể đúng là của khách đơn B) — `[HN5-DB-06]`. Không phạm vi toàn hệ thống.
 *
 * `chan` — KHÔNG BAO GIỜ khách đã scope: tra qua `scopedDb` thì đúng vết bác cần chặn (dòng mang `centerId` lệch) bị lọc mất, trả rỗng, và cổng đọc rỗng thành "chưa
 * từng bị bác" (CLAUDE.md, mục `PaymentMethod`).
 */
export async function docGiaoDichDaBiBac(chan: Pick<KhachChan, "posSaiMaYeuCau">, orderId: string): Promise<DaBiBac> {
  const dong = await chan.posSaiMaYeuCau.findMany({
    where: { trangThai: "TU_CHOI", intent: { paymentBill: { orderId } } },
    select: { bankTransactionId: true },
  });
  return { soLan: dong.length, giaoDich: new Set(dong.map((r) => r.bankTransactionId)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// HÀM LÕI
// ─────────────────────────────────────────────────────────────────────────────

export type UngVienDoc = {
  bankTransactionId: string;
  maGiaoDich: string;
  thoiGianGiaoDich: Date;
  soTien: number;
  soTheMasked: string | null;
  /** Ghi chú NGUYÊN VĂN (chữ người gõ) — chỉ dùng ở máy chủ; ra UI phải qua `lamSachGhiChuHienThi`. */
  dienGiai: string;
  /** Kết quả `phanLoaiSaiMa` cho CHÍNH ứng viên này (đã tính với tổng số ứng viên). Không bao giờ `KHONG_UNG_VIEN`. */
  xemTruoc: Exclude<KetQuaPhanLoai, { quyet: "KHONG_UNG_VIEN" }>;
};

export type KetQuaDocUngVien =
  /** Việc tìm bị từ chối vì lý do KHÔNG phải "không có giao dịch" (máy tắt · đã có dòng mang đúng mã). */
  | { loai: "TU_CHOI_TIM"; cau: string }
  | {
      loai: "OK";
      /** MỌI ứng viên hợp lệ (cổng dưới khoá tìm giao dịch được chọn trong đây); UI cắt ở `SO_UNG_VIEN_TOI_DA`. */
      ungVien: UngVienDoc[];
      conNua: boolean;
      /** Nhãn máy cho câu điều kiện của UI. */
      mayNhan: string;
      tuLuc: Date;
      soLanBiBac: number;
      duLieuThieu: boolean;
      /**
       * Số giao dịch bị loại CHỈ vì kế toán đã bác chúng cho ĐƠN (qua đủ mọi vế khác của `laUngVienHopLe`). Rà đối kháng Việc 5: danh sách trống mà không biết điều này
       * thì màn nói "không thấy giao dịch nào" trong khi CÓ — `cauKhongUngVien` (sai-ma.ts) chọn câu theo số này, cho cả bước tìm lẫn bước gửi.
       */
      soBiLoaiVeBac: number;
    };

function nhanMay(m: { maQuay: string | null; ten: string | null; maThietBi: string }): string {
  return m.maQuay ?? m.ten ?? m.maThietBi;
}

/** Mã hợp lệ nằm trong / gần các token 5 ký tự của ghi chú — để tra "phiếu khác mà ghi chú cũng gần giống mã của nó". */
function maGanCuaGhiChu(ghiChu: string | null, maDung: string): string[] {
  const ra = new Set<string>();
  for (const t of tachTokenGhiChu(ghiChu)) {
    if (t.length !== DAI_MA) continue;
    for (const m of lanCanMa(t)) if (m !== maDung) ra.add(m);
  }
  return [...ra];
}

/**
 * Dữ liệu của cơ sở có thể THIẾU đúng giao dịch thật không (V63) — phép đếm "đúng 1 ứng viên" chạy trên dữ liệu thiếu thì không được
 * ra TỰ GHI NHẬN. Chọn chế độ bằng CHÍNH hàm provider dùng (`chonAgentChoPhieu`):
 *   · có máy đồng bộ: thiếu khi nó chưa SẴN SÀNG, hoặc còn dòng bị TỪ CHỐI chưa giải trong cửa sổ;
 *   · chế độ FILE: thiếu khi dữ liệu của cơ sở KHÔNG có giao dịch nào mới hơn lúc mở phiếu (file chưa phủ tới đó).
 */
async function laDuLieuThieu(chan: KhachChan, intent: IntentDeTim, now: Date): Promise<boolean> {
  const agents = await chan.posAgent.findMany({
    where: { centerId: intent.centerId, active: true },
    select: { id: true, merchantCode: true, active: true, sessionState: true, lastHeartbeatAt: true },
    orderBy: { createdAt: "asc" },
  });
  const may = intent.posTerminalId
    ? await chan.posTerminal.findUnique({ where: { id: intent.posTerminalId }, select: { maNhaCungCap: true } })
    : null;
  const agent = chonAgentChoPhieu({ agentsCuaCoSo: agents, maNhaCungCapCuaMay: may?.maNhaCungCap ?? null });
  if (agent !== null && chonCheDoNguonPos(agent) === "AGENT") {
    if (sucKhoeAgent(agent, now) !== "SAN_SANG") return true;
    return coDongTuChoiChuaGiai(
      {
        agentId: agent.id,
        tu: new Date(intent.createdAt.getTime() - CUA_SO_LUI_MS),
        den: new Date(now.getTime() + DUNG_SAI_GIO_MAY_MS),
      },
      chan,
    );
  }
  const moiNhat = await chan.posCardTransaction.aggregate({
    where: { centerId: intent.centerId },
    _max: { thoiGianGiaoDich: true },
  });
  const t = moiNhat._max.thoiGianGiaoDich;
  return t === null || t.getTime() < intent.createdAt.getTime();
}

/**
 * Đọc ứng viên cho MỘT phiếu thẻ đang "Chưa thấy giao dịch". `conPhaiThu` là số phải thu HIỆN TẠI đọc dưới khoá
 * (`docPhieuDeThuTrongTx`), KHÔNG phải `intent.amount` (V60): số gõ vào máy là số hiện tại, và `thuTheoPhieuGop` so từng đồng.
 */
export async function docUngVienSaiMa(x: {
  doc: KhachDoc;
  chan: KhachChan;
  intent: IntentDeTim;
  conPhaiThu: number;
  /** BẮT BUỘC (luật 19). */
  now: Date;
}): Promise<KetQuaDocUngVien> {
  const { doc, chan, intent, now } = x;
  const tu = new Date(intent.createdAt.getTime() - CUA_SO_LUI_MS);

  // ── (A) MÁY. Đường tiền chặn quẹt chéo cơ sở (Q-E) bằng cơ sở HIỆN TẠI của máy, tra theo `maThietBi` còn BẬT — nên máy phải
  // còn bật VÀ còn thuộc cơ sở của đơn; dòng của máy khác cơ sở (kể cả máy vừa đổi cơ sở) chắc chắn ra CAN_XU_LY khi duyệt.
  const may = await doc.posTerminal.findMany({
    where: { centerId: intent.centerId, active: true, ...(intent.posTerminalId ? { id: intent.posTerminalId } : {}) },
    select: { maThietBi: true, maQuay: true, ten: true },
  });
  if (may.length === 0) {
    return {
      loai: "TU_CHOI_TIM",
      cau: intent.posTerminalId
        ? "Máy POS của phiếu này đã bị tắt hoặc không còn thuộc cơ sở của đơn — báo kế toán."
        : "Cơ sở chưa có máy POS nào đang bật — báo kế toán.",
    };
  }

  // ── (B) G-A: trong cửa sổ đã có dòng mang ĐÚNG mã (mọi trạng thái/loại) ⇒ đó là việc của nút "Kiểm tra thanh toán" — nút này
  // không được mở đường tắt vòng qua nó (dòng "Thất bại"/"Đang xử lý" mang đúng mã ≠ gõ sai mã).
  const mangMa = await chan.posCardTransaction.findMany({
    where: { thoiGianGiaoDich: { gte: tu, lte: now }, dienGiai: { contains: intent.code5, mode: "insensitive" } },
    select: { dienGiai: true },
    take: TRAN_DONG_THO,
  });
  if (mangMa.some((r) => tachMaPos(r.dienGiai).includes(intent.code5))) {
    return { loai: "TU_CHOI_TIM", cau: `Có giao dịch mang mã ${intent.code5} — bấm Kiểm tra thanh toán.` };
  }

  // ── (C) Ứng viên thô.
  const tho = await doc.posCardTransaction.findMany({
    where: dungDieuKienUngVien({ conPhaiThu: x.conPhaiThu, maThietBi: may.map((m) => m.maThietBi), tu, den: now }),
    orderBy: { thoiGianGiaoDich: "desc" },
    take: TRAN_DONG_THO,
    select: CHON_UNG_VIEN,
  });
  const nhanChung = may.length === 1 ? nhanMay(may[0]!) : "các máy của cơ sở";
  // Việc 5: vết bác khoá theo ĐƠN (xem `docGiaoDichDaBiBac`) — MỘT lượt đọc cho cả "số lần bị bác" lẫn "giao dịch nào đã bị bác", cùng một ảnh chụp.
  const bac = await docGiaoDichDaBiBac(chan, intent.orderId);
  const soLanBiBac = bac.soLan;
  const duLieuThieu = await laDuLieuThieu(chan, intent, now);
  if (tho.length === 0) {
    return { loai: "OK", ungVien: [], conNua: false, mayNhan: nhanChung, tuLuc: tu, soLanBiBac, duLieuThieu, soBiLoaiVeBac: 0 };
  }

  // ── (D) Sự thật quanh từng dòng (câu tra để CHẶN — không scope).
  const maTho = tho.map((r) => r.maGiaoDich);
  const rrn = [...new Set(tho.map((r) => r.maGiaoDichThe?.trim() ?? "").filter((s) => s !== ""))];
  const huyTro = new Set(
    (
      await chan.posCardTransaction.findMany({
        where: { maGiaoDichGoc: { in: maTho } },
        select: { maGiaoDichGoc: true, loaiGiaoDich: true },
      })
    )
      .filter((r) => !laLoaiThanhToan(r.loaiGiaoDich))
      .map((r) => r.maGiaoDichGoc ?? ""),
  );
  const rrnCoDongKhacLoai = new Set(
    rrn.length === 0
      ? []
      : (
          await chan.posCardTransaction.findMany({
            where: { maGiaoDichThe: { in: rrn }, maGiaoDich: { notIn: maTho } },
            select: { maGiaoDichThe: true, loaiGiaoDich: true },
          })
        )
          .filter((r) => !laLoaiThanhToan(r.loaiGiaoDich))
          .map((r) => (r.maGiaoDichThe ?? "").trim()),
  );
  const dong = tho.map((r) => ({
    ...r,
    daGoGan: (r.bankTransaction?.unmatchedNote ?? "").startsWith(TIEN_TO_GO_GAN),
    coDongHuyTroVao: huyTro.has(r.maGiaoDich),
    coDongKhacLoaiCungRrn: rrnCoDongKhacLoai.has((r.maGiaoDichThe ?? "").trim()) && (r.maGiaoDichThe ?? "").trim() !== "",
    daBiBacChoDon: r.bankTransactionId !== null && bac.giaoDich.has(r.bankTransactionId),
  })) satisfies (DongUngVien & { bankTransactionId: string | null })[];
  const hopLe = locUngVien(dong, x.conPhaiThu).filter((r): r is typeof r & { bankTransactionId: string } => r.bankTransactionId !== null);
  // Giao dịch bị loại CHỈ vì vết bác: lọc lại các dòng đã mang vết bác với cờ ấy TẮT — còn lọt qua mọi vế khác thì đúng là bị vết bác loại.
  const soBiLoaiVeBac = demBiLoaiVeBac(dong, x.conPhaiThu);
  if (hopLe.length === 0) {
    return { loai: "OK", ungVien: [], conNua: false, mayNhan: nhanChung, tuLuc: tu, soLanBiBac, duLieuThieu, soBiLoaiVeBac };
  }

  // Phiếu thẻ KHÁC đang mở cũng nhận được giao dịch này: cùng cơ sở, còn hạn, chưa nhận giao dịch, cùng số tiền, mở trước giờ quẹt
  // + 5′, và (chưa chốt máy HOẶC cùng máy). So `intent.amount` chứ không `conPhaiThu` hiện tại của nó (rủi ro R-1, ghi ở docs §5.8).
  // "Mở" theo ĐÚNG nghĩa của repo (`TRANG_THAI_MO` = CHO_QUET ∪ THAT_BAI — tập của chỉ mục từng phần `PosPaymentIntent_paymentBillId_mo_key`,
  // poller và `kieuTheDangMo` cũng dùng): phiếu THAT_BAI vẫn quẹt lại được, nên khách của nó có thể là chủ giao dịch này. Bản đầu chỉ lấy
  // CHO_QUET ⇒ giao dịch mồ côi của khách A (lần quẹt đầu thất bại, quẹt lại gõ sai mã) bị sale đơn B TỰ GHI NHẬN vào đơn B [HN3-RV-02].
  //
  // ⚠️ VÀ phiếu thẻ HUY mà phiếu gộp của nó VẪN MỞ [HN4-DB-18b, rà đối kháng bản ghép 10/10/2026]. Từ Việc 4 sale huỷ TAY được một phiếu thẻ
  // mà mã của phiếu gộp vẫn sống; cổng huỷ chỉ tìm tiền theo MÃ trong ghi chú nên một giao dịch ghi chú RỖNG của khách đó vô hình với nó,
  // và tick "chắc khách chưa quẹt" là lời sale chứ không phải bằng chứng. Trước Việc 4 phiếu HUY chỉ sinh ra khi phiếu gộp của nó đã đổi
  // (mã cũ chết) nên không tính là đối thủ; coi huỷ tay như "đối thủ đã biến mất" thì sale đơn A TỰ GHI NHẬN giao dịch của khách B vào đơn A.
  // Phiếu HUY mà phiếu gộp không còn OPEN (mã đã chết) vẫn KHÔNG là đối thủ. Loại phiếu CÙNG phiếu gộp: phiếu HUY cũ của CHÍNH khách này
  // (mở lại "Thẻ POS" sau khi huỷ) không được tự tính là đối thủ của phiếu mới.
  const canhTranh = await chan.posPaymentIntent.findMany({
    where: {
      id: { not: intent.id },
      paymentBillId: { not: intent.paymentBillId },
      centerId: intent.centerId,
      OR: [{ status: { in: [...TRANG_THAI_MO] } }, { status: "HUY", paymentBill: { status: "OPEN" } }],
      bankTransactionId: null,
      expiresAt: { gt: now },
      amount: x.conPhaiThu,
    },
    select: { createdAt: true, posTerminal: { select: { maThietBi: true } } },
    take: TRAN_DONG_THO,
  });
  // ⚠️ THỨ TỰ HAI CÂU TRA NÀY LÀ MỘT PHẦN CỦA LUẬT: `canhTranh` (ở trên) rồi mới `yeuCauSong` (dưới). Dưới READ COMMITTED mỗi câu tra một ảnh chụp
  // riêng; lúc phiếu kia gửi yêu cầu, nó đổi CHO_QUET → CAN_XU_LY và thêm yêu cầu sống TRONG CÙNG MỘT transaction. Hỏi `canhTranh` TRƯỚC: hoặc nó
  // thấy phiếu CHO_QUET (chưa commit) hoặc `yeuCauSong` — chạy sau — thấy yêu cầu đã commit ⇒ không có khe hở. Đảo thứ tự thì có khe: `yeuCauSong`
  // chạy trước lúc commit (0), `canhTranh` chạy sau (phiếu đã CAN_XU_LY ⇒ 0) ⇒ TỰ GHI NHẬN trở lại. Lưới `[HN3-RV-01·W]` ghim thứ tự này.
  // Phiếu KHÁC đã GIỮ một giao dịch cùng số tiền, cùng máy, trong cửa sổ của phiếu này bằng một yêu cầu CÒN SỐNG (chờ duyệt / đang ghi). Phiếu ấy
  // không còn CHO_QUET (đã CAN_XU_LY) nên phép đếm ở trên không thấy nó — mà chính sự mơ hồ "giao dịch nào của khách nào" là lý do yêu cầu của nó
  // phải chờ kế toán; để bên bấm SAU tiêu mất sự mơ hồ ấy (còn đúng một ứng viên ⇒ tự ghi nhận) là phá lớp kiểm soát "nhiều ứng viên ⇒ kế toán
  // chọn" [HN3-RV-01]. Giao dịch bị giữ phải còn UNMATCHED: đã gắn/bỏ qua rồi thì không còn tranh chấp gì. Đếm CHUNG cho mọi ứng viên: ta không
  // biết phiếu kia sẽ nhận T1 hay T2, chỉ biết chúng chia nhau cùng một nhóm giao dịch.
  const yeuCauSong = await chan.posSaiMaYeuCau.count({
    where: {
      intentId: { not: intent.id },
      centerId: intent.centerId,
      trangThai: { in: ["CHO_DUYET", "DANG_GHI"] },
      bankTransaction: {
        is: {
          status: "UNMATCHED",
          posCardTransaction: {
            is: { soTien: x.conPhaiThu, maThietBi: { in: may.map((m) => m.maThietBi) }, thoiGianGiaoDich: { gte: tu, lte: now } },
          },
        },
      },
    },
  });
  const soCanhTranh = (r: { thoiGianGiaoDich: Date; maThietBi: string | null }) =>
    yeuCauSong +
    canhTranh.filter(
      (q) =>
        r.thoiGianGiaoDich.getTime() >= q.createdAt.getTime() - CUA_SO_LUI_MS &&
        (q.posTerminal === null || q.posTerminal.maThietBi === r.maThietBi),
    ).length;

  // Mã hợp lệ gần ghi chú → phiếu gộp nào mang mã đó (đang mở hay đã đóng).
  const maCanTra = [...new Set(hopLe.flatMap((r) => maGanCuaGhiChu(r.dienGiai, intent.code5)))];
  const phieuTheoMa = new Map<string, boolean>();
  if (maCanTra.length > 0) {
    for (const p of await chan.paymentBill.findMany({
      where: { matchKey: { in: maCanTra } },
      select: { matchKey: true, status: true },
    })) {
      if (p.matchKey) phieuTheoMa.set(p.matchKey, (phieuTheoMa.get(p.matchKey) ?? false) || p.status === "OPEN");
    }
  }

  const ungVien: UngVienDoc[] = hopLe.map((r) => {
    const xemTruoc = phanLoaiSaiMa({
      maDung: intent.code5,
      soUngVien: hopLe.length,
      ghiChu: r.dienGiai,
      phieuKhac: maGanCuaGhiChu(r.dienGiai, intent.code5)
        .filter((m) => phieuTheoMa.has(m))
        .map((m) => ({ ma: m, dangMo: phieuTheoMa.get(m) === true })),
      soPhieuTheCanhTranh: soCanhTranh(r),
      duLieuThieu,
      soLanBiBac,
    });
    // hopLe.length ≥ 1 ⇒ không bao giờ KHONG_UNG_VIEN.
    if (xemTruoc.quyet === "KHONG_UNG_VIEN") throw new Error("phanLoaiSaiMa: KHONG_UNG_VIEN với ≥ 1 ứng viên");
    return {
      bankTransactionId: r.bankTransactionId,
      maGiaoDich: r.maGiaoDich,
      thoiGianGiaoDich: r.thoiGianGiaoDich,
      soTien: r.soTien,
      soTheMasked: r.soTheMasked,
      dienGiai: r.dienGiai,
      xemTruoc,
    };
  });
  return {
    loai: "OK",
    ungVien,
    conNua: ungVien.length > SO_UNG_VIEN_TOI_DA,
    mayNhan: nhanChung,
    tuLuc: tu,
    soLanBiBac,
    duLieuThieu,
    soBiLoaiVeBac,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHO NÚT CỦA SALE
// ─────────────────────────────────────────────────────────────────────────────

/** 4 số cuối của số thẻ đã che ("411111******1234" → "1234"); không có 4 chữ số cuối ⇒ `null`. */
export function bonSoCuoi(soTheMasked: string | null): string | null {
  const m = /(\d{4})\s*$/.exec(soTheMasked ?? "");
  return m ? m[1]! : null;
}

/**
 * Bước "tìm" của sale. `sdb` = `scopedDb(actor)` đã qua cổng quyền + phạm vi đơn ở action. Cổng CHỈ ĐỌC (không khoá): kết quả là
 * xem trước, bước gửi tính lại dưới khoá.
 */
export async function timUngVienSaiMa(x: {
  sdb: Sdb;
  orderId: string;
  intentId: string;
  /** BẮT BUỘC (luật 19). */
  now: Date;
}): Promise<KetQuaTimSaiMa> {
  const intent = await x.sdb.posPaymentIntent.findFirst({
    where: { id: x.intentId, paymentBill: { orderId: x.orderId } },
    select: {
      id: true,
      code5: true,
      createdAt: true,
      expiresAt: true,
      centerId: true,
      posTerminalId: true,
      paymentBillId: true,
      status: true,
      bankTransactionId: true,
      lastResultKind: true,
    },
  });
  if (!intent) return { ok: false, error: "Không tìm thấy phiếu POS" };
  if (intent.status !== "CHO_QUET") return { ok: false, error: "Phiếu thu thẻ không còn chờ quẹt" };
  if (phieuPosHetHan(intent.expiresAt, x.now)) return { ok: false, error: "Phiếu thu thẻ đã hết hạn — tạo phiếu mới nếu cần thu" };
  if (intent.bankTransactionId !== null) return { ok: false, error: "Phiếu thẻ này đã nhận một giao dịch" };
  if (intent.lastResultKind !== "NOT_FOUND") {
    return { ok: false, error: "Bấm Kiểm tra thanh toán trước — chỉ dùng khi hệ thống báo 'Chưa thấy giao dịch'" };
  }

  const mo = await docPhieuGopDangMo(x.orderId);
  if (!mo || mo.billId !== intent.paymentBillId || mo.ma !== intent.code5) {
    return { ok: false, error: "Phiếu gộp không còn mở — tải lại trang" };
  }

  // Cùng đối tượng lúc chạy; kiểu của client đã `$extends` (scopedDb) không gán được cho `TransactionClient` thô vì chữ ký generic
  // của Prisma (`Exact<>`) — repo ép kiểu đúng chỗ này ở `lib/finance/dung-hoc-con.ts`. Phạm vi vẫn do `query` hook của scopedDb lo.
  const r = await docUngVienSaiMa({ doc: x.sdb as unknown as KhachDoc, chan: db, intent: { ...intent, orderId: x.orderId }, conPhaiThu: mo.tongTien, now: x.now });
  if (r.loai === "TU_CHOI_TIM") return { ok: false, error: r.cau };
  const hienThi = r.ungVien.slice(0, SO_UNG_VIEN_TOI_DA).map(
    (u): UngVienHienThi => ({
      bankTransactionId: u.bankTransactionId,
      gioQuet: gioVN(u.thoiGianGiaoDich),
      soTien: u.soTien,
      soTheCuoi: bonSoCuoi(u.soTheMasked),
      ghiChu: lamSachGhiChuHienThi(u.dienGiai),
      xemTruoc:
        u.xemTruoc.quyet === "TU_GHI_NHAN"
          ? { quyet: "TU_GHI_NHAN", lyDo: [] }
          : { quyet: "CHO_KE_TOAN", lyDo: [...u.xemTruoc.lyDo] },
    }),
  );
  return {
    ok: true,
    ungVien: hienThi,
    conNua: r.conNua,
    soTien: mo.tongTien,
    may: r.mayNhan,
    tuLuc: gioVN(r.tuLuc),
    cau: hienThi.length === 0 ? cauKhongUngVien(r.soBiLoaiVeBac) : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHO KHU THẺ POS CỦA KẾ TOÁN
// ─────────────────────────────────────────────────────────────────────────────

/** Một dòng của khối "yêu cầu xác nhận giao dịch nhập sai mã". Không tên phụ huynh, không số thẻ đầy đủ. */
export type DongSaiMa = {
  id: string;
  hieuLuc: HieuLucSaiMa;
  kieu: KieuSaiMa;
  trangThai: TrangThaiSaiMa;
  guiLuc: Date;
  nguoiGuiId: string;
  nguoiGui: string;
  /** `null` khi đơn nằm NGOÀI tầm nhìn người xem — khi đó `maDon` = "Đơn ở cơ sở khác". */
  orderId: string | null;
  maDon: string;
  maPhieu: string;
  tenMay: string | null;
  bankTransactionId: string;
  gioQuet: Date | null;
  soTien: number;
  soTheCuoi: string | null;
  /** Ghi chú trên máy, ĐÃ làm sạch. */
  ghiChu: string;
  lyDo: LyDoChoKeToan[];
  lyDoTuChoi: string | null;
  nguoiQuyet: string | null;
  quyetLuc: Date | null;
};

export type HangChoSaiMa = {
  /** Cần kế toán hành động hoặc đang ghi: CHO_DUYET · KET (thử lại) · DANG_GHI (chỉ để nhìn). */
  cho: DongSaiMa[];
  /** 7 ngày qua, chỉ đọc: đã ghi nhận · bị từ chối · đã xử lý ở nơi khác. */
  hauKiem: DongSaiMa[];
  /** Giao dịch nào đang bị giữ bởi yêu cầu nào — chip ở bảng giao dịch phía trên. */
  theoGiaoDich: Record<string, { hieuLuc: HieuLucDangGiu; kieu: KieuSaiMa }>;
  /**
   * Số dòng CẦN NGƯỜI hành động: chờ duyệt + kẹt. KHÔNG tính dòng "đang ghi" (máy đang tự xử lý — chưa có gì để bấm). Băng cảnh báo ở đầu trang
   * dùng đúng số này: nói "đang chờ xử lý" cho một dòng không có nút nào là affordance nói dối (luật 12). BẮT BUỘC (luật 7).
   */
  soCanXuLy: number;
};

/** Trần dòng hậu kiểm hiển thị. */
export const TRAN_HAU_KIEM = 20;
const BAY_NGAY_MS = 7 * 24 * 60 * 60_000;

/**
 * Hàng chờ cho trang Biến động số dư. `sdb` = `scopedDb(actor)`; TỰ `passesScope("Order")` từng đơn (V68: trang `page.tsx` không
 * thêm select lồng — lưới `[POS-PII-01]` đếm đúng hai). CHỈ gọi khi người xem có `payments:manage` — nút họ không bấm được thì
 * không đọc, không vẽ (luật 12).
 */
export async function docHangChoSaiMa(sdb: Sdb, actor: Actor, now: Date): Promise<HangChoSaiMa> {
  const tu = new Date(now.getTime() - BAY_NGAY_MS);
  const rows = await sdb.posSaiMaYeuCau.findMany({
    where: { OR: [{ trangThai: { in: ["CHO_DUYET", "DANG_GHI"] } }, { createdAt: { gte: tu } }, { quyetLuc: { gte: tu } }] },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      kieu: true,
      trangThai: true,
      lyDo: true,
      createdAt: true,
      dangGhiLuc: true,
      nguoiGuiId: true,
      nguoiGui: { select: { name: true, email: true } },
      nguoiQuyet: { select: { name: true, email: true } },
      quyetLuc: true,
      lyDoTuChoi: true,
      bankTransactionId: true,
      bankTransaction: {
        select: {
          status: true,
          unmatchedNote: true,
          posCardTransaction: {
            select: { thoiGianGiaoDich: true, soTien: true, soTheMasked: true, dienGiai: true },
          },
        },
      },
      intent: {
        select: {
          code5: true,
          posTerminal: { select: { maQuay: true, ten: true, maThietBi: true } },
          // Nested select KHÔNG được auto-scope ⇒ tự `passesScope("Order")` bên dưới.
          paymentBill: { select: { order: { select: { id: true, code: true, centerId: true } } } },
        },
      },
    },
  });

  const cho: DongSaiMa[] = [];
  const hauKiem: DongSaiMa[] = [];
  const theoGiaoDich: HangChoSaiMa["theoGiaoDich"] = {};
  let soCanXuLy = 0;
  for (const r of rows) {
    const hieuLuc = trangThaiHieuLuc({
      trangThai: r.trangThai,
      btStatus: r.bankTransaction.status,
      btDaGoGan: (r.bankTransaction.unmatchedNote ?? "").startsWith(TIEN_TO_GO_GAN),
      dangGhiLuc: r.dangGhiLuc,
      now,
    });
    const don = r.intent.paymentBill.order;
    const thay = don ? passesScope("Order", don, actor) : false;
    const pos = r.bankTransaction.posCardTransaction;
    const dong: DongSaiMa = {
      id: r.id,
      hieuLuc,
      kieu: r.kieu,
      trangThai: r.trangThai,
      guiLuc: r.createdAt,
      nguoiGuiId: r.nguoiGuiId,
      nguoiGui: r.nguoiGui.name ?? r.nguoiGui.email ?? "—",
      orderId: thay ? (don?.id ?? null) : null,
      maDon: thay ? (don?.code ?? "—") : "Đơn ở cơ sở khác",
      // Đơn ngoài tầm nhìn: không mã phiếu thẻ, không giờ/số thẻ/ghi chú — chỉ đủ để biết "có việc nhưng không phải của bạn".
      maPhieu: thay ? r.intent.code5 : "—",
      tenMay: thay && r.intent.posTerminal ? nhanMay(r.intent.posTerminal) : null,
      bankTransactionId: r.bankTransactionId,
      gioQuet: thay ? (pos?.thoiGianGiaoDich ?? null) : null,
      soTien: pos?.soTien ?? 0,
      soTheCuoi: thay ? bonSoCuoi(pos?.soTheMasked ?? null) : null,
      ghiChu: thay ? lamSachGhiChuHienThi(pos?.dienGiai ?? null) : "",
      lyDo: tachLyDo(r.lyDo),
      lyDoTuChoi: r.lyDoTuChoi,
      nguoiQuyet: r.nguoiQuyet ? (r.nguoiQuyet.name ?? r.nguoiQuyet.email ?? "—") : null,
      quyetLuc: r.quyetLuc,
    };
    if (hieuLuc === "CHO_DUYET" || hieuLuc === "KET" || hieuLuc === "DANG_GHI") {
      cho.push(dong);
      if (hieuLuc !== "DANG_GHI") soCanXuLy += 1;
      theoGiaoDich[r.bankTransactionId] = { hieuLuc, kieu: r.kieu };
    } else if (hauKiem.length < TRAN_HAU_KIEM && (r.quyetLuc ?? r.createdAt).getTime() >= tu.getTime()) {
      hauKiem.push(dong);
    }
  }
  return { cho, hauKiem, theoGiaoDich, soCanXuLy };
}
