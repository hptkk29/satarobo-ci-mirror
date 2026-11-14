// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/core/lien-he/kieu.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * ĐIỂM CẮM THU LIÊN HỆ.
 *
 * 🔴 QĐ3 — LUẬT KHÔNG THƯƠNG LƯỢNG:
 *   Payload gửi đi CHỈ được chứa thông tin liên hệ. TUYỆT ĐỐI không kèm câu trả lời,
 *   điểm số, hay kết quả của trẻ.
 *
 * Vì sao: bản 1 không có backend, nên SATA ROBO gần như không nắm giữ dữ liệu cá nhân của
 * trẻ — phần lớn nghĩa vụ theo Nghị định 13/2023 không phát sinh. Lợi thế đó MIỄN PHÍ, và
 * nó vỡ ngay khi ai đó "chỉ đính kèm chút kết quả cho tiện". Số điện thoại phụ huynh CỘNG
 * kết quả DISC của con nằm cạnh nhau là một hồ sơ cá nhân.
 *
 * `tests/lien-he-sach.test.ts` canh việc này. Đừng gỡ test đó.
 *
 * Thuộc TẦNG LÕI: không React, không DOM.
 */

type KenhLienHe = "zalo" | "goi-dien";

/** 🔴 Mọi trường ở đây đều do NGƯỜI LỚN tự nhập về CHÍNH HỌ. Không có gì của trẻ. */
export type PhieuLienHe = {
  readonly soDienThoai: string;
  /** Tên gọi người lớn tự xưng. Không bắt buộc, không phải họ tên. */
  readonly tenGoi?: string;
  readonly kenhMuonNhan: KenhLienHe;
  /** Kênh người dùng đến từ đâu (?nguon=). Không định danh ai. */
  readonly nguon: string;
  /** ISO 8601. */
  readonly luc: string;
};

/**
 * Hàm đội dev nối vào backend của họ.
 * Bản mặc định (`luuTamTrenMay`) chỉ ghi vào localStorage và mở Zalo.
 */
/** Số điện thoại Việt Nam: 10 số, bắt đầu bằng 0. Chấp nhận khoảng trắng và dấu chấm. */
export function chuanHoaSoDienThoai(tho: string): string {
  return tho.replace(/[\s.\-()]/gu, "");
}

export function soDienThoaiHopLe(tho: string): boolean {
  return /^0\d{9}$/u.test(chuanHoaSoDienThoai(tho));
}

/**
 * Dựng phiếu gửi đi. 🔴 Chữ ký hàm CỐ Ý không nhận `BaiLam`, `KetQua`, hay `traLoi` —
 * không có đường nào để dữ liệu của trẻ lọt vào đây.
 */
export function taoPhieu(dauVao: {
  readonly soDienThoai: string;
  readonly tenGoi?: string;
  readonly kenhMuonNhan: KenhLienHe;
  readonly nguon: string;
  readonly luc: string;
}): PhieuLienHe {
  const ten = dauVao.tenGoi?.trim();
  return {
    soDienThoai: chuanHoaSoDienThoai(dauVao.soDienThoai),
    ...(ten ? { tenGoi: ten } : {}),
    kenhMuonNhan: dauVao.kenhMuonNhan,
    nguon: dauVao.nguon,
    luc: dauVao.luc,
  };
}

/**
 * Khoá bị cấm tuyệt đối trong phiếu. Dùng cho cả test lẫn kiểm lúc chạy.
 *
 * 🔴 THÊM TRƯỜNG MỚI VÀO `BaiLamLuu` THÌ PHẢI THÊM VÀO ĐÂY. `tests/lien-he-sach.test.ts`
 * có hàng rào biên dịch bắt việc này — bỏ sót là typecheck đỏ, không phải là im lặng lọt.
 */
export const KHOA_CAM = [
  "traLoi",
  "ketQua",
  "diem",
  "xepHang",
  "kieu",
  "canhBao",
  "boDe",
  "maTre",
  "lop",
  "tuoi",
  "banKhoan",
  "bietDanh",
  // 🆕 Sổ gia đình (12.1, ADR-007). `ten` và `ghiChu` là trường của THÀNH VIÊN — tên thật
  // của một đứa trẻ và ghi chú của bố mẹ về nó. Cả hai đều tuyệt đối không được rời máy.
  "maThanhVien",
  "ten",
  "ghiChu",
  "vaiTro",
] as const;

/** Soát một object bất kỳ xem có khoá cấm ở BẤT KỲ độ sâu nào. Trả về danh sách vi phạm. */
export function timKhoaCam(gia: unknown, duong = ""): string[] {
  if (gia === null || typeof gia !== "object") return [];
  const viPham: string[] = [];
  for (const [khoa, con] of Object.entries(gia as Record<string, unknown>)) {
    const day = duong ? `${duong}.${khoa}` : khoa;
    if ((KHOA_CAM as readonly string[]).includes(khoa)) viPham.push(day);
    viPham.push(...timKhoaCam(con, day));
  }
  return viPham;
}
