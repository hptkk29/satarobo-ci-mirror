import "server-only";
// lib/integrations/zalocrm/dat-truoc.ts — S2 CHIỀU GHI: dòng "ĐẶT TRƯỚC" của `ZaloCrmThread`.
//
// =============================================================================
// VIỆC NÀY GIẢI BÀI TOÁN GÌ
//
// Tin ĐẦU TIÊN khách gửi qua Zalo cá nhân KHÔNG kèm số điện thoại — ZaloCRM chỉ có
// `threadId` và một cái tên hiển thị. Nên nếu Sata không biết trước "số này là phiếu
// nào", hội thoại rơi vào nhóm mồ côi và phải nối tay từng cái.
//
// Kế hoạch §5 (việc S2) chốt cách giải: lúc Sale bấm "Nhắn Zalo" TỪ CHÍNH phiếu đó,
// Sata ghi tạm một dòng `(orgCode, phone) → leadId`. Webhook đầu tiên của hội thoại
// tra đúng cặp ấy (`nap-su-kien.ts` → `napThreadTheoSdt` → `noiPhieu`) và nối được
// ngay. Đây là "ý định tường minh của con người", mạnh hơn mọi phép suy đoán theo số.
//
// ⚠️ ĐƯỜNG ĐỌC ĐÃ CÓ TỪ ĐỢT TRƯỚC, ĐƯỜNG GHI THÌ CHƯA: trang `/admin/zalo-crm` khai
// `lead?: string` trong kiểu `searchParams` mà thân hàm KHÔNG đọc lần nào ⇒ bảng ánh
// xạ vĩnh viễn rỗng, còn ca `[ZC-L7-03]` vẫn xanh vì test tự tạo dòng đó bằng tay.
// File này là đường ghi còn thiếu.
//
// ── BỐN LUẬT KHÔNG THƯƠNG LƯỢNG ──────────────────────────────────────────────
//  1. KHÔNG ĐÈ `zcrmConversationId` đang khác NULL, và không trỏ lại `leadId` của một
//     dòng đã có phiếu. `@@unique([orgCode, phone])` nghĩa là trong một org, một số
//     giữ được ĐÚNG MỘT ánh xạ; giành nó bằng cú bấm gần nhất là chuyển lịch sử chat
//     của khách sang hồ sơ khác, im lặng (xem khối chú thích dài trong
//     `prisma/migrations/20260906090100_zalocrm_bang_nick_thread/migration.sql`).
//  2. IDEMPOTENT. Bấm hai lần, mở hai tab, F5 mười lần: vẫn một dòng, không lỗi.
//  3. TỰ GÁC CƠ SỞ. `ZaloCrmThread` nằm trong `SCOPE_EXEMPT` ⇒ `scopedDb` KHÔNG che
//     bảng này (cả đọc lẫn ghi). Cổng phải nằm ngay trong đường ghi: chỉ ghi cho org
//     của cơ sở actor nhìn thấy, và chỉ khi phiếu đó actor ĐỌC ĐƯỢC (qua `scopedDb`,
//     không dựng luật quyền thứ hai).
//  4. HỎNG THÌ IM. Đây là việc phụ trợ; `ZaloCrmThread` ngã thì Sale vẫn phải nhắn
//     được khách. Mọi lỗi bị nuốt + ghi log, KHÔNG ném lên trang.
//
// ── VÌ SAO SỐ PHẢI Ở DẠNG `84XXXXXXXXX` ──────────────────────────────────────
// `napThreadTheoSdt` tra bằng `where: { orgCode, phone }` — SO BẰNG, không
// `phoneVariants`. Ghi lệch dạng là dòng nằm đó vô dụng mà không ai biết: không lỗi,
// không log, chỉ có "sao hộp thư toàn hội thoại lạ".
// =============================================================================
import { Prisma } from "@prisma/client";

import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { canonicalPhone } from "@/lib/phone";
import { KHUON_COMPOSE_ZALOCRM } from "./compose-url";
import { KHUON_ORG_CODE } from "./types";

