/*
 *  ======================================================================
 *  FUSED SILICA THERMAL DIFFUSION ENGINE // FIRST PRINCIPLES
 *  THEME: OBSIDIAN VOID // PLATINUM SILICA // MOLECULAR PHYSICS
 *  ZERO-EMOJI AND ZERO-CLICHÉ DESIGN PROTOCOL
 *  ======================================================================
 */

(() => {
    'use strict';

    /* --- 1. Background Canvas: Minimal Drafting Lines --- */

    const bgCanvas = document.getElementById('الخلفية');
    const bgCtx = bgCanvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let bgWidth = 0;
    let bgHeight = 0;

    function drawBgBlueprint() {
        bgCtx.clearRect(0, 0, bgWidth, bgHeight);
        
        // Single, ultra-subtle drafting border
        bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
        bgCtx.lineWidth = 0.5;
        bgCtx.beginPath();
        bgCtx.moveTo(24, 24);
        bgCtx.lineTo(bgWidth - 24, 24);
        bgCtx.lineTo(bgWidth - 24, bgHeight - 24);
        bgCtx.lineTo(24, bgHeight - 24);
        bgCtx.closePath();
        bgCtx.stroke();
    }

    function resizeBgCanvas() {
        bgWidth = window.innerWidth;
        bgHeight = window.innerHeight;

        bgCanvas.style.width = bgWidth + 'px';
        bgCanvas.style.height = bgHeight + 'px';
        bgCanvas.width = bgWidth * dpr;
        bgCanvas.height = bgHeight * dpr;

        bgCtx.setTransform(1, 0, 0, 1, 0, 0);
        bgCtx.scale(dpr, dpr);
        
        drawBgBlueprint();
    }

    window.addEventListener('resize', resizeBgCanvas);
    resizeBgCanvas();


    /* --- 2. The Silica Matrix Molecular Physics Engine --- */

    const sCanvas = document.getElementById('silica-canvas');
    if (sCanvas) {
        const sCtx = sCanvas.getContext('2d');
        const sDpr = Math.min(window.devicePixelRatio || 1, 2);

        let sWidth = 0;
        let sHeight = 0;
        let sMouse = { x: null, y: null, active: false };

        let fibers = [];
        let particles = [];
        let time = 0;

        // Microscopic physical heat band measurements
        let heatBands = [0, 0, 0, 0, 0]; // Represents avg kinetic energy at 5 depth levels

        // Define a glass fiber thread segment inside the LI-900 silica matrix
        class SilicaFiber {
            constructor() {
                this.reset();
            }

            reset() {
                // Generate random overlapping curves spanning the matrix
                this.x1 = Math.random() * sWidth;
                this.y1 = Math.random() * sHeight;
                this.x2 = Math.random() * sWidth;
                this.y2 = Math.random() * sHeight;
                
                this.cpx1 = this.x1 + (Math.random() - 0.5) * 80;
                this.cpy1 = this.y1 + (Math.random() - 0.5) * 80;
                this.cpx2 = this.x2 + (Math.random() - 0.5) * 80;
                this.cpy2 = this.y2 + (Math.random() - 0.5) * 80;

                this.vibration = 0;
                this.baseOpacity = 0.015 + Math.random() * 0.025;
            }

            update(heatLevels) {
                // Determine which vertical band this fiber occupies
                const avgY = (this.y1 + this.y2) / 2;
                const bandIndex = Math.min(4, Math.floor((avgY / sHeight) * 5));
                const targetVibe = heatLevels[bandIndex] * 12;

                // Smooth dampening of molecular vibration
                this.vibration += (targetVibe - this.vibration) * 0.1;
                this.vibration = Math.max(0, this.vibration - 0.01);
            }

            draw() {
                sCtx.beginPath();
                sCtx.moveTo(this.x1, this.y1);

                // If vibrating, apply high-frequency oscillation to the control points
                if (this.vibration > 0.05) {
                    const osc1 = Math.sin(time * 45 + this.x1) * this.vibration * 0.45;
                    const osc2 = Math.cos(time * 45 + this.x2) * this.vibration * 0.45;
                    sCtx.bezierCurveTo(
                        this.cpx1 + osc1, this.cpy1 + osc2,
                        this.cpx2 + osc2, this.cpy2 + osc1,
                        this.x2, this.y2
                    );
                    sCtx.strokeStyle = `rgba(236, 232, 224, ${this.baseOpacity + this.vibration * 0.08})`;
                    sCtx.lineWidth = 0.5 + this.vibration * 0.15;
                } else {
                    sCtx.bezierCurveTo(this.cpx1, this.cpy1, this.cpx2, this.cpy2, this.x2, this.y2);
                    sCtx.strokeStyle = `rgba(236, 232, 224, ${this.baseOpacity})`;
                    sCtx.lineWidth = 0.5;
                }
                sCtx.stroke();
            }
        }

        // Represents a packet of thermal kinetic energy (Microscopic plasma heat point)
        class ThermalParticle {
            constructor(x) {
                this.x = x + (Math.random() - 0.5) * 20;
                this.y = 12; // Start just below plasma boundary
                this.vx = (Math.random() - 0.5) * 0.6;
                this.vy = 0.6 + Math.random() * 1.2; // Fast downward re-entry velocity
                this.life = 1.0;
                this.decay = 0.0025 + Math.random() * 0.0045;
            }

            update() {
                // Kinetic translation
                this.x += this.vx;
                this.y += this.vy;
                
                // 94% empty vacuum impedance -- exponential drag velocity deceleration
                const depthRatio = this.y / sHeight;
                
                // As the thermal energy travels deeper, it collides with dense silica arrays
                // causing scattering deflection and critical deceleration
                if (depthRatio > 0.1) {
                    // Random molecular scattering collisions
                    if (Math.random() < 0.12) {
                        this.vx += (Math.random() - 0.5) * 0.8;
                        this.vy *= 0.88; // Absorb speed into fiber lattice vibration
                    }
                }

                // Global molecular drag deceleration
                this.vy *= 0.985;
                this.vx *= 0.985;

                // Thermal energy radiation decay
                this.life -= this.decay;

                // Boundary containment
                if (this.x < 16) this.x = 16;
                if (this.x > sWidth - 120) this.x = sWidth - 120;
            }

            draw() {
                const alpha = this.life * 0.65;
                sCtx.beginPath();
                sCtx.fillStyle = `rgba(236, 232, 224, ${alpha})`;
                sCtx.arc(this.x, this.y, 0.75 + this.life * 0.6, 0, Math.PI * 2);
                sCtx.fill();
            }
        }

        function resizeSilicaCanvas() {
            sWidth = sCanvas.parentElement.clientWidth - 24;
            sHeight = 300;

            sCanvas.style.width = sWidth + 'px';
            sCanvas.style.height = sHeight + 'px';
            sCanvas.width = sWidth * sDpr;
            sCanvas.height = sHeight * sDpr;

            sCtx.setTransform(1, 0, 0, 1, 0, 0);
            sCtx.scale(sDpr, sDpr);

            // Re-initialize glass fiber structures
            fibers = [];
            const count = 48;
            for (let i = 0; i < count; i++) {
                fibers.push(new SilicaFiber());
            }
        }

        function drawThermometerScale(measuredEnergy) {
            const scaleX = sWidth - 64;
            const topY = 24;
            const bottomY = sHeight - 24;
            const scaleHeight = bottomY - topY;

            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            sCtx.lineWidth = 0.5;

            // Draw clean vertical scale axis line
            sCtx.beginPath();
            sCtx.moveTo(scaleX, topY);
            sCtx.lineTo(scaleX, bottomY);
            sCtx.stroke();

            // Draw tick divisions
            sCtx.font = "8.5px 'JetBrains Mono', monospace";
            sCtx.textBaseline = 'middle';
            sCtx.textAlign = 'left';

            const temps = [
                { label: "1260 C // PLASMA FRONT", temp: 1260 },
                { label: "900 C", temp: 900 },
                { label: "600 C", temp: 600 },
                { label: "300 C", temp: 300 },
                { label: "24 C // BOND LINE", temp: 24 }
            ];

            for (let i = 0; i < 5; i++) {
                const y = topY + (i / 4) * scaleHeight;
                
                // Draw tick marker
                sCtx.beginPath();
                sCtx.moveTo(scaleX - 4, y);
                sCtx.lineTo(scaleX + 4, y);
                sCtx.stroke();

                // Compute bar fill based on average band kinetic energy
                const energyValue = measuredEnergy[i];
                const barLength = Math.min(22, Math.floor(energyValue * 48));
                let bar = "";
                for (let k = 0; k < barLength; k++) bar += "|";
                if (bar === "") bar = ".";

                // Draw temperature reading labels
                sCtx.fillStyle = i === 0 && energyValue > 0.05 ? '#ffffff' : 'rgba(255, 255, 255, 0.3)';
                sCtx.fillText(`${temps[i].label} [ ${bar} ]`, scaleX + 10, y);
            }
        }

        function drawSilicaLoop() {
            sCtx.clearRect(0, 0, sWidth, sHeight);
            time += 0.01;

            // 1. Inject thermal kinetic energy particles on mouse movement
            if (sMouse.active && sMouse.x !== null && sMouse.y !== null) {
                // Only inject if close to the boundary layer (top edge)
                if (sMouse.y < 36 && particles.length < 150) {
                    for (let k = 0; k < 3; k++) {
                        particles.push(new ThermalParticle(sMouse.x));
                    }
                }
            }

            // 2. Process and compute average kinetic energy bands
            let rawEnergies = [0, 0, 0, 0, 0];
            let counts = [0, 0, 0, 0, 0];

            particles = particles.filter(p => {
                p.update();
                p.draw();

                // Allocate particle speed to corresponding depth band
                const bandIdx = Math.min(4, Math.floor((p.y / sHeight) * 5));
                const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
                rawEnergies[bandIdx] += speed * p.life;
                counts[bandIdx]++;

                return p.life > 0 && p.y < sHeight - 12;
            });

            // Normalize energies to establish actual real-time heat values
            for (let i = 0; i < 5; i++) {
                const avg = counts[i] > 0 ? (rawEnergies[i] / counts[i]) * 0.75 : 0;
                heatBands[i] += (avg - heatBands[i]) * 0.15; // Smooth thermal inertia
            }

            // 3. Update and render fused glass fibers
            for (let i = 0; i < fibers.length; i++) {
                fibers[i].update(heatBands);
                fibers[i].draw();
            }

            // 4. Render Boundary Layers
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            sCtx.lineWidth = 0.5;

            // Plasma front line (Top boundary)
            sCtx.beginPath();
            sCtx.moveTo(16, 12);
            sCtx.lineTo(sWidth - 72, 12);
            sCtx.stroke();

            // Structural skin line (Bottom boundary)
            sCtx.beginPath();
            sCtx.moveTo(16, sHeight - 12);
            sCtx.lineTo(sWidth - 72, sHeight - 12);
            sCtx.stroke();

            // 5. Draw monospaced physical temperature scale
            drawThermometerScale(heatBands);

            requestAnimationFrame(drawSilicaLoop);
        }

        sCanvas.addEventListener('mousemove', (e) => {
            const rect = sCanvas.getBoundingClientRect();
            sMouse.x = e.clientX - rect.left;
            sMouse.y = e.clientY - rect.top;
            sMouse.active = true;
        });

        sCanvas.addEventListener('mouseleave', () => {
            sMouse.active = false;
        });

        window.addEventListener('resize', resizeSilicaCanvas);

        resizeSilicaCanvas();
        requestAnimationFrame(drawSilicaLoop);
    }
})();
