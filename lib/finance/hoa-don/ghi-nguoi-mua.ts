// lib/finance/hoa-don/ghi-nguoi-mua.ts — ĐỌC hồ sơ để điền sẵn + GHI khối "Người mua trên hoá đơn"
// (8 ô) lên đơn VÀ sang hồ sơ học viên / phiếu lead trong CÙNG một transaction. 01/11/2026.
// Luật thuần + giải thích: `form-nguoi-mua.ts`. Đọc file đó trước.
//
// Vì sao ở `lib/` chứ không ở `_actions.ts`: đồng bộ sang Student/Lead/LeadChild phải dùng client
// KHÔNG scope (`db.$transaction`) — qua `scopedDb` thì phiếu lead / anh chị em ở cơ sở khác bị bỏ qua
// IM LẶNG (xem đầu `lib/students/dong-bo-lead-db.ts`). Quyền + tầm nhìn cơ sở kiểm ở action TRƯỚC khi
// gọi vào đây; riêng hồ sơ học viên (tìm ra TRONG transaction) được kiểm qua `choPhep.hocVien`.
//
// Hồ sơ đích của lượt ghi:
//   · có HỌC VIÊN (Order.studentId, hoặc Student nối `Order.leadChildId`) ⇒ ghi Student bằng
//     `ghiHoSoTrongTx`, nó tự dội sang phiếu lead + đứa con + anh chị em (và đổi tên ở 4 bản sao);
//   · chưa có học viên (đơn tạo trước khi chuyển đổi) ⇒ ghi thẳng Lead / LeadChild rồi dội sang các học
//     viên đang nối phiếu (nếu có) bằng đúng các hàm đồng bộ sẵn có;
//   · không có gì để nối ⇒ chỉ ghi đơn, và nói ra.

import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit-log";
import { logLeadAudit, logStudentAudit } from "@/lib/audit/log";
import { nationalPhone } from "@/lib/phone";
import { vnYmd } from "@/lib/time/vn";
import {
  CHON_CON_LEAD,
  CHON_PH_LEAD,
  chiOKhacDich,
  coO,
  conHvSangLead,
  phHvSangLead,
  type ConLead,
  type PhHocVien,
  type PhLead,
} from "@/lib/students/dong-bo-lead";
import { dongBoTuCon, dongBoTuLead } from "@/lib/students/dong-bo-lead-db";
import { ghiHoSoTrongTx, SNAPSHOT_HO_SO, type AnhHoSo } from "@/lib/students/ghi-ho-so";
import { syncLeadChildNameToStudents } from "@/lib/students/sync-name";
import {
  COT_NHAY_CAM,
  FORM_TRONG,
  KHOA_FORM,
  NHAN_O,
  cotDonTuForm,
  formTuDon,
  hieuLuc,
  oCanDayVaoHoSo,
  sach,
  vaChamTuForm,
  type CotDon,
  type DonChoForm,
  type FormNguoiMua,
  type KhoaForm,
} from "./form-nguoi-mua";
import { canhBaoSuaNguoiMua, type CotNguoiMua, type HoaDonConHieuLuc } from "./canh-bao-sua-nguoi-mua";
import { docMaPhuHuynh, khoaSdtPhuHuynh, layHoacCapMaPhuHuynh } from "./ma-phu-huynh";

type Tx = Prisma.TransactionClient;
type Client = Pick<Tx, "student" | "lead" | "leadChild" | "maPhuHuynh">;

/** Cột `Order` cần để dựng form (+ khoá nối sang hồ sơ). */
export const CHON_DON_CHO_FORM = {
  invoiceStudentName: true,
  invoiceStudentDob: true,
  invoiceStudentCccd: true,
  /** Các em còn lại của đơn nhiều con (JSON) — cho biểu mẫu QR điền sẵn / hợp nhất. */
  invoiceHocVienThem: true,
  customerAddress: true,
  customerWard: true,
  customerCity: true,
  invoiceBuyerName: true,
  customerName: true,
  invoiceParentPhone: true,
  customerPhone: true,
  customerCccd: true,
  invoiceEmail: true,
  customerEmail: true,
  invoiceCompanyName: true,
  invoiceTaxCode: true,
  invoiceCustomerCode: true,
  studentId: true,
  leadId: true,
  leadChildId: true,
  centerId: true,
  orgUnitId: true,
} as const;

