// lib/hoa-hong/hang-rao-ui.ts — DỊCH guardrail kích hoạt (máy chủ) thành THANH HÀNG RÀO của builder (06 §5.2). THUẦN.
//
// Cổng thật là `kiemKichHoat` ở máy chủ (`guardrail-kich-hoat.ts`, chạy lại lúc bấm Kích hoạt). Ở đây chỉ gom các mã lỗi
// của nó vào bảy dòng người đọc hiểu ngay, và quyết định nút Kích hoạt. Hai điều phải giữ:
//   · KHÔNG mã lỗi nào rơi mất: mã chưa có dòng riêng đi vào "Bộ rule dùng được" / "Khác" và VẪN chặn. Một bảng dịch mà
//     im lặng bỏ qua mã mới sẽ cho nút sáng đúng lúc máy chủ sắp từ chối.
//   · "Chưa kiểm" KHÔNG phải "đạt": chưa gọi máy chủ thì không dòng nào được ✓.
import type { HuongXuLyTran } from "./huong-xu-ly-tran";
import { dinhDangPhanTram } from "./phan-tram";

/**
 * Số ký tự tối thiểu của lý do xác nhận cảnh báo. PHẢI bằng `LY_DO_XAC_NHAN_TOI_THIEU` của service (máy chủ là cổng thật);
 * hằng này tồn tại vì client không import được service (kéo theo DB). Ca `[NHH-FE-07m]` giữ hai số bằng nhau.
 */
export const SO_KY_TU_LY_DO_XAC_NHAN = 10;

/** `huongXuLy`: chỉ lỗi `VUOT_TRAN` mang theo (tổng lớn nhất · trần · chênh · đường dẫn nâng trần) — máy chủ dựng ở `guardrail-kich-hoat.ts`, ở đây chỉ chuyển nguyên. */
export type VanDeHangRao = { ma: string; thongBao: string; huongXuLy?: HuongXuLyTran };

/** Kết quả kiểm của MÁY CHỦ trên bản nháp đã lưu. `somNhat` = ngày hiệu lực sớm nhất hợp lệ ("YYYY-MM-DD") nếu đã gắn văn bản. */
export type KetQuaKiemHangRao = {
  loi: readonly VanDeHangRao[];
  canhBao: readonly VanDeHangRao[];
  somNhat: string | null;
};

export type MaDongHangRao = "tran" | "van-ban" | "hieu-luc" | "nguoi-huong" | "nguon" | "chong-lan" | "loai-gd" | "quy-tac" | "khac";
export type TrangThaiDong = "dat" | "khong-dat" | "chua-kiem";

export type DongHangRao = {
  ma: MaDongHangRao;
  nhan: string;
  trangThai: TrangThaiDong;
  /** Lý do chưa đạt (nguyên văn từ máy chủ). Rỗng khi đạt / chưa kiểm. */
  lyDo: string[];
  /** Ghi chú khi ĐẠT (vd mốc hiệu lực sớm nhất). */
  ghiChu: string | null;
  /** Dòng «tran» không đạt: chỉ đường (tổng · trần · chênh · liên kết nâng trần). Vắng ở mọi dòng khác. */
  huongXuLy?: HuongXuLyTran;
};

const DONG_CUA_MA: Readonly<Record<string, MaDongHangRao>> = {
  VUOT_TRAN: "tran",
  VAN_BAN_THIEU: "van-ban",
  VAN_BAN_DA_THU_HOI: "van-ban",
  HIEU_LUC_SOM: "hieu-luc",
  THIEU_NGUOI_PHU_TRACH: "nguoi-huong",
  VAI_KHONG_HOAT_DONG: "nguoi-huong",
  PERSON_VAI_NHIEU_NGUOI: "nguoi-huong",
  NGUON_KHONG_HOAT_DONG: "nguon",
  // Ba mã này từng rơi vào dòng "Điều kiện khác" trong khi dòng "Nhóm nguồn đang hoạt động" vẫn hiện ✓ (res3 MEDIUM-6, luật 12): lỗi của NGUỒN thì hiện ở dòng của nguồn.
  NGUON_KHONG_THAM_GIA_HOA_HONG: "nguon",
  NGUON_CHUA_CO_NGUOI_PHU_TRACH: "nguon",
  NGUON_KHONG_CO_PHU_HUYNH_GIOI_THIEU: "nguon",
  // Vai «người phụ trách nguồn» ở phạm vi CHUNG mà còn nguồn đang hoạt động chưa có chủ: lỗi của NGUỒN, không phải «Điều kiện khác» (cùng họ ba mã trên).
  NGUON_TOAN_CUC_THIEU_NGUOI_PHU_TRACH: "nguon",
  CHONG_LAN_HIEU_LUC: "chong-lan",
  CHONG_LAN_RULE: "chong-lan",
  LUI_HIEU_LUC_BAN_DA_DUNG: "chong-lan",
  LOAI_GD_TAT: "loai-gd",
  KHONG_CO_RULE: "quy-tac",
  PHAM_VI_CHUA_HO_TRO: "quy-tac",
  KIEU_TINH_CHUA_HO_TRO: "quy-tac",
  LUOI_QUA_LON: "quy-tac",
};

