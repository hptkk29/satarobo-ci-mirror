// lib/hoa-hong/mo-phong-ui.ts — LUẬT HIỂN THỊ của bước "Thử tính" (06 §5.2): định dạng, nút, độ cũ của kết quả, tóm tắt cho hộp thoại kích hoạt.
// THUẦN, an toàn cho client (chỉ kiểu từ `mo-phong.ts`). Mọi con số đến từ `KetQuaMoPhong` của máy chủ — ở đây KHÔNG tính tiền.
//
// ── Ba điều giao diện không được nói dối ───────────────────────────────────────────────────────────────────────
//   · Nút "Chạy thử": không quyền ⇒ KHÔNG vẽ (lời hứa suông, luật 12); có quyền nhưng chưa đủ điều kiện ⇒ TẮT kèm lý do riêng.
//   · Kết quả cũ (bản nháp đã lưu lại / đang sửa dở) ⇒ gắn nhãn "cũ", KHÔNG dùng làm "tác động" ở hộp thoại kích hoạt.
//   · Không có số 0 giả: khoản không tính được được ĐẾM, không biến thành "0đ" (xem `mo-phong.ts`).
import { ngayDMY } from "./hang-rao-ui";
import { DUONG_CAU_HINH_TRAN, dungHuongXuLyTran, loiKhuyenNangTran } from "./huong-xu-ly-tran";
import type { KetQuaMoPhong } from "./mo-phong";
import { dinhDangDong, dinhDangSo } from "./vi-sao";

export type ThamSoThuTinh = { tuNgay: string; denNgay: string; orgUnitId: string | null };

export type TrangThaiThuTinh =
  | { kieu: "chua" }
  | { kieu: "dang-chay" }
  | { kieu: "loi"; chung: string }
  | { kieu: "xong"; ketQua: KetQuaMoPhong; phienBanCapNhatLuc: string; chayLuc: string };

// ── Định dạng ─────────────────────────────────────────────────────────────────────────────────────────────────

const TRU = "−"; // dấu trừ thật (−), không phải gạch nối


/** Chênh có DẤU: "+1.200đ" · "−1.200đ"; 0 ⇒ "0đ" (không dấu). */
export const dinhDangChenh = (n: number): string => (n === 0 ? "0đ" : `${n > 0 ? "+" : TRU}${dinhDangDong(Math.abs(n))}`);

/** 0,0853 ⇒ "8,53%"; `null` (không có cơ sở để chia) ⇒ "—". */
export const dinhDangTiLe = (tiLe: number | null): string => (tiLe === null ? "—" : `${dinhDangSo(Math.round(tiLe * 10_000) / 100, 2)}%`);

/** Chênh hai tỉ lệ, tính bằng ĐIỂM phần trăm: "+0,50 điểm %" · "−1,00 điểm %" · "0,00 điểm %". `null` nếu một đầu thiếu. */
export function dinhDangChenhTiLe(hien: number | null, de: number | null): string {
  if (hien === null || de === null) return "—";
  const d = Math.round((de - hien) * 10_000) / 100;
  return d === 0 ? "0,00 điểm %" : `${d > 0 ? "+" : TRU}${dinhDangSo(Math.abs(d), 2)} điểm %`;
}

/** "01/07 – 30/09/2026" (cùng năm) hoặc "01/07/2025 – 30/06/2026". */
export function nhanKhoang(k: { tuNgay: string; denNgay: string }): string {
  const tu = ngayDMY(k.tuNgay);
  const den = ngayDMY(k.denNgay);
  return k.tuNgay.slice(0, 4) === k.denNgay.slice(0, 4) ? `${tu.slice(0, 5)} – ${den}` : `${tu} – ${den}`;
}

/** "HH:mm dd/mm/yyyy" giờ VN từ ISO. */
export function nhanGioChay(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 7 * 3_600_000).toISOString();
  return `${t.slice(11, 16)} ${ngayDMY(t.slice(0, 10))}`;
}

export const dinhDangTranPhanTram = (tran: number): string => `${dinhDangSo(Math.round(tran * 10_000) / 100, 2).replace(/,?0+$/, "")}%`;

// ── Nút "Chạy thử" ───────────────────────────────────────────────────────────────────────────────────────────

