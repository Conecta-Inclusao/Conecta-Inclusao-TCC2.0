// Gerenciador de Profissionais da Empresa
let api;
let currentProfessionals = [];
const AUTH_API_BASE = window.APP_CONFIG?.AUTH_API_URL || '/auth';

async function loadAPI() {
    if (!api) {
        api = await import('./api.js');
    }
    return api;
}

function getClinicAuthToken() {
    return window.ConectaSession.getToken();
}

// O numero do CRM e so digito; a identidade do registro se completa com a UF,
// que fica num campo proprio (professionalCrmUf).
function applyCRMMask(value) {
    return String(value).replace(/\D/g, '').slice(0, 7);
}

/* ---------------------------------------------------------------------------
   Endereco do medico -> unidade mais proxima
   ---------------------------------------------------------------------------
   FLUXO: CEP digitado -> ViaCEP devolve o endereco -> Nominatim (OSM) devolve
   latitude/longitude -> o banco calcula a distancia ate cada unidade da clinica
   -> a combobox reordena, da mais proxima para a mais distante.

   Os dois primeiros passos e o calculo acontecem no servidor
   (POST /auth/clinic/units/nearest); aqui so entram o disparo e a exibicao.
   --------------------------------------------------------------------------- */

// Ultimo endereco resolvido, enviado junto no cadastro para ficar gravado no
// medico (e permitir reordenar unidades no futuro sem geocodificar de novo).
let enderecoDoProfissional = null;
let buscaDeUnidadesEmAndamento = false;

function usandoEnderecoManual() {
    return Boolean(document.getElementById('unknownCep')?.checked);
}

/** Corpo do endereco conforme o modo escolhido (CEP ou manual). */
function lerEnderecoDoFormulario() {
    if (usandoEnderecoManual()) {
        const estado = document.getElementById('professionalState')?.value.trim().toUpperCase() || '';
        const cidade = document.getElementById('professionalCity')?.value.trim() || '';

        if (!cidade || estado.length !== 2) return null;

        return {
            logradouro: document.getElementById('professionalStreet')?.value.trim() || undefined,
            numero: document.getElementById('professionalNumber')?.value.trim() || undefined,
            bairro: document.getElementById('professionalNeighborhood')?.value.trim() || undefined,
            cidade,
            estado
        };
    }

    const cep = document.getElementById('professionalCep')?.value || '';
    if (window.ConectaEndereco.apenasDigitos(cep).length !== 8) return null;

    return { cep: window.ConectaEndereco.apenasDigitos(cep) };
}

/** Preenche a combobox de unidades, com a distancia quando ela existe. */
function renderizarOpcoesDeUnidade(unidades, { comDistancia = false } = {}) {
    const select = document.getElementById('professionalUnit');
    if (!select) return;

    const anterior = select.value;
    select.innerHTML = '<option value="">Selecione uma unidade...</option>';

    if (!unidades.length) {
        const opcao = document.createElement('option');
        opcao.value = '';
        opcao.textContent = 'Nenhuma unidade cadastrada — cadastre em "Unidades"';
        opcao.disabled = true;
        select.appendChild(opcao);
        return;
    }

    unidades.forEach((unidade) => {
        const opcao = document.createElement('option');
        opcao.value = String(unidade.id);
        opcao.dataset.nome = unidade.nome;

        const distancia = comDistancia
            ? window.ConectaEndereco.formatarDistancia(unidade.distanciaKm)
            : '';

        opcao.textContent = distancia ? `${unidade.nome} — ${distancia}` : unidade.nome;
        select.appendChild(opcao);
    });

    // Mantem a escolha do usuario se a unidade continuar na lista; se a ordem
    // mudou, ela apenas trocou de posicao.
    if (unidades.some((unidade) => String(unidade.id) === anterior)) {
        select.value = anterior;
    } else if (comDistancia) {
        // Depois de ordenar por distancia, a primeira opcao e a mais proxima -
        // que e exatamente a sugestao que a clinica quer.
        select.selectedIndex = 1;
    }
}

/** Carrega as unidades sem ordenacao (estado inicial da tela). */
async function carregarUnidadesParaCadastro() {
    const token = getClinicAuthToken();
    if (!token) return;

    try {
        const resposta = await fetch(`${AUTH_API_BASE}/clinic/units`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!resposta.ok) return;

        const unidades = await resposta.json();
        renderizarOpcoesDeUnidade(Array.isArray(unidades) ? unidades : []);
    } catch (erro) {
        console.error('Erro ao carregar unidades:', erro);
    }
}