/** "2026-11-23" → "23/11/2026". */
export function ngayDMY(ngay: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ngay);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ngay;
}

const NHAN_CO_DINH: Record<Exclude<MaDongHangRao, "tran" | "hieu-luc">, string> = {
  "van-ban": "Có văn bản quy định đủ thông tin",
  "nguoi-huong": "Người hưởng xác định được",
  nguon: "Nhóm nguồn đang hoạt động",
  "chong-lan": "Không chồng lấn với chính sách khác",
  "loai-gd": "Loại giao dịch đang bật",
  "quy-tac": "Bộ rule dùng được",
  khac: "Điều kiện khác",
};

const BAY_DONG: readonly MaDongHangRao[] = ["tran", "van-ban", "hieu-luc", "nguoi-huong", "nguon", "chong-lan", "loai-gd"];

export type HangRao = {
  dong: DongHangRao[];
  canhBao: VanDeHangRao[];
  /** Có cảnh báo ⇒ người kích hoạt phải xác nhận kèm lý do (không chặn). */
  canXacNhan: boolean;
  datTatCa: boolean;
  chuaKiem: boolean;
};

const TEN_TRUONG_VAN_BAN: Readonly<Record<string, string>> = {
  documentCode: "số hiệu",
  title: "tiêu đề",
  issuedOn: "ngày ban hành",
  publishedOn: "ngày công bố",
  effectiveOn: "ngày hiệu lực ghi trong văn bản",
  approvedByName: "người duyệt",
  coTep: "tệp đính kèm",
};

/**
 * Thông báo của guardrail do MÁY CHỦ viết cho log/kỹ thuật (tên trường, mã vai, ngày ISO). Màn hình dịch lại cho người đọc:
 * không đổi nghĩa, chỉ đổi chữ — mã lỗi (`ma`) và lưu trữ không bị đụng. Mã vai lạ (không có trong `tenVai`) được GIỮ NGUYÊN.
 */
export function viHoaThongBao(msg: string, o: { tenVai?: ReadonlyMap<string, string> } = {}): string {
  let r = msg.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
  r = r.replace(/\b(documentCode|title|issuedOn|publishedOn|effectiveOn|approvedByName|coTep)\b/g, (t) => TEN_TRUONG_VAN_BAN[t] ?? t);
  if (o.tenVai && o.tenVai.size > 0) {
    const ma = [...o.tenVai.keys()].sort((a, b) => b.length - a.length).join("|");
    r = r.replace(new RegExp(`\\b(${ma})\\b`, "g"), (t) => o.tenVai!.get(t) ?? t);
  }
  return r.replace(/\bNEW\b/g, "Khách mới").replace(/\bRENEWAL\b/g, "Tái tục");
}

