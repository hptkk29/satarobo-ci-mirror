// lib/hoa-hong/ky-hanh-dong.ts — ĐIỀU PHỐI các thao tác ghi của tab Kỳ (06 §5.4): Tính · Chuyển rà soát · Trả lại · KHOÁ · Xuất bảng chi · Đánh dấu đã chi.
// Server Action (`.../ky/_actions.ts`) CHỈ làm: auth → quyền → gọi các hàm này → làm mới trang. Mọi luật nghiệp vụ (vòng đời, hai cổng khoá, kết chuyển âm,
// phạm vi cơ sở) nằm ở `ky-service.ts` / `xuat-ky.ts` — ở đây KHÔNG viết lại; chỉ thêm những gì lớp mỏng này phải lo:
//
//   · cờ gác (engine bật · xuất bảng chi bật) — "cờ tắt = màn không tồn tại" phải đúng cả với người gọi thẳng Server Action;
//   · tạo kỳ khi bấm Tính lần đầu (lượt Tính đầu tạo kỳ — 04 §12.1), SAU khi đã kiểm phạm vi (`bamKy` là phép GHI);
//   · bản chụp số liệu: hộp thoại khoá hiện N đồng cho N người ⇒ server chụp lại và so TRƯỚC khi khoá — "xác nhận khoá" là xác nhận ĐÚNG số đã đọc;
//   · dịch lỗi về câu tiếng Việt + mã (`HoaHongError.ma`), lỗi lạ chỉ log tên (không lộ SQL/tên bảng ra client).
//
// ⚠️ KHÔNG kiểm QUYỀN CHỨC NĂNG (`commission_periods:manage`) — đó là việc của Server Action ngay đầu hàm (luật cứng Nền #1). Phạm vi cơ sở GHI do service lo
// (`batPhamViKy`/`passesScope`): `scopedDb` không che ghi (CLAUDE.md luật 5).
// ⚠️ `now` BẮT BUỘC (luật 19) và `PhuThuoc` BẮT BUỘC (luật 7): hàm không tự đọc đồng hồ, không tự đọc cờ — chỗ gọi nói rõ.
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { passesScope } from "@/lib/db-scope";
import { getSetting } from "@/lib/settings/service";

import { dungBoiCanhQuet, type KetQuaBoiCanh } from "./boi-canh";
import { laEngineHoaHongBat, laXuatLuongBat } from "./feature";
import { chupSoLieuKy, type LoaiLo } from "./ky-doc";
import { bamKy } from "./ky-db";
import { nhanThangKy, soLieuKhop, type SoLieuKy } from "./ky-man-hinh";
import { lyDoKhongDoiDuoc } from "./hang-cho-so-nhom";
import { HoaHongError } from "./kieu";
import { batPhamViKy, chuyenRaSoat, doiHangChoSangKySau, khoaKyHoaHong, tinhKy, traLaiKy, type NguoiThaoTacKy } from "./ky-service";
import { docDonViCuaCoSo } from "./nap-khoan";
import { dinhDangDong } from "./vi-sao";
import { danhDauDaChi, xuatBangChi } from "./xuat-ky";

/** Mọi thứ đọc từ cấu hình/cờ — truyền vào để test dựng được mà không đụng bộ nhớ đệm 300 giây của `getSetting`. */
export type PhuThuoc = {
  engineBat: () => Promise<boolean>;
  xuatLuongBat: () => Promise<boolean>;
  dungBoiCanh: (now: Date) => Promise<KetQuaBoiCanh>;
  soThangDoiSoat: () => Promise<number>;
};

export const PHU_THUOC_THAT: PhuThuoc = {
  engineBat: () => laEngineHoaHongBat(),
  xuatLuongBat: () => laXuatLuongBat(),
  dungBoiCanh: (now) => dungBoiCanhQuet(db, now),
  soThangDoiSoat: () => getSetting("hoaHong.soThangDoiSoat"),
};

export type TepXuat = { tenTep: string; base64: string };

export type KetQuaThanhCong<T = Record<never, never>> = { ok: true; thongBao: string } & T;
export type KetQuaThatBai = {
  ok: false;
  /** Mã máy — `HoaHongError.ma`, hoặc `ENGINE_TAT` / `XUAT_TAT` / `SO_LIEU_DA_DOI` / `LOI_LA`. */
  ma: string;
  loi: string;
  /** Vài dòng chi tiết (vd khoản nào không tính được). */
  chiTiet?: string[];
};
export type KetQua<T = Record<never, never>> = KetQuaThanhCong<T> | KetQuaThatBai;