/**
 * Kết quả của một lượt đặt trước. Luôn có mã — kể cả khi không ghi gì — để nơi gọi
 * (và nhật ký) trả lời được câu "vì sao dòng ấy không có ở đó".
 */
export type MaDatTruoc =
  /** Ghi mới xong. */
  | "DA_TAO"
  /** Điền vào chỗ trống của dòng đã có. */
  | "DA_CAP_NHAT"
  /** Dòng đã đúng sẵn — bấm lại lần thứ hai. KHÔNG phải lỗi. */
  | "DA_DUNG"
  /** 🔴 Dòng đang trỏ phiếu KHÁC ⇒ giữ nguyên. Xem luật 1. */
  | "GIU_ANH_XA_CU"
  /** Mở màn từ sidebar (không `?compose=`/`?lead=`) — trạng thái thường ngày. */
  | "THIEU_THAM_SO"
  /** `?compose=` không phải di động VN (số cố định, bản đã che PII, chuỗi rác). */
  | "SO_KHONG_HOP_LE"
  /** `?org=` / tab hỏng khuôn — không tra tới đâu cả. */
  | "ORG_KHONG_HOP_LE"
  /** `?compose=` không phải số của chính phiếu đó ⇒ URL ghép tay. */
  | "SO_LECH_PHIEU"
  /** Tab thuộc cơ sở actor không nhìn thấy. */
  | "NGOAI_TAM_NHIN"
  /** Phiếu không tồn tại hoặc nằm ngoài tầm nhìn của actor. */
  | "KHONG_DOC_DUOC_PHIEU"
  /** Phiếu thuộc cơ sở khác với tab đang mở. */
  | "KHAC_CO_SO"
  /** Khoá `(orgCode, phone)` đang bị một dòng ĐÃ XOÁ MỀM chiếm. */
  | "BI_XOA_MEM"
  /** DB ngã. Đã nuốt + log; nơi gọi chỉ việc đi tiếp. */
  | "GHI_HONG";

export type KetQuaDatTruoc = { ma: MaDatTruoc; id?: string };

/** Đúng những cột của dòng ánh xạ mà LUẬT ghi cần đọc. */
export type DongDatTruoc = {
  id: string;
  leadId: string | null;
  zcrmConversationId: string | null;
  centerId: string | null;
  orgUnitId: string | null;
};

export type QuyetDinhDatTruoc =
  | { viec: "TAO" }
  | { viec: "CAP_NHAT"; id: string; data: { leadId?: string; centerId?: string } }
  | { viec: "BO_QUA"; ma: MaDatTruoc };

// ── Phần THUẦN 1: chuẩn bị tham số ───────────────────────────────────────────

/**
 * Đọc `?compose=` + `?lead=` thành cặp `(số canonical, mã phiếu)`.
 *
 * THUẦN — không DB, không env. Tách ra để bảng tình huống kiểm được không cần
 * Postgres, và để "không ghi" luôn có một MÃ giải thích thay vì im lặng.
 */
export function chuanBiDatTruoc(input: {
  compose?: string | null;
  lead?: string | null;
  orgCode: string;
}): { ok: true; so: string; leadId: string } | { ok: false; ma: MaDatTruoc } {
  const leadId = typeof input.lead === "string" ? input.lead.trim() : "";
  const compose = typeof input.compose === "string" ? input.compose.trim() : "";
  // Thiếu một trong hai là lối vào BÌNH THƯỜNG (mở màn từ sidebar) — không cảnh báo,
  // không ghi. Bịa một dòng ánh xạ cho nó là bịa ra quan hệ số ↔ phiếu.
  if (!leadId || !compose) return { ok: false, ma: "THIEU_THAM_SO" };

  if (!KHUON_ORG_CODE.test(input.orgCode)) return { ok: false, ma: "ORG_KHONG_HOP_LE" };

  const so = canonicalPhone(compose);
  // Hai lớp: `canonicalPhone` (di động VN hợp lệ) rồi `KHUON_COMPOSE_ZALOCRM` (dạng
  // `84…` mà cả ZaloCRM lẫn `napThreadTheoSdt` dùng). Lớp thứ hai là bất biến chứ
  // không phải phép kiểm dữ liệu — ngày nào canonical đổi dạng, nó đỏ ngay tại đây
  // thay vì đẻ ra một bảng ánh xạ không ai tra tới.
  if (!so || !KHUON_COMPOSE_ZALOCRM.test(so)) return { ok: false, ma: "SO_KHONG_HOP_LE" };

  return { ok: true, so, leadId };
}

