// lib/hoa-hong/so-bong-db.ts — SO BÓNG engine cũ ↔ mới: phần NẠP dữ liệu (CHỈ ĐỌC) + điều phối. Luật phân loại nằm ở `so-bong.ts`.
//
// Nguồn: docs/source-commission/05 §7.5 bước 3. Hướng D+H của đợt UAT cutover. Khuôn tái dùng: `mo-phong-db.ts` (cùng `lapThu`, cùng mốc cutover giả).
//
// ── Hai phía, MỘT khoản thu ─────────────────────────────────────────────────────────────────────────────────────
//   CŨ : `mapButToanHoaHong([bút toán], toàn bộ sổ phân công)` → `tinhHoaHongTheoKy({ period: kỳ của bút toán })` — đúng chuỗi mà `chotKyHoaHong` và
//        `legacy-reversal.ts` dùng, nhưng gọi TỪNG bút toán một để có khoá khoản × vai × người (engine cũ vốn gom theo tầng × người × lead, không theo khoản).
//   MỚI: `lapThu` (nạp chủ sở hữu · cơ sở · học viên · phân loại · nguồn · người hưởng · cửa sổ ghi công · VAT) → `tinhDongChoKhoan`.
//
// ── Vì sao mốc cutover của `lapThu` là `KY_SOM_NHAT`, KHÔNG phải kỳ P ─────────────────────────────────────────────
// Cửa sổ so bóng là QUÁ KHỨ, mọi khoản nằm ở tháng TRƯỚC P. Với mốc = P, `chuSoHuuButToan` trả «CŨ» cho mọi khoản ⇒ `lapThu` trả BO_QUA ⇒ phía mới RỖNG và
// mọi dòng cũ hoá UNEXPECTED. Câu hỏi của so bóng là «nếu engine mới tính khoản này thì ra bao nhiêu», không phải «engine nào đang sở hữu tháng này» (khuôn thử tính).
// BỘ CHÍNH SÁCH thì lấy riêng: những quy tắc có hiệu lực tại ĐẦU KỲ P (đúng bộ sẽ chạy ngày cutover), rồi dời hiệu lực về đầu thời gian để áp lên khoản của
// cửa sổ; bộ này cũng là thứ `lapThu` dùng để nạp người hưởng (chỉ nạp cho vai có quy tắc) — nên phải đặt vào `bc` TRƯỚC khi gọi.
//
// ── Bất biến: KHÔNG ghi gì ──────────────────────────────────────────────────────────────────────────────────────
// Không transaction, không sổ / ô / hàng chờ / kỳ / audit / sự kiện. Hàm cấp thấp `lapThu(client: PrismaClient, …)` KHÔNG nhận được `TransactionClient`, và
// `quet-khoan.ts` không phải của tệp này — nên «chỉ đọc» ở tầng lib được giữ bằng lưới `[SBG-W2]` (không có lệnh ghi nào trong `so-bong*.ts`) cộng ca DB `[SBG-09]`
// (đếm dòng các bảng sổ / hàng chờ / kỳ / audit TRƯỚC và SAU), chứ KHÔNG bằng transaction READ ONLY. Script in báo cáo thì chạy trên kết nối đặt
// `default_transaction_read_only=on` ở mức kết nối (`scripts/hoa-hong/so-bong.ts`).
//
// ── Dữ liệu là của HÔM NAY ──────────────────────────────────────────────────────────────────────────────────────
// Nguồn lead, người phụ trách dùng dữ liệu hiện tại (04 §14). Phân loại NEW/RENEWAL từ luật v2 là TẤT ĐỊNH theo thứ tự mua (04 §5.2 «Luật v2») — không còn phụ thuộc thời điểm quét như bản v1 (08 §14 mục 23 đã đảo).
// Báo cáo vẫn ghi `asOf` vì nguồn/người phụ trách là dữ liệu của HÔM NAY.
//
// ⚠️ `now` · cửa sổ · kỳ P · `tranSoKhoan` đều BẮT BUỘC (luật 7 + 19). Vượt trần số khoản ⇒ NÉM (không cắt im lặng: một lượt so bóng bị cắt mà vẫn báo «0 chênh»
// là cổng mở oan).
import type { PrismaClient } from "@prisma/client";

import { pickEffectiveRates } from "@/lib/crm/commission-config";
import { SELECT_HOA_HONG, SELECT_PHAN_CONG, mapButToanHoaHong, type HangThanhToanHoaHong } from "@/lib/crm/commission-run";
import { khoangKy, kyCuaButToan, tinhHoaHongTheoKy } from "@/lib/crm/commission-thuc-thu";
import { WHERE_THUC_THU } from "@/lib/finance/thuc-thu";

