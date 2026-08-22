import { getUserProfile, getAvailableDoctors } from './api.js';
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
    'Qual e a minha proxima consulta?',
    'O que levar para a consulta?',
    'Como desmarcar uma consulta?',
    'Preciso de acessibilidade no atendimento',
    'Como cadastro um responsavel?'
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
// Responsaveis como vieram do servidor. As acoes de editar/remover trabalham por
// id a partir daqui, e nao mais pelo indice de um array do localStorage.
let patientGuardians = [];
// Resultado da aba "Buscar Atendimento". searchApplied distingue "ainda nao
// buscou" de "buscou e nao achou nada".
let searchResults = [];
let searchApplied = false;
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

        // Antes isto chamava getPatientAppointments() (rota /api/agendamentos),
        // que devolve as colunas cruas do banco: data_agendamento,
        // profissional_nome, profissional_especialidade. Só que todo o resto do
        // dashboard le .date/.doctor/.specialty/.hospital - dai o "undefined" nas
        // tabelas e o traco no lugar da data. fetchPatientAppointments() usa
        // /auth/patient/appointments (ja em camelCase, sem canceladas e ordenado
        // da mais proxima para a mais distante) e normaliza para esses nomes.
        await fetchPatientAppointments();

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
    const profilePatientCPF = document.getElementById('profilePatientCPF');
    const profileBirthDate = document.getElementById('profileBirthDate');
    const profilePatientResponsible = document.getElementById('profilePatientResponsible');
    const profileDisabilityType = document.getElementById('profileDisabilityType');
    const profilePreferredUnit = document.getElementById('profilePreferredUnit');
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profilePhone = document.getElementById('profilePhone');

    const name = user?.name || 'Paciente';

    if (patientHeaderName) {
        patientHeaderName.textContent = name;
    }

    // Subtitulo reflete o status real vindo de /auth/profile, em vez do texto
    // fixo "Paciente ativo" que estava no HTML.
    if (patientHeaderSubtitle) {
        patientHeaderSubtitle.textContent = describePatientStatus(user?.status);
    }

    updatePatientAvatar(name);

    // Campos so de leitura.
    if (profilePatientCPF) {
        profilePatientCPF.textContent = formatCPF(user?.cpf);
    }
    // O nome do responsavel agora vem de /auth/profile (JOIN com
    // paciente_responsavel). Antes o codigo lia user.responsible, campo que a
    // API nunca devolveu, e caia num sessionStorage que ninguem preenchia - por
    // isso o traco fixo.
    if (profilePatientResponsible) {
        profilePatientResponsible.textContent = user?.responsible || 'Nenhum responsável cadastrado';
    }

    // Campos editaveis.
    if (profileName) profileName.value = user?.name || '';
    if (profileEmail) profileEmail.value = user?.email || '';
    if (profilePhone) profilePhone.value = user?.telefone || '';
    // O input date exige exatamente YYYY-MM-DD, formato em que a API ja entrega.
    if (profileBirthDate) profileBirthDate.value = user?.data_nascimento || '';
    if (profileDisabilityType) profileDisabilityType.value = user?.tipo_deficiencia || '';

    if (profilePreferredUnit) {
        garantirOpcaoDeUnidade(profilePreferredUnit, user?.unidade_preferencia);
        profilePreferredUnit.value = user?.unidade_preferencia || '';
    }
}

/**
 * O select de unidade e preenchido por /auth/doctors/filters, que so lista
 * unidades com profissional ativo. Se a unidade salva do paciente nao estiver
 * mais nessa lista, o select cairia para vazio e um simples "salvar" apagaria a
 * preferencia sem o paciente perceber.
 */
function garantirOpcaoDeUnidade(select, unidade) {
    if (!select || !unidade) return;
    const jaExiste = Array.from(select.options).some(opcao => opcao.value === unidade);
    if (jaExiste) return;

    const option = document.createElement('option');
    option.value = unidade;
    option.textContent = unidade;
    select.appendChild(option);
}

/**
 * Envia apenas o que mudou em relacao ao perfil carregado. Mandar o objeto
 * inteiro faria um campo intocado sobrescrever alteracao feita em outro lugar.
 */
