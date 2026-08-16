// Painel de mensagens do medico.
//
// O dashboard do medico nao tinha nenhuma interface de chat: o backend expunha
// socket.io e /messages, mas nada do lado do profissional consumia. Sem este
// painel, o chat do paciente nao teria com quem conversar.
import {
    createChatClient,
    fetchContacts,
    fetchConversation,
    formatMessageTime
} from './realtime-chat.js';

let contacts = [];
let activeContact = null;
let messages = [];
let chatClient = null;
let connectionStatus = 'desconectado';

function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getDoctorName() {
    try {
        const stored = JSON.parse(localStorage.getItem('user') || '{}');
        return stored.name || 'Você';
    } catch {
        return 'Você';
    }
}

function renderStatus() {
    const pill = document.getElementById('doctorChatStatus');
    if (!pill) return;

    pill.textContent = connectionStatus === 'conectado' ? 'Online' : 'Reconectando...';
    pill.className = `chat-status-pill${connectionStatus === 'conectado' ? '' : ' offline'}`;
}

function renderContacts() {
    const container = document.getElementById('doctorChatContacts');
    if (!container) return;

    if (!contacts.length) {
        container.innerHTML = `
            <div class="chat-contacts-empty">
                <i class="ph ph-user-list"></i>
                <p>Nenhum paciente vinculado a um atendimento ainda.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';

    contacts.forEach(contact => {
        const unread = Number(contact.unreadCount || 0);
        const isActive = activeContact && Number(activeContact.profileId) === Number(contact.profileId);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `chat-contact-card${isActive ? ' active' : ''}`;
        button.innerHTML = `
            <strong>${escapeHTML(contact.name)}${unread ? ` <span class="chat-unread-badge">${unread}</span>` : ''}</strong>
            <small>Ultimo atendimento: ${escapeHTML(formatMessageTime(contact.lastAppointmentAt) || 'nao informado')}</small>
        `;
        button.addEventListener('click', () => openConversation(contact));
        container.appendChild(button);
    });
}

function renderMessages() {
    const list = document.getElementById('doctorChatMessages');
    const title = document.getElementById('doctorChatContactName');
    const meta = document.getElementById('doctorChatContactMeta');
    const input = document.getElementById('doctorMessageInput');
    const sendButton = document.getElementById('doctorSendMessageButton');

    if (!list || !title || !meta || !input || !sendButton) return;

    if (!activeContact) {
        title.textContent = 'Selecione um paciente';
        meta.textContent = 'As conversas ficam disponiveis apenas com pacientes que possuem atendimento com voce.';
        input.disabled = true;
        sendButton.disabled = true;
        list.innerHTML = `
            <div class="chat-empty">
                <i class="ph ph-chat-circle-dots"></i>
                <p>Escolha um paciente na lista ao lado.</p>
            </div>
        `;
        return;
    }

    title.textContent = activeContact.name;
    meta.textContent = 'Conversa vinculada ao atendimento.';
    input.disabled = false;
    sendButton.disabled = false;
    list.innerHTML = '';

    if (!messages.length) {
        list.innerHTML = `
            <div class="chat-empty">
                <i class="ph ph-chat-circle-dots"></i>
                <p>Nenhuma mensagem ainda.</p>
            </div>
        `;
        return;
    }

    messages.forEach(message => {
        const mine = message.senderProfile === 'medico';
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${mine ? 'professional' : 'patient'}`;
        bubble.innerHTML = `
            <div>${escapeHTML(message.content)}</div>
            <span class="chat-bubble-meta">${escapeHTML(mine ? getDoctorName() : activeContact.name)} - ${escapeHTML(formatMessageTime(message.createdAt))}</span>
        `;
        list.appendChild(bubble);
    });

    list.scrollTop = list.scrollHeight;
}

async function openConversation(contact) {
    activeContact = contact;
    messages = [];
    renderContacts();
    renderMessages();

    const conversation = await fetchConversation(contact.profileId);
    messages = conversation?.messages || [];

    if (chatClient) {
        const joined = await chatClient.join(contact.profileId);
        if (!joined.ok) console.warn('Nao foi possivel entrar na conversa:', joined.message);
    }

    contact.unreadCount = 0;
    renderContacts();
    renderMessages();
}

async function sendMessage(content) {
    if (!activeContact || !content.trim()) return;

    const result = chatClient
        ? await chatClient.send(activeContact.profileId, content.trim())
        : { ok: false, message: 'Chat indisponivel no momento.' };

    if (!result.ok) {
        if (typeof window.showPopup === 'function') {
            await window.showPopup(result.message || 'Nao foi possivel enviar a mensagem.');
        } else {
            console.error(result.message);
        }
        return;
    }

    if (result.message && !messages.some(item => item.id === result.message.id)) {
        messages.push(result.message);
    }

    renderMessages();
}

export async function initDoctorChat() {
    chatClient = createChatClient({
        onMessage: (message) => {
            if (!activeContact) return;
            if (messages.some(item => item.id === message.id)) return;

            messages.push(message);
            renderMessages();
        },
        onNotification: (notice) => {
            const target = contacts.find(
                item => Number(item.profileId) === Number(notice.fromProfileId)
            );
            const isActive = activeContact
                && Number(activeContact.profileId) === Number(notice.fromProfileId);

            if (target && !isActive) {
                target.unreadCount = Number(target.unreadCount || 0) + 1;
                renderContacts();
            }
        },
        onStatus: (state, detail) => {
            connectionStatus = state;
            if (state === 'erro') console.warn('Chat:', detail);
            renderStatus();
        }
    });

    chatClient.connect();

    try {
        contacts = await fetchContacts();
    } catch (error) {
        console.error('Erro ao carregar contatos:', error);
        contacts = [];
    }

    renderContacts();
    renderMessages();
    renderStatus();

    const form = document.getElementById('doctorMessageForm');
    if (form) {
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            const input = document.getElementById('doctorMessageInput');
            const content = input?.value || '';
            if (!content.trim()) return;

            input.value = '';
            sendMessage(content);
        });
    }
}
