import { getUserProfile, getPatientAppointments, getAvailableDoctors } from './api.js';
import {
    createChatClient,
    fetchContacts,
    fetchConversation,
    formatMessageTime
} from './realtime-chat.js';

const PROFESSIONALS_STORAGE_KEY = 'companyProfessionals';
const PATIENT_MESSAGES_STORAGE_KEY = 'patientProfessionalMessages';
const GUARDIANS_STORAGE_KEY = 'patientGuardians';
const DEMO_PROFESSIONAL_REGISTRIES = ['CRM 123456'];
const CHATBOT_CONTACT = {
    key: 'conecta-chatbot',
    name: 'Assistente Conecta',
    specialty: 'Chatbot de apoio',
    hospital: 'Portal do Paciente',
    type: 'bot'
};
const CHATBOT_QUICK_ACTIONS = [
    'Quero agendar uma consulta',
    'Quais sao meus proximos agendamentos?',
    'O que levar para a consulta?',
    'Como desmarcar uma consulta?'
];
let activeChatContactKey = CHATBOT_CONTACT.key;
let chatbotScheduleDraft = null;

// --- Chat com profissionais (tempo real, persistido no backend) -------------
// O chatbot continua sendo local (localStorage). Conversas com medicos passaram
// a vir de /messages + socket autenticado, em vez de respostas simuladas.
let professionalContacts = [];
let activeConversationMessages = [];
let chatConnectionStatus = 'desconectado';

// Historico ja carregado, por profissional. Evita piscar vazio ao trocar de
// conversa e, sobretudo, impede que uma recarga que falha apague o que ja
// estava na tela.
const historicoPorProfissional = new Map();

// Numera cada abertura de conversa: resposta que chega depois de o usuario ter
// trocado de contato e descartada em vez de sobrescrever a conversa atual.
let aberturaConversaAtual = 0;

// 'ok' | 'carregando' | 'erro'
let estadoHistoricoConversa = 'ok';
let erroHistoricoConversa = '';
let chatClient = null;
let patientAppointments = [];
let patientAppointmentsLoaded = false;
let availableProfessionals = [];
let appointmentsMonthFilter = '';
let user = null;

async function loadUserInfo() {
    try {
        const profileResult = await getUserProfile();
        if (profileResult.ok && profileResult.data) {
            user = profileResult.data;
            if (user?.name) {
                sessionStorage.setItem('patientName', String(user.name));
            }
            if (user?.id) {
                sessionStorage.setItem('patientId', String(user.id));
            }
        } else {
            console.error('Falha ao carregar perfil do paciente:', profileResult);
            user = {};
        }

        const patientId = user?.id || sessionStorage.getItem('patientId');
        if (patientId) {
            try {
                const appointmentsResult = await getPatientAppointments(patientId);
                const appointmentsData = Array.isArray(appointmentsResult.data)
                    ? appointmentsResult.data
                    : (appointmentsResult.data?.data && Array.isArray(appointmentsResult.data.data) ? appointmentsResult.data.data : []);

                if (appointmentsResult.ok && Array.isArray(appointmentsData)) {
                    patientAppointments = appointmentsData;
                } else {
                    console.error('Falha ao carregar agendamentos do paciente:', appointmentsResult);
                    patientAppointments = [];
                }
            } catch (error) {
                console.error('Erro ao buscar agendamentos do paciente:', error);
                patientAppointments = [];
            }
            patientAppointmentsLoaded = true;
        }

        await fetchAvailableProfessionals();
        renderGuardians();
        loadPatientData();
        refreshDashboard();
    } catch (error) {
        console.error('Erro ao carregar dados do dashboard do paciente:', error);
        user = {};
        patientAppointments = [];
        patientAppointmentsLoaded = true;
        loadPatientData();
        refreshDashboard();
    }
}

/**
 * Traduz o status do paciente (coluna `status` da tabela `pacientes`) para o
 * texto do cabecalho. O banco grava 'ACTIVE' no cadastro, mas ha registros
 * antigos com 'ativo'/'inativo', entao a comparacao e case-insensitive.
 */
function describePatientStatus(status) {
    const normalizado = String(status || '').trim().toLowerCase();

    if (!normalizado) return 'Paciente';
    if (['active', 'ativo'].includes(normalizado)) return 'Paciente ativo';

    return 'Paciente inativo';
}

/**
 * Antes o avatar so era definido dentro de um bloco que exigia o paciente ter
 * consultas. Quem nao tinha nenhuma ficava com <img src=""> - que o navegador
 * renderiza como icone de imagem quebrada.
 */
function updatePatientAvatar(name) {
    const patientAvatar = document.getElementById('patientAvatar');
    if (!patientAvatar) return;

    const nomeParaAvatar = (name && name !== 'Paciente') ? name : 'Paciente';
    const encoded = encodeURIComponent(nomeParaAvatar);
    patientAvatar.src = `https://ui-avatars.com/api/?name=${encoded}&background=0073e6&color=fff`;
    patientAvatar.alt = `Avatar de ${nomeParaAvatar}`;
}

function loadPatientData() {
    const patientHeaderName = document.getElementById('patientHeaderName');
    const patientHeaderSubtitle = document.getElementById('patientHeaderSubtitle');
    const profilePatientName = document.getElementById('profilePatientName');
    const profilePatientCPF = document.getElementById('profilePatientCPF');
    const profileBirthDate = document.getElementById('profileBirthDate');
    const profilePatientResponsible = document.getElementById('profilePatientResponsible');
    const profileDisabilityType = document.getElementById('profileDisabilityType');
    const profilePlan = document.getElementById('profilePlan');
    const profilePreferredUnit = document.getElementById('profilePreferredUnit');

    const name = user?.name || 'Paciente';
    const cpf = user?.cpf || '--';
    const birthDate = user?.data_nascimento ? formatDate(user.data_nascimento) : '--';
    const responsible = user?.responsible || sessionStorage.getItem('patientResponsible') || '--';
    const disabilityType = user?.tipo_deficiencia || '--';
    const plan = user?.plan || '--';
    const preferredUnit = user?.unidade || user?.unit || '--';

    if (patientHeaderName) {
        patientHeaderName.textContent = name;
    }

    // Subtitulo reflete o status real vindo de /auth/profile, em vez do texto
    // fixo "Paciente ativo" que estava no HTML.
    if (patientHeaderSubtitle) {
        patientHeaderSubtitle.textContent = describePatientStatus(user?.status);
    }

    updatePatientAvatar(name);
    if (profilePatientName) {
        profilePatientName.textContent = name;
    }
    if (profilePatientCPF) {
        profilePatientCPF.textContent = cpf;
    }
    if (profileBirthDate) {
        profileBirthDate.textContent = birthDate;
    }
    if (profilePatientResponsible) {
        profilePatientResponsible.textContent = responsible;
    }
    if (profileDisabilityType) {
        profileDisabilityType.textContent = disabilityType;
    }
    if (profilePlan) {
        profilePlan.textContent = plan;
    }
    if (profilePreferredUnit) {
        profilePreferredUnit.textContent = preferredUnit;
    }
}

function getCurrentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthValue) {
    if (!monthValue) return '--';
    const [year, month] = monthValue.split('-').map(Number);
    const date = new Date(year, month - 1, 1);
    return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function applyAppointmentsMonthFilter(appointments) {
    if (!appointmentsMonthFilter) return appointments;
    return appointments.filter(appointment => String(appointment.date).slice(0, 7) === appointmentsMonthFilter);
}

function updateAppointmentsMonthPicker(value) {
    appointmentsMonthFilter = value || '';
    const picker = document.getElementById('appointmentsMonthPicker');
    if (picker) {
        picker.value = appointmentsMonthFilter;
    }
    const label = document.getElementById('appointmentsMonthLabel');
    if (label) {
        label.textContent = appointmentsMonthFilter ? formatMonthLabel(appointmentsMonthFilter) : 'Mês selecionado';
    }
    refreshDashboard();
}

function changeAppointmentsMonth(delta) {
    const current = appointmentsMonthFilter || getCurrentMonthValue();
    const [year, month] = current.split('-').map(Number);
    const newDate = new Date(year, month - 1 + delta, 1);
    const newValue = `${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, '0')}`;
    updateAppointmentsMonthPicker(newValue);
}

function getToken() {
    return window.ConectaSession.getToken();
}

async function fetchAvailableProfessionals() {
    const token = getToken();
    if (!token) {
        availableProfessionals = [];
        return [];
    }

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/professionals`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();

        if (!response.ok) {
            console.error('Falha ao carregar profissionais do servidor:', data);
            availableProfessionals = [];
            return [];
        }

        availableProfessionals = Array.isArray(data) ? data.map(professional => ({
            id: professional.id,
            name: professional.name || '',
            registry: professional.crm || '',
            role: professional.especialidade || professional.role || '',
            especialidade: professional.especialidade || professional.role || '',
            unit: professional.unidade || professional.unit || '',
            unidade: professional.unidade || professional.unit || '',
            status: professional.status || '',
            bio: professional.bio || ''
        })) : [];

        return availableProfessionals;
    } catch (error) {
        console.error('Erro ao carregar profissionais do servidor:', error);
        availableProfessionals = [];
        return [];
    }
}

function getAvailableProfessionals() {
    return availableProfessionals;
}

async function fetchPatientAppointments() {
    const token = getToken();
    if (!token) {
        patientAppointmentsLoaded = true;
        return [];
    }

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/appointments`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        const data = await response.json();

        if (!response.ok) {
            console.error('Falha ao carregar agendamentos do paciente:', data);
            patientAppointments = [];
            patientAppointmentsLoaded = true;
            return [];
        }

        patientAppointments = Array.isArray(data) ? data.map(appointment => ({
            id: appointment.id || `local-${Date.now()}`,
            specialty: appointment.specialty || appointment.especialty || '',
            doctor: appointment.doctorName || appointment.name || '',
            hospital: appointment.unit || appointment.clinicName || '',
            date: appointment.appointmentDate || appointment.data_agendamento || appointment.date || '',
            status: appointment.status || ''
        })) : [];
        patientAppointmentsLoaded = true;
        return patientAppointments;
    } catch (error) {
        console.error('Erro ao carregar agendamentos do paciente:', error);
        patientAppointments = [];
        patientAppointmentsLoaded = true;
        return [];
    }
}

