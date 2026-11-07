// lib/finance/hoa-don/gan-them-khoan-db.ts — TẦNG DB của «gắn thêm một khoản thu vào hoá đơn đã xác nhận» (07/11/2026). Lõi quyết định: `gan-them-khoan.ts` (thuần).
//
// ── MỤC TIÊU KHÔNG NẰM TRONG MÃ ────────────────────────────────────────────────────────────────────────────
//   Đơn · ký hiệu · số hoá đơn · mã giao dịch của khoản · tổng trên tờ giấy là THAM SỐ do người chạy khai (workflow input) và nằm trong dòng owner ký.
//
// ── PHÉP GHI: HAI bảng, mỗi bảng ĐÚNG MỘT lời gọi ───────────────────────────────────────────────────────────
//   · `HoaDonKhoan.create` — (hoaDon, khoản, soTien = tiền RÒNG, hieuLuc = true);
//   · `HoaDonDienTu.updateMany` — `tongTien` tongTruoc → tongSau, CÓ ĐIỀU KIỆN (đúng trạng thái · nguồn · tổng cũ); lệch ⇒ THROW.
//   KHÔNG `Payment` / `Receipt` / `PaymentRequest` / tệp / số hoá đơn / email. Bằng chứng KHÔNG đụng nằm TRONG transaction: «ảnh chụp bất biến»
//   (mọi Payment của đơn · Receipt · tệp + số + người mua của hoá đơn) chụp TRƯỚC phép ghi đầu tiên và SAU phép ghi cuối; khác nhau ⇒ throw ⇒ lùi.
//
// ── THỨ TỰ TRONG TRANSACTION (luật rollback: từ chối = `throw`, mọi cổng đứng TRƯỚC phép ghi đầu tiên) ──────────
//   khoá đơn (advisory) → khoá HÀNG hoá đơn + khoản (FOR UPDATE) → ĐỌC LẠI + lập lại kế hoạch → cổng quyết định → trả sớm khi đã xong →
//   ảnh chụp «trước» → cổng Wave 1 → claim nonce (phép ghi ĐẦU TIÊN) → create + updateMany + audit → đọc lại phải ra «đã xong» → ảnh chụp «sau» = «trước» → audit mức lượt.
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { writeAudit } from "@/lib/audit/audit-log";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { claimPheDuyet, kiemCongGhiTruocGhi, WORKFLOW_WAVE1, type DauVaoCongGhi } from "@/lib/security/cong-ghi-wave1";
import { dungBanGhiLuotWaveC, khoaLuotChayWaveC, type LuotChayWaveC } from "@/lib/nguon/wave-c-chung";
import { chonHoanCuaDon, dieuKienHoanCuaDon, hoanTheoDon, lyDoHoanChanXacNhan, TRANG_THAI_HOAN_CAN_NAP } from "./hoan-tien-don";
import { chuanHoaMaGiaoDichNganHang } from "@/lib/payments/ma-giao-dich-ngan-hang";
import { nguonGiaoDich, soTienRong } from "./nguon-khoan";
import { TRANG_THAI_DON_DA_HUY } from "./du-dieu-kien";
import {
  ENTITY_LUOT_GAN_THEM_KHOAN,
  HANH_DONG_GAN_THEM_KHOAN,
  HANH_DONG_GAN_THEM_KHOAN_LUOT,
  LY_DO_GAN_THEM_KHOAN,
  lapKeHoachGanKhoan,
  quyetDinhGhiGanKhoan,
  type DuLieuGanKhoan,
  type KeHoachGanKhoan,
  type MucTieuGanKhoan,
} from "./gan-them-khoan";

export type KhachGanKhoan = PrismaClient | Prisma.TransactionClient;

export const ACTOR_GAN_THEM_KHOAN = { id: null, name: "Script gắn thêm khoản vào hoá đơn đã xác nhận (gan-them-khoan)" } as const;

