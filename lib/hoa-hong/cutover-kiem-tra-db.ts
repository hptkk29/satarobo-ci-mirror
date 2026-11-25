// lib/hoa-hong/cutover-kiem-tra-db.ts — NẠP bằng chứng cho precheck cutover (CHỈ ĐỌC): so bóng + tình trạng di trú nguồn + nối đơn về lead.
//
// Nguồn: docs/source-commission/05 §7.5 bước 2–3, 08 §11 bước 12–13. Hướng D của đợt UAT cutover. Luật nằm ở `cutover-kiem-tra.ts` (thuần) và `cutover.ts` (cổng).
//
// ── Chỉ đọc, và chạy NGOÀI khoá độc quyền ───────────────────────────────────────────────────────────────────────
// Hàm ở đây được gọi từ `napGoiBangChung` (cutover.ts) TRƯỚC `client.$transaction`: quét lead + so bóng từng khoản trong lúc giữ khoá độc quyền của mốc sẽ làm MỌI lượt ghi
// sổ (chúng giữ khoá chia sẻ) đứng chờ. «Chỉ đọc» được giữ bằng lưới `[CUT-W*]` (không lệnh ghi nào) + ca DB đếm bảng trước/sau — không bằng transaction READ ONLY
// (`lapThu` nhận `PrismaClient`, không nhận `TransactionClient`).
//
// ── Không có bằng chứng thì không có đạt ─────────────────────────────────────────────────────────────────────────
// Mỗi con số do MỘT lượt đọc thật sinh ra; lượt đọc ném lỗi thì lỗi nổi lên (action trả «lỗi lạ»), KHÔNG BAO GIỜ rơi về 0.
import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { docKeHoachNoiDon } from "@/lib/nguon/noi-don-db";
import { DANH_MUC_GOC } from "@/lib/nguon/danh-muc-goc";
import { coBangQuyNguon } from "@/lib/nguon/co-bang-quy-nguon";
import { docTinhTrangBackfill, type TinhTrangBackfill } from "@/lib/nguon/di-tru-tinh-trang";

import type { GoiBangChung, PhuThuocDatMoc } from "./cutover";
import type { BangChungDoDuoc, ChiTietDiTru } from "./cutover-kiem-tra";
import type { BaoCaoSoBong } from "./so-bong";
import { chaySoBong } from "./so-bong-db";

export type ChiTietDiTruDayDu = ChiTietDiTru & { tinhTrang: TinhTrangBackfill };

/** Phần chi tiết mà TRANG xem trước cần (KHÔNG ghi audit). */
export type ChiTietXem = { baoCao: BaoCaoSoBong; diTru: ChiTietDiTruDayDu };

/**
 * Tình trạng di trú nguồn + nối đơn. «Chưa sẵn sàng» = công cụ di trú báo chưa sẵn sàng (`sanSang`) HOẶC thiếu bảng quy nguồn HOẶC thiếu dòng danh mục gốc HOẶC còn đơn mà số điện
 * thoại khớp NHIỀU lead (nối đơn không tự quyết được — 03 §5.4). Ba lý do sau do D tự đo, không phụ thuộc nghĩa của `sanSang`.
 *
 * Bảng quy nguồn vắng KHÔNG làm hàm này ném: `docTinhTrangBackfill` tự hỏi `coBangQuyNguon` và trả `sanSang = false` — nên nhánh `thieuBangQuyNguon` chạy thật và người đọc nhận đúng lý do
 * «migration chưa chạy» thay vì «lỗi lạ». `thieuBangQuyNguon` lấy HAI nguồn (câu hỏi riêng của D và trường của công cụ di trú): chỉ cần một bên nói «vắng» là vắng (fail-closed).
 */
export async function docChiTietDiTru(client: PrismaClient): Promise<{ chiTiet: ChiTietDiTruDayDu; chuaSanSang: boolean }> {
  const [tinhTrang, bang, nhom, noiDon] = await Promise.all([
    docTinhTrangBackfill(client),
    coBangQuyNguon(client),
    client.leadSourceGroup.findMany({ select: { code: true } }),
    docKeHoachNoiDon(client, "TAT_CA"),
  ]);
  const thieuBangQuyNguon = !bang || !tinhTrang.coBangQuyNguon;
  const coMa = new Set(nhom.map((n) => n.code));
  const thieuDanhMuc = DANH_MUC_GOC.map((d) => d.code).filter((c) => !coMa.has(c));
  const noiDonNhieu = noiDon.keHoach.nhieu.length;
  const chuaSanSang = !tinhTrang.sanSang || thieuBangQuyNguon || thieuDanhMuc.length > 0 || noiDonNhieu > 0;
  return { chiTiet: { thieuBangQuyNguon, thieuDanhMuc, noiDonNhieu, tinhTrang }, chuaSanSang };
}

