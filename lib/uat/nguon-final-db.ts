// lib/uat/nguon-final-db.ts — BỘ NẠP "UAT SOURCE FINAL" (lane C2 · mục 7): lead mới đã quy nguồn · nguồn tuỳ biến · hai hàng chờ do ENGINE THẬT sinh ra · kiểm ba tài khoản. Dữ liệu: `nguon-final.ts`.
//
// CHỈ chạy trên DB UAT: cổng chặn ở `cong-db-uat.ts`, do script gọi TRƯỚC khi vào đây (cùng lượt với `napDuLieuHoaHongUat`). Hàm này tin `db` đã qua cổng.
//
// Dựng bằng HÀM GHI THẬT của repo (luật 9 — cổng phải được cho ăn bằng thứ đường thật cho nó ăn):
//   · quy nguồn: `chuanBiQuyNguon` + `ghiQuyNguonLeadMoi` (cùng đường form nhập khách dùng) — lưới `[QN-W1]`/`[QN-W2]`: lời gọi tạo lead (`lead` + `create`) và `ghiQuyNguonLeadMoi(` nằm CÙNG hàm, cùng transaction;
//   · nguồn tuỳ biến: `taoNguon` (có AuditLog, có cổng);
//   · khoản thu: `recordPayment` → `confirmPayment`; từ chối khoản thu: `rejectPayment`;
//   · SỔ HOA HỒNG: do `quetKhoan` (engine) ghi — KHÔNG có `commissionTransaction/commissionHold/...create` nào ở tệp này (lưới `[SRC-INT-56]`). Hàng chờ INPUT_DRIFT / PAYMENT_WITHDRAWN là thứ engine tự dựng
//     khi gặp đúng hiện trường: «người chốt đổi sau khi đã ghi sổ» và «khoản thu bị từ chối sau khi đã ghi sổ».
// KHÔNG xoá, KHÔNG TRUNCATE, KHÔNG sửa dữ liệu không mang tiền tố của bộ này. IDEMPOTENT: nhận ra "đã nạp" bằng SĐT giả của lead / mã đơn / ghi chú khoản thu. DRY-RUN (`apply = false`): chỉ ĐỌC.
//
// ⚠️ BƯỚC HÀNG CHỜ chạy ĐƯỢC chỉ khi engine hoa hồng đã BẬT, mốc cutover đã ĐẶT và có chính sách ACTIVE (đúng thứ checklist 09 bước 1–2 bảo người vận hành bật). Thiếu thì bước này báo THIEU kèm CÁCH SỬA
// và bỏ qua — nó KHÔNG BAO GIỜ tự bật cờ, tự đặt mốc, tự kích hoạt chính sách (workflow `seed-test-data.yml` cũng không có đường nào làm việc đó). Bật rồi thì bấm lại cùng nút: các mục khác báo DA_CO.
// ⚠️ Khi chạy, engine ghi dòng sổ + mở kỳ `T+3` (xem `kyCuaHangCho`) ⇒ từ lúc đó mốc cutover KHÔNG dời/gỡ được nữa (`coDongSoMoiTrongThang`). Đó là hành vi thật của engine, không phải của bộ nạp.
import type { CommissionHoldCode, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { confirmPayment, recordPayment, rejectPayment } from "@/lib/finance/payment";
import { dungBoiCanhQuet } from "@/lib/hoa-hong/boi-canh";
import { docMocCutover } from "@/lib/hoa-hong/cutover";
import { quetKhoan, type KetQuaQuetKhoan } from "@/lib/hoa-hong/quet-khoan";
import { taoNguon } from "@/lib/nguon/danh-muc-ghi";
import { laQuanLyNguonBat } from "@/lib/nguon/feature";
import { chuanBiQuyNguon, ghiQuyNguonLeadMoi, type DauVaoNoiDay } from "@/lib/nguon/noi-day";
import { KHONG_CO_TIN_HIEU_NGUON } from "@/lib/nguon/tin-hieu";

import { EMAIL_UAT } from "./kich-ban-hoa-hong";
import { napLeadCuNguonFinal } from "./nguon-final-lead-cu";
import {
  EMAIL_NGUON_FINAL,
  GIAI_TRINH_OTHER,
  HOC_PHI_NGUON_FINAL,
  ID_KHOA_NGUON_FINAL,
  ID_LOP_NGUON_FINAL,
  KHOA_XU_LY_HANG_CHO,
  KICH_BAN_HANG_CHO,
  LEAD_MOI,
  NGUON_TUY_BIEN,
  SLUG_KHOA_NGUON_FINAL,
  TIEN_TO_NGUON_FINAL,
  VAI_NGUON_FINAL,
  ghiChuKhoanHangCho,
  idHocVienHangCho,
  idHocVienPhGoc,
  kyCuaHangCho,
  maDonHangCho,
  ngayThuHangCho,
  phoneHangCho,
  phoneLeadMoi,
  phonePhGoc,
  tenLead,
  type KichBanHangCho,
  type MaLeadMoi,
  type MucNapNf,
} from "./nguon-final";

export type DauVaoNapNguonFinal = {
  apply: boolean;
  /** Đồng hồ của lượt nạp (luật 19): dùng cho audit, `bayGio` của quy nguồn, bối cảnh quét. BẮT BUỘC. */
  now: Date;
};

export type KetQuaNapNf = { muc: MucNapNf[]; /** Thứ cần có trước khi `--apply` nạp được PHẦN LEAD (rỗng = đủ). Phần hàng chờ thiếu điều kiện chỉ báo ở `muc`, không chặn. */ thieu: string[] };

const LY_DO = "Nạp dữ liệu UAT SOURCE FINAL (scripts/hoa-hong/uat-nap-du-lieu.ts)";
const NGAY_MS = 86_400_000;

type Nguoi = { id: string; email: string; name: string | null; employeeId: string | null };
type KhoaNguoiNf = "admin" | "sale1" | "sale2" | "sale3" | "saleho" | "phuhuynh" | "ketoan" | "marketing";
type BoNguoi = Record<KhoaNguoiNf, Nguoi>;
const KHOA_NGUOI_CAN: readonly KhoaNguoiNf[] = ["admin", "sale1", "sale2", "sale3", "saleho", "phuhuynh", "ketoan", "marketing"];

async function docNguoi(thieu: string[]): Promise<BoNguoi | null> {
  const emails = KHOA_NGUOI_CAN.map((k) => EMAIL_UAT[k]);
  const rows = await db.user.findMany({ where: { email: { in: emails }, deletedAt: null }, select: { id: true, email: true, name: true, employeeId: true } });
  const theoEmail = new Map(rows.map((r) => [r.email, r]));
  const ra = {} as BoNguoi;
  let du = true;
  for (const khoa of KHOA_NGUOI_CAN) {
    const r = theoEmail.get(EMAIL_UAT[khoa]);
    if (!r) {
      thieu.push(`tài khoản ${EMAIL_UAT[khoa]} (chạy \`pnpm db:seed:uat\` hoặc workflow seed UAT)`);
      du = false;
      continue;
    }
    ra[khoa] = { id: r.id, email: r.email ?? EMAIL_UAT[khoa], name: r.name, employeeId: r.employeeId };
  }
  if (du) {
    for (const khoa of ["marketing", "sale2"] as const) {
      if (!ra[khoa].employeeId) thieu.push(`tài khoản ${ra[khoa].email} chưa nối hồ sơ nhân sự (Employee) — cần để làm chủ nguồn / người giới thiệu`);
    }
  }
  return du ? ra : null;
}

type Nen = { centerId: string; orgUnitId: string };

async function idNhom(code: string): Promise<string> {
  const g = await db.leadSourceGroup.findUnique({ where: { code }, select: { id: true } });
  if (!g) throw new Error(`Thiếu nhóm nguồn ${code} trong danh mục — chạy migration/seed nguồn trước.`);
  return g.id;
}

const nguonChon = (groupId: string, giaiTrinh: string | null = null) => ({ groupId, employeeId: null, parentUserId: null, studentId: null, affiliateId: null, giaiTrinh });

/** Dòng tín hiệu nhập như form nhập khách dựng. Người gõ KHÔNG khai: ghi nguồn theo lựa chọn của fixture. */
async function dongNhap(ma: MaLeadMoi | "WALK_IN", nguoi: BoNguoi, nen: Nen, studentPhId: string | null, sdt: string, now: Date): Promise<DauVaoNoiDay> {
  const goc: DauVaoNoiDay = {
    bayGio: now,
    duongVao: "nhap-tay",
    conversionEntry: null,
    nhanKhai: null,
    laNhapExcel: false,
    sdtKhach: sdt, // SĐT thật của dòng nhập: quy nguồn dùng nó để kế thừa theo SĐT ([QN-W14])
    maNvNguoiNhap: null,
    nguoiNhapUserId: null,
    ...KHONG_CO_TIN_HIEU_NGUON,
    orgUnitId: nen.orgUnitId,
    centerId: nen.centerId,
  };
  switch (ma) {
    case "PARENT_REFERRAL":
      return { ...goc, phuHuynhGioiThieu: { parentUserId: nguoi.phuhuynh.id, studentId: studentPhId } };
    case "EMPLOYEE_REFERRAL":
      return { ...goc, nhanSuGioiThieuEmployeeId: nguoi.sale2.employeeId };
    case "PAID_ADS":
      return { ...goc, duongVao: "facebook", conversionEntry: "facebook", quangCao: { adId: "uatsf-ad", campaignId: "uatsf-camp", adsetId: null, campaignName: TIEN_TO_NGUON_FINAL, formId: null, fbclid: null, gclid: null } };
    case "TUY_BIEN":
      return { ...goc, nguonChon: nguonChon(await idNhom(NGUON_TUY_BIEN.code)) };
    case "OTHER":
      return { ...goc, nguonChon: nguonChon(await idNhom("OTHER"), GIAI_TRINH_OTHER) };
    case "WALK_IN":
      return { ...goc, nguonChon: nguonChon(await idNhom("WALK_IN")) };
  }
}

type NguonDaBat = Extract<Awaited<ReturnType<typeof chuanBiQuyNguon>>[number], { bat: true }>;

/** Quy nguồn chuẩn bị NGOÀI transaction (đọc DB), kiểm đã bật và không bị chặn. */
async function chuanBi(dong: DauVaoNoiDay): Promise<NguonDaBat> {
  const cb = (await chuanBiQuyNguon(db, [dong]))[0]!;
  if (!cb.bat) throw new Error(`Quy nguồn không bật${cb.loi ? `: ${cb.loi}` : ""} — bật công tắc tổng "Quản lý nguồn khách" ở Cấu hình vận hành (tab Khách hàng) trước khi nạp.`);
  if (cb.chanNhap) throw new Error(`Đường nhập chặn: ${cb.chanNhap}`);
  return cb;
}

/**
 * Tạo MỘT lead đã quy nguồn. Lời gọi tạo lead (`lead` + `create`) và `ghiQuyNguonLeadMoi(` nằm CÙNG hàm, cùng transaction (lưới `[QN-W1]`/`[QN-W2]`): lead không bao giờ ra đời mà thiếu nguồn.
 */
async function taoLeadDaQuyNguon(p: {
  tx: Prisma.TransactionClient;
  ten: string;
  phone: string;
  convertedById: string;
  adminId: string | null;
  centerId: string;
  tao: Date;
  cb: NguonDaBat;
}): Promise<string> {
  const lead = await p.tx.lead.create({
    data: { parentName: p.ten, phone: p.phone, status: "DA_DANG_KY", convertedById: p.convertedById, adminId: p.adminId, centerId: p.centerId, createdAt: p.tao, lastInboundAt: p.tao },
    select: { id: true },
  });
  // Ghim mốc ghi nhận về đồng hồ của lượt nạp (DB đặt giờ thật cho dòng mới; fixture mang ngày tuyệt đối do người gọi truyền).
  await ghiQuyNguonLeadMoi(p.tx, lead.id, { ...p.cb, duLieu: { ...p.cb.duLieu, attributedAt: p.tao } }, null);
  return lead.id;
}

// ── Nguồn tuỳ biến ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function napNguonTuyBien(i: DauVaoNapNguonFinal, nguoi: BoNguoi, ra: MucNapNf[]): Promise<void> {
  const co = await db.leadSourceGroup.findUnique({ where: { code: NGUON_TUY_BIEN.code }, select: { id: true } });
  if (co) return void ra.push({ nhom: "Nguồn tuỳ biến", ma: NGUON_TUY_BIEN.code, trangThai: "DA_CO" });
  if (!i.apply) return void ra.push({ nhom: "Nguồn tuỳ biến", ma: NGUON_TUY_BIEN.code, trangThai: "SE_TAO", ghiChu: `chủ nguồn = ${nguoi.marketing.email} · cửa sổ ${NGUON_TUY_BIEN.cuaSoNgay} ngày` });
  const t = await taoNguon({
    nguoi: { userId: nguoi.admin.id, ten: nguoi.admin.name ?? nguoi.admin.email },
    coQuyenKichHoat: true,
    vao: {
      code: NGUON_TUY_BIEN.code,
      name: NGUON_TUY_BIEN.ten,
      description: "Nguồn tuỳ biến của bộ UAT SOURCE FINAL — chứng minh nguồn do admin tạo đi hết chuỗi quy nguồn → hoa hồng mà không sửa mã.",
      sourceType: "PARTNER",
      referrerRequirement: "NONE",
      requiresNote: false,
      selectable: true,
      sortOrder: 910,
      trangThai: "ACTIVE",
      attributionWindowDays: NGUON_TUY_BIEN.cuaSoNgay,
      commissionEnabled: true,
      ownerOrgUnitId: null,
      ownerEmployeeId: nguoi.marketing.employeeId,
      effectiveFrom: null,
      effectiveTo: null,
    },
  });
  if (!t.ok) throw new Error(`Không tạo được nguồn tuỳ biến: ${t.truong}: ${t.loi}`);
  ra.push({ nhom: "Nguồn tuỳ biến", ma: NGUON_TUY_BIEN.code, trangThai: "DA_TAO" });
}