const thatBai = (ma: string, loi: string, chiTiet?: string[]): KetQuaThatBai => ({ ok: false, ma, loi, ...(chiTiet ? { chiTiet } : {}) });

/** Tối đa bao nhiêu khoản lỗi in ra màn (phần còn lại gộp thành "và N khoản khác"). */
const TOI_DA_CHI_TIET = 5;

function chiTietCuaLoi(e: HoaHongError): string[] | undefined {
  const ct = e.chiTiet;
  if (!Array.isArray(ct) || ct.length === 0) return undefined;
  const dong = ct.slice(0, TOI_DA_CHI_TIET).map((x) => {
    const o = x as { paymentId?: unknown; thongDiep?: unknown };
    return typeof o?.thongDiep === "string" ? `${typeof o.paymentId === "string" ? `Khoản ${o.paymentId}: ` : ""}${o.thongDiep}` : String(x);
  });
  if (ct.length > TOI_DA_CHI_TIET) dong.push(`… và ${ct.length - TOI_DA_CHI_TIET} khoản khác.`);
  return dong;
}

async function bao<T>(fn: () => Promise<KetQua<T>>): Promise<KetQua<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HoaHongError) return thatBai(e.ma, e.message, chiTietCuaLoi(e));
    // Lỗi lạ ⇒ KHÔNG đưa chi tiết ra client (có thể chứa SQL/tên bảng); chỉ log tên lỗi.
    console.error("[hoa-hong/ky] thao tác lỗi", e instanceof Error ? e.name : "?", e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "");
    return thatBai("LOI_LA", "Có lỗi khi thực hiện — thử lại, hoặc báo bộ phận kỹ thuật.");
  }
}

const ENGINE_TAT = thatBai("ENGINE_TAT", "Hoa hồng theo kỳ mới đang tắt — chưa thao tác được trên kỳ.");
const XUAT_TAT = thatBai("XUAT_TAT", "Xuất bảng chi đang tắt — kỳ dừng ở “đã khoá”. Nhờ quản trị hệ thống bật mục “Cho xuất bảng chi hoa hồng” ở Cấu hình vận hành.");

// ── Tính ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * TÍNH kỳ (tháng × cơ sở). Kỳ chưa có thì mở (lượt Tính đầu tạo kỳ) — SAU khi đã kiểm phạm vi và mốc cutover, vì `bamKy` là phép ghi.
 * Chỉ Tính được kỳ OPEN/CALCULATED — cổng nằm ở `tinhKy` (TRƯỚC lượt quét), không lặp lại ở đây.
 */
export async function tinhKyHanhDong(
  pt: PhuThuoc,
  i: { nguoi: NguoiThaoTacKy; now: Date; thang: string; centerId: string },
): Promise<KetQua<{ soKhoan: number }>> {
  return bao(async () => {
    const b = await pt.dungBoiCanh(i.now);
    if (b.loai === "TAT") {
      return b.lyDo === "ENGINE_TAT" ? ENGINE_TAT : thatBai("CHUA_CO_MOC_CUTOVER", "Chưa đặt mốc chuyển sang hoa hồng mới — chưa có kỳ nào để tính.");
    }
    if (i.thang < b.bc.kyCutover) {
      return thatBai("KY_TRUOC_MOC", `Kỳ ${nhanThangKy(i.thang)} thuộc sổ cũ (mốc chuyển là ${nhanThangKy(b.bc.kyCutover)}) — tính ở /crm/commission.`);
    }
    // Phạm vi TRƯỚC khi có bất kỳ phép ghi nào (bamKy tạo kỳ).
    if (!passesScope("CommissionPeriod", { centerId: i.centerId }, i.nguoi.quyen)) {
      throw new HoaHongError("NGOAI_PHAM_VI", `Kỳ ${i.thang} thuộc cơ sở ngoài phạm vi của bạn.`);
    }
    const cu = await db.commissionPeriod.findFirst({ where: { period: i.thang, centerId: i.centerId }, select: { id: true } });
    let periodId = cu?.id;
    if (!periodId) {
      const dv = await docDonViCuaCoSo(db, i.centerId);
      if (!dv) throw new HoaHongError("CO_SO_CHUA_CO_DON_VI", "Cơ sở này chưa có đơn vị (OrgUnit) tương ứng — chưa mở kỳ được.");
      periodId = (await bamKy(db, { thang: i.thang, centerId: i.centerId, orgUnitId: dv.orgUnitId, kyCutover: b.bc.kyCutover })).id;
    }
    const kq = await tinhKy(db, b.bc, { periodId, soThangDoiSoat: await pt.soThangDoiSoat(), actor: i.nguoi });
    return { ok: true, thongBao: `Đã tính kỳ ${nhanThangKy(i.thang)} — quét ${kq.tongKet.soKhoan} khoản.`, soKhoan: kq.tongKet.soKhoan };
  });
}

