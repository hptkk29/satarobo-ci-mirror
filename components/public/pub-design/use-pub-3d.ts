"use client";

import { useEffect, useState, type RefObject } from "react";
import { DUONG_DAN_MO_HINH, duocTai3D, laCheDoNhe, type MoHinh3D } from "./pub-3d-thuan";

/**
 * Cảnh 3D của artifact bằng three@0.149.0 (khoá đúng bản — r150+ đổi ánh sáng/màu nên sẽ lệch) + `public/pub/spacelab.js`
 * (hero trang chủ) / `viewer2.js` (trang con), chép nguyên văn từ artifact.
 *
 * KHÔNG chặn LCP: poster tĩnh hiển thị trước; three + mô hình chỉ tải (import động) SAU sự kiện `load` +
 * requestIdleCallback (trang con: thêm IntersectionObserver rootMargin 300px). Poster giữ nguyên tới khi
 * cảnh 3D vẽ xong khung đầu (`ready`). Chế độ nhẹ / giảm chuyển động / không WebGL ⇒ `khongCo3D` = true (chỉ poster).
 *
 * Cách dùng trong component trang (markup sao nguyên văn artifact):
 *   const canvas = useRef<HTMLCanvasElement>(null); const mid = useRef<HTMLDivElement>(null);
 *   const { ready, khongCo3D } = usePub3d(canvas, { kind: "space", model: "gift", anchor: mid, baseYaw: -0.25 });
 *   poster: className={ready && !khongCo3D ? "space-poster gone" : "space-poster"}
 */
export interface Pub3dOptions {
  kind: "space" | "viewer";
  model: MoHinh3D;
  /** `space`: phần tử neo robot (lens-shift) — trang chủ là khối `.hero-mid`. */
  anchor?: RefObject<HTMLElement | null>;
  baseYaw?: number;
  pedestal?: boolean;
  cameraZ?: number;
  scrollSpin?: boolean;
  lift?: number;
}

interface Dieu3D {
  dispose: () => void;
  /** Chỉ `spacelab.js` có (đổi bộ vật liệu sáng/tối của cảnh). */
  setTheme?: (t: "light" | "dark") => void;
}
type CanhCua = (c: HTMLCanvasElement, url: string, o: Record<string, unknown>) => Dieu3D;
type W = Window & {
  __sataLite?: boolean;
  sataSpaceLab?: CanhCua;
  sataMascotGLB2?: CanhCua;
};

const SCRIPT_CACHE = new Map<string, Promise<void>>();
function taiScript(src: string): Promise<void> {
  const cu = SCRIPT_CACHE.get(src);
  if (cu) return cu;
  const p = new Promise<void>((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = false;
    s.onload = () => res();
    s.onerror = () => {
      SCRIPT_CACHE.delete(src);
      rej(new Error(src));
    };
    document.head.appendChild(s);
  });
  SCRIPT_CACHE.set(src, p);
  return p;
}

let threePromise: Promise<void> | null = null;
/** Nạp three r149 + GLTFLoader + RoomEnvironment + MeshoptDecoder và gắn vào `window` đúng như artifact kỳ vọng. */
function nap3(): Promise<void> {
  threePromise ??= (async () => {
    const [three, gltf, room, meshopt] = await Promise.all([
      import("three"),
      import("three/examples/jsm/loaders/GLTFLoader.js"),
      import("three/examples/jsm/environments/RoomEnvironment.js"),
      import("three/examples/jsm/libs/meshopt_decoder.module.js"),
    ]);
    const w = window as unknown as Record<string, unknown>;
    w.THREE = { ...three }; // namespace ES là bản đóng băng; artifact gán thuộc tính lên THREE
    w.GLTFLoader = gltf.GLTFLoader;
    w.RoomEnvironment = room.RoomEnvironment;
    w.MeshoptDecoder = meshopt.MeshoptDecoder;
  })().catch((e) => {
    threePromise = null;
    throw e;
  });
  return threePromise;
}

/** Chủ đề hiện tại lấy từ class `.theme-light/.theme-dark` trên gốc `.page` (đúng như artifact truyền `theme: this.curTheme`). */
function chuDeHienTai(): "light" | "dark" {
  return document.querySelector(".sr-pub")?.classList.contains("theme-dark") ? "dark" : "light";
}

/** Mạng đủ tốt để tải sớm (không đợi `load` + idle): 4g hoặc không báo (3g vẫn được tải 3D nhưng theo đường `load` + idle, không tải sớm); Save-Data/slow-2g/2g đã bị loại ở chế độ nhẹ. */
function mangTot(con: { effectiveType?: string; saveData?: boolean }): boolean {
  return !con.saveData && (!con.effectiveType || con.effectiveType === "4g");
}

