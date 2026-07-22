// =========================================================================
// BRIDGE SERVIDOR: WSS -> FIREBASE (roda 24/7, sem depender de navegador)
// =========================================================================
const { io } = require('socket.io-client');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, push } = require('firebase/database');

// -------------------------------------------------------------------------
// CONFIGURAÇÕES FIREBASE (mesmas do seu HTML)
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

const SOCKET_URL = 'https://ws.aviatorspy.com';

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const historyRef = ref(db, 'history/');

// Função para pegar a hora de Brasília
function getCurrentTimeBrasilia() {
    const now = new Date();
    // Cria um formatador de data/hora para o fuso de São Paulo (Brasília)
    const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    // Retorna apenas a parte da hora (HH:MM:SS)
    return formatter.format(now);
}

// Função para pegar a data de Brasília
function getCurrentDateBrasilia() {
     const now = new Date();
     // Cria um formatador de data/hora para o fuso de São Paulo (Brasília)
     const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
     });

     // Formata no padrão YYYY-MM-DD
     const parts = formatter.formatToParts(now);
     const year = parts.find(p => p.type === 'year').value;
     const month = parts.find(p => p.type === 'month').value;
     const day = parts.find(p => p.type === 'day').value;
     
     return `${year}-${month}-${day}`;
}

function getColorName(multiplier) {
    if (multiplier >= 10) return 'rosa';
    if (multiplier >= 2) return 'roxo';
    return 'azul';
}

function log(message) {
    console.log(`[${getCurrentTimeBrasilia()}] ${message}`);
}

// -------------------------------------------------------------------------
// CONEXÃO SOCKET.IO
// -------------------------------------------------------------------------
const socket = io(SOCKET_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
});

socket.on('connect', () => {
    log('CONECTADO e monitorando WSS.');
});

socket.on('disconnect', (reason) => {
    log(`DESCONECTADO (motivo: ${reason}). Tentando reconectar...`);
});

socket.on('connect_error', (err) => {
    log(`ERRO de conexão: ${err.message}`);
});

socket.on('new-payout', (data) => {
    let multiplier;

    try {
        if (data && data.valor) {
            multiplier = parseFloat(data.valor.replace('x', ''));
        }
    } catch (e) {
        log(`ERRO: Formato de dado WSS inválido. Dados: ${JSON.stringify(data)}`);
        return;
    }

    if (!isNaN(multiplier) && multiplier >= 1.00) {
        // Usa as novas funções para pegar a data e hora de Brasília
        const newEntry = {
            value: parseFloat(multiplier.toFixed(2)),
            time: getCurrentTimeBrasilia(),
            date: getCurrentDateBrasilia(),
            color: getColorName(multiplier)
        };

        push(historyRef, newEntry)
            .then(() => {
                log(`Vela ${newEntry.value.toFixed(2)}x (${newEntry.color}) salva.`);
            })
            .catch((error) => {
                log(`ERRO de ESCRITA no Firebase: ${error.message}`);
            });
    }
});

// Mantém o processo vivo e loga sinais de encerramento (útil em pm2/systemd)
process.on('SIGINT', () => {
    log('Encerrando bridge...');
    process.exit(0);
});