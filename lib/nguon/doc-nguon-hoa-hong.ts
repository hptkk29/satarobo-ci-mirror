/**
 * lib/nguon/doc-nguon-hoa-hong.ts — ĐỌC nguồn của một lead cho ENGINE HOA HỒNG (một quá trình hệ thống, không phải một người).
 *
 * ── Vì sao KHÔNG qua `scopedDb(actor)` như `doc-nguon.ts` ───────────────────────────────────────────────────
 * Engine tính hoa hồng chạy theo lịch, không có "người bấm": nó phải thấy nguồn của MỌI lead để trả đúng tiền. Cách ly cơ sở
 * dành cho NGƯỜI XEM (màn hình), không dành cho máy tính tiền. Hàm này vì thế nhận client KHÔNG scope và ĐƯỢC PHÉP chỉ vì:
 *   · nó nằm trong `lib/nguon/**` (lưới `[QN-W11]` cho phép đọc bảng nguồn ở đây và chỉ ở đây);
 *   · nó đọc TỪ `Lead` (quan hệ `attribution`), không bao giờ tra bằng `attributionId`/`touchpointId`;
 *   · nó KHÔNG có đường nào ra giao diện: kết quả chỉ vào sổ hoa hồng dưới dạng ẢNH CHỤP (nhóm, mã nhóm, người giới thiệu), và
 *     màn hình đọc sổ đi qua `docSoHoaHong` với cách ly riêng (02 §11.1).
 * Mọi nơi gọi PHẢI là engine (`lib/hoa-hong/**`) — đừng import hàm này từ `app/**`.
 *
 * Trả `null` khi lead chưa có quy nguồn (cờ `nguon.enabled` tắt lúc lead được tạo, hoặc lead cũ chưa di trú): engine coi là
 * nguồn KHÔNG RÕ (UNKNOWN, D7) — mức THẤP NHẤT, không phải mức cao nhất.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { nguonHieuLucChoEngine } from "./nguon-chup";

type Khach = PrismaClient | Prisma.TransactionClient;

export type NguonChoHoaHong = {
  attributionId: string;
  groupId: string;
  groupCode: string;
  /** Loại người giới thiệu (PARENT/EMPLOYEE/AFFILIATE) — phân biệt "không phải giới thiệu PH" với "giới thiệu PH nhưng thiếu Sale". */
  referrerKind: "PARENT" | "EMPLOYEE" | "AFFILIATE" | null;
  referrerParentUserId: string | null;
  /** ẢNH CHỤP Sale phụ trách phụ huynh giới thiệu LÚC ghi nhận (`User.id`) — vai `REFERRER_PARENT_SALE`. */
  referrerSaleUserId: string | null;
  /** `Employee.id` (engine đổi sang `User.id` ở `docNguCanhNguoiHuong`). */
  referrerEmployeeId: string | null;
  referrerAffiliateId: string | null;
  /** First-claim — mốc đếm cửa sổ ghi công. */
  attributedAt: Date;
  /** Thuộc tính của NGUỒN (master) — engine đọc thuộc tính, không so mã. */
  nguonCoHoaHong: boolean;
  /**
   * Cửa sổ ghi công HIỆU LỰC của attribution này; null ⇒ setting chung. Đọc BẢN CHỤP `signals.nguon` (ghi lúc ghi nhận/đổi nguồn có kiểm soát); chỉ hàng CHƯA có bản
   * chụp (di trú) mới rơi về dòng nguồn sống. Đổi cửa sổ ở nguồn SAU khi attribution đã ghi KHÔNG làm đợt 2–3 của đơn trả góp rơi ngoài cửa sổ.
   */
  cuaSoRiengNgay: number | null;
  /**
   * `Employee.id` người phụ trách NGUỒN (vai `SOURCE_OWNER`) LÚC GHI NHẬN; null = chưa khai (hoặc bản chụp hỏng/bị chặn TU_CLAIM). Cùng nguồn gốc với `cuaSoRiengNgay`:
   * đổi chủ nguồn giữa đợt 1 và đợt 2 không làm hai đợt về hai người.
   */
  nguonChuEmployeeId: string | null;
  /** Giá trị trên đến từ đâu: bản chụp / dòng nguồn sống (hàng di trú) / bản chụp hỏng (fail-closed). */
  nguonGocChup: "BAN_CHUP" | "NGUON_SONG" | "BAN_CHUP_HONG";
  referrerMissing: boolean;
  /** `updatedAt` của dòng quy nguồn. KHÔNG dùng cho cổng khoá / tập quét (hai nơi đó đọc `nguonCapNhatMoiNhat` / `nguonCapNhatTheoLead`, có thêm mốc của nhóm) và KHÔNG vào dấu vân tay đầu vào. */
  updatedAt: Date;
};

