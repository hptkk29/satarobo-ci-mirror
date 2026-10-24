// lib/security/dong-deu-thoi-gian.ts — LỚP THỜI GIAN CHUNG của mọi đường công khai nhận SĐT của khách (R9 · N1, R10 · lane A).
//
// Luật: một đường CÔNG KHAI nhận SĐT không được để thời gian trả lời nói «SĐT này ĐÃ có trong CRM hay chưa». Nhánh «lead mới» (tạo lead + con + chia chủ) vốn lâu hơn nhánh «trùng» (chỉ ghi dấu vết), nên
// mọi nhánh đã chạm khách được kéo lên cùng một ngưỡng tối thiểu (+ nhiễu ngẫu nhiên) TRƯỚC khi trả lời. Ngưỡng chỉ có tác dụng khi phần việc thật NHỎ HƠN nó ở MỌI nhánh — nếu một nhánh vượt ngưỡng
// thì chính nhánh đó lộ ra bằng độ chậm, nên lượt vượt ngưỡng được GHI LOG (không PII) để người vận hành thấy trước khi ai đó khai thác.
//
// ── Vì sao 700 ms + 0..150 ms (đo 18/10/2026, `tests/lead-intake/affiliate-intake-do-tre.spec.ts`, Postgres local, đồng hồ thật, 300 mẫu/nhánh) ─
//   phần việc thật của nhánh CHẬM NHẤT («lead mới»): p99 = 66 ms (một mình) · 100 ms (8 lượt đồng thời) · 227 ms (24 lượt đồng thời); max 232 ms.
//   Ngưỡng 700 ms ≥ 3,1× p99 ở mức đồng thời cao nhất đã đo và ≥ 10× ở mức bình thường. Đổi con số này là đổi quyết định bảo mật: đo lại bằng bộ đo trên trước.
export const DO_TRE_TOI_THIEU_MS = 700;
export const DO_TRE_NHIEU_TOI_DA_MS = 150;

export type PhuThuocThoiGian = {
  now: () => Date;
  /** Chờ `ms` mili giây. BẮT BUỘC khai (luật 7): bỏ trống là mất lớp thời gian chung — test truyền hàm ghi nhận để khẳng định, không chờ thật. */
  cho: (ms: number) => Promise<void>;
  /** Nhiễu 0..`DO_TRE_NHIEU_TOI_DA_MS`. Tách ra để test cố định được. */
  nhieuMs: () => number;
};

export function phuThuocThoiGianThat(): PhuThuocThoiGian {
  return {
    now: () => new Date(),
    cho: (ms) => new Promise((xong) => setTimeout(xong, ms)),
    nhieuMs: () => Math.floor(Math.random() * (DO_TRE_NHIEU_TOI_DA_MS + 1)),
  };
}

/**
 * Chờ cho đủ `DO_TRE_TOI_THIEU_MS` (+ nhiễu) kể từ `batDau` (ms epoch). Đã chậm hơn ngưỡng thì không chờ thêm — và GHI LOG (nhãn đường, số ms; KHÔNG SĐT/tên/IP) vì đó là lúc nhánh này lộ ra bằng độ chậm.
 * Trả `true` nếu đã phải chờ, `false` nếu phần việc thật đã vượt ngưỡng.
 */
export async function denNguongThoiGian(pt: PhuThuocThoiGian, batDau: number, duong: string): Promise<boolean> {
  const daQua = pt.now().getTime() - batDau;
  const conLai = DO_TRE_TOI_THIEU_MS + pt.nhieuMs() - daQua;
  if (conLai > 0) {
    await pt.cho(conLai);
    return true;
  }
  console.warn(`[dong-deu-thoi-gian] ${duong}: phần việc thật ${Math.round(daQua)} ms đã VƯỢT ngưỡng ${DO_TRE_TOI_THIEU_MS} ms — nhánh này đang lộ bằng độ chậm`);
  return false;
}