// ── Lead mới đã quy nguồn ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function napLeadMoi(i: DauVaoNapNguonFinal, nguoi: BoNguoi, nen: Nen, ra: MucNapNf[]): Promise<void> {
  for (const lm of LEAD_MOI) {
    const phone = phoneLeadMoi(lm.ma);
    const co = await db.lead.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
    if (co) {
      ra.push({ nhom: "Lead mới", ma: lm.ma, trangThai: "DA_CO", ghiChu: lm.tieuDe });
      continue;
    }
    if (!i.apply) {
      ra.push({ nhom: "Lead mới", ma: lm.ma, trangThai: "SE_TAO", ghiChu: lm.tieuDe });
      continue;
    }
    // Phụ huynh giới thiệu: lead gốc + học viên của phụ huynh, COMMIT TRƯỚC — quy nguồn tra Sale phụ trách PH qua Student.leadId → Lead.convertedById. Học viên là dấu "đã dựng".
    let studentPhId: string | null = null;
    if (lm.ma === "PARENT_REFERRAL") {
      const idHv = idHocVienPhGoc(lm.ma);
      studentPhId = idHv;
      if (!(await db.student.findUnique({ where: { id: idHv }, select: { id: true } }))) {
        const cbGoc = await chuanBi(await dongNhap("WALK_IN", nguoi, nen, null, phonePhGoc(lm.ma), i.now));
        const mocGoc = new Date(i.now.getTime() - 60 * NGAY_MS);
        await db.$transaction(async (tx) => {
          const leadGocId = await taoLeadDaQuyNguon({ tx, ten: tenLead(`${lm.ma} (lead gốc của phụ huynh)`), phone: phonePhGoc(lm.ma), convertedById: nguoi.sale3.id, adminId: null, centerId: nen.centerId, tao: mocGoc, cb: cbGoc });
          await tx.student.create({ data: { id: idHv, name: `Bé ${TIEN_TO_NGUON_FINAL} (con phụ huynh giới thiệu)`, centerId: nen.centerId, parentUserId: nguoi.phuhuynh.id, leadId: leadGocId } });
        });
      }
    }
    const cb = await chuanBi(await dongNhap(lm.ma, nguoi, nen, studentPhId, phone, i.now));
    await db.$transaction((tx) => taoLeadDaQuyNguon({ tx, ten: tenLead(lm.ma), phone, convertedById: nguoi.sale1.id, adminId: nguoi.saleho.id, centerId: nen.centerId, tao: i.now, cb }), { maxWait: 20_000, timeout: 60_000 });
    ra.push({ nhom: "Lead mới", ma: lm.ma, trangThai: "DA_TAO", ghiChu: lm.tieuDe });
  }
}

