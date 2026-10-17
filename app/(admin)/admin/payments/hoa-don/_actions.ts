"use server";

// Màn kế toán Hoá đơn điện tử — server action (docs/ke-toan-hoa-don/PLAN.md §4, §6).
//
// GĐ 3: TẢI TỆP LÊN HAI BƯỚC — (1) ký URL PUT vào bucket riêng, trình duyệt PUT thẳng R2; (2) xác
// minh tệp (cỡ thật, vân tay, sha256).
// GĐ 4: ghi BẢNG HOÁ ĐƠN — lưu nháp (④) · không xuất · sửa nháp · gỡ. KHÔNG chạm sổ tiền; xác nhận
// (⑤ — cấp RCP) là GĐ 5. Lưu nháp xác minh LẠI tệp (khoá đến từ trình duyệt, không tin lượt trước),
// và dựng lại lần thu bằng CHÍNH loader của màn — tập khoản + số ròng không đến từ client.
// GĐ 5: xác nhận (⑤) — chốt hoá đơn + xác nhận khoản còn chờ đủ điều kiện (cấp RCP) trong MỘT
// transaction (`lib/finance/hoa-don/chot-hoa-don.ts`); giành lượt email đầu tiên cùng transaction.
//
// ⚠️ Tệp 'use server' CHỈ export async function (export const/type làm hỏng Server Action lúc chạy
// mà `pnpm build` vẫn xanh — memory 'use server' export rule).

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { checkPermission } from "@/lib/auth/check-permission";
import { resolveActor, type Actor } from "@/lib/auth/actor";
import { scopedDb } from "@/lib/db-scope";
import { rateLimit } from "@/lib/rate-limit";
import { laHoaDonBat, laMisaPhatHanhBat } from "@/lib/finance/hoa-don/feature";
import type { CongHoaDon } from "@/lib/misa/meinvoice/cong";
import { layCongHoaDon } from "@/lib/finance/hoa-don/cong-phat-hanh";
import { napTrangPhieuCho } from "@/lib/finance/hoa-don/trang-phieu-cho";
import {
  batDauPhatHanh,
  boPhatHanhLamTay,
  guiPhatHanh,
  kiemTraMotBan,
  phatHanhLai,
  thongDiepLoiPhatHanh,
  type SauBuoc,
} from "@/lib/finance/hoa-don/phat-hanh-misa";
import { coQuyenKeToanTaiCoSo, phamViKeToan } from "@/lib/finance/hoa-don/quyen";
import { docBoLoc } from "@/lib/finance/hoa-don/loc-hang-cho";
import {
  khoHoaDonDaCauHinh,
  khoaTepHoaDon,
  khoaThuocDon,
  kyUrlTaiLenHoaDon,
  xacMinhTepHoaDon,
  xoaTepHoaDon,
  coTepTrongKho,
  MIME_TEP,
  TRAN_CO_TEP,
  type LoaiTep,
} from "@/lib/finance/hoa-don/kho-tep";
import { napHangChoHoaDon } from "@/lib/finance/hoa-don/hang-cho";
import type { DongHangCho, NganHangCho } from "@/lib/finance/hoa-don/dong-hang-cho";
import { gopTuKhoa } from "@/lib/finance/hoa-don/lan-thu";
import { kiemOSoHoaDon, tenTepSach } from "@/lib/finance/hoa-don/o-so-hoa-don";
import { CAU_HINH_HOA_DON_MAC_DINH, phapNhanChoDon } from "@/lib/finance/hoa-don/phap-nhan";
import {
  capNhatHoaDonNhap,
  goHoaDonChuaChot,
  ghiKhongTrung,
  huyHoaDonDaXacNhan,
  LoiGhiHoaDon,
  taoHoaDonChoLanThu,
  thongDiepLoiGhiHoaDon,
  timHoaDonDangGiuTepPdf,
  type TepMoi,
} from "@/lib/finance/hoa-don/ghi-hoa-don";
import { TOI_THIEU_LY_DO_HOA_DON } from "@/lib/finance/hoa-don/trang-thai-hoa-don";
import { maskEmail } from "@/lib/utils";
import { chotHoaDon, thongDiepLoiChot, type KetQuaChot } from "@/lib/finance/hoa-don/chot-hoa-don";
import { taoLuotGuiLai } from "@/lib/finance/hoa-don/gui-email";
import { thongDiepLoiGuiLai } from "@/lib/finance/hoa-don/loi-gui-lai";
import { thongDiepTepTrung, type TepDangGiu } from "@/lib/finance/hoa-don/trung-tep";
import {
  ganGhiDanhTuManHoaDon,
  napXemTruocGanGhiDanh,
  thongDiepLoiGanGhiDanh,
  type XemTruocGanGhiDanh,
} from "@/lib/finance/hoa-don/gan-ghi-danh";
import { sapXepTrongNgan } from "@/lib/finance/hoa-don/ngan-hang-cho";
import { laLyDoCoDinh, TIEN_TO_LY_DO_KHAC } from "@/lib/finance/hoa-don/ly-do-khong-xuat";

/** URL PUT sống 5 phút — đủ để trình duyệt tải một tệp ≤ 10 MB lên. */
const TTL_PUT_GIAY = 300;

type KetQua<T> = { ok: true; data: T } | { ok: false; error: string };

const LOAI = z.enum(["pdf", "xml"]);

/**
 * Cổng chung của MỌI thao tác kế toán trên một đơn. Wrapper cục bộ MỘT cấp, cùng tệp — lint
 * `require-can-in-write-action` không tính wrapper import từ tệp khác.
 *
 *   cờ → đăng nhập → `payments:confirm` (trần) → đơn trong tầm nhìn (scopedDb) → là KẾ TOÁN của
 *   ĐÚNG cơ sở giữ đơn (tập cơ sở theo quyền — PLAN §9) → cơ sở có mã (khoá tệp cần mã).
 *
 * Mọi nhánh từ chối vì phạm vi đều nói "Không tìm thấy đơn hàng" — không phân biệt "không có" với
 * "không thuộc cơ sở bạn".
 */
async function congKeToanDon(orderId: string): Promise<
  | { ok: false; error: string }
  | {
      ok: true;
      userId: string;
      userName: string;
      actor: Actor;
      order: { id: string; centerId: string; orgUnitId: string | null; centerCode: string };
    }
> {
  if (!(await laHoaDonBat())) return { ok: false, error: "Màn hoá đơn điện tử chưa được bật" };
  const session = await auth();
  if (!session?.user) return { ok: false, error: "Chưa đăng nhập" };
  if (!(await checkPermission("payments:confirm"))) {
    return { ok: false, error: "Không có quyền — cần quyền xác nhận khoản thu (payments:confirm)" };
  }
  const actor = await resolveActor(session.user.id);
  const order = await scopedDb(actor).order.findUnique({
    where: { id: orderId },
    select: { id: true, centerId: true, orgUnitId: true, center: { select: { code: true } } },
  });
  if (!order || !order.centerId || !coQuyenKeToanTaiCoSo(actor, order.centerId)) {
    return { ok: false, error: "Không tìm thấy đơn hàng" };
  }
  const centerCode = order.center?.code?.trim();
  if (!centerCode) return { ok: false, error: "Cơ sở của đơn chưa có mã — báo quản trị hệ thống" };
  return {
    ok: true,
    userId: session.user.id,
    userName: session.user.name ?? session.user.email ?? session.user.id,
    actor,
    order: { id: order.id, centerId: order.centerId, orgUnitId: order.orgUnitId, centerCode },
  };
}

