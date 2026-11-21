/**
 * lib/cham-cong/suy-huong.ts — CHẤM CÔNG MỘT NÚT: máy chủ tự suy lượt này là VÀO hay RA.
 *
 * THUẦN: không `@/lib/db`, không `next/*`, không đọc đồng hồ. Phần đọc DB ở `suy-huong-db.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VÌ SAO TỒN TẠI (chủ dự án yêu cầu 06/10/2026)
 *
 * *"Chấm công chỉ có 1 nút (check in / check out người dùng dễ bấm nhầm). Hệ thống tự biết khi
 * nào là check in, khi nào là check out."* — và chốt: **suy THEO CA**, không đếm chẵn/lẻ;
 * không có ca thì xen kẽ theo lượt trước.
 *
 * Đếm chẵn/lẻ bị loại vì MỘT lượt quên là lệch cả ngày còn lại: quên quét RA trưa thì lượt vào
 * buổi chiều bị ghi thành RA, lượt về thành VÀO. Suy theo ca thì lượt quên chỉ hỏng ĐÚNG buổi
 * của nó.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "BUỔI" LÀ GÌ — CỤM QUÉT KỲ VỌNG của engine, không phải từng đoạn WORK
 *
 * Bản giao việc nói "đoạn WORK". Làm theo nguyên văn thì sai ở hai mã ca có thật:
 *   · `CS` (14:00–16:30 · nghỉ CÓ TÍNH CÔNG · 17:00–21:00): người về sớm lúc 18:00 rơi vào
 *     NỬA ĐẦU đoạn thứ hai ⇒ bị ghi VÀO. Nghỉ có tính công thì không ai quét giữa nó.
 *   · `CG` (09:00–11:30 · 14:00–17:45, khai `soCapQuetKyVong = 1`): danh mục nói rõ ca này chỉ
 *     đòi MỘT cặp; người về lúc 15:00 cũng bị ghi VÀO.
 * Nên "buổi" = `cumQuetKyVong` — ĐÚNG thứ engine dùng để chấm đi muộn / về sớm / thiếu buổi.
 * Hai bên dùng chung một định nghĩa thì "lượt này thuộc buổi nào" không thể nói khác nhau.
 * Hàm `cacBuoiTuCa` bên dưới dựng nó y như engine (`engine.ts` → `planned` → `cumQuetKyVong`).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LUẬT (đúng thứ tự xét)
 *
 * | # | điều kiện | hướng | `lyDo` |
 * |---|---|---|---|
 * | a | lượt cuối cách < `phutTrung` | CÙNG chiều lượt cuối, `trung` | `TRUNG` |
 * | d | không có buổi nào (không ca / ca không đòi quét) | xen kẽ: cuối là VÀO ⇒ RA, còn lại VÀO | `KHONG_CA` |
 * | b1 | đang có VÀO mở, cùng buổi với lượt này | RA | `RA_CUNG_BUOI` |
 * | b2 | VÀO mở ở buổi TRƯỚC, lượt này trước giữa buổi mới | VÀO (quên RA giữa ca) | `VAO_BUOI_MOI` |
 * | b3 | VÀO mở ở buổi TRƯỚC, lượt này từ giữa buổi mới trở đi | RA (làm liền qua nghỉ) | `RA_LAM_LIEN` |
 * | c1 | không VÀO mở, giờ quét ≥ hết buổi, buổi chưa có lượt nào | RA (quên VÀO) | `RA_QUEN_VAO` |
 * | c2 | không VÀO mở, còn lại | VÀO | `VAO` |
 *
 * Lượt được gán vào buổi GẦN NHẤT: nằm trong buổi thì là buổi đó; nằm ngoài thì buổi có MÉP gần
 * nhất; cách đều hai mép thì lấy buổi TRƯỚC (cố định một phía để cùng dữ liệu ra cùng kết quả).
 *
 * ⚠️ Bấm trùng (a) KHÔNG đổi engine: lượt trùng mang CÙNG chiều nên `dedupeTaps` loại nó như cũ,
 * và `recordTimeLog` gắn `TRUNG_2_PHUT` theo đúng điều kiện ấy. Nếu suy ra chiều NGƯỢC cho một
 * lượt bấm hai lần, mỗi lần bấm nhầm thành một cặp vào–ra 1 phút — tệ hơn cả hai nút cũ.
 *
 * ⚠️ Giới hạn đã biết — KHÔNG có luật nào đúng cho mọi ca: VÀO mở từ sáng, lượt kế tiếp rơi vào
 * khoảng nghỉ nhưng GẦN buổi chiều hơn (vd. đi ăn trưa muộn lúc 12:40 với nghỉ 11:30–13:30) sẽ
 * bị ghi VÀO. Đường sửa là đơn chỉnh công — màn chấm công in sẵn dòng "Ghi sai? Nộp đơn chỉnh
 * công" và nói thẳng hướng VỪA GHI, để người ta biết ngay mà sửa.
 */
