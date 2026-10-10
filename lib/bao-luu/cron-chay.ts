import "server-only";
import { db } from "@/lib/db";
import { vnYmd } from "@/lib/time/vn";
import { laBaoLuuBat } from "@/lib/bao-luu/feature";
import { docChinhSachCron } from "@/lib/bao-luu/ngu-canh-db";
import { hanCuaHoSo, lapKeHoachCron, type HoSoCron, type ViecCron } from "@/lib/bao-luu/cron-ke-hoach";
import { batDauKhiDenNgay, chamDut, quaHan } from "@/lib/bao-luu/vong-doi";
import {
  baoCenterQuaNgay,
  baoChamDut,
  baoLeoThang,
  baoNhacDungHan,
  baoNhacTruocHan,
  baoQuaHan,
  baoThuHoiKit,
  type HoSoChuong,
} from "@/lib/bao-luu/thong-bao";
import { ghiSuKien } from "@/lib/bao-luu/chuyen-trang-thai";

// lib/bao-luu/cron-chay.ts — THỰC THI kế hoạch cron bảo lưu (`cron-ke-hoach.ts`). Gọi từ `/api/cron/bao-luu` (06:00 giờ VN). PHIÊN 5.
//
// Quy tắc: IDEMPOTENT (chạy lại không làm gì thêm: chuyển trạng thái có điều kiện, chuông có dedupeKey theo mốc), mỗi hồ sơ một giao dịch
// riêng — MỘT hồ sơ hỏng không làm hỏng cả lượt (đếm `loi`, ghi log, đi tiếp). KHÔNG ghi dòng tiền. Cơ sở TẮT `pause.enabled` thì cron
// BỎ QUA hồ sơ của cơ sở đó (đếm `boQuaCoTat`): chấm dứt là phép ghi huỷ quyền lợi, không được chạy khi người vận hành đã rút cờ.

export type KetQuaCron = {
  quet: number;
  boQuaCoTat: number;
  viec: Record<ViecCron["loai"], number>;
  loi: number;
};

const TRAN_QUET = 5_000;

const ngayDmy = (d: Date) => d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric" });

