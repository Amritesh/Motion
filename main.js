import * as THREE from 'three';

/**
 * MOTION SCULPTURE
 * A production-ready mobile-first Three.js experience.
 */

class MotionSculpture {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.isRecording = false;
        this.isPainting = true;
        this.isReplaying = false;
        
        // Data storage
        this.recordedData = []; // { p: Vector3, energy: number, isPainting: boolean, color: string }
        this.points = []; // Array of arrays (each array is a stroke)
        this.energies = [];
        this.colors = [];
        this.currentColor = "#00ffff";
        
        // Physics state
        this.pos = new THREE.Vector3(0, 0, 0);
        this.vel = new THREE.Vector3(0, 0, 0);
        this.acc = new THREE.Vector3(0, 0, 0);
        this.gravity = new THREE.Vector3(0, 0, 0);
        this.orientation = new THREE.Quaternion();
        
        this.energyAvg = 0;
        this.energyAlpha = 0.08;
        
        // Filtering
        this.accAlpha = 0.12; // Slightly smoother
        this.velocityDamping = 0.82; // Even stronger damping to stop faster
        this.positionDamping = 1.0; // Remove pull back to allow drawing anywhere in sky
        
        // Constants
        this.MAX_POINTS = 20000;
        this.SAMPLE_RATE = 40; // Higher sample rate for smoother curves
        this.lastSampleTime = 0;
        
