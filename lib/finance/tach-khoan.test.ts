// Ca [TKP-*] — phép chia của TÁCH KHOẢN. Thuần, không chạm DB.
//
// Phần HÀNH VI (ghi được đúng mấy dòng, tiền có đổi không, kế toán xử lý từng phần được
// không) nằm ở `tests/finance/tach-khoan-cho-con.test.ts` — bộ `test:finance-db`. Ở đây chỉ
// có phép chia, và nó phải đúng trước khi bàn tới chuyện ghi.
//
// SỐ NỀN của cả tệp là số THẬT của `ORD-260918-000001` (chủ dự án cấp 20/09/2026), không
// phải số tròn tự nghĩ: học phí 8.976.000 + 10.032.000, khoản 9.530.000. Fixture tròn trịa là
// fixture không kiểm được gì.
//
// ⚠️ NHƯNG CẶP SỐ CHIA thì TRUNG TÍNH, cố ý — xem `PHAN_A`/`PHAN_B`. Khoản 9.530.000đ trừ đi
// hai nửa học phí còn dư 26.000đ mà **chưa ai giải thích được**, nên tệp này KHÔNG in ra một
// cặp "chữa cháy" cho đơn ấy. Cặp số thật sẽ do chủ dự án chốt sau khi hỏi phụ huynh/kế toán.
import { describe, it, expect } from "vitest";
import { kiemTachKhoan, type TranNhanCuaCon } from "./tach-khoan";

const A = "item-a";
const B = "item-b";

const HOC_PHI_A = 8_976_000;
const HOC_PHI_B = 10_032_000;
const KHOAN = 9_530_000;
/**
 * Nửa học phí từng bé. Σ = 9.504.000 — **THIẾU 26.000đ** so với khoản thật.
 * ⚠️ CHỈ dùng ở `[TKP-07]`, tức ca CHẶN.
 */
const NUA_A = 4_488_000;
const NUA_B = 5_016_000;

/**
 * Cặp số TRUNG TÍNH cho các ca "chia hợp lệ".
 *
 * ⚠️ **CỐ Ý KHÔNG PHẢI cặp số đề xuất cho `ORD-260918-000001`.** Chủ dự án chốt 20/09/2026:
 * 26.000đ chênh là tiền thật CHƯA AI GIẢI THÍCH ĐƯỢC, và *"hệ thống KHÔNG được tự dồn nó
 * vào một bé"*. Bản đầu của tệp này dùng `4.488.000 + 5.042.000` — dồn trọn phần dư sang bé
 * B — và cặp ấy đã bị gỡ: một con số nằm trong test là một con số người ta sẽ chép.
 *
 * Hai số dưới cộng đúng 9.530.000đ và nằm dưới trần của cả hai bé. Chỉ có thế.
 */
const PHAN_A = 3_777_000;
const PHAN_B = 5_753_000;

/** Hai bé chưa nhận đồng nào ⇒ `conCoTheNhan` = trọn học phí. */
const traiTim: TranNhanCuaCon[] = [
  { orderItemId: A, ten: "Bé A", conCoTheNhan: HOC_PHI_A, daVe: 0 },
  { orderItemId: B, ten: "Bé B", conCoTheNhan: HOC_PHI_B, daVe: 0 },
];