const kySchema = z.object({ orderId: z.string().min(1).max(64), loai: LOAI });

/** Bước 1 — ký URL PUT. Trả khoá tệp (giữ lại cho bước 2) + mime trình duyệt PHẢI gửi. */
export async function kyTaiLenHoaDonAction(
  input: unknown,
): Promise<KetQua<{ khoa: string; url: string; contentType: string; tranCo: number; hetHanGiay: number }>> {
  const p = kySchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };

  const cong = await congKeToanDon(p.data.orderId);
  if (!cong.ok) return cong;

  const gioiHan = await rateLimit({ key: `hoa-don-tep:${cong.userId}`, max: 60, windowMs: 60 * 60 * 1000 });
  if (!gioiHan.success) return { ok: false, error: "Tải lên quá nhiều lần — thử lại sau ít phút" };

  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };

  const khoa = khoaTepHoaDon({
    centerCode: cong.order.centerCode,
    orderId: cong.order.id,
    loai: p.data.loai,
    nam: new Date().getUTCFullYear(),
    uuid: randomUUID(),
  });
  const contentType = MIME_TEP[p.data.loai];
  const url = await kyUrlTaiLenHoaDon(khoa, contentType, TTL_PUT_GIAY);
  return {
    ok: true,
    data: { khoa, url, contentType, tranCo: TRAN_CO_TEP[p.data.loai], hetHanGiay: TTL_PUT_GIAY },
  };
}

const xacMinhSchema = z.object({
  orderId: z.string().min(1).max(64),
  loai: LOAI,
  khoa: z.string().min(1).max(300),
  /** GĐ 8 — bản nháp đang sửa (không tính là "tệp đã gắn chỗ khác"); thiếu ⇒ kiểm với MỌI hoá đơn. */
  hoaDonId: z.string().min(1).max(64).nullish(),
});

/** Bước 2 — xác minh tệp trình duyệt vừa PUT. Tệp sai loại / quá cỡ bị DỌN khỏi kho. */
export async function xacMinhTepHoaDonAction(
  input: unknown,
): Promise<KetQua<{ khoa: string; co: number; sha256: string }>> {
  const p = xacMinhSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };

  const cong = await congKeToanDon(p.data.orderId);
  if (!cong.ok) return cong;

  // Khoá đến từ trình duyệt: phải nằm dưới ĐÚNG đơn + cơ sở, và đuôi khớp loại khai.
  if (!khoaThuocDon(p.data.khoa, cong.order.centerCode, cong.order.id) || !p.data.khoa.endsWith(`.${p.data.loai}`)) {
    return { ok: false, error: "Tệp không thuộc đơn này" };
  }
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };

  const kq = await xacMinhTepHoaDon({ khoa: p.data.khoa, loai: p.data.loai });
  if (!kq.ok) return { ok: false, error: kq.thongDiep };

  // GĐ 8 bước 13 — báo SỚM (trước khi kế toán gõ số): tệp này đã gắn cho hoá đơn khác còn sống. Chỉ
  // dọn ĐÚNG khoá vừa tải — tệp của hoá đơn đang giữ là của người khác. Cổng thật vẫn nằm trong
  // transaction ghi (khoá vân tay), lượt kiểm này chỉ để không bắt người ta điền form rồi mới biết.
  if (p.data.loai === "pdf") {
    const giu = await timHoaDonDangGiuTepPdf(kq.sha256, p.data.hoaDonId ?? null);
    if (giu) {
      await donTep([p.data.khoa]);
      return { ok: false, error: cauTepTrung(giu, cong.actor, cong.order.id) };
    }
  }
  return { ok: true, data: { khoa: p.data.khoa, co: kq.co, sha256: kq.sha256 } };
}

/** Câu "tệp đã gắn chỗ khác" theo phạm vi người xem — ngoài phạm vi thì không nói mã đơn. */
function cauTepTrung(giu: TepDangGiu, actor: Actor, orderId: string): string {
  return thongDiepTepTrung(giu, { xemDuoc: coQuyenKeToanTaiCoSo(actor, giu.centerId), cungDon: giu.orderId === orderId });
}

// ─── GĐ 4 — ghi bảng hoá đơn ──────────────────────────────────────────────────────────────────

