// lib/parttime/dong-bo.ts — ĐÁNH DẤU + CHẠY đồng bộ phân công sau mọi đường đổi buổi / lớp / học bù / trial (P3a).
//
// Vì sao không đồng bộ ngay trong giao dịch nghiệp vụ (audit P3a, 13/10/2026):
//   · Nhiều đường ghi chạy trong `scopedDb(...).$transaction` (tạo buổi, sửa buổi, huỷ / xoá / sửa lớp, đổi lịch lớp).
//     Trong giao dịch đó, phép ĐỌC phân công bị lọc theo phạm vi `hr_attendance:*` của người thao tác — đọc thiếu thì
//     hoặc bỏ sót (phân công cũ sống mãi), hoặc tạo MAIN thứ hai ⇒ chỉ mục từng phần ném P2002 ⇒ HỎNG CẢ thao tác xếp
//     lịch của QLCS. Phân công không được phép làm hỏng nghiệp vụ lớp học.
//   · Nên trong giao dịch nghiệp vụ CHỈ ghi một DẤU (DomainEvent `parttime.staffing_dirty`, cùng commit / cùng rollback
//     với thay đổi của buổi). Bộ đồng bộ (`dongBoPhanCongTheoNguon`) chạy SAU commit trên `db` trần, mỗi nguồn một giao
//     dịch ngắn: ngay sau commit nếu nơi gọi nắm giao dịch, và LUÔN qua hàng đợi outbox (thử lại tối đa 5 lần; hết lượt
//     ⇒ trạng thái FAILED trong `DomainEvent` + dòng audit `PARTTIME_STAFFING_SYNC_FAILED` — thấy được, thử lại được).
//   · Đồng bộ idempotent ⇒ chạy ngay rồi outbox chạy lại là vô hại.
// Độ trễ khi chỉ dựa outbox: cron `dispatch-events` prod mỗi phút, test mỗi 5 phút.
//
// Ngoại lệ có chủ đích: hai hook ĐƠN TỪ (`khiDuyetDayThay`, `khiHuyDonDayThay` — `tich-hop.ts`) vẫn chạy trong giao
// dịch của đơn vì chúng mang MÃ ĐƠN (`sourceWorkRequestId`) mà đồng bộ theo trạng thái không suy lại được.
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";
import { writeAudit } from "@/lib/audit/audit-log";
import { publishEvent } from "@/lib/events/publish";
import { on, type DomainEventLite } from "@/lib/events/registry";
import { boXetCongTac } from "./cong-tac";
import { dongBoPhanCongTheoNguon, type Nguon, type NguoiThaoTac, type ThongBaoPhanCong } from "./phan-cong-db";
import { SONG_CHUA_CHOT } from "./phan-cong";
import { guiThongBaoPhanCong } from "./thong-bao";

type Tx = Prisma.TransactionClient;

/** Đường nghiệp vụ nào gây ra lượt đồng bộ — ghi vào audit của từng bước. */
export type NguonKichHoat =
  | "TAO_BUOI"
  | "DOI_LICH_BUOI"
  | "SUA_BUOI"
  | "HUY_BUOI"
  | "MO_LAI_BUOI"
  | "DOI_GV_BUOI"
  | "HUY_LOP"
  | "HOAN_THANH_LOP"
  | "XOA_LOP"
  | "SUA_LOP"
  | "GOP_BUOI_TRUNG"
  | "HOC_BU_TAO"
  | "HOC_BU_SUA"
  | "HOC_BU_HUY"
  | "TRIAL_TAO"
  | "TRIAL_SUA"
  | "TRIAL_HUY"
  | "TRIAL_HUY_LOP"
  // Đối soát định kỳ / "Đồng bộ lại tuần này" (`doi-soat-dong-bo.ts`) — gọi lại chính bộ đồng bộ, idempotent.
  | "DOI_SOAT_DINH_KY";

const MOT_LO = 100;

function dieuKienNguon(ds: readonly Nguon[]): Prisma.SessionStaffAssignmentWhereInput {
  const theoLoai = new Map<string, string[]>();
  for (const n of ds) theoLoai.set(n.sourceType, [...(theoLoai.get(n.sourceType) ?? []), n.sourceId]);
  return { OR: [...theoLoai].map(([t, ids]) => ({ sourceType: t as Nguon["sourceType"], sourceId: { in: ids } })) };
}

/**
 * Ghi DẤU "các nguồn này cần đồng bộ phân công" — gọi TRONG giao dịch nghiệp vụ (`tx`) để dấu commit cùng thay đổi.
 * Công tắc tắt mà các nguồn chưa có phân công sống nào ⇒ không ghi gì (prod không đẻ hàng đợi vô ích khi chưa bật).
 * `tx = null` ⇒ ghi bằng `db` (đường không có giao dịch — vd. sửa buổi trial).
 */
