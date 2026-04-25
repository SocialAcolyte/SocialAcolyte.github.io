/* ================================================================
 *   Connor · كنّر — الخطّ · the script
 *
 *   معجم الرموز — glyph glossary
 *   ─────────────────────────────────────────────────────────
 *     𓂀   eye of horus     · the reveal / the secret
 *     𓋹   ankh · life      · init / start
 *     𓆣   scarab · drift   · ambient particle
 *     𓂋   mouth · speak    · draw / type
 *     𓊽   djed pillar      · update / step
 *     𓊖   settlement       · the config
 *     𓎛   twisted flax (h) · 'hail' — easter egg alias
 *     𓇳   sun disc         · loop
 *     𓏏   bread (t)        · small helper
 *     𓈖   water (n)        · list
 *     𓁹   eye              · console / sight
 *   ─────────────────────────────────────────────────────────
 *
 *   ملاحظةٌ لمن قرأ المصدر:
 *     في المحطّةِ خرطوشٌ، وفيه اسمٌ. نَطقُ الاسمِ مفتاحٌ.
 *     جرّبْ في المحطّةِ:   connor   ·   horus   ·   cipher
 *     أو في الكونسول:    حلّ('CONNOR')   ·   𓎛('CONNOR')
 *
 *   a note to readers of the source:
 *     the terminal has a cartouche. saying the name is a key.
 *     try in the terminal:    connor    ·    horus    ·    cipher
 *     or in this console:     حلّ('CONNOR')   ·   𓎛('CONNOR')
 * ================================================================ */

'use strict';


/* ------------------------------------------------------------------
 * ١ · القرية · 𓊖 — config
 * ------------------------------------------------------------------ */

const 𓊖 = {
    السرّ:  'CONNOR',
    رموز:   '𓂀𓆣𓋹𓁹𓊽𓀀𓋴𓂧𓏏𓅓𓎡𓅱𓈖𓂋𓏭𓇳𓊖𓃭𓅓𓆑',
    عدد:    24,
    مفاتيح_السرّ: ['connor','kennor','kannar','horus','cipher','egg','secret','sesame','open','حلّ','حل','كنّر','كنر','خرطوش','cartouche','𓎛','𓂀'],
};


/* ------------------------------------------------------------------
 * ٢ · الجُعَل · 𓆣 — ambient drift particle
 * ------------------------------------------------------------------ */

class 𓆣 {
    constructor(و, ه) { this.𓋹(و, ه, true); }
    𓋹(و, ه, أوّل = false) {
        this.س   = Math.random() * و;
        this.ص   = أوّل ? Math.random() * ه : ه + Math.random() * 60;
        this.حجم = 14 + Math.random() * 24;
        this.سرعة  = 0.04 + Math.random() * 0.18;
        this.𓈞  = 0.02 + Math.random() * 0.06;
        this.𓇋  = (Math.random() - 0.5) * 0.1;
        this.𓏏  = 𓊖.رموز[Math.floor(Math.random() * 𓊖.رموز.length)];
    }
    𓊽(و, ه) {
        this.ص -= this.سرعة;
        this.س += this.𓇋;
        if (this.ص < -40)    this.𓋹(و, ه);
        if (this.س < -40)    this.س = و + 20;
        if (this.س > و + 40) this.س = -20;
    }
    𓂋(قلم) {
        قلم.globalAlpha = this.𓈞;
        قلم.font = `${this.حجم}px "Noto Sans Egyptian Hieroglyphs", serif`;
        قلم.fillText(this.𓏏, this.س, this.ص);
    }
}

const 𓆣𓋹 = () => {
    const لوحة = document.getElementById('𓆣');
    if (!لوحة) return;
    const قلم = لوحة.getContext('2d');
    let و = 0, ه = 0;
    const لائم = () => {
        const ن = window.devicePixelRatio || 1;
        و = window.innerWidth;
        ه = window.innerHeight;
        لوحة.width  = و * ن;
        لوحة.height = ه * ن;
        لوحة.style.width  = و + 'px';
        لوحة.style.height = ه + 'px';
        قلم.setTransform(ن, 0, 0, ن, 0, 0);
        قلم.fillStyle = '#e8e4dc';
    };
    لائم();
    window.addEventListener('resize', لائم);
    const 𓈖 = Array.from({ length: 𓊖.عدد },
        () => new 𓆣(window.innerWidth, window.innerHeight));
    const 𓇳 = () => {
        قلم.clearRect(0, 0, و, ه);
        for (const ج of 𓈖) { ج.𓊽(و, ه); ج.𓂋(قلم); }
        requestAnimationFrame(𓇳);
    };
    𓇳();
};


