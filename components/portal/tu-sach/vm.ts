"use client";
/**
 * VIEW-MODEL «Tủ sách gia đình» ở CỔNG PHỤ HUYNH — chuyển từ khối `renderVals` của thiết kế (artifact «Cổng Phụ Huynh — Thiết kế lại», Tu-sach.dc.html).
 * `tu-sach-cong-view.tsx` (sinh từ markup artifact) chỉ vẽ những gì hook này trả về; kiểu của view = `TuSachCongVm`.
 *
 * Khác thiết kế (có chủ đích, đều vì dữ liệu THẬT):
 *  · 20 ebook và 237 sách giáo khoa lấy từ `lib/tu-sach` (cùng nguồn với trang công khai); mỗi cuốn SGK mở ĐÚNG trang đọc của cuốn đó trên NXBGD.
 *  · Lọc ebook theo 6 chủ đề của dữ liệu (thiết kế liệt kê 5 nhãn mẫu); tab «Lớp của <con>» lấy từ lớp con khai trong hồ sơ.
 *  · «Tải» ⇒ `GET /api/portal/tu-sach/tai/<so>` (đăng nhập + hồ sơ đã có phường/xã); hồ sơ chưa có ⇒ hỏi phường/xã MỘT lần (`POST /api/portal/tu-sach/phuong`).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { CHU_DE_EBOOK, EBOOKS, MAU_CHU_DE } from "@/lib/tu-sach/ebook";
import { SGK } from "@/lib/tu-sach/sgk";

export type TuSachCongProps = {
  /** Hồ sơ đã có phường/xã ⇒ được tải ngay. */
  coPhuongBanDau: boolean;
  /** Lớp (1–12) của các con có khai lớp. */
  lopCuaCon: readonly { ten: string; lop: number }[];
  /** Danh sách phường/xã để chọn khi hồ sơ còn thiếu. */
  phuongDs: readonly string[];
};

