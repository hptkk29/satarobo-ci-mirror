// lib/cham-cong/cap-quet-ky-vong.ts — CẶP QUÉT KỲ VỌNG của một người trong một NGÀY PARTTIME (GĐ1, docs/phan-cong-gop/KHAO-SAT.md "CHỐT GĐ0").
// THUẦN — không DB, không đồng hồ.
//
// MỘT hàm cho câu hỏi "ngày này người này phải quét mấy cặp, mỗi cặp phủ ô nào" — màn Phân công (hiển thị "phải quét trong ngày"), engine công
// và màn Công parttime cùng gọi. Luật 1.5 + chốt GĐ0:
//   · trực một buổi ⇒ 1 cặp theo giờ ca;
//   · các buổi trực CHẠM/CHỒNG nhau gộp thành MỘT cặp (C 13:45–17:30 + T 17:15–21:00 ⇒ TRUC_CT 13:45–21:00); có khoảng hở thì tách
//     (S + C ⇒ 2 cặp, S + T ⇒ 2 cặp);
//   · dạy không trực ⇒ cặp quanh các đoạn dạy (vào trước giờ đầu, ra sau giờ cuối); hai đoạn dạy cách nhau ≤ `gopDayHoToiDaPhut`
//     (chính sách, mặc định 30') ⇒ cùng MỘT cặp, hở hơn thì tách — trong một buổi hay vắt hai buổi (chốt GĐ1 số 4);
//   · dạy trong buổi đang trực ⇒ dùng cặp của phiên trực (không thêm cặp); việc dạy vượt khung trực — ở CẢ HAI đầu — thì cặp trực DÃN
//     ra phủ hết (chốt GĐ1 số 3);
//   · trần số mốc = số cặp × 2 (chốt 9, `soMocToiDa`).
//
// ⚠️ Chỉ áp cho ngày Parttime (chốt 7) và chỉ từ kỳ 11/2026 (chốt 8) — CHỖ GỌI quyết, hàm này không đọc ngày.
// ⚠️ Tên cặp mang tiền tố `TRUC_` / `DAY_` — KHÔNG trùng mã ca `ShiftTemplate` (`SC`, `CT`… ở lib/cham-cong/catalog.ts, 1 cặp, chốt 09/09).
//    Hai thứ cùng chữ, khác nghĩa; đừng nối chúng với nhau.
import { phutTrongNgay } from "@/lib/parttime/chinh-sach";
import type { KhungCa } from "@/lib/phan-cong/ma-o";

export type CapQuet = {
  /** `TRUC_<các buổi>` (vd `TRUC_C`, `TRUC_CT`) hoặc `DAY_<buổi>` (vd `DAY_S`). */
  ma: string;
  loai: "TRUC" | "DAY";
  /** Phải VÀO trước `tu` và RA sau `den` ("HH:mm"). */
  tu: string;
  den: string;
  /** Các buổi (ô) mà cặp này phủ — thiếu một lượt của cặp ⇒ mọi phần công trong các ô này "chưa tính". */
  phuCa: string[];
};

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function capQuetKyVong(p: {
  /** Khung ca của chính sách tại ngày (`paramsJson.ca`). */
  ca: readonly KhungCa[];
  /** Buổi người này có dòng trực còn sống. */
  caTruc: readonly string[];
  /** Việc dạy còn sống trong ngày, đã xếp buổi bằng `xepBuoiVaoCa` (null = ngoài khung, không sinh cặp — màn báo riêng). */
  viecDay: readonly { ca: string | null; gioBatDau: string; gioKetThuc: string }[];
  /** `gopDayHoToiDaPhut(thamSo)` (lib/parttime/chinh-sach.ts). BẮT BUỘC (luật 7) — không hằng trong mã. */
  gopDayHoToiDaPhut: number;
}): CapQuet[] {
  const khung = new Map(p.ca.map((c) => [c.ma, { tu: phutTrongNgay(c.tu), den: phutTrongNgay(c.den) }]));
  const day = (ma: string) => p.viecDay.filter((v) => v.ca === ma).map((v) => ({ tu: phutTrongNgay(v.gioBatDau), den: phutTrongNgay(v.gioKetThuc) }));
  const cap: { ma: string; loai: CapQuet["loai"]; tu: number; den: number; phuCa: string[] }[] = [];

  // Trực: xếp theo giờ bắt đầu, gộp ca chạm/chồng ca trước.
  const truc = p.ca.filter((c) => p.caTruc.includes(c.ma)).map((c) => ({ ma: c.ma, ...khung.get(c.ma)! })).sort((a, b) => a.tu - b.tu);
  for (const t of truc) {
    const cuoi = cap.at(-1);
    if (cuoi && t.tu <= cuoi.den) {
      cuoi.den = Math.max(cuoi.den, t.den);
      cuoi.phuCa.push(t.ma);
    } else cap.push({ ma: "", loai: "TRUC", tu: t.tu, den: t.den, phuCa: [t.ma] });
  }
  // Dạy trong buổi đang trực: dãn cặp trực nếu việc vượt khung.
  for (const c of cap)
    for (const v of c.phuCa.flatMap(day)) {
      c.tu = Math.min(c.tu, v.tu);
      c.den = Math.max(c.den, v.den);
    }
  // Dạy không trực: mọi đoạn dạy ở ô KHÔNG trực, xếp theo giờ; đoạn sau cách đoạn trước ≤ ngưỡng ⇒ cùng cặp, hở hơn ⇒ cặp mới — trong
  // một buổi hay vắt hai buổi đều vậy (chốt GĐ1 số 4). Một ô có thể nằm trong hai cặp (`phuCa` của cả hai) — engine coi ô đủ khi MỌI
  // cặp phủ nó đủ. Cặp DẠY không bao giờ gộp vào cặp TRỰC.
  const dayKhongTruc = p.viecDay
    .filter((v): v is typeof v & { ca: string } => v.ca != null && khung.has(v.ca) && !p.caTruc.includes(v.ca))
    .map((v) => ({ ca: v.ca, tu: phutTrongNgay(v.gioBatDau), den: phutTrongNgay(v.gioKetThuc) }))
    .sort((a, b) => a.tu - b.tu || a.den - b.den);
  let doan: (typeof cap)[number] | null = null;
  for (const v of dayKhongTruc) {
    if (doan && v.tu - doan.den <= p.gopDayHoToiDaPhut) {
      doan.den = Math.max(doan.den, v.den);
      if (!doan.phuCa.includes(v.ca)) doan.phuCa.push(v.ca);
    } else {
      doan = { ma: "", loai: "DAY", tu: v.tu, den: v.den, phuCa: [v.ca] };
      cap.push(doan);
    }
  }
  const gop = cap.sort((a, b) => a.tu - b.tu);

  // Mã cặp duy nhất trong ngày: hai cặp dạy cùng phủ một buổi ⇒ `DAY_C`, `DAY_C_2`.
  const daCo = new Map<string, number>();
  return gop.map((c) => {
    const goc = `${c.loai}_${c.phuCa.join("")}`;
    const n = (daCo.get(goc) ?? 0) + 1;
    daCo.set(goc, n);
    return { ma: n === 1 ? goc : `${goc}_${n}`, loai: c.loai, tu: hhmm(c.tu), den: hhmm(c.den), phuCa: c.phuCa };
  });
}

/** Trần số mốc VÀO/RA của ngày (chốt 9) — thay hằng `SO_MOC_TOI_DA = 4` cho ngày Parttime. */
export function soMocToiDa(cap: readonly CapQuet[]): number {
  return cap.length * 2;
}