// ── Hàng chờ: engine thật ────────────────────────────────────────────────────────────────────────────────────────────────────────

type DonDung = { orderId: string; orderItemId: string; enrollmentId: string; leadId: string };

async function baoDamKhoaHoc(centerId: string): Promise<void> {
  if (!(await db.course.findUnique({ where: { id: ID_KHOA_NGUON_FINAL }, select: { id: true } }))) {
    await db.course.create({ data: { id: ID_KHOA_NGUON_FINAL, name: `${TIEN_TO_NGUON_FINAL} — Sata 3`, slug: SLUG_KHOA_NGUON_FINAL, totalSessions: 48 } });
  }
  if (!(await db.class.findUnique({ where: { id: ID_LOP_NGUON_FINAL }, select: { id: true } }))) {
    await db.class.create({ data: { id: ID_LOP_NGUON_FINAL, name: `${TIEN_TO_NGUON_FINAL} · lớp`, courseId: ID_KHOA_NGUON_FINAL, centerId } });
  }
}

async function timDon(ma: string): Promise<DonDung | null> {
  const don = await db.order.findUnique({ where: { code: ma }, select: { id: true, leadId: true, items: { select: { id: true, enrollmentId: true } } } });
  const it = don?.items[0];
  return don && it?.enrollmentId && don.leadId ? { orderId: don.id, orderItemId: it.id, enrollmentId: it.enrollmentId, leadId: don.leadId } : null;
}