export type DauVaoNapBangChung = {
  client: PrismaClient;
  /** Cửa sổ so bóng — BẮT BUỘC, người dùng chọn rồi gửi lại khi xác nhận (dấu vân gắn với cửa sổ này). */
  cuaSo: { tuNgay: string; denNgay: string };
  /** Trần số khoản so bóng; vượt ⇒ NÉM, không cắt im lặng. */
  tranSoKhoan: number;
  /** Trang xem trước nhận chi tiết (bảng chênh, chi tiết di trú) qua đây. Xác nhận thì không cần. */
  ghiNho?: (c: ChiTietXem) => void;
};

/** Phần tóm tắt GHI AUDIT: không có dòng nào, không có tên người — số, mã và dấu vân. Chi tiết tính lại được (tất định). */
function tomTatCuaBaoCao(b: BaoCaoSoBong, diTru: ChiTietDiTruDayDu): Record<string, unknown> {
  return {
    cuaSo: b.cuaSo,
    asOf: b.asOf,
    phienBanLuat: b.phienBanLuat,
    boLuatPhanLoai: b.boLuatPhanLoai,
    dauVanSoBong: b.dauVan,
    chinhSach: b.chinhSach,
    khoan: b.khoan,
    match: b.match,
    expected: b.expected,
    unexpected: b.unexpected,
    chuaTinh: b.chuaTinh,
    hold: b.hold,
    ngoai: b.ngoai,
    diTru: { thieuBangQuyNguon: diTru.thieuBangQuyNguon, thieuDanhMuc: diTru.thieuDanhMuc, noiDonNhieu: diTru.noiDonNhieu, ...diTru.tinhTrang },
  };
}

/**
 * Bản THẬT của `PhuThuocDatMoc`: chạy so bóng + đo di trú, ra bốn con số và dấu vân.
 * `dauVan` = băm của (mốc cũ, mốc mới, hành động, bốn số, dấu vân so bóng, tình trạng di trú) — đổi một thứ là người dùng phải xem lại.
 */
export function phuThuocCutoverThat(d: DauVaoNapBangChung): PhuThuocDatMoc {
  return {
    napBangChung: async (i): Promise<GoiBangChung> => {
      const baoCao = await chaySoBong({ client: d.client, now: i.now, kyP: i.moi, tuNgay: d.cuaSo.tuNgay, denNgay: d.cuaSo.denNgay, tranSoKhoan: d.tranSoKhoan });
      const { chiTiet, chuaSanSang } = await docChiTietDiTru(d.client);
      const bangChung: BangChungDoDuoc = {
        invalidAttribution: chiTiet.tinhTrang.invalid,
        holdNghiemTrongDuKien: baoCao.hold.tong, // MỌI hàng chờ dự kiến (kể cả SOFT) — tên «nghiêm trọng» chỉ là lịch sử, xem chú thích đầu cutover-kiem-tra.ts
        unexpectedDelta: baoCao.unexpected.soDong,
        diTruChuaSanSang: chuaSanSang,
      };
      const tt = chiTiet.tinhTrang;
      const dauVan = createHash("sha256")
        .update(
          JSON.stringify({
            cu: i.cu,
            moi: i.moi,
            hanhDong: i.hanhDong,
            bangChung,
            soBong: baoCao.dauVan,
            diTru: { b: chiTiet.thieuBangQuyNguon, dm: chiTiet.thieuDanhMuc, nd: chiTiet.noiDonNhieu, cq: tt.conThieuQuyNguon, iv: tt.invalid, mr: tt.manualReview, dd: tt.daDiTru, ss: tt.sanSang },
          }),
        )
        .digest("hex");
      d.ghiNho?.({ baoCao, diTru: chiTiet });
      return { bangChung, dauVan, tomTat: tomTatCuaBaoCao(baoCao, chiTiet) };
    },
  };
}
