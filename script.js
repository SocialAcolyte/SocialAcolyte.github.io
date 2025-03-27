document.addEventListener('DOMContentLoaded', () => {

    const preloader = document.getElementById('preloader');
    const cursor = document.querySelector('.cursor');
    const navToggle = document.querySelector('.nav-toggle');
    const navMenu = document.querySelector('.nav-menu');

    // --- Preloader ---
    window.addEventListener('load', () => {
        preloader.classList.add('hidden');
    });

    // --- Custom Cursor ---
    document.addEventListener('mousemove', (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
    });

    // --- Navigation Toggle ---
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            navMenu.classList.toggle('active');
            // Optional: Toggle icon between bars and close
            const icon = navToggle.querySelector('i');
            if (navMenu.classList.contains('active')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-times');
            } else {
                icon.classList.remove('fa-times');
                icon.classList.add('fa-bars');
            }
        });

        // Close menu when a link is clicked (for SPA feel)
        navMenu.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                 if (navMenu.classList.contains('active')) {
                    navMenu.classList.remove('active');
                    navToggle.querySelector('i').classList.remove('fa-times');
                    navToggle.querySelector('i').classList.add('fa-bars');
                 }
            });
        });
    }


    // --- Section Fade-in on Scroll ---
    const sections = document.querySelectorAll('section');
    const observerOptions = {
        root: null, // relative to viewport
        rootMargin: '0px',
        threshold: 0.1 // 10% of section visible
    };

    const sectionObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                // Optional: Stop observing once visible if you don't need it to fade out
                // observer.unobserve(entry.target);
            }
            // Optional: Add else block here to remove 'visible' if you want fade-out on scroll up
        });
    }, observerOptions);

    sections.forEach(section => {
        sectionObserver.observe(section);
    });


    // --- Three.js Background ---
    let scene, camera, renderer, mesh;
    const canvas = document.getElementById('bg-canvas');

    function initThree() {
        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true }); // alpha: true for transparency if needed behind popups etc.
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x000000, 0); // Transparent background

        // Example 3D Object: Rotating Icosahedron
        const geometry = new THREE.IcosahedronGeometry(1.5, 0); // Radius 1.5, detail 0
        // const material = new THREE.MeshBasicMaterial({ color: 0xff00cc, wireframe: true }); // Wireframe magenta
        const material = new THREE.MeshNormalMaterial(); // Colors based on normal vectors - cool effect
        mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        camera.position.z = 4; // Move camera back

        animateThree();
    }

    function animateThree() {
        requestAnimationFrame(animateThree);

        // Rotation Animation
        if (mesh) {
            mesh.rotation.x += 0.003;
            mesh.rotation.y += 0.003;
        }

        renderer.render(scene, camera);
    }

    function onWindowResize() {
        if (camera && renderer) {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        }
    }

    window.addEventListener('resize', onWindowResize);

    // Initialize Three.js only if the library is loaded
    if (typeof THREE !== 'undefined') {
        initThree();
    } else {
        console.error("Three.js library not loaded.");
        // Fallback: Maybe set a static background color or simple CSS animation
        document.body.style.backgroundColor = '#0a0a0a';
    }


    // --- Gallery Image Click Particle Explosion ---
    const particleCanvas = document.getElementById('particles-canvas');
    const particleCtx = particleCanvas.getContext('2d');
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;
    let explosionParticles = [];

    class ExplosionParticle {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.size = Math.random() * 4 + 1; // Smaller particles
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 4 + 1; // Random speed
            this.speedX = Math.cos(angle) * speed;
            this.speedY = Math.sin(angle) * speed;
            this.life = 100; // Duration
            this.color = `hsl(${Math.random() * 60 + 280}, 100%, ${Math.random() * 30 + 50}%)`; // Pinks, purples, whites
        }
        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            // Add some friction/gravity effect (optional)
            this.speedY += 0.03;
            this.speedX *= 0.99;
            this.speedY *= 0.99;
            this.life -= 1.5; // Fade faster
            this.size *= 0.98; // Shrink
        }
        draw() {
            particleCtx.fillStyle = this.color;
            particleCtx.globalAlpha = Math.max(0, this.life / 100); // Fade out
            particleCtx.beginPath();
            particleCtx.arc(this.x, this.y, Math.max(0, this.size), 0, Math.PI * 2);
            particleCtx.fill();
            particleCtx.globalAlpha = 1.0; // Reset alpha
        }
    }

    document.querySelectorAll('.gallery img').forEach(img => {
        img.addEventListener('click', (e) => {
            const rect = img.getBoundingClientRect();
            // Calculate center relative to the viewport
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            const explosionCount = window.innerWidth < 768 ? 30 : 60; // More particles
            for (let i = 0; i < explosionCount; i++) {
                explosionParticles.push(new ExplosionParticle(x, y));
            }
             // Ensure animation loop is running
            if (!isAnimatingExplosion) {
                animateExplosion();
            }
        });
    });

    let isAnimatingExplosion = false;
    function animateExplosion() {
        isAnimatingExplosion = true;
        particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);

        explosionParticles = explosionParticles.filter(p => p.life > 0 && p.size > 0.1); // Remove dead particles
        explosionParticles.forEach(p => {
            p.update();
            p.draw();
        });

        // Only continue animation if particles exist
        if (explosionParticles.length > 0) {
            requestAnimationFrame(animateExplosion);
        } else {
             isAnimatingExplosion = false;
             // Optional: clear canvas one last time if needed
              // particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
        }
    }

     // Ensure canvas resizes with window for particles
     window.addEventListener('resize', () => {
        particleCanvas.width = window.innerWidth;
        particleCanvas.height = window.innerHeight;
    });


    // --- Popups Logic ---
    // Function to close any popup
    window.closePopup = function(id) { // Make it globally accessible
        const popup = document.getElementById(id);
        if (popup) {
            // Add a class to trigger fade-out animation if defined in CSS
            // popup.classList.add('closing');
            // setTimeout(() => { popup.style.display = 'none'; popup.classList.remove('closing'); }, 500); // Match CSS transition time
            popup.style.display = 'none'; // Simple hide
        }
    }

    // Show entry popup immediately (already visible via CSS/HTML)
    // If you prefer JS control:
    // const entryPopup = document.getElementById('entry-popup');
    // if (entryPopup) entryPopup.style.display = 'block';


    // Show corner popup after delay
    const cornerPopup = document.getElementById('corner-popup');
    if (cornerPopup) {
        setTimeout(() => {
            cornerPopup.style.display = 'block';
        }, 5000); // 5 seconds delay
    }

    // Meme popup on 'm' key press
    document.addEventListener('keydown', (e) => {
        if (e.key === 'm' || e.key === 'M') { // Check for lowercase or uppercase 'm'
             const memePopup = document.getElementById('image-popup');
             const memeImage = document.getElementById('meme-image');
             if (memePopup && memeImage) {
                 // Consider making image paths more robust if 'images/' is not always the root
                const memes = ['images/43.JPG', 'images/69.JPG', 'images/32.JPG']; // Add more memes here
                // Ensure the path is correct relative to the HTML file or use absolute paths
                const randomMeme = memes[Math.floor(Math.random() * memes.length)];
                console.log("Selected meme:", randomMeme); // Debugging
                memeImage.src = randomMeme;
                memePopup.style.display = 'block';
             }
        }
    });

    // Close popups if clicking outside the content area (optional)
    document.querySelectorAll('.popup').forEach(popup => {
        popup.addEventListener('click', (e) => {
            // Check if the click target is the popup background itself, not its content
            if (e.target === popup) {
                closePopup(popup.id);
            }
        });
    });

    // --- Ozempic Popup Content Consideration ---
    // The text content in '#entry-popup' and '#corner-popup' is quite specific.
    // If this site is for a professional portfolio or broader audience,
    // you might want to revise "Remember to take your ozempic", "Ok daddy",
    // and "You can always be thinner, look better".
    // Example alternative for entry: "Welcome!", button: "Enter"
    // Example alternative for corner: "Site Tips: Press 'M' for a surprise!", button: "Got it"

}); // End DOMContentLoaded
