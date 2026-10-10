import "server-only";
// lib/integrations/zalocrm/nick-admin.ts — BẢNG NICK + ĐỒNG BỘ NICK cho màn Tích hợp.
//
// =============================================================================
// 🔴 FILE NÀY **LÀ** LƯỚI CÁCH LY CỦA BẢNG `ZaloCrmNick`. Không có lưới nào khác.
//
// `ZaloCrmNick` nằm trong `SCOPE_EXEMPT` (`lib/db-scope.ts:205`) — cố ý, vì đây là
// bảng TRA CỨU ("nick này của ai, ở cơ sở nào") và vì `centerId` ở đó NULL được
// (orgCode chưa ánh xạ cơ sở), nên `injectScope` chèn `centerId IN (…)` trần sẽ ẩn
// đúng nhóm cần người xử lý khỏi chính người phải xử lý nó.
//
// ĐỔI LẠI: `scopedDb(actor).zaloCrmNick.findMany({})` trả nick của MỌI cơ sở và
// `passesScope` trả `true` cho mọi dòng — không lỗi, không cảnh báo. Chú thích ở
// `db-scope.ts` chỉ thẳng sang file này làm nơi gác. Nên:
//
//   · ĐỌC  → `whereNickTheoActor(actor)`, luôn kèm `deletedAt: null` (bảng này KHÔNG
//            nằm trong `SOFT_DELETE_MODELS` ⇒ không ai tự thêm hộ).
//   · GHI  → `nickCoTheGhi(actor, nick)` TRƯỚC mỗi `update`/`create`. `scopedDb` chỉ
//            chặn 7 method ĐỌC; mọi đường ghi trần phơi ra.
//
// Hai hàm đó THUẦN và có test (`nick-admin.test.ts`). Sửa luật ở chỗ khác = mất lưới.
//
// ── VÌ SAO KHÔNG DÙNG LẠI `traCauHinhOrg` CỦA `config.ts` ────────────────────
// Hàm đó phục vụ đường WEBHOOK: nó đòi `ZALOCRM_WEBHOOK_SECRETS` (thiếu ⇒ 503) và tra
// một org mỗi lượt. Màn Tích hợp cần đúng chiều ngược lại — liệt kê MỌI org, chạy được
// cả khi bí mật chưa khai (GĐ0), và trong một lượt truy vấn. Ghép ánh xạ ở đây là
// `ghepAnhXaOrg`, THUẦN, không đụng bí mật.
// =============================================================================
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { orgUnitIdForCenter } from "@/lib/org/org-service";
import { getSetting } from "@/lib/settings/service";
import { goiZalocrm } from "./client";
import { ghiNhatKyZalocrm, providerLogKey } from "./log";

/** Đường dẫn API danh sách nick trên máy chủ ZaloCRM (fork). */
// 🔴 ĐƯỜNG `/api/public/*`, KHÔNG PHẢI `/api/v1/*` (sửa 13/09/2026). Bản đầu trỏ vào
// `/api/v1/zalo-accounts`, mà đường đó gác bằng JWT của người dùng còn Sata chỉ cầm khoá
// API ⇒ mọi lượt đồng bộ nick trả **401** và màn Tích hợp chỉ hiện bảng rỗng. Hỏng câm:
// `dongBoNick` nuốt lỗi gọi thành một dòng nhật ký, không ai thấy gì trên màn.
// Đợt đối chiếu 06/09 chỉ soi HÌNH DẠNG payload của endpoint kia mà không thử XÁC THỰC —
// đó là chỗ lọt. Endpoint public tương ứng do bản phái sinh thêm vào, trả cùng hình dạng.
export const DUONG_DAN_DANH_SACH_NICK = "/api/public/zalo-accounts";

/** Trần số dòng đọc lên màn. Ba cơ sở × vài nick — 200 là rộng rãi, và có trần. */
const TRAN_DONG_BANG = 200;

/** Trần số nick nhận từ một lượt gọi. Bên kia là máy chủ của người khác. */
const TRAN_NICK_MOT_LUOT = 500;

/**
 * Phần `Actor` mà luật tầm nhìn cần.
 *
 * Khai theo CẤU TRÚC (không `import type { Actor }`) vì hai lẽ: test dựng được đối
 * tượng ba trường thay vì cả một Actor thật, và module này không kéo theo cây phụ
 * thuộc của `lib/auth/actor.ts`. Cùng khuôn `LeadTargetScopeActor`
 * (`lib/reports/lead-target.ts:63`).
 */
export type ActorTamNhinNick = {
  isSuperAdmin: boolean;
  isHoLevel: boolean;
  visibleCenterIds: string[];
};

