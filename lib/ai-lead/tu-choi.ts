import "server-only";
// lib/ai-lead/tu-choi.ts — BỘ ĐẾM yêu cầu bị TỪ CHỐI (400/401/429…) của Gateway, thiết kế RIÊNG TƯ.
//
// Vì sao không «nhật ký từng yêu cầu»: một yêu cầu bị từ chối chưa qua chữ ký thì mọi thứ trong nó đều do KẺ LẠ tự khai (IP, header, thân, agentId). Lưu từng dòng là biến bảng thành nơi
// cất dữ liệu không rõ nguồn gốc (có thể chứa SĐT/PSID dán nhầm, chuỗi chữ ký thử, bí mật xác thực) và là mục tiêu làm đầy đĩa. Ở đây chỉ giữ SỐ ĐẾM GỘP:
//     (ngày VN · endpoint · mã lỗi · agentId) → count, firstAt, lastAt
//   · `endpoint` thuộc tập 5 giá trị cố định, `code` thuộc 18 mã của hợp đồng ⇒ độ lớn bị chặn, không thể bị kẻ gọi làm phình.
//   · `agentId` CHỈ có khi chữ ký ĐÃ ĐÚNG (agent thật, đang bị từ chối ở bước sau chữ ký: CLOCK_SKEW, AGENT_DISABLED, RATE_LIMITED, PAYLOAD_INVALID…). Chưa xác thực ⇒ '' — KHÔNG BAO GIỜ lưu id do kẻ gọi khai.
//   · KHÔNG IP, KHÔNG header, KHÔNG thân, KHÔNG chữ ký/nonce, KHÔNG PSID/Page. Hàm ghi nhận chỉ NHẬN (endpoint, code, agentId|null, nowMs) — không có tham số nào để lọt thêm dữ liệu.
//
// Hiệu năng/độ bền: ghi vào BỘ ĐỆM trong tiến trình (đồng bộ, không chờ DB, không ném lỗi) rồi XẢ định kỳ bằng upsert tăng dần — một đợt tấn công gửi hàng nghìn yêu cầu sai chỉ sinh ≤ vài chục
// phép ghi mỗi lần xả (số khoá khác nhau), không phải hàng nghìn. Tiến trình chết trước khi xả ⇒ mất phần đệm (chấp nhận: đây là số ĐO, không phải sổ). Cờ `ai.rejectLogEnabled` TẮT ⇒ không ghi gì.
import { db } from "@/lib/db";
import type { MaLoi, TenEndpoint } from "./hop-dong";
import { maLoiNoiBo } from "./loi-he-thong";
import { ngayVnLaDate } from "./ngay-vn";

/** Trần số khoá trong bộ đệm (5 endpoint × 18 mã × (agent + 1) ≪ trần này); vượt ⇒ bỏ phần thừa và đếm `daRoi`, không phình bộ nhớ. */
export const TRAN_KHOA_DEM = 500;
/** Sau lời ghi đầu tiên của một cửa sổ gom, đợi chừng này rồi xả bằng HẸN GIỜ (không cần có yêu cầu hỏng tiếp theo). Cron còn xả riêng mỗi 10 phút. */
export const KHOANG_XA_MS = 15_000;

type Dem = { n: number; dauMs: number; cuoiMs: number };
export type KhoaTuChoi = { day: Date; endpoint: string; code: string; agentId: string };

type TrangThai = { dem: Map<string, Dem>; daRoi: number; dangXa: boolean; henGio: ReturnType<typeof setTimeout> | null };

/**
 * Trạng thái cấp TIẾN TRÌNH qua `globalThis` (khuôn `lib/rate-limit.ts`): Next đóng gói từng điểm vào (năm route Gateway, route cron) riêng và mỗi bên nạp MỘT BẢN module — `new Map()` cấp module
 * thì route cron xả bộ đệm RỖNG của chính nó còn các lời ghi nằm mãi trong bản của route Gateway. `[AIL-TC-07]` nạp hai bản module và đòi chúng thấy cùng một bộ đệm.
 */
const KHOA_TIEN_TRINH = Symbol.for("satarobo.ai-lead.tu-choi");
function tt(): TrangThai {
  const g = globalThis as { [k: symbol]: TrangThai | undefined };
  return (g[KHOA_TIEN_TRINH] ??= { dem: new Map(), daRoi: 0, dangXa: false, henGio: null });
}

const khoaChuoi = (k: KhoaTuChoi) => `${k.day.getTime()}|${k.endpoint}|${k.code}|${k.agentId}`;
const giaiKhoa = (s: string): KhoaTuChoi => {
  const [d, endpoint, code, ...rest] = s.split("|");
  return { day: new Date(Number(d)), endpoint: endpoint!, code: code!, agentId: rest.join("|") };
};

/** Đặt MỘT hẹn giờ xả (không chồng), không giữ tiến trình sống. Còn gì trong bộ đệm mà chưa có hẹn giờ thì gọi lại hàm này. */
function henGioXa(s: TrangThai): void {
  if (s.henGio !== null || s.dem.size === 0) return;
  const h = setTimeout(() => {
    s.henGio = null;
    void xaBoDem().catch(() => undefined);
  }, KHOANG_XA_MS);
  (h as { unref?: () => void }).unref?.();
  s.henGio = h;
}

/**
 * Ghi nhận MỘT lần từ chối. ĐỒNG BỘ, không chờ DB, KHÔNG BAO GIỜ ném lỗi (đang nằm trên đường trả lời lỗi cho Agent).
 * `batGhi` = `ai.rejectLogEnabled` đã đọc ở nơi gọi; tắt ⇒ return ngay (không chạm bộ đệm).
 * `agentId` chỉ truyền khi chữ ký đã đúng (xem đầu tệp).
 */
