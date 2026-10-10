import "server-only";
// lib/payments/pos/nhap-lo-pos.ts — NHẬP MỘT LÔ dòng giao dịch thẻ SmartPOS vào sổ. CHẠM TIỀN.
//
// Thiết kế + 4 quyết định chủ dự án: `docs/pos-the-smartpos.md`. Tệp này là tầng DB của
// "Luật khớp": nó đọc máy POS + dòng đã có, gọi `phanLoaiDongPos` (thuần), rồi nối dòng vào sổ
// tiền QUA `BankTransaction{provider: CARD_POS}` và `thuTheoPhieuGop` — không có đường ghi
// tiền thứ hai.
//
// ─────────────────────────────────────────────────────────────────────────────
// BA ĐIỀU CỐ Ý, đừng "sửa":
//
//  1. KHÔNG gọi `ingestPayosWebhook` / `resolvePaymentTargetDetailed` / `allocateToOrder` /
//     `docMemo`. Khi `thuTheoPhieuGop` nhường (`xuLy: false`) thì đường webhook chạy tiếp ĐOÁN
//     theo SĐT / thác nước — trái luật "còn lại ⇒ CAN_XU_LY". Lưới `[POS-W1]`.
//  2. `thuTheoPhieuGop` nhận `noiDung` = ĐÚNG MỘT TOKEN mã do `tachMaPos` tách, KHÔNG phải cả
//     ghi chú: nó tự `docMemo` (cửa sổ trượt trên chuỗi đã bỏ dấu cách) và sẽ nhặt mã giả
//     ghép từ tên khách / dãy số. Lưới `[POS-W2]`.
//  3. KHÔNG BAO GIỜ tự đảo bút toán (Payment âm / gỡ phân bổ). Hủy sau khi đã ghi nhận ⇒ cờ
//     cảnh báo trên dòng gốc, kế toán gỡ gắn / hoàn bằng luồng hiện có rồi đóng cảnh báo.
//
// ─────────────────────────────────────────────────────────────────────────────
// KHÔNG `$transaction` Ở TẦNG NÀY. Mỗi phép ghi là một câu đơn, hoặc một `updateMany` CÓ ĐIỀU
// KIỆN trạng thái (`status: "UNMATCHED"`) — mẫu chống-đua của repo: hai lượt import cùng file
// chạy song song thì lượt vào sau đổi 0 dòng và đọc lại. Phần ghi tiền nằm TRỌN trong
// `thuTheoPhieuGop` (khoá đơn + khoá DÒNG giao dịch + đọc lại trạng thái trong khoá), nên nó
// chống trùng được mà không cần gói ngoài. Một dòng lỗi thì chỉ dòng đó vào `loi[]`.
//
// "ĐÃ GHI NHẬN" = `BankTransaction.status = MATCHED` (khớp máy hay gắn tay đều thế) — KHÔNG đọc
// `PosCardTransaction.matchStatus` (đó là kết quả lúc import, gắn tay sau không đổi nó).

