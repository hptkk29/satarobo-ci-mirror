import { db } from "@/lib/db";
import { publishEvent } from "@/lib/events/publish";

/**
 * EL-18 — QUÉT ĐÊM cho kích hoạt `NHAN_SU_MOI`.
 *
 * ⚠️ Vì sao phải quét thay vì nghe sự kiện: việc tạo hồ sơ nhân sự nằm ở module Nhân
 * sự, và nó KHÔNG phát DomainEvent nào. Ba lựa chọn — sửa module Nhân sự để phát sự
 * kiện, gọi chéo module, hoặc quét đêm. Quét đêm là lựa chọn ít xâm lấn nhất và cũng
 * đúng bản chất: "nhân sự mới" là một trạng thái kéo dài N ngày, không phải một
 * khoảnh khắc.
 *
 * ⚠️ Chạy trong khe cron ĐÃ CÓ (`elearning-dem`). Ngân sách module là đúng 2 khe và
 * đã dùng hết — không xin khe thứ ba (QĐ-CDA-14 điểm 2).
 *
 * ⚠️ Cron này KHÔNG giao bài. Nó chỉ PHÁT sự kiện; cỗ máy luật mới là nơi quyết định
 * giao gì, và nơi ghi nhật ký thi hành. Để cron tự giao là chép cỗ máy ấy ra chỗ thứ
 * hai, rồi hai bản trôi khỏi nhau.
 */

const LO = 300;

export type KetQuaNhanSuMoi = {
  /** Số hồ sơ lọt ngưỡng "mới". */
  daXet: number;
  /** Số sự kiện đã phát (trùng bị `dedupeKey` chặn nên không phát lại). */
  daPhat: number;
  /**
   * Nhân sự KHÔNG có ngày vào làm — không xét được, và phải nói ra.
   *
   * Im lặng bỏ họ là để một người mới không bao giờ được giao khoá nhập môn, và không
   * ai biết vì sao.
   */
  thieuNgayVaoLam: number;
  loi: string[];
};

export async function quetNhanSuMoi(
  now = new Date(),
  soNgayToiDa = 90,
): Promise<KetQuaNhanSuMoi> {
  const ket: KetQuaNhanSuMoi = {
    daXet: 0,
    daPhat: 0,
    thieuNgayVaoLam: 0,
    loi: [],
  };

  try {
    // Chỉ quét khi CÓ luật nào đang bật — không có thì đừng đổ sự kiện vào hàng đợi.
    const coLuat = await db.trnAutomationRule.count({
      where: { trigger: "NHAN_SU_MOI", enabled: true, deletedAt: null },
    });
    if (coLuat === 0) return ket;

    const moc = new Date(now.getTime() - soNgayToiDa * 86_400_000);

    ket.thieuNgayVaoLam = await db.employee.count({
      where: { isActive: true, status: "ACTIVE", joinedAt: null },
    });

    const ds = await db.employee.findMany({
      where: {
        isActive: true,
        status: "ACTIVE",
        joinedAt: { gte: moc, lte: now },
        userAccount: { is: {} },
      },
      select: {
        joinedAt: true,
        departmentId: true,
        userAccount: { select: { id: true } },
      },
      take: LO,
    });

    for (const n of ds) {
      const userId = n.userAccount?.id;
      if (!userId) continue;
      ket.daXet += 1;
      // ⚠️ Khoá chống trùng gắn với NGÀY VÀO LÀM, không với hôm nay. Gắn hôm nay là
      // mỗi đêm phát lại một sự kiện cho cùng một người suốt 90 ngày.
      await publishEvent(
        "elearning.employee.new",
        { userId, departmentId: n.departmentId },
        { dedupeKey: `el.emp.new:${userId}:${n.joinedAt?.toISOString() ?? "?"}` },
      );
      ket.daPhat += 1;
    }
  } catch (e) {
    ket.loi.push(`quet-nhan-su-moi: ${String(e)}`);
  }

  return ket;
}