async function handleProfileSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');

    const atual = {
        name: user?.name || '',
        email: user?.email || '',
        telefone: user?.telefone || '',
        dataNascimento: user?.data_nascimento || '',
        tipoDeficiencia: user?.tipo_deficiencia || '',
        unidadePreferencia: user?.unidade_preferencia || ''
    };

    const novo = {
        name: document.getElementById('profileName')?.value.trim() || '',
        email: document.getElementById('profileEmail')?.value.trim() || '',
        telefone: document.getElementById('profilePhone')?.value.trim() || '',
        dataNascimento: document.getElementById('profileBirthDate')?.value || '',
        tipoDeficiencia: document.getElementById('profileDisabilityType')?.value || '',
        unidadePreferencia: document.getElementById('profilePreferredUnit')?.value || ''
    };

    if (!novo.name || novo.name.length < 3) {
        await showPopup('Informe seu nome completo (mínimo 3 caracteres).');
        return;
    }

    const alteracoes = {};
    Object.keys(novo).forEach(campo => {
        if (novo[campo] !== atual[campo]) alteracoes[campo] = novo[campo];
    });

    if (!Object.keys(alteracoes).length) {
        await showPopup('Nenhuma alteração para salvar.');
        return;
    }

    const token = window.ConectaSession.getToken();
    if (!token) {
        await showPopup('Sessão expirada. Faça login novamente.');
        return;
    }

    if (submitButton) submitButton.disabled = true;

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/profile`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(alteracoes)
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            const detalhe = Array.isArray(body.errors) && body.errors.length
                ? body.errors.map(issue => issue.message).join(' ')
                : '';
            await showPopup(detalhe || body.message || 'Não foi possível salvar o perfil.');
            return;
        }

        // A rota devolve o perfil ja atualizado, entao nao e preciso recarregar.
        user = body;
        if (user?.name) sessionStorage.setItem('patientName', String(user.name));
        loadPatientData();
        await showPopup('Perfil atualizado com sucesso.');
    } catch (error) {
        console.error('Erro ao salvar perfil:', error);
        await showPopup('Erro de conexão ao salvar o perfil.');
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

async function handleChangePasswordSubmit(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const submitButton = form.querySelector('button[type="submit"]');
    const currentPassword = document.getElementById('currentPassword')?.value || '';
    const newPassword = document.getElementById('newPassword')?.value || '';
    const confirmNewPassword = document.getElementById('confirmNewPassword')?.value || '';

    if (!currentPassword) {
        await showPopup('Informe sua senha atual.');
        return;
    }

    if (!isStrongPassword(newPassword)) {
        await showPopup('A nova senha deve ter 8+ caracteres, com maiúscula, minúscula, número e caractere especial.');
        return;
    }

    if (newPassword !== confirmNewPassword) {
        await showPopup('A confirmação não confere com a nova senha.');
        return;
    }

    if (newPassword === currentPassword) {
        await showPopup('A nova senha deve ser diferente da atual.');
        return;
    }

    const token = window.ConectaSession.getToken();
    if (!token) {
        await showPopup('Sessão expirada. Faça login novamente.');
        return;
    }

    if (submitButton) submitButton.disabled = true;

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/profile/password`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
            const detalhe = Array.isArray(body.errors) && body.errors.length
                ? body.errors.map(issue => issue.message).join(' ')
                : '';
            await showPopup(detalhe || body.message || 'Não foi possível alterar a senha.');
            return;
        }

        form.reset();
        await showPopup('Senha alterada com sucesso.');
    } catch (error) {
        console.error('Erro ao alterar senha:', error);
        await showPopup('Erro de conexão ao alterar a senha.');
    } finally {
        if (submitButton) submitButton.disabled = false;
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
    // Mesma chave usada para montar a grade, para que filtro e calendario nunca
    // discordem sobre a que mes a consulta pertence.
    return appointments.filter(appointment => getAppointmentDateKey(appointment.date).slice(0, 7) === appointmentsMonthFilter);
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
    if (!modal) return;

    // editGuardian() preenche o formulario e marca o editId antes de abrir; sem
    // esse marcador a abertura e um cadastro novo e o formulario volta ao zero.
    const form = document.getElementById('formNewGuardian');
    if (form && !form.dataset.editId) {
        resetGuardianForm();
    }

    modal.style.display = 'flex';
    if (typeof setupPasswordVisibilityToggles === 'function') setupPasswordVisibilityToggles();
    if (typeof setupPasswordRuleFeedback === 'function') setupPasswordRuleFeedback();
}

