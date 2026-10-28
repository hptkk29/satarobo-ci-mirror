"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canViewLeadPii, checkPermission } from "@/lib/auth/check-permission";
import { resolveActor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { getAuditActor } from "@/lib/audit/log";
import { canonicalPhone } from "@/lib/phone";
import { findParentMatch } from "@/lib/crm/dedupe";
import { docDuLieuChuyenDoi } from "@/lib/orders/chuyen-doi-don";
import { ghiChuyenDoi, type KeHoachDong } from "@/lib/orders/chuyen-doi-ghi";
import {
  docBoiCanhCoSoDon,
  duocChuyenDoiDon,
  lyDoChuaChuyenDoiDuocDon,
  vaiXepLop,
} from "@/lib/orders/cong-chuyen-doi";
import { baoChoDuyetHocVuot, doiBuoiBatDauCuaDon } from "@/lib/orders/hoc-vuot-chuyen-doi";
import {
  canKhaiHocVuot,
  kiemBuoiBatDau,
  kiemSoBuoiBu,
  tuDuyetHocVuot,
  vaiChonDuoc,
  xetTheoBuoiBatDau,
} from "@/lib/lms/xep-lop-theo-buoi-bat-dau";
import { hichCapQuyenHocChoDon } from "@/lib/entitlements/hich";
import { tienWebhookCuaDon } from "@/lib/payments/tien-webhook-vao-don";

// app/(admin)/admin/orders/[id]/chuyen-doi/_actions.ts — chốt chuyển đổi: tạo học viên và xếp vào lớp, THEO TỪNG DÒNG ĐƠN.
//
// Chủ dự án: *"mỗi con xếp riêng để có thể chọn 2 lớp riêng cho 2 con hoặc 1 con học 1 con nghỉ"*. Đầu vào là mảng dòng đã CHỌN LỚP; dòng không chọn lớp thì
// không đụng tới, và bấm lại lần sau vẫn xếp được. [27/10/2026] KHÔNG còn ô "Xếp bé này": dòng có chọn lớp là dòng được xếp.
//
// Phần GHI nằm ở `lib/orders/chuyen-doi-ghi.ts` (giao dịch không scope để đồng bộ hồ sơ HV ↔ lead). Ở đây: CỔNG (quyền · tầm nhìn cơ sở · tiền · lớp theo vai ·
// buổi bắt đầu · học vượt) — mọi cổng TRƯỚC giao dịch.

const GioiTinhSchema = z.enum(["MALE", "FEMALE", "OTHER"]);

const DongSchema = z.object({
  orderItemId: z.string().min(1),
  /** Tên bé. Bắt buộc — không có tên thì không tạo được hồ sơ học viên. */
  tenBe: z.string().trim().min(2, "Tên học viên tối thiểu 2 ký tự").max(120),
  /** `yyyy-MM-dd`; bỏ trống được. */
  ngaySinh: z.string().trim().optional().nullable(),
  gioiTinh: GioiTinhSchema.optional().nullable(),
  lopTruong: z.number().int().min(1).max(12).optional().nullable(),
  truong: z.string().trim().max(200).optional().nullable(),
  classId: z.string().min(1, "Chưa chọn lớp"),
  /** Buổi bé bắt đầu học — Sale nhập cho dòng ĐƠN THƯỜNG dưới đủ khoá. */
  buoiBatDau: z.number().int().min(1).optional().nullable(),
  /** Lớp đòi học vượt: Sale tích xác nhận + số buổi học bù. */
  hocVuot: z.object({ soBuoiBu: z.number().int() }).optional().nullable(),
  dongYHinhAnh: z.boolean().optional(),
});

const ChuoiTuyChon = (max: number) => z.string().trim().max(max).optional().nullable();

const PhuHuynhSchema = z.object({
  ten: ChuoiTuyChon(120),
  email: z.union([z.literal(""), z.string().trim().email("Email phụ huynh không hợp lệ").max(200)]).optional().nullable(),
  quanHe: ChuoiTuyChon(60),
  gioiTinh: GioiTinhSchema.optional().nullable(),
  ngaySinh: ChuoiTuyChon(10),
  facebook: ChuoiTuyChon(300),
  diaChi: ChuoiTuyChon(300),
  tinh: ChuoiTuyChon(120),
  phuong: ChuoiTuyChon(120),
});

const Schema = z.object({
  orderId: z.string().min(1),
  phuHuynh: PhuHuynhSchema.optional(),
  dong: z.array(DongSchema).min(1, "Chưa chọn lớp cho bé nào").max(20),
});

export type KetQuaChuyenDoi =
  | { ok: true; soCon: number; soPhieuHocBu: number; soChoDuyet: number }
  | { ok: false; error: string };

const ngay = (s: string | null | undefined): Date | null => {
  const t = (s ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function chuyenDoiDonAction(input: unknown): Promise<KetQuaChuyenDoi> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  // Cổng quyền: tạo ghi danh — CÙNG quyền mà `enrollStudent` đòi. Đẻ một quyền riêng cho màn này là mở một đường ghi danh thứ hai đi qua một cổng khác.
  if (!(await checkPermission("enrollments:create"))) {
    return { ok: false, error: "Không có quyền xếp học viên vào lớp" };
  }
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  }
  const { orderId, dong, phuHuynh } = parsed.data;

  const uid = session.user.id;
  const actor = await resolveActor(uid);
  const sdb = scopedDb(actor);
  const [laAdmin, laQlcs] = await Promise.all([
    checkPermission("enrollments:override-progress"),
    checkPermission("makeup:waive"),
  ]);
  const vai = vaiXepLop({ laAdmin, laQlcs });

  // Đơn phải thuộc tầm nhìn cơ sở của actor. `findFirst` qua `scopedDb` là cổng IDOR: id đơn của cơ sở khác trả `null`, không trả dữ liệu.
  const donTrongTam = await sdb.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { id: true, code: true, centerId: true, hocBong100: true },
  });
  if (!donTrongTam) return { ok: false, error: "Không tìm thấy đơn" };

  // ── CỔNG TIỀN (hoặc học bổng 100% do Quản trị tối cao cấp) ──────────────────────────────────────────────────
  const tien = await tienWebhookCuaDon(orderId);
  if (!duocChuyenDoiDon(tien, donTrongTam.hocBong100)) {
    return { ok: false, error: lyDoChuaChuyenDoiDuocDon(tien, donTrongTam.hocBong100) ?? "Đơn chưa đủ điều kiện" };
  }

  // ── MỌI CỔNG ĐỨNG TRƯỚC PHÉP GHI ĐẦU TIÊN ──────────────────────────────────────────────────────────────────
  const bayGio = new Date();
  const boiCanh = await docBoiCanhCoSoDon(donTrongTam.centerId);
  const duLieu = await docDuLieuChuyenDoi(orderId, bayGio, { vai, tran: boiCanh.tran, xemPiiLead: await canViewLeadPii() });
  if (!duLieu) return { ok: false, error: "Không đọc được dữ liệu đơn" };

  const theoDong = new Map(duLieu.dong.map((d) => [d.orderItemId, d]));
  const keHoach: KeHoachDong[] = [];
  const daGap = new Set<string>();

  for (const d of dong) {
    if (daGap.has(d.orderItemId)) return { ok: false, error: "Một dòng đơn bị gửi hai lần" };
    daGap.add(d.orderItemId);
    const goc = theoDong.get(d.orderItemId);
    if (!goc) return { ok: false, error: "Dòng đơn không thuộc đơn này (hoặc không phải dòng khoá học)" };
    if (goc.enrollmentId) return { ok: false, error: `"${goc.tenDong}" đã được chuyển đổi trước đó.` };

    // Lớp phải nằm trong danh sách lớp CỦA VAI NÀY (Sale/QLCS: cùng cơ sở đơn; Quản trị tối cao: mọi cơ sở).
    const lop = goc.lop.find((l) => l.id === d.classId);
    if (!lop) return { ok: false, error: `Lớp đã chọn không hợp lệ cho "${goc.tenDong}".` };
    // Sĩ số: KHÔNG ai vượt được, kể cả Quản trị tối cao — `enrollStudent` từ chối `CLASS_FULL` vô điều kiện.
    if (lop.daDay) return { ok: false, error: `Lớp "${lop.ten}" đã đủ ${lop.siSoToiDa} chỗ.` };

    let buoiBatDauLuu: number | null = null;
    let hocVuot: KeHoachDong["hocVuot"] = null;

    if (!goc.phamVi) {
      // ── ĐƠN THƯỜNG: buổi bắt đầu do SALE NHẬP, lớp xét theo đó ──────────────────────────────────────────────
      const ngoai = { tongSoBuoiKhoa: goc.tongSoBuoiKhoa, soBuoiMua: goc.soBuoiMua };
      const sai = kiemBuoiBatDau(ngoai, d.buoiBatDau ?? goc.khoangBuoi?.macDinh ?? 1);
      if (sai) return { ok: false, error: `${goc.tenDong}: ${sai}` };
      const s = d.buoiBatDau ?? goc.khoangBuoi?.macDinh ?? null;
      const x = xetTheoBuoiBatDau({ ...ngoai, buoiBatDau: s, soBuoiDaQua: lop.soBuoiDaQua, tran: boiCanh.tran });
      if (!vaiChonDuoc(vai, x)) {
        return { ok: false, error: `${lop.ten} — ${x.cau}` };
      }
      buoiBatDauLuu = x.buoiBatDau !== null && x.buoiBatDau > 1 ? x.buoiBatDau : null;
      if (canKhaiHocVuot(x)) {
        const saiBu = kiemSoBuoiBu(x.soBuoiCanBu, d.hocVuot?.soBuoiBu);
        if (!d.hocVuot || saiBu) {
          return {
            ok: false,
            error: `${lop.ten}: lớp đã học trước ${x.soBuoiCanBu} buổi so với buổi bắt đầu của bé — tích xác nhận học vượt và nhập số buổi học bù. ${saiBu ?? ""}`.trim(),
          };
        }
        hocVuot = { buoiBatDau: x.buoiBatDau!, canBu: x.soBuoiCanBu, soBuoiBu: d.hocVuot.soBuoiBu };
      }
    } else if (vai !== "ADMIN" && lop.khacCoSo) {
      return { ok: false, error: `Lớp "${lop.ten}" thuộc cơ sở khác với đơn.` };
    }

    keHoach.push({
      orderItemId: d.orderItemId,
      tenBe: d.tenBe,
      ngaySinh: ngay(d.ngaySinh),
      gioiTinh: d.gioiTinh ?? null,
      lopTruong: d.lopTruong ?? null,
      truong: d.truong?.trim() || null,
      classId: d.classId,
      courseId: goc.courseId,
      leadChildId: goc.leadChildId,
      buoiBatDauLuu,
      phamVi: goc.phamVi,
      dongYHinhAnh: d.dongYHinhAnh === true,
      hocVuot,
    });
  }

  // Phụ huynh: tra TRƯỚC giao dịch (chỉ đọc), tạo BÊN TRONG nếu chưa có. SĐT lấy từ ĐƠN — không đổi ở đây (SĐT là khoá nhận diện + đăng nhập cổng PH).
  const sdtChuan = canonicalPhone(duLieu.phuHuynh.sdt) ?? duLieu.phuHuynh.sdt;
  const emailPh = phuHuynh?.email?.trim() || duLieu.phuHuynh.email || null;
  const khop = await findParentMatch({ email: emailPh, phone: duLieu.phuHuynh.sdt });
  // Ba nhánh khử trùng phụ huynh (SRS §8.4): none ⇒ tạo mới; reuse ⇒ dùng lại; conflict ⇒ email thuộc phụ huynh A, SĐT thuộc phụ huynh B ⇒ CHẶN
  // (tự chọn một bên là gắn con vào nhầm gia đình; `convertLeadV2` cũng chặn đúng ca này).
  if (khop.kind === "conflict") {
    return {
      ok: false,
      error:
        "Email và số điện thoại của đơn đang thuộc HAI hồ sơ phụ huynh khác nhau — gộp hai hồ sơ đó trước rồi chuyển đổi lại.",
    };
  }
  const parentUserIdCu = khop.kind === "reuse" ? khop.userId : null;

  const { actorId, actorName } = getAuditActor(session);

  let kq;
  try {
    kq = await ghiChuyenDoi({
      duLieu,
      keHoach,
      ph: {
        ten: phuHuynh?.ten?.trim() || duLieu.phuHuynh.ten,
        email: emailPh,
        quanHe: phuHuynh?.quanHe ?? null,
        gioiTinh: phuHuynh?.gioiTinh ?? null,
        ngaySinh: ngay(phuHuynh?.ngaySinh),
        facebook: phuHuynh?.facebook ?? null,
        diaChi: phuHuynh?.diaChi ?? null,
        tinh: phuHuynh?.tinh ?? null,
        phuong: phuHuynh?.phuong ?? null,
      },
      sdtChuan,
      parentUserIdCu,
      orgUnitId: boiCanh.orgUnitId,
      actor: { id: actorId, name: actorName },
      bayGio,
      tuDuyet: tuDuyetHocVuot(vai),
    });
  } catch (e) {
    return { ok: false, error: `Không chuyển đổi được: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
  }

  // Thu học phí theo phạm vi: dòng đơn vừa có học viên ⇒ xét cấp quyền học (vỏ KHÔNG NÉM, sau commit; cờ TẮT / đơn thường ⇒ no-op).
  await hichCapQuyenHocChoDon(orderId, "CHUYEN_DOI", new Date());

  // Báo QLCS có yêu cầu học vượt chờ duyệt (sau commit, không bao giờ ném).
  for (const c of kq.choDuyet) {
    await baoChoDuyetHocVuot({ ...c, maDon: duLieu.maDon, boQuaUserId: uid });
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/orders/${orderId}/chuyen-doi`);
  revalidatePath("/enrollments");
  revalidatePath("/hoc-bu/duyet-hoc-vuot");
  return { ok: true, soCon: kq.soCon, soPhieuHocBu: kq.soDongBu, soChoDuyet: kq.choDuyet.length };
}