/* ------------------------------------------------------------------
 * ٣ · المخرج — output helpers
 *     طبع · print a row
 *     اكتب · type a row character by character
 *     نَم · sleep
 * ------------------------------------------------------------------ */

const الإخراج  = () => document.getElementById('output');
const الأمر    = () => document.getElementById('cmd');
const السطر    = () => document.getElementById('line');

const نَم = (ms) => new Promise(r => setTimeout(r, ms));

const حماية = (s) => String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const طبع = (html = '') => {
    const o = الإخراج();
    if (!o) return null;
    const div = document.createElement('div');
    div.className = 'row';
    div.innerHTML = html;
    o.appendChild(div);
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' });
    return div;
};

const اكتب = async (نص, خيارات = {}) => {
    const o = الإخراج();
    const div = document.createElement('div');
    div.className = 'row ' + (خيارات.cls || '');
    o.appendChild(div);
    const سرعة     = خيارات.سرعة     ?? 14;
    const عشوائيّة  = خيارات.عشوائيّة  ?? 14;
    for (const ch of نص) {
        div.textContent += ch;
        await نَم(سرعة + Math.random() * عشوائيّة);
    }
    return div;
};


/* ------------------------------------------------------------------
 * ٤ · الأوامر — command registry
 * ------------------------------------------------------------------ */

const الأوامر = {

    help: () => طبع(`
<span class="t-fade">   commands</span>

   <span class="t-glyph-d">𓂀</span>  <span class="t-key">about</span>       the bio
   <span class="t-glyph-d">𓂀</span>  <span class="t-key">work</span>        what i'm building
   <span class="t-glyph-d">𓂀</span>  <span class="t-key">thesis</span>      download the document
   <span class="t-glyph-d">𓂀</span>  <span class="t-key">contact</span>     where to find me
   <span class="t-glyph-d">𓂀</span>  <span class="t-key">decode</span>      the cipher above
   <span class="t-glyph-d">𓂀</span>  <span class="t-key">whoami</span>      reprint the cartouche
   <span class="t-glyph-d">𓂀</span>  <span class="t-key">ls</span>          list everything
   <span class="t-glyph-d">𓂀</span>  <span class="t-key">clear</span>       wipe the screen
`),

    whoami: () => طبع(`
   <span class="t-cipher" title="C · basket">𓎡</span>   <span class="t-cipher" title="O · quail chick">𓅱</span>   <span class="t-cipher" title="N · water ripple">𓈖</span>   <span class="t-cipher" title="N · water ripple">𓈖</span>   <span class="t-cipher" title="O · quail chick">𓅱</span>   <span class="t-cipher" title="R · mouth">𓂋</span>
   <span class="t-rule">───────────────────</span>

   <span class="t-big">CONNOR</span>      <span class="t-ar">كنّر</span>

   <span class="t-dim">21  ·  b. 2003  ·  Riyadh → SF</span>

   "I build <span class="t-em">the datasets</span> that unlock what
    frontier models cannot yet do."

   <span class="t-fade">type 'help' for commands · 'decode' for the cipher</span>
`),

    about: () => طبع(`
   I'm Connor. 21. I grew up between two alphabets
   and never trusted either one to hold the whole
   truth alone.

   I build machine-learning datasets — the unglamorous
   material that decides what the next model can and
   cannot do. Most of the gap between what frontier AI
   promises and what it delivers lives inside the data.
   I want to close it.

   Currently raising a seed round to do this at the
   scale it deserves.
`),

    work: () => طبع(`
   <span class="t-glyph">𓂧</span>  <span class="t-key">I.   Frontier datasets</span>
       curated, adversarial, domain-deep — the kind
       of data you cannot scrape, only design.

   <span class="t-glyph">𓆣</span>  <span class="t-key">II.  A seed round</span>
       raising now. <a class="t-link" href="https://x.com/SocialAcolyte" target="_blank" rel="noopener">dm on x →</a>

   <span class="t-glyph">𓏏</span>  <span class="t-key">III. A written thesis</span>
       the full argument in one document.
       <a class="t-link" href="buisness strategy.pdf" download>download pdf ↓</a>
`),

    thesis: () => طبع(`
   The full argument, in one document.

   <a class="t-link" href="buisness strategy.pdf" download>download → buisness strategy.pdf</a>
`),

    contact: () => طبع(`
   <span class="t-glyph">𓊽</span>  <a class="t-link" href="https://www.linkedin.com/in/" target="_blank" rel="noopener">linkedin</a>
   <span class="t-glyph">𓊽</span>  <a class="t-link" href="https://github.com/SocialAcolyte" target="_blank" rel="noopener">github   · @SocialAcolyte</a>
   <span class="t-glyph">𓊽</span>  <a class="t-link" href="https://x.com/SocialAcolyte" target="_blank" rel="noopener">x        · @SocialAcolyte</a>
`),

    links: () => الأوامر.contact(),

    decode: () => طبع(`
   The cartouche above is a name. Each glyph is a
   phonetic Egyptian letter:

       <span class="t-glyph">𓎡</span>  →  <span class="t-key">C</span>     (basket)
       <span class="t-glyph">𓅱</span>  →  <span class="t-key">O / W</span> (quail chick)
       <span class="t-glyph">𓈖</span>  →  <span class="t-key">N</span>     (water ripple)
       <span class="t-glyph">𓂋</span>  →  <span class="t-key">R</span>     (mouth)

   <span class="t-fade">type the name to open something.</span>
`),

    ls: () => طبع(`
   about    work    thesis   contact   decode
   whoami   help    clear    ls
   <span class="t-rule">───</span>
   <span class="t-dim">buisness strategy.pdf</span>*
`),

    clear: () => { const o = الإخراج(); if (o) o.innerHTML = ''; },

    '': () => {},
};


