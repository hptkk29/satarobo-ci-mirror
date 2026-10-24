// lib/lead/activity-write.ts — N-4: ĐƯỜNG GHI DUY NHẤT của một dòng hoạt động lead.
//
// Trước ticket này có 13 chỗ gọi `leadActivity.create`, và chỉ 3 chỗ (đều trong
// `app/(admin)/admin/leads/actions.ts`) nhớ cập nhật `Lead.lastActivityAt` kèm
// theo. Mười chỗ còn lại — tự chia lead, gán tay, chia lại khi sale nghỉ, ghi
// nhận tiền, phiếu trùng SĐT, phiếu thêm con, gán theo mã NV, bàn giao, đổi
// trạng thái — ghi hoạt động xong để nguyên đồng hồ.
//
// Hậu quả không nằm ở "code xấu" mà ở con số QLCS đọc: cột "số ngày chưa tiếp
// cận lại" (C-05) sai theo CẢ HAI chiều — lead vừa được máy chia vẫn hiện treo
// nhiều ngày, còn `isLeadIdle` (`lib/crm/sla.ts:100`) rơi ngược về `createdAt`
// nên che mất lead đã có hoạt động thật. Ngưỡng vàng ≥ 2 / đỏ ≥ 7 ngày (chốt
// 24/08/2026) vì thế báo động nhầm cả hai chiều.
//
// Hàm này ghi ĐỦ hai thứ, trong CÙNG transaction mà chỗ gọi đang mở:
//   1. dòng `LeadActivity`;
//   2. `Lead.lastActivityAt` = ĐÚNG `createdAt` của dòng vừa ghi.
//
// ⚠️ Vì sao lấy `createdAt` trả về chứ không `new Date()`: đợt vá N-4 có bước
// backfill so `lastActivityAt` với `MAX(LeadActivity.createdAt)`. Lấy đồng hồ
// tiến trình thì hai số lệch vài mili-giây trên MỌI dòng ⇒ lần đối soát nào cũng
// báo lệch và không còn phân biệt được lệch thật. `@default(now())` của Postgres
// là mốc TRANSACTION, nên nhiều dòng ghi trong cùng một lượt sẽ trùng khít nhau.
//
// ⚠️ KHÔNG `.catch()` nuốt lỗi ở đây và cũng đừng thêm ở chỗ gọi: bump hỏng mà
// dòng hoạt động vẫn lưu thì đồng hồ đứng im — đúng loại sai làm lead treo
// "hết treo" mà không ai biết vì sao. Cùng bài học đã vá ở C-07.
//
// ⚠️ `lastActivityAt` là "có hoạt động", KHÔNG phải "đã tiếp cận khách" — dòng
// máy ghi cũng bump. Đồng hồ tiếp cận nằm ở `activity-clock.ts` (hàm thuần, nhận
// danh sách loại truyền vào), đừng đem cột này dùng thẳng cho C-05.
//
// ─────────────────────────────────────────────────────────────────────────────
// S-3 — hàm này còn đóng nốt mốc `Lead.firstContactAt` ("Sale liên hệ lần đầu").
//
// Trước S-3 cột đó có mà KHÔNG AI GHI: chỗ ghi duy nhất `recordFirstContact`
// (`lib/crm/handover.ts:69`) không được gọi từ bất kỳ đâu trong `app/`/`lib/` —
// người gọi duy nhất là một file e2e. Hệ quả trên máy thật: bảng việc của Sale
// báo "chưa liên hệ lần nào" cho cả khách đã gọi 10 lần (`soChuaLienHe`,
// `lib/crm/sale-board.ts:207`), còn cảnh báo SLA-3 ("Chưa liên hệ khách > 3
// giờ", `lib/crm/sla.ts:78`) KHÔNG BAO GIỜ TẮT vì điều kiện tắt là
// `firstContactAt != null`. Chuông kêu mãi thì tư vấn viên học cách phớt lờ
// chuông — đúng thứ làm cả cơ chế SLA thành vô dụng.
//
// Đóng dấu ở ĐÂY chứ không thêm một hàm `recordFirstContact` thứ hai vì đây đã
// là cửa ghi hoạt động DUY NHẤT (test "chốt chặn nguồn" giữ nó duy nhất): mọi
// đường chạm khách — nhật ký tay của Sale trên màn lead lẫn trên site Sale
// (`addLeadActivity`), bàn giao — đều chảy qua đây, nên không có cửa nào ghi
// hoạt động mà quên mốc.
// ─────────────────────────────────────────────────────────────────────────────
import type { LeadActivityType, Prisma } from "@prisma/client";
import { LEAD_OUTREACH_TYPES, isLeadOutreach } from "./activity-clock";

