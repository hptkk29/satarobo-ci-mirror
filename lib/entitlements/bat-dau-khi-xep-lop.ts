// lib/entitlements/bat-dau-khi-xep-lop.ts — HỌC VIÊN VÀO LỚP BÂY GIỜ THÌ BẮT ĐẦU TỪ BÀI NÀO, BỎ QUA / HỌC VƯỢT NHỮNG BÀI NÀO. THUẦN.
//
// Hàm bọc NGOÀI `tinhPhamViHoc` (không sửa nó, không nhân đôi công thức): nó vẫn là nơi kiểm đầu vào và là nơi tính nhánh
// MUA TIẾP. Phần xếp lớp LẦN ĐẦU được viết lại theo quyết định của chủ dự án 12/10/2026 — xem bảng đối chiếu ở
// `docs/thu-hoc-phi-pham-vi/XEP-LOP.md`:
//
//   GÓI TRỌN 48 (FULL), N = bài kế tiếp của lớp, đã dạy D = N − 1 bài [chủ dự án chốt 21/10/2026, thay luật 12/10]:
//     D = 0          ⇒ NONE             — vào từ đầu, start = 1, không bù gì.
//     0 < D ≤ n      ⇒ CATCH_UP         — n = `enrollment.catchUpMaxSessions` (mặc định 6, QLCS đặt theo cơ sở, tối đa 12). MỌI bài đã qua đều
//                                         thành nhu cầu bù (case bù) và MIỄN PHÍ: không trừ lượt bù, không đòi phí (đã đóng tiền cho các buổi này).
//                                         Không còn vùng «bù miễn phí, không tạo case» (`lateEntryMaxLessons`) — gộp vào n.
//     D > n          ⇒ OVER_CAP_SKIPPED — vào từ buổi kế tiếp, KHÔNG bù, KHÔNG xin duyệt: mọi bài đã qua bỏ qua. `catchUpOverCapPolicy`
//                                         KHÔNG còn áp cho gói trọn. Phụ huynh yêu cầu bù thì QLCS tạo case. Bài bỏ qua nằm TRONG [start,end].
//     start luôn = 1, end = tongBai (INV-01/02: end − start + 1 = purchaseSessions).
//
//   GÓI KHÔNG TRỌN CÓ `batDauChon` [chủ dự án chốt 28/10/2026: "nếu không phải mua trọn khoá thì hiển thị ô buổi bắt đầu, bỏ rule vào đúng bài kế tiếp của lớp"]:
//     SALE chọn buổi bắt đầu S ở màn Chuyển đổi (lưu ở `Enrollment.buoiBatDau`), start = S, end = S + soBuoi − 1, KHÔNG phụ thuộc lớp đã dạy tới đâu.
//     Bài lớp đã dạy từ S tới N−1 KHÔNG được đánh dấu bỏ qua / bù miễn phí ở đây: chúng đi theo yêu cầu học vượt bù (`EnrollmentCatchUpRequest`, QLCS duyệt) mà
//     màn Chuyển đổi tạo — MỘT đường duy nhất, tránh vừa tự sinh nhu cầu bù vừa chờ duyệt. Bài trước S nằm NGOÀI phạm vi (`lessonsBeforeStart`).
//   GÓI KHÔNG TRỌN, KHÔNG có `batDauChon` (đường không đi qua màn Chuyển đổi: bulk-convert, convertLeadV2…): bài kế tiếp của lớp LÀ bài đầu của học viên
//     (start = N, end = N + soBuoi − 1). BỎ QUA TOÀN BỘ
//     bài trước N, KHÔNG học vượt, KHÔNG bù. Những bài đó nằm NGOÀI [start,end] nên không phải `skippedSessions` (cột đó chỉ đếm bài
//     bỏ qua TRONG phạm vi, đọc lại bằng `baiBoQuaTuSo(start, n)` = start..start+n−1) — chúng chỉ được ghi ở `lessonsBeforeStart`.
//     Phạm vi vượt giáo trình (end > tongBai) ⇒ ném `LoiPhamVi` (người gọi chuyển thành "treo review", KHÔNG đoán).
//
//   MUA TIẾP (`truoc` có mặt): giữ nguyên `tinhPhamViHoc` (QĐ-21 nối vào bài cuối lần trước; các bài lỡ học bù miễn phí).
//
// ── ĐỔI SO VỚI `tinhPhamViHoc` (lần đầu) — và vì sao không sửa chính nó ──────────────────────────────────────────────
//   1. Gói không trọn: `tinhPhamViHoc` neo ở ĐẦU HỌC PHẦN chứa bài kế tiếp rồi học vượt tới `cap` bài (MT-03a nghĩa I, QĐ-05/06);
//      quyết định mới: neo ở chính bài kế tiếp, bỏ qua hết bài trước, không học vượt.
//   2. Gói trọn: `tinhPhamViHoc` bắt MỌI bài đã qua đều dạy, KHÔNG áp trần, và quá ngưỡng thì chờ QLCS chọn (QĐ-09/10);
//      quyết định mới: quá ngưỡng áp học vượt TỰ ĐỘNG có trần, không chờ ai.
//   `pham-vi-hoc.test.ts` vẫn ghim hành vi cũ của `tinhPhamViHoc` và còn xanh vì hàm đó không đổi; nhánh lần đầu của nó KHÔNG CÒN
//   được `xepLopTrongTx` gọi để quyết phạm vi (chỉ gọi để kiểm đầu vào và cho nhánh mua tiếp).
import { chiaBaiThanhBuoi } from "./hoc-vuot";
import {
  LoiPhamVi,
  tinhPhamViHoc,
  type CauHinhPhamVi,
  type LanMuaTruoc,
  type LoaiMuaPhamVi,
} from "./pham-vi-hoc";

