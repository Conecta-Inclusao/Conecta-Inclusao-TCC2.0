// Dashboard do responsavel.
//
// O responsavel nao tem dados clinicos proprios: tudo que ele ve pertence a um
// paciente ao qual esta vinculado. Por isso a tela gira em torno de dois
// estados - qual paciente esta selecionado e quais permissoes o paciente
// concedeu a ele.
//
// As permissoes tambem sao aplicadas no servidor (requirePatientAccess e
// resolveActor). Escondemos as abas aqui para nao oferecer o que vai voltar 403,
// mas quem autoriza de fato e o backend.

import {
    createChatClient,
    fetchContacts,
    fetchConversation,
    formatMessageTime,
    setChatPatientContext
} from './realtime-chat.js';

const AUTH_URL = window.APP_CONFIG?.AUTH_API_URL || '/auth';

const PERMISSAO_VER = 'Ver agendamentos';
const PERMISSAO_MENSAGENS = 'Enviar mensagens';

let guardian = null;
let linkedPatients = [];
let permissions = [];
let selectedPatientId = null;
let appointments = [];
let appointmentsMonthFilter = '';

let chatClient = null;
let chatContacts = [];
let activeContact = null;
let activeMessages = [];

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------
function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function formatCPF(cpf) {
    const digits = String(cpf || '').replace(/\D/g, '');
    if (digits.length !== 11) return '--';
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/**
 * Le a data como hora de parede. A API devolve 'YYYY-MM-DDTHH:MM:SS' sem fuso
 * (ver o TO_CHAR nas rotas de agendamento); usar `new Date(string)` faria o
 * navegador interpretar como UTC e deslocar o horario.
 */
function parseAppointmentDate(dateString) {
    if (!dateString) return new Date(NaN);
    const normalized = String(dateString).replace(' ', 'T');
    const [datePart, timePart = ''] = normalized.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return new Date(NaN);
    }
    const [hour = 0, minute = 0] = timePart.split(':').slice(0, 2)
        .map((v) => Number.parseInt(v, 10) || 0);
    return new Date(year, month - 1, day, hour, minute);
}

function getAppointmentDateKey(dateString) {
    if (!dateString) return '';
    const datePart = String(dateString).replace(' ', 'T').split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : '';
}

function formatDateTime(dateString) {
    const parsed = parseAppointmentDate(dateString);
    if (Number.isNaN(parsed.getTime())) return '--';
    return parsed.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function formatDateOnly(dateString) {
    if (!dateString) return '--';
    const key = getAppointmentDateKey(dateString);
    if (!key) return '--';
    const [year, month, day] = key.split('-');
    return `${day}/${month}/${year}`;
}

function getCurrentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(monthValue) {
    if (!monthValue) return '--';
    const [year, month] = monthValue.split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function temPermissao(nome) {
    return permissions.includes(nome);
}

function pacienteSelecionado() {
    return linkedPatients.find((p) => String(p.id) === String(selectedPatientId)) || null;
}

async function authFetch(url, options = {}) {
    const token = window.ConectaSession.getToken();
    return fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    });
}

// ---------------------------------------------------------------------------
// Carregamento
// ---------------------------------------------------------------------------
async function loadGuardianContext() {
    try {
        const [perfilResp, vinculosResp] = await Promise.all([
            authFetch(`${AUTH_URL}/profile`),
            authFetch(`${AUTH_URL}/responsavel/pacientes`)
        ]);

        guardian = perfilResp.ok ? await perfilResp.json() : {};

        if (vinculosResp.ok) {
            const dados = await vinculosResp.json();
            linkedPatients = Array.isArray(dados.pacientes) ? dados.pacientes : [];
            permissions = Array.isArray(dados.permissions) ? dados.permissions : [];
        } else {
            linkedPatients = [];
            permissions = [];
        }
    } catch (error) {
        console.error('Erro ao carregar contexto do responsável:', error);
        guardian = guardian || {};
        linkedPatients = [];
        permissions = [];
    }

    // Mantem a escolha anterior entre recarregamentos, quando ela ainda vale.
    const salvo = sessionStorage.getItem('guardianSelectedPatient');
    const aindaVale = linkedPatients.some((p) => String(p.id) === String(salvo));
    selectedPatientId = aindaVale ? salvo : (linkedPatients[0]?.id ?? null);

    aplicarPermissoesNaNavegacao();
    renderGuardianIdentity();
    renderPatientPicker();
    await selecionarPaciente(selectedPatientId);
}

