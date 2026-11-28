// NGUỒN: repo hodacphuchtc/DISC · đường dẫn gốc modules/report/noi-dung-ket-qua.ts · commit 5630a1c5605e580d688c5e8f52dedf4052aaed5c
// Bản vendoring NGUYÊN logic (chỉ đổi alias import @config/@modules -> @/lib/disc/engine-goc/...). Xem docs/disc-tich-hop/12-engine-tich-hop.md.
/**
 * NỘI DUNG MỘT BÀI ĐÃ LÀM, DẠNG DÒNG — nguồn cho tệp PDF cá nhân (17.3).
 *
 * 🔴 KHÔNG VIẾT MỘT CHỮ NỘI DUNG MỚI NÀO. Mọi câu ở đây đều lấy từ `layDienGiaiDay()` và
 * các bảng chữ trong `config/` — thứ đang chờ hai chữ ký chuyên môn. Viết thêm chữ ở tầng
 * xuất tệp là làm hồ sơ ký duyệt lỗi thời thêm một lần nữa, và lần này là ở một chỗ không
 * ai nghĩ tới lúc rà soát.
 *
 * 🔴 DÙNG LẠI KIỂU `DongBan` của `noi-dung-ban.ts` (16.6), cố ý. Hai bộ sinh PDF cùng một
 * bộ vẽ thì cùng một cách xuống dòng, cùng cỡ chữ, cùng cách ngắt trang — hai kiểu riêng
 * là hai bản dựng chỉ lệch nhau vào ngày ai đó sửa một bên.
 *
 * Thuộc TẦNG LÕI (ADR-004): hàm thuần, không React, không DOM.
 */

import { TIEU_DE_LOP } from "@/lib/disc/engine-goc/config/disc-bieu-hien";
import { TIEU_DE_KHOI } from "@/lib/disc/engine-goc/config/disc-dien-giai";
import { CHU_BA_BAN, TRUC } from "@/lib/disc/engine-goc/config/disc-tu-dien";
import { MA_TRUC, type MaBoDe, type MaTruc } from "@/lib/disc/engine-goc/modules/core/bo-de/kieu";
import { layDienGiaiDay } from "@/lib/disc/engine-goc/modules/report/dien-giai";
import type { DongBan } from "@/lib/disc/engine-goc/modules/report/noi-dung-ban";

/**
 * Một bài đủ để dựng bản đọc.
 *
 * 🔴 Record PHẲNG, cố ý không nhận thẳng `BaiLamLuu`: kiểu đó nằm ở `modules/core/luu-tru`,
 * vốn KHÔNG thuộc tầng lõi (nó đụng IndexedDB). Cùng lối với `DauVaoDienGiai`.
 */
export type BaiDeDoc = {
  readonly ten: string;
  readonly boDe: MaBoDe;
  readonly ketThuc: string;
  readonly diem: Readonly<Record<MaTruc, number>>;
  readonly xepHang: readonly MaTruc[];
  readonly tuoi?: number;
  readonly banKhoan?: string;
  /**
   * 🔴 Hồ sơ NHẬN QUA MÃ MỜI — người này làm bài ở máy khác, máy này chỉ có bốn con số.
   * Phải nói ra ở đầu tờ giấy: để người đọc tưởng bài làm trên máy này là để họ đi tìm
   * một bảng câu trả lời không tồn tại.
   */
  readonly nhanQuaMa?: boolean;
};

/** Nhãn phụ dưới tiêu đề: bộ đề và mốc thời gian. */
function dongDauTe(bai: BaiDeDoc, hienNgayGio: (x: string) => string): DongBan[] {
  const dong: DongBan[] = [
    { kieu: "tieuDe", chu: CHU_BA_BAN.tenChung.replace("{ten}", bai.ten) },
    { kieu: "than", chu: `${bai.boDe} · ${hienNgayGio(bai.ketThuc)}` },
  ];
  if (bai.nhanQuaMa) {
    dong.push({ kieu: "nhanManh", chu: CHU_KET_QUA_MA_MOI });
  }
  return dong;
}

/**
 * Câu nói rõ nguồn của một hồ sơ nhận qua mã mời.
 *
 * Để ở đây chứ không ở `config/disc-tu-dien.ts` vì nó chỉ mô tả NGUỒN DỮ LIỆU, không phải
 * nội dung nói về con người — nên nó không thuộc phần chờ ký duyệt.
 */
