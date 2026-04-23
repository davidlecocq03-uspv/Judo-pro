let state = {
    time: 180, default: 180, running: false,
    scores: { 1: { ippon:0, waza:0, yuko:0, shido:0 }, 2: { ippon:0, waza:0, yuko:0, shido:0 } },
    osae: { active: 0, time: 0, targetI: 20, paused: false },
    p1: "BLANC", p2: "ROUGE", globalQueue: [], currentIdx: -1,
    poulesData: {}, winner: null, hansoku: 0, showIpponAnim: false
};

let timerInt = null, osaeInt = null, audioCtx = null;
let isPublicView = false;
let confettiInterval = null;
let ipponConfettiInterval = null; 
let lastWinner = null;
let ipponTimeout = null;

// Déblocage sécurité du contexte Audio au premier clic n'importe où
document.addEventListener('click', () => {
    if (!isPublicView) initAudio();
}, { once: true });

const formatName = (str) => {
    let club = "";
    let cleanStr = str.trim();
    
    const match = cleanStr.match(/(.*?)\s*\((.*?)\)$/);
    if (match) {
        cleanStr = match[1].trim();
        club = ` (${match[2].trim()})`;
    }
    
    let parts = cleanStr.split(/\s+/);
    if (parts.length === 0) return "";
    const lastName = parts.shift().toUpperCase();
    
    const firstName = parts.map(p => {
        const upper = p.toUpperCase();
        if (upper === 'HC' || upper === '[HC]') {
            return upper;
        }
        return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    }).join(' ');
    
    return `${lastName} ${firstName}${club}`;
};

window.addEventListener('keydown', (e) => {
    if (isPublicView) return; 
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
    
    const k = e.key.toLowerCase();

    if (e.code === "Space") { e.preventDefault(); toggleTimer(); }
    if (e.code === "Enter") { e.preventDefault(); archiveAndNext(); }
    if (k === 'p') { e.preventDefault(); toggleOsaePause(); }
    if (k === 't') { e.preventDefault(); toketa(); }

    if (k === 'a') { e.preventDefault(); updateScore(1, 'ippon', 1); }
    if (k === 'z') { e.preventDefault(); updateScore(1, 'waza', 1); }
    if (k === 'e') { e.preventDefault(); updateScore(1, 'yuko', 1); }
    if (k === 's') { e.preventDefault(); updateShido(1, 1); }
    if (k === 'q') { e.preventDefault(); startOsae(1); }

    if (k === 'u') { e.preventDefault(); updateScore(2, 'ippon', 1); }
    if (k === 'i') { e.preventDefault(); updateScore(2, 'waza', 1); }
    if (k === 'o') { e.preventDefault(); updateScore(2, 'yuko', 1); }
    if (k === 'k') { e.preventDefault(); updateShido(2, 1); }
    if (k === 'm') { e.preventDefault(); startOsae(2); }
});

function init() {
    const urlParams = new URLSearchParams(window.location.search);
    
    if (urlParams.get('view') === 'public') {
        isPublicView = true;
        document.body.classList.add('public-view');
        window.addEventListener('storage', (e) => {
            if (e.key === 'judo_sync_v14') { 
                state = JSON.parse(e.newValue); 
                render(); 
            }
        });
        document.body.addEventListener('dblclick', () => {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else document.exitFullscreen();
        });
    } 
    else {
        if (!sessionStorage.getItem('judo_session_active')) {
            localStorage.removeItem('judo_sync_v14'); 
            sessionStorage.setItem('judo_session_active', 'true');
        }
        
        document.getElementById('poule-name-input').addEventListener('input', (e) => localStorage.setItem('judo_draft_poule', e.target.value));
        document.getElementById('poule-players-input').addEventListener('input', (e) => localStorage.setItem('judo_draft_players', e.target.value));
        
        const savedPoule = localStorage.getItem('judo_draft_poule');
        if(savedPoule) document.getElementById('poule-name-input').value = savedPoule;
        const savedPlayers = localStorage.getItem('judo_draft_players');
        if(savedPlayers) document.getElementById('poule-players-input').value = savedPlayers;
    }
    
    // Audio Persistence
    const v = localStorage.getItem('judo_vol'); 
    if(v !== null) {
        document.getElementById('vol-range').value = v;
    } else {
        // Fallback default volume to ensure it doesn't reset to 0
        document.getElementById('vol-range').value = "0.5";
        localStorage.setItem('judo_vol', "0.5");
    }
    
    const d = localStorage.getItem('judo_dur'); 
    if(d !== null) document.getElementById('sound-duration').value = d;
    const st = localStorage.getItem('judo_type'); 
    if(st !== null) document.getElementById('sound-type').value = st;
    
    const s = localStorage.getItem('judo_sync_v14'); 
    if(s) { try { state = JSON.parse(s); } catch(e) {} }
    
    render();
}

function sync() { 
    if (isPublicView) return; 
    lastWinner = state.winner; 
    localStorage.setItem('judo_sync_v14', JSON.stringify(state)); 
    render(); 
}

function openPublic() { 
    let cleanUrl = window.location.href.split('?')[0].split('#')[0]; 
    window.open(cleanUrl + '?view=public', 'JudoPublic', 'width=1000,height=800'); 
}

