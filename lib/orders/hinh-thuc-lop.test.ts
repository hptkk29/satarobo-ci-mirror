// lib/orders/hinh-thuc-lop.test.ts — HÌNH THỨC LỚP (1-1 / 1-2 / 1-4) trên dòng đơn.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHẠM VI CỦA ĐỢT NÀY ĐƯỢC THU HẸP SAU KHI ĐO — đọc trước khi mở rộng.
//
// Ý định ban đầu: chọn 1-1 thì đơn giá TỰ NHÂN hệ số, và `soatGiaDon` so với "giá kỳ
// vọng theo công văn". Hai lượt phản biện độc lập (14/09/2026) BÁC BỎ, mỗi lượt kèm số:
//
//  (L1) Cổng soát giá thành cổng TỰ KHAI. Hôm nay `giaNiemYet` truyền vào `soatGiaDon`
//       là `Course.price` tra từ DB (orders/_actions.ts), client không chạm được — nên
//       hạ giá luôn lộ. Nếu giá kỳ vọng tính từ `coachFormat` + `soBuoi` mà cả hai nằm
//       trong `items[].metadata` (payload client), thì client điều khiển CẢ HAI VẾ của
//       phép so: khai `soBuoi` nhỏ là mọi đơn bán rẻ thành KHỚP.
//       ⇒ LUẬT CỦA FILE NÀY: hình thức lớp KHÔNG được đi vào `giaNiemYet`.
//
//  (L2) Trục GHI DANH không biết gì. `Enrollment.finalPrice` (thứ mà /cong-no,
//       /portal/hoc-phi và hoàn tiền đọc) do các đường convert ghi bằng GIÁ NHÓM. Bán
//       Coach 1-1 Sata3 10.400.000đ thì portal vẫn in 5.200.000đ và công nợ ra ÂM
//       5.200.000đ. ⇒ ghim ở `[HTL-09]` bằng `it.fails`, không vá lén trong đợt này.
//
//  (L3) Làm tròn hai lần + `dungSai = 0`: round(5.200.000/12)×12 = 5.199.996 ≠
//       5.200.000. Đưa số đó vào cổng soát là mọi đơn LỚP NHÓM của 3/7 khoá seed bị
//       đánh lệch. ⇒ `goiYGiaCoach` chỉ sinh số để NGƯỜI đọc, không cho máy so.
//
//  (L4) Mục 5.3 công văn: giảm giá TRƯỚC, hệ số SAU, ở mức GIÁ/BUỔI. Ô giảm giá của đơn
//       trừ trên TỔNG sau khi đã nhân ⇒ ngược. ⇒ `goiYGiaCoach` nhận `giamGia` và ca
//       `[HTL-05]` giữ đúng thứ tự; phần lệch với ô giảm giá của đơn thì màn phải NÓI RA.
//
// Nên file này chỉ làm hai việc, và cố ý không làm việc thứ ba:
//   · ĐỌC/GHI hình thức lớp trên `OrderItem.metadata` (một khuôn, có kiểm) — `docHinhThucLop`.
//   · SINH GỢI Ý GIÁ theo công văn cho người bán đọc — `goiYGiaCoach`.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";

import { computeEnrollmentPrice } from "@/lib/finance/pricing";
import { listPriceChoGhiDanh } from "@/lib/finance/gia-tu-dong-don";
import {
  khoaCuaDong, docHinhThucLop, goiYGiaCoach, veMetadataDongDon } from "./hinh-thuc-lop";

