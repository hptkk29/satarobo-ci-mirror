// lib/uat/nguon-final-lead-cu.ts — LEAD NHÃN CŨ "UAT SOURCE FINAL": lead mang nhãn `Lead.source` cũ và CỐ Ý CHƯA có quy nguồn (không `LeadAttribution`) — mồi cho lượt «Vét lead cũ» (`vet-lead-cu-*`) của lane UAT.
//
// Vì sao một tệp riêng, KHÔNG dùng `ghiQuyNguonLeadMoi`: lưới `[QN-W1]` đòi mọi tệp có lời gọi tạo lead (`lead` + `create`) hoặc nằm trong DA_NOI (kèm lời gọi ghi nguồn) hoặc trong MIEN kèm lý do. Tệp này là lý do duy nhất của MIEN:
// nó tái hiện ĐÚNG hình dạng dữ liệu mà prod có trước module Nguồn (lead có nhãn, không có nguồn) — nếu quy nguồn ngay lúc tạo thì chẳng còn gì để vét. Chỉ chạy trên DB UAT (cổng ở script), không bao giờ chạm prod.
// Cùng lý do với `prisma/seed-uat/02-crm.ts` / `08-noi-lead.ts` (gieo lead cũ nhãn cũ) — khác là tệp này nằm dưới `lib/` nên bị lưới quét và phải khai.
//
// Ba lớp mong đợi của lượt vét (đo bằng chính `anhXaNhanCu` ở `nguon-final.test.ts`, không viết lại luật): AUTO · MANUAL_REVIEW · OTHER. IDEMPOTENT theo SĐT giả; không xoá, không sửa lead có sẵn.
import { db } from "@/lib/db";

import { LEAD_CU, LEAD_CU_DAI_DIEN, phoneLeadCu, phoneLeadCuDaiDien, tenLeadCu, tenLeadCuDaiDien, type MucNapNf } from "./nguon-final";

export async function napLeadCuNguonFinal(i: { apply: boolean; centerId: string }): Promise<MucNapNf[]> {
  const ra: MucNapNf[] = [];
  for (const lc of LEAD_CU) {
    const phone = phoneLeadCu(lc.ma);
    const co = await db.lead.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
    if (co) ra.push({ nhom: "Lead nhãn cũ", ma: lc.ma, trangThai: "DA_CO", ghiChu: `nhãn «${lc.nhan}»` });
    else if (!i.apply) ra.push({ nhom: "Lead nhãn cũ", ma: lc.ma, trangThai: "SE_TAO", ghiChu: `nhãn «${lc.nhan}» · ${lc.tieuDe}` });
    else {
      await db.lead.create({ data: { parentName: tenLeadCu(lc.ma), phone, status: "MOI", source: lc.nhan, centerId: i.centerId, createdAt: lc.taoLuc, lastInboundAt: lc.taoLuc } });
      ra.push({ nhom: "Lead nhãn cũ", ma: lc.ma, trangThai: "DA_TAO", ghiChu: `nhãn «${lc.nhan}» · ${lc.tieuDe}` });
    }
  }
  return ra;
}

/** Nhóm mục của đường tường minh — khác nhóm «Lead nhãn cũ» của bộ nạp chung để báo cáo hai đường không lẫn. */
export const NHOM_LEAD_CU_DAI_DIEN = "Lead nhãn cũ (đại diện)";

/**
 * ĐƯỜNG TƯỜNG MINH (lane F5, nút `nguon_viec = uat-nap-lead-cu-*`): nạp `LEAD_CU_DAI_DIEN` — lead nhãn cũ CHƯA quy nguồn — và CHO PHÉP chạy khi mốc cutover đã đặt (ngược với `napLeadCuNguonFinal`, bị gọi với `apply: false` khi mốc đã đặt).
 *
 * Vì sao bỏ qua cổng «mốc đã đặt» là CÓ CHỦ ĐÍCH và AN TOÀN (không phải kẽ hở):
 *   · cổng cũ sinh ra để khỏi làm trang «Chuyển hoa hồng» báo DI_TRU_CHUA_SAN_SANG ở lần đổi mốc sau, và để thứ tự checklist 09 (vét lead cũ TRƯỚC khi đặt mốc) không bị đảo; còn đường này chỉ chạy khi người vận hành
 *     CHỦ Ý dựng hiện trường cho một lượt UAT backfill — lượt backfill (`vet-lead-cu-ghi`, đòi bốn số đã duyệt + chữ ký owner) sẽ quy nguồn chúng, và N/M/INVALID in ra ở `vet-lead-cu-chay-thu` là bằng chứng;
 *   · lead đại diện KHÔNG có đơn, KHÔNG có khoản thu ⇒ engine hoa hồng không có gì để quét; `createdAt` ở quá khứ (muộn nhất 07/10/2026) nên `--den` hợp lý luôn bao được chúng;
 *   · mọi nhãn nằm trong bảng 28 nhãn ⇒ INVALID = 0 (lưới `[SRC-INT-79]`); không nhãn lạ nào được nạp để thử cổng INVALID.
 * IDEMPOTENT theo SĐT giả (dải `09907`), tên mang tiền tố «UAT SOURCE FINAL»; KHÔNG xoá, KHÔNG sửa lead có sẵn (kể cả lead đại diện đã được backfill quy nguồn — báo DA_CO, không tạo lại).
 * Cổng DB (`kiemUrlDbUat`/`kiemCongDbUat`) do SCRIPT gọi trước khi vào đây; hàm này tin `db` đã qua cổng. Dry-run (`apply: false`): chỉ ĐỌC.
 */
export async function napLeadCuDaiDien(i: { apply: boolean; centerId: string }): Promise<MucNapNf[]> {
  const ra: MucNapNf[] = [];
  for (const lc of LEAD_CU_DAI_DIEN) {
    const phone = phoneLeadCuDaiDien(lc.ma);
    const co = await db.lead.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
    if (co) ra.push({ nhom: NHOM_LEAD_CU_DAI_DIEN, ma: lc.ma, trangThai: "DA_CO", ghiChu: `nhãn «${lc.nhan}»` });
    else if (!i.apply) ra.push({ nhom: NHOM_LEAD_CU_DAI_DIEN, ma: lc.ma, trangThai: "SE_TAO", ghiChu: lc.tieuDe });
    else {
      await db.lead.create({ data: { parentName: tenLeadCuDaiDien(lc.ma), phone, status: "MOI", source: lc.nhan, centerId: i.centerId, createdAt: lc.taoLuc, lastInboundAt: lc.taoLuc } });
      ra.push({ nhom: NHOM_LEAD_CU_DAI_DIEN, ma: lc.ma, trangThai: "DA_TAO", ghiChu: lc.tieuDe });
    }
  }
  return ra;
}