/**
 * Geocodifica o endereco informado e reordena as unidades por distancia.
 * Chamada quando o CEP fica completo ou quando o endereco manual e preenchido.
 */
async function ordenarUnidadesPelaProximidade() {
    const endereco = lerEnderecoDoFormulario();
    const dica = 'professionalUnitHint';

    if (!endereco) {
        window.ConectaEndereco.definirDica(
            dica,
            'Informe o endereço acima para ordenar as unidades da mais próxima para a mais distante.'
        );
        return;
    }

    if (buscaDeUnidadesEmAndamento) return;
    buscaDeUnidadesEmAndamento = true;

    window.ConectaEndereco.definirDica(dica, 'Calculando a unidade mais próxima...');

    try {
        const resposta = await fetch(`${AUTH_API_BASE}/clinic/units/nearest`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getClinicAuthToken()}`
            },
            body: JSON.stringify(endereco)
        });

        const corpo = await resposta.json().catch(() => ({}));

        if (!resposta.ok) {
            window.ConectaEndereco.definirDica(dica, corpo.message || 'Não foi possível ordenar as unidades.', 'erro');
            return;
        }

        enderecoDoProfissional = corpo.endereco || null;
        const unidades = Array.isArray(corpo.unidades) ? corpo.unidades : [];

        // A UF do CRM acompanha o estado do endereco: e a "validacao dinamica"
        // pedida. Continua editavel para quem tem registro em outro estado.
        aplicarUfDoEndereco(enderecoDoProfissional?.estado);
        preencherCamposManuais(enderecoDoProfissional);

        renderizarOpcoesDeUnidade(unidades, { comDistancia: true });

        if (!unidades.length) {
            window.ConectaEndereco.definirDica(dica, 'Nenhuma unidade cadastrada. Cadastre em "Unidades".', 'erro');
            return;
        }

        const maisProxima = unidades[0];
        window.ConectaEndereco.definirDica(
            dica,
            maisProxima.distanciaKm === null
                ? 'Unidades listadas, mas sem coordenadas para calcular a distância.'
                : `Unidade mais próxima: ${maisProxima.nome} (${window.ConectaEndereco.formatarDistancia(maisProxima.distanciaKm)}).`,
            maisProxima.distanciaKm === null ? '' : 'ok'
        );
    } catch (erro) {
        console.error('Erro ao ordenar unidades:', erro);
        window.ConectaEndereco.definirDica(dica, 'Erro de conexão ao calcular as distâncias.', 'erro');
    } finally {
        buscaDeUnidadesEmAndamento = false;
    }
}

/** Reflete no formulario o endereco que o servidor resolveu a partir do CEP. */
function preencherCamposManuais(endereco) {
    if (!endereco) return;

    const mapa = {
        professionalStreet: endereco.logradouro,
        professionalNeighborhood: endereco.bairro,
        professionalCity: endereco.cidade,
        professionalState: endereco.estado
    };

    Object.entries(mapa).forEach(([id, valor]) => {
        const campo = document.getElementById(id);
        if (campo && valor && !campo.value) campo.value = valor;
    });
}

function aplicarUfDoEndereco(uf) {
    const select = document.getElementById('professionalCrmUf');
    if (!select || !uf) return;

    // So preenche enquanto o usuario nao escolheu nada: sobrescrever uma UF
    // digitada a mao seria apagar uma decisao dele.
    if (!select.value) select.value = uf;

    window.ConectaEndereco.definirDica(
        'professionalCrmHint',
        select.value === uf
            ? `UF preenchida pelo endereço (${uf}).`
            : `Atenção: o endereço é ${uf}, mas o CRM está como ${select.value}.`,
        select.value === uf ? '' : 'erro'
    );
}

// Registrar novo profissional
async function handleRegisterProfessional(event) {
    event.preventDefault();

    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;

    const crm = applyCRMMask(document.getElementById('professionalCRM').value);
    const crmUf = document.getElementById('professionalCrmUf').value;
    const name = document.getElementById('professionalName').value.trim();
    const especialidade = document.getElementById('professionalEspecialidade').value.trim();
    const unidadeSelect = document.getElementById('professionalUnit');
    const unidadeId = Number(unidadeSelect.value);
    const password = document.getElementById('professionalPassword').value.trim();
    const confirmPassword = document.getElementById('professionalConfirmPassword').value.trim();
    const email = document.getElementById('professionalEmail').value.trim();
    const bio = document.getElementById('professionalBio').value.trim();
    const endereco = lerEnderecoDoFormulario();

    if (!crm || !name || !especialidade || !unidadeId || !password) {
        showPopup('Preencha todos os campos obrigatórios.');
        return;
    }

    if (crm.length < 4) {
        showPopup('O número do CRM deve ter de 4 a 7 dígitos.');
        return;
    }

    if (!crmUf) {
        showPopup('Selecione a UF do CRM.');
        return;
    }

    if (!endereco) {
        showPopup(usandoEnderecoManual()
            ? 'Informe pelo menos cidade e UF do endereço do profissional.'
            : 'Informe um CEP válido ou ligue a opção "Não sei meu CEP".');
        return;
    }

    // Validacao dinamica do CRM: a UF do conselho tem de bater com o estado do
    // endereco do medico. O servidor tambem recusa a divergencia - aqui o aviso
    // so chega antes, e com a chance de a clinica confirmar a excecao (medico
    // recem-transferido, atendimento em divisa de estado).
    const ufDoEndereco = endereco.estado || enderecoDoProfissional?.estado;
    let crmUfConfirmado = false;

    if (ufDoEndereco && ufDoEndereco !== crmUf) {
        const confirmado = await showPopup(
            `O endereço do profissional é ${ufDoEndereco}, mas o CRM está registrado como ${crmUf}. Deseja continuar mesmo assim?`,
            'confirm'
        );
        if (!confirmado) return;
        crmUfConfirmado = true;
    }

    if (!isStrongPassword(password)) {
        showPopup('A senha deve ter 8 caracteres, maiúscula, minúscula, número e caractere especial.');
        return;
    }

    if (password !== confirmPassword) {
        showPopup('As senhas não coincidem.');
        return;
    }

    if (!getClinicAuthToken()) {
        showPopup('Sessão expirada. Faça login novamente.');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Registrando...';

    try {
        const apiModule = await loadAPI();

        const enviar = (confirmandoUf) => apiModule.registerProfessional({
            crm,
            crmUf,
            // Sinaliza que a divergencia de UF foi vista e aceita por uma
            // pessoa. Sem esta flag o servidor recusa o cadastro.
            crmUfConfirmado: confirmandoUf,
            name,
            especialidade,
            unidadeId,
            password,
            email: email || undefined,
            bio: bio || undefined,
            ...endereco
        });

        let result = await enviar(crmUfConfirmado);

        // No modo CEP o navegador nao sabe a UF ate o servidor consultar o
        // ViaCEP. Se a divergencia so aparecer la, o servidor devolve
        // `conflitoDeUf`; perguntamos e reenviamos, em vez de deixar a clinica
        // diante de um erro sem saida.
        if (!result.ok && result.data?.conflitoDeUf) {
            const conflito = result.data.conflitoDeUf;
            const confirmado = await showPopup(
                `O CEP informado é de ${conflito.enderecoUf}, mas o CRM está como ${conflito.crmUf}. Deseja cadastrar assim mesmo?`,
                'confirm'
            );

            if (!confirmado) {
                aplicarUfDoEndereco(conflito.enderecoUf);
                return;
            }

            result = await enviar(true);
        }

        if (!result.ok) {
            const detalhe = Array.isArray(result.data?.errors) && result.data.errors.length
                ? result.data.errors.map((problema) => problema.message).join(' ')
                : '';
            showPopup(detalhe || result.data?.message || result.error || 'Erro ao registrar profissional');
            return;
        }

        const registrado = result.data?.data || {};
        const crmExibido = registrado.crmUf
            ? `CRM/${registrado.crmUf} ${registrado.crm}`
            : `CRM ${registrado.crm || crm}`;

        showPopup(`Profissional ${name} registrado com sucesso! ${crmExibido}`);

        form.reset();
        enderecoDoProfissional = null;
        sincronizarModoDeEndereco();
        carregarUnidadesParaCadastro();
        loadProfessionalsList();
    } catch (error) {
        console.error('Erro ao registrar profissional:', error);
        showPopup('Erro ao registrar profissional. Tente novamente.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
    }
}

/**
 * Alterna entre CEP e endereco manual. O toggle "Não sei meu CEP" TROCA o campo
 * de CEP pelos campos de endereco, em vez de mostrar os dois - pedir as duas
 * coisas ao mesmo tempo e o que fazia o formulario parecer longo demais.
 */
function sincronizarModoDeEndereco() {
    const manual = usandoEnderecoManual();
    const campoCep = document.getElementById('professionalCepField');
    const camposManuais = document.getElementById('manualAddressFields');
    const inputCep = document.getElementById('professionalCep');

    if (campoCep) campoCep.hidden = manual;
    if (camposManuais) camposManuais.hidden = !manual;
    if (inputCep) inputCep.required = !manual;

    ['professionalStreet', 'professionalCity', 'professionalState'].forEach((id) => {
        const campo = document.getElementById(id);
        if (campo) campo.required = manual;
    });
}

// Carregar lista de profissionais
async function loadProfessionalsList() {
    try {
        const token = getClinicAuthToken();
        
        if (!token) return;

        const response = await fetch(`${AUTH_API_BASE}/clinic/professionals`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) return;
        
        const data = await response.json();
        currentProfessionals = Array.isArray(data) ? data : [];
        displayProfessionalsList(currentProfessionals);
        await loadCompanyDashboardSummary();
        
    } catch (error) {
        console.error('Erro ao carregar profissionais:', error);
    }
}

// Exibir lista de profissionais
function displayProfessionalsList(professionals) {
    const teamBody = document.getElementById('teamFullTableBody');
    const cardsContainer = document.getElementById('cardsView');
    const overviewBody = document.getElementById('teamTableBody');
    const unitFilter = document.getElementById('unitFilterSelect');
    
    if (!teamBody && !cardsContainer) return;
    
    if (!professionals || professionals.length === 0) {
        if (teamBody) {
            teamBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #999; padding: 1rem;">Por enquanto não há nenhum profissional cadastrado.</td></tr>';
        }
        if (cardsContainer) {
            cardsContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #999; padding: 2rem;">Por enquanto não há nenhum profissional cadastrado.</div>';
        }
        if (overviewBody) {
            overviewBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #999; padding: 1rem;">Por enquanto não há nenhum profissional cadastrado.</td></tr>';
        }
        updateTeamSummary([]);
        updateUnitFilterOptions([]);
        return;
    }
    
    // Renderizar tabela
    if (teamBody) {
        teamBody.innerHTML = professionals.map(prof => `
            <tr>
                <td>
                    ${prof.name || 'N/A'}
                    ${normalizeStatus(prof.status) === 'inativo' ? '<div class="inactive-warning">Profissional desativado</div>' : ''}
                </td>
                <td>${prof.especialidade || 'Médico'}</td>
                <td>${formatarRegistro(prof)}</td>
                <td><span class="status-dot ${getStatusClass(prof.status)}">${formatProfessionalStatus(prof.status)}</span></td>
                <td>${prof.unidade || 'N/A'}</td>
                <td>
                    <button onclick="editProfessional(${prof.id})" style="background: none; border: none; color: #667eea; cursor: pointer; margin: 0 4px;">
                        <i class="ph ph-pencil"></i> Editar
                    </button>
                    ${isActiveStatus(prof.status) ? `
                        <button onclick="inactivateProfessional(${prof.id})" style="background: none; border: none; color: #f44336; cursor: pointer; margin: 0 4px;">
                            <i class="ph ph-user-minus"></i> Inativar
                        </button>
                    ` : `
                        <button onclick="activateProfessional(${prof.id})" style="background: none; border: none; color: #0f4dbf; cursor: pointer; margin: 0 4px;">
                            <i class="ph ph-user-plus"></i> Ativar
                        </button>
                    `}
                </td>
            </tr>
        `).join('');
    }

    // Renderizar cards
    if (cardsContainer) {
        cardsContainer.innerHTML = professionals.map(prof => `
            <div class="professional-card">
                <div class="professional-card-header">
                    <div class="professional-avatar">
                        ${prof.name ? prof.name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <h3>${prof.name || 'N/A'}</h3>
                    <span>${formatarRegistro(prof)}</span>
                </div>
                <div class="professional-card-body">
                    <div class="professional-info-item">
                        <i class="ph ph-briefcase"></i>
                        <div class="professional-info-content">
                            <span class="professional-info-label">Especialidade</span>
                            <span class="professional-info-value">${prof.especialidade || 'Médico'}</span>
                        </div>
                    </div>
                    <div class="professional-info-item">
                        <i class="ph ph-map-pin"></i>
                        <div class="professional-info-content">
                            <span class="professional-info-label">Unidade</span>
                            <span class="professional-info-value">${prof.unidade || 'N/A'}</span>
                        </div>
                    </div>
                    <div class="professional-info-item">
                        <i class="ph ph-clock"></i>
                        <div class="professional-info-content">
                            <span class="professional-info-label">Status</span>
                            <span class="professional-status ${getStatusClass(prof.status)}">
                                <i class="ph ${getStatusIcon(prof.status)}"></i>
                                ${formatProfessionalStatus(prof.status)}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="professional-card-footer">
                    <button class="btn-edit" onclick="editProfessional(${prof.id})">
                        <i class="ph ph-pencil"></i> Editar
                    </button>
                    ${isActiveStatus(prof.status) ? `
                        <button class="btn-delete" onclick="inactivateProfessional(${prof.id})">
                            <i class="ph ph-user-minus"></i>
                        </button>
                    ` : `
                        <button class="btn-edit" onclick="activateProfessional(${prof.id})" style="flex: 0.5; background: #047857;">
                            <i class="ph ph-user-plus"></i>
                        </button>
                    `}
                </div>
            </div>
        `).join('');
    }

    if (overviewBody) {
        overviewBody.innerHTML = professionals.slice(0, 3).map(prof => `
            <tr>
                <td>
                    ${prof.name || 'N/A'}
                    ${normalizeStatus(prof.status) === 'inativo' ? '<div class="inactive-warning">Profissional desativado</div>' : ''}
                </td>
                <td>${prof.especialidade || 'Médico'}</td>
                <td><span class="status-dot ${getStatusClass(prof.status)}">${formatProfessionalStatus(prof.status)}</span></td>
                <td>${prof.unidade || 'N/A'}</td>
            </tr>
        `).join('');
    }
    
    updateTeamSummary(professionals);
    updateUnitFilterOptions(professionals);
}

/**
 * Registro do profissional para exibicao. O numero sozinho ("123456") nao
 * identifica um CRM - e a UF do conselho que fecha a identidade. Medicos
 * cadastrados antes da coluna crm_uf existir continuam aparecendo como
 * "CRM 123456", sem UF.
 */
function formatarRegistro(prof) {
    if (!prof.crm) return 'Sem CRM';
    return prof.crmUf ? `CRM/${prof.crmUf} ${prof.crm}` : `CRM ${prof.crm}`;
}

function getStatusIcon(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'inativo') return 'ph-x-circle';
    if (normalized === 'trabalhando') return 'ph-check-circle';
    if (['ferias', 'férias', 'folga', 'licenca', 'licença'].includes(normalized)) return 'ph-sun';
    return 'ph-check-circle';
}

function updateTeamSummary(professionals) {
    const activeTopEl = document.getElementById('activeCount');
    const workingTopEl = document.getElementById('workingCount');
    const breakTopEl = document.getElementById('breakCount');
    const activeCountEl = document.getElementById('cardActiveCount');
    const workingCountEl = document.getElementById('cardWorkingCount');
    const breakCountEl = document.getElementById('cardBreakCount');

    const active = professionals.filter(prof => isActiveStatus(prof.status)).length;
    const working = professionals.filter(prof => normalizeStatus(prof.status) === 'trabalhando').length;
    const onBreak = professionals.filter(prof => ['ferias', 'férias', 'folga', 'licenca', 'licença'].includes(normalizeStatus(prof.status))).length;

    if (activeTopEl) activeTopEl.innerText = active;
    if (workingTopEl) workingTopEl.innerText = working;
    if (breakTopEl) breakTopEl.innerText = onBreak;
    if (activeCountEl) activeCountEl.innerText = active;
    if (workingCountEl) workingCountEl.innerText = working;
    if (breakCountEl) breakCountEl.innerText = onBreak;
}

function normalizeStatus(status) {
    return String(status || 'ACTIVE').trim().toLowerCase();
}

function isActiveStatus(status) {
    return normalizeStatus(status) !== 'inativo';
}

function formatProfessionalStatus(status) {
    const normalized = normalizeStatus(status);
    const labels = {
        active: 'Ativo',
        ativo: 'Ativo',
        trabalhando: 'Trabalhando',
        ferias: 'Férias',
        'férias': 'Férias',
        folga: 'Folga',
        licenca: 'Licença',
        'licença': 'Licença',
        inativo: 'Inativo'
    };
    return labels[normalized] || 'Ativo';
}

function getStatusClass(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'inativo') return 'inactive';
    if (normalized === 'trabalhando') return 'working';
    if (['ferias', 'férias', 'folga', 'licenca', 'licença'].includes(normalized)) return 'break';
    return 'active';
}

async function loadCompanyDashboardSummary() {
    try {
        const token = getClinicAuthToken();

        if (!token) return;

        const response = await fetch(`${AUTH_API_BASE}/clinic/dashboard-summary`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) return;

        updateDashboardSummary(await response.json());
    } catch (error) {
        console.error('Erro ao carregar resumo do dashboard:', error);
    }
}

function updateDashboardSummary(summary) {
    const values = {
        activeCount: summary.activeEmployees,
        workingCount: summary.workingEmployees,
        breakCount: summary.breakEmployees,
        cardActiveCount: summary.activeEmployees,
        cardWorkingCount: summary.workingEmployees,
        cardBreakCount: summary.breakEmployees,
        upcomingAppointmentsCount: summary.upcomingAppointments,
        pendingRequestsCount: summary.pendingRequests,
        documentsToValidateCount: summary.documentsToValidate
    };

    Object.entries(values).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) element.innerText = Number(value || 0);
    });
}

function updateUnitFilterOptions(professionals) {
    const unitFilter = document.getElementById('unitFilterSelect');
    if (!unitFilter) return;

    const uniqueUnits = Array.from(new Set(professionals.map(prof => prof.unidade).filter(Boolean)));
    const previousValue = unitFilter.value || 'Todas';

    unitFilter.innerHTML = '<option value="Todas">Todas</option>' + uniqueUnits.map(unit => `
        <option value="${unit}">${unit}</option>
    `).join('');

    if ([...unitFilter.options].some(opt => opt.value === previousValue)) {
        unitFilter.value = previousValue;
    }
}

function applyUnitFilter() {
    const unitFilter = document.getElementById('unitFilterSelect');
    if (!unitFilter) return;
    
    const selectedUnit = unitFilter.value;
    const filtered = selectedUnit === 'Todas'
        ? currentProfessionals
        : currentProfessionals.filter(prof => prof.unidade === selectedUnit);

    displayProfessionalsList(filtered);
}

// Editar profissional (placeholder)
function editProfessional(id) {
    showPopup(`Editar profissional ${id} - Funcionalidade em desenvolvimento`);
}

// Inativar profissional (soft delete)
async function inactivateProfessional(id) {
    if (!confirm('Tem certeza que deseja inativar este profissional? Ele nao podera mais fazer login como medico.')) return;
    
    try {
        const token = getClinicAuthToken();
        
        if (!token) {
            showPopup('Faça login como empresa para inativar profissionais.');
            return;
        }
        
        const response = await fetch(`${AUTH_API_BASE}/clinic/professionals/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            showPopup('Profissional inativado com sucesso');
            loadProfessionalsList();
        } else {
            const data = await response.json().catch(() => ({}));
            if (response.status === 401 || response.status === 403) {
                showPopup(data.message || 'Apenas empresas podem inativar profissionais.');
                return;
            }
            showPopup(data.message || 'Erro ao inativar profissional');
        }
    } catch (error) {
        console.error('Erro:', error);
        showPopup('Erro ao inativar profissional');
    }
}