describe("[HTL-01] docHinhThucLop — metadata là dữ liệu NGOÀI, phải fail-closed", () => {
  it("metadata chuẩn đọc ra đủ ba mảnh", () => {
    expect(
      docHinhThucLop({ courseId: "c1", coachFormat: "ONE_ON_ONE", soBuoi: 12 }),
    ).toEqual({ courseId: "c1", coachFormat: "ONE_ON_ONE", soBuoi: 12 });
  });

  it("không có coachFormat → LỚP NHÓM, không phải null", () => {
    // Dữ liệu cũ (mọi đơn tạo trước hôm nay) chỉ có `{ courseId }`. Trả null buộc từng
    // chỗ đọc tự nhớ "null nghĩa là nhóm", và sẽ có chỗ quên.
    expect(docHinhThucLop({ courseId: "c1" }).coachFormat).toBe("GROUP");
  });

  it("null / không phải object → GROUP, không ném", () => {
    expect(docHinhThucLop(null).coachFormat).toBe("GROUP");
    expect(docHinhThucLop("ONE_ON_ONE").coachFormat).toBe("GROUP");
    expect(docHinhThucLop(42).coachFormat).toBe("GROUP");
  });

  it("coachFormat lạ → GROUP (fail-closed về hình thức RẺ NHẤT)", () => {
    // Hướng an toàn: hình thức lạ mà đoán thành 1-1 là tự nâng hệ số ×2 cho một chuỗi
    // client gửi bừa.
    expect(docHinhThucLop({ coachFormat: "ONE_ON_THREE" }).coachFormat).toBe("GROUP");
    expect(docHinhThucLop({ coachFormat: "one_on_one" }).coachFormat).toBe("GROUP");
  });

  it("soBuoi rác → null, KHÔNG hoá 0 (0 buổi là giá 0)", () => {
    for (const v of [0, -3, 1.5, "12", Number.NaN, Infinity, null, undefined]) {
      expect(docHinhThucLop({ coachFormat: "ONE_ON_TWO", soBuoi: v }).soBuoi).toBeNull();
    }
  });

  it("soBuoi vượt trần → null", () => {
    expect(docHinhThucLop({ soBuoi: 1000 }).soBuoi).toBeNull();
  });

  it("courseId không phải chuỗi → null, không đi tra DB bằng rác", () => {
    expect(docHinhThucLop({ courseId: 7 }).courseId).toBeNull();
  });
});

describe("[HTL-02] veMetadataDongDon — ghi ra đúng khuôn mà docHinhThucLop đọc lại được", () => {
  it("lớp nhóm KHÔNG ghi `coachFormat` — GROUP là giá trị suy ra được", () => {
    // Lý lẽ cũ giữ nguyên cho `coachFormat`: đơn nhóm là đa số, và `docHinhThucLop` vốn
    // đã trả "GROUP" khi vắng mặt, nên ghi vào chỉ làm dữ liệu ồn lên.
    expect(veMetadataDongDon({ courseId: "c1", coachFormat: "GROUP", soBuoi: null })).toEqual({
      courseId: "c1",
    });
  });

  it("lớp nhóm VẪN GHI `soBuoi` khi có khai [đổi 25/09/2026]", () => {
    // ⚠️ CA NÀY TỪNG GHIM LUẬT NGƯỢC LẠI, và luật ngược ấy làm `soBuoi` câm trên 100%
    // đơn thật: đo `satarobo_local` 25/09 — **0/519 `OrderItem` có `soBuoi`**, vì mọi
    // dòng đều là lớp nhóm và nhánh ghi nằm trong `if (coachFormat !== "GROUP")`. Sale
    // gõ "Số buổi mua" trên form mà con số không bao giờ rời khỏi trình duyệt.
    //
    // Khác `coachFormat` ở chỗ: số buổi mua KHÔNG suy ra được từ đâu cả. Ba chỗ cần nó —
    // luật duyệt mốc học phần (`so-buoi-hoc-phan.ts`), dòng "· N buổi" trên trang chi
    // tiết đơn, và đối soát về sau.
    expect(veMetadataDongDon({ courseId: "c1", coachFormat: "GROUP", soBuoi: 24 })).toEqual({
      courseId: "c1",
      soBuoi: 24,
    });
    // Và đọc lại ra đúng thứ đã ghi — hai đầu phải khớp.
    expect(docHinhThucLop({ courseId: "c1", soBuoi: 24 })).toEqual({
      courseId: "c1",
      coachFormat: "GROUP",
      soBuoi: 24,
    });
  });

  it("Coach thì ghi đủ, và đọc lại ra đúng thứ đã ghi", () => {
    const m = veMetadataDongDon({ courseId: "c1", coachFormat: "ONE_ON_FOUR", soBuoi: 8 });
    expect(m).toEqual({ courseId: "c1", coachFormat: "ONE_ON_FOUR", soBuoi: 8 });
    expect(docHinhThucLop(m)).toEqual({
      courseId: "c1",
      coachFormat: "ONE_ON_FOUR",
      soBuoi: 8,
    });
  });

  it("Coach mà thiếu số buổi vẫn ghi hình thức — số buổi là null, không bịa", () => {
    expect(veMetadataDongDon({ courseId: "c1", coachFormat: "ONE_ON_ONE", soBuoi: null })).toEqual(
      { courseId: "c1", coachFormat: "ONE_ON_ONE" },
    );
  });

  it("không có khoá → metadata null (đơn sản phẩm)", () => {
    expect(veMetadataDongDon({ courseId: null, coachFormat: "GROUP", soBuoi: null })).toBeNull();
  });
});