const chuanMa = (s: string) => s.trim().toUpperCase();
/** Marker của khoản GHI TAY có khai mã giao dịch ngân hàng (`maGiaoDichMarker` ở `lib/finance/payment-markers.ts`) — `nguonGiaoDich` KHÔNG đọc dạng này. */
const MARKER_MA_GD = /\[ma-gd:([^\]]+)\]/;

/** ĐỌC dữ liệu của MỘT đơn. Số câu đọc cố định, không theo số khoản. */
export async function docDuLieuGanKhoan(c: KhachGanKhoan, muc: MucTieuGanKhoan): Promise<DuLieuGanKhoan> {
  const don = await c.order.findFirst({ where: { code: muc.maDon }, select: { id: true, code: true, status: true, deletedAt: true } });
  if (!don) return { muc, don: null, hoaDon: [], khoan: [], yeuCauHoanChan: null };

  const [hoaDon, cacDong] = await Promise.all([
    c.hoaDonDienTu.findMany({
      where: { orderId: don.id, kyHieu: muc.kyHieu, soHoaDon: muc.soHoaDon },
      select: { id: true, trangThai: true, nguonPhatHanh: true, tongTien: true, _count: { select: { dong: true } }, khoan: { where: { hieuLuc: true }, select: { paymentId: true, soTien: true } } },
    }),
    c.payment.findMany({
      where: { orderId: don.id, deletedAt: null },
      select: { id: true, orderId: true, amount: true, adjustmentOfId: true, deletedAt: true, note: true, orderItemId: true, enrollmentId: true },
    }),
  ]);

  // Khoản mang mã giao dịch — BA dạng marker: webhook `[auto:<provider>:<mã>]` (mã ghi thẳng), gắn tay `[gan-tay:<BankTransaction.id>]` (tra mã của giao dịch),
  // và khoản kế toán ghi tay có khai mã `[ma-gd:<mã chuẩn hoá>]` (`nguonGiaoDich` không đọc dạng này nên đọc ở đây).
  const ma = chuanMa(muc.maGiaoDich);
  const maChuanHoa = chuanHoaMaGiaoDichNganHang(muc.maGiaoDich) ?? ma;
  const bangMa = (x: string) => chuanMa(x) === ma || (chuanHoaMaGiaoDichNganHang(x) ?? chuanMa(x)) === maChuanHoa;
  const idGanTay = cacDong.flatMap((p) => {
    const n = nguonGiaoDich(p.note);
    return n.loai === "GAN_TAY" ? [n.bankTransactionId] : [];
  });
  const giaoDichGanTay =
    idGanTay.length === 0 ? [] : await c.bankTransaction.findMany({ where: { id: { in: idGanTay } }, select: { id: true, providerTxnId: true } });
  const maCuaGiaoDich = new Map(giaoDichGanTay.map((g) => [g.id, g.providerTxnId ?? ""]));
  const rong = soTienRong(cacDong);
  const khop = cacDong.filter((p) => {
    const n = nguonGiaoDich(p.note);
    if (n.loai === "WEBHOOK") return bangMa(n.providerTxnId);
    if (n.loai === "GAN_TAY") return bangMa(maCuaGiaoDich.get(n.bankTransactionId) ?? "");
    const khaiTay = p.note ? MARKER_MA_GD.exec(p.note) : null;
    return khaiTay !== null && bangMa(khaiTay[1]!);
  });

  const nam = khop.length === 0 ? [] : await c.hoaDonKhoan.findMany({
    where: { paymentId: { in: khop.map((p) => p.id) }, hieuLuc: true },
    select: { paymentId: true, hoaDon: { select: { id: true, trangThai: true, kyHieu: true, soHoaDon: true } } },
  });

  const hoan = await c.refundRequest.findMany({ where: dieuKienHoanCuaDon([don.id], TRANG_THAI_HOAN_CAN_NAP), select: chonHoanCuaDon([don.id]) });
  const yeuCauHoanChan = lyDoHoanChanXacNhan(
    hoanTheoDon(hoan).get(don.id) ?? [],
    khop.map((p) => ({ orderItemId: p.orderItemId ?? null, enrollmentId: p.enrollmentId ?? null })),
  );

  return {
    muc,
    don: { id: don.id, code: don.code, daHuyHoacXoa: don.deletedAt !== null || (TRANG_THAI_DON_DA_HUY as readonly string[]).includes(don.status) },
    hoaDon: hoaDon.map((h) => ({
      id: h.id,
      trangThai: h.trangThai,
      nguonPhatHanh: h.nguonPhatHanh,
      tongTien: h.tongTien,
      soDongHub: h._count.dong,
      khoanSong: h.khoan,
    })),
    khoan: khop.map((p) => ({
      paymentId: p.id,
      rong: rong.get(p.id) ?? 0,
      laDongThuGoc: p.adjustmentOfId === null && p.deletedAt === null,
      thuocDon: p.orderId === don.id,
      dangNamTrong: nam.filter((x) => x.paymentId === p.id).map((x) => ({ hoaDonId: x.hoaDon.id, trangThai: x.hoaDon.trangThai, kyHieu: x.hoaDon.kyHieu, soHoaDon: x.hoaDon.soHoaDon })),
    })),
    yeuCauHoanChan,
  };
}

