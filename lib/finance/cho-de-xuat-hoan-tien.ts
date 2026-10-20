// lib/finance/cho-de-xuat-hoan-tien.ts — ai đã nghỉ học, đã đóng tiền, mà hệ thống CHƯA
// từng đề xuất hoàn tiền.
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TỒN TẠI — một lỗ thật, đo được, không ai thấy
//
// `createRefundRequest` chạy TRONG transaction gỡ học viên và trả `null` khi không đề
// xuất được. Caller (`withdrawStudentFromAllClasses`) bỏ kết quả đó đi. Người vận hành
// bấm "Nghỉ học hẳn", việc gỡ xong, và **không có tín hiệu nào** nói rằng phần tiền đã bị
// bỏ qua. Đúng lớp lỗi mà luật 12 gọi tên: affordance nói dối, không ném lỗi, không làm
// test đỏ, console sạch — chỉ người dùng đi tìm tiền mới biết.
//
// Có BỐN đường dẫn tới `null`, và chúng KHÔNG cùng nghĩa:
//   1. ghi danh không tồn tại        → không phải việc của ai
//   2. chưa thu đồng nào             → đúng, không có gì để hoàn
//   3. đã có đề xuất PENDING         → đúng, nằm ở bảng chính
//   4. sổ buổi của lớp chưa chốt     → **CÒN VIỆC PHẢI LÀM**, và không ai được báo
// Cộng thêm một đường lịch sử: cầu dao `REFUND_REQUEST_DISABLED` (08/09 → 14/09) trả
// `null` cho MỌI ca.
//
// Đo `satarobo_local` ngày 14/09/2026:
//
//   WITHDREW · đã thu > 0 · chưa có RefundRequest nào  →  18 ghi danh / 69.698.000đ
//     · TIN_DUOC (đề xuất được ngay)            12 / 45.018.000đ
//     · THIEU_MOT_SO_BUOI (được, kèm cảnh báo)   6 / 24.680.000đ
//     · KHONG_TIN_DUOC (bị chặn)                 0
//
// 18 dòng đó sẽ KHÔNG BAO GIỜ tự sinh đề xuất: lượt gỡ đã chạy xong rồi, không có cron
// nào quét lại. Màn này là đường DUY NHẤT lấy chúng về.
//
// ─────────────────────────────────────────────────────────────────────────────
// ĐỌC TỪ TRẠNG THÁI NGHIỆP VỤ, KHÔNG ĐỌC TỪ NHẬT KÝ
//
// Cám dỗ là quét `AuditLog action = REFUND_REQUEST_BLOCKED`. Không làm vậy: nhật ký chỉ
// có dòng cho những lượt CHẠY QUA cổng đó, nên nó bỏ sót mọi ca xảy ra trước khi cổng ra
// đời, và nó không tự cũ đi khi lớp đã chốt sổ. Trạng thái nghiệp vụ (`WITHDREW` + đã thu
// + chưa có đề xuất) luôn đúng ở hiện tại và không cần ai nhớ ghi gì.
import "server-only";

import { db } from "@/lib/db";
import type { ScopedDb } from "@/lib/actions/factory";
import { KHOAN_DA_XAC_NHAN } from "@/lib/finance/debt";
import { computeRefund } from "@/lib/finance/refund";
import {
  canhBaoSoBuoi,
  soBuoiChuaChot,
  type BuoiToiThieu,
  type MucTinSoBuoi,
} from "@/lib/finance/lop-chua-chot-buoi";

export type DongChoDeXuat = {
  enrollmentId: string;
  classId: string;
  studentName: string;
  className: string;
  /** Σ Payment `accountantStatus = CONFIRMED` — trục A, đúng thứ phụ huynh thấy. */
  daThu: number;
  soBuoiChuaChot: number;
  sessionsLearned: number;
  sessionsTotal: number;
  muc: MucTinSoBuoi;
  choDeXuat: boolean;
  lyDo: string;
  /**
   * Số đề xuất NẾU bấm tạo bây giờ. CHỈ để xem — số thật được `createRefundRequest` tính
   * lại lúc ghi, vì sổ buổi có thể đổi giữa lúc mở màn và lúc bấm.
   */
  deXuatDuKien: number;
};

