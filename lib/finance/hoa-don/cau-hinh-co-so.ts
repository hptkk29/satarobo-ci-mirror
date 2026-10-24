// lib/finance/hoa-don/cau-hinh-co-so.ts — cấu hình HOÁ ĐƠN theo cơ sở × thời gian hiệu lực. THUẦN (client dùng được).
//
// Vì sao có (PR2, docs/ke-toan-hoa-don/NANG-CAP-2026-10.md): ký hiệu thật trên prod (1C26MAI của CS1,
// 1C26MNV của CS2) không nằm ở đâu trong mã — hằng `CAU_HINH_HOA_DON_MAC_DINH` cho cả hai cơ sở 1C26TSR, nên kế
// toán gõ đè ký hiệu trên TỪNG hoá đơn; và CS2 phát hành dưới New Vision mà snapshot ghi Sata Robo.
//
// Luật:
//   · Một dòng = (cơ sở, pháp nhân phát hành, ký hiệu NGUYÊN CHUỖI, khoảng ngày hiệu lực). Hệ thống KHÔNG tự đổi
//     hai số năm: sang năm mới kế toán thêm dòng mới (chủ dự án chốt 23/10/2026).
//   · Khoảng hiệu lực nằm TRONG MỘT NĂM và năm đó phải trùng hai số năm của ký hiệu (TT 78: ký hiệu mang năm
//     phát hành) ⇒ đổi năm = dòng mới, không có dòng "vô hạn" sống qua năm sau mang ký hiệu cũ.
//   · Một cơ sở KHÔNG có hai dòng ĐANG BẬT chồng ngày: "ngày này cơ sở này phát hành bằng gì" phải có đúng một
//     đáp án. Chồng ngày là lỗi nhập, không phải lựa chọn.
//   · KHÔNG suy "một cơ sở = một dãy số": hai cơ sở có thể cùng (pháp nhân, ký hiệu) ⇒ cùng một dãy. Bảng này
//     không có khoá duy nhất xuyên cơ sở, và dãy số được tính theo (MST, ký hiệu) ở PR3 — không theo cơ sở.
//   · Không tìm thấy cấu hình ⇒ `KHONG_CO` (người gọi quyết: rơi về mặc định CÓ CẢNH BÁO). Tìm thấy hơn một
//     (dữ liệu hỏng/chồng) ⇒ `MO_HO` — KHÔNG đoán một dòng.
//   · Sửa cấu hình KHÔNG sửa ngược hoá đơn đã lưu: hoá đơn chụp riêng pháp nhân + ký hiệu của nó lúc tạo.
//     Dòng đã có hoá đơn trong khoảng thì khoá ký hiệu / pháp nhân / ngày bắt đầu (`kiemSuaCauHinh`).

import { dungHinhDangKyHieu } from "./ky-hieu";
import type { PhapNhan } from "./phap-nhan";

export type CauHinhCoSo = {
  id: string;
  centerId: string;
  phapNhanMa: string;
  kyHieu: string;
  /** yyyy-mm-dd (lịch VN), gồm cả hai đầu. */
  hieuLucTu: string;
  hieuLucDen: string;
  dangBat: boolean;
};

export type KetQuaTimCauHinh =
  | { loai: "CO"; cauHinh: CauHinhCoSo }
  | { loai: "KHONG_CO" }
  | { loai: "MO_HO"; cacId: string[] };

const NGAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function laNgayHopLe(s: string): boolean {
  const m = NGAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/** Cấu hình đang hiệu lực của MỘT cơ sở vào MỘT ngày. Chỉ xét dòng đang bật. */
export function timCauHinhTheoNgay(
  cauHinh: readonly CauHinhCoSo[],
  centerId: string,
  ngay: string,
): KetQuaTimCauHinh {
  if (!laNgayHopLe(ngay)) return { loai: "KHONG_CO" };
  const khop = cauHinh.filter((c) => c.centerId === centerId && c.dangBat && c.hieuLucTu <= ngay && ngay <= c.hieuLucDen);
  if (khop.length === 0) return { loai: "KHONG_CO" };
  if (khop.length > 1) return { loai: "MO_HO", cacId: khop.map((c) => c.id).sort() };
  return { loai: "CO", cauHinh: khop[0]! };
}

export type KyHieuDeXuat =
  | { nguon: "CAU_HINH"; kyHieu: string; phapNhanMa: string }
  | { nguon: "THIEU_CAU_HINH"; kyHieu: string; phapNhanMa: null }
  | { nguon: "MO_HO"; kyHieu: string; phapNhanMa: null };

/**
 * Ký hiệu điền sẵn cho một ngày phát hành: cấu hình của cơ sở thắng; KHÔNG có cấu hình hoặc mơ hồ ⇒ để TRỐNG (không
 * đoán). Trước 24/10/2026 thiếu cấu hình thì rơi về mẫu mặc định đổi năm (1C26TSR) — nhưng mẫu đó sai cho cả hai cơ
 * sở thật (CS1 = 1C26MAI, CS2 = 1C26MNV) và đi kèm pháp nhân mặc định, tức hoá đơn mang nhầm MST mà không ai biết.
 */
export function kyHieuDeXuat(input: { cauHinh: readonly CauHinhCoSo[]; centerId: string; ngay: string }): KyHieuDeXuat {
  const t = timCauHinhTheoNgay(input.cauHinh, input.centerId, input.ngay);
  if (t.loai === "CO") return { nguon: "CAU_HINH", kyHieu: t.cauHinh.kyHieu, phapNhanMa: t.cauHinh.phapNhanMa };
  if (t.loai === "MO_HO") return { nguon: "MO_HO", kyHieu: "", phapNhanMa: null };
  return { nguon: "THIEU_CAU_HINH", kyHieu: "", phapNhanMa: null };
}

/**
 * Câu cảnh báo khi cơ sở KHÔNG xác định được cấu hình hoá đơn hợp lệ cho `ngay` (thiếu hoặc chồng ngày); `null` = có
 * đúng một cấu hình. Dùng cho màn (nói thật vì sao nút Lưu khoá) — server chặn bằng `phapNhanTheoCauHinh` "CHAN".
 */
export function canhBaoThieuCauHinh(cauHinh: readonly CauHinhCoSo[], centerId: string, ngay: string): string | null {
  const t = timCauHinhTheoNgay(cauHinh, centerId, ngay);
  if (t.loai === "CO") return null;
  if (t.loai === "MO_HO") return "Cấu hình hoá đơn của cơ sở bị chồng ngày — sửa ở màn Cấu hình ký hiệu trước khi lưu hoá đơn mới.";
  return laNgayHopLe(ngay)
    ? `Cơ sở chưa khai cấu hình hoá đơn (pháp nhân + ký hiệu) có hiệu lực ngày ${ngay} — khai ở màn Cấu hình ký hiệu trước khi lưu hoá đơn mới.`
    : "Chọn ngày phát hành hợp lệ.";
}

export type DauVaoCauHinh = {
  centerId: string;
  phapNhanMa: string;
  kyHieu: string;
  hieuLucTu: string;
  hieuLucDen: string;
  dangBat: boolean;
};

function nam2(ngay: string): string {
  return ngay.slice(2, 4);
}

/**
 * Kiểm MỘT dòng cấu hình (tạo mới hoặc sau khi sửa) so với các dòng đã có của CÙNG cơ sở. Trả mảng câu lỗi tiếng
 * Việt; rỗng = hợp lệ. `daCo` không chứa chính dòng đang sửa (người gọi loại ra). `phapNhan` là danh sách pháp
 * nhân khai ở `CAU_HINH_HOA_DON_MAC_DINH`.
 */
export function kiemCauHinhCoSo(input: DauVaoCauHinh, daCo: readonly CauHinhCoSo[], phapNhan: readonly Pick<PhapNhan, "ma" | "ten" | "bat">[]): string[] {
  const loi: string[] = [];
  const pn = phapNhan.find((p) => p.ma === input.phapNhanMa);
  if (!pn) loi.push(`Pháp nhân "${input.phapNhanMa}" chưa được khai trong hệ thống.`);
  else if (!pn.bat) loi.push(`Pháp nhân "${pn.ten}" đang tắt — bật lại trước khi dùng cho cơ sở.`);

  const kyHieu = input.kyHieu.trim().toUpperCase();
  if (!dungHinhDangKyHieu(kyHieu)) loi.push("Ký hiệu hoá đơn không đúng dạng (ví dụ đúng: 1C26MAI).");

  const tuOk = laNgayHopLe(input.hieuLucTu);
  const denOk = laNgayHopLe(input.hieuLucDen);
  if (!tuOk) loi.push("Ngày bắt đầu hiệu lực không hợp lệ.");
  if (!denOk) loi.push("Ngày kết thúc hiệu lực không hợp lệ.");
  if (tuOk && denOk) {
    if (input.hieuLucTu > input.hieuLucDen) loi.push("Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.");
    else if (input.hieuLucTu.slice(0, 4) !== input.hieuLucDen.slice(0, 4)) {
      loi.push("Một dòng cấu hình chỉ trong MỘT năm — sang năm sau thêm dòng mới với ký hiệu của năm đó.");
    } else if (dungHinhDangKyHieu(kyHieu) && kyHieu.slice(2, 4) !== nam2(input.hieuLucTu)) {
      loi.push(`Ký hiệu mang năm "${kyHieu.slice(2, 4)}" nhưng hiệu lực thuộc năm ${input.hieuLucTu.slice(0, 4)}.`);
    }
  }

  if (input.dangBat && tuOk && denOk) {
    const chong = daCo.filter(
      (c) => c.centerId === input.centerId && c.dangBat && c.hieuLucTu <= input.hieuLucDen && input.hieuLucTu <= c.hieuLucDen,
    );
    for (const c of chong) {
      loi.push(`Trùng khoảng ngày với cấu hình ${c.kyHieu} (${c.hieuLucTu} → ${c.hieuLucDen}) của cùng cơ sở — tắt hoặc rút ngắn dòng đó trước.`);
    }
  }
  return loi;
}

/** Hoá đơn đã lưu rơi vào khoảng của một dòng — để quyết định dòng đó còn sửa được những gì. */
export type HoaDonTrongKhoang = { soHoaDon: number; ngayMin: string | null; ngayMax: string | null };

/**
 * Sửa MỘT dòng cấu hình đã có. Dòng đã có hoá đơn trong khoảng thì KHÔNG đổi pháp nhân / ký hiệu / cơ sở (đổi là
 * làm lịch sử nói dối) và khoảng ngày không được co lại khỏi các ngày phát hành đã dùng. Muốn đổi: tắt dòng,
 * thêm dòng mới. Tắt (`dangBat=false`) và ghi chú luôn được.
 */
export function kiemSuaCauHinh(
  cu: Pick<CauHinhCoSo, "centerId" | "phapNhanMa" | "kyHieu" | "hieuLucTu" | "hieuLucDen">,
  moi: DauVaoCauHinh,
  dung: HoaDonTrongKhoang,
): string[] {
  if (dung.soHoaDon === 0) return [];
  const loi: string[] = [];
  if (moi.centerId !== cu.centerId) loi.push("Không đổi cơ sở của dòng đã có hoá đơn.");
  if (moi.phapNhanMa !== cu.phapNhanMa) loi.push(`Đã có ${dung.soHoaDon} hoá đơn dùng dòng này — không đổi pháp nhân; tắt dòng và thêm dòng mới.`);
  if (moi.kyHieu.trim().toUpperCase() !== cu.kyHieu) loi.push(`Đã có ${dung.soHoaDon} hoá đơn dùng dòng này — không đổi ký hiệu; tắt dòng và thêm dòng mới.`);
  if (dung.ngayMin && moi.hieuLucTu > dung.ngayMin) loi.push(`Ngày bắt đầu không được sau ${dung.ngayMin} (đã có hoá đơn phát hành ngày đó).`);
  if (dung.ngayMax && moi.hieuLucDen < dung.ngayMax) loi.push(`Ngày kết thúc không được trước ${dung.ngayMax} (đã có hoá đơn phát hành ngày đó).`);
  return loi;
}

export type PhapNhanChoHoaDon =
  | { ok: true; phapNhan: PhapNhan; nguon: "CAU_HINH" | "MAC_DINH"; kyHieuCauHinh: string | null }
  | { ok: false; error: string };

/**
 * Pháp nhân PHÁT HÀNH hoá đơn của một cơ sở vào một ngày — nguồn DUY NHẤT cho ảnh chụp pháp nhân khi tạo bản
 * nháp (trước đây suy từ ánh xạ phiếu thu `macDinhTheoCoSo`, sai với CS2).
 *   · có cấu hình hiệu lực ⇒ pháp nhân của cấu hình (phải còn BẬT trong danh sách pháp nhân);
 *   · mơ hồ ⇒ LỖI (không in nhầm MST lên tờ hoá đơn);
 *   · không có cấu hình ⇒ tuỳ `khiThieuCauHinh` — BẮT BUỘC khai (luật 7), mỗi chỗ gọi tự chọn:
 *       "CHAN"     = LỖI. Dùng cho mọi đường GHI hoá đơn mới và gợi ý số: không âm thầm gán pháp nhân mặc định.
 *       "MAC_DINH" = rơi về `macDinh(maCoSo)`, nguồn ghi rõ "MAC_DINH". CHỈ cho nơi chưa quyết điều gì có hậu quả pháp lý
 *                    (cờ hiện nút MISA trên dòng hàng chờ).
 */
export function phapNhanTheoCauHinh(input: {
  cauHinh: readonly CauHinhCoSo[];
  centerId: string;
  ngay: string;
  danhSachPhapNhan: readonly PhapNhan[];
  macDinh: PhapNhan | null;
  khiThieuCauHinh: "CHAN" | "MAC_DINH";
}): PhapNhanChoHoaDon {
  const t = timCauHinhTheoNgay(input.cauHinh, input.centerId, input.ngay);
  if (t.loai === "MO_HO") {
    return { ok: false, error: "Cấu hình hoá đơn của cơ sở bị chồng ngày — sửa ở màn Cấu hình ký hiệu trước khi lưu." };
  }
  if (t.loai === "CO") {
    const pn = input.danhSachPhapNhan.find((p) => p.ma === t.cauHinh.phapNhanMa && p.bat);
    if (!pn) return { ok: false, error: `Pháp nhân "${t.cauHinh.phapNhanMa}" trong cấu hình hoá đơn đang tắt hoặc không còn — sửa ở màn Cấu hình ký hiệu.` };
    return { ok: true, phapNhan: pn, nguon: "CAU_HINH", kyHieuCauHinh: t.cauHinh.kyHieu };
  }
  if (input.khiThieuCauHinh === "CHAN") {
    return { ok: false, error: canhBaoThieuCauHinh(input.cauHinh, input.centerId, input.ngay) ?? "Chưa khai cấu hình hoá đơn cho cơ sở này." };
  }
  if (!input.macDinh) return { ok: false, error: "Chưa khai pháp nhân phát hành cho cơ sở này — khai ở màn Cấu hình ký hiệu." };
  return { ok: true, phapNhan: input.macDinh, nguon: "MAC_DINH", kyHieuCauHinh: null };
}
