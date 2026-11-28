/**
 * E-LEARNING ONLINE — MÃ ĐÁP ÁN MỜ cho MỘT lượt làm bài (V10.2). HÀM THUẦN (nguồn ngẫu nhiên truyền vào).
 *
 * LỖ ĐÃ ĐO (Q-TYPES phát hiện 22/11/2026, xác nhận bằng đọc kiemCauMoRong + veCauMoRong): mã lựa chọn của ghép cặp / sắp xếp / phân loại đặt theo KHUÔN ĐOÁN ĐƯỢC
 * (ghép cặp l{i}→r{i}, sắp xếp s1..sn ĐÚNG THỨ TỰ, phân loại c{k}/g{k} theo thứ tự nhóm, nhiễu d*) và veCauMoRong GỬI CHÚNG xuống học viên. Xáo thứ tự hiển thị không che được
 * đáp án khi chính mã nằm trong dữ liệu: ai mở công cụ nhà phát triển đều đọc ra cặp đúng / thứ tự đúng.
 *
 * Cách vá — ở ĐÚNG MỘT ranh giới (lúc tạo bản chụp đề của lượt, batDauLamBai): đổi MỌI mã lựa chọn của ba dạng này thành mã NGẪU NHIÊN riêng của lượt và xáo ngẫu nhiên thứ tự
 * danh sách trong bản chụp; key được ánh xạ theo. Mọi nơi dùng bản chụp sau đó (kiểm đáp án nháp, chấm, chấm lại D5, hiện đáp án theo D6) vẫn đọc CÙNG một bản chụp nên
 * KHÔNG đổi một dòng nào — và học viên chỉ thấy mã không mang thông tin. Lượt ĐÃ bắt đầu trước bản vá giữ bản chụp cũ (đã đóng băng): chấm đúng như cũ, không ép đổi mã giữa chừng.
 */

type Obj = Record<string, unknown>;
const laObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
type Dong = { id: string; text: string };
const laDong = (x: unknown): x is Dong => laObj(x) && typeof x.id === "string" && typeof x.text === "string";
const dsDong = (x: unknown): Dong[] | null => (Array.isArray(x) && x.every(laDong) ? (x as Dong[]) : null);

export type NguonMo = {
  /** Sinh MỘT mã mới (người gọi bảo đảm không trùng bằng nguồn đủ dài). */
  sinhMa: () => string;
  /** Xáo thứ tự (Fisher–Yates với nguồn ngẫu nhiên thật ở máy chủ). */
  xao: <T>(ds: readonly T[]) => T[];
};

/** Bản chụp của MỘT câu: chỉ cần ba trường này (khớp CauHoiSnapshot). */
export type CauTho = { type: string; options: unknown; key: unknown };

/** Đổi mã lựa chọn + xáo thứ tự cho ghép cặp / sắp xếp / phân loại; dạng khác hoặc dữ liệu hỏng ⇒ trả NGUYÊN (không đổi, không ném). */
export function lamMoMaCau(q: CauTho, o: NguonMo): { options: unknown; key: unknown } {
  const opt = laObj(q.options) ? q.options : null;
  const key = laObj(q.key) ? q.key : null;
  if (!opt || !key) return { options: q.options, key: q.key };
  const doiMa = (ds: Dong[], bang: Map<string, string>) =>
    o.xao(
      ds.map((d) => {
        const moi = o.sinhMa();
        bang.set(d.id, moi);
        return { ...d, id: moi };
      }),
    );
  const tra = (m: Map<string, string>, id: unknown) => (typeof id === "string" ? (m.get(id) ?? id) : id);

  if (q.type === "MATCHING") {
    const trai = dsDong(opt.left);
    const phai = dsDong(opt.right);
    const cap = laObj(key.pairs) ? (key.pairs as Record<string, unknown>) : null;
    if (!trai || !phai || !cap) return { options: q.options, key: q.key };
    const mt = new Map<string, string>();
    const mp = new Map<string, string>();
    const options = { ...opt, left: doiMa(trai, mt), right: doiMa(phai, mp) };
    return { options, key: { ...key, pairs: Object.fromEntries(Object.entries(cap).map(([l, r]) => [tra(mt, l) as string, tra(mp, r)])) } };
  }
  if (q.type === "ORDERING") {
    const muc = dsDong(opt.items);
    const thuTu = Array.isArray(key.order) ? (key.order as unknown[]) : null;
    if (!muc || !thuTu) return { options: q.options, key: q.key };
    const m = new Map<string, string>();
    return { options: { ...opt, items: doiMa(muc, m) }, key: { ...key, order: thuTu.map((id) => tra(m, id)) } };
  }
  if (q.type === "CLASSIFY") {
    const nhom = dsDong(opt.groups);
    const the = dsDong(opt.cards);
    const bang = laObj(key.map) ? (key.map as Record<string, unknown>) : null;
    if (!nhom || !the || !bang) return { options: q.options, key: q.key };
    const mn = new Map<string, string>();
    const mt = new Map<string, string>();
    const options = { ...opt, groups: doiMa(nhom, mn), cards: doiMa(the, mt) };
    return { options, key: { ...key, map: Object.fromEntries(Object.entries(bang).map(([c, g]) => [tra(mt, c) as string, tra(mn, g)])) } };
  }
  return { options: q.options, key: q.key };
}
