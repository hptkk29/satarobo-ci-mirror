// lib/hoc-bu/ra-soat-db.ts — chạy checker toàn vẹn Học bù (T01) TRONG ứng dụng, cho màn "Rà soát dữ liệu" (chỉ đọc).
//
// Cùng đường đọc với `scripts/kiem-hoc-bu.ts`: MỘT transaction `READ ONLY` + `REPEATABLE READ` (một ảnh chụp nhất quán), TỰ KIỂM hai cờ rồi mới đọc — không đúng thì ném, không đọc gì.
// KHÁC script ở một điểm: ứng dụng chạy bằng user ĐẦY QUYỀN, nên lớp bảo vệ ghi ở đây chỉ còn cờ `READ ONLY` của transaction (Postgres từ chối mọi phép ghi trong nó). Vì vậy:
//   · hàm này KHÔNG nhận callback / tham số có thể chen một phép ghi vào transaction;
//   · KHÔNG gọi `lapKeHoachSua`/`apDungSua` — sửa dữ liệu chỉ đi qua script có `--expect` do chủ dự án chạy;
//   · màn gọi hàm này CHỈ khi người dùng bấm "Chạy rà soát" (không chạy khi mở trang) — checker quét toàn bộ dòng cần bù + case, ở quy mô lớn phải đo lại trước khi cho chạy tự động.
import "server-only";
import { db } from "@/lib/db";
import { HOC_BU_TU_NGAY } from "@/lib/hoc-bu/danh-sach-db";
import { docSnapshot } from "@/lib/hoc-bu/toan-ven-db";
import { chayToanVen, type KetQua } from "@/lib/hoc-bu/toan-ven";
import { vnYmd } from "@/lib/time/vn";

export type KetQuaRaSoat = { ketQua: KetQua; luc: Date; tuNgayYmd: string };

export async function docRaSoat(now: Date = new Date()): Promise<KetQuaRaSoat> {
  const tuNgayYmd = vnYmd(HOC_BU_TU_NGAY);
  const snapshot = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [t] = await tx.$queryRaw<{ ro: string; iso: string }[]>`
        select current_setting('transaction_read_only') as ro, current_setting('transaction_isolation') as iso`;
      if (!t || t.ro !== "on") throw new Error(`transaction_read_only = ${t?.ro} — KHÔNG đọc. Rà soát chỉ chạy trong transaction chỉ-đọc.`);
      if (t.iso !== "repeatable read") throw new Error(`transaction_isolation = ${t.iso} — KHÔNG đọc. Cần repeatable read để các câu đọc thấy CÙNG một ảnh chụp.`);
      return docSnapshot(tx, { now, tuNgayYmd });
    },
    // Trần mặc định 5 giây của Prisma cắt giữa chừng (P2028) khi DB xa; checker đọc nhiều bảng.
    { timeout: 60_000, maxWait: 10_000, isolationLevel: "RepeatableRead" },
  );
  return { ketQua: chayToanVen(snapshot, { now, tuNgayYmd }), luc: now, tuNgayYmd };
}