export type DonNoiHoSo = DonChoForm & {
  /** Cơ sở của đơn + đơn vị tổ chức — khoá và nơi ghi của MÃ PHỤ HUYNH (`ma-phu-huynh.ts`). Tuỳ chọn để fixture cũ còn dựng được. */
  centerId?: string | null;
  orgUnitId?: string | null;
  studentId: string | null;
  leadId: string | null;
  leadChildId: string | null;
};

// ─── ĐỌC hồ sơ ───────────────────────────────────────────────────────────────────────────────

export type NoiGhiHoSo =
  | { kieu: "HOC_VIEN"; studentId: string }
  | { kieu: "LEAD"; leadId: string; leadChildId: string | null }
  | { kieu: "KHONG" };

export type HoSoDoc = {
  muc: NoiGhiHoSo;
  /** Bản TRỘN dùng để điền sẵn: học viên trước, phiếu lead sau. */
  hienThi: FormNguoiMua;
  /** Chỉ giá trị của CHÍNH nơi sẽ ghi — dùng để quyết định ô nào cần đẩy sang. */
  tuMuc: FormNguoiMua;
};

const ngay = (d: Date | null | undefined): string => (d ? vnYmd(d) : "");

/** Địa chỉ lead lưu SĐT dạng `84…`; hồ sơ + hoá đơn hiện dạng nội địa. */
const sdtHienThi = (v: string | null | undefined): string => nationalPhone(v) ?? sach(v);

/** Tìm học viên của đơn: `Order.studentId`, không thì Student nối `Order.leadChildId`. */
async function timHocVien(c: Client, don: Pick<DonNoiHoSo, "studentId" | "leadChildId">) {
  const chon = {
    id: true,
    ...SNAPSHOT_HO_SO,
    nationalId: true,
    parentNationalId: true,
    orgUnitId: true,
    deletedAt: true,
  } as const;
  if (don.studentId) {
    const s = await c.student.findUnique({ where: { id: don.studentId }, select: chon });
    if (s && !s.deletedAt) return s;
  }
  if (don.leadChildId) {
    return c.student.findFirst({
      where: { leadChildId: don.leadChildId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: chon,
    });
  }
  return null;
}
type HocVienDoc = NonNullable<Awaited<ReturnType<typeof timHocVien>>>;

function formTuHocVien(s: HocVienDoc): FormNguoiMua {
  return {
    ...FORM_TRONG,
    hocVienTen: sach(s.name),
    hocVienNgaySinh: ngay(s.dateOfBirth),
    hocVienCccd: sach(s.nationalId),
    tinh: sach(s.city),
    phuong: sach(s.ward),
    diaChi: sach(s.address),
    phuHuynhTen: sach(s.parentName),
    phuHuynhSdt: sach(s.parentPhone),
    phuHuynhCccd: sach(s.parentNationalId),
    phuHuynhEmail: sach(s.parentEmail),
    // Ô «Mã khách hàng» KHÔNG còn lấy mã học viên (08/11/2026): một đơn hai con thì hoá đơn vẫn chỉ có MỘT người mua. Điền sẵn bằng MÃ PHỤ HUYNH
    // (`docHoSoNguoiMua` tra theo cơ sở + SĐT ba/mẹ).
  };
}

function formTuLead(
  lead: (PhLead & { id: string }) | null,
  con: { fullName: string; dob: Date | null } | null,
): FormNguoiMua {
  return {
    ...FORM_TRONG,
    hocVienTen: sach(con?.fullName),
    hocVienNgaySinh: ngay(con?.dob),
    tinh: sach(lead?.city),
    phuong: sach(lead?.ward),
    diaChi: sach(lead?.addressLine),
    phuHuynhTen: sach(lead?.parentName),
    phuHuynhSdt: lead ? sdtHienThi(lead.phone) : "",
    phuHuynhEmail: sach(lead?.email),
  };
}

/** Trộn: ô nào `chinh` trống thì lấy của `phu`; khối địa chỉ lấy nguyên khối. */
function tron(chinh: FormNguoiMua, phu: FormNguoiMua): FormNguoiMua {
  const ra = { ...chinh };
  const chinhCoDiaChi = sach(chinh.tinh) !== "" || sach(chinh.phuong) !== "" || sach(chinh.diaChi) !== "";
  for (const k of KHOA_FORM) {
    if (k === "tinh" || k === "phuong" || k === "diaChi") {
      if (!chinhCoDiaChi) ra[k] = phu[k];
    } else if (sach(ra[k]) === "") ra[k] = phu[k];
  }
  return ra;
}

export async function docHoSoNguoiMua(
  client: Client,
  don: Pick<DonNoiHoSo, "studentId" | "leadId" | "leadChildId" | "centerId" | "invoiceParentPhone" | "customerPhone">,
): Promise<HoSoDoc> {
  const hocVien = await timHocVien(client, don);
  const leadId = don.leadId ?? hocVien?.leadId ?? null;
  const leadChildId = don.leadChildId ?? hocVien?.leadChildId ?? null;
  const [lead, con] = await Promise.all([
    leadId
      ? client.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, ...CHON_PH_LEAD } })
      : Promise.resolve(null),
    leadChildId
      ? client.leadChild.findUnique({ where: { id: leadChildId }, select: { fullName: true, dob: true } })
      : Promise.resolve(null),
  ]);
  const tuLead = formTuLead(lead, con);
  /** Điền ô «Mã khách hàng» bằng mã phụ huynh ĐÃ CẤP (chỉ đọc — chưa cấp thì để trống, mã sinh lúc Lưu). */
  const kemMa = async (f: FormNguoiMua): Promise<FormNguoiMua> => {
    const ma = await docMaPhuHuynh(client, {
      centerId: don.centerId,
      // Cùng thứ tự với giá trị HIỆU LỰC của ô SĐT ba/mẹ (đơn trước, hồ sơ sau) — khác đi là điền sẵn mã của một phụ huynh, lưu lại cấp mã của người khác.
      soDienThoai: khoaSdtPhuHuynh(don.invoiceParentPhone, don.customerPhone, f.phuHuynhSdt),
    });
    return ma ? { ...f, maKhachHang: ma } : f;
  };
  if (hocVien) {
    const tuHv = formTuHocVien(hocVien);
    return { muc: { kieu: "HOC_VIEN", studentId: hocVien.id }, hienThi: await kemMa(tron(tuHv, tuLead)), tuMuc: tuHv };
  }
  if (lead) {
    return {
      muc: { kieu: "LEAD", leadId: lead.id, leadChildId: con ? leadChildId : null },
      hienThi: await kemMa(tuLead),
      tuMuc: tuLead,
    };
  }
  return { muc: { kieu: "KHONG" }, hienThi: await kemMa(FORM_TRONG), tuMuc: FORM_TRONG };
}