export type ChoDeXuatHoanTien = {
  dong: DongChoDeXuat[];
  /** Tổng số VIỆC CÒN LÀM — có thể LỚN HƠN `dong.length` nếu đã cắt trần. */
  tongSo: number;
  /** Số dòng bị cắt vì trần. Hiện lên màn, không cắt im lặng. */
  daCat: number;
  /**
   * Số ghi danh đã soi qua nhưng KHÔNG có gì phải hoàn (học hết khoá, hoặc chỉ còn dư
   * làm tròn). Không phải việc — nhưng vẫn đếm và nói ra, kẻo màn trông như bỏ sót.
   */
  khongPhaiHoan: number;
};

/**
 * Dựng MỘT dòng — THUẦN, không Prisma, không đọc đồng hồ (mốc là tham số).
 *
 * ⚠️ Phép đếm buổi ở đây phải TRÙNG `createRefundRequest`: `sessionsTotal` loại `CANCELLED`,
 * `sessionsLearned` đếm `COMPLETED`. Lệch một chữ là màn hứa một số, đường ghi tính một số
 * khác — và không ai thấy cho tới khi kế toán đối chiếu. Có lưới ghim mã nguồn canh việc
 * này ở `cho-de-xuat-hoan-tien.test.ts`.
 */
export function dungDongChoDeXuat(input: {
  ghiDanh: {
    id: string;
    classId: string;
    finalPrice: number | null;
    tuition: number | null;
    studentName: string | null;
    className: string | null;
  };
  buoi: BuoiToiThieu[];
  daThu: number;
  moc: Date;
}): DongChoDeXuat {
  const { ghiDanh, buoi, daThu, moc } = input;
  const sessionsTotal = buoi.filter((b) => b.status !== "CANCELLED").length;
  const sessionsLearned = buoi.filter((b) => b.status === "COMPLETED").length;
  const chuaChot = soBuoiChuaChot(buoi, moc);
  const canhBao = canhBaoSoBuoi({
    soBuoiChuaChot: chuaChot,
    sessionsLearned,
    sessionsTotal,
  });
  const { proposedAmount } = computeRefund({
    paidConfirmed: daThu,
    finalPrice: ghiDanh.finalPrice ?? ghiDanh.tuition ?? 0,
    sessionsTotal,
    sessionsLearned,
  });
  return {
    enrollmentId: ghiDanh.id,
    classId: ghiDanh.classId,
    studentName: ghiDanh.studentName ?? "(không rõ)",
    className: ghiDanh.className ?? "(không rõ)",
    daThu,
    soBuoiChuaChot: chuaChot,
    sessionsLearned,
    sessionsTotal,
    muc: canhBao.muc,
    choDeXuat: canhBao.choDeXuat,
    lyDo: canhBao.lyDo,
    deXuatDuKien: proposedAmount,
  };
}

/**
 * Dòng này có phải VIỆC CÒN LÀM không.
 *
 * VÌ SAO PHẢI LỌC. Đo `satarobo_local` 14/09: 18 ghi danh WITHDREW còn treo tiền, nhưng
 * **12 trong số đó đề xuất ra 0đ** — các em học HẾT khoá (12/12 buổi) rồi mới đóng ghi
 * danh. Không có gì để hoàn, và sẽ không bao giờ có. Đưa chúng lên danh sách việc kèm nút
 * "Tạo đề xuất" là mời người ta ghi 12 dòng `RefundRequest` 0đ vào sổ tiền — báo động giả,
 * đúng mặt trái của chính con bug đang vá (im lặng ở một đầu, ồn ào vô nghĩa ở đầu kia).
 *
 * NGƯỠNG LÀ SỐ SUY RA, KHÔNG PHẢI SỐ CHỌN BỪA. `unitPrice = round(finalPrice/sessionsTotal)`
 * nên mỗi buổi lệch tối đa 0,5đ so với phép chia đúng ⇒ dư làm tròn của cả đề xuất không
 * quá `sessionsTotal / 2` đồng. Lấy `> sessionsTotal` là chặn trên an toàn của dư đó —
 * quan sát thật: một ca ra đúng **4đ** (5.200.000 − 12 × 433.333). 4đ không phải tiền hoàn,
 * đó là bụi của phép chia.
 *
 * Ca BỊ CHẶN thì luôn giữ, bất kể số: chính vì con số đó chưa tin được nên mới phải chặn.
 */
export function laViecConLam(d: DongChoDeXuat): boolean {
  if (!d.choDeXuat) return true;
  return d.deXuatDuKien > d.sessionsTotal;
}