function initAudio() { 
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); 
        if (audioCtx.state === 'suspended') audioCtx.resume(); 
    } catch(e) {
        console.error("Erreur de contexte Audio :", e);
    }
}

function playSelectedSound() {
    if (isPublicView) return;
    initAudio();
    
    let volInput = document.getElementById('vol-range');
    let vol = volInput ? parseFloat(volInput.value) : 0.5;
    if (isNaN(vol)) vol = 0.5;
    
    if (vol <= 0) {
        alert("🔇 Le volume est à 0 ! Pensez à augmenter la jauge du son.");
        return;
    }
    
    let dur = parseFloat(document.getElementById('sound-duration').value);
    if (isNaN(dur) || dur <= 0) dur = 3;
    
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const type = document.getElementById('sound-type').value;
        
        if (type === 'buzzer') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(120, audioCtx.currentTime); }
        else if (type === 'alarm') { osc.type = 'square'; osc.frequency.setValueAtTime(800, audioCtx.currentTime); }
        else { osc.type = 'triangle'; osc.frequency.setValueAtTime(400, audioCtx.currentTime); }
        
        gain.gain.setValueAtTime(vol * 0.4, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + dur);
    } catch(e) {
        console.error("Erreur pendant la lecture du son :", e);
    }
}

function playHansokuBuzz() {
    if (isPublicView) return;
    initAudio();
    
    let volInput = document.getElementById('vol-range');
    let vol = volInput ? parseFloat(volInput.value) : 0.5;
    if (isNaN(vol) || vol <= 0) return;
    
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(80, audioCtx.currentTime); 
        
        gain.gain.setValueAtTime(vol * 0.5, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 2); 
        
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 2);
    } catch(e) {
        console.error("Erreur pendant la lecture du son :", e);
    }
}

function playShortBeep() {
    if (isPublicView) return;
    initAudio();
    
    let volInput = document.getElementById('vol-range');
    let vol = volInput ? parseFloat(volInput.value) : 0.5;
    if (isNaN(vol) || vol <= 0) return;
    
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        gain.gain.setValueAtTime(vol * 0.6, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    } catch(e) {
        console.error("Erreur pendant la lecture du son :", e);
    }
}

function saveSoundSettings() {
    localStorage.setItem('judo_vol', document.getElementById('vol-range').value);
    localStorage.setItem('judo_dur', document.getElementById('sound-duration').value);
    localStorage.setItem('judo_type', document.getElementById('sound-type').value);
}

function getTimeForCategory(pouleName) {
    if (!pouleName) return null;
    const n = pouleName.toLowerCase();
    if (n.includes('mini-poussins') || n.includes('m-poussins')) return 90;
    if (n.includes('poussins')) return 90;
    if (n.includes('benjamins')) return 120;
    if (n.includes('minimes')) return 180;
    if (n.includes('cadets')) return 180;
    if (n.includes('jun/sen') || n.includes('juniors') || n.includes('seniors')) return 240;
    return null; 
}

function autoSetTimeFromRadio(val) {
    let t = getTimeForCategory(val);
    if (t) {
        updateTimeSettings(t);
    }
}

function updateTimeSettings(s) { 
    if(document.activeElement) document.activeElement.blur();
    stopAll(); 
    state.default = s; 
    state.time = s; 
    state.osae.targetI = (s <= 90) ? 15 : 20; 
    document.querySelectorAll('.btn-config').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('btn-' + s); 
    if(btn) btn.classList.add('active');
    sync(); 
}

function toggleTimer() {
    if(document.activeElement) document.activeElement.blur();
    if(state.running) {
        stopAll(); 
    } else {
        if(state.time <= 0) return;
        state.running = true;
        clearInterval(timerInt); 
        timerInt = setInterval(() => { 
            if(state.time > 0) { state.time--; sync(); } 
            else { stopAll(); playSelectedSound(); checkWinner(); } 
        }, 1000);
        sync();
    }
}

function stopAll() { 
    clearInterval(timerInt); clearInterval(osaeInt); 
    state.running = false; 
    state.osae.active = 0; 
    state.osae.paused = false;
    sync(); 
}

function toggleOsaePause() {
    if(document.activeElement) document.activeElement.blur();
    if (state.osae.active !== 0) {
        state.osae.paused = !state.osae.paused;
        
        if (state.osae.paused) {
            clearInterval(timerInt);
            state.running = false;
        } else {
            if (!state.running) {
                state.running = true;
                clearInterval(timerInt);
                timerInt = setInterval(() => { 
                    if(state.time > 0) { state.time--; sync(); } 
                    else { stopAll(); playSelectedSound(); checkWinner(); } 
                }, 1000);
            }
        }
        sync();
    }
}

