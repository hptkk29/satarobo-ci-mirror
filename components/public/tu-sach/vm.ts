"use client";
/**
 * VIEW-MODEL của trang «Tủ sách gia đình» — chuyển từ khối `renderVals` của thiết kế (artifact «Sata Robo — Website mới», TuSach.dc.html) sang React.
 * `tu-sach-view.tsx` (sinh từ markup artifact) chỉ vẽ những gì hook này trả về; kiểu của view = `TuSachVm` (suy ra từ đây ⇒ thiếu khoá là lỗi biên dịch).
 *
 * Khác thiết kế (có chủ đích, đều vì dữ liệu THẬT):
 *  · Ebook: trình đọc hiện ẢNH TRANG THẬT (`/api/tu-sach/trang/<so>/<n>`); chưa có ảnh thì giữ trang giả của thiết kế. «Tải» ⇒ cổng «để lại thông tin»
 *    rồi xin link tải ký sẵn ở `/api/tu-sach/tai/<so>` (PDF là tệp riêng tư).
 *  · Sách giáo khoa: 237 cuốn lớp 1–12 là LIÊN KẾT tới trang đọc của NXBGD (taphuan.nxbgd.vn). «Đọc» mở trang NXBGD ở thẻ mới; KHÔNG có nút «Tải»
 *    (Sata Robo không giữ tệp SGK). Dữ liệu chưa có «vở bài tập» nên chỉ có một mục «Sách giáo khoa».
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCongThongTin } from "@/components/public/cong-thong-tin/hop-de-lai-thong-tin";
import { soTrangDocThu, CHU_DE_EBOOK, EBOOKS, MAU_CHU_DE, type Ebook } from "@/lib/tu-sach/ebook";
import { SGK, type Sgk } from "@/lib/tu-sach/sgk";

const FAQS: readonly (readonly [string, string])[] = [
  [
    "Tủ sách có những sách gì?",
    "Hai ngăn: 20 ebook do Ban Đào tạo Sata Robo biên soạn cho phụ huynh (tư duy, kỹ năng sống, gia đình, học tập, STEM và robotics, hoạt động ngoài trời), và sách giáo khoa lớp 1 đến lớp 12 theo chương trình giáo dục phổ thông.",
  ],
  [
    "Đọc trên điện thoại có rõ không?",
    "Sách mở ở chế độ vừa khung để thấy trọn một trang. Muốn xem kỹ, ba mẹ chụm hai ngón hoặc bấm nút + để phóng to tới 400%, và bật Toàn màn hình khi đọc lâu.",
  ],
  [
    "Tải sách về máy thế nào?",
    "Lần tải đầu tiên, ba mẹ để lại họ tên, số điện thoại và phường/xã. Sau đó bấm “Tải PDF” với ebook là tải được mọi cuốn. Sách giáo khoa đọc trực tiếp tại trang của Nhà xuất bản Giáo dục Việt Nam.",
  ],
  [
    "Vì sao phải để lại thông tin khi tải?",
    "Đọc trực tuyến luôn miễn phí và không cần điền gì. Khi tải về, Sata Robo xin họ tên và số điện thoại để gửi thêm tài liệu và tư vấn khi ba mẹ cần; phường/xã giúp kết nối với cơ sở Sata Robo gần nhà nhất. Phiếu chỉ có thông tin liên hệ, không kèm sách ba mẹ đã đọc.",
  ],
  [
    "Vì sao đôi lúc chưa tải được sách?",
    "Một số cuốn đang được cập nhật tệp tải về. Đọc sách trong trang vẫn bình thường trong lúc chờ.",
  ],
  [
    "Có được in hay chia sẻ sách không?",
    "Ảnh bìa và nội dung sách giáo khoa thuộc bản quyền của nhà xuất bản. Tủ sách chỉ dùng để con học tập trong gia đình, xin ba mẹ đừng in bán hay chia sẻ lại.",
  ],
];

const MAU_MON: Readonly<Record<string, string>> = {
  "Tiếng Việt": "#c2410c", "Ngữ văn": "#c2410c", Toán: "#6b21a8", "Tiếng Anh": "#1d4ed8", "Đạo đức": "#be185d", "Giáo dục công dân": "#be185d",
  "Giáo dục kinh tế và pháp luật": "#be185d", "Tự nhiên và Xã hội": "#15803d", "Khoa học": "#0f766e", "Khoa học tự nhiên": "#0f766e", "Lịch sử và Địa lí": "#a16207",
  "Lịch sử": "#a16207", "Địa lí": "#4d7c0f", "Vật lí": "#0369a1", "Hoá học": "#b91c1c", "Sinh học": "#15803d", "Tin học": "#334155", "Công nghệ": "#475569",
  "Âm nhạc": "#9333ea", "Mĩ thuật": "#db2777", "Hoạt động trải nghiệm": "#ea580c", "Hoạt động trải nghiệm, hướng nghiệp": "#ea580c", "Giáo dục thể chất": "#0e7490",
  "Giáo dục quốc phòng và an ninh": "#3f6212",
};

const CAP: readonly (readonly [string, readonly number[]])[] = [
  ["Tiểu học", [1, 2, 3, 4, 5]],
  ["Trung học cơ sở", [6, 7, 8, 9]],
  ["Trung học phổ thông", [10, 11, 12]],
];

/** Một phần = 40 trang (như thiết kế). Ebook ≤ 40 trang ⇒ một phần. */
export const SO_TRANG_MOI_PHAN = 40;

