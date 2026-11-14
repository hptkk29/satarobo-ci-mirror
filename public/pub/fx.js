/* SATA ROBO FX – lớp hiệu ứng "robotics" dùng chung cho mọi trang public.
   Cảm hứng: React Bits (ClickSpark, Magnet, SpotlightCard, DecryptedText, CountUp, TargetCursor, StarBorder),
   Magic UI (Border Beam, Meteors), motionsites (intro/boot animation).
   Nguyên tắc: không đổi cấu trúc DOM do React quản lý – chỉ thêm lớp phủ ở <body>, CSS biến, data-attribute
   và thay nodeValue tạm thời rồi trả lại đúng chữ gốc. Tắt hết khi prefers-reduced-motion. */
(function () {
  if (window.__sataFx) return; window.__sataFx = 1;
  var RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = window.matchMedia && matchMedia('(pointer: fine)').matches;
  var D = document;
  /* máy yếu / tiết kiệm dữ liệu / mạng chậm → chế độ nhẹ: tắt hiệu ứng chạy liên tục, không tải 3D */
  var NAV = navigator || {}, CON = NAV.connection || {};
  var LITE = window.__sataLite != null ? !!window.__sataLite : !!(CON.saveData || /^(slow-2g|2g)$/.test(CON.effectiveType || '') || (NAV.hardwareConcurrency && NAV.hardwareConcurrency <= 2 && (!NAV.deviceMemory || NAV.deviceMemory <= 2)));
  window.__sataLite = LITE; if (LITE) D.documentElement.classList.add('fx-lite');
  if (!RM && 'IntersectionObserver' in window) D.documentElement.classList.add('fx-on');

  /* ---------------- CSS ---------------- */
  var css = `
  :root{--fx-a:#fe8f2d;--fx-b:#b84be8;--fx-c:#4fd1b5}
  /* circuit traces in heroes (SVG + SMIL pulses, no extra DOM) */
  header.subhero,header.gridbg{position:relative;isolation:isolate}
  header.subhero::after,header.gridbg::after,.auth-art::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:-1;opacity:.55;
    background:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='560' height='360' viewBox='0 0 560 360'%3E%3Cg fill='none' stroke='%23b84be8' stroke-opacity='.28' stroke-width='1.4'%3E%3Cpath id='a' d='M0 60H120L150 90H300L330 60H560'/%3E%3Cpath id='b' d='M0 220H80L110 190H240L270 220H420L450 250H560'/%3E%3Cpath id='c' d='M200 0V40L230 70V150L200 180V360'/%3E%3Cpath id='d' d='M470 0V110L440 140V300L470 330V360'/%3E%3C/g%3E%3Cg fill='%23b84be8' fill-opacity='.45'%3E%3Ccircle cx='120' cy='60' r='3'/%3E%3Ccircle cx='330' cy='60' r='3'/%3E%3Ccircle cx='110' cy='190' r='3'/%3E%3Ccircle cx='420' cy='220' r='3'/%3E%3Ccircle cx='230' cy='150' r='3'/%3E%3Ccircle cx='440' cy='140' r='3'/%3E%3C/g%3E%3Cg fill='%23fe8f2d'%3E%3Ccircle r='3.2'%3E%3CanimateMotion dur='5s' repeatCount='indefinite'%3E%3Cmpath href='%23a'/%3E%3C/animateMotion%3E%3C/circle%3E%3Ccircle r='3.2'%3E%3CanimateMotion dur='6.5s' begin='-2s' repeatCount='indefinite'%3E%3Cmpath href='%23b'/%3E%3C/animateMotion%3E%3C/circle%3E%3Ccircle r='2.6' fill='%234fd1b5'%3E%3CanimateMotion dur='4.2s' repeatCount='indefinite'%3E%3Cmpath href='%23c'/%3E%3C/animateMotion%3E%3C/circle%3E%3Ccircle r='2.6' fill='%234fd1b5'%3E%3CanimateMotion dur='5.6s' begin='-1s' repeatCount='indefinite'%3E%3Cmpath href='%23d'/%3E%3C/animateMotion%3E%3C/circle%3E%3C/g%3E%3C/svg%3E") 0 0/560px 360px repeat;
    -webkit-mask:radial-gradient(ellipse at 70% 40%,#000 0,#000 35%,transparent 75%);mask:radial-gradient(ellipse at 70% 40%,#000 0,#000 35%,transparent 75%)}
  /* spotlight cards (React Bits SpotlightCard) + HUD corner brackets */
  .card,.course-card,.news-card,.job,.ex-card,.ex-detail,.ex-hp,.fact,.pol-card,.plan,.phase,.kitf,.fcard,.author,.price-box{--mx:50%;--my:50%}
  .card::before,.course-card::before,.news-card::before,.job::before,.ex-hp::before,.pol-card::before,.plan::before,.phase::before,.fact::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;transition:opacity .35s;z-index:0;
    background:radial-gradient(420px circle at var(--mx) var(--my),rgba(254,143,45,.16),rgba(184,75,232,.10) 40%,transparent 70%)}
  .card:hover::before,.course-card:hover::before,.news-card:hover::before,.job:hover::before,.ex-hp:hover::before,.pol-card:hover::before,.plan:hover::before,.phase:hover::before,.fact:hover::before{opacity:1}
  .card,.course-card,.news-card,.job,.ex-hp,.pol-card,.plan,.phase,.fact{position:relative;isolation:isolate}
  .card>*,.course-card>*,.news-card>*,.job>*,.pol-card>*,.plan>*,.phase>*,.fact>*{position:relative;z-index:1}
  .card::after,.course-card::after,.news-card::after,.job::after,.pol-card::after{content:"";position:absolute;inset:6px;pointer-events:none;border-radius:inherit;opacity:0;transition:opacity .3s,inset .3s;z-index:2;
    background:linear-gradient(var(--fx-a),var(--fx-a)) 0 0/14px 2px,linear-gradient(var(--fx-a),var(--fx-a)) 0 0/2px 14px,
      linear-gradient(var(--fx-a),var(--fx-a)) 100% 0/14px 2px,linear-gradient(var(--fx-a),var(--fx-a)) 100% 0/2px 14px,
      linear-gradient(var(--fx-b),var(--fx-b)) 0 100%/14px 2px,linear-gradient(var(--fx-b),var(--fx-b)) 0 100%/2px 14px,
      linear-gradient(var(--fx-b),var(--fx-b)) 100% 100%/14px 2px,linear-gradient(var(--fx-b),var(--fx-b)) 100% 100%/2px 14px;background-repeat:no-repeat}
  .card:hover::after,.course-card:hover::after,.news-card:hover::after,.job:hover::after,.pol-card:hover::after{opacity:1;inset:3px}
  /* border beam on primary CTAs (Magic UI Border Beam / React Bits StarBorder) */
  .btn-acc{position:relative;isolation:isolate}
  .btn-acc::before{content:"";position:absolute;inset:0;z-index:1;border-radius:inherit;padding:2px;pointer-events:none;
    background:conic-gradient(from var(--fx-ang,0deg),transparent 0 70%,#fff 80%,var(--fx-c) 86%,transparent 92%);
    -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:fxBeam 3.2s linear infinite}
  @property --fx-ang{syntax:'<angle>';initial-value:0deg;inherits:false}
  @keyframes fxBeam{to{--fx-ang:360deg}}
  .btn{transition:transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s}
  /* decrypt headings */
  [data-fx-dec="run"]{font-variant-ligatures:none}
  /* laser scan on photos when entering viewport */
  [data-fx-scan]{position:relative}
  .fx-scanbar{position:fixed;pointer-events:none;z-index:40;height:3px;background:linear-gradient(90deg,transparent,var(--fx-c),#fff,var(--fx-c),transparent);box-shadow:0 0 16px var(--fx-c),0 0 40px rgba(79,209,181,.6);border-radius:3px}
  /* cursor (React Bits TargetCursor) */
  .fx-cur,.fx-dot{position:fixed;left:0;top:0;pointer-events:none;z-index:2147483000;will-change:transform;transition:opacity .2s}
  .fx-dot{width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:var(--fx-a);box-shadow:0 0 10px var(--fx-a)}
  .fx-cur{width:34px;height:34px;margin:-17px 0 0 -17px;transition:width .25s,height .25s,margin .25s}
  .fx-cur i{position:absolute;width:10px;height:10px;border:2px solid var(--fx-a);transition:all .25s}
  .fx-cur i:nth-child(1){left:0;top:0;border-right:0;border-bottom:0}.fx-cur i:nth-child(2){right:0;top:0;border-left:0;border-bottom:0}
  .fx-cur i:nth-child(3){left:0;bottom:0;border-right:0;border-top:0}.fx-cur i:nth-child(4){right:0;bottom:0;border-left:0;border-top:0}
  .fx-cur.lock i{border-color:var(--fx-c)}
  .fx-cur{animation:fxSpin 6s linear infinite}.fx-cur.lock{animation:none}
  @keyframes fxSpin{to{rotate:360deg}}
  /* boot screen (intro animation) */
  .fx-boot{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;background:#0d0716;color:#e9ddff;font:600 13px 'Space Mono',monospace;transition:opacity .45s,visibility .45s}
  .fx-boot.out{opacity:0;visibility:hidden}
  .fx-boot .bx{width:min(420px,84vw);display:grid;gap:14px}
  .fx-boot .eyes{display:flex;gap:18px;justify-content:center;margin-bottom:6px}
  .fx-boot .eyes b{width:46px;height:46px;border-radius:14px;background:#4fd1b5;box-shadow:0 0 24px #4fd1b5;animation:fxBlink 1.6s infinite}
  .fx-boot .eyes b:nth-child(2){animation-delay:.08s}
  @keyframes fxBlink{0%,42%,48%,100%{transform:scaleY(1)}45%{transform:scaleY(.1)}}
  .fx-boot .ln{opacity:0;animation:fxLn .25s forwards}.fx-boot .ln b{color:#fe8f2d}
  @keyframes fxLn{to{opacity:1}}
  .fx-boot .pb{height:6px;border-radius:6px;background:rgba(255,255,255,.12);overflow:hidden}
  .fx-boot .pb i{display:block;height:100%;width:0;background:linear-gradient(90deg,#fe8f2d,#b84be8,#4fd1b5);animation:fxPb 1.1s cubic-bezier(.6,.1,.3,1) forwards}
  @keyframes fxPb{to{width:100%}}
  /* glitch on logo hover */
  header a[href]:has(img[alt*="Sata"]):hover img,.brand:hover img{animation:fxGlitch .4s steps(2) 2}
  @keyframes fxGlitch{0%{transform:translate(0)}25%{transform:translate(-2px,1px);filter:drop-shadow(2px 0 #4fd1b5) drop-shadow(-2px 0 #fe8f2d)}50%{transform:translate(2px,-1px)}75%{transform:translate(-1px,-1px);filter:drop-shadow(-2px 0 #b84be8)}100%{transform:none}}

  /* terminal caret after section labels */
  .label.mono::after{content:"_";margin-left:3px;color:var(--fx-a);animation:fxCaret 1s steps(1) infinite}
  @keyframes fxCaret{50%{opacity:0}}
  /* RGB-split glitch on photo hover */
  .ph:hover>img,.news-card:hover .thumb img,.gallery figure:hover img{animation:fxRgb .5s steps(3) 1}
  @keyframes fxRgb{0%{filter:none;transform:none}33%{filter:drop-shadow(3px 0 rgba(79,209,181,.8)) drop-shadow(-3px 0 rgba(254,143,45,.8));transform:translateX(-2px)}66%{filter:drop-shadow(-3px 0 rgba(184,75,232,.8));transform:translateX(2px)}100%{filter:none;transform:none}}
  /* page-enter wipe (after first boot) */
  .fx-wipe{position:fixed;inset:0;z-index:2147483500;pointer-events:none;background:linear-gradient(180deg,#0d0716 0,#0d0716 calc(100% - 6px),#4fd1b5 calc(100% - 6px));animation:fxWipe .55s cubic-bezier(.7,0,.3,1) forwards}
  @keyframes fxWipe{from{transform:translateY(0)}to{transform:translateY(100%)}}

  /* ===== v2: chuyển động có chủ đích ===== */
  /* scroll progress */
  .fx-prog{position:fixed;left:0;top:0;height:3px;width:100%;z-index:2147482500;pointer-events:none;transform-origin:0 50%;transform:scaleX(0);
    background:linear-gradient(90deg,#fe8f2d,#ff5f8f 45%,#b84be8 75%,#4fd1b5);box-shadow:0 0 10px rgba(254,143,45,.6)}
  /* tracing beam (lộ trình học phần) */
  .fx-trace{position:absolute;width:2px;pointer-events:none;z-index:5;border-radius:2px;background:linear-gradient(rgba(184,75,232,.0),rgba(184,75,232,.28) 8%,rgba(184,75,232,.28) 92%,rgba(184,75,232,0))}
  .fx-trace i{position:absolute;left:0;top:0;width:2px;border-radius:2px;background:linear-gradient(#4fd1b5,#b84be8 60%,#fe8f2d);box-shadow:0 0 8px rgba(254,143,45,.7)}
  .fx-trace b{position:absolute;left:-5px;width:12px;height:12px;margin-top:-6px;border-radius:50%;background:#fff;box-shadow:0 0 0 3px rgba(254,143,45,.45),0 0 18px 4px rgba(254,143,45,.75)}
  [data-fx-lit]{transition:box-shadow .45s,border-color .45s}
  .ex-hp[data-fx-lit]{box-shadow:-4px 0 0 -1px #fe8f2d,0 8px 24px rgba(254,143,45,.12)}
  /* animated beam (4 bước buổi học) */
  .fx-beam{position:absolute;pointer-events:none;z-index:5;overflow:visible}
  .fx-beam .base{fill:none;stroke:rgba(184,75,232,.35);stroke-width:2;stroke-dasharray:4 6}
  .fx-beam .glow{fill:none;stroke:url(#fxBeamGrad);stroke-width:3;stroke-linecap:round;filter:drop-shadow(0 0 6px rgba(254,143,45,.8))}
  .fx-beam circle{fill:#1c0b2c;stroke:#fe8f2d;stroke-width:2.5;transition:fill .3s,r .3s}
  .fx-beam circle.on{fill:#fe8f2d}
  [data-fx-step]{transition:box-shadow .5s,border-color .5s,translate .5s}
  [data-fx-step="on"]{box-shadow:0 0 0 2px #fe8f2d,0 18px 40px rgba(254,143,45,.22);border-color:#fe8f2d}
  /* orbiting circles */
  @property --fx-o{syntax:'<angle>';initial-value:0deg;inherits:false}
  .fx-orbit{position:absolute;pointer-events:none;width:0;height:0}
  .fx-orbit .o-ring{position:absolute;left:0;top:0;border-radius:50%;border:1.5px dashed rgba(255,255,255,.38);translate:-50% -50%}
  .fx-orbit .orb{position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:14px;display:flex;align-items:center;justify-content:center;
    background:rgba(20,8,32,.72);border:1px solid rgba(254,143,45,.55);color:#ffd3a8;box-shadow:0 0 18px rgba(254,143,45,.35);
    transform:rotate(calc(var(--a) + var(--fx-o))) translateX(var(--r)) rotate(calc(-1 * (var(--a) + var(--fx-o))));animation:fxOrb var(--d,24s) linear infinite}
  .fx-orbit .orb.rev{animation-direction:reverse;border-color:rgba(79,209,181,.6);color:#b8f5e6;box-shadow:0 0 18px rgba(79,209,181,.35)}
  @keyframes fxOrb{to{--fx-o:360deg}}
  /* tilt (thẻ robot, ảnh thi đấu) */
  .kit-grid,.mosaic,.g4{perspective:1000px}
  [data-fx-tilt]{transition:rotate .5s cubic-bezier(.2,.8,.2,1)}
  [data-fx-tilt].tilting{transition:rotate .08s linear}
  /* glow CTA chính */
  header .btn-acc,#lien-he .btn-acc{animation:fxGlow 2.8s ease-in-out infinite}
  @keyframes fxGlow{0%,100%{box-shadow:0 8px 22px rgba(254,143,45,.28)}50%{box-shadow:0 8px 34px rgba(254,143,45,.55),0 0 0 6px rgba(254,143,45,.12)}}
  /* accordion */
  .a-acc>p{animation:fxAcc .38s cubic-bezier(.2,.8,.2,1)}
  @keyframes fxAcc{from{opacity:0;translate:0 -6px;clip-path:inset(0 0 100% 0)}to{opacity:1;translate:0 0;clip-path:inset(0 0 0 0)}}
  @media (prefers-reduced-motion: reduce){.fx-orbit .orb{animation:none}header .btn-acc,#lien-he .btn-acc,.a-acc>p{animation:none}.fx-prog{display:none}}
  
  /* ===== v3: mạng xã hội, nút, nhãn, thẻ ===== */
  .soc-card{--brand:#fe8f2d}
  .soc-card .soc-ico{width:54px;height:54px;border-radius:16px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;
    box-shadow:0 10px 24px color-mix(in srgb,var(--brand) 45%,transparent);transition:transform .5s cubic-bezier(.3,1.6,.5,1)}
  .soc-card .soc-ico::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 35%,rgba(255,255,255,.6) 50%,transparent 65%);transform:translateX(-130%);transition:transform .8s}
  .soc-card:hover .soc-ico,.soc-card:focus-visible .soc-ico{transform:translateY(-4px) rotate(-8deg) scale(1.08)}
  .soc-card:hover .soc-ico::after,.soc-card:focus-visible .soc-ico::after{transform:translateX(130%)}
  .soc-card:hover,.soc-card:focus-visible{border-color:var(--brand)!important;box-shadow:0 22px 46px color-mix(in srgb,var(--brand) 26%,transparent)!important}
  .soc-card::before{background:radial-gradient(420px circle at var(--mx) var(--my),color-mix(in srgb,var(--brand) 24%,transparent),transparent 70%)!important}
  .soc-card .soc-go{margin-top:auto;padding-top:6px;font-weight:700;font-size:14px;color:var(--brand);filter:brightness(1.35);transition:translate .35s}
  .soc-card:hover .soc-go{translate:6px 0}
  .soc-btn{display:inline-flex;align-items:center;justify-content:center}
  .soc-btn svg{transition:transform .45s cubic-bezier(.3,1.6,.5,1)}
  .soc-btn:hover svg{transform:rotate(-10deg) scale(1.15)}
  .soc-btn:hover{box-shadow:0 12px 28px color-mix(in srgb,var(--brand) 45%,transparent)}
  /* vệt sáng lướt qua nút chính khi rê chuột */
  .btn.btn-acc{background-image:linear-gradient(110deg,transparent 30%,rgba(255,255,255,.5) 50%,transparent 70%);background-size:260% 100%;background-position:130% 0;background-repeat:no-repeat;transition:background-position .8s,transform .25s cubic-bezier(.2,.8,.2,1),box-shadow .25s}
  .btn.btn-acc:hover{background-position:-30% 0}
  /* nhãn [01] nháy như màn hình khởi động khi section vào màn hình */
  .label.mono[data-fx-in] b{animation:fxFlick .9s steps(1) 1}
  @keyframes fxFlick{0%,20%,40%{opacity:.15}10%,30%,60%,100%{opacity:1}50%{opacity:.4}}
  /* thẻ "bật nguồn": viền sáng chạy một lần khi xuất hiện */
  [data-fx-pow]{box-shadow:0 0 0 2px rgba(254,143,45,.55),0 0 30px rgba(254,143,45,.28)!important}
  /* tiết kiệm: hiệu ứng lặp vô hạn dừng khi section ra khỏi màn hình */
  [data-fx-off] .float,[data-fx-off] .bob,[data-fx-off] .grad,[data-fx-off] .typing,[data-fx-off] .marquee,[data-fx-off] .mq-track,[data-fx-off] .orb,[data-fx-off] .btn-acc,[data-fx-off] .btn-acc::before,[data-fx-off].cta-band::before,[data-fx-off] .cta-band::before,[data-fx-off] .space-poster,[data-fx-off]::after{animation-play-state:paused!important}
  /* chế độ nhẹ cho máy yếu */
  .fx-lite .float,.fx-lite .bob,.fx-lite .grad,.fx-lite .orb,.fx-lite .btn-acc,.fx-lite .btn-acc::before,.fx-lite .cta-band::before,.fx-lite .space-poster,.fx-lite .label.mono::after{animation:none!important}
  .fx-lite header.subhero::after,.fx-lite header.gridbg::after,.fx-lite .auth-art::after{background:none!important}
  .fx-lite .fx-beam,.fx-lite .fx-prog{display:none!important}
  
  /* ===== v4: hiệu ứng cho mọi section ===== */
  /* lưới nền sáng theo con trỏ */
  html:not(.fx-lite) .gridbg{background-image:radial-gradient(260px circle at var(--gx,-600px) var(--gy,-600px),rgba(254,143,45,.13),rgba(184,75,232,.06) 45%,transparent 70%),linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px);background-size:100% 100%,72px 72px,72px 72px}
  /* gợn sóng khi bấm */
  .fx-rip{position:fixed;left:0;top:0;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;pointer-events:none;z-index:2147482400;border:2px solid #fe8f2d;box-shadow:0 0 14px rgba(254,143,45,.6);animation:fxRip .6s cubic-bezier(.2,.8,.2,1) forwards}
  @keyframes fxRip{from{transform:scale(1);opacity:.9}to{transform:scale(7);opacity:0}}
  /* bút dạ quang dưới chữ đậm khi section xuất hiện */
  .fx-on p strong{background-image:linear-gradient(transparent 62%,rgba(254,143,45,.3) 62%);background-repeat:no-repeat;background-size:0% 100%;transition:background-size 1s cubic-bezier(.2,.8,.2,1) .35s}
  .fx-on [data-fx-seen] p strong{background-size:100% 100%}
  /* danh sách trong thẻ hiện lần lượt */
  .fx-on :is(.card,.course-card,article:not(.prose),.plan,.phase):not([data-fx-in]) li{opacity:0}
  :is(.card,.course-card,article:not(.prose),.plan,.phase)[data-fx-in] li{animation:fxLi .5s cubic-bezier(.2,.8,.2,1) both}
  :is(.card,.course-card,article:not(.prose),.plan,.phase)[data-fx-in] li:nth-child(2){animation-delay:.08s}:is(.card,.course-card,article:not(.prose),.plan,.phase)[data-fx-in] li:nth-child(3){animation-delay:.16s}
  :is(.card,.course-card,article:not(.prose),.plan,.phase)[data-fx-in] li:nth-child(4){animation-delay:.24s}:is(.card,.course-card,article:not(.prose),.plan,.phase)[data-fx-in] li:nth-child(n+5){animation-delay:.32s}
  @keyframes fxLi{from{opacity:0;translate:-10px 0}to{opacity:1;translate:0 0}}
  /* gạch chân menu trượt */
  .nav-links a{background:linear-gradient(90deg,#fe8f2d,#b84be8) 0 100%/0 2px no-repeat;padding-bottom:4px;transition:background-size .35s cubic-bezier(.2,.8,.2,1),color .2s}
  .nav-links a:hover,.nav-links a.on{background-size:100% 2px}
  /* vòng tiến trình quanh nút lên đầu trang */
  .fab a[href="#top"]{position:relative}
  .fab a[href="#top"]::after{content:"";position:absolute;inset:-4px;border-radius:50%;pointer-events:none;background:conic-gradient(#fe8f2d calc(var(--fx-sp,0) * 1turn),transparent 0);
    -webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2.5px));mask:radial-gradient(farthest-side,transparent calc(100% - 3px),#000 calc(100% - 2.5px))}
  /* ô nhập liệu sáng lên khi focus */
  input:focus-visible,select:focus-visible,textarea:focus-visible{box-shadow:0 0 0 3px rgba(254,143,45,.32),0 0 22px rgba(254,143,45,.28)!important;transition:box-shadow .25s}
  /* ảnh trượt nhẹ theo con trỏ */
  .zoom img{translate:calc(var(--zx,0) * -14px) calc(var(--zy,0) * -14px);transition:transform .7s cubic-bezier(.2,.8,.2,1),translate .5s cubic-bezier(.2,.8,.2,1)}
  /* vạch màu dưới tiêu đề section */
  .head2 h2::after{content:"";display:block;width:0;height:4px;border-radius:4px;margin-top:14px;background:linear-gradient(90deg,#fe8f2d,#ff5f8f,#b84be8,#4fd1b5,#fe8f2d);background-size:200% 100%;transition:width 1.1s cubic-bezier(.2,.8,.2,1) .2s}
  .head2[data-fx-in] h2::after{width:min(120px,40%);animation:fxBar 4s linear infinite}
  @keyframes fxBar{to{background-position:-200% 0}}
  /* bụi sao trong dải CTA */
  html:not(.fx-lite) .cta-band{background-image:radial-gradient(circle,rgba(255,255,255,.55) 0 1px,transparent 1.6px),radial-gradient(circle,rgba(255,214,168,.5) 0 1px,transparent 1.6px),var(--band);background-size:44px 44px,71px 71px,100% 100%;animation:fxDust 22s linear infinite}
  @keyframes fxDust{to{background-position:0 -440px,71px -710px,0 0}}
  /* vòng quỹ đạo sau linh vật 3D ở hero các trang con */
  .subhero .hero-art:has(canvas)::before,.subhero .hero-art:has(canvas)::after{content:"";position:absolute;left:50%;top:52%;aspect-ratio:1;translate:-50% -50%;border-radius:50%;pointer-events:none;z-index:0}
  .subhero .hero-art:has(canvas)::before{width:min(400px,82%);border:1.5px dashed rgba(254,143,45,.45);animation:fxSpin 46s linear infinite}
  .subhero .hero-art:has(canvas)::after{width:min(520px,104%);border:1px solid rgba(184,75,232,.28);animation:fxSpin 30s linear infinite reverse;
    background:radial-gradient(circle at 50% 0,#4fd1b5 0 5px,transparent 6px),radial-gradient(circle at 100% 50%,#fe8f2d 0 4px,transparent 5px),radial-gradient(circle at 15% 85%,#b84be8 0 4px,transparent 5px)}
  /* vệt sáng lướt qua dải chữ chạy */
  section[aria-label="Bộ robot"]::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(100deg,transparent 35%,rgba(255,255,255,.4) 50%,transparent 65%);transform:translateX(-100%);animation:fxGlint 6s ease-in-out infinite}
  @keyframes fxGlint{0%,55%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
  /* ảnh trong thẻ hé mở khi thẻ xuất hiện */
  :is(.news-card,.job,.pol-card)[data-fx-in] img{animation:fxReveal .9s cubic-bezier(.7,0,.2,1) both}
  @keyframes fxReveal{from{clip-path:inset(0 0 100% 0);scale:1.12}to{clip-path:inset(0 0 0 0);scale:1}}
  .fx-lite .head2[data-fx-in] h2::after,.fx-lite .cta-band,.fx-lite section[aria-label="Bộ robot"]::after{animation:none!important}
  .fx-lite .subhero .hero-art::before,.fx-lite .subhero .hero-art::after{animation:none!important}
  [data-fx-off] .cta-band,[data-fx-off].cta-band,[data-fx-off] .head2 h2::after,[data-fx-off]::after,.subhero[data-fx-off] .hero-art::before,.subhero[data-fx-off] .hero-art::after{animation-play-state:paused!important}
  @media (prefers-reduced-motion: reduce){.fx-rip{display:none}.head2 h2::after{width:min(120px,40%);transition:none;animation:none}.cta-band,section[aria-label="Bộ robot"]::after,.subhero .hero-art::before,.subhero .hero-art::after{animation:none!important}.zoom img{translate:none}}
    @media (prefers-reduced-motion: reduce){.label.mono::after{animation:none}.label.mono[data-fx-in] b{animation:none}}
  @media (prefers-reduced-motion: reduce){header.subhero::after,header.gridbg::after,.auth-art::after,.btn-acc::before{animation:none!important;background:none}}
  `;
  var st = D.createElement('style'); st.id = 'sata-fx'; st.textContent = css; (D.head || D.documentElement).appendChild(st);

  /* ---------------- boot screen: once per tab session ---------------- */
  function boot() {
    var seen = false; try { seen = sessionStorage.getItem('sata-boot') === '1'; sessionStorage.setItem('sata-boot', '1'); } catch (e) {}
    if (RM || LITE || window.__noBoot) return;
    if (seen) { var w = D.createElement('div'); w.className = 'fx-wipe'; D.body.appendChild(w); setTimeout(function () { w.remove(); }, 650); return; }
    var b = D.createElement('div'); b.className = 'fx-boot'; b.setAttribute('aria-hidden', 'true');
    var lines = ['&gt; SATA-OS v2026 khởi động…', '&gt; Nạp module <b>ALPHA</b> · <b>BETA</b> · <b>STORM</b> · <b>AI</b>', '&gt; Hiệu chỉnh cảm biến… <b>OK</b>', '&gt; Chào mừng kỹ sư nhí!'];
    b.innerHTML = '<div class="bx"><div class="eyes"><b></b><b></b></div>' + lines.map(function (l, i) { return '<div class="ln" style="animation-delay:' + (i * 0.22) + 's">' + l + '</div>'; }).join('') + '<div class="pb"><i></i></div></div>';
    D.body.appendChild(b);
    setTimeout(function () { b.classList.add('out'); setTimeout(function () { b.remove(); }, 500); }, 1350);
  }

  /* ---------------- spotlight: mouse position → CSS vars ---------------- */
  var SPOT = '.card,.course-card,.news-card,.job,.ex-hp,.pol-card,.plan,.phase,.fact';
  D.addEventListener('pointermove', function (e) {
    var el = e.target.closest && e.target.closest(SPOT); if (!el) return;
    var r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ---------------- magnetic buttons (React Bits Magnet) ---------------- */
  var magEl = null;
  if (FINE && !RM && !LITE) {
    D.addEventListener('pointermove', function (e) {
      var el = e.target.closest && e.target.closest('.btn');
      if (magEl && magEl !== el) { magEl.style.transform = ''; magEl = null; }
      if (!el) return; magEl = el;
      var r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      el.style.transform = 'translate(' + (dx * 0.18).toFixed(1) + 'px,' + (dy * 0.28).toFixed(1) + 'px)';
    }, { passive: true });
  }

  /* ---------------- target cursor (crosshair that locks onto buttons) ---------------- */
  function cursor() {
    if (!FINE || RM) return;
    var c = D.createElement('div'); c.className = 'fx-cur'; c.innerHTML = '<i></i><i></i><i></i><i></i>';
    var d = D.createElement('div'); d.className = 'fx-dot'; D.body.appendChild(c); D.body.appendChild(d);
    var x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, lock = null, running = false, idle = 0;
    c.style.opacity = d.style.opacity = '0';
    D.addEventListener('pointermove', function (e) {
      tx = e.clientX; ty = e.clientY; d.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
      c.style.opacity = d.style.opacity = '1'; idle = 0;
      lock = e.target.closest && e.target.closest('a,button,.btn,[role=tab],input,select,textarea');
      if (!running) { running = true; requestAnimationFrame(loop); }
    }, { passive: true });
    D.addEventListener('pointerleave', function () { c.style.opacity = d.style.opacity = '0'; });
    D.documentElement.addEventListener('mouseleave', function () { c.style.opacity = d.style.opacity = '0'; });
    function loop() {
      var w = 34, h = 34, cx = tx, cy = ty;
      if (lock) { var r = lock.getBoundingClientRect(); w = r.width + 12; h = r.height + 12; cx = r.left + r.width / 2; cy = r.top + r.height / 2; c.classList.add('lock'); } else c.classList.remove('lock');
      x += (cx - x) * 0.22; y += (cy - y) * 0.22;
      c.style.width = w + 'px'; c.style.height = h + 'px'; c.style.margin = (-h / 2) + 'px 0 0 ' + (-w / 2) + 'px';
      c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      if (Math.abs(cx - x) + Math.abs(cy - y) < 0.5) idle++; else idle = 0;
      if (idle > 30) { running = false; return; }
      requestAnimationFrame(loop);
    }
  }

  /* ---------------- click spark: gear teeth sparks (React Bits ClickSpark) ---------------- */
  function sparks() {
    if (RM) return;
    var cv = D.createElement('canvas'); cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147482000';
    D.body.appendChild(cv); var g = cv.getContext('2d'), P = [];
    function size() { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); }
    size(); addEventListener('resize', size);
    D.addEventListener('pointerdown', function (e) {
      var cols = ['#fe8f2d', '#b84be8', '#4fd1b5', '#f5c344'];
      for (var i = 0; i < 10; i++) P.push({ x: e.clientX, y: e.clientY, a: i / 10 * Math.PI * 2, t: 0, c: cols[i % 4] });
      P.push({ x: e.clientX, y: e.clientY, ring: 1, t: 0 });
      if (!on) { on = true; requestAnimationFrame(loop); }
    }, { passive: true });
    var on = false;
    function loop() {
      g.clearRect(0, 0, innerWidth, innerHeight);
      for (var i = P.length - 1; i >= 0; i--) {
        var p = P[i]; p.t += 0.045; if (p.t >= 1) { P.splice(i, 1); continue; }
        var k = 1 - Math.pow(1 - p.t, 3);
        if (p.ring) { g.strokeStyle = 'rgba(79,209,181,' + (1 - p.t) + ')'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, 6 + k * 26, 0, 7); g.stroke(); continue; }
        var r1 = 8 + k * 26, r2 = r1 + 10 * (1 - p.t);
        g.strokeStyle = p.c; g.globalAlpha = 1 - p.t; g.lineWidth = 2.5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(p.x + Math.cos(p.a) * r1, p.y + Math.sin(p.a) * r1); g.lineTo(p.x + Math.cos(p.a) * r2, p.y + Math.sin(p.a) * r2); g.stroke(); g.globalAlpha = 1;
      }
      if (P.length) requestAnimationFrame(loop); else { on = false; g.clearRect(0, 0, innerWidth, innerHeight); }
    }
  }

  /* ---------------- decrypt headings + count-up numbers + laser scan (on view) ---------------- */
  var GLY = '01<>/#{}[]=+*ROBO';
  function textNodes(el) { var a = [], w = D.createTreeWalker(el, NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.nodeValue.trim()) a.push(w.currentNode); return a; }
  function decrypt(el) {
    if (el.dataset.fxDec) return; el.dataset.fxDec = 'run';
    var nodes = textNodes(el), orig = nodes.map(function (n) { return n.nodeValue; }), f = 0, total = 22;
    (function step() {
      f++;
      nodes.forEach(function (n, i) {
        var s = orig[i], rev = Math.floor(s.length * f / total), out = '';
        for (var j = 0; j < s.length; j++) out += (j < rev || s[j] === ' ') ? s[j] : GLY[(Math.random() * GLY.length) | 0];
        if (n.nodeValue !== out) n.nodeValue = out;
      });
      if (f < total) setTimeout(step, 28); else { nodes.forEach(function (n, i) { n.nodeValue = orig[i]; }); el.dataset.fxDec = 'done'; }
    })();
  }
  function countUp(el) {
    if (el.dataset.fxNum) return; el.dataset.fxNum = '1';
    var n = textNodes(el)[0]; if (!n) return; var s = n.nodeValue, m = s.match(/\d[\d.,]*/); if (!m) return;
    var raw = m[0], val = parseFloat(raw.replace(/\./g, '').replace(',', '.')); if (!(val > 1) || val > 1e9) return;
    var t0 = performance.now(), dur = 1100, sep = raw.indexOf('.') >= 0 && raw.split('.').pop().length === 3;
    (function step(t) {
      var k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3), v = Math.round(val * e);
      var txt = sep ? v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') : String(v);
      n.nodeValue = k < 1 ? s.replace(raw, txt) : s; if (k < 1) requestAnimationFrame(step);
    })(t0);
  }
  function scan(el) {
    if (el.dataset.fxScan === 'done') return; el.dataset.fxScan = 'done';
    var r = el.getBoundingClientRect(); if (r.width < 120) return;
    var bar = D.createElement('div'); bar.className = 'fx-scanbar'; D.body.appendChild(bar);
    var t0 = performance.now();
    (function step(t) {
      var k = Math.min(1, (t - t0) / 900), q = el.getBoundingClientRect();
      bar.style.left = q.left + 'px'; bar.style.width = q.width + 'px'; bar.style.top = (q.top + q.height * k) + 'px'; bar.style.opacity = String(1 - Math.max(0, k - .8) * 5);
      if (k < 1) requestAnimationFrame(step); else bar.remove();
    })(t0);
  }
  var io = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (en) {
      if (!en.isIntersecting) return; var el = en.target; io.unobserve(el);
      if (el.matches('h1,h2')) decrypt(el);
      else if (el.matches('img')) scan(el);
      else countUp(el);
    });
  }, { threshold: 0.35 }) : null;
  var NUM = '.stats .num,.num-big,.ex-stats b,.ex-price b,.facts .fact b,.stat b,[data-count]';
  var PHOTO = '.ph>img,.news-card .thumb img,.gallery img,.ex-photo img,.pola img,.idcard img';
  function bind() {
    if (!io || RM) return;
    D.querySelectorAll('main h1, main h2').forEach(function (el) { if (!el.dataset.fxObs) { el.dataset.fxObs = 1; io.observe(el); } });
    D.querySelectorAll(NUM).forEach(function (el) { if (!el.dataset.fxObs) { el.dataset.fxObs = 1; io.observe(el); } });
    D.querySelectorAll(PHOTO).forEach(function (el) { if (!el.dataset.fxObs) { el.dataset.fxObs = 1; io.observe(el); } });
  }

  /* ---------------- v2: scroll progress ---------------- */
  var prog = null;
  function progress() {
    if (!prog) { prog = D.createElement('div'); prog.className = 'fx-prog'; prog.setAttribute('aria-hidden', 'true'); D.body.appendChild(prog); }
    var h = D.documentElement.scrollHeight - innerHeight; D.documentElement.style.setProperty('--fx-sp', (h > 0 ? Math.min(1, scrollY / h) : 0).toFixed(3)); prog.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0).toFixed(4) + ')';
  }

  /* ---------------- v2: tracing beam dọc danh sách học phần ---------------- */
  var TRACE = '.ex-list,[data-fx-trace]', traces = [];
  function bindTrace() {
    D.querySelectorAll(TRACE).forEach(function (el) {
      if (el.__fxTrace) return;
      var bar = D.createElement('div'); bar.className = 'fx-trace'; bar.setAttribute('aria-hidden', 'true'); bar.innerHTML = '<i></i><b></b>';
      D.body.appendChild(bar); el.__fxTrace = bar; traces.push(el);
    });
  }
  function updTrace() {
    for (var k = traces.length - 1; k >= 0; k--) {
      var el = traces[k], bar = el.__fxTrace;
      if (!el.isConnected) { bar.remove(); el.__fxTrace = null; traces.splice(k, 1); continue; }
      var r = el.getBoundingClientRect();
      if (r.height < 40 || r.bottom < -200 || r.top > innerHeight + 200) { bar.style.display = 'none'; continue; }
      bar.style.display = '';
      var x = Math.max(4, r.left - 14);
      bar.style.left = (x + scrollX) + 'px'; bar.style.top = (r.top + scrollY) + 'px'; bar.style.height = r.height + 'px';
      var p = Math.max(0, Math.min(1, (innerHeight * 0.62 - r.top) / r.height)), y = p * r.height;
      bar.firstChild.style.height = y + 'px'; bar.lastChild.style.top = y + 'px'; bar.lastChild.style.opacity = p > 0 && p < 1 ? '1' : '0';
      var items = el.children;
      for (var i = 0; i < items.length; i++) {
        var it = items[i]; if (getComputedStyle(it).display === 'contents' && it.firstElementChild) it = it.firstElementChild;
        var ir = it.getBoundingClientRect(); if (!ir.height) continue;
        var lit = ir.top - r.top + 8 <= y;
        if (lit && !it.hasAttribute('data-fx-lit')) it.setAttribute('data-fx-lit', ''); else if (!lit && it.hasAttribute('data-fx-lit')) it.removeAttribute('data-fx-lit');
      }
    }
  }

  /* ---------------- v2: animated beam nối các bước ---------------- */
  var beams = [], NS = 'http://www.w3.org/2000/svg';
  function bindBeam() {
    D.querySelectorAll('[data-fx-beam]').forEach(function (el) {
      if (el.__fxBeam) return;
      var svg = D.createElementNS(NS, 'svg'); svg.setAttribute('class', 'fx-beam'); svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = '<defs><linearGradient id="fxBeamGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4fd1b5" stop-opacity="0"/><stop offset=".45" stop-color="#4fd1b5"/><stop offset=".75" stop-color="#fe8f2d"/><stop offset="1" stop-color="#fe8f2d" stop-opacity="0"/></linearGradient></defs><path class="base"/><path class="glow"/>';
      D.body.appendChild(svg); el.__fxBeam = { svg: svg, t0: performance.now(), seen: false }; beams.push(el);
    });
  }
  function updBeam(now) {
    var any = false;
    for (var k = beams.length - 1; k >= 0; k--) {
      var el = beams[k], B = el.__fxBeam, svg = B.svg;
      if (!el.isConnected) { svg.remove(); beams.splice(k, 1); continue; }
      var r = el.getBoundingClientRect(), kids = Array.prototype.filter.call(el.children, function (c) { return c.getBoundingClientRect().height > 0; });
      var vis = r.bottom > 0 && r.top < innerHeight; if (!vis || kids.length < 2) { svg.style.display = 'none'; continue; }
      var rects = kids.map(function (c) { return c.getBoundingClientRect(); }), oneRow = rects.every(function (q) { return Math.abs(q.top - rects[0].top) < 24; });
      if (!B.seen) { B.seen = true; B.t0 = now; }
      var cyc = 4600, ph = ((now - B.t0) % cyc) / cyc, pos = Math.min(1, ph / 0.8), lead = Math.floor(pos * (kids.length - 1) + 0.02);
      kids.forEach(function (c, i) { var on = i <= lead && ph < 0.94; if (c.getAttribute('data-fx-step') !== (on ? 'on' : 'off')) c.setAttribute('data-fx-step', on ? 'on' : 'off'); });
      any = true;
      if (!oneRow) { svg.style.display = 'none'; continue; } // xếp nhiều hàng: chỉ sáng thẻ lần lượt, không vẽ đường
      svg.style.display = '';
      var top = rects[0].top, lift = 34, L = r.left, w = r.width + 20, h = lift + 14;
      svg.style.left = (L - 10 + scrollX) + 'px'; svg.style.top = (top - lift - 7 + scrollY) + 'px'; svg.setAttribute('width', w); svg.setAttribute('height', h);
      var pts = rects.map(function (q) { return [q.left + q.width / 2 - L + 10, lift + 7]; }), d = 'M' + pts[0][0] + ' ' + pts[0][1];
      for (var i = 1; i < pts.length; i++) { var a = pts[i - 1], b = pts[i]; d += ' C' + a[0] + ' ' + (a[1] - lift) + ' ' + b[0] + ' ' + (b[1] - lift) + ' ' + b[0] + ' ' + b[1]; }
      var base = svg.querySelector('.base'), glow = svg.querySelector('.glow'); base.setAttribute('d', d); glow.setAttribute('d', d);
      var len = glow.getTotalLength ? glow.getTotalLength() : 1000, seg = len * 0.2;
      glow.style.strokeDasharray = seg + ' ' + (len * 2); glow.style.strokeDashoffset = (seg - (ph / 0.8) * (len + seg)).toFixed(1);
      var g = svg.querySelector('linearGradient'); g.setAttribute('x1', pts[0][0]); g.setAttribute('x2', pts[pts.length - 1][0]);
      var cs = svg.querySelectorAll('circle'); if (cs.length !== pts.length) { cs.forEach(function (c) { c.remove(); }); pts.forEach(function () { var c = D.createElementNS(NS, 'circle'); c.setAttribute('r', 6); svg.appendChild(c); }); cs = svg.querySelectorAll('circle'); }
      pts.forEach(function (p, i) { cs[i].setAttribute('cx', p[0]); cs[i].setAttribute('cy', p[1]); cs[i].setAttribute('class', i <= lead && ph < 0.94 ? 'on' : ''); });
    }
    return any;
  }

  /* ---------------- v2: tilt nhẹ cho thẻ robot & ảnh thi đấu ---------------- */
  var TILT = '.kit-card,.mosaic>figure,.news-card,.job,.pol-card,article.lift,.soc-card,[data-fx-tilt-auto]';
  if (FINE && !RM && !LITE) {
    var tEl = null;
    D.addEventListener('pointermove', function (e) {
      var el = e.target.closest && e.target.closest(TILT);
      if (tEl && tEl !== el) { tEl.classList.remove('tilting'); tEl.style.rotate = ''; tEl = null; }
      if (!el) return; tEl = el; el.setAttribute('data-fx-tilt', ''); el.classList.add('tilting');
      var r = el.getBoundingClientRect(), nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      var ang = Math.min(7, Math.hypot(nx, ny) * 12);
      el.style.rotate = (-ny).toFixed(3) + ' ' + nx.toFixed(3) + ' 0 ' + ang.toFixed(2) + 'deg';
    }, { passive: true });
  }


  /* ---------------- v4: lưới sáng theo con trỏ, ảnh trượt, gợn sóng khi bấm ---------------- */
  if (FINE && !RM && !LITE) {
    var gEl = null, zEl = null;
    D.addEventListener('pointermove', function (e) {
      var t = e.target.closest ? e.target : null; if (!t) return;
      var g = t.closest('.gridbg');
      if (gEl && gEl !== g) { gEl.style.removeProperty('--gx'); gEl.style.removeProperty('--gy'); }
      gEl = g; if (g) { var r = g.getBoundingClientRect(); g.style.setProperty('--gx', (e.clientX - r.left).toFixed(0) + 'px'); g.style.setProperty('--gy', (e.clientY - r.top).toFixed(0) + 'px'); }
      var z = t.closest('.zoom');
      if (zEl && zEl !== z) { zEl.style.removeProperty('--zx'); zEl.style.removeProperty('--zy'); }
      zEl = z; if (z) { var q = z.getBoundingClientRect(); z.style.setProperty('--zx', ((e.clientX - q.left) / q.width - 0.5).toFixed(3)); z.style.setProperty('--zy', ((e.clientY - q.top) / q.height - 0.5).toFixed(3)); }
    }, { passive: true });
  }
  if (!RM && !LITE) {
    D.addEventListener('pointerdown', function (e) {
      if (!e.target.closest || !e.target.closest('a,button,.btn,[role=tab],summary,label')) return;
      var r = D.createElement('span'); r.className = 'fx-rip'; r.setAttribute('aria-hidden', 'true');
      r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; D.body.appendChild(r); setTimeout(function () { r.remove(); }, 650);
    }, { passive: true });
  }
  /* ---------------- v2: vòng lặp chung (chỉ chạy khi cần) ---------------- */
  var ticking = false, beamAlive = false;
  function tick(now) {
    ticking = false; progress(); updTrace();
    beamAlive = !RM && !LITE && updBeam(now || performance.now());
    if (beamAlive) { ticking = true; requestAnimationFrame(tick); }
  }
  function kick() { if (!ticking) { ticking = true; requestAnimationFrame(tick); } }
  addEventListener('scroll', kick, { passive: true }); addEventListener('resize', kick);

  /* ---------------- v3: đánh dấu vào/ra màn hình (dừng animation ngoài màn hình, kích hoạt hiệu ứng 1 lần) ---------------- */
  var zoneIo = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (en) { if (en.isIntersecting) { en.target.removeAttribute('data-fx-off'); if (!en.target.hasAttribute('data-fx-seen')) en.target.setAttribute('data-fx-seen', ''); } else en.target.setAttribute('data-fx-off', ''); });
  }, { rootMargin: '120px 0px' }) : null;
  var onceIo = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (en) { if (!en.isIntersecting) return; var el = en.target; onceIo.unobserve(el); el.setAttribute('data-fx-in', '');
      if (!el.classList.contains('label') && !el.classList.contains('head2') && !LITE) { setTimeout(function () { el.setAttribute('data-fx-pow', ''); setTimeout(function () { el.removeAttribute('data-fx-pow'); }, 650); }, 350); } });
  }, { threshold: 0, rootMargin: '0px 0px -12% 0px' }) : null;
  /* v5: hiện dần .sv MỘT LẦN khi vào màn hình (thay cho animation bám thanh cuộn) */
  var svIo = 'IntersectionObserver' in window ? new IntersectionObserver(function (es) {
    es.forEach(function (en) { if (!en.isIntersecting) return; svIo.unobserve(en.target); en.target.setAttribute('data-fx-sv', ''); });
  }, { threshold: 0, rootMargin: '0px 0px -6% 0px' }) : null;
  function bindSv() {
    D.querySelectorAll('.sv').forEach(function (el) { if (el.__fxSv) return; el.__fxSv = 1; if (svIo && !RM) svIo.observe(el); else el.setAttribute('data-fx-sv', ''); });
  }
  function bindZones() {
    bindSv();
    if (zoneIo) D.querySelectorAll('section,header,footer,.cta-band').forEach(function (el) { if (!el.__fxZone) { el.__fxZone = 1; zoneIo.observe(el); } });
    if (onceIo && !RM) D.querySelectorAll('.label.mono,.head2,.card,.course-card,.news-card,.job,.pol-card,article,.plan,.phase,.fact').forEach(function (el) { if (!el.__fxOnce) { el.__fxOnce = 1; onceIo.observe(el); } });
  }
  function start() {
    boot(); bind(); bindTrace(); bindBeam(); bindZones(); kick();
    var t = null; new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { bind(); bindTrace(); bindBeam(); bindZones(); kick(); }, 120); }).observe(D.body, { childList: true, subtree: true });
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', start); else start();
})();
