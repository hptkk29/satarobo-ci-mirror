import "server-only";
// lib/ai-lead/dich-vu/bo-quy-tac-db.ts — ĐỌC / CHỤP phiên bản bộ quy tắc (Rule Builder). Khuôn `AiLeadCatalogSnapshot`: chỉ INSERT, version tăng dần, bất biến.
//
// MÔ HÌNH (đừng đổi mà không đọc):
//   · Cột `AiLeadAgentPage.routingCenterId` / `.autoCreate` VẪN là sự thật chạy nhanh của Gateway (xac-thuc.ts đọc chúng cùng lượt tra agent — đường nóng KHÔNG đổi, N1 không đổi).
//   · `AiLeadRuleSet` là ẢNH CHỤP có version của TOÀN BỘ cấu hình nghiệp vụ SAU MỖI lần đổi (Page→cơ sở, tự tạo lead + ràng buộc thu hẹp, SLA, người nhận thông báo/leo thang).
//     Mọi hành động Admin đổi cột (đặt cơ sở nhận, bật/tắt tự tạo lead, thêm/gỡ Page) gọi `chupBoQuyTac` TRONG CÙNG giao dịch ⇒ lịch sử đầy đủ, không lệch cột↔phiên bản.
//   · Khôi phục = ghi lại cột theo phiên bản cũ rồi chụp phiên bản MỚI (`savedFromVersion`); phiên bản cũ không bao giờ bị sửa.
//   · SLA / NOTIFY / ràng buộc thu hẹp chỉ sống trong phiên bản; engine đọc phiên bản hiện hành MỘT lần mỗi lượt (hàm thuần ở bo-quy-tac.ts).
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { boQuyTacSchema, chuoiChuan, khoaQuyTac, type BoQuyTac, type QuyTac, type QuyTacAutoCreate } from "./bo-quy-tac-schema";

type Doc = Pick<typeof db, "aiLeadRuleSet"> | Pick<Prisma.TransactionClient, "aiLeadRuleSet">;

export type BanGhiBoQuyTac = { version: number; bo: BoQuyTac; publishedAt: Date; publishedById: string | null; reason: string; savedFromVersion: number | null };

/** Payload lưu trong DB → bộ quy tắc hợp lệ, hoặc null nếu hỏng (dữ liệu hỏng KHÔNG được làm sập Gateway: engine rơi về tham số `ai.*`). */
export function docPayloadBoQuyTac(json: Prisma.JsonValue | null | undefined): BoQuyTac | null {
  const r = boQuyTacSchema.safeParse(json);
  return r.success ? r.data : null;
}

/**
 * Phiên bản HIỆN HÀNH + CỜ HỎNG. `ban: null, hong: false` = chưa từng có phiên bản (hợp lệ: chưa ai cấu hình quy tắc). `ban: null, hong: true` = CÓ phiên bản nhưng payload không đọc được —
 * KHÁC HẲN «chưa có»: ràng buộc THU HẸP tự tạo lead có thể nằm trong chính phiên bản hỏng, nên chỗ gọi phải coi là «không biết» và đi đường an toàn (review độc lập 28/10:
 * trước đây hỏng ≡ chưa có ⇒ `thuHepTuTao(null)` cho qua ⇒ lead được tự tạo mà không còn ràng buộc đồng ý / cơ sở nào).
 */
export async function docTrangThaiBoQuyTac(client: Doc = db): Promise<{ ban: BanGhiBoQuyTac | null; hong: boolean; phienBanHong: number | null }> {
  const r = await client.aiLeadRuleSet.findFirst({ orderBy: { version: "desc" } });
  if (!r) return { ban: null, hong: false, phienBanHong: null };
  const bo = docPayloadBoQuyTac(r.payload);
  if (!bo) {
    console.error(`[ai-lead:bo-quy-tac] phien-ban=${r.version} payload-hong`);
    return { ban: null, hong: true, phienBanHong: r.version };
  }
  return { ban: { version: r.version, bo, publishedAt: r.publishedAt, publishedById: r.publishedById, reason: r.reason, savedFromVersion: r.savedFromVersion }, hong: false, phienBanHong: null };
}

/** Người sửa đang cầm ảnh CŨ: phiên bản hiện hành khác phiên bản họ đã thấy. Ném BÊN TRONG giao dịch ⇒ rollback; `chayGiaoDich` dịch thành `{ ok: false }`. */
export class PhienBanLech extends Error {
  constructor(public readonly hienHanh: number, public readonly baseVersion: number) {
    super(`Cấu hình đã được người khác thay đổi từ lúc bạn mở trang (hiện là phiên bản ${hienHanh}, bạn đang sửa trên phiên bản ${baseVersion}). Tải lại trang để xem thay đổi mới rồi sửa lại.`);
    this.name = "PhienBanLech";
  }
}