        this.initThree();
        this.initUI();
        this.checkDesktop();
        this.animate();
    }

    checkDesktop() {
        if (!this.isMobile) {
            document.getElementById('desktop-overlay').classList.remove('hidden');
        }
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.camera.position.z = 50;

        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        // Lights
        const ambientLight = new THREE.AmbientLight(0x404040, 2);
        this.scene.add(ambientLight);

        // Sculpture Group
        this.sculptureGroup = new THREE.Group();
        this.scene.add(this.sculptureGroup);

        // Head Marker
        const headGeo = new THREE.SphereGeometry(0.5, 16, 16);
        const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
        this.headMarker = new THREE.Mesh(headGeo, headMat);
        this.headMarker.visible = false;
        this.scene.add(this.headMarker);

        // Particles
        this.initParticles();

        // Starfield for desktop/idle
        this.initStarfield();

        // Geometry containers
        this.strokes = []; // { ribbon: Mesh, core: Mesh, points: [], energies: [], color: string }

        window.addEventListener('resize', () => this.onResize());
    }

    initParticles() {
        this.particleCount = 1200;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(this.particleCount * 3);
        const velocities = [];

        for (let i = 0; i < this.particleCount; i++) {
            velocities.push(new THREE.Vector3());
            pos[i * 3] = 10000; // Start off-screen
        }

        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        
        const mat = new THREE.PointsMaterial({
            color: 0x00ffff,
            size: 0.5,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        this.particles = new THREE.Points(geo, mat);
        this.particleVelocities = velocities;
        this.particleLifetimes = new Float32Array(this.particleCount);
        this.scene.add(this.particles);
        this.nextParticleIdx = 0;
    }

    emitParticles(pos, energy) {
        const count = Math.floor(2 + energy * 8);
        const positions = this.particles.geometry.attributes.position.array;
        
        for (let i = 0; i < count; i++) {
            const idx = this.nextParticleIdx;
            const offset = idx * 3;
            
            positions[offset] = pos.x;
            positions[offset + 1] = pos.y;
            positions[offset + 2] = pos.z;
            
            this.particleVelocities[idx].set(
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.1,
                (Math.random() - 0.5) * 0.1
            );
            this.particleLifetimes[idx] = 1.0;
            
            this.nextParticleIdx = (this.nextParticleIdx + 1) % this.particleCount;
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    updateParticles(dt) {
        const positions = this.particles.geometry.attributes.position.array;
        for (let i = 0; i < this.particleCount; i++) {
            if (this.particleLifetimes[i] > 0) {
                const offset = i * 3;
                positions[offset] += this.particleVelocities[i].x;
                positions[offset + 1] += this.particleVelocities[i].y;
                positions[offset + 2] += this.particleVelocities[i].z;
                
                this.particleLifetimes[i] -= dt * 0.5;
            } else {
                const offset = i * 3;
                positions[offset] = 10000;
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    initStarfield() {
        const geo = new THREE.BufferGeometry();
        const pos = [];
        for (let i = 0; i < 1500; i++) {
            pos.push(THREE.MathUtils.randFloatSpread(1000), THREE.MathUtils.randFloatSpread(1000), THREE.MathUtils.randFloatSpread(1000));
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({ color: 0x444444, size: 1, transparent: true, opacity: 0.5 });
        this.starfield = new THREE.Points(geo, mat);
        this.scene.add(this.starfield);
    }

    initUI() {
        this.startBtn = document.getElementById('start-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.paintBtn = document.getElementById('paint-btn');
        this.colorPicker = document.getElementById('color-picker');
        this.replayBtn = document.getElementById('replay-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.retryBtn = document.getElementById('retry-btn');

        this.startBtn.addEventListener('click', () => this.startExperience());
        this.stopBtn.addEventListener('click', () => this.stopExperience());
        this.replayBtn.addEventListener('click', () => this.replayExperience());
        this.resetBtn.addEventListener('click', () => this.resetExperience());
        this.retryBtn.addEventListener('click', () => this.startExperience());

        this.paintBtn.addEventListener('click', () => {
            this.isPainting = !this.isPainting;
            this.paintBtn.classList.toggle('active', this.isPainting);
            if (this.isPainting) {
                this.createNewStroke();
            }
        });

        this.colorPicker.addEventListener('input', (e) => {
            this.currentColor = e.target.value;
            if (this.isPainting) {
                this.createNewStroke();
            }
        });
    }

    createNewStroke() {
        if (!this.isRecording && !this.isReplaying) return;
        
        const stroke = {
            points: [],
            energies: [],
            color: this.currentColor,
            ribbonMesh: null,
            coreMesh: null
        };
        this.strokes.push(stroke);
    }

    async startExperience() {
        const granted = await this.requestPermissions();
        if (!granted) {
            document.getElementById('permission-overlay').classList.remove('hidden');
            return;
        }

        document.getElementById('permission-overlay').classList.add('hidden');
        document.getElementById('start-overlay').classList.add('hidden');
        document.getElementById('controls').classList.remove('hidden');
        
        this.resetData();
        this.isRecording = true;
        this.isPainting = true;
        this.paintBtn.classList.add('active');
        this.createNewStroke();
        
        this.headMarker.visible = true;
        this.lastSampleTime = performance.now();
        
        this.setupMotionListeners();
        this.tryWakeLock();
    }

    async requestPermissions() {
        if (!this.isMobile) return true;

        try {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                const res = await DeviceOrientationEvent.requestPermission();
                if (res !== 'granted') return false;
            }
            if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
                const res = await DeviceMotionEvent.requestPermission();
                if (res !== 'granted') return false;
            }
            return true;
        } catch (e) {
            console.warn("Permission request failed, likely not iOS 13+", e);
            return true; // Fallback for older devices or Android
        }
    }

    setupMotionListeners() {
        this._onDeviceMotion = (e) => {
            if (!this.isRecording) return;
            
            // Raw acceleration with gravity can be used to better estimate orientation
            // but for now let's focus on e.acceleration (linear acceleration)
            const a = e.acceleration;
            if (a) {
                // Stronger noise filtering
                const threshold = 0.1;
                let ax = Math.abs(a.x) < threshold ? 0 : -a.x;
                let ay = Math.abs(a.y) < threshold ? 0 : a.y;
                let az = Math.abs(a.z) < threshold ? 0 : a.z;

                // Scale for virtual space
                const scale = 15;
                this.acc.x += this.accAlpha * (ax * scale - this.acc.x);
                this.acc.y += this.accAlpha * (ay * scale - this.acc.y);
                this.acc.z += this.accAlpha * (az * scale - this.acc.z);
            }

            const rr = e.rotationRate;
            if (rr) {
                const energyRaw = Math.sqrt(rr.alpha*rr.alpha + rr.beta*rr.beta + rr.gamma*rr.gamma) / 60;
                this.energyAvg = this.energyAvg + this.energyAlpha * (energyRaw - this.energyAvg);
            }
        };

        this._onDeviceOrientation = (e) => {
            // Use orientation if we want to rotate the acceleration vector into world space
            // Currently we are just using device-relative acceleration which is why it's "drifting"
            // if you rotate the phone.
            if (e.alpha !== null) {
                const alpha = THREE.MathUtils.degToRad(e.alpha);
                const beta = THREE.MathUtils.degToRad(e.beta);
                const gamma = THREE.MathUtils.degToRad(e.gamma);
                this.orientation.setFromEuler(new THREE.Euler(beta, alpha, -gamma, 'YXZ'));
            }
        };

        window.addEventListener('devicemotion', this._onDeviceMotion);
        window.addEventListener('deviceorientation', this._onDeviceOrientation);
    }

    stopExperience() {
        this.isRecording = false;
        this.isPainting = false;
        document.getElementById('controls').classList.add('hidden');
        document.getElementById('post-controls').classList.remove('hidden');
        this.headMarker.visible = false;
        this.releaseWakeLock();
        
        window.removeEventListener('devicemotion', this._onDeviceMotion);
        window.removeEventListener('deviceorientation', this._onDeviceOrientation);
    }

    replayExperience() {
        document.getElementById('post-controls').classList.add('hidden');
        this.resetExperience(true); // Clear visual but keep recordedData
        this.isReplaying = true;
        this.replayIdx = 0;
        this.replayStartTime = performance.now();
        this.headMarker.visible = true;
    }

    resetExperience(keepRecord = false) {
        this.isRecording = false;
        this.isReplaying = false;
        this.isPainting = false;
        this.headMarker.visible = false;
        this.sculptureGroup.clear();
        this.strokes = [];
        this.pos.set(0, 0, 0);
        this.vel.set(0, 0, 0);
        this.acc.set(0, 0, 0);
        this.energyAvg = 0;
        
        if (!keepRecord) {
            this.recordedData = [];
            document.getElementById('post-controls').classList.add('hidden');
            document.getElementById('start-overlay').classList.remove('hidden');
        }
    }

    resetData() {
        this.recordedData = [];
        this.strokes = [];
        this.pos.set(0, 0, 0);
        this.vel.set(0, 0, 0);
        this.acc.set(0, 0, 0);
        this.energyAvg = 0;
        this.sculptureGroup.clear();
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    async tryWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
            } catch (err) {}
        }
    }

    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release().then(() => this.wakeLock = null);
        }
    }

    updatePhysics(dt) {
        const energy = THREE.MathUtils.clamp(this.energyAvg, 0, 1);
        
        // Transform acceleration from device space to world space using orientation
        const worldAcc = this.acc.clone().applyQuaternion(this.orientation);
        
        // Dynamic deadzone: higher when moving slow to prevent jitter, lower when moving fast
        const deadzone = 0.45;
        const accLen = worldAcc.length();

        if (accLen < deadzone) {
            worldAcc.set(0, 0, 0);
            // Aggressive braking when device is roughly at rest
            this.vel.multiplyScalar(0.7);
        } else {
            // Subtract deadzone from magnitude to prevent "jumpy" starts
            worldAcc.normalize().multiplyScalar(accLen - deadzone);
        }

        // Integrate acceleration to velocity
        this.vel.add(worldAcc.multiplyScalar(dt * 12));
        
        // Velocity damping (friction)
        this.vel.multiplyScalar(this.velocityDamping);

        // Snap to zero if very slow
        if (this.vel.length() < 0.05) this.vel.set(0, 0, 0);

        // Integrate velocity to position
        this.pos.add(this.vel.clone().multiplyScalar(dt * 60));

        // Record for replay
        if (this.isRecording) {
            this.recordedData.push({
                p: this.pos.clone(),
                energy: this.energyAvg,
                isPainting: this.isPainting,
                color: this.currentColor,
                dt: dt
            });
        }

        if (this.isPainting) {
            this.addPoint(this.pos.clone(), energy);
        }
        this.emitParticles(this.pos, energy);
    }

    addPoint(p, e) {
        if (this.strokes.length === 0) this.createNewStroke();
        
        const currentStroke = this.strokes[this.strokes.length - 1];
        
        // Only add point if it's far enough from the last point (coarser voxels/points)
        if (currentStroke.points.length > 0) {
            const lastP = currentStroke.points[currentStroke.points.length - 1];
            if (p.distanceTo(lastP) < 0.3) return;
        }

        currentStroke.points.push(p);
        currentStroke.energies.push(e);

        // Rebuild geometry for the current stroke
        this.updateStrokeGeometry(currentStroke);
    }

    updateStrokeGeometry(stroke) {
        if (stroke.points.length < 2) return;

        const ribbonGeometry = this.createRibbonGeometry(stroke.points, stroke.energies, 1.2, 0.2);
        const coreGeometry = this.createRibbonGeometry(stroke.points, stroke.energies, 0.4, 0.1);

        if (!stroke.ribbonMesh) {
            const mat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(stroke.color),
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });
            stroke.ribbonMesh = new THREE.Mesh(ribbonGeometry, mat);
            this.sculptureGroup.add(stroke.ribbonMesh);

            const coreMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });
            stroke.coreMesh = new THREE.Mesh(coreGeometry, coreMat);
            this.sculptureGroup.add(stroke.coreMesh);
        } else {
            stroke.ribbonMesh.geometry.dispose();
            stroke.ribbonMesh.geometry = ribbonGeometry;
            stroke.coreMesh.geometry.dispose();
            stroke.coreMesh.geometry = coreGeometry;
        }
    }

    createRibbonGeometry(points, energies, widthMult, minWidth) {
        const count = points.length;
        const positions = new Float32Array(count * 2 * 3); // 2 vertices per point, 3 floats each
        
        for (let i = 0; i < count; i++) {
            const p = points[i];
            const energy = energies[i];
            
            // Calculate tangent
            let tangent;
            if (i < count - 1) {
                tangent = points[i+1].clone().sub(p).normalize();
            } else {
                tangent = p.clone().sub(points[i-1]).normalize();
            }
            
            // Stable side vector using Parallel Transport approximation
            // This prevents the ribbon from twisting/shaking when direction changes
            if (!this._lastSide || i === 0) {
                this._lastSide = new THREE.Vector3(0, 1, 0);
                if (Math.abs(tangent.y) > 0.9) this._lastSide.set(1, 0, 0);
                this._lastSide.cross(tangent).normalize();
            } else {
                // Project previous side onto the new normal plane to maintain continuity
                const binormal = tangent.clone().cross(this._lastSide).normalize();
                this._lastSide.crossVectors(binormal, tangent).normalize();
            }

            const side = this._lastSide.clone();
            const width = (minWidth + energy * widthMult);
            
            const v1 = p.clone().add(side.clone().multiplyScalar(width));
            const v2 = p.clone().sub(side.clone().multiplyScalar(width));
            
            const idx = i * 6;
            positions[idx] = v1.x; positions[idx+1] = v1.y; positions[idx+2] = v1.z;
            positions[idx+3] = v2.x; positions[idx+4] = v2.y; positions[idx+5] = v2.z;
        }
        
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        // Indices for triangle strip
        const indices = [];
        for (let i = 0; i < count - 1; i++) {
            const base = i * 2;
            indices.push(base, base + 1, base + 2);
            indices.push(base + 1, base + 3, base + 2);
        }
        geo.setIndex(indices);
        return geo;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const now = performance.now();
        const dt = (now - (this.lastFrameTime || now)) / 1000;
        this.lastFrameTime = now;

        if (this.isRecording) {
            if (now - this.lastSampleTime > 1000 / this.SAMPLE_RATE) {
                this.updatePhysics(dt);
                this.lastSampleTime = now;
            }
        } else if (this.isReplaying) {
            if (this.replayIdx < this.recordedData.length) {
                const data = this.recordedData[this.replayIdx];
                
                // Handle painting toggle and color changes during replay
                if (data.isPainting !== this.isPainting || data.color !== this.currentColor) {
                    this.isPainting = data.isPainting;
                    this.currentColor = data.color;
                    if (this.isPainting) this.createNewStroke();
                }

                this.pos.copy(data.p);
                this.energyAvg = data.energy;
                
                if (this.isPainting) {
                    this.addPoint(this.pos.clone(), this.energyAvg);
                }
                this.emitParticles(this.pos, this.energyAvg);
                
                this.replayIdx++;
            } else {
                this.isReplaying = false;
                document.getElementById('post-controls').classList.remove('hidden');
                this.headMarker.visible = false;
            }
        }

        // Starfield animation
        if (this.starfield) {
            this.starfield.rotation.y += 0.0005;
            this.starfield.rotation.x += 0.0002;
        }

        this.updateParticles(dt);

        // Head marker effect
        if (this.headMarker.visible) {
            this.headMarker.position.copy(this.pos);
            const s = 1 + this.energyAvg * 2 + Math.sin(now * 0.01) * 0.2;
            this.headMarker.scale.set(s, s, s);
        }

        // Camera follow
        const allPoints = this.strokes.flatMap(s => s.points);
        if (allPoints.length > 0 || this.isRecording) {
            const center = new THREE.Vector3();
            
            if (this.isRecording || this.isReplaying) {
                center.copy(this.pos);
            } else if (allPoints.length > 0) {
                // Sample a few points for center to avoid heavy computation
                const sampleCount = Math.min(allPoints.length, 10);
                for(let i=0; i<sampleCount; i++) {
                    center.add(allPoints[Math.floor(Math.random() * allPoints.length)]);
                }
                center.divideScalar(sampleCount);
            }
            
            // Slow camera drift
            const camTarget = center.clone();
            const time = now * 0.0003;
            const orbitRadius = 60 + Math.sin(time * 0.5) * 20;
            this.camera.position.x += (camTarget.x + Math.cos(time) * orbitRadius - this.camera.position.x) * 0.02;
            this.camera.position.y += (camTarget.y + Math.sin(time * 0.7) * orbitRadius - this.camera.position.y) * 0.02;
            this.camera.position.z += (camTarget.z + Math.sin(time) * orbitRadius - this.camera.position.z) * 0.02;
            this.camera.lookAt(camTarget);
        } else {
            // Idle camera
            const time = now * 0.0001;
            this.camera.position.x = Math.sin(time) * 50;
            this.camera.position.z = Math.cos(time) * 50;
            this.camera.lookAt(0, 0, 0);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

new MotionSculpture();
