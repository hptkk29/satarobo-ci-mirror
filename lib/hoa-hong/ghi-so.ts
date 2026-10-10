// lib/hoa-hong/ghi-so.ts — ĐƯỜNG GHI DUY NHẤT vào sổ hoa hồng (`CommissionTransaction`) và ô tính (`CommissionCalcSlot`).
//
// Nguồn: docs/source-commission/04 §10.6 (`ghiSo`), 02 §9.6 (ô tính), CLAUDE.md "Luật rollback".
//
// MỌI đường ghi sổ — ORIGINAL, LATE_ARRIVAL, REVERSAL, correction — đi qua `chayTrongKhoa` và `ghiDong` ở đây. Lưới `[NHH-W5]`/`[NHH-GS-W*]`
// ghim: `commissionTransaction.create/createMany` chỉ xuất hiện trong tệp này. Ba trigger của DB là lưới dưới cùng, không thay cổng này.
//
// THỨ TỰ BẤT DI BẤT DỊCH trong một lượt ghi (cổng đứng TRƯỚC phép ghi đầu tiên; từ chối = `throw`, KHÔNG `return`):
//   1. khoá advisory theo từng khoản (sắp theo id ⇒ không khoá chéo)         — tuần tự hoá mọi lượt cùng khoản
//   2. khoá CHIA SẺ của mốc cutover, rồi đọc LẠI mốc thẳng từ DB, không cache — mốc vừa dời ⇒ `MOC_DA_DOI`; `datMocCutover` giữ khoá độc quyền
//   3. (trong `fn`) khoá ô `FOR UPDATE` + nạp lại Σ ròng SAU khoá             — L11: số tính ngoài transaction chỉ là bản nháp
//   4. (trong `fn`) `khoaKyDeGhi`: khoá kỳ `FOR UPDATE`, kiểm trạng thái + mốc — kỳ không còn OPEN/CALCULATED ⇒ `KY_DA_DONG`
//   5. `ghiDong`: chỉ ghi vào kỳ ĐÃ qua bước 4 — gọi mà chưa khoá kỳ ⇒ `KY_CHUA_KHOA` (lỗi lập trình, không phải lỗi dữ liệu)
import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { docMocCutover, khoaChungMocCutover } from "./cutover";
import { HoaHongError } from "./kieu";
import { laKyNhanDong } from "./ky-hoa-hong";
import { khoaKy } from "./ky-db";

type Tx = Prisma.TransactionClient;

export type DongGhi = Prisma.CommissionTransactionUncheckedCreateInput;
export type SlotGhi = {
  paymentId: string;
  orderItemKey: string;
  revenueComponent: "TUITION" | "MATERIAL" | "EQUIPMENT" | "OTHER";
  netBase: number;
  firstInputHash: string;
  originalLineCount: number;
  centerId: string;
  orgUnitId: string;
};

export type DongTrung = { idempotencyKey: string; hashCu: string; hashMoi: string };

export type CongGhi = {
  tx: Tx;
  /** Mốc cutover đọc LẠI trong transaction. */
  kyCutover: string;
  /** Khoá hàng kỳ `FOR UPDATE`, kiểm `OPEN/CALCULATED` và `≥ mốc`. Ném `KY_DA_DONG` / `KY_TRUOC_MOC`. */
  khoaKyDeGhi: (ids: readonly string[]) => Promise<void>;
  /** Khoá hàng ô `FOR UPDATE` (thứ tự id cố định). */
  khoaO: (ids: readonly string[]) => Promise<void>;
  /**
   * Tạo ô mới: `INSERT … ON CONFLICT DO NOTHING RETURNING id`. Trả `null` khi lượt khác vừa tạo (0 dòng) — ghi có điều kiện đổi 0
   * dòng, ngoại lệ hợp lệ của luật rollback; người gọi KHÔNG ghi gì thêm và để lượt sau đi nhánh "đã có ô".
   */
  taoO: (slots: readonly SlotGhi[]) => Promise<Map<string, string> | null>;
  /** Ghi dòng sổ. Dòng có `idempotencyKey` đã tồn tại KHÔNG ghi lại — trả về để người gọi so `inputHash`. */
  ghiDong: (rows: readonly DongGhi[]) => Promise<{ daGhi: number; trung: DongTrung[] }>;
};

