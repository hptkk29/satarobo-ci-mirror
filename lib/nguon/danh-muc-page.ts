/**
 * lib/nguon/danh-muc-page.ts — DANH MỤC PAGE (`FacebookPageMapping`): thêm / sửa phạm vi / tắt-bật một Page. CHỈ Quản trị tối cao.
 *
 * Vì sao có: bảng Page → Nguồn (`bang-nguon-theo-page.ts`) chỉ gán nguồn cho Page ĐÃ CÓ trong danh mục này, mà trước đây không có màn nào thêm dòng
 * (`upsertPageMapping` không có nơi gọi). Hệ quả: hồ sơ AI Lead không bao giờ quy được `PAID_ADS` bằng giao diện.
 *
 * Phạm vi — CỐ Ý HẸP:
 *  · CHỈ ghi `FacebookPageMapping` (+ AuditLog cùng transaction). KHÔNG đụng `nguon.bangNguonTheoPage` (gán nguồn vẫn đi `luuNguonCuaPage`),
 *    KHÔNG đụng `Lead`/`LeadAttribution` (nguồn lead lịch sử giữ nguyên), KHÔNG đụng chính sách hoa hồng, KHÔNG bật cờ `nguon.pageMapping`.
 *  · Một nguồn dữ liệu: cùng bảng mà webhook Messenger CRM và tab Page mapping đọc — không có bảng mới.
 *  · Mọi cổng (quyền · định dạng · Page mẫu · cơ sở · lý do) đứng TRƯỚC phép ghi đầu tiên; từ chối = trả lỗi, không ghi, không audit.
 *
 * ⚠️ Hệ quả phải nói rõ ở giao diện: `FacebookPageMapping.centerId` còn quyết `centerId` của hội thoại Messenger CRM MỚI (`messenger-service.ts`).
 *  `HO` (centerId trống) giữ nguyên hành vi hiện tại; `CENTER` đổi phạm vi cách ly của hội thoại mới trên Page đó.
 */
import type { Actor } from "@/lib/auth/actor";
import { writeAudit } from "@/lib/audit/audit-log";
import { db } from "@/lib/db";
import { laDanhTinhFixture } from "@/lib/ai-lead/hop-dong";

export const RE_PAGE_ID = /^[A-Za-z0-9_-]{5,64}$/;
export const LY_DO_TOI_THIEU_PAGE = 10;
export const LOI_CHI_QTTC = "Chỉ Quản trị tối cao được quản lý danh mục Page.";

export type PhamViPage = "HO" | "CENTER";

export type NhapPageDanhMuc = {
  pageId: string;
  pageName: string | null;
  phamVi: PhamViPage;
  /** Bắt buộc khi `CENTER`; bị bỏ qua khi `HO`. */
  centerId: string | null;
  isActive: boolean;
  lyDo: string;
};

export type KetQuaPageDanhMuc =
  | { ok: true; hanhDong: "THEM" | "SUA" | "KHONG_DOI"; canhBao: string[] }
  | { ok: false; loi: string; truong?: "pageId" | "phamVi" | "coSo" | "lyDo" | "quyen" };

/** THUẦN — kiểm đầu vào, không đọc DB. Trả câu lỗi tiếng Việt hoặc `null`. */
export function kiemNhapPage(n: NhapPageDanhMuc): { loi: string; truong: "pageId" | "phamVi" | "coSo" | "lyDo" } | null {
  const pageId = n.pageId.trim();
  if (!RE_PAGE_ID.test(pageId)) return { loi: "Mã Page gồm chữ, số, _ hoặc -, dài 5–64 ký tự.", truong: "pageId" };
  if (laDanhTinhFixture({ pageId })) return { loi: "Mã Page này là Page mẫu của gói bàn giao — không dùng được.", truong: "pageId" };
  if (n.phamVi !== "HO" && n.phamVi !== "CENTER") return { loi: "Phạm vi chỉ là Hội sở hoặc một cơ sở.", truong: "phamVi" };
  if (n.phamVi === "CENTER" && !n.centerId) return { loi: "Page thuộc một cơ sở thì phải chọn cơ sở.", truong: "coSo" };
  if (n.lyDo.trim().length < LY_DO_TOI_THIEU_PAGE) return { loi: `Lý do thay đổi tối thiểu ${LY_DO_TOI_THIEU_PAGE} ký tự.`, truong: "lyDo" };
  if (n.pageName !== null && n.pageName.length > 120) return { loi: "Tên Page tối đa 120 ký tự.", truong: "pageId" };
  return null;
}

type Dong = { pageId: string; pageName: string | null; scopeType: PhamViPage; centerId: string | null; isActive: boolean };

/** THUẦN — cảnh báo nói trước hệ quả của một thay đổi trên Page ĐÃ có trong danh mục. */
export function canhBaoDoiPage(cu: Dong | null, moi: Dong, coMapNguon: boolean): string[] {
  const ra: string[] = [];
  if (cu && (cu.scopeType !== moi.scopeType || cu.centerId !== moi.centerId)) {
    ra.push("Đổi phạm vi Page: hội thoại Messenger CRM MỚI trên Page này sẽ mang phạm vi cơ sở mới; hội thoại và lead đã có KHÔNG đổi.");
  }
  if (cu && cu.isActive && !moi.isActive) {
    ra.push(
      coMapNguon
        ? "Page đang có nguồn được gán: tắt Page thì webhook bỏ qua nó và hồ sơ AI trên Page này không quy được nguồn cho tới khi bật lại. Dòng gán nguồn được giữ nguyên."
        : "Tắt Page: webhook Messenger bỏ qua Page này cho tới khi bật lại.",
    );
  }
  return ra;
}

