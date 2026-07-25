import { getUserProfile, getProfessionalAppointments, getClinicProfessionals, getAvailableDoctors, updateAppointmentStatus } from './api.js';

let professionalData = null;
let appointmentsData = [];
let activeDoctorChatKey = '';
let doctorChatSocket = null;
const doctorChatMessages = {};

async function loadProfessionalInfo() {
    try {
        console.log('Iniciando carregamento de informaÃ§Ãµes do profissional...');
        const profileResponse = await getUserProfile();
        console.log('Resposta do perfil:', profileResponse);

        if (profileResponse.ok && profileResponse.data) {
            professionalData = profileResponse.data;
            console.log('Dados do profissional carregados:', professionalData);

            if (professionalData.profile && professionalData.profile !== 'medico') {
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                window.location.href = 'login-medico.html';
                return;
            }

            const displayName = professionalData.name || 'Nome nao informado';
            const registry = professionalData.crm || 'Registro';
            const unit = professionalData.unidade || 'Unidade nÃ£o definida';

            const nameEl = document.getElementById('professionalName');
            const registryEl = document.getElementById('professionalRegistry');
            const unitEl = document.getElementById('professionalUnit');
            const welcomeEl = document.getElementById('welcomeMessage');
            const avatarEl = document.getElementById('professionalAvatar');
            const unitBadge = document.getElementById('unitBadge');

            console.log('Elementos encontrados:', { nameEl, registryEl, unitEl, welcomeEl, avatarEl, unitBadge });

            if (nameEl) nameEl.innerText = displayName;
            if (registryEl) registryEl.innerText = registry;
            if (unitEl) unitEl.innerText = unit;
            if (unitBadge) unitBadge.innerText = unit;
            if (welcomeEl) welcomeEl.innerText = `Bom dia, ${displayName}`;
            if (avatarEl) avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=0073e6&color=fff`;

            // Armazenar no localStorage e sessionStorage para compatibilidade
            localStorage.setItem('user', JSON.stringify(professionalData));
            sessionStorage.setItem('professionalName', displayName);
            sessionStorage.setItem('professionalRegistry', registry);
            sessionStorage.setItem('professionalUnit', unit);

            console.log('InformaÃ§Ãµes do profissional atualizadas na UI');
        } else {
            console.warn('Erro ao carregar perfil:', profileResponse);
            loadProfessionalInfoFromStorage();
        }
    } catch (error) {
        console.error('Erro ao carregar informaÃ§Ãµes do profissional:', error);
        loadProfessionalInfoFromStorage();
    }
}

function loadProfessionalInfoFromStorage() {
    let storedUser = {};
    try {
        storedUser = JSON.parse(localStorage.getItem('user') || '{}');
    } catch (error) {
        storedUser = {};
    }

    const rawName = sessionStorage.getItem('professionalName') || storedUser.name || 'Nome nao informado';
    const registry = sessionStorage.getItem('professionalRegistry') || storedUser.registry || storedUser.crm || 'Registro';
    professionalData = professionalData || storedUser;
    const unit = sessionStorage.getItem('professionalUnit') || storedUser.unidade || storedUser.unit || 'Unidade nÃ£o definida';

    const nameEl = document.getElementById('professionalName');
    const registryEl = document.getElementById('professionalRegistry');
    const unitEl = document.getElementById('professionalUnit');
    const welcomeEl = document.getElementById('welcomeMessage');
    const avatarEl = document.getElementById('professionalAvatar');
    const unitBadge = document.getElementById('unitBadge');

    if (nameEl) nameEl.innerText = rawName;
    if (registryEl) registryEl.innerText = registry;
    if (unitEl) unitEl.innerText = unit;
    if (unitBadge) unitBadge.innerText = unit;
    if (welcomeEl) welcomeEl.innerText = `Bom dia, ${rawName}`;
    if (avatarEl) avatarEl.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(rawName)}&background=0073e6&color=fff`;
}

function normalizeUnitKey(unit) {
    return String(unit || '')
        .trim()
        .replace(/^Unidade\s+/i, '')
        .toUpperCase();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getToken() {
    return localStorage.getItem('token');
}

function getProfessionalUnit() {
    try {
        const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
        return sessionStorage.getItem('professionalUnit') || storedUser.unidade || storedUser.unit || '';
    } catch (error) {
        return sessionStorage.getItem('professionalUnit') || '';
    }
}

function getResponseList(responseData) {
    if (Array.isArray(responseData)) return responseData;
    if (Array.isArray(responseData?.data)) return responseData.data;
    return [];
}

function getPatientKey(appointment) {
    return appointment.paciente_id || appointment.paciente_cpf || appointment.paciente_nome || appointment.id;
}

function getAppointmentChatKey(appointment) {
    return `appointment-${appointment.id}`;
}

function mapDoctorBackendMessage(message) {
    return {
        id: message.id,
        sender: message.remetenteProfile === 'medico' ? 'professional' : 'patient',
        content: message.conteudo || '',
        timestamp: formatDateTime(message.createdAt || new Date())
    };
}

function initDoctorChatSocket() {
    const token = getToken();
    if (!token || typeof io !== 'function' || doctorChatSocket) return;

    doctorChatSocket = io('https://conecta-inclusao.onrender.com', { auth: { token } });
    doctorChatSocket.on('chat:message', (message) => {
        const key = `appointment-${message.agendamentoId}`;
        const messages = doctorChatMessages[key] || [];
        if (!messages.some(item => String(item.id) === String(message.id))) {
            messages.push(mapDoctorBackendMessage(message));
            doctorChatMessages[key] = messages;
        }
        if (activeDoctorChatKey === key) renderDoctorActiveConversation();
        renderDoctorMessageContacts();
    });
}

function getDoctorMessageContacts() {
    const contactsMap = new Map();
    appointmentsData.forEach(appointment => {
        if (!appointment.id) return;
        const key = getAppointmentChatKey(appointment);
        if (contactsMap.has(key)) return;

        contactsMap.set(key, {
            key,
            agendamentoId: appointment.id,
            name: appointment.nome_paciente || appointment.paciente_nome || 'Paciente nao informado',
            meta: `${formatAppointmentDate(appointment)} as ${formatAppointmentTime(appointment)}`,
            specialty: appointment.profissional_especialidade || appointment.especialidade || 'Atendimento'
        });
    });

    return Array.from(contactsMap.values())
        .sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));
}

async function loadDoctorConversation(contact) {
    if (!contact?.agendamentoId || doctorChatMessages[contact.key]) return;

    const token = getToken();
    if (!token) return;

    try {
        const response = await fetch(`https://conecta-inclusao.onrender.com/messages/agendamentos/${encodeURIComponent(contact.agendamentoId)}?limit=100`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (!response.ok) {
            console.error('Falha ao carregar mensagens do medico:', data);
            doctorChatMessages[contact.key] = [];
            return;
        }

        doctorChatMessages[contact.key] = Array.isArray(data.messages)
            ? data.messages.map(mapDoctorBackendMessage)
            : [];
        doctorChatSocket?.emit('chat:join', { agendamentoId: contact.agendamentoId });
    } catch (error) {
        console.error('Erro ao carregar mensagens do medico:', error);
        doctorChatMessages[contact.key] = [];
    }
}

function renderDoctorMessageContacts() {
    const container = document.getElementById('doctorMessageContactsList');
    if (!container) return;

    const contacts = getDoctorMessageContacts();
    if (!contacts.length) {
        container.innerHTML = `
            <div class="chat-contacts-empty">
                <i class="ph ph-user-list"></i>
                <p>Nenhum paciente com agendamento para conversar.</p>
            </div>
        `;
        activeDoctorChatKey = '';
        renderDoctorActiveConversation();
        return;
    }

    if (!contacts.some(contact => contact.key === activeDoctorChatKey)) {
        activeDoctorChatKey = contacts[0].key;
    }

    const activeContact = contacts.find(contact => contact.key === activeDoctorChatKey);
    if (activeContact) loadDoctorConversation(activeContact).then(renderDoctorActiveConversation);

    container.innerHTML = '';
    contacts.forEach(contact => {
        doctorChatSocket?.emit('chat:join', { agendamentoId: contact.agendamentoId });
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `chat-contact-card${contact.key === activeDoctorChatKey ? ' active' : ''}`;
        button.innerHTML = `
            <strong>${escapeHtml(contact.name)}</strong>
            <span>${escapeHtml(contact.specialty)}</span>
            <small>${escapeHtml(contact.meta)}</small>
        `;
        button.addEventListener('click', () => {
            activeDoctorChatKey = contact.key;
            renderDoctorMessageContacts();
            loadDoctorConversation(contact).then(renderDoctorActiveConversation);
            renderDoctorActiveConversation();
        });
        container.appendChild(button);
    });
}

function renderDoctorActiveConversation() {
    const messagesList = document.getElementById('doctorChatMessagesList');
    const contactName = document.getElementById('doctorChatContactName');
    const contactMeta = document.getElementById('doctorChatContactMeta');
    const input = document.getElementById('doctorMessageInput');
    const button = document.getElementById('doctorSendMessageButton');
    if (!messagesList || !contactName || !contactMeta || !input || !button) return;

    const contact = getDoctorMessageContacts().find(item => item.key === activeDoctorChatKey);
    if (!contact) {
        contactName.textContent = 'Selecione um paciente';
        contactMeta.textContent = 'As mensagens aparecem aqui.';
        input.value = '';
        input.disabled = true;
        button.disabled = true;
        messagesList.innerHTML = `
            <div class="chat-empty">
                <i class="ph ph-chat-circle-dots"></i>
                <p>Escolha um paciente para abrir a conversa.</p>
            </div>
        `;
        return;
    }

    contactName.textContent = contact.name;
    contactMeta.textContent = `${contact.specialty} - ${contact.meta}`;
    input.disabled = false;
    button.disabled = false;

    const messages = doctorChatMessages[contact.key] || [];
    if (!messages.length) {
        messagesList.innerHTML = `
            <div class="chat-empty">
                <i class="ph ph-chat-circle-dots"></i>
                <p>Nenhuma mensagem ainda. Responda quando o paciente chamar.</p>
            </div>
        `;
        return;
    }

    messagesList.innerHTML = '';
    messages.forEach(message => {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${message.sender}`;
        bubble.innerHTML = `
            <div>${escapeHtml(message.content)}</div>
            <span class="chat-bubble-meta">${escapeHtml(message.sender === 'professional' ? professionalData?.name || 'Medico' : contact.name)} - ${escapeHtml(message.timestamp)}</span>
        `;
        messagesList.appendChild(bubble);
    });
    messagesList.scrollTop = messagesList.scrollHeight;
}

function sendDoctorMessage(content) {
    const contact = getDoctorMessageContacts().find(item => item.key === activeDoctorChatKey);
    if (!contact || !content.trim()) return;

    const optimistic = {
        id: `tmp-${Date.now()}`,
        sender: 'professional',
        content,
        timestamp: formatDateTime()
    };
    doctorChatMessages[contact.key] = [...(doctorChatMessages[contact.key] || []), optimistic];
    renderDoctorActiveConversation();

    if (doctorChatSocket?.connected) {
        doctorChatSocket.emit('chat:send', { agendamentoId: contact.agendamentoId, content }, (result) => {
            doctorChatMessages[contact.key] = (doctorChatMessages[contact.key] || []).filter(message => message.id !== optimistic.id);
            if (!result?.ok) showPopup(result?.message || 'Nao foi possivel enviar a mensagem.');
            if (result?.ok && result.message) {
                const messages = doctorChatMessages[contact.key] || [];
                if (!messages.some(message => String(message.id) === String(result.message.id))) {
                    messages.push(mapDoctorBackendMessage(result.message));
                    doctorChatMessages[contact.key] = messages;
                }
            }
            renderDoctorActiveConversation();
        });
        return;
    }

    fetch(`https://conecta-inclusao.onrender.com/messages/agendamentos/${encodeURIComponent(contact.agendamentoId)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${getToken()}`
        },
        body: JSON.stringify({ content })
    }).then(async response => {
        const body = await response.json();
        doctorChatMessages[contact.key] = (doctorChatMessages[contact.key] || []).filter(message => message.id !== optimistic.id);
        if (!response.ok) await showPopup(body.message || 'Nao foi possivel enviar a mensagem.');
        if (response.ok && body.id) {
            doctorChatMessages[contact.key] = [...(doctorChatMessages[contact.key] || []), mapDoctorBackendMessage(body)];
        }
        renderDoctorActiveConversation();
    }).catch(async error => {
        console.error('Erro ao enviar mensagem do medico:', error);
        doctorChatMessages[contact.key] = (doctorChatMessages[contact.key] || []).filter(message => message.id !== optimistic.id);
        await showPopup('Erro de conexao ao enviar mensagem.');
        renderDoctorActiveConversation();
    });
}

function normalizePatientStatus(status) {
    const statusLower = String(status || '').toLowerCase();
    if (statusLower === 'active') return 'Ativo';
    if (statusLower === 'inactive') return 'Inativo';
    if (statusLower === 'ativo') return 'Ativo';
    if (statusLower === 'inativo') return 'Inativo';
    return status || 'Nao informado';
}

async function getTeamProfessionals() {
    const authenticatedResponse = await getClinicProfessionals();

    if (authenticatedResponse.ok) {
        return authenticatedResponse;
    }

    const message = authenticatedResponse.data?.message || authenticatedResponse.error || '';
    const canFallbackToPublicList = authenticatedResponse.status === 401 ||
        authenticatedResponse.status === 403 ||
        message.toLowerCase().includes('token');

    if (!canFallbackToPublicList) {
        return authenticatedResponse;
    }

    console.warn('Token indisponivel para equipe; usando lista publica de medicos.', authenticatedResponse);
    return getAvailableDoctors();
}

async function loadTeam() {
    const unit = getProfessionalUnit();
    const teamGrid = document.getElementById('teamGrid');

    if (!teamGrid) {
        console.error('teamGrid element nÃ£o encontrado');
        return;
    }

    console.log('Iniciando carregamento de equipe. Unidade:', unit);

    try {
        // Mostrar loading
        teamGrid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: #64748b;">Carregando equipe...</div>`;

        // Tentar carregar profissionais do backend
        console.log('Buscando profissionais da clÃ­nica...');
        const professionalsResponse = await getTeamProfessionals();
        console.log('Resposta de profissionais:', professionalsResponse);

        let equipe = [];

        if (professionalsResponse.ok && professionalsResponse.data) {
            const unitKey = normalizeUnitKey(unit);
            equipe = Array.isArray(professionalsResponse.data)
                ? professionalsResponse.data
                : [professionalsResponse.data];

            console.log('Profissionais carregados do backend:', equipe);

            // Filtrar por unidade se necessÃ¡rio
            equipe = equipe
                .filter(member => normalizeUnitKey(member.unidade || member.unit) === unitKey)
                .map(member => ({
                name: member.name || 'Profissional cadastrado',
                crm: member.crm || member.registry || 'Registro nÃ£o informado',
                specialty: member.especialidade || member.specialty || 'Especialidade nÃ£o informada'
            }));
        } else {
            console.warn('Erro ao carregar do backend:', professionalsResponse);
            teamGrid.innerHTML = `
                <div style="grid-column: 1/-1;">
                    <div class="empty-team-message">
                        <i class="ph ph-users-three"></i>
                        <p>${escapeHtml(professionalsResponse.data?.message || 'Nao foi possivel carregar a equipe da unidade.')}</p>
                    </div>
                </div>
            `;
            return;
        }

        if (equipe.length === 0) {
            teamGrid.innerHTML = `
                <div style="grid-column: 1/-1;">
                    <div class="empty-team-message">
                        <i class="ph ph-users-three"></i>
                        <p>Por enquanto nÃ£o hÃ¡ nenhum profissional cadastrado nesta unidade.</p>
                    </div>
                </div>
            `;
            return;
        }

        teamGrid.innerHTML = equipe.map(member => `
            <div class="team-member-card">
                <div class="team-member-avatar">${member.name.charAt(0)}</div>
                <div class="team-member-name">${member.name}</div>
                <div class="team-member-crm">CRM: ${member.crm}</div>
                <div class="team-member-specialty">${member.specialty}</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar equipe:', error);
        teamGrid.innerHTML = `
            <div style="grid-column: 1/-1;">
                <div class="empty-team-message">
                    <i class="ph ph-users-three"></i>
                    <p>Erro ao carregar equipe: ${escapeHtml(error.message)}</p>
                </div>
            </div>
        `;
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Carregar informaÃ§Ãµes do profissional
        await loadProfessionalInfo();
        initDoctorChatSocket();

        // Carregar equipe
        await loadTeam();

        // Carregar dados reais para os cards do resumo
        await loadAgendaData();

        // Configurar busca
        const searchInput = document.querySelector('.search-bar input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const tableRows = document.querySelectorAll('.appointments-table tbody tr');

                tableRows.forEach(row => {
                    const patientName = row.querySelector('.patient-td')?.innerText.toLowerCase() || '';
                    if (patientName.includes(searchTerm)) {
                        row.style.display = '';
                    } else {
                        row.style.display = 'none';
                    }
                });
            });
        }

        // Configurar navegaÃ§Ã£o da sidebar
        const navLinks = document.querySelectorAll('.sidebar nav a');
        navLinks.forEach(link => {
            link.addEventListener('click', function (e) {
                e.preventDefault();

                // Remove active de todos
                navLinks.forEach(l => l.classList.remove('active'));
                // Adiciona no clicado
                this.classList.add('active');
            });
        });

        console.log("Dashboard MÃ©dico carregado.");
    } catch (error) {
        console.error('Erro ao carregar dashboard:', error);
    }
});

// ===== FUNÃ‡Ã•ES PARA AGENDA E PACIENTES =====

// FunÃ§Ã£o para mostrar a pÃ¡gina inicial
function showHome(event) {
    event.preventDefault();
    updateSidebarActive(event.target.closest('a'));

    // Esconder todas as seÃ§Ãµes especÃ­ficas
    document.getElementById('agendaSection').style.display = 'none';
    document.getElementById('pacientesSection').style.display = 'none';
    document.getElementById('messagesSection').style.display = 'none';
    document.getElementById('teamSection').style.display = 'block';
}

// FunÃ§Ã£o para abrir a agenda mÃ©dica
function openAgendaMedica(event) {
    if (event) {
        event.preventDefault();
        updateSidebarActive(event.target.closest('a'));
    }

    showSection('agenda');
    loadAgendaData();
}

// FunÃ§Ã£o para toggle da lista de pacientes
async function togglePatientsList(event) {
    if (event) {
        event.preventDefault();
        updateSidebarActive(event.target.closest('a'));
    }

    showSection('pacientes');
    if (!appointmentsData || appointmentsData.length === 0) {
        await loadAgendaData();
    }
    loadPatientsData();
}

async function openMessages(event) {
    if (event) {
        event.preventDefault();
        updateSidebarActive(event.target.closest('a'));
    }

    showSection('messages');
    if (!appointmentsData || appointmentsData.length === 0) {
        await loadAgendaData();
    }
    renderDoctorMessageContacts();
}

// FunÃ§Ã£o para mostrar/esconder seÃ§Ãµes
function showSection(section) {
    // Esconder todas
    document.getElementById('agendaSection').style.display = 'none';
    document.getElementById('pacientesSection').style.display = 'none';
    document.getElementById('messagesSection').style.display = 'none';
    document.getElementById('teamSection').style.display = 'none';

    // Mostrar a selecionada
    if (section === 'agenda') {
        document.getElementById('agendaSection').style.display = 'block';
    } else if (section === 'pacientes') {
        document.getElementById('pacientesSection').style.display = 'block';
    } else if (section === 'messages') {
        document.getElementById('messagesSection').style.display = 'block';
    }
}

// FunÃ§Ã£o para atualizar o link ativo no sidebar
function updateSidebarActive(element) {
    document.querySelectorAll('.sidebar nav a').forEach(a => a.classList.remove('active'));
    if (element) element.classList.add('active');
}

function isSameDay(dateString, referenceDate = new Date()) {
    if (!dateString) return false;
    const date = new Date(String(dateString).replace(' ', 'T'));
    return !Number.isNaN(date.getTime()) &&
        date.getFullYear() === referenceDate.getFullYear() &&
        date.getMonth() === referenceDate.getMonth() &&
        date.getDate() === referenceDate.getDate();
}

function updateDashboardStats(appointments = []) {
    const patientIds = new Set();
    appointments.forEach(appointment => {
        const patientKey = getPatientKey(appointment);
        if (patientKey) patientIds.add(patientKey);
    });

    const todayAppointments = appointments.filter(appointment => isSameDay(appointment.data_agendamento)).length;
    const waitingAppointments = appointments.filter(appointment => {
        const status = String(appointment.status || '').toLowerCase();
        return status === 'pendente';
    }).length;

    const totalPatientsCard = document.getElementById('totalPatientsCard');
    const todayAppointmentsCard = document.getElementById('todayAppointmentsCard');
    const waitingAppointmentsCard = document.getElementById('waitingAppointmentsCard');
    const scheduleSummary = document.getElementById('scheduleSummary');

    if (totalPatientsCard) totalPatientsCard.innerText = patientIds.size;
    if (todayAppointmentsCard) todayAppointmentsCard.innerText = todayAppointments;
    if (waitingAppointmentsCard) waitingAppointmentsCard.innerText = waitingAppointments;
    if (scheduleSummary) {
        scheduleSummary.innerText = todayAppointments === 1
            ? 'Voce tem 1 consulta agendada para hoje.'
            : `Voce tem ${todayAppointments} consultas agendadas para hoje.`;
    }
}

function markDashboardStatsUnavailable(message = 'Nao foi possivel carregar a agenda.') {
    const totalPatientsCard = document.getElementById('totalPatientsCard');
    const todayAppointmentsCard = document.getElementById('todayAppointmentsCard');
    const waitingAppointmentsCard = document.getElementById('waitingAppointmentsCard');
    const scheduleSummary = document.getElementById('scheduleSummary');

    if (totalPatientsCard) totalPatientsCard.innerText = '--';
    if (todayAppointmentsCard) todayAppointmentsCard.innerText = '--';
    if (waitingAppointmentsCard) waitingAppointmentsCard.innerText = '--';
    if (scheduleSummary) scheduleSummary.innerText = message;
}

// FunÃ§Ã£o para carregar dados da agenda
function getAppointmentAction(status) {
    const statusLower = String(status || '').toLowerCase();

    if (statusLower === 'confirmado') {
        return { label: 'Finalizar', nextStatus: 'realizado', disabled: false };
    }

    if (statusLower === 'realizado') {
        return { label: 'Concluido', nextStatus: null, disabled: true };
    }

    if (statusLower === 'cancelado') {
        return { label: 'Cancelado', nextStatus: null, disabled: true };
    }

    return { label: 'Atender', nextStatus: 'confirmado', disabled: false };
}

function updateAppointmentInMemory(appointmentId, status) {
    appointmentsData = appointmentsData.map(appointment => {
        if (String(appointment.id) !== String(appointmentId)) return appointment;
        return { ...appointment, status };
    });
    updateDashboardStats(appointmentsData);
}

async function loadAgendaData() {
    const agendaContent = document.querySelector('.appointments-table tbody');
    if (!agendaContent) {
        console.error('Tabela de agendamentos nÃ£o encontrada');
        return;
    }

    try {
        console.log('Iniciando carregamento de agenda. professionalData:', professionalData);

        if (!professionalData || !professionalData.id) {
            console.warn('Dados do profissional nÃ£o carregados ou sem ID.');
            markDashboardStatsUnavailable('Dados do profissional nao carregados.');
            agendaContent.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 20px; color: #64748b;">
                        Dados do profissional nÃ£o carregados
                    </td>
                </tr>
            `;
            return;
        }

        console.log(`Buscando agendamentos para o profissional ID: ${professionalData.id}`);
        const appointmentsResponse = await getProfessionalAppointments(professionalData.id, { limit: 100 });
        console.log('Resposta de agendamentos:', appointmentsResponse);

        if (appointmentsResponse.ok && appointmentsResponse.data) {
            const appointments = getUniqueAppointments(getResponseList(appointmentsResponse.data));
            appointmentsData = appointments;
            updateDashboardStats(appointments);
            renderDoctorMessageContacts();

            console.log('Agendamentos carregados:', appointments);

            // Limpar tabela
            agendaContent.innerHTML = '';

            if (appointments.length === 0) {
                agendaContent.innerHTML = `
                    <tr>
                        <td colspan="6" style="text-align: center; padding: 20px; color: #64748b;">
                            Por enquanto nÃ£o hÃ¡ nenhum agendamento cadastrado.
                        </td>
                    </tr>
                `;
                return;
            }

            // Popular tabela com dados reais
            const sortedAppointments = appointments.slice().sort((first, second) => {
                const firstDone = String(first.status || '').toLowerCase() === 'realizado';
                const secondDone = String(second.status || '').toLowerCase() === 'realizado';

                if (firstDone !== secondDone) return firstDone ? 1 : -1;

                return parseAppointmentDateTimeValue(first) - parseAppointmentDateTimeValue(second);
            });

            agendaContent.innerHTML = sortedAppointments.map(appointment => {
                const patientName = appointment.nome_paciente || appointment.paciente_nome || 'Paciente nao informado';
                const appointmentDate = formatAppointmentDate(appointment);
                const appointmentTime = formatAppointmentTime(appointment);
                const appointmentType = appointment.tipo_consulta || appointment.profissional_especialidade || 'Nao informado';
                const appointmentStatus = appointment.status || 'Nao informado';
                const statusLower = String(appointmentStatus).toLowerCase();
                const isAppointmentToday = isSameDay(getAppointmentDateValue(appointment));
                const action = getAppointmentAction(appointmentStatus);
                const actionContent = statusLower === 'realizado'
                    ? '<span class="action-unavailable">Consulta realizada, aÃ§Ãµes bloqueadas</span>'
                    : isAppointmentToday
                    ? `<button class="btn-action" type="button" data-appointment-id="${escapeHtml(appointment.id)}" data-patient-name="${escapeHtml(patientName)}" data-next-status="${escapeHtml(action.nextStatus || '')}" ${action.disabled ? 'disabled' : ''}>
                            ${escapeHtml(action.label)}
                        </button>`
                    : `<span class="action-unavailable">Disponivel no dia da consulta: ${escapeHtml(appointmentDate)} as ${escapeHtml(appointmentTime)}</span>`;

                return `
                <tr>
                    <td class="patient-td"><strong>${escapeHtml(patientName)}</strong></td>
                    <td>${escapeHtml(appointmentDate)}</td>
                    <td>${escapeHtml(appointmentTime)}</td>
                    <td>${escapeHtml(appointmentType)}</td>
                    <td>
                        <span class="status ${getStatusClass(appointmentStatus)}">
                            ${escapeHtml(appointmentStatus)}
                        </span>
                    </td>
                    <td>
                        ${actionContent}
                    </td>
                </tr>
            `;
            }).join('');

            agendaContent.querySelectorAll('.btn-action').forEach(button => {
                button.addEventListener('click', () => {
                    handleAppointmentAction(button, button.dataset.patientName || 'Paciente nao informado', button.dataset.appointmentId);
                });
            });
        } else {
            console.error('Erro ao carregar agendamentos:', appointmentsResponse);
            markDashboardStatsUnavailable();
            agendaContent.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align: center; padding: 20px; color: #ef4444;">
                        Erro ao carregar agendamentos: ${appointmentsResponse.data?.message || 'Erro desconhecido'}
                    </td>
                </tr>
            `;
        }
    } catch (error) {
        console.error('Erro ao carregar agenda:', error);
        markDashboardStatsUnavailable();
        agendaContent.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 20px; color: #ef4444;">
                    Erro ao carregar agendamentos: ${error.message}
                </td>
            </tr>
        `;
    }
}

// FunÃ§Ã£o auxiliar para obter classe CSS de status
function getStatusClass(status) {
    const statusLower = String(status || '').toLowerCase();
    if (statusLower === 'confirmado') return 'confirm';
    if (statusLower === 'pendente') return 'pending';
    if (statusLower === 'cancelado' || statusLower === 'realizado') return 'pending';
    return 'waiting';
}

// FunÃ§Ã£o para gerenciar aÃ§Ãµes em agendamentos
async function handleAppointmentAction(button, patientName, appointmentId) {
    const row = button.closest('tr');
    const statusSpan = row.querySelector('.status');
    const nextStatus = button.dataset.nextStatus;

    if (appointmentId && nextStatus) {
        const confirmationMessage = nextStatus === 'confirmado'
            ? `Deseja iniciar o atendimento de ${patientName}?`
            : `Deseja finalizar o atendimento de ${patientName}?`;

        const confirmed = await showPopup(confirmationMessage, 'confirm');
        if (!confirmed) return;

        button.disabled = true;
        const previousText = button.innerText;
        button.innerText = 'Salvando...';

        const result = await updateAppointmentStatus(appointmentId, nextStatus);

        if (!result.ok) {
            button.disabled = false;
            button.innerText = previousText;
            showPopup(result.data?.message || result.error || 'Nao foi possivel atualizar o status.');
            return;
        }

        updateAppointmentInMemory(appointmentId, nextStatus);

        statusSpan.innerText = nextStatus;
        statusSpan.className = `status ${getStatusClass(nextStatus)}`;

        const action = getAppointmentAction(nextStatus);
        button.innerText = action.label;
        button.dataset.nextStatus = action.nextStatus || '';
        button.disabled = action.disabled;

        if (nextStatus === 'realizado') {
            await showPopup(`Atendimento de ${patientName} finalizado com sucesso!`);
        }

        return;
    }

    if (button.innerText === 'Atender') {
        const confirmar = await showPopup(`Deseja iniciar o atendimento de ${patientName}?`, 'confirm');

        if (confirmar) {
            button.innerText = 'Finalizar';
            button.style.backgroundColor = '#ef4444';
            button.style.color = 'white';
            button.style.borderColor = '#ef4444';

            statusSpan.innerText = 'Em Atendimento';
            statusSpan.className = 'status waiting';
        }
    } else {
        await showPopup(`Atendimento de ${patientName} finalizado com sucesso!`);
        row.style.opacity = '0.5';
        button.disabled = true;
        button.innerText = 'ConcluÃƒÂ­do';
        statusSpan.innerText = 'Finalizado';
        statusSpan.className = 'status pending';
    }
}

// FunÃ§Ã£o para carregar dados dos pacientes
function loadPatientsData() {
    const tableBody = document.getElementById('patientsTableBody');
    if (!tableBody) return;

    try {
        // Usar dados dos agendamentos se estiverem disponÃ­veis
        if (!appointmentsData || appointmentsData.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 20px; color: #64748b;">
                        Por enquanto nÃ£o hÃ¡ nenhum paciente com agendamentos.
                    </td>
                </tr>
            `;
            updatePatientStats(0);
            return;
        }

        // Extrair pacientes Ãºnicos dos agendamentos
        const patientMap = new Map();
        appointmentsData.forEach(appointment => {
            const pacienteId = getPatientKey(appointment);
            if (!patientMap.has(pacienteId)) {
                const patientStatus = appointment.status || 'Nao informado';
                patientMap.set(pacienteId, {
                    name: appointment.nome_paciente || appointment.paciente_nome || 'Paciente nao informado',
                    cpf: appointment.cpf_paciente || appointment.paciente_cpf || 'N/A',
                    email: appointment.email_paciente || appointment.paciente_email || 'N/A',
                    status: patientStatus,
                    lastConsultation: formatDateTime(appointment.data_agendamento)
                });
            }
        });

        const patients = Array.from(patientMap.values());

        updatePatientStats(patients.length);

        tableBody.innerHTML = patients.map(patient => `
            <tr>
                <td><strong>${escapeHtml(patient.name)}</strong></td>
                <td>${escapeHtml(patient.cpf)}</td>
                <td>${escapeHtml(patient.email)}</td>
                <td>${escapeHtml(patient.lastConsultation)}</td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Erro ao carregar pacientes:', error);
        tableBody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align: center; padding: 20px; color: #ef4444;">
                    Erro ao carregar pacientes
                </td>
            </tr>
        `;
    }
}

// FunÃ§Ã£o auxiliar para atualizar estatÃ­sticas de pacientes
function updatePatientStats(total) {
    const totalEl = document.getElementById('totalPatients');

    if (totalEl) totalEl.innerText = total;
}

function getAppointmentDateValue(appointment) {
    return appointment?.data_agendamento || appointment?.appointmentDate || appointment?.date || '';
}

function getAppointmentTimeValue(appointment) {
    return appointment?.hora_agendamento || appointment?.appointmentTime || appointment?.time || '';
}

function getAppointmentDedupKey(appointment) {
    if (appointment?.id) return `id:${appointment.id}`;

    const patientKey = getPatientKey(appointment) || appointment?.paciente_nome || appointment?.nome_paciente || '';
    const dateKey = getAppointmentDateValue(appointment);
    const timeKey = getAppointmentTimeValue(appointment);
    const statusKey = appointment?.status || '';

    return [patientKey, dateKey, timeKey, statusKey].map(value => String(value).trim().toLowerCase()).join('|');
}

function getUniqueAppointments(appointments = []) {
    const seen = new Set();

    return appointments.filter(appointment => {
        const key = getAppointmentDedupKey(appointment);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function formatAppointmentDate(appointment) {
    return formatDateTime(getAppointmentDateValue(appointment));
}

function parseAppointmentDateValue(dateValue) {
    const date = new Date(String(dateValue || '').replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function parseAppointmentDateTimeValue(appointment) {
    const dateValue = String(getAppointmentDateValue(appointment) || '');
    const timeValue = String(getAppointmentTimeValue(appointment) || '').slice(0, 5);

    if (!dateValue) return Number.MAX_SAFE_INTEGER;

    const hasTimeInDate = /[T ]\d{2}:\d{2}/.test(dateValue);
    const normalizedDateTime = hasTimeInDate
        ? dateValue.replace(' ', 'T')
        : `${dateValue.split(/[T ]/)[0]}T${timeValue || '00:00'}`;

    const date = new Date(normalizedDateTime);
    return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime();
}

function formatAppointmentTime(appointment) {
    const timeValue = getAppointmentTimeValue(appointment);
    if (timeValue) {
        const normalizedTime = String(timeValue);

        if (normalizedTime.includes('T')) {
            const date = new Date(normalizedTime);
            if (!Number.isNaN(date.getTime())) {
                return date.toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        }

        return normalizedTime.slice(0, 5);
    }

    const dateValue = getAppointmentDateValue(appointment);
    const normalizedDateValue = String(dateValue);
    const timeMatch = normalizedDateValue.match(/[T ](\d{2}:\d{2})/);
    if (timeMatch) return timeMatch[1];

    const date = new Date(normalizedDateValue);
    if (Number.isNaN(date.getTime())) return '--';

    return date.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });
}

// FunÃ§Ã£o auxiliar para formatar data e hora
function formatDateTime(dateString) {
    if (!dateString) return '--';
    try {
        const normalizedDate = String(dateString);

        if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
            const [year, month, day] = normalizedDate.split('-');
            return `${day}/${month}/${year}`;
        }

        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return '--';
        return date.toLocaleDateString('pt-BR');
    } catch (error) {
        return '--';
    }
}

async function handleLogout() {
    const result = await showPopup('Deseja realmente sair?', 'confirm');
    if (result) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.removeItem('professionalName');
        sessionStorage.removeItem('professionalRegistry');
        sessionStorage.removeItem('professionalUnit');
        window.location.href = 'login-medico.html';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const doctorMessageForm = document.getElementById('doctorMessageForm');
    if (!doctorMessageForm) return;

    doctorMessageForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = document.getElementById('doctorMessageInput');
        const content = input?.value.trim() || '';
        if (!content) return;
        sendDoctorMessage(content);
        input.value = '';
    });
});

window.handleLogout = handleLogout;
window.showHome = showHome;
window.openAgendaMedica = openAgendaMedica;
window.togglePatientsList = togglePatientsList;
window.openMessages = openMessages;
window.handleAppointmentAction = handleAppointmentAction;

