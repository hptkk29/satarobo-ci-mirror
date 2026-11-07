// tests/disc-db/_hanh-trinh.ts — đồ dùng cho các bộ HÀNH TRÌNH ĐẦU-CUỐI với ENGINE THẬT (không engine giả, không mock DB).
// Gọi thẳng các HÀM XỬ LÝ route thật (POST /api/disc/bo-de · /luu · /tai) bằng `Request` thật; dữ liệu 100% GIẢ.
import { POST as boDePOST } from "../../app/api/disc/bo-de/route";
import { POST as luuPOST } from "../../app/api/disc/luu/route";
import { POST as taiPOST } from "../../app/api/disc/tai/route";
import type { BoDeChoKhach } from "../../lib/disc/engine";
import { namHienTaiVN } from "../../lib/disc/ho-so";

export const MA_OTP_TEST = "123456";
/** Bật cờ DISC + cửa OTP cố định (CHỈ ngoài production; OTP_TEST_FIXED_CODE bị `lib/otp/service.ts` cấm ở production). */
export function batMoiTruongThu(): void {
  process.env.DISC_ENABLED = "true";
  process.env.OTP_TEST_FIXED_CODE = MA_OTP_TEST;
}

let ipSeq = 0;
/** IP tài liệu (RFC 5737) khác nhau mỗi lời gọi ⇒ không dính trần tần suất theo IP của route. */
export const ipMoi = () => `203.0.113.${(ipSeq = (ipSeq % 250) + 1)}`;

type Handler = (req: Request) => Promise<Response>;
export async function goi(handler: Handler, duongDan: string, body: unknown, ip = ipMoi()): Promise<{ status: number; json: Record<string, unknown>; res: Response }> {
  const res = await handler(
    new Request(`http://localhost${duongDan}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
  let json: Record<string, unknown> = {};
  if ((res.headers.get("content-type") ?? "").includes("json")) json = (await res.clone().json()) as Record<string, unknown>;
  return { status: res.status, json, res };
}

export const goiBoDe = (b: unknown, ip?: string) => goi(boDePOST, "/api/disc/bo-de", b, ip);
export const goiLuu = (b: unknown, ip?: string) => goi(luuPOST, "/api/disc/luu", b, ip);
export const goiTai = (b: unknown, ip?: string) => goi(taiPOST, "/api/disc/tai", b, ip);

export const namNay = () => namHienTaiVN(new Date());

export async function layBoDe(vai: "PH" | "HS", namSinh: number, bacHoc?: string): Promise<BoDeChoKhach> {
  const r = await goiBoDe(vai === "PH" ? { vai, namSinh } : { vai, namSinh, bacHoc });
  if (r.status !== 200 || r.json.ok !== true) throw new Error(`bo-de lỗi ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.boDe as BoDeChoKhach;
}

/** Câu trả lời HỢP LỆ, có biến thiên (đi qua hàng rào "trả lời phẳng"): chu kỳ 1..mức tối đa của CHÍNH thang bộ đề. */
export function traLoiBienThien(bo: BoDeChoKhach, lech = 0): Record<string, number> {
  const max = Math.max(...(bo.thang ?? []).map((m) => m.gia));
  const out: Record<string, number> = {};
  bo.cauHoi.forEach((c, i) => {
    out[c.id] = ((i + lech) % max) + 1;
  });
  return out;
}

/** Toàn bộ chọn một mức giữa ⇒ HL-1 (trả lời phẳng). */
export function traLoiPhang(bo: BoDeChoKhach): Record<string, number> {
  const max = Math.max(...(bo.thang ?? []).map((m) => m.gia));
  return Object.fromEntries(bo.cauHoi.map((c) => [c.id, Math.ceil(max / 2)]));
}

export type HoSoMau = { namPh?: number; namHs?: number; bacHoc?: string; tenPh?: string; tenHs?: string; vaiTro?: string };
export const TEN_PH = "DISCDB Nguyễn Thị Hạnh-Test";
export const TEN_HS = "Lê Minh Bảo-Kiểm-Thử";

export function hoSoCua(o: HoSoMau = {}) {
  return {
    phuHuynh: { hoTen: o.tenPh ?? TEN_PH, vaiTro: o.vaiTro ?? "ME", namSinh: o.namPh ?? 1988 },
    hocSinh: { hoTen: o.tenHs ?? TEN_HS, namSinh: o.namHs ?? namNay() - 10, bacHoc: o.bacHoc ?? "4" },
  };
}

/** Lấy bộ đề thật cho cả hai người rồi dựng thân yêu cầu `/api/disc/luu` hoàn chỉnh. */
export async function dungYeuCauLuu(
  sdt: string,
  o: HoSoMau & { key: string; email?: string | null; tiepThi?: boolean; chienDich?: string; lech?: number },
) {
  const hs = hoSoCua(o);
  const boPh = await layBoDe("PH", hs.phuHuynh.namSinh);
  const boHs = await layBoDe("HS", hs.hocSinh.namSinh, hs.hocSinh.bacHoc);
  const body = {
    idempotencyKey: o.key,
    soDienThoai: sdt,
    email: o.email ?? null,
    dongY: { xuLyHoSo: true, tiepThi: o.tiepThi ?? false },
    ...hs,
    bai: {
      phuHuynh: { maBoDe: boPh.ma, traLoi: traLoiBienThien(boPh, o.lech ?? 0) },
      hocSinh: { maBoDe: boHs.ma, traLoi: traLoiBienThien(boHs, (o.lech ?? 0) + 1) },
    },
    ...(o.chienDich ? { chienDich: o.chienDich } : {}),
  };
  return { body, boPh, boHs };
}