function startOsae(p) {
    if(document.activeElement) document.activeElement.blur();
    if(!state.running) toggleTimer();
    
    if (state.osae.active === p && state.osae.paused) {
        state.osae.paused = false;
    } else {
        state.osae.active = p; 
        state.osae.time = 0; 
        state.osae.paused = false;
    }

    clearInterval(osaeInt);
    osaeInt = setInterval(() => {
        if (!state.osae.paused) {
            state.osae.time++;
            
            let yukoTime = Math.round(state.osae.targetI / 3);
            let wazaTime = Math.round(state.osae.targetI / 2);
            
            if(state.osae.time === yukoTime) { 
                updateScore(state.osae.active, 'yuko', 1); 
                playShortBeep();
            }
            
            if(state.osae.time === wazaTime) { 
                updateScore(state.osae.active, 'yuko', -1); 
                updateScore(state.osae.active, 'waza', 1);  
                playShortBeep(); 
            }
            
            if(state.osae.time >= state.osae.targetI) { 
                updateScore(state.osae.active, 'waza', -1); 
                updateScore(state.osae.active, 'ippon', 1); 
                stopAll(); 
                playSelectedSound(); 
            }
            sync();
        }
    }, 1000);
    sync();
}

function toketa() { 
    if(document.activeElement) document.activeElement.blur();
    clearInterval(osaeInt); 
    state.osae.active = 0; 
    state.osae.time = 0; 
    state.osae.paused = false;
    sync(); 
}

function updateScore(p, t, v) {
    if(document.activeElement) document.activeElement.blur();
    
    let isDirectIppon = (t === 'ippon' && v > 0);
    state.scores[p][t] = Math.max(0, state.scores[p][t] + v);
    
    if(v > 0 && t === 'waza' && state.scores[p].waza >= 2) { 
        state.scores[p].waza = 0;   
        state.scores[p].ippon = 1;  
    }

    if (t === 'ippon' && state.scores[p].ippon === 0 && state.winner === (p === 1 ? state.p1 : state.p2)) {
        state.winner = null;
        state.showIpponAnim = false;
        clearTimeout(ipponTimeout);
    }
    
    if(state.scores[p].ippon >= 1 && (!state.winner || state.winner === (p === 1 ? state.p1 : state.p2))) { 
        
        if(isDirectIppon && !state.showIpponAnim && !state.winner) {
            stopAll();
            state.showIpponAnim = true;
            state.winner = (p === 1 ? state.p1 : state.p2);
            sync();
            
            clearTimeout(ipponTimeout);
            ipponTimeout = setTimeout(() => {
                if(state.showIpponAnim) { 
                    state.showIpponAnim = false;
                    sync();
                }
            }, 3500);
        } 
        else if (!state.showIpponAnim) {
            stopAll();
            state.winner = (p === 1 ? state.p1 : state.p2);
            sync();
        }
        return;
    }

    if(state.scores[p].ippon === 0 && state.showIpponAnim) {
        state.showIpponAnim = false;
        clearTimeout(ipponTimeout);
    }

    sync();
}

function updateShido(p, v) {
    if(document.activeElement) document.activeElement.blur();
    
    if(state.winner && state.winner !== (p === 1 ? state.p2 : state.p1) && v > 0) return; 
    
    let val = state.scores[p].shido + v;
    if(val < 0) val = 0;
    if(val > 3) val = 3;
    
    state.scores[p].shido = val;
    
    if(val === 3) {
        state.hansoku = p; 
        stopAll();
        if(v > 0) playHansokuBuzz(); 
        state.winner = (p === 1) ? state.p2 : state.p1; 
        sync();
    } else if (val < 3 && state.hansoku === p) {
        state.hansoku = 0;
        state.winner = null;
        sync();
    } else {
        sync();
    }
}

function checkWinner() {
    if(state.scores[1].ippon >= 1) state.winner = state.p1;
    else if(state.scores[2].ippon >= 1) state.winner = state.p2;
    else if(state.time === 0) {
        let s1 = state.scores[1], s2 = state.scores[2];
        if (s1.waza !== s2.waza) state.winner = s1.waza > s2.waza ? state.p1 : state.p2;
        else if (s1.yuko !== s2.yuko) state.winner = s1.yuko > s2.yuko ? state.p1 : state.p2;
    }
    sync();
}

function forceWinner(p) {
    if(document.activeElement) document.activeElement.blur();
    state.winner = (p === 1) ? state.p1 : state.p2;
    sync();
}

function loadMatch(i) {
    stopAll(); 
    if(i < 0 || i >= state.globalQueue.length) return;
    state.currentIdx = i;
    state.p1 = state.globalQueue[i].p1; 
    state.p2 = state.globalQueue[i].p2;
    state.scores = { 1: { ippon:0, waza:0, yuko:0, shido:0 }, 2: { ippon:0, waza:0, yuko:0, shido:0 } };
    
    let autoTime = getTimeForCategory(state.globalQueue[i].poule);
    if (autoTime) {
        state.default = autoTime;
        state.osae.targetI = (autoTime <= 90) ? 15 : 20;
    }
    state.time = state.default;
    state.osae.paused = false;
    
    document.querySelectorAll('.btn-config').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('btn-' + state.default); 
    if(btn) btn.classList.add('active');

    state.winner = null; 
    state.hansoku = 0;
    state.showIpponAnim = false;
    sync();
}