/**
 * Remove do menu as abas cuja permissao o responsavel nao tem. Se a aba ativa
 * for uma das removidas, cai para a Visao Geral.
 */
function aplicarPermissoesNaNavegacao() {
    let precisaVoltarParaInicio = false;

    document.querySelectorAll('.nav-link[data-requires]').forEach((botao) => {
        if (temPermissao(botao.dataset.requires)) return;

        const alvo = document.getElementById(botao.dataset.tab);
        if (alvo?.classList.contains('active')) precisaVoltarParaInicio = true;
        botao.remove();
        alvo?.remove();
    });

    if (precisaVoltarParaInicio) switchTab('overview');
}

async function selecionarPaciente(patientId) {
    selectedPatientId = patientId;

    if (patientId) {
        sessionStorage.setItem('guardianSelectedPatient', String(patientId));
        // O chat precisa saber por qual paciente o responsavel esta falando.
        setChatPatientContext(patientId);
    }

    renderPatientCard();

    if (temPermissao(PERMISSAO_VER)) {
        await carregarAgendamentos();
    }

    if (temPermissao(PERMISSAO_MENSAGENS)) {
        await carregarContatos();
    }

    renderOverview();
    renderAppointmentsList();
}

async function carregarAgendamentos() {
    if (!selectedPatientId) {
        appointments = [];
        return;
    }

    try {
        const response = await authFetch(
            `${AUTH_URL}/patient/appointments?pacienteId=${encodeURIComponent(selectedPatientId)}`
        );

        if (!response.ok) {
            const corpo = await response.json().catch(() => ({}));
            console.error('Falha ao carregar agendamentos:', corpo);
            appointments = [];
            return;
        }

        const dados = await response.json();
        appointments = (Array.isArray(dados) ? dados : []).map((item) => ({
            id: item.id,
            specialty: item.specialty || '',
            doctor: item.doctorName || '',
            hospital: item.unit || item.clinicName || '',
            date: item.appointmentDate || '',
            status: item.status || ''
        }));
    } catch (error) {
        console.error('Erro ao carregar agendamentos:', error);
        appointments = [];
    }
}

