"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "motion/react";
import { ArrowRight, BookOpen, Star, Trophy } from "lucide-react";
import { ShimmerButton } from "@/components/magic/shimmer-button";

// Hero — bố cục CHIA ĐÔI: chữ trái, ảnh học viên đạt giải phải.
//
// Bản trước là 8 khối căn giữa xếp dọc (2 pill → H1 → mô tả → nút → thẻ số
// liệu → ảnh → chú thích → social proof), cao ~1400px, và ảnh nằm dưới đáy nên
// đọc như phần thừa. Bản này sửa 6 thứ, mỗi thứ có lý do:
//
//  1. GỠ CẢ HAI PILL trên tiêu đề. Cái "TRUNG TÂM ĐÀO TẠO STEM…" là nhãn phân
//     loại, không mang tin. Cái "Tặng buổi học thử…" trùng y hệt nút CTA ngay
//     dưới. Thông tin "đang nhận lịch" chuyển xuống CẠNH nút — nơi nó là trạng
//     thái của hành động chứ không phải nhãn trang trí.
//  2. GỠ CHỮ GRADIENT. `.text-gradient-tech` nhạt dần thành tím lavender gần
//     như mất chữ trên nền trắng. Nhấn mạnh nay bằng MÀU ĐẶC + độ đậm.
//  3. GIỮ NỀN PASTEL (chủ dự án yêu cầu, 18/08). Giữ CLASS thôi thì chưa đủ —
//     xem khối chú thích ở ngay trên <section>: ở bố cục chia đôi, cả 4 lớp nền
//     cũ đều rơi ngoài tầm mắt nên vẫn trông bạc trắng. Nay màu do một lớp WASH
//     NGANG phủ cả section cấp, quầng sáng chỉ còn làm chiều sâu. Chữ phụ dùng
//     `stone` (xám ẤM) — xám lạnh trên nền kem trông bạc.
//  4. GỠ THẺ SỐ LIỆU. Ba con số trong thẻ trắng là khuôn mẫu hero-metric.
//     Giữ nguyên thông tin, hạ xuống một hàng chữ nhỏ dưới đường kẻ.
//  5. MỘT KHOẢNH KHẮC CHUYỂN ĐỘNG. Trước là 6 `motion.div` với delay 0.1→1.1s
//     nối đuôi nhau. Nay: cột chữ lên một lần, cột ảnh lên một lần, hết.
//  6. ẢNH LÀ LCP nên PHẢI `priority`. Ở bản cũ ảnh nằm dưới đáy nên `lazy` là
//     đúng; nay nó nằm trong khung nhìn đầu tiên, để `lazy` là tự bắn vào chân.
const PROOF = ["1000+ học viên", "Lớp ≤12 học viên", "Cam kết hoàn 100%"];