const boDau = (s: string) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();

type Kho = "ebook" | "sgk";
type TrangThai = { kho: Kho; cd: string; lop: number; mon: string; q: string; moSo: number; trang: number; zoom: number; phanMo: number; full: boolean; panel: boolean; faq: number; toast: string };
const DAU: TrangThai = { kho: "ebook", cd: "Tất cả", lop: 3, mon: "all", q: "", moSo: 1, trang: 1, zoom: 100, phanMo: 0, full: false, panel: false, faq: -1, toast: "" };

const cuonDen = (id: string, doTre = 40) => {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el?.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, doTre);
};

function sachMoCuaEbook(e: Ebook, trang: number) {
  return {
    ten: e.tieuDe,
    mon: e.chuDe,
    mau: "#285f99",
    soTrang: e.soTrang,
    lop: e.doiTuong || "Phụ huynh",
    dongPhu: e.phuDe || " ",
    loai: "Ebook Sata Robo",
    cover: `/tu-sach/bia/${e.so}.jpg`,
    anhTrang: `/api/tu-sach/trang/${e.so}/${trang}`,
    so: e.so,
  };
}

export function useTuSachVm() {
  const { daMo, yeuCau, suaThongTin } = useCongThongTin();
  const [s, setS] = useState<TrangThai>(DAU);
  const set = useCallback((p: Partial<TrangThai>) => setS((c) => ({ ...c, ...p })), []);
  const doiToast = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback(
    (t: string) => {
      if (doiToast.current) clearTimeout(doiToast.current);
      set({ toast: t });
      doiToast.current = setTimeout(() => set({ toast: "" }), 3600);
    },
    [set],
  );
  useEffect(
    () => () => {
      if (doiToast.current) clearTimeout(doiToast.current);
    },
    [],
  );
  // Esc thoát toàn màn hình
  useEffect(() => {
    if (!s.full) return;
    const bam = (e: KeyboardEvent) => {
      if (e.key === "Escape") setS((c) => ({ ...c, full: false }));
    };
    window.addEventListener("keydown", bam);
    return () => window.removeEventListener("keydown", bam);
  }, [s.full]);

  /** Xin link tải ký sẵn của một ebook; lỗi (chưa có tệp / hết thẻ) ⇒ báo bằng toast, không để người dùng thấy JSON thô. */
  const taiPdf = useCallback(
    async (e: Ebook) => {
      toast(`Đang chuẩn bị “${e.tieuDe}”…`);
      try {
        const r = await fetch(`/api/tu-sach/tai/${e.so}`, { cache: "no-store" });
        const b = (await r.json().catch(() => null)) as { ok?: boolean; url?: string; loi?: string } | null;
        if (r.ok && b?.ok && b.url) {
          toast(`Đang tải PDF “${e.tieuDe}”…`);
          window.location.assign(b.url);
          return;
        }
        toast(b?.loi === "CHUA_CO_TEP" ? "Cuốn này đang được cập nhật tệp tải về. Ba mẹ đọc trực tuyến trước nhé." : "Chưa tải được, ba mẹ thử lại giúp Sata Robo nhé.");
      } catch {
        toast("Chưa tải được — ba mẹ kiểm tra kết nối mạng rồi thử lại nhé.");
      }
    },
    [toast],
  );

  const ebookDangMo = EBOOKS.find((e) => e.so === s.moSo) ?? EBOOKS[0]!;
  const trang = Math.min(s.trang, ebookDangMo.soTrang);
  const sachMo = sachMoCuaEbook(ebookDangMo, trang);
  const soPhan = Math.ceil(ebookDangMo.soTrang / SO_TRANG_MOI_PHAN);
  // ĐỌC THỬ: chưa để lại thông tin ⇒ chỉ đọc 1/4 số trang đầu (cùng hàm với máy chủ); đã mở khoá ⇒ đọc hết.
  const gioiHanDoc = daMo ? ebookDangMo.soTrang : soTrangDocThu(ebookDangMo.soTrang);
  const sangTrang = (so: number) => {
    const dich = Math.max(1, Math.min(ebookDangMo.soTrang, so));
    if (dich <= gioiHanDoc) set({ trang: dich });
    else yeuCau(() => set({ trang: dich }), `doc:${ebookDangMo.so}`);
  };

  const xem = useCallback(
    (e: Ebook) => {
      set({ moSo: e.so, trang: 1, zoom: 100, phanMo: 0, panel: false });
      cuonDen("trinh-doc");
      if (!daMo) toast(`Đọc thử ${soTrangDocThu(e.soTrang)}/${e.soTrang} trang đầu. Để lại thông tin để đọc tiếp và tải về.`);
    },
    [set, daMo, toast],
  );

  const doiZoom = (z: number) => set({ zoom: Math.max(50, Math.min(400, z)) });

  // ----- ngăn Ebook -----
  const ebookLoc = EBOOKS.filter((e) => s.cd === "Tất cả" || e.chuDe === s.cd);

  // ----- ngăn SGK -----
  const sgkCuaLop = SGK.filter((b) => b.lop === s.lop);
  const dsMon = [...new Set(sgkCuaLop.map((b) => b.mon))];
  const mon = s.mon !== "all" && dsMon.includes(s.mon) ? s.mon : "all";
  const qn = boDau(s.q.trim());
  const sgkLoc: Sgk[] = sgkCuaLop.filter((b) => (mon === "all" || b.mon === mon) && (!qn || boDau(b.ten).includes(qn)));

  return useMemo(
    () => ({
      // trạng thái cổng
      daDeLai: daMo,
      chuaDeLai: !daMo,
      suaThongTin,
      // chọn kho
      kho: s.kho,
      laKhoEbook: s.kho === "ebook",
      laKhoSgk: s.kho === "sgk",
      khoTabs: (
        [
          ["ebook", "Ebook Sata Robo", `${EBOOKS.length} cuốn`],
          ["sgk", "Sách giáo khoa", "Lớp 1–12"],
        ] as const
      ).map(([k, ten, phu]) => ({ ten, phu, on: s.kho === k, cls: "ts-kho" + (s.kho === k ? " on" : ""), pick: () => set({ kho: k }) })),

      // ngăn Ebook
      chuDeEbook: ["Tất cả", ...CHU_DE_EBOOK].map((c) => {
        const on = s.cd === c;
        return {
          ten: c,
          so: c === "Tất cả" ? EBOOKS.length : EBOOKS.filter((e) => e.chuDe === c).length,
          on,
          cls: "ts-m" + (c === "Tất cả" ? " all" : "") + (on ? " on" : ""),
          mau: MAU_CHU_DE[c] ?? "var(--text)",
          pick: () => set({ cd: c }),
        };
      }),
      dongEbook: (s.cd !== "Tất cả" ? `${s.cd} · ` : "") + `${ebookLoc.length} cuốn · miễn phí`,
      ebooks: ebookLoc.map((e) => ({
        so: e.so,
        ten: e.tieuDe,
        phuDe: e.phuDe,
        coPhuDe: !!e.phuDe,
        moTa: e.moTa,
        doiTuong: e.doiTuong,
        chuDe: e.chuDe,
        soTrang: e.soTrang,
        cover: `/tu-sach/bia/${e.so}.jpg`,
        mau: MAU_CHU_DE[e.chuDe] ?? "#285f99",
        alt: `Bìa ebook “${e.tieuDe}”`,
        ariaDoc: `Đọc thử ${e.tieuDe}`,
        ariaTai: `Tải PDF ${e.tieuDe}`,
        doc: () => xem(e),
        tai: () => yeuCau(() => void taiPdf(e), `ebook:${e.so}`),
      })),

      // ngăn SGK
      capHoc: CAP.map(([ten, ls]) => ({
        ten,
        lop: ls.map((l) => ({ so: l, on: l === s.lop, cls: "ts-g" + (l === s.lop ? " on" : ""), aria: `Lớp ${l}`, pick: () => set({ lop: l, mon: "all" }) })),
      })),
      loaiSach: [{ ten: "Sách giáo khoa", on: true, cls: "on", pick: () => undefined }],
      monHoc: [{ ten: "Tất cả môn", mau: "var(--text)", on: mon === "all", cls: "ts-m all" + (mon === "all" ? " on" : ""), pick: () => set({ mon: "all" }) }].concat(
        dsMon.map((m) => ({ ten: m, mau: MAU_MON[m] ?? "#6b21a8", on: m === mon, cls: "ts-m" + (m === mon ? " on" : ""), pick: () => set({ mon: m === mon ? "all" : m }) })),
      ),
      q: s.q,
      coTim: s.q.length > 0,
      goiYTim: `Gõ tên môn, ví dụ: toán ${s.lop}`,
      onSearch: (e: { target: { value: string } }) => set({ q: e.target.value }),
      xoaTim: () => set({ q: "" }),
      xoaLoc: () => set({ q: "", mon: "all" }),
      tieuDeKetQua: `Lớp ${s.lop}` + (mon === "all" ? "" : ` · ${mon}`),
      dongKetQua: sgkLoc.length ? `${sgkLoc.length} cuốn sách giáo khoa${qn ? ` khớp “${s.q.trim()}”` : ""}` : "Chưa có cuốn nào khớp",
      coSach: sgkLoc.length > 0,
      khongCoSach: sgkLoc.length === 0,
      sach: sgkLoc.map((b) => ({
        ten: b.ten + (b.phu ? ` · ${b.phu}` : ""),
        mon: b.mon,
        mau: MAU_MON[b.mon] ?? "#6b21a8",
        lop: `Lớp ${b.lop}`,
        dongPhu: b.tap || b.phu || " ",
        loai: "Sách giáo khoa",
        loaiNgan: "SGK",
        ariaDoc: `Đọc ${b.ten} tại Nhà xuất bản Giáo dục Việt Nam`,
        url: b.url,
        doc: () => window.open(b.url, "_blank", "noopener,noreferrer"),
      })),

      // trình đọc (ebook)
      sachMo,
      trang,
      zoom: s.zoom,
      zoomScale: (s.zoom / 100).toFixed(2),
      readerCls: "reader" + (s.full ? " full" : ""),
      readerAria: `Trình đọc: ${sachMo.ten}`,
      full: s.full,
      nhanToanManHinh: s.full ? "Thoát toàn màn hình" : "Toàn màn hình",
      toanManHinh: () => set({ full: !s.full }),
      vuaKhungCls: "rd-btn rd-txt" + (s.zoom === 100 ? " on" : ""),
      vuaKhung: () => set({ zoom: 100 }),
      phongTo: () => doiZoom(s.zoom + 25),
      thuNho: () => doiZoom(s.zoom - 25),
      nhapDup: () => set({ zoom: s.zoom === 100 ? 200 : 100 }),
      trangTruoc: () => set({ trang: Math.max(1, trang - 1) }),
      trangSau: () => sangTrang(trang + 1),
      veThuVien: () => {
        set({ full: false });
        cuonDen("thu-vien", 30);
      },
      soPhan,
      soTrangDocThu: gioiHanDoc,
      rsecCls: "sec gridbg ts-rsec" + (s.panel || s.full ? " raised" : ""),
      panelCls: "rd-panel" + (s.panel ? " open" : ""),
      moPanel: () => set({ panel: true }),
      dongPanel: () => set({ panel: false }),
      taiToanBo: () => yeuCau(() => void taiPdf(ebookDangMo), `ebook:${ebookDangMo.so}`),
      phan: Array.from({ length: soPhan }, (_, i) => {
        const tu = i * SO_TRANG_MOI_PHAN + 1;
        const den = Math.min(ebookDangMo.soTrang, (i + 1) * SO_TRANG_MOI_PHAN);
        const open = s.phanMo === i;
        return {
          ten: `Phần ${i + 1}`,
          tu,
          den,
          open,
          cls: "rd-part" + (open ? " open" : ""),
          toggle: () => set({ phanMo: open ? -1 : i }),
          tai: () => yeuCau(() => void taiPdf(ebookDangMo), `ebook:${ebookDangMo.so}`),
          thumbs: [0, 1, 2, 3]
            .map((k) => tu + k)
            .filter((so) => so <= ebookDangMo.soTrang)
            .map((so) => ({ so, cls: "rd-th" + (so === trang ? " on" : ""), aria: `Đến trang ${so}`, go: () => sangTrang(so) })),
        };
      }),
      coBia: trang === 1,
      khongBia: trang !== 1,

      // hỏi đáp
      faqs: FAQS.map(([q, a], i) => ({ q, a, open: s.faq === i, sign: s.faq === i ? "−" : "+", toggle: () => set({ faq: s.faq === i ? -1 : i }) })),

      // thông báo nhỏ
      coToast: !!s.toast,
      toast: s.toast,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, daMo, yeuCau, suaThongTin, taiPdf, xem],
  );
}

export type TuSachVm = ReturnType<typeof useTuSachVm>;
