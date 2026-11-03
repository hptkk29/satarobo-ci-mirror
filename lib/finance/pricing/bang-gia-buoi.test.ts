// Ca [BG-*] — bảng giá theo buổi. Phủ TS-02 (US-02/AC3) và luật làm tròn BA 4.4.
//
// Pre-mortem T12 nói chính xác vì sao bộ này tồn tại: *"làm tròn đơn giá làm Σ lệch vài trăm
// đồng, kiểm cân đêm báo đỏ liên tục, mọi người quen bỏ qua cảnh báo"*. 9.600.000 ÷ 48 tròn;
// 10.000.000 ÷ 48 thì không — và khoá thật của trung tâm có cả hai loại.
import { describe, it, expect } from "vitest";
import {
  bangGiaBuoi,
  BUOC_LAM_TRON,
  giaTriDaDung,
  tachBangGiaTaiBuoi,
  tongBangGia,
} from "./bang-gia-buoi";
import {
  BANG_GIA_AN,
  BANG_GIA_AN_SAU_MAT_UU_DAI,
  BANG_GIA_BINH,
  KY_VONG_A,
  KY_VONG_C,
  SO_CHOT_DON,
} from "@/tests/fixtures/gia-dinh-mau";

describe("[BG-01] số của gia đình mẫu — hằng gõ tay gặp hàm sản xuất", () => {
  it("An 8.640.000 / 48 buổi ⇒ MỘT đoạn 180.000", () => {
    // Hằng `donGia` lấy từ bảng trong BA (tay người); `BANG_GIA_AN` do hàm sinh. Ca này là chỗ
    // hai nguồn gặp nhau — fixture dùng hàm nên nếu không có ca này, hàm sai thì fixture sai
    // theo và mọi ca khác vẫn xanh.
    expect(BANG_GIA_AN).toEqual([{ tuBuoi: 1, denBuoi: 48, donGia: SO_CHOT_DON.an.donGia }]);
    expect(tongBangGia(BANG_GIA_AN)).toBe(SO_CHOT_DON.an.hocPhiThuc);
  });

  it("Bình 12.000.000 / 48 buổi ⇒ MỘT đoạn 250.000", () => {
    expect(BANG_GIA_BINH).toEqual([{ tuBuoi: 1, denBuoi: 48, donGia: SO_CHOT_DON.binh.donGia }]);
    expect(tongBangGia(BANG_GIA_BINH)).toBe(SO_CHOT_DON.binh.hocPhiThuc);
  });
});

describe("[BG-02] TS-02 — luật làm tròn, phần lẻ dồn vào buổi CUỐI", () => {
  it("10.000.000 / 48 ⇒ buổi 1–47 × 208.000, buổi 48 = 224.000", () => {
    // Con số này chép nguyên từ TS-02. 10.000.000 ÷ 48 = 208.333,33 → làm tròn XUỐNG tới nghìn
    // = 208.000; 208.000 × 47 = 9.776.000; phần lẻ 224.000 vào buổi cuối.
    expect(bangGiaBuoi(10_000_000, 48)).toEqual([
      { tuBuoi: 1, denBuoi: 47, donGia: 208_000 },
      { tuBuoi: 48, denBuoi: 48, donGia: 224_000 },
    ]);
    expect(tongBangGia(bangGiaBuoi(10_000_000, 48))).toBe(10_000_000);
  });

  it("chia HẾT ⇒ một đoạn, KHÔNG đẻ đoạn 1 buổi thừa", () => {
    // Tách thành hai đoạn giá bằng nhau là đẻ một dòng vô nghĩa trong mọi bảng hiển thị, và làm
    // mọi phép tách đoạn sau này phải xử lý thêm một ca.
    expect(bangGiaBuoi(9_600_000, 48)).toHaveLength(1);
  });

  it("một buổi ⇒ đúng một đoạn mang trọn học phí", () => {
    expect(bangGiaBuoi(1_234_567, 1)).toEqual([{ tuBuoi: 1, denBuoi: 1, donGia: 1_234_567 }]);
  });

  it("đầu vào RÁC ⇒ mảng rỗng, KHÔNG ném", () => {
    // Hàm chạy trong đường tạo đơn; một ngoại lệ ở đây làm hỏng cả transaction vì một ô người
    // dùng gõ sai. Rỗng thì `tongBangGia` ra 0 và cổng kiểm kế hoạch từ chối có câu nói được.
    for (const [hp, sb] of [
      [1_000_000, 0],
      [1_000_000, -5],
      [-1, 48],
      [Number.NaN, 48],
      [1_000_000, Number.NaN],
    ] as const) {
      expect(bangGiaBuoi(hp, sb), `${hp}/${sb}`).toEqual([]);
    }
  });
});

