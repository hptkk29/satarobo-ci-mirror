import "server-only";
import type { Prisma } from "@prisma/client";
import { logStudentAudit } from "@/lib/audit/log";
import { SNAPSHOT_HO_SO, ghiHoSoTrongTx, type AnhHoSo } from "@/lib/students/ghi-ho-so";
import { parseVnYmd } from "@/lib/time/vn";
import { ghepEmVoiHoSo } from "./ghep-em-voi-ho-so";

// lib/finance/hoa-don/dong-bo-hoc-vien-qr.ts — ĐỒNG BỘ các em phụ huynh khai trên form QR sang HỒ SƠ HỌC VIÊN (chủ dự án 09/11/2026: «đồng bộ em thứ 2, 3 của form sang hồ sơ học viên luôn»).
//
// Đường công khai KHÔNG có người đăng nhập, nên luật ở đây chặt hơn màn nhân viên (`ghi-nguoi-mua.ts`):
//   · CHỈ ĐIỀN Ô ĐANG TRỐNG (ngày sinh, CCCD của em). Ô hồ sơ đã có giá trị thì KHÔNG đè — phụ huynh gõ qua một liên kết không được sửa danh tính đã lưu; muốn sửa thì nhân viên sửa ở màn Học viên.
//   · Em phải thuộc ĐÚNG gia đình của đơn: học viên của đơn (`Order.studentId`, học viên của các dòng đơn / ghi danh) VÀ anh/chị/em cùng phiếu lead (cùng `leadId`), cùng cơ sở của đơn (hồ sơ cũ chưa gán cơ sở vẫn tính), chưa xoá.
//   · Ghép em ↔ hồ sơ theo TÊN (so sau chuẩn hoá, không phân biệt hoa thường; không khớp thì thử không dấu NHƯNG chỉ khi chỉ có ĐÚNG MỘT hồ sơ khớp). Nhiều hồ sơ cùng khớp ⇒ BỎ QUA, không đoán.
//   · Em chưa có hồ sơ học viên (còn là con trong phiếu lead) ⇒ chưa đồng bộ: phiếu lead không có ô CCCD, và ngày sinh vào lead đi qua màn Lead. Số em chưa ghép được ghi vào nhật ký (CHỈ số lượng).
//   · Ghi bằng CHÍNH `ghiHoSoTrongTx` của màn nhân viên (nhật ký hồ sơ + đồng bộ sang phiếu lead / con trong phiếu / anh chị em — «đổi một nơi thì đổi hết»). CCCD không vào vết giá trị: một dòng riêng chỉ có TÊN ô.
// `tx` phải KHÔNG scope (`db.$transaction`) — cùng lý do `ghi-ho-so.ts`.

type Tx = Prisma.TransactionClient;

export type EmTuForm = { ten: string; ngaySinh: string | null; cccd: string | null };
export type KetQuaDongBoHocVien = { daDongBo: number; chuaKhop: number; boQuaMoHo: number };

const NGUOI_PH = { id: null, name: "Phụ huynh (form QR thông tin hoá đơn)" } as const;
const LY_DO = "Đồng bộ ô còn trống theo thông tin phụ huynh khai trên form QR hoá đơn (không đè giá trị đã có)";

export async function dongBoHocVienTuFormQr(tx: Tx, input: { orderId: string; centerId: string; em: readonly EmTuForm[] }): Promise<KetQuaDongBoHocVien> {
  const kq: KetQuaDongBoHocVien = { daDongBo: 0, chuaKhop: 0, boQuaMoHo: 0 };
  const em = input.em.filter((e) => e.ten.trim() !== "" && (e.ngaySinh || e.cccd));
  if (em.length === 0) return kq;

  // Học viên của đơn → cả gia đình (cùng phiếu lead).
  const don = await tx.order.findFirst({
    where: { id: input.orderId, centerId: input.centerId },
    select: { studentId: true, items: { select: { studentId: true, enrollment: { select: { studentId: true } } } } },
  });
  if (!don) return kq;
  const goc = new Set<string>();
  if (don.studentId) goc.add(don.studentId);
  for (const it of don.items) {
    if (it.studentId) goc.add(it.studentId);
    if (it.enrollment?.studentId) goc.add(it.enrollment.studentId);
  }
  const CHON = { id: true, nationalId: true, ...SNAPSHOT_HO_SO } as const;
  const chinh = goc.size === 0 ? [] : await tx.student.findMany({ where: { id: { in: [...goc] }, OR: [{ centerId: input.centerId }, { centerId: null }], deletedAt: null }, select: CHON });
  const leadIds = [...new Set(chinh.map((s) => s.leadId).filter((l): l is string => Boolean(l)))];
  const anhEm = leadIds.length === 0 ? [] : await tx.student.findMany({ where: { leadId: { in: leadIds }, OR: [{ centerId: input.centerId }, { centerId: null }], deletedAt: null }, select: CHON });
  const hoSo = [...new Map([...chinh, ...anhEm].map((s) => [s.id, s] as const)).values()];

  const daDung = new Set<string>(); // một hồ sơ chỉ ghép cho MỘT em của form
  for (const e of em) {
    const g = ghepEmVoiHoSo(e.ten, hoSo.filter((h) => !daDung.has(h.id)));
    if (!g.hoSo) {
      if ("moHo" in g && g.moHo) kq.boQuaMoHo += 1;
      else kq.chuaKhop += 1;
      continue;
    }
    const hv = g.hoSo;
    daDung.add(hv.id);
    const data: Prisma.StudentUpdateInput = {};
    const ngay = e.ngaySinh ? parseVnYmd(e.ngaySinh) : null;
    if (ngay && hv.dateOfBirth === null) data.dateOfBirth = ngay;
    if (e.cccd && !hv.nationalId) data.nationalId = e.cccd;
    if (Object.keys(data).length === 0) continue;

    const truoc = Object.fromEntries(Object.keys(SNAPSHOT_HO_SO).map((k) => [k, hv[k as keyof typeof hv]])) as unknown as AnhHoSo;
    await ghiHoSoTrongTx({ tx, studentId: hv.id, data, truoc, actor: NGUOI_PH });
    if (data.nationalId !== undefined) {
      // CCCD không nằm trong ảnh chụp nhật ký ⇒ một dòng riêng chỉ có TÊN ô, không có giá trị.
      await logStudentAudit({ studentId: hv.id, action: "UPDATE", actorId: NGUOI_PH.id, actorName: NGUOI_PH.name, changedFields: ["nationalId"], reason: LY_DO, tx });
    }
    kq.daDongBo += 1;
  }
  return kq;
}
