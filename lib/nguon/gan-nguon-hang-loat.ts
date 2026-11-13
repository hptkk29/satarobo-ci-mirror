/**
 * lib/nguon/gan-nguon-hang-loat.ts — GÁN NGUỒN HÀNG LOẠT cho HÀNG CHỜ NGUỒN (mọi vấn đề, không riêng «Chưa rõ nguồn»). Một lượt gọi xử lý MỘT LÔ ≤ `CO_LO_GAN_HANG_LOAT` lead và trả con trỏ; giao diện lặp.
 *
 * ── Không có luật ghi mới ───────────────────────────────────────────────────────────────────────────────────
 * Mỗi lead đi qua ĐÚNG `doiNguonLead` (cổng cơ sở · quyền theo TỪNG lead · lý do ≥ 10 ký tự · TU_CLAIM · khoá lạc quan theo `updatedAt` · audit `DOI_NGUON` ở từng lead). Hàm này chỉ CHỌN lead và
 * CHẶN những lead không được đổi hàng loạt. Nó không bao giờ gọi `doiNguon` trực tiếp (cần thẻ ghi nguồn do `capTheGhiNguon` cấp).
 *
 * ── Phạm vi: trình duyệt chỉ THU HẸP, máy chủ quyết định ────────────────────────────────────────────────────
 * Lead được đọc lại ở đây bằng `scopedDb(actor)` + `whereHangCho(…)` — cùng điều kiện với các con số trên màn. Có hai kiểu phạm vi (`PhamViGan`):
 *   · `loc`: mọi lead của bộ lọc đang xem (`lyDo` null = mọi vấn đề);
 *   · `ids`: các lead người dùng TICK. Danh sách id KHÔNG phải quyền: nó chỉ được GIAO với «hàng chờ nguồn trong tầm nhìn của người bấm» (`whereHangCho(null, coSoId)` qua `scopedDb`). Id ngoài hàng chờ, id lead
 *     cơ sở khác, id bịa đều rơi ra ngoài giao ⇒ KHÔNG bị đổi. Nên đây KHÔNG phải đường «đổi nguồn mọi lead tôi đoán được id».
 * Rồi mỗi lead vẫn qua `doiNguonLead` (quyền + cơ sở THEO TỪNG LEAD).
 *
 * ── Lead nào bị BỎ QUA (để nguyên trong hàng chờ) ───────────────────────────────────────────────────────────
 *  · đã có đầu vào tài chính (thực thu / sổ hoa hồng): đổi nguồn SAU khi thu tiền là ĐỀ XUẤT chờ duyệt hai cấp (CLAUDE.md «Nguồn lead là master data động»). Một nút bấm không được phát hàng trăm sự kiện
 *    `nguon.da-doi-sau-thanh-toan` — nên đường hàng loạt TỪ CHỐI cả ca người bấm có quyền «đổi sau thu»;
 *  · nguồn đang khoá (`signals.khoaNguon`);
 *  · đã Ở ĐÚNG nguồn đích (hàng chờ vì lý do khác — thiếu người giới thiệu, cảnh báo…): đổi sang chính nó chỉ đẻ một dòng nhật ký vô nghĩa;
 *  · nguồn vừa bị người khác đổi (khoá lạc quan).
 *
 * `chiXem` chạy CÙNG vòng lọc nhưng KHÔNG ghi gì: «xem trước» và «thực hiện» dùng chung một hàm phân loại nên không thể lệch nhau (luật 12b).
 */
import type { Actor } from "@/lib/auth/actor";
import { db } from "@/lib/db";
import { scopedDb } from "@/lib/db-scope";
import { writeAudit } from "@/lib/audit/audit-log";
import { coDauVaoTaiChinh, docDauVaoTaiChinh } from "./dau-vao-tai-chinh";
import { doiNguonLead, type KiemQuyen } from "./doi-nguon-lead";
import { whereHangCho } from "./doc-hang-cho";
import { CO_LO_GAN_HANG_LOAT, LO_RONG, TOI_DA_ID_GAN, kiemLyDoGanHangLoat, type KetQuaLoGanHangLoat, type NguonChoHangLoat, type PhamViGan } from "./gan-nguon-hang-loat-nhan";
import { trongKhoangHieuLuc } from "./hieu-luc-nguon";