// ── Phần THUẦN 2: luật ghi ───────────────────────────────────────────────────

/**
 * Ghi gì / KHÔNG ghi gì. THUẦN, và là chỗ DUY NHẤT quyết định điều đó.
 *
 * Thứ tự các nhánh có ý nghĩa: hai phép kiểm dữ liệu (số của ai, cơ sở nào) đứng
 * TRƯỚC mọi nhánh ghi, vì chúng là thứ chặn được việc ghép tay trên URL.
 */
export function quyetDinhDatTruoc(input: {
  /** SĐT canonical `84…`, đã qua `chuanBiDatTruoc`. */
  so: string;
  leadId: string;
  /** Phiếu ĐÃ ĐỌC ĐƯỢC bằng quyền của actor (không đọc được thì đừng gọi hàm này). */
  phieu: { phone: string | null; centerId: string | null };
  /** Cơ sở của TAB đang mở — nguồn `centerId` ghi xuống dòng ánh xạ. */
  coSoCenterId: string;
  dong: DongDatTruoc | null;
}): QuyetDinhDatTruoc {
  // (a) Số trên URL phải LÀ số của chính phiếu ấy. Nút thật luôn dựng cặp này từ
  // cùng một bản ghi, nên một cặp lệch chỉ đến từ URL sửa tay — và ghi được thì hội
  // thoại của người này nằm trong hồ sơ người kia ngay từ tin đầu tiên.
  if (canonicalPhone(input.phieu.phone) !== input.so) {
    return { viec: "BO_QUA", ma: "SO_LECH_PHIEU" };
  }

  // (b) Phiếu phải cùng cơ sở với tab. Đường webhook đã cấm nối chéo cơ sở (lỗi B3);
  // để đường "đặt trước" đi vòng qua lệnh cấm ấy thì vá B3 thành vô nghĩa. Phiếu
  // CHƯA gán cơ sở (`centerId = null`) thì cho qua — không đoán, cùng nếp với
  // `thuNoiTheoSdt` (nó cũng nhận lead `orgUnitId = null`).
  if (input.phieu.centerId && input.phieu.centerId !== input.coSoCenterId) {
    return { viec: "BO_QUA", ma: "KHAC_CO_SO" };
  }

  const dong = input.dong;
  if (!dong) return { viec: "TAO" };

  // (c) Bổ sung cơ sở CHỈ khi dòng chưa biết cơ sở nào. Đè `centerId` đang có là kéo
  // cả dòng sang cơ sở khác — và `orgUnitId` đi kèm (ghi kép ở `lib/org/dual-write.ts`)
  // sẽ kéo theo cả tầm nhìn.
  const themCoSo = dong.centerId === null && dong.orgUnitId === null;

  // (d) Dòng đã trỏ đúng phiếu ⇒ không đẻ lượt UPDATE vô nghĩa (mỗi lượt là một
  // `updatedAt` mới, làm nhiễu chính cột dùng để truy vết).
  if (dong.leadId === input.leadId) {
    return themCoSo
      ? { viec: "CAP_NHAT", id: dong.id, data: { centerId: input.coSoCenterId } }
      : { viec: "BO_QUA", ma: "DA_DUNG" };
  }

  // (e) 🔴 Dòng đang trỏ PHIẾU KHÁC ⇒ GIỮ NGUYÊN, dù đã có hội thoại hay chưa.
  // Hai phiếu cùng số trong cùng cơ sở là lỗi TRÙNG PHIẾU: cách sửa là gộp phiếu,
  // không phải để cú bấm gần nhất giành lấy ánh xạ. Cho phép trỏ lại là mở đúng cái
  // cửa mà `@@unique([orgCode, phone])` sinh ra để đóng.
  if (dong.leadId !== null) return { viec: "BO_QUA", ma: "GIU_ANH_XA_CU" };

  // (f) Chỗ trống ⇒ điền. Ca thật: webhook đã tạo dòng từ một hội thoại chưa khớp
  // được lead nào, nay Sale mở đúng phiếu của khách đó và bấm nút. `zcrmConversationId`
  // KHÔNG bao giờ có mặt trong `data` — luật 1.
  return {
    viec: "CAP_NHAT",
    id: dong.id,
    data: { leadId: input.leadId, ...(themCoSo ? { centerId: input.coSoCenterId } : {}) },
  };
}

