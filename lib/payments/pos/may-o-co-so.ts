// lib/payments/pos/may-o-co-so.ts — mục "Máy POS quẹt thẻ" ở màn Cơ sở (Việc 2, 09/10/2026): luật QUYỀN, đường dẫn,
// chữ và KIỂU VIEW. THUẦN và client-safe: KHÔNG import `db-scope` / `server-only` (giao diện client import tệp này).
//
// Thiết kế: docs/pos-hai-nut-khai-may.md §2. Khai máy POS dời từ tab "Máy POS" của Cấu hình vận hành về trang
// `/centers/<id>/edit`, ngay sau mục "Thanh toán" — cùng nhóm "tiền về đâu".
//
// ── MỘT ĐỊNH NGHĨA CỦA "GHI ĐƯỢC" ───────────────────────────────────────────────────────────────────────────────
// Ba action khai máy (`centers/_may-pos-actions.ts`) đòi HAI thứ: quyền `payments:import-pos` VÀ tầm nhìn MỌI cơ sở
// (`nhapPosDuocMoiCoSo`, Q-D). Giao diện mà chỉ hỏi quyền sẽ vẽ nút mà action chắc chắn từ chối (luật 12; ca `[MPOS-06]`).
// `duocKhaiMayPos` là chỗ DUY NHẤT nói điều đó; mục máy POS (`quyenMayPos`) và link "Chưa khai máy POS" trên trang đơn
// (`lienKetKhaiMay`) cùng hỏi nó — hai nơi chép điều kiện sẽ lệch nhau ngày đầu tiên ai đó sửa một bên. Ca `[HN2-MP-04]`.
//
// ── CÁCH LY CƠ SỞ ≠ QUYỀN ───────────────────────────────────────────────────────────────────────────────────────
// `payments:view` seed `scopeType: "GLOBAL"`, mà `can()` v2 trả `true` cho GLOBAL và VỨT đích (`lib/auth/can.ts`) — nên
// Quản lý cơ sở của CS1 có `payments:view = true` kể cả khi mở trang CS2. Cách ly thật là `passesScope("PosTerminal", …)`
// (khuôn `[PTTT-11]`). Tệp này nhận kết quả của nó qua `trongPhamVi`; KHÔNG tự tính (để khỏi kéo `db-scope` vào bundle client).
import type { Tone } from "./agent/hien-thi";

/** Neo `#may-pos` trên trang cơ sở. */
export const NEO_MAY_POS = "may-pos";
export const TIEU_DE_MUC_MAY_POS = "Máy POS quẹt thẻ";

/** Câu nhắc chủ dự án yêu cầu hiện trên màn (docs/pos-the-smartpos.md). */
export const CAU_NHAC_IMPORT_LAI =
  "Khai máy xong, import lại file để khớp các giao dịch đang 'Thiết bị chưa gán cơ sở'.";

export const LY_DO_CO_SO_DONG =
  "Cơ sở đã đóng — không khai thêm máy được. Máy đã khai vẫn sửa, tắt, bật được.";

export type DauVaoQuyenMayPos = {
  /** `passesScope("PosTerminal", { centerId }, actor)` — cơ sở của trang nằm trong tầm nhìn của người xem. */
  trongPhamVi: boolean;
  /** `payments:view` (hỏi kèm đích). Một mình nó KHÔNG đủ để thấy — xem phần "cách ly cơ sở ≠ quyền" ở đầu tệp. */
  coQuyenXem: boolean;
  /** `payments:import-pos`. */
  coQuyenGhi: boolean;
  /** `nhapPosDuocMoiCoSo(actor)` — ba action khai máy đòi nhìn được MỌI cơ sở. */
  phamViGhiMoiCoSo: boolean;
  /** `Center.isActive` — `kiemCoSoDich` từ chối khai thêm máy vào cơ sở đã đóng. */
  coSoDangHoatDong: boolean;
};

export type QuyenMayPos = {
  xem: boolean;
  sua: boolean;
  them: boolean;
  /** Chỉ có khi người xem đáng lẽ thêm được mà cơ sở đã đóng — để in lên màn, không im lặng ẩn nút. */
  lyDoKhongThem: string | null;
};

/** "Ghi được" = quyền `import-pos` ∧ tầm nhìn mọi cơ sở. Đúng cổng ba action hỏi lại ở máy chủ. */
export function duocKhaiMayPos(v: Pick<DauVaoQuyenMayPos, "coQuyenGhi" | "phamViGhiMoiCoSo">): boolean {
  return v.coQuyenGhi && v.phamViGhiMoiCoSo;
}

/**
 * Ai xem / sửa / thêm mục máy POS của MỘT cơ sở.
 *
 * `xem` = cơ sở trong tầm nhìn ∧ (`payments:view` ∨ `payments:import-pos`). Vế `∨ import-pos` giữ nguyên tập người từng thấy
 * tab cũ (cổng của tab là `import-pos`) và bảo đảm link ở trang đơn — hiện cho người GHI được — luôn tới nơi vẽ được mục (V29).
 * `sua` = `xem` ∧ `duocKhaiMayPos`; `them` = `sua` ∧ cơ sở đang hoạt động (V31).
 */