export function ghiNhanTuChoi(x: { batGhi: boolean; endpoint: TenEndpoint; ma: MaLoi; agentId: string | null; nowMs: number }): void {
  if (!x.batGhi) return;
  try {
    const s = tt();
    const khoa = khoaChuoi({ day: ngayVnLaDate(x.nowMs), endpoint: x.endpoint, code: x.ma, agentId: x.agentId ?? "" });
    const co = s.dem.get(khoa);
    if (co) {
      co.n += 1;
      co.cuoiMs = x.nowMs;
    } else if (s.dem.size >= TRAN_KHOA_DEM) {
      s.daRoi += 1;
    } else {
      s.dem.set(khoa, { n: 1, dauMs: x.nowMs, cuoiMs: x.nowMs });
    }
    henGioXa(s);
  } catch {
    /* đo đạc không được làm hỏng đường trả lời */
  }
}

/**
 * Xả bộ đệm xuống DB bằng upsert tăng dần. Lỗi DB ⇒ trả phần chưa ghi về bộ đệm (không vượt trần), hẹn xả lại, và chỉ log MÃ. Trả số khoá đã ghi.
 * Gọi từ hẹn giờ (sau `KHOANG_XA_MS` kể từ lời ghi đầu của cửa sổ) và từ cron (xả cưỡng bức).
 */
export async function xaBoDem(): Promise<number> {
  const s = tt();
  if (s.dangXa || s.dem.size === 0) return 0;
  s.dangXa = true;
  if (s.henGio !== null) {
    clearTimeout(s.henGio);
    s.henGio = null;
  }
  const lo = [...s.dem.entries()];
  s.dem.clear();
  let daGhi = 0;
  try {
    for (const [chuoi, d] of lo) {
      const k = giaiKhoa(chuoi);
      try {
        await db.aiLeadRejectCounter.upsert({
          where: { day_endpoint_code_agentId: { day: k.day, endpoint: k.endpoint, code: k.code, agentId: k.agentId } },
          create: { day: k.day, endpoint: k.endpoint, code: k.code, agentId: k.agentId, count: d.n, firstAt: new Date(d.dauMs), lastAt: new Date(d.cuoiMs) },
          update: { count: { increment: d.n }, lastAt: new Date(d.cuoiMs) },
        });
        daGhi += 1;
      } catch (err) {
        console.error(`[ai-lead:tu-choi] xả lỗi=${maLoiNoiBo(err)}`);
        if (s.dem.size < TRAN_KHOA_DEM) {
          const moi = s.dem.get(chuoi);
          if (moi) {
            moi.n += d.n;
            moi.dauMs = Math.min(moi.dauMs, d.dauMs);
          } else s.dem.set(chuoi, d);
        }
      }
    }
  } finally {
    s.dangXa = false;
    henGioXa(s); // còn phần trả về (lỗi DB) hoặc lời ghi mới trong lúc xả ⇒ hẹn lần sau
  }
  return daGhi;
}

/** Xoá bộ đếm cũ hơn `giuNgay` ngày (tính theo ngày VN). Trả số dòng đã xoá. */
export async function donBoDemCu(nowMs: number, giuNgay: number): Promise<number> {
  const moc = new Date(ngayVnLaDate(nowMs).getTime() - giuNgay * 24 * 3_600_000);
  const r = await db.aiLeadRejectCounter.deleteMany({ where: { day: { lt: moc } } });
  return r.count;
}

export type TuChoiTheoAgent = { tong: number; theoMa: { ma: string; n: number }[] };

/**
 * Số từ chối trong 24 giờ gần nhất (= hôm nay + hôm qua theo ngày VN, xấp xỉ bằng ngày vì bộ đếm gộp theo ngày) cho từng Agent, và riêng phần CHƯA xác thực (`agentId = ''`, mọi Agent chung).
 * Đọc thẳng DB; phần còn trong bộ đệm chưa xả KHÔNG tính (cron xả mỗi 10 phút).
 */
export async function docTuChoiGanDay(nowMs: number): Promise<{ theoAgent: Map<string, TuChoiTheoAgent>; chuaXacThuc: TuChoiTheoAgent }> {
  const homQua = new Date(ngayVnLaDate(nowMs).getTime() - 24 * 3_600_000);
  const dong = await db.aiLeadRejectCounter.findMany({ where: { day: { gte: homQua } }, select: { code: true, agentId: true, count: true } });
  const gop = (ds: typeof dong): TuChoiTheoAgent => {
    const m = new Map<string, number>();
    for (const d of ds) m.set(d.code, (m.get(d.code) ?? 0) + d.count);
    return { tong: [...m.values()].reduce((a, b) => a + b, 0), theoMa: [...m.entries()].map(([ma, n]) => ({ ma, n })).sort((a, b) => b.n - a.n) };
  };
  const theoAgent = new Map<string, TuChoiTheoAgent>();
  for (const id of new Set(dong.filter((d) => d.agentId !== "").map((d) => d.agentId))) theoAgent.set(id, gop(dong.filter((d) => d.agentId === id)));
  return { theoAgent, chuaXacThuc: gop(dong.filter((d) => d.agentId === "")) };
}

/** Chỉ cho test: xem/đặt lại trạng thái bộ đệm. */
export const choTest = {
  kichThuoc: () => tt().dem.size,
  daRoi: () => tt().daRoi,
  coHenGio: () => tt().henGio !== null,
  datLai: () => {
    const s = tt();
    if (s.henGio !== null) clearTimeout(s.henGio);
    s.henGio = null;
    s.dem.clear();
    s.daRoi = 0;
    s.dangXa = false;
  },
};