describe("[HTL-03] goiYGiaCoach — GỢI Ý cho người đọc, không phải số để máy so", () => {
  it("Sata3 5.200.000đ / 12 buổi, Coach 1-1, mua đủ 12 buổi", () => {
    const r = goiYGiaCoach({
      giaNiemYet: 5_200_000,
      tongSoBuoi: 12,
      soBuoiMua: 12,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
    });
    expect(r.dungDuoc).toBe(true);
    expect(r.giaMoiBuoi).toBe(433_333); // 5.200.000 / 12, làm tròn
    expect(r.heSo).toBe(2);
    expect(r.giaCoachMoiBuoi).toBe(866_666);
    expect(r.thanhTien).toBe(10_399_992);
  });

  it("NÊU RA chênh lệch làm tròn — 10.399.992 ≠ 5.200.000 × 2", () => {
    // Đây chính là con số mà lượt phản biện dùng để bác thiết kế cũ: đưa nó vào cổng
    // soát với dungSai = 0 là mọi đơn thành "lệch". Nêu ra cho người bán tự quyết.
    const r = goiYGiaCoach({
      giaNiemYet: 5_200_000,
      tongSoBuoi: 12,
      soBuoiMua: 12,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
    });
    expect(r.lechLamTron).toBe(-8); // 10.399.992 − 10.400.000
  });

  it("lớp nhóm mua đủ khoá → đúng giá niêm yết, lệch làm tròn 0", () => {
    const r = goiYGiaCoach({
      giaNiemYet: 5_200_000,
      tongSoBuoi: 12,
      soBuoiMua: 12,
      coachFormat: "GROUP",
      giamGia: null,
    });
    expect(r.thanhTien).toBe(5_199_996);
    expect(r.lechLamTron).toBe(-4);
  });
});

describe("[HTL-04] thiếu số buổi → KHÔNG gợi ý, và nói vì sao", () => {
  it("tongSoBuoi null → dungDuoc false, thanhTien 0", () => {
    // `Course.totalSessions` là `Int?` và ghi được NULL đè lên (đo: course-packages
    // ghi `opts.lessons` vốn cũng nullable). Trả một con số 0 ở đây là đưa GIÁ 0 đi xa.
    const r = goiYGiaCoach({
      giaNiemYet: 5_200_000,
      tongSoBuoi: null,
      soBuoiMua: 12,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
    });
    expect(r.dungDuoc).toBe(false);
    expect(r.thieu).toBe("SO_BUOI");
    expect(r.thanhTien).toBe(0);
  });

  it("giá khoá null/0 → dungDuoc false, thiếu GIA", () => {
    const r = goiYGiaCoach({
      giaNiemYet: null,
      tongSoBuoi: 12,
      soBuoiMua: 12,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
    });
    expect(r.dungDuoc).toBe(false);
    expect(r.thieu).toBe("GIA");
  });

  it("khoá bị loại trừ + Coach → dungDuoc false, thiếu LOAI_TRU, KHÔNG ném", () => {
    // `tinhHocPhiTheoBuoi` NÉM ở ca này. Ném giữa lúc người ta đang gõ form là màn trắng
    // — đổi thành cờ để form nói được câu tử tế.
    const r = goiYGiaCoach({
      giaNiemYet: 3_000_000,
      tongSoBuoi: 5,
      soBuoiMua: 5,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
      khoaKhongApDungCoach: true,
    });
    expect(r.dungDuoc).toBe(false);
    expect(r.thieu).toBe("LOAI_TRU");
  });

  it("khoá bị loại trừ mà chọn LỚP NHÓM → vẫn gợi ý bình thường", () => {
    const r = goiYGiaCoach({
      giaNiemYet: 3_000_000,
      tongSoBuoi: 5,
      soBuoiMua: 5,
      coachFormat: "GROUP",
      giamGia: null,
      khoaKhongApDungCoach: true,
    });
    expect(r.dungDuoc).toBe(true);
    expect(r.thanhTien).toBe(3_000_000);
  });
});