/** Mảnh `where` cho `zaloCrmNick.findMany` trên màn Tích hợp. */
export type WhereNick = {
  deletedAt: null;
  OR?: ({ centerId: { in: string[] } } | { centerId: null })[];
};

/**
 * Những nick actor được NHÌN.
 *
 * - Hội sở / quản trị: tất cả. Họ là người giữ bảng ánh xạ `zalocrm.orgCodes`.
 * - Quản lý cơ sở: nick của cơ sở mình **cộng** nick CHƯA ánh xạ cơ sở
 *   (`centerId = null`). Nhóm chưa ánh xạ không thuộc về ai cả; giấu nó đi là giấu
 *   đúng thứ cần người xử lý — và bảng này không chứa dữ liệu khách (không SĐT,
 *   không email, `displayName` là tên hồ sơ Zalo của chính NHÂN VIÊN).
 * - Chưa được gán cơ sở nào ⇒ `{ in: [] }`: chỉ còn nhóm chưa ánh xạ. KHÔNG có nhánh
 *   nào rơi về "thấy hết" — fail-closed.
 *
 * `deletedAt: null` là BẮT BUỘC ở mọi truy vấn: `ZaloCrmNick` có cột xoá mềm nhưng
 * KHÔNG nằm trong `SOFT_DELETE_MODELS` (`lib/soft-delete.ts`) ⇒ tầng base không chèn
 * hộ, nick đã gỡ sẽ hiện lại như chưa từng gỡ.
 */
export function whereNickTheoActor(actor: ActorTamNhinNick): WhereNick {
  if (actor.isSuperAdmin || actor.isHoLevel) return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [{ centerId: { in: actor.visibleCenterIds } }, { centerId: null }],
  };
}

/**
 * Actor có được GHI lên một dòng nick không.
 *
 * ⚠️ Đây là cổng ghi DUY NHẤT của bảng — `scopedDb` chỉ auto-scope 7 method đọc, mọi
 * `update`/`create` đi trần (CLAUDE.md, luật `scopedDb` KHÔNG che write).
 *
 * Nick CHƯA ánh xạ cơ sở (`centerId = null`): ĐỌC được (xem trên) nhưng **không ghi
 * được** ở cấp cơ sở. Cố ý bất đối xứng: nhận một nick vô chủ về cơ sở mình nghĩa là
 * sửa ánh xạ org→cơ sở, mà ánh xạ đó là setting TOÀN CỤC
 * (`zalocrm.orgCodes`, `centerOverridable: false`) — việc của hội sở. Cho cấp cơ sở
 * ghi vào nhóm null là mở đường để CS1 nhận nick thật ra của CS2.
 */
export function nickCoTheGhi(
  actor: ActorTamNhinNick,
  nick: { centerId: string | null },
): boolean {
  if (actor.isSuperAdmin || actor.isHoLevel) return true;
  if (!nick.centerId) return false;
  return actor.visibleCenterIds.includes(nick.centerId);
}

/** Mảnh `where` cho `integrationLog.findMany`. LUÔN có `provider` (ăn index). */
export type WhereNhatKy = { provider: { startsWith: string } | { in: string[] } };

/**
 * Nhật ký ZaloCRM actor được đọc.
 *
 * `IntegrationLog` cũng KHÔNG thuộc `SCOPED_MODELS`/`SCOPE_EXEMPT`/
 * `NULL_IS_GLOBAL_MODELS` ⇒ `scopedDb` cho đi qua nguyên vẹn. Cách ly ở đây dựa vào
 * quy ước `provider = "ZALOCRM:<orgCode>"` (`log.ts`).
 *
 * ⚠️ `where.provider` là BẮT BUỘC ở mọi nhánh: chỉ mục duy nhất của bảng là
 * `[provider, status, createdAt]`, bỏ nó ra là quét toàn bảng.
 *
 * Khác với bảng nick, ở đây cấp cơ sở KHÔNG được xem org chưa ánh xạ: một dòng nhật
 * ký không quy được về cơ sở nào thì thuộc về người giữ bảng ánh xạ (hội sở), và nội
 * dung nhật ký là chuỗi lỗi/hành động của org khác — khác hẳn về rủi ro so với một
 * dòng cấu hình nick. Không org nào ⇒ `{ in: [] }` (RỖNG), tuyệt đối không bỏ điều
 * kiện: "mảng rỗng thì thôi khỏi lọc" là cách lật cách ly thành xem-tất-cả.
 */
