// lib/cham-cong/mau-o-cong.ts — luật TÔ MÀU ô của Bảng công tháng. THUẦN: không DB,
// không React, không đọc đồng hồ (ngày đã qua hay chưa do người gọi quyết định).
//
// ─────────────────────────────────────────────────────────────────────────────
// VÌ SAO TÁCH RA HÀM THUẦN
//
// Đây là thứ DUY NHẤT người quản lý đọc khi lướt lưới 19 người × 30 ngày. Sai một nhánh là
// bôi đen oan một người suốt cả tháng — và không có gì báo lỗi: trang vẫn render, console
// vẫn sạch, test UI vẫn xanh. Cùng họ với luật 12 (affordance phải nói thật). Viết inline
// trong component thì không có chỗ cấy lỗi để chứng minh lưới bắt được gì.
//
// ─────────────────────────────────────────────────────────────────────────────
// MỘT NGUỒN CHO CẢ TÔ MÀU LẪN CHÚ GIẢI
//
// `MAU_O` vừa cấp lớp CSS cho ô, vừa cấp nhãn cho khối chú giải. Cố ý: chú giải viết tay
// tách rời là chú giải sẽ trôi khỏi luật sau vài đợt sửa, và không ai phát hiện vì hai bên
// không bao giờ gặp nhau. Ca test `MAU_O — bảng nhãn là NGUỒN DUY NHẤT` ghim điều đó.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ HAI Ô KHÁC NHAU, ĐỪNG GỘP: "vắng chờ kết luận" vs "nghỉ không phép"
//
// Chủ dự án mô tả màu đen là *"đến ca làm việc mà nghỉ không xin phép"*. Hệ thống KHÔNG suy
// được điều đó: thứ nó biết là cờ `KHONG_CO_LUOT` (không quét lượt nào), mà cờ ấy còn do
// quên bấm, quầy hỏng, đi công tác. Chốt 06/09/2026 nói thẳng "không tự động trừ từ cờ
// `KHONG_CO_LUOT`". Kết luận nằm ở cột `absenceStatus`, do QUẢN LÝ bấm.
//
// Đo trên dữ liệu tháng 9/2026: **19 ngày mang `KHONG_CO_LUOT`, 0 ngày có `absenceStatus`**
// — tô đen thẳng từ cờ là bôi đen 19 lượt trong khi không ngày nào bị trừ công.

export type MauO =
  /** Không xếp ca — không có gì để nói. */
  | "TRONG"
  /** Có ca nhưng chưa tới ngày làm. */
  | "CHUA_TOI"
  /** Ngày ĐÃ QUA, có ca, nhưng engine chưa tính — chưa có dòng bảng công nào. */
  | "CHUA_TINH"
  /** Nghỉ theo lịch hoặc nghỉ đã được xác nhận có lý do. */
  | "NGHI"
  /** Đi làm, không cờ nặng. */
  | "DU_CONG"
  /** Thiếu mốc quét — lỗi thao tác, nộp đơn chỉnh công là xong. */
  | "THIEU_LUOT"
  /** Có mặt nhưng hụt quá 60′ so với kế hoạch, KHÔNG muộn cũng KHÔNG về sớm. */
  | "THIEU_GIO"
  /** Về sớm hơn giờ tan ca quá dung sai. */
  | "VE_SOM"
  /** Vào muộn hơn giờ vào ca quá dung sai. */
  | "DI_MUON"
  /** Quản lý đã kết luận nghỉ không phép. */
  | "NGHI_KHONG_PHEP"
  /** Không có lượt nào, ngày đã qua, chưa ai kết luận. */
  | "CHO_KET_LUAN";

/** Dấu ở GÓC ô. Cố ý không đổi nền — nếu đổi thì "đỏ lòm" mất nghĩa. */
export type DauHieu = "KHOA" | "GHI_DE" | "SAI_CHO" | "NGOAI_LICH";

