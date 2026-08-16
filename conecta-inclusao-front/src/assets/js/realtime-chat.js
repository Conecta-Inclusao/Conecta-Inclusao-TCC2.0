// Cliente de chat em tempo real, compartilhado pelo painel do paciente e do medico.
//
// O servidor exige JWT no handshake e resolve a sala a partir do vinculo real
// entre as duas partes: o cliente informa com QUEM quer falar (profileId), nunca
// em qual sala quer entrar.
//
// Depende de socket.io-client, servido pelo proprio backend em
// <API_BASE_URL>/socket.io/socket.io.js (ver o <script> nas paginas), o que
// mantem cliente e servidor sempre na mesma versao.

const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const MESSAGES_URL = `${API_BASE_URL}/messages`;

function getToken() {
    return localStorage.getItem('token');
}

async function requestJSON(url, options = {}) {
    const token = getToken();

    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    });

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    return { ok: response.ok, status: response.status, data };
}

/** Contatos com quem o usuario logado pode conversar (vinculo por atendimento). */
export async function fetchContacts() {
    const result = await requestJSON(`${MESSAGES_URL}/contacts`);
    return result.ok && Array.isArray(result.data) ? result.data : [];
}

/** Historico persistido da conversa com um perfil. */
export async function fetchConversation(targetProfileId) {
    const result = await requestJSON(`${MESSAGES_URL}/thread/${targetProfileId}`);
    return result.ok ? result.data : null;
}

/** Fallback REST para enviar mensagem quando o socket estiver indisponivel. */
export async function sendMessageViaRest(targetProfileId, content) {
    return requestJSON(`${MESSAGES_URL}/thread/${targetProfileId}`, {
        method: 'POST',
        body: JSON.stringify({ content })
    });
}

/**
 * Cria o cliente de tempo real.
 *
 * @param {object} handlers
 * @param {(message: object) => void} handlers.onMessage       nova mensagem na conversa aberta
 * @param {(notice: object) => void}  handlers.onNotification  mensagem em outra conversa
 * @param {(state: string) => void}   handlers.onStatus        'conectado' | 'desconectado' | 'erro'
 */
/**
 * O socket.io-client e carregado em paralelo com o modulo do dashboard, entao
 * `window.io` pode ainda nao existir quando o chat inicializa. Em vez de
 * desistir na hora, esperamos ele aparecer por um tempo limitado.
 */
function aguardarSocketIO(timeoutMs = 20000) {
    if (typeof window.io === 'function') return Promise.resolve(true);

    return new Promise((resolve) => {
        const inicio = Date.now();
        const intervalo = setInterval(() => {
            if (typeof window.io === 'function') {
                clearInterval(intervalo);
                resolve(true);
            } else if (Date.now() - inicio > timeoutMs) {
                clearInterval(intervalo);
                resolve(false);
            }
        }, 200);
    });
}

export function createChatClient({ onMessage, onNotification, onStatus } = {}) {
    let socket = null;
    let currentTargetProfileId = null;

    function notifyStatus(state, detail) {
        if (typeof onStatus === 'function') onStatus(state, detail);
    }

    async function connect() {
        const token = getToken();

        if (!token) {
            notifyStatus('erro', 'Sessao expirada. Faca login novamente.');
            return null;
        }

        if (socket) return socket;

        const disponivel = await aguardarSocketIO();
        if (!disponivel) {
            notifyStatus('erro', 'Tempo real indisponivel; usando envio por requisicao.');
            return null;
        }

        // Outra chamada pode ter criado o socket enquanto esperavamos.
        if (socket) return socket;

        socket = window.io(API_BASE_URL, {
            // O token vai no handshake: sem ele o servidor recusa a conexao.
            auth: { token },
            transports: ['websocket', 'polling'],
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });

        socket.on('connect', () => {
            notifyStatus('conectado');
            // Reentra na conversa ativa apos uma reconexao.
            if (currentTargetProfileId) {
                socket.emit('joinConversation', { targetProfileId: currentTargetProfileId });
            }
        });

        socket.on('connect_error', (error) => {
            notifyStatus('erro', error?.message || 'Nao foi possivel conectar ao chat.');
        });

        socket.on('disconnect', () => notifyStatus('desconectado'));

        socket.on('conversationMessage', (message) => {
            if (typeof onMessage === 'function') onMessage(message);
        });

        socket.on('conversationNotification', (notice) => {
            if (typeof onNotification === 'function') onNotification(notice);
        });

        return socket;
    }

    return {
        connect,

        /**
         * Abre a conversa com um perfil. Resolve com os dados do contato.
         * `connect` e assincrono (espera o socket.io-client carregar), entao
         * precisa ser aguardado - sem o await isso virava uma Promise no lugar
         * do socket e o emit nunca acontecia.
         */
        async join(targetProfileId) {
            currentTargetProfileId = targetProfileId;
            const activeSocket = await connect();

            // Sem socket a conversa continua funcionando por REST (historico e
            // envio); apenas nao ha atualizacao em tempo real.
            if (!activeSocket) return { ok: false, message: 'Tempo real indisponivel.' };

            return new Promise((resolve) => {
                activeSocket.emit('joinConversation', { targetProfileId }, (response) => {
                    resolve(response || { ok: false, message: 'Sem resposta do servidor.' });
                });
            });
        },

        /**
         * Envia uma mensagem. Usa o socket quando conectado (a propria emissao
         * persiste no banco) e cai para o REST quando nao ha socket.
         */
        async send(targetProfileId, content) {
            const activeSocket = socket && socket.connected ? socket : null;

            if (!activeSocket) {
                const result = await sendMessageViaRest(targetProfileId, content);
                return result.ok
                    ? { ok: true, message: result.data }
                    : { ok: false, message: result.data?.message || 'Nao foi possivel enviar a mensagem.' };
            }

            return new Promise((resolve) => {
                activeSocket.emit('sendConversationMessage', { targetProfileId, content }, (response) => {
                    resolve(response || { ok: false, message: 'Sem resposta do servidor.' });
                });
            });
        },

        leave() {
            currentTargetProfileId = null;
            if (socket) socket.emit('leaveConversation');
        },

        disconnect() {
            if (socket) {
                socket.disconnect();
                socket = null;
            }
        }
    };
}

export function formatMessageTime(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
