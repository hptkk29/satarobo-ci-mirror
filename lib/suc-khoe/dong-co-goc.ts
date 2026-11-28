/* eslint-disable */
// @ts-nocheck
/**
 * ĐỘNG CƠ + DỮ LIỆU của «Sức khỏe cả nhà» — CHÉP NGUYÊN VĂN từ artifact «Sata Robo — Website mới» (project/SucKhoe.dc.html), chỉ thêm `export`
 * và bỏ đọc đồng hồ ở cấp module (`datHomNay`). Gồm: thang đo (WHO-5, PHQ-2, GAD-2, AUDIT-C, IPAQ-SF, BMI châu Á), 56 câu LÕI (hỏi lại nguyên văn mỗi lượt),
 * 7 khối câu đào sâu, `ngCtx` (suy ngữ cảnh từ trả lời), `ketQua` (kết quả + khuyến nghị theo lĩnh vực, mỗi dòng kèm NGUỒN).
 *
 * ⚠️ NGOẠI LỆ CÓ CHỦ ĐÍCH 12/11/2026 (chủ dự án): chỉ cân nặng + chiều cao còn GÕ SỐ; mọi câu từng gõ số khác (vòng eo, số phút vận động, giờ ngồi,
 * rau quả, giờ ngủ, màn hình) là CHỌN khoảng — xem khối `PHUT_O … EO_O` bên dưới. Artifact thiết kế vẫn là bản gõ số: sinh lại từ nó sẽ làm mất thay đổi này.
 * ⚠️ NGOẠI LỆ CÓ CHỦ ĐÍCH 13/11/2026 (chủ dự án: «giảm lượng câu hỏi xuống một nửa»): người lớn/60+ còn 13 câu (từ 26), trẻ ≤ 13. Câu bỏ khỏi bản hỏi KHÔNG bị xoá —
 * chúng mang `g: []` để sổ cũ vẫn dựng được nhãn «lần trước»; ba cặp «ngày × phút» vận động gộp thành `vd_tuan`; WHO-5 không còn hỏi (PHQ-2/GAD-2 giữ). Khoá bằng `[SK-EG-09]`.
 * ⚠️ KHÔNG sửa tay từng dòng: nội dung khuyến nghị là hiện vật của thiết kế (chủ dự án chốt dùng khuyến nghị đơn giản, KHÔNG cần bác sĩ duyệt — 07/11/2026).
 * Muốn đổi ⇒ sửa artifact rồi sinh lại bằng bộ trích; hành vi được GHIM bằng test vàng `dong-co-goc.test.ts`. Tầng 3 (xoay vòng, 1000 câu) ở `ngan-hang/xoay-vong.ts`.
 * ⚠️ Câu LÕI và khuyến nghị lấy từ WHO / IPAQ / PHQ-2 / GAD-2 / AUDIT-C: WHO-5 phát hành CC BY-NC-SA 3.0 (phi thương mại) — cần đối chiếu điều khoản trước khi dùng
 * thương mại; IPAQ-SF CC BY 4.0; PHQ-2/GAD-2 do Pfizer cho dùng tự do.
 */

function homNayThat() {
  const d = new Date();
  const hai = (x) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + hai(d.getMonth() + 1) + "-" + hai(d.getDate());
}

export const TOI_DA_NGUOI = 6;
export const TOI_DA_LUOT = 3;
export const hai = (x) => String(x).padStart(2, '0');
let homNay = null;
export function datHomNay(iso) { homNay = iso; }
/** Ngày hôm nay (yyyy-mm-dd): đọc ĐỒNG HỒ mỗi lần gọi (máy chủ sống nhiều ngày — không chốt lúc nạp module), trừ khi test đã `datHomNay`. */
export const layHomNay = () => homNay || homNayThat();
export const ngayVN = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : ''; };
export const so1 = (n) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',');
export const soGon = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
export const docSo = (s) => { const t = String(s == null ? '' : s).trim().replace(',', '.'); if (!t) return NaN; const n = Number(t); return Number.isFinite(n) ? n : NaN; };
export const thangTuoi = (ns, nd = undefined) => {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ns || ''), b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nd || layHomNay());
  if (!a || !b) return null; let m = (b[1] - a[1]) * 12 + (b[2] - a[2]); if (Number(b[3]) < Number(a[3])) m -= 1; return m;
};
export const tuoiChu = (ns, nd = undefined) => { const m = thangTuoi(ns, nd); if (m === null || m < 0) return ''; if (m < 24) return m + ' tháng'; return Math.floor(m / 12) + ' tuổi'; };
export const nhomTuoi = (ns, nd = undefined) => { const m = thangTuoi(ns, nd); if (m === null) return null; if (m < 72) return 'u5'; if (m < 144) return 'c6'; if (m < 216) return 'c12'; return m < 720 ? 'nl' : 'gia'; };
export const TEN_NHOM = { u5: '0–5 tuổi', c6: '6–11 tuổi', c12: '12–17 tuổi', nl: 'Người lớn 18–59', gia: 'Từ 60 tuổi' };
export const laTre = (g) => g === 'u5' || g === 'c6' || g === 'c12';
export const NGUON = {
  'IPAQ-SF': 'IPAQ bản ngắn (CC BY 4.0)', 'WHO-5': 'Chỉ số hạnh phúc WHO-5 (WHO, CC BY-NC-SA 3.0)', 'PHQ-2': 'PHQ-2 (Pfizer, dùng tự do)', 'GAD-2': 'GAD-2 (Pfizer, dùng tự do)',
  'AUDIT-C': 'AUDIT-C (WHO)', 'STEPS': 'Kiểu câu WHO STEPS', 'GSHS': 'Kiểu câu WHO GSHS (học sinh)', 'PHQ': 'Câu chức năng của bộ PHQ (Pfizer)', 'CDC': 'Mốc phát triển CDC, bản tiếng Việt',
  'Tự soạn': 'Câu tự soạn, đối chiếu khuyến nghị — chờ chuyên gia duyệt'
};