/** Ngày hôm nay theo lịch VN (UTC+7, không giờ mùa hè) — mốc chặn ngày phát hành ở tương lai. */
function homNayVn(): string {
  return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Dựng lại DÒNG của lần thu bằng loader của màn — nguồn duy nhất của tập khoản + số ròng.
 *
 * Q2 (29/09) — dòng GỘP: tập lần thu gộp đọc ra từ CHÍNH khoá (`gopTuKhoa`), không nhận danh sách từ
 * client. Loader thu hẹp theo `orderId` + `gomLanThu` chỉ gộp khoá CÓ trong hàng chờ của đơn ⇒ khoá
 * gộp mang lần thu của đơn khác, hoặc lần thu đã khoá vào hoá đơn khác, ra một khoá KHÁC khoá gửi lên
 * ⇒ không thấy dòng ⇒ "Lần thu vừa thay đổi". Phạm vi kế toán: `congKeToanDon` (đầu mọi action).
 */
async function dongCuaLanThu(actor: Actor, orderId: string, lanThuKey: string): Promise<DongHangCho | null> {
  const { dong } = await napHangChoHoaDon(actor, { canViewPii: true, orderId, gop: gopTuKhoa(lanThuKey) });
  return dong.find((d) => d.key === lanThuKey && d.orderId === orderId) ?? null;
}

/** Xác minh LẠI một tệp trình duyệt khai đã PUT — thuộc đúng đơn, đúng đuôi, đúng byte. */
async function tepDaXacMinh(
  order: { id: string; centerCode: string },
  loai: LoaiTep,
  tep: { khoa: string; ten: string },
): Promise<{ ok: true; tep: TepMoi } | { ok: false; error: string }> {
  if (!khoaThuocDon(tep.khoa, order.centerCode, order.id) || !tep.khoa.endsWith(`.${loai}`)) {
    return { ok: false, error: "Tệp không thuộc đơn này" };
  }
  const kq = await xacMinhTepHoaDon({ khoa: tep.khoa, loai });
  if (!kq.ok) return { ok: false, error: kq.thongDiep };
  return { ok: true, tep: { khoa: tep.khoa, ten: tenTepSach(tep.ten, loai), co: kq.co, sha256: kq.sha256 } };
}

/** Dọn tệp bị thay / gỡ SAU khi commit — lỗi dọn không làm hỏng thao tác đã ghi (tệp mồ côi vô hại). */
async function donTep(khoa: readonly string[]): Promise<void> {
  await Promise.allSettled(khoa.map((k) => xoaTepHoaDon(k)));
}

function lamMoi(orderId: string): void {
  revalidatePath("/payments/hoa-don");
  revalidatePath(`/orders/${orderId}`);
}

/** Lỗi nghiệp vụ đã biết của tầng ghi ⇒ câu cho người dùng; lỗi lạ ném tiếp. */
async function chayGhi<T>(f: () => Promise<T>, nguCanh?: { actor: Actor; orderId: string }): Promise<KetQua<T>> {
  try {
    return { ok: true, data: await f() };
  } catch (e) {
    // GĐ 8 bước 13 — tệp trùng: câu cụ thể theo phạm vi người xem (có ngữ cảnh), không thì câu chung.
    if (nguCanh && e instanceof LoiGhiHoaDon && e.ma === "TEP_TRUNG" && e.chiTiet) {
      return { ok: false, error: cauTepTrung(e.chiTiet, nguCanh.actor, nguCanh.orderId) };
    }
    const tb = thongDiepLoiGhiHoaDon(e);
    if (tb) return { ok: false, error: tb };
    throw e;
  }
}

const TEP_KHAI = z.object({ khoa: z.string().min(1).max(300), ten: z.string().max(300) });
const luuSchema = z.object({
  orderId: z.string().min(1).max(64),
  lanThuKey: z.string().min(1).max(512),
  /** Có ⇒ SỬA bản nháp đang có; không ⇒ TẠO bản nháp (bắt buộc có PDF). */
  hoaDonId: z.string().min(1).max(64).optional(),
  pdf: TEP_KHAI.optional(),
  /** `null` = gỡ XML đang có (chỉ khi sửa). */
  xml: TEP_KHAI.nullable().optional(),
  kyHieu: z.string().max(20).optional(),
  soHoaDon: z.string().max(20).optional(),
  ngayPhatHanh: z.string().max(10).optional(),
  guiEmailKhach: z.boolean(),
  /**
   * GĐ 8 — số tiền lần thu mà kế toán ĐÃ THẤY lúc tải tệp (tờ MISA in đúng số này). BẮT BUỘC: tab cũ
   * không gửi ⇒ từ chối (fail-closed). Lệch với số loader dựng lại ⇒ có tiền mới / điều chỉnh ⇒ dừng.
   */
  soTienDaThay: z.number().int().nonnegative(),
  /** GĐ 8 (Q-mở 1) — "xuất theo số đã thu" cho lần thu THIẾU. Khoá BẮT BUỘC (được là `null`). */
  theoSoDaThu: z.object({ lyDo: z.string().trim().min(TOI_THIEU_LY_DO_HOA_DON).max(300) }).nullable(),
});

/** ④ — lưu hoá đơn NHÁP cho một lần thu (tạo mới, hoặc sửa bản nháp đang có). */
export async function luuHoaDonNhapAction(input: unknown): Promise<KetQua<{ hoaDonId: string }>> {
  const p = luuSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;

  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };

  const o = kiemOSoHoaDon(v, homNayVn());
  if (!o.ok) return o;

  const row = await dongCuaLanThu(cong.actor, v.orderId, v.lanThuKey);
  if (!row) return { ok: false, error: "Lần thu vừa thay đổi — tải lại màn" };

  // GĐ 8 — tờ hoá đơn in số kế toán đã thấy; số lần thu đổi giữa chừng ⇒ tờ có thể sai số.
  if (v.soTienDaThay !== row.soTien) {
    return {
      ok: false,
      error: `Lần thu vừa đổi số tiền (nay là ${row.soTien.toLocaleString("vi-VN")}đ — có tiền mới về hoặc bị điều chỉnh): kiểm lại số trên hoá đơn rồi lưu lại`,
    };
  }
  // GĐ 8 — lần thu THIẾU phải chọn có chủ đích "xuất theo số đã thu"; hết thiếu mà vẫn gửi lựa chọn đó
  // (tab cũ) ⇒ dừng, không ghi một lý do không còn đúng.
  const canTheoSo = row.hanhDong.ngoaiLe?.loai === "THEO_SO_DA_THU";
  if (canTheoSo && !v.theoSoDaThu) return { ok: false, error: row.hanhDong.ngoaiLe!.cau };
  if (!canTheoSo && v.theoSoDaThu) return { ok: false, error: "Lần thu không còn thiếu tiền — tải lại màn rồi lưu lại" };

  if (v.hoaDonId) {
    if (row.ngan !== "nhap" || row.hoaDonNhap?.id !== v.hoaDonId) {
      return { ok: false, error: "Hoá đơn vừa bị người khác sửa hoặc gỡ — tải lại màn" };
    }
  } else {
    if (row.hoaDonNhap || (row.ngan !== "cho" && row.ngan !== "lech")) {
      return { ok: false, error: "Lần thu này đã có hoá đơn — tải lại màn" };
    }
    if (!row.hanhDong.taiLen.bat) return { ok: false, error: row.hanhDong.taiLen.lyDo ?? "Chưa tải lên được" };
    if (!v.pdf) return { ok: false, error: "Chọn tệp PDF hoá đơn" };
  }

  const pdf = v.pdf ? await tepDaXacMinh(cong.order, "pdf", v.pdf) : null;
  if (pdf && !pdf.ok) return pdf;
  const xml = v.xml ? await tepDaXacMinh(cong.order, "xml", v.xml) : null;
  if (xml && !xml.ok) return xml;

  const nguoiGhi = { id: cong.userId, name: cong.userName };
  // GĐ 8 — lưu hỏng (trùng số / đổi giữa chừng / …) ⇒ dọn ĐÚNG tệp vừa tải trong lượt này, KHÔNG BAO GIỜ
  // đụng tệp đang được hoá đơn lưu giữ. Trước đây chỉ một nhánh lỗi dọn — các nhánh khác để tệp mồ côi
  // (mang PII người mua) nằm lại trong kho.
  const tepMoi = [pdf?.tep.khoa, xml?.tep.khoa].filter((k): k is string => Boolean(k));
  if (v.hoaDonId) {
    const hoaDonId = v.hoaDonId;
    const kq = await chayGhi(() =>
      capNhatHoaDonNhap({
        nguoiGhi,
        orderId: v.orderId,
        hoaDonId,
        so: o.data,
        guiEmailKhach: v.guiEmailKhach,
        pdf: pdf?.tep,
        xml: v.xml === null ? null : xml?.tep,
        theoSoDaThu: v.theoSoDaThu ? { lyDo: v.theoSoDaThu.lyDo } : null,
        // Q-mở 4 — phần tha làm tròn của lần thu, từ dòng LOADER dựng lại (không từ client).
        tienTha: row.tienTha,
      }),
      { actor: cong.actor, orderId: v.orderId },
    );
    if (!kq.ok) {
      await donTep(tepMoi);
      return kq;
    }
    await donTep(kq.data.tepCanXoa);
    lamMoi(v.orderId);
    return { ok: true, data: { hoaDonId } };
  }

  if (!pdf) return { ok: false, error: "Chọn tệp PDF hoá đơn" };
  const phapNhan = phapNhanChoDon(cong.order.centerCode, CAU_HINH_HOA_DON_MAC_DINH);
  if (!phapNhan) return { ok: false, error: "Chưa khai pháp nhân phát hành trong Cấu hình hoá đơn" };
  const kq = await chayGhi(() =>
    taoHoaDonChoLanThu({
      nguoiGhi,
      orderId: v.orderId,
      centerId: cong.order.centerId,
      lanThuKey: row.key,
      khoan: row.khoan,
      loai: {
        trangThai: "NHAP",
        phapNhan,
        so: o.data,
        guiEmailKhach: v.guiEmailKhach,
        pdf: pdf.tep,
        xml: xml?.tep ?? null,
        theoSoDaThu: v.theoSoDaThu ? { lyDo: v.theoSoDaThu.lyDo, thieu: row.thieu, nhanDot: row.nhanDot } : null,
        tienTha: row.tienTha,
      },
    }),
    { actor: cong.actor, orderId: v.orderId },
  );
  if (!kq.ok) {
    await donTep(tepMoi);
    return kq;
  }
  lamMoi(v.orderId);
  return { ok: true, data: { hoaDonId: kq.data.id } };
}