// ── QUẢN TRỊ TỐI CAO ĐỔI BUỔI BẮT ĐẦU của ghi danh đã chuyển đổi ────────────────────────────────────────────────

const DoiBuoiSchema = z.object({
  orderId: z.string().min(1),
  enrollmentId: z.string().min(1),
  buoiBatDau: z.number().int().min(1),
  soBuoiBu: z.number().int().min(1).optional().nullable(),
  lyDo: z.string().trim().min(10, "Ghi lý do ít nhất 10 ký tự").max(500),
});

export type KetQuaDoiBuoi = { ok: true; buoiBatDau: number; canBu: number } | { ok: false; error: string };

export async function doiBuoiBatDauAction(input: unknown): Promise<KetQuaDoiBuoi> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Chưa đăng nhập" };
  // CHỈ Quản trị tối cao [chốt 27/10/2026: "admin sẽ chỉnh được"]. `enrollments:override-progress` là quyền sẵn có của riêng vai đó — không đẻ quyền mới.
  if (!(await checkPermission("enrollments:override-progress"))) {
    return { ok: false, error: "Chỉ Quản trị tối cao đổi được buổi bắt đầu của học viên" };
  }
  const parsed = DoiBuoiSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ" };
  const { orderId, enrollmentId, buoiBatDau, soBuoiBu, lyDo } = parsed.data;

  const actor = await resolveActor(session.user.id);
  const don = await scopedDb(actor).order.findFirst({ where: { id: orderId, deletedAt: null }, select: { id: true } });
  if (!don) return { ok: false, error: "Không tìm thấy đơn" };
  const { actorId, actorName } = getAuditActor(session);
  let kq;
  try {
    kq = await doiBuoiBatDauCuaDon(
      { orderId, enrollmentId, buoiBatDauMoi: buoiBatDau, soBuoiBu: soBuoiBu ?? null, lyDo },
      { id: actorId, name: actorName },
      new Date(),
    );
  } catch (e) {
    return { ok: false, error: `Không đổi được: ${e instanceof Error ? e.message : "lỗi không rõ"}` };
  }
  if (!kq.ok) return kq;

  revalidatePath(`/orders/${orderId}/chuyen-doi`);
  revalidatePath("/enrollments");
  revalidatePath("/hoc-bu");
  return kq;
}