// ── Chuyển rà soát · Trả lại · Khoá ───────────────────────────────────────────────────────────────────

export async function chuyenRaSoatHanhDong(pt: PhuThuoc, i: { nguoi: NguoiThaoTacKy; now: Date; periodId: string }): Promise<KetQua> {
  return bao(async () => {
    if (!(await pt.engineBat())) return ENGINE_TAT;
    await chuyenRaSoat(db, { periodId: i.periodId, actor: i.nguoi, now: i.now });
    return { ok: true, thongBao: "Đã chuyển kỳ sang rà soát." };
  });
}

export async function traLaiHanhDong(pt: PhuThuoc, i: { nguoi: NguoiThaoTacKy; now: Date; periodId: string; lyDo: string }): Promise<KetQua> {
  return bao(async () => {
    if (!(await pt.engineBat())) return ENGINE_TAT;
    await traLaiKy(db, { periodId: i.periodId, actor: i.nguoi, now: i.now, lyDo: i.lyDo });
    return { ok: true, thongBao: "Đã trả kỳ về “đã tính” — Tính lại rồi chuyển rà soát." };
  });
}

/**
 * KHOÁ kỳ. `daThay` là bản chụp số liệu mà hộp thoại đã hiện: server chụp lại và so — lệch ⇒ `SO_LIEU_DA_DOI`, kỳ nguyên trạng. Hai cổng khoá
 * (còn hàng chờ chặn · đầu vào trôi) do `khoaKyHoaHong` kiểm trong transaction; bấm lén khi UI không vẽ nút vẫn bị từ chối ở đó.
 */
export async function khoaHanhDong(
  pt: PhuThuoc,
  i: { nguoi: NguoiThaoTacKy; now: Date; periodId: string; lyDo: string; daThay: SoLieuKy },
): Promise<KetQua> {
  return bao(async () => {
    if (!(await pt.engineBat())) return ENGINE_TAT;
    const k = await db.commissionPeriod.findUnique({ where: { id: i.periodId }, select: { period: true, centerId: true } });
    if (!k) throw new HoaHongError("KY_KHONG_TON_TAI", `Kỳ ${i.periodId} không tồn tại.`);
    batPhamViKy(k, i.nguoi); // phạm vi TRƯỚC khi đọc số: kỳ ngoài tầm nhìn không lộ cả việc "số có khớp hay không"
    const hien = await chupSoLieuKy(i.periodId);
    if (!hien || !soLieuKhop(i.daThay, hien)) {
      return thatBai("SO_LIEU_DA_DOI", "Số liệu của kỳ đã đổi từ lúc bạn mở hộp thoại — đóng hộp thoại, đọc lại số mới rồi khoá.");
    }
    await khoaKyHoaHong(db, { periodId: i.periodId, actor: i.nguoi, now: i.now, lyDo: i.lyDo });
    return { ok: true, thongBao: `Đã khoá kỳ ${nhanThangKy(k.period)}.` };
  });
}

// ── Dời hàng chờ sang kỳ sau ──────────────────────────────────────────────────────────────────────────

/**
 * DỜI MỘT hàng chờ đang chặn khoá sang kỳ kế tiếp (04 §10.5). Thứ tự cổng — TẤT CẢ đứng trước `doiHangChoSangKySau`, vì service gọi `bamKy` (mở kỳ SAU = phép GHI) trước transaction của nó:
 *   cờ engine/mốc cutover → hàng chờ có thật → phạm vi cơ sở → hàng chờ DỜI ĐƯỢC (cùng hàm `lyDoKhongDoiDuoc` với nút ở tab Sổ — luật 12) → service (lý do ≥ 10 ký tự, audit DEFER).
 * Người gọi lén vào hàng chờ sai mã / đã đóng / không chặn kỳ nào bị từ chối ở đây và KHÔNG có kỳ nào được tạo.
 */
