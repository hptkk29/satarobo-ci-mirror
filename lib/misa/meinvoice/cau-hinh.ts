// lib/misa/meinvoice/cau-hinh.ts — đọc cấu hình cổng MISA meInvoice từ env. THUẦN.
//
// Khác hẳn `lib/misa/service.ts` (MISA AMIS KẾ TOÁN — MISA_API_URL/MISA_CLIENT_ID…): đây là sản
// phẩm meInvoice (hoá đơn điện tử), bộ biến riêng tiền tố `MISA_EINVOICE_*`.
//
// Luật chống trỏ nhầm (hoá đơn phát hành là chứng từ THUẾ, không xoá được):
//   · "sandbox"    chỉ nhận host `testapi.meinvoice.vn`.
//   · "production" TỪ CHỐI mọi host có chữ "test", và chỉ nhận host thuộc `meinvoice.vn`.
//   · Cả hai: https, đường dẫn đúng `/api/v3` (BaseURL tài liệu công bố).
//   · Thiếu biến / sai giá trị ⇒ coi như TẮT, và nói rõ TÊN biến — KHÔNG BAO GIỜ in giá trị.
//
// Nguồn BaseURL: https://doc.meinvoice.vn/api/index.html
//   test = https://testapi.meinvoice.vn/api/v3 · production = https://api.meinvoice.vn/api/v3

export type CheDoMisa = "off" | "gia-lap" | "sandbox" | "production";

/**
 * "Kiểu doanh nghiệp" của MISA — quyết định đường dẫn API (`/code/...` hay không). Tài liệu chia
 * MỌI endpoint theo cột này ("Không mã" / "Có mã"), vd
 * https://doc.meinvoice.vn/api/Document/InvoicePublishHSM.html
 * Phải KHAI vì `traCuu(refId, mst)` không mang ký hiệu nên không suy được từ chữ C/K.
 */
export type LoaiHoaDonMisa = "co-ma" | "khong-ma";

export type CauHinhHsm = {
  cheDo: "sandbox" | "production";
  /** Đã bỏ dấu `/` cuối, vd "https://testapi.meinvoice.vn/api/v3". */
  baseUrl: string;
  appId: string;
  username: string;
  password: string;
  loaiHoaDon: LoaiHoaDonMisa;
};

export type CauHinhMisa = { cheDo: "gia-lap" } | CauHinhHsm;

export type KetQuaDocCauHinh = {
  /** Chế độ người vận hành KHAI (sai giá trị ⇒ "off"). */
  cheDoKhai: CheDoMisa;
  /** null = tắt (khai off, hoặc khai bật mà thiếu/sai biến). */
  cauHinh: CauHinhMisa | null;
  /** TÊN các biến thiếu — không bao giờ giá trị. */
  thieu: string[];
  /** Câu lỗi cho người vận hành (không chứa giá trị secret), null = không lỗi. */
  loi: string | null;
};

export type EnvMisa = Readonly<Record<string, string | undefined>>;

export const BIEN_MISA = {
  MODE: "MISA_EINVOICE_MODE",
  BASE_URL: "MISA_EINVOICE_BASE_URL",
  APP_ID: "MISA_EINVOICE_APP_ID",
  USERNAME: "MISA_EINVOICE_USERNAME",
  PASSWORD: "MISA_EINVOICE_PASSWORD",
  LOAI_HOA_DON: "MISA_EINVOICE_LOAI_HOA_DON",
} as const;

export const HOST_SANDBOX = "testapi.meinvoice.vn";
const DUONG_DAN_API = "/api/v3";

function gt(env: EnvMisa, ten: string): string {
  return (env[ten] ?? "").trim();
}

function docCheDo(raw: string): CheDoMisa | null {
  const v = raw.toLowerCase();
  if (v === "" || v === "off") return "off";
  if (v === "gia-lap" || v === "sandbox" || v === "production") return v;
  return null;
}