import { dungBoiCanhTuMoc, type BoiCanhQuet } from "./boi-canh";
import type { QuyTac } from "./chon-quy-tac";
import { mucCuaHangCho } from "./hang-cho";
import { HoaHongError } from "./kieu";
import { loaiButToan } from "./but-toan";
import { dangHieuLucTai, khoangThoiDiem, kiemKhoang } from "./mo-phong";
import { KY_SOM_NHAT } from "./mo-phong-db";
import { conThucThu, docConNoTheoDong, docHocVienTheoLeadChild, docKhoan, dongPhanBoCua, hangButToanCua, type KhoanNap } from "./nap-khoan";
import { ngayVN } from "./ngay-lam-viec";
import { phanBoKhoan } from "./phan-bo-khoan";
import { lapThu } from "./quet-khoan";
import {
  thanhPhanKhoanBoQua,
  tongHopSoBong,
  type BaoCaoSoBong,
  type ChinhSachHieuLuc,
  type DongCu,
  type DongMoi,
  type KhoanSoBong,
  type NgoaiPhamViNap,
  type PhiaMoi,
  type ThanhPhanNgoai,
  type VaiDuKien,
} from "./so-bong";
import { tinhDongChoKhoan } from "./tinh-dong-cho-khoan";
import { vaiCuaTangCu } from "./legacy-reversal";

/** Số khoản xử lý song song (mỗi khoản ~10 câu đọc) — vừa phải để không chiếm hết pool kết nối. */
const SONG_SONG = 6;
const DANG_THANG = /^\d{4}-(0[1-9]|1[0-2])$/;

export type DauVaoSoBong = {
  client: PrismaClient;
  /** Đồng hồ của lượt chạy — BẮT BUỘC (luật 19). */
  now: Date;
  /** Kỳ P «YYYY-MM»: bộ chính sách là bộ hiệu lực tại ĐẦU kỳ này. */
  kyP: string;
  /** Cửa sổ ngày VN «YYYY-MM-DD», gồm cả hai đầu; `denNgay` không được ở tương lai. BẮT BUỘC — không có cửa sổ mặc định ngầm. */
  tuNgay: string;
  denNgay: string;
  /** Trần số khoản thu xét; vượt ⇒ NÉM `QUA_NHIEU_KHOAN`. */
  tranSoKhoan: number;
};

/** Dời hiệu lực về đầu thời gian để bộ quy tắc áp lên khoản của CẢ cửa sổ (viết lại ở đây: `mo-phong.ts` không export). */
const doiHieuLuc = (q: QuyTac): QuyTac => ({ ...q, effectiveFrom: new Date(0), effectiveTo: null, trangThai: "ACTIVE" });

/** Bộ quy tắc hiệu lực tại đầu kỳ P (đã dời hiệu lực) + danh sách phiên bản của nó (vào dấu vân). */
export function boQuyTacTaiKy(quyTacDaNap: readonly QuyTac[], kyP: string): { quyTac: QuyTac[]; chinhSach: ChinhSachHieuLuc[] } {
  const dau = khoangKy(kyP).start;
  const hieuLuc = quyTacDaNap.filter((q) => dangHieuLucTai(q, dau));
  const theoPhienBan = new Map<string, ChinhSachHieuLuc>();
  for (const q of hieuLuc) theoPhienBan.set(q.versionId, { policyCode: q.policyCode, versionId: q.versionId, version: q.version });
  return { quyTac: hieuLuc.map(doiHieuLuc), chinhSach: [...theoPhienBan.values()] };
}

export function kiemDauVaoSoBong(i: Pick<DauVaoSoBong, "now" | "kyP" | "tuNgay" | "denNgay" | "tranSoKhoan">): void {
  if (!DANG_THANG.test(i.kyP)) throw new HoaHongError("KY_KHONG_HOP_LE", `Kỳ P «${i.kyP}» sai dạng YYYY-MM.`);
  const loi = kiemKhoang(i.tuNgay, i.denNgay);
  if (loi) throw new HoaHongError("KHOANG_KHONG_HOP_LE", loi);
  if (i.denNgay > ngayVN(i.now)) throw new HoaHongError("KHOANG_KHONG_HOP_LE", "Cửa sổ so bóng không được kết thúc ở tương lai — chưa có dữ liệu để so.");
  if (!Number.isInteger(i.tranSoKhoan) || i.tranSoKhoan < 1) throw new HoaHongError("DU_LIEU_KHONG_HOP_LE", "Trần số khoản so bóng phải là số nguyên dương.");
}