/**
 * Bộ quy tắc GỘP (định tuyến + tự tạo lead theo Page + SLA + thông báo) không qua được schema — nổi bật nhất là vượt `SO_QUY_TAC_TOI_DA`. Màn hình chỉ kiểm tập con nó gửi lên (SLA+thông báo),
 * còn phần định tuyến/tự tạo lead sinh từ cột Page ⇒ chỉ lúc gộp mới biết tổng. Ném BÊN TRONG giao dịch ⇒ rollback; `chayGiaoDich` dịch thành `{ ok: false }` kèm câu tiếng Việt (không để ZodError thô lọt ra).
 */
export class BoQuyTacKhongHopLe extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoQuyTacKhongHopLe";
  }
}

/** Phiên bản mới nhất KHÔNG đọc được mà lần chụp này sẽ để lại Page đang BẬT tự tạo lead: ràng buộc thu hẹp (và SLA/NOTIFY) nằm trong bản hỏng sẽ MẤT lặng lẽ. */
export class PhienBanHong extends Error {
  constructor(public readonly phienBan: number) {
    super(`Phiên bản ${phienBan} của bộ quy tắc bị hỏng nên ràng buộc thu hẹp và SLA/thông báo cũ không đọc được. Tự tạo lead đang bị chặn (hồ sơ chờ nhân viên). Mở tab «Quy tắc» → khôi phục một phiên bản cũ còn tốt, hoặc tắt tự tạo lead ở mọi Page, rồi mới đổi cấu hình khác.`);
    this.name = "PhienBanHong";
  }
}

/** Phiên bản HIỆN HÀNH (lớn nhất). Không có HOẶC hỏng ⇒ null (dùng cho nơi chỉ cần giá trị, không quyết định bảo mật; nơi cần phân biệt dùng `docTrangThaiBoQuyTac`). */
export async function docBoHienHanh(client: Doc = db): Promise<BanGhiBoQuyTac | null> {
  return (await docTrangThaiBoQuyTac(client)).ban;
}

export async function docLichSuBoQuyTac(take = 20): Promise<{ version: number; publishedAt: Date; publishedById: string | null; reason: string; savedFromVersion: number | null; soQuyTac: number }[]> {
  const ds = await db.aiLeadRuleSet.findMany({ orderBy: { version: "desc" }, take, select: { version: true, publishedAt: true, publishedById: true, reason: true, savedFromVersion: true, payload: true } });
  return ds.map((d) => ({
    version: d.version,
    publishedAt: d.publishedAt,
    publishedById: d.publishedById,
    reason: d.reason,
    savedFromVersion: d.savedFromVersion,
    soQuyTac: docPayloadBoQuyTac(d.payload)?.rules.length ?? 0,
  }));
}

export const bamBoQuyTac = (b: BoQuyTac): string => createHash("sha256").update(chuoiChuan(b)).digest("hex");

/** Quy tắc ROUTE / AUTO suy từ CỘT hiện tại (nguồn sự thật chạy nhanh). Ràng buộc thu hẹp của AUTO lấy từ phiên bản trước nếu quy tắc cùng khoá còn bật. */
function ruleTuCot(
  cot: { agentId: string; pageId: string; routingCenterId: string | null; autoCreate: boolean }[],
  truoc: BoQuyTac | null,
): QuyTac[] {
  const auto = new Map<string, QuyTacAutoCreate>();
  for (const r of truoc?.rules ?? []) if (r.kind === "AUTO_CREATE") auto.set(khoaQuyTac(r), r);
  const ra: QuyTac[] = [];
  for (const c of cot) {
    if (c.routingCenterId) ra.push({ kind: "ROUTE_PAGE_TO_CAMPUS", agentId: c.agentId, pageId: c.pageId, centerId: c.routingCenterId });
    if (c.autoCreate) {
      const cu = auto.get(`AUTO|${c.agentId}|${c.pageId}`);
      ra.push({
        kind: "AUTO_CREATE",
        agentId: c.agentId,
        pageId: c.pageId,
        enabled: true,
        ...(cu?.requireConsent === true ? { requireConsent: true } : {}),
        ...(cu?.campusCenterIds && cu.campusCenterIds.length > 0 ? { campusCenterIds: cu.campusCenterIds } : {}),
      });
    }
  }
  return ra;
}