const khongXuatSchema = z.object({
  orderId: z.string().min(1).max(64),
  lanThuKey: z.string().min(1).max(512),
  lyDo: z.string().trim().min(1).max(300),
  /** Chọn "Khác…" ⇒ ghi chú bắt buộc (≥ 5 ký tự). */
  ghiChu: z.string().trim().max(300).optional(),
});

/** Đánh dấu KHÔNG XUẤT hoá đơn cho một lần thu (kèm lý do) — khoản rời hàng chờ, không có tệp. */
export async function khongXuatHoaDonAction(input: unknown): Promise<KetQua<{ hoaDonId: string }>> {
  const p = khongXuatSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const lyDo = laLyDoCoDinh(v.lyDo)
    ? v.lyDo
    : v.ghiChu && v.ghiChu.length >= 5
      ? `${TIEN_TO_LY_DO_KHAC}${v.ghiChu}`
      : null;
  if (!lyDo) return { ok: false, error: "Ghi rõ lý do không xuất (ít nhất 5 ký tự)" };

  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;
  const row = await dongCuaLanThu(cong.actor, v.orderId, v.lanThuKey);
  if (!row || row.hoaDonNhap || !["cho", "lech", "don-huy"].includes(row.ngan)) {
    return { ok: false, error: "Lần thu vừa thay đổi — tải lại màn" };
  }
  if (!row.hanhDong.khongXuat) return { ok: false, error: "Không đánh dấu được lần thu này" };

  const kq = await chayGhi(() =>
    taoHoaDonChoLanThu({
      nguoiGhi: { id: cong.userId, name: cong.userName },
      orderId: v.orderId,
      centerId: cong.order.centerId,
      lanThuKey: row.key,
      khoan: row.khoan,
      loai: { trangThai: "KHONG_XUAT", lyDo },
    }),
  );
  if (!kq.ok) return kq;
  lamMoi(v.orderId);
  return { ok: true, data: { hoaDonId: kq.data.id } };
}

const xacNhanSchema = z.object({
  orderId: z.string().min(1).max(64),
  hoaDonId: z.string().min(1).max(64),
  /** GĐ 8 — phiên bản bản nháp người bấm đã thấy (`hoaDonNhap.phienBan`). */
  phienBan: z.string().datetime(),
  /** GĐ 8 — đúng nhãn nút đã hiện (nói gửi tới đâu); lệch ⇒ người bấm đã được hứa sai. */
  nhanDaThay: z.string().max(300),
  /** Bộ lọc màn đang xem (`?coSo=` · `?thang=`) — chỉ để tính dòng KẾ TIẾP; server đọc lại qua `docBoLoc`. */
  coSo: z.string().max(64).nullish(),
  thang: z.string().max(16).nullish(),
});

/**
 * ⑤ — XÁC NHẬN hoá đơn (PLAN §4 ⑤, phương án (b)): chốt hoá đơn NHÁP → ĐÃ XÁC NHẬN; khoản còn chờ
 * mà đủ điều kiện thì xác nhận + cấp RCP trong cùng transaction (lõi `chotHoaDon`).
 * Trả `keKe` = khoá dòng kế tiếp trong CÙNG ngăn, tính trên danh sách MỚI sau khi ghi.
 */
export async function xacNhanHoaDonAction(input: unknown): Promise<
  KetQua<{
    daXacNhan: number;
    conCho: string[];
    keKe: string | null;
    /** Địa chỉ THẬT sẽ nhận hoá đơn (đã che) — `null` nếu không gửi email. */
    guiToi: string | null;
  }>
> {
  const p = xacNhanSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;

  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };

  // HEAD kho TRƯỚC khi dựng dòng (GĐ 8 dời lên): chốt một hoá đơn mà tệp đã mất là hứa với khách một
  // tờ không tải được. Đứng trước để phép so phiên bản / nhãn ngay dưới là việc CUỐI trước transaction.
  const hd = await scopedDb(cong.actor).hoaDonDienTu.findUnique({
    where: { id: v.hoaDonId },
    select: { tepPdfKey: true, orderId: true },
  });
  if (!hd || hd.orderId !== v.orderId || !hd.tepPdfKey) {
    return { ok: false, error: "Hoá đơn vừa được người khác xác nhận, sửa hoặc gỡ — tải lại màn" };
  }
  if (!(await coTepTrongKho(hd.tepPdfKey))) {
    return { ok: false, error: "Không thấy tệp PDF hoá đơn trong kho — tải lại tệp rồi xác nhận" };
  }

  // Nút phải SÁNG trên chính dòng loader dựng lại lúc này — cùng luật `hanhDongChoDong` mà màn vẽ.
  const truoc = await napHangChoHoaDon(cong.actor, { canViewPii: true, orderId: v.orderId });
  const row = truoc.dong.find((d) => d.hoaDonNhap?.id === v.hoaDonId);
  if (!row || !row.hoaDonNhap) return { ok: false, error: "Hoá đơn vừa được người khác xác nhận, sửa hoặc gỡ — tải lại màn" };
  if (row.hoaDonNhap.phienBan !== v.phienBan) return { ok: false, error: "Hoá đơn vừa được sửa — tải lại màn rồi xác nhận" };
  if (row.hanhDong.xacNhan.nhan !== v.nhanDaThay) {
    return { ok: false, error: "Thông tin gửi email vừa đổi — xem lại nút rồi bấm lại" };
  }
  if (!row.hanhDong.xacNhan.bat) return { ok: false, error: row.hanhDong.xacNhan.lyDo ?? "Chưa xác nhận được" };

  let kq: KetQuaChot;
  try {
    kq = await chotHoaDon({
      nguoiChot: { id: cong.userId, name: cong.userName },
      // Bước chốt đo lại phạm vi kế toán trên TỪNG khoản (theo `Payment.centerId`) — cổng trên chỉ hỏi đơn.
      actor: cong.actor,
      orderId: v.orderId,
      hoaDonId: v.hoaDonId,
      now: new Date(),
      phienBan: new Date(v.phienBan),
      // Loader dựng với canViewPii = true ⇒ email THẬT (không che) — bước chốt so với email của đơn.
      emailDuKien: row.emailNhan,
    });
  } catch (e) {
    const tb = thongDiepLoiChot(e);
    if (tb) return { ok: false, error: tb };
    throw e;
  }

  // Dòng kế tiếp: cùng ngăn với dòng vừa chốt, trên danh sách SAU khi ghi — ĐÃ LỌC như màn đang xem
  // (PLAN §10): kế tiếp là dòng người bấm đang thấy, không phải dòng của cơ sở/tháng khác. Bộ lọc đọc
  // lại theo phạm vi kế toán của người bấm — client không mở rộng được gì.
  const boLoc = docBoLoc({ coSo: v.coSo, thang: v.thang }, { phamViKeToan: phamViKeToan(cong.actor), now: new Date() });
  const sau = await napHangChoHoaDon(cong.actor, { canViewPii: true, boLoc });
  const keKe = sapXepTrongNgan(row.ngan, sau.dong).find((d) => d.key !== row.key)?.key ?? null;

  lamMoi(v.orderId);
  // Khoản vừa xác nhận ⇒ màn Thanh toán + công nợ đổi (cùng tập đường của `confirmPaymentAction`).
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  return {
    ok: true,
    data: {
      daXacNhan: kq.daXacNhan.length,
      conCho: kq.conCho.map((c) => c.lyDo),
      keKe,
      guiToi: kq.coGuiEmail && row.emailNhan ? maskEmail(row.emailNhan) : null,
    },
  };
}

