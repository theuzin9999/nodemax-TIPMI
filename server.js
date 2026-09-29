// =========================================================================
// BRIDGE SERVIDOR -> FIREBASE (roda 24/7 no Railway)
// Fonte configurável pela variável de ambiente SOURCE:
//   SOURCE=rest  (padrão)  -> Tipminer (polling a cada 3s)
//   SOURCE=wss             -> aviatorspy (Socket.IO)
// Requer Node.js 18+ (fetch nativo).
// =========================================================================
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, push, onValue } = require('firebase/database');

const SOURCE = (process.env.SOURCE || 'rest').toLowerCase();
const INTERVALO_CONSULTA = parseInt(process.env.POLL_MS || '3000', 10);

// -------------------------------------------------------------------------
// FIREBASE
// -------------------------------------------------------------------------
const firebaseConfig = {
    apiKey: "AIzaSyCf5bcTMw5O3OZFCwKmuRrMoAg3A5o5erg",
    authDomain: "aviatormax-ac28e.firebaseapp.com",
    databaseURL: "https://aviatormax-ac28e-default-rtdb.firebaseio.com",
    projectId: "aviatormax-ac28e",
    storageBucket: "aviatormax-ac28e.firebasestorage.app",
    messagingSenderId: "803925677451",
    appId: "1:803925677451:web:92a8e97799adcf63ea0b8e",
    measurementId: "G-91BL357JVK"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const historyRef = ref(db, 'history/');

// -------------------------------------------------------------------------
// FONTES
// -------------------------------------------------------------------------
const API_URL = 'https://api.core.public.tipminer.com/v1/crash/rounds/48323e32-3590-4e2f-b6fe-09d5fbc811c9/history?limit=5&timezone=America%2FSao_Paulo';
const SOCKET_URL = 'https://ws.aviatorspy.com';

// -------------------------------------------------------------------------
// UTILITÁRIOS
// -------------------------------------------------------------------------
function getCurrentTimeBrasilia() {
    return new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).format(new Date());
}

