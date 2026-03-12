/**
 * monitor.js - Lógica principal del Monitor de Fila Virtual
 * Refactorizado para máxima compatibilidad con Smart TVs y Fire Sticks.
 */

const urlParams = new URLSearchParams(window.location.search);
const API_URL = window.APP_CONFIG?.API_URL || 'https://c07tv3p9hf.execute-api.us-east-1.amazonaws.com/Prod';
const CONFIG_KEY = 'filaVirtualConfig';

let lastVentanillaTurns = {};
let announcementQueue = [];
let isSpeaking = false;
let isFirstPoll = true;
let sucursalId = urlParams.get('id') || urlParams.get('sucursalId');
let audioActive = false;
let ttsMessageTemplate = "Turno {turno}. Por favor, acercarse a la posición número {posicion}.";
let selectedVoice = null;

function log(msg, color = 'lime') {
    const content = document.getElementById('log-content');
    if (!content) return;
    const entry = document.createElement('div');
    entry.style.color = color === 'error' ? '#ff4444' : '#00ff00';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    content.prepend(entry);
    console.log(msg);
}

// Interceptar errores globales
window.onerror = function (m, s, l, c, e) { log(`ERR: ${m}`, 'error'); };
window.onunhandledrejection = function (e) { log(`REJ: ${e.reason}`, 'error'); };

// Inicialización
window.addEventListener('load', async () => {
    // Reloj
    setInterval(() => {
        const now = new Date();
        const clockEl = document.getElementById('clock');
        if (clockEl) {
            clockEl.textContent = now.getHours().toString().padStart(2, '0') + ":" +
                now.getMinutes().toString().padStart(2, '0') + ":" +
                now.getSeconds().toString().padStart(2, '0');
        }
    }, 1000);

    // Si no hay ID, intentar identificar por IP
    if (!sucursalId) {
        const statusEl = document.getElementById('api-status');
        if (statusEl) statusEl.textContent = "Identificando...";
        try {
            const res = await fetch(`${API_URL}/sucursales/identificar`);
            const json = await res.json();
            if (json.success && json.data.SucursalId) {
                sucursalId = json.data.SucursalId;
                const ipEl = document.getElementById('debug-ip');
                if (ipEl) ipEl.textContent = `IP: ${json.data.IP} (${json.data.Nombre})`;
            }
        } catch (err) {
            log("Autodetección falló", "error");
        }
    }

    if (sucursalId) {
        startPolling();
    } else {
        const statusEl = document.getElementById('api-status');
        if (statusEl) {
            statusEl.textContent = "Esperando configuración";
            statusEl.className = "text-amber-500 font-bold";
        }
    }
});

async function activateAudio() {
    log("Activando audio...");
    audioActive = true;
    const overlay = document.getElementById('audio-overlay');
    if (overlay) overlay.classList.add('hidden');

    try {
        const bell = document.getElementById('bell-sound');
        if (bell) {
            bell.volume = 0.5;
            log("Campana test...");
            bell.play();
        }
        
        log("TTS test...");
        if (window.speechSynthesis) {
            const welcomeUtterance = new SpeechSynthesisUtterance("Audio activado");
            welcomeUtterance.lang = 'es-MX';
            window.speechSynthesis.speak(welcomeUtterance);
        }
        log("Desbloqueo enviado.");
    } catch (err) {
        log("Audio Init Err: " + err.message);
    }

    const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    if (cfg.ttsMsg) ttsMessageTemplate = cfg.ttsMsg;
}

function testAudio() {
    if (!audioActive) {
        alert("Primero debes activar el audio haciendo clic en la pantalla.");
        return;
    }
    announcementQueue.push({
        turno: "A-00",
        ventanilla: "0",
        sucursal: "Prueba de Sonido"
    });
    if (!isSpeaking) processQueue();
}

