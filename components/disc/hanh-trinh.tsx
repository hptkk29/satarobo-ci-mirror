"use client";

/**
 * Bộ điều phối hành trình DISC: Nhà mình → Bài ba/mẹ → Bài của bé → Lưu → Thành công.
 *
 * ĐỘNG CƠ CHẠY Ở SERVER (quyết định D1). Trình duyệt KHÔNG chấm điểm, KHÔNG biết thuật toán:
 *  - lấy bộ câu hỏi qua POST /api/disc/bo-de (`layBoDe`);
 *  - gửi CÂU TRẢ LỜI THÔ (id câu → số) trong `bai` của POST /api/disc/luu; server tự chấm rồi bỏ câu trả lời thô.
 *
 * Mọi thứ phụ thuộc bên ngoài đều tiêm qua props để test không cần mạng/DB/trình duyệt thật:
 *  - `layBoDe` : hàm gọi POST /api/disc/bo-de (mặc định `goiBoDeDisc`); 503 ENGINE_CHUA_SAN_SANG ⇒ "đang hoàn thiện".
 *  - `goiApi`  : hàm gọi POST /api/disc/luu (mặc định `goiLuuDisc`).
 *  - `kho`     : nơi giữ bản nháp (mặc định sessionStorage của tab, không có họ tên; bọc try/catch).
 *
 * Bất biến:
 *  1. `idempotencyKey` sinh MỘT lần cho mỗi lượt làm bài và giữ nguyên khi thử lại.
 *  2. Chỉ dựng `ManThanhCong` khi `goiApi` trả `ok:true`. Mọi lỗi khác ⇒ ở lại form, giữ dữ liệu.
 *  3. Bản nháp không chứa SĐT/email/đồng ý/điểm số.
 *  4. KHÔNG có điểm ở máy khách: không gửi `ketQua`, chỉ gửi `bai` (câu trả lời thô).
 *  5. Không lấy được bộ đề từ server ⇒ KHÔNG dựng bài giả.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoDeDisc } from "@/lib/disc/engine";
import type { LuuInput, PhanHoiLuu } from "@/lib/disc/luu";
import { namHienTaiVN } from "@/lib/disc/ho-so";
import { goiBoDeDisc, goiDiaChiDisc, goiLuuDisc, type GoiBoDe, type GoiDiaChi, type GoiLuu, type KetQuaBoDe, type LoiBoDe } from "./api-client";
import { docBanNhap, ghiBanNhap, khoMacDinh, xoaBanNhap, xoaBanNhapCuV1, type BanNhap, type Buoc, type KhoLuuTru } from "./ban-nhap";
import { HO_SO_TRONG, HoSoGiaDinhForm, NHAN_VAI_TRO, nhanBacHoc, type HoSoHopLe, type HoSoNhap } from "./ho-so-form";
import { loiLuuHienThi, type LoiLuuHienThi } from "./loi-luu";
import { ManDangHoanThien } from "./man-dang-hoan-thien";
import { ManHoanThanh, type DuLieuLuu, type TrangThaiLuu } from "./man-hoan-thanh";
import { ManLamBaiCongKhai } from "@/components/public/disc/man-lam-bai-cong-khai";
import { LinhVatBuoc } from "@/components/public/disc/linh-vat-buoc";
import { ManThanhCong } from "./man-thanh-cong";
import { ThanhTienDoCongKhai } from "@/components/public/disc/thanh-tien-do-cong-khai";
import { tinhTienDo } from "./tien-do";
import { Ic } from "@/components/public/disc/bieu-tuong";
import { NutXoaTrenMay } from "./xoa-tren-may";

type TraLoi = Record<string, number>;
type BoDeCap = { PH: BoDeDisc; HS: BoDeDisc };

/** Không có nguồn ngẫu nhiên mật mã trong trình duyệt này (S-10): KHÔNG rơi về Date.now()/Math.random() (đoán được ⇒ "chiếm" khoá của người khác). */
export class KhongCoNguonNgauNhienError extends Error {
  constructor() {
    super("KHONG_CO_NGUON_NGAU_NHIEN");
    this.name = "KhongCoNguonNgauNhienError";
  }
}