export async function danhDauCanDongBo(tx: Tx | null, nguon: readonly Nguon[], goc: NguonKichHoat, actor: NguoiThaoTac): Promise<boolean> {
  const ds = [...new Map(nguon.map((n) => [`${n.sourceType}:${n.sourceId}`, n])).values()];
  if (ds.length === 0) return false;
  // Không cơ sở nào bật (hoặc RBAC v1) ⇒ chỉ đánh dấu khi có phân công sống cần huỷ. Có nơi bật ⇒ đánh dấu; bộ đồng bộ xét
  // công tắc THEO CƠ SỞ của từng buổi.
  if (!(await boXetCongTac("STAFFING")).coNoiNao) {
    // Đếm trên `db` TRẦN, không qua `tx`: nhiều đường gọi bằng `scopedDb(...).$transaction`, mà phép đếm qua scope bị lọc
    // theo `hr_attendance:*` của người bấm ⇒ người không có quyền chấm công huỷ lớp lúc cờ tắt (đường lùi) đếm ra 0, không
    // đánh dấu, phân công còn sống mãi (ca `[PT3A-26]`). Không nằm dưới khoá tư vấn nên không có rủi ro cạn pool.
    const coSong = await db.sessionStaffAssignment.count({ where: { ...dieuKienNguon(ds), status: { in: [...SONG_CHUA_CHOT] } } });
    if (coSong === 0) return false;
  }
  for (let i = 0; i < ds.length; i += MOT_LO) {
    const lo = ds.slice(i, i + MOT_LO);
    await publishEvent(
      "parttime.staffing_dirty",
      { nguon: lo.map((n) => ({ sourceType: n.sourceType, sourceId: n.sourceId })), goc, actor: { id: actor.id, name: actor.name } },
      tx ? { tx } : undefined,
    );
  }
  return true;
}

/**
 * Các buổi lớp còn MỞ (SCHEDULED / đang dạy) của một lớp — nguồn cần đồng bộ khi lớp đổi (huỷ / xoá / sửa GV, TA, giờ).
 * `tuHomNay` ⇒ chỉ buổi từ hôm nay (giờ VN): sửa mặc định của lớp KHÔNG được sửa lịch sử.
 */
export async function nguonBuoiMoCuaLop(tx: Tx, classId: string, opts: { tuHomNay: boolean }): Promise<Nguon[]> {
  const rows = await tx.classSession.findMany({
    where: {
      classId,
      status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      ...(opts.tuHomNay ? { date: { gte: new Date(`${vnYmd(new Date())}T00:00:00+07:00`) } } : {}),
    },
    select: { id: true },
  });
  return rows.map((r) => ({ sourceType: "CLASS_SESSION" as const, sourceId: r.id }));
}

export type KetQuaChayDongBo = { soNguon: number; soBuoc: number; loi: { nguon: Nguon; loi: string }[]; ngoaiLe: number };

/**
 * Chạy đồng bộ NGAY cho các nguồn — mỗi nguồn một giao dịch `db` trần riêng (một nguồn hỏng không kéo nguồn khác).
 * Lỗi ⇒ audit `PARTTIME_STAFFING_SYNC_FAILED` + trả về trong `loi` (handler outbox ném để thử lại). Thông báo gửi SAU
 * commit, gộp theo người.
 */
export async function dongBoNgay(nguon: readonly Nguon[], goc: NguonKichHoat, actor: NguoiThaoTac): Promise<KetQuaChayDongBo> {
  const ds = [...new Map(nguon.map((n) => [`${n.sourceType}:${n.sourceId}`, n])).values()];
  const ra: KetQuaChayDongBo = { soNguon: ds.length, soBuoc: 0, loi: [], ngoaiLe: 0 };
  const thongBao: ThongBaoPhanCong[] = [];
  if (ds.length === 0) return ra;
  // Đọc cờ MỘT lần, NGOÀI giao dịch — xem chú thích `congTacTai` ở `dongBoPhanCongTheoNguon` (cạn pool khi đồng bộ song song).
  const xet = await boXetCongTac("STAFFING");
  const congTacTai = (centerId: string) => xet.tai({ centerId });
  for (const n of ds) {
    try {
      const r = await db.$transaction((tx) => dongBoPhanCongTheoNguon(tx, n, { actor, nguonKichHoat: goc, congTacTai }), { timeout: 20_000 });
      ra.soBuoc += r.soBuoc;
      ra.ngoaiLe += r.ngoaiLe.length;
      thongBao.push(...r.thongBao);
    } catch (e) {
      const loi = e instanceof Error ? e.message : String(e);
      ra.loi.push({ nguon: n, loi });
      console.error("[parttime] đồng bộ phân công lỗi", n, loi);
      await writeAudit({
        actor,
        module: "hr_attendance",
        entityType: "SessionStaffAssignment",
        entityId: `${n.sourceType}:${n.sourceId}`,
        action: "PARTTIME_STAFFING_SYNC_FAILED",
        newValues: { goc, loi: loi.slice(0, 500) },
      }).catch(() => undefined);
    }
  }
  await guiThongBaoGop(thongBao, actor.id);
  return ra;
}

