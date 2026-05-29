/*
 *  ======================================================================
 *  AEROSPACE INTROSPECTION & 3D VECTOR PROJECTION ENGINE
 *  THEME: OBSIDIAN VOID / MATTE MATHEMATICS / first-principles CALCULATIONS
 *  ZERO-EMOJI AND ZERO-CLICHÉ DESIGN PROTOCOL
 *  ======================================================================
 */

(() => {
    'use strict';

    /* --- 1. Background Canvas: Mathematical Trajectory Fields --- */

    const bgCanvas = document.getElementById('الخلفية');
    const bgCtx = bgCanvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let bgWidth = 0;
    let bgHeight = 0;
    let bgOrbits = [];
    let bgSpeed = 0.8;
    let mouse = { x: null, y: null, active: false };

    class KeplerianOrbit {
        constructor(index, total) {
            this.index = index;
            this.total = total;
            this.reset();
        }

        reset() {
            this.progress = Math.random();
            this.speed = 0.0002 + Math.random() * 0.0004;
            this.radius = 120 + (this.index / this.total) * 320;
            this.eccentricity = 0.15 + Math.random() * 0.25;
            this.angleOffset = (this.index / this.total) * Math.PI * 2;
        }

        update() {
            this.progress += this.speed * bgSpeed;
            if (this.progress > 1) this.progress = 0;
        }

        draw() {
            this.update();

            const cx = bgWidth / 2;
            const cy = bgHeight / 2;
            const angle = this.progress * Math.PI * 2 + this.angleOffset;

            let x = cx + Math.cos(angle) * this.radius;
            let y = cy + Math.sin(angle) * this.radius * (1 - this.eccentricity);

            // Gravitational bending towards cursor
            if (mouse.active && mouse.x !== null && mouse.y !== null) {
                const dx = mouse.x - x;
                const dy = mouse.y - y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance < 200) {
                    const lens = (200 - distance) / 200;
                    x += (dx / distance) * lens * 28;
                    y += (dy / distance) * lens * 28;
                }
            }

            // Draw clean mathematical orbit path
            bgCtx.beginPath();
            bgCtx.strokeStyle = `rgba(255, 255, 255, 0.012)`;
            bgCtx.lineWidth = 0.6;
            bgCtx.ellipse(cx, cy, this.radius, this.radius * (1 - this.eccentricity), this.angleOffset, 0, Math.PI * 2);
            bgCtx.stroke();

            // Draw trace data node
            bgCtx.beginPath();
            bgCtx.fillStyle = `rgba(255, 255, 255, 0.08)`;
            bgCtx.arc(x, y, 1.2, 0, Math.PI * 2);
            bgCtx.fill();
        }
    }

    function drawBlueprintTicks() {
        bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
        bgCtx.lineWidth = 0.75;
        
        bgCtx.beginPath();
        bgCtx.moveTo(16, 16);
        bgCtx.lineTo(bgWidth - 16, 16);
        bgCtx.lineTo(bgWidth - 16, bgHeight - 16);
        bgCtx.lineTo(16, bgHeight - 16);
        bgCtx.closePath();
        bgCtx.stroke();

        bgCtx.font = "8px 'JetBrains Mono', monospace";
        bgCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';

        const step = 100;
        for (let x = step; x < bgWidth; x += step) {
            bgCtx.fillText(`X:${x}`, x - 12, 26);
            bgCtx.fillText(`X:${x}`, x - 12, bgHeight - 22);
        }
        for (let y = step; y < bgHeight; y += step) {
            bgCtx.fillText(`Y:${y}`, 22, y + 3);
            bgCtx.fillText(`Y:${y}`, bgWidth - 46, y + 3);
        }
    }

    function drawBgLoop() {
        bgCtx.clearRect(0, 0, bgWidth, bgHeight);
        drawBlueprintTicks();

        for (let i = 0; i < bgOrbits.length; i++) {
            bgOrbits[i].draw();
        }

        requestAnimationFrame(drawBgLoop);
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

        const count = Math.max(6, Math.floor(bgWidth / 150));
        bgOrbits = [];
        for (let i = 0; i < count; i++) {
            bgOrbits.push(new KeplerianOrbit(i, count));
        }
    }

    resizeBgCanvas();
    requestAnimationFrame(drawBgLoop);


    /* --- 2. Master Interactive Component: The Introspection Matrix --- */

    const mCanvas = document.getElementById('introspection-canvas');
    if (mCanvas) {
        const mCtx = mCanvas.getContext('2d');
        const mDpr = Math.min(window.devicePixelRatio || 1, 2);

        let mWidth = 0;
        let mHeight = 0;
        let mMouse = { x: null, y: null, active: false };
        let activeKeys = ['[query]', '[dataset]', '[kinematics]', '[vla_model]'];
        let activeValues = ['[attn_0]', '[attn_1]', '[attn_2]', '[attn_3]'];
        let timePhase = 0;

        // Alignment unlock states
        let isSystemAligned = false;
        let rotationX = 0.4;
        let rotationY = 0.5;
        let rotationZ = 0.25;

        // Define 3D wireframe coordinates of the Lockheed SR-71 Blackbird
        const spacecraftVertices = [
            {x: 0, y: 115, z: 0},       // Nose (0)
            {x: 0, y: 55, z: 4.5},      // Canopy top (1)
            {x: 0, y: 25, z: 2.2},      // Canopy deck (2)
            {x: 0, y: -90, z: 0},       // Fuselage exhaust (3)
            
            {x: -12, y: 15, z: 0},      // Left wing root front (4)
            {x: -46, y: -72, z: -2.5},  // Left wing tip (5)
            {x: -12, y: -80, z: 0},     // Left wing root aft (6)
            
            {x: 12, y: 15, z: 0},       // Right wing root front (7)
            {x: 46, y: -72, z: -2.5},   // Right wing tip (8)
            {x: 12, y: -80, z: 0},      // Right wing root aft (9)
            
            // Left J58 Nacelle Cylinders
            {x: -24, y: 20, z: -1.2},   // Left engine intake (10)
            {x: -24, y: -95, z: -1.2},  // Left engine exhaust (11)
            {x: -29, y: -35, z: 2.5},   // Left engine top (12)
            {x: -19, y: -35, z: -4.5},  // Left engine bottom (13)
            
            // Right J58 Nacelle Cylinders
            {x: 24, y: 20, z: -1.2},    // Right engine intake (14)
            {x: 24, y: -95, z: -1.2},   // Right engine exhaust (15)
            {x: 29, y: -35, z: 2.5},    // Right engine top (16)
            {x: 19, y: -35, z: -4.5},   // Right engine bottom (17)
            
            // Tail Fin tips
            {x: -20, y: -75, z: 18},    // Left fin (18)
            {x: 20, y: -75, z: 18}      // Right fin (19)
        ];

        const spacecraftLines = [
            [0, 1], [1, 2], [2, 3],                 // Fuselage spine centerline
            [0, 4], [4, 5], [5, 6], [6, 3],         // Left delta wing outline
            [0, 7], [7, 8], [8, 9], [9, 3],         // Right delta wing outline
            
            // Left J58 powerplant structural wireframes
            [10, 12], [12, 11], [11, 13], [13, 10], // Longitudinal spars
            [10, 13], [12, 13], [10, 12],           // Rib frames
            [4, 10], [5, 11],                       // Structural wing links
            
            // Right J58 powerplant structural wireframes
            [14, 16], [16, 15], [15, 17], [17, 14], // Longitudinal spars
            [14, 17], [16, 17], [14, 16],           // Rib frames
            [7, 14], [8, 15],                       // Structural wing links
            
            // Left/Right Vertical Stabilizers (Fins)
            [6, 18], [11, 18], [3, 18],
            [9, 19], [15, 19], [3, 19]
        ];

        function resizeMatrixCanvas() {
            mWidth = mCanvas.parentElement.clientWidth - 24;
            mHeight = 320;

            mCanvas.style.width = mWidth + 'px';
            mCanvas.style.height = mHeight + 'px';
            mCanvas.width = mWidth * mDpr;
            mCanvas.height = mHeight * mDpr;

            mCtx.setTransform(1, 0, 0, 1, 0, 0);
            mCtx.scale(mDpr, mDpr);
        }

        function rotate3D(point, rx, ry, rz) {
            // Rotate on X axis
            let cosX = Math.cos(rx), sinX = Math.sin(rx);
            let y1 = point.y * cosX - point.z * sinX;
            let z1 = point.y * sinX + point.z * cosX;

            // Rotate on Y axis
            let cosY = Math.cos(ry), sinY = Math.sin(ry);
            let x2 = point.x * cosY + z1 * sinY;
            let z2 = -point.x * sinY + z1 * cosY;

            // Rotate on Z axis
            let cosZ = Math.cos(rz), sinZ = Math.sin(rz);
            let x3 = x2 * cosZ - y1 * sinZ;
            let y3 = x2 * sinZ + y1 * cosZ;

            return { x: x3, y: y3, z: z2 };
        }

        function project3D(point) {
            const centerX = mWidth / 2;
            const centerY = mHeight / 2;
            // 3D perspective parameters
            const focalLength = 180;
            const depthDistance = 160;

            const scale = focalLength / (point.z + depthDistance);
            const x2d = centerX + point.x * scale;
            const y2d = centerY - point.y * scale; // Invert Y axis for standard cartesian direction

            return { x: x2d, y: y2d };
        }

        function drawIntrospectionLoop() {
            mCtx.clearRect(0, 0, mWidth, mHeight);
            timePhase += 0.02;

            if (isSystemAligned) {
                /* --- Render Spinning 3D Wireframe SR-71 Blackbird --- */
                mCtx.font = "8px 'JetBrains Mono', monospace";
                mCtx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                mCtx.fillText("FCS STATUS // TELEMETRY LINKED", 16, 20);
                mCtx.fillText(`PITCH: ${rotationX.toFixed(3)} RAD // YAW: ${rotationY.toFixed(3)} RAD`, 16, 32);

                // Slow structural rotation
                rotationX += 0.002;
                rotationY += 0.0045;
                rotationZ += 0.001;

                // Enable mouse deflection of aircraft yaw and pitch vectors
                let currentRotX = rotationX;
                let currentRotY = rotationY;
                if (mMouse.active && mMouse.x !== null && mMouse.y !== null) {
                    currentRotY += (mMouse.x - mWidth / 2) * 0.004;
                    currentRotX += -(mMouse.y - mHeight / 2) * 0.004;
                }

                // Project and draw lines
                mCtx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
                mCtx.lineWidth = 0.85;

                for (let i = 0; i < spacecraftLines.length; i++) {
                    const p1Index = spacecraftLines[i][0];
                    const p2Index = spacecraftLines[i][1];

                    const rotP1 = rotate3D(spacecraftVertices[p1Index], currentRotX, currentRotY, rotationZ);
                    const rotP2 = rotate3D(spacecraftVertices[p2Index], currentRotX, currentRotY, rotationZ);

                    const projP1 = project3D(rotP1);
                    const projP2 = project3D(rotP2);

                    mCtx.beginPath();
                    mCtx.moveTo(projP1.x, projP1.y);
                    mCtx.lineTo(projP2.x, projP2.y);
                    mCtx.stroke();
                }

                // Draw coordinate node dots on projected vertices
                mCtx.fillStyle = 'rgba(0, 229, 255, 0.8)';
                for (let i = 0; i < spacecraftVertices.length; i++) {
                    const rotP = rotate3D(spacecraftVertices[i], currentRotX, currentRotY, rotationZ);
                    const projP = project3D(rotP);
                    mCtx.beginPath();
                    mCtx.arc(projP.x, projP.y, 1.5, 0, Math.PI * 2);
                    mCtx.fill();
                }

            } else {
                /* --- Render First-Principles Softmax Attention Head Weave --- */
                const keyX = 64;
                const valX = mWidth - 64;
                const nodeHeight = mHeight / 5;

                // 1. Calculate Softmax Attention Weights based on Cursor Query Vector
                let distances = [];
                let exponentials = [];
                let sumExp = 0;

                const qx = mMouse.active && mMouse.x !== null ? mMouse.x : mWidth / 2;
                const qy = mMouse.active && mMouse.y !== null ? mMouse.y : mHeight / 2;

                for (let i = 0; i < 4; i++) {
                    const keyY = nodeHeight * (i + 1);
                    const distSq = (qx - keyX) * (qx - keyX) + (qy - keyY) * (qy - keyY);
                    
                    // Gaussian radial similarity metric
                    const similarity = Math.exp(-distSq / 16000);
                    distances.push(similarity);
                    sumExp += similarity;
                }

                // Compute normalized Softmax probability distribution
                let attentionWeights = [];
                for (let i = 0; i < 4; i++) {
                    attentionWeights.push(distances[i] / (sumExp || 1));
                }

                // 2. Draw Introspection Margins and Input Nodes
                mCtx.font = "10px 'JetBrains Mono', monospace";
                mCtx.textBaseline = 'middle';

                for (let i = 0; i < 4; i++) {
                    const keyY = nodeHeight * (i + 1);
                    
                    // Left Input Key labels
                    mCtx.fillStyle = attentionWeights[i] > 0.4 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.3)';
                    mCtx.textAlign = 'right';
                    mCtx.fillText(activeKeys[i], keyX - 16, keyY);
                    
                    // Key Node Indicator
                    mCtx.fillStyle = attentionWeights[i] > 0.4 ? '#ffffff' : 'rgba(255,255,255,0.12)';
                    mCtx.beginPath();
                    mCtx.arc(keyX, keyY, 3, 0, Math.PI * 2);
                    mCtx.fill();

                    // Right Output Value labels
                    mCtx.fillStyle = attentionWeights[i] > 0.4 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.3)';
                    mCtx.textAlign = 'left';
                    mCtx.fillText(activeValues[i], valX + 16, keyY);

                    // Value Node Indicator
                    mCtx.fillStyle = attentionWeights[i] > 0.4 ? '#ffffff' : 'rgba(255,255,255,0.12)';
                    mCtx.beginPath();
                    mCtx.arc(valX, keyY, 3, 0, Math.PI * 2);
                    mCtx.fill();
                }

                // 3. Render Central Refraction Shell
                const refCX = mWidth / 2;
                const refCY = mHeight / 2;
                mCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
                mCtx.lineWidth = 1;
                
                mCtx.beginPath();
                mCtx.arc(refCX, refCY, 42, 0, Math.PI * 2);
                mCtx.stroke();
                
                mCtx.beginPath();
                mCtx.arc(refCX, refCY, 18, 0, Math.PI * 2);
                mCtx.stroke();

                // 4. Weave the Refracted Bezier Pathway Vectors
                for (let i = 0; i < 4; i++) {
                    const keyY = nodeHeight * (i + 1);
                    const weight = attentionWeights[i];

                    for (let j = 0; j < 4; j++) {
                        const valY = nodeHeight * (j + 1);
                        
                        // Weave Control Points
                        const cp1x = keyX + (refCX - keyX) * 0.55;
                        const cp2x = refCX + (valX - refCX) * 0.45;
                        
                        // Apply wave frequency offset
                        const waveOffset = weight * 8 * Math.sin(timePhase * 4 + i * 1.5 + j);
                        const cp1y = keyY + waveOffset;
                        const cp2y = valY - waveOffset;

                        mCtx.beginPath();
                        mCtx.moveTo(keyX, keyY);
                        mCtx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, valX, valY);

                        // Visual thickness and contrast directly mapped to Softmax probability
                        const strokeAlpha = 0.015 + (weight * 0.42);
                        mCtx.strokeStyle = `rgba(255, 255, 255, ${strokeAlpha})`;
                        mCtx.lineWidth = 0.5 + (weight * 2.2);
                        mCtx.stroke();
                    }
                }

                // 5. Draw Introspection Parameter Readouts
                mCtx.fillStyle = 'rgba(255,255,255,0.06)';
                mCtx.font = "8px 'JetBrains Mono', monospace";
                mCtx.textAlign = 'center';
                mCtx.fillText(`Q_VEC = [${Math.floor(qx)}, ${Math.floor(qy)}]`, refCX, refCY + 64);
                
                // Draw live Softmax probabilities
                mCtx.textAlign = 'left';
                for (let i = 0; i < 4; i++) {
                    const keyY = nodeHeight * (i + 1);
                    mCtx.fillStyle = attentionWeights[i] > 0.4 ? 'rgba(255, 255, 255, 0.8)' : 'rgba(255, 255, 255, 0.15)';
                    mCtx.fillText(`P_ATTN // ${attentionWeights[i].toFixed(3)}`, valX + 80, keyY);
                }
            }

            requestAnimationFrame(drawIntrospectionLoop);
        }

        mCanvas.addEventListener('mousemove', (e) => {
            const rect = mCanvas.getBoundingClientRect();
            mMouse.x = e.clientX - rect.left;
            mMouse.y = e.clientY - rect.top;
            mMouse.active = true;
        });

        mCanvas.addEventListener('mouseleave', () => {
            mMouse.active = false;
        });

        window.addEventListener('resize', resizeMatrixCanvas);

        resizeMatrixCanvas();
        requestAnimationFrame(drawIntrospectionLoop);


        /* --- 3. NASA / Lockheed Skunk Works Console Bootstrap --- */

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
            'WARNING: FLIGHT CONTROL SYSTEMS BLOCKED DUE TO IMU DRIFT DEVIATIONS.',
            'GROUND CONTROLLER REALIGNMENT SEQUENCE REQUIRED.',
            '',
            'TO INTEGRATE AVIONICS CALIBRATION MATRIX AND UNLOCK SR-71 3D SCHEMATICS:',
            'EXECUTE TRANSPONDER SYNCHRONIZER IN CONSOLE INTERFACE:',
            '',
            '      fcs.align("COMMAND_KEY")',
            '',
            'DECRYPTION PARAMETER SPECIFICATION:',
            'Identify the absolute transatlantic speed record (Mach number) set',
            'by the Lockheed SR-71 Blackbird in its historic transatlantic flight.',
            'Format parameter in capital letters (e.g. "MACH3.3" or "MACH3.32").',
            '======================================================================',
        ].join('\n');

        console.log(
            '%c' + bootSequence,
            'color:#ffffff; font-family:"JetBrains Mono", monospace; font-size:11px; line-height:1.45;'
        );

        const solutionA = 'MACH3.32';
        const solutionB = 'MACH3.3';

        window.fcs = {
            align: function (commandKey) {
                if (typeof commandKey !== 'string') {
                    console.log(
                        '%c[FCS WARN] Transponder alignment requires a string parameter, e.g. fcs.align("MACH3.3")',
                        'color:#3f3f46; font-family:"JetBrains Mono", monospace; font-size:11px;'
                    );
                    return undefined;
                }

                const cleanKey = commandKey.toUpperCase().replace(/\s+/g, '');
                if (cleanKey === solutionA || cleanKey === solutionB) {
                    // Lock active states
                    isSystemAligned = true;
                    bgSpeed = 2.0;

                    const fcsPanel = document.getElementById('fcs-blueprint');
                    const statAlign = document.getElementById('stat-align');
                    const statNode = document.getElementById('stat-node');
                    const statCompute = document.getElementById('stat-compute');
                    const statFreq = document.getElementById('stat-freq');

                    if (fcsPanel) fcsPanel.classList.add('ظاهر');
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

                    // Feed scrolling UI diagnostics logs
                    const logBox = document.getElementById('fcs-log');
                    if (logBox) {
                        let logLines = [
                            '[FCS INFO] Calibration initialization vector dispatched...',
                            '[FCS INFO] Synced transponders with Adelaide ground array USA-ADELAIDE-42...',
                            '<span class="success">[FCS SUCCESS] IMU aligned with zero gyro drift matrix. System operational.</span>',
                            '<span class="highlight">[FCS LOCK] SR-71 3D vector blueprint rendering engaged. [OK]</span>',
                            '[TELEMETRY UPDATE] Pitch: 0.000 rad | Roll: 0.000 rad | Yaw: 0.000 rad',
                            '[TELEMETRY UPDATE] Astro-inertial navigation locked: SOL-IV ALPHA CYGNI',
                            '[TELEMETRY UPDATE] Ramjet J58 powerplants status: Idle cruise thrust',
                            '<span class="success">FCS STATUS: ACTIVE FLIGHT PATH UNLOCKED. DATA STREAM SECURED.</span>'
                        ];
                        
                        let idx = 0;
                        const logInterval = setInterval(() => {
                            if (idx < logLines.length) {
                                logBox.innerHTML += '<br>' + logLines[idx];
                                logBox.scrollTop = logBox.scrollHeight;
                                idx++;
                            } else {
                                clearInterval(logInterval);
                            }
                        }, 400);
                    }

                    console.log(
                        '%c[FCS SUCCESS] CALIBRATION VECTOR MATCHED. IMU PLATFORM SECURED. 3D AVIONICS BLUEPRINT UNLOCKED.',
                        'color:#ffffff; font-family:"JetBrains Mono", monospace; font-size:11px; font-weight:700;'
                    );
                    return 'FCS_ALIGNMENT_SUCCESS';
                }

                console.log(
                    '%c[FCS ERROR] DECRYPTION REJECTED. TRANSPONDER KEY OUT OF PHASE. ALIGNMENT ABORTED.',
                    'color:#3f3f46; font-family:"JetBrains Mono", monospace; font-size:11px;'
                );
                return null;
            }
        };

        window.solve = window.fcs.align;

        /* --- Tactical eye calibration toggle --- */
        const fcsBtn = document.querySelector('.نظرة');
        if (fcsBtn) {
            fcsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                bgSpeed = Math.min(bgSpeed + 0.4, 3.0);
                console.log(
                    '%c[FCS INFO] Calibration diagnostics dispatched. Inspect developer console for transponder instructions.',
                    'color:#ffffff; font-family:"JetBrains Mono", monospace; font-size:11px;'
                );
            });
        }
    }
})();
