// =========================================================================
// BRIDGE SERVIDOR: API REST -> FIREBASE (roda 24/7)
// =========================================================================
// NOTA: Para rodar este script, certifique-se de estar usando Node.js v18 ou superior 
// (pois utiliza a função nativa 'fetch').
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, push } = require('firebase/database');

// -------------------------------------------------------------------------
// CONFIGURAÇÕES FIREBASE
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

// -------------------------------------------------------------------------
// CONFIGURAÇÕES API TIPMINER
// -------------------------------------------------------------------------
const API_URL = 'https://api.core.public.tipminer.com/v1/crash/rounds/48323e32-3590-4e2f-b6fe-09d5fbc811c9/history?limit=5&timezone=America%2FSao_Paulo';
const INTERVALO_CONSULTA = 3000; // Consulta a cada 3 segundos

let ultimaVelaProcessadaId = null;

// Inicialização Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const historyRef = ref(db, 'history/');

// -------------------------------------------------------------------------
// FUNÇÕES AUXILIARES
// -------------------------------------------------------------------------
// Função para pegar a hora de Brasília
function getCurrentTimeBrasilia() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    return formatter.format(now);
}

// Função para pegar a data de Brasília
function getCurrentDateBrasilia() {
     const now = new Date();
     const formatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
     });

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
// LÓGICA PRINCIPAL (POLLING)
// -------------------------------------------------------------------------
async function monitorarApi() {
    try {
        // Usa o timestamp no final para garantir que dados novos venham
        const urlComCacheBuster = `${API_URL}&_t=${Date.now()}`;
        
        // No Node.js não há restrição de CORS, a chamada é direta e nativa
        const response = await fetch(urlComCacheBuster, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Status HTTP Inesperado: ${response.status}`);
        }

        const dados = await response.json();
        
        // O JSON que você mandou tem formato de Array puro
        const rounds = Array.isArray(dados) ? dados : (dados.data || []);

        if (rounds && rounds.length > 0) {
            const velaMaisRecente = rounds[0];
            const roundId = velaMaisRecente.uuid;

            // Só processa se o ID for diferente do último salvo
            if (roundId !== ultimaVelaProcessadaId) {
                // Previne salvar lixo inicial ao reiniciar o servidor
                const isFirstRun = (ultimaVelaProcessadaId === null);
                
                ultimaVelaProcessadaId = roundId;
                
                const multiplier = parseFloat(velaMaisRecente.result);

                if (!isNaN(multiplier) && multiplier >= 1.00) {
                    const newEntry = {
                        value: parseFloat(multiplier.toFixed(2)),
                        time: getCurrentTimeBrasilia(),
                        date: getCurrentDateBrasilia(),
                        color: getColorName(multiplier)
                    };

                    if (!isFirstRun) {
                        push(historyRef, newEntry)
                            .then(() => {
                                log(`✅ Vela ${newEntry.value.toFixed(2)}x (${newEntry.color}) salva no banco.`);
                            })
                            .catch((error) => {
                                log(`❌ ERRO de ESCRITA no Firebase: ${error.message}`);
                            });
                    } else {
                        log(`🔄 Sincronizado. Última vela lida: ${newEntry.value.toFixed(2)}x. Aguardando a próxima rodada...`);
                    }
                }
            }
        }
    } catch (error) {
        log(`⚠️ Erro na consulta à API: ${error.message}`);
    }
}

log('🚀 Iniciando Bridge Node.js 24/7 (API Tipminer -> Firebase)...');
log('📡 Conectando ao Banco de Dados...');

// Executa a primeira vez de imediato
monitorarApi();

// Define o intervalo para repetir a consulta a cada 3 segundos
setInterval(monitorarApi, INTERVALO_CONSULTA);

// Mantém o processo vivo e loga sinais de encerramento (útil no PM2)
process.on('SIGINT', () => {
    log('🛑 Encerrando bridge...');
    process.exit(0);
});