export function whereNhatKyZalocrm(
  actor: ActorTamNhinNick,
  orgCodes: readonly string[],
): WhereNhatKy {
  if (actor.isSuperAdmin || actor.isHoLevel) return { provider: { startsWith: "ZALOCRM" } };
  return { provider: { in: orgCodes.map((o) => providerLogKey(o)) } };
}

// ── Cảnh báo im lặng ─────────────────────────────────────────────────────────

export type NickDeCanhBao = {
  zcrmAccountId: string;
  orgCode: string;
  displayName: string | null;
  status: string;
  lastEventAt: Date | null;
};

export type CanhBaoNick = {
  zcrmAccountId: string;
  orgCode: string;
  displayName: string | null;
  /** Số giờ im lặng (làm tròn xuống). `null` = CHƯA TỪNG có sự kiện nào. */
  gioImLang: number | null;
};

const MOT_GIO_MS = 3_600_000;

/**
 * Nick "báo CONNECTED mà im lặng" — ca hỏng câm nguy hiểm nhất của trục này.
 *
 * Vì sao nó nguy hiểm hơn một nick DISCONNECTED: nick rớt kết nối hiện rõ ở cột trạng
 * thái, ai nhìn cũng thấy. Còn nick báo connected mà không đẩy sự kiện nào về thì mọi
 * đèn đều xanh — khách vẫn nhắn, không ai nhận, và Sale kết luận là "dạo này vắng
 * khách". Không có cảnh báo thì thứ duy nhất phát hiện được nó là một lời phàn nàn.
 *
 * `lastEventAt = null` + CONNECTED **vẫn kêu**, không phải báo động giả: nó nghĩa là
 * ZaloCRM nói nick đang nối nhưng Sata chưa từng nhận được gì từ nick đó — triệu
 * chứng kinh điển của webhook chưa cắm (sai `webhook_url`, sai bí mật).
 *
 * DISCONNECTED/UNKNOWN KHÔNG vào đây: cái trước đã hiện ở cột trạng thái, cái sau
 * nghĩa là chưa đồng bộ lần nào — kêu lên chỉ dạy người ta tắt mắt với chuông.
 */
export function locNickImLang(
  nicks: readonly NickDeCanhBao[],
  nguongGio: number,
  bayGio: Date,
): CanhBaoNick[] {
  const ra: CanhBaoNick[] = [];
  for (const n of nicks) {
    if (n.status !== "CONNECTED") continue;
    if (!n.lastEventAt) {
      ra.push({ ...chonTruong(n), gioImLang: null });
      continue;
    }
    const gio = (bayGio.getTime() - n.lastEventAt.getTime()) / MOT_GIO_MS;
    // So sánh trên số giờ THẬT rồi mới làm tròn để hiển thị: làm tròn trước thì nick
    // im 2,9 giờ thành "2" và lọt qua ngưỡng 2.
    if (gio > nguongGio) ra.push({ ...chonTruong(n), gioImLang: Math.floor(gio) });
  }
  return ra;
}

function chonTruong(n: NickDeCanhBao) {
  return { zcrmAccountId: n.zcrmAccountId, orgCode: n.orgCode, displayName: n.displayName };
}

// ── Đọc phản hồi của fork ────────────────────────────────────────────────────

export type TrangThaiNickDb = "UNKNOWN" | "CONNECTED" | "DISCONNECTED";

export type NickTuZalocrm = {
  zcrmAccountId: string;
  displayName: string | null;
  status: TrangThaiNickDb;
  /**
   * `User.id` của SATA, đọc từ `owner.externalId` bên fork (đường SSO ghi xuống).
   * CHƯA kiểm tồn tại — `locNguoiDungHopLe` lọc ở bước sau.
   *
   * 🔴 KHÔNG phải `ownerUserId` của fork. Trường đó cũng có trong phản hồi nhưng là id
   * NỘI BỘ của hệ bên kia: đưa vào đây thì không khớp `User` nào của Sata, bị lọc sạch,
   * và cột "người sở hữu" ở màn Tích hợp rỗng vĩnh viễn mà không một dòng lỗi nào.
   */
  ownerUserId: string | null;
};

const NHAN_NOI = new Set(["connected", "online", "active", "ready", "logged_in"]);
const NHAN_ROT = new Set(["disconnected", "offline", "inactive", "error", "logged_out"]);