function archiveAndNext() {
    if(document.activeElement) document.activeElement.blur();
    if(state.currentIdx === -1) return;
    
    let s1 = state.scores[1], s2 = state.scores[2];
    let win1 = 0, win2 = 0;
    let pts1 = 0, pts2 = 0;

    if (state.winner === state.p1) {
        win1 = 1;
        if (s1.ippon >= 1 || s2.shido === 3) pts1 = 10; 
        else if (s1.waza > s2.waza) pts1 = 7;
        else if (s1.yuko > s2.yuko) pts1 = 5;
        else pts1 = 1; 
    } else if (state.winner === state.p2) {
        win2 = 1;
        if (s2.ippon >= 1 || s1.shido === 3) pts2 = 10; 
        else if (s2.waza > s1.waza) pts2 = 7;
        else if (s2.yuko > s1.yuko) pts2 = 5;
        else pts2 = 1; 
    }
    
    state.globalQueue[state.currentIdx].result = { 
        p1: {win: win1, pts: pts1, sc:{...s1}}, 
        p2: {win: win2, pts: pts2, sc:{...s2}}, 
        t: state.time 
    };
    state.globalQueue[state.currentIdx].done = true;
    
    let nextIdx = state.globalQueue.findIndex(m => !m.done);
    if(nextIdx !== -1) {
        loadMatch(nextIdx); 
    } else {
        stopAll();
        state.winner = null;
        state.currentIdx = -1;
        sync(); 
    }
}

function previousMatch() {
    if(document.activeElement) document.activeElement.blur();
    let last = state.globalQueue.findLastIndex(m => m.done);
    if (last !== -1) {
        let res = state.globalQueue[last].result;
        state.globalQueue[last].done = false;
        state.currentIdx = last;
        state.p1 = state.globalQueue[last].p1; 
        state.p2 = state.globalQueue[last].p2;
        state.scores = { 1: {...res.p1.sc}, 2: {...res.p2.sc} };
        state.time = res.t;
        state.winner = null;
        state.hansoku = 0;
        state.showIpponAnim = false;
        stopAll();
        
        document.querySelectorAll('.btn-config').forEach(b => b.classList.remove('active'));
        let currentBtn = document.getElementById('btn-' + state.default);
        if(currentBtn) currentBtn.classList.add('active');
    }
}

function addNewPoule() {
    const baseName = document.getElementById('poule-name-input').value.trim();
    const catRadio = document.querySelector('input[name="categorie-judo"]:checked');
    const categorie = catRadio ? catRadio.value : "";
    
    const pName = baseName === "" ? categorie : `${baseName} - ${categorie}`;
    
    const players = document.getElementById('poule-players-input').value.split(',').map(n => formatName(n)).filter(n => n !== "");
    if (players.length < 2) return;
    
    state.poulesData[pName] = players;
    let matches = [];
    
    let pList = [...players];
    if (pList.length % 2 !== 0) {
        pList.push("EXEMPT");
    }
    
    const numRounds = pList.length - 1;
    const half = pList.length / 2;

    for (let round = 0; round < numRounds; round++) {
        for (let i = 0; i < half; i++) {
            let p1 = pList[i];
            let p2 = pList[pList.length - 1 - i];
            
            if (p1 !== "EXEMPT" && p2 !== "EXEMPT") {
                matches.push({ p1: p1, p2: p2, poule: pName, done: false });
            }
        }
        pList.splice(1, 0, pList.pop());
    }
    
    let allPending = state.globalQueue.filter(m => !m.done).concat(matches);
    let done = state.globalQueue.filter(m => m.done);
    
    let interleaved = [];
    let byP = {}; 
    allPending.forEach(m => { 
        if(!byP[m.poule]) byP[m.poule] = []; 
        byP[m.poule].push(m); 
    });
    
    let pK = Object.keys(byP); 
    let max = Math.max(...pK.map(k => byP[k].length));
    
    for(let i=0; i<max; i++) {
        pK.forEach(k => { 
            if(byP[k][i]) interleaved.push(byP[k][i]); 
        });
    }
    
    state.globalQueue = done.concat(interleaved);
    if (state.currentIdx === -1) {
        loadMatch(0); 
    } else {
        sync();
    }
    
    document.getElementById('poule-name-input').value = ""; 
    document.getElementById('poule-players-input').value = "";
    localStorage.removeItem('judo_draft_poule');
    localStorage.removeItem('judo_draft_players');
}

