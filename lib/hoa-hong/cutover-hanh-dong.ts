// lib/hoa-hong/cutover-hanh-dong.ts — ĐIỀU PHỐI trang «Chuyển sang hoa hồng mới» (Cấu hình vận hành → Hoa hồng → Chuyển hoa hồng): xem trước tác động · xác nhận · lịch sử.
//
// Nguồn: docs/source-commission/05 §2.2c + §7.5, 08 §11 bước 7. Hướng D+H của đợt UAT cutover.
// Server Action (`app/(admin)/admin/cau-hinh-van-hanh/chuyen-hoa-hong/_actions.ts`) CHỈ làm: auth → quyền → xác thực đầu vào → gọi các hàm này.
// Mọi luật nằm ở `cutover.ts` (cổng + ghi) · `cutover-kiem-tra.ts` (precheck) · `so-bong.ts` (phân loại chênh) — ở đây KHÔNG viết lại.
//
// ── Client KHÔNG BAO GIỜ ghi mốc trực tiếp ──────────────────────────────────────────────────────────────────────
// Màn hình chỉ gửi `{ mốc mới, lý do, mốc cũ đã thấy, dấu vân đã thấy, cửa sổ đã xem }`; server TÍNH LẠI toàn bộ bằng chứng rồi so (compare-and-set trong `datMocCutover`).
// Xem trước và xác nhận cùng đi qua `napGoiBangChung` + `danhGiaDatMoc` (cổng DUY NHẤT) nên «xem trước nói được» ⇔ «nút không bị server từ chối» (luật 12).
//
// ⚠️ KHÔNG kiểm QUYỀN CHỨC NĂNG ở đây (việc của Server Action, ngay đầu hàm, đúng key mà nút vẽ). `datMocCutover` còn tự gác `isSuperAdmin` — cùng một câu hỏi với `settings:edit`
// (ma trận v1: chỉ SUPER_ADMIN; không RoleDef nào khác giữ nó) nên nút / action / hàm ghi không thể lệch nhau.
// ⚠️ `now` BẮT BUỘC (luật 19). Tuyệt đối KHÔNG tính lại kỳ cũ bằng engine mới: trước mốc, lịch sử tài chính cũ chỉ đọc (CUT-4) — so bóng chỉ đọc, không ghi.
import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import {
  KHOA_KY_CUTOVER,
  danhGiaDatMoc,
  canhBaoChoDatMoc,
  datMocCutover,
  docMocCutover,
  napGoiBangChung,
  thongBaoDatMoc,
  type HanhDongDatMoc,
  type KetQuaDatMoc,
  type NguoiDatMoc,
} from "./cutover";
import { danhGiaSanSang, hanhDongCanPrecheck, type BangChungDoDuoc, type VanDeChan } from "./cutover-kiem-tra";
import { phuThuocCutoverThat, type ChiTietXem } from "./cutover-kiem-tra-db";
import { HoaHongError } from "./kieu";
import { khoangMacDinh, nhanChuaTinh } from "./mo-phong";
import { CAN_CU_NGAN, TRICH_DAN, type DongSoBong, type HoldLichSuMua, type MaExpected, type SoTienDong } from "./so-bong";

/** Trần số khoản so bóng mỗi lượt. Vượt ⇒ NÉM (không cắt) — thu hẹp cửa sổ. 3 tháng thực tế cỡ vài trăm khoản (05 §7.5 bước 3 nói «vài chục khoản mỗi kỳ»). */
export const TRAN_SO_KHOAN_SO_BONG = 1500;
/** Số dòng UNEXPECTED hiện ở bảng chi tiết (phần còn lại chỉ đếm theo mã). */
export const TOI_DA_DONG_CHENH = 30;

export type CuaSo = { tuNgay: string; denNgay: string };

export type KetQuaThanhCong<T = Record<never, never>> = { ok: true; thongBao: string } & T;
export type KetQuaThatBai = { ok: false; ma: string; loi: string };
export type KetQua<T = Record<never, never>> = KetQuaThanhCong<T> | KetQuaThatBai;

const thatBai = (ma: string, loi: string): KetQuaThatBai => ({ ok: false, ma, loi });

async function bao<T>(fn: () => Promise<KetQua<T>>): Promise<KetQua<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HoaHongError) return thatBai(e.ma, e.message);
    // Lỗi lạ ⇒ KHÔNG đưa chi tiết ra client (có thể chứa SQL/tên bảng); chỉ log tên lỗi.
    console.error("[hoa-hong/cutover] thao tác lỗi", e instanceof Error ? e.name : "?", e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "");
    return thatBai("LOI_LA", "Có lỗi khi thực hiện — thử lại, hoặc báo bộ phận kỹ thuật.");
  }
}