// Reativar profissional
async function activateProfessional(id) {
    if (!confirm('Deseja reativar este profissional?')) return;

    try {
        const token = getClinicAuthToken();

        if (!token) {
            showPopup('Faça login como empresa para ativar profissionais.');
            return;
        }

        const response = await fetch(`${AUTH_API_BASE}/clinic/professionals/${id}/activate`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            showPopup('Profissional reativado com sucesso');
            loadProfessionalsList();
        } else {
            const data = await response.json().catch(() => ({}));
            if (response.status === 401 || response.status === 403) {
                showPopup(data.message || 'Apenas empresas podem ativar profissionais.');
                return;
            }
            showPopup(data.message || 'Erro ao reativar profissional');
        }
    } catch (error) {
        console.error('Erro:', error);
        showPopup('Erro ao reativar profissional');
    }
}

// Inicializar quando página carrega
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registerProfessionalForm');
    const crmInput = document.getElementById('professionalCRM');

    if (form) {
        form.addEventListener('submit', handleRegisterProfessional);
    }

    if (crmInput) {
        crmInput.addEventListener('input', function(e) {
            e.target.value = applyCRMMask(e.target.value);
        });
    }

    // ---- Endereco do medico, UF do CRM e unidades por distancia ----------
    const ufSelect = document.getElementById('professionalCrmUf');
    const cepInput = document.getElementById('professionalCep');
    const unknownCepToggle = document.getElementById('unknownCep');
    const stateInput = document.getElementById('professionalState');

    if (ufSelect) {
        window.ConectaEndereco.preencherSelectDeUf(ufSelect, 'Selecione...');
        ufSelect.addEventListener('change', () => {
            aplicarUfDoEndereco(enderecoDoProfissional?.estado
                || stateInput?.value.trim().toUpperCase()
                || null);
        });
    }

    if (cepInput) {
        window.ConectaEndereco.ligarMascaraDeCep(cepInput);
        window.ConectaEndereco.ligarBuscaDeCep(cepInput, {
            idDaDica: 'professionalCepHint',
            textoInicial: 'Digite o CEP para localizar o endereço.',
            aoEncontrar(endereco) {
                window.ConectaEndereco.definirDica(
                    'professionalCepHint',
                    `${[endereco.logradouro, endereco.bairro].filter(Boolean).join(', ')} — ${endereco.cidade}/${endereco.estado}`,
                    'ok'
                );
                aplicarUfDoEndereco(endereco.estado);
                // A ordenacao das unidades depende da geocodificacao, que roda
                // no servidor a partir do mesmo CEP.
                ordenarUnidadesPelaProximidade();
            },
            aoLimpar() {
                enderecoDoProfissional = null;
            }
        });
    }

    if (stateInput) {
        window.ConectaEndereco.ligarMascaraDeUf(stateInput);
    }

    // No modo manual nao ha CEP para disparar a busca: o gatilho e sair do
    // campo de cidade ou de UF com os dois preenchidos.
    ['professionalCity', 'professionalState'].forEach((id) => {
        const campo = document.getElementById(id);
        if (!campo) return;
        campo.addEventListener('blur', () => {
            if (usandoEnderecoManual()) ordenarUnidadesPelaProximidade();
        });
    });

    if (unknownCepToggle) {
        unknownCepToggle.addEventListener('change', () => {
            sincronizarModoDeEndereco();
            enderecoDoProfissional = null;
            window.ConectaEndereco.definirDica(
                'professionalUnitHint',
                'Informe o endereço acima para ordenar as unidades da mais próxima para a mais distante.'
            );
        });
        sincronizarModoDeEndereco();
    }

    carregarUnidadesParaCadastro();

    // A aba "Unidades" avisa quando a lista muda, para a combobox nao ficar
    // desatualizada sem recarregar a pagina.
    window.recarregarUnidadesDoCadastro = carregarUnidadesParaCadastro;

    const filterButton = document.getElementById('btnApplyUnitFilter');
    if (filterButton) {
        filterButton.addEventListener('click', applyUnitFilter);
    }

    // Toggle de visualização (Cards vs Tabela)
    const viewButtons = document.querySelectorAll('.view-btn');
    const cardsView = document.getElementById('cardsView');
    const tableView = document.getElementById('tableView');

    viewButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const viewType = this.dataset.view;
            
            // Atualizar botões ativos
            viewButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Mostrar/ocultar vistas
            if (viewType === 'cards' && cardsView && tableView) {
                cardsView.style.display = 'grid';
                tableView.style.display = 'none';
            } else if (viewType === 'table' && cardsView && tableView) {
                cardsView.style.display = 'none';
                tableView.style.display = 'block';
            }
        });
    });
    
    // Carregar lista de profissionais
    loadProfessionalsList();
    loadCompanyDashboardSummary();
    
    // Animação de carregamento
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});
