/* ================================================================
 *   كنّر · Connor
 *   خطّ النصّ — the script
 *
 *   ملاحظةٌ للقارئ:
 *     إنْ وصلتَ إلى هنا، فأنتَ قريبٌ من السرّ.
 *     في الأعلى خرطوشٌ، وفي الخرطوشِ اسمٌ.
 *     اِجمعِ الحروفَ، ثمّ نادِ في الكونسول:
 *
 *         حلّ('...')
 *
 *   a note to the reader:
 *     if you are here, you are close to the secret.
 *     there is a cartouche above. inside it is a name.
 *     gather the letters, then call in the console:
 *
 *         حلّ('...')
 * ================================================================ */

'use strict';

/* ------------------------------------------------------------------
 * ١ · الإعدادات — configuration
 * ------------------------------------------------------------------ */

const الإعدادات = {
    السرّ:   'CONNOR',
    الرموز:  '𓂀𓆣𓋹𓁹𓊽𓀀𓋴𓂧𓏏𓅓𓎡𓅱𓈖𓂋𓏭𓇳𓊖𓃭𓅓𓆑',
    عدد_الجسيمات: 28,

    عبارات: [
        { ع: 'من رأى، لم يَرَ كلَّ شيء.',           إ: 'who saw, did not see everything.' },
        { ع: 'البياناتُ هي الحجرُ، لا النموذج.',    إ: 'the data is the stone. the model is the dust.' },
        { ع: 'كلُّ حدٍّ أماميّ كان يوماً ظلاماً.',   إ: 'every frontier was once dark.' },
        { ع: 'لا تَخَف من الصفحة البيضاء.',         إ: 'do not fear the blank page.' },
        { ع: 'اِقرأ ما كُتب، ثم اقرأ ما لم يُكتب.',  إ: 'read what is written, then what is not.' },
    ],
};


/* ------------------------------------------------------------------
 * ٢ · طبقة الخلفية — ambient hieroglyph drift
 *     رموزٌ تطفو صعوداً كالرمل في الظلّ.
 *     glyphs drift upward like sand in shadow.
 * ------------------------------------------------------------------ */

class جسيم {
    constructor(العرض, الارتفاع) {
        this.تَهَيَّأ(العرض, الارتفاع, true);
    }
    تَهَيَّأ(العرض, الارتفاع, أوّلَ_مرّة = false) {
        this.س = Math.random() * العرض;
        this.ص = أوّلَ_مرّة
            ? Math.random() * الارتفاع
            : الارتفاع + Math.random() * 60;
        this.حجم   = 14 + Math.random() * 26;
        this.سرعة  = 0.06 + Math.random() * 0.22;
        this.شفافيّة = 0.03 + Math.random() * 0.08;
        this.انجراف = (Math.random() - 0.5) * 0.12;
        this.الرمز = الإعدادات.الرموز[
            Math.floor(Math.random() * الإعدادات.الرموز.length)
        ];
    }
    حدّث(العرض, الارتفاع) {
        this.ص -= this.سرعة;
        this.س += this.انجراف;
        if (this.ص < -40)       this.تَهَيَّأ(العرض, الارتفاع);
        if (this.س < -40)       this.س = العرض + 20;
        if (this.س > العرض+40)  this.س = -20;
    }
    ارسم(قلم) {
        قلم.globalAlpha = this.شفافيّة;
        قلم.font = `${this.حجم}px "Noto Sans Egyptian Hieroglyphs", serif`;
        قلم.fillText(this.الرمز, this.س, this.ص);
    }
}

const ابدأ_الخلفية = () => {
    const اللوحة = document.getElementById('الخلفية');
    if (!اللوحة) return;
    const قلم = اللوحة.getContext('2d');
    let العرض = 0, الارتفاع = 0;

    const لائم_المقاس = () => {
        const ن = window.devicePixelRatio || 1;
        العرض    = window.innerWidth;
        الارتفاع = window.innerHeight;
        اللوحة.width  = العرض * ن;
        اللوحة.height = الارتفاع * ن;
        اللوحة.style.width  = العرض + 'px';
        اللوحة.style.height = الارتفاع + 'px';
        قلم.setTransform(ن, 0, 0, ن, 0, 0);
        قلم.fillStyle = '#e8e6e3';
    };
    لائم_المقاس();
    window.addEventListener('resize', لائم_المقاس);

    const الجسيمات = Array.from(
        { length: الإعدادات.عدد_الجسيمات },
        () => new جسيم(window.innerWidth, window.innerHeight)
    );

    const حلقة = () => {
        قلم.clearRect(0, 0, العرض, الارتفاع);
        for (const ج of الجسيمات) {
            ج.حدّث(العرض, الارتفاع);
            ج.ارسم(قلم);
        }
        requestAnimationFrame(حلقة);
    };
    حلقة();
};


