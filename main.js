import * as THREE from 'three';

/**
 * MOTION SCULPTURE - Refactored
 * Optimized for Gyro-based Air Drawing.
 */

class MotionSculpture {
    constructor() {
        this.canvas = document.getElementById('canvas');
        this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        this.isPainting = false;
        this.isKaleidoscope = false;
        this.folds = 6;
        
        this.currentColor = "#00ffff";
        this.strokes = [];
        
        this.targetQ = new THREE.Quaternion();
        this.smoothQ = new THREE.Quaternion();
        this.initialQ = null;
        this.pos = new THREE.Vector3(0, 0, -20);
        this.energyAvg = 0.2;
        
        this.initThree();
        this.initUI();
        this.animate();
    }

    initThree() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000814);
        
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(window.innerWidth, window.innerHeight);

        this.scene.add(new THREE.AmbientLight(0x404040, 2));

        this.sculptureGroup = new THREE.Group();
        this.scene.add(this.sculptureGroup);

        this.initStarfield();
        this.initParticles();

        window.addEventListener('resize', () => this.onResize());
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

    initParticles() {
        this.particleCount = 500;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(this.particleCount * 3);
        for (let i = 0; i < this.particleCount * 3; i++) pos[i] = 10000;
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0x00ffff, size: 0.2, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending
        }));
        this.particleVelocities = Array.from({ length: this.particleCount }, () => new THREE.Vector3());
        this.particleLifetimes = new Float32Array(this.particleCount);
        this.scene.add(this.particles);
        this.nextParticleIdx = 0;
    }

    emitParticles(pos, energy) {
        const count = Math.floor(1 + energy * 3);
        const positions = this.particles.geometry.attributes.position.array;
        for (let i = 0; i < count; i++) {
            const idx = this.nextParticleIdx;
            const offset = idx * 3;
            positions[offset] = pos.x;
            positions[offset + 1] = pos.y;
            positions[offset + 2] = pos.z;
            this.particleVelocities[idx].set((Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1, (Math.random() - 0.5) * 0.1);
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
                positions[i * 3] = 10000;
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    initUI() {
        this.startBtn = document.getElementById('start-btn');
        this.stopBtn = document.getElementById('stop-btn');
        this.paintBtn = document.getElementById('paint-btn');
        this.kaleidoscopeBtn = document.getElementById('kaleidoscope-btn');
        this.colorPicker = document.getElementById('color-picker');
        this.resetBtn = document.getElementById('reset-btn');
        this.retryBtn = document.getElementById('retry-btn');

        this.startBtn.addEventListener('click', () => this.startExperience());
        this.stopBtn.addEventListener('click', () => this.stopExperience());
        this.resetBtn.addEventListener('click', () => this.resetExperience());
        this.retryBtn.addEventListener('click', () => this.startExperience());

        this.paintBtn.addEventListener('click', () => {
            this.isPainting = !this.isPainting;
            this.paintBtn.classList.toggle('active', this.isPainting);
            if (this.isPainting) this.createNewStroke();
        });

        if (this.kaleidoscopeBtn) {
            this.kaleidoscopeBtn.addEventListener('click', () => {
                this.isKaleidoscope = !this.isKaleidoscope;
                this.kaleidoscopeBtn.classList.toggle('active', this.isKaleidoscope);
            });
        }

        this.colorPicker.addEventListener('input', (e) => {
            this.currentColor = e.target.value;
            if (this.isPainting) this.createNewStroke();
        });
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
        this.setupMotionListeners();
    }

    async requestPermissions() {
        if (!this.isMobile) return true;
        try {
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                const res = await DeviceOrientationEvent.requestPermission();
                if (res !== 'granted') return false;
            }
            return true;
        } catch (e) { return true; }
    }

    setupMotionListeners() {
        this._onDeviceOrientation = (e) => {
            const alpha = THREE.MathUtils.degToRad(e.alpha || 0);
            const beta = THREE.MathUtils.degToRad(e.beta || 0);
            const gamma = THREE.MathUtils.degToRad(e.gamma || 0);
            const q = new THREE.Quaternion();
            const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
            q.setFromEuler(euler);
            q.multiply(new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)));
            if (!this.initialQ) this.initialQ = q.clone().invert();
            this.targetQ.copy(this.initialQ).multiply(q);
        };
        window.addEventListener('deviceorientation', this._onDeviceOrientation);
        
        window.addEventListener('mousemove', (e) => {
            if (this.isMobile) return;
            const nx = (e.clientX / window.innerWidth - 0.5) * 2;
            const ny = (e.clientY / window.innerHeight - 0.5) * 2;
            this.targetQ.setFromEuler(new THREE.Euler(-ny * Math.PI / 4, -nx * Math.PI / 2, 0, 'YXZ'));
        });
    }

    stopExperience() {
        document.getElementById('controls').classList.add('hidden');
        document.getElementById('post-controls').classList.remove('hidden');
    }

    resetExperience() {
        this.sculptureGroup.clear();
        this.strokes = [];
        document.getElementById('post-controls').classList.add('hidden');
        document.getElementById('start-overlay').classList.remove('hidden');
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    updatePointer(dt) {
        this.smoothQ.slerp(this.targetQ, this.isPainting ? 0.35 : 0.12);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.smoothQ);
        this.pos.copy(dir.multiplyScalar(20));
        if (this.isPainting) this.addPoint(this.pos.clone(), this.energyAvg);
        this.emitParticles(this.pos, this.energyAvg);
    }

    createNewStroke() {
        this.strokes.push({
            points: [], energies: [], color: this.currentColor,
            meshes: [], isKaleidoscope: this.isKaleidoscope
        });
    }

    addPoint(p, e) {
        if (this.strokes.length === 0 || this.strokes[this.strokes.length - 1].isKaleidoscope !== this.isKaleidoscope) this.createNewStroke();
        const s = this.strokes[this.strokes.length - 1];
        if (s.points.length > 0 && p.distanceTo(s.points[s.points.length - 1]) < 0.15) return;
        s.points.push(p);
        s.energies.push(e);
        this.updateStrokeGeometry(s);
    }

    updateStrokeGeometry(stroke) {
        if (stroke.points.length < 2) return;
        const folds = stroke.isKaleidoscope ? this.folds : 1;
        if (stroke.meshes.length !== folds) {
            stroke.meshes.forEach(m => {
                this.sculptureGroup.remove(m.ribbonMesh);
                this.sculptureGroup.remove(m.coreMesh);
            });
            stroke.meshes = [];
        }
        const ribbonGeo = this.createRibbonGeometry(stroke.points, stroke.energies, 1.2, 0.2);
        const coreGeo = this.createRibbonGeometry(stroke.points, stroke.energies, 0.4, 0.1);
        for (let i = 0; i < folds; i++) {
            if (!stroke.meshes[i]) {
                const ribbonMesh = new THREE.Mesh(ribbonGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(stroke.color), transparent: true, opacity: 0.5, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
                const coreMesh = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
                this.sculptureGroup.add(ribbonMesh);
                this.sculptureGroup.add(coreMesh);
                stroke.meshes[i] = { ribbonMesh, coreMesh };
            } else {
                stroke.meshes[i].ribbonMesh.geometry.dispose();
                stroke.meshes[i].ribbonMesh.geometry = ribbonGeo;
                stroke.meshes[i].coreMesh.geometry.dispose();
                stroke.meshes[i].coreMesh.geometry = coreGeo;
            }
            stroke.meshes[i].ribbonMesh.rotation.y = (Math.PI * 2 * i) / folds;
            stroke.meshes[i].coreMesh.rotation.y = (Math.PI * 2 * i) / folds;
        }
    }

    createRibbonGeometry(points, energies, widthMult, minWidth) {
        const count = points.length;
        const positions = new Float32Array(count * 2 * 3);
        let lastSide = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < count; i++) {
            const p = points[i];
            const energy = energies[i];
            let tangent = (i < count - 1) ? points[i+1].clone().sub(p).normalize() : p.clone().sub(points[i-1]).normalize();
            if (i === 0) {
                if (Math.abs(tangent.y) > 0.9) lastSide.set(1, 0, 0);
                lastSide.cross(tangent).normalize();
            } else {
                const binormal = tangent.clone().cross(lastSide).normalize();
                lastSide.crossVectors(binormal, tangent).normalize();
            }
            const width = (minWidth + energy * widthMult);
            const v1 = p.clone().add(lastSide.clone().multiplyScalar(width));
            const v2 = p.clone().sub(lastSide.clone().multiplyScalar(width));
            const idx = i * 6;
            positions[idx] = v1.x; positions[idx+1] = v1.y; positions[idx+2] = v1.z;
            positions[idx+3] = v2.x; positions[idx+4] = v2.y; positions[idx+5] = v2.z;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const indices = [];
        for (let i = 0; i < count - 1; i++) {
            const base = i * 2;
            indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        geo.setIndex(indices);
        return geo;
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const now = performance.now();
        const dt = (now - (this.lastFrameTime || now)) / 1000;
        this.lastFrameTime = now;
        this.updatePointer(dt);
        if (this.starfield) { this.starfield.rotation.y += 0.0005; this.starfield.rotation.x += 0.0002; }
        this.updateParticles(dt);
        this.camera.quaternion.copy(this.smoothQ);
        this.renderer.render(this.scene, this.camera);
    }
}

new MotionSculpture();