// Função para abrir modal de responsável
function openGuardianModal() {
    const modal = document.getElementById('guardianModal');
    if (modal) {
        modal.style.display = 'flex';
        if (typeof setupPasswordVisibilityToggles === 'function') setupPasswordVisibilityToggles();
    }
}

// Função para fechar modal de responsável
function closeGuardianModal() {
    const modal = document.getElementById('guardianModal');
    if (modal) {
        modal.style.display = 'none';
    }
    const form = document.getElementById('formNewGuardian');
    if (form) {
        form.reset();
    }
}

// Catalogo de permissoes vindo do banco (tabela `permissoes`).
let availablePermissions = [];

async function loadAvailablePermissions() {
    const grid = document.getElementById('guardianPermissionsGrid');
    const token = window.ConectaSession.getToken();

    if (!grid || !token) return;

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/permissoes`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        const body = await response.json();
        availablePermissions = Array.isArray(body?.permissions) ? body.permissions : [];
    } catch (error) {
        console.error('Erro ao carregar permissões:', error);
        availablePermissions = [];
    }

    if (!availablePermissions.length) {
        grid.innerHTML = '<span style="color: #64748b;">Nenhuma permissão disponível.</span>';
        return;
    }

    grid.innerHTML = availablePermissions.map((permission, index) => `
        <label class="checkbox-item">
            <input type="checkbox" name="permissions" value="${permission.id}"${index === 0 ? ' checked' : ''}>
            <span>${escapeHTML(permission.label)}</span>
        </label>
    `).join('');
}

function permissionLabelById(id) {
    const found = availablePermissions.find(permission => String(permission.id) === String(id));
    return found ? found.label : String(id);
}

// Carregar responsáveis do localStorage
function loadGuardians() {
    try {
        const data = localStorage.getItem(GUARDIANS_STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (error) {
        console.error('Erro ao carregar responsáveis:', error);
        return [];
    }
}

// Salvar responsáveis no localStorage
function saveGuardians(guardians) {
    localStorage.setItem(GUARDIANS_STORAGE_KEY, JSON.stringify(guardians));
}

// Renderizar lista de responsáveis
function renderGuardians() {
    const guardiansList = document.getElementById('guardiansList');
    if (!guardiansList) return;

    guardiansList.innerHTML = '<div class="guardians-empty"><i class="ph ph-spinner-gap"></i><p>Carregando...</p></div>';

    const token = window.ConectaSession.getToken();

    (async () => {
        let guardians = [];
        if (token) {
            try {
                const resp = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/guardians`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    }
                });
                if (resp.ok) {
                    const data = await resp.json();
                    guardians = Array.isArray(data) ? data.map(g => ({
                        id: g.id,
                        name: g.name || g.nome,
                        relationship: g.relationship || g.parentesco,
                        email: g.email || '',
                        dateAdded: g.createdAt || ''
                    })) : [];
                    // cache locally for offline fallback
                    saveGuardians(guardians);
                } else {
                    // fallback to local storage
                    guardians = loadGuardians();
                }
            } catch (err) {
                console.error('Erro ao carregar responsáveis do servidor:', err);
                guardians = loadGuardians();
            }
        } else {
            guardians = loadGuardians();
        }

        if (!guardians || guardians.length === 0) {
            guardiansList.innerHTML = `
                <div class="guardians-empty">
                    <i class="ph ph-users-three"></i>
                    <p>Nenhum responsável cadastrado ainda.</p>
                </div>
            `;
            return;
        }

        guardiansList.innerHTML = '';

        guardians.forEach((guardian, index) => {
        const permissionsText = (guardian.permissions || [])
            .map(permissionLabelById)
            .join(', ');

        const card = document.createElement('div');
        card.className = 'guardian-card';
        card.innerHTML = `
            <div class="guardian-card-header">
                <div class="guardian-info">
                    <strong>${escapeHTML(guardian.name || '')}</strong>
                    <span>${escapeHTML(guardian.relationship || '')}</span>
                </div>
                <div class="guardian-actions">
                    <button class="btn-secondary" type="button" onclick="editGuardian(${index})">
                        <i class="ph ph-pencil"></i>
                    </button>
                    <button class="btn-danger" type="button" onclick="removeGuardian(${index})">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
            <div class="guardian-details">
                <div class="guardian-detail">
                    <label>E-mail</label>
                    <p>${escapeHTML(guardian.email || '')}</p>
                </div>
                <div class="guardian-detail">
                    <label>Acesso desde</label>
                    <p>${escapeHTML(guardian.dateAdded || 'Hoje')}</p>
                </div>
            </div>
            <div class="guardian-permissions">
                <div class="guardian-permissions-label">Permissões concedidas:</div>
                <div class="permissions-list">
                    ${permissionsText ? permissionsText.split(', ').map(p => `<span class="permission-badge"><i class="ph ph-check-circle"></i>${escapeHTML(p)}</span>`).join('') : '<span style="color: #64748b;">Nenhuma permissão</span>'}
                </div>
            </div>
        `;
        guardiansList.appendChild(card);
        });
    })();
}

// Remover responsável
function removeGuardian(index) {
        const guardians = loadGuardians();
        if (index >= 0 && index < guardians.length) {
            const guardian = guardians[index];
            guardians.splice(index, 1);
            saveGuardians(guardians);
            renderGuardians();
            showPopup(`Responsável ${guardian.name} removido com sucesso.`);
        }
}

// Editar responsável
function editGuardian(index) {
    const guardians = loadGuardians();
    if (index >= 0 && index < guardians.length) {
        const guardian = guardians[index];
        
        // Preencher o formulário com os dados do responsável
        document.getElementById('guardianName').value = guardian.name;
        document.getElementById('guardianRelationship').value = guardian.relationship;
        document.getElementById('guardianPassword').value = guardian.password || '';
        document.getElementById('guardianEmail').value = guardian.email;

        // Selecionar as permissões
        const checkboxes = document.querySelectorAll('input[name="permissions"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = guardian.permissions.includes(checkbox.value);
        });

        // Armazenar o índice para atualização
        document.getElementById('formNewGuardian').dataset.editIndex = index;
        document.querySelector('.modal-header div h3').textContent = 'Editar Responsável';
        document.querySelector('button[type="submit"]').textContent = 'Atualizar Responsável';

        openGuardianModal();
    }
}

// Renderizar sugestões de atendimento baseadas em profissionais cadastrados
function renderSuggestions() {
    const suggestionGrid = document.getElementById('suggestionGrid');
    if (!suggestionGrid) return;

    const professionals = availableProfessionals;
    const specialtiesMap = new Map();

    // Agrupar profissionais por especialidade
    professionals.forEach(prof => {
        if (!specialtiesMap.has(prof.especialidade)) {
            specialtiesMap.set(prof.especialidade, []);
        }
        specialtiesMap.get(prof.especialidade).push(prof);
    });

    // Se não há profissionais, mostrar mensagem vazia
    if (specialtiesMap.size === 0) {
        suggestionGrid.innerHTML = `
            <div class="suggestion-empty">
                <i class="ph ph-stethoscope"></i>
                <p>Nenhum profissional cadastrado no momento.</p>
            </div>
        `;
        return;
    }

    suggestionGrid.innerHTML = '';

    // Renderizar cards para cada especialidade
    let cardCount = 0;
    specialtiesMap.forEach((professionals, specialty) => {
        if (cardCount >= 6) return; // Limitar a 6 sugestões

        const firstProf = professionals[0];
        const countText = professionals.length > 1 ? `${professionals.length} profissionais` : '1 profissional';

        const card = document.createElement('div');
        card.className = 'suggestion-card';
        card.innerHTML = `
            <strong>${escapeHTML(specialty)}</strong>
            <span>${escapeHTML(firstProf.unidade || 'Unidade não informada')}</span>
            <p>${countText} disponível${professionals.length > 1 ? 's' : ''}. Agenda aberta para agendamentos.</p>
            <button class="btn-schedule-suggestion" type="button" data-specialty="${escapeHTML(specialty)}">
                Agendar
            </button>
        `;
        // Listener no lugar de onclick="scrollToSpecialty('...')": a
        // especialidade vem do banco e quebrava (ou injetava) o atributo inline
        // quando continha aspas.
        card.querySelector('.btn-schedule-suggestion')
            ?.addEventListener('click', () => scrollToSpecialty(specialty));

        suggestionGrid.appendChild(card);
        cardCount++;
    });
}

