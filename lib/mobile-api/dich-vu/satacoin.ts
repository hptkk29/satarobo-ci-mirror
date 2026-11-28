import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { mucSataCoinDangHien } from "@/lib/portal/muc-tam-an";
import { getBalance, listTransactions } from "@/lib/satacoin/service";

import { nhanThoiDiem } from "../dinh-dang";
import type { MaHocVienDaKiem } from "../so-huu";

/**
 * NHÓM 5 (B4 → M2-SC) — `GET /students/:id/satacoin`: số dư, lịch sử, nguồn gốc coin và quy tắc cộng coin, CHỈ ĐỌC.
 *
 * ⛔ Chủ dự án ẨN SataCoin từ 04/11/2026 (`PORTAL_SATACOIN_ENABLED`, mặc định TẮT; web trả 404 ở `/portal/satacoin`) rồi ĐƯA TRỞ LẠI phạm vi mobile ngày 19/11/2026.
 * API di động TÔN TRỌNG cùng MỘT cờ với web: cờ TẮT ⇒ `null` ⇒ 404 (không có đường nào lộ số dư khi web đang ẩn). Bật cờ trên một môi trường = bật cả web lẫn mobile ở môi trường đó (không có cờ thứ hai).
 *
 * KHÔNG tạo / sửa / đổi quà / cộng điểm từ client — số dư là Σ amount của sổ cái BẤT BIẾN của web (`getBalance`); app không được suy ra số dư từ bất cứ nguồn nào khác, và không có trường nào client gửi lên.
 * Đổi quà (WP8, 19/11/2026): `doiQua.choPhep` = MÁY CHỦ quyết — `true` khi danh mục có ÍT NHẤT MỘT món quà đang mở (xem `dich-vu/doi-qua.ts` + `lib/satacoin/doi-qua.ts`); chưa có món nào ⇒ `false` ⇒ app KHÔNG vẽ lối đổi quà. Trung tâm (không phải ba mẹ) duyệt.
 *
 * DTO bỏ `note` (ghi chú nhân viên, văn bản tự do), `reversedTxId`, `createdById`, `centerId`.
 *  · `nhan` = nhãn hiển thị: tên quy tắc đang có (theo `ruleCode`) → «Đổi quà» (SPEND) → «Đảo giao dịch» (REVERSAL) → lý do nhân viên ghi (≤ 100 ký tự, web cổng PH cũng hiện). `lyDo` giữ nguyên mã gốc để tương thích.
 *  · `daDao` = giao dịch này đã bị một giao dịch đảo vô hiệu hoá — app gạch/làm mờ, KHÔNG tự cộng trừ lại.
 *  · `tongNhan` / `tongDaDung` tính trên TOÀN BỘ sổ cái (không phải 100 dòng đầu) và bỏ các giao dịch đã bị đảo; `quyTac` chỉ gồm quy tắc CỘNG đang bật (số dương) của cơ sở học viên hoặc dùng chung.
 */
export type GiaoDichCoinDto = { id: string; loai: "EARN" | "SPEND" | "ADJUST" | "REVERSAL"; soCoin: number; lyDo: string; nhan: string; daDao: boolean; nhanLuc: string };
export type NguonCoinDto = { ma: string; nhan: string; soLan: number; soCoin: number };
export type QuyTacCoinDto = { ma: string; nhan: string; soCoin: number };
export type SataCoinDto = {
  soDu: number;
  tongNhan: number;
  tongDaDung: number;
  giaoDich: GiaoDichCoinDto[];
  nguon: NguonCoinDto[];
  quyTac: QuyTacCoinDto[];
  /** Đổi quà chưa có backend ⇒ luôn false (app ẩn mọi lối đổi quà, không tự dựng từ dữ liệu mẫu). */
  doiQua: { choPhep: boolean };
};

/** Nhãn hiển thị của một giao dịch. Hàm thuần — có test. */
export function nhanGiaoDichCoin(g: { type: "EARN" | "SPEND" | "ADJUST" | "REVERSAL"; reason: string; ruleCode: string | null }, nhanQuyTac: ReadonlyMap<string, string>): string {
  if (g.type === "REVERSAL") return "Đảo giao dịch";
  const theoQuyTac = (g.ruleCode && nhanQuyTac.get(g.ruleCode)) || nhanQuyTac.get(g.reason);
  if (theoQuyTac) return theoQuyTac;
  if (g.type === "SPEND") return "Đổi quà";
  if (g.type === "ADJUST") return g.reason.trim() || "Điều chỉnh của trung tâm";
  return g.reason.trim() || "Thưởng";
}