export async function docNguonChoHoaHong(client: Khach, leadId: string): Promise<NguonChoHoaHong | null> {
  const lead = await client.lead.findUnique({
    where: { id: leadId },
    select: {
      attribution: {
        select: {
          id: true,
          groupId: true,
          group: { select: { code: true, commissionEnabled: true, attributionWindowDays: true, ownerEmployeeId: true } },
          referrerKind: true,
          referrerParentUserId: true,
          referrerSaleUserId: true,
          referrerEmployeeId: true,
          referrerAffiliateId: true,
          attributedAt: true,
          referrerMissing: true,
          signals: true,
          updatedAt: true,
        },
      },
    },
  });
  const a = lead?.attribution;
  if (!a) return null;
  const hieuLuc = nguonHieuLucChoEngine(a.signals, { cuaSoRiengNgay: a.group.attributionWindowDays, chuNhanVienId: a.group.ownerEmployeeId });
  return {
    attributionId: a.id,
    groupId: a.groupId,
    groupCode: a.group.code,
    referrerKind: a.referrerKind,
    referrerParentUserId: a.referrerParentUserId,
    referrerSaleUserId: a.referrerSaleUserId,
    referrerEmployeeId: a.referrerEmployeeId,
    referrerAffiliateId: a.referrerAffiliateId,
    attributedAt: a.attributedAt,
    nguonCoHoaHong: a.group.commissionEnabled,
    cuaSoRiengNgay: hieuLuc.cuaSoRiengNgay,
    nguonChuEmployeeId: hieuLuc.chuNhanVienId,
    nguonGocChup: hieuLuc.nguonGoc,
    referrerMissing: a.referrerMissing,
    updatedAt: a.updatedAt,
  };
}

/**
 * Mốc đổi ĐẦU VÀO NGUỒN của một attribution = lớn hơn trong {`LeadAttribution.updatedAt`, `LeadSourceGroup.updatedAt` của nhóm nó đang thuộc}.
 *
 * Vì sao có vế nhóm (Q2 · 09/10/2026): chủ và cửa sổ ghi công đã được CHỤP vào `signals.nguon` lúc ghi nhận (đổi chúng ở nhóm không làm đợt sau của đơn trả góp đổi người), nhưng
 * `commissionEnabled` thì engine đọc SỐNG từ nhóm (`docNguonChoHoaHong`) — và hàng di trú chưa có bản chụp còn đọc sống cả chủ lẫn cửa sổ. Chỉ nhìn `LeadAttribution.updatedAt`
 * thì tắt/bật cờ nguồn không làm kỳ đã tính biết gì (kỳ khoá trên số cũ). Cách «nhích `updatedAt` của MỌI attribution của nguồn» đắt O(số lead) trong MỘT transaction giữ khoá nguồn
 * (trần 5 giây của Prisma, P2028 ở nguồn lớn); cách này ghi O(1) — chỉ dòng nhóm — và chỉ trả thêm một phép nối ở hai hàm ĐỌC bên dưới.
 *
 * Phí tổn đã biết: `LeadSourceGroup.updatedAt` đổi cả khi chỉ đổi TÊN/mô tả/thứ tự/trạng thái (nó cũng là mốc khoá lạc quan của biểu mẫu), nên các việc đó cũng đưa khoản vào tập quét
 * Q4 và buộc Tính lại kỳ trước khi khoá. An toàn về tiền (lượt quét lại không ghi gì khi kỳ vọng không đổi — ca `[DVT-02]`), chỉ tốn một lượt quét; chọn nó thay vì thêm cột «đầu vào
 * tiền đổi lúc» vì cột mới là một migration nữa trên bảng đang dựng.
 */
function mocDauVaoNguon(a: { updatedAt: Date; group: { updatedAt: Date } }): Date {
  return a.group.updatedAt.getTime() > a.updatedAt.getTime() ? a.group.updatedAt : a.updatedAt;
}

/**
 * Mốc cập nhật mới nhất của nguồn các lead — cho cổng khoá kỳ (04 §12.1 Q4: `LeadAttribution.updatedAt` ∪ `LeadSourceGroup.updatedAt`, xem `mocDauVaoNguon`).
 * Trả `null` nếu không có lead nào có nguồn.
 */
export async function nguonCapNhatMoiNhat(client: Khach, leadIds: readonly string[]): Promise<Date | null> {
  if (leadIds.length === 0) return null;
  const r = await client.lead.findMany({
    where: { id: { in: [...leadIds] }, attribution: { isNot: null } },
    select: { attribution: { select: { updatedAt: true, group: { select: { updatedAt: true } } } } },
  });
  let moi: Date | null = null;
  for (const x of r) {
    if (!x.attribution) continue;
    const t = mocDauVaoNguon(x.attribution);
    if (moi === null || t.getTime() > moi.getTime()) moi = t;
  }
  return moi;
}

/**
 * Mốc đổi đầu vào nguồn theo TỪNG lead (lead không có nguồn thì vắng; `LeadAttribution.updatedAt` ∪ `LeadSourceGroup.updatedAt`, xem `mocDauVaoNguon`) — cho tập quét Q4 (04 §12.1):
 * so với `lastCheckedAt` của ô để biết nguồn đổi SAU lần so gần nhất. Nằm ở đây (không ở `lib/hoa-hong`) vì SQL thô / truy cập bảng nguồn chỉ được phép trong `lib/nguon/**` (`[QN-W11]`).
 */
export async function nguonCapNhatTheoLead(client: Khach, leadIds: readonly string[]): Promise<Map<string, Date>> {
  const ra = new Map<string, Date>();
  if (leadIds.length === 0) return ra;
  const r = await client.lead.findMany({
    where: { id: { in: [...new Set(leadIds)] }, attribution: { isNot: null } },
    select: { id: true, attribution: { select: { updatedAt: true, group: { select: { updatedAt: true } } } } },
  });
  for (const x of r) if (x.attribution) ra.set(x.id, mocDauVaoNguon(x.attribution));
  return ra;
}