async function dungDonHangCho(i: DauVaoNapNguonFinal, kb: KichBanHangCho, nguoi: BoNguoi, nen: Nen, kyCutover: string): Promise<DonDung> {
  await baoDamKhoaHoc(nen.centerId);
  const phone = phoneHangCho(kb.ma);
  const cb = await chuanBi(await dongNhap("WALK_IN", nguoi, nen, null, phone, i.now));
  const ngay = ngayThuHangCho(kyCutover, kb);
  return db.$transaction(
    async (tx) => {
      const leadId = await taoLeadDaQuyNguon({ tx, ten: tenLead(`hàng chờ ${kb.ma}`), phone, convertedById: nguoi.sale1.id, adminId: nguoi.saleho.id, centerId: nen.centerId, tao: i.now, cb });
      const student = await tx.student.create({ data: { id: idHocVienHangCho(kb.ma), name: `Bé ${TIEN_TO_NGUON_FINAL} ${kb.ma}`, centerId: nen.centerId, leadId, parentPhone: phone }, select: { id: true } });
      const ma = maDonHangCho(kb.ma);
      const gd = await tx.enrollment.create({
        data: { id: `${ma}-gd`, studentId: student.id, classId: ID_LOP_NGUON_FINAL, courseId: ID_KHOA_NGUON_FINAL, centerId: nen.centerId, status: "ACTIVE", createdAt: ngay },
        select: { id: true },
      });
      const don = await tx.order.create({
        data: { id: `${ma}-id`, code: ma, type: "COURSE", status: "CONFIRMED", customerName: `PH ${TIEN_TO_NGUON_FINAL}`, customerPhone: phone, totalAmount: HOC_PHI_NGUON_FINAL, centerId: nen.centerId, leadId, createdAt: ngay },
        select: { id: true },
      });
      const dong = await tx.orderItem.create({
        data: { id: `${ma}-oi`, orderId: don.id, type: "COURSE_ENROLLMENT", itemName: `Học phí ${TIEN_TO_NGUON_FINAL} ${kb.ma}`, quantity: 1, unitPrice: HOC_PHI_NGUON_FINAL, totalPrice: HOC_PHI_NGUON_FINAL, studentId: student.id, enrollmentId: gd.id, createdAt: ngay },
        select: { id: true },
      });
      return { orderId: don.id, orderItemId: dong.id, enrollmentId: gd.id, leadId };
    },
    { maxWait: 20_000, timeout: 60_000 },
  );
}