export type QuyetDinhNutThuTinh = { ve: boolean; bamDuoc: boolean; lyDo: string | null };

/**
 * KHÔNG QUYỀN ⇒ không vẽ nút (chỉ nêu tên quyền). CÓ QUYỀN nhưng chưa đủ ⇒ nút tắt, MỖI trường hợp một câu riêng.
 * Quyền ở đây là CHÍNH key mà Server Action `thuTinhAction` hỏi (`commission_policies:manage`) — vẽ bằng key nào thì máy chủ hỏi đúng key đó.
 */
export function quyetDinhNutThuTinh(d: { coQuyen: boolean; laBanNhap: boolean; daLuu: boolean; coThayDoiChuaLuu: boolean }): QuyetDinhNutThuTinh {
  if (!d.coQuyen) return { ve: false, bamDuoc: false, lyDo: "Chạy thử cần quyền commission_policies:manage. Nhờ Quản trị hệ thống cấp, hoặc nhờ người có quyền chạy thử giúp." };
  const tat = (lyDo: string): QuyetDinhNutThuTinh => ({ ve: true, bamDuoc: false, lyDo });
  if (!d.laBanNhap) return { ve: false, bamDuoc: false, lyDo: "Phiên bản này đã kích hoạt hoặc đã khoá — thử tính dành cho bản nháp. Muốn thử một mức mới, tạo phiên bản mới." };
  if (!d.daLuu) return tat("Lưu nháp trước: thử tính chạy trên bản đã lưu.");
  if (d.coThayDoiChuaLuu) return tat("Bạn đã sửa sau lần lưu cuối — lưu nháp để thử tính đúng bản đang soạn.");
  return { ve: true, bamDuoc: true, lyDo: null };
}

// ── Độ cũ của kết quả ─────────────────────────────────────────────────────────────────────────────────────────

/** Kết quả còn đúng với bản đang soạn không: cùng mốc `updatedAt` của bản nháp ĐÃ LƯU và không sửa dở. */
export function tuoiKetQua(ket: { phienBanCapNhatLuc: string }, luu: { updatedAt: string } | null, coThayDoiChuaLuu: boolean): "moi" | "cu" {
  return luu !== null && !coThayDoiChuaLuu && ket.phienBanCapNhatLuc === luu.updatedAt ? "moi" : "cu";
}

// ── Cảnh báo ──────────────────────────────────────────────────────────────────────────────────────────────────

export type CanhBaoThuTinh = {
  ma: "VUOT_TRAN_DE_XUAT" | "VUOT_TRAN_HIEN_TAI" | "CHONG_LAN" | "CAT" | "CHUA_TINH";
  mucDo: "loi" | "luu-y";
  noiDung: string;
  /** Chỉ `VUOT_TRAN_DE_XUAT`: nơi nâng trần (vắng khi tổng vượt cả giới hạn của ô cấu hình — nâng trần không đủ). */
  duongDan?: { href: string; nhan: string };
};