describe("[BG-03] TS-02 thuộc tính — 1.000 bộ ngẫu nhiên không bao giờ lệch", () => {
  it("Σ bảng giá === học phí thực, và không đơn giá nào ÂM", () => {
    // Bộ sinh TẤT ĐỊNH (LCG có hạt cố định), KHÔNG dùng `Math.random`: một ca thuộc tính đỏ
    // ngẫu nhiên một lần rồi xanh lại là ca không ai chẩn đoán được — và luật 19 của repo cấm
    // test đọc đồng hồ, cùng một lý do.
    let hat = 1_234_567;
    const rand = () => {
      hat = (hat * 1_103_515_245 + 12_345) % 2_147_483_648;
      return hat / 2_147_483_648;
    };

    const loi: string[] = [];
    for (let i = 0; i < 1_000; i++) {
      const hocPhi = Math.round(1_000_000 + rand() * 49_000_000);
      const soBuoi = 1 + Math.floor(rand() * 96);
      const doan = bangGiaBuoi(hocPhi, soBuoi);
      const tong = tongBangGia(doan);
      if (tong !== hocPhi) loi.push(`Σ ${tong} ≠ ${hocPhi} (${soBuoi} buổi)`);
      if (doan.some((d) => d.donGia < 0)) loi.push(`đơn giá âm: ${hocPhi}/${soBuoi}`);
      // Phủ kín: các đoạn phải liền mạch từ buổi 1 tới buổi n, không hở, không chồng.
      const buoi = doan.reduce((s, d) => s + (d.denBuoi - d.tuBuoi + 1), 0);
      if (buoi !== soBuoi) loi.push(`phủ ${buoi} buổi ≠ ${soBuoi}`);
      // Mọi đơn giá TRỪ BUỔI CUỐI phải TRÒN NGHÌN — đó là thứ sale đọc qua điện thoại.
      //
      // ⚠️ Khoá MỘT buổi không có "buổi trừ buổi cuối": buổi duy nhất CHÍNH LÀ buổi cuối, nên
      // nó mang trọn phần lẻ. Bản đầu của ca này quên điều đó và đỏ với 5 bộ số — làm tròn buổi
      // duy nhất xuống nghìn sẽ nuốt tới 999đ học phí, tức phá bất biến Σ vốn mạnh hơn.
      if (soBuoi >= 2 && doan[0] && doan[0].donGia % BUOC_LAM_TRON !== 0) {
        loi.push(`đơn giá không tròn nghìn: ${doan[0].donGia} (${hocPhi}/${soBuoi})`);
      }
    }
    expect(loi.slice(0, 5)).toEqual([]);
  });
});