async function ghiKhoanThu(p: { kb: KichBanHangCho; don: DonDung; nguoi: BoNguoi; centerId: string; kyCutover: string }): Promise<string> {
  const ghiChu = ghiChuKhoanHangCho(p.kb.ma);
  const da = await db.payment.findFirst({ where: { note: ghiChu }, select: { id: true } });
  if (da) return da.id;
  const r = await recordPayment({ orderId: p.don.orderId, enrollmentId: p.don.enrollmentId, amount: p.kb.soTien, method: "cash", paidDate: ngayThuHangCho(p.kyCutover, p.kb), note: ghiChu, recordedById: p.nguoi.sale1.id, centerId: p.centerId });
  if (!r.ok) throw new Error(`recordPayment ${ghiChu}: ${r.error}`);
  await db.payment.update({ where: { id: r.paymentId }, data: { orderItemId: p.don.orderItemId } });
  const c = await confirmPayment({ paymentId: r.paymentId, confirmedById: p.nguoi.ketoan.id });
  if (!c.ok) throw new Error(`confirmPayment ${ghiChu}: ${c.error}`);
  return r.paymentId;
}

const daGhiSo = (r: KetQuaQuetKhoan): boolean => r.loai === "DA_GHI" || r.loai === "KHONG_DOI";
const moTaQuet = (r: KetQuaQuetKhoan): string => (r.loai === "GIU" ? `GIU (${r.hangCho.join(", ")})` : r.loai === "BO_QUA" ? `BO_QUA (${r.lyDo})` : r.loai);

