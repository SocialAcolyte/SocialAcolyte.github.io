/*
 *  ======================================================================
 *  LOCKHEED-MARTIN / SKUNK WORKS FLIGHT SYSTEM CONTROLLER
 *  THEME: TACTICAL AVIONICS & MATHEMATICAL VECTOR GRID
 *  ZERO-EMOJI AND ZERO-CLICHÉ SYSTEM ARCHITECTURE
 *  ======================================================================
 */

(() => {
    'use strict';

    /* --- 1. Canvas Mathematical Trajectory Orbit & Coordinate Grid --- */

    const canvas = document.getElementById('الخلفية');
    const ctx = canvas.getContext('2d');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let width = 0;
    let height = 0;
    let trajectories = [];
    let speedModifier = 1.0;
    let mouse = { x: null, y: null, active: false };

    // Represents a mathematical orbital vector trail
    class TrajectoryOrbit {
        constructor(index, total) {
            this.index = index;
            this.total = total;
            this.reset();
        }

        reset() {
            // Position along the coordinate vector paths
            this.progress = Math.random();
            this.speed = 0.0003 + Math.random() * 0.0006;
            this.baseRadius = 150 + (this.index / this.total) * 280;
            this.eccentricity = 0.2 + Math.random() * 0.3; // Elliptical distortion
            this.angleOffset = (this.index / this.total) * Math.PI * 2;
            this.phase = Math.random() * Math.PI * 2;
        }

        update() {
            this.progress += this.speed * speedModifier;
            if (this.progress > 1) this.progress = 0;
            this.phase += 0.005;
        }

        draw() {
            this.update();

            const centerX = width / 2;
            const centerY = height / 2;
            const currentAngle = this.progress * Math.PI * 2 + this.angleOffset;

            // Basic Keplerian elliptical orbit coordinates
            let targetX = centerX + Math.cos(currentAngle) * this.baseRadius;
            let targetY = centerY + Math.sin(currentAngle) * this.baseRadius * (1 - this.eccentricity);

            // Gravitational Lensing / Mouse Deflection
            if (mouse.active && mouse.x !== null && mouse.y !== null) {
                const dx = mouse.x - targetX;
                const dy = mouse.y - targetY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 180) {
                    const lensingIntensity = (180 - distance) / 180;
                    // Deflect orbit path slightly toward the gravitational body (cursor)
                    targetX += (dx / distance) * lensingIntensity * 36;
                    targetY += (dy / distance) * lensingIntensity * 36;
                }
            }

            // Draw Orbit Trail Vector Line
            ctx.beginPath();
            ctx.strokeStyle = `rgba(0, 229, 255, ${0.045 * speedModifier})`;
            ctx.lineWidth = 0.75;
            
            // Draw full ellipse outline path
            ctx.ellipse(
                centerX, 
                centerY, 
                this.baseRadius, 
                this.baseRadius * (1 - this.eccentricity), 
                this.angleOffset, 
                0, 
                Math.PI * 2
            );
            ctx.stroke();

            // Draw active compute data-node on the orbit path
            ctx.beginPath();
            ctx.fillStyle = `rgba(0, 229, 255, ${0.35 * speedModifier})`;
            ctx.arc(targetX, targetY, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function drawBlueprintBorderMetrics() {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.lineWidth = 1;
        
        // Horizontal and Vertical border rules
        ctx.beginPath();
        ctx.moveTo(12, 12);
        ctx.lineTo(width - 12, 12);
        ctx.lineTo(width - 12, height - 12);
        ctx.lineTo(12, height - 12);
        ctx.closePath();
        ctx.stroke();

        // Architectural dimension coordinate labels
        ctx.font = "9px 'JetBrains Mono', monospace";
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        
        // Draw coordinate axes indicators
        const step = 80;
        for (let x = step; x < width; x += step) {
            ctx.fillText(`X:${x}`, x - 12, 22);
            ctx.fillText(`X:${x}`, x - 12, height - 18);
        }
        for (let y = step; y < height; y += step) {
            ctx.fillText(`Y:${y}`, 18, y + 3);
            ctx.fillText(`Y:${y}`, width - 42, y + 3);
        }
    }

    function drawTelemetryGrid() {
        ctx.clearRect(0, 0, width, height);

        // Render Coordinate blueprint metrics first
        drawBlueprintBorderMetrics();

        // Render Orbit Trajectories
        for (let i = 0; i < trajectories.length; i++) {
            trajectories[i].draw();
        }

        requestAnimationFrame(drawTelemetryGrid);
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

        const trajectoryCount = Math.max(8, Math.floor(width / 120));
        trajectories = [];
        for (let i = 0; i < trajectoryCount; i++) {
            trajectories.push(new TrajectoryOrbit(i, trajectoryCount));
        }
    }

    // Capture cursor coordinates
    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;
        mouse.active = true;
    });

    window.addEventListener('mouseleave', () => {
        mouse.active = false;
    });

    let resizeDebounce;
    window.addEventListener('resize', () => {
        clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(resizeCanvas, 120);
    });

    resizeCanvas();
    requestAnimationFrame(drawTelemetryGrid);


    /* --- 2. High-Fidelity Aerospace Telemetry Console Bootloader --- */

    const bootSequence = [
        '======================================================================',
        'LOCKHEED MARTIN | ADVANCED DEVELOPMENT PROGRAMS (SKUNK WORKS)',
        'TACTICAL FCS GN&C DIAGNOSTICS -- GROUND PORT USA-ADELAIDE-42',
        '======================================================================',
        'STATUS: CORE_SYSTEM_STBY // ALIGNMENT_IMU_DRIFT_DETECTOR',
        'TRANS_FREQ: DSN_TRANSCEIVERS_LINK_STBY (344.20 MHZ)',
        'MEM_ALLOCATION: [OCTAL] 073210 -> 077420 STBY',
        'SENSORS INDEXING:',
        '  - PITCH GYRO MISALIGNMENT: +0.048 DEG/HR',
        '  - ROLL GYRO MISALIGNMENT:  -0.032 DEG/HR',
        '  - YAW GYRO MISALIGNMENT:   +0.012 DEG/HR',
        '',
        'WARNING: FLIGHT SYSTEMS BLUEPRINT BLOCKED DUE TO IMU DRIFT DEVIATION.',
        'GROUND CONTROLLER SYSTEM CALIBRATION REQUIRED.',
        '',
        'TO CONFIGURE ALIGNMENT MATRIX AND RETRIEVE DETAILED AIRCRAFT SCHEMATICS:',
        'EXECUTE COMMAND ALIGNMENT PROCEDURE IN TERMINAL CONSOLE:',
        '',
        '      fcs.align("COMMAND_KEY")',
        '',
        'DECRYPTION PARAMETER SPECIFICATION:',
        'Locate the world speed record (Mach number) achieved by the SR-71 Blackbird.',
        'Format parameter in capital letters (e.g. "MACH3.3" or "MACH3.32").',
        '======================================================================',
    ].join('\n');

    console.log(
        '%c' + bootSequence,
        'color:#00e5ff; font-family:"JetBrains Mono", monospace; font-size:11px; line-height:1.45;'
    );


    /* --- 3. Interactive Transponder Telemetry Alignment System --- */

    const solutionA = 'MACH3.32';
    const solutionB = 'MACH3.3';

    let isAligned = false;

    function executeAvionicsUnlock() {
        if (isAligned) return;
        
        const fcsPanel = document.getElementById('fcs-blueprint');
        const statAlign = document.getElementById('stat-align');
        const statNode = document.getElementById('stat-node');
        const statCompute = document.getElementById('stat-compute');
        const statFreq = document.getElementById('stat-freq');

        if (!fcsPanel) return;

        isAligned = true;

        // Visual Canvas Acceleration
        speedModifier = 2.4;

        // Unlock system panels
        fcsPanel.classList.add('ظاهر');
        
        // Update live interface data values
        if (statAlign) {
            statAlign.textContent = 'ALIGNED (IMU LOCK)';
            statAlign.classList.add('active');
        }
        if (statNode) {
            statNode.textContent = 'ACTIVE (DSN LINK)';
            statNode.classList.add('active');
        }
        if (statCompute) {
            statCompute.textContent = 'SECURE_CORE_ALIGNED';
            statCompute.classList.add('active');
        }
        if (statFreq) {
            statFreq.textContent = '742.80 MHZ (SECURE)';
            statFreq.classList.add('active');
        }

        // Write simulated live telemetry calibration data lines in UI
        const logBox = document.getElementById('fcs-log');
        if (logBox) {
            let logLines = [
                '[FCS INFO] Calibration initialization vector dispatched...',
                '[FCS INFO] Synced transponders with Adelaide ground array USA-ADELAIDE-42...',
                '<span class="success">[FCS SUCCESS] IMU gyro platforms stabilized at zero drift matrix.</span>',
                '<span class="highlight">[FCS LOCK] SR-71 avionics schematic decryption complete. [OK]</span>',
                '[TELEMETRY UPDATE] Pitch: 0.000 rad | Roll: 0.000 rad | Yaw: 0.000 rad',
                '[TELEMETRY UPDATE] Astro-inertial navigation locked: SOL-IV ALPHA CYGNI',
                '[TELEMETRY UPDATE] Ramjet J58 powerplants status: Idle cruise thrust',
                '<span class="success">FCS STATUS: ACTIVE FLIGHT PATH UNLOCKED. DATA STREAM SECURED.</span>'
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
            }, 500);
        }
    }

    window.fcs = {
        align: function (commandKey) {
            if (typeof commandKey !== 'string') {
                console.log(
                    '%c[FCS WARN] Transponder alignment requires a string parameter, e.g. fcs.align("MACH3.3")',
                    'color:#475569; font-family:"JetBrains Mono", monospace; font-size:11px;'
                );
                return undefined;
            }

            const cleanKey = commandKey.toUpperCase().replace(/\s+/g, '');
            if (cleanKey === solutionA || cleanKey === solutionB) {
                executeAvionicsUnlock();
                console.log(
                    '%c[FCS SUCCESS] CALIBRATION VECTOR MATCHED. IMU PLATFORM SECURED. BLUEPRINTS DRAWN. [SECURE]',
                    'color:#00e5ff; font-family:"JetBrains Mono", monospace; font-size:11px; font-weight:700;'
                );
                return 'FCS_ALIGNMENT_SUCCESS';
            }

            console.log(
                '%c[FCS ERROR] DECRYPTION REJECTED. TRANSPONDER KEY OUT OF PHASE. ALIGNMENT ABORTED.',
                'color:#475569; font-family:"JetBrains Mono", monospace; font-size:11px;'
            );
            return null;
        }
    };

    // Keep quieter alias
    window.solve = window.fcs.align;

    /* --- Tactical eye trigger --- */
    const fcsBtn = document.querySelector('.نظرة');
    if (fcsBtn) {
        fcsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // Pulse trajectory velocities
            speedModifier = Math.min(speedModifier + 0.4, 3.5);
            console.log(
                '%c[FCS INFO] Calibration diagnostics dispatched. Inspect developer console for transponder instructions.',
                'color:#00e5ff; font-family:"JetBrains Mono", monospace; font-size:11px;'
            );
        });
    }
})();