/** `"a-b: c; d: e"` → object style của React (thiết kế dựng style bằng chuỗi CSS). */
export function cssSangObject(css: string): CSSProperties {
  const ra: Record<string, string> = {};
  for (const kk of css.split(";")) {
    const i = kk.indexOf(":");
    if (i < 0) continue;
    const ten = kk.slice(0, i).trim();
    const val = kk.slice(i + 1).trim();
    if (!ten || !val) continue;
    ra[ten.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = val;
  }
  return ra as CSSProperties;
}

const TAB_LOC = (on: boolean) =>
  "flex: none; height: 36px; padding: 0 12px; border-radius: 999px; font-family: inherit; font-size: 13px; font-weight: 600; white-space: nowrap; " +
  (on ? "background: #620c8b; color: #ffffff; border: 1px solid #620c8b;" : "background: #ffffff; color: #241133; border: 1px solid #e6daee;");
const NUT_CON = (on: boolean) =>
  "height: 36px; padding: 0 12px; border-radius: 10px; font-family: inherit; font-size: 13px; font-weight: 700; " +
  (on ? "background: #ffe3c4; color: #241133; border: 1px solid #fe8f2d;" : "background: #fff8f0; color: #241133; border: 1px solid #e6daee;");
const TAB_LOP = (on: boolean) =>
  "flex: none; height: 38px; padding: 0 14px; border-radius: 999px; font-family: inherit; font-size: 14px; font-weight: 600; white-space: nowrap; " +
  (on ? "background: #620c8b; color: #ffffff; border: 1px solid #620c8b;" : "background: #ffffff; color: #241133; border: 1px solid #e6daee;");
const MAU_GAY: readonly (readonly [string, string])[] = [["#620c8b", "#ffffff"], ["#fe8f2d", "#241133"], ["#1d7a46", "#ffffff"], ["#c2410c", "#ffffff"], ["#3b5bdb", "#ffffff"], ["#ffe3c4", "#241133"]];

const biaEbook = (chuDe: string) =>
  cssSangObject(
    "position: relative; flex: none; width: 40px; height: 54px; box-sizing: border-box; border-radius: 10px 14px 14px 10px; padding: 5px; overflow: hidden; " +
      `background: ${MAU_CHU_DE[chuDe] ?? "#620c8b"}; color: #ffffff; display: flex; flex-direction: column; justify-content: space-between; ` +
      "box-shadow: inset 6px 0 0 rgba(0,0,0,0.18), 0 10px 22px rgba(36,17,51,0.18);",
  );
const gaySgk = (i: number) => {
  const m = MAU_GAY[i % MAU_GAY.length]!;
  return cssSangObject(
    `flex: none; width: 40px; height: 54px; border-radius: 3px 8px 8px 3px; border-left: 4px solid rgba(0,0,0,0.18); background: ${m[0]}; color: ${m[1]}; ` +
      "display: flex; align-items: center; justify-content: center; font-family: 'Bitter', Georgia, serif; font-size: 18px; font-weight: 800;",
  );
};

const LOI_TAI: Readonly<Record<string, string>> = {
  CHUA_CO_TEP: "Cuốn này đang được cập nhật tệp tải về — ba mẹ quay lại sau ít hôm nhé.",
  CHUA_DE_LAI_THONG_TIN: "Chọn phường/xã ở ô phía trên một lần, rồi tải được cả tủ.",
  CHUA_DANG_NHAP: "Phiên đăng nhập đã hết hạn — ba mẹ đăng nhập lại giúp Sata Robo nhé.",
  QUA_NHIEU_LAN: "Bấm hơi nhanh rồi — ba mẹ chờ ít phút rồi thử lại nhé.",
};

export function useTuSachCongVm(p: TuSachCongProps) {
  const [lop, setLop] = useState<number>(p.lopCuaCon[0]?.lop ?? 4);
  const [chuDe, setChuDe] = useState<string>("all");
  const [phuongOk, setPhuongOk] = useState(p.coPhuongBanDau);
  const [phuongChon, setPhuongChon] = useState("");
  const [dangLuu, setDangLuu] = useState(false);
  const [toast, setToast] = useState("");
  const henToast = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (henToast.current) clearTimeout(henToast.current);
  }, []);

  const baoTin = useCallback((t: string) => {
    setToast(t);
    if (henToast.current) clearTimeout(henToast.current);
    henToast.current = setTimeout(() => setToast(""), 4200);
  }, []);

  const tai = async (so: number) => {
    if (!phuongOk) return baoTin(LOI_TAI.CHUA_DE_LAI_THONG_TIN!);
    const ebook = EBOOKS.find((e) => e.so === so);
    baoTin("Đang tải “" + (ebook?.tieuDe ?? "sách") + "”");
    try {
      const res = await fetch(`/api/portal/tu-sach/tai/${so}`, { cache: "no-store" });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; url?: string; loi?: string } | null;
      if (res.ok && j?.ok && j.url) {
        window.location.assign(j.url);
        return;
      }
      if (j?.loi === "CHUA_DE_LAI_THONG_TIN") setPhuongOk(false);
      baoTin(LOI_TAI[j?.loi ?? ""] ?? "Chưa tải được lúc này — ba mẹ thử lại giúp Sata Robo nhé.");
    } catch {
      baoTin("Mạng đang chập chờn — ba mẹ thử lại giúp Sata Robo nhé.");
    }
  };

  const luuPhuong = async () => {
    if (!phuongChon) return baoTin("Chọn phường/xã trong danh sách trước nhé");
    if (dangLuu) return;
    setDangLuu(true);
    try {
      const res = await fetch("/api/portal/tu-sach/phuong", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phuong: phuongChon }) });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; loi?: string } | null;
      if (res.ok && j?.ok) {
        setPhuongOk(true);
        baoTin("Đã lưu " + phuongChon + " vào hồ sơ");
      } else if (j?.loi === "THIEU_THONG_TIN_TAI_KHOAN") {
        baoTin("Tài khoản chưa có số điện thoại hoặc họ tên — ba mẹ cập nhật trong «Hồ sơ gia đình» rồi quay lại nhé.");
      } else {
        baoTin(LOI_TAI[j?.loi ?? ""] ?? "Chưa lưu được — ba mẹ thử lại giúp Sata Robo nhé.");
      }
    } catch {
      baoTin("Mạng đang chập chờn — ba mẹ thử lại giúp Sata Robo nhé.");
    } finally {
      setDangLuu(false);
    }
  };

  const loc = [["all", "Tất cả"] as const, ...CHU_DE_EBOOK.map((c) => [c, c] as const)].map(([k, ten]) => ({
    ten,
    on: k === chuDe,
    bam: () => setChuDe(k),
    s: cssSangObject(TAB_LOC(k === chuDe)),
  }));

  const eb = EBOOKS.filter((e) => chuDe === "all" || e.chuDe === chuDe).map((e) => ({
    so: (e.so < 10 ? "0" : "") + e.so,
    ten: e.tieuDe,
    thong: `${e.chuDe} · ${e.doiTuong} · ${e.soTrang} trang`,
    bia: biaEbook(e.chuDe),
    taiNhan: "Tải " + e.tieuDe,
    tai: () => void tai(e.so),
  }));

  const tat = p.lopCuaCon.map((c) => ({ ten: `Lớp của ${c.ten} (lớp ${c.lop})`, on: c.lop === lop, bam: () => setLop(c.lop), s: cssSangObject(NUT_CON(c.lop === lop)) }));
  const lops = Array.from({ length: 12 }, (_, i) => i + 1).map((v) => ({ ten: "Lớp " + v, on: v === lop, bam: () => setLop(v), s: cssSangObject(TAB_LOP(v === lop)) }));

  const sach = SGK.filter((s) => s.lop === lop).map((s, i) => {
    const ten = s.ten + (s.tap ? " – " + s.tap : "");
    return {
      ten,
      phu: (s.phu ? s.phu + " · " : "") + "Sách giáo khoa · mở trên trang NXB Giáo dục",
      nhan: "Mở " + ten + " trên trang NXB Giáo dục (tab mới)",
      chu: s.mon.charAt(0),
      gay: gaySgk(i),
      url: s.url,
    };
  });

  return {
    soSach: EBOOKS.length,
    loc,
    eb,
    thieuPhuong: !phuongOk,
    phuongDs: p.phuongDs,
    phuongChon,
    chonPhuong: (e: { target?: { value?: string } } | null) => setPhuongChon(e && e.target && typeof e.target.value === "string" ? e.target.value : ""),
    luuPhuong: () => void luuPhuong(),
    lop,
    lops,
    tat,
    sach,
    toast,
    coToast: toast !== "",
  };
}

export type TuSachCongVm = ReturnType<typeof useTuSachCongVm>;