function importCSV() {
    const fileInput = document.getElementById('csv-file');
    const file = fileInput.files[0];
    if (!file) { alert("Veuillez sélectionner un fichier CSV."); return; }

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        const lines = text.split('\n');
        let newMatches = [];
        let importedCount = 0;

        lines.forEach(line => {
            const parts = line.split(/[;,]/); 
            
            if (parts.length >= 4) { 
                const baseName = parts[0].trim();
                const categorie = parts[1].trim();
                
                let pName = baseName;
                if (categorie !== "") pName = baseName === "" ? categorie : `${baseName} - ${categorie}`;
                
                let players = parts.slice(2).map(n => formatName(n)).filter(n => n !== "");
                
                if (players.length >= 2) {
                    state.poulesData[pName] = players;
                    let pList = [...players];
                    
                    if (pList.length % 2 !== 0) pList.push("EXEMPT");
                    
                    const numRounds = pList.length - 1;
                    const half = pList.length / 2;

                    for (let round = 0; round < numRounds; round++) {
                        for (let i = 0; i < half; i++) {
                            let p1 = pList[i];
                            let p2 = pList[pList.length - 1 - i];
                            if (p1 !== "EXEMPT" && p2 !== "EXEMPT") {
                                newMatches.push({ p1: p1, p2: p2, poule: pName, done: false });
                            }
                        }
                        pList.splice(1, 0, pList.pop());
                    }
                    importedCount++;
                }
            }
        });

        if (importedCount > 0) {
            let allPending = state.globalQueue.filter(m => !m.done).concat(newMatches);
            let done = state.globalQueue.filter(m => m.done);
            
            let interleaved = [];
            let byP = {}; 
            allPending.forEach(m => { 
                if(!byP[m.poule]) byP[m.poule] = []; 
                byP[m.poule].push(m); 
            });
            
            let pK = Object.keys(byP); 
            let max = Math.max(...pK.map(k => byP[k].length));
            
            for(let i = 0; i < max; i++) {
                pK.forEach(k => { 
                    if(byP[k][i]) interleaved.push(byP[k][i]); 
                });
            }
            
            state.globalQueue = done.concat(interleaved);
            if (state.currentIdx === -1) loadMatch(0);
            else sync();
            
            alert(importedCount + " poule(s) importée(s) et mixée(s) avec succès !");
        } else {
            alert("Aucune poule valide trouvée. Vérifiez le format de votre CSV.");
        }
        fileInput.value = ""; 
    };
    reader.readAsText(file);
}

function exportState() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", "judo_sauvegarde_" + new Date().toISOString().slice(0,10) + ".json");
    dlAnchorElem.click();
}

function importState() {
    const fileInput = document.getElementById('json-file');
    const file = fileInput.files[0];
    if (!file) { alert("Veuillez sélectionner un fichier JSON."); return; }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importedState = JSON.parse(e.target.result);
            if (importedState && importedState.poulesData) {
                state = importedState;
                sync();
                alert("Sauvegarde restaurée avec succès !");
            } else {
                alert("Fichier non valide.");
            }
        } catch (error) {
            alert("Erreur lors de la lecture du fichier JSON.");
        }
        fileInput.value = ""; 
    };
    reader.readAsText(file);
}

function reorderQueue(fromIdx, toIdx) {
    let item = state.globalQueue.splice(fromIdx, 1)[0];
    state.globalQueue.splice(toIdx, 0, item);
    sync();
}

function lancerConfettisIppon() {
    const container = document.getElementById('ippon-confetti-container');
    if (!container) return;
    container.innerHTML = "";
    const colors = ['#BF953F', '#FCF6BA', '#B38728', '#FBF5B7', '#FFFFFF'];
    clearInterval(ipponConfettiInterval);
    ipponConfettiInterval = setInterval(() => {
        const conf = document.createElement('div');
        conf.className = 'confetti';
        conf.style.left = (Math.random() * 100) + 'vw';
        conf.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        let size = Math.random() * 12 + 6; 
        conf.style.width = `${size}px`;
        conf.style.height = `${size * 1.5}px`;
        conf.style.animationDuration = (Math.random() * 2 + 1) + 's';
        container.appendChild(conf);
        setTimeout(() => { if (conf.parentNode) conf.remove(); }, 3000);
    }, 40); 
}

function stopConfettisIppon() {
    clearInterval(ipponConfettiInterval);
    const container = document.getElementById('ippon-confetti-container');
    if (container) container.innerHTML = "";
}

function startCelebration() {
    if (!isPublicView) return; 
    const container = document.getElementById('confetti-container');
    if (!container) return;
    container.innerHTML = ""; 
    const colors = ['#fbc02d', '#00acc1', '#ff5252', '#4caf50', '#ffffff'];
    clearInterval(confettiInterval);
    confettiInterval = setInterval(() => {
        const confetti = document.createElement('div');
        confetti.classList.add('confetti');
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        const size = Math.random() * 10 + 5; 
        confetti.style.width = `${size}px`;
        confetti.style.height = `${size * 1.5}px`;
        confetti.style.animationDuration = (Math.random() * 3 + 2) + 's';
        container.appendChild(confetti);
        setTimeout(() => { if (confetti.parentNode) confetti.remove(); }, 5000);
    }, 50); 
}

function stopCelebration() {
    clearInterval(confettiInterval);
    const container = document.getElementById('confetti-container');
    if (container) container.innerHTML = "";
}