// Função auxiliar para scroll até a especialidade
function scrollToSpecialty(specialty) {
    switchTab('appointments');
    const select = document.getElementById('modalProfessional');
    if (select) {
        // Encontrar a opção correspondente
        const professionals = availableProfessionals;
        const prof = professionals.find(p => p.especialidade === specialty);
        if (prof) {
            select.value = prof.id;
            updateSelectedProfessionalDetails();
            openModal();
        }
    }
}

function openModal() {
    const modalDate = document.getElementById('modalDate');
    if (modalDate) {
        modalDate.min = getTodayInputValue();
        if (!modalDate.value || modalDate.value < modalDate.min) {
            modalDate.value = modalDate.min;
        }
    }

    populateProfessionalOptions();
    const modal = document.getElementById('appointmentModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeModal() {
    const modal = document.getElementById('appointmentModal');
    if (modal) {
        modal.style.display = 'none';
    }
    const form = document.getElementById('formNewAppointment');
    if (form) {
        delete form.dataset.editAppointmentId;
        form.reset();
        const header = document.querySelector('#appointmentModal .modal-header div h3');
        if (header) header.textContent = 'Novo Agendamento';
        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) submitBtn.textContent = 'Agendar';
        updateSelectedProfessionalDetails();
    }
}

function switchTab(tabKey) {
    const tabs = document.querySelectorAll('.tab-content');
    const buttons = document.querySelectorAll('.nav-link');

    tabs.forEach(tab => tab.classList.toggle('active', tab.id === tabKey));
    buttons.forEach(button => button.classList.toggle('active', button.dataset.tab === tabKey));
}

function parseAppointmentDate(dateString) {
    if (!dateString) {
        return new Date(NaN);
    }

    const normalized = String(dateString).replace(' ', 'T');
    const datePart = normalized.split('T')[0];
    const [year, month, day] = datePart.split('-').map(Number);
    return new Date(year, month - 1, day);
}

function formatDate(dateString) {
    if (!dateString) return '--';
    const normalized = String(dateString).replace(' ', 'T');
    const datePart = normalized.split('T')[0];
    const [year, month, day] = datePart.split('-');
    return `${day}/${month}/${year}`;
}

function getAppointmentDateChunks(dateString) {
    const date = parseAppointmentDate(dateString);
    if (Number.isNaN(date.getTime())) {
        return { day: '--', month: '--' };
    }

    const day = String(date.getDate()).padStart(2, '0');
    const month = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
    return { day, month };
}

function getAppointmentTime(dateString) {
    if (!dateString) return '--:--';
    const str = String(dateString);
    // Try ISO format with time
    const timeMatch = str.match(/T?(\d{2}:\d{2})(:?\d{2})?/);
    if (timeMatch) {
        return timeMatch[1];
    }
    // Try space separated datetime
    const parts = str.split(' ');
    if (parts.length > 1 && parts[1].match(/\d{2}:\d{2}/)) return parts[1].slice(0,5);
    return '--:--';
}

function formatProfessionalListForChat(professionals) {
    return professionals
        .map((professional, index) => `${index + 1}. ${professional.name} - ${professional.especialidade} (${professional.unidade || 'Unidade a confirmar'})`)
        .join('\n');
}

function parseDateFromMessage(message) {
    const normalizedMessage = normalizeText(message);

    if (normalizedMessage.includes('amanha')) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().slice(0, 10);
    }

    const isoMatch = message.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoMatch) {
        return isoMatch[0];
    }

    const brMatch = message.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    if (brMatch) {
        const day = brMatch[1].padStart(2, '0');
        const month = brMatch[2].padStart(2, '0');
        return `${brMatch[3]}-${month}-${day}`;
    }

    return '';
}

function isValidAppointmentDate(dateString) {
    if (!dateString) return false;

    const date = parseAppointmentDate(dateString);
    if (Number.isNaN(date.getTime())) return false;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
}

function formatDateTime(date = new Date()) {
    const parsed = typeof date === 'string' ? parseAppointmentDate(date) : date;
    if (Number.isNaN(parsed.getTime())) {
        return String(date);
    }
    return parsed.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getAppointmentCards() {
    return Array.from(document.querySelectorAll('.appointment-card'));
}

function loadRegisteredProfessionals() {
    return getAvailableProfessionals().filter(isAvailableRegisteredDoctor);
}

function isAvailableRegisteredDoctor(professional) {
    if (!professional || !professional.name || !professional.role || !professional.registry) {
        return false;
    }

    const registry = String(professional.registry).trim().toUpperCase();
    const isDemoProfessional = DEMO_PROFESSIONAL_REGISTRIES.includes(registry);
    const normalizedRegistry = registry.replace(/^CRM\s*/i, '').replace(/[\s-]/g, '');
    const isDoctorRegistry = registry.includes('CRM') || /^[A-Z0-9]{4,7}$/.test(normalizedRegistry);
    const status = String(professional.status || '').toLowerCase();
    const isAvailable = ['ativo', 'trabalhando', 'active'].includes(status);

    return isDoctorRegistry && isAvailable && !isDemoProfessional;
}

function getProfessionalByRegistry(registryOrId) {
    const normalized = String(registryOrId || '').trim();
    return loadRegisteredProfessionals().find(professional => 
        String(professional.id) === normalized || professional.registry === normalized
    ) || null;
}

function updateSelectedProfessionalDetails() {
    const professionalSelect = document.getElementById('modalProfessional');
    const specialtyInput = document.getElementById('modalSpec');
    const unitInput = document.getElementById('modalUnit');

    if (!professionalSelect || !specialtyInput || !unitInput) return;

    const selectedProfessional = getProfessionalByRegistry(professionalSelect.value);

    specialtyInput.value = selectedProfessional?.role || selectedProfessional?.especialidade || '';
    unitInput.value = selectedProfessional?.unit || selectedProfessional?.unidade || '';
}

function getTodayInputValue() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function isPastDate(dateValue) {
    if (!dateValue) return false;
    const selectedDate = new Date(dateValue);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    selectedDate.setHours(0, 0, 0, 0);
    return selectedDate < today;
}

function populateProfessionalOptions() {
    const professionalSelect = document.getElementById('modalProfessional');
    if (!professionalSelect) return;

    const professionals = loadRegisteredProfessionals();
    const currentValue = professionalSelect.value;

    professionalSelect.innerHTML = '<option value="">Selecione um profissional...</option>';

    if (!professionals.length) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'Nenhum médico cadastrado disponível';
        option.disabled = true;
        professionalSelect.appendChild(option);
        updateSelectedProfessionalDetails();
        return;
    }

    professionals.forEach(professional => {
        const option = document.createElement('option');
        option.value = professional.id;
        option.textContent = professional.name;
        professionalSelect.appendChild(option);
    });

    if (professionals.some(professional => String(professional.id) === currentValue)) {
        professionalSelect.value = currentValue;
    }

    updateSelectedProfessionalDetails();
}

function populateSearchFilters() {
    const specialtySelect = document.getElementById('searchSpecialty');
    const unitSelect = document.getElementById('searchHospital');
    if (!specialtySelect || !unitSelect) return;

    const professionals = availableProfessionals;
    const specialties = Array.from(new Set(professionals.map(professional => professional.especialidade).filter(Boolean))).sort();
    const units = Array.from(new Set(professionals.map(professional => professional.unidade).filter(Boolean))).sort();

    specialtySelect.innerHTML = '<option value="">Todas as areas</option>';
    specialties.forEach(specialty => {
        const option = document.createElement('option');
        option.value = specialty;
        option.textContent = specialty;
        specialtySelect.appendChild(option);
    });

    unitSelect.innerHTML = '<option value="">Todas as unidades</option>';
    units.forEach(unit => {
        const option = document.createElement('option');
        option.value = unit;
        option.textContent = unit;
        unitSelect.appendChild(option);
    });
}

function getAppointmentData() {
    if (!patientAppointmentsLoaded) {
        return [];
    }

    return patientAppointments
        .slice()
        .sort((first, second) => parseAppointmentDate(first.date) - parseAppointmentDate(second.date));
}

function getPatientName() {
    return user?.name || localStorage.getItem('patientName') || 'Paciente';
}