export type ONgayVao = {
  /** Có ô ca ACTIVE trong lưới phân ca. */
  coCa: boolean;
  /** Ngày này đã qua (hoặc là hôm nay) theo lịch VN. Người gọi tính, hàm không đọc đồng hồ. */
  daQua: boolean;
  /**
   * Đã có dòng `StaffAttendanceDay` cho ngày này chưa.
   *
   * ⚠️ TRƯỜNG BẮT BUỘC, cố ý không mặc định (luật 7). Thiếu nó thì ngày chưa tính rơi xuống
   * nhánh cuối và hiện thành "Đi làm, đúng giờ" MÀU XANH — đo 25/09/2026 trên dữ liệu thật:
   * **155/378 ô ca của ngày đã qua chưa có dòng bảng công, dính cả 18 người**, và cả 155 ngày
   * ấy đang được tô xanh "đúng giờ" với 0 công. Nói dối im lặng: nhìn thì yên tâm, số thì rỗng.
   */
  daTinh: boolean;
  dayType: "WORK" | "WEEKLY_OFF" | "LEAVE" | "HOLIDAY" | "UNSCHEDULED" | null;
  flags: readonly string[];
  absenceStatus: "UNAUTHORISED" | "EXCUSED" | null;
  /** `0` là giá trị THẬT (ghi đè về 0 công) — đừng kiểm bằng falsy. */
  overrideUnits: number | null;
  locked: boolean;
};

// Ba tập cờ. Tách riêng vì thứ tự xét giữa chúng là QUYẾT ĐỊNH nghiệp vụ, không phải chi tiết.
// Ba cờ giờ giấc, xét RIÊNG — chốt 25/09/2026: "phân định rõ đi muộn hay về sớm".
//
// ⚠️ `THIEU_GIO` CHỈ hiện khi đứng MỘT MÌNH. Chủ dự án nhận xét "có 1 trong 2 cái kia thì
// 100% thiếu giờ nên không cần hiển thị" — đo tháng 9/2026 xác nhận vế đó: 8 ngày về sớm,
// 0 ngày trong đó thiếu `THIEU_GIO`.
//
// NHƯNG chiều ngược lại KHÔNG đúng: **7/15 ngày thiếu giờ không hề muộn cũng không về sớm**
// (ra giữa ngày rồi vào lại). Gỡ hẳn cờ này là 7 ngày ấy hoá XANH "đi làm đúng giờ" trong
// khi người đó hụt hơn một tiếng — nên nó giữ ô riêng, chỉ thôi chen vào khi đã có ô nặng hơn.
//
// Ngưỡng cũng khác nhau, đừng suy cái này ra cái kia: `VE_SOM` bắt từ `lateGraceMinutes`
// (mặc định 30′), `THIEU_GIO` từ 60′ (`engine.ts:408`). Về sớm 40′ là muộn-sớm mà không thiếu giờ.
const CO_THIEU_LUOT = new Set([
  "THIEU_LUOT_RA",
  "RA_KHONG_CO_VAO",
  "THIEU_BUOI_SANG",
  "THIEU_BUOI_CHIEU",
  "THIEU_LUOT_GIUA_CA",
]);
const CO_SAI_CHO = new Set(["NGOAI_VUNG", "SAI_NOI_LAM"]);

/**
 * Nền ô + dấu góc cho MỘT ngày của MỘT người.
 *
 * Thứ tự xét là luật, không phải tình cờ — ghi ra để lần sau ai đổi thì biết mình đổi cái gì:
 *
 *  1. không có ca            → TRONG      (chưa xếp thì chưa có gì để chấm)
 *  2. chưa tới ngày          → CHUA_TOI   (kể cả khi đã mang cờ; ngày mai chưa ai quét)
 *  3. `absenceStatus`        → NGHI_KHONG_PHEP / NGHI
 *       Kết luận của NGƯỜI thắng mọi cờ của MÁY: nó do quản lý ghi và sống sót qua mỗi lần
 *       engine tính lại. Xét sau cờ thì màn hình nói ngược kết luận vừa bấm.
 *  4. nghỉ theo lịch         → NGHI
 *  5. KHONG_CO_LUOT          → CHO_KET_LUAN  (xem khối ⚠️ đầu file)
 *  6. vi phạm giờ            → VI_PHAM_GIO   (nặng hơn, xét TRƯỚC thiếu lượt)
 *  7. thiếu mốc quét         → THIEU_LUOT
 *  8. còn lại                → DU_CONG
 */