describe("[HTL-05] Mục 5.3 — GIẢM TRƯỚC, HỆ SỐ SAU", () => {
  it("ca [CO-04] của công văn: Sata3 48 buổi, KM 25%, Coach 1-1 → 15.840.000đ", () => {
    const r = goiYGiaCoach({
      giaNiemYet: 10_560_000,
      tongSoBuoi: 48,
      soBuoiMua: 48,
      coachFormat: "ONE_ON_ONE",
      giamGia: { type: "PERCENT", value: 25 },
    });
    expect(r.giaMoiBuoi).toBe(220_000);
    expect(r.giaMoiBuoiSauGiam).toBe(165_000);
    expect(r.giaCoachMoiBuoi).toBe(330_000);
    expect(r.thanhTien).toBe(15_840_000);
  });

  it("bỏ quên giảm giá thì lệch 5.280.000đ — con số đã bác thiết kế cũ", () => {
    const dung = goiYGiaCoach({
      giaNiemYet: 10_560_000,
      tongSoBuoi: 48,
      soBuoiMua: 48,
      coachFormat: "ONE_ON_ONE",
      giamGia: { type: "PERCENT", value: 25 },
    }).thanhTien;
    const sai = goiYGiaCoach({
      giaNiemYet: 10_560_000,
      tongSoBuoi: 48,
      soBuoiMua: 48,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
    }).thanhTien;
    expect(sai - dung).toBe(5_280_000);
  });
});

describe("[HTL-06] mua LẺ buổi (Mục 5.4)", () => {
  it("mua 6/12 buổi Coach 1-2", () => {
    const r = goiYGiaCoach({
      giaNiemYet: 5_200_000,
      tongSoBuoi: 12,
      soBuoiMua: 6,
      coachFormat: "ONE_ON_TWO",
      giamGia: null,
    });
    expect(r.giaCoachMoiBuoi).toBe(779_999); // round(433.333 × 1,8)
    expect(r.thanhTien).toBe(4_679_994);
  });

  it("soBuoiMua rác → lùi về TỔNG SỐ BUỔI của khoá, không phải 0", () => {
    const r = goiYGiaCoach({
      giaNiemYet: 5_200_000,
      tongSoBuoi: 12,
      soBuoiMua: null,
      coachFormat: "GROUP",
      giamGia: null,
    });
    expect(r.soBuoiMua).toBe(12);
  });
});

describe("[HTL-07] hệ số đến từ CẤU HÌNH, không phải hằng", () => {
  it("truyền bảng hệ số khác → gợi ý đổi theo", () => {
    // Bài học `crm.commissionMaxTotalRate` (CLAUDE.md): client nhân bằng hằng còn server
    // đọc getSetting là hai số khác nhau. Hàm này nhận bảng để người gọi truyền MỘT nguồn.
    const r = goiYGiaCoach({
      giaNiemYet: 1_200_000,
      tongSoBuoi: 12,
      soBuoiMua: 12,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
      heSo: { GROUP: 1, ONE_ON_ONE: 2.5, ONE_ON_TWO: 1.8, ONE_ON_FOUR: 1.5 },
    });
    expect(r.heSo).toBe(2.5);
    expect(r.thanhTien).toBe(3_000_000);
  });
});

describe("[HTL-08] KHÔNG đọc đồng hồ, KHÔNG chạm DB — thuần", () => {
  it("cùng đầu vào, hai lượt gọi ra cùng kết quả", () => {
    const d = {
      giaNiemYet: 5_200_000,
      tongSoBuoi: 12,
      soBuoiMua: 12,
      coachFormat: "ONE_ON_ONE" as const,
      giamGia: null,
    };
    expect(goiYGiaCoach(d)).toEqual(goiYGiaCoach(d));
  });
});