function loadStoredConversations() {
    try {
        const raw = localStorage.getItem(PATIENT_MESSAGES_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.error('Erro ao carregar conversas:', error);
        return {};
    }
}

function saveStoredConversations(conversations) {
    localStorage.setItem(PATIENT_MESSAGES_STORAGE_KEY, JSON.stringify(conversations));
}

function escapeHTML(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizeText(value) {
    return String(value)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// Os contatos de profissional vem do backend: sao exatamente aqueles com quem
// o paciente compartilha um atendimento. Antes eram derivados de um campo
// `appointment.contactKey` que nunca era preenchido.
function getMessageContacts() {
    const professionals = professionalContacts.map(contact => ({
        key: `pro-${contact.profileId}`,
        profileId: contact.profileId,
        name: contact.name || 'Profissional',
        specialty: contact.specialty || 'Especialidade nao informada',
        hospital: contact.unit || 'Unidade nao informada',
        unreadCount: Number(contact.unreadCount || 0),
        type: 'professional'
    }));

    return [CHATBOT_CONTACT, ...professionals];
}

function createInitialBotConversation() {
    return [
        {
            sender: 'bot',
            content: `Ola, ${getPatientName()}. Sou a Assistente Conecta. Posso te ajudar com agendamentos, preparo para consultas, documentos, responsaveis e orientacoes gerais do portal.`,
            timestamp: formatDateTime()
        }
    ];
}

function ensureConversationExists(contactKey) {
    if (contactKey !== CHATBOT_CONTACT.key) return [];

    const conversations = loadStoredConversations();
    if (!Array.isArray(conversations[contactKey]) || conversations[contactKey].length === 0) {
        conversations[contactKey] = createInitialBotConversation();
        saveStoredConversations(conversations);
    }

    return conversations[contactKey];
}

function getActiveContact() {
    return getMessageContacts().find(contact => contact.key === activeChatContactKey) || null;
}

/** Carrega contatos reais do backend e reaproveita a conversa ativa. */
async function loadProfessionalContacts() {
    try {
        professionalContacts = await fetchContacts();
    } catch (error) {
        console.error('Erro ao carregar contatos de mensagens:', error);
        professionalContacts = [];
    }

    renderMessageContacts();
    renderActiveConversation();
}

/** Abre a conversa com um profissional: historico via REST + sala via socket. */
async function openProfessionalConversation(contact) {
    const abertura = ++aberturaConversaAtual;
    const chave = Number(contact.profileId);

    // Mostra de imediato o historico ja carregado antes; "carregando" so
    // aparece em conversa aberta pela primeira vez.
    const emCache = historicoPorProfissional.get(chave);
    activeConversationMessages = emCache ? emCache.slice() : [];
    estadoHistoricoConversa = emCache ? 'ok' : 'carregando';
    erroHistoricoConversa = '';
    renderActiveConversation();

    const conversation = await fetchConversation(contact.profileId);

    // O usuario ja trocou de conversa: descarta a resposta atrasada.
    if (abertura !== aberturaConversaAtual) return;

    if (conversation.ok) {
        historicoPorProfissional.set(chave, conversation.messages);
        activeConversationMessages = conversation.messages.slice();
        estadoHistoricoConversa = 'ok';
    } else {
        // Falha nao esvazia a tela: mantem o que ja havia sido carregado.
        estadoHistoricoConversa = emCache ? 'ok' : 'erro';
        erroHistoricoConversa = conversation.message;
        console.warn('Falha ao carregar a conversa:', conversation.message);
    }

    if (chatClient) {
        const joinResult = await chatClient.join(contact.profileId);
        if (abertura !== aberturaConversaAtual) return;
        if (!joinResult.ok) {
            console.warn('Nao foi possivel entrar na conversa:', joinResult.message);
        }
    }

    // Ao abrir, as mensagens recebidas ficam lidas no servidor.
    const target = professionalContacts.find(item => item.profileId === contact.profileId);
    if (target) target.unreadCount = 0;

    renderMessageContacts();
    renderActiveConversation();
}

/** Mantem o cache de historico alinhado com o que esta na tela. */
function registrarNoHistoricoProfissional(profileId, message) {
    const chave = Number(profileId);
    const atual = historicoPorProfissional.get(chave) || [];
    if (atual.some(item => item.id === message.id)) return;
    historicoPorProfissional.set(chave, atual.concat(message));
}

function initChatClient() {
    if (chatClient) return;

    chatClient = createChatClient({
        onMessage: (message) => {
            const contact = getActiveContact();
            if (!contact || contact.type !== 'professional') return;

            // Ignora eco de mensagem que ja esta na lista (envio otimista).
            if (activeConversationMessages.some(item => item.id === message.id)) return;

            activeConversationMessages.push(message);
            registrarNoHistoricoProfissional(contact.profileId, message);
            renderActiveConversation();
        },
        onNotification: (notice) => {
            const target = professionalContacts.find(
                item => Number(item.profileId) === Number(notice.fromProfileId)
            );

            const active = getActiveContact();
            const isActiveConversation = active?.type === 'professional'
                && Number(active.profileId) === Number(notice.fromProfileId);

            if (target && !isActiveConversation) {
                target.unreadCount = Number(target.unreadCount || 0) + 1;
                renderMessageContacts();
            }
        },
        onStatus: (state, detail) => {
            chatConnectionStatus = state;
            if (state === 'erro') console.warn('Chat:', detail);
            updateChatStatusPill();
        }
    });

    chatClient.connect();
}

function updateChatStatusPill() {
    const pill = document.querySelector('.chat-status-pill');
    if (!pill) return;

    const contact = getActiveContact();

    if (!contact || contact.type === 'bot') {
        pill.textContent = 'Online';
        return;
    }

    pill.textContent = chatConnectionStatus === 'conectado' ? 'Online' : 'Reconectando...';
}

// buildAiReply foi removida: as respostas de profissional eram simuladas no
// proprio navegador. Agora quem responde e o medico, pelo painel dele.

function handleChatbotScheduling(userMessage) {
    const professionals = availableProfessionals;
    const normalizedMessage = normalizeText(userMessage);

    if (!chatbotScheduleDraft && !isScheduleIntent(userMessage)) {
        return null;
    }

    if (!professionals.length) {
        chatbotScheduleDraft = null;
        return 'No momento nao ha medicos cadastrados disponiveis para agendamento. Assim que a empresa cadastrar medicos ativos, eles aparecerao para agendar aqui no chat.';
    }

    if (!chatbotScheduleDraft) {
        chatbotScheduleDraft = { step: 'professional' };
        return `Claro, vamos agendar por aqui. Escolha o medico pelo numero:\n${formatProfessionalListForChat(professionals)}`;
    }

    if (normalizedMessage.includes('cancelar') || normalizedMessage.includes('sair')) {
        chatbotScheduleDraft = null;
        return 'Tudo bem, cancelei o agendamento pelo chat. Quando quiser tentar novamente, escreva "agendar consulta".';
    }

    if (chatbotScheduleDraft.step === 'professional') {
        const selectedIndex = Number((userMessage.match(/\d+/) || [])[0]) - 1;
        const selectedProfessional = professionals[selectedIndex] || professionals.find(professional =>
            normalizeText(professional.name).includes(normalizedMessage) ||
            normalizeText(professional.especialidade).includes(normalizedMessage)
        );

        if (!selectedProfessional) {
            return `Nao encontrei esse medico na lista. Responda com o numero do profissional:\n${formatProfessionalListForChat(professionals)}`;
        }

        chatbotScheduleDraft = {
            step: 'date',
            professionalRegistry: selectedProfessional.crm
        };

        return `Perfeito. Para ${selectedProfessional.name} - ${selectedProfessional.especialidade}, qual data voce deseja? Use DD/MM/AAAA, por exemplo 20/05/2026.`;
    }

    if (chatbotScheduleDraft.step === 'date') {
        const selectedProfessional = getProfessionalByRegistry(chatbotScheduleDraft.professionalRegistry);
        const date = parseDateFromMessage(userMessage);

        if (!selectedProfessional) {
            chatbotScheduleDraft = null;
            return 'Esse medico nao esta mais disponivel. Escreva "agendar consulta" para iniciar novamente.';
        }

        if (!isValidAppointmentDate(date)) {
            return 'Nao consegui entender a data ou ela esta no passado. Envie no formato DD/MM/AAAA, por exemplo 20/05/2026.';
        }

        const created = addAppointmentToDashboard(selectedProfessional, date);
        chatbotScheduleDraft = null;

        if (!created) {
            return 'Nao consegui criar o agendamento agora. Tente novamente pela aba Agendamentos.';
        }

        return `Consulta agendada com sucesso para ${formatDate(date)} com ${selectedProfessional.name}, em ${selectedProfessional.unit || 'Unidade a confirmar'}. Ja coloquei na area de consultas agendadas.`;
    }

    chatbotScheduleDraft = null;
    return null;
}

function buildChatbotReply(userMessage) {
    const normalizedMessage = normalizeText(userMessage);
    const appointments = getAppointmentData();
    const professionals = availableProfessionals;

    const schedulingReply = handleChatbotScheduling(userMessage);
    if (schedulingReply) {
        return schedulingReply;
    }

    if (normalizedMessage.includes('oi') || normalizedMessage.includes('ola') || normalizedMessage.includes('bom dia') || normalizedMessage.includes('boa tarde') || normalizedMessage.includes('boa noite')) {
        return 'Ola. Eu posso te ajudar com agendamentos, consultas marcadas, preparo, documentos, responsaveis e uso do portal. Me diga o que voce precisa fazer agora.';
    }

    if (normalizedMessage.includes('emergencia') || normalizedMessage.includes('urgente') || normalizedMessage.includes('falta de ar') || normalizedMessage.includes('dor forte') || normalizedMessage.includes('desmaio') || normalizedMessage.includes('sangramento')) {
        return 'Se for uma urgencia, procure atendimento imediato na unidade de emergencia mais proxima ou acione o servico de emergencia da sua regiao. O chatbot nao substitui avaliacao medica em situacoes graves.';
    }

    if (normalizedMessage.includes('agendar') || normalizedMessage.includes('marcar') || normalizedMessage.includes('consulta nova')) {
        if (!professionals.length) {
            return 'No momento nao ha medicos cadastrados disponiveis para agendamento. Assim que a empresa cadastrar medicos ativos, eles aparecerao em Agendamentos > Novo Agendamento.';
        }

        const specialties = Array.from(new Set(professionals.map(professional => professional.especialidade))).slice(0, 4).join(', ');
        return `Temos ${professionals.length} medico(s) disponivel(is)${specialties ? `, incluindo ${specialties}` : ''}. Escreva "agendar consulta" para eu marcar pelo chat.`;
    }

    if (normalizedMessage.includes('proximo') || normalizedMessage.includes('minhas consultas') || normalizedMessage.includes('agendamento') || normalizedMessage.includes('horario')) {
        if (!appointments.length) {
            return 'Voce ainda nao possui consultas agendadas. Para marcar uma, va em Agendamentos e clique em Novo Agendamento.';
        }

        const nextAppointment = appointments[0];
        return `Sua proxima consulta esta marcada para ${formatDate(nextAppointment.date)} com ${nextAppointment.doctor}, em ${nextAppointment.hospital}, na especialidade ${nextAppointment.specialty}.`;
    }

    if (normalizedMessage.includes('desmarcar') || normalizedMessage.includes('cancelar') || normalizedMessage.includes('remarcar')) {
        return 'Para desmarcar, abra Agendamentos e clique em Desmarcar na consulta desejada. O sistema permite cancelar apenas com no minimo 2 semanas de antecedencia.';
    }

    if (normalizedMessage.includes('documento') || normalizedMessage.includes('levar') || normalizedMessage.includes('exame') || normalizedMessage.includes('preparo')) {
        return 'Para a consulta, leve documento com foto, CPF, carteirinha do plano se houver, exames recentes e receitas em uso. Se a consulta tiver preparo especifico, confirme com a unidade antes do atendimento.';
    }

    if (normalizedMessage.includes('responsavel') || normalizedMessage.includes('autorizado') || normalizedMessage.includes('permissao')) {
        return 'Voce pode gerenciar responsaveis na aba Responsaveis. La e possivel adicionar contatos autorizados e definir permissoes como ver agendamentos, registros e enviar mensagens.';
    }

    if (normalizedMessage.includes('cpf') || normalizedMessage.includes('perfil') || normalizedMessage.includes('meus dados') || normalizedMessage.includes('cadastro')) {
        return 'Seus dados principais ficam em Meu Perfil. Confira nome, CPF e responsavel cadastrado. Para alterar informacoes sensiveis, procure o suporte da unidade responsavel.';
    }

    if (normalizedMessage.includes('medico') || normalizedMessage.includes('profissional') || normalizedMessage.includes('especialidade')) {
        if (!professionals.length) {
            return 'Ainda nao ha medicos cadastrados disponiveis no sistema. Quando houver, eles aparecerao em Buscar Atendimento e no modal de Novo Agendamento.';
        }

        return `Encontrei ${professionals.length} medico(s) disponivel(is). Voce pode ver as especialidades em Buscar Atendimento ou iniciar um agendamento pela aba Agendamentos.`;
    }

    if (normalizedMessage.includes('obrigad')) {
        return 'Por nada. Quando precisar, me chame por aqui e eu te ajudo a navegar pelo portal.';
    }

    return 'Entendi. Posso te ajudar com: agendar consulta, ver proximos agendamentos, saber o que levar, desmarcar consulta, gerenciar responsaveis ou conferir dados do perfil. Escreva uma dessas opcoes para eu te orientar.';
}

function isScheduleIntent(message) {
    const normalizedMessage = normalizeText(message);
    return normalizedMessage.includes('agendar') ||
        normalizedMessage.includes('marcar') ||
        normalizedMessage.includes('consulta nova');
}

function renderMessageContacts() {
    const contactsContainer = document.getElementById('messageContactsList');
    if (!contactsContainer) return;

    const contacts = getMessageContacts();

    if (!contacts.length) {
        contactsContainer.innerHTML = `
            <div class="chat-contacts-empty">
                <i class="ph ph-user-list"></i>
                <p>Voce ainda nao possui profissionais vinculados para conversar.</p>
            </div>
        `;
        activeChatContactKey = '';
        renderActiveConversation();
        return;
    }

    if (!contacts.some(contact => contact.key === activeChatContactKey)) {
        activeChatContactKey = contacts[0].key;
    }

    contactsContainer.innerHTML = '';

    contacts.forEach(contact => {
        ensureConversationExists(contact.key);

        const unread = Number(contact.unreadCount || 0);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `chat-contact-card${contact.key === activeChatContactKey ? ' active' : ''}`;
        button.innerHTML = `
            <strong>${escapeHTML(contact.name)}${unread ? ` <span class="chat-unread-badge">${unread}</span>` : ''}</strong>
            <span>${escapeHTML(contact.specialty)}</span>
            <small>${escapeHTML(contact.hospital)}</small>
        `;
        button.addEventListener('click', () => {
            activeChatContactKey = contact.key;
            renderMessageContacts();

            if (contact.type === 'professional') {
                openProfessionalConversation(contact);
            } else {
                activeConversationMessages = [];
                if (chatClient) chatClient.leave();
                renderActiveConversation();
            }
        });
        contactsContainer.appendChild(button);
    });
}

function renderActiveConversation() {
    const messagesList = document.getElementById('chatMessagesList');
    const contactName = document.getElementById('chatContactName');
    const contactMeta = document.getElementById('chatContactMeta');
    const messageInput = document.getElementById('messageInput');
    const sendMessageButton = document.getElementById('sendMessageButton');
    const quickActions = document.getElementById('chatbotQuickActions');

    if (!messagesList || !contactName || !contactMeta || !messageInput || !sendMessageButton) return;

    const contact = getActiveContact();

    if (!contact) {
        contactName.textContent = CHATBOT_CONTACT.name;
        contactMeta.textContent = 'Chatbot de apoio ao paciente.';
        messageInput.value = '';
        messageInput.disabled = false;
        sendMessageButton.disabled = false;
        if (quickActions) quickActions.innerHTML = '';
        messagesList.innerHTML = `
            <div class="chat-empty">
                <i class="ph ph-chat-circle-dots"></i>
                <p>Envie uma mensagem para iniciar o atendimento virtual.</p>
            </div>
        `;
        return;
    }

    contactName.textContent = contact.name;
    contactMeta.textContent = contact.type === 'bot'
        ? 'Chatbot de apoio ao paciente. Para urgencias, procure atendimento imediato.'
        : `${contact.specialty} - ${contact.hospital}`;
    messageInput.disabled = false;
    sendMessageButton.disabled = false;
    messagesList.innerHTML = '';

    // O chatbot continua local; a conversa com profissional vem do backend.
    const bubbles = contact.type === 'bot'
        ? ensureConversationExists(contact.key).map(message => ({
            mine: message.sender === 'patient',
            author: message.sender === 'patient' ? getPatientName() : contact.name,
            content: message.content,
            timestamp: message.timestamp
        }))
        : activeConversationMessages.map(message => ({
            mine: message.senderProfile === 'paciente',
            author: message.senderProfile === 'paciente' ? getPatientName() : contact.name,
            content: message.content,
            timestamp: formatMessageTime(message.createdAt)
        }));

    if (!bubbles.length) {
        // "Carregando" e "falhou" precisam ser visualmente diferentes de "nao
        // ha mensagens" - senao um erro passa por historico apagado.
        const estadoDoProfissional = contact.type === 'professional' ? estadoHistoricoConversa : 'ok';

        if (estadoDoProfissional === 'carregando') {
            messagesList.innerHTML = `
                <div class="chat-empty">
                    <i class="ph ph-spinner-gap"></i>
                    <p>Carregando conversa...</p>
                </div>
            `;
        } else if (estadoDoProfissional === 'erro') {
            messagesList.innerHTML = `
                <div class="chat-empty">
                    <i class="ph ph-warning-circle"></i>
                    <p>${escapeHTML(erroHistoricoConversa || 'Nao foi possivel carregar a conversa.')}</p>
                </div>
            `;
        } else {
            messagesList.innerHTML = `
                <div class="chat-empty">
                    <i class="ph ph-chat-circle-dots"></i>
                    <p>Nenhuma mensagem ainda. Escreva a primeira.</p>
                </div>
            `;
        }
    }

    bubbles.forEach(bubbleData => {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${bubbleData.mine ? 'patient' : 'professional'}`;
        bubble.innerHTML = `
            <div>${escapeHTML(bubbleData.content)}</div>
            <span class="chat-bubble-meta">${escapeHTML(bubbleData.author)} - ${escapeHTML(bubbleData.timestamp)}</span>
        `;
        messagesList.appendChild(bubble);
    });

    renderChatbotQuickActions(contact);
    updateChatStatusPill();
    messagesList.scrollTop = messagesList.scrollHeight;
}

function renderChatbotQuickActions(contact) {
    const quickActions = document.getElementById('chatbotQuickActions');
    const messageInput = document.getElementById('messageInput');
    if (!quickActions || !messageInput) return;

    if (contact.type !== 'bot') {
        quickActions.innerHTML = '';
        return;
    }

    quickActions.innerHTML = CHATBOT_QUICK_ACTIONS.map(action => `
        <button type="button" class="chatbot-chip" data-message="${escapeHTML(action)}">${escapeHTML(action)}</button>
    `).join('');

    quickActions.querySelectorAll('.chatbot-chip').forEach(button => {
        button.addEventListener('click', () => {
            const message = button.dataset.message || '';
            messageInput.value = '';
            sendPatientMessage(message);
        });
    });
}

function appendMessageToConversation(contactKey, message) {
    const conversations = loadStoredConversations();
    const currentMessages = Array.isArray(conversations[contactKey]) ? conversations[contactKey] : [];
    currentMessages.push(message);
    conversations[contactKey] = currentMessages;
    saveStoredConversations(conversations);
}

async function sendPatientMessage(content) {
    const contact = getActiveContact();
    if (!contact) return;

    // Chatbot: fluxo local, com resposta simulada.
    if (contact.type === 'bot') {
        appendMessageToConversation(contact.key, {
            sender: 'patient',
            content,
            timestamp: formatDateTime()
        });

        renderActiveConversation();

        window.setTimeout(() => {
            appendMessageToConversation(contact.key, {
                sender: 'bot',
                content: buildChatbotReply(content),
                timestamp: formatDateTime()
            });
            renderActiveConversation();
        }, 900);

        return;
    }

    // Profissional: envia pelo socket (ou REST se o socket estiver fora) e deixa
    // o servidor persistir. A bolha so aparece depois da confirmacao.
    const result = chatClient
        ? await chatClient.send(contact.profileId, content)
        : { ok: false, message: 'Chat indisponivel no momento.' };

    if (!result.ok) {
        await showPopup(result.message || 'Nao foi possivel enviar a mensagem.');
        return;
    }

    if (result.message && !activeConversationMessages.some(item => item.id === result.message.id)) {
        activeConversationMessages.push(result.message);
        registrarNoHistoricoProfissional(contact.profileId, result.message);
    }

    renderActiveConversation();
}

function renderOverviewAppointments() {
    const tableBody = document.getElementById('overviewAppointmentsTable');
    if (!tableBody) return;

    const appointments = getAppointmentData();
    tableBody.innerHTML = '';

    if (!appointments.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="4">Nenhum agendamento encontrado.</td>
            </tr>
        `;
        return;
    }

    appointments.slice(0, 4).forEach(appointment => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHTML(appointment.specialty)}</td>
            <td>${escapeHTML(appointment.doctor)}</td>
            <td>${escapeHTML(appointment.hospital)}</td>
            <td>${escapeHTML(formatDate(appointment.date))}</td>
        `;
        tableBody.appendChild(row);
    });
}

function updateOverviewCards() {
    const appointments = getAppointmentData();
    const totalAppointments = document.getElementById('totalAppointments');
    const nextAppointmentDate = document.getElementById('nextAppointmentDate');
    const specialtyCount = document.getElementById('specialtyCount');
    const favoriteHospital = document.getElementById('favoriteHospital');

    if (totalAppointments) {
        totalAppointments.innerText = appointments.length;
    }

    if (nextAppointmentDate) {
        nextAppointmentDate.innerText = appointments.length ? formatDateTime(appointments[0].date) : '--';
    }

    if (specialtyCount) {
        specialtyCount.innerText = new Set(appointments.map(appointment => appointment.specialty)).size;
    }

    if (favoriteHospital) {
        favoriteHospital.innerText = appointments.length ? appointments[0].hospital : 'Nenhum';
    }
}

function getDayName(dateString) {
    const date = parseAppointmentDate(dateString);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
}

function createAppointmentCardElement(appointment) {
    const { day, month } = getAppointmentDateChunks(appointment.date);
    const timeStr = getAppointmentTime(appointment.date);
    const doctorLabel = appointment.doctor || '';
    const card = document.createElement('div');
    card.className = 'appointment-card appointment-item';
    card.dataset.id = appointment.id;
    card.dataset.date = appointment.date;
    card.dataset.specialty = appointment.specialty;
    card.dataset.doctor = appointment.doctor;
    card.dataset.hospital = appointment.hospital;
    card.innerHTML = `
        <div class="appointment-time-block">
            <span class="time-hour">${escapeHTML(timeStr)}</span>
            <span class="time-sub">${escapeHTML(doctorLabel)}</span>
        </div>
        <div class="appointment-info">
            <div class="appointment-headline">
                <strong>${escapeHTML(appointment.doctor)}</strong>
                <span class="specialty-badge">${escapeHTML(appointment.specialty)}</span>
            </div>
            <div class="appointment-details">
                <span>${escapeHTML(appointment.hospital)}</span>
                <span class="date-label">${escapeHTML(formatDate(appointment.date))}</span>
            </div>
            <div class="card-actions">
                <button class="btn-secondary btn-reschedule" type="button">Buscar outro horario</button>
                <button class="btn-danger btn-cancel" type="button">Desmarcar</button>
            </div>
        </div>
    `;

    // Attach event listeners instead of inline onclick to enable reschedule behavior
    const rescheduleBtn = card.querySelector('.btn-reschedule');
    if (rescheduleBtn) {
        rescheduleBtn.addEventListener('click', () => openRescheduleModal(appointment.id));
    }

    const cancelBtn = card.querySelector('.btn-cancel');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => cancelAppointment(cancelBtn));
    }
    return card;
}

function openRescheduleModal(appointmentId) {
    const appointment = (patientAppointments || []).find(a => String(a.id) === String(appointmentId));
    const form = document.getElementById('formNewAppointment');
    if (!form) return;

    // Preencher campos do modal com dados do agendamento selecionado
    document.getElementById('modalSpec').value = appointment?.specialty || '';
    document.getElementById('modalUnit').value = appointment?.hospital || '';
    document.getElementById('modalDate').value = appointment?.date ? String(appointment.date).slice(0,10) : '';
    // Reset profissional para permitir trocar se desejar
    document.getElementById('modalProfessional').value = '';

    form.dataset.editAppointmentId = appointmentId;
    const header = document.querySelector('#appointmentModal .modal-header div h3');
    if (header) header.textContent = 'Remarcar Agendamento';
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Remarcar';

    openModal();
}

function renderAppointmentsList() {
    const list = document.getElementById('appointmentsList');
    if (!list) return;

    list.innerHTML = '';
    const appointments = applyAppointmentsMonthFilter(getAppointmentData());

    if (!appointments.length) {
        const monthLabel = appointmentsMonthFilter ? formatMonthLabel(appointmentsMonthFilter) : 'mês selecionado';
        const message = document.createElement('div');
        message.className = 'empty-state';
        message.innerHTML = `
            <i class="ph ph-calendar-x"></i>
            <p>Voce nao possui consultas agendadas para ${escapeHTML(monthLabel)}.</p>
        `;
        list.appendChild(message);
        return;
    }

    // Group appointments by ISO date key YYYY-MM-DD
    const groupedAppointments = appointments.reduce((groups, appointment) => {
        const dateKey = String(appointment.date || '').split('T')[0] || 'unknown';
        if (!groups[dateKey]) groups[dateKey] = [];
        groups[dateKey].push(appointment);
        return groups;
    }, {});

    // Build a full month calendar based on the month picker
    const monthValue = appointmentsMonthFilter || getCurrentMonthValue();
    const [calYear, calMonth] = monthValue.split('-').map(Number);
    const firstOfMonth = new Date(calYear, calMonth - 1, 1);
    const firstWeekday = firstOfMonth.getDay(); // 0 (Sun) - 6 (Sat)
    const totalDays = new Date(calYear, calMonth, 0).getDate();

    const monthCalendar = document.createElement('div');
    monthCalendar.className = 'month-calendar';

    const monthTitle = document.createElement('div');
    monthTitle.className = 'month-title';
    monthTitle.textContent = formatMonthLabel(monthValue);
    monthCalendar.appendChild(monthTitle);

    const weekdays = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    const header = document.createElement('div');
    header.className = 'calendar-header';
    weekdays.forEach(w => {
        const el = document.createElement('div');
        el.className = 'weekday';
        el.textContent = w;
        header.appendChild(el);
    });
    monthCalendar.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    // Leading empty cells
    for (let i = 0; i < firstWeekday; i++) {
        const cell = document.createElement('div');
        cell.className = 'calendar-cell empty';
        grid.appendChild(cell);
    }

    // Day cells
    for (let day = 1; day <= totalDays; day++) {
        const dayStr = String(day).padStart(2, '0');
        const monthStr = String(calMonth).padStart(2, '0');
        const dateKey = `${calYear}-${monthStr}-${dayStr}`;
        const appts = groupedAppointments[dateKey] || [];

        const cell = document.createElement('div');
        cell.className = 'calendar-cell';

        const dayNum = document.createElement('div');
        dayNum.className = 'calendar-day-number';
        dayNum.textContent = day;
        cell.appendChild(dayNum);

        // Add up to 3 appointment items for compact view
        appts.slice(0, 4).forEach(appointment => {
            const ap = document.createElement('div');
            ap.className = 'calendar-appointment';
            ap.dataset.id = appointment.id || '';
            ap.dataset.date = appointment.date || '';

            const tspan = document.createElement('div');
            tspan.className = 'appt-time';
            tspan.textContent = getAppointmentTime(appointment.date);

            const title = document.createElement('div');
            title.className = 'appt-title';
            title.textContent = appointment.doctor || appointment.name || '';

            ap.appendChild(tspan);
            ap.appendChild(title);

            // Click opens detail popup with actions
            ap.addEventListener('click', (e) => {
                e.stopPropagation();
                showAppointmentDetail(appointment);
            });

            cell.appendChild(ap);
        });

        if (appts.length > 4) {
            const more = document.createElement('div');
            more.className = 'calendar-more';
            more.textContent = `+${appts.length - 4} mais`;
            cell.appendChild(more);
        }

        grid.appendChild(cell);
    }

    monthCalendar.appendChild(grid);

    const dayColumn = document.createElement('div');
    dayColumn.className = 'schedule-day-column';
    dayColumn.appendChild(monthCalendar);

    list.appendChild(dayColumn);
}

function showAppointmentDetail(appointment) {
    if (!appointment) return;
    const modal = document.createElement('div');
    modal.className = 'popup-modal';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.zIndex = '3000';

    const content = document.createElement('div');
    content.className = 'popup-content';
    content.style.backgroundColor = 'white';
    content.style.padding = '18px';
    content.style.borderRadius = '8px';
    content.style.textAlign = 'left';
    content.style.maxWidth = '420px';
    modal.appendChild(content);

    const title = document.createElement('h3');
    title.textContent = appointment.doctor || 'Profissional';
    title.style.margin = '0 0 6px 0';
    content.appendChild(title);

    const p1 = document.createElement('p');
    p1.textContent = `${getAppointmentTime(appointment.date)} — ${appointment.hospital || ''}`;
    p1.style.margin = '0 0 8px 0';
    content.appendChild(p1);

    const p2 = document.createElement('p');
    p2.textContent = appointment.specialty || '';
    p2.style.margin = '0 0 12px 0';
    p2.style.color = '#64748b';
    content.appendChild(p2);

    const btns = document.createElement('div');
    btns.style.display = 'flex';
    btns.style.gap = '8px';
    btns.style.justifyContent = 'flex-end';

    const resBtn = document.createElement('button');
    resBtn.className = 'btn-secondary';
    resBtn.type = 'button';
    resBtn.textContent = 'Remarcar';
    resBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openRescheduleModal(appointment.id);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-danger';
    delBtn.type = 'button';
    delBtn.textContent = 'Desmarcar';
    delBtn.addEventListener('click', async () => {
        document.body.removeChild(modal);
        await cancelAppointmentById(appointment.id, appointment.date);
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-secondary';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Fechar';
    closeBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    btns.appendChild(resBtn);
    btns.appendChild(delBtn);
    btns.appendChild(closeBtn);
    content.appendChild(btns);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            if (document.body.contains(modal)) document.body.removeChild(modal);
        }
    });

    document.body.appendChild(modal);
}

async function cancelAppointmentById(appointmentId, dateString) {
    if (!appointmentId) return;

    const appointmentDate = parseAppointmentDate(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffInTime = appointmentDate.getTime() - today.getTime();
    const diffInDays = Math.ceil(diffInTime / (1000 * 3600 * 24));

    if (diffInDays < 14) {
        await showPopup('Atencao: cancelamentos devem ser feitos com no minimo 2 semanas de antecedencia.');
        return;
    }

    const result = await showPopup('Tem certeza que deseja desmarcar esta consulta?', 'confirm');
    if (!result) return;

    const token = window.ConectaSession.getToken();
    if (!token) {
        await showPopup('Voce precisa estar autenticado para desmarcar esta consulta. Faça login novamente.');
        return;
    }

    if (!String(appointmentId).startsWith('local-')) {
        try {
            const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/appointments/${encodeURIComponent(appointmentId)}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const body = await response.json();
                await showPopup(body.message || 'Erro ao desmarcar a consulta.');
                return;
            }
        } catch (error) {
            console.error('Erro ao desmarcar agendamento:', error);
            await showPopup('Erro de conexao ao desmarcar a consulta.');
            return;
        }
    }

    if (patientAppointmentsLoaded) {
        patientAppointments = patientAppointments.filter(item => String(item.id) !== String(appointmentId));
    }
    refreshDashboard();
    await showPopup('Consulta removida com sucesso.');
}

function addAppointmentToDashboard(selectedProfessional, date) {
    const appointmentsList = document.getElementById('appointmentsList');
    if (!appointmentsList || !selectedProfessional || !date) return false;

    const specialty = selectedProfessional.role;
    const unit = selectedProfessional.unit || 'Unidade a confirmar';
    const newAppointment = {
        id: `local-${Date.now()}`,
        specialty,
        doctor: selectedProfessional.name,
        hospital: unit,
        date,
        status: 'pendente'
    };

    const appointmentCard = createAppointmentCardElement(newAppointment);
    appointmentCard.dataset.id = newAppointment.id;
    appointmentCard.dataset.date = newAppointment.date;
    appointmentCard.dataset.specialty = newAppointment.specialty;
    appointmentCard.dataset.doctor = newAppointment.doctor;
    appointmentCard.dataset.hospital = newAppointment.hospital;

    appointmentsList.prepend(appointmentCard);

    if (patientAppointmentsLoaded) {
        patientAppointments.unshift(newAppointment);
    }

    refreshDashboard();
    switchTab('appointments');
    return true;
}

function refreshDashboard() {
    populateSearchFilters();
    updateOverviewCards();
    renderOverviewAppointments();
    renderAppointmentsList();
    renderMessageContacts();
    renderActiveConversation();
    renderGuardians();
    renderSuggestions();
}

async function handleLogout() {
    const result = await showPopup('Deseja realmente sair?', 'confirm');
    if (result) {
        window.ConectaSession.clearSession();
        window.location.href = 'login-paciente.html?motivo=saiu';
    }
}

async function filterResults() {
    const specialty = document.getElementById('searchSpecialty')?.value || '';
    const hospital = document.getElementById('searchHospital')?.value || '';
    const plan = document.getElementById('searchPlan')?.value || '';
    const button = document.querySelector('.btn-search-filter');

    if (button) {
        button.innerHTML = '<i class="ph ph-spinner-gap"></i> Buscando...';
        button.disabled = true;
    }

    setTimeout(async () => {
        const description = [specialty || 'todas as areas', hospital || 'todos os hospitais', plan || 'todos os planos'].join(', ');
        await showPopup(`Filtro aplicado para ${description}.`);

        if (button) {
            button.innerHTML = '<i class="ph ph-magnifying-glass"></i> Filtrar';
            button.disabled = false;
        }
    }, 800);
}

async function cancelAppointment(button) {
    const card = button.closest('.appointment-card');
    if (!card) return;

    const dateString = card.getAttribute('data-date');
    if (!dateString) return;

    const appointmentDate = parseAppointmentDate(dateString);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffInTime = appointmentDate.getTime() - today.getTime();
    const diffInDays = Math.ceil(diffInTime / (1000 * 3600 * 24));

    if (diffInDays < 14) {
        await showPopup('Atencao: cancelamentos devem ser feitos com no minimo 2 semanas de antecedencia.');
        return;
    }

    const result = await showPopup('Tem certeza que deseja desmarcar esta consulta?', 'confirm');
    if (!result) return;

    const appointmentId = card.dataset.id;
    if (!appointmentId) {
        await showPopup('ID do agendamento nao encontrado.');
        return;
    }

    const token = window.ConectaSession.getToken();
    if (!token) {
        await showPopup('Voce precisa estar autenticado para desmarcar esta consulta. Faça login novamente.');
        return;
    }

    if (!String(appointmentId).startsWith('local-')) {
        try {
            const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/appointments/${encodeURIComponent(appointmentId)}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const body = await response.json();
                await showPopup(body.message || 'Erro ao desmarcar a consulta.');
                return;
            }
        } catch (error) {
            console.error('Erro ao desmarcar agendamento:', error);
            await showPopup('Erro de conexao ao desmarcar a consulta.');
            return;
        }
    }

    if (patientAppointmentsLoaded && appointmentId) {
        patientAppointments = patientAppointments.filter(item => String(item.id) !== String(appointmentId));
    }
    card.remove();
    refreshDashboard();
    await showPopup('Consulta removida com sucesso.');
}

document.addEventListener('DOMContentLoaded', async () => {
    const navButtons = document.querySelectorAll('.nav-link');
    navButtons.forEach(button => {
        button.addEventListener('click', () => switchTab(button.dataset.tab));
    });

    // Chat em tempo real: conecta o socket (JWT no handshake) e busca os
    // profissionais com quem o paciente tem atendimento.
    initChatClient();
    loadProfessionalContacts();
    loadAvailablePermissions();

    const overviewButton = document.getElementById('btnOverviewNewAppointment');
    if (overviewButton) {
        overviewButton.addEventListener('click', openModal);
    }

    const appointmentsButton = document.getElementById('btnGoAppointments');
    if (appointmentsButton) {
        appointmentsButton.addEventListener('click', () => switchTab('appointments'));
    }

    const appointmentsPrevMonth = document.getElementById('appointmentsPrevMonth');
    const appointmentsNextMonth = document.getElementById('appointmentsNextMonth');
    const appointmentsMonthPicker = document.getElementById('appointmentsMonthPicker');

    if (appointmentsPrevMonth) {
        appointmentsPrevMonth.addEventListener('click', () => changeAppointmentsMonth(-1));
    }
    if (appointmentsNextMonth) {
        appointmentsNextMonth.addEventListener('click', () => changeAppointmentsMonth(1));
    }
    if (appointmentsMonthPicker) {
        appointmentsMonthPicker.addEventListener('change', event => {
            updateAppointmentsMonthPicker(event.target.value);
        });
    }

    try {
        await loadUserInfo();
    } catch (error) {
        console.error('Erro ao inicializar dashboard do paciente:', error);
        loadPatientData();
        refreshDashboard();
    }
});

    const appointmentForm = document.getElementById('formNewAppointment');
    if (appointmentForm) {
        appointmentForm.addEventListener('submit', async event => {
            event.preventDefault();
            const date = document.getElementById('modalDate')?.value;
            const professionalId = document.getElementById('modalProfessional')?.value;
            const specialty = document.getElementById('modalSpec')?.value;
            const unit = document.getElementById('modalUnit')?.value;
            const time = document.getElementById('modalTime')?.value;
            const selectedProfessional = getProfessionalByRegistry(professionalId);
            const professionalCrm = String(selectedProfessional?.registry || '').trim();

            if (isPastDate(date)) {
                await showPopup('Não é possível agendar ou remarcar para uma data no passado. Escolha uma data atual ou futura.');
                return;
            }

            if (!date || !time) {
                await showPopup('Informe a data e o horário do agendamento.');
                return;
            }

            // Tentar criar ou atualizar agendamento no backend
            const token = window.ConectaSession.getToken();
            if (!token) {
                await showPopup('Voce precisa estar autenticado para agendar/remarcar. Faça login novamente.');
                return;
            }

            const editId = appointmentForm.dataset.editAppointmentId;
            try {
                if (editId) {
                    // Remarcar (atualizar) um agendamento existente
                    const url = `${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/appointments/${encodeURIComponent(editId)}`;
                    const bodyData = { date };
                    if (professionalCrm) bodyData.med_crm = professionalCrm;

                    const resp = await fetch(url, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(bodyData)
                    });

                    const body = await resp.json();
                    if (!resp.ok) {
                        await showPopup(body.message || 'Erro ao remarcar agendamento no servidor.');
                        return;
                    }

                    const updated = body || {
                        id: editId,
                        specialty,
                        doctor: selectedProfessional?.name || 'Profissional',
                        hospital: unit,
                        date,
                        status: 'pendente'
                    };

                    // Atualizar localmente
                    const idx = patientAppointments.findIndex(a => String(a.id) === String(editId));
                    if (idx >= 0) {
                        patientAppointments[idx] = updated;
                    } else {
                        patientAppointments.unshift(updated);
                    }

                    delete appointmentForm.dataset.editAppointmentId;
                    appointmentForm.reset();
                    updateSelectedProfessionalDetails();
                    closeModal();
                    refreshDashboard();
                    await showPopup(`Remarcacao realizada para ${formatDate(updated.date)}.`);
                } else {
                    // Criar novo agendamento
                    if (!selectedProfessional) {
                        await showPopup('Selecione um profissional que esteja cadastrado no sistema.');
                        return;
                    }

                    const resp = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/appointments`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({ med_crm: professionalCrm, date })
                    });

                    const body = await resp.json();
                    if (!resp.ok) {
                        await showPopup(body.message || 'Erro ao criar agendamento no servidor.');
                        return;
                    }

                    // Atualizar lista local com o registro retornado pelo servidor
                    const created = {
                        id: body.id || `remote-${Date.now()}`,
                        specialty: body.specialty || body.especialty || specialty,
                        doctor: body.doctorName || selectedProfessional.name,
                        hospital: body.unit || body.clinicName || unit,
                        date: body.appointmentDate || date,
                        status: body.status || 'pendente'
                    };

                    patientAppointments.unshift(created);
                    appointmentForm.reset();
                    updateSelectedProfessionalDetails();
                    closeModal();
                    refreshDashboard();
                    await showPopup(`Sucesso! Consulta com ${created.doctor} agendada para ${formatDate(created.date)}.`);
                }
            } catch (err) {
                console.error('Erro ao criar/remarcar agendamento:', err);
                await showPopup('Erro de conexao ao processar agendamento.');
            }
        });
    }

    const professionalSelect = document.getElementById('modalProfessional');
    if (professionalSelect) {
        professionalSelect.addEventListener('change', updateSelectedProfessionalDetails);
    }

    const messageForm = document.getElementById('messageForm');
    if (messageForm) {
        messageForm.addEventListener('submit', event => {
            event.preventDefault();

            const messageInput = document.getElementById('messageInput');
            const content = messageInput?.value.trim() || '';

            if (!content) return;

            sendPatientMessage(content);
            messageInput.value = '';
        });
    }

    const modal = document.getElementById('appointmentModal');
    if (modal) {
        modal.addEventListener('click', event => {
            if (event.target === modal) {
                closeModal();
            }
        });
    }

    const guardianModal = document.getElementById('guardianModal');
    if (guardianModal) {
        guardianModal.addEventListener('click', event => {
            if (event.target === guardianModal) {
                closeGuardianModal();
            }
        });
    }

    const guardianForm = document.getElementById('formNewGuardian');
    if (guardianForm) {
        guardianForm.addEventListener('submit', async event => {
            event.preventDefault();

                const name = document.getElementById('guardianName')?.value.trim();
                const relationship = document.getElementById('guardianRelationship')?.value;
                const email = document.getElementById('guardianEmail')?.value.trim();
                const password = document.getElementById('guardianPassword')?.value.trim();
                if (!password || password.length < 6) {
                    await showPopup('A senha deve ter pelo menos 6 caracteres.');
                    return;
                }

                if (!name || !relationship || !email || !password) {
                    await showPopup('Por favor, preencha todos os campos obrigatórios.');
                    return;
                }
            // Os valores agora sao ids da tabela `permissoes`.
            const permissions = Array.from(document.querySelectorAll('input[name="permissions"]:checked'))
                .map(checkbox => Number(checkbox.value))
                .filter(Number.isInteger);

            if (permissions.length === 0) {
                await showPopup('Selecione pelo menos uma permissão.');
                return;
            }

            const guardians = loadGuardians();
            const editIndex = guardianForm.dataset.editIndex;

            if (editIndex !== undefined && editIndex !== '') {
                // Atualizar responsável existente
                guardians[parseInt(editIndex)] = {
                    name,
                    relationship,
                    password,
                    email,
                    permissions,
                    dateAdded: guardians[parseInt(editIndex)].dateAdded
                };
                await showPopup(`Responsável ${name} atualizado com sucesso.`);
            } else {
                // Adicionar novo responsável
                const today = new Date().toLocaleDateString('pt-BR');
                const newGuardian = {
                    name,
                    relationship,
                    password,
                    email,
                    permissions,
                    dateAdded: today
                };

                // If user is authenticated, try to persist on server
                const token = window.ConectaSession.getToken();
                if (token) {
                    try {
                        const resp = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/guardians`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Authorization': `Bearer ${token}`
                            },
                            body: JSON.stringify({ name, relationship, email, password, permissions })
                        });

                        const body = await resp.json();
                        if (!resp.ok) {
                            await showPopup(body.message || 'Erro ao salvar responsável no servidor.');
                        } else {
                            // attach server id
                            newGuardian.id = body.id;
                        }
                    } catch (err) {
                        console.error('Erro ao salvar responsavel no servidor:', err);
                        await showPopup('Erro de conexão ao salvar responsável no servidor.');
                    }
                }

                guardians.push(newGuardian);
                await showPopup(`Responsável ${name} adicionado com sucesso.`);
            }

            saveGuardians(guardians);
            guardianForm.reset();
            delete guardianForm.dataset.editIndex;
            document.querySelector('.modal-header div h3').textContent = 'Adicionar Responsável';
            document.querySelector('button[type="submit"]').textContent = 'Adicionar Responsável';
            closeGuardianModal();
            renderGuardians();
        });
    }

function renderAppointmentsState() {
    const list = document.getElementById('appointmentsList');
    if (!list) return;

    const localCards = list.querySelectorAll('.appointment-card');
    const hasApiAppointments = patientAppointments && patientAppointments.length > 0;
    const emptyState = list.querySelector('.empty-state');

    if (localCards.length > 0 || hasApiAppointments) {
        if (emptyState) {
            emptyState.remove();
        }
        
        // O avatar agora e definido em loadPatientData/updatePatientAvatar, que
        // roda independente de o paciente ter consultas.

        // Atualizar responsável exibido no perfil quando disponível
        const profilePatientResponsible = document.getElementById('profilePatientResponsible');
        const responsible = user.responsible || localStorage.getItem('patientResponsible') || '';
        if (profilePatientResponsible) {
            profilePatientResponsible.textContent = responsible || '--';
        }
    }

    loadPatientData();
    updateAppointmentsMonthPicker(getCurrentMonthValue());
    Promise.all([fetchPatientAppointments(), fetchAvailableProfessionals()]).finally(() => {
        populateProfessionalOptions();
        refreshDashboard();
    });
}

window.openModal = openModal;
window.closeModal = closeModal;
window.switchTab = switchTab;
window.handleLogout = handleLogout;
window.filterResults = filterResults;
window.cancelAppointment = cancelAppointment;
window.openGuardianModal = openGuardianModal;
window.closeGuardianModal = closeGuardianModal;
window.removeGuardian = removeGuardian;
window.editGuardian = editGuardian;
window.renderGuardians = renderGuardians;
window.scrollToSpecialty = scrollToSpecialty;
window.openRescheduleModal = openRescheduleModal;