function render() {
    const fmt = s => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;
    
    if (state.showIpponAnim) {
        document.getElementById('timer').innerText = "IPPON !";
        document.getElementById('timer').style.color = "#00acc1";
        document.getElementById('public-timer-val').innerText = "IPPON !";
        document.getElementById('public-timer-val').style.color = "#00acc1";
    } else {
        document.getElementById('timer').innerText = fmt(state.time);
        document.getElementById('timer').style.color = "#ffff00";
        document.getElementById('public-timer-val').innerText = fmt(state.time);
        document.getElementById('public-timer-val').style.color = "#ffff00";
    }
    
    const buildNameHTML = (fullName, elemId) => {
        let displayName = fullName;

        if (isPublicView) {
            displayName = displayName.replace(/\b\[?HC\]?\b/ig, '');
            displayName = displayName.trim().replace(/\s+/g, ' ');
        }

        const match = displayName.match(/(.*?)\s*\((.*?)\)$/);
        const container = document.getElementById(elemId);
        
        if (match) {
            if (container) container.classList.add('has-club');
            return `<span class="fighter-name">${match[1]}</span><span class="fighter-club">${match[2]}</span>`;
        } else {
            if (container) container.classList.remove('has-club');
            return `<span class="fighter-name">${displayName}</span>`;
        }
    };

    document.getElementById('p1-name').innerHTML = buildNameHTML(state.p1, 'p1-name'); 
    document.getElementById('p2-name').innerHTML = buildNameHTML(state.p2, 'p2-name');

    const cur = state.globalQueue[state.currentIdx];
    let displayPoule = cur ? cur.poule : "";
    if (isPublicView && displayPoule) {
        displayPoule = displayPoule.replace(" - ", "<br><span style='color: white; font-size: 0.8em;'>");
        displayPoule += "</span>";
        document.getElementById('public-poule-name').innerHTML = displayPoule;
    } else {
        document.getElementById('public-poule-name').innerText = displayPoule;
    }

    for (let p = 1; p <= 2; p++) {
        document.getElementById(`p${p}-ippon`).innerText = state.scores[p].ippon;
        document.getElementById(`p${p}-waza`).innerText = state.scores[p].waza;
        document.getElementById(`p${p}-yuko`).innerText = state.scores[p].yuko;
        document.getElementById(`p${p}-shido-val`).innerText = state.scores[p].shido;

        let sDiv = document.getElementById(`p${p}-shidos`);
        if (sDiv) {
            sDiv.innerHTML = "";
            for(let s = 0; s < state.scores[p].shido; s++) {
                let card = document.createElement('div');
                card.className = 'shido-card';
                sDiv.appendChild(card);
            }
        }

        let opponent = (p === 1) ? 2 : 1;
        let isVictim = (state.osae.active === opponent); 
        
        let osaeCont = document.getElementById(`osae-cont-${p}`);
        if (osaeCont) {
            osaeCont.style.display = isVictim ? "flex" : "none";
        }
        
        let osaeBar = document.getElementById(`osae-bar-${p}`);
        let osaeTxt = document.getElementById(`osae-txt-${p}`);
        if (isVictim) {
            if (osaeBar) osaeBar.style.width = (state.osae.time / state.osae.targetI * 100) + "%";
            if (osaeTxt) osaeTxt.innerText = state.osae.time + "s";
        }

        if (!isPublicView) {
            let btnStart = document.getElementById(`btn-osae-start-${p}`);
            let btnPause = document.getElementById(`btn-osae-pause-${p}`);
            let btnToketa = document.getElementById(`btn-osae-toketa-${p}`);
            
            if (btnStart && btnPause && btnToketa) {
                if (state.osae.active === p) {
                    btnStart.style.display = 'none';
                    btnPause.style.display = 'block';
                    btnPause.innerText = state.osae.paused ? '▶ Yoshi' : '⏸ Sono-mama';
                    btnPause.style.background = state.osae.paused ? '#4caf50' : '#ff9800';
                    btnToketa.style.display = 'block';
                } else if (state.osae.active === opponent) {
                    btnStart.style.display = 'none';
                    btnPause.style.display = 'none';
                    btnToketa.style.display = 'none';
                } else {
                    btnStart.style.display = 'block';
                    btnPause.style.display = 'none';
                    btnToketa.style.display = 'none';
                }
            }
        }
    }

    const q = document.getElementById('match-queue'); q.innerHTML = "";
    state.globalQueue.forEach((m, i) => { 
        if(!m.done) {
            let d = document.createElement('div'); 
            d.className = `item ${i === state.currentIdx ? 'active-match' : ''}`;
            d.innerHTML = `<span class="poule-tag">${m.poule}</span> ${m.p1} vs ${m.p2}`;
            
            if (!isPublicView && i !== state.currentIdx) {
                d.draggable = true;
                d.dataset.index = i;
                d.ondragstart = (e) => e.dataTransfer.setData('text/plain', i);
                d.ondragover = (e) => e.preventDefault();
                d.ondrop = (e) => {
                    e.preventDefault();
                    let fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
                    let toIdx = parseInt(e.currentTarget.dataset.index);
                    if (!isNaN(fromIdx) && !isNaN(toIdx) && fromIdx !== toIdx) {
                        reorderQueue(fromIdx, toIdx);
                    }
                };
            }

            d.onclick = () => { if(!isPublicView) loadMatch(i); }; 
            q.appendChild(d);
        }
    });

    const ipponOverlay = document.getElementById('ippon-overlay');
    if(ipponOverlay) {
        const showIppon = !!(isPublicView && state.showIpponAnim);
        if (showIppon) {
            ipponOverlay.style.display = 'flex'; 
            const textAnim = document.getElementById('ippon-text-anim');
            if (textAnim && !textAnim.classList.contains('run-anim')) {
                textAnim.classList.remove('run-anim');
                void textAnim.offsetWidth; 
                textAnim.classList.add('run-anim');
                lancerConfettisIppon(); 
            }
        } else {
            ipponOverlay.style.display = 'none'; 
            const textAnim = document.getElementById('ippon-text-anim');
            if (textAnim) textAnim.classList.remove('run-anim');
            stopConfettisIppon(); 
        }
    }

    const overlay = document.getElementById('winner-overlay');
    const showWinner = !!(isPublicView && state.winner && state.hansoku === 0 && !state.showIpponAnim);
    
    if (showWinner && !overlay.classList.contains('visible')) {
        startCelebration();
    } else if (!showWinner) {
        stopCelebration();
    }
    
    overlay.classList.toggle('visible', showWinner);
    if(state.winner) {
        let cleanWinName = state.winner.replace(/\b\[?HC\]?\b/ig, '').trim();
        document.getElementById('win-name').innerText = cleanWinName;
    }

    const hansokuOverlay = document.getElementById('hansoku-overlay');
    hansokuOverlay.classList.toggle('visible', !!(isPublicView && state.hansoku));
    if(state.hansoku) {
        let hName = (state.hansoku === 1) ? state.p1 : state.p2;
        document.getElementById('hansoku-name').innerText = hName.replace(/\b\[?HC\]?\b/ig, '').trim();
    }

    const banner = document.getElementById('public-next-match-banner');
    let next = state.globalQueue.findIndex((m, idx) => !m.done && idx !== state.currentIdx);
    let started = (state.time < state.default || state.scores[1].ippon+state.scores[1].waza+state.scores[1].yuko+state.scores[2].ippon+state.scores[2].waza+state.scores[2].yuko > 0);

    if (banner) {
        banner.classList.toggle('hidden', state.running || state.winner || state.showIpponAnim || state.hansoku || next === -1 || started);
        if (next !== -1) {
            let nextP1 = state.globalQueue[next].p1.replace(/\b\[?HC\]?\b/ig, '').trim();
            let nextP2 = state.globalQueue[next].p2.replace(/\b\[?HC\]?\b/ig, '').trim();
            banner.innerText = `À SUIVRE : ${nextP1} VS ${nextP2}`;
        }
    }
    
    let isTie = (state.time === 0 && !state.winner && !state.hansoku && state.currentIdx !== -1);
    
    const hanteiDiv = document.getElementById('hantei-controls');
    if (hanteiDiv) {
        hanteiDiv.style.display = isTie ? "block" : "none";
    }
    
    const hanteiPublicOverlay = document.getElementById('hantei-public-overlay');
    if (hanteiPublicOverlay) {
        hanteiPublicOverlay.classList.toggle('visible', !!(isPublicView && isTie && !state.showIpponAnim));
    }

    const standbyOverlay = document.getElementById('standby-overlay');
    if (standbyOverlay) {
        let isStandby = state.globalQueue.length === 0 || state.currentIdx === -1 || state.globalQueue.every(m => m.done);
        standbyOverlay.classList.toggle('visible', !!(isPublicView && isStandby && !showWinner && !state.showIpponAnim && !state.hansoku && !isTie));
    }
    
    renderRankings();
}