export type RecordLeadActivityInput = {
  /** Transaction của chính lượt ghi — bắt buộc, đồng hồ phải cùng số phận với dòng hoạt động. */
  tx: Prisma.TransactionClient;
  leadId: string;
  /** `null` cho đường máy (cron, webhook, tự chia). */
  actorId?: string | null;
  actorName: string;
  type: LeadActivityType;
  content: string;
  metadata?: Prisma.InputJsonValue | null;
  /**
   * S-9 (27/08/2026) — lượt ghi này có được LÀM MỚI ĐỒNG HỒ CHĂM SÓC không.
   * Mặc định `true`: mọi đường ghi cũ giữ nguyên hành vi, không phải sửa gì.
   *
   * Đặt `false` thì dòng hoạt động VẪN LƯU, chỉ hai cú ghi phụ không xảy ra:
   * bump `lastActivityAt` (tắt SLA-4 + cột "số ngày chưa tiếp cận lại") và đóng
   * `firstContactAt` (tắt SLA-3 **vĩnh viễn** — mốc chỉ ghi một lần).
   *
   * ⚠️ Đây là cờ NGUY HIỂM theo chiều ngược lại: truyền `false` ở một đường
   * chạm khách THẬT là làm phiếu treo mãi trong danh sách "chưa tiếp cận". Chỉ
   * dùng khi người ghi KHÔNG phải chủ phiếu và không có quyền điều phối — quyết
   * định đó nằm ở `duocLamMoiDongHoChamSoc` (`lib/lead/sla-clock.ts`), đừng tự
   * suy điều kiện tại chỗ gọi. Test `[S-9] chỉ đường ghi chú của người-không-
   * phụ-trách mới tắt đồng hồ` khoá danh sách chỗ được phép truyền cờ này.
   */
  lamMoiDongHo?: boolean;
  /**
   * DUNG-DAN-03 (30/09/2026) — mốc THẬT của lần chạm khách, khi nó KHÁC lúc ghi. Sinh ra cho
   * đường nạp cuộc gọi tổng đài (`lib/calls/moc-crm.ts` — OmiCall, đã gỡ 06/10/2026; hiện KHÔNG
   * còn nơi nào truyền, giữ cho đường ghi hồi tố sau này): CDR tới qua đối soát 30 phút–6 giờ
   * sau, hoặc người rà soát gán lead cho cuộc gọi sau nhiều ngày — lấy giờ XỬ LÝ làm mốc thì
   * `firstContactAt` (SLA-3, "bao lâu tới liên hệ đầu"), `lastActivityAt` và dòng timeline
   * đều lệch đúng bằng độ trễ xử lý, và một lead cũ bị làm mới "vừa chăm sóc".
   *
   * Không truyền ⇒ hành vi cũ nguyên vẹn (mốc = `@default(now())` của dòng). Truyền ⇒
   *   · `LeadActivity.createdAt` = `luc`;
   *   · `lastActivityAt` = `luc` CHỈ KHI mới hơn giá trị đang có (điều kiện nằm trong `where`);
   *   · `firstContactAt` = `luc` khi còn trống (luật "chỉ ghi lần đầu" của S-3 giữ nguyên).
   * Mốc ở TƯƠNG LAI (đồng hồ nhà cung cấp lệch) bị bỏ, rơi về hành vi cũ.
   */
  luc?: Date;
};

export async function recordLeadActivity(
  input: RecordLeadActivityInput,
): Promise<{ id: string; createdAt: Date }> {
  const luc =
    input.luc && Number.isFinite(input.luc.getTime()) && input.luc.getTime() <= Date.now() ? input.luc : null;
  const row = await input.tx.leadActivity.create({
    data: {
      ...(luc ? { createdAt: luc } : {}),
      leadId: input.leadId,
      actorId: input.actorId ?? null,
      actorName: input.actorName,
      type: input.type,
      content: input.content,
      // Chỉ set khi chỗ gọi có truyền → không ghi đè `null` lên dòng cũ.
      ...(input.metadata != null ? { metadata: input.metadata } : {}),
    },
    select: { id: true, createdAt: true },
  });

  // S-9 — dòng nhật ký ở trên đã lưu xong và KHÔNG bị ảnh hưởng bởi cờ này.
  // Thoát sớm sau khi ghi, không thoát trước: "không được tắt đồng hồ" khác hẳn
  // "không được ghi chú", và gộp hai thứ là đúng cái đã phải đảo ở S-9.
  if (input.lamMoiDongHo === false) return row;

  if (luc) {
    // Mốc quá khứ: không được KÉO LÙI đồng hồ của một lead vừa có hoạt động mới hơn.
    await input.tx.lead.updateMany({
      where: { id: input.leadId, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: row.createdAt } }] },
      data: { lastActivityAt: row.createdAt },
    });
  } else {
    await input.tx.lead.update({
      where: { id: input.leadId },
      data: { lastActivityAt: row.createdAt },
    });
  }

  // S-3 — chỉ lượt CHẠM KHÁCH THẬT mới đóng dấu. Bộ lọc dùng lại nguyên
  // `isLeadOutreach`; đừng viết điều kiện loại thứ hai ở đây, vì lúc chủ dự án
  // chốt danh sách thì hai bản sẽ lệch nhau mà không ai biết.
  if (
    isLeadOutreach(
      { type: input.type, createdAt: row.createdAt, metadata: input.metadata },
      LEAD_OUTREACH_TYPES,
    )
  ) {
    // `updateMany` chứ không `update`: điều kiện "chỉ khi còn trống" nằm TRONG
    // `where` để Postgres tự lọc. Đọc-rồi-ghi thì hai lượt chạm gần nhau sẽ
    // cùng thấy `null` và lượt sau dời mốc — "liên hệ LẦN ĐẦU" hoá ra là "lần
    // gần nhất", và báo cáo "bao lâu từ lúc nhận khách tới cuộc gọi đầu" mất
    // nghĩa. `count: 0` là kết quả ĐÚNG cho lead đã có mốc, không phải lỗi.
    await input.tx.lead.updateMany({
      where: { id: input.leadId, firstContactAt: null },
      data: { firstContactAt: row.createdAt },
    });
  }

  return row;
}