// ── Dữ liệu cho TRANG (JSON thuần — không Date, không Map) ───────────────────────────────────────────────────

export type NhomTheoMa = { ma: string; soDong: number; cu: number; moi: number; chenh: number; trichDan: string | null; canCuNgan: string | null };

export type TacDongUi = {
  cuaSo: CuaSo;
  asOf: string;
  phienBanLuat: string;
  boLuatPhanLoai: string;
  chinhSach: { policyCode: string; version: number }[];
  khoan: { tong: number; tinhDuoc: number; chuaTinh: number; ngoaiPhamVi: number; loiCauHinh: number };
  match: SoTienDong;
  expected: SoTienDong & { theoMa: NhomTheoMa[] };
  unexpected: SoTienDong & { theoMa: NhomTheoMa[] };
  /** Vài dòng UNEXPECTED đầu tiên (theo độ lớn chênh). */
  topUnexpected: DongSoBong[];
  chuaTinh: { soKhoan: number; soTienThu: number; tienCuDuKien: number; theoMa: { ma: string; nhan: string; soKhoan: number; mucDo: "SOFT" | "HARD"; soTienThu: number }[] };
  hold: { tong: number; khoanGiu: number; treoCoHangCho: number };
  /** Phần của `chuaTinh` do BỘ PHÂN LOẠI giữ vì lịch sử mua chưa chốt — chỉ để phân loại hiển thị, KHÔNG trừ khỏi `hold.tong` (xem `HoldLichSuMua`). */
  holdLichSuMua: HoldLichSuMua;
  ngoai: {
    khoanHoan: { soKhoan: number; soTien: number };
    khoanChuyenNoiBo: number;
    khoanKhongPhaiHocPhi: { soKhoan: number; soTien: number };
    trialTeacher: { soKhoan: number; soDong: number; soTien: number };
  };
  dauVanSoBong: string;
};

export type DiTruUi = {
  invalid: number;
  conThieuQuyNguon: number;
  manualReview: number;
  daDiTru: number;
  sanSangCuaCongCu: boolean;
  thieuBangQuyNguon: boolean;
  thieuDanhMuc: string[];
  noiDonNhieu: number;
};

export type XemTruoc = {
  cu: string | null;
  moi: string | null;
  hanhDong: HanhDongDatMoc | null;
  canPrecheck: boolean;
  sanSang: boolean;
  chan: VanDeChan[];
  canhBao: string[];
  dauVan: string;
  bangChung: BangChungDoDuoc;
  /** `null` khi hành động KHÔNG đòi precheck (dời muộn / gỡ) — không có so bóng để hiện. */
  tacDong: TacDongUi | null;
  diTru: DiTruUi | null;
  cuaSo: CuaSo;
};

const nhomTheoMa = (o: Record<string, SoTienDong>, coTrich: boolean): NhomTheoMa[] =>
  Object.entries(o)
    .map(([ma, x]) => ({ ma, soDong: x.soDong, cu: x.cu, moi: x.moi, chenh: x.chenh, trichDan: coTrich ? ((TRICH_DAN as Record<string, string>)[ma as MaExpected] ?? null) : null, canCuNgan: coTrich ? ((CAN_CU_NGAN as Record<string, string>)[ma as MaExpected] ?? null) : null }))
    .sort((a, b) => Math.abs(b.chenh) - Math.abs(a.chenh) || (a.ma < b.ma ? -1 : 1));