export function quyenMayPos(v: DauVaoQuyenMayPos): QuyenMayPos {
  const xem = v.trongPhamVi && (v.coQuyenXem || v.coQuyenGhi);
  const sua = xem && duocKhaiMayPos(v);
  const them = sua && v.coSoDangHoatDong;
  return { xem, sua, them, lyDoKhongThem: sua && !v.coSoDangHoatDong ? LY_DO_CO_SO_DONG : null };
}

/** Trang cơ sở + neo mục máy POS; không biết cơ sở thì danh sách cơ sở (đừng bịa một id). */
export function duongKhaiMay(centerId?: string | null): string {
  return centerId ? `/centers/${encodeURIComponent(centerId)}/edit#${NEO_MAY_POS}` : "/centers";
}

export type LienKetKhaiMay = {
  /** Chữ chỉ đường (`title`): luôn có — người không ghi được vẫn cần biết nhờ ai, ở đâu. */
  title: string;
  /** `null` khi người xem không ghi được: một link chỉ để đọc "Bạn chỉ xem" là lời hứa suông (luật 12). */
  href: string | null;
};

/** Ô "Chưa khai máy POS" trên dòng đợt: `title` đúng nguyên văn đặc tả, link chỉ khi `duocKhai`. */
export function lienKetKhaiMay(v: {
  centerId: string | null;
  tenCoSo: string | null;
  duocKhai: boolean;
}): LienKetKhaiMay {
  const title = v.tenCoSo
    ? `Khai máy ở Cơ sở → ${v.tenCoSo} → ${TIEU_DE_MUC_MAY_POS}`
    : `Khai máy ở Cơ sở → ${TIEU_DE_MUC_MAY_POS}`;
  return { title, href: v.duocKhai ? duongKhaiMay(v.centerId) : null };
}

/**
 * Dựng ô "Chưa khai máy POS" của trang ĐƠN từ chính ĐƠN: cơ sở của link là cơ sở GIỮ ĐƠN (`don.centerId`), KHÔNG phải cơ sở của người
 * xem — Kế toán HO (không có `centerId`) mở đơn CS2 phải được đưa tới CS2. Nhận NGUYÊN đơn (không nhận `centerId` rời) để không có
 * tham số "người xem" nào lẫn vào được; trang truyền `don: order`. Ca `[HN2-RD-03]` + lưới `[HN2-MP-W07]`.
 */
export function khaiMayChoDon(v: {
  don: { centerId: string | null; center?: { name: string } | null };
  coQuyenGhi: boolean;
  phamViGhiMoiCoSo: boolean;
}): LienKetKhaiMay {
  return lienKetKhaiMay({
    centerId: v.don.centerId ?? null,
    tenCoSo: v.don.center?.name ?? null,
    duocKhai: duocKhaiMayPos({ coQuyenGhi: v.coQuyenGhi, phamViGhiMoiCoSo: v.phamViGhiMoiCoSo }),
  });
}

/**
 * Chữ của link tới mục máy POS ở màn POS Agent: người GHI được thấy "Khai máy POS", người chỉ xem thấy "Xem máy POS" (luật 12 — không
 * hứa một việc mà trang đích không cho làm). `khaiMayDuoc` = `duocKhaiMayPos(…)`. Ca `[HN2-RD-02]` + lưới `[HN2-MP-W06]`.
 */
export function nhanLinkKhaiMay(khaiMayDuoc: boolean): string {
  return khaiMayDuoc ? "Khai máy POS" : "Xem máy POS";
}

// ─── KIỂU VIEW — loader dựng, giao diện vẽ ───────────────────────────────────────────────────────────────────────

/** Dòng trạng thái POS Agent cạnh một máy (V34). `null` ở `DongMayCoSo.agent` = không có gì để nói. */
export type DongAgentMay =
  | {
      kieu: "KHOP";
      agentId: string;
      /** `trangThaiThe.nhan` — "Đang làm việc" · "Hết phiên" · "Mất kết nối" · "Đã tắt"… */
      nhan: string;
      tone: Tone;
      /** `dongPhien` ghép chữ: "Sống · hết hạn 21:30" · "Hết phiên · từ 08:15". Rỗng khi agent TẮT. */
      phien: string;
      phienTone: "danger" | "warning" | null;
    }
  | { kieu: "CHUA_KHOP"; cau: string };

export type DongMayCoSo = {
  id: string;
  maThietBi: string;
  maQuay: string | null;
  ten: string | null;
  /** Ba mã Techcombank cấp trên portal merchant (GĐ2 POS) — hiển thị + sửa ở hộp thoại. */
  maCuaHang: string | null;
  maNhaCungCap: string | null;
  maTcbQuay: string | null;
  active: boolean;
  /** ISO — `Date` không qua được ranh giới server/client nguyên vẹn. */
  taoLuc: string;
  agent: DongAgentMay | null;
};

export type MucMayPosView = {
  coSo: { id: string; ten: string; dangHoatDong: boolean };
  quyen: QuyenMayPos;
  /** Người xem mở được màn Biến động số dư không (`payments:view`) — không thì không vẽ link (luật 12). */
  moDuocBienDong: boolean;
  may: DongMayCoSo[];
};