async function fetchTurno() {
    if (!sucursalId) return;
    try {
        const res = await fetch(`${API_URL}/turnos/${sucursalId}`);
        if (res.status === 403) {
            const errorOverlay = document.getElementById('ip-error-overlay');
            if (errorOverlay) errorOverlay.classList.remove('hidden');
            return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);

        const data = json.data || json;
        const nombreEl = document.getElementById('sucursal-nombre');
        if (nombreEl) nombreEl.textContent = data.NombreSucursal || `Sucursal: ${sucursalId}`;

        const ventanillas = data.VentanillasStatus || {};

        Object.keys(ventanillas).forEach(vNum => {
            const currentTurnRaw = ventanillas[vNum];
            const lastTurnRaw = lastVentanillaTurns[vNum];

            if (currentTurnRaw !== lastTurnRaw) {
                const currentTurnClean = currentTurnRaw.split('|')[0];
                if (!isFirstPoll) {
                    announcementQueue.push({
                        turno: currentTurnClean,
                        ventanilla: vNum,
                        sucursal: data.NombreSucursal || 'Sucursal'
                    });
                    if (!isSpeaking) processQueue();
                }
            }
            lastVentanillaTurns[vNum] = currentTurnRaw;
        });

        isFirstPoll = false;
        
        const mainTurnEl = document.getElementById('turno-actual');
        if (mainTurnEl && mainTurnEl.textContent === '--' && data.TurnoFormateado) {
            mainTurnEl.textContent = data.TurnoFormateado;
        }

        updateVentanillasGrid(ventanillas);

        const statusEl = document.getElementById('api-status');
        if (statusEl) {
            statusEl.textContent = "Online";
            statusEl.className = "text-emerald-500 font-bold";
        }
    } catch (err) {
        const statusEl = document.getElementById('api-status');
        if (statusEl) {
            statusEl.textContent = "Buscando reconexión...";
            statusEl.className = "text-amber-500 font-bold animate-pulse";
        }
    }
}

function loadVoices() {
    if (!window.speechSynthesis) {
        const debugVoicesEl = document.getElementById('debug-voices');
        if (debugVoicesEl) debugVoicesEl.textContent = `Voces: No Disponible`;
        const planBAlert = document.getElementById('plan-b-alert');
        if (planBAlert) planBAlert.classList.remove('hidden');
        return;
    }
    const voices = window.speechSynthesis.getVoices();
    const debugVoicesEl = document.getElementById('debug-voices');
    if (debugVoicesEl) debugVoicesEl.textContent = `Voces: ${voices.length}`;

    if (voices.length === 0) {
        const planBAlert = document.getElementById('plan-b-alert');
        if (planBAlert) planBAlert.classList.remove('hidden');
    } else {
        const planBAlert = document.getElementById('plan-b-alert');
        if (planBAlert) planBAlert.classList.add('hidden');
    }

    const priorities = ['es-MX', 'es-CO', 'es-AR', 'es-US', 'es-ES', 'es-'];
    for (let lang of priorities) {
        const femVoice = voices.find(v =>
            v.lang.startsWith(lang) &&
            (v.name.includes('female') || v.name.includes('Monica') || v.name.includes('Paulina'))
        );
        if (femVoice) { selectedVoice = femVoice; return; }
        const anyVoice = voices.find(v => v.lang.startsWith(lang));
        if (anyVoice) { selectedVoice = anyVoice; return; }
    }
}

async function playPollyTTS(text) {
    const finishPlay = () => {
        isSpeaking = false;
        setTimeout(processQueue, 500);
    };

    try {
        log(`Polly: "${text.substring(0, 15)}..."`);
        const audioUrl = `${API_URL}/tts?text=${encodeURIComponent(text)}`;
        
        const xhr = new XMLHttpRequest();
        xhr.open('GET', audioUrl, true);
        xhr.timeout = 10000;

        xhr.onload = function() {
            if (xhr.status === 200) {
                try {
                    const data = JSON.parse(xhr.responseText);
                    log(`Datos OK: ${data.audio ? data.audio.length : 0} b`);
                    
                    const audio = new Audio('data:audio/mp3;base64,' + data.audio);
                    
                    audio.onended = () => { log("Voz fin"); finishPlay(); };
                    audio.onerror = (e) => { 
                        log("Voz ERR: " + (audio.error ? audio.error.code : '?'), "error"); 
                        finishPlay(); 
                    };

                    const bell = document.getElementById('bell-sound');
                    log("Intentando sonidos...");
                    
                    try { if (bell) bell.play(); } catch(e) {}
                    
                    setTimeout(() => {
                        log("Ejecutando voz...");
                        audio.play().catch(e => {
                            log("Play Bloqueado (Reactivar)", "error");
                            finishPlay();
                        });
                    }, 500);

                } catch (e) {
                    log("Procesar ERR: " + e.message, "error");
                    finishPlay();
                }
            } else {
                log(`Red ERR: ${xhr.status}`, "error");
                finishPlay();
            }
        };

        xhr.onerror = () => { log("Conexión fallida", "error"); finishPlay(); };
        xhr.ontimeout = () => { log("Timeout red", "error"); finishPlay(); };
        xhr.send();

    } catch (err) {
        log("Crash: " + err.message, "error");
        finishPlay();
    }
}