export type CheDoBuXepLop = "NONE" | "FREE_MAKEUP" | "CATCH_UP" | "OVER_CAP_SKIPPED";

export interface DauVaoXepLop {
  readonly loai: LoaiMuaPhamVi;
  readonly soBuoi: number;
  /** Bài KẾ TIẾP lớp sẽ dạy (1 = lớp chưa dạy bài nào). Nguồn: `baiKeTiepCuaLop` / `docBaiKeTiepCuaLop`. */
  readonly baiKeTiepCuaLop: number;
  readonly truoc?: LanMuaTruoc | null;
  /** BẮT BUỘC (luật 7): ngưỡng / trần / chính sách vượt trần là CẤU HÌNH theo cơ sở — mặc định ngầm là chỗ cấu hình bị bỏ qua mà không lỗi nào báo. */
  readonly cauHinh: CauHinhPhamVi;
  /** Số bài tối đa một buổi học vượt (`enrollment.catchUpMaxLessonsPerSession`). BẮT BUỘC. */
  readonly baiMoiBuoiHocVuot: number;
  /**
   * Buổi bắt đầu do SALE chọn ở màn Chuyển đổi (`Enrollment.buoiBatDau`). Chỉ có nghĩa với gói KHÔNG trọn, lần mua đầu; gói trọn / mua tiếp bỏ qua.
   * `null`/thiếu ⇒ đường cũ (bài kế tiếp của lớp). Cố ý TUỲ CHỌN: đường không có người chọn không có gì để truyền, và rơi về luật cũ là hành vi đã chốt.
   */
  readonly batDauChon?: number | null;
}

export interface KetQuaXepLop {
  readonly startLesson: number;
  readonly endLesson: number;
  /** Bài TRONG [start,end] không dạy, không hoàn. LIỀN từ `startLesson` (khớp `skippedSessions` + `baiBoQuaTuSo`). */
  readonly skippedLessons: readonly number[];
  /** Bài lớp đã dạy TRƯỚC `startLesson`, bỏ qua toàn bộ (gói không trọn). Ngoài phạm vi ⇒ KHÔNG tính vào `skippedSessions`. */
  readonly lessonsBeforeStart: readonly number[];
  /** Gói trọn vào trễ trong ngưỡng: bài đã qua, VẪN trong phạm vi, học bù miễn phí — CHƯA sinh nhu cầu học vượt. Mua tiếp: các bài lỡ. */
  readonly freeMakeupLessons: readonly number[];
  /** Bài PHẢI học vượt (sinh nhu cầu). Rỗng ở mọi chế độ trừ CATCH_UP và OVER_CAP_SKIPPED/KEEP_LATEST. */
  readonly requiredCatchupLessons: readonly number[];
  /** `requiredCatchupLessons` chia theo `baiMoiBuoiHocVuot` bài/buổi, giữ thứ tự bài. */
  readonly catchupSessions: readonly (readonly number[])[];
  readonly catchupMode: CheDoBuXepLop;
  /** `true` ⇔ có bài bị bỏ qua vì vượt trần: chính sách đã tự áp, KHÔNG chờ ai — cờ chỉ để người vận hành BIẾT. */
  readonly canXemTay: boolean;
}

