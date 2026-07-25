// API base URL - ajuste conforme necessÃ¡rio
const API_BASE = 'https://conecta-inclusao.onrender.com/auth';

// FunÃ§Ã£o para obter token do localStorage
export function getToken() {
    return localStorage.getItem('token');
}

// FunÃ§Ã£o genÃ©rica para fazer requisiÃ§Ãµes
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const defaultOptions = {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    };

    try {
        const response = await fetch(url, { ...defaultOptions, ...options, headers: defaultOptions.headers });
        const data = await response.json();
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        console.error('Erro na requisiÃ§Ã£o:', error);
        return { ok: false, status: 0, data: { message: 'Erro de conexÃ£o' } };
    }
}

// FunÃ§Ãµes de registro
export async function registerPatient(data) {
    return apiRequest('/register/patient', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

export async function registerDoctor(data) {
    return apiRequest('/register/doctor', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

export async function registerClinic(data) {
    return apiRequest('/register/clinic', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

export async function registerProfessional(crm, name, especialidade, unidade, password, email, bio) {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token nÃ£o encontrado' };
    }
    return apiRequest('/register/professional', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ crm, name, especialidade, unidade, password, email, bio })
    });
}

// FunÃ§Ãµes de login
export async function loginUniversal(data) {
    return apiRequest('/login/universal', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

// FunÃ§Ã£o para obter dados do usuÃ¡rio (se necessÃ¡rio)
export async function getUserData(token) {
    return apiRequest('/user', {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
}

// FunÃ§Ã£o para obter perfil do usuÃ¡rio
export async function getUserProfile() {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token nÃ£o encontrado' };
    }
    return apiRequest('/profile', {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
}

// FunÃ§Ã£o para obter agendamentos do paciente
export async function getPatientAppointments(pacienteId) {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token nÃ£o encontrado' };
    }
    const response = await fetch(`https://conecta-inclusao.onrender.com/api/agendamentos/paciente/${pacienteId}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
}

// FunÃ§Ã£o para obter mÃ©dicos disponÃ­veis
export async function getAvailableDoctors() {
    const response = await fetch(`${API_BASE}/doctors/available`);
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
}

// FunÃ§Ã£o para obter agendamentos do profissional (mÃ©dico)
export async function getProfessionalAppointments(profissionalId, { limit = 100, offset = 0 } = {}) {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token nÃ£o encontrado' };
    }
    try {
        const params = new URLSearchParams({
            limit: String(limit),
            offset: String(offset)
        });
        const response = await fetch(`https://conecta-inclusao.onrender.com/api/agendamentos/profissional/${profissionalId}?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        const data = await response.json();
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        console.error('Erro ao buscar agendamentos do profissional:', error);
        return { ok: false, status: 0, data: { message: 'Erro de conexÃ£o' } };
    }
}

// FunÃ§Ã£o para obter lista de clÃ­nicas
// Funcao para atualizar status do agendamento
export async function updateAppointmentStatus(appointmentId, status) {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token nao encontrado' };
    }

    try {
        const response = await fetch(`https://conecta-inclusao.onrender.com/api/agendamentos/${appointmentId}/status`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ status })
        });
        const data = await response.json();
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        console.error('Erro ao atualizar status do agendamento:', error);
        return { ok: false, status: 0, data: { message: 'Erro de conexao' } };
    }
}

export async function getClinicas() {
    const response = await fetch('https://conecta-inclusao.onrender.com/api/clinicas');
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
}

// FunÃ§Ã£o para obter profissionais da clÃ­nica
export async function getClinicProfessionals() {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token nÃ£o encontrado' };
    }
    return apiRequest('/clinic/professionals', {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
}

// FunÃ§Ã£o para obter resumo do dashboard da clÃ­nica
export async function getClinicDashboardSummary() {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token nÃ£o encontrado' };
    }
    return apiRequest('/clinic/dashboard-summary', {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
}

