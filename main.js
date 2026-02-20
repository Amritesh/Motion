import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
        this.pos = new THREE.Vector3(0, 0, -8);
        this.energyAvg = 0.2;
        this.isStopped = false;
        
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
        this.initPointerGlobe();
        this.initKaleidoscopeUI();

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enabled = false;

        window.addEventListener('resize', () => this.onResize());
    }

    initPointerGlobe() {
        this.pointerGlobe = new THREE.Group();
        
        const coreGeo = new THREE.SphereGeometry(0.15, 16, 16);
        const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const core = new THREE.Mesh(coreGeo, coreMat);
        
        const glowGeo = new THREE.SphereGeometry(0.4, 16, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        
        this.pointerLight = new THREE.PointLight(0x00ffff, 2, 10);
        
        this.pointerGlobe.add(core);
        this.pointerGlobe.add(glow);
        this.pointerGlobe.add(this.pointerLight);
        this.scene.add(this.pointerGlobe);
        
        this.pointerGlow = glow;
    }

    initKaleidoscopeUI() {
        this.kaleidoscopeUI = new THREE.Group();
        const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 });
        for (let i = 0; i < this.folds; i++) {
            const angle = (i * Math.PI * 2) / this.folds;
            const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(0, 0, 0),
                new THREE.Vector3(Math.cos(angle) * 20, Math.sin(angle) * 20, 0)
            ]);
            const line = new THREE.Line(geo, mat);
            line.position.z = -10;
            this.kaleidoscopeUI.add(line);
        }
        this.scene.add(this.kaleidoscopeUI);
        this.kaleidoscopeUI.visible = false;
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
        this.kaleidoscopeBtn = document.getElementById('kaleidoscope-btn');
        this.colorPicker = document.getElementById('color-picker');
        this.resetBtn = document.getElementById('reset-btn');
        this.resetBtnMain = document.getElementById('reset-btn-main');
        this.retryBtn = document.getElementById('retry-btn');

        this.startBtn.addEventListener('click', () => this.startExperience());
        this.stopBtn.addEventListener('click', () => this.stopExperience());
        this.resetBtn.addEventListener('click', () => this.resumeExperience());
        this.resetBtnMain.addEventListener('click', () => {
            if (confirm("Clear all drawings and restart?")) {
                this.resetExperience();
            }
        });
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
                this.kaleidoscopeUI.visible = this.isKaleidoscope;
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
        this.isStopped = false;
        this.controls.enabled = false;
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
        this.isStopped = true;
        this.isPainting = false;
        this.paintBtn.classList.remove('active');
        document.getElementById('controls').classList.add('hidden');
        document.getElementById('post-controls').classList.remove('hidden');
        
        this.pointerGlobe.visible = false;
        this.kaleidoscopeUI.visible = false;
        
        this.enableOrbitMode();
    }

    enableOrbitMode() {
        this.controls.enabled = true;
        
        const box = new THREE.Box3().setFromObject(this.sculptureGroup);
        if (box.isEmpty()) return;
        
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        
        const fov = this.camera.fov * (Math.PI / 180);
        let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
        cameraZ *= 1.5;
        
        this.camera.position.set(center.x, center.y, center.z + cameraZ);
        this.camera.lookAt(center);
        this.controls.target.copy(center);
        this.controls.update();
    }

    resumeExperience() {
        this.isStopped = false;
        this.controls.enabled = false;
        this.pointerGlobe.visible = true;
        this.kaleidoscopeUI.visible = this.isKaleidoscope;
        this.camera.position.set(0, 0, 0);
        this.camera.quaternion.set(0, 0, 0, 1);
        document.getElementById('post-controls').classList.add('hidden');
        document.getElementById('controls').classList.remove('hidden');
    }

    resetExperience() {
        this.sculptureGroup.clear();
        this.strokes = [];
        this.resumeExperience();
        document.getElementById('controls').classList.add('hidden');
        document.getElementById('start-overlay').classList.remove('hidden');
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    updatePointer(dt) {
        if (this.isStopped) return;
        this.smoothQ.slerp(this.targetQ, this.isPainting ? 0.35 : 0.12);
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.smoothQ);
        
        // Restrict to region: clamp the direction slightly or just use distance
        const dist = 8;
        this.pos.copy(dir.multiplyScalar(dist));
        
        this.pointerGlobe.position.copy(this.pos);
        this.pointerLight.color.set(this.currentColor);
        this.pointerGlow.material.color.set(this.currentColor);

        if (this.isPainting) {
            // Further restriction: only draw if within a "drawing volume"
            // For now, distance control is the main restriction
            this.addPoint(this.pos.clone(), this.energyAvg);
        }
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
        const ribbonGeo = this.createRibbonGeometry(stroke.points, stroke.energies, 2.5, 0.4);
        const coreGeo = this.createRibbonGeometry(stroke.points, stroke.energies, 0.8, 0.2);
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
        
        if (!this.isStopped) {
            this.camera.quaternion.copy(this.smoothQ);
        } else {
            this.controls.update();
        }
        
        this.renderer.render(this.scene, this.camera);
    }
}

new MotionSculpture();