/** `null` khi tính năng đang ẨN (cờ TẮT) — route trả 404 đồng nhất. */
export async function laySataCoin(hs: MaHocVienDaKiem, now: Date = new Date()): Promise<SataCoinDto | null> {
  if (!mucSataCoinDangHien()) return null;
  const [soDu, ds, tongHop, nguonTho, hocVien, daBiDao, soQuaDangMo] = await Promise.all([
    getBalance(hs),
    listTransactions(hs, 100),
    db.$queryRaw<{ nhan: number; dung: number }[]>(Prisma.sql`
      SELECT COALESCE(SUM(CASE WHEN t.amount > 0 AND t.type IN ('EARN','ADJUST') THEN t.amount END), 0)::int AS nhan,
             COALESCE(SUM(CASE WHEN t.amount < 0 AND t.type = 'SPEND' THEN -t.amount END), 0)::int AS dung
        FROM "SataCoinTransaction" t
        LEFT JOIN "SataCoinTransaction" r ON r."reversedTxId" = t.id
       WHERE t."studentId" = ${hs} AND t.type <> 'REVERSAL' AND r.id IS NULL`),
    db.$queryRaw<{ ma: string; so_lan: number; so_coin: number }[]>(Prisma.sql`
      SELECT COALESCE(t."ruleCode", t.reason) AS ma, COUNT(*)::int AS so_lan, SUM(t.amount)::int AS so_coin
        FROM "SataCoinTransaction" t
        LEFT JOIN "SataCoinTransaction" r ON r."reversedTxId" = t.id
       WHERE t."studentId" = ${hs} AND t.amount > 0 AND t.type IN ('EARN','ADJUST') AND r.id IS NULL
       GROUP BY 1 ORDER BY so_coin DESC, ma ASC LIMIT 12`),
    db.student.findUnique({ where: { id: hs }, select: { centerId: true } }),
    db.sataCoinTransaction.findMany({ where: { studentId: hs, reversedTxId: { not: null } }, select: { reversedTxId: true } }),
    db.sataCoinGift.count({ where: { isActive: true } }),
  ]);
  // Nhãn lấy từ MỌI quy tắc của cơ sở (kể cả đã tắt / quy tắc trừ) để giao dịch cũ vẫn có tên đẹp; `quyTac` trả về chỉ gồm quy tắc CỘNG đang bật.
  const moi = await db.sataCoinRule.findMany({
    where: { OR: [{ centerId: null }, ...(hocVien?.centerId ? [{ centerId: hocVien.centerId }] : [])] },
    orderBy: [{ amount: "desc" }, { code: "asc" }],
    select: { code: true, label: true, amount: true, isActive: true },
  });
  const quyTac = moi.filter((r) => r.isActive && r.amount > 0);
  const nhanQuyTac = new Map(moi.map((r) => [r.code, r.label] as const));
  const daDao = new Set(daBiDao.map((d) => d.reversedTxId));
  return {
    soDu,
    tongNhan: tongHop[0]?.nhan ?? 0,
    tongDaDung: tongHop[0]?.dung ?? 0,
    giaoDich: ds.map((g) => ({
      id: g.id,
      loai: g.type,
      soCoin: g.amount,
      lyDo: g.reason,
      nhan: nhanGiaoDichCoin(g, nhanQuyTac),
      daDao: daDao.has(g.id),
      nhanLuc: nhanThoiDiem(g.createdAt.toISOString(), now),
    })),
    nguon: nguonTho.map((n) => ({ ma: n.ma, nhan: nhanQuyTac.get(n.ma) ?? n.ma, soLan: n.so_lan, soCoin: n.so_coin })),
    quyTac: quyTac.map((r) => ({ ma: r.code, nhan: r.label, soCoin: r.amount })),
    doiQua: { choPhep: soQuaDangMo > 0 },
  };
}
