<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Social Acolyte</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Roboto:wght@300&display=swap" rel="stylesheet">
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Roboto', sans-serif;
        }
        body {
            background: #0f0f0f;
            color: #f0f0f0;
            overflow-x: hidden;
            line-height: 1.6;
            cursor: none;
        }
        .cursor {
            position: fixed;
            width: 15px;
            height: 15px;
            background: radial-gradient(circle, #ff00cc, #00ffcc);
            border-radius: 50%;
            pointer-events: none;
            z-index: 9999;
            transform: translate(-50%, -50%);
            mix-blend-mode: difference;
        }
        @keyframes gradientAnimation {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes zoomIn {
            from { transform: scale(0.8); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
        .fade-in {
            animation: fadeIn 1s ease-out forwards;
        }
        nav {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10;
            perspective: 1000px;
        }
        .nav-menu {
            display: flex;
            gap: 20px;
        }
        .nav-toggle {
            display: none;
        }
        nav a {
            color: #ff00cc;
            text-decoration: none;
            font-family: 'Space Mono', monospace;
            font-size: 1.3em;
            padding: 10px 20px;
            background: rgba(0, 0, 0, 0.7);
            border-radius: 5px;
            transition: transform 0.3s, color 0.3s;
            transform: rotateY(20deg);
        }
        nav:hover .nav-menu {
            transform: rotateX(20deg) rotateY(-20deg);
        }
        nav a:hover {
            color: #00ffcc;
            transform: rotateY(0deg) scale(1.1);
        }
        nav a:focus {
            outline: 2px solid #00ffcc;
        }
        #main {
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            text-align: center;
            background: linear-gradient(12deg, #000000, #1909f7, #000000);
            background-size: 200% 200%;
            animation: gradientAnimation 5s ease infinite;
        }
        #main h1 {
            font-size: 6em;
            font-family: 'Space Mono', monospace;
            color: #fff;
            text-shadow: 0 0 30px #ae00ff, 0 0 60px #1909f7;
        }
        #main p {
            font-size: 1.8em;
            color: #ccc;
            margin-top: 20px;
        }
        #about {
            display: grid;
            grid-template-areas: 
                "text interests profile";
            grid-template-columns: 1fr 1fr 1fr;
            gap: 40px;
            padding: 120px 40px;
            position: relative;
            background: rgba(15, 15, 15, 0.9);
        }
        .about-text {
            grid-area: text;
        }
        .interests {
            grid-area: interests;
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .profile {
            grid-area: profile;
            text-align: center;
        }
        #about h2 {
            font-size: 3em;
            color: #ff00cc;
            font-family: 'Space Mono', monospace;
        }
        #about p {
            font-size: 1.3em;
            max-width: 500px;
        }
        .interests i {
            font-size: 2.5em;
            color: #00ffcc;
            transition: transform 0.3s;
        }
        .interests i:hover {
            transform: scale(1.2);
        }
        .profile-pic {
            width: 300px;
            height: 300px;
            border-radius: 50%;
            object-fit: cover;
            border: 3px solid #ff00cc;
            margin-bottom: 10px;
        }
        .profile-desc {
            font-size: 1.2em;
            color: #ccc;
        }
        #woo {
            padding: 120px 40px;
            text-align: center;
        }
        #woo h2 {
            font-size: 3em;
            color: #00ffcc;
            font-family: 'Space Mono', monospace;
            margin-bottom: 40px;
        }
        .gallery {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 30px;
        }
        .gallery img {
            width: 100%;
            aspect-ratio: 1 / 1;
            object-fit: cover;
            border: 3px solid #ff00cc;
            transition: transform 0.3s;
            cursor: pointer;
        }
        .gallery img:hover {
            transform: scale(1.05);
            box-shadow: 0 0 20px #ff00cc;
        }
        #contact {
            padding: 120px 40px;
            text-align: center;
            background: rgba(15, 15, 15, 0.9);
        }
        #contact h2 {
            font-size: 3em;
            color: #ff00cc;
            font-family: 'Space Mono', monospace;
        }
        #contact a {
            color: #00ffcc;
            font-size: 1.5em;
            text-decoration: none;
        }
        #contact a:hover {
            text-decoration: underline;
        }
        form {
            margin-top: 20px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            align-items: center;
        }
        input, textarea {
            padding: 12px;
            width: 350px;
            background: #222;
            color: #fff;
            border: 2px solid #ff00cc;
            border-radius: 5px;
            font-family: 'Space Mono', monospace;
        }
        button {
            padding: 12px 30px;
            background: #ff00cc;
            color: #fff;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: background 0.3s;
        }
        button:hover {
            background: #00ffcc;
        }
        input:focus, textarea:focus, button:focus {
            outline: 2px solid #00ffcc;
        }
        section {
            opacity: 0;
            transform: translateY(50px);
            transition: opacity 0.8s ease-out, transform 0.8s ease-out;
        }
        section.visible {
            opacity: 1;
            transform: translateY(0);
        }
        #about.visible .profile-pic {
            animation: zoomIn 1s ease-out;
        }
        #particles {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            z-index: 1000;
        }
        .scroll-down-arrow {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: #ff00cc;
            font-size: 2em;
            animation: bounce 2s infinite;
            pointer-events: none;
        }
        @keyframes bounce {
            0%, 20%, 50%, 80%, 100% { transform: translateY(0) translateX(-50%); }
            40% { transform: translateY(-20px) translateX(-50%); }
            60% { transform: translateY(-10px) translateX(-50%); }
        }
        @media (max-width: 768px) {
            .cursor { display: none; }
            #main h1 { font-size: 4em; }
            #about {
                grid-template-areas: 
                    "profile"
                    "text"
                    "interests";
                grid-template-columns: 1fr;
                padding: 60px 20px;
            }
            .gallery {
                grid-template-columns: 1fr;
                gap: 15px;
            }
            section { padding: 60px 20px; }
            input, textarea { width: 100%; }
            .profile-pic { width: 200px; height: 200px; }
            .nav-menu {
                display: none;
                flex-direction: column;
                position: absolute;
                top: 60px;
                left: 0;
                width: 100%;
                background: rgba(0, 0, 0, 0.9);
                padding: 20px;
            }
            .nav-menu.active { display: flex; }
            .nav-toggle {
                display: block;
                cursor: pointer;
                color: #ff00cc;
                font-size: 1.5em;
                position: absolute;
                top: 20px;
                right: 20px;
            }
        }
        @media (min-width: 769px) {
            .nav-toggle { display: none; }
        }
    </style>
