/**
 * Giao thức service worker ⇄ world MAIN (qua content-isolated): dựng LỆNH gọi portal + đọc KẾT
 * QUẢ trả về.
 *
 * Service worker chỉ dựng được ĐÚNG hai lệnh của allowlist (đặc tả GĐ5):
 *   GET  {portal}/api/auth/session
 *   POST {portal}/api/partners/merchant-portal/{merchantCode}/v2/transactions/search
 * world MAIN còn tự kiểm lại URL (khớp CHÍNH XÁC từng ký tự) trước khi gọi — hai lớp.
 *
 * Kết quả từ trang là dữ liệu NGOÀI service worker ⇒ `docKetQuaMain` kiểm kiểu từng trường;
 * thứ gì lạ ⇒ LOI/BAD_RESULT, không tin.
 */
import { DUONG_PHIEN_PORTAL, MERCHANT_RE, PORTAL_ORIGIN, duongTimKiem } from "./hang-so.js";
import type { CuaSo } from "./cua-so.js";
import { dinhDangGioVN, docIso } from "./gio-vn.js";
import type { NguonHetHan } from "./than-api.js";

export interface ThanTimKiem {
  page_index: number;
  page_size: number;
  transaction_time_from: string;
  transaction_time_to: string;
}

export type LenhGoi =
  | { loai: "GOI"; phuongThuc: "GET"; url: string; merchantCode: string }
  | { loai: "GOI"; phuongThuc: "POST"; url: string; merchantCode: string; than: ThanTimKiem };

function kiemMerchant(merchantCode: string): void {
  if (!MERCHANT_RE.test(merchantCode)) throw new Error("merchantCode sai định dạng — không dựng lệnh portal");
}

export function lenhPhien(merchantCode: string): LenhGoi {
  kiemMerchant(merchantCode);
  return { loai: "GOI", phuongThuc: "GET", url: `${PORTAL_ORIGIN}${DUONG_PHIEN_PORTAL}`, merchantCode };
}

export function lenhTimKiem(merchantCode: string, manh: CuaSo, pageIndex: number, pageSize: number): LenhGoi {
  kiemMerchant(merchantCode);
  return {
    loai: "GOI",
    phuongThuc: "POST",
    url: `${PORTAL_ORIGIN}${duongTimKiem(merchantCode)}`,
    merchantCode,
    than: {
      page_index: pageIndex,
      page_size: pageSize,
      transaction_time_from: dinhDangGioVN(manh.tu),
      transaction_time_to: dinhDangGioVN(manh.den),
    },
  };
}

/** Dấu header app trong trang — KHÔNG chứa header (chỉ mã trang + số lần bắt + cờ). */
export interface DauHeaderMain {
  maTrang: string;
  soBat: number;
  coHeader: boolean;
  thanMaHoa: boolean;
}

export type MaLoiMain =
  | "URL_BLOCKED"
  | "BAD_COMMAND"
  | "HEADER_NOT_CAPTURED"
  | "BODY_ENCRYPTED"
  | "PORTAL_HTTP_ERROR"
  | "PORTAL_BAD_SHAPE"
  | "NETWORK"
  | "MAIN_TIMEOUT"
  | "NO_RECEIVER"
  | "BAD_RESULT";

const MA_LOI_MAIN: readonly MaLoiMain[] = [
  "URL_BLOCKED",
  "BAD_COMMAND",
  "HEADER_NOT_CAPTURED",
  "BODY_ENCRYPTED",
  "PORTAL_HTTP_ERROR",
  "PORTAL_BAD_SHAPE",
  "NETWORK",
  "MAIN_TIMEOUT",
  "NO_RECEIVER",
  "BAD_RESULT",
];

export type KetQuaMain =
  | {
      loai: "PHIEN";
      httpStatus: number;
      coUser: boolean;
      hetHanLuc: string | null;
      nguonHetHan: NguonHetHan;
      dauHeader: DauHeaderMain | null;
    }
  | {
      loai: "TRANG";
      httpStatus: number;
      rows: unknown[];
      totalItems: unknown;
      pageIndex: number | null;
      dauHeader: DauHeaderMain | null;
    }
  | { loai: "HET_PHIEN"; httpStatus: 401 | 403; dauHeader: DauHeaderMain | null }
  | { loai: "CHUYEN_HUONG"; dauHeader: DauHeaderMain | null }
  | { loai: "LOI"; ma: MaLoiMain; httpStatus: number | null; dauHeader: DauHeaderMain | null };

export function loiMain(ma: MaLoiMain): KetQuaMain {
  return { loai: "LOI", ma, httpStatus: null, dauHeader: null };
}

function laObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function docDau(x: unknown): DauHeaderMain | null {
  if (!laObject(x)) return null;
  const { maTrang, soBat, coHeader, thanMaHoa } = x;
  if (typeof maTrang !== "string" || !/^[0-9a-f]{16,64}$/.test(maTrang)) return null;
  if (typeof soBat !== "number" || !Number.isInteger(soBat) || soBat < 0) return null;
  if (typeof coHeader !== "boolean" || typeof thanMaHoa !== "boolean") return null;
  return { maTrang, soBat, coHeader, thanMaHoa };
}

function docHttp(x: unknown): number | null {
  return typeof x === "number" && Number.isInteger(x) && x >= 100 && x <= 599 ? x : null;
}

export function docKetQuaMain(x: unknown): KetQuaMain {
  if (!laObject(x)) return loiMain("BAD_RESULT");
  const dau = docDau(x.dauHeader);
  switch (x.loai) {
    case "PHIEN": {
      const http = docHttp(x.httpStatus);
      if (http === null || typeof x.coUser !== "boolean") return loiMain("BAD_RESULT");
      const hetHanLuc = docIso(x.hetHanLuc) === null ? null : (x.hetHanLuc as string);
      const nguon = x.nguonHetHan === "ACCESS_TOKEN" || x.nguonHetHan === "SESSION" ? x.nguonHetHan : null;
      return { loai: "PHIEN", httpStatus: http, coUser: x.coUser, hetHanLuc, nguonHetHan: hetHanLuc ? nguon : null, dauHeader: dau };
    }
    case "TRANG": {
      const http = docHttp(x.httpStatus);
      if (http === null || !Array.isArray(x.rows)) return loiMain("BAD_RESULT");
      const pageIndex = typeof x.pageIndex === "number" && Number.isInteger(x.pageIndex) ? x.pageIndex : null;
      return { loai: "TRANG", httpStatus: http, rows: x.rows as unknown[], totalItems: x.totalItems, pageIndex, dauHeader: dau };
    }
    case "HET_PHIEN":
      if (x.httpStatus !== 401 && x.httpStatus !== 403) return loiMain("BAD_RESULT");
      return { loai: "HET_PHIEN", httpStatus: x.httpStatus, dauHeader: dau };
    case "CHUYEN_HUONG":
      return { loai: "CHUYEN_HUONG", dauHeader: dau };
    case "LOI": {
      const ma = MA_LOI_MAIN.find((m) => m === x.ma);
      return { loai: "LOI", ma: ma ?? "BAD_RESULT", httpStatus: docHttp(x.httpStatus), dauHeader: dau };
    }
    default:
      return loiMain("BAD_RESULT");
  }
}