/**
 * Thành phần của một khoản mà `lapThu` đã loại ra ngoài (`BO_QUA`). `lapThu` chỉ trả «NGOAI_PHAM_VI» chung cho cả học cụ lẫn lệ phí khác; so bóng phải tách,
 * vì chỉ học cụ có tài liệu nói rõ là cố ý (D17). Dựng lại ĐÚNG đầu vào mà `lapThu` đưa cho `phanBoKhoan` (quet-khoan.ts, bước 3).
 * Phân bổ ĐÃ cho qua (không còn là NGOAI_PHAM_VI) mà khoản vẫn bị loại ⇒ nơi duy nhất còn lại là bộ phân loại NEW/RENEWAL ⇒ `THEO_PHAN_LOAI` (quyết định ở `thanhPhanKhoanBoQua`, thuần).
 * Trong thân `lapThu` chỉ có BA chỗ trả `BO_QUA`: `KHONG_PHAI_CHU` (mốc giả `KY_SOM_NHAT` nên không xảy ra ở đây), `NGOAI_PHAM_VI` từ phân bổ, `NGOAI_PHAM_VI` từ bộ phân loại — vì vậy
 * truyền `lap.lyDo` xuống để tổ hợp lạ (lý do khác) rơi về `KHAC` thay vì bị nhận vơ. KHÔNG gọi `phanLoaiDongDon` ở đây (lưới `[PLD-W2]` ghim đúng hai nơi gọi).
 */
async function thanhPhanNgoaiPhamVi(client: PrismaClient, p: KhoanNap, lyDoBoQua: string): Promise<ThanhPhanNgoai> {
  const order = p.order;
  const hocVienLC = await docHocVienTheoLeadChild(client, order.leadChildId);
  let dongGoi = p.orderItemId;
  if (!dongGoi && p.adjustmentOfId) {
    const slotGoc = await client.commissionCalcSlot.findFirst({ where: { paymentId: p.adjustmentOfId }, select: { orderItemKey: true } });
    dongGoi = slotGoc && slotGoc.orderItemKey !== "-" ? slotGoc.orderItemKey : (p.adjustmentOf?.orderItemId ?? null);
  }
  const pb = phanBoKhoan({
    soTien: p.amount,
    orderItemId: dongGoi,
    enrollmentId: p.enrollmentId,
    enrollmentStudentId: p.enrollment?.studentId ?? null,
    orderType: order.type,
    dongDon: dongPhanBoCua(order),
    hocVienTheoLeadChild: hocVienLC,
    conNoTheoDong: await docConNoTheoDong(client, p, hocVienLC),
  });
  return thanhPhanKhoanBoQua(pb, lyDoBoQua);
}

type PhiaCuNap = { cu: DongCu[]; laTaiTuc: boolean };

type KetQuaMotKhoan =
  | { loai: "SO"; khoan: KhoanSoBong }
  | { loai: "NGOAI"; lyDo: "CHUYEN_NOI_BO" | "KHONG_CON_THUC_THU" };