// ── Đường GHI (chạm DB) ──────────────────────────────────────────────────────

/** Cơ sở này actor có nhìn thấy không. */
function nhinThayCoSo(actor: Actor, centerId: string): boolean {
  // SUPER_ADMIN vượt `scopedDb` (`bypassesScope`) và `visibleCenterIds` của họ suy từ
  // `UserOrgRole` — có thể rỗng nếu họ không đứng ở đơn vị nào. Chặn họ ở đây là dựng
  // một luật quyền THỨ HAI trả lời khác với `scopedDb` cho cùng một câu hỏi.
  return actor.isSuperAdmin || actor.visibleCenterIds.includes(centerId);
}

/**
 * `deletedAt: null` phải GÕ TAY ở mọi truy vấn: `ZaloCrmThread` có cột xoá mềm nhưng
 * KHÔNG nằm trong `SOFT_DELETE_MODELS` (`lib/soft-delete.ts`), nên `db` không tự ẩn.
 */
const CHON_DONG = {
  id: true,
  leadId: true,
  zcrmConversationId: true,
  centerId: true,
  orgUnitId: true,
} as const;

/**
 * Ghi dòng "đặt trước" cho cặp (org của tab đang mở, SĐT trên `?compose=`).
 *
 * KHÔNG BAO GIỜ NÉM — mọi nhánh hỏng trả một mã. Nơi gọi là Server Component đang
 * dựng màn cho Sale nhắn khách; một bảng ánh xạ hỏng không được biến thành
 * "Application error" chắn ngang việc chăm khách.
 */
export async function datTruocLuongZalo(input: {
  actor: Actor;
  /** Cơ sở + org của TAB đang mở — đã lọc qua `chonCoSoZaloCrm` ở nơi gọi. */
  coSo: { centerId: string; orgCode: string };
  /** `?compose=` thô trên URL. */
  compose?: string | null;
  /** `?lead=` thô trên URL. */
  lead?: string | null;
}): Promise<KetQuaDatTruoc> {
  const { actor, coSo } = input;
  try {
    const chuan = chuanBiDatTruoc({
      compose: input.compose,
      lead: input.lead,
      orgCode: coSo.orgCode,
    });
    // Không đủ tham số thì DỪNG TRƯỚC MỌI TRUY VẤN: màn này mở hằng ngày từ sidebar,
    // một lượt query thừa mỗi lần mở là chi phí trả mãi cho việc không ai yêu cầu.
    if (!chuan.ok) return { ma: chuan.ma };

    if (!nhinThayCoSo(actor, coSo.centerId)) {
      console.warn(
        `[zalocrm] từ chối đặt trước: cơ sở ${coSo.centerId} ngoài tầm nhìn của ${actor.userId}.`,
      );
      return { ma: "NGOAI_TAM_NHIN" };
    }

    // Phiếu đọc bằng `scopedDb` — cách ly cơ sở của `Lead` do CHÍNH nó lo, ở đây
    // không viết lại điều kiện quyền nào (luật cứng #1).
    const phieu = await scopedDb(actor).lead.findFirst({
      where: { id: chuan.leadId, deletedAt: null },
      select: { id: true, phone: true, centerId: true },
    });
    if (!phieu) {
      console.warn(
        `[zalocrm] từ chối đặt trước: ${actor.userId} không đọc được phiếu ${chuan.leadId}.`,
      );
      return { ma: "KHONG_DOC_DUOC_PHIEU" };
    }

    const dong = await db.zaloCrmThread.findFirst({
      where: { orgCode: coSo.orgCode, phone: chuan.so, deletedAt: null },
      select: CHON_DONG,
    });

    const quyet = quyetDinhDatTruoc({
      so: chuan.so,
      leadId: chuan.leadId,
      phieu,
      coSoCenterId: coSo.centerId,
      dong,
    });

    if (quyet.viec === "BO_QUA") return { ma: quyet.ma };
    if (quyet.viec === "CAP_NHAT") {
      await db.zaloCrmThread.update({ where: { id: quyet.id }, data: quyet.data });
      return { ma: "DA_CAP_NHAT", id: quyet.id };
    }

    return await taoDong({
      orgCode: coSo.orgCode,
      so: chuan.so,
      leadId: chuan.leadId,
      coSoCenterId: coSo.centerId,
      phieu,
    });
  } catch (err) {
    // Luật 4. Không ném, không `notFound()`, không đổi giao diện — chỉ để lại vết.
    console.error("[zalocrm] không ghi được dòng đặt trước:", err);
    return { ma: "GHI_HONG" };
  }
}