// ---------- LĨNH VỰC ----------
export const LV = [
  { id: 'so', ten: 'Số đo', moTa: 'Chỉ cần gõ cân nặng và chiều cao, các phần sau chỉ việc chọn đáp án. Đo vào buổi sáng, mặc đồ nhẹ là chuẩn nhất.' },
  { id: 'vd', ten: 'Vận động', moTa: 'Tính các hoạt động trong 7 ngày vừa qua.' },
  { id: 'an', ten: 'Ăn uống', moTa: 'Nghĩ về một tuần bình thường gần đây.' },
  { id: 'ngu', ten: 'Giấc ngủ', moTa: 'Tính trung bình các ngày gần đây.' },
  { id: 'mh', ten: 'Màn hình', moTa: 'Chỉ tính giờ xem để giải trí, không tính giờ học.' },
  { id: 'tt', ten: 'Tinh thần', moTa: 'Trong 2 tuần qua. Không có câu trả lời đúng hay sai.' },
  { id: 'th', ten: 'Thuốc lá & rượu bia', moTa: 'Gồm cả khói thuốc trong nhà, vì nó ảnh hưởng tới các bé.' },
  { id: 'moc', ten: 'Mốc phát triển', moTa: 'Dành cho bé đến 5 tuổi, theo tháng tuổi.' },
  { id: 'do', ten: 'Dấu hiệu cần lưu ý ngay', moTa: 'Chỉ 2 câu. Nếu có, Sata Robo sẽ nhắc anh chị liên hệ y tế ngay.' }
];
export const ngay07 = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => [String(n), n]);
// 12/11/2026 (chủ dự án: «chỉ nhập chiều cao, cân nặng — mấy câu khác làm trắc nghiệm»): các câu trước đây GÕ SỐ nay là CHỌN khoảng.
// Giá trị lưu là một SỐ đại diện (id câu giữ nguyên ⇒ ngCtx/ketQua đọc như cũ; sổ đã lưu bằng số gõ tay vẫn tính được). Mốc chia rơi đúng
// ngưỡng của luật (150 phút/tuần, ngủ < mốc theo tuổi, ngồi ≥ 8 giờ, rau quả < 5 phần, màn hình > 2 giờ) nên chọn phương án không làm lệch kết luận.
export const PHUT_O = [['Khoảng 15 phút', 15], ['Khoảng 30 phút', 30], ['Khoảng 45 phút', 45], ['Khoảng 1 giờ', 60], ['Khoảng 1,5 giờ', 90], ['2 giờ trở lên', 120]];
export const NGOI_O = [['Dưới 4 giờ', 3], ['4–5 giờ', 4.5], ['6–7 giờ', 6.5], ['8–9 giờ', 8.5], ['10 giờ trở lên', 11]];
export const RAU_O = [['Dưới 1 phần', 0], ['1–2 phần', 1.5], ['3–4 phần', 3.5], ['5 phần trở lên', 5]];
export const NGU_O = [['Dưới 5 giờ', 4], ['Khoảng 5 giờ', 5], ['Khoảng 6 giờ', 6], ['Khoảng 7 giờ', 7], ['Khoảng 8 giờ', 8], ['Khoảng 9 giờ', 9], ['Khoảng 10 giờ', 10], ['11 giờ trở lên', 11]];
export const NGU_U5_O = [['Dưới 9 giờ', 8], ['Khoảng 9 giờ', 9], ['Khoảng 10 giờ', 10], ['Khoảng 11 giờ', 11], ['Khoảng 12 giờ', 12], ['Khoảng 13 giờ', 13], ['14 giờ trở lên', 14]];
export const MH_O = [['Dưới 1 giờ', 0.5], ['Khoảng 1 giờ', 1], ['Khoảng 2 giờ', 2], ['Khoảng 3 giờ', 3], ['4 giờ trở lên', 4]];
export const EO_O = [['Thấp hơn mốc', 0], ['Bằng hoặc cao hơn mốc', 1]];
export const WHO5_O =[['Mọi lúc', 5], ['Phần lớn thời gian', 4], ['Hơn một nửa thời gian', 3], ['Ít hơn một nửa thời gian', 2], ['Thỉnh thoảng', 1], ['Không lúc nào', 0]];
export const PHQ_O = [['Không ngày nào', 0], ['Vài ngày', 1], ['Hơn một nửa số ngày', 2], ['Gần như mỗi ngày', 3]];
export const TL = (o) => o.map((x) => (Array.isArray(x) ? x : [x, x]));