function renderRankings() {
    const container = document.getElementById('rankings-container'); container.innerHTML = "";
    Object.keys(state.poulesData).forEach(p => {
        let stats = {}; 
        state.poulesData[p].forEach(n => stats[n] = {w:0, p:0, isHC: /\b\[?HC\]?\b/i.test(n)});
        
        state.globalQueue.filter(m => m.poule === p && m.done).forEach(m => {
            stats[m.p1].w += m.result.p1.win; stats[m.p1].p += m.result.p1.pts;
            stats[m.p2].w += m.result.p2.win; stats[m.p2].p += m.result.p2.pts;
        });
        
        let normalPlayers = Object.keys(stats).filter(n => !stats[n].isHC).map(n => ({n, ...stats[n]})).sort((a,b) => b.w - a.w || b.p - a.p);
        let hcPlayers = Object.keys(stats).filter(n => stats[n].isHC).map(n => ({n, ...stats[n]})).sort((a,b) => b.w - a.w || b.p - a.p);

        let h = `<div class="poule-title">${p}</div><table class="ranking-table"><tr><th>Nom</th><th>V</th><th>Pts</th></tr>`;
        
        normalPlayers.forEach(s => {
            let cleanName = s.n.replace(/\b\[?HC\]?\b/ig, '').replace(/\s+/g, ' ').trim();
            h += `<tr><td>${cleanName}</td><td>${s.w}</td><td>${s.p}</td></tr>`;
        });
        
        if (hcPlayers.length > 0) {
            h += `<tr><td colspan="3" style="text-align:center; background:#444; color:var(--yuko); font-style:italic; font-size:0.7rem; padding:3px;">HORS CATÉGORIE</td></tr>`;
            hcPlayers.forEach(s => {
                let cleanName = s.n.replace(/\b\[?HC\]?\b/ig, '').replace(/\s+/g, ' ').trim();
                h += `<tr style="color:#aaa;"><td>${cleanName}</td><td>${s.w}</td><td>${s.p}</td></tr>`;
            });
        }
        
        container.innerHTML += h + `</table>`;
    });
}