/**
 * Tạo dòng mới, và xử lý cuộc ĐUA với webhook (hoặc với chính tab thứ hai).
 *
 * `@@unique([orgCode, phone])` chặn đúng cuộc đua đó. Ném ở đây là báo lỗi cho một
 * chuyện vô hại — đọc lại rồi áp dụng chính bộ luật trên là đủ (cùng khuôn với
 * `napThreadTheoSdt` bên đường webhook).
 */
async function taoDong(input: {
  orgCode: string;
  so: string;
  leadId: string;
  coSoCenterId: string;
  phieu: { phone: string | null; centerId: string | null };
}): Promise<KetQuaDatTruoc> {
  try {
    const moi = await db.zaloCrmThread.create({
      data: {
        orgCode: input.orgCode,
        phone: input.so,
        leadId: input.leadId,
        // `orgUnitId` CỐ Ý không set tay: ghi kép `centerId → orgUnitId` làm ở MỘT
        // chỗ (`lib/org/dual-write.ts`, cắm trong `lib/db.ts`). Tự gọi
        // `orgUnitIdForCenter()` ở đây là dựng nguồn ghi thứ hai cho cùng một cột.
        centerId: input.coSoCenterId,
      },
      select: { id: true },
    });
    return { ma: "DA_TAO", id: moi.id };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;

    // Đọc lại KHÔNG lọc `deletedAt`: khoá unique tính cả dòng đã xoá mềm, nên nếu lọc
    // thì ta không hiểu vì sao vừa va khoá mà tra lại chẳng thấy gì.
    const lai = await db.zaloCrmThread.findFirst({
      where: { orgCode: input.orgCode, phone: input.so },
      select: { ...CHON_DONG, deletedAt: true },
    });
    if (!lai) return { ma: "GHI_HONG" };
    if (lai.deletedAt) {
      // Người vận hành đã gỡ dòng ấy có chủ đích. Máy không lật lại quyết định của
      // người — cùng luật với nick đã gỡ trong `nap-su-kien.ts`.
      console.warn(
        `[zalocrm] khoá (${input.orgCode}, ${input.so}) đang bị một dòng đã xoá mềm chiếm.`,
      );
      return { ma: "BI_XOA_MEM" };
    }

    const quyet = quyetDinhDatTruoc({
      so: input.so,
      leadId: input.leadId,
      phieu: input.phieu,
      coSoCenterId: input.coSoCenterId,
      dong: lai,
    });
    if (quyet.viec === "CAP_NHAT") {
      await db.zaloCrmThread.update({ where: { id: quyet.id }, data: quyet.data });
      return { ma: "DA_CAP_NHAT", id: quyet.id };
    }
    // `dong` khác null nên nhánh "TAO" không thể xảy ra lần thứ hai.
    return { ma: quyet.viec === "BO_QUA" ? quyet.ma : "DA_DUNG" };
  }
}