/** Đường KHÔNG có giao dịch nghiệp vụ (vd. sửa / huỷ buổi trial): ghi dấu rồi chạy ngay. */
export async function danhDauVaDongBo(nguon: readonly Nguon[], goc: NguonKichHoat, actor: NguoiThaoTac): Promise<KetQuaChayDongBo | null> {
  // Nghiệp vụ đã commit TRƯỚC lời gọi này — lỗi đồng bộ không được biến thao tác đã lưu thành "thất bại" trên màn hình.
  try {
    if (!(await danhDauCanDongBo(null, nguon, goc, actor))) return null;
    return await dongBoNgay(nguon, goc, actor);
  } catch (e) {
    const loi = e instanceof Error ? e.message : String(e);
    console.error("[parttime] đánh dấu đồng bộ lỗi", goc, loi);
    await writeAudit({
      actor,
      module: "hr_attendance",
      entityType: "SessionStaffAssignment",
      entityId: nguon.map((n) => `${n.sourceType}:${n.sourceId}`).join(",").slice(0, 190),
      action: "PARTTIME_STAFFING_SYNC_FAILED",
      newValues: { goc, loi: loi.slice(0, 500), buoc: "DANH_DAU" },
    }).catch(() => undefined);
    return null;
  }
}

/**
 * Gửi thông báo, GỘP theo người khi một lượt đồng bộ chạm nhiều buổi của cùng một người (đổi GV mặc định của lớp 48
 * buổi ⇒ 1 tin, không 48 tin). Khoá gộp dựng từ chính các khoá con (phân công + phiên bản) ⇒ gửi lại đúng lượt đó
 * không rung lần hai.
 */
export async function guiThongBaoGop(ds: readonly ThongBaoPhanCong[], boQuaUserId: string | null): Promise<void> {
  const theoNguoi = new Map<string, ThongBaoPhanCong[]>();
  for (const t of ds) theoNguoi.set(t.userId, [...(theoNguoi.get(t.userId) ?? []), t]);
  const gui: ThongBaoPhanCong[] = [];
  for (const [userId, cua] of theoNguoi) {
    if (cua.length <= 3) {
      gui.push(...cua);
      continue;
    }
    const khoa = createHash("sha1").update(cua.map((t) => t.dedupeKey).sort().join("|")).digest("hex").slice(0, 16);
    gui.push({
      userId,
      title: `Bạn có ${cua.length} phân công thay đổi`,
      body: "Lịch hoặc người phụ trách của nhiều buổi vừa đổi — mở Công việc của tôi để xem lịch mới.",
      href: cua[0].href,
      dedupeKey: `parttime.gop:${userId}:${khoa}`,
    });
  }
  await guiThongBaoPhanCong(gui, boQuaUserId);
}

function docNguon(payload: Record<string, unknown>): Nguon[] {
  const raw = Array.isArray(payload.nguon) ? payload.nguon : [];
  const hop = new Set(["CLASS_SESSION", "MAKEUP_CASE", "TRIAL_SESSION"]);
  return raw.flatMap((x) => {
    const o = x as { sourceType?: unknown; sourceId?: unknown };
    return typeof o.sourceType === "string" && hop.has(o.sourceType) && typeof o.sourceId === "string" && o.sourceId
      ? [{ sourceType: o.sourceType as Nguon["sourceType"], sourceId: o.sourceId }]
      : [];
  });
}

/** Handler outbox: chạy đồng bộ; còn nguồn lỗi ⇒ NÉM để dispatcher thử lại (idempotent nên thử lại vô hại). */
export async function onStaffingDirty(event: DomainEventLite): Promise<void> {
  const nguon = docNguon(event.payload);
  if (nguon.length === 0) return;
  const a = event.payload.actor as { id?: unknown; name?: unknown } | undefined;
  const actor: NguoiThaoTac = { id: typeof a?.id === "string" ? a.id : null, name: typeof a?.name === "string" ? a.name : "Hệ thống" };
  const goc = (typeof event.payload.goc === "string" ? event.payload.goc : "TAO_BUOI") as NguonKichHoat;
  const r = await dongBoNgay(nguon, goc, actor);
  if (r.loi.length > 0) throw new Error(`Đồng bộ phân công lỗi ${r.loi.length}/${r.soNguon} nguồn: ${r.loi[0].loi}`);
}

export function registerParttimeHandlers(): void {
  on("parttime.staffing_dirty", onStaffingDirty);
}
