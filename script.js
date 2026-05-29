/*
 *  ======================================================================
 *  LOCKHEED-MARTIN / PRIME INTELLECT FLIGHT COMPUTER LOGIC
 *  PROJECT: SOCIAL ACOLYTE AVIONICS CONTROLS & NEURAL PIPELINES
 *  ZERO-EMOJI SYSTEM PROTOCOL
 *  ======================================================================
 */

(() => {
    'use strict';

    /* --- 1. Compute Node Grid / Canvas Particles Simulation --- */

    const canvas = document.getElementById('الخلفية');
    const ctx = canvas.getContext('2d');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let particles = [];
    let lineDistLimit = 95;
    let densityModifier = 1;
    let mouse = { x: null, y: null, active: false };

    class NodeParticle {
        constructor(initial = false) {
            this.x = Math.random() * width;
            this.y = initial ? Math.random() * height : -10 - Math.random() * 20;
            this.vx = (Math.random() - 0.5) * 0.45;
            this.vy = 0.15 + Math.random() * 0.45;
            this.radius = 1.2 + Math.random() * 1.6;
            this.baseSpeedFactor = 1;
        }

        update() {
            // Apply speed velocity
            this.x += this.vx * this.baseSpeedFactor * densityModifier;
            this.y += this.vy * this.baseSpeedFactor * densityModifier;

            // Handle screen edge wrapping
            if (this.x < -10) this.x = width + 10;
            if (this.x > width + 10) this.x = -10;
            if (this.y > height + 10) {
                this.y = -10;
                this.x = Math.random() * width;
            }

            // Mouse Gravitational Lensing / Attraction
            if (mouse.active && mouse.x !== null && mouse.y !== null) {
                const dx = mouse.x - this.x;
                const dy = mouse.y - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 150) {
                    const force = (150 - distance) / 1500;
                    this.x += (dx / distance) * force * 15;
                    this.y += (dy / distance) * force * 15;
                }
            }
        }

        draw() {
            ctx.fillStyle = `rgba(0, 240, 255, ${0.12 * densityModifier})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function resizeCanvas() {
        width = window.innerWidth;
        height = window.innerHeight;

        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        canvas.width = width * dpr;
        canvas.height = height * dpr;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        const particleCount = Math.max(18, Math.floor((width * height) / 14000));
        particles = [];
        for (let i = 0; i < particleCount; i++) {
            particles.push(new NodeParticle(true));
        }
    }

    function drawVectorGrid() {
        ctx.clearRect(0, 0, width, height);

        // Update & Draw Particles
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();
        }

        // Draw Interconnecting Vector Lines
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < lineDistLimit) {
                    const alpha = (1 - (dist / lineDistLimit)) * 0.08 * densityModifier;
                    ctx.strokeStyle = `rgba(0, 240, 255, ${alpha})`;
                    ctx.lineWidth = 0.6;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }

        requestAnimationFrame(drawVectorGrid);
    }

    // Set up mouse events for gravitational lensing
    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
    });

    window.addEventListener('mouseleave', () => {
        mouse.active = false;
    });

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(resizeCanvas, 150);
    });

    resizeCanvas();
    requestAnimationFrame(drawVectorGrid);


    /* --- 2. NASA / Lockheed Skunk Works Console Bootstrap --- */

    const bootSequence = [
        '======================================================================',
        'LOCKHEED MARTIN | ADVANCED DEVELOPMENT PROGRAMS (SKUNK WORKS)',
        'FLIGHT CONTROL SYSTEM (FCS) v8.42 - GROUND TELEMETRY ACCESS',
        '======================================================================',
        'STATUS: SECURE_INERTIAL_PLATFORM_LOCKED',
        'TRANS_FREQ: DSN_LINK_STBY',
        'ALIGN_STATE: IMU_DRIFT_DETECTOR',
        '',
        'WARNING: FCS GYRO PLATFORM CONTAINS DRIFT DEVIATIONS.',
        'GROUND CONTROLS MUST MANUAL ALIGN TRANSPONDER CALIBRATION.',
        '',
        'TO EXECUTE AUTOMATIC SENSOR REALIGNMENT SEQUENCE:',
        'RUN TRANSPONDER DECRYPTION IN CONSOLE:',
        '',
        '      fcs.align("COMMAND_KEY")',
        '',
        'DECRYPTION PARAMETER HINT:',
        'Identify the legendary world speed record (Mach number) set',
        'by the Lockheed SR-71 Blackbird in its historic transatlantic flight.',
        'Format the key as "MACH" followed by the decimals (e.g. "MACH3.3" or "MACH3.32").',
        '======================================================================',
    ].join('\n');

    console.log(
        '%c' + bootSequence,
        'color:#00f0ff; font-family:"JetBrains Mono", monospace; font-size:11px; line-height:1.45;'
    );


    /* --- 3. Interactive Transponder Telemetry Alignment Challenge --- */

    const solutionA = 'MACH3.32';
    const solutionB = 'MACH3.3';

    let alignmentComplete = false;

    function triggerAvionicsUnlock() {
        if (alignmentComplete) return;
        
        const fcsPanel = document.getElementById('fcs-blueprint');
        const statAlign = document.getElementById('stat-align');
        const statNode = document.getElementById('stat-node');
        const statCompute = document.getElementById('stat-compute');
        const statFreq = document.getElementById('stat-freq');

        if (!fcsPanel) return;

        alignmentComplete = true;

        // Visual Canvas Acceleration
        densityModifier = 2.8;
        lineDistLimit = 130;

        // System state interface update
        fcsPanel.classList.add('ظاهر');
        
        if (statAlign) {
            statAlign.textContent = 'ALIGNED';
            statAlign.classList.add('active');
        }
        if (statNode) {
            statNode.textContent = 'SYS_ACTIVE';
            statNode.classList.add('active');
        }
        if (statCompute) {
            statCompute.textContent = 'MAX_BANDWIDTH';
            statCompute.classList.add('active');
        }
        if (statFreq) {
            statFreq.textContent = '742.80 MHZ';
            statFreq.classList.add('active');
        }

        // Write simulated live telemetry data scrolling feed
        const logBox = document.getElementById('fcs-log');
        if (logBox) {
            let logLines = [
                '[CALIBRATING ACCELEROMETER CODES... OK]',
                '[SYNCHRONIZING DSN TRANSCEIVERS WITH USA-ADELAIDE-42... OK]',
                '<span class="success">[SYSTEM LOCK AT 742.80 MHZ TRANSMISSION]</span>',
                '<span class="highlight">[ALIGNMENT COMPLETE: SECURE BLUEPRINT UNLOCKED]</span>',
                'PITCH SENSOR STABLE AT zero deviation',
                'ROLL COEFFICIENTS ALIGNED TO AVIONICS MATRIX',
                'FLIGHT CONTROL LAUNCH SYSTEM ENGAGED.',
                'STREAMING AVIONICS FLIGHT SPECS // ALL NETWORKS ONLINE.'
            ];
            
            let index = 0;
            const logInterval = setInterval(() => {
                if (index < logLines.length) {
                    logBox.innerHTML += '<br>' + logLines[index];
                    logBox.scrollTop = logBox.scrollHeight;
                    index++;
                } else {
                    clearInterval(logInterval);
                }
            }, 600);
        }
    }

    window.fcs = {
        align: function (commandKey) {
            if (typeof commandKey !== 'string') {
                console.log(
                    '%c[FCS WARN] Transponder align requires string format, e.g. fcs.align("MACH3.3")',
                    'color:#475569; font-family:"JetBrains Mono", monospace; font-size:11px;'
                );
                return undefined;
            }

            const cleanKey = commandKey.toUpperCase().replace(/\s+/g, '');
            if (cleanKey === solutionA || cleanKey === solutionB) {
                triggerAvionicsUnlock();
                console.log(
                    '%c[FCS SUCCESS] TRANSIGNAL MATCHED. GYROS ALIGNED. BLUEPRINT DECRYPTED. DSN ONLINE. [SUCCESS]',
                    'color:#00f0ff; font-family:"JetBrains Mono", monospace; font-size:11px; font-weight:700;'
                );
                return 'FCS_ALIGN_OK';
            }

            console.log(
                '%c[FCS ERROR] COMMAND SIGNAL MISMATCH. TRANSPONDER OUT OF PHASE. ALIGNMENT FAILS.',
                'color:#475569; font-family:"JetBrains Mono", monospace; font-size:11px;'
            );
            return null;
        }
    };

    // Standard fallback trigger for other terminal keywords
    window.solve = window.fcs.align;

    /* --- Core Drift Interactive Calibration Button --- */
    const fcsBtn = document.querySelector('.نظرة');
    if (fcsBtn) {
        fcsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Flare canvas speed temporarily
            densityModifier = Math.min(densityModifier + 0.5, 4.0);
            console.log(
                '%c[FCS INFO] Diagnostic pulse dispatched. Verify terminal console for ground control bootstrap instructions.',
                'color:#00f0ff; font-family:"JetBrains Mono", monospace; font-size:11px;'
            );
        });
    }
})();