describe("[BG-04] giá trị đã dùng — nền của mọi phép quyết toán", () => {
  it("Bình học 20/48 buổi ⇒ 5.000.000 (tình huống A)", () => {
    expect(giaTriDaDung(BANG_GIA_BINH, 20)).toBe(KY_VONG_A.binhGiaTriDaDung);
  });

  it("học LỐ bị kẹp ở tổng số buổi, không tính thêm", () => {
    // Học lố là chuyện của quyết toán (phí, dòng dương), không phải của bảng giá.
    expect(giaTriDaDung(BANG_GIA_BINH, 999)).toBe(SO_CHOT_DON.binh.hocPhiThuc);
  });

  it("0 buổi ⇒ 0đ (tình huống C — Bình không học buổi nào)", () => {
    expect(giaTriDaDung(BANG_GIA_BINH, 0)).toBe(KY_VONG_C.binhGiaTriDaDung);
  });

  it("cộng ĐÚNG qua ranh giới hai đoạn", () => {
    // Đây là chỗ một vòng lặp viết sai lệch đúng một buổi mà tổng vẫn "trông đúng".
    const doan = bangGiaBuoi(10_000_000, 48); // 1–47 × 208.000, 48 × 224.000
    expect(giaTriDaDung(doan, 47)).toBe(47 * 208_000);
    expect(giaTriDaDung(doan, 48)).toBe(10_000_000);
  });
});

describe("[BG-05] tách bảng giá — biểu diễn 'mất ưu đãi từ buổi k'", () => {
  it("tình huống A: An mất ưu đãi từ buổi 25 ⇒ 1–24 × 180.000, 25–48 × 200.000", () => {
    expect(BANG_GIA_AN_SAU_MAT_UU_DAI).toEqual([
      { tuBuoi: 1, denBuoi: 24, donGia: SO_CHOT_DON.an.donGia },
      { tuBuoi: 25, denBuoi: 48, donGia: KY_VONG_A.anDonGiaSauMatUuDai },
    ]);
  });

  it("và học phí MỚI của An đúng 9.120.000 — con số trong BA", () => {
    // 24 × 180.000 + 24 × 200.000 = 4.320.000 + 4.800.000. Đây là vế bên kia của bất biến B6
    // trong ảnh chụp sau tình huống A.
    expect(tongBangGia(BANG_GIA_AN_SAU_MAT_UU_DAI)).toBe(KY_VONG_A.anPhaiThu);
  });

  it("KHÔNG truy thu đoạn đã học — buổi 1–24 giữ giá cũ", () => {
    expect(giaTriDaDung(BANG_GIA_AN_SAU_MAT_UU_DAI, 24)).toBe(24 * SO_CHOT_DON.an.donGia);
  });

  it("tình huống C: mất ưu đãi từ buổi 1 ⇒ CẢ bảng về giá mới, học phí 9.600.000", () => {
    const sau = tachBangGiaTaiBuoi(BANG_GIA_AN, KY_VONG_C.anMatUuDaiTuBuoi, KY_VONG_C.anDonGiaSauMatUuDai);
    expect(sau).toEqual([{ tuBuoi: 1, denBuoi: 48, donGia: KY_VONG_C.anDonGiaSauMatUuDai }]);
    expect(tongBangGia(sau)).toBe(KY_VONG_C.anHocPhiThuc);
  });

  it("tách tại buổi VƯỢT tổng số buổi ⇒ không đổi gì", () => {
    // Ca thật: con dừng học SAU khi anh/chị đã học xong khoá. Không còn buổi nào để áp giá mới.
    expect(tachBangGiaTaiBuoi(BANG_GIA_AN, 999, 999_000)).toEqual(BANG_GIA_AN);
  });

  it("tách LẦN HAI vẫn phủ kín và không mất buổi nào", () => {
    // Ba con, hai lần mất ưu đãi (TS-37). Đây là chỗ phép tách dễ để hở một khoảng buổi.
    const lan2 = tachBangGiaTaiBuoi(BANG_GIA_AN_SAU_MAT_UU_DAI, 37, 220_000);
    expect(lan2.reduce((s, d) => s + (d.denBuoi - d.tuBuoi + 1), 0)).toBe(48);
    expect(lan2.map((d) => d.tuBuoi)).toEqual([1, 25, 37]);
    expect(tongBangGia(lan2)).toBe(24 * 180_000 + 12 * 200_000 + 12 * 220_000);
  });
});
