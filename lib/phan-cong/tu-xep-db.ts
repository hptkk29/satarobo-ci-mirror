// lib/phan-cong/tu-xep-db.ts — TỰ XẾP học bù / Trial cho NGƯỜI ĐANG TRỰC (GĐ5, docs/phan-cong-gop/KHAO-SAT.md chốt 2, 3, 11).
//
// Phần ĐỌC cho hàm thuần `chonNguoiTruc`: ai trực ca nào ở cơ sở ngày đó, việc dạy trong ngày của từng người (mọi cơ sở), số học bù /
// Trial đã nhận trong tháng, chứng nhận Trial, mã nhân viên. Màn đặt case / thêm buổi Trial và đường ghi ở máy chủ CÙNG gọi
// `goiYTuXep` — màn chọn sẵn ai thì máy chủ nhận đúng người đó (luật 12).
//
// Công tắc: `shift.phanCongTuXepBuTrialBat` theo cơ sở (mặc định TẮT) VÀ công tắc phân công buổi (STAFFING) có hiệu lực ở cơ sở đó.
// Tắt ⇒ `{ bat: false }`, luồng book cũ y nguyên. Ngày không thuộc SR.QD.238 ⇒ cũng coi như tắt (không có khung ca để xếp).
import "server-only";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";
import { congTacHieuLuc } from "@/lib/parttime/cong-tac";
import { phanCongVaoBuoi, thamSoApDung, type Nguon, type NguoiThaoTac } from "@/lib/parttime/phan-cong-db";
import { writeAudit } from "@/lib/audit/audit-log";
import { notifyStaff } from "@/lib/notifications/notify";
import { quanLyCoSo } from "@/lib/notifications/nguoi-nhan-phia-sale";
import type { Prisma } from "@prisma/client";
import { TRANG_THAI_SONG } from "@/lib/parttime/phan-cong";
import { docNguonHoTroTrial } from "@/lib/parttime/rank-trial-db";
import { xepBuoiVaoCa } from "./ma-o";
import { chonNguoiTruc, type KetQuaChon, type UngVienTruc } from "./chon-nguoi-truc";

export const KHOA_TU_XEP = "shift.phanCongTuXepBuTrialBat" as const;

const ngayDb = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);

/** Tự xếp có hiệu lực ở cơ sở này không (công tắc riêng + STAFFING). */
export async function tuXepDangBat(centerId: string): Promise<boolean> {
  if (!(await congTacHieuLuc("STAFFING", { centerId }))) return false;
  const ou = await db.orgUnit.findFirst({ where: { centerId, type: "CENTER" }, select: { id: true } });
  return (await getSetting(KHOA_TU_XEP, { orgUnitId: ou?.id ?? null })) === true;
}

export type GoiYTuXep = { bat: false } | { bat: true; kq: KetQuaChon };

/**
 * Gợi ý người trực cho MỘT buổi học bù / Trial. `hopLe` = tập người được phép nhận (vd. GV có ca phủ khung giờ của màn Học bù — cổng
 * `gvTrongCa` vẫn đứng ở đường ghi); `null` = không lọc thêm. `boQuaNguon` = chính buổi đang sửa / duyệt (không tính việc của nó là bận).
 */
export async function goiYTuXep(p: {
  centerId: string;
  ngay: string;
  gioBatDau: string;
  gioKetThuc: string;
  loai: "BU" | "TRIAL";
  hopLe: readonly string[] | null;
  boQuaNguon: Nguon | null;
}): Promise<GoiYTuXep> {
  if (!(await tuXepDangBat(p.centerId))) return { bat: false };
  const ts = await thamSoApDung(db, p.ngay);
  if (!ts) return { bat: false };

  const truc = await db.operationsDutyAssignment.findMany({
    where: { centerId: p.centerId, workDate: ngayDb(p.ngay), status: { in: [...TRANG_THAI_SONG] } },
    select: { userId: true, shiftCode: true },
  });
  const hopLe = p.hopLe ? new Set(p.hopLe) : null;
  const ids = [...new Set(truc.map((t) => t.userId))].filter((u) => !hopLe || hopLe.has(u));
  const caTruc = new Map<string, string[]>();
  for (const t of truc) caTruc.set(t.userId, [...(caTruc.get(t.userId) ?? []), t.shiftCode]);

  const thang = p.ngay.slice(0, 7);
  const dauThang = ngayDb(`${thang}-01`);
  const dauThangSau = new Date(Date.UTC(Number(thang.slice(0, 4)), Number(thang.slice(5, 7)), 1));
  const [viec, buTrial, nguoi, trial] = await Promise.all([
    ids.length
      ? db.sessionStaffAssignment.findMany({
          where: {
            userId: { in: ids },
            ngay: ngayDb(p.ngay),
            status: { in: [...TRANG_THAI_SONG] },
            role: { in: ["MAIN_TEACHER", "TEACHING_ASSISTANT"] },
            ...(p.boQuaNguon ? { NOT: { sourceType: p.boQuaNguon.sourceType, sourceId: p.boQuaNguon.sourceId } } : {}),
          },
          select: { userId: true, gioBatDau: true, gioKetThuc: true },
        })
      : [],
    ids.length
      ? db.sessionStaffAssignment.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, role: "MAIN_TEACHER", activityType: { in: ["MAKEUP", "TRIAL"] }, ngay: { gte: dauThang, lt: dauThangSau }, status: { in: [...TRANG_THAI_SONG] } },
          _count: { _all: true },
        })
      : [],
    ids.length ? db.user.findMany({ where: { id: { in: ids } }, select: { id: true, employee: { select: { employeeCode: true } } } }) : [],
    p.loai === "TRIAL" && ids.length ? docNguonHoTroTrial(ids) : null,
  ]);

  const ungVien: UngVienTruc[] = ids.map((u) => {
    const ca = caTruc.get(u) ?? [];
    return {
      userId: u,
      maNv: nguoi.find((x) => x.id === u)?.employee?.employeeCode ?? null,
      caTruc: ca,
      viec: viec
        .filter((v) => v.userId === u)
        .map((v) => ({ gioBatDau: v.gioBatDau, gioKetThuc: v.gioKetThuc, ca: xepBuoiVaoCa({ ca: ts.ca, gioBatDau: v.gioBatDau, gioKetThuc: v.gioKetThuc, caCoTruc: ca }) })),
      soBuTrialThang: buTrial.find((x) => x.userId === u)?._count._all ?? 0,
      coChungNhanTrial: trial?.chungNhanTai(u, p.ngay) ?? false,
    };
  });
  return { bat: true, kq: chonNguoiTruc({ ca: ts.ca, loai: p.loai, gioBatDau: p.gioBatDau, gioKetThuc: p.gioKetThuc, ungVien }) };
}

