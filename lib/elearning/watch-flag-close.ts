import "server-only";

import { db } from "@/lib/db";
import { chuyenTrangThaiCo } from "@/lib/elearning/watch-flag-rules";

/**
 * EL-13 — CHỐT CỜ HẾT CỬA SỔ KHIẾU NẠI (việc 7 của cron đêm).
 *
 * Cờ còn `OPEN` sau `appealDeadline` thì chốt thành `UPHELD`.
 *
 * ⚠️ Vì sao phải có việc này chứ không để cờ treo: cờ treo mãi là cách tệ nhất
 * cho CẢ HAI phía. Người bị gắn không biết mình còn bao lâu để nói lại, còn phía
 * quản lý thì có một danh sách cờ mà không ai biết cái nào còn sống. Chốt tự động
 * làm cửa sổ 14 ngày thành một con số có thật, chứ không phải một câu trong tài
 * liệu.
 *
 * ⚠️ CHỈ chốt cờ CHƯA khiếu nại. Người đã khiếu nại thì đang chờ NGƯỜI XỬ trả lời
 * — chốt tự động ở đó là phạt họ vì sự chậm trễ của phía bên kia. Điều kiện đó
 * nằm trong `chuyenTrangThaiCo`, và ở đây `where` cũng lọc `status: "OPEN"`; hai
 * lớp cố ý, vì đây là đường GHI TỰ ĐỘNG lên hồ sơ quan hệ lao động.
 */

/** Không chốt quá ngần này cờ trong một lượt cron — giữ lượt chạy có trần. */
const LO = 200;

export type KetQuaChotCo = { daChot: number; boQua: number };

export async function chotCoHetHan(now: Date): Promise<KetQuaChotCo> {
  const dsCo = await db.trnWatchFlag.findMany({
    where: { status: "OPEN", appealDeadline: { lt: now } },
    select: { id: true, status: true },
    take: LO,
    orderBy: { appealDeadline: "asc" },
  });

  let daChot = 0;
  let boQua = 0;
  for (const co of dsCo) {
    const r = chuyenTrangThaiCo({ hienTai: co.status, hanhDong: "CHOT_HET_HAN" });
    if (!r.ok) {
      boQua += 1;
      continue;
    }
    await db.trnWatchFlag.update({
      where: { id: co.id },
      data: {
        status: r.status,
        decidedAt: now,
        // KHÔNG có `decidedByUserId`: không người nào quyết cái này. Gán bừa tên
        // người xử vào đây là ghi một quyết định mà họ chưa từng đưa ra — và đó
        // là thứ sẽ được đọc to lên nếu có tranh chấp.
        decisionNote:
          "Chốt tự động: hết cửa sổ khiếu nại 14 ngày mà không có khiếu nại nào.",
      },
    });
    daChot += 1;
  }

  return { daChot, boQua };
}