/** Tìm hàng chờ của khoản theo mã — BẤT KỲ trạng thái nào (người nghiệm thu có thể đã xử lý; nạp lại không được dựng đôi). */
const timHold = (paymentId: string, code: CommissionHoldCode) => db.commissionHold.findFirst({ where: { paymentId, code }, select: { id: true, status: true } });

async function napHangCho(i: DauVaoNapNguonFinal, nguoi: BoNguoi, nen: Nen, ra: MucNapNf[]): Promise<void> {
  const nhom = "Hàng chờ";
  const ban = await dungBoiCanhQuet(db, i.now);
  const thieuDieuKien =
    ban.loai === "TAT"
      ? ban.lyDo === "ENGINE_TAT"
        ? "engine hoa hồng đang TẮT — bật cờ engine hoa hồng ở Cấu hình vận hành (checklist 09 bước 1) rồi bấm lại nút này"
        : "chưa đặt mốc cutover — đặt ở trang «Chuyển hoa hồng» (checklist 09 bước 1) rồi bấm lại nút này"
      : ban.bc.hoaHong.quyTac.length === 0
        ? "chưa có chính sách hoa hồng ACTIVE — kích hoạt chính sách chung (checklist 09 bước 2) rồi bấm lại nút này"
        : null;
  if (ban.loai === "TAT" || thieuDieuKien !== null) {
    for (const kb of KICH_BAN_HANG_CHO) ra.push({ nhom, ma: kb.maHold, trangThai: "THIEU", ghiChu: `${thieuDieuKien} — BỎ QUA, không tự bật gì` });
    return;
  }
  const bc = ban.bc;
  const kyCutover = bc.kyCutover;

  for (const kb of KICH_BAN_HANG_CHO) {
    const daCoDon = await timDon(maDonHangCho(kb.ma));
    const khoanDaCo = daCoDon ? await db.payment.findFirst({ where: { note: ghiChuKhoanHangCho(kb.ma) }, select: { id: true } }) : null;
    const holdDaCo = khoanDaCo ? await timHold(khoanDaCo.id, kb.maHold) : null;
    if (holdDaCo) {
      ra.push({ nhom, ma: kb.maHold, trangThai: "DA_CO", ghiChu: `trạng thái ${holdDaCo.status} · ${kb.tieuDe}` });
      continue;
    }
    if (!i.apply) {
      ra.push({ nhom, ma: kb.maHold, trangThai: "SE_TAO", ghiChu: `kỳ ${kyCuaHangCho(kyCutover)} · ${kb.tieuDe}` });
      continue;
    }
    const don = daCoDon ?? (await dungDonHangCho(i, kb, nguoi, nen, kyCutover));
    const paymentId = await ghiKhoanThu({ kb, don, nguoi, centerId: nen.centerId, kyCutover });

    // Lượt quét 1: engine GHI SỔ cho khoản thu (hoặc nhận ra đã ghi).
    const q1 = await quetKhoan(db, bc, paymentId);
    if (!daGhiSo(q1)) {
      ra.push({ nhom, ma: kb.maHold, trangThai: "THIEU", ghiChu: `engine chưa ghi sổ khoản thu (${moTaQuet(q1)}) — kiểm chính sách ACTIVE có quy tắc NEW cho vai SALE và người phụ trách CS1; không đổi gì thêm` });
      continue;
    }

    // Tạo hiện trường — hai thứ này là dữ liệu NGHIỆP VỤ của fixture, không phải sổ: người chốt đổi (dòng Lead của fixture) · kế toán từ chối khoản thu (hàm thật `rejectPayment`).
    if (kb.ma === "DRIFT") {
      const lead = await db.lead.findUniqueOrThrow({ where: { id: don.leadId }, select: { convertedById: true } });
      if (lead.convertedById === nguoi.sale1.id) await db.lead.update({ where: { id: don.leadId }, data: { convertedById: nguoi.sale3.id } });
    } else {
      const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { accountantStatus: true } });
      if (p.accountantStatus !== "REJECTED") {
        const r = await rejectPayment({ paymentId, confirmedById: nguoi.ketoan.id, reason: `${LY_DO}: từ chối khoản thu để engine dựng hàng chờ PAYMENT_WITHDRAWN` });
        if (!r.ok) throw new Error(`rejectPayment ${kb.ma}: ${r.error}`);
      }
    }

    // Lượt quét 2: engine tự dựng hàng chờ.
    const q2 = await quetKhoan(db, bc, paymentId);
    const hold = await timHold(paymentId, kb.maHold);
    if (hold) ra.push({ nhom, ma: kb.maHold, trangThai: "DA_TAO", ghiChu: `kỳ ${kyCuaHangCho(kyCutover)} · ${kb.tieuDe}` });
    else ra.push({ nhom, ma: kb.maHold, trangThai: "THIEU", ghiChu: `quét lần hai ra ${moTaQuet(q2)}, không có hàng chờ ${kb.maHold} — kiểm chính sách ACTIVE có quy tắc NEW cho vai SALE` });
  }
}