describe("[TKP] phép chia của tách khoản", () => {
  it("[TKP-01] chia đúng tổng cho hai bé ⇒ ĐẠT", () => {
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: A, soTien: PHAN_A },
        { orderItemId: B, soTien: PHAN_B },
      ],
      tranCon: traiTim,
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.tong).toBe(KHOAN);
    expect(r.ok && r.phan.map((p) => p.soTien)).toEqual([PHAN_A, PHAN_B]);
  });

  it("[TKP-02] Σ THIẾU 1đ ⇒ CHẶN, và câu lỗi nói ĐÚNG phần thiếu", () => {
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: A, soTien: PHAN_A },
        { orderItemId: B, soTien: PHAN_B - 1 },
      ],
      tranCon: traiTim,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("Còn THIẾU 1đ");
    expect(!r.ok && r.loi).toContain("9.530.000");
  });

  it("[TKP-03] Σ THỪA 1đ ⇒ CHẶN", () => {
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: A, soTien: PHAN_A },
        { orderItemId: B, soTien: PHAN_B + 1 },
      ],
      tranCon: traiTim,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("Chia THỪA 1đ");
  });

  it("[TKP-04] một phần VƯỢT trần của bé ⇒ CHẶN, nêu tên bé và con số", () => {
    // Bé A học phí 8.976.000. Xin 9.000.000 cho A là vượt, dù Σ vẫn khớp.
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: A, soTien: 9_000_000 },
        { orderItemId: B, soTien: KHOAN - 9_000_000 },
      ],
      tranCon: traiTim,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("Bé A");
    expect(!r.ok && r.loi).toContain("8.976.000");
  });

  it("[TKP-05] trần đã bị tiền CŨ ăn mất ⇒ câu lỗi nói VÌ SAO, không chỉ 'tối đa X'", () => {
    // ⚠️ Đây là chỗ `conCoTheNhan` tách khỏi `conNo`. Bé A đã có 3.777.000đ vào đơn (PENDING,
    // trục A chưa thấy) nên màn hình vẫn in "Còn nợ 8.976.000". Một câu "tối đa 5.199.000đ"
    // trần trụi đọc như hệ thống lỗi — rồi người ta học cách bỏ qua cổng. Bài học của cổng
    // tạo đợt, CLAUDE.md.
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        // 6.000.000 < conNo của A (8.976.000) nhưng > conCoTheNhan (5.199.000).
        { orderItemId: A, soTien: 6_000_000 },
        { orderItemId: B, soTien: KHOAN - 6_000_000 },
      ],
      tranCon: [
        { orderItemId: A, ten: "Bé A", conCoTheNhan: HOC_PHI_A - PHAN_A, daVe: PHAN_A },
        { orderItemId: B, ten: "Bé B", conCoTheNhan: HOC_PHI_B, daVe: 0 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("tối đa 5.199.000đ");
    expect(!r.ok && r.loi, "phải nói tiền cũ, không chỉ nói trần").toContain(
      "đã có 3.777.000đ vào đơn rồi",
    );
  });

  it("[TKP-06] MỘT bé duy nhất ⇒ CHẶN và chỉ sang nút Gắn", () => {
    // Một phần bằng trọn số tiền chính là phép GẮN. Làm nó qua đường tách là đẻ ra một bút
    // toán đảo + một dòng mới cho việc mà một phép cập nhật MỘT CỘT làm xong.
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [{ orderItemId: A, soTien: KHOAN }],
      tranCon: traiTim,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("HAI bé");
    expect(!r.ok && r.loi, "câu lỗi phải chỉ đúng nút kia").toContain("Gắn cho bé");
  });

  it("[TKP-07] CẶP SỐ THẬT của pilot lệch 26.000đ ⇒ CHẶN — ghim phép trừ", () => {
    // ─────────────────────────────────────────────────────────────────────────
    // ⚠️ CA NÀY GHIM MỘT SỰ THẬT VỀ DỮ LIỆU, KHÔNG PHẢI MỘT LỖI CỦA MÃ.
    //
    // Chủ dự án cấp cặp số để pilot: *"phụ huynh chia 9.530.000đ thành 4.488.000đ (bé học
    // phí 8.976.000) + 5.016.000đ (bé học phí 10.032.000)"*. Hai số ấy là NỬA học phí của
    // từng bé, khít tuyệt đối:
    //
    //     8.976.000 ÷ 2 = 4.488.000        10.032.000 ÷ 2 = 5.016.000
    //     4.488.000 + 5.016.000 = 9.504.000
    //     khoản thật            = 9.530.000
    //     ─────────────────────────────────
    //     lệch                       26.000
    //
    // Nghĩa là phụ huynh chuyển DƯ 26.000đ so với hai nửa học phí. Cổng Σ-đúng-bằng sẽ chặn
    // đúng cặp số ấy, và **đó là hành vi đúng**: 26.000đ là tiền thật đã vào đơn, nó phải
    // thuộc về một bé nào đó chứ không được bốc hơi.
    //
    // ⚠️ VÀ HỆ THỐNG KHÔNG TỰ DỒN 26.000đ VÀO BÉ NÀO — chủ dự án chốt 20/09/2026. Khoản
    // chênh ấy CHƯA AI GIẢI THÍCH ĐƯỢC (phụ huynh làm tròn? học phí ghi sai? phụ phí?), nên
    // phải HỎI phụ huynh / kế toán rồi mới tách. Không test nào và không runbook nào được in
    // ra một cặp số "chữa cháy" — in ra là chốt hộ một quyết định nghiệp vụ.
    //
    // Ca này tồn tại để không ai phải phát hiện lại phép trừ ấy bằng tay giữa lúc pilot.
    // ─────────────────────────────────────────────────────────────────────────
    expect(NUA_A + NUA_B, "hai nửa học phí").toBe(9_504_000);
    expect(KHOAN - (NUA_A + NUA_B), "phần phụ huynh chuyển DƯ").toBe(26_000);

    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: A, soTien: NUA_A },
        { orderItemId: B, soTien: NUA_B },
      ],
      tranCon: traiTim,
    });
    expect(r.ok, "cặp số 'đẹp' vẫn phải bị chặn — Σ là Σ").toBe(false);
    expect(!r.ok && r.loi).toBe("Còn THIẾU 26.000đ — tổng phải đúng bằng 9.530.000đ");
  });

  it("[TKP-08] bé không thuộc đơn ⇒ CHẶN trước khi kiểm tổng", () => {
    // Thứ tự kiểm có chủ ý: người gõ nhầm một bé cần nghe "bé không thuộc đơn", không phải
    // "tổng lệch 26.000đ" — câu sau đúng về số nhưng chỉ người ta đi sai hướng.
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: "item-cua-don-khac", soTien: PHAN_A },
        { orderItemId: B, soTien: PHAN_B },
      ],
      tranCon: traiTim,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("không thuộc đơn này");
  });

  it("[TKP-09] nhập HAI LẦN cho cùng một bé ⇒ CHẶN", () => {
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: A, soTien: PHAN_A },
        { orderItemId: A, soTien: PHAN_B },
      ],
      tranCon: traiTim,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("nhập hai lần");
  });

  it("[TKP-10] ô để TRỐNG bị bỏ qua, không tính là 0đ cho bé đó", () => {
    // Màn hình gửi lên đủ n ô, phần lớn trống. Ô trống phải rơi khỏi phép chia — nếu nó
    // thành một `phan` với `soTien: 0` thì đơn 3 con sẽ đẻ một dòng `Payment` 0đ.
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: A, soTien: PHAN_A },
        { orderItemId: B, soTien: PHAN_B },
        { orderItemId: "item-c", soTien: 0 },
      ],
      tranCon: [...traiTim, { orderItemId: "item-c", ten: "Bé C", conCoTheNhan: 1, daVe: 0 }],
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.phan).toHaveLength(2);
  });

  it("[TKP-11] bé đóng THỪA ⇒ trần 0 ⇒ không nhận thêm đồng nào", () => {
    const r = kiemTachKhoan({
      soTienKhoan: KHOAN,
      phan: [
        { orderItemId: A, soTien: 1 },
        { orderItemId: B, soTien: KHOAN - 1 },
      ],
      tranCon: [
        { orderItemId: A, ten: "Bé A", conCoTheNhan: 0, daVe: HOC_PHI_A + 500_000 },
        { orderItemId: B, ten: "Bé B", conCoTheNhan: HOC_PHI_B, daVe: 0 },
      ],
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("tối đa 0đ");
  });

  it("[TKP-12] số tiền khoản ≤ 0 ⇒ CHẶN (bút toán âm không tách được)", () => {
    const r = kiemTachKhoan({
      soTienKhoan: -KHOAN,
      phan: [
        { orderItemId: A, soTien: -PHAN_A },
        { orderItemId: B, soTien: -PHAN_B },
      ],
      tranCon: traiTim,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.loi).toContain("không có số tiền hợp lệ");
  });
});