function getCurrentDateBrasilia() {
    const parts = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const get = (t) => parts.find(p => p.type === t).value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

function getColorName(multiplier) {
    if (multiplier >= 10) return 'rosa';
    if (multiplier >= 2) return 'roxo';
    return 'azul';
}

function log(message) {
    console.log(`[${getCurrentTimeBrasilia()}] ${message}`);
}

// Loga o mesmo erro no máximo 1x a cada 60s (evita inundar o log)
const ultimoLogErro = {};
function logErro(chave, message) {
    const agora = Date.now();
    if (!ultimoLogErro[chave] || agora - ultimoLogErro[chave] > 60000) {
        ultimoLogErro[chave] = agora;
        log(message);
    }
}

// Estatísticas para o heartbeat
const stats = { salvas: 0, errosEscrita: 0, ultimaSalva: null };

function salvarVela(multiplier) {
    if (isNaN(multiplier) || multiplier < 1.00) return;

    const newEntry = {
        value: parseFloat(multiplier.toFixed(2)),
        time: getCurrentTimeBrasilia(),
        date: getCurrentDateBrasilia(),
        color: getColorName(multiplier)
    };

    // Se o Firebase não responder em 10s, avisa (não fica mudo)
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout de 10s sem resposta do Firebase')), 10000));

    Promise.race([push(historyRef, newEntry), timeout])
        .then(() => {
            stats.salvas++;
            stats.ultimaSalva = getCurrentTimeBrasilia();
            log(`✅ Vela ${newEntry.value.toFixed(2)}x (${newEntry.color}) salva.`);
        })
        .catch((error) => {
            stats.errosEscrita++;
            log(`❌ ERRO de ESCRITA no Firebase: ${error.message}`);
        });
}

// -------------------------------------------------------------------------
// MONITOR DO FIREBASE (diagnóstico de conexão)
// -------------------------------------------------------------------------
onValue(ref(db, '.info/connected'), (snap) => {
    log(snap.val() === true
        ? '🔥 Firebase CONECTADO.'
        : '⚠️ Firebase DESCONECTADO (aguardando reconexão).');
});

// -------------------------------------------------------------------------
// FONTE REST (Tipminer)
// -------------------------------------------------------------------------
const idsVistos = new Set();
let primeiraLeitura = true;
let falhasSeguidas = 0;

async function monitorarApi() {
    try {
        const response = await fetch(`${API_URL}&_t=${Date.now()}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
                'Accept': 'application/json'
            },
            signal: AbortSignal.timeout(8000)
        });

        if (!response.ok) {
            const corpo = (await response.text()).slice(0, 120).replace(/\s+/g, ' ');
            throw new Error(`HTTP ${response.status} | ${corpo}`);
        }

        const dados = await response.json();
        const rounds = Array.isArray(dados) ? dados : (dados.data || []);
        falhasSeguidas = 0;

        if (rounds.length === 0) {
            logErro('vazio', '⚠️ API respondeu OK, mas sem rodadas.');
            return;
        }

        if (primeiraLeitura) {
            rounds.forEach(r => idsVistos.add(r.uuid));
            primeiraLeitura = false;
            log(`🔄 Sincronizado. Última vela lida: ${parseFloat(rounds[0].result).toFixed(2)}x. Aguardando a próxima rodada...`);
            return;
        }

        // Rodadas novas, da mais antiga para a mais recente (não perde velas)
        const novas = rounds.filter(r => !idsVistos.has(r.uuid)).reverse();
        novas.forEach(r => {
            idsVistos.add(r.uuid);
            salvarVela(parseFloat(r.result));
        });

        // Evita o Set crescer para sempre
        if (idsVistos.size > 500) {
            const manter = Array.from(idsVistos).slice(-100);
            idsVistos.clear();
            manter.forEach(id => idsVistos.add(id));
        }
    } catch (error) {
        falhasSeguidas++;
        logErro('api', `⚠️ Erro na consulta à API: ${error.message}`);
        if (falhasSeguidas === 5 && /HTTP (403|429)/.test(error.message)) {
            log('🚫 A API está bloqueando este servidor (provável bloqueio de IP de datacenter/fora do Brasil). Teste SOURCE=wss ou use um proxy/VPS brasileiro.');
        }
    }
}

function iniciarRest() {
    log(`📡 Fonte: REST Tipminer (a cada ${INTERVALO_CONSULTA}ms).`);
    monitorarApi();
    setInterval(monitorarApi, INTERVALO_CONSULTA);
}

// -------------------------------------------------------------------------
// FONTE WSS (aviatorspy)
// -------------------------------------------------------------------------
function iniciarWss() {
    const { io } = require('socket.io-client');
    log('📡 Fonte: WSS aviatorspy.');

    const socket = io(SOCKET_URL, {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
    });

    socket.on('connect', () => log('CONECTADO e monitorando WSS.'));
    socket.on('disconnect', (reason) => log(`DESCONECTADO (motivo: ${reason}). Tentando reconectar...`));
    socket.on('connect_error', (err) => logErro('wss', `ERRO de conexão WSS: ${err.message}`));

    socket.on('new-payout', (data) => {
        if (!data || !data.valor) {
            log(`Formato WSS inesperado: ${JSON.stringify(data)}`);
            return;
        }
        salvarVela(parseFloat(String(data.valor).replace('x', '').replace(',', '.')));
    });
}

// -------------------------------------------------------------------------
// INÍCIO
// -------------------------------------------------------------------------
log(`🚀 Iniciando Bridge (Node ${process.version}, fonte=${SOURCE})...`);

if (typeof fetch !== 'function' && SOURCE === 'rest') {
    log('❌ Esta versão do Node não tem fetch. Use Node 18+ (campo "engines" no package.json).');
    process.exit(1);
}

if (SOURCE === 'wss') iniciarWss();
else iniciarRest();

// Heartbeat a cada 60s: prova que o processo está vivo e mostra o resultado
setInterval(() => {
    log(`💓 Vivo | salvas: ${stats.salvas} | erros de escrita: ${stats.errosEscrita} | última salva: ${stats.ultimaSalva || 'nenhuma ainda'}`);
}, 60000);

process.on('unhandledRejection', (err) => log(`⚠️ unhandledRejection: ${err && err.message ? err.message : err}`));
process.on('uncaughtException', (err) => log(`⚠️ uncaughtException: ${err.message}`));

// Railway envia SIGTERM ao redeployar
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => {
    log(`🛑 Encerrando bridge (${sig})...`);
    process.exit(0);
}));
