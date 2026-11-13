import "server-only";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import type { Actor } from "@/lib/auth/actor";
import { khoaDonTrongTx } from "@/lib/finance/ghi-tien-don";
import { napGanGhiDanhCuaDon, thucHienKeHoachGan } from "@/lib/finance/payment";
import { dauKeHoachGan, lapKeHoachGanGhiDanh, type DongKeHoachGan } from "@/lib/finance/ke-hoach-gan-ghi-danh";
import { coQuyenKeToanVoiGhiDanh } from "./quyen";
import { CAU_CHAN_GAN_GHI_DANH, cauBoQuaGan } from "./ly-do-gan-ghi-danh";

// lib/finance/hoa-don/gan-ghi-danh.ts — "Gắn ghi danh" từ màn Hoá đơn điện tử (GĐ 8b, PLAN Q-mở 8).
//
// Hai bước, cùng MỘT kế hoạch:
//   · XEM TRƯỚC (chỉ đọc): dựng kế hoạch bằng planner thuần, in từng khoản sẽ gắn vào bé nào / chia ra
//     sao / vì sao chưa gắn được, kèm DẤU của kế hoạch;
//   · GẮN: trong MỘT transaction, khoá đơn → dựng lại kế hoạch → so dấu với dấu kế toán đã xem ⇒ lệch
//     là có gì đổi giữa lúc xem và lúc bấm ⇒ KHÔNG chạy gì. Kế toán thấy đúng thứ sẽ ghi, hoặc không ghi.
// Phạm vi: đích phải nằm trong phạm vi kế toán của người bấm (`coQuyenKeToanVoiGhiDanh`) — tra SĐT phụ
// huynh không theo cơ sở nên ứng viên có thể ở cơ sở khác.
// Không cần khoá chống bấm đôi riêng: chỉ khoản `enrollmentId` trống mới vào kế hoạch + khoá đơn + dấu
// ⇒ lượt bấm thứ hai thấy kế hoạch khác (dấu lệch) hoặc không còn gì.
// Từ chối trong transaction = `throw` (luật rollback), mọi cổng đứng trước phép ghi dữ liệu đầu tiên.

export type MaLoiGanGhiDanh = "CO_KHOAN_DA_XAC_NHAN" | "KE_HOACH_DA_DOI" | "KHONG_GAN_DUOC";

const THONG_DIEP: Record<MaLoiGanGhiDanh, string> = {
  CO_KHOAN_DA_XAC_NHAN: CAU_CHAN_GAN_GHI_DANH,
  KE_HOACH_DA_DOI: "Khoản hoặc ghi danh của đơn vừa thay đổi — bấm Kiểm gắn ghi danh lại để xem kế hoạch mới",
  KHONG_GAN_DUOC: "Không còn khoản nào gắn được — bấm Kiểm gắn ghi danh lại để xem lý do",
};

export class LoiGanGhiDanh extends Error {
  constructor(readonly ma: MaLoiGanGhiDanh) {
    super(THONG_DIEP[ma]);
    this.name = "LoiGanGhiDanh";
  }
}

export function thongDiepLoiGanGhiDanh(e: unknown): string | null {
  return e instanceof LoiGanGhiDanh ? e.message : null;
}

export async function ganGhiDanhTuManHoaDon(input: {
  actor: Actor;
  nguoiGhi: { id: string; name: string };
  orderId: string;
  lanThuKey: string;
  /** Dấu của kế hoạch người bấm ĐÃ XEM (`napXemTruocGanGhiDanh().dau`). */
  dauKeHoach: string;
}): Promise<{ gan: number; tach: number; boQua: number }> {
  return db.$transaction(async (tx) => {
    // Cùng khoá với chốt hoá đơn / ghi tiền / gỡ / tách / webhook trên CÙNG đơn.
    await khoaDonTrongTx(tx, input.orderId);
    const duLieu = await napGanGhiDanhCuaDon(tx, input.orderId);
    if (!duLieu) throw new LoiGanGhiDanh("KE_HOACH_DA_DOI");
    const keHoach = lapKeHoachGanGhiDanh({ ...duLieu, trongTam: (c) => coQuyenKeToanVoiGhiDanh(input.actor, c) });
    if (keHoach.chan) throw new LoiGanGhiDanh("CO_KHOAN_DA_XAC_NHAN");
    if (dauKeHoachGan(keHoach) !== input.dauKeHoach) throw new LoiGanGhiDanh("KE_HOACH_DA_DOI");
    const ghi = keHoach.dong.filter((d): d is Extract<DongKeHoachGan, { ketQua: "GAN" | "TACH" }> => d.ketQua !== "BO_QUA");
    if (ghi.length === 0) throw new LoiGanGhiDanh("KHONG_GAN_DUOC");

    const kq = await thucHienKeHoachGan(tx, duLieu, keHoach, input.nguoiGhi, "man-hoa-don");
    // Dấu vừa khớp dưới khoá đơn mà vẫn có khoản đổi 0 dòng ⇒ có đường ghi không đi qua khoá đơn ⇒
    // hoàn TOÀN BỘ lượt này (throw ⇒ rollback cả các khoản đã ghi phía trên).
    if (kq.doi.length > 0) throw new LoiGanGhiDanh("KE_HOACH_DA_DOI");

    const boQua = keHoach.dong.filter((d) => d.ketQua === "BO_QUA");
    await writeAudit({
      tx,
      actor: input.nguoiGhi,
      module: "finance",
      entityType: "Order",
      entityId: input.orderId,
      action: "GAN_GHI_DANH_KHOAN",
      newValues: {
        nguon: "man-hoa-don",
        lanThuKey: input.lanThuKey,
        dauKeHoach: input.dauKeHoach,
        gan: ghi.filter((d) => d.ketQua === "GAN").map((d) => ({ paymentId: d.paymentId, enrollmentId: d.phan[0]!.enrollmentId })),
        tach: ghi.filter((d) => d.ketQua === "TACH").map((d) => ({ paymentId: d.paymentId, phan: d.phan })),
        boQua: boQua.map((d) => ({ paymentId: d.paymentId, ma: d.ketQua === "BO_QUA" ? d.ma : null })),
      },
      orgUnitId: duLieu.orderCenterId,
    });
    return {
      gan: ghi.filter((d) => d.ketQua === "GAN").length,
      tach: ghi.filter((d) => d.ketQua === "TACH").length,
      boQua: boQua.length,
    };
  });
}

