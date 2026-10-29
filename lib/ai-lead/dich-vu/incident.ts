import "server-only";
// lib/ai-lead/dich-vu/incident.ts — POST /incidents: Agent báo sự cố bằng MÃ (không văn bản tự do, không PII).
//
// · Gộp theo (agent, Page, category, detailCode, NGÀY NHẬN theo giờ VN) — `occurredAt` của Agent chỉ được kiểm "không lệch quá 24h" (xac-thuc.ts), KHÔNG dùng để chọn ngày
//   (Agent có thể sai đồng hồ; gộp theo giờ của chính máy chủ).
// · Mỗi lần nhận (key MỚI) tăng `count`; `severity` chỉ TĂNG (lấy mức lớn nhất). Cùng key ⇒ phát lại, không tăng lần nữa.
// · Thông báo SAU commit: sự cố MỚI hoặc vừa leo thang lên HIGH/CRITICAL. `severity` do Agent khai chỉ là GỢI Ý (YAML) — Admin quyết có báo hay không ở đây.
import { writeAudit } from "@/lib/audit/audit-log";
import { taoReceiptId } from "../phan-hoi";
import { ngayVnLaDate } from "../ngay-vn";
import type { Severity } from "../kieu";
import type { KetQuaXuLy, NguCanhYeuCau } from "../xac-thuc";
import { bamNoiDung, dungThanOk, ghiPhanHoiTrongTx, giaoDichCoThuLai, giuKhoaTrongTx } from "./idempotency";
import type { LenLichNen } from "./nen";
import { baoSuCoAgent } from "./thong-bao";

const HANG: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

/** Các mức THẤP HƠN `s` — để UPDATE CÓ ĐIỀU KIỆN chỉ nâng, không bao giờ hạ. */
function mucThapHon(s: Severity): Severity[] {
  return (Object.keys(HANG) as Severity[]).filter((k) => HANG[k] < HANG[s]);
}

export function canBaoSuCo(x: { moi: boolean; truoc: Severity | null; sau: Severity; moLai: boolean }): boolean {
  if (HANG[x.sau] < HANG.HIGH) return false;
  if (x.moi || x.moLai) return true; // sự cố đã ĐÓNG mà tái diễn cùng ngày ⇒ báo lại (xem `moLai` ở xuLyIncident)
  return x.truoc !== null && HANG[x.truoc] < HANG.HIGH; // vừa leo thang qua ngưỡng
}

export async function xuLyIncident(ctx: NguCanhYeuCau<"incidents">, deps: { lenLichNen: LenLichNen }): Promise<KetQuaXuLy> {
  const b = ctx.body;
  const now = new Date(ctx.nowMs);
  const hash = bamNoiDung("incidents", b);
  const pageId = b.pageId ?? ""; // '' = không gắn Page (NULL ≠ NULL trong Postgres làm chỉ mục duy nhất không gộp được)
  const day = ngayVnLaDate(ctx.nowMs);

  const kq = await giaoDichCoThuLai(async (tx) => {
    const g = await giuKhoaTrongTx(tx, { agentId: ctx.agent.id, key: b.idempotencyKey, endpoint: "incidents", hash });
    if (g.loai === "xung-dot") return { loai: "xung-dot" as const };
    if (g.loai === "phat-lai") return { loai: "phat-lai" as const, body: g.body };

    // upsert theo khoá ghép: Prisma dùng INSERT … ON CONFLICT khi đủ điều kiện nên tranh chấp không sinh P2002; nếu có thì `giaoDichCoThuLai` chạy lại.
    const row = await tx.aiLeadIncident.upsert({
      where: { agentId_pageId_category_detailCode_day: { agentId: ctx.agent.id, pageId, category: b.category, detailCode: b.detailCode, day } },
      create: {
        agentId: ctx.agent.id,
        pageId,
        category: b.category,
        detailCode: b.detailCode,
        day,
        severity: b.severity,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        ...(b.correlationId ? { lastCorrelationId: b.correlationId } : {}),
      },
      update: { count: { increment: 1 }, lastSeenAt: now, ...(b.correlationId ? { lastCorrelationId: b.correlationId } : {}) },
      select: { id: true, count: true, severity: true, state: true, assigneeId: true },
    });
    const moi = row.count === 1;
    const truoc = moi ? null : (row.severity as Severity);
    // Sự cố đã RESOLVED mà Agent báo lại CÙNG ngày (khoá gộp theo ngày) thì không được nằm im ở «đã xử lý» với số đếm tăng dần: mở lại, bỏ người phụ trách cũ, báo lại (review độc lập 28/10).
    // Điều kiện nằm trong WHERE: hai báo cáo song song chỉ mở lại MỘT lần.
    const moLai = !moi && row.state === "RESOLVED" && (await tx.aiLeadIncident.updateMany({ where: { id: row.id, state: "RESOLVED" }, data: { state: "OPEN", assigneeId: null, moLaiLuc: now, soLanMoLai: { increment: 1 } } })).count === 1;
    // Mở lại tự động đổi trạng thái do NGƯỜI đóng và xoá người phụ trách ⇒ phải có dấu vết (người đóng ghi lý do ở audit riêng; đây là bên nối tiếp: hệ thống mở lại vì Agent báo lại).
    if (moLai) {
      await writeAudit({
        tx,
        actor: { id: null, name: "Hệ thống (AI Lead)" },
        module: "ai-lead",
        entityType: "AiLeadIncident",
        entityId: row.id,
        action: "AI_LEAD_SU_CO_TU_MO_LAI",
        oldValues: { state: "RESOLVED", assigneeId: row.assigneeId },
        newValues: { state: "OPEN", assigneeId: null, lanBao: row.count },
        reason: "Agent báo lại sự cố đã đóng trong cùng ngày",
      });
    }
    if (!moi && HANG[b.severity] > HANG[row.severity as Severity]) {
      // Chỉ nâng khi mức đang lưu còn THẤP HƠN (điều kiện nằm trong WHERE — hai báo cáo song song không hạ nhau).
      await tx.aiLeadIncident.updateMany({ where: { id: row.id, severity: { in: mucThapHon(b.severity) } }, data: { severity: b.severity } });
    }
    const body = dungThanOk(ctx, { receiptId: taoReceiptId(), accepted: true });
    await ghiPhanHoiTrongTx(tx, { agentId: ctx.agent.id, key: b.idempotencyKey, status: 200, body });
    return { loai: "ok" as const, body, bao: canBaoSuCo({ moi, truoc, sau: b.severity, moLai }) ? { id: row.id, lanMoLai: moLai ? row.count : undefined } : null };
  });

  if (kq.loai === "xung-dot") return { loai: "xung-dot" };
  if (kq.loai === "phat-lai") return { loai: "phat-lai", body: kq.body };
  if (kq.bao !== null) {
    const { id: incidentId, lanMoLai } = kq.bao;
    deps.lenLichNen(() => baoSuCoAgent({ incidentId, severity: b.severity === "CRITICAL" ? "CRITICAL" : "HIGH", now, ...(lanMoLai !== undefined ? { lanMoLai } : {}) }));
  }
  return { loai: "ok", body: kq.body };
}