/* ------------------------------------------------------------------
 * ٣ · الكاتب — bilingual typewriter, cycles through `عبارات`
 *     نكتبُ حرفاً، ثمّ نَسكت، ثمّ نَمحو.
 *     we write a letter, we pause, we erase.
 * ------------------------------------------------------------------ */

const ابدأ_الكاتب = () => {
    const المقصد = document.getElementById('الكاتب');
    if (!المقصد) return;

    let فهرس = 0;
    let منوي = 'اكتب';       // 'اكتب' | 'توقّف' | 'امحُ' | 'تالٍ'
    let حرفٌ = 0;

    const المُهلة = {
        اكتب: 48,
        امحُ: 24,
        توقّف: 2400,
        تالٍ: 500,
    };

    const خطوة = () => {
        const { ع } = الإعدادات.عبارات[فهرس];

        if (منوي === 'اكتب') {
            حرفٌ++;
            المقصد.textContent = ع.slice(0, حرفٌ);
            المقصد.setAttribute('dir', 'rtl');
            if (حرفٌ >= ع.length) منوي = 'توقّف';
            return setTimeout(خطوة, المُهلة.اكتب + Math.random() * 40);
        }

        if (منوي === 'توقّف') {
            منوي = 'امحُ';
            return setTimeout(خطوة, المُهلة.توقّف);
        }

        if (منوي === 'امحُ') {
            حرفٌ--;
            المقصد.textContent = ع.slice(0, حرفٌ);
            if (حرفٌ <= 0) منوي = 'تالٍ';
            return setTimeout(خطوة, المُهلة.امحُ);
        }

        if (منوي === 'تالٍ') {
            فهرس = (فهرس + 1) % الإعدادات.عبارات.length;
            منوي = 'اكتب';
            return setTimeout(خطوة, المُهلة.تالٍ);
        }
    };

    خطوة();
};


/* ------------------------------------------------------------------
 * ٤ · إضاءة البطاقات — card spotlight follows cursor
 *     ظِلٌّ ذهبيٌّ يتبعُ أصبعَ الفأرة.
 * ------------------------------------------------------------------ */

const ابدأ_البطاقات = () => {
    const البطاقات = document.querySelectorAll('.card');
    البطاقات.forEach(بطاقة => {
        بطاقة.addEventListener('mousemove', (ح) => {
            const حيز = بطاقة.getBoundingClientRect();
            const مس = ((ح.clientX - حيز.left) / حيز.width)  * 100;
            const مص = ((ح.clientY - حيز.top)  / حيز.height) * 100;
            بطاقة.style.setProperty('--mx', `${مس}%`);
            بطاقة.style.setProperty('--my', `${مص}%`);
        });
    });
};


/* ------------------------------------------------------------------
 * ٥ · ظهور الأقسام — fade sections in on scroll
 * ------------------------------------------------------------------ */

const ابدأ_الظهور = () => {
    const الأقسام = document.querySelectorAll('section, footer.contact');
    const مُراقِب = new IntersectionObserver((دخولات) => {
        for (const د of دخولات) {
            if (د.isIntersecting) {
                د.target.classList.add('in-view');
                مُراقِب.unobserve(د.target);
            }
        }
    }, { threshold: 0.08 });
    الأقسام.forEach(ق => مُراقِب.observe(ق));
};


/* ------------------------------------------------------------------
 * ٦ · الكشف — the reveal (easter egg payload)
 *     إنْ نطقتَ اسمي، فتحتُ لكَ البابَ الأخير.
 *     if you speak my name, I open the last door.
 * ------------------------------------------------------------------ */

const رسم_العين = `
  <svg class="reveal-eye" viewBox="0 0 300 220" aria-hidden="true">
    <path d="
      M 20 95
      Q 90 35, 170 55
      Q 230 65, 275 95
      M 70 95
      Q 100 55, 150 55
      Q 210 55, 245 95
      Q 210 135, 150 135
      Q 100 135, 70 95 Z
      M 150 78
      Q 172 78, 172 98
      Q 172 118, 150 118
      Q 128 118, 128 98
      Q 128 78, 150 78 Z
      M 150 135
      L 158 175
      L 135 180
      M 180 128
      Q 215 158, 205 200
      Q 190 218, 175 200
      Q 165 180, 182 160
    "/>
  </svg>
`;