export async function chayCronBaoLuu(now: Date): Promise<KetQuaCron> {
  const ketQua: KetQuaCron = {
    quet: 0,
    boQuaCoTat: 0,
    loi: 0,
    viec: { START: 0, NHAC_TRUOC_HAN: 0, NHAC_DUNG_HAN: 0, QUA_HAN: 0, LEO_THANG: 0, CHAM_DUT: 0, CENTER_NHAC: 0 },
  };

  const dong = await db.studentReserve.findMany({
    where: { approvedAt: { not: null }, status: { in: ["APPROVED", "ACTIVE", "OVERDUE", "NOTICE_SENT"] } },
    select: {
      id: true, type: true, status: true, studentId: true, centerId: true, orgUnitId: true,
      startedAt: true, expectedEndAt: true, standardEndDate: true, extendedEndDate: true,
      lastContactAt: true, responseDeadline: true, createdByUserId: true,
      student: { select: { name: true } },
      enrollment: { select: { course: { select: { name: true } }, class: { select: { name: true } } } },
    },
    orderBy: { startedAt: "asc" },
    take: TRAN_QUET,
  });
  ketQua.quet = dong.length;
  if (dong.length === 0) return ketQua;

  // Đã leo thang SAU lần liên hệ cuối chưa (chống lặp mỗi sáng). Một truy vấn cho cả lô.
  const quaHanIds = dong.filter((d) => d.status === "OVERDUE").map((d) => d.id);
  const lanLeoThang = quaHanIds.length
    ? await db.studentReserveEvent.groupBy({ by: ["reserveId"], where: { reserveId: { in: quaHanIds }, kind: "ESCALATE" }, _max: { at: true } })
    : [];
  const leoThangCuoi = new Map(lanLeoThang.map((r) => [r.reserveId, r._max.at]));

  // Công tắc + chính sách: MỘT lần cho mỗi đơn vị.
  const donVi = [...new Set(dong.map((d) => d.orgUnitId))];
  const batTheoDonVi = new Map<string | null, boolean>();
  const csTheoDonVi = new Map<string | null, Awaited<ReturnType<typeof docChinhSachCron>>>();
  for (const dv of donVi) {
    const bat = await laBaoLuuBat(dv);
    batTheoDonVi.set(dv, bat);
    if (bat) csTheoDonVi.set(dv, await docChinhSachCron(dv));
  }

  const theoDonVi = new Map<string | null, typeof dong>();
  for (const d of dong) {
    if (!batTheoDonVi.get(d.orgUnitId)) {
      ketQua.boQuaCoTat++;
      continue;
    }
    const a = theoDonVi.get(d.orgUnitId) ?? [];
    a.push(d);
    theoDonVi.set(d.orgUnitId, a);
  }

  const hom = vnYmd(now);
  for (const [dv, ds] of theoDonVi) {
    const cs = csTheoDonVi.get(dv)!;
    const hoSoCron: HoSoCron[] = ds.map((d) => {
      const lan = leoThangCuoi.get(d.id) ?? null;
      return {
        id: d.id, type: d.type, status: d.status, startedAt: d.startedAt, expectedEndAt: d.expectedEndAt,
        standardEndDate: d.standardEndDate, extendedEndDate: d.extendedEndDate, lastContactAt: d.lastContactAt, responseDeadline: d.responseDeadline,
        daLeoThang: lan !== null && (d.lastContactAt === null || lan.getTime() > d.lastContactAt.getTime()),
      };
    });
    const theoId = new Map(ds.map((d) => [d.id, d]));
    for (const v of lapKeHoachCron(hoSoCron, cs, now)) {
      const d = theoId.get(v.id)!;
      const chuong: HoSoChuong = {
        id: d.id, centerId: d.centerId, nguoiLapId: d.createdByUserId, tenHocVien: d.student.name,
        tenKhoa: d.enrollment ? `${d.enrollment.course.name} — ${d.enrollment.class.name}` : "Toàn bộ khoá đang học",
      };
      const han = hanCuaHoSo(d);
      try {
        switch (v.loai) {
          case "START": {
            const r = await batDauKhiDenNgay({ reserveId: d.id }, now);
            if (r.ok) ketQua.viec.START++;
            break;
          }
          case "NHAC_TRUOC_HAN":
            if ((await baoNhacTruocHan(chuong, v.conNgay, han ? ngayDmy(han) : "—")) >= 0) ketQua.viec.NHAC_TRUOC_HAN++;
            break;
          case "NHAC_DUNG_HAN":
            if ((await baoNhacDungHan(chuong, han ? ngayDmy(han) : "—")) >= 0) ketQua.viec.NHAC_DUNG_HAN++;
            break;
          case "QUA_HAN": {
            const r = await quaHan({ reserveId: d.id }, now);
            if (r.ok) {
              ketQua.viec.QUA_HAN++;
              await baoQuaHan(chuong, han ? ngayDmy(han) : "—");
            }
            break;
          }
          case "LEO_THANG": {
            // Ghi sự kiện ESCALATE (chống lặp ở lần cron kế) RỒI mới báo; hai việc trong một giao dịch ghi sự kiện, chuông sau commit.
            await db.$transaction((tx) =>
              ghiSuKien(tx, { hoSo: { id: d.id, centerId: d.centerId, orgUnitId: d.orgUnitId }, kind: "ESCALATE", actor: null, at: now, after: { quaHanNgay: v.quaHanNgay }, note: "Quá hạn chưa liên hệ phụ huynh — leo thang quản lý" }),
            );
            ketQua.viec.LEO_THANG++;
            await baoLeoThang(chuong, v.quaHanNgay, hom);
            break;
          }
          case "CHAM_DUT": {
            const r = await chamDut({ reserveId: d.id }, now);
            if (r.ok) {
              ketQua.viec.CHAM_DUT++;
              await baoChamDut(chuong);
              await baoThuHoiKit(chuong);
            }
            break;
          }
          case "CENTER_NHAC":
            await baoCenterQuaNgay(chuong, v.quaNgay, hom);
            ketQua.viec.CENTER_NHAC++;
            break;
        }
      } catch (err) {
        ketQua.loi++;
        console.error("[cron bao-luu] lỗi một hồ sơ", { id: d.id, loai: v.loai, loi: err instanceof Error ? err.message.slice(0, 200) : "?" });
      }
    }
  }
  return ketQua;
}