/**
 * Dữ liệu cho màn hình: giá trị HIỆU LỰC (đơn trước, hồ sơ sau) + giá trị đang có ở hồ sơ + nơi sẽ ghi.
 * Đúng hình dạng tham số thứ ba của `khoiNguoiMuaHoaDon`.
 */
export async function docHieuLucNguoiMua(client: Client, don: DonNoiHoSo) {
  const hoSo = await docHoSoNguoiMua(client, don);
  return { hieuLuc: hieuLuc(don, hoSo.hienThi), hoSo: hoSo.hienThi, noiGhi: hoSo.muc.kieu };
}

/**
 * Bản dành cho trang RSC: client KHÔNG scope, vì đây là đọc hồ sơ của CHÍNH đơn đang xem (đơn đã qua
 * cổng quyền + cơ sở của trang), không phải một lượt tra theo quyền. Giá trị chỉ rời server sau khi
 * `khoiNguoiMuaHoaDon` che theo `orders:view-pii`.
 */
export function docHieuLucNguoiMuaTuDb(don: DonNoiHoSo) {
  return docHieuLucNguoiMua(db as unknown as Client, don);
}

// ─── GHI ─────────────────────────────────────────────────────────────────────────────────────

export type QuyenGhiHoSo = {
  /** `students:edit` — ghi sang hồ sơ học viên / phiếu lead. */
  suaHoSo: boolean;
  /** `payments:view-pii` — cổng sẵn có của CCCD trên hồ sơ học viên. */
  cccdHoSo: boolean;
  /** Học viên (tìm trong transaction) có nằm trong tầm nhìn cơ sở của người sửa không. */
  hocVienTrongTam: (s: { id: string; centerId: string | null; orgUnitId: string | null }) => boolean;
};