// ---------- TẦNG 1 · LÕI (hỏi lại nguyên văn mỗi lượt) ----------
// g: nhóm tuổi áp dụng · khi(a, ctx): chỉ hiện khi … · tuy: không bắt buộc
export const LOI = [
  { id: 'can', d: 'so', g: ['u5', 'c6', 'c12', 'nl', 'gia'], q: 'Cân nặng của {ai}', t: 'so', dv: 'kg', min: 2, max: 300, src: 'Tự soạn' },
  { id: 'cao', d: 'so', g: ['u5', 'c6', 'c12', 'nl', 'gia'], q: 'Chiều cao của {ai}', t: 'so', dv: 'cm', min: 40, max: 250, src: 'Tự soạn' },
  { id: 'eo_muc', d: 'so', g: [], q: 'Vòng eo (đo ngang rốn) so với mốc của người châu Á: 90 cm với nam, 80 cm với nữ', t: 'chon', o: EO_O, tuy: true, src: 'STEPS', goiY: 'Không có thước dây thì bỏ qua câu này.' },

  { id: 'vd_tuan', d: 'vd', g: ['nl', 'gia'], q: 'Mỗi tuần, tổng cộng {ai} đi bộ nhanh, đạp xe, chơi thể thao hoặc làm việc nặng khoảng bao lâu? (tính cả đi làm, đi chợ, việc nhà)', t: 'chon', o: TL([['Dưới 60 phút', 30], ['60–149 phút', 105], ['150–299 phút', 225], ['300 phút trở lên', 360]]), dv: 'phút', src: 'IPAQ-SF rút gọn', goiY: '150 phút/tuần ≈ 30 phút × 5 ngày.' },
  { id: 'vd_manh_ngay', d: 'vd', g: [], q: 'Có bao nhiêu ngày {ai} vận động MẠNH (mang vác nặng, chạy, đạp xe nhanh, bơi nhanh…) ít nhất 10 phút liền?', t: 'chon', o: ngay07, dv: 'ngày', src: 'IPAQ-SF' },
  { id: 'vd_manh_phut', d: 'vd', g: [], q: 'Những ngày đó, trung bình mỗi ngày bao lâu?', t: 'chon', o: PHUT_O, dv: 'phút', khi: (a) => +a.vd_manh_ngay > 0, src: 'IPAQ-SF' },
  { id: 'vd_vua_ngay', d: 'vd', g: [], q: 'Có bao nhiêu ngày {ai} vận động VỪA (mang vác nhẹ, đạp xe thong thả, làm vườn, lau nhà…) ít nhất 10 phút liền? Không tính đi bộ.', t: 'chon', o: ngay07, dv: 'ngày', src: 'IPAQ-SF' },
  { id: 'vd_vua_phut', d: 'vd', g: [], q: 'Những ngày đó, trung bình mỗi ngày bao lâu?', t: 'chon', o: PHUT_O, dv: 'phút', khi: (a) => +a.vd_vua_ngay > 0, src: 'IPAQ-SF' },
  { id: 'vd_di_ngay', d: 'vd', g: [], q: 'Có bao nhiêu ngày {ai} đi bộ ít nhất 10 phút liền (đi làm, đi chợ, đi dạo…)?', t: 'chon', o: ngay07, dv: 'ngày', src: 'IPAQ-SF' },
  { id: 'vd_di_phut', d: 'vd', g: [], q: 'Những ngày đó, trung bình mỗi ngày đi bộ bao lâu?', t: 'chon', o: PHUT_O, dv: 'phút', khi: (a) => +a.vd_di_ngay > 0, src: 'IPAQ-SF' },
  { id: 'vd_ngoi', d: 'vd', g: [], q: 'Một ngày thường, {ai} ngồi khoảng bao nhiêu giờ (làm việc, đi xe, xem TV)?', t: 'chon', o: NGOI_O, dv: 'giờ', src: 'IPAQ-SF' },
  { id: 'vd_tb', d: 'vd', g: ['gia'], q: 'Mỗi tuần có mấy ngày {ai} tập thăng bằng hoặc tăng sức cơ (đứng một chân, dưỡng sinh, thái cực quyền, nâng tạ nhẹ)?', t: 'chon', o: ngay07, dv: 'ngày', src: 'Tự soạn' },
  { id: 'vd_nga', d: 'vd', g: ['gia'], q: 'Trong 12 tháng qua, {ai} có bị té ngã không?', t: 'chon', o: TL([['Không', 0], ['1 lần', 1], ['Từ 2 lần trở lên', 2]]), src: 'Tự soạn' },
  { id: 'vd60', d: 'vd', g: ['c6', 'c12'], q: 'Trong 7 ngày qua, có bao nhiêu ngày {ai} chạy nhảy, chơi thể thao, đạp xe… đủ tổng cộng ít nhất 60 phút?', t: 'chon', o: ngay07, dv: 'ngày', src: 'GSHS' },
  { id: 'vd_co', d: 'vd', g: [], q: 'Trong 7 ngày qua, có mấy ngày {ai} tập các bài làm khoẻ cơ, xương (nhảy dây, leo trèo, hít đất, đá cầu…)?', t: 'chon', o: ngay07, dv: 'ngày', src: 'Tự soạn' },
  { id: 'vd_u5', d: 'vd', g: ['u5'], q: 'Mỗi ngày {ai} được chạy nhảy, bò, chơi vận động tổng cộng khoảng bao lâu?', t: 'chon', o: TL([['Dưới 1 giờ', 30], ['1–2 giờ', 90], ['2–3 giờ', 150], ['Trên 3 giờ', 200]]), src: 'Tự soạn' },
  { id: 'vd_u5_ngoi', d: 'vd', g: [], q: '{Ai} có hay phải ngồi yên một chỗ (xe đẩy, ghế ăn, được bế) quá 1 giờ liền không?', t: 'chon', o: TL([['Hiếm khi', 0], ['Thỉnh thoảng', 1], ['Thường xuyên', 2]]), src: 'Tự soạn' },

  { id: 'an_bu', d: 'an', g: ['u5'], q: '{Ai} có đang bú mẹ không?', t: 'chon', o: TL([['Có', 1], ['Không', 0]]), khi: (a, c) => c.thang < 24, src: 'Tự soạn' },
  { id: 'an_sang', d: 'an', g: [], q: 'Mỗi tuần {ai} ăn sáng mấy ngày?', t: 'chon', o: ngay07, dv: 'ngày', src: 'GSHS' },
  { id: 'an_rq', d: 'an', g: ['c6', 'c12', 'nl', 'gia'], q: 'Một ngày bình thường, {ai} ăn bao nhiêu phần rau và trái cây cộng lại?', t: 'chon', o: RAU_O, dv: 'phần', src: 'STEPS', goiY: '1 phần ≈ 1 chén rau nấu chín, 1 đĩa nhỏ rau sống, hoặc 1 quả chuối, cam cỡ vừa.' },
  { id: 'an_rq_u5', d: 'an', g: ['u5'], q: 'Mỗi ngày {ai} ăn rau hoặc trái cây trong mấy bữa?', t: 'chon', o: TL([['Chưa ăn dặm', -1], ['0 bữa', 0], ['1 bữa', 1], ['2 bữa', 2], ['3 bữa trở lên', 3]]), src: 'Tự soạn' },
  { id: 'an_ngot', d: 'an', g: [], q: 'Mỗi tuần {ai} uống nước ngọt có đường, trà sữa, nước tăng lực mấy lần?', t: 'chon', o: TL([['Không uống', 0], ['1–2 lần', 1.5], ['3–6 lần', 4.5], ['Mỗi ngày', 7]]), src: 'STEPS' },
  { id: 'an_ngot_u5', d: 'an', g: [], q: '{Ai} có uống nước ngọt, trà sữa hoặc ăn bánh kẹo ngọt không?', t: 'chon', o: TL([['Không', 0], ['Vài lần một tuần', 1], ['Hằng ngày', 2]]), src: 'Tự soạn' },
  { id: 'an_nhanh', d: 'an', g: [], q: 'Mỗi tuần {ai} ăn đồ chiên rán, snack, đồ ăn nhanh mấy lần?', t: 'chon', o: TL([['Hầu như không', 0], ['1–2 lần', 1.5], ['3–6 lần', 4.5], ['Mỗi ngày', 7]]), src: 'Tự soạn' },
  { id: 'an_man', d: 'an', g: [], q: '{Ai} có hay chấm thêm nước mắm, muối, hoặc ăn đồ mặn (dưa cà muối, mì gói, đồ hộp) không?', t: 'chon', o: TL([['Hiếm khi', 0], ['Thỉnh thoảng', 1], ['Thường xuyên', 2]]), src: 'STEPS' },

  { id: 'ngu_gio', d: 'ngu', g: ['c6', 'c12', 'nl', 'gia'], q: 'Trung bình mỗi đêm {ai} ngủ được bao nhiêu giờ?', t: 'chon', o: NGU_O, dv: 'giờ', src: 'Tự soạn' },
  { id: 'ngu_u5', d: 'ngu', g: ['u5'], q: 'Tổng thời gian {ai} ngủ trong một ngày, tính cả ngủ trưa, khoảng bao nhiêu giờ?', t: 'chon', o: NGU_U5_O, dv: 'giờ', src: 'Tự soạn' },
  { id: 'ngu_khoe', d: 'ngu', g: [], q: 'Buổi sáng thức dậy, {ai} thường thấy thế nào?', t: 'chon', o: TL([['Tỉnh táo, khoẻ khoắn', 0], ['Hơi mệt', 1], ['Rất mệt, như chưa ngủ đủ', 2]]), src: 'Tự soạn' },
  { id: 'ngu_dt', d: 'ngu', g: [], q: '{Ai} có mang điện thoại lên giường khi đi ngủ không?', t: 'chon', o: TL([['Không', 0], ['Thỉnh thoảng', 1], ['Hầu như mỗi tối', 2]]), src: 'Tự soạn' },

  { id: 'mh_thuong', d: 'mh', g: ['c6', 'c12'], q: 'Ngày đi học, {ai} dùng màn hình để giải trí (TV, điện thoại, máy tính bảng, game) khoảng mấy giờ?', t: 'chon', o: MH_O, dv: 'giờ', src: 'Tự soạn' },
  { id: 'mh_nghi', d: 'mh', g: [], q: 'Ngày nghỉ thì khoảng mấy giờ?', t: 'chon', o: MH_O, dv: 'giờ', src: 'Tự soạn' },
  { id: 'mh_u5', d: 'mh', g: ['u5'], q: 'Mỗi ngày {ai} xem màn hình (TV, điện thoại, máy tính bảng) khoảng bao lâu?', t: 'chon', o: TL([['Không xem', 0], ['Dưới 1 giờ', 0.5], ['1–2 giờ', 1.5], ['Trên 2 giờ', 2.5]]), src: 'Tự soạn' },

  { id: 'w1', d: 'tt', g: [], q: 'Tôi thấy vui vẻ và tinh thần thoải mái', t: 'chon', o: WHO5_O, src: 'WHO-5' },
  { id: 'w2', d: 'tt', g: [], q: 'Tôi thấy bình tĩnh và thư thái', t: 'chon', o: WHO5_O, src: 'WHO-5' },
  { id: 'w3', d: 'tt', g: [], q: 'Tôi thấy năng động và hăng hái', t: 'chon', o: WHO5_O, src: 'WHO-5' },
  { id: 'w4', d: 'tt', g: [], q: 'Tôi thức dậy thấy tươi tỉnh, được nghỉ ngơi đầy đủ', t: 'chon', o: WHO5_O, src: 'WHO-5' },
  { id: 'w5', d: 'tt', g: [], q: 'Cuộc sống hằng ngày của tôi có nhiều điều làm tôi quan tâm', t: 'chon', o: WHO5_O, src: 'WHO-5' },
  { id: 'p1', d: 'tt', g: ['c12', 'nl', 'gia'], q: 'Ít hứng thú hoặc ít thấy vui khi làm việc gì đó', t: 'chon', o: PHQ_O, src: 'PHQ-2' },
  { id: 'p2', d: 'tt', g: ['c12', 'nl', 'gia'], q: 'Cảm thấy buồn, chán nản hoặc tuyệt vọng', t: 'chon', o: PHQ_O, src: 'PHQ-2' },
  { id: 'g1', d: 'tt', g: ['c12', 'nl'], q: 'Cảm thấy bồn chồn, lo âu hoặc căng thẳng', t: 'chon', o: PHQ_O, src: 'GAD-2' },
  { id: 'g2', d: 'tt', g: ['c12', 'nl'], q: 'Không thể ngừng hoặc kiểm soát được việc lo lắng', t: 'chon', o: PHQ_O, src: 'GAD-2' },
  { id: 'tt6', d: 'tt', g: ['c6'], q: 'Hai tuần qua, {ai} có hay buồn bã, lo lắng hoặc cáu kỉnh kéo dài hơn bình thường không?', t: 'chon', o: TL([['Không', 0], ['Đôi khi', 1], ['Thường xuyên', 2]]), src: 'Tự soạn' },

  { id: 'hut', d: 'th', g: ['nl', 'gia'], q: 'Hiện nay {ai} có hút thuốc lá (kể cả thuốc lá điện tử, thuốc lá nung nóng) không?', t: 'chon', o: TL([['Không', 0], ['Có, thỉnh thoảng', 1], ['Có, hằng ngày', 2]]), src: 'STEPS' },
  { id: 'hut_teen', d: 'th', g: ['c12'], q: 'Trong 30 ngày qua, {ai} có hút thuốc lá hoặc thuốc lá điện tử không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), src: 'GSHS' },
  { id: 'khoi', d: 'th', g: ['u5', 'c6'], q: 'Trong 7 ngày qua, có ai hút thuốc trong nhà không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), src: 'STEPS' },
  { id: 'a1', d: 'th', g: ['nl', 'gia'], q: '{Ai} uống rượu bia thường xuyên đến mức nào?', t: 'chon', o: TL([['Không bao giờ', 0], ['Hằng tháng hoặc ít hơn', 1], ['2–4 lần một tháng', 2], ['2–3 lần một tuần', 3], ['Từ 4 lần một tuần', 4]]), khi: (a, c) => !c.mt, src: 'AUDIT-C' },
  { id: 'a2', d: 'th', g: ['nl', 'gia'], q: 'Một ngày có uống, {ai} thường uống bao nhiêu ly chuẩn?', t: 'chon', o: TL([['1–2 ly', 0], ['3–4 ly', 1], ['5–6 ly', 2], ['7–9 ly', 3], ['Từ 10 ly', 4]]), khi: (a, c) => !c.mt && +a.a1 > 0, src: 'AUDIT-C', goiY: '1 ly chuẩn ≈ 1 cốc bia hơi 330 ml, 1 ly vang 100 ml hoặc 1 chén rượu mạnh 30 ml.' },
  { id: 'a3', d: 'th', g: ['nl', 'gia'], q: 'Bao lâu {ai} uống từ 6 ly chuẩn trở lên trong một lần?', t: 'chon', o: TL([['Không bao giờ', 0], ['Ít hơn hằng tháng', 1], ['Hằng tháng', 2], ['Hằng tuần', 3], ['Hằng ngày hoặc gần như vậy', 4]]), khi: (a, c) => !c.mt && +a.a1 > 0, src: 'AUDIT-C' },
  { id: 'a_mt', d: 'th', g: ['nl'], q: 'Hiện nay chị có uống rượu bia không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), khi: (a, c) => c.mt, src: 'Tự soạn' },

  { id: 'moc', d: 'moc', g: ['u5'], q: 'Đối chiếu Danh sách mốc phát triển của CDC theo tháng tuổi, hiện {ai} thế nào?', t: 'chon', o: TL([['Đã đạt các mốc của tuổi', 0], ['Còn vài mốc chưa đạt', 1], ['Bé mất kỹ năng đã từng có', 2], ['Chưa xem danh sách', 3]]), src: 'CDC' },

  { id: 'do1', d: 'do', g: ['nl', 'gia'], q: 'Gần đây {ai} có đau, tức ngực khi gắng sức hoặc khó thở bất thường không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), src: 'Tự soạn' },
  { id: 'do2', d: 'do', g: ['nl', 'gia'], q: '{Ai} có từng ngất, choáng váng khi đang vận động không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), khi: (a, c) => !c.mt, src: 'Tự soạn' },
  { id: 'do_mt', d: 'do', g: ['nl'], q: 'Chị có ra máu, đau bụng nhiều hoặc thấy thai máy giảm không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), khi: (a, c) => c.mt, src: 'Tự soạn' },
  { id: 'do_tre1', d: 'do', g: ['c6', 'c12'], q: '{Ai} có từng ngất hoặc kêu đau ngực khi chạy nhảy không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), src: 'Tự soạn' },
  { id: 'do_tre2', d: 'do', g: ['c6', 'c12'], q: '{Ai} có sụt cân rõ rệt mà không rõ lý do không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), src: 'Tự soạn' },
  { id: 'do_u5a', d: 'do', g: ['u5'], q: 'Hiện {ai} có lừ đừ, bỏ bú/bỏ ăn, co giật, hoặc (nếu dưới 3 tháng tuổi) bị sốt không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), src: 'Tự soạn' },
  { id: 'do_u5b', d: 'do', g: ['u5'], q: '{Ai} có dấu hiệu mất nước (khóc không ra nước mắt, rất ít đi tiểu, môi khô) không?', t: 'chon', o: TL([['Không', 0], ['Có', 1]]), src: 'Tự soạn' }
];

// ---------- TẦNG 2 · ĐÀO SÂU (chỉ hiện khi lõi báo vấn đề, chỉ trong lĩnh vực đó) ----------
export const DS = [
  { id: 'dd_tt', d: 'tt', lyDo: 'Vì điểm tâm trạng hoặc lo âu ở trên ở mức nên quan tâm', khi: (a, c) => c.phq2 >= 3 || c.gad2 >= 3, cau: [
    { id: 'tt_anh', q: 'Những cảm giác trên khiến việc làm, học tập hoặc chuyện trong nhà khó khăn đến mức nào?', o: TL([['Không khó khăn', 0], ['Hơi khó khăn', 1], ['Rất khó khăn', 2], ['Cực kỳ khó khăn', 3]]), src: 'PHQ' },
    { id: 'tt_keo', q: 'Tình trạng này kéo dài bao lâu rồi?', o: TL([['Dưới 2 tuần', 0], ['2 tuần đến 1 tháng', 1], ['Hơn 1 tháng', 2]]), src: 'Tự soạn' },
    { id: 'tt_chiase', q: 'Khi thấy không ổn, {ai} có người để tâm sự không?', o: TL([['Có', 0], ['Không chắc', 1], ['Chưa có', 2]]), src: 'Tự soạn' } ] },
  { id: 'dd_tt6', d: 'tt', lyDo: 'Vì bé thường xuyên buồn, lo hoặc cáu kỉnh', khi: (a) => +a.tt6 >= 2, cau: [
    { id: 'tt6_keo', q: 'Tình trạng này kéo dài bao lâu rồi?', o: TL([['Dưới 2 tuần', 0], ['2 tuần đến 1 tháng', 1], ['Hơn 1 tháng', 2]]), src: 'Tự soạn' },
    { id: 'tt6_anh', q: 'Nó có ảnh hưởng tới việc học, ăn ngủ hoặc chơi với bạn không?', o: TL([['Không', 0], ['Có phần', 1], ['Rõ rệt', 2]]), src: 'Tự soạn' } ] },
  { id: 'dd_ruou', d: 'th', lyDo: 'Vì mức uống rượu bia ở trên cao hơn ngưỡng khuyến nghị', khi: (a, c) => c.auditC >= c.nguongAudit, cau: [
    { id: 'r_giam', q: '{Ai} đã từng muốn giảm uống rượu bia chưa?', o: TL([['Chưa nghĩ tới', 0], ['Có nghĩ nhưng chưa làm', 1], ['Đang cố giảm', 2]]), src: 'Tự soạn' },
    { id: 'r_lai', q: 'Có khi nào {ai} lái xe sau khi uống không?', o: TL([['Không bao giờ', 0], ['Thỉnh thoảng', 1], ['Thường xuyên', 2]]), src: 'Tự soạn' } ] },
  { id: 'dd_so', d: 'so', lyDo: 'Vì BMI hoặc vòng eo nằm ngoài khoảng khuyến nghị cho người châu Á', khi: (a, c) => c.bmiNgoai, cau: [
    { id: 's_gd', q: 'Bố mẹ, anh chị em ruột của {ai} có ai bị đái tháo đường không?', o: TL([['Không', 0], ['Có', 1], ['Không rõ', 2]]), src: 'Tự soạn' },
    { id: 's_ha', q: 'Lần gần nhất {ai} được đo huyết áp là khi nào?', o: TL([['Trong 12 tháng qua', 0], ['Hơn 12 tháng trước', 1], ['Chưa bao giờ', 2]]), src: 'STEPS' },
    { id: 's_bs', q: 'Đã có bác sĩ nói {ai} bị tăng huyết áp hoặc đường huyết cao chưa?', o: TL([['Chưa', 0], ['Có', 1]]), src: 'STEPS' } ] },
  { id: 'dd_ngu', d: 'ngu', lyDo: 'Vì giờ ngủ ở trên ít hơn khuyến nghị theo tuổi', khi: (a, c) => c.nguThieu, cau: [
    { id: 'n_ngay', q: '{Ai} có ngáy to hoặc có lúc như ngừng thở khi ngủ không?', o: TL([['Không', 0], ['Thỉnh thoảng', 1], ['Thường xuyên', 2]]), src: 'Tự soạn' },
    { id: 'n_mh', q: 'Trong 1 giờ trước khi ngủ, {ai} có dùng điện thoại hoặc xem TV không?', o: TL([['Hầu như không', 0], ['Vài tối một tuần', 1], ['Hầu như mỗi tối', 2]]), src: 'Tự soạn' },
    { id: 'n_gio', q: 'Giờ đi ngủ của {ai} có cố định không?', o: TL([['Cố định', 0], ['Lệch dưới 1 giờ', 1], ['Thất thường', 2]]), src: 'Tự soạn' } ] },
  { id: 'dd_vd', d: 'vd', lyDo: 'Vì mức vận động ở trên chưa đạt khuyến nghị', khi: (a, c) => c.vdThieu, cau: [
    { id: 'vd_cantro', q: 'Điều gì cản trở việc vận động nhiều nhất?', o: TL([['Không có thời gian', 0], ['Không có chỗ an toàn', 1], ['Mệt, đau nhức', 2], ['Không thấy hứng thú', 3], ['Lý do khác', 4]]), src: 'Tự soạn' },
    { id: 'vd_cungai', q: '{Ai} có muốn vận động cùng người khác trong nhà không?', o: TL([['Có', 0], ['Thích tập một mình', 1], ['Chưa biết', 2]]), src: 'Tự soạn' } ] },
  { id: 'dd_mh', d: 'mh', lyDo: 'Vì thời gian màn hình ở trên khá nhiều', khi: (a, c) => c.mhNhieu, cau: [
    { id: 'mh_phong', q: 'Trong phòng ngủ của {ai} có TV, điện thoại hoặc máy tính không?', o: TL([['Không', 0], ['Có', 1]]), src: 'Tự soạn' },
    { id: 'mh_quydinh', q: 'Gia đình đã có quy định giờ dùng màn hình chưa?', o: TL([['Có, giữ được', 0], ['Có nhưng khó giữ', 1], ['Chưa có', 2]]), src: 'Tự soạn' } ] }
];

// ---------- TẦNG 3 · XOAY VÒNG (thói quen & hiểu biết — KHÔNG chấm điểm, không lặp với người đã thấy) ----------
// k: 'tq' thói quen · 'kt' kiến thức (có đáp án). g: 'tre' | 'nl' | 'all'



// ---------- TÍNH ĐIỂM (một chỗ duy nhất) ----------
export const NG = { thieu: 18.5, thua: 23, beo: 25, nang: 30 };
export const nguKhuyen = (thang) => thang < 12 ? [12, 16] : thang < 36 ? [11, 14] : thang < 72 ? [10, 13] : thang < 156 ? [9, 12] : thang < 216 ? [8, 10] : thang < 780 ? [7, 9] : [7, 8];
export const ngCtx = (ng, a) => {
  const thang = thangTuoi(ng.ns) || 0; const g = nhomTuoi(ng.ns);
  const can = docSo(a.can), cao = docSo(a.cao), eo = docSo(a.eo);
  const bmi = can > 0 && cao > 0 ? can / Math.pow(cao / 100, 2) : NaN;
  const mt = !!ng.mt && g === 'nl' && ng.gt === 'nu';
  const nl = g === 'nl' || g === 'gia';
  const eoCao = (Number.isFinite(eo) && eo >= (ng.gt === 'nam' ? 90 : 80)) || +a.eo_muc === 1;
  const bmiNgoai = nl && !mt && Number.isFinite(bmi) && (bmi < NG.thieu || bmi >= NG.thua || eoCao);
  const n = (k) => { const v = Number(a[k]); return Number.isFinite(v) ? v : 0; };
  const phutTuan = a.vd_tuan != null && a.vd_tuan !== '' ? n('vd_tuan') : n('vd_vua_ngay') * n('vd_vua_phut') + n('vd_di_ngay') * n('vd_di_phut') + 2 * n('vd_manh_ngay') * n('vd_manh_phut');
  const coVd = nl ? (a.vd_tuan != null && a.vd_tuan !== '') || (a.vd_vua_ngay != null && a.vd_vua_ngay !== '') : g === 'u5' ? a.vd_u5 != null : a.vd60 != null && a.vd60 !== '';
  const vdThieu = coVd && (nl ? phutTuan < 150 : g === 'u5' ? (thang >= 12 && n('vd_u5') < 180) : n('vd60') < 5);
  const gio = g === 'u5' ? docSo(a.ngu_u5) : docSo(a.ngu_gio); const kh = nguKhuyen(thang);
  const nguThieu = Number.isFinite(gio) && gio < kh[0];
  const mhVal = g === 'u5' ? n('mh_u5') : docSo(a.mh_thuong);
  const mhNhieu = g === 'u5' ? (thang < 24 ? n('mh_u5') > 0 : n('mh_u5') > 1) && a.mh_u5 != null : Number.isFinite(mhVal) && mhVal > 2;
  const who5 = ['w1', 'w2', 'w3', 'w4', 'w5'].every((k) => a[k] != null) ? ['w1', 'w2', 'w3', 'w4', 'w5'].reduce((s, k) => s + n(k), 0) : null;
  const phq2 = a.p1 != null && a.p2 != null ? n('p1') + n('p2') : -1;
  const gad2 = a.g1 != null && a.g2 != null ? n('g1') + n('g2') : -1;
  const auditC = a.a1 != null ? n('a1') + n('a2') + n('a3') : -1;
  const nguongAudit = ng.gt === 'nam' ? 4 : 3;
  const coDo = ['do1', 'do2', 'do_mt', 'do_tre1', 'do_tre2', 'do_u5a', 'do_u5b'].some((k) => +a[k] === 1);
  return { thang, g, can, cao, eo, bmi, mt, nl, eoCao, bmiNgoai, phutTuan, vdThieu, gio, kh, nguThieu, mhNhieu, mhVal, who5, phq2, gad2, auditC, nguongAudit, coDo };
};
export const hienCau = (it, ng, a, c) => it.g.indexOf(c.g) >= 0 && (!it.khi || it.khi(a, c));
export const cauCuaLv = (lv, ng, a) => { const c = ngCtx(ng, a); return LOI.filter((it) => it.d === lv && hienCau(it, ng, a, c)); };
export const manHinh = (ng, a) => LV.filter((lv) => cauCuaLv(lv.id, ng, a).length > 0).map((lv) => lv.id);
export const daoSau = (lv, ng, a) => { const c = ngCtx(ng, a); return DS.filter((d) => d.d === lv && d.khi(a, c) && (d.id !== 'dd_tt6' || c.g === 'c6')); };
export const nhanTl = (it, v) => { if (v == null || v === '') return ''; if (it.t === 'so') return soGon(Number(v)) + ' ' + it.dv; const o = it.o.find((x) => String(x[1]) === String(v)); if (o) return o[0] + (it.dv && it.o === ngay07 ? ' ' + it.dv : ''); const so = docSo(v); return it.dv && Number.isFinite(so) ? soGon(so) + ' ' + it.dv : ''; };
/** Chữ thường chữ đầu để nối vào giữa câu («Khoảng 7 giờ» thành «khoảng 7 giờ»). */
export const thuongDau = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : '');
const nhanCau = (id, v) => nhanTl(LOI.find((x) => x.id === id), v);

// ---------- KẾT QUẢ THEO LĨNH VỰC ----------
export const MUC = { on: ['Ổn', 'sk-pill'], cy: ['Nên chú ý', 'sk-pill sk-luu-y'], gap: ['Nên gặp chuyên gia', 'sk-pill sk-gap'], chua: ['Chưa đủ thông tin', 'sk-pill sk-trung'] };
export const ketQua = (ng, a) => {
  const c = ngCtx(ng, a); const ai = laTre(c.g) ? 'bé' : 'anh chị'; const out = [];
  const the = (lv, muc, soLieu, dong) => out.push({ lv, muc, soLieu, dong });
  // Số đo
  if (Number.isFinite(c.bmi)) {
    if (c.mt) the('so', 'chua', 'BMI không áp dụng khi mang thai/cho con bú', [['Tăng cân thai kỳ cần theo chuẩn riêng — anh chị trao đổi với bác sĩ sản khoa ở các lần khám thai.', 'Bộ câu hỏi — chờ chuyên gia chọn chuẩn']]);
    else if (!c.nl) the('so', 'chua', 'BMI ' + so1(c.bmi) + ' kg/m² (BMI thô)', [['Trẻ dưới 18 tuổi phải so BMI-theo-tuổi với chuẩn WHO (0–5 tuổi: chuẩn 2006; 5–19 tuổi: tham chiếu 2007). Sata Robo đang chờ bảng chuẩn nên chưa đánh giá. Xin đừng tự cho bé ăn kiêng.', 'WHO Growth Standards 2006 · Growth Reference 2007'], ['Cân đo định kỳ ở trạm y tế hoặc khi khám sức khoẻ ở trường là cách theo dõi tăng trưởng đáng tin nhất.', 'WHO']]);
    else {
      const pl = c.bmi < NG.thieu ? 'Nhẹ cân (châu Á)' : c.bmi < NG.thua ? 'Bình thường (châu Á)' : c.bmi < NG.beo ? 'Thừa cân (châu Á)' : c.bmi < NG.nang ? 'Béo phì độ I (châu Á)' : 'Béo phì độ II (châu Á)';
      const muc = c.bmi < NG.thieu || c.bmi >= NG.nang ? 'gap' : c.bmi >= NG.thua || c.eoCao ? 'cy' : 'on';
      const d = [];
      if (muc === 'on') d.push(['Cân nặng đang trong khoảng khuyến nghị cho người trưởng thành châu Á. Giữ nhịp ăn uống, vận động hiện tại.', 'WHO Expert Consultation 2004 · ngưỡng IDI-WPRO']);
      if (c.bmi >= NG.thua && c.bmi < NG.nang) d.push(['Nếu muốn giảm cân, giảm từ từ khoảng 0,5 kg/tuần; bớt nước ngọt, đồ chiên, thêm rau và vận động đều.', 'Bản nháp repo disc — chờ chuyên gia dinh dưỡng duyệt']);
      if (c.eoCao) d.push([(Number.isFinite(c.eo) ? 'Vòng eo ' + soGon(c.eo) + ' cm' : 'Vòng eo') + ', cao hơn mốc ' + (ng.gt === 'nam' ? '90' : '80') + ' cm dùng cho người châu Á — mỡ bụng liên quan tới nguy cơ tim mạch, đái tháo đường.', 'IDI-WPRO']);
      if (muc === 'gap') d.push(['Nên gặp bác sĩ hoặc chuyên gia dinh dưỡng để được tư vấn riêng.', 'Bản nháp repo disc']);
      if (+a.s_bs === 1 || +a.s_ha === 2 || +a.s_gd === 1) d.push(['Nên đo huyết áp và xét nghiệm đường huyết tại cơ sở y tế trong thời gian tới.', 'WHO STEPS']);
      the('so', muc, 'BMI ' + so1(c.bmi) + ' kg/m² · ' + pl, d);
    }
  }
  // Vận động
  if (c.nl) {
    const dd = [[c.phutTuan >= 150 ? 'Đạt mức khuyến nghị 150–300 phút vận động vừa (hoặc tương đương) mỗi tuần. Thêm 2 buổi tập cơ mỗi tuần nếu chưa có.' : 'Mục tiêu: 150–300 phút vận động vừa mỗi tuần, ví dụ đi bộ nhanh 30 phút × 5 ngày, cộng 2 buổi tập cơ.', 'WHO 2020']];
    if (docSo(a.vd_ngoi) >= 8) dd.push(['Ngồi ' + thuongDau(nhanCau('vd_ngoi', a.vd_ngoi)) + ' mỗi ngày: đứng dậy đi lại vài phút sau mỗi giờ ngồi.', 'WHO 2020']);
    if (c.g === 'gia' && +a.vd_tb < 3) dd.push(['Tập thăng bằng và sức cơ ít nhất 3 ngày/tuần để phòng té ngã (đứng một chân, dưỡng sinh, thái cực quyền).', 'WHO 2020']);
    if (+a.vd_nga >= 2) dd.push(['Té ngã từ 2 lần trong năm: nên khám để tìm nguyên nhân (thị lực, thuốc đang dùng, sức cơ).', 'Tự soạn — chờ duyệt']);
    if (c.mt) dd.push(['Khi mang thai, ít nhất 150 phút vận động vừa mỗi tuần nếu bác sĩ không chỉ định khác.', 'WHO 2020']);
    the('vd', c.phutTuan >= 150 && !(c.g === 'gia' && +a.vd_tb < 3) ? 'on' : 'cy', (a.vd_tuan != null && a.vd_tuan !== '' ? nhanCau('vd_tuan', a.vd_tuan) + ' mỗi tuần' : '≈ ' + Math.round(c.phutTuan) + ' phút/tuần (vừa + 2 × mạnh)'), dd);
  } else if (c.g === 'u5') {
    the('vd', c.vdThieu ? 'cy' : 'on', nhanTl(LOI.find((x) => x.id === 'vd_u5'), a.vd_u5) + '/ngày', [[c.thang < 12 ? 'Trẻ dưới 1 tuổi: cho bé vận động nhiều lần trong ngày, có ít nhất 30 phút nằm sấp khi thức.' : 'Trẻ 1–4 tuổi: ít nhất 180 phút vận động mỗi ngày (từ 3 tuổi có ít nhất 60 phút vừa đến mạnh); không ngồi yên một chỗ quá 1 giờ liền.', 'WHO 2019']]);
  } else if (a.vd60 != null) {
    the('vd', c.vdThieu ? 'cy' : 'on', a.vd60 + '/7 ngày đủ 60 phút', [['Mục tiêu trung bình 60 phút mỗi ngày; thêm 3 buổi/tuần vận động mạnh, làm khoẻ cơ xương (chạy, bơi, nhảy dây).', 'WHO 2020']].concat(+a.vd_co < 3 ? [['Bài làm khoẻ cơ, xương mới có ' + a.vd_co + ' ngày/tuần — nên ít nhất 3 ngày.', 'WHO 2020']] : []));
  }
  // Ăn uống
  {
    const d = []; let muc = 'on';
    const rq = docSo(a.an_rq);
    if (Number.isFinite(rq)) { if (rq < 5) { muc = 'cy'; d.push(['Mới ' + thuongDau(nhanCau('an_rq', a.an_rq)) + ' rau quả mỗi ngày — nên đủ 5 phần (khoảng 400 g): thêm 1 phần rau mỗi bữa chính, 1 phần quả bữa phụ.', 'WHO — Ăn uống lành mạnh · Viện Dinh dưỡng']); } else d.push(['Rau quả đã đủ khoảng 5 phần mỗi ngày. Giữ thói quen này.', 'WHO — Ăn uống lành mạnh']); }
    if (+a.an_ngot >= 4.5 || +a.an_ngot_u5 >= 2) { muc = 'cy'; d.push(['Nước ngọt, trà sữa khá thường xuyên: đổi dần sang nước lọc, sữa không đường; đường tự do nên dưới 10% năng lượng.', 'WHO — Ăn uống lành mạnh']); }
    if (+a.an_man >= 2) { muc = 'cy'; d.push(['Hay ăn mặn: nêm nhạt dần, bớt chấm thêm; muối nên dưới 5 g/ngày (khoảng 1 thìa cà phê, tính cả nước mắm).', 'WHO — Ăn uống lành mạnh']); }
    if (a.an_sang != null && +a.an_sang < 5) { muc = 'cy'; d.push(['Bé ăn sáng ' + a.an_sang + '/7 ngày — bữa sáng giúp bé tập trung học; nên ăn sáng mỗi ngày.', 'Viện Dinh dưỡng']); }
    if (+a.an_nhanh >= 4.5) { muc = 'cy'; d.push(['Đồ chiên rán, snack khá nhiều trong tuần; thay một phần bằng trái cây, sữa chua.', 'Viện Dinh dưỡng']); }
    if (c.g === 'u5') {
      if (a.an_bu != null && c.thang < 6 && +a.an_bu === 0) { muc = 'cy'; d.push(['Dưới 6 tháng tuổi, sữa mẹ hoàn toàn là tốt nhất; trao đổi với bác sĩ nhi nếu gặp khó khăn khi cho bú.', 'WHO · Viện Dinh dưỡng']); }
      if (+a.an_rq_u5 >= 0 && +a.an_rq_u5 < 2 && a.an_rq_u5 != null && c.thang >= 6) { muc = 'cy'; d.push(['Cho bé ăn rau hoặc trái cây ở ít nhất 2 bữa mỗi ngày, nghiền hoặc cắt nhỏ theo tuổi.', 'Viện Dinh dưỡng']); }
    }
    if (!d.length) d.push(['Thói quen ăn uống đang ổn theo các câu trả lời.', 'WHO — Ăn uống lành mạnh']);
    the('an', muc, '', d);
  }
  // Giấc ngủ
  if (Number.isFinite(c.gio)) {
    const d = [['Khuyến nghị cho tuổi này: ' + c.kh[0] + '–' + c.kh[1] + ' giờ' + (c.g === 'u5' ? ' (tính cả ngủ trưa)' : '') + ' mỗi ngày.', c.thang < 60 ? 'WHO 2019 · AASM 2016' : laTre(c.g) ? 'AASM 2016' : 'AASM/SRS 2015 · NSF 2015']];
    let muc = c.nguThieu ? 'cy' : 'on';
    if (c.nguThieu) d.push(['Đi ngủ và thức dậy giờ cố định, cất điện thoại khỏi giường, tắt màn hình 1 giờ trước khi ngủ.', 'AASM']);
    if (+a.ngu_dt >= 2) { muc = 'cy'; d.push(['Mang điện thoại lên giường gần như mỗi tối: đặt "góc sạc" ngoài phòng ngủ.', 'AASM']); }
    if (+a.n_ngay >= 2) { muc = 'gap'; d.push(['Ngáy to hoặc có lúc như ngừng thở khi ngủ thường xuyên: nên gặp bác sĩ để được khám.', 'AASM — chờ chuyên gia duyệt câu chữ']); }
    the('ngu', muc, nhanCau(c.g === 'u5' ? 'ngu_u5' : 'ngu_gio', c.g === 'u5' ? a.ngu_u5 : a.ngu_gio) + ' mỗi ngày', d);
  }
  // Màn hình
  if (laTre(c.g) && (a.mh_thuong != null || a.mh_u5 != null)) {
    const d = c.g === 'u5'
      ? [[c.thang < 24 ? 'Dưới 2 tuổi: không cho bé xem màn hình thụ động; dành thời gian đọc truyện, trò chuyện.' : '2–4 tuổi: tối đa 1 giờ mỗi ngày, càng ít càng tốt, và người lớn xem cùng.', 'WHO 2019']]
      : [['Không đặt một con số cứng: thống nhất giờ dùng màn hình trong nhà, không để màn hình lấn giờ ngủ, giờ vận động; không để thiết bị trong phòng ngủ.', 'AAP — Kế hoạch dùng truyền thông gia đình']];
    if (+a.mh_phong === 1) d.push(['Đưa TV, điện thoại ra khỏi phòng ngủ của bé.', 'AAP']);
    the('mh', c.mhNhieu ? 'cy' : 'on', c.g === 'u5' ? nhanTl(LOI.find((x) => x.id === 'mh_u5'), a.mh_u5) + '/ngày' : thuongDau(nhanCau('mh_thuong', a.mh_thuong)) + ' ngày đi học · ' + (a.mh_nghi != null && a.mh_nghi !== '' ? thuongDau(nhanCau('mh_nghi', a.mh_nghi)) : 'chưa rõ') + ' ngày nghỉ', d);
  }
  // Tinh thần
  let hoTro = false;
  if (c.who5 != null || c.phq2 >= 0) {
    const d = []; let muc = 'on';
    if (c.who5 != null) { if (c.who5 < 13) { muc = 'cy'; d.push(['Chỉ số hạnh phúc WHO-5: ' + c.who5 + '/25 (dưới 13 là nên quan tâm). Dành thời gian nghỉ ngơi, làm điều mình thích, trò chuyện với người thân.', 'WHO-5 — ngưỡng 13 cần chuyên gia kiểm']); } else d.push(['Chỉ số hạnh phúc WHO-5: ' + c.who5 + '/25 — ở mức tốt.', 'WHO-5']); }
    if (c.phq2 >= 3 || c.gad2 >= 3) { muc = 'gap'; hoTro = true; d.push(['Điểm sàng lọc tâm trạng hoặc lo âu ở mức nên được đánh giá thêm. Đây không phải chẩn đoán — anh chị nên trao đổi với bác sĩ hoặc chuyên gia tâm lý' + (c.g === 'c12' ? ' (với bé, có thể bắt đầu từ chuyên viên tâm lý học đường)' : '') + '.', 'PHQ-2 ≥3 / GAD-2 ≥3 (Kroenke 2003, 2007)']); }
    if (c.g === 'c12') d.push(['Phần này bé từ 12 tuổi nên tự trả lời; kết quả chỉ nên xem khi bé đồng ý.', 'Báo cáo nghiên cứu §4.3']);
    the('tt', muc, (c.who5 != null ? 'WHO-5 ' + c.who5 + '/25 · ' : '') + 'PHQ-2 ' + Math.max(c.phq2, 0) + (c.gad2 >= 0 ? ' · GAD-2 ' + c.gad2 : ''), d);
  } else if (a.tt6 != null) {
    const m = +a.tt6 >= 2 ? 'gap' : +a.tt6 === 1 ? 'cy' : 'on';
    if (m === 'gap') hoTro = true;
    the('tt', m, '', [[m === 'on' ? 'Không thấy dấu hiệu buồn, lo kéo dài.' : m === 'cy' ? 'Lắng nghe và giúp bé gọi tên cảm xúc; để ý nếu kéo dài quá 2 tuần.' : 'Buồn, lo hoặc cáu kỉnh thường xuyên: nên trao đổi với bác sĩ nhi hoặc chuyên viên tâm lý học đường.', 'Tự soạn — chờ chuyên gia duyệt']]);
  }
  // Thuốc lá & rượu
  {
    const d = []; let muc = 'on';
    if (+a.khoi === 1) { muc = 'cy'; d.push(['Có người hút thuốc trong nhà: không có mức khói thuốc thụ động nào an toàn cho trẻ — hút ngoài trời, xa trẻ, và nên bỏ hẳn.', 'WHO']); }
    if (+a.hut >= 1 || +a.hut_teen === 1) { muc = 'cy'; d.push([c.g === 'c12' ? 'Bé có hút thuốc lá hoặc thuốc lá điện tử: trò chuyện cùng bé, không la mắng; có thể nhờ tư vấn học đường.' : 'Bỏ thuốc là việc tốt nhất cho sức khoẻ của anh chị và cả nhà; bác sĩ có thể hỗ trợ cai thuốc.', 'WHO']); }
    if (c.auditC >= 0) { if (c.auditC >= c.nguongAudit) { muc = 'cy'; d.push(['Điểm AUDIT-C ' + c.auditC + '/12 — ở mức uống có hại (ngưỡng ' + c.nguongAudit + ' với ' + (ng.gt === 'nam' ? 'nam' : 'nữ') + '). Đặt ngày không uống trong tuần, giảm số ly mỗi lần.', 'AUDIT-C (WHO)']); } else d.push(['Điểm AUDIT-C ' + c.auditC + '/12 — dưới ngưỡng nguy cơ.', 'AUDIT-C (WHO)']); }
    if (+a.r_lai >= 1) { muc = 'gap'; d.push(['Không lái xe sau khi uống rượu bia, dù chỉ một ly.', 'Luật Phòng, chống tác hại của rượu, bia 2019']); }
    if (+a.a_mt === 1) { muc = 'cy'; d.push(['Khi mang thai hoặc cho con bú, không uống rượu bia là an toàn nhất.', 'WHO']); }
    if (!d.length) d.push([a.khoi != null ? 'Không có khói thuốc trong nhà theo câu trả lời.' : 'Không có điểm nào cần chú ý theo các câu trả lời.', 'WHO']);
    the('th', muc, c.auditC >= 0 ? 'AUDIT-C ' + c.auditC + '/12' : '', d);
  }
  // Mốc phát triển
  if (a.moc != null) {
    const v = +a.moc; the('moc', v === 0 ? 'on' : v === 3 ? 'cy' : 'gap', '', [[v === 0 ? 'Bé đang đạt các mốc theo tuổi. Tiếp tục đối chiếu danh sách ở mỗi mốc tháng tuổi.' : v === 3 ? 'Anh chị xem Danh sách mốc phát triển của CDC (bản tiếng Việt) theo tháng tuổi của bé.' : 'Trao đổi với bác sĩ nhi sớm, mang theo danh sách mốc đã đánh dấu. Mất kỹ năng đã có là dấu hiệu cần khám ngay.', 'CDC "Learn the Signs. Act Early." — công cụ theo dõi, không phải sàng lọc chuẩn hoá']]);
  }
  return { the: out, coDo: c.coDo, hoTro, c };
};