import { cumQuetKyVong } from "./cum-quet";

export type HuongLuot = "CHECK_IN" | "CHECK_OUT";

/** Một buổi của ca hôm nay — phút tính từ 00:00 giờ VN. */
export type BuoiCa = { batDau: number; ketThuc: number };

/** Một lượt đã được ghi trong ngày (ACCEPTED, KHÔNG gồm lượt đã bị thay thế). */
export type LuotTruoc = { gio: number; huong: HuongLuot };

export type LyDoSuyHuong =
  | "TRUNG"
  | "KHONG_CA"
  | "RA_CUNG_BUOI"
  | "VAO_BUOI_MOI"
  | "RA_LAM_LIEN"
  | "RA_QUEN_VAO"
  | "VAO";

export type KetQuaSuyHuong = {
  huong: HuongLuot;
  /** Số thứ tự buổi (1-based) mà lượt này thuộc về; `null` khi không có ca. */
  buoi: number | null;
  lyDo: LyDoSuyHuong;
  /** Bấm trùng — engine sẽ loại lượt này khỏi phép ghép (như cũ). */
  trung: boolean;
};

export type SuyHuongInput = {
  /** Phút VN trong ngày của lượt đang ghi. */
  gioQuet: number;
  /** Buổi của ca hôm nay, kết quả `cacBuoiTuCa`. Rỗng ⇒ luật xen kẽ. */
  cacBuoi: readonly BuoiCa[];
  luotTruoc: readonly LuotTruoc[];
  /** `shift.duplicateTapMinutes` — BẮT BUỘC (luật 7): phải là đúng con số `recordTimeLog` dùng. */
  phutTrung: number;
};

/** Khoảng cách (phút) từ `g` tới buổi `b`; 0 khi nằm trong buổi. */
function khoangCach(g: number, b: BuoiCa): number {
  if (g < b.batDau) return b.batDau - g;
  if (g > b.ketThuc) return g - b.ketThuc;
  return 0;
}

/** Chỉ số (0-based) của buổi gần nhất. `cacBuoi` đã sắp xếp. Cách đều ⇒ buổi TRƯỚC (`<`). */
function buoiGanNhat(g: number, cacBuoi: readonly BuoiCa[]): number {
  let iTot = 0;
  let kcTot = Infinity;
  cacBuoi.forEach((b, i) => {
    const kc = khoangCach(g, b);
    if (kc < kcTot) {
      kcTot = kc;
      iTot = i;
    }
  });
  return iTot;
}

export function suyHuongLuot(input: SuyHuongInput): KetQuaSuyHuong {
  const { gioQuet: g, phutTrung } = input;
  const cacBuoi = [...input.cacBuoi].filter((b) => b.ketThuc > b.batDau).sort((x, y) => x.batDau - y.batDau);
  // Chỉ lượt ĐÃ xảy ra trước (hoặc cùng phút với) lượt này. Lượt giờ muộn hơn chỉ có thể là mốc
  // chỉnh tay của quản lý ghi trước cho cả ngày — nó không nói gì về việc người ta vừa làm gì.
  const truoc = [...input.luotTruoc].filter((l) => l.gio <= g).sort((x, y) => x.gio - y.gio);
  const cuoi = truoc[truoc.length - 1];
  const coCa = cacBuoi.length > 0;
  const iBuoi = coCa ? buoiGanNhat(g, cacBuoi) : -1;
  const buoi = coCa ? iBuoi + 1 : null;

  // (a) Bấm trùng — cùng chiều lượt cuối.
  if (cuoi && g - cuoi.gio < phutTrung) {
    return { huong: cuoi.huong, buoi, lyDo: "TRUNG", trung: true };
  }

  // (d) Không có ca ⇒ xen kẽ.
  if (!coCa) {
    return { huong: cuoi?.huong === "CHECK_IN" ? "CHECK_OUT" : "CHECK_IN", buoi: null, lyDo: "KHONG_CA", trung: false };
  }

  const b = cacBuoi[iBuoi]!;

  // (b) Đang có VÀO mở.
  if (cuoi?.huong === "CHECK_IN") {
    const iBuoiVao = buoiGanNhat(cuoi.gio, cacBuoi);
    if (iBuoiVao >= iBuoi) return { huong: "CHECK_OUT", buoi, lyDo: "RA_CUNG_BUOI", trung: false };
    const giua = (b.batDau + b.ketThuc) / 2;
    if (g < giua) return { huong: "CHECK_IN", buoi, lyDo: "VAO_BUOI_MOI", trung: false };
    return { huong: "CHECK_OUT", buoi, lyDo: "RA_LAM_LIEN", trung: false };
  }

  // (c) Không có VÀO mở.
  if (g >= b.ketThuc) {
    const buoiCoLuot = truoc.some((l) => buoiGanNhat(l.gio, cacBuoi) === iBuoi);
    if (!buoiCoLuot) return { huong: "CHECK_OUT", buoi, lyDo: "RA_QUEN_VAO", trung: false };
    // Buổi này đã xong (có lượt, đã RA) mà còn quét sau giờ kết thúc ⇒ VÀO thuộc buổi KẾ TIẾP
    // nếu có — kẻo màn hình in "VÀO buổi sáng" lúc 12:31 cho người vừa ăn trưa xong.
    const iKe = Math.min(iBuoi + 1, cacBuoi.length - 1);
    return { huong: "CHECK_IN", buoi: iKe + 1, lyDo: "VAO", trung: false };
  }
  return { huong: "CHECK_IN", buoi, lyDo: "VAO", trung: false };
}