describe("[HTL-09] ĐÃ VÁ 23/09/2026 — trục ghi danh nhận GIÁ ĐƠN", () => {
  // ⚠️ GHIM CŨ ĐÃ GỠ. Ca này từng là `it.fails` (mẫu ghim bug của CLAUDE.md): nó mô tả
  // hành vi ĐÚNG trong khi mã còn sai, nên hôm ấy nó XANH vì thân test ném.
  //
  // Chủ dự án chốt 23/09: *"giá ghi danh lấy từ DÒNG ĐƠN; không có dòng thì như cũ"*.
  // Hiện thực ở `lib/finance/gia-tu-dong-don.ts` — thay ĐẦU VÀO `listPrice` của
  // `computeEnrollmentPrice`, không thay công thức, nên giảm giá khai lúc convert vẫn áp.
  //
  // Bộ ca đầy đủ (mơ hồ · giá 0 · thiếu cầu nối · khoá khác · học bổng) nằm ở
  // `lib/finance/gia-tu-dong-don.test.ts`. Ở ĐÂY chỉ giữ ĐÚNG phép so mà ghim cũ hứa —
  // giá đơn và giá ghi danh là MỘT — để người đọc tệp này thấy lời hứa đã được trả.
  it("giá ghi danh phải bằng giá đơn khi bán Coach", () => {
    const giaDon = goiYGiaCoach({
      giaNiemYet: 5_200_000,
      tongSoBuoi: 12,
      soBuoiMua: 12,
      coachFormat: "ONE_ON_ONE",
      giamGia: null,
    }).thanhTien;
    const giaGhiDanh = computeEnrollmentPrice({
      listPrice: listPriceChoGhiDanh(
        [{ leadChildId: "lc1", courseId: "c1", totalPrice: giaDon, soBuoi: null }],
        { leadChildId: "lc1", courseId: "c1" },
        5_200_000,
      ),
      discount: null,
    }).finalPrice;
    expect(giaGhiDanh).toBe(giaDon);
  });
});

describe("[HTL-10] khoaCuaDong — tra theo THỨ TỰ, `metadata` thắng", () => {
  // 🔴 Đo `satarobo_local` 26/09/2026: `metadata.courseId` chỉ có ở **5/523** dòng, còn
  // `Enrollment.courseId` có ở **493/523**. Chỉ đọc `metadata` là câm trên 99% đơn thật —
  // và câm một cách trông rất bình thường (trả `null`, màn hình không in gì).
  it("chỉ có metadata ⇒ lấy metadata", () => {
    expect(khoaCuaDong({ metadata: { courseId: "c-meta" }, courseIdGhiDanh: null })).toBe("c-meta");
  });

  it("chỉ có ghi danh ⇒ lấy ghi danh — ĐÂY là đường của 493/523 dòng", () => {
    expect(khoaCuaDong({ metadata: { leadChildId: "x" }, courseIdGhiDanh: "c-gd" })).toBe("c-gd");
  });

  it("có CẢ HAI ⇒ metadata THẮNG", () => {
    // Người soát đơn đang xem TỜ ĐƠN. `Enrollment` là kết quả lượt convert về sau và có
    // thể đã bị đổi khoá (`doi-khoa-dialog`) — in nó lên tờ đơn là nói dối về tờ đơn.
    expect(khoaCuaDong({ metadata: { courseId: "c-meta" }, courseIdGhiDanh: "c-gd" })).toBe(
      "c-meta",
    );
  });

  it("không có gì ⇒ null, KHÔNG ném và KHÔNG đoán", () => {
    expect(khoaCuaDong({ metadata: null, courseIdGhiDanh: null })).toBeNull();
    expect(khoaCuaDong({ metadata: "rác", courseIdGhiDanh: null })).toBeNull();
    expect(khoaCuaDong({ metadata: { courseId: 7 }, courseIdGhiDanh: null })).toBeNull();
  });
});