/** Rút `BaoCaoSoBong` thành thứ trang cần. KHÔNG mang toàn bộ dòng. */
export function tacDongTuChiTiet(c: ChiTietXem): TacDongUi {
  const b = c.baoCao;
  const topUnexpected = b.dong
    .filter((d) => d.loai === "UNEXPECTED")
    .sort((x, y) => Math.abs(y.chenh) - Math.abs(x.chenh) || (x.paymentId < y.paymentId ? -1 : 1))
    .slice(0, TOI_DA_DONG_CHENH);
  return {
    cuaSo: b.cuaSo,
    asOf: b.asOf,
    phienBanLuat: b.phienBanLuat,
    boLuatPhanLoai: b.boLuatPhanLoai,
    chinhSach: b.chinhSach.map((x) => ({ policyCode: x.policyCode, version: x.version })),
    khoan: b.khoan,
    match: { soDong: b.match.soDong, cu: b.match.cu, moi: b.match.moi, chenh: b.match.chenh },
    expected: { soDong: b.expected.soDong, cu: b.expected.cu, moi: b.expected.moi, chenh: b.expected.chenh, theoMa: nhomTheoMa(b.expected.theoMa, true) },
    unexpected: { soDong: b.unexpected.soDong, cu: b.unexpected.cu, moi: b.unexpected.moi, chenh: b.unexpected.chenh, theoMa: nhomTheoMa(b.unexpected.theoMa, false) },
    topUnexpected,
    chuaTinh: {
      soKhoan: b.chuaTinh.soKhoan,
      soTienThu: b.chuaTinh.soTienThu,
      tienCuDuKien: b.chuaTinh.tienCuDuKien,
      theoMa: Object.entries(b.chuaTinh.theoMa)
        .map(([ma, x]) => ({ ma, nhan: nhanChuaTinh(ma), soKhoan: x.soKhoan, mucDo: x.mucDo, soTienThu: x.soTienThu }))
        .sort((x, y) => y.soKhoan - x.soKhoan || (x.ma < y.ma ? -1 : 1)),
    },
    hold: b.hold,
    holdLichSuMua: b.holdLichSuMua,
    ngoai: b.ngoai,
    dauVanSoBong: b.dauVan,
  };
}

export function diTruTuChiTiet(c: ChiTietXem): DiTruUi {
  const t = c.diTru.tinhTrang;
  return {
    invalid: t.invalid,
    conThieuQuyNguon: t.conThieuQuyNguon,
    manualReview: t.manualReview,
    daDiTru: t.daDiTru,
    sanSangCuaCongCu: t.sanSang,
    thieuBangQuyNguon: c.diTru.thieuBangQuyNguon,
    thieuDanhMuc: [...c.diTru.thieuDanhMuc],
    noiDonNhieu: c.diTru.noiDonNhieu,
  };
}

// ── XEM TRƯỚC ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Cửa sổ so bóng mặc định = 3 THÁNG TRỌN VẸN gần nhất trước tháng hiện tại (`khoangMacDinh`, cùng thử tính). Trang gửi lại cửa sổ này khi xác nhận để dấu vân gắn với đúng cửa sổ đã xem.
 */
export const cuaSoMacDinh = (now: Date): CuaSo => khoangMacDinh(now);

/**
 * XEM TRƯỚC tác động của việc đặt mốc `moi`. KHÔNG GHI GÌ (đếm bảng trước/sau ở `[CUT-A02]`). Chạy ĐÚNG đường mà xác nhận sẽ chạy: `napGoiBangChung` rồi `danhGiaDatMoc` (đọc, không khoá).
 */
export async function xemTruocCutover(i: { moi: string | null; now: Date; cuaSo: CuaSo }): Promise<KetQua<{ xem: XemTruoc }>> {
  return bao(async () => {
    const giu: { c: ChiTietXem | null } = { c: null };
    const pt = phuThuocCutoverThat({ client: db, cuaSo: i.cuaSo, tranSoKhoan: TRAN_SO_KHOAN_SO_BONG, ghiNho: (c) => void (giu.c = c) });
    const truoc = await napGoiBangChung(db, pt, { moi: i.moi, now: i.now });
    const dg = await danhGiaDatMoc(db, { cu: truoc.cu, moi: i.moi, now: i.now, bangChung: truoc.goi.bangChung });
    const canPrecheck = hanhDongCanPrecheck(truoc.hanhDong);
    const ct = canPrecheck ? giu.c : null;
    // Cảnh báo không chặn: CÙNG hàm mà `datMocCutover` gọi lúc ghi audit ⇒ xem trước nói đúng những gì đặt thật sẽ ghi.
    const canhBao = await canhBaoChoDatMoc(db, i.moi, truoc.hanhDong);
    const danhGia = danhGiaSanSang({
      hanhDong: truoc.hanhDong,
      quyetDinh: dg.quyetDinh.ok ? { ok: true } : { ok: false, ma: dg.quyetDinh.ma, lyDo: dg.quyetDinh.lyDo },
      bangChung: truoc.goi.bangChung,
      chiTiet: ct ? ct.diTru : null,
      canhBao,
    });
    return {
      ok: true,
      thongBao: (danhGia.sanSang ? "Đủ điều kiện đặt mốc." : `Còn ${danhGia.chan.length} vấn đề chặn.`) + (danhGia.canhBao.length > 0 ? ` Có ${danhGia.canhBao.length} cảnh báo không chặn.` : ""),
      xem: {
        cu: truoc.cu,
        moi: i.moi,
        hanhDong: truoc.hanhDong,
        canPrecheck,
        sanSang: danhGia.sanSang,
        chan: danhGia.chan,
        canhBao: danhGia.canhBao,
        dauVan: truoc.goi.dauVan,
        bangChung: truoc.goi.bangChung,
        tacDong: ct ? tacDongTuChiTiet(ct) : null,
        diTru: ct ? diTruTuChiTiet(ct) : null,
        cuaSo: i.cuaSo,
      },
    };
  });
}