// ── Ba tài khoản (CHỈ KIỂM — tạo bằng nút `tai-khoan-thieu-ghi` / `db:seed:uat`, mật khẩu từ UAT_PASSWORD) ──────────────────────────────────

async function kiemTaiKhoan(ra: MucNapNf[]): Promise<void> {
  const cs1 = await db.orgUnit.findFirst({ where: { code: "CS1", deletedAt: null }, select: { id: true } });
  for (const [khoa, email] of Object.entries(EMAIL_NGUON_FINAL) as [keyof typeof EMAIL_NGUON_FINAL, string][]) {
    const u = await db.user.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
    const vai = u ? await db.userOrgRole.count({ where: { userId: u.id, status: "ACTIVE", orgUnitId: cs1?.id ?? "-", role: { code: VAI_NGUON_FINAL[khoa] } } }) : 0;
    if (!u) ra.push({ nhom: "Tài khoản", ma: email, trangThai: "THIEU", ghiChu: "chưa có — bấm nút `noi_hoc_vien_lead = tai-khoan-thieu-ghi` (cần secret UAT_PASSWORD)" });
    else if (vai === 0) ra.push({ nhom: "Tài khoản", ma: email, trangThai: "THIEU", ghiChu: `có tài khoản nhưng chưa có vai ${VAI_NGUON_FINAL[khoa]} neo ở CS1` });
    else ra.push({ nhom: "Tài khoản", ma: email, trangThai: "DA_CO", ghiChu: `${VAI_NGUON_FINAL[khoa]} @CS1${khoa === "xem" ? " (chỉ xem)" : ` (giữ ${KHOA_XU_LY_HANG_CHO} tại CS1)`}` });
  }
}