/**
 * Khoá idempotency ≥128 bit từ nguồn ngẫu nhiên MẬT MÃ. `randomUUID` chỉ có ở ngữ cảnh an toàn (HTTPS/localhost); `getRandomValues`
 * có cả ở ngữ cảnh không an toàn nên dùng làm phương án dự phòng (vẫn là CSPRNG). Không có cả hai ⇒ NÉM (UI hiện lời thân thiện).
 */
export function sinhKhoaMacDinh(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  try {
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    /* thử getRandomValues */
  }
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  throw new KhongCoNguonNgauNhienError();
}

const LOI_THIEU_CRYPTO: LoiLuuHienThi = {
  thongBao:
    "Trình duyệt này chưa hỗ trợ tính năng bảo mật cần để lưu kết quả an toàn. Chưa lưu gì cả. Vui lòng mở trang bằng Chrome, Safari hoặc Edge bản mới (địa chỉ bắt đầu bằng https://) rồi thử lại.",
  truong: {},
  cachSua: "THU_LAI",
};

const LOI_THIEU_CAU: LoiLuuHienThi = {
  thongBao: "Còn câu chưa được trả lời, nên CHƯA lưu gì cả. Vui lòng quay lại kiểm tra những câu còn trống rồi bấm “Thử lại”.",
  truong: {},
  cachSua: "THU_LAI",
};

/** Lỗi lấy bộ đề → câu cho người dùng. ENGINE_CHUA_SAN_SANG/KHONG_MO không đi qua đây (đổi sang màn "đang hoàn thiện"). */
function loiBoDeHienThi(l: Exclude<LoiBoDe, "ENGINE_CHUA_SAN_SANG" | "KHONG_MO">): string {
  switch (l) {
    case "KHONG_HOP_LE":
      return "Chưa chọn được bộ câu hỏi phù hợp với năm sinh và lớp đã nhập. Vui lòng kiểm tra lại hai thông tin này của con.";
    case "MANG":
      return "Chưa kết nối được tới máy chủ để lấy câu hỏi. Thông tin bạn vừa nhập vẫn còn, bạn bấm “Tiếp tục” lại khi có mạng.";
    case "QUA_NHIEU_LAN":
      return "Bạn thử quá nhiều lần trong thời gian ngắn. Vui lòng đợi một lúc rồi bấm “Tiếp tục” lại.";
    default:
      return "Chưa lấy được câu hỏi — đây là lỗi phía chúng tôi, không phải do bạn. Thông tin bạn vừa nhập vẫn còn, bạn bấm “Tiếp tục” lại sau ít phút.";
  }
}

