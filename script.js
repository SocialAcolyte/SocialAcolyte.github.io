/*
 *  ======================================================================
 *  FUSED SILICA THERMAL DIFFUSION ENGINE // TECHNICAL CORE
 *  THEME: OBSIDIAN VOID // PLATINUM SILICA // KINETIC COLLISIONS
 *  ZERO-EMOJI AND ZERO-CLICHÉ DESIGN PROTOCOL
 *  ======================================================================
 */

(() => {
    'use strict';

    /* --- 1. Background Canvas: Minimal Blueprint Margins --- */

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


    /* --- 2. The Fused Silica Molecular Collision Engine --- */

    const sCanvas = document.getElementById('silica-canvas');
    if (sCanvas) {
        const sCtx = sCanvas.getContext('2d');
        const sDpr = Math.min(window.devicePixelRatio || 1, 2);

        let sWidth = 0;
        let sHeight = 0;
        let sMouse = { x: null, y: null, active: false };

        let fibers = [];
        let particles = [];
        let sparks = [];
        let time = 0;

        let heatBands = [0, 0, 0, 0, 0]; // Real-time computed thermal bands

        // Class representing a fused silica glass fiber
        class SilicaFiber {
            constructor(index) {
                this.index = index;
                this.reset();
            }

            reset() {
                // Organic overlapping Bezier curvatures representing silica glass threads
                this.x1 = Math.random() * sWidth;
                this.y1 = Math.random() * sHeight;
                this.x2 = Math.random() * sWidth;
                this.y2 = Math.random() * sHeight;
                
                this.cpx1 = this.x1 + (Math.random() - 0.5) * 120;
                this.cpy1 = this.y1 + (Math.random() - 0.5) * 120;
                this.cpx2 = this.x2 + (Math.random() - 0.5) * 120;
                this.cpy2 = this.y2 + (Math.random() - 0.5) * 120;

                this.vibration = 0;
                this.baseOpacity = 0.015 + Math.random() * 0.025;
            }

            update(heatLevels) {
                const avgY = (this.y1 + this.y2) / 2;
                const bandIndex = Math.min(4, Math.floor((avgY / sHeight) * 5));
                const targetVibe = heatLevels[bandIndex] * 12;

                // Dampen fiber molecular vibration
                this.vibration += (targetVibe - this.vibration) * 0.12;
                this.vibration = Math.max(0, this.vibration - 0.008);
            }

            draw() {
                sCtx.beginPath();
                sCtx.moveTo(this.x1, this.y1);

                if (this.vibration > 0.05) {
                    const osc1 = Math.sin(time * 50 + this.x1) * this.vibration * 0.5;
                    const osc2 = Math.cos(time * 50 + this.x2) * this.vibration * 0.5;
                    sCtx.bezierCurveTo(
                        this.cpx1 + osc1, this.cpy1 + osc2,
                        this.cpx2 + osc2, this.cpy2 + osc1,
                        this.x2, this.y2
                    );
                    sCtx.strokeStyle = `rgba(236, 232, 224, ${this.baseOpacity + this.vibration * 0.12})`;
                    sCtx.lineWidth = 0.5 + this.vibration * 0.2;
                } else {
                    sCtx.bezierCurveTo(this.cpx1, this.cpy1, this.cpx2, this.cpy2, this.x2, this.y2);
                    sCtx.strokeStyle = `rgba(236, 232, 224, ${this.baseOpacity})`;
                    sCtx.lineWidth = 0.5;
                }
                sCtx.stroke();
            }
        }

        // Kinetic Thermal Particle (Microscopic Plasma Heat Point)
        class ThermalParticle {
            constructor(x) {
                this.x = x + (Math.random() - 0.5) * 16;
                this.y = 16; // Spawn directly below plasma interface
                this.vx = (Math.random() - 0.5) * 0.8;
                this.vy = 0.8 + Math.random() * 1.5; // Fast downward kinetic velocity
                this.life = 1.0;
                this.decay = 0.003 + Math.random() * 0.005;
            }

            update() {
                this.x += this.vx;
                this.y += this.vy;

                const depthRatio = this.y / sHeight;
                
                // Molecular scattering collisions in the porous silica core
                if (depthRatio > 0.1) {
                    // Collision probability increases with fiber density
                    if (Math.random() < 0.14) {
                        this.vx += (Math.random() - 0.5) * 1.2;
                        this.vy *= 0.86; // Transfer speed to the glass fiber lattice

                        // Generate a high-contrast collision spark
                        if (Math.random() < 0.6) {
                            sparks.push(new CollisionSpark(this.x, this.y));
                        }
                    }
                }

                // Vacuum thermal drag impedance
                this.vy *= 0.982;
                this.vx *= 0.982;

                this.life -= this.decay;

                // Boundary containment
                if (this.x < 16) this.x = 16;
                if (this.x > sWidth - 72) this.x = sWidth - 72;
            }

            draw() {
                const alpha = this.life * 0.7;
                sCtx.beginPath();
                sCtx.fillStyle = `rgba(236, 232, 224, ${alpha})`;
                sCtx.arc(this.x, this.y, 0.7 + this.life * 0.7, 0, Math.PI * 2);
                sCtx.fill();
            }
        }

        // Microscopic Collision Spark (Visual representation of energy transfer)
        class CollisionSpark {
            constructor(x, y) {
                this.x = x;
                this.y = y;
                this.life = 1.0;
                this.decay = 0.035 + Math.random() * 0.035;
                this.size = 1.5 + Math.random() * 2.5;
            }

            update() {
                this.life -= this.decay;
            }

            draw() {
                const alpha = this.life * 0.8;
                sCtx.strokeStyle = `rgba(236, 232, 224, ${alpha})`;
                sCtx.lineWidth = 0.5;
                
                // Draw a delicate microscopic cross tick
                sCtx.beginPath();
                sCtx.moveTo(this.x - this.size, this.y);
                sCtx.lineTo(this.x + this.size, this.y);
                sCtx.moveTo(this.x, this.y - this.size);
                sCtx.lineTo(this.x, this.y + this.size);
                sCtx.stroke();
            }
        }

        function resizeSilicaCanvas() {
            sWidth = sCanvas.parentElement.clientWidth - 24;
            sHeight = 380;

            sCanvas.style.width = sWidth + 'px';
            sCanvas.style.height = sHeight + 'px';
            sCanvas.width = sWidth * sDpr;
            sCanvas.height = sHeight * sDpr;

            sCtx.setTransform(1, 0, 0, 1, 0, 0);
            sCtx.scale(sDpr, sDpr);

            // Re-initialize silica matrix glass threads
            fibers = [];
            const count = 52;
            for (let i = 0; i < count; i++) {
                fibers.push(new SilicaFiber(i));
            }
        }

        function drawBlueprintLabels() {
            sCtx.font = "8.5px 'JetBrains Mono', monospace";
            sCtx.fillStyle = 'rgba(256, 256, 256, 0.22)';
            sCtx.textAlign = 'left';
            sCtx.textBaseline = 'middle';

            // Top boundary annotation
            sCtx.fillText("[BOUNDARY LAYER // PLASMA FRONT - 1260 C]", 16, 22);
            
            // Middle core annotation
            sCtx.fillText("[LI-900 SILICA CORE // 94% VACUUM EXTRUSION]", 16, sHeight / 2);
            
            // Bottom boundary annotation
            sCtx.fillText("[ALUMINUM BOND LINE // SHUTTLE SKIN - 24 C]", 16, sHeight - 22);
        }

        function drawThermometerScale(measuredEnergy) {
            const scaleX = sWidth - 48;
            const topY = 32;
            const bottomY = sHeight - 32;
            const scaleHeight = bottomY - topY;

            // Draw axis rules
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            sCtx.lineWidth = 0.5;
            sCtx.beginPath();
            sCtx.moveTo(scaleX, topY);
            sCtx.lineTo(scaleX, bottomY);
            sCtx.stroke();

            // Draw ticks & thermometer data bars
            sCtx.font = "8.5px 'JetBrains Mono', monospace";
            sCtx.textBaseline = 'middle';
            sCtx.textAlign = 'left';

            const temps = [
                { label: "1260 C", temp: 1260 },
                { label: "900 C", temp: 900 },
                { label: "600 C", temp: 600 },
                { label: "300 C", temp: 300 },
                { label: "24 C", temp: 24 }
            ];

            for (let i = 0; i < 5; i++) {
                const y = topY + (i / 4) * scaleHeight;
                
                sCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                sCtx.beginPath();
                sCtx.moveTo(scaleX - 3, y);
                sCtx.lineTo(scaleX + 3, y);
                sCtx.stroke();

                const energyValue = measuredEnergy[i];
                const barLength = Math.min(18, Math.floor(energyValue * 44));
                let bar = "";
                for (let k = 0; k < barLength; k++) bar += "|";
                if (bar === "") bar = ".";

                sCtx.fillStyle = i === 0 && energyValue > 0.05 ? '#ffffff' : 'rgba(255, 255, 255, 0.3)';
                sCtx.fillText(`${temps[i].label} [ ${bar} ]`, scaleX + 8, y);
            }
        }

        function drawSilicaLoop() {
            sCtx.clearRect(0, 0, sWidth, sHeight);
            time += 0.01;

            // Draw blueprint structural labels first
            drawBlueprintLabels();

            // 1. Localized Undulating Plasma Wave along top interface line on hover
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            sCtx.lineWidth = 0.5;
            sCtx.beginPath();
            
            const limitX = sWidth - 72;
            for (let i = 16; i <= limitX; i += 2) {
                let amplitude = 0;
                if (sMouse.active && sMouse.x !== null && sMouse.y !== null && sMouse.y < 42) {
                    amplitude = Math.exp(-Math.pow(i - sMouse.x, 2) / 3600) * 8; // Localized swell around cursor
                }
                const waveY = 12 + Math.sin(time * 50 + i * 0.15) * amplitude;
                if (i === 16) sCtx.moveTo(i, waveY);
                else sCtx.lineTo(i, waveY);
            }
            sCtx.stroke();

            // Inject thermal kinetic energy particles on mouse movement
            if (sMouse.active && sMouse.x !== null && sMouse.y !== null) {
                if (sMouse.y < 36 && particles.length < 160) {
                    for (let k = 0; k < 2; k++) {
                        particles.push(new ThermalParticle(sMouse.x));
                    }
                }
            }

            // 2. Compute average kinetic energy levels
            let rawEnergies = [0, 0, 0, 0, 0];
            let counts = [0, 0, 0, 0, 0];

            particles = particles.filter(p => {
                p.update();
                p.draw();

                const bandIdx = Math.min(4, Math.floor((p.y / sHeight) * 5));
                const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
                rawEnergies[bandIdx] += speed * p.life;
                counts[bandIdx]++;

                return p.life > 0 && p.y < sHeight - 12;
            });

            // Smooth thermal conduction inertia
            for (let i = 0; i < 5; i++) {
                const avg = counts[i] > 0 ? (rawEnergies[i] / counts[i]) * 0.72 : 0;
                heatBands[i] += (avg - heatBands[i]) * 0.18;
                heatBands[i] = Math.max(0, heatBands[i] - 0.005);
            }

            // 3. Process and render dynamic collision sparks
            sparks = sparks.filter(s => {
                s.update();
                s.draw();
                return s.life > 0;
            });

            // 4. Update and render fused glass fibers
            for (let i = 0; i < fibers.length; i++) {
                fibers[i].update(heatBands);
                fibers[i].draw();
            }

            // Bottom structural aluminum boundary line
            sCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
            sCtx.lineWidth = 0.5;
            sCtx.beginPath();
            sCtx.moveTo(16, sHeight - 12);
            sCtx.lineTo(sWidth - 72, sHeight - 12);
            sCtx.stroke();

            // 5. Draw active monospaced thermometer scale along the margin
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