// Đường cong ease-out mũ — vào nhanh, dừng mềm.
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function HeroMain() {
  return (
    <section className="relative w-full overflow-hidden bg-gradient-to-b from-orange-50 via-amber-50/60 to-white">
      {/* ── NỀN PASTEL (dựng lại 18/08 lần 2) ──────────────────────────────
          Bản trước vẫn giữ nguyên 4 lớp nền của hero cũ, nhưng ở bố cục CHIA
          ĐÔI thì cả 4 đều rơi ra ngoài tầm mắt nên trang trông bạc trắng:
            · quầng cam đặt `-top-32` → gần hết nằm trên mép section, bị
              `overflow-hidden` cắt;
            · quầng tím đặt `right-32 top-20` → nằm ĐÚNG dưới tấm ảnh, ảnh đục
              nên che sạch;
            · `to-white` của gradient dọc chạm đáy ngay giữa khối chữ.
          Cách sửa: thêm một lớp WASH NGANG kem-cam(trái) → oải hương(phải) phủ
          cả section. Lớp này không phụ thuộc vị trí khối nội dung nên không thể
          "biến mất" khi đổi bố cục lần nữa; hai quầng sáng lùi về vai trò chiều
          sâu và được kéo vào trong khung. */}
      {/* Bọc chung 1 lớp mask mờ dần ở 18% cuối: hero hết màu ĐÚNG lúc chạm
          section kế (nền trắng). Không có mask thì dải màu bị cắt ngang thành
          một đường kẻ thấy rõ ở mép dưới. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_82%,transparent_100%)]"
      >
        <div
          className="absolute inset-0 [background:linear-gradient(105deg,rgba(251,146,60,0.26)_0%,rgba(252,211,77,0.16)_34%,rgba(233,213,255,0.20)_62%,rgba(196,181,253,0.34)_100%)]"
        />

        {/* Quầng cam — sau cột chữ, kéo vào trong để không bị mép trên cắt */}
        <div className="absolute -left-24 -top-24 h-[560px] w-[560px] rounded-full bg-orange-300/45 blur-3xl md:left-0 md:top-0" />
        {/* Quầng tím — viền quanh ảnh chứ không nằm trọn dưới ảnh */}
        <div className="absolute -right-24 top-16 h-[540px] w-[540px] rounded-full bg-purple-300/45 blur-3xl md:-right-10 md:top-8" />
        {/* Quầng hồng đáy — chỗ trước đây tụt về trắng */}
        <div className="absolute -bottom-40 left-1/4 h-[420px] w-[420px] rounded-full bg-rose-200/45 blur-3xl" />

        {/* Conic accent — soft spectrum cho depth */}
        <div className="absolute inset-0 opacity-70 [background:conic-gradient(from_180deg_at_50%_50%,rgba(249,115,22,0.08)_0deg,rgba(124,58,237,0.08)_120deg,rgba(244,114,182,0.06)_240deg,rgba(249,115,22,0.08)_360deg)]" />
      </div>

      {/* Lưới mảnh với radial mask */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(124,58,237,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(124,58,237,0.06)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14 lg:px-8 lg:pb-24 lg:pt-20">
        <div className="grid items-center gap-10 lg:grid-cols-[1.18fr_0.82fr] lg:gap-12">
          {/* ══════════ CỘT CHỮ ══════════ */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: EASE_OUT }}
          >
            <h1 className="text-[2.25rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-balance text-stone-900 sm:text-[3.25rem] lg:text-[4rem]">
              Lập trình Robot cùng con từ{" "}
              <span className="whitespace-nowrap text-orange-600">
                tuổi tiểu học
              </span>
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-stone-600 sm:mt-6 sm:text-lg">
              2 cơ sở tại Đà Nẵng, mỗi lớp không quá 12 học viên. Sata Robo độc
              quyền đào tạo{" "}
              <strong className="font-semibold text-stone-900">RoboSim</strong>{" "}
              — phần mềm bắt buộc của Cuộc thi Sáng tạo Robotics 2026.
            </p>

            {/* Hành động — nút chính to hơn nút phụ một cỡ và có nhịp nhấp nháy
                (`cta-pulse`, xem globals.css). Bóng do animation cấp nên KHÔNG
                thêm class `shadow-*` ở đây, nếu không nó đá nhau. */}
            {/* flex-wrap + whitespace-nowrap ở cả 2 nút: nút chính to lên nên ở
                một số bề rộng hai nút không đủ chỗ trên cùng hàng. Cho nút phụ
                RỚT XUỐNG hàng dưới còn hơn để chữ trong nút xuống 2 dòng. */}
            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <Link
                href="/lien-he?free-trial=true"
                className="group block w-full sm:w-auto"
              >
                <ShimmerButton
                  background="linear-gradient(135deg, #FB923C 0%, #F97316 45%, #EA580C 100%)"
                  borderRadius="14px"
                  shimmerDuration="2.4s"
                  className="cta-pulse h-[60px] w-full whitespace-nowrap px-8 text-[17px] font-bold transition-transform duration-200 group-hover:-translate-y-0.5 sm:w-auto"
                >
                  <span className="flex items-center gap-2.5 text-white">
                    Đặt buổi học thử 1-1 miễn phí
                    <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-1" />
                  </span>
                </ShimmerButton>
              </Link>

              <Link
                href="/khoa-hoc"
                className="inline-flex h-[60px] w-full items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border-2 border-stone-300/80 bg-white/90 px-6 text-base font-semibold text-stone-800 backdrop-blur transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 sm:w-auto"
              >
                <BookOpen className="h-[18px] w-[18px]" />
                Xem các khoá học
              </Link>
            </div>

            {/* Trạng thái của hành động — đặt DƯỚI nút, không phải nhãn trên tiêu đề.
                items-start (không phải items-center): ở 375px câu này xuống 2 dòng,
                căn giữa sẽ đẩy chấm xanh trôi vào khoảng giữa hai dòng. */}
            <p className="mt-4 flex items-start gap-2 text-sm text-stone-600">
              <span className="relative mt-[7px] flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
              </span>
              Đang nhận lịch học thử tuần này — 0 đồng, không ràng buộc.
            </p>

            {/* Bằng chứng: một hàng chữ, không phải thẻ số liệu */}
            <ul className="mt-7 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-stone-300/70 pt-6 text-sm text-stone-600 sm:mt-8 sm:gap-x-4">
              {PROOF.map((item, i) => (
                <li key={item} className="flex items-center gap-3 sm:gap-4">
                  {i > 0 && (
                    <span aria-hidden="true" className="text-stone-400">
                      ·
                    </span>
                  )}
                  <span className="font-medium text-stone-800">{item}</span>
                </li>
              ))}
              <li className="flex items-center gap-3 sm:gap-4">
                <span aria-hidden="true" className="text-stone-400">
                  ·
                </span>
                <span className="flex items-center gap-1.5">
                  <Star
                    className="h-4 w-4 fill-amber-400 text-amber-400"
                    aria-hidden="true"
                  />
                  <span className="font-medium text-stone-800">4.9 / 5</span>
                </span>
              </li>
            </ul>
          </motion.div>

          {/* ══════════ CỘT ẢNH ══════════ */}
          {/* Ảnh gốc 1536×2048 = ĐÚNG 3:4 → khung 3:4 ở desktop không cắt gì cả.
              Mobile hạ xuống 4:5 cho đỡ chiếm màn (chỉ xén 6% chiều cao).
              <figcaption> phải là con TRỰC TIẾP của <figure> nên khung ảnh chính
              là <figure>, không bọc thêm div ở giữa. */}
          <motion.figure
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.08 }}
            className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-neutral-100 shadow-[0_30px_60px_-25px_rgba(23,23,23,0.4)] ring-1 ring-neutral-900/5 lg:aspect-[3/4]"
          >
            <Image
              src="/image_publicsite/hocviendatgiai.jpg"
              alt="Học viên Sata Robo nhận giấy chứng nhận tại Cuộc thi Sáng tạo Robotics TP Đà Nẵng lần thứ II, 2026"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 480px"
              className="object-cover object-center"
            />

            {/* Lớp phủ dưới — để bảo đảm tương phản cho chữ, không phải trang trí */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-neutral-950/85 via-neutral-950/45 to-transparent"
            />

            <figcaption className="absolute inset-x-0 bottom-0 flex items-start gap-3 p-5 sm:p-6">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-inset ring-white/25 backdrop-blur-sm">
                <Trophy className="h-[18px] w-[18px] text-amber-300" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-snug text-white">
                  Cuộc thi Sáng tạo Robotics TP Đà Nẵng
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-white/75">
                  Lần thứ II — 2026 · Học viên Sata Robo nhận chứng nhận
                </span>
              </span>
            </figcaption>
          </motion.figure>
        </div>
      </div>
    </section>
  );
}