// Função para fechar modal de responsável
function closeGuardianModal() {
    const modal = document.getElementById('guardianModal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Limpa tambem o modo de edicao: fechar no meio de uma edicao nao pode
    // deixar o editId preso para a proxima abertura.
    resetGuardianForm();
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
                    // permissionIds/permissionNames passaram a vir da API. Antes
                    // este map descartava as permissoes, e por isso o card
                    // sempre dizia "Nenhuma permissão" mesmo com elas gravadas.
                    guardians = Array.isArray(data) ? data.map(g => ({
                        id: g.id,
                        name: g.name || g.nome || '',
                        cpf: g.cpf || '',
                        relationship: g.relationship || g.parentesco || '',
                        email: g.email || '',
                        permissions: Array.isArray(g.permissionIds) ? g.permissionIds.map(Number) : [],
                        permissionNames: Array.isArray(g.permissionNames) ? g.permissionNames : []
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

        patientGuardians = guardians;
        guardiansList.innerHTML = '';

        guardians.forEach((guardian) => {
        // Prefere os nomes ja resolvidos pela API; permissionLabelById so entra
        // quando os dados vieram do cache local.
        const permissionLabels = (guardian.permissionNames && guardian.permissionNames.length)
            ? guardian.permissionNames
            : (guardian.permissions || []).map(permissionLabelById);

        const card = document.createElement('div');
        card.className = 'guardian-card';
        card.innerHTML = `
            <div class="guardian-card-header">
                <div class="guardian-info">
                    <strong>${escapeHTML(guardian.name || '')}</strong>
                    <span>${escapeHTML(guardian.relationship || '')}</span>
                </div>
                <div class="guardian-actions">
                    <button class="btn-secondary" type="button" data-edit-guardian="${escapeHTML(String(guardian.id))}" aria-label="Editar responsável">
                        <i class="ph ph-pencil"></i>
                    </button>
                    <button class="btn-danger" type="button" data-remove-guardian="${escapeHTML(String(guardian.id))}" aria-label="Remover responsável">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
            <div class="guardian-details">
                <div class="guardian-detail">
                    <label>E-mail</label>
                    <p>${escapeHTML(guardian.email || '--')}</p>
                </div>
                <div class="guardian-detail">
                    <label>CPF</label>
                    <p>${escapeHTML(formatCPF(guardian.cpf))}</p>
                </div>
            </div>
            <div class="guardian-permissions">
                <div class="guardian-permissions-label">Permissões concedidas:</div>
                <div class="permissions-list">
                    ${permissionLabels.length
                        ? permissionLabels.map(label => `<span class="permission-badge"><i class="ph ph-check-circle"></i>${escapeHTML(label)}</span>`).join('')
                        : '<span class="permissions-empty">Nenhuma permissão concedida</span>'}
                </div>
            </div>
        `;

        card.querySelector('[data-edit-guardian]')?.addEventListener('click', () => editGuardian(guardian.id));
        card.querySelector('[data-remove-guardian]')?.addEventListener('click', () => removeGuardian(guardian.id));

        guardiansList.appendChild(card);
        });
    })();
}

function findGuardianById(id) {
    return patientGuardians.find(guardian => String(guardian.id) === String(id)) || null;
}

// Remover responsável - agora apaga no servidor. Antes so tirava do
// localStorage, entao o responsavel reaparecia no proximo carregamento.
async function removeGuardian(id) {
    const guardian = findGuardianById(id);
    if (!guardian) return;

    const confirmado = await showPopup(
        `Remover o responsável ${guardian.name}? Ele perderá o acesso aos seus dados.`,
        'confirm'
    );
    if (!confirmado) return;

    const token = window.ConectaSession.getToken();
    if (!token) {
        await showPopup('Sessão expirada. Faça login novamente.');
        return;
    }

    try {
        const resp = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/guardians/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            await showPopup(body.message || 'Não foi possível remover o responsável.');
            return;
        }

        await showPopup(`Responsável ${guardian.name} removido com sucesso.`);
        renderGuardians();
    } catch (error) {
        console.error('Erro ao remover responsável:', error);
        await showPopup('Erro de conexão ao remover o responsável.');
    }
}

// Editar responsável
function editGuardian(id) {
    const guardian = findGuardianById(id);
    if (!guardian) return;

    const form = document.getElementById('formNewGuardian');
    const modal = document.getElementById('guardianModal');
    if (!form || !modal) return;

    document.getElementById('guardianName').value = guardian.name || '';
    document.getElementById('guardianCPF').value = formatCPF(guardian.cpf);
    document.getElementById('guardianRelationship').value = guardian.relationship || '';
    document.getElementById('guardianEmail').value = guardian.email || '';

    const permissoesDoResponsavel = (guardian.permissions || []).map(String);
    form.querySelectorAll('input[name="permissions"]').forEach(checkbox => {
        checkbox.checked = permissoesDoResponsavel.includes(String(checkbox.value));
    });

    // Na edicao nao se troca a senha do responsavel: quem faz isso e ele, pelo
    // proprio login. O campo sai de cena e deixa de ser obrigatorio.
    const passwordField = document.getElementById('guardianPassword');
    const passwordGroup = passwordField?.closest('.input-group');
    if (passwordField) {
        passwordField.value = '';
        passwordField.required = false;
    }
    if (passwordGroup) passwordGroup.hidden = true;

    // O CPF identifica o responsavel e nao pode mudar numa edicao.
    document.getElementById('guardianCPF').readOnly = true;

    form.dataset.editId = String(guardian.id);

    // Estes seletores eram globais (document.querySelector) e pegavam o primeiro
    // modal/botao da pagina, que e o de agendamento. Agora sao presos ao modal
    // do responsavel.
    const title = modal.querySelector('.modal-header h3');
    if (title) title.textContent = 'Editar Responsável';
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.textContent = 'Salvar alterações';

    openGuardianModal();
}

/**
 * Reverte o modal para o estado de cadastro. Sem isto, abrir "Adicionar" depois
 * de uma edicao reaproveitava o editId e acabava atualizando o responsavel
 * anterior em vez de criar um novo.
 */
function resetGuardianForm() {
    const form = document.getElementById('formNewGuardian');
    const modal = document.getElementById('guardianModal');
    if (!form || !modal) return;

    form.reset();
    delete form.dataset.editId;

    const passwordField = document.getElementById('guardianPassword');
    const passwordGroup = passwordField?.closest('.input-group');
    if (passwordField) passwordField.required = true;
    if (passwordGroup) passwordGroup.hidden = false;

    const cpfField = document.getElementById('guardianCPF');
    if (cpfField) cpfField.readOnly = false;

    const title = modal.querySelector('.modal-header h3');
    if (title) title.textContent = 'Adicionar Responsável';
    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) submitButton.textContent = 'Adicionar Responsável';
}

