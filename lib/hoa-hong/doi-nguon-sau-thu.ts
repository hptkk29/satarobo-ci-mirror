// lib/hoa-hong/doi-nguon-sau-thu.ts — ĐỔI NGUỒN SAU KHI ĐÃ THU TIỀN → SOURCE_CORRECTION (04 §10.4 bước 4, §11.4; 03 §3).
//
// PR2 (`lib/nguon/doi-nguon-lead.ts`) phát `nguon.da-doi-sau-thanh-toan` CÙNG transaction với lượt đổi và cố ý KHÔNG đụng sổ hoa hồng. Tệp này là phần của
// ENGINE: với MỌI khoản thu có ô của lead đó, so Σ ròng với kỳ vọng theo attribution MỚI (tính trên `coSoConLai`, rule tại `rateDate` GỐC) và ghi MỘT dòng
// `SOURCE_CORRECTION` = chênh lệch cho mỗi (vai × người) — không "đảo toàn phần + ghi lại" (bản đó trả hai lần, 04 §10.4 phần "Vì sao viết lại").
//
// Idempotent hai tầng: (1) chênh lệch tính trên Σ ròng HIỆN TẠI nên chạy lại sau khi đã ghi ⇒ chênh = 0 ⇒ không ghi; (2) khoá dòng điều chỉnh
// `SOURCE_CORRECTION|<refEventId>|<ô>|<người>` chặn lượt retry cùng sự kiện. Ô có khiếu nại ⇒ KHÔNG tự động (rơi về INPUT_DRIFT cho người duyệt).
import type { PrismaClient } from "@prisma/client";

import type { BoiCanhQuet } from "./boi-canh";
import { docKhoan } from "./nap-khoan";
import { soVoiO, tachChenhDoiNguon, type ChenhNguoi } from "./o-tinh";
import { docTrangThaiO } from "./o-tinh-db";
import { hashCuaKetQua, kyVongCua, lapThu, quetKhoan } from "./quet-khoan";
import { tinhDongChoKhoan } from "./tinh-dong-cho-khoan";

export type KetQuaDoiNguonSauThu = { soKhoan: number; theoKetQua: Record<string, number> };

/**
 * @param refEventId định danh SỰ KIỆN đổi nguồn: `DomainEvent.id` (đường sự kiện) hoặc `audit:<AuditLog.id>` (đường backfill từ AuditLog). Hai đường có thể
 *                   cùng xử lý MỘT lượt đổi — vẫn không ghi hai lần vì chênh lệch tính trên Σ ròng (lượt sau thấy chênh = 0).
 */
export async function apDungDoiNguonSauThu(client: PrismaClient, bc: BoiCanhQuet, i: { leadId: string; refEventId: string }): Promise<KetQuaDoiNguonSauThu> {
  // Mọi khoản thu CÓ Ô của lead. Sắp theo ngày thu để kết quả tất định.
  const slots = await client.commissionCalcSlot.findMany({
    where: { payment: { order: { leadId: i.leadId } } },
    select: { paymentId: true, payment: { select: { paidDate: true } } },
  });
  const theoKhoan = new Map(slots.map((s) => [s.paymentId, s.payment.paidDate]));
  const ids = [...theoKhoan.entries()].sort(([a, da], [b, db]) => da.getTime() - db.getTime() || (a < b ? -1 : 1)).map(([id]) => id);

  const theoKetQua: Record<string, number> = {};
  for (const id of ids) {
    const r = await quetKhoan(client, bc, id, { cheDo: "DOI_NGUON_CO_QUYEN", refEventId: i.refEventId });
    const nhan = r.loai === "BO_QUA" ? `BO_QUA:${r.lyDo}` : r.loai;
    theoKetQua[nhan] = (theoKetQua[nhan] ?? 0) + 1;
  }
  return { soKhoan: ids.length, theoKetQua };
}