// ── Điểm vào ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function napNguonFinalUat(i: DauVaoNapNguonFinal): Promise<KetQuaNapNf> {
  const ra: MucNapNf[] = [];
  const thieu: string[] = [];

  const nguoi = await docNguoi(thieu);
  const cs1 = await db.center.findFirst({ where: { code: "CS1" }, select: { id: true } });
  const dv = await db.orgUnit.findFirst({ where: { code: "CS1", deletedAt: null }, select: { id: true } });
  if (!cs1 || !dv) thieu.push("cơ sở CS1 (chạy `pnpm db:seed:orgunit`)");
  const nhomGoc = await db.leadSourceGroup.count({ where: { code: { in: ["PAID_ADS", "PARENT_REFERRAL", "EMPLOYEE_REFERRAL", "WALK_IN", "OTHER", "UNKNOWN"] } } });
  if (nhomGoc < 6) thieu.push("danh mục nguồn gốc (migration 20261014090000)");
  if ((await db.beneficiaryRole.count()) < 10) thieu.push("danh mục vai hưởng hoa hồng (migration 20261014100000)");
  if (!(await laQuanLyNguonBat())) thieu.push('công tắc "Quản lý nguồn khách" đang TẮT — bật ở Cấu hình vận hành → tab Khách hàng');

  await kiemTaiKhoan(ra);

  if (thieu.length > 0 || nguoi === null || !cs1 || !dv) {
    for (const t of thieu) ra.push({ nhom: "Điều kiện tiên quyết", ma: t, trangThai: "THIEU" });
    if (i.apply) throw new Error(`Chưa đủ điều kiện để nạp UAT SOURCE FINAL:\n  - ${thieu.join("\n  - ")}`);
    return { muc: ra, thieu };
  }
  const nen: Nen = { centerId: cs1.id, orgUnitId: dv.id };

  await napNguonTuyBien(i, nguoi, ra);
  await napLeadMoi(i, nguoi, nen, ra);
  // Lead nhãn cũ (chưa quy nguồn) là mồi cho lượt «Vét lead cũ» — làm TRƯỚC khi đặt mốc cutover (checklist 09 bước 16–17). Mốc đã đặt rồi thì vét lead cũ đã xong: thêm lead chưa quy nguồn lúc này
  // là sai trình tự (và làm trang «Chuyển hoa hồng» báo DI_TRU_CHUA_SAN_SANG ở lần đổi mốc sau) ⇒ chỉ ghi nhận cái đã có, không tạo mới.
  const mocDaDat = (await docMocCutover(db)) !== null;
  const leadCu = await napLeadCuNguonFinal({ apply: i.apply && !mocDaDat, centerId: nen.centerId });
  ra.push(...leadCu.map((m) => (mocDaDat && m.trangThai === "SE_TAO" ? { ...m, trangThai: "BO_QUA" as const, ghiChu: "mốc cutover đã đặt — không tạo lead chưa quy nguồn sau bước vét lead cũ" } : m)));
  await napHangCho(i, nguoi, nen, ra);
  return { muc: ra, thieu };
}