/** Mọi điều người đọc PHẢI thấy trước khi tin các con số — theo thứ tự quan trọng. */
export function canhBaoCuaKetQua(k: KetQuaMoPhong): CanhBaoThuTinh[] {
  const ra: CanhBaoThuTinh[] = [];
  const tran = dinhDangTranPhanTram(k.tran.gioiHan);
  if (k.tran.deXuat.soKhoan > 0) {
    // Mức LỚN NHẤT chỉ biết chắc khi danh sách KHÔNG bị cắt; bị cắt / rỗng ⇒ nói chung, không bịa con số (đoán thấp làm người ta nâng trần chưa đủ).
    const ds = k.tran.deXuat.danhSach;
    const tongToiDa = k.tran.biCat || ds.length === 0 ? null : Math.max(...ds.map((x) => x.tiLe));
    const nangDuoc = tongToiDa === null || dungHuongXuLyTran({ tongToiDa, tran: k.tran.gioiHan }).coTheNangTran;
    ra.push({
      ma: "VUOT_TRAN_DE_XUAT",
      mucDo: "loi",
      noiDung: `${k.tran.deXuat.soKhoan} khoản có tổng tỉ lệ vượt trần ${tran} dưới chính sách đề xuất. Hệ thống không tự cắt: các khoản này sẽ không sinh hoa hồng nào cho tới khi sửa chính sách — số “Đề xuất” bên dưới đã tính chúng là 0đ. ${loiKhuyenNangTran({ tongToiDa })}`,
      ...(nangDuoc ? { duongDan: { href: DUONG_CAU_HINH_TRAN.href, nhan: DUONG_CAU_HINH_TRAN.nhan } } : {}),
    });
  }
  if (k.tran.hienTai.soKhoan > 0) {
    ra.push({ ma: "VUOT_TRAN_HIEN_TAI", mucDo: "luu-y", noiDung: `Chính sách đang chạy cũng có ${k.tran.hienTai.soKhoan} khoản vượt trần ${tran} — số “Hiện tại” đã tính chúng là 0đ.` });
  }
  if (k.chongLan.hienTai + k.chongLan.deXuat > 0) {
    ra.push({
      ma: "CHONG_LAN",
      mucDo: "loi",
      noiDung: `${k.chongLan.deXuat} khoản (đề xuất) và ${k.chongLan.hienTai} khoản (hiện tại) có hai quy tắc cùng hạng chồng nhau nên không chọn được một — các khoản đó được tính 0đ.`,
    });
  }
  if (k.cat) {
    ra.push({
      ma: "CAT",
      mucDo: "luu-y",
      noiDung: `Mới xét ${dinhDangSo(k.cat.tran)} khoản gần nhất (từ ${ngayDMY(k.cat.xetTuNgay)}); ${dinhDangSo(k.cat.soKhoanChuaXet)} khoản cũ hơn trong khoảng chưa được tính. Thu hẹp khoảng ngày hoặc chọn một đơn vị để xét đủ.`,
    });
  }
  if (k.chuaTinh.soKhoan > 0) {
    ra.push({ ma: "CHUA_TINH", mucDo: "luu-y", noiDung: `${dinhDangSo(k.chuaTinh.soKhoan)} khoản chưa thể tính (thiếu dữ liệu để quyết) — không nằm trong các số bên dưới, xem danh sách ở cuối.` });
  }
  return ra;
}

// ── Hộp thoại kích hoạt ───────────────────────────────────────────────────────────────────────────────────────

export type TomTatTacDong =
  | { kieu: "chua-chay"; dong: string[] }
  | { kieu: "cu"; dong: string[] }
  | { kieu: "co"; dong: string[] };

/**
 * Dòng "Tác động ước tính" trong hộp thoại kích hoạt (06 §5.2). Chưa chạy / kết quả cũ ⇒ NÓI THẲNG, không dùng số cũ làm "tác động".
 * Có kết quả mới ⇒ khoảng · hoa hồng hiện tại → đề xuất · chênh · số khoản vượt trần.
 */
export function tomTatTacDong(thu: TrangThaiThuTinh, tuoi: "moi" | "cu" | null): TomTatTacDong {
  if (thu.kieu !== "xong") {
    return { kieu: "chua-chay", dong: [thu.kieu === "dang-chay" ? "Đang thử tính trên dữ liệu thật…" : "Chưa thử tính trên dữ liệu thật — quay lại bước “Thử tính” để xem tác động trước khi kích hoạt."] };
  }
  if (tuoi !== "moi") {
    return { kieu: "cu", dong: ["Kết quả thử tính đã cũ (bản nháp đã được lưu lại hoặc đang sửa dở) — chạy lại ở bước “Thử tính” để có tác động đúng bản này."] };
  }
  const k = thu.ketQua;
  const dong = [
    `Ước tính trên dữ liệu ${nhanKhoang(k.khoang)}, không ghi sổ: hoa hồng ${dinhDangDong(k.hoaHong.hienTai)} → ${dinhDangDong(k.hoaHong.deXuat)} (${dinhDangChenh(k.hoaHong.chenh)}), ${dinhDangSo(k.soNguoiAnhHuong)} người thay đổi.`,
  ];
  if (k.tran.deXuat.soKhoan > 0) dong.push(`${k.tran.deXuat.soKhoan} khoản vượt trần ${dinhDangTranPhanTram(k.tran.gioiHan)} dưới chính sách này.`);
  if (k.cat) dong.push("Kết quả mới xét một phần khoảng đã chọn (đã cắt).");
  return { kieu: "co", dong };
}