const khongTrungSchema = z.object({
  orderId: z.string().min(1).max(64),
  hoaDonId: z.string().min(1).max(64),
  phienBan: z.string().datetime(),
  lyDo: z.string().trim().min(TOI_THIEU_LY_DO_HOA_DON).max(500),
});

/**
 * GĐ 8 (quyết định (2) 27/09) — "Không trùng — vẫn xuất" cho bản NHÁP của lần thu nghi trùng. Kế toán
 * đúng cơ sở, lý do bắt buộc; ghi lên CHÍNH hoá đơn (+ nhật ký). Nhật ký lấy từ dòng LOADER, không từ
 * client. Sau khi ghi, nút Xác nhận sáng theo đúng luật màn vẽ; bước chốt vẫn kiểm lại trong transaction.
 */
export async function khongTrungHoaDonAction(input: unknown): Promise<KetQua<{ hoaDonId: string }>> {
  const p = khongTrungSchema.safeParse(input);
  if (!p.success) return { ok: false, error: `Ghi rõ vì sao không trùng (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự)` };
  const v = p.data;

  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;

  const nap = await napHangChoHoaDon(cong.actor, { canViewPii: true, orderId: v.orderId });
  const row = nap.dong.find((d) => d.hoaDonNhap?.id === v.hoaDonId);
  if (!row || !row.hoaDonNhap) return { ok: false, error: "Hoá đơn vừa được xác nhận, sửa hoặc gỡ — tải lại màn" };
  if (row.hoaDonNhap.phienBan !== v.phienBan) return { ok: false, error: "Hoá đơn vừa được sửa — tải lại màn rồi làm lại" };
  const ngoaiLe = row.hanhDong.ngoaiLe;
  if (ngoaiLe?.loai !== "KHONG_TRUNG") return { ok: false, error: "Lần thu không còn nghi trùng — tải lại màn" };
  if (ngoaiLe.daChon) return { ok: false, error: "Đã xác nhận không trùng cho hoá đơn này" };

  const kq = await chayGhi(() =>
    ghiKhongTrung({
      nguoiGhi: { id: cong.userId, name: cong.userName },
      orderId: v.orderId,
      hoaDonId: v.hoaDonId,
      phienBan: new Date(v.phienBan),
      lyDo: v.lyDo,
      nhatKy: { lanThuKey: row.key, khoanIds: row.khoanIds, soTien: row.soTien, bangChung: ngoaiLe.cau },
      now: new Date(),
    }),
  );
  if (!kq.ok) return kq;
  lamMoi(v.orderId);
  return { ok: true, data: { hoaDonId: v.hoaDonId } };
}

const guiLaiSchema = z.object({
  orderId: z.string().min(1).max(64),
  hoaDonId: z.string().min(1).max(64),
  /** `HOA_DON` = địa chỉ chụp lúc chốt · `DON_HIEN_TAI` = email hiện tại của đơn (khi khác). */
  nguon: z.enum(["HOA_DON", "DON_HIEN_TAI"]),
  /** Địa chỉ người bấm ĐÃ THẤY trên màn (thật hoặc đã che, tuỳ quyền) — lệch ⇒ từ chối. */
  toiDaThay: z.string().min(1).max(320),
});

/**
 * GĐ 8 bước 11 — "Gửi lại email" hoá đơn ĐÃ XÁC NHẬN (lượt mới, khoá chống gửi đôi mới).
 *
 * Cổng theo thứ tự: dữ liệu vào → kế toán ĐÚNG cơ sở → trần lượt bấm (20/giờ/người — mỗi lượt là một
 * email thật ra khách) → kho → nút phải SÁNG trên chính dòng loader dựng lại (cùng luật màn vẽ) →
 * địa chỉ theo nguồn → địa chỉ đã thấy khớp → tệp PDF còn trong kho → lõi (khoá đơn + ghi).
 */
export async function guiLaiEmailHoaDonAction(input: unknown): Promise<KetQua<{ toi: string; lanGui: number }>> {
  const p = guiLaiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;

  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;

  const gioiHan = await rateLimit({ key: `hoa-don-gui-lai:${cong.userId}`, max: 20, windowMs: 60 * 60 * 1000 });
  if (!gioiHan.success) return { ok: false, error: "Gửi lại quá nhiều lần — thử lại sau ít phút" };
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };

  // Loader dựng với canViewPii = true ⇒ `toiMacDinh` / `toiDon` là địa chỉ THẬT.
  const nap = await napHangChoHoaDon(cong.actor, { canViewPii: true, orderId: v.orderId });
  const row = nap.dong.find((d) => d.hoaDon?.id === v.hoaDonId && d.hoaDon.trangThai === "DA_XAC_NHAN");
  if (!row || !row.email) return { ok: false, error: "Hoá đơn vừa được huỷ hoặc thay đổi — tải lại màn" };
  if (!row.email.guiLai.bat) return { ok: false, error: row.email.guiLai.lyDo ?? "Chưa gửi được email hoá đơn này" };

  const toi = v.nguon === "HOA_DON" ? row.email.toiMacDinh : row.email.toiDon;
  if (!toi) {
    return {
      ok: false,
      error:
        v.nguon === "HOA_DON"
          ? "Hoá đơn không ghi email nhận — chọn gửi tới email hiện tại của đơn"
          : "Email trên đơn không khác email của hoá đơn — tải lại màn",
    };
  }
  // Người thiếu quyền xem thông tin khách thấy bản CHE ⇒ nhận cả hai dạng; khác cả hai ⇒ đã đổi.
  const daThay = v.toiDaThay.trim();
  if (daThay !== toi && daThay !== maskEmail(toi)) {
    return { ok: false, error: "Email nhận vừa đổi — tải lại màn rồi xem lại địa chỉ" };
  }

  const hd = await scopedDb(cong.actor).hoaDonDienTu.findUnique({
    where: { id: v.hoaDonId },
    select: { tepPdfKey: true, orderId: true },
  });
  if (!hd || hd.orderId !== v.orderId || !hd.tepPdfKey || !(await coTepTrongKho(hd.tepPdfKey))) {
    return { ok: false, error: "Không thấy tệp PDF hoá đơn trong kho — không gửi được" };
  }

  let kq: { guiId: string; lanGui: number };
  try {
    kq = await taoLuotGuiLai({
      nguoiGui: { id: cong.userId, name: cong.userName },
      orderId: v.orderId,
      hoaDonId: v.hoaDonId,
      toi,
      nguon: v.nguon,
    });
  } catch (e) {
    const tb = thongDiepLoiGuiLai(e);
    if (tb) return { ok: false, error: tb };
    throw e;
  }
  lamMoi(v.orderId);
  return { ok: true, data: { toi: maskEmail(toi), lanGui: kq.lanGui } };
}