export type KetQuaDongBo = {
  muc: NoiGhiHoSo["kieu"];
  /** Ô đã ghi sang hồ sơ. */
  daGhi: KhoaForm[];
  /** Ô KHÔNG ghi được sang hồ sơ + vì sao (để màn nói thật, không im lặng). */
  boQua: { khoa: KhoaForm; lyDo: string }[];
};

export type KetQuaGhiNguoiMua =
  | { stale: true }
  | { stale: false; doi: CotNguoiMua[]; con: HoaDonConHieuLuc[]; canhBao: string | null; dongBo: KetQuaDongBo };

const KHOA_CCCD: readonly KhoaForm[] = ["hocVienCccd", "phuHuynhCccd"];

function ganBoQua(ds: readonly KhoaForm[], lyDo: string) {
  return ds.map((khoa) => ({ khoa, lyDo }));
}

export async function ghiNguoiMuaHoaDon(input: {
  orderId: string;
  expectedUpdatedAt: Date;
  /** Form người dùng gửi. */
  form: FormNguoiMua;
  /** Form lúc MỞ hộp thoại — để biết ô nào người dùng thật sự SỬA. */
  banDau: FormNguoiMua;
  actor: { id: string | null; name: string };
  quyen: QuyenGhiHoSo;
  /**
   * Ô «Mã khách hàng» sửa tay được hay không — CHỈ Quản trị tối cao (chủ dự án 08/11/2026). BẮT BUỘC (luật 7). `false` ⇒ giá trị client gửi cho ô này
   * bị BỎ QUA hoàn toàn: giữ mã đã có trên đơn, đơn chưa có thì hệ thống cấp mã phụ huynh. Ẩn/khoá ô ở giao diện không phải là kiểm quyền.
   */
  suaMaKhachHang: boolean;
}): Promise<KetQuaGhiNguoiMua> {
  const { orderId, banDau, actor, quyen } = input;

  return db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Tx;
    // Giá trị CŨ đọc TRONG transaction (không lấy từ client). Hoá đơn đọc LỒNG dưới Order.
    const cu = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        updatedAt: true,
        ...CHON_DON_CHO_FORM,
        hoaDonDienTu: {
          where: { trangThai: { in: ["NHAP", "DA_XAC_NHAN"] } },
          select: { id: true, trangThai: true, kyHieu: true, soHoaDon: true },
        },
      },
    });
    if (!cu || cu.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return { stale: true as const };

    // ── 0. Mã khách hàng ────────────────────────────────────────────────────────────────────
    // Quản trị tối cao gõ mã ⇒ lấy mã đó. Còn lại: giữ mã ĐÃ CÓ trên đơn; đơn chưa có ⇒ cấp mã PHỤ HUYNH (cùng cơ sở + cùng SĐT ba/mẹ ⇒ cùng mã).
    // Không có SĐT ⇒ để trống (không bịa khoá khác). Chạy TRONG transaction này nên mã và đơn cùng commit hoặc cùng huỷ.
    const maDangCo = sach(cu.invoiceCustomerCode);
    const maGo = sach(input.form.maKhachHang);
    let maCuoi: string;
    if (input.suaMaKhachHang && maGo !== "") maCuoi = maGo;
    else if (maDangCo !== "") maCuoi = maDangCo;
    else {
      maCuoi =
        (await layHoacCapMaPhuHuynh(tx, {
          centerId: cu.centerId,
          orgUnitId: cu.orgUnitId,
          soDienThoai: khoaSdtPhuHuynh(input.form.phuHuynhSdt, cu.invoiceParentPhone, cu.customerPhone),
        })) ?? "";
    }
    const form: FormNguoiMua = { ...input.form, maKhachHang: maCuoi };
    const moi = cotDonTuForm(form);

    // ── 1. Đơn ──────────────────────────────────────────────────────────────────────────────
    const cotDoi = (Object.keys(moi) as CotDon[]).filter((k) => {
      const a = cu[k];
      const b = moi[k];
      if (a instanceof Date || b instanceof Date) {
        return (a instanceof Date ? vnYmd(a) : null) !== (b instanceof Date ? vnYmd(b) : null);
      }
      return (a ?? null) !== (b ?? null);
    });
    if (cotDoi.length > 0) {
      const upd = await tx.order.updateMany({ where: { id: orderId, updatedAt: cu.updatedAt }, data: moi });
      // Ghi có điều kiện đổi 0 dòng ⇒ commit vô hại (mẫu chống-đua FIX-H9).
      if (upd.count === 0) return { stale: true as const };
    }

    // Câu cảnh báo "tờ hoá đơn đã có không tự đổi" chỉ tính ô ĐỔI NGHĨA trên tờ (null → đúng tên khách
    // đặt đơn là KHÔNG đổi gì trên tờ giấy).
    const truoc = formTuDon(cu);
    const sau = Object.fromEntries(KHOA_FORM.map((k) => [k, sach(form[k])])) as FormNguoiMua;
    const doiTrenTo: CotNguoiMua[] = [];
    if (truoc.phuHuynhTen !== sau.phuHuynhTen) doiTrenTo.push("invoiceBuyerName");
    if (truoc.donViTen !== sau.donViTen) doiTrenTo.push("invoiceCompanyName");
    if (truoc.donViMst !== sau.donViMst) doiTrenTo.push("invoiceTaxCode");
    if (truoc.phuHuynhEmail !== sau.phuHuynhEmail) doiTrenTo.push("invoiceEmail");
    if (truoc.diaChi !== sau.diaChi || truoc.phuong !== sau.phuong || truoc.tinh !== sau.tinh) {
      doiTrenTo.push("customerAddress");
    }
    if (truoc.phuHuynhCccd !== sau.phuHuynhCccd) doiTrenTo.push("customerCccd");
    if (truoc.maKhachHang !== sau.maKhachHang) doiTrenTo.push("invoiceCustomerCode");

    if (cotDoi.length > 0) {
      const thuong = cotDoi.filter((k) => !COT_NHAY_CAM.has(k));
      await writeAudit({
        tx,
        actor: { id: actor.id, name: actor.name },
        module: "orders",
        entityType: "Order",
        entityId: orderId,
        action: "SUA_THONG_TIN_HOA_DON",
        // Giấy tờ tùy thân: chỉ ghi TÊN cột đã đổi, không ghi giá trị (vết không được thành kho CCCD thứ hai).
        oldValues: Object.fromEntries(thuong.map((k) => [k, vnGiaTri(cu[k])])),
        newValues: {
          ...Object.fromEntries(thuong.map((k) => [k, vnGiaTri(moi[k])])),
          ...(cu.hoaDonDienTu.length > 0
            ? {
                hoaDonConHieuLuc: cu.hoaDonDienTu.map((h) => ({
                  id: h.id,
                  trangThai: h.trangThai,
                  so: [h.kyHieu, h.soHoaDon].filter(Boolean).join("-") || null,
                })),
              }
            : {}),
        },
        changedFields: [...cotDoi],
        orgUnitId: cu.centerId,
      });
    }

    // ── 2. Hồ sơ ────────────────────────────────────────────────────────────────────────────
    const dongBo = await dayVaoHoSo({ tx, cu, form, banDau, actor, quyen });

    return {
      stale: false as const,
      doi: doiTrenTo,
      con: cu.hoaDonDienTu,
      canhBao: canhBaoSuaNguoiMua({ doi: doiTrenTo, con: cu.hoaDonDienTu, emailMoi: sach(form.phuHuynhEmail) || null }),
      dongBo,
    };
  });
}

