// lib/vin-hoadon/cau-hinh.ts — đọc cấu hình cổng VIN-HOADON từ env. THUẦN.
//
// Nguồn hợp đồng: tài liệu "Hàm tích hợp hóa đơn điện tử — Version 13.0" của VIN-HOADON do chủ dự án cấp
// (ghi chú đọc 02/11/2026). Tài liệu KHÔNG công bố địa chỉ dịch vụ (mẫu "http://x.x.x.x/api/services/hddtws/…") —
// địa chỉ là của VIN cấp riêng cho từng khách ⇒ lấy từ env, KHÔNG viết cứng trong mã.
//
// Luật chống trỏ nhầm (hoá đơn phát hành là chứng từ THUẾ, không xoá được):
//   · Thiếu biến / sai giá trị ⇒ coi như TẮT, nói rõ TÊN biến — KHÔNG BAO GIỜ in giá trị.
//   · BASE_URL chỉ là gốc dịch vụ (https://host[:cổng]) — phần "/api/services/hddtws/…" do mã nối.
//   · "production" TỪ CHỐI host trông như môi trường thử (test/sandbox/demo/staging/dev/uat).
//   · Mật khẩu KHÔNG trim (khoảng trắng đầu/cuối có thể là một phần mật khẩu thật).
//
// ⚠️ VIN chưa cấp sandbox cho dự án này: mọi giá trị ở đây chưa từng được thử với dịch vụ thật.

export type CheDoVin = "off" | "sandbox" | "production";

export type CauHinhVin = {
  cheDo: "sandbox" | "production";
  /** Đã bỏ dấu `/` cuối, chỉ gồm giao thức + host (+ cổng). */
  baseUrl: string;
  username: string;
  password: string;
};

export type KetQuaDocCauHinhVin = {
  /** Chế độ người vận hành KHAI (sai giá trị ⇒ "off"). */
  cheDoKhai: CheDoVin;
  /** null = tắt (khai off, hoặc khai bật mà thiếu/sai biến). */
  cauHinh: CauHinhVin | null;
  /** TÊN các biến thiếu — không bao giờ giá trị. */
  thieu: string[];
  /** Câu lỗi cho người vận hành (không chứa giá trị secret), null = không lỗi. */
  loi: string | null;
};

export type EnvVin = Readonly<Record<string, string | undefined>>;

export const BIEN_VIN = {
  MODE: "VIN_EINVOICE_MODE",
  BASE_URL: "VIN_EINVOICE_BASE_URL",
  USERNAME: "VIN_EINVOICE_USERNAME",
  // Tên khoá KHÔNG đặt là PASSWORD: gitleaks (generic-api-key) bắt nhầm cặp «khoá chứa password : tên-biến-dài» làm lộ bí mật và chặn đẩy ảnh chụp sang gương (03/11/2026).
  MAT_KHAU: "VIN_EINVOICE_PASSWORD",
} as const;

/** Phần của host cho thấy đó là môi trường thử — production không được mang. */
const DAU_HIEU_MOI_TRUONG_THU = /(^|[.-])(test|testing|sandbox|demo|staging|stage|dev|uat|qa)([.-]|\d|$)/i;

function gt(env: EnvVin, ten: string): string {
  return (env[ten] ?? "").trim();
}

function docCheDo(raw: string): CheDoVin | null {
  const v = raw.toLowerCase();
  if (v === "" || v === "off") return "off";
  if (v === "sandbox" || v === "production") return v;
  return null;
}

/** null = hợp lệ; ngược lại câu lỗi KHÔNG chứa giá trị URL. */
export function kiemBaseUrlVin(cheDo: "sandbox" | "production", raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return `${BIEN_VIN.BASE_URL} không phải URL hợp lệ.`;
  }
  if (u.protocol !== "https:") return `${BIEN_VIN.BASE_URL} phải dùng https (mật khẩu và hoá đơn đi qua đường này).`;
  if (u.username || u.password) return `${BIEN_VIN.BASE_URL} không được chứa thông tin đăng nhập.`;
  if (u.search || u.hash) return `${BIEN_VIN.BASE_URL} không được có query/fragment.`;
  if (u.pathname.replace(/\/+$/, "") !== "") {
    return `${BIEN_VIN.BASE_URL} chỉ gồm giao thức + máy chủ (+ cổng) — phần /api/services/hddtws do hệ thống tự nối.`;
  }
  if (cheDo === "production" && DAU_HIEU_MOI_TRUONG_THU.test(u.hostname)) {
    return "Chế độ production từ chối host trông như môi trường thử — kiểm lại VIN_EINVOICE_BASE_URL.";
  }
  return null;
}

export function docCauHinhVin(env: EnvVin): KetQuaDocCauHinhVin {
  const cheDo = docCheDo(gt(env, BIEN_VIN.MODE));
  if (cheDo === null) {
    return {
      cheDoKhai: "off",
      cauHinh: null,
      thieu: [],
      loi: `${BIEN_VIN.MODE} chỉ nhận off | sandbox | production — đang coi như off.`,
    };
  }
  if (cheDo === "off") return { cheDoKhai: "off", cauHinh: null, thieu: [], loi: null };

  const can = [BIEN_VIN.BASE_URL, BIEN_VIN.USERNAME, BIEN_VIN.MAT_KHAU] as const;
  const thieu = can.filter((ten) => (ten === BIEN_VIN.MAT_KHAU ? (env[ten] ?? "") === "" : gt(env, ten) === ""));
  if (thieu.length > 0) {
    return {
      cheDoKhai: cheDo,
      cauHinh: null,
      thieu: [...thieu],
      loi: `Thiếu biến ${thieu.join(", ")} — cổng VIN-HOADON đang TẮT.`,
    };
  }
  const loiUrl = kiemBaseUrlVin(cheDo, gt(env, BIEN_VIN.BASE_URL));
  if (loiUrl) return { cheDoKhai: cheDo, cauHinh: null, thieu: [], loi: loiUrl };

  return {
    cheDoKhai: cheDo,
    cauHinh: {
      cheDo,
      baseUrl: new URL(gt(env, BIEN_VIN.BASE_URL)).origin,
      username: gt(env, BIEN_VIN.USERNAME),
      password: env[BIEN_VIN.MAT_KHAU] ?? "",
    },
    thieu: [],
    loi: null,
  };
}
