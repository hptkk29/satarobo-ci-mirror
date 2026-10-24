// lib/security/ip-cidr.ts — so khớp IP với danh sách IP / dải CIDR (IPv4 + IPv6). THUẦN, không chạm DB.
//
// Đầu vào IP nên đã qua `chuanHoaIp` (`ip-nguon-tin-cay.ts`): IPv4 ánh xạ IPv6 ("::ffff:1.2.3.4") về IPv4,
// IPv6 chữ thường. Hàm này vẫn tự chuẩn hoá để chỗ gọi quên cũng không so lệch.
import { chuanHoaIp } from "./ip-nguon-tin-cay";

type Muc = { loai: 4 | 6; goc: bigint; prefix: number };

function v4SangSo(ip: string): bigint | null {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  let n = BigInt(0);
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null;
    n = (n << BigInt(8)) | BigInt(Number(x));
  }
  return n;
}

function v6SangSo(ip: string): bigint | null {
  const s = ip.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(s) || (s.match(/::/g) ?? []).length > 1) return null;
  const [dau, cuoi] = s.includes("::") ? s.split("::") : [s, null];
  const nhom = (x: string) => (x ? x.split(":") : []);
  const a = nhom(dau!);
  const b = cuoi === null ? [] : nhom(cuoi);
  const thieu = 8 - a.length - b.length;
  if (cuoi === null ? a.length !== 8 : thieu < 1) return null;
  const tat = [...a, ...Array<string>(cuoi === null ? 0 : thieu).fill("0"), ...b];
  let n = BigInt(0);
  for (const g of tat) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

function ipSangSo(raw: string): { loai: 4 | 6; so: bigint } | null {
  const ip = chuanHoaIp(raw);
  if (!ip) return null;
  if (ip.includes(":")) {
    const so = v6SangSo(ip);
    return so === null ? null : { loai: 6, so };
  }
  const so = v4SangSo(ip);
  return so === null ? null : { loai: 4, so };
}

/** Một mục danh sách: IP đơn ("203.0.113.7", "2001:db8::1") hoặc dải ("203.0.113.0/24", "2001:db8::/48"). */
export function phanTichMucIp(raw: string): Muc | null {
  const s = raw.trim();
  if (!s) return null;
  const [ipPhan, prefixPhan, du] = s.split("/");
  if (du !== undefined) return null;
  const ip = ipSangSo(ipPhan!);
  if (!ip) return null;
  const toiDa = ip.loai === 4 ? 32 : 128;
  let prefix = toiDa;
  if (prefixPhan !== undefined) {
    if (!/^\d{1,3}$/.test(prefixPhan)) return null;
    prefix = Number(prefixPhan);
    if (prefix > toiDa) return null;
  }
  const bit = BigInt(toiDa - prefix);
  const goc = (ip.so >> bit) << bit; // bỏ phần host ⇒ "203.0.113.9/24" hiểu là cả dải /24
  return { loai: ip.loai, goc, prefix };
}

export function ipThuocMuc(ip: string, muc: string): boolean {
  const m = phanTichMucIp(muc);
  const x = ipSangSo(ip);
  if (!m || !x || m.loai !== x.loai) return false;
  const bit = BigInt((m.loai === 4 ? 32 : 128) - m.prefix);
  return (x.so >> bit) << bit === m.goc;
}

/** Mục ĐẦU TIÊN khớp (để ghi lại "khớp luật nào"), hoặc null. */
export function mucKhop(ip: string, danhSach: readonly string[]): string | null {
  return danhSach.find((m) => ipThuocMuc(ip, m)) ?? null;
}

/** Kiểm cả danh sách trước khi LƯU — trả câu lỗi cho mục sai đầu tiên, hoặc null. */
export function loiDanhSachIp(danhSach: readonly string[]): string | null {
  for (const m of danhSach) if (!phanTichMucIp(m)) return `“${m}” không phải IP hay dải CIDR hợp lệ`;
  return null;
}
