// lib/crm/sale-board.ts — "Bảng việc hôm nay" của tư vấn viên.
//
// Máy tính SLA (`lib/crm/sla.ts`) đã đủ từ lâu nhưng CHƯA BAO GIỜ nối vào giao
// diện: nó chỉ được gọi từ cron để đẻ thông báo. Nghĩa là sale muốn biết hôm nay
// phải chạm ai thì phải đọc chuông, mà chuông thì trộn lẫn mọi loại việc.
//
// ⚠️ CHỈ HAI trong năm luật SLA là việc của người phụ trách:
//     SLA-3 — đã nhận khách mà chưa liên hệ lần nào
//     SLA-4 — khách im lặng quá lâu
// Ba luật còn lại (SLA-0 phản hồi tin nhắn · SLA-1 bàn giao · SLA-2 phân công) là
// các chặng TRƯỚC khi lead về tay sale. Đưa chúng lên bảng việc của sale là bắt
// họ nhìn thứ mình không bấm được — và một bảng có việc không làm được thì lần
// sau người ta không mở nữa.
import "server-only";
import type { LeadStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { leadOwnershipWhere, leadPhuTrachWhere } from "@/lib/lead/ownership";
import { TRANG_THAI_DA_DONG } from "@/lib/lead/sale-leads";
import {
  evaluateSla,
  loadSlaThresholds,
  slaInputFromLead,
  SLA_LABEL,
  type SlaRule,
  type SlaThresholds,
} from "@/lib/crm/sla";

/** Hai luật SLA mà chính người phụ trách xử được. */
export const LUAT_CUA_SALE: SlaRule[] = ["SLA-3", "SLA-4"];

export type ViecItem = {
  id: string;
  title: string;
  dueAt: Date;
  leadId: string;
  tenKhach: string | null;
};

export type NhomViec = {
  quaHan: ViecItem[];
  homNay: ViecItem[];
  sapToi: ViecItem[];
};

/**
 * Chia việc follow-up thành ba nhóm theo hạn. THUẦN.
 *
 * Mốc "hôm nay" tính theo giờ Việt Nam chứ không theo UTC: một việc hạn 23h tối
 * mà UTC đã sang ngày mới thì với người dùng nó vẫn là việc hôm nay.
 */
export function phanNhomViec(tasks: ViecItem[], now: Date): NhomViec {
  const cuoiNgay = cuoiNgayVN(now);
  const quaHan: ViecItem[] = [];
  const homNay: ViecItem[] = [];
  const sapToi: ViecItem[] = [];
  for (const t of tasks) {
    if (t.dueAt.getTime() < now.getTime()) quaHan.push(t);
    else if (t.dueAt.getTime() <= cuoiNgay.getTime()) homNay.push(t);
    else sapToi.push(t);
  }
  return { quaHan, homNay, sapToi };
}

/** 23:59:59.999 của "hôm nay" theo giờ Việt Nam (UTC+7), trả về mốc UTC. */
export function cuoiNgayVN(now: Date): Date {
  const lech = 7 * 3_600_000;
  const vn = new Date(now.getTime() + lech);
  vn.setUTCHours(23, 59, 59, 999);
  return new Date(vn.getTime() - lech);
}

export type KhachCanCham = {
  id: string;
  tenKhach: string | null;
  phone: string | null;
  status: LeadStatus;
  /** Các luật SLA đang vi phạm, đã lọc còn hai luật sale xử được. */
  luat: SlaRule[];
  /** Câu giải thích cho người đọc, không phải mã luật. */
  vi: string[];
  lastActivityAt: Date | null;
};

/**
 * Lọc vi phạm SLA còn lại hai luật của sale. THUẦN.
 *
 * `resolved` truyền vào TƯỜNG MINH theo trạng thái lead. Đây là chỗ cron đang sai
 * và ta cố ý không lặp lại: `slaInputFromLead` không set `resolved`, nên
 * `evaluateSla` coi mọi lead là chưa xong và bắn SLA-4 cho cả lead ĐÃ MẤT.
 * Xem ghi chú ở cuối file.
 */
export function loLuatCuaSale(
  lead: Parameters<typeof slaInputFromLead>[0] & { status: LeadStatus },
  now: Date,
  thresholds: SlaThresholds,
): SlaRule[] {
  const input = {
    ...slaInputFromLead(lead),
    resolved: TRANG_THAI_DA_DONG.includes(lead.status),
  };
  return evaluateSla(input, now, thresholds).filter((r) => LUAT_CUA_SALE.includes(r));
}

export type SaleBoard = {
  viec: NhomViec;
  canCham: KhachCanCham[];
  /** Số khách đang trong quá trình tư vấn (không tính đã chốt/đã mất/trùng). */
  soKhachDangMo: number;
  /** Khách chưa được chạm lần nào — nhóm dễ rơi nhất. */
  soChuaLienHe: number;
};

/**
 * Dựng bảng việc cho một tư vấn viên.
 *
 * Hai truy vấn, không hơn: một cho việc follow-up, một cho lead đang mở. Bảng mở
 * đầu ngày thì phải lên nhanh, và mọi con số ở đây đều suy được từ hai tập đó.
 */
export async function getSaleBoard(
  actor: Actor,
  userId: string,
  now = new Date(),
): Promise<SaleBoard> {
  const sdb = scopedDb(actor);
  const thresholds = await loadSlaThresholds();

  const [tasks, leads] = await Promise.all([
    // `LeadTask` không nằm trong SCOPED_MODELS nên cách ly cơ sở KHÔNG tự động ở
    // đây — lọc qua quan hệ `lead` (model có scope) để không đọc lọt việc của
    // cơ sở khác, và kèm luôn mệnh đề sở hữu.
    sdb.leadTask.findMany({
      where: {
        status: "OPEN",
        assignedToId: userId,
        lead: { deletedAt: null, AND: [leadOwnershipWhere(userId)] },
      },
      orderBy: { dueAt: "asc" },
      take: 100,
      select: {
        id: true,
        title: true,
        dueAt: true,
        leadId: true,
        lead: { select: { parentName: true } },
      },
    }),
    sdb.lead.findMany({
      where: {
        deletedAt: null,
        status: { notIn: TRANG_THAI_DA_DONG },
        // ⚠️ HẸP hơn "khách của tôi" ở màn danh sách, CÓ CHỦ ĐÍCH (S-4, 27/08).
        // Bảng này hỏi "tôi phải gọi ai", không hỏi "tôi được xem những ai".
        // Phiếu Sale Hội sở nhập được chia về Sale cơ sở ⇒ người phải gọi là Sale
        // cơ sở. Dùng mệnh đề rộng ở đây là bày lên bảng Hội sở hàng trăm việc họ
        // không bấm được, và `soKhachDangMo` bị đếm đôi trên hai màn.
        AND: [leadPhuTrachWhere(userId)],
      },
      // Đủ để đánh giá SLA + hiển thị, không lấy thừa.
      select: {
        id: true,
        parentName: true,
        phone: true,
        status: true,
        qualifiedAt: true,
        handedAt: true,
        receivedConfirmedAt: true,
        assignedAt: true,
        firstContactAt: true,
        lastActivityAt: true,
        createdAt: true,
      },
      take: 500,
    }),
  ]);

  const viec = phanNhomViec(
    tasks.map((t) => ({
      id: t.id,
      title: t.title,
      dueAt: t.dueAt,
      leadId: t.leadId,
      tenKhach: t.lead?.parentName ?? null,
    })),
    now,
  );

  const canCham: KhachCanCham[] = [];
  for (const l of leads) {
    const luat = loLuatCuaSale(l, now, thresholds);
    if (luat.length === 0) continue;
    canCham.push({
      id: l.id,
      tenKhach: l.parentName,
      phone: l.phone,
      status: l.status,
      luat,
      vi: luat.map((r) => SLA_LABEL[r]),
      lastActivityAt: l.lastActivityAt,
    });
  }
  // Người im lâu nhất lên trước — đó là người sắp mất, không phải người mới trễ.
  canCham.sort((a, b) => {
    const at = a.lastActivityAt?.getTime() ?? 0;
    const bt = b.lastActivityAt?.getTime() ?? 0;
    return at - bt;
  });

  return {
    viec,
    canCham,
    soKhachDangMo: leads.length,
    soChuaLienHe: leads.filter((l) => l.firstContactAt == null).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ MỘT LỖI ĐÃ BIẾT CỦA CRON, KHÔNG SỬA Ở ĐÂY
//
// `runSlaCheck` (lib/crm/sla.ts) gọi `evaluateSla(slaInputFromLead(lead), …)` mà
// `slaInputFromLead` KHÔNG set `resolved`. Trong `evaluateSla`, SLA-4 chỉ bị chặn
// bởi `!input.resolved` ⇒ `undefined` là falsy ⇒ **lead ĐÃ MẤT / ĐÃ CHỐT vẫn bị
// tính là "im lặng quá lâu"** và sinh một thông báo cho người phụ trách.
//
// Cron lọc `convertedAt: null` nên lead đã chuyển đổi thoát được, nhưng lead
// `LOST` và `DUPLICATE` thì không — chúng nằm im mãi mãi nên chắc chắn quá ngưỡng.
//
// Không sửa ở đây vì việc đó đổi lượng thông báo trên prod, cần người quyết. Bảng
// này tự truyền `resolved` đúng nên KHÔNG kế thừa lỗi đó. Cách vá khi được duyệt:
// thêm `resolved` vào `slaInputFromLead` (hàm thuần, đã có test) hoặc lọc trạng
// thái kết thúc ngay trong truy vấn của `runSlaCheck`.
// ─────────────────────────────────────────────────────────────────────────────