export async function doiHangChoSangKyHanhDong(
  pt: PhuThuoc,
  i: { nguoi: NguoiThaoTacKy; now: Date; holdId: string; lyDo: string },
): Promise<KetQua<{ kySau: string }>> {
  return bao(async () => {
    const b = await pt.dungBoiCanh(i.now);
    if (b.loai === "TAT") {
      return b.lyDo === "ENGINE_TAT" ? ENGINE_TAT : thatBai("CHUA_CO_MOC_CUTOVER", "Chưa đặt mốc chuyển sang hoa hồng mới — chưa có kỳ nào để dời sang.");
    }
    const h = await db.commissionHold.findUnique({
      where: { id: i.holdId },
      select: { code: true, status: true, blockingPeriodId: true, centerId: true, blockingPeriod: { select: { period: true, centerId: true } } },
    });
    if (!h) return thatBai("HANG_CHO_KHONG_MO", "Hàng chờ không tồn tại hoặc đã đóng.");
    // Phạm vi TRƯỚC khi nói gì về loại/trạng thái: người ngoài phạm vi không được biết hàng chờ ấy mã gì. Hàng chờ chặn kỳ ⇒ phạm vi của KỲ; không chặn kỳ nào ⇒ của chính hàng chờ.
    if (h.blockingPeriod) batPhamViKy(h.blockingPeriod, i.nguoi);
    else if (!passesScope("CommissionHold", { centerId: h.centerId }, i.nguoi.quyen)) {
      throw new HoaHongError("NGOAI_PHAM_VI", "Hàng chờ thuộc cơ sở ngoài phạm vi của bạn.");
    }
    const tu = lyDoKhongDoiDuoc(h);
    if (tu) return thatBai(tu.ma, tu.loi);
    const r = await doiHangChoSangKySau(db, b.bc, { holdId: i.holdId, actor: i.nguoi, now: i.now, lyDo: i.lyDo });
    return { ok: true, thongBao: `Đã dời hàng chờ sang kỳ ${nhanThangKy(r.kySau)} — kỳ ${nhanThangKy(h.blockingPeriod!.period)} không còn bị hàng chờ này chặn.`, kySau: r.kySau };
  });
}

// ── Xuất bảng chi · Đánh dấu đã chi ───────────────────────────────────────────────────────────────────

export type KetQuaXuatBangChi = {
  batchId: string;
  soDong: number;
  tongChi: number;
  soKyDaKhoa: number;
  soKyChuaKhoa: number;
  soKyNgoaiPhamVi: number;
  amKetChuyen: { nguoi: string; so: number }[];
  tep: TepXuat;
};

/**
 * XUẤT bảng chi tháng `thang` cho MỘT loại lô. Gác bởi cờ `hoaHong.xuatLuongBat` (cùng hàm với nút). Lượt xuất là phép ghi không lặp lại được —
 * bấm lần hai trên tháng đã xuất hết bị `KHONG_CO_DONG_DE_XUAT` ở service; tệp xlsx chỉ trả về MỘT lần ở đây.
 */
export async function xuatHanhDong(
  pt: PhuThuoc,
  i: { nguoi: NguoiThaoTacKy; now: Date; thang: string; kind: LoaiLo; lyDo: string },
): Promise<KetQua<{ xuat: KetQuaXuatBangChi }>> {
  return bao(async () => {
    if (!(await pt.engineBat())) return ENGINE_TAT;
    if (!(await pt.xuatLuongBat())) return XUAT_TAT;
    const r = await xuatBangChi(db, { thang: i.thang, kind: i.kind, actor: i.nguoi, now: i.now, lyDo: i.lyDo });
    const tenTep = `hoa-hong-${i.kind === "PAYROLL" ? "bang-luong" : "quyet-toan"}-${i.thang}.xlsx`;
    return {
      ok: true,
      thongBao: `Đã xuất ${r.soDong} dòng, tổng chi ${dinhDangDong(r.tongChi)}.`,
      xuat: {
        batchId: r.batchId,
        soDong: r.soDong,
        tongChi: r.tongChi,
        soKyDaKhoa: r.soKyDaKhoa,
        soKyChuaKhoa: r.soKyChuaKhoa,
        soKyNgoaiPhamVi: r.soKyNgoaiPhamVi,
        amKetChuyen: r.amKetChuyen,
        tep: { tenTep, base64: r.xlsx.toString("base64") },
      },
    };
  });
}

export async function danhDauDaChiHanhDong(
  pt: PhuThuoc,
  i: { nguoi: NguoiThaoTacKy; now: Date; batchId: string; lyDo: string },
): Promise<KetQua<{ soDong: number; soKyPaid: number }>> {
  return bao(async () => {
    if (!(await pt.engineBat())) return ENGINE_TAT;
    if (!(await pt.xuatLuongBat())) return XUAT_TAT;
    const r = await danhDauDaChi(db, { batchId: i.batchId, actor: i.nguoi, now: i.now, lyDo: i.lyDo });
    return { ok: true, thongBao: `Đã đánh dấu đã chi ${r.soDong} dòng.`, soDong: r.soDong, soKyPaid: r.soKyPaid };
  });
}