export function phanLoaiO(o: ONgayVao): { mau: MauO; dauHieu: DauHieu[] } {
  const dauHieu: DauHieu[] = [];
  if (o.locked) dauHieu.push("KHOA");
  if (o.overrideUnits !== null && o.overrideUnits !== undefined) dauHieu.push("GHI_DE");
  if (o.flags.some((f) => CO_SAI_CHO.has(f))) dauHieu.push("SAI_CHO");
  if (o.flags.includes("CHAM_NGOAI_LICH")) dauHieu.push("NGOAI_LICH");

  const mau = ((): MauO => {
    if (!o.coCa) return "TRONG";
    if (!o.daQua) return "CHUA_TOI";
    // Xét NGAY sau "chưa tới ngày": không có dòng bảng công thì mọi cờ đều rỗng và mọi nhánh
    // dưới đây đều rơi về DU_CONG. Đây là chỗ duy nhất chặn được.
    if (!o.daTinh) return "CHUA_TINH";
    if (o.absenceStatus === "UNAUTHORISED") return "NGHI_KHONG_PHEP";
    if (o.absenceStatus === "EXCUSED") return "NGHI";
    if (o.dayType === "HOLIDAY" || o.dayType === "WEEKLY_OFF" || o.dayType === "LEAVE") {
      return "NGHI";
    }
    if (o.flags.includes("KHONG_CO_LUOT")) return "CHO_KET_LUAN";
    // Muộn TRƯỚC sớm khi ngày có cả hai: đó là thứ hỏng trước trong ngày, và cột đếm bên
    // phải vẫn đếm RIÊNG từng cờ nên không con số nào mất.
    if (o.flags.includes("DI_MUON")) return "DI_MUON";
    if (o.flags.includes("VE_SOM")) return "VE_SOM";
    if (o.flags.some((f) => CO_THIEU_LUOT.has(f))) return "THIEU_LUOT";
    if (o.flags.includes("THIEU_GIO")) return "THIEU_GIO";
    return "DU_CONG";
  })();

  return { mau, dauHieu };
}

export type MauMeta = {
  nhan: string;
  moTa: string;
  /** Lớp nền + chữ của ô trong lưới. Chỉ token `:root` (`--state-*`) — xem DESIGN.md §1. */
  lopO: string;
  /** Ô vuông nhỏ trong khối chú giải. */
  lopChuGiai: string;
  /** Có tính là "cần rà" khi đếm cho cột xếp hàng không. */
  nang: boolean;
};

/**
 * Bảng nhãn — NGUỒN DUY NHẤT cho cả ô lưới lẫn khối chú giải.
 *
 * Thứ tự khai = thứ tự hiện trong chú giải, đi từ nhẹ tới nặng để mắt đọc thành một thang.
 */