/**
 * Đọc danh sách nick từ thân phản hồi.
 *
 * HÌNH DẠNG THẬT — đã đối chiếu mã fork 13/09/2026 (`backend/src/modules/zalo/zalo-routes.ts`,
 * `GET /api/v1/zalo-accounts`): trả **MẢNG TRẦN**, mỗi phần tử có `id`, `displayName`,
 * `phone`, `status` (chuỗi tự do: `connected` · `disconnected` · `qr_pending`),
 * `ownerUserId` (id NỘI BỘ của fork), `liveStatus`, và `owner: { id, fullName, email,
 * externalId }` — `owner.externalId` mới là `User.id` bên Sata.
 *
 * ⚠️ Vẫn nhận `unknown` và vẫn chấp cả `{data:[…]}` lẫn mảng trần: đối chiếu một lần
 * không phải là hợp đồng, bên kia nâng cấp là hình dạng đổi. Hàm này **không bao giờ
 * ném** — một đổi tên trường phải thành "0 nick, có ghi nhật ký", không được thành 500
 * giữa màn Tích hợp. Khi payload đổi thì sửa ĐÚNG hàm này + test.
 *
 * Dòng thiếu id bị BỎ, không bịa khoá: `zcrmAccountId` là `@unique` và cũng chính là
 * `InboxConversation.accountId` — bịa một khoá ở đây là gộp hội thoại của hai nick.
 */
export function docDanhSachNickTraVe(raw: unknown): NickTuZalocrm[] {
  const mang = timMang(raw);
  const ra: NickTuZalocrm[] = [];
  for (const item of mang.slice(0, TRAN_NICK_MOT_LUOT)) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const id = chuoi(o.id) ?? chuoi(o.accountId) ?? chuoi(o.account_id) ?? chuoi(o.zaloAccountId);
    if (!id) continue;
    ra.push({
      zcrmAccountId: id,
      displayName:
        chuoi(o.displayName) ?? chuoi(o.display_name) ?? chuoi(o.name) ?? chuoi(o.phoneName),
      status: docTrangThai(o),
      // CHỈ đọc id BÊN SATA. `o.ownerUserId` của fork CỐ Ý không nằm trong danh sách:
      // nó là id nội bộ của hệ bên kia, luôn bị `locNguoiDungHopLe` loại, nên nhận nó
      // vào đây chỉ để lại một niềm tin sai trong mã.
      ownerUserId:
        chuoi(chuTu(o)?.externalId) ??
        chuoi(chuTu(o)?.external_id) ??
        chuoi(o.ownerExternalId) ??
        chuoi(o.externalId) ??
        chuoi(o.external_id),
    });
  }
  return ra;
}