export type ThaoTacBo = { userId: string; userName: string };

/**
 * CHỤP phiên bản mới TRONG giao dịch `tx` của hành động vừa đổi cột. `bien` (tuỳ chọn) biến đổi danh sách quy tắc (đổi SLA/NOTIFY, sửa ràng buộc thu hẹp) trước khi chụp.
 * Nội dung chuẩn hoá GIỐNG phiên bản hiện hành ⇒ KHÔNG tạo phiên bản (trả `doi: false`). Hai người chụp cùng lúc ⇒ `version @unique` ⇒ P2002 (chỗ gọi dịch thành "tải lại").
 * Ném lỗi `Error` nếu bộ không qua schema (lỗi lập trình hoặc dữ liệu đầu vào chưa kiểm — chỗ gọi PHẢI kiểm trước để báo câu tiếng Việt).
 */
export async function chupBoQuyTac(
  tx: Prisma.TransactionClient,
  ng: ThaoTacBo,
  x: {
    lyDo: string;
    hanhDong: string;
    savedFromVersion?: number;
    bien?: (rules: QuyTac[]) => QuyTac[];
    /**
     * Phiên bản người sửa đã thấy. So trên CHÍNH lần đọc `moiNhat` bên dưới (không phải một lần đọc riêng trước đó): hai lần đọc cách nhau bởi nhiều await, giao dịch READ COMMITTED,
     * nên người khác commit xen giữa sẽ qua cổng riêng rồi bị ghi đè — `version @unique` không bắt được vì hai bên tính ra số kế tiếp KHÁC nhau (review độc lập 28/10).
     */
    baseVersion?: number;
    /** Khôi phục: ràng buộc AUTO lấy từ phiên bản cũ ĐƯỢC KHÔI PHỤC nên bản mới nhất hỏng không làm mất gì ⇒ được chụp tiếp. */
    thayTheRangBuoc?: boolean;
  },
): Promise<{ version: number; doi: boolean }> {
  const moiNhat = await tx.aiLeadRuleSet.findFirst({ orderBy: { version: "desc" }, select: { version: true, payload: true } });
  if (x.baseVersion !== undefined && (moiNhat?.version ?? 0) !== x.baseVersion) throw new PhienBanLech(moiNhat?.version ?? 0, x.baseVersion);
  const truoc = moiNhat ? docPayloadBoQuyTac(moiNhat.payload) : null;
  const cot = await tx.aiLeadAgentPage.findMany({ select: { agentId: true, pageId: true, routingCenterId: true, autoCreate: true }, orderBy: [{ agentId: "asc" }, { pageId: "asc" }] });
  const giuLai = (truoc?.rules ?? []).filter((r) => r.kind === "SLA" || r.kind === "NOTIFY");
  const rules = (x.bien ?? ((r: QuyTac[]) => r))([...ruleTuCot(cot, truoc), ...giuLai]);
  const kqBo = boQuyTacSchema.safeParse({ rules });
  if (!kqBo.success) throw new BoQuyTacKhongHopLe(`Bộ quy tắc không hợp lệ: ${kqBo.error.issues[0]?.message ?? "sai định dạng"}`);
  const bo = kqBo.data;
  if (moiNhat && !truoc && !x.thayTheRangBuoc && bo.rules.some((r) => r.kind === "AUTO_CREATE" && r.enabled)) throw new PhienBanHong(moiNhat.version);
  if (moiNhat && truoc && chuoiChuan(truoc) === chuoiChuan(bo)) return { version: moiNhat.version, doi: false };
  const version = (moiNhat?.version ?? 0) + 1;
  await tx.aiLeadRuleSet.create({
    data: {
      version,
      publishedById: ng.userId,
      reason: x.lyDo.slice(0, 500),
      savedFromVersion: x.savedFromVersion ?? null,
      payload: bo as unknown as Prisma.InputJsonValue,
      hash: bamBoQuyTac(bo),
    },
  });
  await writeAudit({
    tx,
    actor: { id: ng.userId, name: ng.userName },
    module: "ai-lead",
    entityType: "AiLeadRuleSet",
    entityId: String(version),
    action: x.hanhDong,
    oldValues: moiNhat ? { version: moiNhat.version } : null,
    newValues: { version, soQuyTac: bo.rules.length, ...(x.savedFromVersion !== undefined ? { savedFromVersion: x.savedFromVersion } : {}) },
    reason: x.lyDo,
  });
  return { version, doi: true };
}