export async function docKeHoachGanKhoan(c: KhachGanKhoan, muc: MucTieuGanKhoan): Promise<KeHoachGanKhoan> {
  return lapKeHoachGanKhoan(await docDuLieuGanKhoan(c, muc));
}

/** Ảnh chụp những gì lệnh này CẤM đụng: mọi Payment của đơn, Receipt của chúng, và (trừ `tongTien`) mọi cột của hoá đơn. */
async function anhChupBatBien(tx: Prisma.TransactionClient, orderId: string, hoaDonId: string): Promise<string> {
  const [payment, receipt, hoaDon, guiEmail] = await Promise.all([
    tx.payment.findMany({ where: { orderId }, orderBy: { id: "asc" } }),
    tx.receipt.findMany({ where: { payment: { orderId } }, orderBy: { id: "asc" } }),
    tx.hoaDonDienTu.findUnique({ where: { id: hoaDonId } }),
    tx.hoaDonGuiEmail.findMany({ where: { hoaDonId }, orderBy: { id: "asc" } }),
  ]);
  // `tongTien` và `updatedAt` của hoá đơn là thứ DUY NHẤT được đổi ⇒ loại khỏi ảnh chụp.
  const { tongTien: _t, updatedAt: _u, ...hoaDonConLai } = hoaDon ?? ({} as Record<string, unknown>);
  void _t;
  void _u;
  return createHash("sha256")
    .update(JSON.stringify({ payment, receipt, hoaDon: hoaDonConLai, guiEmail }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), "utf8")
    .digest("hex");
}

export type DauVaoGhiGanKhoan = {
  muc: MucTieuGanKhoan;
  /** `null` = không truyền `--expect`. */
  soDuyet: number | null;
  /** `has_table_privilege(…, 'INSERT'/'UPDATE')` trên hai bảng ghi; `null` = không kiểm được. */
  ghiDuoc: boolean | null;
  actor: { id: null; name: string };
  luotChay: LuotChayWaveC;
  /** Cổng ghi Wave 1 (artifact owner ký). BẮT BUỘC khai: không có đường ghi nào không qua cổng. */
  congGhi: DauVaoCongGhi;
};

export type KetQuaGhiGanKhoan = { daGhi: number; daXong: boolean; keHoachSha: string; tongSau: number | null };