function exportResults() {
    if (Object.keys(state.poulesData).length === 0) { alert("Aucune donnée à exporter."); return; }
    
    let htmlContent = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <title>Résultats du Tournoi - Judo Pro</title>
        <style>
            body { font-family: 'Segoe UI', sans-serif; background-color: #f4f4f9; color: #212121; padding: 20px; }
            h1 { text-align: center; color: #121212; text-transform: uppercase; font-weight: 900; margin-bottom: 30px; }
            
            .poule-section { background: #ffffff; border-radius: 8px; padding: 20px; margin-bottom: 30px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); border-top: 5px solid #00acc1; page-break-inside: avoid; }
            .poule-title { color: #d32f2f; font-size: 1.5rem; font-weight: bold; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 15px; text-transform: uppercase; }
            
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            th, td { padding: 12px 15px; text-align: center; border-bottom: 1px solid #ddd; }
            th { background-color: #1e1e1e; color: #00acc1; text-transform: uppercase; font-size: 0.9rem; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            tr:nth-child(even) { background-color: #f9f9f9; }
            tr:hover { background-color: #f1f1f1; }
            .rank { font-weight: 900; color: #d32f2f; font-size: 1.2rem; }
            .name-col { text-align: left; font-weight: bold; font-size: 1.1rem; }
            .hc-row { background-color: #fafafa; color: #777; font-style: italic; }
            
            .print-btn { background-color: #2e7d32; color: white; border: none; padding: 15px 30px; font-size: 1.2rem; font-weight: bold; border-radius: 5px; cursor: pointer; text-transform: uppercase; box-shadow: 0 4px 6px rgba(0,0,0,0.2); transition: background 0.3s; margin-bottom: 20px;}
            .print-btn:hover { background-color: #1b5e20; }
            .header-actions { text-align: center; margin-bottom: 10px; }

            @media print {
                body { background-color: #fff; padding: 0; }
                .no-print { display: none !important; } 
                .poule-section { box-shadow: none; border: 1px solid #ccc; border-top: 3px solid #000; margin-bottom: 20px; }
                th { background-color: #eee; color: #000; }
                h1 { margin-top: 0; font-size: 1.5rem; }
            }
        </style>
    </head>
    <body>
        <div class="header-actions no-print">
            <button class="print-btn" onclick="window.print()">🖨️ Imprimer les résultats</button>
        </div>
        <h1>🏆 Classement Final du Tournoi 🏆</h1>
    `;

    Object.keys(state.poulesData).forEach(pName => {
        let stats = {};
        state.poulesData[pName].forEach(name => stats[name] = { wins: 0, pts: 0, shidos: 0, isHC: /\b\[?HC\]?\b/i.test(name) });
        
        state.globalQueue.filter(m => m.poule === pName && m.done && m.result).forEach(m => {
            if (stats[m.p1]) {
                stats[m.p1].wins += m.result.p1.win;
                stats[m.p1].pts += m.result.p1.pts;
                stats[m.p1].shidos += m.result.p1.sc.shido || 0;
            }
            if (stats[m.p2]) {
                stats[m.p2].wins += m.result.p2.win;
                stats[m.p2].pts += m.result.p2.pts;
                stats[m.p2].shidos += m.result.p2.sc.shido || 0;
            }
        });
        
        let normalPlayers = Object.keys(stats).filter(name => !stats[name].isHC).map(name => ({ name, ...stats[name] })).sort((a, b) => b.wins - a.wins || b.pts - a.pts);
        let hcPlayers = Object.keys(stats).filter(name => stats[name].isHC).map(name => ({ name, ...stats[name] })).sort((a, b) => b.wins - a.wins || b.pts - a.pts);
        
        htmlContent += `
        <div class="poule-section">
            <div class="poule-title">POULE : ${pName}</div>
            <table>
                <thead>
                    <tr>
                        <th style="width: 10%;">Position</th>
                        <th class="name-col">Nom du Combattant</th>
                        <th>Victoires</th>
                        <th>Points</th>
                        <th>Shidos Reçus</th>
                    </tr>
                </thead>
                <tbody>
        `;

        normalPlayers.forEach((p, idx) => { 
            let cleanName = p.name.replace(/\b\[?HC\]?\b/ig, '').replace(/\s+/g, ' ').trim();
            htmlContent += `
                    <tr>
                        <td class="rank">${idx + 1}</td>
                        <td class="name-col">${cleanName}</td>
                        <td><strong>${p.wins}</strong></td>
                        <td>${p.pts}</td>
                        <td>${p.shidos}</td>
                    </tr>
            `; 
        });

        hcPlayers.forEach((p) => { 
            let cleanName = p.name.replace(/\b\[?HC\]?\b/ig, '').replace(/\s+/g, ' ').trim();
            htmlContent += `
                    <tr class="hc-row">
                        <td class="rank" style="color: #999;">HC</td>
                        <td class="name-col">${cleanName}</td>
                        <td><strong>${p.wins}</strong></td>
                        <td>${p.pts}</td>
                        <td>${p.shidos}</td>
                    </tr>
            `; 
        });

        htmlContent += `
                </tbody>
            </table>
        </div>
        `;
    });
    
    htmlContent += `
    </body>
    </html>
    `;
    
    const newWindow = window.open("", "_blank");
    newWindow.document.write(htmlContent);
    newWindow.document.close();
}

function resetAll() { if(confirm("RESET TOTAL ?")) { localStorage.clear(); location.reload(); } }

function togglePhaseFinale() {
    const modal = document.getElementById('phase-finale-modal');
    if (modal.style.display === 'none' || modal.style.display === '') {
        modal.style.display = 'flex';
    } else {
        modal.style.display = 'none';
    }
}