// ── XÁC NHẬN ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * XÁC NHẬN: người dùng gửi lại đúng cái đã xem (`cuDaXem`, `dauVanDaXem`, cửa sổ). Server nạp lại bằng chứng NGOÀI khoá, rồi `datMocCutover` so trong khoá:
 * mốc đã đổi ⇒ `MOC_DA_DOI`, số liệu đã đổi ⇒ `SO_LIEU_DA_DOI` — cả hai KHÔNG ghi gì.
 */
export async function xacNhanCutover(
  nguoi: NguoiDatMoc,
  i: { moi: string | null; lyDo: string; now: Date; cuaSo: CuaSo; cuDaXem: string | null; dauVanDaXem: string },
): Promise<KetQua<{ ketQua: KetQuaDatMoc }>> {
  return bao(async () => {
    const pt = phuThuocCutoverThat({ client: db, cuaSo: i.cuaSo, tranSoKhoan: TRAN_SO_KHOAN_SO_BONG });
    const ketQua = await datMocCutover(db, nguoi, { mocMoi: i.moi, lyDo: i.lyDo, now: i.now, cuDaXem: i.cuDaXem, dauVanDaXem: i.dauVanDaXem, phuThuoc: pt });
    return { ok: true, thongBao: thongBaoDatMoc(ketQua), ketQua };
  });
}

// ── ĐỌC cho trang ──────────────────────────────────────────────────────────────────────────────────────────

/** Mốc HIỆN TẠI, đọc THẲNG DB (không qua `getSetting`, cache 300 giây): một trang nói về cổng tiền không được hiện mốc cũ 5 phút. */
export const docMocHienTai = (): Promise<string | null> => docMocCutover(db);

export type DongLichSu = {
  id: string;
  luc: string;
  nguoi: string;
  hanhDong: string;
  cu: string | null;
  moi: string | null;
  lyDo: string;
  dauVan: string | null;
  bangChung: BangChungDoDuoc | null;
  soExpected: number | null;
  soUnexpected: number | null;
};

const laObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const chuoiHoacNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const soHoacNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Lịch sử đặt mốc, MỚI nhất trước. Lọc đúng cặp `module = hoa-hong` · `entityId = hoaHong.kyCutover` (không mở sang trang nhật ký tổng — quyền riêng). */
export async function docLichSuCutover(gioiHan: number): Promise<DongLichSu[]> {
  const rows = await db.auditLog.findMany({
    where: { module: "hoa-hong", entityType: "SystemSetting", entityId: KHOA_KY_CUTOVER },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: gioiHan,
    select: { id: true, createdAt: true, actorName: true, action: true, oldValues: true, newValues: true, reason: true },
  });
  return rows.map((r) => {
    const nv = laObj(r.newValues) ? r.newValues : {};
    const ov = laObj(r.oldValues) ? r.oldValues : {};
    const bc = laObj(nv.bangChung) ? nv.bangChung : null;
    const tt = laObj(nv.tomTat) ? nv.tomTat : null;
    const ex = tt && laObj(tt.expected) ? soHoacNull(tt.expected.soDong) : null;
    const un = tt && laObj(tt.unexpected) ? soHoacNull(tt.unexpected.soDong) : null;
    return {
      id: r.id,
      luc: r.createdAt.toISOString(),
      nguoi: r.actorName,
      hanhDong: chuoiHoacNull(nv.hanhDong) ?? r.action,
      cu: chuoiHoacNull(ov.value),
      moi: chuoiHoacNull(nv.value),
      lyDo: r.reason ?? "",
      dauVan: chuoiHoacNull(nv.dauVan),
      bangChung:
        bc && soHoacNull(bc.invalidAttribution) !== null
          ? {
              invalidAttribution: soHoacNull(bc.invalidAttribution),
              holdNghiemTrongDuKien: soHoacNull(bc.holdNghiemTrongDuKien),
              unexpectedDelta: soHoacNull(bc.unexpectedDelta),
              diTruChuaSanSang: typeof bc.diTruChuaSanSang === "boolean" ? bc.diTruChuaSanSang : null,
            }
          : null,
      soExpected: ex,
      soUnexpected: un,
    };
  });
}