/* ------------------------------------------------------------------
 * ٥ · المنفّذ — dispatcher
 * ------------------------------------------------------------------ */

const تاريخ = [];
let فهرس_التاريخ = -1;

const أنفّذ = (مدخل) => {
    const نص = String(مدخل ?? '').trim();
    const مفتاح = نص.toLowerCase();

    // echo the command line as if user typed it
    if (نص) {
        طبع(`<span class="t-prompt">𓂀&nbsp;~&nbsp;$&nbsp;</span><span class="t-cmd">${حماية(نص)}</span>`);
    } else {
        طبع(`<span class="t-prompt">𓂀&nbsp;~&nbsp;$&nbsp;</span>`);
        return;
    }

    تاريخ.push(نص);
    فهرس_التاريخ = -1;

    // hidden trigger — easter egg
    if (𓊖.مفاتيح_السرّ.includes(مفتاح) || مفتاح === 𓊖.السرّ.toLowerCase()) {
        طبع(`<span class="t-glyph">𓂀</span>  <span class="t-em">opening...</span>`);
        setTimeout(𓂀𓋹, 320);
        return;
    }

    if (مفتاح in الأوامر) {
        الأوامر[مفتاح]();
    } else {
        طبع(`<span class="t-dim">command not found: </span>${حماية(نص)}<span class="t-dim"> · type 'help'</span>`);
    }
};


/* ------------------------------------------------------------------
 * ٦ · الإقلاع — boot sequence on load
 * ------------------------------------------------------------------ */

const أقلِع = async () => {
    const ل = السطر();
    if (!ل || !الإخراج()) return;
    ل.classList.add('hidden');

    await نَم(280);
    await اكتب('▓  booting stele.os 0.4.1 ...',         { cls: 't-dim',  سرعة: 7,  عشوائيّة: 8  });
    await نَم(140);
    await اكتب('▓  loading hieroglyphs   ............ ok  (4096 signs)', { cls: 't-dim', سرعة: 5, عشوائيّة: 6 });
    await نَم(120);
    await اكتب('▓  mounting cartouche    ............ ok',          { cls: 't-dim', سرعة: 5, عشوائيّة: 6 });
    await نَم(120);
    await اكتب('▓  loading السلام        ............ ok',          { cls: 't-dim', سرعة: 5, عشوائيّة: 6 });
    await نَم(160);
    await اكتب('▓  welcome.',                                       { cls: 't-dim', سرعة: 8, عشوائيّة: 8 });
    await نَم(620);

    // fake-typed first command
    await اكتب('𓂀 ~ $ whoami',                                     { cls: 't-prompt', سرعة: 36, عشوائيّة: 30 });
    await نَم(220);
    الأوامر.whoami();
    await نَم(800);

    await اكتب('𓂀 ~ $ help',                                       { cls: 't-prompt', سرعة: 36, عشوائيّة: 30 });
    await نَم(180);
    الأوامر.help();
    await نَم(140);

    ل.classList.remove('hidden');
    الأمر().focus();
};


/* ------------------------------------------------------------------
 * ٧ · الكشف — easter egg reveal
 * ------------------------------------------------------------------ */