// ---------------------------------------------------------------------------
// Render - identidade e seletor
// ---------------------------------------------------------------------------
function renderGuardianIdentity() {
    const nome = guardian?.name || 'Responsável';

    const headerName = document.getElementById('guardianHeaderName');
    if (headerName) headerName.textContent = nome;

    const headerSubtitle = document.getElementById('guardianHeaderSubtitle');
    if (headerSubtitle) {
        headerSubtitle.textContent = linkedPatients.length === 1
            ? 'Responsável'
            : `Responsável por ${linkedPatients.length} pacientes`;
    }

    const avatar = document.getElementById('guardianAvatar');
    if (avatar) {
        avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(nome)}&background=0073e6&color=fff`;
        avatar.alt = `Avatar de ${nome}`;
    }

    const saudacao = document.getElementById('overviewGreeting');
    if (saudacao) saudacao.textContent = `Olá, ${String(nome).split(' ')[0]}`;

    const campos = {
        guardianName: nome,
        guardianCPF: formatCPF(guardian?.cpf),
        guardianEmail: guardian?.email || '--'
    };
    Object.entries(campos).forEach(([id, valor]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    });

    renderPermissionBadges();
    renderLinkedPatients();
}

function renderPermissionBadges() {
    const lista = document.getElementById('guardianPermissionsList');
    if (!lista) return;

    if (!permissions.length) {
        lista.innerHTML = '<span class="permissions-empty">Nenhuma permissão concedida ainda.</span>';
        return;
    }

    lista.innerHTML = permissions
        .map((nome) => `<span class="permission-badge"><i class="ph ph-check-circle"></i>${escapeHTML(nome)}</span>`)
        .join('');
}

function renderLinkedPatients() {
    const lista = document.getElementById('linkedPatientsList');
    if (!lista) return;

    if (!linkedPatients.length) {
        lista.innerHTML = `
            <div class="guardians-empty">
                <i class="ph ph-users-three"></i>
                <p>Você ainda não está vinculado a nenhum paciente.</p>
            </div>
        `;
        return;
    }

    lista.innerHTML = linkedPatients.map((paciente) => `
        <div class="guardian-card">
            <div class="guardian-card-header">
                <div class="guardian-info">
                    <strong>${escapeHTML(paciente.name)}</strong>
                    <span>${escapeHTML(paciente.relationship || 'Vínculo não informado')}</span>
                </div>
            </div>
            <div class="guardian-details">
                <div class="guardian-detail">
                    <label>CPF</label>
                    <p>${escapeHTML(formatCPF(paciente.cpf))}</p>
                </div>
                <div class="guardian-detail">
                    <label>Nascimento</label>
                    <p>${escapeHTML(formatDateOnly(paciente.dataNascimento))}</p>
                </div>
            </div>
        </div>
    `).join('');
}

function renderPatientPicker() {
    const picker = document.getElementById('patientPicker');
    const wrapper = document.querySelector('.guardian-patient-picker');
    if (!picker || !wrapper) return;

    // Com um paciente so nao ha escolha a fazer: o seletor vira ruido.
    // Escondido ele, sobra um filho so no .top-bar, e o space-between jogaria o
    // perfil para a esquerda - dai o modificador que encosta tudo na direita.
    const topBar = wrapper.closest('.top-bar');
    if (linkedPatients.length <= 1) {
        wrapper.hidden = true;
        topBar?.classList.add('top-bar--titleless');
        return;
    }

    wrapper.hidden = false;
    topBar?.classList.remove('top-bar--titleless');
    picker.innerHTML = '';
    linkedPatients.forEach((paciente) => {
        const option = document.createElement('option');
        option.value = paciente.id;
        option.textContent = paciente.name;
        picker.appendChild(option);
    });
    picker.value = selectedPatientId ?? '';
}

function renderPatientCard() {
    const paciente = pacienteSelecionado();

    const campos = {
        patientName: paciente?.name || '--',
        patientRelationship: paciente?.relationship || '--',
        patientCPF: formatCPF(paciente?.cpf),
        patientBirthDate: formatDateOnly(paciente?.dataNascimento),
        patientDisability: paciente?.tipoDeficiencia || 'Não informado',
        patientUnit: paciente?.unidadePreferencia || 'Sem preferência'
    };

    Object.entries(campos).forEach(([id, valor]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    });

    const subtitulo = document.getElementById('overviewSubtitle');
    if (subtitulo) {
        subtitulo.textContent = paciente
            ? `Você está acompanhando ${paciente.name}.`
            : 'Nenhum paciente vinculado ao seu acesso.';
    }
}

// ---------------------------------------------------------------------------
// Render - agendamentos
// ---------------------------------------------------------------------------
function ordenarAgendamentos() {
    return appointments.slice().sort(
        (a, b) => parseAppointmentDate(a.date) - parseAppointmentDate(b.date)
    );
}

function renderOverview() {
    const ordenados = ordenarAgendamentos();

    const total = document.getElementById('totalAppointments');
    if (total) total.textContent = temPermissao(PERMISSAO_VER) ? ordenados.length : '--';

    const patientCount = document.getElementById('patientCount');
    if (patientCount) patientCount.textContent = linkedPatients.length;

    const proxima = document.getElementById('nextAppointmentDate');
    if (proxima) {
        if (!temPermissao(PERMISSAO_VER)) {
            proxima.textContent = 'Sem permissão';
            proxima.classList.add('is-empty');
        } else {
            const primeira = ordenados.find((item) => getAppointmentDateKey(item.date));
            proxima.textContent = primeira ? formatDateTime(primeira.date) : 'Sem consulta agendada';
            proxima.classList.toggle('is-empty', !primeira);
        }
    }

    const card = document.getElementById('overviewAppointmentsCard');
    const corpo = document.getElementById('overviewAppointmentsTable');

    // Sem "Ver agendamentos" a tabela inteira sai da tela, em vez de aparecer
    // vazia como se o paciente nao tivesse consultas.
    if (card) card.hidden = !temPermissao(PERMISSAO_VER);
    if (!corpo || !temPermissao(PERMISSAO_VER)) return;

    if (!ordenados.length) {
        corpo.innerHTML = '<tr><td colspan="4">Nenhuma consulta agendada.</td></tr>';
        return;
    }

    const ouTraco = (valor) => {
        const texto = String(valor ?? '').trim();
        return texto ? escapeHTML(texto) : '--';
    };

    corpo.innerHTML = ordenados.slice(0, 5).map((item) => `
        <tr>
            <td>${ouTraco(item.specialty)}</td>
            <td>${ouTraco(item.doctor)}</td>
            <td>${ouTraco(item.hospital)}</td>
            <td>${ouTraco(formatDateTime(item.date))}</td>
        </tr>
    `).join('');
}

function renderAppointmentsList() {
    const lista = document.getElementById('appointmentsList');
    if (!lista) return;

    lista.innerHTML = '';

    const monthValue = appointmentsMonthFilter || getCurrentMonthValue();
    const doMes = ordenarAgendamentos().filter(
        (item) => getAppointmentDateKey(item.date).slice(0, 7) === monthValue
    );

    const porDia = doMes.reduce((grupos, item) => {
        const chave = getAppointmentDateKey(item.date);
        if (!chave) return grupos;
        (grupos[chave] = grupos[chave] || []).push(item);
        return grupos;
    }, {});

    const [ano, mes] = monthValue.split('-').map(Number);
    const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay();
    const totalDias = new Date(ano, mes, 0).getDate();

    const calendario = document.createElement('div');
    calendario.className = 'month-calendar';

    const titulo = document.createElement('div');
    titulo.className = 'month-title';
    titulo.textContent = formatMonthLabel(monthValue);
    calendario.appendChild(titulo);

    const cabecalho = document.createElement('div');
    cabecalho.className = 'calendar-header';
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].forEach((dia) => {
        const el = document.createElement('div');
        el.className = 'weekday';
        el.textContent = dia;
        cabecalho.appendChild(el);
    });
    calendario.appendChild(cabecalho);

    const grade = document.createElement('div');
    grade.className = 'calendar-grid';

    for (let i = 0; i < primeiroDiaSemana; i += 1) {
        const vazia = document.createElement('div');
        vazia.className = 'calendar-cell empty';
        grade.appendChild(vazia);
    }

    for (let dia = 1; dia <= totalDias; dia += 1) {
        const chave = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const doDia = porDia[chave] || [];

        const celula = document.createElement('div');
        celula.className = 'calendar-cell';

        const numero = document.createElement('div');
        numero.className = 'calendar-day-number';
        numero.textContent = dia;
        celula.appendChild(numero);

        doDia.slice(0, 4).forEach((item) => {
            const bloco = document.createElement('div');
            bloco.className = 'calendar-appointment';

            const hora = document.createElement('div');
            hora.className = 'appt-time';
            const parsed = parseAppointmentDate(item.date);
            hora.textContent = Number.isNaN(parsed.getTime())
                ? '--:--'
                : parsed.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

            const titulo = document.createElement('div');
            titulo.className = 'appt-title';
            titulo.textContent = item.doctor || item.specialty || 'Consulta';

            bloco.appendChild(hora);
            bloco.appendChild(titulo);
            bloco.title = [item.specialty, item.doctor, item.hospital].filter(Boolean).join(' - ');
            celula.appendChild(bloco);
        });

        if (doDia.length > 4) {
            const mais = document.createElement('div');
            mais.className = 'calendar-more';
            mais.textContent = `+${doDia.length - 4} mais`;
            celula.appendChild(mais);
        }

        grade.appendChild(celula);
    }

    calendario.appendChild(grade);

    const coluna = document.createElement('div');
    coluna.className = 'schedule-day-column';
    coluna.appendChild(calendario);
    lista.appendChild(coluna);

    // O calendario aparece sempre; o aviso de mes vazio o acompanha.
    if (!doMes.length) {
        const aviso = document.createElement('div');
        aviso.className = 'empty-state';
        aviso.innerHTML = `
            <i class="ph ph-calendar-x"></i>
            <p>Nenhuma consulta agendada para ${escapeHTML(formatMonthLabel(monthValue))}.</p>
        `;
        lista.appendChild(aviso);
    }
}

function atualizarMes(valor) {
    appointmentsMonthFilter = valor || '';

    const picker = document.getElementById('appointmentsMonthPicker');
    if (picker) picker.value = appointmentsMonthFilter;

    const label = document.getElementById('appointmentsMonthLabel');
    if (label) {
        label.textContent = appointmentsMonthFilter
            ? formatMonthLabel(appointmentsMonthFilter)
            : 'Mês selecionado';
    }

    renderAppointmentsList();
}

function mudarMes(delta) {
    const atual = appointmentsMonthFilter || getCurrentMonthValue();
    const [ano, mes] = atual.split('-').map(Number);
    const nova = new Date(ano, mes - 1 + delta, 1);
    atualizarMes(`${nova.getFullYear()}-${String(nova.getMonth() + 1).padStart(2, '0')}`);
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------
async function carregarContatos() {
    try {
        chatContacts = await fetchContacts();
    } catch (error) {
        console.error('Erro ao carregar contatos:', error);
        chatContacts = [];
    }

    // Trocar de paciente troca o conjunto de profissionais: a conversa aberta
    // do paciente anterior nao vale mais.
    activeContact = null;
    activeMessages = [];
    renderContacts();
    renderConversation();
}

function renderContacts() {
    const lista = document.getElementById('messageContactsList');
    if (!lista) return;

    if (!chatContacts.length) {
        lista.innerHTML = `
            <div class="chat-contacts-empty">
                <i class="ph ph-chat-circle-dots"></i>
                <p>Nenhum profissional atende este paciente ainda.</p>
            </div>
        `;
        return;
    }

    lista.innerHTML = '';
    chatContacts.forEach((contato) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'chat-contact-card';
        if (activeContact && String(activeContact.profileId) === String(contato.profileId)) {
            item.classList.add('active');
        }
        item.innerHTML = `
            <strong>${escapeHTML(contato.name || 'Profissional')}</strong>
            <span>${escapeHTML(contato.specialty || contato.unit || 'Profissional de saúde')}</span>
        `;
        item.addEventListener('click', () => abrirConversa(contato));
        lista.appendChild(item);
    });
}

async function abrirConversa(contato) {
    activeContact = contato;
    renderContacts();

    // Entra na sala do socket para receber as respostas em tempo real. Sem
    // isso a conversa carrega, mas so atualiza ao recarregar a pagina.
    chatClient?.join(contato.profileId).catch((erro) => {
        console.warn('Tempo real indisponível nesta conversa:', erro);
    });

    const resultado = await fetchConversation(contato.profileId);
    activeMessages = resultado.ok ? resultado.messages : [];

    if (!resultado.ok) {
        await showPopup(resultado.message || 'Não foi possível carregar a conversa.');
    }

    renderConversation();
}

function renderConversation() {
    const nome = document.getElementById('chatContactName');
    const meta = document.getElementById('chatContactMeta');
    const lista = document.getElementById('chatMessagesList');
    if (!lista) return;

    if (!activeContact) {
        if (nome) nome.textContent = 'Selecione um profissional';
        if (meta) meta.textContent = 'As conversas aparecem aqui.';
        lista.innerHTML = `
            <div class="chat-empty">
                <i class="ph ph-chat-circle-text"></i>
                <p>Escolha um profissional para ver a conversa.</p>
            </div>
        `;
        return;
    }

    if (nome) nome.textContent = activeContact.name || 'Profissional';
    if (meta) meta.textContent = activeContact.specialty || activeContact.unit || 'Profissional de saúde';

    if (!activeMessages.length) {
        lista.innerHTML = `
            <div class="chat-empty">
                <i class="ph ph-chat-circle-dots"></i>
                <p>Nenhuma mensagem ainda. Escreva a primeira.</p>
            </div>
        `;
        return;
    }

    // .patient e a bolha de quem esta enviando (o responsavel escreve em nome
    // do paciente); .professional e a do outro lado.
    lista.innerHTML = activeMessages.map((mensagem) => `
        <div class="chat-bubble ${mensagem.mine ? 'patient' : 'professional'}">
            <p>${escapeHTML(mensagem.content)}</p>
            <span class="chat-bubble-meta">${escapeHTML(formatMessageTime(mensagem.createdAt))}</span>
        </div>
    `).join('');

    lista.scrollTop = lista.scrollHeight;
}

async function enviarMensagem(event) {
    event.preventDefault();

    const input = document.getElementById('chatInput');
    const conteudo = input?.value.trim();
    if (!conteudo) return;

    if (!activeContact) {
        await showPopup('Escolha um profissional antes de enviar a mensagem.');
        return;
    }

    const resultado = chatClient
        ? await chatClient.send(activeContact.profileId, conteudo)
        : { ok: false, message: 'Chat indisponível no momento.' };

    if (!resultado.ok) {
        await showPopup(resultado.message || 'Não foi possível enviar a mensagem.');
        return;
    }

    if (resultado.message && !activeMessages.some((m) => m.id === resultado.message.id)) {
        activeMessages.push(resultado.message);
    }

    input.value = '';
    renderConversation();
}

function iniciarChat() {
    chatClient = createChatClient({
        onMessage: (mensagem) => {
            if (!activeContact) return;
            if (activeMessages.some((m) => m.id === mensagem.id)) return;
            activeMessages.push(mensagem);
            renderConversation();
        },
        onStatus: (estado) => {
            const pill = document.getElementById('chatStatusPill');
            if (!pill) return;
            pill.textContent = estado === 'conectado' ? 'Online' : 'Offline';
        }
    });

    chatClient.connect?.();
}

// ---------------------------------------------------------------------------
// Navegacao
// ---------------------------------------------------------------------------
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach((secao) => {
        secao.classList.toggle('active', secao.id === tabId);
    });
    document.querySelectorAll('.nav-link').forEach((botao) => {
        botao.classList.toggle('active', botao.dataset.tab === tabId);
    });
}

async function handleLogout() {
    const confirmado = await showPopup('Deseja realmente sair?', 'confirm');
    if (!confirmado) return;
    window.ConectaSession.clearSession();
    window.location.href = 'login-responsavel.html?motivo=saiu';
}

// ---------------------------------------------------------------------------
// Inicializacao
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('.nav-link').forEach((botao) => {
        botao.addEventListener('click', () => switchTab(botao.dataset.tab));
    });

    const picker = document.getElementById('patientPicker');
    if (picker) {
        picker.addEventListener('change', (event) => selecionarPaciente(event.target.value));
    }

    document.getElementById('appointmentsPrevMonth')?.addEventListener('click', () => mudarMes(-1));
    document.getElementById('appointmentsNextMonth')?.addEventListener('click', () => mudarMes(1));
    document.getElementById('appointmentsMonthPicker')?.addEventListener('change', (event) => {
        atualizarMes(event.target.value);
    });

    document.getElementById('chatForm')?.addEventListener('submit', enviarMensagem);

    atualizarMes(getCurrentMonthValue());

    await loadGuardianContext();

    if (temPermissao(PERMISSAO_MENSAGENS)) {
        iniciarChat();
    }
});

window.handleLogout = handleLogout;
window.switchTab = switchTab;