/** GHI. Trước transaction chỉ để BÁO SỚM; cổng chặn thật nằm TRONG transaction. */
export async function ghiGanKhoan(c: PrismaClient, input: DauVaoGhiGanKhoan): Promise<KetQuaGhiGanKhoan> {
  const kh = await docKeHoachGanKhoan(c, input.muc);
  const truoc = quyetDinhGhiGanKhoan({ kh, tongTrenToGiay: input.muc.tongTrenToGiay, soDuyet: input.soDuyet, ghiDuoc: input.ghiDuoc });
  if (truoc !== null) throw new Error(truoc);
  return c.$transaction((tx) => ghiGanKhoanTrongTx(tx, input), { timeout: 60_000, maxWait: 15_000 });
}

/** Phần TRONG transaction — export riêng để ca DB gọi THẲNG. */
export async function ghiGanKhoanTrongTx(tx: Prisma.TransactionClient, input: DauVaoGhiGanKhoan): Promise<KetQuaGhiGanKhoan> {
  // 1) KHOÁ: đơn (advisory, cùng khoá mọi đường ghi tiền / hoá đơn của đơn) → hàng hoá đơn → hàng khoản.
  const don = await tx.order.findFirst({ where: { code: input.muc.maDon }, select: { id: true } });
  if (!don) throw new Error(`Không có đơn ${input.muc.maDon} — lùi.`);
  await khoaDonTrongTx(tx, don.id);
  await tx.$queryRaw`SELECT id FROM "HoaDonDienTu" WHERE "orderId" = ${don.id} ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE "orderId" = ${don.id} ORDER BY id FOR UPDATE`;

  // 2) ĐỌC LẠI sau khi khoá + lập lại kế hoạch bằng CHÍNH hàm thuần; cổng quyết định.
  const kh = await docKeHoachGanKhoan(tx, input.muc);
  const loi = quyetDinhGhiGanKhoan({ kh, tongTrenToGiay: input.muc.tongTrenToGiay, soDuyet: input.soDuyet, ghiDuoc: input.ghiDuoc });
  if (loi !== null) throw new Error(loi);

  // Đã xong (chạy lại) ⇒ 0 dòng ghi, KHÔNG cổng, KHÔNG claim.
  if (kh.daXong || kh.ghi === null) return { daGhi: 0, daXong: true, keHoachSha: kh.sha, tongSau: null };
  const g = kh.ghi;

  // 3) Ảnh chụp bất biến «trước».
  const truocAnh = await anhChupBatBien(tx, don.id, g.hoaDonId);

  // 4) CỔNG WAVE 1 — TRƯỚC phép ghi đầu tiên; dòng do CHÍNH lõi dựng. Claim `wg:<nonce>` là PHÉP GHI ĐẦU TIÊN.
  const duoc = await kiemCongGhiTruocGhi(tx, input.congGhi, WORKFLOW_WAVE1.ganKhoanHoaDon, kh.dongDauRa);
  await claimPheDuyet(tx, duoc, { appliedAt: input.congGhi.now, rowCount: kh.dongDauRa.length, runRef: input.congGhi.runRef });

  // 5) GHI. Điều kiện «đang đúng trạng thái đã lập kế hoạch» nằm trong `where`: lệch ⇒ THROW — không `continue`.
  const hd = await tx.hoaDonDienTu.findUnique({ where: { id: g.hoaDonId }, select: { centerId: true } });
  if (!hd) throw new Error("Hoá đơn biến mất giữa chừng — lùi.");
  const upd = await tx.hoaDonDienTu.updateMany({
    where: { id: g.hoaDonId, trangThai: "DA_XAC_NHAN", nguonPhatHanh: "TAI_LEN", tongTien: g.tongTruoc },
    data: { tongTien: g.tongSau },
  });
  if (upd.count !== 1) throw new Error("Hoá đơn không còn đúng trạng thái / tổng lúc lập kế hoạch giữa chừng — lùi.");
  await tx.hoaDonKhoan.create({ data: { hoaDonId: g.hoaDonId, paymentId: g.paymentId, soTien: g.soTien, hieuLuc: true } });
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: "HoaDonDienTu",
    entityId: g.hoaDonId,
    action: HANH_DONG_GAN_THEM_KHOAN,
    oldValues: { tongTien: g.tongTruoc },
    newValues: { tongTien: g.tongSau, paymentIdThem: g.paymentId, soTienThem: g.soTien, orderCode: input.muc.maDon, hoaDon: `${input.muc.kyHieu}-${input.muc.soHoaDon}`, tongTrenToGiay: input.muc.tongTrenToGiay },
    changedFields: ["tongTien", "khoan"],
    reason: LY_DO_GAN_THEM_KHOAN,
    orgUnitId: hd.centerId,
    tx,
  });

  // 6) ĐỌC LẠI: kế hoạch phải ra «đã xong» và không bất biến nào bị đổi.
  const sau = await docKeHoachGanKhoan(tx, input.muc);
  if (!sau.daXong) throw new Error(`Sau khi ghi, kế hoạch không ra «đã xong» (${sau.loi.map((l) => l.ma).join(", ") || "còn dòng chưa ghi"}) — lùi.`);
  if ((await anhChupBatBien(tx, don.id, g.hoaDonId)) !== truocAnh) {
    throw new Error("Ảnh chụp bất biến (Payment · Receipt · tệp / số / người mua của hoá đơn · lượt gửi email) ĐỔI sau phép ghi — lùi.");
  }

  // 7) Bản ghi MỨC LƯỢT CHẠY — cùng transaction.
  if (input.soDuyet === null) throw new Error("ghiGanKhoanTrongTx: thiếu soDuyet sau khi cổng đã qua.");
  await writeAudit({
    actor: input.actor,
    module: "finance",
    entityType: ENTITY_LUOT_GAN_THEM_KHOAN,
    entityId: khoaLuotChayWaveC(input.luotChay.nguonChay),
    action: HANH_DONG_GAN_THEM_KHOAN_LUOT,
    oldValues: null,
    newValues: dungBanGhiLuotWaveC({
      luot: input.luotChay,
      soDuyet: input.soDuyet,
      soKeHoach: kh.dongDauRa.length,
      daGhi: 1,
      keHoachSha: kh.sha,
      chiTiet: { orderCode: input.muc.maDon, hoaDonId: g.hoaDonId, paymentId: g.paymentId, tongTruoc: g.tongTruoc, tongSau: g.tongSau },
    }),
    changedFields: ["expectedCount", "actualCount"],
    reason: "Lượt chạy gắn thêm khoản vào hoá đơn đã xác nhận: người bấm · số đã duyệt · số thực ghi",
    tx,
  });
  return { daGhi: 1, daXong: true, keHoachSha: kh.sha, tongSau: g.tongSau };
}

/** KIỂM SAU GHI (chỉ đọc): kế hoạch lập lại phải ra `daXong`; kèm lượt ghi gần nhất để đối chiếu. */
export async function kiemSauGhiGanKhoan(
  c: KhachGanKhoan,
  muc: MucTieuGanKhoan,
): Promise<{ keHoach: KeHoachGanKhoan; luotCuoi: { entityId: string; orderCode: string | null } | null; dat: boolean }> {
  const keHoach = await docKeHoachGanKhoan(c, muc);
  const luot = await c.auditLog.findFirst({
    where: { entityType: ENTITY_LUOT_GAN_THEM_KHOAN, action: HANH_DONG_GAN_THEM_KHOAN_LUOT },
    orderBy: { createdAt: "desc" },
    select: { entityId: true, newValues: true },
  });
  const nv = (luot?.newValues ?? null) as { orderCode?: unknown } | null;
  const luotCuoi = luot === null ? null : { entityId: luot.entityId, orderCode: typeof nv?.orderCode === "string" ? nv.orderCode : null };
  return { keHoach, luotCuoi, dat: keHoach.daXong && keHoach.loi.length === 0 && luotCuoi !== null && luotCuoi.orderCode === muc.maDon };
}