/**
 * Bị chặn LÊN TRƯỚC — đó là việc cần người đi chốt sổ; phần còn lại chỉ cần bấm một nút.
 * Trong mỗi nhóm, tiền lớn trước. THUẦN, không sửa mảng gốc.
 */
export function sapXepChoDeXuat(dong: DongChoDeXuat[]): DongChoDeXuat[] {
  return [...dong].sort((a, b) => {
    if (a.choDeXuat !== b.choDeXuat) return a.choDeXuat ? 1 : -1;
    return b.daThu - a.daThu;
  });
}

/** Trần mặc định — đủ rộng cho hình dạng thật (đo 18 dòng), đủ hẹp để màn không sập. */
export const TRAN_MAC_DINH = 200;

/**
 * Quét ghi danh ĐÃ NGHỈ HỌC còn treo tiền chưa được đề xuất hoàn.
 *
 * Cách ly cơ sở: đi qua `scopedDbClient.class` (Class là SCOPED_MODEL) rồi lọc theo danh
 * sách lớp đó — cùng lối `listRefundRequests` đang dùng, đừng chế lối thứ hai.
 *
 * Ba truy vấn, KHÔNG N+1: ghi danh → Σ tiền theo ghi danh → buổi theo lớp.
 */
export async function layChoDeXuatHoanTien(
  scopedDbClient: ScopedDb,
  opts: { now?: Date; tran?: number } = {},
): Promise<ChoDeXuatHoanTien> {
  const tran = opts.tran ?? TRAN_MAC_DINH;
  const moc = opts.now ?? new Date();

  const scopedClasses = await scopedDbClient.class.findMany({
    select: { id: true },
  });
  const classIds = scopedClasses.map((c) => c.id);
  if (classIds.length === 0) return { dong: [], tongSo: 0, daCat: 0, khongPhaiHoan: 0 };

  const ghiDanh = await db.enrollment.findMany({
    where: {
      deletedAt: null,
      status: "WITHDREW",
      classId: { in: classIds },
      // Đã có đề xuất (bất kể trạng thái) thì không còn là việc phải làm ở đây.
      refundRequests: { none: {} },
    },
    select: {
      id: true,
      classId: true,
      finalPrice: true,
      tuition: true,
      student: { select: { name: true } },
      class: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  if (ghiDanh.length === 0) return { dong: [], tongSo: 0, daCat: 0, khongPhaiHoan: 0 };

  const tienTheoGhiDanh = await db.payment.groupBy({
    by: ["enrollmentId"],
    where: {
      enrollmentId: { in: ghiDanh.map((e) => e.id) },
      ...KHOAN_DA_XAC_NHAN,
    },
    _sum: { amount: true },
  });
  const daThuMap = new Map(
    tienTheoGhiDanh.map((r) => [r.enrollmentId, r._sum.amount ?? 0]),
  );

  // Chỉ giữ ca CÓ TIỀN — không tiền thì không có gì để hoàn, và đó là `null` đúng nghĩa.
  const coTien = ghiDanh.filter((e) => (daThuMap.get(e.id) ?? 0) > 0);
  if (coTien.length === 0) return { dong: [], tongSo: 0, daCat: 0, khongPhaiHoan: 0 };

  const lopCanDo = [...new Set(coTien.map((e) => e.classId))].filter(
    (id): id is string => Boolean(id),
  );
  const buoi = await db.classSession.findMany({
    where: { classId: { in: lopCanDo } },
    select: { classId: true, date: true, status: true },
  });
  const buoiTheoLop = new Map<string, { date: Date; status: string }[]>();
  for (const b of buoi) {
    const cu = buoiTheoLop.get(b.classId);
    if (cu) cu.push(b);
    else buoiTheoLop.set(b.classId, [b]);
  }

  const tatCa = sapXepChoDeXuat(
    coTien.map((e) =>
      dungDongChoDeXuat({
        ghiDanh: {
          id: e.id,
          classId: e.classId ?? "",
          finalPrice: e.finalPrice,
          tuition: e.tuition,
          studentName: e.student?.name ?? null,
          className: e.class?.name ?? null,
        },
        buoi: buoiTheoLop.get(e.classId ?? "") ?? [],
        daThu: daThuMap.get(e.id) ?? 0,
        moc,
      }),
    ),
  );

  const dong = tatCa.filter(laViecConLam);
  return {
    dong: dong.slice(0, tran),
    tongSo: dong.length,
    daCat: Math.max(0, dong.length - tran),
    khongPhaiHoan: tatCa.length - dong.length,
  };
}