export function dungHangRao(kq: KetQuaKiemHangRao | null, o: { tran: number | null; tenVai?: ReadonlyMap<string, string> }): HangRao {
  const vh = (m: string) => viHoaThongBao(m, { tenVai: o.tenVai });
  const chuaKiem = kq === null;
  const nhanTran = o.tran === null ? "Tổng tỉ lệ không vượt trần" : `Tổng tỉ lệ ≤ trần ${dinhDangPhanTram(o.tran)}%`;
  const nhanHieuLuc = "Hiệu lực ≥ công bố + 15 ngày làm việc";
  const nhan = (ma: MaDongHangRao): string => (ma === "tran" ? nhanTran : ma === "hieu-luc" ? nhanHieuLuc : NHAN_CO_DINH[ma]);

  const lyDoTheoDong = new Map<MaDongHangRao, string[]>();
  const huongXuLyTheoDong = new Map<MaDongHangRao, HuongXuLyTran>();
  for (const v of kq?.loi ?? []) {
    const ma = DONG_CUA_MA[v.ma] ?? "khac";
    lyDoTheoDong.set(ma, [...(lyDoTheoDong.get(ma) ?? []), vh(v.thongBao)]);
    if (v.huongXuLy && !huongXuLyTheoDong.has(ma)) huongXuLyTheoDong.set(ma, v.huongXuLy);
  }
  if (kq && kq.somNhat && lyDoTheoDong.has("hieu-luc")) {
    lyDoTheoDong.set("hieu-luc", [...lyDoTheoDong.get("hieu-luc")!, `Ngày sớm nhất hợp lệ: ${ngayDMY(kq.somNhat)}.`]);
  }

  // Dòng cố định + dòng phụ chỉ khi CÓ lỗi thuộc chúng (không vẽ dòng "Khác ✓" cho đủ bộ).
  const hienThi: MaDongHangRao[] = [...BAY_DONG, ...(["quy-tac", "khac"] as const).filter((m) => lyDoTheoDong.has(m))];
  const dong: DongHangRao[] = hienThi.map((ma) => {
    const lyDo = lyDoTheoDong.get(ma) ?? [];
    // Luật "hiệu lực ≥ công bố + 15 ngày làm việc" cần MỐC CÔNG BỐ của văn bản: chưa gắn văn bản thì máy chủ không có gì để so, và dòng này
    // KHÔNG được hiện ✓ (đạt vì không ai kiểm là lời hứa suông). Có lỗi `HIEU_LUC_SOM` thì đã kiểm xong và không đạt.
    const khongKiemDuoc = ma === "hieu-luc" && !chuaKiem && kq!.somNhat === null && lyDo.length === 0;
    const trangThai: TrangThaiDong = chuaKiem || khongKiemDuoc ? "chua-kiem" : lyDo.length > 0 ? "khong-dat" : "dat";
    const huongXuLy = trangThai === "khong-dat" ? huongXuLyTheoDong.get(ma) : undefined;
    return {
      ma,
      nhan: nhan(ma),
      trangThai,
      lyDo,
      ghiChu: khongKiemDuoc
        ? "Chưa kiểm được: cần gắn văn bản (ngày công bố) trước."
        : ma === "hieu-luc" && trangThai === "dat" && kq?.somNhat
          ? `Sớm nhất hợp lệ: ${ngayDMY(kq.somNhat)}.`
          : null,
      ...(huongXuLy ? { huongXuLy } : {}),
    };
  });

  const canhBao = (kq?.canhBao ?? []).map((c) => ({ ma: c.ma, thongBao: vh(c.thongBao) }));
  return {
    dong,
    canhBao,
    canXacNhan: canhBao.length > 0,
    datTatCa: !chuaKiem && dong.every((d) => d.trangThai === "dat"),
    chuaKiem,
  };
}

export type QuyetDinhNut = { ve: boolean; bamDuoc: boolean; lyDo: string | null };

/**
 * Nút "Kích hoạt": vẽ khi người xem CÓ QUYỀN `commission_policies:activate` (không quyền ⇒ không vẽ nút — một nút ai cũng
 * thấy mà bấm là bị từ chối là lời hứa suông, luật 12); BẤM ĐƯỢC chỉ khi đủ: bản nháp · đã lưu · không sửa dở · hàng rào
 * đạt. Chưa đủ thì nút tắt và lý do hiện NGAY cạnh nút, mỗi trường hợp một câu riêng.
 */
export function quyetDinhNutKichHoat(d: {
  coQuyenKichHoat: boolean;
  laBanNhap: boolean;
  daLuu: boolean;
  coThayDoiChuaLuu: boolean;
  hangRao: HangRao;
}): QuyetDinhNut {
  if (!d.coQuyenKichHoat) {
    return { ve: false, bamDuoc: false, lyDo: "Bạn không có quyền kích hoạt (commission_policies:activate). Nhờ Quản trị hệ thống hoặc Giám đốc kích hoạt." };
  }
  const tat = (lyDo: string): QuyetDinhNut => ({ ve: true, bamDuoc: false, lyDo });
  if (!d.laBanNhap) return tat("Phiên bản này không còn là bản nháp — muốn đổi, tạo phiên bản mới.");
  if (!d.daLuu) return tat("Lưu nháp trước để máy chủ kiểm các điều kiện.");
  if (d.coThayDoiChuaLuu) return tat("Bạn đã sửa sau lần lưu cuối — lưu nháp để kiểm lại.");
  if (d.hangRao.chuaKiem) return tat("Chưa kiểm các điều kiện — bấm Kiểm lại.");
  if (!d.hangRao.datTatCa) {
    const n = d.hangRao.dong.filter((x) => x.trangThai === "khong-dat").length;
    return tat(n > 0 ? `Còn ${n} điều kiện chưa đạt — sửa theo từng dòng bên cạnh.` : "Còn điều kiện chưa kiểm được — xem dòng đánh dấu “chưa kiểm” bên cạnh.");
  }
  return { ve: true, bamDuoc: true, lyDo: null };
}
