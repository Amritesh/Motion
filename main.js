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
        this.isReplaying = false;
        
        // Data storage
        this.recordedData = []; // { q: Quaternion, energy: number, dt: number }
        this.points = []; // Vector3
        this.energies = []; // numbers
        
        // Physics state
        this.pos = new THREE.Vector3(0, 0, 0);
        this.vel = new THREE.Vector3(0, 0, 0);
        this.currentQuat = new THREE.Quaternion();
        this.targetQuat = new THREE.Quaternion();
        this.energyAvg = 0;
        this.energyAlpha = 0.15; // EWMA alpha
        
        // Constants
        this.MAX_POINTS = 20000;
        this.SAMPLE_RATE = 30;
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
        this.ribbonMesh = null;
        this.coreMesh = null;

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
        this.replayBtn = document.getElementById('replay-btn');
        this.resetBtn = document.getElementById('reset-btn');
        this.retryBtn = document.getElementById('retry-btn');

        this.startBtn.addEventListener('click', () => this.startExperience());
        this.stopBtn.addEventListener('click', () => this.stopExperience());
        this.replayBtn.addEventListener('click', () => this.replayExperience());
        this.resetBtn.addEventListener('click', () => this.resetExperience());
        this.retryBtn.addEventListener('click', () => this.startExperience());
    }

    async startExperience() {
        const granted = await this.requestPermissions();
        if (!granted) {
            document.getElementById('permission-overlay').classList.remove('hidden');
            return;
        }

        document.getElementById('permission-overlay').classList.add('hidden');
        document.getElementById('start-overlay').classList.add('hidden');
        this.stopBtn.classList.remove('hidden');
        
        this.resetData();
        this.isRecording = true;
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
        this._onDeviceOrientation = (e) => {
            if (!this.isRecording) return;
            
            // Convert Euler to Quaternion
            // alpha (z), beta (x), gamma (y)
            const alpha = THREE.MathUtils.degToRad(e.alpha || 0);
            const beta = THREE.MathUtils.degToRad(e.beta || 0);
            const gamma = THREE.MathUtils.degToRad(e.gamma || 0);
            
            const euler = new THREE.Euler(beta, gamma, alpha, 'ZXY');
            this.targetQuat.setFromEuler(euler);
            
            // Adjust for portrait/landscape if needed (simplified)
            const screenOrientation = window.orientation || 0;
            if (screenOrientation === 90) {
                const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI/2);
                this.targetQuat.multiplyQuaternions(q, this.targetQuat);
            } else if (screenOrientation === -90) {
                const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI/2);
                this.targetQuat.multiplyQuaternions(q, this.targetQuat);
            }
        };

        this._onDeviceMotion = (e) => {
            if (!this.isRecording) return;
            
            const rr = e.rotationRate;
            if (rr) {
                // energy = norm(rotationRate)
                const energyRaw = Math.sqrt(rr.alpha*rr.alpha + rr.beta*rr.beta + rr.gamma*rr.gamma) / 100;
                // EWMA: energyAvg = energyAvg + alpha * (energy - energyAvg)
                this.energyAvg = this.energyAvg + this.energyAlpha * (energyRaw - this.energyAvg);
            }
        };

        window.addEventListener('deviceorientation', this._onDeviceOrientation);
        window.addEventListener('devicemotion', this._onDeviceMotion);
    }

    stopExperience() {
        this.isRecording = false;
        this.stopBtn.classList.add('hidden');
        document.getElementById('post-controls').classList.remove('hidden');
        this.headMarker.visible = false;
        this.releaseWakeLock();
        
        window.removeEventListener('deviceorientation', this._onDeviceOrientation);
        window.removeEventListener('devicemotion', this._onDeviceMotion);
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
        this.headMarker.visible = false;
        this.sculptureGroup.clear();
        this.ribbonMesh = null;
        this.coreMesh = null;
        this.points = [];
        this.energies = [];
        this.pos.set(0, 0, 0);
        this.vel.set(0, 0, 0);
        this.energyAvg = 0;
        
        if (!keepRecord) {
            this.recordedData = [];
            document.getElementById('post-controls').classList.add('hidden');
            document.getElementById('start-overlay').classList.remove('hidden');
        }
    }

    resetData() {
        this.recordedData = [];
        this.points = [];
        this.energies = [];
        this.pos.set(0, 0, 0);
        this.vel.set(0, 0, 0);
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
        // Smooth quaternion
        this.currentQuat.slerp(this.targetQuat, 0.2);
        this.currentQuat.normalize();

        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.currentQuat);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.currentQuat);
        
        const energy = THREE.MathUtils.clamp(this.energyAvg, 0, 1);
        const baseStep = 0.5;
        const step = baseStep * (0.4 + 1.6 * energy);
        
        const desiredVel = forward.clone().multiplyScalar(step);
        this.vel.lerp(desiredVel, 0.25);
        this.pos.add(this.vel);
        
        // Flow curl
        const curl = new THREE.Vector3().crossVectors(forward, up).multiplyScalar(0.05 * (0.2 + energy));
        this.pos.add(curl);

        // Record for replay
        if (this.isRecording) {
            this.recordedData.push({
                q: this.targetQuat.clone(),
                energy: this.energyAvg,
                dt: dt
            });
        }

        this.addPoint(this.pos.clone(), energy);
        this.emitParticles(this.pos, energy);
    }

    addPoint(p, e) {
        this.points.push(p);
        this.energies.push(e);

        if (this.points.length > this.MAX_POINTS) {
            // Decimate: remove every 2nd point to keep performance
            const newPoints = [];
            const newEnergies = [];
            for (let i = 0; i < this.points.length; i += 2) {
                newPoints.push(this.points[i]);
                newEnergies.push(this.energies[i]);
            }
            this.points = newPoints;
            this.energies = newEnergies;
        }

        // Rebuild geometry every ~10 samples for performance
        if (this.points.length % 10 === 0) {
            this.updateGeometry();
        }
    }

    updateGeometry() {
        if (this.points.length < 2) return;

        const ribbonGeometry = this.createRibbonGeometry(this.points, this.energies, 1.2, 0.2);
        const coreGeometry = this.createRibbonGeometry(this.points, this.energies, 0.4, 0.1);

        if (!this.ribbonMesh) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0x00ffff,
                transparent: true,
                opacity: 0.5,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });
            this.ribbonMesh = new THREE.Mesh(ribbonGeometry, mat);
            this.sculptureGroup.add(this.ribbonMesh);

            const coreMat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending
            });
            this.coreMesh = new THREE.Mesh(coreGeometry, coreMat);
            this.sculptureGroup.add(this.coreMesh);
        } else {
            this.ribbonMesh.geometry.dispose();
            this.ribbonMesh.geometry = ribbonGeometry;
            this.coreMesh.geometry.dispose();
            this.coreMesh.geometry = coreGeometry;
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
            
            // Calculate arbitrary side vector using "up"
            const side = new THREE.Vector3(0, 1, 0).cross(tangent).normalize();
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
                this.targetQuat.copy(data.q);
                this.energyAvg = data.energy;
                this.updatePhysics(data.dt);
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
        if (this.points.length > 0) {
            const center = new THREE.Vector3();
            // Sample a few points for center to avoid heavy computation
            const sampleCount = Math.min(this.points.length, 10);
            for(let i=0; i<sampleCount; i++) {
                center.add(this.points[Math.floor(Math.random() * this.points.length)]);
            }
            center.divideScalar(sampleCount);
            
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