export type XemTruocKhoan = {
  paymentId: string;
  /** Phần do NGUỒN gây ra — `--apply` sẽ ghi `SOURCE_CORRECTION` đúng các dòng này. */
  tuGhi: ChenhNguoi[];
  /** Phần lệch vì lý do KHÁC nguồn (vd người chốt đổi) — `--apply` KHÔNG ghi, để lại `INPUT_DRIFT` cho người duyệt. */
  choDuyet: ChenhNguoi[];
  /** `GHI` = có chênh lệch tự ghi · `KHONG_GHI` = ô khớp / đã chấp nhận / có khiếu nại (rơi về duyệt) / không dựng được kỳ vọng. */
  ketQua: "GHI" | "KHONG_GHI";
  lyDo?: string;
};

/**
 * XEM TRƯỚC (CHỈ ĐỌC, không khoá, không ghi) những gì `apDungDoiNguonSauThu` sẽ làm với lead — dùng cho dry-run của script backfill để người vận hành thấy
 * từng (vai × người) × số tiền TRƯỚC khi `--apply`. Cùng các hàm thuần với đường ghi (`lapThu` · `tinhDongChoKhoan` · `soVoiO` · `tachChenhDoiNguon`) nên không có bản tính thứ hai.
 */
export async function xemTruocDoiNguonSauThu(client: PrismaClient, bc: BoiCanhQuet, leadId: string): Promise<XemTruocKhoan[]> {
  const slots = await client.commissionCalcSlot.findMany({
    where: { payment: { order: { leadId } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, paymentId: true },
  });
  const slotDauTheoKhoan = new Map<string, string>();
  for (const s of slots) if (!slotDauTheoKhoan.has(s.paymentId)) slotDauTheoKhoan.set(s.paymentId, s.id);

  const vaiAcq = new Set(bc.hoaHong.vaiHuong.filter((v) => v.isAcquisition).map((v) => v.code));
  const ra: XemTruocKhoan[] = [];
  for (const [paymentId, slotId] of slotDauTheoKhoan) {
    const p = await docKhoan(client, paymentId);
    if (!p) {
      ra.push({ paymentId, tuGhi: [], choDuyet: [], ketQua: "KHONG_GHI", lyDo: "KHOAN_KHONG_TON_TAI" });
      continue;
    }
    const lap = await lapThu(client, bc, p);
    if (lap.loai !== "TINH") {
      ra.push({ paymentId, tuGhi: [], choDuyet: [], ketQua: "KHONG_GHI", lyDo: `KHONG_DUNG_DUOC_KY_VONG:${lap.loai}` });
      continue;
    }
    const o = (await docTrangThaiO(client, [slotId])).get(slotId);
    if (!o) {
      ra.push({ paymentId, tuGhi: [], choDuyet: [], ketQua: "KHONG_GHI", lyDo: "O_KHONG_TON_TAI" });
      continue;
    }
    const kq = tinhDongChoKhoan(lap.kh.dauVao(o.coSoConLai));
    if (kq.loai !== "OK") {
      ra.push({ paymentId, tuGhi: [], choDuyet: [], ketQua: "KHONG_GHI", lyDo: `LOI_CAU_HINH:${kq.loai}` });
      continue;
    }
    const r = soVoiO({ o, kyVong: kyVongCua(kq), hashMoi: hashCuaKetQua(lap.kh, bc, o.coSoConLai, kq), cheDo: "DOI_NGUON_CO_QUYEN" });
    if (r.loai === "GHI") {
      const { tuGhi, choDuyet } = tachChenhDoiNguon(r.chenh, vaiAcq);
      ra.push({ paymentId, tuGhi, choDuyet, ketQua: tuGhi.length > 0 ? "GHI" : "KHONG_GHI", ...(tuGhi.length === 0 ? { lyDo: "CHI_CO_PHAN_CHO_DUYET" } : {}) });
    } else {
      ra.push({ paymentId, tuGhi: [], choDuyet: r.loai === "INPUT_DRIFT" ? r.chenh : [], ketQua: "KHONG_GHI", lyDo: r.loai === "INPUT_DRIFT" ? "O_CO_KHIEU_NAI" : r.lyDo });
    }
  }
  return ra;
}