export type DongXemTruocGan = {
  paymentId: string;
  soTienLabel: string;
  ngayLabel: string;
  /** Khoản thuộc CHÍNH lần thu đang mở — kế hoạch phủ cả đơn, khoản khác được ghi chú. */
  trongLanThu: boolean;
  ketQua: "GAN" | "TACH" | "BO_QUA";
  dich: { ten: string; khoa: string; lop: string | null; soTienLabel: string }[];
  lyDo: string | null;
};

export type XemTruocGanGhiDanh = {
  key: string;
  dau: string;
  chan: string | null;
  soGan: number;
  soTach: number;
  dong: DongXemTruocGan[];
};

const tien = (n: number) => `${n.toLocaleString("vi-VN")}đ`;
/** Ngày theo lịch VN (UTC+7) — tính ở server. */
const ngayVn = (d: Date) => {
  const v = new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  return `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}`;
};

/** XEM TRƯỚC — chỉ đọc. `null` ⇒ không có đơn. */
export async function napXemTruocGanGhiDanh(input: {
  actor: Actor;
  orderId: string;
  lanThuKey: string;
  khoanTrongLanThu: readonly string[];
}): Promise<XemTruocGanGhiDanh | null> {
  const duLieu = await db.$transaction((tx) => napGanGhiDanhCuaDon(tx, input.orderId));
  if (!duLieu) return null;
  const keHoach = lapKeHoachGanGhiDanh({ ...duLieu, trongTam: (c) => coQuyenKeToanVoiGhiDanh(input.actor, c) });

  // Tên bé / khoá / lớp cho đích ĐƯỢC PHÉP thấy — dòng NGOAI_TAM không lấy tên (ngoài phạm vi).
  const idCanTen = new Set<string>();
  for (const d of keHoach.dong) {
    if (d.ketQua !== "BO_QUA") d.phan.forEach((p) => idCanTen.add(p.enrollmentId));
    else if (d.ma === "MO_HO" || d.ma === "PHAI_TACH_DA_KHOA") d.phanThu.forEach((p) => idCanTen.add(p.enrollmentId));
  }
  const ten =
    idCanTen.size === 0
      ? []
      : await db.enrollment.findMany({
          where: { id: { in: [...idCanTen] } },
          select: { id: true, studentId: true, student: { select: { name: true } }, course: { select: { name: true } }, class: { select: { name: true } } },
        });
  const theoId = new Map(ten.map((e) => [e.id, e]));
  const khoanTheoId = new Map(duLieu.khoan.map((k) => [k.id, k]));
  const trongLanThu = new Set(input.khoanTrongLanThu);

  const dong: DongXemTruocGan[] = keHoach.dong.map((d) => {
    const k = khoanTheoId.get(d.paymentId);
    const chung = {
      paymentId: d.paymentId,
      soTienLabel: tien(d.soTien),
      ngayLabel: k ? ngayVn(k.paidDate) : "",
      trongLanThu: trongLanThu.has(d.paymentId),
    };
    if (d.ketQua !== "BO_QUA") {
      return {
        ...chung,
        ketQua: d.ketQua,
        dich: d.phan.map((p) => {
          const e = theoId.get(p.enrollmentId);
          return { ten: e?.student.name ?? "(không rõ)", khoa: e?.course.name ?? "", lop: e?.class?.name ?? null, soTienLabel: tien(p.amount) };
        }),
        lyDo: null,
      };
    }
    const beCua = new Map<string, number>();
    for (const p of d.phanThu) {
      const hv = theoId.get(p.enrollmentId)?.studentId ?? "";
      beCua.set(hv, (beCua.get(hv) ?? 0) + 1);
    }
    const [beMoHo, soGhiDanh] = [...beCua.entries()].find(([, n]) => n >= 2) ?? [null, 0];
    const tenMoHo = beMoHo ? (ten.find((e) => e.studentId === beMoHo)?.student.name ?? null) : null;
    return {
      ...chung,
      ketQua: "BO_QUA",
      dich: [],
      lyDo: cauBoQuaGan(d.ma, { tenBe: tenMoHo, soGhiDanh, soBe: new Set(d.phanThu.map((p) => theoId.get(p.enrollmentId)?.studentId)).size, khoaHoaDon: d.khoaHoaDon }),
    };
  });
  // Khoản của CHÍNH lần thu lên trước.
  dong.sort((a, b) => Number(b.trongLanThu) - Number(a.trongLanThu));

  return {
    key: input.lanThuKey,
    dau: dauKeHoachGan(keHoach),
    chan: keHoach.chan ? CAU_CHAN_GAN_GHI_DANH : null,
    soGan: keHoach.dong.filter((d) => d.ketQua === "GAN").length,
    soTach: keHoach.dong.filter((d) => d.ketQua === "TACH").length,
    dong,
  };
}
