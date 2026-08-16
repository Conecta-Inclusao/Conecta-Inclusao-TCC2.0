// API base URL - centralizada pelo arquivo config.js
const API_BASE = window.APP_CONFIG?.AUTH_API_URL || '/auth';

// Função para obter token do localStorage
export function getToken() {
    return localStorage.getItem('token');
}

// Função genérica para fazer requisições
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
        console.error('Erro na requisição:', error);
        return { ok: false, status: 0, data: { message: 'Erro de conexão' } };
    }
}

// Funções de registro
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
        return { ok: false, error: 'Token não encontrado' };
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

// Funções de login
export async function loginUniversal(data) {
    return apiRequest('/login/universal', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

// Função para obter dados do usuário (se necessário)
export async function getUserData(token) {
    return apiRequest('/user', {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
}

// Função para obter perfil do usuário
export async function getUserProfile() {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token não encontrado' };
    }
    return apiRequest('/profile', {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
}

// Função para obter agendamentos do paciente
export async function getPatientAppointments(pacienteId) {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token não encontrado' };
    }

    try {
        const response = await fetch(`${window.APP_CONFIG?.API_URL || '/api'}/agendamentos/paciente/${pacienteId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        const data = await response.json();
        const payload = Array.isArray(data) ? data : (data?.data && Array.isArray(data.data) ? data.data : []);
        return { ok: response.ok, status: response.status, data: payload };
    } catch (error) {
        console.error('Erro ao buscar agendamentos do paciente:', error);
        return { ok: false, status: 0, data: [] };
    }
}

// Função para obter médicos disponíveis
export async function getAvailableDoctors() {
    const response = await fetch(`${API_BASE}/doctors/available`);
    const data = await response.json();
    return { ok: response.ok, status: response.status, data };
}

// Função para obter agendamentos do profissional (médico)
export async function getProfessionalAppointments(profissionalId, { limit = 100, offset = 0 } = {}) {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token não encontrado' };
    }
    try {
        const params = new URLSearchParams({
            limit: String(limit),
            offset: String(offset)
        });
        const response = await fetch(`${window.APP_CONFIG?.API_URL || '/api'}/agendamentos/profissional/${profissionalId}?${params.toString()}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            }
        });
        const data = await response.json();
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        console.error('Erro ao buscar agendamentos do profissional:', error);
        return { ok: false, status: 0, data: { message: 'Erro de conexão' } };
    }
}

// Funcao para atualizar status do agendamento
export async function updateAppointmentStatus(appointmentId, status) {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token nao encontrado' };
    }

    try {
        const response = await fetch(`${window.APP_CONFIG?.API_URL || '/api'}/agendamentos/${appointmentId}/status`, {
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

// getClinicas foi removida: apontava para /api/clinica (rota inexistente) e o
// modulo /api/clinicas do backend era codigo morto, escrito contra tabelas
// (`usuarios`, `clinica_especialidades`) que nao existem no schema.

// Função para obter profissionais da clínica
export async function getClinicProfessionals() {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token não encontrado' };
    }
    return apiRequest('/clinic/professionals', {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
}

// Função para obter resumo do dashboard da clínica
export async function getClinicDashboardSummary() {
    const token = getToken();
    if (!token) {
        return { ok: false, error: 'Token não encontrado' };
    }
    return apiRequest('/clinic/dashboard-summary', {
        headers: {
            'Authorization': `Bearer ${token}`,
        }
    });
}