import type { PosMatchStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { thuTheoPhieuGop } from "@/lib/finance/phieu-gop";
import { khoaGiaoDichTrongTx, TIEN_TO_GO_GAN } from "@/lib/finance/ghi-tien-don";
import {
  dongPosSchema,
  PROVIDER_THE_POS,
  type DongHuyPos,
  type DongPos,
  type KetQuaTienThe,
  type NguonDuLieuPos,
} from "./kieu";
import { anhTuDong, ghiNguonThay } from "./nguon-thay";
import { bamDong } from "./agent/bam";
import {
  CTX_XET_HUY,
  DUOI_CHAN_HOAN_MOT_PHAN,
  dongTuBanGhi,
  huyDaKetLuanTrenDong,
  laHuyToanPhanVoiGoc,
  LY_DO_CHAN_HOAN_MOT_PHAN,
  LY_DO_HOAN_MOT_PHAN,
  LY_DO_HOAN_XEM_GOC,
  LY_DO_HUY_TOAN_PHAN,
  phanLoaiDongPos,
  tinHieuHoanHuy,
  type PhanLoaiPos,
} from "./phan-loai-pos";
import { cotKetToanCapNhat, lechDaGhiNhan, type LechDong } from "./lech-da-ghi-nhan";
import type { KetQuaLoPos, KetQuaNhapLo } from "./ket-qua-lo";

/** Kiểu kết quả lô sống ở tầng THUẦN (`ket-qua-lo.ts`) — màn import cộng kết quả bằng chính nó. */
export type { KetQuaLoPos, KetQuaNhapLo } from "./ket-qua-lo";

type TrangThaiBt = "MATCHED" | "UNMATCHED" | "IGNORED";

type DongDaCo = {
  id: string;
  soTien: number;
  /** Trạng thái chữ của FILE lúc dòng được ghi — so lệch khi nhập lại (GĐ3, V5). */
  trangThai: string;
  matchStatus: PosMatchStatus;
  matchReason: string | null;
  trangThaiHoanHuy: string | null;
  /** Cột kết toán đã có — ô trống của file KHÔNG xoá chúng (GĐ3, V8). */
  maHachToan: string | null;
  phiGiaoDich: number | null;
  centerId: string | null;
  /** Máy của CHÍNH dòng này — dòng gốc được cập nhật từ một dòng hủy tra cơ sở theo nó. */
  maThietBi: string | null;
  canhBaoHuy: boolean;
  bankTransactionId: string | null;
  bankTransaction: GiaoDichDaCo | null;
};

/** Giao dịch thẻ đã có trong sổ (`BankTransaction{CARD_POS}`), đọc theo dòng POS HOẶC theo khoá. */
type GiaoDichDaCo = {
  id: string;
  status: TrangThaiBt;
  centerId: string | null;
  unmatchedNote: string | null;
};

/** Máy POS đã khai: cơ sở + TÊN cơ sở (in vào lý do chặn quẹt chéo). */
type May = { centerId: string; tenCoSo: string };

/** Tra máy (đang bật) theo mã thiết bị — cho dòng GỐC không nằm trong lô. */
type TraMay = (maThietBi: string | null) => Promise<May | undefined>;

/**
 * Kết luận cho MỘT dòng: dòng mới hay cập nhật, (nếu phân loại lại) trạng thái cuối, và KẾT QUẢ
 * TIỀN có cấu trúc [GĐ1 POS · 06/10/2026] cho người gọi ngoài lô (`khopGiaoDichThe`) — `nhapLoPos`
 * chỉ đếm `moi`/`trangThai`, không đọc `tien`. Dòng HỦY/HOÀN mang `tien: null`.
 */
export type KetLuanDong = { moi: boolean; trangThai: PosMatchStatus | null; tien: KetQuaTienThe | null };

/**
 * NGUỒN của một lượt ghi dòng [GĐ1 POS · 06/10/2026; GĐ4 POS · 07/10/2026 — T1]:
 *  · `LO_FILE`  — lô import file đang chạy: TẠO dòng (`importBatchId` = lô), mọi lượt chạm ghi `lastImportBatchId`;
 *  · `AGENT`    — lô của MÁY ĐỒNG BỘ (Chrome extension): TẠO dòng với `importBatchId` NULL — agent và file hội tụ
 *                 vào CÙNG một dòng theo `maGiaoDich` (file nhập SAU chỉ ghi `lastImportBatchId`);
 *  · `NGOAI_LO` — lượt KHÔNG từ file / agent (nút "Kiểm tra" của sale / poller — `khopGiaoDichThe`): dòng POS đã
 *                 có thì CẬP NHẬT (không chạm `lastImportBatchId`), chưa có thì KHÔNG TẠO; lượt nhập sau tạo nó và
 *                 đọc giao dịch theo KHOÁ (vá F3).
 * `nguonDuLieu` vào `BankTransaction.rawPayload.nguon` — D5: provider vẫn là MỘT (`CARD_POS`).
 *
 * `ghiLech` [GĐ3 POS · 06/10/2026, V6] — nơi gom LỆCH của dòng đã ghi nhận (số tiền / trạng thái file
 * khác thứ đã vào sổ). `nhapLoPos` gom để trả màn + ghi audit; lượt ngoài file (`khopGiaoDichThe`)
 * truyền `null` — nó không có "file" nào để lệch. BẮT BUỘC (luật 7): `tsc` liệt kê chỗ dựng.
 * Gộp GĐ3 × GĐ4 (07/10/2026): lô `AGENT` CŨNG gom — máy đồng bộ báo số tiền / trạng thái khác thứ đã vào sổ là
 * cùng một lệch (sổ không đổi, chỉ báo); `nhanGiaoDichAgent` ghi audit `POS_AGENT_LECH_DA_GHI_NHAN`. Chỉ
 * `NGOAI_LO` truyền `null`.
 */
type NguonGhi = (
  | { loai: "LO_FILE"; batchId: string; nguonDuLieu: "SMARTPOS" }
  | { loai: "AGENT"; nguonDuLieu: "TCB_PORTAL" }
  | { loai: "NGOAI_LO"; nguonDuLieu: NguonDuLieuPos }
) & { ghiLech: ((l: LechDong) => void) | null };

/** Báo mọi lệch của một phép so vào nơi gom của lượt (nếu có). */
function baoLech(nguon: NguonGhi, lech: readonly LechDong[]): void {
  if (!nguon.ghiLech) return;
  for (const l of lech) nguon.ghiLech(l);
}

/** `lastImportBatchId` chỉ ghi khi lượt này ĐẾN TỪ một lô import FILE. */
function cotLo(nguon: NguonGhi): { lastImportBatchId?: string } {
  return nguon.loai === "LO_FILE" ? { lastImportBatchId: nguon.batchId } : {};
}

const CHON_BT = {
  id: true,
  status: true,
  centerId: true,
  unmatchedNote: true,
} as const satisfies Prisma.BankTransactionSelect;

const CHON_DONG_DA_CO = {
  id: true,
  soTien: true,
  trangThai: true,
  matchStatus: true,
  matchReason: true,
  trangThaiHoanHuy: true,
  maHachToan: true,
  phiGiaoDich: true,
  centerId: true,
  maThietBi: true,
  canhBaoHuy: true,
  bankTransactionId: true,
  bankTransaction: { select: CHON_BT },
} as const satisfies Prisma.PosCardTransactionSelect;

const LY_DO_HUY_SAU_GHI_NHAN = "Giao dịch thẻ bị hủy sau khi đã ghi nhận";
const LY_DO_DA_GO_GAN = "Đã gỡ gắn — xử lý tay (import lại không tự khớp)";
/** Lý do TẠM ghi trước khi đi khớp (xem nhánh THU). Còn nằm lại khi giao dịch đã MATCHED = lượt
 *  trước lỗi GIỮA ghi tiền và câu ghi kết quả — import lại chữa (ca `[POS-DB-26]`). */
const TIEN_TO_DANG_KHOP = "Đang khớp phiếu ";

/** Hai tập mã gốc bị trỏ tới — tách TOÀN PHẦN khỏi MỘT PHẦN (luật 3 vs 4b). */
type TapHuy = { toanPhan: Set<string>; motPhan: Set<string> };

/** Ngữ cảnh luật 3/4b của một dòng thanh toán. */
type CtxHuy = { biHuyTrongLo: boolean; biHoanMotPhan: boolean };

/** Ngữ cảnh luật 3/4b của một dòng thanh toán, suy từ `TapHuy`. */
function ctxHuy(tap: TapHuy, maGiaoDich: string): CtxHuy {
  const biHuyTrongLo = tap.toanPhan.has(maGiaoDich);
  return { biHuyTrongLo, biHoanMotPhan: !biHuyTrongLo && tap.motPhan.has(maGiaoDich) };
}

/**
 * Gộp tín hiệu hủy ĐÃ LƯU trên chính dòng (`huyDaKetLuanTrenDong`) vào ngữ cảnh của lượt — ĐƠN ĐIỆU:
 * nhập lại không bao giờ GỠ được một kết luận "đã hủy/hoàn". Toàn phần thắng một phần (như `ctxHuy`).
 */
function gopHuyDaLuu(huy: CtxHuy, cu: DongDaCo | undefined): CtxHuy {
  const daLuu = cu ? huyDaKetLuanTrenDong(cu) : "TRONG";
  const biHuyTrongLo = huy.biHuyTrongLo || daLuu === "TOAN_PHAN";
  return { biHuyTrongLo, biHoanMotPhan: !biHuyTrongLo && (huy.biHoanMotPhan || daLuu === "MOT_PHAN") };
}

/**
 * Ghi MỘT dòng hủy/hoàn (đã qua `phanLoaiDongPos`) vào tập hủy của gốc nó trỏ tới. TOÀN PHẦN còn
 * phải ĐÚNG SỐ gốc khi biết số gốc (Q-G — `laHuyToanPhanVoiGoc`); không biết thì theo chữ. Dùng
 * chung cho `nhapLoPos` (gốc trong lô) và `khopGiaoDichThe` (gốc = chính giao dịch đang khớp).
 */
function ganVaoTapHuy(tap: TapHuy, p: PhanLoaiPos, soTienHuy: number, soTienGoc: number | undefined): void {
  if (!laHuy(p) || !p.maGoc) return;
  const toanPhan = soTienGoc !== undefined ? laHuyToanPhanVoiGoc(p, soTienHuy, soTienGoc) : p.toanPhan;
  (toanPhan ? tap.toanPhan : tap.motPhan).add(p.maGoc);
}

/**
 * `centerId` của dòng POS phải theo GIAO DỊCH khi giao dịch đã vào sổ (gắn tay vào đơn gán
 * `BankTransaction.centerId` = cơ sở của đơn). Để NULL thì dòng POS ∈ NULL_IS_GLOBAL_MODELS hiện
 * cho MỌI cơ sở — kèm mã đơn + tên khách qua select lồng (ca `[POS-DB-18]`).
 */
function dongBoCoSo(
  cu: { centerId: string | null },
  bt: { status: TrangThaiBt; centerId: string | null } | null,
): { centerId?: string } {
  return bt?.status === "MATCHED" && bt.centerId && bt.centerId !== cu.centerId ? { centerId: bt.centerId } : {};
}

/**
 * `centerId` theo MÁY cho một phép cập nhật dòng ĐÃ CÓ: chỉ khi máy đã khai VÀ dòng đang NULL —
 * không bao giờ đổi dòng đã có cơ sở (dòng đã vào sổ mang cơ sở của đơn qua `dongBoCoSo`).
 * `orgUnitId` do ghi kép (`update` có `centerId`) tự điền.
 *
 * Các nhánh "chỉ cập nhật kết toán" (dòng đã kết luận / đã khoá / vừa gỡ gắn) không đi qua
 * `ghiDong` nên không nhận `cotCoSo(may)`. Mã TRƯỚC bản vá: khai máy rồi import lại ⇒ dòng Hủy
 * đã BO_QUA vẫn NULL mãi, hiện cho MỌI cơ sở (NULL_IS_GLOBAL) — ca `[POS-THAT-DB-05]`.
 */
function coSoTheoMay(cu: { centerId: string | null }, may: May | undefined): { centerId?: string } {
  return may && cu.centerId === null ? { centerId: may.centerId } : {};
}

function coChu(s: string | null | undefined): boolean {
  return (s ?? "").trim() !== "";
}

/**
 * Cột GỐC của file → cột bảng. Không có tên chủ thẻ — `DongPos` vốn không mang nó. KHÔNG gồm ba cột kết
 * toán: dòng MỚI nhận chúng qua `cotKetToanTao`, dòng ĐÃ CÓ qua `cotKetToanCapNhat` (V8 — ô trống không
 * chạm cột; rà đối kháng GĐ3, ca `[POS3-DB-10]`).
 */
function cotGoc(d: DongPos) {
  return {
    loaiGiaoDich: d.loaiGiaoDich,
    hinhThuc: d.hinhThuc,
    trangThai: d.trangThai,
    soTien: d.soTien,
    thoiGianGiaoDich: new Date(d.thoiGian),
    dienGiai: d.dienGiai,
    maChuanChi: d.maChuanChi,
    maGiaoDichThe: d.maGiaoDichThe,
    maGiaoDichGoc: d.maGiaoDichGoc,
    maDonHang: d.maDonHang,
    maQuay: d.maQuay,
    maThietBi: d.maThietBi,
    soTheMasked: d.soTheMasked,
    loaiThe: d.loaiThe,
  };
}

/** Ba cột kết toán của dòng MỚI — giá trị file ghi thẳng (vế `create`, không có gì để giữ). */
function cotKetToanTao(d: DongPos) {
  return {
    maHachToan: d.maHachToan,
    phiGiaoDich: d.phiGiaoDich,
    trangThaiHoanHuy: d.trangThaiHoanHuy,
  };
}

/**
 * `centerId` + `orgUnitId` cho một phép GHI. Có cơ sở ⇒ để trống `orgUnitId`, cơ chế ghi kép
 * (`lib/org/dual-write.ts`) tự điền. KHÔNG có ⇒ ghi `null` CẢ HAI tường minh: ghi kép cố ý
 * không đụng `centerId: null`, nên thiếu vế `orgUnitId: null` là dòng mang cơ sở CŨ ở một cột.
 */
function cotCoSo(may: May | undefined): { centerId: string | null; orgUnitId?: null } {
  return may ? { centerId: may.centerId } : { centerId: null, orgUnitId: null };
}

function laHuy(p: PhanLoaiPos): p is Extract<PhanLoaiPos, { loai: "HUY" }> {
  return p.loai === "HUY";
}

function thongDiepLoi(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

/** Lô của MỘT lượt import FILE (`_pos-actions.ts`). GĐ3: `lo` = chỉ số lô trong lượt (từ 1), BẮT BUỘC (luật 7). */
type DauVaoLoFile = {
  batchId: string;
  lo: number;
  dong: DongPos[];
  dongHuyCuaFile: DongHuyPos[];
  nguoiNhapId: string;
};

/** Lô của MÁY ĐỒNG BỘ (GĐ4 — `nhanGiaoDichAgent`). Không thuộc lượt import nào ⇒ không `lo`. */
type DauVaoLoAgent = { posAgentId: string; now: Date; dong: DongPos[]; dongHuyCuaFile: readonly [] };

/**
 * Nhập một lô (≤ 300 dòng — action cắt lô). `dongHuyCuaFile` = các dòng Hủy/Hoàn của CẢ FILE
 * (bản tóm) trỏ vào dòng trong lô — một cặp Thanh toán + Hủy có thể rơi vào hai lô khác nhau.
 *
 * ⚠️ Nhận DÒNG chứ không nhận "danh sách mã gốc bị hủy": server tự phân loại từng dòng bằng
 * `phanLoaiDongPos`. Bản đầu tin danh sách mã do client tự tính (không xét "Thành công", không
 * phân biệt toàn phần) ⇒ một lần bấm hủy THẤT BẠI làm giao dịch đã thu tiền bị bỏ qua im lặng
 * (ca `[POS-DB-14]`).
 *
 * GĐ3 POS (06/10/2026): `lo` = CHỈ SỐ lô trong lượt (từ 1), BẮT BUỘC (luật 7). Số đếm của lượt +
 * `soLoXong` ghi trong MỘT câu có điều kiện `soLoXong < lo` ở cuối hàm ⇒ lô GỬI LẠI (trả lời bị mất trên
 * đường về) vẫn xử lý dòng — vốn idempotent — và vẫn trả kết quả cho màn, nhưng KHÔNG cộng vào lượt lần
 * hai (V11). Kết quả mang `lech`: dòng đã ghi nhận mà file ghi khác (V5–V7) — sổ không đổi, chỉ báo.
 * Và mang `soDemLuot`: số đếm của LƯỢT đọc lại sau câu đếm — màn hiện số này, nên lô gửi lại không làm
 * panel lệch lịch sử import (rà đối kháng GĐ3).
 *
 * GĐ4 POS (07/10/2026 — T1): nhánh đầu vào thứ hai `{ posAgentId, now, dong, dongHuyCuaFile: [] }` — lô của MÁY
 * ĐỒNG BỘ đi qua CHÍNH thân này (một phân loại, một luật hủy/hoàn, một `BankTransaction`). Thân không đổi (lưới
 * `[POS1-W3]`): chỉ NGUỒN quyết dòng có được tạo + có đếm lượt không.
 *
 * Gộp GĐ3 × GĐ4 (07/10/2026) — HAI chữ ký (overload) để kiểu trả nói thật: lô FILE ⇒ `KetQuaNhapLo` (có
 * `soDemLuot` đọc từ `PosImportBatch`); lô AGENT ⇒ `KetQuaLoPos` (có `lech`, KHÔNG `soDemLuot`). Mọi luật dòng của
 * GĐ3 (ô trống không xoá cột kết toán · dòng đã ghi nhận chỉ đổi cột kết toán · báo lệch · tín hiệu hủy đã lưu
 * đơn điệu · "Tự khớp" = chính lượt chia tiền) nằm ở THÂN DÒNG chung nên áp cho CẢ HAI nguồn. Số đếm lượt /
 * `soLoXong` / `soDemLuot` chỉ có nghĩa với lượt import (`PosImportBatch`): lô agent không có lượt nào để đếm —
 * chống xử lý lại của nó là băm dòng (T11) + lô chờ theo `syncId` (RV-04).
 */
export function nhapLoPos(input: DauVaoLoFile): Promise<KetQuaNhapLo>;
export function nhapLoPos(input: DauVaoLoAgent): Promise<KetQuaLoPos>;
export async function nhapLoPos(input: DauVaoLoFile | DauVaoLoAgent): Promise<KetQuaLoPos | KetQuaNhapLo> {
  // Cổng đứng TRƯỚC mọi phép ghi. `lo` < 1 làm câu đếm không bao giờ khớp — im lặng mất số đếm.
  if ("batchId" in input && (!Number.isInteger(input.lo) || input.lo < 1)) {
    throw new Error(`Chỉ số lô không hợp lệ: ${input.lo}`);
  }
  const kq: KetQuaLoPos = { moi: 0, capNhat: 0, tuKhop: 0, canXuLy: 0, boQua: 0, loi: [], lech: [] };

  // Trùng mã trong cùng lô ⇒ giữ dòng xuất hiện SAU (cùng luật với tầng đọc file).
  const theoMa = new Map<string, DongPos>();
  for (const d of input.dong) theoMa.set(d.maGiaoDich, d);
  const dong = [...theoMa.values()];
  const maTrongLo = [...theoMa.keys()];

  // ── MỘT câu đọc máy POS cho cả lô. Chỉ máy `active` mới tính là đã gán. ────────────
  const maThietBi = [...new Set(dong.map((d) => d.maThietBi?.trim()).filter((m): m is string => !!m))];
  const mayRows = maThietBi.length
    ? await db.posTerminal.findMany({
        where: { maThietBi: { in: maThietBi }, active: true },
        select: { maThietBi: true, centerId: true, center: { select: { name: true } } },
      })
    : [];
  const mayTheoMa = new Map<string, May>(
    mayRows.map((m) => [m.maThietBi, { centerId: m.centerId, tenCoSo: m.center.name }]),
  );
  const mayCua = (d: DongPos) => (d.maThietBi ? mayTheoMa.get(d.maThietBi.trim()) : undefined);

  // ── MỘT câu đọc dòng đã có theo mã giao dịch. ─────────────────────────────────────
  const daCoRows = await db.posCardTransaction.findMany({
    where: { maGiaoDich: { in: maTrongLo } },
    select: { maGiaoDich: true, ...CHON_DONG_DA_CO },
  });
  const daCo = new Map<string, DongDaCo>(daCoRows.map((r) => [r.maGiaoDich, r]));

  // ── MỘT câu đọc GIAO DỊCH theo KHOÁ (CARD_POS, mã) cho cả lô [vá F3 · GĐ1 POS 06/10/2026]. ──
  // Giao dịch có thể có mà dòng POS CHƯA có: lượt "Kiểm tra" của sale (`khopGiaoDichThe`) ghi giao
  // dịch mà không tạo dòng file. Bản trước chỉ đọc qua `cu?.bankTransaction` ⇒ cổng "vừa gỡ gắn"
  // bị bỏ qua và giao dịch kế toán đã gỡ TỰ KHỚP LẠI (ghi chú gỡ bị đè) — ca `[POS1-GG-02]`.
  const btRows = await db.bankTransaction.findMany({
    where: { provider: PROVIDER_THE_POS, providerTxnId: { in: maTrongLo } },
    select: { providerTxnId: true, ...CHON_BT },
  });
  const btTheoMa = new Map<string, GiaoDichDaCo>(
    btRows.map((r) => [
      r.providerTxnId,
      { id: r.id, status: r.status, centerId: r.centerId, unmatchedNote: r.unmatchedNote },
    ]),
  );
  // Lệch của dòng đã ghi nhận — khử trùng theo `mã|trường` (lượt xét lại không báo hai lần). Gom cho CẢ lô FILE
  // lẫn lô AGENT (gộp GĐ3 × GĐ4): máy đồng bộ ghi khác thứ đã vào sổ cũng là lệch phải báo.
  const lech = new Map<string, LechDong>();
  const gomLech = (l: LechDong) => lech.set(`${l.maGiaoDich}|${l.truong}`, l);
  const nguon: NguonGhi =
    "batchId" in input
      ? { loai: "LO_FILE", batchId: input.batchId, nguonDuLieu: "SMARTPOS", ghiLech: gomLech }
      : { loai: "AGENT", nguonDuLieu: "TCB_PORTAL", ghiLech: gomLech };

  // ── Tập mã gốc BỊ HỦY / HOÀN MỘT PHẦN: dòng hủy của cả file + trong lô + ĐÃ LƯU từ lần trước.
  //
  // MỌI nguồn đều đi qua `phanLoaiDongPos` (luật 1: chỉ dòng "Thành công" mới là HỦY) và tách
  // TOÀN PHẦN (gốc bị bỏ qua) khỏi MỘT PHẦN (gốc bị CHẶN — IGNORED + cảnh báo, Q-G 30/09;
  // ca `[POS-DB-15]`, `[POS-DB-27..29]`).
  //
  // ⚠️ Vế "đã lưu" không phải cho đẹp: cặp Thanh toán + Hủy cùng lô ⇒ gốc BO_QUA KHÔNG có
  // `BankTransaction`. Lần import sau chỉ chứa dòng gốc (file ngày khác) mà cột Hoàn/Hủy lại
  // trống thì dòng gốc "chưa khoá" ⇒ phân loại lại ⇒ THU ⇒ GHI TIỀN cho một giao dịch đã hủy.
  //
  // TOÀN PHẦN còn phải ĐÚNG SỐ gốc (Q-G: "dòng loại Hủy/Hoàn có số tiền ≠ −số gốc" là một phần)
  // — `laHuyToanPhanVoiGoc`. Chỉ gốc TRONG LÔ mới cần xếp (tập này chỉ phục vụ dòng thanh toán
  // của lô), nên số gốc luôn đọc được từ `theoMa`.
  const tapHuy: TapHuy = { toanPhan: new Set(), motPhan: new Set() };
  const ghiNhanHuy = (p: PhanLoaiPos, soTienHuy: number) =>
    ganVaoTapHuy(tapHuy, p, soTienHuy, laHuy(p) && p.maGoc ? theoMa.get(p.maGoc)?.soTien : undefined);
  for (const r of input.dongHuyCuaFile) ghiNhanHuy(phanLoaiDongPos(dongTuBanGhi(r), CTX_XET_HUY), r.soTien);
  const phanLoaiTho = new Map<string, PhanLoaiPos>();
  for (const d of dong) {
    const p = phanLoaiDongPos(d, { thietBiDaGan: !!mayCua(d), biHuyTrongLo: false, biHoanMotPhan: false });
    phanLoaiTho.set(d.maGiaoDich, p);
    ghiNhanHuy(p, d.soTien);
  }
  const maThanhToan = dong.filter((d) => !laHuy(phanLoaiTho.get(d.maGiaoDich)!)).map((d) => d.maGiaoDich);
  const huyDaLuu = maThanhToan.length
    ? await db.posCardTransaction.findMany({
        where: { maGiaoDichGoc: { in: maThanhToan } },
        select: {
          id: true,
          maGiaoDich: true,
          loaiGiaoDich: true,
          trangThai: true,
          soTien: true,
          maGiaoDichGoc: true,
          trangThaiHoanHuy: true,
          matchStatus: true,
          centerId: true,
          maThietBi: true,
        },
      })
    : [];
  for (const r of huyDaLuu) ghiNhanHuy(phanLoaiDongPos(dongTuBanGhi(r), CTX_XET_HUY), r.soTien);

  // Máy của dòng hủy ĐÃ LƯU (xét lại bên dưới) mà lô này không có — để đặt cơ sở cho dòng NULL.
  const mayThieu = [
    ...new Set(
      huyDaLuu
        .filter((r) => r.centerId === null && r.maThietBi && !mayTheoMa.has(r.maThietBi.trim()))
        .map((r) => r.maThietBi!.trim()),
    ),
  ];
  if (mayThieu.length) {
    const them = await db.posTerminal.findMany({
      where: { maThietBi: { in: mayThieu }, active: true },
      select: { maThietBi: true, centerId: true, center: { select: { name: true } } },
    });
    for (const m of them) mayTheoMa.set(m.maThietBi, { centerId: m.centerId, tenCoSo: m.center.name });
  }

  // Máy của dòng GỐC mà một dòng hủy/hoàn cập nhật — gốc có thể KHÔNG nằm trong lô (file ngày
  // khác), nên máy của nó không có sẵn ở trên. Tra một lần mỗi mã trong lượt, nhớ cả kết quả rỗng.
  // Chỉ gọi khi gốc đang NULL cơ sở (`xetDongHuy`). Dòng trong lô không đổi kết quả: máy của chúng
  // đã được tra bằng đúng điều kiện này ở câu đầu, nên tra lại chỉ ra rỗng như cũ.
  const daTraMay = new Set<string>();
  const traMay: TraMay = async (maThietBi) => {
    const ma = maThietBi?.trim();
    if (!ma) return undefined;
    const co = mayTheoMa.get(ma);
    if (co || daTraMay.has(ma)) return co;
    daTraMay.add(ma);
    const m = await db.posTerminal.findFirst({
      where: { maThietBi: ma, active: true },
      select: { centerId: true, center: { select: { name: true } } },
    });
    if (!m) return undefined;
    const may: May = { centerId: m.centerId, tenCoSo: m.center.name };
    mayTheoMa.set(ma, may);
    return may;
  };

  // ── Thanh toán TRƯỚC, Hủy SAU: dòng hủy phải thấy được gốc vừa ghi trong cùng lô. ──────
  const thuTu = [
    ...dong.filter((d) => !laHuy(phanLoaiTho.get(d.maGiaoDich)!)),
    ...dong.filter((d) => laHuy(phanLoaiTho.get(d.maGiaoDich)!)),
  ];

  for (const d of thuTu) {
    try {
      const pTho = phanLoaiTho.get(d.maGiaoDich)!;
      const cu = daCo.get(d.maGiaoDich);
      const ketLuan = laHuy(pTho)
        ? await xuLyDongHuy(d, pTho, cu, mayCua(d), nguon, traMay)
        : await xuLyDongThanhToan(
            d,
            cu,
            cu?.bankTransaction ?? btTheoMa.get(d.maGiaoDich) ?? null,
            mayCua(d),
            ctxHuy(tapHuy, d.maGiaoDich),
            nguon,
            0,
          );
      if (ketLuan.moi) kq.moi += 1;
      else kq.capNhat += 1;
      // "Tự khớp" = khớp MỚI ở lượt này (V13): chỉ khi CHÍNH lượt này chia tiền. Giao dịch đã vào sổ TRƯỚC
      // lượt (ca biên, TRUNG với lượt song song, hoàn một phần sau khi MATCHED) cũng ra TU_KHOP nhưng
      // chỉ vào Mới / Cập nhật — rà đối kháng GĐ3, ca `[POS3-DB-07]` `[POS3-DB-12]`.
      if (ketLuan.trangThai === "TU_KHOP") {
        if (ketLuan.tien?.loai === "DA_CHIA") kq.tuKhop += 1;
      } else if (ketLuan.trangThai === "CAN_XU_LY") kq.canXuLy += 1;
      else if (ketLuan.trangThai === "BO_QUA") kq.boQua += 1;
    } catch (err) {
      kq.loi.push({ maGiaoDich: d.maGiaoDich, loi: thongDiepLoi(err) });
    }
  }

  // ── XÉT LẠI dòng hủy ĐÃ LƯU đang chờ, trỏ vào gốc vừa xử lý ở lô này ────────────────
  // Dòng Hủy tới TRƯỚC gốc (file xếp giờ giảm dần ⇒ Hủy ở lô 1, gốc ở lô 2; hoặc import file
  // ngày sau trước file ngày trước) kẹt "Chưa thấy giao dịch gốc" dù gốc đã vào — ca
  // `[POS-DB-17]`. Không đếm vào kết quả lô: dòng đó không nằm trong lô này. Chỉ ghi
  // `matchStatus` + `matchReason` (+ cơ sở theo máy nếu dòng đang NULL), không đụng cột gốc.
  for (const r of huyDaLuu) {
    if (r.matchStatus !== "CAN_XU_LY" || theoMa.has(r.maGiaoDich)) continue;
    const dHuy = dongTuBanGhi(r);
    const p = phanLoaiDongPos(dHuy, CTX_XET_HUY);
    if (!laHuy(p)) continue;
    try {
      const mayHuy = r.maThietBi ? mayTheoMa.get(r.maThietBi.trim()) : undefined;
      await xetDongHuy(
        dHuy,
        p,
        async (matchStatus, matchReason) => {
          await db.posCardTransaction.update({
            where: { id: r.id },
            data: { matchStatus, matchReason, ...coSoTheoMay(r, mayHuy) },
          });
          return false;
        },
        traMay,
      );
    } catch (err) {
      kq.loi.push({ maGiaoDich: r.maGiaoDich, loi: thongDiepLoi(err) });
    }
  }

  kq.lech = [...lech.values()];

  // ── Lô của MÁY ĐỒNG BỘ dừng ở đây (gộp GĐ3 × GĐ4) ─────────────────────────────────
  // Không thuộc lượt import nào ⇒ KHÔNG số đếm lượt, KHÔNG `soLoXong`, KHÔNG dấu nguồn FILE, KHÔNG `soDemLuot`.
  // Lệch (`kq.lech`) đã gom ở trên — người gọi (`nhanGiaoDichAgent`) báo. Phép thu hẹp `input` ở đây là thứ cho
  // phép phần dưới đọc `input.batchId` / `input.lo`: đảo thứ tự ⇒ `tsc` đỏ (lô agent không thể đếm vào lượt nào).
  if (!("batchId" in input)) return kq;

  // ── SỐ ĐẾM của lượt + `soLoXong`: MỘT câu có điều kiện (GĐ3 POS, V11 + V12) ─────────────
  // Lô đã ghi rồi (màn gửi lại vì trả lời bị mất) ⇒ `soLoXong >= lo` ⇒ đổi 0 dòng: không đếm hai lần,
  // không chạm `updatedAt` (mốc "Dữ liệu Techcombank cập nhật lần cuối" của provider vẫn là lúc dữ
  // liệu THẬT SỰ vào). Mã TRƯỚC bản vá: `update` không điều kiện + `soDong += input.dong.length`, còn
  // `soLoXong` do action đặt ở một câu riêng ⇒ lô gửi lại cộng số đếm lần hai, và `soDong` đếm cả dòng
  // trùng mã đã bị khử ở trên.
  //
  // Nghĩa từng ô (V13 — giữ nghĩa của lượt cũ): `soDong` = dòng DUY NHẤT của các lô đã đếm, `soMoi +
  // soCapNhat + soLoi = soDong` (trừ lỗi của dòng hủy ĐÃ LƯU được xét lại ở vòng trên — dòng đó không
  // nằm trong lô); `soTuKhop` = khớp MỚI ở lượt này; `soCanXuLy` / `soBoQua` = kết luận
  // của dòng được XÉT LẠI ở lượt này (dòng chưa khoá — nhập lại thì đếm lại); dòng đã khoá và dòng hủy
  // đã kết luận chỉ vào `soCapNhat`.
  await db.posImportBatch.updateMany({
    where: { id: input.batchId, soLoXong: { lt: input.lo } },
    data: {
      soLoXong: input.lo,
      soDong: { increment: dong.length },
      soMoi: { increment: kq.moi },
      soCapNhat: { increment: kq.capNhat },
      soTuKhop: { increment: kq.tuKhop },
      soCanXuLy: { increment: kq.canXuLy },
      soBoQua: { increment: kq.boQua },
      soLoi: { increment: kq.loi.length },
    },
  });

  // GĐ4 POS (T13) — dấu "FILE đã thấy" cho GĐ6 đối chiếu agent ↔ file. Chỉ dòng KHÔNG lỗi (dòng lỗi được thử
  // lại ở lượt nhập sau). Đồng hồ ở đây CHỈ đóng dấu mốc thấy, không quyết luật nào. Chẩn đoán, không phải sổ
  // tiền: lỗi ghi dấu KHÔNG làm hỏng lô tiền đã ghi (khuôn nhật ký kiểm GĐ2 U4). Lô GỬI LẠI (câu đếm trên đổi
  // 0 dòng) vẫn đóng dấu: "file đã thấy" là sự thật của lần xử lý, không phải số đếm.
  const loi = new Set(kq.loi.map((l) => l.maGiaoDich));
  try {
    await ghiNguonThay({
      nguon: "FILE",
      posAgentId: null,
      importBatchId: input.batchId,
      dong: dong
        .filter((d) => !loi.has(d.maGiaoDich))
        .map((d) => ({
          maGiaoDich: d.maGiaoDich,
          bam: bamDong({ d, maKetToan: null, maLyDoThatBai: null }),
          anh: anhTuDong(d, null),
          tuChoi: null,
          centerId: mayCua(d)?.centerId ?? null,
        })),
      now: new Date(),
    });
  } catch (err) {
    console.error(`[pos] ghi dấu nguồn FILE lỗi (lô ${input.batchId}):`, err);
  }

  // Số đếm của LƯỢT sau lô này — thứ lịch sử import in ra. Màn hiện ĐÚNG số này (`tongLuotSauLo`), không
  // cộng kết quả từng lô: lô gửi lại (câu trên đổi 0 dòng) trả kết quả của lần xử lý lại, khác số đã đếm.
  const luot = await db.posImportBatch.findUniqueOrThrow({
    where: { id: input.batchId },
    select: { soMoi: true, soCapNhat: true, soTuKhop: true, soCanXuLy: true, soBoQua: true },
  });
  return {
    ...kq,
    soDemLuot: {
      moi: luot.soMoi,
      capNhat: luot.soCapNhat,
      tuKhop: luot.soTuKhop,
      canXuLy: luot.soCanXuLy,
      boQua: luot.soBoQua,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DÒNG THANH TOÁN
// ─────────────────────────────────────────────────────────────────────────────

async function xuLyDongThanhToan(
  d: DongPos,
  cu: DongDaCo | undefined,
  /**
   * Giao dịch thẻ của mã này — TƯỜNG MINH, BẮT BUỘC (luật 7) [vá F3]: dòng POS chưa có KHÔNG có
   * nghĩa giao dịch chưa có. Người gọi đọc theo khoá `(CARD_POS, maGiaoDich)`.
   */
  bt: GiaoDichDaCo | null,
  may: May | undefined,
  huy: { biHuyTrongLo: boolean; biHoanMotPhan: boolean },
  nguon: NguonGhi,
  /** 0 ở lượt đầu; 1 khi đang xét lại sau khi đọc lại giao dịch dưới khoá (chặn đệ quy). */
  lanXetLai: number,
): Promise<KetLuanDong> {
  const { biHuyTrongLo } = huy;

  // ── ĐÃ KHOÁ: giao dịch đã ra khỏi hàng chờ (khớp máy / gắn tay / bỏ qua). Luật 7: chỉ cập
  // nhật cột kết toán, KHÔNG phân loại + khớp lại (import lại là việc thường ngày: file ngày
  // hôm sau có thêm Mã hạch toán + Phí).
  //
  // GĐ3 POS (06/10/2026): (1) dòng ĐÃ GHI NHẬN (giao dịch MATCHED) mà file ghi số tiền / trạng thái
  // KHÁC dòng đã lưu ⇒ KHÔNG đổi (sổ và dòng giữ nguyên) nhưng BÁO lệch — bản trước bỏ qua im lặng (V5,
  // V7-i). Giao dịch đã BỎ QUA không báo: không có tiền trong sổ để gỡ gắn / hoàn. Chỉ ở lượt đầu: lượt
  // đệ quy xét lại (`[V3-41]`) không báo hai lần. (2) Cột kết toán qua `cotKetToanCapNhat`: ô TRỐNG không
  // xoá giá trị đã có (V8) — bản trước ghi thẳng `d.x` nên nhập lại file ngày đầu xoá Mã hạch toán, Phí
  // và cả tín hiệu hủy mà provider đọc.
  if (cu && (bt ? bt.status !== "UNMATCHED" : cu.matchStatus === "TU_KHOP")) {
    if (lanXetLai === 0 && bt?.status === "MATCHED") {
      baoLech(nguon, lechDaGhiNhan(d.maGiaoDich, { soTien: cu.soTien, trangThai: cu.trangThai }, d));
    }
    // Cảnh báo chỉ bật khi tin hủy/hoàn là MỚI: bị hủy toàn phần trong lô, hoặc cột Hoàn/Hủy
    // vừa có giá trị. Cột đã có giá trị từ lượt trước không phải tin mới — bật mỗi lần import là
    // cảnh báo giả (gốc bị chặn vì hoàn một phần thì cảnh báo đã bật ở lượt chặn). Dòng hủy/hoàn
    // MỚI tự bật (và mở lại) cảnh báo ở `xetDongHuy`.
    const biHuy = biHuyTrongLo || (coChu(d.trangThaiHoanHuy) && !coChu(cu.trangThaiHoanHuy));
    const batCanhBao = bt?.status === "MATCHED" && biHuy && !cu.canhBaoHuy;
    // Lượt trước ghi tiền XONG rồi lỗi ở câu ghi kết quả ⇒ dòng POS kẹt "Đang khớp phiếu …"
    // trong khi giao dịch đã MATCHED. Chữa về TU_KHOP — không đi khớp lại (giao dịch đã khoá).
    const ketQuaKet =
      bt?.status === "MATCHED" && cu.matchStatus === "CAN_XU_LY" && (cu.matchReason ?? "").startsWith(TIEN_TO_DANG_KHOP);
    const lyDoNen = ketQuaKet ? "Đã ghi nhận" : cu.matchReason;
    await db.posCardTransaction.update({
      where: { id: cu.id },
      data: {
        ...cotKetToanCapNhat(d),
        ...cotLo(nguon),
        ...coSoTheoMay(cu, may),
        ...dongBoCoSo(cu, bt),
        ...(ketQuaKet ? { matchStatus: "TU_KHOP" as const, matchReason: lyDoNen } : {}),
        ...(batCanhBao ? { canhBaoHuy: true, matchReason: noiLyDo(lyDoNen, LY_DO_HUY_SAU_GHI_NHAN) } : {}),
      },
    });
    // ĐUA với một lượt GỠ GẮN (rà vòng 4, ca `[V3-41]` — nhánh anh em của `[V3-40]`): `bt` là ẢNH
    // CHỤP ĐẦU LÔ. Lượt gỡ đọc tín hiệu hủy/hoàn (cột của gốc) TRONG khoá dòng giao dịch; nó có thể
    // đã đọc lúc cột còn trống rồi commit UNMATCHED giữa lúc lô chạy. Dòng mang tín hiệu ⇒ SAU khi
    // ghi cột, đọc lại giao dịch DƯỚI CÙNG khoá: thấy UNMATCHED ⇒ xét lại như chưa khoá (BO_QUA ⇒
    // IGNORED, một phần ⇒ chặn). Thiếu bước này: tiền đã hoàn về thẻ mà giao dịch nằm lại hàng chờ
    // đủ số gộp, gắn tay lại được.
    const coTinHieu = biHuy || huy.biHoanMotPhan || tinHieuHoanHuy(d.trangThaiHoanHuy) !== "TRONG";
    if (bt?.status === "MATCHED" && coTinHieu && lanXetLai === 0) {
      const sau = await db.$transaction(async (tx) => {
        await khoaGiaoDichTrongTx(tx, bt.id);
        return tx.bankTransaction.findUnique({ where: { id: bt.id }, select: { status: true } });
      });
      if (sau?.status === "UNMATCHED") {
        const cuMoi = await db.posCardTransaction.findUnique({ where: { id: cu.id }, select: CHON_DONG_DA_CO });
        const btMoi = await db.bankTransaction.findUnique({ where: { id: bt.id }, select: CHON_BT });
        if (cuMoi) return xuLyDongThanhToan(d, cuMoi, btMoi, may, huy, nguon, lanXetLai + 1);
      }
    }
    return {
      moi: false,
      trangThai: null,
      tien: {
        loai: "DA_KHOA",
        btId: bt?.id ?? null,
        trangThaiBt: bt && bt.status !== "UNMATCHED" ? bt.status : null,
        // D7 — tiền ĐÃ vào sổ mà dữ liệu nay nói đã hủy/hoàn: KHÔNG tự đảo (cảnh báo kế toán ở trên),
        // nhưng người gọi (phiếu POS) phải biết để không báo xanh.
        huySauGhiNhan: bt?.status === "MATCHED" && coTinHieu,
      },
    };
  }

  // ── CHƯA KHOÁ ⇒ phân loại lại. Tín hiệu hủy = file ∪ tập hủy của lô ∪ tín hiệu ĐÃ LƯU trên chính dòng
  // (rà đối kháng GĐ3 · 06/10/2026). Mã TRƯỚC bản vá: `phanLoaiDongPos(d, { thietBiDaGan: !!may, ...huy })`
  // — bản xuất CŨ hơn (cột Hoàn/Hủy trống, dòng Hủy chưa có / chưa lưu) lật dòng đã kết luận "đã hủy"
  // thành THU và GHI TIỀN (ca `[POS3-DB-10]`, `[POS3-DB-10b]`). Dòng đã khoá không qua đây: tín hiệu
  // gộp chỉ đổi PHÂN LOẠI LẠI, không đổi D7 ("tin hủy MỚI" vẫn đọc file).
  const huyGop = gopHuyDaLuu(huy, cu);
  const p = phanLoaiDongPos(d, { thietBiDaGan: !!may, ...huyGop });

  if (p.loai === "BO_QUA") {
    // Giao dịch cũ còn trong hàng chờ ⇒ đưa ra (IGNORED). Đã khớp ⇒ không đụng tiền, chỉ
    // bật cảnh báo nếu lý do bỏ qua là bị hủy/hoàn.
    let canhBao = false;
    if (bt) {
      const doi = await boQuaGiaoDich(bt, `Bỏ qua tự động (import POS): ${p.lyDo}`, may);
      if (!doi) {
        const lai = await db.bankTransaction.findUnique({ where: { id: bt.id }, select: { status: true } });
        canhBao =
          lai?.status === "MATCHED" && (coChu(d.trangThaiHoanHuy) || huyGop.biHuyTrongLo) && !cu?.canhBaoHuy;
      }
    }
    const moi = await ghiDong(d, cu, may, nguon, {
      matchStatus: "BO_QUA",
      matchReason: canhBao ? LY_DO_HUY_SAU_GHI_NHAN : p.lyDo,
      ...(canhBao ? { canhBaoHuy: true } : {}),
    });
    return { moi, trangThai: "BO_QUA", tien: { loai: "BO_QUA", btId: bt?.id ?? null, lyDo: p.lyDo } };
  }

  // ── HOÀN / HỦY MỘT PHẦN (Q-G 30/09/2026: "chặn tự động"). Đứng TRƯỚC nhánh "vừa gỡ gắn": giao
  // dịch gỡ khỏi đơn mà đã bị hoàn một phần thì số của nó là số GỘP — để UNMATCHED là mời gắn
  // tay lại đúng số sai.
  if (p.loai === "CHAN_HOAN_MOT_PHAN") {
    return chanHoanMotPhan(d, cu, may, nguon, p.lyDo);
  }

  // ── GIAO DỊCH VỪA ĐƯỢC GỠ GẮN: kế toán đã rút nó khỏi đơn (kèm lý do) — KHÔNG tự khớp lại,
  // KHÔNG ghi đè lý do gỡ. Chỉ cập nhật cột kết toán và đồng bộ dòng POS về "cần xử lý".
  // Trước bản vá dòng POS vẫn TU_KHOP trong khi giao dịch đã UNMATCHED, và lần import sau xoá
  // lý do gỡ rồi ghi "[PHIEU_KHONG_MO] … ĐÃ THU ĐỦ" (câu sai) vào chỗ đó — ca `[POS-DB-20]`.
  if (bt?.status === "UNMATCHED" && (bt.unmatchedNote ?? "").startsWith(TIEN_TO_GO_GAN)) {
    const tien: KetQuaTienThe = {
      loai: "CHO_TAY",
      btId: bt.id,
      lyDo: "KHAC",
      ghiChu: LY_DO_DA_GO_GAN,
      conPhaiThu: null,
    };
    if (!cu) {
      // [vá F3] Giao dịch có (vừa gỡ gắn) mà dòng POS chưa có ⇒ tạo dòng CAN_XU_LY nối giao dịch (khi
      // có lô) — KHÔNG phân loại + khớp, KHÔNG đè lý do gỡ. Mã TRƯỚC bản vá đòi `cu &&` ở cổng này.
      const moi = await ghiDong(d, cu, may, nguon, {
        matchStatus: "CAN_XU_LY",
        matchReason: LY_DO_DA_GO_GAN,
        bankTransactionId: bt.id,
      });
      return { moi, trangThai: "CAN_XU_LY", tien };
    }
    await db.posCardTransaction.update({
      where: { id: cu.id },
      data: {
        // GĐ3 (V8): ô trống của file KHÔNG xoá cột kết toán / tín hiệu hủy đã có.
        ...cotKetToanCapNhat(d),
        ...cotLo(nguon),
        ...coSoTheoMay(cu, may),
        matchStatus: "CAN_XU_LY",
        matchReason: LY_DO_DA_GO_GAN,
      },
    });
    return { moi: false, trangThai: "CAN_XU_LY", tien };
  }

  if (p.loai === "CAN_XU_LY" && !p.taoGiaoDich) {
    const moi = await ghiDong(d, cu, may, nguon, { matchStatus: "CAN_XU_LY", matchReason: p.lyDo });
    return {
      moi,
      trangThai: "CAN_XU_LY",
      tien: { loai: "CHO_TAY", btId: bt?.id ?? null, lyDo: "KHAC", ghiChu: p.lyDo, conPhaiThu: null },
    };
  }

  if (p.loai === "HUY") {
    // Không xảy ra: người gọi đã tách dòng hủy. Giữ nhánh để `switch` đủ trường hợp.
    throw new Error("Dòng hủy đi nhầm vào nhánh thanh toán");
  }

  // ── CẦN GIAO DỊCH trong sổ (CAN_XU_LY để gắn tay được, hoặc THU đi khớp) ────────────
  const gd = await damBaoGiaoDich(d, may, p.loai === "CAN_XU_LY" ? p.lyDo : null, nguon.nguonDuLieu);

  if (gd.status !== "UNMATCHED") {
    // Giao dịch đã tồn tại và đã ra khỏi hàng chờ (dòng POS từng bị mất / đua với lượt khác / nút
    // "Kiểm tra" với provider không phải file ghi trước). `damBaoGiaoDich` KHÔNG đụng nó — sổ giữ số đã
    // ghi; dòng POS vẫn mang số của FILE (nó là bản ghi của file — sửa theo sổ là làm giả file).
    // GĐ3 (V7-ii): giao dịch ĐÃ GHI NHẬN mà số của file khác số trong sổ ⇒ BÁO lệch. Giao dịch không có
    // trạng thái chữ ⇒ chỉ so số. Đã bỏ qua (IGNORED) ⇒ không tiền trong sổ ⇒ không báo.
    if (gd.status === "MATCHED") {
      baoLech(nguon, lechDaGhiNhan(d.maGiaoDich, { soTien: gd.amount, trangThai: null }, d));
    }
    const trangThai: PosMatchStatus = gd.status === "MATCHED" ? "TU_KHOP" : "BO_QUA";
    const moi = await ghiDong(d, cu, may, nguon, {
      matchStatus: trangThai,
      matchReason: gd.status === "MATCHED" ? "Đã ghi nhận" : "Giao dịch đã được bỏ qua",
      bankTransactionId: gd.id,
    });
    // Phân loại đã qua mọi cổng hủy/hoàn ở trên ⇒ không có tín hiệu hủy sau ghi nhận.
    return { moi, trangThai, tien: { loai: "DA_KHOA", btId: gd.id, trangThaiBt: gd.status, huySauGhiNhan: false } };
  }

  if (p.loai === "CAN_XU_LY") {
    const moi = await ghiDong(d, cu, may, nguon, {
      matchStatus: "CAN_XU_LY",
      matchReason: p.lyDo,
      bankTransactionId: gd.id,
    });
    return {
      moi,
      trangThai: "CAN_XU_LY",
      tien: { loai: "CHO_TAY", btId: gd.id, lyDo: "KHAC", ghiChu: p.lyDo, conPhaiThu: null },
    };
  }

  // ── THU: đúng MỘT token mã ⇒ `thuTheoPhieuGop`, NGOÀI mọi transaction. ───────────────
  // Ghi dòng POS (nối giao dịch) TRƯỚC khi đi khớp: khớp xong mà ghi dòng lỗi thì lần import
  // sau vẫn thấy giao dịch qua `bankTransactionId` và đọc ra MATCHED — không khớp lần hai.
  const ma = p.ma;

  // ── CHẶN QUẸT CHÉO (chủ dự án chốt Q-E 29/09/2026: "không có trường hợp đó xảy ra nên chặn
  // quẹt chéo luôn"). Mã là phiếu của đơn ở cơ sở KHÁC cơ sở của máy ⇒ KHÔNG gọi
  // `thuTheoPhieuGop`, để giao dịch UNMATCHED trong hàng chờ — người quyết bằng gắn tay.
  // Tra KHÔNG scope (tầng này không có actor) và theo ĐÚNG token mã: với một token 5 ký tự,
  // tập ứng viên `thuTheoPhieuGop` tự dựng cũng chỉ có đúng token ấy. Máy không có (không thể
  // tới đây — luật 5) thì `null` ≠ mọi cơ sở ⇒ chặn: fail-closed.
  // Lý do KHÔNG in tên khách / mã đơn: nó nằm trên dòng thuộc cơ sở của MÁY.
  const phieuCuaMa = await db.paymentBill.findFirst({
    where: { matchKey: ma },
    select: { order: { select: { centerId: true } } },
  });
  if (phieuCuaMa && phieuCuaMa.order.centerId !== (may?.centerId ?? null)) {
    const lyDoCheo =
      `Máy POS thuộc ${may?.tenCoSo ?? "(chưa gán cơ sở)"} nhưng mã ${ma} là phiếu của đơn ở cơ sở ` +
      `khác — không tự khớp quẹt chéo`;
    await db.bankTransaction.updateMany({
      where: { id: gd.id, status: "UNMATCHED" },
      data: { unmatchedNote: lyDoCheo },
    });
    const moiCheo = await ghiDong(d, cu, may, nguon, {
      matchStatus: "CAN_XU_LY",
      matchReason: lyDoCheo,
      maPhieu: ma,
      bankTransactionId: gd.id,
    });
    return {
      moi: moiCheo,
      trangThai: "CAN_XU_LY",
      tien: { loai: "CHO_TAY", btId: gd.id, lyDo: "KHAC", ghiChu: lyDoCheo, conPhaiThu: null },
    };
  }

  const moi = await ghiDong(d, cu, may, nguon, {
    matchStatus: "CAN_XU_LY",
    matchReason: `${TIEN_TO_DANG_KHOP}${ma}`,
    maPhieu: ma,
    bankTransactionId: gd.id,
  });

  const r = await thuTheoPhieuGop({
    bankTransactionId: gd.id,
    provider: PROVIDER_THE_POS,
    providerTxnId: d.maGiaoDich,
    noiDung: ma,
    soTienVe: d.soTien,
    ngayThu: new Date(d.thoiGian),
  });

  let trangThai: PosMatchStatus;
  let lyDo: string;
  let tien: KetQuaTienThe;
  if (!r.xuLy) {
    trangThai = "CAN_XU_LY";
    lyDo = `Mã ${ma} không tra ra phiếu thu nào`;
    tien = { loai: "CHO_TAY", btId: gd.id, lyDo: "KHAC", ghiChu: lyDo, conPhaiThu: null };
    await db.bankTransaction.updateMany({
      where: { id: gd.id, status: "UNMATCHED" },
      data: { unmatchedNote: lyDo },
    });
  } else if (r.ketQua === "DA_CHIA") {
    trangThai = "TU_KHOP";
    lyDo = `Khớp phiếu ${ma}`;
    tien = { loai: "DA_CHIA", btId: gd.id, billId: r.billId, orderId: r.orderId };
  } else if (r.ketQua === "CHUA_CHIA") {
    trangThai = "CAN_XU_LY";
    lyDo = r.ghiChu;
    // LECH_SO giữ nguyên nghĩa "lệch số" (phiếu POS: LECH_TIEN) — không gộp vào lý do khác.
    tien = {
      loai: "CHO_TAY",
      btId: gd.id,
      lyDo: r.lyDo === "LECH_SO" ? "LECH_SO" : "KHAC",
      ghiChu: r.ghiChu,
      conPhaiThu: r.conPhaiThu,
    };
  } else {
    // TRUNG — giao dịch đã rời hàng chờ giữa chừng (lượt import song song / gắn tay / nút Kiểm tra).
    const lai = await db.bankTransaction.findUnique({ where: { id: gd.id }, select: { status: true } });
    if (lai?.status === "MATCHED") {
      trangThai = "TU_KHOP";
      lyDo = `Khớp phiếu ${ma}`;
      tien = { loai: "DA_KHOA", btId: gd.id, trangThaiBt: "MATCHED", huySauGhiNhan: false };
    } else if (lai?.status === "IGNORED") {
      trangThai = "BO_QUA";
      lyDo = "Giao dịch đã được bỏ qua";
      tien = { loai: "DA_KHOA", btId: gd.id, trangThaiBt: "IGNORED", huySauGhiNhan: false };
    } else {
      trangThai = "CAN_XU_LY";
      lyDo = `Mã ${ma}: chưa ghi nhận được, xử lý tay`;
      tien = { loai: "CHO_TAY", btId: gd.id, lyDo: "KHAC", ghiChu: lyDo, conPhaiThu: null };
    }
  }

  // `updateMany` (không `update`): lượt NGOÀI lô có thể chưa có dòng POS — đổi 0 dòng, vô hại.
  await db.posCardTransaction.updateMany({
    where: { maGiaoDich: d.maGiaoDich },
    data: { matchStatus: trangThai, matchReason: lyDo },
  });
  return { moi, trangThai, tien };
}

/**
 * PHẦN DÙNG CHUNG — cửa vào MỘT giao dịch thẻ cho mọi nguồn NGOÀI lô import (nút "Kiểm tra" của
 * sale · poller · agent) [GĐ1 POS · 06/10/2026, thiết kế §3]. Chạy ĐÚNG thân dòng của `nhapLoPos`
 * (`xuLyDongThanhToan`): phân loại → cổng đã khoá / bỏ qua / hoàn một phần / vừa gỡ gắn →
 * `damBaoGiaoDich` → Q-E → `thuTheoPhieuGop`. KHÔNG có đường ghi tiền thứ hai (lưới `[POS1-W1]`,
 * `[POS1-W2]`, và `[POS-W1]`/`[POS-W2]` gốc xanh nguyên văn).
 *
 * KHÔNG `$transaction` ở tầng này (như `nhapLoPos`) — khoá nằm trong `thuTheoPhieuGop` (khoá đơn →
 * khoá dòng giao dịch → đọc lại trạng thái trong khoá), nên nút ‖ poller ‖ import cùng một giao dịch
 * chỉ rót MỘT lần (`[POS1-RACE-01]`). Giao dịch đọc theo KHOÁ `(CARD_POS, mã)` khi dòng POS chưa có
 * (vá F3); tập hủy là các dòng hủy ĐÃ LƯU trỏ vào chính giao dịch này.
 *
 * `d` đi qua `dongPosSchema` (che số thẻ — lưới cuối). Dòng HỦY/HOÀN không vào đây (ném).
 */
export async function khopGiaoDichThe(input: { d: DongPos; nguonDuLieu: NguonDuLieuPos }): Promise<KetLuanDong> {
  const d = dongPosSchema.parse(input.d);
  if (laHuy(phanLoaiDongPos(d, CTX_XET_HUY))) throw new Error("Dòng hủy/hoàn không đi khớp tiền");

  const cu =
    (await db.posCardTransaction.findUnique({ where: { maGiaoDich: d.maGiaoDich }, select: CHON_DONG_DA_CO })) ??
    undefined;
  const bt =
    cu?.bankTransaction ??
    (await db.bankTransaction.findUnique({
      where: { provider_providerTxnId: { provider: PROVIDER_THE_POS, providerTxnId: d.maGiaoDich } },
      select: CHON_BT,
    }));

  // ── IMPORT ĐÃ KẾT LUẬN BO_QUA (rà đối kháng 06/10/2026) ── Dòng POS đã có, KHÔNG có giao dịch, và
  // lượt import đã xếp BO_QUA: kết luận đó được đưa ra với tập hủy của CẢ FILE (`dongHuyCuaFile` —
  // dòng Hủy có thể còn nằm ở lô SAU, chưa lưu). Lượt NGOÀI lô chỉ thấy hủy ĐÃ LƯU ⇒ phân loại lại ở
  // đây là ghi tiền cho một lần quẹt đã hủy khi sale bấm Kiểm tra GIỮA hai lô (`[POS1-VA-DB-05]`).
  // Coi như đã khoá: chỉ đọc trạng thái. Import lại (có `batchId`) vẫn xét lại như cũ.
  if (cu && !bt && cu.matchStatus === "BO_QUA") {
    return {
      moi: false,
      trangThai: null,
      tien: { loai: "BO_QUA", btId: null, lyDo: cu.matchReason ?? LY_DO_HUY_TOAN_PHAN },
    };
  }

  const maMay = d.maThietBi?.trim();
  const mayRow = maMay
    ? await db.posTerminal.findFirst({
        where: { maThietBi: maMay, active: true },
        select: { centerId: true, center: { select: { name: true } } },
      })
    : null;
  const may: May | undefined = mayRow ? { centerId: mayRow.centerId, tenCoSo: mayRow.center.name } : undefined;

  const huyDaLuu = await db.posCardTransaction.findMany({
    where: { maGiaoDichGoc: d.maGiaoDich },
    select: {
      maGiaoDich: true,
      loaiGiaoDich: true,
      trangThai: true,
      soTien: true,
      maGiaoDichGoc: true,
      trangThaiHoanHuy: true,
    },
  });
  const tap: TapHuy = { toanPhan: new Set(), motPhan: new Set() };
  for (const r of huyDaLuu) ganVaoTapHuy(tap, phanLoaiDongPos(dongTuBanGhi(r), CTX_XET_HUY), r.soTien, d.soTien);

  return xuLyDongThanhToan(
    d,
    cu,
    bt ?? null,
    may,
    ctxHuy(tap, d.maGiaoDich),
    // GĐ3: lượt ngoài file / agent không có "file" nào để lệch — không gom lệch.
    { loai: "NGOAI_LO", nguonDuLieu: input.nguonDuLieu, ghiLech: null },
    0,
  );
}

/**
 * Dòng thanh toán mang tín hiệu hoàn/hủy MỘT PHẦN (cột Hoàn/Hủy, hoặc một dòng hoàn một phần
 * trỏ tới) — Q-G 30/09/2026. Bảo đảm có giao dịch (dấu vết tiền thật), rồi:
 *   · giao dịch còn UNMATCHED ⇒ IGNORED (`updateMany` CÓ ĐIỀU KIỆN) + dòng POS CAN_XU_LY + cảnh
 *     báo. KHÔNG ai gắn tay được số gộp (`ganTienTheoCon` từ chối giao dịch IGNORED).
 *   · đổi 0 dòng / giao dịch đã MATCHED ⇒ như hủy sau khi đã ghi nhận: cảnh báo, không đảo.
 *   · giao dịch đã IGNORED vì lý do khác ⇒ BO_QUA như nhánh "giao dịch đã được bỏ qua".
 */
async function chanHoanMotPhan(
  d: DongPos,
  cu: DongDaCo | undefined,
  may: May | undefined,
  nguon: NguonGhi,
  lyDo: string,
): Promise<KetLuanDong> {
  // `lyDo: null` — không ghi đè ghi chú đang có (vd lý do gỡ gắn); ghi chú chặn ghi ở bước dưới.
  const gd = await damBaoGiaoDich(d, may, null, nguon.nguonDuLieu);
  let trangThai = gd.status;
  if (trangThai === "UNMATCHED") {
    const cuNote = cu?.bankTransaction?.id === gd.id ? cu.bankTransaction.unmatchedNote : null;
    const doi = await db.bankTransaction.updateMany({
      where: { id: gd.id, status: "UNMATCHED" },
      data: {
        status: "IGNORED",
        // Giữ lý do GỠ GẮN của kế toán (nếu có) — nối, không ghi đè.
        unmatchedNote: (cuNote ?? "").startsWith(TIEN_TO_GO_GAN) ? noiLyDo(cuNote, lyDo) : lyDo,
      },
    });
    if (doi.count > 0) {
      // Giao dịch này có thể vừa được GỠ GẮN (chưa có tín hiệu): Q-M (30/09/2026) — lượt gỡ gắn thẻ đã
      // ĐÓNG mọi phiếu gộp nó chạm, không mở lại ⇒ tín hiệu hoàn tới SAU không còn phiếu nào phải đóng
      // (`[V6-M04]`). Bản vòng 5 đóng lại ở đây bằng `dongPhieuMoLaiKhiHoanSauGo` — đã gỡ, xem docs.
      const moi = await ghiDong(d, cu, may, nguon, {
        matchStatus: "CAN_XU_LY",
        matchReason: lyDo,
        bankTransactionId: gd.id,
        canhBaoHuy: true,
      });
      return { moi, trangThai: "CAN_XU_LY", tien: { loai: "CHAN_HOAN_MOT_PHAN", btId: gd.id, lyDo } };
    }
    // Vừa có người gắn tay / bỏ qua giữa hai câu ⇒ đọc lại.
    const lai = await db.bankTransaction.findUnique({ where: { id: gd.id }, select: { status: true } });
    trangThai = lai?.status ?? "IGNORED";
  }
  if (trangThai === "MATCHED") {
    const moi = await ghiDong(d, cu, may, nguon, {
      matchStatus: "TU_KHOP",
      matchReason: noiLyDo("Đã ghi nhận", LY_DO_HUY_SAU_GHI_NHAN),
      bankTransactionId: gd.id,
      canhBaoHuy: true,
    });
    // Hoàn MỘT PHẦN tới SAU khi tiền đã vào sổ — D7 (cảnh báo, không đảo).
    return { moi, trangThai: "TU_KHOP", tien: { loai: "DA_KHOA", btId: gd.id, trangThaiBt: "MATCHED", huySauGhiNhan: true } };
  }
  const moi = await ghiDong(d, cu, may, nguon, {
    matchStatus: "BO_QUA",
    matchReason: "Giao dịch đã được bỏ qua",
    bankTransactionId: gd.id,
  });
  return { moi, trangThai: "BO_QUA", tien: { loai: "DA_KHOA", btId: gd.id, trangThaiBt: "IGNORED", huySauGhiNhan: false } };
}

// ─────────────────────────────────────────────────────────────────────────────
// DÒNG HỦY / HOÀN — không bao giờ tạo `BankTransaction`, không bao giờ Payment âm.
// ─────────────────────────────────────────────────────────────────────────────

async function xuLyDongHuy(
  d: DongPos,
  p: Extract<PhanLoaiPos, { loai: "HUY" }>,
  cu: DongDaCo | undefined,
  may: May | undefined,
  nguon: NguonGhi,
  traMay: TraMay,
): Promise<KetLuanDong> {
  // Dòng hủy đã có mà ĐÃ kết luận (không còn CAN_XU_LY) ⇒ chỉ cột kết toán.
  // Còn CAN_XU_LY (chưa thấy gốc / hủy sau ghi nhận chưa đóng) ⇒ xét lại mỗi lần import.
  // GĐ3 (V7): dòng hủy/hoàn đã kết luận KHÔNG báo lệch — nó không mang tiền trong sổ (D7 không bao
  // giờ tự đảo bút toán). Cột kết toán: ô trống không xoá giá trị đã có (V8).
  if (cu && cu.matchStatus !== "CAN_XU_LY") {
    await db.posCardTransaction.update({
      where: { id: cu.id },
      data: {
        ...cotKetToanCapNhat(d),
        ...cotLo(nguon),
        ...coSoTheoMay(cu, may),
      },
    });
    return { moi: false, trangThai: null, tien: null };
  }
  return xetDongHuy(d, p, (matchStatus, matchReason) => ghiDong(d, cu, may, nguon, { matchStatus, matchReason }), traMay);
}

/** Ghi kết luận của một dòng hủy. Trả `true` nếu dòng MỚI tạo. */
type GhiKetLuanHuy = (matchStatus: PosMatchStatus, matchReason: string) => Promise<boolean>;

/**
 * Xét một dòng hủy/hoàn (đã phân loại `HUY`) theo trạng thái của GỐC. Dùng cho cả dòng trong lô
 * lẫn dòng đã lưu được xét lại khi gốc vừa tới — hai bên khác nhau ở `ghi`.
 */
async function xetDongHuy(
  d: DongPos,
  p: Extract<PhanLoaiPos, { loai: "HUY" }>,
  ghi: GhiKetLuanHuy,
  traMay: TraMay,
  /** Lượt xét lại sau khi thấy gốc vừa bị gỡ gắn (đua — xem nhánh MATCHED). Chỉ một lần. */
  lanXetLai = 0,
): Promise<KetLuanDong> {
  const ketLuan = async (matchStatus: PosMatchStatus, matchReason: string): Promise<KetLuanDong> => ({
    moi: await ghi(matchStatus, matchReason),
    trangThai: matchStatus,
    tien: null,
  });

  const goc = p.maGoc
    ? await db.posCardTransaction.findUnique({
        where: { maGiaoDich: p.maGoc },
        select: CHON_DONG_DA_CO,
      })
    : null;
  if (!goc) return ketLuan("CAN_XU_LY", `Chưa thấy giao dịch gốc ${p.maGoc ?? "(trống)"}`);

  // Gốc KHÔNG nằm trong lô (import trước khi khai máy, file ngày khác) ⇒ mọi phép cập nhật GỐC
  // dưới đây mang cơ sở theo MÁY CỦA GỐC khi gốc đang NULL — như mọi nhánh cập nhật dòng đã có
  // (`coSoTheoMay`). Trước bản vá gốc NULL mãi (NULL_IS_GLOBAL ⇒ mọi cơ sở đọc được), ca
  // `[PNS-20..22]`. Gốc đã có cơ sở ⇒ không đổi; gốc đã vào sổ ⇒ `dongBoCoSo` (cơ sở của ĐƠN) đứng
  // SAU trong cùng `data` nên thắng — ca `[PNS-23]`.
  const btGoc = goc.bankTransaction;
  // Máy của gốc — tra khi dòng POS gốc HOẶC giao dịch của nó đang NULL cơ sở. Bản vá nợ 3 đầu
  // tiên chỉ đưa cơ sở vào DÒNG POS; `BankTransaction` gốc vẫn NULL (NULL_IS_GLOBAL ⇒ kế toán
  // mọi cơ sở thấy số tiền + diễn giải) — rà vòng 3, ca `[V3-30]` `[V3-31]`.
  const mayGoc = goc.centerId === null || btGoc?.centerId === null ? await traMay(goc.maThietBi) : undefined;
  const coSoGoc = goc.centerId === null ? coSoTheoMay(goc, mayGoc) : {};
  let trangThaiGoc = btGoc?.status ?? null;
  // Toàn phần = chữ nói toàn phần VÀ đúng số gốc (Q-G). "Hủy" lệch số ⇒ một phần.
  const toanPhan = laHuyToanPhanVoiGoc(p, d.soTien, goc.soTien);

  if (btGoc && trangThaiGoc === "UNMATCHED") {
    if (toanPhan) {
      // Gốc còn trong hàng chờ ⇒ đưa ra. Đổi 0 dòng = vừa có người gắn / bỏ qua ⇒ đọc lại.
      const doi = await boQuaGiaoDich(btGoc, `Đã bị hủy bởi giao dịch thẻ ${d.maGiaoDich}`, mayGoc);
      if (doi) {
        await db.posCardTransaction.update({
          where: { id: goc.id },
          data: { matchStatus: "BO_QUA", matchReason: `Đã bị hủy bởi ${d.maGiaoDich}`, ...coSoGoc },
        });
        return ketLuan("BO_QUA", `Hủy giao dịch gốc ${p.maGoc}`);
      }
    } else {
      // HOÀN MỘT PHẦN, gốc CHƯA ghi nhận (Q-G 30/09/2026: "chặn tự động") ⇒ giao dịch gốc RA
      // KHỎI hàng chờ (IGNORED) + cảnh báo trên gốc. Bản 29/09 để gốc UNMATCHED "xử lý tay" ⇒
      // gắn tay bị buộc Σ = số GỘP, sổ ghi thừa đúng số đã hoàn. Lý do gỡ gắn (nếu có) giữ lại.
      const ghiChu = (btGoc.unmatchedNote ?? "").startsWith(TIEN_TO_GO_GAN)
        ? noiLyDo(btGoc.unmatchedNote, LY_DO_CHAN_HOAN_MOT_PHAN)
        : LY_DO_CHAN_HOAN_MOT_PHAN;
      const doi = await boQuaGiaoDich(btGoc, ghiChu, mayGoc);
      if (doi) {
        // Gốc có thể vừa được GỠ GẮN (chưa có tín hiệu): Q-M — lượt gỡ gắn thẻ đã ĐÓNG phiếu gộp, không
        // mở lại ⇒ dòng hoàn tới SAU không còn phiếu nào phải đóng (`[V6-M04]`).
        await moCanhBaoHoan(goc, `${LY_DO_CHAN_HOAN_MOT_PHAN} (${d.maGiaoDich})`, coSoGoc);
        return ketLuan("CAN_XU_LY", LY_DO_HOAN_XEM_GOC);
      }
    }
    const lai = await db.bankTransaction.findUnique({ where: { id: btGoc.id }, select: { status: true } });
    trangThaiGoc = lai?.status ?? null;
  }

  if (trangThaiGoc === "MATCHED") {
    // Tiền ĐÃ vào sổ. KHÔNG tự đảo — cảnh báo trên gốc, kế toán xử bằng luồng hiện có.
    //
    // Dòng hủy/hoàn MỚI (mã chưa có trong lý do) ⇒ bật, hoặc MỞ LẠI cảnh báo đã đóng. Điều kiện
    // cũ `!canhBaoHuy` làm lần hoàn THỨ HAI trên cùng gốc im lặng sau khi kế toán đã đóng cảnh
    // báo lần một (ca `[POS-DB-16]`).
    if (!goc.canhBaoHuy || !(goc.matchReason ?? "").includes(d.maGiaoDich)) {
      await db.posCardTransaction.update({
        where: { id: goc.id },
        data: {
          canhBaoHuy: true,
          canhBaoDaXuLyLuc: null,
          canhBaoDaXuLyBoiId: null,
          canhBaoGhiChu: null,
          matchReason: noiLyDo(goc.matchReason, `${LY_DO_HUY_SAU_GHI_NHAN} (${d.maGiaoDich})`),
          ...coSoGoc,
          ...dongBoCoSo(goc, btGoc ? { status: "MATCHED", centerId: btGoc.centerId } : null),
        },
      });
    }
    const kl = await ketLuan("CAN_XU_LY", LY_DO_HUY_SAU_GHI_NHAN);
    // ĐUA với một lượt GỠ GẮN (rà vòng 3, ca `[V3-40]`): lượt gỡ đọc "gốc đã có dòng hủy chưa"
    // TRONG khoá dòng giao dịch (`goGanTheoCon`). Đọc lại trạng thái gốc DƯỚI CÙNG khoá đó, SAU khi
    // dòng hủy đã ghi: lượt gỡ commit trước ⇒ thấy UNMATCHED ở đây và xét lại như gốc chưa ghi
    // nhận (IGNORED); lượt gỡ tới sau ⇒ nó thấy dòng hủy vừa ghi và tự đưa giao dịch ra IGNORED.
    // Thiếu bước này: tiền đã hoàn về thẻ mà giao dịch nằm lại hàng chờ đủ số gộp, gắn tay được.
    if (btGoc && lanXetLai === 0) {
      const sau = await db.$transaction(async (tx) => {
        await khoaGiaoDichTrongTx(tx, btGoc.id);
        return tx.bankTransaction.findUnique({ where: { id: btGoc.id }, select: { status: true } });
      });
      if (sau?.status === "UNMATCHED") {
        const lai = await xetDongHuy(d, p, ghi, traMay, lanXetLai + 1);
        return { moi: kl.moi, trangThai: lai.trangThai, tien: null };
      }
    }
    return kl;
  }

  if (trangThaiGoc === "IGNORED") {
    // Gốc đã bị CHẶN vì hoàn một phần (đang chờ kế toán điều chỉnh) ⇒ dòng hủy/hoàn MỚI là tin
    // mới cho đúng việc đó: nối vào cảnh báo của gốc (mở lại nếu đã đóng). Gốc bị bỏ qua vì lý
    // do khác ⇒ kết luận như cũ.
    if ((goc.matchReason ?? "").includes(DUOI_CHAN_HOAN_MOT_PHAN)) {
      if (!goc.canhBaoHuy || !(goc.matchReason ?? "").includes(d.maGiaoDich)) {
        await moCanhBaoHoan(goc, noiLyDo(goc.matchReason, `${toanPhan ? "Hủy" : "Hoàn"} ${d.maGiaoDich}`), coSoGoc);
      }
      return ketLuan("CAN_XU_LY", LY_DO_HOAN_XEM_GOC);
    }
    return ketLuan("BO_QUA", `Giao dịch gốc ${p.maGoc} đã được bỏ qua`);
  }

  // Gốc chưa có giao dịch (BO_QUA / CAN_XU_LY không tạo giao dịch).
  // Gốc đã BO_QUA (vd cột Hoàn/Hủy của gốc ghi "Hoàn toàn phần" — hoàn nhiều lần cộng thành
  // toàn phần) ⇒ không còn tiền nào chờ xử lý: dòng hoàn một phần kết luận như nhánh IGNORED.
  // Trước bản vá nó ra CAN_XU_LY mãi mãi, không có lối đóng (ca `[POS-DB-25]`).
  if (!toanPhan) {
    return goc.matchStatus === "BO_QUA"
      ? ketLuan("BO_QUA", `Giao dịch gốc ${p.maGoc} đã được bỏ qua`)
      : ketLuan("CAN_XU_LY", LY_DO_HOAN_MOT_PHAN);
  }

  await db.posCardTransaction.update({
    where: { id: goc.id },
    data: { matchStatus: "BO_QUA", matchReason: `Đã bị hủy bởi ${d.maGiaoDich}`, ...coSoGoc },
  });
  return ketLuan("BO_QUA", `Hủy giao dịch gốc ${p.maGoc}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHÉP GHI DÙNG CHUNG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Đưa một giao dịch RA KHỎI hàng chờ (UNMATCHED → IGNORED), CÓ ĐIỀU KIỆN trạng thái. Trả `false`
 * khi lượt khác vừa đổi nó (người gọi đọc lại).
 *
 * Giao dịch đang NULL cơ sở mà máy đã khai ⇒ mang luôn cơ sở theo MÁY: `update` (where mở rộng
 * của Prisma 5) để ghi kép điền `orgUnitId` — `updateMany` không kích hoạt ghi kép. `may` BẮT
 * BUỘC (không mặc định): `tsc` liệt kê chỗ gọi. Rà vòng 3, ca `[V3-30..33]`.
 */
async function boQuaGiaoDich(
  bt: { id: string; centerId: string | null },
  unmatchedNote: string,
  may: May | undefined,
): Promise<boolean> {
  if (bt.centerId === null && may) {
    try {
      await db.bankTransaction.update({
        where: { id: bt.id, status: "UNMATCHED" },
        data: { status: "IGNORED", unmatchedNote, centerId: may.centerId },
        select: { id: true },
      });
      return true;
    } catch (err) {
      if ((err as { code?: unknown })?.code !== "P2025") throw err;
      return false;
    }
  }
  const doi = await db.bankTransaction.updateMany({
    where: { id: bt.id, status: "UNMATCHED" },
    data: { status: "IGNORED", unmatchedNote },
  });
  return doi.count > 0;
}

/** Nối lý do mới vào lý do cũ, không lặp. */
function noiLyDo(cu: string | null, moi: string): string {
  if (!cu) return moi;
  return cu.includes(moi) ? cu : `${cu} · ${moi}`;
}

/**
 * Bật (hoặc MỞ LẠI) cảnh báo trên dòng POS gốc bị chặn vì hoàn một phần. Dòng gốc CAN_XU_LY —
 * nó chưa vào sổ, việc còn đó cho tới khi kế toán điều chỉnh rồi đóng cảnh báo.
 * `coSo` BẮT BUỘC (không mặc định): cơ sở theo máy cho gốc NULL — `tsc` liệt kê chỗ gọi.
 */
async function moCanhBaoHoan(goc: { id: string }, matchReason: string, coSo: { centerId?: string }): Promise<void> {
  await db.posCardTransaction.update({
    where: { id: goc.id },
    data: {
      matchStatus: "CAN_XU_LY",
      matchReason,
      ...coSo,
      canhBaoHuy: true,
      canhBaoDaXuLyLuc: null,
      canhBaoDaXuLyBoiId: null,
      canhBaoGhiChu: null,
    },
  });
}

/**
 * Upsert dòng POS theo `maGiaoDich`. Trả `true` nếu dòng MỚI tạo ở lượt này.
 * `importBatchId` chỉ ghi lúc TẠO (lô sinh ra dòng; NULL khi máy đồng bộ tạo — T1); lượt FILE chạm tới
 * ghi `lastImportBatchId`.
 */
async function ghiDong(
  d: DongPos,
  cu: DongDaCo | undefined,
  may: May | undefined,
  nguon: NguonGhi,
  ketQua: {
    matchStatus: PosMatchStatus;
    matchReason: string;
    maPhieu?: string;
    bankTransactionId?: string;
    canhBaoHuy?: boolean;
  },
): Promise<boolean> {
  const chung = {
    ...cotGoc(d),
    ...cotCoSo(may),
    matchStatus: ketQua.matchStatus,
    matchReason: ketQua.matchReason,
    ...cotLo(nguon),
    ...(ketQua.maPhieu !== undefined ? { maPhieu: ketQua.maPhieu } : {}),
    ...(ketQua.bankTransactionId !== undefined ? { bankTransactionId: ketQua.bankTransactionId } : {}),
    ...(ketQua.canhBaoHuy ? { canhBaoHuy: true } : {}),
  };
  // Dòng ĐÃ CÓ (kể cả vế `update` của upsert khi lượt song song vừa tạo): cột kết toán theo V8 — ô trống
  // của file KHÔNG chạm cột. Mã TRƯỚC bản vá (rà đối kháng GĐ3): `cotGoc` mang thẳng ba cột ⇒ dòng chưa
  // khoá được phân loại lại bởi một file CŨ bị xoá "Hủy toàn phần" + Mã hạch toán + Phí (ca `[POS3-DB-10]`).
  if (cu) {
    await db.posCardTransaction.update({ where: { id: cu.id }, data: { ...chung, ...cotKetToanCapNhat(d) } });
    return false;
  }
  // Lượt KHÔNG từ file / agent (`khopGiaoDichThe`): không tạo dòng. Lượt nhập sau tạo nó, và đọc giao
  // dịch theo KHOÁ nên thấy đúng trạng thái tiền (vá F3).
  if (nguon.loai === "NGOAI_LO") return false;
  // GĐ4 (T1): lô FILE tạo dòng mang lô của nó; máy đồng bộ tạo dòng KHÔNG lô (lưới [POS4-W6]).
  const loTao = nguon.loai === "LO_FILE" ? nguon.batchId : null;
  await db.posCardTransaction.upsert({
    where: { maGiaoDich: d.maGiaoDich },
    create: { maGiaoDich: d.maGiaoDich, importBatchId: loTao, ...chung, ...cotKetToanTao(d) },
    update: { ...chung, ...cotKetToanCapNhat(d) },
  });
  return true;
}

/**
 * Bảo đảm có `BankTransaction{CARD_POS, maGiaoDich}`. Tạo mới nếu chưa có; có rồi mà còn
 * UNMATCHED thì cập nhật theo file (số tiền / giờ / cơ sở máy / lý do); đã rời hàng chờ thì
 * KHÔNG đụng (tiền đã ghi theo số cũ — sửa số ở đây là lệch sổ).
 *
 * Trả kèm `amount` = SỐ TRONG SỔ (GĐ3, V7-ii): giao dịch đã rời hàng chờ thì người gọi so nó với số
 * của file để BÁO lệch — mọi đường trả đều chọn cột này.
 *
 * `rawPayload` KHÔNG mang số thẻ, KHÔNG mang tên chủ thẻ.
 */
async function damBaoGiaoDich(
  d: DongPos,
  may: May | undefined,
  lyDo: string | null,
  /** D5: NGUỒN chỉ là nhãn truy vết — provider vẫn MỘT (`CARD_POS`), khoá chống trùng vẫn MỘT. */
  nguonDuLieu: NguonDuLieuPos,
): Promise<{ id: string; status: TrangThaiBt; amount: number }> {
  const khoa = { provider: PROVIDER_THE_POS, providerTxnId: d.maGiaoDich };
  const cot = {
    amount: d.soTien,
    transferredAt: new Date(d.thoiGian),
    referenceCode: d.maChuanChi,
    content: d.dienGiai,
    rawPayload: {
      nguon: nguonDuLieu,
      maGiaoDichThe: d.maGiaoDichThe,
      maThietBi: d.maThietBi,
      maQuay: d.maQuay,
      maDonHang: d.maDonHang,
      loaiThe: d.loaiThe,
    },
  };

  const co = await db.bankTransaction.findUnique({
    where: { provider_providerTxnId: khoa },
    select: { id: true, status: true, amount: true, unmatchedNote: true },
  });
  if (!co) {
    try {
      const moi = await db.bankTransaction.create({
        data: { ...khoa, ...cot, unmatchedNote: lyDo, ...cotCoSo(may), status: "UNMATCHED" },
        select: { id: true, status: true, amount: true },
      });
      return moi;
    } catch (err) {
      // Lượt import song song vừa tạo trước ⇒ đọc lại, không tạo đôi.
      if ((err as { code?: unknown })?.code !== "P2002") throw err;
      const lai = await db.bankTransaction.findUnique({
        where: { provider_providerTxnId: khoa },
        select: { id: true, status: true, amount: true },
      });
      if (!lai) throw err;
      return lai;
    }
  }
  if (co.status !== "UNMATCHED") return { id: co.id, status: co.status, amount: co.amount };

  // Lý do: KHÔNG ghi đè ghi chú đang có bằng `null` (dòng THU — `thuTheoPhieuGop` tự viết lý do
  // của nó), và giữ ghi chú đang có nếu nó đã chứa lý do mới (vd "Hoàn một phần — xử lý tay:
  // hoàn 1.000.000đ bởi …" không bị cắt về câu trần).
  const note = lyDo === null || (co.unmatchedNote ?? "").includes(lyDo) ? {} : { unmatchedNote: lyDo };

  // `update` CÓ ĐIỀU KIỆN trạng thái (where mở rộng của Prisma 5): lượt khác vừa gắn / bỏ qua
  // thì nó ném P2025 thay vì ghi đè số tiền của một giao dịch đã vào sổ. Dùng `update` chứ
  // không `updateMany` để cơ chế ghi kép điền `orgUnitId` theo cơ sở máy.
  try {
    return await db.bankTransaction.update({
      where: { id: co.id, status: "UNMATCHED" },
      data: { ...cot, ...note, ...cotCoSo(may) },
      select: { id: true, status: true, amount: true },
    });
  } catch (err) {
    if ((err as { code?: unknown })?.code !== "P2025") throw err;
    const lai = await db.bankTransaction.findUnique({
      where: { id: co.id },
      select: { id: true, status: true, amount: true },
    });
    if (!lai) throw err;
    return lai;
  }
}