/** Gợi ý trình duyệt tải trước mô hình (`<link rel=preload as=fetch>`) để lúc GLTFLoader gọi là có sẵn. */
const DA_PRELOAD = new Set<string>();
function preloadTep(href: string) {
  if (DA_PRELOAD.has(href)) return;
  DA_PRELOAD.add(href);
  const l = document.createElement("link");
  l.rel = "preload";
  l.as = "fetch";
  l.href = href;
  l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}

/** Hai khung hình liên tiếp (để chắc khung đầu của canvas đã được vẽ trước khi cross-fade). */
function haiKhung(f: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(f));
}

function coWebgl(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function usePub3d(canvasRef: RefObject<HTMLCanvasElement | null>, opts: Pub3dOptions): { ready: boolean; khongCo3D: boolean } {
  const [ready, setReady] = useState(false);
  const [khongCo3D, setKhongCo3D] = useState(false);
  const { kind, model, baseYaw, pedestal, cameraZ, scrollSpin, lift, anchor } = opts;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const w = window as W;
    const nav = navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string }; deviceMemory?: number };
    const con = nav.connection ?? {};
    const nhe = laCheDoNhe(
      { saveData: con.saveData, effectiveType: con.effectiveType, deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency },
      w.__sataLite ?? null,
    );
    const giam = !!w.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!duocTai3D({ nhe, giamChuyenDong: giam, coWebgl: coWebgl() })) {
      setKhongCo3D(true);
      return;
    }

    let dieu: Dieu3D | null = null;
    let huy = false;
    let io: IntersectionObserver | null = null;
    let moTheme: MutationObserver | null = null;
    // Canvas mờ hẳn (opacity 0) cho tới khi khung đầu vẽ xong, rồi hiện dần CÙNG LÚC poster mờ đi (cross-fade .6s).
    canvas.style.opacity = "0";
    canvas.style.transition = "opacity .6s ease";
    const loi = () => {
      if (!huy) setKhongCo3D(true);
    };

    const tao = () => {
      if (huy || dieu) return;
      const url = DUONG_DAN_MO_HINH[model];
      const chung = {
        baseYaw,
        pedestal,
        cameraZ,
        scrollSpin,
        lift,
        theme: (canvas.dataset.theme3d = chuDeHienTai()),
        onLoad: () => {
          // Khung đầu của canvas đã vẽ (2 rAF sau khi mô hình nạp xong) ⇒ hiện canvas và báo ready (poster mờ đi cùng lúc).
          haiKhung(() => {
            if (huy) return;
            canvas.style.opacity = "1";
            setReady(true);
          });
        },
        onError: loi,
      };
      try {
        if (kind === "space" && w.sataSpaceLab) dieu = w.sataSpaceLab(canvas, url, { ...chung, anchor: anchor?.current ?? undefined });
        else if (kind === "viewer" && w.sataMascotGLB2) dieu = w.sataMascotGLB2(canvas, url, chung);
        else throw new Error("3D chưa tải");
        canvas.addEventListener("webglcontextlost", loi, { once: true });
        // Đổi chủ đề sáng/tối ⇒ setTheme (chỉ spacelab có).
        const goc = document.querySelector(".sr-pub");
        if (goc && dieu?.setTheme) {
          moTheme = new MutationObserver(() => {
            const t = chuDeHienTai();
            dieu?.setTheme?.(t);
            canvas.dataset.theme3d = t; // để test/QA đọc được chủ đề cảnh đang dùng
          });
          moTheme.observe(goc, { attributes: true, attributeFilter: ["class"] });
        }
      } catch {
        loi();
      }
    };
    const chay = () => {
      preloadTep(DUONG_DAN_MO_HINH[model]);
      nap3()
        .then(() => taiScript(kind === "space" ? "/pub/spacelab.js" : "/pub/viewer2.js"))
        .then(tao)
        .catch(loi);
    };
    const roi = (f: () => void) => {
      if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 1800 });
      else window.setTimeout(f, 400);
    };
    const khiGan = () => {
      if (kind === "space" || !("IntersectionObserver" in window)) return roi(chay);
      io = new IntersectionObserver(
        (es) => {
          if (es.some((x) => x.isIntersecting)) {
            io?.disconnect();
            roi(chay);
          }
        },
        { rootMargin: "600px" },
      );
      io.observe(canvas);
    };
    // Mạng tốt: tải NGAY khi trang tương tác (hook chạy sau hydrate, tức sau lần vẽ đầu ⇒ không chặn LCP); mạng thường: đợi load + idle.
    if (mangTot(con) && kind === "space") chay();
    else if (document.readyState === "complete") khiGan();
    else window.addEventListener("load", khiGan, { once: true });

    return () => {
      huy = true;
      window.removeEventListener("load", khiGan);
      io?.disconnect();
      moTheme?.disconnect();
      dieu?.dispose();
      dieu = null;
    };
  }, [canvasRef, kind, model, baseYaw, pedestal, cameraZ, scrollSpin, lift, anchor]);

  return { ready, khongCo3D };
}
