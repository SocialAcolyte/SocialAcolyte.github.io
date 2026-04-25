/*
 *  ▓  السلام عليكم.
 *  ▓  this file is written with arabic identifiers because beauty matters.
 *  ▓
 *  ▓  three concerns:
 *  ▓    ١  ambient drift of glyphs in the background (very low alpha)
 *  ▓    ٢  console greeting + a hint to the easter egg
 *  ▓    ٣  window.حل  — call it with the right answer to unlock
 */

(() => {
    'use strict';

    /* ─── ١  الخلفية — ambient hieroglyph drift ─────────────────── */

    const لوحة  = document.getElementById('الخلفية');
    const سياق  = لوحة.getContext('2d');

    const الحروف = [
        '𓂀','𓊽','𓋹','𓍑','𓎡','𓅱','𓈖','𓂋','𓁶','𓆣',
        '𓏏','𓊵','𓇋','𓆑','𓏛','𓂝','𓎟','𓀀','𓀞','𓁹',
    ];

    const نسبة_البكسل = Math.min(window.devicePixelRatio || 1, 2);

    let عرض = 0;
    let ارتفاع = 0;
    let جسيمات = [];
    let كثافة = 1;          /* lifted briefly when easter egg solved */

    function اختر_حرفًا() {
        return الحروف[(Math.random() * الحروف.length) | 0];
    }

    function جسيم_جديد(تشتيت = false) {
        return {
            x: Math.random() * عرض,
            y: تشتيت ? Math.random() * ارتفاع : -40 - Math.random() * 80,
            رمز: اختر_حرفًا(),
            حجم: 14 + Math.random() * 18,
            سرعة: 0.06 + Math.random() * 0.16,
            وميض: Math.random() * Math.PI * 2,
            دوران: (Math.random() - 0.5) * 0.0008,
        };
    }

    function ضبط_المقاس() {
        /* never assign to clientWidth/clientHeight — they're read-only.
           size via CSS, then back the canvas with a scaled bitmap. */
        عرض   = window.innerWidth;
        ارتفاع = window.innerHeight;

        لوحة.style.width  = عرض   + 'px';
        لوحة.style.height = ارتفاع + 'px';
        لوحة.width  = عرض   * نسبة_البكسل;
        لوحة.height = ارتفاع * نسبة_البكسل;

        سياق.setTransform(1, 0, 0, 1, 0, 0);
        سياق.scale(نسبة_البكسل, نسبة_البكسل);

        /* sparse density — roughly one glyph per 16,000 px² */
        const عدد = Math.max(8, Math.floor((عرض * ارتفاع) / 16000));
        جسيمات = Array.from({ length: عدد }, () => جسيم_جديد(true));
    }

    function ٱرسم() {
        سياق.clearRect(0, 0, عرض, ارتفاع);
        سياق.textBaseline = 'top';

        for (const ج of جسيمات) {
            ج.y    += ج.سرعة;
            ج.وميض += 0.012;

            if (ج.y > ارتفاع + 50) {
                Object.assign(ج, جسيم_جديد(false));
            }

            const وميض_موحد = (Math.sin(ج.وميض) + 1) / 2;
            const ألفا = (0.022 + 0.030 * وميض_موحد) * كثافة;

            سياق.fillStyle = `rgba(201, 169, 97, ${ألفا})`;
            سياق.font      = `${ج.حجم}px 'Noto Sans Egyptian Hieroglyphs', serif`;
            سياق.fillText(ج.رمز, ج.x, ج.y);
        }

        if (كثافة > 1) كثافة = Math.max(1, كثافة - 0.008);

        requestAnimationFrame(ٱرسم);
    }

    let مهلة_تغيير_الحجم;
    window.addEventListener('resize', () => {
        clearTimeout(مهلة_تغيير_الحجم);
        مهلة_تغيير_الحجم = setTimeout(ضبط_المقاس, 120);
    });

    ضبط_المقاس();
    requestAnimationFrame(ٱرسم);

    /* ─── ٢  ترحيب — console greeting ──────────────────────────── */

    const ترحيب = [
        '',
        '   ▓  السلام عليكم.   peace.',
        '   ▓',
        '   ▓  في الزاوية خرطوشٌ — كلّ علامةٍ فيه حرف.',
        '   ▓  in the corner is a cartouche — each glyph is a letter.',
        '   ▓',
        '   ▓  اِقرأها بالترتيب، ثم نادِ:',
        '   ▓  read them in order, then call:',
        '   ▓',
        '   ▓        حل("?????")',
        '   ▓                                         — كنّر',
        '',
    ].join('\n');

    console.log(
        '%c' + ترحيب,
        'color:#c9a961; font-family:"JetBrains Mono", monospace; font-size:12px; line-height:1.55;'
    );

    /* ─── ٣  حل — the easter egg ───────────────────────────────── */

    const جواب_صحيح = 'CONNOR';
    const خرطوش    = document.getElementById('خرطوش');
    const مكشوف    = document.getElementById('مكشوف');
    let   مفتوح    = false;

    function افتح() {
        if (مفتوح) return;
        مفتوح = true;
        خرطوش.classList.add('مفتوح');
        مكشوف.classList.add('ظاهر');
        مكشوف.setAttribute('aria-hidden', 'false');
        كثافة = 4.2;
    }

    window.حل = function (جواب) {
        if (typeof جواب !== 'string') {
            console.log(
                '%c↪  نادِ بكلمة:  حل("الجواب")\n   call with a word: حل("answer")',
                'color:#8a857d; font-family:"JetBrains Mono",monospace; font-size:12px;'
            );
            return undefined;
        }
        const منقى = جواب.toUpperCase().replace(/[^A-Z]/g, '');
        if (منقى === جواب_صحيح) {
            افتح();
            console.log(
                '%c✓  صحيح. تشكر.   correct. thank you for looking. 𓂀',
                'color:#c9a961; font-family:"JetBrains Mono",monospace; font-size:12px;'
            );
            return '𓂀';
        }
        console.log(
            '%c✗  ليس بَعد. جرّب ثانيةً.   not yet. try again.',
            'color:#8a857d; font-family:"JetBrains Mono",monospace; font-size:12px;'
        );
        return null;
    };
    /* a quieter alias for non-arabic keyboards */
    window.solve = window.حل;

    /* ─── tiny eye, top-right: a soft pull on the drift ────────── */

    const عين = document.querySelector('.نظرة');
    if (عين) {
        عين.addEventListener('click', (حدث) => {
            حدث.preventDefault();
            كثافة = Math.max(كثافة, 2.4);
            console.log(
                '%c↪  اُنظر في المصدر.   look in the source.',
                'color:#c9a961; font-family:"JetBrains Mono",monospace; font-size:12px;'
            );
        });
    }
})();