export function HanhTrinhDisc({
  layBoDe = goiBoDeDisc,
  goiApi = goiLuuDisc,
  layDiaChi = goiDiaChiDisc,
  namNay = namHienTaiVN(new Date()),
  kho: khoProp,
  sinhKhoa = sinhKhoaMacDinh,
  bayGio = Date.now,
  taiKetQua,
}: {
  layBoDe?: GoiBoDe;
  goiApi?: GoiLuu;
  /** Danh mục địa chỉ ở bước «Lưu» (thay được khi test). */
  layDiaChi?: GoiDiaChi;
  namNay?: number;
  kho?: KhoLuuTru | null;
  sinhKhoa?: () => string;
  bayGio?: () => number;
  /** Chỗ cắm nút tải kết quả khi route PDF có; nhận mã phiếu + token (chỉ trong bộ nhớ). */
  taiKetQua?: (d: { submissionId: string; tokenTai: string }) => React.ReactNode;
}) {
  const [buoc, setBuoc] = useState<Buoc>("hoSo");
  const [hoSo, setHoSo] = useState<HoSoNhap>(HO_SO_TRONG);
  const [hoSoHopLe, setHoSoHopLe] = useState<HoSoHopLe | null>(null);
  const [boDe, setBoDe] = useState<BoDeCap | null>(null);
  const [traLoi, setTraLoi] = useState<{ PH: TraLoi; HS: TraLoi }>({ PH: {}, HS: {} });
  const [cau, setCau] = useState<{ PH: number; HS: number }>({ PH: 0, HS: 0 });
  const [loiHoSo, setLoiHoSo] = useState<string | null>(null);
  const [trangThaiLuu, setTrangThaiLuu] = useState<TrangThaiLuu>({ kieu: "nhap" });
  const [thanhCong, setThanhCong] = useState<Extract<PhanHoiLuu, { ok: true }> | null>(null);
  const [nhaNhap, setNhaNhap] = useState<BanNhap | null>(null);
  const [choQuyetDinh, setChoQuyetDinh] = useState(false);
  const [dangTaiBoDe, setDangTaiBoDe] = useState(false);
  const [daKhoiPhuc, setDaKhoiPhuc] = useState(false);
  const [engineChuaSan, setEngineChuaSan] = useState(false);

  const khoRef = useRef<KhoLuuTru | null>(null);
  const khoaRef = useRef<string | null>(null);
  /** Sau khi khôi phục nháp (không có tên): chặng cần quay lại + mã bộ đề của câu trả lời đã giữ. */
  const lamTiep = useRef<{ buoc: Buoc; bo: { PH: string; HS: string } | null } | null>(null);
  const dangGui = useRef(false);
  /** Mỗi lần "huỷ/làm lại" tăng số này; phản hồi bộ đề đến muộn của lượt cũ bị bỏ. */
  const luotTai = useRef(0);
  const vungChinh = useRef<HTMLDivElement>(null);
  const lanDauBuoc = useRef(true);

  const layKhoa = useCallback(() => {
    if (!khoaRef.current) khoaRef.current = sinhKhoa();
    return khoaRef.current;
  }, [sinhKhoa]);

  /**
   * Lấy bộ đề cho hồ sơ từ SERVER (không tự chọn ở máy khách, không đoán khi thiếu).
   * Trả bộ đề, hoặc lỗi. `chuaSan` = máy chủ chưa có động cơ ⇒ caller hiện "đang hoàn thiện".
   */
  const taiBoDe = useCallback(
    async (h: HoSoHopLe): Promise<{ ok: true; cap: BoDeCap } | { ok: false; chuaSan: true } | { ok: false; chuaSan: false; thongBao: string }> => {
      let ph: KetQuaBoDe;
      let hs: KetQuaBoDe;
      try {
        [ph, hs] = await Promise.all([
          layBoDe({ vai: "PH", namSinh: h.phuHuynh.namSinh }),
          layBoDe({ vai: "HS", bacHoc: h.hocSinh.bacHoc, namSinh: h.hocSinh.namSinh }),
        ]);
      } catch {
        return { ok: false, chuaSan: false, thongBao: loiBoDeHienThi("MANG") };
      }
      for (const r of [ph, hs]) {
        if (!r.ok && (r.loi === "ENGINE_CHUA_SAN_SANG" || r.loi === "KHONG_MO")) return { ok: false, chuaSan: true };
      }
      for (const r of [ph, hs]) {
        if (!r.ok) return { ok: false, chuaSan: false, thongBao: loiBoDeHienThi(r.loi as Exclude<LoiBoDe, "ENGINE_CHUA_SAN_SANG" | "KHONG_MO">) };
      }
      if (!ph.ok || !hs.ok) return { ok: false, chuaSan: false, thongBao: loiBoDeHienThi("LOI_MAY_CHU") };
      return { ok: true, cap: { PH: ph.boDe, HS: hs.boDe } };
    },
    [layBoDe],
  );

  // Đọc bản nháp SAU khi mount (tránh lệch hydration); chưa quyết thì KHÔNG ghi đè.
  useEffect(() => {
    khoRef.current = khoProp === undefined ? khoMacDinh() : khoProp;
    xoaBanNhapCuV1();
    const b = docBanNhap(khoRef.current, bayGio());
    if (b) {
      setNhaNhap(b);
      setChoQuyetDinh(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ghi nháp mỗi khi có thay đổi có nghĩa.
  useEffect(() => {
    if (choQuyetDinh || thanhCong) return;
    const coGi =
      hoSo.phuHuynh.namSinh || hoSo.hocSinh.namSinh || hoSo.hocSinh.bacHoc || Object.keys(traLoi.PH).length || Object.keys(traLoi.HS).length;
    if (!coGi) return;
    const bo = boDe ? { PH: boDe.PH.ma, HS: boDe.HS.ma } : lamTiep.current?.bo ?? undefined;
    let khoa: string;
    try {
      khoa = layKhoa();
    } catch {
      return; // không có nguồn ngẫu nhiên mật mã: không ghi nháp; lỗi thân thiện hiện khi bấm Lưu
    }
    ghiBanNhap(khoRef.current, { buoc: lamTiep.current ? lamTiep.current.buoc : buoc, idempotencyKey: khoa, hoSo, bo, traLoi, cau }, bayGio());
  }, [buoc, hoSo, boDe, traLoi, cau, choQuyetDinh, thanhCong, layKhoa, bayGio]);

  // Đổi chặng ⇒ đưa người dùng về đầu vùng nội dung (trình đọc màn hình đọc lại tiêu đề).
  useEffect(() => {
    if (lanDauBuoc.current) {
      lanDauBuoc.current = false;
      return;
    }
    vungChinh.current?.focus();
  }, [buoc, thanhCong]);

  // Nháp KHÔNG giữ họ tên (riêng tư trẻ em): khôi phục đưa người dùng về ô hồ sơ với năm sinh/bậc học/câu trả lời còn nguyên,
  // họ tên để trống cho họ gõ lại; bấm "Tiếp tục" là quay đúng chặng đang dở.
  const khoiPhuc = () => {
    if (!nhaNhap) return;
    const b = nhaNhap;
    luotTai.current++;
    khoaRef.current = b.idempotencyKey;
    setHoSo({
      phuHuynh: { hoTen: "", vaiTro: b.hoSo.phuHuynh.vaiTro, namSinh: b.hoSo.phuHuynh.namSinh },
      hocSinh: { hoTen: "", namSinh: b.hoSo.hocSinh.namSinh, bacHoc: b.hoSo.hocSinh.bacHoc },
      xacNhanLech: b.hoSo.xacNhanLech,
    });
    setTraLoi(b.traLoi);
    setCau(b.cau);
    lamTiep.current = b.buoc !== "hoSo" ? { buoc: b.buoc, bo: b.bo ?? null } : null;
    setDaKhoiPhuc(true);
    setBuoc("hoSo");
    setChoQuyetDinh(false);
    setNhaNhap(null);
  };

  const lamLai = () => {
    luotTai.current++;
    setDangTaiBoDe(false);
    xoaBanNhap(khoRef.current);
    khoaRef.current = null;
    setHoSo(HO_SO_TRONG);
    setHoSoHopLe(null);
    setBoDe(null);
    setTraLoi({ PH: {}, HS: {} });
    setCau({ PH: 0, HS: 0 });
    setLoiHoSo(null);
    setTrangThaiLuu({ kieu: "nhap" });
    setThanhCong(null);
    setNhaNhap(null);
    setChoQuyetDinh(false);
    setDaKhoiPhuc(false);
    lamTiep.current = null;
    setBuoc("hoSo");
  };

  const tiepTuHoSo = async (h: HoSoHopLe) => {
    if (dangTaiBoDe) return;
    const luot = ++luotTai.current;
    setLoiHoSo(null);
    setDangTaiBoDe(true);
    const r = await taiBoDe(h);
    if (luot !== luotTai.current) return; // đã "làm lại" trong lúc chờ
    setDangTaiBoDe(false);
    if (!r.ok) {
      if (r.chuaSan) setEngineChuaSan(true);
      else setLoiHoSo(r.thongBao);
      return;
    }
    const cap = r.cap;
    setHoSoHopLe(h);
    // Đổi hồ sơ làm đổi bộ đề ⇒ bỏ câu trả lời của bộ cũ (không trộn câu trả lời giữa hai bộ).
    const maPH = boDe ? boDe.PH.ma : lamTiep.current?.bo?.PH;
    const maHS = boDe ? boDe.HS.ma : lamTiep.current?.bo?.HS;
    const giuPH = maPH === cap.PH.ma;
    const giuHS = maHS === cap.HS.ma;
    setTraLoi((cu) => ({ PH: giuPH ? cu.PH : {}, HS: giuHS ? cu.HS : {} }));
    setBoDe(cap);
    const quayLai = giuPH && giuHS && lamTiep.current ? lamTiep.current.buoc : null;
    if (!quayLai) setCau({ PH: 0, HS: 0 });
    lamTiep.current = null;
    setDaKhoiPhuc(false);
    setBuoc(quayLai && quayLai !== "hoSo" ? quayLai : "phuHuynh");
  };

  const luu = async (d: DuLieuLuu) => {
    if (dangGui.current || !boDe || !hoSoHopLe) return;
    // Chỉ gửi khi MỌI câu của cả hai bộ đã có trả lời; server vẫn kiểm lại (không tin client).
    const du = (b: BoDeDisc, t: TraLoi) => b.cauHoi.every((q) => typeof t[q.id] === "number");
    if (!du(boDe.PH, traLoi.PH) || !du(boDe.HS, traLoi.HS)) {
      setTrangThaiLuu({ kieu: "loi", loi: LOI_THIEU_CAU });
      return;
    }
    // Chỉ lấy đúng các id thuộc bộ đề (bỏ id lạ còn sót trong nháp cũ).
    const chiCauCua = (b: BoDeDisc, t: TraLoi): TraLoi => Object.fromEntries(b.cauHoi.map((q) => [q.id, t[q.id]!]));
    let khoaIdem: string;
    try {
      khoaIdem = layKhoa();
    } catch {
      setTrangThaiLuu({ kieu: "loi", loi: LOI_THIEU_CRYPTO });
      return;
    }
    const body: LuuInput = {
      idempotencyKey: khoaIdem,
      soDienThoai: d.soDienThoai,
      email: d.email,
      dongY: { xuLyHoSo: true, tiepThi: d.tiepThi },
      diaChi: d.diaChi,
      phuHuynh: hoSoHopLe.phuHuynh,
      hocSinh: hoSoHopLe.hocSinh,
      bai: {
        phuHuynh: { maBoDe: boDe.PH.ma, traLoi: chiCauCua(boDe.PH, traLoi.PH) },
        hocSinh: { maBoDe: boDe.HS.ma, traLoi: chiCauCua(boDe.HS, traLoi.HS) },
      },
    };
    dangGui.current = true;
    setTrangThaiLuu({ kieu: "dangLuu" });
    try {
      const r = await goiApi(body);
      if (r.ok) {
        xoaBanNhap(khoRef.current);
        setThanhCong(r);
        setTrangThaiLuu({ kieu: "nhap" });
      } else {
        setTrangThaiLuu({ kieu: "loi", loi: loiLuuHienThi(r) });
      }
    } catch {
      setTrangThaiLuu({ kieu: "loi", loi: loiLuuHienThi({ ok: false, loi: "MANG" }) });
    } finally {
      dangGui.current = false;
    }
  };

  const tien = useMemo(
    () =>
      tinhTienDo({
        buoc: thanhCong ? "hoanThanh" : buoc,
        tongCauPH: boDe?.PH.cauHoi.length ?? 0,
        tongCauHS: boDe?.HS.cauHoi.length ?? 0,
        daTraLoiPH: Object.keys(traLoi.PH).length,
        daTraLoiHS: Object.keys(traLoi.HS).length,
      }),
    [buoc, thanhCong, boDe, traLoi],
  );

  if (engineChuaSan) return <ManDangHoanThien />;

  // Khung CHÉP từ artifact "Disc-LamBai": `.dj` = cột trái `aside.dj-side` (tiến độ · linh vật · ghi chú · nút xoá) + cột nội dung.
  // Tiêu đề trang (h1) + đường dẫn nằm ở `app/(public)/disc/bat-dau/page.tsx`.
  return (
    <div className="dj" id="disc-vung" data-testid="disc-hanh-trinh">
      <aside className="dj-side">
        <ThanhTienDoCongKhai
          buoc={thanhCong ? "hoanThanh" : buoc}
          phanTram={thanhCong ? 100 : tien.phanTram}
          daXong={thanhCong ? tien.tong : tien.daXong}
          tong={tien.tong}
          daLuu={Boolean(thanhCong)}
        />
        <LinhVatBuoc buoc={buoc} thanhCong={Boolean(thanhCong)} beNho={Boolean(hoSoHopLe?.nguoiLonTraLoiHo)} />
        <p className="dj-note dj-hide-sm">
          Bài làm tạm chỉ được giữ <strong>trong tab này</strong>, tự mất khi bạn đóng tab hoặc sau 2 giờ. Họ tên, số điện thoại, email và điểm số không được lưu vào bản nháp.
        </p>
        {!thanhCong && <NutXoaTrenMay onDaXoa={lamLai} />}
      </aside>

      <div ref={vungChinh} tabIndex={-1} style={{ minWidth: "0", outline: "none" }}>
        {choQuyetDinh && nhaNhap && (
          <div role="region" aria-label="Bản nháp" className="dnote vi" style={{ display: "grid", gap: "10px", marginBottom: "18px" }} data-testid="disc-ban-nhap">
            <div>
              <p style={{ margin: "0", fontWeight: "800" }}>Bạn có một bài đang làm dở trong tab này.</p>
              <p style={{ margin: "4px 0 0" }}>Bạn muốn làm tiếp hay bắt đầu lại từ đầu? Bản nháp chỉ nằm trong tab này và không giữ họ tên của ai.</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button type="button" className="btn btn-line" onClick={khoiPhuc} disabled={dangTaiBoDe} style={{ minHeight: "44px" }} data-testid="disc-ban-nhap-tiep">
                Làm tiếp
              </button>
              <button type="button" className="btn btn-line" onClick={lamLai} style={{ minHeight: "44px" }} data-testid="disc-ban-nhap-xoa">
                Bắt đầu lại và xoá bản nháp
              </button>
            </div>
          </div>
        )}{" "}
        {daKhoiPhuc && !thanhCong && buoc === "hoSo" && (
          <p role="status" className="dnote vi" style={{ marginBottom: "18px" }} data-testid="disc-da-khoi-phuc">
            <Ic ten="thongTin" />
            <span>Đã khôi phục bài làm dở. Để bảo vệ thông tin của trẻ, họ tên không được giữ lại — bạn nhập lại hai họ tên, các câu đã trả lời vẫn còn.</span>
          </p>
        )}

        {thanhCong ? (
          <ManThanhCong thongBao={thanhCong.thongBao} maNhan={thanhCong.maNhan} onLamLai={lamLai} taiKetQua={taiKetQua ? taiKetQua({ submissionId: thanhCong.submissionId, tokenTai: thanhCong.tokenTai }) : null} />
        ) : buoc === "hoSo" ? (
          <HoSoGiaDinhForm giaTri={hoSo} onDoi={setHoSo} onTiep={tiepTuHoSo} namNay={namNay} homNay={new Date(bayGio())} loiNgoai={loiHoSo} dangTai={dangTaiBoDe} />
        ) : buoc === "phuHuynh" && boDe && hoSoHopLe ? (
          <ManLamBaiCongKhai
            key="ph"
            boDe={boDe.PH}
            tenNguoi={hoSoHopLe.phuHuynh.hoTen}
            traLoi={traLoi.PH}
            cau={cau.PH}
            onTraLoi={(id, v) => setTraLoi((t) => ({ ...t, PH: { ...t.PH, [id]: v } }))}
            onCau={(i) => setCau((c) => ({ ...c, PH: i }))}
            onXong={() => setBuoc("hocSinh")}
            onQuayLai={() => setBuoc("hoSo")}
          />
        ) : buoc === "hocSinh" && boDe && hoSoHopLe ? (
          <ManLamBaiCongKhai
            key="hs"
            boDe={boDe.HS}
            tenNguoi={hoSoHopLe.hocSinh.hoTen}
            traLoi={traLoi.HS}
            cau={cau.HS}
            onTraLoi={(id, v) => setTraLoi((t) => ({ ...t, HS: { ...t.HS, [id]: v } }))}
            onCau={(i) => setCau((c) => ({ ...c, HS: i }))}
            onXong={() => {
              setTrangThaiLuu({ kieu: "nhap" });
              setBuoc("hoanThanh");
            }}
            onQuayLai={() => setBuoc("phuHuynh")}
          />
        ) : buoc === "hoanThanh" && hoSoHopLe ? (
          <ManHoanThanh
            tomTat={{
              tenPhuHuynh: hoSoHopLe.phuHuynh.hoTen,
              vaiTro: NHAN_VAI_TRO[hoSoHopLe.phuHuynh.vaiTro],
              tenHocSinh: hoSoHopLe.hocSinh.hoTen,
              bacHoc: nhanBacHoc(hoSoHopLe.hocSinh.bacHoc),
            }}
            trangThai={trangThaiLuu}
            onLuu={luu}
            onSuaHoSo={() => setBuoc("hoSo")}
            onSuaBai={(ai) => setBuoc(ai === "phuHuynh" ? "phuHuynh" : "hocSinh")}
            layDiaChi={layDiaChi}
          />
        ) : null}
        {!thanhCong && <NutXoaTrenMay kieu="di-dong" onDaXoa={lamLai} />}
      </div>
    </div>
  );
}