export async function ghiPageDanhMuc(p: { actor: Actor; actorName: string; nhap: NhapPageDanhMuc }): Promise<KetQuaPageDanhMuc> {
  if (!p.actor.isSuperAdmin) return { ok: false, loi: LOI_CHI_QTTC, truong: "quyen" };
  const loi = kiemNhapPage(p.nhap);
  if (loi) return { ok: false, ...loi };
  const pageId = p.nhap.pageId.trim();
  const pageName = p.nhap.pageName && p.nhap.pageName.trim() !== "" ? p.nhap.pageName.trim() : null;
  const centerId = p.nhap.phamVi === "CENTER" ? p.nhap.centerId : null;

  if (centerId) {
    const cs = await db.center.findUnique({ where: { id: centerId }, select: { id: true, code: true } });
    if (!cs) return { ok: false, loi: "Không thấy cơ sở đã chọn.", truong: "coSo" };
  }

  return db.$transaction(async (tx): Promise<KetQuaPageDanhMuc> => {
    const hang = await tx.facebookPageMapping.findUnique({ where: { pageId } });
    const cu: Dong | null = hang
      ? { pageId, pageName: hang.pageName, scopeType: hang.scopeType as PhamViPage, centerId: hang.centerId, isActive: hang.isActive }
      : null;
    const moi: Dong = { pageId, pageName, scopeType: p.nhap.phamVi, centerId, isActive: p.nhap.isActive };
    if (cu && JSON.stringify(cu) === JSON.stringify(moi)) return { ok: true, hanhDong: "KHONG_DOI", canhBao: [] };

    const setNguon = await tx.systemSetting.findUnique({ where: { key: "nguon.bangNguonTheoPage" }, select: { valueJson: true } });
    const coMapNguon =
      setNguon !== null && typeof setNguon.valueJson === "object" && setNguon.valueJson !== null && Object.prototype.hasOwnProperty.call(setNguon.valueJson, pageId);

    if (cu) {
      await tx.facebookPageMapping.update({ where: { pageId }, data: { pageName, scopeType: moi.scopeType, centerId, isActive: moi.isActive } });
    } else {
      await tx.facebookPageMapping.create({ data: { pageId, pageName, scopeType: moi.scopeType, centerId, isActive: moi.isActive } });
    }
    await writeAudit({
      tx,
      actor: { id: p.actor.userId, name: p.actorName },
      module: "nguon-hoa-hong",
      entityType: "FacebookPageMapping",
      entityId: pageId,
      action: cu ? "PAGE_DANH_MUC_SUA" : "PAGE_DANH_MUC_THEM",
      oldValues: cu ?? undefined,
      newValues: moi,
      reason: p.nhap.lyDo.trim(),
    });
    return { ok: true, hanhDong: cu ? "SUA" : "THEM", canhBao: canhBaoDoiPage(cu, moi, coMapNguon) };
  });
}

export type GoiYPageAiLead = { pageId: string; agent: string; trongDanhMuc: boolean };

/** Page đã được CẤP cho Agent AI Lead — gợi ý để đưa vào danh mục (một Page có thể thuộc nhiều Agent: gộp theo `pageId`). */
export async function docGoiYPageAiLead(): Promise<GoiYPageAiLead[]> {
  const [cap, danhMuc] = await Promise.all([
    db.aiLeadAgentPage.findMany({ select: { pageId: true, agent: { select: { name: true } } }, orderBy: { pageId: "asc" } }),
    db.facebookPageMapping.findMany({ select: { pageId: true } }),
  ]);
  const co = new Set(danhMuc.map((d) => d.pageId));
  const gom = new Map<string, string[]>();
  for (const c of cap) gom.set(c.pageId, [...(gom.get(c.pageId) ?? []), c.agent.name]);
  return [...gom.entries()].map(([pageId, ten]) => ({ pageId, agent: ten.join(", "), trongDanhMuc: co.has(pageId) }));
}

export type DongDanhMucPage = { pageId: string; tenPage: string | null; phamVi: PhamViPage; centerId: string | null; tenCoSo: string | null; dangTat: boolean };

/** Toàn bộ danh mục cho khối quản lý (CHỈ gọi khi người xem là Quản trị tối cao — thấy mọi Page). Kèm danh sách cơ sở để chọn. */
export async function docDanhMucPageDayDu(): Promise<{ danhMuc: DongDanhMucPage[]; coSo: { id: string; name: string }[] }> {
  const [hang, cs] = await Promise.all([
    db.facebookPageMapping.findMany({ select: { pageId: true, pageName: true, scopeType: true, centerId: true, isActive: true }, orderBy: [{ pageName: "asc" }, { pageId: "asc" }] }),
    db.center.findMany({ where: { code: { not: null } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const ten = new Map(cs.map((c) => [c.id, c.name]));
  return {
    danhMuc: hang.map((h) => ({
      pageId: h.pageId,
      tenPage: h.pageName,
      phamVi: h.scopeType as PhamViPage,
      centerId: h.centerId,
      tenCoSo: h.centerId ? (ten.get(h.centerId) ?? null) : null,
      dangTat: !h.isActive,
    })),
    coSo: cs,
  };
}