/**
 * Đơn VỪA TẠO có khai ba ô học viên (tên · ngày sinh · CCCD) ⇒ điền chúng sang hồ sơ — nhưng CHỈ vào
 * những ô hồ sơ đang TRỐNG (luật «ô đã có thì không bắt nhập lại, và không đè»): `banDau = form` nên
 * không ô nào được tính là «vừa sửa». Khác `ghiNguoiMuaHoaDon`: không ghi gì lên đơn (form tạo đơn đã ghi
 * cột `invoiceStudent*` trong giao dịch tạo đơn) và chỉ đụng ba ô học viên — các ô phụ huynh của form tạo
 * đơn xưa nay KHÔNG đẩy sang hồ sơ, đổi điều đó là đổi hành vi ngoài phạm vi.
 * Chạy SAU khi đơn đã commit và là việc phụ: lỗi ở đây không được cuộn lại đơn (bên gọi bắt và báo).
 */
export async function dongBoHocVienTuDonMoi(input: {
  orderId: string;
  actor: { id: string | null; name: string };
  quyen: QuyenGhiHoSo;
}): Promise<KetQuaDongBo> {
  return db.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Tx;
    const don = await tx.order.findUnique({ where: { id: input.orderId }, select: CHON_DON_CHO_FORM });
    if (!don) return { muc: "KHONG" as const, daGhi: [], boQua: [] };
    const tu = formTuDon(don);
    const form: FormNguoiMua = {
      ...FORM_TRONG,
      hocVienTen: tu.hocVienTen,
      hocVienNgaySinh: tu.hocVienNgaySinh,
      hocVienCccd: tu.hocVienCccd,
    };
    return dayVaoHoSo({ tx, cu: don, form, banDau: form, actor: input.actor, quyen: input.quyen });
  });
}