export async function chaySoBong(i: DauVaoSoBong): Promise<BaoCaoSoBong> {
  kiemDauVaoSoBong(i);
  const { client } = i;

  // ── Bối cảnh: bộ chính sách hiệu lực tại đầu P, mốc cutover GIẢ ──────────────────────────────────────────
  const goc = await dungBoiCanhTuMoc(client, i.now, KY_SOM_NHAT);
  const { quyTac, chinhSach } = boQuyTacTaiKy(goc.hoaHong.quyTac, i.kyP);
  const bc: BoiCanhQuet = { ...goc, now: i.now, kyCutover: KY_SOM_NHAT, hoaHong: { ...goc.hoaHong, quyTac }, coPhamViRole: quyTac.some((q) => q.scopeType === "ROLE") };
  const vaiHuong = new Map(bc.hoaHong.vaiHuong.map((v) => [v.code, v]));
  // Trạng thái GỐC của phiên bản chứa mỗi rule — `boQuyTacTaiKy` ép "ACTIVE" để rule áp lên cả cửa sổ, nên điều kiện «đã phát hành» (D-D) phải đọc từ bộ quy tắc CHƯA ép.
  const ruleDaPhatHanh = new Set(goc.hoaHong.quyTac.filter((q) => q.trangThai !== "DRAFT" && q.trangThai !== "CANCELLED").map((q) => q.ruleId));

  // ── Khoản thu trong cửa sổ ───────────────────────────────────────────────────────────────────────────────
  const { tu, den } = khoangThoiDiem(i.tuNgay, i.denNgay);
  const where = { ...WHERE_THUC_THU, paidDate: { gte: tu, lt: den } };
  const [soDuong, hoan, duong] = await Promise.all([
    client.payment.count({ where: { ...where, amount: { gt: 0 } } }),
    client.payment.aggregate({ where: { ...where, amount: { lt: 0 } }, _count: { _all: true }, _sum: { amount: true } }),
    client.payment.findMany({ where: { ...where, amount: { gt: 0 } }, orderBy: [{ paidDate: "asc" }, { id: "asc" }], take: i.tranSoKhoan, select: { id: true } }),
  ]);
  if (soDuong > i.tranSoKhoan) {
    throw new HoaHongError(
      "QUA_NHIEU_KHOAN",
      `Cửa sổ ${i.tuNgay} → ${i.denNgay} có ${soDuong} khoản thu, vượt trần ${i.tranSoKhoan}. So bóng KHÔNG cắt bớt (cắt rồi báo «0 chênh» là cổng mở oan) — thu hẹp cửa sổ.`,
    );
  }
  const ids = duong.map((d) => d.id);

  // ── Phía CŨ: nạp một lần, tính theo từng bút toán ────────────────────────────────────────────────────────
  const [rows, rateRows, phanCong] = await Promise.all([
    ids.length ? client.payment.findMany({ where: { id: { in: ids } }, select: SELECT_HOA_HONG }) : Promise.resolve([]),
    client.commissionRateConfig.findMany({ select: { tier: true, rate: true, effectiveFrom: true, effectiveTo: true } }),
    // TOÀN BỘ sổ phân công: người QC / QL_TT theo MỐC XÁC NHẬN của khoản, có thể nằm nhiều tháng trước (khuôn `legacy-reversal.ts`).
    client.centerCommissionAssignee.findMany({ select: SELECT_PHAN_CONG }),
  ]);
  const hangTheoId = new Map(rows.map((r) => [r.id, r]));
  const phiaCu = (paymentId: string): PhiaCuNap => {
    const r = hangTheoId.get(paymentId);
    if (!r) return { cu: [], laTaiTuc: false };
    const butToan = mapButToanHoaHong([r as unknown as HangThanhToanHoaHong], phanCong);
    const dong = tinhHoaHongTheoKy({ period: kyCuaButToan(r.paidDate), butToan, ratesAt: (at) => pickEffectiveRates(rateRows, at) });
    const cu: DongCu[] = [];
    for (const d of dong) {
      const roleCode = vaiCuaTangCu(d.tier);
      if (roleCode && d.amount > 0) cu.push({ roleCode, nguoiId: d.recipientId, soTien: d.amount });
    }
    return { cu, laTaiTuc: r.enrollment?.renewedFromEnrollmentId != null };
  };

  // ── Phía MỚI: từng khoản ─────────────────────────────────────────────────────────────────────────────────
  const xuLy = async (paymentId: string): Promise<KetQuaMotKhoan> => {
    const p = await docKhoan(client, paymentId);
    if (!p || !conThucThu(p)) return { loai: "NGOAI", lyDo: "KHONG_CON_THUC_THU" };
    if (loaiButToan(hangButToanCua(p)) !== "THU") return { loai: "NGOAI", lyDo: "CHUYEN_NOI_BO" };
    const cu = phiaCu(paymentId);
    const khung = { paymentId, ngayThu: ngayVN(p.paidDate), soTienThu: p.amount, cu: cu.cu, cuLaTaiTuc: cu.laTaiTuc };
    const so = (loaiMoi: KhoanSoBong["loaiMoi"], moi: PhiaMoi): KetQuaMotKhoan => ({ loai: "SO", khoan: { ...khung, loaiMoi, moi } });

    let lap: Awaited<ReturnType<typeof lapThu>>;
    try {
      lap = await lapThu(client, bc, p);
    } catch {
      // Một khoản dữ liệu hỏng không được làm sập cả lượt — nhưng cũng KHÔNG được im lặng: nó là hàng chờ dự kiến (HARD), chặn cổng.
      return so(null, { loai: "GIU", ma: "LOI_DU_LIEU", maLuat: null, mucDo: "HARD" });
    }
    if (lap.loai === "BO_QUA") return so(null, { loai: "NGOAI_PHAM_VI", thanhPhan: await thanhPhanNgoaiPhamVi(client, p, lap.lyDo) });
    if (lap.loai === "GIU") {
      const ma = lap.holds[0]?.code ?? "MANUAL_REVIEW_REQUIRED";
      // Mã luật của BỘ PHÂN LOẠI (hàng chờ MANUAL_REVIEW_REQUIRED mang `detail.maLuat`) — để báo cáo tách hold lịch sử mua khỏi lỗi dữ liệu.
      const maLuat = (lap.holds[0]?.detail as { maLuat?: unknown } | undefined)?.maLuat;
      return so(null, { loai: "GIU", ma, maLuat: typeof maLuat === "string" ? maLuat : null, mucDo: mucCuaHangCho(ma) });
    }

    const kh = lap.kh;
    const kq = tinhDongChoKhoan(kh.dauVao(kh.vat.netBase));
    if (kq.loai === "VUOT_TRAN") return so(kh.loaiGiaoDich, { loai: "LOI_CAU_HINH", ma: "VUOT_TRAN", lyDo: `Σ tỉ lệ ${(kq.tiLeTuongDuong * 100).toFixed(2)}% vượt trần ${(kq.tran * 100).toFixed(2)}%.` });
    if (kq.loai === "CHONG_LAN") return so(kh.loaiGiaoDich, { loai: "LOI_CAU_HINH", ma: "CHONG_LAN", lyDo: `Vai ${kq.roleCode}: ${kq.lyDo}` });

    const dong: DongMoi[] = kq.dong.map((d) => ({ roleCode: d.roleCode, kind: d.beneficiaryKind, nguoiId: d.beneficiaryId, soTien: d.amount }));
    const vai: VaiDuKien[] = kq.cacVai.map((v) => {
      const dinhNghia = vaiHuong.get(v.roleCode);
      return {
        roleCode: v.roleCode,
        trangThai: v.trangThai,
        scopeType: v.quyTac?.scopeType ?? null,
        nguonKhongRo: v.nguonKhongRo,
        thuHut: dinhNghia?.isAcquisition ?? false,
        resolverType: dinhNghia?.resolverType ?? "DIRECT_PERSON",
        coDongLoaiTruNhom: quyTac.some((q) => q.roleCode === v.roleCode && q.scopeType === "SOURCE_GROUP" && q.kieuTinh === "EXCLUDE"),
        chinhSachCampaign:
          v.quyTac?.scopeType === "CAMPAIGN"
            ? {
                phienBanDaPhatHanh: ruleDaPhatHanh.has(v.quyTac.ruleId),
                campaignKhop: kh.nguonChinhSach.campaignId !== null && v.quyTac.scope.campaignId === kh.nguonChinhSach.campaignId,
                lienKetHopLe: kh.lienKet.hopLe,
              }
            : null,
      };
    });
    const treoCoHangCho = kq.treo.filter((t) => t.coHangCho).map((t) => ({ roleCode: t.roleCode, lyDo: t.lyDo }));
    return so(kh.loaiGiaoDich, { loai: "TINH", dong, vai, treoCoHangCho });
  };

  const khoan: KhoanSoBong[] = [];
  const ngoai: NgoaiPhamViNap = {
    khoanHoan: { soKhoan: hoan._count._all, soTien: hoan._sum.amount ?? 0 },
    khoanChuyenNoiBo: 0,
    khoanKhongPhaiHocPhi: { soKhoan: 0, soTien: 0 },
  };
  for (let b = 0; b < ids.length; b += SONG_SONG) {
    const ra = await Promise.all(ids.slice(b, b + SONG_SONG).map((id) => xuLy(id)));
    for (const r of ra) {
      if (r.loai === "NGOAI") {
        if (r.lyDo === "CHUYEN_NOI_BO") ngoai.khoanChuyenNoiBo += 1;
        continue;
      }
      khoan.push(r.khoan);
      if (r.khoan.moi.loai === "NGOAI_PHAM_VI") {
        ngoai.khoanKhongPhaiHocPhi.soKhoan += 1;
        ngoai.khoanKhongPhaiHocPhi.soTien += r.khoan.soTienThu;
      }
    }
  }

  return tongHopSoBong({ khoan, ngoai, cuaSo: { tuNgay: i.tuNgay, denNgay: i.denNgay }, asOf: i.denNgay, chinhSach });
}
