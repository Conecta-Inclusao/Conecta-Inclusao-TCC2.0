// Gerenciador de Profissionais da Empresa
let api;
let currentProfessionals = [];
const AUTH_API_BASE = 'https://conecta-inclusao.onrender.com/auth';

async function loadAPI() {
    if (!api) {
        api = await import('./api.js');
    }
    return api;
}

function getClinicAuthToken() {
    return localStorage.getItem('token');
}

// MÃ¡scara de CRM automÃ¡tica
function applyCRMMask(value) {
    let v = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v.length > 7) v = v.slice(0, 7);
    return v;
}

// Registrar novo profissional
async function handleRegisterProfessional(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerText;
    
    const crm = document.getElementById('professionalCRM').value.trim();
    const name = document.getElementById('professionalName').value.trim();
    const especialidade = document.getElementById('professionalEspecialidade').value.trim();
    const unidade = document.getElementById('professionalUnit').value.trim();
    const password = document.getElementById('professionalPassword').value.trim();
    const confirmPassword = document.getElementById('professionalConfirmPassword').value.trim();
    const email = document.getElementById('professionalEmail').value.trim();
    const bio = document.getElementById('professionalBio').value.trim();
    
    // ValidaÃ§Ãµes
    if (!crm || !name || !especialidade || !unidade || !password) {
        showPopup('Preencha todos os campos obrigatÃ³rios.');
        return;
    }
    
    if (crm.length < 4) {
        showPopup('CRM invÃ¡lido.');
        return;
    }
    
    if (!isStrongPassword(password)) {
        showPopup('A senha deve ter 8 caracteres, maiÃºscula, minÃºscula, nÃºmero e caractere especial.');
        return;
    }

    if (password !== confirmPassword) {
        showPopup('As senhas nÃ£o coincidem.');
        return;
    }
    
    // Obter clinicaId do localStorage
    const userData = localStorage.getItem('user');
    if (!userData) {
        showPopup('Erro: Dados do usuÃ¡rio nÃ£o encontrados. FaÃ§a login novamente.');
        return;
    }
    const user = JSON.parse(userData);
    const userId = user.id;
    
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="ph ph-circle-notch-bold" style="animation: spin 1s linear infinite;"></i> Registrando...';
    
    try {
        const apiModule = await loadAPI();
        
        const result = await apiModule.registerProfessional(
            crm.toUpperCase(),
            name,
            especialidade,
            unidade,
            password,
            email,
            bio
        );
        
        if (!result.ok) {
            showPopup(`Erro: ${result.data?.message || result.error || 'Erro ao registrar profissional'}`);
            submitBtn.disabled = false;
            submitBtn.innerText = originalText;
            return;
        }
        
        const registeredCRM = result.data?.data?.crm || result.data?.crm || crm.toUpperCase();
        // Sucesso
        showPopup(`Profissional ${name} registrado com sucesso! CRM: ${registeredCRM}`);
        
        // Limpar formulÃ¡rio
        form.reset();
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
        
        // Atualizar lista de profissionais
        loadProfessionalsList();
        
    } catch (error) {
        console.error('Erro ao registrar profissional:', error);
        showPopup(`Erro: ${error.message}`);
        submitBtn.disabled = false;
        submitBtn.innerText = originalText;
    }
}

// Buscar ID da clÃ­nica pelo ID do usuÃ¡rio
async function getClinicaIdByUserId(userId) {
    try {
        const token = getClinicAuthToken();
        
        if (!token) return null;
        
        const response = await fetch(`https://conecta-inclusao.onrender.com/clinic/id/${userId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.clinicaId || null;
    } catch (error) {
        console.error('Erro ao buscar ID da clÃ­nica:', error);
        return null;
    }
}

// Carregar lista de profissionais
async function loadProfessionalsList() {
    try {
        const token = getClinicAuthToken();
        
        if (!token) {
            console.log('UsuÃ¡rio nÃ£o autenticado');
            return;
        }
        
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
            teamBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #999; padding: 1rem;">Por enquanto nÃ£o hÃ¡ nenhum profissional cadastrado.</td></tr>';
        }
        if (cardsContainer) {
            cardsContainer.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #999; padding: 2rem;">Por enquanto nÃ£o hÃ¡ nenhum profissional cadastrado.</div>';
        }
        if (overviewBody) {
            overviewBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #999; padding: 1rem;">Por enquanto nÃ£o hÃ¡ nenhum profissional cadastrado.</td></tr>';
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
                <td>${prof.especialidade || 'MÃ©dico'}</td>
                <td>${prof.crm || 'N/A'}</td>
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
                    <span>${prof.crm || 'Sem CRM'}</span>
                </div>
                <div class="professional-card-body">
                    <div class="professional-info-item">
                        <i class="ph ph-briefcase"></i>
                        <div class="professional-info-content">
                            <span class="professional-info-label">Especialidade</span>
                            <span class="professional-info-value">${prof.especialidade || 'MÃ©dico'}</span>
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
                <td>${prof.especialidade || 'MÃ©dico'}</td>
                <td><span class="status-dot ${getStatusClass(prof.status)}">${formatProfessionalStatus(prof.status)}</span></td>
                <td>${prof.unidade || 'N/A'}</td>
            </tr>
        `).join('');
    }
    
    updateTeamSummary(professionals);
    updateUnitFilterOptions(professionals);
}

function getStatusIcon(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'inativo') return 'ph-x-circle';
    if (normalized === 'trabalhando') return 'ph-check-circle';
    if (['ferias', 'fÃ©rias', 'folga', 'licenca', 'licenÃ§a'].includes(normalized)) return 'ph-sun';
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
    const onBreak = professionals.filter(prof => ['ferias', 'fÃ©rias', 'folga', 'licenca', 'licenÃ§a'].includes(normalizeStatus(prof.status))).length;

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
        ferias: 'FÃ©rias',
        'fÃ©rias': 'FÃ©rias',
        folga: 'Folga',
        licenca: 'LicenÃ§a',
        'licenÃ§a': 'LicenÃ§a',
        inativo: 'Inativo'
    };
    return labels[normalized] || 'Ativo';
}

function getStatusClass(status) {
    const normalized = normalizeStatus(status);
    if (normalized === 'inativo') return 'inactive';
    if (normalized === 'trabalhando') return 'working';
    if (['ferias', 'fÃ©rias', 'folga', 'licenca', 'licenÃ§a'].includes(normalized)) return 'break';
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
            showPopup('FaÃ§a login como empresa para inativar profissionais.');
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
            showPopup('FaÃ§a login como empresa para ativar profissionais.');
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

// Inicializar quando pÃ¡gina carrega
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

    const filterButton = document.getElementById('btnApplyUnitFilter');
    if (filterButton) {
        filterButton.addEventListener('click', applyUnitFilter);
    }

    // Toggle de visualizaÃ§Ã£o (Cards vs Tabela)
    const viewButtons = document.querySelectorAll('.view-btn');
    const cardsView = document.getElementById('cardsView');
    const tableView = document.getElementById('tableView');

    viewButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const viewType = this.dataset.view;
            
            // Atualizar botÃµes ativos
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
    
    // AnimaÃ§Ã£o de carregamento
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
});