export const MAU_O: Record<MauO, MauMeta> = {
  TRONG: {
    nhan: "Không xếp ca",
    moTa: "Ngày này người đó không có ca trong lưới phân ca.",
    lopO: "bg-transparent text-muted-foreground",
    lopChuGiai: "border border-dashed border-border bg-transparent",
    nang: false,
  },
  CHUA_TOI: {
    nhan: "Chưa tới ngày",
    moTa: "Đã xếp ca nhưng ngày làm chưa đến — chưa chấm được gì.",
    lopO: "bg-muted text-muted-foreground",
    lopChuGiai: "bg-muted",
    nang: false,
  },
  CHUA_TINH: {
    nhan: "Chưa tính",
    moTa: "Ngày đã qua và có ca, nhưng engine chưa tính bảng công ngày — số công đang là 0 và KHÔNG phải vì người ta nghỉ. Bấm \"Tính lại\" ở Bảng công ngày. Chốt kỳ khi còn ô này là chốt ở 0 công.",
    // Nền xám như "chưa tới ngày" (đều là "chưa có kết quả") nhưng đeo viền cảnh báo — nó
    // KHÁC hẳn ở chỗ ngày này đã qua rồi, tức là có việc phải làm.
    lopO: "bg-muted text-muted-foreground ring-1 ring-inset ring-state-warning",
    lopChuGiai: "bg-muted ring-1 ring-inset ring-state-warning",
    nang: false,
  },
  NGHI: {
    nhan: "Nghỉ có lý do",
    moTa: "Nghỉ phép, nghỉ lễ, nghỉ tuần, hoặc vắng đã được quản lý xác nhận có lý do. Không trừ công.",
    lopO: "bg-state-info-soft text-state-info-ink",
    lopChuGiai: "bg-state-info-soft",
    nang: false,
  },
  DU_CONG: {
    nhan: "Đi làm, đúng giờ",
    moTa: "Có đủ mốc quét và không có cờ nặng nào.",
    lopO: "bg-state-success-soft text-state-success-ink",
    lopChuGiai: "bg-state-success-soft",
    nang: false,
  },
  THIEU_LUOT: {
    nhan: "Thiếu mốc quét",
    moTa: "Quên quét vào hoặc ra (kể cả lượt giữa ca). Là lỗi thao tác — nộp đơn chỉnh công là xong.",
    lopO: "bg-state-warning-soft text-state-warning-ink",
    lopChuGiai: "bg-state-warning-soft",
    nang: false,
  },
  THIEU_GIO: {
    nhan: "Thiếu giờ",
    moTa: "Có mặt, vào đúng giờ và về đúng giờ, nhưng tổng giờ làm hụt quá 60 phút so với ca — thường là ra giữa ngày rồi vào lại. KHÔNG tính vào nội quy.",
    lopO: "bg-state-warning/35 text-state-warning-ink ring-1 ring-inset ring-state-warning/40",
    lopChuGiai: "bg-state-warning/35 ring-1 ring-inset ring-state-warning/40",
    nang: false,
  },
  VE_SOM: {
    nhan: "Về sớm",
    moTa: "Quét ra trước giờ tan ca quá dung sai. Tính vào nội quy.",
    // Cùng họ đỏ với "đi muộn" (cả hai đều là vi phạm giờ giấc, phải đọc thành đỏ khi lướt),
    // nhưng NHẠT HƠN để phân biệt được khi nhìn kỹ. Chốt 25/09: "phân định rõ".
    lopO: "bg-state-danger/15 text-state-danger-ink ring-1 ring-inset ring-state-danger/30",
    lopChuGiai: "bg-state-danger/15 ring-1 ring-inset ring-state-danger/30",
    nang: true,
  },
  DI_MUON: {
    nhan: "Đi muộn",
    moTa: "Quét vào sau giờ bắt đầu ca quá dung sai. Tính vào nội quy.",
    // ĐO 25/09: token `-soft` chỉ 12% alpha (`#ef44441f`) — ô đỏ KHÔNG nổi hơn ô xanh, tức
    // mục tiêu "nhìn thấy đỏ lòm là biết ai vi phạm" không đạt. Nâng lên 30% + viền trong:
    // hợp nền trắng ra ~rgb(250,199,199), tương phản với ink `#b91c1c` còn ~4,6:1.
    lopO: "bg-state-danger/30 text-state-danger-ink ring-1 ring-inset ring-state-danger/40",
    lopChuGiai: "bg-state-danger/30 ring-1 ring-inset ring-state-danger/40",
    nang: true,
  },
  NGHI_KHONG_PHEP: {
    nhan: "Nghỉ không phép",
    moTa: "Quản lý đã xác nhận vắng không có lý do. Chỉ vào ô này khi có người bấm kết luận.",
    lopO: "bg-foreground text-background",
    lopChuGiai: "bg-foreground",
    nang: true,
  },
  CHO_KET_LUAN: {
    nhan: "Vắng, chờ kết luận",
    moTa: "Ngày đã qua mà không có lượt quét nào, và chưa ai kết luận. Có thể là quên quét, quầy hỏng, đi công tác — chưa phải nghỉ không phép.",
    lopO: "border-2 border-dashed border-foreground/50 bg-background text-foreground",
    lopChuGiai: "border-2 border-dashed border-foreground/50 bg-background",
    nang: false,
  },
};

/** Thứ tự hiện trong chú giải — nhẹ → nặng. */
export const THU_TU_CHU_GIAI: MauO[] = [
  "TRONG",
  "CHUA_TOI",
  "CHUA_TINH",
  "NGHI",
  "DU_CONG",
  "THIEU_LUOT",
  "THIEU_GIO",
  "CHO_KET_LUAN",
  "VE_SOM",
  "DI_MUON",
  "NGHI_KHONG_PHEP",
];

export const DAU_HIEU_META: Record<DauHieu, { nhan: string; moTa: string }> = {
  KHOA: { nhan: "Kỳ đã chốt", moTa: "Số công của ngày này đã đóng băng, không màn nào sửa được nữa." },
  GHI_DE: { nhan: "Quản lý ghi đè công", moTa: "Số công của ngày này do người đặt tay, không phải engine tính." },
  SAI_CHO: { nhan: "Sai nơi làm / ngoài vùng", moTa: "Có quét nhưng ở ngoài vùng cho phép, hoặc không đúng nơi được phân công." },
  NGOAI_LICH: { nhan: "Chấm ngoài lịch", moTa: "Có lượt quét trong ngày không được xếp ca." },
};

export type DemMau = Record<MauO, number> & {
  /** Đỏ + đen — con số dùng để xếp ai vi phạm nhiều lên đầu. */
  nang: number;
};

/** Đếm ô theo màu cho MỘT người, để xếp hàng và in cột tổng. */
export function demTheoMau(o: readonly { mau: MauO }[]): DemMau {
  const d = Object.fromEntries(
    (Object.keys(MAU_O) as MauO[]).map((k) => [k, 0]),
  ) as Record<MauO, number>;
  let nang = 0;
  for (const x of o) {
    d[x.mau] += 1;
    if (MAU_O[x.mau].nang) nang += 1;
  }
  return { ...d, nang };
}