const khoaKhoanSql = (tx: Tx, paymentId: string) =>
  // ⚠️ `$executeRaw`, KHÔNG `$queryRaw`: `pg_advisory_xact_lock()` trả `void`, Prisma không đọc được kiểu đó (cùng lý do `ghi-tien-don.ts`).
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"hoa-hong:khoan:" + paymentId})::bigint)`;

export async function chayTrongKhoa<T>(
  client: PrismaClient,
  opts: { khoaKhoan: readonly string[]; kyCutoverDaDoc: string },
  fn: (h: CongGhi) => Promise<T>,
): Promise<T> {
  const khoaDuy = [...new Set(opts.khoaKhoan)].sort();
  return client.$transaction(
    async (tx) => {
      for (const id of khoaDuy) await khoaKhoanSql(tx, id);
      // Khoá CHIA SẺ của mốc cutover (cặp với khoá độc quyền của `datMocCutover`): lượt dời/gỡ mốc phải chờ ta xong, và không lọt vào giữa
      // "đã đọc mốc" với "đã ghi dòng". Đứng TRƯỚC `docMocCutover`.
      await khoaChungMocCutover(tx);

      const kyCutover = await docMocCutover(tx);
      if (kyCutover === null || kyCutover !== opts.kyCutoverDaDoc) {
        throw new HoaHongError("MOC_DA_DOI", `Mốc cutover đã đổi giữa lúc nạp (${opts.kyCutoverDaDoc}) và lúc ghi (${kyCutover ?? "null"}) — dừng.`);
      }

      const kyDaKiem = new Set<string>();

      const h: CongGhi = {
        tx,
        kyCutover,
        khoaKyDeGhi: async (ids) => {
          const trangThai = await khoaKy(tx, ids);
          for (const id of new Set(ids)) {
            const k = trangThai.get(id);
            if (!k) throw new HoaHongError("KY_KHONG_TON_TAI", `Kỳ ${id} không tồn tại.`);
            if (k.period < kyCutover) throw new HoaHongError("KY_TRUOC_MOC", `Kỳ ${k.period} < mốc cutover ${kyCutover}: engine mới không ghi kỳ cũ.`);
            if (!laKyNhanDong(k.status)) throw new HoaHongError("KY_DA_DONG", `Kỳ ${k.period} đang ${k.status} — không ghi thêm dòng sổ.`);
            kyDaKiem.add(id);
          }
        },
        khoaO: async (ids) => {
          if (ids.length === 0) return;
          const duy = [...new Set(ids)].sort();
          await tx.$queryRaw`SELECT "id" FROM "CommissionCalcSlot" WHERE "id" IN (${Prisma.join(duy)}) ORDER BY "id" FOR UPDATE`;
        },
        taoO: async (slots) => {
          const ids = new Map<string, string>();
          for (const s of slots) {
            const id = randomUUID();
            const r = await tx.$queryRaw<{ id: string }[]>`
              INSERT INTO "CommissionCalcSlot"
                ("id","paymentId","orderItemKey","revenueComponent","netBase","firstInputHash","lastMatchedHash","lastCheckedAt",
                 "originalLineCount","centerId","orgUnitId","createdAt","updatedAt")
              VALUES (${id}, ${s.paymentId}, ${s.orderItemKey}, ${s.revenueComponent}::"RevenueComponent", ${s.netBase},
                      ${s.firstInputHash}, ${s.firstInputHash}, now(), ${s.originalLineCount}, ${s.centerId}, ${s.orgUnitId}, now(), now())
              ON CONFLICT ("paymentId","orderItemKey","revenueComponent") DO NOTHING
              RETURNING "id"`;
            if (r.length === 0) {
              // Lượt khác vừa tạo ô này. Ô thứ hai của cùng lượt mà thiếu thì cách tách đã đổi giữa hai lượt ⇒ ném (02 §9.6 luật 1).
              if (ids.size > 0) throw new HoaHongError("O_TACH_DOI", `Ô ${s.paymentId}/${s.orderItemKey} đã có nhưng các ô trước của lượt này vừa tạo mới.`);
              return null;
            }
            ids.set(`${s.paymentId}|${s.orderItemKey}|${s.revenueComponent}`, r[0]!.id);
          }
          return ids;
        },
        ghiDong: async (rows) => {
          if (rows.length === 0) return { daGhi: 0, trung: [] };
          for (const r of rows) {
            if (!kyDaKiem.has(r.periodId)) {
              throw new HoaHongError("KY_CHUA_KHOA", `Ghi dòng vào kỳ ${r.periodId} khi chưa khoá/kiểm kỳ đó trong lượt này (lỗi lập trình).`);
            }
          }
          const khoa = rows.map((r) => r.idempotencyKey);
          const daCo = await tx.commissionTransaction.findMany({ where: { idempotencyKey: { in: khoa } }, select: { idempotencyKey: true, inputHash: true } });
          const daCoTheoKhoa = new Map(daCo.map((x) => [x.idempotencyKey, x.inputHash]));
          const moi = rows.filter((r) => !daCoTheoKhoa.has(r.idempotencyKey));
          // Không `skipDuplicates`: một đụng độ KHÔNG lường trước (lượt khác lọt qua khoá advisory) phải làm rollback, không được nuốt.
          if (moi.length > 0) await tx.commissionTransaction.createMany({ data: moi });
          const trung = rows
            .filter((r) => daCoTheoKhoa.has(r.idempotencyKey))
            .map((r) => ({ idempotencyKey: r.idempotencyKey, hashCu: daCoTheoKhoa.get(r.idempotencyKey)!, hashMoi: r.inputHash }));
          return { daGhi: moi.length, trung };
        },
      };
      return fn(h);
    },
    { maxWait: 20_000, timeout: 60_000 },
  );
}