// ─── GĐ 8b — Gắn ghi danh từ màn hoá đơn (PLAN Q-mở 8) ────────────────────────────────────────

const lanThuSchema = z.object({ orderId: z.string().min(1).max(64), lanThuKey: z.string().min(1).max(512) });

/**
 * XEM TRƯỚC kế hoạch gắn ghi danh cho các khoản chưa gắn của ĐƠN (chỉ đọc) — mở bằng một cú bấm, không
 * nạp sẵn cùng màn (không thêm lượt tra tuần tự cho mọi lần mở trang).
 */
export async function xemTruocGanGhiDanhAction(input: unknown): Promise<KetQua<XemTruocGanGhiDanh>> {
  const p = lanThuSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congKeToanDon(p.data.orderId);
  if (!cong.ok) return cong;
  const row = await dongCuaLanThu(cong.actor, p.data.orderId, p.data.lanThuKey);
  if (!row) return { ok: false, error: "Lần thu vừa thay đổi — tải lại màn" };
  if (row.ngan === "don-huy") return { ok: false, error: "Đơn đã huỷ / hoàn — không gắn ghi danh ở đây" };
  const xt = await napXemTruocGanGhiDanh({
    actor: cong.actor,
    orderId: p.data.orderId,
    lanThuKey: row.key,
    khoanTrongLanThu: row.khoanIds,
  });
  if (!xt) return { ok: false, error: "Không tìm thấy đơn hàng" };
  return { ok: true, data: xt };
}