/** null = hợp lệ; ngược lại câu lỗi KHÔNG chứa giá trị URL (URL không phải secret, nhưng giữ luật chung). */
export function kiemBaseUrl(cheDo: "sandbox" | "production", raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `${BIEN_MISA.BASE_URL} không phải URL hợp lệ.`;
  }
  if (u.protocol !== "https:") return `${BIEN_MISA.BASE_URL} phải dùng https.`;
  if (u.username || u.password) return `${BIEN_MISA.BASE_URL} không được chứa thông tin đăng nhập.`;
  if (u.search || u.hash) return `${BIEN_MISA.BASE_URL} không được có query/fragment.`;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.replace(/\/+$/, "");
  if (path !== DUONG_DAN_API) return `${BIEN_MISA.BASE_URL} phải kết thúc bằng ${DUONG_DAN_API}.`;
  if (cheDo === "sandbox") {
    if (host !== HOST_SANDBOX) {
      return `Chế độ sandbox chỉ nhận host ${HOST_SANDBOX} — từ chối để không phát hành nhầm lên môi trường thật.`;
    }
    return null;
  }
  // production
  if (host.includes("test")) {
    return "Chế độ production từ chối host môi trường thử — kiểm lại MISA_EINVOICE_BASE_URL.";
  }
  if (host !== "meinvoice.vn" && !host.endsWith(".meinvoice.vn")) {
    return "Chế độ production chỉ nhận host thuộc meinvoice.vn.";
  }
  return null;
}

export function docCauHinhMisa(env: EnvMisa): KetQuaDocCauHinh {
  const cheDo = docCheDo(gt(env, BIEN_MISA.MODE));
  if (cheDo === null) {
    return {
      cheDoKhai: "off",
      cauHinh: null,
      thieu: [],
      loi: `${BIEN_MISA.MODE} chỉ nhận off | gia-lap | sandbox | production — đang coi như off.`,
    };
  }
  if (cheDo === "off") return { cheDoKhai: "off", cauHinh: null, thieu: [], loi: null };
  if (cheDo === "gia-lap") return { cheDoKhai: "gia-lap", cauHinh: { cheDo: "gia-lap" }, thieu: [], loi: null };

  const can = [
    BIEN_MISA.BASE_URL,
    BIEN_MISA.APP_ID,
    BIEN_MISA.USERNAME,
    BIEN_MISA.PASSWORD,
    BIEN_MISA.LOAI_HOA_DON,
  ] as const;
  const thieu = can.filter((ten) => gt(env, ten) === "");
  if (thieu.length > 0) {
    return {
      cheDoKhai: cheDo,
      cauHinh: null,
      thieu: [...thieu],
      loi: `Thiếu biến ${thieu.join(", ")} — cổng MISA đang TẮT.`,
    };
  }
  const loiUrl = kiemBaseUrl(cheDo, gt(env, BIEN_MISA.BASE_URL));
  if (loiUrl) return { cheDoKhai: cheDo, cauHinh: null, thieu: [], loi: loiUrl };

  const loaiRaw = gt(env, BIEN_MISA.LOAI_HOA_DON).toLowerCase();
  if (loaiRaw !== "co-ma" && loaiRaw !== "khong-ma") {
    return {
      cheDoKhai: cheDo,
      cauHinh: null,
      thieu: [],
      loi: `${BIEN_MISA.LOAI_HOA_DON} chỉ nhận co-ma | khong-ma — cổng MISA đang TẮT.`,
    };
  }

  return {
    cheDoKhai: cheDo,
    cauHinh: {
      cheDo,
      baseUrl: gt(env, BIEN_MISA.BASE_URL).replace(/\/+$/, ""),
      appId: gt(env, BIEN_MISA.APP_ID),
      username: gt(env, BIEN_MISA.USERNAME),
      // Mật khẩu KHÔNG trim: khoảng trắng đầu/cuối có thể là một phần mật khẩu thật.
      password: env[BIEN_MISA.PASSWORD] ?? "",
      loaiHoaDon: loaiRaw,
    },
    thieu: [],
    loi: null,
  };
}