function processQueue() {
    if (isSpeaking || announcementQueue.length === 0 || !audioActive) return;

    isSpeaking = true;
    const nextMatch = announcementQueue.shift();
    updateMainUI(nextMatch);

    const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
    if (cfg.ttsMsg) ttsMessageTemplate = cfg.ttsMsg;

    let turnoFonetico = nextMatch.turno.toString().replace(/^[bB]\b/g, 'be');

    const msg = ttsMessageTemplate
        .replace(/{turno}/g, turnoFonetico)
        .replace(/{ventanilla}/g, nextMatch.ventanilla)
        .replace(/{posicion}/g, nextMatch.ventanilla)
        .replace(/{sucursal}/g, nextMatch.sucursal);

    const hasLocalSpeech = window.SpeechSynthesisUtterance && window.speechSynthesis && window.speechSynthesis.getVoices().length > 0;

    if (!hasLocalSpeech) {
        log("Plan B (Amazon Polly)");
        playPollyTTS(msg);
        return;
    }

    const utterance = new SpeechSynthesisUtterance(msg);
    if (!selectedVoice) loadVoices();
    if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang;
    } else {
        utterance.lang = 'es-MX';
    }
    utterance.rate = 0.9;
    utterance.pitch = 1.0;

    utterance.onstart = () => log(`Hablando: ${nextMatch.turno}`);
    utterance.onend = () => { log("Voz fin"); isSpeaking = false; setTimeout(processQueue, 500); };
    utterance.onerror = (e) => { log(`Speak ERR: ${e.error}`, 'error'); isSpeaking = false; processQueue(); };

    const bell = document.getElementById('bell-sound');
    try { if(bell) bell.play(); } catch(e) {}
    setTimeout(() => {
        window.speechSynthesis.speak(utterance);
    }, 800);
}

function updateMainUI(llamado) {
    const el = document.getElementById('turno-actual');
    const vText = document.getElementById('ventanilla-actual');
    if (!el || !vText) return;

    el.textContent = llamado.turno;
    const vNumEl = document.getElementById('v-num');
    if (vNumEl) vNumEl.textContent = llamado.ventanilla;
    vText.classList.remove('opacity-0');

    el.classList.remove('main-number-change');
    void el.offsetWidth;
    el.classList.add('main-number-change');
}

function updateVentanillasGrid(ventanillas) {
    const container = document.getElementById('ventanillas-grid');
    if (!container) return;
    const keys = Object.keys(ventanillas).sort((a, b) => parseInt(a) - parseInt(b));
    const currentTurnText = document.getElementById('turno-actual').textContent;

    if (keys.length === 0) return;

    container.innerHTML = keys.map(vNum => {
        const turnClean = ventanillas[vNum].split('|')[0];
        const isMain = turnClean === currentTurnText;
        return `
        <div class="flex items-center px-4 py-3 rounded-2xl transition-all duration-500 ${isMain ? 'bg-primary/20 border border-primary/30' : 'bg-neutral-dark/40 border border-transparent'}">
            <div class="w-1/5 flex justify-center">
                <div class="bg-primary text-background-dark size-9 rounded-xl flex items-center justify-center font-black text-xl shadow-lg shadow-primary/10">
                    ${vNum}
                </div>
            </div>
            <div class="w-4/5 text-center">
                <span class="text-xl font-black ${isMain ? 'text-white' : 'text-slate-300'}">${turnClean}</span>
            </div>
        </div>`;
    }).join('');
}

function startPolling() {
    fetchTurno();
    setInterval(fetchTurno, 3000);
}

// Algunos navegadores cargan las voces de forma asíncrona
if (window.speechSynthesis && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = loadVoices;
}
setInterval(loadVoices, 5000);