// Renderizar sugestões de atendimento baseadas em profissionais cadastrados
function renderSuggestions() {
    const suggestionGrid = document.getElementById('suggestionGrid');
    if (!suggestionGrid) return;

    const title = document.getElementById('searchResultsTitle');
    const subtitle = document.getElementById('searchResultsSubtitle');

    // Com filtro aplicado a lista mostra os profissionais que casaram com a
    // busca; sem filtro, volta ao panorama por especialidade.
    if (searchApplied) {
        if (title) title.textContent = 'Resultados da busca';
        if (subtitle) {
            subtitle.textContent = searchResults.length === 1
                ? '1 profissional encontrado.'
                : `${searchResults.length} profissionais encontrados.`;
        }

        if (!searchResults.length) {
            suggestionGrid.innerHTML = `
                <div class="suggestion-empty">
                    <i class="ph ph-magnifying-glass"></i>
                    <p>Nenhum profissional encontrado com esses filtros.</p>
                </div>
            `;
            return;
        }

        suggestionGrid.innerHTML = '';
        searchResults.forEach(professional => {
            const local = [professional.unidade, professional.clinicName]
                .filter(Boolean)
                .join(' - ') || 'Unidade não informada';
            const cidade = [professional.cidade, professional.estado].filter(Boolean).join('/');

            const card = document.createElement('div');
            card.className = 'suggestion-card';
            card.innerHTML = `
                <strong>${escapeHTML(professional.name)}</strong>
                <span>${escapeHTML(professional.especialidade || 'Especialidade não informada')}</span>
                <p>${escapeHTML(local)}${cidade ? ` (${escapeHTML(cidade)})` : ''}</p>
                <button class="btn-schedule-suggestion" type="button">Agendar</button>
            `;
            card.querySelector('.btn-schedule-suggestion')
                ?.addEventListener('click', () => scheduleWithProfessional(professional));

            suggestionGrid.appendChild(card);
        });
        return;
    }

    if (title) title.textContent = 'Especialidades Disponíveis';
    if (subtitle) subtitle.textContent = 'Profissionais e especialidades cadastrados no sistema.';

    const specialtiesMap = new Map();
    availableProfessionals.forEach(prof => {
        if (!specialtiesMap.has(prof.especialidade)) {
            specialtiesMap.set(prof.especialidade, []);
        }
        specialtiesMap.get(prof.especialidade).push(prof);
    });

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

/**
 * Abre o modal de agendamento ja apontando para o profissional escolhido no
 * resultado da busca. O select do modal e populado por CRM (registry).
 */
function scheduleWithProfessional(professional) {
    switchTab('appointments');
    const select = document.getElementById('modalProfessional');
    if (select && professional?.registry) {
        select.value = professional.registry;
        updateSelectedProfessionalDetails();
    }
    openModal();
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

/**
 * Monta um Date local a partir da hora de parede devolvida pela API. Componentes
 * separados (e nao `new Date(string)`) de proposito: assim o navegador nao trata
 * a string como UTC e desloca o horario pelo fuso do usuario.
 *
 * A hora tambem entra na conta - antes so a data era lida, o que fazia o
 * formatDateTime exibir sempre 00:00 e a ordenacao empatar consultas do mesmo
 * dia sem respeitar o horario.
 */
function parseAppointmentDate(dateString) {
    if (!dateString) {
        return new Date(NaN);
    }

    const normalized = String(dateString).replace(' ', 'T');
    const [datePart, timePart = ''] = normalized.split('T');
    const [year, month, day] = datePart.split('-').map(Number);

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return new Date(NaN);
    }

    const [hour = 0, minute = 0] = timePart
        .split(':')
        .slice(0, 2)
        .map(value => Number.parseInt(value, 10) || 0);

    return new Date(year, month - 1, day, hour, minute);
}

/**
 * Chave de dia (YYYY-MM-DD) usada para casar a consulta com a celula do
 * calendario e com o filtro de mes. Le a data textualmente - a API devolve a
 * hora de parede, sem fuso, entao nao ha conversao a fazer aqui.
 */
function formatCPF(cpf) {
    const digits = String(cpf || '').replace(/\D/g, '');
    if (digits.length !== 11) return '--';
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

function getAppointmentDateKey(dateString) {
    if (!dateString) return '';
    const normalized = String(dateString).replace(' ', 'T');
    const datePart = normalized.split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : '';
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

// populateSearchFilters() foi substituida por loadSearchFilterOptions(): ela
// era chamada a cada refreshDashboard e reconstruia os selects do zero,
// descartando a opcao que o paciente tinha acabado de escolher. Os valores
// agora vem de /auth/doctors/filters e sao carregados uma vez.

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

/**
 * Intencoes do Assistente Conecta, em ordem de prioridade: a primeira que casar
 * responde. Emergencia vem antes de tudo, de proposito.
 *
 * Os padroes sao regex com \\b (limite de palavra) e nao includes(). A versao
 * anterior usava normalizedMessage.includes('oi'), que casava dentro de
 * "depois", "foi" e "oito" - perguntar "quero remarcar depois" era respondido
 * com uma saudacao. O mesmo valia para 'agendamento' dentro de outras frases.
 */
const CHATBOT_INTENTS = [
    {
        nome: 'emergencia',
        padroes: [/\b(emergencia|urgencia|urgente|socorro|passando mal|falta de ar|dor no peito|dor forte|desmaio|desmaiei|sangramento|convulsao)\b/],
        responder: () => 'Se for uma urgencia, procure atendimento imediato na unidade de emergencia mais proxima ou ligue 192 (SAMU). Em risco de vida, nao espere resposta pelo portal. Eu nao substituo avaliacao medica.'
    },
    {
        nome: 'saudacao',
        padroes: [/\b(oi|ola|opa|eai|e ai|bom dia|boa tarde|boa noite|tudo bem)\b/],
        responder: ({ nome }) => `Ola${nome ? `, ${nome}` : ''}. Posso ajudar com agendar consulta, ver suas proximas consultas, o que levar no dia, desmarcar, responsaveis, acessibilidade e seus dados de perfil. O que voce precisa?`
    },
    {
        nome: 'proximas-consultas',
        padroes: [/\b(proxima|proximas|minhas consultas|minha consulta|tenho consulta|quando (e|sera)|ja tenho|agendada|agendadas|marcada|marcadas)\b/],
        responder: ({ appointments }) => {
            if (!appointments.length) {
                return 'Voce nao tem nenhuma consulta agendada no momento. Para marcar, va em Agendamentos e clique em Novo Agendamento - ou me diga "quero agendar" que eu marco por aqui.';
            }

            const proxima = appointments[0];
            const partes = [
                `Sua proxima consulta e em ${formatDateTime(proxima.date)}`,
                proxima.doctor ? `com ${proxima.doctor}` : '',
                proxima.specialty ? `(${proxima.specialty})` : '',
                proxima.hospital ? `na unidade ${proxima.hospital}` : ''
            ].filter(Boolean).join(' ');

            const restantes = appointments.length - 1;
            const extra = restantes > 0
                ? ` Voce tem mais ${restantes} consulta(s) marcada(s) - veja todas na aba Agendamentos.`
                : '';

            return `${partes}.${extra}`;
        }
    },
    {
        nome: 'agendar',
        padroes: [/\b(agendar|marcar|nova consulta|consulta nova|quero consulta|preciso de consulta)\b/],
        responder: ({ professionals }) => {
            if (!professionals.length) {
                return 'Ainda nao ha profissionais ativos cadastrados para agendamento. Assim que houver, eles aparecem em Buscar Atendimento e no Novo Agendamento.';
            }

            const especialidades = Array.from(new Set(professionals.map(p => p.especialidade).filter(Boolean))).slice(0, 4).join(', ');
            return `Temos ${professionals.length} profissional(is) disponivel(is)${especialidades ? `, incluindo ${especialidades}` : ''}. Escreva "agendar consulta" que eu marco por aqui, ou use Agendamentos > Novo Agendamento.`;
        }
    },
    {
        nome: 'desmarcar',
        padroes: [/\b(desmarc\w*|cancel\w*|remarc\w*|adiar|mudar (a )?data|trocar (o )?horario)\b/],
        responder: () => 'Para desmarcar ou remarcar, abra a aba Agendamentos, clique na consulta no calendario e escolha a acao. Atencao: o cancelamento so e permitido com no minimo 14 dias de antecedencia. Dentro desse prazo, fale direto com a unidade.'
    },
    {
        nome: 'acessibilidade',
        padroes: [/\b(acessibilidade|acessivel|libras|interprete|cadeira de rodas|cadeirante|rampa|deficiencia|autista|autismo|tea|braille|cao guia|surdo|cego|mobilidade|acompanhante)\b/],
        responder: () => 'Sobre acessibilidade: informe sua necessidade ao agendar para a unidade se preparar (interprete de Libras, acompanhante, sala acessivel, atendimento prioritario). Voce tem direito a acompanhante. O proprio portal tem ajustes de contraste e tamanho de fonte na barra de acessibilidade no topo da pagina.'
    },
    {
        nome: 'preparo-documentos',
        padroes: [/\b(documento|documentos|levar|preparo|jejum|exame|exames|rg|carteirinha|o que preciso)\b/],
        responder: () => 'Leve documento oficial com foto, seu CPF, exames recentes e a lista de remedios que voce usa. Se a consulta pedir jejum ou algum preparo especifico, a unidade avisa antes - na duvida, confirme com ela pelo chat com o profissional.'
    },
    {
        nome: 'responsaveis',
        padroes: [/\b(responsavel|responsaveis|autorizado|permissao|permissoes|tutor|acompanhar|meu filho|minha filha)\b/],
        responder: () => 'Na aba Responsaveis voce cadastra quem pode acompanhar seu atendimento. Cada responsavel entra com o proprio CPF e senha, e voce escolhe o que ele pode fazer: ver agendamentos, gerenciar agendamentos ou enviar mensagens. Da para editar ou remover esse acesso quando quiser.'
    },
    {
        nome: 'perfil',
        padroes: [/\b(perfil|meus dados|meu cadastro|cpf|telefone|endereco de cadastro|atualizar dados|mudar email|data de nascimento)\b/],
        responder: () => 'Seus dados ficam em Meu Perfil. Ali voce edita nome, e-mail, telefone, data de nascimento, tipo de deficiencia e unidade de preferencia, e tambem troca sua senha. O CPF nao muda, por ser o seu identificador de acesso.'
    },
    {
        nome: 'senha-acesso',
        padroes: [/\b(senha|login|entrar|acesso|esqueci|bloqueado|nao consigo entrar)\b/],
        responder: () => 'Para trocar a senha estando logado, va em Meu Perfil > Alterar senha (pedimos a senha atual por seguranca). Se esqueceu a senha, use "Esqueci minha senha" na tela de login: enviamos um link de redefinicao para o seu e-mail cadastrado.'
    },
    {
        nome: 'buscar-profissional',
        padroes: [/\b(medico|medica|profissional|profissionais|especialidade|especialidades|quem atende|tem cardiologista|procurar)\b/],
        responder: ({ professionals }) => {
            if (!professionals.length) {
                return 'Ainda nao ha profissionais ativos cadastrados. Quando houver, eles aparecem na aba Buscar Atendimento.';
            }
            return `Temos ${professionals.length} profissional(is) ativo(s). Use a aba Buscar Atendimento para filtrar por especialidade ou unidade, ou buscar pelo nome. De la mesmo da para ja abrir o agendamento.`;
        }
    },
    {
        nome: 'localizacao',
        padroes: [/\b(onde|endereco|local|localizacao|como chegar|unidade fica|mapa)\b/],
        responder: ({ appointments }) => {
            const proxima = appointments[0];
            if (proxima?.hospital) {
                return `Sua proxima consulta e na unidade ${proxima.hospital}. O endereco completo aparece nos detalhes da consulta, na aba Agendamentos - clique nela no calendario.`;
            }
            return 'A unidade de cada consulta aparece nos detalhes dela, na aba Agendamentos. Em Buscar Atendimento voce tambem ve a unidade e a cidade de cada profissional.';
        }
    },
    {
        nome: 'atraso',
        padroes: [/\b(atraso|atrasar|atrasado|vou chegar tarde|perdi a consulta|nao consegui ir|faltei)\b/],
        responder: () => 'Se voce vai se atrasar, avise a unidade o quanto antes pelo chat com o profissional, nesta mesma aba. Atrasos longos costumam exigir remarcacao. Se ja perdeu a consulta, marque uma nova em Agendamentos > Novo Agendamento.'
    },
    {
        nome: 'resultado-receita',
        padroes: [/\b(resultado|laudo|receita|atestado|prescricao|encaminhamento|relatorio)\b/],
        responder: () => 'Resultados, receitas e atestados sao emitidos pelo profissional que te atendeu. Peca diretamente a ele pelo chat desta aba, escolhendo o profissional na lista ao lado. O portal ainda nao armazena esses documentos para download.'
    },
    {
        nome: 'custo',
        padroes: [/\b(valor|preco|custa|custo|pagar|pagamento|gratuito|de graca|quanto)\b/],
        responder: () => 'Os valores dependem da unidade e do tipo de atendimento. Confirme direto com a unidade pelo chat com o profissional antes da consulta - o portal nao processa pagamentos.'
    },
    {
        nome: 'falar-humano',
        padroes: [/\b(atendente|humano|pessoa|falar com alguem|suporte|ajuda de verdade|reclamacao)\b/],
        responder: () => 'Para falar com uma pessoa, use a lista ao lado desta conversa e escolha o profissional do seu atendimento - a mensagem chega direto para ele. Eu sou um assistente automatico e respondo so o que envolve o uso do portal.'
    },
    {
        nome: 'agradecimento',
        padroes: [/\b(obrigad\w*|valeu|agradec\w*|show|otim\w*|perfeito)\b/],
        responder: () => 'Por nada. Quando precisar, e so me chamar por aqui.'
    }
];

function buildChatbotReply(userMessage) {
    const normalizedMessage = normalizeText(userMessage);
    const appointments = getAppointmentData();
    const professionals = availableProfessionals;

    // O fluxo de agendamento pelo chat tem estado proprio e precisa continuar
    // sendo consultado antes das intencoes soltas.
    const schedulingReply = handleChatbotScheduling(userMessage);
    if (schedulingReply) {
        return schedulingReply;
    }

    const contexto = {
        appointments,
        professionals,
        nome: String(getPatientName() || '').split(' ')[0]
    };

    const intencao = CHATBOT_INTENTS.find(item =>
        item.padroes.some(padrao => padrao.test(normalizedMessage))
    );

    if (intencao) {
        return intencao.responder(contexto);
    }

    return 'Nao tenho certeza do que voce precisa. Posso ajudar com: agendar consulta, ver proximas consultas, desmarcar ou remarcar, o que levar no dia, responsaveis, acessibilidade, dados do perfil e senha. Escreva um desses assuntos que eu te oriento.';
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

    // Campo vazio vira "--" em vez de celula em branco (ou do "undefined" que
    // aparecia quando os dados vinham da rota com nomes de coluna diferentes).
    const ouTraco = valor => {
        const texto = String(valor ?? '').trim();
        return texto ? escapeHTML(texto) : '--';
    };

    appointments.slice(0, 4).forEach(appointment => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${ouTraco(appointment.specialty)}</td>
            <td>${ouTraco(appointment.doctor)}</td>
            <td>${ouTraco(appointment.hospital)}</td>
            <td>${ouTraco(formatDateTime(appointment.date))}</td>
        `;
        tableBody.appendChild(row);
    });
}

function updateOverviewCards() {
    const appointments = getAppointmentData();
    const totalAppointments = document.getElementById('totalAppointments');
    const nextAppointmentDate = document.getElementById('nextAppointmentDate');
    const specialtyCount = document.getElementById('specialtyCount');

    if (totalAppointments) {
        totalAppointments.innerText = appointments.length;
    }

    if (nextAppointmentDate) {
        // getAppointmentData() ordena da mais proxima para a mais distante e a
        // API ja exclui canceladas, entao a primeira e a proxima consulta.
        const nextAppointment = appointments.find(appointment => getAppointmentDateKey(appointment.date));

        if (nextAppointment) {
            nextAppointmentDate.innerText = formatDateTime(nextAppointment.date);
            nextAppointmentDate.classList.remove('is-empty');
            nextAppointmentDate.title = [nextAppointment.specialty, nextAppointment.doctor]
                .filter(Boolean)
                .join(' - ');
        } else {
            nextAppointmentDate.innerText = 'Sem consulta agendada';
            nextAppointmentDate.classList.add('is-empty');
            nextAppointmentDate.removeAttribute('title');
        }
    }

    if (specialtyCount) {
        specialtyCount.innerText = new Set(appointments.map(appointment => appointment.specialty)).size;
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

    // O calendario e montado sempre. Antes, quando o mes nao tinha consulta, a
    // funcao desenhava so a mensagem de vazio e dava return - o paciente perdia
    // a grade e nao tinha como navegar para outro mes pela propria tela.
    // Agora o aviso de "nenhuma consulta" vai abaixo da grade, no fim da funcao.

    // Agrupa por dia (YYYY-MM-DD) usando a mesma leitura textual do restante do
    // arquivo, que agora casa com o formato devolvido pela API.
    const groupedAppointments = appointments.reduce((groups, appointment) => {
        const dateKey = getAppointmentDateKey(appointment.date);
        if (!dateKey) return groups;
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

    // Aviso de mes vazio: complementa a grade em vez de substitui-la.
    if (!appointments.length) {
        const message = document.createElement('div');
        message.className = 'empty-state';
        message.innerHTML = `
            <i class="ph ph-calendar-x"></i>
            <p>Você não possui consultas agendadas para ${escapeHTML(formatMonthLabel(monthValue))}.</p>
        `;
        list.appendChild(message);
    }
}

function showAppointmentDetail(appointment) {
    if (!appointment) return;
    const modal = document.createElement('div');
    modal.className = 'popup-modal';

    // Detalhe da consulta: mesma caixa dos avisos, porem alinhada a esquerda e
    // sem o icone de aviso. O estilo vem de theme.css - estilo inline aqui
    // sobrescrevia o tema de alto contraste (fundo branco com texto branco).
    const content = document.createElement('div');
    content.className = 'popup-content popup-content--detail';
    modal.appendChild(content);

    const title = document.createElement('h3');
    title.textContent = appointment.doctor || 'Profissional';
    content.appendChild(title);

    const p1 = document.createElement('p');
    p1.textContent = `${getAppointmentTime(appointment.date)} — ${appointment.hospital || ''}`;
    content.appendChild(p1);

    const p2 = document.createElement('p');
    p2.className = 'popup-detail-meta';
    p2.textContent = appointment.specialty || '';
    content.appendChild(p2);

    const btns = document.createElement('div');
    btns.className = 'popup-actions';

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

/**
 * Executa a busca no servidor com os filtros escolhidos.
 *
 * Antes esta funcao nao chamava API nenhuma: esperava 800ms num setTimeout e
 * abria um popup dizendo "Filtro aplicado", enquanto a lista abaixo continuava
 * mostrando todos os profissionais. Agora consulta /auth/doctors/search e
 * desenha o resultado real.
 */
async function filterResults() {
    const specialty = document.getElementById('searchSpecialty')?.value || '';
    const unit = document.getElementById('searchHospital')?.value || '';
    const term = document.getElementById('searchTerm')?.value.trim() || '';
    const button = document.querySelector('.btn-search-filter');

    if (button) {
        button.innerHTML = '<i class="ph ph-spinner-gap"></i> Buscando...';
        button.disabled = true;
    }

    try {
        const params = new URLSearchParams();
        if (specialty) params.set('especialidade', specialty);
        if (unit) params.set('unidade', unit);
        if (term) params.set('termo', term);

        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/doctors/search?${params}`);
        const data = await response.json();

        if (!response.ok) {
            console.error('Falha na busca de atendimento:', data);
            await showPopup(data.message || 'Nao foi possivel buscar os profissionais.');
            return;
        }

        searchResults = Array.isArray(data) ? data.map(professional => ({
            id: professional.id,
            name: professional.name || '',
            registry: professional.crm || '',
            especialidade: professional.especialidade || '',
            unidade: professional.unidade || '',
            clinicName: professional.clinicName || '',
            cidade: professional.cidade || '',
            estado: professional.estado || '',
            bio: professional.bio || ''
        })) : [];
        searchApplied = Boolean(specialty || unit || term);

        renderSuggestions();
    } catch (error) {
        console.error('Erro ao buscar profissionais:', error);
        await showPopup('Erro de conexao ao buscar profissionais.');
    } finally {
        if (button) {
            button.innerHTML = '<i class="ph ph-magnifying-glass"></i> Filtrar';
            button.disabled = false;
        }
    }
}

/**
 * Preenche os selects de filtro com os valores que existem de fato no banco.
 * O HTML trazia uma lista fixa (Cardiologia, Hospital Central...) que nao tinha
 * relacao com os profissionais cadastrados.
 */
async function loadSearchFilterOptions() {
    const specialtySelect = document.getElementById('searchSpecialty');
    const unitSelect = document.getElementById('searchHospital');
    if (!specialtySelect || !unitSelect) return;

    try {
        const response = await fetch(`${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/doctors/filters`);
        const data = await response.json();
        if (!response.ok) return;

        const preencher = (select, valores, rotuloVazio) => {
            const escolhido = select.value;
            select.innerHTML = '';
            const vazio = document.createElement('option');
            vazio.value = '';
            vazio.textContent = rotuloVazio;
            select.appendChild(vazio);

            (valores || []).forEach(valor => {
                const option = document.createElement('option');
                option.value = valor;
                option.textContent = valor;
                select.appendChild(option);
            });

            select.value = escolhido;
        };

        preencher(specialtySelect, data.especialidades, 'Todas as áreas');
        preencher(unitSelect, data.unidades, 'Todas as unidades');

        // A unidade de preferencia do perfil sai da mesma lista. Como esta
        // funcao pode terminar depois de loadPatientData(), o valor salvo e
        // reaplicado aqui - senao o select voltaria para "Sem preferência".
        const preferredUnitSelect = document.getElementById('profilePreferredUnit');
        if (preferredUnitSelect) {
            preencher(preferredUnitSelect, data.unidades, 'Sem preferência');
            garantirOpcaoDeUnidade(preferredUnitSelect, user?.unidade_preferencia);
            preferredUnitSelect.value = user?.unidade_preferencia || '';
        }
    } catch (error) {
        console.error('Erro ao carregar filtros de busca:', error);
    }
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
    loadSearchFilterOptions();

    const profileForm = document.getElementById('formPatientProfile');
    if (profileForm) {
        profileForm.addEventListener('submit', handleProfileSubmit);
    }

    const resetProfileButton = document.getElementById('btnResetProfile');
    if (resetProfileButton) {
        // Recarrega os campos a partir do perfil em memoria, descartando o que
        // foi digitado sem salvar.
        resetProfileButton.addEventListener('click', () => loadPatientData());
    }

    const passwordForm = document.getElementById('formChangePassword');
    if (passwordForm) {
        passwordForm.addEventListener('submit', handleChangePasswordSubmit);
    }

    const profilePhoneInput = document.getElementById('profilePhone');
    if (profilePhoneInput) {
        profilePhoneInput.addEventListener('input', event => {
            let v = event.target.value.replace(/\D/g, '').slice(0, 11);
            if (v.length > 6) {
                v = v.replace(/^(\d{2})(\d{4,5})(\d{0,4}).*/, '($1) $2-$3');
            } else if (v.length > 2) {
                v = v.replace(/^(\d{2})(\d*)/, '($1) $2');
            }
            event.target.value = v;
        });
    }

    // Enter no campo de texto dispara a busca, em vez de exigir o clique.
    const searchTermInput = document.getElementById('searchTerm');
    if (searchTermInput) {
        searchTermInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                filterResults();
            }
        });
    }

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

    // O filtro comecava vazio e ninguem o inicializava (quem fazia isso era a
    // renderAppointmentsState, que nunca chegava a ser chamada). Sem filtro,
    // applyAppointmentsMonthFilter devolvia consultas de todos os meses, mas a
    // grade so tem celulas do mes corrente - as demais eram agrupadas e
    // descartadas silenciosamente. Fixar o mes atual mantem filtro e grade
    // olhando para o mesmo periodo.
    updateAppointmentsMonthPicker(getCurrentMonthValue());

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

    const guardianCpfInput = document.getElementById('guardianCPF');
    if (guardianCpfInput) {
        guardianCpfInput.addEventListener('input', event => {
            let digits = event.target.value.replace(/\D/g, '').slice(0, 11);
            digits = digits.replace(/(\d{3})(\d)/, '$1.$2');
            digits = digits.replace(/(\d{3})(\d)/, '$1.$2');
            digits = digits.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
            event.target.value = digits;
        });
    }

    const guardianForm = document.getElementById('formNewGuardian');
    if (guardianForm) {
        guardianForm.addEventListener('submit', async event => {
            event.preventDefault();

            const editId = guardianForm.dataset.editId;
            const isEditing = Boolean(editId);

            const name = document.getElementById('guardianName')?.value.trim();
            const cpf = document.getElementById('guardianCPF')?.value.trim();
            const relationship = document.getElementById('guardianRelationship')?.value;
            const email = document.getElementById('guardianEmail')?.value.trim();
            const password = document.getElementById('guardianPassword')?.value.trim();

            if (!name || !cpf || !relationship || !email) {
                await showPopup('Por favor, preencha todos os campos obrigatórios.');
                return;
            }

            if (!validarCPF(cpf)) {
                await showPopup('CPF do responsável inválido.');
                return;
            }

            if (String(user?.cpf || '').replace(/\D/g, '') === cpf.replace(/\D/g, '')) {
                await showPopup('O CPF do responsável deve ser diferente do seu próprio CPF.');
                return;
            }

            // A senha so entra no cadastro. Na edicao o campo fica oculto, porque
            // trocar a senha e coisa do proprio responsavel.
            if (!isEditing && !isStrongPassword(password)) {
                await showPopup('A senha deve ter 8+ caracteres, com maiúscula, minúscula, número e caractere especial.');
                return;
            }

            // Os valores sao ids da tabela `permissoes`.
            const permissions = Array.from(guardianForm.querySelectorAll('input[name="permissions"]:checked'))
                .map(checkbox => Number(checkbox.value))
                .filter(Number.isInteger);

            if (permissions.length === 0) {
                await showPopup('Selecione pelo menos uma permissão.');
                return;
            }

            const token = window.ConectaSession.getToken();
            if (!token) {
                await showPopup('Sessão expirada. Faça login novamente.');
                return;
            }

            const baseUrl = `${window.APP_CONFIG?.AUTH_API_URL || '/auth'}/patient/guardians`;
            const url = isEditing ? `${baseUrl}/${encodeURIComponent(editId)}` : baseUrl;
            const payload = isEditing
                ? { name, relationship, email, permissions }
                : { name, cpf: cpf.replace(/\D/g, ''), relationship, email, password, permissions };

            try {
                const resp = await fetch(url, {
                    method: isEditing ? 'PUT' : 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });

                const body = await resp.json().catch(() => ({}));

                if (!resp.ok) {
                    // O backend devolve os erros de schema em body.errors.
                    const detalhe = Array.isArray(body.errors) && body.errors.length
                        ? body.errors.map(issue => issue.message).join(' ')
                        : '';
                    await showPopup(detalhe || body.message || 'Erro ao salvar responsável.');
                    return;
                }

                if (isEditing) {
                    await showPopup(`Responsável ${name} atualizado com sucesso.`);
                } else if (body.reused) {
                    await showPopup(`${name} já tinha cadastro com esse CPF e foi vinculado a você. O acesso continua com a senha que essa pessoa já usava.`);
                } else {
                    await showPopup(`Responsável ${name} adicionado com sucesso.`);
                }

                closeGuardianModal();
                renderGuardians();
            } catch (err) {
                console.error('Erro ao salvar responsavel no servidor:', err);
                await showPopup('Erro de conexão ao salvar responsável.');
            }
        });
    }

// renderAppointmentsState() foi removida: nunca era chamada por ninguem. O que
// ela fazia de util - inicializar o mes e buscar agendamentos/profissionais -
// agora acontece no DOMContentLoaded e em loadUserInfo().

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