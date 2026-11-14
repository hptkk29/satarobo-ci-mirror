/**
 * THANH KHUNG GIỜ — xếp các case của một lớp trải nghiệm lên trục thời gian.
 *
 * Bài toán có thật (chủ dự án 23/09/2026): ngày 23/09 lớp mở 17:30–21:00; Sale 1 có một
 * case 18:00–19:00, Sale 2 có hai case 17:30–18:30 và 19:00–20:00. Ba case CHỒNG LẤN
 * nhau. Một danh sách dọc trả lời được "có mấy case" nhưng không trả lời được câu người
 * xếp lịch thật sự hỏi: **"19:00 còn chỗ không, và ai đang ở đó?"**
 *
 * Nên trục thời gian không phải trang trí — nó là thứ duy nhất trên màn trả lời được câu
 * đó trong một cái liếc. Mọi phép tính nằm ở đây, THUẦN, không đụng DOM: component chỉ
 * việc đổ `left`/`width` ra `style` và `lane` ra grid row.
 *
 * ⚠️ KHÔNG đọc đồng hồ ở tệp này (luật 19) và không nhận `Date` — chỉ "HH:MM". Giờ của
 * case là chuỗi người gõ, không phải mốc thời gian thật; quy nó về `Date` là mời múi giờ
 * vào một phép tính không cần tới múi giờ.
 */
import { phutTuHhmm, type KhungGio } from "./lop-moi";

export type CaseXepLan<T> = {
  item: T;
  /** % từ mép trái của thanh, đã kẹp trong [0, 100]. */
  left: number;
  /** % chiều rộng, tối thiểu `RONG_TOI_THIEU` để case 15 phút vẫn bấm được. */
  width: number;
  /** Làn ngang, 0 là trên cùng. Hai case chồng giờ KHÔNG bao giờ chung làn. */
  lane: number;
  /** Case nằm (một phần) ngoài khung lớp — dữ liệu cũ hoặc lớp không có khung. */
  ngoaiKhung: boolean;
};

/**
 * Case ngắn nhất vẫn phải bấm được. 2% của thanh 900px là 18px — hẹp nhưng còn thấy;
 * dưới nữa thì thanh biến thành một đường kẻ và người dùng không trỏ trúng.
 */
const RONG_TOI_THIEU = 2;

function kep(x: number, thap: number, cao: number): number {
  return Math.min(cao, Math.max(thap, x));
}

/**
 * Xếp danh sách case lên thanh.
 *
 * Trả về MẢNG RỖNG khi không đọc được khung lớp — người gọi dùng đúng điều kiện đó để
 * không vẽ thanh, thay vì vẽ một thanh mà mọi case đều nằm ở 0%.
 */
export function xepLenThanh<T extends { startTime: string; endTime: string }>(
  khung: KhungGio | null,
  ds: readonly T[],
): CaseXepLan<T>[] {
  if (!khung) return [];
  const moc = phutTuHhmm(khung.startTime);
  const het = phutTuHhmm(khung.endTime);
  if (moc === null || het === null || het <= moc) return [];
  const tong = het - moc;

  // Sắp theo giờ bắt đầu TRƯỚC khi chia làn: thuật toán chia làn dưới đây chỉ đúng khi
  // đầu vào đã sắp. Sắp bản sao — đừng đụng vào mảng của người gọi.
  const sapXep = [...ds]
    .map((item) => ({ item, bd: phutTuHhmm(item.startTime), kt: phutTuHhmm(item.endTime) }))
    .filter((r): r is { item: T; bd: number; kt: number } => r.bd !== null && r.kt !== null)
    .sort((a, b) => a.bd - b.bd || a.kt - b.kt);

  /** Giờ kết thúc muộn nhất đang chiếm mỗi làn. Làn đầu tiên rảnh thì nhận case. */
  const ketLan: number[] = [];
  const out: CaseXepLan<T>[] = [];

  for (const r of sapXep) {
    let lane = ketLan.findIndex((k) => k <= r.bd);
    if (lane === -1) {
      lane = ketLan.length;
      ketLan.push(r.kt);
    } else {
      ketLan[lane] = r.kt;
    }

    const traiTho = ((r.bd - moc) / tong) * 100;
    const rongTho = ((r.kt - r.bd) / tong) * 100;
    const left = kep(traiTho, 0, 100);
    // Kẹp phải TRƯỚC khi áp sàn: case tràn mép phải phải dừng ở 100%, còn case ngắn thì
    // mới được nới ra cho bấm được. Làm ngược lại là case cuối thò ra ngoài thanh.
    const width = Math.max(RONG_TOI_THIEU, kep(rongTho, 0, 100 - left));

    out.push({
      item: r.item,
      left,
      width,
      lane,
      ngoaiKhung: r.bd < moc || r.kt > het,
    });
  }
  return out;
}

/** Số làn cần để vẽ (0 khi không có case nào). Component dùng nó để đặt chiều cao. */
export function soLan<T>(xep: readonly CaseXepLan<T>[]): number {
  return xep.reduce((max, c) => Math.max(max, c.lane + 1), 0);
}

/**
 * Các mốc giờ TRÒN để kẻ vạch và ghi nhãn trên thanh.
 *
 * `buoc` phút một vạch. Chỉ lấy mốc chia hết cho bước và NẰM TRONG khung — kẻ vạch
 * 17:00 cho một lớp bắt đầu 17:30 là vẽ một mốc không tồn tại.
 */
export function mocGio(khung: KhungGio | null, buoc = 30): { phut: number; left: number; nhan: string }[] {
  if (!khung || buoc <= 0) return [];
  const moc = phutTuHhmm(khung.startTime);
  const het = phutTuHhmm(khung.endTime);
  if (moc === null || het === null || het <= moc) return [];
  const tong = het - moc;

  const out: { phut: number; left: number; nhan: string }[] = [];
  const dau = Math.ceil(moc / buoc) * buoc;
  for (let p = dau; p <= het; p += buoc) {
    out.push({
      phut: p,
      left: ((p - moc) / tong) * 100,
      nhan: `${String(Math.floor(p / 60)).padStart(2, "0")}:${String(p % 60).padStart(2, "0")}`,
    });
  }
  return out;
}