/** Câu nói cho màn (ô chọn GV) — một chỗ, để màn đặt case học bù và màn Trial nói giống nhau. */
export function cauGoiY(g: GoiYTuXep, ten: (userId: string) => string): string | null {
  if (!g.bat) return null;
  const k = g.kq;
  if (k.userId !== null) return `Tự xếp: ${ten(k.userId)} — đang trực ca ${k.ca}.`;
  const vi = k.lyDo === "NGOAI_KHUNG" ? "buổi nằm ngoài mọi khung ca" : k.lyDo === "KHONG_AI_CO_CHUNG_NHAN" ? `không ai trực ca ${k.ca} có chứng nhận Trial` : `không ai trực ca ${k.ca}`;
  return `Không tự xếp được (${vi}) — chọn giáo viên; quản lý cơ sở sẽ được báo.`;
}

/**
 * GHI kết quả tự xếp cho một buổi VỪA thành lịch thật (tạo case học bù có quyền duyệt · duyệt case · thêm buổi Trial), TRONG giao dịch
 * của phép ghi buổi:
 *   · người được chọn ĐÚNG là người tự xếp ⇒ phân công đứng chính nguồn `TU_XEP_BU_TRIAL` (đồng bộ một chiều không đè — `danXuatDuoc`);
 *   · không ai trực (đường lùi, chốt 2) ⇒ dấu nhật ký `PT_TU_XEP_DUONG_LUI` trên buổi + trả `baoQlcs` để báo quản lý cơ sở SAU commit;
 *   · có người tự xếp mà người thao tác chọn người KHÁC ⇒ không ghi gì thêm (lựa chọn tay — đồng bộ dựng như cũ).
 * Lỗi phân công ⇒ `throw` (đã có thể đã ghi buổi — luật rollback).
 */
export async function ghiTuXep(
  tx: Prisma.TransactionClient,
  p: { nguon: Nguon; gvId: string | null; goiY: GoiYTuXep; actor: NguoiThaoTac },
): Promise<{ baoQlcs: boolean }> {
  if (!p.goiY.bat) return { baoQlcs: false };
  const k = p.goiY.kq;
  if (k.userId !== null) {
    if (k.userId !== p.gvId) return { baoQlcs: false };
    const r = await phanCongVaoBuoi(tx, {
      nguon: p.nguon,
      userId: k.userId,
      role: "MAIN_TEACHER",
      assignmentType: "MANUAL",
      nguonGiao: "TU_XEP_BU_TRIAL",
      actor: p.actor,
      note: `Tự xếp: người trực ca ${k.ca}`,
    });
    if (!r.ok) throw new Error(`Không ghi được phân công tự xếp: ${r.loi}`);
    return { baoQlcs: false };
  }
  await writeAudit({
    actor: p.actor,
    module: "hr_attendance",
    entityType: p.nguon.sourceType === "MAKEUP_CASE" ? "MakeupCase" : "TrialClassSession",
    entityId: p.nguon.sourceId,
    action: "PT_TU_XEP_DUONG_LUI",
    newValues: { lyDo: k.lyDo, ca: k.ca, gvChonTay: p.gvId },
    tx,
  });
  return { baoQlcs: true };
}

/** Báo quản lý cơ sở (SAU commit) một buổi học bù / Trial không tự xếp được vì không ai trực — chốt 2 "đẩy QLCS". */
export async function baoQlcsDuongLui(p: { centerId: string; nguon: Nguon; moTa: string }): Promise<void> {
  try {
    const ql = await quanLyCoSo(p.centerId);
    if (!ql.length) return;
    await notifyStaff({
      userIds: ql,
      dedupeKey: `phan-cong.tu-xep-duong-lui:${p.nguon.sourceType}:${p.nguon.sourceId}`,
      title: "Không tự xếp được người trực",
      body: `${p.moTa}: không ai trực đúng ca — đã dùng giáo viên chọn tay. Kiểm lại ở màn Phân công.`,
      href: "/cham-cong/phan-cong",
    });
  } catch {
    // Thông báo không được làm hỏng việc đặt lịch đã commit.
  }
}