const ganGhiDanhSchema = lanThuSchema.extend({
  /** Dấu kế hoạch người bấm đã xem — lệch dấu dựng lại trong transaction ⇒ không chạy gì. */
  dauKeHoach: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * GẮN ghi danh theo đúng kế hoạch đã xem. Cổng: kế toán ĐÚNG cơ sở → dòng còn đó → không phải đơn đã
 * huỷ → lần thu còn khoản chưa gắn (bấm lại lần hai ⇒ trả "đã gắn", không gọi lõi) → lõi (khoá đơn +
 * so dấu + ghi có điều kiện). KHÔNG dùng `ganGhiDanhChoKhoanAction` của màn Thanh toán: nó đòi
 * `Order.studentId`, mà đơn lập từ lead để trống — đúng tập đơn cần gắn ở đây.
 */
export async function ganGhiDanhHoaDonAction(
  input: unknown,
): Promise<KetQua<{ gan: number; tach: number; thongDiep: string; buocTiep: string }>> {
  const p = ganGhiDanhSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;
  const row = await dongCuaLanThu(cong.actor, v.orderId, v.lanThuKey);
  if (!row) return { ok: false, error: "Lần thu vừa thay đổi — tải lại màn" };
  if (row.ngan === "don-huy") return { ok: false, error: "Đơn đã huỷ / hoàn — không gắn ghi danh ở đây" };

  const buocTiep =
    row.hoaDon?.trangThai === "DA_XAC_NHAN" || row.hoaDon?.trangThai === "KHONG_XUAT"
      ? "Khoản vẫn chờ xác nhận ở màn Thanh toán"
      : row.hoaDon?.trangThai === "NHAP"
        ? "Bấm Xác nhận hoá đơn để cấp phiếu thu"
        : "Tải hoá đơn lên rồi bấm Xác nhận để cấp phiếu thu";
  if (row.khoanChuaGanGhiDanh.length === 0) {
    return { ok: true, data: { gan: 0, tach: 0, thongDiep: "Các khoản của lần thu này đã gắn ghi danh", buocTiep } };
  }

  let kq: { gan: number; tach: number };
  try {
    kq = await ganGhiDanhTuManHoaDon({
      actor: cong.actor,
      nguoiGhi: { id: cong.userId, name: cong.userName },
      orderId: v.orderId,
      lanThuKey: row.key,
      dauKeHoach: v.dauKeHoach,
    });
  } catch (e) {
    const tb = thongDiepLoiGanGhiDanh(e);
    if (tb) return { ok: false, error: tb };
    throw e;
  }
  lamMoi(v.orderId);
  // Khoản vừa gắn ⇒ màn Thanh toán + công nợ theo bé đổi (cùng tập đường của màn Thanh toán).
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  const tong = kq.gan + kq.tach;
  return {
    ok: true,
    data: {
      ...kq,
      thongDiep: kq.tach > 0 ? `Đã gắn ghi danh cho ${tong} khoản (chia ${kq.tach} khoản theo bé)` : `Đã gắn ghi danh cho ${tong} khoản`,
      buocTiep,
    },
  };
}

const goSchema = z.object({ orderId: z.string().min(1).max(64), hoaDonId: z.string().min(1).max(64) });

/** Gỡ bản NHÁP (tải nhầm) hoặc gỡ dấu KHÔNG XUẤT — lần thu về lại hàng chờ. */
export async function goHoaDonAction(input: unknown): Promise<KetQua<{ hoaDonId: string }>> {
  const p = goSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const cong = await congKeToanDon(p.data.orderId);
  if (!cong.ok) return cong;
  const kq = await chayGhi(() =>
    goHoaDonChuaChot({ nguoiGhi: { id: cong.userId, name: cong.userName }, orderId: p.data.orderId, hoaDonId: p.data.hoaDonId }),
  );
  if (!kq.ok) return kq;
  await donTep(kq.data.tepCanXoa);
  lamMoi(p.data.orderId);
  return { ok: true, data: { hoaDonId: p.data.hoaDonId } };
}

const huySchema = z.object({
  orderId: z.string().min(1).max(64),
  hoaDonId: z.string().min(1).max(64),
  lyDo: z.string().trim().min(TOI_THIEU_LY_DO_HOA_DON).max(500),
});

/**
 * GĐ 8 — HUỶ hoá đơn ĐÃ XÁC NHẬN (quyết định (1) 27/09). Khoản trở lại hàng chờ để tải hoá đơn đúng
 * theo luồng thường; Payment vẫn xác nhận, phiếu thu giữ nguyên. Không quyền mới, không seed.
 *
 * Cổng theo thứ tự: dữ liệu vào → cổng kế toán ĐÚNG cơ sở → nút phải SÁNG trên chính dòng loader dựng
 * lại lúc này (cùng luật màn vẽ — luật 12) → ghi (lõi `huyHoaDonDaXacNhan`, khoá đơn + ghi có điều
 * kiện). Trả dòng hàng chờ vừa nhận lại khoản để màn mở thẳng tới đó.
 */
export async function huyHoaDonAction(
  input: unknown,
): Promise<KetQua<{ chon: string | null; ngan: NganHangCho | null }>> {
  const p = huySchema.safeParse(input);
  if (!p.success) return { ok: false, error: `Ghi rõ lý do huỷ hoá đơn (ít nhất ${TOI_THIEU_LY_DO_HOA_DON} ký tự)` };
  const v = p.data;

  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;

  const truoc = await napHangChoHoaDon(cong.actor, { canViewPii: true, orderId: v.orderId });
  const row = truoc.dong.find((d) => d.hoaDon?.id === v.hoaDonId && d.hoaDon.trangThai === "DA_XAC_NHAN");
  if (!row) return { ok: false, error: "Hoá đơn vừa được người khác huỷ hoặc thay đổi — tải lại màn" };
  if (!row.huy.bat) return { ok: false, error: row.huy.lyDo ?? "Không huỷ được hoá đơn này" };

  const kq = await chayGhi(() =>
    huyHoaDonDaXacNhan({
      nguoiHuy: { id: cong.userId, name: cong.userName },
      orderId: v.orderId,
      hoaDonId: v.hoaDonId,
      lyDo: v.lyDo,
      now: new Date(),
    }),
  );
  if (!kq.ok) return kq;

  // Dòng CHƯA có hoá đơn đang giữ các khoản vừa được nhả — có thể không có (đã hoàn hết tiền).
  const sau = await napHangChoHoaDon(cong.actor, { canViewPii: true, orderId: v.orderId });
  const tra = new Set(kq.data.paymentIds);
  const moi = sau.dong.find((d) => !d.hoaDon && d.khoanIds.some((id) => tra.has(id))) ?? null;

  lamMoi(v.orderId);
  // Công nợ không đổi (tiền vẫn xác nhận) nhưng màn Thanh toán hiện nhãn khoá hoá đơn theo từng khoản.
  revalidatePath("/payments");
  revalidatePath("/cong-no");
  return { ok: true, data: { chon: moi?.key ?? null, ngan: moi?.ngan ?? null } };
}

// ─── Bước 1 MISA (30/09) — Phát hành qua MISA meInvoice ───────────────────────────────────────
//
// Bốn action, cùng thứ tự cổng: dữ liệu vào → `congKeToanDon` (cờ màn · đăng nhập · `payments:confirm` ·
// đơn trong tầm nhìn · kế toán ĐÚNG cơ sở) → công tắc `hoaDon.misaPhatHanh` + cổng MISA đã cấu hình
// (`congMisa`) → nút phải SÁNG trên CHÍNH dòng loader dựng lại (cùng `nutPhatHanhMisa` / `khoiMisa` màn vẽ —
// luật 12) → máy trạng thái (`lib/finance/hoa-don/phat-hanh-misa.ts`, khoá đơn + mọi cổng của `chotHoaDon`).
// Không action nào tin giao diện: cờ, cổng, quyền, phạm vi đều hỏi lại ở đây.

type KetQuaMisa = {
  hoaDonId: string;
  trangThai: "DA_XAC_NHAN" | "DANG_PHAT_HANH" | "LOI_PHAT_HANH" | "KHONG_CON";
  thongDiep: string | null;
};

/** Công tắc MISA + cổng MISA — hỏi SAU `congKeToanDon`. Cổng chỉ lấy qua `layCongHoaDon()`. */
async function congMisa(): Promise<{ ok: true; misa: CongHoaDon } | { ok: false; error: string }> {
  if (!(await laMisaPhatHanhBat())) return { ok: false, error: "Phát hành qua MISA chưa được bật (Cấu hình vận hành)" };
  const misa = layCongHoaDon();
  if (!misa) return { ok: false, error: "Chưa cấu hình kết nối MISA meInvoice — báo người vận hành" };
  return { ok: true, misa };
}

function veKetQua(hoaDonId: string, s: SauBuoc): KetQuaMisa {
  return {
    hoaDonId,
    trangThai: s.trangThai,
    thongDiep: s.trangThai === "DANG_PHAT_HANH" || s.trangThai === "LOI_PHAT_HANH" ? s.thongDiep : null,
  };
}

function lamMoiSauPhatHanh(orderId: string, s: SauBuoc): void {
  lamMoi(orderId);
  // Hoàn tất ⇒ khoản còn chờ đủ điều kiện vừa được xác nhận (RCP) — cùng tập đường của `xacNhanHoaDonAction`.
  if (s.trangThai === "DA_XAC_NHAN") {
    revalidatePath("/payments");
    revalidatePath("/cong-no");
  }
}

/** Dòng của bản ĐANG / LỖI phát hành, dựng lại bằng loader của màn (thu hẹp theo đơn). */
async function dongMisaCuaHoaDon(actor: Actor, orderId: string, hoaDonId: string): Promise<DongHangCho | null> {
  const nap = await napHangChoHoaDon(actor, { canViewPii: true, orderId });
  return nap.dong.find((d) => d.misa?.hoaDonId === hoaDonId) ?? null;
}

const phatHanhSchema = z.object({
  orderId: z.string().min(1).max(64),
  lanThuKey: z.string().min(1).max(512),
  /** Số tiền hộp xác nhận đã hiện — lệch số loader dựng lại ⇒ có tiền mới / điều chỉnh ⇒ dừng. */
  soTienDaThay: z.number().int().positive(),
  /** Môi trường hộp xác nhận đã nói (sandbox / production / mô phỏng) — đổi giữa chừng ⇒ dừng. */
  moiTruongDaThay: z.enum(["sandbox", "production", "gia-lap"]),
});

/**
 * "Phát hành qua MISA" cho một lần thu ở hàng chờ: tạo bản DANG_PHAT_HANH (khoá khoản) rồi gửi MISA ngay.
 * MISA trả số ⇒ tải PDF/XML vào kho ⇒ DA_XAC_NHAN + email khách (trừ bản mô phỏng). Không chắc ⇒ giữ
 * "Đang chờ MISA xác nhận" (cron đối soát 10 phút / nút "Kiểm tra lại").
 */
export async function phatHanhQuaMisaAction(input: unknown): Promise<KetQua<KetQuaMisa>> {
  const p = phatHanhSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;

  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;
  const cm = await congMisa();
  if (!cm.ok) return cm;
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };
  // Mỗi lượt là một hoá đơn THẬT (chứng từ thuế) — trần như gửi lại email.
  const gioiHan = await rateLimit({ key: `hoa-don-misa:${cong.userId}`, max: 30, windowMs: 60 * 60 * 1000 });
  if (!gioiHan.success) return { ok: false, error: "Phát hành quá nhiều lần — thử lại sau ít phút" };

  const row = await dongCuaLanThu(cong.actor, v.orderId, v.lanThuKey);
  if (!row) return { ok: false, error: "Lần thu vừa thay đổi — tải lại màn" };
  const nut = row.phatHanhMisa;
  if (!nut.hien) return { ok: false, error: nut.cau ?? "Lần thu này không phát hành qua MISA được — tải lại màn" };
  if (!nut.bat) return { ok: false, error: nut.lyDo ?? "Chưa phát hành được" };
  if (v.soTienDaThay !== row.soTien) {
    return { ok: false, error: `Lần thu vừa đổi số tiền (nay là ${row.soTien.toLocaleString("vi-VN")}đ) — tải lại màn rồi xem lại` };
  }
  if (v.moiTruongDaThay !== cm.misa.moiTruong) return { ok: false, error: "Môi trường MISA vừa đổi — tải lại màn rồi xem lại" };

  const nap = await napTrangPhieuCho(cong.actor, row);
  if (!nap.ok) return { ok: false, error: nap.error };

  let bd: { hoaDonId: string };
  try {
    bd = await batDauPhatHanh({
      nguoiBam: { id: cong.userId, name: cong.userName },
      actor: cong.actor,
      orderId: v.orderId,
      centerId: cong.order.centerId,
      lanThuKey: row.key,
      khoan: row.khoan,
      nguon: nap,
      cheDo: cm.misa.cheDo,
      now: new Date(),
    });
  } catch (e) {
    const tb = thongDiepLoiPhatHanh(e);
    if (tb) return { ok: false, error: tb };
    throw e;
  }
  const s = await guiPhatHanh({ hoaDonId: bd.hoaDonId, cong: cm.misa, now: new Date() });
  lamMoiSauPhatHanh(v.orderId, s);
  return { ok: true, data: veKetQua(bd.hoaDonId, s) };
}

const banMisaSchema = z.object({ orderId: z.string().min(1).max(64), hoaDonId: z.string().min(1).max(64) });

/**
 * "Kiểm tra lại" bản ĐANG PHÁT HÀNH: tra MISA theo refId ĐÃ LƯU — đã có ⇒ hoàn tất; chưa có ⇒ gửi lại CÙNG
 * refId; không rõ ⇒ giữ nguyên. Bản đã có số ⇒ tải tệp còn thiếu rồi hoàn tất.
 */
export async function kiemTraLaiPhatHanhAction(input: unknown): Promise<KetQua<KetQuaMisa>> {
  const p = banMisaSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;
  const cm = await congMisa();
  if (!cm.ok) return cm;
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };

  const row = await dongMisaCuaHoaDon(cong.actor, v.orderId, v.hoaDonId);
  if (!row?.misa) return { ok: false, error: "Hoá đơn vừa đổi trạng thái — tải lại màn" };
  if (!row.misa.kiemTraLai.bat) return { ok: false, error: row.misa.kiemTraLai.lyDo ?? "Không kiểm tra lại được hoá đơn này" };

  const s = await kiemTraMotBan({ hoaDonId: v.hoaDonId, cong: cm.misa, now: new Date(), choGuiLai: () => true });
  lamMoiSauPhatHanh(v.orderId, s);
  return { ok: true, data: veKetQua(v.hoaDonId, s) };
}