const بناء_الكشف = () => {
    const ط = document.getElementById('الكشف');
    if (!ط) return;
    ط.innerHTML = `
        ${رسم_العين}
        <p class="reveal-verse" dir="rtl" lang="ar">
            السلامُ عليكَ، يا قارئَ الشيفرة.<br>
            أنتَ من القِلّة.
        </p>
        <p class="reveal-sub" lang="en">
            peace to you, reader of the cipher. you are of the few.
        </p>
        <div class="reveal-glyphs" aria-hidden="true">𓂀 · 𓋹 · 𓊽 · 𓆣 · 𓁹</div>
        <p class="reveal-dismiss">click anywhere, or press esc</p>
    `;
    ط.classList.add('open');
    ط.setAttribute('aria-hidden', 'false');

    const أغلق = () => {
        ط.classList.remove('open');
        ط.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', عند_المفتاح);
        ط.removeEventListener('click', أغلق);
        setTimeout(() => { ط.innerHTML = ''; }, 1000);
    };
    const عند_المفتاح = (ح) => { if (ح.key === 'Escape') أغلق(); };

    ط.addEventListener('click', أغلق);
    document.addEventListener('keydown', عند_المفتاح);
};

// الدالّة المكشوفة للعالم · the function exposed on window
window.حلّ = function (المفتاح) {
    if (!المفتاح) {
        console.log(
            '%c اِقرأ الخرطوش في الأعلى. كلُّ علامةٍ تحتَها حرف. اِجمعها.',
            'color:#c9a961; font:14px "Amiri", serif'
        );
        console.log(
            '%c read the cartouche above. each glyph hides a letter.',
            'color:#7a7770; font:12px monospace'
        );
        return undefined;
    }
    const مُنَظَّف = String(المفتاح).trim().toUpperCase();
    if (مُنَظَّف === الإعدادات.السرّ) {
        بناء_الكشف();
        return '𓂀';
    }
    console.log(
        '%c ليس بعد. انظر مرّةً أخرى.',
        'color:#7a7770; font:13px "Amiri", serif'
    );
    return undefined;
};

// اسم مستعار باللاتينيّة، للذين لا تتوفّر لهم لوحة عربيّة
// latin alias for folks without an Arabic keyboard
window.hal = window.حلّ;


/* ------------------------------------------------------------------
 * ٧ · تحيّة الكونسول — the console welcome (the bread crumb)
 * ------------------------------------------------------------------ */

const طبع_التحيّة = () => {
    const ن_برونز = 'color:#c9a961; font:14px "JetBrains Mono", monospace; letter-spacing:0.1em';
    const ن_عربي  = 'color:#e8e6e3; font:18px "Amiri", serif; line-height:1.8';
    const ن_مكتوم = 'color:#7a7770; font:12px "JetBrains Mono", monospace';
    const ن_هيرو  = 'color:#c9a961; font:36px "Noto Sans Egyptian Hieroglyphs", serif';

    console.log('%c\n  𓂀\n', ن_هيرو);
    console.log('%cالسلامُ عليكَ، أيّها الناظرُ في المصدر.', ن_عربي);
    console.log('%cpeace to you, who looks at the source.', ن_مكتوم);
    console.log('%c', '');
    console.log('%cفي الخرطوشِ فوق، اسمي بالرموز القديمة.', ن_عربي);
    console.log('%cاِقرأ كلَّ علامةٍ بالترتيب، ثم نادِ:', ن_عربي);
    console.log('%c\n    حلّ(\'...\')\n', ن_برونز);
    console.log('%c(أو "hal(...)" إن لم تكن لوحتُكَ عربيّة)', ن_مكتوم);
    console.log('%c—————————————————————————————', ن_مكتوم);
};


/* ------------------------------------------------------------------
 * ٨ · التهيئة — init, the one place where everything starts
 * ------------------------------------------------------------------ */

const التهيئة = () => {
    ابدأ_الخلفية();
    ابدأ_الكاتب();
    ابدأ_البطاقات();
    ابدأ_الظهور();
    طبع_التحيّة();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', التهيئة);
} else {
    التهيئة();
}