/** "HH:mm" → phút. */
function phut(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Buổi của ca hôm nay, dựng Y NHƯ engine dựng cụm quét kỳ vọng:
 * mọi đoạn (WORK + nghỉ có tính công) gộp theo liền kề → `cumQuetKyVong(…, soCap)`.
 *
 * Trả `[]` khi ca không đòi quét (`soCapQuetKyVong = 0`, hoặc không có đoạn giờ nào) ⇒ luật
 * xen kẽ. Đó cũng là cách engine coi các mã ấy: không kiểm quét.
 */
export function cacBuoiTuCa(
  segments: readonly { start: string; end: string }[],
  soCapQuetKyVong: number,
): BuoiCa[] {
  const soCap = soCapQuetKyVong === 2 ? 2 : soCapQuetKyVong === 1 ? 1 : 0;
  const doan = [...segments]
    .map((s) => ({ start: phut(s.start), end: phut(s.end) }))
    .filter((d) => d.end > d.start)
    .sort((a, b) => a.start - b.start);
  const gop: { start: number; end: number }[] = [];
  for (const d of doan) {
    const last = gop[gop.length - 1];
    if (last && d.start <= last.end) last.end = Math.max(last.end, d.end);
    else gop.push({ ...d });
  }
  return cumQuetKyVong(gop, soCap).map((c) => ({ batDau: c.start, ketThuc: c.end }));
}

/**
 * Nhãn người đọc của buổi thứ `buoi` (1-based): "ca hôm nay" khi ca chỉ có một buổi; còn lại
 * "buổi sáng/chiều/tối" theo giờ bắt đầu — trùng nhãn thì rơi về "buổi 1/2".
 */
export function nhanBuoi(cacBuoi: readonly BuoiCa[], buoi: number | null): string | null {
  if (buoi == null || cacBuoi.length === 0) return null;
  if (cacBuoi.length === 1) return "ca hôm nay";
  const ten = (b: BuoiCa) => (b.batDau < 11 * 60 ? "buổi sáng" : b.batDau < 17 * 60 ? "buổi chiều" : "buổi tối");
  const ds = cacBuoi.map(ten);
  const b = cacBuoi[buoi - 1];
  if (!b) return null;
  return new Set(ds).size === ds.length ? ten(b) : `buổi ${buoi}`;
}

/** Chữ hướng cho người đọc — MỘT nơi, mọi màn dùng chung. */
export const NHAN_HUONG: Record<HuongLuot, string> = { CHECK_IN: "VÀO", CHECK_OUT: "RA" };

/**
 * DỰ ĐOÁN hiện TRƯỚC khi bấm — trang (RSC) gọi `suyHuongHomNay` lúc tải rồi truyền xuống.
 *
 * ⚠️ Chỉ là dự đoán TẠI LÚC TẢI TRANG. Hướng ghi thật do máy chủ suy lại LÚC BẤM (giờ đã khác,
 * có thể đã có lượt khác chen vào), và màn "Đã ghi …" sau khi bấm mới là con số thật. Câu chữ
 * vì thế phải nói rõ "dự đoán" — in như một khẳng định là lời hứa suông (luật 12).
 */
export type DuDoanHuong = { huong: HuongLuot; nhanBuoi: string | null; trung: boolean };

/** Câu dự đoán dùng chung cho màn QR và nút công tác. */
export function cauDuDoan(d: DuDoanHuong): string {
  const dich = [NHAN_HUONG[d.huong], d.nhanBuoi].filter(Boolean).join(" · ");
  return d.trung
    ? `Bạn vừa chấm cách đây chưa tới vài phút — bấm nữa sẽ là lượt TRÙNG (${dich}), không tính thêm.`
    : `Dự đoán: lần này sẽ ghi ${dich}.`;
}