const CHU_KET_QUA_MA_MOI =
  "Hồ sơ này nhận qua mã mời: bài được làm ở một máy khác, máy này chỉ giữ bốn con số.";

/**
 * Mọi dòng chữ của MỘT bài, đúng thứ tự đọc.
 *
 * @param hienNgayGio truyền vào thay vì import — `tien-ich/ngay` thuộc tầng lõi nên import
 *   được, nhưng nhận qua tham số thì hàm này kiểm được bằng một mốc cố định, không phụ
 *   thuộc múi giờ máy chạy test.
 */
export function dongChoBai(
  bai: BaiDeDoc,
  hienNgayGio: (x: string) => string,
): DongBan[] {
  const dg = layDienGiaiDay({
    diem: bai.diem,
    xepHang: bai.xepHang,
    maBoDe: bai.boDe,
    ...(bai.tuoi !== undefined ? { tuoi: bai.tuoi } : {}),
    ...(bai.banKhoan !== undefined ? { banKhoan: bai.banKhoan } : {}),
  });

  const dong: DongBan[] = dongDauTe(bai, hienNgayGio);

  // Bốn điểm, một dòng — đi theo MA_TRUC để đọc cùng thứ tự với biểu đồ trên màn.
  dong.push({
    kieu: "tieuDeLat",
    chu: MA_TRUC.map((t) => `${TRUC[t].ten} ${bai.diem[t]}`).join("  ·  "),
  });

  dong.push({ kieu: "tieuDeLat", chu: dg.trongNhuTheNao });
  dong.push({ kieu: "than", chu: dg.diemManh });
  dong.push({ kieu: "than", chu: dg.choCanDeY });

  if (dg.pha) {
    dong.push({ kieu: "tieuDeTruc", chu: dg.pha.tieuDe });
    dong.push({ kieu: "than", chu: dg.pha.than });
  }

  /**
   * 🔴 ĐỦ BỐN TRỤC, KHÔNG BAO GIỜ ÍT HƠN. Đặc tả §9.2 luật 2 đòi mỗi TRỤC nêu cả mặt mạnh
   * lẫn mặt cần để ý — và dự án này đã trả giá đắt nhất một lần vì làm theo KIỂU thay vì
   * theo TRỤC: phụ huynh nhìn biểu đồ bốn cột có số đầy đủ mà chỉ đọc được chữ về một nhóm.
   */
  dong.push({ kieu: "tieuDeLat", chu: TIEU_DE_LOP.phoBonNhom });
  for (const t of dg.phoBonNhom) {
    dong.push({ kieu: "tieuDeTruc", chu: `${TRUC[t.truc].ten} — ${t.diem}` });
    dong.push({ kieu: "than", chu: t.bieuHien });
    dong.push({ kieu: "than", chu: t.than });
    if (t.choCanDeY) dong.push({ kieu: "than", chu: t.choCanDeY });
    if (t.mucDoRo) dong.push({ kieu: "than", chu: t.mucDoRo });
  }

  /**
   * Ba câu để hỏi / tự hỏi tối nay.
   *
   * 🔴 NHÃN ĐỔI THEO AI TỰ LÀM BÀI, không đổi theo cảm tính. Bộ TH/THCS/PH là người tự
   * đánh giá ⇒ *"3 câu để tự hỏi mình"*; bộ MN/QS là người lớn trả lời hộ ⇒ *"3 câu để hỏi
   * con tối nay"*. Đây là một trong ba lỗi nội dung của GĐ9 chỉ lộ ra khi NHÌN ảnh chụp:
   * bộ THCS hiện "3 câu để tự hỏi mình" mà ruột là câu viết cho phụ huynh hỏi con. Lấy
   * đúng luật của màn kết quả ([ket-qua.tsx:71](app/khoang/ket-qua.tsx#L71)) chứ không
   * đoán lại.
   */
  if (dg.cauHoiToiNay.length > 0) {
    const tuDanhGia = bai.boDe === "TH" || bai.boDe === "THCS" || bai.boDe === "PH";
    dong.push({
      kieu: "tieuDeLat",
      chu: tuDanhGia ? TIEU_DE_KHOI.cauHoiToiNayTuMinh : TIEU_DE_KHOI.cauHoiToiNay,
    });
    for (const c of dg.cauHoiToiNay) dong.push({ kieu: "than", chu: `— ${c}` });
  }

  /**
   * 🔴 BA BẢN LÀ BA BỘ CHỮ KHÁC NHAU, không phải bản dịch của nhau. Tách bằng CẤU TRÚC:
   * mỗi bản một trường riêng ở `DienGiaiDay`, nên không có đường nào đổ chữ của bố mẹ vào
   * mục của con. Ở đây chỉ việc đi theo đúng những trường đó.
   */
  if (dg.banCon) {
    dong.push({
      kieu: "tieuDe",
      chu: CHU_BA_BAN.tenCon.replace("{ten}", bai.ten).replace("{chuThe}", "em"),
    });
    dong.push({ kieu: "tieuDeTruc", chu: TIEU_DE_LOP.cangThang.replace("{chuThe}", "em") });
    dong.push({ kieu: "than", chu: dg.banCon.khiCangThang });
    dong.push({ kieu: "tieuDeTruc", chu: TIEU_DE_LOP.linhHoat });
    dong.push({ kieu: "than", chu: dg.banCon.tapThem });
    dong.push({ kieu: "nhanManh", chu: `${TIEU_DE_LOP.motViec} ${dg.banCon.motViecToiNay}` });
  }

  if (dg.banTuMinh) {
    dong.push({ kieu: "tieuDe", chu: CHU_BA_BAN.tenTuMinh.replace("{ten}", bai.ten) });
    dong.push({ kieu: "tieuDeTruc", chu: TIEU_DE_LOP.cangThang.replace("{chuThe}", "bạn") });
    dong.push({ kieu: "than", chu: dg.banTuMinh.khiCangThang });
    dong.push({ kieu: "tieuDeTruc", chu: TIEU_DE_LOP.linhHoat });
    dong.push({ kieu: "than", chu: dg.banTuMinh.tapThem });
    dong.push({
      kieu: "nhanManh",
      chu: `${TIEU_DE_LOP.motViec} ${dg.banTuMinh.motViecToiNay}`,
    });
  }

  if (dg.banBoMe) {
    const b = dg.banBoMe;
    dong.push({ kieu: "tieuDe", chu: CHU_BA_BAN.tenBoMe.replace("{ten}", bai.ten) });
    dong.push({ kieu: "tieuDeTruc", chu: TIEU_DE_LOP.noiChuyen.replace("{chuThe}", bai.ten) });
    dong.push({ kieu: "than", chu: b.noiTheNao });
    dong.push({ kieu: "tieuDeTruc", chu: TIEU_DE_LOP.cauNenNoi });
    for (const c of b.cauNenNoi) dong.push({ kieu: "than", chu: `— ${c}` });
    dong.push({ kieu: "tieuDeTruc", chu: TIEU_DE_LOP.cauNenTranh });
    for (const c of b.cauNenTranh) dong.push({ kieu: "than", chu: `— ${c}` });
    dong.push({ kieu: "tieuDeTruc", chu: TIEU_DE_LOP.cangThang.replace("{chuThe}", bai.ten) });
    dong.push({ kieu: "than", chu: b.khiCangThang });
    /**
     * 🔴 CẶP NÀY LUÔN ĐI CÙNG NHAU (quyết định 27/08): một kỹ năng dạy con dùng THÊM, và
     * một điều bố mẹ TỰ chỉnh. Tách rời chúng là quay về đúng lối "nâng trục thấp" — ngầm
     * nói đứa trẻ đang thiếu, đụng thẳng ADR-002.
     */
    dong.push({ kieu: "than", chu: b.kyNangThem });
    dong.push({ kieu: "than", chu: b.boMeChinh });
    dong.push({ kieu: "than", chu: b.cungHocTheNao });
    dong.push({ kieu: "nhanManh", chu: `${TIEU_DE_LOP.motViec} ${b.motViecToiNay}` });
  }

  if (dg.banKhoan) {
    dong.push({ kieu: "tieuDeTruc", chu: dg.banKhoan.nhan });
    dong.push({ kieu: "than", chu: dg.banKhoan.loiMoDau });
  }

  return dong;
}