const banLoiSchema = banMisaSchema.extend({
  /** Phiên bản bản LỖI người bấm đã thấy (`misa.phienBan`). */
  phienBan: z.string().datetime(),
});

/**
 * "Phát hành lại" bản LỖI (MISA từ chối chắc chắn) sau khi kế toán sửa dữ liệu người mua trên đơn: chụp
 * lại, refId MỚI (được phép vì TU_CHOI chắc chắn chưa có hoá đơn), gửi ngay.
 */
export async function phatHanhLaiAction(input: unknown): Promise<KetQua<KetQuaMisa>> {
  const p = banLoiSchema.extend({ moiTruongDaThay: z.enum(["sandbox", "production", "gia-lap"]) }).safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;
  const cm = await congMisa();
  if (!cm.ok) return cm;
  if (!khoHoaDonDaCauHinh()) return { ok: false, error: "Kho lưu hoá đơn chưa cấu hình — báo người vận hành" };
  const gioiHan = await rateLimit({ key: `hoa-don-misa:${cong.userId}`, max: 30, windowMs: 60 * 60 * 1000 });
  if (!gioiHan.success) return { ok: false, error: "Phát hành quá nhiều lần — thử lại sau ít phút" };

  const row = await dongMisaCuaHoaDon(cong.actor, v.orderId, v.hoaDonId);
  if (!row?.misa) return { ok: false, error: "Hoá đơn vừa đổi trạng thái — tải lại màn" };
  if (!row.misa.phatHanhLai.bat) return { ok: false, error: row.misa.phatHanhLai.lyDo ?? "Không phát hành lại được" };
  if (row.misa.phienBan !== v.phienBan) return { ok: false, error: "Hoá đơn vừa đổi — tải lại màn rồi làm lại" };
  if (v.moiTruongDaThay !== cm.misa.moiTruong) return { ok: false, error: "Môi trường MISA vừa đổi — tải lại màn rồi xem lại" };

  const nap = await napTrangPhieuCho(cong.actor, row);
  if (!nap.ok) return { ok: false, error: nap.error };
  try {
    await phatHanhLai({
      nguoiBam: { id: cong.userId, name: cong.userName },
      actor: cong.actor,
      orderId: v.orderId,
      hoaDonId: v.hoaDonId,
      phienBan: new Date(v.phienBan),
      nguon: nap,
      cheDo: cm.misa.cheDo,
      now: new Date(),
    });
  } catch (e) {
    const tb = thongDiepLoiPhatHanh(e);
    if (tb) return { ok: false, error: tb };
    throw e;
  }
  const s = await guiPhatHanh({ hoaDonId: v.hoaDonId, cong: cm.misa, now: new Date() });
  lamMoiSauPhatHanh(v.orderId, s);
  return { ok: true, data: veKetQua(v.hoaDonId, s) };
}

/**
 * "Bỏ, làm tay" bản LỖI: gỡ bản ghi, khoản về hàng chờ để kế toán làm ở MISA rồi tải lên. KHÔNG cần công tắc
 * MISA / cổng MISA (có chủ đích): tắt MISA đúng lúc còn bản lỗi thì phải nhả được khoản — không thì khoản kẹt.
 */
export async function boPhatHanhLamTayAction(input: unknown): Promise<KetQua<{ hoaDonId: string }>> {
  const p = banLoiSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "Yêu cầu không hợp lệ" };
  const v = p.data;
  const cong = await congKeToanDon(v.orderId);
  if (!cong.ok) return cong;

  const row = await dongMisaCuaHoaDon(cong.actor, v.orderId, v.hoaDonId);
  if (!row?.misa) return { ok: false, error: "Hoá đơn vừa đổi trạng thái — tải lại màn" };
  if (!row.misa.boLamTay.bat) return { ok: false, error: row.misa.boLamTay.lyDo ?? "Không bỏ được bản này" };
  if (row.misa.phienBan !== v.phienBan) return { ok: false, error: "Hoá đơn vừa đổi — tải lại màn rồi làm lại" };
  try {
    await boPhatHanhLamTay({
      nguoiBam: { id: cong.userId, name: cong.userName },
      orderId: v.orderId,
      hoaDonId: v.hoaDonId,
      phienBan: new Date(v.phienBan),
    });
  } catch (e) {
    const tb = thongDiepLoiPhatHanh(e);
    if (tb) return { ok: false, error: tb };
    throw e;
  }
  lamMoi(v.orderId);
  return { ok: true, data: { hoaDonId: v.hoaDonId } };
}