const khoang = (tu: number, den: number): number[] => {
  const ra: number[] = [];
  for (let i = tu; i <= den; i++) ra.push(i);
  return ra;
};

/** Ném `LoiPhamVi` khi đầu vào sai hoặc phạm vi vượt giáo trình — người gọi KHÔNG được đoán thay. */
export function tinhBatDauKhiXepLop(vao: DauVaoXepLop): KetQuaXepLop {
  const ch = vao.cauHinh;
  if (!Number.isInteger(vao.baiMoiBuoiHocVuot) || vao.baiMoiBuoiHocVuot < 1) {
    throw new LoiPhamVi("DAU_VAO_KHONG_HOP_LE", "Số bài tối đa mỗi buổi học vượt phải là số nguyên từ 1.");
  }
  // Kiểm đầu vào + nhánh mua tiếp + nhánh gói trọn đều do `tinhPhamViHoc` quyết; không viết lại các phép kiểm.
  const goc = tinhPhamViHoc({ loai: vao.loai, soBuoi: vao.soBuoi, baiKeTiepCuaLop: vao.baiKeTiepCuaLop, truoc: vao.truoc ?? null, cauHinh: ch });
  const N = vao.baiKeTiepCuaLop;

  const ghep = (p: Partial<KetQuaXepLop> & { startLesson: number; endLesson: number; catchupMode: CheDoBuXepLop }): KetQuaXepLop => {
    const requiredCatchupLessons = p.requiredCatchupLessons ?? [];
    return {
      skippedLessons: [],
      lessonsBeforeStart: [],
      freeMakeupLessons: [],
      ...p,
      requiredCatchupLessons,
      catchupSessions: chiaBaiThanhBuoi(requiredCatchupLessons, vao.baiMoiBuoiHocVuot),
      canXemTay: p.catchupMode === "OVER_CAP_SKIPPED",
    };
  };

  // ── MUA TIẾP: giữ nguyên `tinhPhamViHoc` ───────────────────────────────────────────────
  if (vao.truoc) {
    return ghep({
      startLesson: goc.start,
      endLesson: goc.end,
      freeMakeupLessons: goc.baiCanBu,
      catchupMode: goc.baiCanBu.length > 0 ? "FREE_MAKEUP" : "NONE",
    });
  }

  // ── GÓI TRỌN ────────────────────────────────────────────────────────────────────────────
  if (vao.loai === "FULL") {
    const daQua = goc.baiCanBu; // FULL lần đầu: `tinhPhamViHoc` trả MỌI bài đã qua (1..N−1, chặn ở tongBai)
    const base = { startLesson: goc.start, endLesson: goc.end };
    if (daQua.length === 0) return ghep({ ...base, catchupMode: "NONE" });
    if (daQua.length <= ch.catchUpMaxSessions) return ghep({ ...base, requiredCatchupLessons: daQua, catchupMode: "CATCH_UP" });
    return ghep({ ...base, skippedLessons: daQua, catchupMode: "OVER_CAP_SKIPPED" });
  }

  // ── GÓI KHÔNG TRỌN, SALE ĐÃ CHỌN BUỔI BẮT ĐẦU ───────────────────────────────────────────
  if (vao.batDauChon !== null && vao.batDauChon !== undefined) {
    const s = vao.batDauChon;
    if (!Number.isInteger(s) || s < 1) {
      throw new LoiPhamVi("DAU_VAO_KHONG_HOP_LE", "Buổi bắt đầu phải là số nguyên từ 1.");
    }
    const cuoi = s + vao.soBuoi - 1;
    if (cuoi > ch.tongBai) {
      throw new LoiPhamVi("PHAM_VI_VUOT_GIAO_TRINH", `Phạm vi ${s}–${cuoi} vượt giáo trình ${ch.tongBai} bài.`);
    }
    return ghep({ startLesson: s, endLesson: cuoi, lessonsBeforeStart: khoang(1, s - 1), catchupMode: "NONE" });
  }

  // ── GÓI KHÔNG TRỌN, không ai chọn: bài kế tiếp của lớp LÀ bài đầu ────────────────────────
  const start = N;
  const end = start + vao.soBuoi - 1;
  if (end > ch.tongBai) {
    throw new LoiPhamVi("PHAM_VI_VUOT_GIAO_TRINH", `Phạm vi ${start}–${end} vượt giáo trình ${ch.tongBai} bài.`);
  }
  return ghep({ startLesson: start, endLesson: end, lessonsBeforeStart: khoang(1, N - 1), catchupMode: "NONE" });
}