function vnGiaTri(v: unknown): unknown {
  return v instanceof Date ? vnYmd(v) : (v ?? null);
}

async function dayVaoHoSo(a: {
  tx: Tx;
  cu: DonNoiHoSo;
  form: FormNguoiMua;
  banDau: FormNguoiMua;
  actor: { id: string | null; name: string };
  quyen: QuyenGhiHoSo;
}): Promise<KetQuaDongBo> {
  const { tx, cu, form, banDau, actor, quyen } = a;
  const hoSo = await docHoSoNguoiMua(tx, cu);
  const muc = hoSo.muc.kieu;
  const trong: KetQuaDongBo = { muc, daGhi: [], boQua: [] };

  const canDay = oCanDayVaoHoSo(form, banDau, hoSo.tuMuc);
  if (canDay.length === 0) return trong;
  if (!quyen.suaHoSo) {
    return { ...trong, boQua: ganBoQua(canDay, "Thiếu quyền sửa hồ sơ học viên — mới lưu trên đơn") };
  }
  if (hoSo.muc.kieu === "KHONG") {
    return { ...trong, boQua: ganBoQua(canDay, "Đơn chưa nối với học viên hay phiếu lead nào — mới lưu trên đơn") };
  }

  // Cổng CCCD của hồ sơ học viên (`payments:view-pii`) — cùng cổng với màn sửa học viên.
  const boQua: KetQuaDongBo["boQua"] = [];
  let ds = canDay;
  if (!quyen.cccdHoSo) {
    boQua.push(...ganBoQua(canDay.filter((k) => KHOA_CCCD.includes(k)), "Thiếu quyền ghi CCCD vào hồ sơ — mới lưu trên đơn"));
    ds = canDay.filter((k) => !KHOA_CCCD.includes(k));
  }

  if (hoSo.muc.kieu === "HOC_VIEN") {
    const hv = await timHocVien(tx, cu);
    if (!hv) return { ...trong, boQua };
    if (!quyen.hocVienTrongTam({ id: hv.id, centerId: hv.centerId, orgUnitId: hv.orgUnitId })) {
      return { ...trong, boQua: [...boQua, ...ganBoQua(ds, "Học viên thuộc cơ sở ngoài tầm nhìn của bạn — mới lưu trên đơn")] };
    }
    const va = vaChamTuForm(form, ds);
    const data: Prisma.StudentUpdateInput = { ...va };
    if (Object.keys(data).length === 0) return { ...trong, boQua };
    const truocAnh = Object.fromEntries(Object.keys(SNAPSHOT_HO_SO).map((k) => [k, hv[k as keyof typeof hv]])) as unknown as AnhHoSo;
    await ghiHoSoTrongTx({ tx, studentId: hv.id, data, truoc: truocAnh, actor });
    // CCCD không nằm trong ảnh chụp nhật ký (không để PII vào vết) ⇒ ghi một dòng riêng chỉ có TÊN ô.
    const cccdDoi = (["nationalId", "parentNationalId"] as const).filter((k) => va[k] !== undefined && va[k] !== hv[k]);
    if (cccdDoi.length > 0) {
      await logStudentAudit({
        studentId: hv.id,
        action: "UPDATE",
        actorId: actor.id,
        actorName: actor.name,
        changedFields: [...cccdDoi],
        reason: "Đồng bộ CCCD theo khối người mua trên hoá đơn của đơn hàng (giá trị không ghi vào vết)",
        tx,
      });
    }
    return { muc, daGhi: ds, boQua };
  }

  // Chưa có học viên: ghi thẳng phiếu lead / đứa con rồi dội sang học viên đang nối phiếu (nếu có).
  const va = vaChamTuForm(form, ds);
  const khongLuuDuoc = ds.filter((k) => KHOA_CCCD.includes(k));
  boQua.push(...ganBoQua(khongLuuDuoc, "Chưa có hồ sơ học viên để lưu CCCD — mới lưu trên đơn"));
  const dsLead = ds.filter((k) => !KHOA_CCCD.includes(k));
  const daGhi: KhoaForm[] = [];

  const { leadId, leadChildId } = hoSo.muc;
  const phHv: Partial<PhHocVien> = {};
  if (va.parentName !== undefined) phHv.parentName = va.parentName;
  if (va.parentPhone !== undefined) phHv.parentPhone = va.parentPhone;
  if (va.parentEmail !== undefined) phHv.parentEmail = va.parentEmail || null;
  if ("city" in va) phHv.city = va.city ?? null;
  if ("ward" in va) phHv.ward = va.ward ?? null;
  if ("address" in va) phHv.address = va.address ?? null;
  if (coO(phHv)) {
    const lead = await tx.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: CHON_PH_LEAD });
    if (lead) {
      const p = chiOKhacDich(lead as PhLead, phHvSangLead(phHv));
      if (coO(p)) {
        await tx.lead.update({ where: { id: leadId }, data: p });
        await logLeadAudit({
          leadId,
          action: "UPDATE",
          actorId: actor.id,
          actorName: actor.name,
          oldValues: Object.fromEntries(Object.keys(p).map((k) => [k, (lead as Record<string, unknown>)[k]])),
          newValues: { ...p },
          changedFields: Object.keys(p),
          reason: "Đồng bộ theo khối người mua trên hoá đơn của đơn hàng",
          tx,
        });
        await dongBoTuLead({ tx, leadId, truoc: lead as PhLead, sau: p, actor });
      }
    }
  }

  if (leadChildId) {
    const con = await tx.leadChild.findUnique({
      where: { id: leadChildId },
      select: { leadId: true, fullName: true, ...CHON_CON_LEAD },
    });
    if (con) {
      const { leadId: leadCuaCon, fullName, ...phanCon } = con;
      if (va.dateOfBirth !== undefined) {
        const p = chiOKhacDich(phanCon as ConLead, conHvSangLead({ dateOfBirth: va.dateOfBirth }));
        if (coO(p)) {
          await tx.leadChild.update({ where: { id: leadChildId }, data: p });
          await logLeadAudit({
            leadId: leadCuaCon,
            action: "UPDATE",
            actorId: actor.id,
            actorName: actor.name,
            oldValues: { leadChildId, ...Object.fromEntries(Object.keys(p).map((k) => [k, (phanCon as Record<string, unknown>)[k]])) },
            newValues: { leadChildId, ...p },
            changedFields: ["children", ...Object.keys(p)],
            reason: "Đồng bộ theo khối người mua trên hoá đơn của đơn hàng",
            tx,
          });
          await dongBoTuCon({ tx, leadChildId, truoc: phanCon as ConLead, sau: p, actor });
        }
      }
      if (va.name !== undefined && va.name !== fullName) {
        await tx.leadChild.update({ where: { id: leadChildId }, data: { fullName: va.name } });
        // Mirror phẳng `Lead.childName` — CHỈ khi đang mang đúng tên cũ (lead nhiều con có thể mang tên đứa khác).
        await tx.lead.updateMany({
          where: { id: leadCuaCon, childName: { equals: fullName, mode: "insensitive" } },
          data: { childName: va.name },
        });
        await logLeadAudit({
          leadId: leadCuaCon,
          action: "UPDATE",
          actorId: actor.id,
          actorName: actor.name,
          oldValues: { leadChildId, fullName },
          newValues: { leadChildId, fullName: va.name },
          changedFields: ["children", "fullName"],
          reason: "Đồng bộ tên theo khối người mua trên hoá đơn của đơn hàng",
          tx,
        });
        await syncLeadChildNameToStudents({ tx, leadChildId, oldName: fullName, newName: va.name, actor });
      }
    }
  }

  daGhi.push(...dsLead);
  return { muc, daGhi, boQua };
}

/** Nhãn người đọc cho một ô — màn dùng để nói "chưa ghi được sang hồ sơ: …". */
export function nhanO(k: KhoaForm): string {
  return NHAN_O[k];
}