export type LoiGanHangLoat = { ok: false; loi: string; truong: "nguon" | "lyDo" | "quyen" };

/** Khoá nguồn đang bị khoá — đọc từ `signals` (JSON tự do) nên phải dò kiểu. */
function nguonDangKhoa(signals: unknown): boolean {
  return typeof signals === "object" && signals !== null && !Array.isArray(signals) && (signals as Record<string, unknown>).khoaNguon === true;
}

const CHON_NGUON = {
  id: true,
  code: true,
  name: true,
  status: true,
  selectable: true,
  effectiveFrom: true,
  effectiveTo: true,
  referrerRequirement: true,
  requiresNote: true,
  commissionEnabled: true,
} as const;

/**
 * Nguồn nào được chọn cho lượt hàng loạt: ACTIVE ∧ chọn được ∧ trong khoảng hiệu lực ∧ KHÔNG đòi người giới thiệu ∧ KHÔNG đòi giải trình. Hai điều kiện cuối là dữ liệu của TỪNG lead
 * (một lượt gán chung không có người nào để ghi), nên nguồn đó chỉ gán được từng lead một.
 */
export async function docNguonChoHangLoat(now: Date): Promise<NguonChoHangLoat[]> {
  const rows = await db.leadSourceGroup.findMany({
    where: { status: "ACTIVE", selectable: true, referrerRequirement: "NONE", requiresNote: false, NOT: { code: "UNKNOWN" } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: CHON_NGUON,
  });
  return rows.filter((r) => trongKhoangHieuLuc(r, now)).map((r) => ({ id: r.id, code: r.code, name: r.name, commissionEnabled: r.commissionEnabled }));
}

export async function ganNguonMotLo(p: {
  actor: Actor;
  actorName: string;
  /** Hỏi quyền theo khoá + đối tượng. Đường thật: `(a, t) => checkPermission(a, t)`. */
  kiemQuyen: KiemQuyen;
  groupId: string;
  /** Lý do chung — vào nhật ký của TỪNG lead. Bỏ qua khi `chiXem`. */
  lyDo: string | null;
  /** Một cơ sở (đã được `scopedDb` cắt lại theo tầm nhìn) hoặc `null` = mọi cơ sở trong tầm nhìn. */
  coSoId: string | null;
  /** Lead nào — xem `PhamViGan`. Chỉ THU HẸP trong hàng chờ của người bấm. */
  pham: PhamViGan;
  /** `Lead.id` cuối của lô trước; `null` = từ đầu. */
  conTro: string | null;
  /** Chỉ phân loại, không ghi. */
  chiXem: boolean;
  /** Đồng hồ — BẮT BUỘC (luật 19). */
  bayGio: Date;
}): Promise<({ ok: true } & KetQuaLoGanHangLoat) | LoiGanHangLoat> {
  // 1. Nguồn đích — đọc LẠI ở máy chủ, không tin gì từ trình duyệt ngoài `groupId`.
  const nguon = await db.leadSourceGroup.findUnique({ where: { id: p.groupId }, select: CHON_NGUON });
  if (!nguon || nguon.code === "UNKNOWN" || nguon.status !== "ACTIVE" || !nguon.selectable || !trongKhoangHieuLuc(nguon, p.bayGio)) {
    return { ok: false, loi: "Nguồn đã chọn không còn dùng được.", truong: "nguon" };
  }
  if (nguon.referrerRequirement !== "NONE" || nguon.requiresNote) {
    return { ok: false, loi: "Nguồn này đòi người giới thiệu hoặc giải trình riêng cho từng lead — không gán hàng loạt được.", truong: "nguon" };
  }
  if (p.pham.kieu === "ids" && (p.pham.ids.length === 0 || p.pham.ids.length > TOI_DA_ID_GAN)) {
    return { ok: false, loi: `Chọn từ 1 đến ${TOI_DA_ID_GAN} lead mỗi lần (hoặc dùng «chọn cả bộ lọc»).`, truong: "nguon" };
  }
  const lyDo = (p.lyDo ?? "").trim();
  if (!p.chiXem) {
    const loiLyDo = kiemLyDoGanHangLoat(lyDo);
    if (loiLyDo) return { ok: false, loi: loiLyDo, truong: "lyDo" };
  }

  // 2. Lead của lô — cùng `where` với các số trên màn, qua scopedDb (cách ly cơ sở). Keyset theo `id` nên lead BỊ BỎ QUA (còn trong hàng chờ) không chặn lô sau.
  //    `ids` ⇒ GIAO của danh sách đã tick với hàng chờ (mọi vấn đề); `loc` ⇒ đúng bộ lọc đang xem.
  const trongPham = p.pham.kieu === "ids" ? { AND: [whereHangCho(null, p.coSoId), { id: { in: p.pham.ids } }] } : whereHangCho(p.pham.lyDo, p.coSoId);
  const leads = await scopedDb(p.actor).lead.findMany({
    where: { AND: [trongPham, p.conTro ? { id: { gt: p.conTro } } : {}] },
    orderBy: { id: "asc" },
    take: CO_LO_GAN_HANG_LOAT,
    select: { id: true, attribution: { select: { updatedAt: true, signals: true, groupId: true } } },
  });

  const kq: KetQuaLoGanHangLoat = { ...LO_RONG };
  const daDoi: string[] = [];
  for (const lead of leads) {
    kq.daQuet++;
    const a = lead.attribution;
    if (!a) {
      kq.boQuaVuaDoi++;
      continue;
    }
    if (a.groupId === nguon.id) {
      kq.boQuaCungNguon++;
      continue;
    }
    if (nguonDangKhoa(a.signals)) {
      kq.boQuaKhoa++;
      continue;
    }
    if (coDauVaoTaiChinh(await docDauVaoTaiChinh(db, lead.id))) {
      kq.boQuaCoTien++;
      continue;
    }
    if (p.chiXem) {
      kq.daDoi++;
      continue;
    }
    const r = await doiNguonLead({
      actor: p.actor,
      actorName: p.actorName,
      kiemQuyen: p.kiemQuyen,
      leadId: lead.id,
      groupId: nguon.id,
      thamChieu: null,
      giaiTrinh: null,
      lyDo,
      daThayCapNhatLuc: a.updatedAt,
      bayGio: p.bayGio,
    });
    if (r.ok) {
      kq.daDoi++;
      daDoi.push(lead.id);
    } else if (r.truong === "nguonVuaDoi") {
      kq.boQuaVuaDoi++;
    } else {
      kq.khongDoiDuoc++;
      kq.loiDauTien ??= r.loi;
      // Từ chối LIÊN TIẾP mà chưa đổi được lead nào ở lô này = lỗi chung (thiếu quyền, nguồn hỏng), không phải lỗi riêng từng lead: dừng sớm thay vì ném 25 lượt tra cứu chậm vào hư không.
      if (kq.daDoi === 0 && kq.khongDoiDuoc >= 3) return { ok: false, loi: kq.loiDauTien ?? "Không đổi được nguồn.", truong: "quyen" };
    }
  }

  // 3. MỘT dòng nhật ký tóm tắt cho cả lô (từng lead đã có dòng `DOI_NGUON` riêng). Chỉ ghi khi có lead đổi thật.
  if (!p.chiXem && daDoi.length > 0) {
    await writeAudit({
      actor: { id: p.actor.userId, name: p.actorName },
      module: "nguon-hoa-hong",
      entityType: "Lead",
      entityId: "gan-nguon-hang-loat",
      action: "DOI_NGUON_HANG_LOAT",
      newValues: { nhomMoi: nguon.code, soLead: daDoi.length, leadIds: daDoi, coSoId: p.coSoId, phamVi: p.pham.kieu === "ids" ? `tick ${p.pham.ids.length} lead` : `bo loc ${p.pham.lyDo ?? "moi-van-de"}`, boQuaCoTien: kq.boQuaCoTien, boQuaKhoa: kq.boQuaKhoa, boQuaCungNguon: kq.boQuaCungNguon, boQuaVuaDoi: kq.boQuaVuaDoi },
      reason: lyDo,
    });
  }

  kq.conTro = leads.length > 0 ? leads[leads.length - 1]!.id : p.conTro;
  kq.hetLead = leads.length < CO_LO_GAN_HANG_LOAT;
  return { ok: true, ...kq };
}