</head>
<body>
    <div class="cursor"></div>
    <canvas id="bg-canvas"></canvas>
    <nav>
        <div class="nav-toggle">
            <i class="fas fa-bars"></i>
        </div>
        <div class="nav-menu">
            <a href="#main">Home</a>
            <a href="#about">About</a>
            <a href="#woo">Aura</a>
            <a href="#contact">Contact</a>
        </div>
    </nav>
    <section id="main">
        <div>
            <h1>SOCIAL ACOLYTE</h1>
            <p>Chaos | Math | Philosophy</p>
        </div>
        <div class="scroll-down-arrow">
            <i class="fas fa-chevron-down"></i>
        </div>
    </section>
    <section id="about">
        <div class="about-text">
            <h2>About Me</h2>
            <p>I’m a 20-year-old Aussie vibecoding my way through new ventures. Obsessed with X.com. When I’m not coding, I’m deep in thought about philosophy politics or economics. Also I write a lot.</p>
        </div>
        <div class="interests">
            <div><i class="fas fa-book"></i> Philosophy</div>
            <div><i class="fas fa-calculator"></i> Math</div>
            <div><i class="fab fa-twitter"></i> X.com</div>
            <div><i class="fas fa-random"></i> Chaos</div>
        </div>
        <div class="profile">
            <img src="images/Profile.jpg" alt="Profile Picture" class="profile-pic" loading="lazy">
            <p class="profile-desc">Vibecoder &<br>Chaos Theorist.</p>
        </div>
        <div class="scroll-down-arrow">
            <i class="fas fa-chevron-down"></i>
        </div>
    </section>
    <section id="woo">
        <h2>Aura Farm</h2>
        <div class="gallery">
            <img src="images/2.JPG" alt="Art 2" loading="lazy">
            <img src="images/3.JPG" alt="Art 3" loading="lazy">
            <img src="images/4.JPG" alt="Art 4" loading="lazy">
            <img src="images/5.JPG" alt="Art 5" loading="lazy">
            <img src="images/6.JPG" alt="Art 6" loading="lazy">
            <img src="images/7.JPG" alt="Art 7" loading="lazy">
            <img src="images/8.PNG" alt="Art 8" loading="lazy">
            <img src="images/9.JPG" alt="Art 9" loading="lazy">
            <img src="images/10.JPG" alt="Art 10" loading="lazy">
            <img src="images/11.JPG" alt="Art 11" loading="lazy">
            <img src="images/12.JPG" alt="Art 12" loading="lazy">
            <img src="images/13.PNG" alt="Art 13" loading="lazy">
            <img src="images/14.JPG" alt="Art 14" loading="lazy">
            <img src="images/15.JPG" alt="Art 15" loading="lazy">
            <img src="images/16.JPG" alt="Art 16" loading="lazy">
            <img src="images/17.JPG" alt="Art 17" loading="lazy">
            <img src="images/18.JPG" alt="Art 18" loading="lazy">
            <img src="images/19.JPG" alt="Art 19" loading="lazy">
            <img src="images/20.JPG" alt="Art 20" loading="lazy">
            <img src="images/21.JPG" alt="Art 21" loading="lazy">
            <img src="images/22.JPG" alt="Art 22" loading="lazy">
            <img src="images/23.JPG" alt="Art 23" loading="lazy">
            <img src="images/24.JPG" alt="Art 24" loading="lazy">
            <img src="images/25.JPG" alt="Art 25" loading="lazy">
            <img src="images/26.JPG" alt="Art 26" loading="lazy">
            <img src="images/27.JPG" alt="Art 27" loading="lazy">
            <img src="images/28.JPG" alt="Art 28" loading="lazy">
            <img src="images/29.JPG" alt="Art 29" loading="lazy">
            <img src="images/30.JPG" alt="Art 30" loading="lazy">
            <img src="images/31.JPG" alt="Art 31" loading="lazy">
            <img src="images/32.JPG" alt="Art 32" loading="lazy">
            <img src="images/33.JPG" alt="Art 33" loading="lazy">
            <img src="images/34.JPG" alt="Art 34" loading="lazy">
            <img src="images/35.JPG" alt="Art 35" loading="lazy">
            <img src="images/36.JPG" alt="Art 36" loading="lazy">
            <img src="images/37.JPG" alt="Art 37" loading="lazy">
            <img src="images/38.JPG" alt="Art 38" loading="lazy">
            <img src="images/44.JPG" alt="Art 39" loading="lazy">
            <img src="images/40.JPG" alt="Art 40" loading="lazy">
            <img src="images/43.JPG" alt="Art 41" loading="lazy">
            <img src="images/42.JPG" alt="Art 42" loading="lazy">
            <img src="images/45.PNG" alt="Art 43" loading="lazy">
            <img src="images/48.JPG" alt="Art 44" loading="lazy">
            <img src="images/49.JPG" alt="Art 45" loading="lazy">
        </div>
        <div class="scroll-down-arrow">
            <i class="fas fa-chevron-down"></i>
        </div>
    </section>
    <section id="contact">
        <h2>Contact Me</h2>
        <p>Find me on X: <a href="https://x.com/" target="_blank">@SocialAcolyte</a></p>
        <p>Or send me a message if you want to join my group chat WHYCombinator:</p>
        <form action="https://formspree.io/your@email.com" method="POST">
            <input type="text" name="name" placeholder="Name" required>
            <input type="email" name="email" placeholder="Email" required>
            <textarea name="message" placeholder="Message" required></textarea>
            <button type="submit">Send</button>
        </form>
    </section>
    <canvas id="particles"></canvas>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r134/three.min.js"></script>
    <script>
        const cursor = document.querySelector('.cursor');
        document.addEventListener('mousemove', (e) => {
            cursor.style.left = `${e.clientX}px`;
            cursor.style.top = `${e.clientY}px`;
        });
        const sections = document.querySelectorAll('section');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) entry.target.classList.add('visible');
            });
        }, { threshold: 0.1 });
        sections.forEach(section => observer.observe(section));
        const canvas = document.getElementById('bg-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        let particlesArray = [];
        class Particle {
            constructor() {
                this.x = Math.random() * canvas.width;
                this.y = Math.random() * canvas.height;
                this.size = Math.random() * 5 + 1;
                this.speedX = Math.random() * 3 - 1.5;
                this.speedY = Math.random() * 3 - 1.5;
            }
            update() {
                this.x += this.speedX;
                this.y += this.speedY;
                if (this.x > canvas.width || this.x < 0) this.speedX *= -1;
                if (this.y > canvas.height || this.y < 0) this.speedY *= -1;
            }
            draw() {
                ctx.fillStyle = 'rgba(255, 0, 204, 0.5)';
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        function initParticles() {
            particlesArray = [];
            const particleCount = window.innerWidth < 768 ? 50 : 100;
            for (let i = 0; i < particleCount; i++) particlesArray.push(new Particle());
        }
        let time = 0;
        const arrowBaseWidth = 60;
        const arrowHeight = 100;
        const arrowFillColor = '#ffffff';
        const arrowOutlineColor = '#ff00cc';
        const amplitude = 15;
        const frequency = 0.05;
        function drawArrow() {
            time += 1;
            const offset = amplitude * Math.sin(frequency * time);
            const x = canvas.width / 2;
            const baseY = canvas.height / 2 + offset;
            ctx.beginPath();
            ctx.moveTo(x - arrowBaseWidth / 2, baseY);
            ctx.lineTo(x + arrowBaseWidth / 2, baseY);
            ctx.lineTo(x, baseY + arrowHeight);
            ctx.closePath();
            ctx.fillStyle = arrowFillColor;
            ctx.fill();
            ctx.lineWidth = 3;
            ctx.strokeStyle = arrowOutlineColor;
            ctx.stroke();
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ff00cc';
            ctx.fill();
            ctx.shadowBlur = 0;
        }
        function animateParticlesAndArrow() {
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            particlesArray.forEach(p => { p.update(); p.draw(); });
            drawArrow();
            requestAnimationFrame(animateParticlesAndArrow);
        }
        initParticles();
        animateParticlesAndArrow();
        const particleCanvas = document.getElementById('particles');
        const particleCtx = particleCanvas.getContext('2d');
        particleCanvas.width = window.innerWidth;
        particleCanvas.height = window.innerHeight;
        let explosionParticles = [];
        class ExplosionParticle {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.size = Math.random() * 5 + 2;
                this.speedX = Math.random() * 6 - 3;
                this.speedY = Math.random() * 6 - 3;
                this.life = 100;
            }
            update() {
                this.x += this.speedX;
                this.y += this.speedY;
                this.life -= 2;
            }
            draw() {
                particleCtx.fillStyle = `hsl(${Math.random() * 360}, 100%, 50%)`;
                particleCtx.beginPath();
                particleCtx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                particleCtx.fill();
            }
        }
        document.querySelectorAll('.gallery img').forEach(img => {
            img.addEventListener('click', (e) => {
                const rect = img.getBoundingClientRect();
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                const explosionCount = window.innerWidth < 768 ? 25 : 50;
                for (let i = 0; i < explosionCount; i++) explosionParticles.push(new ExplosionParticle(x, y));
            });
        });
        function animateExplosion() {
            particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
            explosionParticles = explosionParticles.filter(p => p.life > 0);
            explosionParticles.forEach(p => { p.update(); p.draw(); });
            requestAnimationFrame(animateExplosion);
        }
        animateExplosion();
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            particleCanvas.width = window.innerWidth;
            particleCanvas.height = window.innerHeight;
            initParticles();
        });
        const navToggle = document.querySelector('.nav-toggle');
        const navMenu = document.querySelector('.nav-menu');
        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
        });
    </script>
</body>
</html>