function timMang(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null) {
    for (const k of ["data", "accounts", "items", "results"]) {
      const v = (raw as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/** Khối `owner` lồng trong mỗi dòng nick — `null` khi fork không kèm (nick chưa có chủ). */
function chuTu(o: Record<string, unknown>): Record<string, unknown> | null {
  const v = o.owner;
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function chuoi(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Trạng thái nick. Nhãn lạ ⇒ `UNKNOWN`, KHÔNG ép bừa thành `CONNECTED`.
 *
 * Ép bừa là tự tay tạo ra ca xấu nhất: hàng chờ cảnh báo đầy nick "connected" giả,
 * chuông kêu suốt, người vận hành tắt mắt — rồi nick chết thật thì không ai nhìn.
 */
function docTrangThai(o: Record<string, unknown>): TrangThaiNickDb {
  const s = chuoi(o.status)?.toLowerCase();
  if (s && NHAN_NOI.has(s)) return "CONNECTED";
  if (s && NHAN_ROT.has(s)) return "DISCONNECTED";
  const b = o.isConnected ?? o.is_connected ?? o.connected;
  if (typeof b === "boolean") return b ? "CONNECTED" : "DISCONNECTED";
  return "UNKNOWN";
}

// ── Ánh xạ org ↔ cơ sở ───────────────────────────────────────────────────────

export type AnhXaOrg = {
  orgCode: string;
  /** `Center.code` — thứ người vận hành gõ vào setting. */
  centerCode: string;
  /** `null` = mã cơ sở trong setting không khớp `Center` nào. */
  centerId: string | null;
  centerName: string | null;
};

/**
 * Ghép setting `zalocrm.orgCodes` với danh sách cơ sở. THUẦN.
 *
 * ⚠️ CHIỀU CỦA ÁNH XẠ LÀ HỢP ĐỒNG (`lib/settings/registry.ts:720`): khoá = `Center.code`,
 * giá trị = `orgCode`. Đảo chiều lúc đọc là ánh xạ về cơ sở khác, im lặng.
 */
export function ghepAnhXaOrg(
  setting: Record<string, string>,
  // `Center.code` là NULLABLE trong schema. Cơ sở chưa đặt mã thì không khớp được
  // khoá nào trong setting — bỏ ra khỏi bảng tra thay vì để `null` làm khoá, kẻo hai
  // cơ sở chưa đặt mã cùng khớp một mục và một trong hai biến mất.
  centers: readonly { id: string; code: string | null; name: string }[],
): AnhXaOrg[] {
  const theoMa = new Map(
    centers.filter((c): c is { id: string; code: string; name: string } => !!c.code).map((c) => [c.code, c]),
  );
  return Object.entries(setting).map(([centerCode, orgCode]) => {
    const c = theoMa.get(centerCode);
    return {
      orgCode,
      centerCode,
      centerId: c?.id ?? null,
      centerName: c?.name ?? null,
    };
  });
}

/** Org actor được thao tác. Cấp cơ sở: chỉ org đã ánh xạ về cơ sở mình. */
function orgTrongTam(actor: ActorTamNhinNick, anhXa: readonly AnhXaOrg[]): AnhXaOrg[] {
  return anhXa.filter((a) => nickCoTheGhi(actor, { centerId: a.centerId }));
}

async function docAnhXa(): Promise<AnhXaOrg[]> {
  const [setting, centers] = await Promise.all([
    getSetting("zalocrm.orgCodes").catch((err) => {
      // Setting hỏng KHÔNG được làm sập cả màn Tích hợp (4 mục khác đang ở đó).
      console.error("[zalocrm] không đọc được setting zalocrm.orgCodes:", err);
      return {} as Record<string, string>;
    }),
    // CỐ Ý không lọc `isActive`: một cơ sở tạm ngừng vẫn có nick cần nhìn thấy —
    // cùng lý do với `traCoSoTheoOrg` trong `config.ts`. Bảng `Center` có 2–3 dòng.
    db.center.findMany({ select: { id: true, code: true, name: true } }),
  ]);
  return ghepAnhXaOrg(setting, centers);
}

// ── Bảng nick trên màn ───────────────────────────────────────────────────────

/** Một người đang được giao nick, kèm mức — đủ để hiển thị, không cần tra thêm. */
export type NguoiDuocGiao = { sataUserId: string; ten: string; mucQuyen: string };

export type DongNick = {
  zcrmAccountId: string;
  orgCode: string;
  displayName: string | null;
  status: string;
  lastEventAt: Date | null;
  centerId: string | null;
  centerName: string | null;
  /**
   * Những người ĐƯỢC GIAO nick này (`ZaloCrmNickGiao`).
   *
   * Mảng RỖNG = chưa giao ai ⇒ cả cơ sở dùng được ở mức `chat` — trạng thái BÌNH
   * THƯỜNG của nick mới, KHÔNG phải lỗi. Đừng vẽ nó thành cảnh báo đỏ.
   *
   * ⚠️ KHÔNG chứa quản lý cơ sở: họ có `admin` TỰ ĐỘNG mà không cần dòng giao nào
   * (`pham-vi-nick.ts`). Bảng này in ra thứ người dùng SỬA ĐƯỢC; trộn người không sửa
   * được vào là hứa một nút không tồn tại.
   */
  giao: NguoiDuocGiao[];
};

export type TongQuanNick = {
  rows: DongNick[];
  canhBao: CanhBaoNick[];
  /** Ngưỡng đang áp (giờ) — hiện lên màn để người đọc biết cảnh báo dựa trên số nào. */
  nguongGio: number;
  /** Org actor được nhìn — dùng dựng `where` cho nhật ký, và cũng là phạm vi đồng bộ. */
  orgCodes: string[];
};

/**
 * Dữ liệu cho mục "ZaloCRM" của màn Tích hợp. Ba lượt truy vấn, không N+1.
 *
 * ⚠️ `db` TRẦN ở đây là CỐ Ý và bắt buộc: `scopedDb` không cách ly bảng này (xem đầu
 * file), nên đi qua nó chỉ tạo cảm giác an toàn giả. Lưới thật là `whereNickTheoActor`.
 */
export async function docTongQuanNick(actor: ActorTamNhinNick): Promise<TongQuanNick> {
  const anhXa = await docAnhXa();
  // `2` khớp default trong `lib/settings/registry.ts`. Nuốt lỗi ở đây là cố ý: setting
  // hỏng chỉ được làm SAI ngưỡng cảnh báo, không được làm sập cả màn Tích hợp (bốn mục
  // khác đang ở đó) — `getSetting` NÉM khi key chưa khai registry.
  const nguongGio = await getSetting("zalocrm.idleAlertHours").catch(() => 2);

  const rows = await db.zaloCrmNick.findMany({
    where: whereNickTheoActor(actor),
    orderBy: [{ orgCode: "asc" }, { createdAt: "asc" }],
    take: TRAN_DONG_BANG,
    select: {
      zcrmAccountId: true,
      orgCode: true,
      displayName: true,
      status: true,
      lastEventAt: true,
      centerId: true,
      giao: { select: { sataUserId: true, mucQuyen: true }, orderBy: { createdAt: "asc" } },
    },
  });

  // Tên người được giao: MỘT câu tra cho cả bảng, không một câu mỗi nick. Gộp id của
  // mọi dòng giao rồi tra một lượt — bảng có trần `TRAN_DONG_BANG` dòng, mỗi dòng vài
  // người, nên tập id vẫn nhỏ.
  const userIds = [...new Set(rows.flatMap((r) => r.giao.map((g) => g.sataUserId)))];
  const users = userIds.length
    ? await db.user.findMany({
        where: { id: { in: userIds }, deletedAt: null },
        select: { id: true, name: true, email: true },
      })
    : [];
  const tenTheoId = new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.id]));
  const tenCoSo = new Map(anhXa.filter((a) => a.centerId).map((a) => [a.centerId!, a.centerName]));

  return {
    rows: rows.map((r) => ({
      ...r,
      centerName: r.centerId ? (tenCoSo.get(r.centerId) ?? null) : null,
      // Người đã bị xoá mềm rụng khỏi `tenTheoId` ⇒ hiện `(đã nghỉ)` thay vì một ô
      // trống. Dòng giao của họ vẫn còn trong DB nhưng KHÔNG còn hiệu lực: lượt đối
      // soát lọc theo `nguoiCuaCoSo`, nên họ đã mất quyền rồi — màn phải nói đúng điều
      // đó, đừng in tên như người đang dùng được.
      giao: r.giao.map((g) => ({
        sataUserId: g.sataUserId,
        ten: tenTheoId.get(g.sataUserId) ?? "(đã nghỉ)",
        mucQuyen: g.mucQuyen,
      })),
    })),
    canhBao: locNickImLang(rows, nguongGio, new Date()),
    nguongGio,
    orgCodes: orgTrongTam(actor, anhXa).map((a) => a.orgCode),
  };
}

// ── Đồng bộ ──────────────────────────────────────────────────────────────────

export type MaLoiDongBo =
  /** Org nằm ngoài tầm ghi của actor — dừng TRƯỚC khi gọi mạng. */
  | "NGOAI_TAM"
  /** Mã lỗi từ `client.ts` (CHUA_CAU_HINH/HET_GIO/KHONG_KET_NOI/LOI_HTTP/…). */
  | string;

export type KetQuaDongBoOrg = {
  orgCode: string;
  ok: boolean;
  ma?: MaLoiDongBo;
  thongDiep?: string;
  soNickNhan: number;
  soTao: number;
  soCapNhat: number;
  /** Bỏ qua: nick đã xoá mềm, hoặc dòng đã có nhưng thuộc cơ sở ngoài tầm ghi. */
  soBoQua: number;
};

/**
 * Kéo danh sách nick từ ZaloCRM về, cho từng org trong tầm của actor.
 *
 * ⚠️ **KHÔNG BAO GIỜ ghi `lastEventAt`.** Đây là cái bẫy đắt nhất của cả lô: cột đó là
 * đầu vào DUY NHẤT của cảnh báo "connected mà im lặng". Nếu nút Đồng bộ chạm vào nó
 * thì mỗi lần người vận hành bấm cho yên tâm, họ vừa xoá đúng bằng chứng nói rằng nick
 * đã chết — cảnh báo trở thành thứ chỉ tắt được chứ không bao giờ đúng. `lastEventAt`
 * chỉ do sự kiện THẬT từ webhook đặt (`nap-su-kien.ts`).
 *
 * Ba luật ghi khác, cùng một tinh thần "máy không lật lại quyết định của người":
 *  · nick ĐÃ XOÁ MỀM → không hồi sinh (người gỡ nó có chủ đích: nhân sự nghỉ, nick khoá);
 *  · `centerId`/`orgUnitId` → chỉ điền vào chỗ TRỐNG, không đè;
 *  · `sataUserId` → chỉ SET khi khớp một `User` có thật, không bao giờ XOÁ. Fork không
 *    gửi kèm chủ nick là chuyện thường; hiểu thành "nick không còn chủ" là tự tay gỡ
 *    phân công của người.
 *
 * Không ném: một org hỏng thì ghi nhật ký FAILED rồi đi tiếp org sau.
 */
/**
 * 🔴 SỰ CỐ PROD 24/09/2026 — VÌ SAO HÀM NÀY KHÔNG CÒN GHI `sataUserId`.
 *
 * `ZaloAccount.ownerUserId` bên ZaloCRM là **chủ nick do máy bên kia ghi nhận**, không
 * phải một quyết định phân công của ai ở Sata. Hàm này từng ánh xạ nó sang
 * `ZaloCrmNick.sataUserId` — hồi cột ấy chỉ để HIỂN THỊ ("Sale sở hữu") thì vô hại.
 *
 * Rồi cột ấy được đọc như **"nick đã giao cho ai"**, và migration `20260924120000` chép
 * nó sang `ZaloCrmNickGiao`. Một giá trị MÁY ĐOÁN bỗng thành một lượt phân quyền độc
 * quyền — và vì "đã giao ai đó" nghĩa là "những người còn lại KHÔNG được dùng", mỗi nick
 * cắt còn đúng một người.
 *
 * Đo trên prod ngay sau lượt triển khai: nick Cô Liên chỉ còn Cô Liên, nick Cô Vân chỉ
 * còn Cô Vân, nick CS1 chỉ còn Ms Lộc — và **Cô Diệu (CS1) còn 0 nick**, tức mở hộp thư
 * ra TRỐNG. Không lỗi nào báo: đó là một lượt gỡ quyền "thành công".
 *
 * ── BÀI HỌC, và nó rộng hơn ZaloCRM ────────────────────────────────────────────────
 * Một cột do ĐỒNG BỘ ghi và một cột do NGƯỜI quyết định là HAI THỨ KHÁC NHAU, kể cả khi
 * chúng cùng kiểu và cùng tên. Đọc cột thứ nhất như cột thứ hai là mượn một con số máy
 * đoán để cắt quyền của người thật.
 *
 * ⇒ Phân công (ai được dùng nick nào, mức nào) CHỈ ở `ZaloCrmNickGiao`, và chỉ
 *   `datGiaoNick` ghi. Đường đồng bộ KHÔNG chạm vào nó, và từ nay không chạm cả cột cũ.
 *
 * ⚠️ Đừng "khôi phục" dòng ghi ấy vì thấy cột `sataUserId` trống. Trống là ĐÚNG.
 */
export async function dongBoNick(
  actor: ActorTamNhinNick,
  opts?: { orgCode?: string | null },
): Promise<KetQuaDongBoOrg[]> {
  const anhXa = await docAnhXa();
  const chon = opts?.orgCode
    ? anhXa.filter((a) => a.orgCode === opts.orgCode)
    : orgTrongTam(actor, anhXa);

  const ra: KetQuaDongBoOrg[] = [];
  // TUẦN TỰ, không `Promise.all`: đầu kia là một VPS sau Cloudflare Tunnel, và cả loạt
  // request song song từ một hàm serverless là cách nhanh nhất để tự làm mình nghẽn.
  for (const org of chon) {
    ra.push(await dongBoMotOrg(actor, org));
  }
  return ra;
}

async function dongBoMotOrg(
  actor: ActorTamNhinNick,
  org: AnhXaOrg,
): Promise<KetQuaDongBoOrg> {
  const khung = { orgCode: org.orgCode, soNickNhan: 0, soTao: 0, soCapNhat: 0, soBoQua: 0 };

  // Gác TRƯỚC khi chạm mạng: người không được ghi org này thì cũng không có lý do gì
  // để làm máy chủ bên kia làm việc hộ.
  if (!nickCoTheGhi(actor, { centerId: org.centerId })) {
    return { ...khung, ok: false, ma: "NGOAI_TAM", thongDiep: "Cơ sở này ngoài tầm của bạn." };
  }

  const kq = await goiZalocrm<unknown>({
    orgCode: org.orgCode,
    duongDan: DUONG_DAN_DANH_SACH_NICK,
  });
  if (!kq.ok) {
    await ghiNhatKyZalocrm({
      orgCode: org.orgCode,
      action: "SYNC_NICKS",
      status: "FAILED",
      direction: "PUSH",
      errorMessage: `${kq.ma}: ${kq.thongDiep}`,
    });
    return { ...khung, ok: false, ma: kq.ma, thongDiep: kq.thongDiep };
  }

  const nhan = docDanhSachNickTraVe(kq.data);
  khung.soNickNhan = nhan.length;

  if (nhan.length) {
    const orgUnitId = org.centerId ? await orgUnitIdForCenter(org.centerId) : null;
    // KHÔNG lọc `deletedAt` ở đây: phải THẤY dòng đã xoá mềm, nếu không nhánh `create`
    // bên dưới va `@unique` mà không hiểu vì sao (cùng bài học `napNick`).
    const daCo = await db.zaloCrmNick.findMany({
      where: { zcrmAccountId: { in: nhan.map((n) => n.zcrmAccountId) } },
      select: {
        id: true,
        zcrmAccountId: true,
        displayName: true,
        status: true,
        sataUserId: true,
        centerId: true,
        orgUnitId: true,
        deletedAt: true,
      },
    });
    const theoAcc = new Map(daCo.map((d) => [d.zcrmAccountId, d]));
    const chuHopLe = await locChuNickCoThat(nhan);

    for (const n of nhan) {
      const cu = theoAcc.get(n.zcrmAccountId);
      const chu = n.ownerUserId && chuHopLe.has(n.ownerUserId) ? n.ownerUserId : null;

      if (cu?.deletedAt) {
        khung.soBoQua++;
        continue;
      }
      if (cu) {
        // Gác LẦN HAI ở mức DÒNG: dòng đã tồn tại có thể mang cơ sở khác với ánh xạ
        // org hiện tại (ánh xạ vừa đổi, hoặc người đã gán tay). Tin vào lần gác ở mức
        // org là bỏ lọt đúng ca đó.
        if (!nickCoTheGhi(actor, cu)) {
          khung.soBoQua++;
          continue;
        }
        const data: Prisma.ZaloCrmNickUpdateInput = {};
        if (n.displayName && n.displayName !== cu.displayName) data.displayName = n.displayName;
        if (n.status !== "UNKNOWN" && n.status !== cu.status) data.status = n.status;
        // 🔴 KHÔNG GHI `sataUserId` NỮA (sự cố prod 24/09/2026 — xem khối dưới).
        // `chu` vẫn tính ở trên vì nhánh `create` còn dùng, và vì bỏ hẳn phép tính là
        // mất luôn `locChuNickCoThat` — thứ duy nhất kiểm `ownerUserId` có phải `User`
        // thật của Sata không.
        if (!cu.centerId && org.centerId) data.centerId = org.centerId;
        if (!cu.orgUnitId && orgUnitId) data.orgUnitId = orgUnitId;
        if (Object.keys(data).length === 0) continue; // không có gì đổi ⇒ không ghi
        await db.zaloCrmNick.update({ where: { id: cu.id }, data });
        khung.soCapNhat++;
        continue;
      }

      try {
        await db.zaloCrmNick.create({
          data: {
            zcrmAccountId: n.zcrmAccountId,
            orgCode: org.orgCode,
            displayName: n.displayName,
            // `null`, KHÔNG phải `chu` — xem khối 🔴 ở đầu hàm. Nick mới quét QR ra
            // đời ở trạng thái CHƯA GIAO AI, tức cả cơ sở dùng chung; đó là mặc định
            // đúng và cũng là mặc định an toàn.
            sataUserId: null,
            centerId: org.centerId,
            orgUnitId,
            // `lastEventAt` để NULL — xem khối chú thích của `dongBoNick`.
          },
        });
        khung.soTao++;
      } catch (err) {
        // Hai người cùng bấm Đồng bộ: `@unique` chặn đúng cuộc đua đó. Đọc lại là thừa,
        // KHÔNG ném — ném ở đây là cả lượt đồng bộ đỏ vì một cuộc đua vô hại.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") {
          throw err;
        }
        khung.soBoQua++;
      }
    }
  }

  await ghiNhatKyZalocrm({
    orgCode: org.orgCode,
    action: "SYNC_NICKS",
    status: "SUCCESS",
    direction: "PUSH",
    responsePayload: {
      soNickNhan: khung.soNickNhan,
      soTao: khung.soTao,
      soCapNhat: khung.soCapNhat,
      soBoQua: khung.soBoQua,
    },
  });
  return { ...khung, ok: true };
}

/**
 * Lọc ra những `ownerUserId` THẬT SỰ là `User` của Sata.
 *
 * Chuỗi này do máy chủ bên kia gửi sang; gán bừa là treo nick cho một tài khoản không
 * tồn tại (và về sau là một `LeadActivity` gắn sai người). Không khớp ⇒ `null`, và đó
 * là trạng thái BÌNH THƯỜNG ở GĐ1 — chưa ai nối tài khoản ZaloCRM với tài khoản Sata.
 */
async function locChuNickCoThat(nhan: readonly NickTuZalocrm[]): Promise<Set<string>> {
  const ids = [...new Set(nhan.map((n) => n.ownerUserId).filter((v): v is string => !!v))];
  if (!ids.length) return new Set();
  const users = await db.user.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  return new Set(users.map((u) => u.id));
}