const 𓂀_العين = `
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

const 𓂀𓋹 = () => {
    const طبقة = document.getElementById('𓂀');
    if (!طبقة) return;
    طبقة.innerHTML = `
        ${𓂀_العين}
        <p class="reveal-verse" dir="rtl" lang="ar">
            السلامُ عليكَ، يا قارئَ الشيفرة.<br>
            أنتَ من القِلّة.
        </p>
        <p class="reveal-sub">peace to you · reader of the cipher · you are of the few</p>
        <div class="reveal-glyphs" aria-hidden="true">𓂀 · 𓋹 · 𓊽 · 𓆣 · 𓁹</div>
        <p class="reveal-dismiss">click anywhere · esc to dismiss</p>
    `;
    طبقة.classList.add('open');
    طبقة.setAttribute('aria-hidden', 'false');

    const أغلق = () => {
        طبقة.classList.remove('open');
        طبقة.setAttribute('aria-hidden', 'true');
        document.removeEventListener('keydown', عند_المفتاح);
        طبقة.removeEventListener('click', أغلق);
        setTimeout(() => { طبقة.innerHTML = ''; الأمر()?.focus(); }, 1000);
    };
    const عند_المفتاح = (𓂧) => { if (𓂧.key === 'Escape') أغلق(); };

    طبقة.addEventListener('click', أغلق);
    document.addEventListener('keydown', عند_المفتاح);
};

/* exposed: arabic, latin, hieroglyph */
const حلّ = function (𓏏) {
    if (!𓏏) {
        console.log(
            '%c اِقرأ الخرطوش في المحطّة. كلُّ علامةٍ تحتَها حرف.',
            'color:#c9a961; font:14px "Amiri", serif'
        );
        console.log(
            '%c read the cartouche · each glyph hides a letter',
            'color:#7a7468; font:12px monospace'
        );
        return undefined;
    }
    const مُنَظَّف = String(𓏏).trim().toUpperCase();
    if (مُنَظَّف === 𓊖.السرّ) {
        𓂀𓋹();
        return '𓂀';
    }
    console.log('%c ليس بعد. انظر مرّةً أخرى.', 'color:#7a7468; font:13px "Amiri", serif');
    return undefined;
};
window.حلّ   = حلّ;
window.hal   = حلّ;
window['𓎛'] = حلّ;


/* ------------------------------------------------------------------
 * ٨ · 𓁹𓋹 — console welcome
 * ------------------------------------------------------------------ */

const 𓁹𓋹 = () => {
    const ن_برونز = 'color:#c9a961; font:14px "JetBrains Mono", monospace; letter-spacing:0.1em';
    const ن_واجهة = 'color:#e8e4dc; font:14px "JetBrains Mono", monospace';
    const ن_عربي  = 'color:#e8e4dc; font:16px "Amiri", serif';
    const ن_مكتوم = 'color:#7a7468; font:12px "JetBrains Mono", monospace';
    const ن_هيرو  = 'color:#c9a961; font:36px "Noto Sans Egyptian Hieroglyphs", serif';

    console.log('%c\n  𓂀\n', ن_هيرو);
    console.log('%cHello, reader of the source.', ن_واجهة);
    console.log('%cالسلامُ عليكَ، أيّها الناظر.', ن_عربي);
    console.log('%c', '');
    console.log('%cThe terminal has a cartouche. saying the name is a key.', ن_واجهة);
    console.log('%cTry, in the terminal:  %cconnor   horus   cipher', ن_مكتوم, ن_برونز);
    console.log('%cor here, in this console:', ن_واجهة);
    console.log('%c\n    حلّ(\'...\')   ·   hal(\'...\')   ·   𓎛(\'...\')\n', ن_برونز);
    console.log('%c—————————————————————————————', ن_مكتوم);
};


/* ------------------------------------------------------------------
 * ٩ · 𓋹𓋹 — init
 * ------------------------------------------------------------------ */

const 𓋹𓋹 = () => {
    𓆣𓋹();    // ambient drift
    𓁹𓋹();    // console welcome

    // form submit handler
    const form = السطر();
    const input = الأمر();
    if (form && input) {
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const قيمة = input.value;
            input.value = '';
            أنفّذ(قيمة);
        });

        // history navigation
        input.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (تاريخ.length === 0) return;
                if (فهرس_التاريخ < تاريخ.length - 1) {
                    فهرس_التاريخ++;
                    input.value = تاريخ[تاريخ.length - 1 - فهرس_التاريخ];
                }
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (فهرس_التاريخ > 0) {
                    فهرس_التاريخ--;
                    input.value = تاريخ[تاريخ.length - 1 - فهرس_التاريخ];
                } else if (فهرس_التاريخ === 0) {
                    فهرس_التاريخ = -1;
                    input.value = '';
                }
            }
        });
    }

    // click anywhere to refocus the input (don't steal from links/buttons)
    document.addEventListener('click', (e) => {
        if (e.target.closest('a, input, button, .reveal')) return;
        const i = الأمر();
        if (i) i.focus();
    });

    أقلِع();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', 𓋹𓋹);
} else {
    𓋹𓋹();
}
